export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { ArrowLeft, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import db from '@/lib/db';
import CategoryBalanceEdit from '@/components/CategoryBalanceEdit';
import CategoryNameEdit from '@/components/CategoryNameEdit';
import CategoryMonthlyBudget from '@/components/CategoryMonthlyBudget';
import CategorySelect from '@/components/CategorySelect';
import type { BudgetCategory } from '@/shared/types';

const fmtAbs = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Math.abs(n));

type TxRow = {
  id: number;
  date: string;
  amount: string;
  name: string | null;
  merchant_name: string | null;
  account_name: string;
  account_landscape: string;
};

type TxWithBalance = {
  id: number; date: string; amount: number;
  name: string | null; merchant_name: string | null;
  account_name: string; account_landscape: string;
  balance: number;
};

type MonthGroup = {
  key: string;
  openingBalance: number; closingBalance: number;
  transactions: TxWithBalance[];
};

const LANDSCAPE_COLORS: Record<string, { badge: string; bar: string }> = {
  operational: { badge: 'bg-blue-50 text-blue-600',   bar: 'bg-blue-500'   },
  capital:     { badge: 'bg-violet-50 text-violet-600', bar: 'bg-violet-500' },
};

export default async function CategoryStatementPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  const year = new Date().getFullYear();
  const currentMonth = new Date().getMonth(); // 0-indexed

  const [categoryRes, balanceRes, txRes, categoriesRes] = await Promise.all([
    db.query<Pick<BudgetCategory, 'id' | 'name' | 'landscape' | 'annual_budget' | 'exclude_from_budget' | 'monthly_amounts' | 'is_income'>>(
      'SELECT id, name, landscape, annual_budget, exclude_from_budget, monthly_amounts, is_income FROM budget_categories WHERE name = $1 ORDER BY id LIMIT 1',
      [name]
    ),
    db.query<{ beginning_balance: string }>(
      'SELECT beginning_balance FROM category_balances WHERE category_name = $1 AND year = $2',
      [name, year]
    ),
    db.query<TxRow>(
      `SELECT t.id, t.date::text, t.amount::text, t.name, t.merchant_name,
              a.name AS account_name, a.landscape AS account_landscape
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE t.mapped_category = $1 AND EXTRACT(YEAR FROM t.date) = $2 AND a.track_transactions = TRUE
       ORDER BY t.date ASC, t.id ASC`,
      [name, year]
    ),
    db.query<Pick<BudgetCategory, 'name' | 'landscape' | 'exclude_from_budget'>>(
      'SELECT name, landscape, exclude_from_budget FROM budget_categories ORDER BY name'
    ),
  ]);

  const category = categoryRes.rows[0];
  if (!category) {
    return (
      <div className="p-8 text-slate-400">Category not found.</div>
    );
  }

  const beginningBalance = Number(balanceRes.rows[0]?.beginning_balance ?? 0);
  const colors = LANDSCAPE_COLORS[category.landscape] ?? LANDSCAPE_COLORS.operational;
  const categories = categoriesRes.rows;

  // Build month groups with running balance
  const grouped = new Map<string, TxRow[]>();
  for (const t of txRes.rows) {
    const key = t.date.slice(0, 7);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(t);
  }

  let runningBalance = beginningBalance;
  const months: MonthGroup[] = [];

  for (const [key, txns] of grouped) {
    const opening = runningBalance;
    const txnsWithBal: TxWithBalance[] = txns.map((t) => {
      const amount = Number(t.amount);
      runningBalance -= amount; // positive amount (expense) decreases balance; negative (income) increases
      return {
        id: t.id, date: t.date, amount, name: t.name, merchant_name: t.merchant_name,
        account_name: t.account_name, account_landscape: t.account_landscape, balance: runningBalance,
      };
    });
    months.push({ key, openingBalance: opening, closingBalance: runningBalance, transactions: txnsWithBal });
  }
  const endingBalance = runningBalance;

  // YTD stats
  const ytdTxns = txRes.rows.filter((t) => parseInt(t.date.slice(5, 7)) - 1 <= currentMonth);
  const ytdIncome   = ytdTxns.reduce((s, t) => s + Math.max(-Number(t.amount), 0), 0);
  const ytdExpenses = ytdTxns.reduce((s, t) => s + Math.max( Number(t.amount), 0), 0);
  const ytdNet      = ytdIncome - ytdExpenses;

  // Per-month actual totals for the monthly budget panel, sign-adjusted so positive means
  // "counts toward this category's budget" (mirrors BudgetMonthlyGrid.tsx's SQL CASE).
  const monthlyActuals = new Array(12).fill(0);
  for (const t of txRes.rows) {
    const monthIdx = parseInt(t.date.slice(5, 7), 10) - 1;
    const amount = Number(t.amount);
    monthlyActuals[monthIdx] += category.is_income ? -amount : amount;
  }
  const monthlyAmounts = category.monthly_amounts
    ? category.monthly_amounts.map(Number)
    : null;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link href="/categories" className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <CategoryNameEdit id={category.id} name={category.name} />
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors.badge}`}>
                {category.landscape}
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-1">{year} statement · across every account</p>
          </div>
        </div>

        {/* Balance summary */}
        <div className="flex items-center gap-6 text-sm">
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Beginning</p>
            <CategoryBalanceEdit categoryName={category.name} value={beginningBalance} />
          </div>
          <div className={`w-px h-8 ${colors.bar} opacity-30`} />
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Ending</p>
            <p className={`font-mono font-bold text-base ${endingBalance >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
              {fmtAbs(endingBalance)}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-8">

        {/* YTD summary strip */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'YTD Income',   value: ytdIncome,   icon: TrendingUp,   color: 'text-emerald-600' },
            { label: 'YTD Expenses', value: ytdExpenses, icon: TrendingDown, color: 'text-red-500'     },
            { label: 'YTD Net',      value: ytdNet,      icon: Minus,        color: ytdNet >= 0 ? 'text-emerald-600' : 'text-red-500' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
                <Icon size={14} className={color} />
              </div>
              <p className={`font-mono font-bold text-xl ${color}`}>
                {value !== 0 ? fmtAbs(value) : '—'}
              </p>
            </div>
          ))}
        </div>

        {/* Monthly budget allocation */}
        {!category.exclude_from_budget && (
          <CategoryMonthlyBudget
            categoryId={category.id}
            categoryName={category.name}
            annualBudget={Number(category.annual_budget)}
            monthlyAmounts={monthlyAmounts}
            isIncome={category.is_income}
            monthlyActuals={monthlyActuals}
            currentMonth={currentMonth}
            year={year}
          />
        )}

        {/* Flat transaction list */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {txRes.rows.length === 0 ? (
            <p className="text-slate-400 text-sm p-12 text-center">No transactions yet for {year}.</p>
          ) : (
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-28" />
                <col />
                <col className="w-32" />
                <col className="w-44" />
                <col className="w-28" />
                <col className="w-32" />
              </colgroup>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Merchant</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Account</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Category</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">Amount</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">Balance</th>
                </tr>
              </thead>
              <tbody>
                {months.flatMap((m) => m.transactions).map((t, i) => {
                  const isIncome = t.amount < 0;
                  return (
                    <tr key={t.id} className={`border-b border-slate-50 last:border-0 hover:bg-slate-50/40 transition-colors ${i % 2 === 1 ? 'bg-slate-50/20' : ''}`}>
                      <td className="px-4 py-3 text-xs font-mono text-slate-400">{t.date}</td>
                      <td className="px-4 py-3 min-w-0">
                        <div className="font-medium text-slate-800 truncate">
                          {t.merchant_name ?? t.name ?? <span className="text-slate-300">—</span>}
                        </div>
                        {t.name && t.merchant_name && t.name !== t.merchant_name && (
                          <div className="text-xs text-slate-400 truncate mt-0.5">{t.name}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 truncate">{t.account_name}</td>
                      <td className="px-4 py-3">
                        <CategorySelect
                          transactionId={t.id}
                          current={name}
                          categories={categories}
                          description={t.name ?? t.merchant_name}
                        />
                      </td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold whitespace-nowrap ${isIncome ? 'text-emerald-600' : 'text-slate-800'}`}>
                        {isIncome ? '+' : '−'}{fmtAbs(t.amount)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-500 whitespace-nowrap">
                        {fmtAbs(t.balance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400" colSpan={3}>
                    {txRes.rows.length} transactions
                  </td>
                  <td className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">Total</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                    <div className="text-emerald-600">+{fmtAbs(ytdIncome)}</div>
                    <div className="text-slate-700">−{fmtAbs(ytdExpenses)}</div>
                  </td>
                  <td className={`px-4 py-3 text-right font-mono font-bold whitespace-nowrap ${endingBalance >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
                    {fmtAbs(endingBalance)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Year summary */}
        <div className="bg-slate-900 text-white rounded-2xl p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">{year} Summary</p>
          <div className="grid grid-cols-4 gap-6">
            {[
              { label: 'Beginning Balance', value: fmtAbs(beginningBalance), color: 'text-slate-300' },
              { label: 'Total Income',      value: fmtAbs(ytdIncome),        color: 'text-emerald-400' },
              { label: 'Total Expenses',    value: fmtAbs(ytdExpenses),      color: 'text-red-400'     },
              { label: 'Ending Balance',    value: fmtAbs(endingBalance),    color: endingBalance >= 0 ? 'text-white' : 'text-red-400' },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{label}</p>
                <p className="font-mono font-bold text-lg text-white">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
