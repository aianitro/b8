'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Zap } from 'lucide-react';

// Sync (fast, incremental) and Force Refresh (asks the bank directly, ~10s) are two strengths
// of the same action, not two separate features — joined into one split button so the common
// case (Sync) stays a single click while the rare case stays one click away, not equal-weight.
export default function SyncControls() {
  const router = useRouter();
  const [busy, setBusy] = useState<'sync' | 'force' | null>(null);

  async function run(force: boolean) {
    setBusy(force ? 'force' : 'sync');
    try {
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null;

  return (
    <div className="flex rounded-lg overflow-hidden shadow-sm">
      <button
        onClick={() => run(false)}
        disabled={disabled}
        title="Sync now"
        className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium disabled:opacity-60 transition-colors"
      >
        <RefreshCw size={14} className={busy === 'sync' ? 'animate-spin' : ''} />
        Sync
      </button>
      <button
        onClick={() => run(true)}
        disabled={disabled}
        title="Force refresh — ask the bank directly (~10s)"
        className="flex items-center px-2.5 py-2 bg-violet-600 hover:bg-violet-700 text-white border-l border-violet-500/60 disabled:opacity-60 transition-colors"
      >
        <Zap size={14} className={busy === 'force' ? 'animate-pulse' : ''} />
      </button>
    </div>
  );
}
