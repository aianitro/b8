'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Check, X } from 'lucide-react';

interface Props { accountId: string; current: string }

export default function AccountNameEdit({ accountId, current }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setValue(current);
    setError(false);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function cancel() { setEditing(false); setValue(current); setError(false); }

  async function save() {
    if (!value.trim()) { setError(true); return; }
    setEditing(false);
    await fetch(`/api/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: value.trim() }),
    });
    startTransition(async () => { await router.refresh(); });
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
          className={`text-sm font-medium border rounded px-2 py-0.5 w-48 focus:outline-none focus:ring-1 ${error ? 'border-red-400 focus:ring-red-300' : 'border-slate-300 focus:ring-slate-400'}`}
        />
        <button onClick={save} className="p-1 text-emerald-600 hover:text-emerald-700">
          <Check size={14} />
        </button>
        <button onClick={cancel} className="p-1 text-slate-400 hover:text-slate-600">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={startEdit}
      className="group flex items-center gap-1.5 font-medium text-slate-800 text-sm hover:text-slate-600 transition-colors"
    >
      <span className="truncate">{current}</span>
      <Pencil size={11} className="shrink-0 opacity-0 group-hover:opacity-50 transition-opacity" />
    </button>
  );
}
