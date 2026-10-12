'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing } from 'lucide-react';

/**
 * A linked cash account's overdraft watch: on or off, and the balance to warn under. On by default
 * with no cushion, so a new checking account is watched for going below zero without anyone setting
 * it up; off is for an account whose overdraft is covered by a linked savings account.
 */
export default function OverdraftSettings({ accountId, watch, cushion }: {
  accountId: string;
  watch: boolean;
  cushion: number;
}) {
  const router = useRouter();
  const [on, setOn] = useState(watch);
  const [value, setValue] = useState(cushion > 0 ? cushion.toFixed(2) : '0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: { overdraft_watch?: boolean; overdraft_cushion?: number }) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/accounts/${encodeURIComponent(accountId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!body?.success) { setError(body?.error?.message ?? 'Could not save.'); return false; }
    router.refresh();
    return true;
  }

  async function toggle() {
    const next = !on;
    setOn(next);
    if (!(await save({ overdraft_watch: next }))) setOn(!next);
  }

  const parsed = Number(value.replace(/[$,\s]/g, ''));
  const dirty = Number.isFinite(parsed) && Math.round(parsed * 100) !== Math.round(cushion * 100);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 sm:p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <BellRing size={14} className="text-slate-400" /> Overdraft watch
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {on ? 'A push to your phone when the balance falls below the cushion.' : 'Off — no warning for this account.'}
          </p>
        </div>
        <button
          type="button" role="switch" aria-checked={on} aria-label="Overdraft watch"
          onClick={toggle} disabled={busy}
          className={`relative shrink-0 h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-slate-900' : 'bg-slate-300'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
      {on && (
        <div className="flex items-end gap-2">
          <label className="block flex-1 min-w-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Warn below</span>
            <input
              value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal"
              className="mt-1 w-full text-base sm:text-sm font-mono border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </label>
          <button
            type="button" disabled={busy || !dirty}
            onClick={() => save({ overdraft_cushion: parsed })}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
