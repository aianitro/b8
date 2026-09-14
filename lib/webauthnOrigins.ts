// The server's fixed WebAuthn relying-party configuration: which origins a ceremony may have
// happened on, which relying-party ids it may name, and the one stable user handle this
// single-principal app enrols everything under.
//
// EVERY VALUE HERE IS DERIVED FROM `lib/hostGuard.ts` OR IS A CONSTANT. Nothing in this file
// reads a request, a header, a `clientDataJSON`, or anything else an attacker can put in a
// payload, and no function exported here takes a request-shaped argument — there is nothing to
// pass one to. That is deliberate and structural rather than a matter of discipline: SPEC.md's
// F8/F13 and negative control #4 exist because `expectedOrigin` computed from
// `request.headers.get('origin')` "for convenience" makes origin-binding a no-op while every
// other fixture in the suite still passes. `clientDataJSON.origin` is attacker-supplied JSON
// INSIDE the very payload being verified; a relying party that reads it is checking a value
// against itself.
//
// DERIVED, NOT COPIED, and that is the second half of the rule. SPEC.md names "the WebAuthn
// origin set hand-copied from the host allowlist" as a failure that passes today and drifts the
// next time either list changes. The two lists cannot simply be equal — a WebAuthn relying-party
// id must be a domain, so `127.0.0.1`, `[::1]` and `0.0.0.0` are legitimate Host entries that can
// never be RP ids — so the smaller set is COMPUTED from the larger by a rule stated once, below.
// Adding a hostname to the guard moves this set with it; it cannot be forgotten.

import { ALLOWED_HOSTNAMES } from './hostGuard';

/**
 * The port `next dev` and `next start` bind (package.json's scripts pass only `-H`, so this is
 * Next's default).
 *
 * A WebAuthn origin is matched as a whole string, port included, so this has to be stated
 * somewhere. It is a constant rather than `process.env.PORT` because an origin read out of the
 * environment is an origin that changes without a diff, and the failure mode of the wrong value
 * is a browser `SecurityError` with no server-side trace. If the app is ever served on another
 * port, this is the line to change — and the change is visible in review, which is the point.
 */
export const APP_PORT = 3000;

/** The relying party's display name — what the authenticator shows the owner at enrolment. */
export const RELYING_PARTY_NAME = 'B8 Finance';

/**
 * The owner's user handle: a fixed constant, and emphatically not a column.
 *
 * A table holding one handle forever is a users table under another name, and this step's
 * migration refuses one at length (see `migrations/1789300800000_…`). So the handle lives here.
 *
 * IT MUST NEVER BE REGENERATED. A handle that changes per ceremony makes every registration look
 * like a different user to the authenticator, so a platform authenticator silently creates a
 * SECOND passkey instead of recognising the first, and the owner ends up with a credential list
 * that grows on every visit. That is why this is a literal and not a `randomUUID()` call behind a
 * memo — a memo is per-process, and this app restarts.
 *
 * The value is opaque by construction (it is a handle, not an identifier anyone reads) and is
 * base64url so it satisfies `base64url` in `shared/contracts/auth.ts` unchanged.
 */
export const OWNER_USER_HANDLE = 'b8-owner';

/** What the authenticator shows beside the handle. Single-user, so both are constants. */
export const OWNER_USER_NAME = 'owner';

/**
 * True when `hostname` can be a WebAuthn relying-party id.
 *
 * The specification requires a valid domain string; browsers refuse an address literal outright
 * with an opaque `SecurityError`. `localhost` is deliberately admitted — it is a domain, browsers
 * grant it the secure-context exemption, and it is what this app runs under until Phase 2 supplies
 * TLS.
 *
 * The same refusal is encoded in `relyingPartyId` in `shared/contracts/auth.ts`, so an IP literal
 * that reached the ceremony options would fail the contract as well as this filter. Two
 * independent statements of one rule is usually the defect this repo hunts; here it is deliberate
 * belt-and-braces at a boundary where the cost of the rule failing is a silently different
 * relying party, and the contract's copy is documented as the schema-level half of it.
 */
function isRelyingPartyIdCandidate(hostname: string): boolean {
  if (hostname.includes('[') || hostname.includes(']') || hostname.includes(':')) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  return hostname.length > 0;
}

/**
 * The relying-party ids for a set of hostnames: every entry that could be one, in the order the
 * host allowlist states them.
 *
 * Takes the host set as an ARGUMENT rather than closing over `ALLOWED_HOSTNAMES`, so a fixture can
 * hand it a fabricated allowlist and prove the RULE rather than today's output. The exported
 * constant below is this function applied to the real set — which is what makes "derived" a
 * property a test can check by re-deriving, instead of a claim in a comment.
 */
export function relyingPartyIdsFrom(hostnames: Iterable<string>): string[] {
  return [...hostnames].filter(isRelyingPartyIdCandidate);
}

/**
 * The origin a ceremony on `hostname` must have come from.
 *
 * `http` for `localhost`, `https` for everything else, and the asymmetry is WebAuthn's rather
 * than this app's: a ceremony only runs in a secure context, and `localhost` is the single
 * exemption browsers grant. The tailnet hostname therefore appears as `https://…` even though
 * Phase 2 has not supplied TLS yet — an `http://` entry for it would be an origin no browser can
 * ever produce, which is worse than an entry that does not work yet: it would look like
 * configured support for a flow that fails with `SecurityError` at the authenticator.
 *
 * The port is attached only where it is not the scheme's default, because a browser omits a
 * default port from `clientDataJSON.origin` and the comparison is a whole-string one.
 */
function originFor(hostname: string): string {
  return hostname === 'localhost' ? `http://${hostname}:${APP_PORT}` : `https://${hostname}`;
}

/**
 * The expected-origin set for a set of hostnames. Same derivation discipline as
 * `relyingPartyIdsFrom` — and it is built ON that function, so an origin can never exist for a
 * host that is not an acceptable relying party.
 */
export function expectedOriginsFrom(hostnames: Iterable<string>): string[] {
  return relyingPartyIdsFrom(hostnames).map(originFor);
}

/**
 * Every relying-party id this server accepts, derived from the Host allowlist.
 *
 * `@simplewebauthn/server` accepts an array for `expectedRPID`, so both entries are live at once
 * and the app does not have to guess which name the browser used.
 */
export const EXPECTED_RP_IDS: readonly string[] = relyingPartyIdsFrom(ALLOWED_HOSTNAMES);

/** Every origin this server accepts a ceremony from, derived from the same allowlist. */
export const EXPECTED_ORIGINS: readonly string[] = expectedOriginsFrom(ALLOWED_HOSTNAMES);

/**
 * The relying-party id the server PUTS IN the options it issues.
 *
 * One value has to be chosen at issue time — `rp.id` is a single string in the ceremony options —
 * whereas verification accepts the whole set. `localhost` is first in the allowlist and is the
 * only name the app is reachable under today; when Phase 2 binds the tailnet interface, the page
 * served over the tailnet will need this to be the tailnet name, which is the one thing in this
 * file that a future task must revisit rather than inherit. Recorded here so that revisit is a
 * decision and not a bug report.
 */
export const PRIMARY_RP_ID: string = EXPECTED_RP_IDS[0];
