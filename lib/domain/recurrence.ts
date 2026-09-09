// Which of a category's charges are a SUBSCRIPTION rather than a decision, and therefore must not
// be pro-rated when `./pacing` projects where its month closes.
//
// The defect this exists to close: `Sport` drew $265 on 3 September, its whole month's spend by
// day 8 of 30, and the run rate divided it by the elapsed fraction and projected $993.75. Every
// step of that arithmetic is right and the answer is nonsense, because the $265 is one gym
// membership that bills monthly. It cannot recur four more times before the 30th. The projection
// assumed spend is UNIFORM WITHIN THE MONTH — an assumption `./pacing` states out loud and a
// monthly debit violates completely — and the symptom was a category reported at 398% of budget
// when it was heading for 106%.
//
// The fix is not to stop projecting. `Sport` also holds REI and Sports Basement purchases, which
// are genuinely elective and genuinely do recur within a month, so a per-category "do not
// pro-rate" switch would be wrong in one direction or the other whichever way it was set. The fix
// is to SPLIT THE MONTH'S SPEND: the recurring dollars are carried at face value and only the
// remainder is pro-rated.
//
//   projected = recurring expected this month + (spend to date − recurring already posted) / elapsed
//
// What this module is NOT:
//
//   - It is not a classifier of merchants. It says nothing about what a merchant IS; it reports a
//     CADENCE observed in one category's own history, and a series that stops recurring stops
//     being reported the month after. `YMCA SILICON VALLEY-AO DR` billed $41 every month from
//     February to June and then stopped; in September it is not a recurring charge, and no amount
//     of it having been one earlier makes next month owe it.
//   - It is not a forecaster of amounts. The figure it carries forward for an unposted month is an
//     OBSERVED amount — the most recent qualifying charge — never a trend, an average with a drift
//     term, or an inflation guess.
//   - It is not an aggregator. It divides nothing and sums only within a category, so it emits no
//     figure that could disagree with `./pacing` about a month at the fifth decimal.
//   - It is not tolerant of a partial month masquerading as a whole one. The as-of month is
//     ALWAYS incomplete, and its absence of a charge is never evidence that a series ended — see
//     `isActive` for why the activity test reaches back one month and no further.

import { roundCents } from '../budgetMath';
import { type AsOf } from './pacing';

/**
 * How many consecutive monthly occurrences a series needs before its charges stop being pro-rated.
 *
 * A POLICY CONSTANT, and three is the smallest number that can mean anything. Two consecutive
 * months of the same merchant at the same price is the shape of a subscription AND the shape of
 * two haircuts; three is the first count at which "once a month, every month" is a pattern rather
 * than a coincidence, and it is the number every consumer subscription-detection heuristic
 * converges on for the same reason.
 *
 * The cost of setting it higher is real and asymmetric: a genuine subscription in its third month
 * would be pro-rated for another month or two, which is precisely the failure this module exists
 * to fix, only later. The cost of setting it at two is a category whose projection stops adapting
 * to a merchant the owner visits monthly by habit but electively — a gym they might quit is still
 * a decision, a gym contract is not, and two points cannot tell those apart.
 */
export const RECURRENCE_MIN_MONTHS = 3;

/**
 * How far back the evidence window reaches, in COMPLETED months before the as-of month.
 *
 * Six, so that a price change earlier in the year cannot disqualify a series that has been stable
 * since. `CLUB SPORT @ THE PLEX` billed $130 through March and $260–265 from April; a window wide
 * enough to hold both prices and a stability test applied across the whole of it would read that
 * series as unstable and pro-rate it — punishing the owner for a gym raising its rates.
 *
 * The stability test is therefore applied to the QUALIFYING MONTHS ONLY (the most recent
 * `RECURRENCE_MIN_MONTHS`), and the window's job is narrower: it bounds how much history the
 * caller has to read, and it bounds `typicalDay` and nothing else.
 */
export const RECURRENCE_LOOKBACK_MONTHS = 6;

/**
 * How far a charge may sit from the series' median and still be read as one of its instalments.
 *
 * A quarter, which is wide enough to hold the ordinary movement of a real subscription — a usage
 * tier, a tax change, an annual increase — and narrow enough that a merchant visited monthly at
 * $20, $95 and $240 is not mistaken for one. It is a fraction OF THE MEDIAN and it is symmetric:
 * an unusually small month disqualifies a series exactly as an unusually large one does, because
 * both are evidence that the amount is a choice.
 *
 * It defines a BAND rather than a pass/fail on a monthly total, and the band is what the
 * once-a-month test below is stated in terms of — see `qualify`.
 */
export const RECURRENCE_AMOUNT_TOLERANCE = 0.25;

/**
 * One posted charge, as the caller's window query produced it.
 *
 * The caller aggregates nothing here and classifies nothing — it reads rows and this module
 * decides what they mean, the same split `CoverageGroup` takes and for the same reason: a cadence
 * rule expressed in SQL is a rule beyond the reach of every test in this repo.
 */
export interface RecurrenceTxn {
  /** `transactions.mapped_category`, verbatim. Series never span categories. */
  category: string;
  /**
   * The merchant label to group a series by, RAW. Normalised by `seriesKey` here and never by the
   * caller, so the SQL cannot hold half of the identity rule.
   */
  label: string;
  /** Calendar month index, 0 = January — the domain folder's one indexing convention. */
  month: number;
  /** 1-based day of the month, as a calendar day is. */
  day: number;
  /**
   * A NON-NEGATIVE MAGNITUDE, from positive-amount rows only — the identical population
   * `MonthSpend.actual` is summed over. If these two were drawn from different rows, `posted`
   * could exceed the month's actual and the pro-rated remainder would go negative, which reads as
   * a category projecting to spend less than it already has.
   */
  amount: number;
}

/** One merchant charging one category on a monthly cadence, as of the stated day. */
export interface RecurringSeries {
  /** The normalised key the series was grouped under — `seriesKey` of the raw labels. */
  key: string;
  /** The most recent raw label, kept for display. Normalisation is not a name a person recognises. */
  label: string;
  /** This month's charge if it has already posted; `null` while it is still expected. */
  posted: number | null;
  /**
   * What this month owes the series: `posted` once it has arrived, and the most recent qualifying
   * charge before then.
   *
   * The unposted case is the whole reason a projection is a forecast rather than a lagging total.
   * On day 2, before the gym bills on the 3rd, a projection that omitted the charge would report a
   * month heading for $0 and then lurch by $265 overnight — a figure that moves for reasons the
   * owner did not cause.
   */
  expected: number;
  /** The median day the series lands on, over the window. Never a prediction, just where it sits. */
  typicalDay: number;
  /** How many consecutive months of evidence the series qualified on. At least `RECURRENCE_MIN_MONTHS`. */
  monthsObserved: number;
}

/** One category's recurring charges for the as-of month, and the two totals `./pacing` needs. */
export interface CategoryRecurrence {
  category: string;
  /** Ordered by `expected` descending, then key — a total order, so the list never reshuffles. */
  series: RecurringSeries[];
  /**
   * Sum of `posted`. The part of the as-of month's actual that must be held out of the run rate,
   * because it has already happened and will not happen again this month.
   */
  posted: number;
  /** Sum of `expected`. What the month owes these series whether or not they have landed yet. */
  expected: number;
}

/**
 * A merchant label reduced to the identity a series is grouped under.
 *
 * Uppercased, stripped of runs of four or more digits, and reduced to single-spaced alphanumerics.
 * Each of those three does one job:
 *
 *   - CASE. The same merchant arrives as `LEVY@ SFBA STADIUM` and `LEVY@ SFBA Stadium` in one
 *     week of this ledger. Case is noise from the bank, never identity.
 *   - LONG DIGIT RUNS. A reference number embedded in a descriptor makes every charge unique and
 *     no series can ever form: `AMZ_STORECRD_PMT PAYMENT 604578105643191 WEB ID: 9130142001` is
 *     one merchant wearing a different name every month. Four is the threshold because shorter
 *     runs are part of the name — `AMC 0433 SARATOGA 14`, `REI #22 SARATOGA` — and merging those
 *     would fuse two branches of one chain into a series neither of them has.
 *   - PUNCTUATION AND SPACING. `REI.COM  800-426-4840` and `REI.COM 800-426-4840` differ by a
 *     space this app did not put there.
 *
 * It is deliberately CONSERVATIVE. Two labels that are really one merchant and survive as two keys
 * cost a series that never forms, and the projection stays as it is today. Two merchants collapsed
 * into one key cost a series that should not exist, whose charges then stop being pro-rated — a
 * silent understatement of where a month is heading, which is the direction that loses money.
 */
export function seriesKey(label: string): string {
  return label
    .toUpperCase()
    .replace(/\d{4,}/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** The middle value, or the lower of the two middles. Never an average: an average of two real charges is a charge nobody made. */
function median(sorted: number[]): number {
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * The window's months, as absolute indices from the as-of month backwards.
 *
 * Expressed as an offset from the as-of month rather than as a calendar range, because the window
 * crosses a year boundary for any as-of point before July and this module holds a 0-11 month index
 * with no year attached. The caller's query bounds the dates; this bounds nothing and is used only
 * to reject a row the caller sent that the window does not cover.
 */
function inWindow(month: number, asOf: AsOf): boolean {
  const back = (asOf.month - month + 12) % 12;
  return back <= RECURRENCE_LOOKBACK_MONTHS;
}

/**
 * Whether a series is still running, as of the stated day.
 *
 * The test reaches back EXACTLY ONE MONTH and no further, and both halves of that are load-bearing:
 *
 *   - It must reach back one month, because the as-of month is always incomplete. On day 2 the gym
 *     has not billed yet, and requiring a charge in the as-of month would call every subscription
 *     dead for the first days of every month — turning the projection off precisely when the
 *     recurring share of the month is at its largest.
 *   - It must not reach back two, because a cancelled subscription would then keep inflating the
 *     projection for a further month. `YMCA SILICON VALLEY-AO DR` last billed in June; in
 *     September it is not owed, and a two-month reach would still be adding $41 in July.
 */
function isActive(latestMonth: number, asOf: AsOf): boolean {
  const back = (asOf.month - latestMonth + 12) % 12;
  return back <= 1;
}

/**
 * The qualifying charges of one series, or `null` if the series does not qualify.
 *
 * Qualification is four tests, applied in this order because each is cheaper than the next and
 * each makes the next meaningful:
 *
 *   1. ENOUGH MONTHS. Fewer than `RECURRENCE_MIN_MONTHS` distinct months of evidence is not a
 *      cadence.
 *   2. STILL RUNNING. See `isActive`.
 *   3. CONSECUTIVE. The most recent `RECURRENCE_MIN_MONTHS` occurrence months must be adjacent.
 *      `REI #22 SARATOGA` charged in February, March and August — three months, still active, and
 *      not a subscription. Gaps are the difference between a bill and a habit.
 *   4. ONCE A MONTH, AT ONE PRICE. In each qualifying month, EXACTLY ONE charge falls inside the
 *      band `RECURRENCE_AMOUNT_TOLERANCE` wide around the median of every charge in those months.
 *
 * The fourth test is the one that separates a bill from a habit, and it is stated as a count rather
 * than as a spread because a spread cannot. A subscription is charged once per period at a settled
 * price; a shop the owner likes is charged whenever they go. On this ledger `Trader Joe's` posts
 * five or six times a month between $12 and $124, `Costco` twice, and `Lyft` two to four times —
 * every one of them lands three consecutive active months with a median their charges cluster
 * around, and a test on the monthly total or on a representative alone admits all three. Requiring
 * the instalment to be UNIQUE inside its month rejects them, because a merchant with two charges in
 * the band has no instalment, only a habit.
 *
 * It also keeps the case it has to keep: a month can hold both the subscription and a one-off from
 * the same merchant. `CLUB SPORT @ THE PLEX` billed $130 on 1 March and took $49 more on the 18th,
 * and the $49 is far outside the band, so the month still has exactly one instalment and the $49
 * stays in the elective remainder where a one-off belongs.
 *
 * The direction of the remaining error is deliberate. A series that fails to form leaves the
 * projection exactly as it was, which is the behaviour this module was added to improve on; a
 * series that forms wrongly stops real dollars being pro-rated and understates where a month is
 * heading. Only one of those two loses money, so every test above is written to fail closed.
 */
function qualify(charges: RecurrenceTxn[], asOf: AsOf): RecurringSeries | null {
  const byMonth = new Map<number, RecurrenceTxn[]>();
  for (const c of charges) {
    if (!inWindow(c.month, asOf)) continue;
    const bucket = byMonth.get(c.month);
    if (bucket) bucket.push(c);
    else byMonth.set(c.month, [c]);
  }

  // Ordered by how recent they are, so "the most recent three" is a slice rather than a search.
  // Sorting on the offset from the as-of month rather than on the raw index is what makes a window
  // spanning December and January order correctly.
  const months = [...byMonth.keys()].sort(
    (a, b) => ((asOf.month - a + 12) % 12) - ((asOf.month - b + 12) % 12),
  );
  if (months.length < RECURRENCE_MIN_MONTHS) return null;

  const latest = months[0];
  if (!isActive(latest, asOf)) return null;

  const qualifying = months.slice(0, RECURRENCE_MIN_MONTHS);
  for (let i = 1; i < qualifying.length; i++) {
    if ((qualifying[i - 1] - qualifying[i] + 12) % 12 !== 1) return null;
  }

  const pool = qualifying.flatMap((m) => byMonth.get(m)!.map((c) => c.amount));
  const mid = median([...pool].sort((a, b) => a - b));
  // A zero median cannot be a proportion's denominator, and a series of $0 charges is not spend.
  if (mid <= 0) return null;

  const representatives: RecurrenceTxn[] = [];
  for (const m of qualifying) {
    const inBand = byMonth.get(m)!.filter((c) => Math.abs(c.amount - mid) / mid <= RECURRENCE_AMOUNT_TOLERANCE);
    if (inBand.length !== 1) return null;
    representatives.push(inBand[0]);
  }

  // `posted` is the as-of month's own representative and NOT the latest one: on day 2 the latest
  // qualifying month is the month before, and reporting its charge as posted would tell the caller
  // that dollars already in `actual` are dollars that are not.
  const posted = qualifying[0] === asOf.month ? representatives[0].amount : null;
  const days = representatives.map((r) => r.day).sort((a, b) => a - b);

  return {
    key: seriesKey(charges[0].label),
    label: representatives[0].label,
    posted,
    expected: posted ?? representatives[0].amount,
    typicalDay: median(days),
    monthsObserved: qualifying.length,
  };
}

/**
 * Every category's recurring charges for the as-of month, keyed by category name.
 *
 * A category with no qualifying series is ABSENT from the map rather than present with zeroes, so
 * `./pacing` reaching for a missing entry and a `./pacing` that was never given a map take the
 * same branch and produce the identical projection this module did not exist to change.
 */
export function detectRecurring(txns: RecurrenceTxn[], asOf: AsOf): Map<string, CategoryRecurrence> {
  const grouped = new Map<string, Map<string, RecurrenceTxn[]>>();
  for (const t of txns) {
    // Non-positive rows are refunds and reversals. They are excluded rather than netted, matching
    // `getMonthlyActuals`, which nets nothing — a refund netted into a series' amount reads as a
    // price change and can push a stable subscription outside the tolerance.
    if (!(t.amount > 0)) continue;
    let series = grouped.get(t.category);
    if (!series) grouped.set(t.category, (series = new Map()));
    const key = seriesKey(t.label);
    const bucket = series.get(key);
    if (bucket) bucket.push(t);
    else series.set(key, [t]);
  }

  const out = new Map<string, CategoryRecurrence>();
  for (const [category, series] of grouped) {
    const qualified: RecurringSeries[] = [];
    for (const charges of series.values()) {
      const found = qualify(charges, asOf);
      if (found !== null) qualified.push(found);
    }
    if (qualified.length === 0) continue;

    qualified.sort((a, b) => (b.expected - a.expected) || a.key.localeCompare(b.key));
    out.set(category, {
      category,
      series: qualified,
      // Rounded once, at the sum, for the same reason every other money figure in this folder is:
      // an unrounded total subtracted from a cent-rounded actual leaves a fifteenth-decimal
      // remainder that the run rate then multiplies by up to four.
      posted: roundCents(qualified.reduce((sum, s) => sum + (s.posted ?? 0), 0)),
      expected: roundCents(qualified.reduce((sum, s) => sum + s.expected, 0)),
    });
  }
  return out;
}
