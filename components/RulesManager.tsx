'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BudgetCategory } from '@/shared/types';

export type RuleRow = {
  plaid_category: string;
  count: number;
  uncategorized: number;
  mapped_category: string | null;
};

interface Props {
  rows: RuleRow[];
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

export default function RulesManager({ rows, categories, pendingApply }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<number | null>(null);

  async function setRule(plaidCategory: string, mappedCategory: string | null) {
    setBusy(plaidCategory);
    if (mappedCategory) {
      await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plaid_category: plaidCategory, mapped_category: mappedCategory }),
      });
    } else {
      await fetch('/api/rules', {
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
    const res = await fetch('/api/rules/apply', { method: 'POST' });
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

      {/* Without rules */}
      {withoutRule.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-600 mb-3">
            Unmapped — {withoutRule.length} categories
          </h2>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
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
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
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
