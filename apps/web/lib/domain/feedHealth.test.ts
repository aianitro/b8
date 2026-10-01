import { describe, it, expect } from 'vitest';
import { feedState, feedFindings, STALE_AFTER_HOURS, type FeedObservation } from './feedHealth';

const NOW = new Date('2026-09-11T18:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const obs = (over: Partial<FeedObservation> = {}): FeedObservation => ({
  institution: 'Chase', accountCount: 1,
  lastSuccessfulUpdate: hoursAgo(1), lastFailedUpdate: null,
  // Defaults to UNREAD rather than healthy, matching what an item looks like before its first sync
  // under this feature — so a test that says nothing about the institution is testing that case.
  institutionStatus: null, institutionStatusAt: null,
  ...over,
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

describe('the institution status carried beside the symptom', () => {
  it('passes Plaid\'s status through to the finding', () => {
    const [f] = feedFindings([obs({
      lastSuccessfulUpdate: hoursAgo(98),
      institutionStatus: 'DEGRADED',
      institutionStatusAt: new Date('2026-09-10T09:45:18Z'),
    })], NOW);
    expect(f.institutionStatus).toBe('DEGRADED');
    expect(f.institutionStatusAt).toEqual(new Date('2026-09-10T09:45:18Z'));
  });

  it('reports a HEALTHY institution behind a stale feed rather than hiding it', () => {
    // Not a contradiction to suppress — it is the most useful thing the field can say, because it
    // means the problem is this connection rather than the bank, and re-authenticating is worth a try.
    const [f] = feedFindings([obs({ lastSuccessfulUpdate: hoursAgo(98), institutionStatus: 'HEALTHY' })], NOW);
    expect(f).toBeDefined();
    expect(f.institutionStatus).toBe('HEALTHY');
  });

  it('leaves an unread status null rather than assuming health', () => {
    const [f] = feedFindings([obs({ lastSuccessfulUpdate: hoursAgo(98) })], NOW);
    expect(f.institutionStatus).toBeNull();
  });

  it('does not let the status change WHETHER a feed is reported', () => {
    // This module decides if a feed is worth reporting; it does not decide what Plaid's status
    // means. A rule here that suppressed a finding on a healthy institution would hide the case
    // most worth acting on.
    const healthyFeed = { lastSuccessfulUpdate: hoursAgo(1), lastFailedUpdate: null };
    for (const status of ['HEALTHY', 'DEGRADED', 'DOWN', null] as const) {
      expect(feedFindings([obs({ ...healthyFeed, institutionStatus: status })], NOW)).toHaveLength(0);
    }
  });
});
