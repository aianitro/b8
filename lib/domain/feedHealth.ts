// Is the data behind this app actually arriving?
//
// Every other health signal b8 owns reports on OUR call to Plaid: `sync_log` counts what the
// request returned, `last_synced_at` records that it came back. None of them can see the step
// before it — Plaid's own refresh against the bank. When that stops, `transactionsSync` keeps
// returning 200 with an empty page, and an institution that has gone dark is indistinguishable
// from a quiet week.
//
// That is not hypothetical. On 2026-09-11 Chase had been failing on Plaid's side since 02:04 UTC
// the previous day; the app logged three clean daily syncs across the outage and showed nothing.
//
// Pure, so the rule can be tested without a Plaid key or a clock.

/** Plaid's `item.status.transactions`, per item, as the sync last observed it. */
export interface FeedObservation {
  /** How the account is labelled to a reader — the institution, not the account. */
  institution: string;
  /** How many accounts hang off this item, so the report can say what is affected. */
  accountCount: number;
  lastSuccessfulUpdate: Date | null;
  lastFailedUpdate: Date | null;
}

export type FeedState =
  /** The most recent refresh Plaid attempted failed. The strongest signal, and the earliest. */
  | 'failing'
  /** No failure recorded, but nothing has arrived for longer than an institution should be quiet. */
  | 'stale'
  /** Never observed — a manual account, or one not synced since freshness tracking began. */
  | 'unknown'
  | 'ok';

export interface FeedFinding {
  institution: string;
  accountCount: number;
  state: Exclude<FeedState, 'ok' | 'unknown'>;
  lastSuccessfulUpdate: Date | null;
  /** Whole hours since the last successful update; null when there has never been one. */
  hoursStale: number | null;
}

/**
 * How long an institution may go without a successful refresh before it is worth reporting.
 *
 * 36 hours, not 24. Plaid's background updates are not on a schedule we control and a single
 * missed window is ordinary; a reader who is alerted every time one slips learns to ignore the
 * alert, which costs more than the missed day. 36 hours means two consecutive misses, which is
 * a pattern rather than an event.
 */
export const STALE_AFTER_HOURS = 36;

const HOUR_MS = 3_600_000;

export function feedState(obs: FeedObservation, now: Date): FeedState {
  const { lastSuccessfulUpdate: ok, lastFailedUpdate: failed } = obs;
  if (ok === null && failed === null) return 'unknown';
  // A failure AFTER the last success is the live signal — it says the most recent attempt did not
  // work, without waiting for a staleness window to elapse. Checked first for that reason: the
  // same item is usually not yet stale when this fires, which is the whole point of reading it.
  if (failed !== null && (ok === null || failed > ok)) return 'failing';
  if (ok === null) return 'unknown';
  return now.getTime() - ok.getTime() > STALE_AFTER_HOURS * HOUR_MS ? 'stale' : 'ok';
}

/**
 * The reportable findings, worst first, then longest-stale, then by name so the order is stable
 * between renders on otherwise equal rows.
 *
 * `unknown` is deliberately NOT reported. A manual account has no feed to be stale, and an item
 * not yet observed has produced no evidence either way — reporting it would fill the card with
 * rows that no action can clear, which is how a guardrail gets dismissed.
 */
export function feedFindings(observations: FeedObservation[], now: Date): FeedFinding[] {
  const findings: FeedFinding[] = [];
  for (const obs of observations) {
    const state = feedState(obs, now);
    if (state === 'ok' || state === 'unknown') continue;
    findings.push({
      institution: obs.institution,
      accountCount: obs.accountCount,
      state,
      lastSuccessfulUpdate: obs.lastSuccessfulUpdate,
      hoursStale: obs.lastSuccessfulUpdate === null
        ? null
        : Math.floor((now.getTime() - obs.lastSuccessfulUpdate.getTime()) / HOUR_MS),
    });
  }
  const rank = { failing: 0, stale: 1 } as const;
  return findings.sort((a, b) =>
    rank[a.state] - rank[b.state]
    || (b.hoursStale ?? Infinity) - (a.hoursStale ?? Infinity)
    || a.institution.localeCompare(b.institution));
}
