'use client';

// Loyalty (P8-42a) — one membership on a program card: who holds it, the current balance with its
// unit and as-of date, where that reading came from, the tier, and the member number masked with a
// copy action. Every field edits in place; the balance "edit" records a new reading.
//
// A MEMBERSHIP WITH NO READING SHOWS "—", never 0. `formatBalance` returns the dash for a null
// balance, and the branch below states it once more where the balance is drawn, so a refactor that
// dropped the helper could not quietly start printing a zero.
//
// AN EMPTY SAVE ON THE MEMBER NUMBER CHANGES NOTHING (P8-42a2). That editor starts empty, because the
// page holds only the mask, so a Save with nothing typed is almost always "I tapped it by accident",
// not "erase the number" — and an erased number is not restored by a re-import, which never updates
// an existing membership. The guard lives in the `onSave` callback itself, not in a disabled button,
// because the Enter key submits the form without touching the button. Removing a number is a
// separate "Remove number" control with a confirming second tap; its Confirm handler is the only
// place on the page that sends `memberNumber` as null.
//
// THE CARD (P8-42b) sits on its own row under the fields, in `LoyaltyCardLink`: the linked credit
// card, its link and unlink controls, the benefit, and the fee watch.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LoyaltyCardAccount, LoyaltyMembership, LoyaltyObservationSource, LoyaltyReadFromMail, LoyaltyUnit } from '@b8/contracts/loyalty';
import { formatBalance } from '@/lib/domain/loyalty';
import LoyaltyInlineText from './LoyaltyInlineText';
import LoyaltyBalanceEditor from './LoyaltyBalanceEditor';
import LoyaltyCopyNumber from './LoyaltyCopyNumber';
import LoyaltyCardLink from './LoyaltyCardLink';
import LoyaltyFromMailLine from './LoyaltyFromMailLine';
import { send } from './LoyaltyRequest';

const SOURCE_BADGE: Record<LoyaltyObservationSource, { label: string; cls: string }> = {
  typed: { label: 'typed', cls: 'bg-gray-100 text-gray-600' },
  import: { label: 'imported', cls: 'bg-blue-50 text-blue-700' },
  email: { label: 'email', cls: 'bg-gray-100 text-gray-600' },
  screenshot: { label: 'screenshot', cls: 'bg-gray-100 text-gray-600' },
};

export default function LoyaltyMembershipLine({
  m, defaultUnit, cardChoices, fromMail,
}: {
  m: LoyaltyMembership; defaultUnit: LoyaltyUnit; cardChoices: LoyaltyCardAccount[];
  /** What the newest settled mail said about this membership's expiries and instruments (P8-42c2); absent when nothing. */
  fromMail?: LoyaltyReadFromMail;
}) {
  const router = useRouter();
  const [entering, setEntering] = useState(false);
  // The "Remove number" control's two steps: a first tap only asks; Confirm sends.
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  /** A PATCH, then a server re-read; the refusal message for the inline editor otherwise. */
  async function patch(path: string, body: unknown): Promise<string | null> {
    const result = await send('PATCH', path, body);
    if (!result.ok) return result.message;
    router.refresh();
    return null;
  }

  const blankIsNull = (text: string) => (text.trim() === '' ? null : text);

  /**
   * The confirmed removal — the ONLY sender of a null member number. Attached to Confirm, never to
   * "Remove number" itself, so one tap cannot erase anything. The confirmation is closed on success
   * explicitly: `router.refresh()` keeps client state, and the control disappears with the number.
   */
  async function removeNumber() {
    setRemoving(true);
    setRemoveError(null);
    const message = await patch(`/api/v1/loyalty/memberships/${m.id}`, { memberNumber: null });
    setRemoving(false);
    if (message === null) setConfirmingRemove(false);
    else setRemoveError(message);
  }

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
            onSave={(t) => (t.trim() === '' ? Promise.resolve(null) : patch(`/api/v1/loyalty/memberships/${m.id}`, { memberNumber: t }))}
          />
          {m.memberNumberMasked !== null && <LoyaltyCopyNumber membershipId={m.id} />}
        </span>
        {m.memberNumberMasked !== null && (confirmingRemove ? (
          <span className="inline-flex flex-wrap items-center gap-1 text-gray-500">
            <span>Remove this number?</span>
            <button
              type="button"
              onClick={removeNumber}
              disabled={removing}
              aria-label="Confirm removing the member number"
              className="min-h-8 px-2 rounded font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {removing ? 'Removing…' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={() => { setConfirmingRemove(false); setRemoveError(null); }}
              disabled={removing}
              className="min-h-8 px-2 rounded hover:bg-gray-100 disabled:opacity-50"
            >
              Keep
            </button>
            {removeError && <span className="basis-full text-red-500 text-sm">{removeError}</span>}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingRemove(true)}
            className="min-h-8 px-2 rounded text-red-400 hover:text-red-600 hover:bg-gray-100"
          >
            Remove number
          </button>
        ))}
      </div>
      <LoyaltyCardLink m={m} cardChoices={cardChoices} />
      {fromMail && <LoyaltyFromMailLine fromMail={fromMail} />}
      {entering && (
        <LoyaltyBalanceEditor membershipId={m.id} unit={m.unit ?? defaultUnit} onClose={() => setEntering(false)} />
      )}
    </li>
  );
}
