'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera } from 'lucide-react';
import { captureReceipt } from '@/lib/receiptCaptureClient';
import type { NewCapture } from '@/lib/receiptCaptureStore';
import { localIsoDate } from '@/lib/localDate';
import ReceiptConfirmForm from './ReceiptConfirmForm';

/**
 * Photograph a receipt at the table. One file input with `accept="image/*"`, which on a phone offers
 * the camera first; the photo is shrunk on the phone, read by the model on the server, and comes
 * back as a draft whose amount the owner confirms before anything is watched.
 */
export default function ReceiptSnap() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<NewCapture | null>(null);

  async function take(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      // The meal's day on THIS device's calendar, which is the one the owner lives by.
      setDraft(await captureReceipt(file, localIsoDate()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the receipt. Try again.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  if (draft) {
    return (
      <ReceiptConfirmForm
        capture={draft.capture}
        reading={draft.reading}
        proposed={draft.proposed}
        onDone={() => { setDraft(null); router.refresh(); }}
      />
    );
  }

  return (
    <div>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => take(e.target.files?.[0])} />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="w-full flex items-center justify-center gap-2 px-4 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
      >
        <Camera size={18} /> {busy ? 'Reading the receipt…' : 'Photograph a receipt'}
      </button>
      {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
    </div>
  );
}
