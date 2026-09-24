'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { BudgetCategory } from '@b8/contracts/types';
import { groupCategories, setCategory } from '@/lib/transactionEdits';

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

  // The grouping moved to `lib/transactionEdits.ts` when the dashboard's row editor needed the
  // same three optgroups in the same order. One list, sorted once.
  const { operational, capital, excluded } = groupCategories(categories, /payment/i.test(description ?? ''));

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const prev = value;
    const next = e.target.value;
    setValue(next);
    setSaving(true);
    // Failures are swallowed here as they always were: the undo affordance that follows is what
    // the owner uses when a change does not look right, and it re-sends rather than asserting the
    // first send worked. Worth stating because the shared helper now THROWS where the bare fetch
    // returned — without this catch, a refused save would blank the page.
    await setCategory(transactionId, next || null).catch(() => {});
    setSaving(false);
    setUndoPrev(prev);
  }

  async function handleUndo() {
    if (undoPrev === null) return;
    const restore = undoPrev;
    setUndoPrev(null);
    setValue(restore);
    setSaving(true);
    await setCategory(transactionId, restore || null).catch(() => {});
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
