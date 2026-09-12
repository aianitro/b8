// `ApiResponse<T>` — the envelope all 27 route handlers return and all 61 importers destructure.
//
// ITEM.md flagged this as the one place in the conversion where the obvious translation is awkward,
// because the success branch is generic and zod schemas are values rather than types. SPEC.md
// resolved the awkwardness by splitting it, and this file follows that split exactly:
//
//   * The ERROR branch has no type parameter, so nothing stops it from being one closed, fully
//     specified schema — and it is one, below. Its two fields are non-empty strings: an error whose
//     `code` is `""` is a handler that has decided to fail without saying why, and a consumer
//     branching on the code gets no branch to take.
//   * The SUCCESS branch is generic over twelve different `T`s. A factory, not a constant, so a
//     call site pins the payload it actually expects — `apiResponseSchema(z.array(BudgetCategorySchema))`
//     validates a whole realistic envelope rather than the discriminant alone.
//
// WHAT MUST BE TRUE OF THE DISCRIMINANT, and how each branch enforces it:
//   * `success` is a LITERAL boolean, never a truthy value. `z.literal(true)` / `z.literal(false)`,
//     so the string `"true"` is refused. This repo has shipped that bug once already, as
//     `ALERTS_ENABLED` needing to be exactly the string `"true"`; the shape of the mistake travels.
//   * `success` is never optional. Both branches require the key.
//   * The two branches never mix. `z.strictObject` rather than `z.object` here — unlike the row
//     schemas in shapes.ts, which must strip because `RETURNING *` legitimately carries extra
//     columns. This envelope is authored entirely by this application: nothing legitimately adds a
//     key to it, so `{ success: true, data: …, error: … }` is a defect and is refused rather than
//     quietly stripped down to something that looks correct.
//
// `z.union` rather than `z.discriminatedUnion`: identical acceptance and rejection here, because
// each branch pins its own literal, and the union form imposes no discriminability constraint on a
// generic `data` schema. The cost is a slightly less pointed error message on a malformed envelope;
// the benefit is that this file compiles for any `T` a handler ever returns, including `z.null()`,
// which is what every mutating handler in app/api/** returns today.
//
// Layering: this module imports `zod` and nothing else. No `next/server`, no `pg`, no `@/lib/db` —
// a validator that could reach a request object or a connection pool is not a contract, it is a
// handler, and SPEC.md enforces the boundary structurally (acceptance #40–#43).

import { z } from 'zod';

/**
 * The error payload itself — `{ code, message }`, both non-empty.
 *
 * Strict: the codes in use today (`INVALID_INPUT`, `DB_ERROR`, `NOT_FOUND`, `DEBT_SERVICE_FIXED`,
 * `BAD_REQUEST`, `PLAID_ERROR`, …) are an open vocabulary and stay `z.string()` — closing that set
 * would mean a new failure mode could not be reported until the contract was amended — but the
 * SHAPE is closed. A handler that wants to attach a third field is making a contract change and
 * should come through this surface to make it.
 */
export const ApiErrorSchema = z.strictObject({
  code: z.string().min(1, 'an error code is what a consumer branches on; it may not be empty'),
  message: z.string().min(1, 'an error message may not be empty'),
});

/**
 * The whole error branch: `{ success: false, error: { code, message } }`.
 *
 * Non-generic by construction, which is why SPEC.md requires it to exist as a constant rather than
 * as something a factory produces. A payload carrying `data` instead of `error` fails on the
 * missing `error`; one carrying both fails on the strict object.
 */
export const ApiErrorResponseSchema = z.strictObject({
  success: z.literal(false),
  error: ApiErrorSchema,
});

/**
 * The success branch for a given payload schema: `{ success: true, data: T }`.
 *
 * Pass the schema of what the handler actually returns — `apiSuccessResponseSchema(z.null())` for
 * the mutating routes, `apiSuccessResponseSchema(z.array(BudgetCategorySchema))` for
 * `GET /api/categories`. `data` is required even when its schema is `z.null()`: `{ success: true }`
 * with no `data` key is not a response any handler here produces.
 */
export function apiSuccessResponseSchema<T extends z.ZodType>(dataSchema: T) {
  return z.strictObject({
    success: z.literal(true),
    data: dataSchema,
  });
}

/**
 * The full envelope for a given payload schema — the runtime counterpart of `ApiResponse<T>`.
 *
 * Exactly the two shapes every route returns, and nothing else: no third branch, no branch that
 * carries both keys, no branch whose discriminant is a string.
 */
export function apiResponseSchema<T extends z.ZodType>(dataSchema: T) {
  return z.union([apiSuccessResponseSchema(dataSchema), ApiErrorResponseSchema]);
}
