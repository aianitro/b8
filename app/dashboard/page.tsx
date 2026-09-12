export const dynamic = 'force-dynamic';

import type { ReactNode } from 'react';
import Link from 'next/link';
import db from '@/lib/db';
import CategoryDonutChart, { type CategorySlice } from '@/components/charts/CategoryDonutChart';
import BudgetVsActualChart, { type BudgetVsActualRow } from '@/components/charts/BudgetVsActualChart';
import ProfitLossChart from '@/components/charts/ProfitLossChart';
import { STATUS_CLASS, type StatusColor } from '@/lib/chartColors';
import { findBalanceDrift } from '@/lib/drift';
import DriftAlertCard from '@/components/DriftAlertCard';
import FeedHealthCard from '@/components/FeedHealthCard';
import AlertBell from '@/components/AlertBell';
import CategoryBubbles, { type BubbleCategory } from '@/components/CategoryBubbles';
import RecentArrivals from '@/components/RecentArrivals';
import { loadFeedHealth } from '@/lib/feedHealthRead';
// The whole verdict comes from one pure function, called once. This page issues SQL and renders;
// it computes no adherence, no pacing and no headline of its own. BUILD.md §7.5's rule — no
// surface computes a shared concept independently of `lib/domain/` — is the reason, and the page
// this one replaces was already in tension with it.
import { asOfFromDate, type MonthOutlook, type OutlookCategory } from '@/lib/domain/monthOutlook';
// The SQL behind that verdict now lives in `lib/`, shared with the daily job's breach alert, so the
// page and the email can never drift on what this month's outlook is. It moved for the same reason
// `lib/` already holds a shared reader for the scheduler's other daily computation: a scheduler
// cannot import a page's private function, and copying the queries would have put two definitions
// of the same figures one directory apart. Nothing a reader sees changed — the queries moved
// verbatim, and the page is touched here only by a deletion and this import.
import { loadMonthOutlook } from '@/lib/monthOutlookRead';
import { loadYearEnd } from '@/lib/yearEndRead';
import { MONTHS, drillHref } from '@/lib/drilldown';
// The calendar rule, imported rather than restated: `./pacing` exports it precisely so a caller
// formatting "day 8 of 30" agrees with the module that computed the projection about how long
// April is. A second leap-year rule here would drift on 2100.
import { daysInMonth } from '@/lib/domain/pacing';



const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const fmtCents = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

/** A fraction of budget as a percentage. `2.6625` reads "266%" — of budget, not over it. */
const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;

interface DashboardAsOf {
  year: number;
  month: number;
  day: number;
}

async function getStats(asOf: DashboardAsOf) {
  const result = await db.query<{ total_budget: string; ytd_spent: string; uncategorized: string; total_txns: string }>(`
    SELECT
      -- OPERATIONAL only, and expenses only.
      --
      -- is_income was already excluded on both halves: a salary category carries an annual_budget
      -- too, and counting it made "Annual Budget" the sum of what is planned to be spent AND what
      -- is expected to come in.
      --
      -- The landscape predicate is newer and fixes the same shape of error one level up. These two
      -- cards were summing both books while everything around them — the hero, the bubbles, the
      -- P/L chart and card — reads operational, so "Annual Budget" was $309,946 against an
      -- operational plan of $139,237, and "Remaining" was −$58,312, a figure driven almost entirely
      -- by a bathroom remodel overrunning its capital allocation rather than by anything in the
      -- monthly budget beneath it.
      --
      -- Net of refunds, not gross, matching app/budget/page.tsx. Those two disagreed by $11,169
      -- across 2026, which was enough for the same year to read over pace on one page and on track
      -- on the other.
      (SELECT COALESCE(SUM(annual_budget), 0) FROM budget_categories
        WHERE exclude_from_budget = FALSE AND is_income = FALSE
          AND landscape = 'operational')::text AS total_budget,
      (SELECT COALESCE(SUM(t.amount), 0)
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
         JOIN budget_categories bc ON bc.name = t.mapped_category
              AND bc.exclude_from_budget = FALSE AND bc.is_income = FALSE
              AND bc.landscape = 'operational'
         WHERE EXTRACT(YEAR FROM t.date) = $1 AND t.hidden = FALSE)::text AS ytd_spent,
      (SELECT COUNT(*) FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
         WHERE t.mapped_category IS NULL AND t.hidden = FALSE)::text AS uncategorized,
      (SELECT COUNT(*) FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
         WHERE t.hidden = FALSE)::text AS total_txns
  `, [asOf.year]);
  const r = result.rows[0];
  const budget = Number(r.total_budget);
  const spent = Number(r.ytd_spent);
  const uncategorized = Number(r.uncategorized);
  const totalTxns = Number(r.total_txns);
  return {
    budget, spent, remaining: budget - spent, uncategorized, totalTxns,
  };
}


interface MonthlySpend { month: string; operational: number; received: number }

interface TodayStats {
  spent: number;
  avgSameWeekday: number;
  transactions: { label: string; amount: number }[];
  totalCount: number;
}

export interface RecentArrival {
  id: number;
  date: string;
  amount: number;
  label: string;
  category: string | null;
}


/**
 * What arrived since the previous day's sync.
 *
 * Keyed on `created_at`, not on the transaction DATE: the question is what is new to the reader,
 * and a charge dated the 9th that landed this morning is news while one dated today that arrived
 * two syncs ago is not. Those differ by a day or more on every card feed.
 *
 * 36 hours rather than 24 so a sync running an hour later than yesterday's does not silently drop
 * a day's arrivals out of the window.
 */
async function getRecentArrivals(): Promise<RecentArrival[]> {
  const { rows } = await db.query<{
    id: number; date: string; amount: string; label: string;
    category: string | null; created_at: string;
  }>(`
    SELECT t.id, t.date::text, t.amount::text,
           COALESCE(NULLIF(t.merchant_name, ''), NULLIF(t.name, ''), 'Unnamed') AS label,
           t.mapped_category AS category, t.created_at::text
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
     WHERE t.created_at > NOW() - INTERVAL '36 hours'
       AND t.hidden = FALSE
     ORDER BY t.amount DESC, t.id
     LIMIT 12
  `);
  return rows.map((r) => ({
    id: r.id, date: r.date, amount: Number(r.amount),
    label: r.label, category: r.category,
  }));
}

async function getTodayStats(): Promise<TodayStats> {
  const [todayResult, avgResult, txnsResult] = await Promise.all([
    db.query<{ spent: string }>(`
      SELECT COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::text AS spent
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
      LEFT JOIN budget_categories bc ON bc.name = t.mapped_category
      WHERE t.date = CURRENT_DATE
        AND t.hidden = FALSE
        -- Uncategorized rows are excluded here as they are from the P/L: the app cannot say
        -- whether an unfiled row is income, spend or half a transfer, and the last one to
        -- arrive was half a transfer worth $2,175. A LEFT JOIN plus this predicate drops
        -- them, because a row with no category row fails it.
        AND bc.exclude_from_budget = FALSE AND bc.landscape = 'operational'
    `),
    // Average of the same weekday's total spend over the trailing 30 days (excluding today) —
    // "is today unusual" without building full anomaly detection.
    db.query<{ avg_spent: string }>(`
      SELECT COALESCE(AVG(daily_total), 0)::text AS avg_spent
      FROM (
        SELECT t.date, SUM(t.amount) FILTER (WHERE t.amount > 0) AS daily_total
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
        LEFT JOIN budget_categories bc ON bc.name = t.mapped_category
        WHERE t.date >= CURRENT_DATE - INTERVAL '30 days'
          AND t.date < CURRENT_DATE
          AND EXTRACT(DOW FROM t.date) = EXTRACT(DOW FROM CURRENT_DATE)
          AND t.hidden = FALSE
          -- Uncategorized rows are excluded here as they are from the P/L: the app cannot say
        -- whether an unfiled row is income, spend or half a transfer, and the last one to
        -- arrive was half a transfer worth $2,175. A LEFT JOIN plus this predicate drops
        -- them, because a row with no category row fails it.
        AND bc.exclude_from_budget = FALSE AND bc.landscape = 'operational'
        GROUP BY t.date
      ) daily
    `),
    db.query<{ name: string | null; merchant_name: string | null; amount: string; total_count: string }>(`
      SELECT t.name, t.merchant_name, t.amount::text, COUNT(*) OVER()::text AS total_count
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
      WHERE t.date = CURRENT_DATE AND t.hidden = FALSE AND t.amount > 0
      ORDER BY t.amount DESC
      LIMIT 3
    `),
  ]);
  return {
    spent: Number(todayResult.rows[0]?.spent ?? 0),
    avgSameWeekday: Number(avgResult.rows[0]?.avg_spent ?? 0),
    transactions: txnsResult.rows.map((r) => ({ label: r.merchant_name ?? r.name ?? 'Transaction', amount: Number(r.amount) })),
    totalCount: Number(txnsResult.rows[0]?.total_count ?? 0),
  };
}

interface WeekStats {
  spent: number;
  spentComparableLastWeek: number;
  weeklyBudgetReference: number;
  /** Monday = 1 … Sunday = 7, matching `date_trunc('week', …)`. Read database-side, beside the
   *  CURRENT_DATE the same query already filters on, rather than from a second clock in JS that
   *  can disagree with it across midnight. */
  isoDow: number;
}

async function getWeekStats(): Promise<WeekStats> {
  const [weekResult, lastWeekResult, budgetResult] = await Promise.all([
    db.query<{ spent: string; iso_dow: number }>(`
      SELECT COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::text AS spent,
             EXTRACT(ISODOW FROM CURRENT_DATE)::int AS iso_dow
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
      LEFT JOIN budget_categories bc ON bc.name = t.mapped_category
      WHERE t.date >= date_trunc('week', CURRENT_DATE)
        AND t.hidden = FALSE
        -- Uncategorized rows are excluded here as they are from the P/L: the app cannot say
        -- whether an unfiled row is income, spend or half a transfer, and the last one to
        -- arrive was half a transfer worth $2,175. A LEFT JOIN plus this predicate drops
        -- them, because a row with no category row fails it.
        AND bc.exclude_from_budget = FALSE AND bc.landscape = 'operational'
    `),
    // Same portion of the week, shifted back exactly 7 days — a fair week-over-week comparison
    // regardless of which day of the week "today" is.
    db.query<{ spent: string }>(`
      SELECT COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::text AS spent
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
      LEFT JOIN budget_categories bc ON bc.name = t.mapped_category
      WHERE t.date >= date_trunc('week', CURRENT_DATE) - INTERVAL '7 days'
        AND t.date <= CURRENT_DATE - INTERVAL '7 days'
        AND t.hidden = FALSE
        -- Uncategorized rows are excluded here as they are from the P/L: the app cannot say
        -- whether an unfiled row is income, spend or half a transfer, and the last one to
        -- arrive was half a transfer worth $2,175. A LEFT JOIN plus this predicate drops
        -- them, because a row with no category row fails it.
        AND bc.exclude_from_budget = FALSE AND bc.landscape = 'operational'
    `),
    db.query<{ weekly_budget: string }>(`
      SELECT COALESCE(SUM(annual_budget) / 52, 0)::text AS weekly_budget
      FROM budget_categories WHERE exclude_from_budget = FALSE AND is_income = FALSE
    `),
  ]);
  return {
    spent: Number(weekResult.rows[0]?.spent ?? 0),
    spentComparableLastWeek: Number(lastWeekResult.rows[0]?.spent ?? 0),
    weeklyBudgetReference: Number(budgetResult.rows[0]?.weekly_budget ?? 0),
    isoDow: Number(weekResult.rows[0]?.iso_dow ?? 1),
  };
}

/** Operational spending per elapsed month, for the bars behind the P/L line. */
async function getMonthlySpending(asOf: DashboardAsOf): Promise<MonthlySpend[]> {
  // The budget-per-month reference this used to fetch alongside is gone with the line it drew.
  // It summed every category including income, so it put the whole salary above the bars it was
  // meant to measure — and the P/L line now answers "are we ahead" better than a flat average did.
  const { rows } = await db.query<{ month_num: number; total: string; received: string }>(`
    SELECT EXTRACT(MONTH FROM t.date)::int AS month_num,
           COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::text        AS total,
           COALESCE(ABS(SUM(t.amount) FILTER (WHERE t.amount < 0)), 0)::text   AS received
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
    LEFT JOIN budget_categories bc ON bc.name = t.mapped_category
    WHERE EXTRACT(YEAR FROM t.date) = $1
      -- Uncategorized rows are excluded here as they are from the P/L: the app cannot say
      -- whether an unfiled row is income, spend or half a transfer, and the last one to
      -- arrive was half a transfer worth $2,175. A LEFT JOIN plus this predicate drops
      -- them, because a row with no category row fails it.
      AND bc.exclude_from_budget = FALSE AND bc.landscape = 'operational'
      AND t.hidden = FALSE
    GROUP BY month_num
  `, [asOf.year]);

  const out: MonthlySpend[] = MONTHS.map((month) => ({ month, operational: 0, received: 0 }));
  for (const r of rows) {
    out[r.month_num - 1].operational = Number(r.total);
    out[r.month_num - 1].received = Number(r.received);
  }
  return out;
}


async function getCategoryBreakdown(asOf: DashboardAsOf): Promise<CategorySlice[]> {
  const result = await db.query<CategorySlice>(`
    SELECT t.mapped_category AS name, bc.landscape,
           SUM(t.amount) FILTER (WHERE t.amount > 0) AS value
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
    JOIN budget_categories bc ON bc.name = t.mapped_category AND bc.landscape = 'operational'
    WHERE t.mapped_category IS NOT NULL
      AND bc.exclude_from_budget = FALSE
      AND t.hidden = FALSE
      AND EXTRACT(YEAR FROM t.date) = $1
    GROUP BY t.mapped_category, bc.landscape
    HAVING SUM(t.amount) FILTER (WHERE t.amount > 0) > 0
    ORDER BY value DESC
  `, [asOf.year]);
  return result.rows.map((r) => ({ ...r, value: Number(r.value) }));
}

async function getBudgetVsActual(asOf: DashboardAsOf): Promise<BudgetVsActualRow[]> {
  const result = await db.query<BudgetVsActualRow>(`
    SELECT bc.name AS category, bc.landscape, bc.annual_budget AS budget,
           COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0) AS spent
    FROM budget_categories bc
    LEFT JOIN transactions t ON t.mapped_category = bc.name
      AND EXTRACT(YEAR FROM t.date) = $1
      AND t.hidden = FALSE
    LEFT JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
    WHERE bc.exclude_from_budget = FALSE
      AND bc.landscape = 'operational'
      AND bc.is_income = FALSE
      AND (t.id IS NULL OR a.id IS NOT NULL)
    GROUP BY bc.name, bc.landscape, bc.annual_budget
    ORDER BY bc.landscape, spent DESC
  `, [asOf.year]);
  return result.rows.map((r) => ({ ...r, budget: Number(r.budget), spent: Number(r.spent) }));
}

function KpiCard({ label, value, sub, subColor, highlight, href, footer }: {
  label: string; value: string; sub?: string; subColor?: StatusColor;
  highlight?: StatusColor; href?: string; footer?: ReactNode;
}) {
  const content = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-3xl font-bold mt-2 font-mono ${highlight ? STATUS_CLASS[highlight] : 'text-slate-900'}`}>
        {value}
      </p>
      {sub && <p className={`text-xs mt-1.5 ${subColor ? STATUS_CLASS[subColor] : 'text-slate-400'}`}>{sub}</p>}
      {footer && <div className="mt-3 pt-3 border-t border-slate-100">{footer}</div>}
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        className="block bg-white rounded-2xl border border-slate-100 shadow-sm p-6 hover:border-slate-200 hover:shadow-md transition-all"
      >
        {content}
      </a>
    );
  }
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      {content}
    </div>
  );
}

function paceColor(ratio: number): StatusColor {
  if (ratio > 1.1) return 'red';
  if (ratio > 1.0) return 'amber';
  return 'green';
}



/**
 * The transactions behind one verdict: the named categories, in the month the verdict is about.
 *
 * `month` is 0-based everywhere in `lib/domain` and 1-based in the transactions page's query, and
 * the conversion happens HERE rather than at each call site — an off-by-one in a drilldown href
 * shows the owner a real, well-formed, wrong month, which is the failure that looks like data.
 *
 * `from=dashboard` so the breadcrumb over there points back to this page rather than to /budget.
 */


/**
 * One category line. `elapsedDays` and `daysInMonth` travel with every projection: a projection
 * with no day attached is the roadmap's own sentence with its qualifier removed, and the pacing
 * module built those two fields to carry precisely so a renderer has no excuse.
 *
 * The whole line is the target, not the name alone: a verdict the owner disagrees with is only
 * answerable by the rows underneath it, and a row's own month is the only month worth opening —
 * `c.month` rather than the as-of month, because `offCycleElsewhere` records name an earlier one.
 */
function CategoryLine({ c, note }: { c: OutlookCategory; note: string }) {
  // THE FIGURE THE ROW LEADS WITH IS THE ONE THE ROW OPENS. `projected` is a forecast — Sport's
  // $265 over eight elapsed days of thirty projects to $993.75 — and the drilldown under this row
  // can only ever list the $265, because the other $728.75 has not been spent. Leading with the
  // forecast made the row and its own transactions disagree by a factor of four, with nothing on
  // screen saying they were different quantities. So `actual` leads, labelled, and the projection
  // is demoted and named.
  //
  // `complete` projects to its own actual by arithmetic — its elapsed fraction is 1 — so it prints
  // no forecast line: repeating the same dollars under the word "projected" would invent a
  // prediction about a month that has already ended. `off-cycle`, `no-budget`, `too-early` and
  // `future` carry no projection at all, and used to render an empty right column.
  const forecast = c.status === 'projected' && c.projected !== null && c.projectedVariance !== null;
  return (
    <Link
      href={drillHref([c.category], c.month)}
      className="group -mx-2 px-2 rounded-lg flex items-baseline justify-between gap-3 py-2 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate group-hover:underline">{c.category}</p>
        <p className="text-xs text-slate-400">
          {note} · day {c.elapsedDays} of {c.daysInMonth}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-mono text-slate-800">
          {fmtCents(c.actual)}
          <span className="mx-1 font-sans text-[10px] font-medium uppercase tracking-wider text-slate-400">
            spent of
          </span>
          <span className="text-slate-400">{fmtCents(c.budgeted)}</span>
        </p>
        {forecast ? (
          <>
            <p className={`text-xs font-mono ${c.projectedVariance! > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
              {fmtCents(c.projected!)}
              <span className="ml-1 font-sans text-[10px] font-medium uppercase tracking-wider">projected</span>
              {c.projectedRatio !== null && ` · ${pct(c.projectedRatio)}`}
            </p>
            {/* Said out loud wherever it moved the figure, because the projection is now two
                claims of different kinds and the owner is entitled to know which is which. A gym
                membership is a contract and the rest of a category is a decision; a reader who
                cannot tell them apart cannot act on either. */}
            {c.recurringExpected !== null && c.recurringExpected > 0 && (
              <p className="text-[10px] text-slate-400">
                incl. {fmtCents(c.recurringExpected)} recurring, not pro-rated
              </p>
            )}
          </>
        ) : c.spentRatio !== null ? (
          // The share so far, and the day it is "so far" as of sits on the left of this same row —
          // the qualifier `./pacing` built `elapsedDays`/`daysInMonth` to carry. A percentage means
          // a different thing in each status, and this one is never printed without its day.
          <p className={`text-xs font-mono ${c.actual > c.budgeted ? 'text-red-500' : 'text-emerald-500'}`}>
            {pct(c.spentRatio)} of budget
          </p>
        ) : null}
      </div>
    </Link>
  );
}

/** Static strings, because Tailwind reads this file rather than the value of an expression. */

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">{title}</p>
      {children}
    </div>
  );
}

export default async function DashboardPage() {
  // The page's ONE clock read. Everything downstream — the domain module's as-of point, every
  // date-bounded query, the year in the header — is derived from these three integers, in local
  // calendar time, so nothing on this page can straddle midnight or a New Year in two directions.
  const asOf = asOfFromDate(new Date());
  const monthLength = daysInMonth(asOf.year, asOf.month);

  // Kicked off alongside the rest rather than awaited after, so the reconciliation check
  // doesn't add a serial round trip to page load.
  const driftPromise = findBalanceDrift();
  const feedPromise = loadFeedHealth();
  const [stats, monthRead, todayStats, weekStats, monthly, breakdown, budgetVsActual,
         recentArrivals, yearEnd] =
    await Promise.all([
      getStats(asOf), loadMonthOutlook(asOf),
      getTodayStats(), getWeekStats(), getMonthlySpending(asOf), getCategoryBreakdown(asOf),
      getBudgetVsActual(asOf), getRecentArrivals(),
      // Operational, matching /budget's default tab, so the two pages show the same figure. The
      // capital year is lumpy by construction — a remodel draws $40,000 in May — and averaging it
      // in would give a P/L nobody is steering by.
      loadYearEnd('operational', asOf),
    ]);
  const [driftFindings, feedFindings] = await Promise.all([driftPromise, feedPromise]);

  // The whole verdict, from one reader shared with the daily job. Its three queries still run
  // concurrently with everything else above — `loadMonthOutlook` issues them together and is itself
  // one entry in this `Promise.all`, so nothing became serial in the move.
  const outlook: MonthOutlook = monthRead.outlook;


  const todayDelta = todayStats.spent - todayStats.avgSameWeekday;
  const todayVsAvgRatio = todayStats.avgSameWeekday > 0 ? todayStats.spent / todayStats.avgSameWeekday : 0;

  const weekDelta = weekStats.spent - weekStats.spentComparableLastWeek;
  const expectedWeekSpend = weekStats.weeklyBudgetReference * (weekStats.isoDow / 7);
  const weekPaceRatio = expectedWeekSpend > 0 ? weekStats.spent / expectedWeekSpend : 0;

  // `pl` and `plProjected` overlap on the last settled month. Without that shared point the dashed
  // line would start a month adrift of where the solid one ended, leaving a visible gap exactly at
  // the boundary the chart exists to show.
  const lastSettled = asOf.month - 1;
  const plSeries = MONTHS.map((month, i) => ({
    month,
    // Bars stop where the data does. A future month drawn at $0 reads as a month that cost
    // nothing, which is a claim; absent reads as not yet, which is the truth.
    // Money OUT is the negated one: it hangs below the axis, money in rises above it. The value
    // carries the sign the chart needs and the tooltip puts it back, because "money out −$26,000"
    // is nonsense on the way to a reader.
    //
    // Settled and forecast are separate series so they can be drawn differently, and the boundary
    // is the same one the line uses — `lastSettled`. The current month is FORECAST on both: it is
    // eleven days old, and a solid bar for it would claim a finished month.
    spent:    i <= lastSettled ? -(monthly[i]?.operational ?? 0) : null,
    received: i <= lastSettled ?  (monthly[i]?.received ?? 0)    : null,
    spentProjected:    i >= asOf.month ? -yearEnd.monthly[i].expense : null,
    receivedProjected: i >= asOf.month ?  yearEnd.monthly[i].income  : null,
    pl: i <= lastSettled ? yearEnd.monthly[i].cumulative : null,
    plProjected: i >= lastSettled ? yearEnd.monthly[i].cumulative : null,
  }));

  // EVERY operational spending category, not the scored subset.
  //
  // The lists below partition to `isScoredCategory` — discretionary lines, where behaviour is the
  // variable — and that is right for a verdict. It is wrong for a picture of where the money is:
  // groceries, fuel, property tax and utilities are most of the month by value and none of them
  // are a decision anyone makes monthly, so a chart drawn off the partitions showed a household
  // spending about $1,150 when the real figure is several times that. The bubbles are a map, not
  // a judgement, and a map that omits the largest territory is the wrong shape.
  //
  // `monthRead.allPaces` comes off the same fetch, the same actuals and the same recurrence the
  // verdict uses, so a category appearing in both cannot carry two different figures.
  // Scoped to the as-of month. `categoryPacing` emits a record per category PER MONTH — that is
  // what lets `offCycleElsewhere` report an earlier month's breach — so taking the array whole
  // drew a category once for every month it had a budget in, 28 circles over 21 categories.
  const bubbleCategories: BubbleCategory[] = monthRead.allPaces
    .filter((p) => p.month === asOf.month && p.budgeted > 0)
    .map((p) => ({
      category: p.category,
      budgeted: p.budgeted,
      actual: p.actual,
      projectedRatio: p.projectedRatio,
      tooEarly: p.status === 'too-early' || p.status === 'future' || p.status === 'no-budget',
    }));


  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header, with the warnings behind a counter in the corner.
          
          They can legitimately sit here for days — a degraded bank feed clears on Plaid's
          schedule, a drift needs a missing transaction found — so anything permanently on screen
          permanently repeats what the owner already knows. A count says it in one glyph. Feed
          health leads inside the popover, because a stale feed is what explains the drift under
          it. */}
      <div className="flex items-start justify-between gap-6 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            {MONTHS[asOf.month]} {asOf.year} · day {asOf.day} of {monthLength}
          </p>
        </div>
        {/* Counted by CARD, not by finding: two institutions behind is one message about the
            feed, and five drifting accounts is one message about the ledger. The number is how
            many things there are to read, which is the only sense in which a reader counts them. */}
        <AlertBell count={(feedFindings.length > 0 ? 1 : 0) + (driftFindings.length > 0 ? 1 : 0)}>
          <FeedHealthCard findings={feedFindings} />
          <DriftAlertCard findings={driftFindings} />
        </AlertBell>
      </div>

      {/* The month, category by category. It leads the page now that the verdict card is gone:
          the card said "2 categories heading $219 over" and these bubbles say which two, how big
          each is, and what everything around them is doing — the same finding with the evidence
          attached. */}
      <CategoryBubbles categories={bubbleCategories} />

      {/* Under the bubbles: they say which categories carry the money, this says what is new
          since the reader last looked. */}
      <RecentArrivals arrivals={recentArrivals} staleFeed={feedFindings.length > 0} />

      {/* One panel where there were three, so the grid that sized itself to the survivors is gone
          with them — a single-column grid is a div, and the arithmetic behind it was machinery for
          a layout that no longer varies. */}
      {outlook.offCycleElsewhere.length > 0 && (
        <div className="mb-6">
          <Panel title="Off-cycle earlier this year">
            {outlook.offCycleElsewhere.map((c) => (
              <CategoryLine key={`${c.categoryId}-${c.month}`} c={c} note={`${MONTHS[c.month]} drew outside its schedule`} />
            ))}
          </Panel>
        </div>
      )}

      {/* Two shorter horizons, kept beside the month because they are the same question at a
          different scale — not a second headline. */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <KpiCard
          label="Today"
          value={fmt(todayStats.spent)}
          sub={todayStats.avgSameWeekday > 0
            ? `${todayDelta >= 0 ? '+' : ''}${fmt(todayDelta)} vs the same weekday's recent average`
            : undefined}
          subColor={todayStats.avgSameWeekday > 0 ? paceColor(todayVsAvgRatio) : undefined}
          footer={
            todayStats.transactions.length === 0 ? (
              <p className="text-xs text-slate-300">No spending yet today</p>
            ) : (
              <div className="space-y-1">
                {todayStats.transactions.map((t, i) => (
                  <div key={i} className="flex justify-between gap-2 text-xs text-slate-500">
                    <span className="truncate">{t.label}</span>
                    <span className="font-mono text-slate-400 shrink-0">{fmt(t.amount)}</span>
                  </div>
                ))}
                {todayStats.totalCount > todayStats.transactions.length && (
                  <p className="text-[10px] text-slate-300">+{todayStats.totalCount - todayStats.transactions.length} more</p>
                )}
              </div>
            )
          }
        />
        <KpiCard
          label="This Week"
          value={fmt(weekStats.spent)}
          sub={`${weekDelta >= 0 ? '+' : ''}${fmt(weekDelta)} vs same point last week`}
          subColor={expectedWeekSpend > 0 ? paceColor(weekPaceRatio) : undefined}
          footer={<p className="text-xs text-slate-400">{fmt(weekStats.weeklyBudgetReference)}/wk reference</p>}
        />
      </div>

      {/* The annual ceiling, kept as context rather than as a verdict. The year-pace bar that used
          to sit here counted the current month as fully elapsed — 33% of the year on 1 April
          against a true 25% — which inflated expected spend and flattered the pace. It is deleted
          rather than repaired: the per-category month above is the figure the page exists for. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* The same figure /budget's header carries, from the same reader — where the operational
            year closes if the plan holds. It leads the row because it is the only one of these
            four that is a target rather than a count. */}
        <KpiCard
          label="Projected P/L"
          value={`${yearEnd.profitLoss < 0 ? '−' : '+'}${fmt(Math.abs(yearEnd.profitLoss))}`}
          sub={`${yearEnd.netToDate < 0 ? '−' : '+'}${fmt(Math.abs(yearEnd.netToDate))} so far`
            + (yearEnd.uncategorized.net !== 0
                ? ` · ${fmt(Math.abs(yearEnd.uncategorized.net))} unfiled, not counted`
                : '')}
          highlight={yearEnd.profitLoss < 0 ? 'red' : 'green'}
          href="/budget"
        />
        <KpiCard label="Annual Budget" value={fmt(stats.budget)} />
        <KpiCard
          label="Remaining"
          value={fmt(stats.remaining)}
          highlight={stats.remaining < 0 ? 'red' : 'green'}
        />
        {/* The count alone. A percentage of 1,476 transactions rounds to 0% at one unfiled row and
            still at six, so the card used to read "0%" in amber while there was work waiting.
            
            No denominator either: the total is context nobody acts on. Filing is per transaction,
            so the count IS the size of the job, and "1" says it without a ratio to interpret. */}
        <KpiCard
          label="Uncategorized"
          value={stats.uncategorized.toLocaleString()}
          highlight={stats.uncategorized > 0 ? 'amber' : 'green'}
          href="/transactions?filter=uncategorized"
        />
      </div>

      {/* Charts */}
      <div className="space-y-6">
        <ProfitLossChart data={plSeries} />
        {/* The donut lost the pair it sat beside when Cash Flow went. Full width rather than half
            a row with white space next to it — the operational book has fourteen categories and
            the legend was the cramped half of that layout anyway. */}
        <CategoryDonutChart data={breakdown} />
        <BudgetVsActualChart data={budgetVsActual} />
      </div>
    </div>
  );
}
