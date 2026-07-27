'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';

interface Props { accountId: string; accountName: string }

export default function AccountDeleteButton({ accountId, accountName }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() { setError(null); setConfirming(true); }

  async function doDelete() {
    setBusy(true);
    const res = await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
    const data = await res.json();
    setBusy(false);
    if (!data.success) {
      setError(data.error?.message ?? 'Failed to remove account');
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={open}
        className="text-slate-300 hover:text-red-400 transition-colors"
        title="Remove account"
      >
        <Trash2 size={14} />
      </button>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => !busy && setConfirming(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 w-80 mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-red-50 mb-4">
              <Trash2 size={18} className="text-red-500" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900 mb-1">Remove {accountName}?</h3>
            <p className="text-xs text-slate-400 mb-5">This action cannot be undone.</p>
            {error && <p className="text-xs text-red-500 mb-4">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(false)}
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
                {busy ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
