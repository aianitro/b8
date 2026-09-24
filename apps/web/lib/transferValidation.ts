// Transfer-group validation, extracted from the transfers API route so the rules are unit
// testable without a DB (ROADMAP.md §2, testing priority tier 1).
//
// A transfer group is 2+ transactions representing one movement of money between accounts:
// the outflow and the inflow(s). They must net to ~zero, or the group is describing
// something other than a transfer and would silently distort every budget total.

export const EPSILON = 0.01;

export type TransferValidationError =
  | { code: 'INVALID_INPUT'; message: string }
  | { code: 'NOT_FOUND'; message: string }
  | { code: 'ALREADY_GROUPED'; message: string }
  | { code: 'UNBALANCED'; message: string };

export interface TransferCandidate {
  id: number;
  amount: string | number;
  transfer_group_id: number | null;
}

/**
 * Narrows untrusted JSON to a usable set of ids. A type predicate rather than an
 * error-returning check so callers can't accidentally use the ids without validating them —
 * `validateTransferIdsError` supplies the client-facing error for the failing case.
 */
export function isValidTransferIds(ids: unknown): ids is number[] {
  return (
    Array.isArray(ids) &&
    ids.length >= 2 &&
    ids.every((id) => Number.isInteger(id)) &&
    new Set(ids).size === ids.length
  );
}

export const invalidTransferIdsError: TransferValidationError = {
  code: 'INVALID_INPUT',
  message: 'ids must be 2 or more distinct transaction ids',
};

/** Returns null when the fetched rows can form a transfer group, or the error to return. */
export function validateTransferRows(
  ids: number[],
  rows: TransferCandidate[]
): TransferValidationError | null {
  if (rows.length !== ids.length) {
    return { code: 'NOT_FOUND', message: 'One or more transactions not found' };
  }
  if (rows.some((r) => r.transfer_group_id !== null)) {
    return {
      code: 'ALREADY_GROUPED',
      message: 'One or more transactions are already part of a transfer group — unlink first',
    };
  }
  const sum = rows.reduce((s, r) => s + Number(r.amount), 0);
  if (Math.abs(sum) > EPSILON) {
    return { code: 'UNBALANCED', message: `Selected amounts must sum to 0 (currently ${sum.toFixed(2)})` };
  }
  return null;
}

/** How far either side of a row to look for its counterpart, in days. */
export const COUNTERPART_WINDOW_DAYS = 7;

export interface CounterpartRow {
  id: number;
  date: string;
  label: string;
  amount: number;
  account: string;
}

/**
 * The rule for "which rows could be the other side of this one", as a predicate over fetched rows.
 *
 * ─── Why this is narrow, and stays narrow ─────────────────────────────────────────────────────
 *
 * A transfer group must net to ~zero (see `validateTransferRows`), so for a TWO-row group the
 * counterpart's amount is the exact negation — not "about the same", not "within a tolerance".
 * `EPSILON` is here only to absorb the float error of reading a NUMERIC through `pg`, never to
 * admit a near-miss: two rows a cent apart are two different movements of money, and pairing them
 * would put a cent of a real transfer into a budget forever.
 *
 * ALREADY-GROUPED ROWS ARE EXCLUDED because `validateTransferRows` would refuse them anyway, and
 * an offer the server will reject is worse than no offer.
 *
 * The window is days, not hours. A card autopay debits and credits the same day; an inter-bank
 * transfer takes two or three; `COUNTERPART_WINDOW_DAYS` is generous enough for both and tight
 * enough that a recurring equal amount a fortnight later is not proposed as the same movement.
 *
 * ─── What this deliberately does NOT do ───────────────────────────────────────────────────────
 *
 * No three-way groups. `POST /api/v1/transfers` takes any number of ids and the ledger's own
 * multi-select can build them; this one-tap path answers the overwhelmingly common case and leaves
 * the rest where the tool for it already is. Offering a "pick several of these" list inside a
 * modal over a single row would be rebuilding that tool in the wrong place.
 */
export function isCounterpart(
  row: { amount: number; transfer_group_id: number | null; date: string },
  subject: { amount: number; date: string },
): boolean {
  if (row.transfer_group_id !== null) return false;
  if (Math.abs(row.amount + subject.amount) > EPSILON) return false;
  const days = Math.abs(Date.parse(`${row.date}T00:00:00Z`) - Date.parse(`${subject.date}T00:00:00Z`))
    / 86_400_000;
  return Number.isFinite(days) && days <= COUNTERPART_WINDOW_DAYS;
}
