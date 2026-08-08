'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X, Landmark } from 'lucide-react';
import { ACCOUNT_TYPES } from '@/lib/accountTypes';

type BalanceChoice = 'ledger' | 'asset' | 'liability';

export default function AddAccountForm() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [bank, setBank] = useState('');
  const [typeKey, setTypeKey] = useState('checking');
  const [landscape, setLandscape] = useState<'operational' | 'capital'>('operational');
  const [balanceChoice, setBalanceChoice] = useState<BalanceChoice>('ledger');
  const [initialValue, setInitialValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName(''); setBank(''); setTypeKey('checking'); setLandscape('operational');
    setBalanceChoice('ledger'); setInitialValue(''); setError(null);
  }

  function close() { setOpen(false); reset(); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }

    let parsedValue: number | null = null;
    if (balanceChoice !== 'ledger' && initialValue.trim() !== '') {
      parsedValue = Number(initialValue.replace(/[$,\s]/g, ''));
      if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        setError(balanceChoice === 'liability' ? 'Enter a positive amount owed' : 'Enter a positive balance');
        return;
      }
    }

    setSaving(true); setError(null);
    const chosen = ACCOUNT_TYPES.find((t) => t.subtype === typeKey || t.type === typeKey) ?? ACCOUNT_TYPES[0];
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, bank: bank || undefined, type: chosen.type, subtype: chosen.subtype, landscape,
          valuation_mode: balanceChoice === 'ledger' ? 'ledger' : 'valuation',
          is_liability: balanceChoice === 'liability',
          initial_value: parsedValue,
        }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.error?.message ?? 'Failed'); return; }
      close();
      startTransition(async () => { await router.refresh(); });
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Add account manually"
        className="flex items-center gap-1 px-3 py-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 rounded-lg transition-colors"
      >
        <Plus size={14} />
        Add
      </button>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700">Add account manually</h3>
        <button onClick={close} className="text-slate-400 hover:text-slate-600">
          <X size={15} />
        </button>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Account name *</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Chase Freedom"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Bank</label>
            <input
              value={bank}
              onChange={(e) => setBank(e.target.value)}
              placeholder="e.g. Chase"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Account type *</label>
            <select
              value={typeKey}
              onChange={(e) => setTypeKey(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.label} value={t.subtype ?? t.type}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Category *</label>
            <select
              value={landscape}
              onChange={(e) => setLandscape(e.target.value as 'operational' | 'capital')}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            >
              <option value="operational">Operational</option>
              <option value="capital">Capital</option>
            </select>
          </div>
        </div>

        {/* Defaults to Ledger — right for the common case (checking/savings/cards), where a
            balance is summed from transactions rather than typed in. Only a brokerage,
            retirement, or loan account needs the other two. */}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Balance comes from</label>
          <select
            value={balanceChoice}
            onChange={(e) => setBalanceChoice(e.target.value as BalanceChoice)}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          >
            <option value="ledger">Ledger — summed from transactions</option>
            <option value="asset">Valuation — a value you enter (asset)</option>
            <option value="liability">Valuation — a value you enter (liability)</option>
          </select>
        </div>

        {balanceChoice !== 'ledger' && (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              {balanceChoice === 'liability' ? 'Amount owed' : 'Current balance'}
              <span className="font-normal text-slate-400"> — optional, fill in later if you don&apos;t have it</span>
            </label>
            <div className="flex items-center gap-2">
              {balanceChoice === 'liability' && <Landmark size={13} className="text-red-400 shrink-0" />}
              <input
                value={initialValue}
                onChange={(e) => setInitialValue(e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                className="w-full text-sm font-mono border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={close} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-1.5 bg-slate-900 hover:bg-slate-700 text-white rounded-lg text-sm font-medium disabled:opacity-40 transition-colors"
          >
            {saving ? 'Adding…' : 'Add account'}
          </button>
        </div>
      </form>
    </div>
  );
}
