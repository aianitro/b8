// `ApiResponse<T>`'s discriminant, tested against whole realistic envelopes rather than against the
// `success` field alone — which is what SPEC.md demands in place of "leave it as a TypeScript type
// for now". The payload schema is `z.array(BudgetCategorySchema)`, the shape `GET /api/categories`
// actually returns, so the success fixtures below are the real response and not a stand-in.
//
// Three properties have to hold, and each has its own fixture because each has its own way of
// going wrong:
//
//   1. `success` is a LITERAL boolean. This repo has already shipped the truthy-string bug once, as
//      `ALERTS_ENABLED` needing to be exactly the string 'true'; the shape of the mistake travels.
//   2. `success` is never optional — both branches require the key.
//   3. The branches never mix. This is the one place in the contract surface that uses
//      `z.strictObject` rather than `z.object`: the envelope is authored entirely by this
//      application, so nothing legitimately adds a key to it, and `{ success: true, data, error }`
//      must be REFUSED rather than stripped down into something that looks correct.
//
// Every error code and message below is fabricated, as is the category payload.

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ApiErrorResponseSchema,
  ApiErrorSchema,
  apiResponseSchema,
  apiSuccessResponseSchema,
} from './envelope';
import { BudgetCategorySchema } from './shapes';

/** One `GET /api/categories` row, written out locally — see index.test.ts on why not imported. */
const categoryWireRow = {
  id: 7,
  name: 'Groceries',
  annual_budget: '1200.00',
  landscape: 'operational',
  exclude_from_budget: false,
  is_income: false,
  control_mode: 'variable-necessary',
  dedicated_account_id: null,
  monthly_amounts: null,
  created_at: '2026-01-15T00:00:00.000Z',
};

/** The envelope `GET /api/categories` returns, as a schema. */
const categoriesResponseSchema = apiResponseSchema(z.array(BudgetCategorySchema));

/** The envelope every mutating handler returns: `{ success: true, data: null }`. */
const mutationResponseSchema = apiResponseSchema(z.null());

const populatedError = {
  code: 'DEBT_SERVICE_FIXED',
  message: 'a debt-service category must stay control_mode fixed',
};

describe('the ApiResponse envelope', () => {
  it('the success branch success true with a data payload and no error key parses', () => {
    const envelope = { success: true, data: [categoryWireRow] };

    const parsed = categoriesResponseSchema.parse(envelope);
    expect(Object.keys(parsed)).toEqual(['success', 'data']);
    expect(parsed.success).toBe(true);
    // The payload came through as the payload, not merely as "something truthy": the numeric-string
    // money field inside it was validated by the same schema the row fixtures use.
    expect(parsed).toEqual(envelope);

    // Both branches of the union are live, so this is the success branch matching rather than the
    // union accepting anything: the same envelope shape with a null payload parses too.
    expect(apiSuccessResponseSchema(z.null()).parse({ success: true, data: null }).data).toBeNull();
  });

  it('the error branch success false with a populated error object and no data key parses', () => {
    const envelope = { success: false, error: populatedError };

    // Closed and non-generic, which is why SPEC.md requires it to exist as a constant rather than
    // as something a factory produces.
    const parsed = ApiErrorResponseSchema.parse(envelope);
    expect(Object.keys(parsed)).toEqual(['success', 'error']);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toEqual(populatedError);

    // And the same payload through the full envelope, for a route whose success branch is a
    // category array: an error response does not depend on what the success payload would be.
    expect(categoriesResponseSchema.safeParse(envelope).success).toBe(true);
  });

  it('success true paired with an error key instead of data is rejected', () => {
    // The envelope's central control. A single loose `z.object` covering both branches would accept
    // this, and a consumer switching on `success` would then read `data` as undefined on a response
    // that reported success — a wrong number, or a blank screen, with nothing failing anywhere.
    const crossed = { success: true, error: populatedError };
    expect(categoriesResponseSchema.safeParse(crossed).success).toBe(false);
    expect(apiSuccessResponseSchema(z.array(BudgetCategorySchema)).safeParse(crossed).success).toBe(
      false
    );
    expect(mutationResponseSchema.safeParse(crossed).success).toBe(false);
  });

  it('success false paired with a data key instead of error is rejected', () => {
    const crossed = { success: false, data: [categoryWireRow] };
    expect(categoriesResponseSchema.safeParse(crossed).success).toBe(false);
    expect(ApiErrorResponseSchema.safeParse(crossed).success).toBe(false);
    // `{ success: false, data: null }` is the same defect with the payload every mutating route
    // returns, and is refused for the same reason: the error branch has no `data` key at all.
    expect(mutationResponseSchema.safeParse({ success: false, data: null }).success).toBe(false);
  });

  it('the string true is rejected as a value for success, because only the literal boolean is a valid discriminant', () => {
    expect(categoriesResponseSchema.safeParse({ success: 'true', data: [categoryWireRow] }).success)
      .toBe(false);
    expect(mutationResponseSchema.safeParse({ success: 'true', data: null }).success).toBe(false);
    expect(mutationResponseSchema.safeParse({ success: 'false', error: populatedError }).success)
      .toBe(false);

    // Nor is any other truthy or falsy stand-in the discriminant: 1 and 0 are what a wire format
    // without booleans would send, and they are not this envelope's wire format.
    expect(mutationResponseSchema.safeParse({ success: 1, data: null }).success).toBe(false);
    expect(mutationResponseSchema.safeParse({ success: 0, error: populatedError }).success).toBe(
      false
    );

    // And the key is required, not merely typed: `{ data: null }` alone is not a response.
    expect(mutationResponseSchema.safeParse({ data: null }).success).toBe(false);
  });

  it('an empty error code is rejected', () => {
    // A handler that fails without saying why leaves a consumer branching on the code with no
    // branch to take. The message is held to the same rule.
    expect(ApiErrorSchema.safeParse({ code: '', message: 'something went wrong' }).success).toBe(
      false
    );
    expect(
      ApiErrorResponseSchema.safeParse({
        success: false,
        error: { code: '', message: 'something went wrong' },
      }).success
    ).toBe(false);
    expect(ApiErrorSchema.safeParse({ code: 'DB_ERROR', message: '' }).success).toBe(false);

    // The vocabulary of codes stays open, though — a new failure mode must be reportable without a
    // contract amendment. Only emptiness is refused.
    expect(ApiErrorSchema.parse({ code: 'A_CODE_NOBODY_HAS_USED_YET', message: 'x' })).toEqual({
      code: 'A_CODE_NOBODY_HAS_USED_YET',
      message: 'x',
    });
  });

  it('an envelope carrying both a data and an error key is refused rather than quietly stripped down to something that looks correct', () => {
    // Not one of SPEC.md's 28 named fixtures; it is the property `z.strictObject` buys over
    // `z.object` here, and the reason the envelope's unknown-key policy differs from the row
    // schemas' (which must strip, because `RETURNING *` legitimately carries extra columns).
    expect(
      mutationResponseSchema.safeParse({ success: true, data: null, error: populatedError }).success
    ).toBe(false);
    expect(
      mutationResponseSchema.safeParse({ success: false, error: populatedError, data: null })
        .success
    ).toBe(false);
  });

  it('the mutating routes envelope, success true with a data payload of null, parses, while success true with no data key at all is rejected', () => {
    // Also not one of the 28. `data` is required even when its schema is `z.null()`, because
    // `{ success: true }` with no `data` key is not a response any handler here produces — and
    // modelling `data` optional is the shortcut that would make it one.
    const parsed = mutationResponseSchema.parse({ success: true, data: null });
    expect(parsed).toEqual({ success: true, data: null });
    expect(mutationResponseSchema.safeParse({ success: true }).success).toBe(false);
  });
});
