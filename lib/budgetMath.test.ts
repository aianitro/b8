import { describe, it, expect } from 'vitest';
import { normalizeMonthlyAmounts, resolveAnnualBudget, roundCents } from './budgetMath';

const twelve = (fill: number) => Array<number>(12).fill(fill);

describe('normalizeMonthlyAmounts', () => {
  it('accepts a valid 12-month schedule unchanged', () => {
    const input = [100, 200, 300, 0, 0, 0, 0, 0, 0, 0, 0, 400];
    expect(normalizeMonthlyAmounts(input)).toEqual(input);
  });

  it('accepts the twice-a-year shape the schema exists for', () => {
    const semiannual = [0, 0, 0, 0, 0, 1200, 0, 0, 0, 0, 0, 1200];
    expect(normalizeMonthlyAmounts(semiannual)).toEqual(semiannual);
  });

  describe('rejects anything that is not a usable schedule', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a number', 500],
      ['a string', '12'],
      ['an object', { jan: 100 }],
      ['an empty array', []],
      ['11 months', Array<number>(11).fill(100)],
      ['13 months', Array<number>(13).fill(100)],
    ])('returns null for %s', (_label, input) => {
      expect(normalizeMonthlyAmounts(input)).toBeNull();
    });

    it('returns null for an all-zero schedule — that means "no custom schedule"', () => {
      expect(normalizeMonthlyAmounts(twelve(0))).toBeNull();
    });

    it('returns null when every entry coerces to zero', () => {
      // Garbage values are floored to 0 individually; if nothing survives, there is no schedule.
      expect(normalizeMonthlyAmounts(twelve(0).map(() => 'abc'))).toBeNull();
    });
  });

  describe('coerces individual entries', () => {
    it('floors negative amounts to zero rather than rejecting the schedule', () => {
      const input = [-50, 100, ...twelve(0).slice(2)];
      expect(normalizeMonthlyAmounts(input)?.[0]).toBe(0);
    });

    it('floors non-finite and non-numeric entries to zero', () => {
      const input = [NaN, Infinity, 'abc', null, 100, ...twelve(0).slice(5)];
      const result = normalizeMonthlyAmounts(input);
      expect(result?.slice(0, 5)).toEqual([0, 0, 0, 0, 100]);
    });

    it('accepts numeric strings, since JSON bodies often carry them', () => {
      const input = ['100.5', ...twelve(0).slice(1)];
      expect(normalizeMonthlyAmounts(input)?.[0]).toBe(100.5);
    });

    it('rounds to cents', () => {
      const input = [10.005, 33.333, ...twelve(0).slice(2)];
      const result = normalizeMonthlyAmounts(input);
      expect(result?.[0]).toBe(10.01);
      expect(result?.[1]).toBe(33.33);
    });
  });
});

describe('resolveAnnualBudget', () => {
  it('passes through the caller annual budget when there is no schedule', () => {
    expect(resolveAnnualBudget(null, 5000)).toBe(5000);
  });

  it('lets the schedule total win over a conflicting annual budget', () => {
    // The core invariant: the two can never be saved out of sync.
    expect(resolveAnnualBudget(twelve(100), 99999)).toBe(1200);
  });

  it('sums an uneven schedule', () => {
    expect(resolveAnnualBudget([0, 0, 0, 0, 0, 1200, 0, 0, 0, 0, 0, 800], 0)).toBe(2000);
  });

  it('rounds away float dust from summing cents', () => {
    // 12 * 0.1 is 1.2000000000000002 in float arithmetic.
    expect(resolveAnnualBudget(twelve(0.1), 0)).toBe(1.2);
  });

  it('round-trips a normalized schedule into a clean annual total', () => {
    const amounts = normalizeMonthlyAmounts(twelve(33.33));
    expect(resolveAnnualBudget(amounts, 0)).toBe(399.96);
  });
});

describe('roundCents', () => {
  it.each([
    [10.005, 10.01],
    [10.004, 10],
    [1.2000000000000002, 1.2],
    [0, 0],
  ])('rounds %d to %d', (input, expected) => {
    expect(roundCents(input)).toBe(expected);
  });

  it('rounds half-cent boundaries by float representation, not by decimal intuition', () => {
    // Pinning the real behavior rather than an ideal: whether a half-cent rounds up depends
    // on which side of .5 the float product lands. 2.355 * 100 is exactly 235.5 (rounds up),
    // but 1.005 * 100 is 100.49999999999999 (rounds down). Immaterial for budget entry at
    // whole-cent precision, but worth documenting before anyone reuses roundCents elsewhere.
    expect(roundCents(2.355)).toBe(2.36);
    expect(roundCents(1.005)).toBe(1);
  });

  it('does not encounter negative inputs in practice', () => {
    // normalizeMonthlyAmounts floors negatives to 0 before any total is computed, so the
    // sign behavior of Math.round at .5 boundaries never reaches a stored budget.
    expect(normalizeMonthlyAmounts([-2.345, ...Array<number>(11).fill(0)])).toBeNull();
  });
});
