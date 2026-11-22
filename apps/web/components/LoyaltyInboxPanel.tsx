'use client';

// Loyalty inbox (P8-42c1) — the /travel panel for forwarded loyalty mail: whether polling is set
// up, the last check, mail from senders nobody allowlisted, mail not matched to a person, each
// person's forwarding health and each program's coverage, with the two list editors.
//
// EVERYTHING ARRIVES AS SERVER PROPS (`overview.inbox`), computed in Postgres: counts, day
// differences and `YYYY-MM-DD` text. Nothing here reads the environment, the database or a byte of
// mail; the configuration reaches the page only as the password-free `configured`, `problem` and
// the NAMES in `missing`. A domain shown here is React-escaped text, and the contract's validator
// guarantees it holds no markup.
//
// NULL IS A PHRASE, NEVER A ZERO OR A DATE: no last check is "Not checked yet", a program with no
// mail is "No mail seen yet", a person with no address is "no forwarding address set". A count of
// zero is the number zero.
//
// "Check inbox now" exists only when polling is configured: with the environment unset the panel
// says what to set instead, and there is nothing to press. Its handler is the page's one poll sender.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LoyaltyInboxConfigProblem, LoyaltyOverview } from '@b8/contracts/loyalty';
import LoyaltyInboxForwarding from './LoyaltyInboxForwarding';
import LoyaltyInboxCoverage from './LoyaltyInboxCoverage';
import { send } from './LoyaltyRequest';

/** What to fix, by problem. Names of variables only; a value is never shown. */
const FIX: Record<Exclude<LoyaltyInboxConfigProblem, 'unset' | 'incomplete'>, string> = {
  invalid_tls: 'LOYALTY_IMAP_TLS must be exactly true or starttls; a plaintext login is never used.',
  invalid_port: 'LOYALTY_IMAP_PORT must be a whole number from 1 to 65535.',
  invalid_timeout: 'LOYALTY_IMAP_TIMEOUT_SECONDS must be a whole number from 1 to 600.',
};

export default function LoyaltyInboxPanel({ overview }: { overview: LoyaltyOverview }) {
  const router = useRouter();
  const inbox = overview.inbox;
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkNow() {
    setChecking(true);
    const result = await send('POST', '/api/v1/loyalty/inbox/poll', {});
    setChecking(false);
    if (!result.ok) { setError(result.message); return; }
    setError(null);
    router.refresh();
  }

  const c = inbox.lastCheck;
  const missing = inbox.missing.join(', ');
  return (
    <section className="mb-8 border border-gray-200 rounded-xl p-4 sm:p-6 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-900">Loyalty inbox</h2>
          {/* The contract fixes retentionDays as the literal 30, so this sentence cannot disagree with the purge. */}
          <p className="text-xs text-gray-400 mt-1">Raw mail is kept 30 days, then deleted.</p>
        </div>
        {inbox.configured ? (
          <button type="button" onClick={checkNow} disabled={checking} className="min-h-8 px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50">
            {checking ? 'Checking…' : 'Check inbox now'}
          </button>
        ) : null}
      </div>
      {!inbox.configured && (
        <div className="mt-3 border border-amber-200 bg-amber-50 rounded-lg p-3 text-sm text-gray-700">
          <p className="font-medium">Inbox polling is not set up</p>
          <p className="mt-1">
            {inbox.problem === 'unset' || inbox.problem === 'incomplete'
              ? `Set ${missing} on the server, then have each person add a forwarding filter that sends their loyalty mail to the dedicated mailbox.`
              : `${inbox.problem === null ? '' : FIX[inbox.problem]} Then have each person add a forwarding filter that sends their loyalty mail to the dedicated mailbox.`}
          </p>
        </div>
      )}
      <p className="mt-3 text-sm text-gray-600">
        {c === null ? 'Not checked yet' : `Last check: ${c.on} · ${c.outcome === 'ok' ? 'ok' : `failed (${c.errorCode})`}`}
      </p>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <div className="mt-2 text-sm text-gray-600">
        {inbox.unknownSenderTotal === 0 ? (
          <p>No mail from unknown senders</p>
        ) : (
          <>
            <p>{`Mail from unknown senders: ${inbox.unknownSenderTotal}`}</p>
            <ul className="mt-1 text-xs text-gray-500">
              {inbox.unknownSenders.map((u) => <li key={u.domain} className="break-all">{`${u.domain} × ${u.count}`}</li>)}
            </ul>
          </>
        )}
        {inbox.unattributed > 0 && <p className="mt-1 text-amber-600">{`Not matched to a person: ${inbox.unattributed}`}</p>}
      </div>
      <LoyaltyInboxForwarding inbox={inbox} members={overview.members} />
      <LoyaltyInboxCoverage inbox={inbox} programs={overview.programs} />
    </section>
  );
}
