'use client';

// Loyalty (P8-42a) — one membership on a program card: who holds it, the current balance with its
// unit and as-of date, where that reading came from, the tier, and the member number masked with a
// copy action. Every field edits in place; the balance "edit" records a new reading.
//
// A MEMBERSHIP WITH NO READING SHOWS "—", never 0. `formatBalance` returns the dash for a null
// balance, and the branch below states it once more where the balance is drawn, so a refactor that
// dropped the helper could not quietly start printing a zero.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LoyaltyMembership, LoyaltyObservationSource, LoyaltyUnit } from '@b8/contracts/loyalty';
import { formatBalance } from '@/lib/domain/loyalty';
import LoyaltyInlineText from './LoyaltyInlineText';
import LoyaltyBalanceEditor from './LoyaltyBalanceEditor';
import LoyaltyCopyNumber from './LoyaltyCopyNumber';
import { send } from './LoyaltyRequest';

const SOURCE_BADGE: Record<LoyaltyObservationSource, { label: string; cls: string }> = {
  typed: { label: 'typed', cls: 'bg-gray-100 text-gray-600' },
  import: { label: 'imported', cls: 'bg-blue-50 text-blue-700' },
  email: { label: 'email', cls: 'bg-gray-100 text-gray-600' },
  screenshot: { label: 'screenshot', cls: 'bg-gray-100 text-gray-600' },
};

export default function LoyaltyMembershipLine({ m, defaultUnit }: { m: LoyaltyMembership; defaultUnit: LoyaltyUnit }) {
  const router = useRouter();
  const [entering, setEntering] = useState(false);

  /** A PATCH, then a server re-read; the refusal message for the inline editor otherwise. */
  async function patch(path: string, body: unknown): Promise<string | null> {
    const result = await send('PATCH', path, body);
    if (!result.ok) return result.message;
    router.refresh();
    return null;
  }

  const blankIsNull = (text: string) => (text.trim() === '' ? null : text);

  return (
    <li className="py-3 border-b border-gray-100 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 text-sm font-medium text-gray-900">
          <LoyaltyInlineText
            value={m.memberDisplayName}
            placeholder="Name"
            label="member name"
            onSave={(t) => patch(`/api/v1/loyalty/members/${m.memberId}`, { displayName: t })}
          />
        </div>
        <button
          type="button"
          onClick={() => setEntering(true)}
          aria-label="Enter a new balance"
          className="text-right min-h-8 rounded px-1 -mx-1 hover:bg-gray-100"
        >
          {m.balance === null
            ? <span className="font-mono text-gray-400">—</span>
            : <span className="font-mono text-sm font-semibold text-gray-900">{formatBalance(m.balance, m.unit)}</span>}
        </button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
        {m.source !== null && (
          <span className={`px-2 py-0.5 rounded-full font-medium ${SOURCE_BADGE[m.source].cls}`}>{SOURCE_BADGE[m.source].label}</span>
        )}
        {m.asOf !== null && <span>as of {m.asOf}</span>}
        <span className="text-gray-500">
          <LoyaltyInlineText
            value={m.tier}
            placeholder="No tier"
            label="tier"
            onSave={(t) => patch(`/api/v1/loyalty/memberships/${m.id}`, { tier: blankIsNull(t) })}
          />
        </span>
        <span className="inline-flex items-center gap-1 text-gray-500">
          <LoyaltyInlineText
            value={m.memberNumberMasked}
            placeholder="No number"
            label="member number"
            startEmpty
            mono
            onSave={(t) => patch(`/api/v1/loyalty/memberships/${m.id}`, { memberNumber: blankIsNull(t) })}
          />
          {m.memberNumberMasked !== null && <LoyaltyCopyNumber membershipId={m.id} />}
        </span>
      </div>
      {entering && (
        <LoyaltyBalanceEditor membershipId={m.id} unit={m.unit ?? defaultUnit} onClose={() => setEntering(false)} />
      )}
    </li>
  );
}
