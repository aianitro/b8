export const dynamic = 'force-dynamic';

import db from '@/lib/db';
import type { BudgetCategory, Account } from '@/shared/types';
import CategoryManager from '@/components/CategoryManager';

async function getCategories(): Promise<BudgetCategory[]> {
  const result = await db.query<BudgetCategory>(
    'SELECT id, name, annual_budget, landscape, exclude_from_budget, is_income, dedicated_account_id, monthly_amounts, created_at FROM budget_categories ORDER BY is_income, exclude_from_budget, landscape, name'
  );
  return result.rows;
}

async function getAccounts(): Promise<Pick<Account, 'id' | 'name' | 'landscape'>[]> {
  const result = await db.query<Pick<Account, 'id' | 'name' | 'landscape'>>(
    'SELECT id, name, landscape FROM accounts WHERE track_transactions = TRUE ORDER BY landscape, name'
  );
  return result.rows;
}

export default async function CategoriesPage() {
  const [categories, accounts] = await Promise.all([getCategories(), getAccounts()]);
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Budget Categories</h1>
        <p className="text-sm text-slate-500 mt-1">Annual budget allocations per landscape.</p>
      </div>
      <CategoryManager categories={categories} accounts={accounts} />
    </div>
  );
}
