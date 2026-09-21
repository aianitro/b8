// P1-12a against a scratch database: device tokens from a real passkey ceremony, and bearer tokens
// through the real boundary.
//
// Helpers are written out here rather than imported from login/route.test.ts or proxy.test.ts,
// because importing a test file from another test file re-registers its suites.

import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import db from '@/lib/db';
import { SESSION_COOKIE_NAME, generateSessionToken, hashSessionToken } from '@/lib/sessionToken';
import {
  createTestAuthenticator,
  fabricateAuthenticationResponse,
  fabricateRegistrationResponse,
  type TestAuthenticator,
} from '@/lib/webauthnTestFixtures';
import {
  AuthenticationCeremonyOptionsSchema,
  DeviceSessionResponseSchema,
  RegistrationCeremonyOptionsSchema,
} from '@b8/contracts/auth';
import { createPersonalToken, listSessions, revokeByPrefix } from '@/lib/authSession';
import { proxy } from '@/proxy';
import { POST as logout } from './logout/route';
import { POST as registerOptions } from './register/options/route';
import { POST as registerVerify } from './register/verify/route';
import { POST as loginOptions } from './login/options/route';
import { POST as loginVerify } from './login/verify/route';

const ORIGIN = 'http://localhost:3000';

/** What a native app sends: the opt-in header, and none of the Sec-Fetch headers a browser adds. */
const NATIVE = { 'x-b8-client': 'device' };
/** What a browser page sends. It cannot remove these. */
const BROWSER = { 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin' };

function request(path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? 'GET',
    headers: { host: 'localhost:3000', 'content-type': 'application/json', ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const cookie = (token: string) => ({ cookie: `${SESSION_COOKIE_NAME}=${token}` });
const letsThrough = (r: Response) => r.headers.get('x-middleware-next') === '1';

async function enrol(authenticator: TestAuthenticator, headers: Record<string, string> = {}): Promise<Response> {
  const options = RegistrationCeremonyOptionsSchema.parse(
    (await (await registerOptions(request('/api/v1/auth/register/options', { method: 'POST', headers }))).json()).data
  );
  return registerVerify(request('/api/v1/auth/register/verify', {
    method: 'POST',
    headers,
    body: fabricateRegistrationResponse({ authenticator, challenge: options.challenge, rpId: options.rp.id }),
  }));
}

async function signIn(authenticator: TestAuthenticator, headers: Record<string, string>): Promise<Response> {
  const options = AuthenticationCeremonyOptionsSchema.parse(
    (await (await loginOptions(request('/api/v1/auth/login/options', { method: 'POST' }))).json()).data
  );
  return loginVerify(request('/api/v1/auth/login/verify', {
    method: 'POST',
    headers,
    body: fabricateAuthenticationResponse({ authenticator, challenge: options.challenge, rpId: options.rpId }),
  }));
}

async function row(token: string) {
  const r = await db.query<{ kind: string; scope: string; expires_at: Date; last_used_at: Date | null; revoked_at: Date | null }>(
    'SELECT kind, scope, expires_at, last_used_at, revoked_at FROM auth_sessions WHERE token_hash = $1',
    [hashSessionToken(token)]
  );
  return r.rows[0];
}

beforeEach(async () => {
  await db.query('TRUNCATE auth_sessions, webauthn_credentials CASCADE');
});

afterAll(async () => {
  await db.end();
});

describe('device tokens from a passkey ceremony', () => {
  it('a native sign-in returns a token in the body, sets no cookie, and the token opens the API', async () => {
    const authenticator = createTestAuthenticator();
    await enrol(authenticator);

    const response = await signIn(authenticator, NATIVE);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.getSetCookie().filter((c) => c.startsWith(SESSION_COOKIE_NAME))).toEqual([]);

    const body = DeviceSessionResponseSchema.parse(await response.json());
    if (!body.success) throw new Error('expected success');
    expect((await row(body.data.token)).kind).toBe('device');

    // Expiry is about thirty days out.
    const days = (new Date(body.data.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);

    expect(letsThrough(await proxy(request('/api/v1/overview', { headers: bearer(body.data.token) })))).toBe(true);
  });

  it('A BROWSER CAN NEVER OBTAIN ONE, even when it asks, and the refusal spends no passkey approval', async () => {
    // Script injected into a page could otherwise turn one passkey prompt into a readable 30-day
    // token sent anywhere. Sec-Fetch headers are forbidden headers: page script cannot drop them.
    const authenticator = createTestAuthenticator();
    await enrol(authenticator);
    const before = (await listSessions()).length;

    const response = await signIn(authenticator, { ...NATIVE, ...BROWSER });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('DEVICE_TOKEN_REFUSED');
    expect((await listSessions()).length).toBe(before);
  });

  it('a browser sign-in without the opt-in still gets its cookie, exactly as before', async () => {
    const authenticator = createTestAuthenticator();
    await enrol(authenticator);
    const response = await signIn(authenticator, BROWSER);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toBeNull();
    expect(response.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))).toBe(true);
  });

  it('a native FIRST registration returns a device token and leaves no unheld browser session live', async () => {
    const response = await enrol(createTestAuthenticator(), NATIVE);
    expect(response.status).toBe(200);
    const body = DeviceSessionResponseSchema.parse(await response.json());
    if (!body.success) throw new Error('expected success');

    // The browser session enrolment opens in its own transaction was revoked on the spot.
    const live = await listSessions();
    expect(live.map((s) => s.kind)).toEqual(['device']);
  });
});

describe('bearer tokens at the boundary', () => {
  async function seed(
    kind: 'browser' | 'device' | 'personal',
    opts: { scope?: 'full' | 'read'; expiresIn?: string; createdAgo?: string } = {}
  ) {
    await db.query(
      `INSERT INTO webauthn_credentials (credential_id, public_key, sign_count, enrolled_via)
       VALUES ('bearer-fixture', '\\x01'::bytea, 0, 'bootstrap') ON CONFLICT DO NOTHING`
    );
    const token = generateSessionToken();
    await db.query(
      `INSERT INTO auth_sessions (token_hash, credential_id, kind, scope, label, created_at, expires_at)
       VALUES ($1, 'bearer-fixture', $2, $3, $4, NOW() - $6::interval, NOW() + $5::interval)`,
      [hashSessionToken(token), kind, opts.scope ?? 'full', kind === 'personal' ? 'fixture' : null,
       opts.expiresIn ?? '1 day', opts.createdAgo ?? '0 seconds']
    );
    return token;
  }

  it('reaches the API with a device or personal token', async () => {
    for (const kind of ['device', 'personal'] as const) {
      const token = await seed(kind);
      expect(letsThrough(await proxy(request('/api/v1/transactions', { headers: bearer(token) })))).toBe(true);
    }
  });

  it('never reaches a PAGE with a bearer token', async () => {
    // A leaked script token must not become a way to browse the app.
    const token = await seed('device');
    const response = await proxy(request('/dashboard', { headers: bearer(token) }));
    expect(letsThrough(response)).toBe(false);
  });

  it('keeps each credential to its own carrier', async () => {
    const browser = await seed('browser');
    const device = await seed('device');
    // A browser session lifted into a header, and a device token pasted into a cookie.
    expect(letsThrough(await proxy(request('/api/v1/overview', { headers: bearer(browser) })))).toBe(false);
    expect(letsThrough(await proxy(request('/api/v1/overview', { headers: cookie(device) })))).toBe(false);
    // And the ordinary cases still work.
    expect(letsThrough(await proxy(request('/api/v1/overview', { headers: cookie(browser) })))).toBe(true);
  });

  it('refuses a bad bearer token even when a good cookie rides along — no fallback', async () => {
    const browser = await seed('browser');
    const response = await proxy(request('/api/v1/overview', {
      headers: { ...cookie(browser), authorization: `Bearer ${generateSessionToken()}` },
    }));
    expect(response.status).toBe(401);
  });

  it('refuses a malformed Authorization header with 401, not an error', async () => {
    for (const value of ['Bearer', 'Bearer x', 'Basic dXNlcjpwYXNz', `Bearer ${'a'.repeat(44)}`]) {
      const response = await proxy(request('/api/v1/overview', { headers: { authorization: value } }));
      expect(response.status).toBe(401);
    }
  });

  it('lets a READ token read and call chat, and refuses it any write with 403', async () => {
    const token = await seed('personal', { scope: 'read' });
    expect(letsThrough(await proxy(request('/api/v1/overview', { headers: bearer(token) })))).toBe(true);
    expect(letsThrough(await proxy(request('/api/v1/chat', { method: 'POST', headers: bearer(token) })))).toBe(true);

    const write = await proxy(request('/api/v1/transactions', { method: 'POST', headers: bearer(token) }));
    expect(write.status).toBe(403);
    expect((await write.json()).error.code).toBe('INSUFFICIENT_SCOPE');
  });

  it('refuses a token once it is revoked, and once it has expired', async () => {
    const revoked = await seed('personal');
    expect(await revokeByPrefix(hashSessionToken(revoked).slice(0, 12))).toBe('revoked');
    expect((await proxy(request('/api/v1/overview', { headers: bearer(revoked) }))).status).toBe(401);

    // Created a month ago and lapsed a minute ago — the schema refuses a session born expired.
    const expired = await seed('device', { createdAgo: '31 days', expiresIn: '-1 minute' });
    expect((await proxy(request('/api/v1/overview', { headers: bearer(expired) }))).status).toBe(401);
  });

  it('slides a device session forward on use, and only a device session', async () => {
    const device = await seed('device', { expiresIn: '2 days' });
    const personal = await seed('personal', { expiresIn: '2 days' });
    for (const t of [device, personal]) await proxy(request('/api/v1/overview', { headers: bearer(t) }));

    const d = await row(device);
    const p = await row(personal);
    expect((d.expires_at.getTime() - Date.now()) / 86_400_000).toBeGreaterThan(29.9);
    expect((p.expires_at.getTime() - Date.now()) / 86_400_000).toBeLessThan(2.1);
    expect(d.last_used_at).not.toBeNull();
    expect(p.last_used_at).not.toBeNull();
  });

  it('records use at most every five minutes, so polling does not become a write per request', async () => {
    const token = await seed('device');
    await proxy(request('/api/v1/overview', { headers: bearer(token) }));
    const first = (await row(token)).last_used_at;
    await proxy(request('/api/v1/overview', { headers: bearer(token) }));
    expect((await row(token)).last_used_at).toEqual(first);
  });

  it('lets a phone app sign itself out', async () => {
    const token = await seed('device');
    const response = await logout(request('/api/v1/auth/logout', { method: 'POST', headers: bearer(token) }));
    expect(response.status).toBe(200);
    expect((await row(token)).revoked_at).not.toBeNull();
    expect((await proxy(request('/api/v1/overview', { headers: bearer(token) }))).status).toBe(401);
  });
});

describe('personal tokens, as the SSH command mints them', () => {
  it('mints a named token under the newest passkey, and lists it without its secret', async () => {
    const authenticator = createTestAuthenticator();
    await enrol(authenticator);
    const minted = await createPersonalToken({ label: 'eval runner', scope: 'read', days: 30 });

    const listed = (await listSessions()).find((s) => s.kind === 'personal');
    expect(listed).toMatchObject({ label: 'eval runner', scope: 'read', tokenHash: minted.tokenHash });
    // What the list holds cannot authenticate: it is a hash of the token, never the token.
    expect(JSON.stringify(listed)).not.toContain(minted.token);
    expect(letsThrough(await proxy(request('/api/v1/overview', { headers: bearer(minted.token) })))).toBe(true);
  });

  it('refuses to mint with no passkey enrolled, or with a lifetime past the bound', async () => {
    await expect(createPersonalToken({ label: 'x', scope: 'full' })).rejects.toThrow(/no passkey/);
    await enrol(createTestAuthenticator());
    await expect(createPersonalToken({ label: 'x', scope: 'full', days: 400 })).rejects.toThrow(RangeError);
  });

  it('revokes only on an unambiguous prefix of at least eight characters', async () => {
    await enrol(createTestAuthenticator());
    const minted = await createPersonalToken({ label: 'x', scope: 'full' });
    expect(await revokeByPrefix('abc')).toBe('too-short');
    expect(await revokeByPrefix('00000000')).toBe('none');
    expect(await revokeByPrefix(minted.tokenHash.slice(0, 8))).toBe('revoked');
  });
});

// ─── The escalation the P1-12a security review found, and the fix, from the outside ───────────
//
// The two `register/*` paths are allowlisted in `proxy.ts`, so `authorize` — and with it the scope
// check every other path gets — never runs on them. The handlers looked up the session themselves
// and asked only whether one existed. A read-only token therefore counted, and the reply to a
// registration is a full-scope session plus a passkey that outlives the token being revoked.
describe('a token cannot enrol a passkey', () => {
  async function seedToken(scope: 'full' | 'read'): Promise<string> {
    await enrol(createTestAuthenticator()); // the owner's real passkey; registration is now closed
    const minted = await createPersonalToken({ label: 'eval runner', scope });
    return minted.token;
  }

  async function credentialCount(): Promise<number> {
    const r = await db.query<{ n: string }>('SELECT COUNT(*) AS n FROM webauthn_credentials');
    return Number(r.rows[0].n);
  }

  for (const scope of ['read', 'full'] as const) {
    it(`refuses a ${scope} personal token both ceremony endpoints, and enrols nothing`, async () => {
      const token = await seedToken(scope);
      const before = await credentialCount();
      // The owner's own enrolment left a browser session; the attack must add nothing to it.
      const sessionsBefore = (await listSessions()).map((s) => s.tokenHash).sort();

      const options = await registerOptions(request('/api/v1/auth/register/options', {
        method: 'POST',
        headers: bearer(token),
      }));
      expect(options.status).toBe(403);
      expect((await options.json()).error.code).toBe('REGISTRATION_CLOSED');

      // No challenge was issued, so the attacker's ceremony is fabricated against one of its own.
      // The gate runs before the body is read, which is what makes that irrelevant.
      const attacker = createTestAuthenticator();
      const verify = await registerVerify(request('/api/v1/auth/register/verify', {
        method: 'POST',
        headers: bearer(token),
        body: fabricateRegistrationResponse({
          authenticator: attacker,
          challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          rpId: 'localhost',
        }),
      }));
      expect(verify.status).toBe(403);
      expect((await verify.json()).error.code).toBe('REGISTRATION_CLOSED');

      // Nothing was enrolled, and no new session of any kind was opened.
      expect(await credentialCount()).toBe(before);
      expect((await listSessions()).map((s) => s.tokenHash).sort()).toEqual(sessionsBefore);
    });
  }

  it('still lets a phone app enrol a second device — the thing the fix must not break', async () => {
    const authenticator = createTestAuthenticator();
    await enrol(authenticator);
    const signedIn = DeviceSessionResponseSchema.parse(await (await signIn(authenticator, NATIVE)).json());
    if (!signedIn.success) throw new Error('expected success');

    const response = await enrol(createTestAuthenticator(), bearer(signedIn.data.token));
    expect(response.status).toBe(200);
    expect((await db.query('SELECT 1 FROM webauthn_credentials')).rowCount).toBe(2);
  });

  it('refuses a read token the endpoints a handler reads its own session on', async () => {
    // The same rule at the level below the routes: `credentialFrom` now applies the scope check
    // itself, so no future handler on an allowlisted path inherits the hole by calling it.
    const token = await seedToken('read');
    const response = await logout(request('/api/v1/auth/logout', { method: 'POST', headers: bearer(token) }));
    expect(response.status).toBe(401);
  });
});
