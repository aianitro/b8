/**
 * What a finished sync says, as sentences. Pure, so the wording is pinned by tests rather than by
 * whoever last read the toast.
 *
 * Separate from `components/SyncToast.tsx` for the reason `lib/domain/digest.ts` is separate from
 * the mailer: the component cannot be exercised without a renderer, and the part most likely to be
 * quietly wrong is not the markup — it is the plural boundaries and the zero case.
 */

/**
 * "No new transactions" is a RESULT, not an empty state, and it is the most common one: most syncs
 * of a working feed bring in nothing. A reader told nothing cannot distinguish that from a button
 * that never fired, which is the case this whole feature most needed to cover.
 */
export function syncHeadline(added: number): string {
  if (added <= 0) return 'No new transactions';
  if (added === 1) return '1 new transaction';
  return `${added.toLocaleString('en-US')} new transactions`;
}

/**
 * The one sync outcome that looks like nothing happening and is not: Plaid returned rows for an
 * account this database has no record of, so that money landed nowhere and no count includes it.
 *
 * Null when there is nothing to say, so the caller renders nothing rather than an empty line.
 */
export function unmatchedAccountsNote(unmatched: number): string | null {
  if (unmatched <= 0) return null;
  return unmatched === 1
    ? '1 account at Plaid has no match here — its transactions were skipped.'
    : `${unmatched} accounts at Plaid have no match here — their transactions were skipped.`;
}

/**
 * A run where some feeds answered and others did not.
 *
 * `/api/v1/sync` returns 500 only when EVERY feed failed (`errors.length > 0 && synced === 0`).
 * A run where one bank refused and another delivered is a 200 carrying its errors in the payload —
 * correct, because rows really did land — but it means a caller that reads only `synced` reports a
 * clean success for a partly-broken sync. That is the same shape as the bug this feature was built
 * to remove, one level in.
 *
 * What the reader needs is not the error text — it is that THE COUNT IS SHORT. A number believed to
 * be everything is worse than a number known to be partial.
 *
 * Null when every feed answered.
 */
export function partialFailureNote(failedFeeds: number): string | null {
  if (failedFeeds <= 0) return null;
  return failedFeeds === 1
    ? '1 feed could not be reached, so this count may be short.'
    : `${failedFeeds} feeds could not be reached, so this count may be short.`;
}
