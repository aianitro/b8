import db from './db';
import type { BudgetCategory } from '@b8/contracts/types';

/** The ledger's own row shape, narrowed. Assignable to `CategoryOption`, which widens `landscape`
 *  to `string` so a picker need not import the enum to render an option. */
export type CategoryOptionRow = Pick<BudgetCategory, 'name' | 'landscape' | 'exclude_from_budget'>;

/**
 * Every budget category, as a picker sees one: a name and the two flags that group it.
 *
 * ─── Why this is not in the /overview payload ─────────────────────────────────────────────────
 *
 * The dashboard reads its figures from that payload and nothing else, on the rule that a figure
 * this screen needs and the payload lacks should be a type error rather than a second query. This
 * is not a figure. It is the option list behind a `<select>` — it does not move with the month, it
 * cannot disagree with anything, and putting it in the contract would grow the phone's payload with
 * a list the phone already fetches from its own endpoint.
 *
 * ─── Why it is a module and not two queries ───────────────────────────────────────────────────
 *
 * The transactions page has read exactly this, inline, since it was written. The dashboard's row
 * editors needed the same list, and the choice was to write it a second time or to lift it. Lifted,
 * for the ordinary reason: `ORDER BY name` is load-bearing — `groupCategories` re-sorts but relies
 * on a stable input — and two spellings of one list eventually order differently.
 */
export async function loadCategoryOptions(): Promise<CategoryOptionRow[]> {
  const { rows } = await db.query<CategoryOptionRow>(
    'SELECT name, landscape, exclude_from_budget FROM budget_categories ORDER BY name'
  );
  return rows;
}
