'use client';

// Loyalty inbox, reading (P8-42c2) — one queued reading: the program, the masked suffix, the proposed
// figure with its unit and date, why the rules did not apply it, and three actions.
//
//   Apply    — appends the figure as an `email` reading. With exactly one candidate membership it
//              goes there; otherwise a membership must be chosen first ("Apply to" / "Choose a
//              membership"), and Apply stays disabled until one is. Every membership of the item's
//              program may be chosen; the server refuses any other.
//   Not mine — discards it and remembers that this suffix is not the household's.
//   Ignore   — discards it.
//
// The figure is shown exactly as stored (decimal text and the unit word), because it is a proposal
// to check against the mail, not a balance to read at a glance. A missing date is "no date", a
// missing suffix "no number shown"; nothing is ever shown as zero for want of a value.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LoyaltyMembership, LoyaltyReadItem, LoyaltyReadReason } from '@b8/contracts/loyalty';
import { send } from './LoyaltyRequest';

/**
 * Why an item is in the queue, as the page says it after `Why: `. One home for the wording, written
 * out literally (the jump sentence included) so the page's source checks find every phrase as shown.
 */
const REASON_TEXT: Record<LoyaltyReadReason, string> = {
  no_suffix: 'The mail shows too little of the number',
  unmatched_suffix: 'No membership ends with this number',
  ambiguous_suffix: 'More than one membership ends with this number',
  program_mismatch: 'The mail names a different program',
  unit_mismatch: 'The unit could not be confirmed against the stored balance',
  no_as_of: 'The mail has no date',
  as_of_future: 'The date is in the future',
  no_baseline: 'There is no earlier balance to compare with',
  implausible_jump: 'The balance changed by more than 50%',
};

export default function LoyaltyReadQueueItem({
  item, programName, memberships,
}: { item: LoyaltyReadItem; programName: string; memberships: LoyaltyMembership[] }) {
  const router = useRouter();
  const unique = item.candidateMembershipIds.length === 1 ? item.candidateMembershipIds[0] : null;
  // Several candidates: choose among them; none: among every membership of the program.
  const choices = item.candidateMembershipIds.length > 1
    ? memberships.filter((m) => item.candidateMembershipIds.includes(m.id))
    : memberships;
  const [choice, setChoice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `/api/v1/loyalty/inbox/readings/${item.id}`;

  async function act(body: unknown) {
    setBusy(true);
    const result = await send('POST', path, body);
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    setError(null);
    router.refresh();
  }
  /** Apply, to the unique candidate or the chosen membership. */
  async function applyItem() {
    const membershipId = unique ?? choice;
    if (membershipId === null) return;
    await act({ action: 'apply', membershipId });
  }
  async function notMine() { await act({ action: 'not_mine' }); }
  async function ignoreItem() { await act({ action: 'ignore' }); }

  const line = `${programName} · ${item.maskedSuffix ?? 'no number shown'} · ${item.balance} ${item.unit} · as of ${item.asOf ?? 'no date'}`;
  const btn = 'min-h-8 px-3 py-1.5 rounded text-sm disabled:opacity-50';
  return (
    <li className="py-2 text-sm">
      <p className="text-gray-900 break-words">{line}</p>
      <p className="text-xs text-gray-500">{`Why: ${REASON_TEXT[item.reason]}`}</p>
      {item.asOf === null && <p className="text-xs text-gray-400">Applying dates it by the day the mail arrived, {item.receivedOn}.</p>}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {unique === null && (
          <label className="inline-flex items-center gap-1 text-xs text-gray-500">
            Apply to
            <select
              aria-label="Choose a membership"
              value={choice ?? ''}
              onChange={(e) => setChoice(e.target.value === '' ? null : Number(e.target.value))}
              className="border border-gray-200 rounded px-2 py-1.5 text-base sm:text-sm bg-white"
            >
              <option value="">Choose a membership</option>
              {choices.map((m) => <option key={m.id} value={m.id}>{`${m.memberDisplayName}${m.memberNumberMasked ? ` ${m.memberNumberMasked}` : ''}`}</option>)}
            </select>
          </label>
        )}
        <button type="button" onClick={applyItem} disabled={busy || (unique === null && choice === null)} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
          Apply
        </button>
        <button type="button" onClick={notMine} disabled={busy} className={`${btn} bg-gray-100 text-gray-600 hover:bg-gray-200`}>
          Not mine
        </button>
        <button type="button" onClick={ignoreItem} disabled={busy} className={`${btn} bg-gray-100 text-gray-600 hover:bg-gray-200`}>
          Ignore
        </button>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
    </li>
  );
}
