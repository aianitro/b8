/**
 * What the chat endpoint is allowed to spend, as a pure function of state and a clock reading.
 *
 * ─── Why this exists, stated plainly, because it is not the usual reason ──────────────────────
 *
 * Not abuse. Every route in this app requires a passkey session and the server binds to loopback,
 * so there is no anonymous caller to throttle. `POST /api/chat` calls Anthropic, which bills per
 * call, and `runAgentLoop` makes up to FIVE model calls per HTTP request. The thing being limited
 * is an invoice.
 *
 * That framing decides the design. A limiter built against abuse caps the rate and stops; a
 * limiter built against a bill has to cap the TOTAL, because a rate that looks modest compounds.
 * Ten requests a minute sustained is 14,400 requests a day, which at five model calls each is
 * 72,000 — a speed bump wearing a cost control's clothes. So there are two mechanisms here and
 * they answer different questions:
 *
 *   the bucket  — "is something looping right now?"   Recovers in seconds.
 *   the ceiling — "has today already cost enough?"    Recovers at midnight.
 *
 * ─── Why per-session AND global ───────────────────────────────────────────────────────────────
 *
 * The app is single-user, so a global bucket would be defensible. A per-session bucket buys one
 * thing worth the extra state: a phone retrying in someone's pocket burns its own allowance and
 * the laptop keeps working. Mobile clients retry on flaky connections, on backgrounding, on
 * resume — the failure this is being built ahead of is a device nobody is looking at, and
 * isolating it is most of the value.
 *
 * The global bucket sits above both, because two devices looping is not twice as acceptable.
 *
 * ─── No clock inside, no storage outside ──────────────────────────────────────────────────────
 *
 * Every function takes `now`. A limiter that reads the clock itself can only be tested by sleeping,
 * and a test that sleeps is a test nobody runs. State is a plain object the caller owns, so the
 * route holds one at module scope and the tests hold a fresh one per case.
 *
 * ─── What in-memory costs, said here rather than discovered ───────────────────────────────────
 *
 * The state dies with the process. A dev-server restart resets every allowance, and a second
 * worker would keep its own. For one Next process serving one household that is the right trade —
 * Redis for a family's chat endpoint is a dependency with no reader. It stops being right the day
 * this runs behind more than one process, and the daily ceiling is the half that would go wrong
 * quietly: two workers would permit two ceilings.
 */

/** A token bucket: `capacity` tokens, refilled continuously at `refillPerSecond`. */
export interface BucketLimit {
  capacity: number;
  refillPerSecond: number;
}

interface Bucket {
  tokens: number;
  /** Epoch ms of the last refill, so elapsed time can be converted to tokens. */
  updatedAt: number;
}

export interface LimiterState {
  /** One bucket per session id. Pruned on use — see `check`. */
  sessions: Map<string, Bucket>;
  global: Bucket;
  /** Local date string the ceiling counts within, and the count so far. */
  day: string;
  dayCount: number;
}

/**
 * A short burst is fine and a sustained stream is not.
 *
 * Twelve tokens is roughly a brisk back-and-forth — ask, refine, ask again — without ever being
 * reached by a person typing. At one token every eight seconds a stuck client settles to 7.5
 * requests a minute rather than as fast as the network allows, which is the difference between a
 * bug that costs cents and one that costs the afternoon.
 */
export const SESSION_LIMIT: BucketLimit = { capacity: 12, refillPerSecond: 1 / 8 };

/** Above the per-session buckets, because two devices looping is not twice as acceptable. */
export const GLOBAL_LIMIT: BucketLimit = { capacity: 20, refillPerSecond: 1 / 5 };

/**
 * The bill cap. Two hundred requests is up to a thousand model calls in a day — far past any
 * human use of this endpoint and still a bounded number an owner can price.
 *
 * Counted per LOCAL day rather than as a rolling window, so the answer to "when does it come back"
 * is "midnight" rather than an interval the reader has to compute. A rolling 24-hour window is
 * fairer and nobody has ever found one reassuring.
 */
export const DAILY_CEILING = 200;

/** Buckets untouched for this long are dropped, so a long-lived process is not a slow leak. */
const IDLE_EVICTION_MS = 6 * 60 * 60 * 1000;

export type RefusalReason = 'session' | 'global' | 'daily';

export interface Decision {
  allowed: boolean;
  /** Present only on a refusal. Whole seconds, always at least 1 — `Retry-After: 0` invites a spin. */
  retryAfterSeconds: number;
  reason: RefusalReason | null;
}

export function createLimiter(now: Date): LimiterState {
  return {
    sessions: new Map(),
    global: { tokens: GLOBAL_LIMIT.capacity, updatedAt: now.getTime() },
    day: localDay(now),
    dayCount: 0,
  };
}

/** `YYYY-MM-DD` in LOCAL time. `toISOString` would roll the ceiling over at the wrong hour. */
function localDay(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Tokens a bucket has accrued since it was last touched, capped at its capacity. */
function refill(bucket: Bucket, limit: BucketLimit, at: number): void {
  const elapsedSeconds = Math.max(0, (at - bucket.updatedAt) / 1000);
  bucket.tokens = Math.min(limit.capacity, bucket.tokens + elapsedSeconds * limit.refillPerSecond);
  bucket.updatedAt = at;
}

/** Whole seconds until one token is available. At least 1, so a client never retries instantly. */
function waitFor(bucket: Bucket, limit: BucketLimit): number {
  if (bucket.tokens >= 1) return 1;
  return Math.max(1, Math.ceil((1 - bucket.tokens) / limit.refillPerSecond));
}

/** Whole seconds until local midnight, for the ceiling's refusal. */
function secondsUntilMidnight(now: Date): number {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((midnight.getTime() - now.getTime()) / 1000));
}

/**
 * May this request proceed? Consumes an allowance when it may, and nothing when it may not.
 *
 * ORDER MATTERS AND IT IS DELIBERATE: the ceiling is tested first, then the global bucket, then
 * the session's. Each one is harder to recover from than the next, so the reason returned is
 * always the longest wait rather than whichever check happened to run first — a client told to
 * retry in eight seconds when the real answer is "tomorrow" will spend the day asking.
 *
 * NOTHING IS CONSUMED ON A REFUSAL. A limiter that charges for rejected requests punishes the
 * client that is obediently backing off and never lets a hot loop cool down.
 */
export function check(state: LimiterState, sessionId: string, now: Date): Decision {
  const at = now.getTime();

  // The ceiling resets by observation rather than by a timer: whoever asks first after midnight
  // rolls it. A scheduled reset would need a timer in a module that deliberately has no clock.
  const today = localDay(now);
  if (state.day !== today) {
    state.day = today;
    state.dayCount = 0;
  }
  if (state.dayCount >= DAILY_CEILING) {
    return { allowed: false, retryAfterSeconds: secondsUntilMidnight(now), reason: 'daily' };
  }

  refill(state.global, GLOBAL_LIMIT, at);
  if (state.global.tokens < 1) {
    return { allowed: false, retryAfterSeconds: waitFor(state.global, GLOBAL_LIMIT), reason: 'global' };
  }

  let bucket = state.sessions.get(sessionId);
  if (!bucket) {
    bucket = { tokens: SESSION_LIMIT.capacity, updatedAt: at };
    state.sessions.set(sessionId, bucket);
  }
  refill(bucket, SESSION_LIMIT, at);
  if (bucket.tokens < 1) {
    return { allowed: false, retryAfterSeconds: waitFor(bucket, SESSION_LIMIT), reason: 'session' };
  }

  // Allowed: charge all three together, so no counter can drift from the others.
  bucket.tokens -= 1;
  state.global.tokens -= 1;
  state.dayCount += 1;

  evictIdle(state, at);
  return { allowed: true, retryAfterSeconds: 0, reason: null };
}

/**
 * Drop buckets nobody has used in hours.
 *
 * A full bucket carries no information — a session that reappears gets a full one anyway — so
 * evicting one can only ever be generous, never punitive. Without this the map grows by one entry
 * per session for the life of the process, which on a single-user app is slow and on a household
 * is still a leak.
 */
function evictIdle(state: LimiterState, at: number): void {
  for (const [key, bucket] of state.sessions) {
    if (at - bucket.updatedAt > IDLE_EVICTION_MS) state.sessions.delete(key);
  }
}
