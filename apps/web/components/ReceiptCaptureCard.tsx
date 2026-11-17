'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CaptureView } from '@/lib/receiptCaptureStore';
import { actOnCapture, captureImageUrl, discardCapture, money, shortDate, type CaptureAction } from '@/lib/receiptCaptureClient';
import { TransactionDetailButton } from './TransactionDetailSheet';
import ReceiptConfirmForm from './ReceiptConfirmForm';
import ReceiptPicker from './ReceiptPicker';

const SHELL: Record<CaptureView['state'], string> = {
  draft: 'border-gray-200',
  waiting: 'border-gray-200',
  matched: 'border-gray-200',
  closed: 'border-gray-200 opacity-70',
  mismatch: 'border-amber-200 bg-amber-50',
  overdue: 'border-amber-200 bg-amber-50',
};

/** One photographed receipt, saying where it stands and offering what can be done about it. */
export default function ReceiptCaptureCard({ capture: c }: { capture: CaptureView }) {
  const router = useRouter();
  const [editing, setEditing] = useState(c.state === 'draft');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = () => { setEditing(false); setPicking(false); setBusy(false); router.refresh(); };

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try { await work(); done(); } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Try again.');
      setBusy(false);
    }
  }
  const act = (body: CaptureAction) => run(() => actOnCapture(c.id, body));

  if (editing) return <ReceiptConfirmForm capture={c} proposed={c.expected ?? c.readTotal} onDone={done} />;

  const diff = c.charged !== null && c.expected !== null ? Math.round((c.charged - c.expected) * 100) / 100 : null;
  const link = 'text-xs text-gray-500 hover:text-gray-800 underline disabled:opacity-50';
  const strong = 'text-xs font-medium px-3 py-1.5 rounded bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-50';

  return (
    <div className={`border rounded-lg p-4 ${SHELL[c.state]}`}>
      <div className="flex gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated API image, not a static asset */}
        <img src={captureImageUrl(c.id)} alt="Receipt" className="shrink-0 w-12 h-16 object-cover rounded border border-gray-200 bg-gray-50" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-medium text-slate-900 truncate">{c.merchant ?? 'Receipt'}</p>
            {c.expected !== null && <p className="font-mono text-slate-700 shrink-0">{money(c.expected)}</p>}
          </div>
          <p className="text-xs text-gray-400">{shortDate(c.capturedOn)} · {status(c, diff)}</p>
          {c.transaction && (
            <TransactionDetailButton transactionId={c.transaction.id} className="mt-1 block">
              <span className="detail-title text-xs text-blue-600">{c.transaction.title} · {shortDate(c.transaction.date)}</span>
            </TransactionDetailButton>
          )}
        </div>
      </div>

      {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
      <div className="flex flex-wrap items-center gap-3 mt-3 empty:hidden">
        {c.state === 'mismatch' && <>
          <button type="button" disabled={busy} onClick={() => act({ action: 'accept' })} className={strong}>That is the charge</button>
          <button type="button" disabled={busy} onClick={() => act({ action: 'reject' })} className={link}>Not this charge</button>
        </>}
        {c.state === 'overdue' && <>
          <button type="button" disabled={busy} onClick={() => setPicking((p) => !p)} className={strong}>Pick the charge</button>
          <button type="button" disabled={busy} onClick={() => act({ action: 'dismiss' })} className={link}>Paid another way</button>
        </>}
        {c.state === 'waiting' && <>
          <button type="button" disabled={busy} onClick={() => setEditing(true)} className={link}>Edit</button>
          <button type="button" disabled={busy} onClick={() => setPicking((p) => !p)} className={link}>Pick the charge</button>
          <button type="button" disabled={busy} onClick={() => act({ action: 'dismiss' })} className={link}>Stop watching</button>
        </>}
        {(c.state === 'matched' || c.state === 'closed') && (
          <button type="button" disabled={busy} onClick={() => run(() => discardCapture(c.id))} className="text-red-400 hover:text-red-600 text-xs disabled:opacity-50">Delete</button>
        )}
      </div>
      {picking && <ReceiptPicker captureId={c.id} expected={c.expected} onDone={done} />}
    </div>
  );
}

function status(c: CaptureView, diff: number | null): string {
  switch (c.state) {
    case 'draft': return 'not confirmed';
    case 'waiting': return 'waiting for the charge';
    case 'matched': return 'charged exactly that';
    case 'mismatch': return `charged ${money(c.charged!)}, ${diff! > 0 ? `${money(diff!)} more` : `${money(-diff!)} less`} than the receipt`;
    case 'overdue': return 'no charge seven days later';
    case 'closed': return c.charged !== null ? `settled at ${money(c.charged)}` : 'no longer watched';
  }
}
