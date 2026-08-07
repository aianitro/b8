import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import type { DriftFinding } from '@/lib/domain/drift';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

const fmtSigned = (n: number) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));

// Amber, not red: drift is "these two numbers disagree and one of them needs looking at", not
// "something is broken". Red is reserved for over-budget in this app's vocabulary.
export default function DriftAlertCard({ findings }: { findings: DriftFinding[] }) {
  // Silence when everything reconciles — a card that renders "all good" every day is noise
  // competing with the numbers the page exists to show.
  if (findings.length === 0) return null;

  return (
    <div className="border border-amber-200 bg-amber-50 rounded-2xl p-5 mb-6">
      <div className="flex items-start gap-3">
        <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">
            {findings.length} account{findings.length === 1 ? '' : 's'} {findings.length === 1 ? "doesn't" : "don't"} match the bank
          </p>
          <p className="text-xs text-amber-700/80 mt-0.5 mb-3">
            The balance computed from recorded transactions differs from what the bank reports —
            usually a missed, duplicated, or mis-signed transaction.
          </p>

          <ul className="space-y-1.5">
            {findings.map((f) => (
              <li key={f.accountId} className="flex items-center justify-between gap-4 text-xs">
                <Link
                  href={`/accounts/${f.accountId}`}
                  className="font-medium text-amber-900 hover:underline truncate"
                >
                  {f.name}
                </Link>
                <span className="flex items-center gap-3 shrink-0 font-mono">
                  <span className="text-amber-700/70" title="Computed from recorded transactions">
                    {fmt(f.ledgerBalance)}
                  </span>
                  <span className="text-amber-700/50">vs</span>
                  <span className="text-amber-700/70" title="Reported by the bank via Plaid">
                    {fmt(f.expectedBalance)}
                  </span>
                  <span className="font-semibold text-amber-900 w-24 text-right" title="Difference">
                    {fmtSigned(f.drift)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
