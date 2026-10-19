// The request sequence `/login` runs for a passkey ceremony: ask for options, run them in the
// authenticator, post the response back. Moved out of `app/login/page.tsx` in P7-41a2, unchanged in
// what it sends for an ordinary sign-in or registration, so it can be driven from a node test.
//
// COLLABORATORS ARE PARAMETERS, NOT IMPORTS. The page passes the real `fetch` and
// `@simplewebauthn/browser`'s two functions; a test passes a recording `fetch` and a stub
// authenticator. That is what lets a unit test assert the thing this step can most easily get
// wrong — that the invitation code is on BOTH registration requests and on nothing else — against
// the very function the page calls, rather than against a copy of it.
//
// NO STATE, AND NO BROWSER STORAGE. Nothing here survives a call: a cancelled ceremony leaves
// nothing behind for the retry to trip over, and the code is never written anywhere — not to either
// of the browser's web storage areas, a cookie or the document. It exists for the length of one call, in
// one argument, and in the request header the server reads.

import type { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { invitationHeaders } from './invitationLink';

export type Ceremony = 'login' | 'register';

/** What the ceremony needs from the outside world. The page passes the real ones. */
export interface CeremonyCollaborators {
  fetch: typeof fetch;
  startRegistration: typeof startRegistration;
  startAuthentication: typeof startAuthentication;
}

/** Shown when a refusal carries no readable message — never the raw body, never `undefined`. */
export const CEREMONY_FALLBACK_MESSAGE = 'That did not work. Try again.';

/**
 * The server's message out of an error envelope, or the fallback.
 *
 * The envelope is the same `{ success, data | error }` every handler in this app returns. A body
 * that is not JSON, or an error branch without a string `message`, still has to say something a
 * person can read — rendering `undefined` or a JSON dump would be the page failing to say "no".
 * The server's wording is shown as it is: one refusal for every dead code, and the page does not
 * invent a more specific one.
 */
function refusalMessage(body: unknown): string {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === 'string' && message.length > 0 ? message : CEREMONY_FALLBACK_MESSAGE;
}

/**
 * One ceremony. Resolves when the server verified it and set the session cookie; rejects with the
 * server's message on any refusal, and with the authenticator's own error when the person cancels.
 *
 * `invitationCode` applies to REGISTRATION ONLY, and to both of its requests. The server checks the
 * code on `options` (whether to hand out creation options) and again on `verify` (whether to create
 * the user); sending it on one alone is either a passkey the server then refuses to keep, or options
 * that were never meant for this person. Sign-in never carries it — it has no meaning there, and a
 * secret sent where it is not needed is a secret in one more place.
 *
 * Without a code the two requests are byte-identical to what `/login` sent before this step: the
 * options init is `{ method: 'POST' }` and nothing more. No header object, and certainly no empty
 * `x-invitation-code`, which the server would read as a dead invitation.
 *
 * Success is `success === true` exactly. A body whose `success` is anything else is a refusal,
 * because the contract makes a failed ceremony the ERROR branch rather than a success envelope
 * carrying a negative result, and a client that reads truthiness is a client that can be told yes
 * by accident.
 */
export async function runCeremony(
  ceremony: Ceremony,
  collaborators: CeremonyCollaborators,
  invitationCode: string | null = null
): Promise<void> {
  // Destructured so the real `fetch` is not called as a method of this object, which browsers
  // refuse with "Illegal invocation".
  const { fetch: send } = collaborators;
  const extra = ceremony === 'register' ? invitationHeaders(invitationCode) : {};
  const carriesCode = Object.keys(extra).length > 0;

  const optionsResponse = await send(
    `/api/v1/auth/${ceremony}/options`,
    carriesCode ? { method: 'POST', headers: extra } : { method: 'POST' }
  );
  const optionsBody: unknown = await optionsResponse.json().catch(() => null);
  if ((optionsBody as { success?: unknown } | null)?.success !== true) throw new Error(refusalMessage(optionsBody));
  const optionsJSON = (optionsBody as { data: never }).data;

  const ceremonyResponse =
    ceremony === 'register'
      ? await collaborators.startRegistration({ optionsJSON })
      : await collaborators.startAuthentication({ optionsJSON });

  const verifyResponse = await send(`/api/v1/auth/${ceremony}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify(ceremonyResponse),
  });
  const verifyBody: unknown = await verifyResponse.json().catch(() => null);
  if ((verifyBody as { success?: unknown } | null)?.success !== true) throw new Error(refusalMessage(verifyBody));
}
