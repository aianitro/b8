// Budget-schedule math, extracted from the categories API route so it can be unit tested
// without a DB (ROADMAP.md §2, testing priority tier 1).
//
// The invariant these enforce: a category's annual_budget and its 12-month schedule can
// never drift apart. When a schedule exists, its total is authoritative.

export const MONTHS_PER_YEAR = 12;

/** Rounds to cents, avoiding the float dust that accumulates when summing 12 allocations. */
export function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Coerces arbitrary JSON input into a valid 12-month allocation schedule.
 * Returns null for anything that isn't a usable schedule — wrong length, not an array, or
 * all zeros — which is the app's representation of "this category has no custom schedule."
 */
export function normalizeMonthlyAmounts(input: unknown): number[] | null {
  if (!Array.isArray(input) || input.length !== MONTHS_PER_YEAR) return null;
  const amounts = input.map((v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? roundCents(n) : 0;
  });
  return amounts.some((n) => n > 0) ? amounts : null;
}

/**
 * The schedule's total wins when one is present, so a caller passing both a schedule and a
 * conflicting annual_budget can't put the two out of sync.
 */
export function resolveAnnualBudget(amounts: number[] | null, annualBudget: number): number {
  if (!amounts) return annualBudget;
  return roundCents(amounts.reduce((s, n) => s + n, 0));
}
