'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import MonthlyAmountsEditor from './MonthlyAmountsEditor';
import type { BudgetCategory, Landscape } from '@/shared/types';

type AccountOption = { id: string; name: string; landscape: string };

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const LANDSCAPE_BADGE: Record<Landscape, string> = {
  operational: 'bg-blue-50 text-blue-700 border-blue-100',
  capital:     'bg-violet-50 text-violet-700 border-violet-100',
};

// Dedicated-account linking is a rare, secondary feature, so it's styled as a plain link
// rather than an always-visible bordered form control — quiet when unset, a normal link
// once one is chosen. Still a native <select> under the hood for simple click-to-change.
function AccountSelect({
  category, accounts, onSetDedicatedAccount,
}: {
  category: BudgetCategory;
  accounts: AccountOption[];
  onSetDedicatedAccount: (id: number, accountId: string | null) => void;
}) {
  const acct = accounts.find((a) => a.id === category.dedicated_account_id);
  return (
    <select
      value={category.dedicated_account_id ?? ''}
      onChange={(e) => onSetDedicatedAccount(category.id, e.target.value || null)}
      title={acct ? `Linked to ${acct.name}` : 'Link a dedicated account'}
      className={`text-xs bg-transparent border-none outline-none cursor-pointer max-w-[160px] truncate ${
        acct ? 'text-blue-600 hover:text-blue-700 hover:underline' : 'text-slate-300 hover:text-slate-400'
      }`}
    >
      <option value="">— none —</option>
      {accounts
        .filter((a) => a.landscape === category.landscape)
        .map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
    </select>
  );
}

function CategoryTable({
  rows, label, accounts, editingBudgetId, editingBudgetValue, budgetError,
  onEditingBudgetValueChange, onSaveBudget, onCancelEditBudget, onStartEditBudget,
  onToggleIncome, onDelete, onSaveMonthlyAmounts, onSetDedicatedAccount,
}: {
  rows: BudgetCategory[];
  label: string;
  accounts: AccountOption[];
  editingBudgetId: number | null;
  editingBudgetValue: string;
  budgetError: string | null;
  onEditingBudgetValueChange: (value: string) => void;
  onSaveBudget: (id: number) => void;
  onCancelEditBudget: () => void;
  onStartEditBudget: (id: number, currentValue: number) => void;
  onToggleIncome: (id: number, current: boolean) => void;
  onDelete: (id: number) => void;
  onSaveMonthlyAmounts: (id: number, amounts: number[] | null) => Promise<void>;
  onSetDedicatedAccount: (id: number, accountId: string | null) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-6">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">{label}</h2>
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Category</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Landscape</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Account</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">Annual</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">Monthly ref</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">Schedule</th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={c.id} className={`${i < rows.length - 1 ? 'border-b border-slate-50' : ''} hover:bg-slate-50/50`}>
                <td className="px-6 py-4">
                  {c.exclude_from_budget ? (
                    <span className="font-medium text-slate-400 cursor-default">{c.name}</span>
                  ) : (
                    <Link
                      href={`/categories/${encodeURIComponent(c.name)}`}
                      className="font-medium text-slate-800 hover:text-blue-600 hover:underline"
                    >
                      {c.name}
                    </Link>
                  )}
                  {c.exclude_from_budget && (
                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 font-medium">
                      excluded
                    </span>
                  )}
                </td>
                <td className="px-4 py-4">
                  {c.exclude_from_budget ? (
                    <span className="text-xs text-slate-300">—</span>
                  ) : (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${LANDSCAPE_BADGE[c.landscape]}`}>
                      {c.landscape}
                    </span>
                  )}
                </td>
                <td className="px-4 py-4">
                  {c.exclude_from_budget ? (
                    <span className="text-xs text-slate-300">—</span>
                  ) : (
                    <AccountSelect category={c} accounts={accounts} onSetDedicatedAccount={onSetDedicatedAccount} />
                  )}
                </td>
                <td className="px-4 py-4 text-right font-mono text-slate-600 text-sm">
                  {c.exclude_from_budget ? (
                    '—'
                  ) : editingBudgetId === c.id ? (
                    <div className="inline-flex flex-col items-end gap-1">
                      <input
                        autoFocus
                        type="number"
                        min="0"
                        value={editingBudgetValue}
                        onChange={(e) => onEditingBudgetValueChange(e.target.value)}
                        onBlur={() => onSaveBudget(c.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') onSaveBudget(c.id);
                          if (e.key === 'Escape') onCancelEditBudget();
                        }}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-sm font-mono text-slate-800 w-28 text-right focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                      />
                      {budgetError && <span className="text-[10px] text-red-500 whitespace-nowrap">{budgetError}</span>}
                    </div>
                  ) : c.monthly_amounts ? (
                    <span className="text-slate-400 cursor-default" title="Derived from the custom schedule — edit amounts there instead">
                      {fmt(Number(c.annual_budget))}
                    </span>
                  ) : (
                    <span
                      className="cursor-pointer hover:text-blue-600"
                      onClick={() => onStartEditBudget(c.id, Number(c.annual_budget))}
                      title="Click to edit"
                    >
                      {fmt(Number(c.annual_budget))}
                    </span>
                  )}
                </td>
                <td className="px-4 py-4 text-right font-mono text-slate-400 text-sm">
                  {c.exclude_from_budget ? '—' : fmt(Number(c.annual_budget) / 12)}
                </td>
                <td className="px-4 py-4 text-right">
                  {c.exclude_from_budget ? (
                    <span className="text-xs text-slate-300">—</span>
                  ) : (
                    <MonthlyAmountsEditor
                      annualBudget={Number(c.annual_budget)}
                      monthlyAmounts={c.monthly_amounts}
                      onSave={(amounts) => onSaveMonthlyAmounts(c.id, amounts)}
                    />
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-3">
                    {!c.exclude_from_budget && (
                      <button
                        onClick={() => onToggleIncome(c.id, c.is_income)}
                        className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        → {c.is_income ? 'outcome' : 'income'}
                      </button>
                    )}
                    {!c.exclude_from_budget && (
                      <button
                        onClick={() => onDelete(c.id)}
                        className="text-slate-300 hover:text-red-400 text-xs font-medium transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface Props {
  categories: BudgetCategory[];
  accounts: AccountOption[];
}

export default function CategoryManager({ categories, accounts }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Landscape>('operational');
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [monthlyAmounts, setMonthlyAmounts] = useState<number[] | null>(null);
  const [landscape, setLandscape] = useState<Landscape>('operational');
  const [isIncome, setIsIncome] = useState(false);
  const [dedicatedAccountId, setDedicatedAccountId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingBudgetId, setEditingBudgetId] = useState<number | null>(null);
  const [editingBudgetValue, setEditingBudgetValue] = useState('');
  const [budgetError, setBudgetError] = useState<string | null>(null);

  useEffect(() => {
    // Deliberately in an effect, not a lazy useState initializer: localStorage isn't available
    // during SSR, so reading it synchronously during render would make the client's first
    // hydration pass disagree with the server-rendered HTML (a real hydration mismatch, since
    // `tab` controls which categories render). Restoring post-hydration trades one harmless
    // post-mount re-render for correctness here.
    const saved = localStorage.getItem('categoriesTab');
    if (saved === 'operational' || saved === 'capital') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab(saved);
      setLandscape(saved);
    }
  }, []);

  function switchTab(ls: Landscape) {
    localStorage.setItem('categoriesTab', ls);
    setTab(ls);
    setLandscape(ls);
    setDedicatedAccountId('');
  }

  const tabAccounts = accounts.filter((a) => a.landscape === tab);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const annual_budget = monthlyAmounts ? monthlyAmounts.reduce((s, n) => s + n, 0) : parseFloat(budget);
    if (!name.trim() || isNaN(annual_budget) || annual_budget < 0) {
      setError('Enter a valid name and amount');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        annual_budget,
        landscape,
        is_income: isIncome,
        dedicated_account_id: dedicatedAccountId || null,
        monthly_amounts: monthlyAmounts,
      }),
    });
    const data = await res.json();
    if (data.success) {
      setName(''); setBudget(''); setMonthlyAmounts(null); setIsIncome(false); setDedicatedAccountId('');
      router.refresh();
    } else {
      setError(data.error?.message ?? 'Failed to save');
    }
    setSaving(false);
  }

  async function handleDelete(id: number) {
    await fetch('/api/categories', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  async function toggleIncome(id: number, current: boolean) {
    await fetch('/api/categories', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_income: !current }),
    });
    router.refresh();
  }

  function startEditBudget(id: number, currentValue: number) {
    setEditingBudgetId(id);
    setEditingBudgetValue(String(currentValue));
    setBudgetError(null);
  }

  async function saveBudget(id: number) {
    const amount = parseFloat(editingBudgetValue);
    if (isNaN(amount) || amount < 0) { setEditingBudgetId(null); return; }
    const res = await fetch('/api/categories', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, annual_budget: amount }),
    });
    const data = await res.json();
    if (data.success) {
      setEditingBudgetId(null);
      router.refresh();
    } else {
      setBudgetError(data.error?.message ?? 'Failed to save');
    }
  }

  async function setDedicatedAccount(id: number, accountId: string | null) {
    await fetch('/api/categories', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, dedicated_account_id: accountId }),
    });
    router.refresh();
  }

  async function saveMonthlyAmounts(id: number, amounts: number[] | null) {
    await fetch('/api/categories', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, monthly_amounts: amounts }),
    });
    router.refresh();
  }

  const visible  = categories.filter((c) => c.exclude_from_budget || c.landscape === tab);
  const expenses = visible.filter((c) => !c.is_income);
  const income   = visible.filter((c) => c.is_income);

  return (
    <div>
      {/* Landscape tabs */}
      <div className="flex gap-6 border-b border-slate-200 mb-6">
        {(['operational', 'capital'] as Landscape[]).map((ls) => (
          <button
            key={ls}
            onClick={() => switchTab(ls)}
            className={`pb-3 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === ls
                ? ls === 'operational'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-violet-600 text-violet-600'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {ls}
          </button>
        ))}
      </div>

      {/* Add form */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-5">
          Add {tab.charAt(0).toUpperCase() + tab.slice(1)} Category
        </h2>
        <form onSubmit={handleAdd} className="flex gap-4 items-end flex-wrap">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-500">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Travel"
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-500">{isIncome ? 'Expected annual ($)' : 'Annual budget ($)'}</label>
            <input
              value={monthlyAmounts ? monthlyAmounts.reduce((s, n) => s + n, 0).toFixed(2) : budget}
              onChange={(e) => setBudget(e.target.value)}
              disabled={Boolean(monthlyAmounts)}
              placeholder="24000"
              type="number"
              min="0"
              title={monthlyAmounts ? 'Derived from the schedule below' : undefined}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-32 font-mono focus:outline-none focus:ring-2 focus:ring-slate-900/10 disabled:bg-slate-50 disabled:text-slate-400"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-500">Allocation</label>
            <MonthlyAmountsEditor
              annualBudget={parseFloat(budget) || 0}
              monthlyAmounts={monthlyAmounts}
              onSave={async (amounts) => setMonthlyAmounts(amounts)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-500">Type</label>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
              <button
                type="button"
                onClick={() => setIsIncome(false)}
                className={`px-3 py-2 transition-colors ${!isIncome ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
              >
                Outcome
              </button>
              <button
                type="button"
                onClick={() => setIsIncome(true)}
                className={`px-3 py-2 transition-colors ${isIncome ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
              >
                Income
              </button>
            </div>
          </div>
          {tabAccounts.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-500">Dedicated Account</label>
              <select
                value={dedicatedAccountId}
                onChange={(e) => setDedicatedAccountId(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-700"
              >
                <option value="">— none —</option>
                {tabAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          )}
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium transition-colors"
          >
            {saving ? 'Saving…' : 'Add'}
          </button>
          {error && <p className="text-red-500 text-sm self-center">{error}</p>}
        </form>
      </div>

      {visible.length === 0 ? (
        <p className="text-slate-400 text-sm">No {tab} categories yet.</p>
      ) : (
        <>
          <CategoryTable
            rows={income}
            label="Income"
            accounts={accounts}
            editingBudgetId={editingBudgetId}
            editingBudgetValue={editingBudgetValue}
            budgetError={budgetError}
            onEditingBudgetValueChange={setEditingBudgetValue}
            onSaveBudget={saveBudget}
            onCancelEditBudget={() => setEditingBudgetId(null)}
            onStartEditBudget={startEditBudget}
            onToggleIncome={toggleIncome}
            onDelete={handleDelete}
            onSaveMonthlyAmounts={saveMonthlyAmounts}
            onSetDedicatedAccount={setDedicatedAccount}
          />
          <CategoryTable
            rows={expenses}
            label="Outcome"
            accounts={accounts}
            editingBudgetId={editingBudgetId}
            editingBudgetValue={editingBudgetValue}
            budgetError={budgetError}
            onEditingBudgetValueChange={setEditingBudgetValue}
            onSaveBudget={saveBudget}
            onCancelEditBudget={() => setEditingBudgetId(null)}
            onStartEditBudget={startEditBudget}
            onToggleIncome={toggleIncome}
            onDelete={handleDelete}
            onSaveMonthlyAmounts={saveMonthlyAmounts}
            onSetDedicatedAccount={setDedicatedAccount}
          />
        </>
      )}
    </div>
  );
}
