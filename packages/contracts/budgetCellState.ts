// What one month-cell of the budget grid IS, independent of how any client paints it.
//
// IN THE CONTRACTS PACKAGE BECAUSE TWO CLIENTS GRADE THE SAME CELLS. The web maps these states to
// Tailwind classes (`apps/web/lib/budgetColors.ts`); the phone maps them to hex
// (`apps/mobile/widgets/cellColors.ts`). Putting the RULE here and the PAINT there is what stops
// "over budget" from having two definitions — the defect this repo has spent the most effort on.
//
// No zod in this file: these are functions, not a wire shape. It lives here for reachability, which
// is what a shared package is for.

export type CellState =
  /** A month that has not happened. */
  | 'future'
  /** Nothing against this category this month. */
  | 'empty'
  /** Spend landed outside an explicit schedule's window — the finding IS the absent plan. */
  | 'off-cycle'
  /** Over 110% of plan. */
  | 'over'
  /** Between 100% and 110% — the "watch it" zone. */
  | 'watch'
  /** Between 50% and 100% of plan. */
  | 'on-plan'
  /** Under half the plan. */
  | 'well-under'
  /** Income at or above target. */
  | 'income-met'
  /** Income between half and target. */
  | 'income-part'
  /** Income below half, or arriving off-schedule. */
  | 'income-short'
  /** An income category that netted an expense, or an expense that netted income. Always notable. */
  | 'inverted';

/**
 * How far through the month's plan the spend is.
 *
 * `Infinity` for an off-cycle month is deliberate and load-bearing: the category HAS a schedule, this
 * month's plan is zero, and money landed anyway — so there is no ratio, and every threshold below
 * should treat it as the worst case rather than divide by zero.
 */
export function monthPct(spent: number, monthlyBudget: number, offCycle: boolean): number {
  if (offCycle) return Infinity;
  if (monthlyBudget > 0) return spent / monthlyBudget;
  return 0;
}

export function expenseCellState(
  spent: number, monthlyBudget: number, isFuture: boolean, offCycle: boolean
): CellState {
  if (isFuture) return 'future';
  if (spent === 0) return 'empty';
  const pct = monthPct(spent, monthlyBudget, offCycle);
  if (pct > 1.1) return 'over';
  if (pct > 1.0) return 'watch';
  if (pct > 0.5) return 'on-plan';
  return 'well-under';
}

export function incomeCellState(
  received: number, monthlyTarget: number, isFuture: boolean, offCycle: boolean
): CellState {
  if (isFuture) return 'future';
  if (received === 0) return 'empty';
  if (offCycle) return 'income-short';
  const pct = monthlyTarget > 0 ? received / monthlyTarget : 1;
  if (pct >= 1.0) return 'income-met';
  if (pct >= 0.5) return 'income-part';
  return 'income-short';
}
