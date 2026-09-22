// The monthly budget grid: twelve months by category, plan against actual.
//
// ROADMAP.md §5 Phase 3, the budget page on the phone. The web renders this as a server component
// reading the database directly — like `accounts` and `properties` before it — so a second client
// needs an endpoint that did not exist. The third time that has happened, and each time the gap was
// invisible until something other than the web asked for the same data.
//
// SHAPED FOR THE GRID, NOT FOR `budget_categories`. Twelve-entry arrays are POSITIONAL, January
// first, matching `monthlySpending` in the overview payload so the two read the same way. A row
// carries its plan and its actual separately because the whole page is the comparison between them.

import { z } from 'zod';

const money = z.number();
/** Twelve entries, January first. Positional, like `monthlySpending`. */
const twelve = z.array(money).length(12, 'positional, January first — twelve entries');

export const BudgetGridRowSchema = z.object({
  id: z.int(),
  category: z.string(),
  /** Income rows are summed with the sign flipped, so a row's figures are always magnitudes. */
  isIncome: z.boolean(),
  annualBudget: money,
  /** What each month is PLANNED to be: an explicit schedule, or the annual spread evenly. */
  plan: twelve,
  /** What each month ACTUALLY was. Zero for months that have not happened. */
  actual: twelve,
  ytd: money,
});

export const BudgetGridDataSchema = z.object({
  year: z.int(),
  landscape: z.string(),
  /** 0-indexed, so it lines up with the positional arrays above. */
  currentMonth: z.int().min(0).max(11),
  /** The top-level figure the year nets everything else against. */
  beginningBalance: money,
  rows: z.array(BudgetGridRowSchema),
  totals: z.object({
    budget: money,
    spent: money,
    remaining: money,
    /** Where the year closes if the plan holds — the same figure the dashboard's KPI carries. */
    projectedProfitLoss: money,
  }),
});

export type BudgetGridRow = z.infer<typeof BudgetGridRowSchema>;
export type BudgetGridData = z.infer<typeof BudgetGridDataSchema>;

export const BudgetGridResponseSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), data: BudgetGridDataSchema }),
  z.object({ success: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);
