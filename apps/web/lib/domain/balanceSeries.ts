/**
 * One account's balance at the close of each day — the series behind the chart on /accounts/[id].
 *
 * Pure: the page reads the rows, this turns them into points, and the chart only slices.
 *
 * ─── WALKED BACKWARDS FROM TODAY, NOT FORWARDS FROM AN OPENING BALANCE ───────────────────────
 *
 * A ledger account's balance is `beginning_balance(year) + this year's flows` — the figure net
 * worth uses. Building the series forwards would need an opening balance for every year the window
 * touches, and a twelve-month window crosses New Year for eleven months of the year. Last year's
 * `account_balances` row is often missing, and where it exists nothing guarantees it agrees with
 * this year's. So the series is anchored once, at today, on the same figure the rest of the app
 * shows, and each earlier day is that figure with the later flows undone.
 */

export interface BalancePoint {
  /** `YYYY-MM-DD` */
  date: string;
  balance: number;
}

export interface Flow {
  /** `YYYY-MM-DD` */
  date: string;
  /** Plaid's sign: positive is money out, negative is money in. */
  amount: number;
}

export interface Valuation {
  /** `YYYY-MM-DD` — the day it was observed. */
  date: string;
  value: number;
}

/**
 * Every date from `days` before `end` through `end`, oldest first.
 *
 * Stepped in UTC on purpose. Local midnight plus a day lands on 23:00 the same day when a DST
 * boundary falls in between, and the series quietly gains a duplicate date.
 */
export function dateRange(end: string, days: number): string[] {
  const [y, m, d] = end.split('-').map(Number);
  const endMs = Date.UTC(y, m - 1, d);
  const out: string[] = [];
  for (let i = days; i >= 0; i--) {
    out.push(new Date(endMs - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Close-of-day balances for a ledger account, given its balance at the close of `end`.
 *
 * Flows dated after `end` are ignored rather than undone: `endBalance` is the balance as of `end`,
 * so a future-dated row was never in it.
 */
export function ledgerSeries(endBalance: number, end: string, days: number, flows: Flow[]): BalancePoint[] {
  const dates = dateRange(end, days);
  const outByDate = new Map<string, number>();
  for (const f of flows) {
    if (f.date > end) continue;
    outByDate.set(f.date, (outByDate.get(f.date) ?? 0) + f.amount);
  }

  const points: BalancePoint[] = new Array(dates.length);
  let balance = endBalance;
  for (let i = dates.length - 1; i >= 0; i--) {
    points[i] = { date: dates[i], balance: round2(balance) };
    // Undo this day's flows to get the close of the day before. A positive amount took money out,
    // so adding it back is what the balance was before it left.
    balance += outByDate.get(dates[i]) ?? 0;
  }
  return points;
}

/**
 * Close-of-day values for a valuation-mode account: each day carries the latest observation made
 * on or before it.
 *
 * Days before the first observation are LEFT OUT, not zero. A brokerage nobody had valued yet was
 * not worth nothing, and a line dropping to the axis would say it was.
 */
export function valuationSeries(end: string, days: number, valuations: Valuation[]): BalancePoint[] {
  const sorted = [...valuations].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const points: BalancePoint[] = [];
  let j = 0;
  let current: number | null = null;
  for (const date of dateRange(end, days)) {
    // Same-day observations: the last one in sorted order wins, which for rows sharing a date is
    // the one the caller listed last — the query orders by time within the day.
    while (j < sorted.length && sorted[j].date <= date) current = sorted[j++].value;
    if (current !== null) points.push({ date, balance: current });
  }
  return points;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
