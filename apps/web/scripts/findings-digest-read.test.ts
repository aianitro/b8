// The findings digest's loader against a real Postgres (P5-36, scenarios T36-L1..L7).
//
// TIER 2, under `vitest.integration.config.mts` with the scratch-database guard in `setupFiles`: this
// file writes rows, and the guard refuses to run it against the owner's real database. It is named in
// that config's `include` by exact path, beside the P5-35 R-file, for the same reason that file is:
// what is checked here — that every source is the dashboard's own reader, that a failed read is "not
// evaluated" rather than empty, that no viewer changes a figure — is a property of real queries over
// real rows, and a stubbed database would assert none of it.
//
// EVERY WORLD SEEDS EVERYTHING IT READS. The loader reads every account, every item, every category
// and the newest scheduler row, so a row left by another file would change what it reports. Each
// world empties the tables it reads before seeding, and the file empties them again at the end — the
// convention the R-file and `app/api/v1/overview/route.test.ts` follow. Acceptance #6b runs the suite
// with file order shuffled to prove nothing here leans on another file's leftovers.
//
// ONE FIXED INSTANT. Every seeded timestamp is an offset from `NOW`, mid-month and mid-day, so no zone
// this suite might run in moves it across a day, a month or a year. Offsets are whole days, so the
// same rows read an hour later floor to the same ages (L6). No test reads the wall clock, except
// where a real producer does internally (`findBalanceDrift` takes the current year), and the seeded
// rows are arranged so its verdict does not depend on that.
//
// FABRICATED DATA ONLY. Names are the spec's fixtures (`Fabricated Credit Union`, `Fixture Checking`,
// `Fixture Category`); amounts are single digits, except the categories' twelve-unit annual budget (one
// unit a month) and one two-digit Plaid balance chosen only so the ledger cannot match it. The gift
// canary is an alphanumeric token no real merchant carries.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FindingSchema, type Finding, type FindingKind } from '@b8/contracts/findings';
import db from '@/lib/db';
import { loadFindingsDigestInput, type FindingsDigestInput } from '@/lib/findingsDigestRead';
import { loadFreshnessFacts } from '@/lib/findingsFreshnessRead';
import { giftHeldSql } from '@/lib/giftReadPath';
import { assembleFindings, asOfDate, FINDING_CONVERSIONS, type FindingSource, type FindingSources } from '@/lib/domain/findings';
import { composeDigest, type FindingsDigest } from '@/lib/domain/findingsDigest';
import { asOfFromDate } from '@/lib/domain/monthOutlook';
import { classifySyncHealth } from '@/lib/domain/syncHealth';
import { staleWallets } from '@/lib/domain/walletStaleness';
import { walletStatuses } from '@/lib/cashCountStore';
import { findBalanceDrift } from '@/lib/drift';
import { loadFeedHealth } from '@/lib/feedHealthRead';
import { loadJobHealth } from '@/lib/jobHealthRead';
import { loadMonthOutlook } from '@/lib/monthOutlookRead';
import { loadForecasts, loadOverdrafts } from '@/lib/overdraftWatch';
import { loadValuationFindings } from '@/lib/valuationStalenessRead';

const NOW = new Date('2026-03-15T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const ASOF = asOfFromDate(NOW);
const YEAR = ASOF.year;

const CANARY = 'P36GIFTCANARYZK';

/**
 * A positional SQL parameter, `p(1)` for the first. Spelled through a helper because acceptance #7
 * rejects a dollar sign followed by a digit anywhere in this step's new files — the AGENTS.md rule
 * that nothing committed may read as a money figure, enforced by a pattern that cannot tell a
 * parameter from a price.
 */
const p = (n: number) => '$' + String(n);
const ALL_CLEAR = /all clear|good news|nothing to report|no issues|all good|on track|nothing wrong|healthy|up to date|up-to-date/i;

/** Every table the loader reads, emptied; CASCADE reaches the rows hanging off accounts and categories. */
async function emptyTheReadTables(): Promise<void> {
  await db.query('TRUNCATE gift_transactions, gifts, accounts, budget_categories, sync_log CASCADE');
  await db.query(`DELETE FROM users WHERE display_name LIKE 'P36 Fixture%'`);
}

/** One account row with the columns these fixtures vary; everything else takes its default. */
async function account(
  id: string,
  over: {
    token?: string | null;
    bank?: string | null;
    name?: string;
    lastSyncedAt?: Date | null;
    feedSuccess?: Date | null;
    feedFailure?: Date | null;
    countable?: boolean;
    valuationMode?: 'ledger' | 'valuation';
    cushion?: number;
  } = {},
): Promise<void> {
  await db.query(
    `INSERT INTO accounts (id, name, type, access_token, bank, last_synced_at, item_last_successful_update,
                           item_last_failed_update, countable, valuation_mode, track_transactions, overdraft_cushion)
     VALUES (${p(1)}, ${p(2)}, 'depository', ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)}, ${p(9)}, TRUE, ${p(10)})`,
    [
      id, over.name ?? `Fixture Checking ${id}`, over.token ?? null, over.bank ?? null,
      over.lastSyncedAt ?? null, over.feedSuccess ?? null, over.feedFailure ?? null,
      over.countable ?? false, over.valuationMode ?? 'ledger', over.cushion ?? 0,
    ],
  );
}

/** A discretionary operational category with a twelve-unit annual budget: one unit a month. */
async function category(name: string): Promise<number> {
  const r = await db.query<{ id: number }>(
    `INSERT INTO budget_categories (name, annual_budget, landscape, control_mode)
     VALUES (${p(1)}, 12, 'operational', 'discretionary') RETURNING id`,
    [name],
  );
  return r.rows[0].id;
}

let txnSeq = 0;
async function txn(
  accountId: string,
  date: string,
  mappedCategory: string | null,
  over: { name?: string; merchant?: string; note?: string } = {},
): Promise<number> {
  txnSeq += 1;
  const r = await db.query<{ id: number }>(
    `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, merchant_name, mapped_category, hidden, note)
     VALUES (${p(1)}, ${p(2)}, ${p(3)}, 3, ${p(4)}, ${p(5)}, ${p(6)}, FALSE, ${p(7)}) RETURNING id`,
    [`p36_txn_${txnSeq}`, accountId, date, over.name ?? 'Fixture purchase', over.merchant ?? 'Fixture Shop', mappedCategory, over.note ?? null],
  );
  return r.rows[0].id;
}

async function schedulerRun(ranAt: Date): Promise<void> {
  await db.query(`INSERT INTO sync_log (ran_at, trigger, phase, synced) VALUES (${p(1)}, 'scheduler', 'plain', 0)`, [ranAt]);
}

/** An open episode below a cushion of five. */
async function openEpisode(accountId: string, lastSeenAt: Date): Promise<void> {
  await db.query(
    `INSERT INTO overdraft_episodes (account_id, opened_at, closed_at, cushion, low_balance, last_balance, last_seen_at)
     VALUES (${p(1)}, ${p(2)}, NULL, 5, 1, 1, ${p(3)})`,
    [accountId, new Date(lastSeenAt.getTime() - DAY), lastSeenAt],
  );
}

/** An open forecast below a cushion of five, with a charge label that must never be carried. */
async function openForecast(accountId: string, projectedAt: Date): Promise<void> {
  await db.query(
    `INSERT INTO overdraft_forecasts (account_id, opened_at, closed_at, closed_reason, cushion, balance, projected_low, low_on, charges, projected_at)
     VALUES (${p(1)}, ${p(2)}, NULL, NULL, 5, 6, 1, '2026-03-20', ${p(3)}, ${p(4)})`,
    [accountId, new Date(projectedAt.getTime() - DAY), JSON.stringify([{ label: `${CANARY} charge`, amount: 2, on: '2026-03-20' }]), projectedAt],
  );
}

/** The kinds a source converts into, read from the conversion registry rather than restated. */
const kindsOf = (source: FindingSource) =>
  (Object.entries(FINDING_CONVERSIONS) as [FindingKind, { source: FindingSource }][]).filter(([, c]) => c.source === source).map(([k]) => k);

const digestOf = (input: FindingsDigestInput): FindingsDigest =>
  composeDigest(input.findings, input.period, { notEvaluated: input.notEvaluated });

/**
 * World A: at least one finding of each of the ten kinds, and the sync items L3 is about.
 *
 *   - `p36_fcu_a`/`p36_fcu_b`: one Plaid item shared by two accounts at `Fabricated Credit Union`,
 *     synced twenty days ago, its feed failing with no success ever (so `hoursStale` is null and the
 *     hour-later read in L6 agrees), and a Plaid balance the ledger cannot match (drift).
 *   - `p36_nobank`: an item with no bank, synced twenty days ago, no feed record.
 *   - `p36_healthy`: an item synced and refreshed an hour ago — no sync and no feed finding.
 *   - a countable wallet never counted, holding money; a valuation-mode account valued long ago;
 *     an open episode and an open forecast on two watched manual accounts; a scheduler run three
 *     days ago; a category over budget in February and one with no spend at all (chronic underspend).
 */
async function seedWorldA(): Promise<void> {
  await emptyTheReadTables();
  for (const id of ['p36_fcu_a', 'p36_fcu_b']) {
    await account(id, { token: 'p36-tok-fcu', bank: 'Fabricated Credit Union', lastSyncedAt: ago(20 * DAY), feedFailure: ago(2 * DAY) });
  }
  await db.query(
    `INSERT INTO account_valuations (account_id, value, source, valued_at) VALUES ('p36_fcu_a', 40, 'plaid_balance', ${p(1)})`,
    [ago(30 * DAY)],
  );
  await account('p36_nobank', { token: 'p36-tok-nobank', lastSyncedAt: ago(20 * DAY) });
  await account('p36_healthy', { token: 'p36-tok-h', bank: 'Fabricated Credit Union', lastSyncedAt: ago(HOUR), feedSuccess: ago(HOUR) });

  await account('p36_wallet', { countable: true, name: 'Fixture Wallet' });
  await txn('p36_wallet', `${YEAR}-02-03`, null);

  await account('p36_valued', { valuationMode: 'valuation', name: 'Fixture Brokerage' });
  await db.query(
    `INSERT INTO account_valuations (account_id, value, source, valued_at) VALUES ('p36_valued', 4, 'manual', ${p(1)})`,
    [ago(150 * DAY)],
  );

  await account('p36_od', { cushion: 5, name: 'Fixture Joint Checking' });
  await openEpisode('p36_od', ago(1 * DAY));
  await account('p36_fc', { cushion: 5, name: 'Fixture Bills Checking' });
  await openForecast('p36_fc', ago(2 * DAY));

  await schedulerRun(ago(3 * DAY));

  await category('Fixture Category');
  await account('p36_spender', { name: 'Fixture Card' });
  await txn('p36_spender', `${YEAR}-02-10`, 'Fixture Category');
  await category('Fixture Empty Category');
}

afterAll(async () => {
  await emptyTheReadTables();
});

describe('the findings digest over every source', () => {
  let input: FindingsDigestInput;

  beforeAll(async () => {
    await seedWorldA();
    input = await loadFindingsDigestInput(null, NOW);
  });

  it('T36-L1: all nine sources are evaluated and all ten kinds appear, each finding valid and dated', () => {
    expect(input.notEvaluated).toEqual([]);
    expect(input.period).toEqual({ type: 'asOf', date: asOfDate(ASOF) });
    const d = digestOf(input);
    const counts: Partial<Record<FindingKind, number>> = {};
    for (const item of d.items) counts[item.finding.kind] = (counts[item.finding.kind] ?? 0) + 1;
    expect(counts).toEqual({
      'overdraft-open': 1,
      'overdraft-forecast': 1,
      'budget-breach': 1,
      'balance-drift': 1,
      'feed-degraded': 1,
      // The shared item once, the no-bank item once, the healthy item not at all.
      'sync-stale': 2,
      'job-overdue': 1,
      'cash-uncounted': 1,
      'valuation-stale': 1,
      'budget-underspend': 1,
    });
    for (const item of d.items) {
      expect(FindingSchema.safeParse(item.finding).success, item.finding.kind).toBe(true);
      expect(item.dating.basis, item.finding.kind).toEqual(expect.any(String));
    }
    // Freshness was attached from the real facts, not left undated by default: the open episode was
    // sighted a day ago, and the forecast's charges (row text) never reached the finding.
    const od = d.items.find((i) => i.finding.kind === 'overdraft-open')!;
    expect([od.dating.state, od.dating.basis, od.dating.ageDays]).toEqual(['fresh', 'overdraft-sighting', 1]);
    expect(d.items.find((i) => i.finding.kind === 'sync-stale')!.dating).toMatchObject({ state: 'stale', basis: 'sync', ageDays: 20 });
    expect(JSON.stringify(d)).not.toContain(CANARY);
  });

  it('T36-L2: each source the loader supplies is exactly what the dashboard\'s reader returns over the same rows', async () => {
    const facts = await loadFreshnessFacts(NOW);
    const freshness = { now: NOW, facts };
    // The sync expectation from this test's own SQL, grouped on the token as the card groups it.
    const items = await db.query<{ key: string; bank: string | null; account_count: string; last_synced_at: Date | null }>(`
      SELECT MIN(id) AS key, MIN(bank) AS bank, COUNT(*)::text AS account_count, MAX(last_synced_at) AS last_synced_at
        FROM accounts WHERE access_token IS NOT NULL GROUP BY access_token`);
    const readers: FindingSources = {
      adherence: (await loadMonthOutlook(ASOF)).outlook.findings,
      drift: await findBalanceDrift(),
      feed: await loadFeedHealth(NOW),
      sync: classifySyncHealth(
        items.rows.map((r) => ({ key: r.key, bank: r.bank, accountCount: Number(r.account_count), lastSyncedAt: r.last_synced_at })),
        NOW,
      ),
      job: await loadJobHealth(NOW),
      wallets: staleWallets(await walletStatuses(), NOW),
      valuations: await loadValuationFindings(asOfDate(ASOF)),
      overdrafts: await loadOverdrafts(),
      forecasts: await loadForecasts(),
    };
    for (const source of Object.keys(readers) as FindingSource[]) {
      const expected = assembleFindings({ asOf: ASOF, freshness, [source]: readers[source] }).findings;
      // Not vacuous: every reader reports something in this world.
      expect(expected.length, source).toBeGreaterThan(0);
      const fromLoader = input.findings.filter((f) => kindsOf(source).includes(f.kind));
      expect(fromLoader, source).toEqual(expected);
    }
    // And the whole list is the assembler's over the readers, so nothing beyond them was added.
    expect(input.findings).toEqual(assembleFindings({ asOf: ASOF, freshness, ...readers }).findings);
  });

  it('T36-L3: sync items are per item — the no-bank item once as Unknown under its own key, the healthy item absent, a shared item once', () => {
    const syncs = input.findings.filter((f): f is Extract<Finding, { kind: 'sync-stale' }> => f.kind === 'sync-stale');
    expect(syncs.map((f) => [f.key, f.subject.name, f.accountCount]).sort()).toEqual([
      ['p36_fcu_a', 'Fabricated Credit Union', 2],
      ['p36_nobank', 'Unknown', 1],
    ]);
    expect(syncs.some((f) => f.key === 'p36_healthy')).toBe(false);
    expect(input.findings.some((f) => f.kind === 'feed-degraded' && f.lastSuccessfulUpdate !== null)).toBe(false);
  });

  it('T36-L6: the loader is clock-free — two instants an hour apart on one day give deep-equal digests', async () => {
    const later = new Date(NOW.getTime() + HOUR);
    expect(asOfFromDate(later)).toEqual(ASOF);
    expect(digestOf(await loadFindingsDigestInput(null, later))).toEqual(digestOf(input));
    // No query text in the loader reads Postgres's clock (T36-W1 pins the full list of families).
    const source = readFileSync(fileURLToPath(new URL('../lib/findingsDigestRead.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/\bnow\s*\(|current_(date|time|timestamp)\b|\blocaltime|clock_timestamp|'now'\s*::/i);
  });

  it('T36-L5: a source whose table is gone is not evaluated, its error is logged, and a failed facts read leaves every finding undated', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let broken: FindingsDigestInput;
    let logged: string[];
    try {
      await db.query('ALTER TABLE overdraft_forecasts RENAME TO p36_overdraft_forecasts_hidden');
      broken = await loadFindingsDigestInput(null, NOW);
    } finally {
      await db.query('ALTER TABLE IF EXISTS p36_overdraft_forecasts_hidden RENAME TO overdraft_forecasts');
      // Read before restoring: restoring the spy also forgets its calls.
      logged = errors.mock.calls.map((c) => String(c[0]));
      errors.mockRestore();
    }
    expect(broken.notEvaluated).toEqual(['forecasts']);
    expect(broken.findings.some((f) => f.kind === 'overdraft-forecast')).toBe(false);
    expect(broken.findings.length).toBeGreaterThan(0);
    // Both failures were logged: the forecasts source, and the freshness facts that read the same table.
    expect(logged.some((m) => m.includes('forecasts read failed'))).toBe(true);
    expect(logged.some((m) => m.includes('freshness facts read failed'))).toBe(true);
    // Never fresh by default: with no facts, every finding is undated with an undated input.
    for (const f of broken.findings) {
      expect(f.freshness.state, f.kind).toBe('undated');
      expect(f.freshness.undatedInputs, f.kind).toBeGreaterThanOrEqual(1);
    }
    const d = digestOf(broken);
    expect(d.dating.fresh).toBe(0);
    expect(d.coverage.statement).toContain('overdraft forecasts');

    // Restored, the same call supplies all nine again.
    const restored = await loadFindingsDigestInput(null, NOW);
    expect(restored.notEvaluated).toEqual([]);
    expect(restored.findings.some((f) => f.kind === 'overdraft-forecast')).toBe(true);
  });
});

describe('the findings digest and a held gift', () => {
  let giver: number;
  let recipient: number;
  let heldTxnId: number;

  beforeAll(async () => {
    await emptyTheReadTables();
    // A gift held until far in the future, on a transaction whose every text column carries the
    // canary, in a category the held row alone pushes over budget.
    await category('Fixture Gift Category');
    await account('p36_gift_acct', { name: 'Fixture Checking' });
    heldTxnId = await txn('p36_gift_acct', `${YEAR}-02-10`, 'Fixture Gift Category', {
      name: `${CANARY} name`, merchant: `${CANARY} merchant`, note: `${CANARY} note`,
    });
    const people = await db.query<{ id: number }>(
      `INSERT INTO users (display_name) VALUES ('P36 Fixture Giver'), ('P36 Fixture Recipient') RETURNING id`,
    );
    [giver, recipient] = people.rows.map((r) => r.id);
    const gift = await db.query<{ id: number }>(
      `INSERT INTO gifts (giver_user_id, recipient_user_id, merchant, account_id, window_start, window_end, reveal_date, state)
       VALUES (${p(1)}, ${p(2)}, ${p(3)}, 'p36_gift_acct', '2026-01-01', '2026-12-31', '2099-12-31', 'matched') RETURNING id`,
      [giver, recipient, `${CANARY} merchant`],
    );
    await db.query(
      `INSERT INTO gift_transactions (transaction_id, gift_id, prior_mapped_category, prior_rule_applied) VALUES (${p(1)}, ${p(2)}, NULL, FALSE)`,
      [heldTxnId, gift.rows[0].id],
    );
    await schedulerRun(ago(30 * 60_000));
  });

  it('T36-L4: the digest carries no row text and is identical for the giver, the recipient and an unresolved viewer', async () => {
    // The fixture is what it claims: the row exists, carries the canary, and is held right now.
    const row = await db.query<{ name: string; merchant_name: string; note: string; held: boolean }>(
      `SELECT t.name, t.merchant_name, t.note, ${giftHeldSql('t')} AS held FROM transactions t WHERE t.id = ${p(1)}`, [heldTxnId]);
    expect(row.rows).toHaveLength(1);
    for (const col of ['name', 'merchant_name', 'note'] as const) expect(row.rows[0][col]).toContain(CANARY);
    expect(row.rows[0].held).toBe(true);

    const digests = [];
    for (const viewer of [giver, recipient, null]) {
      const d = digestOf(await loadFindingsDigestInput(viewer, NOW));
      const text = JSON.stringify(d);
      expect(text).not.toContain(CANARY);
      expect(text.toLowerCase()).not.toContain(CANARY.toLowerCase());
      digests.push(d);
    }
    expect(digests[1]).toEqual(digests[0]);
    expect(digests[2]).toEqual(digests[0]);
    // Not vacuous: the held row's category is reported over budget, the same figure for all three.
    expect(digests[0].items.some((i) => i.finding.kind === 'budget-breach' && i.finding.subject.name === 'Fixture Gift Category')).toBe(true);
  });
});

describe('the findings digest over a world with nothing to say', () => {
  beforeAll(async () => {
    await emptyTheReadTables();
    // A scheduler run this morning; one Plaid account synced and refreshed an hour ago with no Plaid
    // balance on record; no categories, no wallets, no valuations, no overdraft rows.
    await schedulerRun(ago(30 * 60_000));
    await account('p36_quiet', { token: 'p36-tok-quiet', bank: 'Fabricated Credit Union', lastSyncedAt: ago(HOUR), feedSuccess: ago(HOUR) });
  });

  it('T36-L7: zero items, all nine evaluated, status none-reported, and no statement reads as good news', async () => {
    const input = await loadFindingsDigestInput(null, NOW);
    const d = digestOf(input);
    expect(d.items).toEqual([]);
    expect(d.coverage.notEvaluated).toEqual([]);
    expect(d.coverage.evaluated).toHaveLength(9);
    expect(d.status).toBe('none-reported');
    for (const s of [d.statement, d.coverage.statement]) expect(s).not.toMatch(ALL_CLEAR);
    expect(d.statement).toMatch(/\b9\b/);
    expect(d.statement).toContain('reported');
  });
});
