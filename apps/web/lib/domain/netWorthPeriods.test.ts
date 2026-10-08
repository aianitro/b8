import { describe, expect, it } from 'vitest';
import { lastPerPeriod, periodLabel, weekStart } from './netWorthPeriods';

// Fabricated snapshots; only the dates matter here.
const snap = (iso: string, total = 0) => ({ iso, total });

describe('weekStart', () => {
  it('returns the Monday of the ISO week, across month and year boundaries', () => {
    expect(weekStart('2026-10-08')).toBe('2026-10-05'); // Thursday
    expect(weekStart('2026-10-05')).toBe('2026-10-05'); // Monday is its own start
    expect(weekStart('2026-10-11')).toBe('2026-10-05'); // Sunday belongs to the week before it
    expect(weekStart('2026-03-01')).toBe('2026-02-23');
    expect(weekStart('2027-01-01')).toBe('2026-12-28');
  });
});

describe('lastPerPeriod', () => {
  const daily = [
    snap('2026-09-29', 1), snap('2026-09-30', 2), snap('2026-10-01', 3),
    snap('2026-10-04', 4), snap('2026-10-05', 5), snap('2026-10-08', 6),
  ];

  it('keeps the closing snapshot of each month — the 1st does not slip into the month before', () => {
    expect(lastPerPeriod(daily, 'month').map((s) => s.iso)).toEqual(['2026-09-30', '2026-10-08']);
  });

  it('keeps the closing snapshot of each week, Monday to Sunday', () => {
    expect(lastPerPeriod(daily, 'week').map((s) => s.iso)).toEqual(['2026-10-04', '2026-10-08']);
  });

  it('keeps one point per year, and sorts input that arrives out of order', () => {
    const shuffled = [snap('2027-02-01', 9), snap('2025-12-31', 7), snap('2026-06-30', 8), snap('2025-03-01', 6)];
    expect(lastPerPeriod(shuffled, 'year').map((s) => s.total)).toEqual([7, 8, 9]);
  });

  it('is empty for no snapshots', () => {
    expect(lastPerPeriod([], 'month')).toEqual([]);
  });
});

describe('periodLabel', () => {
  it('labels weeks by closing date, months by name, years by number', () => {
    expect(periodLabel('2026-10-08', 'week', false)).toBe('Oct 8');
    expect(periodLabel('2026-10-08', 'month', false)).toBe('Oct');
    expect(periodLabel('2026-10-08', 'month', true)).toBe("Oct '26");
    expect(periodLabel('2026-10-08', 'year', true)).toBe('2026');
  });
});
