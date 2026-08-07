'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';

interface Props { accountId: string; current: boolean; }

// Icon-only. The previous switch-plus-"Tracking"/"Hidden"-label cost ~90px in every row, which
// the accounts list can't spare now that it also carries a balance-mode and a landscape
// control. An eye is the conventional show/hide affordance, and the column header names it.
export default function AccountTrackingToggle({ accountId, current }: Props) {
  const router = useRouter();
  const [tracked, setTracked] = useState(current);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    const next = !tracked;
    setTracked(next);
    setSaving(true);
    await fetch(`/api/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track_transactions: next }),
    });
    setSaving(false);
    router.refresh();
  }

  return (
    <button
      onClick={toggle}
      disabled={saving}
      // Deliberately says "transactions": this flag no longer gates net worth for
      // valuation-mode accounts (see getNetWorth in app/dashboard/page.tsx), so promising
      // it hides the account everywhere would be wrong.
      title={tracked
        ? 'Transactions included in budgets and dashboard totals'
        : 'Transactions hidden from budgets and dashboard totals'}
      aria-label={tracked ? 'Tracked' : 'Hidden'}
      aria-pressed={tracked}
      className={`mx-auto flex items-center justify-center w-7 h-7 rounded-lg transition-colors disabled:opacity-40 ${
        tracked ? 'text-slate-600 hover:bg-slate-100' : 'text-slate-300 hover:bg-slate-100 hover:text-slate-400'
      }`}
    >
      {tracked ? <Eye size={14} /> : <EyeOff size={14} />}
    </button>
  );
}
