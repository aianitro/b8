'use client';

// Loyalty (P8-42b) — a membership's credit card on /travel: link one, unlink it, describe the annual
// benefit it brings, and see where that benefit stands (`LoyaltyFeeWatchLine`).
//
// THE PICKER OFFERS ONLY FREE CREDIT CARDS. The server lists every `credit` account
// (`cardAccounts`); the board removes the ones another membership already holds, because one card
// earns into one membership and offering a taken card would only produce a 409. The server still
// decides — a card taken between render and tap is answered `CARD_ALREADY_LINKED`, shown inline.
//
// UNLINK IS ONE TAP, with no confirmation, unlike "Remove number": it deletes nothing (instruments
// and the benefit stay) and re-linking is one choice in the picker. Its handler is the only place on
// the page that sends a null card.
//
// THE WINDOW IS SENT AS A JSON NUMBER, or not at all. Left empty, the server stores the default
// window; anything that is not a whole number from 1 to 365 is refused by the contract and the
// refusal is shown, never rounded here.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LoyaltyCardAccount, LoyaltyInstrumentKind, LoyaltyMembership } from '@b8/contracts/loyalty';
import LoyaltyFeeWatchLine from './LoyaltyFeeWatchLine';
import { INSTRUMENT_KIND_LABEL } from './LoyaltyInstrumentList';
import { send } from './LoyaltyRequest';

const KINDS: LoyaltyInstrumentKind[] = ['free_night', 'companion_fare', 'travel_credit', 'other'];
const CONTROL = 'min-h-8 px-2 rounded text-xs';
const FIELD = 'border border-gray-200 rounded px-2 py-1.5 text-base sm:text-sm bg-white';

export default function LoyaltyCardLink({ m, cardChoices }: { m: LoyaltyMembership; cardChoices: LoyaltyCardAccount[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<LoyaltyInstrumentKind>(m.benefit?.kind ?? 'free_night');
  const [description, setDescription] = useState(m.benefit?.description ?? '');
  const [windowText, setWindowText] = useState(m.benefit === null ? '' : String(m.benefit.windowDays));
  const watch = m.feeWatch;

  /** One PATCH of this membership; true when it was accepted and the page is re-reading. */
  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setSaving(true);
    const result = await send('PATCH', `/api/v1/loyalty/memberships/${m.id}`, body);
    setSaving(false);
    if (!result.ok) { setError(result.message); return false; }
    setError(null);
    router.refresh();
    return true;
  }

  /** The one sender of a null card: unlinks and leaves instruments and the benefit alone. */
  async function unlinkCard() {
    await patch({ cardAccountId: null });
  }

  async function saveBenefit() {
    const benefit = windowText.trim() === ''
      ? { kind, description }
      : { kind, description, windowDays: Number(windowText) };
    if (await patch({ benefit })) setEditing(false);
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
      {m.cardAccountId !== null ? (
        <>
          <span className="text-gray-500">Card <span className="text-gray-700">{m.cardAccountName}</span></span>
          <button type="button" onClick={unlinkCard} disabled={saving} className={`${CONTROL} text-gray-500 hover:bg-gray-100 disabled:opacity-50`}>
            Unlink card
          </button>
        </>
      ) : cardChoices.length > 0 ? (
        <select
          aria-label="Link a card"
          value=""
          disabled={saving}
          onChange={(e) => { if (e.target.value !== '') void patch({ cardAccountId: e.target.value }); }}
          className={`${FIELD} min-h-8 disabled:opacity-50`}
        >
          <option value="">Link a card…</option>
          {cardChoices.map((c) => <option key={c.id} value={c.id}>{c.name === '' ? c.id : c.name}</option>)}
        </select>
      ) : null}
      {watch !== null && <LoyaltyFeeWatchLine watch={watch} benefit={m.benefit} tone="gray" />}
      {watch === null && m.benefit !== null && <span className="text-gray-500">Benefit: {m.benefit.description}</span>}
      <button type="button" onClick={() => setEditing(!editing)} className={`${CONTROL} text-gray-500 hover:bg-gray-100`}>
        {editing ? 'Cancel' : 'Set benefit'}
      </button>
      {editing && (
        <div className="basis-full mt-1 grid gap-2 bg-gray-50 rounded-lg p-3">
          <div className="flex flex-wrap gap-2">
            <select aria-label="Benefit kind" value={kind} onChange={(e) => setKind(e.target.value as LoyaltyInstrumentKind)} className={FIELD}>
              {KINDS.map((k) => <option key={k} value={k}>{INSTRUMENT_KIND_LABEL[k]}</option>)}
            </select>
            <input aria-label="Benefit description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the card issues each year" className={`${FIELD} min-w-0 flex-1`} />
            <input aria-label="Days after the fee" inputMode="numeric" value={windowText} onChange={(e) => setWindowText(e.target.value)} placeholder="45 days" className={`${FIELD} w-24`} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={saveBenefit} disabled={saving} className={`${CONTROL} font-medium text-white bg-gray-800 hover:bg-gray-700 disabled:opacity-50`}>
              {saving ? 'Saving…' : 'Save benefit'}
            </button>
            {m.benefit !== null && (
              <button type="button" onClick={async () => { if (await patch({ benefit: null })) setEditing(false); }} disabled={saving} className={`${CONTROL} text-red-400 hover:text-red-600 hover:bg-gray-100 disabled:opacity-50`}>
                Clear benefit
              </button>
            )}
          </div>
        </div>
      )}
      {error && <p className="basis-full text-red-500 text-sm">{error}</p>}
    </div>
  );
}
