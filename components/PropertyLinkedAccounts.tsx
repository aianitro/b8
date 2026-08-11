'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Landmark, Banknote, Plus, X, Search } from 'lucide-react';

export interface LinkableAccount {
  id: string;
  name: string;
  isLiability: boolean;
  linked: boolean;
  /** Ledger balance for cash accounts, latest valuation for valuation-mode ones. */
  balance: number | null;
}

interface Props { propertyId: number; accounts: LinkableAccount[]; }

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

// Per-property P&L attributes transactions by the account they landed in, so a rental's
// operating account has to be linkable alongside its mortgage — which is why
// accounts.property_id was left generic rather than constrained to liabilities.
//
// Only linked accounts show by default. The picker previously rendered every eligible account
// at once, which at 20+ accounts pushed the rest of the page below the fold to display a list
// that is almost always two rows long. The full set is now behind an explicit edit step, with
// a filter, since choosing from 20 by eye is its own problem.
export default function PropertyLinkedAccounts({ propertyId, accounts }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState('');

  async function toggle(account: LinkableAccount) {
    setBusyId(account.id);
    await fetch(`/api/accounts/${account.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ property_id: account.linked ? null : propertyId }),
    });
    setBusyId(null);
    startTransition(async () => { await router.refresh(); });
  }

  const linked = accounts.filter((a) => a.linked);
  const cashAccounts = linked.filter((a) => !a.isLiability && a.balance !== null);
  const operatingCash = cashAccounts.reduce((sum, a) => sum + (a.balance ?? 0), 0);
  const q = filter.trim().toLowerCase();
  // Linked first so an account just ticked doesn't jump out of view while the panel is open.
  const editable = [...linked, ...accounts.filter((a) => !a.linked)]
    .filter((a) => q === '' || a.name.toLowerCase().includes(q));

  const row = (a: LinkableAccount, withCheckbox: boolean) => (
    <li key={a.id}>
      <label className={`flex items-center gap-2.5 py-1.5 ${withCheckbox ? 'cursor-pointer' : ''}`}>
        {withCheckbox && (
          <input
            type="checkbox"
            checked={a.linked}
            disabled={busyId === a.id}
            onChange={() => toggle(a)}
            className="rounded border-slate-300 text-slate-900 focus:ring-slate-400 disabled:opacity-40 shrink-0"
          />
        )}
        {a.isLiability
          ? <Landmark size={12} className="text-amber-500 shrink-0" />
          : <Banknote size={12} className="text-slate-400 shrink-0" />}
        <span className={`text-xs truncate ${a.linked ? 'text-slate-700 font-medium' : 'text-slate-500'}`}>
          {a.name}
        </span>
        {a.isLiability && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 shrink-0">
            debt service
          </span>
        )}
        {a.balance !== null && (
          <span className={`ml-auto text-xs font-mono shrink-0 ${a.isLiability ? 'text-amber-700' : 'text-slate-500'}`}>
            {a.isLiability ? `−${fmt(a.balance)}` : fmt(a.balance)}
          </span>
        )}
      </label>
    </li>
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Linked accounts</h2>
        <button
          onClick={() => { setEditing((v) => !v); setFilter(''); }}
          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700 transition-colors shrink-0"
        >
          {editing ? <><X size={11} /> Done</> : <><Plus size={11} /> Edit</>}
        </button>
      </div>
      <p className="text-[11px] text-slate-400 mb-4">
        Transactions in these accounts are attributed to this property&apos;s P&amp;L.
      </p>

      {editing ? (
        <>
          {accounts.length > 8 && (
            <div className="relative mb-2">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
              <input
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter accounts…"
                className="w-full text-xs border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>
          )}
          {/* Capped height rather than letting 20+ rows push the page: the list scrolls
              inside the card, so everything below it stays where it was. */}
          <ul className="space-y-1 max-h-72 overflow-y-auto">
            {editable.length === 0
              ? <li className="text-xs text-slate-400 italic py-2">No accounts match &ldquo;{filter}&rdquo;.</li>
              : editable.map((a) => row(a, true))}
          </ul>
        </>
      ) : linked.length === 0 ? (
        <p className="text-xs text-slate-400 italic">
          None linked yet — use <span className="font-medium">Edit</span> to attach this property&apos;s
          mortgage and operating account.
        </p>
      ) : (
        <>
          <ul className="space-y-1">{linked.map((a) => row(a, false))}</ul>
          {/* Lives here rather than in the page header: this card already lists the very
              accounts it totals, so the number is explained by what sits above it. Cash is
              reported separately from equity on purpose — it is liquid and equity is not. */}
          {cashAccounts.length > 0 && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
              <span className="text-[11px] text-slate-500">
                Operating cash
                {cashAccounts.length > 1 && <span className="text-slate-400"> · {cashAccounts.length} accounts</span>}
              </span>
              <span className="text-xs font-mono font-semibold text-slate-700">{fmt(operatingCash)}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
