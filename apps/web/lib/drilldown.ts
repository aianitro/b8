// The dashboard's link into the ledger, and the month labels that sit beside it.
//
// The two live together because they encode the same convention and disagree expensively. Every
// month index in this app is 0-based — the domain modules, the outlook, every finding — and the
// transactions page reads 1-based, so the `+ 1` below is the single place that conversion happens.
// A row labelled "Aug" whose link opens July is not a visible bug, it is a reader who concludes
// the ledger is wrong; keeping the label array and the URL builder in one module means a renderer
// cannot import one without the other.

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** @param month 0-based, as every month index in this app is. */
export function drillHref(categories: string[], month: number): string {
  const params = categories.map((name) => `category=${encodeURIComponent(name)}`);
  return `/transactions?${params.join('&')}&month=${month + 1}&from=dashboard`;
}

/**
 * A calendar date as `YYYY-MM-DD`, from the 0-based month this app uses everywhere.
 *
 * UTC arithmetic on values that are not UTC, deliberately. `asOf` is a local year/month/day triple
 * with no time in it, so there is no instant here to convert — only calendar arithmetic, and doing
 * it in UTC is what keeps a DST boundary from turning the 3rd into the 2nd at 23:00. Building a
 * local `new Date(y, m, d)` and reading it back is the version that fails twice a year.
 */
export function ymd(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/**
 * The Monday that starts the week containing `asOf`, as `YYYY-MM-DD`.
 *
 * @param isoDow 1–7 with Monday = 1, READ FROM THE DATABASE rather than computed here. The week
 *   card's figure comes from `date_trunc('week', CURRENT_DATE)`, which is Monday-based, and the
 *   same query returns its own `EXTRACT(ISODOW)` beside it precisely so nothing downstream has to
 *   ask a second clock what day it is. A link that disagreed with the figure it sits under would
 *   send the reader to a list that does not add up to the number they clicked.
 */
export function weekStartYmd(asOf: { year: number; month: number; day: number }, isoDow: number): string {
  const d = new Date(Date.UTC(asOf.year, asOf.month, asOf.day));
  d.setUTCDate(d.getUTCDate() - (isoDow - 1));
  return d.toISOString().slice(0, 10);
}

/**
 * The ledger, filtered to a closed date range, tagged as having come from the dashboard.
 *
 * Both bounds are inclusive, matching the `>=` and `<=` the transactions page applies them with.
 * A single day is the same call with `from === to`.
 */
export function dateRangeHref(from: string, to: string): string {
  return `/transactions?dateFrom=${from}&dateTo=${to}&from=dashboard`;
}
