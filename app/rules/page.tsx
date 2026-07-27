import db from '@/lib/db';
import type { BudgetCategory } from '@/shared/types';
import RulesManager, { type RuleRow } from '@/components/RulesManager';

async function getData() {
  const [rows, cats, pending] = await Promise.all([
    db.query<RuleRow>(`
      SELECT t.plaid_category,
             COUNT(t.id)::int                                           AS count,
             COUNT(t.id) FILTER (WHERE t.mapped_category IS NULL)::int AS uncategorized,
             cr.mapped_category
      FROM transactions t
      LEFT JOIN category_rules cr ON cr.plaid_category = t.plaid_category
      WHERE t.plaid_category IS NOT NULL
      GROUP BY t.plaid_category, cr.mapped_category
      ORDER BY cr.mapped_category NULLS FIRST, COUNT(t.id) DESC
    `),
    db.query<Pick<BudgetCategory, 'name' | 'landscape'>>(
      'SELECT name, landscape FROM budget_categories ORDER BY name'
    ),
    db.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM transactions t
      JOIN category_rules cr ON cr.plaid_category = t.plaid_category
      WHERE t.mapped_category IS NULL OR t.rule_applied = TRUE
    `),
  ]);
  return { rows: rows.rows, categories: cats.rows, pendingApply: Number(pending.rows[0].count) };
}

export default async function RulesPage() {
  const { rows, categories, pendingApply } = await getData();
  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Category Rules</h1>
        <p className="text-sm text-slate-500 mt-1">Map Plaid categories to your budget categories. Applied automatically on each sync.</p>
      </div>
      <RulesManager rows={rows} categories={categories} pendingApply={pendingApply} />
    </div>
  );
}
