import { describe, it, expect } from 'vitest';
import { dateRange, ledgerSeries, monthsBefore, valuationSeries } from './balanceSeries';

// Fabricated figures throughout, as everywhere in this repo's tests.

describe('dateRange', () => {
  it('runs oldest first and includes both ends', () => {
    expect(dateRange('2026-03-02', 3)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  });

  it('does not repeat or skip a date across a DST change', () => {
    const dates = dateRange('2026-03-10', 4); // US clocks spring forward on 2026-03-08
    expect(dates).toEqual(['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
  });

  it('crosses New Year', () => {
    expect(dateRange('2026-01-01', 1)).toEqual(['2025-12-31', '2026-01-01']);
  });
});

describe('monthsBefore', () => {
  it('keeps the day of the month when that day exists', () => {
    expect(monthsBefore('2026-11-02', 3)).toBe('2026-08-02');
    expect(monthsBefore('2026-11-02', 6)).toBe('2026-05-02');
  });

  it('clamps rather than overflowing into the following month', () => {
    // Plain Date arithmetic would make this Feb 31 and roll it to Mar 3, cutting three days off
    // the window the chart then draws.
    expect(monthsBefore('2026-05-31', 3)).toBe('2026-02-28');
    expect(monthsBefore('2026-08-31', 6)).toBe('2026-02-28');
    expect(monthsBefore('2026-03-31', 1)).toBe('2026-02-28');
  });

  it('finds Feb 29 in a leap year', () => {
    expect(monthsBefore('2028-05-31', 3)).toBe('2028-02-29');
  });

  it('crosses New Year', () => {
    expect(monthsBefore('2026-02-15', 3)).toBe('2025-11-15');
    expect(monthsBefore('2026-01-31', 6)).toBe('2025-07-31');
  });
});

describe('ledgerSeries', () => {
  it('ends on the anchor and undoes later flows for earlier days', () => {
    const series = ledgerSeries(100, '2026-05-03', 2, [
      { date: '2026-05-02', amount: 30 },  // money out on the 2nd
      { date: '2026-05-03', amount: -50 }, // money in on the 3rd
    ]);
    expect(series).toEqual([
      { date: '2026-05-01', balance: 80 },
      { date: '2026-05-02', balance: 50 },
      { date: '2026-05-03', balance: 100 },
    ]);
  });

  it('sums several flows on one day', () => {
    const series = ledgerSeries(10, '2026-05-02', 1, [
      { date: '2026-05-02', amount: 5 },
      { date: '2026-05-02', amount: 5 },
    ]);
    expect(series[0].balance).toBe(20);
  });

  it('ignores flows dated after the anchor', () => {
    const series = ledgerSeries(10, '2026-05-02', 1, [{ date: '2026-05-03', amount: 99 }]);
    expect(series.map((p) => p.balance)).toEqual([10, 10]);
  });

  it('rounds away float drift', () => {
    const series = ledgerSeries(0.3, '2026-05-02', 1, [{ date: '2026-05-02', amount: 0.1 }, { date: '2026-05-02', amount: 0.2 }]);
    expect(series[0].balance).toBe(0.6);
  });
});

describe('valuationSeries', () => {
  it('carries the latest observation forward and omits days before the first', () => {
    const series = valuationSeries('2026-05-04', 3, [
      { date: '2026-05-03', value: 70 },
      { date: '2026-05-02', value: 60 },
    ]);
    expect(series).toEqual([
      { date: '2026-05-02', balance: 60 },
      { date: '2026-05-03', balance: 70 },
      { date: '2026-05-04', balance: 70 },
    ]);
  });

  it('uses an observation older than the window as the opening value', () => {
    const series = valuationSeries('2026-05-02', 1, [{ date: '2025-01-01', value: 40 }]);
    expect(series.map((p) => p.balance)).toEqual([40, 40]);
  });

  it('is empty with no observations', () => {
    expect(valuationSeries('2026-05-02', 1, [])).toEqual([]);
  });
});
