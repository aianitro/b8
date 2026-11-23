'use client';

// Loyalty inbox, reading (P8-42c2) — the reading half of the /travel inbox panel: whether reading is
// set up, how much stored mail waits or could not be read, the last read, and the one-tap queue of
// readings the rules would not apply on their own ("Needs attention").
//
// EVERYTHING ARRIVES AS SERVER PROPS (`overview.inboxRead`), computed in Postgres: counts, dates as
// `YYYY-MM-DD` text, balances as decimal text and suffixes already masked. Nothing here reads the
// environment; whether a key is set reaches the page only as the boolean `readable`, and the key's
// NAME is printed as the thing to set.
//
// NULL IS A PHRASE, NEVER A ZERO OR A DATE: never read is "Not read yet", an item with no date says
// "no date", one with no suffix "no number shown". A count of zero is the number zero.
//
// The queue is NOT an alert: it lives on this page only, with no push, digest line or dashboard card.
// The two read controls exist only when reading is set up; each has one handler.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LoyaltyMembership, LoyaltyOverview } from '@b8/contracts/loyalty';
import LoyaltyReadQueueItem from './LoyaltyReadQueueItem';
import { send } from './LoyaltyRequest';

/** The read route. `LoyaltyInboxPanel`'s "Check inbox now" sends it too, right after its poll. */
export const READ_PATH = '/api/v1/loyalty/inbox/read';

export default function LoyaltyInboxReadPanel({ overview }: { overview: LoyaltyOverview }) {
  const router = useRouter();
  const read = overview.inboxRead;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** "Read stored mail now": one read run, nothing else. */
  async function readNow() {
    setBusy(true);
    const result = await send('POST', READ_PATH, {});
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    setError(null);
    router.refresh();
  }

  /** "Try failed mail again": failed mail that still has its bytes goes back to unread, then is read. */
  async function retryFailed() {
    setBusy(true);
    const result = await send('POST', READ_PATH, { retryFailed: true });
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    setError(null);
    router.refresh();
  }

  const programName = new Map(overview.programs.map((p) => [p.id, p.name]));
  const membershipsOf = new Map<number, LoyaltyMembership[]>(overview.cards.map((c) => [c.programId, c.memberships]));
  const last = read.lastRead;
  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <h3 className="text-sm font-semibold text-gray-900">Reading stored mail</h3>
      {!read.readable && (
        <div className="mt-2 border border-amber-200 bg-amber-50 rounded-lg p-3 text-sm text-gray-700">
          <p className="font-medium">Reading mail is not set up</p>
          <p className="mt-1">Set ANTHROPIC_API_KEY on the server; stored mail waits, unread, until then.</p>
        </div>
      )}
      <p className="mt-2 text-sm text-gray-600">
        {last === null ? 'Not read yet' : last.outcome === 'ok' ? `Last read: ${last.on} · ok` : `Last read: ${last.on} · failed (${last.errorCode})`}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-600">
        {read.readable && read.waiting > 0 ? (
          <>
            <span>{`Waiting to be read: ${read.waiting}`}</span>
            <button type="button" onClick={readNow} disabled={busy} className="min-h-8 px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50">
              {busy ? 'Reading…' : 'Read stored mail now'}
            </button>
          </>
        ) : null}
        {read.failed > 0 && <span className="text-amber-600">{`Could not be read: ${read.failed}`}</span>}
        {read.readable && read.failed > 0 ? (
          <button type="button" onClick={retryFailed} disabled={busy} className="min-h-8 px-3 py-1.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 text-sm disabled:opacity-50">
            Try failed mail again
          </button>
        ) : null}
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}

      <h3 className="mt-4 text-sm font-semibold text-gray-900">Needs attention</h3>
      {read.needsAttentionTotal === 0 ? (
        <p className="mt-1 text-sm text-gray-400">Nothing needs attention</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-gray-600">{`Needs attention: ${read.needsAttentionTotal}`}</p>
          <ul className="mt-1 divide-y divide-gray-100">
            {read.needsAttention.map((item) => (
              <LoyaltyReadQueueItem
                key={item.id}
                item={item}
                programName={programName.get(item.programId) ?? ''}
                memberships={membershipsOf.get(item.programId) ?? []}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
