// P7-41a against a scratch database: a web push for one user reaches only that user's devices.
// Scenario S13 of plan/tasks/P7-41a-second-user/SPEC.md.
//
// WHY THIS NEEDS REAL KEYS AND A STUBBED FETCH. `sendWebPush` returns 0 before it picks a single
// recipient when the machine has no VAPID keys, so a fixture without keys would assert isolation
// over a send that never chose anybody. The keys are generated in-process (`installFabricatedVapid`)
// and `fetch` is replaced by a recorder that answers 201, so every assertion below is about which
// URLs the real send path actually chose. No network is touched; every endpoint is under
// `push.example.invalid`, which cannot resolve.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '@/lib/db';
import { sendWebPush } from '@/lib/webPush';
import { POST as registerPush } from './route';
import { POST as pushStatus } from './status/route';
import {
  bootstrapOwner,
  cookie,
  enrolSecondUser,
  installFabricatedVapid,
  recordingFetch,
  request,
  resetAuth,
} from '../../auth/secondUserTestKit';

const OWNER_ENDPOINT = 'https://push.example.invalid/owner-phone';
const SECOND_ENDPOINT = 'https://push.example.invalid/second-user-phone';
const SECOND_REVOKED_ENDPOINT = 'https://push.example.invalid/second-user-old-tablet';

async function registerAs(token: string, endpoint: string) {
  return registerPush(request('/api/v1/push/web', { method: 'POST', headers: cookie(token), body: { endpoint } }));
}

async function statusAs(token: string, endpoint: string) {
  const response = await pushStatus(request('/api/v1/push/web/status', { method: 'POST', headers: cookie(token), body: { endpoint } }));
  return (await response.json()).data as { registered: boolean; revoked: boolean };
}

/** Run one send with a fresh recorder and return the URLs it targeted, sorted. */
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

describe('P7-41a: push isolation between the two users', () => {
  it('T41a-S13: a push for one user reaches only that user\'s live subscriptions, and re-registration moves an endpoint', async () => {
    const owner = await bootstrapOwner();
    const second = await enrolSecondUser(owner.token);

    // Each registers a distinct endpoint under their own session; the second user also has a
    // subscription that has since been revoked.
    expect((await registerAs(owner.token, OWNER_ENDPOINT)).status).toBe(200);
    expect((await registerAs(second.token, SECOND_ENDPOINT)).status).toBe(200);
    expect((await registerAs(second.token, SECOND_REVOKED_ENDPOINT)).status).toBe(200);
    await db.query('UPDATE web_push_subscriptions SET revoked_at = NOW() WHERE endpoint = $1', [SECOND_REVOKED_ENDPOINT]);

    // The rows carry the registering session's user.
    const rows = await db.query<{ endpoint: string; user_id: number }>(
      'SELECT endpoint, user_id FROM web_push_subscriptions ORDER BY endpoint'
    );
    expect(rows.rows.map((r) => [r.endpoint, String(r.user_id)])).toEqual([
      [OWNER_ENDPOINT, String(owner.userId)],
      [SECOND_REVOKED_ENDPOINT, String(second.userId)],
      [SECOND_ENDPOINT, String(second.userId)],
    ]);

    // FOR THE SECOND USER: exactly their live endpoint — not the owner's, not the revoked one.
    expect(await targetsOf(() => sendWebPush('normal', second.userId))).toEqual([SECOND_ENDPOINT]);
    // NO USER NAMED MEANS THE OWNER, never everyone.
    expect(await targetsOf(() => sendWebPush('normal'))).toEqual([OWNER_ENDPOINT]);
    expect(await targetsOf(() => sendWebPush('normal', owner.userId))).toEqual([OWNER_ENDPOINT]);

    // STATUS IS PER USER: the owner's endpoint, asked about by the second user, is not registered
    // for them — and the reverse.
    expect(await statusAs(second.token, OWNER_ENDPOINT)).toEqual({ registered: false, revoked: false });
    expect(await statusAs(owner.token, SECOND_ENDPOINT)).toEqual({ registered: false, revoked: false });
    expect(await statusAs(owner.token, OWNER_ENDPOINT)).toEqual({ registered: true, revoked: false });

    // RE-REGISTRATION MOVES THE ROW. The second user's session registers the owner's endpoint (the
    // same device, now theirs): it leaves the owner's sends and joins the second user's.
    expect((await registerAs(second.token, OWNER_ENDPOINT)).status).toBe(200);
    const moved = await db.query<{ user_id: number }>('SELECT user_id FROM web_push_subscriptions WHERE endpoint = $1', [OWNER_ENDPOINT]);
    expect(moved.rows).toHaveLength(1);
    expect(String(moved.rows[0].user_id)).toBe(String(second.userId));
    expect(await targetsOf(() => sendWebPush('normal'))).toEqual([]);
    expect(await targetsOf(() => sendWebPush('normal', second.userId))).toEqual([OWNER_ENDPOINT, SECOND_ENDPOINT].sort());
    expect(await statusAs(owner.token, OWNER_ENDPOINT)).toEqual({ registered: false, revoked: false });
    expect(await statusAs(second.token, OWNER_ENDPOINT)).toEqual({ registered: true, revoked: false });
  });
});
