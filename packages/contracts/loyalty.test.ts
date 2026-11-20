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

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as loyalty from './loyalty';
import {
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
  LoyaltyOverviewResponseSchema,
  LoyaltyProgramCreateRequestSchema,
  LoyaltyProgramPatchRequestSchema,
} from './loyalty';

const membership = (over: Record<string, unknown> = {}) => ({
  id: 1, memberId: 2, memberDisplayName: 'ZQ42AAnna', programId: 3, memberNumberMasked: '••••0001',
  tier: null, balance: '1500', unit: 'points', asOf: '2026-01-15', source: 'typed', ...over,
});

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
    expect(responses.length).toBe(6);
    const carrying = responses.filter(([, s]) => keysOf(s).includes('memberNumber')).map(([n]) => n);
    expect(carrying).toEqual(['LoyaltyMemberNumberResponseSchema']);
    // Every response is the envelope: success with data, or the error branch.
    for (const [, s] of responses) {
      expect(s.safeParse({ success: false, error: { code: 'NOT_FOUND', message: 'No such record.' } }).success).toBe(true);
      expect(s.safeParse({ success: true }).success).toBe(false);
    }
    expect(LoyaltyMembershipResponseSchema.safeParse({ success: true, data: membership() }).success).toBe(true);
    expect(LoyaltyMemberNumberResponseSchema.safeParse({ success: true, data: { membershipId: 1, memberNumber: 'ZQ42A0000001' } }).success).toBe(true);
    expect(LoyaltyOverviewResponseSchema.safeParse({ success: true, data: { members: [], programs: [], cards: [], instruments: [] } }).success).toBe(true);

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
});
