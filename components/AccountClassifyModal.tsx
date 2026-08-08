'use client';

import { useState } from 'react';
import { X, Landmark } from 'lucide-react';
import type { LinkedAccountSummary } from '@/shared/types';

type Choice = 'ledger' | 'asset' | 'liability';

interface RowState { choice: Choice; value: string; }

interface Props {
  accounts: LinkedAccountSummary[];
  onDone: () => void;
}

// Shown once, right after Plaid Link returns genuinely new accounts — not on every sync or
// reconnect, since those accounts already have whatever classification they were given here.
// The point is closing the gap where a brokerage or loan account landed as 'ledger' by default
// and stayed that way until someone happened to visit /accounts and noticed.
//
// Checking/savings/credit-card accounts are the common case and are already correct as
// 'ledger' by default, so every row starts there — this is for the exceptions, not a mandatory
// step, and "Skip" leaves accounts exactly as they'd have been without this modal at all.
export default function AccountClassifyModal({ accounts, onDone }: Props) {
  const [rows, setRows] = useState<Record<string, RowState>>(
    () => Object.fromEntries(accounts.map((a) => [a.id, { choice: 'ledger' as Choice, value: '' }]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setChoice(id: string, choice: Choice) {
    setRows((r) => ({ ...r, [id]: { ...r[id], choice } }));
  }
  function setValue(id: string, value: string) {
    setRows((r) => ({ ...r, [id]: { ...r[id], value } }));
  }

  async function save() {
    setSaving(true);
    setError(null);

    // Only accounts changed away from the ledger default touch the network — most rows in a
    // typical link (checking, cards) are correctly left alone.
    const changed = accounts.filter((a) => rows[a.id].choice !== 'ledger');

    for (const a of changed) {
      const { choice, value } = rows[a.id];
      const parsed = value.trim() === '' ? null : Number(value.replace(/[$,\s]/g, ''));
      if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
        setError(`${a.name}: enter a positive number, or leave the value blank to fill in later`);
        setSaving(false);
        return;
      }

      const patchRes = await fetch(`/api/accounts/${a.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valuation_mode: 'valuation', is_liability: choice === 'liability' }),
      });
      if (!patchRes.ok) {
        setError(`Could not update ${a.name}`);
        setSaving(false);
        return;
      }

      if (parsed !== null) {
        const valRes = await fetch(`/api/accounts/${a.id}/valuation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: parsed }),
        });
        if (!valRes.ok) {
          setError(`Saved ${a.name}'s type, but the balance didn't save — add it from the accounts list`);
          setSaving(false);
          return;
        }
      }
    }

    setSaving(false);
    onDone();
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between p-5 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">
              {accounts.length} account{accounts.length === 1 ? '' : 's'} linked
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Checking/savings/cards are correct as-is. For a brokerage, retirement, or loan
              account, set its type below so its balance counts correctly toward net worth.
            </p>
          </div>
          <button onClick={onDone} className="text-slate-400 hover:text-slate-600 shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {accounts.map((a) => {
            const row = rows[a.id];
            return (
              <div key={a.id} className="border border-slate-100 rounded-xl p-3">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{a.name}</p>
                    <p className="text-[10px] text-slate-400">{a.subtype ?? a.type}{a.mask ? ` · ···${a.mask}` : ''}</p>
                  </div>
                  <select
                    value={row.choice}
                    onChange={(e) => setChoice(a.id, e.target.value as Choice)}
                    className={`shrink-0 text-xs rounded-lg pl-2 pr-1 py-1.5 border focus:outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer ${
                      row.choice === 'ledger'
                        ? 'bg-white text-slate-500 border-slate-200'
                        : row.choice === 'liability'
                          ? 'bg-red-50 text-red-700 border-red-100'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                    }`}
                  >
                    <option value="ledger">Ledger</option>
                    <option value="asset">Valuation (asset)</option>
                    <option value="liability">Valuation (liability)</option>
                  </select>
                </div>

                {row.choice !== 'ledger' && (
                  <div className="flex items-center gap-2 mt-2">
                    {row.choice === 'liability' && <Landmark size={12} className="text-red-400 shrink-0" />}
                    <input
                      value={row.value}
                      onChange={(e) => setValue(a.id, e.target.value)}
                      placeholder={row.choice === 'liability' ? 'Amount owed (optional — fill in later)' : 'Current balance (optional — fill in later)'}
                      inputMode="decimal"
                      className="flex-1 text-xs font-mono border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {error && <p className="text-xs text-red-600 px-5 pb-2">{error}</p>}

        <div className="flex justify-end gap-2 p-5 border-t border-slate-100">
          <button onClick={onDone} disabled={saving} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 disabled:opacity-40">
            Skip
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-1.5 bg-slate-900 hover:bg-slate-700 text-white rounded-lg text-sm font-medium disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving…' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
}
