/**
 * The overdraft watch's forecast — will this cash account go below its cushion in the next week?
 * Pure. The I/O is lib/overdraftWatch.ts; the table is migrations/1792100000000_overdraft-forecast.sql.
 *
 * The balance today, minus the charges this account's own history says are coming, plus the money
 * it says is coming in — day by day, and the lowest point of that walk.
 *
 * ─── Only what repeats, and only what repeats steadily ────────────────────────────────────────
 *
 * A forecast that cries wolf on every rent day is switched off by the end of the month, and then it
 * catches nothing. So a charge counts only when it is a SERIES: the same merchant, from this
 * account, at least three times, on a steady cadence (weekly, fortnightly, twice a month or
 * monthly), at a steady amount, and recently enough to still be running. Anything less — a card
 * payment whose amount changes every month, a one-off transfer — is left out. That is a deliberate
 * under-forecast: a missed warning costs one fee, a stream of false ones costs the feature.
 *
 * Money coming in is read the same way, so a paycheck landing the day before the rent cancels the
 * warning rather than being ignored — but it counts only from the day AFTER it lands, never on the
 * same day as a charge, because banks do not promise to post credits first.
 *
 * Dates are ISO calendar days (`YYYY-MM-DD`), handled in UTC so no clock zone can shift a day.
 */

import { seriesKey } from './recurrence';

/** One posted transaction on the account. `amount` in Plaid's sign: positive is money out. */
export interface CashTxn {
  date: string;
  amount: number;
  label: string;
}

export type Cadence = 'weekly' | 'fortnightly' | 'twice-monthly' | 'monthly';

export interface CashSeries {
  key: string;
  /** The most recent raw label, for display. */
  label: string;
  direction: 'out' | 'in';
  cadence: Cadence;
  /** The most recent instalment, a positive magnitude. */
  amount: number;
  /** The most recent instalment's date. */
  last: string;
  /** The median gap, in days, between instalments. */
  gap: number;
}

export interface CashProjection {
  /** The lowest projected balance over the horizon — the balance today when nothing lowers it. */
  low: number;
  /** The day it is reached; today when nothing lowers it. */
  lowOn: string;
  /** The expected charges up to and including that day, in date order. */
  charges: { label: string; amount: number; on: string }[];
}

/** Days ahead the forecast looks. A week: time to move money, short enough to trust. */
export const FORECAST_DAYS = 7;
/** Instalments a series needs before it is believed. The same three `./recurrence` asks for. */
export const MIN_INSTALMENTS = 3;
/** How far an instalment may sit from the series' median amount — `./recurrence`'s quarter. */
export const AMOUNT_TOLERANCE = 0.25;
/** Days an expected instalment may run late and still be counted as coming, rather than stopped. */
export const LATE_DAYS = 3;

const DAY = 86_400_000;
const toDay = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
const fromDay = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const cents = (n: number) => Math.round(n * 100) / 100;

function cadenceOf(gap: number): { cadence: Cadence; slack: number } | null {
  if (gap >= 6 && gap <= 8) return { cadence: 'weekly', slack: 1 };
  if (gap >= 13 && gap <= 15) return { cadence: 'fortnightly', slack: 2 };
  // The 1st and the 15th: gaps alternate around a half month, so the slack is wider.
  if (gap > 15 && gap <= 17) return { cadence: 'twice-monthly', slack: 3 };
  if (gap >= 27 && gap <= 33) return { cadence: 'monthly', slack: 3 };
  return null;
}

/** The account's steady series, as of `today`. Sorted by key and direction, so the order is total. */
export function detectCashSeries(txns: readonly CashTxn[], today: string): CashSeries[] {
  // One instalment per series per day: two charges from one merchant on one day are one payment
  // split by the bank, not two steps of a cadence.
  const groups = new Map<string, { label: string; direction: 'out' | 'in'; byDay: Map<number, number>; labelDay: number }>();
  for (const t of txns) {
    if (!(Math.abs(t.amount) >= 0.01)) continue;
    const direction = t.amount > 0 ? 'out' : 'in';
    const id = `${direction}:${seriesKey(t.label)}`;
    const day = toDay(t.date);
    const g = groups.get(id) ?? { label: t.label, direction, byDay: new Map(), labelDay: day };
    g.byDay.set(day, (g.byDay.get(day) ?? 0) + Math.abs(t.amount));
    if (day >= g.labelDay) { g.label = t.label; g.labelDay = day; }
    groups.set(id, g);
  }

  const now = toDay(today);
  const out: CashSeries[] = [];
  for (const [id, g] of groups) {
    const days = [...g.byDay.keys()].sort((a, b) => a - b);
    if (days.length < MIN_INSTALMENTS) continue;
    // The most recent instalments only, so a cadence or price that changed months ago does not
    // disqualify the one running now.
    const recent = days.slice(-(MIN_INSTALMENTS + 1));
    const gaps = recent.slice(1).map((d, i) => d - recent[i]);
    const gap = median(gaps);
    const c = cadenceOf(gap);
    if (!c || gaps.some((x) => Math.abs(x - gap) > c.slack)) continue;
    const amounts = recent.slice(-MIN_INSTALMENTS).map((d) => g.byDay.get(d)!);
    const mid = median(amounts);
    if (amounts.some((a) => Math.abs(a - mid) > mid * AMOUNT_TOLERANCE)) continue;
    const last = days[days.length - 1];
    // Still running: the next instalment is not more than a few days overdue.
    if (now - last > gap + c.slack + LATE_DAYS) continue;
    out.push({
      key: id.slice(id.indexOf(':') + 1), label: g.label, direction: g.direction, cadence: c.cadence,
      amount: cents(g.byDay.get(last)!), last: fromDay(last), gap,
    });
  }
  return out.sort((a, b) => (a.key === b.key ? a.direction.localeCompare(b.direction) : a.key.localeCompare(b.key)));
}

/** A series' instalments due in (today, today + horizon], an overdue one counted as due tomorrow. */
export function dueDates(s: CashSeries, today: string, horizon = FORECAST_DAYS): string[] {
  const now = toDay(today);
  const step = (d: number): number => {
    if (s.cadence !== 'monthly') return d + Math.round(s.gap);
    // A month on, on the same day of the month, clamped to the month's length.
    const date = new Date(d * DAY);
    const y = date.getUTCFullYear(), m = date.getUTCMonth() + 1;
    const len = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return Math.round(Date.UTC(y, m, Math.min(date.getUTCDate(), len)) / DAY);
  };
  const due: number[] = [];
  let d = step(toDay(s.last));
  // Overdue but within the grace: it has not posted, so it is still coming — tomorrow at the earliest.
  while (d <= now) {
    if (now - d <= LATE_DAYS) { due.push(now + 1); }
    d = step(d);
  }
  for (; d <= now + horizon; d = step(d)) due.push(d);
  return [...new Set(due)].sort((a, b) => a - b).map(fromDay);
}

/** Walk the balance forward and report its lowest point. */
export function projectBalance(balance: number, series: readonly CashSeries[], today: string, horizon = FORECAST_DAYS): CashProjection {
  const now = toDay(today);
  const outs = new Map<number, { label: string; amount: number }[]>();
  const ins = new Map<number, number>();
  for (const s of series) {
    for (const on of dueDates(s, today, horizon)) {
      const d = toDay(on);
      if (s.direction === 'out') outs.set(d, [...(outs.get(d) ?? []), { label: s.label, amount: s.amount }]);
      else ins.set(d, (ins.get(d) ?? 0) + s.amount);
    }
  }

  let running = balance;
  let low = balance;
  let lowOn = now;
  const charges: CashProjection['charges'] = [];
  for (let d = now + 1; d <= now + horizon; d++) {
    // Charges first, then the day's credits: the low is read between the two.
    for (const c of outs.get(d) ?? []) { running -= c.amount; charges.push({ ...c, on: fromDay(d) }); }
    if (running < low) { low = running; lowOn = d; }
    running += ins.get(d) ?? 0;
  }
  return { low: cents(low), lowOn: fromDay(lowOn), charges: charges.filter((c) => toDay(c.on) <= lowOn) };
}
