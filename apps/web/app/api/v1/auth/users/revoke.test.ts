// P7-41a against a scratch database: the owner removes the second user. Scenario S16 of
// plan/tasks/P7-41a-second-user/SPEC.md.
//
// WHAT "REMOVED" HAS TO MEAN, all of it at once: every way the second user had in stops working —
// the browser session, the personal token, the passkey itself, and their phone's notifications —
// while the record of who they were survives, because proposals they decided still name them. And
// the owner, whose rows sit in the same tables, loses nothing.
//
// The refusals run FIRST, against the same fixture, so "nothing changed" is asserted over a state
// that has something to change. Fabricated keypairs and names, push endpoints that cannot resolve,
// VAPID keys generated in-process so the send path really chooses recipients.

import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '@/lib/db';
import { createPersonalToken, enrolCredential, resolveSession } from '@/lib/authSession';
import { decideProposal } from '@/lib/proposalStore';
import { registerSubscription, sendWebPush } from '@/lib/webPush';
import { POST as revoke } from './[id]/revoke/route';
import {
  bootstrapOwner,
  cookie,
  enrolSecondUser,
  installFabricatedVapid,
  recordingFetch,
  request,
  resetAuth,
  signIn,
} from '../secondUserTestKit';

const OWNER_ENDPOINT = 'https://push.example.invalid/revoke-owner-phone';
const SECOND_ENDPOINT = 'https://push.example.invalid/revoke-second-phone';

function revokeRequest(id: number | string, token: string) {
  return revoke(
    request(`/api/v1/auth/users/${id}/revoke`, { method: 'POST', headers: cookie(token) }),
    { params: Promise.resolve({ id: String(id) }) }
  );
}

async function targetsOf(send: () => Promise<number>): Promise<string[]> {
  const recorder = recordingFetch();
  vi.stubGlobal('fetch', recorder.fetch);
  try {
    await send();
  } finally {
    vi.unstubAllGlobals();
  }
  return [...recorder.targets].sort();
}

/** Everything a refused revoke must leave exactly as it was. */
async function snapshot() {
  const r = await db.query(
    `SELECT (SELECT json_agg(u ORDER BY id) FROM users u) AS users,
            (SELECT json_agg(c.credential_id ORDER BY c.credential_id) FROM webauthn_credentials c) AS credentials,
            (SELECT json_agg(s.token_hash ORDER BY s.token_hash) FROM auth_sessions s WHERE s.revoked_at IS NULL) AS sessions,
            (SELECT json_agg(w ORDER BY endpoint) FROM web_push_subscriptions w) AS subscriptions`
  );
  return r.rows[0];
}

beforeEach(async () => {
  await resetAuth();
  installFabricatedVapid();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await resetAuth();
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_SUBJECT;
  await db.end();
});

describe('P7-41a: removing the second user', () => {
  it('T41a-S16: the owner revokes the second user; every way in stops, the record and the owner remain', async () => {
    const owner = await bootstrapOwner();
    const second = await enrolSecondUser(owner.token);
    const secondToken = await createPersonalToken({ label: 'second user script', scope: 'full', userId: second.userId });
    await registerSubscription(OWNER_ENDPOINT, null, owner.userId);
    await registerSubscription(SECOND_ENDPOINT, null, second.userId);

    // A proposal the second user decided, so there is acting-user history to keep.
    await db.query(
      `INSERT INTO agent_proposals (id, kind, subject_id, proposed, observed, expires_at)
       VALUES ('revokefixtureproposal01', 'categorize_transaction', 1, '{}', '{}', NOW() + INTERVAL '1 day')`
    );
    const secondSession = await resolveSession(second.token);
    expect((await decideProposal({
      id: 'revokefixtureproposal01',
      decision: 'rejected',
      decidedBy: { tokenHash: secondSession!.tokenHash, userId: second.userId },
      now: new Date(),
    })).ok).toBe(true);

    // ─── Refused, with nothing changed ─────────────────────────────────────────────────────────
    const before = await snapshot();
    const bySecond = await revokeRequest(second.userId, second.token);
    expect(bySecond.status).toBe(403);
    expect((await bySecond.json()).error.code).toBe('OWNER_ONLY');
    // The second user cannot remove the owner either.
    expect((await revokeRequest(owner.userId, second.token)).status).toBe(403);
    const ownerSelf = await revokeRequest(owner.userId, owner.token);
    expect(ownerSelf.status).toBeGreaterThanOrEqual(400);
    expect(ownerSelf.status).toBeLessThan(500);
    expect((await revokeRequest(999999, owner.token)).status).toBe(404);
    expect((await revokeRequest('not-a-number', owner.token)).status).toBe(400);
    expect(await snapshot()).toEqual(before);

    // ─── The removal ───────────────────────────────────────────────────────────────────────────
    const response = await revokeRequest(second.userId, owner.token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: null });

    // Every way in has stopped: the browser session, the personal token, the passkey's login.
    expect(await resolveSession(second.token)).toBeNull();
    expect(await resolveSession(secondToken.token)).toBeNull();
    const assertion = await signIn(second.authenticator);
    expect(assertion.status).toBe(400);
    expect(assertion.headers.getSetCookie()).toEqual([]);
    // Their phone receives nothing.
    expect(await targetsOf(() => sendWebPush('normal', second.userId))).toEqual([]);

    // THE RECORD REMAINS: the users row exists, marked removed, and the decision still names them.
    const row = await db.query<{ revoked_at: Date | null }>('SELECT revoked_at FROM users WHERE id = $1', [second.userId]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].revoked_at).not.toBeNull();
    const decided = await db.query<{ decided_by_user_id: number | null }>(
      "SELECT decided_by_user_id FROM agent_proposals WHERE id = 'revokefixtureproposal01'"
    );
    expect(String(decided.rows[0].decided_by_user_id)).toBe(String(second.userId));

    // NO NEW PASSKEY FOR A REMOVED USER, even through the enrolment function itself. No route can
    // reach this today (a removed user's session no longer resolves), so it is asserted at the
    // function: the authenticated branch re-reads the user inside its own transaction, which is what
    // covers a removal that commits between the session lookup and the INSERT. Fabricated bytes.
    const lateDeviceId = randomBytes(32).toString('base64url');
    const late = await enrolCredential({
      credential: { credentialId: lateDeviceId, publicKey: randomBytes(77), signCount: 0, transports: null },
      path: { via: 'authenticated', userId: second.userId },
    });
    expect(late).toEqual({ enrolled: false, refusal: 'REGISTRATION_CLOSED' });
    expect((await db.query('SELECT 1 FROM webauthn_credentials WHERE credential_id = $1', [lateDeviceId])).rowCount).toBe(0);
    expect((await db.query('SELECT 1 FROM webauthn_credentials WHERE user_id = $1', [second.userId])).rowCount).toBe(0);

    // THE OWNER IS UNTOUCHED: session, credential and subscription.
    expect(String((await resolveSession(owner.token))?.userId)).toBe(String(owner.userId));
    expect((await db.query('SELECT 1 FROM webauthn_credentials WHERE credential_id = $1', [owner.authenticator.credentialId])).rowCount).toBe(1);
    expect(await targetsOf(() => sendWebPush('normal'))).toEqual([OWNER_ENDPOINT]);
    expect((await signIn(owner.authenticator)).status).toBe(200);
  });
});
