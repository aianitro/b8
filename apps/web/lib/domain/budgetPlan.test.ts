import { describe, expect, it } from 'vitest';
import { monthsBudget } from './budgetPlan';

describe('monthsBudget', () => {
  it('spreads an annual budget evenly when there is no schedule', () => {
    expect(monthsBudget(1200, null)).toEqual(new Array(12).fill(100));
  });

  it('uses an explicit twelve-month schedule verbatim', () => {
    const schedule = [0, 0, 0, 0, 0, 4200, 0, 4200, 0, 0, 0, 0];
    expect(monthsBudget(8400, schedule)).toEqual(schedule);
  });

  it('falls back to the even spread on a WRONG-LENGTH schedule rather than padding it', () => {
    // Padding would invent a plan of zero for the uncovered months, and a plan of zero reads as
    // "budgeted nothing" rather than "not budgeted" — the column's own constraint treats a
    // wrong-length array as no schedule, and this agrees with it.
    expect(monthsBudget(1200, [100, 100, 100])).toEqual(new Array(12).fill(100));
    expect(monthsBudget(1200, [])).toEqual(new Array(12).fill(100));
  });

  it('divides without rounding, so twelve months sum back to the annual figure', () => {
    // $1,000 / 12 is not a cent figure. Rounding per month would lose or gain up to 12 cents against
    // the annual budget, and the adherence module resolves a month's budget to the same cent — a
    // rounding here would make the two disagree at the fifth decimal.
    const plan = monthsBudget(1000, null);
    expect(plan.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 10);
  });

  it('handles a zero annual budget without producing NaN', () => {
    expect(monthsBudget(0, null)).toEqual(new Array(12).fill(0));
  });
});
