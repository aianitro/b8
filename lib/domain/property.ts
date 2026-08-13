// Per-property equity (ROADMAP.md Phase 0 step 5): a property's own market value lives in
// property_valuations, while the mortgage secured against it is an ordinary valuation-mode
// liability account (lib/domain/valuation.ts) linked via accounts.property_id. Equity is
// computed by joining the two, not stored anywhere — same "derived read, never a stored
// column" stance as latestValuationByAccount.
//
// latestValuationByProperty below once duplicated latestValuationByAccount's "pick the newest
// row" logic, deliberately, to avoid a cross-branch dependency while this module and
// valuation.ts were being built on separate unmerged Phase 0 branches. Both landed on main, so
// the reason expired and the fork was consolidated into observations.ts (2026-08-13) — the
// generic is keyed by a caller-supplied extractor precisely because the key type differs
// (TEXT account id vs. INT property id) while the reduction does not.

import { latestValueByKey, type Observation } from './observations';

export interface Property {
  id: number;
  nickname: string;
}

export interface PropertyValuationRow extends Observation {
  propertyId: number;
}

export function latestValuationByProperty(rows: PropertyValuationRow[]): Map<number, number> {
  return latestValueByKey(rows, (row) => row.propertyId);
}

/**
 * Formats a Postgres DATE for an `<input type="date">`, which requires exactly `YYYY-MM-DD`.
 *
 * node-postgres returns a DATE column as a JS Date at **local** midnight, not a string — so
 * `.slice(0, 10)` throws, and `.toISOString().slice(0, 10)` is subtly worse: it converts to UTC
 * first, so at any UTC+ offset local midnight lands on the previous UTC day and every date
 * silently shifts a day earlier. Reading the local components sidesteps both.
 */
export function toDateInputValue(d: Date | string | null): string {
  if (d === null) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Step-interpolated lookup: the most recent observation at or before `asOf`, or null if the
 * series hadn't started yet.
 *
 * Needed because a property's value and its mortgage's balance are recorded on unrelated
 * schedules — you might type in a market value in March and a mortgage balance in July. To
 * chart equity as the gap between them, each property valuation needs the mortgage balance
 * that was current *on that date*, not the newest one overall (which would retroactively
 * apply today's paid-down balance to a valuation from two years ago and overstate past equity).
 *
 * Step rather than linear interpolation: a balance stays what it was until the next reading
 * replaces it. Inventing intermediate values would be presenting a guess as an observation.
 *
 * Compared at DAY granularity, not by exact timestamp, and that distinction is load-bearing: a
 * hand-entered property valuation lands at midnight (the date picker submits a date, not a
 * time) while a synced mortgage balance carries the real clock time it arrived — 06:17 the same
 * morning. Comparing instants meant a balance recorded hours *after* midnight on the very same
 * day failed the "at or before" test, so a same-day pair could never match and equity silently
 * vanished from the property header. Within a day, the latest observation still wins.
 */
const dayOf = (d: Date | string): number => {
  const x = new Date(d);
  return Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
};

// Takes bare Observations rather than a union of the two row shapes: it reads only value and
// valuedAt, and it is genuinely called with both a property's valuation series and a mortgage
// account's balance series — the union spelled that out one shape at a time.
export function valueAsOf(rows: readonly Observation[], asOf: Date | string): number | null {
  const asOfDay = dayOf(asOf);
  let best: { value: number; ms: number } | null = null;
  for (const row of rows) {
    if (dayOf(row.valuedAt) > asOfDay) continue;
    const ms = new Date(row.valuedAt).getTime();
    if (best === null || ms > best.ms) best = { value: row.value, ms };
  }
  return best?.value ?? null;
}

export interface PropertyEquity {
  propertyId: number;
  nickname: string;
  value: number | null; // null: never valued — equity is unknowable, not zero
  mortgageBalance: number; // 0 when no mortgage is linked
  equity: number | null;
}

/**
 * mortgageBalanceByProperty is already the *latest* balance per property — one property could
 * in principle have more than one linked liability account, so the caller sums before this
 * function sees it rather than this function guessing how to combine multiple accounts.
 */
export function computePropertyEquity(
  properties: Property[],
  latestPropertyValuations: Map<number, number>,
  mortgageBalanceByProperty: Map<number, number>
): PropertyEquity[] {
  return properties.map((p) => {
    const value = latestPropertyValuations.get(p.id) ?? null;
    const mortgageBalance = mortgageBalanceByProperty.get(p.id) ?? 0;
    return {
      propertyId: p.id,
      nickname: p.nickname,
      value,
      mortgageBalance,
      equity: value === null ? null : value - mortgageBalance,
    };
  });
}
