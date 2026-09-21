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
