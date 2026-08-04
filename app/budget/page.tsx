export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';
import Link from 'next/link';
import db from '@/lib/db';
import type { BudgetSummary, Landscape } from '@/shared/types';
import BudgetMonthlyGrid from '@/components/BudgetMonthlyGrid';
import BudgetViewToggle from '@/components/BudgetViewToggle';
import BudgetTabsToggle from '@/components/BudgetTabsToggle';
import BeginningBalanceEdit from '@/components/BeginningBalanceEdit';

type SummaryRow = BudgetSummary & { landscape: Landscape; is_income: boolean };
interface UncategorizedRow { landscape: Landscape; count: string; total_out: string; total_in: string; }

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const pct = (spent: number, budget: number) =>
  budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;

async function getBudgetSummary(): Promise<SummaryRow[]> {
  const result = await db.query<SummaryRow>(`
    SELECT bc.name AS category, bc.landscape, bc.is_income, bc.annual_budget,
           COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)                    AS ytd_spent,
           bc.annual_budget - COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0) AS remaining,
           ROUND(bc.annual_budget / 12, 2)                                            AS monthly_reference
    FROM budget_categories bc
    LEFT JOIN transactions t ON t.mapped_category = bc.name
      AND EXTRACT(YEAR FROM t.date) = EXTRACT(YEAR FROM CURRENT_DATE)
      AND t.hidden = FALSE
    LEFT JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
    WHERE bc.exclude_from_budget = FALSE
      AND (t.id IS NULL OR a.id IS NOT NULL)
    GROUP BY bc.name, bc.landscape, bc.is_income, bc.annual_budget ORDER BY bc.name
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
  const monthsElapsed = new Date().getMonth() + 1;
  const expectedSpend = (totalBudget / 12) * monthsElapsed;
  const onTrack = totalSpent <= expectedSpend;

  return (
    <div className={view === 'monthly' ? 'p-8' : 'p-8 max-w-4xl mx-auto'}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Budget {new Date().getFullYear()}</h1>
          <p className="text-sm text-slate-500 mt-1">Annual allocations · month {monthsElapsed} of 12</p>
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
          <div className={`grid gap-4 mb-8 ${view === 'monthly' ? 'grid-cols-3 max-w-2xl' : 'grid-cols-3'}`}>
            {[
              { label: 'Annual Budget', value: fmt(totalBudget) },
              {
                label: 'YTD Spent',
                value: fmt(totalSpent),
                sub: `${Math.round(totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0)}% used · expected ${fmt(expectedSpend)}`,
              },
              {
                label: 'Remaining',
                value: (totalRemaining < 0 ? '-' : '') + fmt(Math.abs(totalRemaining)),
                highlight: totalRemaining < 0 ? 'text-red-500' : onTrack ? 'text-emerald-600' : 'text-amber-500',
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
