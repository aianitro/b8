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

/**
 * The same projection, month by month, for drawing rather than for a single figure.
 *
 * Shares `plannedForMonth` and the closed/current/future rule with `projectSide` above, so a chart
 * built on this and a card built on that cannot disagree — the last value of `cumulative` is
 * `projectYearEnd(...).profitLoss` by construction, and a test pins that.
 *
 * `monthlyActuals` is indexed Jan–Dec in the LEDGER's sign; `sign` flips income once, as elsewhere.
 */
export interface YearEndMonthlyRow extends YearEndRow {
  /** Per-month actual, Jan–Dec, in the ledger's sign. Absent months are zero, not missing. */
  monthlyActuals: number[];
}

/**
 * Builds a monthly row with `closedMonths` and `currentMonth` DERIVED from the same array the
 * monthly projection reads, so the aggregate and the series cannot be given different actuals.
 *
 * They are the same numbers summed two ways, and letting a caller supply both independently is an
 * invitation to supply one and forget the other — which is exactly what happened the first time
 * this was written, and it showed up as a chart ending $8,400 away from the card above it.
 */
export function monthlyRow(
  annualBudget: number,
  monthlyAmounts: number[] | null,
  monthlyActuals: number[],
  monthIdx: number
): YearEndMonthlyRow {
  let closed = 0;
  for (let m = 0; m < monthIdx; m++) closed += monthlyActuals[m] ?? 0;
  return {
    annualBudget,
    monthlyAmounts,
    monthlyActuals,
    closedMonths: closed,
    currentMonth: monthlyActuals[monthIdx] ?? 0,
  };
}

export interface MonthPoint {
  /** Money in for this month — actual where settled, plan where forecast. */
  income: number;
  /** Money out for this month, as a positive magnitude, on the same rule. */
  expense: number;
  /** Net for this month alone: income less expense. */
  net: number;
  /** Running total from January. The December value is the year's P/L. */
  cumulative: number;
  /** True once the month is wholly or partly forecast rather than settled. */
  projected: boolean;
}

/** One side's per-month total, on the same rule `projectSide` uses for its aggregate. */
function sideByMonth(rows: YearEndMonthlyRow[], monthIdx: number, sign: 1 | -1): number[] {
  const out = new Array(MONTHS_PER_YEAR).fill(0);
  for (const row of rows) {
    for (let m = 0; m < MONTHS_PER_YEAR; m++) {
      const actual = sign * (row.monthlyActuals[m] ?? 0);
      const planned = plannedForMonth(row, m);
      out[m] += m < monthIdx ? actual : m === monthIdx ? Math.max(actual, planned) : planned;
    }
  }
  return out;
}

export function projectYearEndByMonth(
  incomeRows: YearEndMonthlyRow[],
  expenseRows: YearEndMonthlyRow[],
  monthIdx: number
): MonthPoint[] {
  if (!Number.isInteger(monthIdx) || monthIdx < 0 || monthIdx >= MONTHS_PER_YEAR) {
    throw new RangeError(`projectYearEndByMonth: monthIdx must be an integer 0-11, got ${monthIdx}`);
  }
  const income = sideByMonth(incomeRows, monthIdx, -1);
  const expense = sideByMonth(expenseRows, monthIdx, 1);

  const out: MonthPoint[] = [];
  let running = 0;
  for (let m = 0; m < MONTHS_PER_YEAR; m++) {
    const net = income[m] - expense[m];
    running += net;
    // The AS-OF month counts as projected: part of it has not happened, and a solid line drawn to
    // its end would claim a settled figure for a month still running.
    out.push({ income: income[m], expense: expense[m], net, cumulative: running, projected: m >= monthIdx });
  }
  return out;
}
