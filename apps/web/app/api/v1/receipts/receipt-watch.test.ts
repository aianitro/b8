// Receipt watch (`/api/v1/receipts`, `lib/receiptCaptureStore.ts`) against a real Postgres: a photo
// becomes a draft, a confirmed draft waits, and the watch links the charge — matched when exact,
// an alert when it differs, an alert when nothing comes. Scenario R1 in the gift surface registry.
//
// TIER 2, under `vitest.integration.config.mts` with the scratch-database guard in `setupFiles`.
// The model is not called: `readReceipt` is mocked, so the reading is whatever each test says.
//
// Uses the gift suite's world (`giftTestKit.ts`) for two signed-in people. EVERY ROW IS FABRICATED,
// on a `zq41b` account the kit's cleanup removes, and every figure here is made up.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { EMPTY_READING } from '@/lib/receiptReader';
import type { ReceiptReading } from '@/lib/domain/receiptMatch';

let nextReading: ReceiptReading = EMPTY_READING;
vi.mock('@/lib/receiptReader', async (orig) => ({
  ...(await orig<typeof import('@/lib/receiptReader')>()),
  readReceipt: vi.fn(async () => nextReading),
}));

import { GET as list, POST as create } from './route';
import { PATCH, DELETE } from './[id]/route';
import { GET as image } from './[id]/image/route';
import { GET as candidates } from './[id]/candidates/route';
import { watchReceipts } from '@/lib/receiptCaptureStore';
import { buildWorld, cookie, MANUAL, ORIGIN, pgDay, seedGift, teardownWorld, type EnrolledUser, type World } from '../gifts/giftTestKit';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
let world: World;
let today: string;

const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const headers = (who: EnrolledUser, type = 'application/json') => ({ host: 'localhost:3000', 'content-type': type, ...cookie(who.token) });

async function snap(who: EnrolledUser, on: string, body: Uint8Array<ArrayBuffer> = JPEG) {
  const r = await create(new NextRequest(`${ORIGIN}/api/v1/receipts?on=${on}`, { method: 'POST', headers: headers(who, 'image/jpeg'), body }));
  return { status: r.status, body: await r.json() };
}

async function act(who: EnrolledUser, id: number, body: Record<string, unknown>) {
  const r = await PATCH(new NextRequest(`${ORIGIN}/api/v1/receipts/${id}`, { method: 'PATCH', headers: headers(who), body: JSON.stringify(body) }), params(id));
  return { status: r.status, body: await r.json() };
}

/** A posted charge on the hand-kept account. Positive is money out. */
async function charge(amount: string, date: string, name: string): Promise<number> {
  const r = await db.query<{ id: number }>(
    `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name)
     VALUES ('zq41b_rw_' || gen_random_uuid(), $1, $2::date, $3, $4) RETURNING id`,
    [MANUAL, date, amount, name]
  );
  return r.rows[0].id;
}

async function capture(id: number) {
  const r = await db.query<{ state: string; transaction_id: number | null; charged_amount: string | null; rejected_ids: number[] }>(
    'SELECT state, transaction_id, charged_amount::text, rejected_ids FROM receipt_captures WHERE id = $1', [id]);
  return r.rows[0];
}

const hasPhoto = async (txId: number) =>
  (await db.query('SELECT 1 FROM transaction_receipts WHERE transaction_id = $1', [txId])).rowCount === 1;

/** A confirmed capture by `who`, waiting for `expected` from `merchant` on `on`. */
async function waiting(who: EnrolledUser, on: string, expected: number, merchant = 'Oak Street Bistro') {
  const { body } = await snap(who, on);
  const id = body.data.capture.id as number;
  const confirmed = await act(who, id, { action: 'confirm', merchant, expected, capturedOn: on });
  return { id, confirmed };
}

beforeEach(async () => {
  world = await buildWorld();
  today = await pgDay(0);
  nextReading = EMPTY_READING;
});

afterAll(teardownWorld);

describe('taking the photo', () => {
  it('stores a draft with what was read, and proposes the total', async () => {
    nextReading = { merchant: 'Oak Street Bistro', subtotal: 40, tax: 4, tip: 8, total: 52 };
    const { status, body } = await snap(world.owner, today);
    expect(status).toBe(200);
    expect(body.data.proposed).toBe(52);
    expect(body.data.capture).toMatchObject({ state: 'draft', merchant: 'Oak Street Bistro', readTotal: 52, expected: null });
  });

  it('stores a draft with nothing read when the model reads nothing', async () => {
    const { body } = await snap(world.owner, today);
    expect(body.data).toMatchObject({ proposed: null, capture: { state: 'draft', merchant: null } });
  });

  it('refuses a body that is not an image and a day that is not real', async () => {
    expect((await snap(world.owner, today, new TextEncoder().encode('<html>'))).status).toBe(400);
    expect((await snap(world.owner, '2026-02-30')).status).toBe(400);
  });

  it('does not watch a draft', async () => {
    const { body } = await snap(world.owner, today);
    await charge('52.00', today, 'OAK STREET BISTRO');
    await watchReceipts();
    expect((await capture(body.data.capture.id)).state).toBe('draft');
  });
});

describe('the watch', () => {
  it('links an exact charge already posted when the owner confirms, and puts the photo on it', async () => {
    const tx = await charge('52.00', today, 'TST* UNRELATED TEXT');
    const { confirmed } = await waiting(world.owner, today, 52);
    expect(confirmed.body.data).toMatchObject({ state: 'matched', charged: 52, transaction: { id: tx } });
    expect(await hasPhoto(tx)).toBe(true);
  });

  it('links a charge that posts later, at the next watch', async () => {
    const { id } = await waiting(world.owner, today, 52);
    expect((await capture(id)).state).toBe('waiting');
    const tx = await charge('52.00', today, 'OAK STREET BIST');
    expect((await watchReceipts()).matched).toBe(1);
    expect(await capture(id)).toMatchObject({ state: 'matched', transaction_id: tx });
  });

  it('raises a mismatch for the merchant\'s charge at a different amount, without attaching the photo', async () => {
    const tx = await charge('60.00', today, 'TST* OAK STREET BIST');
    const { id } = await waiting(world.owner, today, 52);
    expect(await capture(id)).toMatchObject({ state: 'mismatch', transaction_id: tx, charged_amount: '60.00' });
    expect(await hasPhoto(tx)).toBe(false);
  });

  it('accepting a mismatch closes it and attaches the photo', async () => {
    const tx = await charge('60.00', today, 'OAK STREET BIST');
    const { id } = await waiting(world.owner, today, 52);
    expect((await act(world.owner, id, { action: 'accept' })).body.data.state).toBe('closed');
    expect(await hasPhoto(tx)).toBe(true);
  });

  it('rejecting a mismatch unlinks it and never offers that charge again', async () => {
    const tx = await charge('60.00', today, 'OAK STREET BIST');
    const { id } = await waiting(world.owner, today, 52);
    expect((await act(world.owner, id, { action: 'reject' })).body.data.state).toBe('waiting');
    await watchReceipts();
    expect(await capture(id)).toMatchObject({ state: 'waiting', transaction_id: null, rejected_ids: [tx] });
  });

  it('claims nothing for a charge from another merchant at another amount', async () => {
    await charge('60.00', today, 'GAS STATION');
    const { id } = await waiting(world.owner, today, 52);
    expect((await capture(id)).state).toBe('waiting');
  });

  it('marks a receipt overdue after seven days with no charge, and dismissing closes it', async () => {
    const { id } = await waiting(world.owner, await pgDay(-8), 52);
    expect((await capture(id)).state).toBe('overdue');
    expect((await act(world.owner, id, { action: 'dismiss' })).body.data.state).toBe('closed');
  });

  it('leaves a receipt waiting on its seventh day', async () => {
    const { id } = await waiting(world.owner, await pgDay(-7), 52);
    expect((await capture(id)).state).toBe('waiting');
  });

  it('does not replace a receipt the owner attached by hand', async () => {
    const tx = await charge('52.00', today, 'OAK STREET BIST');
    await db.query(`INSERT INTO transaction_receipts (transaction_id, content_type, image) VALUES ($1, 'image/png', $2)`,
      [tx, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]);
    await waiting(world.owner, today, 52);
    const r = await db.query<{ content_type: string }>('SELECT content_type FROM transaction_receipts WHERE transaction_id = $1', [tx]);
    expect(r.rows[0].content_type).toBe('image/png');
  });

  it('never gives one charge to two receipts', async () => {
    const tx = await charge('52.00', today, 'OAK STREET BIST');
    const a = await waiting(world.owner, today, 52);
    const b = await waiting(world.owner, today, 52);
    expect((await capture(a.id)).transaction_id).toBe(tx);
    expect(await capture(b.id)).toMatchObject({ state: 'waiting', transaction_id: null });
  });
});

describe('picking the charge by hand', () => {
  it('lists nearby charges, and a picked exact one is matched', async () => {
    // Neither shares a word with the receipt nor is the exact amount, so the watch leaves both alone.
    const tx = await charge('52.00', today, 'SOMETHING ELSE');
    const other = await charge('52.00', today, 'ANOTHER PLACE');
    const { id } = await waiting(world.owner, today, 52.5);
    expect((await capture(id)).state).toBe('waiting');
    const listed = await candidates(new NextRequest(`${ORIGIN}/api/v1/receipts/${id}/candidates`, { headers: headers(world.owner) }), params(id));
    expect((await listed.json()).data.map((c: { id: number }) => c.id)).toEqual(expect.arrayContaining([tx, other]));
    const linked = await act(world.owner, id, { action: 'link', transactionId: tx });
    expect(linked.body.data).toMatchObject({ state: 'mismatch', charged: 52 });
  });
});

describe('a capture is its photographer\'s alone', () => {
  it('is invisible to the other person, who cannot act on it', async () => {
    const { id } = await waiting(world.owner, today, 52);
    const theirs = await list(new NextRequest(`${ORIGIN}/api/v1/receipts`, { headers: headers(world.two) }));
    expect((await theirs.json()).data).toEqual([]);
    expect((await act(world.two, id, { action: 'dismiss' })).status).toBe(404);
    expect((await image(new NextRequest(`${ORIGIN}/api/v1/receipts/${id}/image`, { headers: headers(world.two) }), params(id))).status).toBe(404);
    const del = await DELETE(new NextRequest(`${ORIGIN}/api/v1/receipts/${id}`, { method: 'DELETE', headers: headers(world.two) }), params(id));
    expect(del.status).toBe(404);
    expect((await capture(id)).state).toBe('waiting');
  });

  it('serves its photo to the photographer', async () => {
    const { id } = await waiting(world.owner, today, 52);
    const r = await image(new NextRequest(`${ORIGIN}/api/v1/receipts/${id}/image`, { headers: headers(world.owner) }), params(id));
    expect(r.status).toBe(200);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(JPEG);
  });
});

describe('a gift held for the photographer', () => {
  it('is never linked, offered or pickable, even at the exact amount', async () => {
    const tx = await charge('52.00', today, 'OAK STREET BIST');
    const gift = await seedGift({ giver: world.two.userId, recipient: world.owner.userId, amount: '52.00', windowStart: today, windowEnd: today });
    await db.query('INSERT INTO gift_transactions (transaction_id, gift_id, prior_rule_applied) VALUES ($1, $2, false)', [tx, gift]);

    const { id } = await waiting(world.owner, today, 52);
    expect(await capture(id)).toMatchObject({ state: 'waiting', transaction_id: null });
    const listed = await candidates(new NextRequest(`${ORIGIN}/api/v1/receipts/${id}/candidates`, { headers: headers(world.owner) }), params(id));
    expect((await listed.json()).data.map((c: { id: number }) => c.id)).not.toContain(tx);
    expect((await act(world.owner, id, { action: 'link', transactionId: tx })).status).toBe(409);
    expect(await hasPhoto(tx)).toBe(false);
  });
});
