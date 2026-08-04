export const dynamic = 'force-dynamic';

import type { ReactNode } from 'react';
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

// Same per-account running-balance computation as app/balances/page.tsx (beginning_balance +
// sum of monthly net through the current month), just combined across both landscapes into one
// total instead of one landscape at a time — no page in the app, including Balances itself,
// otherwise shows a single combined operational + capital number. Derived from recorded
// transactions, not a live Plaid balance pull — see db/schema.sql's account_balances comment.
async function getNetWorth(): Promise<{ total: number; accountCount: number }> {
  const year = new Date().getFullYear();
  const currentMonth = new Date().getMonth();

  const [accountsRes, netRes, balancesRes] = await Promise.all([
    db.query<{ id: string }>('SELECT id FROM accounts WHERE track_transactions = TRUE'),
    db.query<{ account_id: string; month: number; net: string }>(`
      SELECT t.account_id,
             EXTRACT(MONTH FROM t.date)::int AS month,
             (COALESCE(ABS(SUM(t.amount) FILTER (WHERE t.amount < 0)), 0)
              - COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0))::text AS net
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
      WHERE EXTRACT(YEAR FROM t.date) = $1
      GROUP BY t.account_id, EXTRACT(MONTH FROM t.date)::int
    `, [year]),
    db.query<{ account_id: string; beginning_balance: string }>(
      'SELECT account_id, beginning_balance FROM account_balances WHERE year = $1',
      [year]
    ),
  ]);

  const netByAccount = new Map<string, Map<number, number>>();
  for (const r of netRes.rows) {
    if (!netByAccount.has(r.account_id)) netByAccount.set(r.account_id, new Map());
    netByAccount.get(r.account_id)!.set(r.month, Number(r.net));
  }
  const beginningByAccount = new Map(balancesRes.rows.map((r) => [r.account_id, Number(r.beginning_balance)]));

  let total = 0;
  for (const a of accountsRes.rows) {
    const byMonth = netByAccount.get(a.id) ?? new Map();
    let running = beginningByAccount.get(a.id) ?? 0;
    for (let i = 0; i <= currentMonth; i++) running += byMonth.get(i + 1) ?? 0;
    total += running;
  }
  return { total, accountCount: accountsRes.rows.length };
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
}

async function getWeekStats(): Promise<WeekStats> {
  const [weekResult, lastWeekResult, budgetResult] = await Promise.all([
    db.query<{ spent: string }>(`
      SELECT COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::text AS spent
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

function KpiCard({ label, value, sub, subColor, highlight, href, footer }: {
  label: string; value: string; sub?: string; subColor?: 'red' | 'green' | 'amber' | 'blue';
  highlight?: 'red' | 'green' | 'amber' | 'blue'; href?: string; footer?: ReactNode;
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
      {sub && <p className={`text-xs mt-1.5 ${subColor ? colors[subColor] : 'text-slate-400'}`}>{sub}</p>}
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

function paceColor(pct: number): 'red' | 'amber' | 'green' {
  if (pct > 1.1) return 'red';
  if (pct > 1.0) return 'amber';
  return 'green';
}

export default async function DashboardPage() {
  const [stats, netWorth, todayStats, weekStats, monthly, cashflow, categories, budgetVsActual] = await Promise.all([
    getStats(), getNetWorth(), getTodayStats(), getWeekStats(), getMonthlySpending(), getCashFlow(), getCategoryBreakdown(), getBudgetVsActual(),
  ]);

  const pctUsed = stats.budget > 0 ? Math.round((stats.spent / stats.budget) * 100) : 0;
  const monthsElapsed = new Date().getMonth() + 1;
  const pctYear = Math.round((monthsElapsed / 12) * 100);
  const expectedYearSpend = (stats.budget / 12) * monthsElapsed;
  const onTrack = stats.spent <= expectedYearSpend;
  const yearPacePct = expectedYearSpend > 0 ? stats.spent / expectedYearSpend : 0;

  const todayDelta = todayStats.spent - todayStats.avgSameWeekday;
  const todayVsAvgPct = todayStats.avgSameWeekday > 0
    ? todayStats.spent / todayStats.avgSameWeekday
    : (todayStats.spent > 0 ? Infinity : 0);
  const weekdayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  const weekDelta = weekStats.spent - weekStats.spentComparableLastWeek;
  const isoDow = new Date().getDay() === 0 ? 7 : new Date().getDay(); // Monday=1..Sunday=7, matches date_trunc('week', ...)
  const expectedWeekSpend = weekStats.weeklyBudgetReference * (isoDow / 7);
  const weekPacePct = expectedWeekSpend > 0 ? weekStats.spent / expectedWeekSpend : 0;

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

      {/* Day / Week / Year — three concurrently-visible time horizons, not tabbed */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <KpiCard
          label="Today"
          value={fmt(todayStats.spent)}
          sub={todayStats.avgSameWeekday > 0
            ? `${todayDelta >= 0 ? '+' : ''}${fmt(todayDelta)} vs typical ${weekdayName}`
            : undefined}
          subColor={todayStats.avgSameWeekday > 0 ? paceColor(todayVsAvgPct) : undefined}
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
          subColor={expectedWeekSpend > 0 ? paceColor(weekPacePct) : undefined}
          footer={<p className="text-xs text-slate-400">{fmt(weekStats.weeklyBudgetReference)}/wk reference</p>}
        />
        <KpiCard
          label="This Year"
          value={fmt(stats.spent)}
          sub={`${pctUsed}% of annual · expected ${fmt(expectedYearSpend)}`}
          subColor={expectedYearSpend > 0 ? paceColor(yearPacePct) : undefined}
        />
      </div>

      {/* Year detail — "This Year" above already gives the headline number; these round out the
          annual picture (net worth, budget ceiling, remaining, uncategorized) without repeating it. */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Net Worth"
          value={fmt(netWorth.total)}
          sub={`as of last sync · ${netWorth.accountCount} account${netWorth.accountCount !== 1 ? 's' : ''}`}
          highlight={netWorth.total < 0 ? 'red' : undefined}
        />
        <KpiCard label="Annual Budget" value={fmt(stats.budget)} />
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
