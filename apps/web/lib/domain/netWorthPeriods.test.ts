import { describe, expect, it } from 'vitest';
import { dayLabel, daysBefore, withinHorizon } from './netWorthPeriods';

// Fabricated snapshots; only the dates matter here.
const snap = (iso: string) => ({ iso });

describe('daysBefore', () => {
  it('counts calendar days back across month, year and leap-day boundaries', () => {
    expect(daysBefore('2026-10-08', 7)).toBe('2026-10-01');
    expect(daysBefore('2026-03-01', 1)).toBe('2026-02-28');
    expect(daysBefore('2028-03-01', 1)).toBe('2028-02-29');
    expect(daysBefore('2027-01-05', 30)).toBe('2026-12-06');
    expect(daysBefore('2026-10-08', 365)).toBe('2025-10-08');
  });
});

describe('withinHorizon', () => {
  const daily = ['2025-10-07', '2025-10-08', '2026-09-07', '2026-09-08', '2026-09-30',
    '2026-10-01', '2026-10-02', '2026-10-08'].map(snap);

  it('keeps the last 7 days, counted from the latest snapshot and including the first day', () => {
    expect(withinHorizon(daily, 'week').map((s) => s.iso)).toEqual(['2026-10-01', '2026-10-02', '2026-10-08']);
  });

  it('keeps the last 30 and the last 365 days', () => {
    expect(withinHorizon(daily, 'month').map((s) => s.iso)).toEqual(
      ['2026-09-08', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-08']);
    expect(withinHorizon(daily, 'year')[0].iso).toBe('2025-10-08');
  });

  it('counts from the latest snapshot, not from today, and sorts input that arrives out of order', () => {
    const stale = [snap('2026-06-30'), snap('2026-06-20'), snap('2026-06-26')];
    expect(withinHorizon(stale, 'week').map((s) => s.iso)).toEqual(['2026-06-26', '2026-06-30']);
  });

  it('is empty for no snapshots', () => {
    expect(withinHorizon([], 'month')).toEqual([]);
  });
});

describe('dayLabel', () => {
  it('reads the calendar date as written', () => {
    expect(dayLabel('2026-10-08')).toBe('Oct 8');
    expect(dayLabel('2026-03-01')).toBe('Mar 1');
  });
});
