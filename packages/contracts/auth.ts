// The five surfaces a browser may reach before a session exists, and the one body the boundary
// returns to everything else.
//
// WHAT THIS FILE IS FOR, and what it deliberately is not. `@simplewebauthn/server` already owns the
// definitive TypeScript types for a WebAuthn ceremony; re-declaring them here would be a second
// definition of one concept — the defect BUILD.md §1 opens with, and the one this repo has already
// paid for once with two "pick the newest valuation" reducers. So these schemas do NOT attempt to
// restate the library's types. They pin the far smaller set of facts that this application is
// responsible for and the library is not:
//
//   * that the ceremony objects this app AUTHORS carry the fields the ceremony cannot proceed
//     without, in particular a relying-party id the server chose rather than the browser inferred;
//   * that a failed ceremony is an ERROR envelope and never a success envelope carrying a negative
//     result — the distinction a client which branches on `success` alone gets wrong;
//   * that every one of these endpoints speaks the same `ApiResponse` envelope as the other 28
//     routes, so a client's error handling is uniform across the API and across the boundary that
//     refuses to reach it.
//
// EVERY OBJECT HERE IS LOOSE (`z.looseObject`), WHICH IS THE OPPOSITE OF THE ENVELOPE'S CHOICE, and
// the difference is load-bearing rather than an inconsistency. The envelope is `z.strictObject`
// because this application authors it end to end and nothing legitimately adds a key to it. A
// ceremony object is authored by a browser at one end and a library at the other, and both add keys
// this app has never heard of — `clientExtensionResults`, `authenticatorAttachment`, `hints`,
// whatever the next level of the spec introduces. A STRIPPING schema would be worse than a strict
// one here, and quietly: `.parse()` returns the stripped value, so a handler that parses the
// request body and then hands the RESULT to the verifier hands it a payload with
// `response.transports` removed, loses the transports it was about to store, and nothing fails
// until a second device is offered the wrong affordance. Loose objects keep unknown keys, so the
// parsed value is safe to pass on. Parse to REFUSE malformed input, never to reshape it.
//
// Layering: this module imports `zod` and `./envelope`, and nothing else. No `next/server`, no
// `pg`, no `@/lib/db`, no `lib/**` — not even `import type`, for the reason P1-11's CONTRACT.md
// recorded: a type-only import is erased at runtime but is a real import node in the AST, and the
// checks that prove the contract surface cannot reach a connection pool parse exactly those nodes.
// Imports are relative, matching this directory, because vitest registers no tsconfig-paths
// resolver.

import { z } from 'zod';
import { ApiErrorResponseSchema, apiResponseSchema } from './envelope';
import { timestamptz } from './representation';

/**
 * Unpadded base64url — the one encoding every binary value in a WebAuthn JSON payload arrives in.
 *
 * The alphabet is `A-Z a-z 0-9 - _`, with no `=` padding. Standard base64's `+` and `/` are
 * refused, and so is padding, because "base64url versus base64, padded versus unpadded" is the
 * classic WebAuthn round-tripping bug and it is invisible until a credential lookup silently
 * matches nothing. `webauthn_credentials.credential_id` carries the identical CHECK at the column,
 * so the same rule holds at both ends of the round trip rather than in one of them.
 *
 * Deliberately not added to `representation.ts`. That file names how a POSTGRES value reaches a
 * consumer, measured against `pg`; this is a WebAuthn wire convention that has nothing to do with
 * the driver, and it is also outside the surface this task declared.
 */
export const base64url = z
  .string()
  .min(1, 'a base64url value may not be empty')
  .regex(/^[A-Za-z0-9_-]+$/, 'expected unpadded base64url — no "+", no "/", no "=" padding');

/**
 * A ceremony challenge: base64url, and at least 16 bytes of it.
 *
 * 22 characters is 16 bytes unpadded, which is the WebAuthn specification's stated minimum. The
 * bound is here for the same reason SPEC.md's F5 puts a floor under the session identifier's
 * entropy: a challenge is the only thing standing between a replayed assertion and a fresh one, and
 * a short challenge passes every "the challenge did not match" negative control while being
 * guessable. The upper end is unconstrained — a longer challenge is never a defect.
 */
export const challengeString = base64url.min(
  22,
  'a WebAuthn challenge carries at least 16 bytes of entropy — 22 unpadded base64url characters'
);

/**
 * A WebAuthn Relying Party ID: a domain, never an IP literal and never a URL.
 *
 * This is the schema-level half of SPEC.md's rule that the WebAuthn origin set is *derived from*
 * the host-guard allowlist rather than equal to it. The host guard legitimately admits
 * `127.0.0.1`, `[::1]` and `0.0.0.0`; none of those can ever be an RP ID, because the WebAuthn
 * specification requires a valid domain string and browsers refuse an address literal outright.
 * Encoding the refusal here means the smaller set cannot be produced by copying the larger one —
 * the copy fails to validate instead of failing in a browser with an opaque `SecurityError`.
 *
 * `localhost` is deliberately accepted: it is a domain, browsers grant it the secure-context
 * exemption, and it is the RP ID the app runs under until Phase 2 supplies TLS.
 *
 * What this CANNOT check, stated so nobody reads it as more than it is: whether the value was taken
 * from the server's fixed configuration or lifted out of the incoming request's `Host` header. Both
 * produce a domain string. The schema forbids the impossible values; only SPEC.md's F3 and F8/F13
 * forbid the wrong provenance.
 */
export const relyingPartyId = z
  .string()
  .min(1, 'a relying-party id may not be empty')
  .refine(
    (id) =>
      !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(id) &&
      !id.includes(':') &&
      !id.includes('[') &&
      !id.includes('/'),
    'a WebAuthn relying-party id is a bare domain — never an IP literal, a port, or a URL'
  );

/**
 * The creation options `POST /api/v1/auth/register/options` hands the browser.
 *
 * `rp.id` IS REQUIRED, and that single decision is most of the value in this schema. The library's
 * own type makes it optional, and when it is absent the BROWSER fills it in from the page's own
 * origin — which is precisely "derived from the request", the textbook relying-party mistake
 * SPEC.md names, arriving through omission rather than through a line of code anyone would review.
 * A response missing it cannot satisfy this schema, so the omission is a failure here rather than a
 * silently different relying party in the field.
 *
 * `user.id` is the signing-up user's stable WebAuthn handle. Until P7-41a it was one fixed constant in
 * `lib/` for the only principal, and the owner's existing passkeys were enrolled under it, so the
 * owner's handle must stay exactly that constant. Since P7-41a there is a second user, whose handle
 * must DIFFER from the owner's: two people enrolling under one handle on a shared password manager
 * makes the second enrolment silently REPLACE the first person's passkey. It must be STABLE across ceremonies —
 * a handle regenerated per request makes every registration look like a different user to the
 * authenticator, so a platform authenticator silently creates a second passkey instead of
 * recognising the first, and the owner ends up with a credential list that grows on every visit.
 *
 * `excludeCredentials` is optional because the bootstrap ceremony genuinely has nothing to exclude,
 * and the library omits the key for an empty list. On every subsequent registration it should carry
 * the credentials already stored; omitting it there is not a schema failure and lets one
 * authenticator enrol twice.
 */
export const RegistrationCeremonyOptionsSchema = z.looseObject({
  rp: z.looseObject({
    name: z.string().min(1, 'the relying party needs a display name'),
    id: relyingPartyId,
  }),
  user: z.looseObject({
    id: base64url,
    name: z.string().min(1),
    displayName: z.string(),
  }),
  challenge: challengeString,
  pubKeyCredParams: z
    .array(z.looseObject({ alg: z.int(), type: z.literal('public-key') }))
    .min(1, 'a registration ceremony must offer at least one algorithm'),
});

/**
 * The request options `POST /api/v1/auth/login/options` hands the browser.
 *
 * `rpId` is required for the same reason `rp.id` is above, and the omission has the same
 * consequence: the browser infers it from the page.
 *
 * `allowCredentials` is optional, because a discoverable-credential flow legitimately sends none.
 * Where it IS sent it must list EVERY stored credential, not the newest one — SPEC.md's failure
 * mode "a second device registers but can never log in" is exactly a query that reduced this list
 * to one row, and it is invisible on a single-device setup, which is every setup on day one. No
 * schema can tell a complete list from a truncated one, so this is a comment and an integration
 * fixture's job rather than a constraint.
 */
export const AuthenticationCeremonyOptionsSchema = z.looseObject({
  challenge: challengeString,
  rpId: relyingPartyId,
});

/**
 * The body `POST /api/v1/auth/register/verify` receives from the browser.
 *
 * Loose at both levels on purpose — see this file's header. The four fields named here are the ones
 * verification cannot proceed without; everything else the browser sends rides through untouched
 * and reaches the verifier, including `response.transports`, which is stored, and
 * `clientExtensionResults`, which the library's type wants and this app reads no value out of.
 * `clientExtensionResults` is therefore not required here: refusing a payload for omitting a field
 * nothing in this app consumes would reject a fixture before it reached the verifier that is the
 * actual authority on validity.
 *
 * Note what this schema emphatically does NOT do: it does not check the signature, the origin, the
 * challenge, or the relying party. A payload that parses cleanly here is still entirely
 * attacker-controlled — `clientDataJSON` is attacker-supplied JSON INSIDE the very thing being
 * verified. Structural validity is not authentication, and the only thing that is,
 * is `verifyRegistrationResponse` called against the server's own fixed expected origin and the
 * challenge the server issued for this attempt.
 */
export const RegistrationCeremonyResponseSchema = z.looseObject({
  id: base64url,
  rawId: base64url,
  type: z.literal('public-key'),
  response: z.looseObject({
    clientDataJSON: base64url,
    attestationObject: base64url,
  }),
});

/**
 * The body `POST /api/v1/auth/login/verify` receives from the browser.
 *
 * Same loose shape, same disclaimer: parsing proves nothing about who sent it.
 *
 * `userHandle` is nullable and optional — a non-discoverable credential returns none. It carries no
 * routing information in this application and must never be used to select a credential or a user:
 * the value that identifies WHICH authenticator is asserting is `id`, and the user is read from that
 * credential's row (`webauthn_credentials.user_id`). The handle is browser-supplied input inside the
 * thing being verified; resolving the user from it would let a payload name its own principal.
 */
export const AuthenticationCeremonyResponseSchema = z.looseObject({
  id: base64url,
  rawId: base64url,
  type: z.literal('public-key'),
  response: z.looseObject({
    clientDataJSON: base64url,
    authenticatorData: base64url,
    signature: base64url,
    userHandle: base64url.nullable().optional(),
  }),
});

/** `POST /api/v1/auth/register/options` — the full envelope. */
export const RegistrationOptionsResponseSchema = apiResponseSchema(RegistrationCeremonyOptionsSchema);

/** `POST /api/v1/auth/login/options` — the full envelope. */
export const AuthenticationOptionsResponseSchema = apiResponseSchema(
  AuthenticationCeremonyOptionsSchema
);

/**
 * The envelope returned by the three endpoints that CHANGE the session: `register/verify`,
 * `login/verify` and `logout`.
 *
 * `data` is `null`, exactly as every mutating handler in `app/api/**` already returns, and that is a
 * decision rather than a shrug. The only outcome any of the three produces is a cookie — set on the
 * two verifies, cleared and revoked on logout — and a body that also described the session would be
 * a second representation of a thing the client cannot read anyway (the cookie is `HttpOnly` by
 * requirement F6) and that can disagree with it. An `expiresAt` was considered and rejected on
 * P1-11's precedent: no consumer this task creates would read it.
 *
 * THE PROPERTY THIS PINS is the one a WebAuthn quick-start gets wrong: there is no
 * `{ success: true, data: { verified: false } }`. A ceremony that does not verify is the ERROR
 * branch, with a status to match. The alternative shape — a success envelope carrying a boolean —
 * reads fine and lets a client that checks `success` alone treat a failed login as a login, which
 * is the entire defect wearing a different hat. Because `data` is `z.null()`, that payload cannot
 * be expressed against this contract at all.
 */
export const CeremonyVerifiedResponseSchema = apiResponseSchema(z.null());

/**
 * What a NATIVE client receives from a completed ceremony instead of a cookie — P1-12a.
 *
 * A phone app asks for this by sending `X-B8-Client: device`, and receives it only if the request
 * carries no `Sec-Fetch-*` headers, which every browser sends and page script cannot remove. So the
 * reason `CeremonyVerifiedResponseSchema` carries no session — the cookie is HttpOnly and a body
 * copy would be readable by script — still holds for every browser. A native app has no page and no
 * script to protect against, and it needs the token in hand to put in an Authorization header.
 *
 * STRICT, because this object is a credential. A loose schema would pass through whatever else a
 * future handler put beside the token, and the one payload that must never grow quietly is the one
 * carrying a bearer secret.
 *
 * `expiresAt` is the CURRENT expiry. Device sessions slide — every authenticated request pushes
 * the expiry out to thirty days from then — so this is the floor the client can count on, not a
 * countdown it must act on. A client that simply retries sign-in on a 401 needs nothing else.
 *
 * The success envelope still cannot say "not verified": a failed ceremony is the error branch
 * here exactly as it is for the cookie form.
 */
export const DeviceSessionSchema = z.strictObject({
  token: base64url.length(43, 'a session token is 32 bytes, 43 base64url characters'),
  expiresAt: timestamptz,
});

export const DeviceSessionResponseSchema = apiResponseSchema(DeviceSessionSchema);

// ─── Users and invitations (P7-41a) ──────────────────────────────────────────────────────────────
//
// Every object below is STRICT, the envelope's choice rather than the ceremony objects'. This app
// authors each of them at both ends, and nothing legitimately adds a key: a stray `isOwner: true` on
// an invitation request is exactly the key that must be refused, not ignored.

/**
 * A user's display name: 1 to 60 characters, the bound `users.display_name` and
 * `user_invitations.display_name` carry as CHECKs, so a name this accepts is a name the INSERT
 * accepts. Not trimmed here: a schema that reshapes input hands the handler a value the client did
 * not send. Refuse, never reshape.
 */
export const UserDisplayNameSchema = z
  .string()
  .min(1, 'a display name may not be empty')
  .max(60, 'a display name is at most 60 characters');

/**
 * A user's id, as `users.id` (SERIAL) reaches a consumer: a positive integer. Opaque to every
 * consumer — tests compare it with `String(...)` — and never a WebAuthn user handle.
 */
export const UserIdSchema = z.int().positive();

/**
 * `GET /api/v1/auth/me` — who the session belongs to.
 *
 * Every field is required and none is nullable, because there is no partial answer: a request whose
 * session resolves to no user is refused (the error branch), never answered with a null user, and
 * never answered as the owner for want of a better guess. A client that cannot read this renders no
 * name at all — not "Owner".
 */
export const MeSchema = z.strictObject({
  userId: UserIdSchema,
  displayName: UserDisplayNameSchema,
  isOwner: z.boolean(),
});

export const MeResponseSchema = apiResponseSchema(MeSchema);

/**
 * An invitation code, as minted by the owner and presented in the `X-Invitation-Code` header on both
 * `register/options` and `register/verify`.
 *
 * Unpadded base64url carrying at least 16 bytes of entropy — 22 characters, the challenge's floor and
 * for a sharper version of its reason. The code is presented PRE-AUTH, to endpoints any visitor can
 * reach, and lives up to seven days; it is the only thing between a stranger and a new user on this
 * app. The database stores only its SHA-256 (`user_invitations.code_hash`), so this schema is the one
 * place its strength can be pinned. A header failing this is refused exactly as a well-formed code
 * that matches nothing is — `REGISTRATION_CLOSED` — so the format check tells a prober nothing.
 */
export const invitationCode = base64url.min(
  22,
  'an invitation code carries at least 16 bytes of entropy — 22 unpadded base64url characters'
);

/** `POST /api/v1/auth/invitations` — the body. The invitee's name, chosen by the owner. */
export const InvitationCreateRequestSchema = z.strictObject({
  displayName: UserDisplayNameSchema,
});

/**
 * `POST /api/v1/auth/invitations` — what the owner receives.
 *
 * THE RAW CODE APPEARS HERE AND NOWHERE ELSE: not in the database, not in a log line, not in any
 * later response. There is no endpoint that reads it back, so a lost code is replaced by minting
 * another, never recovered. Strict for the reason `DeviceSessionSchema` is: this object carries a
 * secret, and it is the one payload that must never grow quietly.
 *
 * `expiresAt` is the database's `user_invitations.expires_at`, at most seven days after creation.
 * It is shown so the owner knows how long they have; it is never the check. Whether a code is live is
 * decided by Postgres `NOW()` at redemption.
 */
export const InvitationCreatedSchema = z.strictObject({
  code: invitationCode,
  expiresAt: timestamptz,
});

export const InvitationCreatedResponseSchema = apiResponseSchema(InvitationCreatedSchema);

/**
 * `POST /api/v1/auth/users/[id]/revoke` — the envelope, `data: null`.
 *
 * Null for the reason `CeremonyVerifiedResponseSchema` is: the outcome is a state change the client
 * already asked for, and a body describing it would be a second representation that can disagree
 * with the database. A refusal (not the owner, the owner revoking the owner, an unknown id) is the
 * error branch, never a success carrying a negative result.
 */
export const UserRevokedResponseSchema = apiResponseSchema(z.null());

/**
 * The body the boundary returns for a request it refuses: an unauthenticated request to anything
 * outside the five allowlisted surfaces, and `POST /api/v1/auth/logout` with no session.
 *
 * This is `ApiErrorResponseSchema` itself, named at its use site rather than re-declared — one
 * object, so the boundary and the 28 handlers cannot drift into two error shapes on one API.
 *
 * It is NOT `apiResponseSchema(z.null())`, and the difference is the point: that schema would also
 * accept `{ success: true, data: null }`, and a boundary that refuses a request "successfully" is
 * indistinguishable on the wire from one that let it through. The error branch alone is the only
 * thing this surface may ever produce, so it is the only thing the contract admits.
 *
 * The boundary is not a route handler and will hand-build this body. That is exactly why it is
 * written down here: a hand-built `{ error: 'unauthorized' }` would satisfy no consumer's parser
 * and would be discovered by a client, not by a test.
 */
export const UnauthenticatedResponseSchema = ApiErrorResponseSchema;

/**
 * The error codes this surface defines, for a client that must branch on WHY it was refused.
 *
 *   `UNAUTHENTICATED`      — no session, or a cookie matching no valid row. Emitted by the
 *                            boundary, and by `logout`, which is meaningless without one.
 *   `REGISTRATION_CLOSED`  — a registration attempt with no session while at least one credential
 *                            already exists. This step's central rule, refused by name.
 *   `CEREMONY_FAILED`      — the response did not verify: wrong origin, wrong challenge, wrong key,
 *                            unknown credential. Deliberately ONE code for all four. Telling an
 *                            unauthenticated caller which axis it got wrong is free reconnaissance,
 *                            and the four are already separate fixtures (F8, F9, F11, F12) where a
 *                            test can see them and a stranger cannot.
 *
 * A SUBSET, NOT A CLOSURE. `ApiErrorResponseSchema` keeps `code` an open `z.string()` for the
 * reason envelope.ts records — closing the vocabulary means a new failure mode cannot be reported
 * until this file is amended — and this enum does not narrow it. These endpoints will also emit
 * codes they share with the rest of the API (`INVALID_INPUT`, `DB_ERROR`), so a client branching on
 * these three needs a default branch. The enum exists so that branching happens on a code rather
 * than on the text of `message`, which is not a contract and will be reworded.
 */
export const AuthErrorCodeSchema = z.enum([
  'UNAUTHENTICATED',
  'REGISTRATION_CLOSED',
  'CEREMONY_FAILED',
  // P1-12a. Authenticated, but this token's scope does not cover the request — a read-only script
  // token attempting a write. 403, not 401: signing in again would not help, and a client that
  // treats every refusal as "sign in again" would loop.
  'INSUFFICIENT_SCOPE',
  // P1-12a. A device token was requested by a caller that is a browser. See DeviceSessionSchema.
  'DEVICE_TOKEN_REFUSED',
  // P7-41a. Authenticated, but only the OWNER's full-scope browser session may invite or remove a
  // user. 403, for INSUFFICIENT_SCOPE's reason: signing in again would not help. A refused invitation
  // code is NOT this code — it is REGISTRATION_CLOSED, so a code holder learns nothing about why.
  'OWNER_ONLY',
]);

export type RegistrationCeremonyOptions = z.infer<typeof RegistrationCeremonyOptionsSchema>;
export type AuthenticationCeremonyOptions = z.infer<typeof AuthenticationCeremonyOptionsSchema>;
export type RegistrationCeremonyResponse = z.infer<typeof RegistrationCeremonyResponseSchema>;
export type AuthenticationCeremonyResponse = z.infer<typeof AuthenticationCeremonyResponseSchema>;
export type AuthErrorCode = z.infer<typeof AuthErrorCodeSchema>;
export type DeviceSession = z.infer<typeof DeviceSessionSchema>;
export type Me = z.infer<typeof MeSchema>;
export type InvitationCreateRequest = z.infer<typeof InvitationCreateRequestSchema>;
export type InvitationCreated = z.infer<typeof InvitationCreatedSchema>;
