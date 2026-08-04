export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import Link from 'next/link';
import db from '@/lib/db';
import type { Transaction, BudgetCategory } from '@/shared/types';
import TransactionFilter from '@/components/TransactionFilter';
import TransactionTable from '@/components/TransactionTable';

type GroupPeer = { account_name: string; amount: string };

type TxRow = Transaction & {
  account_name: string;
  account_landscape: string;
  transfer_group_id: number | null;
  group_peers: GroupPeer[] | null;
};

type AccountOption = { id: string; name: string; landscape: string };

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

async function getData(
  uncategorizedOnly: boolean,
  accountId: string | null,
  category: string | null,
  month: number | null,
  search: string | null,
  dateFrom: string | null,
  dateTo: string | null,
  amountMin: number | null,
  amountMax: number | null,
  transferGroup: number | null,
) {
  const conds: string[] = [];
  const args: (string | number)[] = [];

  if (accountId) {
    args.push(accountId);
    conds.push(`t.account_id = $${args.length}`);
  }
  if (uncategorizedOnly) conds.push('t.mapped_category IS NULL AND t.hidden = FALSE');
  if (category) {
    args.push(category);
    conds.push(`t.mapped_category = $${args.length}`);
  }
  if (month) {
    args.push(month);
    conds.push(`EXTRACT(MONTH FROM t.date) = $${args.length}`);
    conds.push(`EXTRACT(YEAR FROM t.date) = EXTRACT(YEAR FROM CURRENT_DATE)`);
  }
  if (search) {
    args.push(`%${search}%`);
    const n = args.length;
    const num = parseFloat(search.replace(/,/g, ''));
    if (!isNaN(num)) {
      args.push(`${Math.abs(num)}%`);
      const m = args.length;
      conds.push(`(t.merchant_name ILIKE $${n} OR t.name ILIKE $${n} OR ABS(t.amount)::text LIKE $${m})`);
    } else {
      conds.push(`(t.merchant_name ILIKE $${n} OR t.name ILIKE $${n})`);
    }
  }
  if (dateFrom) {
    args.push(dateFrom);
    conds.push(`t.date >= $${args.length}`);
  }
  if (dateTo) {
    args.push(dateTo);
    conds.push(`t.date <= $${args.length}`);
  }
  if (amountMin !== null) {
    args.push(amountMin);
    conds.push(`ABS(t.amount) >= $${args.length}`);
  }
  if (amountMax !== null) {
    args.push(amountMax);
    conds.push(`ABS(t.amount) <= $${args.length}`);
  }
  if (transferGroup !== null) {
    args.push(transferGroup);
    conds.push(`t.transfer_group_id = $${args.length}`);
  }

  const where = conds.length ? `AND ${conds.join(' AND ')}` : '';

  const [txns, cats, counts, accounts] = await Promise.all([
    db.query<TxRow>(
      `SELECT t.id, t.plaid_transaction_id, t.account_id, t.date::text AS date,
              t.amount, t.name, t.merchant_name, t.plaid_category, t.mapped_category,
              t.rule_applied, t.created_at, t.transfer_group_id, t.hidden,
              a.name AS account_name, a.landscape AS account_landscape,
              (SELECT jsonb_agg(jsonb_build_object('account_name', a2.name, 'amount', t2.amount) ORDER BY t2.id)
                 FROM transactions t2 JOIN accounts a2 ON a2.id = t2.account_id
                WHERE t2.transfer_group_id = t.transfer_group_id AND t2.id != t.id
              ) AS group_peers
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE 1=1 AND a.track_transactions = TRUE ${where} ORDER BY t.date DESC, t.id DESC`,
      args
    ),
    db.query<Pick<BudgetCategory, 'name' | 'landscape' | 'exclude_from_budget'>>(
      'SELECT name, landscape, exclude_from_budget FROM budget_categories ORDER BY name'
    ),
    db.query<{ total: string; uncategorized: string; sum: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE mapped_category IS NULL AND t.hidden = FALSE)::text AS uncategorized,
              COALESCE(SUM(t.amount), 0)::text AS sum
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE a.track_transactions = TRUE ${where}`,
      args
    ),
    db.query<AccountOption>(
      `SELECT a.id, a.name, a.landscape
       FROM accounts a
       JOIN transactions t ON t.account_id = a.id
       GROUP BY a.id, a.name, a.landscape
       ORDER BY a.name`
    ),
  ]);
  return {
    transactions: txns.rows,
    categories: cats.rows,
    total: Number(counts.rows[0].total),
    uncategorized: Number(counts.rows[0].uncategorized),
    sum: Number(counts.rows[0].sum),
    accounts: accounts.rows,
  };
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n));

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    filter?: string; account?: string; category?: string; month?: string; search?: string;
    dateFrom?: string; dateTo?: string; amountMin?: string; amountMax?: string; transferGroup?: string;
  }>;
}) {
  const {
    filter, account, category, month, search, dateFrom, dateTo, amountMin, amountMax, transferGroup,
  } = await searchParams;

  const uncategorizedOnly = filter === 'uncategorized';
  const accountId = account ?? null;
  const drillCategory = category ?? null;
  const drillMonth = month ? parseInt(month, 10) : null;
  const searchQuery = search?.trim() || null;
  const dateFromValue = dateFrom || null;
  const dateToValue = dateTo || null;
  const amountMinValue = amountMin ? parseFloat(amountMin) : null;
  const amountMaxValue = amountMax ? parseFloat(amountMax) : null;
  const transferGroupValue = transferGroup ? parseInt(transferGroup, 10) : null;

  const { transactions, categories, total, uncategorized, sum, accounts } = await getData(
    uncategorizedOnly, accountId, drillCategory, drillMonth, searchQuery,
    dateFromValue, dateToValue,
    amountMinValue !== null && !isNaN(amountMinValue) ? amountMinValue : null,
    amountMaxValue !== null && !isNaN(amountMaxValue) ? amountMaxValue : null,
    transferGroupValue !== null && !isNaN(transferGroupValue) ? transferGroupValue : null,
  );

  const isDrilldown = Boolean(drillCategory && drillMonth);
  const drillLabel = isDrilldown
    ? `${drillCategory} · ${MONTH_NAMES[(drillMonth ?? 1) - 1]} ${new Date().getFullYear()}`
    : null;
  const isTransferGroup = Boolean(transferGroupValue !== null && !isNaN(transferGroupValue));

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {isDrilldown && (
        <div className="flex items-center gap-2 mb-4 text-sm">
          <a href="/budget?view=monthly" className="text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            Budget
          </a>
          <span className="text-slate-300">/</span>
          <span className="text-slate-600 font-medium">{drillLabel}</span>
        </div>
      )}

      {isTransferGroup && (
        <div className="flex items-center gap-2 mb-4 text-sm">
          <a href="/transactions" className="text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            Transactions
          </a>
          <span className="text-slate-300">/</span>
          <span className="text-violet-600 font-medium">Transfer group</span>
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">
          {isDrilldown ? drillLabel : isTransferGroup ? 'Linked transfer' : 'Transactions'}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {total.toLocaleString()} transaction{total !== 1 ? 's' : ''}
          <span className="text-slate-300 mx-1.5">·</span>
          <span className={`font-mono font-medium ${sum < 0 ? 'text-emerald-600' : 'text-slate-700'}`}>
            {sum < 0 ? '+' : sum > 0 ? '−' : ''}{fmt(sum)}
          </span>
        </p>
      </div>

      {!isDrilldown && !isTransferGroup && (
        <Suspense>
          <TransactionFilter
            total={total}
            uncategorized={uncategorized}
            accounts={accounts}
            activeAccount={accountId}
          />
        </Suspense>
      )}

      {transactions.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
          <p className="text-slate-400 text-sm">
            {isDrilldown
              ? `No transactions for ${drillLabel}.`
              : isTransferGroup
              ? 'Transfer group not found.'
              : searchQuery
              ? `No transactions matching "${searchQuery}".`
              : uncategorizedOnly
              ? 'No uncategorized transactions — great!'
              : <>No transactions yet. <Link href="/accounts" className="underline text-blue-600">Sync an account.</Link></>}
          </p>
        </div>
      ) : (
        <TransactionTable transactions={transactions} categories={categories} accounts={accounts} />
      )}
    </div>
  );
}
