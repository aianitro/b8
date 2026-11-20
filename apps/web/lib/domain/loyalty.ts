// Loyalty (P8-42a) — the pure rules every loyalty surface shares: the member-number mask, the API
// balance rule and its canonical spelling, the one label-normalisation function, the current
// balance, the instrument order, and the display of a balance. No database, no `next/*`, no clock.
//
// ─── BALANCES ARE TEXT, AND STAY TEXT ─────────────────────────────────────────────────────────
//
// A balance is decimal text from the request to the database and back. Nothing here turns one into
// a JS number — not to validate it, not to canonicalise it, not to group its digits for display —
// because a number is binary floating point and `0.30` is not a value it can hold. Canonicalising is
// string work: strip leading zeros, pad a cash value to two decimals. Excess precision is REFUSED by
// the contract's rule (`isBalanceForUnit`), never rounded, so there is nothing to round.
//
// ─── "CURRENT" IS THE SHARED REDUCER'S ANSWER ─────────────────────────────────────────────────
//
// `currentObservation` and `currentObservationByMembership` are thin wrappers over
// `latestRowByKey` and `compareDatedObservations` in `./observations`, the repo's one newest-wins
// reduction. This file deliberately does not compare dates itself: a second ordering written here
// would be a second definition of "current", and the two would drift (SPEC.md U4).

import {
  LOYALTY_MASK_BULLETS,
  LOYALTY_UNITS,
  isBalanceForUnit,
  type LoyaltyInstrument,
  type LoyaltyUnit,
} from '@b8/contracts/loyalty';
import { compareDatedObservations, latestRowByKey, type DatedObservation } from './observations';

/** The unit vocabulary, as the contract states it. Re-exported so callers name one list. */
export const UNITS: readonly LoyaltyUnit[] = LOYALTY_UNITS;

const isUnit = (unit: unknown): unit is LoyaltyUnit =>
  typeof unit === 'string' && (LOYALTY_UNITS as readonly string[]).includes(unit);

// ─── The mask ──────────────────────────────────────────────────────────────────────────────────

/**
 * The member number as every response but the copy route carries it (SPEC.md Open question 2):
 * exactly four bullets, then the last 4 characters of the trimmed number when it has 8 or more, the
 * last 3 when it has 6 or 7, and nothing when it has 5 or fewer. Null or blank in, null out — never
 * bare bullets, which would claim a number exists.
 *
 * FOUR BULLETS WHATEVER THE LENGTH, so the mask does not reveal how long the number is, and a short
 * number shows nothing: three characters of a five-character number would be most of it. Counted in
 * characters (code points), as the contract's schema and the column's CHECK count.
 */
export function maskMemberNumber(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const chars = Array.from(value.trim());
  if (chars.length === 0) return null;
  const visible = chars.length >= 8 ? 4 : chars.length >= 6 ? 3 : 0;
  return LOYALTY_MASK_BULLETS + chars.slice(chars.length - visible).join('');
}

// ─── The API balance rule ──────────────────────────────────────────────────────────────────────

export type BalanceParse = { ok: true; unit: LoyaltyUnit; balance: string } | { ok: false };

/** Leading zeros off an integer part, keeping a lone zero. String work, not arithmetic. */
const stripLeadingZeros = (digits: string) => digits.replace(/^0+(?=\d)/, '');

/**
 * A submitted balance for `unit`, checked by the contract's rule and returned in the ONE spelling
 * the database stores and every response emits: digits with no leading zero for a whole unit, and
 * for `usd` the same integer part with exactly two decimals (`25` and `25.5` become `25.00` and
 * `25.50`). Anything the rule refuses — a fraction on points, a third decimal on cash, a sign, a
 * separator, an exponent — is a refusal, never a rounded value. An unknown unit refuses everything.
 */
export function parseBalance(unit: unknown, text: unknown): BalanceParse {
  if (!isUnit(unit) || typeof text !== 'string') return { ok: false };
  if (!isBalanceForUnit(unit, text)) return { ok: false };
  if (unit !== 'usd') return { ok: true, unit, balance: stripLeadingZeros(text) };
  const [whole, fraction = ''] = text.split('.');
  return { ok: true, unit, balance: `${stripLeadingZeros(whole)}.${fraction.padEnd(2, '0')}` };
}

// ─── Label normalisation ───────────────────────────────────────────────────────────────────────

/**
 * THE label rule (SPEC.md Conventions), used for sheet labels by the import and for aliases and new
 * program names by the store, so a stored alias and a label are always compared in the same form.
 * In this order:
 *
 *   1. trim;
 *   2. drop leading characters that are not Unicode letters or digits — an emoji, a `*`, a `-`.
 *      Unicode property escapes with the `u` flag match whole code points, so an emoji written as a
 *      surrogate pair goes whole rather than leaving half of itself behind;
 *   3. remove every parenthesised group, an opening parenthesis through the NEXT closing one (an
 *      unclosed opening parenthesis stays, since there is no group to remove);
 *   4. case-fold;
 *   5. collapse every run of whitespace — `\s` with `u` covers tabs and non-breaking spaces — to
 *      one space;
 *   6. trim again.
 *
 * Returns null when nothing is left: an empty label or alias is refused, never matched.
 *
 * The order matters. Stripping the leading symbol first means the first character left is a letter
 * or digit, which step 3 can never remove, so a second pass changes nothing (idempotent); and
 * collapsing before the final trim is what keeps a trailing non-breaking space from surviving.
 */
export function normalizeLabel(text: string): string | null {
  const out = text
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/\([^)]*\)/g, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
  return out === '' ? null : out;
}

// ─── The current balance ───────────────────────────────────────────────────────────────────────

/**
 * The current observation of one membership, or null when it has none — never a zero reading made
 * up for it. A real zero reading is a row, and it is returned like any other.
 */
export function currentObservation<T extends DatedObservation>(rows: readonly T[]): T | null {
  return latestRowByKey(rows, () => 0, compareDatedObservations).get(0) ?? null;
}

/** The current observation of every membership that has one, keyed by membership id. */
export function currentObservationByMembership<T extends DatedObservation & { membershipId: number }>(
  rows: readonly T[]
): Map<number, T> {
  return latestRowByKey(rows, (r) => r.membershipId, compareDatedObservations);
}

// ─── Instruments ───────────────────────────────────────────────────────────────────────────────

/**
 * The page's order for instruments: unused before used; within each, the soonest expiry first with
 * an UNKNOWN expiry last — a null is not "expiring now", and sorting it first would put every
 * imported bonus (which has no dates) at the top as if urgent; then id ascending, so the order is
 * total and no two loads differ. Dates are `YYYY-MM-DD` text, which orders exactly as the dates do.
 * Returns a new array; the input is not reordered.
 */
export function sortInstruments<T extends Pick<LoyaltyInstrument, 'id' | 'expiresOn' | 'usedOn'>>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const usedA = a.usedOn !== null ? 1 : 0;
    const usedB = b.usedOn !== null ? 1 : 0;
    if (usedA !== usedB) return usedA - usedB;
    if (a.expiresOn !== b.expiresOn) {
      if (a.expiresOn === null) return 1;
      if (b.expiresOn === null) return -1;
      return a.expiresOn < b.expiresOn ? -1 : 1;
    }
    return a.id - b.id;
  });
}

// ─── Display ───────────────────────────────────────────────────────────────────────────────────

/** Thousands separators inserted into a digit string by position, not by a number formatter. */
const groupDigits = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const UNIT_LABEL: Record<LoyaltyUnit, string> = { points: 'points', miles: 'miles', nights: 'nights', usd: '' };

/**
 * A canonical balance as the page shows it: the digits grouped in threes with commas, then the unit
 * word, or for cash a dollar sign and the stored two decimals. The digits are grouped
 * as text, because `Intl.NumberFormat` takes a number and a cash balance must not become one. A
 * null balance is "—", never `0` (SPEC.md Null semantics); `0` is a reading and shows as one.
 */
export function formatBalance(balance: string | null, unit: LoyaltyUnit | null): string {
  if (balance === null || unit === null) return '—';
  if (unit === 'usd') {
    const [whole, fraction] = balance.split('.');
    return `$${groupDigits(whole)}.${fraction}`;
  }
  return `${groupDigits(balance)} ${UNIT_LABEL[unit]}`;
}
