'use client';

import { useEffect, useState } from 'react';
import type { CandidateView } from '@/lib/receiptCaptureStore';
import { actOnCapture, captureCandidates, money, shortDate } from '@/lib/receiptCaptureClient';

/**
 * Pick a receipt's charge by hand, from the charges near its day. For when the watch found nothing
 * — the bank's merchant text shares no word with the receipt and the amount was not exact.
 */
export default function ReceiptPicker({ captureId, expected, onDone }: { captureId: number; expected: number | null; onDone: () => void }) {
  const [rows, setRows] = useState<CandidateView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    captureCandidates(captureId)
      .then((r) => { if (live) setRows(r); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load charges.'); });
    return () => { live = false; };
  }, [captureId]);

  async function pick(id: number) {
    setBusy(true);
    setError(null);
    try {
      await actOnCapture(captureId, { action: 'link', transactionId: id });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Try again.');
      setBusy(false);
    }
  }

  if (error) return <p className="text-red-500 text-sm mt-2">{error}</p>;
  if (rows === null) return <p className="text-xs text-gray-400 mt-2">Loading charges…</p>;
  if (rows.length === 0) return <p className="text-xs text-gray-400 mt-2">No charges near that day.</p>;
  return (
    <ul className="mt-2 border rounded-lg divide-y max-h-72 overflow-y-auto">
      {rows.map((r) => (
        <li key={r.id}>
          <button type="button" disabled={busy} onClick={() => pick(r.id)}
                  className="w-full flex items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50">
            <span className="min-w-0">
              <span className="block truncate text-slate-800">{r.title}</span>
              <span className="block text-xs text-gray-400">{shortDate(r.date)} · {r.account}</span>
            </span>
            <span className={`shrink-0 font-mono ${expected !== null && Math.round(r.amount * 100) === Math.round(expected * 100) ? 'text-green-600' : 'text-slate-700'}`}>
              {money(r.amount)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
