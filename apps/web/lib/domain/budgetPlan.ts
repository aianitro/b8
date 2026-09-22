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

/**
 * What each month AFTER the current one is projected to be.
 *
 * A scheduled category uses its schedule. Everything else spreads the REMAINING annual budget across
 * the months still to come — the current month included in the count — so the projection
 * self-corrects: under pace so far raises the months ahead, over pace lowers them.
 *
 * NEGATIVE IS MEANINGFUL ON AN EXPENSE — the budget is spent, no room is left, and the cell grades
 * itself on that. ON INCOME IT IS NONSENSE, and the web's comment records what it cost: a category
 * with no budget and no schedule projected (0 − 862) / 4 = −$215.50 into each remaining month, money
 * flowing backwards out of something that had only ever taken it in. The cell printed $215 while the
 * totals row subtracted $215.50 — the sign on screen contradicting the sign in the sum, three months
 * running. A category with nothing planned projects nothing.
 */
export function monthsUpcoming(
  annual: number,
  monthlyAmounts: number[] | null,
  monthsBudgetArr: number[],
  ytd: number,
  currentMonth: number,
  isIncome: boolean
): number[] {
  const upcoming = new Array(12).fill(0);
  if (monthlyAmounts) {
    for (let i = currentMonth + 1; i < 12; i++) upcoming[i] = monthsBudgetArr[i];
    return upcoming;
  }
  const remainingMonths = 12 - currentMonth;
  if (remainingMonths <= 0) return upcoming;
  const perMonth = (annual - ytd) / remainingMonths;
  const projected = isIncome && perMonth < 0 ? 0 : perMonth;
  for (let i = currentMonth + 1; i < 12; i++) upcoming[i] = projected;
  return upcoming;
}
