import db from './db';
import type { AdherenceInput } from './domain/adherence';
import { categorizationCoverage, monthOutlook, type CoverageGroup, type MonthOutlook } from './domain/monthOutlook';
import type { AsOf } from './domain/pacing';
import { detectRecurring, RECURRENCE_LOOKBACK_MONTHS, type RecurrenceTxn } from './domain/recurrence';

/**
 * The month outlook's I/O shell: the SQL that feeds `lib/domain/monthOutlook.ts`, in one place.
 *
 * These four readers were private to `app/dashboard/page.tsx` until this step, which was fine for
 * exactly as long as the dashboard was the only surface that wanted a verdict about the month. It
 * is not any more: the daily job now computes the same outlook in order to decide whether anything
 * is worth saying to the owner, and a scheduler cannot import a page's private function.
 *
 * That left two options and only one of them was survivable. Copying the queries into the alert
 * shell is the drifting-definitions defect (BUILD.md §1) landing on the exact figures this phase
 * exists to make trustworthy — and it is a defect this repo has already shipped twice, most
 * recently as two independent "pick the latest valuation" reducers that had to be consolidated.
 * Two months from now the page and the email disagree about one category and nothing announces it.
 *
 * So the queries move here instead, VERBATIM, and this file is the single definition. The pattern
 * is not novel: `lib/domain/netWorth.ts` is the pure composer and `lib/netWorth.ts` the I/O shell,
 * deliberately shared by the dashboard and the scheduler's `writeNetWorthSnapshot()` so the two can
 * never drift on what net worth means. This is that, for the month outlook.
 *
 * **The move is a relocation and not a rewrite**, and it is gated as one: SPEC.md #56a and #57a
 * assert that the two pinned SQL fragments arrived here byte-identical, #58 asserts the actuals
 * query exists in exactly one file in the repo, and #59 carries step 32's [[N42]] control with it —
 * there is NO account-landscape predicate here, because landscape enters once, downstream, on the
 * category. The only thing that changed in transit is the parameter type: these took the page's
 * own local interface, which was a structural duplicate of the domain's `AsOf`, and they now take
 * `AsOf` itself — one shape for the as-of point rather than two that happen to agree.
 *
 * Nothing here decides anything. It aggregates and converts, and the domain classifies — the same
 * split the coverage query's own docblock argues for, and for the same reason: a membership rule
 * re-expressed in a WHERE clause is a rule beyond the reach of every test in this repo.
 */

/**
 * The as-of point as an ISO calendar day, for the date-bounded queries below.
 *
 * Built from the three integers the single clock read produced, never from a second conversion:
 * the SQL and the domain module must agree about which day it is, and a query bounded by its own
 * clock is a second calendar that disagrees with the first for the hours around midnight.
 * Postgres and ISO count months from 1 where the domain counts from 0, and this is the one place
 * that difference is expressed.
 */
const isoDay = (year: number, month: number, day: number) =>
  `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

// ------------------------------------------------------------------ the month's verdict, in SQL
//
// Two queries feed one pure function. Neither computes anything: the first reads the category rows
// the domain's membership tests need — INCLUDING control_mode, without which every category reads
// `fixed`, `isScoredCategory` admits none, and the hero silently returns to "nothing to score" on
// real data that has categories classified (NITS N1's shape, one page over) — and the second
// aggregates spend per category per month.

interface CategoryRow {
  id: number;
  name: string;
  landscape: 'operational' | 'capital';
  exclude_from_budget: boolean;
  is_income: boolean;
  control_mode: 'fixed' | 'discretionary' | 'variable-necessary';
  annual_budget: string;
  monthly_amounts: string[] | null;
}

async function getBudgetCategories(): Promise<CategoryRow[]> {
  const result = await db.query<CategoryRow>(`
    SELECT bc.id, bc.name, bc.landscape, bc.exclude_from_budget, bc.is_income, bc.control_mode,
           bc.annual_budget::text, bc.monthly_amounts
      FROM budget_categories bc
     ORDER BY bc.sort_order, bc.name
  `);
  return result.rows;
}

/**
 * Spend per category name per ELAPSED month of the as-of year, as a non-negative magnitude.
 *
 * `SUM(t.amount) FILTER (WHERE t.amount > 0)` — positive rows only, Plaid's convention (positive is
 * money out) which this app keeps. `MonthSpend.actual` is contractually a magnitude, and a refund
 * netted in makes it negative, which projects DOWNWARD because the multiplier is at least one.
 * Recorded honestly as a divergence: `components/BudgetMonthlyGrid.tsx` nets refunds into the same
 * concept, so the two disagree for any month containing a return. This form is taken knowingly.
 *
 * The month index is normalised to 0-based HERE, at the boundary, and nowhere else. Handed the
 * 1-based value `EXTRACT(MONTH …)` returns, `detectAdherence` silently prices a December-only
 * category as an 1150% breach while `categoryPacing` throws — and the difference between those two
 * answers is what a caller with a try/catch ships alone.
 *
 * Bounded at the as-of day rather than at the end of the year: a month that has not happened yet is
 * rejected by the domain module outright, because twelve months of budget under four months of
 * spend turns a 24% underspend into a 75% one.
 *
 * Matched on category NAME, not through a JOIN on it. `mapped_category` is not a foreign key and
 * `budget_categories` is UNIQUE(name, landscape), so a name defined in both landscapes matches
 * twice and a JOIN duplicates the transaction row into both.
 */
async function getMonthlyActuals(asOf: AsOf): Promise<Map<string, Map<number, number>>> {
  const result = await db.query<{ category: string; month: number; actual: string }>(`
    SELECT t.mapped_category AS category, EXTRACT(MONTH FROM t.date)::int - 1 AS month,
           COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::text AS actual
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
     WHERE t.hidden = FALSE
       AND t.mapped_category IS NOT NULL
       AND t.date >= $1::date AND t.date <= $2::date
     GROUP BY 1, 2
  `, [isoDay(asOf.year, 0, 1), isoDay(asOf.year, asOf.month, asOf.day)]);

  const byCategory = new Map<string, Map<number, number>>();
  for (const r of result.rows) {
    if (!byCategory.has(r.category)) byCategory.set(r.category, new Map());
    byCategory.get(r.category)!.set(r.month, Number(r.actual));
  }
  return byCategory;
}

/**
 * This month's spend to date, grouped by `mapped_category` — the raw material of the confidence
 * bound, and nothing more.
 *
 * ONE AGGREGATION, NO CLASSIFICATION. The three-way split — scored, known-unscored, unattributed —
 * is `categorizationCoverage`'s, in `lib/domain/`, because re-expressing `isScoredCategory`'s four
 * conjuncts in a `WHERE` clause here would put this query's copy of the membership rule beyond the
 * reach of every test in this repo. The groups go out; the domain decides what each one means.
 *
 * THE PREDICATE SET IS `getMonthlyActuals`'S, EXACTLY, and that identity is the substance of the
 * step. The caveat and the figures it caveats must range over one population, and previously they
 * did not: this query filtered the ACCOUNT's landscape while the hero's figures gate the CATEGORY's
 * — different columns, different tables, and the two sets are not nested either way, so a vacation
 * paid from a capital savings account and mapped to `Travel` moved the hero and was absent from the
 * caveat. There is now NO account-landscape predicate at all. Landscape enters once, downstream,
 * through `isScoredCategory`'s first conjunct, on the category.
 *
 * `t.amount > 0` is the whole sign rule: positive is money out, this app keeps Plaid's convention,
 * and income is NEGATIVE here. A denominator that admitted a $9,000 inbound payroll row would not
 * be a share of spend — and it would fail silently, because the row makes the denominator larger
 * and the share smaller, so the caveat would refuse authority for the wrong reason and nobody
 * investigates a pessimistic caveat. Refunds are negative too and are excluded rather than netted,
 * matching `getMonthlyActuals`, which nets nothing.
 *
 * Windowed to the AS-OF MONTH TO DATE — the same window the hero's verdict covers. Not the year and
 * not the whole calendar month: a bound computed over days that have not happened is a bound about
 * a month nobody has lived.
 *
 * `NUMERIC` arrives as text and is converted HERE, at the one boundary that knows it. The domain
 * rejects a string outright rather than concatenating it into a plausible denominator.
 */
async function getCoverageGroups(asOf: AsOf): Promise<CoverageGroup[]> {
  const result = await db.query<{ category: string | null; spend: string; txn_count: string }>(`
    SELECT t.mapped_category AS category,
           SUM(t.amount)::text AS spend,
           COUNT(*)::text      AS txn_count
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
     WHERE t.hidden = FALSE
       AND t.amount > 0
       AND t.date >= $1::date AND t.date <= $2::date
     GROUP BY t.mapped_category
  `, [isoDay(asOf.year, asOf.month, 1), isoDay(asOf.year, asOf.month, asOf.day)]);

  return result.rows.map((r) => ({
    category: r.category,
    spend: Number(r.spend),
    count: Number(r.txn_count),
  }));
}

/**
 * The charges a cadence can be read off, over the evidence window — raw rows, deliberately.
 *
 * NO AGGREGATION AND NO CLASSIFICATION. Whether three charges from one merchant are a subscription
 * is `detectRecurring`'s judgement, and every part of that judgement — the consecutive-months test,
 * the amount tolerance, the still-running test, the choice of one representative charge per month —
 * is policy. Expressed in a `GROUP BY` it would be policy no test in this repo can reach, which is
 * the drifting-definitions hazard (BUILD.md §1) landing on the figure that decides whether a
 * category reads as 106% of its month or 398%.
 *
 * THE PREDICATE SET IS `getMonthlyActuals`'S, EXACTLY, minus its date bound. Same tracked-account
 * join, same `hidden = FALSE`, same `mapped_category IS NOT NULL`, and the same `t.amount > 0` sign
 * rule. The recurring total is SUBTRACTED from the month's actual before the run rate divides the
 * remainder, so the two figures must be summed over one population: a charge counted as recurring
 * but absent from `actual` is a negative elective remainder, and a category then projects to close
 * below what it has already spent.
 *
 * The window is `RECURRENCE_LOOKBACK_MONTHS` completed months plus the as-of month to date. It
 * crosses the year boundary for any as-of point before July, which is why the lower bound is
 * computed as a date and not as `EXTRACT(YEAR …) = asOf.year` — a January outlook whose evidence
 * stopped at 1 January would have no history at all and would pro-rate every subscription the owner
 * has.
 *
 * `t.name` is the grouping label, with `merchant_name` behind it. The raw bank descriptor is the
 * more stable of the two: this ledger holds one gym billing monthly under `merchant_name` values
 * `CLUB SPORT @ THE PLEX` and `Club Sport` in the same year, while its `name` never moved. Plaid's
 * cleaned merchant name improves over time, and a series that re-keys itself is a series that
 * dissolves. Normalisation of the label is the domain module's, not this query's.
 */
async function getRecurrenceWindow(asOf: AsOf): Promise<RecurrenceTxn[]> {
  const result = await db.query<{ category: string; label: string; month: number; day: number; amount: string }>(`
    SELECT t.mapped_category                     AS category,
           COALESCE(NULLIF(TRIM(t.name), ''), t.merchant_name, '') AS label,
           EXTRACT(MONTH FROM t.date)::int - 1   AS month,
           EXTRACT(DAY   FROM t.date)::int       AS day,
           t.amount::text                        AS amount
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
     WHERE t.hidden = FALSE
       AND t.amount > 0
       AND t.mapped_category IS NOT NULL
       AND t.date >= ($2::date - make_interval(months => $1::int))
       AND t.date <= $2::date
  `, [RECURRENCE_LOOKBACK_MONTHS, isoDay(asOf.year, asOf.month, asOf.day)]);

  return result.rows.map((r) => ({
    category: r.category,
    label: r.label,
    month: r.month,
    day: r.day,
    amount: Number(r.amount),
  }));
}

/**
 * The category rows and their months, assembled into the domain's input shape.
 *
 * Every elapsed month is supplied for every category, filled with 0 where no transaction landed —
 * a category with a budget and no spend in January genuinely spent nothing in January, and the
 * absence of a row is not the absence of a month. It also means every scored category carries an
 * entry for the as-of month, which the domain module requires rather than assumes: a scored
 * category missing from all three lists reads as holding, which is the quietest way to be wrong.
 *
 * `NUMERIC` columns are converted here, at the one boundary that knows they arrived as text. The
 * domain module rejects a string outright rather than concatenating it into a plausible figure.
 */
function toAdherenceInput(categories: CategoryRow[], actuals: Map<string, Map<number, number>>, asOf: AsOf): AdherenceInput[] {
  const elapsedMonths: number[] = [];
  for (let month = 0; month <= asOf.month; month++) elapsedMonths.push(month);

  return categories.map((c) => {
    const byMonth = actuals.get(c.name);
    return {
      id: c.id,
      name: c.name,
      landscape: c.landscape,
      exclude_from_budget: c.exclude_from_budget,
      is_income: c.is_income,
      control_mode: c.control_mode,
      annual_budget: Number(c.annual_budget),
      monthly_amounts: c.monthly_amounts === null ? null : c.monthly_amounts.map(Number),
      months: elapsedMonths.map((month) => ({ month, actual: byMonth?.get(month) ?? 0 })),
    };
  });
}

/**
 * The whole month outlook, from one clock read's worth of integers.
 *
 * ONE READER, TWO CALLERS — `app/dashboard/page.tsx` renders what this returns, and
 * `lib/breachAlert.ts` decides whether to say anything about it. Neither computes an outlook of its
 * own, which is the entire point of this file existing.
 *
 * The three queries are issued together rather than in sequence, and the whole call is still one
 * entry in the page's own `Promise.all`, so the extraction adds no serial round trip to a page load.
 *
 * `coverageGroupCount` travels out beside the outlook because the page needs it and cannot get it
 * from the coverage record. The refusal banner distinguishes "nothing is recorded this month" from
 * "nothing recorded this month is in reach of this hero", and only the UNFILTERED aggregation can
 * tell those apart — the coverage record drops known-unscored spend from both halves by design, so
 * by the time it exists the distinction is gone. A count rather than the rows themselves: it is the
 * only thing asked of them, and handing a renderer the raw groups invites a second classification.
 */
export interface MonthOutlookRead {
  outlook: MonthOutlook;
  /** How many `mapped_category` groups this month's unfiltered aggregation produced. */
  coverageGroupCount: number;
}

export async function loadMonthOutlook(asOf: AsOf): Promise<MonthOutlookRead> {
  const [categories, actuals, coverageGroups, recurrenceWindow] = await Promise.all([
    getBudgetCategories(), getMonthlyActuals(asOf), getCoverageGroups(asOf), getRecurrenceWindow(asOf),
  ]);

  // The bound, from the same category rows the verdict is computed over. One fetch, one membership
  // test, one population — the numerator and the denominator cannot be drawn from different sets
  // because there is only one set here to draw them from.
  const coverage = categorizationCoverage(coverageGroups, categories);

  // The whole verdict, from one pure function, over one array. Not three independent reads that
  // could be handed divergent rows.
  // Which charges are a subscription rather than a decision, so the run rate is applied to the
  // elective remainder alone. One reader, so the dashboard and the daily alert cannot disagree
  // about whether `Sport` is heading for $265 or $993.75.
  const recurrence = detectRecurring(recurrenceWindow, asOf);

  const outlook: MonthOutlook = monthOutlook(
    toAdherenceInput(categories, actuals, asOf), asOf, coverage, recurrence,
  );

  return { outlook, coverageGroupCount: coverageGroups.length };
}
