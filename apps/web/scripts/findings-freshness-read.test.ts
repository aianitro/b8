// The freshness read against a real Postgres (P5-35, scenarios T35-R1..R9).
//
// TIER 2, under `vitest.integration.config.mts` with the scratch-database guard in `setupFiles` —
// this file writes rows, and the guard refuses to run it against the owner's real database. It is
// named in that config's `include` by exact path and is absent from the pure config, which collects
// only `lib/**`: what is checked here — one row per item, EXISTS rather than JOIN, the budget grid's
// filters, no clock in SQL, no protected column — is a property of the SQL, and a stubbed database
// would assert none of it.
//
// THIS SUITE TRUNCATES, UNLIKE THE TWO SCRIPT SUITES BESIDE IT. `backfill-enrichment.test.ts` and
// `rekey-plaid-ids.test.ts` tolerate other suites' leftovers because they can find their own rows by
// ordinal. `loadFreshnessFacts` has no such handle: it reads every account, every item, the newest
// scheduler row of the whole log and every operational category, so a leftover account or a later
// `sync_log` row from another suite would change the very facts asserted here. The tables it reads
// are therefore emptied before each world is seeded and again at the end — the convention
// `app/api/v1/overview/route.test.ts` already follows for the same reason. Files never overlap in
// time (`fileParallelism: false`), and every suite that needs these tables seeds its own.
//
// ONE FIXED INSTANT. Every seeded timestamp is an offset from `NOW`, a fabricated instant chosen
// mid-month and mid-day so that no zone this suite might run in moves it across a month or a year.
// No test reads the wall clock, except where a real producer does so internally
// (`findBalanceDrift` takes no instant), and that path is arranged so its verdict does not depend on
// the year it runs in.
//
// FABRICATED DATA ONLY. Institution, account and category names are the spec's fixtures
// (`Fabricated Credit Union`, `Fixture Checking`, `Fixture Category`). Amounts are small bare numbers
// chosen to exercise no rule: most are single digits, the categories carry a twelve-unit annual
// budget (one unit a month), and the drift world's Plaid balance is a two-digit figure chosen only so
// the ledger cannot match it. The gift canary is an alphanumeric token no real merchant carries.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FindingSchema, type Finding } from '@b8/contracts/findings';
import db from '@/lib/db';
import { loadFreshnessFacts } from '@/lib/findingsFreshnessRead';
import { giftHeldSql } from '@/lib/giftReadPath';
import { assembleFindings, asOfDate } from '@/lib/domain/findings';
import type { FreshnessFacts } from '@/lib/domain/findingsFreshness';
import { asOfFromDate } from '@/lib/domain/monthOutlook';
import { classifySyncHealth } from '@/lib/domain/syncHealth';
import { staleWallets } from '@/lib/domain/walletStaleness';
import { detectAdherence, type AdherenceInput } from '@/lib/domain/adherence';
import { jobHealth } from '@/lib/domain/jobHealth';
import { loadFeedHealth } from '@/lib/feedHealthRead';
import { loadJobHealth } from '@/lib/jobHealthRead';
import { loadValuationFindings } from '@/lib/valuationStalenessRead';
import { findBalanceDrift } from '@/lib/drift';
import { loadForecasts, loadOverdrafts } from '@/lib/overdraftWatch';

const NOW = new Date('2026-03-15T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const YEAR = asOfFromDate(NOW).year;

const CANARY = 'P35GIFTCANARYQX';

/** Every table the read touches, emptied; CASCADE reaches the rows hanging off accounts. */
async function emptyTheReadTables(): Promise<void> {
  await db.query('TRUNCATE gift_transactions, gifts, accounts, budget_categories, sync_log CASCADE');
  await db.query(`DELETE FROM users WHERE display_name LIKE 'P35 Fixture%'`);
}

/** One account row with the columns these fixtures vary; everything else takes its default. */
async function account(
  id: string,
  over: {
    token?: string | null;
    bank?: string | null;
    name?: string;
    type?: string;
    lastSyncedAt?: Date | null;
    feedSuccess?: Date | null;
    feedFailure?: Date | null;
    countable?: boolean;
    valuationMode?: 'ledger' | 'valuation';
    track?: boolean;
  } = {},
): Promise<void> {
  await db.query(
    `INSERT INTO accounts (id, name, type, access_token, bank, last_synced_at, item_last_successful_update,
                           item_last_failed_update, countable, valuation_mode, track_transactions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id, over.name ?? `Fixture Checking ${id}`, over.type ?? 'depository', over.token ?? null, over.bank ?? null,
      over.lastSyncedAt ?? null, over.feedSuccess ?? null, over.feedFailure ?? null,
      over.countable ?? false, over.valuationMode ?? 'ledger', over.track ?? true,
    ],
  );
}

async function category(name: string, landscape: 'operational' | 'capital' = 'operational'): Promise<number> {
  // A twelve-unit annual budget is one unit a month: small, fabricated, and enough for one
  // single-digit month to breach it.
  const r = await db.query<{ id: number }>(
    `INSERT INTO budget_categories (name, annual_budget, landscape, control_mode)
     VALUES ($1, 12, $2, 'discretionary') RETURNING id`,
    [name, landscape],
  );
  return r.rows[0].id;
}

let txnSeq = 0;
async function txn(
  accountId: string,
  date: string,
  mappedCategory: string,
  over: { hidden?: boolean; name?: string; merchant?: string; note?: string } = {},
): Promise<number> {
  txnSeq += 1;
  const r = await db.query<{ id: number }>(
    `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, merchant_name, mapped_category, hidden, note)
     VALUES ($1, $2, $3, 3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      `p35_txn_${txnSeq}`, accountId, date, over.name ?? 'Fixture purchase', over.merchant ?? 'Fixture Shop',
      mappedCategory, over.hidden ?? false, over.note ?? null,
    ],
  );
  return r.rows[0].id;
}

async function syncLog(trigger: 'scheduler' | 'manual_sync', ranAt: Date): Promise<void> {
  await db.query(
    `INSERT INTO sync_log (ran_at, trigger, phase, synced) VALUES ($1, $2, 'plain', 0)`,
    [ranAt, trigger],
  );
}

/** An episode below a cushion of five; `closedAt` null keeps it open. */
async function episode(accountId: string, lastSeenAt: Date, closedAt: Date | null): Promise<void> {
  await db.query(
    `INSERT INTO overdraft_episodes (account_id, opened_at, closed_at, cushion, low_balance, last_balance, last_seen_at)
     VALUES ($1, $2, $3, 5, 1, 1, $4)`,
    [accountId, new Date(lastSeenAt.getTime() - DAY), closedAt, lastSeenAt],
  );
}

/** A forecast below a cushion of five; `closedAt` null keeps it open. */
async function forecast(accountId: string, projectedAt: Date, closedAt: Date | null): Promise<void> {
  await db.query(
    `INSERT INTO overdraft_forecasts (account_id, opened_at, closed_at, closed_reason, cushion, balance, projected_low, low_on, charges, projected_at)
     VALUES ($1, $2, $3, $4, 5, 6, 1, '2026-03-20', $5, $6)`,
    [
      accountId, new Date(projectedAt.getTime() - DAY), closedAt, closedAt === null ? null : 'cleared',
      JSON.stringify([{ label: 'Fixture charge', amount: 2, on: '2026-03-20' }]), projectedAt,
    ],
  );
}

/** What Postgres's session zone calls the date of `at` — the expression the read itself uses. */
async function sessionDateOf(at: Date): Promise<string> {
  const r = await db.query<{ d: string }>('SELECT ($1::timestamptz)::date::text AS d', [at]);
  return r.rows[0].d;
}

afterAll(async () => {
  await emptyTheReadTables();
});

// ─── World A: one fixture per rule, R1–R8 ──────────────────────────────────────────────────────

describe('the facts, one rule at a time', () => {
  let facts: FreshnessFacts;
  let fixtureCategoryId: number;
  let capitalTwinId: number;
  let otherCategoryId: number;
  let giftCategoryId: number;
  let heldTxnId: number;

  beforeAll(async () => {
    await emptyTheReadTables();

    // R1/R2. Item A: two accounts, the SMALLER id synced LONGER ago, so a per-account read or a key
    // taken from the newer row would both be caught. Item B: never synced, neither feed timestamp
    // (the `unknown` feed). Item C: a failure and no success. Both A and B have no bank, so an
    // identity built from bank text would merge them.
    await account('p35_sync_a1', { token: 'p35-tok-a', lastSyncedAt: ago(5 * DAY), feedSuccess: ago(2 * HOUR) });
    await account('p35_sync_a2', { token: 'p35-tok-a', lastSyncedAt: ago(1 * DAY), feedSuccess: ago(1 * HOUR) });
    await account('p35_sync_b1', { token: 'p35-tok-b' });
    await account('p35_sync_c1', { token: 'p35-tok-c', lastSyncedAt: ago(3 * DAY), feedFailure: ago(4 * HOUR) });

    // R3. Cash: two counts on one wallet (the newer must win), none on another.
    await account('p35_cash_counted', { countable: true });
    await account('p35_cash_never', { countable: true });
    await db.query(
      `INSERT INTO cash_counts (account_id, counted, expected, counted_at) VALUES ($1, 1, 1, $2), ($1, 1, 1, $3)`,
      ['p35_cash_counted', ago(40 * DAY), ago(3 * DAY)],
    );
    // R3. Valuations: two on one account (the newer DATE must win), none on another.
    await account('p35_val_valued', { valuationMode: 'valuation' });
    await account('p35_val_never', { valuationMode: 'valuation' });
    await db.query(
      `INSERT INTO account_valuations (account_id, value, source, valued_at) VALUES ($1, 4, 'manual', $2), ($1, 5, 'manual', $3)`,
      ['p35_val_valued', ago(120 * DAY), ago(10 * DAY)],
    );

    // R4. Two scheduler runs and a manual sync newer than both.
    await syncLog('scheduler', ago(50 * HOUR));
    await syncLog('scheduler', ago(30 * HOUR));
    await syncLog('manual_sync', ago(1 * HOUR));

    // R5. Account A has an open episode and a closed forecast; account B the other way round. A
    // read that ignored `closed_at` would list both accounts under both headings.
    await account('p35_od_a');
    await account('p35_od_b');
    await episode('p35_od_a', ago(1 * DAY), null);
    await forecast('p35_od_a', ago(9 * DAY), ago(8 * DAY));
    await episode('p35_od_b', ago(9 * DAY), ago(8 * DAY));
    await forecast('p35_od_b', ago(2 * DAY), null);

    // R7. One operational category with a capital twin of the same name, and a second category.
    fixtureCategoryId = await category('Fixture Category');
    capitalTwinId = await category('Fixture Category', 'capital');
    otherCategoryId = await category('Fixture Other Category');
    await account('p35_ctr_many');
    await account('p35_ctr_hidden');
    await account('p35_ctr_untracked', { track: false });
    await account('p35_ctr_lastyear');
    await account('p35_ctr_othercat');
    for (const d of [`${YEAR}-01-05`, `${YEAR}-02-05`, `${YEAR}-02-06`]) await txn('p35_ctr_many', d, 'Fixture Category');
    await txn('p35_ctr_hidden', `${YEAR}-02-05`, 'Fixture Category', { hidden: true });
    await txn('p35_ctr_untracked', `${YEAR}-02-05`, 'Fixture Category');
    await txn('p35_ctr_lastyear', `${YEAR - 1}-12-30`, 'Fixture Category');
    await txn('p35_ctr_othercat', `${YEAR}-02-05`, 'Fixture Other Category');

    // R8. A held gift: one transaction whose every text column carries the canary, linked to a gift
    // that reveals far in the future, beside an ordinary row in the same category.
    giftCategoryId = await category('Fixture Gift Category');
    await account('p35_gift_held');
    await account('p35_gift_plain');
    heldTxnId = await txn('p35_gift_held', `${YEAR}-02-10`, 'Fixture Gift Category', {
      name: `${CANARY} name`, merchant: `${CANARY} merchant`, note: `${CANARY} note`,
    });
    await txn('p35_gift_plain', `${YEAR}-02-11`, 'Fixture Gift Category');
    const people = await db.query<{ id: number }>(
      `INSERT INTO users (display_name) VALUES ('P35 Fixture Giver'), ('P35 Fixture Recipient') RETURNING id`,
    );
    const gift = await db.query<{ id: number }>(
      `INSERT INTO gifts (giver_user_id, recipient_user_id, merchant, account_id, window_start, window_end, reveal_date, state)
       VALUES ($1, $2, $3, 'p35_gift_held', '2026-01-01', '2026-12-31', '2099-12-31', 'matched') RETURNING id`,
      [people.rows[0].id, people.rows[1].id, `${CANARY} merchant`],
    );
    await db.query(
      `INSERT INTO gift_transactions (transaction_id, gift_id, prior_mapped_category, prior_rule_applied) VALUES ($1, $2, NULL, FALSE)`,
      [heldTxnId, gift.rows[0].id],
    );

    facts = await loadFreshnessFacts(NOW);
  });

  it('T35-R1: sync facts are per item — the newest last_synced_at, keyed by the smallest account id; never synced is null; no-bank items stay apart', () => {
    const byKey = new Map(facts.items.map((i) => [i.key, i]));
    expect([...byKey.keys()].sort()).toEqual(['p35_sync_a1', 'p35_sync_b1', 'p35_sync_c1']);
    // The newer of the two accounts' syncs, under the older account's (smaller) id.
    expect(byKey.get('p35_sync_a1')?.lastSyncedAt).toEqual(ago(1 * DAY));
    expect(byKey.get('p35_sync_a1')?.lastSyncedAt).toBeInstanceOf(Date);
    expect(byKey.get('p35_sync_b1')?.lastSyncedAt).toBeNull();
    // Both accounts of item A carry the same item key; nothing else does.
    const keyOf = new Map(facts.accounts.map((a) => [a.accountId, a.itemKey]));
    expect(keyOf.get('p35_sync_a1')).toBe('p35_sync_a1');
    expect(keyOf.get('p35_sync_a2')).toBe('p35_sync_a1');
    expect(keyOf.get('p35_sync_b1')).toBe('p35_sync_b1');
    expect(keyOf.get('p35_cash_counted')).toBeNull();
    // The sync producer, fed by the same grouping, keys its items identically.
    const producerKeys = classifySyncHealth(
      facts.items.map((i) => ({ key: i.key, bank: null, accountCount: 1, lastSyncedAt: i.lastSyncedAt })),
      NOW,
    ).map((h) => h.key).sort();
    expect(producerKeys).toEqual([...byKey.keys()].sort());
  });

  it('T35-R2: feed facts are per item — newest success; neither timestamp is the unknown shape; failure only is the failure-only shape', async () => {
    const byKey = new Map(facts.items.map((i) => [i.key, i]));
    expect(byKey.get('p35_sync_a1')).toMatchObject({ lastSuccessfulUpdate: ago(1 * HOUR), lastFailedUpdate: null });
    // Unknown: both null. Not the same shape as never (failure, no success).
    expect(byKey.get('p35_sync_b1')).toMatchObject({ lastSuccessfulUpdate: null, lastFailedUpdate: null });
    expect(byKey.get('p35_sync_c1')).toMatchObject({ lastSuccessfulUpdate: null, lastFailedUpdate: ago(4 * HOUR) });
    // The feed producer over the same rows reports exactly the failure-only item, and skips the
    // unknown one — which is why freshness, not a new kind, is where `unknown` becomes visible.
    const feed = await loadFeedHealth(NOW);
    expect(feed.map((f) => f.lastSuccessfulUpdate)).toEqual([null]);
  });

  it('T35-R3: cash and valuation facts — the newest count, null when never counted; the newest valuation as a date only', async () => {
    const cash = new Map(facts.cashCounts.map((c) => [c.accountId, c.lastCountedAt]));
    expect(cash.get('p35_cash_counted')).toEqual(ago(3 * DAY));
    expect(cash.get('p35_cash_never')).toBeNull();
    // Only countable accounts are listed.
    expect([...cash.keys()].sort()).toEqual(['p35_cash_counted', 'p35_cash_never']);

    const valued = new Map(facts.valuations.map((v) => [v.accountId, v.latestValuedOn]));
    expect([...valued.keys()].sort()).toEqual(['p35_val_never', 'p35_val_valued']);
    expect(valued.get('p35_val_never')).toBeNull();
    // A calendar date string in Postgres's own rendering, not an instant and not a Date object.
    const latest = valued.get('p35_val_valued');
    expect(typeof latest).toBe('string');
    expect(latest).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(latest).toBe(await sessionDateOf(ago(10 * DAY)));
    // The valuation producer, over the same rows, agrees: only the never-valued account is overdue.
    const findings = await loadValuationFindings(asOfDate(asOfFromDate(NOW)));
    expect(findings.map((f) => [f.id, f.reason])).toEqual([['p35_val_never', 'never']]);
  });

  it('T35-R4: the job fact is the newest scheduler run — a newer manual_sync row is ignored', async () => {
    expect(facts.lastSchedulerRun).toEqual(ago(30 * HOUR));
    // The job producer's loader reads the same row.
    expect(await loadJobHealth(NOW)).toEqual(jobHealth(ago(30 * HOUR), NOW));
  });

  it('T35-R5: overdraft facts are open rows only — a closed episode and a closed forecast contribute nothing', () => {
    expect(facts.overdraftSightings).toEqual([{ accountId: 'p35_od_a', lastSeenAt: ago(1 * DAY) }]);
    expect(facts.overdraftProjections).toEqual([{ accountId: 'p35_od_b', projectedAt: ago(2 * DAY) }]);
  });

  it('T35-R6: the read is clock-free — the same rows read at two instants in one year are the same facts', async () => {
    const later = new Date(NOW.getTime() + 90 * DAY);
    expect(asOfFromDate(later).year).toBe(YEAR);
    expect(await loadFreshnessFacts(later)).toEqual(facts);
  });

  it('T35-R7: contributing accounts — once by EXISTS, with the budget grid filters, operational category only', () => {
    const byCategory = new Map(facts.contributors.map((c) => [c.categoryId, c.accountIds]));
    // Three qualifying rows, one contributor. Hidden-only, untracked, other-year and other-category
    // accounts are absent.
    expect(byCategory.get(fixtureCategoryId)).toEqual(['p35_ctr_many']);
    expect(byCategory.get(otherCategoryId)).toEqual(['p35_ctr_othercat']);
    // The capital twin of the same name is not a category freshness reads.
    expect(byCategory.has(capitalTwinId)).toBe(false);
    // Each pair once across the whole read.
    const pairs = facts.contributors.flatMap((c) => c.accountIds.map((a) => `${c.categoryId}|${a}`));
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('T35-R8: gift masking — the held gift row is a contributor like any other and no canary reaches the output', async () => {
    // The fixture is what it claims: the row is held for everybody right now.
    const held = await db.query<{ held: boolean }>(`SELECT ${giftHeldSql('t')} AS held FROM transactions t WHERE t.id = $1`, [heldTxnId]);
    expect(held.rows[0].held).toBe(true);

    const byCategory = new Map(facts.contributors.map((c) => [c.categoryId, c.accountIds]));
    expect(byCategory.get(giftCategoryId)).toEqual(['p35_gift_held', 'p35_gift_plain']);

    const serialised = JSON.stringify(facts);
    expect(serialised).not.toContain(CANARY);
    expect(serialised.toLowerCase()).not.toContain(CANARY.toLowerCase());
    // Only dates, ids, flags and counts: no account name, no institution, no category name.
    expect(serialised).not.toContain('Fixture Checking');
    expect(serialised).not.toContain('Fixture Gift Category');
    expect(serialised).not.toContain('Fixture Shop');
  });
});

// ─── World B: end to end, R9 ───────────────────────────────────────────────────────────────────

describe('the facts, the real producers and the assembler together', () => {
  let findings: Finding[];

  beforeAll(async () => {
    await emptyTheReadTables();

    // One account per class, and the rows that make each producer speak.
    // Plaid-linked: synced and refreshed twenty days ago, with a Plaid balance the ledger cannot
    // match, recorded long before (the change-log row must not date the drift).
    await account('p35_e2e_plaid', {
      token: 'p35-tok-e', bank: 'Fabricated Credit Union', name: 'Fixture Checking',
      lastSyncedAt: ago(20 * DAY), feedSuccess: ago(20 * DAY),
    });
    await db.query(
      `INSERT INTO account_valuations (account_id, value, source, valued_at) VALUES ('p35_e2e_plaid', 40, 'plaid_balance', $1)`,
      [ago(200 * DAY)],
    );
    // Countable cash: counted three days ago; a second wallet never counted.
    await account('p35_e2e_cash', { countable: true });
    await account('p35_e2e_cash_never', { countable: true });
    await db.query(`INSERT INTO cash_counts (account_id, counted, expected, counted_at) VALUES ('p35_e2e_cash', 1, 1, $1)`, [ago(3 * DAY)]);
    // Valuation-mode: one valued ten days ago, one far past the producer's threshold.
    await account('p35_e2e_val', { valuationMode: 'valuation' });
    await account('p35_e2e_val_stale', { valuationMode: 'valuation' });
    await db.query(
      `INSERT INTO account_valuations (account_id, value, source, valued_at) VALUES ('p35_e2e_val', 4, 'manual', $1), ('p35_e2e_val_stale', 4, 'manual', $2)`,
      [ago(10 * DAY), ago(150 * DAY)],
    );
    // Manual ledger: no token, not countable, not valued.
    await account('p35_e2e_manual');

    for (const [name, acct] of [
      ['Fixture Plaid Category', 'p35_e2e_plaid'],
      ['Fixture Cash Category', 'p35_e2e_cash'],
      ['Fixture Valuation Category', 'p35_e2e_val'],
      ['Fixture Manual Category', 'p35_e2e_manual'],
    ] as const) {
      await category(name);
      await txn(acct, `${YEAR}-02-10`, name);
    }
    // No contributor at all: its three under-spent months make a chronic underspend.
    await category('Fixture Empty Category');

    await syncLog('scheduler', ago(3 * DAY));
    await episode('p35_e2e_plaid', ago(1 * DAY), null);
    await forecast('p35_e2e_cash', ago(5 * DAY), null);

    const facts = await loadFreshnessFacts(NOW);
    const asOf = asOfFromDate(NOW);

    // The sync producer's input, by `SyncHealthCard`'s own grouping.
    const items = await db.query<{ key: string; bank: string | null; account_count: string; last_synced_at: Date | null }>(`
      SELECT MIN(id) AS key, MIN(bank) AS bank, COUNT(*)::text AS account_count, MAX(last_synced_at) AS last_synced_at
        FROM accounts WHERE access_token IS NOT NULL GROUP BY access_token`);
    const sync = classifySyncHealth(
      items.rows.map((r) => ({ key: r.key, bank: r.bank, accountCount: Number(r.account_count), lastSyncedAt: r.last_synced_at })),
      NOW,
    );
    // The read's items agree with that grouping, key for key and instant for instant.
    expect(facts.items.map((i) => [i.key, i.lastSyncedAt])).toEqual(items.rows.map((r) => [r.key, r.last_synced_at]));

    // The wallet producer's input: each countable wallet's latest count, and a fabricated
    // single-digit balance (the producer reports a never-counted wallet only when it holds money).
    const counts = await db.query<{ id: string; name: string; last: Date | null }>(`
      SELECT a.id, a.name, (SELECT MAX(c.counted_at) FROM cash_counts c WHERE c.account_id = a.id) AS last
        FROM accounts a WHERE a.countable = TRUE ORDER BY a.id`);
    const wallets = staleWallets(
      counts.rows.map((r) => ({ accountId: r.id, name: r.name, balance: 2, lastCountedAt: r.last === null ? null : r.last.toISOString() })),
      NOW,
    );

    // The adherence producer's input: each operational category with its spend by month, from the
    // same rows and filters as the budget grid. The empty category gets three zero months so that
    // its chronic underspend is reported.
    const cats = await db.query<{ id: number; name: string; annual_budget: string; landscape: 'operational' | 'capital'; exclude_from_budget: boolean; is_income: boolean; control_mode: AdherenceInput['control_mode']; monthly_amounts: number[] | null }>(
      `SELECT id, name, annual_budget::text, landscape, exclude_from_budget, is_income, control_mode, monthly_amounts
         FROM budget_categories WHERE landscape = 'operational' ORDER BY id`,
    );
    const spend = await db.query<{ category: string; month: number; actual: string }>(
      `SELECT t.mapped_category AS category, (EXTRACT(MONTH FROM t.date)::int - 1) AS month, SUM(t.amount)::text AS actual
         FROM transactions t
        WHERE t.hidden = FALSE AND EXTRACT(YEAR FROM t.date) = $1
          AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = t.account_id AND a.track_transactions = TRUE)
        GROUP BY 1, 2`,
      [YEAR],
    );
    const adherence = detectAdherence(cats.rows.map((c): AdherenceInput => {
      const months = spend.rows.filter((s) => s.category === c.name).map((s) => ({ month: s.month, actual: Number(s.actual) }));
      return {
        id: c.id, name: c.name, annual_budget: Number(c.annual_budget), landscape: c.landscape,
        exclude_from_budget: c.exclude_from_budget, is_income: c.is_income, control_mode: c.control_mode,
        monthly_amounts: c.monthly_amounts,
        months: months.length > 0 ? months : [0, 1, 2].map((month) => ({ month, actual: 0 })),
      };
    }));

    ({ findings } = assembleFindings({
      asOf,
      freshness: { now: NOW, facts },
      adherence,
      drift: await findBalanceDrift(),
      feed: await loadFeedHealth(NOW),
      sync,
      job: await loadJobHealth(NOW),
      wallets,
      valuations: await loadValuationFindings(asOfDate(asOf)),
      overdrafts: await loadOverdrafts(),
      forecasts: await loadForecasts(),
    }));
  });

  it('T35-R9: end to end — every finding parses and carries the freshness its inputs give, one account per class', () => {
    for (const f of findings) expect(FindingSchema.safeParse(f).success, `${f.kind} parses`).toBe(true);

    const subjectOf = (f: Finding) => ('id' in f.subject ? String(f.subject.id) : f.subject.name);
    const nameOf = new Map(findings.filter((f) => f.subject.type === 'category').map((f) => [String((f.subject as { id: number }).id), f.subject.name]));
    const seen = Object.fromEntries(findings.map((f) => [
      `${f.kind}|${f.subject.type === 'category' ? nameOf.get(subjectOf(f)) : subjectOf(f)}`,
      [f.freshness.state, f.freshness.basis, f.freshness.undatedInputs],
    ]));

    expect(seen).toEqual({
      // Plaid-linked: sync and feed both twenty days old, equal ages tie-break to the sync.
      'budget-breach|Fixture Plaid Category': ['stale', 'sync', 0],
      // Countable cash, counted three days ago.
      'budget-breach|Fixture Cash Category': ['fresh', 'cash-count', 0],
      // Valuation-mode, valued ten days ago.
      'budget-breach|Fixture Valuation Category': ['fresh', 'valuation', 0],
      // Manual ledger: nothing in the database dates it.
      'budget-breach|Fixture Manual Category': ['undated', 'none', 1],
      // No contributing account at all.
      'budget-underspend|Fixture Empty Category': ['undated', 'none', 1],
      // Dated by the item's sync, not by the two-hundred-day-old change-log row.
      'balance-drift|p35_e2e_plaid': ['stale', 'sync', 0],
      'feed-degraded|Fabricated Credit Union': ['stale', 'feed', 0],
      'sync-stale|Fabricated Credit Union': ['stale', 'sync', 0],
      'job-overdue|daily-job': ['stale', 'job-run', 0],
      'cash-uncounted|p35_e2e_cash_never': ['never', 'cash-count', 0],
      'valuation-stale|p35_e2e_val_stale': ['stale', 'valuation', 0],
      'overdraft-open|p35_e2e_plaid': ['fresh', 'overdraft-sighting', 0],
      'overdraft-forecast|p35_e2e_cash': ['stale', 'overdraft-projection', 0],
    });

    // Precision survives the whole path: the valuation basis is a date, the others instants.
    for (const f of findings) {
      if (f.freshness.lastObserved === null) continue;
      if (f.freshness.basis === 'valuation') expect(f.freshness.lastObserved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      else expect(f.freshness.lastObserved).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    // The sync-dated findings carry the seeded instant and its whole-day age.
    const drift = findings.find((f) => f.kind === 'balance-drift');
    expect(drift?.freshness).toEqual({
      state: 'stale', basis: 'sync', lastObserved: ago(20 * DAY).toISOString(), ageDays: 20, undatedInputs: 0,
    });
  });
});
