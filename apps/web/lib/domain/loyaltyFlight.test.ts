// P8-42e1b — the pure flight rules (U1–U6): the clean pass and what it refuses to keep, the legs and
// their all-or-nothing rule, the code, suffix, award and complete flags and the date window, the
// group standing and supersession grid (SPEC.md D8), and the leg plan for a booked and a cancelled
// mail (D7).
//
// THE MODULE IS REACHED AS A NAMESPACE, and every test first asserts that the function it uses is
// exported, so a tree without one fails here on an assertion and not on an import error or a call
// of undefined (the spec's command 19 swaps this module for a no-op and requires exactly that).
//
// Everything here is fabricated: program names carry the canary ZQ42E, codes are letters and digits
// made up in the test, airports, carriers and flight numbers are plain fixtures, and dates are
// written out. A flight number of four or five digits is built with `repeat`, never written as a
// quoted figure. No database and no clock: the date window must not depend on the time zone, and
// the spec's command 3 runs this file under two.

import { describe, expect, it } from 'vitest';
import * as flight from './loyaltyFlight';

type Leg = { flightDate: string; origin: string; destination: string; carrier: string; flightNumber: string };
type Existing = Leg & { state: 'booked' | 'cancelled'; source: 'typed' | 'email'; evidenceReceivedOn?: string | null };

/** The named export as a function, after asserting that it is one. */
function fn<K extends 'cleanFlight' | 'legsPlausible' | 'flightStanding' | 'flightSupersedes' | 'planFlight'>(name: K): (typeof flight)[K] {
  expect(typeof (flight as Record<string, unknown>)[name], `${name} is exported`).toBe('function');
  return flight[name];
}

const CLEAN_KEYS = ['award', 'code', 'complete', 'kind', 'legs', 'legsVoid', 'programName', 'suffix'];
const LEG_KEYS = ['carrier', 'destination', 'flightDate', 'flightNumber', 'origin'];
const NONE = { kind: 'none', suffix: null, programName: null, code: null, award: null, complete: false, legs: [], legsVoid: false };

const legA: Leg = { flightDate: '2026-03-10', origin: 'JFK', destination: 'LHR', carrier: 'ZQ', flightNumber: '412' };
const legB: Leg = { flightDate: '2026-03-17', origin: 'LHR', destination: 'JFK', carrier: 'ZQ', flightNumber: '413' };

/** A complete, valid flight answer; each case overrides what it is about. */
const answer = (over: Record<string, unknown> = {}) => ({
  kind: 'flight_booked',
  programName: 'ZQ42E Wings Club',
  memberNumberSuffix: '••••7K9X',
  confirmationCode: 'ZQ42EAB12',
  award: true,
  completeItinerary: true,
  segments: [legA, legB],
  ...over,
});

describe('the flight clean pass (P8-42e1b)', () => {
  it('T42e1b-U1: only the two flight kinds are kept, anything else is none with nothing, and injected keys never survive', () => {
    const clean = fn('cleanFlight');
    for (const raw of [null, undefined, 'flight_booked', 7, [], [answer()], answer({ kind: 'hotel_booked' }), answer({ kind: 'flight' }),
      answer({ kind: undefined }), answer({ kind: 'FLIGHT_BOOKED' }), answer({ kind: 'none' }), { segments: [legA] }]) {
      expect(clean(raw), JSON.stringify(raw) ?? 'undefined').toEqual(NONE);
    }
    const injected = answer({
      passengerName: 'ZQ42E Passenger Canary', ticketNumber: 'ZQ42E-TICKET', seat: 'ZQ42E-SEAT', cabin: 'ZQ42E-CABIN', address: 'ZQ42E Street Canary',
      phone: 'ZQ42E-PHONE', cardLast4: 'ZQ42E-CARD', total: 'ZQ42E-TOTAL', times: 'ZQ42E-TIMES',
      segments: [{ ...legA, seat: 'ZQ42E-LEG-SEAT', departureTime: 'ZQ42E-LEG-TIME' }, legB],
    });
    const c = clean(injected);
    expect(Object.keys(c).sort()).toEqual(CLEAN_KEYS);
    for (const leg of c.legs) expect(Object.keys(leg).sort()).toEqual(LEG_KEYS);
    expect(JSON.stringify(c)).not.toMatch(/Passenger|TICKET|SEAT|CABIN|Street|PHONE|CARD|TOTAL|TIME/);
    expect(c).toEqual({
      kind: 'flight_booked', suffix: '7K9X', programName: 'zq42ewingsclub', code: 'ZQ42EAB12', award: true, complete: true, legs: [legA, legB], legsVoid: false,
    });
    const cancelled = clean(answer({ kind: 'flight_cancelled' }));
    expect(cancelled.kind).toBe('flight_cancelled');
    expect(Object.keys(cancelled).sort()).toEqual(CLEAN_KEYS);
  });

  it('T42e1b-U2: a leg is kept only in its exact shapes, one bad leg voids them all, and the bound and repeats are applied', () => {
    const clean = fn('cleanFlight');
    const one = (over: Record<string, unknown>) => clean(answer({ segments: [{ ...legA, ...over }] }));
    // Kept, normalised.
    expect(one({ origin: 'jfk', destination: ' LHR ', carrier: ' zq ', flightNumber: '412 a' }).legs)
      .toEqual([{ ...legA, origin: 'JFK', destination: 'LHR', carrier: 'ZQ', flightNumber: '412A' }]);
    expect(one({ flightNumber: '007' }).legs[0].flightNumber).toBe('007');
    expect(one({ carrier: 'z9' }).legs[0].carrier).toBe('Z9');
    const four = '1'.repeat(4);
    expect(one({ flightNumber: four }).legs[0].flightNumber).toBe(four);
    expect(one({ flightNumber: `${four}b` }).legs[0].flightNumber).toBe(`${four}B`);
    // Void, each for one reason.
    const bad: [string, Record<string, unknown>][] = [
      ['an impossible date', { flightDate: '2026-02-30' }],
      ['a date with a time', { flightDate: '2026-03-10T09:00' }],
      ['a short date', { flightDate: '2026-3-10' }],
      ['equal airports', { destination: 'JFK' }],
      ['equal airports after case', { destination: 'jfk' }],
      ['a two-letter airport', { origin: 'JF' }],
      ['a four-letter airport', { origin: 'JFKX' }],
      ['a digit in an airport', { destination: 'LH1' }],
      ['a one-character carrier', { carrier: 'Z' }],
      ['a three-character carrier', { carrier: 'ZQ4' }],
      ['five digits', { flightNumber: '4'.repeat(5) }],
      ['letters only', { flightNumber: 'AB' }],
      ['an empty number', { flightNumber: '' }],
      ['a letter before the digits', { flightNumber: 'A12' }],
      ['two letters after the digits', { flightNumber: '12AB' }],
      ['a numeric flight number', { flightNumber: 412 }],
      ['a null date', { flightDate: null }],
      ['a null origin', { origin: null }],
      ['a null destination', { destination: null }],
      ['a null carrier', { carrier: null }],
      ['a null number', { flightNumber: null }],
    ];
    for (const [what, over] of bad) {
      const c = one(over);
      expect([c.legs, c.legsVoid], what).toEqual([[], true]);
    }
    for (const notALeg of [null, 'ZQ412', [legA]]) expect(clean(answer({ segments: [notALeg] })).legsVoid).toBe(true);
    // All or nothing: the valid leg is NOT kept beside an invalid one.
    const mixed = clean(answer({ segments: [legA, { ...legB, origin: 'L1' }] }));
    expect([mixed.legs, mixed.legsVoid]).toEqual([[], true]);
    // No legs listed is not void; a missing or non-array list is.
    expect([clean(answer({ segments: [] })).legs, clean(answer({ segments: [] })).legsVoid]).toEqual([[], false]);
    expect(clean(answer({ segments: null })).legsVoid).toBe(true);
    expect(clean(answer({ segments: undefined })).legsVoid).toBe(true);
    // The bound: twelve kept, thirteen void; a repeated identity counts once.
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...legA, flightNumber: String(100 + i) }));
    expect(clean(answer({ segments: many(12) })).legs).toHaveLength(12);
    expect(clean(answer({ segments: many(13) }))).toMatchObject({ legs: [], legsVoid: true });
    expect(clean(answer({ segments: [legA, { ...legA, origin: 'EWR' }, legB] })).legs).toEqual([legA, legB]);
    expect(clean(answer({ segments: [...many(12), many(12)[0]] })).legs).toHaveLength(12);
  });

  it('T42e1b-U3: code, suffix, award and complete keep only their forms, and the date window is integer days in every time zone', () => {
    const clean = fn('cleanFlight');
    const plausible = fn('legsPlausible');
    const code = (v: unknown) => clean(answer({ confirmationCode: v })).code;
    expect(code('zq42e-ab 12')).toBe('ZQ42EAB12');
    expect(code('ZQ4')).toBeNull();
    expect(code('Z'.repeat(21))).toBeNull();
    expect(code('Z'.repeat(20))).toBe('Z'.repeat(20));
    expect(code(42)).toBeNull();
    expect(code(null)).toBeNull();
    expect(code('ZQ42É-AB')).toBe('ZQ42AB');
    // The suffix: the last four letters or digits of whatever was printed, never the full number.
    expect(clean(answer({ memberNumberSuffix: 'ZQ42E-0001-7K9X' })).suffix).toBe('7K9X');
    expect(clean(answer({ memberNumberSuffix: null })).suffix).toBeNull();
    // Award and complete: the booleans only.
    for (const [v, want] of [[true, true], [false, false], ['true', null], ['yes', null], [1, null], [null, null]] as const) {
      expect(clean(answer({ award: v })).award, String(v)).toBe(want);
    }
    for (const [v, want] of [[true, true], [false, false], ['true', false], [1, false], [null, false]] as const) {
      expect(clean(answer({ completeItinerary: v })).complete, String(v)).toBe(want);
    }
    // The window: 366 days either side is plausible, 367 is not; month end, year end and a leap day.
    const at = (flightDate: string) => [{ ...legA, flightDate }];
    const grid: [string, string, boolean][] = [
      ['2026-03-01', '2026-03-01', true],
      ['2026-03-01', '2027-03-02', true], ['2026-03-01', '2027-03-03', false],
      ['2026-03-01', '2025-02-28', true], ['2026-03-01', '2025-02-27', false],
      ['2024-02-29', '2025-03-01', true], ['2024-02-29', '2025-03-02', false],
      ['2024-02-29', '2023-02-28', true], ['2024-02-29', '2023-02-27', false],
      ['2026-12-31', '2028-01-01', true], ['2026-12-31', '2028-01-02', false],
      ['2026-12-31', '2025-12-30', true], ['2026-12-31', '2025-12-29', false],
      ['2026-01-31', '2027-02-01', true], ['2026-01-31', '2027-02-02', false],
      ['2026-01-31', '2025-01-30', true], ['2026-01-31', '2025-01-29', false],
    ];
    const answers = (): boolean[] => grid.map(([received, date]) => plausible(received, at(date)));
    const saved = process.env.TZ;
    try {
      const first = answers();
      expect(first).toEqual(grid.map((g) => g[2]));
      process.env.TZ = saved === 'Pacific/Auckland' ? 'UTC' : 'Pacific/Auckland';
      expect(answers()).toEqual(first);
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
    // Every leg must be inside: one outside makes the whole mail implausible.
    expect(plausible('2026-03-01', [{ ...legA, flightDate: '2026-04-01' }, { ...legB, flightDate: '2027-03-03' }])).toBe(false);
  });
});

describe('the flight rules for a code (P8-42e1b)', () => {
  it('T42e1b-U4: the group standing, and the supersession grid of 32 rows with mail never reviving a cancelled group', () => {
    const standing = fn('flightStanding');
    const supersedes = fn('flightSupersedes');
    expect(standing([])).toEqual({ state: 'booked', evidenceReceivedOn: null });
    expect(standing([{ state: 'booked', evidenceReceivedOn: null }, { state: 'cancelled', evidenceReceivedOn: '2026-03-02' }]))
      .toEqual({ state: 'booked', evidenceReceivedOn: '2026-03-02' });
    expect(standing([{ state: 'cancelled', evidenceReceivedOn: '2026-03-01' }, { state: 'cancelled', evidenceReceivedOn: '2026-03-04' }, { state: 'cancelled', evidenceReceivedOn: null }]))
      .toEqual({ state: 'cancelled', evidenceReceivedOn: '2026-03-04' });
    expect(standing([{ state: 'cancelled', evidenceReceivedOn: null }])).toEqual({ state: 'cancelled', evidenceReceivedOn: null });

    // The incoming mail is received on 2026-03-05; the group's evidence is none, earlier, equal or later.
    const evidence = { none: null, earlier: '2026-03-04', equal: '2026-03-05', later: '2026-03-06' } as const;
    // Per (group state, evidence): the answer for (booking, not by hand), (booking, by hand),
    // (cancellation, not by hand), (cancellation, by hand).
    const want: Record<string, string> = {
      'booked/none': 'TTTT', 'booked/earlier': 'TTTT', 'booked/equal': 'TTTT', 'booked/later': 'FFFF',
      'cancelled/none': 'FTTT', 'cancelled/earlier': 'FTTT', 'cancelled/equal': 'FFTT', 'cancelled/later': 'FFFF',
    };
    let rows = 0;
    for (const state of ['booked', 'cancelled'] as const) {
      for (const [ev, on] of Object.entries(evidence)) {
        const got = (['flight_booked', 'flight_cancelled'] as const).flatMap((kind) =>
          [false, true].map((byHand) => supersedes({ state, evidenceReceivedOn: on }, { kind, receivedOn: '2026-03-05' }, byHand) ? 'T' : 'F')).join('');
        rows += 4;
        expect(got, `${state}/${ev}`).toBe(want[`${state}/${ev}`]);
      }
    }
    expect(rows).toBe(32);
    // The default is not by hand.
    expect(supersedes({ state: 'cancelled', evidenceReceivedOn: null }, { kind: 'flight_booked', receivedOn: '2026-03-05' })).toBe(false);
  });

  it('T42e1b-U5: a booked mail rewrites, inserts and, only when complete, cancels omitted email legs; a typed or cancelled leg is not touched by mail', () => {
    const plan = fn('planFlight');
    const row = (leg: Leg, state: 'booked' | 'cancelled' = 'booked', source: 'typed' | 'email' = 'email', ev: string | null = '2026-03-01'): Existing =>
      ({ ...leg, state, source, evidenceReceivedOn: ev });
    const booked = (existing: Existing[], legs: Leg[], complete: boolean, byHand = false, receivedOn = '2026-03-05') =>
      plan({ existing, incoming: { kind: 'flight_booked', legs, complete }, receivedOn, byHand });
    const empty = { insert: [], rewrite: [], cancel: [], rebook: [] };

    // A first mail inserts every leg.
    expect(booked([], [legA, legB], false)).toEqual({ applies: true, ...empty, insert: [legA, legB] });
    // A matching booked row is rewritten; a changed origin is still the same leg.
    const moved = { ...legA, origin: 'EWR' };
    expect(booked([row(legA)], [moved], false)).toEqual({ applies: true, ...empty, rewrite: [moved] });
    // A changed date or number is a new leg; only a complete mail cancels the old one.
    const later = { ...legB, flightDate: '2026-03-18' };
    expect(booked([row(legA), row(legB)], [legA, later], true)).toEqual({ applies: true, ...empty, rewrite: [legA], insert: [later], cancel: [legB] });
    const renumbered = { ...legB, flightNumber: '415' };
    expect(booked([row(legA), row(legB)], [legA, renumbered], true)).toEqual({ applies: true, ...empty, rewrite: [legA], insert: [renumbered], cancel: [legB] });
    // Negative control: not complete, nothing omitted changes.
    expect(booked([row(legA), row(legB)], [legA, later], false)).toEqual({ applies: true, ...empty, rewrite: [legA], insert: [later] });
    // Negative control: a typed leg is never cancelled by omission, even by a complete mail.
    expect(booked([row(legA), row(legB, 'booked', 'typed', null)], [legA], true)).toEqual({ applies: true, ...empty, rewrite: [legA] });
    // A cancelled leg listed again is untouched by mail and re-booked only by hand.
    expect(booked([row(legA), row(legB, 'cancelled')], [legA, legB], false)).toEqual({ applies: true, ...empty, rewrite: [legA] });
    expect(booked([row(legA), row(legB, 'cancelled')], [legA, legB], false, true)).toEqual({ applies: true, ...empty, rewrite: [legA], rebook: [legB] });
    // An omitted leg that is already cancelled is not cancelled again.
    expect(booked([row(legA), row(legB, 'cancelled')], [legA], true)).toEqual({ applies: true, ...empty, rewrite: [legA] });
    // Not superseding: nothing applies and every list is empty (an older mail; a wholly cancelled group).
    expect(booked([row(legA, 'booked', 'email', '2026-03-06')], [legA, legB], true)).toEqual({ applies: false, ...empty });
    expect(booked([row(legA, 'cancelled'), row(legB, 'cancelled')], [legA, legB], true)).toEqual({ applies: false, ...empty });
    // By hand the wholly cancelled group can be re-booked, the dates permitting.
    expect(booked([row(legA, 'cancelled'), row(legB, 'cancelled')], [legA], false, true)).toEqual({ applies: true, ...empty, rebook: [legA] });
  });

  it('T42e1b-U6: a cancellation cancels what it lists or, listing nothing, the whole code; it never widens, revives or deletes', () => {
    const plan = fn('planFlight');
    const row = (leg: Leg, state: 'booked' | 'cancelled' = 'booked', ev: string | null = '2026-03-01'): Existing =>
      ({ ...leg, state, source: 'email', evidenceReceivedOn: ev });
    const cancel = (existing: Existing[], legs: Leg[], receivedOn = '2026-03-05', byHand = false) =>
      plan({ existing, incoming: { kind: 'flight_cancelled', legs, complete: false }, receivedOn, byHand });
    const empty = { insert: [], rewrite: [], cancel: [], rebook: [] };

    // One listed leg of two: only it is cancelled (negative control: the other is untouched).
    expect(cancel([row(legA), row(legB)], [legA])).toEqual({ applies: true, ...empty, cancel: [legA] });
    // A listed leg already cancelled changes nothing; a listed leg with no row is inserted (cancelled).
    expect(cancel([row(legA, 'cancelled'), row(legB)], [legA])).toEqual({ applies: true, ...empty });
    expect(cancel([row(legA)], [legB])).toEqual({ applies: true, ...empty, insert: [legB] });
    // No legs listed: every booked leg of the code; with no rows, nothing.
    expect(cancel([row(legA), row(legB), row({ ...legB, flightNumber: '9' }, 'cancelled')], [])).toEqual({ applies: true, ...empty, cancel: [legA, legB] });
    expect(cancel([], [])).toEqual({ applies: true, ...empty });
    // Never a rebook, even by hand.
    expect(cancel([row(legA, 'cancelled')], [legA], '2026-03-05', true).rebook).toEqual([]);
    // The dates follow U4: an equal date applies, an earlier one does not.
    expect(cancel([row(legA, 'booked', '2026-03-05')], [])).toEqual({ applies: true, ...empty, cancel: [legA] });
    expect(cancel([row(legA, 'booked', '2026-03-06')], [])).toEqual({ applies: false, ...empty });
  });
});
