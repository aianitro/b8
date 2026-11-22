// P8-42a — the loyalty contract refuses what it says it refuses (scenario U7).
//
// These pin the CONTRACT, not the handlers: every fixture is a hand-built body or response, and the
// question is "does the schema accept exactly this". The routes' own behaviour is C1–C11 in
// `apps/web/app/api/v1/loyalty/loyalty.test.ts`.
//
// Written by the implementer rather than the contract-guardian: the guardian's role excludes tests,
// and the scope guard exempts test files under this package from the contract lease (the P5-34
// precedent, `findings.test.ts`).
//
// FIXTURES ARE FABRICATED and carry `ZQ42A`. No figure here is anyone's balance.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as loyalty from './loyalty';
import {
  LOYALTY_EARN_FALLBACK_DAYS,
  LOYALTY_EARN_MAX_RATE,
  LOYALTY_EARN_MAX_RULES,
  LOYALTY_EARN_MISS_PERCENT,
  LOYALTY_INSTRUMENT_KINDS,
  LOYALTY_INSTRUMENT_SOURCES,
  LOYALTY_OBSERVATION_SOURCES,
  LOYALTY_PROGRAM_KINDS,
  LOYALTY_UNITS,
  LOYALTY_WHOLE_UNITS,
  LoyaltyInstrumentCreateRequestSchema,
  LoyaltyInstrumentPatchRequestSchema,
  LoyaltyMemberCreateRequestSchema,
  LoyaltyMemberNumberResponseSchema,
  LoyaltyMemberPatchRequestSchema,
  LoyaltyMembershipCreateRequestSchema,
  LoyaltyMembershipPatchRequestSchema,
  LoyaltyMembershipResponseSchema,
  LoyaltyMembershipSchema,
  LoyaltyObservationCreateRequestSchema,
  LoyaltyErrorCodeSchema,
  LoyaltyFeeWatchSchema,
  LoyaltyOverviewSchema,
  LoyaltyOverviewResponseSchema,
  LoyaltyProgramCreateRequestSchema,
  LoyaltyProgramPatchRequestSchema,
} from './loyalty';

const membership = (over: Record<string, unknown> = {}) => ({
  id: 1, memberId: 2, memberDisplayName: 'ZQ42AAnna', programId: 3, memberNumberMasked: '••••0001',
  tier: null, balance: '1500', unit: 'points', asOf: '2026-01-15', source: 'typed', cardAccountId: null, cardAccountName: null, benefit: null, feeWatch: null, earn: null, earnEstimate: null, earnComparison: null, ...over,
});

/** The pinned, fabricated P8-42b2 fixture: only the groups these tests read, typed loosely on purpose. */
type EarnRuleCase = { kind: string; match: string; rate: string };
const EARN_CASES = JSON.parse(
  readFileSync(new URL('../../apps/web/lib/fixtures/loyalty-earn-cases.json', import.meta.url), 'utf8')
) as {
  configCases: { id: string; baseRate: string; rules: EarnRuleCase[]; emitted: { baseRate: string; rules: string[] } }[];
  comparisonCases: { id: string; expected: unknown }[];
  contractCases: {
    rateAccept: string[]; rateRefuse: string[]; rateRefuseNonString: unknown[];
    merchantMatchAccept: string[]; merchantMatchRefuse: string[];
    lengths: { categoryMax: number; merchantMax: number; rulesMax: number };
    amountAccept: Record<string, string[]>; amountRefuse: Record<string, string[]>;
    percentAccept: string[]; percentRefuse: string[];
  };
};

/** Every key of a schema's object shape, through refinements and the envelope's union. */
function keysOf(schema: z.ZodType): string[] {
  const def = (schema as unknown as { _zod: { def: Record<string, unknown> } })._zod.def;
  if (def.type === 'object') {
    const shape = def.shape as Record<string, z.ZodType>;
    return Object.entries(shape).flatMap(([k, v]) => [k, ...keysOf(v)]);
  }
  for (const inner of ['innerType', 'in', 'schema', 'element']) if (def[inner]) return keysOf(def[inner] as z.ZodType);
  if (def.type === 'union') return (def.options as z.ZodType[]).flatMap(keysOf);
  return [];
}

describe('the loyalty contract', () => {
  it('T42a-U7: strict requests, typed-only source, string balances, a mask that cannot hold a number, one full-number schema, the envelope everywhere, exact vocabularies', () => {
    // Strict: an unknown key fails every request schema.
    const valid: [z.ZodType, Record<string, unknown>][] = [
      [LoyaltyMemberCreateRequestSchema, { displayName: 'ZQ42AAnna' }],
      [LoyaltyMemberPatchRequestSchema, { displayName: 'ZQ42AAnna' }],
      [LoyaltyProgramCreateRequestSchema, { name: 'ZQ42A Air', kind: 'airline', defaultUnit: 'miles' }],
      [LoyaltyProgramPatchRequestSchema, { aliases: ['zq42a air'] }],
      [LoyaltyMembershipCreateRequestSchema, { memberId: 1, programId: 2, memberNumber: 'ZQ42A-1' }],
      [LoyaltyMembershipPatchRequestSchema, { tier: 'ZQ42A Gold' }],
      [LoyaltyObservationCreateRequestSchema, { asOf: '2026-01-15', balance: '1500', unit: 'points' }],
      [LoyaltyInstrumentCreateRequestSchema, { membershipId: 1, kind: 'other', description: 'ZQ42A night' }],
      [LoyaltyInstrumentPatchRequestSchema, { description: 'ZQ42A night' }],
    ];
    for (const [schema, body] of valid) {
      expect(schema.safeParse(body).success).toBe(true);
      expect(schema.safeParse({ ...body, zq42aExtra: 1 }).success).toBe(false);
    }
    expect(LoyaltyMembershipCreateRequestSchema.safeParse({ memberId: 1, programId: 2, cardAccountId: 'zq42a' }).success).toBe(false);

    // Source: absent or `typed`, nothing else.
    const obs = { asOf: '2026-01-15', balance: '1500', unit: 'points' };
    expect(LoyaltyObservationCreateRequestSchema.safeParse({ ...obs, source: 'typed' }).success).toBe(true);
    for (const source of ['import', 'email', 'screenshot', 'TYPED', '']) {
      expect(LoyaltyObservationCreateRequestSchema.safeParse({ ...obs, source }).success).toBe(false);
    }
    // A balance is a string; a JSON number never parses. And the unit rule applies.
    expect(LoyaltyObservationCreateRequestSchema.safeParse({ ...obs, balance: 1500 }).success).toBe(false);
    expect(LoyaltyObservationCreateRequestSchema.safeParse({ ...obs, balance: '1500.5' }).success).toBe(false);
    expect(LoyaltyObservationCreateRequestSchema.safeParse({ ...obs, unit: 'usd', balance: '25.005' }).success).toBe(false);

    // The membership's number field holds a mask only: a full 12-character number fails it.
    expect(LoyaltyMembershipSchema.safeParse(membership()).success).toBe(true);
    expect(LoyaltyMembershipSchema.safeParse(membership({ memberNumberMasked: null })).success).toBe(true);
    expect(LoyaltyMembershipSchema.safeParse(membership({ memberNumberMasked: '••••' })).success).toBe(true);
    for (const leak of ['ZQ42A0000001', '••••ZQ42A0000001', '••••12345', 'ZQ42A-1']) {
      expect(LoyaltyMembershipSchema.safeParse(membership({ memberNumberMasked: leak })).success, leak).toBe(false);
    }
    expect(LoyaltyMembershipSchema.safeParse(membership({ memberNumber: 'ZQ42A0000001' })).success).toBe(false);
    // Null semantics: all four null together.
    expect(LoyaltyMembershipSchema.safeParse(membership({ balance: null, unit: null, asOf: null, source: null })).success).toBe(true);
    expect(LoyaltyMembershipSchema.safeParse(membership({ balance: null })).success).toBe(false);
    expect(LoyaltyMembershipSchema.safeParse(membership({ balance: '0' })).success).toBe(true);

    // Exactly one response schema carries a field for the full number.
    const responses = Object.entries(loyalty).filter(([name]) => /ResponseSchema$/.test(name)) as [string, z.ZodType][];
    expect(responses.length).toBe(7);
    const carrying = responses.filter(([, s]) => keysOf(s).includes('memberNumber')).map(([n]) => n);
    expect(carrying).toEqual(['LoyaltyMemberNumberResponseSchema']);
    // Every response is the envelope: success with data, or the error branch.
    for (const [, s] of responses) {
      expect(s.safeParse({ success: false, error: { code: 'NOT_FOUND', message: 'No such record.' } }).success).toBe(true);
      expect(s.safeParse({ success: true }).success).toBe(false);
    }
    expect(LoyaltyMembershipResponseSchema.safeParse({ success: true, data: membership() }).success).toBe(true);
    expect(LoyaltyMemberNumberResponseSchema.safeParse({ success: true, data: { membershipId: 1, memberNumber: 'ZQ42A0000001' } }).success).toBe(true);
    expect(LoyaltyOverviewResponseSchema.safeParse({ success: true, data: { members: [], programs: [], cards: [], instruments: [], cardAccounts: [], inbox: EMPTY_INBOX } }).success).toBe(true);

    // The vocabularies, by set equality with SPEC.md Conventions.
    const set = (xs: readonly string[]) => [...xs].sort();
    expect(set(LOYALTY_UNITS)).toEqual(['miles', 'nights', 'points', 'usd']);
    expect(set(LOYALTY_WHOLE_UNITS)).toEqual(['miles', 'nights', 'points']);
    expect(set(LOYALTY_PROGRAM_KINDS)).toEqual(['airline', 'car', 'card_currency', 'hotel', 'other', 'travel_cash']);
    expect(set(LOYALTY_INSTRUMENT_KINDS)).toEqual(['companion_fare', 'free_night', 'other', 'travel_credit']);
    expect(set(LOYALTY_OBSERVATION_SOURCES)).toEqual(['email', 'import', 'screenshot', 'typed']);
    expect(set(LOYALTY_INSTRUMENT_SOURCES)).toEqual(['import', 'typed']);

    // Program PATCH: an alias list, when given, has at least one entry.
    expect(LoyaltyProgramPatchRequestSchema.safeParse({ aliases: [] }).success).toBe(false);
    expect(LoyaltyProgramPatchRequestSchema.safeParse({}).success).toBe(false);
  });

  // ─── P8-42b — the card link, the benefit and the fee watch ─────────────────────────────────────
  //
  // Fixtures carry `ZQ42B`. The dates are fixed calendar text: these pin the SCHEMA's consistency
  // rules, which do not depend on today; the routes' dates are computed by Postgres in
  // `apps/web/app/api/v1/loyalty/loyaltyCard.test.ts`.

  it('T42b-U1: the membership PATCH takes a card link and a benefit, bounded and strict, and refuses everything else', () => {
    const ok = (b: unknown) => LoyaltyMembershipPatchRequestSchema.safeParse(b).success;
    const night = { kind: 'free_night', description: 'ZQ42B night' };
    for (const body of [
      { cardAccountId: 'zq42b_a' },
      { cardAccountId: null },
      { benefit: night },
      { benefit: { ...night, windowDays: 1 } },
      { benefit: { ...night, windowDays: 45 } },
      { benefit: { ...night, windowDays: 365 } },
      { benefit: null },
      { cardAccountId: 'zq42b_a', benefit: night, tier: 'ZQ42B Gold' },
    ]) expect(ok(body), JSON.stringify(body)).toBe(true);
    for (const body of [
      { cardAccountId: '' }, { cardAccountId: 7 }, { cardAccountId: { id: 'zq42b_a' } },
      { benefit: { ...night, windowDays: 0 } }, { benefit: { ...night, windowDays: 366 } },
      { benefit: { ...night, windowDays: 1.5 } }, { benefit: { ...night, windowDays: -1 } },
      { benefit: { ...night, windowDays: '30' } },
      { benefit: { kind: 'points_deposit', description: 'ZQ42B night' } },
      { benefit: { kind: 'free_night', description: '' } }, { benefit: { kind: 'free_night', description: '   ' } },
      { benefit: { kind: 'free_night', description: 'Z'.repeat(201) } },
      { benefit: { ...night, zq42bExtra: 1 } },
      { cardAccountId: 'zq42b_a', zq42bExtra: 1 },
      {},
    ]) expect(ok(body), JSON.stringify(body)).toBe(false);
    expect(ok({ benefit: { kind: 'free_night', description: 'Z'.repeat(200) } })).toBe(true);
  });

  it('T42b-U2: a membership carries the card, the benefit and a fee watch that cannot contradict itself, and never an amount', () => {
    const benefit = { kind: 'free_night', description: 'ZQ42B night', windowDays: 45 };
    const linked = (feeWatch: unknown, b: unknown = benefit) =>
      membership({ cardAccountId: 'zq42b_card', cardAccountName: 'ZQ42B Card', benefit: b, feeWatch });
    const parses = (m: unknown) => LoyaltyMembershipSchema.safeParse(m).success;

    expect(parses(membership())).toBe(true);
    // Linked, no benefit: no state, and a fee date or none.
    expect(parses(linked({ feeDate: null, expectedBy: null, state: null }, null))).toBe(true);
    expect(parses(linked({ feeDate: '2026-01-05', expectedBy: null, state: null }, null))).toBe(true);
    // The four states, with the dates their rules require.
    expect(parses(linked({ feeDate: null, expectedBy: null, state: 'no_fee_seen' }))).toBe(true);
    for (const state of ['awaiting', 'received', 'overdue']) {
      expect(parses(linked({ feeDate: '2026-01-05', expectedBy: '2026-02-19', state })), state).toBe(true);
      expect(parses(linked({ feeDate: null, expectedBy: '2026-02-19', state })), `${state} with no fee date`).toBe(false);
      expect(parses(linked({ feeDate: '2026-01-05', expectedBy: null, state })), `${state} with no expected-by`).toBe(false);
    }
    // Contradictions, a stray key, an amount, a missing key.
    expect(parses(linked({ feeDate: '2026-01-05', expectedBy: null, state: 'no_fee_seen' }))).toBe(false);
    expect(parses(linked({ feeDate: null, expectedBy: '2026-02-19', state: 'no_fee_seen' }))).toBe(false);
    expect(parses(linked({ feeDate: '2026-01-05', expectedBy: '2026-02-19', state: 'pending' }))).toBe(false);
    expect(parses(linked({ feeDate: '2026-01-05', expectedBy: '2026-02-19', state: null }, null))).toBe(false);
    expect(parses(linked({ feeDate: '2026-1-5', expectedBy: '2026-02-19', state: 'awaiting' }))).toBe(false);
    expect(parses(linked({ feeDate: '2026-01-05', expectedBy: '2026-02-19', state: 'awaiting', zq42bExtra: 1 }))).toBe(false);
    expect(parses(linked({ feeDate: '2026-01-05', expectedBy: '2026-02-19', state: 'awaiting', amount: '12.34' }))).toBe(false);
    expect(parses(linked({ feeDate: null, expectedBy: null, state: 'no_fee_seen' }, { ...benefit, zq42bExtra: 1 }))).toBe(false);
    for (const key of ['cardAccountId', 'benefit', 'feeWatch']) {
      const m: Record<string, unknown> = membership();
      delete m[key];
      expect(parses(m), `missing ${key}`).toBe(false);
    }
    // The bare fee watch, against its own schema.
    expect(LoyaltyFeeWatchSchema.safeParse({ feeDate: null, expectedBy: null, state: null }).success).toBe(true);
    expect(LoyaltyFeeWatchSchema.safeParse({ feeDate: '2026-01-05', expectedBy: null, state: null }).success).toBe(true);
    expect(LoyaltyFeeWatchSchema.safeParse({ feeDate: null, expectedBy: '2026-02-19', state: null }).success).toBe(false);
    expect(LoyaltyFeeWatchSchema.safeParse({ feeDate: '2026-01-05', expectedBy: '2026-02-19', state: 'overdue', amount: '12.34' }).success).toBe(false);
    // The overview requires the link picker's list.
    const overview = { members: [], programs: [], cards: [], instruments: [], inbox: EMPTY_INBOX };
    expect(LoyaltyOverviewSchema.safeParse(overview).success).toBe(false);
    expect(LoyaltyOverviewSchema.safeParse({ ...overview, cardAccounts: [] }).success).toBe(true);
    expect(LoyaltyOverviewSchema.safeParse({ ...overview, cardAccounts: [{ id: 'zq42b_card', name: 'ZQ42B Card' }] }).success).toBe(true);
    expect(LoyaltyOverviewSchema.safeParse({ ...overview, cardAccounts: [{ id: 'zq42b_card', name: 'ZQ42B Card', type: 'credit' }] }).success).toBe(false);
  });

  it('T42b-U3: a membership is still created unlinked and with no benefit, and the new error code exists beside the old ones', () => {
    expect(LoyaltyMembershipCreateRequestSchema.safeParse({ memberId: 1, programId: 2, cardAccountId: 'zq42b' }).success).toBe(false);
    expect(LoyaltyMembershipCreateRequestSchema.safeParse({ memberId: 1, programId: 2, benefit: { kind: 'free_night', description: 'ZQ42B night' } }).success).toBe(false);
    expect(LoyaltyMembershipCreateRequestSchema.safeParse({ memberId: 1, programId: 2 }).success).toBe(true);
    for (const code of ['INVALID_INPUT', 'NOT_FOUND', 'INSUFFICIENT_SCOPE', 'BROWSER_SESSION_REQUIRED', 'MEMBERSHIP_EXISTS',
      'ALIAS_TAKEN', 'MEMBER_NAME_TAKEN', 'MEMBER_USER_TAKEN', 'CARD_ALREADY_LINKED']) {
      expect(LoyaltyErrorCodeSchema.safeParse(code).success, code).toBe(true);
    }
    expect(LoyaltyErrorCodeSchema.safeParse('CARD_TAKEN').success).toBe(false);
  });

  // ─── P8-42b2 — the earn description and its derived figures ─────────────────────────────────────
  //
  // Every rate, figure and percentage spelling comes from the pinned, fabricated fixture
  // `apps/web/lib/fixtures/loyalty-earn-cases.json` (group `contractCases`, plus `configCases` and one
  // comparison case for consistent shapes). None is restated here: a test that chose its own numbers
  // could agree with a wrong implementation. Each list the fixture gives is walked into `seen` and
  // compared with the fixture's own list, so a case cannot be silently skipped. Other fixtures carry
  // `ZQ42B2`.

  it('T42b2-U1: the membership PATCH takes a bounded, strict, ordered earn description as decimal text, and refuses everything else', () => {
    const ok = (b: unknown) => LoyaltyMembershipPatchRequestSchema.safeParse(b).success;
    const c = EARN_CASES.contractCases;
    const rule = (over: Record<string, unknown> = {}) => ({ kind: 'category', match: 'ZQ42B2 Hotel', rate: c.rateAccept[0], ...over });
    const earn = (over: Record<string, unknown> = {}) => ({ earn: { baseRate: c.rateAccept[0], rules: [rule()], ...over } });

    // Rates: accepted and refused, as the base rate and as a rule's rate alike.
    let seen: unknown[] = [];
    for (const rate of c.rateAccept) {
      expect(ok(earn({ baseRate: rate })), `base ${rate}`).toBe(true);
      expect(ok(earn({ rules: [rule({ rate })] })), `rule ${rate}`).toBe(true);
      seen.push(rate);
    }
    expect(seen).toEqual(c.rateAccept);
    seen = [];
    for (const rate of [...c.rateRefuse, ...c.rateRefuseNonString]) {
      expect(ok(earn({ baseRate: rate })), `base ${JSON.stringify(rate)}`).toBe(false);
      expect(ok(earn({ rules: [rule({ rate })] })), `rule ${JSON.stringify(rate)}`).toBe(false);
      seen.push(rate);
    }
    expect(seen).toEqual([...c.rateRefuse, ...c.rateRefuseNonString]);

    // Merchant text: a restricted, literal charset.
    seen = [];
    for (const match of c.merchantMatchAccept) {
      expect(ok(earn({ rules: [rule({ kind: 'merchant', match })] })), match).toBe(true);
      seen.push(match);
    }
    expect(seen).toEqual(c.merchantMatchAccept);
    seen = [];
    for (const match of c.merchantMatchRefuse) {
      expect(ok(earn({ rules: [rule({ kind: 'merchant', match })] })), JSON.stringify(match)).toBe(false);
      seen.push(match);
    }
    expect(seen).toEqual(c.merchantMatchRefuse);

    // The bounds, at the maximum and one past it.
    const L = c.lengths;
    expect(ok(earn({ rules: [rule({ match: 'Z'.repeat(L.categoryMax) })] }))).toBe(true);
    expect(ok(earn({ rules: [rule({ match: 'Z'.repeat(L.categoryMax + 1) })] }))).toBe(false);
    expect(ok(earn({ rules: [rule({ kind: 'merchant', match: 'z'.repeat(L.merchantMax) })] }))).toBe(true);
    expect(ok(earn({ rules: [rule({ kind: 'merchant', match: 'z'.repeat(L.merchantMax + 1) })] }))).toBe(false);
    const many = (n: number) => Array.from({ length: n }, (_, i) => rule({ match: `ZQ42B2 Category ${i}` }));
    expect(ok(earn({ rules: many(L.rulesMax) }))).toBe(true);
    expect(ok(earn({ rules: many(L.rulesMax + 1) }))).toBe(false);

    // Everything else refused.
    for (const body of [
      earn({ rules: [rule({ match: '' })] }), earn({ rules: [rule({ match: '   ' })] }),
      earn({ rules: [rule({ kind: 'merchant', match: '   ' })] }),
      earn({ rules: [rule({ kind: 'mcc' })] }),
      earn({ zq42b2Extra: 1 }), earn({ rules: [rule({ zq42b2Extra: 1 })] }),
      { earn: {} },
      { earn: { rules: [rule()] } },
      { earn: { baseRate: c.rateAccept[0] } },
      earn({ rules: [rule(), rule({ match: 'zq42b2 hotel', rate: c.rateAccept[1] })] }),
      earn({ rules: [rule({ kind: 'merchant', match: 'zq42b2 hotelco' }), rule({ kind: 'merchant', match: 'ZQ42B2 HotelCo' })] }),
      {},
    ]) expect(ok(body), JSON.stringify(body)).toBe(false);
    // The same text under two kinds is two rules, not a duplicate.
    expect(ok(earn({ rules: [rule({ match: 'zq42b2 hotelco' }), rule({ kind: 'merchant', match: 'zq42b2 hotelco' })] }))).toBe(true);

    // Accepted: a clear, and the description beside every other field.
    expect(ok({ earn: null })).toBe(true);
    expect(ok({ ...earn(), benefit: { kind: 'free_night', description: 'ZQ42B2 night' }, cardAccountId: 'zq42b2_card', tier: 'ZQ42B2 Gold' })).toBe(true);
  });

  it('T42b2-U2: a membership carries the earn description and the derived figures, which cannot contradict themselves or carry spend', () => {
    const c = EARN_CASES.contractCases;
    const k1 = EARN_CASES.configCases[0];
    const stored = { baseRate: k1.emitted.baseRate, rules: k1.rules.map((r, i) => ({ kind: r.kind, match: r.match, rate: k1.emitted.rules[i] })) };
    const ref = EARN_CASES.comparisonCases[0].expected as { estimated: string; actual: string; differencePercent: string; worthALook: boolean };
    const estimate = (over: Record<string, unknown> = {}) => ({ since: '2026-01-15', basis: 'reading', unit: 'points', amount: c.amountAccept.points[0], ...over });
    const comparison = (over: Record<string, unknown> = {}) => ({
      from: '2025-12-16', to: '2026-01-15', unit: 'points', estimated: ref.estimated, actual: ref.actual,
      differencePercent: ref.differencePercent, worthALook: ref.worthALook, ...over,
    });
    const linked = (over: Record<string, unknown> = {}) => membership({
      cardAccountId: 'zq42b2_card', cardAccountName: 'ZQ42B2 Card', feeWatch: { feeDate: null, expectedBy: null, state: null },
      earn: stored, earnEstimate: estimate(), earnComparison: comparison(), ...over,
    });
    const parses = (m: unknown) => LoyaltyMembershipSchema.safeParse(m).success;

    expect(parses(membership())).toBe(true);
    expect(parses(membership({ earn: stored }))).toBe(true);
    expect(parses(linked())).toBe(true);
    expect(parses(linked({ earnEstimate: null, earnComparison: null }))).toBe(true);
    expect(LoyaltyMembershipSchema.parse(linked()).earn?.rules.map((r) => r.match)).toEqual(k1.rules.map((r) => r.match));

    // The figure spellings, per unit, from the fixture.
    let seen: string[] = [];
    for (const [unit, amounts] of Object.entries(c.amountAccept)) {
      for (const amount of amounts) {
        expect(parses(linked({ earnEstimate: estimate({ unit, amount }) })), `${unit} ${amount}`).toBe(true);
        seen.push(`${unit}:${amount}`);
      }
    }
    expect(seen).toEqual(Object.entries(c.amountAccept).flatMap(([u, xs]) => xs.map((x) => `${u}:${x}`)));
    seen = [];
    for (const [unit, amounts] of Object.entries(c.amountRefuse)) {
      for (const amount of amounts) {
        expect(parses(linked({ earnEstimate: estimate({ unit, amount }) })), `${unit} ${amount}`).toBe(false);
        seen.push(`${unit}:${amount}`);
      }
    }
    expect(seen).toEqual(Object.entries(c.amountRefuse).flatMap(([u, xs]) => xs.map((x) => `${u}:${x}`)));
    seen = [];
    for (const differencePercent of c.percentAccept) {
      expect(parses(linked({ earnComparison: comparison({ differencePercent }) })), differencePercent).toBe(true);
      seen.push(differencePercent);
    }
    for (const differencePercent of c.percentRefuse) {
      expect(parses(linked({ earnComparison: comparison({ differencePercent }) })), differencePercent).toBe(false);
      seen.push(differencePercent);
    }
    expect(seen).toEqual([...c.percentAccept, ...c.percentRefuse]);

    // Contradictions, a stray key, nights, a missing key.
    const zero = c.amountAccept.points[0];
    for (const [label, m] of [
      ['nights estimate', linked({ earnEstimate: estimate({ unit: 'nights' }) })],
      ['nights comparison', linked({ earnComparison: comparison({ unit: 'nights' }) })],
      ['basis', linked({ earnEstimate: estimate({ basis: 'last_week' }) })],
      ['since', linked({ earnEstimate: estimate({ since: '2026-1-15' }) })],
      ['from after to', linked({ earnComparison: comparison({ from: '2026-01-15', to: '2025-12-16' }) })],
      ['from equals to', linked({ earnComparison: comparison({ from: '2026-01-15' }) })],
      ['null percent, non-zero estimate', linked({ earnComparison: comparison({ differencePercent: null }) })],
      ['percent with a zero estimate', linked({ earnComparison: comparison({ estimated: zero }) })],
      ['worthALook flipped', linked({ earnComparison: comparison({ worthALook: !ref.worthALook }) })],
      ['spend key on the estimate', linked({ earnEstimate: { ...estimate(), spend: zero } })],
      ['rows key on the estimate', linked({ earnEstimate: { ...estimate(), rows: [] } })],
      ['merchant key on the comparison', linked({ earnComparison: { ...comparison(), merchant: 'ZQ42B2' } })],
      ['stray key on the description', linked({ earn: { ...stored, zq42b2Extra: 1 } })],
      ['estimate with no card', membership({ earn: stored, earnEstimate: estimate() })],
      ['estimate with no description', linked({ earn: null, earnComparison: null })],
      ['comparison with no card', membership({ earn: stored, earnComparison: comparison() })],
      ['comparison with no description', linked({ earn: null, earnEstimate: null })],
    ] as [string, unknown][]) expect(parses(m), label).toBe(false);
    for (const key of ['earn', 'earnEstimate', 'earnComparison']) {
      const m: Record<string, unknown> = membership();
      delete m[key];
      expect(parses(m), `missing ${key}`).toBe(false);
    }

    // The overview still parses with memberships carrying the keys.
    expect(LoyaltyOverviewSchema.safeParse({
      members: [], programs: [], instruments: [], cardAccounts: [], inbox: EMPTY_INBOX,
      cards: [{ programId: 3, programName: 'ZQ42B2 Program', programKind: 'hotel', memberships: [membership(), linked()] }],
    }).success).toBe(true);

    expect([LOYALTY_EARN_MAX_RULES, LOYALTY_EARN_MAX_RATE, LOYALTY_EARN_FALLBACK_DAYS, LOYALTY_EARN_MISS_PERCENT]).toEqual([20, 100, 30, 25]);
    expect(LOYALTY_EARN_MAX_RULES).toBe(c.lengths.rulesMax);
  });

  it('T42b2-U3: the create schema still refuses an earn description, the error codes are unchanged, and the P8-42b bodies still pass', () => {
    const k2 = EARN_CASES.configCases[1];
    expect(LoyaltyMembershipCreateRequestSchema.safeParse({ memberId: 1, programId: 2, earn: { baseRate: k2.baseRate, rules: k2.rules } }).success).toBe(false);
    expect(LoyaltyMembershipCreateRequestSchema.safeParse({ memberId: 1, programId: 2, earn: null }).success).toBe(false);
    expect(LoyaltyMembershipCreateRequestSchema.safeParse({ memberId: 1, programId: 2 }).success).toBe(true);
    const codes = ['INVALID_INPUT', 'NOT_FOUND', 'INSUFFICIENT_SCOPE', 'BROWSER_SESSION_REQUIRED', 'MEMBERSHIP_EXISTS',
      'ALIAS_TAKEN', 'MEMBER_NAME_TAKEN', 'MEMBER_USER_TAKEN', 'CARD_ALREADY_LINKED', 'DOMAIN_TAKEN', 'ADDRESS_TAKEN'];
    for (const code of codes) expect(LoyaltyErrorCodeSchema.safeParse(code).success, code).toBe(true);
    expect([...LoyaltyErrorCodeSchema.options].sort()).toEqual([...codes].sort());
    const night = { kind: 'free_night', description: 'ZQ42B night' };
    for (const body of [{ cardAccountId: 'zq42b_a' }, { cardAccountId: null }, { benefit: night }, { benefit: { ...night, windowDays: 45 } }, { benefit: null }]) {
      expect(LoyaltyMembershipPatchRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(true);
    }
  });
});

// ─── P8-42c1: the loyalty inbox ─────────────────────────────────────────────────────────────────
//
// The pinned, fabricated fixture `apps/web/lib/fixtures/loyalty-inbox/cases.json` (SHA-256 in that
// spec's command 16) supplies every domain and address case; the inbox fixtures below are hand-built
// and carry `zq42c`. EMPTY_INBOX is also the `inbox` the older overview fixtures above now need.

const INBOX_CASES = JSON.parse(
  readFileSync(new URL('../../apps/web/lib/fixtures/loyalty-inbox/cases.json', import.meta.url), 'utf8')
) as {
  domainAccept: { input: string; stored: string }[]; domainRefuse: string[];
  addressAccept: { input: string; stored: string }[]; addressRefuse: string[];
  lengths: { domainsMax: number; addressesMax: number };
};

/** A never-polled, unconfigured inbox with nothing in it: the smallest valid `inbox`. */
const EMPTY_INBOX = {
  configured: false, problem: 'unset', missing: [...loyalty.LOYALTY_INBOX_REQUIRED_ENV], retentionDays: 30, silenceDays: 45,
  lastCheck: null, senderDomains: [], coverage: [], forwarding: [], unknownSenders: [], unknownSenderTotal: 0, unattributed: 0,
};

describe('the loyalty inbox contract (P8-42c1)', () => {
  it('T42c1-U1: the inbox requests, the overview panel and the poll answer accept and refuse exactly the described shapes', () => {
    const seen: string[] = [];
    const accepts = (schema: z.ZodType, body: unknown, label: string) => { expect(schema.safeParse(body).success, label).toBe(true); seen.push(`+${label}`); };
    const refuses = (schema: z.ZodType, body: unknown, label: string) => { expect(schema.safeParse(body).success, label).toBe(false); seen.push(`-${label}`); };
    const P = LoyaltyProgramPatchRequestSchema;
    const M = LoyaltyMemberPatchRequestSchema;

    // Sender domains: every accepted and refused case, the empty list, the bound, a repeat, a stray key.
    for (const d of INBOX_CASES.domainAccept) accepts(P, { senderDomains: [d.input] }, `domain ${d.input}`);
    for (const d of INBOX_CASES.domainRefuse) refuses(P, { senderDomains: [d] }, `domain ${d}`);
    accepts(P, { senderDomains: [] }, 'no domains');
    const domains = (n: number) => Array.from({ length: n }, (_, i) => `zq42c-d${i}.test`);
    accepts(P, { senderDomains: domains(INBOX_CASES.lengths.domainsMax) }, 'domains at the bound');
    refuses(P, { senderDomains: domains(INBOX_CASES.lengths.domainsMax + 1) }, 'domains over the bound');
    refuses(P, { senderDomains: ['zq42c-brand.test', ' ZQ42C-BRAND.test'] }, 'a repeated domain');
    refuses(P, { senderDomains: ['zq42c-brand.test'], senderDomain: 'zq42c-brand.test' }, 'a stray program key');

    // Forwarding addresses: the same.
    for (const a of INBOX_CASES.addressAccept) accepts(M, { forwardingAddresses: [a.input] }, `address ${a.input}`);
    for (const a of INBOX_CASES.addressRefuse) refuses(M, { forwardingAddresses: [a] }, `address ${a}`);
    accepts(M, { forwardingAddresses: [] }, 'no addresses');
    const addresses = (n: number) => Array.from({ length: n }, (_, i) => `zq42c-${i}@example.com`);
    accepts(M, { forwardingAddresses: addresses(INBOX_CASES.lengths.addressesMax) }, 'addresses at the bound');
    refuses(M, { forwardingAddresses: addresses(INBOX_CASES.lengths.addressesMax + 1) }, 'addresses over the bound');
    refuses(M, { forwardingAddresses: ['zq42c-anna@example.com', 'ZQ42C-Anna@example.com'] }, 'a repeated address');
    refuses(M, { forwardingAddresses: [], forwardingAddress: 'zq42c-anna@example.com' }, 'a stray member key');

    // The overview's inbox, in every state, then each contradiction.
    const forwarding = (state: string, over: Record<string, unknown> = {}) => ({
      memberId: 1, addresses: ['zq42c-anna@example.com'], state, lastReceivedOn: null, quietDays: 3, ...over,
    });
    const inbox = (over: Record<string, unknown> = {}) => ({
      ...EMPTY_INBOX, configured: true, problem: null, missing: [],
      senderDomains: [{ programId: 2, domains: ['zq42c-brand.test'] }],
      coverage: [{ programId: 2, lastSeenOn: '2026-01-05', storedInWindow: 4 }],
      forwarding: [
        forwarding('not_set_up', { memberId: 1, addresses: [], quietDays: null }),
        forwarding('no_mail_yet', { memberId: 2, quietDays: 45 }),
        forwarding('ok', { memberId: 3, lastReceivedOn: '2026-01-05', quietDays: 44 }),
        forwarding('quiet', { memberId: 4, lastReceivedOn: '2026-01-05', quietDays: 46 }),
        forwarding('quiet', { memberId: 5, quietDays: 46 }),
      ],
      unknownSenders: [{ domain: 'attacker.test', count: 2 }, { domain: '(unreadable)', count: 1 }],
      unknownSenderTotal: 3, unattributed: 1, ...over,
    });
    const overview = (i: unknown) => ({ members: [], programs: [], cards: [], instruments: [], cardAccounts: [], inbox: i });
    const O = LoyaltyOverviewSchema;
    accepts(O, overview(EMPTY_INBOX), 'the empty inbox');
    accepts(O, overview(inbox()), 'every forwarding state');
    accepts(O, overview(inbox({ lastCheck: { on: '2026-01-06', outcome: 'ok', errorCode: null } })), 'last check ok');
    accepts(O, overview(inbox({ lastCheck: { on: '2026-01-06', outcome: 'error', errorCode: 'auth_failed' } })), 'last check error');
    accepts(O, overview({ ...EMPTY_INBOX, problem: 'incomplete', missing: ['LOYALTY_IMAP_HOST'] }), 'incomplete');
    refuses(O, { members: [], programs: [], cards: [], instruments: [], cardAccounts: [] }, 'no inbox');
    refuses(O, overview({ ...inbox(), subject: 'ZQ42C-SUBJECT-CANARY' }), 'a stray inbox key');
    refuses(O, overview({ ...EMPTY_INBOX, missing: ['LOYALTY_IMAP_HOST', 'LOYALTY_IMAP_PORT', 'LOYALTY_IMAP_TLS', 'LOYALTY_IMAP_USER', 'ZQ42C_PASSWORD_VALUE'] }), 'a missing entry that is no variable');
    refuses(O, overview(inbox({ forwarding: [forwarding('not_set_up', { addresses: [], quietDays: 0 })] })), 'quietDays for not_set_up');
    refuses(O, overview(inbox({ forwarding: [forwarding('quiet', { quietDays: null })] })), 'no quietDays for quiet');
    refuses(O, overview(inbox({ forwarding: [forwarding('ok', { lastReceivedOn: '2026-01-05', quietDays: 46 })] })), 'ok past the threshold');
    refuses(O, overview(inbox({ unattributed: -1 })), 'a negative count');
    refuses(O, overview(inbox({ unknownSenderTotal: 2 })), 'listed unknowns above the total');
    refuses(O, overview(inbox({ lastCheck: { on: '2026-01-06', outcome: 'ok', errorCode: 'timeout' } })), 'a code on an ok check');
    refuses(O, overview(inbox({ unknownSenders: [{ domain: '<b>zq42c</b>.test', count: 1 }], unknownSenderTotal: 1 })), 'markup as a domain');

    // The poll answer.
    const poll = (over: Record<string, unknown> = {}) => ({
      outcome: 'ok', fetched: 3, stored: 1, duplicates: 1, unknown: 1, expired: 0, oversize: 0, errorCode: null, ...over,
    });
    const zero = { fetched: 0, stored: 0, duplicates: 0, unknown: 0, expired: 0, oversize: 0 };
    const R = loyalty.LoyaltyInboxPollResponseSchema;
    accepts(R, { success: true, data: poll() }, 'poll ok');
    accepts(R, { success: true, data: poll({ ...zero, outcome: 'disabled' }) }, 'poll disabled');
    accepts(R, { success: true, data: poll({ ...zero, outcome: 'already_running' }) }, 'poll already running');
    accepts(R, { success: true, data: poll({ outcome: 'error', errorCode: 'connect_failed' }) }, 'poll error');
    refuses(R, { success: true, data: poll({ errorCode: 'timeout' }) }, 'a code on an ok poll');
    refuses(R, { success: true, data: poll({ outcome: 'error' }) }, 'an error with no code');
    refuses(R, { success: true, data: poll({ outcome: 'disabled' }) }, 'counts on a disabled poll');
    const noStored: Record<string, unknown> = poll();
    delete noStored.stored;
    refuses(R, { success: true, data: noStored }, 'a missing count');
    for (const key of ['subject', 'body', 'raw']) refuses(R, { success: true, data: { ...poll(), [key]: 'ZQ42C-BODY-CANARY' } }, `a stray ${key}`);
    refuses(R, { success: true, data: poll({ fetched: -1 }) }, 'a negative count');
    refuses(R, { success: true, data: poll({ fetched: 1.5 }) }, 'a fractional count');

    // The error codes: the nine of P8-42a to P8-42b2 and the two new ones, exactly.
    const codes = ['INVALID_INPUT', 'NOT_FOUND', 'INSUFFICIENT_SCOPE', 'BROWSER_SESSION_REQUIRED', 'MEMBERSHIP_EXISTS', 'ALIAS_TAKEN',
      'MEMBER_NAME_TAKEN', 'MEMBER_USER_TAKEN', 'CARD_ALREADY_LINKED', 'DOMAIN_TAKEN', 'ADDRESS_TAKEN'];
    for (const code of codes) accepts(LoyaltyErrorCodeSchema, code, `code ${code}`);
    expect([...LoyaltyErrorCodeSchema.options].sort()).toEqual([...codes].sort());

    // The six constants.
    expect([loyalty.LOYALTY_INBOX_RETENTION_DAYS, loyalty.LOYALTY_INBOX_SILENCE_DAYS, loyalty.LOYALTY_INBOX_MAX_BYTES,
      loyalty.LOYALTY_INBOX_MAX_DOMAINS, loyalty.LOYALTY_INBOX_MAX_ADDRESSES, loyalty.LOYALTY_INBOX_UNKNOWN_LIMIT]).toEqual([30, 45, 5242880, 20, 10, 20]);

    // Every case above was walked: the accepted and refused domain and address groups in full.
    const walked = (sign: string, prefix: string) => seen.filter((s) => s.startsWith(`${sign}${prefix} `)).map((s) => s.slice(prefix.length + 2));
    expect(walked('+', 'domain')).toEqual(INBOX_CASES.domainAccept.map((d) => d.input));
    expect(walked('-', 'domain')).toEqual(INBOX_CASES.domainRefuse);
    expect(walked('+', 'address')).toEqual(INBOX_CASES.addressAccept.map((a) => a.input));
    expect(walked('-', 'address')).toEqual(INBOX_CASES.addressRefuse);
  });
});
