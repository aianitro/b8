import { plaidClient } from './plaid';
import db from './db';
import { matchAccounts, type DbAccountRow } from './plaidMatch';

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

export interface ReconcileResult {
  remapped: { oldId: string; newId: string; name: string; matchedBy: string }[];
  unmatchedLive: { id: string; name: string; mask: string | null }[];
  unmatchedDb: { id: string; name: string; mask: string | null }[];
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
    console.warn(
      '[plaidReconcile] remapped account ids:',
      remapped.map((r) => `${r.name} ${r.oldId.slice(0, 8)}->${r.newId.slice(0, 8)} (${r.matchedBy})`).join(', ')
    );
  }
  if (unmatchedLive.length > 0 || unmatchedDb.length > 0) {
    console.warn('[plaidReconcile] could not confidently reconcile:', { unmatchedLive, unmatchedDb });
  }

  return {
    remapped: remapped.map(({ oldId, newId, name, matchedBy }) => ({ oldId, newId, name, matchedBy })),
    unmatchedLive,
    unmatchedDb,
  };
}
