// The registration ceremony end to end, against a real Postgres — I1, I2 and I3.
//
// I2 IS THE REASON THIS FILE EXISTS. A registration ceremony left open lets the first
// unauthenticated visitor after deploy enrol their own passkey and own the app permanently, and the
// schema cannot close it: the partial unique index makes at most one `'bootstrap'` row possible
// however two requests interleave, but Postgres cannot see whether a request carried a session, so
// a handler that tagged a session-less enrolment `'authenticated'` would satisfy every constraint
// and still hand the app away. Only a fixture that presents no cookie against a non-empty
// credential store can tell the difference.
//
// EVERY VALUE BELOW IS FABRICATED: keypairs generated in-process, credential ids from
// `randomBytes`, and a scratch database the setup file refuses to let be the real one.
//
// EACH BLOCK SETS UP ITS OWN PRECONDITION rather than inheriting the previous block's rows. A
// sequence of tests where the second depends on the first's side effects reports the first failure
// three times and hides which rule actually broke.

import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import db from '@/lib/db';
import { SESSION_COOKIE_NAME, hashSessionToken } from '@/lib/sessionToken';
import {
  createTestAuthenticator,
  fabricateRegistrationResponse,
  type TestAuthenticator,
} from '@/lib/webauthnTestFixtures';
import {
  RegistrationCeremonyOptionsSchema,
  CeremonyVerifiedResponseSchema,
} from '@/shared/contracts/auth';
import { POST as registerOptions } from './options/route';
import { POST as registerVerify } from './verify/route';

const ORIGIN = 'http://localhost:3000';

/**
 * A request to a ceremony endpoint, optionally carrying a session cookie.
 *
 * `NextRequest` rather than a bare `Request`: the handlers read `request.cookies`, which is the
 * extension Next adds, and a fixture built on the Web API's `Request` would exercise a code path
 * the server never runs.
 */
function ceremonyRequest(path: string, body: unknown, sessionToken?: string): NextRequest {
  const headers: Record<string, string> = { host: 'localhost:3000', 'Content-Type': 'application/json' };
  if (sessionToken) headers.cookie = `${SESSION_COOKIE_NAME}=${sessionToken}`;
  return new NextRequest(`${ORIGIN}${path}`, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The session token a `Set-Cookie` on a ceremony response carries. */
function sessionTokenFrom(response: Response): string | null {
  const setCookie = response.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!setCookie) return null;
  const value = setCookie.slice(SESSION_COOKIE_NAME.length + 1).split(';')[0];
  return value === '' ? null : value;
}

/** Run a whole registration ceremony for `authenticator`, returning the verify response. */
async function register(authenticator: TestAuthenticator, sessionToken?: string): Promise<Response> {
  const optionsResponse = await registerOptions(ceremonyRequest('/api/v1/auth/register/options', undefined, sessionToken));
  const optionsBody = await optionsResponse.json();
  if (!optionsBody.success) return optionsResponse;
  const options = RegistrationCeremonyOptionsSchema.parse(optionsBody.data);
  return registerVerify(
    ceremonyRequest(
      '/api/v1/auth/register/verify',
      fabricateRegistrationResponse({ authenticator, challenge: options.challenge, rpId: options.rp.id }),
      sessionToken
    )
  );
}

async function credentialRows(): Promise<{ credential_id: string; enrolled_via: string }[]> {
  const result = await db.query<{ credential_id: string; enrolled_via: string }>(
    'SELECT credential_id, enrolled_via FROM webauthn_credentials ORDER BY created_at, credential_id'
  );
  return result.rows;
}

beforeEach(async () => {
  // `auth_sessions` first — it holds the foreign key. Fabricated rows only; this scratch database
  // holds nothing else.
  await db.query('TRUNCATE auth_sessions, webauthn_credentials CASCADE');
});

afterAll(async () => {
  await db.end();
});

describe('POST /api/v1/auth/register/*, against a scratch database', () => {
  it('the first registration ceremony succeeds with no session, when zero credentials exist, and sets a session cookie', async () => {
    expect(await credentialRows()).toHaveLength(0);
    const authenticator = createTestAuthenticator();

    const response = await register(authenticator);

    expect(response.status).toBe(200);
    // The envelope the contract pins: `data` is null, and there is no `{ verified: false }` shape a
    // client could mistake for a success.
    expect(CeremonyVerifiedResponseSchema.parse(await response.clone().json())).toEqual({ success: true, data: null });

    // ENROLLED, AND TAGGED AS THE BOOTSTRAP. The tag is the provenance the whole rule turns on.
    const rows = await credentialRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].credential_id).toBe(authenticator.credentialId);
    expect(rows[0].enrolled_via).toBe('bootstrap');

    // AND SETS A SESSION COOKIE — one that names a real row, not merely a header that looks right.
    const token = sessionTokenFrom(response);
    expect(token).not.toBeNull();
    const sessions = await db.query(
      `SELECT 1 FROM auth_sessions
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [hashSessionToken(token as string)]
    );
    expect(sessions.rowCount).toBe(1);
    // The raw token is never what the table holds.
    const stored = await db.query<{ token_hash: string }>('SELECT token_hash FROM auth_sessions');
    expect(stored.rows[0].token_hash).not.toBe(token);
    expect(stored.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('registration is refused without a session once at least one credential already exists', async () => {
    // Precondition, seeded directly: one credential exists. Fabricated bytes — this row never came
    // from a real authenticator and does not need to have.
    await db.query(
      `INSERT INTO webauthn_credentials (credential_id, public_key, sign_count, transports, enrolled_via)
       VALUES ('p112-incumbent-credential', '\\x0102030405'::bytea, 0, NULL, 'bootstrap')`
    );

    const stranger = createTestAuthenticator();

    // BOTH ENDPOINTS, because either one left open is the defect. `options` would publish the
    // enrolled credential list; `verify` would enrol the stranger.
    const optionsResponse = await registerOptions(ceremonyRequest('/api/v1/auth/register/options', undefined));
    expect(optionsResponse.status).toBe(403);
    expect((await optionsResponse.json()).error.code).toBe('REGISTRATION_CLOSED');

    const verifyResponse = await registerVerify(
      ceremonyRequest(
        '/api/v1/auth/register/verify',
        fabricateRegistrationResponse({ authenticator: stranger, challenge: 'anyChallengeAtAllForThisAttempt' })
      )
    );
    expect(verifyResponse.status).toBe(403);
    expect((await verifyResponse.json()).error.code).toBe('REGISTRATION_CLOSED');

    // NOTHING WAS WRITTEN. The refusal is the absence of a row, not a message: a handler that
    // enrolled the stranger as `'authenticated'` would satisfy the partial unique index, return a
    // plausible error, and still have handed the app away.
    const rows = await credentialRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].credential_id).toBe('p112-incumbent-credential');
    expect(rows.map((r) => r.credential_id)).not.toContain(stranger.credentialId);
    // And no session was opened for anybody.
    expect((await db.query('SELECT 1 FROM auth_sessions')).rowCount).toBe(0);
  });

  it('a second device registers successfully when a valid session is presented', async () => {
    // The gate is "needs a session", not "permanently closed" — SPEC.md's negative control #2. The
    // first device enrols through the real ceremony, so the session presented below is one this
    // app issued rather than a row a test wrote.
    const firstDevice = createTestAuthenticator();
    const bootstrapResponse = await register(firstDevice);
    expect(bootstrapResponse.status).toBe(200);
    const sessionToken = sessionTokenFrom(bootstrapResponse) as string;
    expect(sessionToken).not.toBeNull();

    const secondDevice = createTestAuthenticator();

    // The options this request gets back must exclude the credential already enrolled, or the same
    // authenticator can be enrolled twice.
    const optionsResponse = await registerOptions(
      ceremonyRequest('/api/v1/auth/register/options', undefined, sessionToken)
    );
    expect(optionsResponse.status).toBe(200);
    const options = (await optionsResponse.json()).data;
    expect(options.excludeCredentials.map((c: { id: string }) => c.id)).toEqual([firstDevice.credentialId]);

    const response = await register(secondDevice, sessionToken);
    expect(response.status).toBe(200);

    const rows = await credentialRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.credential_id).sort()).toEqual(
      [firstDevice.credentialId, secondDevice.credentialId].sort()
    );
    // PROVENANCE FOLLOWS THE SESSION. The second row is `'authenticated'` — it did not consume the
    // single bootstrap slot, which is what keeps the window closed and the device list open.
    const second = rows.find((r) => r.credential_id === secondDevice.credentialId);
    expect(second?.enrolled_via).toBe('authenticated');
    expect(rows.filter((r) => r.enrolled_via === 'bootstrap')).toHaveLength(1);
  });
});
