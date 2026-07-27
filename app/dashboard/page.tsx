export const dynamic = 'force-dynamic';

import db from '@/lib/db';
import MonthlySpendingChart, { type MonthlySpendingData } from '@/components/charts/MonthlySpendingChart';
import CashFlowChart, { type CashFlowData } from '@/components/charts/CashFlowChart';
import CategoryDonutChart, { type CategorySlice } from '@/components/charts/CategoryDonutChart';
import BudgetVsActualChart, { type BudgetVsActualRow } from '@/components/charts/BudgetVsActualChart';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function blankMonths<T extends object>(fill: T): Array<{ month: string } & T> {
  return MONTHS.map((month) => ({ month, ...fill }));
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

async function getStats() {
  const result = await db.query<{ total_budget: string; ytd_spent: string; uncategorized: string; total_txns: string }>(`
    SELECT
      (SELECT COALESCE(SUM(annual_budget), 0) FROM budget_categories WHERE exclude_from_budget = FALSE)::text AS total_budget,
      (SELECT COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
         JOIN budget_categories bc ON bc.name = t.mapped_category AND bc.exclude_from_budget = FALSE
         WHERE EXTRACT(YEAR FROM t.date) = EXTRACT(YEAR FROM CURRENT_DATE) AND t.hidden = FALSE)::text AS ytd_spent,
      (SELECT COUNT(*) FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
         WHERE t.mapped_category IS NULL AND t.hidden = FALSE)::text AS uncategorized,
      (SELECT COUNT(*) FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
         WHERE t.hidden = FALSE)::text AS total_txns
  `);
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

async function getMonthlySpending(): Promise<MonthlySpendingData[]> {
  const [spending, budgets] = await Promise.all([
    db.query<{ month_num: number; landscape: string; total: number }>(`
      SELECT EXTRACT(MONTH FROM t.date)::int AS month_num, a.landscape,
             COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0) AS total
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
      LEFT JOIN budget_categories bc ON bc.name = t.mapped_category
      WHERE EXTRACT(YEAR FROM t.date) = EXTRACT(YEAR FROM CURRENT_DATE)
        AND (t.mapped_category IS NULL OR bc.exclude_from_budget = FALSE)
        AND t.hidden = FALSE
      GROUP BY month_num, a.landscape
    `),
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

async function getCashFlow(): Promise<CashFlowData[]> {
  const result = await db.query<{ month_num: number; total_out: number; total_in: number }>(`
    SELECT EXTRACT(MONTH FROM t.date)::int AS month_num,
           COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)      AS total_out,
           COALESCE(ABS(SUM(t.amount) FILTER (WHERE t.amount < 0)), 0) AS total_in
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
    LEFT JOIN budget_categories bc ON bc.name = t.mapped_category
    WHERE EXTRACT(YEAR FROM t.date) = EXTRACT(YEAR FROM CURRENT_DATE)
      AND (t.mapped_category IS NULL OR bc.exclude_from_budget = FALSE)
      AND t.hidden = FALSE
    GROUP BY month_num ORDER BY month_num
  `);
  const rows = blankMonths<Omit<CashFlowData, 'month'>>({ in: 0, out: 0, net: 0 });
  for (const r of result.rows) {
    const row = rows[r.month_num - 1];
    row.out = Number(r.total_out); row.in = Number(r.total_in); row.net = row.in - row.out;
  }
  return rows;
}

async function getCategoryBreakdown(): Promise<CategorySlice[]> {
  const result = await db.query<CategorySlice>(`
    SELECT t.mapped_category AS name, bc.landscape,
           SUM(t.amount) FILTER (WHERE t.amount > 0) AS value
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
    JOIN budget_categories bc ON bc.name = t.mapped_category
    WHERE t.mapped_category IS NOT NULL
      AND bc.exclude_from_budget = FALSE
      AND t.hidden = FALSE
      AND EXTRACT(YEAR FROM t.date) = EXTRACT(YEAR FROM CURRENT_DATE)
    GROUP BY t.mapped_category, bc.landscape
    HAVING SUM(t.amount) FILTER (WHERE t.amount > 0) > 0
    ORDER BY value DESC
  `);
  return result.rows.map((r) => ({ ...r, value: Number(r.value) }));
}

async function getBudgetVsActual(): Promise<BudgetVsActualRow[]> {
  const result = await db.query<BudgetVsActualRow>(`
    SELECT bc.name AS category, bc.landscape, bc.annual_budget AS budget,
           COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0) AS spent
    FROM budget_categories bc
    LEFT JOIN transactions t ON t.mapped_category = bc.name
      AND EXTRACT(YEAR FROM t.date) = EXTRACT(YEAR FROM CURRENT_DATE)
      AND t.hidden = FALSE
    LEFT JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
    WHERE bc.exclude_from_budget = FALSE
      AND (t.id IS NULL OR a.id IS NOT NULL)
    GROUP BY bc.name, bc.landscape, bc.annual_budget
    ORDER BY bc.landscape, spent DESC
  `);
  return result.rows.map((r) => ({ ...r, budget: Number(r.budget), spent: Number(r.spent) }));
}

function KpiCard({ label, value, sub, highlight, href }: {
  label: string; value: string; sub?: string; highlight?: 'red' | 'green' | 'amber' | 'blue'; href?: string;
}) {
  const colors = {
    red: 'text-red-500', green: 'text-emerald-500', amber: 'text-amber-500', blue: 'text-blue-500',
  };
  const content = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-3xl font-bold mt-2 font-mono ${highlight ? colors[highlight] : 'text-slate-900'}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-slate-400 mt-1.5">{sub}</p>}
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

export default async function DashboardPage() {
  const [stats, monthly, cashflow, categories, budgetVsActual] = await Promise.all([
    getStats(), getMonthlySpending(), getCashFlow(), getCategoryBreakdown(), getBudgetVsActual(),
  ]);

  const pctUsed = stats.budget > 0 ? Math.round((stats.spent / stats.budget) * 100) : 0;
  const monthsElapsed = new Date().getMonth() + 1;
  const pctYear = Math.round((monthsElapsed / 12) * 100);
  const onTrack = stats.spent <= (stats.budget / 12) * monthsElapsed;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">{new Date().getFullYear()} · All accounts</p>
        </div>
        <span className={`text-sm font-medium px-3 py-1 rounded-full ${
          onTrack ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
        }`}>
          {onTrack ? '↓ Under pace' : '↑ Over pace'} · Month {monthsElapsed}/12
        </span>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <KpiCard label="Annual Budget" value={fmt(stats.budget)} />
        <KpiCard
          label="YTD Spent"
          value={fmt(stats.spent)}
          sub={`${pctUsed}% of annual · expected ${fmt((stats.budget / 12) * monthsElapsed)}`}
        />
        <KpiCard
          label="Remaining"
          value={fmt(stats.remaining)}
          highlight={stats.remaining < 0 ? 'red' : onTrack ? 'green' : 'amber'}
        />
        <KpiCard
          label="Uncategorized"
          value={`${stats.uncategorizedPct}%`}
          sub={stats.uncategorized > 0 ? `${stats.uncategorized} of ${stats.totalTxns} need review` : 'all categorized'}
          highlight={stats.uncategorized > 0 ? 'amber' : 'green'}
          href="/transactions?filter=uncategorized"
        />
      </div>

      {/* Pace bar */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">Year Pace</p>
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-500 w-28 shrink-0">Year elapsed</span>
            <div className="flex-1 bg-slate-100 rounded-full h-2">
              <div className="h-2 rounded-full bg-slate-400" style={{ width: `${pctYear}%` }} />
            </div>
            <span className="text-xs font-mono text-slate-400 w-8 text-right">{pctYear}%</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-500 w-28 shrink-0">Budget used</span>
            <div className="flex-1 bg-slate-100 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${pctUsed > pctYear ? 'bg-red-500' : 'bg-blue-500'}`}
                style={{ width: `${Math.min(pctUsed, 100)}%` }}
              />
            </div>
            <span className={`text-xs font-mono w-8 text-right ${pctUsed > pctYear ? 'text-red-500' : 'text-emerald-500'}`}>
              {pctUsed}%
            </span>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="space-y-6">
        <MonthlySpendingChart data={monthly} />
        <div className="grid grid-cols-2 gap-6">
          <CategoryDonutChart data={categories} />
          <CashFlowChart data={cashflow} />
        </div>
        <BudgetVsActualChart data={budgetVsActual} />
      </div>
    </div>
  );
}
