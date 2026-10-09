import { describe, expect, it } from 'vitest';
import { VALUATION_STALE_DAYS, staleValuations, valuationFindingText } from './valuationStaleness';

const acct = (id: string, latestValuedOn: string | null) => ({ id, name: `Fabricated ${id}`, latestValuedOn });

describe('staleValuations', () => {
  it('names an account at the threshold and not one a day inside it', () => {
    expect(VALUATION_STALE_DAYS).toBe(100);
    const today = '2026-10-08';
    expect(staleValuations([acct('a', '2026-06-30')], today)).toEqual([
      { id: 'a', name: 'Fabricated a', reason: 'stale', daysSince: 100 },
    ]);
    expect(staleValuations([acct('b', '2026-07-01')], today)).toEqual([]);
  });

  it('puts a never-valued account first, then the oldest', () => {
    const r = staleValuations([acct('old', '2026-01-01'), acct('never', null), acct('older', '2025-10-01')], '2026-10-08');
    expect(r.map((f) => f.id)).toEqual(['never', 'older', 'old']);
  });

  it('counts calendar days, unmoved by a daylight-saving change in between', () => {
    expect(staleValuations([acct('a', '2026-03-01')], '2026-06-09')).toEqual([
      { id: 'a', name: 'Fabricated a', reason: 'stale', daysSince: 100 },
    ]);
  });
});

describe('valuationFindingText', () => {
  it('says what to do', () => {
    expect(valuationFindingText({ id: 'a', name: 'Brokerage', reason: 'stale', daysSince: 120 }))
      .toBe('Brokerage was last valued 120 days ago — upload its latest statement.');
    expect(valuationFindingText({ id: 'a', name: 'Brokerage', reason: 'never' })).toMatch(/never been valued/);
  });
});
