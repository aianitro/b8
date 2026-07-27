'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  transactionId: number;
  groupId: number | null;
  peerLabel: string | null;
  required?: boolean;
  isTransfer?: boolean;
}

export default function TransferLinkButton({ transactionId, groupId, peerLabel, required, isTransfer }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function doUnlink() {
    setBusy(true);
    await fetch('/api/transfers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: transactionId }),
    });
    router.refresh();
    setBusy(false);
  }

  // Already grouped — show peer info (clickable, filters to just this transfer) + unlink (clears the whole group)
  if (groupId !== null) {
    return (
      <div className="flex items-center gap-1.5">
        <a
          href={`/transactions?transferGroup=${groupId}`}
          className="text-xs text-violet-600 bg-violet-50 hover:bg-violet-100 px-2 py-0.5 rounded-full font-medium border border-violet-100 transition-colors"
          title="Show only this transfer's transactions"
        >
          ⇄ {peerLabel}
        </a>
        <button onClick={doUnlink} disabled={busy} className="text-slate-300 hover:text-red-400 disabled:opacity-50 transition-colors">
          ✕
        </button>
      </div>
    );
  }

  // Not a transfer — nothing to show
  if (!isTransfer && !required) return null;

  // Transfer without a group yet — select this row plus its counterpart(s)
  // (anywhere in the table) and use "Pair as Transfer" once they sum to 0.
  return (
    <span
      className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full"
      title="Select this row plus the matching transaction(s) and use Pair as Transfer"
    >
      Pair required
    </span>
  );
}
