'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props { accountId: string; current: boolean; }

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
    <label className="flex items-center gap-2 cursor-pointer select-none" title={tracked ? 'Tracking transactions' : 'Transactions hidden from budget'}>
      <div
        onClick={toggle}
        className={`relative w-8 h-4.5 rounded-full transition-colors ${saving ? 'opacity-50' : ''} ${tracked ? 'bg-slate-700' : 'bg-slate-200'}`}
      >
        <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${tracked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </div>
      <span className={`text-xs font-medium ${tracked ? 'text-slate-600' : 'text-slate-400'}`}>
        {tracked ? 'Tracking' : 'Hidden'}
      </span>
    </label>
  );
}
