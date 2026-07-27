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
    <select
      value={value}
      onChange={handleChange}
      disabled={saving}
      className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-600 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-slate-400"
    >
      <option value="operational">Operational</option>
      <option value="capital">Capital</option>
    </select>
  );
}
