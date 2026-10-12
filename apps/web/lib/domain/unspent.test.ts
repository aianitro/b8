import { describe, expect, it } from 'vitest';
import { checkMove, closedMonths, leftover, UNSPENT_START } from './unspent';

describe('closedMonths', () => {
  it('starts at the owner\'s start month, and closes last month only after its grace days', () => {
    expect(UNSPENT_START).toEqual({ year: 2026, month: 9 });
    expect(closedMonths({ year: 2026, month: 9, day: 20 })).toEqual([]);
    expect(closedMonths({ year: 2026, month: 10, day: 3 })).toEqual([]);
    expect(closedMonths({ year: 2026, month: 10, day: 4 })).toEqual([{ year: 2026, month: 9 }]);
    expect(closedMonths({ year: 2027, month: 2, day: 10 })).toEqual([
      { year: 2026, month: 9 }, { year: 2026, month: 10 }, { year: 2026, month: 11 },
      { year: 2026, month: 12 }, { year: 2027, month: 1 },
    ]);
    expect(closedMonths({ year: 2027, month: 2, day: 1 }).at(-1)).toEqual({ year: 2026, month: 12 });
  });
});

describe('leftover', () => {
  it('is the unspent part to the cent, and nothing for a month spent in full or over', () => {
    expect(leftover(100, 60.5)).toBe(39.5);
    expect(leftover(100, 100)).toBe(0);
    expect(leftover(100, 130)).toBe(0);
    expect(leftover(0.3, 0.1)).toBe(0.2);
  });
});

describe('checkMove', () => {
  const today = { year: 2026, month: 10 };
  it('allows the whole balance, into this month or later, or a release', () => {
    expect(checkMove({ amount: 40.1, balance: 40.1, action: 'carry', to: { year: 2026, month: 10 }, today })).toEqual({ ok: true });
    expect(checkMove({ amount: 5, balance: 40, action: 'carry', to: { year: 2027, month: 1 }, today })).toEqual({ ok: true });
    expect(checkMove({ amount: 5, balance: 40, action: 'release', today })).toEqual({ ok: true });
  });
  it('refuses nothing, too much, a closed month, or a carry with nowhere to go', () => {
    expect(checkMove({ amount: 0, balance: 40, action: 'release', today }).ok).toBe(false);
    expect(checkMove({ amount: 40.11, balance: 40.1, action: 'release', today }).ok).toBe(false);
    expect(checkMove({ amount: 5, balance: 40, action: 'carry', to: { year: 2026, month: 9 }, today }).ok).toBe(false);
    expect(checkMove({ amount: 5, balance: 40, action: 'carry', today }).ok).toBe(false);
  });
});
