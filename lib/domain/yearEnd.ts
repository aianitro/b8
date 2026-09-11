// Where a year lands if the rest of it goes to plan.
//
// Pure, and deliberately separate from the pages that render it: the budget header and the
// dashboard both answer "how does the year end", and two copies of this arithmetic would be the
// drifting-definitions defect in BUILD.md §1 landing on the one figure the owner steers by. One
// definition, two callers — the same split `lib/domain/netWorth.ts` and `lib/netWorth.ts` use.
//
// NOT the same question as pacing (`lib/domain/pacing.ts`). Pacing asks "should this have been
// spent by today" and pro-rates the month in progress by elapsed days, which is right for a
// verdict about behaviour and wrong for a year end — September finishes whatever today's date is.
// Here the month in progress counts whole. Built the other way round, the budget page's projection
// read $13,321 below the monthly grid's forecast sitting directly beneath it.

export interface YearEndRow {
  /** The category's full-year allocation. Used only when no schedule is present. */
  annualBudget: number;
  /** Explicit per-month plan, Jan–Dec. Null means spread `annualBudget` evenly. */
  monthlyAmounts: number[] | null;
  /** Actual for months strictly before the as-of month, in the ledger's sign. */
  closedMonths: number;
  /** Actual for the as-of month so far, in the ledger's sign. */
  currentMonth: number;
}

export interface YearEndProjection {
  income: number;
  expense: number;
  /** `income − expense`. Negative is a loss. */
  profitLoss: number;
}

export const MONTHS_PER_YEAR = 12;

/** A category's plan for one month: an explicit schedule wins, else the even spread. */
export function plannedForMonth(row: YearEndRow, monthIdx: number): number {
  const m = row.monthlyAmounts;
  return m && m.length === MONTHS_PER_YEAR ? m[monthIdx] : row.annualBudget / MONTHS_PER_YEAR;
}

/**
 * One side's year-end total: closed months on fact, the month in progress on plan-or-actual
 * whichever is larger, the rest on plan.
 *
 * `sign` flips income's ledger convention, where money in is negative, so both sides come back as
 * positive magnitudes and the subtraction below reads the way the words do.
 *
 * The month in progress takes the LARGER of the two because a month cannot un-spend what it has
 * spent: a category already past its line will not close back under it, and one that has barely
 * started will most likely close at its plan. Taking the plan alone would under-report a category
 * mid-overrun; taking the actual alone would report a month ten days old as if it were over.
 */
export function projectSide(rows: YearEndRow[], monthIdx: number, sign: 1 | -1): number {
  if (!Number.isInteger(monthIdx) || monthIdx < 0 || monthIdx >= MONTHS_PER_YEAR) {
    throw new RangeError(`projectSide: monthIdx must be an integer 0-11, got ${monthIdx}`);
  }
  return rows.reduce((sum, row) => {
    const closed  = sign * row.closedMonths;
    const current = sign * row.currentMonth;
    let future = 0;
    for (let i = monthIdx + 1; i < MONTHS_PER_YEAR; i++) future += plannedForMonth(row, i);
    return sum + closed + Math.max(current, plannedForMonth(row, monthIdx)) + future;
  }, 0);
}

export function projectYearEnd(
  incomeRows: YearEndRow[],
  expenseRows: YearEndRow[],
  monthIdx: number
): YearEndProjection {
  const income  = projectSide(incomeRows, monthIdx, -1);
  const expense = projectSide(expenseRows, monthIdx, 1);
  return { income, expense, profitLoss: income - expense };
}
