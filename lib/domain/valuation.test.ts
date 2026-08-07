import { describe, it, expect } from 'vitest';
import { computeNetWorth, latestValuationByAccount, type AccountRegime } from './valuation';

describe('latestValuationByAccount', () => {
  it('returns empty for no rows', () => {
    expect(latestValuationByAccount([])).toEqual(new Map());
  });

  it('picks the most recent row per account out of an unsorted, multi-row history', () => {
    const rows = [
      { accountId: 'a', value: 100, valuedAt: '2026-01-01T00:00:00Z' },
      { accountId: 'a', value: 150, valuedAt: '2026-07-01T00:00:00Z' },
      { accountId: 'a', value: 120, valuedAt: '2026-04-01T00:00:00Z' },
      { accountId: 'b', value: 50, valuedAt: '2026-02-01T00:00:00Z' },
    ];
    const latest = latestValuationByAccount(rows);
    expect(latest.get('a')).toBe(150);
    expect(latest.get('b')).toBe(50);
  });

  it('accepts Date objects as well as ISO strings for valuedAt', () => {
    const rows = [
      { accountId: 'a', value: 1, valuedAt: new Date('2026-01-01') },
      { accountId: 'a', value: 2, valuedAt: new Date('2026-02-01') },
    ];
    expect(latestValuationByAccount(rows).get('a')).toBe(2);
  });
});

describe('computeNetWorth', () => {
  const ledgerAccount = (id: string, landscape: 'operational' | 'capital', isLiability = false): AccountRegime => ({
    id, landscape, valuationMode: 'ledger', isLiability,
  });
  const valuationAccount = (id: string, landscape: 'operational' | 'capital', isLiability = false): AccountRegime => ({
    id, landscape, valuationMode: 'valuation', isLiability,
  });

  it('matches plain summation for an all-ledger-mode set, same as the current flow-derived model', () => {
    const accounts = [ledgerAccount('checking', 'operational'), ledgerAccount('savings', 'operational')];
    const ledgerBalances = new Map([['checking', 2500], ['savings', 10000]]);
    const result = computeNetWorth(accounts, ledgerBalances, new Map());
    expect(result.total).toBe(12500);
    expect(result.operational).toBe(12500);
    expect(result.capital).toBe(0);
  });

  it('adds a valuation-mode asset at its full positive value', () => {
    const accounts = [valuationAccount('brokerage', 'capital')];
    const result = computeNetWorth(accounts, new Map(), new Map([['brokerage', 250000]]));
    expect(result.total).toBe(250000);
    expect(result.capital).toBe(250000);
  });

  it('subtracts a valuation-mode liability even though its stored value is positive', () => {
    const accounts = [valuationAccount('mortgage', 'capital', true)];
    const result = computeNetWorth(accounts, new Map(), new Map([['mortgage', 340000]]));
    expect(result.total).toBe(-340000);
    expect(result.capital).toBe(-340000);
  });

  it('does NOT re-sign a ledger-mode liability — its running balance already carries the correct sign', () => {
    // A credit card's flow-derived running balance is already negative (debt) by construction
    // (beginning_balance + Σ transactions); is_liability must not double-negate it.
    const accounts = [ledgerAccount('credit-card', 'operational', true)];
    const result = computeNetWorth(accounts, new Map([['credit-card', -1500]]), new Map());
    expect(result.total).toBe(-1500);
  });

  it('defaults to 0 for an account missing from the relevant balance/valuation map', () => {
    const accounts = [ledgerAccount('no-ledger-row', 'operational'), valuationAccount('no-valuation-row', 'capital')];
    const result = computeNetWorth(accounts, new Map(), new Map());
    expect(result.total).toBe(0);
    expect(result.byAccount).toEqual([
      { id: 'no-ledger-row', landscape: 'operational', value: 0 },
      { id: 'no-valuation-row', landscape: 'capital', value: 0 },
    ]);
  });

  it('computes a realistic mixed portfolio end to end', () => {
    const accounts = [
      ledgerAccount('checking', 'operational'),
      ledgerAccount('credit-card', 'operational', true),
      valuationAccount('401k', 'capital'),
      valuationAccount('primary-residence', 'capital'),
      valuationAccount('mortgage', 'capital', true),
    ];
    const ledgerBalances = new Map([['checking', 8000], ['credit-card', -1200]]);
    const latestValuations = new Map([['401k', 400000], ['primary-residence', 1200000], ['mortgage', 500000]]);

    const result = computeNetWorth(accounts, ledgerBalances, latestValuations);

    expect(result.operational).toBe(6800); // 8000 - 1200
    expect(result.capital).toBe(1100000); // 400000 + 1200000 - 500000
    expect(result.total).toBe(1106800);
  });
});
