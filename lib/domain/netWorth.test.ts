import { describe, it, expect } from 'vitest';
import { comparableYtdDelta, computeNetWorthBreakdown, groupRealEstateEquity, type NetWorthAccount, type SnapshotPoint } from './netWorth';
import { roundCents } from '../budgetMath';
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

// Fabricated snapshots throughout. The shape is NITS N2's: `net_worth_snapshots.total` changed
// meaning partway through the recorded history when P0-09a began subtracting tenant security
// deposits, and `liabilities_security_deposits` is the column that marks which side of the change
// a row was written on. NULL means "written under the previous definition, and therefore not
// comparable with today's total".
const PRE = (date: string, total: number): SnapshotPoint => ({ date, total, liabilitiesSecurityDeposits: null });
const POST = (date: string, total: number): SnapshotPoint => ({ date, total, liabilitiesSecurityDeposits: -18400.0 });

/** Two pre-cutover rows, then two comparable ones. The baseline is the third. */
const HISTORY: SnapshotPoint[] = [
  PRE('2026-01-02', 2900000.0),
  PRE('2026-02-01', 2915000.0),
  POST('2026-03-01', 2880000.33),
  POST('2026-04-01', 2905000.0),
];

const CURRENT = 2930000.11;

describe('comparableYtdDelta', () => {
  it('the year-to-date delta is measured from the earliest snapshot that carries the deposit decomposition, never from an older row written under the previous definition', () => {
    const r = comparableYtdDelta(CURRENT, HISTORY)!;

    expect(r.delta).toBe(49999.78);
    expect(r.sinceDate).toBe('2026-03-01');

    // THIS is N2. The incumbent took the earliest snapshot of the year regardless of era, and the
    // two answers differ by $19,999.67 on this history — the deposits held, understating growth,
    // with no symptom at all on the rendered page.
    expect(r.delta).not.toBe(30000.11);
    expect(r.sinceDate).not.toBe('2026-01-02');

    // The latest comparable row would report a month's movement under a year's label.
    expect(r.delta).not.toBe(25000.11);
    expect(r.sinceDate).not.toBe('2026-04-01');
  });

  it('a history with no post-cutover snapshot yields no delta at all rather than a delta of zero', () => {
    // A `0` asserts "net worth did not move". Null says "there is no comparable earlier reading",
    // and the page renders its "First recorded reading" copy instead of a $0 delta.
    const none = comparableYtdDelta(CURRENT, [PRE('2026-01-02', 2900000.0), PRE('2026-02-01', 2915000.0)]);
    expect(none).toBe(null);
    expect(none).not.toBe(0);
    expect(Object.is(none, undefined)).toBe(false);

    const empty = comparableYtdDelta(CURRENT, []);
    expect(empty).toBe(null);
    expect(empty).not.toBe(0);
  });

  it('the delta is current minus baseline, so a net worth that grew reports a positive figure', () => {
    const r = comparableYtdDelta(CURRENT, HISTORY)!;
    expect(r.delta).toBeGreaterThan(0);
    // `baseline − current` produces an equally plausible dollar figure whose only symptom is that
    // growth reads as loss. This family has already shipped in this repo.
    expect(r.delta).not.toBe(-49999.78);
  });

  it('the number of pre-cutover snapshots skipped is reported, so the window the comparison used can be disclosed rather than assumed', () => {
    const r = comparableYtdDelta(CURRENT, HISTORY)!;
    expect(r.excludedPreCutoverCount).toBe(2);
    expect(r.comparableSnapshotCount).toBe(2);
    // At least one by construction — a null result is the only way to have none.
    expect(r.comparableSnapshotCount).toBeGreaterThanOrEqual(1);
  });

  it('snapshots supplied out of order resolve to the same baseline as the sorted history', () => {
    // Baseline selection is by ISO date, not by array position, so a query that grew an ORDER BY
    // — or lost one — cannot change the answer.
    const shuffled = [HISTORY[3], HISTORY[0], HISTORY[2], HISTORY[1]];
    expect(comparableYtdDelta(CURRENT, shuffled)).toEqual(comparableYtdDelta(CURRENT, HISTORY));
    expect(comparableYtdDelta(CURRENT, shuffled)!.sinceDate).toBe('2026-03-01');
  });

  it('the delta is rounded to cents once and never carries a minus sign on a figure that did not move', () => {
    // Rounded once, at the subtraction, because both operands are already cent-quantized: the raw
    // IEEE-754 difference of the N-A pair is 49999.779999999795.
    expect(comparableYtdDelta(CURRENT, HISTORY)!.delta).not.toBe(49999.779999999795);

    const unmoved = comparableYtdDelta(2880000.33, HISTORY)!;
    expect(unmoved.delta).toBe(0);
    expect(Object.is(unmoved.delta, -0)).toBe(false);
    expect(unmoved.sinceDate).toBe('2026-03-01');

    // The residue the normalisation depends on, pinned here so it cannot silently stop gating.
    expect(Object.is(roundCents(-0.001), -0)).toBe(true);

    // …and the input that actually REACHES it through this function, which the equal-totals case
    // above does not: two totals a fraction of a cent apart round to zero from BELOW, and
    // `Math.round` of a small negative is `-0`. Without the normalisation this renders as "−$0"
    // — a minus sign on the one figure whose sign is the whole point.
    const dust = comparableYtdDelta(2880000.3299, HISTORY)!;
    expect(dust.delta).toBe(0);
    expect(Object.is(dust.delta, -0)).toBe(false);
  });
});
