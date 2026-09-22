'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { partialFailureNote, syncHeadline, unmatchedAccountsNote } from '@/lib/domain/syncMessage';

/**
 * What a sync did, said once, in the corner.
 *
 * ─── A deliberate exception to "no toast needed for MVP" ──────────────────────────────────────
 *
 * The design system's interaction table says a successful action calls `router.refresh()` and needs
 * no toast. That held while Sync's only visible effect was on this page — the rows re-render with
 * new balances and the refresh IS the feedback. It stopped holding the moment the owner asked what
 * a sync actually brought in, because the answer lives on a DIFFERENT page: new transactions land
 * in /transactions, and this page never shows one. A refresh cannot report a result that is not on
 * the screen being refreshed.
 *
 * So: added at the owner's request on 2026-09-22, and scoped to that reason. It is not a general
 * toast system, nothing else calls it, and the design doc's rule stands everywhere else.
 *
 * ─── Errors do not auto-dismiss ───────────────────────────────────────────────────────────────
 *
 * A success has a link in it and the reader may be reaching for it, so ten seconds is already the
 * shorter end of comfortable. A FAILURE is something to act on and often to read twice — a message
 * that removes itself is a message that gets missed, and "I clicked Sync and nothing happened" is
 * exactly the report this component exists to make impossible. It stays until dismissed.
 */
export interface SyncOutcome {
  kind: 'success' | 'error';
  /** New transactions written by this run. Only meaningful on success. */
  added: number;
  /** Plaid accounts that returned transactions we have no local account for. */
  unmatched: number;
  /**
   * Feeds that failed while others succeeded. Non-zero here means the headline count is SHORT —
   * the API only refuses outright when every feed failed, so a partly-broken run arrives as a 200.
   */
  failedFeeds: number;
  /** On error, the message the API returned — already sanitised server-side. */
  message?: string;
}

const AUTO_DISMISS_MS = 10_000;

export default function SyncToast({ outcome, onDismiss }: {
  outcome: SyncOutcome;
  onDismiss: () => void;
}) {
  const isError = outcome.kind === 'error';
  const unmatchedNote = unmatchedAccountsNote(outcome.unmatched);
  const partialNote = partialFailureNote(outcome.failedFeeds);

  useEffect(() => {
    if (isError) return;
    const t = setTimeout(onDismiss, AUTO_DISMISS_MS);
    // Cleared on unmount AND whenever the outcome changes, so a second sync during the first
    // toast's life restarts the clock rather than inheriting the remains of it.
    return () => clearTimeout(t);
  }, [isError, onDismiss, outcome]);

  return (
    <div
      // `alert` is assertive and interrupts, which is right for a failure and wrong for "3 new
      // transactions" — a polite status waits for a pause in what the reader is already doing.
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className={`fixed bottom-6 right-6 z-50 flex items-start gap-3 max-w-sm rounded-xl border px-4 py-3 shadow-lg ${
        isError ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'
      }`}
    >
      {isError
        ? <AlertTriangle size={17} className="shrink-0 mt-0.5 text-red-500" />
        : <CheckCircle2 size={17} className="shrink-0 mt-0.5 text-green-600" />}

      <div className="flex-1 text-sm">
        {isError ? (
          <>
            <p className="font-medium text-red-800">Sync failed</p>
            <p className="text-red-700 mt-0.5">{outcome.message ?? 'Something went wrong.'}</p>
          </>
        ) : (
          <>
            <p className="font-medium text-slate-900">{syncHeadline(outcome.added)}</p>
            {/* Only when there ARE new rows. A link offered after "no new transactions" sends the
                reader to a page to look at nothing, which teaches them to stop reading the toast. */}
            {outcome.added > 0 && (
              <Link
                href="/transactions"
                onClick={onDismiss}
                className="inline-block mt-1 text-blue-600 hover:underline"
              >
                See them →
              </Link>
            )}
            {/* Surfaced because it is the one sync outcome that looks like nothing happening and
                is not: Plaid returned rows for an account this database does not have, so that
                money landed nowhere and no count above includes it. */}
            {/* Above the unmatched note and above the link's line of sight, because it qualifies
                the headline itself: everything else here adds to the result, this one subtracts
                confidence from it. */}
            {partialNote && <p className="text-amber-700 mt-1.5 text-xs">{partialNote}</p>}
            {unmatchedNote && <p className="text-amber-700 mt-1.5 text-xs">{unmatchedNote}</p>}
          </>
        )}
      </div>

      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className={`shrink-0 -mr-1 -mt-0.5 p-1 rounded hover:bg-black/5 transition-colors ${
          isError ? 'text-red-400' : 'text-slate-400'
        }`}
      >
        <X size={14} />
      </button>
    </div>
  );
}
