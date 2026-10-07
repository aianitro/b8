import { CountryCode } from 'plaid';
import { plaidClient } from './plaid';
import { reconcileAccountIds } from './plaidReconcile';
import { recordPlaidBalances } from './plaidBalances';
import db from './db';
import { createLogger } from './logger';
import { matchReissuedTransactions } from './domain/txnMatch';
import { ruleFor, type CategoryRule } from './domain/categoryRules';
import { enrichmentParams, plaidEnrichment } from './plaidEnrichment';
// Reused rather than re-written: node-postgres hands back a DATE column as a JS Date at local
// midnight, and toISOString() would shift it a day earlier at any UTC+ offset. That trap is
// already solved (and tested) there; duplicating the logic here is how the two drift apart.
import { toDateInputValue as toDateOnly } from './domain/property';

const log = createLogger('sync');

type RuleMap = CategoryRule[];

/**
 * Every rule, of both kinds. A LIST rather than the Map this used to be: a Map keyed on
 * `plaid_category` cannot hold a merchant rule, and keying on "whichever column is set" would make
 * the precedence between the two a property of iteration order. `ruleFor` decides instead, in one
 * place both this and `/api/v1/rules/apply` call.
 */
async function loadRules(): Promise<RuleMap> {
  const result = await db.query<{
    plaid_category: string | null; merchant_name: string | null; mapped_category: string;
  }>('SELECT plaid_category, merchant_name, mapped_category FROM category_rules');
  return result.rows.map((r) => ({
    plaidCategory: r.plaid_category,
    merchantName: r.merchant_name,
    mappedCategory: r.mapped_category,
  }));
}

function applyRule(
  subject: { plaidCategory: string | null; merchantName: string | null },
  rules: RuleMap,
): { mapped: string | null; ruleApplied: boolean } {
  const mapped = ruleFor(subject, rules);
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
  // Counted only for the log line below. Not part of the return: a skipped deletion is not a sync
  // outcome the caller acts on, and `added` already excludes these.
  let skippedTombstoned = 0;
  let hasMore = true;
  const unmatchedAccountIds = new Set<string>();

  while (hasMore) {
    const res = await plaidClient().transactionsSync({
      access_token: accessToken,
      cursor: currentCursor,
      options: { include_personal_finance_category: true },
    });

    const { added: newTxns, modified, removed, next_cursor, has_more } = res.data;

    const knownIds = new Set(accountIds);

    // A re-auth gives the bank a new Plaid Item, and transaction_id is scoped to the Item — so
    // the same real transactions arrive with brand-new ids and the upsert below, keyed on
    // plaid_transaction_id, sees no conflict and stores history twice. Before inserting, pair
    // each incoming row against a stored one that Plaid no longer refers to by id and update
    // that row's id in place instead: the transaction keeps its row, and with it whatever
    // category, hidden flag and transfer group it had.
    //
    // A TOMBSTONED INCOMING ID TAKES NO PART IN THIS, IN EITHER ROLE. As a claimant it would rename
    // a live stored row to an id the owner deleted — the row survives, but now under an id the
    // upsert below refuses to touch, so it can never be updated again — and its claim would also
    // use up a stored row that a legitimate page-mate with the same account, date, amount and name
    // should have claimed, turning that page-mate into a duplicate. So it is removed from the
    // incoming list before matching, not merely blocked at the UPDATE: a refused UPDATE would still
    // have spent the claim. And a stored row still bearing that id (re-created by a CSV re-import,
    // say) is kept out of the candidate pool, exactly as the matcher already does for any id Plaid
    // is still sending: Plaid still knows it, so it is not a row Plaid has stopped referring to.
    //
    // WHY A READ IS ACCEPTABLE HERE, when the writes below insist on checking inside the statement.
    // This read is per page, not once per sync, and the only race it can lose is the owner deleting
    // a row while this page is processed. A tombstone can only newly appear for an id that is stored
    // — there is no row to delete otherwise — and an incoming id the matcher can see stored (same
    // accounts, inside this page's date range) is never a claimant: it is handed to the ordinary
    // upsert path, whose write-time check below catches it. What remains is an id stored OUTSIDE
    // that range (Plaid moved its date) deleted in the milliseconds between this read and the
    // UPDATE below — a window this narrow is accepted rather than locked against.
    const pageCandidates = newTxns.filter((t) => knownIds.has(t.account_id) && !t.pending);
    const tombstoned = new Set<string>();
    if (pageCandidates.length > 0) {
      const { rows } = await db.query<{ plaid_transaction_id: string }>(
        'SELECT plaid_transaction_id FROM transaction_tombstones WHERE plaid_transaction_id = ANY($1)',
        [pageCandidates.map((t) => t.transaction_id)]
      );
      for (const r of rows) tombstoned.add(r.plaid_transaction_id);
    }
    const eligible = pageCandidates.filter((t) => !tombstoned.has(t.transaction_id));
    const reidentified = new Set<string>();
    if (eligible.length > 0) {
      const dates = eligible.map((t) => t.date);
      const existingRows = await db.query<{
        id: number; plaid_transaction_id: string; account_id: string; date: Date; amount: string; name: string | null;
      }>(
        `SELECT id, plaid_transaction_id, account_id, date, amount, name
           FROM transactions
          WHERE account_id = ANY($1) AND date BETWEEN $2 AND $3`,
        [accountIds, dates.reduce((a, b) => (a < b ? a : b)), dates.reduce((a, b) => (a > b ? a : b))]
      );

      const { reidentify } = matchReissuedTransactions(
        eligible.map((t) => ({
          plaidTransactionId: t.transaction_id, accountId: t.account_id,
          date: t.date, amount: t.amount, name: t.name ?? null,
        })),
        existingRows.rows.filter((r) => !tombstoned.has(r.plaid_transaction_id)).map((r) => ({
          id: r.id, plaidTransactionId: r.plaid_transaction_id, accountId: r.account_id,
          date: toDateOnly(r.date), amount: Number(r.amount), name: r.name,
        }))
      );

      for (const m of reidentify) {
        await db.query('UPDATE transactions SET plaid_transaction_id = $1 WHERE id = $2', [
          m.newPlaidTransactionId, m.existingId,
        ]);
        reidentified.add(m.newPlaidTransactionId);
      }
      if (reidentify.length > 0) {
        log.info('re-identified transactions after item change', { count: reidentify.length });
      }
    }

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
      const { mapped, ruleApplied } = applyRule(
        { plaidCategory, merchantName: txn.merchant_name ?? null }, rules);
      // Re-identified rows now carry this id, so the upsert below finds them by conflict and
      // refreshes their Plaid-sourced fields — deliberately without touching mapped_category,
      // which the DO UPDATE clause already leaves alone.
      //
      // THE TOMBSTONE CHECK IS INSIDE THE WRITE, and that placement is the rule rather than a
      // style. `INSERT ... SELECT ... WHERE NOT EXISTS` proposes no row at all for an id the owner
      // deleted, so there is nothing to insert and nothing to conflict with — the DO UPDATE never
      // fires either. A SELECT of tombstones up front, then a plain upsert, would be deciding on a
      // reading that a delete landing mid-sync (or between two pages) has already made stale, and
      // the row would come back. Asked here, the question is answered at the moment it matters.
      // A skipped id is not counted: `rowCount` is 0 when the guard proposed nothing.
      //
      // THE ENRICHMENT (P6-40b) IS PLAID'S LATEST STATEMENT, OVERWRITTEN WHOLE. Each of the eleven
      // columns is set from EXCLUDED with no COALESCE against the stored value: when Plaid stops
      // sending a logo or a city, the row stops claiming one. Keeping the old value would make a
      // row a blend of statements Plaid made at different times, true of none of them. The owner's
      // own fields (mapped_category here, and hidden, watched_at, note, transfer_group_id,
      // property_id everywhere) are still never named in the DO UPDATE. This is also the statement
      // that fills in a row the re-identification above just renumbered: the UPDATE there moves the
      // id only, and the conflict here refreshes everything Plaid-sourced, enrichment included —
      // so there is one write path for Plaid's fields, not a second one that could skip the
      // tombstone guard or forget a column. The values come from `plaidEnrichment`, which both
      // loops share, and `$12::date` takes Plaid's zone-less string with no Date in between.
      const written = await db.query(
        `INSERT INTO transactions
           (plaid_transaction_id, account_id, date, amount, name, merchant_name, plaid_category, mapped_category, rule_applied,
            plaid_category_detailed, plaid_category_confidence, authorized_date, payment_channel,
            merchant_entity_id, logo_url, website, location_city, location_region, location_country, plaid_raw)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9,
                $10, $11, $12::date, $13, $14, $15, $16, $17, $18, $19, $20::jsonb
          WHERE NOT EXISTS (SELECT 1 FROM transaction_tombstones tt WHERE tt.plaid_transaction_id = $1)
         ON CONFLICT (plaid_transaction_id) DO UPDATE
           SET account_id = EXCLUDED.account_id,
               date = EXCLUDED.date,
               amount = EXCLUDED.amount,
               name = EXCLUDED.name,
               merchant_name = EXCLUDED.merchant_name,
               plaid_category = EXCLUDED.plaid_category,
               plaid_category_detailed   = EXCLUDED.plaid_category_detailed,
               plaid_category_confidence = EXCLUDED.plaid_category_confidence,
               authorized_date           = EXCLUDED.authorized_date,
               payment_channel           = EXCLUDED.payment_channel,
               merchant_entity_id        = EXCLUDED.merchant_entity_id,
               logo_url                  = EXCLUDED.logo_url,
               website                   = EXCLUDED.website,
               location_city             = EXCLUDED.location_city,
               location_region           = EXCLUDED.location_region,
               location_country          = EXCLUDED.location_country,
               plaid_raw                 = EXCLUDED.plaid_raw`,
        [txn.transaction_id, txn.account_id, txn.date, txn.amount,
         txn.name ?? null, txn.merchant_name ?? null, plaidCategory, mapped, ruleApplied,
         ...enrichmentParams(plaidEnrichment(txn))]
      );
      // A re-identified row is not new to the ledger, only newly-numbered — counting it as
      // added would report a re-auth as hundreds of fresh transactions.
      if (written.rowCount === 0) skippedTombstoned++;
      else if (!reidentified.has(txn.transaction_id)) added++;
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
      const { mapped, ruleApplied } = applyRule(
        { plaidCategory, merchantName: txn.merchant_name ?? null }, rules);
      // The same in-statement tombstone guard as the `added` loop, and this is the loop that
      // needs it most: `modified` is how a deleted row actually comes back in practice, because
      // Plaid keeps revising a transaction it has no idea the owner deleted. With no row proposed,
      // the guard also leaves alone a row that still bears a tombstoned id — it is not refreshed,
      // re-categorised, or resurrected, whichever of those this upsert would otherwise have done.
      // The enrichment columns are overwritten exactly as in the `added` loop, for the same reason;
      // a `modified` event that drops a field is the case that reason exists for.
      const written = await db.query(
        `INSERT INTO transactions
           (plaid_transaction_id, account_id, date, amount, name, merchant_name, plaid_category, mapped_category, rule_applied,
            plaid_category_detailed, plaid_category_confidence, authorized_date, payment_channel,
            merchant_entity_id, logo_url, website, location_city, location_region, location_country, plaid_raw)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9,
                $10, $11, $12::date, $13, $14, $15, $16, $17, $18, $19, $20::jsonb
          WHERE NOT EXISTS (SELECT 1 FROM transaction_tombstones tt WHERE tt.plaid_transaction_id = $1)
         ON CONFLICT (plaid_transaction_id) DO UPDATE
           SET account_id = EXCLUDED.account_id,
               date = EXCLUDED.date,
               amount = EXCLUDED.amount,
               name = EXCLUDED.name,
               merchant_name = EXCLUDED.merchant_name,
               plaid_category = EXCLUDED.plaid_category,
               mapped_category = CASE WHEN transactions.mapped_category IS NULL OR transactions.rule_applied = TRUE THEN EXCLUDED.mapped_category ELSE transactions.mapped_category END,
               rule_applied    = CASE WHEN transactions.mapped_category IS NULL OR transactions.rule_applied = TRUE THEN EXCLUDED.rule_applied    ELSE transactions.rule_applied    END,
               plaid_category_detailed   = EXCLUDED.plaid_category_detailed,
               plaid_category_confidence = EXCLUDED.plaid_category_confidence,
               authorized_date           = EXCLUDED.authorized_date,
               payment_channel           = EXCLUDED.payment_channel,
               merchant_entity_id        = EXCLUDED.merchant_entity_id,
               logo_url                  = EXCLUDED.logo_url,
               website                   = EXCLUDED.website,
               location_city             = EXCLUDED.location_city,
               location_region           = EXCLUDED.location_region,
               location_country          = EXCLUDED.location_country,
               plaid_raw                 = EXCLUDED.plaid_raw`,
        [txn.transaction_id, txn.account_id, txn.date, txn.amount,
         txn.name ?? null, txn.merchant_name ?? null, plaidCategory, mapped, ruleApplied,
         ...enrichmentParams(plaidEnrichment(txn))]
      );
      if (written.rowCount === 0) skippedTombstoned++;
    }

    // NO TOMBSTONE HERE, deliberately, and this DELETE is not to be routed through the route's
    // delete. Plaid removing a transaction (usually a pending one replaced by its posted form) is
    // Plaid's view changing, not the owner deciding; if the same id came back later it would be
    // Plaid changing its mind again, which is not something to override. Only the owner's delete
    // writes a tombstone. For an id that is already tombstoned this matches no row and is a no-op.
    for (const txn of removed) {
      await db.query('DELETE FROM transactions WHERE plaid_transaction_id = $1', [txn.transaction_id]);
    }

    currentCursor = next_cursor;
    hasMore = has_more;
  }

  // What Plaid says about ITS OWN refresh of the institution, recorded beside our cursor.
  //
  // Everything above this line reports on our call to Plaid, and that call succeeds throughout an
  // institution outage — it simply returns an empty page. `/item/get` carries the step before it:
  // `status.transactions.last_failed_update` moving ahead of `last_successful_update` is the bank
  // feed going dark, and it is the only place that state appears. Read once per item per sync,
  // which is one extra request per institution per day.
  //
  // Failure here must not fail the sync. The transactions are already committed by this point and
  // a freshness reading is diagnostic, not transactional — losing it costs a day of observability,
  // whereas throwing would roll a successful sync into the error count and make the health signal
  // the thing that breaks health.
  let itemOk: string | null = null;
  let itemFailed: string | null = null;
  let institutionId: string | null = null;
  let instStatus: string | null = null;
  let instStatusAt: string | null = null;
  try {
    const { data } = await plaidClient().itemGet({ access_token: accessToken });
    itemOk = data.status?.transactions?.last_successful_update ?? null;
    itemFailed = data.status?.transactions?.last_failed_update ?? null;
    // Free: this response already carries it and the field was being discarded. It is the key
    // `/institutions/get_by_id` needs, and without it the status below cannot be asked for at all.
    institutionId = data.item?.institution_id ?? null;
  } catch (err) {
    log.warn('item status unavailable', { error: err instanceof Error ? err.message : String(err) });
  }

  // ─── WHY the feed is dead, which the freshness columns above can never say ───────────────────
  //
  // `feedHealth` already reports that data is N hours old. It cannot say whether the bank needs
  // re-authenticating, Plaid is having a bad day, or there were simply no transactions — three
  // situations wanting three different reactions, only one of them any work. Plaid publishes the
  // answer; during a four-day Chase outage it read DEGRADED with a 22.7% Plaid-side error rate, and
  // nothing here asked.
  //
  // Wrapped and swallowed for the same reason as the call above: a diagnostic reading must never be
  // the thing that breaks a sync whose transactions are already committed. Unlike the refresh
  // refusal counted earlier, this one genuinely does not belong in the run's outcome — not knowing
  // the cause of a problem is not itself a problem with the run.
  if (institutionId) {
    try {
      const { data } = await plaidClient().institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
        options: { include_status: true },
      });
      // `transactions_updates`, not `item_logins`. The latter measures whether LOGINS succeed, which
      // is the right signal when re-authentication is the problem; a dead transaction feed is about
      // the product this app actually consumes, and an institution can log in perfectly while
      // refusing to hand over transactions. Falls back when Plaid publishes no transactions figure.
      const product = data.institution.status?.transactions_updates ?? data.institution.status?.item_logins ?? null;
      instStatus = product?.status ?? null;
      // Plaid's own last_status_change: "degraded since Thursday" is the useful sentence, where
      // "we noticed at 6am" is about us.
      instStatusAt = product?.last_status_change ?? null;
    } catch (err) {
      log.warn('institution status unavailable', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // One statement, so an item's cursor and its freshness can never disagree about which sync they
  // came from. COALESCE keeps the last known reading when this run could not fetch one, rather
  // than blanking it to NULL — which `feedHealth` reads as "never observed" and declines to
  // report, quietly turning an unreachable item into a healthy-looking one.
  await db.query(
    `UPDATE accounts
        SET cursor = $1,
            last_synced_at = NOW(),
            item_last_successful_update = COALESCE($3::timestamptz, item_last_successful_update),
            item_last_failed_update     = COALESCE($4::timestamptz, item_last_failed_update),
            institution_id              = COALESCE($5, institution_id),
            -- COALESCE like the two above: a run that could not reach Plaid keeps the last known
            -- reading rather than blanking it, which would read as "never asked" and quietly turn a
            -- known-degraded institution into one with nothing to say about it.
            item_institution_status     = COALESCE($6, item_institution_status),
            item_institution_status_at  = COALESCE($7::timestamptz, item_institution_status_at)
      WHERE id = ANY($2)`,
    [currentCursor, accountIds, itemOk, itemFailed, institutionId, instStatus, instStatusAt]
  );

  // A count, never the ids: a steady trickle here is Plaid revising transactions the owner
  // deleted, which is expected and needs no action — but a sudden jump is worth being able to see.
  if (skippedTombstoned > 0) {
    log.info('skipped transactions the owner deleted', { count: skippedTombstoned });
  }

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
  /**
   * Force-refresh calls Plaid refused this run.
   *
   * Separate from `errors`, which is the list of syncs that FAILED. A refused refresh is not a
   * failed sync — the sync that follows it still runs and still reports what it found — so folding
   * the two together would turn "your bank is down but we synced what we had" into a red run.
   * Always 0 for a plain sync, which asks for no refresh at all.
   */
  refreshErrors: number;
}

export async function runSync({
  accountId: filterAccountId = null,
  force = false,
  trigger = force ? 'manual_force' : 'manual_sync',
}: SyncOptions = {}): Promise<SyncResult> {
  const result = await runSyncInner({ filterAccountId, force });

  await db.query(
    'INSERT INTO sync_log (trigger, phase, synced, unmatched, errors, refresh_errors) VALUES ($1, $2, $3, $4, $5, $6)',
    [trigger, force ? 'force' : 'plain', result.synced, result.unmatchedAccountIds.length, result.errors.length, result.refreshErrors]
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
    return { synced: 0, errors: [], reconciled, unmatchedAccountIds: [], refreshErrors: 0 };
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

  // Stays 0 on a plain sync, which asks for no refresh at all — not "none were refused" but "none
  // were requested", and the two are the same number here because there is nothing to be refused.
  let refreshErrors = 0;

  // Force-refresh: ask Plaid to re-pull from the institution, then wait for it to process.
  if (force) {
    // COUNTED, not merely logged. The catch stays — a refusal must not fail the whole sync, exactly
    // as the `/item/get` call above argues — but swallowing it entirely left "asked and was refused"
    // and "asked and there was nothing new" both recording `synced: 0, errors: 0`, so a four-day
    // institution outage produced a run of clean-looking syncs. The warning line went to a console
    // nobody reads; the count goes where the run is recorded.
    const outcomes = await Promise.allSettled(
      entries.map(([token]) =>
        plaidClient().transactionsRefresh({ access_token: token }).catch((e) => {
          log.warn('refresh warning', { error: e?.message });
          // Rethrown so `allSettled` classifies it. Returning normally here is what made every
          // refusal indistinguishable from a success in the first place.
          throw e;
        })
      )
    );
    refreshErrors = outcomes.filter((o) => o.status === 'rejected').length;
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

  return { synced: totalSynced, errors, reconciled, unmatchedAccountIds, refreshErrors };
}
