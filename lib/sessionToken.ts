// The session cookie: what it is called, how long it lives, how its value is generated, and how
// that value is turned into the thing the database is allowed to hold.
//
// PURE, AND DELIBERATELY DATABASE-FREE. Nothing here opens a connection or knows a table exists —
// `lib/authSession.ts` is what writes and reads rows. The split is what lets the entropy and
// cookie-attribute fixtures (SPEC.md F5, F6) run under the pure config with no Postgres, and it is
// the same shape `lib/testDbGuard.ts` uses for the same reason.
//
// WHY THE COOKIE NAME AND THE TTL LIVE HERE AND NOT IN `shared/contracts/`. The cookie is
// `HttpOnly`, so its only readers are the boundary and the handlers — all server code. A policy
// constant with no client consumer in the wire-contract directory would start that directory
// meaning "all the shared values"; the guardian's CONTRACT.md records the same line being drawn
// for `AlertKind`.

import { createHash, randomBytes } from 'node:crypto';

/** The cookie the boundary reads on every request that is not one of the five pre-auth surfaces. */
export const SESSION_COOKIE_NAME = 'b8_session';

/**
 * How long a session is valid for, in seconds.
 *
 * Twelve hours: long enough that the owner is not re-authenticating inside one sitting, short
 * enough that a cookie lifted off a machine has a bounded life. It is ABSOLUTE — `expires_at` is
 * written once at creation from Postgres's own clock and is never extended in place, because a
 * sliding expiry rewritten on each request makes a stolen cookie immortal for exactly as long as
 * somebody keeps using it.
 *
 * This is the server-side authority. The cookie's `Max-Age` is derived from it below rather than
 * stated a second time, so the two cannot disagree — and the direction of the guarantee matters:
 * a browser that ignored `Max-Age` entirely would still be refused by the row's `expires_at`.
 */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

/**
 * How many random bytes a session identifier carries.
 *
 * 32 bytes = 256 bits, comfortably over SPEC.md F5's 128-bit floor. The value is the bearer
 * credential itself — anything holding it is signed in — so it is CSPRNG output and nothing else.
 * `Math.random()` is a linear generator whose internal state is recoverable from a handful of
 * outputs; SPEC.md's negative control #8 is an AST proof that no file this diff adds under `lib/`
 * calls it.
 */
const SESSION_TOKEN_BYTES = 32;

/**
 * A fresh session identifier: unpadded base64url over 32 CSPRNG bytes.
 *
 * base64url because the value travels in a cookie and a cookie value may not contain `=` without
 * quoting — the same encoding decision the credential id takes, for a different reason.
 */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

/**
 * The digest the database stores for a token: SHA-256, lowercase hex.
 *
 * THE RAW TOKEN NEVER REACHES POSTGRES. `auth_sessions.token_hash` carries
 * `CHECK (token_hash ~ '^[0-9a-f]{64}$')`, so storing the cookie value verbatim is a statement the
 * database refuses rather than a convention a caller can forget — but the reason behind the CHECK
 * is worth restating at the one place that computes the value: a session table stored in the clear
 * is a table of live logins, and a session table is exactly what somebody reads in a `psql`
 * scrollback while debugging.
 *
 * No HMAC and no server secret. The token is 256 bits of CSPRNG output, so there is nothing to
 * brute-force back out of the digest, and a keyed digest would add a rotation failure mode — every
 * session invalidated the day the key changes — for a property this already has.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * The cookie attributes, in the shape `NextResponse.cookies.set()` takes.
 *
 * `httpOnly` — always. The value is a bearer credential; script that can read it can replay it,
 * and this app renders financial data on every page that script could run on.
 *
 * `sameSite: 'lax'` — EXPLICIT, never absent and never `'none'`. Absent means the browser picks,
 * and browsers disagree about the default; `'none'` would attach the session to cross-site
 * requests, which is the CSRF hole this attribute exists to close. `'lax'` rather than `'strict'`
 * so a top-level navigation back into the app from elsewhere still arrives signed in — the
 * ceremony endpoints are all POSTs, which `'lax'` does not attach to cross-site anyway.
 *
 * `maxAge` — the server-side TTL exactly, never longer. A cookie that outlives its row is a cookie
 * the browser keeps presenting to a boundary that will refuse it.
 *
 * NO `Secure` ATTRIBUTE, and it is an explicit non-goal rather than an oversight (SPEC.md, "No
 * `Secure` cookie attribute mandate"): the app is served over plain HTTP until Phase 2 supplies
 * TLS, and a `Secure` cookie set today would simply never be sent back. The Phase 2 task that adds
 * TLS adds it here, in one line, at the one place cookie policy is expressed.
 */
export interface SessionCookieSpec {
  name: string;
  value: string;
  httpOnly: boolean;
  sameSite: 'lax' | 'strict';
  path: string;
  maxAge: number;
}

export function sessionCookie(token: string): SessionCookieSpec {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}

/**
 * The cookie that removes the session from the browser.
 *
 * `maxAge: 0` with an empty value, and the same attributes otherwise — a cookie is only replaced by
 * one matching on name, path and domain, so an expiry written with a different `path` leaves the
 * original in place.
 *
 * CLEARING THIS IS NOT LOGGING OUT. `POST /api/v1/auth/logout` revokes the row first; this is the
 * client-side half, and on its own it would pass "logout returns 200" while the lifted cookie kept
 * working — SPEC.md's I9 replays exactly that cookie.
 */
export function clearedSessionCookie(): SessionCookieSpec {
  return {
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  };
}
