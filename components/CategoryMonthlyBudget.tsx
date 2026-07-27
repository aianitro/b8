'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import MonthlyAmountsEditor, { scheduleLabel } from './MonthlyAmountsEditor';
import { expenseCellStyle, expenseCellText, incomeCellStyle, incomeCellText } from '@/lib/budgetColors';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmt = (n: number) =>
  n === 0 ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmtFull = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

// monthly_amounts unset -> spread annual_budget evenly across all 12 months; otherwise each
// month uses its own explicit expected amount. Mirrors BudgetMonthlyGrid.tsx's monthsBudget().
function monthsBudget(annual: number, monthlyAmounts: number[] | null): number[] {
  if (monthlyAmounts && monthlyAmounts.length === 12) return monthlyAmounts;
  return new Array(12).fill(annual / 12);
}

interface Props {
  categoryId: number;
  categoryName: string;
  annualBudget: number;
  monthlyAmounts: number[] | null;
  isIncome: boolean;
  monthlyActuals: number[]; // 12 values, sign-adjusted so positive = "counts toward this category's budget"
  currentMonth: number; // 0-indexed
  year: number;
}

export default function CategoryMonthlyBudget({
  categoryId, categoryName, annualBudget, monthlyAmounts, isIncome, monthlyActuals, currentMonth, year,
}: Props) {
  const router = useRouter();
  const budgets = monthsBudget(annualBudget, monthlyAmounts);
  const hasSchedule = Boolean(monthlyAmounts);

  async function saveMonthlyAmounts(amounts: number[] | null) {
    await fetch('/api/categories', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: categoryId, monthly_amounts: amounts }),
    });
    router.refresh();
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Monthly Budget</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {fmtFull(annualBudget)}/yr · {scheduleLabel(monthlyAmounts)}
          </p>
        </div>
        <MonthlyAmountsEditor annualBudget={annualBudget} monthlyAmounts={monthlyAmounts} onSave={saveMonthlyAmounts} />
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
        {MONTHS.map((label, i) => {
          const actual = monthlyActuals[i] ?? 0;
          const budget = budgets[i];
          const isFuture = i > currentMonth;
          const offCycle = hasSchedule && budget === 0 && actual !== 0;
          const bg = isIncome
            ? incomeCellStyle(actual, budget, isFuture, offCycle)
            : expenseCellStyle(actual, budget, isFuture, offCycle);
          const text = isIncome
            ? incomeCellText(actual, isFuture)
            : expenseCellText(actual, budget, isFuture, offCycle);
          const pct = budget > 0 ? Math.round((actual / budget) * 100) : 0;

          const inner = (
            <div className={`rounded-lg p-2 h-full ${bg} ${!isFuture ? 'hover:brightness-95 transition-[filter]' : ''}`}>
              <div className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</div>
              <div className={`text-sm font-mono font-semibold ${text}`}>{fmt(actual)}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {offCycle ? 'off-cycle' : `of ${fmt(budget)}`}
              </div>
            </div>
          );

          return isFuture ? (
            <div key={label} title={label}>{inner}</div>
          ) : (
            <Link
              key={label}
              href={`/transactions?category=${encodeURIComponent(categoryName)}&month=${i + 1}`}
              title={`${label} ${year}: ${fmtFull(actual)} (${offCycle ? 'off-cycle' : `${pct}% of ${fmtFull(budget)}`})`}
            >
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
