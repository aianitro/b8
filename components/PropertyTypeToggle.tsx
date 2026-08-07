'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PropertyType } from '@/shared/types';

interface Props { propertyId: number; current: PropertyType; }

// Mirrors AccountLandscapeToggle.tsx's pattern: a styled <select> standing in for what was a
// static badge, colored the same way regardless of edit state so swapping it in doesn't shift
// the row's look.
export default function PropertyTypeToggle({ propertyId, current }: Props) {
  const router = useRouter();
  const [value, setValue] = useState<PropertyType>(current);
  const [saving, setSaving] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as PropertyType;
    setValue(next);
    setSaving(true);
    await fetch(`/api/properties/${propertyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: next }),
    });
    setSaving(false);
    router.refresh();
  }

  return (
    <select
      value={value}
      onChange={handleChange}
      disabled={saving}
      className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 border-0 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-slate-400 ${
        value === 'primary' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'
      }`}
    >
      <option value="primary">primary</option>
      <option value="rental">rental</option>
    </select>
  );
}
