import { describe, expect, it } from 'vitest';
import { contribution, decompose, holdStreak, type CategoryState } from './yearEndMoves';
import { projectYearEnd, type YearEndRow } from './yearEnd';

const flat = (n: number) => Array<number>(12).fill(n);
const with_ = (arr: number[], i: number, v: number) => arr.map((x, j) => (j === i ? v : x));
// Fabricated: spend plans 100 a month, income plans 300 a month.
const groceries = (actuals: number[], plan = flat(100)): CategoryState => ({ name: 'Groceries', isIncome: false, plan, actuals });
const salary = (actuals: number[]): CategoryState => ({ name: 'Salary', isIncome: true, plan: flat(300), actuals });

describe('contribution', () => {
  it('agrees with the year-end projection it decomposes', () => {
    const exp = with_(with_(flat(0), 0, 90), 1, 140);
    const inc = with_(flat(0), 0, -300);
    const row = (plan: number[], act: number[]): YearEndRow => ({
      annualBudget: 0, monthlyAmounts: plan,
      closedMonths: act.slice(0, 1).reduce((s, v) => s + v, 0), currentMonth: act[1],
    });
    const p = projectYearEnd([row(flat(300), inc)], [row(flat(100), exp)], 1);
    expect(contribution(flat(300), inc, true, 1) + contribution(flat(100), exp, false, 1)).toBeCloseTo(p.profitLoss);
  });
});

describe('decompose', () => {
  const sep = 8, oct = 9;

  it('names spending in the month in progress, and only once it passes the plan', () => {
    const a = { month: oct, categories: [groceries(with_(flat(0), oct, 80))] };
    const b = { month: oct, categories: [groceries(with_(flat(0), oct, 130))] };
    expect(decompose(a, b)).toMatchObject({ total: -30, spending: -30, budget: 0, past: 0, closed: 0 });
  });

  it('calls a month closing under plan "closed", not spending', () => {
    const a = { month: sep, categories: [groceries(with_(flat(0), sep, 60))] };
    const b = { month: oct, categories: [groceries(with_(flat(0), sep, 60))] };
    // September moves from its plan (100) to its fact (60): the year gains 40 without a purchase.
    expect(decompose(a, b)).toMatchObject({ total: 40, closed: 40, spending: 0 });
  });

  it('separates a budget edit and a late arrival in a closed month, and the parts sum to the total', () => {
    const a = { month: oct, categories: [groceries(with_(flat(0), sep, 100)), salary(flat(0))] };
    const b = { month: oct, categories: [
      groceries(with_(flat(0), sep, 125), with_(flat(100), 11, 150)),  // Sep refiled up, Dec plan raised
      salary(with_(flat(0), oct, -320)),                               // pay above plan this month
    ] };
    const m = decompose(a, b);
    expect(m).toMatchObject({ budget: -50, past: -25, spending: 20, closed: 0, total: -55 });
    expect(m.budget + m.past + m.spending + m.closed).toBeCloseTo(m.total);
    expect(m.categories.map((c) => c.name)).toEqual(['Groceries', 'Salary']);
  });

  it('treats a category that appears as a budget edit', () => {
    const m = decompose({ month: oct, categories: [] }, { month: oct, categories: [groceries(flat(0))] });
    expect(m).toMatchObject({ budget: -300, spending: 0, total: -300 }); // Oct, Nov, Dec at plan
  });
});

describe('holdStreak', () => {
  const oct = 9;
  const at = (date: string, spent: number, plan = flat(100)) => ({ date, moment: { month: oct, categories: [groceries(with_(flat(0), oct, spent), plan)] } });

  it('counts the days since the last spending slip', () => {
    // Over plan from the 3rd (110 → 130 is a slip), then flat.
    const s = holdStreak([at('2026-10-02', 110), at('2026-10-03', 130), at('2026-10-04', 130), at('2026-10-06', 130)], '2026-10-06');
    expect(s).toEqual({ days: 3, since: '2026-10-03', sinceTracking: false, slippedToday: false });
  });

  it('ignores a budget edit and a month closing, and runs from the first snapshot when nothing slipped', () => {
    const edited = { ...at('2026-10-05', 50, with_(flat(100), 11, 300)) };                 // Dec plan raised
    const closed = { date: '2026-11-01', moment: { month: 10, categories: [groceries(with_(flat(0), oct, 50))] } };
    const s = holdStreak([at('2026-10-04', 50), edited, closed], '2026-11-01');
    expect(s).toEqual({ days: 28, since: '2026-10-04', sinceTracking: true, slippedToday: false });
  });

  it('says so when today has already slipped', () => {
    expect(holdStreak([at('2026-10-05', 120), at('2026-10-06', 140)], '2026-10-06'))
      .toEqual({ days: 0, since: '2026-10-06', sinceTracking: false, slippedToday: true });
  });

  it('needs two points', () => {
    expect(holdStreak([at('2026-10-06', 0)], '2026-10-06')).toBeNull();
  });
});
