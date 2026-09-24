import { describe, expect, it } from 'vitest';
import { dateRangeHref, drillHref, weekStartYmd, ymd } from './drilldown';

describe('ymd', () => {
  it('formats a 0-based month as a 1-based ISO date', () => {
    expect(ymd(2026, 8, 23)).toBe('2026-09-23');
    expect(ymd(2026, 0, 1)).toBe('2026-01-01');
    expect(ymd(2026, 11, 31)).toBe('2026-12-31');
  });

  it('pads single digits', () => {
    expect(ymd(2026, 2, 5)).toBe('2026-03-05');
  });

  // The reason this is UTC arithmetic. On a machine in a DST zone, building `new Date(y, m, d)`
  // and reading it back through an ISO string lands on the previous day for half the year.
  it('is stable on the days either side of a DST transition', () => {
    expect(ymd(2026, 2, 8)).toBe('2026-03-08');   // US spring forward
    expect(ymd(2026, 10, 1)).toBe('2026-11-01');  // US fall back
  });
});

describe('weekStartYmd', () => {
  const asOf = (year: number, month: number, day: number) => ({ year, month, day });

  it('walks back to Monday from any day of the week', () => {
    // 2026-09-23 is a Wednesday: ISO day 3, so Monday is the 21st.
    expect(weekStartYmd(asOf(2026, 8, 23), 3)).toBe('2026-09-21');
    expect(weekStartYmd(asOf(2026, 8, 21), 1)).toBe('2026-09-21');
    expect(weekStartYmd(asOf(2026, 8, 27), 7)).toBe('2026-09-21');
  });

  it('returns the day itself on a Monday', () => {
    expect(weekStartYmd(asOf(2026, 8, 21), 1)).toBe('2026-09-21');
  });

  // The case that makes this a function rather than a subtraction at the call site.
  it('crosses a month boundary', () => {
    // 2026-10-01 is a Thursday, ISO day 4 — its Monday is in September.
    expect(weekStartYmd(asOf(2026, 9, 1), 4)).toBe('2026-09-28');
  });

  it('crosses a year boundary', () => {
    // 2027-01-01 is a Friday, ISO day 5 — its Monday is in 2026.
    expect(weekStartYmd(asOf(2027, 0, 1), 5)).toBe('2026-12-28');
  });

  it('crosses a leap day', () => {
    // 2028-03-01 is a Wednesday, ISO day 3 — its Monday is 2028-02-28, and the 29th exists.
    expect(weekStartYmd(asOf(2028, 2, 1), 3)).toBe('2028-02-28');
  });
});

describe('dateRangeHref', () => {
  it('sends both bounds and marks the origin', () => {
    expect(dateRangeHref('2026-09-21', '2026-09-23'))
      .toBe('/transactions?dateFrom=2026-09-21&dateTo=2026-09-23&from=dashboard');
  });

  it('takes the same date twice for a single day', () => {
    expect(dateRangeHref('2026-09-23', '2026-09-23'))
      .toBe('/transactions?dateFrom=2026-09-23&dateTo=2026-09-23&from=dashboard');
  });
});

// The conversion this module exists to own — every month index in the app is 0-based and the
// transactions page reads 1-based.
describe('drillHref', () => {
  it('shifts the month to 1-based and escapes the category', () => {
    expect(drillHref(['Toys/Gifts/Flowers'], 8))
      .toBe('/transactions?category=Toys%2FGifts%2FFlowers&month=9&from=dashboard');
  });
});
