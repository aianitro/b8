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
