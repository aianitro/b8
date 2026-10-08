/**
 * Net-worth snapshots, regrouped into weeks, months or years for the trend chart.
 *
 * A PERIOD'S POINT IS ITS LAST SNAPSHOT, not an average. Net worth is a balance — a stock, not a
 * flow — so the figure that describes a month is where it closed, which is also what a statement
 * would print. An average would draw a value the owner's accounts never actually held. The
 * current period has not closed, so its point is simply the latest reading.
 *
 * Dates are ISO `YYYY-MM-DD` strings straight from Postgres and are read as calendar dates, never
 * through a `Date` in local time: a UTC parse of a date-only string is the previous day in every
 * negative-offset zone, which would move a snapshot taken on the 1st into the month before.
 */

export type NetWorthPeriod = 'week' | 'month' | 'year';

export interface DatedSnapshot {
  /** `YYYY-MM-DD`. */
  iso: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

/** The Monday that starts the ISO week containing this date, as `YYYY-MM-DD`. */
export function weekStart(iso: string): string {
  const { y, m, d } = parts(iso);
  const t = Date.UTC(y, m - 1, d);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  return new Date(t - dow * 86_400_000).toISOString().slice(0, 10);
}

function bucketKey(iso: string, period: NetWorthPeriod): string {
  if (period === 'year') return iso.slice(0, 4);
  if (period === 'month') return iso.slice(0, 7);
  return weekStart(iso);
}

/**
 * The last snapshot of each period, in date order. Input need not be sorted; snapshots on the
 * same date resolve to whichever comes last in the input.
 */
export function lastPerPeriod<T extends DatedSnapshot>(snapshots: readonly T[], period: NetWorthPeriod): T[] {
  const sorted = [...snapshots].sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
  const byKey = new Map<string, T>();
  for (const s of sorted) byKey.set(bucketKey(s.iso, period), s);
  return [...byKey.values()];
}

/**
 * The axis label for a period's point.
 *
 * A week is labelled by the date of its closing snapshot ("Oct 8"), a month by its name — with the
 * year appended only when the chart spans more than one, since "Oct" is ambiguous only then — and
 * a year by its number.
 */
export function periodLabel(iso: string, period: NetWorthPeriod, spansYears: boolean): string {
  const { y, m, d } = parts(iso);
  if (period === 'year') return String(y);
  if (period === 'month') return spansYears ? `${MONTHS[m - 1]} '${String(y).slice(2)}` : MONTHS[m - 1];
  return `${MONTHS[m - 1]} ${d}`;
}
