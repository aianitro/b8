// P7-41b — every surface, every viewer: X1–X15 of plan/tasks/P7-41b-gifts/SPEC.md.
//
// TIER 2. Faked: Plaid, the Anthropic SDK, `nodemailer` (the digest's transport), the two digest
// image renderers (wrapped, to record what they are handed), and the network `fetch` the push uses.
// Everything else — every route, reader and statement — is real, against the scratch database.
//
// THE WORLD (`surfaceWorld`). The OWNER is the recipient and `Test User Two` the giver, so no
// owner-shaped shortcut can pass. Rows, each with a canary in every text field and in `plaid_raw`:
//   ZQ41BXGIFT   — held by a matched gift, unrevealed;
//   ZQ41BXCANDA/B — the two candidates of a second gift, still in `choose`;
//   ZQ41BXPLAIN  — an ordinary outflow, and ZQ41BXPAIR its opposite on the other card;
//   ZQ41BXREVEAL — held by a matched gift whose reveal date has passed.
// The masked canaries must never reach the owner or a third user; the giver must see them, so an
// empty or failed response cannot pass for a clean one.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '@/lib/db';

const rec = vi.hoisted(() => ({
  mail: [] as unknown[],
  images: [] as unknown[],
  viewer: null as number | null,
}));

vi.mock('@/lib/plaid', async () => (await import('./giftFakesTestKit')).plaidModule);
vi.mock('@/lib/plaidReconcile', async () => (await import('./giftFakesTestKit')).reconcileModule);
vi.mock('@/lib/plaidBalances', async () => (await import('./giftFakesTestKit')).balancesModule);
vi.mock('@anthropic-ai/sdk', async () => (await import('./giftFakesTestKit')).anthropicModule);
vi.mock('@/lib/rateLimit', () => ({ createLimiter: () => ({}), check: () => ({ allowed: true }) }));
vi.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: async (m: unknown) => { rec.mail.push(m); return {}; } }),
}));
vi.mock('@/lib/digestImage', async (original) => {
  const real = await original<typeof import('@/lib/digestImage')>();
  return {
    ...real,
    renderChartPng: async (points: unknown) => { rec.images.push(points); return Buffer.from('zq41b-png'); },
    renderBubblesPng: async (bubbles: unknown) => { rec.images.push(bubbles); return Buffer.from('zq41b-png'); },
  };
});
// The rules PAGE resolves its viewer from Next's request headers, which exist only inside a render;
// X11 sets the viewer here and renders the page component directly.
vi.mock('@/lib/giftViewer', async (original) => ({
  ...(await original<typeof import('@/lib/giftViewer')>()),
  pageViewer: async () => rec.viewer,
}));

import { GET as overview } from '../overview/route';
import { GET as drill } from '../transactions/route';
import { DELETE as deleteTxn, GET as detail, PATCH as patchTxn } from '../transactions/[id]/route';
import { GET as counterparts } from '../transactions/[id]/counterparts/route';
import { PATCH as bulk } from '../transactions/bulk/route';
import { POST as linkTransfer } from '../transfers/route';
import { POST as cashTransfer } from '../cash-transfers/route';
import { POST as decide } from '../agent/proposals/[id]/decide/route';
import { POST as chat } from '../chat/route';
import { POST as postRule } from '../rules/route';
import { POST as applyRules } from '../rules/apply/route';
import { GET as listGifts } from './route';
import { GET as getGift } from './[id]/route';
import { POST as chooseGift } from './[id]/choose/route';
import { GET as giftCandidates } from './[id]/candidates/route';
import RulesPage from '../../../rules/page';
import { loadOverview } from '@/lib/overviewRead';
import { loadYearEnd } from '@/lib/yearEndRead';
import { loadMonthOutlook } from '@/lib/monthOutlookRead';
import { computeCurrentNetWorth } from '@/lib/netWorth';
import { asOfFromDate } from '@/lib/domain/monthOutlook';
import { runDailyDigest } from '@/lib/dailyDigest';
import { sendWebPush, sendWebPushIfDelivered } from '@/lib/webPush';
import { runGiftSweep } from '@/lib/giftStore';
import { suggestCategories } from '@/lib/categorySuggester';
import { createProposal } from '@/lib/proposalStore';
import { detectUpcomingRecurring } from '@/lib/recurringDetection';
import { checkOverdraft } from '@/lib/overdraftWatch';
import { ROUTES } from '@/lib/giftSurfaceRegistry';
import { anthropicFake } from './giftFakesTestKit';
import { installFabricatedVapid } from '../auth/secondUserTestKit';
import {
  CARD, CARD_TWO, GIFT_CATEGORY, MANUAL, OTHER_CATEGORY, buildWorld, holds, pgDay, read, readToken, req, rowIdOf,
  seedGift, syncAdded, syncWith, page, teardownWorld, type EnrolledUser, type World,
} from './giftTestKit';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const MASKED = ['ZQ41BXGIFT', 'ZQ41BXCANDA', 'ZQ41BXCANDB'];
const leaked = (text: string) => MASKED.filter((c) => holds(text, c));
const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

interface Surface {
  w: World;
  ids: { gift: number; candA: number; candB: number; plain: number; pair: number; reveal: number };
  gifts: { matched: number; choosing: number; revealed: number };
  month: number;
}

let s: Surface;
afterAll(teardownWorld);

async function surfaceWorld(): Promise<Surface> {
  const w = await buildWorld({ third: true });
  const day = await pgDay(0);
  const window = { windowStart: await pgDay(-3), windowEnd: await pgDay(3) };
  const matched = await seedGift({ giver: w.two.userId, recipient: w.owner.userId, merchant: 'ZQ41BXGIFT', ...window });
  const choosing = await seedGift({ giver: w.two.userId, recipient: w.owner.userId, amount: '13.57', ...window });
  await syncAdded(
    { canary: 'ZQ41BXGIFT', amount: 41.35, date: day },
    { canary: 'ZQ41BXCANDA', amount: 13.57, date: day },
    { canary: 'ZQ41BXCANDB', amount: 13.57, date: day },
    { canary: 'ZQ41BXPLAIN', amount: 30.15, date: day },
    { canary: 'ZQ41BXPAIR', amount: -30.15, date: day, account: CARD_TWO },
    { canary: 'ZQ41BXREVEAL', amount: 2.15, date: day },
  );
  const id = async (c: string) => (await rowIdOf({ canary: c, amount: 0, date: '' }))!;
  const ids = {
    gift: await id('ZQ41BXGIFT'), candA: await id('ZQ41BXCANDA'), candB: await id('ZQ41BXCANDB'),
    plain: await id('ZQ41BXPLAIN'), pair: await id('ZQ41BXPAIR'), reveal: await id('ZQ41BXREVEAL'),
  };
  // A gift revealed yesterday, holding its row: everyone sees it real.
  const revealed = (await db.query<{ id: number }>(
    `INSERT INTO gifts (giver_user_id, recipient_user_id, merchant, window_start, window_end, reveal_date, state)
     VALUES ($1, $2, 'ZQ41BXREVEAL', CURRENT_DATE - 5, CURRENT_DATE - 5, CURRENT_DATE - 1, 'matched') RETURNING id`,
    [w.two.userId, w.owner.userId])).rows[0].id;
  await db.query(
    `INSERT INTO gift_transactions (transaction_id, gift_id, prior_mapped_category, prior_rule_applied) VALUES ($1, $2, NULL, FALSE)`,
    [ids.reveal, revealed]);
  await db.query('UPDATE transactions SET mapped_category = $1 WHERE id = $2', [GIFT_CATEGORY, ids.reveal]);
  const gifts = { matched, choosing, revealed };
  expect((await db.query('SELECT state FROM gifts WHERE id = ANY($1) ORDER BY id', [[matched, choosing]])).rows)
    .toEqual([{ state: 'matched' }, { state: 'choose' }]);
  return { w, ids, gifts, month: Number(day.slice(5, 7)) };
}

type Who = EnrolledUser | { bearer: string };

/**
 * P7-41c (S29): a waiting gift of the giver's whose merchant criterion is the ordinary row's, made
 * once per world on first use — after the world's sync, so no sync claims the row — so the giver's
 * candidate list holds that row and a non-giver's answer can be compared against a real one.
 */
const candidateGifts = new WeakMap<Surface, Promise<number>>();
function candidateGiftOf(sf: Surface): Promise<number> {
  let id = candidateGifts.get(sf);
  if (!id) {
    id = (async () => seedGift({
      giver: sf.w.two.userId, recipient: sf.w.owner.userId, merchant: 'ZQ41BXPLAIN',
      windowStart: await pgDay(1), windowEnd: await pgDay(3),
    }))();
    candidateGifts.set(sf, id);
  }
  return id;
}

/** Every text-bearing GET route's probe: what to ask, and the canary its giver must see. */
function probes(sf: Surface): Record<string, { call: (who: Who) => Promise<Response>; giverSees: string; nonGiverStatus: number }> {
  return {
    'app/api/v1/overview/route.ts': { call: (who) => overview(req('/api/v1/overview', who as EnrolledUser)), giverSees: 'ZQ41BXGIFT', nonGiverStatus: 200 },
    'app/api/v1/transactions/route.ts': {
      call: (who) => drill(req(`/api/v1/transactions?category=${encodeURIComponent(GIFT_CATEGORY)}&month=${sf.month}`, who as EnrolledUser)),
      giverSees: 'ZQ41BXGIFT', nonGiverStatus: 200,
    },
    'app/api/v1/transactions/[id]/route.ts': { call: (who) => detail(req(`/api/v1/transactions/${sf.ids.gift}`, who as EnrolledUser), params(sf.ids.gift)), giverSees: 'ZQ41BXGIFT', nonGiverStatus: 200 },
    'app/api/v1/transactions/[id]/counterparts/route.ts': {
      call: (who) => counterparts(req(`/api/v1/transactions/${sf.ids.plain}/counterparts`, who as EnrolledUser), params(sf.ids.plain)),
      giverSees: 'ZQ41BXPAIR', nonGiverStatus: 200,
    },
    'app/api/v1/gifts/route.ts': { call: (who) => listGifts(req('/api/v1/gifts', who as EnrolledUser)), giverSees: 'ZQ41BXGIFT', nonGiverStatus: 200 },
    'app/api/v1/gifts/[id]/route.ts': {
      call: (who) => getGift(req(`/api/v1/gifts/${sf.gifts.matched}`, who as EnrolledUser), params(sf.gifts.matched)),
      giverSees: 'ZQ41BXGIFT', nonGiverStatus: 404,
    },
    'app/api/v1/gifts/[id]/candidates/route.ts': {
      call: async (who) => {
        const id = await candidateGiftOf(sf);
        return giftCandidates(req(`/api/v1/gifts/${id}/candidates`, who as EnrolledUser), params(id));
      },
      giverSees: 'ZQ41BXPLAIN', nonGiverStatus: 404,
    },
  };
}

/** Whether a route module exports a GET handler. */
async function exportsGet(file: string): Promise<boolean> {
  return typeof (await import(join(WEB, file))).GET === 'function';
}

/** Numeric and money leaves of a JSON value, by path. */
function figures(value: unknown, path = '$', out = new Map<string, unknown>()): Map<string, unknown> {
  if (typeof value === 'number' || (typeof value === 'string' && /^-?\d+\.\d{2}$/.test(value))) out.set(path, value);
  else if (Array.isArray(value)) value.forEach((v, i) => figures(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) figures(v, `${path}.${k}`, out);
  return out;
}

describe('every surface, every viewer', () => {
  beforeEach(async () => {
    s = await surfaceWorld();
    anthropicFake.requests.length = 0;
    rec.mail.length = 0;
    rec.images.length = 0;
  });

  it('T41b-X1: every text-bearing GET route is clean for the recipient by cookie and by read token and for a third user, real for the giver, and real for everyone once revealed; numeric routes carry no row text', async () => {
    const { w } = s;
    const table = probes(s);
    // Completeness: every text-bearing route with a GET has a probe here.
    const textGets: string[] = [];
    for (const r of ROUTES.filter((x) => x.classes.includes('text-bearing'))) if (await exportsGet(r.file)) textGets.push(r.file);
    expect(textGets.sort()).toEqual(Object.keys(table).sort());

    const token = await readToken(w.owner);
    for (const [file, probe] of Object.entries(table)) {
      for (const [who, label] of [[w.owner, 'recipient cookie'], [{ bearer: token }, 'recipient bearer'], [w.three!, 'third user']] as const) {
        const r = await read(await probe.call(who));
        expect({ file, label, status: r.status, leaked: leaked(r.text) }).toEqual({ file, label, status: probe.nonGiverStatus, leaked: [] });
      }
      const g = await read(await probe.call(w.two));
      expect({ file, status: g.status, sees: holds(g.text, probe.giverSees) }).toEqual({ file, status: 200, sees: true });
    }
    // The revealed row is real for the recipient.
    const revealed = await read(await detail(req(`/api/v1/transactions/${s.ids.reveal}`, w.owner), params(s.ids.reveal)));
    expect(holds(revealed.text, 'ZQ41BXREVEAL')).toBe(true);

    // Every other GET route without a path parameter, as the recipient: no masked canary.
    for (const r of ROUTES.filter((x) => !x.classes.includes('text-bearing') && !x.file.includes('['))) {
      const mod = await import(join(WEB, r.file));
      if (typeof mod.GET !== 'function') continue;
      const path = '/' + r.file.replace(/^app\//, '').replace(/\/route\.ts$/, '');
      const res = await mod.GET(req(path, w.owner));
      expect({ file: r.file, leaked: leaked(await res.text()) }).toEqual({ file: r.file, leaked: [] });
    }
    // And the sync's own response.
    expect(leaked(JSON.stringify(await syncWith(page({}))))).toEqual([]);
  });

  it('T41b-X2: the recipient\'s detail of the held row is Gift, its amount, date and account, and nothing else', async () => {
    // The giver's own note and watch flag on the row (allowed to them, Q5) — fields the recipient must not see.
    await db.query(`UPDATE transactions SET note = 'ZQ41BXGIFT note', watched_at = NOW() WHERE id = $1`, [s.ids.gift]);
    const r = await read(await detail(req(`/api/v1/transactions/${s.ids.gift}`, s.w.owner), params(s.ids.gift)));
    const g = await read(await detail(req(`/api/v1/transactions/${s.ids.gift}`, s.w.two), params(s.ids.gift)));
    const d = r.body.data as Record<string, unknown>;
    const real = g.body.data as Record<string, unknown>;
    expect(d.title).toBe('Gift');
    expect([d.amount, d.date, d.account]).toEqual([real.amount, real.date, real.account]);
    expect(d).toMatchObject({
      authorizedDate: null, bankDescription: null, logoUrl: null, website: null, plaidCategory: null,
      plaidCategoryDetailed: null, plaidConfidence: null, paymentChannel: null, paymentMethod: null,
      paymentProcessor: null, location: null, mapsUrl: null, counterparties: [], note: null, watched: false,
      enriched: false, budgetCategory: GIFT_CATEGORY,
    });
    const allowed = new Set(['Gift', d.date, (d.account as { id: string }).id, (d.account as { name: string }).name, GIFT_CATEGORY]);
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(d);
    expect(strings.filter((x) => !allowed.has(x))).toEqual([]);
    // Control: the giver's detail is enriched and real.
    expect(real.enriched).toBe(true);
    expect(holds(g.text, 'ZQ41BXGIFT')).toBe(true);
  });

  it('T41b-X3: the drill-down lists the held rows as Gift, and its spent, pending and count equal the giver\'s', async () => {
    const path = `/api/v1/transactions?category=${encodeURIComponent(GIFT_CATEGORY)}&month=${s.month}`;
    const r = (await read(await drill(req(path, s.w.owner)))).body.data as { rows: { id: number; label: string; note: string | null }[]; spent: string; pending: string; count: number };
    const g = (await read(await drill(req(path, s.w.two)))).body.data as typeof r;
    expect(r.rows.find((x) => x.id === s.ids.gift)).toMatchObject({ label: 'Gift', note: null });
    expect([r.spent, r.pending, r.count]).toEqual([g.spent, g.pending, g.count]);
    expect(r.count).toBeGreaterThanOrEqual(4);
  });

  it('T41b-X4: the overview\'s figures are equal for the recipient and the giver path by path; only the giver\'s holds the canary', async () => {
    const now = new Date();
    const recipient = await loadOverview(s.w.owner.userId, now);
    const giver = await loadOverview(s.w.two.userId, now);
    expect([...figures(recipient)]).toEqual([...figures(giver)]);
    expect(leaked(JSON.stringify(recipient))).toEqual([]);
    expect(holds(JSON.stringify(giver), 'ZQ41BXGIFT')).toBe(true);
    expect(recipient.recentArrivals.find((a) => a.id === s.ids.gift)).toMatchObject({ label: 'Gift', merchant: null, note: null });
  });

  it('T41b-X5: year-end, the month outlook\'s actuals, net worth, the budget figures and the overview numbers do not move with the viewer, the reveal date, or the link', async () => {
    const asOf = asOfFromDate(new Date());
    const snapshot = async (viewer: number) => JSON.stringify({
      yearEnd: await loadYearEnd('operational', asOf),
      actuals: (await loadMonthOutlook(asOf)).allPaces.map((p) => [p.category, p.month, p.actual]),
      netWorth: await computeCurrentNetWorth(),
      overview: [...figures(await loadOverview(viewer, new Date(2026, 0, 1, 12)))].filter(([k]) => !k.startsWith('$.jobHealth')),
    });
    const base = await snapshot(s.w.owner.userId);
    expect(await snapshot(s.w.two.userId)).toBe(base);
    await db.query('UPDATE gifts SET reveal_date = CURRENT_DATE - 1');
    expect(await snapshot(s.w.owner.userId)).toBe(base);
    await db.query('UPDATE gifts SET reveal_date = CURRENT_DATE + 30 WHERE id <> $1', [s.gifts.revealed]);
    await db.query('DELETE FROM gift_transactions');
    expect(await snapshot(s.w.owner.userId)).toBe(base);
  });

  it('T41b-X6: chat tool results, the system prompt and the reply carry no canary for the recipient; top merchants show one Gift bucket of the held rows\' total; categorise refuses a held row for everyone', async () => {
    process.env.ANTHROPIC_API_KEY = 'zq41b-fake-key';
    try {
      const script = (giftId: number) => (_r: unknown, n: number) => n === 1
        ? { content: [
            { type: 'tool_use', id: 't1', name: 'get_transactions', input: { limit: 100 } },
            { type: 'tool_use', id: 't2', name: 'get_transactions', input: { transaction_id: giftId } },
            { type: 'tool_use', id: 't3', name: 'get_top_merchants', input: { limit: 50 } },
            { type: 'tool_use', id: 't4', name: 'get_monthly_spending', input: {} },
            { type: 'tool_use', id: 't5', name: 'get_budget_summary', input: {} },
            { type: 'tool_use', id: 't6', name: 'categorize_transaction', input: { transaction_id: giftId, category: OTHER_CATEGORY } },
          ], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } }
        : { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
      const proposalsBefore = Number((await db.query('SELECT COUNT(*) FROM agent_proposals')).rows[0].count);
      const turn = async (who: EnrolledUser) => {
        anthropicFake.requests.length = 0;
        anthropicFake.script = script(s.ids.gift);
        const res = await read(await chat(req('/api/v1/chat', who, { method: 'POST', body: { messages: [{ role: 'user', content: 'what did I buy' }] } })));
        const sent = JSON.stringify(anthropicFake.requests);
        const results = new Map<string, unknown>();
        const last = anthropicFake.requests[anthropicFake.requests.length - 1].messages as { role: string; content: unknown }[];
        for (const m of last) if (Array.isArray(m.content)) for (const b of m.content as { type: string; tool_use_id?: string; content?: string }[]) {
          if (b.type === 'tool_result' && b.tool_use_id) results.set(b.tool_use_id, JSON.parse(b.content!));
        }
        return { res, sent, results };
      };
      const r = await turn(s.w.owner);
      expect(r.res.status).toBe(200);
      expect(leaked(r.sent)).toEqual([]);
      expect(leaked(r.res.text)).toEqual([]);
      const total = (await db.query<{ t: string }>('SELECT SUM(amount)::numeric(12,2)::text AS t FROM transactions WHERE id = ANY($1)', [[s.ids.gift, s.ids.candA, s.ids.candB]])).rows[0].t;
      const top = r.results.get('t3') as { merchant: string; total_spent: string }[];
      expect(top.filter((x) => x.merchant === 'Gift').map((x) => x.total_spent)).toEqual([total]);
      expect(r.results.get('t6')).toMatchObject({ error: expect.any(String) });
      const g = await turn(s.w.two);
      expect(holds(g.sent, 'ZQ41BXGIFT')).toBe(true);
      expect(g.results.get('t6')).toMatchObject({ error: expect.any(String) });
      expect(Number((await db.query('SELECT COUNT(*) FROM agent_proposals')).rows[0].count)).toBe(proposalsBefore);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('T41b-X7: the digest masks every unrevealed gift for everyone — owner as recipient and owner as giver — in subject, text, HTML, headers and attachments, and stores no row text; after the reveal the real text appears', async () => {
    const env = {
      ALERTS_ENABLED: 'true', SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '587', SMTP_USER: 'zq41b',
      SMTP_PASSWORD: 'zq41b-fabricated', ALERT_EMAIL_TO: 'owner@example.invalid', ALERT_EMAIL_FROM: 'b8@example.invalid',
    };
    const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    Object.assign(process.env, env);
    const prior = (await db.query(`SELECT * FROM alert_sends WHERE kind = 'digest'`)).rows;
    const digest = async () => {
      await db.query(`DELETE FROM alert_sends WHERE kind = 'digest'`);
      rec.mail.length = 0;
      await runDailyDigest();
      expect(rec.mail).toHaveLength(1);
      const sends = (await db.query(`SELECT * FROM alert_sends WHERE kind = 'digest'`)).rows;
      return { mail: JSON.stringify(rec.mail), sends: JSON.stringify(sends) };
    };
    try {
      const asRecipient = await digest();
      expect(leaked(asRecipient.mail)).toEqual([]);
      expect(leaked(asRecipient.sends)).toEqual([]);
      expect(asRecipient.mail).toContain('Gift');
      // The owner as giver: the digest still masks (SPEC.md Open question 3).
      await db.query('UPDATE gifts SET giver_user_id = recipient_user_id, recipient_user_id = giver_user_id');
      const asGiver = await digest();
      expect(leaked(asGiver.mail)).toEqual([]);
      // Control: revealed, the same digest names the rows.
      await db.query('UPDATE gifts SET reveal_date = CURRENT_DATE');
      const after = await digest();
      expect(holds(after.mail, 'ZQ41BXGIFT')).toBe(true);
    } finally {
      await db.query(`DELETE FROM alert_sends WHERE kind = 'digest'`);
      for (const row of prior) {
        await db.query('INSERT INTO alert_sends (id, attempted_at, kind, fingerprint, delivered, failure_reason) VALUES ($1, $2, $3, $4, $5, $6)',
          [row.id, row.attempted_at, row.kind, row.fingerprint, row.delivered, row.failure_reason]);
      }
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });

  it('T41b-X8: the digest images are handed figures and category names only — no canary in their arguments', async () => {
    const env = {
      ALERTS_ENABLED: 'true', SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '587', SMTP_USER: 'zq41b',
      SMTP_PASSWORD: 'zq41b-fabricated', ALERT_EMAIL_TO: 'owner@example.invalid', ALERT_EMAIL_FROM: 'b8@example.invalid',
    };
    const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    Object.assign(process.env, env);
    const prior = (await db.query(`SELECT * FROM alert_sends WHERE kind = 'digest'`)).rows;
    try {
      await db.query(`DELETE FROM alert_sends WHERE kind = 'digest'`);
      // Revealed, so the rows themselves would carry real text if anything passed them through.
      await db.query('UPDATE gifts SET reveal_date = CURRENT_DATE');
      await runDailyDigest();
      expect(rec.images.length).toBeGreaterThanOrEqual(1);
      const args = JSON.stringify(rec.images);
      expect(leaked(args)).toEqual([]);
      expect(holds(args, 'ZQ41BXPLAIN')).toBe(false);
    } finally {
      await db.query(`DELETE FROM alert_sends WHERE kind = 'digest'`);
      for (const row of prior) {
        await db.query('INSERT INTO alert_sends (id, attempted_at, kind, fingerprint, delivered, failure_reason) VALUES ($1, $2, $3, $4, $5, $6)',
          [row.id, row.attempted_at, row.kind, row.fingerprint, row.delivered, row.failure_reason]);
      }
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });

  it('T41b-X9: the daily, overdraft and window-end pings carry no body and only the known headers; the daily ping reaches the owner, the window-end ping only the giver', async () => {
    installFabricatedVapid();
    await db.query(
      `INSERT INTO web_push_subscriptions (endpoint, user_id) VALUES
         ('https://push.example.invalid/zq41b-owner', $1), ('https://push.example.invalid/zq41b-two', $2)`,
      [s.w.owner.userId, s.w.two.userId]);
    const calls: { url: string; init?: RequestInit }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(u), init }); return new Response(null, { status: 201 }); }) as typeof fetch;
    try {
      const pings: Record<string, string[]> = {};
      calls.length = 0; await sendWebPushIfDelivered(['digest']); pings.daily = calls.map((c) => c.url);
      const daily = [...calls];
      calls.length = 0; await sendWebPush('high'); pings.overdraft = calls.map((c) => c.url);
      const overdraft = [...calls];
      await seedGift({ giver: s.w.two.userId, recipient: s.w.owner.userId, merchant: 'ZQ41BXLATE', windowStart: await pgDay(-20), windowEnd: await pgDay(-10) });
      calls.length = 0; await runGiftSweep(); pings.windowEnd = calls.map((c) => c.url);
      const windowEnd = [...calls];
      expect(pings).toEqual({
        daily: ['https://push.example.invalid/zq41b-owner'],
        overdraft: ['https://push.example.invalid/zq41b-owner'],
        windowEnd: ['https://push.example.invalid/zq41b-two'],
      });
      for (const c of [...daily, ...overdraft, ...windowEnd]) {
        expect(c.init?.body).toBeUndefined();
        expect(Object.keys(c.init?.headers ?? {}).sort()).toEqual(['Authorization', 'Content-Length', 'TTL', 'Urgency']);
      }
    } finally {
      globalThis.fetch = real;
      await db.query(`DELETE FROM web_push_subscriptions WHERE endpoint LIKE 'https://push.example.invalid/zq41b%'`);
    }
  });

  it('T41b-X10: the suggester\'s prompt and rationales hold no gift row; a filed ordinary merchant is there; a pending suggestion on a row that later becomes a gift cannot be applied and says nothing about it', async () => {
    process.env.ANTHROPIC_API_KEY = 'zq41b-fake-key';
    try {
      const day = await pgDay(0);
      await db.query(
        `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, merchant_name, mapped_category) VALUES
           ('zq41b-x10-filed', $1, $2, 4.15, 'ZQ41BXFILED POS', 'ZQ41BXFILED Merchant', $3),
           ('zq41b-x10-ask', $1, $2, 4.07, 'ZQ41BXASK POS', 'ZQ41BXASK Merchant', NULL)`,
        [CARD, day, OTHER_CATEGORY]);
      anthropicFake.requests.length = 0;
      anthropicFake.script = () => ({ content: [{ type: 'text', text: '[]' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
      await suggestCategories(new Date());
      const prompt = JSON.stringify(anthropicFake.requests);
      expect(anthropicFake.requests.length).toBeGreaterThanOrEqual(1);
      expect(leaked(prompt)).toEqual([]);
      expect(holds(prompt, 'ZQ41BXASK')).toBe(true);
      const rationales = (await db.query(`SELECT rationale FROM agent_proposals WHERE rationale IS NOT NULL`)).rows.map((r) => r.rationale).join('\n');
      expect(leaked(rationales)).toEqual([]);
      // A suggestion made while the row was ordinary, then the row becomes a gift.
      const { view } = await createProposal({
        subjectId: s.ids.plain, proposed: { category: OTHER_CATEGORY }, observed: { category: null },
        rationale: null, proposedBy: null, now: new Date(), ttlMs: 3_600_000,
      });
      const g = await seedGift({ giver: s.w.two.userId, recipient: s.w.owner.userId, merchant: 'ZQ41BXPLAIN', windowStart: await pgDay(-1), windowEnd: await pgDay(1) });
      await db.query(`INSERT INTO gift_transactions (transaction_id, gift_id, prior_mapped_category, prior_rule_applied) VALUES ($1, $2, NULL, FALSE)`, [s.ids.plain, g]);
      const refused = await read(await decide(req(`/api/v1/agent/proposals/${view.id}/decide`, s.w.owner, { method: 'POST', body: { decision: 'confirmed' } }), params(view.id)));
      expect([refused.status, refused.body.error?.code]).toEqual([409, 'GIFT_LOCKED']);
      expect(holds(refused.text, 'ZQ41BXPLAIN')).toBe(false);
      expect((await db.query('SELECT mapped_category FROM transactions WHERE id = $1', [s.ids.plain])).rows[0].mapped_category).toBeNull();
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('T41b-X11: the recipient\'s rule counts and rule writes leave the held row out; the giver\'s page counts include it', async () => {
    const pageProps = async (viewer: number) => {
      rec.viewer = viewer;
      const element = await RulesPage();
      const found: Record<string, unknown>[] = [];
      const walk = (n: unknown) => {
        if (!n || typeof n !== 'object') return;
        const el = n as { props?: { rows?: unknown; children?: unknown } };
        if (el.props?.rows !== undefined) found.push(el.props as Record<string, unknown>);
        const kids = el.props?.children;
        (Array.isArray(kids) ? kids : [kids]).forEach(walk);
      };
      walk(element);
      return found[0] as { rows: { plaid_category: string; count: number }[]; merchantRules: { merchant_name: string; count: number }[] };
    };
    await db.query(`INSERT INTO category_rules (merchant_name, mapped_category) VALUES ('ZQ41BXGIFT Merchant', $1)`, [OTHER_CATEGORY]);
    const recipient = await pageProps(s.w.owner.userId);
    const giver = await pageProps(s.w.two.userId);
    const cat = (p: typeof recipient) => p.rows.find((r) => r.plaid_category === 'ZQ41BXGIFT_PRIMARY')?.count ?? 0;
    const merch = (p: typeof recipient) => p.merchantRules.find((r) => r.merchant_name === 'ZQ41BXGIFT Merchant')?.count ?? 0;
    expect([cat(recipient), merch(recipient)]).toEqual([0, 0]);
    expect([cat(giver), merch(giver)]).toEqual([1, 1]);
    // The rule itself names the merchant — rules are shared configuration; the ROWS must not.
    expect(leaked(JSON.stringify(recipient.rows))).toEqual([]);
    const written = await read(await postRule(req('/api/v1/rules', s.w.owner, { method: 'POST', body: { plaid_category: 'ZQ41BXGIFT_PRIMARY', mapped_category: OTHER_CATEGORY } })));
    expect(written.body.data).toEqual({ refiled: 0 });
    const applied = await read(await applyRules());
    expect(applied.status).toBe(200);
    expect((await db.query('SELECT mapped_category FROM transactions WHERE id = $1', [s.ids.gift])).rows[0].mapped_category).toBe(GIFT_CATEGORY);
  });

  it('T41b-X12: every write to a held row is refused to the recipient with one body, changes nothing and tombstones nothing; the giver may hide, note, watch and tag it but not re-file, delete or pair it; an ordinary row takes them all', async () => {
    const { w, ids } = s;
    await db.query('UPDATE accounts SET countable = TRUE WHERE id = $1', [MANUAL]);
    const snapshot = async (id: number) => JSON.stringify((await db.query('SELECT * FROM transactions WHERE id = $1', [id])).rows);
    const stale = (await createProposal({
      subjectId: ids.gift, proposed: { category: OTHER_CATEGORY }, observed: { category: GIFT_CATEGORY },
      rationale: null, proposedBy: null, now: new Date(), ttlMs: 3_600_000,
    })).view.id;
    const writes = (who: EnrolledUser, id: number, partner: number) => ({
      category: () => patchTxn(req(`/api/v1/transactions/${id}`, who, { method: 'PATCH', body: { mapped_category: OTHER_CATEGORY } }), params(id)),
      hidden: () => patchTxn(req(`/api/v1/transactions/${id}`, who, { method: 'PATCH', body: { hidden: true } }), params(id)),
      note: () => patchTxn(req(`/api/v1/transactions/${id}`, who, { method: 'PATCH', body: { note: 'zq41b note' } }), params(id)),
      watch: () => patchTxn(req(`/api/v1/transactions/${id}`, who, { method: 'PATCH', body: { watched: true } }), params(id)),
      property: () => patchTxn(req(`/api/v1/transactions/${id}`, who, { method: 'PATCH', body: { property_id: null } }), params(id)),
      bulk: () => bulk(req('/api/v1/transactions/bulk', who, { method: 'PATCH', body: { ids: [id], mapped_category: OTHER_CATEGORY } })),
      transfer: () => linkTransfer(req('/api/v1/transfers', who, { method: 'POST', body: { ids: [id, partner] } })),
      cash: () => cashTransfer(req('/api/v1/cash-transfers', who, { method: 'POST', body: { anchorTransactionId: id, toAccountId: MANUAL } })),
      delete: () => deleteTxn(req(`/api/v1/transactions/${id}`, who, { method: 'DELETE' }), params(id)),
    });
    const before = await snapshot(ids.gift);
    const bodies = new Set<string>();
    for (const [field, call] of Object.entries(writes(w.owner, ids.gift, ids.plain))) {
      const r = await read(await call());
      expect({ field, status: r.status }).toEqual({ field, status: 409 });
      bodies.add(r.text);
      expect(leaked(r.text)).toEqual([]);
    }
    const decided = await read(await decide(req(`/api/v1/agent/proposals/${stale}/decide`, w.owner, { method: 'POST', body: { decision: 'confirmed' } }), params(stale)));
    expect(decided.status).toBe(409);
    bodies.add(decided.text);
    expect(bodies.size).toBe(1);
    expect(await snapshot(ids.gift)).toBe(before);
    expect((await db.query(`SELECT COUNT(*)::int AS n FROM transaction_tombstones WHERE plaid_transaction_id LIKE 'zq41b%'`)).rows[0].n).toBe(0);

    // The giver.
    const giver = writes(w.two, ids.gift, ids.plain);
    for (const f of ['category', 'delete', 'transfer'] as const) {
      const r = await read(await giver[f]());
      expect({ f, status: r.status, code: r.body.error?.code }).toEqual({ f, status: 409, code: 'GIFT_LOCKED' });
    }
    for (const f of ['note', 'watch', 'hidden', 'property'] as const) {
      expect({ f, status: (await giver[f]()).status }).toEqual({ f, status: 200 });
    }
    const after = (await db.query('SELECT note, watched_at IS NOT NULL AS watched, hidden, mapped_category FROM transactions WHERE id = $1', [ids.gift])).rows[0];
    expect(after).toEqual({ note: 'zq41b note', watched: true, hidden: true, mapped_category: GIFT_CATEGORY });

    // Control: an ordinary row takes every one.
    const plain = writes(w.owner, ids.plain, ids.pair);
    for (const f of ['category', 'hidden', 'note', 'watch', 'property', 'bulk', 'transfer'] as const) {
      expect({ f, ok: (await plain[f]()).status < 300 }).toEqual({ f, ok: true });
    }
    const cashRow = await rowIdOf({ canary: 'ZQ41BXCANDA', amount: 0, date: '' });
    await chooseGift(req(`/api/v1/gifts/${s.gifts.choosing}/choose`, w.two, { method: 'POST', body: { transactionId: s.ids.candB } }), params(s.gifts.choosing));
    expect((await writes(w.owner, cashRow!, 0).cash()).status).toBe(201);
    expect((await plain.delete()).status).toBe(200);
  });

  it('T41b-X13: no log or output line from a matching sync, a choose, the sweep, the digest, a chat turn, a push or the suggester holds a canary or a gift criterion', async () => {
    const lines: string[] = [];
    const spies = [
      ...(['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); })),
      vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => { lines.push(String(c)); return true; }),
      vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => { lines.push(String(c)); return true; }),
    ];
    process.env.ANTHROPIC_API_KEY = 'zq41b-fake-key';
    try {
      await seedGift({ giver: s.w.two.userId, recipient: s.w.owner.userId, merchant: 'ZQ41BXLOGCRIT', windowStart: await pgDay(-2), windowEnd: await pgDay(2) });
      await syncAdded({ canary: 'ZQ41BXLOGCRIT', amount: 9.07, date: await pgDay(0) });
      await chooseGift(req(`/api/v1/gifts/${s.gifts.choosing}/choose`, s.w.two, { method: 'POST', body: { transactionId: s.ids.candA } }), params(s.gifts.choosing));
      await runGiftSweep();
      process.env.ALERTS_ENABLED = 'false';
      await runDailyDigest();
      delete process.env.ALERTS_ENABLED;
      anthropicFake.script = (_r, n) => n === 1
        ? { content: [{ type: 'tool_use', id: 't1', name: 'get_transactions', input: {} }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } }
        : { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
      anthropicFake.requests.length = 0;
      await chat(req('/api/v1/chat', s.w.owner, { method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } }));
      await sendWebPush('normal', s.w.two.userId);
      anthropicFake.script = () => ({ content: [{ type: 'text', text: '[]' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
      await suggestCategories(new Date());
    } finally {
      for (const sp of spies) sp.mockRestore();
      delete process.env.ANTHROPIC_API_KEY;
    }
    expect(lines.length).toBeGreaterThan(0);
    const all = lines.join('\n');
    expect(leaked(all)).toEqual([]);
    expect(holds(all, 'ZQ41BXLOGCRIT')).toBe(false);
    expect(holds(all, 'ZQ41BXPLAIN')).toBe(false);
  });

  it('T41b-X14: alternating giver and recipient on every text-bearing GET route in one process, each viewer gets their own first answer every time', async () => {
    const table = probes(s);
    for (const [file, probe] of Object.entries(table)) {
      const normal = (t: string) => t.replace(/"(hoursStale|daysOpen|lastSuccessfulUpdate|observedAt|expiresAt)":[^,}]*/g, '');
      const first = { giver: normal((await read(await probe.call(s.w.two))).text), recipient: normal((await read(await probe.call(s.w.owner))).text) };
      for (let i = 0; i < 2; i++) {
        expect({ file, i, same: normal((await read(await probe.call(s.w.two))).text) === first.giver }).toEqual({ file, i, same: true });
        expect({ file, i, same: normal((await read(await probe.call(s.w.owner))).text) === first.recipient }).toEqual({ file, i, same: true });
      }
      if (probe.giverSees === 'ZQ41BXGIFT') expect(first.giver === first.recipient).toBe(false);
    }
  });

  it('T41b-X15: a monthly series of gifts with one merchant is in no upcoming-recurring list, outlook recurrence or stored forecast for any viewer, while an ordinary series is', async () => {
    await db.query(`UPDATE accounts SET type = 'depository', overdraft_watch = TRUE, overdraft_cushion = 900 WHERE id = $1`, [CARD_TWO]);
    for (const back of [88, 58, 28]) {
      const day = await pgDay(-back);
      await seedGift({ giver: s.w.two.userId, recipient: s.w.owner.userId, merchant: 'ZQ41BXSERIES', amount: '11.15', account: CARD_TWO, windowStart: day, windowEnd: day });
      await syncAdded(
        { canary: 'ZQ41BXSERIES', id: `zq41b-series-${back}`, amount: 11.15, date: day, account: CARD_TWO },
        { canary: 'ZQ41BXCONTROL', id: `zq41b-control-${back}`, amount: 12.07, date: day, account: CARD_TWO },
      );
      await db.query(`UPDATE transactions SET mapped_category = $1 WHERE plaid_transaction_id = $2`, [OTHER_CATEGORY, `zq41b-control-${back}`]);
    }
    expect(Number((await db.query(`SELECT COUNT(*) FROM gift_transactions gt JOIN transactions t ON t.id = gt.transaction_id WHERE t.plaid_transaction_id LIKE 'zq41b-series-%'`)).rows[0].count)).toBe(3);
    const upcoming = JSON.stringify(await detectUpcomingRecurring(50));
    expect(holds(upcoming, 'ZQ41BXCONTROL')).toBe(true);
    expect(holds(upcoming, 'ZQ41BXSERIES')).toBe(false);
    expect(holds(upcoming, 'Gift')).toBe(false);
    const outlook = JSON.stringify(await loadMonthOutlook(asOfFromDate(new Date())));
    expect(holds(outlook, 'ZQ41BXSERIES')).toBe(false);
    // Above the cushion today, below it once the next instalment lands: a forecast, not an episode.
    await checkOverdraft([{ accountId: CARD_TWO, current: 905, available: 905 }]);
    const charges = JSON.stringify((await db.query(`SELECT charges FROM overdraft_forecasts WHERE account_id = $1`, [CARD_TWO])).rows);
    expect(holds(charges, 'ZQ41BXCONTROL')).toBe(true);
    expect(holds(charges, 'ZQ41BXSERIES')).toBe(false);
  });
});
