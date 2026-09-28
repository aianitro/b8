/**
 * Grouping the rules page's two lists under the category each rule files into.
 *
 * Pure, and here rather than in the component, for the same reason `backupPlan.ts` is: the ordering
 * is the part that can be wrong in a way nobody notices, and a component is an awkward place to
 * test it from.
 *
 * ─── WHY BOTH LISTS GROUP THE SAME WAY ────────────────────────────────────────────────────────
 *
 * The page shows two kinds of rule — one naming a payee, one naming a Plaid category — and both
 * answer the same question: what ends up in this budget category. They were ordered differently
 * (payees by transaction count, Plaid categories by category then count), so reading "everything
 * that feeds Restaurants" meant scanning two lists sorted on two different keys. Grouping both on
 * the category makes that one scan, and makes an accidental duplicate obvious: two payees filed to
 * different categories no longer sit forty rows apart.
 */

/** The shape both row types share, as far as grouping cares. */
export interface Categorised {
  mapped_category: string | null;
}

export interface RuleGroup<T> {
  /** The budget category these rules file into. */
  category: string;
  rows: T[];
  /** Rows in the group, summed — what the category receives through rules of this kind. */
  total: number;
}

/**
 * Group rows by `mapped_category`, alphabetically, preserving the caller's order within each group.
 *
 * ROWS WITH NO CATEGORY ARE EXCLUDED, not collected into an "unmapped" group. The page already has
 * a section for those and gives them a different treatment — an amber heading and a "Map to" prompt
 * rather than a "Maps to" readout — so returning them here would put the same rows in two places.
 * The caller filters; this function refuses to guess by returning them under a placeholder name that
 * would then have to be special-cased at the render site.
 *
 * `localeCompare` rather than `<`: category names are owner-written prose ("Dining out", "Éducation"
 * if it ever comes to that), and the byte order of a capital letter against a lower-case one is not
 * the order a reader expects to find them in.
 *
 * Stable within a group: `Array.prototype.sort` is specified stable in modern JS, but this does not
 * rely on that — it never sorts the rows, only the group keys, so whatever order the query returned
 * survives. That matters because the two callers want different orders inside a group (payees by how
 * many transactions they speak for, Plaid categories likewise) and neither should be re-sorted here.
 */
export function groupRulesByCategory<T extends Categorised>(
  rows: readonly T[],
  countOf: (row: T) => number
): RuleGroup<T>[] {
  const byCategory = new Map<string, T[]>();

  for (const row of rows) {
    const category = row.mapped_category;
    if (category === null || category.trim() === '') continue;
    const bucket = byCategory.get(category);
    if (bucket) bucket.push(row);
    else byCategory.set(category, [row]);
  }

  return [...byCategory.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, groupRows]) => ({
      category,
      rows: groupRows,
      total: groupRows.reduce((sum, row) => sum + countOf(row), 0),
    }));
}
