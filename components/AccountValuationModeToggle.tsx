'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ValuationMode } from '@/shared/types';

// Presents valuation_mode + is_liability as one three-way choice, because that's the shape of
// the real decision: is_liability has no effect on a ledger-mode account (computeNetWorth()
// deliberately ignores it there, since a ledger running balance already carries its own sign),
// so "ledger + liability" is a state worth making unreachable in the UI. The API still takes
// the two fields independently.
type Choice = 'ledger' | 'asset' | 'liability';

interface Props { accountId: string; mode: ValuationMode; isLiability: boolean; }

function toChoice(mode: ValuationMode, isLiability: boolean): Choice {
  if (mode === 'ledger') return 'ledger';
  return isLiability ? 'liability' : 'asset';
}

export default function AccountValuationModeToggle({ accountId, mode, isLiability }: Props) {
  const router = useRouter();
  const [value, setValue] = useState<Choice>(toChoice(mode, isLiability));
  const [saving, setSaving] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as Choice;
    setValue(next);
    setSaving(true);
    await fetch(`/api/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valuation_mode: next === 'ledger' ? 'ledger' : 'valuation',
        is_liability: next === 'liability',
      }),
    });
    setSaving(false);
    router.refresh();
  }

  return (
    <select
      value={value}
      onChange={handleChange}
      disabled={saving}
      title="How this account's balance is determined"
      className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-600 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-slate-400"
    >
      <option value="ledger">Ledger</option>
      <option value="asset">Valuation (asset)</option>
      <option value="liability">Valuation (liability)</option>
    </select>
  );
}
