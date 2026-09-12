// The pg-to-JSON representation primitives. None of SPEC.md's 28 named fixtures lands here — they
// all assert through a row schema, which is the right level for a contract — but three judgements
// recorded in representation.ts and CONTRACT.md are invisible at that level, and an untested
// judgement is one the next reader has to take on faith.
//
// Fabricated figures throughout.

import { describe, expect, it } from 'vitest';
import { numericArray, numericString, timestamptz } from './representation';

describe('numericString', () => {
  it('rejects NaN, the one NUMERIC value Postgres can store that this contract refuses', () => {
    // A judgement, recorded as a test rather than as prose: `NaN` is a legal NUMERIC in Postgres
    // and no money column here CHECKs against it, but a NaN balance is a data defect rather than an
    // observation and it renders as "NaN" all the way to the screen. Rejected here so it surfaces
    // at the boundary, where it can still be attributed to whatever produced it.
    expect(numericString.safeParse('NaN').success).toBe(false);
    expect(numericString.safeParse('').success).toBe(false);
    expect(numericString.safeParse('1,200.00').success).toBe(false);
    expect(numericString.safeParse('1.2e5').success).toBe(false);
  });

  it("accepts an aggregate printed at more than two decimal places, because the scale is Postgres's and not the validator's", () => {
    // The columns are NUMERIC(12,2)/(14,2), but an aggregate or an unrounded expression prints at
    // whatever scale Postgres computes. A validator demanding exactly two decimals would reject a
    // figure the database really produces — a new rule, not a description of the wire.
    expect(numericString.parse('-103712.31')).toBe('-103712.31');
    expect(numericString.parse('0')).toBe('0');
    expect(numericString.parse('33.333333')).toBe('33.333333');
    expect(numericString.parse('-0.01')).toBe('-0.01');
  });
});

describe('numericArray and timestamptz', () => {
  it('a JS Date is rejected where the wire carries an ISO-8601 string, because these schemas describe the payload and not the pg row object', () => {
    // `pg` parses OID 1184 into a `Date`; it is `Response.json` that turns it into a string, and
    // these schemas sit after that step. A fixture written with `new Date()` fails here, correctly.
    expect(timestamptz.safeParse(new Date('2026-01-15T00:00:00.000Z')).success).toBe(false);
    expect(timestamptz.parse('2026-01-15T00:00:00.000Z')).toBe('2026-01-15T00:00:00.000Z');

    // And the array primitive, from the other side of the parser asymmetry: elements are JS
    // numbers, and the numeric strings the scalar rule would produce are refused.
    expect(numericArray.parse([80, 100.5, 0])).toEqual([80, 100.5, 0]);
    expect(numericArray.safeParse(['80.00']).success).toBe(false);
  });
});
