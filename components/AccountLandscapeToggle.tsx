'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Landscape } from '@/shared/types';

interface Props { accountId: string; current: Landscape; }

export default function AccountLandscapeToggle({ accountId, current }: Props) {
  const router = useRouter();
  const [value, setValue] = useState<Landscape>(current);
  const [saving, setSaving] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as Landscape;
    setValue(next);
    setSaving(true);
    await fetch(`/api/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ landscape: next }),
    });
    setSaving(false);
    router.refresh();
  }

  return (
    // Tinted to match the row's landscape accent bar, so the grouping is scannable down the
    // column instead of needing the label read on every row.
    <select
      value={value}
      onChange={handleChange}
      disabled={saving}
      title="Which landscape this account belongs to"
      className={`w-full text-xs rounded-lg pl-2 pr-1 py-1.5 border disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer ${
        value === 'operational'
          ? 'bg-blue-50 text-blue-700 border-blue-100'
          : 'bg-violet-50 text-violet-700 border-violet-100'
      }`}
    >
      <option value="operational">Operational</option>
      <option value="capital">Capital</option>
    </select>
  );
}
