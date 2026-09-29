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
  const [open, setOpen] = useState<string | null>(null);
  const [counted, setCounted] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (wallets.length === 0) return null;

  function start(id: string) {
    setOpen(id); setCounted(''); setCategory(''); setError(null); setResult(null);
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
              <button
                onClick={() => (open === w.accountId ? setOpen(null) : start(w.accountId))}
                className="shrink-0 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
              >
                {open === w.accountId ? 'Cancel' : 'Count'}
              </button>
            </div>

            {open === w.accountId && (
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

            {error && open === w.accountId && <p className="mt-2 text-xs text-red-500">{error}</p>}
            {result?.id === w.accountId && <p className="mt-2 text-xs text-emerald-600">{result.text}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
