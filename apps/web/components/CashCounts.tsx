'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { daysSinceCount } from '@/lib/domain/cashCount';

export interface Wallet {
  accountId: string;
  name: string;
  balance: number;
  lastCountedAt: string | null;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

/**
 * How old a wallet's balance is, said the way a person would.
 *
 * NEVER COUNTED IS NOT "very stale". A wallet added this morning and one abandoned in April are
 * different situations, and a single "0 days / 180 days" scale makes the first look like a problem
 * and the second look ordinary. The amber only appears once there is a count to have gone stale.
 */
function Staleness({ lastCountedAt }: { lastCountedAt: string | null }) {
  const days = daysSinceCount(lastCountedAt);
  if (days === null) return <span className="text-xs text-slate-400">never counted</span>;
  if (days === 0) return <span className="text-xs text-slate-400">counted today</span>;
  const stale = days >= 30;
  return (
    <span className={`text-xs ${stale ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>
      counted {days} {days === 1 ? 'day' : 'days'} ago
    </span>
  );
}

export default function CashCounts({ wallets, categories }: { wallets: Wallet[]; categories: string[] }) {
  const router = useRouter();
  // One open panel at a time, and the mode with it. Two independent "which row is open" flags would
  // let a wallet show both forms at once, which is a state nobody wants and nothing prevents.
  const [open, setOpen] = useState<{ id: string; mode: 'count' | 'move' } | null>(null);
  const [counted, setCounted] = useState('');
  const [category, setCategory] = useState('');
  const [moveAmount, setMoveAmount] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (wallets.length === 0) return null;

  function start(id: string, mode: 'count' | 'move') {
    setOpen({ id, mode });
    setCounted(''); setCategory(''); setMoveAmount(''); setMoveTo('');
    setError(null); setResult(null);
  }

  async function move(from: Wallet) {
    const value = Number(moveAmount);
    if (!Number.isFinite(value) || value <= 0) { setError('Enter an amount greater than zero.'); return; }
    if (!moveTo) { setError('Choose where it went.'); return; }
    setBusy(true); setError(null);
    const res = await fetch('/api/v1/cash-transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromAccountId: from.accountId,
        toAccountId: moveTo,
        amount: value,
        // Today, because a move is recorded as it happens. A date field would be a fifth control on
        // a row that already wraps on a phone, for a case the owner can fix in the ledger.
        date: new Date().toISOString().slice(0, 10),
      }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok || !body?.success) { setError(body?.error?.message ?? 'Could not record the move.'); return; }
    const toName = wallets.find((w) => w.accountId === moveTo)?.name ?? 'the other wallet';
    setResult({ id: from.accountId, text: `${fmt(value)} moved to ${toName}.` });
    setOpen(null);
    router.refresh();
  }

  async function submit(w: Wallet) {
    const value = Number(counted);
    if (!Number.isFinite(value) || value < 0) { setError('Enter the amount actually in the wallet.'); return; }
    setBusy(true); setError(null);
    const res = await fetch('/api/v1/cash-counts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: w.accountId, counted: value, mapped_category: category || null }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok || !body?.success) {
      setError(body?.error?.message ?? 'Could not record the count.');
      return;
    }
    // SAY WHAT THE COUNT DID, not just that it worked. "It matched" and "it wrote off a large sum"
    // both return 200, and they deserve very different reactions from the person who just counted.
    const adj = body.data.adjustment as { direction: 'spent' | 'found'; magnitude: number } | null;
    setResult({
      id: w.accountId,
      text: adj === null
        ? 'Matched exactly — nothing to record.'
        : adj.direction === 'spent'
          ? `${fmt(adj.magnitude)} spent since the last count${category ? `, filed as ${category}` : ', left unfiled'}.`
          : `${fmt(adj.magnitude)} more than expected — recorded as received.`,
    });
    setOpen(null);
    router.refresh();
  }

  return (
    <section className="mb-8">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Cash on hand</h2>
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-50">
        {wallets.map((w) => (
          <div key={w.accountId} className="px-4 sm:px-6 py-3">
            <div className="flex items-center gap-x-3">
              {/* `min-w-0` so a long wallet name truncates instead of pushing the button off a
                  phone screen — a flex child will not shrink below its content without it. */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 truncate">{w.name}</p>
                <Staleness lastCountedAt={w.lastCountedAt} />
              </div>
              <span className="shrink-0 font-mono text-sm text-slate-700">{fmt(w.balance)}</span>
              {/* Move is offered only when there is somewhere to move TO. With one wallet the button
                  would open a form whose destination list is empty. */}
              {wallets.length > 1 && (
                <button
                  onClick={() => (open?.id === w.accountId && open.mode === 'move' ? setOpen(null) : start(w.accountId, 'move'))}
                  className="shrink-0 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  {open?.id === w.accountId && open.mode === 'move' ? 'Cancel' : 'Move'}
                </button>
              )}
              <button
                onClick={() => (open?.id === w.accountId && open.mode === 'count' ? setOpen(null) : start(w.accountId, 'count'))}
                className="shrink-0 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
              >
                {open?.id === w.accountId && open.mode === 'count' ? 'Cancel' : 'Count'}
              </button>
            </div>

            {open?.id === w.accountId && open.mode === 'move' && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="text-xs text-slate-500 w-full sm:w-auto">Moved out of this wallet</label>
                <input
                  autoFocus
                  inputMode="decimal"
                  value={moveAmount}
                  onChange={(e) => setMoveAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-28 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
                <select
                  value={moveTo}
                  onChange={(e) => setMoveTo(e.target.value)}
                  className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white max-w-[12rem]"
                >
                  <option value="">— to which wallet —</option>
                  {wallets.filter((o) => o.accountId !== w.accountId).map((o) => (
                    <option key={o.accountId} value={o.accountId}>{o.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => move(w)}
                  disabled={busy}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-40 transition-colors"
                >
                  {busy ? 'Saving…' : 'Move'}
                </button>
              </div>
            )}

            {open?.id === w.accountId && open.mode === 'count' && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="text-xs text-slate-500 w-full sm:w-auto">Actually in the wallet</label>
                <input
                  autoFocus
                  inputMode="decimal"
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                  placeholder="0.00"
                  className="w-28 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
                {/* Filing is OPTIONAL by design: requiring it at count time is how counting stops
                    happening. Unfiled money still shows up — it lands in the uncategorized bucket
                    the coverage bound already reports on. */}
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white max-w-[12rem]"
                >
                  <option value="">— leave unfiled —</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button
                  onClick={() => submit(w)}
                  disabled={busy}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-40 transition-colors"
                >
                  {busy ? 'Saving…' : 'Record'}
                </button>
              </div>
            )}

            {error && open?.id === w.accountId && <p className="mt-2 text-xs text-red-500">{error}</p>}
            {result?.id === w.accountId && <p className="mt-2 text-xs text-emerald-600">{result.text}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
