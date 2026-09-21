import { describe, it, expect } from 'vitest';
import { computePropertyPnl, toPnlTransaction, type PnlTransaction } from './propertyPnl';

const rent = (amount: number, category = 'Rent Myrtle Beach'): PnlTransaction =>
  ({ category, amount: -amount, isDebtService: false }); // inflow is negative by app convention
const expense = (amount: number, category: string): PnlTransaction =>
  ({ category, amount, isDebtService: false });

// The two real shapes a mortgage payment arrives in. Both fixtures go through
// toPnlTransaction() rather than hand-setting the normalized values, so the tests pin the
// actual boundary behavior instead of a convenient restatement of it.

// Plaid-linked mortgage: the payment sits on the loan account and is stored NEGATIVE, because
// from the loan's perspective it reduces what is owed.
const mortgage = (amountPaid: number): PnlTransaction =>
  toPnlTransaction({
    category: 'Mortgage', amount: -amountPaid,
    onLiabilityAccount: true, inDebtServiceCategory: false,
  });

// Manual mortgage: the payment sits on the rental's checking account and is stored POSITIVE,
// because money left the building. Only the category identifies it.
const manualMortgage = (amountPaid: number): PnlTransaction =>
  toPnlTransaction({
    category: 'Mortgage Gastonia', amount: amountPaid,
    onLiabilityAccount: false, inDebtServiceCategory: true,
  });

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

  it('reads a positively-signed checking-account payment as cash going OUT too', () => {
    // The Gastonia bug: a manual mortgage's payments live on the rental's CHECKING account,
    // stored with the opposite sign to a loan account's. Run through the loan-account rule they
    // produced NEGATIVE debt service — a mortgage read as rental income. Both shapes must land
    // on the same answer.
    const r = computePropertyPnl([manualMortgage(1754.23)], null, null);
    expect(r.debtService).toBe(1754.23);
    expect(r.cashFlow).toBe(-1754.23);
  });

  it('agrees on debt service regardless of which account observed the payment', () => {
    const viaLoanAccount = computePropertyPnl([mortgage(1754.23)], null, null);
    const viaChecking = computePropertyPnl([manualMortgage(1754.23)], null, null);
    expect(viaChecking.debtService).toBe(viaLoanAccount.debtService);
    expect(viaChecking.cashFlow).toBe(viaLoanAccount.cashFlow);
  });

  it('keeps a manual mortgage payment out of operating expenses', () => {
    // What made Gastonia's NOI wrong: the payment fell through to the expense bucket, so NOI
    // absorbed ~$8.8K/yr of financing cost. Cash flow was right the whole time, which is
    // precisely why it went unnoticed — so both are asserted.
    const r = computePropertyPnl([rent(2000, 'Rent Gastonia'), manualMortgage(1754.23)], null, null);
    expect(r.totalOperatingExpenses).toBe(0);
    expect(r.netOperatingIncome).toBe(2000);
    expect(r.debtService).toBe(1754.23);
    expect(r.cashFlow).toBe(245.77);
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
