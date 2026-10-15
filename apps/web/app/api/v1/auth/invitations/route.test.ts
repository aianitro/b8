// P7-41a against a scratch database: minting an invitation, and redeeming it into a NEW user.
// Scenarios S3 through S8 of plan/tasks/P7-41a-second-user/SPEC.md.
//
// THE PROPERTY EVERY BLOCK HERE PROTECTS: an invitation is the one way an unauthenticated request
// can create a user, so it must be minted only by the owner, stored only as a hash, redeemed at
// most once, refused once expired, and never spent by a ceremony that failed. Each of those is one
// line of code away from being false, and each block below is the fixture that notices.
//
// Fabricated keypairs, fabricated display names ("Test User Two"), a guarded scratch database.

import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import db from '@/lib/db';
import { createPersonalToken } from '@/lib/authSession';
import { createTestAuthenticator, fabricateChallenge } from '@/lib/webauthnTestFixtures';
import { InvitationCreatedResponseSchema } from '@b8/contracts/auth';
import { POST as createInvitation } from './route';
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
  userIdOf,
  verifyRegistration,
} from '../secondUserTestKit';

function invitationRequest(headers: Record<string, string>, body: unknown = { displayName: SECOND_USER_NAME }) {
  return request('/api/v1/auth/invitations', { method: 'POST', headers, body });
}

async function invitationCount(): Promise<number> {
  return (await db.query('SELECT 1 FROM user_invitations')).rowCount ?? 0;
}

async function invitationRow(code: string) {
  const hash = createHash('sha256').update(code).digest('hex');
  const r = await db.query<{ consumed_at: Date | null; consumed_by: number | null }>(
    'SELECT consumed_at, consumed_by FROM user_invitations WHERE code_hash = $1',
    [hash]
  );
  return r.rows[0];
}

beforeEach(resetAuth);

afterAll(async () => {
  await resetAuth();
  await db.end();
});

describe('P7-41a: minting an invitation', () => {
  it('T41a-S3: the owner creates an invitation; the code is shown once and stored only as its hash', async () => {
    const owner = await bootstrapOwner();

    const response = await createInvitation(invitationRequest(cookie(owner.token)));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = InvitationCreatedResponseSchema.parse(await response.json());
    if (!body.success) throw new Error('unreachable: status was 200');
    const { code, expiresAt } = body.data;
    expect(code.length).toBeGreaterThanOrEqual(22);

    // AFTER NOW, AND AT MOST SEVEN DAYS AWAY — both read off the database's clock, not this one.
    const window = await db.query<{ after_now: boolean; within_week: boolean }>(
      `SELECT $1::timestamptz > NOW() AS after_now,
              $1::timestamptz <= NOW() + INTERVAL '7 days' AS within_week`,
      [expiresAt]
    );
    expect(window.rows[0]).toEqual({ after_now: true, within_week: true });

    // ONE ROW, AND NO COLUMN OF IT HOLDS THE CODE — not equal to it, not containing it.
    const rows = await db.query('SELECT * FROM user_invitations');
    expect(rows.rows).toHaveLength(1);
    for (const [column, value] of Object.entries(rows.rows[0])) {
      const text = value instanceof Date ? value.toISOString() : String(value);
      expect(text, column).not.toBe(code);
      expect(text, column).not.toContain(code);
    }
    // The stored hash IS the SHA-256 of the code — the lookup redemption will perform.
    expect(rows.rows[0].code_hash).toBe(createHash('sha256').update(code).digest('hex'));
    expect(rows.rows[0].display_name).toBe(SECOND_USER_NAME);
    expect(String(rows.rows[0].created_by)).toBe(String(owner.userId));
  });

  it('T41a-S4: only the owner\'s full-scope browser session may create an invitation', async () => {
    const owner = await bootstrapOwner();
    const second = await enrolSecondUser(owner.token);
    // The second user's own redemption left one consumed row behind; every refusal below must add none.
    const before = await invitationCount();
    expect(before).toBe(1);

    const readToken = await createPersonalToken({ label: 'read script', scope: 'read' });
    const fullToken = await createPersonalToken({ label: 'full script', scope: 'full' });

    const refused: Array<[string, Record<string, string>]> = [
      ['no session', {}],
      ['a read-scope personal token', bearer(readToken.token)],
      ['a full-scope personal token', bearer(fullToken.token)],
      ["the second user's browser session", cookie(second.token)],
    ];
    for (const [label, headers] of refused) {
      const response = await createInvitation(invitationRequest(headers));
      expect([401, 403], label).toContain(response.status);
      const body = await response.json();
      expect(body.success, label).toBe(false);
      expect(body.data, label).toBeUndefined();
      expect(await invitationCount(), label).toBe(before);
    }

    // A display name the contract refuses is a 400 and writes nothing, even from the owner.
    for (const displayName of ['', 'x'.repeat(61)]) {
      const response = await createInvitation(invitationRequest(cookie(owner.token), { displayName }));
      expect(response.status, `displayName of length ${displayName.length}`).toBe(400);
      expect(await invitationCount()).toBe(before);
    }
    // And a stray key is refused rather than carried through — the strict schema's reason.
    const smuggled = await createInvitation(
      invitationRequest(cookie(owner.token), { displayName: SECOND_USER_NAME, isOwner: true })
    );
    expect(smuggled.status).toBe(400);
    expect(await invitationCount()).toBe(before);
  });
});

describe('P7-41a: redeeming an invitation', () => {
  it('T41a-S5: redemption with no session enrols a NEW user, not the owner, and spends the code', async () => {
    const owner = await bootstrapOwner();
    const ownerBefore = await db.query('SELECT * FROM users WHERE id = $1', [owner.userId]);
    const ownerCredentialBefore = await db.query(
      'SELECT * FROM webauthn_credentials WHERE credential_id = $1',
      [owner.authenticator.credentialId]
    );
    const code = await invite(owner.token);

    const invitee = createTestAuthenticator();
    const response = await register(invitee, invitationHeader(code));
    expect(response.status).toBe(200);

    // A NEW USERS ROW: not the owner, named as the owner wrote on the invitation.
    const newUser = await db.query<{ id: number; display_name: string; is_owner: boolean }>(
      'SELECT id, display_name, is_owner FROM users WHERE id <> $1',
      [owner.userId]
    );
    expect(newUser.rows).toHaveLength(1);
    expect(newUser.rows[0]).toMatchObject({ display_name: SECOND_USER_NAME, is_owner: false });
    const newUserId = newUser.rows[0].id;

    // THE CREDENTIAL IS THE NEW USER'S, AND IS NOT TAGGED 'bootstrap'.
    const credential = await db.query<{ user_id: number; enrolled_via: string }>(
      'SELECT user_id, enrolled_via FROM webauthn_credentials WHERE credential_id = $1',
      [invitee.credentialId]
    );
    expect(String(credential.rows[0].user_id)).toBe(String(newUserId));
    expect(String(credential.rows[0].user_id)).not.toBe(String(owner.userId));
    expect(credential.rows[0].enrolled_via).not.toBe('bootstrap');

    // THE COOKIE RESOLVES TO THE NEW USER.
    expect(String(await userIdOf(sessionTokenFrom(response)))).toBe(String(newUserId));

    // THE INVITATION IS SPENT, BY THIS USER.
    const spent = await invitationRow(code);
    expect(spent.consumed_at).not.toBeNull();
    expect(String(spent.consumed_by)).toBe(String(newUserId));

    // THE OWNER IS UNTOUCHED, and the bootstrap slot still holds exactly one credential.
    expect((await db.query('SELECT * FROM users WHERE id = $1', [owner.userId])).rows).toEqual(ownerBefore.rows);
    expect(
      (await db.query('SELECT * FROM webauthn_credentials WHERE credential_id = $1', [owner.authenticator.credentialId])).rows
    ).toEqual(ownerCredentialBefore.rows);
    expect((await authCounts()).bootstrap).toBe(1);
  });

  it('T41a-S6: an invitation is single-use, sequentially and under concurrency', async () => {
    const owner = await bootstrapOwner();

    // SEQUENTIAL: redeemed once, then the same code with a different authenticator is refused.
    const code = await invite(owner.token);
    expect((await register(createTestAuthenticator(), invitationHeader(code))).status).toBe(200);
    const afterFirst = await authCounts();
    const replay = createTestAuthenticator();
    const replayResponse = await register(replay, invitationHeader(code));
    expect(replayResponse.status).toBe(403);
    expect(await authCounts()).toEqual(afterFirst);

    // CONCURRENT, AND FORCED TO OVERLAP. Two authenticators, two challenges issued while the code
    // is live, two verifies — and a third party holding the invitation's row lock while they start.
    //
    // WHY THE HELD LOCK. Two `Promise.all` requests against one pool do not actually overlap at the
    // database: the first usually commits before the second reads, so a version of the redemption
    // with no row lock at all passed this block every time (G3's probe). Holding the row here makes
    // the overlap certain instead of likely. Both redemptions get past the read-only pre-check and
    // the ceremony, and both then block on the held row: the locked implementation blocks at its
    // `SELECT … FOR UPDATE`; an unlocked one would read the row freely, create its user and
    // credential, and block at the consuming UPDATE. Only once BOTH are seen waiting in
    // `pg_stat_activity` is the lock released. From there the locked code lets one through and the
    // other re-reads a consumed row and is refused; the unlocked code lets both UPDATEs through one
    // after the other (nothing in that UPDATE re-checks `consumed_at`), and two users exist. So this
    // block passes or fails by the code's design, not by the scheduler.
    const raced = await invite(owner.token, 'Test User Three');
    const racedHash = createHash('sha256').update(raced).digest('hex');
    const usersBefore = (await authCounts()).users;
    const first = await registrationOptions(invitationHeader(raced));
    const second = await registrationOptions(invitationHeader(raced));
    expect(first.options && second.options).toBeTruthy();
    const [a, b] = [createTestAuthenticator(), createTestAuthenticator()];

    const holder = await db.connect();
    let outcomes: Response[];
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM user_invitations WHERE code_hash = $1 FOR UPDATE', [racedHash]);
      const racing = Promise.all([
        verifyRegistration(a, first.options!.challenge, invitationHeader(raced), first.options!.rp.id),
        verifyRegistration(b, second.options!.challenge, invitationHeader(raced), second.options!.rp.id),
      ]);
      // Both redemptions must be blocked on a lock in a statement touching the invitation before the
      // holder lets go. Bounded, so a redemption that never reaches the database fails loudly here
      // rather than hanging the suite.
      let waiting = 0;
      for (let i = 0; i < 200 && waiting < 2; i++) {
        const r = await db.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query ILIKE '%user_invitations%'`
        );
        waiting = Number(r.rows[0].n);
        if (waiting < 2) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waiting, 'both redemptions blocked on the invitation at once').toBe(2);
      await holder.query('ROLLBACK');
      outcomes = await racing;
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      holder.release();
    }
    expect(outcomes.map((r) => r.status).sort()).toEqual([200, 403]);
    expect((await authCounts()).users).toBe(usersBefore + 1);
    const enrolledOf = await db.query(
      'SELECT 1 FROM webauthn_credentials WHERE credential_id = ANY($1)',
      [[a.credentialId, b.credentialId]]
    );
    expect(enrolledOf.rowCount).toBe(1);
    expect((await invitationRow(raced)).consumed_at).not.toBeNull();
  });

  it('T41a-S7: an expired invitation is refused at options and at verify; an unexpired sibling redeems', async () => {
    const owner = await bootstrapOwner();
    const aged = await invite(owner.token);
    const sibling = await invite(owner.token, 'Test User Three');

    // A challenge issued while the code was live, so `verify` is reached with a ceremony that would
    // otherwise verify — the only thing wrong with it is the clock.
    const issued = await registrationOptions(invitationHeader(aged));
    expect(issued.options).not.toBeNull();

    // AGEING MOVES BOTH TIMESTAMPS BY THE SAME INTERVAL, so the row still satisfies the lifetime
    // CHECK; setting `created_at` alone far back would be a row the table refuses.
    const agedHash = createHash('sha256').update(aged).digest('hex');
    await db.query(
      `UPDATE user_invitations
          SET created_at = created_at - INTERVAL '8 days', expires_at = expires_at - INTERVAL '8 days'
        WHERE code_hash = $1`,
      [agedHash]
    );
    const before = await authCounts();

    const options = await registrationOptions(invitationHeader(aged));
    expect(options.response.status).toBe(403);
    expect(options.body.error.code).toBe('REGISTRATION_CLOSED');

    const late = createTestAuthenticator();
    const verify = await verifyRegistration(late, issued.options!.challenge, invitationHeader(aged), issued.options!.rp.id);
    expect(verify.status).toBe(403);
    expect((await verify.json()).error.code).toBe('REGISTRATION_CLOSED');
    expect(await authCounts()).toEqual(before);
    expect((await invitationRow(aged)).consumed_at).toBeNull();

    // The sibling, not aged, still redeems.
    expect((await register(createTestAuthenticator(), invitationHeader(sibling))).status).toBe(200);
    expect((await authCounts()).users).toBe(before.users + 1);
  });

  it('T41a-S8: a failed ceremony does not burn the invitation', async () => {
    const owner = await bootstrapOwner();
    const code = await invite(owner.token);
    const before = await authCounts();

    // (a) A WRONG CHALLENGE: options issued, then a response answering a challenge the server never
    // issued. Refused as a ceremony failure, and the code is untouched.
    const issued = await registrationOptions(invitationHeader(code));
    expect(issued.options).not.toBeNull();
    const wrong = await verifyRegistration(createTestAuthenticator(), fabricateChallenge(), invitationHeader(code), issued.options!.rp.id);
    expect(wrong.status).toBe(400);
    expect((await invitationRow(code)).consumed_at).toBeNull();
    expect(await authCounts()).toEqual(before);

    // (b) AN AUTHENTICATOR ALREADY ENROLLED (the owner's): 409, no user created, code untouched.
    const duplicate = await register(owner.authenticator, invitationHeader(code));
    expect(duplicate.status).toBe(409);
    expect((await invitationRow(code)).consumed_at).toBeNull();
    expect(await authCounts()).toEqual(before);

    // And a valid redemption afterwards still succeeds — the code was never spent.
    const later = await register(createTestAuthenticator(), invitationHeader(code));
    expect(later.status).toBe(200);
    expect((await invitationRow(code)).consumed_at).not.toBeNull();
  });
});
