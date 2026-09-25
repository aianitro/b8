// Live data, so never prerendered. Its siblings all carry this line; these three did not, and
// the gap was invisible until `next build` ran without a database and tried to statically
// generate them. Nothing about the page was wrong — the missing declaration was.
export const dynamic = 'force-dynamic';

import db from '@/lib/db';
import type { BudgetCategory } from '@b8/contracts/types';
import RulesManager, { type MerchantRuleRow, type RuleRow } from '@/components/RulesManager';

async function getData() {
  const [rows, merchants, cats, pending] = await Promise.all([
    db.query<RuleRow>(`
      SELECT t.plaid_category,
             COUNT(t.id)::int                                           AS count,
             COUNT(t.id) FILTER (WHERE t.mapped_category IS NULL)::int AS uncategorized,
             cr.mapped_category
      FROM transactions t
      -- Same scoping as the payee counts above, for the same reason: these describe the ledger,
      -- and the ledger is what /transactions shows.
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions
      LEFT JOIN category_rules cr ON cr.plaid_category = t.plaid_category
      WHERE t.plaid_category IS NOT NULL
      GROUP BY t.plaid_category, cr.mapped_category
      ORDER BY cr.mapped_category NULLS FIRST, COUNT(t.id) DESC
    `),
    // MERCHANT RULES, with how many rows each one speaks for. A rule the owner cannot see is a
    // rule they cannot undo, and these are created from a one-tap offer in the dashboard's editor
    // — the easiest kind to accumulate without noticing.
    db.query<MerchantRuleRow>(`
      SELECT cr.merchant_name, cr.mapped_category, COUNT(a.id)::int AS count
      FROM category_rules cr
      LEFT JOIN transactions t
        ON LOWER(TRIM(t.merchant_name)) = LOWER(TRIM(cr.merchant_name)) AND NOT t.hidden
      -- SCOPED TO THE LEDGER, because this figure is a link now and must equal the list it opens.
      -- Without it the count included a row on an untracked account, which /transactions filters
      -- out on every query: the rule read "14 transactions" and opened a page showing 13.
      LEFT JOIN accounts a ON a.id = t.account_id AND a.track_transactions
      WHERE cr.merchant_name IS NOT NULL
      GROUP BY cr.merchant_name, cr.mapped_category
      ORDER BY COUNT(a.id) DESC, cr.merchant_name
    `),
    db.query<Pick<BudgetCategory, 'name' | 'landscape'>>(
      'SELECT name, landscape FROM budget_categories ORDER BY name'
    ),
    // Rows a re-apply could move, counting BOTH kinds. Counting only category rules would have
    // reported zero while a merchant rule had work to do.
    //
    // DELIBERATELY NOT scoped to tracked accounts, unlike the two counts above. Those describe the
    // ledger a reader can open; this one describes what pressing "Apply now" will change, and the
    // UPDATE behind that button has no account filter. A figure about an operation should count
    // what the operation touches.
    db.query<{ count: string }>(`
      SELECT COUNT(DISTINCT t.id)::text AS count
      FROM transactions t
      JOIN category_rules cr
        ON (cr.plaid_category IS NOT NULL AND cr.plaid_category = t.plaid_category)
        OR (cr.merchant_name IS NOT NULL
              AND LOWER(TRIM(t.merchant_name)) = LOWER(TRIM(cr.merchant_name)))
      WHERE t.mapped_category IS NULL OR t.rule_applied = TRUE
    `),
  ]);
  return {
    rows: rows.rows,
    merchantRules: merchants.rows,
    categories: cats.rows,
    pendingApply: Number(pending.rows[0].count),
  };
}

export default async function RulesPage() {
  const { rows, merchantRules, categories, pendingApply } = await getData();
  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Category Rules</h1>
        <p className="text-sm text-slate-500 mt-1">Map Plaid categories to your budget categories. Applied automatically on each sync.</p>
      </div>
      <RulesManager rows={rows} merchantRules={merchantRules} categories={categories} pendingApply={pendingApply} />
    </div>
  );
}
