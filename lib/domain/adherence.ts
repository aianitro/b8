// The scored set (ROADMAP.md §5 step 28 / P0.5-28): which budget categories a behavioural
// adherence figure is allowed to range over. This module ships the membership test and nothing
// else — no metric, no averaging, no pacing. Step 29 computes; step 28 decides what to compute
// over.
//
// Why the definition lives in exactly one exported function. An adherence headline is only as
// meaningful as the set it averages, and the set is four conjuncts long — long enough that a
// second implementation would drift from this one on its third conjunct and nobody would see it,
// because both would still return a plausible number. BUILD.md §1 and §9.1 both name that failure
// class, and this codebase has already paid for it once (two independent "pick the latest
// valuation" reducers, since consolidated into latestValueByKey). So: one definition, exported,
// imported by every consumer, and never re-expressed as an inline `.filter(...)` or a fifth
// variation of the same WHERE clause.

import { MONTHS_PER_YEAR, roundCents } from '../budgetMath';
import type { BudgetCategory } from '../../shared/types';

/**
 * The four columns membership depends on, projected off the shared contract rather than
 * re-declared. A caller holding a whole `BudgetCategory` satisfies it structurally, and a caller
 * that has selected only these four columns satisfies it too — without either of them inventing a
 * local shape for a row `shared/types.ts` already describes.
 */
export type ScorableCategory = Pick<
  BudgetCategory,
  'landscape' | 'exclude_from_budget' | 'is_income' | 'control_mode'
>;

/**
 * Whether this category is in the scored set:
 *
 *     landscape = 'operational'
 *       AND exclude_from_budget = FALSE
 *       AND is_income = FALSE
 *       AND control_mode = 'discretionary'
 *
 * All four conjuncts are independently required, and each removes a distinct way for the headline
 * number to be wrong:
 *
 *   - `landscape = 'operational'` — capital is savings and investment movement, not spending
 *     discipline. `control_mode` is physically present on a capital row (the column carries the
 *     same NOT NULL DEFAULT 'fixed' everywhere) and its value there is INERT: it was never
 *     reviewed, because the seed deliberately skipped capital. Reading it without the landscape
 *     gate leaks an unreviewed default into an operational-only figure.
 *   - `exclude_from_budget = FALSE` — an excluded category is not budget spend at all. `Transfer`
 *     is the live example, and admitting it is the same failure class as the transfer that was
 *     once counted as income.
 *   - `is_income = FALSE` — income has a budget line but is not a spending decision; averaging
 *     "adherence" over a salary is a category error, not a rounding one.
 *   - `control_mode = 'discretionary'` — the point of the whole exercise. `fixed` is a debit
 *     somebody already committed to and `variable-necessary` moves with circumstance rather than
 *     choice; per ROADMAP.md §5, "the headline metric covers the categories where behaviour is the
 *     variable; the rest are tracked and reported, never scored." Both are excluded, and
 *     `variable-necessary` is excluded for the same reason as `fixed` — not as a softer case of it.
 *
 * `is_debt_service` is deliberately absent and does not need to be here: a database CHECK
 * (migrations/1788271200000_category-control-mode.sql) forces every `is_debt_service = TRUE` row to
 * `control_mode = 'fixed'`, which the fourth conjunct already rejects. Restating it would be a
 * second, weaker copy of a rule the schema already enforces.
 */
export function isScoredCategory(category: ScorableCategory): boolean {
  // The first three conjuncts are `isTrackedCategory` (below), which the step-29 detectors share.
  // One definition, called twice — not a second copy that drifts on its third conjunct.
  return isTrackedCategory(category) && category.control_mode === 'discretionary';
}

// ---------------------------------------------------------------------------------------------
// Two-sided variance (ROADMAP.md §5 step 29 / P0.5-29): the part that computes.
//
// "How accurately is the budget followed" is not "did I stay under." A category budgeted $500 that
// draws $120 every month for a year is a WRONG BUDGET, not good behaviour, and a metric that
// rewards it teaches the owner to set absurd limits and score perfectly against them. So the
// detector is deliberately two-sided and the two sides are structurally distinct outcomes, never
// collapsed into one number:
//
//   - an overspend BREACH, evaluated per month — this month drew more than it was given;
//   - a chronic-underspend DEFECT, evaluated per window — this budget line is fiction.
//
// The shape is drift.ts's and propertyPnl.ts's: an array of pre-aggregated inputs in, an array of
// findings out, no I/O, no clock. Which months exist is entirely the caller's input — nothing in
// here asks what "today" is, because a suite whose fixtures mean something different in December
// than in March is not a suite.
//
// What this deliberately does NOT do: render. The per-month cell-colour module already grades a
// month green under 100%, amber to 110%, red above. That is the incumbent, and it is exactly what
// cannot express the defect — a category at 24% of budget renders green in all twelve cells, and
// the grid is telling the truth about each cell while being silent about the year. This module is
// not a second colour scale; it is the thing the colour scale structurally cannot say.
//
// It therefore does not import that module, and this file deliberately does not even name it: the
// coupling is checked by a literal grep (SPEC.md acceptance #25), so a mention in a comment is
// indistinguishable from a mention in an import statement. Reusing its `monthPct` would in any
// case be worse than duplication — `monthPct` answers Infinity for an off-cycle month, and a
// non-finite number has no business inside variance arithmetic.

/** One month's already-aggregated actual spend for one category. */
export interface MonthSpend {
  /** Calendar month index, 0 = January — the same indexing `monthly_amounts` uses. */
  month: number;
  /**
   * Expense spend for that month as a NON-NEGATIVE MAGNITUDE, matching how the budget grid's SQL
   * already aggregates it and how `annual_budget` / `monthly_amounts` are stored. This is not the
   * ledger's signed-transaction convention: deriving this figure from `transactions` — respecting
   * `t.hidden = FALSE` and `a.track_transactions = TRUE`, and resolving the sign where the account
   * is known — is the caller's job, exactly as drift.ts takes a `ledgerBalance` rather than rows.
   */
  actual: number;
}

/**
 * A category plus its year of observed spend. The category half is projected off the shared
 * contract rather than re-declared, for the same reason `ScorableCategory` is: a caller holding a
 * whole `BudgetCategory` satisfies it structurally, and nobody invents a local shape for a row
 * `shared/types.ts` already describes.
 */
export type AdherenceInput = ScorableCategory &
  Pick<BudgetCategory, 'id' | 'name' | 'annual_budget' | 'monthly_amounts'> & {
    months: MonthSpend[];
  };

/** One month of a category, resolved into the two magnitudes the detectors compare. */
export interface MonthVariance {
  month: number;
  /** `monthly_amounts[month]` when a schedule exists, else `annual_budget / 12`. Rounded to cents. */
  budgeted: number;
  actual: number;
  /**
   * `actual − budgeted`, always in that order, rounded to cents.
   *
   * Positive is overspend, negative is underspend. Reversing the subtraction inverts breach and
   * defect silently — both sides still produce a plausible dollar figure, and the only symptom is
   * that the app starts reporting thrift as overspending. This is this module's version of the
   * sign trap BUILD.md §10.3 names, and the reason the order is written down here rather than
   * left to be re-derived at each call site.
   */
  variance: number;
  /**
   * `actual / budgeted`, or NULL when nothing was budgeted this month.
   *
   * Null, never Infinity and never NaN. Spend against a $0 budget is unambiguous overspend and
   * needs no ratio to say so; a $0/$0 month is not "0% spent", it is a month with no baseline to
   * be a percentage of. The incumbent per-cell `monthPct` answers Infinity here, which is the
   * whole reason this module computes its own.
   */
  ratio: number | null;
}

/** Shared by both finding kinds: which category, and whether it counts toward the headline. */
interface FindingBase {
  categoryId: number;
  category: string;
  /**
   * Whether this finding belongs to the scored set — i.e. `isScoredCategory` on its category.
   *
   * A flag on the finding, NOT a filter on producing it. A `fixed` mortgage budgeted $2,000 that
   * draws $1,400 every month is a wrong budget line whether or not anyone scores it, and §5's own
   * text — "the rest are tracked and reported, never scored" — says tracked, not invisible. The
   * three landscape/exclusion conjuncts gate whether a finding exists at all; `control_mode` only
   * sets this flag.
   */
  scored: boolean;
}

/** One month that drew more than it was budgeted. */
export interface BreachFinding extends FindingBase, MonthVariance {
  kind: 'breach';
}

/** One category whose every qualifying month in the window came in far under budget. */
export interface ChronicUnderspendFinding extends FindingBase {
  kind: 'chronic-underspend';
  /**
   * The qualifying months, in calendar order — $0-budget months are absent by construction, so
   * this is the evidence for the finding rather than a copy of the caller's input.
   */
  months: MonthVariance[];
  /** Window totals: sums of the already-rounded per-month figures, re-rounded. Never raw floats. */
  budgeted: number;
  actual: number;
  variance: number;
}

export type AdherenceFinding = BreachFinding | ChronicUnderspendFinding;

/**
 * The scored set's aggregate over one input's findings — the headline number a dashboard would
 * eventually show, computed here so there is exactly one definition of it.
 */
export interface ScoredHeadline {
  /** At least 1 by construction: an empty scored set yields `null`, never a row of zeroes. */
  findingCount: number;
  breachCount: number;
  defectCount: number;
  budgeted: number;
  actual: number;
  variance: number;
  /**
   * `variance ÷ budgeted` over the months the scored findings cover, or null when those months
   * budgeted $0 in total — which happens when every scored finding is a $0-budget breach.
   */
  varianceRatio: number | null;
}

/**
 * Below this fraction of a month's budget, that month counts as lean. 50% is a deliberate, stated
 * threshold rather than an emergent one: §5 names the shape ($500 budgeted, $120 drawn) but no
 * number, and a rule with no written threshold is a rule that drifts the first time someone tunes
 * it. Half the budget, every month, for a quarter is not a run of quiet months — it is a limit
 * that was never real.
 */
export const CHRONIC_UNDERSPEND_RATIO = 0.5;

/**
 * How many qualifying months a chronic-underspend window needs before it is reported at all.
 *
 * One lean month is a holiday. Three consecutive-in-the-window lean months is a pattern. Without a
 * floor, the first quiet month of any category reads as "your budget is fiction", which is the
 * fastest way to teach an owner to ignore the finding.
 */
export const CHRONIC_MIN_MONTHS = 3;

/**
 * The three conjuncts `isScoredCategory` shares with both detectors: operational, not excluded,
 * not income.
 *
 * Extracted rather than restated. A second copy of these three would be the drifting-definitions
 * hazard (BUILD.md §1) landing on the very predicate P0.5-28 exists to have one definition of —
 * and it would drift on its third conjunct, quietly, while both copies kept returning plausible
 * booleans. Membership in this set is what §5 calls "tracked and reported": every category the
 * budget is actually about, scored or not.
 */
export function isTrackedCategory(category: ScorableCategory): boolean {
  return (
    category.landscape === 'operational' &&
    category.exclude_from_budget === false &&
    category.is_income === false
  );
}

/**
 * What this category was given for this month.
 *
 * Mirrors `components/BudgetMonthlyGrid.tsx`'s `monthsBudget()`: a present, full-length schedule is
 * authoritative per month, and everything else spreads `annual_budget` evenly. This module
 * computes that rule for its own inputs and deliberately does not become the site the four existing
 * even-spread implementations call through — the grid, the grid client's label, the budget page,
 * and the chat route. Migrating them is a separate change with a real blast radius, and a pure
 * function taking `monthly_amounts: number[] | null` cannot dodge deciding what a null schedule
 * means either way. Stated here rather than left implicit.
 *
 * Deliberately private: exporting it would be an invitation to make this the fifth even-spread
 * implementation's home without doing the migration.
 */
function budgetedForMonth(row: AdherenceInput, month: number): number {
  const schedule = row.monthly_amounts;
  if (schedule && schedule.length === MONTHS_PER_YEAR && month >= 0 && month < MONTHS_PER_YEAR) {
    return roundCents(schedule[month]);
  }
  return roundCents(row.annual_budget / MONTHS_PER_YEAR);
}

function toMonthVariance(row: AdherenceInput, spend: MonthSpend): MonthVariance {
  const budgeted = budgetedForMonth(row, spend.month);
  const actual = roundCents(spend.actual);
  return {
    month: spend.month,
    budgeted,
    actual,
    // Rounded here, per month, not once at the end of the window. Two months of raw float
    // difference is all it takes to land a total a cent away from what a statement says, and the
    // 50% test below would then be comparing against dust.
    variance: roundCents(actual - budgeted),
    ratio: budgeted > 0 ? actual / budgeted : null,
  };
}

/**
 * Breach and chronic-underspend findings for every tracked category in `rows`.
 *
 * Both detectors range over every operational, non-excluded, non-income category — wider than the
 * scored set — and each finding carries `scored` so the headline can narrow later without the
 * detector having narrowed first. A detector quietly restricted to `isScoredCategory` would be
 * blind to exactly the categories where a wrong budget line is most expensive: `fixed` (a mortgage
 * budgeted $2,000 drawing $1,400) and `variable-necessary`.
 *
 * Findings come out in calendar order within a category, breaches before the defect, so two
 * callers passing the same months in different array orders get byte-identical output.
 */
export function detectAdherence(rows: AdherenceInput[]): AdherenceFinding[] {
  const findings: AdherenceFinding[] = [];

  for (const row of rows) {
    if (!isTrackedCategory(row)) continue;

    const scored = isScoredCategory(row);
    const base = { categoryId: row.id, category: row.name, scored };
    const months = [...row.months]
      .sort((a, b) => a.month - b.month)
      .map((spend) => toMonthVariance(row, spend));

    for (const month of months) {
      // Strictly greater. A month landing exactly on its budget is adherence, not a breach, and
      // `>=` would report every perfectly-hit month — including every $0-budgeted, $0-spend one.
      if (month.actual > month.budgeted) {
        findings.push({ kind: 'breach', ...base, ...month });
      }
    }

    // A $0-budget month is excluded from the window whether or not it has spend. With spend it is
    // already an ordinary breach above; without spend it says nothing at all about behaviour, and
    // reading $0/$0 as "fully underspent" would let a category with three dormant months and no
    // budget be reported as a fiction. Neither counts toward the streak nor breaks it.
    const window = months.filter((month) => month.budgeted > 0);

    // EVERY qualifying month, not the average of them. An average under 50% can be produced by one
    // wildly-under month beside on-budget ones (a false defect), and an average can also hide an
    // over-budget month inside a window still reading "chronic" (a defect that is really a breach).
    const chronic =
      window.length >= CHRONIC_MIN_MONTHS &&
      window.every((month) => month.ratio !== null && month.ratio < CHRONIC_UNDERSPEND_RATIO);

    if (chronic) {
      findings.push({
        kind: 'chronic-underspend',
        ...base,
        months: window,
        budgeted: sumCents(window.map((month) => month.budgeted)),
        actual: sumCents(window.map((month) => month.actual)),
        // The sum of already-rounded per-month variances, re-rounded — not a raw float sum of raw
        // differences. On a $1,000 annual budget spread evenly the two disagree by four cents, and
        // the discipline is the same one propertyPnl.ts and drift.ts follow: round per step.
        variance: sumCents(window.map((month) => month.variance)),
      });
    }
  }

  return findings;
}

function sumCents(values: number[]): number {
  return roundCents(values.reduce((sum, n) => sum + n, 0));
}

/**
 * The scored set's headline over one run's findings, or NULL when no finding in it is scored.
 *
 * Null, never 0 and never NaN. This app's own demo dataset produces exactly that input today —
 * `scripts/seed-demo.mjs` never sets `control_mode`, so every seeded row is `fixed` and the scored
 * set is empty (P0.5-28 NITS N7) — and the natural shape of this function, a ratio over the scored
 * findings, divides by zero on it. A zero would be the worse answer of the two available wrong
 * ones: "the budget was followed perfectly" and "there is nothing to score" are different
 * statements, and BUILD.md §10.3's null-is-not-zero rule is the same rule that makes an unvalued
 * property render "—".
 *
 * No month is double-counted: a chronic window contains only months under half their budget, so
 * none of them can also be a breach, and a $0-budget breach month is never in a window.
 */
export function scoredHeadline(findings: AdherenceFinding[]): ScoredHeadline | null {
  const scored = findings.filter((finding) => finding.scored);
  if (scored.length === 0) return null;

  const budgeted = sumCents(scored.map((finding) => finding.budgeted));
  const actual = sumCents(scored.map((finding) => finding.actual));
  const variance = sumCents(scored.map((finding) => finding.variance));

  return {
    findingCount: scored.length,
    breachCount: scored.filter((finding) => finding.kind === 'breach').length,
    defectCount: scored.filter((finding) => finding.kind === 'chronic-underspend').length,
    budgeted,
    actual,
    variance,
    varianceRatio: budgeted > 0 ? variance / budgeted : null,
  };
}
