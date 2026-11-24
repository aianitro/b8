'use client';

// Loyalty (P8-42d) — the screenshot control of one membership: pick a screenshot of the program's
// app, have it read, check the pre-filled form, and save it with one tap. Nothing is saved before
// that tap; the read route writes nothing.
//
// THE FILE INPUT IS MADE PER TAP and dropped after it, and the shrunk image lives only inside
// `readScreenshot` for its one request (`lib/loyaltyScreenshotClient.ts`). Component state holds what
// the server answered about the image, never the image.
//
// A DISAGREEMENT WARNS, IT NEVER BLOCKS (SPEC.md D2). Each `mismatch` adds one sentence and relabels the
// save button to say it saves despite that; the person chose this membership and can see the screenshot. A
// `not_stated` says nothing: a screenshot that prints no number is normal.
//
// THE FORM SAYS WHETHER THE READING WILL BE THE BALANCE before the tap, through `screenshotStanding`,
// the reducer's rule restated: an older as-of is recorded and does not replace the balance on file.
//
// NULL IS AN EMPTY FIELD, never a zero. A screenshot with no readable balance leaves the field blank
// and says so; an absent as-of becomes this device's calendar day (`localIsoDate`), as typed entry does.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { localIsoDate } from '@/lib/localDate';
import { screenshotStanding } from '@/lib/domain/loyaltyScreenshot';
import { readScreenshot, screenshotConfirmPath } from '@/lib/loyaltyScreenshotClient';
import type { LoyaltyScreenshotRead, LoyaltyUnit } from '@b8/contracts/loyalty';
import { send } from './LoyaltyRequest';

const UNIT_OPTIONS: LoyaltyUnit[] = ['points', 'miles', 'nights', 'usd'];

/** The sentence for a read that produced nothing to pre-fill, by outcome. */
const EMPTY_NOTE: Record<LoyaltyScreenshotRead['outcome'], string> = {
  read: 'Nothing could be read from that screenshot. Enter the balance by hand.',
  disabled: 'Screenshot reading is not set up. Enter the balance by hand.',
  error: 'The screenshot could not be read right now. Try again, or enter the balance by hand.',
};

export default function LoyaltyScreenshotCapture({
  membershipId, currentAsOf, currentUnit, defaultUnit,
}: { membershipId: number; currentAsOf: string | null; currentUnit: LoyaltyUnit | null; defaultUnit: LoyaltyUnit }) {
  const router = useRouter();
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState<LoyaltyScreenshotRead | null>(null);
  const [balance, setBalance] = useState('');
  const [unit, setUnit] = useState<LoyaltyUnit>(currentUnit ?? defaultUnit);
  const [asOf, setAsOf] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Opens the photo picker with a fresh input, then reads the one file chosen. */
  function pick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setReading(true);
      setError(null);
      const result = await readScreenshot(membershipId, file);
      setReading(false);
      if (!result.ok) { setError(result.message); return; }
      setRead(result.read);
      setBalance(result.read.balance ?? '');
      setUnit(result.read.unit ?? currentUnit ?? defaultUnit);
      setAsOf(result.read.asOf ?? localIsoDate());
    };
    input.click();
  }

  function close() {
    setRead(null);
    setError(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const result = await send('POST', screenshotConfirmPath(membershipId), { asOf, balance: balance.trim(), unit });
    setSaving(false);
    if (!result.ok) { setError(result.message); return; }
    close();
    router.refresh();
  }

  if (read === null) {
    return (
      <div className="mt-1">
        <button type="button" onClick={pick} disabled={reading} className="min-h-8 px-2 -mx-2 rounded text-xs text-blue-600 hover:bg-gray-100 disabled:opacity-50">
          {reading ? 'Reading…' : 'Update from screenshot'}
        </button>
        {error && <p className="text-red-500 text-sm">{error}</p>}
      </div>
    );
  }

  const standing = asOf === '' ? 'current' : screenshotStanding(currentAsOf, asOf);
  const disagrees = read.programCheck === 'mismatch' || read.suffixCheck === 'mismatch' || read.unitCheck === 'mismatch';
  return (
    <form onSubmit={save} className="mt-2 grid gap-2 bg-gray-50 rounded-lg p-3 text-sm">
      {read.balance === null && <p className="text-gray-600">{EMPTY_NOTE[read.outcome]}</p>}
      {read.maskedSuffix !== null && <p className="text-xs text-gray-400">Number on the screenshot ends <span className="font-mono">{read.maskedSuffix}</span></p>}
      {read.programCheck === 'mismatch' && <p className="text-amber-600">The screenshot looks like a different program.</p>}
      {read.suffixCheck === 'mismatch' && <p className="text-amber-600">The member number on the screenshot does not match this membership.</p>}
      {read.unitCheck === 'mismatch' && <p className="text-amber-600">The unit differs from the one on file.</p>}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-end gap-2">
        <label className="col-span-2 sm:flex-1 text-xs text-gray-400">
          Balance
          <input value={balance} onChange={(e) => setBalance(e.target.value)} inputMode={unit === 'usd' ? 'decimal' : 'numeric'} required
            className="mt-1 block w-full border border-gray-200 rounded px-2 py-1.5 text-base sm:text-sm font-mono text-gray-900" />
        </label>
        <label className="text-xs text-gray-400">
          Unit
          <select value={unit} onChange={(e) => setUnit(e.target.value as LoyaltyUnit)} className="mt-1 block w-full border border-gray-200 rounded px-2 py-1.5 text-base sm:text-sm text-gray-900 bg-white">
            {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-400">
          As of
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} required
            className="mt-1 block w-full border border-gray-200 rounded px-2 py-1.5 text-base sm:text-sm text-gray-900" />
        </label>
      </div>
      {standing === 'recorded_only' && <p className="text-amber-600">This is older than the balance on file. It will be recorded but will not replace it.</p>}
      {(read.expiryWarnings.length > 0 || read.instruments.length > 0) && (
        <ul className="text-xs text-gray-500">
          {read.expiryWarnings.map((w, i) => <li key={`w${i}`}>{`Expiring ${w.what}${w.amount === null ? '' : ` (${w.amount})`} on ${w.expiresOn}`}</li>)}
          {read.instruments.map((x, i) => <li key={`i${i}`}>{`Holds ${x.kind.replace(/_/g, ' ')}${x.expiresOn === null ? '' : `, expires ${x.expiresOn}`}`}</li>)}
        </ul>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50">
          {saving ? 'Saving…' : disagrees ? 'Save anyway' : 'Save balance'}
        </button>
        <button type="button" onClick={close} disabled={saving} className="px-3 py-2 text-sm text-gray-500 disabled:opacity-50">
          Cancel
        </button>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
    </form>
  );
}
