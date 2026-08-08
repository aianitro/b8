import { describe, it, expect } from 'vitest';
import { computePropertyPnl, type PnlTransaction } from './propertyPnl';

const rent = (amount: number, category = 'Rent Myrtle Beach'): PnlTransaction =>
  ({ category, amount: -amount, isDebtService: false }); // inflow is negative by app convention
const expense = (amount: number, category: string): PnlTransaction =>
  ({ category, amount, isDebtService: false });
// A mortgage PAYMENT arrives from a loan account as a NEGATIVE amount — it reduces what is
// owed. The fixture mirrors that real convention rather than a convenient one.
const mortgage = (amountPaid: number): PnlTransaction =>
  ({ category: 'Mortgage', amount: -amountPaid, isDebtService: true });

describe('computePropertyPnl', () => {
  it('separates income from expenses using the transaction sign', () => {
    const r = computePropertyPnl([rent(2300), expense(180, 'HOA')], null, null);
    expect(r.grossIncome).toBe(2300);
    expect(r.totalOperatingExpenses).toBe(180);
    expect(r.netOperatingIncome).toBe(2120);
  });

  it('keeps debt service OUT of operating expenses, per the NOI definition', () => {
    // Mixing a mortgage payment into opex would make the property look unprofitable at the
    // operating level when it may not be.
    const r = computePropertyPnl([rent(2300), expense(180, 'HOA'), mortgage(2154.61)], null, null);
    expect(r.totalOperatingExpenses).toBe(180);
    expect(r.netOperatingIncome).toBe(2120);
    expect(r.debtService).toBe(2154.61);
    expect(r.cashFlow).toBe(-34.61);
  });

  it('reports the cash-flow-negative-but-appreciating case honestly', () => {
    // The exact Myrtle Beach shape the roadmap calls out: showing only cash flow would say
    // "losing money" about a property that gained on total return.
    const r = computePropertyPnl([rent(2300), mortgage(2400)], 400000, 450000);
    expect(r.cashFlow).toBe(-100);
    expect(r.appreciation).toBe(50000);
    expect(r.totalReturn).toBe(49900);
  });

  it('reads a negatively-signed loan payment as cash going OUT, not coming in', () => {
    // The bug this pins: taken raw, a year of mortgage payments summed to a negative debt
    // service, which flipped cash flow positive and made a loss-making rental look profitable.
    const r = computePropertyPnl([mortgage(2154.61)], null, null);
    expect(r.debtService).toBe(2154.61);
    expect(r.cashFlow).toBe(-2154.61);
  });

  it('flags principal paydown as not yet included', () => {
    // Total return excludes principal until step 6's amortization split exists, so it
    // understates. The omission has to be legible, not silent.
    const r = computePropertyPnl([rent(1000)], 100000, 100000);
    expect(r.principalPaydownKnown).toBe(false);
  });

  it('returns null appreciation and total return when a valuation is missing', () => {
    expect(computePropertyPnl([rent(1000)], null, 450000).appreciation).toBeNull();
    expect(computePropertyPnl([rent(1000)], 400000, null).totalReturn).toBeNull();
  });

  it('groups repeated categories into one line', () => {
    const r = computePropertyPnl([rent(2300), rent(2300), expense(90, 'Water'), expense(60, 'Water')], null, null);
    expect(r.income).toEqual([{ label: 'Rent Myrtle Beach', amount: 4600 }]);
    expect(r.operatingExpenses).toEqual([{ label: 'Water', amount: 150 }]);
  });

  it('orders lines largest first', () => {
    const r = computePropertyPnl(
      [expense(50, 'Water'), expense(500, 'Repairs'), expense(180, 'HOA')], null, null
    );
    expect(r.operatingExpenses.map((l) => l.label)).toEqual(['Repairs', 'HOA', 'Water']);
  });

  it('buckets uncategorized transactions rather than dropping them', () => {
    const r = computePropertyPnl([expense(75, null as unknown as string)], null, null);
    expect(r.operatingExpenses).toEqual([{ label: 'Uncategorized', amount: 75 }]);
  });

  it('handles a property with no activity at all', () => {
    const r = computePropertyPnl([], null, null);
    expect(r).toMatchObject({ grossIncome: 0, totalOperatingExpenses: 0, netOperatingIncome: 0, cashFlow: 0 });
  });

  it('treats a flat valuation as zero appreciation, not unknown', () => {
    const r = computePropertyPnl([], 450000, 450000);
    expect(r.appreciation).toBe(0);
    expect(r.totalReturn).toBe(0);
  });
});
