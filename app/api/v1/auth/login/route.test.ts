// The login ceremony end to end, against a real Postgres — I4 and I5.
//
// THE CREDENTIAL UNDER TEST IS REALLY STORED, and that is what makes I5 a wiring proof rather than
// a restatement of F11. F11 shows the verifier refuses a response signed by the wrong key; this
// file shows that the row read out of Postgres — the `BYTEA` public key, round-tripped through the
// column — is the key the refusal is measured against. A handler that looked up the wrong row, or
// stored an empty key, or passed the presented credential to itself, would pass F11 and fail here.
//
// Every key, credential id and challenge below is fabricated in-process.

import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import db from '@/lib/db';
import { SESSION_COOKIE_NAME, hashSessionToken } from '@/lib/sessionToken';
import {
  createTestAuthenticator,
  fabricateAuthenticationResponse,
  fabricateRegistrationResponse,
  type TestAuthenticator,
} from '@/lib/webauthnTestFixtures';
import {
  AuthenticationCeremonyOptionsSchema,
  CeremonyVerifiedResponseSchema,
  RegistrationCeremonyOptionsSchema,
} from '@/shared/contracts/auth';
import { POST as registerOptions } from '../register/options/route';
import { POST as registerVerify } from '../register/verify/route';
import { POST as loginOptions } from './options/route';
import { POST as loginVerify } from './verify/route';

const ORIGIN = 'http://localhost:3000';

/**
 * A bare options request. The route now reads its Host header to choose the relying-party id, so
 * the fixture must send one — and it sends the same localhost origin the ceremony fixtures use, so
 * the options and the signed assertion agree about which relying party they are for.
 */
function optionsRequest(): NextRequest {
  return new NextRequest(`${ORIGIN}/api/v1/auth/login/options`, {
    method: 'POST',
    headers: { host: 'localhost:3000' },
  });
}

function ceremonyRequest(path: string, body: unknown, sessionToken?: string): NextRequest {
  const headers: Record<string, string> = { host: 'localhost:3000', 'Content-Type': 'application/json' };
  if (sessionToken) headers.cookie = `${SESSION_COOKIE_NAME}=${sessionToken}`;
  return new NextRequest(`${ORIGIN}${path}`, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function sessionTokenFrom(response: Response): string | null {
  const setCookie = response.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!setCookie) return null;
  const value = setCookie.slice(SESSION_COOKIE_NAME.length + 1).split(';')[0];
  return value === '' ? null : value;
}

/** Enrol an authenticator through the real registration ceremony, returning its session token. */
async function enrol(authenticator: TestAuthenticator, sessionToken?: string): Promise<string> {
  const optionsResponse = await registerOptions(ceremonyRequest('/api/v1/auth/register/options', undefined, sessionToken));
  const options = RegistrationCeremonyOptionsSchema.parse((await optionsResponse.json()).data);
  const response = await registerVerify(
    ceremonyRequest(
      '/api/v1/auth/register/verify',
      fabricateRegistrationResponse({ authenticator, challenge: options.challenge, rpId: options.rp.id }),
      sessionToken
    )
  );
  if (response.status !== 200) throw new Error(`fixture setup failed: register returned ${response.status}`);
  return sessionTokenFrom(response) as string;
}

async function sessionCount(): Promise<number> {
  const result = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM auth_sessions');
  return Number(result.rows[0].count);
}

beforeEach(async () => {
  await db.query('TRUNCATE auth_sessions, webauthn_credentials CASCADE');
});

afterAll(async () => {
  await db.end();
});

describe('POST /api/v1/auth/login/*, against a scratch database', () => {
  it('the login ceremony succeeds end to end for a registered credential and sets a session cookie', async () => {
    const authenticator = createTestAuthenticator();
    await enrol(authenticator);
    const sessionsAfterEnrolment = await sessionCount();

    const optionsResponse = await loginOptions(optionsRequest());
    expect(optionsResponse.status).toBe(200);
    const optionsBody = await optionsResponse.json();
    const options = AuthenticationCeremonyOptionsSchema.parse(optionsBody.data);
    // The options name the credential that is actually stored — the list a truncating query breaks.
    expect(optionsBody.data.allowCredentials.map((c: { id: string }) => c.id)).toEqual([authenticator.credentialId]);

    const response = await loginVerify(
      ceremonyRequest(
        '/api/v1/auth/login/verify',
        fabricateAuthenticationResponse({ authenticator, challenge: options.challenge, rpId: options.rpId })
      )
    );

    expect(response.status).toBe(200);
    expect(CeremonyVerifiedResponseSchema.parse(await response.clone().json())).toEqual({ success: true, data: null });

    // A SECOND session row, named by the cookie, valid under the predicate the boundary uses.
    expect(await sessionCount()).toBe(sessionsAfterEnrolment + 1);
    const token = sessionTokenFrom(response);
    expect(token).not.toBeNull();
    const valid = await db.query(
      `SELECT credential_id FROM auth_sessions
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [hashSessionToken(token as string)]
    );
    expect(valid.rowCount).toBe(1);
    // The session records WHICH authenticator signed it in — the attribution the FK exists for.
    expect(valid.rows[0].credential_id).toBe(authenticator.credentialId);
  });

  it('login is refused end to end for an authentication response signed by the wrong key against a really-stored credential', async () => {
    const authenticator = createTestAuthenticator();
    await enrol(authenticator);
    const sessionsBefore = await sessionCount();

    // The stored public key really is in Postgres, and really is non-empty — the state the refusal
    // below has to be measured against.
    const stored = await db.query<{ credential_id: string; length: number }>(
      'SELECT credential_id, octet_length(public_key) AS length FROM webauthn_credentials'
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].credential_id).toBe(authenticator.credentialId);
    expect(Number(stored.rows[0].length)).toBeGreaterThan(0);

    const impostor = createTestAuthenticator();
    const optionsResponse = await loginOptions(optionsRequest());
    const options = AuthenticationCeremonyOptionsSchema.parse((await optionsResponse.json()).data);

    // ONE AXIS: the signing key. The credential id names the enrolled authenticator, the challenge
    // is the one this server just issued, the origin is the configured one.
    const response = await loginVerify(
      ceremonyRequest(
        '/api/v1/auth/login/verify',
        fabricateAuthenticationResponse({
          authenticator,
          challenge: options.challenge,
          rpId: options.rpId,
          signingKey: impostor.privateKey,
        })
      )
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    // One code for all four failure axes — a caller is not told which one it got wrong.
    expect(body.error.code).toBe('CEREMONY_FAILED');
    // NO SESSION, AND NO COOKIE. A refusal that still set a cookie would be the whole defect.
    expect(await sessionCount()).toBe(sessionsBefore);
    expect(sessionTokenFrom(response)).toBeNull();
  });

  it('a second enrolled device can sign in, over a credential list that is never truncated to one row', async () => {
    // SPEC.md's failure list: "a query that silently reads only the most recent credential, so a
    // second device registers but can never log in". Invisible on a one-device setup, which is
    // every setup on day one — so the fixture needs two, and the OLDER one is the one that signs in
    // here, because a `LIMIT 1` ordered the convenient way would still pass with the newer.
    const firstDevice = createTestAuthenticator();
    const sessionToken = await enrol(firstDevice);
    const secondDevice = createTestAuthenticator();
    await enrol(secondDevice, sessionToken);

    const optionsResponse = await loginOptions(optionsRequest());
    const optionsBody = await optionsResponse.json();
    const options = AuthenticationCeremonyOptionsSchema.parse(optionsBody.data);
    expect(optionsBody.data.allowCredentials.map((c: { id: string }) => c.id).sort()).toEqual(
      [firstDevice.credentialId, secondDevice.credentialId].sort()
    );

    const response = await loginVerify(
      ceremonyRequest(
        '/api/v1/auth/login/verify',
        fabricateAuthenticationResponse({ authenticator: firstDevice, challenge: options.challenge, rpId: options.rpId })
      )
    );
    expect(response.status).toBe(200);

    const token = sessionTokenFrom(response) as string;
    const valid = await db.query<{ credential_id: string }>(
      `SELECT credential_id FROM auth_sessions
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [hashSessionToken(token)]
    );
    expect(valid.rows[0].credential_id).toBe(firstDevice.credentialId);
  });
});
