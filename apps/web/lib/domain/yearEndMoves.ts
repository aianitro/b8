/**
 * How much the year-end P/L moved between two moments, and why. Pure. Snapshots are in
 * migrations/1792200000000_year-end-snapshots.sql; the I/O is lib/yearEndSnapshots.ts.
 *
 * The projection (`./yearEnd`) puts closed months on fact, the month in progress on plan-or-actual
 * whichever is larger, and the rest on plan. It moves for four reasons and only one is spending, so
 * a bare subtraction would report the other three as if they were — loudest on the 1st of every
 * month, when a month closing moves it with nobody having spent a thing.
 *
 * ─── Four parts that always add up ────────────────────────────────────────────────────────────
 *
 * Sequential substitution from the earlier state A to the later state B, one input at a time:
 *
 *   S0  A's plan,  A's actuals,                          A's month
 *   S1  B's plan,  A's actuals,                          A's month   → BUDGET  = S1 − S0
 *   S2  B's plan,  A's actuals with B's for months < A's, A's month  → PAST    = S2 − S1
 *   S3  B's plan,  B's actuals,                          A's month   → SPENDING= S3 − S2
 *   S4  B's plan,  B's actuals,                          B's month   → CLOSED  = S4 − S3
 *
 * S4 − S0 is the whole move, exactly, and the four parts sum to it by construction. Each part is
 * computed per category, so "spending" can name the categories behind it.
 *
 * - BUDGET: the plan was edited (or unspent money carried in).
 * - PAST: a month already closed changed — a late arrival, a refund, a transaction re-filed.
 * - SPENDING: the month in progress moved — the signal the owner actually wants.
 * - CLOSED: the calendar advanced, and a month went from plan-or-actual to plain fact.
 *
 * Signs are the P/L's: positive means the year-end P/L went UP (better), for income and spend alike.
 */

import { MONTHS_PER_YEAR } from './yearEnd';

/** One category at one moment: its resolved Jan–Dec plan and its monthly actuals, ledger sign. */
export interface CategoryState {
  name: string;
  isIncome: boolean;
  /** Twelve resolved plan amounts, positive magnitudes. */
  plan: number[];
  /** Twelve monthly actuals in the ledger's sign: money out positive, income negative. */
  actuals: number[];
}

export interface Moment {
  /** 0-based month in progress. */
  month: number;
  categories: CategoryState[];
}

export interface CategoryMove {
  name: string;
  budget: number;
  past: number;
  spending: number;
  closed: number;
  total: number;
}

export interface YearEndMove {
  total: number;
  budget: number;
  past: number;
  spending: number;
  closed: number;
  /** Every category that moved, largest absolute move first. */
  categories: CategoryMove[];
}

const ZEROS = Array<number>(MONTHS_PER_YEAR).fill(0);
const cents = (n: number) => Math.round(n * 100) / 100;

/** One category's contribution to the year-end P/L — `./yearEnd`'s rule, signed as P/L. */
export function contribution(plan: readonly number[], actuals: readonly number[], isIncome: boolean, month: number): number {
  const sign = isIncome ? -1 : 1;
  let projected = 0;
  for (let i = 0; i < MONTHS_PER_YEAR; i++) {
    if (i < month) projected += sign * actuals[i];
    else if (i === month) projected += Math.max(sign * actuals[i], plan[i]);
    else projected += plan[i];
  }
  return isIncome ? projected : -projected;
}

/** The move from `a` to `b`, split into its four parts. Same year assumed; the caller checks. */
export function decompose(a: Moment, b: Moment): YearEndMove {
  const names = new Set([...a.categories.map((c) => c.name), ...b.categories.map((c) => c.name)]);
  const byName = (m: Moment) => new Map(m.categories.map((c) => [c.name, c]));
  const A = byName(a), B = byName(b);

  const categories: CategoryMove[] = [];
  for (const name of names) {
    // A category that exists at one moment only is all plan and no actuals at the other: its
    // appearing or vanishing is a budget edit, not spending.
    const ca = A.get(name), cb = B.get(name);
    const isIncome = (cb ?? ca)!.isIncome;
    const planA = ca?.plan ?? ZEROS, actA = ca?.actuals ?? ZEROS;
    const planB = cb?.plan ?? ZEROS, actB = cb?.actuals ?? ZEROS;
    const pastB = actA.map((v, i) => (i < a.month ? actB[i] : v));

    const s0 = contribution(planA, actA, isIncome, a.month);
    const s1 = contribution(planB, actA, isIncome, a.month);
    const s2 = contribution(planB, pastB, isIncome, a.month);
    const s3 = contribution(planB, actB, isIncome, a.month);
    const s4 = contribution(planB, actB, isIncome, b.month);
    const budget = cents(s1 - s0), past = cents(s2 - s1), spending = cents(s3 - s2), closed = cents(s4 - s3);
    // The total is the parts' sum, so a cent of rounding can never open a gap between them.
    const move = { name, budget, past, spending, closed, total: cents(budget + past + spending + closed) };
    if (move.budget || move.past || move.spending || move.closed) categories.push(move);
  }
  categories.sort((x, y) => Math.abs(y.total) - Math.abs(x.total) || x.name.localeCompare(y.name));
  const sum = (k: 'budget' | 'past' | 'spending' | 'closed' | 'total') => cents(categories.reduce((s, c) => s + c[k], 0));
  return { total: sum('total'), budget: sum('budget'), past: sum('past'), spending: sum('spending'), closed: sum('closed'), categories };
}

export interface HoldStreak {
  /** Whole days since the last slip — or since tracking began, when there has been none. */
  days: number;
  /** The day the streak counts from, `YYYY-MM-DD`. */
  since: string;
  /** True when no slip appears anywhere in the snapshots read: the streak is as old as the data. */
  sinceTracking: boolean;
  /** True when today's own spending has already moved the year-end down. */
  slippedToday: boolean;
}

/**
 * Days in a row the year-end P/L has not slipped — for the dashboard, rewarding restraint as it
 * happens rather than at month end.
 *
 * ONLY SPENDING BREAKS IT. A month closing, a budget edit, a late transaction: each moves the
 * projection, and none is the owner's restraint failing, so a streak broken by them would punish
 * the wrong thing — on the 1st of every month, on schedule. A day that holds level continues it:
 * holding the line is the behaviour being rewarded. A slip is a spending move of a dollar or more,
 * so a rounding cent breaks nothing.
 *
 * `points` are the morning snapshots in date order with the live state last, dated today; each
 * neighbouring pair is one stretch of days (several, if a morning was missed). Null with fewer than
 * two points: there is nothing to compare yet.
 */
export function holdStreak(points: readonly { date: string; moment: Moment }[], today: string): HoldStreak | null {
  if (points.length < 2) return null;
  const day = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
  let start = 0;
  let slippedToday = false;
  for (let i = points.length - 1; i >= 1; i--) {
    if (decompose(points[i - 1].moment, points[i].moment).spending <= -1) {
      start = i;
      slippedToday = i === points.length - 1;
      break;
    }
  }
  const since = points[start].date;
  return { days: Math.max(0, day(today) - day(since)), since, sinceTracking: start === 0, slippedToday };
}
