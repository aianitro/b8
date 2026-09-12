// The five closed vocabularies, tested for the property that makes them worth having: an unknown
// value is REFUSED, not admitted as a new member of the set.
//
// `z.string()` in place of any of these would accept a typo'd or case-mismatched value that the
// NOT NULL CHECK would have refused at the database — and for `landscape` or `control_mode` that
// value then sits outside every scored set, invisible to the guardrail rather than loudly wrong.
//
// Each fixture also parses the schema's own legal values, so a rejection is evidence of a closed
// vocabulary rather than of a schema that rejects everything.

import { describe, expect, it } from 'vitest';
import {
  LandscapeSchema,
  PropertyTypeSchema,
  TenantFundKindSchema,
  ValuationModeSchema,
} from './enums';

describe('LandscapeSchema', () => {
  it('an unknown landscape value is rejected rather than admitted as a third, unnamed landscape', () => {
    // 'hybrid' is the plausible invention: operational and capital are the only two the CHECK
    // allows, and a third would quietly range over both sides of every landscape-gated query.
    expect(LandscapeSchema.safeParse('hybrid').success).toBe(false);
    expect(LandscapeSchema.safeParse('Operational').success).toBe(false);
    expect(LandscapeSchema.safeParse('').success).toBe(false);

    expect(LandscapeSchema.parse('operational')).toBe('operational');
    expect(LandscapeSchema.parse('capital')).toBe('capital');
    expect([...LandscapeSchema.options].sort()).toEqual(['capital', 'operational']);
  });
});

describe('ValuationModeSchema', () => {
  it('an unknown valuation_mode value is rejected', () => {
    // 'market' is the near miss worth naming: it is what 'valuation' mode is FOR, so it reads as a
    // synonym. A row carrying it would have no balance rule at all — neither flow-derived nor
    // latest-observation.
    expect(ValuationModeSchema.safeParse('market').success).toBe(false);
    expect(ValuationModeSchema.safeParse('Ledger').success).toBe(false);

    expect(ValuationModeSchema.parse('ledger')).toBe('ledger');
    expect(ValuationModeSchema.parse('valuation')).toBe('valuation');
    expect([...ValuationModeSchema.options].sort()).toEqual(['ledger', 'valuation']);
  });
});

describe('PropertyTypeSchema and TenantFundKindSchema', () => {
  it('both remaining closed vocabularies accept their own values and reject one outside their CHECK constraint', () => {
    // Not one of SPEC.md's 28 named fixtures. These two are contracted shapes with no object schema
    // carrying them yet, which is exactly why they need a fixture: a mistyped literal in the filter
    // that separates a security deposit (owed back, reduces net worth) from last month's rent
    // (already recognized as income, reduces nothing) matches no rows, and a deposit that quietly
    // stops counting is a wrong number that looks like a right one.
    expect(PropertyTypeSchema.parse('primary')).toBe('primary');
    expect(PropertyTypeSchema.parse('rental')).toBe('rental');
    expect(PropertyTypeSchema.safeParse('vacation').success).toBe(false);

    expect(TenantFundKindSchema.parse('security_deposit')).toBe('security_deposit');
    expect(TenantFundKindSchema.parse('last_month_rent')).toBe('last_month_rent');
    expect(TenantFundKindSchema.safeParse('deposit').success).toBe(false);
  });
});
