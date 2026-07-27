'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { ACCOUNT_TYPES, accountTypeLabel } from '@/lib/accountTypes';

interface Props { accountId: string; type: string; subtype: string | null }

export default function AccountTypeEdit({ accountId, type, subtype }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);

  async function save(next: string) {
    setEditing(false);
    const chosen = ACCOUNT_TYPES.find((t) => (t.subtype ?? t.type) === next) ?? ACCOUNT_TYPES[0];
    await fetch(`/api/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: chosen.type, subtype: chosen.subtype }),
    });
    startTransition(async () => { await router.refresh(); });
  }

  if (editing) {
    return (
      <select
        autoFocus
        defaultValue={subtype ?? type}
        onChange={(e) => save(e.target.value)}
        onBlur={() => setEditing(false)}
        className="text-xs border border-slate-200 rounded-full px-2 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400"
      >
        {ACCOUNT_TYPES.map((t) => (
          <option key={t.label} value={t.subtype ?? t.type}>{t.label}</option>
        ))}
      </select>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="group flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium hover:bg-slate-200 transition-colors shrink-0"
      title="Click to change account type"
    >
      {accountTypeLabel(type, subtype)}
      <Pencil size={9} className="opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}
