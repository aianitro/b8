// Hotel stays (P8-42e1) — the pure rules that turn what Claude proposed about one hotel mail into a
// booking, and a booking into a decision: the clean pass, the confirmation code's normal form, the
// night count, the attribution order (SPEC.md D9) and the supersession rule (D8). No database, no SDK,
// no `mailparser`, no `next`, no clock: the booking pass (`lib/loyaltyBookingRead.ts`) and the typed
// store (`lib/loyaltyBookingStore.ts`) read rows, ask these functions, and perform what they decided.
//
// ─── THE MODEL ONLY PROPOSES ──────────────────────────────────────────────────────────────────
//
// The booking read is the balance read's sibling, and its output is trusted exactly as little:
// `cleanBooking` reads only its six booking keys and two attribution keys by name, keeps a field only
// when it is one of a closed set of forms (an enum, a calendar date, a 4 to 20 character code, a
// bounded property name, a boolean) and nulls everything else. A key the model added (a guest's
// name, an address, a phone number, card digits, a total) is never looked at, so it cannot survive.
// The one free-text value kept is the property name, and it is bounded here exactly as the column's
// CHECK bounds it, so a placed booking can never fail on its property.
//
// ─── SUFFIX AND PROGRAM: 42c2'S RULES, IMPORTED ───────────────────────────────────────────────
//
// The printed member-number suffix goes through 42c2's `keepSuffix`, the program name through its
// `programNameForm`, and the attribution decision consumes `programCheck` and `matchSuffix` results.
// None is re-implemented here: a second suffix rule would be a second place for the two reads to
// disagree about whose mail it is.
//
// ─── DATES ARE TEXT, NIGHTS ARE INTEGERS ──────────────────────────────────────────────────────
//
// A date is `YYYY-MM-DD` text, checked by 42c2's `isCalendarDate` and ordered by exact string
// comparison. The night count is integer arithmetic on the date parts (days from civil), never a JS
// Date, so no time zone can move it; it is the same algorithm the contracts use privately to refine
// a stay's `nights` (SPEC.md A2), and the database derives the stored figure on its own.

import {
  LOYALTY_BOOKING_KINDS,
  LOYALTY_STAY_MAX_NIGHTS,
  type LoyaltyBookingHoldReason,
  type LoyaltyBookingKind,
  type LoyaltyReadProgramCheck,
} from '@b8/contracts/loyalty';
import { isCalendarDate, keepSuffix, programNameForm, type SuffixMatch } from './loyaltyRead';

// ─── The cleaned booking ───────────────────────────────────────────────────────────────────────

/**
 * One booking read after the clean pass. With a kind other than the two hotel kinds every other
 * field is null: a flight is recorded and nothing is extracted from it (flights are a later step),
 * and `none` is not a booking. `programName` is the CHECK-ONLY comparison form; it decides the
 * program check and is then thrown away. `checkIn` and `checkOut` are both null or both set, and
 * when set the check-out is strictly after the check-in and at most the maximum nights later.
 */
export interface CleanBooking {
  kind: LoyaltyBookingKind;
  suffix: string | null;
  programName: string | null;
  property: string | null;
  checkIn: string | null;
  checkOut: string | null;
  code: string | null;
  award: boolean | null;
}

const NOTHING: Omit<CleanBooking, 'kind'> = {
  suffix: null, programName: null, property: null, checkIn: null, checkOut: null, code: null, award: null,
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isBookingKind = (v: unknown): v is LoyaltyBookingKind =>
  typeof v === 'string' && (LOYALTY_BOOKING_KINDS as readonly string[]).includes(v);

/**
 * A confirmation code's normal form: every character that is not an ASCII letter or digit dropped
 * FIRST (spaces, dashes, and any non-ASCII letter, so an accented letter can never upper-case into
 * an ASCII one and create a match), then upper-cased. Valid with 4 to 20 characters; anything else,
 * and anything that is not a string, is null. Two spellings differing only in case, spaces or dashes
 * are therefore one code, and one row under the table's UNIQUE (program, code).
 */
export function normaliseConfirmationCode(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const code = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return code.length >= 4 && code.length <= 20 ? code : null;
}

/**
 * The day number of a calendar date written `YYYY-MM-DD` (already checked by `isCalendarDate`): days
 * from civil in the proleptic Gregorian calendar, by integer arithmetic on the parts. The shift to a
 * March-based year puts the leap day last, so February's length never enters the sum.
 */
function dayNumber(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
}

/**
 * Whole nights from `checkIn` to `checkOut`, two calendar dates: the difference of their day
 * numbers. Never a Date object, so the answer is the same in every time zone; the database's
 * `check_out - check_in` is the stored figure and this one must always equal it.
 */
export function nightsBetween(checkIn: string, checkOut: string): number {
  return dayNumber(checkOut) - dayNumber(checkIn);
}

/** The property column's forbidden characters: angle brackets and every control character. */
const PROPERTY_FORBIDDEN = new RegExp('[<>\\p{Cc}]', 'u');
const PROPERTY_MAX = 80;

/**
 * A property name as stored, or null. Refused outright (never repaired) when it holds `<`, `>` or a
 * control character, newlines and tabs included; otherwise every run of whitespace becomes one space
 * and the ends are trimmed, and it is kept only with 1 to 80 characters. A longer name is null, never
 * cut: half a hotel's name is a different hotel.
 */
export function cleanProperty(raw: unknown): string | null {
  if (typeof raw !== 'string' || PROPERTY_FORBIDDEN.test(raw)) return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  const length = Array.from(text).length;
  return length >= 1 && length <= PROPERTY_MAX ? text : null;
}

/** The award flag: only the booleans themselves count. A string `"true"`, `"yes"` or a 1 is not stated. */
const cleanAward = (raw: unknown): boolean | null => (raw === true ? true : raw === false ? false : null);

/**
 * The two dates of a stay, or both null: each must be a real calendar date, the check-out strictly
 * after the check-in, and the stay at most `LOYALTY_STAY_MAX_NIGHTS` long. One bad date voids both,
 * because a stay with one end is no stay.
 */
function cleanDates(checkIn: unknown, checkOut: unknown): { checkIn: string | null; checkOut: string | null } {
  if (!isCalendarDate(checkIn) || !isCalendarDate(checkOut) || checkOut <= checkIn) return { checkIn: null, checkOut: null };
  return nightsBetween(checkIn, checkOut) <= LOYALTY_STAY_MAX_NIGHTS ? { checkIn, checkOut } : { checkIn: null, checkOut: null };
}

/**
 * THE CLEAN PASS. Reads only the eight named keys of a plain object. Anything that is not a plain
 * object, and any kind outside the four, is `none` with every other field null; a `flight` or `none`
 * keeps nothing else either.
 */
export function cleanBooking(raw: unknown): CleanBooking {
  if (!isPlainObject(raw) || !isBookingKind(raw.kind)) return { kind: 'none', ...NOTHING };
  if (raw.kind !== 'hotel_booked' && raw.kind !== 'hotel_cancelled') return { kind: raw.kind, ...NOTHING };
  return {
    kind: raw.kind,
    suffix: keepSuffix(raw.memberNumberSuffix),
    programName: programNameForm(raw.programName),
    property: cleanProperty(raw.property),
    ...cleanDates(raw.checkIn, raw.checkOut),
    code: normaliseConfirmationCode(raw.confirmationCode),
    award: cleanAward(raw.award),
  };
}

// ─── Attribution (SPEC.md D9) ──────────────────────────────────────────────────────────────────

export interface PlaceInput {
  /** 42c2's `programCheck` of the stated program name against the message's program. */
  programCheck: LoyaltyReadProgramCheck;
  /** The kept suffix, or null when the mail printed none usable. */
  suffix: string | null;
  /** 42c2's `matchSuffix` result for that suffix; null exactly when `suffix` is null. */
  match: SuffixMatch | null;
  /**
   * The forwarder's membership in this program: set only when 42c1's poll attributed the message to
   * a household member (`matched`) and that member holds a membership of the program.
   */
  forwarderMembershipId: number | null;
  /** Whether (program, suffix) is on `loyalty_inbox_not_mine`. */
  notMine: boolean;
}

export type PlaceDecision =
  | { kind: 'place'; membershipId: number }
  | { kind: 'hold'; reason: LoyaltyBookingHoldReason }
  | { kind: 'discard' };

/**
 * THE ATTRIBUTION ORDER, the first rule that fires deciding:
 *
 *   1. the mail names another program            → hold `program_mismatch`.
 *   2. a printed suffix with one matching membership M: the forwarder's membership F, when there is
 *      one, must BE M (else hold `forwarder_conflict`, and neither is chosen); then place on M.
 *      A suffix matching nothing: discarded when the household said it is not theirs, else hold
 *      `unmatched_suffix` (the forwarder alone never places a mail that printed a number). A suffix
 *      matching several: hold `ambiguous_suffix`, forwarder or not (a forwarder never breaks an
 *      ambiguity, and neither does order).
 *   3. no suffix: place on F when there is one, else hold `no_suffix`.
 *
 * Rule 3's forwarder is the one addition to 42c2's order: a confirmation often prints no member
 * number at all, so a forwarder the poll already attributed is enough when nothing contradicts it.
 */
export function placeBooking(input: PlaceInput): PlaceDecision {
  if (input.programCheck === 'mismatch') return { kind: 'hold', reason: 'program_mismatch' };
  const forwarder = input.forwarderMembershipId;
  if (input.suffix !== null && input.match !== null) {
    if (input.match.kind === 'unique') {
      if (forwarder !== null && forwarder !== input.match.membershipId) return { kind: 'hold', reason: 'forwarder_conflict' };
      return { kind: 'place', membershipId: input.match.membershipId };
    }
    if (input.match.kind === 'ambiguous') return { kind: 'hold', reason: 'ambiguous_suffix' };
    return input.notMine ? { kind: 'discard' } : { kind: 'hold', reason: 'unmatched_suffix' };
  }
  return forwarder !== null ? { kind: 'place', membershipId: forwarder } : { kind: 'hold', reason: 'no_suffix' };
}

// ─── Supersession (SPEC.md D8) ─────────────────────────────────────────────────────────────────

export interface StayStanding {
  state: 'booked' | 'cancelled';
  /** The received date of the mail that last decided the stay; null for a stay no mail touched. */
  evidenceReceivedOn: string | null;
}

export interface IncomingMail {
  kind: 'hotel_booked' | 'hotel_cancelled';
  receivedOn: string;
}

/**
 * Whether a mail applies to an existing stay. Arrival order is not event order, so the mail's own
 * received date decides, against the date of the evidence the stay already reflects, with one rule
 * above the dates (SPEC.md A5):
 *
 *   a booking, cancelled stay → never applies on its own, whatever the dates. `received_on` is the
 *                               day the message reached the loyalty inbox, and hotel mail arrives by
 *                               forwarding, so a re-forward of the ORIGINAL confirmation after a
 *                               cancellation carries a later date than the cancellation. Trusting it
 *                               would revive a stay that was cancelled. A genuinely re-made booking
 *                               normally has a new code and becomes a new stay; an old code comes
 *                               back only by hand.
 *   no evidence yet         → applies (a typed stay no mail touched yields to the first mail).
 *   strictly later mail     → applies.
 *   the same day            → a cancellation applies; a booking applies only to a booked stay.
 *   earlier mail            → never applies.
 *
 * `byHand` is the hold's `place` action (D10): a person has looked at this booking and chosen it, so
 * it may re-book a cancelled stay. The date rules still hold for it. A typed write (D12) does not come
 * through here at all, and it keeps the evidence date, so the same rules protect a correction from
 * older mail.
 */
export function supersedes(existing: StayStanding, incoming: IncomingMail, byHand = false): boolean {
  if (!byHand && existing.state === 'cancelled' && incoming.kind === 'hotel_booked') return false;
  if (existing.evidenceReceivedOn === null) return true;
  if (incoming.receivedOn > existing.evidenceReceivedOn) return true;
  if (incoming.receivedOn < existing.evidenceReceivedOn) return false;
  return incoming.kind === 'hotel_cancelled' || existing.state === 'booked';
}
