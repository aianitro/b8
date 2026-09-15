import { describe, expect, it } from 'vitest';
import {
  check,
  createLimiter,
  DAILY_CEILING,
  GLOBAL_LIMIT,
  SESSION_LIMIT,
  type LimiterState,
} from './rateLimit';

const T0 = new Date('2026-09-15T10:00:00');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

/**
 * Spend the whole daily ceiling, and PROVE it was spent.
 *
 * Twice while writing these fixtures the drain silently failed to reach the ceiling — once because
 * every call landed at one instant and the global bucket refused all but twenty, once because a
 * two-minute spacing ran 200 requests past local midnight and rolled the counter. Both times the
 * test then asserted something true of a state it had not created. Ten seconds apart is under both
 * refill rates and finishes in about half an hour, and the assertion is what stops the next
 * miscalibration passing quietly.
 */
function drainDailyCeiling(state: LimiterState, start: Date): Date {
  for (let i = 0; i < DAILY_CEILING; i++) check(state, `s${i % 4}`, new Date(start.getTime() + i * 10_000));
  expect(state.dayCount).toBe(DAILY_CEILING);
  return new Date(start.getTime() + DAILY_CEILING * 10_000);
}

/** Spend `n` allowances from one session, all at the same instant. */
function drain(state: LimiterState, session: string, n: number, when = T0): void {
  for (let i = 0; i < n; i++) check(state, session, when);
}

describe('the burst buckets', () => {
  it('lets a person work without ever meeting the limit', () => {
    // Twelve in a row at once is already faster than anyone types.
    const state = createLimiter(T0);
    for (let i = 0; i < SESSION_LIMIT.capacity; i++) {
      expect(check(state, 's1', T0).allowed).toBe(true);
    }
  });

  it('stops a client that keeps going', () => {
    const state = createLimiter(T0);
    drain(state, 's1', SESSION_LIMIT.capacity);
    const refused = check(state, 's1', T0);
    expect(refused.allowed).toBe(false);
    expect(refused.reason).toBe('session');
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('refills over time rather than resetting on a schedule', () => {
    const state = createLimiter(T0);
    drain(state, 's1', SESSION_LIMIT.capacity);
    expect(check(state, 's1', at(4)).allowed).toBe(false);
    // One token every eight seconds.
    expect(check(state, 's1', at(9)).allowed).toBe(true);
  });

  it('never accrues more than its capacity while idle', () => {
    // Otherwise an app left open overnight returns with hours of tokens and the burst limit means
    // nothing on the first morning request.
    const state = createLimiter(T0);
    drain(state, 's1', SESSION_LIMIT.capacity);
    const nextDay = at(20 * 3600);
    for (let i = 0; i < SESSION_LIMIT.capacity; i++) {
      expect(check(state, 's1', nextDay).allowed).toBe(true);
    }
    expect(check(state, 's1', nextDay).allowed).toBe(false);
  });

  it('isolates one session from another, which is the whole reason for per-session buckets', () => {
    // A phone retrying in a pocket must not lock the laptop out.
    const state = createLimiter(T0);
    drain(state, 'phone', SESSION_LIMIT.capacity);
    expect(check(state, 'phone', T0).allowed).toBe(false);
    expect(check(state, 'laptop', T0).allowed).toBe(true);
  });

  it('still caps the total across sessions, because two loops are not twice as acceptable', () => {
    const state = createLimiter(T0);
    let allowed = 0;
    for (let i = 0; i < 40; i++) {
      if (check(state, `session-${i % 8}`, T0).allowed) allowed++;
    }
    expect(allowed).toBe(GLOBAL_LIMIT.capacity);
    expect(check(state, 'fresh', T0).reason).toBe('global');
  });

  it('charges nothing for a refused request', () => {
    // A limiter that charges for rejections punishes the client that is backing off correctly and
    // never lets a hot loop cool down.
    const state = createLimiter(T0);
    drain(state, 's1', SESSION_LIMIT.capacity);
    for (let i = 0; i < 50; i++) check(state, 's1', T0);
    // The refusals must not have pushed the recovery time out.
    expect(check(state, 's1', at(9)).allowed).toBe(true);
  });
});

describe('the daily ceiling', () => {
  it('is what actually caps the bill, since a bucket only caps the rate', () => {
    // Ten requests a minute sustained is 14,400 a day, and each is up to five model calls.
    const state = createLimiter(T0);
    const after = drainDailyCeiling(state, T0);
    // Spaced so neither bucket is the binding constraint — the refusal can only be the ceiling.
    for (let i = 0; i < 20; i++) {
      expect(check(state, 's1', new Date(after.getTime() + i * 10_000)).reason).toBe('daily');
    }
  });

  it('tells a spent client to come back tomorrow, not in eight seconds', () => {
    // Order matters: told the bucket's answer when the real one is the ceiling, a client spends the
    // rest of the day asking.
    const state = createLimiter(T0);
    const refused = check(state, 's1', drainDailyCeiling(state, T0));
    expect(refused.reason).toBe('daily');
    expect(refused.retryAfterSeconds).toBeGreaterThan(3600);
  });

  it('resets at local midnight', () => {
    const state = createLimiter(T0);
    drainDailyCeiling(state, T0);
    expect(check(state, 's1', new Date('2026-09-15T23:59:00')).reason).toBe('daily');
    expect(check(state, 's1', new Date('2026-09-16T00:01:00')).allowed).toBe(true);
  });

  it('rolls over by local date, not by UTC', () => {
    // `toISOString()` would move the reset to whatever hour UTC midnight lands on locally, so the
    // ceiling would lift in the middle of an evening and the owner would never know when.
    //
    // Spaced two minutes apart, as the other ceiling fixtures are. Drained at one instant the
    // GLOBAL bucket refuses after twenty and the ceiling never fills — which is how the first
    // version of this test passed for the wrong reason and then failed for the right one.
    const morning = new Date('2026-09-15T08:00:00');
    const state = createLimiter(morning);
    drainDailyCeiling(state, morning);
    // 22:00 is still the same LOCAL day west of Greenwich, where UTC has already rolled over.
    expect(check(state, 's1', new Date('2026-09-15T22:00:00')).reason).toBe('daily');
  });
});

describe('what the refusal tells the client', () => {
  it('never says to retry immediately', () => {
    // `Retry-After: 0` is an invitation to spin, which is the behaviour being limited.
    const state = createLimiter(T0);
    drain(state, 's1', SESSION_LIMIT.capacity);
    for (const t of [0, 1, 4, 7]) {
      const d = check(state, 's1', at(t));
      expect(d.allowed).toBe(false);
      expect(d.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    }
  });

  it('returns whole seconds, which is what the header can carry', () => {
    const state = createLimiter(T0);
    drain(state, 's1', SESSION_LIMIT.capacity);
    const d = check(state, 's1', at(3));
    expect(Number.isInteger(d.retryAfterSeconds)).toBe(true);
  });
});

describe('the state does not grow forever', () => {
  it('drops buckets nobody has used in hours', () => {
    // A full bucket carries no information, so evicting one can only be generous. Without this the
    // map grows by one entry per session for the life of the process.
    const state = createLimiter(T0);
    for (let i = 0; i < 50; i++) check(state, `session-${i}`, T0);
    expect(state.sessions.size).toBeGreaterThan(1);

    check(state, 'later', at(7 * 3600));
    expect(state.sessions.size).toBe(1);
    expect(state.sessions.has('later')).toBe(true);
  });

  it('keeps a bucket that is still in use', () => {
    const state = createLimiter(T0);
    check(state, 'active', T0);
    check(state, 'active', at(3600));
    check(state, 'other', at(3600));
    expect(state.sessions.has('active')).toBe(true);
  });
});
