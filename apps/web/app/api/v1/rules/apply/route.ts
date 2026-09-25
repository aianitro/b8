import db from '@/lib/db';
import type { ApiResponse } from '@b8/contracts/types';

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
      -- BOTH KINDS, with the merchant rule winning where both could claim a row. A NOT EXISTS
      -- rather than an ordering: a category rule is skipped for any row a merchant rule also
      -- matches, which is the same precedence lib/domain/categoryRules.ts applies at sync time
      -- and must not disagree with it.
      WHERE (
              (cr.merchant_name IS NOT NULL
                 AND LOWER(TRIM(t.merchant_name)) = LOWER(TRIM(cr.merchant_name)))
           OR (cr.plaid_category IS NOT NULL
                 AND cr.plaid_category = t.plaid_category
                 AND NOT EXISTS (
                       SELECT 1 FROM category_rules m
                        WHERE m.merchant_name IS NOT NULL
                          AND LOWER(TRIM(m.merchant_name)) = LOWER(TRIM(t.merchant_name))))
            )
        AND (t.mapped_category IS NULL OR t.rule_applied = TRUE)
      RETURNING t.id
    )
    SELECT COUNT(*)::text AS count FROM updated
  `);
  const updated = Number(result.rows[0].count);
  return Response.json({ success: true, data: { updated } } satisfies ApiResponse<{ updated: number }>);
}
