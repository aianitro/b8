/**
 * The rules for credentials that do not live in a browser cookie — pure, so every one is testable
 * without a database or a request.
 *
 * P1-12a. Two new kinds of session sit beside the browser's cookie session, in the same
 * `auth_sessions` table and resolved by the same lookup:
 *
 *   browser   — the existing cookie session. 12 hours, fixed.
 *   device    — a phone app signed in with a passkey. Sent as `Authorization: Bearer`. 30 days,
 *               SLIDING: every use pushes the expiry out, so an app in daily use never signs out.
 *   personal  — a token the owner mints over SSH for a script (Month 4's eval runner). Named,
 *               listed, revocable, optionally READ-ONLY, and with a fixed lifetime.
 *
 * ─── Why one table and not three ──────────────────────────────────────────────────────────────
 *
 * Each would be a second answer to "is this caller allowed in", and the one thing this repo has
 * been bitten by repeatedly is two definitions of one fact. A `kind` column keeps one lookup, one
 * revocation path, one list.
 *
 * ─── Why there is no refresh token ────────────────────────────────────────────────────────────
 *
 * ROADMAP.md step 12 asked for "access+refresh". That split exists so an access token can be
 * stateless and checked without a database round trip. Every request here already does that round
 * trip, by primary key, and `revoked_at` revokes instantly — so a refresh token would add a second
 * token and a rotation protocol to buy a property the design already has. Withdrawn 2026-09-17,
 * recorded in P1-12a's ITEM.md.
 */

export type SessionKind = 'browser' | 'device' | 'personal';
export type SessionScope = 'full' | 'read';

/** A phone app's session lifetime, measured from its most recent use. */
export const DEVICE_TTL_DAYS = 30;

/** Personal-token lifetimes. A token that never expires is a credential nobody remembers minting. */
export const PERSONAL_DEFAULT_DAYS = 90;
export const PERSONAL_MAX_DAYS = 365;

/**
 * The only raw token shape this app issues: 32 CSPRNG bytes, unpadded base64url — 43 characters.
 *
 * Anything else in an Authorization header is refused before it is hashed or looked up. Not for
 * performance: a strict shape means a malformed header is a clean refusal rather than a query, and
 * it rules out a whole class of "what does the parser do with THIS" questions.
 */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * The token in an `Authorization` header, or `null`.
 *
 * `Bearer` is matched case-insensitively (RFC 6750 §2.1 says the scheme is case-insensitive) and
 * exactly one space separates it from the token. No comma-separated lists, no second scheme.
 */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer ([^\s]+)$/i.exec(header);
  if (!match) return null;
  return TOKEN_SHAPE.test(match[1]) ? match[1] : null;
}

/**
 * Which paths a bearer token may reach at all: the API, and nothing else.
 *
 * A token is for a program. Pages are for the browser, and the browser has its cookie. Letting a
 * bearer token render HTML would make a leaked script token into a way to browse the app — a
 * capability nobody minting "a token for the eval runner" would think they were handing out.
 */
export function bearerMayReach(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

/**
 * POST endpoints a READ-scoped token may still call, because they change nothing.
 *
 * Chat reads data and asks the model; it writes no row. It is the one reason a read-only token
 * exists — Month 4's eval runner has to be able to call it. It is still rate-limited like any
 * other caller.
 */
const READ_SAFE_POSTS: ReadonlySet<string> = new Set(['/api/v1/chat']);

/** Whether a session's scope allows this request. `full` allows everything the boundary allows. */
export function scopePermits(scope: SessionScope, method: string, pathname: string): boolean {
  if (scope === 'full') return true;
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return true;
  return m === 'POST' && READ_SAFE_POSTS.has(pathname.replace(/\/$/, ''));
}

/**
 * Which kinds each carrier may present.
 *
 * A cookie carries ONLY a browser session; a header carries only a device or personal session.
 * The separation is cheap and it closes two confusions: a long-lived device token pasted into a
 * cookie would get cookie protections it was never issued with, and a browser session lifted into
 * a header would outlive the tab it belonged to under a different set of assumptions.
 */
export function kindAllowedFor(carrier: 'cookie' | 'bearer', kind: SessionKind): boolean {
  return carrier === 'cookie' ? kind === 'browser' : kind !== 'browser';
}

/**
 * Whether a sign-in request may be answered with a BEARER TOKEN IN THE BODY.
 *
 * ─── The escalation this prevents ─────────────────────────────────────────────────────────────
 *
 * A browser session lives in an `httpOnly` cookie: script on the page can USE it while the page is
 * open, but cannot READ it. A device token is returned in JSON, which script can read — and send
 * anywhere — and it lasts thirty days. So if a web page could ask for device mode, a script
 * injected into that page could turn one passkey prompt into a month of access from somewhere
 * else. That is strictly more than a cookie session gives it.
 *
 * So device tokens go only to callers that are not browsers, and the test is the `Sec-Fetch-*`
 * headers: every current browser sends them on every request, and page script cannot remove them
 * — they are forbidden headers under the Fetch standard. A native app's HTTP client does not send
 * them. A browser therefore cannot obtain a device token no matter what the page asks for.
 *
 * This is a check on what the CALLER is, not on who they are — the passkey ceremony still has to
 * verify. It cannot stop a non-browser program with the owner's passkey from getting a token, and
 * it is not meant to: that program is exactly who device tokens are for.
 */
export function mayIssueDeviceToken(headers: { get(name: string): string | null }): boolean {
  return headers.get('sec-fetch-mode') === null && headers.get('sec-fetch-site') === null;
}

/** The header a native client sets to ask for a device token instead of a cookie. */
export const DEVICE_CLIENT_HEADER = 'x-b8-client';
export const DEVICE_CLIENT_VALUE = 'device';

export function wantsDeviceToken(headers: { get(name: string): string | null }): boolean {
  return headers.get(DEVICE_CLIENT_HEADER)?.toLowerCase() === DEVICE_CLIENT_VALUE;
}

/** A personal-token lifetime from a requested number of days: defaulted, bounded, whole. */
export function personalTokenDays(requested: number | undefined): number {
  if (requested === undefined) return PERSONAL_DEFAULT_DAYS;
  if (!Number.isInteger(requested) || requested < 1 || requested > PERSONAL_MAX_DAYS) {
    throw new RangeError(`a personal token lasts 1–${PERSONAL_MAX_DAYS} days; ${requested} is not allowed`);
  }
  return requested;
}
