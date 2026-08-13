'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Link2Off, Pencil, Check, X } from 'lucide-react';
import type { PropertyLedger } from '@/lib/domain/propertyLedger';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

// Inflow and outflow get one column each rather than a single signed column. A signed column
// forces the reader to parse a minus sign on every line to answer "did money come in or go
// out"; two columns answer it by position, which is the layout every bank statement and the
// spreadsheet this replaces already uses.
function Amount({ amount }: { amount: number }) {
  const isInflow = amount < 0;
  return (
    <>
      <td className="py-1.5 pr-3 text-right font-mono text-xs text-emerald-600 tabular-nums">
        {isInflow ? fmt(-amount) : ''}
      </td>
      <td className="py-1.5 pr-3 text-right font-mono text-xs text-slate-600 tabular-nums">
        {isInflow ? '' : fmt(amount)}
      </td>
    </>
  );
}

function BeginningBalanceCell({
  propertyId, year, value,
}: { propertyId: number; year: number; value: number }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);

  async function save() {
    const parsed = Number(draft);
    if (isNaN(parsed)) return;
    setSaving(true);
    await fetch(`/api/properties/${propertyId}/balance`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ beginning_balance: parsed }),
    });
    setSaving(false);
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(String(value)); setEditing(true); }}
        className="group/bb inline-flex items-center gap-1.5 font-mono text-xs text-slate-700 tabular-nums hover:text-slate-900"
        title={`Set the opening balance for ${year}`}
      >
        {fmt(value)}
        <Pencil size={11} className="opacity-0 group-hover/bb:opacity-100 transition-opacity text-slate-400" />
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number" step="0.01" value={draft} autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        className="w-28 px-1.5 py-0.5 border border-slate-300 rounded text-right font-mono text-xs"
      />
      <button onClick={save} disabled={saving} className="p-0.5 text-emerald-600 hover:bg-emerald-50 rounded">
        <Check size={13} />
      </button>
      <button onClick={() => setEditing(false)} className="p-0.5 text-slate-400 hover:bg-slate-100 rounded">
        <X size={13} />
      </button>
    </span>
  );
}

export default function PropertyLedgerCard({
  propertyId, year, ledger,
}: { propertyId: number; year: number; ledger: PropertyLedger }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);

  // Untagging restores inheritance from the account rather than detaching the transaction, so
  // the button is only offered on rows that were tagged by hand — an account-linked row has
  // nothing to undo here and would need its account unlinked instead.
  async function untag(id: number) {
    setBusyId(id);
    await fetch(`/api/transactions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ property_id: null }),
    });
    setBusyId(null);
    router.refresh();
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Ledger</h2>
        <span className="text-[10px] text-slate-400">{year}</span>
      </div>
      <p className="text-[11px] text-slate-400 mb-4">
        Every movement of this property&apos;s cash, in order — including transfers, which the P&amp;L
        excludes. This is the view that reconciles against a bank statement.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
              <th className="py-1.5 pr-3 text-left font-medium">Date</th>
              <th className="py-1.5 pr-3 text-left font-medium">Description</th>
              <th className="py-1.5 pr-3 text-left font-medium">Category</th>
              <th className="py-1.5 pr-3 text-right font-medium">In</th>
              <th className="py-1.5 pr-3 text-right font-medium">Out</th>
              <th className="py-1.5 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-50">
              <td className="py-1.5 pr-3 text-xs text-slate-400 whitespace-nowrap">Jan 1</td>
              <td className="py-1.5 pr-3 text-xs font-medium text-slate-500" colSpan={4}>
                Beginning balance
              </td>
              <td className="py-1.5 text-right">
                <BeginningBalanceCell propertyId={propertyId} year={year} value={ledger.beginningBalance} />
              </td>
            </tr>

            {ledger.rows.map((r) => (
              <tr key={r.id} className="group border-b border-slate-50 hover:bg-slate-50/60">
                <td className="py-1.5 pr-3 text-xs text-slate-500 whitespace-nowrap">
                  {new Date(`${r.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </td>
                <td className="py-1.5 pr-3 text-xs text-slate-700 max-w-xs truncate" title={r.description}>
                  {r.description}
                  {/* The account is shown only when a row arrived by manual tag. On an
                      account-linked row it would repeat the same account on every line; on a
                      tagged row it is the one piece of context that explains why a transaction
                      from someone else's account is on this statement. */}
                  {r.taggedDirectly && (
                    <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                      {r.accountName}
                      <button
                        onClick={() => untag(r.id)}
                        disabled={busyId === r.id}
                        title="Remove this property tag"
                        className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-amber-900"
                      >
                        <Link2Off size={10} />
                      </button>
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-3 text-xs text-slate-400 max-w-[10rem] truncate">
                  {r.category ?? '—'}
                </td>
                <Amount amount={r.amount} />
                <td className="py-1.5 text-right font-mono text-xs text-slate-700 tabular-nums">
                  {fmt(r.balance)}
                </td>
              </tr>
            ))}

            <tr className="border-t border-slate-200">
              <td className="py-2 pr-3" />
              <td className="py-2 pr-3 text-xs font-semibold text-slate-700" colSpan={2}>
                Ending balance
              </td>
              <td className="py-2 pr-3 text-right font-mono text-xs text-emerald-600 tabular-nums">
                {fmt(ledger.totalIn)}
              </td>
              <td className="py-2 pr-3 text-right font-mono text-xs text-slate-600 tabular-nums">
                {fmt(ledger.totalOut)}
              </td>
              <td className="py-2 text-right font-mono text-sm font-semibold text-slate-900 tabular-nums">
                {fmt(ledger.endingBalance)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {ledger.rows.length === 0 && (
        <p className="text-xs text-slate-400 italic mt-3">
          No transactions attributed to this property yet. Link an account, or tag individual
          transactions to it from the Transactions page.
        </p>
      )}
    </div>
  );
}
