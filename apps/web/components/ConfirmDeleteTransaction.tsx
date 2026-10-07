'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';

/**
 * The one "Delete transaction?" dialog, shared by the Transactions table and the account page.
 *
 * Lifted out of TransactionTable when the account page gained swipe-to-delete: two copies of a
 * destructive confirmation drift apart, and the one that drifts is the one that stops asking.
 */
export default function ConfirmDeleteTransaction({ transactionId, description, onClose, onDeleted }: {
  transactionId: number;
  /** What is being deleted, e.g. "Atlas Fitness · Sep 23". Omitted where the row is in view. */
  description?: string;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function doDelete() {
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/v1/transactions/${transactionId}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (!res?.ok) { setError(true); return; }
    onDeleted?.();
    router.refresh();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={busy ? undefined : onClose}
    >
      <div
        role="alertdialog"
        aria-labelledby={`delete-title-${transactionId}`}
        className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 w-80 mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-red-50 mb-4">
          <Trash2 size={18} className="text-red-500" />
        </div>
        <h3 id={`delete-title-${transactionId}`} className="text-sm font-semibold text-slate-900 mb-1">Delete transaction?</h3>
        {description && <p className="text-sm text-slate-600 mb-1 truncate">{description}</p>}
        <p className="text-xs text-slate-400 mb-5">This action cannot be undone.</p>
        {error && <p className="text-xs text-red-500 -mt-3 mb-4">Could not delete it. Try again.</p>}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={doDelete}
            disabled={busy}
            className="flex-1 px-4 py-2 rounded-xl text-sm font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
