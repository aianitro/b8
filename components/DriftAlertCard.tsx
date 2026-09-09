'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import type { DriftFinding } from '@/lib/domain/drift';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

const fmtSigned = (n: number) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));

// Amber, not red: drift is "these two numbers disagree and one needs looking at", not
// "something is broken". Red is reserved for over-budget in this app's vocabulary.
//
// Shaped as a one-line strip rather than a card. An account that already has a starting balance
// can only be fixed by finding the transaction, which is not a one-click job, so this thing can
// legitimately sit on the dashboard for weeks with nothing to press. A full-width amber box in
// that state costs a fifth of the first screen every day to say something the reader already
// knows. One line keeps the finding in view and gives the space back to the figures the page
// exists to show; the detail is one click away.
export default function DriftAlertCard({ findings }: { findings: DriftFinding[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Silence when everything reconciles — a strip that says "all good" daily is noise competing
  // with the numbers the page exists to show.
  if (findings.length === 0) return null;

  const derivable = findings.filter((f) => f.safeToDerive);
  const needsInvestigation = findings.filter((f) => !f.safeToDerive);

  // The headline used to read "N accounts do not match the bank": true, alarming, and silent on
  // what the reader is supposed to do about it. The two groups have different remedies — one is
  // a starting figure this strip can fill in, the other is a transaction the reader has to go
  // and find — so the headline states the remedy, and names the account when there is only one.
  const subject = (group: DriftFinding[]) =>
    group.length === 1 ? group[0].name : `${group.length} accounts`;

  const headline =
    needsInvestigation.length === 0
      ? `Set the starting balance on ${subject(derivable)}`
      : derivable.length === 0
        ? `Check the transactions on ${subject(needsInvestigation)}`
        : `${findings.length} accounts need attention`;

  // Absolute values, not the signed sum: two accounts $50 apart in opposite directions are $100
  // of unexplained ledger, not a clean $0.
  const totalOff = findings.reduce((sum, f) => sum + Math.abs(f.drift), 0);

  const lone = findings.length === 1 ? findings[0] : null;

  const summary =
    needsInvestigation.length === 0
      ? `No starting balance was recorded for ${new Date().getFullYear()}, so the running total starts from $0. Setting it from the bank leaves every transaction untouched.`
      : derivable.length === 0
        ? lone
          ? `Transactions recorded here come to ${fmt(lone.ledgerBalance)}; the bank reports ${fmt(lone.expectedBalance)}. One transaction is probably missing or duplicated.`
          : 'Transactions recorded here do not add up to the balance the bank reports. A transaction is probably missing or duplicated in each.'
        : `${derivable.length} can be fixed here in one click. ${needsInvestigation.length} need a transaction checked.`;

  async function reconcile(accountIds: string[]) {
    setBusy(true); setError(null);
    const res = await fetch('/api/accounts/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountIds }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? 'Could not set the starting balance');
      return;
    }
    startTransition(async () => { await router.refresh(); });
  }

  return (
    <div className="border border-amber-200 bg-amber-50/70 rounded-xl mb-4">
      {/* Two SIBLING interactive elements, not one nested in the other — a <button> cannot
          legally contain other interactive content, and nesting the fix inside the disclosure
          toggle would also mean one click landing on two different actions is only one DOM edit
          away, which is not a mistake worth risking in a money app. */}
      <div className="flex items-center gap-2.5 px-3 py-2">
        <AlertTriangle size={14} className="text-amber-600 shrink-0" />
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="truncate text-xs font-medium text-amber-900">{headline}</span>
          {/* The size of the gap is the one number that decides whether this is worth opening
              today, so it survives the collapse. */}
          <span className="shrink-0 font-mono text-[11px] text-amber-700/70">
            {fmt(totalOff)} off
          </span>
          <ChevronDown
            size={13}
            className={`shrink-0 text-amber-700/50 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
        {derivable.length > 0 && (
          <button
            onClick={() => reconcile(derivable.map((f) => f.accountId))}
            disabled={busy}
            className="shrink-0 px-2.5 py-1 bg-amber-900 hover:bg-amber-800 text-white rounded-lg text-[11px] font-medium disabled:opacity-40 transition-colors"
          >
            {busy
              ? 'Setting…'
              : derivable.length === 1
                ? 'Set starting balance'
                : `Set ${derivable.length} starting balances`}
          </button>
        )}
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-amber-200/70 mt-0.5">
          <p className="text-[11px] text-amber-700/80 mt-2">{summary}</p>

          <div className="flex items-center justify-end gap-3 mt-3 text-[10px] font-medium uppercase tracking-wide text-amber-700/50">
            <span className="w-20 text-right">Recorded here</span>
            <span className="w-20 text-right">Bank</span>
            <span className="w-24 text-right">Difference</span>
          </div>

          <ul className="space-y-1.5 mt-1.5">
            {findings.map((f) => (
              <li key={f.accountId} className="flex items-center justify-between gap-4 text-xs">
                <span className="flex items-center gap-2 min-w-0">
                  <Link href={`/accounts/${f.accountId}`} className="font-medium text-amber-900 hover:underline truncate">
                    {f.name}
                  </Link>
                  <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-200/70 text-amber-900 font-medium">
                    {f.safeToDerive ? 'no starting balance' : 'check transactions'}
                  </span>
                </span>
                <span className="flex items-center gap-3 shrink-0 font-mono">
                  <span className="w-20 text-right text-amber-700/70">{fmt(f.ledgerBalance)}</span>
                  <span className="w-20 text-right text-amber-700/70">{fmt(f.expectedBalance)}</span>
                  <span className="w-24 text-right font-semibold text-amber-900">{fmtSigned(f.drift)}</span>
                </span>
              </li>
            ))}
          </ul>

          {/* An account that already had a starting balance and still disagrees is a different
              problem: the gap is evidence of a missing or duplicated transaction, and moving the
              starting figure would bury it. Deliberately not offered a one-click fix. */}
          {needsInvestigation.length > 0 && (
            <p className="text-[11px] text-amber-800 mt-3 pt-3 border-t border-amber-200">
              {needsInvestigation.length === 1
                ? `${needsInvestigation[0].name} already has a starting balance`
                : `${needsInvestigation.length} of these already have a starting balance`}
              , so the gap points to a missing or duplicated transaction. Changing the starting
              figure would hide that rather than fix it.{' '}
              {needsInvestigation.length === 1
                ? `Open it and look for a transaction of about ${fmt(Math.abs(needsInvestigation[0].drift))}.`
                : 'Open each one and compare its transactions against the bank statement.'}
            </p>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-700 px-3 pb-2">{error}</p>}
    </div>
  );
}
