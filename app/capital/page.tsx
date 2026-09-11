export const dynamic = 'force-dynamic';

import Link from 'next/link';
import db from '@/lib/db';
import MonthlySpendingChart, { type MonthlySpendingData } from '@/components/charts/MonthlySpendingChart';
import CategoryDonutChart, { type CategorySlice } from '@/components/charts/CategoryDonutChart';
import LandscapeBalanceChart from '@/components/charts/LandscapeBalanceChart';
import BudgetVsActualChart, { type BudgetVsActualRow } from '@/components/charts/BudgetVsActualChart';
import { asOfFromDate } from '@/lib/domain/monthOutlook';
import type { AsOf } from '@/lib/domain/pacing';
import { projectYearEnd, type YearEndRow } from '@/lib/domain/yearEnd';
import { MONTHS } from '@/lib/drilldown';

function blankMonths<T extends object>(fill: T): Array<{ month: string } & T> {
  return MONTHS.map((month) => ({ month, ...fill }));
}

// The capital book: property, mortgages, investments, and multi-year projects like the bathroom
// remodel. It sits on its own page rather than beside the operational figures because the two
// answer different questions on different clocks — "did this month hold its limits" against "is
// this asset worth building" — and interleaving them was making the dashboard arbitrate between
// a restaurant bill and a mortgage as though they were the same kind of decision.
//
// Deliberately NOT a second dashboard. There is no month verdict here and no say-no list: capital
// spend is lumpy by construction, a remodel draws $40,000 in May and nothing in July, and a pace
// judgement over that is noise. Totals, trend, and per-category position are the whole surface.

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

// The flow-derived month-by-month series — beginning balance plus transactions, per landscape.
async function getCashFlowSeries(asOf: AsOf): Promise<{
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

async function getMonthlySpending(asOf: AsOf): Promise<MonthlySpendingData[]> {
  const [spending, budgets] = await Promise.all([
    db.query<{ month_num: number; landscape: string; total: number }>(`
      SELECT EXTRACT(MONTH FROM t.date)::int AS month_num, a.landscape,
             COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0) AS total
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
      LEFT JOIN budget_categories bc ON bc.name = t.mapped_category
      WHERE EXTRACT(YEAR FROM t.date) = $1
        AND (t.mapped_category IS NULL OR (bc.exclude_from_budget = FALSE AND bc.landscape = 'capital'))
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

async function getCategoryBreakdown(asOf: AsOf): Promise<CategorySlice[]> {
  const result = await db.query<CategorySlice>(`
    SELECT t.mapped_category AS name, bc.landscape,
           GREATEST(SUM(t.amount), 0) AS value
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
    JOIN budget_categories bc ON bc.name = t.mapped_category AND bc.landscape = 'capital'
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

async function getCapitalBudgetVsActual(asOf: AsOf): Promise<BudgetVsActualRow[]> {
  const result = await db.query<BudgetVsActualRow>(`
    SELECT bc.name AS category, bc.landscape, bc.annual_budget AS budget,
           COALESCE(SUM(t.amount), 0) AS spent
    FROM budget_categories bc
    LEFT JOIN transactions t ON t.mapped_category = bc.name
      AND EXTRACT(YEAR FROM t.date) = $1
      AND t.hidden = FALSE
    LEFT JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
    WHERE bc.exclude_from_budget = FALSE
      AND bc.landscape = 'capital'
      AND bc.is_income = FALSE
      AND (t.id IS NULL OR a.id IS NOT NULL)
    GROUP BY bc.name, bc.landscape, bc.annual_budget
    ORDER BY spent DESC
  `, [asOf.year]);
  return result.rows.map((r) => ({ ...r, budget: Number(r.budget), spent: Number(r.spent) }));
}

async function getCapitalStats(asOf: AsOf) {
  const { rows } = await db.query<{
    is_income: boolean; annual_budget: string; monthly_amounts: string[] | null;
    closed_months: string; current_month: string; ytd: string;
  }>(`
    SELECT bc.is_income, bc.annual_budget::text, bc.monthly_amounts,
           COALESCE(SUM(t.amount) FILTER (WHERE EXTRACT(MONTH FROM t.date) < $2), 0)::text AS closed_months,
           COALESCE(SUM(t.amount) FILTER (WHERE EXTRACT(MONTH FROM t.date) = $2), 0)::text AS current_month,
           COALESCE(SUM(t.amount), 0)::text AS ytd
      FROM budget_categories bc
      LEFT JOIN transactions t ON t.mapped_category = bc.name
        AND EXTRACT(YEAR FROM t.date) = $1 AND t.hidden = FALSE
      LEFT JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
      LEFT JOIN accounts a2 ON a2.id = t.account_id
     WHERE bc.exclude_from_budget = FALSE
       AND bc.landscape = 'capital'
       AND (t.id IS NULL OR a.id IS NOT NULL)
     GROUP BY bc.id, bc.is_income, bc.annual_budget, bc.monthly_amounts
  `, [asOf.year, asOf.month + 1]);

  const toRow = (r: typeof rows[number]): YearEndRow => ({
    annualBudget: Number(r.annual_budget),
    monthlyAmounts: r.monthly_amounts?.length === 12 ? r.monthly_amounts.map(Number) : null,
    closedMonths: Number(r.closed_months),
    currentMonth: Number(r.current_month),
  });
  const incomeRows  = rows.filter((r) => r.is_income);
  const expenseRows = rows.filter((r) => !r.is_income);
  const budget = expenseRows.reduce((s, r) => s + Number(r.annual_budget), 0);
  const spent  = expenseRows.reduce((s, r) => s + Number(r.ytd), 0);
  const received = -incomeRows.reduce((s, r) => s + Number(r.ytd), 0);
  return {
    budget, spent, remaining: budget - spent, received,
    ...projectYearEnd(incomeRows.map(toRow), expenseRows.map(toRow), asOf.month),
  };
}

function KpiCard({ label, value, sub, highlight }: {
  label: string; value: string; sub?: string; highlight?: 'red' | 'green';
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-3xl font-bold mt-2 font-mono ${
        highlight === 'red' ? 'text-red-500' : highlight === 'green' ? 'text-emerald-600' : 'text-slate-900'
      }`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1.5">{sub}</p>}
    </div>
  );
}

export default async function CapitalPage() {
  const asOf = asOfFromDate(new Date());
  const [stats, flow, monthly, breakdown, budgetVsActual] = await Promise.all([
    getCapitalStats(asOf), getCashFlowSeries(asOf), getMonthlySpending(asOf),
    getCategoryBreakdown(asOf), getCapitalBudgetVsActual(asOf),
  ]);

  const balanceSeries = flow.monthlySeries.map((total: number, i: number) => ({
    month: MONTHS[i],
    operational: flow.monthlyOperational[i],
    capital: flow.monthlyCapital[i],
    total,
  }));

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Capital</h1>
        <p className="text-sm text-slate-500 mt-1">
          Property, mortgages, investments and long-running projects · {asOf.year}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Capital Budget" value={fmt(stats.budget)} sub="planned for the year" />
        <KpiCard
          label="Spent"
          value={fmt(stats.spent)}
          sub={`${fmt(stats.received)} received`}
        />
        <KpiCard
          label="Remaining"
          value={fmt(stats.remaining)}
          highlight={stats.remaining < 0 ? 'red' : 'green'}
          sub={stats.remaining < 0 ? 'over the annual allocation' : 'left to draw'}
        />
        <KpiCard
          label="Projected P/L"
          value={`${stats.profitLoss < 0 ? '\u2212' : '+'}${fmt(Math.abs(stats.profitLoss))}`}
          highlight={stats.profitLoss < 0 ? 'red' : 'green'}
          sub="where the year closes if the plan holds"
        />
      </div>

      <div className="space-y-6">
        <LandscapeBalanceChart data={balanceSeries} />
        <MonthlySpendingChart data={monthly} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <CategoryDonutChart data={breakdown} />
          <BudgetVsActualChart data={budgetVsActual} />
        </div>
      </div>

      <p className="mt-6 text-xs text-slate-400">
        Day-to-day budget adherence is on the{' '}
        <Link href="/dashboard" className="text-blue-600 hover:underline">dashboard</Link>.
      </p>
    </div>
  );
}
