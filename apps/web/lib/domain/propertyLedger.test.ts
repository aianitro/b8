import { describe, it, expect } from 'vitest';
import { buildPropertyLedger, type LedgerInput } from './propertyLedger';

const tx = (
  id: number, date: string, amount: number, description = 'x',
  extra: Partial<LedgerInput> = {}
): LedgerInput => ({
  id, date, description, category: null, amount,
  accountName: 'Trust Gastonia', taggedDirectly: false, ...extra,
});

describe('buildPropertyLedger', () => {
  it('carries the opening balance through with no activity', () => {
    const l = buildPropertyLedger(2822.93, []);
    expect(l.beginningBalance).toBe(2822.93);
    expect(l.endingBalance).toBe(2822.93);
    expect(l.rows).toEqual([]);
  });

  it('reduces the balance on an outflow and raises it on an inflow', () => {
    // The app's sign convention is the trap here: positive means money OUT. A ledger that
    // added positives would show a mortgage payment increasing the account.
    const l = buildPropertyLedger(2822.93, [
      tx(1, '2026-01-02', 1754.23, 'Mortgage'),
      tx(2, '2026-01-05', -1900, 'Rent'),
    ]);
    expect(l.rows[0].balance).toBe(1068.7);
    expect(l.rows[1].balance).toBe(2968.7);
    expect(l.endingBalance).toBe(2968.7);
  });

  it('sorts by date before computing, not trusting caller order', () => {
    // Unsorted input yields a column of individually plausible, collectively meaningless
    // numbers — worse than an obvious error, because nothing looks wrong.
    const l = buildPropertyLedger(1000, [
      tx(2, '2026-03-01', -500),
      tx(1, '2026-01-01', 200),
    ]);
    expect(l.rows.map((r) => r.date)).toEqual(['2026-01-01', '2026-03-01']);
    expect(l.rows.map((r) => r.balance)).toEqual([800, 1300]);
  });

  it('breaks same-day ties by id so the order is stable between renders', () => {
    const l = buildPropertyLedger(0, [tx(9, '2026-06-01', -10), tx(4, '2026-06-01', -20)]);
    expect(l.rows.map((r) => r.id)).toEqual([4, 9]);
  });

  it('keeps the running balance addable row by row', () => {
    // Rounding at each step, not once at the end: the audience for this column is someone
    // checking two adjacent rows against their bank statement.
    const l = buildPropertyLedger(100.005, [tx(1, '2026-01-01', 0.001), tx(2, '2026-01-02', 0.001)]);
    for (let i = 1; i < l.rows.length; i++) {
      const step = Math.round((l.rows[i - 1].balance - l.rows[i].balance) * 100) / 100;
      expect(l.rows[i].balance).toBe(Math.round((l.rows[i - 1].balance - step) * 100) / 100);
    }
  });

  it('totals inflows and outflows separately', () => {
    const l = buildPropertyLedger(0, [
      tx(1, '2026-01-01', -1900), tx(2, '2026-01-02', 1754.23), tx(3, '2026-01-03', 70),
    ]);
    expect(l.totalIn).toBe(1900);
    expect(l.totalOut).toBe(1824.23);
    expect(l.endingBalance).toBe(75.77);
  });

  it('preserves the tagged-directly flag so a manual attribution stays visible', () => {
    const l = buildPropertyLedger(0, [
      tx(1, '2026-02-10', 1754.23, 'Mortgage', {
        accountName: 'Trust Savings Prim', taggedDirectly: true,
      }),
    ]);
    expect(l.rows[0].taggedDirectly).toBe(true);
    expect(l.rows[0].accountName).toBe('Trust Savings Prim');
  });

  it('reproduces the spreadsheet ledger it replaces', () => {
    // The Gastonia sheet's first five 2026 rows, opening at its stated Beginning balance.
    // If this drifts, the app and the spreadsheet disagree about the same month.
    const l = buildPropertyLedger(2822.93, [
      tx(1, '2026-01-02', 1754.23, 'Mortgage'),
      tx(2, '2026-01-05', -1900, 'Rent'),
      tx(3, '2026-01-13', 70, 'HOA'),
      tx(4, '2026-02-02', -1900, 'Rent'),
      tx(5, '2026-02-10', 1754.23, 'Mortgage'),
    ]);
    expect(l.rows.map((r) => r.balance)).toEqual([1068.7, 2968.7, 2898.7, 4798.7, 3044.47]);
  });
});
