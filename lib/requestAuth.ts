import { resolveSession, touchSession, type ActiveSession } from './authSession';
import { bearerMayReach, kindAllowedFor, parseBearer, scopePermits } from './bearerAuth';
import { SESSION_COOKIE_NAME } from './sessionToken';

/**
 * Who a request is, from whichever credential it carries — the ONE place that decides.
 *
 * `proxy.ts` calls `authorize` on every request; handlers call `credentialFrom` when they need the
 * session itself (logout, the registration gate). Both go through `identify`, so the boundary and a
 * handler cannot disagree about whether a request is signed in — the split P1-12 was careful to
 * avoid for cookies, kept for bearer tokens.
 *
 * ─── The precedence rule ──────────────────────────────────────────────────────────────────────
 *
 * AN AUTHORIZATION HEADER, IF PRESENT, IS THE ONLY CREDENTIAL CONSIDERED. A request with a bad
 * bearer token and a good cookie is refused, not waved through on the cookie. Falling back would
 * mean a client that believes it is authenticating as a script is actually authenticating as
 * whichever browser session happens to share its cookie jar — and that a revoked token keeps
 * working anywhere a cookie is also present.
 */

type RequestLike = {
  headers: { get(name: string): string | null };
  cookies: { get(name: string): { value: string } | undefined };
  method: string;
  nextUrl: { pathname: string };
};

export type AuthDecision =
  | { ok: true; session: ActiveSession }
  | { ok: false; status: 401; code: 'UNAUTHENTICATED' }
  | { ok: false; status: 403; code: 'INSUFFICIENT_SCOPE' };

const UNAUTHENTICATED = { ok: false, status: 401, code: 'UNAUTHENTICATED' } as const;

async function identify(request: RequestLike): Promise<ActiveSession | null> {
  const authorization = request.headers.get('authorization');

  if (authorization !== null) {
    if (!bearerMayReach(request.nextUrl.pathname)) return null;
    const token = parseBearer(authorization);
    if (!token) return null;
    const session = await resolveSession(token);
    return session && kindAllowedFor('bearer', session.kind) ? session : null;
  }

  const session = await resolveSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  return session && kindAllowedFor('cookie', session.kind) ? session : null;
}

/** The boundary's question: may this request proceed at all? */
export async function authorize(request: RequestLike): Promise<AuthDecision> {
  const session = await identify(request);
  if (!session) return UNAUTHENTICATED;

  if (!scopePermits(session.scope, request.method, request.nextUrl.pathname)) {
    return { ok: false, status: 403, code: 'INSUFFICIENT_SCOPE' };
  }

  await touchSession(session.tokenHash);
  return { ok: true, session };
}

/** A handler's question: which session is this? No scope check — the boundary already made it. */
export async function credentialFrom(request: RequestLike): Promise<ActiveSession | null> {
  return identify(request);
}
