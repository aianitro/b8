'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Check, X } from 'lucide-react';

interface Props { accountId: string; current: string | null }

export default function AccountBankEdit({ accountId, current }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setValue(current ?? '');
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function cancel() { setEditing(false); setValue(current ?? ''); }

  async function save() {
    setEditing(false);
    const bank = value.trim() || null;
    await fetch(`/api/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bank }),
    });
    startTransition(async () => { await router.refresh(); });
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
          placeholder="Bank name"
          className="text-xs border border-slate-200 rounded px-2 py-1 w-28 focus:outline-none focus:ring-1 focus:ring-slate-400"
        />
        <button onClick={save} className="p-1 text-emerald-600 hover:text-emerald-700">
          <Check size={13} />
        </button>
        <button onClick={cancel} className="p-1 text-slate-400 hover:text-slate-600">
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={startEdit}
      className="group flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
    >
      {current
        ? <span className="font-medium text-slate-500">{current}</span>
        : <span className="italic">Add bank</span>}
      <Pencil size={11} className="opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}
