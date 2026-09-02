import { describe, it, expect } from 'vitest';
import {
  categoryPacing,
  daysInMonth,
  PROJECTION_MIN_ELAPSED,
  type AsOf,
  type CategoryPace,
} from './pacing';
// Read-only, and only here: acceptance #18 needs the sibling module's verdict on the same
// out-of-range month to record the deliberate divergence, and acceptance #21 needs its budget for
// the same row to prove the two resolve one definition. `pacing.ts` imports from it too — that is
// the point — but nothing here reaches back the other way.
import { detectAdherence, type AdherenceInput, type MonthSpend } from './adherence';
import { roundCents } from '../budgetMath';

// Fabricated figures throughout — this repo keeps real amounts out of committed diffs, and a
// projection has no use for a real one.
//
// The base fixture is the roadmap's own sentence: $6,000/yr with no schedule, so every month is
// budgeted exactly $500, and the as-of point is April 8 of a 30-day April. Every case below moves
// one number at a time from there, and says so where it needs a different budget or a schedule.

const AS_OF: AsOf = { year: 2026, month: 3, day: 8 };

const input = (over: Partial<AdherenceInput> = {}): AdherenceInput => ({
  id: 1,
  name: 'Fabricated elective spend',
  landscape: 'operational',
  exclude_from_budget: false,
  is_income: false,
  control_mode: 'discretionary',
  annual_budget: 6000,
  monthly_amounts: null,
  months: [],
  ...over,
});

/** The roadmap's category: $500 a month, $355 drawn by day 8 of April. */
const DINING: MonthSpend[] = [{ month: 3, actual: 355 }];

/** A March-only category: the whole year's budget lands in one month, nothing in the others. */
const MARCH_ONLY = [0, 0, 1200, 0, 0, 0, 0, 0, 0, 0, 0, 0];

const only = (paces: CategoryPace[]): CategoryPace => {
  expect(paces).toHaveLength(1);
  return paces[0];
};

describe('categoryPacing', () => {
  it("the roadmap's own day-8-of-30 sentence computes exactly: a category at 71 percent of its month projects to close at 266.25 percent of its budget, and the projection is not the spend-to-date figure", () => {
    const pace = only(categoryPacing([input({ months: DINING })], AS_OF));

    expect(pace.status).toBe('projected');
    expect(pace.status).not.toBe('too-early');
    expect(pace.scored).toBe(true);
    expect(pace.elapsedDays).toBe(8);
    expect(pace.daysInMonth).toBe(30);
    // April is not January. A month length hardcoded to 31 projects $1,375.63 instead.
    expect(pace.daysInMonth).not.toBe(31);
    expect(pace.elapsedFraction).toBeCloseTo(0.26666666666666666, 15);
    // The three fractions the three plausible wrong implementations produce: the dashboard's
    // month-granular convention (the current month counted whole), a 31-day April, and a 0-based
    // as-of day.
    expect(pace.elapsedFraction).not.toBe(1);
    expect(pace.elapsedFraction).not.toBe(0.25806451612903225);
    expect(pace.elapsedFraction).not.toBe(0.23333333333333334);
    expect(pace.budgeted).toBe(500);
    expect(pace.actual).toBe(355);
    expect(pace.spentRatio).toBe(0.71);
    expect(pace.projected).toBe(1331.25);
    // Spend-to-date passed off as a projection — what an elapsed fraction of 1 produces.
    expect(pace.projected).not.toBe(355);
    expect(pace.projected).not.toBe(1375.63);
    expect(pace.projected).not.toBe(1521.43);
    // projected − budgeted, in that order. Reversed, this reads −831.25 and the module reports a
    // category $831.25 over as $831.25 under.
    expect(pace.projectedVariance).toBe(831.25);
    expect(pace.projectedVariance).not.toBe(-831.25);
    expect(pace.projectedRatio).toBe(2.6625);
    // Not the spend ratio wearing the projection's name, and not §5's illustrative "187% over",
    // which no elapsed-fraction projection of a 71%-spent month produces.
    expect(pace.projectedRatio).not.toBe(0.71);
    expect(pace.projectedRatio).not.toBeCloseTo(2.87, 2);
    // The multiplier is 1/elapsedFraction and is therefore never below 1: a projection under its
    // own spend-to-date would mean a sign or a reciprocal went the wrong way.
    expect(pace.projected as number).toBeGreaterThanOrEqual(pace.actual);
  });

  it("the elapsed fraction is day-granular, so a category eight days into a thirty-day month is not treated as having spent a whole month the way the dashboard's year pace treats the current month", () => {
    // `app/dashboard/page.tsx` computes months elapsed as `getMonth() + 1`, which on April 1 calls
    // a third of the year gone when a quarter of it is. That convention here would make every
    // projection equal to spend-to-date — the exact figure §5 says is not enough — so the fraction
    // is pinned as the day-granular one and the projection is pinned as strictly larger.
    const pace = only(categoryPacing([input({ months: DINING })], AS_OF));

    expect(pace.elapsedDays).toBe(8);
    expect(pace.daysInMonth).toBe(30);
    expect(pace.elapsedFraction).toBeCloseTo(8 / 30, 15);
    expect(pace.elapsedFraction).toBeLessThan(1);
    expect(pace.projected).not.toBe(pace.actual);
    expect(pace.projected).toBe(1331.25);
  });

  it('the projection floor is inclusive at exactly a quarter of the month elapsed, so day 7 of a 28-day February projects while day 7 of a 30-day April and day 7 of a 29-day leap February do not', () => {
    // $1,200/yr with no schedule: $100 every month, so only the calendar moves between the three.
    const row = input({ annual_budget: 1200, months: [{ month: 3, actual: 30 }] });
    const feb = input({ annual_budget: 1200, months: [{ month: 1, actual: 30 }] });

    // April, day 7 of 30 — 0.2333…, below the floor. The projection is withheld and NOTHING ELSE
    // is: spend-to-date and its ratio are still fully reported.
    const april = only(categoryPacing([row], { year: 2026, month: 3, day: 7 }));
    expect(april.elapsedFraction).toBeCloseTo(0.23333333333333334, 15);
    expect(april.status).toBe('too-early');
    expect(april.projected).toBeNull();
    expect(april.projectedVariance).toBeNull();
    expect(april.projectedRatio).toBeNull();
    expect(april.budgeted).toBe(100);
    expect(april.actual).toBe(30);
    expect(april.spentRatio).toBe(0.3);

    // February 2026, day 7 of 28 — exactly 0.25. The one input in this suite that tells `>=` from
    // `>`, and the one a February hardcoded to any other length gets wrong.
    const shortFeb = only(categoryPacing([feb], { year: 2026, month: 1, day: 7 }));
    expect(shortFeb.daysInMonth).toBe(28);
    expect(shortFeb.elapsedFraction).toBe(PROJECTION_MIN_ELAPSED);
    expect(shortFeb.elapsedFraction).toBe(0.25);
    expect(shortFeb.status).toBe('projected');
    expect(shortFeb.projected).toBe(120);
    expect(shortFeb.projectedVariance).toBe(20);
    expect(shortFeb.projectedRatio).toBe(1.2);

    // February 2024, day 7 of 29 — 0.2413…, below the floor by one leap day. A February fixed at
    // 28 days would project here.
    const leapFeb = only(categoryPacing([feb], { year: 2024, month: 1, day: 7 }));
    expect(leapFeb.daysInMonth).toBe(29);
    expect(leapFeb.elapsedFraction).toBeCloseTo(0.2413793103448276, 15);
    expect(leapFeb.status).toBe('too-early');
    expect(leapFeb.projected).toBeNull();
  });

  it('day one of a thirty-day month has a real elapsed fraction of one thirtieth rather than zero, and the projection is withheld as too early rather than multiplied by thirty', () => {
    const pace = only(categoryPacing([input({ months: DINING })], { year: 2026, month: 3, day: 1 }));

    // 1-based and counted complete: day 1's spend is divided by one thirtieth, never by zero.
    expect(pace.elapsedDays).toBe(1);
    expect(pace.elapsedFraction).toBeCloseTo(0.03333333333333333, 15);
    expect(pace.elapsedFraction).not.toBe(0);
    expect(pace.status).toBe('too-early');
    expect(pace.projected).toBeNull();
    expect(pace.projectedVariance).toBeNull();
    expect(pace.projectedRatio).toBeNull();
    // Spend-to-date survives the floor intact.
    expect(pace.actual).toBe(355);
    expect(pace.spentRatio).toBe(0.71);
    // The number a floorless implementation announces on day 1: one evening's dinners, times 30.
    expect(Object.values(pace)).not.toContain(10650);
    for (const value of Object.values(pace)) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('a month that begins after the as-of point has no elapsed fraction and reports a null projection rather than NaN or Infinity, whether its supplied actual is zero or nonzero', () => {
    // Two rows, because the two divide-by-zero leaks are different values: 0/0 is NaN and 250/0 is
    // non-finite, and a formatter renders one as a blank and the other as a wild number.
    const empty = input({ id: 1, annual_budget: 1200, months: [{ month: 11, actual: 0 }] });
    const charged = input({ id: 2, annual_budget: 1200, months: [{ month: 11, actual: 250 }] });

    const [december, prepaid] = categoryPacing([empty, charged], AS_OF);

    expect(december.status).toBe('future');
    expect(december.elapsedDays).toBe(0);
    expect(december.elapsedFraction).toBe(0);
    expect(december.daysInMonth).toBe(31);
    expect(december.budgeted).toBe(100);
    expect(december.actual).toBe(0);
    expect(december.spentRatio).toBe(0);
    expect(december.projected).toBeNull();
    expect(december.projectedVariance).toBeNull();
    expect(december.projectedRatio).toBeNull();
    expect(Number.isNaN(december.projected as unknown as number)).toBe(false);

    // A pre-authorised charge already sitting in a future month: the division is never reached, so
    // no non-finite value is constructed to be nulled afterwards.
    expect(prepaid.status).toBe('future');
    expect(prepaid.actual).toBe(250);
    expect(prepaid.projected).toBeNull();
    expect(prepaid.projected).not.toBe(Number.POSITIVE_INFINITY);
    expect(prepaid.projectedRatio).toBeNull();
    expect(prepaid.projectedRatio).not.toBe(Number.POSITIVE_INFINITY);
  });

  it("a month that ended before the as-of point is complete, its elapsed fraction is one and its projection is its actual, never the as-of month's fraction applied to it", () => {
    const pace = only(
      categoryPacing([input({ annual_budget: 1200, months: [{ month: 0, actual: 143 }] })], AS_OF),
    );

    expect(pace.status).toBe('complete');
    expect(pace.daysInMonth).toBe(31);
    expect(pace.elapsedDays).toBe(31);
    expect(pace.elapsedFraction).toBe(1);
    expect(pace.budgeted).toBe(100);
    expect(pace.actual).toBe(143);
    // Equal because the arithmetic says so — actual ÷ 1 — not because a special case says so, so
    // the two can never disagree.
    expect(pace.projected).toBe(pace.actual);
    expect(pace.projected).toBe(143);
    // April's fraction applied to a finished January would inflate it by 3.75× and make every
    // completed month of the year read as a catastrophe.
    expect(pace.projected).not.toBe(536.25);
    expect(pace.projectedVariance).toBe(43);
    expect(pace.projectedRatio).toBe(1.43);
  });

  it('off-cycle spend, where a scheduled category draws money in a month its schedule budgeted nothing for, reports a distinct off-cycle status and no percentage of any kind', () => {
    const pace = only(
      categoryPacing(
        [input({ annual_budget: 1200, monthly_amounts: MARCH_ONLY, months: [{ month: 3, actual: 275 }] })],
        AS_OF,
      ),
    );

    expect(pace.status).toBe('off-cycle');
    expect(pace.budgeted).toBe(0);
    expect(pace.actual).toBe(275);
    // "A breach in its own right, not a percentage" — literally. The dollar figure is the whole
    // content of the record.
    expect(pace.spentRatio).toBeNull();
    expect(pace.projected).toBeNull();
    expect(pace.projectedVariance).toBeNull();
    expect(pace.projectedRatio).toBeNull();
    // The incumbent per-cell helper answers a non-finite value for exactly this input; that is why
    // this module computes its own.
    expect(pace.spentRatio).not.toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(pace.spentRatio as unknown as number)).toBe(false);
    expect(pace.projected).not.toBe(1031.25);
  });

  it('a zero-budget month on a category with no schedule at all reports no-budget rather than off-cycle, so money outside its window is distinguishable from money against no window', () => {
    // No schedule and no annual budget: nobody has budgeted this category at all.
    const unbudgeted = only(
      categoryPacing([input({ annual_budget: 0, months: [{ month: 3, actual: 275 }] })], AS_OF),
    );

    expect(unbudgeted.status).toBe('no-budget');
    expect(unbudgeted.status).not.toBe('off-cycle');
    expect(unbudgeted.budgeted).toBe(0);
    expect(unbudgeted.actual).toBe(275);
    expect(unbudgeted.spentRatio).toBeNull();
    expect(unbudgeted.projected).toBeNull();
    expect(unbudgeted.projectedVariance).toBeNull();
    expect(unbudgeted.projectedRatio).toBeNull();

    // A scheduled $0 month with no spend in it: the schedule is there, the breach is not. This is
    // the conjunct that keeps a March-only category from reading as a scheduling breach in each of
    // the eleven months it is correctly dormant.
    const dormant = only(
      categoryPacing(
        [input({ annual_budget: 1200, monthly_amounts: MARCH_ONLY, months: [{ month: 3, actual: 0 }] })],
        AS_OF,
      ),
    );

    expect(dormant.status).toBe('no-budget');
    expect(dormant.status).not.toBe('off-cycle');
  });

  it('off-cycle spend keeps its status in a month that has not begun, so a pre-authorised charge against a zero-budget month is a breach rather than a month with nothing in it yet', () => {
    // The ladder's precedence, first rung: a statement about MONEY outranks a statement about the
    // CALENDAR. A March-only category carrying a $250 December charge, as of April 8, is off-cycle
    // spend that has already happened — the schedule budgeted nothing for December and money landed
    // there anyway. Ranking `future` first files that breach as "a month that has not started yet",
    // with every money field null and nothing anywhere saying $250 was drawn outside its window.
    // Nothing else in this file supplies a month that is both outside the as-of month AND
    // zero-budgeted, so this is the only place the two rungs are observed competing.
    const pace = only(
      categoryPacing(
        [input({ annual_budget: 1200, monthly_amounts: MARCH_ONLY, months: [{ month: 11, actual: 250 }] })],
        AS_OF,
      ),
    );

    expect(pace.status).toBe('off-cycle');
    expect(pace.status).not.toBe('future');
    // What the classification is FOR: the dollar figure is the breach, and it is real spend, not a
    // month waiting to happen.
    expect(pace.budgeted).toBe(0);
    expect(pace.actual).toBe(250);
    expect(pace.actual).toBeGreaterThan(0);
    // No percentage of any kind, exactly as for an off-cycle month inside the as-of month.
    expect(pace.spentRatio).toBeNull();
    expect(pace.projected).toBeNull();
    expect(pace.projectedVariance).toBeNull();
    expect(pace.projectedRatio).toBeNull();
    // The elapsed fields are facts about time and are still reported truthfully under a money
    // status: December has not started, and the record says so without letting that fact overwrite
    // what the money did.
    expect(pace.elapsedDays).toBe(0);
    expect(pace.daysInMonth).toBe(31);
    expect(pace.elapsedFraction).toBe(0);
  });

  it('a zero-budget month that has already ended reports no-budget rather than complete, so a month with no baseline never acquires a projection by having finished', () => {
    // The ladder's precedence, second rung, and the one where the money fields actually diverge:
    // ranking `complete` ahead of `no-budget` gives this record `projected: 143` and
    // `projectedVariance: 143` — a projection and a variance against a budget that does not exist.
    // A $0 month has no baseline to be measured against whether or not it is over.
    const pace = only(
      categoryPacing([input({ annual_budget: 0, months: [{ month: 0, actual: 143 }] })], AS_OF),
    );

    expect(pace.status).toBe('no-budget');
    expect(pace.status).not.toBe('complete');
    expect(pace.budgeted).toBe(0);
    expect(pace.actual).toBe(143);
    expect(pace.spentRatio).toBeNull();
    expect(pace.projected).toBeNull();
    expect(pace.projected).not.toBe(143);
    expect(pace.projectedVariance).toBeNull();
    expect(pace.projectedVariance).not.toBe(143);
    expect(pace.projectedRatio).toBeNull();
    // January is over, and the record says that too — the elapsed basis is reported under every
    // status, including the two that emit no money projection.
    expect(pace.elapsedDays).toBe(31);
    expect(pace.elapsedFraction).toBe(1);
  });

  it('a scheduled category is on budget in the month its schedule funds and off-cycle in a month it does not, in one call over one row', () => {
    // Month-granular schedule awareness, which is the granularity at which it is actually true: the
    // schedule fixes March's total and says nothing about the curve inside any month.
    const [march, april] = categoryPacing(
      [
        input({
          annual_budget: 1200,
          monthly_amounts: MARCH_ONLY,
          months: [
            { month: 2, actual: 1150 },
            { month: 3, actual: 275 },
          ],
        }),
      ],
      AS_OF,
    );

    expect(march.status).toBe('complete');
    // $1,200 from the schedule entry, not $100 from the even spread.
    expect(march.budgeted).toBe(1200);
    expect(march.actual).toBe(1150);
    expect(march.projected).toBe(1150);
    // Negative is UNDER: this category came in $50 below the month its schedule funds.
    expect(march.projectedVariance).toBe(-50);
    expect(march.projectedRatio).toBe(0.9583333333333334);

    expect(april.status).toBe('off-cycle');
    expect(april.budgeted).toBe(0);
    expect(april.actual).toBe(275);
    expect(april.projected).toBeNull();
  });

  it('the projection multiplier amplifies a single late-categorized transaction by the reciprocal of the elapsed fraction, so 50 dollars of newly categorized spend at day 8 of 30 moves the projected close by 187.50', () => {
    // Partial categorization is inherited from step 32, not fixed here, and this is what it costs
    // under a projection: `actual` is whatever share of spend happens to be categorized, and the
    // multiplier scales that error by 1/elapsedFraction. A prose warning nobody can run is how this
    // compounds unnoticed; the number below is a thing step 32 can cite.
    const a = only(categoryPacing([input({ months: [{ month: 3, actual: 355 }] })], AS_OF));
    const b = only(categoryPacing([input({ months: [{ month: 3, actual: 405 }] })], AS_OF));

    expect(b.actual - a.actual).toBe(50);
    expect(a.projected).toBe(1331.25);
    expect(b.projected).toBe(1518.75);
    expect((b.projected as number) - (a.projected as number)).toBeCloseTo(187.5, 10);
    expect((b.projected as number) - (a.projected as number)).not.toBe(50);
  });

  it('pacing ranges over every tracked category and flags the scored ones, so fixed and variable-necessary lines still report a projection while capital, excluded and income lines report nothing at all', () => {
    const supplied: MonthSpend[] = [{ month: 3, actual: 400 }];
    const common = { annual_budget: 1200, months: supplied };

    const result = categoryPacing(
      [
        input({ ...common, id: 1, control_mode: 'discretionary' }),
        input({ ...common, id: 2, control_mode: 'fixed' }),
        input({ ...common, id: 3, control_mode: 'variable-necessary' }),
        input({ ...common, id: 4, landscape: 'capital' }),
        input({ ...common, id: 5, exclude_from_budget: true }),
        input({ ...common, id: 6, is_income: true }),
      ],
      AS_OF,
    );

    // Three conjuncts gate whether a record exists; the fourth only sets the flag.
    expect(result.map((pace) => pace.categoryId)).toEqual([1, 2, 3]);
    expect(result).toHaveLength(3);
    // A four-conjunct range gate would drop the fixed and variable-necessary rows — plausible,
    // because the headline function two modules over does exactly that.
    expect(result).not.toHaveLength(1);
    // No landscape or exclusion gate at all would admit the capital, excluded and income rows.
    expect(result).not.toHaveLength(6);
    expect(result.map((pace) => pace.scored)).toEqual([true, false, false]);
    // A fixed line projecting to close over is a true fact; whether a surface prints it is step
    // 31's judgement, not this module's.
    expect(result[1].status).toBe('projected');
    expect(result[1].projected).toBe(1500);
  });

  it('pacing never invents a month the caller did not supply and returns the supplied months in calendar order whatever order they arrived in', () => {
    const result = categoryPacing(
      [
        input({
          annual_budget: 1200,
          months: [
            { month: 3, actual: 40 },
            { month: 0, actual: 40 },
            { month: 11, actual: 0 },
          ],
        }),
      ],
      AS_OF,
    );

    expect(result.map((pace) => pace.month)).toEqual([0, 3, 11]);
    expect(result).toHaveLength(3);
    // An implementation that ranged over the calendar year — or read a clock for it — reports 12.
    expect(result).not.toHaveLength(12);
    expect(result.map((pace) => pace.status)).toEqual(['complete', 'projected', 'future']);
  });

  it('an as-of day outside the real length of its own month is rejected with a RangeError rather than producing an elapsed fraction of zero or above one', () => {
    const rows = [input({ months: DINING })];

    // Day 0 gives an elapsed fraction of zero and a non-finite projection; April 31 gives a
    // fraction above one and a projection BELOW spend-to-date. A validator checking only
    // `1 <= day <= 31` admits both April 31 and February 29 of 2026.
    expect(() => categoryPacing(rows, { year: 2026, month: 3, day: 0 })).toThrow(RangeError);
    expect(() => categoryPacing(rows, { year: 2026, month: 3, day: 31 })).toThrow(RangeError);
    expect(() => categoryPacing(rows, { year: 2026, month: 1, day: 29 })).toThrow(RangeError);
    expect(() => categoryPacing(rows, { year: 2026, month: 12, day: 1 })).toThrow(RangeError);
    expect(() => categoryPacing(rows, { year: 2026, month: -1, day: 1 })).toThrow(RangeError);
    expect(() => categoryPacing(rows, { year: 2026, month: 3, day: 8.5 })).toThrow(RangeError);
    expect(() => categoryPacing(rows, { year: 2026, month: 3, day: Number.NaN })).toThrow(RangeError);
    expect(() => categoryPacing(rows, { year: 2026.5, month: 3, day: 8 })).toThrow(RangeError);

    // The last real day of April is a real day.
    expect(() => categoryPacing(rows, { year: 2026, month: 3, day: 30 })).not.toThrow();
  });

  it('a supplied month index outside 0 through 11 is rejected with a RangeError rather than silently substituting the even spread the adherence module substitutes', () => {
    // The 1-indexed `EXTRACT(MONTH …)` off-by-one, which is a confirmed probe rather than a
    // hypothetical: a December-only category handed month 12.
    const rows = [
      input({ annual_budget: 1200, monthly_amounts: MARCH_ONLY, months: [{ month: 12, actual: 1150 }] }),
    ];

    expect(() => categoryPacing(rows, AS_OF)).toThrow(RangeError);

    // The sibling module still substitutes the even spread for the same row, and that divergence is
    // recorded here deliberately: pacing has no month to take a length of and cannot fail soft the
    // way a variance detector can. A "fix" to either side turns this red rather than passing
    // silently. Step 31 should normalise the index upstream of both.
    const findings = detectAdherence(rows);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'breach', budgeted: 100, actual: 1150, variance: 1050, ratio: 11.5 });
  });

  it('a per-month actual that rounds to negative zero is normalized away at every emitted figure, so no surface can print a minus sign on a category that spent nothing', () => {
    // The residue this case depends on, pinned so it cannot silently stop gating if the shared
    // rounding helper is ever retuned: a caller's SQL SUM over signed rows netting a hair below
    // zero rounds to -0, and -0 survives every division on the way out.
    expect(Object.is(roundCents(-0.001), -0)).toBe(true);

    const pace = only(categoryPacing([input({ months: [{ month: 3, actual: -0.001 }] })], AS_OF));

    expect(pace.actual).toBe(0);
    expect(Object.is(pace.actual, -0)).toBe(false);
    expect(pace.projected).toBe(0);
    expect(Object.is(pace.projected, -0)).toBe(false);
    expect(pace.spentRatio).toBe(0);
    expect(Object.is(pace.spentRatio, -0)).toBe(false);
    expect(pace.projectedRatio).toBe(0);
    expect(Object.is(pace.projectedRatio, -0)).toBe(false);
    expect(pace.projectedVariance).toBe(-500);
  });

  it('a negative budgeted amount yields null for both ratios rather than an inverted percentage, while the dollar projection is still reported', () => {
    const pace = only(
      categoryPacing([input({ annual_budget: -1200, months: [{ month: 3, actual: 50 }] })], AS_OF),
    );

    expect(pace.budgeted).toBe(-100);
    expect(pace.actual).toBe(50);
    expect(pace.status).toBe('projected');
    expect(pace.projected).toBe(187.5);
    expect(pace.projectedVariance).toBe(287.5);
    // `budgeted > 0`, not `budgeted !== 0`: the inverted percentages below point confidently the
    // wrong way, and a blank beats a confidently wrong sign.
    expect(pace.spentRatio).toBeNull();
    expect(pace.projectedRatio).toBeNull();
    expect(pace.spentRatio).not.toBe(-0.5);
    expect(pace.projectedRatio).not.toBe(-1.875);
  });

  it("pacing resolves a month's budget through the same budgetedForMonth the adherence module uses, so the two agree on 83.33 for a 1,000 annual budget and the projected ratio carries the rounded denominator", () => {
    const rows = [input({ annual_budget: 1000, months: [{ month: 0, actual: 200 }] })];

    const pace = only(categoryPacing(rows, AS_OF));
    const findings = detectAdherence(rows);

    // One definition, imported, not retyped: a $1,000 annual budget is $83.33 a month in both.
    expect(pace.budgeted).toBe(findings[0].budgeted);
    expect(pace.budgeted).toBe(83.33);
    expect(pace.budgeted).not.toBe(83.33333333333333);

    expect(pace.status).toBe('complete');
    expect(pace.projected).toBe(200);
    expect(pace.projectedVariance).toBe(116.67);
    // The discriminator, at the fifth decimal: this is what a cent-rounded denominator and an
    // unrounded ratio produce, and nothing else does.
    expect(pace.projectedRatio).toBe(2.4000960038401535);
    // An unrounded copy of the even spread.
    expect(pace.projectedRatio).not.toBe(2.4000000000000004);
    // A ratio cent-rounded, which quantizes a percentage into 1% steps.
    expect(pace.projectedRatio).not.toBe(2.4);
  });

  it('returns an empty array rather than null for an empty input, a wholly untracked input, and a tracked row with no supplied months', () => {
    expect(categoryPacing([], AS_OF)).toEqual([]);
    expect(categoryPacing([input({ landscape: 'capital', months: DINING })], AS_OF)).toEqual([]);
    expect(categoryPacing([input({ months: [] })], AS_OF)).toEqual([]);
  });

  it('validates the as-of point before any row is read, so an impossible day is rejected even for an input that would produce no records', () => {
    // The as-of point is wrong regardless of what the rows say; discovering that only when a
    // tracked row happens to exist would make the error depend on the data.
    expect(() => categoryPacing([], { year: 2026, month: 3, day: 31 })).toThrow(RangeError);
  });

  it('requires an explicit as-of point rather than defaulting to a clock read', () => {
    // Paired with `tsc --noEmit`: if `asOf` were optional, or defaulted from a clock inside the
    // module, the directive below would be unused and the compile would fail with TS2578.
    // @ts-expect-error categoryPacing requires an explicit as-of point; there is no clock inside the module
    expect(() => categoryPacing([input({ months: DINING })])).toThrow();
  });
});

describe('daysInMonth', () => {
  it('the leap rule is Gregorian, so February 29 is a valid as-of day in 2024 and rejected in 2026, and 2100 is not a leap year while 2000 is', () => {
    const rows = [input({ annual_budget: 1200, months: [{ month: 1, actual: 60 }] })];

    // Observed through pacing first, because that is where a wrong month length silently rescales
    // a projection rather than failing.
    expect(() => categoryPacing(rows, { year: 2024, month: 1, day: 29 })).not.toThrow();
    expect(only(categoryPacing(rows, { year: 2024, month: 1, day: 29 })).daysInMonth).toBe(29);
    expect(() => categoryPacing(rows, { year: 2026, month: 1, day: 29 })).toThrow(RangeError);

    // And the exported helper directly. 2100 is the case a `year % 4 === 0` rule gets wrong, and it
    // is reachable as a test at all only because the module derives month length arithmetically
    // instead of asking a calendar.
    expect(daysInMonth(2100, 1)).toBe(28);
    expect(daysInMonth(2000, 1)).toBe(29);
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2024, 1)).toBe(29);
    expect(daysInMonth(2026, 3)).toBe(30);
    expect(daysInMonth(2026, 0)).toBe(31);
  });

  it('returns the real length of every month of a non-leap year, and rejects a month index that is not a month', () => {
    const lengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((month) => daysInMonth(2026, month));
    expect(lengths).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

    expect(() => daysInMonth(2026, 12)).toThrow(RangeError);
    expect(() => daysInMonth(2026, -1)).toThrow(RangeError);
    expect(() => daysInMonth(2026, 3.5)).toThrow(RangeError);
    expect(() => daysInMonth(Number.NaN, 3)).toThrow(RangeError);
  });
});
