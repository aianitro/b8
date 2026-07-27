import { plaidClient } from './plaid';
import db from './db';

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

interface DbAccountRow {
  id: string;
  name: string;
  mask: string | null;
  subtype: string | null;
  persistent_account_id: string | null;
}

export interface ReconcileResult {
  remapped: { oldId: string; newId: string; name: string; matchedBy: string }[];
  unmatchedLive: { id: string; name: string; mask: string | null }[];
  unmatchedDb: { id: string; name: string; mask: string | null }[];
}

export async function reconcileAccountIds(accessToken: string): Promise<ReconcileResult> {
  const live = await plaidClient.accountsGet({ access_token: accessToken });
  const liveAccounts = live.data.accounts;

  const { rows: dbAccounts } = await db.query<DbAccountRow>(
    'SELECT id, name, mask, subtype, persistent_account_id FROM accounts WHERE access_token = $1',
    [accessToken]
  );

  const claimedDbIds = new Set<string>();
  const remapped: ReconcileResult['remapped'] = [];
  const stillUnmatchedLive: typeof liveAccounts = [];

  for (const a of liveAccounts) {
    const existing = dbAccounts.find((d) => d.id === a.account_id);
    if (existing) {
      claimedDbIds.add(existing.id);
      // Opportunistically backfill identifiers so future reconciliation is stronger.
      if (existing.mask !== (a.mask ?? null) || existing.persistent_account_id !== (a.persistent_account_id ?? null)) {
        await db.query('UPDATE accounts SET mask = $1, persistent_account_id = $2 WHERE id = $3', [
          a.mask ?? null,
          a.persistent_account_id ?? null,
          existing.id,
        ]);
      }
      continue;
    }
    stillUnmatchedLive.push(a);
  }

  const candidates = () => dbAccounts.filter((d) => !claimedDbIds.has(d.id));
  const remainingLive: typeof liveAccounts = [];

  // Pass 1: persistent_account_id — Plaid's purpose-built stable identifier.
  for (const a of stillUnmatchedLive) {
    const match = a.persistent_account_id
      ? candidates().find((d) => d.persistent_account_id === a.persistent_account_id)
      : undefined;
    if (match) {
      await remap(match, a, 'persistent_account_id');
      claimedDbIds.add(match.id);
      remapped.push({ oldId: match.id, newId: a.account_id, name: match.name, matchedBy: 'persistent_account_id' });
    } else {
      remainingLive.push(a);
    }
  }

  // Pass 2: mask + subtype — survives account renames.
  const afterPass1 = [...remainingLive];
  remainingLive.length = 0;
  for (const a of afterPass1) {
    const match = a.mask
      ? candidates().find((d) => d.mask === a.mask && d.subtype === (a.subtype ?? null))
      : undefined;
    if (match) {
      await remap(match, a, 'mask');
      claimedDbIds.add(match.id);
      remapped.push({ oldId: match.id, newId: a.account_id, name: match.name, matchedBy: 'mask' });
    } else {
      remainingLive.push(a);
    }
  }

  // Pass 3: exact name match — the original heuristic, kept as a fallback.
  const afterPass2 = [...remainingLive];
  remainingLive.length = 0;
  for (const a of afterPass2) {
    const match = candidates().find((d) => d.name === a.name);
    if (match) {
      await remap(match, a, 'name');
      claimedDbIds.add(match.id);
      remapped.push({ oldId: match.id, newId: a.account_id, name: match.name, matchedBy: 'name' });
    } else {
      remainingLive.push(a);
    }
  }

  // Pass 4: fuzzy name — catches user renames like "Trust Myrtle Beach" -> "Trust Myrtle
  // Beach (1503)" where one name contains the other, same type.
  const afterPass3 = [...remainingLive];
  remainingLive.length = 0;
  for (const a of afterPass3) {
    const liveName = a.name.toLowerCase();
    const match = candidates().find((d) => {
      if (d.subtype !== (a.subtype ?? null) && d.subtype !== null) return false;
      const dbName = d.name.toLowerCase();
      return dbName.includes(liveName) || liveName.includes(dbName);
    });
    if (match) {
      await remap(match, a, 'fuzzy-name');
      claimedDbIds.add(match.id);
      remapped.push({ oldId: match.id, newId: a.account_id, name: match.name, matchedBy: 'fuzzy-name' });
    } else {
      remainingLive.push(a);
    }
  }

  // Pass 5: elimination — if exactly one candidate remains on each side, they must be
  // the same account under a name AND mask that both changed. Anything less certain
  // (0 or 2+ remaining) is left unmatched rather than risk merging the wrong accounts.
  const leftoverDb = candidates();
  if (remainingLive.length === 1 && leftoverDb.length === 1) {
    const [a] = remainingLive;
    const [match] = leftoverDb;
    await remap(match, a, 'elimination');
    claimedDbIds.add(match.id);
    remapped.push({ oldId: match.id, newId: a.account_id, name: match.name, matchedBy: 'elimination' });
    remainingLive.length = 0;
  }

  const unmatchedLive = remainingLive.map((a) => ({ id: a.account_id, name: a.name, mask: a.mask ?? null }));
  const unmatchedDb = candidates().map((d) => ({ id: d.id, name: d.name, mask: d.mask }));

  if (remapped.length > 0) {
    console.warn(
      '[plaidReconcile] remapped account ids:',
      remapped.map((r) => `${r.name} ${r.oldId.slice(0, 8)}->${r.newId.slice(0, 8)} (${r.matchedBy})`).join(', ')
    );
  }
  if (unmatchedLive.length > 0 || unmatchedDb.length > 0) {
    console.warn('[plaidReconcile] could not confidently reconcile:', { unmatchedLive, unmatchedDb });
  }

  return { remapped, unmatchedLive: unmatchedLive, unmatchedDb };
}

async function remap(dbRow: DbAccountRow, live: { account_id: string; mask?: string | null; persistent_account_id?: string | null }, _matchedBy: string) {
  await db.query('UPDATE accounts SET id = $1, mask = $2, persistent_account_id = $3 WHERE id = $4', [
    live.account_id,
    live.mask ?? null,
    live.persistent_account_id ?? null,
    dbRow.id,
  ]);
}
