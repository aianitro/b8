// The SHAPE of a category's month, not just its total.
//
// Two categories can sit at 90% of budget on day 11 and need opposite responses. One spent it all
// on the 2nd and has been quiet since; the other is drifting up a little every day and will be
// well over by the 30th. A percentage cannot tell them apart, a projection barely can, and the
// list on the dashboard renders them identically.
//
// Pure: cumulative series in, shape out. No clock, no database.

export type MonthShapeKind =
  /** The money landed earlier in the month and little has moved since. */
  | 'front-loaded'
  /** Spend is accumulating at a roughly even rate. */
  | 'steady'
  /** The most recent days are the busy ones — the pattern a projection understates. */
  | 'accelerating'
  /** Refunds outweigh spending this month; the category is net negative. */
  | 'refunded'
  /** Not enough elapsed month, or nothing spent, to claim a shape. */
  | 'too-early';

export interface MonthShape {
  /** Cumulative spend at the end of each elapsed day, index 0 = day 1. */
  cumulative: number[];
  /** The straight-line plan over the WHOLE month, for the same days. */
  plan: number[];
  kind: MonthShapeKind;
  /** Share of this month's spend that landed in the most recent third of the elapsed days. */
  recentShare: number | null;
}

/** Below this many elapsed days, no shape is claimed — two days of data is not a pattern. */
export const MIN_DAYS_FOR_SHAPE = 6;

// The question the shape has to answer is "is this still running", not "was it busy at some
// point". An even month puts a third of its spend in the most recent third of elapsed days, so
// that is the yardstick both thresholds sit either side of.
//
// Splitting the elapsed days in half — the first attempt — cannot see a mid-month burst. Entertainment
// spent on days 6 and 7 of 11 and nothing since; with a halfway split every one of those dollars
// fell in the back half and the category was reported as "picking up" while it had in fact been
// quiet for four days. Read from the recent end instead and the same data says what it should.

/** At or above this share in the most recent third, the category is running hot now. */
export const ACCELERATING_AT_OR_ABOVE = 0.5;

/** At or below this share, the money landed earlier and little has moved since. */
export const FRONT_LOADED_AT_OR_BELOW = 0.1;

/**
 * @param daily  Spend per day, index 0 = day 1 of the month. Length is the elapsed day count.
 * @param budget The category's allocation for the whole month.
 * @param daysInMonth Real length of this month, so the plan line ends where the month does.
 */
export function monthShape(daily: number[], budget: number, daysInMonth: number): MonthShape {
  if (!Number.isInteger(daysInMonth) || daysInMonth < 28 || daysInMonth > 31) {
    throw new RangeError(`monthShape: daysInMonth must be 28-31, got ${daysInMonth}`);
  }
  const cumulative: number[] = [];
  let running = 0;
  for (const d of daily) {
    running += d;
    cumulative.push(running);
  }
  // The plan is drawn across the whole month, not across the elapsed part: the reader is comparing
  // where they are against where the month was always going to end, and a plan line rescaled to
  // today would always meet the actual line at the right edge and say nothing.
  const plan = daily.map((_, i) => (budget * (i + 1)) / daysInMonth);

  const total = running;
  // Net negative is its own state, not an absence of one. A month where returns outran purchases
  // has a shape — it just is not a spending shape, and every ratio below would divide by a
  // negative and invert. Reported rather than swept into `too-early`, which would say the month
  // could not be read when in fact it read clearly and came out the other way.
  if (total < 0) return { cumulative, plan, kind: 'refunded', recentShare: null };
  if (daily.length < MIN_DAYS_FOR_SHAPE || total === 0) {
    return { cumulative, plan, kind: 'too-early', recentShare: null };
  }

  // Measured on ELAPSED days, not the calendar month: on day 11 the question is how the last 11
  // days were shaped, and thirding the month would compare real data against 19 days of nothing.
  const recentFrom = daily.length - Math.max(1, Math.round(daily.length / 3));
  const recent = daily.slice(recentFrom).reduce((s, n) => s + n, 0);
  const recentShare = recent / total;

  const kind: MonthShapeKind =
    recentShare >= ACCELERATING_AT_OR_ABOVE ? 'accelerating'
    : recentShare <= FRONT_LOADED_AT_OR_BELOW ? 'front-loaded'
    : 'steady';

  return { cumulative, plan, kind, recentShare };
}

/** How the shape reads in a sentence fragment, for a caption under a sparkline. */
export function shapeLabel(kind: MonthShapeKind): string {
  switch (kind) {
    case 'front-loaded': return 'quiet lately';
    case 'accelerating': return 'picking up';
    case 'steady': return 'steady';
    case 'refunded': return 'net refund this month';
    case 'too-early': return 'nothing spent yet';
  }
}
