import { describe, it, expect } from 'vitest';
import { plannedForMonth, projectSide, projectYearEnd, type YearEndRow } from './yearEnd';

const row = (over: Partial<YearEndRow> = {}): YearEndRow => ({
  annualBudget: 1200, monthlyAmounts: null, closedMonths: 0, currentMonth: 0, ...over,
});

describe('plannedForMonth', () => {
  it('spreads the annual budget evenly when no schedule is set', () => {
    expect(plannedForMonth(row(), 0)).toBe(100);
    expect(plannedForMonth(row(), 11)).toBe(100);
  });

  it('prefers an explicit schedule over the even spread', () => {
    const r = row({ monthlyAmounts: [0, 0, 0, 7680, 0, 0, 0, 0, 0, 0, 7700, 0], annualBudget: 15380 });
    expect(plannedForMonth(r, 3)).toBe(7680);
    expect(plannedForMonth(r, 8)).toBe(0);
  });

  it('ignores a schedule that is not a full twelve months', () => {
    expect(plannedForMonth(row({ monthlyAmounts: [500, 500] }), 0)).toBe(100);
  });
});

describe('projectSide', () => {
  it('settles closed months on fact and the rest on plan', () => {
    // Aug as-of. Jan–Jul actual 1000, Aug nothing yet, Aug–Dec plan 100 each.
    expect(projectSide([row({ closedMonths: 1000 })], 7, 1)).toBe(1000 + 100 + 400);
  });

  it('takes the actual for the month in progress once it passes the plan', () => {
    // A category already at 250 against a 100 plan will not close back under it.
    expect(projectSide([row({ closedMonths: 0, currentMonth: 250 })], 0, 1)).toBe(250 + 1100);
  });

  it('takes the plan for a month in progress that has barely started', () => {
    // Day 10 of a 100/month category that has spent 12 still projects to close at 100.
    expect(projectSide([row({ currentMonth: 12 })], 0, 1)).toBe(100 + 1100);
  });

  it('flips the ledger sign for income so both sides are positive magnitudes', () => {
    // Income is stored negative; -3000 received reads as 3000.
    expect(projectSide([row({ closedMonths: -3000 })], 7, -1)).toBe(3000 + 100 + 400);
  });

  it('is zero for no rows', () => {
    expect(projectSide([], 5, 1)).toBe(0);
  });

  it('rejects a month index that is not a real month', () => {
    expect(() => projectSide([], 12, 1)).toThrow(RangeError);
    expect(() => projectSide([], -1, 1)).toThrow(RangeError);
    expect(() => projectSide([], 1.5, 1)).toThrow(RangeError);
  });
});

describe('projectYearEnd', () => {
  it('reports a loss when the expense side projects higher', () => {
    const income  = [row({ annualBudget: 12000, closedMonths: -7000 })];
    const expense = [row({ annualBudget: 24000, closedMonths: 14000 })];
    const p = projectYearEnd(income, expense, 6); // July as-of
    expect(p.income).toBe(7000 + 1000 + 5000);
    expect(p.expense).toBe(14000 + 2000 + 10000);
    expect(p.profitLoss).toBe(p.income - p.expense);
    expect(p.profitLoss).toBeLessThan(0);
  });

  it('nets to zero when both sides are empty', () => {
    expect(projectYearEnd([], [], 0)).toEqual({ income: 0, expense: 0, profitLoss: 0 });
  });
});
