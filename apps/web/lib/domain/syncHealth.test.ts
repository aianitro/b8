import { describe, it, expect } from 'vitest';
import { classifySyncHealth, STALE_AFTER_DAYS, type SyncItemInput } from './syncHealth';

const NOW = new Date('2026-08-10T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const item = (over: Partial<SyncItemInput> = {}): SyncItemInput => ({
  key: 'acc_1', bank: 'Chase', accountCount: 1, lastSyncedAt: daysAgo(0), ...over,
});

describe('classifySyncHealth', () => {
  it('treats a connection synced today as ok', () => {
    expect(classifySyncHealth([item()], NOW)[0]).toMatchObject({ status: 'ok', daysStale: 0 });
  });

  it('does not flag a single missed day — the daily run may simply not have fired yet', () => {
    expect(classifySyncHealth([item({ lastSyncedAt: daysAgo(1) })], NOW)[0].status).toBe('ok');
  });

  it('flags at exactly the threshold, not one day later', () => {
    const r = classifySyncHealth([item({ lastSyncedAt: daysAgo(STALE_AFTER_DAYS) })], NOW)[0];
    expect(r.status).toBe('stale');
    expect(r.daysStale).toBe(STALE_AFTER_DAYS);
  });

  it('flags the real 3-day Chase case with its account count intact', () => {
    // The case this was built for: 10 accounts behind one login, silently not syncing.
    const r = classifySyncHealth([item({ lastSyncedAt: daysAgo(3), accountCount: 10 })], NOW)[0];
    expect(r).toMatchObject({ status: 'stale', daysStale: 3, accountCount: 10, bank: 'Chase' });
  });

  it('reports a never-synced connection as its own status, not as infinitely stale', () => {
    const r = classifySyncHealth([item({ lastSyncedAt: null })], NOW)[0];
    expect(r.status).toBe('never');
    expect(r.daysStale).toBeNull();
  });

  it('sorts never-synced above stale, and stale worst-first', () => {
    const r = classifySyncHealth([
      item({ key: 'fresh', lastSyncedAt: daysAgo(0) }),
      item({ key: 'stale3', lastSyncedAt: daysAgo(3) }),
      item({ key: 'never', lastSyncedAt: null }),
      item({ key: 'stale9', lastSyncedAt: daysAgo(9) }),
    ], NOW);
    expect(r.map((x) => x.key)).toEqual(['never', 'stale9', 'stale3', 'fresh']);
  });

  it('falls back to a readable label when the bank name is missing', () => {
    expect(classifySyncHealth([item({ bank: null })], NOW)[0].bank).toBe('Unknown');
  });

  it('takes the clock as a parameter so the thresholds are testable', () => {
    // Same input, two different "now"s, two different verdicts.
    const stamp = daysAgo(3);
    expect(classifySyncHealth([item({ lastSyncedAt: stamp })], NOW)[0].status).toBe('stale');
    const earlier = new Date(new Date(stamp).getTime() + 3_600_000);
    expect(classifySyncHealth([item({ lastSyncedAt: stamp })], earlier)[0].status).toBe('ok');
  });

  it('returns empty for no connections rather than throwing', () => {
    expect(classifySyncHealth([], NOW)).toEqual([]);
  });
});
