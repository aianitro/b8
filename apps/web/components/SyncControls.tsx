'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Zap } from 'lucide-react';
import SyncToast, { type SyncOutcome } from './SyncToast';

// Sync (fast, incremental) and Force Refresh (asks the bank directly, ~10s) are two strengths
// of the same action, not two separate features — joined into one split button so the common
// case (Sync) stays a single click while the rare case stays one click away, not equal-weight.
export default function SyncControls() {
  const router = useRouter();
  const [busy, setBusy] = useState<'sync' | 'force' | null>(null);
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);

  const dismiss = useCallback(() => setOutcome(null), []);

  async function run(force: boolean) {
    setBusy(force ? 'force' : 'sync');
    // Cleared before the request, not after it. Leaving the previous toast up during a second
    // sync shows a stale count beside a spinning button, which reads as the new result.
    setOutcome(null);
    try {
      const response = await fetch('/api/v1/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });

      // THE RESPONSE WAS PREVIOUSLY DISCARDED ENTIRELY — awaited, never read, never checked for
      // `ok`. A sync that failed 500 refreshed the page and looked exactly like one that worked,
      // which is the failure mode this component now exists to remove; reporting a count means
      // reading the body, and having read it, the error branch cannot be left unhandled.
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.success) {
        setOutcome({
          kind: 'error',
          added: 0,
          unmatched: 0,
          failedFeeds: 0,
          // The API sanitises its own messages — `Sync failed` for anything unanticipated, since
          // a Plaid axios error carries the live client secret. Whatever arrives here is already
          // safe to show; this does not widen it.
          message: body?.error?.message ?? `Sync failed (${response.status})`,
        });
        return;
      }

      setOutcome({
        kind: 'success',
        added: body.data?.synced ?? 0,
        unmatched: body.data?.unmatchedAccountIds?.length ?? 0,
        // A 200 CAN CARRY FAILURES. The route refuses outright only when every feed failed, so a
        // run where one bank refused and another delivered arrives here as a success with its
        // errors in the payload. Reading `synced` alone would report that as clean — the same bug
        // one level in as the discarded response above.
        failedFeeds: body.data?.errors?.length ?? 0,
      });
      // Still refreshed: balances and last-synced times on this page come from the server render.
      // The toast reports what landed somewhere else; the refresh updates what is on screen.
      router.refresh();
    } catch (err) {
      // A dropped connection or a request that never completed. Distinct from the branch above —
      // there the server answered and said no, here nothing answered at all.
      setOutcome({
        kind: 'error',
        added: 0,
        unmatched: 0,
        failedFeeds: 0,
        message: err instanceof Error ? err.message : 'Could not reach the server.',
      });
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null;

  return (
    <>
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

      {outcome && <SyncToast outcome={outcome} onDismiss={dismiss} />}
    </>
  );
}
