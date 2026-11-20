// Loyalty (P8-42a, P8-42b) — what the eleven loyalty endpoints answer, stated once so they cannot drift.
//
// NOT A ROUTE. Next treats only `route.ts` as an endpoint; this file adds none.
//
// ─── WHO IS ASKING ────────────────────────────────────────────────────────────────────────────
//
// `authorize` is the boundary's own function, as in `../gifts/giftResponses.ts`. The boundary has
// already run it on every request that reaches a handler in production; running it again here means
// a handler called directly (as the integration fixtures do) refuses exactly what the boundary
// would: 401 with no valid credential, and 403 `INSUFFICIENT_SCOPE` when a read-scope token tries a
// POST or PATCH. Every write route calls `callerOf` FIRST, before it reads a body or a row, so a
// refused write changes nothing.
//
// Both b8 users are peers here: the session decides THAT a request may proceed, never WHOSE rows it
// sees. A household member is never a caller, and no route takes a member id as an identity.
//
// ─── ERROR BODIES ECHO NOTHING ────────────────────────────────────────────────────────────────
//
// A refusal's message is a fixed sentence or a schema's own message, which names a rule and never
// the submitted value — a request that sets a member number and fails must not hand the number back
// in its error body.

import type { NextRequest } from 'next/server';
import type { z } from 'zod';
import { authorize } from '@/lib/requestAuth';
import type { ActiveSession } from '@/lib/authSession';
import type { LoyaltyFailure, LoyaltyResult } from '@/lib/loyaltyStore';
import { LoyaltyIdParamSchema, type LoyaltyErrorCode } from '@b8/contracts/loyalty';

const STATUS: Record<LoyaltyErrorCode, number> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  INSUFFICIENT_SCOPE: 403,
  BROWSER_SESSION_REQUIRED: 403,
  MEMBERSHIP_EXISTS: 409,
  ALIAS_TAKEN: 409,
  MEMBER_NAME_TAKEN: 409,
  MEMBER_USER_TAKEN: 409,
  CARD_ALREADY_LINKED: 409,
};

const MESSAGE: Record<LoyaltyErrorCode, string> = {
  INVALID_INPUT: 'The request is not valid.',
  NOT_FOUND: 'No such record.',
  INSUFFICIENT_SCOPE: 'This credential may not make changes.',
  BROWSER_SESSION_REQUIRED: 'A member number can only be copied from a signed-in browser.',
  MEMBERSHIP_EXISTS: 'That member already holds that program.',
  ALIAS_TAKEN: 'Another program already uses one of those names.',
  MEMBER_NAME_TAKEN: 'Another household member already has that name.',
  MEMBER_USER_TAKEN: 'Another household member is already linked to that user.',
  CARD_ALREADY_LINKED: 'That card already earns into another membership. Unlink it there first.',
};

/** A refusal as a response. One body shape for every code and every route. */
export function failure(f: LoyaltyFailure): Response {
  return Response.json(
    { success: false, error: { code: f.code, message: f.message ?? MESSAGE[f.code] } },
    { status: STATUS[f.code] }
  );
}

export const invalid = (message?: string): Response => failure({ ok: false, code: 'INVALID_INPUT', message });

export const ok = (data: unknown, status = 200): Response => Response.json({ success: true, data }, { status });

/** A store outcome as a response. */
export const answer = <T>(result: LoyaltyResult<T>, status = 200): Response =>
  result.ok ? ok(result.value, status) : failure(result);

/**
 * The signed-in session, or the boundary's refusal as a response. Called first by every handler.
 */
export async function callerOf(req: NextRequest): Promise<ActiveSession | Response> {
  const decision = await authorize(req);
  if (decision.ok) return decision.session;
  const message = decision.status === 401 ? 'This request carried no valid session.' : MESSAGE.INSUFFICIENT_SCOPE;
  return Response.json({ success: false, error: { code: decision.code, message } }, { status: decision.status });
}

/** An `[id]` path segment as a positive int4, or null for anything malformed (answered 400). */
export function idFrom(raw: string): number | null {
  return LoyaltyIdParamSchema.safeParse(raw).success ? Number(raw) : null;
}

/**
 * A request body checked against its contract schema. The message is the first issue's own, which
 * the contract writes as a rule ("a member number is at most 64 characters"), never as the value.
 */
export async function bodyOf<S extends z.ZodType>(
  req: NextRequest,
  schema: S
): Promise<{ ok: true; value: z.infer<S> } | { ok: false; response: Response }> {
  const raw = await req.json().catch(() => undefined);
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
  return { ok: false, response: invalid(`${where}${issue?.message ?? 'invalid body'}`) };
}
