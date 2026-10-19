// Gifts (P7-41b) — WHO IS LOOKING, for a route handler or a page.
//
// Masking depends on the viewer, so every surface that shows a ledger row's text has to know who
// asked. There is exactly one answer to that question in this app — `lib/requestAuth.ts`, the
// function the boundary in `proxy.ts` uses on every request — and both helpers here ask it rather
// than reading a cookie themselves. A second reading of "who is this" would be a second place for
// the cookie-versus-bearer precedence to drift, and the drift would be a leak.
//
// FAIL CLOSED. Anything that does not resolve to a live session — no credential, an expired one, a
// revoked user, a database error — is `null`, and `null` is a non-giver: the masked row. There is no
// branch here that answers "the owner" for want of an answer.

import { cookies, headers } from 'next/headers';
import { credentialFrom } from './requestAuth';
import type { GiftViewer } from './domain/giftMask';

type RequestLike = Parameters<typeof credentialFrom>[0];

/** The viewer of a route handler's request. */
export async function viewerOf(request: RequestLike): Promise<GiftViewer> {
  try {
    return (await credentialFrom(request))?.userId ?? null;
  } catch {
    // A lookup that threw has identified nobody. The masked answer is the safe one; the request
    // itself was already admitted or refused by the boundary on its own terms.
    return null;
  }
}

/**
 * The viewer of a server component's render, for the page at `pathname`.
 *
 * Built from the request's own headers and cookies (Next's request-time APIs), shaped as the
 * request object `credentialFrom` reads, so a page and a route resolve a person identically.
 * Calling it opts the page into dynamic rendering, which every page that shows rows already is.
 */
export async function pageViewer(pathname: string): Promise<GiftViewer> {
  const [h, c] = await Promise.all([headers(), cookies()]);
  return viewerOf({
    headers: { get: (name: string) => h.get(name) },
    cookies: { get: (name: string) => c.get(name) },
    method: 'GET',
    nextUrl: { pathname },
  });
}
