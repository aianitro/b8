// Loyalty (P8-42a) — household members, the program catalog with its aliases, memberships with a
// derived current balance, append-only balance observations, and instruments. The eleven endpoints,
// stated once:
//
//   GET   /api/v1/loyalty                                 —                                → LoyaltyOverviewResponseSchema
//   POST  /api/v1/loyalty/members                         LoyaltyMemberCreateRequestSchema → LoyaltyMemberResponseSchema (201)
//   PATCH /api/v1/loyalty/members/[id]                    LoyaltyMemberPatchRequestSchema  → LoyaltyMemberResponseSchema
//   POST  /api/v1/loyalty/programs                        LoyaltyProgramCreateRequestSchema → LoyaltyProgramResponseSchema (201)
//   PATCH /api/v1/loyalty/programs/[id]                   LoyaltyProgramPatchRequestSchema → LoyaltyProgramResponseSchema
//   POST  /api/v1/loyalty/memberships                     LoyaltyMembershipCreateRequestSchema → LoyaltyMembershipResponseSchema (201)
//   PATCH /api/v1/loyalty/memberships/[id]                LoyaltyMembershipPatchRequestSchema → LoyaltyMembershipResponseSchema
//   GET   /api/v1/loyalty/memberships/[id]/member-number  —                                → LoyaltyMemberNumberResponseSchema
//   POST  /api/v1/loyalty/memberships/[id]/observations   LoyaltyObservationCreateRequestSchema → LoyaltyMembershipResponseSchema (201)
//   POST  /api/v1/loyalty/instruments                     LoyaltyInstrumentCreateRequestSchema → LoyaltyInstrumentResponseSchema (201)
//   PATCH /api/v1/loyalty/instruments/[id]                LoyaltyInstrumentPatchRequestSchema → LoyaltyInstrumentResponseSchema
//
// There is no route that updates or deletes an observation, and none that deletes a member, a
// program, a membership or an instrument. An edited balance is a POST of a new observation.
//
// WHO RECEIVES THESE SHAPES: both b8 users, as peers, with no per-user filtering. A read-scope bearer
// token may call the GETs; every write refuses it (`INSUFFICIENT_SCOPE`, 403) at the handler itself.
// A household member is never a caller.
//
// THE MEMBER NUMBER HAS TWO SCHEMAS, AND ONLY ONE ROUTE MAY USE THE FULL ONE. Every response here
// carries `memberNumberMasked` (`LoyaltyMaskedMemberNumberSchema`), which by construction cannot hold
// more than four characters of the number. The full value exists in exactly one response schema,
// `LoyaltyMemberNumberSchema`, returned by the member-number route to a `browser` session only; a
// bearer token of any scope gets 403 there. Requests may carry a full number (it is how one is set),
// and an error answering such a request must never echo it.
//
// BALANCES ARE DECIMAL TEXT END TO END, never a JSON number, never through a JS number. A whole-number
// unit (`points`, `miles`, `nights`) is digits with no decimal point; `usd` always has exactly two
// decimals in a response. The database stores the same single spelling (a per-unit scale CHECK), so
// a handler emits `balance::text` unchanged. Nothing rounds: excess precision is refused.
//
// DATES are `YYYY-MM-DD` calendar text produced by Postgres (`::text` or `to_char`), never a JS Date,
// so no time zone can move one by a day. TIMESTAMPS are not emitted at all.
//
// STRICT OBJECTS throughout, the gifts precedent: a stray key (`source: 'import'`, `cardAccountId` on
// a create) is exactly the key that must be refused, never carried through.
//
// Layering as gifts.ts: `zod` and sibling modules only. No `next/*`, no `pg`, no `lib/**`.

import { z } from 'zod';
import { apiResponseSchema } from './envelope';
import { UserIdSchema } from './auth';
// A calendar date validated by integer arithmetic, never by the JS date machinery. Reused rather
// than restated: two date validators in one package is the "two definitions of one concept" defect.
import { giftDate as calendarDate } from './gifts';

// ─── Vocabularies ───────────────────────────────────────────────────────────────────────────────
//
// Each list equals the matching CHECK in migrations/1792700000000_loyalty.sql exactly. Adding a
// value is an additive change (BUILD.md §9.2): a consumer keeps a default branch.

/** Every balance unit. `usd` is money (scale 2); the other three are whole numbers. */
export const LOYALTY_UNITS = ['points', 'miles', 'nights', 'usd'] as const;
/** The units whose balances are whole numbers: digits only, no decimal point at all. */
export const LOYALTY_WHOLE_UNITS = ['points', 'miles', 'nights'] as const;
export const LOYALTY_PROGRAM_KINDS = [
  'airline',
  'hotel',
  'card_currency',
  'travel_cash',
  'car',
  'other',
] as const;
export const LOYALTY_INSTRUMENT_KINDS = [
  'free_night',
  'companion_fare',
  'travel_credit',
  'other',
] as const;
/**
 * Where an observation came from. Only `typed` may ever arrive in a request body; `import` is
 * written by the import script, `email` (42c) and `screenshot` (42d) are reserved.
 */
export const LOYALTY_OBSERVATION_SOURCES = ['typed', 'import', 'email', 'screenshot'] as const;
/** Where an instrument came from. Requests never carry it: a route always writes `typed`. */
export const LOYALTY_INSTRUMENT_SOURCES = ['typed', 'import'] as const;
/**
 * The derived state of a linked card's annual benefit (P8-42b). NEVER STORED: computed on every read
 * from the ledger (the most recent unrefunded annual-fee row, read through the gift read path), the
 * membership's instruments and Postgres's CURRENT_DATE. No CHECK mirrors this list, because no
 * column holds it.
 *
 *   no_fee_seen — no posted annual fee on the card (none, or the most recent one was refunded).
 *   awaiting    — fee posted, CURRENT_DATE is on or before expectedBy, nothing received yet.
 *   received    — an instrument of the benefit's kind on this membership, issued (or, when its
 *                 issue date is unknown, recorded) on or after the fee date. Wins over overdue.
 *   overdue     — fee posted, CURRENT_DATE is after expectedBy, nothing received.
 */
export const LOYALTY_FEE_WATCH_STATES = ['no_fee_seen', 'awaiting', 'received', 'overdue'] as const;
/**
 * The benefit window in days. Bounds equal `loyalty_memberships_benefit_window_range` in
 * migrations/1792800000000_loyalty_card_benefit.sql. The default is what the membership PATCH route
 * stores when a benefit arrives without `windowDays`; the column has no DEFAULT (a default would fill
 * rows that describe no benefit), so this constant is the one place the number lives.
 */
export const LOYALTY_BENEFIT_WINDOW_MIN_DAYS = 1;
export const LOYALTY_BENEFIT_WINDOW_MAX_DAYS = 365;
export const LOYALTY_BENEFIT_DEFAULT_WINDOW_DAYS = 45;

export const LoyaltyUnitSchema = z.enum(LOYALTY_UNITS);
export const LoyaltyProgramKindSchema = z.enum(LOYALTY_PROGRAM_KINDS);
export const LoyaltyInstrumentKindSchema = z.enum(LOYALTY_INSTRUMENT_KINDS);
export const LoyaltyObservationSourceSchema = z.enum(LOYALTY_OBSERVATION_SOURCES);
export const LoyaltyInstrumentSourceSchema = z.enum(LOYALTY_INSTRUMENT_SOURCES);
export const LoyaltyFeeWatchStateSchema = z.enum(LOYALTY_FEE_WATCH_STATES);

/**
 * The codes these endpoints define. A SUBSET, NOT A CLOSURE: the boundary's `UNAUTHENTICATED` (401)
 * and the shared `DB_ERROR` can also arrive.
 *
 *   `INVALID_INPUT`            400 — a body or id failed these schemas; a balance not valid for its
 *                                    unit; an as-of more than one day after Postgres's CURRENT_DATE;
 *                                    an instrument whose expiry or use is before its issue (also as
 *                                    stored after a PATCH); an alias that normalises to empty; an
 *                                    unknown member or program named in a membership create. The
 *                                    message never echoes a submitted member number or balance.
 *   `NOT_FOUND`                404 — no such member, program, membership or instrument for the id in
 *                                    the path. One body shape for every route.
 *   `INSUFFICIENT_SCOPE`       403 — a read-scope session attempted a write. Nothing changed.
 *   `BROWSER_SESSION_REQUIRED` 403 — the member-number route was called by anything but a cookie
 *                                    session of kind `browser` (any bearer token, whatever its
 *                                    scope). The body carries no number.
 *   `MEMBERSHIP_EXISTS`        409 — that member already holds that program (one row per pair,
 *                                    decided by the unique constraint, so a lost race is this and
 *                                    never a 500).
 *   `ALIAS_TAKEN`              409 — a program create whose normalised name, or a program PATCH whose
 *                                    alias list, contains an alias another program already holds.
 *                                    Nothing changed: the alias list is replaced atomically or not
 *                                    at all.
 *   `MEMBER_NAME_TAKEN`        409 — another member already has that display name, ignoring case.
 *   `MEMBER_USER_TAKEN`        409 — another member is already linked to that user.
 *   `CARD_ALREADY_LINKED`      409 — a membership PATCH linking a card another membership already
 *                                    holds (one card, one membership; decided by the unique index,
 *                                    so a lost race is this and never a 500). Nothing changed.
 *
 * Linking an account that does not exist, or whose type is not `credit`, is `INVALID_INPUT` (400)
 * with nothing changed. The message never echoes a submitted benefit description.
 */
export const LoyaltyErrorCodeSchema = z.enum([
  'INVALID_INPUT',
  'NOT_FOUND',
  'INSUFFICIENT_SCOPE',
  'BROWSER_SESSION_REQUIRED',
  'MEMBERSHIP_EXISTS',
  'ALIAS_TAKEN',
  'MEMBER_NAME_TAKEN',
  'MEMBER_USER_TAKEN',
  'CARD_ALREADY_LINKED',
]);

// ─── Primitives ─────────────────────────────────────────────────────────────────────────────────

/** Any loyalty table's id (SERIAL), as it reaches a consumer. */
export const LoyaltyIdSchema = z.int().positive();

/**
 * An `[id]` path segment: a positive integer in decimal with no sign, no leading zero and no
 * surrounding space, within int4. Anything else is 400 `INVALID_INPUT`; a well-formed id with no row
 * is 404 `NOT_FOUND`.
 */
export const LoyaltyIdParamSchema = z
  .string()
  .regex(/^[1-9]\d{0,9}$/, 'expected a positive integer id')
  .refine((s) => s.length < 10 || s <= '2147483647', 'id out of range');

/** Counted in characters (code points), as the columns' `char_length` CHECKs count. */
const chars = (s: string) => Array.from(s).length;

/**
 * A human-typed name AS SUBMITTED: not blank, at most `max` characters once trimmed. The handler
 * stores the trimmed form (the columns refuse an untrimmed value). The schema refuses; it does not
 * reshape.
 */
const typedName = (max: number, what: string) =>
  z
    .string()
    .refine((s) => s.trim().length >= 1, `${what} may not be blank`)
    .refine((s) => chars(s.trim()) <= max, `${what} is at most ${max} characters`);

/**
 * A balance AS SUBMITTED. A string, never a JSON number: a number has already been through binary
 * floating point before the handler sees it. Whether it is valid depends on its unit, so the unit
 * rules are applied by the request schema that carries both (see `isBalanceForUnit`).
 */
export const LoyaltyBalanceInputSchema = z.string();

/**
 * The API balance rule for one unit (SPEC.md Conventions, "Units belong to the balance").
 *
 *   whole units — 1 to 12 digits; no sign, no fraction, no thousands separator, no decimal point at
 *                 all (a trailing `.0` is refused too).
 *   usd         — 1 to 12 integer digits, then optionally a decimal point and 1 or 2 digits. A third
 *                 fractional digit is refused, never rounded.
 *
 * No surrounding space, exponent, hex or leading `.`. Thousands separators are an import-only
 * allowance and never reach this rule. Canonicalising (`usd` to exactly two decimals) is the
 * handler's, through the shared parser, before the INSERT.
 */
export function isBalanceForUnit(unit: z.infer<typeof LoyaltyUnitSchema>, text: string): boolean {
  return unit === 'usd' ? /^\d{1,12}(?:\.\d{1,2})?$/.test(text) : /^\d{1,12}$/.test(text);
}

/** A whole-unit balance as emitted: canonical digits, no leading zero, no decimal point. */
export const LoyaltyWholeBalanceSchema = z.string().regex(/^(?:0|[1-9]\d{0,11})$/, 'expected a whole-number balance');
/** A `usd` balance as emitted: canonical, always exactly two decimals. */
export const LoyaltyUsdBalanceSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,11})\.\d{2}$/, 'expected a cash balance with exactly two decimals');

/**
 * THE MASKED MEMBER NUMBER — the only form any response but the member-number route carries.
 *
 * Exactly four bullets (U+2022) followed by the last 4 characters of the stored number when it has 8
 * or more, the last 3 when it has 6 or 7, and nothing when it has 5 or fewer. So at most four
 * characters of the number can ever fit here, and a full number cannot parse against it. A null or
 * empty stored number is emitted as `null`, never as bare bullets.
 */
export const LOYALTY_MASK_BULLETS = '••••';
export const LoyaltyMaskedMemberNumberSchema = z
  .string()
  .refine(
    (s) => s.startsWith(LOYALTY_MASK_BULLETS) && [0, 3, 4].includes(chars(s) - 4),
    'expected a masked member number'
  );

/**
 * A member number AS SUBMITTED to set or change it: at most 64 characters once trimmed. Blank (after
 * trimming) and `null` both mean "no number" and are stored as NULL, never as ''. Error messages
 * never echo the value.
 */
export const LoyaltyMemberNumberInputSchema = z
  .string()
  .refine((s) => chars(s.trim()) <= 64, 'a member number is at most 64 characters');

/**
 * An alias AS SUBMITTED. The handler normalises it by the one label-normalisation function and
 * refuses one that normalises to empty (400). At most 200 characters as submitted.
 */
export const LoyaltyAliasInputSchema = z
  .string()
  .refine((s) => chars(s) <= 200, 'an alias is at most 200 characters');

/**
 * A benefit window in days: an integer from 1 to 365. A JSON integer only — `1.5`, `'30'` and `-1`
 * are refused, never coerced or rounded.
 */
export const LoyaltyBenefitWindowDaysSchema = z
  .int()
  .min(LOYALTY_BENEFIT_WINDOW_MIN_DAYS)
  .max(LOYALTY_BENEFIT_WINDOW_MAX_DAYS);

/**
 * A card's annual benefit AS SUBMITTED on the membership PATCH. `kind` is one of the four instrument
 * kinds (the state matches an instrument of exactly this kind). `description` is not blank and at
 * most 200 characters once trimmed; the handler stores it trimmed. `windowDays` absent means the
 * handler stores `LOYALTY_BENEFIT_DEFAULT_WINDOW_DAYS`. Strict: a stray key is refused.
 */
export const LoyaltyBenefitInputSchema = z.strictObject({
  kind: LoyaltyInstrumentKindSchema,
  description: typedName(200, 'a benefit description'),
  windowDays: LoyaltyBenefitWindowDaysSchema.optional(),
});

// ─── Requests ───────────────────────────────────────────────────────────────────────────────────

/** `POST /api/v1/loyalty/members`. `userId` absent or null: this person is not a b8 user. */
export const LoyaltyMemberCreateRequestSchema = z.strictObject({
  displayName: typedName(100, 'a display name'),
  userId: UserIdSchema.nullable().optional(),
});

/** `PATCH /api/v1/loyalty/members/[id]`. At least one field; `userId: null` unlinks. */
export const LoyaltyMemberPatchRequestSchema = z
  .strictObject({
    displayName: typedName(100, 'a display name').optional(),
    userId: UserIdSchema.nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');

/**
 * `POST /api/v1/loyalty/programs`. The handler stores the program and, as its first alias, the
 * normalised name; if another program already holds that alias the answer is 409 `ALIAS_TAKEN` and
 * nothing is created.
 */
export const LoyaltyProgramCreateRequestSchema = z.strictObject({
  name: typedName(200, 'a program name'),
  kind: LoyaltyProgramKindSchema,
  defaultUnit: LoyaltyUnitSchema,
});

/**
 * `PATCH /api/v1/loyalty/programs/[id]`. At least one field.
 *
 * `aliases`, when present, is the COMPLETE new list, a replacement and not an addition, with at least
 * one entry. The handler normalises each, collapses duplicates, and applies the whole list in one
 * transaction: an alias held by another program answers 409 `ALIAS_TAKEN` and leaves the program's
 * aliases exactly as they were. Absent means the aliases are unchanged.
 */
export const LoyaltyProgramPatchRequestSchema = z
  .strictObject({
    name: typedName(200, 'a program name').optional(),
    kind: LoyaltyProgramKindSchema.optional(),
    defaultUnit: LoyaltyUnitSchema.optional(),
    aliases: z
      .array(LoyaltyAliasInputSchema)
      .min(1, 'a program needs at least one alias')
      .max(100, 'a program has at most 100 aliases')
      .optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');

/**
 * `POST /api/v1/loyalty/memberships`. An unknown member or program is refused and nothing is
 * created; a pair that already exists is 409 `MEMBERSHIP_EXISTS`. `cardAccountId` and `benefit` are
 * not accepted here (strict object): a membership is created unlinked, and a card and its benefit
 * are set afterwards by the membership PATCH, the one place their rules are checked.
 */
export const LoyaltyMembershipCreateRequestSchema = z.strictObject({
  memberId: LoyaltyIdSchema,
  programId: LoyaltyIdSchema,
  memberNumber: LoyaltyMemberNumberInputSchema.nullable().optional(),
  tier: typedName(100, 'a tier').nullable().optional(),
});

/**
 * `PATCH /api/v1/loyalty/memberships/[id]`. At least one field; `null` clears it.
 *
 * `cardAccountId` links the credit card that earns into this membership; `null` unlinks. The handler
 * refuses an unknown account or one whose type is not `credit` (400 `INVALID_INPUT`) and a card
 * another membership holds (409 `CARD_ALREADY_LINKED`). Re-linking the same card is a no-op 200.
 * Unlinking sets only the link to null: instruments and the benefit stay.
 *
 * `benefit` describes the card's annual benefit; `null` clears all three of its columns. Accepted on
 * an unlinked membership too (it is inert until a card is linked).
 */
export const LoyaltyMembershipPatchRequestSchema = z
  .strictObject({
    memberNumber: LoyaltyMemberNumberInputSchema.nullable().optional(),
    tier: typedName(100, 'a tier').nullable().optional(),
    cardAccountId: z.string().min(1, 'a card account id may not be empty').nullable().optional(),
    benefit: LoyaltyBenefitInputSchema.nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');

/**
 * `POST /api/v1/loyalty/memberships/[id]/observations` — a new reading; the only way a balance
 * changes. Appends one row with source `typed`.
 *
 * `asOf` is required: the page sends the browser's local calendar date. More than one day after
 * Postgres's CURRENT_DATE is 400, a check only the handler can make. `source` may be omitted or be
 * exactly `typed`; any other value is refused, so a client can never claim `import`, `email` or
 * `screenshot`.
 */
export const LoyaltyObservationCreateRequestSchema = z
  .strictObject({
    asOf: calendarDate,
    balance: LoyaltyBalanceInputSchema,
    unit: LoyaltyUnitSchema,
    source: z.literal('typed').optional(),
  })
  .refine((b) => isBalanceForUnit(b.unit, b.balance), {
    message: 'the balance is not valid for its unit',
    path: ['balance'],
  });

const instrumentDateOrder = (b: {
  issuedOn?: string | null;
  expiresOn?: string | null;
  usedOn?: string | null;
}) =>
  !(b.issuedOn != null && b.expiresOn != null && b.expiresOn < b.issuedOn) &&
  !(b.issuedOn != null && b.usedOn != null && b.usedOn < b.issuedOn);

/**
 * `POST /api/v1/loyalty/instruments`. Source is not in the body: a route always writes `typed`.
 * Every date may be null or absent (unknown). Expiry or use before issue is refused when both are
 * set; comparison is on the `YYYY-MM-DD` strings, which order exactly as the dates do.
 */
export const LoyaltyInstrumentCreateRequestSchema = z
  .strictObject({
    membershipId: LoyaltyIdSchema,
    kind: LoyaltyInstrumentKindSchema,
    description: typedName(200, 'a description'),
    issuedOn: calendarDate.nullable().optional(),
    expiresOn: calendarDate.nullable().optional(),
    usedOn: calendarDate.nullable().optional(),
  })
  .refine(instrumentDateOrder, {
    message: 'an instrument cannot expire or be used before it is issued',
    path: ['expiresOn'],
  });

/**
 * `PATCH /api/v1/loyalty/instruments/[id]`. At least one field; `null` clears a date. The order rule
 * is checked here for the dates in the body and by the handler against the stored row (the table's
 * CHECK backs both; its violation is 400, never 500).
 */
export const LoyaltyInstrumentPatchRequestSchema = z
  .strictObject({
    kind: LoyaltyInstrumentKindSchema.optional(),
    description: typedName(200, 'a description').optional(),
    issuedOn: calendarDate.nullable().optional(),
    expiresOn: calendarDate.nullable().optional(),
    usedOn: calendarDate.nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change')
  .refine(instrumentDateOrder, {
    message: 'an instrument cannot expire or be used before it is issued',
    path: ['expiresOn'],
  });

// ─── Responses ──────────────────────────────────────────────────────────────────────────────────

/** A household member. `userId` null: not a b8 user. */
export const LoyaltyMemberSchema = z.strictObject({
  id: LoyaltyIdSchema,
  displayName: z.string().min(1),
  userId: UserIdSchema.nullable(),
});

/**
 * A catalog program with its aliases (stored, normalised), ordered by alias ascending so a list never
 * depends on insertion order. Never empty for a program created through the routes or the seed.
 */
export const LoyaltyProgramSchema = z.strictObject({
  id: LoyaltyIdSchema,
  name: z.string().min(1),
  kind: LoyaltyProgramKindSchema,
  defaultUnit: LoyaltyUnitSchema,
  aliases: z.array(z.string().min(1)),
});

/** A card's annual benefit as stored (the three `benefit_*` columns). `windowDays` is always set. */
export const LoyaltyBenefitSchema = z.strictObject({
  kind: LoyaltyInstrumentKindSchema,
  description: z.string().min(1),
  windowDays: LoyaltyBenefitWindowDaysSchema,
});

/**
 * THE FEE WATCH — derived on every read, never stored (see `LOYALTY_FEE_WATCH_STATES`).
 *
 *   feeDate    — the POSTED date (never the authorized date) of the card's most recent annual-fee
 *                row, if that row was not refunded; null when there is none. Postgres `::text`.
 *   expectedBy — feeDate plus the benefit window in calendar days, by Postgres date arithmetic.
 *                Null whenever there is no fee or no benefit to wait for.
 *   state      — one of the four states when a benefit is described; null when none is.
 *
 * Consistency, enforced here so a producer cannot emit a state that contradicts its dates:
 * `state` null implies `expectedBy` null (`feeDate` may be either: a linked card with no benefit
 * still shows its fee date). `no_fee_seen` implies both dates null. `awaiting`, `received` and
 * `overdue` imply both dates present.
 *
 * THE FEE AMOUNT IS NEVER EMITTED. There is deliberately no amount field, and the strict object
 * refuses one: no figure is needed to say whether the benefit arrived, and a ledger amount on a
 * loyalty surface would be a new place for a money figure to leak (SPEC.md Open question 9).
 *
 * The answer is identical for every viewer: a ledger row held by an unrevealed gift is never a fee
 * for anyone, giver included. That is why the routes returning a membership are `numeric-only` in
 * the gift surface registry (they carry a date derived from a ledger row, never its text).
 */
export const LoyaltyFeeWatchSchema = z
  .strictObject({
    feeDate: calendarDate.nullable(),
    expectedBy: calendarDate.nullable(),
    state: LoyaltyFeeWatchStateSchema.nullable(),
  })
  .refine((w) => w.state !== null || w.expectedBy === null, {
    message: 'with no state there is no expected-by date',
    path: ['expectedBy'],
  })
  .refine((w) => w.state !== 'no_fee_seen' || (w.feeDate === null && w.expectedBy === null), {
    message: 'no_fee_seen carries no dates',
    path: ['feeDate'],
  })
  .refine(
    (w) =>
      w.state === null || w.state === 'no_fee_seen' || (w.feeDate !== null && w.expectedBy !== null),
    { message: 'awaiting, received and overdue carry both dates', path: ['feeDate'] }
  );

/**
 * One credit account a membership may be linked to — the `/travel` link picker's choices. Only
 * accounts whose type is `credit`. `name` is the account's display name as stored.
 */
export const LoyaltyCardAccountSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
});

/**
 * One membership as every response but the member-number route shows it.
 *
 * `memberNumberMasked` is the ONLY number field, and it is masked (null when no number is stored).
 *
 * `balance`, `unit`, `asOf` and `source` describe the CURRENT observation — the one with the greatest
 * as-of date, ties by latest recorded time, then highest id, chosen by the shared reducer in
 * apps/web/lib/domain/observations.ts and never by arrival. All four are null together when the
 * membership has no observation (rendered "—", never 0), and all four are present together
 * otherwise. A zero balance is a reading and is `"0"` (or `"0.00"` for usd), never null.
 *
 * THE CARD (P8-42b). `cardAccountId` and `cardAccountName` are the linked credit account, null
 * together when no card is linked. `benefit` is the described annual benefit, or null; it is kept
 * across an unlink, so it may be present with no card. `feeWatch` is null exactly when no card is
 * linked, and otherwise always an object (all three fields null for a linked card with no benefit
 * and no fee). When `feeWatch` is present, its `state` is null exactly when `benefit` is null: there
 * is a state only when there is something to wait for.
 */
export const LoyaltyMembershipSchema = z
  .strictObject({
    id: LoyaltyIdSchema,
    memberId: LoyaltyIdSchema,
    memberDisplayName: z.string().min(1),
    programId: LoyaltyIdSchema,
    memberNumberMasked: LoyaltyMaskedMemberNumberSchema.nullable(),
    tier: z.string().min(1).nullable(),
    balance: z.string().nullable(),
    unit: LoyaltyUnitSchema.nullable(),
    asOf: calendarDate.nullable(),
    source: LoyaltyObservationSourceSchema.nullable(),
    cardAccountId: z.string().min(1).nullable(),
    cardAccountName: z.string().nullable(),
    benefit: LoyaltyBenefitSchema.nullable(),
    feeWatch: LoyaltyFeeWatchSchema.nullable(),
  })
  .refine((m) => (m.cardAccountId === null) === (m.cardAccountName === null), {
    message: 'cardAccountId and cardAccountName are null together or present together',
    path: ['cardAccountName'],
  })
  .refine((m) => (m.cardAccountId === null) === (m.feeWatch === null), {
    message: 'feeWatch is null exactly when no card is linked',
    path: ['feeWatch'],
  })
  .refine((m) => m.feeWatch === null || (m.feeWatch.state === null) === (m.benefit === null), {
    message: 'a linked card has a state exactly when a benefit is described',
    path: ['feeWatch'],
  })
  .refine(
    (m) =>
      [m.balance, m.unit, m.asOf, m.source].every((v) => v === null) ||
      [m.balance, m.unit, m.asOf, m.source].every((v) => v !== null),
    { message: 'balance, unit, asOf and source are null together or present together', path: ['balance'] }
  )
  .refine(
    (m) =>
      m.balance === null ||
      (m.unit === 'usd'
        ? LoyaltyUsdBalanceSchema.safeParse(m.balance).success
        : LoyaltyWholeBalanceSchema.safeParse(m.balance).success),
    { message: 'the balance is not in the canonical form for its unit', path: ['balance'] }
  );

/**
 * One program card on /travel: a program with at least one membership, and its memberships (one
 * line each), ordered by member display name then membership id. A program with no membership has
 * no card; it is still in the catalog list.
 */
export const LoyaltyProgramCardSchema = z.strictObject({
  programId: LoyaltyIdSchema,
  programName: z.string().min(1),
  programKind: LoyaltyProgramKindSchema,
  memberships: z.array(LoyaltyMembershipSchema).min(1),
});

/** An instrument. Every date null = unknown. */
export const LoyaltyInstrumentSchema = z.strictObject({
  id: LoyaltyIdSchema,
  membershipId: LoyaltyIdSchema,
  kind: LoyaltyInstrumentKindSchema,
  description: z.string().min(1),
  issuedOn: calendarDate.nullable(),
  expiresOn: calendarDate.nullable(),
  usedOn: calendarDate.nullable(),
  source: LoyaltyInstrumentSourceSchema,
});

/**
 * `GET /api/v1/loyalty` — the whole picture, masked numbers only.
 *
 *   members     — every household member, by display name then id.
 *   programs    — the whole catalog with aliases, by name then id.
 *   cards       — one per program with at least one membership, by program name then id.
 *   instruments — unused before used, then expiry ascending with null expiry last, then id
 *                 ascending (the page's order, decided by the server).
 *   cardAccounts — every account whose type is `credit`, linked or not, by name then id: the
 *                 choices for "Link a card". Never an account of another type.
 */
export const LoyaltyOverviewSchema = z.strictObject({
  members: z.array(LoyaltyMemberSchema),
  programs: z.array(LoyaltyProgramSchema),
  cards: z.array(LoyaltyProgramCardSchema),
  instruments: z.array(LoyaltyInstrumentSchema),
  cardAccounts: z.array(LoyaltyCardAccountSchema),
});

/**
 * THE FULL MEMBER NUMBER — `GET /api/v1/loyalty/memberships/[id]/member-number` only, to a `browser`
 * session only, fetched by the copy action on click and never on page load. `memberNumber` is null
 * when none is stored. No other schema in this file has a field that can hold the full value.
 */
export const LoyaltyMemberNumberSchema = z.strictObject({
  membershipId: LoyaltyIdSchema,
  memberNumber: z.string().min(1).nullable(),
});

export const LoyaltyOverviewResponseSchema = apiResponseSchema(LoyaltyOverviewSchema);
/** `POST …/members`, `PATCH …/members/[id]`. */
export const LoyaltyMemberResponseSchema = apiResponseSchema(LoyaltyMemberSchema);
/** `POST …/programs`, `PATCH …/programs/[id]`. */
export const LoyaltyProgramResponseSchema = apiResponseSchema(LoyaltyProgramSchema);
/** `POST …/memberships`, `PATCH …/memberships/[id]`, and `POST …/memberships/[id]/observations` (the refreshed view). */
export const LoyaltyMembershipResponseSchema = apiResponseSchema(LoyaltyMembershipSchema);
/** `GET …/memberships/[id]/member-number`. */
export const LoyaltyMemberNumberResponseSchema = apiResponseSchema(LoyaltyMemberNumberSchema);
/** `POST …/instruments`, `PATCH …/instruments/[id]`. */
export const LoyaltyInstrumentResponseSchema = apiResponseSchema(LoyaltyInstrumentSchema);

export type LoyaltyUnit = z.infer<typeof LoyaltyUnitSchema>;
export type LoyaltyProgramKind = z.infer<typeof LoyaltyProgramKindSchema>;
export type LoyaltyInstrumentKind = z.infer<typeof LoyaltyInstrumentKindSchema>;
export type LoyaltyObservationSource = z.infer<typeof LoyaltyObservationSourceSchema>;
export type LoyaltyInstrumentSource = z.infer<typeof LoyaltyInstrumentSourceSchema>;
export type LoyaltyErrorCode = z.infer<typeof LoyaltyErrorCodeSchema>;
export type LoyaltyFeeWatchState = z.infer<typeof LoyaltyFeeWatchStateSchema>;
export type LoyaltyBenefitInput = z.infer<typeof LoyaltyBenefitInputSchema>;
export type LoyaltyBenefit = z.infer<typeof LoyaltyBenefitSchema>;
export type LoyaltyFeeWatch = z.infer<typeof LoyaltyFeeWatchSchema>;
export type LoyaltyCardAccount = z.infer<typeof LoyaltyCardAccountSchema>;
export type LoyaltyMemberCreateRequest = z.infer<typeof LoyaltyMemberCreateRequestSchema>;
export type LoyaltyMemberPatchRequest = z.infer<typeof LoyaltyMemberPatchRequestSchema>;
export type LoyaltyProgramCreateRequest = z.infer<typeof LoyaltyProgramCreateRequestSchema>;
export type LoyaltyProgramPatchRequest = z.infer<typeof LoyaltyProgramPatchRequestSchema>;
export type LoyaltyMembershipCreateRequest = z.infer<typeof LoyaltyMembershipCreateRequestSchema>;
export type LoyaltyMembershipPatchRequest = z.infer<typeof LoyaltyMembershipPatchRequestSchema>;
export type LoyaltyObservationCreateRequest = z.infer<typeof LoyaltyObservationCreateRequestSchema>;
export type LoyaltyInstrumentCreateRequest = z.infer<typeof LoyaltyInstrumentCreateRequestSchema>;
export type LoyaltyInstrumentPatchRequest = z.infer<typeof LoyaltyInstrumentPatchRequestSchema>;
export type LoyaltyMember = z.infer<typeof LoyaltyMemberSchema>;
export type LoyaltyProgram = z.infer<typeof LoyaltyProgramSchema>;
export type LoyaltyMembership = z.infer<typeof LoyaltyMembershipSchema>;
export type LoyaltyProgramCard = z.infer<typeof LoyaltyProgramCardSchema>;
export type LoyaltyInstrument = z.infer<typeof LoyaltyInstrumentSchema>;
export type LoyaltyOverview = z.infer<typeof LoyaltyOverviewSchema>;
export type LoyaltyMemberNumber = z.infer<typeof LoyaltyMemberNumberSchema>;
