// What a category is PLANNED to spend, month by month.
//
// EXTRACTED, NOT COPIED, and the distinction matters here. `lib/domain/adherence.ts` documents that
// four separate even-spread implementations exist — the grid, the grid client's label, the budget
// page and the chat route — and deliberately declines to become their shared home, because
// migrating all four is "a separate change with a real blast radius".
//
// This module is a SLICE of that migration, not a fifth copy: the phone's budget endpoint needed
// the same rule, and adding a consumer is the moment to extract rather than duplicate. Two callers
// share it now — `components/BudgetMonthlyGrid.tsx` and `app/api/v1/budget-grid` — so the count went
// from four to three. The grid client's label and the chat route are untouched and still their own;
// finishing that is still the separate change adherence.ts describes.

/**
 * A present, full-length schedule is authoritative per month; everything else spreads the annual
 * budget evenly.
 *
 * The length check is not defensive noise — `budget_categories.monthly_amounts` is nullable and the
 * column's own constraint treats a wrong-length or all-zero array as "no custom schedule", so a
 * partial array must fall back rather than be padded. Padding would invent a plan of zero for the
 * months it did not cover, and a plan of zero reads as "budgeted nothing" rather than "not
 * budgeted".
 */
export function monthsBudget(annual: number, monthlyAmounts: number[] | null): number[] {
  if (monthlyAmounts && monthlyAmounts.length === 12) return monthlyAmounts;
  return new Array(12).fill(annual / 12);
}
