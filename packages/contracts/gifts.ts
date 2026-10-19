// Gifts between the two people (P7-41b) — the five endpoints, stated once.
//
//   POST /api/v1/gifts               GiftCreateRequestSchema  → GiftResponseSchema (201)
//   GET  /api/v1/gifts               —                        → GiftListResponseSchema
//   GET  /api/v1/gifts/[id]          —                        → GiftResponseSchema
//   POST /api/v1/gifts/[id]/choose   GiftChooseRequestSchema  → GiftResponseSchema
//   POST /api/v1/gifts/[id]/cancel   no body (any body is ignored) → GiftResponseSchema
//
// WHO RECEIVES THESE SHAPES: the giver, and nobody else. A gift record is invisible to every other
// viewer — `GET /api/v1/gifts` lists only the viewer's own gifts as giver, and `GET`, `choose` and
// `cancel` on someone else's gift answer exactly what a nonexistent id answers (`NOT_FOUND`, 404,
// a byte-identical body). So every field below may carry the giver's real criteria and the real
// details of the candidate rows; there is no masked variant of a gift, because a non-giver never
// receives one at all. Masking applies to TRANSACTION rows on the other surfaces, not here.
//
// STRICT OBJECTS, P7-41a's choice for objects this app authors at both ends. A stray key on a
// create request (`state: 'matched'`, `giverUserId: …`) is exactly the key that must be refused,
// never carried through: the giver is always the signed-in user, and the state is always born
// 'awaiting'.
//
// MONEY: decimal strings at most two fraction digits, end to end. No step here converts an amount
// to a JS number, and none may: exact decimal equality is the matching rule, and binary floats break
// it on cent values as ordinary as .15 or .35. DATES: 'YYYY-MM-DD' calendar text on the server's
// calendar, which handlers produce with a `::text` cast in SQL (pg would otherwise hand them a JS
// Date object, the P1-11 N4 boundary). Consumers compare these as strings or ask Postgres; nothing
// here parses one into a Date.
//
// Layering as auth.ts: `zod` and sibling modules only. No `next/*`, no `pg`, no `lib/**`.

import { z } from 'zod';
import { apiResponseSchema } from './envelope';
import { timestamptz } from './representation';
import { moneyString } from './overview';
import { UserDisplayNameSchema, UserIdSchema } from './auth';

// ─── Primitives ─────────────────────────────────────────────────────────────────────────────────

/**
 * A gift's exact price: a positive decimal string with at most two fraction digits — the values
 * `gifts.amount NUMERIC(12,2) CHECK (amount > 0)` accepts, and no others.
 *
 * At most ten integer digits, because NUMERIC(12,2) holds ten; a longer value would pass a looser
 * regex and fail at the INSERT as a database error instead of an `INVALID_INPUT`. No leading zeros,
 * no sign, no exponent, no surrounding space, no bare `.5`: each of those is a second spelling of a
 * value, and the stored form is one spelling. Zero in any spelling (`0`, `0.0`, `0.00`) is refused —
 * a zero gift would match nothing, and "any amount" is said with `null`, never with zero.
 *
 * Responses carry the stored value as pg prints it (`12.50`), which this accepts. It DESCRIBES and
 * never rounds: no transform, no coercion.
 */
export const giftAmount = z
  .string()
  .regex(
    /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/,
    'expected a positive decimal amount with at most two decimal places'
  )
  .refine((s) => /[1-9]/.test(s), 'a gift amount must be greater than zero');

/**
 * A calendar date as `'YYYY-MM-DD'`, and a real one: `2026-02-30` is refused, `2028-02-29` is not.
 *
 * Checked by integer arithmetic on the three fields, not by handing the string to the JS date
 * machinery, which reads a bare `YYYY-MM-DD` as UTC midnight and shifts it a day in half the world.
 * Year 0001 or later, because Postgres has no year zero. This is the shape of `gifts.window_start`,
 * `window_end` and `reveal_date` as the handler casts them to text, and of a candidate row's date.
 */
export const giftDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a calendar date as YYYY-MM-DD')
  .refine((s) => {
    const year = Number(s.slice(0, 4));
    const month = Number(s.slice(5, 7));
    const day = Number(s.slice(8, 10));
    if (year < 1 || month < 1 || month > 12 || day < 1) return false;
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= (lengths[month - 1] ?? 0);
  }, 'expected a real calendar date');

/**
 * A merchant criterion AS SUBMITTED: at least 3 characters once surrounding whitespace is ignored,
 * and at most 200 characters in all.
 *
 * Counted in characters (code points), not UTF-16 units, because the column's CHECK counts with
 * `char_length`; counting units would accept a two-emoji criterion the INSERT then refuses.
 *
 * Surrounding whitespace is ACCEPTED here and the handler stores the trimmed form (the column
 * refuses an untrimmed value), because SPEC.md states the rule as "at least 3 characters after
 * trimming" — so `'  quill  '` is a valid request, and `'   '` is not. The schema refuses; it does
 * not reshape. Every other character is literal: `%`, `_`, `.*`, `(` are accepted and later matched
 * as themselves, never as a pattern.
 *
 * The error messages never echo the submitted text (SPEC.md G3).
 */
export const giftMerchantCriterion = z
  .string()
  .refine((s) => Array.from(s).length <= 200, 'a merchant criterion is at most 200 characters')
  .refine(
    (s) => Array.from(s.trim()).length >= 3,
    'a merchant criterion needs at least 3 characters besides surrounding spaces'
  );

/**
 * The five states, exactly the `gifts_state_check` vocabulary.
 *
 *   `awaiting`  — no candidate yet; matching is live.
 *   `choose`    — several rows qualified; all are held (filed in the gift category and masked) until
 *                 the giver picks one with `POST …/choose`.
 *   `matched`   — exactly one row is the gift. Final.
 *   `unmatched` — the giver has been told nothing matched. Always carries `noticeAt`.
 *   `cancelled` — the giver cancelled; every held row was restored and unmasked.
 *
 * A consumer must still keep a default branch: a sixth state is an additive change (BUILD.md §9.2)
 * and must not crash a client built against five.
 */
export const GiftStateSchema = z.enum(['awaiting', 'choose', 'matched', 'unmatched', 'cancelled']);

/**
 * The codes these endpoints define. A SUBSET, NOT A CLOSURE, as `AuthErrorCodeSchema` is: the
 * envelope keeps `code` open, and the boundary's `UNAUTHENTICATED` / `INSUFFICIENT_SCOPE` and the
 * shared `DB_ERROR` can also arrive here.
 *
 *   `INVALID_INPUT`        400 — the body failed these schemas, the recipient named is the giver,
 *                                the account has no Plaid access token, or `choose` named a row that
 *                                is not one of this gift's candidates. The message never echoes a
 *                                submitted criterion.
 *   `NOT_FOUND`            404 — no such gift FOR THIS VIEWER. Someone else's gift answers this,
 *                                byte-identically to an id that does not exist; never 403.
 *   `NO_RECIPIENT`         409 — there is no other live user to give to.
 *   `GIFT_CATEGORY_UNSET`  409 — no gift category is designated (`gift_settings.category_id` NULL),
 *                                so a match would have nowhere to be filed.
 *   `ALREADY_RESOLVED`     409 — `choose` on a gift that is not in `choose`, or `cancel` on a gift
 *                                already `cancelled`.
 *   `GIFT_LOCKED`          409 — emitted by the TRANSACTION routes, not these five: a write refused
 *                                because the row is held by an unrevealed gift (SPEC.md Q5). Its
 *                                message carries no row text.
 */
export const GiftErrorCodeSchema = z.enum([
  'INVALID_INPUT',
  'NOT_FOUND',
  'NO_RECIPIENT',
  'GIFT_CATEGORY_UNSET',
  'ALREADY_RESOLVED',
  'GIFT_LOCKED',
]);

/** A gift id, as `gifts.id` (SERIAL) reaches a consumer. */
export const GiftIdSchema = z.int().positive();

/** A ledger row's id, `transactions.id` — the key gifts link by, never the Plaid id. */
export const GiftTransactionIdSchema = z.int().positive();

// ─── Requests ───────────────────────────────────────────────────────────────────────────────────

/**
 * `POST /api/v1/gifts` — the body. The giver is the signed-in user and is never in the body.
 *
 * `amount`, `merchant` and `accountId` are each NULL or absent for "any" — the two spellings mean
 * the same thing, and neither is ever stored as `0` or `''`. At least one of `amount` and `merchant`
 * must be given, and when both are, a row must satisfy both.
 *
 * `recipientUserId` is optional: absent means "the one other live user", and the handler answers
 * `NO_RECIPIENT` when there is none. Naming the giver is `INVALID_INPUT`, a check only the handler
 * can make because only it knows who is asking.
 *
 * The date rules the schema CAN see are here: window start on or before window end (a one-day
 * window is legal), reveal on or after window start. Comparison is on the `YYYY-MM-DD` strings,
 * which order exactly as the dates do. Each is also a CHECK on `gifts`.
 */
export const GiftCreateRequestSchema = z
  .strictObject({
    recipientUserId: UserIdSchema.optional(),
    amount: giftAmount.nullable().optional(),
    merchant: giftMerchantCriterion.nullable().optional(),
    accountId: z.string().min(1, 'an account id may not be empty').nullable().optional(),
    windowStart: giftDate,
    windowEnd: giftDate,
    revealDate: giftDate,
  })
  .refine((g) => (g.amount ?? null) !== null || (g.merchant ?? null) !== null, {
    message: 'a gift needs an amount, a merchant, or both',
    path: ['amount'],
  })
  .refine((g) => g.windowStart <= g.windowEnd, {
    message: 'the window must not end before it starts',
    path: ['windowEnd'],
  })
  .refine((g) => g.revealDate >= g.windowStart, {
    message: 'the reveal date must not be before the window starts',
    path: ['revealDate'],
  });

/** `POST /api/v1/gifts/[id]/choose` — the body: which candidate is the gift. */
export const GiftChooseRequestSchema = z.strictObject({
  transactionId: GiftTransactionIdSchema,
});

// ─── Responses ──────────────────────────────────────────────────────────────────────────────────

/**
 * One ledger row a gift currently holds, with its REAL details — the giver is the only reader.
 *
 * `amount` is the row's stored `transactions.amount`, byte-identical to `amount::text`, and keeps
 * the ledger's sign: it was positive when it matched, and a later Plaid `modified` may change it,
 * so it is `moneyString` rather than `giftAmount`. `label` is the row's merchant, falling back to
 * its raw name, as the ledger shows it to the giver.
 */
export const GiftCandidateSchema = z.strictObject({
  transactionId: GiftTransactionIdSchema,
  date: giftDate,
  amount: moneyString,
  accountId: z.string(),
  accountName: z.string(),
  label: z.string(),
});

/**
 * One gift, as its giver sees it.
 *
 * `amount`, `merchant` and `accountId` are the stored criteria; NULL means "any". `merchant` is the
 * stored, trimmed form. `accountName` is NULL exactly when `accountId` is.
 *
 * `revealed` is `reveal_date <= CURRENT_DATE` EVALUATED BY POSTGRES in the read that produced this
 * object, so the page never has to compare a date against a client or JS clock. It is a derived
 * value on read; nothing stores it.
 *
 * `noticeAt` is when the giver was told, NULL = not told; it is the in-app notice itself, and is
 * always set on an `unmatched` gift.
 *
 * `candidates` is every row the gift holds right now — never null, `[]` when it holds none:
 * one row or more while `choose`, exactly the matched row when `matched`, and none in `awaiting`,
 * `unmatched` or `cancelled`. Ordered by `transactionId` ascending, so "which one is first" never
 * depends on arrival order.
 */
export const GiftSchema = z
  .strictObject({
    id: GiftIdSchema,
    recipientUserId: UserIdSchema,
    recipientDisplayName: UserDisplayNameSchema,
    amount: giftAmount.nullable(),
    merchant: z.string().min(3).nullable(),
    accountId: z.string().min(1).nullable(),
    accountName: z.string().nullable(),
    windowStart: giftDate,
    windowEnd: giftDate,
    revealDate: giftDate,
    state: GiftStateSchema,
    revealed: z.boolean(),
    noticeAt: timestamptz.nullable(),
    createdAt: timestamptz,
    candidates: z.array(GiftCandidateSchema),
  })
  .refine((g) => g.amount !== null || g.merchant !== null, {
    message: 'a stored gift always has an amount, a merchant, or both',
    path: ['amount'],
  })
  .refine((g) => (g.accountId === null) === (g.accountName === null), {
    message: 'accountName is present exactly when accountId is',
    path: ['accountName'],
  })
  .refine((g) => g.state !== 'unmatched' || g.noticeAt !== null, {
    message: 'an unmatched gift is one whose giver has been told',
    path: ['noticeAt'],
  })
  .refine(
    (g) =>
      g.state === 'choose'
        ? g.candidates.length >= 1
        : g.state === 'matched'
          ? g.candidates.length === 1
          : g.candidates.length === 0,
    { message: 'candidates do not agree with the state', path: ['candidates'] }
  );

/**
 * `GET /api/v1/gifts` — the viewer's own gifts as giver, newest first (`created_at DESC, id DESC`).
 * `[]` when there are none, which is also exactly what the recipient of every gift receives.
 */
export const GiftListSchema = z.array(GiftSchema);

/** `POST /api/v1/gifts`, `GET /api/v1/gifts/[id]`, `POST …/choose`, `POST …/cancel`. */
export const GiftResponseSchema = apiResponseSchema(GiftSchema);

/** `GET /api/v1/gifts`. */
export const GiftListResponseSchema = apiResponseSchema(GiftListSchema);

export type GiftState = z.infer<typeof GiftStateSchema>;
export type GiftErrorCode = z.infer<typeof GiftErrorCodeSchema>;
export type GiftCreateRequest = z.infer<typeof GiftCreateRequestSchema>;
export type GiftChooseRequest = z.infer<typeof GiftChooseRequestSchema>;
export type GiftCandidate = z.infer<typeof GiftCandidateSchema>;
export type Gift = z.infer<typeof GiftSchema>;
