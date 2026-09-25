'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { BudgetCategory } from '@b8/contracts/types';

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

  const withRule    = rows.filter((r) => r.mapped_category !== null);
  const withoutRule = rows.filter((r) => r.mapped_category === null);

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
          </h2>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-50">
            {merchantRules.map((r) => (
              <div key={r.merchant_name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 sm:px-6 py-3 text-sm">
                <span className="font-medium text-slate-700 truncate max-w-[12rem]">{r.merchant_name}</span>
                <span className="text-slate-300">→</span>
                <span className="text-slate-700">{r.mapped_category}</span>
                {/* The count opens the rows it counts. `merchant=` is an EXACT filter, the same
                    match the rule itself makes — `search=` would have been one character cheaper
                    and would bring back rows this rule does not cover, so the figure and the list
                    it opened would disagree. */}
                <Link
                  href={`/transactions?merchant=${encodeURIComponent(r.merchant_name)}`}
                  className="ml-auto text-xs text-slate-400 hover:text-slate-700 hover:underline transition-colors"
                >
                  {r.count} {r.count === 1 ? 'transaction' : 'transactions'}
                </Link>
                <button
                  onClick={() => removeMerchantRule(r.merchant_name)}
                  disabled={busy === r.merchant_name}
                  className="text-xs text-slate-400 hover:text-red-500 disabled:opacity-40 transition-colors"
                >
                  {busy === r.merchant_name ? '…' : 'Remove'}
                </button>
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
      {withRule.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
            Mapped — {withRule.length} categories
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
              <tbody>
                {withRule.map((row) => <RuleRowItem key={row.plaid_category} row={row} />)}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
