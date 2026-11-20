'use client';

// Loyalty (P8-42a) — certificates, companion fares and travel credits, below the program cards, in
// the order the server decided: unused before used, soonest expiry first, unknown expiry last. An
// unknown date reads "unknown", never a made-up one; an imported bonus has no dates at all.

import { useRouter } from 'next/navigation';
import type { LoyaltyInstrument, LoyaltyInstrumentKind } from '@b8/contracts/loyalty';
import LoyaltyInlineText from './LoyaltyInlineText';
import { send } from './LoyaltyRequest';

const KINDS: LoyaltyInstrumentKind[] = ['free_night', 'companion_fare', 'travel_credit', 'other'];
export const INSTRUMENT_KIND_LABEL: Record<LoyaltyInstrumentKind, string> = {
  free_night: 'Free night', companion_fare: 'Companion fare', travel_credit: 'Travel credit', other: 'Other',
};

export default function LoyaltyInstrumentList({
  instruments, holderOf,
}: { instruments: LoyaltyInstrument[]; holderOf: Map<number, string> }) {
  const router = useRouter();

  async function patch(id: number, body: unknown): Promise<string | null> {
    const result = await send('PATCH', `/api/v1/loyalty/instruments/${id}`, body);
    if (!result.ok) return result.message;
    router.refresh();
    return null;
  }

  const dateField = (i: LoyaltyInstrument, key: 'issuedOn' | 'expiresOn' | 'usedOn', label: string) => (
    <span>
      {label}{' '}
      <LoyaltyInlineText
        value={i[key]}
        placeholder="unknown"
        label={`${label} date`}
        type="date"
        onSave={(t) => patch(i.id, { [key]: t.trim() === '' ? null : t })}
      />
    </span>
  );

  if (instruments.length === 0) {
    return <p className="text-sm text-gray-400">No certificates or credits yet. Add one above.</p>;
  }
  return (
    <ul className="border border-gray-200 rounded-xl bg-white divide-y divide-gray-100">
      {instruments.map((i) => (
        <li key={i.id} className={`px-4 py-3 ${i.usedOn !== null ? 'opacity-60' : ''}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 text-sm text-gray-900">
              <LoyaltyInlineText value={i.description} placeholder="Description" label="description" onSave={(t) => patch(i.id, { description: t })} />
            </div>
            <select
              aria-label="Kind"
              value={i.kind}
              onChange={(e) => patch(i.id, { kind: e.target.value })}
              className="border border-gray-200 rounded px-2 py-1 text-base sm:text-xs bg-white text-gray-600"
            >
              {KINDS.map((k) => <option key={k} value={k}>{INSTRUMENT_KIND_LABEL[k]}</option>)}
            </select>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
            <span>{holderOf.get(i.membershipId) ?? 'Unknown holder'}</span>
            {dateField(i, 'expiresOn', 'Expires')}
            {dateField(i, 'issuedOn', 'Issued')}
            {dateField(i, 'usedOn', 'Used')}
          </div>
        </li>
      ))}
    </ul>
  );
}
