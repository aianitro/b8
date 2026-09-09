import { describe, it, expect } from 'vitest';
import {
  detectRecurring,
  seriesKey,
  RECURRENCE_AMOUNT_TOLERANCE,
  RECURRENCE_MIN_MONTHS,
  type RecurrenceTxn,
} from './recurrence';
import type { AsOf } from './pacing';

// Fabricated figures throughout — this repo keeps real amounts out of committed diffs. The SHAPES
// are the ones that broke on real data, and each is named after what it is rather than after the
// merchant it came from.
//
// The as-of point is 8 September of a 30-day month, the day the $993.75 projection was reported.

const AS_OF: AsOf = { year: 2026, month: 8, day: 8 };

const txn = (over: Partial<RecurrenceTxn> = {}): RecurrenceTxn => ({
  category: 'Gym and gear',
  label: 'FABRICATED CLUB',
  month: 8,
  day: 3,
  amount: 100,
  ...over,
});

/** One charge a month, same day, same amount, over the given months. */
const series = (months: number[], amount: number, over: Partial<RecurrenceTxn> = {}): RecurrenceTxn[] =>
  months.map((month) => txn({ month, amount, ...over }));

const only = (txns: RecurrenceTxn[], category = 'Gym and gear') => detectRecurring(txns, AS_OF).get(category);

describe('seriesKey', () => {
  it('folds the case a bank changes between two charges of one merchant', () => {
    expect(seriesKey('LEVY@ SFBA STADIUM')).toBe(seriesKey('LEVY@ SFBA Stadium'));
  });

  it('strips runs of four or more digits, so a reference number in a descriptor cannot make every charge unique', () => {
    expect(seriesKey('ACH PMT 604578105643191 WEB ID: 9130142001')).toBe(seriesKey('ACH PMT 111111111111 WEB ID: 2222222222'));
  });

  it('keeps runs of three digits or fewer, because those are part of the name and merging them fuses two branches into one series', () => {
    expect(seriesKey('AMC 0433 SARATOGA 14')).not.toBe(seriesKey('AMC 0912 CAMPBELL 14'));
    expect(seriesKey('STORE #22 SARATOGA')).not.toBe(seriesKey('STORE #31 SARATOGA'));
  });

  it('normalises punctuation and repeated spacing the app did not put there', () => {
    expect(seriesKey('REI.COM  800-426')).toBe(seriesKey('REI COM 800 426'));
  });
});

describe('detectRecurring — what qualifies', () => {
  it('reports three consecutive months of one charge at one price, with this month already posted', () => {
    const found = only(series([6, 7, 8], 265));
    expect(found?.posted).toBe(265);
    expect(found?.expected).toBe(265);
    expect(found?.series).toHaveLength(1);
    expect(found?.series[0].monthsObserved).toBe(RECURRENCE_MIN_MONTHS);
    expect(found?.series[0].typicalDay).toBe(3);
  });

  it('carries the most recent amount forward when this month has not been billed yet, and reports nothing posted', () => {
    // The whole point of a forecast: on day 8 the gym bills on the 20th, and a projection that
    // omitted it would report a $0 month that lurches by $265 in twelve days' time.
    const found = only(series([5, 6, 7], 265, { day: 20 }));
    expect(found?.posted).toBe(0);
    expect(found?.expected).toBe(265);
    expect(found?.series[0].posted).toBeNull();
  });

  it('takes the latest price rather than an average, so a mid-year increase is not split down the middle', () => {
    const found = only([...series([6], 260), ...series([7], 265), ...series([8], 265)]);
    expect(found?.expected).toBe(265);
  });

  it('leaves a one-off from the same merchant in the elective remainder', () => {
    // The gym billed its month AND sold a day pass in the same month. The pass is far outside the
    // band, so the month still has exactly one instalment and only the instalment is held out.
    const found = only([...series([6, 7, 8], 265), txn({ month: 8, day: 18, amount: 49 })]);
    expect(found?.posted).toBe(265);
    expect(found?.expected).toBe(265);
  });

  it('sums several series in one category and orders them by what the month owes each', () => {
    const found = only([
      ...series([6, 7, 8], 41, { label: 'SMALL MONTHLY' }),
      ...series([6, 7, 8], 265, { label: 'LARGE MONTHLY' }),
    ]);
    expect(found?.expected).toBe(306);
    expect(found?.series.map((s) => s.expected)).toEqual([265, 41]);
  });
});

describe('detectRecurring — what does not', () => {
  it('rejects a series that stopped: last billed in June, and September does not owe it', () => {
    // Cancelled in July. Its five prior months are consecutive, one a month, at one price — every
    // test but the activity one passes, which is why that test exists.
    expect(only(series([1, 2, 3, 4, 5], 41))).toBeUndefined();
  });

  it('accepts a series billed last month but not yet this month, and rejects one that skipped last month', () => {
    expect(only(series([5, 6, 7], 41))).toBeDefined();
    expect(only(series([4, 5, 6], 41))).toBeUndefined();
  });

  it('rejects months that are not adjacent — a gap is the difference between a bill and a habit', () => {
    expect(only(series([1, 2, 8], 130))).toBeUndefined();
  });

  it(`rejects fewer than ${RECURRENCE_MIN_MONTHS} months of evidence`, () => {
    expect(only(series([7, 8], 265))).toBeUndefined();
  });

  it('rejects a merchant billed several times a month inside the band — the shape of a shop, not a subscription', () => {
    // Two charges a month, both near the median. Three consecutive active months, a tight cluster,
    // and no instalment: the month has no single charge that is "the" recurring one.
    const shop: RecurrenceTxn[] = [6, 7, 8].flatMap((month) => [
      txn({ month, day: 4, amount: 240 }),
      txn({ month, day: 19, amount: 250 }),
    ]);
    expect(only(shop)).toBeUndefined();
  });

  it('rejects a merchant whose monthly amount is a choice rather than a price', () => {
    const found = only([...series([6], 20), ...series([7], 95), ...series([8], 240)]);
    expect(found).toBeUndefined();
  });

  it('accepts movement inside the tolerance and rejects it just outside', () => {
    const base = 100;
    const inside = base * (1 + RECURRENCE_AMOUNT_TOLERANCE);
    expect(only([...series([6, 7], base), ...series([8], inside)])).toBeDefined();
    expect(only([...series([6, 7], base), ...series([8], inside + 1)])).toBeUndefined();
  });

  it('never groups a series across categories, however identical the merchant', () => {
    const split = [
      ...series([6, 7, 8], 265, { category: 'Gym and gear' }).slice(0, 1),
      ...series([7, 8], 265, { category: 'Other category' }),
    ];
    expect(detectRecurring(split, AS_OF).size).toBe(0);
  });

  it('leaves a category out of the map entirely when nothing qualifies, rather than reporting zeroes', () => {
    // `./pacing` reaching for a missing entry must take the same branch as `./pacing` that was
    // never given a map at all, and an entry of zeroes is a third state that would not.
    expect(detectRecurring(series([7, 8], 265), AS_OF).has('Gym and gear')).toBe(false);
  });
});

describe('detectRecurring — the window and the population', () => {
  it('reads across a year boundary, so a January outlook still knows the owner has subscriptions', () => {
    const january: AsOf = { year: 2026, month: 0, day: 8 };
    const found = detectRecurring(series([10, 11, 0], 265), january).get('Gym and gear');
    expect(found?.posted).toBe(265);
    expect(found?.expected).toBe(265);
  });

  it('ignores charges older than the lookback window', () => {
    // Six completed months back from September reaches March. A February charge is outside it, so
    // these three months are two in-window months and a gap, not a series.
    expect(only(series([1, 2, 3], 265))).toBeUndefined();
  });

  it('excludes refunds and reversals rather than netting them, matching how the month actual is summed', () => {
    const found = only([...series([6, 7, 8], 265), txn({ month: 8, day: 5, amount: -265 })]);
    expect(found?.posted).toBe(265);
  });

  it('never lets a zero-amount series become a proportion it cannot be the denominator of', () => {
    expect(only(series([6, 7, 8], 0))).toBeUndefined();
  });
});
