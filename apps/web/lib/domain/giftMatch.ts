// Gifts (P7-41b) — every decision about WHICH ROW IS A GIFT and WHEN SOMETHING IS DUE, as pure
// functions. The I/O lives in `lib/giftStore.ts`; this file never touches a database, a clock or
// the network, so each rule below is pinned by `lib/giftMatch.test.ts` without one.
//
// ─── MONEY IS COMPARED AS DECIMAL TEXT, NEVER AS A NUMBER ─────────────────────────────────────
//
// The matching rule is exact equality to the cent. Every amount here is the decimal string Postgres
// printed (`amount::text`) or the one the giver typed, and the comparison is on those digits. A
// binary float cannot represent most cent values at all, and the obvious repairs — multiply by a
// hundred, round, compare — are wrong for ordinary prices: the product for a figure ending in .15
// or .35 is not an integer in binary floating point, so two equal prices can compare unequal.
// `cents` below reads the digits into a BigInt by string surgery, which is exact for any NUMERIC
// value and involves no multiplication at all.
//
// ─── DATES ARE CALENDAR TEXT, AND `today` IS AN ARGUMENT ──────────────────────────────────────
//
// A gift's window and reveal date are `YYYY-MM-DD` on the server's calendar, the one Postgres's
// `CURRENT_DATE` reads. They are compared as strings (which order exactly as the dates do) and
// shifted by whole days with integer civil-calendar arithmetic. They are never handed to the JS
// date machinery, which parses a bare `YYYY-MM-DD` as UTC midnight and moves it a day for half the
// world. Nothing here reads a clock: every function that asks "is it due" takes `today`, and the
// callers read it from Postgres in the same statement that reads the gift.

import { GiftCreateRequestSchema, type GiftState } from '@b8/contracts/gifts';

/**
 * How long after a window closes the giver is told nothing matched (SPEC.md Open question 4).
 *
 * `lib/domain/digestWindow.ts` records the measurement: a posted row lands one to five days after
 * the date it carries. Telling the giver on the day after the window ends would cry wolf for every
 * purchase still in flight, so the notice waits out the same five days, and matching stays live
 * until then.
 */
export const GIFT_NOTICE_GRACE_DAYS = 5;

// ─── Decimal amounts ────────────────────────────────────────────────────────────────────────────

/**
 * A decimal string as a whole number of cents, or null when the string is not a plain decimal with
 * at most two fraction digits. `-12.5` is `-1250n`; `12.345` is null (a third decimal is not a
 * cent value, and rounding it would be the tolerance the owner declined).
 */
export function cents(value: string): bigint | null {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!m) return null;
  const fraction = (m[3] ?? '').padEnd(2, '0');
  const magnitude = BigInt(`${m[2]}${fraction}`);
  return m[1] === '-' ? -magnitude : magnitude;
}

/** Whole cents back to a two-decimal string, the spelling Postgres prints for NUMERIC(12,2). */
export function fromCents(value: bigint): string {
  const negative = value < BigInt(0);
  const digits = (negative ? -value : value).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** Exact decimal equality: `12.5`, `12.50` and `012.50` are the same price; `12.51` is not. */
export function sameAmount(a: string, b: string): boolean {
  const x = cents(a);
  const y = cents(b);
  return x !== null && y !== null && x === y;
}

// ─── Calendar dates ─────────────────────────────────────────────────────────────────────────────

/** Days since 1970-01-01 for a proleptic Gregorian date — Howard Hinnant's `days_from_civil`. */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The inverse of `daysFromCivil`. */
function civilFromDays(z: number): [number, number, number] {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

/** `YYYY-MM-DD` plus `n` whole days, on the calendar alone. `2028-02-28` + 1 is `2028-02-29`. */
export function addDays(date: string, n: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError('addDays: expected a YYYY-MM-DD date');
  const [y, mo, d] = civilFromDays(daysFromCivil(Number(m[1]), Number(m[2]), Number(m[3])) + n);
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ─── Criteria ───────────────────────────────────────────────────────────────────────────────────

/** A gift as matching needs it. Every criterion that is null means ANY — never zero, never ''. */
export interface GiftCriteria {
  id: number;
  /**
   * When the gift was created, as fixed-width UTC text (`YYYY-MM-DDTHH:MM:SS.ffffff`), so that
   * string order IS time order. Only ever used to decide which of two gifts is older.
   */
  createdAt: string;
  state: GiftState;
  amount: string | null;
  merchant: string | null;
  accountId: string | null;
  windowStart: string;
  windowEnd: string;
}

/** A ledger row as matching needs it. */
export interface CandidateRow {
  /** `transactions.id` — the key a gift links by, never the Plaid id. */
  id: number;
  plaidTransactionId: string;
  accountId: string;
  /** The posted date. */
  date: string;
  /** Plaid's `authorized_date` — the day of the purchase — or null when Plaid gives none. */
  authorizedDate: string | null;
  /** `amount::text`, signed the Plaid way: positive is money out. */
  amount: string;
  name: string | null;
  merchantName: string | null;
  pending: boolean;
  /** Already held by some gift. A row is held by at most one. */
  linked: boolean;
}

/**
 * The merchant criterion against a row: a case-insensitive LITERAL substring of the row's merchant,
 * or of its raw name when Plaid gave no merchant.
 *
 * `includes`, never a pattern. A criterion of `100%` or `a_b` or `.*` is those characters, so it
 * cannot match everything and cannot throw — the bug a `LIKE` or a `RegExp` built from the
 * criterion would carry. Trimmed here as well as at storage, so a criterion that somehow arrived
 * untrimmed still means what the giver typed; one that is blank once trimmed matches nothing.
 */
export function merchantMatches(criterion: string, merchantName: string | null, name: string | null): boolean {
  const needle = criterion.trim().toLowerCase();
  if (needle.length < 3) return false;
  const haystack = merchantName !== null && merchantName.trim() !== '' ? merchantName : name;
  if (haystack === null) return false;
  return haystack.toLowerCase().includes(needle);
}

/**
 * Whether `row` satisfies `gift`'s criteria — the matching rule of SPEC.md, conjunct by conjunct,
 * with the window taking the posted or the authorized date (SPEC.md Amendments, 2026-10-21).
 *
 * Not checked here, because the caller's query is what knows it: that the row was FIRST INSERTED by
 * the sync running now. `lib/giftStore.ts` hands this function only those rows.
 */
export function isCandidate(gift: GiftCriteria, row: CandidateRow): boolean {
  // Only rows the Plaid sync stores. Hand-entered (`manual_`), imported (`csv_`) and cash rows are
  // the owner's own entries, and a gift is a bank transaction marked in advance.
  if (row.plaidTransactionId.startsWith('manual_') || row.plaidTransactionId.startsWith('csv_')) return false;
  if (row.pending) return false;
  if (row.linked) return false;
  // Money OUT only. A refund of the same magnitude is negative and a zero row is neither; the gift's
  // amount is a positive magnitude and is never negated to meet one.
  const rowCents = cents(row.amount);
  if (rowCents === null || rowCents <= BigInt(0)) return false;
  // Inclusive at both ends, on the calendar strings. EITHER date may fall in the window: the giver
  // gives the day they bought it, which is the authorized date, while a card posts a day or three
  // later. Checking the posted date alone missed a one-day window on its first real use (a purchase
  // authorized on the window's day, posted the next) and left the row unmasked.
  const inWindow = (d: string) => d >= gift.windowStart && d <= gift.windowEnd;
  if (!inWindow(row.date) && !(row.authorizedDate !== null && inWindow(row.authorizedDate))) return false;
  if (gift.accountId !== null && gift.accountId !== row.accountId) return false;
  if (gift.amount !== null && !sameAmount(gift.amount, row.amount)) return false;
  if (gift.merchant !== null && !merchantMatches(gift.merchant, row.merchantName, row.name)) return false;
  // A gift with neither criterion is refused at creation and by a CHECK; one that reached here
  // anyway matches nothing rather than every outflow in the window.
  return gift.amount !== null || gift.merchant !== null;
}

// ─── Decisions ──────────────────────────────────────────────────────────────────────────────────

export type GiftOutcome =
  | { kind: 'none' }
  | { kind: 'match'; transactionId: number }
  | { kind: 'choose'; transactionIds: number[] };

/**
 * What a set of candidate ids means. One is the gift. Several are NOT auto-picked: the giver
 * chooses, and until then every one is held (SPEC.md Open question 1). Ids come back ascending, so
 * "which is first" never depends on arrival order.
 */
export function outcomeFor(transactionIds: readonly number[]): GiftOutcome {
  const ids = [...new Set(transactionIds)].sort((a, b) => a - b);
  if (ids.length === 0) return { kind: 'none' };
  if (ids.length === 1) return { kind: 'match', transactionId: ids[0] };
  return { kind: 'choose', transactionIds: ids };
}

/** Older gift first, then lower id — the order competition between gifts is settled in. */
function byAge(a: GiftCriteria, b: GiftCriteria): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id - b.id;
}

/**
 * Which of `rows` each gift claims, in ONE sync pass.
 *
 * ONE ROW, ONE GIFT, AND THE OLDER GIFT WINS. Gifts are visited oldest first whatever order they are
 * passed in, and a row an older gift claimed is gone for every younger one — so the outcome does not
 * depend on how the caller happened to list them. Only `awaiting` and `choose` gifts take part: a
 * `matched` gift is final, and later rows that satisfy its criteria are ordinary.
 *
 * Returns only gifts that claimed at least one row. A `choose` gift's claims are ADDITIONS to the
 * candidates it already holds; the caller merges them.
 */
export function assignCandidates(
  gifts: readonly GiftCriteria[],
  rows: readonly CandidateRow[],
): Map<number, number[]> {
  const claimed = new Set<number>();
  const out = new Map<number, number[]>();
  for (const gift of [...gifts].sort(byAge)) {
    if (gift.state !== 'awaiting' && gift.state !== 'choose') continue;
    const mine = rows
      .filter((r) => !claimed.has(r.id) && isCandidate(gift, r))
      .map((r) => r.id)
      .sort((a, b) => a - b);
    if (mine.length === 0) continue;
    for (const id of mine) claimed.add(id);
    out.set(gift.id, mine);
  }
  return out;
}

/**
 * The state a gift moves to after a pass that gave it `added` new candidates on top of the `held`
 * ones it already had. An `awaiting` gift with one candidate is matched; with several, or a `choose`
 * gift with any, it is (still) waiting for the giver.
 */
export function stateAfterClaim(state: GiftState, held: number, added: number): GiftState {
  if (added === 0) return state;
  if (state === 'awaiting') return held + added === 1 ? 'matched' : 'choose';
  return 'choose';
}

// ─── Time ───────────────────────────────────────────────────────────────────────────────────────

/** Revealed from the reveal date ON, inclusive: `revealDate <= today`. */
export function isRevealed(revealDate: string, today: string): boolean {
  return revealDate <= today;
}

/** A gift as the daily sweep reads it. */
export interface SweepGift {
  state: GiftState;
  windowEnd: string;
  revealDate: string;
  /** Null means the giver has not been told. */
  noticeAt: string | null;
}

/**
 * Whether the window-end notice is due: still unresolved (`awaiting` or `choose`), not yet told,
 * and today strictly later than window end plus the grace days. On window end plus five days
 * exactly it is not yet due; on plus six it is.
 */
export function noticeDue(gift: SweepGift, today: string): boolean {
  if (gift.state !== 'awaiting' && gift.state !== 'choose') return false;
  if (gift.noticeAt !== null) return false;
  return today > addDays(gift.windowEnd, GIFT_NOTICE_GRACE_DAYS);
}

/**
 * What the daily sweep does with one gift.
 *
 *   `expire` — still `awaiting` or `choose` on or after its reveal date. Every candidate is restored
 *              to its prior category and released, the gift becomes `unmatched`, and the giver is
 *              told once (if not told already). Leaving candidates filed and masked past the reveal
 *              would hold unrelated rows in the gift category forever.
 *   `notice` — the window-end notice is due (`noticeDue`).
 *   `none`   — nothing to do.
 */
export function sweepDecision(gift: SweepGift, today: string): 'expire' | 'notice' | 'none' {
  const unresolved = gift.state === 'awaiting' || gift.state === 'choose';
  if (unresolved && isRevealed(gift.revealDate, today)) return 'expire';
  if (noticeDue(gift, today)) return 'notice';
  return 'none';
}

// ─── Creation ───────────────────────────────────────────────────────────────────────────────────

/** A create request after validation: criteria in their stored spelling, null meaning ANY. */
export interface ValidGiftRequest {
  recipientUserId: number | null;
  amount: string | null;
  /** Trimmed — the column refuses an untrimmed value. */
  merchant: string | null;
  accountId: string | null;
  windowStart: string;
  windowEnd: string;
  revealDate: string;
}

/**
 * The body of `POST /api/v1/gifts`, checked as far as it can be without a database.
 *
 * The contract schema says what a request may look like; the one rule it cannot see is that the
 * giver is not the recipient, because only the handler knows who is asking. Messages are generic
 * on purpose: a refusal never echoes a submitted criterion back (SPEC.md G3), since the criterion
 * is the secret the feature exists to keep.
 *
 * `undefined` and `null` both mean ANY and both come out as `null`; neither is ever turned into
 * `0` or `''`.
 */
export function validateGiftRequest(
  body: unknown,
  giverUserId: number,
): { ok: true; value: ValidGiftRequest } | { ok: false; message: string } {
  const parsed = GiftCreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, message: 'The gift could not be created: one or more fields are not valid.' };
  }
  const g = parsed.data;
  if (g.recipientUserId !== undefined && g.recipientUserId === giverUserId) {
    return { ok: false, message: 'A gift is for the other person, not for yourself.' };
  }
  const merchant = g.merchant === undefined || g.merchant === null ? null : g.merchant.trim();
  return {
    ok: true,
    value: {
      recipientUserId: g.recipientUserId ?? null,
      amount: g.amount ?? null,
      merchant,
      accountId: g.accountId ?? null,
      windowStart: g.windowStart,
      windowEnd: g.windowEnd,
      revealDate: g.revealDate,
    },
  };
}

// ─── Attaching a row that is already in the ledger (P7-41c) ────────────────────────────────────
//
// The sync can only claim a row the moment it first inserts it. A row that was already stored when
// its gift was made, or that missed the window, is attached by the giver instead: they ask for the
// rows that could be this gift, and name one. What follows is every pure decision that takes.

/**
 * How far before the gift's creation the candidate list reaches (SPEC.md Open question 1, the
 * owner's answer). The failure being fixed is "the row was already there, or dated just before,
 * when I made the gift"; a week of grace covers a purchase bought a few days before the giver
 * thought to mark it, and anchoring on creation rather than on today means a gift that has waited
 * a month does not lose the rows it was made for.
 */
export const GIFT_ATTACH_LOOKBACK_DAYS = 7;

/**
 * The most rows the candidate list carries, newest first. The same number as the contract's
 * `GiftCandidateListSchema` cap; a store that returned more would fail that schema, not quietly
 * send a longer page.
 */
export const GIFT_ATTACH_LIST_CAP = 50;

/** A ledger row as attaching needs it: what matching needs, plus whether it is half of a transfer. */
export interface AttachRow extends CandidateRow {
  /** The row has a `transfer_group_id` — it is one side of a transfer pair. */
  inTransferGroup: boolean;
}

/** A window no calendar date falls outside of: `isCandidate` with it is `isCandidate` without a window. */
const ANY_DAY = { windowStart: '0001-01-01', windowEnd: '9999-12-31' } as const;

/**
 * Whether the giver may attach `row` to `gift`: `isCandidate`'s rule with the window taken away,
 * and a transfer-pair member refused.
 *
 * NOT A SECOND DEFINITION. It calls `isCandidate` itself with a window that holds every date, so the
 * amount, merchant, account, money-out, Plaid-row, pending and already-linked conjuncts are the
 * matcher's own, and a fix to one of them reaches attach without anyone remembering to copy it.
 * The window is exactly what the giver is overriding: they are saying "this row, whatever day it
 * carries, is the gift".
 *
 * The transfer refusal is the one rule attach adds (SPEC.md Open question 6). Moving one side of a
 * transfer pair into the gift category would break the pair, and the sync never meets the case
 * because a fresh row is never in a group yet. Fail closed.
 */
export function isAttachCandidate(gift: GiftCriteria, row: AttachRow): boolean {
  if (row.inTransferGroup) return false;
  return isCandidate({ ...gift, ...ANY_DAY }, row);
}

/**
 * Whether a gift can still take a row: unresolved (`awaiting` or `choose`) and not yet revealed.
 *
 * Strictly before the reveal date, the exact negation of `isRevealed`: on the reveal date itself the
 * gift refuses, even while it still says `awaiting` because the daily sweep has not run yet. The
 * callers read `today` from Postgres in the statement that locks the gift, as the sweep does.
 */
export function acceptsAttach(state: GiftState, revealDate: string, today: string): boolean {
  if (state !== 'awaiting' && state !== 'choose') return false;
  return !isRevealed(revealDate, today);
}

/**
 * The oldest posted date the candidate list reaches: the gift's creation date (Postgres's
 * calendar) minus `days`. Inclusive — a row dated on the floor is listed, one dated the day before
 * is not. Calendar arithmetic only, so a leap day or a year end is a day like any other.
 */
export function attachFloor(createdDate: string, days: number): string {
  return addDays(createdDate, -days);
}

/**
 * What the gift form opens with, given the giver's local calendar date (SPEC.md Open question 4):
 * "Expected from" is today, and "Expected until" is the same day — a one-day window, which is the
 * obvious case of buying something today, and which the giver widens by editing. Nothing else is
 * defaulted: "Reveal on" is a decision, and a guessed one would be wrong more often than not.
 *
 * `today` comes from `localIsoDate()` in the browser; this function reads no clock of its own.
 */
export function giftFormDefaults(today: string): { windowStart: string; windowEnd: string } {
  return { windowStart: today, windowEnd: today };
}
