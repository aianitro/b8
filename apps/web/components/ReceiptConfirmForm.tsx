'use client';

import { useState } from 'react';
import type { CaptureView } from '@/lib/receiptCaptureStore';
import type { ReceiptReading } from '@/lib/domain/receiptMatch';
import { actOnCapture, captureImageUrl, discardCapture, money } from '@/lib/receiptCaptureClient';
import { localIsoDate } from '@/lib/localDate';

const TIPS = [18, 20, 22];
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Confirm what to wait for: the charge the owner expects, pre-filled with what the model read.
 *
 * THE AMOUNT IS THE OWNER'S, NOT THE MODEL'S. A printed bill has no tip on it and a signed slip has
 * one in handwriting, so the reading is a starting point the owner corrects before anything is
 * watched. When the photo shows a subtotal but no tip, the usual percentages are one tap away.
 */
export default function ReceiptConfirmForm({ capture, reading, proposed, onDone }: {
  capture: CaptureView;
  /** The breakdown, when the photo was just read. Absent when a draft is reopened later. */
  reading?: ReceiptReading | null;
  proposed: number | null;
  onDone: () => void;
}) {
  const [merchant, setMerchant] = useState(capture.merchant ?? '');
  const [amount, setAmount] = useState(proposed !== null ? proposed.toFixed(2) : '');
  const [day, setDay] = useState(capture.capturedOn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expected = Number(amount);
  const valid = amount.trim() !== '' && Number.isFinite(expected) && expected > 0 && /^\d+(\.\d{1,2})?$/.test(amount.trim());
  // Tip on the pre-tax subtotal, added to the bill as printed (subtotal plus tax).
  const tipBase = reading?.subtotal ?? null;
  const bill = tipBase !== null ? round2(tipBase + (reading?.tax ?? 0)) : null;
  const offerTips = reading != null && reading.tip === null && tipBase !== null && bill !== null;

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Try again.');
      setBusy(false);
    }
  }

  const read = reading
    ? (['subtotal', 'tax', 'tip', 'total'] as const).filter((k) => reading[k] !== null).map((k) => `${k} ${money(reading[k]!)}`)
    : [];
  const input = 'w-full text-base sm:text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-50';

  return (
    <div className="border rounded-xl p-4 sm:p-6 bg-white">
      <div className="flex gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated API image, not a static asset */}
        <img src={captureImageUrl(capture.id)} alt="Receipt" className="w-20 h-28 object-cover rounded-lg border border-gray-200 bg-gray-50 shrink-0" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-slate-900">What should the bank charge?</p>
          <p className="text-xs text-gray-400 mt-1">
            {read.length > 0 ? `Read from the photo: ${read.join(' · ')}` : 'Nothing could be read from the photo. Type the amount you expect.'}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-gray-400">Expected charge, tip included</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy}
                 placeholder="0.00" className={`${input} font-mono`} />
        </label>
        {offerTips && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-400">Add tip:</span>
            {TIPS.map((p) => (
              <button key={p} type="button" disabled={busy}
                      onClick={() => setAmount(round2(bill! + tipBase! * p / 100).toFixed(2))}
                      className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50">
                {p}%
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-gray-400">Merchant</span>
            <input value={merchant} onChange={(e) => setMerchant(e.target.value)} disabled={busy} maxLength={200} className={input} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-400">Day</span>
            <input type="date" value={day} max={localIsoDate()} onChange={(e) => setDay(e.target.value)} disabled={busy} className={input} />
          </label>
        </div>
      </div>

      {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
      <div className="flex items-center gap-3 mt-4">
        <button type="button" disabled={busy || !valid || day === ''}
                onClick={() => run(() => actOnCapture(capture.id, { action: 'confirm', merchant: merchant.trim() || null, expected: round2(expected), capturedOn: day }))}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50">
          {busy ? 'Saving…' : capture.state === 'draft' ? 'Watch for this charge' : 'Save'}
        </button>
        {capture.state === 'draft' && (
          <button type="button" disabled={busy} onClick={() => run(() => discardCapture(capture.id))}
                  className="text-red-400 hover:text-red-600 text-xs disabled:opacity-50">
            Discard
          </button>
        )}
      </div>
    </div>
  );
}
