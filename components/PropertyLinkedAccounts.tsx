'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Landmark, Banknote } from 'lucide-react';

export interface LinkableAccount {
  id: string;
  name: string;
  isLiability: boolean;
  linked: boolean;
}

interface Props { propertyId: number; accounts: LinkableAccount[]; }

// Replaces the mortgage-only dropdown. Per-property P&L attributes transactions by the account
// they landed in, so a rental's operating account (the trust checking) has to be linkable too —
// which is why accounts.property_id was left generic rather than constrained to liabilities.
export default function PropertyLinkedAccounts({ propertyId, accounts }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

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
  const available = accounts.filter((a) => !a.linked);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Linked accounts</h2>
      <p className="text-[11px] text-slate-400 mb-4">
        Transactions in these accounts are attributed to this property&apos;s P&amp;L.
      </p>

      {accounts.length === 0 ? (
        <p className="text-xs text-slate-400 italic">No unlinked accounts available.</p>
      ) : (
        <ul className="space-y-1">
          {[...linked, ...available].map((a) => (
            <li key={a.id}>
              <label className="flex items-center gap-2.5 py-1.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={a.linked}
                  disabled={busyId === a.id}
                  onChange={() => toggle(a)}
                  className="rounded border-slate-300 text-slate-900 focus:ring-slate-400 disabled:opacity-40"
                />
                {a.isLiability
                  ? <Landmark size={12} className="text-red-400 shrink-0" />
                  : <Banknote size={12} className="text-slate-400 shrink-0" />}
                <span className={`text-xs truncate ${a.linked ? 'text-slate-700 font-medium' : 'text-slate-500'}`}>
                  {a.name}
                </span>
                {a.isLiability && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 shrink-0">
                    debt service
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
