// Flights (P8-42e1b) — the pure rules that turn what Claude proposed about one airline mail into a
// cleaned flight booking, and a cleaned booking into a plan for the segments of its confirmation
// code: the clean pass, the plausibility window, the group standing and supersession rule (SPEC.md
// D8) and the leg plan (D7). No database, no SDK, no `mailparser`, no `next`, no clock: the flight
// pass (`lib/loyaltyFlightRead.ts`) and the typed store (`lib/loyaltyFlightStore.ts`) read rows, ask
// these functions, and perform what they decided.
//
// ─── THE MODEL ONLY PROPOSES ──────────────────────────────────────────────────────────────────
//
// `cleanFlight` reads only its named keys of a plain object, keeps a field only when it is one of a
// closed set of forms (an enum, a calendar date, a code, a fixed-shape airport, carrier or flight
// number, a boolean) and nulls everything else. A key the model added (a passenger's name, a ticket
// number, a seat, a fare, a price, card digits, a time of day) is never looked at, so it cannot
// survive. There is no free text in a flight at all.
//
// ─── ONE BAD LEG VOIDS THE ITINERARY ──────────────────────────────────────────────────────────
//
// A mail's legs are kept all together or not at all. A partial itinerary is worse than none: when the
// mail also says its listing is complete, a missing leg would cancel a real flight. So any invalid
// leg, or more legs than one mail may list, empties the list and raises `legsVoid`, and the pass
// stores nothing from that mail.
//
// ─── THE LEG SHAPES EXIST TWICE ───────────────────────────────────────────────────────────────
//
// The contracts state the same shapes privately (`LoyaltyFlightLegSchema`, which normalises its
// input to the stored form), and the domain may not trust a zod parse for the model's output, so the
// rules are restated here with exactly the same steps: airports and carrier trimmed then upper-cased,
// a flight number with every whitespace character removed then upper-cased, leading zeros kept.
// T42e1b-U11 holds the two copies to one answer (SPEC.md A2, residual 9).
//
// ─── DATES ARE TEXT, DAY COUNTS ARE INTEGERS ───────────────────────────────────────────────────
//
// A date is `YYYY-MM-DD` text, checked by 42c2's `isCalendarDate` and ordered by exact string
// comparison. The plausibility window is integer day arithmetic through 42e1's `nightsBetween`, never
// a JS Date, so no time zone can move a flight across it.

import {
  LOYALTY_SEGMENTS_MAX_PER_MAIL,
  LOYALTY_SEGMENT_PLAUSIBLE_DAYS,
  type LoyaltyFlightKind,
} from '@b8/contracts/loyalty';
import { isCalendarDate, keepSuffix, programNameForm } from './loyaltyRead';
import { nightsBetween, normaliseConfirmationCode } from './loyaltyBooking';

// ─── The cleaned booking ───────────────────────────────────────────────────────────────────────

/** One flight leg in its stored form. Date, carrier and flight number (with the code) are its identity. */
export interface Leg {
  flightDate: string;
  origin: string;
  destination: string;
  carrier: string;
  flightNumber: string;
}

/**
 * One flight mail after the clean pass. With kind `none` every other field is null, `complete` is
 * false, `legs` is empty and `legsVoid` is false. `programName` is the CHECK-ONLY comparison form; it
 * decides the program check and is then thrown away. `legsVoid` says the mail listed legs and at
 * least one was unusable (or there were too many), so `legs` is empty on purpose and must never be
 * read as "no legs listed".
 */
export interface CleanFlight {
  kind: LoyaltyFlightKind;
  suffix: string | null;
  programName: string | null;
  code: string | null;
  award: boolean | null;
  complete: boolean;
  legs: Leg[];
  legsVoid: boolean;
}

const NOTHING: CleanFlight = {
  kind: 'none', suffix: null, programName: null, code: null, award: null, complete: false, legs: [], legsVoid: false,
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The award flag: only the booleans themselves count. A string `"true"`, `"yes"` or a 1 is not stated. */
const cleanAward = (raw: unknown): boolean | null => (raw === true ? true : raw === false ? false : null);

/** An airport code: trimmed, upper-cased, then exactly three letters A to Z. */
function cleanAirport(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/** A carrier code: trimmed, upper-cased, then exactly two characters A to Z or 0 to 9. */
function cleanCarrier(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z0-9]{2}$/.test(code) ? code : null;
}

/**
 * A flight number: every whitespace character removed, upper-cased, then one to four digits and an
 * optional letter. Text, never a number, so a leading zero is part of it and is kept.
 */
function cleanFlightNumber(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const number = raw.replace(/\s/g, '').toUpperCase();
  return /^[0-9]{1,4}[A-Z]?$/.test(number) ? number : null;
}

/** One leg in its stored form, or null when any of its five fields is unusable or the airports agree. */
export function cleanLeg(raw: unknown): Leg | null {
  if (!isPlainObject(raw) || !isCalendarDate(raw.flightDate)) return null;
  const origin = cleanAirport(raw.origin);
  const destination = cleanAirport(raw.destination);
  const carrier = cleanCarrier(raw.carrier);
  const flightNumber = cleanFlightNumber(raw.flightNumber);
  if (origin === null || destination === null || carrier === null || flightNumber === null || origin === destination) return null;
  return { flightDate: raw.flightDate, origin, destination, carrier, flightNumber };
}

/** The identity of a leg within one code (SPEC.md D7): date, carrier and number; never the airports. */
export const legIdentity = (leg: Pick<Leg, 'flightDate' | 'carrier' | 'flightNumber'>): string =>
  `${leg.flightDate}|${leg.carrier}|${leg.flightNumber}`;

/**
 * The legs of one mail, all or nothing. Anything but an array is void (the answer's shape always
 * carries an array, so a missing one is a malformed answer, never "no legs listed"); an empty array
 * is no legs listed. A repeated identity counts once, the first listing kept; more distinct legs than
 * one mail may list is void, never truncated.
 */
function cleanLegs(raw: unknown): { legs: Leg[]; legsVoid: boolean } {
  if (!Array.isArray(raw)) return { legs: [], legsVoid: true };
  const legs: Leg[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const leg = cleanLeg(item);
    if (leg === null) return { legs: [], legsVoid: true };
    const id = legIdentity(leg);
    if (seen.has(id)) continue;
    seen.add(id);
    legs.push(leg);
  }
  return legs.length > LOYALTY_SEGMENTS_MAX_PER_MAIL ? { legs: [], legsVoid: true } : { legs, legsVoid: false };
}

/**
 * THE CLEAN PASS. Reads only the seven named keys of a plain object. Anything that is not a plain
 * object, and any kind but the two flight kinds, is `none` with nothing else kept. `complete` is true
 * only for the boolean `true`: a reminder that lists one flight must not be read as the whole trip.
 */
export function cleanFlight(raw: unknown): CleanFlight {
  if (!isPlainObject(raw) || (raw.kind !== 'flight_booked' && raw.kind !== 'flight_cancelled')) return { ...NOTHING, legs: [] };
  return {
    kind: raw.kind,
    suffix: keepSuffix(raw.memberNumberSuffix),
    programName: programNameForm(raw.programName),
    code: normaliseConfirmationCode(raw.confirmationCode),
    award: cleanAward(raw.award),
    complete: raw.completeItinerary === true,
    ...cleanLegs(raw.segments),
  };
}

/**
 * Whether every leg lies within `LOYALTY_SEGMENT_PLAUSIBLE_DAYS` days of the mail's received date,
 * before or after, both ends inclusive. A leg outside it means the model gave the wrong year (or read
 * some other date), and the mail is stored as nothing. Typed legs never come through here.
 */
export function legsPlausible(receivedOn: string, legs: readonly Leg[]): boolean {
  return legs.every((leg) => Math.abs(nightsBetween(receivedOn, leg.flightDate)) <= LOYALTY_SEGMENT_PLAUSIBLE_DAYS);
}

// ─── Supersession (SPEC.md D8) ─────────────────────────────────────────────────────────────────

export interface FlightStanding {
  state: 'booked' | 'cancelled';
  /** The latest received date over the code's rows' evidence; null when no mail touched any of them. */
  evidenceReceivedOn: string | null;
}

/**
 * The standing of a code's legs as one group: cancelled exactly when there is at least one row and
 * every row is cancelled, else booked; its evidence date the latest of the rows' evidence dates,
 * ignoring rows no mail touched. No rows at all is booked with no evidence, so a first mail applies.
 */
export function flightStanding(rows: readonly { state: 'booked' | 'cancelled'; evidenceReceivedOn: string | null }[]): FlightStanding {
  const state = rows.length > 0 && rows.every((r) => r.state === 'cancelled') ? 'cancelled' : 'booked';
  let evidenceReceivedOn: string | null = null;
  for (const r of rows) {
    if (r.evidenceReceivedOn !== null && (evidenceReceivedOn === null || r.evidenceReceivedOn > evidenceReceivedOn)) evidenceReceivedOn = r.evidenceReceivedOn;
  }
  return { state, evidenceReceivedOn };
}

/**
 * Whether a mail applies to its code's group. 42e1's `supersedes` with A5, for the flight kinds:
 *
 *   a booking, group wholly cancelled → never on its own, whatever the dates: `received_on` is the
 *                                       day the mail reached the inbox, and a re-forward of the
 *                                       original confirmation after a cancellation arrives later
 *                                       than the cancellation. A cancelled flight comes back only by
 *                                       hand (the hold's `place`) or a typed write.
 *   no evidence yet                   → applies.
 *   strictly later mail               → applies.
 *   the same day                      → a cancellation applies; a booking only to a booked group.
 *   earlier mail                      → never applies.
 *
 * `byHand` lifts only the first rule; the date rules still hold for a person's tap.
 */
export function flightSupersedes(
  standing: FlightStanding,
  incoming: { kind: 'flight_booked' | 'flight_cancelled'; receivedOn: string },
  byHand = false
): boolean {
  if (!byHand && standing.state === 'cancelled' && incoming.kind === 'flight_booked') return false;
  if (standing.evidenceReceivedOn === null) return true;
  if (incoming.receivedOn > standing.evidenceReceivedOn) return true;
  if (incoming.receivedOn < standing.evidenceReceivedOn) return false;
  return incoming.kind === 'flight_cancelled' || standing.state === 'booked';
}

// ─── The plan (SPEC.md D7) ─────────────────────────────────────────────────────────────────────

/** A stored leg of the code, with what the plan needs to know about it. */
export interface ExistingLeg extends Leg {
  state: 'booked' | 'cancelled';
  source: 'typed' | 'email';
  /** The row's evidence date; it decides the group's standing. Absent is read as none. */
  evidenceReceivedOn?: string | null;
}

/**
 * What one mail does to its code's legs. Nothing is ever deleted. `insert` rows take the incoming
 * kind's state (booked for a booking, cancelled for a cancellation); `rewrite` and `rebook` carry the
 * mail's airports for a matching identity and leave it booked; `cancel` names rows to cancel.
 */
export interface FlightPlan {
  applies: boolean;
  insert: Leg[];
  rewrite: Leg[];
  cancel: Leg[];
  rebook: Leg[];
}

const plain = (l: Leg): Leg => ({ flightDate: l.flightDate, origin: l.origin, destination: l.destination, carrier: l.carrier, flightNumber: l.flightNumber });

/**
 * THE LEG PLAN for one mail against its code's stored legs:
 *
 *   booked mail   — a listed leg with a booked row is rewritten; with a cancelled row it is left alone
 *                   unless by hand, when it is re-booked; with no row it is inserted booked. Only when
 *                   the mail says the itinerary is complete, every booked row with source `email` that
 *                   is not listed is cancelled: the trip was replaced. A typed row is the person's
 *                   word and is never cancelled by omission.
 *   cancel, legs  — each listed leg with a booked row is cancelled, one with a cancelled row changes
 *                   nothing, one with no row is inserted cancelled (so a late confirmation of it is
 *                   recognised as older). Unlisted legs are untouched.
 *   cancel, none  — every booked row of the code is cancelled; with no rows nothing is planned.
 *
 * When the mail does not supersede the group (D8) nothing applies and every list is empty.
 */
export function planFlight(input: {
  existing: readonly ExistingLeg[];
  incoming: { kind: 'flight_booked' | 'flight_cancelled'; legs: readonly Leg[]; complete: boolean };
  receivedOn: string;
  byHand: boolean;
}): FlightPlan {
  const plan: FlightPlan = { applies: false, insert: [], rewrite: [], cancel: [], rebook: [] };
  const standing = flightStanding(input.existing.map((e) => ({ state: e.state, evidenceReceivedOn: e.evidenceReceivedOn ?? null })));
  if (!flightSupersedes(standing, { kind: input.incoming.kind, receivedOn: input.receivedOn }, input.byHand)) return plan;
  plan.applies = true;
  const byId = new Map(input.existing.map((e) => [legIdentity(e), e] as const));
  const listed = new Set(input.incoming.legs.map(legIdentity));

  if (input.incoming.kind === 'flight_booked') {
    for (const leg of input.incoming.legs) {
      const row = byId.get(legIdentity(leg));
      if (!row) plan.insert.push(plain(leg));
      else if (row.state === 'booked') plan.rewrite.push(plain(leg));
      else if (input.byHand) plan.rebook.push(plain(leg));
    }
    if (input.incoming.complete) {
      for (const row of input.existing) {
        if (row.state === 'booked' && row.source === 'email' && !listed.has(legIdentity(row))) plan.cancel.push(plain(row));
      }
    }
    return plan;
  }

  if (input.incoming.legs.length === 0) {
    for (const row of input.existing) if (row.state === 'booked') plan.cancel.push(plain(row));
    return plan;
  }
  for (const leg of input.incoming.legs) {
    const row = byId.get(legIdentity(leg));
    if (!row) plan.insert.push(plain(leg));
    else if (row.state === 'booked') plan.cancel.push(plain(row));
  }
  return plan;
}

/** Whether a plan changes any row. A plan that applies and changes nothing is `stale`. */
export const planChanges = (plan: FlightPlan): boolean =>
  plan.insert.length + plan.rewrite.length + plan.cancel.length + plan.rebook.length > 0;
