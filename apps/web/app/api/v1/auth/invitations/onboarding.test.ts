// P7-41a2 against a scratch database: the browser onboarding path, driven through the real handlers
// with the page's own helpers — scenarios I1 to I6 of plan/tasks/P7-41a2-browser-onboarding/SPEC.md.
//
// WHY THESE AND NOT ONLY P7-41a's FIXTURES. `route.test.ts` proves the endpoints with headers it
// writes by hand. These build the link the owner's panel builds, read it back with the login page's
// reader, and present the code with the page's header builder — so a helper that produced a link
// the reader cannot read, or an empty header in ordinary mode, fails here against the real server
// rather than only against a unit test's idea of it.
//
// Fabricated keypairs, the fabricated invitee "Test User Two", a guarded scratch database.

import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '@/lib/db';
import { createTestAuthenticator, fabricateChallenge } from '@/lib/webauthnTestFixtures';
import { readInvitationFragment } from '@/lib/invitationFragment';
import { invitationHeaders, invitationLink, mayInvite } from '@/lib/invitationLink';
import { InvitationCreatedResponseSchema, MeResponseSchema } from '@b8/contracts/auth';
import { POST as createInvitation } from './route';
import { GET as me } from '../me/route';
import {
  ORIGIN,
  SECOND_USER_NAME,
  authCounts,
  bootstrapOwner,
  cookie,
  enrolSecondUser,
  invite,
  register,
  registrationOptions,
  request,
  resetAuth,
  sessionTokenFrom,
  userIdOf,
  verifyRegistration,
} from '../secondUserTestKit';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** The code as the invitee's page would hold it: link built, fragment read back. */
function codeThroughTheLink(code: string): string {
  const read = readInvitationFragment(new URL(invitationLink(ORIGIN, code)).hash);
  if (read.kind !== 'invitation') throw new Error(`the page's reader refused a minted code: ${read.kind}`);
  return read.code;
}

async function meOf(token: string) {
  const response = await me(request('/api/v1/auth/me', { headers: cookie(token) }));
  return { status: response.status, body: await response.json() };
}

async function credentialCountOf(userId: number): Promise<number> {
  return (await db.query('SELECT 1 FROM webauthn_credentials WHERE user_id = $1', [userId])).rowCount ?? 0;
}

async function consumedAt(code: string): Promise<Date | null> {
  const r = await db.query<{ consumed_at: Date | null }>('SELECT consumed_at FROM user_invitations WHERE code_hash = $1', [sha256(code)]);
  if (r.rows.length !== 1) throw new Error('invitation row not found');
  return r.rows[0].consumed_at;
}

async function invitationCount(): Promise<number> {
  return (await db.query('SELECT 1 FROM user_invitations')).rowCount ?? 0;
}

/**
 * A challenge the server really issued, from a LIVE code's options. A dead code is then presented
 * at `verify` with it, so the refusal there is the gate's and not a challenge mismatch.
 */
async function liveChallenge(liveCode: string) {
  const issued = await registrationOptions(invitationHeaders(liveCode));
  if (!issued.options) throw new Error('the live code was refused at options');
  return { challenge: issued.options.challenge, rpId: issued.options.rp.id };
}

/** Both registration endpoints refuse `headers` with REGISTRATION_CLOSED and a readable message. */
async function expectRefusedOnBoth(headers: Record<string, string>, liveCode: string) {
  const options = await registrationOptions(headers);
  expect(options.response.status).toBe(403);
  expect(options.body.error.code).toBe('REGISTRATION_CLOSED');
  expect(typeof options.body.error.message).toBe('string');
  expect(options.body.error.message.length).toBeGreaterThan(0);

  const { challenge, rpId } = await liveChallenge(liveCode);
  const verify = await verifyRegistration(createTestAuthenticator(), challenge, headers, rpId);
  expect(verify.status).toBe(403);
  const body = await verify.json();
  expect(body.error.code).toBe('REGISTRATION_CLOSED');
  expect(body.error.message.length).toBeGreaterThan(0);
  return { responses: [options.response, verify], bodies: [JSON.stringify(options.body), JSON.stringify(body)] };
}

beforeEach(resetAuth);

afterAll(async () => {
  await resetAuth();
  await db.end();
});

describe('P7-41a2: onboarding through the page helpers', () => {
  it('T41a2-I1: link, reader and header builder redeem end to end into a new user who is not the owner', async () => {
    const owner = await bootstrapOwner();
    const ownerMeBefore = await meOf(owner.token);

    const created = await createInvitation(request('/api/v1/auth/invitations', {
      method: 'POST',
      headers: cookie(owner.token),
      body: { displayName: SECOND_USER_NAME },
    }));
    expect(created.status).toBe(200);
    const parsed = InvitationCreatedResponseSchema.parse(await created.json());
    if (!parsed.success) throw new Error('unreachable: status was 200');
    const code = codeThroughTheLink(parsed.data.code);
    expect(code).toBe(parsed.data.code);

    // A NEW authenticator and NO cookie: the invitee's device.
    const response = await register(createTestAuthenticator(), invitationHeaders(code));
    expect(response.status).toBe(200);

    const users = await db.query<{ id: number; display_name: string; is_owner: boolean }>(
      'SELECT id, display_name, is_owner FROM users ORDER BY id'
    );
    expect(users.rows).toHaveLength(2);
    const invitee = users.rows.find((u) => u.id !== owner.userId)!;
    expect(invitee).toMatchObject({ display_name: SECOND_USER_NAME, is_owner: false });

    const token = sessionTokenFrom(response);
    expect(await userIdOf(token)).toBe(invitee.id);
    expect(await userIdOf(token)).not.toBe(owner.userId);
    const inviteeMe = await meOf(token as string);
    expect(inviteeMe.status).toBe(200);
    expect(inviteeMe.body.data).toMatchObject({ isOwner: false, displayName: SECOND_USER_NAME });

    expect(await credentialCountOf(owner.userId)).toBe(1);
    expect(await meOf(owner.token)).toEqual(ownerMeBefore);
  });

  it('T41a2-I2: headerless registration is today\'s behaviour: closed once a credential exists', async () => {
    await bootstrapOwner();
    const before = await authCounts();
    const none = invitationHeaders(null);
    expect(none).toEqual({});

    const options = await registrationOptions(none);
    expect(options.response.status).toBe(403);
    expect(options.body.error.code).toBe('REGISTRATION_CLOSED');

    const verify = await verifyRegistration(createTestAuthenticator(), fabricateChallenge(), none, 'localhost');
    expect(verify.status).toBe(403);
    expect((await verify.json()).error.code).toBe('REGISTRATION_CLOSED');

    expect(await authCounts()).toEqual(before);
  });

  it('T41a2-I3: the owner opening the link enrols nobody, and the code survives for the invitee', async () => {
    const owner = await bootstrapOwner();
    const code = codeThroughTheLink(await invite(owner.token));
    const spare = await invite(owner.token, 'Test User Three');
    const before = await authCounts();

    // What a signed-in owner's browser sends: the session cookie AND the code.
    await expectRefusedOnBoth({ ...cookie(owner.token), ...invitationHeaders(code) }, spare);

    expect(await authCounts()).toEqual(before);
    expect(await credentialCountOf(owner.userId)).toBe(1);
    expect(await consumedAt(code)).toBeNull();

    // Still redeemable, cookie-less, into somebody who is not the owner.
    const later = await register(createTestAuthenticator(), invitationHeaders(code));
    expect(later.status).toBe(200);
    const redeemed = await userIdOf(sessionTokenFrom(later));
    expect(redeemed).not.toBeNull();
    expect(redeemed).not.toBe(owner.userId);
  });

  it('T41a2-I4: every dead code refuses on both endpoints with a readable message and enrols nothing', async () => {
    const owner = await bootstrapOwner();
    const spare = await invite(owner.token, 'Test User Three');

    const consumed = await invite(owner.token);
    expect((await register(createTestAuthenticator(), invitationHeaders(consumed))).status).toBe(200);

    const expired = await invite(owner.token, 'Test User Four');
    // Both timestamps move together so the row still satisfies the lifetime CHECK.
    await db.query(
      `UPDATE user_invitations
          SET created_at = created_at - INTERVAL '8 days', expires_at = expires_at - INTERVAL '8 days'
        WHERE code_hash = $1`,
      [sha256(expired)]
    );

    const before = await authCounts();
    const dead: Array<[string, Record<string, string>]> = [
      ['unknown well-formed', invitationHeaders('Zz-_yyXXwwVVuuTTssRRqq')],
      ['21 characters', invitationHeaders('Zz-_yyXXwwVVuuTTssRRq')],
      ['consumed', invitationHeaders(consumed)],
      ['expired', invitationHeaders(expired)],
      // Written by hand, NOT through the builder, which refuses to produce it: this row is why the
      // builder must send no header at all when there is no code.
      ['empty-string header', { 'x-invitation-code': '' }],
    ];
    for (const [label, headers] of dead) {
      try {
        await expectRefusedOnBoth(headers, spare);
      } catch (error) {
        throw new Error(`${label}: ${(error as Error).message}`);
      }
      expect(await authCounts(), label).toEqual(before);
    }
  });

  it('T41a2-I5: the code reaches no log line and no response but the one that mints it', async () => {
    const captured: string[] = [];
    const record = (...args: unknown[]) => {
      for (const arg of args) captured.push(typeof arg === 'string' ? arg : arg instanceof Uint8Array ? Buffer.from(arg).toString() : JSON.stringify(arg) ?? String(arg));
    };
    const spies = [
      ...(['log', 'info', 'warn', 'error'] as const).map((method) => {
        const original = console[method].bind(console);
        return vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { record(...args); original(...args); });
      }),
      ...([process.stdout, process.stderr] as const).map((stream) => {
        const original = stream.write.bind(stream) as (...a: unknown[]) => boolean;
        return vi.spyOn(stream, 'write').mockImplementation(((...args: unknown[]) => { record(args[0]); return original(...args); }) as typeof stream.write);
      }),
    ];

    const codes: string[] = [];
    const responses: Response[] = [];
    const bodies: string[] = [];
    try {
      const owner = await bootstrapOwner();

      // Creation: the one response that carries the code, and it is not cacheable.
      const created = await createInvitation(request('/api/v1/auth/invitations', {
        method: 'POST',
        headers: cookie(owner.token),
        body: { displayName: SECOND_USER_NAME },
      }));
      expect(created.headers.get('cache-control')).toBe('no-store');
      const parsed = InvitationCreatedResponseSchema.parse(await created.json());
      if (!parsed.success) throw new Error('unreachable');
      const redeemed = codeThroughTheLink(parsed.data.code);
      const ownersAttempt = await invite(owner.token, 'Test User Three');
      const spare = await invite(owner.token, 'Test User Four');
      codes.push(redeemed, ownersAttempt, spare);

      // I3's refusal: owner cookie plus code.
      const both = await expectRefusedOnBoth({ ...cookie(owner.token), ...invitationHeaders(ownersAttempt) }, spare);
      responses.push(...both.responses);
      bodies.push(...both.bodies);

      // A successful redemption, request by request so both responses are kept.
      const issued = await registrationOptions(invitationHeaders(redeemed));
      responses.push(issued.response);
      bodies.push(JSON.stringify(issued.body));
      const verified = await verifyRegistration(createTestAuthenticator(), issued.options!.challenge, invitationHeaders(redeemed), issued.options!.rp.id);
      expect(verified.status).toBe(200);
      expect(verified.headers.getSetCookie().length).toBeGreaterThan(0);
      responses.push(verified);
      bodies.push(await verified.text());

      // I4's refusals: now-consumed, unknown and short codes.
      const unknown = 'Yy-_xxWWvvUUttSSrrQQpp';
      codes.push(unknown);
      for (const code of [redeemed, unknown, unknown.slice(0, 21)]) {
        const refused = await expectRefusedOnBoth(invitationHeaders(code), spare);
        responses.push(...refused.responses);
        bodies.push(...refused.bodies);
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    // Not vacuous: the handlers do log (enrolments, refusals), and every response was kept.
    expect(captured.length).toBeGreaterThan(0);
    expect(responses).toHaveLength(10);
    expect(bodies).toHaveLength(10);
    for (const code of codes) {
      const hash = sha256(code);
      for (const line of captured) {
        expect(line.includes(code), 'a captured log line contains a code').toBe(false);
        expect(line.includes(hash), 'a captured log line contains a code hash').toBe(false);
      }
      for (const body of bodies) {
        expect(body.includes(code), 'a ceremony response body contains a code').toBe(false);
        expect(body.includes(hash), 'a ceremony response body contains a code hash').toBe(false);
      }
      for (const response of responses) {
        const headerText = [...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n')
          + response.headers.getSetCookie().join('\n');
        expect(headerText.includes(code), 'a ceremony response header contains a code').toBe(false);
        expect(headerText.includes(hash), 'a ceremony response header contains a code hash').toBe(false);
      }
    }
  });

  it('T41a2-I6: the control\'s visibility follows the real me, and a second user cannot mint', async () => {
    const owner = await bootstrapOwner();
    const second = await enrolSecondUser(owner.token);

    const ownerMe = MeResponseSchema.parse((await meOf(owner.token)).body);
    const secondMe = MeResponseSchema.parse((await meOf(second.token)).body);
    if (!ownerMe.success || !secondMe.success) throw new Error('me refused a valid session');
    expect(mayInvite(ownerMe.data)).toBe(true);
    expect(mayInvite(secondMe.data)).toBe(false);

    const before = await invitationCount();
    const refused = await createInvitation(request('/api/v1/auth/invitations', {
      method: 'POST',
      headers: cookie(second.token),
      body: { displayName: 'Test User Three' },
    }));
    expect(refused.status).toBe(403);
    expect(await invitationCount()).toBe(before);
  });
});
