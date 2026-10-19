// P7-41b — the five gift endpoints against a real Postgres: G1–G11 of plan/tasks/P7-41b-gifts/SPEC.md.
//
// TIER 2, under `vitest.integration.config.mts` and its scratch-database guard. Only Plaid and the
// Anthropic SDK are faked (`giftFakesTestKit.ts`); every person signs in through the real passkey
// ceremony, every handler and statement is the real one. Fabricated people (`Test User Two`),
// fabricated merchants and canary tokens throughout.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '@/lib/db';
import { GiftListResponseSchema, GiftResponseSchema } from '@b8/contracts/gifts';

vi.mock('@/lib/plaid', async () => (await import('./giftFakesTestKit')).plaidModule);
vi.mock('@/lib/plaidReconcile', async () => (await import('./giftFakesTestKit')).reconcileModule);
vi.mock('@/lib/plaidBalances', async () => (await import('./giftFakesTestKit')).balancesModule);

import { GET as listGifts, POST as createGift } from './route';
import { GET as getGift } from './[id]/route';
import { POST as chooseGift } from './[id]/choose/route';
import { POST as cancelGift } from './[id]/cancel/route';
import { GET as detail } from '../transactions/[id]/route';
import { revokeUser } from '@/lib/users';
import {
  CARD, GIFT_CATEGORY, MANUAL, buildWorld, giftState, holds, pgDay, read, readToken, req, rowIdOf, rowState,
  seedGift, syncAdded, teardownWorld, type World,
} from './giftTestKit';

let w: World;
afterAll(teardownWorld);

const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

async function windowDates() {
  return { windowStart: await pgDay(-3), windowEnd: await pgDay(3), revealDate: await pgDay(30) };
}

/** The body a 404 answers, minus nothing: the gift routes put no volatile field in a refusal. */
const notFoundBody = async (r: Response) => (await read(r)).text;

describe('the gift endpoints', () => {
  beforeEach(async () => { w = await buildWorld(); });

  it('T41b-G1: the owner creates a gift for Test User Two; it is stored exactly and read back by its giver in state awaiting', async () => {
    const dates = await windowDates();
    const created = await read(await createGift(req('/api/v1/gifts', w.owner, {
      method: 'POST',
      body: { amount: '48.15', merchant: '  ZQ41BCRIT  ', accountId: CARD, ...dates },
    })));
    expect(created.status).toBe(201);
    const gift = GiftResponseSchema.parse(created.body);
    if (!gift.success) throw new Error('error branch');
    expect(gift.data).toMatchObject({
      recipientUserId: w.two.userId, recipientDisplayName: 'Test User Two', amount: '48.15', merchant: 'ZQ41BCRIT',
      accountId: CARD, ...dates, state: 'awaiting', revealed: false, noticeAt: null, candidates: [],
    });
    const stored = await db.query('SELECT amount::text, merchant, window_start::text, window_end::text, reveal_date::text FROM gifts');
    expect(stored.rows).toEqual([{ amount: '48.15', merchant: 'ZQ41BCRIT', window_start: dates.windowStart, window_end: dates.windowEnd, reveal_date: dates.revealDate }]);
    const list = GiftListResponseSchema.parse((await read(await listGifts(req('/api/v1/gifts', w.owner)))).body);
    expect(list.success && list.data.map((g) => g.id)).toEqual([gift.data.id]);
    const one = GiftResponseSchema.parse((await read(await getGift(req(`/api/v1/gifts/${gift.data.id}`, w.owner), params(gift.data.id)))).body);
    expect(one.success && one.data.state).toBe('awaiting');
  });

  it('T41b-G2: to the recipient and a third user a gift does not exist: absent from the list, and every id route answers the nonexistent-id body', async () => {
    w = await buildWorld({ third: true });
    const id = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, merchant: 'ZQ41BCRIT', windowStart: await pgDay(-1), windowEnd: await pgDay(1) });
    const before = (await db.query('SELECT state FROM gifts WHERE id = $1', [id])).rows;
    for (const other of [w.two, w.three!]) {
      const list = await read(await listGifts(req('/api/v1/gifts', other)));
      expect(list.body).toEqual({ success: true, data: [] });
      expect(holds(list.text, 'ZQ41BCRIT')).toBe(false);
      const mine = await notFoundBody(await getGift(req(`/api/v1/gifts/${id}`, other), params(id)));
      const none = await notFoundBody(await getGift(req('/api/v1/gifts/99999999', other), params(99999999)));
      expect(mine).toBe(none);
      for (const [h, path] of [[chooseGift, 'choose'], [cancelGift, 'cancel']] as const) {
        const a = await h(req(`/api/v1/gifts/${id}/${path}`, other, { method: 'POST', body: { transactionId: 1 } }), params(id));
        const b = await h(req(`/api/v1/gifts/99999999/${path}`, other, { method: 'POST', body: { transactionId: 1 } }), params(99999999));
        expect(a.status).toBe(404);
        expect(await notFoundBody(a)).toBe(await notFoundBody(b));
      }
    }
    expect((await db.query('SELECT state FROM gifts WHERE id = $1', [id])).rows).toEqual(before);
    expect((await getGift(req(`/api/v1/gifts/${id}`, null), params(id))).status).toBe(401);
    expect((await listGifts(req('/api/v1/gifts', null))).status).toBe(401);
  });

  it('T41b-G3: every invalid creation is a 400 INVALID_INPUT that stores nothing and does not echo the criterion', async () => {
    const dates = await windowDates();
    const bad: Record<string, unknown>[] = [
      { ...dates }, { ...dates, merchant: 'ZQ' }, { ...dates, merchant: '   ' }, { ...dates, amount: '0' },
      { ...dates, amount: '-5.00' }, { ...dates, amount: '5.001' }, { ...dates, amount: '1e3' }, { ...dates, amount: '' },
      { ...dates, amount: 'ZQ41BCRITamount' }, { ...dates, amount: ' 5.00' }, { ...dates, merchant: 'ZQ41BCRIT', windowEnd: await pgDay(-10) },
      { ...dates, merchant: 'ZQ41BCRIT', revealDate: await pgDay(-10) }, { ...dates, merchant: 'ZQ41BCRIT', state: 'matched' },
      { ...dates, merchant: 'ZQ41BCRIT', recipientUserId: w.owner.userId },
    ];
    for (const body of bad) {
      const r = await read(await createGift(req('/api/v1/gifts', w.owner, { method: 'POST', body })));
      expect({ body, status: r.status, code: r.body.error?.code }).toEqual({ body, status: 400, code: 'INVALID_INPUT' });
      expect(holds(r.text, 'ZQ41BCRIT')).toBe(false);
    }
    expect(Number((await db.query('SELECT COUNT(*) FROM gifts')).rows[0].count)).toBe(0);
  });

  it('T41b-G4: the recipient defaults to the one other person; with nobody else it is NO_RECIPIENT, and self or a removed person is refused', async () => {
    const dates = await windowDates();
    // Remove the second user: now there is nobody to give to.
    await revokeUser(w.two.userId);
    const none = await read(await createGift(req('/api/v1/gifts', w.owner, { method: 'POST', body: { merchant: 'ZQ41BCRIT', ...dates } })));
    expect([none.status, none.body.error?.code]).toEqual([409, 'NO_RECIPIENT']);
    const removed = await read(await createGift(req('/api/v1/gifts', w.owner, { method: 'POST', body: { merchant: 'ZQ41BCRIT', recipientUserId: w.two.userId, ...dates } })));
    expect(removed.status).toBeGreaterThanOrEqual(400);
    expect(removed.status).toBeLessThan(500);
    const self = await read(await createGift(req('/api/v1/gifts', w.owner, { method: 'POST', body: { merchant: 'ZQ41BCRIT', recipientUserId: w.owner.userId, ...dates } })));
    expect(self.status).toBe(400);
    expect(Number((await db.query('SELECT COUNT(*) FROM gifts')).rows[0].count)).toBe(0);
    // With exactly one other person, the recipient is them.
    w = await buildWorld();
    const ok = await read(await createGift(req('/api/v1/gifts', w.owner, { method: 'POST', body: { merchant: 'ZQ41BCRIT', ...dates } })));
    expect(ok.status).toBe(201);
    expect((ok.body.data as { recipientUserId: number }).recipientUserId).toBe(w.two.userId);
  });

  it('T41b-G5: a read-scope token cannot create a gift, and lists only its own person\'s gifts', async () => {
    const dates = await windowDates();
    const token = await readToken(w.two);
    const refused = await createGift(req('/api/v1/gifts', { bearer: token }, { method: 'POST', body: { merchant: 'ZQ41BCRIT', ...dates } }));
    expect(refused.status).toBe(403);
    expect(Number((await db.query('SELECT COUNT(*) FROM gifts')).rows[0].count)).toBe(0);
    await seedGift({ giver: w.owner.userId, recipient: w.two.userId, merchant: 'ZQ41BOWNERS', windowStart: dates.windowStart, windowEnd: dates.windowEnd });
    const mine = await seedGift({ giver: w.two.userId, recipient: w.owner.userId, merchant: 'ZQ41BTWOS', windowStart: dates.windowStart, windowEnd: dates.windowEnd });
    const list = await read(await listGifts(req('/api/v1/gifts', { bearer: token })));
    expect((list.body.data as { id: number }[]).map((g) => g.id)).toEqual([mine]);
    expect(holds(list.text, 'ZQ41BOWNERS')).toBe(false);
  });

  it('T41b-G6: a gift may name an account the bank sync updates, and not a hand-kept one', async () => {
    const dates = await windowDates();
    const manual = await read(await createGift(req('/api/v1/gifts', w.owner, { method: 'POST', body: { merchant: 'ZQ41BCRIT', accountId: MANUAL, ...dates } })));
    expect([manual.status, manual.body.error?.code]).toEqual([400, 'INVALID_INPUT']);
    expect(Number((await db.query('SELECT COUNT(*) FROM gifts')).rows[0].count)).toBe(0);
    const linked = await read(await createGift(req('/api/v1/gifts', w.owner, { method: 'POST', body: { merchant: 'ZQ41BCRIT', accountId: CARD, ...dates } })));
    expect(linked.status).toBe(201);
  });

  it('T41b-G7: choosing one of two candidates keeps it and restores the other exactly, unmasked; a stranger id is 400, a settled gift 409, a non-giver 404', async () => {
    await db.query(`INSERT INTO category_rules (plaid_category, mapped_category) VALUES ('ZQ41BRULED_PRIMARY', 'ZQ41B Household')`);
    const day = await pgDay(0);
    const id = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, amount: '33.07', windowStart: await pgDay(-2), windowEnd: await pgDay(2) });
    const a = { canary: 'ZQ41BCANDA', amount: 33.07, date: day, plaidCategory: 'ZQ41BRULED_PRIMARY' };
    const b = { canary: 'ZQ41BCANDB', amount: 33.07, date: day };
    await syncAdded(a, b);
    const [ia, ib] = [await rowIdOf(a), await rowIdOf(b)];
    expect((await giftState(id))?.state).toBe('choose');
    const bad = await chooseGift(req(`/api/v1/gifts/${id}/choose`, w.owner, { method: 'POST', body: { transactionId: 999999 } }), params(id));
    expect(bad.status).toBe(400);
    const stranger = await chooseGift(req(`/api/v1/gifts/${id}/choose`, w.two, { method: 'POST', body: { transactionId: ia } }), params(id));
    expect(stranger.status).toBe(404);
    const ok = await read(await chooseGift(req(`/api/v1/gifts/${id}/choose`, w.owner, { method: 'POST', body: { transactionId: ib } }), params(id)));
    expect(ok.status).toBe(200);
    expect((ok.body.data as { state: string; candidates: { transactionId: number }[] })).toMatchObject({ state: 'matched', candidates: [{ transactionId: ib }] });
    expect(await rowState(ia!)).toEqual({ mapped_category: 'ZQ41B Household', rule_applied: true, gift_id: null });
    expect(await rowState(ib!)).toEqual({ mapped_category: GIFT_CATEGORY, rule_applied: false, gift_id: id });
    const recipientA = await read(await detail(req(`/api/v1/transactions/${ia}`, w.two), params(ia!)));
    expect(holds(recipientA.text, 'ZQ41BCANDA')).toBe(true);
    const recipientB = await read(await detail(req(`/api/v1/transactions/${ib}`, w.two), params(ib!)));
    expect(holds(recipientB.text, 'ZQ41BCANDB')).toBe(false);
    const again = await chooseGift(req(`/api/v1/gifts/${id}/choose`, w.owner, { method: 'POST', body: { transactionId: ib } }), params(id));
    expect(again.status).toBe(409);
  });

  it('T41b-G8: cancelling releases the row to the recipient at once; a second cancel is 409; a non-giver gets 404', async () => {
    const id = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, merchant: 'ZQ41BCANC', windowStart: await pgDay(-2), windowEnd: await pgDay(2) });
    const spec = { canary: 'ZQ41BCANC', amount: 12.15, date: await pgDay(0) };
    await syncAdded(spec);
    const rid = (await rowIdOf(spec))!;
    expect(holds((await read(await detail(req(`/api/v1/transactions/${rid}`, w.two), params(rid)))).text, 'ZQ41BCANC')).toBe(false);
    expect((await cancelGift(req(`/api/v1/gifts/${id}/cancel`, w.two, { method: 'POST' }), params(id))).status).toBe(404);
    const done = await read(await cancelGift(req(`/api/v1/gifts/${id}/cancel`, w.owner, { method: 'POST' }), params(id)));
    expect([done.status, (done.body.data as { state: string }).state]).toEqual([200, 'cancelled']);
    expect(await rowState(rid)).toEqual({ mapped_category: null, rule_applied: false, gift_id: null });
    expect(holds((await read(await detail(req(`/api/v1/transactions/${rid}`, w.two), params(rid)))).text, 'ZQ41BCANC')).toBe(true);
    expect((await cancelGift(req(`/api/v1/gifts/${id}/cancel`, w.owner, { method: 'POST' }), params(id))).status).toBe(409);
  });

  it('T41b-G9: with the second user as giver and the owner as recipient, the owner and a third user see the row masked and the giver sees it real', async () => {
    w = await buildWorld({ third: true });
    await seedGift({ giver: w.two.userId, recipient: w.owner.userId, merchant: 'ZQ41BSYMM', windowStart: await pgDay(-2), windowEnd: await pgDay(2) });
    const spec = { canary: 'ZQ41BSYMM', amount: 21.55, date: await pgDay(0) };
    await syncAdded(spec);
    const rid = (await rowIdOf(spec))!;
    const view = async (u: typeof w.owner) => (await read(await detail(req(`/api/v1/transactions/${rid}`, u), params(rid)))).text;
    expect(holds(await view(w.owner), 'ZQ41BSYMM')).toBe(false);
    expect(holds(await view(w.three!), 'ZQ41BSYMM')).toBe(false);
    expect(holds(await view(w.two), 'ZQ41BSYMM')).toBe(true);
  });

  it('T41b-G10: with no gift category designated, creation is GIFT_CATEGORY_UNSET and stores nothing', async () => {
    await db.query('UPDATE gift_settings SET category_id = NULL');
    const r = await read(await createGift(req('/api/v1/gifts', w.owner, { method: 'POST', body: { merchant: 'ZQ41BCRIT', ...(await windowDates()) } })));
    expect([r.status, r.body.error?.code]).toEqual([409, 'GIFT_CATEGORY_UNSET']);
    expect(Number((await db.query('SELECT COUNT(*) FROM gifts')).rows[0].count)).toBe(0);
  });

  it('T41b-G11: the reveal boundary is Postgres\'s inclusive CURRENT_DATE — yesterday and today revealed, tomorrow masked — and the giver always sees it', async () => {
    const rows: { reveal: string; canary: string; masked: boolean }[] = [
      { reveal: 'CURRENT_DATE - 1', canary: 'ZQ41BREVA', masked: false },
      { reveal: 'CURRENT_DATE', canary: 'ZQ41BREVB', masked: false },
      { reveal: 'CURRENT_DATE + 1', canary: 'ZQ41BREVC', masked: true },
    ];
    for (const r of rows) {
      const spec = { canary: r.canary, amount: 5.35, date: await pgDay(-5) };
      await syncAdded(spec);
      const rid = (await rowIdOf(spec))!;
      // The gift, its reveal date computed in the same statement that writes it, and its link.
      const g = await db.query<{ id: number }>(
        `INSERT INTO gifts (giver_user_id, recipient_user_id, merchant, window_start, window_end, reveal_date, state)
         VALUES ($1, $2, $3, CURRENT_DATE - 10, CURRENT_DATE - 10, ${r.reveal}, 'matched') RETURNING id`,
        [w.owner.userId, w.two.userId, r.canary],
      );
      await db.query('INSERT INTO gift_transactions (transaction_id, gift_id, prior_mapped_category, prior_rule_applied) VALUES ($1, $2, NULL, FALSE)', [rid, g.rows[0].id]);
      const recipient = (await read(await detail(req(`/api/v1/transactions/${rid}`, w.two), params(rid)))).text;
      const giver = (await read(await detail(req(`/api/v1/transactions/${rid}`, w.owner), params(rid)))).text;
      expect({ reveal: r.reveal, masked: !holds(recipient, r.canary) }).toEqual({ reveal: r.reveal, masked: r.masked });
      expect(holds(giver, r.canary)).toBe(true);
    }
  });
});
