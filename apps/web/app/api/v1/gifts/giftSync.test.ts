// P7-41b — matching inside the Plaid sync, and what survives it: S1–S14 of SPEC.md.
//
// TIER 2. Plaid and the Anthropic SDK are faked (`giftFakesTestKit.ts`); the sync, its transaction,
// the matcher and every statement are real, against the scratch database. The chat route's rate
// limiter is also replaced, in this file only: S2 calls the chat once per sync statement, which is
// the harness's doing, not a user's, and a limiter refusing the harness would hide the readers.
//
// Canary tokens (`ZQ41B…`) stand in every text field; nothing is a real name, merchant or figure.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import db from '@/lib/db';

vi.mock('@/lib/plaid', async () => (await import('./giftFakesTestKit')).plaidModule);
vi.mock('@/lib/plaidReconcile', async () => (await import('./giftFakesTestKit')).reconcileModule);
vi.mock('@/lib/plaidBalances', async () => (await import('./giftFakesTestKit')).balancesModule);
vi.mock('@anthropic-ai/sdk', async () => (await import('./giftFakesTestKit')).anthropicModule);
vi.mock('@/lib/rateLimit', () => ({ createLimiter: () => ({}), check: () => ({ allowed: true }) }));

import { GET as detail } from '../transactions/[id]/route';
import { GET as drill } from '../transactions/route';
import { POST as createManual } from '../transactions/route';
import { POST as importCsv } from '../import/csv/route';
import { POST as chat } from '../chat/route';
import { POST as postRule } from '../rules/route';
import { POST as applyRules } from '../rules/apply/route';
import { GET as listGifts } from './route';
import { POST as chooseGift } from './[id]/choose/route';
import { loadOverview } from '@/lib/overviewRead';
import { runGiftSweep } from '@/lib/giftStore';
import { defaultDeps, runRekey } from '../../../../scripts/rekey-plaid-ids';
import { anthropicFake, GIFT_ITEM_TOKEN } from './giftFakesTestKit';
import { installFabricatedVapid } from '../auth/secondUserTestKit';
import {
  CARD, CARD_TWO, GIFT_CATEGORY, OTHER_CATEGORY, buildWorld, designate, giftState, holds, page, pgDay, plaidIdOf,
  plaidTxn, read, req, rowIdOf, rowState, seedGift, syncAdded, syncWith, teardownWorld, type RowSpec, type World,
} from './giftTestKit';

let w: World;
afterAll(teardownWorld);

const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

async function detailText(user: World['owner'], rowId: number) {
  return (await read(await detail(req(`/api/v1/transactions/${rowId}`, user), params(rowId)))).text;
}

/** A gift for the recipient, matching on the canary as its merchant criterion. */
async function giftFor(canary: string, extra: Partial<Parameters<typeof seedGift>[0]> = {}) {
  return seedGift({
    giver: w.owner.userId, recipient: w.two.userId, merchant: canary,
    windowStart: await pgDay(-3), windowEnd: await pgDay(3), ...extra,
  });
}

async function today(): Promise<string> { return pgDay(0); }

describe('matching in the sync', () => {
  beforeEach(async () => {
    w = await buildWorld();
    anthropicFake.requests.length = 0;
  });

  it('T41b-S1: a qualifying outflow delivered as added, and one delivered as a first-time modified, is linked, filed, masked for the recipient, real for the giver, and matches the gift', async () => {
    for (const via of ['added', 'modified'] as const) {
      const canary = via === 'added' ? 'ZQ41BSONEA' : 'ZQ41BSONEM';
      const id = await giftFor(canary);
      const spec: RowSpec = { canary, amount: 48.15, date: await today() };
      await syncWith(page({ [via]: [plaidTxn(spec)] }));
      const rid = (await rowIdOf(spec))!;
      expect(await rowState(rid)).toEqual({ mapped_category: GIFT_CATEGORY, rule_applied: false, gift_id: id });
      expect((await giftState(id))?.state).toBe('matched');
      expect(holds(await detailText(w.two, rid), canary)).toBe(false);
      expect(holds(await detailText(w.owner, rid), canary)).toBe(true);
    }
  });

  it('T41b-S2: no recipient read made after any statement of the sync sees the canary — for an added arrival, a first-time modified arrival, and a reissue whose replacement defeats re-identification; a control run without a gift does see it', async () => {
    process.env.ANTHROPIC_API_KEY = 'zq41b-fake-key';
    const month = Number((await today()).slice(5, 7));
    const original = { query: db.query, connect: db.connect };
    let inHook = false;
    let statements = 0;
    let hooks = 0;
    let sawCanary = false;
    let canary = '';

    /** Every reader the recipient has, as the recipient, right now. */
    async function recipientReads(): Promise<string> {
      const parts: string[] = [];
      parts.push(JSON.stringify(await loadOverview(w.two.userId)));
      const ids = await db.query<{ id: number }>(`SELECT id FROM transactions WHERE account_id LIKE 'zq41b%'`);
      for (const { id } of ids.rows) parts.push((await read(await detail(req(`/api/v1/transactions/${id}`, w.two), params(id)))).text);
      for (const cat of [GIFT_CATEGORY, OTHER_CATEGORY]) {
        parts.push((await read(await drill(req(`/api/v1/transactions?category=${encodeURIComponent(cat)}&month=${month}`, w.two)))).text);
      }
      // The chat's row tools, as the model would call them.
      anthropicFake.script = (_r, n) => n % 2 === 1
        ? { content: [{ type: 'tool_use', id: 't1', name: 'get_transactions', input: { limit: 100 } },
                      { type: 'tool_use', id: 't2', name: 'get_top_merchants', input: { limit: 50 } }],
            stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } }
        : { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
      const before = anthropicFake.requests.length;
      parts.push((await read(await chat(req('/api/v1/chat', w.two, { method: 'POST', body: { messages: [{ role: 'user', content: 'list' }] } })))).text);
      parts.push(JSON.stringify(anthropicFake.requests.slice(before)));
      return parts.join('\n');
    }

    async function hook() {
      if (inHook) return;
      inHook = true;
      try {
        hooks++;
        if (holds(await recipientReads(), canary)) sawCanary = true;
      } finally {
        inHook = false;
      }
    }

    const wrapQuery = <T extends { query: typeof db.query }>(target: T, fn: (...a: never[]) => unknown) =>
      (async (...args: never[]) => {
        const result = await fn.apply(target, args);
        if (!inHook) { statements++; await hook(); }
        return result;
      }) as unknown as typeof db.query;

    db.query = wrapQuery(db, original.query as never);
    db.connect = (async () => {
      const client = await original.connect.call(db) as PoolClient;
      const q = client.query;
      client.query = wrapQuery(client as never, q as never) as never;
      const release = client.release;
      client.release = ((e?: unknown) => { client.query = q; return release.call(client, e as never); }) as never;
      return client;
    }) as typeof db.connect;

    const run = async (label: string, withGift: boolean, deliver: () => Promise<unknown>) => {
      statements = 0; hooks = 0; sawCanary = false;
      await deliver();
      return { label, withGift, statements, hooks, sawCanary };
    };

    try {
      const results = [];
      // Added.
      canary = 'ZQ41BORDA';
      inHook = true;
      await giftFor(canary);
      const dayA = await today();
      inHook = false;
      results.push(await run('added', true, () => syncWith(page({ added: [plaidTxn({ canary, amount: 17.35, date: dayA })] }))));
      // First-time modified.
      canary = 'ZQ41BORDM';
      inHook = true; await giftFor(canary); inHook = false;
      results.push(await run('modified', true, () => syncWith(page({ modified: [plaidTxn({ canary, amount: 17.55, date: dayA })] }))));
      // Reissue: the matched row is retired and its replacement, renamed so the same-key match
      // cannot pair them, arrives in the same walk.
      canary = 'ZQ41BORDR';
      inHook = true;
      const reissued = await giftFor(canary);
      await syncWith(page({ added: [plaidTxn({ canary, amount: 17.57, date: dayA, id: 'zq41b-ordr-old' })] }));
      expect((await giftState(reissued))?.state).toBe('matched');
      inHook = false;
      results.push(await run('reissue', true, () => syncWith(page({
        added: [plaidTxn({ canary, amount: 17.57, date: dayA, id: 'zq41b-ordr-new', name: `${canary} RENAMED BY BANK` })],
        removed: [{ transaction_id: 'zq41b-ordr-old' }],
      }))));
      inHook = true;
      expect((await giftState(reissued))?.state).toBe('matched');
      expect(await rowIdOf('zq41b-ordr-old')).toBeNull();
      inHook = false;
      // Control: the same delivery with no gift is visible to the same readers.
      canary = 'ZQ41BORDC';
      results.push(await run('control', false, () => syncWith(page({ added: [plaidTxn({ canary, amount: 17.07, date: dayA })] }))));

      for (const r of results) {
        expect(r.statements).toBeGreaterThan(5);
        expect(r.hooks).toBe(r.statements);
        expect({ label: r.label, sawCanary: r.sawCanary }).toEqual({ label: r.label, sawCanary: !r.withGift });
      }
    } finally {
      db.query = original.query;
      db.connect = original.connect;
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('T41b-S3: two qualifying rows in one pass are both held, filed and masked, neither picked; a later arrival joins them; choosing restores the losers', async () => {
    const id = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, amount: '19.35', windowStart: await pgDay(-3), windowEnd: await pgDay(3) });
    const a = { canary: 'ZQ41BCHOA', amount: 19.35, date: await today() };
    const b = { canary: 'ZQ41BCHOB', amount: 19.35, date: await today() };
    await syncAdded(a, b);
    const [ia, ib] = [(await rowIdOf(a))!, (await rowIdOf(b))!];
    expect((await giftState(id))?.state).toBe('choose');
    for (const [rid, c] of [[ia, a.canary], [ib, b.canary]] as const) {
      expect(await rowState(rid)).toEqual({ mapped_category: GIFT_CATEGORY, rule_applied: false, gift_id: id });
      expect(holds(await detailText(w.two, rid), c)).toBe(false);
    }
    const c3 = { canary: 'ZQ41BCHOC', amount: 19.35, date: await today() };
    await syncAdded(c3);
    const ic = (await rowIdOf(c3))!;
    expect(await rowState(ic)).toEqual({ mapped_category: GIFT_CATEGORY, rule_applied: false, gift_id: id });
    expect((await giftState(id))?.state).toBe('choose');
    const r = await chooseGift(req(`/api/v1/gifts/${id}/choose`, w.owner, { method: 'POST', body: { transactionId: ib } }), params(id));
    expect(r.status).toBe(200);
    for (const [rid, c] of [[ia, a.canary], [ic, c3.canary]] as const) {
      expect(await rowState(rid)).toEqual({ mapped_category: null, rule_applied: false, gift_id: null });
      expect(holds(await detailText(w.two, rid), c)).toBe(true);
    }
  });

  it('T41b-S4: with no qualifying row nothing changes: ordinary rows keep their rule category and real text, the gift stays awaiting and untold', async () => {
    await db.query(`INSERT INTO category_rules (plaid_category, mapped_category) VALUES ('ZQ41BPLAIN_PRIMARY', $1)`, [OTHER_CATEGORY]);
    const id = await giftFor('ZQ41BNEVERSEEN');
    const spec = { canary: 'ZQ41BPLAIN', amount: 9.15, date: await today(), plaidCategory: 'ZQ41BPLAIN_PRIMARY' };
    await syncAdded(spec);
    const rid = (await rowIdOf(spec))!;
    expect(await rowState(rid)).toEqual({ mapped_category: OTHER_CATEGORY, rule_applied: true, gift_id: null });
    expect(holds(await detailText(w.two, rid), 'ZQ41BPLAIN')).toBe(true);
    expect(await giftState(id)).toEqual({ state: 'awaiting', notice_at: null });
  });

  it('T41b-S5: refunds, a cent off, a day outside, another account, another merchant, pending, a conflict-refresh, CSV and manual rows all stay ordinary and visible', async () => {
    const day = await today();
    // Stored before the gift exists: its later `modified` is a refresh, not an insert.
    const refresh = { canary: 'ZQ41BSFIVE', amount: 25.55, date: day, id: 'zq41b-s5-refresh' };
    await syncAdded(refresh);
    const id = await seedGift({
      giver: w.owner.userId, recipient: w.two.userId, amount: '25.55', merchant: 'ZQ41BSFIVE', account: CARD,
      windowStart: await pgDay(-1), windowEnd: await pgDay(1),
    });
    const shapes: RowSpec[] = [
      { canary: 'ZQ41BSFIVE', id: 'zq41b-s5-refund', amount: -25.55, date: day },
      { canary: 'ZQ41BSFIVE', id: 'zq41b-s5-up', amount: 25.56, date: day },
      { canary: 'ZQ41BSFIVE', id: 'zq41b-s5-down', amount: 25.54, date: day },
      { canary: 'ZQ41BSFIVE', id: 'zq41b-s5-before', amount: 25.55, date: await pgDay(-2) },
      { canary: 'ZQ41BSFIVE', id: 'zq41b-s5-after', amount: 25.55, date: await pgDay(2) },
      { canary: 'ZQ41BSFIVE', id: 'zq41b-s5-acct', amount: 25.55, date: day, account: CARD_TWO },
      { canary: 'ZQ41BOTHER', id: 'zq41b-s5-merchant', amount: 25.55, date: day },
      { canary: 'ZQ41BSFIVE', id: 'zq41b-s5-pending', amount: 25.55, date: day, pending: true },
      // A refund against a merchant-only gift: no amount criterion to reject it, so only the
      // money-out rule can.
      { canary: 'ZQ41BREFUND', id: 'zq41b-s5-refund-any', amount: -9.15, date: day },
    ];
    const refundGift = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, merchant: 'ZQ41BREFUND', windowStart: await pgDay(-1), windowEnd: await pgDay(1) });
    await syncWith(page({ added: shapes.map(plaidTxn), modified: [plaidTxn({ ...refresh, name: 'ZQ41BSFIVE REVISED' })] }));
    const csv = await importCsv(req('/api/v1/import/csv', w.owner, { method: 'POST', body: { accountId: CARD, rows: [{ date: day, description: 'ZQ41BSFIVE CSV', amount: 25.55 }] } }));
    expect(csv.status).toBeLessThan(300);
    const manual = await read(await createManual(req('/api/v1/transactions', w.owner, { method: 'POST', body: { account_id: CARD, date: day, amount: 25.55, name: 'ZQ41BSFIVE MANUAL', merchant_name: 'ZQ41BSFIVE' } })));
    expect(manual.status).toBe(201);
    await syncWith(page({}));
    const linked = await db.query(`SELECT COUNT(*)::int AS n FROM gift_transactions`);
    expect(linked.rows[0].n).toBe(0);
    expect((await giftState(id))?.state).toBe('awaiting');
    expect((await giftState(refundGift))?.state).toBe('awaiting');
    const rows = await db.query<{ id: number; plaid_transaction_id: string; mapped_category: string | null }>(
      `SELECT id, plaid_transaction_id, mapped_category FROM transactions WHERE account_id LIKE 'zq41b%'`);
    expect(rows.rows.length).toBe(shapes.length - 1 + 1 + 2);
    for (const r of rows.rows) {
      expect({ id: r.plaid_transaction_id, cat: r.mapped_category }).toEqual({ id: r.plaid_transaction_id, cat: null });
      const text = await detailText(w.two, r.id);
      expect({ id: r.plaid_transaction_id, visible: holds(text, 'ZQ41BSFIVE') || holds(text, 'ZQ41BOTHER') || holds(text, 'ZQ41BREFUND') }).toEqual({ id: r.plaid_transaction_id, visible: true });
    }
  });

  it('T41b-S6: a matched gift is final, and when two gifts want one row the older wins and the younger keeps waiting', async () => {
    const id = await giftFor('ZQ41BFINAL');
    await syncAdded({ canary: 'ZQ41BFINAL', id: 'zq41b-final-1', amount: 3.35, date: await today() });
    await syncAdded({ canary: 'ZQ41BFINAL', id: 'zq41b-final-2', amount: 3.35, date: await today() });
    expect((await giftState(id))?.state).toBe('matched');
    expect((await rowState((await rowIdOf('zq41b-final-2'))!))?.gift_id).toBeNull();
    const older = await giftFor('ZQ41BRIVAL', { createdAt: '2026-01-01T00:00:00Z' });
    const younger = await giftFor('ZQ41BRIVAL');
    await syncAdded({ canary: 'ZQ41BRIVAL', amount: 4.15, date: await today() });
    expect((await giftState(older))?.state).toBe('matched');
    expect((await giftState(younger))?.state).toBe('awaiting');
  });

  it('T41b-S7: rules at sync, a later modified, POST /rules and POST /rules/apply never re-file or unmask a held row, and their counts leave it out; an ordinary row under the same rule is re-filed', async () => {
    await db.query(`INSERT INTO category_rules (plaid_category, mapped_category) VALUES ('ZQ41BRULES_PRIMARY', $1)`, [OTHER_CATEGORY]);
    await db.query(`INSERT INTO category_rules (merchant_name, mapped_category) VALUES ('ZQ41BRULES Merchant', $1)`, [OTHER_CATEGORY]);
    const id = await giftFor('ZQ41BRULES');
    const held = { canary: 'ZQ41BRULES', amount: 7.07, date: await today(), plaidCategory: 'ZQ41BRULES_PRIMARY' };
    await syncAdded(held);
    const rid = (await rowIdOf(held))!;
    // The rule DID file it at insert, and that is what the link recorded as its prior state.
    const prior = await db.query('SELECT prior_mapped_category, prior_rule_applied FROM gift_transactions WHERE transaction_id = $1', [rid]);
    expect(prior.rows[0]).toEqual({ prior_mapped_category: OTHER_CATEGORY, prior_rule_applied: true });
    expect(await rowState(rid)).toEqual({ mapped_category: GIFT_CATEGORY, rule_applied: false, gift_id: id });
    // A later modified.
    await syncWith(page({ modified: [plaidTxn({ ...held, name: 'ZQ41BRULES LATER' })] }));
    expect(await rowState(rid)).toEqual({ mapped_category: GIFT_CATEGORY, rule_applied: false, gift_id: id });
    // An ordinary row, set back to unfiled so the rule has work: the control.
    const plainId = await db.query<{ id: number }>(
      `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, plaid_category, mapped_category)
       VALUES ('zq41b-rules-plain', $1, CURRENT_DATE, 1.15, 'ZQ41BPLAINRULE', 'ZQ41BRULES_PRIMARY', NULL) RETURNING id`, [CARD]);
    const byCategory = await read(await postRule(req('/api/v1/rules', w.two, { method: 'POST', body: { plaid_category: 'ZQ41BRULES_PRIMARY', mapped_category: OTHER_CATEGORY } })));
    expect(byCategory.body.data).toEqual({ refiled: 1 });
    expect((await rowState(plainId.rows[0].id))?.mapped_category).toBe(OTHER_CATEGORY);
    const applied = await read(await applyRules());
    expect(applied.body.data).toEqual({ updated: expect.any(Number) });
    expect(await rowState(rid)).toEqual({ mapped_category: GIFT_CATEGORY, rule_applied: false, gift_id: id });
    // As the recipient, a merchant rule for the gift's merchant answers what a rule for an unseen merchant answers.
    const forGift = await read(await postRule(req('/api/v1/rules', w.two, { method: 'POST', body: { merchant_name: 'ZQ41BRULES Merchant', mapped_category: OTHER_CATEGORY } })));
    const forNobody = await read(await postRule(req('/api/v1/rules', w.two, { method: 'POST', body: { merchant_name: 'ZQ41BNOBODY Merchant', mapped_category: OTHER_CATEGORY } })));
    expect(forGift.text).toBe(forNobody.text);
    expect(holds(await detailText(w.two, rid), 'ZQ41BRULES')).toBe(false);
  });

  it('T41b-S8: a modified delivery that changes the name, merchant and enrichment keeps the link, the category and the mask; the giver sees the new text', async () => {
    const id = await giftFor('ZQ41BMODIF');
    const spec = { canary: 'ZQ41BMODIF', amount: 8.55, date: await today() };
    await syncAdded(spec);
    const rid = (await rowIdOf(spec))!;
    await syncWith(page({ modified: [plaidTxn({ ...spec, canary: 'ZQ41BMODIFNEW', id: plaidIdOf(spec), merchant: 'ZQ41BMODIF Newer Merchant' })] }));
    expect(await rowState(rid)).toEqual({ mapped_category: GIFT_CATEGORY, rule_applied: false, gift_id: id });
    expect(holds(await detailText(w.owner, rid), 'ZQ41BMODIFNEW')).toBe(true);
    const recipient = await detailText(w.two, rid);
    expect(holds(recipient, 'ZQ41BMODIF')).toBe(false);
  });

  it('T41b-S9: a re-auth re-identification keeps the held row whole; a removal with no replacement deletes it and returns the gift to awaiting with no error', async () => {
    const id = await giftFor('ZQ41BREID');
    const spec = { canary: 'ZQ41BREID', amount: 6.35, date: await today(), id: 'zq41b-reid-old' };
    await syncAdded(spec);
    const rid = (await rowIdOf(spec))!;
    // Re-auth: no cursor, the same transaction under a new Item's id.
    await db.query(`UPDATE accounts SET cursor = NULL WHERE id LIKE 'zq41b%'`);
    await syncWith(page({ added: [plaidTxn({ ...spec, id: 'zq41b-reid-new' })] }));
    expect(await rowIdOf('zq41b-reid-new')).toBe(rid);
    expect(await rowIdOf('zq41b-reid-old')).toBeNull();
    expect(await rowState(rid)).toEqual({ mapped_category: GIFT_CATEGORY, rule_applied: false, gift_id: id });
    expect(Number((await db.query(`SELECT COUNT(*) FROM transactions WHERE account_id LIKE 'zq41b%'`)).rows[0].count)).toBe(1);
    expect(holds(await detailText(w.two, rid), 'ZQ41BREID')).toBe(false);
    // Removed with no replacement.
    const result = await syncWith(page({ removed: [{ transaction_id: 'zq41b-reid-new' }] }));
    expect(result.errors).toEqual([]);
    expect(await rowIdOf('zq41b-reid-new')).toBeNull();
    expect((await giftState(id))?.state).toBe('awaiting');
    expect(Number((await db.query('SELECT COUNT(*) FROM gift_transactions')).rows[0].count)).toBe(0);
    expect((await detail(req(`/api/v1/transactions/${rid}`, w.two), params(rid))).status).toBe(404);
  });

  it('T41b-S10: the re-key script rewrites a held row\'s Plaid id and leaves its id, link, category and mask alone; an ordinary row is re-keyed too', async () => {
    const id = await giftFor('ZQ41BREKEY');
    const held = { canary: 'ZQ41BREKEY', amount: 5.15, date: await today(), id: 'zq41b-rekey-old' };
    const plain = { canary: 'ZQ41BRKPLAIN', amount: 5.07, date: await today(), id: 'zq41b-rkplain-old' };
    await syncAdded(held, plain);
    const [hid, pid] = [(await rowIdOf(held))!, (await rowIdOf(plain))!];
    const backupDir = mkdtempSync(join(tmpdir(), 'zq41b-rekey-'));
    try {
      const summary = await runRekey({ apply: true, backupDir }, {
        ...defaultDeps,
        out: () => undefined,
        err: () => undefined,
        fetchPage: async (token: string) => ({
          added: token === GIFT_ITEM_TOKEN ? [plaidTxn({ ...held, id: 'zq41b-rekey-new' }), plaidTxn({ ...plain, id: 'zq41b-rkplain-new' })] : [],
          modified: [], removed: [], next_cursor: 'zq41b-rekey-end', has_more: false,
        }) as never,
      });
      expect(summary.backup?.rows).toBeGreaterThanOrEqual(2);
    } finally {
      rmSync(backupDir, { recursive: true, force: true });
    }
    expect(await rowIdOf('zq41b-rekey-new')).toBe(hid);
    expect(await rowIdOf('zq41b-rkplain-new')).toBe(pid);
    expect(await rowState(hid)).toEqual({ mapped_category: GIFT_CATEGORY, rule_applied: false, gift_id: id });
    expect(holds(await detailText(w.two, hid), 'ZQ41BREKEY')).toBe(false);
  });

  // G3 cycle 1, N2. Not a numbered scenario: the acceptance checker counts T41b ids exactly once.
  it('a revealed matched gift whose row is later deleted stays matched through the next sync and sweep, with no notice', async () => {
    const day = await today();
    const x = { canary: 'ZQ41BN2GONE', amount: 3.07, date: await pgDay(-30) };
    await syncAdded(x);
    const rid = (await rowIdOf(x))!;
    const g = (await db.query<{ id: number }>(
      `INSERT INTO gifts (giver_user_id, recipient_user_id, merchant, window_start, window_end, reveal_date, state)
       VALUES ($1, $2, 'ZQ41BN2GONE', CURRENT_DATE - 31, CURRENT_DATE - 30, CURRENT_DATE - 1, 'matched') RETURNING id`,
      [w.owner.userId, w.two.userId])).rows[0].id;
    await db.query(
      'INSERT INTO gift_transactions (transaction_id, gift_id, prior_mapped_category, prior_rule_applied) VALUES ($1, $2, NULL, FALSE)',
      [rid, g]);
    // Deleting a revealed gift's row is allowed; the link cascades away with it.
    await db.query('DELETE FROM transactions WHERE id = $1', [rid]);
    await syncAdded({ canary: 'ZQ41BN2FRESH', amount: 2.07, date: day });
    await runGiftSweep();
    expect(await giftState(g)).toEqual({ state: 'matched', notice_at: null });
  });

  it('T41b-S11: the same added payload delivered again after a cursor reset changes nothing', async () => {
    const id = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, amount: '2.55', windowStart: await pgDay(-3), windowEnd: await pgDay(3) });
    const specs = [{ canary: 'ZQ41BREDA', amount: 2.55, date: await today() }, { canary: 'ZQ41BREDB', amount: 2.55, date: await today() }];
    await syncAdded(...specs);
    const snapshot = async () => (await db.query(`
      SELECT t.plaid_transaction_id, t.mapped_category, t.rule_applied, gt.gift_id, g.state
        FROM transactions t LEFT JOIN gift_transactions gt ON gt.transaction_id = t.id LEFT JOIN gifts g ON g.id = gt.gift_id
       WHERE t.account_id LIKE 'zq41b%' ORDER BY t.plaid_transaction_id`)).rows;
    const before = await snapshot();
    expect((await giftState(id))?.state).toBe('choose');
    await db.query(`UPDATE accounts SET cursor = NULL WHERE id LIKE 'zq41b%'`);
    await syncAdded(...specs);
    expect(await snapshot()).toEqual(before);
  });

  it('T41b-S15: a one-day window holds a row bought that day and posted the next, masked for the recipient; a row with neither date inside stays ordinary', async () => {
    const day = await today();
    const next = await pgDay(1);
    const held = await giftFor('ZQ41BAUTHA', { windowStart: day, windowEnd: day });
    const missed = await giftFor('ZQ41BAUTHN', { windowStart: day, windowEnd: day });
    const bought: RowSpec = { canary: 'ZQ41BAUTHA', amount: 31.4, date: next, authorizedDate: day };
    const noAuth: RowSpec = { canary: 'ZQ41BAUTHN', id: 'zq41b-s13-noauth', amount: 31.4, date: next, authorizedDate: null };
    const before: RowSpec = { canary: 'ZQ41BAUTHN', id: 'zq41b-s13-before', amount: 31.4, date: next, authorizedDate: await pgDay(-1) };
    await syncWith(page({ added: [bought, noAuth, before].map(plaidTxn) }));

    const rid = (await rowIdOf(bought))!;
    expect(await rowState(rid)).toEqual({ mapped_category: GIFT_CATEGORY, rule_applied: false, gift_id: held });
    expect((await giftState(held))?.state).toBe('matched');
    expect(holds(await detailText(w.two, rid), 'ZQ41BAUTHA')).toBe(false);
    expect(holds(await detailText(w.owner, rid), 'ZQ41BAUTHA')).toBe(true);

    expect((await giftState(missed))?.state).toBe('awaiting');
    for (const spec of [noAuth, before]) {
      const id = (await rowIdOf(spec))!;
      expect({ id: spec.id, state: await rowState(id) }).toEqual({ id: spec.id, state: { mapped_category: null, rule_applied: false, gift_id: null } });
      expect(holds(await detailText(w.two, id), 'ZQ41BAUTHN')).toBe(true);
    }
  });
});

describe('the daily sweep', () => {
  beforeEach(async () => { w = await buildWorld(); });

  /** Push endpoints for both people, VAPID keys, and a fetch that records each request whole. */
  async function pushHarness() {
    installFabricatedVapid();
    await db.query(
      `INSERT INTO web_push_subscriptions (endpoint, user_id) VALUES
         ('https://push.example.invalid/zq41b-owner', $1), ('https://push.example.invalid/zq41b-two', $2)`,
      [w.owner.userId, w.two.userId],
    );
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    return { calls, restore: () => { globalThis.fetch = real; } };
  }

  it('T41b-S12: the window-end notice waits out five days, then tells the giver once — in-app and by an empty push to the giver\'s devices only — and never a matched gift', async () => {
    const push = await pushHarness();
    try {
      const due = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, merchant: 'ZQ41BLATE', windowStart: await pgDay(-12), windowEnd: await pgDay(-5) });
      const matched = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, merchant: 'ZQ41BDONE', windowStart: await pgDay(-12), windowEnd: await pgDay(-6) });
      await db.query(`UPDATE gifts SET state = 'matched' WHERE id = $1`, [matched]);
      await runGiftSweep();
      expect((await giftState(due))?.notice_at).toBeNull();
      expect(push.calls).toEqual([]);
      // One day later: window end plus six.
      await db.query(`UPDATE gifts SET window_end = window_end - 1, window_start = window_start - 1 WHERE id = $1`, [due]);
      await runGiftSweep();
      const told = await giftState(due);
      expect(told?.notice_at).not.toBeNull();
      expect(told?.state).toBe('unmatched');
      expect((await giftState(matched))?.notice_at).toBeNull();
      expect(push.calls.map((c) => c.url)).toEqual(['https://push.example.invalid/zq41b-owner']);
      for (const c of push.calls) expect(c.init && 'body' in c.init ? c.init.body : undefined).toBeUndefined();
      const giverList = await read(await listGifts(req('/api/v1/gifts', w.owner)));
      expect((giverList.body.data as { id: number; noticeAt: string | null }[]).find((g) => g.id === due)?.noticeAt).not.toBeNull();
      expect((await read(await listGifts(req('/api/v1/gifts', w.two)))).body.data).toEqual([]);
      await runGiftSweep();
      expect(push.calls).toHaveLength(1);
      expect((await giftState(due))?.notice_at).toBe(told?.notice_at);
    } finally {
      push.restore();
    }
  });

  it('T41b-S13: a gift still choosing on its reveal date is expired by the sweep: candidates restored exactly and unmasked, the giver told once', async () => {
    const push = await pushHarness();
    try {
      const id = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, amount: '6.07', windowStart: await pgDay(-3), windowEnd: await pgDay(3), revealSql: 'CURRENT_DATE + 1' });
      const a = { canary: 'ZQ41BEXPA', amount: 6.07, date: await today() };
      const b = { canary: 'ZQ41BEXPB', amount: 6.07, date: await today() };
      await syncAdded(a, b);
      expect((await giftState(id))?.state).toBe('choose');
      await runGiftSweep();
      expect((await giftState(id))?.state).toBe('choose');
      await db.query('UPDATE gifts SET reveal_date = CURRENT_DATE WHERE id = $1', [id]);
      await runGiftSweep();
      expect((await giftState(id))?.state).toBe('unmatched');
      for (const s of [a, b]) {
        const rid = (await rowIdOf(s))!;
        expect(await rowState(rid)).toEqual({ mapped_category: null, rule_applied: false, gift_id: null });
        expect(holds(await detailText(w.two, rid), s.canary)).toBe(true);
      }
      expect(push.calls.map((c) => c.url)).toEqual(['https://push.example.invalid/zq41b-owner']);
      await runGiftSweep();
      expect(push.calls).toHaveLength(1);
    } finally {
      push.restore();
    }
  });
});

describe('the gift category is held by identity', () => {
  beforeEach(async () => { w = await buildWorld(); });

  it('T41b-S14: after a rename a match is filed under the new name; with the category deleted a match is still linked and masked, left in its category, and the sync logs only a count', async () => {
    await db.query(`UPDATE budget_categories SET name = 'ZQ41B Renamed Shelf' WHERE id = $1`, [w.categoryId]);
    const renamed = await giftFor('ZQ41BRENAME');
    await syncAdded({ canary: 'ZQ41BRENAME', amount: 1.57, date: await today() });
    const r1 = (await rowIdOf({ canary: 'ZQ41BRENAME', amount: 0, date: '' }))!;
    expect(await rowState(r1)).toEqual({ mapped_category: 'ZQ41B Renamed Shelf', rule_applied: false, gift_id: renamed });

    await db.query('DELETE FROM budget_categories WHERE id = $1', [w.categoryId]);
    const lines: string[] = [];
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); }));
    let orphaned: number;
    try {
      orphaned = await giftFor('ZQ41BORPHAN');
      await syncAdded({ canary: 'ZQ41BORPHAN', amount: 1.55, date: await today() });
    } finally {
      for (const s of spies) s.mockRestore();
    }
    const r2 = (await rowIdOf({ canary: 'ZQ41BORPHAN', amount: 0, date: '' }))!;
    expect(await rowState(r2)).toEqual({ mapped_category: null, rule_applied: false, gift_id: orphaned! });
    expect(holds(await detailText(w.two, r2), 'ZQ41BORPHAN')).toBe(false);
    const countLine = lines.find((l) => l.includes('gift category not designated'));
    expect(countLine).toBeDefined();
    expect(countLine).toContain('"count":1');
    for (const l of lines) expect(holds(l, 'ZQ41BORPHAN')).toBe(false);
    await designate(null);
  });
});
