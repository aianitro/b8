'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface CandidateAccount { id: string; name: string; }

interface Props {
  propertyId: number;
  /** The account currently linked to this property, if any. */
  linkedAccount: CandidateAccount | null;
  /** Liability, valuation-mode accounts with no property yet — this property's own link
   * (linkedAccount) is deliberately not required to also appear here; the two are merged
   * for the dropdown below. */
  unlinkedCandidates: CandidateAccount[];
}

const NONE = '__none__';

// Scoped to liability/valuation-mode accounts by the caller (app/properties/page.tsx) — see
// the note on PATCH /api/accounts/[id]'s property_id handling for why that scoping lives in
// the UI layer, not the API.
export default function PropertyMortgageLink({ propertyId, linkedAccount, unlinkedCandidates }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const options = linkedAccount ? [linkedAccount, ...unlinkedCandidates] : unlinkedCandidates;

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const nextId = e.target.value;
    setSaving(true);

    const patches: Promise<Response>[] = [];
    if (linkedAccount && linkedAccount.id !== nextId) {
      patches.push(fetch(`/api/accounts/${linkedAccount.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: null }),
      }));
    }
    if (nextId !== NONE && nextId !== linkedAccount?.id) {
      patches.push(fetch(`/api/accounts/${nextId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: propertyId }),
      }));
    }
    await Promise.all(patches);

    setSaving(false);
    router.refresh();
  }

  return (
    <select
      value={linkedAccount?.id ?? NONE}
      onChange={handleChange}
      disabled={saving}
      title="Mortgage account secured against this property"
      className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-600 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-slate-400 max-w-[160px]"
    >
      <option value={NONE}>No mortgage linked</option>
      {options.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
}
