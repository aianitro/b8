'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Check, X } from 'lucide-react';

interface Props {
  categoryName: string;
  value: number;
}

const fmtFull = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

export default function CategoryBalanceEdit({ categoryName, value }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setInput(value === 0 ? '' : String(value));
    setEditing(true);
  }

  async function save() {
    const num = parseFloat(input.replace(/,/g, ''));
    if (isNaN(num)) { cancel(); return; }
    setSaving(true);
    await fetch(`/api/categories/${encodeURIComponent(categoryName)}/balance`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ beginning_balance: num }),
    });
    setSaving(false);
    setEditing(false);
    router.refresh();
  }

  function cancel() { setEditing(false); setInput(''); }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') cancel();
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-lg px-2 py-1 shadow-sm">
          <span className="text-xs text-slate-400">$</span>
          <input
            autoFocus
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="0.00"
            className="w-28 text-sm font-mono text-slate-800 outline-none"
          />
        </div>
        <button onClick={save} disabled={saving} className="p-1 text-emerald-600 hover:text-emerald-700 disabled:opacity-50">
          <Check size={14} />
        </button>
        <button onClick={cancel} className="p-1 text-slate-400 hover:text-slate-600">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 group">
      <span className="text-sm font-mono font-semibold text-slate-700">{fmtFull(value)}</span>
      <button
        onClick={startEdit}
        className="p-1 text-slate-300 hover:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Edit beginning balance"
      >
        <Pencil size={12} />
      </button>
    </div>
  );
}
