// P8-42e1 — the pure booking rules (U1–U7): the clean pass and what it refuses to keep, dates and the
// night count, the confirmation code's normal form, the property and award flags, a reader answer to
// a clean booking, the attribution order (SPEC.md D9) and the supersession grid (D8).
//
// Everything here is fabricated: program and property names carry the canary ZQ42E, codes are letters
// and digits made up in the test, and dates are written out. No database, no clock: the night count
// must not depend on the time zone, and the spec's command 3 runs this file under two.

import { describe, expect, it } from 'vitest';
import { cleanBooking, nightsBetween, normaliseConfirmationCode, placeBooking, supersedes, type PlaceInput } from './loyaltyBooking';

const CLEAN_KEYS = ['award', 'checkIn', 'checkOut', 'code', 'kind', 'programName', 'property', 'suffix'];
const NULLS = { suffix: null, programName: null, property: null, checkIn: null, checkOut: null, code: null, award: null };

/** A complete, valid hotel answer; each case overrides what it is about. */
const hotel = (over: Record<string, unknown> = {}) => ({
  kind: 'hotel_booked',
  programName: 'ZQ42E Harbour Rewards',
  memberNumberSuffix: '••••7K9X',
  property: 'ZQ42E Harbour Inn',
  confirmationCode: 'ZQ42EAB12',
  checkIn: '2026-03-10',
  checkOut: '2026-03-12',
  award: false,
  ...over,
});

describe('the booking clean pass (P8-42e1)', () => {
  it('T42e1-U1: only the four kinds are kept, a flight and anything unknown keep nothing, and injected keys never survive', () => {
    for (const raw of [null, undefined, 'hotel_booked', 7, [], [hotel()], { ...hotel(), kind: 'hotel_change' }, { ...hotel(), kind: undefined }, { ...hotel(), kind: 'HOTEL_BOOKED' }]) {
      expect(cleanBooking(raw), JSON.stringify(raw) ?? 'undefined').toEqual({ kind: 'none', ...NULLS });
    }
    // A flight is recognised and nothing is extracted from it, whatever it carries.
    expect(cleanBooking(hotel({ kind: 'flight' }))).toEqual({ kind: 'flight', ...NULLS });
    expect(cleanBooking(hotel({ kind: 'none' }))).toEqual({ kind: 'none', ...NULLS });
    // The model's own keys are never looked at.
    const injected = hotel({
      guestName: 'ZQ42E Guest Canary', address: 'ZQ42E Street Canary', phone: 'ZQ42E-PHONE', cardLast4: 'ZQ42E-CARD', total: 'ZQ42E-TOTAL',
    });
    const clean = cleanBooking(injected);
    expect(Object.keys(clean).sort()).toEqual(CLEAN_KEYS);
    expect(JSON.stringify(clean)).not.toMatch(/Guest Canary|Street Canary|PHONE|CARD|TOTAL/);
    expect(clean).toEqual({
      kind: 'hotel_booked', suffix: '7K9X', programName: 'zq42eharbourrewards', property: 'ZQ42E Harbour Inn',
      checkIn: '2026-03-10', checkOut: '2026-03-12', code: 'ZQ42EAB12', award: false,
    });
    expect(Object.keys(cleanBooking(hotel({ kind: 'hotel_cancelled' }))).sort()).toEqual(CLEAN_KEYS);
    expect(cleanBooking(hotel({ kind: 'hotel_cancelled' })).kind).toBe('hotel_cancelled');
  });

  it('T42e1-U2: dates are real calendar dates in order and within the limit, and the night count is integer day arithmetic', () => {
    const dates = (checkIn: unknown, checkOut: unknown) => {
      const c = cleanBooking(hotel({ checkIn, checkOut }));
      return [c.checkIn, c.checkOut];
    };
    expect(dates('2026-03-10', '2026-03-12')).toEqual(['2026-03-10', '2026-03-12']);
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', '2026-03-10T15:00:00', '2026-03-10 15:00', 20260310, null, '']) {
      expect(dates(bad, '2026-03-12'), String(bad)).toEqual([null, null]);
      expect(dates('2026-03-01', bad), String(bad)).toEqual([null, null]);
    }
    // Check-out not strictly after check-in is no stay.
    expect(dates('2026-03-12', '2026-03-12')).toEqual([null, null]);
    expect(dates('2026-03-12', '2026-03-10')).toEqual([null, null]);
    // Exactly the limit is kept, one more is not.
    expect(dates('2026-01-01', '2026-03-02')).toEqual(['2026-01-01', '2026-03-02']);
    expect(nightsBetween('2026-01-01', '2026-03-02')).toBe(60);
    expect(dates('2026-01-01', '2026-03-03')).toEqual([null, null]);
    expect(nightsBetween('2026-01-01', '2026-03-03')).toBe(61);
    // Adjacent days, a month end, a year end, and the leap day.
    expect(nightsBetween('2026-03-10', '2026-03-11')).toBe(1);
    expect(nightsBetween('2026-01-30', '2026-02-02')).toBe(3);
    expect(nightsBetween('2025-12-30', '2026-01-02')).toBe(3);
    expect(nightsBetween('2028-02-27', '2028-03-02')).toBe(4);
    expect(nightsBetween('2027-02-27', '2027-03-02')).toBe(3);
    expect(nightsBetween('2000-02-28', '2000-03-01')).toBe(2);
    expect(nightsBetween('2100-02-28', '2100-03-01')).toBe(1);
    // The same answers whatever the process's zone says: nothing here reads it.
    const zone = process.env.TZ;
    const before = [nightsBetween('2026-03-07', '2026-03-09'), nightsBetween('2026-10-31', '2026-11-02')];
    try {
      process.env.TZ = 'Pacific/Auckland';
      expect([nightsBetween('2026-03-07', '2026-03-09'), nightsBetween('2026-10-31', '2026-11-02')]).toEqual(before);
      process.env.TZ = 'America/New_York';
      expect([nightsBetween('2026-03-07', '2026-03-09'), nightsBetween('2026-10-31', '2026-11-02')]).toEqual(before);
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
    expect(before).toEqual([2, 2]);
  });

  it('T42e1-U3: a code keeps its ASCII letters and digits upper-cased, 4 to 20 of them, and spellings collapse to one', () => {
    expect(normaliseConfirmationCode('zq42e-ab 12')).toBe('ZQ42EAB12');
    expect(normaliseConfirmationCode('ZQ42EAB12')).toBe('ZQ42EAB12');
    expect(normaliseConfirmationCode(' zq42E/ab.12 ')).toBe('ZQ42EAB12');
    expect(normaliseConfirmationCode('ZQ4E')).toBe('ZQ4E');
    expect(normaliseConfirmationCode('ZQ42EABCDEFGHJKLMNPQ')).toBe('ZQ42EABCDEFGHJKLMNPQ');
    for (const bad of ['ZQ4', 'z-q-4', 'ZQ42EABCDEFGHJKLMNPQR', '', '---', '•••• ••', null, undefined, 42, { code: 'ZQ42EAB12' }, ['ZQ42EAB12']]) {
      expect(normaliseConfirmationCode(bad), String(bad)).toBeNull();
    }
    // Spellings differing only in case, spaces or dashes are one code.
    const spellings = ['ZQ42E-AB12', 'zq42e ab12', 'Zq42eAb12', 'ZQ42E AB-12'].map(normaliseConfirmationCode);
    expect(new Set(spellings)).toEqual(new Set(['ZQ42EAB12']));
    // A non-ASCII letter is dropped, never upper-cased into an ASCII one.
    expect(normaliseConfirmationCode('ZQ42Eı12')).toBe('ZQ42E12');
    expect(normaliseConfirmationCode('ZQ42Eß12')).toBe('ZQ42E12');
    expect(normaliseConfirmationCode('ZQ42Eé12')).not.toBe(normaliseConfirmationCode('ZQ42EE12'));
    expect(normaliseConfirmationCode('ZQ42Eı12')).not.toBe(normaliseConfirmationCode('ZQ42EI12'));
    // The clean pass applies the same rule.
    expect(cleanBooking(hotel({ confirmationCode: 'zq42e-ab 12' })).code).toBe('ZQ42EAB12');
    expect(cleanBooking(hotel({ confirmationCode: 'ZQ4' })).code).toBeNull();
  });

  it('T42e1-U4: the property is trimmed and collapsed or refused, never cut; the award is a boolean or not stated', () => {
    const prop = (property: unknown) => cleanBooking(hotel({ property })).property;
    expect(prop('  ZQ42E   Harbour Inn  ')).toBe('ZQ42E Harbour Inn');
    const eighty = `ZQ42E ${'x'.repeat(74)}`;
    expect(eighty).toHaveLength(80);
    expect(prop(eighty)).toBe(eighty);
    expect(prop(`${eighty}y`)).toBeNull();
    for (const bad of ['<b>ZQ42E Inn</b>', 'ZQ42E > Inn', 'ZQ42E\nInn', 'ZQ42E\tInn', 'ZQ42E\u0007Inn', '   ', '', null, 12, ['ZQ42E Inn']]) {
      expect(prop(bad), JSON.stringify(bad)).toBeNull();
    }
    const award = (value: unknown) => cleanBooking(hotel({ award: value })).award;
    expect(award(true)).toBe(true);
    expect(award(false)).toBe(false);
    for (const notStated of ['true', 'yes', 'false', 1, 0, null, undefined, {}]) expect(award(notStated), String(notStated)).toBeNull();
  });

  it('T42e1-U5: a reader answer becomes a clean booking; a missing code is kept as null and a printed full number keeps its tail', () => {
    const full = cleanBooking(hotel({ memberNumberSuffix: 'ZQ42E-0001-7K9X', award: true }));
    expect(full).toEqual({
      kind: 'hotel_booked', suffix: '7K9X', programName: 'zq42eharbourrewards', property: 'ZQ42E Harbour Inn',
      checkIn: '2026-03-10', checkOut: '2026-03-12', code: 'ZQ42EAB12', award: true,
    });
    expect(JSON.stringify(full)).not.toContain('ZQ42E-0001');
    const noCode = cleanBooking(hotel({ confirmationCode: null }));
    expect(noCode.kind).toBe('hotel_booked');
    expect(noCode.code).toBeNull();
    expect(noCode.checkIn).toBe('2026-03-10');
    expect(cleanBooking(hotel({ memberNumberSuffix: '••12' })).suffix).toBeNull();
    expect(cleanBooking(hotel({ memberNumberSuffix: null, programName: null })).suffix).toBeNull();
    expect(cleanBooking(hotel({ programName: '<i>ZQ42E</i>' })).programName).toBeNull();
    const cancelled = cleanBooking(hotel({ kind: 'hotel_cancelled', checkIn: null, checkOut: null }));
    expect([cancelled.kind, cancelled.code, cancelled.checkIn, cancelled.checkOut]).toEqual(['hotel_cancelled', 'ZQ42EAB12', null, null]);
  });

  it('T42e1-U6: attribution places only on a membership nothing contradicts, and holds or discards everything else', () => {
    const base: PlaceInput = { programCheck: 'match', suffix: null, match: null, forwarderMembershipId: null, notMine: false };
    const cases: [string, Partial<PlaceInput>, ReturnType<typeof placeBooking>][] = [
      ['mismatch beats a unique match and a forwarder', { programCheck: 'mismatch', suffix: '7K9X', match: { kind: 'unique', membershipId: 11 }, forwarderMembershipId: 11 }, { kind: 'hold', reason: 'program_mismatch' }],
      ['mismatch with nothing else', { programCheck: 'mismatch' }, { kind: 'hold', reason: 'program_mismatch' }],
      ['unique match, no forwarder', { suffix: '7K9X', match: { kind: 'unique', membershipId: 11 } }, { kind: 'place', membershipId: 11 }],
      ['unique match equal to the forwarder', { suffix: '7K9X', match: { kind: 'unique', membershipId: 11 }, forwarderMembershipId: 11 }, { kind: 'place', membershipId: 11 }],
      ['unique match against another forwarder', { suffix: '7K9X', match: { kind: 'unique', membershipId: 11 }, forwarderMembershipId: 12 }, { kind: 'hold', reason: 'forwarder_conflict' }],
      ['no suffix, a forwarder', { forwarderMembershipId: 12 }, { kind: 'place', membershipId: 12 }],
      ['no suffix, program not stated, a forwarder', { programCheck: 'not_stated', forwarderMembershipId: 12 }, { kind: 'place', membershipId: 12 }],
      ['no suffix, no forwarder', {}, { kind: 'hold', reason: 'no_suffix' }],
      ['unmatched, not listed', { suffix: '7K9X', match: { kind: 'unmatched' } }, { kind: 'hold', reason: 'unmatched_suffix' }],
      ['unmatched, on the not-mine list', { suffix: '7K9X', match: { kind: 'unmatched' }, notMine: true }, { kind: 'discard' }],
      ['ambiguous, no forwarder', { suffix: '7K9X', match: { kind: 'ambiguous' } }, { kind: 'hold', reason: 'ambiguous_suffix' }],
      ['ambiguous, a forwarder', { suffix: '7K9X', match: { kind: 'ambiguous' }, forwarderMembershipId: 11 }, { kind: 'hold', reason: 'ambiguous_suffix' }],
      ['unmatched, the forwarder holds an unnumbered membership', { suffix: '7K9X', match: { kind: 'unmatched' }, forwarderMembershipId: 12 }, { kind: 'hold', reason: 'unmatched_suffix' }],
    ];
    for (const [name, over, expected] of cases) expect(placeBooking({ ...base, ...over }), name).toEqual(expected);
    // The negative control: a contradicting forwarder places on NEITHER membership.
    const conflict = placeBooking({ ...base, suffix: '7K9X', match: { kind: 'unique', membershipId: 11 }, forwarderMembershipId: 12 });
    expect(conflict.kind).not.toBe('place');
  });

  it('T42e1-U7: an incoming mail supersedes a stay only when it is newer, or same-day; a mailed booking never revives a cancellation', () => {
    const grid: [string, 'none' | 'earlier' | 'equal' | 'later', 'hotel_booked' | 'hotel_cancelled', boolean][] = [];
    const states = ['booked', 'cancelled'] as const;
    // Rows read: existing state, the existing evidence date relative to the incoming mail, the mail's kind.
    const expected: Record<string, boolean> = {
      'booked none hotel_booked': true, 'booked none hotel_cancelled': true,
      'booked earlier hotel_booked': true, 'booked earlier hotel_cancelled': true,
      'booked equal hotel_booked': true, 'booked equal hotel_cancelled': true,
      'booked later hotel_booked': false, 'booked later hotel_cancelled': false,
      // SPEC.md A5: received dates are inbox arrival, so no date lets a mailed booking revive a cancellation.
      'cancelled none hotel_booked': false, 'cancelled none hotel_cancelled': true,
      'cancelled earlier hotel_booked': false, 'cancelled earlier hotel_cancelled': true,
      'cancelled equal hotel_booked': false, 'cancelled equal hotel_cancelled': true,
      'cancelled later hotel_booked': false, 'cancelled later hotel_cancelled': false,
    };
    const evidence = { none: null, earlier: '2026-03-09', equal: '2026-03-10', later: '2026-03-11' } as const;
    for (const state of states) {
      for (const when of ['none', 'earlier', 'equal', 'later'] as const) {
        for (const kind of ['hotel_booked', 'hotel_cancelled'] as const) {
          grid.push([state, when, kind, supersedes({ state, evidenceReceivedOn: evidence[when] }, { kind, receivedOn: '2026-03-10' })]);
        }
      }
    }
    expect(grid).toHaveLength(16);
    for (const [state, when, kind, applies] of grid) expect(applies, `${state} ${when} ${kind}`).toBe(expected[`${state} ${when} ${kind}`]);
    // By hand (the hold's place): a person may re-book a cancelled stay, and the dates still order it.
    const cancelled = (when: keyof typeof evidence) => ({ state: 'cancelled' as const, evidenceReceivedOn: evidence[when] });
    const booking = { kind: 'hotel_booked' as const, receivedOn: '2026-03-10' };
    expect([supersedes(cancelled('none'), booking, true), supersedes(cancelled('earlier'), booking, true)]).toEqual([true, true]);
    expect([supersedes(cancelled('equal'), booking, true), supersedes(cancelled('later'), booking, true)]).toEqual([false, false]);
  });
});
