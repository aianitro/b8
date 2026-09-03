import { describe, it, expect } from 'vitest';
import {
  asOfFromDate,
  monthOutlook,
  type CategorizationCoverage,
  type MonthOutlook,
  type OutlookCategory,
} from './monthOutlook';
// Read-only, and only here. Three acceptance criteria need the sibling modules' own verdicts on
// the same rows: #14 needs `categoryPacing`'s record to assert identity against, #19 needs both
// siblings' divergent answers to a 1-indexed month, and #18 needs `scoredHeadline`'s two answers
// to the twelve-month and the four-month shape. Nothing reaches back the other way.
import { detectAdherence, scoredHeadline, type AdherenceInput, type MonthSpend } from './adherence';
import { categoryPacing, type AsOf } from './pacing';

// Fabricated figures throughout — this repo keeps real amounts out of committed diffs, and a
// month's verdict has no use for a real one.
//
// The anchor is P0.5-30's, deliberately reused so the two suites' arithmetic cross-checks: April 8
// of a 30-day April, so the elapsed fraction is 8/30 = 0.2666… and the projection multiplier is
// 3.75. Every fixture moves one number at a time from there and says so where it needs another.
const AS_OF: AsOf = { year: 2026, month: 3, day: 8 };

/** Day 7 of 30 is 0.2333…, below the projection floor, where day 8 is above it. */
const AS_OF7: AsOf = { year: 2026, month: 3, day: 7 };

const COVERAGE: CategorizationCoverage = { uncategorizedCount: 17, categorizedCount: 183 };

const cat = (over: Partial<AdherenceInput> = {}): AdherenceInput => ({
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

/** A March-only schedule: the whole year's budget lands in one month, nothing in the others. */
const MARCH_ONLY = [0, 0, 1200, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/** A schedule that budgets nothing all year — present, full length, and all zeros. */
const NEVER = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

const april = (actual: number): MonthSpend[] => [{ month: 3, actual }];

/**
 * Out-of-contract values reach the function through exactly one cast, at the fixture boundary.
 *
 * Nothing in `shared/types.ts` or `./adherence` is widened to make these compile — that is the
 * P0.5-28 [[N4]] precedent, and widening a contract so a negative test compiles deletes the very
 * property the test exists to assert.
 */
const outOfContract = (value: unknown): never => value as never;

const ids = (list: OutlookCategory[]): number[] => list.map((c) => c.categoryId);

describe('monthOutlook', () => {
  it("the roadmap's day-8-of-30 sentence becomes a hero state and a named list, so a category projecting to close at 266.25 percent of its month is the one saying no while the one projecting at 81.25 percent is holding", () => {
    const rows = [
      cat({ id: 1, name: 'Dining Out', annual_budget: 6000, months: april(355) }),
      cat({ id: 2, name: 'Groceries', annual_budget: 14400, months: april(260) }),
    ];
    const outlook = monthOutlook(rows, AS_OF, COVERAGE);

    expect(outlook.state).toBe('projected-breach');
    // The three states a wrong ladder reaches from this input: one derived only from
    // `actual > budgeted` (355 is under 500, so nothing is over yet), the fact-outranks-projection
    // rung firing without a fact, and an empty scored set.
    expect(outlook.state).not.toBe('on-track');
    expect(outlook.state).not.toBe('breach');
    expect(outlook.state).not.toBe('nothing-to-score');

    expect(outlook.scoredCategoryCount).toBe(2);
    expect(outlook.sayingNo).toHaveLength(1);
    expect(outlook.sayingNo.length).not.toBe(2);
    expect(outlook.holding).toHaveLength(1);
    expect(outlook.withheld).toHaveLength(0);

    const dining = outlook.sayingNo[0];
    expect(dining.category).toBe('Dining Out');
    expect(dining.category).not.toBe('Groceries');
    expect(dining.reason).toBe('projected-breach');
    expect(dining.reason).not.toBe('breach');
    expect(dining.projected).toBe(1331.25);
    // Spend-to-date passed off as a projection, and a 31-day April.
    expect(dining.projected).not.toBe(355);
    expect(dining.projected).not.toBe(1375.63);
    expect(dining.projectedVariance).toBe(831.25);
    // projected − budgeted, in that order. Reversed, a category 831.25 over reads 831.25 under.
    expect(dining.projectedVariance).not.toBe(-831.25);
    expect(dining.projectedRatio).toBe(2.6625);
    // "Percent over" for "fraction of budget", a cent-rounded ratio, and the spend ratio wearing
    // the projection's name — three renderings that are all plausible and all wrong.
    expect(dining.projectedRatio).not.toBe(1.6625);
    expect(dining.projectedRatio).not.toBe(2.66);
    expect(dining.projectedRatio).not.toBe(0.71);
    expect(dining.spentRatio).toBe(0.71);
    expect(dining.elapsedDays).toBe(8);
    expect(dining.daysInMonth).toBe(30);
    expect(dining.daysInMonth).not.toBe(31);
    expect(dining.controlMode).toBe('discretionary');
    expect(dining.status).toBe('projected');
    expect(dining.withheldReason).toBe(null);

    const groceries = outlook.holding[0];
    expect(groceries.category).toBe('Groceries');
    expect(groceries.projected).toBe(975);
    expect(groceries.projected).not.toBe(260);
    expect(groceries.projectedVariance).toBe(-225);
    expect(groceries.projectedVariance).not.toBe(225);
    expect(groceries.projectedRatio).toBe(0.8125);
    expect(groceries.spentRatio).toBe(0.21666666666666667);
    expect(groceries.reason).toBe(null);
    expect(groceries.withheldReason).toBe(null);

    // The caller's own object, not a copy of its fields.
    expect(outlook.coverage).toBe(COVERAGE);
    expect(outlook.asOf).toBe(AS_OF);
  });

  it('an empty scored set renders nothing to score rather than on track, and the tracked-but-unscored categories still produce adherence findings beside it', () => {
    // This is the demo dataset's own state: `scripts/seed-demo.mjs` wrote no `control_mode` until
    // this step, so every seeded category was `fixed` and `isScoredCategory` admitted none.
    const rows = [
      cat({ id: 1, name: 'Mortgage Payment', control_mode: 'fixed', annual_budget: 24000, months: april(2000) }),
      cat({ id: 2, name: 'Utilities', control_mode: 'fixed', annual_budget: 5400, months: april(620) }),
      cat({ id: 3, name: 'Insurance', control_mode: 'fixed', annual_budget: 7200, months: april(600) }),
    ];
    const outlook = monthOutlook(rows, AS_OF, COVERAGE);

    expect(outlook.state).toBe('nothing-to-score');
    // The one-character version of this bug is a falsy check on a null headline rendering green.
    expect(outlook.state).not.toBe('on-track');
    // Utilities IS 170 dollars over its month. That is a true fact and still not a scored breach.
    expect(outlook.state).not.toBe('breach');
    // Vacuously true over an empty set, which is why the first rung has to exist.
    expect(outlook.state).not.toBe('no-budget-basis');

    expect(outlook.scoredCategoryCount).toBe(0);
    expect(outlook.sayingNo).toEqual([]);
    expect(outlook.holding).toEqual([]);
    expect(outlook.withheld).toEqual([]);
    expect(outlook.offCycleElsewhere).toEqual([]);

    expect(outlook.headline).toBe(null);
    expect(Object.is(outlook.headline, undefined)).toBe(false);

    // "Tracked and reported, never scored", made observable: the detectors range over the three
    // landscape/exclusion conjuncts, so the fixed line's April breach is still reported.
    expect(outlook.findings).toHaveLength(1);
    expect(outlook.findings.length).not.toBe(0);
    const finding = outlook.findings[0];
    expect(finding.kind).toBe('breach');
    expect(finding.scored).toBe(false);
    expect(finding.category).toBe('Utilities');
    if (finding.kind !== 'breach') throw new Error('unreachable: the finding above is a breach');
    expect(finding.budgeted).toBe(450);
    expect(finding.actual).toBe(620);
    expect(finding.variance).toBe(170);

    // The caveat renders in this state too — it is not a decoration on a healthy hero.
    expect(outlook.coverage.uncategorizedCount).toBe(17);
  });

  it('off-cycle spend outranks every other verdict, so a scheduled category drawing outside its window says off-cycle rather than breach', () => {
    const rows = [
      cat({
        id: 1, annual_budget: 1200, monthly_amounts: MARCH_ONLY,
        months: [{ month: 2, actual: 1150 }, { month: 3, actual: 275 }],
      }),
    ];
    const outlook = monthOutlook(rows, AS_OF, COVERAGE);

    expect(outlook.state).toBe('off-cycle');
    // 275 > 0 also satisfies `actual > budgeted`, which is exactly why the two must not collapse.
    expect(outlook.state).not.toBe('breach');
    expect(outlook.state).not.toBe('projected-breach');
    expect(outlook.state).not.toBe('no-budget-basis');

    expect(outlook.sayingNo).toHaveLength(1);
    const offCycle = outlook.sayingNo[0];
    expect(offCycle.month).toBe(3);
    expect(offCycle.reason).toBe('off-cycle');
    expect(offCycle.status).toBe('off-cycle');
    expect(offCycle.budgeted).toBe(0);
    expect(offCycle.actual).toBe(275);

    // A dollar figure with NO percentage — "a breach in its own right", not a ratio against zero.
    expect(offCycle.spentRatio).toBe(null);
    expect(offCycle.projected).toBe(null);
    expect(offCycle.projectedVariance).toBe(null);
    expect(offCycle.projectedRatio).toBe(null);
    expect(offCycle.spentRatio !== Infinity).toBe(true);
    expect(Number.isNaN(offCycle.spentRatio as unknown as number)).toBe(false);

    // [[N32]]: March closed 50 dollars under its 1200 and belongs in no column beside April's.
    const partition = outlook.sayingNo.concat(outlook.holding, outlook.withheld);
    expect(partition.every((c) => c.month === 3)).toBe(true);
  });

  it('a category already over its month budget says breach rather than projected breach, because a fact outranks a projection', () => {
    const outlook = monthOutlook([cat({ months: april(620) })], AS_OF, COVERAGE);

    expect(outlook.state).toBe('breach');
    expect(outlook.state).not.toBe('projected-breach');
    expect(outlook.state).not.toBe('on-track');

    const breach = outlook.sayingNo[0];
    expect(breach.reason).toBe('breach');
    expect(breach.reason).not.toBe('projected-breach');
    // The projection is still reported. The fact outranks it; it does not suppress it.
    expect(breach.projected).toBe(2325);
    expect(breach.projectedVariance).toBe(1825);
    expect(breach.projectedRatio).toBe(4.65);
    expect(breach.spentRatio).toBe(1.24);

    // The precedence again with BOTH rungs live at once, which is the only shape that can
    // discriminate the state ladder's own order: one category already over (a fact) beside one
    // merely projecting over. Without this pair the two rungs are interchangeable, because no
    // single record is ever classified as both.
    const both = monthOutlook(
      [cat({ id: 1, months: april(620) }), cat({ id: 2, months: april(355) })],
      AS_OF,
      COVERAGE,
    );
    expect(both.state).toBe('breach');
    expect(both.state).not.toBe('projected-breach');
    expect(both.sayingNo.map((c) => c.reason)).toEqual(['breach', 'projected-breach']);
  });

  it('a month too young to project withholds the verdict instead of claiming the budget is being held', () => {
    const outlook = monthOutlook([cat({ months: april(30) })], AS_OF7, COVERAGE);

    expect(outlook.state).toBe('too-early');
    // Rendering green in the first week makes every month open as a success.
    expect(outlook.state).not.toBe('on-track');
    expect(outlook.state).not.toBe('projected-breach');

    expect(outlook.withheld).toHaveLength(1);
    const early = outlook.withheld[0];
    expect(early.withheldReason).toBe('too-early');
    expect(early.status).toBe('too-early');
    expect(early.projected).toBe(null);
    // Spend to date is fully reported; only the projection is withheld.
    expect(early.budgeted).toBe(500);
    expect(early.actual).toBe(30);
    expect(early.spentRatio).toBe(0.06);

    // The two figures a floorless caller prints: the projection from a 7/30 fraction, and the
    // day-1-style multiplier applied to the same spend.
    const everyNumber = JSON.stringify(outlook);
    expect(everyNumber).not.toContain('128.57');
    expect(everyNumber).not.toContain('900');

    expect(outlook.sayingNo).toEqual([]);
    expect(outlook.holding).toEqual([]);
  });

  it('a category with nothing budgeted this month is withheld rather than reported as a breach for spending against no budget', () => {
    const outlook = monthOutlook([cat({ annual_budget: 0, months: april(275) })], AS_OF, COVERAGE);

    expect(outlook.state).toBe('no-budget-basis');
    // The single most likely wrong answer in this suite: 275 > 0 is true and means nothing.
    expect(outlook.state).not.toBe('breach');
    // There is no schedule, so nothing is off its cycle either.
    expect(outlook.state).not.toBe('off-cycle');
    expect(outlook.state).not.toBe('on-track');

    const unbudgeted = outlook.withheld[0];
    expect(unbudgeted.withheldReason).toBe('no-budget');
    expect(unbudgeted.withheldReason).not.toBe('negative-budget');
    expect(unbudgeted.withheldReason).not.toBe('too-early');
    expect(unbudgeted.status).toBe('no-budget');
    expect(unbudgeted.budgeted).toBe(0);
    expect(unbudgeted.actual).toBe(275);
    expect(unbudgeted.spentRatio).toBe(null);
    expect(unbudgeted.projected).toBe(null);
    expect(unbudgeted.projectedVariance).toBe(null);
    expect(unbudgeted.projectedRatio).toBe(null);
    expect(outlook.sayingNo).toEqual([]);
  });

  it('a negative annual budget is withheld with its own reason rather than reported as a projected breach on an inverted percentage', () => {
    const outlook = monthOutlook([cat({ annual_budget: -1200, months: april(50) })], AS_OF, COVERAGE);

    expect(outlook.state).toBe('no-budget-basis');
    // The projected variance IS +287.50 here. Scoring it would report a breach off an inverted
    // baseline, which is a confident dollar figure pointing the wrong way.
    expect(outlook.state).not.toBe('projected-breach');

    const negative = outlook.withheld[0];
    expect(negative.withheldReason).toBe('negative-budget');
    expect(negative.budgeted).toBe(-100);
    expect(negative.actual).toBe(50);
    expect(negative.projected).toBe(187.5);
    expect(negative.projectedVariance).toBe(287.5);
    // The two inverted percentages a `budgeted !== 0` guard emits instead of a blank.
    expect(negative.spentRatio).toBe(null);
    expect(negative.projectedRatio).toBe(null);
    expect(negative.spentRatio).not.toBe(-0.5);
    expect(negative.projectedRatio).not.toBe(-1.875);
  });

  it('two categories both holding under their projections report on track, and one of them slipping over flips the state without touching the other', () => {
    const rows = [
      cat({ id: 1, name: 'Groceries', annual_budget: 14400, months: april(260) }),
      cat({ id: 2, name: 'Transport', annual_budget: 12000, months: april(200) }),
    ];
    const outlook = monthOutlook(rows, AS_OF, COVERAGE);

    expect(outlook.state).toBe('on-track');
    expect(outlook.holding).toHaveLength(2);
    expect(outlook.sayingNo).toEqual([]);
    // Ascending projected variance: −250 before −225, deepest under budget first.
    expect(ids(outlook.holding)).toEqual([2, 1]);
    expect(outlook.holding[0].projectedVariance).toBe(-250);
    expect(outlook.holding[0].projectedRatio).toBe(0.75);
    expect(outlook.holding[1].projectedVariance).toBe(-225);

    const slipped = monthOutlook(
      [cat({ id: 1, name: 'Groceries', annual_budget: 14400, months: april(355) }), rows[1]],
      AS_OF,
      COVERAGE,
    );
    expect(slipped.state).toBe('projected-breach');
    expect(slipped.sayingNo).toHaveLength(1);
    expect(slipped.sayingNo[0].projectedVariance).toBe(131.25);
    expect(slipped.holding).toHaveLength(1);
    // The untouched row reports exactly what it did before.
    expect(slipped.holding[0].categoryId).toBe(2);
    expect(slipped.holding[0].projectedVariance).toBe(-250);
  });

  it('every emitted money figure is the identical value the pacing module produced, never a re-rounded or re-derived copy of it', () => {
    // A THIRD row whose arithmetic is rounding-sensitive, and it is the load-bearing one. The
    // roadmap's own $355 projects to exactly $1,331.25 whether or not the cent rounding happens,
    // so on that row alone a re-derivation is indistinguishable from a copy. $355.55 projects to
    // 1333.3125 raw and 1333.31 rounded — two different doubles — so this row is what makes
    // `Object.is` a gate rather than a coincidence.
    const rows = [
      cat({ id: 1, name: 'Dining Out', annual_budget: 6000, months: april(355) }),
      cat({ id: 2, name: 'Groceries', annual_budget: 14400, months: april(260) }),
      cat({ id: 3, name: 'Shopping', annual_budget: 6000, months: april(355.55) }),
    ];
    const outlook = monthOutlook(rows, AS_OF, COVERAGE);
    const pace = categoryPacing(rows, AS_OF);
    const dining = pace.find((p) => p.categoryId === 1 && p.month === 3)!;
    const emitted = outlook.sayingNo.find((c) => c.categoryId === 1)!;

    const roundingSensitive = pace.find((p) => p.categoryId === 3 && p.month === 3)!;
    const emittedSensitive = outlook.sayingNo.find((c) => c.categoryId === 3)!;
    // The rounded figures the pacing module produced…
    expect(roundingSensitive.projected).toBe(1333.31);
    expect(roundingSensitive.projectedRatio).toBe(2.66662);
    // …and the unrounded ones a re-derivation lands on instead.
    expect(emittedSensitive.projected).toBe(roundingSensitive.projected);
    expect(emittedSensitive.projected).not.toBe(1333.3125);
    expect(emittedSensitive.projectedRatio).toBe(roundingSensitive.projectedRatio);
    expect(emittedSensitive.projectedRatio).not.toBe(2.666625);
    expect(emittedSensitive.projectedVariance).toBe(roundingSensitive.projectedVariance);
    expect(emittedSensitive.spentRatio).toBe(roundingSensitive.spentRatio);
    expect(emittedSensitive.actual).toBe(roundingSensitive.actual);
    expect(emittedSensitive.budgeted).toBe(roundingSensitive.budgeted);

    // `toBe` is Object.is, which separates a copied 2.6625 from a re-derived one where a closeness
    // assertion would not: a recomputation lands a fifteenth decimal away, or not at all.
    expect(emitted.budgeted).toBe(dining.budgeted);
    expect(emitted.actual).toBe(dining.actual);
    expect(emitted.spentRatio).toBe(dining.spentRatio);
    expect(emitted.projected).toBe(dining.projected);
    expect(emitted.projectedVariance).toBe(dining.projectedVariance);
    expect(emitted.projectedRatio).toBe(dining.projectedRatio);
    expect(emitted.elapsedDays).toBe(dining.elapsedDays);
    expect(emitted.daysInMonth).toBe(dining.daysInMonth);
    expect(emitted.status).toBe(dining.status);

    expect(emitted.projectedRatio).not.toBe(2.66);
    expect(emitted.projectedRatio).not.toBe(1.6625);

    expect(outlook.headline).toEqual(scoredHeadline(rows));
    expect(outlook.findings).toEqual(detectAdherence(rows));
  });

  it('the three as-of-month lists partition the scored categories exactly once each, so no category is counted twice or dropped', () => {
    const rows = [
      cat({ id: 1, annual_budget: 6000, months: april(620) }),
      cat({ id: 2, annual_budget: 6000, months: april(355) }),
      cat({ id: 3, annual_budget: 1200, monthly_amounts: NEVER, months: april(275) }),
      cat({ id: 4, annual_budget: 14400, months: april(260) }),
      cat({ id: 5, annual_budget: 0, months: april(0) }),
      cat({ id: 6, annual_budget: -1200, months: april(50) }),
      cat({ id: 7, control_mode: 'fixed', annual_budget: 24000, months: april(3000) }),
      cat({ id: 8, landscape: 'capital', annual_budget: 6000, months: april(400) }),
      cat({ id: 9, is_income: true, annual_budget: 6000, months: april(400) }),
    ];
    const outlook = monthOutlook(rows, AS_OF, COVERAGE);

    expect(outlook.scoredCategoryCount).toBe(6);
    // No gate at all, and the three-conjunct gate that admits the `fixed` row.
    expect(outlook.scoredCategoryCount).not.toBe(9);
    expect(outlook.scoredCategoryCount).not.toBe(7);

    expect(outlook.sayingNo.length + outlook.holding.length + outlook.withheld.length).toBe(6);
    const everyId = ids(outlook.sayingNo.concat(outlook.holding, outlook.withheld)).sort((a, b) => a - b);
    expect(everyId).toEqual([1, 2, 3, 4, 5, 6]);

    // Off-cycle first, then breach, then projected-breach — the stated reason precedence.
    expect(ids(outlook.sayingNo)).toEqual([3, 1, 2]);
    expect(outlook.sayingNo.map((c) => c.reason)).toEqual(['off-cycle', 'breach', 'projected-breach']);
    expect(ids(outlook.holding)).toEqual([4]);
    expect(ids(outlook.withheld)).toEqual([5, 6]);
    expect(outlook.withheld.map((c) => c.withheldReason)).toEqual(['no-budget', 'negative-budget']);
    expect(outlook.state).toBe('off-cycle');
  });

  it("only the as-of month reaches the verdict lists, so a finished month's percentage never sits in the same column as a mid-flight one", () => {
    // [[N32]] in one input: March closed at 95.83% of its 1200 and April is 8 days into 500.
    const rows = [
      cat({
        id: 1, annual_budget: 1200, monthly_amounts: MARCH_ONLY,
        months: [{ month: 2, actual: 1150 }, { month: 3, actual: 275 }],
      }),
      cat({ id: 2, annual_budget: 6000, months: april(100) }),
    ];
    const outlook = monthOutlook(rows, AS_OF, COVERAGE);

    const partition = outlook.sayingNo.concat(outlook.holding, outlook.withheld);
    expect(partition).toHaveLength(2);
    expect(partition.every((c) => c.month === 3)).toBe(true);
    expect(partition.some((c) => c.month === 2)).toBe(false);
    // The March record exists in the pacing output and carries a real variance; it simply never
    // reaches a column. Its absence here is what makes the columns comparable.
    const march = categoryPacing(rows, AS_OF).find((p) => p.categoryId === 1 && p.month === 2)!;
    expect(march.projectedVariance).toBe(-50);
    expect(march.status).toBe('complete');
    // Every record in the lists carries its status, so no renderer can bind one column across two.
    expect(partition.every((c) => typeof c.status === 'string')).toBe(true);
  });

  it("off-cycle spend in an earlier elapsed month is reported separately rather than folded into this month's verdict", () => {
    // [[N31]]'s scenario rebased onto elapsed months. February drew 250 against a March-only
    // schedule; April's schedule entry is 0 and nothing was drawn, so April is `no-budget`.
    const rows = [
      cat({
        id: 1, annual_budget: 1200, monthly_amounts: MARCH_ONLY,
        months: [{ month: 1, actual: 250 }, { month: 2, actual: 1150 }, { month: 3, actual: 0 }],
      }),
      cat({ id: 2, annual_budget: 6000, months: april(100) }),
    ];
    const outlook = monthOutlook(rows, AS_OF, COVERAGE);

    expect(outlook.offCycleElsewhere).toHaveLength(1);
    expect(outlook.offCycleElsewhere[0].month).toBe(1);
    // The two answers a precedence-swapped ladder gives for a month that is both elapsed and
    // off-cycle.
    expect(outlook.offCycleElsewhere[0].status).toBe('off-cycle');
    expect(outlook.offCycleElsewhere[0].status).not.toBe('complete');
    expect(outlook.offCycleElsewhere[0].status).not.toBe('future');
    expect(outlook.offCycleElsewhere[0].actual).toBe(250);
    expect(outlook.offCycleElsewhere[0].budgeted).toBe(0);

    // The hero is scoped to THIS month and says so. The earlier breach is carried beside it, not
    // inside it — a recorded decision, not an accident.
    expect(outlook.state).toBe('on-track');
    expect(outlook.state).not.toBe('off-cycle');
    expect(outlook.withheld).toHaveLength(1);
    expect(outlook.withheld[0].withheldReason).toBe('no-budget');
    expect(outlook.holding).toHaveLength(1);
    expect(outlook.holding[0].categoryId).toBe(2);
    expect(outlook.holding[0].projectedVariance).toBe(-125);
  });

  it('a month index after the as-of month is rejected, because a full calendar year of months turns a 24 percent year-to-date underspend into a 75 percent one', () => {
    const twelve: MonthSpend[] = [355, 420, 390, 355, 0, 0, 0, 0, 0, 0, 0, 0].map((actual, month) => ({ month, actual }));
    const allYear = [cat({ months: twelve })];
    expect(() => monthOutlook(allYear, AS_OF, COVERAGE)).toThrow(RangeError);

    // The hazard, recorded as arithmetic rather than as a warning. This is what the
    // `generate_series(1, 12)` shape in `components/BudgetMonthlyGrid.tsx` supplies.
    const overYear = scoredHeadline(allYear)!;
    expect(overYear.budgeted).toBe(6000);
    expect(overYear.actual).toBe(1520);
    expect(overYear.variance).toBe(-4480);
    expect(overYear.varianceRatio).toBe(-0.7466666666666667);

    const elapsed = [cat({ months: twelve.slice(0, 4) })];
    const overElapsed = scoredHeadline(elapsed)!;
    expect(overElapsed.budgeted).toBe(2000);
    expect(overElapsed.actual).toBe(1520);
    expect(overElapsed.variance).toBe(-480);
    expect(overElapsed.varianceRatio).toBe(-0.24);
    expect(overYear.varianceRatio).not.toBe(overElapsed.varianceRatio);

    // The permitted shape does not throw, and reports the month the caller is actually in.
    const outlook = monthOutlook(elapsed, AS_OF, COVERAGE);
    expect(outlook.state).toBe('projected-breach');
    expect(outlook.holding).toHaveLength(0);
    expect(outlook.sayingNo[0].projected).toBe(1331.25);
  });

  it('a one-indexed month index is rejected before either domain module is called, rather than one of them throwing while the other silently prices it', () => {
    const rows = [cat({ annual_budget: 1200, monthly_amounts: MARCH_ONLY, months: [{ month: 12, actual: 1150 }] })];
    expect(() => monthOutlook(rows, AS_OF, COVERAGE)).toThrow(RangeError);

    // Both halves of the deliberate sibling divergence, pinned here so a "fix" to either goes red.
    // `detectAdherence` substitutes the even spread and prices a December-only category as an
    // 1150 percent breach…
    const findings = detectAdherence(rows);
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    if (finding.kind !== 'breach') throw new Error('unreachable: the finding above is a breach');
    expect(finding.budgeted).toBe(100);
    expect(finding.actual).toBe(1150);
    expect(finding.variance).toBe(1050);
    expect(finding.ratio).toBe(11.5);
    // …while `categoryPacing` throws, because there is no thirteenth month to take a length of.
    expect(() => categoryPacing(rows, AS_OF)).toThrow(RangeError);
  });

  it('the same category supplied twice is rejected rather than doubling the categories, the money and the counts', () => {
    const rows = [cat({ id: 1, months: april(355) }), cat({ id: 1, months: april(20) })];
    expect(() => monthOutlook(rows, AS_OF, COVERAGE)).toThrow(RangeError);
  });

  it('a duplicated month within one category is rejected rather than counted twice', () => {
    const rows = [cat({ months: [{ month: 3, actual: 355 }, { month: 3, actual: 20 }] })];
    expect(() => monthOutlook(rows, AS_OF, COVERAGE)).toThrow(RangeError);
  });

  it('a non-finite annual budget is rejected rather than reported as a dollar figure of NaN beside a benign-looking blank percentage', () => {
    expect(() => monthOutlook([cat({ annual_budget: NaN, months: april(355) })], AS_OF, COVERAGE)).toThrow(RangeError);
    expect(() => monthOutlook([cat({ annual_budget: Infinity, months: april(355) })], AS_OF, COVERAGE)).toThrow(RangeError);
    const schedule = [0, 0, NaN, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(() => monthOutlook([cat({ monthly_amounts: schedule, months: april(355) })], AS_OF, COVERAGE)).toThrow(RangeError);
  });

  it('a negative spend magnitude is rejected rather than projected downward by a multiplier that is always at least one', () => {
    // The un-validated answer is a projection of −375: BELOW its own spend-to-date, because a
    // multiplier of 3.75 moves a negative number down. Every "projection ≥ actual" reading of the
    // output silently inverts.
    expect(() => monthOutlook([cat({ months: april(-100) })], AS_OF, COVERAGE)).toThrow(RangeError);
  });

  it('a money field arriving as a string is rejected rather than concatenated into a plausible number', () => {
    // A NUMERIC column read through an unchecked db.query<T>() cast. '6000' + 500 is '6000500'.
    expect(() => monthOutlook([cat({ annual_budget: outOfContract('6000'), months: april(355) })], AS_OF, COVERAGE))
      .toThrow(RangeError);
    expect(() => monthOutlook([cat({ months: [{ month: 3, actual: outOfContract('355') }] })], AS_OF, COVERAGE))
      .toThrow(RangeError);
  });

  it('a scored category with no entry for the as-of month is rejected rather than silently reported as holding', () => {
    const rows = [cat({ id: 1, months: april(355) }), cat({ id: 2, months: [] })];
    expect(() => monthOutlook(rows, AS_OF, COVERAGE)).toThrow(RangeError);

    // A tracked-but-unscored row with no as-of-month entry is legal: nobody scores it, so its
    // absence from the lists says nothing false.
    const unscored = [cat({ id: 1, months: april(355) }), cat({ id: 2, control_mode: 'fixed', months: [] })];
    expect(() => monthOutlook(unscored, AS_OF, COVERAGE)).not.toThrow();
  });

  it('a legal but negative annual budget does not throw, because the database permits it and a crashed dashboard is worse than a withheld row', () => {
    // [[N21]]'s chosen disposition. `budget_categories.annual_budget` has no CHECK yet, so this row
    // is a legal database state; the migration is owed, and a 500 in the meantime is worse.
    const rows = [cat({ annual_budget: -1200, months: april(50) })];
    expect(() => monthOutlook(rows, AS_OF, COVERAGE)).not.toThrow();
    const outlook = monthOutlook(rows, AS_OF, COVERAGE);
    expect(outlook.withheld[0].withheldReason).toBe('negative-budget');
    expect(outlook.state).toBe('no-budget-basis');
  });

  it('the as-of point is the local calendar day of the clock read, so one minute past midnight and one minute to it map to the same day', () => {
    // Constructed from LOCAL components on both sides, so the assertion is timezone-independent.
    //
    // Stated rather than glossed: this fixture cannot discriminate local from UTC — a UTC
    // implementation passes every line below in a UTC CI. That discrimination is enforced
    // statically by SPEC.md acceptance #28 and #28a. The fixture pins the contract; the grep is
    // the gate.
    expect(asOfFromDate(new Date(2026, 3, 8, 0, 1))).toEqual({ year: 2026, month: 3, day: 8 });
    expect(asOfFromDate(new Date(2026, 3, 8, 23, 59))).toEqual({ year: 2026, month: 3, day: 8 });
    // The New Year boundary, in both directions.
    expect(asOfFromDate(new Date(2026, 0, 1, 0, 30))).toEqual({ year: 2026, month: 0, day: 1 });
    expect(asOfFromDate(new Date(2026, 11, 31, 23, 30))).toEqual({ year: 2026, month: 11, day: 31 });
    // A 1-based month, which shifts every monthly_amounts lookup by one and prices April against
    // May's allocation.
    expect(asOfFromDate(new Date(2026, 3, 8, 12, 0))).not.toEqual({ year: 2026, month: 4, day: 8 });
  });

  it('the coverage the figures were computed over is carried through unchanged and is reported even when every category is holding', () => {
    const rows = [
      cat({ id: 1, annual_budget: 14400, months: april(260) }),
      cat({ id: 2, annual_budget: 12000, months: april(200) }),
    ];
    const outlook = monthOutlook(rows, AS_OF, COVERAGE);

    // The healthiest state is the one where a caveat is most likely to be dropped.
    expect(outlook.state).toBe('on-track');
    expect(outlook.coverage).toBe(COVERAGE);
    expect(outlook.coverage.uncategorizedCount).toBe(17);
    expect(outlook.coverage.categorizedCount).toBe(183);

    // @ts-expect-error monthOutlook requires the coverage it was computed over; it cannot be omitted
    const withoutCoverage = () => monthOutlook(rows, AS_OF);
    expect(withoutCoverage).toBeTypeOf('function');
  });

  it("the headline and the findings are the sibling modules' own output, passed through rather than recomputed", () => {
    const rows = [
      cat({ id: 1, name: 'Dining Out', annual_budget: 6000, months: april(620) }),
      cat({ id: 2, name: 'Mortgage Payment', control_mode: 'fixed', annual_budget: 24000, months: april(2500) }),
    ];
    const outlook: MonthOutlook = monthOutlook(rows, AS_OF, COVERAGE);

    expect(outlook.headline).toEqual(scoredHeadline(rows));
    expect(outlook.findings).toEqual(detectAdherence(rows));
    // The two ranges are different by design, and the pass-through preserves the difference:
    // `findings` covers the tracked set (both rows breach), `headline` covers the scored set only.
    expect(outlook.findings).toHaveLength(2);
    expect(outlook.headline!.scoredCategoryCount).toBe(1);
    expect(outlook.scoredCategoryCount).toBe(1);
  });
});
