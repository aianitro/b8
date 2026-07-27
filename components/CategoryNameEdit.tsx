'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Check, X } from 'lucide-react';

interface Props {
  id: number;
  name: string;
}

export default function CategoryNameEdit({ id, name }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(name);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setInput(name);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setInput(name);
  }

  async function save() {
    const trimmed = input.trim();
    if (!trimmed || trimmed === name) { cancel(); return; }
    setSaving(true);
    await fetch('/api/categories', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: trimmed }),
    });
    setSaving(false);
    setEditing(false);
    router.push(`/categories/${encodeURIComponent(trimmed)}`);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') cancel();
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          className="text-2xl font-bold text-slate-900 border border-slate-300 rounded-lg px-2 py-0.5 outline-none focus:ring-2 focus:ring-slate-900/10"
        />
        <button onClick={save} disabled={saving} className="p-1 text-emerald-600 hover:text-emerald-700 disabled:opacity-50">
          <Check size={16} />
        </button>
        <button onClick={cancel} className="p-1 text-slate-400 hover:text-slate-600">
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 group">
      <h1 className="text-2xl font-bold text-slate-900">{name}</h1>
      <button
        onClick={startEdit}
        className="p-1 text-slate-300 hover:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Rename category"
      >
        <Pencil size={14} />
      </button>
    </div>
  );
}
