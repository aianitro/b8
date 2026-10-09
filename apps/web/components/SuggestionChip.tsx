'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Sparkles, X } from 'lucide-react';

export interface CategorySuggestionView {
  proposalId: string;
  category: string;
  rationale: string | null;
}

/**
 * A suggested category on an unfiled row: the category, a tick to file it, a cross to dismiss it.
 *
 * Either goes through the proposal confirm endpoint — the one path by which a suggested change is
 * applied, which re-checks that the row is still unfiled and the category still real. Ignoring the
 * chip changes nothing. The rationale ("You filed 3 of 3…", "Suggested by AI: …") is its title.
 */
export default function SuggestionChip({ suggestion }: { suggestion: CategorySuggestionView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'confirmed' | 'rejected') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/agent/proposals/${suggestion.proposalId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const body = await res.json();
      if (!body.success) { setError(body.error?.message ?? 'Could not apply'); return; }
      router.refresh();
    } catch {
      setError('Could not apply');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-0.5 shrink-0 max-w-full" title={error ?? suggestion.rationale ?? undefined}>
      <span className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-l-full bg-violet-50 font-medium min-w-0 ${error ? 'text-red-500' : 'text-violet-700'}`}>
        <Sparkles size={11} className="shrink-0" />
        <span className="truncate">{error ? 'Failed' : suggestion.category}</span>
      </span>
      <button
        type="button"
        onClick={() => decide('confirmed')}
        disabled={busy}
        aria-label={`File as ${suggestion.category}`}
        className="px-1.5 py-0.5 bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-50"
      >
        <Check size={12} />
      </button>
      <button
        type="button"
        onClick={() => decide('rejected')}
        disabled={busy}
        aria-label="Dismiss suggestion"
        className="px-1.5 py-0.5 rounded-r-full bg-violet-50 text-violet-400 hover:bg-violet-100 hover:text-violet-600 disabled:opacity-50"
      >
        <X size={12} />
      </button>
    </span>
  );
}
