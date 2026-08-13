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
