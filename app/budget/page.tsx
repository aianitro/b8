export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';
import Link from 'next/link';
import db from '@/lib/db';
import { daysInMonth } from '@/lib/domain/pacing';
import type { BudgetSummary, Landscape } from '@/shared/types';
import BudgetMonthlyGrid from '@/components/BudgetMonthlyGrid';
import BudgetViewToggle from '@/components/BudgetViewToggle';
import BudgetTabsToggle from '@/components/BudgetTabsToggle';
import BeginningBalanceEdit from '@/components/BeginningBalanceEdit';

type SummaryRow = BudgetSummary & { landscape: Landscape; is_income: boolean; monthly_amounts: string[] | null; closed_months: string; current_month: string };
interface UncategorizedRow { landscape: Landscape; count: string; total_out: string; total_in: string; }

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const pct = (spent: number, budget: number) =>
  budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;

async function getBudgetSummary(): Promise<SummaryRow[]> {
  const result = await db.query<SummaryRow>(`
    SELECT bc.name AS category, bc.landscape, bc.is_income, bc.annual_budget, bc.monthly_amounts,
           -- Net of refunds, NOT gross outflow. Filtering to amount > 0 counted money leaving
           -- and ignored money coming back, so Travel read 23,373 here against the monthly
           -- grid's 19,274 for the same year -- one page calling a cancelled booking spending
           -- and the other not. Across 2026 that was 11,169 of refunds, enough to decide the
           -- on-track pill by itself. Net is the side the budget is already on: annual_budget is
           -- what a category should COST, and a returned purchase cost nothing. Only expense rows
           -- reach this figure on screen (see Section), so the convention stays a spending one.
           COALESCE(SUM(t.amount), 0)                    AS ytd_spent,
           bc.annual_budget - COALESCE(SUM(t.amount), 0) AS remaining,
           -- Split either side of the month in progress, so a year-end projection can settle the
           -- closed months on fact and the current one on whichever of fact and plan is larger --
           -- the same rule the monthly grid projects with. Without the split the projection can
           -- only pro-rate the current month, which is the right convention for pace and the
           -- wrong one for a year end, since September finishes whatever today's date is.
           COALESCE(SUM(t.amount) FILTER (
             WHERE EXTRACT(MONTH FROM t.date) < EXTRACT(MONTH FROM CURRENT_DATE)), 0) AS closed_months,
           COALESCE(SUM(t.amount) FILTER (
             WHERE EXTRACT(MONTH FROM t.date) = EXTRACT(MONTH FROM CURRENT_DATE)), 0) AS current_month,
           ROUND(bc.annual_budget / 12, 2)                                            AS monthly_reference
    FROM budget_categories bc
    LEFT JOIN transactions t ON t.mapped_category = bc.name
      AND EXTRACT(YEAR FROM t.date) = EXTRACT(YEAR FROM CURRENT_DATE)
      AND t.hidden = FALSE
    LEFT JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
    WHERE bc.exclude_from_budget = FALSE
      AND (t.id IS NULL OR a.id IS NOT NULL)
    GROUP BY bc.name, bc.landscape, bc.is_income, bc.annual_budget, bc.monthly_amounts ORDER BY bc.name
  `);
  return result.rows;
}

async function getUncategorized(landscape: Landscape): Promise<UncategorizedRow | null> {
  const result = await db.query<UncategorizedRow>(`
    SELECT a.landscape,
           COUNT(t.id)::text AS count,
           COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::text  AS total_out,
           COALESCE(ABS(SUM(t.amount) FILTER (WHERE t.amount < 0)), 0)::text AS total_in
    FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
    WHERE t.mapped_category IS NULL
      AND t.hidden = FALSE
      AND a.landscape = $1
      AND EXTRACT(YEAR FROM t.date) = EXTRACT(YEAR FROM CURRENT_DATE)
    GROUP BY a.landscape
  `, [landscape]);
  return result.rows[0] ?? null;
}

const LANDSCAPE_BAR: Record<Landscape, string> = {
  operational: 'bg-blue-500',
  capital: 'bg-violet-500',
};

function Section({ title, rows, landscape }: { title: string; rows: SummaryRow[]; landscape: Landscape }) {
  if (rows.length === 0) return null;
  const totalBudget = rows.reduce((s, r) => s + Number(r.annual_budget), 0);
  const totalSpent  = rows.reduce((s, r) => s + Number(r.ytd_spent), 0);
  const remaining   = totalBudget - totalSpent;
  const p = pct(totalSpent, totalBudget);

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h2>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>Budget <span className="font-mono font-semibold text-slate-700">{fmt(totalBudget)}</span></span>
          <span>YTD <span className="font-mono font-semibold text-slate-700">{fmt(totalSpent)}</span></span>
          <span className={`font-mono font-semibold ${remaining < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
            {remaining < 0 ? '-' : '+'}{fmt(Math.abs(remaining))}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 bg-slate-100 rounded-full h-1.5">
          <div className={`h-1.5 rounded-full ${remaining < 0 ? 'bg-red-500' : LANDSCAPE_BAR[landscape]}`} style={{ width: `${p}%` }} />
        </div>
        <span className="text-xs font-mono text-slate-400">{p}%</span>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Category</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">Annual</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">Monthly ref</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">YTD spent</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">Remaining</th>
              <th className="px-6 py-3 w-40"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const over = Number(row.remaining) < 0;
              const rp = pct(Number(row.ytd_spent), Number(row.annual_budget));
              return (
                <tr key={row.category} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className={`w-0.5 h-4 rounded-full ${LANDSCAPE_BAR[landscape]}`} />
                      <span className="font-medium text-slate-800">{row.category}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-right font-mono text-slate-500 text-xs">{fmt(Number(row.annual_budget))}</td>
                  <td className="px-4 py-4 text-right font-mono text-slate-400 text-xs">{fmt(Number(row.monthly_reference))}</td>
                  <td className="px-4 py-4 text-right font-mono text-slate-800 font-medium">{fmt(Number(row.ytd_spent))}</td>
                  <td className={`px-4 py-4 text-right font-mono font-semibold ${over ? 'text-red-500' : 'text-emerald-600'}`}>
                    {over ? '-' : '+'}{fmt(Math.abs(Number(row.remaining)))}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full ${over ? 'bg-red-500' : LANDSCAPE_BAR[landscape]}`}
                          style={{ width: `${rp}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-slate-400 w-7 text-right">{rp}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UncategorizedCallout({ row }: { row: UncategorizedRow }) {
  return (
    <div className="border border-amber-200 bg-amber-50 rounded-2xl p-5 mb-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-amber-800 text-sm">{Number(row.count)} uncategorized transactions</p>
          <p className="text-xs text-amber-600 mt-0.5">Not counted toward any budget</p>
        </div>
        <a
          href="/transactions?filter=uncategorized"
          className="text-sm font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-lg transition-colors"
        >
          Review →
        </a>
      </div>
      <div className="flex gap-6 mt-3 pt-3 border-t border-amber-200 text-xs text-amber-700">
        {Number(row.total_out) > 0 && <span>{fmt(Number(row.total_out))} out</span>}
        {Number(row.total_in) > 0  && <span className="text-emerald-600">{fmt(Number(row.total_in))} in</span>}
      </div>
    </div>
  );
}

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function BudgetPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const cookieStore = await cookies();

  const cookieView = cookieStore.get('budgetView')?.value;
  const view: 'annual' | 'monthly' =
    params.view === 'monthly' || params.view === 'annual'
      ? params.view
      : cookieView === 'monthly'
      ? 'monthly'
      : 'annual';

  const cookieLandscape = cookieStore.get('budgetLandscape')?.value;
  const landscape: Landscape =
    params.landscape === 'capital' || params.landscape === 'operational'
      ? params.landscape
      : cookieLandscape === 'capital'
      ? 'capital'
      : 'operational';

  const year = new Date().getFullYear();

  const [summary, uncategorized, settingsRow] = await Promise.all([
    getBudgetSummary(),
    getUncategorized(landscape),
    db.query<{ beginning_balance: string }>(
      'SELECT beginning_balance FROM budget_settings WHERE year = $1 AND landscape = $2',
      [year, landscape]
    ),
  ]);

  const beginningBalance = Number(settingsRow.rows[0]?.beginning_balance ?? 0);

  const expenseRows = summary.filter((r) => r.landscape === landscape && !r.is_income);
  const totalBudget = expenseRows.reduce((s, r) => s + Number(r.annual_budget), 0);
  const totalSpent  = expenseRows.reduce((s, r) => s + Number(r.ytd_spent), 0);
  const totalRemaining = totalBudget - totalSpent;
  // What the plan says should have been spent by today — the figure the on-track pill is decided
  // on, and the one printed under YTD Spent.
  //
  // It used to be `annual / 12 * monthsElapsed`, which is wrong twice over. It spread every budget
  // evenly no matter what schedule the category actually carries: property tax is two bills, April
  // and November, so by the end of September the plan expects one of them — $7,680 — while a flat
  // twelfth expected $11,535, a November bill part-paid since January. The errors ran both ways
  // across categories (`One time` was understated by $6,350 by the same rule) and largely
  // cancelled, which made the total look defensible and was luck rather than correctness.
  //
  // And it counted the current month as fully elapsed, so on the 10th it already expected all of
  // September. lib/domain/pacing.ts names that convention and rejects it for flattering the pace;
  // this now uses the same one it does — the day counts as elapsed, so the fraction runs from
  // 1/31 to 1 and is never zero.
  const now = new Date();
  const monthIdx = now.getMonth();
  const elapsedFraction = now.getDate() / daysInMonth(now.getFullYear(), monthIdx);
  const schedule = (r: SummaryRow): number[] =>
    r.monthly_amounts?.length === 12
      ? r.monthly_amounts.map(Number)
      : new Array(12).fill(Number(r.annual_budget) / 12);
  const plannedToDate = (rows: SummaryRow[]) => rows.reduce((sum, r) => {
    const m = schedule(r);
    return sum + m.slice(0, monthIdx).reduce((s, n) => s + n, 0) + m[monthIdx] * elapsedFraction;
  }, 0);
  const expectedSpend = plannedToDate(expenseRows);
  const onTrack = totalSpent <= expectedSpend;

  // Profit and loss for the year. Income rows carry the ledger's sign, where money in is negative,
  // so they are flipped once here and read as "received" everywhere below.
  const incomeRows   = summary.filter((r) => r.landscape === landscape && r.is_income);
  const incomeBudget = incomeRows.reduce((s, r) => s + Number(r.annual_budget), 0);
  const incomeActual = -incomeRows.reduce((s, r) => s + Number(r.ytd_spent), 0);
  //
  // Where the year lands if the rest of it goes to plan. Deliberately not incomeBudget minus
  // totalBudget, which is the plan talking to itself and would not move however the year went;
  // and not the year-to-date net either, which mid-year is a partial month of pay against a full
  // one of spending. Closed months are fact, the current month is plan-or-actual whichever is
  // larger, and the rest is plan -- the same rule the monthly grid's own forecast rows use, so
  // the card and the December column beneath it cannot disagree.
  // `sign` flips income's ledger convention so both sides read as positive magnitudes.
  const projectedFor = (rows: SummaryRow[], sign: 1 | -1) => rows.reduce((sum, r) => {
    const m = schedule(r);
    const closed  = sign * Number(r.closed_months);
    const current = sign * Number(r.current_month);
    return sum + closed + Math.max(current, m[monthIdx])
               + m.slice(monthIdx + 1).reduce((s, n) => s + n, 0);
  }, 0);
  const projectedIncome  = projectedFor(incomeRows, -1);
  const projectedExpense = projectedFor(expenseRows, 1);
  const projectedPL      = projectedIncome - projectedExpense;
  const netToDate        = incomeActual - totalSpent;

  return (
    <div className={view === 'monthly' ? 'p-8' : 'p-8 max-w-4xl mx-auto'}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Budget {new Date().getFullYear()}</h1>
        </div>
        <div className="flex items-center gap-3">
          <BudgetViewToggle current={view} landscape={landscape} />
          <span className={`text-sm font-medium px-3 py-1 rounded-full ${
            onTrack ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}>
            {onTrack ? '✓ On track' : '↑ Over pace'}
          </span>
        </div>
      </div>

      {/* Landscape tabs */}
      <BudgetTabsToggle current={landscape} view={view} />

      {summary.length === 0 ? (
        <p className="text-slate-500 text-sm">No categories yet. <Link href="/categories" className="underline">Add some.</Link></p>
      ) : (
        <>
          {/* KPIs */}
          <div className={`grid gap-4 mb-8 ${view === 'monthly' ? 'grid-cols-2 lg:grid-cols-4 max-w-4xl' : 'grid-cols-2 lg:grid-cols-4'}`}>
            {[
              { label: 'Annual Budget', value: fmt(totalBudget) },
              {
                label: 'YTD Spent',
                value: fmt(totalSpent),
                // Expected alone. "72% used" measured spend against the WHOLE year, which says
                // nothing in September without the reader supplying the elapsed fraction
                // themselves — and 72% of the year's money at 78% through the year is either fine
                // or not depending on a second number that was not on screen. Expected is that
                // comparison already made, on the real schedules, and it is what the Remaining
                // card is coloured by, so the two now agree instead of offering rival yardsticks.
                sub: `expected ${fmt(expectedSpend)}`,
              },
              {
                label: 'Remaining',
                value: (totalRemaining < 0 ? '-' : '') + fmt(Math.abs(totalRemaining)),
                highlight: totalRemaining < 0 ? 'text-red-500' : onTrack ? 'text-emerald-600' : 'text-amber-500',
              },
              {
                label: 'Projected P/L',
                value: (projectedPL < 0 ? '−' : '+') + fmt(Math.abs(projectedPL)),
                sub: `${netToDate < 0 ? '−' : '+'}${fmt(Math.abs(netToDate))} so far`,
                highlight: projectedPL < 0 ? 'text-red-500' : 'text-emerald-600',
              },
            ].map(({ label, value, sub, highlight }) => (
              <div key={label} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
                <p className={`text-3xl font-bold mt-2 font-mono ${highlight ?? 'text-slate-900'}`}>{value}</p>
                {sub && <p className="text-xs text-slate-400 mt-1.5">{sub}</p>}
              </div>
            ))}
          </div>

          {view === 'monthly' ? (
            <>
              <div className="mb-4 flex items-center justify-end">
                <BeginningBalanceEdit value={beginningBalance} year={year} landscape={landscape} />
              </div>
              <BudgetMonthlyGrid landscape={landscape} />
            </>
          ) : (
            <>
              {uncategorized && Number(uncategorized.count) > 0 && (
                <UncategorizedCallout row={uncategorized} />
              )}
              <Section title="Expenses" rows={expenseRows} landscape={landscape} />
            </>
          )}

        </>
      )}
    </div>
  );
}
