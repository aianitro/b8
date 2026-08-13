'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Link2Off, Pencil, Check, X, Filter, EyeOff } from 'lucide-react';
import { buildPropertyLedger, type PropertyLedger, type LedgerInput } from '@/lib/domain/propertyLedger';

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
  propertyId, year, beginningBalance, transactions, defaultHiddenCategories,
}: {
  propertyId: number;
  year: number;
  beginningBalance: number;
  transactions: LedgerInput[];
  defaultHiddenCategories: string[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);
  // Seeded from the server-supplied defaults so the first paint already matches what the
  // filter button claims — starting empty and correcting in an effect would flash the hidden
  // rows and, worse, briefly show a balance the filter is about to change.
  const [hiddenCats, setHiddenCats] = useState<Set<string>>(new Set(defaultHiddenCategories));
  const [pickerOpen, setPickerOpen] = useState(false);

  const storageKey = `ledgerHiddenCats:${propertyId}`;

  // Restored in an effect rather than a lazy initializer: sessionStorage doesn't exist during
  // SSR, so reading it while rendering would make the client's first pass disagree with the
  // server HTML — a real hydration mismatch, since the filter controls which rows exist. Same
  // trade the transactions table makes for its saved sort order.
  useEffect(() => {
    const saved = sessionStorage.getItem(storageKey);
    if (!saved) return;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHiddenCats(new Set(JSON.parse(saved) as string[]));
    } catch {
      /* a corrupt entry just means no filter */
    }
  }, [storageKey]);

  function toggleCat(cat: string) {
    setHiddenCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      sessionStorage.setItem(storageKey, JSON.stringify([...next]));
      return next;
    });
  }

  function showAll() {
    setHiddenCats(new Set());
    sessionStorage.setItem(storageKey, JSON.stringify([]));
  }

  const UNCATEGORIZED = '— uncategorized —';
  const catOf = (c: string | null) => c ?? UNCATEGORIZED;

  const categories = [...new Set(transactions.map((r) => catOf(r.category)))].sort();

  // Partitioned and rebuilt together, keyed on the only two things that can change the result.
  // Splitting them into separate useMemos would defeat the point, since `visible` would be a
  // fresh array identity on every render and the ledger memo below would never hit.
  const { visible, hidden, ledger } = useMemo(() => {
    const isHidden = (c: string | null) => hiddenCats.has(c ?? UNCATEGORIZED);
    const vis = transactions.filter((r) => !isHidden(r.category));
    return {
      visible: vis,
      hidden: transactions.filter((r) => isHidden(r.category)),
      // Built from the VISIBLE rows, so the Balance column always adds up down the page — each
      // row's balance is the one above it plus that row's own movement, with nothing invisible
      // in between. The cost is that the closing figure is a filtered subtotal rather than the
      // account's real position whenever anything is hidden, which the note below says outright.
      ledger: buildPropertyLedger(beginningBalance, vis) as PropertyLedger,
    };
  }, [transactions, hiddenCats, beginningBalance]);

  const hiddenIn = hidden.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0);
  const hiddenOut = hidden.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);

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
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setPickerOpen((o) => !o)}
              className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border transition-colors ${
                hiddenCats.size > 0
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              <Filter size={11} />
              {hiddenCats.size > 0 ? `${categories.length - hiddenCats.size} of ${categories.length}` : 'Filter'}
            </button>

            {pickerOpen && (
              <>
                {/* Click-away layer rather than a document listener: one element, no cleanup,
                    and it cannot leak past unmount. */}
                <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
                <div className="absolute right-0 mt-1 z-20 w-60 bg-white rounded-xl border border-slate-200 shadow-lg p-2">
                  <div className="flex items-center justify-between px-2 py-1 mb-1">
                    <span className="text-[10px] uppercase tracking-wide text-slate-400">Categories</span>
                    {hiddenCats.size > 0 && (
                      <button onClick={showAll} className="text-[10px] text-blue-600 hover:underline">
                        Reset
                      </button>
                    )}
                  </div>
                  {categories.map((c) => (
                    <label key={c} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-slate-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!hiddenCats.has(c)}
                        onChange={() => toggleCat(c)}
                        className="rounded border-slate-300"
                      />
                      <span className="text-xs text-slate-600 truncate">{c}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
          <span className="text-[10px] text-slate-400">{year}</span>
        </div>
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

            {/* Sits inside the table, directly above the totals, because with the balance now
                built from visible rows only, this note is the entire explanation for why the
                closing figure is not the account's real position. A caption below the card
                would be too far from the number it qualifies. */}
            {hidden.length > 0 && (
              <tr className="bg-amber-50/40">
                <td colSpan={6} className="py-2 px-1">
                  <button
                    onClick={showAll}
                    className="group/h flex items-center gap-2 text-left w-full"
                    title="Show every category again"
                  >
                    <EyeOff size={12} className="text-amber-600 shrink-0" />
                    <span className="text-[11px] text-amber-800">
                      <span className="font-medium">
                        {hidden.length} transaction{hidden.length === 1 ? '' : 's'} hidden
                      </span>
                      {' · '}
                      {hiddenIn > 0 && <>{fmt(hiddenIn)} in</>}
                      {hiddenIn > 0 && hiddenOut > 0 && ', '}
                      {hiddenOut > 0 && <>{fmt(hiddenOut)} out</>}
                      <span className="text-amber-600">
                        {' — excluded from the balance below.'}
                      </span>
                      <span className="ml-1 underline opacity-70 group-hover/h:opacity-100">Show all</span>
                    </span>
                  </button>
                </td>
              </tr>
            )}

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

      {transactions.length === 0 && (
        <p className="text-xs text-slate-400 italic mt-3">
          No transactions attributed to this property yet. Link an account, or tag individual
          transactions to it from the Transactions page.
        </p>
      )}

      {/* Distinct from the empty state above: there IS activity, the filter is just hiding all
          of it. Telling someone "no transactions" when they have a filter on would send them
          looking for a data problem that doesn't exist. */}
      {transactions.length > 0 && visible.length === 0 && (
        <p className="text-xs text-slate-400 italic mt-3">
          Every category is filtered out.{' '}
          <button onClick={showAll} className="text-blue-600 hover:underline not-italic">Show all</button>
        </p>
      )}
    </div>
  );
}
