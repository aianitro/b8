'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Check, X } from 'lucide-react';

interface Props {
  propertyId: number;
  /** Latest recorded valuation, or null if this property has never been valued. */
  current: number | null;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

// Mirrors components/AccountValuationEdit.tsx — each save appends a new property_valuations
// row (the quarterly re-entry flow), never overwrites the last one. No liability variant here:
// a property's own value is always an asset.
export default function PropertyValuationEdit({ propertyId, current }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setValue(current !== null ? String(current) : '');
    setError(null);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function cancel() { setEditing(false); setError(null); }

  async function save() {
    const parsed = Number(value.replace(/[$,\s]/g, ''));
    if (!Number.isFinite(parsed) || value.trim() === '') {
      setError('Enter a number');
      return;
    }
    if (parsed < 0) {
      setError('Enter a positive market value');
      return;
    }

    setEditing(false);
    setError(null);
    const res = await fetch(`/api/properties/${propertyId}/valuation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: parsed }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? 'Could not save');
      return;
    }
    startTransition(async () => { await router.refresh(); });
  }

  if (editing) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
            placeholder="0.00"
            inputMode="decimal"
            className="text-xs font-mono border border-slate-200 rounded px-2 py-1 w-28 text-right focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
          <button onClick={save} className="p-1 text-emerald-600 hover:text-emerald-700" title="Save valuation">
            <Check size={13} />
          </button>
          <button onClick={cancel} className="p-1 text-slate-400 hover:text-slate-600" title="Cancel">
            <X size={13} />
          </button>
        </div>
        {error && <p className="text-[10px] text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end">
      <button
        onClick={startEdit}
        title={current !== null ? 'Record a new valuation' : 'No valuation recorded yet'}
        className="group flex items-center gap-1 text-xs transition-colors"
      >
        {current !== null ? (
          <span className="font-mono font-medium text-slate-600">{fmt(current)}</span>
        ) : (
          <span className="italic text-slate-400 hover:text-slate-600">Set value</span>
        )}
        <Pencil size={11} className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
      {error && <p className="text-[10px] text-red-500">{error}</p>}
    </div>
  );
}
