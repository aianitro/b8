// `GET /api/v1/overview` against a real Postgres, with a fabricated portfolio seeded underneath it.
//
// TIER 2, AND IT RUNS UNDER ITS OWN CONFIG. `vitest.config.mts` is unit tests only and does not
// collect `app/**`; this file is reached by `vitest.integration.config.mts`, which additionally
// wires the scratch-database guard into `setupFiles`. That guard is the reason this file is allowed
// to write rows at all: it refuses, before any pool exists, to run against the database name this
// repo treats as the owner's real financial data.
//
// EVERY ROW BELOW IS FABRICATED, and the distinguishing values are chosen to be unmistakable in a
// failure message: a hidden transaction of 9999.99, a capital budget of 50000.00, an
// exclude_from_budget category of 2000.00. The exact seed is transcribed into EVIDENCE.md so an
// assertion can be checked against the row it claims to test.
//
// WHY THE FOUR SHARED READERS ARE IMPORTED HERE. Not for their SQL — the endpoint calls them
// through `lib/overviewRead.ts` — but to assert the endpoint AGREES with them. That is the finding
// BUILD.md §14's own worked example ends on: a handler that recomputes a shared figure passes every
// test checking the figure looks plausible and fails only the test checking it matches the other
// caller. These fixtures are that test.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import db from '@/lib/db';
import { findBalanceDrift } from '@/lib/drift';
import { loadFeedHealth } from '@/lib/feedHealthRead';
import { loadMonthOutlook } from '@/lib/monthOutlookRead';
import { loadYearEnd } from '@/lib/yearEndRead';
import { asOfFromDate } from '@/lib/domain/monthOutlook';
import { wireMoney } from '@/lib/overviewRead';
import { OverviewResponseSchema, type OverviewData } from '@b8/contracts/overview';
import { GET } from './route';

const asOf = asOfFromDate(new Date());

/** The endpoint's response as a consumer receives it — envelope, JSON-serialized, validated. */
async function fetchOverview(): Promise<OverviewData> {
  const response = await GET();
  const body = await response.json();
  const parsed = OverviewResponseSchema.parse(body);
  if (!parsed.success) throw new Error(`the endpoint returned its error branch: ${parsed.error.code}`);
  return parsed.data;
}

/** Every category name the outlook mentions, across all four of its partitions. */
function outlookCategoryNames(outlook: OverviewData['monthOutlook']): string[] {
  return [...outlook.sayingNo, ...outlook.holding, ...outlook.withheld, ...outlook.offCycleElsewhere]
    .map((c) => c.category);
}

let payload: OverviewData;

beforeAll(async () => {
  // The scratch database is this suite's alone, so it is emptied rather than worked around. Every
  // figure asserted below is exact because these are the only rows in it.
  await db.query(`
    TRUNCATE transactions, account_valuations, account_balances, budget_categories, accounts
    RESTART IDENTITY CASCADE
  `);

  await db.query(`
    INSERT INTO accounts (id, name, type, landscape, valuation_mode, track_transactions,
                          access_token, bank, item_last_successful_update, item_last_failed_update)
    VALUES
      -- TWO ACCOUNTS, ONE PLAID ITEM, both stale. An item is the unit Plaid refreshes and the unit
      -- that fails, so this pair must produce ONE finding of accountCount 2 and not two findings.
      ('p111_checking',  'Fabricated Checking',  'depository', 'operational', 'ledger', TRUE,
       'p111-item-alpha', 'Fabricated Bank Alpha', NOW() - INTERVAL '96 hours', NULL),
      ('p111_savings',   'Fabricated Savings',   'depository', 'operational', 'ledger', TRUE,
       'p111-item-alpha', 'Fabricated Bank Alpha', NOW() - INTERVAL '96 hours', NULL),
      -- The drift pair: the SAME seeded ledger/Plaid disagreement on a ledger-mode account and on a
      -- valuation-mode one. Their item is fresh, so neither contributes a feed finding and the
      -- feedHealth assertion stays exact.
      ('p111_ledger_drift',    'Fabricated Ledger Card',  'depository', 'operational', 'ledger',    TRUE,
       'p111-item-beta', 'Fabricated Bank Beta', NOW(), NULL),
      ('p111_valuation_drift', 'Fabricated Brokerage',    'depository', 'capital',     'valuation', TRUE,
       'p111-item-beta', 'Fabricated Bank Beta', NOW(), NULL)
  `);

  await db.query(`
    INSERT INTO budget_categories (name, annual_budget, landscape, exclude_from_budget, is_income, control_mode)
    VALUES
      ('P111 Groceries',    1200.00,  'operational', FALSE, FALSE, 'discretionary'),
      -- Operational and NOT hidden — the only thing keeping it out of the budget totals is the
      -- exclude_from_budget flag, which is a different flag from hidden and must be checked
      -- independently of it.
      ('P111 Excluded Ops', 2000.00,  'operational', TRUE,  FALSE, 'discretionary'),
      -- Capital, and discretionary on purpose: landscape is then the ONLY reason it is absent from
      -- the operational verdict, so a fixture asserting its absence is asserting the landscape rule
      -- rather than the control-mode rule.
      ('P111 Remodel',      50000.00, 'capital',     FALSE, FALSE, 'discretionary'),
      ('P111 Salary',       60000.00, 'operational', FALSE, TRUE,  'fixed')
  `);

  await db.query(`
    INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, merchant_name,
                              mapped_category, hidden)
    VALUES
      ('p111_txn_grocery',  'p111_checking', CURRENT_DATE,  120.00, 'Fabricated Grocer',  'Fabricated Grocer',  'P111 Groceries',    FALSE),
      -- The refund. It must NET against its category's spend: not ignored, not double counted.
      ('p111_txn_refund',   'p111_checking', CURRENT_DATE,  -20.00, 'Fabricated Return',  'Fabricated Grocer',  'P111 Groceries',    FALSE),
      -- Hidden, dated today, created_at NOW() by column default — inside every window this payload
      -- uses — and carrying a value that appears nowhere else in the seed.
      ('p111_txn_hidden',   'p111_checking', CURRENT_DATE, 9999.99, 'Fabricated Hidden',  'Fabricated Hidden',  'P111 Groceries',    TRUE),
      ('p111_txn_capital',  'p111_checking', CURRENT_DATE, 4000.00, 'Fabricated Remodel', 'Fabricated Remodel', 'P111 Remodel',      FALSE),
      ('p111_txn_excluded', 'p111_checking', CURRENT_DATE,  300.00, 'Fabricated Excluded','Fabricated Excluded','P111 Excluded Ops', FALSE),
      -- Uncategorized: not hidden, not spend the app can classify.
      ('p111_txn_uncat',    'p111_checking', CURRENT_DATE,   77.00, 'Fabricated Unfiled', 'Fabricated Unfiled', NULL,                FALSE),
      -- Income, this ledger's convention: negative is money in.
      ('p111_txn_salary',   'p111_checking', CURRENT_DATE,-5000.00, 'Fabricated Payroll', 'Fabricated Payroll', 'P111 Salary',       FALSE)
  `);

  // The identical disagreement on both accounts: a $1,000.00 opening balance, no transactions, and
  // Plaid reporting $1,500.00. Only the ledger-mode account may produce a finding.
  await db.query(`
    INSERT INTO account_balances (account_id, year, beginning_balance)
    VALUES ('p111_ledger_drift', $1, 1000.00), ('p111_valuation_drift', $1, 1000.00)
  `, [asOf.year]);

  await db.query(`
    INSERT INTO account_valuations (account_id, value, source, valued_at)
    VALUES ('p111_ledger_drift', 1500.00, 'plaid_balance', NOW()),
           ('p111_valuation_drift', 1500.00, 'plaid_balance', NOW())
  `);

  payload = await fetchOverview();
});

afterAll(async () => {
  await db.end();
});

describe('GET /api/v1/overview, against a seeded scratch database', () => {
  it('the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio', async () => {
    // The whole envelope, from the real handler, through `Response.json`, parsed by the composed
    // schema the contract exports — not by one a test wrote for itself. `OverviewResponseSchema` is
    // `apiResponseSchema(OverviewDataSchema)`, pinned once in `shared/contracts/overview.ts` so this
    // fixture and a future mobile client cannot pin different things.
    const response = await GET();
    const body = await response.json();
    const parsed = OverviewResponseSchema.parse(body);
    expect(parsed.success).toBe(true);

    // Fourteen sections, all present, none optional. Eleven at P1-11; P1-11a added
    // `monthCategories`, `watchlist` and `jobHealth`, which the dashboard could not be fed without.
    expect(Object.keys(payload).sort()).toEqual([
      'asOf', 'budgetVsActual', 'driftFindings', 'feedHealth', 'jobHealth', 'monthCategories',
      'monthOutlook', 'monthlySpending', 'recentArrivals', 'stats', 'today', 'watchlist', 'week',
      'yearEnd',
    ].sort());

    // The one clock read, reaching both places that state it.
    expect(payload.asOf).toEqual({ year: asOf.year, month: asOf.month, day: asOf.day });
    expect(payload.monthOutlook.asOf).toEqual(payload.asOf);

    // And the figures the seed pins exactly, so "it validates" is not the only thing proved: the
    // schema would accept any two-decimal string, and these are the right ones.
    expect(payload.stats.budget).toBe('1200.00');
    expect(payload.stats.spent).toBe('100.00');
    expect(payload.stats.remaining).toBe('1100.00');
    expect(payload.stats.totalTxns).toBe(6);
  });

  it('a hidden transaction dated within the last 36 hours does not appear in recentArrivals', async () => {
    // `p111_txn_hidden` is 9999.99, dated today, created_at NOW() — inside the 36-hour arrival
    // window, inside the day, the week, the month and the year every other section reads.
    expect(payload.recentArrivals.map((r) => r.amount)).not.toContain('9999.99');
    expect(payload.recentArrivals.map((r) => r.label)).not.toContain('Fabricated Hidden');

    // The rest of the window IS there, so this is an exclusion and not an empty result: six
    // non-hidden rows were seeded and six arrived.
    expect(payload.recentArrivals).toHaveLength(6);

    // And the flag is honoured everywhere, not only here. The value appears nowhere in the payload
    // — not in stats, today, week, monthlySpending or budgetVsActual — which is the whole of
    // negative control #1 in one assertion the seed's distinctive amount makes possible.
    expect(JSON.stringify(payload)).not.toContain('9999.99');
  });

  it('a transaction mapped to a capital-landscape category is excluded from stats, monthlySpending and budgetVsActual', async () => {
    // `p111_txn_capital` is 4000.00 against `P111 Remodel`, whose landscape is capital.
    expect(payload.stats.spent).toBe('100.00');
    expect(payload.monthlySpending[asOf.month].operational).toBe('120.00');
    expect(payload.budgetVsActual.map((b) => b.category)).not.toContain('P111 Remodel');
    // Its 50000.00 allocation is likewise absent from the operational annual budget.
    expect(payload.stats.budget).toBe('1200.00');

    // NON-VACUITY: the row exists and is visible where it should be. `recentArrivals` is the one
    // section with no landscape filter — it answers "what is new", not "what counts against a
    // budget" — so the capital charge appears there and nowhere else.
    expect(payload.recentArrivals.map((r) => r.amount)).toContain('4000.00');
  });

  it('an exclude_from_budget category is excluded from stats and budgetVsActual though its landscape is operational', async () => {
    // `P111 Excluded Ops` is operational and not hidden. `hidden` and `exclude_from_budget` are two
    // independent flags and conflating them is BUILD.md §10.3's named defect; this fixture is the
    // one that fails if a category-level exclusion is applied as a transaction-level one.
    expect(payload.stats.budget).toBe('1200.00');
    expect(payload.budgetVsActual.map((b) => b.category)).not.toContain('P111 Excluded Ops');
    expect(payload.stats.spent).toBe('100.00');
    // The weekly reference is the same operational budget over 52, so it moves if the exclusion
    // leaks: 3200/52 would be 61.54.
    expect(payload.week.weeklyBudgetReference).toBe('23.08');

    // Its TRANSACTIONS still appear, because `recentArrivals` filters neither landscape nor
    // exclusion. Excluded from the budget is not the same as hidden from the reader.
    expect(payload.recentArrivals.map((r) => r.amount)).toContain('300.00');
  });

  it('an uncategorized transaction is excluded from today and week spend but counted in stats.uncategorized', async () => {
    // `p111_txn_uncat` is 77.00, not hidden, dated today. The app cannot say whether an unfiled row
    // is income, spend or half a transfer — the last one to arrive was half a transfer worth
    // $2,175 — so it enters no budget total. It is not invisible, though: it is counted, and the
    // count is what the dashboard colours an alert on.
    expect(payload.stats.uncategorized).toBe(1);
    expect(payload.today.spent).toBe('120.00');
    expect(payload.week.spent).toBe('120.00');
    expect(payload.monthlySpending[asOf.month].operational).toBe('120.00');
    // 197.00 is what today's spend reads if the unfiled row leaks in.
    expect(payload.today.spent).not.toBe('197.00');

    // Present in the arrivals feed and counted in the day's transaction count, which is where a
    // reader can act on it.
    expect(payload.recentArrivals.map((r) => r.amount)).toContain('77.00');
    expect(payload.recentArrivals.find((r) => r.amount === '77.00')?.category).toBeNull();
  });

  it('a refund nets against its category\'s spend rather than being ignored or double counted', async () => {
    // 120.00 spent and 20.00 returned, both mapped to `P111 Groceries`, both dated today.
    const groceries = payload.budgetVsActual.find((b) => b.category === 'P111 Groceries');
    expect(groceries).toBeDefined();
    expect(groceries?.budget).toBe('1200.00');
    expect(groceries?.spent).toBe('100.00');
    // 120.00 is the gross figure, 140.00 is the double count. Both are named so a failure says
    // which mistake was made.
    expect(groceries?.spent).not.toBe('120.00');
    expect(groceries?.spent).not.toBe('140.00');
    expect(payload.stats.spent).toBe('100.00');

    // The refund is a NEGATIVE arrival and reaches the reader unflipped and unclamped.
    expect(payload.recentArrivals.map((r) => r.amount)).toContain('-20.00');
  });

  it('feedHealth reports one finding per Plaid item, not per account, for two accounts sharing a stale item', async () => {
    // `p111_checking` and `p111_savings` share `p111-item-alpha`, last successful 96 hours ago —
    // past the 36-hour threshold. Ten Chase accounts going dark together are one finding, not ten.
    expect(payload.feedHealth).toHaveLength(1);
    expect(payload.feedHealth[0].institution).toBe('Fabricated Bank Alpha');
    expect(payload.feedHealth[0].accountCount).toBe(2);
    expect(payload.feedHealth[0].state).toBe('stale');

    // The N4 boundary, live: `loadFeedHealth` hands back a `Date` and the wire carries a string.
    const direct = await loadFeedHealth();
    expect(direct).toHaveLength(1);
    expect(direct[0].lastSuccessfulUpdate).toBeInstanceOf(Date);
    expect(typeof payload.feedHealth[0].lastSuccessfulUpdate).toBe('string');
    expect(payload.feedHealth[0].lastSuccessfulUpdate)
      .toBe(direct[0].lastSuccessfulUpdate?.toISOString());

    // AGREEMENT WITH THE SHARED READER, which is the property a "does the number look right" test
    // cannot reach: the endpoint calls `loadFeedHealth`, it does not re-derive the grouping.
    expect(payload.feedHealth[0].institution).toBe(direct[0].institution);
    expect(payload.feedHealth[0].accountCount).toBe(direct[0].accountCount);
    expect(payload.feedHealth[0].hoursStale).toBe(direct[0].hoursStale);
  });

  it('driftFindings reports a seeded ledger/Plaid disagreement on a ledger-mode account and nothing for the same disagreement on a valuation-mode account', async () => {
    // Identical inputs on both accounts — opening balance 1000.00, no transactions, Plaid at
    // 1500.00 — and only `valuation_mode` differs. A valuation-mode account's balance IS its
    // recorded valuation, so comparing it to Plaid would restate the same number as a disagreement.
    const ids = payload.driftFindings.map((d) => d.accountId);
    expect(ids).toContain('p111_ledger_drift');
    expect(ids).not.toContain('p111_valuation_drift');
    expect(payload.driftFindings).toHaveLength(1);

    const finding = payload.driftFindings[0];
    expect(finding.ledgerBalance).toBe('1000.00');
    expect(finding.expectedBalance).toBe('1500.00');
    // expected − ledger: positive means the ledger is short of what the bank reports.
    expect(finding.drift).toBe('500.00');
    expect(finding.suggestedBeginningBalance).toBe('1500.00');
    // The account already had an opening balance, so the gap is evidence of a missing transaction
    // rather than an unknown opening figure, and absorbing it into the balance is not safe.
    expect(finding.safeToDerive).toBe(false);
    // Already a string when `lib/drift.ts` returns it — the contrast with lastSuccessfulUpdate.
    expect(typeof finding.observedAt).toBe('string');

    const direct = await findBalanceDrift();
    expect(direct.map((d) => d.accountId)).toEqual(ids);
    expect(finding.drift).toBe(wireMoney(direct[0].drift));
  });

  it('monthOutlook never contains an OutlookCategory for the capital-landscape category', async () => {
    // `P111 Remodel` is discretionary, non-income, budget-bearing and has spend this month — every
    // conjunct of `isScoredCategory` except the first, which is landscape. It must appear in none
    // of the four partitions.
    const names = outlookCategoryNames(payload.monthOutlook);
    expect(names).not.toContain('P111 Remodel');

    // NON-VACUITY: the operational discretionary category IS scored, so the absence above is the
    // landscape rule working rather than an empty outlook.
    expect(names).toContain('P111 Groceries');

    // AGREEMENT WITH THE SHARED READER. The endpoint calls `loadMonthOutlook`; it does not compute
    // a second verdict that happens to look similar.
    const direct = await loadMonthOutlook(asOf);
    expect(payload.monthOutlook.state).toBe(direct.outlook.state);
    expect(payload.monthOutlook.scoredCategoryCount).toBe(direct.outlook.scoredCategoryCount);
    expect(outlookCategoryNames(payload.monthOutlook).sort()).toEqual(
      [...direct.outlook.sayingNo, ...direct.outlook.holding, ...direct.outlook.withheld,
        ...direct.outlook.offCycleElsewhere].map((c) => c.category).sort(),
    );
    // And the capital charge is absent from the coverage denominator's scored half as well.
    expect(payload.monthOutlook.coverage.scoredSpend).toBe(wireMoney(direct.outlook.coverage.scoredSpend));
  });

  it('yearEnd is scoped to the operational landscape and does not fold in the capital category\'s budget', async () => {
    // `loadYearEnd('operational', asOf)` — passed explicitly, matching the dashboard. The capital
    // year is lumpy by construction (a remodel draws its allocation in one month) and averaging it
    // into the operational P/L produces a figure nobody is steering by.
    const operational = await loadYearEnd('operational', asOf);
    const capital = await loadYearEnd('capital', asOf);

    // The payload IS the operational read, field for field, formatted.
    expect(payload.yearEnd.income).toBe(wireMoney(operational.income));
    expect(payload.yearEnd.expense).toBe(wireMoney(operational.expense));
    expect(payload.yearEnd.profitLoss).toBe(wireMoney(operational.profitLoss));
    expect(payload.yearEnd.netToDate).toBe(wireMoney(operational.netToDate));
    expect(payload.yearEnd.monthly).toHaveLength(12);

    // PINNED RELATIVELY, NOT LITERALLY, AND DELIBERATELY. A year-end figure is a PROJECTION, so it
    // moves on the first of every month: `projectSide` sums planned months from `asOf.month + 1`
    // through December, which makes the operational expense `100 × (12 − asOf.month)` — 400.00 in
    // September, 300.00 in October, 100.00 in December. A literal here would have been a fixture
    // that expires on a calendar boundary and then reports a landscape defect that does not exist.
    // The durable statement is the bound the SEED pins: the only operational expense category is
    // `P111 Groceries` at 1200.00, so nothing this payload can project as expense exceeds that
    // allocation in any month of the year.
    expect(operational.expense).toBeLessThanOrEqual(1200);
    expect(payload.yearEnd.expense).toBe(wireMoney(operational.expense));

    // NON-VACUITY, and the assertion that actually names the defect: the 50000.00 capital
    // allocation is real, it lands in the capital book, and it is an order of magnitude larger than
    // anything the operational read produces. A `loadYearEnd` called with the wrong landscape — or
    // with none — would put this figure in the payload.
    //
    // Both bounds are month-free. The two projections shrink by the same `(12 − asOf.month)`
    // factor, so their RATIO is the constant — 50000/1200 ≈ 41.7 — and the capital figure exceeds
    // the operational book's whole annual allocation even in December, when it is at its smallest
    // (50000/12 = 4166.67 against 1200.00).
    expect(capital.expense).toBeGreaterThan(operational.expense * 10);
    expect(capital.expense).toBeGreaterThan(1200);
    expect(payload.yearEnd.expense).not.toBe(wireMoney(capital.expense));

    // The unfiled row is DISCLOSED and counted in nothing above it. 77.00 is the uncategorized
    // transaction, and `expense` — whatever the month makes it — does not include it. A consumer
    // that added it back into `profitLoss` would have undone the fix that figure exists to record.
    // These three literals are calendar-free: the uncategorized read is filtered by year alone, so
    // it does not move with `asOf.month` the way the projection above it does.
    expect(payload.yearEnd.uncategorized.expense).toBe('77.00');
    expect(payload.yearEnd.uncategorized.income).toBe('0.00');
    expect(payload.yearEnd.uncategorized.net).toBe('-77.00');
  });
});
