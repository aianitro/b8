import { describe, expect, it } from 'vitest';
import {
  CategoryTransactionsDataSchema,
  CategoryTransactionsResponseSchema,
} from './categoryTransactions';

const row = (over: Record<string, unknown> = {}) => ({
  id: 1, date: '2026-09-14', label: 'Safeway', amount: '28.06', account: 'Chase Checking',
  watched: false, note: null, ...over,
});

const data = (over: Record<string, unknown> = {}) => ({
  category: 'Grocery', month: 9, year: 2026, rows: [row()], spent: '28.06', count: 1, ...over,
});

describe('CategoryTransactionsDataSchema', () => {
  it('accepts a realistic payload', () => {
    expect(() => CategoryTransactionsDataSchema.parse(data())).not.toThrow();
  });

  // 1-12, matching the URL parameter rather than JavaScript's 0-based months. The overview
  // payload's `asOf.month` IS 0-based, so the two conventions meet at the call site and a wrong
  // one here would silently fetch the neighbouring month.
  it('takes a 1-based month and refuses 0 or 13', () => {
    expect(() => CategoryTransactionsDataSchema.parse(data({ month: 1 }))).not.toThrow();
    expect(() => CategoryTransactionsDataSchema.parse(data({ month: 12 }))).not.toThrow();
    expect(() => CategoryTransactionsDataSchema.parse(data({ month: 0 }))).toThrow();
    expect(() => CategoryTransactionsDataSchema.parse(data({ month: 13 }))).toThrow();
  });

  // Money crosses as a string with exactly two decimals. `pg` hands NUMERIC back as a string, and
  // a float that has been through JSON is where a cent goes missing.
  it('demands money formatted to exactly two decimals', () => {
    expect(() => CategoryTransactionsDataSchema.parse(data({ spent: '28.1' }))).toThrow();
    expect(() => CategoryTransactionsDataSchema.parse(data({ spent: 28.06 }))).toThrow();
    expect(() => CategoryTransactionsDataSchema.parse(data({ rows: [row({ amount: '5' })] }))).toThrow();
  });

  // Deliberately unclamped, unlike the tile's figure: a category refunded past zero really did
  // total less than nothing, and the rows on screen say so.
  it('allows a negative total and negative rows', () => {
    expect(() => CategoryTransactionsDataSchema.parse(
      data({ spent: '-40.00', rows: [row({ amount: '-40.00' })] })
    )).not.toThrow();
  });

  // The pair travels together because the database will not hold one without the other, and an
  // editor opening on a row must show the note that is already there rather than an empty box.
  it('carries the watch flag and the note', () => {
    expect(() => CategoryTransactionsDataSchema.parse(
      data({ rows: [row({ watched: true, note: 'returning this' })] })
    )).not.toThrow();
    expect(() => CategoryTransactionsDataSchema.parse(
      data({ rows: [row({ watched: false, note: null })] })
    )).not.toThrow();
    expect(() => CategoryTransactionsDataSchema.parse(
      data({ rows: [row({ watched: 'yes' })] })
    )).toThrow();
  });

  it('allows an empty month, where the count and the total are zero', () => {
    expect(() => CategoryTransactionsDataSchema.parse(
      data({ rows: [], spent: '0.00', count: 0 })
    )).not.toThrow();
    expect(() => CategoryTransactionsDataSchema.parse(data({ count: -1 }))).toThrow();
  });
});

describe('CategoryTransactionsResponseSchema', () => {
  it('discriminates the two branches and refuses a mixed envelope', () => {
    expect(() => CategoryTransactionsResponseSchema.parse({ success: true, data: data() })).not.toThrow();
    expect(() => CategoryTransactionsResponseSchema.parse({
      success: false, error: { code: 'INVALID_INPUT', message: 'month must be an integer from 1 to 12' },
    })).not.toThrow();
    // Both keys present is a handler bug, not something to strip down to a plausible shape.
    expect(() => CategoryTransactionsResponseSchema.parse({
      success: true, data: data(), error: { code: 'x', message: 'y' },
    })).toThrow();
  });
});
