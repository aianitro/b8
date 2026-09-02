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
  return (
    category.landscape === 'operational' &&
    category.exclude_from_budget === false &&
    category.is_income === false &&
    category.control_mode === 'discretionary'
  );
}
