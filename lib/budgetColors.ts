// Shared month-cell status coloring for anywhere spend-vs-budget is shown per month
// (the monthly budget grid, the category detail page's monthly allocation panel, ...).
// Keeping this in one place means tuning the thresholds once instead of drifting apart.

// offCycle: this month has $0 expected AND real activity, for a category that DOES have an
// explicit schedule — i.e. spend landed outside its expected window. Distinct from
// "no budget configured at all" (monthlyBudget === 0 with no schedule), which stays neutral.
export function monthPct(spent: number, monthlyBudget: number, offCycle: boolean): number {
  if (offCycle) return Infinity;
  if (monthlyBudget > 0) return spent / monthlyBudget;
  return 0;
}

// On budget (0-100%) is green. 100-110% over is the amber "watch it" zone. >110% is red.
export function expenseCellStyle(spent: number, monthlyBudget: number, isFuture: boolean, offCycle: boolean): string {
  if (isFuture) return 'bg-slate-50';
  if (spent === 0) return 'bg-white';
  const pct = monthPct(spent, monthlyBudget, offCycle);
  if (pct > 1.1) return 'bg-red-100';
  if (pct > 1.0) return 'bg-amber-50';
  if (pct > 0.5) return 'bg-emerald-50';
  return 'bg-green-50';
}

export function expenseCellText(spent: number, monthlyBudget: number, isFuture: boolean, offCycle: boolean): string {
  if (isFuture) return 'text-slate-300';
  if (spent === 0) return 'text-slate-300';
  const pct = monthPct(spent, monthlyBudget, offCycle);
  if (pct > 1.1) return 'text-red-700 font-semibold';
  if (pct > 1.0) return 'text-amber-700 font-medium';
  return 'text-slate-700';
}

export function incomeCellStyle(received: number, monthlyTarget: number, isFuture: boolean, offCycle: boolean): string {
  if (isFuture) return 'bg-slate-50';
  if (received === 0) return 'bg-white';
  if (offCycle) return 'bg-amber-50';
  const pct = monthlyTarget > 0 ? received / monthlyTarget : 1;
  if (pct >= 1.0) return 'bg-emerald-100';
  if (pct >= 0.5) return 'bg-emerald-50';
  return 'bg-amber-50';
}

export function incomeCellText(received: number, isFuture: boolean): string {
  if (isFuture || received === 0) return 'text-slate-300';
  return 'text-emerald-700 font-medium';
}
