// P8-42e1b — the flights contract (U10–U12): a segment and the flights payload, the typed request and
// the agreement of the contract's leg shapes with the domain's clean pass, and the exports with the
// pinned family around them, each as a table of accepted and refused objects.
//
// THE CONTRACT IS REACHED AS A NAMESPACE (`loyalty.<Name>`), never by named import, and every test
// first asserts that the export it uses exists. So against a contracts file without these exports a
// test fails on that assertion, not on an import error that would stop the whole file from loading.
// The clean pass is reached the same way, for the same reason.
//
// Fabricated data only: ZQ42E codes made of letters and digits, plain airport and carrier fixtures,
// short flight numbers (a four- or five-digit one is built with `repeat`), dates written out.

import { describe, expect, it } from 'vitest';
import * as loyalty from '@b8/contracts/loyalty';
import * as flight from './domain/loyaltyFlight';

type Issue = { message: string };
type Parsed = { success: boolean; data?: unknown; error?: { issues: Issue[] } };
type Schema = { safeParse(v: unknown): Parsed };
/** The named export as a schema, after asserting that it is one. */
function schema(name: string): Schema {
  const s = (loyalty as Record<string, unknown>)[name] as Schema | undefined;
  expect(typeof s?.safeParse, `${name} is exported as a schema`).toBe('function');
  return s as Schema;
}
const accepts = (s: Schema, v: unknown, what: string) => expect(s.safeParse(v).success, `accepts ${what}`).toBe(true);
const refuses = (s: Schema, v: unknown, what: string) => expect(s.safeParse(v).success, `refuses ${what}`).toBe(false);
const exported = (name: string) => (loyalty as Record<string, unknown>)[name];

const SEGMENT = {
  id: 1, membershipId: 2, programId: 3, maskedCode: '••••AB12', flightDate: '2026-03-10', origin: 'JFK', destination: 'LHR',
  carrier: 'ZQ', flightNumber: '412', state: 'booked', source: 'email', award: true,
};
const LEG = { flightDate: '2026-03-10', origin: 'JFK', destination: 'LHR', carrier: 'ZQ', flightNumber: '412' };
const ITEM = {
  id: 9, programId: 3, receivedOn: '2026-03-01', reason: 'unmatched_suffix', maskedSuffix: '••••7K9X', state: 'booked',
  maskedCode: '••••AB12', legs: [LEG], candidateMembershipIds: [],
};
const FLIGHTS = { airlineMembershipIds: [2, 4], upcoming: [SEGMENT], recent: [{ ...SEGMENT, id: 5, flightDate: '2026-02-20' }], queue: [ITEM] };
const BODY = {
  membershipId: 2, confirmationCode: 'zq42e-ab 12', flightDate: '2026-03-10', origin: 'jfk', destination: ' LHR ', carrier: 'zq', flightNumber: '412 a',
  state: 'booked', award: null,
};

describe('the flights contract (P8-42e1b)', () => {
  it('T42e1b-U10: a segment and the flights payload carry a masked code only, booked legs in order, and no count or total', () => {
    const seg = schema('LoyaltySegmentSchema');
    accepts(seg, SEGMENT, 'a full segment');
    accepts(seg, { ...SEGMENT, award: null, source: 'typed', state: 'cancelled' }, 'a segment with nothing stated');
    accepts(seg, { ...SEGMENT, maskedCode: '••••' }, 'a short code masked to bullets');
    accepts(seg, { ...SEGMENT, maskedCode: '••••B12' }, 'a code masked to three');
    for (const [k, v] of [['confirmationCode', 'ZQ42EAB12'], ['code', 'ZQ42EAB12'], ['passengerName', 'ZQ42E Flyer'], ['price', '12'], ['miles', 5], ['time', '09:00']] as const) {
      refuses(seg, { ...SEGMENT, [k]: v }, `the extra key ${k}`);
    }
    for (const masked of ['ZQ42EAB12', '••••ZQ42EA', '••••AB', '••AB12', 'ZQ42EA']) refuses(seg, { ...SEGMENT, maskedCode: masked }, `the code ${masked}`);
    for (const [k, v] of [['origin', 'jfk'], ['origin', 'JF'], ['destination', 'LH1'], ['carrier', 'Z'], ['carrier', 'zq'], ['flightNumber', '4'.repeat(5)],
      ['flightNumber', 'AB'], ['flightNumber', '412a'], ['flightDate', '2026-02-30'], ['state', 'maybe'], ['source', 'import']] as const) {
      refuses(seg, { ...SEGMENT, [k]: v }, `${k} ${v}`);
    }
    refuses(seg, { ...SEGMENT, destination: 'JFK' }, 'equal airports');

    const flights = schema('LoyaltyFlightsSchema');
    accepts(flights, FLIGHTS, 'a full payload');
    accepts(flights, { airlineMembershipIds: [], upcoming: [], recent: [], queue: [] }, 'an empty payload');
    for (const k of ['airlineMembershipIds', 'upcoming', 'recent', 'queue']) refuses(flights, { ...FLIGHTS, [k]: null }, `a null ${k}`);
    refuses(flights, { ...FLIGHTS, airlineMembershipIds: [2, 2] }, 'a repeated membership');
    refuses(flights, { ...FLIGHTS, airlineMembershipIds: [4, 2] }, 'descending memberships');
    refuses(flights, { ...FLIGHTS, upcoming: [{ ...SEGMENT, state: 'cancelled' }] }, 'a cancelled upcoming segment');
    refuses(flights, { ...FLIGHTS, recent: [{ ...SEGMENT, state: 'cancelled' }] }, 'a cancelled recent segment');
    refuses(flights, { ...FLIGHTS, upcoming: [{ ...SEGMENT, flightDate: '2026-03-11' }, SEGMENT] }, 'upcoming out of date order');
    refuses(flights, { ...FLIGHTS, upcoming: [{ ...SEGMENT, id: 7 }, SEGMENT] }, 'upcoming out of id order');
    accepts(flights, { ...FLIGHTS, upcoming: [SEGMENT, { ...SEGMENT, id: 7 }] }, 'upcoming with equal dates by id');
    refuses(flights, { ...FLIGHTS, recent: [{ ...SEGMENT, flightDate: '2026-02-01' }, { ...SEGMENT, id: 6, flightDate: '2026-02-20' }] }, 'recent ascending');
    refuses(flights, { ...FLIGHTS, recent: [{ ...SEGMENT, id: 7 }, SEGMENT] }, 'recent ties out of id order');
    refuses(flights, { ...FLIGHTS, queue: Array.from({ length: loyalty.LOYALTY_READ_QUEUE_LIMIT + 1 }, (_, i) => ({ ...ITEM, id: 1000 - i })) }, 'a queue over the limit');
    refuses(flights, { ...FLIGHTS, queue: [ITEM, { ...ITEM, id: 10 }] }, 'an unordered queue');
    for (const k of ['count', 'total', 'miles', 'year', 'nights']) refuses(flights, { ...FLIGHTS, [k]: 1 }, `the extra key ${k}`);

    const item = schema('LoyaltyFlightQueueItemSchema');
    accepts(item, ITEM, 'a held booking');
    accepts(item, { ...ITEM, state: 'cancelled', legs: [] }, 'a held cancellation of the whole code');
    accepts(item, { ...ITEM, reason: 'no_suffix', maskedSuffix: null }, 'a held booking with no suffix');
    refuses(item, { ...ITEM, legs: [] }, 'a booked item with no leg');
    refuses(item, { ...ITEM, legs: Array.from({ length: 13 }, (_, i) => ({ ...LEG, flightNumber: String(100 + i) })) }, 'thirteen legs');
    refuses(item, { ...ITEM, candidateMembershipIds: [4, 2] }, 'candidates not ascending');
    refuses(item, { ...ITEM, maskedSuffix: null }, 'a suffix reason with no suffix');
    refuses(item, { ...ITEM, reason: 'no_suffix' }, 'no_suffix with a suffix');
    refuses(item, { ...ITEM, code: 'ZQ42EAB12' }, 'a full code');
  });

  it('T42e1b-U11: the typed request is strict and echoes nothing, and the contract\'s leg shapes give the clean pass\'s answers', () => {
    const req = schema('LoyaltySegmentCreateRequestSchema');
    const ok = req.safeParse(BODY);
    expect(ok.success).toBe(true);
    expect(ok.data).toMatchObject({ origin: 'JFK', destination: 'LHR', carrier: 'ZQ', flightNumber: '412A' });
    const refusals: [string, unknown][] = [
      ['source', { ...BODY, source: 'typed' }],
      ['id', { ...BODY, id: 1 }],
      ['nights', { ...BODY, nights: 2 }],
      ['an extra key', { ...BODY, seat: 'ZQ42E-SEAT-CANARY' }],
      ['a short code', { ...BODY, confirmationCode: 'Z-Q4' }],
      ['a long code', { ...BODY, confirmationCode: 'ZQ42E'.repeat(5) }],
      ['equal airports', { ...BODY, destination: 'JFK' }],
      ['a bad date', { ...BODY, flightDate: 'ZQ42E-DATE-CANARY' }],
      ['five digits', { ...BODY, flightNumber: '4'.repeat(5) }],
      ['a bad state', { ...BODY, state: 'ZQ42E-STATE-CANARY' }],
      ['a non-boolean award', { ...BODY, award: 'yes' }],
      ['a bad airport', { ...BODY, origin: 'ZQ42E-AIRPORT-CANARY' }],
    ];
    for (const key of Object.keys(BODY)) {
      const missing: Record<string, unknown> = { ...BODY };
      delete missing[key];
      refusals.push([`no ${key}`, missing]);
    }
    for (const [what, body] of refusals) {
      const r = req.safeParse(body);
      expect(r.success, what).toBe(false);
      const message = r.error?.issues[0]?.message ?? '';
      for (const value of ['ZQ42E-SEAT-CANARY', 'ZQ42E-DATE-CANARY', 'ZQ42E-STATE-CANARY', 'ZQ42E-AIRPORT-CANARY', 'Z-Q4', 'ZQ42EZQ42E', '4'.repeat(5)]) {
        expect(message, what).not.toContain(value);
      }
    }

    // The leg shapes: for each row, the contract and the clean pass agree on validity and on the value.
    expect(typeof (flight as Record<string, unknown>).cleanFlight, 'cleanFlight is exported').toBe('function');
    const legSchema = schema('LoyaltyFlightLegSchema');
    const rows: Record<string, unknown>[] = [
      LEG,
      { ...LEG, origin: 'jfk', destination: ' lhr ', carrier: ' z9 ', flightNumber: '412 a' },
      { ...LEG, flightNumber: '007' },
      { ...LEG, flightNumber: '1'.repeat(4) },
      { ...LEG, flightNumber: ` ${'1'.repeat(2)} ${'2'.repeat(2)}b ` },
      { ...LEG, flightNumber: '\t41\n2' },
      { ...LEG, flightNumber: '4'.repeat(5) },
      { ...LEG, flightNumber: 'AB' },
      { ...LEG, flightNumber: '' },
      { ...LEG, flightNumber: 'A12' },
      { ...LEG, flightNumber: 412 },
      { ...LEG, origin: 'JF' },
      { ...LEG, origin: 'JFKX' },
      { ...LEG, origin: ' jfk ' },
      { ...LEG, origin: 'J F K' },
      { ...LEG, destination: 'jfk' },
      { ...LEG, carrier: 'Z' },
      { ...LEG, carrier: 'ZQ4' },
      { ...LEG, carrier: 'z q' },
      { ...LEG, flightDate: '2026-02-30' },
      { ...LEG, flightDate: '2024-02-29' },
      { ...LEG, flightDate: '2026-03-10T09:00' },
      { ...LEG, flightDate: null },
      { ...LEG, seat: '12A' },
    ];
    for (const leg of rows) {
      const contract = legSchema.safeParse(leg);
      const cleaned = flight.cleanFlight({ kind: 'flight_booked', confirmationCode: 'ZQ42EAB12', segments: [leg] });
      // A leg with an extra key is refused by the strict schema; the clean pass ignores the key and keeps
      // only the five, so for that row only the five-key value is compared.
      const extra = Object.keys(leg).some((k) => !Object.keys(LEG).includes(k));
      if (extra) {
        expect(contract.success, JSON.stringify(leg)).toBe(false);
        expect(cleaned.legs, JSON.stringify(leg)).toEqual([LEG]);
        continue;
      }
      expect(!cleaned.legsVoid, JSON.stringify(leg)).toBe(contract.success);
      if (contract.success) expect(cleaned.legs, JSON.stringify(leg)).toEqual([contract.data]);
    }

    // The hold route reuses the 42e1 request: a place needs a membership id.
    const resolve = schema('LoyaltyBookingResolveRequestSchema');
    accepts(resolve, { action: 'place', membershipId: 2 }, 'a place');
    refuses(resolve, { action: 'place' }, 'a place without a membership');
    accepts(resolve, { action: 'not_mine' }, 'not mine');
    accepts(resolve, { action: 'ignore' }, 'ignore');
  });

  it('T42e1b-U12: every new export is present and the pinned family around it is unchanged', () => {
    for (const name of ['LoyaltyFlightKindSchema', 'LoyaltyFlightLegSchema', 'LoyaltySegmentSchema', 'LoyaltySegmentCreateRequestSchema',
      'LoyaltyFlightQueueItemSchema', 'LoyaltyFlightsSchema', 'LoyaltySegmentResponseSchema']) schema(name);
    expect(exported('LOYALTY_FLIGHT_KINDS'), 'LOYALTY_FLIGHT_KINDS').toEqual(['flight_booked', 'flight_cancelled', 'none']);
    expect([exported('LOYALTY_SEGMENTS_MAX_PER_MAIL'), exported('LOYALTY_SEGMENT_RECENT_DAYS'), exported('LOYALTY_SEGMENT_PLAUSIBLE_DAYS')]).toEqual([12, 30, 366]);
    const kind = schema('LoyaltyFlightKindSchema');
    for (const k of ['flight_booked', 'flight_cancelled', 'none']) accepts(kind, k, k);
    for (const k of ['flight', 'hotel_booked']) refuses(kind, k, k);
    // The one new response wrapper.
    const response = schema('LoyaltySegmentResponseSchema');
    accepts(response, { success: true, data: SEGMENT }, 'a success');
    accepts(response, { success: false, error: { code: 'NOT_FOUND', message: 'No such record.' } }, 'a failure');
    refuses(response, { success: true, data: { ...SEGMENT, confirmationCode: 'ZQ42EAB12' } }, 'a success with a full code');
    // The family around it.
    expect((loyalty.LoyaltyErrorCodeSchema as unknown as { options: string[] }).options).toEqual([
      'INVALID_INPUT', 'NOT_FOUND', 'INSUFFICIENT_SCOPE', 'BROWSER_SESSION_REQUIRED', 'MEMBERSHIP_EXISTS', 'ALIAS_TAKEN',
      'MEMBER_NAME_TAKEN', 'MEMBER_USER_TAKEN', 'CARD_ALREADY_LINKED', 'DOMAIN_TAKEN', 'ADDRESS_TAKEN', 'ITEM_RESOLVED',
    ]);
    expect(loyalty.LOYALTY_BOOKING_KINDS).toEqual(['hotel_booked', 'hotel_cancelled', 'flight', 'none']);
    expect(loyalty.LOYALTY_OBSERVATION_SOURCES).toEqual(['typed', 'import', 'email', 'screenshot']);
    const responses = Object.keys(loyalty).filter((k) => k.endsWith('ResponseSchema')).sort();
    expect(responses).toEqual([
      'LoyaltyBookingResolveResponseSchema', 'LoyaltyInboxPollResponseSchema', 'LoyaltyInboxReadResponseSchema', 'LoyaltyInboxResolveResponseSchema',
      'LoyaltyInstrumentResponseSchema', 'LoyaltyMemberNumberResponseSchema', 'LoyaltyMemberResponseSchema', 'LoyaltyMembershipResponseSchema',
      'LoyaltyOverviewResponseSchema', 'LoyaltyProgramResponseSchema', 'LoyaltyScreenshotReadResponseSchema', 'LoyaltySegmentResponseSchema',
      'LoyaltyStayResponseSchema',
    ]);
  });
});
