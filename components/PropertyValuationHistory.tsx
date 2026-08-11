'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';

export interface ValuationRow {
  id: number;
  value: number;
  valuedAt: string; // ISO
}

interface Props { propertyId: number; rows: ValuationRow[]; }

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

const today = () => new Date().toISOString().slice(0, 10);

export default function PropertyValuationHistory({ propertyId, rows }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [value, setValue] = useState('');
  const [valuedAt, setValuedAt] = useState(today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Number(value.replace(/[$,\s]/g, ''));
    if (value.trim() === '' || !Number.isFinite(parsed)) { setError('Enter a number'); return; }
    if (parsed < 0) { setError('Enter a positive market value'); return; }

    setSaving(true); setError(null);
    const res = await fetch(`/api/properties/${propertyId}/valuation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Sent as a date-only string; the column is timestamptz and takes midnight local.
      body: JSON.stringify({ value: parsed, valued_at: valuedAt || undefined }),
    });
    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? 'Could not save');
      return;
    }
    setValue('');
    setValuedAt(today());
    startTransition(async () => { await router.refresh(); });
  }

  async function remove(id: number) {
    setConfirmingId(null);
    const res = await fetch(`/api/properties/${propertyId}/valuation/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? 'Could not delete');
      return;
    }
    startTransition(async () => { await router.refresh(); });
  }

  return (
    <div>

      <form onSubmit={add} className="flex items-end gap-2 mb-4">
        <div className="flex-1">
          <label className="block text-[10px] font-medium text-slate-400 mb-1">Value</label>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="450,000"
            inputMode="decimal"
            className="w-full text-sm font-mono border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-slate-400 mb-1">As of</label>
          <input
            type="date"
            value={valuedAt}
            max={today()}
            onChange={(e) => setValuedAt(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1 px-3 py-2 bg-slate-900 hover:bg-slate-700 text-white rounded-lg text-sm font-medium disabled:opacity-40 transition-colors"
        >
          <Plus size={14} />
          {saving ? 'Adding…' : 'Add'}
        </button>
      </form>

      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      {rows.length === 0 ? (
        <p className="text-xs text-slate-400 italic py-2">
          No valuations yet. Add one above — backdate it to record what the property was worth then.
        </p>
      ) : (
        <ul className="divide-y divide-slate-50">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2 group">
              <span className="text-xs text-slate-400">{fmtDate(r.valuedAt)}</span>
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono font-medium text-slate-700">{fmt(r.value)}</span>
                {confirmingId === r.id ? (
                  <span className="flex items-center gap-1.5">
                    <button onClick={() => remove(r.id)} className="text-[10px] font-medium text-red-600 hover:text-red-700">
                      Delete
                    </button>
                    <button onClick={() => setConfirmingId(null)} className="text-[10px] text-slate-400 hover:text-slate-600">
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmingId(r.id)}
                    title="Delete this reading"
                    className="p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
