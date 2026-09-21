import { describe, it, expect } from 'vitest';
import { feedState, feedFindings, STALE_AFTER_HOURS, type FeedObservation } from './feedHealth';

const NOW = new Date('2026-09-11T18:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const obs = (over: Partial<FeedObservation> = {}): FeedObservation => ({
  institution: 'Chase', accountCount: 1,
  lastSuccessfulUpdate: hoursAgo(1), lastFailedUpdate: null, ...over,
});

describe('feedState', () => {
  it('is ok when the last success is recent', () => {
    expect(feedState(obs(), NOW)).toBe('ok');
  });

  it('is unknown when nothing has ever been observed', () => {
    expect(feedState(obs({ lastSuccessfulUpdate: null, lastFailedUpdate: null }), NOW)).toBe('unknown');
  });

  it('is failing when the most recent attempt failed, even while still fresh', () => {
    // The case this module exists for: Chase failed at 13:43 having last succeeded 40 hours
    // earlier. Caught on the failure, not on the staleness window.
    expect(feedState(obs({
      lastSuccessfulUpdate: hoursAgo(2), lastFailedUpdate: hoursAgo(1),
    }), NOW)).toBe('failing');
  });

  it('is ok when a failure preceded a later success', () => {
    expect(feedState(obs({
      lastSuccessfulUpdate: hoursAgo(1), lastFailedUpdate: hoursAgo(5),
    }), NOW)).toBe('ok');
  });

  it('is failing when there is a failure and no success at all', () => {
    expect(feedState(obs({ lastSuccessfulUpdate: null, lastFailedUpdate: hoursAgo(3) }), NOW)).toBe('failing');
  });

  it('tolerates a single missed window and reports the second', () => {
    expect(feedState(obs({ lastSuccessfulUpdate: hoursAgo(STALE_AFTER_HOURS - 1) }), NOW)).toBe('ok');
    expect(feedState(obs({ lastSuccessfulUpdate: hoursAgo(STALE_AFTER_HOURS + 1) }), NOW)).toBe('stale');
  });
});

describe('feedFindings', () => {
  it('reports nothing when every feed is healthy', () => {
    expect(feedFindings([obs(), obs({ institution: 'Amex' })], NOW)).toEqual([]);
  });

  it('omits unknown feeds, which no action can clear', () => {
    expect(feedFindings([obs({ lastSuccessfulUpdate: null, lastFailedUpdate: null })], NOW)).toEqual([]);
  });

  it('ranks failing above stale, then by how long it has been', () => {
    const out = feedFindings([
      obs({ institution: 'Discover', lastSuccessfulUpdate: hoursAgo(50) }),
      obs({ institution: 'Chase', lastSuccessfulUpdate: hoursAgo(40), lastFailedUpdate: hoursAgo(1) }),
      obs({ institution: 'PayPal', lastSuccessfulUpdate: hoursAgo(90) }),
    ], NOW);
    expect(out.map((f) => [f.institution, f.state])).toEqual([
      ['Chase', 'failing'], ['PayPal', 'stale'], ['Discover', 'stale'],
    ]);
  });

  it('reports whole hours since the last success, and null when there was none', () => {
    // Looked up by name, not by position: the sort puts the failing feed first regardless of
    // input order, and asserting positionally would be testing the sort twice over.
    const out = feedFindings([
      obs({ institution: 'A', lastSuccessfulUpdate: hoursAgo(40.9) }),
      obs({ institution: 'B', lastSuccessfulUpdate: null, lastFailedUpdate: hoursAgo(2) }),
    ], NOW);
    const byName = Object.fromEntries(out.map((f) => [f.institution, f]));
    expect(byName.A.hoursStale).toBe(40);   // floored, not rounded up from 40.9
    expect(byName.B.hoursStale).toBeNull();
  });

  it('carries the account count so the report can say what is affected', () => {
    const [f] = feedFindings([obs({ accountCount: 10, lastFailedUpdate: NOW })], NOW);
    expect(f.accountCount).toBe(10);
  });
});
