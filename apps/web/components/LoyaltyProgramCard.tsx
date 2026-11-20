'use client';

// Loyalty (P8-42a) — one program on /travel, with one line per membership. Only programs somebody
// holds get a card (the server decides that); the catalog behind them is much wider.
//
// The program's own fields — name, kind, default unit and the aliases the import matches sheet
// labels against — are edited from a small panel under the heading, so an unresolved sheet label is
// fixed here by adding the spelling as an alias.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LoyaltyCardAccount, LoyaltyProgram, LoyaltyProgramCard as Card, LoyaltyProgramKind, LoyaltyUnit } from '@b8/contracts/loyalty';
import LoyaltyMembershipLine from './LoyaltyMembershipLine';
import LoyaltyInlineText from './LoyaltyInlineText';
import { send } from './LoyaltyRequest';

const KINDS: LoyaltyProgramKind[] = ['airline', 'hotel', 'card_currency', 'travel_cash', 'car', 'other'];
const UNITS: LoyaltyUnit[] = ['points', 'miles', 'nights', 'usd'];
const KIND_LABEL: Record<LoyaltyProgramKind, string> = {
  airline: 'airline', hotel: 'hotel', card_currency: 'card points', travel_cash: 'travel cash', car: 'car', other: 'other',
};

export default function LoyaltyProgramCard({
  card, program, cardChoices,
}: { card: Card; program: LoyaltyProgram; cardChoices: LoyaltyCardAccount[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: unknown): Promise<string | null> {
    const result = await send('PATCH', `/api/v1/loyalty/programs/${program.id}`, body);
    if (!result.ok) { setError(result.message); return result.message; }
    setError(null);
    router.refresh();
    return null;
  }

  return (
    <section className="border border-gray-200 rounded-xl p-4 sm:p-6 bg-white">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 text-lg font-semibold text-gray-900 break-words">{card.programName}</h2>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600">{KIND_LABEL[card.programKind]}</span>
          <button type="button" onClick={() => setEditing(!editing)} className="min-h-8 px-2 text-xs text-gray-500 hover:text-gray-900">
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>
      {editing && (
        <div className="mt-3 grid gap-2 text-sm bg-gray-50 rounded-lg p-3">
          <label className="text-xs text-gray-400">Name
            <div className="text-sm text-gray-900"><LoyaltyInlineText value={program.name} placeholder="Name" label="program name" onSave={(t) => patch({ name: t })} /></div>
          </label>
          <div className="flex flex-wrap gap-2">
            <select aria-label="Program kind" value={program.kind} onChange={(e) => patch({ kind: e.target.value })} className="border border-gray-200 rounded px-2 py-1.5 text-base sm:text-sm bg-white">
              {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            <select aria-label="Default unit" value={program.defaultUnit} onChange={(e) => patch({ defaultUnit: e.target.value })} className="border border-gray-200 rounded px-2 py-1.5 text-base sm:text-sm bg-white">
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <label className="text-xs text-gray-400">Names the import accepts, separated by commas
            <div className="text-sm text-gray-900">
              <LoyaltyInlineText
                value={program.aliases.join(', ')}
                placeholder="No aliases"
                label="aliases"
                onSave={(t) => patch({ aliases: t.split(',').map((a) => a.trim()).filter((a) => a !== '') })}
              />
            </div>
          </label>
          {error && <p className="text-red-500 text-sm">{error}</p>}
        </div>
      )}
      <ul className="mt-2">
        {card.memberships.map((m) => <LoyaltyMembershipLine key={m.id} m={m} defaultUnit={program.defaultUnit} cardChoices={cardChoices} />)}
      </ul>
    </section>
  );
}
