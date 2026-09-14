// The HTTP shaping the five auth endpoints share: how a session is read off a request, and the
// three response shapes they return.
//
// HTTP ONLY, deliberately. The rule lives in `lib/registrationGate.ts`, the statements live in
// `lib/authSession.ts`, and the verification lives in `lib/webauthnVerify.ts` — all three under
// `lib/`, which is what `vitest.config.mts` collects. Logic placed in this directory is logic the
// repo's pure suite cannot reach; `app/api/v1/overview/route.ts` states the same rule at the top of
// itself and this file follows it.
//
// This file is not a route. Next treats only `route.ts` and `page.tsx` as surfaces, so a helper
// beside them is a plain module and adds no endpoint.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveSession, type ActiveSession } from '@/lib/authSession';
import { SESSION_COOKIE_NAME, clearedSessionCookie, sessionCookie } from '@/lib/sessionToken';
import type { ApiResponse } from '@/shared/types';

/**
 * The session a request carries, or `null`.
 *
 * The same lookup the boundary performs, through the same module — and the handlers perform it
 * AGAIN rather than trusting a header the proxy might have set. A trusted header is a header a
 * caller can send: `NextResponse.next({ request: { headers } })` is invisible from inside the
 * handler, so "the proxy said so" and "the client said so" would be the same sentence. The cost is
 * one indexed primary-key lookup on a table with one row per sign-in.
 *
 * It does not catch. A lookup that cannot reach Postgres throws, Next turns the throw into a 500,
 * and a 500 is a refusal — which is the direction a failure here must take.
 */
export async function sessionFrom(request: NextRequest): Promise<ActiveSession | null> {
  return resolveSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

/**
 * The error branch, in the envelope every handler in this app returns.
 *
 * `shared/contracts/auth.ts` names the three codes this surface defines and keeps them a documented
 * SUBSET rather than a closed vocabulary, so `INVALID_INPUT` and `DB_ERROR` — shared with the rest
 * of the API — are equally legal here.
 */
export function authError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json(
    { success: false, error: { code, message } } satisfies ApiResponse<never>,
    { status }
  );
}

/**
 * A completed ceremony: `{ success: true, data: null }`, plus the session cookie.
 *
 * `data` IS NULL AND THERE IS NO `verified` FIELD. `CeremonyVerifiedResponseSchema` is
 * `apiResponseSchema(z.null())`, so `{ success: true, data: { verified: false } }` cannot be
 * expressed against the contract at all — that payload reads fine and lets a client which branches
 * on `success` alone treat a failed login as a login. A ceremony that does not verify is the ERROR
 * branch, which is why the only thing this function can do is succeed.
 */
export function ceremonyCompleted(sessionToken: string): NextResponse {
  const response = NextResponse.json({ success: true, data: null } satisfies ApiResponse<null>);
  response.cookies.set(sessionCookie(sessionToken));
  return response;
}

/** A completed logout: the same envelope, with the cookie removed from the browser. */
export function sessionCleared(): NextResponse {
  const response = NextResponse.json({ success: true, data: null } satisfies ApiResponse<null>);
  response.cookies.set(clearedSessionCookie());
  return response;
}
