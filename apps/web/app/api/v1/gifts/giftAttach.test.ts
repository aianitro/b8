// P7-41c — attaching a row already in the ledger, against a real Postgres: C1–C13 of
// plan/tasks/P7-41c-gift-attach/SPEC.md, one `it` each, titled by id.
//
// TIER 2, under `vitest.integration.config.mts` and its scratch-database guard. Faked as in the
// P7-41b suites and nothing else: Plaid, the Anthropic SDK and the rate limiter
// (`giftFakesTestKit.ts`), and the page viewer, which exists only inside a Next render. Every
// handler, store function and statement is the real one, and every person signed in through the
// real passkey ceremony (`giftTestKit.ts`).
//
// Canary tokens (`ZQ41C…`) stand in every text field of every fabricated row, so a leak is found by
// substring whatever field carried it. Nothing here is a real name, merchant or figure. Rows sit on
// the kit's `zq41b` accounts, so the kit's cleanup removes them; the transfer groups this file
// creates are removed by this file.
//
// THE RACES (C9, C10) ARE DETERMINISTIC. A second client holds a lock in an open transaction, and the
// test polls `pg_stat_activity` until the attach's backend is waiting on that holder before letting
// it go — so a sub-case cannot pass because the attach happened to run first. What was observed is
// printed once per sub-case, for the evidence bundle.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import db from '@/lib/db';
import {
  GiftCandidateListResponseSchema,
  GiftResponseSchema,
  type GiftCandidate,
} from '@b8/contracts/gifts';

const rec = vi.hoisted(() => ({ viewer: null as number | null }));

vi.mock('@/lib/plaid', async () => (await import('./giftFakesTestKit')).plaidModule);
vi.mock('@/lib/plaidReconcile', async () => (await import('./giftFakesTestKit')).reconcileModule);
vi.mock('@/lib/plaidBalances', async () => (await import('./giftFakesTestKit')).balancesModule);
vi.mock('@anthropic-ai/sdk', async () => (await import('./giftFakesTestKit')).anthropicModule);
vi.mock('@/lib/rateLimit', () => ({ createLimiter: () => ({}), check: () => ({ allowed: true }) }));
// The two pages C13 renders resolve their viewer from Next's request headers, which exist only
// inside a render; the test sets the viewer here and calls the page components directly.
vi.mock('@/lib/giftViewer', async (original) => ({
  ...(await original<typeof import('@/lib/giftViewer')>()),
  pageViewer: async () => rec.viewer,
}));

import { GET as giftCandidates } from './[id]/candidates/route';
import { POST as giftAttach } from './[id]/attach/route';
import { POST as chooseGift } from './[id]/choose/route';
import { POST as cancelGift } from './[id]/cancel/route';
import { GET as getGift } from './[id]/route';
import { GET as listGifts } from './route';
import { GET as overview } from '../overview/route';
import { GET as drill } from '../transactions/route';
import { DELETE as deleteTxn, GET as detail, PATCH as patchTxn } from '../transactions/[id]/route';
import { GET as counterparts } from '../transactions/[id]/counterparts/route';
import { POST as postRule } from '../rules/route';
import { POST as applyRules } from '../rules/apply/route';
import RulesPage from '../../../rules/page';
import TransactionsPage from '../../../transactions/page';
import { loadOverview } from '@/lib/overviewRead';
import { runGiftSweep } from '@/lib/giftStore';
import { cents } from '@/lib/domain/giftMatch';
import { ROUTES } from '@/lib/giftSurfaceRegistry';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CARD, CARD_TWO, GIFT_CATEGORY, OTHER_CATEGORY, buildWorld, giftState, holds, pgDay, read, readToken, req,
  rowIdOf, rowState, seedGift, syncAdded, teardownWorld, type EnrolledUser, type RowSpec, type World,
} from './giftTestKit';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

type Who = EnrolledUser | { bearer: string } | null;

let w: World;
const transferGroups: number[] = [];

beforeEach(async () => { w = await buildWorld({ third: true }); });
afterEach(async () => {
  if (transferGroups.length) {
    await db.query('UPDATE transactions SET transfer_group_id = NULL WHERE transfer_group_id = ANY($1::int[])', [transferGroups]);
    await db.query('DELETE FROM transfer_groups WHERE id = ANY($1::int[])', [transferGroups]);
    transferGroups.length = 0;
  }
});
afterAll(teardownWorld);

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────────

const candidates = async (who: Who, giftId: number | string) =>
  read(await giftCandidates(req(`/api/v1/gifts/${giftId}/candidates`, who), params(giftId)));

const attach = async (who: Who, giftId: number | string, body: unknown) =>
  read(await giftAttach(req(`/api/v1/gifts/${giftId}/attach`, who, { method: 'POST', body }), params(giftId)));

const idOf = async (spec: RowSpec | string) => {
  const id = await rowIdOf(spec);
  if (id === null) throw new Error('p41c: a seeded row was not stored');
  return id;
};

/** Every column attach may not touch, plus the two it files, as text. */
async function snapshot(id: number): Promise<string> {
  const r = await db.query('SELECT * FROM transactions WHERE id = $1', [id]);
  return JSON.stringify(r.rows);
}

const linkCount = async () => Number((await db.query('SELECT COUNT(*) FROM gift_transactions')).rows[0].count);

const linksOf = async (giftId: number) =>
  (await db.query<{ transaction_id: number }>('SELECT transaction_id FROM gift_transactions WHERE gift_id = $1 ORDER BY transaction_id', [giftId]))
    .rows.map((r) => r.transaction_id);

async function detailText(who: Who, rowId: number) {
  return (await read(await detail(req(`/api/v1/transactions/${rowId}`, who), params(rowId)))).text;
}

/** Numeric and money leaves of a JSON value, by path (as T41b-X4 reads them). */
function figures(value: unknown, path = '$', out = new Map<string, unknown>()): Map<string, unknown> {
  if (typeof value === 'number' || (typeof value === 'string' && /^-?\d+\.\d{2}$/.test(value))) out.set(path, value);
  else if (Array.isArray(value)) value.forEach((v, i) => figures(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) figures(v, `${path}.${k}`, out);
  return out;
}

/** A second client holding a transaction open, and its backend pid. */
async function holder(): Promise<{ client: PoolClient; pid: number }> {
  const client = await db.connect();
  await client.query('BEGIN');
  const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  return { client, pid };
}

/** End the holder's transaction if the test did not (a failed assertion), then return its client. */
async function release(h: { client: PoolClient }): Promise<void> {
  await h.client.query('ROLLBACK').catch(() => undefined);
  h.client.release();
}

/**
 * Wait until `n` backends are blocked behind `holderPid` — directly, or behind another backend that
 * is (Postgres queues a second waiter for a row behind the first, not behind the holder) — and say
 * what they were waiting on. Throws when nothing waits within the time allowed: a race sub-case
 * that never raced proves nothing.
 */
async function waitBlocked(holderPid: number, n = 1): Promise<string> {
  for (let i = 0; i < 400; i++) {
    const r = await db.query<{ pid: number; blockers: number[]; wait_event_type: string; wait_event: string; query: string }>(
      `SELECT pid, pg_blocking_pids(pid) AS blockers, wait_event_type, wait_event,
              regexp_replace(query, '\\s+', ' ', 'g') AS query
         FROM pg_stat_activity WHERE wait_event_type = 'Lock' ORDER BY pid`,
    );
    const behind = new Set<number>([holderPid]);
    for (let grew = true; grew;) {
      grew = false;
      for (const x of r.rows) {
        if (!behind.has(x.pid) && x.blockers.some((b) => behind.has(b))) { behind.add(x.pid); grew = true; }
      }
    }
    const waiting = r.rows.filter((x) => x.pid !== holderPid && behind.has(x.pid));
    if (waiting.length >= n) {
      return waiting.map((x) => `backend waiting (${x.wait_event_type}/${x.wait_event}) on: ${x.query.trim()}`).join(' | ');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('p41c: no backend ever waited on the held lock');
}

// ─── C1–C3: linking ─────────────────────────────────────────────────────────────────────────────

describe('attach links exactly as the sync does', () => {
  it('T41c-C1: attaching to an awaiting gift links, files and masks the row exactly as the sync links its twin; no surface leaks it and no total moves by viewer', async () => {
    const today = await pgDay(0);
    const month = Number(today.slice(5, 7));
    const a: RowSpec = { canary: 'ZQ41CATTA', amount: 23.07, date: today };
    const twin: RowSpec = { canary: 'ZQ41CATTB', amount: 23.07, date: await pgDay(3) };
    await syncAdded(a);
    const ra = await idOf(a);
    await db.query('UPDATE transactions SET mapped_category = $1, rule_applied = TRUE WHERE id = $2', [OTHER_CATEGORY, ra]);
    const criteria = { amount: '23.07', merchant: 'ZQ41CATT', account: CARD, windowStart: await pgDay(2), windowEnd: await pgDay(4) };
    const g1 = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, ...criteria });
    const g2 = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, ...criteria });

    const spent = async (who: EnrolledUser, category: string) => {
      const r = await read(await drill(req(`/api/v1/transactions?category=${encodeURIComponent(category)}&month=${month}`, who)));
      return (r.body.data as { spent: string }).spent;
    };
    const totals = async (who: EnrolledUser) => ({ gift: await spent(who, GIFT_CATEGORY), other: await spent(who, OTHER_CATEGORY) });
    const before = { giver: await totals(w.owner), recipient: await totals(w.two) };
    expect(before.giver).toEqual(before.recipient);

    const r = await attach(w.owner, g1, { transactionId: ra });
    expect(r.status).toBe(200);
    const parsed = GiftResponseSchema.parse(r.body);
    if (!parsed.success) throw new Error('error branch');
    expect(parsed.data.state).toBe('matched');
    expect(parsed.data.candidates.map((c) => c.transactionId)).toEqual([ra]);
    expect(holds(r.text, 'ZQ41CATTA')).toBe(true);

    const link = await db.query('SELECT gift_id, prior_mapped_category, prior_rule_applied FROM gift_transactions WHERE transaction_id = $1', [ra]);
    expect(link.rows).toEqual([{ gift_id: g1, prior_mapped_category: OTHER_CATEGORY, prior_rule_applied: true }]);
    expect(await rowState(ra)).toEqual({ mapped_category: GIFT_CATEGORY, rule_applied: false, gift_id: g1 });

    // Every text-bearing GET route in the registry, as every non-giver: no canary of the row.
    const token = await readToken(w.two);
    const probes: Record<string, (who: Who) => Promise<Response>> = {
      'app/api/v1/overview/route.ts': (who) => overview(req('/api/v1/overview', who)),
      'app/api/v1/transactions/route.ts': (who) => drill(req(`/api/v1/transactions?category=${encodeURIComponent(GIFT_CATEGORY)}&month=${month}`, who)),
      'app/api/v1/transactions/[id]/route.ts': (who) => detail(req(`/api/v1/transactions/${ra}`, who), params(ra)),
      'app/api/v1/transactions/[id]/counterparts/route.ts': (who) => counterparts(req(`/api/v1/transactions/${ra}/counterparts`, who), params(ra)),
      'app/api/v1/gifts/route.ts': (who) => listGifts(req('/api/v1/gifts', who)),
      'app/api/v1/gifts/[id]/route.ts': (who) => getGift(req(`/api/v1/gifts/${g1}`, who), params(g1)),
      'app/api/v1/gifts/[id]/candidates/route.ts': (who) => giftCandidates(req(`/api/v1/gifts/${g2}/candidates`, who), params(g2)),
    };
    const textGets: string[] = [];
    for (const route of ROUTES.filter((x) => x.classes.includes('text-bearing'))) {
      if (typeof (await import(join(WEB, route.file))).GET === 'function') textGets.push(route.file);
    }
    expect(textGets.sort()).toEqual(Object.keys(probes).sort());
    for (const [file, call] of Object.entries(probes)) {
      for (const [who, label] of [[w.two, 'recipient cookie'], [{ bearer: token }, 'recipient bearer'], [w.three!, 'third user']] as const) {
        const res = await read(await call(who));
        expect({ file, label, leaked: holds(res.text, 'ZQ41CATTA') }).toEqual({ file, label, leaked: false });
      }
    }
    // The giver sees the real label.
    expect(holds(await detailText(w.owner, ra), 'ZQ41CATTA')).toBe(true);
    expect(holds((await read(await getGift(req(`/api/v1/gifts/${g1}`, w.owner), params(g1)))).text, 'ZQ41CATTA')).toBe(true);

    // Totals: the same for both viewers, and moved by exactly the row's amount between the two categories.
    const after = { giver: await totals(w.owner), recipient: await totals(w.two) };
    expect(after.giver).toEqual(after.recipient);
    const moved = cents('23.07')!;
    expect(cents(after.giver.gift)! - cents(before.giver.gift)!).toBe(moved);
    expect(cents(before.giver.other)! - cents(after.giver.other)!).toBe(moved);
    const now = new Date();
    expect([...figures(await loadOverview(w.two.userId, now))]).toEqual([...figures(await loadOverview(w.owner.userId, now))]);

    // The twin, linked by the sync to the second gift: the same tuple.
    await syncAdded(twin);
    const rb = await idOf(twin);
    const tuple = async (row: number, gift: number) => {
      const s = await rowState(row);
      return { category: s?.mapped_category, ruleApplied: s?.rule_applied, linked: s?.gift_id === gift, state: (await giftState(gift))?.state };
    };
    expect(await tuple(ra, g1)).toEqual(await tuple(rb, g2));
    expect(await tuple(rb, g2)).toEqual({ category: GIFT_CATEGORY, ruleApplied: false, linked: true, state: 'matched' });
  });

  it('T41c-C2: a choose gift takes an attach and stays choose; choosing one restores and unmasks the other two, the attached one included', async () => {
    const c: RowSpec = { canary: 'ZQ41CCHOC', amount: 13.57, date: await pgDay(-5) };
    await syncAdded(c);
    const rc = await idOf(c);
    await db.query('UPDATE transactions SET mapped_category = $1, rule_applied = TRUE WHERE id = $2', [OTHER_CATEGORY, rc]);
    const g = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, amount: '13.57', windowStart: await pgDay(-3), windowEnd: await pgDay(3) });
    const a: RowSpec = { canary: 'ZQ41CCHOA', amount: 13.57, date: await pgDay(0) };
    const b: RowSpec = { canary: 'ZQ41CCHOB', amount: 13.57, date: await pgDay(0) };
    await syncAdded(a, b);
    const [ra, rb] = [await idOf(a), await idOf(b)];
    expect((await giftState(g))?.state).toBe('choose');
    const priorB = (await db.query('SELECT prior_mapped_category, prior_rule_applied FROM gift_transactions WHERE transaction_id = $1', [rb])).rows[0];

    const r = await attach(w.owner, g, { transactionId: rc });
    expect(r.status).toBe(200);
    const parsed = GiftResponseSchema.parse(r.body);
    if (!parsed.success) throw new Error('error branch');
    expect(parsed.data.state).toBe('choose');
    expect(parsed.data.candidates.map((x) => x.transactionId)).toEqual([ra, rb, rc].sort((x, y) => x - y));
    for (const [row, canary] of [[ra, 'ZQ41CCHOA'], [rb, 'ZQ41CCHOB'], [rc, 'ZQ41CCHOC']] as const) {
      expect({ canary, seen: holds(await detailText(w.two, row), canary) }).toEqual({ canary, seen: false });
    }

    const chosen = await read(await chooseGift(req(`/api/v1/gifts/${g}/choose`, w.owner, { method: 'POST', body: { transactionId: ra } }), params(g)));
    expect(chosen.status).toBe(200);
    expect((await giftState(g))?.state).toBe('matched');
    expect(await rowState(rc)).toEqual({ mapped_category: OTHER_CATEGORY, rule_applied: true, gift_id: null });
    expect(await rowState(rb)).toEqual({ mapped_category: priorB.prior_mapped_category, rule_applied: priorB.prior_rule_applied, gift_id: null });
    expect(holds(await detailText(w.two, rc), 'ZQ41CCHOC')).toBe(true);
    expect(holds(await detailText(w.two, rb), 'ZQ41CCHOB')).toBe(true);
    expect(holds(await detailText(w.two, ra), 'ZQ41CCHOA')).toBe(false);
  });

  it('T41c-C3: cancel after attach restores each prior shape exactly — rule-filed, uncategorised, hand-filed — and the sweep leaves a matched attached gift alone', async () => {
    const HAND = 'ZQ41B Hand Filed';
    await db.query(`INSERT INTO budget_categories (name, annual_budget, landscape) VALUES ($1, 0, 'operational')`, [HAND]);
    await db.query(`INSERT INTO category_rules (plaid_category, mapped_category) VALUES ('ZQ41CPRIORONE_PRIMARY', $1)`, [OTHER_CATEGORY]);
    const day = await pgDay(-2);
    const specs: RowSpec[] = [
      { canary: 'ZQ41CPRIORONE', amount: 3.15, date: day, plaidCategory: 'ZQ41CPRIORONE_PRIMARY' },
      { canary: 'ZQ41CPRIORTWO', amount: 3.25, date: day },
      { canary: 'ZQ41CPRIORTHREE', amount: 3.35, date: day },
      { canary: 'ZQ41CPRIORFOUR', amount: 3.45, date: day },
    ];
    await syncAdded(...specs);
    const ids = await Promise.all(specs.map(idOf));
    await db.query('UPDATE transactions SET mapped_category = NULL, rule_applied = FALSE WHERE id = $1', [ids[1]]);
    await db.query('UPDATE transactions SET mapped_category = $1, rule_applied = FALSE WHERE id = $2', [HAND, ids[2]]);
    const before = await Promise.all(ids.map(rowState));
    expect(before.slice(0, 3)).toEqual([
      { mapped_category: OTHER_CATEGORY, rule_applied: true, gift_id: null },
      { mapped_category: null, rule_applied: false, gift_id: null },
      { mapped_category: HAND, rule_applied: false, gift_id: null },
    ]);
    const window = { windowStart: await pgDay(5), windowEnd: await pgDay(6) };
    const gifts = [];
    for (const s of specs) gifts.push(await seedGift({ giver: w.owner.userId, recipient: w.two.userId, merchant: s.canary, ...window }));

    for (let i = 0; i < 4; i++) {
      const r = await attach(w.owner, gifts[i], { transactionId: ids[i] });
      expect({ i, status: r.status }).toEqual({ i, status: 200 });
      expect(await rowState(ids[i])).toEqual({ mapped_category: GIFT_CATEGORY, rule_applied: false, gift_id: gifts[i] });
    }
    for (let i = 0; i < 3; i++) {
      const r = await read(await cancelGift(req(`/api/v1/gifts/${gifts[i]}/cancel`, w.owner, { method: 'POST' }), params(gifts[i])));
      expect(r.status).toBe(200);
      expect({ i, state: await rowState(ids[i]) }).toEqual({ i, state: before[i] });
      expect(holds(await detailText(w.two, ids[i]), specs[i].canary)).toBe(true);
    }
    // Expiry applies to unresolved gifts only: a matched attached gift is untouched by the sweep.
    await runGiftSweep();
    expect((await giftState(gifts[3]))?.state).toBe('matched');
    expect(await rowState(ids[3])).toEqual({ mapped_category: GIFT_CATEGORY, rule_applied: false, gift_id: gifts[3] });
  });
});

// ─── C4–C8: the list, and what is refused ──────────────────────────────────────────────────────

describe('the candidate list and the refusals', () => {
  it('T41c-C4: the giver\'s list holds the in-horizon qualifying rows whatever the window, newest first, at most fifty, hidden included, Unnamed for a nameless row, and [] when nothing fits', async () => {
    const d = async (n: number) => pgDay(n);
    const rows: RowSpec[] = [
      { canary: 'ZQ41CLISTBEFOREA', amount: 7.07, date: await d(-6) },
      { canary: 'ZQ41CLISTBEFOREB', amount: 7.07, date: await d(-5) },
      { canary: 'ZQ41CLISTBEFOREC', amount: 7.07, date: await d(-5) },
      { canary: 'ZQ41CLISTFLOOR', amount: 7.07, date: await d(-7) },
      { canary: 'ZQ41CLISTOUT', amount: 7.07, date: await d(-8) },
      { canary: 'ZQ41CLISTAFTERA', amount: 7.07, date: await d(-1) },
      { canary: 'ZQ41CLISTAFTERB', amount: 7.07, date: await d(0) },
      { canary: 'ZQ41CLISTHIDDEN', amount: 7.07, date: await d(-2) },
      { canary: 'ZQ41CLISTNONAME', amount: 7.07, date: await d(-1), merchant: null, name: null },
      { canary: 'ZQ41CLISTMISS', amount: 7.08, date: await d(-1) },
    ];
    const cap: RowSpec[] = Array.from({ length: 55 }, (_, i) => ({
      canary: `ZQ41CCAP${String(i).padStart(2, '0')}`, amount: 8.09, date: '', id: `zq41b-zq41ccap${i}`,
    }));
    for (let i = 0; i < cap.length; i++) cap[i].date = await d(-(i % 8));
    await syncAdded(...rows, ...cap);
    const hidden = await idOf(rows[7]);
    await db.query('UPDATE transactions SET hidden = TRUE WHERE id = $1', [hidden]);
    const window = { windowStart: await d(-4), windowEnd: await d(-3), account: CARD };
    const g = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, amount: '7.07', ...window });
    const gCap = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, amount: '8.09', ...window });
    const gNone = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, amount: '7.11', ...window });

    const r = await candidates(w.owner, g);
    expect(r.status).toBe(200);
    const parsed = GiftCandidateListResponseSchema.parse(r.body);
    if (!parsed.success) throw new Error('error branch');
    const expected = await db.query<{ id: number; amount: string; plaid_transaction_id: string }>(
      `SELECT id, amount::text AS amount, plaid_transaction_id FROM transactions
        WHERE plaid_transaction_id = ANY($1::text[]) ORDER BY date DESC, id DESC`,
      [rows.filter((x) => x.canary !== 'ZQ41CLISTOUT' && x.canary !== 'ZQ41CLISTMISS').map((x) => `zq41b-${x.canary.toLowerCase()}`)],
    );
    expect(parsed.data.map((c) => c.transactionId)).toEqual(expected.rows.map((x) => x.id));
    expect(parsed.data.map((c) => c.amount)).toEqual(expected.rows.map((x) => x.amount));
    expect(parsed.data.map((c) => c.transactionId)).toContain(hidden);
    const byId = new Map(parsed.data.map((c) => [c.transactionId, c] as [number, GiftCandidate]));
    for (const spec of rows.filter((x) => !['ZQ41CLISTOUT', 'ZQ41CLISTMISS', 'ZQ41CLISTNONAME'].includes(x.canary))) {
      const c = byId.get(await idOf(spec))!;
      expect({ canary: spec.canary, labelled: holds(c.label, spec.canary) }).toEqual({ canary: spec.canary, labelled: true });
    }
    expect(byId.get(await idOf(rows[8]))?.label).toBe('Unnamed');
    expect(holds(r.text, 'ZQ41CLISTOUT')).toBe(false);
    expect(holds(r.text, 'ZQ41CLISTMISS')).toBe(false);

    // The cap: fifty rows, and the five dropped are the oldest.
    const capped = GiftCandidateListResponseSchema.parse((await candidates(w.owner, gCap)).body);
    if (!capped.success) throw new Error('error branch');
    const capOrder = await db.query<{ id: number }>(
      `SELECT id FROM transactions WHERE plaid_transaction_id LIKE 'zq41b-zq41ccap%' ORDER BY date DESC, id DESC`,
    );
    expect(capOrder.rows.length).toBe(55);
    expect(capped.data.length).toBe(50);
    expect(capped.data.map((c) => c.transactionId)).toEqual(capOrder.rows.slice(0, 50).map((x) => x.id));

    // Nothing fits: an empty array, not null.
    const none = await candidates(w.owner, gNone);
    expect(none.status).toBe(200);
    expect(none.body).toEqual({ success: true, data: [] });
  });

  it('T41c-C5: no linked, hand-entered, imported, refund, zero, transfer, near-miss, other-merchant, other-account or before-floor row is listed or attachable; a qualifying control is both', async () => {
    const today = await pgDay(0);
    const specs: Record<string, RowSpec> = {
      linkedOther: { canary: 'ZQ41CNEGLO', amount: 6.15, date: today },
      linkedRevealed: { canary: 'ZQ41CNEGLR', amount: 6.15, date: today },
      linkedSibling: { canary: 'ZQ41CNEGLS', amount: 6.15, date: today },
      transfer: { canary: 'ZQ41CNEGTG', amount: 6.15, date: today },
      refund: { canary: 'ZQ41CNEGRF', amount: -6.15, date: today },
      zero: { canary: 'ZQ41CNEGZR', amount: 0, date: today },
      centUp: { canary: 'ZQ41CNEGUP', amount: 6.16, date: today },
      centDown: { canary: 'ZQ41CNEGDN', amount: 6.14, date: today },
      otherMerchant: { canary: 'ZQ41CDIFFM', amount: 6.15, date: today },
      otherAccount: { canary: 'ZQ41CNEGAC', amount: 6.15, date: today, account: CARD_TWO },
      beforeFloor: { canary: 'ZQ41CNEGBF', amount: 6.15, date: await pgDay(-8) },
    };
    const control: RowSpec = { canary: 'ZQ41CNEGOK', amount: 6.15, date: await pgDay(-1) };
    // For a gift with no amount criterion, where only the money-out guard can refuse them (G3 cycle 1,
    // N2): the amount-criterion gift above refuses a refund and a zero row on the amount first.
    const moneyOut = {
      zero: { canary: 'ZQ41CMONZERO', amount: 0, date: today },
      refund: { canary: 'ZQ41CMONREFUND', amount: -6.15, date: today },
      control: { canary: 'ZQ41CMONOK', amount: 6.15, date: today },
    } satisfies Record<string, RowSpec>;
    await syncAdded(...Object.values(specs), control, ...Object.values(moneyOut));
    const ids: Record<string, number> = {};
    for (const [k, s] of Object.entries(specs)) ids[k] = await idOf(s);
    for (const [k, pid] of [['manual', 'manual_zq41cnegmn'], ['csv', 'csv_zq41cnegcv']] as const) {
      const c = k === 'manual' ? 'ZQ41CNEGMN' : 'ZQ41CNEGCV';
      ids[k] = (await db.query<{ id: number }>(
        `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, merchant_name)
         VALUES ($1, $2, CURRENT_DATE, 6.15, $3, $4) RETURNING id`, [pid, CARD, `${c} POS NAME`, `${c} Merchant`])).rows[0].id;
    }
    const canaryOf: Record<string, string> = { ...Object.fromEntries(Object.entries(specs).map(([k, s]) => [k, s.canary])), manual: 'ZQ41CNEGMN', csv: 'ZQ41CNEGCV' };

    const g = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, amount: '6.15', merchant: 'ZQ41CNEG', account: CARD, windowStart: await pgDay(3), windowEnd: await pgDay(4) });
    const link = async (gift: number, row: number) => {
      await db.query(`INSERT INTO gift_transactions (transaction_id, gift_id, prior_mapped_category, prior_rule_applied) VALUES ($1, $2, NULL, FALSE)`, [row, gift]);
      await db.query(`UPDATE gifts SET state = 'matched' WHERE id = $1`, [gift]);
    };
    await link(await seedGift({ giver: w.two.userId, recipient: w.owner.userId, merchant: 'ZQ41CNEGLO', windowStart: today, windowEnd: today }), ids.linkedOther);
    await link(await seedGift({ giver: w.owner.userId, recipient: w.two.userId, merchant: 'ZQ41CNEGLR', windowStart: await pgDay(-5), windowEnd: await pgDay(-5), revealSql: 'CURRENT_DATE - 1' }), ids.linkedRevealed);
    await link(await seedGift({ giver: w.owner.userId, recipient: w.two.userId, merchant: 'ZQ41CNEGLS', windowStart: today, windowEnd: today }), ids.linkedSibling);
    const group = (await db.query<{ id: number }>('INSERT INTO transfer_groups DEFAULT VALUES RETURNING id')).rows[0].id;
    transferGroups.push(group);
    await db.query('UPDATE transactions SET transfer_group_id = $1 WHERE id = $2', [group, ids.transfer]);

    const list = await candidates(w.owner, g);
    expect(list.status).toBe(200);
    const parsed = GiftCandidateListResponseSchema.parse(list.body);
    if (!parsed.success) throw new Error('error branch');
    const rc = await idOf(control);
    expect(parsed.data.map((c) => c.transactionId)).toEqual([rc]);
    for (const [k, c] of Object.entries(canaryOf)) {
      expect({ k, listed: holds(list.text, c) }).toEqual({ k, listed: false });
    }

    const links = await linkCount();
    const before: Record<string, string> = {};
    for (const [k, id] of Object.entries(ids)) before[k] = await snapshot(id);
    let fixed = '';
    for (const [k, id] of Object.entries(ids)) {
      const r = await attach(w.owner, g, { transactionId: id });
      fixed = r.text;
      expect({ k, status: r.status, code: r.body.error?.code }).toEqual({ k, status: 400, code: 'INVALID_INPUT' });
      expect({ k, unchanged: (await snapshot(id)) === before[k] }).toEqual({ k, unchanged: true });
    }
    expect(await linkCount()).toBe(links);
    expect((await giftState(g))?.state).toBe('awaiting');

    const ok = await attach(w.owner, g, { transactionId: rc });
    expect(ok.status).toBe(200);
    expect(await linksOf(g)).toEqual([rc]);

    // Merchant only, no amount: the zero row and the refund carry the merchant, so nothing but the
    // money-out guard stands between them and the gift. Neither is listed; each gets the fixed 400.
    const byMerchant = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, merchant: 'ZQ41CMON', account: CARD, windowStart: await pgDay(3), windowEnd: await pgDay(4) });
    const mon = { zero: await idOf(moneyOut.zero), refund: await idOf(moneyOut.refund), control: await idOf(moneyOut.control) };
    const monList = await candidates(w.owner, byMerchant);
    const monParsed = GiftCandidateListResponseSchema.parse(monList.body);
    if (!monParsed.success) throw new Error('error branch');
    expect(monParsed.data.map((c) => c.transactionId)).toEqual([mon.control]);
    expect(holds(monList.text, 'ZQ41CMONZERO')).toBe(false);
    expect(holds(monList.text, 'ZQ41CMONREFUND')).toBe(false);
    for (const k of ['zero', 'refund'] as const) {
      const linksBefore = await linkCount();
      const snap = await snapshot(mon[k]);
      const r = await attach(w.owner, byMerchant, { transactionId: mon[k] });
      expect({ k, status: r.status, code: r.body.error?.code, same: r.text === fixed }).toEqual({ k, status: 400, code: 'INVALID_INPUT', same: true });
      expect(await linkCount()).toBe(linksBefore);
      expect(await snapshot(mon[k])).toBe(snap);
    }
    expect((await attach(w.owner, byMerchant, { transactionId: mon.control })).status).toBe(200);
  });

  it('T41c-C6: to the recipient, a third user, a read token of theirs, and for unknown or malformed ids, both routes answer one byte-identical 404 whatever the body; unauthenticated is 401; the giver\'s read token reads but cannot attach', async () => {
    const g = await seedGift({ giver: w.two.userId, recipient: w.owner.userId, merchant: 'ZQ41CSEEN', windowStart: await pgDay(2), windowEnd: await pgDay(3) });
    const ownerToken = await readToken(w.owner);
    const callers: [string, Who, string | number][] = [
      ['recipient cookie', w.owner, g],
      ['recipient bearer', { bearer: ownerToken }, g],
      ['third user', w.three!, g],
      ['unknown id', w.owner, 999999999],
      ['malformed id', w.owner, 'zq41c'],
    ];
    // A read-scope token may not write anything, so its POST is the boundary's 403 before any gift
    // is looked up (SPEC.md S30) — the same 403 for a real gift and an unknown id, so it says
    // nothing about existence either. Every other answer is the one 404.
    const answers = async () => {
      const out: string[] = [];
      const scope: string[] = [];
      for (const [label, who, id] of callers) {
        for (const [kind, call] of [
          ['candidates', () => candidates(who, id)],
          ['attach valid', () => attach(who, id, { transactionId: 1 })],
          ['attach malformed', () => attach(who, id, { zq41c: true })],
        ] as const) {
          const r = await call();
          if (label === 'recipient bearer' && kind !== 'candidates') {
            expect({ label, kind, status: r.status, code: r.body.error?.code }).toEqual({ label, kind, status: 403, code: 'INSUFFICIENT_SCOPE' });
            scope.push(r.text);
            continue;
          }
          expect({ label, kind, status: r.status, code: r.body.error?.code }).toEqual({ label, kind, status: 404, code: 'NOT_FOUND' });
          out.push(r.text);
        }
      }
      // The same token on an id that does not exist: the same 403, byte for byte.
      scope.push((await attach({ bearer: ownerToken }, 999999999, { transactionId: 1 })).text);
      expect(new Set(scope).size).toBe(1);
      return out;
    };
    const without = await answers();
    expect(new Set(without).size).toBe(1);

    // A qualifying row now exists; the recipient hears exactly the same.
    const q: RowSpec = { canary: 'ZQ41CSEENROW', amount: 2.35, date: await pgDay(0) };
    await syncAdded(q);
    const rq = await idOf(q);
    const withRow = await answers();
    expect(withRow).toEqual(without);
    const named = await attach(w.owner, g, { transactionId: rq });
    expect(named.text).toBe(without[0]);
    expect(await linkCount()).toBe(0);
    expect((await giftState(g))?.state).toBe('awaiting');

    // Unauthenticated.
    expect((await candidates(null, g)).status).toBe(401);
    expect((await attach(null, g, { transactionId: rq })).status).toBe(401);

    // The giver by read token: the list, yes; a write, no.
    const giverToken = await readToken(w.two);
    const listed = await candidates({ bearer: giverToken }, g);
    expect(listed.status).toBe(200);
    expect(holds(listed.text, 'ZQ41CSEENROW')).toBe(true);
    const write = await attach({ bearer: giverToken }, g, { transactionId: rq });
    expect([write.status, write.body.error?.code]).toEqual([403, 'INSUFFICIENT_SCOPE']);
    expect(await linkCount()).toBe(0);
  });

  it('T41c-C7: a gift revealed today but unswept, revealed yesterday, cancelled, matched or unmatched refuses both routes with one 409; the same gift revealing tomorrow attaches', async () => {
    const q: RowSpec = { canary: 'ZQ41CSHUT', amount: 4.15, date: await pgDay(-1) };
    await syncAdded(q);
    const rq = await idOf(q);
    const before = await snapshot(rq);
    const base = { giver: w.owner.userId, recipient: w.two.userId, merchant: 'ZQ41CSHUT', windowStart: await pgDay(-3), windowEnd: await pgDay(-2) };
    const cases: [string, number][] = [
      ['reveal today, still awaiting', await seedGift({ ...base, revealSql: 'CURRENT_DATE' })],
      ['revealed yesterday', await seedGift({ ...base, revealSql: 'CURRENT_DATE - 1' })],
      ['cancelled', await seedGift(base)],
      ['matched', await seedGift(base)],
      ['unmatched', await seedGift(base)],
    ];
    await db.query(`UPDATE gifts SET state = 'cancelled' WHERE id = $1`, [cases[2][1]]);
    await db.query(`UPDATE gifts SET state = 'matched' WHERE id = $1`, [cases[3][1]]);
    await db.query(`UPDATE gifts SET state = 'unmatched', notice_at = NOW() WHERE id = $1`, [cases[4][1]]);
    expect((await giftState(cases[0][1]))?.state).toBe('awaiting');

    const bodies = new Set<string>();
    for (const [label, g] of cases) {
      const a = await attach(w.owner, g, { transactionId: rq });
      const l = await candidates(w.owner, g);
      expect({ label, attach: [a.status, a.body.error?.code], list: [l.status, l.body.error?.code] })
        .toEqual({ label, attach: [409, 'ALREADY_RESOLVED'], list: [409, 'ALREADY_RESOLVED'] });
      bodies.add(a.text);
      bodies.add(l.text);
    }
    expect(bodies.size).toBe(1);
    expect(await linkCount()).toBe(0);
    expect(await snapshot(rq)).toBe(before);

    // Control: the reveal date tomorrow — Postgres's tomorrow, in the statement that reads the gift.
    const open = await seedGift({ ...base, revealSql: 'CURRENT_DATE + 1' });
    expect((await candidates(w.owner, open)).status).toBe(200);
    expect((await attach(w.owner, open, { transactionId: rq })).status).toBe(200);
    expect(await linksOf(open)).toEqual([rq]);
  });

  it('T41c-C8: every unattachable row gets one byte-identical 400 with no row text, no criterion and no digits; a malformed body is a 400 too', async () => {
    const today = await pgDay(0);
    const specs = {
      linked: { canary: 'ZQ41CREFLK', amount: 5.35, date: today },
      refund: { canary: 'ZQ41CREFRF', amount: -5.35, date: today },
      account: { canary: 'ZQ41CREFAC', amount: 5.35, date: today, account: CARD_TWO },
      control: { canary: 'ZQ41CREFOK', amount: 5.35, date: today },
    } satisfies Record<string, RowSpec>;
    await syncAdded(...Object.values(specs));
    const g = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, amount: '5.35', merchant: 'ZQ41CREF', account: CARD, windowStart: await pgDay(3), windowEnd: await pgDay(4) });
    const sibling = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, merchant: 'ZQ41CREFLK', windowStart: today, windowEnd: today });
    const linked = await idOf(specs.linked);
    await db.query(`INSERT INTO gift_transactions (transaction_id, gift_id, prior_mapped_category, prior_rule_applied) VALUES ($1, $2, NULL, FALSE)`, [linked, sibling]);
    await db.query(`UPDATE gifts SET state = 'matched' WHERE id = $1`, [sibling]);
    const missing = Number((await db.query('SELECT COALESCE(MAX(id), 0) + 100000 AS n FROM transactions')).rows[0].n);

    const bodies = new Set<string>();
    for (const id of [missing, linked, await idOf(specs.refund), await idOf(specs.account)]) {
      const r = await attach(w.owner, g, { transactionId: id });
      expect([r.status, r.body.error?.code]).toEqual([400, 'INVALID_INPUT']);
      bodies.add(r.text);
      expect(holds(r.text, 'ZQ41CREF')).toBe(false);
      expect(/\d/.test(r.text)).toBe(false);
    }
    expect(bodies.size).toBe(1);
    const control = await idOf(specs.control);
    for (const body of [{}, { transactionId: String(control) }, { transactionId: control, giftId: g }, null, [control]]) {
      const r = await attach(w.owner, g, body);
      expect({ body, status: r.status, code: r.body.error?.code }).toEqual({ body, status: 400, code: 'INVALID_INPUT' });
      expect(/\d/.test(r.text)).toBe(false);
    }
    expect((await giftState(g))?.state).toBe('awaiting');
    expect(await linksOf(g)).toEqual([]);
  });
});

// ─── C9–C11: concurrency and the sync ──────────────────────────────────────────────────────────

describe('attach under concurrency, and the sync beside it', () => {
  it('T41c-C9: attach waits on a held row or gift and decides on what committed — a deleted row, a revised amount, a gift matched meanwhile, and two gifts racing for one row ten times', async () => {
    const day = await pgDay(-1);
    const observed: string[] = [];
    const specs = ['A', 'B', 'C'].map((k): RowSpec => ({ canary: `ZQ41CRACE${k}`, amount: 9.15, date: day }));
    const racers = Array.from({ length: 10 }, (_, i): RowSpec => ({ canary: `ZQ41CDUEL${String.fromCharCode(65 + i)}`, amount: 9.25, date: day }));
    await syncAdded(...specs, ...racers);
    const window = { windowStart: await pgDay(3), windowEnd: await pgDay(4) };
    const giftFor = (merchant: string, giver = w.owner, recipient = w.two) =>
      seedGift({ giver: giver.userId, recipient: recipient.userId, merchant, ...window });

    // (a) Plaid removes the row while attach waits.
    {
      const row = await idOf(specs[0]);
      const g = await giftFor('ZQ41CRACEA');
      const h = await holder();
      try {
        await h.client.query('DELETE FROM transactions WHERE id = $1', [row]);
        const pending = attach(w.owner, g, { transactionId: row });
        observed.push(`C9(a) ${await waitBlocked(h.pid)}`);
        await h.client.query('COMMIT');
        const r = await pending;
        expect([r.status, r.body.error?.code]).toEqual([400, 'INVALID_INPUT']);
      } finally { await release(h); }
      expect(await linksOf(g)).toEqual([]);
      expect((await giftState(g))?.state).toBe('awaiting');
    }

    // (b) A modified delivery revises the amount to one the gift does not accept.
    {
      const row = await idOf(specs[1]);
      const g = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, merchant: 'ZQ41CRACEB', amount: '9.15', ...window });
      const before = await rowState(row);
      const h = await holder();
      try {
        await h.client.query('UPDATE transactions SET amount = 9.16 WHERE id = $1', [row]);
        const pending = attach(w.owner, g, { transactionId: row });
        observed.push(`C9(b) ${await waitBlocked(h.pid)}`);
        await h.client.query('COMMIT');
        const r = await pending;
        expect([r.status, r.body.error?.code]).toEqual([400, 'INVALID_INPUT']);
      } finally { await release(h); }
      expect(await rowState(row)).toEqual(before);
      expect(await linksOf(g)).toEqual([]);
    }

    // (c) The sync holds the gift and matches it with a fresh row while attach waits.
    {
      const row = await idOf(specs[2]);
      const g = await giftFor('ZQ41CRACEC');
      const h = await holder();
      let fresh = 0;
      try {
        await h.client.query('SELECT id FROM gifts WHERE id = $1 FOR UPDATE', [g]);
        const pending = attach(w.owner, g, { transactionId: row });
        observed.push(`C9(c) ${await waitBlocked(h.pid)}`);
        fresh = (await h.client.query<{ id: number }>(
          `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, merchant_name)
           VALUES ('zq41b-zq41cracecfresh', $1, CURRENT_DATE, 9.15, 'ZQ41CRACECFRESH POS', 'ZQ41CRACECFRESH Merchant') RETURNING id`, [CARD])).rows[0].id;
        await h.client.query(`INSERT INTO gift_transactions (transaction_id, gift_id, prior_mapped_category, prior_rule_applied) VALUES ($1, $2, NULL, FALSE)`, [fresh, g]);
        await h.client.query(`UPDATE gifts SET state = 'matched' WHERE id = $1`, [g]);
        await h.client.query('COMMIT');
        const r = await pending;
        expect([r.status, r.body.error?.code]).toEqual([409, 'ALREADY_RESOLVED']);
      } finally { await release(h); }
      expect(await linksOf(g)).toEqual([fresh]);
      expect((await rowState(row))?.gift_id).toBeNull();
    }

    // (d) Two gifts attach one row at once, ten times: one giver for five, two givers for five.
    for (let i = 0; i < racers.length; i++) {
      const row = await idOf(racers[i]);
      const merchant = racers[i].canary;
      const first = await giftFor(merchant);
      const second = i < 5 ? await giftFor(merchant) : await giftFor(merchant, w.two, w.owner);
      const secondGiver = i < 5 ? w.owner : w.two;
      const h = await holder();
      let results: Awaited<ReturnType<typeof attach>>[] = [];
      try {
        await h.client.query('SELECT id FROM transactions WHERE id = $1 FOR UPDATE', [row]);
        const both = Promise.all([attach(w.owner, first, { transactionId: row }), attach(secondGiver, second, { transactionId: row })]);
        const seen = await waitBlocked(h.pid, 2);
        if (i === 0 || i === 5) observed.push(`C9(d) iteration ${i}: ${seen}`);
        await h.client.query('ROLLBACK');
        results = await both;
      } finally { await release(h); }
      expect({ i, statuses: results.map((r) => r.status).sort() }).toEqual({ i, statuses: [200, 400] });
      const links = await db.query('SELECT gift_id FROM gift_transactions WHERE transaction_id = $1', [row]);
      expect(links.rows.length).toBe(1);
      const states = [(await giftState(first))?.state, (await giftState(second))?.state].sort();
      expect({ i, states }).toEqual({ i, states: ['awaiting', 'matched'] });
    }
    console.log(`p41c C9 lock observations:\n${observed.join('\n')}`);
  }, 120_000);

  it('T41c-C10: a real sync matching the gift and an attach of an older row, run together ten times, never deadlock and leave exactly one link, the attach answering for whichever row won', async () => {
    const letters = 'ABCDEFGHIJ'.split('');
    const old = letters.map((l): RowSpec => ({ canary: `ZQ41CRUN${l}OLD`, amount: 11.07, date: '' }));
    for (const s of old) s.date = await pgDay(-3);
    await syncAdded(...old);
    const outcomes: number[] = [];
    for (let i = 0; i < letters.length; i++) {
      const l = letters[i];
      const g = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, merchant: `ZQ41CRUN${l}`, windowStart: await pgDay(-1), windowEnd: await pgDay(1) });
      const rOld = await idOf(old[i]);
      const fresh: RowSpec = { canary: `ZQ41CRUN${l}NEW`, amount: 11.07, date: await pgDay(0) };
      const settled = await Promise.allSettled([syncAdded(fresh), attach(w.owner, g, { transactionId: rOld })]);
      expect({ i, statuses: settled.map((s) => s.status) }).toEqual({ i, statuses: ['fulfilled', 'fulfilled'] });
      const [sync, att] = settled as [PromiseFulfilledResult<unknown>, PromiseFulfilledResult<Awaited<ReturnType<typeof attach>>>];
      expect(/deadlock/i.test(JSON.stringify(sync.value) + att.value.text)).toBe(false);
      const rNew = await idOf(fresh);
      const links = await linksOf(g);
      expect({ i, links: links.length, state: (await giftState(g))?.state }).toEqual({ i, links: 1, state: 'matched' });
      outcomes.push(att.value.status);
      if (att.value.status === 200) {
        expect(links).toEqual([rOld]);
        expect(holds(await detailText(w.two, rNew), `ZQ41CRUN${l}NEW`)).toBe(true);
      } else {
        expect({ i, status: att.value.status, code: att.value.body.error?.code }).toEqual({ i, status: 409, code: 'ALREADY_RESOLVED' });
        expect(links).toEqual([rNew]);
        expect(holds(await detailText(w.two, rOld), `ZQ41CRUN${l}OLD`)).toBe(true);
      }
    }
    expect(outcomes.every((s) => s === 200 || s === 409)).toBe(true);
  }, 120_000);

  it('T41c-C11: the sync claims nothing for a gift whose reveal date is today, even while it still says awaiting; the same gift revealing tomorrow claims, files and masks', async () => {
    await db.query(`INSERT INTO category_rules (plaid_category, mapped_category) VALUES ('ZQ41CNSEVEN_PRIMARY', $1)`, [OTHER_CATEGORY]);
    const late = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, merchant: 'ZQ41CNSEVENT', windowStart: await pgDay(-3), windowEnd: await pgDay(0), revealSql: 'CURRENT_DATE' });
    const open = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, merchant: 'ZQ41CNSEVENC', windowStart: await pgDay(-3), windowEnd: await pgDay(0), revealSql: 'CURRENT_DATE + 1' });
    const t: RowSpec = { canary: 'ZQ41CNSEVENT', amount: 12.15, date: await pgDay(0), plaidCategory: 'ZQ41CNSEVEN_PRIMARY' };
    const c: RowSpec = { canary: 'ZQ41CNSEVENC', amount: 12.25, date: await pgDay(0), plaidCategory: 'ZQ41CNSEVEN_PRIMARY' };
    await syncAdded(t, c);
    const [rt, rc] = [await idOf(t), await idOf(c)];
    expect(await rowState(rt)).toEqual({ mapped_category: OTHER_CATEGORY, rule_applied: true, gift_id: null });
    expect(holds(await detailText(w.two, rt), 'ZQ41CNSEVENT')).toBe(true);
    expect((await giftState(late))?.state).toBe('awaiting');
    // Control.
    expect(await rowState(rc)).toEqual({ mapped_category: GIFT_CATEGORY, rule_applied: false, gift_id: open });
    expect(holds(await detailText(w.two, rc), 'ZQ41CNSEVENC')).toBe(false);
    expect((await giftState(open))?.state).toBe('matched');
  });
});

// ─── C12–C13: what is said, and what downstream sees ──────────────────────────────────────────

describe('logs, and the readers downstream of the link', () => {
  it('T41c-C12: no log or output line from a list, an attach, a refused attach or a 409 holds a canary, the criterion or a row amount; the success path does log', async () => {
    const row: RowSpec = { canary: 'ZQ41CLOGCRITROW', amount: 4.35, date: await pgDay(-1) };
    const refund: RowSpec = { canary: 'ZQ41CLOGCRITREF', amount: -4.35, date: await pgDay(-1) };
    await syncAdded(row, refund);
    const g = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, merchant: 'ZQ41CLOGCRIT', amount: '4.35', account: CARD, windowStart: await pgDay(3), windowEnd: await pgDay(4) });
    const [rr, rf] = [await idOf(row), await idOf(refund)];

    const lines: string[] = [];
    const spies = [
      ...(['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); })),
      vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => { lines.push(String(c)); return true; }),
      vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => { lines.push(String(c)); return true; }),
    ];
    const statuses: number[] = [];
    try {
      statuses.push((await candidates(w.owner, g)).status);
      statuses.push((await attach(w.owner, g, { transactionId: rf })).status);
      statuses.push((await attach(w.owner, g, { transactionId: rr })).status);
      statuses.push((await attach(w.owner, g, { transactionId: rr })).status);
    } finally {
      for (const s of spies) s.mockRestore();
    }
    expect(statuses).toEqual([200, 400, 200, 409]);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes('gift attached'))).toBe(true);
    const all = lines.join('\n');
    expect(holds(all, 'ZQ41CLOGCRIT')).toBe(false);
    // The row's amount as a figure; a timestamp's seconds (`44.352Z`) are not it.
    expect(/(?<!\d)4\.35(?!\d)/.test(all)).toBe(false);
  });

  it('T41c-C13: an attached row is a Gift row to every recipient-side reader — list, search, detail, rule counts and rule writes — and locked against re-filing and deletion for both people', async () => {
    const today = await pgDay(0);
    const month = Number(today.slice(5, 7));
    const spec: RowSpec = { canary: 'ZQ41CDOWN', amount: 2.57, date: today, plaidCategory: 'ZQ41CDOWN_PRIMARY' };
    await syncAdded(spec);
    const row = await idOf(spec);
    const g = await seedGift({ giver: w.owner.userId, recipient: w.two.userId, merchant: 'ZQ41CDOWN', windowStart: await pgDay(3), windowEnd: await pgDay(4) });
    expect((await attach(w.owner, g, { transactionId: row })).status).toBe(200);

    // The drill-down list.
    const list = await read(await drill(req(`/api/v1/transactions?category=${encodeURIComponent(GIFT_CATEGORY)}&month=${month}`, w.two)));
    expect((list.body.data as { rows: { id: number; label: string }[] }).rows.find((x) => x.id === row)).toMatchObject({ label: 'Gift' });
    expect(holds(list.text, 'ZQ41CDOWN')).toBe(false);

    // The transactions page and its search, as the recipient.
    const pageRows = async (search: string) => {
      rec.viewer = w.two.userId;
      const element = await TransactionsPage({ searchParams: Promise.resolve({ search }) });
      const found: unknown[] = [];
      const walk = (n: unknown) => {
        if (!n || typeof n !== 'object') return;
        const el = n as { props?: { transactions?: unknown; children?: unknown } };
        if (Array.isArray(el.props?.transactions)) found.push(...(el.props.transactions as unknown[]));
        const kids = el.props?.children;
        (Array.isArray(kids) ? kids : [kids]).forEach(walk);
      };
      walk(element);
      return found as { id: number }[];
    };
    const byCanary = await pageRows('ZQ41CDOWN');
    expect(byCanary.filter((x) => x.id === row)).toEqual([]);
    expect(holds(JSON.stringify(byCanary), 'ZQ41CDOWN')).toBe(false);
    const byAmount = await pageRows('2.57');
    const hit = byAmount.filter((x) => x.id === row);
    expect(hit.length).toBe(1);
    expect(holds(JSON.stringify(hit), 'ZQ41CDOWN')).toBe(false);
    expect(JSON.stringify(hit)).toContain('Gift');

    // The detail.
    const d = await read(await detail(req(`/api/v1/transactions/${row}`, w.two), params(row)));
    expect((d.body.data as { title: string; enriched: boolean })).toMatchObject({ title: 'Gift', enriched: false });
    expect(holds(d.text, 'ZQ41CDOWN')).toBe(false);

    // Rule counts and rule writes.
    const ruleCount = async (viewer: number) => {
      rec.viewer = viewer;
      const element = await RulesPage();
      const found: { rows: { plaid_category: string; count: number }[] }[] = [];
      const walk = (n: unknown) => {
        if (!n || typeof n !== 'object') return;
        const el = n as { props?: { rows?: unknown; children?: unknown } };
        if (el.props?.rows !== undefined) found.push(el.props as { rows: { plaid_category: string; count: number }[] });
        const kids = el.props?.children;
        (Array.isArray(kids) ? kids : [kids]).forEach(walk);
      };
      walk(element);
      return found[0].rows.find((r) => r.plaid_category === 'ZQ41CDOWN_PRIMARY')?.count ?? 0;
    };
    expect(await ruleCount(w.two.userId)).toBe(0);
    expect(await ruleCount(w.owner.userId)).toBe(1);
    const written = await read(await postRule(req('/api/v1/rules', w.two, { method: 'POST', body: { plaid_category: 'ZQ41CDOWN_PRIMARY', mapped_category: OTHER_CATEGORY } })));
    expect(written.body.data).toEqual({ refiled: 0 });
    expect((await read(await applyRules())).status).toBe(200);
    expect(await rowState(row)).toEqual({ mapped_category: GIFT_CATEGORY, rule_applied: false, gift_id: g });

    // Category and delete, by both people.
    const before = await snapshot(row);
    for (const who of [w.two, w.owner]) {
      const patch = await read(await patchTxn(req(`/api/v1/transactions/${row}`, who, { method: 'PATCH', body: { mapped_category: OTHER_CATEGORY } }), params(row)));
      const del = await read(await deleteTxn(req(`/api/v1/transactions/${row}`, who, { method: 'DELETE' }), params(row)));
      expect([patch.status, patch.body.error?.code, del.status, del.body.error?.code]).toEqual([409, 'GIFT_LOCKED', 409, 'GIFT_LOCKED']);
    }
    expect(await snapshot(row)).toBe(before);
  });
});
