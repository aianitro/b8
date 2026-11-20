// Shared reducers over append-only observation series.
//
// Three tables in this app record observations rather than current state — account_valuations,
// property_valuations, and (through the same shape) the plaid_balance change-log. All of them
// are deliberately append-only: "current value" is always a derived read, never a stored column,
// so a quarterly manual entry naturally becomes value-over-time history without a schema change.
//
// That design choice has a consequence: every consumer needs the same "collapse the history to
// the newest row per key" reduction, and getting it subtly wrong (last-wins on unsorted input,
// say) silently reports a stale valuation as current. Writing it once means it is reviewed once.
//
// Keyed generically because the key differs by series — account id (TEXT) for account
// valuations, property id (INT) for property ones — while the reduction does not.

/** The two fields every observation series carries, whatever it is keyed by. */
export interface Observation {
  value: number;
  /** Postgres TIMESTAMPTZ arrives from node-postgres as a Date; tests and JSON pass strings. */
  valuedAt: Date | string;
}

/**
 * Reduces a possibly-unsorted, multi-row-per-key history down to the newest value per key.
 *
 * Explicitly compares timestamps rather than trusting input order — the callers pass raw query
 * results, and none of those queries carries an ORDER BY that this could rely on. A "last row
 * wins" shortcut would work by accident today and break the first time a query changes.
 */
export function latestValueByKey<T extends Observation, K>(
  rows: readonly T[],
  keyOf: (row: T) => K
): Map<K, number> {
  const latest = new Map<K, { value: number; valuedAtMs: number }>();
  for (const row of rows) {
    const valuedAtMs = new Date(row.valuedAt).getTime();
    const key = keyOf(row);
    const existing = latest.get(key);
    if (!existing || valuedAtMs > existing.valuedAtMs) {
      latest.set(key, { value: row.value, valuedAtMs });
    }
  }
  return new Map([...latest].map(([key, v]) => [key, v.value]));
}

/**
 * The whole winning row per key, where "newer" is decided by `compare` (P8-42a).
 *
 * `latestValueByKey` above returns only a number, which is all a valuation series needs. A loyalty
 * balance needs the whole row — its unit, its as-of date and its source travel with it — and its
 * balance is decimal TEXT that must never pass through a JS number. So this is the same reduction,
 * over whole rows, with the ordering passed in rather than hard-wired to one timestamp.
 *
 * `compare(a, b)` is positive when `a` is newer than `b`, negative when older, and zero only for
 * rows that are the same observation. It must be a TOTAL order — break every tie down to a unique
 * key, as `compareDatedObservations` does — because that is what makes the result independent of
 * input order: with a total order, whichever row arrives first, the greatest one wins. A comparator
 * that returned zero for two different rows would let input order decide between them, which is
 * exactly the last-row-wins accident `latestValueByKey`'s comment warns about.
 */
export function latestRowByKey<T, K>(
  rows: readonly T[],
  keyOf: (row: T) => K,
  compare: (a: T, b: T) => number
): Map<K, T> {
  const latest = new Map<K, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const existing = latest.get(key);
    if (existing === undefined || compare(row, existing) > 0) latest.set(key, row);
  }
  return latest;
}

/**
 * An observation dated by a CALENDAR day rather than an instant (P8-42a, loyalty balances).
 *
 * `asOf` is `YYYY-MM-DD` and `recordedAt` is a fixed-width UTC timestamp text
 * (`YYYY-MM-DDTHH:MM:SS.ffffff`, as `to_char(recorded_at AT TIME ZONE 'UTC', …)` produces it), so
 * both order correctly as plain strings and neither goes through the JS date machinery, where a
 * time zone could move a calendar day. `id` is the table's serial key.
 */
export interface DatedObservation {
  asOf: string;
  recordedAt: string;
  id: number;
}

/**
 * Newest-wins for dated observations: the greater `asOf` wins; on the same day, the later
 * `recordedAt`; on the same instant, the higher `id`. Positive when `a` is newer.
 *
 * AS-OF FIRST, NEVER ARRIVAL FIRST. An older reading recorded later — a re-imported sheet, a
 * forwarded old statement — has a later `recordedAt` and a higher `id`, and must still lose to the
 * newer reading it arrived after; arrival only breaks ties between readings for the same day.
 */
export function compareDatedObservations(a: DatedObservation, b: DatedObservation): number {
  if (a.asOf !== b.asOf) return a.asOf > b.asOf ? 1 : -1;
  if (a.recordedAt !== b.recordedAt) return a.recordedAt > b.recordedAt ? 1 : -1;
  return a.id - b.id;
}
