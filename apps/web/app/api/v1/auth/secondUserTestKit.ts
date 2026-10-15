// The ceremony drivers P7-41a's integration fixtures share: enrol the owner, invite and enrol a
// second user, sign either of them in, and count what the auth tables hold.
//
// WHY A KIT HERE, WHEN THE OLDER AUTH FIXTURES WRITE THEIR HELPERS OUT. `bearer.test.ts` explains
// that it does not import another test file because that re-registers the other file's suites. This
// is not a test file — no `describe`, no `it` — so importing it registers nothing, and five fixture
// files (principal, invitations, revoke, push, decide) need the same multi-step ceremonies. Five
// hand-copied versions of "redeem an invitation" would be five chances for a fixture to exercise a
// slightly different path from the one the app runs.
//
// NOT A ROUTE AND NOT BUNDLED. Next treats only `route.ts` and `page.tsx` as surfaces, and nothing
// under `app/` that ships imports this file, so it adds no endpoint and never reaches a build.
//
// EVERY VALUE IS FABRICATED: keypairs generated in-process, display names like "Test User Two",
// push endpoints under `push.example.invalid`, and a scratch database the setup file guards.

import { generateKeyPairSync } from 'node:crypto';
import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { resolveSession } from '@/lib/authSession';
import { SESSION_COOKIE_NAME } from '@/lib/sessionToken';
import {
  createTestAuthenticator,
  fabricateAuthenticationResponse,
  fabricateRegistrationResponse,
  type TestAuthenticator,
} from '@/lib/webauthnTestFixtures';
import {
  AuthenticationCeremonyOptionsSchema,
  RegistrationCeremonyOptionsSchema,
} from '@b8/contracts/auth';
import { POST as registerOptions } from './register/options/route';
import { POST as registerVerify } from './register/verify/route';
import { POST as loginOptions } from './login/options/route';
import { POST as loginVerify } from './login/verify/route';
import { POST as createInvitationRoute } from './invitations/route';

export const ORIGIN = 'http://localhost:3000';

/** The fabricated name every fixture gives the invitee. Never a real person's. */
export const SECOND_USER_NAME = 'Test User Two';

/** A `NextRequest` — the handlers read `request.cookies`, which the plain Web `Request` lacks. */
export function request(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}
): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? 'GET',
    headers: { host: 'localhost:3000', 'content-type': 'application/json', ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export const cookie = (token: string) => ({ cookie: `${SESSION_COOKIE_NAME}=${token}` });
export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
export const invitationHeader = (code: string) => ({ 'x-invitation-code': code });

/** The session token a `Set-Cookie` on a ceremony response carries, or null. */
export function sessionTokenFrom(response: Response): string | null {
  const setCookie = response.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!setCookie) return null;
  const value = setCookie.slice(SESSION_COOKIE_NAME.length + 1).split(';')[0];
  return value === '' ? null : value;
}

/**
 * Clear every table this task's fixtures write. CASCADE reaches device handoffs, invitations, push
 * subscriptions and agent proposals — every one of them fabricated in this scratch database.
 */
export async function resetAuth(): Promise<void> {
  await db.query('TRUNCATE auth_sessions, webauthn_credentials, user_invitations, web_push_subscriptions, users CASCADE');
}

/** Ask `register/options` for creation options, with whatever headers the caller presents. */
export async function registrationOptions(headers: Record<string, string> = {}) {
  const response = await registerOptions(request('/api/v1/auth/register/options', { method: 'POST', headers }));
  const body = await response.json();
  return { response, body, options: body.success ? RegistrationCeremonyOptionsSchema.parse(body.data) : null };
}

/** POST a registration response to `register/verify`. */
export function verifyRegistration(
  authenticator: TestAuthenticator,
  challenge: string,
  headers: Record<string, string> = {},
  rpId?: string
): Promise<Response> {
  return registerVerify(request('/api/v1/auth/register/verify', {
    method: 'POST',
    headers,
    body: fabricateRegistrationResponse({ authenticator, challenge, rpId }),
  }));
}

/**
 * A whole registration ceremony — options, then verify — presenting the same headers on BOTH, as a
 * real invitee's page does. Returns the options response when options refused, the verify response
 * otherwise.
 */
export async function register(authenticator: TestAuthenticator, headers: Record<string, string> = {}): Promise<Response> {
  const { response, options } = await registrationOptions(headers);
  if (!options) return response;
  return verifyRegistration(authenticator, options.challenge, headers, options.rp.id);
}

/** A whole login ceremony for `authenticator`. */
export async function signIn(authenticator: TestAuthenticator): Promise<Response> {
  const options = AuthenticationCeremonyOptionsSchema.parse(
    (await (await loginOptions(request('/api/v1/auth/login/options', { method: 'POST' }))).json()).data
  );
  return loginVerify(request('/api/v1/auth/login/verify', {
    method: 'POST',
    body: fabricateAuthenticationResponse({ authenticator, challenge: options.challenge, rpId: options.rpId }),
  }));
}

/** The `userId` a raw session token resolves to, or null when it resolves to nothing. */
export async function userIdOf(token: string | null): Promise<number | null> {
  return (await resolveSession(token))?.userId ?? null;
}

export interface EnrolledUser {
  authenticator: TestAuthenticator;
  token: string;
  userId: number;
}

/** Bootstrap the owner through the real ceremony, on an empty store. */
export async function bootstrapOwner(): Promise<EnrolledUser> {
  const authenticator = createTestAuthenticator();
  const response = await register(authenticator);
  if (response.status !== 200) throw new Error(`bootstrap refused: ${response.status}`);
  const token = sessionTokenFrom(response) as string;
  const userId = await userIdOf(token);
  if (userId === null) throw new Error('bootstrap session resolves to nobody');
  return { authenticator, token, userId };
}

/** Mint an invitation through the real endpoint, under `ownerToken`'s cookie. Returns the raw code. */
export async function invite(ownerToken: string, displayName = SECOND_USER_NAME): Promise<string> {
  const response = await createInvitationRoute(request('/api/v1/auth/invitations', {
    method: 'POST',
    headers: cookie(ownerToken),
    body: { displayName },
  }));
  const body = await response.json();
  if (response.status !== 200) throw new Error(`invitation refused: ${response.status} ${JSON.stringify(body)}`);
  return body.data.code as string;
}

/** Invite and enrol a second user, through the real ceremonies. */
export async function enrolSecondUser(ownerToken: string): Promise<EnrolledUser & { code: string }> {
  const code = await invite(ownerToken);
  const authenticator = createTestAuthenticator();
  const response = await register(authenticator, invitationHeader(code));
  if (response.status !== 200) throw new Error(`redemption refused: ${response.status}`);
  const token = sessionTokenFrom(response) as string;
  const userId = await userIdOf(token);
  if (userId === null) throw new Error('redeemed session resolves to nobody');
  return { authenticator, token, userId, code };
}

/** Row counts of the tables a refused enrolment must not touch. */
export async function authCounts(): Promise<{ users: number; credentials: number; sessions: number; bootstrap: number }> {
  const r = await db.query<{ users: string; credentials: string; sessions: string; bootstrap: string }>(
    `SELECT (SELECT COUNT(*) FROM users)::text AS users,
            (SELECT COUNT(*) FROM webauthn_credentials)::text AS credentials,
            (SELECT COUNT(*) FROM auth_sessions)::text AS sessions,
            (SELECT COUNT(*) FROM webauthn_credentials WHERE enrolled_via = 'bootstrap')::text AS bootstrap`
  );
  const row = r.rows[0];
  return {
    users: Number(row.users),
    credentials: Number(row.credentials),
    sessions: Number(row.sessions),
    bootstrap: Number(row.bootstrap),
  };
}

/**
 * VAPID keys generated in this process, so `sendWebPush` really signs and really calls `fetch` —
 * a send with no keys returns 0 before choosing any recipient, which would make every isolation
 * assertion vacuous. The private key is PKCS8 DER, base64, which is what `lib/webPush.ts` reads.
 */
export function installFabricatedVapid(): void {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  process.env.VAPID_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  process.env.VAPID_PUBLIC_KEY = Buffer.from(spki.subarray(spki.length - 65)).toString('base64url');
  process.env.VAPID_SUBJECT = 'mailto:fixture@example.invalid';
}

/** A `fetch` stand-in that records every URL a push was sent to and answers 201. */
export function recordingFetch(): { targets: string[]; fetch: typeof fetch } {
  const targets: string[] = [];
  const stub = (async (input: string | URL | Request) => {
    targets.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  return { targets, fetch: stub };
}
