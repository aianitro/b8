'use client';

// Gifts (P7-41b) — the giver's own gifts, with the one notice this feature sends. Only the giver
// ever receives these objects (`listGifts` is scoped to them), so this may show the real criteria
// and candidates. Amounts are the decimal text the server sent, shown as-is: no float, no rounding.
//
// ─── ATTACHING A PURCHASE ALREADY SYNCED (P7-41c) ─────────────────────────────────────────────
//
// A gift that is still waiting (`awaiting` or `choose`, not yet revealed) offers "Find the
// purchase". The rows it could take are fetched ONLY when the giver clicks it — never on render
// and never by the page — so they are in no page's props or flight payload, and a list fetched
// once cannot go stale across a refresh: closing it drops it. Picking one posts its id and nothing
// else; whether it qualifies is decided by the server under lock, not by this list.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Gift, GiftCandidateList } from '@b8/contracts/gifts';

const STATE_LABEL: Record<string, string> = {
  awaiting: 'Waiting for the purchase',
  choose: 'Choose which one',
  matched: 'Matched',
  unmatched: 'Nothing matched',
  cancelled: 'Cancelled',
};

export default function GiftList({ gifts }: { gifts: Gift[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ giftId: number; rows: GiftCandidateList } | null>(null);

  async function post(id: number, path: string, body?: unknown) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/v1/gifts/${id}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => null);
    setBusy(null);
    if (!data?.success) setError(data?.error?.message ?? 'That did not work. Try again.');
    else router.refresh();
  }

  async function findPurchase(id: number) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/v1/gifts/${id}/candidates`);
    const data = await res.json().catch(() => null);
    setBusy(null);
    if (!data?.success) setError(data?.error?.message ?? 'That did not work. Try again.');
    else setPicking({ giftId: id, rows: data.data as GiftCandidateList });
  }

  async function attach(id: number, transactionId: number) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/v1/gifts/${id}/attach`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transactionId }),
    });
    const data = await res.json().catch(() => null);
    setBusy(null);
    if (!data?.success) {
      setError(data?.error?.message ?? 'That did not work. Try again.');
      return;
    }
    setPicking(null);
    router.refresh();
  }

  if (gifts.length === 0) {
    return <p className="text-sm text-slate-400">No gifts marked yet.</p>;
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-red-500 text-sm">{error}</p>}
      {gifts.map((g) => (
        <div key={g.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 text-sm text-slate-700">
              <div className="font-medium text-slate-900">
                For {g.recipientDisplayName}
                {g.merchant && <> · {g.merchant}</>}
                {g.amount && <> · <span className="font-mono">${g.amount}</span></>}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                {g.windowStart} to {g.windowEnd}{g.accountName && <> · {g.accountName}</>} · reveals {g.revealDate}
              </div>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600 shrink-0">
              {STATE_LABEL[g.state] ?? g.state}
            </span>
          </div>
          {g.noticeAt && (g.state === 'unmatched' || g.state === 'choose') && (
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 mt-3 text-sm text-amber-800">
              {g.state === 'unmatched'
                ? 'Nothing matching this gift arrived in its window. Check the amount and merchant, then mark it again if needed.'
                : 'The window has closed and this gift still needs you to choose which purchase it was.'}
            </div>
          )}
          {g.state === 'choose' && (
            <ul className="mt-3 divide-y divide-slate-100">
              {g.candidates.map((c) => (
                <li key={c.transactionId} className="flex items-center justify-between py-2 text-sm">
                  <span className="truncate">{c.date} · {c.label} · {c.accountName} · <span className="font-mono">${c.amount}</span></span>
                  <button disabled={busy === g.id} onClick={() => post(g.id, 'choose', { transactionId: c.transactionId })}
                    className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-xs disabled:opacity-50">
                    This one
                  </button>
                </li>
              ))}
            </ul>
          )}
          {(g.state === 'awaiting' || g.state === 'choose') && !g.revealed && (
            picking?.giftId === g.id ? (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Recent purchases that fit this gift, whatever their date</span>
                  <button onClick={() => setPicking(null)} className="text-slate-400 hover:text-slate-600">Close</button>
                </div>
                {picking.rows.length === 0 ? (
                  <p className="text-sm text-slate-400 mt-2">Nothing fits this gift right now.</p>
                ) : (
                  <ul className="mt-1 divide-y divide-slate-100">
                    {picking.rows.map((c) => (
                      <li key={c.transactionId} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="truncate">{c.date} · {c.label} · {c.accountName} · <span className="font-mono">${c.amount}</span></span>
                        <button disabled={busy === g.id} onClick={() => attach(g.id, c.transactionId)}
                          className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-xs disabled:opacity-50 shrink-0">
                          This is the gift
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <button disabled={busy === g.id} onClick={() => findPurchase(g.id)}
                className="mt-3 mr-4 text-blue-600 hover:text-blue-700 text-xs disabled:opacity-50">
                Find the purchase
              </button>
            )
          )}
          {g.state !== 'cancelled' && (
            <button disabled={busy === g.id} onClick={() => post(g.id, 'cancel')}
              className="mt-3 text-red-400 hover:text-red-600 text-xs disabled:opacity-50">
              Cancel gift{g.candidates.length > 0 && !g.revealed ? ' and reveal now' : ''}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
