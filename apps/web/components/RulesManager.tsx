'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { BudgetCategory } from '@b8/contracts/types';
import { groupRulesByCategory } from '@/lib/rulesGrouping';

export type RuleRow = {
  plaid_category: string;
  count: number;
  uncategorized: number;
  mapped_category: string | null;
};

/**
 * A rule naming one payee. Created from the dashboard's editor as a one-tap offer while filing,
 * which is the whole reason this list exists: rules made that easily accumulate that easily, and
 * a rule nobody can see is a rule nobody can undo.
 */
export type MerchantRuleRow = {
  merchant_name: string;
  mapped_category: string;
  /** Transactions of that payee in the ledger — what the rule speaks for, not what it changed. */
  count: number;
};

interface Props {
  rows: RuleRow[];
  merchantRules: MerchantRuleRow[];
  categories: Pick<BudgetCategory, 'name' | 'landscape'>[];
  pendingApply: number;
}

function fmtPlaid(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const LANDSCAPE_BADGE: Record<string, string> = {
  operational: 'bg-blue-50 text-blue-700 border border-blue-100',
  capital:     'bg-violet-50 text-violet-700 border border-violet-100',
};

export default function RulesManager({ rows, merchantRules, categories, pendingApply }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<number | null>(null);

  async function removeMerchantRule(merchant: string) {
    setBusy(merchant);
    await fetch('/api/v1/rules', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchant_name: merchant }),
    });
    setBusy(null);
    router.refresh();
  }

  async function setRule(plaidCategory: string, mappedCategory: string | null) {
    setBusy(plaidCategory);
    if (mappedCategory) {
      await fetch('/api/v1/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plaid_category: plaidCategory, mapped_category: mappedCategory }),
      });
    } else {
      await fetch('/api/v1/rules', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plaid_category: plaidCategory }),
      });
    }
    router.refresh();
    setBusy(null);
  }

  async function applyToExisting() {
    setApplying(true);
    setApplyResult(null);
    const res = await fetch('/api/v1/rules/apply', { method: 'POST' });
    const data = await res.json();
    if (data.success) setApplyResult(data.data.updated);
    router.refresh();
    setApplying(false);
  }

  const withoutRule = rows.filter((r) => r.mapped_category === null);

  // BOTH lists grouped on the category they file into, so "what feeds Restaurants" is one scan
  // rather than two lists sorted on two different keys. The query's order survives inside each
  // group — payees by how many transactions they speak for, Plaid categories likewise — because
  // that is the order each list was already useful in.
  const payeeGroups = groupRulesByCategory(merchantRules, (r) => r.count);
  const mappedGroups = groupRulesByCategory(rows, (r) => r.count);
  const mappedCount = mappedGroups.reduce((n, g) => n + g.rows.length, 0);

  /** The category heading both lists share, so the two groupings read as one idea. */
  function GroupHeading({ category, rules, total }: { category: string; rules: number; total: number }) {
    const landscape = categories.find((c) => c.name === category)?.landscape;
    return (
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 sm:px-6 py-2 bg-slate-50/80">
        <span className="text-sm font-semibold text-slate-700">{category}</span>
        {landscape && (
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${LANDSCAPE_BADGE[landscape] ?? ''}`}>
            {landscape}
          </span>
        )}
        <span className="text-xs text-slate-400">{rules} {rules === 1 ? 'rule' : 'rules'}</span>
        {/* The group's own total, so a category's weight is legible without adding up its rows. */}
        <span className="ml-auto text-xs font-mono text-slate-400">{total}</span>
      </div>
    );
  }

  function RuleRowItem({ row }: { row: RuleRow }) {
    const mapped = row.mapped_category;
    const catLandscape = categories.find((c) => c.name === mapped)?.landscape;

    return (
      <tr className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
        <td className="px-6 py-3.5 font-medium text-slate-700">{fmtPlaid(row.plaid_category)}</td>
        <td className="px-4 py-3.5 text-right font-mono text-slate-500 text-sm">{row.count}</td>
        <td className="px-4 py-3.5 text-right pr-6">
          {row.uncategorized > 0
            ? <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">{row.uncategorized}</span>
            : <span className="text-xs text-slate-300">—</span>
          }
        </td>
        <td className="px-6 py-3.5">
          <div className="flex items-center gap-2">
            <select
              value={mapped ?? ''}
              disabled={busy === row.plaid_category}
              onChange={(e) => setRule(row.plaid_category, e.target.value || null)}
              className={`text-sm border rounded-lg px-2.5 py-1.5 bg-white disabled:opacity-50 flex-1 focus:outline-none focus:ring-1 focus:ring-slate-400 transition-colors ${
                mapped ? 'border-emerald-200 text-slate-800' : 'border-slate-200 text-slate-400'
              }`}
            >
              <option value="">— no rule —</option>
              {categories.map((c) => (
                <option key={`${c.name}-${c.landscape}`} value={c.name}>{c.name}</option>
              ))}
            </select>
            {mapped && catLandscape && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${LANDSCAPE_BADGE[catLandscape] ?? ''}`}>
                {catLandscape}
              </span>
            )}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div>
      {/* Apply banner */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-4 mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">Apply rules to existing transactions</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {pendingApply > 0
              ? `${pendingApply} transactions will be auto-categorized or updated`
              : 'All matching transactions are up to date'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {applyResult !== null && (
            <span className="text-xs text-emerald-600 font-semibold">✓ {applyResult} updated</span>
          )}
          <button
            onClick={applyToExisting}
            disabled={applying || pendingApply === 0}
            className="px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-40 transition-colors"
          >
            {applying ? 'Applying…' : 'Apply now'}
          </button>
        </div>
      </div>

      {/* BY PAYEE, ABOVE BY CATEGORY, because a merchant rule outranks a category one and a list
          that shows them the other way round reads as though the broad rule were the main event.
          Deleting stops future filing and rewrites nothing: rows this rule already filed keep their
          category, which the owner may since have checked. */}
      {merchantRules.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
            By payee — {merchantRules.length} {merchantRules.length === 1 ? 'rule' : 'rules'}
            {payeeGroups.length > 1 && <> in {payeeGroups.length} categories</>}
          </h2>
          {/* `overflow-hidden` so the grouped headings' tinted band is clipped by the rounded corner
              rather than squaring it off at the top. */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden divide-y divide-slate-100">
            {payeeGroups.map((g) => (
              <div key={g.category}>
                <GroupHeading category={g.category} rules={g.rows.length} total={g.total} />
                <div className="divide-y divide-slate-50">
                  {g.rows.map((r) => (
                    // The category is the heading above now, so each row drops its `→ Category`.
                    // That is not only de-duplication: those three elements were the widest thing
                    // in the row, and on a phone they pushed the count and Remove onto a second
                    // line. Grouping buys the width back.
                    <div key={r.merchant_name} className="flex items-center gap-x-3 px-4 sm:px-6 py-3 text-sm">
                      {/* `min-w-0` IS WHAT MAKES `truncate` WORK HERE. A flex child's default
                          `min-width: auto` refuses to shrink below its content, so without it the
                          name pushed the count and Remove out of a container that clips — on a
                          phone the Remove button became unreachable rather than merely cramped.
                          Caught by rendering it at 393px; tsc, 982 tests and lint were all green. */}
                      <span className="flex-1 min-w-0 truncate font-medium text-slate-700">{r.merchant_name}</span>
                      {/* The count opens the rows it counts. `merchant=` is an EXACT filter, the
                          same match the rule itself makes — `search=` would have been one character
                          cheaper and would bring back rows this rule does not cover, so the figure
                          and the list it opened would disagree. */}
                      <Link
                        href={`/transactions?merchant=${encodeURIComponent(r.merchant_name)}`}
                        className="ml-auto shrink-0 text-xs text-slate-400 hover:text-slate-700 hover:underline transition-colors"
                      >
                        {r.count} {r.count === 1 ? 'transaction' : 'transactions'}
                      </Link>
                      <button
                        onClick={() => removeMerchantRule(r.merchant_name)}
                        disabled={busy === r.merchant_name}
                        className="shrink-0 text-xs text-slate-400 hover:text-red-500 disabled:opacity-40 transition-colors"
                      >
                        {busy === r.merchant_name ? '…' : 'Remove'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Without rules */}
      {withoutRule.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-600 mb-3">
            Unmapped — {withoutRule.length} categories
          </h2>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Plaid category</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">Total</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400 pr-6">Uncategorized</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400 w-72">Map to</th>
                </tr>
              </thead>
              <tbody>
                {withoutRule.map((row) => <RuleRowItem key={row.plaid_category} row={row} />)}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* With rules */}
      {mappedCount > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
            Mapped — {mappedCount} Plaid {mappedCount === 1 ? 'category' : 'categories'} in{' '}
            {mappedGroups.length} {mappedGroups.length === 1 ? 'budget category' : 'budget categories'}
          </h2>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Plaid category</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">Total</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400 pr-6">Uncategorized</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400 w-72">Maps to</th>
                </tr>
              </thead>
              {/* ONE `tbody` PER GROUP, not one table per group. Several tbodies in a table is valid
                  and keeps a single set of column widths, so the Total and Uncategorized columns
                  still line up down the whole list. Separate tables would each size their own
                  columns to their own contents and the numbers would wander left and right. */}
              {mappedGroups.map((g) => (
                <tbody key={g.category}>
                  <tr>
                    <td colSpan={4} className="p-0 border-y border-slate-100">
                      <GroupHeading category={g.category} rules={g.rows.length} total={g.total} />
                    </td>
                  </tr>
                  {g.rows.map((row) => <RuleRowItem key={row.plaid_category} row={row} />)}
                </tbody>
              ))}
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
