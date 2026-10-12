'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PiggyBank, X } from 'lucide-react';
import type { UnspentBucket } from '@/lib/unspentStore';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

/**
 * The budget page's unspent buckets: what each category left over in closed months and has not yet
 * been allocated, with the one action that clears it.
 *
 * Silent when nothing is waiting. A bucket fully allocated stays out of this list; its history lives
 * in the allocations, not on the page.
 */
export default function UnspentBuckets({ buckets, destinations, today }: {
  buckets: UnspentBucket[];
  /** Spending categories a carry may land in. */
  destinations: { id: number; name: string }[];
  /** 1-based month. */
  today: { year: number; month: number };
}) {
  const waiting = buckets.filter((b) => b.balance > 0);
  const [open, setOpen] = useState<UnspentBucket | null>(null);
  if (waiting.length === 0) return null;
  const total = waiting.reduce((s, b) => s + b.balance, 0);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 sm:p-6 mb-8">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Unspent to allocate</p>
        <p className="text-sm font-mono font-semibold text-emerald-600">{fmt(total)}</p>
      </div>
      <div className="divide-y divide-slate-50">
        {waiting.map((b) => {
          const sources = b.closes.filter((c) => c.amount > 0).slice(0, 3)
            .map((c) => `${MONTHS[c.month - 1]} +${fmt(c.amount)}`).join(' · ');
          return (
            <div key={b.categoryId} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{b.category}</p>
                <p className="text-[11px] text-slate-400 truncate">{sources}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm font-mono text-slate-700">{fmt(b.balance)}</span>
                <button
                  type="button"
                  onClick={() => setOpen(b)}
                  className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
                >
                  Allocate
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {open && <AllocateDialog bucket={open} destinations={destinations} today={today} onClose={() => setOpen(null)} />}
    </div>
  );
}

function AllocateDialog({ bucket, destinations, today, onClose }: {
  bucket: UnspentBucket;
  destinations: { id: number; name: string }[];
  today: { year: number; month: number };
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(bucket.balance.toFixed(2));
  const [action, setAction] = useState<'carry' | 'release'>('carry');
  const [toCategoryId, setToCategoryId] = useState(bucket.categoryId);
  // This month and the eleven after it: a carry lands no earlier than now.
  const months = Array.from({ length: 12 }, (_, i) => {
    const idx = today.year * 12 + today.month - 1 + i;
    return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
  });
  const [to, setTo] = useState(`${months[0].year}-${months[0].month}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const [y, m] = to.split('-').map(Number);
    const res = await fetch('/api/v1/budget/unspent/allocate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categoryId: bucket.categoryId,
        amount: Number(amount.replace(/[$,\s]/g, '')),
        action,
        ...(action === 'carry' ? { toCategoryId, toYear: y, toMonth: m } : {}),
      }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!body?.success) { setError(body?.error?.message ?? 'Could not save.'); return; }
    onClose();
    router.refresh();
  }

  const field = 'w-full text-base sm:text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-400';
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30" onClick={() => !busy && onClose()}>
      <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl shadow-xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Allocate {bucket.category}&apos;s unspent</p>
            <p className="text-xs text-slate-400">{fmt(bucket.balance)} available</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 -m-1 text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
          {(['carry', 'release'] as const).map((a) => (
            <button key={a} type="button" onClick={() => setAction(a)}
              className={`text-sm py-1.5 rounded-md font-medium ${action === a ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
              {a === 'carry' ? 'Carry to a month' : 'Release to savings'}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Amount</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={`${field} mt-1 font-mono`} />
        </label>

        {action === 'carry' ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Category</span>
              <select value={toCategoryId} onChange={(e) => setToCategoryId(Number(e.target.value))} className={`${field} mt-1`}>
                {destinations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Month</span>
              <select value={to} onChange={(e) => setTo(e.target.value)} className={`${field} mt-1`}>
                {months.map((m) => (
                  <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
                    {MONTHS[m.month - 1]}{m.year !== today.year ? ` ${m.year}` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <p className="flex items-start gap-2 text-xs text-slate-500">
            <PiggyBank size={14} className="shrink-0 mt-0.5 text-emerald-600" />
            Released money stays saved: no budget is raised, and it leaves this bucket.
          </p>
        )}

        {error && <p className="text-xs text-red-500">{error}</p>}
        <button type="button" onClick={submit} disabled={busy}
          className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50">
          {busy ? 'Saving…' : action === 'carry' ? 'Carry' : 'Release'}
        </button>
      </div>
    </div>
  );
}
