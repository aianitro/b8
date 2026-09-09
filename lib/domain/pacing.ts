// In-the-moment pacing (ROADMAP.md §5 step 30 / P0.5-30): where a category's month is projected
// to CLOSE, as of a stated day, with the assumption that projection carries said out loud.
//
// The sibling module next door answers "what happened" over months the caller supplied. This one
// answers "where is this month heading", which is a strictly harder question because it needs a
// second input nothing else in `lib/domain/` needs: an as-of point. That point arrives as three
// plain integers and never as a clock read — see `AsOf` below for why the parameter exists at all
// and why it is not a `Date`.
//
// What this module is NOT:
//
//   - It is not a renderer. Step 31 re-points the dashboard and is the first consumer of this
//     output; nothing under `app/` is touched here. A `fixed` mortgage line projecting to close
//     140% over is a true fact, and whether a surface prints it is a rendering judgement.
//   - It is not an aggregate. There is no headline, no rollup, no total. Summing a month-scale
//     projection with anything else is the scale-mixing defect P0.5-29a exists to have closed,
//     and a projection multiplier attached to it would make that defect worse rather than new.
//   - It is not a second even-spread implementation. `budgetedForMonth` is IMPORTED from
//     `./adherence`, which is why that function stopped being private. A sixth copy of
//     `annual_budget` divided evenly would drift from the fifth on its rounding, and the symptom
//     would be two modules over one array disagreeing at the fifth decimal.
//   - It is not a colour scale, and it deliberately does not reach for the per-cell one. That
//     module's `monthPct` answers Infinity for exactly the off-cycle month this one answers
//     `null` for, and a non-finite number has no business inside a projection.

import { MONTHS_PER_YEAR, roundCents } from '../budgetMath';
import type { AdherenceInput, MonthSpend } from './adherence';
import { budgetedForMonth, isScoredCategory, isTrackedCategory, withoutNegativeZero } from './adherence';
// Imported for its TYPE only, and the direction of that dependency is deliberate: `./recurrence`
// imports `AsOf` from here and nothing else, so the cycle is a type-level one that erases at
// compile time. The cadence policy lives there, entirely, and this module consults its answer.
import type { CategoryRecurrence } from './recurrence';

/**
 * The as-of point: a calendar day, stated as three plain integers, with no instant and therefore
 * no timezone.
 *
 * `month` is 0-based (0 = January), matching `MonthSpend.month` and the `monthly_amounts` index —
 * one indexing convention across the whole domain folder, never two. `day` is 1-based, as a
 * calendar day is.
 *
 * Three rejected alternatives, recorded because each looks simpler until it is used:
 *
 *   - A bare elapsed fraction. It cannot say which month it is a fraction OF, and this module must
 *     decide, per supplied month, whether that month is before, inside, or after the as-of point.
 *     A fraction-per-month pushes the calendar arithmetic back to the caller, which is moving it
 *     rather than removing it.
 *   - A `Date`. `getMonth()` is local-time, so a test writing a bare ISO date gets UTC midnight —
 *     which is the previous day in every negative-offset zone. That is a suite meaning one thing
 *     in CI and another on a laptop in Los Angeles, and this suite claims determinism.
 *   - A caller-supplied month length. It admits an internally inconsistent as-of point — day 31 of
 *     a 30-day month, February 29 of a non-leap year — that no validation on the caller's side is
 *     forced to catch. Deriving the length here makes that pair unrepresentable-wrong.
 *
 * `year` is required solely because February's length depends on it. `AdherenceInput` carries no
 * year: the caller assembles one implicit calendar year of months, and `asOf.year` is that year.
 * This module cannot verify that claim, so it is stated as a caller-contract precondition — in the
 * same class as the duplicate-month and string-NUMERIC debts the sibling module already carries.
 */
export interface AsOf {
  year: number;
  month: number;
  day: number;
}

/**
 * Which of the six mutually exclusive things a record is saying. Precedence is total and ordered —
 * `off-cycle` → `no-budget` → `future` → `complete` → `too-early` → `projected` — so no record can
 * qualify for two, and the money-shaped statements sit ahead of the calendar-shaped ones because
 * off-cycle spend is true regardless of where its month sits relative to today.
 *
 *   - `off-cycle`  — a scheduled category drew money in a month its schedule budgeted nothing for.
 *                    A breach in its own right, and reported as a dollar figure with NO percentage.
 *   - `no-budget`  — nothing was budgeted and the off-cycle test failed: no schedule at all, or a
 *                    schedule with no spend that month. A different statement, deliberately a
 *                    different word: the per-cell colour module already draws this line and the
 *                    adherence detector structurally cannot.
 *   - `future`     — the month begins after the as-of point. No elapsed fraction, no projection.
 *   - `complete`   — the month ended before the as-of point. Fully elapsed, so its projection is
 *                    its actual by arithmetic rather than by special case.
 *   - `too-early`  — the as-of month, with less than `PROJECTION_MIN_ELAPSED` of it gone. Spend to
 *                    date is fully reported; only the projection is withheld.
 *   - `projected`  — the as-of month, far enough in to project from.
 */
export type PaceStatus = 'off-cycle' | 'no-budget' | 'future' | 'complete' | 'too-early' | 'projected';

/**
 * Below this fraction of a month elapsed, no projection is emitted at all.
 *
 * A stated threshold rather than an emergent one, in the same style as the sibling module's
 * chronic-underspend constants. The projection is spend-to-date divided by the elapsed fraction,
 * and that arithmetic assumes spend is UNIFORM WITHIN THE MONTH — an assumption `monthly_amounts`
 * does not underwrite, because a schedule constrains a month's total and says nothing about its
 * curve. Early in a month the multiplier is enormous and the assumption is at its least true: on
 * day 1 of a 30-day month a single dinner projects a $10,650 April. That is a plausible number
 * pointing confidently the wrong way, which is the exact failure class this domain folder has
 * already paid for once.
 *
 * A quarter of the month is the line, and it is calibrated against §5's own worked example: day 8
 * of a 30-day month is 0.2666… and MUST project, because the roadmap says it does; day 7 of 30 is
 * 0.2333… and must not. In words: roughly the first week of a month is not enough to project from
 * — a claim a reviewer can argue with, rather than a number nobody chose.
 *
 * The comparison is `>=`, INCLUSIVE. Day 7 of a 28-day February is exactly 0.25 and projects; a `>`
 * would withhold it, and that one input is the only place in the suite the two differ.
 */
export const PROJECTION_MIN_ELAPSED = 0.25;

/**
 * One tracked category's one supplied month, resolved into a projected month-end position and the
 * elapsed basis that position was computed from.
 *
 * The elapsed fields are not decoration. A projection with no day attached is the sentence §5 asks
 * for with its qualifier removed, and a renderer that has `elapsedDays` and `daysInMonth` in hand
 * has no excuse for printing "projected to close 266% over" without "as of day 8 of 30". They are
 * facts about TIME, so they are reported for every status — including the two that emit no money
 * projection at all.
 */
export interface CategoryPace {
  categoryId: number;
  category: string;
  /**
   * `isScoredCategory` on the row — a flag, never a filter, exactly as the sibling detector's
   * findings carry it. A caller wanting §5's discretionary-only set writes `.filter(p => p.scored)`
   * and owns that narrowing; a module that narrowed first would be blind to the categories where a
   * wrong budget line is most expensive.
   */
  scored: boolean;
  /** Calendar month index, 0 = January — the caller's own `MonthSpend.month`, never invented. */
  month: number;
  /** 0 for a future month, `asOf.day` for the as-of month, the whole month for a finished one. */
  elapsedDays: number;
  /** The real length of THIS record's month in `asOf.year`, by the Gregorian rule. */
  daysInMonth: number;
  /** `elapsedDays / daysInMonth`, in [0, 1]. A ratio, not money, and therefore not rounded. */
  elapsedFraction: number;
  /** The imported `budgetedForMonth`: a full-length schedule wins per month, else the even spread. */
  budgeted: number;
  /** Cent-rounded non-negative magnitude, as `MonthSpend.actual` is defined to arrive. */
  actual: number;
  /** `actual / budgeted`, or null when `budgeted <= 0`. Never 0, NaN, a non-finite value, or `-0`. */
  spentRatio: number | null;
  /** `roundCents(actual / elapsedFraction)` — money, and rounded. Null unless the status projects. */
  projected: number | null;
  /**
   * `projected − budgeted`, always in that order, computed from the already-rounded projection and
   * re-rounded.
   *
   * NEGATIVE IS UNDER BUDGET, positive is over — the identical convention `MonthVariance.variance`
   * and `ScoredHeadline.variance` state, never a second one. Reversing the subtraction still
   * produces a plausible dollar figure, and the only symptom is that thrift reads as overspending.
   */
  projectedVariance: number | null;
  /**
   * `projected / budgeted`, or null when `budgeted <= 0`. Unrounded, and a FRACTION OF BUDGET: 2.6625
   * reads "266.25% of budget", i.e. 166.25% over. A renderer that wants "over" subtracts one and
   * owns that. This module never emits `Math.abs`, never `budgeted − projected`, and never the
   * reciprocal.
   */
  projectedRatio: number | null;
  /**
   * The recurring dollars this month owes, held OUT of the run rate — `CategoryRecurrence.expected`
   * for this category, or `null` where no series was supplied or the month does not project.
   *
   * Non-null is the signal that this record's projection is a split one rather than a bare
   * division, and a renderer that wants to say so reads this rather than re-deriving it.
   */
  recurringExpected: number | null;
  /** The part of `actual` those series have already posted. Never greater than `actual`. */
  recurringPosted: number | null;
  status: PaceStatus;
}

/**
 * The length of each month, January first, with February's non-leap length.
 *
 * A table rather than a calendar call, because the obvious calendar trick for month length is a
 * clock read: it constructs a local-time date and asks for its day, which is both timezone-fragile
 * and forbidden here. A table cannot be tested in 2100 by accident either — it is arithmetic, so a
 * test can pin it at any year.
 */
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** February's extra day, by the full Gregorian rule — not `year % 4`, which gets 2100 wrong. */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * How many days that month has, in that year.
 *
 * Exported because it is the one piece of calendar arithmetic a caller may legitimately need to
 * agree with this module about — step 31 formatting "day 8 of 30" is the first such caller — and a
 * second copy of the leap rule is exactly the drifting-definitions hazard this folder exists to
 * avoid. Throws rather than returning a plausible length for a month that does not exist: there is
 * no thirteenth month to take the length of, and every wrong answer here silently rescales a
 * projection.
 */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year)) {
    throw new RangeError(`daysInMonth: year must be an integer, got ${year}`);
  }
  if (!Number.isInteger(month) || month < 0 || month >= MONTHS_PER_YEAR) {
    throw new RangeError(`daysInMonth: month must be an integer 0-11 (0 = January), got ${month}`);
  }
  return month === 1 && isLeapYear(year) ? 29 : MONTH_LENGTHS[month];
}

/**
 * Rejects an as-of point that is not a real day.
 *
 * Loud rather than resolved, because there is no day to be a fraction of: day 0 would give an
 * elapsed fraction of zero and a division that produces a non-finite projection, and day 31 of
 * April would give a fraction above one and a projection BELOW spend-to-date. A validator checking
 * only `1 <= day <= 31` admits April 31 and February 29 of a non-leap year, which is why the bound
 * is the month's own length.
 */
function assertRealAsOf(asOf: AsOf): void {
  // `daysInMonth` validates the year and the month, and it is the only thing that knows how long
  // this month is — so the day bound is derived from it rather than restated beside it.
  const length = daysInMonth(asOf.year, asOf.month);
  if (!Number.isInteger(asOf.day) || asOf.day < 1 || asOf.day > length) {
    throw new RangeError(
      `categoryPacing: as-of day must be an integer 1-${length} for month ${asOf.month} of ${asOf.year}, got ${asOf.day}`,
    );
  }
}

/**
 * One supplied month of one tracked category, as of the given day.
 *
 * The three elapsed cases are stated as one expression rather than three branches with three
 * projections, so a finished month's projection can never disagree with its own arithmetic: it is
 * `actual / 1` because its fraction IS one, not because a special case says so.
 */
function paceForMonth(
  row: AdherenceInput,
  spend: MonthSpend,
  asOf: AsOf,
  scored: boolean,
  recurrence: CategoryRecurrence | undefined,
): CategoryPace {
  const month = spend.month;
  // Deliberately louder than the sibling module, which for the same input silently substitutes the
  // even spread — a December-only category handed a 1-indexed month reads there as a $1,050 breach
  // at 1150%. That substitution is plausible and therefore worse, and pacing cannot fail soft the
  // same way in any case: there is no month here to take a length of. The divergence between the
  // two functions is real and is recorded as a hazard rather than smoothed over; a caller feeding
  // both should normalise the index upstream of them.
  const length = daysInMonth(asOf.year, month);

  const elapsedDays = month > asOf.month ? 0 : month < asOf.month ? length : asOf.day;
  // Day-granular, with the as-of day counted COMPLETE. `MonthSpend.actual` is spend through the end
  // of that day — transactions carry dates, not times — so the numerator includes all of day d and
  // the denominator must too. It also means the as-of month's fraction is never zero (the smallest
  // reachable value is one thirty-first), which makes a divide-by-zero structurally unreachable in
  // that branch rather than guarded after the fact. `(day - 1) / length` would divide a full day of
  // spend by zero on day 1.
  //
  // This is NOT the incumbent dashboard's convention, which counts the current month as fully
  // elapsed and so flatters the pace. Inheriting it would make every projection equal to
  // spend-to-date, which is precisely the figure §5 says is not enough.
  const elapsedFraction = elapsedDays / length;

  const budgeted = budgetedForMonth(row, month);
  // Kept un-normalised on purpose: `roundCents(-0.001)` is `-0`, and it propagates through every
  // division below. Normalising here instead would make the four normalisations at the emission
  // points no-ops — assertions that pass whatever the code does, which is not a guard.
  const actual = roundCents(spend.actual);

  const schedule = row.monthly_amounts;
  const scheduled = schedule !== null && schedule.length === MONTHS_PER_YEAR;

  const status: PaceStatus =
    scheduled && budgeted === 0 && actual > 0
      ? 'off-cycle'
      : budgeted === 0
        ? 'no-budget'
        : month > asOf.month
          ? 'future'
          : month < asOf.month
            ? 'complete'
            : elapsedFraction >= PROJECTION_MIN_ELAPSED
              ? 'projected'
              : 'too-early';

  // Only the two statuses that have a real elapsed fraction AND a budget to be measured against
  // project. `future` never reaches the division at all, which is the stated answer to "what about
  // elapsed fraction zero": nonzero spend over a zero fraction is non-finite and zero spend over it
  // is NaN, and neither value is ever constructed.
  const projects = status === 'complete' || status === 'projected';

  // THE RUN RATE APPLIES TO ELECTIVE SPEND ONLY. Dividing by the elapsed fraction asserts that
  // whatever has been spent so far will keep arriving at that rate, and a monthly subscription
  // contradicts that outright: `Sport`'s $265 gym charge on 3 September was the category's whole
  // month by day 8 of 30, and the bare division projected $993.75 for a month heading for $265. So
  // the recurring dollars are held out of the division and added back at face value:
  //
  //     projected = recurring expected + (actual − recurring posted) / elapsed fraction
  //
  // Only the AS-OF MONTH splits. A `complete` month's elapsed fraction is 1, so its projection is
  // its actual whichever form the arithmetic takes, and applying an expectation to a month that has
  // already ended would add a charge to it that never posted. `recurrence` is therefore consulted
  // for `projected` alone, which is also why a caller that supplies no recurrence at all gets the
  // identical figure this function returned before the split existed.
  const splits = status === 'projected' && recurrence !== undefined;
  const recurringExpected = splits ? recurrence!.expected : null;
  // Clamped at `actual`, and the clamp is a guard rather than an expectation: both figures are
  // summed over the same positive-amount rows of the same month, so `posted` cannot exceed the
  // month's spend unless the caller drew them from different populations. Unclamped, that mistake
  // would produce a NEGATIVE elective remainder, which the multiplier then turns into a category
  // projecting to close below what it has already spent.
  const recurringPosted = splits ? Math.min(recurrence!.posted, actual) : null;
  const elective = actual - (recurringPosted ?? 0);
  const projected = projects ? roundCents((recurringExpected ?? 0) + elective / elapsedFraction) : null;

  return {
    categoryId: row.id,
    category: row.name,
    scored,
    month,
    elapsedDays,
    daysInMonth: length,
    elapsedFraction,
    budgeted,
    actual: withoutNegativeZero(actual),
    // `budgeted > 0`, not `budgeted !== 0` — the identical rule `MonthVariance.ratio` applies one
    // level down. A negative annual budget still reports real dollar figures, but an inverted
    // percentage is worse than a blank: it points the wrong way with full confidence.
    spentRatio: budgeted > 0 ? withoutNegativeZero(actual / budgeted) : null,
    projected: projected === null ? null : withoutNegativeZero(projected),
    // From the already-rounded projection, then re-rounded — per step, never once at the end.
    projectedVariance: projected === null ? null : withoutNegativeZero(roundCents(projected - budgeted)),
    // A ratio, not money, so it is NOT rounded — cent-rounding a percentage quantizes it into 1%
    // steps. Its denominator is the cent-rounded monthly budget, which is what makes 83.33 a month
    // produce 2.4000960038401535 rather than the 2.4000000000000004 an unrounded copy of the even
    // spread would produce. That fifth decimal is the difference between importing the definition
    // and re-typing it.
    projectedRatio: projected !== null && budgeted > 0 ? withoutNegativeZero(projected / budgeted) : null,
    recurringExpected,
    recurringPosted: recurringPosted === null ? null : withoutNegativeZero(roundCents(recurringPosted)),
    status,
  };
}

/**
 * Every tracked category's every supplied month, resolved into a projected month-end position as of
 * `asOf`.
 *
 * Takes the same `AdherenceInput[]` the sibling detectors take, so step 31 performs exactly one
 * clock read, derives three integers from it in whatever timezone it decides is the owner's, and
 * makes three independent reads over one array:
 *
 *     const findings = detectAdherence(rows);
 *     const headline = scoredHeadline(rows);
 *     const pace = categoryPacing(rows, { year, month, day });
 *
 * Range is `isTrackedCategory` — operational, not excluded, not income — and `scored` is a flag on
 * the record, matching `detectAdherence` conjunct for conjunct. Two functions in one folder over one
 * array, one gated on three conjuncts and one on four, is a difference a caller has to remember and
 * will eventually get wrong.
 *
 * Months are exactly the entries in `row.months` — no more, no fewer, and never an invented twelve
 * — in calendar order within a category, categories in input order, so two callers passing the same
 * months in different array orders get byte-identical output.
 */
export function categoryPacing(
  rows: AdherenceInput[],
  asOf: AsOf,
  recurrence?: Map<string, CategoryRecurrence>,
): CategoryPace[] {
  assertRealAsOf(asOf);

  const paces: CategoryPace[] = [];

  for (const row of rows) {
    // The three landscape/exclusion conjuncts gate whether a record exists AT ALL, however extreme
    // the variance: a capital row is savings movement, an excluded row is not budget spend, and an
    // income row is not a spending decision. An untracked row's months are never resolved, and so
    // never validated — this function has nothing to say about a row it does not report on.
    if (!isTrackedCategory(row)) continue;

    const scored = isScoredCategory(row);

    // Keyed by NAME, because `mapped_category` is the only thing a transaction carries and it is
    // not a foreign key — the same join `getMonthlyActuals` makes, for the same reason.
    const rowRecurrence = recurrence?.get(row.name);

    for (const spend of [...row.months].sort((a, b) => a.month - b.month)) {
      paces.push(paceForMonth(row, spend, asOf, scored, rowRecurrence));
    }
  }

  return paces;
}
