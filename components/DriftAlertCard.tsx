'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import type { DriftFinding } from '@/lib/domain/drift';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

const fmtSigned = (n: number) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));

// Amber, not red: drift is "these two numbers disagree and one needs looking at", not
// "something is broken". Red is reserved for over-budget in this app's vocabulary.
export default function DriftAlertCard({ findings }: { findings: DriftFinding[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Silence when everything reconciles — a card that says "all good" daily is noise competing
  // with the numbers the page exists to show.
  if (findings.length === 0) return null;

  const derivable = findings.filter((f) => f.safeToDerive);
  const needsInvestigation = findings.filter((f) => !f.safeToDerive);

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
      setError(body?.error?.message ?? 'Could not reconcile');
      return;
    }
    startTransition(async () => { await router.refresh(); });
  }

  return (
    <div className="border border-amber-200 bg-amber-50 rounded-2xl p-5 mb-6">
      <div className="flex items-start gap-3">
        <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-amber-900">
                {findings.length} account{findings.length === 1 ? '' : 's'} {findings.length === 1 ? 'does not' : 'do not'} match the bank
              </p>
              <p className="text-xs text-amber-700/80 mt-0.5">
                The balance computed from recorded transactions differs from what the bank reports.
              </p>
            </div>
            {derivable.length > 0 && (
              <button
                onClick={() => reconcile(derivable.map((f) => f.accountId))}
                disabled={busy}
                className="shrink-0 px-3 py-1.5 bg-amber-900 hover:bg-amber-800 text-white rounded-lg text-xs font-medium disabled:opacity-40 transition-colors"
              >
                {busy ? 'Reconciling…' : `Reconcile ${derivable.length}`}
              </button>
            )}
          </div>

          {derivable.length > 0 && (
            <p className="text-[11px] text-amber-700/70 mt-2">
              These accounts have no opening balance recorded for this year, so the ledger starts
              from $0. Reconciling sets each opening balance to the figure that makes it agree
              with the bank — no transaction is changed.
            </p>
          )}

          <ul className="space-y-1.5 mt-3">
            {findings.map((f) => (
              <li key={f.accountId} className="flex items-center justify-between gap-4 text-xs">
                <span className="flex items-center gap-2 min-w-0">
                  <Link href={`/accounts/${f.accountId}`} className="font-medium text-amber-900 hover:underline truncate">
                    {f.name}
                  </Link>
                  {!f.safeToDerive && (
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-200/70 text-amber-900 font-medium">
                      check transactions
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-3 shrink-0 font-mono">
                  <span className="text-amber-700/70" title="Computed from recorded transactions">{fmt(f.ledgerBalance)}</span>
                  <span className="text-amber-700/50">vs</span>
                  <span className="text-amber-700/70" title="Reported by the bank">{fmt(f.expectedBalance)}</span>
                  <span className="font-semibold text-amber-900 w-24 text-right" title="Difference">{fmtSigned(f.drift)}</span>
                </span>
              </li>
            ))}
          </ul>

          {/* An account that already had an opening balance and still disagrees is a different
              problem: the gap is evidence of a missing or duplicated transaction, and moving
              the opening figure would bury it. Deliberately not offered a one-click fix. */}
          {needsInvestigation.length > 0 && (
            <p className="text-[11px] text-amber-800 mt-3 pt-3 border-t border-amber-200">
              {needsInvestigation.length} account{needsInvestigation.length === 1 ? '' : 's'} already had an opening
              balance, so the gap points to a missing or duplicated transaction. Adjusting the opening
              figure would hide that rather than fix it — open the account and check its transactions.
            </p>
          )}

          {error && <p className="text-xs text-red-700 mt-2">{error}</p>}
        </div>
      </div>
    </div>
  );
}
