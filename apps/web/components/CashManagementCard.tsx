'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { daysSinceCount } from '@/lib/domain/cashCount';
import { localIsoDate } from '@/lib/localDate';

export interface WalletRef {
  accountId: string;
  name: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

// `text-base` below `sm`: iOS zooms the page into any input under 16px.
const FIELD = 'text-base sm:text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400';
const BUTTON = 'text-sm px-3 py-2 rounded-lg border border-slate-300 font-medium text-slate-700 hover:bg-slate-50 transition-colors';
const PRIMARY = 'text-sm px-4 py-2 rounded-lg bg-slate-900 text-white font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors';

/**
 * How old a wallet's balance is, said the way a person would.
 *
 * NEVER COUNTED IS NOT "very stale". A wallet added this morning and one abandoned in April are
 * different situations, and a single "0 days / 180 days" scale makes the first look like a problem
 * and the second look ordinary. The amber only appears once there is a count to have gone stale.
 */
function Staleness({ lastCountedAt }: { lastCountedAt: string | null }) {
  const days = daysSinceCount(lastCountedAt);
  if (days === null) return <span className="text-sm text-slate-500">Never counted</span>;
  if (days === 0) return <span className="text-sm text-slate-500">Counted today</span>;
  const stale = days >= 30;
  return (
    <span className={`text-sm ${stale ? 'text-amber-600 font-medium' : 'text-slate-500'}`}>
      Counted {days} {days === 1 ? 'day' : 'days'} ago
    </span>
  );
}

/**
 * Counting and moving cash, for one wallet, on that wallet's own page.
 *
 * MOVED HERE FROM THE /accounts LIST, where every wallet had a row of these controls. Counting is
 * done to one wallet at a time, with the wallet in hand, and its page is where its balance and
 * history already are — so the result of a count lands on the chart above it, not on a list.
 */
export default function CashManagementCard({ wallet, lastCountedAt, otherWallets, categories }: {
  wallet: WalletRef;
  lastCountedAt: string | null;
  /** Where cash can be moved to — every other countable wallet. */
  otherWallets: WalletRef[];
  /** What a shortfall can be filed as. */
  categories: string[];
}) {
  const router = useRouter();
  // One mode at a time: two independent "open" flags would allow both forms at once.
  const [mode, setMode] = useState<'count' | 'move' | null>(null);
  const [counted, setCounted] = useState('');
  const [category, setCategory] = useState('');
  const [moveAmount, setMoveAmount] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(next: 'count' | 'move') {
    setMode(mode === next ? null : next);
    setCounted(''); setCategory(''); setMoveAmount(''); setMoveTo('');
    setError(null); setResult(null);
  }

  async function move(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(moveAmount);
    if (!Number.isFinite(value) || value <= 0) { setError('Enter an amount greater than zero.'); return; }
    if (!moveTo) { setError('Choose where it went.'); return; }
    setBusy(true); setError(null);
    const res = await fetch('/api/v1/cash-transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromAccountId: wallet.accountId,
        toAccountId: moveTo,
        amount: value,
        // Today, because a move is recorded as it happens — on THIS device's calendar, not UTC's.
        date: localIsoDate(),
      }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok || !body?.success) { setError(body?.error?.message ?? 'Could not record the move.'); return; }
    const toName = otherWallets.find((w) => w.accountId === moveTo)?.name ?? 'the other wallet';
    setResult(`${fmt(value)} moved to ${toName}.`);
    setMode(null);
    router.refresh();
  }

  async function count(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(counted);
    if (counted.trim() === '' || !Number.isFinite(value) || value < 0) { setError('Enter the amount actually in the wallet.'); return; }
    setBusy(true); setError(null);
    const res = await fetch('/api/v1/cash-counts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: wallet.accountId, counted: value, mapped_category: category || null }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok || !body?.success) { setError(body?.error?.message ?? 'Could not record the count.'); return; }
    // SAY WHAT THE COUNT DID, not just that it worked. "It matched" and "it wrote off a large sum"
    // both return 200, and they deserve very different reactions from the person who just counted.
    const adj = body.data.adjustment as { direction: 'spent' | 'found'; magnitude: number } | null;
    setResult(adj === null
      ? 'Matched exactly — nothing to record.'
      : adj.direction === 'spent'
        ? `${fmt(adj.magnitude)} spent since the last count${category ? `, filed as ${category}` : ', left unfiled'}.`
        : `${fmt(adj.magnitude)} more than expected — recorded as received.`);
    setMode(null);
    router.refresh();
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Cash on hand</p>
          <p className="mt-1"><Staleness lastCountedAt={lastCountedAt} /></p>
        </div>
        <div className="flex gap-2">
          {/* Move only when there is somewhere to move TO; with one wallet its list would be empty. */}
          {otherWallets.length > 0 && (
            <button type="button" onClick={() => toggle('move')} className={BUTTON}>
              {mode === 'move' ? 'Cancel' : 'Move'}
            </button>
          )}
          <button type="button" onClick={() => toggle('count')} className={mode === 'count' ? BUTTON : PRIMARY}>
            {mode === 'count' ? 'Cancel' : 'Count'}
          </button>
        </div>
      </div>

      {mode === 'count' && (
        <form onSubmit={count} className="mt-4 grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end">
          <label className="block">
            <span className="text-xs text-slate-500">Actually in the wallet</span>
            <input inputMode="decimal" autoComplete="off" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="0.00" className={`${FIELD} mt-1 w-full`} />
          </label>
          {/* Filing is OPTIONAL by design: requiring it at count time is how counting stops
              happening. Unfiled money still shows up, in the uncategorized bucket. */}
          <label className="block min-w-0">
            <span className="text-xs text-slate-500">File a shortfall as</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${FIELD} mt-1 w-full`}>
              <option value="">— leave unfiled —</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy} className={PRIMARY}>{busy ? 'Saving…' : 'Record count'}</button>
        </form>
      )}

      {mode === 'move' && (
        <form onSubmit={move} className="mt-4 grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end">
          <label className="block">
            <span className="text-xs text-slate-500">Moved out of this wallet</span>
            <input inputMode="decimal" autoComplete="off" value={moveAmount} onChange={(e) => setMoveAmount(e.target.value)} placeholder="0.00" className={`${FIELD} mt-1 w-full`} />
          </label>
          <label className="block min-w-0">
            <span className="text-xs text-slate-500">To</span>
            <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={`${FIELD} mt-1 w-full`}>
              <option value="">— choose a wallet —</option>
              {otherWallets.map((o) => <option key={o.accountId} value={o.accountId}>{o.name}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy} className={PRIMARY}>{busy ? 'Saving…' : 'Record move'}</button>
        </form>
      )}

      {error && mode && <p className="mt-3 text-sm text-red-500">{error}</p>}
      {result && <p className="mt-3 text-sm text-emerald-600">{result}</p>}
    </section>
  );
}
