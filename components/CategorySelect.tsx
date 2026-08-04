'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { BudgetCategory } from '@/shared/types';

interface Props {
  transactionId: number;
  current: string | null;
  categories: Pick<BudgetCategory, 'name' | 'landscape' | 'exclude_from_budget'>[];
  description?: string | null;
}

const UNDO_WINDOW_MS = 5000;

export default function CategorySelect({ transactionId, current, categories, description }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? '');
  const [saving, setSaving] = useState(false);
  const [undoPrev, setUndoPrev] = useState<string | null>(null);

  // Adjusted during render rather than in an effect, so a `current` prop change (e.g. another
  // tab recategorizing the same transaction) is reflected in the same render pass.
  const [prevCurrent, setPrevCurrent] = useState(current);
  if (current !== prevCurrent) {
    setPrevCurrent(current);
    setValue(current ?? '');
  }

  useEffect(() => {
    if (undoPrev === null) return;
    const t = setTimeout(() => {
      setUndoPrev(null);
      router.refresh();
    }, UNDO_WINDOW_MS);
    return () => clearTimeout(t);
  }, [undoPrev, router]);

  const isPayment = /payment/i.test(description ?? '');

  const sorted = categories.slice().sort((a, b) => {
    if (!isPayment) return a.name.localeCompare(b.name);
    const aT = a.name.toLowerCase().includes('transfer');
    const bT = b.name.toLowerCase().includes('transfer');
    if (aT !== bT) return aT ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const operational = sorted.filter((c) => !c.exclude_from_budget && c.landscape === 'operational');
  const capital     = sorted.filter((c) => !c.exclude_from_budget && c.landscape === 'capital');
  const excluded    = sorted.filter((c) => c.exclude_from_budget);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const prev = value;
    const next = e.target.value;
    setValue(next);
    setSaving(true);
    await fetch(`/api/transactions/${transactionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapped_category: next || null }),
    });
    setSaving(false);
    setUndoPrev(prev);
  }

  async function handleUndo() {
    if (undoPrev === null) return;
    const restore = undoPrev;
    setUndoPrev(null);
    setValue(restore);
    setSaving(true);
    await fetch(`/api/transactions/${transactionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapped_category: restore || null }),
    });
    setSaving(false);
    router.refresh();
  }

  return (
    <div>
      <select
        value={value}
        onChange={handleChange}
        disabled={saving}
        className={`text-xs border rounded-lg px-2 py-1.5 bg-white disabled:opacity-50 w-full focus:outline-none focus:ring-1 focus:ring-slate-400 transition-colors ${
          value ? 'border-slate-200 text-slate-700' : 'border-slate-200 text-slate-400'
        }`}
      >
        <option value="">— uncategorized —</option>
        {operational.length > 0 && (
          <optgroup label="Operational">
            {operational.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </optgroup>
        )}
        {capital.length > 0 && (
          <optgroup label="Capital">
            {capital.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </optgroup>
        )}
        {excluded.length > 0 && (
          <optgroup label="Other">
            {excluded.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </optgroup>
        )}
      </select>
      {undoPrev !== null && (
        <div className="mt-1 flex items-center gap-1 text-xs text-slate-400">
          <span>Updated</span>
          <button
            onClick={handleUndo}
            disabled={saving}
            className="text-blue-600 hover:text-blue-700 font-medium underline disabled:opacity-50"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
