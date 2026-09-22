// Month-cell colours for the web, mapped from the shared state in `lib/domain/budgetCellState.ts`.
//
// THE THRESHOLDS LEFT THIS FILE and the class names stayed. They were together until the phone
// needed the same grid: Tailwind classes do not exist in React Native, so a port had to either
// duplicate "over budget" or split the rule from the paint. The rule is now one function both
// clients call, and this file is the web's palette for its answers.
//
// `budgetColors.test.ts` asserts every state still maps to the class it mapped to before the split,
// so the grid renders identically.

import {
  expenseCellState, incomeCellState, monthPct, type CellState,
} from './domain/budgetCellState';

export { monthPct };

const EXPENSE_BG: Record<CellState, string> = {
  future: 'bg-slate-50',
  empty: 'bg-white',
  over: 'bg-red-100',
  watch: 'bg-amber-50',
  'on-plan': 'bg-emerald-50',
  'well-under': 'bg-green-50',
  // Off-cycle reaches the expense grading as `over`, because `monthPct` returns Infinity for it.
  // Present for exhaustiveness rather than because the expense path produces it.
  'off-cycle': 'bg-red-100',
  'income-met': 'bg-emerald-100',
  'income-part': 'bg-emerald-50',
  'income-short': 'bg-amber-50',
  inverted: 'bg-red-100',
};

const EXPENSE_TEXT: Record<CellState, string> = {
  future: 'text-slate-300',
  empty: 'text-slate-300',
  over: 'text-red-700 font-semibold',
  watch: 'text-amber-700 font-medium',
  'on-plan': 'text-slate-700',
  'well-under': 'text-slate-700',
  'off-cycle': 'text-red-700 font-semibold',
  'income-met': 'text-emerald-700 font-medium',
  'income-part': 'text-emerald-700 font-medium',
  'income-short': 'text-emerald-700 font-medium',
  inverted: 'text-red-700 font-semibold',
};

export function expenseCellStyle(spent: number, monthlyBudget: number, isFuture: boolean, offCycle: boolean): string {
  return EXPENSE_BG[expenseCellState(spent, monthlyBudget, isFuture, offCycle)];
}

export function expenseCellText(spent: number, monthlyBudget: number, isFuture: boolean, offCycle: boolean): string {
  return EXPENSE_TEXT[expenseCellState(spent, monthlyBudget, isFuture, offCycle)];
}

const INCOME_BG: Record<string, string> = {
  future: 'bg-slate-50',
  empty: 'bg-white',
  'income-met': 'bg-emerald-100',
  'income-part': 'bg-emerald-50',
  'income-short': 'bg-amber-50',
};

export function incomeCellStyle(received: number, monthlyTarget: number, isFuture: boolean, offCycle: boolean): string {
  return INCOME_BG[incomeCellState(received, monthlyTarget, isFuture, offCycle)] ?? 'bg-white';
}

export function incomeCellText(received: number, isFuture: boolean): string {
  if (isFuture || received === 0) return 'text-slate-300';
  return 'text-emerald-700 font-medium';
}
