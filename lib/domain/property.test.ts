import { describe, it, expect } from 'vitest';
import { computePropertyEquity, latestValuationByProperty, valueAsOf, type Property } from './property';

describe('valueAsOf', () => {
  const series = [
    { value: 300000, valuedAt: '2024-01-01T00:00:00Z' },
    { value: 290000, valuedAt: '2025-01-01T00:00:00Z' },
    { value: 280000, valuedAt: '2026-01-01T00:00:00Z' },
  ];

  it('returns the observation current on that date, not the newest overall', () => {
    // The whole point: charting equity for a 2025 valuation must use the 2025 mortgage
    // balance, or today's paid-down balance would retroactively inflate past equity.
    expect(valueAsOf(series, '2025-06-01T00:00:00Z')).toBe(290000);
  });

  it('is inclusive of an exact date match', () => {
    expect(valueAsOf(series, '2025-01-01T00:00:00Z')).toBe(290000);
  });

  it('returns null before the series starts, rather than guessing backwards', () => {
    expect(valueAsOf(series, '2023-06-01T00:00:00Z')).toBeNull();
  });

  it('holds the last value forward for dates after the final reading', () => {
    expect(valueAsOf(series, '2030-01-01T00:00:00Z')).toBe(280000);
  });

  it('is order-independent — the caller need not pre-sort', () => {
    const shuffled = [series[2], series[0], series[1]];
    expect(valueAsOf(shuffled, '2025-06-01T00:00:00Z')).toBe(290000);
  });

  it('returns null for an empty series', () => {
    expect(valueAsOf([], '2026-01-01T00:00:00Z')).toBeNull();
  });

  it('treats a zero balance as a real reading, not a missing one', () => {
    // A paid-off mortgage is 0, and equity should then equal the full property value.
    expect(valueAsOf([{ value: 0, valuedAt: '2026-01-01T00:00:00Z' }], '2026-06-01T00:00:00Z')).toBe(0);
  });
});

describe('latestValuationByProperty', () => {
  it('picks the most recent row per property out of an unsorted, multi-row history', () => {
    const rows = [
      { propertyId: 1, value: 400000, valuedAt: '2026-01-01T00:00:00Z' },
      { propertyId: 1, value: 450000, valuedAt: '2026-07-01T00:00:00Z' },
      { propertyId: 2, value: 300000, valuedAt: '2026-03-01T00:00:00Z' },
    ];
    const latest = latestValuationByProperty(rows);
    expect(latest.get(1)).toBe(450000);
    expect(latest.get(2)).toBe(300000);
  });

  it('returns empty for no rows', () => {
    expect(latestValuationByProperty([])).toEqual(new Map());
  });
});

describe('computePropertyEquity', () => {
  const properties: Property[] = [
    { id: 1, nickname: 'Myrtle Beach' },
    { id: 2, nickname: 'Gastonia' },
    { id: 3, nickname: 'Primary Residence' },
  ];

  it('computes equity as valuation minus linked mortgage balance', () => {
    const valuations = new Map([[1, 450000]]);
    const mortgages = new Map([[1, 310000]]);
    const [mb] = computePropertyEquity([properties[0]], valuations, mortgages);
    expect(mb).toEqual({ propertyId: 1, nickname: 'Myrtle Beach', value: 450000, mortgageBalance: 310000, equity: 140000 });
  });

  it('treats a missing mortgage as a zero balance, not an error', () => {
    const valuations = new Map([[3, 1200000]]);
    const [primary] = computePropertyEquity([properties[2]], valuations, new Map());
    expect(primary).toEqual({ propertyId: 3, nickname: 'Primary Residence', value: 1200000, mortgageBalance: 0, equity: 1200000 });
  });

  it('reports equity as null (not a wrong number) when the property has never been valued', () => {
    const [gastonia] = computePropertyEquity([properties[1]], new Map(), new Map([[2, 200000]]));
    expect(gastonia.value).toBeNull();
    expect(gastonia.equity).toBeNull();
    expect(gastonia.mortgageBalance).toBe(200000); // still known, even though equity can't be computed
  });

  it('computes across a realistic three-property portfolio', () => {
    const valuations = new Map([[1, 450000], [2, 250000], [3, 1800000]]);
    const mortgages = new Map([[1, 310000], [2, 180000]]); // primary residence paid off, no entry
    const result = computePropertyEquity(properties, valuations, mortgages);
    expect(result.map((r) => r.equity)).toEqual([140000, 70000, 1800000]);
  });
});
