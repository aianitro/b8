'use client';

// Loyalty (P8-42d) — the section asking for screenshots: the memberships whose balance is old or missing for a
// program the inbox is not bringing balances for, each with its own screenshot control.
//
// THE RULE IS THE SERVER'S. `overview.inboxRead.screenshotDue` is decided in Postgres, in the panel's
// one snapshot, from 42c's coverage and last-seen dates and the 45-day silence constant (SPEC.md D3);
// this component only lists it, in the order given. It renders nothing when the list is empty, so a
// household whose inbox brings every balance never sees the heading.
//
// A SEPARATE SECTION, not part of the read queue above it: the queue's wording and its counts are
// 42c's and are not conditioned on this list. A membership with no reading shows "—", never 0.

import type { LoyaltyMembership, LoyaltyOverview, LoyaltyUnit } from '@b8/contracts/loyalty';
import { formatBalance } from '@/lib/domain/loyalty';
import LoyaltyScreenshotCapture from './LoyaltyScreenshotCapture';

export default function LoyaltyScreenshotDue({ overview }: { overview: LoyaltyOverview }) {
  const due = overview.inboxRead.screenshotDue;
  if (due.length === 0) return null;
  const defaultUnit = new Map<number, LoyaltyUnit>(overview.programs.map((p) => [p.id, p.defaultUnit]));
  const byId = new Map<number, { programName: string; m: LoyaltyMembership }>(
    overview.cards.flatMap((c) => c.memberships.map((m) => [m.id, { programName: c.programName, m }] as const))
  );
  return (
    <section className="mb-8 border border-amber-200 bg-amber-50 rounded-xl p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-gray-900">Needs a screenshot</h2>
      <ul className="mt-2 divide-y divide-amber-100">
        {due.map((id) => {
          // Both always exist for an id the server listed; a missing one is skipped, never guessed.
          const entry = byId.get(id);
          const unit = entry ? defaultUnit.get(entry.m.programId) : undefined;
          if (!entry || !unit) return null;
          const { programName, m } = entry;
          return (
            <li key={id} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <p className="min-w-0 text-sm font-medium text-gray-900 break-words">{`${programName} · ${m.memberDisplayName}`}</p>
                {m.balance === null
                  ? <span className="font-mono text-gray-400">—</span>
                  : <span className="font-mono text-sm text-gray-900">{formatBalance(m.balance, m.unit)}</span>}
              </div>
              <p className="text-xs text-gray-500">
                The inbox is not bringing balances for this program.{m.asOf === null ? '' : ` Last balance as of ${m.asOf}.`}
              </p>
              <LoyaltyScreenshotCapture membershipId={m.id} currentAsOf={m.asOf} currentUnit={m.unit} defaultUnit={unit} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
