'use client';

// Loyalty (P8-42a) — adding things on /travel: a household member, a program the catalog lacks, a
// membership, a certificate or credit. One small form at a time, chosen by a row of buttons, so the
// phone layout never stacks four forms above the cards.
//
// A member number typed here is sent once and never shown again unmasked; a refusal shows the
// server's message, which never repeats it.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LoyaltyOverview } from '@b8/contracts/loyalty';
import { send } from './LoyaltyRequest';
import { INSTRUMENT_KIND_LABEL } from './LoyaltyInstrumentList';

type Mode = 'member' | 'program' | 'membership' | 'instrument';
const TITLE: Record<Mode, string> = { member: 'Person', program: 'Program', membership: 'Membership', instrument: 'Certificate' };
const field = 'mt-1 block w-full border border-gray-200 rounded px-2 py-1.5 text-base sm:text-sm text-gray-900 bg-white';

export default function LoyaltyAddPanel({ overview }: { overview: LoyaltyOverview }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? '').trim();
    const optional = (k: string) => (text(k) === '' ? null : text(k));
    const [path, body] =
      mode === 'member' ? ['/api/v1/loyalty/members', { displayName: text('displayName') }]
      : mode === 'program' ? ['/api/v1/loyalty/programs', { name: text('name'), kind: text('kind'), defaultUnit: text('defaultUnit') }]
      : mode === 'membership' ? ['/api/v1/loyalty/memberships', {
          memberId: Number(text('memberId')), programId: Number(text('programId')),
          memberNumber: optional('memberNumber'), tier: optional('tier'),
        }]
      : ['/api/v1/loyalty/instruments', {
          membershipId: Number(text('membershipId')), kind: text('kind'), description: text('description'),
          issuedOn: optional('issuedOn'), expiresOn: optional('expiresOn'),
        }];
    setSaving(true);
    setError(null);
    const result = await send('POST', path, body);
    setSaving(false);
    if (!result.ok) { setError(result.message); return; }
    setMode(null);
    router.refresh();
  }

  const memberships = overview.cards.flatMap((c) => c.memberships.map((m) => ({ id: m.id, label: `${c.programName} · ${m.memberDisplayName}` })));

  return (
    <div className="mb-8">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(TITLE) as Mode[]).map((m) => (
          <button key={m} type="button" onClick={() => { setMode(mode === m ? null : m); setError(null); }}
            className={`px-3 py-2 rounded text-sm ${mode === m ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            + {TITLE[m]}
          </button>
        ))}
      </div>
      {mode !== null && (
        <form key={mode} onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2 border border-gray-200 rounded-xl p-4 bg-white">
          {mode === 'member' && <label className="text-xs text-gray-400 sm:col-span-2">Name<input name="displayName" required className={field} /></label>}
          {mode === 'program' && <>
            <label className="text-xs text-gray-400 sm:col-span-2">Program name<input name="name" required className={field} /></label>
            <label className="text-xs text-gray-400">Kind<select name="kind" className={field}>{['airline', 'hotel', 'card_currency', 'travel_cash', 'car', 'other'].map((k) => <option key={k}>{k}</option>)}</select></label>
            <label className="text-xs text-gray-400">Default unit<select name="defaultUnit" className={field}>{['points', 'miles', 'nights', 'usd'].map((u) => <option key={u}>{u}</option>)}</select></label>
          </>}
          {mode === 'membership' && <>
            <label className="text-xs text-gray-400">Person<select name="memberId" required className={field}>{overview.members.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label>
            <label className="text-xs text-gray-400">Program<select name="programId" required className={field}>{overview.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="text-xs text-gray-400">Member number<input name="memberNumber" autoComplete="off" className={field} /></label>
            <label className="text-xs text-gray-400">Tier<input name="tier" className={field} /></label>
          </>}
          {mode === 'instrument' && <>
            <label className="text-xs text-gray-400 sm:col-span-2">Membership<select name="membershipId" required className={field}>{memberships.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
            <label className="text-xs text-gray-400">Kind<select name="kind" className={field}>{Object.entries(INSTRUMENT_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="text-xs text-gray-400">Description<input name="description" required className={field} /></label>
            <label className="text-xs text-gray-400">Issued<input name="issuedOn" type="date" className={field} /></label>
            <label className="text-xs text-gray-400">Expires<input name="expiresOn" type="date" className={field} /></label>
          </>}
          <div className="sm:col-span-2 flex items-center gap-3">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50">
              {saving ? 'Saving…' : `Add ${TITLE[mode].toLowerCase()}`}
            </button>
            {error && <p className="text-red-500 text-sm">{error}</p>}
          </div>
        </form>
      )}
    </div>
  );
}
