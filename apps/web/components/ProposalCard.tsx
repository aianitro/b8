'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, AlertTriangle } from 'lucide-react';

export interface Proposal {
  id: string;
  subjectId: number;
  proposed: { category: string | null };
  observed: { category: string | null };
  rationale: string | null;
  expiresAt: string;
  subject: { date: string; amount: number; merchant: string | null } | null;
}

const money = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/**
 * The confirmation gate, as the owner sees it.
 *
 * It shows the FROM and the TO, not just the TO. A card that says only "categorize as Groceries?"
 * asks for agreement to a change whose effect the reader cannot see, and a gate people cannot read
 * is a button they learn to click. The whole security argument in docs/agent-authorization.md §4
 * rests on this card being legible.
 */
export default function ProposalCard({ proposal }: { proposal: Proposal }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'confirmed' | 'rejected'>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'confirmed' | 'rejected') {
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch(`/api/v1/agent/proposals/${proposal.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (data.success) {
        setDone(data.data.message);
        // The change landed in a table other screens read; re-fetch rather than guess.
        if (data.data.applied) router.refresh();
      } else {
        setError(data.error?.message ?? 'Could not apply that change.');
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  const label = (c: string | null) => c ?? 'uncategorized';

  if (done) {
    return (
      <div className="border border-gray-200 rounded-lg p-4 text-sm text-gray-500 flex items-center gap-2">
        <Check size={14} className="text-green-600 shrink-0" />
        <span>{done}</span>
      </div>
    );
  }

  return (
    <div className="border border-amber-200 bg-amber-50 rounded-lg p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-3 flex items-center gap-1.5">
        <AlertTriangle size={12} className="shrink-0" />
        Suggested change — nothing has been changed yet
      </p>

      {proposal.subject && (
        <p className="text-sm text-gray-900 mb-1">
          <span className="font-medium">{proposal.subject.merchant ?? 'Transaction'}</span>
          <span className="text-gray-400"> · {proposal.subject.date} · </span>
          <span className="font-mono">{money.format(proposal.subject.amount)}</span>
        </p>
      )}

      <p className="text-sm text-gray-700 mb-2">
        <span className="line-through text-gray-400">{label(proposal.observed.category)}</span>
        <span className="text-gray-400 mx-2">→</span>
        <span className="font-medium text-gray-900">{label(proposal.proposed.category)}</span>
      </p>

      {proposal.rationale && (
        <p className="text-xs text-gray-500 mb-3 leading-relaxed">{proposal.rationale}</p>
      )}

      {error && <p className="text-red-500 text-sm mb-2">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={() => decide('confirmed')}
          disabled={busy !== null}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50 flex items-center gap-1.5"
        >
          <Check size={14} />
          {busy === 'confirmed' ? 'Applying…' : 'Confirm'}
        </button>
        <button
          onClick={() => decide('rejected')}
          disabled={busy !== null}
          className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 text-sm disabled:opacity-50 flex items-center gap-1.5"
        >
          <X size={14} />
          {busy === 'rejected' ? 'Dismissing…' : 'Dismiss'}
        </button>
      </div>
    </div>
  );
}
