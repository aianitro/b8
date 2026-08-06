import { describe, it, expect } from 'vitest';
import { findRecurringCharges, type RawTxn } from './recurringHeuristic';

// A fixed "now" so nothing here depends on when the suite runs.
const TODAY = new Date('2026-06-15T12:00:00Z');

/** Builds a monthly charge series ending `lastDate`, walking backwards by `gapDays`. */
function series(merchant: string, lastDate: string, count: number, amount: number, gapDays = 30): RawTxn[] {
  const out: RawTxn[] = [];
  const last = new Date(lastDate).getTime();
  for (let i = count - 1; i >= 0; i--) {
    out.push({
      merchant,
      date: new Date(last - i * gapDays * 86400000).toISOString().slice(0, 10),
      amount,
    });
  }
  return out;
}

describe('findRecurringCharges', () => {
  it('detects a clean monthly subscription and predicts the next charge', () => {
    const result = findRecurringCharges(series('Netflix', '2026-06-10', 4, 15.99), TODAY);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      merchant: 'Netflix',
      predictedAmount: 15.99,
      occurrenceCount: 4,
      lastDate: '2026-06-10',
      predictedDate: '2026-07-10', // 30 days after the last charge
    });
  });

  it('requires at least 3 occurrences', () => {
    expect(findRecurringCharges(series('Spotify', '2026-06-10', 2, 11.99), TODAY)).toEqual([]);
    expect(findRecurringCharges(series('Spotify', '2026-06-10', 3, 11.99), TODAY)).toHaveLength(1);
  });

  describe('cadence window', () => {
    it('rejects gaps that are too short to be monthly (weekly groceries)', () => {
      expect(findRecurringCharges(series('Trader Joes', '2026-06-10', 6, 82.5, 7), TODAY)).toEqual([]);
    });

    it('rejects gaps that are too long to be monthly (quarterly billing)', () => {
      expect(findRecurringCharges(series('Insurance Co', '2026-06-10', 4, 300, 90), TODAY)).toEqual([]);
    });

    it('accepts the documented gap boundaries', () => {
      expect(findRecurringCharges(series('At Min', '2026-06-10', 3, 10, 24), TODAY)).toHaveLength(1);
      expect(findRecurringCharges(series('At Max', '2026-06-10', 3, 10, 36), TODAY)).toHaveLength(1);
    });

    it('rejects just outside the documented gap boundaries', () => {
      expect(findRecurringCharges(series('Too Short', '2026-06-10', 3, 10, 23), TODAY)).toEqual([]);
      expect(findRecurringCharges(series('Too Long', '2026-06-10', 3, 10, 37), TODAY)).toEqual([]);
    });

    it('rejects a series where only one gap is irregular', () => {
      // One skipped month is enough to disqualify — the heuristic requires every consecutive
      // gap to be consistent, not just the average.
      const txns: RawTxn[] = [
        { merchant: 'Gym', date: '2026-03-01', amount: 40 },
        { merchant: 'Gym', date: '2026-03-31', amount: 40 },
        { merchant: 'Gym', date: '2026-06-10', amount: 40 }, // 71-day gap
      ];
      expect(findRecurringCharges(txns, TODAY)).toEqual([]);
    });
  });

  describe('amount variance', () => {
    it('tolerates small drift, like a price increase within 20%', () => {
      const txns: RawTxn[] = [
        { merchant: 'Utility', date: '2026-04-11', amount: 100 },
        { merchant: 'Utility', date: '2026-05-11', amount: 110 },
        { merchant: 'Utility', date: '2026-06-10', amount: 118 },
      ];
      const result = findRecurringCharges(txns, TODAY);

      expect(result).toHaveLength(1);
      expect(result[0].predictedAmount).toBe(118); // predicts the most recent amount, not an average
    });

    it('rejects amounts that swing beyond the variance threshold', () => {
      const txns: RawTxn[] = [
        { merchant: 'Restaurant', date: '2026-04-11', amount: 40 },
        { merchant: 'Restaurant', date: '2026-05-11', amount: 120 },
        { merchant: 'Restaurant', date: '2026-06-10', amount: 65 },
      ];
      expect(findRecurringCharges(txns, TODAY)).toEqual([]);
    });

    it('measures variance against the larger amount, so a 20% cut is a rejection', () => {
      // 100 -> 79 is a 21% drop measured against 100, the documented denominator.
      const txns: RawTxn[] = [
        { merchant: 'Service', date: '2026-04-11', amount: 100 },
        { merchant: 'Service', date: '2026-05-11', amount: 79 },
        { merchant: 'Service', date: '2026-06-10', amount: 79 },
      ];
      expect(findRecurringCharges(txns, TODAY)).toEqual([]);
    });
  });

  describe('grace window', () => {
    it('keeps a charge predicted slightly in the past — billing runs late', () => {
      // Last charge 2026-05-14, +30 days = 2026-06-13, two days before TODAY.
      const result = findRecurringCharges(series('Late Biller', '2026-05-14', 3, 20), TODAY);

      expect(result).toHaveLength(1);
      expect(result[0].predictedDate).toBe('2026-06-13');
    });

    it('drops a charge predicted well before the grace window', () => {
      // Last charge 2026-04-20, +30 days = 2026-05-20, far outside the 5-day grace.
      expect(findRecurringCharges(series('Cancelled', '2026-04-20', 3, 20), TODAY)).toEqual([]);
    });
  });

  describe('output shaping', () => {
    it('sorts by predicted date, soonest first', () => {
      const result = findRecurringCharges(
        [
          ...series('Later', '2026-06-12', 3, 10),
          ...series('Sooner', '2026-06-01', 3, 20),
        ],
        TODAY
      );

      expect(result.map((c) => c.merchant)).toEqual(['Sooner', 'Later']);
    });

    it('honors the limit, keeping the soonest charges', () => {
      const result = findRecurringCharges(
        [
          ...series('Third', '2026-06-13', 3, 10),
          ...series('First', '2026-06-11', 3, 10),
          ...series('Second', '2026-06-12', 3, 10),
        ],
        TODAY,
        2
      );

      expect(result.map((c) => c.merchant)).toEqual(['First', 'Second']);
    });

    it('groups by merchant, so interleaved input still resolves', () => {
      const mixed = [...series('A', '2026-06-10', 3, 10), ...series('B', '2026-06-11', 3, 25)].sort((x, y) =>
        x.date.localeCompare(y.date)
      );
      const result = findRecurringCharges(mixed, TODAY);

      expect(result.map((c) => c.merchant).sort()).toEqual(['A', 'B']);
    });

    it('returns nothing for an empty input', () => {
      expect(findRecurringCharges([], TODAY)).toEqual([]);
    });
  });
});
