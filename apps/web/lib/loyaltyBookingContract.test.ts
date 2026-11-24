// P8-42e1 — the stays contract (U11–U13): the stay and the bookings payload, the two requests, and the
// exports with the pinned family around them, each as a table of accepted and refused objects.
//
// THE CONTRACT IS REACHED AS A NAMESPACE (`loyalty.<Name>`), never by named import, and every test
// first asserts that the export it uses exists. So against a contracts file without these exports a
// test fails on that assertion, not on an import error that would stop the whole file from loading.
//
// Fabricated data only: ZQ42E codes made of letters and digits, small whole night counts, dates
// written out.

import { describe, expect, it } from 'vitest';
import * as loyalty from '@b8/contracts/loyalty';

type Schema = { safeParse(v: unknown): { success: boolean; error?: { issues: { message: string }[] } } };
/** The named export as a schema, after asserting that it is one. */
function schema(name: string): Schema {
  const s = (loyalty as Record<string, unknown>)[name] as Schema | undefined;
  expect(typeof s?.safeParse, `${name} is exported as a schema`).toBe('function');
  return s as Schema;
}
const accepts = (s: Schema, v: unknown, what: string) => expect(s.safeParse(v).success, `accepts ${what}`).toBe(true);
const refuses = (s: Schema, v: unknown, what: string) => expect(s.safeParse(v).success, `refuses ${what}`).toBe(false);
const exported = (name: string) => (loyalty as Record<string, unknown>)[name];

const STAY = {
  id: 1, membershipId: 2, programId: 3, property: 'ZQ42E Harbour Inn', maskedCode: '••••AB12',
  checkIn: '2026-03-10', checkOut: '2026-03-12', nights: 2, state: 'booked', source: 'email', award: false,
};
const ITEM = {
  id: 9, programId: 3, receivedOn: '2026-03-01', reason: 'unmatched_suffix', maskedSuffix: '••••7K9X', property: null,
  checkIn: '2026-03-10', checkOut: '2026-03-12', maskedCode: '••••AB12', state: 'booked', candidateMembershipIds: [],
};
const BOOKINGS = { year: 2026, nights: [{ membershipId: 2, nightsThisYear: 2 }, { membershipId: 4, nightsThisYear: null }], upcoming: [], completed: [STAY], queue: [ITEM] };
const BODY = {
  membershipId: 2, confirmationCode: 'zq42e-ab 12', checkIn: '2026-03-10', checkOut: '2026-03-12', property: 'ZQ42E Harbour Inn', state: 'booked', award: null,
};

describe('the stays contract (P8-42e1)', () => {
  it('T42e1-U11: a stay and the bookings payload carry a masked code only, nights that match the dates, and null rather than zero', () => {
    const stay = schema('LoyaltyStaySchema');
    accepts(stay, STAY, 'a full stay');
    accepts(stay, { ...STAY, property: null, award: null, source: 'typed', state: 'cancelled' }, 'a stay with nothing stated');
    accepts(stay, { ...STAY, maskedCode: '••••' }, 'a short code masked to bullets');
    accepts(stay, { ...STAY, maskedCode: '••••B12' }, 'a code masked to three');
    for (const [k, v] of [['confirmationCode', 'ZQ42EAB12'], ['code', 'ZQ42EAB12'], ['guestName', 'ZQ42E Guest'], ['price', '12']] as const) {
      refuses(stay, { ...STAY, [k]: v }, `the extra key ${k}`);
    }
    refuses(stay, { ...STAY, source: 'x' }, 'an unknown source');
    for (const masked of ['ZQ42EAB12', '••••ZQ42EA', '••••AB', '••AB12', 'ZQ42EA']) refuses(stay, { ...STAY, maskedCode: masked }, `the code ${masked}`);
    refuses(stay, { ...STAY, nights: 3 }, 'nights that are not the dates');
    refuses(stay, { ...STAY, state: 'maybe' }, 'a third state');
    refuses(stay, { ...STAY, checkOut: '2026-05-10', nights: 61 }, 'more than the maximum nights');

    const bookings = schema('LoyaltyBookingsSchema');
    accepts(bookings, BOOKINGS, 'a full payload');
    accepts(bookings, { year: 2026, nights: [], upcoming: [], completed: [], queue: [] }, 'an empty payload');
    refuses(bookings, { ...BOOKINGS, upcoming: null }, 'a null list');
    refuses(bookings, { ...BOOKINGS, nights: [{ membershipId: 4, nightsThisYear: 1 }, { membershipId: 2, nightsThisYear: 1 }] }, 'descending memberships');
    refuses(bookings, { ...BOOKINGS, nights: [{ membershipId: 2, nightsThisYear: 1 }, { membershipId: 2, nightsThisYear: 1 }] }, 'a repeated membership');
    for (const n of [0, -1, 1.5]) refuses(bookings, { ...BOOKINGS, nights: [{ membershipId: 2, nightsThisYear: n }] }, `nightsThisYear ${n}`);
    const limit = exported('LOYALTY_READ_QUEUE_LIMIT') as number;
    const many = Array.from({ length: limit + 1 }, (_, i) => ({ ...ITEM, id: limit + 1 - i }));
    accepts(bookings, { ...BOOKINGS, queue: many.slice(1) }, 'a queue at the limit');
    refuses(bookings, { ...BOOKINGS, queue: many }, 'a queue beyond the limit');
    refuses(bookings, { ...BOOKINGS, queue: [{ ...ITEM, id: 1 }, { ...ITEM, id: 2 }] }, 'a queue in ascending order');
    refuses(bookings, { ...BOOKINGS, queue: [{ ...ITEM, receivedOn: '2026-02-01', id: 2 }, { ...ITEM, receivedOn: '2026-03-01', id: 1 }] }, 'older first');
    refuses(bookings, { ...BOOKINGS, queue: [{ ...ITEM, candidateMembershipIds: [5, 4] }] }, 'candidates descending');
    refuses(bookings, { ...BOOKINGS, completed: [{ ...STAY, state: 'cancelled' }] }, 'a cancelled completed stay');
    refuses(bookings, { ...BOOKINGS, upcoming: [{ ...STAY, state: 'cancelled' }] }, 'a cancelled upcoming stay');
  });

  it('T42e1-U12: the typed request refuses a client-chosen source or nights and every bad value, and its messages echo nothing', () => {
    const body = schema('LoyaltyStayCreateRequestSchema');
    accepts(body, BODY, 'a valid body');
    accepts(body, { ...BODY, property: null, award: true, state: 'cancelled' }, 'a cancellation with nothing stated');
    const bad: [string, unknown][] = [
      ['source', { ...BODY, source: 'email' }],
      ['nights', { ...BODY, nights: 2 }],
      ['id', { ...BODY, id: 1 }],
      ['an extra key', { ...BODY, note: 'ZQ42E' }],
      ['a missing key', (({ award: _award, ...rest }) => rest)(BODY)],
      ['a short code', { ...BODY, confirmationCode: 'zq-4' }],
      ['a long code', { ...BODY, confirmationCode: 'ZQ42EABCDEFGHJKLMNPQR' }],
      ['a code of punctuation', { ...BODY, confirmationCode: '-- --' }],
      ['check-out not after check-in', { ...BODY, checkOut: '2026-03-10' }],
      ['check-out before check-in', { ...BODY, checkOut: '2026-03-09' }],
      ['more than the maximum nights', { ...BODY, checkIn: '2026-01-01', checkOut: '2026-03-03' }],
      ['a bad calendar date', { ...BODY, checkIn: '2026-02-30' }],
      ['a third state', { ...BODY, state: 'maybe' }],
      ['an award string', { ...BODY, award: 'true' }],
      ['markup in the property', { ...BODY, property: '<b>ZQ42E</b>' }],
    ];
    for (const [what, value] of bad) {
      const r = body.safeParse(value);
      expect(r.success, `refuses ${what}`).toBe(false);
      const message = r.error?.issues[0]?.message ?? '';
      for (const echo of ['zq42e', 'ZQ42E', '2026-0', '<b>']) expect(message, `${what} echoes`).not.toContain(echo);
    }
    accepts(body, { ...BODY, checkIn: '2026-01-01', checkOut: '2026-03-02' }, 'exactly the maximum nights');

    const resolve = schema('LoyaltyBookingResolveRequestSchema');
    accepts(resolve, { action: 'place', membershipId: 2 }, 'place with a membership');
    accepts(resolve, { action: 'not_mine' }, 'not mine');
    accepts(resolve, { action: 'ignore' }, 'ignore');
    refuses(resolve, { action: 'place' }, 'place without a membership');
    refuses(resolve, { action: 'place', membershipId: 1.5 }, 'place with a fractional id');
    refuses(resolve, { action: 'place', membershipId: '2' }, 'place with a text id');
    refuses(resolve, { action: 'ignore', membershipId: 2 }, 'ignore with a membership');
    refuses(resolve, { action: 'not_mine', membershipId: 2 }, 'not mine with a membership');
    refuses(resolve, { action: 'apply', membershipId: 2 }, 'the balance queue\'s action');
  });

  it('T42e1-U13: every new export is present with its pinned values, the envelopes parse, and the error codes are the twelve of before', () => {
    for (const name of ['LoyaltyStaySchema', 'LoyaltyStayCreateRequestSchema', 'LoyaltyBookingQueueItemSchema', 'LoyaltyBookingNightsSchema',
      'LoyaltyBookingsSchema', 'LoyaltyBookingResolveRequestSchema', 'LoyaltyBookingResolveSchema', 'LoyaltyStayResponseSchema',
      'LoyaltyBookingResolveResponseSchema']) schema(name);
    expect(exported('LOYALTY_BOOKING_KINDS')).toEqual(['hotel_booked', 'hotel_cancelled', 'flight', 'none']);
    expect(exported('LOYALTY_BOOKING_HOLD_REASONS')).toEqual(['no_suffix', 'unmatched_suffix', 'ambiguous_suffix', 'forwarder_conflict', 'program_mismatch']);
    expect(exported('LOYALTY_BOOKING_ACTIONS')).toEqual(['place', 'not_mine', 'ignore']);
    expect(exported('LOYALTY_STAY_STATES')).toEqual(['booked', 'cancelled']);
    expect(exported('LOYALTY_STAY_SOURCES')).toEqual(['typed', 'email']);
    expect(exported('LOYALTY_STAY_MAX_NIGHTS')).toBe(60);
    expect(Number.isInteger(exported('LOYALTY_STAY_MAX_NIGHTS'))).toBe(true);

    const stayResponse = schema('LoyaltyStayResponseSchema');
    accepts(stayResponse, { success: true, data: STAY }, 'a stay envelope');
    accepts(stayResponse, { success: false, error: { code: 'INVALID_INPUT', message: 'The request is not valid.' } }, 'a failure envelope');
    refuses(stayResponse, { success: true, data: { ...STAY, maskedCode: 'ZQ42EAB12' } }, 'a full code in an envelope');
    const resolveResponse = schema('LoyaltyBookingResolveResponseSchema');
    for (const state of ['placed_by_hand', 'not_mine', 'ignored']) accepts(resolveResponse, { success: true, data: { id: 9, state } }, state);
    refuses(resolveResponse, { success: true, data: { id: 9, state: 'pending' } }, 'a pending answer');
    accepts(resolveResponse, { success: false, error: { code: 'ITEM_RESOLVED', message: 'That item has already been resolved.' } }, 'a failure envelope');

    const codes = (exported('LoyaltyErrorCodeSchema') as { options: string[] }).options;
    expect(codes).toEqual(['INVALID_INPUT', 'NOT_FOUND', 'INSUFFICIENT_SCOPE', 'BROWSER_SESSION_REQUIRED', 'MEMBERSHIP_EXISTS', 'ALIAS_TAKEN',
      'MEMBER_NAME_TAKEN', 'MEMBER_USER_TAKEN', 'CARD_ALREADY_LINKED', 'DOMAIN_TAKEN', 'ADDRESS_TAKEN', 'ITEM_RESOLVED']);
    expect(exported('LOYALTY_OBSERVATION_SOURCES')).toEqual(['typed', 'import', 'email', 'screenshot']);
  });
});
