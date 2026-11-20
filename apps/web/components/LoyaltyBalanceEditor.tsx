'use client';

// Loyalty (P8-42a) — entering a balance on /travel. NOT AN EDIT OF THE OLD ONE: saving POSTs a new
// reading to the membership's observations route, which appends a row with source `typed`. There is
// no PATCH or PUT of a balance anywhere; the history stays, and the current balance is whichever
// reading has the newest as-of date — so entering an older date records it without changing what
// the card shows.
//
// THE DATE DEFAULTS TO THIS DEVICE'S CALENDAR DAY, from `localIsoDate` when the editor opens, and is
// sent explicitly. Not a UTC day: west of Greenwich that is tomorrow every evening.
//
// THE BALANCE IS SENT AS THE TEXT TYPED. The server applies the unit's rule and refuses a fraction on
// points or a third decimal on cash; nothing here parses it into a number.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { localIsoDate } from '@/lib/localDate';
import type { LoyaltyUnit } from '@b8/contracts/loyalty';
import { send } from './LoyaltyRequest';

const UNIT_OPTIONS: LoyaltyUnit[] = ['points', 'miles', 'nights', 'usd'];

export default function LoyaltyBalanceEditor({
  membershipId, unit, onClose,
}: { membershipId: number; unit: LoyaltyUnit; onClose: () => void }) {
  const router = useRouter();
  const [balance, setBalance] = useState('');
  const [chosenUnit, setChosenUnit] = useState<LoyaltyUnit>(unit);
  const [asOf, setAsOf] = useState(() => localIsoDate());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const result = await send('POST', `/api/v1/loyalty/memberships/${membershipId}/observations`, {
      asOf, balance: balance.trim(), unit: chosenUnit, source: 'typed',
    });
    setSaving(false);
    if (!result.ok) { setError(result.message); return; }
    onClose();
    router.refresh();
  }

  return (
    <form onSubmit={save} className="mt-2 grid grid-cols-2 sm:flex sm:flex-wrap items-end gap-2 bg-gray-50 rounded-lg p-3">
      <label className="col-span-2 sm:flex-1 text-xs text-gray-400">
        New balance
        <input
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          inputMode={chosenUnit === 'usd' ? 'decimal' : 'numeric'}
          autoFocus
          required
          className="mt-1 block w-full border border-gray-200 rounded px-2 py-1.5 text-base sm:text-sm font-mono text-gray-900"
        />
      </label>
      <label className="text-xs text-gray-400">
        Unit
        <select
          value={chosenUnit}
          onChange={(e) => setChosenUnit(e.target.value as LoyaltyUnit)}
          className="mt-1 block w-full border border-gray-200 rounded px-2 py-1.5 text-base sm:text-sm text-gray-900 bg-white"
        >
          {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </label>
      <label className="text-xs text-gray-400">
        As of
        <input
          type="date"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
          required
          className="mt-1 block w-full border border-gray-200 rounded px-2 py-1.5 text-base sm:text-sm text-gray-900"
        />
      </label>
      <div className="col-span-2 flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onClose} disabled={saving} className="px-3 py-2 text-sm text-gray-500 disabled:opacity-50">
          Cancel
        </button>
      </div>
      {error && <p className="col-span-2 text-red-500 text-sm">{error}</p>}
    </form>
  );
}
