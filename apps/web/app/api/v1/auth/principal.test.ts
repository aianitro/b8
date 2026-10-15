// P7-41a against a scratch database: every session knows its user, and the bootstrap gate still
// cannot be talked into creating one. Scenarios S1, S2, S9, S10, S11, S12 and S15 of
// plan/tasks/P7-41a-second-user/SPEC.md.
//
// THE TWO RULES THIS FILE EXISTS FOR pull in opposite directions, which is why they share it. A
// second person must be able to enrol (S5, in invitations/route.test.ts) — and nothing about that
// may reopen the door an unauthenticated stranger could walk through (S2, S9). The fixtures here
// hold the door; the invitation fixtures hold the way in.
//
// EACH BLOCK SETS UP ITS OWN PRECONDITION through the real ceremonies, so the sessions and users
// asserted on are ones the app itself created rather than rows a test wrote to look right.
// Fabricated keypairs, fabricated names, a guarded scratch database.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import db from '@/lib/db';
import { createPersonalToken, resolveSession } from '@/lib/authSession';
import { createTestAuthenticator, fabricateChallenge } from '@/lib/webauthnTestFixtures';
import { MeResponseSchema } from '@b8/contracts/auth';
import { proxy } from '@/proxy';
import { GET as me } from './me/route';
import {
  SECOND_USER_NAME,
  authCounts,
  bearer,
  bootstrapOwner,
  cookie,
  enrolSecondUser,
  invitationHeader,
  invite,
  register,
  registrationOptions,
  request,
  resetAuth,
  sessionTokenFrom,
  signIn,
  userIdOf,
  verifyRegistration,
} from './secondUserTestKit';

async function credentialUser(credentialId: string): Promise<number | null> {
  const r = await db.query<{ user_id: number }>(
    'SELECT user_id FROM webauthn_credentials WHERE credential_id = $1',
    [credentialId]
  );
  return r.rows[0]?.user_id ?? null;
}

beforeEach(resetAuth);

afterAll(async () => {
  await resetAuth();
  await db.end();
});

describe('P7-41a: the principal behind every session', () => {
  it('T41a-S1: bootstrap creates the owner and only the owner', async () => {
    expect((await authCounts()).credentials).toBe(0);
    expect((await db.query('SELECT 1 FROM users')).rowCount).toBe(0);

    const authenticator = createTestAuthenticator();
    const response = await register(authenticator);
    expect(response.status).toBe(200);

    // EXACTLY ONE USER, AND IT IS THE OWNER.
    const users = await db.query<{ id: number; is_owner: boolean }>('SELECT id, is_owner FROM users');
    expect(users.rows).toHaveLength(1);
    expect(users.rows[0].is_owner).toBe(true);
    const ownerId = users.rows[0].id;

    // The credential is that user's, and the session resolves to them.
    expect(String(await credentialUser(authenticator.credentialId))).toBe(String(ownerId));
    const token = sessionTokenFrom(response) as string;
    expect(String(await userIdOf(token))).toBe(String(ownerId));

    // `me` says so.
    const meResponse = await me(request('/api/v1/auth/me', { headers: cookie(token) }));
    expect(meResponse.status).toBe(200);
    const body = MeResponseSchema.parse(await meResponse.json());
    expect(body).toEqual({ success: true, data: { userId: ownerId, displayName: 'Owner', isOwner: true } });

    // AT MOST ONE OWNER, BY THE DATABASE. A second is_owner row is a statement Postgres refuses,
    // however it is written — which is what makes a concurrent second bootstrap lose.
    await expect(
      db.query(`INSERT INTO users (display_name, is_owner) VALUES ('Test User Two', TRUE)`)
    ).rejects.toMatchObject({ code: '23505' });
    expect((await db.query('SELECT 1 FROM users')).rowCount).toBe(1);
  });

  it('T41a-S2: with any credential present, an unauthenticated registration without a valid invitation is refused on both endpoints', async () => {
    const owner = await bootstrapOwner();
    // A CONSUMED invitation: minted and redeemed for real, so its row is exactly what a used code
    // leaves behind.
    const second = await enrolSecondUser(owner.token);
    // An EXPIRED invitation: minted, then aged by moving both timestamps back together — the
    // lifetime CHECK compares them, so ageing one alone would be a row the table refuses.
    const expiredCode = await invite(owner.token, 'Test User Three');
    await db.query(
      `UPDATE user_invitations
          SET created_at = created_at - INTERVAL '5 days', expires_at = expires_at - INTERVAL '5 days'
        WHERE consumed_at IS NULL`
    );

    const before = await authCounts();
    const attempts: Array<[string, Record<string, string>]> = [
      ['no cookie, no header', {}],
      ['a garbage code', invitationHeader('not-a-real-invitation-code-at-all')],
      ['a malformed code', invitationHeader('%%%')],
      ['a consumed code', invitationHeader(second.code)],
      ['an expired code', invitationHeader(expiredCode)],
    ];

    for (const [label, headers] of attempts) {
      const stranger = createTestAuthenticator();

      const optionsAttempt = await registrationOptions(headers);
      expect(optionsAttempt.response.status, `options, ${label}`).toBe(403);
      expect(optionsAttempt.body.error.code, `options, ${label}`).toBe('REGISTRATION_CLOSED');
      // Nothing is handed out: no options, so no credential list and no challenge.
      expect(optionsAttempt.body.data, `options, ${label}`).toBeUndefined();

      const verifyAttempt = await verifyRegistration(stranger, fabricateChallenge(), headers);
      expect(verifyAttempt.status, `verify, ${label}`).toBe(403);
      expect((await verifyAttempt.json()).error.code, `verify, ${label}`).toBe('REGISTRATION_CLOSED');
      expect(sessionTokenFrom(verifyAttempt), `verify, ${label}`).toBeNull();

      // THE REFUSAL IS THE ABSENCE OF A ROW. Same users, same credentials, same sessions, and the
      // single bootstrap slot still holds exactly the owner's.
      expect(await authCounts(), label).toEqual(before);
      expect(await credentialUser(stranger.credentialId), label).toBeNull();
    }
    expect(before.bootstrap).toBe(1);
  });

  it('T41a-S9: a session and an invitation code together are refused, and the code is not spent', async () => {
    const owner = await bootstrapOwner();
    const code = await invite(owner.token);
    const before = await authCounts();

    const both = { ...cookie(owner.token), ...invitationHeader(code) };
    const optionsAttempt = await registrationOptions(both);
    expect(optionsAttempt.response.status).toBe(403);
    expect(optionsAttempt.body.error.code).toBe('REGISTRATION_CLOSED');

    const stranger = createTestAuthenticator();
    const verifyAttempt = await verifyRegistration(stranger, fabricateChallenge(), both);
    expect(verifyAttempt.status).toBe(403);
    expect((await verifyAttempt.json()).error.code).toBe('REGISTRATION_CLOSED');

    expect(await authCounts()).toEqual(before);
    expect(await credentialUser(stranger.credentialId)).toBeNull();
    const invitation = await db.query('SELECT consumed_at, consumed_by FROM user_invitations');
    expect(invitation.rows).toEqual([{ consumed_at: null, consumed_by: null }]);

    // And the code still works on its own, so the refusal really did not touch it.
    expect((await register(createTestAuthenticator(), invitationHeader(code))).status).toBe(200);
  });

  it('T41a-S10: an additional passkey added while signed in goes to the signed-in user, never across users', async () => {
    const owner = await bootstrapOwner();
    const second = await enrolSecondUser(owner.token);
    const usersBefore = (await authCounts()).users;

    // THE SECOND USER ADDS A DEVICE. It is theirs — not the owner's by default.
    const secondDevice = createTestAuthenticator();
    const asSecond = await register(secondDevice, cookie(second.token));
    expect(asSecond.status).toBe(200);
    expect(String(await credentialUser(secondDevice.credentialId))).toBe(String(second.userId));
    expect(String(await userIdOf(sessionTokenFrom(asSecond)))).toBe(String(second.userId));

    // The options the second user was given excluded only THEIR OWN credentials, never the owner's.
    const secondOptions = await registrationOptions(cookie(second.token));
    // The contract keeps the options object loose (the library adds keys this app never heard of),
    // so the list is read through the shape the WebAuthn spec gives it.
    const excludeList = secondOptions.options!.excludeCredentials as Array<{ id: string }>;
    const excluded = excludeList.map((c) => c.id).sort();
    expect(excluded).toEqual([second.authenticator.credentialId, secondDevice.credentialId].sort());
    expect(excluded).not.toContain(owner.authenticator.credentialId);

    // THE OWNER ADDS A DEVICE. It is the owner's.
    const ownerDevice = createTestAuthenticator();
    const asOwner = await register(ownerDevice, cookie(owner.token));
    expect(asOwner.status).toBe(200);
    expect(String(await credentialUser(ownerDevice.credentialId))).toBe(String(owner.userId));

    // NOTHING MOVED, AND NOBODY NEW. The original credentials keep their users, and adding a device
    // created no users row in either case.
    expect(String(await credentialUser(owner.authenticator.credentialId))).toBe(String(owner.userId));
    expect(String(await credentialUser(second.authenticator.credentialId))).toBe(String(second.userId));
    expect((await authCounts()).users).toBe(usersBefore);
    const tags = await db.query<{ enrolled_via: string }>(
      'SELECT enrolled_via FROM webauthn_credentials WHERE credential_id = ANY($1) ORDER BY 1',
      [[secondDevice.credentialId, ownerDevice.credentialId]]
    );
    expect(tags.rows.map((r) => r.enrolled_via)).toEqual(['authenticated', 'authenticated']);
  });

  it('T41a-S11: a login assertion resolves to the user whose credential signed it', async () => {
    const owner = await bootstrapOwner();
    const second = await enrolSecondUser(owner.token);

    const secondLogin = await signIn(second.authenticator);
    expect(secondLogin.status).toBe(200);
    expect(String(await userIdOf(sessionTokenFrom(secondLogin)))).toBe(String(second.userId));

    const ownerLogin = await signIn(owner.authenticator);
    expect(ownerLogin.status).toBe(200);
    expect(String(await userIdOf(sessionTokenFrom(ownerLogin)))).toBe(String(owner.userId));
    expect(String(owner.userId)).not.toBe(String(second.userId));
  });

  it('T41a-S12: a personal token belongs to the user it was minted for, defaulting to the owner — never to the newest passkey', async () => {
    const owner = await bootstrapOwner();
    const second = await enrolSecondUser(owner.token);
    // Precondition the rule turns on: the NEWEST credential is the second user's.
    const newest = await db.query<{ user_id: number }>(
      'SELECT user_id FROM webauthn_credentials ORDER BY created_at DESC, credential_id DESC LIMIT 1'
    );
    expect(String(newest.rows[0].user_id)).toBe(String(second.userId));

    const unnamed = await createPersonalToken({ label: 'owner script', scope: 'full' });
    expect(String((await resolveSession(unnamed.token))?.userId)).toBe(String(owner.userId));

    const named = await createPersonalToken({ label: 'second user script', scope: 'read', userId: second.userId });
    expect(String((await resolveSession(named.token))?.userId)).toBe(String(second.userId));

    // `me` with each bearer returns the matching user — through the boundary, which must let a
    // personal token of either scope reach a GET, and through the handler.
    for (const [token, expected] of [[unnamed.token, owner], [named.token, second]] as const) {
      const viaProxy = await proxy(request('/api/v1/auth/me', { headers: bearer(token) }));
      expect(viaProxy.headers.get('x-middleware-next')).toBe('1');
      const response = await me(request('/api/v1/auth/me', { headers: bearer(token) }));
      expect(response.status).toBe(200);
      const parsed = MeResponseSchema.parse(await response.json());
      expect(parsed.success).toBe(true);
      expect(String(parsed.success ? parsed.data.userId : null)).toBe(String(expected.userId));
    }

    // A user id that names nobody mints nothing, rather than falling back to the owner.
    await expect(createPersonalToken({ label: 'nobody', scope: 'full', userId: 999999 })).rejects.toThrow();
  });

  it('T41a-S15: me returns the signed-in user, and nothing without a credential', async () => {
    const owner = await bootstrapOwner();
    const second = await enrolSecondUser(owner.token);

    const asOwner = MeResponseSchema.parse(await (await me(request('/api/v1/auth/me', { headers: cookie(owner.token) }))).json());
    expect(asOwner).toEqual({ success: true, data: { userId: owner.userId, displayName: 'Owner', isOwner: true } });

    const asSecond = MeResponseSchema.parse(await (await me(request('/api/v1/auth/me', { headers: cookie(second.token) }))).json());
    expect(asSecond).toEqual({ success: true, data: { userId: second.userId, displayName: SECOND_USER_NAME, isOwner: false } });

    // NO CREDENTIAL: refused, and the body carries no user — not the owner, not anyone.
    const anonymous = await me(request('/api/v1/auth/me'));
    expect(anonymous.status).toBe(401);
    const body = await anonymous.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('Owner');
  });
});
