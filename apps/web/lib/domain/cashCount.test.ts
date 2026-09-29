import { describe, expect, it } from 'vitest';
import { daysSinceCount, reconcileCashCount } from './cashCount';

describe('reconciling a cash count', () => {
  it('writes a SPEND when the wallet holds less than the ledger thought', () => {
    // The ordinary case: 350 went in, 173 is left, nobody recorded the coffee.
    const out = reconcileCashCount(350, 173);
    expect(out.difference).toBe(-177);
    expect(out.adjustment).toEqual({ amount: 177, direction: 'spent', magnitude: 177 });
  });

  it('writes an INFLOW when the wallet holds more', () => {
    const out = reconcileCashCount(100, 160);
    expect(out.difference).toBe(60);
    expect(out.adjustment).toEqual({ amount: -60, direction: 'found', magnitude: 60 });
  });

  /**
   * The direction is the whole risk. A sign error here produces an adjustment of exactly the right
   * size in exactly the wrong direction — the wallet ends twice as far from the truth as before the
   * count, and every figure downstream stays internally consistent while being wrong. So this asserts
   * the ledger arithmetic end to end rather than trusting the sign.
   */
  it('lands the wallet on the counted figure once the adjustment is applied', () => {
    for (const [expected, counted] of [[350, 173], [100, 160], [0, 45], [80, 0], [-20, 10]]) {
      const { adjustment } = reconcileCashCount(expected, counted);
      // balance = money in − money out = −Σ(amount). Applying the adjustment to `expected` must
      // reproduce `counted` exactly.
      const applied = expected - (adjustment?.amount ?? 0);
      expect(applied).toBeCloseTo(counted, 2);
    }
  });

  it('records a count that AGREED, with no adjustment', () => {
    // The case the cash_counts table exists for: nothing to write, but the count still happened.
    const out = reconcileCashCount(173, 173);
    expect(out.adjustment).toBeNull();
    expect(out.difference).toBe(0);
  });

  it('treats sub-penny drift as agreement rather than writing noise', () => {
    // A ledger balance summed through JS carries float dust. Without rounding, this is not zero, so
    // every count would write a meaningless adjustment and no count would ever record as agreeing.
    const out = reconcileCashCount(0.1 + 0.2, 0.3);
    expect(out.difference).toBe(0);
    expect(out.adjustment).toBeNull();
  });

  it('handles an empty wallet and a wallet counted to zero', () => {
    expect(reconcileCashCount(0, 0).adjustment).toBeNull();
    expect(reconcileCashCount(80, 0).adjustment).toEqual({ amount: 80, direction: 'spent', magnitude: 80 });
  });

  it('accepts a negative expected, which is a real state', () => {
    // A wallet spent from before its opening balance was recorded computes below zero. Refusing it
    // would refuse the very count that repairs it.
    const out = reconcileCashCount(-20, 10);
    expect(out.adjustment).toEqual({ amount: -30, direction: 'found', magnitude: 30 });
  });

  it('rounds both sides to cents', () => {
    const out = reconcileCashCount(10.005, 10);
    expect(out.expected).toBe(10.01);
    expect(out.counted).toBe(10);
  });
});

describe('how stale a wallet balance is', () => {
  const now = new Date('2026-09-28T12:00:00Z');

  it('counts whole days since the last count', () => {
    expect(daysSinceCount('2026-09-28T11:00:00Z', now)).toBe(0);
    expect(daysSinceCount('2026-09-27T13:00:00Z', now)).toBe(0); // 23h — not yet a day
    expect(daysSinceCount('2026-09-26T11:00:00Z', now)).toBe(2);
    expect(daysSinceCount('2026-08-28T12:00:00Z', now)).toBe(31);
  });

  it('reports NEVER COUNTED as null, not as infinitely stale', () => {
    // A wallet created this morning and one abandoned in April are different situations; collapsing
    // them would make the first look like a problem and the second look ordinary.
    expect(daysSinceCount(null, now)).toBeNull();
  });

  it('does not go negative on a clock skew', () => {
    expect(daysSinceCount('2026-09-29T12:00:00Z', now)).toBe(0);
  });

  it('returns null for an unparseable timestamp rather than NaN', () => {
    expect(daysSinceCount('not a date', now)).toBeNull();
  });
});
