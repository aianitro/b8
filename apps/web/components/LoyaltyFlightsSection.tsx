'use client';

// The flights section (P8-42e1b) — the flights to come and the ones flown in the last thirty days, the
// held flight bookings with their one-tap choices, and a typed form to add, correct or cancel a leg.
// Everything arrives as server props (`loadFlights` beside `loadOverview`), codes already MASKED;
// nothing is fetched on render, and each write is an event handler followed by `router.refresh()`.
//
// NOTHING IS COUNTED. No line here says how many flights, miles or credits anybody has: those follow
// each airline program's own rules, and the section says so in words instead. A list with nothing in
// it is not drawn; with no flight at all the section says so, never with a zero. The whole section
// returns nothing when the payload has no airline membership, flight or held booking.
//
// THE CODE IS NEVER SHOWN. Rows show `maskedCode`, the only code field the payload has. The form
// sends a code the person typed, which is part of how a typed leg is keyed, and keeps nothing after a
// save. A cancelled flight is in no list; a person cancels one by saving it again as cancelled.
//
// The palette is the other /travel loyalty components' (`gray-*`, the blue primary button), the same
// as the `Hotel stays` section above it, not the accounts UI's slate.

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { LoyaltyFlightLeg, LoyaltyFlightQueueItem, LoyaltyFlights, LoyaltyOverview, LoyaltySegment } from '@b8/contracts/loyalty';
import { send } from './LoyaltyRequest';

/** The code input's form name and label. The body key is taken from here, so it is spelled once. */
const CODE_INPUT = { name: 'confirmationCode', label: 'Confirmation code' } as const;

const btn = 'min-h-8 px-3 py-1.5 rounded text-sm disabled:opacity-50';
const field = 'border border-gray-200 rounded px-2 py-1.5 text-base sm:text-sm bg-white';
const subhead = 'mt-4 mb-1 text-xs font-medium text-gray-400';

type Choice = { id: number; label: string };

/** One leg in words: carrier and number, the two airports, the date. */
const legText = (l: LoyaltyFlightLeg) => `${l.carrier}${l.flightNumber} · ${l.origin} to ${l.destination} · ${l.flightDate}`;

function SegmentRow({ segment, holder }: { segment: LoyaltySegment; holder: string }) {
  return (
    <li className="py-1 text-sm">
      <p className="text-gray-900">{legText(segment)}</p>
      <p className="text-xs text-gray-400">{`${holder} · ${segment.maskedCode}`}</p>
    </li>
  );
}

/** One held flight booking: what the mail said, and the three taps. */
function HeldFlight({ item, programName, choices }: { item: LoyaltyFlightQueueItem; programName: string; choices: Choice[] }) {
  const router = useRouter();
  const [choice, setChoice] = useState<number | null>(item.candidateMembershipIds.length === 1 ? item.candidateMembershipIds[0] : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(body: unknown) {
    setBusy(true);
    const result = await send('POST', `/api/v1/loyalty/inbox/flights/${item.id}`, body);
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    setError(null);
    router.refresh();
  }
  const place = () => { if (choice !== null) void act({ action: 'place', membershipId: choice }); };
  const notMine = () => act({ action: 'not_mine' });
  const ignore = () => act({ action: 'ignore' });
  const what = item.state === 'cancelled' ? 'cancellation' : 'booking';
  const legs = item.legs.length === 0 ? ['every flight of this booking'] : item.legs.map(legText);
  return (
    <li className="py-2 text-sm">
      <p className="text-gray-900 break-words">{`${programName} · ${item.maskedSuffix ?? 'no number shown'} · ${what} · ${item.maskedCode}`}</p>
      <ul className="text-xs text-gray-500">{legs.map((t) => <li key={t}>{t}</li>)}</ul>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <select aria-label="Choose a membership for this flight" value={choice ?? ''} onChange={(e) => setChoice(e.target.value === '' ? null : Number(e.target.value))} className={field}>
          <option value="">Choose a membership</option>
          {choices.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <button type="button" disabled={busy || choice === null} onClick={place} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>Add to this membership</button>
        <button type="button" disabled={busy} onClick={notMine} className={`${btn} bg-gray-100 text-gray-600 hover:bg-gray-200`}>Not mine</button>
        <button type="button" disabled={busy} onClick={ignore} className={`${btn} bg-gray-100 text-gray-600 hover:bg-gray-200`}>Ignore</button>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
    </li>
  );
}

/**
 * The typed fallback. The state is only ever `booked` or `cancelled`; a blank payment choice is sent
 * as null ("not stated"), never as false. There is no source and no id: the server decides both.
 */
function FlightForm({ memberships }: { memberships: Choice[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [membershipId, setMembershipId] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [flightDate, setFlightDate] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [carrier, setCarrier] = useState('');
  const [flightNumber, setFlightNumber] = useState('');
  const [state, setState] = useState<'booked' | 'cancelled'>('booked');
  const [award, setAward] = useState<'' | 'award' | 'cash'>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (membershipId === null) { setError('Choose a membership.'); return; }
    setSaving(true);
    const result = await send('POST', '/api/v1/loyalty/segments', {
      membershipId,
      [CODE_INPUT.name]: code,
      flightDate,
      origin,
      destination,
      carrier,
      flightNumber,
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
    return <button type="button" onClick={() => setOpen(true)} className={`${btn} mt-4 bg-gray-100 text-gray-600 hover:bg-gray-200`}>Add a flight</button>;
  }
  const text = (label: string, value: string, set: (v: string) => void) => (
    <input aria-label={label} placeholder={label} value={value} onChange={(e) => set(e.target.value)} autoComplete="off" className={field} />
  );
  return (
    <form onSubmit={save} className="mt-4 grid gap-2 sm:grid-cols-2">
      <select aria-label="Membership" value={membershipId ?? ''} onChange={(e) => setMembershipId(e.target.value === '' ? null : Number(e.target.value))} className={field}>
        <option value="">Choose a membership</option>
        {memberships.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <input name={CODE_INPUT.name} aria-label={CODE_INPUT.label} placeholder={CODE_INPUT.label} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" className={field} />
      <label className="text-xs text-gray-500 flex flex-col gap-1">Flight date<input type="date" value={flightDate} onChange={(e) => setFlightDate(e.target.value)} className={field} /></label>
      {text('From (airport code)', origin, setOrigin)}
      {text('To (airport code)', destination, setDestination)}
      {text('Airline code', carrier, setCarrier)}
      {text('Flight number', flightNumber, setFlightNumber)}
      <select aria-label="Paid with" value={award} onChange={(e) => setAward(e.target.value as '' | 'award' | 'cash')} className={field}>
        <option value="">Payment not stated</option>
        <option value="award">Miles or an award</option>
        <option value="cash">Cash</option>
      </select>
      <select aria-label="State" value={state} onChange={(e) => setState(e.target.value === 'cancelled' ? 'cancelled' : 'booked')} className={field}>
        <option value="booked">Booked</option>
        <option value="cancelled">Cancelled</option>
      </select>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>{saving ? 'Saving…' : 'Save flight'}</button>
        <button type="button" disabled={saving} onClick={() => setOpen(false)} className={`${btn} bg-gray-100 text-gray-600 hover:bg-gray-200`}>Close</button>
      </div>
      {error && <p className="text-red-500 text-sm sm:col-span-2">{error}</p>}
    </form>
  );
}

export default function LoyaltyFlightsSection({ flights, overview }: { flights: LoyaltyFlights; overview: LoyaltyOverview }) {
  if (flights.airlineMembershipIds.length + flights.upcoming.length + flights.recent.length + flights.queue.length === 0) return null;
  // The comma form, not the `·` the stays section uses: a flight row already separates its parts with `·`.
  const labelOf = new Map(overview.cards.flatMap((c) => c.memberships.map((m) => [m.id, `${c.programName}, ${m.memberDisplayName}`] as const)));
  const programName = new Map(overview.programs.map((p) => [p.id, p.name]));
  const holder = (id: number) => labelOf.get(id) ?? 'Membership';
  const airline = flights.airlineMembershipIds.map((id) => ({ id, label: holder(id) }));
  const ofProgram = (programId: number) =>
    overview.cards.filter((c) => c.programId === programId).flatMap((c) => c.memberships.map((m) => ({ id: m.id, label: holder(m.id) })));
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">Flights</h2>
      <div className="border rounded-xl p-4">
        <p className="text-xs text-gray-400">Miles and status credits depend on the rules of each airline program and are not calculated here.</p>
        <p className="text-xs text-gray-400">Cancelled flights are not shown.</p>
        {flights.upcoming.length > 0 && (
          <>
            <h3 className={subhead}>Upcoming flights</h3>
            <ul>{flights.upcoming.map((s) => <SegmentRow key={s.id} segment={s} holder={holder(s.membershipId)} />)}</ul>
          </>
        )}
        {flights.recent.length > 0 && (
          <>
            <h3 className={subhead}>Recent flights</h3>
            <ul>{flights.recent.map((s) => <SegmentRow key={s.id} segment={s} holder={holder(s.membershipId)} />)}</ul>
          </>
        )}
        {flights.upcoming.length === 0 && flights.recent.length === 0 && <p className="mt-2 text-sm text-gray-400">No flights to show</p>}
        {flights.queue.length > 0 && (
          <>
            <h3 className={subhead}>Flights that need a membership</h3>
            <ul className="divide-y divide-gray-100">
              {flights.queue.map((item) => (
                <HeldFlight key={item.id} item={item} programName={programName.get(item.programId) ?? 'Program'} choices={ofProgram(item.programId)} />
              ))}
            </ul>
          </>
        )}
        {airline.length > 0 && <FlightForm memberships={airline} />}
      </div>
    </section>
  );
}
