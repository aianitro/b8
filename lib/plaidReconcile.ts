import { plaidClient } from './plaid';
import db from './db';
import { matchAccounts, type DbAccountRow } from './plaidMatch';
import { createLogger } from './logger';
import type { ObservedBalance } from './domain/valuation';

const log = createLogger('plaidReconcile');

// Plaid does not guarantee account_id is permanently stable for every institution —
// OAuth-based banks (Chase, Discover, ...) can reissue it for an existing account
// after a credential/session re-verification, without rotating the access_token or
// item_id. When that happens, transactions for that account stop matching our stored
// accounts.id, and would otherwise be silently dropped by the sync loop.
//
// This reconciles our accounts table against Plaid's live account list for a given
// access_token, re-pointing accounts.id to the current Plaid id whenever we can match
// the old row with high confidence. accounts.id is referenced with ON UPDATE CASCADE
// so downstream tables (transactions, account_balances, budget_categories) follow along.
//
// The matching itself lives in plaidMatch.ts as a pure function — this file is the I/O
// shell around it (fetch live accounts, apply the remaps and identifier backfills).
//
// It also surfaces the balances from that same live snapshot (`liveBalances`), which the
// accountsGet call already returns and the sync path historically discarded. Returning them
// here rather than re-fetching in lib/plaidBalances.ts keeps it at one Plaid API call per
// item per sync.

export interface ReconcileResult {
  remapped: { oldId: string; newId: string; name: string; matchedBy: string }[];
  unmatchedLive: { id: string; name: string; mask: string | null }[];
  unmatchedDb: { id: string; name: string; mask: string | null }[];
  liveBalances: ObservedBalance[];
}

export async function reconcileAccountIds(accessToken: string): Promise<ReconcileResult> {
  const live = await plaidClient.accountsGet({ access_token: accessToken });

  const { rows: dbAccounts } = await db.query<DbAccountRow>(
    'SELECT id, name, mask, subtype, persistent_account_id FROM accounts WHERE access_token = $1',
    [accessToken]
  );

  const { remapped, backfills, unmatchedLive, unmatchedDb } = matchAccounts(live.data.accounts, dbAccounts);

  // Opportunistically refresh identifiers on accounts that still match by id, so future
  // reconciliation has stronger signals than a name comparison to fall back on.
  for (const b of backfills) {
    await db.query('UPDATE accounts SET mask = $1, persistent_account_id = $2 WHERE id = $3', [
      b.mask,
      b.persistentAccountId,
      b.id,
    ]);
  }

  for (const r of remapped) {
    await db.query('UPDATE accounts SET id = $1, mask = $2, persistent_account_id = $3 WHERE id = $4', [
      r.newId,
      r.mask,
      r.persistentAccountId,
      r.oldId,
    ]);
  }

  if (remapped.length > 0) {
    log.warn('remapped account ids', {
      remapped: remapped.map((r) => `${r.name} ${r.oldId.slice(0, 8)}->${r.newId.slice(0, 8)} (${r.matchedBy})`),
    });
  }
  if (unmatchedLive.length > 0 || unmatchedDb.length > 0) {
    log.warn('could not confidently reconcile', { unmatchedLive, unmatchedDb });
  }

  // Keyed by Plaid's live account_id, which by this point equals our accounts.id for every
  // account we know about — the remaps above have already run. Accounts Plaid reports that we
  // have no row for (unmatchedLive) are still included here; lib/plaidBalances.ts filters them
  // out against the accounts table rather than letting them hit the FK.
  //
  // `current`, not `available`: for credit accounts `available` is remaining credit, not the
  // balance. Plaid reports `current` as a positive magnitude for both assets and liabilities
  // (for credit/loan it's the amount owed), which is exactly the convention account_valuations
  // stores — sign is derived from accounts.is_liability, never from the stored value.
  const liveBalances: ObservedBalance[] = live.data.accounts
    .filter((a) => a.balances.current !== null)
    .map((a) => ({ accountId: a.account_id, value: a.balances.current as number }));

  return {
    remapped: remapped.map(({ oldId, newId, name, matchedBy }) => ({ oldId, newId, name, matchedBy })),
    unmatchedLive,
    unmatchedDb,
    liveBalances,
  };
}
