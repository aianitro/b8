import { plaidClient } from './plaid';
import { reconcileAccountIds } from './plaidReconcile';
import { recordPlaidBalances } from './plaidBalances';
import db from './db';
import { createLogger } from './logger';

const log = createLogger('sync');

type RuleMap = Map<string, string>;

async function loadRules(): Promise<RuleMap> {
  const result = await db.query<{ plaid_category: string; mapped_category: string }>(
    'SELECT plaid_category, mapped_category FROM category_rules'
  );
  return new Map(result.rows.map((r) => [r.plaid_category, r.mapped_category]));
}

function applyRule(plaidCategory: string | null, rules: RuleMap): { mapped: string | null; ruleApplied: boolean } {
  if (!plaidCategory) return { mapped: null, ruleApplied: false };
  const mapped = rules.get(plaidCategory) ?? null;
  return mapped ? { mapped, ruleApplied: true } : { mapped: null, ruleApplied: false };
}

// Incremental sync via cursor — only fetches changes since last sync.
async function syncItem(
  accessToken: string,
  accountIds: string[],
  cursor: string | null,
  rules: RuleMap
): Promise<{ added: number; unmatchedAccountIds: string[] }> {
  let currentCursor = cursor ?? undefined;
  let added = 0;
  let hasMore = true;
  const unmatchedAccountIds = new Set<string>();

  while (hasMore) {
    const res = await plaidClient.transactionsSync({
      access_token: accessToken,
      cursor: currentCursor,
      options: { include_personal_finance_category: true },
    });

    const { added: newTxns, modified, removed, next_cursor, has_more } = res.data;

    const knownIds = new Set(accountIds);

    for (const txn of newTxns) {
      if (!knownIds.has(txn.account_id)) {
        unmatchedAccountIds.add(txn.account_id); // unrecognized even after reconciliation — surfaced, not silently dropped
        continue;
      }
      // Pending transactions (e.g. a restaurant auth hold before the tip is added) are
      // frequently reissued under a brand-new transaction_id once they post — storing the
      // pending one creates a permanent duplicate alongside the posted one. Wait for it to
      // post (pending: false) before saving it; the posted version arrives later as its own
      // `added` or `modified` event.
      if (txn.pending) continue;
      const plaidCategory = txn.personal_finance_category?.primary ?? null;
      const { mapped, ruleApplied } = applyRule(plaidCategory, rules);
      await db.query(
        `INSERT INTO transactions
           (plaid_transaction_id, account_id, date, amount, name, merchant_name, plaid_category, mapped_category, rule_applied)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (plaid_transaction_id) DO UPDATE
           SET account_id = EXCLUDED.account_id,
               date = EXCLUDED.date,
               amount = EXCLUDED.amount,
               name = EXCLUDED.name,
               merchant_name = EXCLUDED.merchant_name,
               plaid_category = EXCLUDED.plaid_category`,
        [txn.transaction_id, txn.account_id, txn.date, txn.amount,
         txn.name ?? null, txn.merchant_name ?? null, plaidCategory, mapped, ruleApplied]
      );
      added++;
    }

    for (const txn of modified) {
      if (!knownIds.has(txn.account_id)) {
        unmatchedAccountIds.add(txn.account_id);
        continue;
      }
      // Same pending skip as above — some institutions post-in-place (same transaction_id,
      // `modified` event flips pending false) rather than reissuing a new id. Upsert instead
      // of a plain UPDATE so that case still creates the row the first time it posts, even
      // though we never stored it while pending.
      if (txn.pending) continue;
      const plaidCategory = txn.personal_finance_category?.primary ?? null;
      const { mapped, ruleApplied } = applyRule(plaidCategory, rules);
      await db.query(
        `INSERT INTO transactions
           (plaid_transaction_id, account_id, date, amount, name, merchant_name, plaid_category, mapped_category, rule_applied)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (plaid_transaction_id) DO UPDATE
           SET account_id = EXCLUDED.account_id,
               date = EXCLUDED.date,
               amount = EXCLUDED.amount,
               name = EXCLUDED.name,
               merchant_name = EXCLUDED.merchant_name,
               plaid_category = EXCLUDED.plaid_category,
               mapped_category = CASE WHEN transactions.mapped_category IS NULL OR transactions.rule_applied = TRUE THEN EXCLUDED.mapped_category ELSE transactions.mapped_category END,
               rule_applied    = CASE WHEN transactions.mapped_category IS NULL OR transactions.rule_applied = TRUE THEN EXCLUDED.rule_applied    ELSE transactions.rule_applied    END`,
        [txn.transaction_id, txn.account_id, txn.date, txn.amount,
         txn.name ?? null, txn.merchant_name ?? null, plaidCategory, mapped, ruleApplied]
      );
    }

    for (const txn of removed) {
      await db.query('DELETE FROM transactions WHERE plaid_transaction_id = $1', [txn.transaction_id]);
    }

    currentCursor = next_cursor;
    hasMore = has_more;
  }

  await db.query(
    `UPDATE accounts SET cursor = $1, last_synced_at = NOW() WHERE id = ANY($2)`,
    [currentCursor, accountIds]
  );

  if (unmatchedAccountIds.size > 0) {
    log.warn('transactions for unrecognized account_ids (not saved)', { accountIds: [...unmatchedAccountIds] });
  }

  return { added, unmatchedAccountIds: [...unmatchedAccountIds] };
}

export interface SyncOptions {
  accountId?: string | null;
  force?: boolean;
  trigger?: 'scheduler' | 'manual_sync' | 'manual_force';
}

export interface SyncResult {
  synced: number;
  errors: string[];
  reconciled: string[];
  unmatchedAccountIds: string[];
}

export async function runSync({
  accountId: filterAccountId = null,
  force = false,
  trigger = force ? 'manual_force' : 'manual_sync',
}: SyncOptions = {}): Promise<SyncResult> {
  const result = await runSyncInner({ filterAccountId, force });

  await db.query(
    'INSERT INTO sync_log (trigger, phase, synced, unmatched, errors) VALUES ($1, $2, $3, $4, $5)',
    [trigger, force ? 'force' : 'plain', result.synced, result.unmatchedAccountIds.length, result.errors.length]
  ).catch((err) => log.error('failed to write sync_log', { error: err instanceof Error ? err.message : String(err) }));

  return result;
}

async function runSyncInner({
  filterAccountId,
  force,
}: {
  filterAccountId: string | null;
  force: boolean;
}): Promise<SyncResult> {
  const rules = await loadRules();

  // Self-heal account_id drift before touching transactions: Plaid can reissue an
  // account's id for the same item without any user action. Reconciling first means
  // the sync below always compares against current ids.
  const { rows: tokenRows } = await db.query<{ access_token: string }>(
    'SELECT DISTINCT access_token FROM accounts WHERE access_token IS NOT NULL'
  );
  const reconciled: string[] = [];
  for (const { access_token } of tokenRows) {
    try {
      const result = await reconcileAccountIds(access_token);
      for (const r of result.remapped) reconciled.push(`remapped ${r.name} (${r.matchedBy})`);
      for (const u of result.unmatchedLive) reconciled.push(`new/unmatched account at Plaid: ${u.name}`);

      // Best-effort and deliberately isolated: recording balances is a nice-to-have that must
      // never cost us a transaction sync, which is what this run actually exists to do.
      try {
        await recordPlaidBalances(result.liveBalances);
      } catch (err) {
        log.error('recording plaid balances failed', { error: err instanceof Error ? err.message : String(err) });
      }
    } catch (err) {
      log.error('reconcile failed for token', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  const accounts = await db.query<{ id: string; access_token: string; cursor: string | null }>(
    'SELECT id, access_token, cursor FROM accounts WHERE access_token IS NOT NULL'
  );

  if (accounts.rows.length === 0) {
    return { synced: 0, errors: [], reconciled, unmatchedAccountIds: [] };
  }

  // Group by access token — one Plaid item = one API call.
  const byToken = new Map<string, { ids: string[]; cursor: string | null }>();
  for (const a of accounts.rows) {
    if (!byToken.has(a.access_token)) byToken.set(a.access_token, { ids: [], cursor: a.cursor });
    byToken.get(a.access_token)!.ids.push(a.id);
  }

  // If a specific account is requested, only sync the item that contains it.
  let entries = [...byToken.entries()];
  if (filterAccountId) {
    entries = entries.filter(([, { ids }]) => ids.includes(filterAccountId));
    if (entries.length === 0) {
      throw new Error('Account not found or has no access token');
    }
  }

  // Force-refresh: ask Plaid to re-pull from the institution, then wait for it to process.
  if (force) {
    await Promise.allSettled(
      entries.map(([token]) =>
        plaidClient.transactionsRefresh({ access_token: token }).catch((e) => {
          log.warn('refresh warning', { error: e?.message });
        })
      )
    );
    // Give Plaid time to fetch from the institution before we sync.
    await new Promise((r) => setTimeout(r, 8000));
  }

  let totalSynced = 0;
  const errors: string[] = [];
  const unmatchedAccountIds: string[] = [];
  for (const [token, { ids, cursor }] of entries) {
    try {
      const result = await syncItem(token, ids, cursor, rules);
      totalSynced += result.added;
      unmatchedAccountIds.push(...result.unmatchedAccountIds);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('item failed', { accountIds: ids, error: msg });
      // Generic, not `msg` — this array reaches the client via the API response. Raw
      // Postgres/Plaid error text can carry internal schema or request details; the full
      // message is already logged server-side above for debugging.
      errors.push(`Sync failed for account(s): ${ids.join(', ')}`);
    }
  }

  return { synced: totalSynced, errors, reconciled, unmatchedAccountIds };
}
