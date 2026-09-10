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
  /** Explicit tag; null means the attribution is inherited from the account. */
  property_id: number | null;
  /** Nickname of the property this lands on either way — null if it lands on none. */
  effective_property: string | null;
};

type AccountOption = { id: string; name: string; landscape: string };

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

async function getData(
  uncategorizedOnly: boolean,
  accountId: string | null,
  categories: string[],
  month: number | null,
  search: string | null,
  dateFrom: string | null,
  dateTo: string | null,
  amountMin: number | null,
  amountMax: number | null,
  transferGroup: number | null,
) {
  const conds: string[] = [];
  const args: (string | number | string[])[] = [];

  if (accountId) {
    args.push(accountId);
    conds.push(`t.account_id = $${args.length}`);
  }
  if (uncategorizedOnly) conds.push('t.mapped_category IS NULL AND t.hidden = FALSE');
  // One branch for one category and for many: `= ANY($n)` over a text[] is the same plan as `=`
  // for a single element, and a second branch would be a second place for the predicate to drift.
  if (categories.length > 0) {
    args.push(categories);
    conds.push(`t.mapped_category = ANY($${args.length})`);
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

  const [txns, cats, counts, accounts, props] = await Promise.all([
    db.query<TxRow>(
      `SELECT t.id, t.plaid_transaction_id, t.account_id, t.date::text AS date,
              t.amount, t.name, t.merchant_name, t.plaid_category, t.mapped_category,
              t.rule_applied, t.created_at, t.transfer_group_id, t.hidden,
              a.name AS account_name, a.landscape AS account_landscape,
              t.property_id,
              (SELECT p.nickname FROM properties p
                WHERE p.id = COALESCE(t.property_id, a.property_id)) AS effective_property,
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
    db.query<{ total: string; uncategorized: string; sum: string; sum_budgeted: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE mapped_category IS NULL AND t.hidden = FALSE)::text AS uncategorized,
              COALESCE(SUM(t.amount), 0)::text AS sum,
              -- The total the budget grid computes, over the same rows: a hidden transaction is
              -- listed here (greyed) but counted nowhere in budget math, so a drilldown summing
              -- them would contradict the very cell it was opened from. Two totals rather than
              -- one, because the plain ledger view still wants every row it is showing.
              COALESCE(SUM(t.amount) FILTER (WHERE t.hidden = FALSE), 0)::text AS sum_budgeted
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
    db.query<{ id: number; nickname: string }>(
      'SELECT id, nickname FROM properties ORDER BY nickname'
    ),
  ]);
  return {
    transactions: txns.rows,
    categories: cats.rows,
    total: Number(counts.rows[0].total),
    uncategorized: Number(counts.rows[0].uncategorized),
    sum: Number(counts.rows[0].sum),
    sumBudgeted: Number(counts.rows[0].sum_budgeted),
    accounts: accounts.rows,
    properties: props.rows,
  };
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n));

type DrillBudgetRow = {
  name: string;
  is_income: boolean;
  annual_budget: string;
  monthly_amounts: string[] | null;
};

/**
 * The plan a drilldown's transactions are measured against. The budget grid prints a month's
 * budget under its actual, and following that cell through to the transactions used to drop it —
 * the page that exists to explain a number arrived without the number it is being judged by.
 *
 * Mirrors monthsBudget() in BudgetMonthlyGrid.tsx: an explicit 12-month schedule wins, otherwise
 * the annual budget spreads evenly. Keyed on name alone, exactly as this page's own transaction
 * filter is — `mapped_category` carries no landscape, so a name resolves here the same way it
 * resolves there. No name currently spans both books; if one ever does, both rows are summed,
 * which is the same total the grid's two rows would show.
 *
 * Returns null when no drilled category carries a budget at all, which is the difference between
 * "the plan is zero" and "there is no plan" — the caller prints nothing rather than a false $0.
 */
async function getDrilldownBudget(categories: string[], month: number) {
  const { rows } = await db.query<DrillBudgetRow>(
    `SELECT name, is_income, annual_budget::text, monthly_amounts
       FROM budget_categories
      WHERE name = ANY($1) AND exclude_from_budget = FALSE`,
    [categories]
  );
  if (rows.length === 0) return null;
  const budget = rows.reduce((sum, r) => {
    const schedule = r.monthly_amounts;
    return sum + (schedule && schedule.length === 12
      ? Number(schedule[month - 1])
      : Number(r.annual_budget) / 12);
  }, 0);
  // Income and expense are compared in opposite directions, so a mixed drilldown has no single
  // "over" to report. Treated as expense unless every row is income — the same rule the grid's
  // per-row colouring uses, applied to the set.
  return { budget, isIncome: rows.every((r) => r.is_income), rowCount: rows.length };
}

export default async function TransactionsPage({
  searchParams,
}: {
  // `category` is REPEATABLE — `?category=A&category=B` — rather than a comma-joined string,
  // because category names are user-typed and may contain a comma. A separator that can appear
  // inside a value is a parser that silently splits one category into two.
  searchParams: Promise<{
    filter?: string; account?: string; category?: string | string[]; month?: string; search?: string;
    dateFrom?: string; dateTo?: string; amountMin?: string; amountMax?: string; transferGroup?: string;
    from?: string;
  }>;
}) {
  const {
    filter, account, category, month, search, dateFrom, dateTo, amountMin, amountMax, transferGroup,
    from,
  } = await searchParams;

  const uncategorizedOnly = filter === 'uncategorized';
  const accountId = account ?? null;
  const drillCategories = (Array.isArray(category) ? category : category ? [category] : [])
    .map((c) => c.trim())
    .filter(Boolean);
  const drillMonth = month ? parseInt(month, 10) : null;
  const searchQuery = search?.trim() || null;
  const dateFromValue = dateFrom || null;
  const dateToValue = dateTo || null;
  const amountMinValue = amountMin ? parseFloat(amountMin) : null;
  const amountMaxValue = amountMax ? parseFloat(amountMax) : null;
  const transferGroupValue = transferGroup ? parseInt(transferGroup, 10) : null;

  const { transactions, categories, total, uncategorized, sum, sumBudgeted, accounts, properties } = await getData(
    uncategorizedOnly, accountId, drillCategories, drillMonth, searchQuery,
    dateFromValue, dateToValue,
    amountMinValue !== null && !isNaN(amountMinValue) ? amountMinValue : null,
    amountMaxValue !== null && !isNaN(amountMaxValue) ? amountMaxValue : null,
    transferGroupValue !== null && !isNaN(transferGroupValue) ? transferGroupValue : null,
  );

  const isDrilldown = drillCategories.length > 0 && Boolean(drillMonth);
  const drillBudget = isDrilldown ? await getDrilldownBudget(drillCategories, drillMonth as number) : null;
  // `sum` is signed the ledger's way (expenses positive). Flip income so both sides of the
  // comparison below mean "counts toward this category", as they do in the grid.
  const drillActual = drillBudget?.isIncome ? -sumBudgeted : sumBudgeted;
  const drillVariance = drillBudget ? drillActual - drillBudget.budget : 0;
  const drillPct = drillBudget && drillBudget.budget > 0
    ? Math.round((drillActual / drillBudget.budget) * 100)
    : null;
  // Only a single category has one budget to edit. A multi-category drilldown sums a plan it
  // cannot send anyone to change, so it reports the total and offers no link.
  const drillEditHref = drillCategories.length === 1
    ? `/categories/${encodeURIComponent(drillCategories[0])}`
    : null;
  // Names, not a count, while they still fit a heading. "3 categories · September 2026" tells the
  // owner nothing about which three, and the whole reason they clicked was to see which.
  const drillCategoryLabel = drillCategories.length <= 3
    ? drillCategories.join(', ')
    : `${drillCategories.slice(0, 2).join(', ')} +${drillCategories.length - 2} more`;
  const drillLabel = isDrilldown
    ? `${drillCategoryLabel} · ${MONTH_NAMES[(drillMonth ?? 1) - 1]} ${new Date().getFullYear()}`
    : null;
  const isTransferGroup = Boolean(transferGroupValue !== null && !isNaN(transferGroupValue));
  // Where the breadcrumb goes back to. A drilldown opened from the dashboard that offers "← Budget"
  // is a back link that lies about where the owner came from, so the origin travels in the URL
  // rather than being assumed. Budget stays the default: every link that predates `from` is one.
  const origin = from === 'dashboard'
    ? { href: '/dashboard', label: 'Dashboard' }
    : { href: '/budget?view=monthly', label: 'Budget' };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {isDrilldown && (
        <div className="flex items-center gap-2 mb-4 text-sm">
          <a href={origin.href} className="text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            {origin.label}
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
          {(() => {
            // A drilldown is answering for a budget cell, so it totals the rows that cell counted.
            // Everywhere else this is the plain ledger view and totals every row on screen.
            const shown = isDrilldown ? sumBudgeted : sum;
            return (
              <span className={`font-mono font-medium ${shown < 0 ? 'text-emerald-600' : 'text-slate-700'}`}>
                {shown < 0 ? '+' : shown > 0 ? '−' : ''}{fmt(shown)}
              </span>
            );
          })()}
        </p>
      </div>

      {isDrilldown && drillBudget && (
        // The three figures a drilldown is opened to reconcile, in the order they are asked for:
        // what went out, what was meant to, and the gap. The gap is the one that carries colour —
        // the other two are facts, and colouring a fact just makes the row louder.
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-4 mb-6 flex flex-wrap items-center gap-x-10 gap-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-400">
              {drillBudget.isIncome ? 'Received' : 'Spent'}
            </div>
            <div className="font-mono text-lg font-semibold text-slate-900 mt-0.5">{fmt(drillActual)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-400">Budget</div>
            <div className="font-mono text-lg font-semibold text-slate-500 mt-0.5">
              {drillBudget.budget > 0 ? fmt(drillBudget.budget) : '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-400">
              {drillBudget.budget > 0 ? (drillVariance > 0 ? 'Over' : 'Under') : 'Variance'}
            </div>
            <div className={`font-mono text-lg font-semibold mt-0.5 ${
              drillBudget.budget === 0
                ? (drillActual !== 0 ? 'text-amber-600' : 'text-slate-300')
                // Over budget is bad on an expense and good on income; the sign means opposite
                // things on the two sides, so the colour has to read the side, not the sign.
                : (drillVariance > 0) === Boolean(drillBudget.isIncome)
                  ? 'text-emerald-600'
                  : 'text-red-600'
            }`}>
              {drillBudget.budget > 0
                ? <>{drillVariance > 0 ? '+' : '−'}{fmt(drillVariance)}
                    {drillPct !== null && <span className="text-xs font-normal text-slate-400 ml-1.5">{drillPct}%</span>}
                  </>
                // No plan and nothing spent is the ordinary state of an off-month, not a finding —
                // property tax in August. Spend against no plan is the finding, and borrows the
                // grid's word for it so the two surfaces call the same thing the same thing.
                : drillActual !== 0 ? 'off-cycle' : '—'}
            </div>
          </div>
          {drillEditHref && (
            <Link
              href={drillEditHref}
              className="ml-auto text-sm text-blue-600 hover:text-blue-700 hover:underline whitespace-nowrap"
            >
              Edit budget →
            </Link>
          )}
        </div>
      )}

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
        <TransactionTable transactions={transactions} categories={categories} accounts={accounts} properties={properties} />
      )}
    </div>
  );
}
