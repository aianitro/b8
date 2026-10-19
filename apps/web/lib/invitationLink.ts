// The invitation link, both ends of it: what the owner's panel builds, and the small pure decisions
// the two screens make around it (P7-41a2).
//
// ─── Why the code rides in the FRAGMENT ───────────────────────────────────────────────────────
//
// An invitation code is a bearer secret for up to seven days: whoever holds it can become a user of
// this app. The part of a URL after `#` is the one part a browser never sends — not in the request
// line, so no server, reverse proxy or access log ever sees it, and not in a `Referer`, which is
// built from the URL with the fragment stripped. A query string would be the easy spelling (one
// hook call on the login page to read it) and would put the code in the Next dev log, any proxy's
// access log, and the Referer of every request the page makes. So the link is
// `<origin>/login#invite=<code>` and nothing else: no name, no user id, no expiry. The page cannot
// show the invitee's name, and that is the price of there being no unauthenticated endpoint that
// would tell it.
//
// ─── Why this module imports no validation library ────────────────────────────────────────────
//
// The owner's control lives in the sidebar, which ships on every page, and `Sidebar.tsx` already
// records that the shell avoids pulling `zod` in for a structural check. Everything here is plain
// string work, so the sidebar can import it for free. The one decision that needs the contract —
// whether a fragment holds a well-formed code — lives in `invitationFragment.ts`, which only the
// login page imports.

import type { InvitationCreated, Me } from '@b8/contracts/auth';

/** The fragment key the link carries the code under: `#invite=<code>`. */
export const INVITE_FRAGMENT_KEY = 'invite';

/**
 * The request header that presents a code, lower-cased as `Headers` normalises it.
 *
 * The same name the server reads (`INVITATION_HEADER` in `lib/invitations.ts`), written out here
 * rather than imported, because that module reaches the database pool and this one ships to the
 * browser. Header names are case-insensitive on the wire, so the spelling difference is not one.
 */
export const INVITATION_HEADER = 'x-invitation-code';

/**
 * The link the owner hands over: `<origin>/login#invite=<code>`.
 *
 * Built from the ORIGIN alone, so a trailing slash, a path or a query on whatever the caller passes
 * cannot end up in the link. The code is not percent-encoded because it does not need to be: a
 * well-formed code is unpadded base64url, whose alphabet is legal in a fragment as it stands, and
 * encoding it would make the page's reader see a different string from the one the server minted.
 */
export function invitationLink(origin: string, code: string): string {
  return `${new URL(origin).origin}/login#${INVITE_FRAGMENT_KEY}=${code}`;
}

/**
 * The headers a registration request carries: the code when there is one, and NOTHING otherwise.
 *
 * ABSENT, NOT EMPTY. The server tests whether the header is present, not whether it is non-empty
 * (`presented !== null` in `register/options`), so `x-invitation-code: ''` is an invitation — a dead
 * one — and is refused. Ordinary registration, and the owner adding a second device, would both
 * break on an empty header while looking identical in a request log that prints names only.
 */
export function invitationHeaders(code: string | null | undefined): Record<string, string> {
  return typeof code === 'string' && code.length > 0 ? { [INVITATION_HEADER]: code } : {};
}

/**
 * A path, with its query kept and its fragment dropped — what the address bar is rewritten to once
 * the login page has read the code out of it.
 *
 * Everything from the first `#` goes, not only an `invite=` pair, because nothing else this app puts
 * in a fragment exists on `/login`, and a partial scrub is a scrub that leaves the code behind the
 * first time someone appends a second key.
 */
export function withoutFragment(pathAndQuery: string): string {
  const hash = pathAndQuery.indexOf('#');
  return hash === -1 ? pathAndQuery : pathAndQuery.slice(0, hash);
}

/**
 * Whether the invite control is shown: only when `GET /api/v1/auth/me` answered with `isOwner`
 * strictly `true` and a real name.
 *
 * STRICTLY TRUE, NOT TRUTHY. `'true'`, `1`, a missing field, `null` and a failed request all read as
 * "do not show", because an unknown answer is not the owner. The server is the gate either way — a
 * non-owner's POST is refused — so this decides only what is offered, and offering the control to
 * the wrong person is the one wrong thing it can do. Structural rather than `MeSchema` for the
 * reason the module header gives.
 */
export function mayInvite(me: unknown): me is Me {
  if (typeof me !== 'object' || me === null) return false;
  const candidate = me as { isOwner?: unknown; displayName?: unknown };
  return candidate.isOwner === true && typeof candidate.displayName === 'string' && candidate.displayName.length > 0;
}

/**
 * The created invitation out of a `POST /api/v1/auth/invitations` body, or null.
 *
 * Null for anything that is not a success envelope carrying a non-empty `code` and an `expiresAt`
 * string, so the panel never shows a half-formed link. The server already parsed this body through
 * `InvitationCreatedResponseSchema` before sending it; this is the shell's cheap check that what
 * arrived is that body, not a second statement of the code's format.
 */
export function createdInvitation(body: unknown): InvitationCreated | null {
  if (typeof body !== 'object' || body === null) return null;
  const envelope = body as { success?: unknown; data?: unknown };
  if (envelope.success !== true || typeof envelope.data !== 'object' || envelope.data === null) return null;
  const data = envelope.data as { code?: unknown; expiresAt?: unknown };
  if (typeof data.code !== 'string' || data.code.length === 0) return null;
  if (typeof data.expiresAt !== 'string' || data.expiresAt.length === 0) return null;
  return { code: data.code, expiresAt: data.expiresAt };
}
