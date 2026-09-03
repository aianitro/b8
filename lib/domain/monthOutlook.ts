// The month's verdict (ROADMAP.md §5 step 31 / P0.5-31): the one question the dashboard opens on
// — "will I close this month inside my limits, and which categories say no" — resolved into a
// STATE drawn from a closed set of seven and a NAMED LIST, never a vanity percentage.
//
// This module exists because the answer is a state machine over a total precedence order plus a
// partition of the scored set into three named lists, and both of those are pure functions of
// (rows, as-of point, coverage). Written on the page they would be untestable: `app/dashboard/
// page.tsx` is an async server component issuing its own SQL, and `vitest.config.mts` deliberately
// excludes anything needing a database. Written here they are exhaustively testable in the
// existing node environment, and BUILD.md §7.5's rule — no surface computes a shared concept
// independently of `lib/domain/` — is satisfied structurally rather than by promise.
//
// What this module is NOT:
//
//   - It is not a third arithmetic. It emits NO money figure of its own. Every `number` it reports
//     other than counts is the identical value `./pacing` or `./adherence` produced, copied by
//     reference off the record it came from — `Object.is`-identical, not merely equal. There is no
//     cent rounding here, no absolute value, no division, no multiplier and no percentage: a figure
//     re-derived from `budgeted` and `actual` would land a fifteenth decimal away from the sibling
//     module's and the dashboard would disagree with `/budget` about one category by a cent.
//   - It is not a renderer. It emits numbers, states and lists; the page formats them. No currency
//     formatting, no colour, no copy.
//   - It is not a second membership test. `isTrackedCategory` and `isScoredCategory` are IMPORTED
//     from `./adherence`; nothing here re-expresses the four conjuncts as an inline filter.
//   - It is not tolerant. It contains no try/catch, deliberately: `categoryPacing` throws a
//     `RangeError` on exactly the inputs `detectAdherence` silently prices at a plausible wrong
//     figure ([[N15]], [[N33]], [[N34]]). A caller that swallowed the throw would ship the
//     confidently-wrong sibling number alone, which is worse than a blank page. Instead the
//     caller contract is validated HERE, before either sibling is called at all, so the two can
//     never be handed an input they disagree about.
//
// It is the ONLY caller of `detectAdherence`, `scoredHeadline` and `categoryPacing` in the app.
// Three functions over one array, called from one place, so nothing can hand them divergent rows.

import type { ControlMode } from '../../shared/types';
// One import line per sibling, values and types together, because the coupling this module is
// allowed to have with each of them is exactly one: it calls them. A second line importing the
// same module reads as a second relationship.
import { detectAdherence, isScoredCategory, scoredHeadline, type AdherenceFinding, type AdherenceInput, type ScoredHeadline } from './adherence';
import { categoryPacing, type AsOf, type CategoryPace, type PaceStatus } from './pacing';

/**
 * How much of the as-of month's transaction volume has a category on it.
 *
 * TWO COUNTS, NOT A SHARE OF SPEND. Step 32 owns "computed over 96% of operational spend" and the
 * threshold below which a figure refuses to be authoritative; this step ships the interim caveat
 * that keeps the hero honest until then, and a count is the honest shape for it: a percentage of
 * *transactions* would read as a percentage of *money* to every reader, and those two numbers
 * disagree by exactly the amount an uncategorized mortgage payment is worth.
 *
 * It is a REQUIRED third parameter rather than an optional one, and that is the whole point. An
 * optional coverage is one a renderer forgets, and a hero with no stated basis in a phase whose
 * thesis is "no confidently wrong numbers" is the defect this parameter exists to prevent. The
 * compiler enforces it; `monthOutlook.test.ts` pins the enforcement with a `@ts-expect-error` that
 * fails the build as an unused directive the moment the parameter becomes optional.
 *
 * Both counts range over the as-of month, on tracked accounts, not hidden, in the `operational`
 * landscape — the landscape the scored set lives in. Caveating an operational figure with
 * capital-side noise would make the caveat wrong in the direction that reassures.
 */
export interface CategorizationCoverage {
  uncategorizedCount: number;
  categorizedCount: number;
}

/**
 * The seven things this month can be saying, and there is no eighth.
 *
 *   - `nothing-to-score`  — no row is in the scored set at all. NOT "on track": the demo dataset
 *                           is exactly this input, and a green hero over an empty set is the
 *                           single worst thing this module could produce. [[N12]] made the two
 *                           distinguishable one level down; this is the first surface that can
 *                           get it wrong.
 *   - `off-cycle`         — a scheduled category drew money in a month its schedule budgeted
 *                           nothing for. §5 elevates this as "a breach in its own right".
 *   - `breach`            — a category is already over its month, with a budget to be over.
 *   - `projected-breach`  — a category projects to close over its month.
 *   - `too-early`         — the month is too young to project from, so no verdict is claimed.
 *   - `no-budget-basis`   — every scored record has nothing budgeted this month. There is spend,
 *                           but no limit to measure it against.
 *   - `on-track`          — none of the above.
 */
export type OutlookState =
  | 'nothing-to-score' | 'off-cycle' | 'breach' | 'projected-breach'
  | 'too-early' | 'no-budget-basis' | 'on-track';

/** Why a category is in `sayingNo`. */
export type SayingNoReason = 'off-cycle' | 'breach' | 'projected-breach';

/** Why a category's verdict is withheld rather than given. */
export type WithheldReason = 'too-early' | 'no-budget' | 'negative-budget';

/**
 * One scored category's position, as of the stated day.
 *
 * Every money and ratio field is the `CategoryPace` record's own value, copied by reference. The
 * two fields that are not copies are `reason` and `withheldReason`, which are this module's own
 * verdict, and `controlMode`, which is the row's — [[N37]] noted that carrying it "would cost
 * nothing and is the cheapest place to put it", and this is that place.
 *
 * `status` travels with every record on purpose ([[N32]]). `spentRatio` means three incomparable
 * things across the six statuses — a finished month's final share, a mid-flight month's
 * share-so-far, and nothing at all for an off-cycle month — so a renderer that binds one column
 * across statuses puts "250% of December" under "71% of April". It cannot do that without
 * ignoring a field it was handed.
 */
export interface OutlookCategory {
  categoryId: number;
  category: string;
  controlMode: ControlMode;
  status: PaceStatus;
  /** Always `asOf.month` for the three partition lists; an earlier month only in `offCycleElsewhere`. */
  month: number;
  elapsedDays: number;
  daysInMonth: number;
  budgeted: number;
  actual: number;
  spentRatio: number | null;
  projected: number | null;
  projectedVariance: number | null;
  projectedRatio: number | null;
  /** Non-null if and only if this record is in `sayingNo`. */
  reason: SayingNoReason | null;
  /** Non-null if and only if this record is in `withheld`. */
  withheldReason: WithheldReason | null;
}

/**
 * The whole answer, in one struct, with the day it was answered on attached.
 *
 * `asOf` is carried so a renderer cannot print a projection without the day it was projected from
 * — the qualifier `./pacing` built `elapsedDays`/`daysInMonth` to carry, one level up.
 */
export interface MonthOutlook {
  asOf: AsOf;
  state: OutlookState;
  /** How many rows `isScoredCategory` admitted. `0` exactly when `state` is `nothing-to-score`. */
  scoredCategoryCount: number;
  /** Ordered: reason precedence, then projected variance descending, then category id ascending. */
  sayingNo: OutlookCategory[];
  /** Ordered: projected variance ascending (deepest under budget first), then category id. */
  holding: OutlookCategory[];
  /** Ordered: category id ascending. */
  withheld: OutlookCategory[];
  /**
   * Scored off-cycle records in ELAPSED months other than the as-of month.
   *
   * Its own list rather than a fourth verdict, because [[N31]]'s failure scenario is precisely a
   * ladder that files an earlier month's off-cycle spend under a calendar status and reports it as
   * this month's verdict. The hero is scoped to this month and says so; the earlier breach is still
   * reported, beside it, in the order `categoryPacing` produced it.
   */
  offCycleElsewhere: OutlookCategory[];
  /** `scoredHeadline(rows)`, verbatim. `null` if and only if no row is scored. */
  headline: ScoredHeadline | null;
  /**
   * `detectAdherence(rows)`, verbatim — over `isTrackedCategory`, which is WIDER than the scored
   * set. §5's "the rest are tracked and reported, never scored", made observable: a `fixed`
   * mortgage line drawing over its budget still produces a finding in the `nothing-to-score` state,
   * where every other field of this struct is empty.
   */
  findings: AdherenceFinding[];
  /** The caller's own object, carried unchanged. */
  coverage: CategorizationCoverage;
}

/**
 * The as-of point from a clock read, in LOCAL calendar time.
 *
 * The single conversion between "an instant" and "a calendar day" in this app, and the reason
 * `app/dashboard/page.tsx` performs exactly one clock read: three integers, derived once, govern
 * both this module and every date-bounded query the page issues.
 *
 * Local, not UTC, and the choice is load-bearing rather than stylistic. Every other date predicate
 * the page issues resolves against Postgres's `CURRENT_DATE`, which is the database server's
 * calendar day. A UTC-derived day is the PREVIOUS day for every hour before the offset in a
 * negative-offset zone, so for those hours the hero would be scored against a different day than
 * the SQL beside it filtered on — a disagreement whose only symptom is that the projection's
 * denominator is one day out. One clock, one calendar, one day.
 *
 * `month` is 0-based, matching `AsOf`, `MonthSpend.month` and the `monthly_amounts` index — one
 * indexing convention across the whole domain folder. A 1-based month here would shift every
 * schedule lookup by one and price April against May's allocation.
 *
 * A note the tests repeat rather than assume: no fixture can discriminate local from UTC, because
 * a UTC implementation passes every local-component assertion in a UTC CI. That discrimination is
 * enforced statically, by SPEC.md acceptance #28 and #28a, and the fixture pins the contract.
 */
export function asOfFromDate(now: Date): AsOf {
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
}

/**
 * A money field that is not a finite JavaScript number.
 *
 * Takes `unknown` rather than `number` on purpose: the values it guards arrive from an unchecked
 * `db.query<T>()` cast, where a `NUMERIC` column that was not explicitly converted arrives as a
 * STRING and the type says otherwise ([[N20]]). `'6000' + 500` is `'6000500'`, a plausible-looking
 * figure that is wrong by three orders of magnitude, and no type error is ever produced for it.
 */
function assertMoney(value: unknown, what: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`monthOutlook: ${what} must be a finite number, got ${typeof value} ${String(value)}`);
  }
}

/**
 * The caller contract `./adherence` and `./pacing` both state in prose and neither enforces —
 * enforced here, once, before either of them is called.
 *
 * Every clause below is an inherited debt with a recorded symptom, and each is rejected rather
 * than resolved because every plausible resolution produces a confident wrong number:
 *
 *   - ONE ROW PER CATEGORY ([[N26]]). Two rows sharing an id double the category, the money and
 *     the counts, and the headline still renders.
 *   - ONE ENTRY PER MONTH ([[N18]]). A duplicated month is counted twice by both siblings.
 *   - MONTHS ARE ELAPSED MONTHS OF `asOf.year` ([[N15]], [[N31]], [[N33]]). Two distinct failures
 *     live here. A 1-INDEXED month — what `EXTRACT(MONTH FROM t.date)::int` returns unadjusted —
 *     makes `categoryPacing` throw (there is no thirteenth month to take a length of) while
 *     `detectAdherence` silently substitutes the even spread and prices a December-only category
 *     as an 1150% breach. A FULL CALENDAR YEAR of months — the `generate_series(1, 12)` shape
 *     sitting in `components/BudgetMonthlyGrid.tsx` — turns a 24% year-to-date underspend into a
 *     75% one by dividing four months of spend by twelve months of budget.
 *   - MONEY IS FINITE ([[N29]]) AND A NUMBER ([[N20]]). `NaN` propagates into a dollar figure
 *     beside a benign-looking blank percentage.
 *   - SPEND IS A NON-NEGATIVE MAGNITUDE ([[N35]]). `MonthSpend.actual` is defined as a magnitude,
 *     not the ledger's signed convention. A negative one projects DOWNWARD — the multiplier is at
 *     least one, so a $-100 April projects to $-375, below its own spend-to-date — and the
 *     "projection ≥ actual" reasoning every reader applies silently inverts.
 *   - A SCORED CATEGORY HAS AN AS-OF-MONTH ENTRY. Without one it is absent from all three
 *     partition lists and therefore reads as fine, which is the quietest way to be wrong.
 *
 * `annual_budget: -1200` is deliberately NOT here. The schema permits a negative budget (no CHECK
 * constraint yet — [[N21]] is owed a migration), so a dashboard that 500s on a legal row is worse
 * than one that names the row and moves on. It is WITHHELD with its own reason instead.
 */
function assertCallerContract(rows: AdherenceInput[], asOf: AsOf): void {
  const seenIds = new Set<number>();

  for (const row of rows) {
    if (seenIds.has(row.id)) {
      throw new RangeError(`monthOutlook: category ${row.id} appears more than once; rows must carry one entry per category`);
    }
    seenIds.add(row.id);

    assertMoney(row.annual_budget, `annual_budget of category ${row.id}`);
    if (row.monthly_amounts !== null) {
      for (const amount of row.monthly_amounts) {
        assertMoney(amount, `a monthly_amounts entry of category ${row.id}`);
      }
    }

    const seenMonths = new Set<number>();
    for (const spend of row.months) {
      if (!Number.isInteger(spend.month) || spend.month < 0 || spend.month > asOf.month) {
        throw new RangeError(
          `monthOutlook: category ${row.id} supplied month ${spend.month}; months must be 0-based (0 = January) and elapsed, i.e. 0 to ${asOf.month}`,
        );
      }
      if (seenMonths.has(spend.month)) {
        throw new RangeError(`monthOutlook: category ${row.id} supplied month ${spend.month} more than once`);
      }
      seenMonths.add(spend.month);

      assertMoney(spend.actual, `actual for month ${spend.month} of category ${row.id}`);
      if (spend.actual < 0) {
        throw new RangeError(
          `monthOutlook: category ${row.id} supplied a negative actual ${spend.actual} for month ${spend.month}; spend is a non-negative magnitude`,
        );
      }
    }

    // Scored rows only. A tracked-but-unscored row with no as-of-month entry is reported by
    // `detectAdherence` and scored by nobody, so its absence from the partition lists says nothing
    // false. A SCORED row's absence would.
    if (isScoredCategory(row) && !seenMonths.has(asOf.month)) {
      throw new RangeError(
        `monthOutlook: scored category ${row.id} has no entry for the as-of month ${asOf.month}; a missing month reads as holding`,
      );
    }
  }
}

/** Where one as-of-month record lands, and why. Exactly one of the three, always. */
type Verdict =
  | { list: 'sayingNo'; reason: SayingNoReason }
  | { list: 'holding' }
  | { list: 'withheld'; reason: WithheldReason };

/**
 * The ladder, as one ordered classifier, applied per record.
 *
 * The order is TOTAL and each adjacent pair earns its position. It is written once, here, and the
 * hero's state is read off these verdicts rather than re-tested against a second copy of the same
 * conditions — two copies of a precedence order is how the ladder and the list come to disagree
 * about the same category.
 *
 *   1. `off-cycle` ABOVE `breach`. An off-cycle record has `budgeted === 0` and `actual > 0`, so it
 *      also satisfies `actual > budgeted`. Collapsing the two loses §5's elevated case and reports
 *      a scheduled category's out-of-window draw as an ordinary overspend.
 *   2. `breach` ABOVE `projected-breach`. A fact outranks a projection: a category already over its
 *      month is over it whatever the multiplier says.
 *   3. `breach` REQUIRES `budgeted > 0`. A category with nothing budgeted that drew $275 is not a
 *      breach — `275 > 0` is true and means nothing. It is a category nobody has budgeted, and
 *      calling it a breach teaches the owner to ignore the word. This is the single most likely
 *      rung to get wrong.
 *   4. `too-early` ABOVE `on-track`. A month too young to project has no basis for "you are
 *      holding", and rendering green there makes the first week of every month read as success.
 *   5. `negative-budget` is its own withheld reason. `./pacing` already refuses to emit a ratio
 *      against a negative budget — an inverted percentage points the wrong way with full
 *      confidence — and the verdict follows the same rule rather than scoring the row's `+287.50`
 *      projected variance as a breach.
 */
function verdictFor(pace: CategoryPace): Verdict {
  if (pace.status === 'off-cycle') return { list: 'sayingNo', reason: 'off-cycle' };
  if (pace.budgeted > 0 && pace.actual > pace.budgeted) return { list: 'sayingNo', reason: 'breach' };
  if (
    pace.status === 'projected' &&
    pace.budgeted > 0 &&
    pace.projectedVariance !== null &&
    pace.projectedVariance > 0
  ) {
    return { list: 'sayingNo', reason: 'projected-breach' };
  }
  if (pace.status === 'too-early') return { list: 'withheld', reason: 'too-early' };
  if (pace.budgeted < 0) return { list: 'withheld', reason: 'negative-budget' };
  if (pace.budgeted === 0) return { list: 'withheld', reason: 'no-budget' };
  return { list: 'holding' };
}

/**
 * One `CategoryPace` plus this module's verdict, with every figure copied by reference.
 *
 * No field is re-derived. `Object.is` separates a copied `2.6625` from a recomputed one where a
 * closeness assertion would not, and Fixture H10 asserts exactly that for all nine carried fields.
 */
function toOutlookCategory(
  pace: CategoryPace,
  controlMode: ControlMode,
  reason: SayingNoReason | null,
  withheldReason: WithheldReason | null,
): OutlookCategory {
  return {
    categoryId: pace.categoryId,
    category: pace.category,
    controlMode,
    status: pace.status,
    month: pace.month,
    elapsedDays: pace.elapsedDays,
    daysInMonth: pace.daysInMonth,
    budgeted: pace.budgeted,
    actual: pace.actual,
    spentRatio: pace.spentRatio,
    projected: pace.projected,
    projectedVariance: pace.projectedVariance,
    projectedRatio: pace.projectedRatio,
    reason,
    withheldReason,
  };
}

/** Reason precedence within `sayingNo`, and the same order the state ladder reads. */
const SAYING_NO_PRECEDENCE: SayingNoReason[] = ['off-cycle', 'breach', 'projected-breach'];

/**
 * Descending projected variance, with "no projection at all" sorted last.
 *
 * An off-cycle record carries no projection by design, so it has no magnitude to rank by; putting
 * it after the ranked ones is a stated choice rather than whatever a subtraction against `null`
 * happens to do. Comparators are the one place this module is permitted to do arithmetic: the
 * result orders an array and is never emitted.
 */
function byProjectedVarianceDesc(a: OutlookCategory, b: OutlookCategory): number {
  if (a.projectedVariance === null && b.projectedVariance === null) return 0;
  if (a.projectedVariance === null) return 1;
  if (b.projectedVariance === null) return -1;
  return b.projectedVariance - a.projectedVariance;
}

/**
 * This month's verdict over `rows`, as of `asOf`, computed over `coverage`.
 *
 * Three reads over one array — `detectAdherence`, `scoredHeadline`, `categoryPacing` — after one
 * validation pass, so the two that disagree about a malformed month can never be handed one.
 *
 * The state and the three partition lists range over SCORED records in the AS-OF MONTH only.
 * `findings` and `headline` keep the ranges their own modules define — `isTrackedCategory` and
 * `isScoredCategory` respectively — because "tracked and reported, never scored" is a split worth
 * preserving rather than flattening: a `fixed` mortgage over its budget is a true fact that no
 * adherence figure should average over.
 */
export function monthOutlook(rows: AdherenceInput[], asOf: AsOf, coverage: CategorizationCoverage): MonthOutlook {
  assertCallerContract(rows, asOf);

  const findings = detectAdherence(rows);
  const headline = scoredHeadline(rows);
  const paces = categoryPacing(rows, asOf);

  const controlModeById = new Map<number, ControlMode>(rows.map((row) => [row.id, row.control_mode]));
  // `!` rather than a default: every pace record came from a row in `rows`, so a miss here is
  // impossible, and a `?? 'fixed'` fallback would quietly reclassify a category if it ever were.
  const controlModeOf = (pace: CategoryPace): ControlMode => controlModeById.get(pace.categoryId)!;

  const scoredCategoryCount = rows.filter((row) => isScoredCategory(row)).length;

  const sayingNo: OutlookCategory[] = [];
  const holding: OutlookCategory[] = [];
  const withheld: OutlookCategory[] = [];
  const offCycleElsewhere: OutlookCategory[] = [];

  // The two flags the ladder needs that no single verdict carries: whether any record is over its
  // month with a budget to be over, and whether every record lacks a budget at all. Both are
  // accumulated in the one pass that builds the lists, so neither can range over a different set
  // than the lists do.
  let sawTooEarly = false;
  let everyRecordUnbudgeted = true;

  for (const pace of paces) {
    if (!pace.scored) continue;

    if (pace.month !== asOf.month) {
      // Elapsed by construction — a later month was rejected above — so this is an earlier month.
      if (pace.status === 'off-cycle') {
        offCycleElsewhere.push(toOutlookCategory(pace, controlModeOf(pace), null, null));
      }
      continue;
    }

    if (pace.status === 'too-early') sawTooEarly = true;
    if (pace.budgeted > 0) everyRecordUnbudgeted = false;

    const verdict = verdictFor(pace);
    if (verdict.list === 'sayingNo') {
      sayingNo.push(toOutlookCategory(pace, controlModeOf(pace), verdict.reason, null));
    } else if (verdict.list === 'withheld') {
      withheld.push(toOutlookCategory(pace, controlModeOf(pace), null, verdict.reason));
    } else {
      holding.push(toOutlookCategory(pace, controlModeOf(pace), null, null));
    }
  }

  sayingNo.sort((a, b) => {
    const byReason = SAYING_NO_PRECEDENCE.indexOf(a.reason!) - SAYING_NO_PRECEDENCE.indexOf(b.reason!);
    if (byReason !== 0) return byReason;
    const byVariance = byProjectedVarianceDesc(a, b);
    return byVariance !== 0 ? byVariance : a.categoryId - b.categoryId;
  });
  holding.sort((a, b) => {
    // Ascending: the deepest under budget first, which is also the order in which a chronically
    // wrong budget line makes itself visible.
    const byVariance = byProjectedVarianceDesc(b, a);
    return byVariance !== 0 ? byVariance : a.categoryId - b.categoryId;
  });
  withheld.sort((a, b) => a.categoryId - b.categoryId);

  const reasons = new Set<SayingNoReason>(sayingNo.map((c) => c.reason!));

  // The ladder, read off the verdicts the lists were built from. `nothing-to-score` is first and
  // is its OWN state: with no scored rows, every `some` below is false and `everyRecordUnbudgeted`
  // is vacuously true, so without this rung an empty scored set would report `no-budget-basis` —
  // a statement about budgets, made about a set that has no members.
  const state: OutlookState =
    scoredCategoryCount === 0
      ? 'nothing-to-score'
      : reasons.has('off-cycle')
        ? 'off-cycle'
        : reasons.has('breach')
          ? 'breach'
          : reasons.has('projected-breach')
            ? 'projected-breach'
            : sawTooEarly
              ? 'too-early'
              : everyRecordUnbudgeted
                ? 'no-budget-basis'
                : 'on-track';

  return {
    asOf,
    state,
    scoredCategoryCount,
    sayingNo,
    holding,
    withheld,
    offCycleElsewhere,
    headline,
    findings,
    coverage,
  };
}
