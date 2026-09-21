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
import type { ActiveSession } from '@/lib/authSession';
import { credentialFrom } from '@/lib/requestAuth';
import { createLogger } from '@/lib/logger';
import { clearedSessionCookie, sessionCookie } from '@/lib/sessionToken';
import type { ApiResponse } from '@b8/contracts/types';

/**
 * The session a request carries, or `null`.
 *
 * The same lookup the boundary performs, through the same module — and the handlers perform it
 * AGAIN rather than trusting a header the proxy might have set. A trusted header is a header a
 * caller can send: `NextResponse.next({ request: { headers } })` is invisible from inside the
 * handler, so "the proxy said so" and "the client said so" would be the same sentence. The cost is
 * one indexed primary-key lookup on a table with one row per sign-in.
 *
 * It does not catch. A lookup that cannot reach Postgres throws, and a throw becomes a 500 — a
 * refusal, which is the direction a failure here must take. `withEnvelope` is what turns the throw
 * into a 500 that a client can actually read; the refusal is unchanged.
 */
export async function sessionFrom(request: NextRequest): Promise<ActiveSession | null> {
  // P1-12a: through the same function the boundary uses, so a bearer token that the boundary
  // admitted is the session a handler sees — a phone app can sign out, and can enrol a second
  // device, exactly as a browser can.
  return credentialFrom(request);
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

/**
 * A completed ceremony for a NATIVE client: the device token in the body, and no cookie.
 *
 * Only reachable after the handler has checked `mayIssueDeviceToken` — the caller carries no
 * `Sec-Fetch-*` headers, so it is not a browser. See DeviceSessionSchema for why that matters.
 * `Cache-Control: no-store` because the body is a credential and nothing between here and the app
 * should keep a copy.
 */
export function deviceSessionIssued(session: { token: string; expiresAt: string }): NextResponse {
  return NextResponse.json(
    { success: true, data: session } satisfies ApiResponse<{ token: string; expiresAt: string }>,
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

/** A completed logout: the same envelope, with the cookie removed from the browser. */
export function sessionCleared(): NextResponse {
  const response = NextResponse.json({ success: true, data: null } satisfies ApiResponse<null>);
  response.cookies.set(clearedSessionCookie());
  return response;
}

const log = createLogger('auth');

/**
 * Wraps a handler so that a throw becomes a 500 CARRYING THE ENVELOPE, rather than a 500 carrying
 * nothing.
 *
 * ─── The defect this exists to close, which was found the slow way ────────────────────────────
 *
 * On 2026-09-14 the owner could not sign in. The passkey migration had never been applied to the
 * real database, so `countCredentials()` threw on a missing relation, Next turned the throw into a
 * 500 with an EMPTY BODY, and `app/login/page.tsx` — which calls `.json()` on the response like
 * every other client in this app — failed with "Unexpected end of JSON input". That string names
 * the parser, not the problem, and it is two layers away from "a table does not exist".
 *
 * The status was never wrong. A 500 is the correct refusal and it stays a 500. What was wrong is
 * that the one surface with no session, no other diagnostic, and a human waiting on it was the
 * only surface in the app that answered with nothing at all.
 *
 * ─── Why the detail is conditioned on the environment ─────────────────────────────────────────
 *
 * The full error text goes to the log ALWAYS, because that is where an operator looks and it is not
 * a surface anyone can reach over the network. It also reaches the CLIENT outside production,
 * because these are unauthenticated endpoints: `login/options` answers before anyone has proved
 * anything, so in production its body is readable by whatever can reach the port, and a Postgres
 * error routinely quotes a relation name, a column list, or a connection target. In development
 * that audience is the owner with the browser open, and withholding the one sentence that explains
 * the failure is how this bug cost an afternoon.
 *
 * Applied to all five auth handlers and nowhere else. The rest of the API already returns the
 * envelope from its own catch blocks; these five were written to let the throw escape.
 */
/**
 * Generic over the handler's ARITY, not fixed to one argument.
 *
 * `login/options` genuinely takes no request — it reads nothing off it — and its own test calls
 * `POST()` with no argument. A wrapper typed `(request: NextRequest) => ...` would force a
 * parameter onto a handler that does not want one and break that call, so the tuple is preserved
 * and each route keeps the signature it actually has.
 */
export function withEnvelope<A extends [NextRequest] | []>(
  handler: (...args: A) => Promise<NextResponse>
): (...args: A) => Promise<NextResponse> {
  return async (...args: A): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      // `args[0]` is absent for the handlers that take no request, so the path is optional here
      // rather than reached for. A logger line that throws inside a catch block loses the error it
      // was called to report.
      const path = args[0] ? new URL(args[0].url).pathname : undefined;
      log.error('auth handler threw', { path, error: detail });
      return authError(
        'SERVER_ERROR',
        process.env.NODE_ENV === 'production'
          ? 'Something went wrong on the server. Check the server log.'
          : `Something went wrong on the server: ${detail}`,
        500
      );
    }
  };
}
