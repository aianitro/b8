'use client';

// Nights & Miles (P8-42a) — the /travel page body: the add controls, one card per program somebody
// holds, then the certificates and credits. Exactly those two parts; later steps add the rest.
//
// Everything here arrives as server props with member numbers MASKED (`loadOverview`). Nothing is
// fetched on render; each edit is a write in an event handler followed by `router.refresh()`.
//
// The "Link a card" choices (P8-42b) are the server's credit cards less the ones a membership already
// holds: one card earns into one membership, so a taken card is not offered.

import type { LoyaltyOverview } from '@b8/contracts/loyalty';
import LoyaltyAddPanel from './LoyaltyAddPanel';
import LoyaltyProgramCard from './LoyaltyProgramCard';
import LoyaltyInstrumentList from './LoyaltyInstrumentList';
import LoyaltyInboxPanel from './LoyaltyInboxPanel';

export default function TravelBoard({ overview }: { overview: LoyaltyOverview }) {
  const programOf = new Map(overview.programs.map((p) => [p.id, p]));
  const taken = new Set(overview.cards.flatMap((c) => c.memberships.map((m) => m.cardAccountId)));
  const cardChoices = overview.cardAccounts.filter((a) => !taken.has(a.id));
  const holderOf = new Map(
    overview.cards.flatMap((c) => c.memberships.map((m) => [m.id, `${c.programName} · ${m.memberDisplayName}`] as const))
  );
  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Nights &amp; Miles</h1>
        <p className="text-xs text-gray-400 mt-1">
          {overview.cards.length === 0
            ? 'No memberships yet'
            : `${overview.cards.length} program${overview.cards.length === 1 ? '' : 's'} · ${holderOf.size} membership${holderOf.size === 1 ? '' : 's'}`}
        </p>
      </div>
      <LoyaltyAddPanel overview={overview} />
      {overview.cards.length === 0 ? (
        <p className="mb-8 text-sm text-gray-400">No memberships yet. Add a person, then a membership.</p>
      ) : (
        <div className="mb-8 grid gap-4">
          {overview.cards.map((card) => {
            const program = programOf.get(card.programId);
            return program ? <LoyaltyProgramCard key={card.programId} card={card} program={program} cardChoices={cardChoices} /> : null;
          })}
        </div>
      )}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">Certificates &amp; credits</h2>
      <LoyaltyInstrumentList instruments={overview.instruments} holderOf={holderOf} />
      {/* P8-42c1: forwarded loyalty mail — polling, forwarding health and coverage. */}
      <div className="mt-8">
        <LoyaltyInboxPanel overview={overview} />
      </div>
    </div>
  );
}
