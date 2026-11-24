'use client';

// The stays section (P8-42e1) — this year's counted nights per hotel membership, the stays to come and the
// stays completed this year, the held bookings with their one-tap choices, and a typed form to add or
// correct a stay. Everything arrives as server props (`loadBookings` beside `loadOverview`), codes
// already MASKED; nothing is fetched on render, and each write is an event handler followed by
// `router.refresh()`.
//
// NO DATA IS NEVER ZERO. A membership with no counted stay shows a dash and a sentence, never a 0; a
// stay with no stated property says so in words; a list with nothing in it is not drawn at all. The
// whole section returns nothing when the payload has no hotel membership, stay or held booking.
//
// THE CODE IS NEVER SHOWN. Rows show `maskedCode`, the only code field the payload has. The form
// sends a code the person typed, which is how a typed stay is keyed, and keeps nothing after a save.
//
// The palette is the other /travel loyalty components' (`gray-*`, the blue primary button), not the
// accounts UI's slate, so the section reads as part of the page it sits in.

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { LoyaltyBookingQueueItem, LoyaltyBookings, LoyaltyOverview, LoyaltyStay } from '@b8/contracts/loyalty';
import { send } from './LoyaltyRequest';

/** The code input's form name and label. The body key is taken from here, so it is spelled once. */
const CODE_INPUT = { name: 'confirmationCode', label: 'Confirmation code' } as const;

const btn = 'min-h-8 px-3 py-1.5 rounded text-sm disabled:opacity-50';
const field = 'border border-gray-200 rounded px-2 py-1.5 text-base sm:text-sm bg-white';
const subhead = 'mt-4 mb-1 text-xs font-medium text-gray-400';

/** A property as shown: the stored name, or the words for a mail or person that stated none. */
const propertyText = (property: string | null) => property ?? 'Property not stated';

/** The year's figure for one membership: a whole count, or a dash with its sentence when nothing counts. */
function NightsLine({ label, nights, year }: { label: string; nights: number | null; year: number }) {
  return (
    <li className="py-1 text-sm flex flex-wrap justify-between gap-2">
      <span className="text-gray-900">{label}</span>
      {nights === null ? (
        <span className="text-gray-400">{'— · No stay counted yet'}</span>
      ) : (
        <span className="text-gray-900">{nights === 1 ? `1 night counted in ${year}` : `${nights} nights counted in ${year}`}</span>
      )}
    </li>
  );
}

function StayRow({ stay, holder }: { stay: LoyaltyStay; holder: string }) {
  return (
    <li className="py-1 text-sm">
      <p className="text-gray-900 break-words">{`${propertyText(stay.property)} · ${stay.checkIn} to ${stay.checkOut} · ${stay.nights === 1 ? '1 night' : `${stay.nights} nights`}`}</p>
      <p className="text-xs text-gray-400">{`${holder} · ${stay.maskedCode}`}</p>
    </li>
  );
}

/** One held booking: what the mail said, and the three taps. */
function HeldBooking({ item, programName, choices }: { item: LoyaltyBookingQueueItem; programName: string; choices: { id: number; label: string }[] }) {
  const router = useRouter();
  const [choice, setChoice] = useState<number | null>(item.candidateMembershipIds.length === 1 ? item.candidateMembershipIds[0] : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(body: unknown) {
    setBusy(true);
    const result = await send('POST', `/api/v1/loyalty/inbox/bookings/${item.id}`, body);
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    setError(null);
    router.refresh();
  }
  const kind = item.state === 'cancelled' ? 'cancellation' : 'booking';
  return (
    <li className="py-2 text-sm">
      <p className="text-gray-900 break-words">{`${programName} · ${item.maskedSuffix ?? 'no number shown'} · ${kind} · ${propertyText(item.property)} · ${item.checkIn} to ${item.checkOut} · ${item.maskedCode}`}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <select aria-label="Choose a membership for this stay" value={choice ?? ''} onChange={(e) => setChoice(e.target.value === '' ? null : Number(e.target.value))} className={field}>
          <option value="">Choose a membership</option>
          {choices.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <button type="button" disabled={busy || choice === null} onClick={() => choice !== null && act({ action: 'place', membershipId: choice })} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
          Add to this membership
        </button>
        <button type="button" disabled={busy} onClick={() => act({ action: 'not_mine' })} className={`${btn} bg-gray-100 text-gray-600 hover:bg-gray-200`}>
          Not mine
        </button>
        <button type="button" disabled={busy} onClick={() => act({ action: 'ignore' })} className={`${btn} bg-gray-100 text-gray-600 hover:bg-gray-200`}>
          Ignore
        </button>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
    </li>
  );
}

/** The typed fallback. Blank property and award are sent as null ("not stated"), never as '' or false. */
function StayForm({ memberships }: { memberships: { id: number; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [membershipId, setMembershipId] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [property, setProperty] = useState('');
  const [state, setState] = useState<'booked' | 'cancelled'>('booked');
  const [award, setAward] = useState<'' | 'award' | 'cash'>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (membershipId === null) { setError('Choose a membership.'); return; }
    setSaving(true);
    const result = await send('POST', '/api/v1/loyalty/stays', {
      membershipId,
      [CODE_INPUT.name]: code,
      checkIn,
      checkOut,
      property: property.trim() === '' ? null : property.trim(),
      state,
      award: award === '' ? null : award === 'award',
    });
    setSaving(false);
    if (!result.ok) { setError(result.message); return; }
    setError(null);
    setCode('');
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${btn} mt-4 bg-gray-100 text-gray-600 hover:bg-gray-200`}>
        Add a stay
      </button>
    );
  }
  return (
    <form onSubmit={save} className="mt-4 grid gap-2 sm:grid-cols-2">
      <select aria-label="Membership" value={membershipId ?? ''} onChange={(e) => setMembershipId(e.target.value === '' ? null : Number(e.target.value))} className={field}>
        <option value="">Choose a membership</option>
        {memberships.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <input name={CODE_INPUT.name} aria-label={CODE_INPUT.label} placeholder={CODE_INPUT.label} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" className={field} />
      <label className="text-xs text-gray-500 flex flex-col gap-1">Check-in<input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className={field} /></label>
      <label className="text-xs text-gray-500 flex flex-col gap-1">Check-out<input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className={field} /></label>
      <input aria-label="Property" placeholder="Property (optional)" value={property} onChange={(e) => setProperty(e.target.value)} className={field} />
      <select aria-label="Paid with" value={award} onChange={(e) => setAward(e.target.value as '' | 'award' | 'cash')} className={field}>
        <option value="">Payment not stated</option>
        <option value="award">Points or a certificate</option>
        <option value="cash">Cash</option>
      </select>
      <select aria-label="State" value={state} onChange={(e) => setState(e.target.value === 'cancelled' ? 'cancelled' : 'booked')} className={field}>
        <option value="booked">Booked</option>
        <option value="cancelled">Cancelled</option>
      </select>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
          {saving ? 'Saving…' : 'Save stay'}
        </button>
        <button type="button" disabled={saving} onClick={() => setOpen(false)} className={`${btn} bg-gray-100 text-gray-600 hover:bg-gray-200`}>
          Close
        </button>
      </div>
      {error && <p className="text-red-500 text-sm sm:col-span-2">{error}</p>}
    </form>
  );
}

export default function LoyaltyStaysSection({ bookings, overview }: { bookings: LoyaltyBookings; overview: LoyaltyOverview }) {
  if (bookings.nights.length + bookings.upcoming.length + bookings.completed.length + bookings.queue.length === 0) return null;
  const labelOf = new Map(
    overview.cards.flatMap((c) => c.memberships.map((m) => [m.id, `${c.programName} · ${m.memberDisplayName}`] as const))
  );
  const programName = new Map(overview.programs.map((p) => [p.id, p.name]));
  const holder = (id: number) => labelOf.get(id) ?? 'Membership';
  const hotelMemberships = bookings.nights.map((n) => ({ id: n.membershipId, label: holder(n.membershipId) }));
  const ofProgram = (programId: number) =>
    overview.cards.filter((c) => c.programId === programId).flatMap((c) => c.memberships.map((m) => ({ id: m.id, label: holder(m.id) })));
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">Hotel stays</h2>
      <div className="border rounded-xl p-4">
        {bookings.nights.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {bookings.nights.map((n) => <NightsLine key={n.membershipId} label={holder(n.membershipId)} nights={n.nightsThisYear} year={bookings.year} />)}
          </ul>
        )}
        <p className="mt-2 text-xs text-gray-400">
          Program-specific qualifying rules are not applied; every night of a completed stay counts. Cancelled stays are not counted.
        </p>
        {bookings.upcoming.length > 0 && (
          <>
            <h3 className={subhead}>Upcoming</h3>
            <ul>{bookings.upcoming.map((s) => <StayRow key={s.id} stay={s} holder={holder(s.membershipId)} />)}</ul>
          </>
        )}
        {bookings.completed.length > 0 && (
          <>
            <h3 className={subhead}>Completed this year</h3>
            <ul>{bookings.completed.map((s) => <StayRow key={s.id} stay={s} holder={holder(s.membershipId)} />)}</ul>
          </>
        )}
        {bookings.queue.length > 0 && (
          <>
            <h3 className={subhead}>Stays that need a membership</h3>
            <ul className="divide-y divide-gray-100">
              {bookings.queue.map((item) => (
                <HeldBooking key={item.id} item={item} programName={programName.get(item.programId) ?? 'Program'} choices={ofProgram(item.programId)} />
              ))}
            </ul>
          </>
        )}
        {hotelMemberships.length > 0 && <StayForm memberships={hotelMemberships} />}
      </div>
    </section>
  );
}
