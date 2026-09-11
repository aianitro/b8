export const dynamic = 'force-dynamic';

import type { ReactNode } from 'react';
import Link from 'next/link';
import db from '@/lib/db';
import MonthlySpendingChart, { type MonthlySpendingData } from '@/components/charts/MonthlySpendingChart';
import CashFlowChart, { type CashFlowData } from '@/components/charts/CashFlowChart';
import CategoryDonutChart, { type CategorySlice } from '@/components/charts/CategoryDonutChart';
import BudgetVsActualChart, { type BudgetVsActualRow } from '@/components/charts/BudgetVsActualChart';
import LandscapeBalanceChart from '@/components/charts/LandscapeBalanceChart';
import { STATUS_CLASS, type StatusColor } from '@/lib/chartColors';
import { findBalanceDrift } from '@/lib/drift';
import DriftAlertCard from '@/components/DriftAlertCard';
import FeedHealthCard from '@/components/FeedHealthCard';
import CategoryBubbles, { type BubbleCategory } from '@/components/CategoryBubbles';
import RecentArrivals from '@/components/RecentArrivals';
import { loadFeedHealth } from '@/lib/feedHealthRead';
import UnscoredBreaches from '@/components/UnscoredBreaches';
import type { BreachFinding } from '@/lib/domain/adherence';
// The whole verdict comes from one pure function, called once. This page issues SQL and renders;
// it computes no adherence, no pacing and no headline of its own. BUILD.md §7.5's rule — no
// surface computes a shared concept independently of `lib/domain/` — is the reason, and the page
// this one replaces was already in tension with it.
import { asOfFromDate, type MonthOutlook, type OutlookCategory, type OutlookState } from '@/lib/domain/monthOutlook';
// The SQL behind that verdict now lives in `lib/`, shared with the daily job's breach alert, so the
// page and the email can never drift on what this month's outlook is. It moved for the same reason
// `lib/` already holds a shared reader for the scheduler's other daily computation: a scheduler
// cannot import a page's private function, and copying the queries would have put two definitions
// of the same figures one directory apart. Nothing a reader sees changed — the queries moved
// verbatim, and the page is touched here only by a deletion and this import.
import { loadMonthOutlook } from '@/lib/monthOutlookRead';
import { MONTHS, drillHref } from '@/lib/drilldown';
// The calendar rule, imported rather than restated: `./pacing` exports it precisely so a caller
// formatting "day 8 of 30" agrees with the module that computed the projection about how long
// April is. A second leap-year rule here would drift on 2100.
import { daysInMonth } from '@/lib/domain/pacing';


function blankMonths<T extends object>(fill: T): Array<{ month: string } & T> {
  return MONTHS.map((month) => ({ month, ...fill }));
}

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
      -- is_income excluded on both halves, matching app/budget/page.tsx's expenseRows filter. A
      -- salary category carries an annual_budget too, and counting it here made "Annual Budget"
      -- the sum of what is planned to be spent AND what is expected to come in — so the KPI
      -- overstated the budget by the whole income side while "Spent" (positive amounts only)
      -- never included a cent of it.
      (SELECT COALESCE(SUM(annual_budget), 0) FROM budget_categories
        WHERE exclude_from_budget = FALSE AND is_income = FALSE)::text AS total_budget,
      (SELECT COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
         JOIN budget_categories bc ON bc.name = t.mapped_category
              AND bc.exclude_from_budget = FALSE AND bc.is_income = FALSE
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
    uncategorizedPct: totalTxns > 0 ? Math.round((uncategorized / totalTxns) * 100) : 0,
  };
}

// The flow-derived month-by-month series — beginning balance plus transactions, per landscape.
async function getCashFlowSeries(asOf: DashboardAsOf): Promise<{
  monthlyOperational: number[];
  monthlyCapital: number[];
  monthlySeries: number[];
}> {
  const [accountsRes, netRes, balancesRes] = await Promise.all([
    db.query<{ id: string; landscape: string }>(
      'SELECT id, landscape FROM accounts WHERE track_transactions = TRUE'
    ),
    db.query<{ account_id: string; month: number; net: string }>(`
      SELECT t.account_id,
             EXTRACT(MONTH FROM t.date)::int AS month,
             (COALESCE(ABS(SUM(t.amount) FILTER (WHERE t.amount < 0)), 0)
              - COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0))::text AS net
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
      WHERE EXTRACT(YEAR FROM t.date) = $1
      GROUP BY t.account_id, EXTRACT(MONTH FROM t.date)::int
    `, [asOf.year]),
    db.query<{ account_id: string; beginning_balance: string }>(
      'SELECT account_id, beginning_balance FROM account_balances WHERE year = $1', [asOf.year]
    ),
  ]);

  const netByAccount = new Map<string, Map<number, number>>();
  for (const r of netRes.rows) {
    if (!netByAccount.has(r.account_id)) netByAccount.set(r.account_id, new Map());
    netByAccount.get(r.account_id)!.set(r.month, Number(r.net));
  }
  const beginningByAccount = new Map(balancesRes.rows.map((r) => [r.account_id, Number(r.beginning_balance)]));

  const monthlySeries = new Array(asOf.month + 1).fill(0);
  const monthlyOperational = new Array(asOf.month + 1).fill(0);
  const monthlyCapital = new Array(asOf.month + 1).fill(0);
  for (const a of accountsRes.rows) {
    const byMonth = netByAccount.get(a.id) ?? new Map();
    let running = beginningByAccount.get(a.id) ?? 0;
    for (let i = 0; i <= asOf.month; i++) {
      running += byMonth.get(i + 1) ?? 0;
      monthlySeries[i] += running;
      if (a.landscape === 'operational') monthlyOperational[i] += running;
      else monthlyCapital[i] += running;
    }
  }
  return { monthlySeries, monthlyOperational, monthlyCapital };
}

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
        AND (t.mapped_category IS NULL OR bc.exclude_from_budget = FALSE)
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
          AND (t.mapped_category IS NULL OR bc.exclude_from_budget = FALSE)
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
        AND (t.mapped_category IS NULL OR bc.exclude_from_budget = FALSE)
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
        AND (t.mapped_category IS NULL OR bc.exclude_from_budget = FALSE)
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

async function getMonthlySpending(asOf: DashboardAsOf): Promise<MonthlySpendingData[]> {
  const [spending, budgets] = await Promise.all([
    db.query<{ month_num: number; landscape: string; total: number }>(`
      SELECT EXTRACT(MONTH FROM t.date)::int AS month_num, a.landscape,
             COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0) AS total
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
      LEFT JOIN budget_categories bc ON bc.name = t.mapped_category
      WHERE EXTRACT(YEAR FROM t.date) = $1
        AND (t.mapped_category IS NULL OR bc.exclude_from_budget = FALSE)
        AND t.hidden = FALSE
      GROUP BY month_num, a.landscape
    `, [asOf.year]),
    db.query<{ landscape: string; monthly_budget: number }>(
      'SELECT landscape, SUM(annual_budget)/12 AS monthly_budget FROM budget_categories WHERE exclude_from_budget = FALSE GROUP BY landscape'
    ),
  ]);
  const monthlyBudget: Record<string, number> = {};
  for (const r of budgets.rows) monthlyBudget[r.landscape] = Number(r.monthly_budget);
  const rows = blankMonths<Omit<MonthlySpendingData, 'month'>>({
    operational: 0, capital: 0,
    budget_operational: monthlyBudget['operational'] ?? 0,
    budget_capital: monthlyBudget['capital'] ?? 0,
  });
  for (const r of spending.rows) {
    const row = rows[r.month_num - 1];
    if (r.landscape === 'operational') row.operational = Number(r.total);
    if (r.landscape === 'capital') row.capital = Number(r.total);
  }
  return rows;
}

async function getCashFlow(asOf: DashboardAsOf): Promise<CashFlowData[]> {
  const result = await db.query<{ month_num: number; total_out: number; total_in: number }>(`
    SELECT EXTRACT(MONTH FROM t.date)::int AS month_num,
           COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)      AS total_out,
           COALESCE(ABS(SUM(t.amount) FILTER (WHERE t.amount < 0)), 0) AS total_in
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
    LEFT JOIN budget_categories bc ON bc.name = t.mapped_category
    WHERE EXTRACT(YEAR FROM t.date) = $1
      AND (t.mapped_category IS NULL OR bc.exclude_from_budget = FALSE)
      AND t.hidden = FALSE
    GROUP BY month_num ORDER BY month_num
  `, [asOf.year]);
  const rows = blankMonths<Omit<CashFlowData, 'month'>>({ in: 0, out: 0, net: 0 });
  for (const r of result.rows) {
    const row = rows[r.month_num - 1];
    row.out = Number(r.total_out); row.in = Number(r.total_in); row.net = row.in - row.out;
  }
  return rows;
}

async function getCategoryBreakdown(asOf: DashboardAsOf): Promise<CategorySlice[]> {
  const result = await db.query<CategorySlice>(`
    SELECT t.mapped_category AS name, bc.landscape,
           SUM(t.amount) FILTER (WHERE t.amount > 0) AS value
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
    JOIN budget_categories bc ON bc.name = t.mapped_category
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
 * The seven states, each as a sentence rather than a score.
 *
 * `nothing-to-score` gets a named cause and a route out — never a dash beside a green tick, and
 * never "on track". "The budget was followed perfectly" and "there is nothing to score" are
 * different statements, and this is the surface where confusing them would be visible.
 */
const STATE_COPY: Record<OutlookState, { title: string; tone: string; pill: string }> = {
  'nothing-to-score': {
    title: 'Nothing to score yet',
    tone: 'text-slate-300',
    pill: 'bg-slate-800 text-slate-300',
  },
  'off-cycle': {
    title: 'Off-cycle spend this month',
    tone: 'text-red-400',
    pill: 'bg-red-500/10 text-red-300',
  },
  breach: {
    title: 'Over budget this month',
    tone: 'text-red-400',
    pill: 'bg-red-500/10 text-red-300',
  },
  'projected-breach': {
    title: 'Projected to close over',
    tone: 'text-amber-300',
    pill: 'bg-amber-500/10 text-amber-200',
  },
  'too-early': {
    title: 'Too early to call',
    tone: 'text-slate-300',
    pill: 'bg-slate-800 text-slate-300',
  },
  'no-budget-basis': {
    title: 'No budget to measure against',
    tone: 'text-slate-300',
    pill: 'bg-slate-800 text-slate-300',
  },
  'on-track': {
    title: 'On track to close inside your limits',
    tone: 'text-emerald-400',
    pill: 'bg-emerald-500/10 text-emerald-300',
  },
};

/**
 * The hero's presentation, chosen by the state AND the authority — never by the state alone.
 *
 * DEMOTE, NEVER SUPPRESS. §5's exit is that the headline number always ships with the share of
 * spend it actually saw, and a suppressed hero ships nothing, so it cannot ship with its share.
 * What a low bound withdraws is the CONFIDENCE, not the information: the state's own sentence is
 * still a true statement about the rows that were seen, and a category already $400 over its month
 * is over it whatever the coverage is. So the sentence survives, and everything that presents it as
 * a settled verdict does not — the emerald, the red, the amber, and the coloured pill.
 *
 * This is the failure the ungated renderer makes most likely: a refusal banner rendered faithfully
 * underneath an emerald "On track to close inside your limits", which reads as a verdict with a
 * footnote rather than a figure that has not earned one. Colour is the part of this hero people
 * actually read, so colour is the part the bound has to reach.
 */
function heroCopy(state: OutlookState, authoritative: boolean): { title: string; tone: string; pill: string } {
  const stated = STATE_COPY[state];
  if (authoritative) return stated;
  return { title: stated.title, tone: 'text-slate-300', pill: 'bg-slate-800 text-slate-400' };
}

const SAYING_NO_COPY: Record<'off-cycle' | 'breach' | 'projected-breach', string> = {
  'off-cycle': 'drew outside its schedule',
  breach: 'is already over its month',
  'projected-breach': 'projects to close over',
};

const WITHHELD_COPY: Record<'too-early' | 'no-budget' | 'negative-budget', string> = {
  'too-early': 'too early in the month to project',
  'no-budget': 'nothing budgeted this month',
  'negative-budget': 'budget is negative — fix it at /categories',
};

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
const PANEL_GRID = ['', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3'];

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
  const [stats, monthRead, flow, todayStats, weekStats, monthly, cashflow, breakdown, budgetVsActual,
         recentArrivals] =
    await Promise.all([
      getStats(asOf), loadMonthOutlook(asOf), getCashFlowSeries(asOf),
      getTodayStats(), getWeekStats(), getMonthlySpending(asOf), getCashFlow(asOf), getCategoryBreakdown(asOf),
      getBudgetVsActual(asOf), getRecentArrivals(),
    ]);
  const [driftFindings, feedFindings] = await Promise.all([driftPromise, feedPromise]);

  // The whole verdict, from one reader shared with the daily job. Its three queries still run
  // concurrently with everything else above — `loadMonthOutlook` issues them together and is itself
  // one entry in this `Promise.all`, so nothing became serial in the move.
  const outlook: MonthOutlook = monthRead.outlook;
  // Both, never the state alone: a confident colour over a figure computed on a tenth of the
  // month's spend is the exact defect this phase exists to end.
  const copy = heroCopy(outlook.state, outlook.authoritative);

  // The headline is a claim about specific transactions, so it opens them — but only where such a
  // set exists. `on-track`, `too-early`, `no-budget-basis` and `nothing-to-score` name no category,
  // and a link from those lands on an empty list, which reads as a bug rather than as a state. The
  // three states that DO name categories are exactly the three that fill `sayingNo`, so the list
  // itself is the test, not a second enumeration of the states.
  const heroHref = outlook.sayingNo.length > 0
    ? drillHref(outlook.sayingNo.map((c) => c.category), asOf.month)
    : null;

  const todayDelta = todayStats.spent - todayStats.avgSameWeekday;
  const todayVsAvgRatio = todayStats.avgSameWeekday > 0 ? todayStats.spent / todayStats.avgSameWeekday : 0;

  const weekDelta = weekStats.spent - weekStats.spentComparableLastWeek;
  const expectedWeekSpend = weekStats.weeklyBudgetReference * (weekStats.isoDow / 7);
  const weekPaceRatio = expectedWeekSpend > 0 ? weekStats.spent / expectedWeekSpend : 0;

  const cashFlowSeries = flow.monthlySeries.map((total, i) => ({
    month: MONTHS[i],
    operational: flow.monthlyOperational[i],
    capital: flow.monthlyCapital[i],
    total,
  }));

  // Breaches on categories nobody scores — a fixed mortgage line drawing over its budget is a true
  // fact whether or not behaviour is the variable. §5's "tracked and reported, never scored".
  const unscoredBreaches = outlook.findings.filter((f): f is BreachFinding => f.kind === 'breach' && !f.scored);

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

  const sidePanels = [outlook.withheld.length, outlook.offCycleElsewhere.length, unscoredBreaches.length]
    .filter((n) => n > 0).length;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            {MONTHS[asOf.month]} {asOf.year} · day {asOf.day} of {monthLength}
          </p>
        </div>
      </div>

      {/* Rendered above the hero deliberately: if a balance doesn't reconcile, that's context
          you want before reading the headline figure, not after. */}
      {/* Above the drift strip, and above the hero, because it qualifies both: a balance that
          does not reconcile and a month that looks quiet are each explained by a feed that stopped
          arriving. Reading either without knowing that is how a stale figure gets acted on. */}
      <FeedHealthCard findings={feedFindings} />

      <DriftAlertCard findings={driftFindings} />

      {/* The hero, and it answers a budget question: will this month close inside its limits, and
          which categories say no. A state from a closed set of seven and a named list — never a
          vanity percentage, and never a total. */}
      <div data-testid="month-outlook-hero" className="bg-slate-900 rounded-2xl shadow-sm p-8 mb-6">
        <div className="flex items-center gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">This month</p>
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${copy.pill}`}>
            {outlook.scoredCategoryCount} scored {outlook.scoredCategoryCount === 1 ? 'category' : 'categories'}
          </span>
        </div>
        {heroHref ? (
          <Link
            href={heroHref}
            aria-label={`${copy.title} — see this month's transactions in ${outlook.sayingNo.map((c) => c.category).join(', ')}`}
            className={`group inline-flex flex-wrap items-center gap-x-2.5 gap-y-2 text-4xl font-bold mt-3 ${copy.tone}`}
          >
            <span className="group-hover:underline decoration-2 underline-offset-4">{copy.title}</span>
            {/* The affordance. Not a decoration: on a dark hero the underline only appears on
                hover, so without a resting-state marker the headline looks like every other
                heading and nobody discovers it opens anything. The pill stays short and the
                scope — which categories, which month — rides in the accessible name, because a
                label long enough to state it would compete with the headline it sits beside. */}
            <span className="text-xs font-medium text-slate-400 shrink-0 rounded-full border border-slate-700 px-2.5 py-1 group-hover:border-slate-500 group-hover:text-slate-300 transition-colors">
              See transactions
            </span>
          </Link>
        ) : (
          <p className={`text-4xl font-bold mt-3 ${copy.tone}`}>{copy.title}</p>
        )}

        {outlook.state === 'nothing-to-score' ? (
          // A named cause and a route out. Never a zero, never a dash beside a green tick, and
          // never "on track" — a category nobody has classified is not a category behaving well.
          <p className="text-sm text-slate-400 mt-3">
            No category is classified as discretionary yet, so there is nothing behaviour can be
            scored on.{' '}
            <Link href="/categories" className="underline text-slate-300">Classify your categories</Link>{' '}
            to give this month a verdict.
          </p>
        ) : outlook.sayingNo.length > 0 ? (
          <p className="text-sm text-slate-400 mt-3">
            {outlook.sayingNo.length} of {outlook.scoredCategoryCount}{' '}
            {outlook.sayingNo.length === 1 ? 'category says' : 'categories say'} no as of day {asOf.day} of{' '}
            {monthLength}; {outlook.holding.length}{' '}
            {outlook.holding.length === 1 ? 'is holding' : 'are holding'}.
          </p>
        ) : (
          // The all-clear sentence, and it is NOT unconditional ([[N40]]). "No scored category is
          // over" is a statement about the whole scored set; when categories are withheld it is
          // only true of the budgeted part of it, and rendering the wider claim under an emerald
          // title while five unbudgeted discretionary categories sit in `withheld` having drawn
          // $3,000 is a true sentence doing the work of a false one. In `no-budget-basis` the
          // wider claim is VACUOUSLY true and was still being rendered as a finding.
          <p className="text-sm text-slate-400 mt-3">
            {outlook.withheld.length === outlook.scoredCategoryCount && outlook.withheld.length > 0 ? (
              // Every scored category is withheld, so there is no "none of them is over" to say at
              // all: the set the claim would range over is empty, and "None of the 0 categories
              // with a budget is over" is the vacuous sentence [[N40]] is about, one shape along.
              <>
                No scored category has a verdict this month yet — all{' '}
                {outlook.withheld.length} are withheld, for the reasons under “No verdict” below.
              </>
            ) : outlook.withheld.length > 0 ? (
              <>
                None of the {outlook.scoredCategoryCount - outlook.withheld.length}{' '}
                {outlook.scoredCategoryCount - outlook.withheld.length === 1 ? 'category' : 'categories'} with a
                budget this month is over or projecting over as of day {asOf.day} of {monthLength}; the other{' '}
                {outlook.withheld.length} {outlook.withheld.length === 1 ? 'has' : 'have'} no verdict —
                see “No verdict” below.
              </>
            ) : (
              <>
                Every scored category has a budget this month and none of them is over or projecting
                over, as of day {asOf.day} of {monthLength}.
              </>
            )}
          </p>
        )}

        {/* The bound, rendered in EVERY state and in BOTH authority modes — §5's "the headline
            number always ships with the share of spend it actually saw". Including the healthiest
            state, which is where a caveat is most likely to be dropped, and including the refused
            one, where it is the explanation.

            A SHARE OF DOLLARS, and the counts beside it are supporting detail that is never
            divided: one uncategorized $4,000 row against forty categorized $12 coffees is 97.6% by
            count and 10% by dollars, and only one of those two numbers is about this hero.

            The percentage is the domain's floored integer, printed verbatim. `pct()` is NOT used
            here: it rounds, and a rounded 99.6% renders "100% of this month's spend" beside spend
            nobody has categorized — a confidently wrong number generated by a display convention. */}
        <p data-testid="coverage-caveat" className="text-xs text-slate-500 mt-4 pt-4 border-t border-slate-800">
          {outlook.coveragePercent === null ? (
            // Never 0%, never 100%. An empty population is not perfect attribution, and it is not
            // total failure either; it is no evidence, and this app renders "—" rather than a
            // wrong zero.
            //
            // But an empty POPULATION is not an empty MONTH, and conflating the two states a
            // falsehood about the owner's money. `scoredSpend + unattributedSpend === 0` is also
            // true of a month in which every recorded transaction is mapped to a category this
            // hero never scores — rent, utilities, groceries — which is the ordinary shape of the
            // first days of a month, before the first discretionary charge, on data whose
            // unattributed count is normally zero. "No spend is recorded" is false there, with
            // thousands of dollars posted. So the two cases are separated and each says only what
            // is true of it; the honest statement in the second is about THIS HERO'S REACH, not
            // about the month. `coverageGroupCount` counts the unfiltered aggregation, so it —
            // unlike the coverage record, which by design drops known-unscored spend from both
            // halves — can still tell "nothing happened" from "nothing this hero scores happened".
            monthRead.coverageGroupCount === 0 ? (
              <>No spend is recorded this month yet, so there is no share to compute one over.</>
            ) : (
              <>
                None of this month&apos;s spend is in reach of this hero — every transaction
                recorded so far is mapped to a category it never scores, and none is unattributed —
                so there is no share to compute one over.
              </>
            )
          ) : (
            <>
              Computed over {outlook.coveragePercent}% of this month&apos;s spend —{' '}
              {fmtCents(outlook.coverage.scoredSpend)} the scored categories account for, against{' '}
              {fmtCents(outlook.coverage.unattributedSpend)} across{' '}
              {outlook.coverage.unattributedCount}{' '}
              {outlook.coverage.unattributedCount === 1 ? 'transaction' : 'transactions'} they could
              not.{' '}
              {outlook.coverage.orphanedCount > 0 && (
                <>
                  {outlook.coverage.orphanedCount} of those{' '}
                  {outlook.coverage.orphanedCount === 1 ? 'carries a category' : 'carry a category'}{' '}
                  that no longer exists — most likely a rename.{' '}
                </>
              )}
              Spend in categories this hero never scores is in neither figure.{' '}
              <Link href="/transactions?filter=uncategorized" className="underline text-slate-400">Review them</Link>.
            </>
          )}
        </p>

        {/* The refusal, and it is a DEMOTION rather than a suppression: everything above still
            renders, because the state and the three named lists are true statements about the rows
            that were seen. What this region withdraws is the claim that they add up to a verdict.

            It renders if and only if the domain says so. The threshold is not restated here — the
            page consults `outlook.authoritative` and never carries a second copy of the number,
            because a constant duplicated at the point of display is a constant that gets moved in
            one place. */}
        {!outlook.authoritative && (
          <div data-testid="coverage-refusal" className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-300/90">Not a verdict yet</p>
            <p className="text-xs text-slate-400 mt-1.5">
              {outlook.coveragePercent === null ? (
                // The whole sentence is conditional, not just its tail. "Too much of this month's
                // spend is unaccounted for" is itself FALSE when the population is empty —
                // `unattributedSpend` is 0 there and nothing is unaccounted for; the reason the
                // bound refuses is that it has nothing to range over, which is a different fact.
                // A refusal that misstates its own cause is the same defect as a caveat that
                // misstates the month.
                monthRead.coverageGroupCount === 0 ? (
                  <>
                    Nothing is recorded this month yet, so the bound has nothing to range over and
                    the figures above are not yet a judgement on the month.
                  </>
                ) : (
                  <>
                    Nothing recorded this month falls in the scored set or outside it unattributed,
                    so the bound has nothing to range over and the figures above are not a
                    judgement on the month.
                  </>
                )
              ) : (
                <>
                  Too much of this month&apos;s spend is unaccounted for to read the figures above
                  as a judgement on the month. They are accurate about what was seen and silent
                  about the rest, so treat them as a partial reading —{' '}
                  {outlook.state === 'nothing-to-score'
                    // Stacked with the "classify your categories" message above rather than
                    // arguing with it: in this state both are true and they are different halves
                    // of the same route out. Sending the owner to the transactions list alone
                    // would be advice that cannot work until the categories are classified.
                    ? 'classifying your categories is the first half of settling it, and categorizing these transactions is the second.'
                    : 'categorizing the transactions above will settle it.'}
                </>
              )}
            </p>
          </div>
        )}
      </div>

      {/* Directly under the month's verdict: the same set of categories the hero summarised into
          one sentence, spread out so the reader can see which of them carry the money. */}
      <CategoryBubbles categories={bubbleCategories} />

      {/* Under the bubbles: they say which categories carry the money, this says what is new
          since the reader last looked. */}
      <RecentArrivals arrivals={recentArrivals} staleFeed={feedFindings.length > 0} />

      {/* The named list — §5's own words, as a distinct region rather than a colour on a bar. */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Written out rather than routed through `Panel`, because the region itself has to carry
            the test id — a component filling the inside cannot be what a reviewer greps for. */}
        <div data-testid="categories-saying-no" className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Saying no</p>
          {outlook.sayingNo.length === 0 ? (
            <p className="text-xs text-slate-400">No scored category is saying no this month.</p>
          ) : (
            outlook.sayingNo.map((c) => (
              <CategoryLine key={c.categoryId} c={c} note={SAYING_NO_COPY[c.reason!]} />
            ))
          )}
        </div>
        <Panel title="Holding">
          {outlook.holding.length === 0 ? (
            <p className="text-xs text-slate-400">No scored category is holding under its projection.</p>
          ) : (
            outlook.holding.map((c) => <CategoryLine key={c.categoryId} c={c} note="on plan" />)
          )}
        </Panel>
      </div>

      {sidePanels > 0 && (
        // Sized to what is actually there. Fixed at three columns, a lone panel — routinely the
        // unscored list, since withheld and off-cycle are both empty in a healthy month — rendered
        // as a narrow column beside two thirds of white space, which is what made a long list in it
        // look even longer.
        <div className={`grid ${PANEL_GRID[sidePanels]} gap-4 mb-6`}>
          {outlook.withheld.length > 0 && (
            <Panel title="No verdict">
              {outlook.withheld.map((c) => (
                <CategoryLine key={c.categoryId} c={c} note={WITHHELD_COPY[c.withheldReason!]} />
              ))}
            </Panel>
          )}
          {outlook.offCycleElsewhere.length > 0 && (
            <Panel title="Off-cycle earlier this year">
              {outlook.offCycleElsewhere.map((c) => (
                <CategoryLine key={`${c.categoryId}-${c.month}`} c={c} note={`${MONTHS[c.month]} drew outside its schedule`} />
              ))}
            </Panel>
          )}
          {unscoredBreaches.length > 0 && (
            <Panel title="Tracked, not scored">
              <UnscoredBreaches findings={unscoredBreaches} monthsElapsed={asOf.month + 1} />
            </Panel>
          )}
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
      <div className="grid grid-cols-3 gap-4 mb-6">
        <KpiCard label="Annual Budget" value={fmt(stats.budget)} />
        <KpiCard
          label="Remaining"
          value={fmt(stats.remaining)}
          highlight={stats.remaining < 0 ? 'red' : 'green'}
        />
        <KpiCard
          label="Uncategorized"
          value={`${stats.uncategorizedPct}%`}
          sub={stats.uncategorized > 0 ? `${stats.uncategorized} of ${stats.totalTxns} need review` : 'all categorized'}
          highlight={stats.uncategorized > 0 ? 'amber' : 'green'}
          href="/transactions?filter=uncategorized"
        />
      </div>

      {/* Charts */}
      <div className="space-y-6">
        <LandscapeBalanceChart data={cashFlowSeries} />
        <MonthlySpendingChart data={monthly} />
        <div className="grid grid-cols-2 gap-6">
          <CategoryDonutChart data={breakdown} />
          <CashFlowChart data={cashflow} />
        </div>
        <BudgetVsActualChart data={budgetVsActual} />
      </div>
    </div>
  );
}
