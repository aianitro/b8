import { describe, it, expect } from 'vitest';
import { computeNetWorthBreakdown, groupRealEstateEquity, type NetWorthAccount } from './netWorth';
import { latestTenantFundByProperty, type TenantFundRow } from './property';

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
      new Map(), new Map(), [], new Map()
    );
    expect(r.operational).toBe(6800);
    expect(r.capitalFinancial).toBe(50000);
    expect(r.total).toBe(56800);
  });

  it('puts valuation-mode assets in capitalFinancial', () => {
    const r = computeNetWorthBreakdown(
      [acct('401k', 'capital', 'valuation')],
      new Map(), new Map([['401k', 400000]]), new Map(), [], new Map()
    );
    expect(r.capitalFinancial).toBe(400000);
  });

  it('counts a property-linked mortgage ONLY inside equity, never twice', () => {
    // The core trap: a mortgage is both a valuation liability and the subtrahend in its
    // property's equity. If it were counted in both, total would be 450k - 310k - 310k.
    const r = computeNetWorthBreakdown(
      [acct('mtg', 'capital', 'valuation', true, 1)],
      new Map(), new Map([['mtg', 310000]]), new Map([[1, 450000]]), [1], new Map()
    );
    expect(r.realEstateEquity).toBe(140000);
    expect(r.liabilities).toBe(0);
    expect(r.total).toBe(140000);
  });

  it('counts an UNLINKED valuation liability in liabilities', () => {
    const r = computeNetWorthBreakdown(
      [acct('loan', 'capital', 'valuation', true, null)],
      new Map(), new Map([['loan', 25000]]), new Map(), [], new Map()
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
      new Map(), new Map([['mtg', 200000]]), new Map(), [7], new Map()
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
      [1, 2], new Map()
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
      [1], new Map()
    );
    expect(r.operational + r.capitalFinancial + r.realEstateEquity + r.liabilities).toBe(r.total);
    expect(r.total).toBe(6800 + 400000 + 140000 - 25000);
  });

  it('is zero across the board with no accounts and no properties', () => {
    const r = computeNetWorthBreakdown([], new Map(), new Map(), new Map(), [], new Map());
    expect(r).toMatchObject({ operational: 0, capitalFinancial: 0, realEstateEquity: 0, liabilities: 0, total: 0 });
  });

  it('treats a missing balance as 0 rather than throwing', () => {
    const r = computeNetWorthBreakdown([acct('ghost', 'operational', 'ledger')], new Map(), new Map(), new Map(), [], new Map());
    expect(r.total).toBe(0);
  });
});

describe('contributions', () => {
  it('emits one signed line per account, matching its component total', () => {
    const r = computeNetWorthBreakdown(
      [acct('chk', 'operational', 'ledger'), acct('401k', 'capital', 'valuation')],
      new Map([['chk', 8000]]), new Map([['401k', 400000]]), new Map(), [], new Map()
    );
    expect(r.contributions).toEqual([
      { kind: 'account', id: 'chk', component: 'operational', value: 8000, propertyId: null },
      { kind: 'account', id: '401k', component: 'capitalFinancial', value: 400000, propertyId: null },
    ]);
  });

  it('records a linked mortgage as a NEGATIVE real-estate line, not a liability line', () => {
    // Mirrors the no-double-count rule: the mortgage belongs to equity, and appears once.
    const r = computeNetWorthBreakdown(
      [acct('mtg', 'capital', 'valuation', true, 1)],
      new Map(), new Map([['mtg', 310000]]), new Map([[1, 450000]]), [1], new Map()
    );
    expect(r.contributions).toContainEqual({ kind: 'account', id: 'mtg', component: 'realEstateEquity', value: -310000, propertyId: 1 });
    expect(r.contributions).toContainEqual({ kind: 'property', id: '1', component: 'realEstateEquity', value: 450000, propertyId: 1 });
    expect(r.contributions.filter((c) => c.component === 'liabilities')).toEqual([]);
  });

  it('omits an excluded property and its mortgage from contributions entirely', () => {
    const r = computeNetWorthBreakdown(
      [acct('mtg', 'capital', 'valuation', true, 7)],
      new Map(), new Map([['mtg', 200000]]), new Map(), [7], new Map()
    );
    expect(r.contributions).toEqual([]);
  });

  it('contributions sum to the total, per component and overall', () => {
    const r = computeNetWorthBreakdown(
      [
        acct('chk', 'operational', 'ledger'),
        acct('401k', 'capital', 'valuation'),
        acct('mtg', 'capital', 'valuation', true, 1),
        acct('loan', 'capital', 'valuation', true, null),
      ],
      new Map([['chk', 8000]]),
      new Map([['401k', 400000], ['mtg', 310000], ['loan', 25000]]),
      new Map([[1, 450000]]), [1], new Map()
    );
    const sumOf = (c: string) => r.contributions.filter((x) => x.component === c).reduce((s, x) => s + x.value, 0);
    expect(sumOf('operational')).toBe(r.operational);
    expect(sumOf('capitalFinancial')).toBe(r.capitalFinancial);
    expect(sumOf('realEstateEquity')).toBe(r.realEstateEquity);
    expect(sumOf('liabilities')).toBe(r.liabilities);
    expect(r.contributions.reduce((s, x) => s + x.value, 0)).toBe(r.total);
  });
});

describe('groupRealEstateEquity', () => {
  it('merges a property line and its mortgage line into one net-equity line', () => {
    const r = computeNetWorthBreakdown(
      [acct('mtg', 'capital', 'valuation', true, 1)],
      new Map(), new Map([['mtg', 310000]]), new Map([[1, 450000]]), [1], new Map()
    );
    expect(groupRealEstateEquity(r.contributions)).toEqual([{ propertyId: 1, value: 140000 }]);
  });

  it('leaves a mortgage-free property as its own single line, value unchanged', () => {
    const r = computeNetWorthBreakdown([], new Map(), new Map(), new Map([[3, 1800000]]), [3], new Map());
    expect(groupRealEstateEquity(r.contributions)).toEqual([{ propertyId: 3, value: 1800000 }]);
  });

  it('groups a realistic multi-property portfolio independently, one mortgaged and one not', () => {
    const r = computeNetWorthBreakdown(
      [acct('mtgA', 'capital', 'valuation', true, 1), acct('mtgB', 'capital', 'valuation', true, 2)],
      new Map(),
      new Map([['mtgA', 310000], ['mtgB', 180000]]),
      new Map([[1, 450000], [2, 250000], [3, 1800000]]),
      [1, 2, 3], new Map()
    );
    const lines = groupRealEstateEquity(r.contributions).sort((a, b) => a.propertyId - b.propertyId);
    expect(lines).toEqual([
      { propertyId: 1, value: 140000 },
      { propertyId: 2, value: 70000 },
      { propertyId: 3, value: 1800000 },
    ]);
  });

  it('ignores contributions from other components entirely', () => {
    const r = computeNetWorthBreakdown(
      [acct('chk', 'operational', 'ledger'), acct('loan', 'capital', 'valuation', true, null)],
      new Map([['chk', 8000]]), new Map([['loan', 25000]]), new Map(), [], new Map()
    );
    expect(groupRealEstateEquity(r.contributions)).toEqual([]);
  });

  it('sums to the same realEstateEquity total the breakdown itself reports', () => {
    const r = computeNetWorthBreakdown(
      [acct('mtgA', 'capital', 'valuation', true, 1), acct('mtgB', 'capital', 'valuation', true, 2)],
      new Map(),
      new Map([['mtgA', 310000], ['mtgB', 180000]]),
      new Map([[1, 450000], [2, 250000]]),
      [1, 2], new Map()
    );
    const total = groupRealEstateEquity(r.contributions).reduce((s, l) => s + l.value, 0);
    expect(total).toBe(r.realEstateEquity);
  });

  it('returns empty for no real-estate activity at all', () => {
    const r = computeNetWorthBreakdown([acct('chk', 'operational', 'ledger')], new Map([['chk', 100]]), new Map(), new Map(), [], new Map());
    expect(groupRealEstateEquity(r.contributions)).toEqual([]);
  });
});

// Tenant-held funds (P0-09a). Every figure below is fabricated: the owner's real deposit amounts
// are entered through the UI and never appear in code.
//
// The portfolio is held fixed across the first two cases so that "what the deposit changed" and
// "what the last-month holding changed" are each measured as a difference against the SAME
// baseline, rather than against a second hand-computed total that could itself be wrong.
describe('tenant-held funds', () => {
  const accounts = [
    acct('chk', 'operational', 'ledger'),
    acct('401k', 'capital', 'valuation'),
    acct('mtg', 'capital', 'valuation', true, 1),
  ];
  const ledger = new Map([['chk', 8000]]);
  const acctValues = new Map([['401k', 400000], ['mtg', 310000]]);
  const propValues = new Map([[1, 450000]]);

  const breakdown = (deposits: Map<number, number>) =>
    computeNetWorthBreakdown(accounts, ledger, acctValues, propValues, [1], deposits);

  it('reduces liabilities and total by a recorded security deposit, leaving the other three components unchanged', () => {
    // The deposit's cash already sits in the trust checking account at full value, so the only
    // thing that may move is the obligation to hand it back — and it may move only in one place.
    const without = breakdown(new Map());
    const with2500 = breakdown(new Map([[1, 2500]]));

    expect(with2500.liabilities).toBe(without.liabilities - 2500);
    expect(with2500.total).toBe(without.total - 2500);
    expect(with2500.operational).toBe(without.operational);
    expect(with2500.capitalFinancial).toBe(without.capitalFinancial);
    expect(with2500.realEstateEquity).toBe(without.realEstateEquity);
  });

  it('does not change any component or the total for a recorded last-month-rent-held amount', () => {
    // Recorded in the same table as the deposit, and the kind filter is the only thing keeping it
    // out of net worth — so the test goes through that filter rather than around it. Asserting
    // the last_month_rent reduction DOES see the row first proves the fixture is not vacuously
    // empty: without that check this passes just as well against a mistyped row shape.
    const rows: TenantFundRow[] = [
      { propertyId: 1, kind: 'last_month_rent', value: 3000, valuedAt: '2026-04-01T00:00:00Z' },
    ];
    expect(latestTenantFundByProperty(rows, 'last_month_rent').get(1)).toBe(3000);

    const deposits = latestTenantFundByProperty(rows, 'security_deposit');
    expect(deposits.size).toBe(0);

    const without = breakdown(new Map());
    const withLastMonth = breakdown(deposits);
    expect(withLastMonth).toEqual(without);
  });

  it('still sums components to total exactly with a security deposit and a last-month holding both present', () => {
    const rows: TenantFundRow[] = [
      { propertyId: 1, kind: 'security_deposit', value: 2500, valuedAt: '2026-04-01T00:00:00Z' },
      { propertyId: 1, kind: 'last_month_rent', value: 1800, valuedAt: '2026-04-01T00:00:00Z' },
    ];
    const r = breakdown(latestTenantFundByProperty(rows, 'security_deposit'));

    expect(r.operational + r.capitalFinancial + r.realEstateEquity + r.liabilities).toBe(r.total);
    expect(r.total).toBe(8000 + 400000 + 140000 - 2500);
    expect(r.liabilitiesSecurityDeposits).toBe(-2500);
  });

  it('only the property carrying a security deposit contributes to liabilities, not a property with none', () => {
    // A deposit is a fact about one property, not a portfolio-wide rate: property 2 is valued and
    // mortgage-free and holds no deposit on record, and must contribute nothing to liabilities.
    const r = computeNetWorthBreakdown(
      [], new Map(), new Map(), new Map([[1, 450000], [2, 250000]]), [1, 2], new Map([[1, 1800]])
    );

    expect(r.liabilities).toBe(-1800);
    const liabilityLines = r.contributions.filter((c) => c.component === 'liabilities' && c.kind === 'property');
    expect(liabilityLines).toEqual([
      { kind: 'property', id: '1', component: 'liabilities', value: -1800, propertyId: null },
    ]);
  });

  it('sums liabilities contributions to the liabilities total when a security deposit is present', () => {
    // /net-worth builds the component's visible lines from contributions[] and prints the
    // component total beside them. If a deposit moved the total without emitting a line, that
    // card would silently fail to add up by exactly the deposit.
    // Property 2's deposit was waived down to an explicitly recorded $0. It is a real reading, so
    // it still emits its own line — and that line must be 0, not -0: Object.is separates the two
    // and Intl.NumberFormat renders -0 as "-$0", which on this card would read as a deposit of
    // minus nothing.
    const r = computeNetWorthBreakdown(
      [acct('loan', 'capital', 'valuation', true, null)],
      new Map(), new Map([['loan', 25000]]), new Map([[1, 450000], [2, 250000]]), [1, 2],
      new Map([[1, 2500], [2, 0]])
    );

    const sumOfLiabilityLines = r.contributions
      .filter((c) => c.component === 'liabilities')
      .reduce((s, c) => s + c.value, 0);
    expect(sumOfLiabilityLines).toBe(r.liabilities);
    expect(r.liabilities).toBe(-27500);
    expect(r.contributions).toContainEqual(
      { kind: 'property', id: '2', component: 'liabilities', value: 0, propertyId: null }
    );
  });

  it('still subtracts a security deposit from liabilities when its property has no recorded valuation, unlike its linked mortgage which is dropped together with the unvalued property', () => {
    // The asymmetry, asserted in one place: property 9 has never been valued, so it and its
    // mortgage are dropped from realEstateEquity together (a naked debt would read as wildly
    // negative equity). The deposit is netted against nothing, so it survives untouched — it is
    // owed in full whether or not the house has been revalued. Both facts hold simultaneously.
    const r = computeNetWorthBreakdown(
      [acct('mtg9', 'capital', 'valuation', true, 9)],
      new Map(), new Map([['mtg9', 180000]]), new Map(), [9], new Map([[9, 2200]])
    );

    expect(r.liabilities).toBe(-2200);
    expect(r.total).toBe(-2200);
    expect(r.realEstateEquity).toBe(0);
    expect(r.unvaluedPropertyIds).toContain(9);
    expect(r.contributions).toContainEqual(
      { kind: 'property', id: '9', component: 'liabilities', value: -2200, propertyId: null }
    );
    expect(r.contributions.filter((c) => c.component === 'realEstateEquity')).toEqual([]);
  });
});
