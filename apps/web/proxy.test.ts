// The boundary itself, against a real Postgres — I6 through I11.
//
// WHY THIS FILE IS THE ONE THAT MATTERS FOR THE 27 ROUTES THIS TASK NEVER TOUCHES. Every handler
// under `app/api/` except `/api/v1/overview` is `P1-10b`'s unstarted job, and none of them gained a
// line of authentication code here. What protects them is this function and its matcher, so a
// fixture that asserted the boundary refuses `/api/v1/…` would be asserting the one case that is
// least representative. I6 deliberately names a NON-v1 route.
//
// THE PROXY IS CALLED DIRECTLY, with no server running. `next/experimental/testing/server` is what
// makes the matcher itself checkable — the exported `config` is data, so `unstable_doesMiddlewareMatch`
// can answer "would this even run for that path?" without booting Next.
//
// Every row seeded below is fabricated; the scratch-database guard in `setupFiles` refuses to let
// this run against the real one.

import { NextRequest } from 'next/server';
import { getRedirectUrl, unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import db from '@/lib/db';
import { SESSION_COOKIE_NAME, generateSessionToken, hashSessionToken } from '@/lib/sessionToken';
import { UnauthenticatedResponseSchema } from '@b8/contracts/auth';
import { POST as logout } from '@/app/api/v1/auth/logout/route';
import { PRE_AUTH_PATHS, config, proxy } from './proxy';

const ORIGIN = 'http://localhost:3000';

/** A fabricated credential id, so the sessions below have something to hang off. */
const CREDENTIAL_ID = 'p112-proxy-fixture-credential';

function requestFor(path: string, sessionToken?: string): NextRequest {
  const headers: Record<string, string> = { host: 'localhost:3000' };
  if (sessionToken !== undefined) headers.cookie = `${SESSION_COOKIE_NAME}=${sessionToken}`;
  return new NextRequest(`${ORIGIN}${path}`, { headers });
}

/** `NextResponse.next()` — the boundary letting a request through — carries this header. */
function letsThrough(response: Response): boolean {
  return response.headers.get('x-middleware-next') === '1';
}

/** Seed a session row with an explicit lifetime, and return the raw token a browser would hold. */
async function seedSession(lifetime: { createdAgo: string; expiresIn: string }): Promise<string> {
  const token = generateSessionToken();
  await db.query(
    `INSERT INTO auth_sessions (token_hash, credential_id, created_at, expires_at)
     VALUES ($1, $2, NOW() - $3::interval, NOW() + $4::interval)`,
    [hashSessionToken(token), CREDENTIAL_ID, lifetime.createdAgo, lifetime.expiresIn]
  );
  return token;
}

beforeEach(async () => {
  await db.query('TRUNCATE auth_sessions, webauthn_credentials CASCADE');
  await db.query(
    `INSERT INTO webauthn_credentials (credential_id, public_key, sign_count, transports, enrolled_via)
     VALUES ($1, '\\x0102030405'::bytea, 0, NULL, 'bootstrap')`,
    [CREDENTIAL_ID]
  );
});

afterAll(async () => {
  await db.end();
});

describe('the request boundary', () => {
  it('a representative non-v1 API route is unreachable without a session cookie', async () => {
    // `/api/accounts` is one of the 27 handlers this task's diff never opens. It is protected
    // because the boundary is, which is the whole argument for protecting everything minus an
    // allowlist rather than gating `/api/v1/*`.
    const response = await proxy(requestFor('/api/accounts'));

    expect(response.status).toBe(401);
    expect(letsThrough(response)).toBe(false);
    // The body is the envelope the other 28 handlers speak, not a hand-built `{ error: '…' }`.
    const body = UnauthenticatedResponseSchema.parse(await response.json());
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHENTICATED');

    // Three spellings of "no session" are one outcome: absent, empty, and a cookie header with an
    // empty value. SPEC.md's null semantics — there is no guest and no read-only.
    for (const cookie of [undefined, '']) {
      const again = await proxy(requestFor('/api/transactions', cookie));
      expect(again.status).toBe(401);
    }
    // And several more of the 27, so this is not one route that happens to be covered.
    for (const path of ['/api/budget', '/api/properties', '/api/sync', '/api/v1/overview']) {
      expect((await proxy(requestFor(path))).status).toBe(401);
    }
  });

  it('a session cookie matching no stored session row is rejected', async () => {
    // Well-formed, correctly named, right length, right alphabet — and it names nothing. Presence
    // is not validity, which is the mistake a boundary that checks `cookies.has(...)` makes.
    const forged = generateSessionToken();
    expect((await db.query('SELECT 1 FROM auth_sessions WHERE token_hash = $1', [hashSessionToken(forged)])).rowCount).toBe(0);

    const response = await proxy(requestFor('/api/accounts', forged));
    expect(response.status).toBe(401);
    expect(letsThrough(response)).toBe(false);

    // The control: a cookie that DOES name a live row gets through, so the refusal above is the
    // lookup and not a boundary that refuses everything.
    const real = await seedSession({ createdAgo: '1 minute', expiresIn: '1 hour' });
    expect(letsThrough(await proxy(requestFor('/api/accounts', real)))).toBe(true);
  });

  it('an expired session row is rejected', async () => {
    // A row that exists and is not revoked — only `expires_at` is in the past. This is the conjunct
    // a `WHERE token_hash = $1` lookup drops, and dropping it has no visible symptom until someone
    // uses a cookie from last week.
    const expired = await seedSession({ createdAgo: '13 hours', expiresIn: '-1 hour' });
    const row = await db.query<{ revoked_at: string | null; expired: boolean }>(
      'SELECT revoked_at, expires_at < NOW() AS expired FROM auth_sessions WHERE token_hash = $1',
      [hashSessionToken(expired)]
    );
    expect(row.rows[0].revoked_at).toBeNull();
    expect(row.rows[0].expired).toBe(true);

    const response = await proxy(requestFor('/api/accounts', expired));
    expect(response.status).toBe(401);

    // The half-open interval, from the other side: a session expiring in a second is still valid.
    // `>` versus `>=` has no visible symptom either way, which is why it is pinned rather than left
    // to whichever comparison got typed.
    const live = await seedSession({ createdAgo: '1 minute', expiresIn: '1 second' });
    expect(letsThrough(await proxy(requestFor('/api/accounts', live)))).toBe(true);
  });

  it('logout invalidates the session server-side; the same cookie replayed afterward is rejected', async () => {
    const token = await seedSession({ createdAgo: '1 minute', expiresIn: '1 hour' });
    // Before: the cookie works.
    expect(letsThrough(await proxy(requestFor('/api/accounts', token)))).toBe(true);

    const logoutResponse = await logout(
      new NextRequest(`${ORIGIN}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { host: 'localhost:3000', cookie: `${SESSION_COOKIE_NAME}=${token}` },
      })
    );
    expect(logoutResponse.status).toBe(200);

    // THE ROW IS REVOKED, NOT DELETED and not expired. Those are three different states and the
    // distinction is the only thing that separates this fixture from the expiry one above: a logout
    // that did nothing at all would reach the same state as an expiry a few hours later.
    const row = await db.query<{ revoked_at: Date | null; still_future: boolean }>(
      'SELECT revoked_at, expires_at > NOW() AS still_future FROM auth_sessions WHERE token_hash = $1',
      [hashSessionToken(token)]
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].revoked_at).not.toBeNull();
    expect(row.rows[0].still_future).toBe(true);

    // THE REPLAY. The browser was told to drop the cookie; this is what happens when something
    // kept it anyway.
    const replay = await proxy(requestFor('/api/accounts', token));
    expect(replay.status).toBe(401);
    expect(letsThrough(replay)).toBe(false);

    // And logout itself refuses a request with no session, because it is not on the allowlist.
    const withoutSession = await logout(
      new NextRequest(`${ORIGIN}/api/v1/auth/logout`, { method: 'POST', headers: { host: 'localhost:3000' } })
    );
    expect(withoutSession.status).toBe(401);
  });

  it('the pre-auth ceremony endpoints remain reachable with no session cookie at all', async () => {
    // NEGATIVE CONTROL #12, the "neither empty nor total" half. These four, with no cookie, in the
    // same run as the refusals above — an allowlist that admitted nothing would pass every other
    // fixture in this file.
    for (const path of [
      '/api/v1/auth/register/options',
      '/api/v1/auth/register/verify',
      '/api/v1/auth/login/options',
      '/api/v1/auth/login/verify',
    ]) {
      const response = await proxy(requestFor(path));
      expect({ path, through: letsThrough(response) }).toEqual({ path, through: true });
    }
    // The `/login` page, which is the fifth surface.
    expect(letsThrough(await proxy(requestFor('/login')))).toBe(true);
    expect(letsThrough(await proxy(requestFor('/login/')))).toBe(true);

    // ─── TWO ADDED BY P3-23a, AND THIS CONTROL IS WHY THEY ARE DOCUMENTED ─────────────────────
    //
    // The count below was 5 and this fixture FAILED when they were added, which is the control
    // doing its job: `docs/agent-authorization.md` §2 is about an allowlist creating its holes at
    // exactly the special paths, and one of these mints a 30-day credential. So each is admitted
    // deliberately, with what guards it INSTEAD of the boundary written down here.
    //
    //   `/api/v1/auth/device-claim` — the app has no session yet; getting one is the point. Its
    //   guards are in the handler: the body must carry a single-use code, dead in sixty seconds and
    //   stored only as a SHA-256, and `mayIssueDeviceToken` refuses any caller carrying
    //   `Sec-Fetch-*` headers — so a browser cannot exchange a code even holding one.
    //
    //   `/link-device` — a page with no privilege of its own. It runs the passkey ceremony and can
    //   mint nothing unless one succeeds.
    for (const path of ['/api/v1/auth/device-claim', '/link-device']) {
      const response = await proxy(requestFor(path));
      expect({ path, through: letsThrough(response) }).toEqual({ path, through: true });
    }

    // AND THE HANDOFF MINTER IS NOT AMONG THEM. `/api/v1/auth/device-handoff` requires a signed-in
    // BROWSER — it is the thing that turns a completed ceremony into a code, so admitting it
    // pre-auth would let anyone mint one. It stays behind the boundary.
    expect(letsThrough(await proxy(requestFor('/api/v1/auth/device-handoff')))).toBe(false);

    // FOURTEEN AND NO MORE, and the count is asserted precisely so that growing it is a decision
    // rather than a drift. It went from seven on 2026-09-22: five for the PWA's install assets — a
    // manifest and four icons, carrying an app name, a colour and a drawn square and nothing else —
    // then two more for the service worker and the offline page it falls back to. All of them are
    // the least privileged bytes the server holds, and all of them have to be reachable before auth
    // or an installed app caches the LOGIN PAGE as its own shell. `/sw.js` additionally cannot be a
    // redirect at all: a browser refuses to register one as a worker, silently.
    //
    // `logout` sits under the same directory and is NOT admitted — the allowlist is a set of exact
    // paths rather than a prefix, and a prefix would have let it and every future endpoint under
    // `/api/v1/auth/` through by default. The five new entries are exact paths for the same reason:
    // `/icon-192.png` is admitted and `/icon-192.png/anything` is not.
    expect(PRE_AUTH_PATHS.size).toBe(14);

    // THE NEW ONES CARRY NOTHING. Asserted rather than described, so a future edit that points one
    // of these at something privileged fails here.
    for (const asset of ['/manifest.webmanifest', '/apple-icon.png', '/icon-192.png', '/sw.js', '/offline']) {
      expect(PRE_AUTH_PATHS.has(asset)).toBe(true);
      expect((await proxy(requestFor(`${asset}/anything`))).status).toBe(401);
    }
    expect((await proxy(requestFor('/api/v1/auth/logout'))).status).toBe(401);
    // Nor does a path that merely extends an allowlisted one.
    expect((await proxy(requestFor('/api/v1/auth/register/options/anything'))).status).toBe(401);

    // The Host check is still the outer conjunct: an allowlisted path with a spoofed Host is 403
    // before the session question is even asked.
    const spoofed = new NextRequest(`${ORIGIN}/api/v1/auth/login/options`, { headers: { host: 'evil.example.com' } });
    expect((await proxy(spoofed)).status).toBe(403);
  });

  it('a representative page route is unreachable without a session cookie', async () => {
    // The dashboard renders account balances. Without a session it is not served at all — the
    // refusal is the boundary's, not a `redirect()` inside the page's own component, which would
    // work for this page and leave every page nobody remembered to edit unprotected.
    const response = await proxy(requestFor('/dashboard'));

    expect(letsThrough(response)).toBe(false);
    expect(response.status).toBe(307);
    expect(getRedirectUrl(response)).toBe(`${ORIGIN}/login`);

    for (const path of ['/', '/accounts', '/transactions', '/net-worth', '/properties']) {
      const page = await proxy(requestFor(path));
      expect({ path, through: letsThrough(page) }).toEqual({ path, through: false });
      expect(getRedirectUrl(page)).toBe(`${ORIGIN}/login`);
    }

    // With a live session the same page is served.
    const token = await seedSession({ createdAgo: '1 minute', expiresIn: '1 hour' });
    expect(letsThrough(await proxy(requestFor('/dashboard', token)))).toBe(true);
  });

  it("the matcher still excludes Next's own static assets, so the login page a refused visitor is sent to can render", () => {
    // THE ONE QUESTION G1 CARRIED TO THIS GATE. SPEC.md's allowlist names the `/login` page and not
    // the JS chunks and CSS it pulls; those are served from `_next/static`, which the matcher
    // excludes, so the proxy never runs for them and they need no allowlist entry. If that stopped
    // being true the symptom would be an unstyled, inert login page rather than a hole — but it
    // would be a symptom nobody could diagnose from a 401 on a chunk.
    for (const asset of [
      '/_next/static/chunks/main-app.js',
      '/_next/static/css/app.css',
      '/_next/image?url=%2Ffile.svg',
      '/favicon.ico',
    ]) {
      expect({ asset, matched: unstable_doesMiddlewareMatch({ config, url: asset }) })
        .toEqual({ asset, matched: false });
    }

    // And the boundary DOES run for everything this task protects, including the five allowlisted
    // surfaces — they are admitted by the function, not by falling outside the matcher. A matcher
    // that excluded them would look identical from a browser and would mean the allowlist had
    // silently become "whatever the matcher does".
    for (const path of ['/dashboard', '/api/accounts', '/api/v1/overview', ...PRE_AUTH_PATHS]) {
      expect({ path, matched: unstable_doesMiddlewareMatch({ config, url: path }) })
        .toEqual({ path, matched: true });
    }
  });
});
