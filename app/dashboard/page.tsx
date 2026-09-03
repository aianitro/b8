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
import type { AdherenceInput, BreachFinding } from '@/lib/domain/adherence';
// The whole verdict comes from one pure function, called once. This page issues SQL and renders;
// it computes no adherence, no pacing and no headline of its own. BUILD.md §7.5's rule — no
// surface computes a shared concept independently of `lib/domain/` — is the reason, and the page
// this one replaces was already in tension with it.
import { asOfFromDate, monthOutlook, type MonthOutlook, type OutlookCategory, type OutlookState } from '@/lib/domain/monthOutlook';
// The calendar rule, imported rather than restated: `./pacing` exports it precisely so a caller
// formatting "day 8 of 30" agrees with the module that computed the projection about how long
// April is. A second leap-year rule here would drift on 2100.
import { daysInMonth } from '@/lib/domain/pacing';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function blankMonths<T extends object>(fill: T): Array<{ month: string } & T> {
  return MONTHS.map((month) => ({ month, ...fill }));
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const fmtCents = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

/** A fraction of budget as a percentage. `2.6625` reads "266%" — of budget, not over it. */
const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;

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
async function getMonthlyActuals(asOf: DashboardAsOf): Promise<Map<string, Map<number, number>>> {
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
 * How much of this month's operational transaction volume carries a category.
 *
 * TWO COUNTS, not a share of spend and not a threshold — step 32 owns the confidence bound and the
 * refusal to render below it. Scoped to `a.landscape = 'operational'`, the landscape the scored set
 * lives in: caveating an operational figure with capital-side noise would make the caveat wrong in
 * the direction that reassures.
 */
async function getCoverage(asOf: DashboardAsOf): Promise<{ uncategorizedCount: number; categorizedCount: number }> {
  const result = await db.query<{ uncategorized: string; categorized: string }>(`
    SELECT COUNT(*) FILTER (WHERE t.mapped_category IS NULL)::text     AS uncategorized,
           COUNT(*) FILTER (WHERE t.mapped_category IS NOT NULL)::text AS categorized
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
     WHERE t.hidden = FALSE
       AND a.landscape = 'operational'
       AND t.date >= $1::date AND t.date <= $2::date
  `, [isoDay(asOf.year, asOf.month, 1), isoDay(asOf.year, asOf.month, asOf.day)]);
  const r = result.rows[0];
  return { uncategorizedCount: Number(r.uncategorized), categorizedCount: Number(r.categorized) };
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
function toAdherenceInput(categories: CategoryRow[], actuals: Map<string, Map<number, number>>, asOf: DashboardAsOf): AdherenceInput[] {
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
 * One category line. `elapsedDays` and `daysInMonth` travel with every projection: a projection
 * with no day attached is the roadmap's own sentence with its qualifier removed, and the pacing
 * module built those two fields to carry precisely so a renderer has no excuse.
 */
function CategoryLine({ c, note }: { c: OutlookCategory; note: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{c.category}</p>
        <p className="text-xs text-slate-400">
          {note} · {fmtCents(c.actual)} of {fmtCents(c.budgeted)} · day {c.elapsedDays} of {c.daysInMonth}
        </p>
      </div>
      <div className="text-right shrink-0">
        {c.projected !== null && (
          <p className="text-sm font-mono text-slate-800">{fmtCents(c.projected)}</p>
        )}
        {c.projectedRatio !== null && c.projectedVariance !== null && (
          <p className={`text-xs font-mono ${c.projectedVariance > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
            {pct(c.projectedRatio)} of budget
          </p>
        )}
      </div>
    </div>
  );
}

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
  const [stats, categories, actuals, coverage, flow, todayStats, weekStats, monthly, cashflow, breakdown, budgetVsActual] =
    await Promise.all([
      getStats(asOf), getBudgetCategories(), getMonthlyActuals(asOf), getCoverage(asOf), getCashFlowSeries(asOf),
      getTodayStats(), getWeekStats(), getMonthlySpending(asOf), getCashFlow(asOf), getCategoryBreakdown(asOf),
      getBudgetVsActual(asOf),
    ]);
  const driftFindings = await driftPromise;

  // The whole verdict, from one pure function, over one array. Not three independent reads that
  // could be handed divergent rows.
  const outlook: MonthOutlook = monthOutlook(toAdherenceInput(categories, actuals, asOf), asOf, coverage);
  const copy = STATE_COPY[outlook.state];

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
        <p className={`text-4xl font-bold mt-3 ${copy.tone}`}>{copy.title}</p>

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
          <p className="text-sm text-slate-400 mt-3">
            No scored category is over or projecting over as of day {asOf.day} of {monthLength}.
          </p>
        )}

        {/* The interim caveat, rendered unconditionally and in every state — including the
            healthiest one, which is where a caveat is most likely to be dropped. TWO COUNTS, and
            described as counts: this is not a share of spend, and there is no threshold below
            which the figure above refuses to render. Step 32 owns both of those. */}
        <p data-testid="coverage-caveat" className="text-xs text-slate-500 mt-4 pt-4 border-t border-slate-800">
          Computed over {outlook.coverage.categorizedCount} categorized transactions this month;{' '}
          {outlook.coverage.uncategorizedCount} are still uncategorized and counted in neither
          direction.{' '}
          <Link href="/transactions?filter=uncategorized" className="underline text-slate-400">Review them</Link>.
        </p>
      </div>

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

      {(outlook.withheld.length > 0 || outlook.offCycleElsewhere.length > 0 || unscoredBreaches.length > 0) && (
        <div className="grid grid-cols-3 gap-4 mb-6">
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
              {unscoredBreaches.map((f, i) => (
                <div key={i} className="flex items-baseline justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{f.category}</p>
                    <p className="text-xs text-slate-400">{MONTHS[f.month]} · over by {fmtCents(f.variance)}</p>
                  </div>
                </div>
              ))}
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
