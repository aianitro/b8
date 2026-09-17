import db from '@/lib/db';
import type { ApiResponse } from '@/shared/types';

// Retroactively apply all rules to:
// - uncategorized transactions matching a rule
// - transactions previously set by a rule (rule_applied = TRUE) — re-applies in case rule changed
// Does NOT touch manual categorizations (mapped_category IS NOT NULL AND rule_applied = FALSE)
export async function POST() {
  const result = await db.query<{ count: string }>(`
    WITH updated AS (
      UPDATE transactions t
      SET mapped_category = cr.mapped_category,
          rule_applied = TRUE
      FROM category_rules cr
      WHERE cr.plaid_category = t.plaid_category
        AND (t.mapped_category IS NULL OR t.rule_applied = TRUE)
      RETURNING t.id
    )
    SELECT COUNT(*)::text AS count FROM updated
  `);
  const updated = Number(result.rows[0].count);
  return Response.json({ success: true, data: { updated } } satisfies ApiResponse<{ updated: number }>);
}
