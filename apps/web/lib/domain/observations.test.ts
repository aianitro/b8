import { describe, it, expect } from 'vitest';
import { latestValueByKey } from './observations';

// The behavior latestValuationByAccount and latestValuationByProperty both delegate to. Their
// own suites still exercise it through the domain-named wrappers; this one pins the contract
// once, at the level where a mistake would reach every observation series at the same time.
describe('latestValueByKey', () => {
  const at = (iso: string) => iso;

  it('returns an empty map for no observations', () => {
    expect(latestValueByKey([], (r: { k: string; value: number; valuedAt: string }) => r.k)).toEqual(new Map());
  });

  it('keeps the newest observation per key', () => {
    const rows = [
      { k: 'a', value: 100, valuedAt: at('2026-01-01T00:00:00Z') },
      { k: 'a', value: 250, valuedAt: at('2026-06-01T00:00:00Z') },
      { k: 'b', value: 7, valuedAt: at('2026-03-01T00:00:00Z') },
    ];
    expect(latestValueByKey(rows, (r) => r.k)).toEqual(new Map([['a', 250], ['b', 7]]));
  });

  it('ignores input order rather than trusting last-row-wins', () => {
    // The failure this guards: callers pass raw query results and none of those queries
    // carries an ORDER BY. A last-wins shortcut would pass on sorted input and silently report
    // a stale valuation as current the first time a query changed.
    const rows = [
      { k: 'a', value: 250, valuedAt: at('2026-06-01T00:00:00Z') },
      { k: 'a', value: 100, valuedAt: at('2026-01-01T00:00:00Z') },
    ];
    expect(latestValueByKey(rows, (r) => r.k).get('a')).toBe(250);
  });

  it('accepts Date and string timestamps interchangeably', () => {
    // node-postgres hands back Date objects; tests and serialized payloads carry strings.
    const rows = [
      { k: 'a', value: 1, valuedAt: new Date('2026-01-01T00:00:00Z') },
      { k: 'a', value: 2, valuedAt: '2026-02-01T00:00:00Z' },
    ];
    expect(latestValueByKey(rows, (r) => r.k).get('a')).toBe(2);
  });

  it('keys by number as readily as by string', () => {
    // Why the helper is generic at all: account ids are TEXT, property ids are INT.
    const rows = [{ k: 3, value: 288256, valuedAt: at('2026-08-07T00:00:00Z') }];
    expect(latestValueByKey(rows, (r) => r.k)).toEqual(new Map([[3, 288256]]));
  });

  it('preserves a zero value instead of treating it as missing', () => {
    const rows = [
      { k: 'a', value: 500, valuedAt: at('2026-01-01T00:00:00Z') },
      { k: 'a', value: 0, valuedAt: at('2026-02-01T00:00:00Z') },
    ];
    expect(latestValueByKey(rows, (r) => r.k).get('a')).toBe(0);
  });
});
