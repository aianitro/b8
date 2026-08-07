import { describe, it, expect } from 'vitest';
import { computeNetWorthBreakdown, type NetWorthAccount } from './netWorth';

const acct = (
  id: string,
  landscape: 'operational' | 'capital',
  valuationMode: 'ledger' | 'valuation',
  isLiability = false,
  propertyId: number | null = null
): NetWorthAccount => ({ id, landscape, valuationMode, isLiability, propertyId });

describe('computeNetWorthBreakdown', () => {
  it('sums ledger accounts into their landscape, sign intact', () => {
    const r = computeNetWorthBreakdown(
      [acct('chk', 'operational', 'ledger'), acct('cc', 'operational', 'ledger'), acct('sav', 'capital', 'ledger')],
      new Map([['chk', 8000], ['cc', -1200], ['sav', 50000]]),
      new Map(), new Map(), []
    );
    expect(r.operational).toBe(6800);
    expect(r.capitalFinancial).toBe(50000);
    expect(r.total).toBe(56800);
  });

  it('puts valuation-mode assets in capitalFinancial', () => {
    const r = computeNetWorthBreakdown(
      [acct('401k', 'capital', 'valuation')],
      new Map(), new Map([['401k', 400000]]), new Map(), []
    );
    expect(r.capitalFinancial).toBe(400000);
  });

  it('counts a property-linked mortgage ONLY inside equity, never twice', () => {
    // The core trap: a mortgage is both a valuation liability and the subtrahend in its
    // property's equity. If it were counted in both, total would be 450k - 310k - 310k.
    const r = computeNetWorthBreakdown(
      [acct('mtg', 'capital', 'valuation', true, 1)],
      new Map(), new Map([['mtg', 310000]]), new Map([[1, 450000]]), [1]
    );
    expect(r.realEstateEquity).toBe(140000);
    expect(r.liabilities).toBe(0);
    expect(r.total).toBe(140000);
  });

  it('counts an UNLINKED valuation liability in liabilities', () => {
    const r = computeNetWorthBreakdown(
      [acct('loan', 'capital', 'valuation', true, null)],
      new Map(), new Map([['loan', 25000]]), new Map(), []
    );
    expect(r.liabilities).toBe(-25000);
    expect(r.realEstateEquity).toBe(0);
    expect(r.total).toBe(-25000);
  });

  it('drops an unvalued property together with its mortgage, and reports it', () => {
    // Neither alternative is acceptable: a $0 house understates by the whole property, and
    // the debt alone makes equity wildly negative. Excluded, and surfaced instead.
    const r = computeNetWorthBreakdown(
      [acct('mtg', 'capital', 'valuation', true, 7)],
      new Map(), new Map([['mtg', 200000]]), new Map(), [7]
    );
    expect(r.realEstateEquity).toBe(0);
    expect(r.liabilities).toBe(0);
    expect(r.unvaluedPropertyIds).toEqual([7]);
    expect(r.total).toBe(0);
  });

  it('still values the other properties when one is unvalued', () => {
    const r = computeNetWorthBreakdown(
      [acct('mtgA', 'capital', 'valuation', true, 1), acct('mtgB', 'capital', 'valuation', true, 2)],
      new Map(),
      new Map([['mtgA', 100000], ['mtgB', 200000]]),
      new Map([[1, 500000]]),
      [1, 2]
    );
    expect(r.realEstateEquity).toBe(400000); // property 2 and its mortgage both dropped
    expect(r.unvaluedPropertyIds).toEqual([2]);
  });

  it('components always sum exactly to total', () => {
    const r = computeNetWorthBreakdown(
      [
        acct('chk', 'operational', 'ledger'),
        acct('cc', 'operational', 'ledger'),
        acct('401k', 'capital', 'valuation'),
        acct('mtg', 'capital', 'valuation', true, 1),
        acct('loan', 'capital', 'valuation', true, null),
      ],
      new Map([['chk', 8000], ['cc', -1200]]),
      new Map([['401k', 400000], ['mtg', 310000], ['loan', 25000]]),
      new Map([[1, 450000]]),
      [1]
    );
    expect(r.operational + r.capitalFinancial + r.realEstateEquity + r.liabilities).toBe(r.total);
    expect(r.total).toBe(6800 + 400000 + 140000 - 25000);
  });

  it('is zero across the board with no accounts and no properties', () => {
    const r = computeNetWorthBreakdown([], new Map(), new Map(), new Map(), []);
    expect(r).toMatchObject({ operational: 0, capitalFinancial: 0, realEstateEquity: 0, liabilities: 0, total: 0 });
  });

  it('treats a missing balance as 0 rather than throwing', () => {
    const r = computeNetWorthBreakdown([acct('ghost', 'operational', 'ledger')], new Map(), new Map(), new Map(), []);
    expect(r.total).toBe(0);
  });
});
