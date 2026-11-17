// `/api/v1/transactions/[id]/receipt` against a real Postgres: attaching, serving and removing a
// receipt photo, and the gift lock on all three.
//
// TIER 2, under `vitest.integration.config.mts` with the scratch-database guard in `setupFiles`.
//
// Uses the gift suite's world (`giftTestKit.ts`): two enrolled people, so a request can be made AS
// the giver and AS the recipient. EVERY ROW IS FABRICATED and carries a `zq41b` account or id, which
// is what the kit's cleanup removes; a receipt goes with its transaction by the table's cascade.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { GET, PUT, DELETE } from './route';
import { GET as getDetail } from '../route';
import { buildWorld, cookie, MANUAL, ORIGIN, pgDay, seedGift, teardownWorld, type World } from '../../../gifts/giftTestKit';
import type { EnrolledUser } from '../../../gifts/giftTestKit';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

let world: World;
let txId: number;

function call(
  handler: typeof GET,
  id: number | string,
  who: EnrolledUser,
  init: { method?: string; body?: Uint8Array<ArrayBuffer>; type?: string } = {},
): Promise<Response> {
  return handler(
    new NextRequest(`${ORIGIN}/api/v1/transactions/${id}/receipt`, {
      method: init.method ?? 'GET',
      headers: { host: 'localhost:3000', 'content-type': init.type ?? 'image/jpeg', ...cookie(who.token) },
      body: init.body,
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
}

const put = (who: EnrolledUser, body: Uint8Array<ArrayBuffer>, id: number | string = txId, type?: string) =>
  call(PUT, id, who, { method: 'PUT', body, type });
const del = (who: EnrolledUser, id: number | string = txId) => call(DELETE, id, who, { method: 'DELETE' });
const get = (who: EnrolledUser, id: number | string = txId) => call(GET, id, who);

async function hasReceiptAs(who: EnrolledUser): Promise<boolean> {
  const response = await getDetail(
    new NextRequest(`${ORIGIN}/api/v1/transactions/${txId}`, { headers: { host: 'localhost:3000', ...cookie(who.token) } }),
    { params: Promise.resolve({ id: String(txId) }) },
  );
  return (await response.json()).data.hasReceipt;
}

async function stored(): Promise<{ content_type: string; size: number } | null> {
  const r = await db.query<{ content_type: string; size: number }>(
    'SELECT content_type, octet_length(image) AS size FROM transaction_receipts WHERE transaction_id = $1',
    [txId],
  );
  return r.rows[0] ?? null;
}

/** Puts the row under a gift from `giver` to `recipient` that is not yet revealed. */
async function holdAsGift(giver: EnrolledUser, recipient: EnrolledUser): Promise<void> {
  const day = await pgDay(-1);
  const gift = await seedGift({ giver: giver.userId, recipient: recipient.userId, amount: '4.25', windowStart: day, windowEnd: day });
  await db.query(
    'INSERT INTO gift_transactions (transaction_id, gift_id, prior_rule_applied) VALUES ($1, $2, false)',
    [txId, gift],
  );
}

beforeEach(async () => {
  world = await buildWorld();
  const r = await db.query<{ id: number }>(
    `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name)
     VALUES ('manual_zq41b_receipt', $1, CURRENT_DATE - 1, '4.25', 'Fabricated Receipt Row') RETURNING id`,
    [MANUAL],
  );
  txId = r.rows[0].id;
});

afterAll(teardownWorld);

describe('attaching a receipt', () => {
  it('stores it, serves it back byte for byte, and the detail says one is there', async () => {
    expect(await hasReceiptAs(world.owner)).toBe(false);
    expect((await put(world.owner, JPEG)).status).toBe(200);
    expect(await stored()).toEqual({ content_type: 'image/jpeg', size: JPEG.length });

    const response = await get(world.owner);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
    expect(await hasReceiptAs(world.owner)).toBe(true);
  });

  it('replaces the one already there, and the second person may attach too', async () => {
    await put(world.owner, JPEG);
    expect((await put(world.two, PNG)).status).toBe(200);
    expect(await stored()).toEqual({ content_type: 'image/png', size: PNG.length });
  });

  it('takes the type from the bytes, not from the header', async () => {
    expect((await put(world.owner, PNG, txId, 'image/jpeg')).status).toBe(200);
    expect((await stored())?.content_type).toBe('image/png');
  });

  it('refuses a body that is not an image, and stores nothing', async () => {
    const response = await put(world.owner, new TextEncoder().encode('<html><script>alert(1)</script>'));
    expect(response.status).toBe(400);
    expect(await stored()).toBeNull();
  });

  it('refuses a transaction that does not exist', async () => {
    expect((await put(world.owner, JPEG, 2_000_000_000)).status).toBe(404);
    expect((await put(world.owner, JPEG, 'abc')).status).toBe(404);
  });

  it('is removed with its transaction', async () => {
    await put(world.owner, JPEG);
    await db.query('DELETE FROM transactions WHERE id = $1', [txId]);
    expect(await stored()).toBeNull();
  });
});

describe('removing a receipt', () => {
  it('removes it, and a second remove still succeeds', async () => {
    await put(world.owner, JPEG);
    expect((await del(world.owner)).status).toBe(200);
    expect(await stored()).toBeNull();
    expect((await get(world.owner)).status).toBe(404);
    expect((await del(world.owner)).status).toBe(200);
  });
});

describe('a row a gift holds', () => {
  it('shows its receipt to the giver and to nobody else', async () => {
    await put(world.owner, JPEG);
    await holdAsGift(world.owner, world.two);

    expect((await get(world.owner)).status).toBe(200);
    expect(await hasReceiptAs(world.owner)).toBe(true);

    // The same 404 a row with no receipt answers, so the refusal says nothing either way.
    const hidden = await get(world.two);
    expect(hidden.status).toBe(404);
    expect(await hasReceiptAs(world.two)).toBe(false);
  });

  it('lets the giver attach and remove, and refuses the recipient both', async () => {
    await holdAsGift(world.owner, world.two);

    expect((await put(world.two, JPEG)).status).toBe(409);
    expect(await stored()).toBeNull();

    expect((await put(world.owner, JPEG)).status).toBe(200);
    expect((await del(world.two)).status).toBe(409);
    expect(await stored()).not.toBeNull();

    expect((await del(world.owner)).status).toBe(200);
    expect(await stored()).toBeNull();
  });
});
