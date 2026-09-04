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
//     cent rounding here, no absolute value, no multiplier: a figure re-derived from `budgeted` and
//     `actual` would land a fifteenth decimal away from the sibling module's and the dashboard would
//     disagree with `/budget` about one category by a cent.
//
//     The ONE division in this file is `categorizationCoverage`'s (ROADMAP.md §5 step 32 / P0.5-32),
//     and it is not a money figure: it is the SHARE OF SPEND the headline was computed over, which
//     no sibling produces and which nothing else in the app may compute a second time. It happens
//     once, here, and `monthOutlook` copies its three results by reference like every other field.
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

import type { BudgetCategory, ControlMode } from '../../shared/types';
// One import line per sibling, values and types together, because the coupling this module is
// allowed to have with each of them is exactly one: it calls them. A second line importing the
// same module reads as a second relationship.
import { detectAdherence, isScoredCategory, scoredHeadline, type AdherenceFinding, type AdherenceInput, type ScorableCategory, type ScoredHeadline } from './adherence';
import { categoryPacing, type AsOf, type CategoryPace, type PaceStatus } from './pacing';

/**
 * The share of spend below which this month's figures stop being presented as a verdict.
 *
 * A POLICY CONSTANT, and this comment says so rather than dressing it as a derivation. No
 * threshold can buy per-verdict certainty: a $12 unattributed coffee flips a category sitting $10
 * under its month at any coverage whatsoever. What the number buys is AGGREGATE credibility, and
 * the reasoning for this value is:
 *
 *   - It cannot be `1`. Any nonzero unattributed spend can flip a marginal category, so a
 *     certainty threshold refuses authority in every real month, and a guardrail that always fires
 *     is one the owner learns to dismiss — the same failure mode as a caveat that is always green.
 *   - It should not be lower on this data. At coverage `c` the unattributed mass is `(1 − c)/c` of
 *     what the headline saw; at `0.95` that is 5.26% of the month's scored spend. The scored set is
 *     nine categories, so at an even split that invisible mass is 47% of one average category's
 *     month. Below 0.95 it exceeds half a category's budget and can manufacture a breach on its
 *     own; at or above it, nothing can be flipped that was not already inside 5% of its limit — a
 *     position the hero already renders as marginal.
 *
 * It is exported, and named, precisely so it can be MOVED BY EVIDENCE rather than rediscovered as
 * a magic number in a conditional. It appears as a literal exactly once in the shipped code: the
 * page consults `MonthOutlook.authoritative` and never restates the number.
 *
 * Applied as `coverageShare >= COVERAGE_THRESHOLD` — a CLOSED lower bound. Exactly 95% is
 * authoritative. And it is compared against the FRACTION, never the percent: `95 >= 0.95` is
 * always true, so a threshold accidentally applied to `coveragePercent` never refuses anything and
 * every test that only walks the authoritative path still passes.
 */
export const COVERAGE_THRESHOLD = 0.95;

/**
 * One `mapped_category` group of the as-of month's spend, as the caller's single aggregation
 * produced it. `category` is `null` for the group of rows carrying no mapping at all.
 *
 * The caller aggregates; this module classifies. That split is not a style preference: re-expressing
 * `isScoredCategory`'s four conjuncts in a `WHERE` clause would put the coverage query's copy of the
 * membership rule beyond the reach of every test in this repo, which is the drifting-definitions
 * hazard (BUILD.md §1) landing on the one predicate P0.5-28 exists to have a single definition of.
 */
export interface CoverageGroup {
  /** `transactions.mapped_category`, verbatim — `null` where the row carries none. */
  category: string | null;
  /** The group's summed spend, positive-amount rows only, as a non-negative magnitude. */
  spend: number;
  /** How many transactions the group holds. A supporting detail, never divided (see below). */
  count: number;
}

/**
 * The category half of the classification: a name, plus the four columns membership depends on.
 *
 * Projected off the shared contract rather than re-declared, for the same reason `ScorableCategory`
 * is — a caller holding whole `budget_categories` rows satisfies it structurally and nobody invents
 * a local shape for a row `shared/types.ts` already describes.
 */
export type CoverageCategory = ScorableCategory & Pick<BudgetCategory, 'name'>;

/**
 * What share of the month's spend the headline above it was actually able to see.
 *
 * A SHARE OF DOLLARS, not of transactions, and the difference is the whole point: one uncategorized
 * $4,000 transfer against forty categorized $12 coffees is 97.6% by count and a rounding error away
 * from useless by dollars. The counts below survive as supporting detail and are never divided.
 *
 * THE POPULATION IS STATED ONCE AND APPLIED TO BOTH HALVES. Every transaction in the as-of month to
 * date, on an account with `track_transactions = TRUE`, `hidden = FALSE`, `amount > 0` — and NO
 * account-landscape predicate. Each is then classified by resolving `mapped_category` against the
 * category rows BY NAME, through the app's single membership test:
 *
 *   - **scored** — some row with that name satisfies `isScoredCategory`. Numerator AND denominator.
 *   - **known-unscored** — rows carry the name, none is scored (income, `Transfers`, `fixed`,
 *     `variable-necessary`, capital categories). NEITHER half.
 *   - **unattributed** — `mapped_category IS NULL`, or no row carries the name at all (an ORPHAN).
 *     Denominator only.
 *
 * The three properties that earn that population, each answering an inherited finding:
 *
 *   1. It is KNOWABLE WITHOUT THE ANSWER. The denominator never asks "is this uncategorized row
 *      discretionary?" — the question whose unanswerability is the entire problem. It asks only
 *      "could the headline have seen it?", and for an uncategorized row the honest answer is
 *      *unknown*, which is why it sits in the denominator and not the numerator.
 *   2. ONE LANDSCAPE GATE, ON THE CATEGORY ([[N42]]). The coverage query adopts `getMonthlyActuals`'s
 *      predicate set exactly, and landscape enters once, through `isScoredCategory`'s first conjunct.
 *      Previously the caveat filtered the ACCOUNT's landscape while the figures it caveated gated the
 *      CATEGORY's — different columns, different tables, and the sets are not nested either way, so a
 *      vacation paid from a capital savings account and mapped to `Travel` moved the hero and was
 *      absent from the caveat. It now does both. The stated cost: an uncategorized brokerage purchase
 *      sits in the denominator and drags the share down. That is the correct reading — it genuinely
 *      *might* be the `Travel` case — and it is self-resolving, because mapping it to a capital
 *      category makes it known-unscored and it leaves both halves.
 *   3. KNOWN-UNSCORED SPEND LEAVES BOTH HALVES ([[N41]]). The previous denominator was every
 *      operational-account transaction — income, `Transfers`, `fixed`, `variable-necessary`, capital
 *      mappings — asserting the figures above it were computed over that set. They were not. A
 *      `Groceries` charge is *known* not to belong to the scored set: it is not spend the headline
 *      failed to see, it is spend the headline correctly ignored.
 *
 * `coverageShare = scoredSpend / (scoredSpend + unattributedSpend)`.
 *
 * It is a REQUIRED third parameter of `monthOutlook` rather than an optional one, and that is the
 * whole point. An optional coverage is one a renderer forgets, and a hero with no stated basis in a
 * phase whose thesis is "no confidently wrong numbers" is the defect this parameter exists to
 * prevent. The compiler enforces it; `monthOutlook.test.ts` pins the enforcement with a
 * `@ts-expect-error` that fails the build as an unused directive the moment it becomes optional.
 */
export interface CategorizationCoverage {
  /** Spend the headline could see: mapped to a name some category row scores. */
  scoredSpend: number;
  scoredCount: number;
  /** Spend the headline could not account for: unmapped, or mapped to a name no category carries. */
  unattributedSpend: number;
  unattributedCount: number;
  /**
   * The orphaned subset of the unattributed figures — `mapped_category` matching no row at all.
   *
   * Reported separately because it has a different cause and a different fix ([[N43]]): a rename
   * through `PATCH /api/categories` does not remap the transactions, so the spend vanishes from the
   * category's `actual`. Counting an orphan as *categorized*, which is what a
   * `mapped_category IS NOT NULL` test does, makes confidence rise exactly as truth falls. Counting
   * it as unattributed moves it into the denominator only and the share DROPS, which is the one
   * direction that cannot mislead.
   */
  orphanedSpend: number;
  orphanedCount: number;
  /**
   * The unrounded fraction, or `null` when the population is empty.
   *
   * Never `0`, never `1`, never `NaN` for an empty month: 100%-of-nothing is the most confident
   * possible statement about the least possible evidence, and `0/0` is `NaN`, which compares
   * `false` against the threshold and so refuses *accidentally* — with `NaN%` on the page. The
   * `null` makes the empty case explicit rather than accidentally-right.
   */
  coverageShare: number | null;
  /**
   * `coverageShare` as a FLOORED integer percentage, computed once, here, and never rounded.
   *
   * The floor is load-bearing rather than stylistic. `9999 / 10000` rounds to `100`, which renders
   * "computed over 100% of spend" beside a transaction nobody has categorized — a confidently wrong
   * number generated by a display convention. `100` is reachable only when `unattributedSpend` is
   * exactly `0`.
   */
  coveragePercent: number | null;
  /** `coverageShare !== null && coverageShare >= COVERAGE_THRESHOLD`. */
  authoritative: boolean;
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
  /**
   * `coverage.coverageShare`, `coverage.coveragePercent` and `coverage.authoritative`, surfaced at
   * the top level and copied BY REFERENCE off the coverage record — not recomputed here.
   *
   * This module emits no arithmetic of its own and that rule holds for the bound too: a share
   * re-derived from `scoredSpend` and `unattributedSpend` at this level would land a fifteenth
   * decimal away from the one the caveat prints, and the hero would refuse authority while the
   * sentence under it read 95%. One division, in one place, read twice.
   *
   * They are surfaced rather than left one level down because the refusal is a decision the
   * renderer must not have to assemble: `outlook.authoritative` is a fact about this outlook, and a
   * page that had to reach through `outlook.coverage` to reconstruct it is a page that can forget to.
   */
  coverageShare: number | null;
  coveragePercent: number | null;
  /**
   * Whether the hero may be presented as a VERDICT.
   *
   * ORTHOGONAL to `state`, and deliberately a flag beside the ladder rather than an eighth rung in
   * it. The ladder is closed at seven and TOTALLY ORDERED, and coverage has no correct position in
   * that order: a `low-coverage` state above `breach` would erase a real breach, and below it would
   * never fire in the months that most need it. A boolean composes with all seven at once and
   * destroys no information — a `breach` under low coverage is still a `breach`, and an `on-track`
   * month can be non-authoritative at the same time.
   *
   * `false` does NOT mean "render nothing". §5's exit is that the headline number always ships with
   * the share of spend it actually saw, and a suppressed hero ships nothing, so it cannot ship with
   * its share. What is withdrawn is the confidence, never the information: the three named lists are
   * still true statements about the rows that WERE seen, and a category already $400 over its month
   * is over it whatever the coverage is.
   */
  authoritative: boolean;
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
 * The tolerance the FLOORED percentage is computed with, and the reason it is not zero.
 *
 * [[N53]]. Summing cent-quantized doubles drifts by a few ULPs, and the spec accepts that
 * (`Accepted imprecision, stated`) on the grounds it is irrelevant at a 0.95 threshold *except
 * exactly on it*. Exactly on it is reachable: $1,052.03 of scored spend against $55.37 unattributed
 * is an exact 19:1 ratio — 95.000000% — and split across eight groups it computes to
 * `0.9499999999999998`, whose bare floor prints **94%**. That is a false statement about how much
 * of the month the hero saw, produced entirely by the last two bits of a double.
 *
 * A tolerance of `1e-9` is roughly five orders of magnitude above the drift a month's worth of
 * summation can produce and five orders below one hundredth of a percentage point, so it recovers
 * the intended integer without ever promoting a genuinely lower one.
 *
 * WHAT THIS DOES NOT DO: it does not touch `authoritative`. The comparison keeps the exact
 * `coverageShare >= COVERAGE_THRESHOLD` the spec settled, drift and all, so `COVERAGE_THRESHOLD`
 * still means exactly what it meant. The consequence is stated rather than hidden: a month sitting
 * on the boundary under adverse drift now reports `95` and is still `authoritative: false`. That
 * pairing looks odd and is TRUE — 95% of the spend was seen, and the bound refused on an
 * imprecision the spec pre-accepted — where the previous pairing, `94` and refused, was a number
 * that was simply wrong. Making the two agree means changing what the threshold means, which is a
 * spec question and is not settled here.
 */
const PERCENT_FLOOR_TOLERANCE = 1e-9;

/**
 * `share` as a floored integer percentage, with `100` reachable only on complete attribution.
 *
 * The `Math.min` is not belt-and-braces: it makes "100% means every dollar is attributed" a
 * STRUCTURAL property rather than one that happens to hold because the arithmetic usually lands
 * that way. Without it the tolerance above could, for a large enough population against a single
 * unattributed cent, carry a 99.999999999% share over the line and print the one figure this
 * module is least allowed to print without meaning it.
 */
function flooredPercent(share: number, unattributedSpend: number): number {
  const floored = Math.floor(share * 100 + PERCENT_FLOOR_TOLERANCE);
  return unattributedSpend === 0 ? floored : Math.min(floored, 99);
}

/**
 * One aggregation group, validated before a cent of it is added to anything.
 *
 * The sign clause is the negative control for the whole population rule, not a defensive nicety.
 * This ledger keeps Plaid's convention — POSITIVE IS MONEY OUT — so income is NEGATIVE here. A
 * coverage query that forgot its `amount > 0` filter produces negative sums for the income groups,
 * which makes the denominator LARGER and the share SMALLER: the caveat would refuse authority for
 * entirely the wrong reason, and nobody investigates a pessimistic caveat. So a negative total is
 * rejected loudly rather than shipped as a plausible wrong denominator.
 *
 * Refunds are negative too, and are EXCLUDED rather than netted. That matches `getMonthlyActuals`,
 * which nets nothing: a numerator that nets refunds against a denominator that does not is two
 * populations again, which is the defect this whole step exists to end. The divergence from
 * `components/BudgetMonthlyGrid.tsx`, which does net them, is inherited and taken knowingly.
 */
function assertGroup(group: CoverageGroup): void {
  const label = group.category === null ? 'the unmapped group' : `the group mapped to ${group.category}`;

  assertMoney(group.spend, `spend of ${label}`);
  if (group.spend < 0) {
    throw new RangeError(
      `monthOutlook: ${label} supplied a negative spend ${group.spend}; positive is money out in this ledger, so a negative total means income or refunds reached the population`,
    );
  }

  if (!Number.isInteger(group.count) || group.count < 0) {
    throw new RangeError(
      `monthOutlook: ${label} supplied a count of ${String(group.count)}; a transaction count is a non-negative integer`,
    );
  }
}

/**
 * The as-of month's spend, classified into the share of it the headline could actually see.
 *
 * PURE, and that is the point of it existing here rather than in the page's SQL. The caller issues
 * ONE aggregation grouped by `mapped_category` (NULL included) and hands the groups plus the
 * category rows it already fetched to this function; the four conjuncts of `isScoredCategory` are
 * never re-expressed in a `WHERE` clause, so there is exactly one definition of membership in the
 * app and it is the tested one.
 *
 * See `CategorizationCoverage` for the population and the three-way split it implements.
 */
export function categorizationCoverage(groups: CoverageGroup[], categories: CoverageCategory[]): CategorizationCoverage {
  // Names resolved through the app's single membership test, once, into two sets.
  //
  // `budget_categories` is UNIQUE(name, landscape), so ONE NAME CAN EXIST IN BOTH LANDSCAPES, and
  // `mapped_category` is matched by name. The rule, stated because it would otherwise be inferred
  // from whichever fixture a reader saw first: a group is scored if ANY row carrying its name is
  // scored, known-unscored if rows carry the name but none is scored, and unattributed if no row
  // carries it. Its dollars are counted ONCE whatever the number of matching rows — a set membership
  // test rather than a per-row loop, because a `Travel` defined operational/discretionary AND
  // capital/fixed would otherwise contribute $500 twice and push the share above 1.
  const scoredNames = new Set<string>();
  const knownNames = new Set<string>();
  for (const category of categories) {
    knownNames.add(category.name);
    if (isScoredCategory(category)) scoredNames.add(category.name);
  }

  let scoredSpend = 0;
  let scoredCount = 0;
  let unattributedSpend = 0;
  let unattributedCount = 0;
  let orphanedSpend = 0;
  let orphanedCount = 0;

  for (const group of groups) {
    assertGroup(group);

    if (group.category !== null && scoredNames.has(group.category)) {
      scoredSpend += group.spend;
      scoredCount += group.count;
      continue;
    }

    if (group.category !== null && knownNames.has(group.category)) {
      // KNOWN-UNSCORED: rows carry this name and none of them is scored, so this is spend the
      // headline was never supposed to see. It leaves BOTH halves — a categorized grocery run
      // neither helps nor hurts the bound, because it is not spend the headline failed to see, it
      // is spend the headline correctly ignored. Counting it in the denominator is [[N41]]: a
      // percentage that is confident about the wrong set.
      continue;
    }

    // UNATTRIBUTED: unmapped, or mapped to a name no category row carries. Denominator only,
    // because it MIGHT be discretionary and the headline could not tell — which is precisely what
    // makes it unattributed. The honest answer is *unknown*, and unknown is not seen.
    unattributedSpend += group.spend;
    unattributedCount += group.count;

    if (group.category !== null) {
      orphanedSpend += group.spend;
      orphanedCount += group.count;
    }
  }

  const population = scoredSpend + unattributedSpend;
  // `null`, never `0` and never `1`. `0/0` is `NaN`, and `NaN >= COVERAGE_THRESHOLD` is `false`, so
  // a naive implementation refuses ACCIDENTALLY — right answer, no reasoning, and `NaN%` rendered
  // under it. The explicit empty case is what makes the refusal a decision.
  const coverageShare = population === 0 ? null : scoredSpend / population;

  return {
    scoredSpend,
    scoredCount,
    unattributedSpend,
    unattributedCount,
    orphanedSpend,
    orphanedCount,
    coverageShare,
    // Floored, once, here. Never rounded: `0.9999` rounds to `100` and renders "computed over 100%
    // of spend" beside a dollar nobody has categorized. The floor carries a drift tolerance and
    // the "100 only on complete attribution" rule with it — see `flooredPercent`.
    coveragePercent: coverageShare === null ? null : flooredPercent(coverageShare, unattributedSpend),
    // `>=`, on the FRACTION. A closed floor: exactly 95% is authoritative.
    authoritative: coverageShare !== null && coverageShare >= COVERAGE_THRESHOLD,
  };
}

/**
 * The coverage record's own internal consistency, checked before anything is computed over it.
 *
 * `monthOutlook` takes coverage as data, not as this module's own output — the page could hand it a
 * hand-built object, and a future caller certainly will. The clauses are the ones whose violation
 * produces a plausible number rather than an obvious one:
 *
 *   - NOT A NUMBER ([[N20]]). These six figures cross the same unchecked `db.query<T>()` boundary
 *     every other money field does, and `'6000' + 500` is `'6000500'` with no type error anywhere.
 *   - NEGATIVE. Income is negative in this ledger, so a negative figure here means the population
 *     admitted income and the share is wrong in the reassuring-looking pessimistic direction.
 *   - ORPHANED ABOVE UNATTRIBUTED. Orphans are a SUBSET of the unattributed rows, by construction.
 *     A caller reporting more orphaned dollars than unattributed ones has computed the two over
 *     different sets, which is the exact defect this step exists to end, and the arithmetic it
 *     enables is a share above `1`.
 */
function assertCoverage(coverage: CategorizationCoverage): void {
  const figures: Array<[number, string]> = [
    [coverage.scoredSpend, 'coverage.scoredSpend'],
    [coverage.scoredCount, 'coverage.scoredCount'],
    [coverage.unattributedSpend, 'coverage.unattributedSpend'],
    [coverage.unattributedCount, 'coverage.unattributedCount'],
    [coverage.orphanedSpend, 'coverage.orphanedSpend'],
    [coverage.orphanedCount, 'coverage.orphanedCount'],
  ];

  for (const [value, what] of figures) {
    assertMoney(value, what);
    if (value < 0) {
      throw new RangeError(
        `monthOutlook: ${what} is ${value}; every coverage figure is a non-negative magnitude, and positive is money out in this ledger`,
      );
    }
  }

  if (coverage.orphanedSpend > coverage.unattributedSpend) {
    throw new RangeError(
      `monthOutlook: coverage.orphanedSpend ${coverage.orphanedSpend} exceeds coverage.unattributedSpend ${coverage.unattributedSpend}; orphaned spend is a subset of unattributed spend`,
    );
  }
  if (coverage.orphanedCount > coverage.unattributedCount) {
    throw new RangeError(
      `monthOutlook: coverage.orphanedCount ${coverage.orphanedCount} exceeds coverage.unattributedCount ${coverage.unattributedCount}; orphaned transactions are a subset of unattributed ones`,
    );
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
  assertCoverage(coverage);
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
    // Copied by reference off the caller's record, not recomputed. `Object.is`-identical to the
    // values the caveat prints, so the hero and the sentence under it cannot disagree.
    coverageShare: coverage.coverageShare,
    coveragePercent: coverage.coveragePercent,
    authoritative: coverage.authoritative,
  };
}
