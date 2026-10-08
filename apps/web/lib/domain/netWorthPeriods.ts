/**
 * Net-worth snapshots within a look-back horizon, for the trend chart.
 *
 * A HORIZON, NOT A CALENDAR PERIOD — the owner's call. "Week" is the last 7 days, "Month" the last
 * 30, "Year" the last 365, each counted back from the LATEST snapshot rather than from today, so a
 * day the sync missed does not shorten the window. Every snapshot inside it is drawn; nothing is
 * averaged or sampled, because a snapshot is the balance the accounts actually held that day.
 * The window includes its first day: the last 7 days on Oct 8 run from Oct 1.
 *
 * Dates are ISO `YYYY-MM-DD` strings straight from Postgres and are compared as calendar dates,
 * never through a `Date` in local time: a UTC parse of a date-only string is the previous day in
 * every negative-offset zone, which would move the window's edge by a day.
 */

export type NetWorthHorizon = 'week' | 'month' | 'year';

export const HORIZON_DAYS: Record<NetWorthHorizon, number> = { week: 7, month: 30, year: 365 };

export interface DatedSnapshot {
  /** `YYYY-MM-DD`. */
  iso: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `iso` moved back by `days` calendar days, as `YYYY-MM-DD`. */
export function daysBefore(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The snapshots within `horizon` of the latest one, in date order. Input need not be sorted.
 */
export function withinHorizon<T extends DatedSnapshot>(snapshots: readonly T[], horizon: NetWorthHorizon): T[] {
  if (snapshots.length === 0) return [];
  const sorted = [...snapshots].sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
  const cutoff = daysBefore(sorted[sorted.length - 1].iso, HORIZON_DAYS[horizon]);
  return sorted.filter((s) => s.iso >= cutoff);
}

/** A snapshot's axis label: "Oct 8". */
export function dayLabel(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}
