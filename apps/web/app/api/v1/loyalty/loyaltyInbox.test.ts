// P8-42c1 — the loyalty inbox through the real handlers against a real Postgres (I1–I12): the poll
// over the whole pinned fixture set, idempotency, the lock, failures, attribution and
// re-attribution, retention, forwarding health, coverage, privacy, the editors, ledger neutrality,
// the real adapter's connection path and the stored shapes.
//
// TIER 2, collected by `vitest.integration.config.mts` with the scratch-database guard in its setup
// files, like `loyaltyEarn.test.ts` beside it. People sign in through the real passkey path
// (`../auth/secondUserTestKit.ts`); bearer tokens are minted with `createPersonalToken`. Every
// handler is called directly with a `NextRequest`.
//
// THE MAILBOX IS A STRICT FAKE. `createMailSource` in `@/lib/loyaltyInboxSource` is mocked: each
// test installs a fake built from the pinned `.eml` fixtures, a Proxy that throws on any property
// but `list`, `fetch` and `close`, so a write to the mailbox cannot be written without a test
// failing. With no fake installed the mock THROWS rather than build the real adapter, so no test can
// open a socket to a configured host by accident; only T42c1-I11 asks for the real adapter, aimed at
// a loopback port that was bound and closed a moment before.
//
// THE FIXTURES ARE PINNED. `lib/fixtures/loyalty-inbox/` (27 `.eml` and `cases.json`) is fabricated
// and pinned by a SHA-256 in the spec's command 16. Its `{{DAY:-n}}` tokens become RFC 2822 dates
// Postgres computes, and each envelope's received time is noon UTC of a Postgres date, so every
// boundary is placed by a DATE value and never by a JS clock. Each case group is walked into `seen`
// and compared with the group's own ids.
//
// THE ENVIRONMENT. Each test sets the seven LOYALTY_IMAP_ variables itself (host a `.test` name or
// 127.0.0.1, the canary user and password of `cases.json`) and restores the previous environment
// afterwards. Every console line of the whole file is captured, for the privacy checks.
//
// CLEANUP IS OF THIS SUITE'S OWN ROWS: programs and members named `ZQ42C …` (their domains and
// addresses), every inbox message and unknown row (only this suite writes them), the state row
// reset to never-polled, and the auth tables through `resetAuth`.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:net';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { createPersonalToken } from '@/lib/authSession';
import { computeCurrentNetWorth } from '@/lib/netWorth';
import { ROUTES } from '@/lib/giftSurfaceRegistry';
import { runDailyJob } from '@/lib/scheduler';
import { pollLoyaltyInbox, purgeExpiredInbox, runLoyaltyInboxDaily } from '@/lib/loyaltyInbox';
import { analyseMessage, messageIdKey, outerFromAddress } from '@/lib/domain/loyaltyInbox';
import type { MailEnvelope, MailSource } from '@/lib/loyaltyInboxSource';
import TravelBoard from '@/components/TravelBoard';
import {
  LoyaltyInboxPollResponseSchema,
  LoyaltyInboxSchema,
  LoyaltyOverviewResponseSchema,
  LOYALTY_INBOX_MAX_BYTES,
  type LoyaltyInbox,
  type LoyaltyInboxPoll,
  type LoyaltyOverview,
} from '@b8/contracts/loyalty';
import { bearer, bootstrapOwner, cookie, enrolSecondUser, resetAuth, type EnrolledUser } from '../auth/secondUserTestKit';
import { GET as overviewGET } from './route';
import { PATCH as memberPATCH } from './members/[id]/route';
import { PATCH as programPATCH } from './programs/[id]/route';
import { POST as pollPOST } from './inbox/poll/route';
import { GET as ledgerOverviewGET } from '../overview/route';

// ─── Mocks ─────────────────────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  /** The fake the next `createMailSource` call returns; `'real'` builds the real adapter. */
  source: null as null | 'real' | (() => unknown),
  order: [] as string[],
}));

vi.mock('@/lib/loyaltyInboxSource', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/loyaltyInboxSource')>();
  return {
    ...real,
    createMailSource: vi.fn((env: Record<string, string | undefined>) => {
      if (H.source === 'real') return real.createMailSource(env);
      if (H.source === null) throw new Error('no fake mail source installed for this test');
      return H.source();
    }),
  };
});
// The daily job's other steps, so `runDailyJob` runs the real inbox step and nothing that needs Plaid,
// mail or push. Partial: each module keeps every other export real.
vi.mock('@/lib/sync', async (o) => ({ ...(await o<object>()), runSync: vi.fn(async () => { H.order.push('sync'); return {}; }) }));
vi.mock('@/lib/dailyDigest', async (o) => ({ ...(await o<object>()), runDailyDigest: vi.fn(async () => { H.order.push('digest'); return false; }) }));
vi.mock('@/lib/webPush', async (o) => ({ ...(await o<object>()), sendWebPushIfDelivered: vi.fn(async () => {}) }));
vi.mock('@/lib/categorySuggester', async (o) => ({ ...(await o<object>()), suggestCategories: vi.fn(async () => {}) }));
vi.mock('@/lib/receiptCaptureStore', async (o) => ({ ...(await o<object>()), watchReceipts: vi.fn(async () => {}) }));
vi.mock('@/lib/unspentStore', async (o) => ({ ...(await o<object>()), recordCloses: vi.fn(async () => {}) }));
vi.mock('@/lib/yearEndSnapshots', async (o) => ({ ...(await o<object>()), writeYearEndSnapshot: vi.fn(async () => {}) }));
vi.mock('@/lib/netWorth', async (o) => ({ ...(await o<object>()), writeNetWorthSnapshot: vi.fn(async () => {}) }));
vi.mock('@/lib/giftStore', async (o) => ({ ...(await o<object>()), runGiftSweep: vi.fn(async () => {}) }));
vi.mock('@/lib/loyaltyInbox', async (o) => {
  const real = await o<typeof import('@/lib/loyaltyInbox')>();
  return { ...real, runLoyaltyInboxDaily: vi.fn(async () => { H.order.push('inbox'); return real.runLoyaltyInboxDaily(); }) };
});
// The board is a client component; rendered to a string here it needs a router.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

// ─── The fixture ───────────────────────────────────────────────────────────────────────────────

const DIR = fileURLToPath(new URL('../../../../lib/fixtures/loyalty-inbox/', import.meta.url));
const WEB = fileURLToPath(new URL('../../../../', import.meta.url));
interface Expect { outcome: string; domain?: string; program?: 'brand' | 'air'; origin?: string; attribution?: string; member?: 'A' | 'B'; of?: string }
const C = JSON.parse(readFileSync(join(DIR, 'cases.json'), 'utf8')) as {
  people: { A: string; B: string; stranger: string; inbox: string };
  programs: { brand: { name: string; domain: string }; air: { name: string; domain: string } };
  messages: { id: string; file: string; day: number; expect: Expect }[];
  totals: {
    fetched: number; stored: number; duplicates: number; expired: number; unknown: number; oversize: number;
    unknownByDomain: Record<string, number>; storedByProgram: Record<string, number>; storedByAttribution: Record<string, number>;
    unattributed: number; downloaded: string[];
    after: { brand: { lastSeenDay: number; storedInWindow: number }; air: { lastSeenDay: number; storedInWindow: number }; A: { lastReceivedDay: number }; B: { lastReceivedDay: number } };
  };
  canaries: { body: string; subject: string; memberNumber: string; password: string; user: string };
  domainAccept: { input: string; stored: string }[]; domainRefuse: string[];
  addressAccept: { input: string; stored: string }[]; addressRefuse: string[];
  envMatrix: { name: string; env: Record<string, string>; expect: { configured: boolean; problem: string | null; missing: string[] } }[];
  health: { name: string; lastReceivedDaysAgo: number | null; addedDaysAgo: number | null; unattributedMailDaysAgo?: number; expect: { state: string; quietDays?: number | null } }[];
  retention: { daysAgo: number; kept: boolean }[];
};
const ALL_IDS = C.messages.map((m) => m.id);
const HOST = 'zq42c-imap.test';
const SECRETS = [C.canaries.body, C.canaries.subject, C.canaries.memberNumber, C.canaries.password, C.canaries.user, HOST];

/** An RFC 2822 date at noon UTC, `n` days from CURRENT_DATE, from Postgres. */
const rfcDay = async (n: number) =>
  (await db.query<{ d: string }>(`SELECT to_char(CURRENT_DATE + $1::int, 'Dy, DD Mon YYYY') || ' 12:00:00 +0000' AS d`, [n])).rows[0].d;
const pgDay = async (n = 0) => (await db.query<{ d: string }>('SELECT (CURRENT_DATE + $1::int)::text AS d', [n])).rows[0].d;
/** The ISO received time of noon UTC, `n` days from CURRENT_DATE: its UTC date is that day. */
const isoDay = async (n: number) => `${await pgDay(n)}T12:00:00.000Z`;

interface Mail { id: string; raw: Buffer; envelope: MailEnvelope }

/** A fixture message with its date tokens replaced, and the envelope a mailbox would list for it. */
async function fixture(id: string): Promise<Mail> {
  const m = C.messages.find((x) => x.id === id) as (typeof C.messages)[number];
  let text = readFileSync(join(DIR, m.file), 'utf8');
  for (const t of new Set(text.match(/\{\{DAY:-[0-9]+\}\}/g) ?? [])) text = text.split(t).join(await rfcDay(-Number(t.slice(7, -2))));
  return mail(id, Buffer.from(text, 'utf8'), m.day);
}
async function mail(id: string, raw: Buffer, day: number, over: Partial<MailEnvelope> = {}): Promise<Mail> {
  const mid = /^Message-ID:\s*(.+)$/im.exec(raw.toString('utf8').split(/\r?\n\r?\n/)[0]);
  return {
    id, raw,
    envelope: { id, messageId: mid ? mid[1].trim() : null, fromAddress: 'fromAddress' in over ? (over.fromAddress as string | null) : await outerFromAddress(raw),
      receivedAt: await isoDay(day), size: raw.length, ...over },
  };
}
const allFixtures = async () => Promise.all(ALL_IDS.map(fixture));

/** A generated message (not a fixture): fabricated, canary-carrying, from the brand unless told. */
async function generated(id: string, day: number, headers: string, over: Partial<MailEnvelope> = {}): Promise<Mail> {
  const raw = Buffer.from(`Message-ID: <zq42c-${id}@zq42c-brand.test>\n${headers}\nSubject: ${C.canaries.subject} ${id}\nDate: ${await rfcDay(day)}\n\n${C.canaries.body} ${id}\n`);
  return mail(id, raw, day, over);
}

// ─── The strict fake ───────────────────────────────────────────────────────────────────────────

interface Fake { calls: string[]; fetched: string[] }
const fakes: Fake[] = [];

/**
 * A mail source over `mails`, listed in the given order whatever `since` says. `list` may wait on a
 * gate, reject, or never settle. Any property but the three operations throws.
 */
function install(mails: Mail[], opts: { gate?: Promise<void>; listed?: () => void; fail?: unknown; stall?: boolean; closeHangs?: boolean } = {}): Fake {
  const fake: Fake = { calls: [], fetched: [] };
  fakes.push(fake);
  H.source = () => {
    const impl: MailSource = {
      async list() {
        fake.calls.push('list');
        opts.listed?.();
        if (opts.gate) await opts.gate;
        if (opts.stall) await new Promise(() => {});
        if (opts.fail !== undefined) throw opts.fail;
        return mails.map((m) => ({ ...m.envelope }));
      },
      async fetch(id: string) {
        fake.calls.push('fetch');
        fake.fetched.push(id);
        const m = mails.find((x) => x.id === id);
        if (!m) throw new Error('not listed');
        return Buffer.from(m.raw);
      },
      async close() {
        fake.calls.push('close');
        if (opts.closeHangs) await new Promise(() => {});
      },
    };
    return new Proxy(impl, {
      get(target, prop) {
        if (prop === 'list' || prop === 'fetch' || prop === 'close') return target[prop];
        if (prop === 'then') return undefined;
        throw new Error(`the mail source has no ${String(prop)}`);
      },
    });
  };
  return fake;
}

// ─── Requests ──────────────────────────────────────────────────────────────────────────────────

const ORIGIN = 'http://localhost:3000';
type Who = EnrolledUser | { bearer: string } | null;
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
function req(path: string, who: Who, init: { method?: string; body?: unknown } = {}): NextRequest {
  const auth = who === null ? {} : 'bearer' in who ? bearer(who.bearer) : cookie(who.token);
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? 'GET',
    headers: { host: 'localhost:3000', 'content-type': 'application/json', ...auth },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
interface Answer { status: number; text: string; body: { success?: boolean; data?: unknown; error?: { code: string; message: string } } }
const bodies: string[] = [];
async function read(response: Response | Promise<Response>): Promise<Answer> {
  const res = await response;
  const text = await res.text();
  bodies.push(text);
  let body: Answer['body'] = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, text, body };
}
const api = {
  overview: (who: Who) => read(overviewGET(req('/api/v1/loyalty', who))),
  patchMember: (who: Who, id: number, body: unknown) => read(memberPATCH(req(`/api/v1/loyalty/members/${id}`, who, { method: 'PATCH', body }), ctx(id))),
  patchProgram: (who: Who, id: number, body: unknown) => read(programPATCH(req(`/api/v1/loyalty/programs/${id}`, who, { method: 'PATCH', body }), ctx(id))),
  poll: (who: Who) => read(pollPOST(req('/api/v1/loyalty/inbox/poll', who, { method: 'POST' }))),
};
async function inboxOf(who: Who): Promise<LoyaltyInbox> {
  const r = await api.overview(who);
  expect(r.status).toBe(200);
  expect(LoyaltyOverviewResponseSchema.safeParse(r.body).success).toBe(true);
  return (r.body.data as LoyaltyOverview).inbox;
}
async function polled(who: Who = owner): Promise<LoyaltyInboxPoll> {
  const r = await api.poll(who);
  expect(r.status).toBe(200);
  expect(LoyaltyInboxPollResponseSchema.safeParse(r.body).success).toBe(true);
  return r.body.data as LoyaltyInboxPoll;
}

// ─── The world ─────────────────────────────────────────────────────────────────────────────────

const ENV_NAMES = ['LOYALTY_IMAP_HOST', 'LOYALTY_IMAP_PORT', 'LOYALTY_IMAP_TLS', 'LOYALTY_IMAP_USER', 'LOYALTY_IMAP_PASSWORD', 'LOYALTY_IMAP_MAILBOX', 'LOYALTY_IMAP_TIMEOUT_SECONDS'];
let savedEnv: Record<string, string | undefined> = {};
function setEnv(values: Record<string, string>): void {
  for (const n of ENV_NAMES) delete process.env[n];
  Object.assign(process.env, values);
}
const READY = () => ({
  LOYALTY_IMAP_HOST: HOST, LOYALTY_IMAP_PORT: '993', LOYALTY_IMAP_TLS: 'true',
  LOYALTY_IMAP_USER: C.canaries.user, LOYALTY_IMAP_PASSWORD: C.canaries.password, LOYALTY_IMAP_TIMEOUT_SECONDS: '10',
});

async function clearWorld(): Promise<void> {
  await db.query('DELETE FROM loyalty_inbox_messages');
  await db.query('DELETE FROM loyalty_inbox_unknown_senders');
  await db.query(`DELETE FROM household_member_addresses WHERE member_id IN (SELECT id FROM household_members WHERE display_name LIKE 'ZQ42C%')`);
  await db.query(`DELETE FROM loyalty_sender_domains WHERE program_id IN (SELECT id FROM loyalty_programs WHERE name LIKE 'ZQ42C%')`);
  await db.query(`DELETE FROM loyalty_programs WHERE name LIKE 'ZQ42C%'`);
  await db.query(`DELETE FROM household_members WHERE display_name LIKE 'ZQ42C%'`);
  await db.query('UPDATE loyalty_inbox_state SET last_polled_on = NULL, last_outcome = NULL, last_error_code = NULL WHERE id = 1');
}

interface World { brand: number; air: number; A: number; B: number }
/** The two programs with their domains, and the two members with their addresses. */
async function world(): Promise<World> {
  const program = async (name: string, domain: string) => {
    const id = (await db.query<{ id: number }>(`INSERT INTO loyalty_programs (name, kind, default_unit) VALUES ($1, 'hotel', 'points') RETURNING id`, [name])).rows[0].id;
    await db.query('INSERT INTO loyalty_sender_domains (program_id, domain) VALUES ($1, $2)', [id, domain]);
    return id;
  };
  const member = async (name: string, address: string) => {
    const id = (await db.query<{ id: number }>('INSERT INTO household_members (display_name) VALUES ($1) RETURNING id', [name])).rows[0].id;
    await db.query('INSERT INTO household_member_addresses (member_id, address) VALUES ($1, $2)', [id, address]);
    return id;
  };
  return {
    brand: await program(C.programs.brand.name, C.programs.brand.domain),
    air: await program(C.programs.air.name, C.programs.air.domain),
    A: await member('ZQ42C Anna', C.people.A),
    B: await member('ZQ42C Boris', C.people.B),
  };
}

const count = async (sql: string, values: unknown[] = []) => Number((await db.query<{ n: string }>(sql, values)).rows[0].n);
const keyOf = (m: Mail) => messageIdKey(m.envelope.messageId);
const stateRow = async () => (await db.query('SELECT last_polled_on::text AS on, last_outcome, last_error_code FROM loyalty_inbox_state WHERE id = 1')).rows[0];
async function sqlState(sql: string, values: unknown[] = []): Promise<string> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql, values);
    return 'accepted';
  } catch (err) {
    return (err as { code?: string }).code ?? 'unknown';
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}
const sumOf = async (tables: string[]) => (await db.query<{ s: string }>(`SELECT md5(${tables
  .map((t) => `coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM ${t} x), '')`).join(' || ')}) AS s`)).rows[0].s;
const LEDGER = ['accounts', 'transactions', 'budget_categories', 'transfer_groups'];
const LOYALTY = ['loyalty_programs', 'household_members', 'loyalty_memberships', 'loyalty_observations', 'loyalty_instruments', 'loyalty_earn_rules'];

/** Every console line of the file, for the privacy checks. */
const lines: string[] = [];
let owner: EnrolledUser;
let two: EnrolledUser;
let readTok: { bearer: string };

beforeAll(async () => {
  const capture = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  for (const m of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(capture);
  savedEnv = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
  await clearWorld();
  await resetAuth();
  owner = await bootstrapOwner();
  two = await enrolSecondUser(owner.token);
  readTok = { bearer: (await createPersonalToken({ label: 'zq42c read', scope: 'read', userId: owner.userId })).token };
}, 60_000);

beforeEach(async () => {
  H.source = null;
  H.order.length = 0;
  setEnv(READY());
  await clearWorld();
});

afterEach(async () => {
  H.source = null;
  await clearWorld();
});

afterAll(async () => {
  await clearWorld();
  await resetAuth();
  for (const n of ENV_NAMES) {
    if (savedEnv[n] === undefined) delete process.env[n];
    else process.env[n] = savedEnv[n];
  }
  vi.restoreAllMocks();
  // The strict fake saw nothing but its three operations in any test.
  for (const f of fakes) expect(f.calls.every((c) => c === 'list' || c === 'fetch' || c === 'close')).toBe(true);
});

/** The fixture world, polled once over every fixture. */
async function fullPoll(): Promise<{ w: World; mails: Mail[]; fake: Fake; result: LoyaltyInboxPoll }> {
  const w = await world();
  const mails = await allFixtures();
  const fake = install(mails);
  const result = await polled();
  return { w, mails, fake, result };
}

describe('loyalty inbox (P8-42c1)', () => {
  it('T42c1-I1: an unset or incomplete environment disables the poller without error, and the daily job runs the step between the syncs and the digest', async () => {
    const seen: string[] = [];
    for (const row of C.envMatrix) {
      setEnv(row.env);
      const inbox = await inboxOf(owner);
      expect({ configured: inbox.configured, problem: inbox.problem, missing: inbox.missing }, row.name)
        .toEqual({ configured: row.expect.configured, problem: row.expect.problem, missing: row.expect.missing });
      seen.push(row.name);
    }
    expect(seen).toEqual(C.envMatrix.map((r) => r.name));

    for (const env of [{}, { LOYALTY_IMAP_PASSWORD: C.canaries.password }] as Record<string, string>[]) {
      setEnv(env);
      const fake = install([]);
      const before = JSON.stringify(await stateRow());
      expect(await polled()).toEqual({ outcome: 'disabled', fetched: 0, stored: 0, duplicates: 0, unknown: 0, expired: 0, oversize: 0, errorCode: null });
      expect(fake.calls).toEqual([]);
      expect(JSON.stringify(await stateRow())).toBe(before);
      expect(await count('SELECT (SELECT count(*) FROM loyalty_inbox_messages) + (SELECT count(*) FROM loyalty_inbox_unknown_senders) AS n')).toBe(0);
    }

    // The daily job with the environment unset: resolves, the step ran once, nothing was written.
    setEnv({});
    const state = JSON.stringify(await stateRow());
    await expect(runDailyJob()).resolves.toBeUndefined();
    expect(H.order).toEqual(['sync', 'sync', 'inbox', 'digest']);
    expect(vi.mocked(runLoyaltyInboxDaily)).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await stateRow())).toBe(state);

    // Configured, with a source that rejects with text holding the password canary: still resolves,
    // and the digest still runs after the inbox step.
    setEnv(READY());
    H.order.length = 0;
    install([], { fail: new Error(`login refused for ${C.canaries.user} with ${C.canaries.password}`) });
    await expect(runDailyJob()).resolves.toBeUndefined();
    expect(H.order).toEqual(['sync', 'sync', 'inbox', 'digest']);
    expect((await stateRow()).last_outcome).toBe('error');
    for (const l of [...lines, ...bodies]) expect(l.includes(C.canaries.password), l.slice(0, 120)).toBe(false);
  });

  it('T42c1-I2: over the whole fixture set the allowlist keeps exactly the expected mail, downloads only what it may, and records it as the table says', async () => {
    const { w, mails, fake, result } = await fullPoll();
    const T = C.totals;
    expect(result).toEqual({ outcome: 'ok', fetched: T.fetched, stored: T.stored, duplicates: T.duplicates, unknown: T.unknown, expired: T.expired, oversize: T.oversize, errorCode: null });
    expect([...fake.fetched].sort()).toEqual([...T.downloaded].sort());

    const memberOf = { A: w.A, B: w.B } as const;
    const programOf = { brand: w.brand, air: w.air } as const;
    const seen: string[] = [];
    for (const m of C.messages) {
      const mailOf = mails.find((x) => x.id === m.id) as Mail;
      const key = keyOf(mailOf);
      const row = key === null ? undefined : (await db.query(
        'SELECT program_id, sender_domain, origin, attribution, member_id, oversize FROM loyalty_inbox_messages WHERE dedupe_key = $1', [key])).rows[0];
      const unknown = key === null ? undefined : (await db.query('SELECT domain FROM loyalty_inbox_unknown_senders WHERE dedupe_key = $1', [key])).rows[0];
      if (m.expect.outcome === 'stored') {
        if (key !== null) {
          expect(row, m.id).toMatchObject({
            program_id: programOf[m.expect.program as 'brand' | 'air'], origin: m.expect.origin, attribution: m.expect.attribution,
            member_id: m.expect.member ? memberOf[m.expect.member] : null, oversize: false,
          });
          expect(String(row?.sender_domain).endsWith(C.programs[m.expect.program as 'brand' | 'air'].domain), m.id).toBe(true);
        } else {
          // F16 has no Message-ID: its key is the bytes'.
          expect(await count(`SELECT count(*) AS n FROM loyalty_inbox_messages WHERE origin = 'direct' AND attribution = 'matched' AND member_id = $1 AND received_on = $2::date`,
            [w.A, await pgDay(m.day)])).toBe(1);
        }
      } else if (m.expect.outcome === 'unknown') {
        expect(row, m.id).toBeUndefined();
        expect(unknown?.domain, m.id).toBe(m.expect.domain);
      } else if (m.expect.outcome === 'duplicate') {
        expect(key).toBe(keyOf(mails.find((x) => x.id === m.expect.of) as Mail));
      } else {
        expect(m.expect.outcome).toBe('expired');
        expect(row, m.id).toBeUndefined();
        expect(unknown, m.id).toBeUndefined();
      }
      seen.push(m.id);
    }
    expect(seen).toEqual(ALL_IDS);

    const byDomain = Object.fromEntries((await db.query<{ domain: string; n: number }>('SELECT domain, count(*)::int AS n FROM loyalty_inbox_unknown_senders GROUP BY domain')).rows.map((r) => [r.domain, r.n]));
    expect(byDomain).toEqual(T.unknownByDomain);
    expect(await count('SELECT count(*) AS n FROM loyalty_inbox_messages WHERE program_id = $1', [w.brand])).toBe(T.storedByProgram.brand);
    expect(await count('SELECT count(*) AS n FROM loyalty_inbox_messages WHERE program_id = $1', [w.air])).toBe(T.storedByProgram.air);
    const byAttribution = (await db.query<{ k: string; n: number }>(
      `SELECT CASE WHEN member_id = $1 THEN 'matchedA' WHEN member_id = $2 THEN 'matchedB' ELSE attribution END AS k, count(*)::int AS n
         FROM loyalty_inbox_messages GROUP BY 1`, [w.A, w.B])).rows;
    expect(Object.fromEntries(byAttribution.map((r) => [r.k, r.n]))).toEqual(T.storedByAttribution);
    expect((await inboxOf(owner)).unattributed).toBe(T.unattributed);

    // F01's stored bytes are the file's after token replacement (F17's duplicate did not replace them).
    const f01 = mails.find((x) => x.id === 'F01') as Mail;
    const raw = (await db.query<{ raw: Buffer }>('SELECT raw_mail AS raw FROM loyalty_inbox_messages WHERE dedupe_key = $1', [keyOf(f01)])).rows[0].raw;
    expect(raw.equals(f01.raw)).toBe(true);

    // One byte over the cap: recorded without bytes and never fetched. A From holding markup: unreadable.
    const big = await generated('big', -1, `From: statements@${C.programs.brand.domain}`, { size: LOYALTY_INBOX_MAX_BYTES + 1 });
    const markup = await generated('markup', -1, 'From: a@<b>zq42c</b>.test', { fromAddress: 'a@<b>zq42c</b>.test' });
    // A server that reports no size: an unknown size is not 0. The fake returns every byte (the real
    // adapter would stop one byte over the cap), and the poller keeps none of them.
    const unsizedRaw = Buffer.concat([
      Buffer.from(`Message-ID: <zq42c-unsized@zq42c-brand.test>\nFrom: statements@${C.programs.brand.domain}\nSubject: ${C.canaries.subject} unsized\nDate: ${await rfcDay(-1)}\n\n`),
      Buffer.alloc(LOYALTY_INBOX_MAX_BYTES + 1, 'z'),
    ]);
    const unsized = await mail('unsized', unsizedRaw, -1, { size: null, fromAddress: `statements@${C.programs.brand.domain}` });
    const second = install([big, markup, unsized]);
    expect(await polled()).toEqual({ outcome: 'ok', fetched: 3, stored: 2, duplicates: 0, unknown: 1, expired: 0, oversize: 2, errorCode: null });
    expect(second.fetched).toEqual(['unsized']);
    expect((await db.query('SELECT raw_mail, oversize, origin, attribution, member_id FROM loyalty_inbox_messages WHERE dedupe_key = $1', [keyOf(unsized)])).rows[0])
      .toEqual({ raw_mail: null, oversize: true, origin: 'direct', attribution: 'none_found', member_id: null });
    // Its key is the Message-ID's, so a re-poll finds it again without keeping a byte.
    install([unsized]);
    expect(await polled()).toMatchObject({ stored: 0, duplicates: 1, oversize: 0 });
    expect((await db.query('SELECT raw_mail, oversize, origin, attribution, member_id FROM loyalty_inbox_messages WHERE dedupe_key = $1', [keyOf(big)])).rows[0])
      .toEqual({ raw_mail: null, oversize: true, origin: 'direct', attribution: 'none_found', member_id: null });
    expect((await db.query('SELECT domain FROM loyalty_inbox_unknown_senders WHERE dedupe_key = $1', [keyOf(markup)])).rows[0].domain).toBe('(unreadable)');
  });

  it('T42c1-I3: a re-poll stores and counts nothing again, two polls never overlap, and every failure is a classified code that frees the lock', async () => {
    const { mails, result } = await fullPoll();
    expect(result.stored).toBe(C.totals.stored);
    const rows = await count('SELECT (SELECT count(*) FROM loyalty_inbox_messages) * 1000 + (SELECT count(*) FROM loyalty_inbox_unknown_senders) AS n');
    const again = install(mails);
    expect(await polled()).toEqual({ outcome: 'ok', fetched: 27, stored: 0, duplicates: 26, unknown: 0, expired: 1, oversize: 0, errorCode: null });
    // Every listed key was known before any download. F16 alone carries no Message-ID, so its key
    // is its bytes' and it is the one message a re-poll must fetch to recognise (SPEC.md conflict,
    // reported in EVIDENCE.md); nothing is stored or counted from it.
    expect(again.fetched).toEqual(['F16']);
    expect(await count('SELECT (SELECT count(*) FROM loyalty_inbox_messages) * 1000 + (SELECT count(*) FROM loyalty_inbox_unknown_senders) AS n')).toBe(rows);
    const f01 = mails.find((x) => x.id === 'F01') as Mail;
    expect((await db.query<{ raw: Buffer }>('SELECT raw_mail AS raw FROM loyalty_inbox_messages WHERE dedupe_key = $1', [keyOf(f01)])).rows[0].raw.equals(f01.raw)).toBe(true);

    // Two overlapping polls: the second is already_running while the first is held on its list.
    await db.query('DELETE FROM loyalty_inbox_messages');
    await db.query('DELETE FROM loyalty_inbox_unknown_senders');
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    let listed!: () => void;
    const listing = new Promise<void>((r) => { listed = r; });
    install(mails, { gate, listed });
    const first = api.poll(owner);
    await listing;
    const second = await polled(two);
    expect(second).toEqual({ outcome: 'already_running', fetched: 0, stored: 0, duplicates: 0, unknown: 0, expired: 0, oversize: 0, errorCode: null });
    open();
    expect(((await first).body.data as LoyaltyInboxPoll).stored).toBe(C.totals.stored);
    install(mails);
    expect((await polled()).stored).toBe(0);
    expect(await count('SELECT count(*) AS n FROM loyalty_inbox_messages')).toBe(C.totals.stored);

    // Failures: each a code, the state recorded, the lock freed, no text of the error anywhere.
    const leak = `${C.canaries.password} ${C.canaries.body}`;
    const failures: [string, unknown, Record<string, string>?][] = [
      ['auth_failed', Object.assign(new Error(`AUTHENTICATIONFAILED ${leak}`), { authenticationFailed: true })],
      ['tls_failed', Object.assign(new Error(`certificate rejected ${leak}`), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' })],
      ['connect_failed', Object.assign(new Error(`connect refused ${leak}`), { code: 'ECONNREFUSED' })],
      ['timeout', 'stall', { LOYALTY_IMAP_TIMEOUT_SECONDS: '1' }],
    ];
    const seenCodes: string[] = [];
    for (const [code, fail, env] of failures) {
      setEnv({ ...READY(), ...(env ?? {}) });
      install(mails, fail === 'stall' ? { stall: true } : { fail });
      const r = await api.poll(owner);
      expect(r.body.data, code).toMatchObject({ outcome: 'error', errorCode: code });
      expect(r.text.includes(C.canaries.password) || r.text.includes(C.canaries.body)).toBe(false);
      expect(await stateRow()).toMatchObject({ last_outcome: 'error', last_error_code: code });
      install([]);
      expect((await polled()).outcome, `${code}: the lock was released`).toBe('ok');
      seenCodes.push(code);
    }
    expect(seenCodes).toEqual(['auth_failed', 'tls_failed', 'connect_failed', 'timeout']);

    // A close that never settles (a server that never completes LOGOUT), after a stalled list: the
    // poll still resolves as a timeout, and the lock is free for the next one.
    setEnv({ ...READY(), LOYALTY_IMAP_TIMEOUT_SECONDS: '1' });
    const hung = install([], { stall: true, closeHangs: true });
    expect(await polled()).toMatchObject({ outcome: 'error', errorCode: 'timeout' });
    expect(hung.calls).toEqual(['list', 'close']);
    setEnv(READY());
    install([]);
    expect((await polled()).outcome, 'a hanging close released the lock').toBe('ok');

    // Messages the parser refuses never abort the poll. Built here, fabricated: an allowlisted sender
    // with more parts than mailparser accepts, and a member's forward whose attached original is
    // that same kind of message. Each is counted unreadable under its key; the message listed after
    // them is still stored; a re-poll downloads none of them.
    const brand = C.programs.brand.domain;
    const parts = (tag: string) => Array.from({ length: 1001 }, (_, i) => `--zq42c-inner\nContent-Type: text/plain\n\n${C.canaries.body} ${tag} ${i}`).join('\n');
    const original = (tag: string, day: string) => `Message-ID: <zq42c-${tag}@${brand}>\nFrom: statements@${brand}\nSubject: ${C.canaries.subject} ${tag}\nDate: ${day}\n` +
      `MIME-Version: 1.0\nContent-Type: multipart/mixed; boundary=zq42c-inner\n\n${parts(tag)}\n--zq42c-inner--\n`;
    const poison = await mail('poison', Buffer.from(original('poison', await rfcDay(-2))), -2, { fromAddress: `statements@${brand}` });
    const fwdRaw = Buffer.from(`Message-ID: <zq42c-poison-fwd@example.com>\nFrom: ${C.people.A}\nTo: ${C.people.inbox}\nSubject: ${C.canaries.subject} fwd\n` +
      `Date: ${await rfcDay(-2)}\nMIME-Version: 1.0\nContent-Type: multipart/mixed; boundary="zq42c.outer.b"\n\n` +
      `--zq42c.outer.b\nContent-Type: text/plain\n\n${C.canaries.body} fwd\n--zq42c.outer.b\nContent-Type: message/rfc822\n\n` +
      `${original('poison-inner', await rfcDay(-3))}\n--zq42c.outer.b--\n`);
    const fwd = await mail('fwd', fwdRaw, -2);
    expect(fwd.envelope.fromAddress).toBe(C.people.A);
    await expect(analyseMessage(poison.raw, new Set())).rejects.toBeTruthy();
    await expect(analyseMessage(fwd.raw, new Set([C.people.A]))).rejects.toBeTruthy();
    const after = await generated('after-poison', -1, `From: statements@${brand}\nX-Forwarded-For: ${C.people.A}`);
    const poisoned = install([poison, fwd, after]);
    expect(await polled()).toEqual({ outcome: 'ok', fetched: 3, stored: 1, duplicates: 0, unknown: 2, expired: 0, oversize: 0, errorCode: null });
    expect(poisoned.fetched).toEqual(['poison', 'fwd', 'after-poison']);
    for (const m of [poison, fwd]) {
      expect((await db.query('SELECT domain FROM loyalty_inbox_unknown_senders WHERE dedupe_key = $1', [keyOf(m)])).rows[0]?.domain, m.id).toBe('(unreadable)');
      expect(await count('SELECT count(*) AS n FROM loyalty_inbox_messages WHERE dedupe_key = $1', [keyOf(m)]), m.id).toBe(0);
    }
    expect(await count('SELECT count(*) AS n FROM loyalty_inbox_messages WHERE dedupe_key = $1', [keyOf(after)])).toBe(1);
    expect((await stateRow()).last_outcome).toBe('ok');
    const repoll = install([poison, fwd, after]);
    expect(await polled()).toEqual({ outcome: 'ok', fetched: 3, stored: 0, duplicates: 3, unknown: 0, expired: 0, oversize: 0, errorCode: null });
    expect(repoll.fetched).toEqual([]);
    for (const l of [...lines, ...bodies]) expect(l.includes(C.canaries.password) || l.includes(C.canaries.body), l.slice(0, 120)).toBe(false);
  }, 30_000);

  it('T42c1-I4: stored mail is attributed through the tiers, an added address re-attributes what was unmatched, and no date moves back', async () => {
    const { w, mails } = await fullPoll();
    const T = C.totals.after;
    let inbox = await inboxOf(owner);
    expect(inbox.unattributed).toBe(3);
    expect(inbox.forwarding.find((f) => f.memberId === w.A)).toMatchObject({ state: 'ok', lastReceivedOn: await pgDay(T.A.lastReceivedDay) });
    expect(inbox.forwarding.find((f) => f.memberId === w.B)).toMatchObject({ state: 'ok', lastReceivedOn: await pgDay(T.B.lastReceivedDay) });

    const rowOf = async (id: string) => (await db.query('SELECT attribution, member_id FROM loyalty_inbox_messages WHERE dedupe_key = $1',
      [keyOf(mails.find((x) => x.id === id) as Mail)])).rows[0];
    const matchedBefore = (await db.query(`SELECT id, member_id FROM loyalty_inbox_messages WHERE attribution = 'matched' ORDER BY id`)).rows;

    const patched = await api.patchMember(owner, w.B, { forwardingAddresses: [C.people.B, C.people.inbox] });
    expect(patched.status).toBe(200);
    expect(await rowOf('F11')).toEqual({ attribution: 'matched', member_id: w.B });
    expect(await rowOf('F12')).toEqual({ attribution: 'none_found', member_id: null });
    expect(await rowOf('F13')).toEqual({ attribution: 'ambiguous', member_id: null });
    const matchedAfter = (await db.query(`SELECT id, member_id FROM loyalty_inbox_messages WHERE attribution = 'matched' AND id = ANY($1::int[]) ORDER BY id`,
      [matchedBefore.map((r) => r.id)])).rows;
    expect(matchedAfter).toEqual(matchedBefore);
    inbox = await inboxOf(owner);
    expect(inbox.unattributed).toBe(2);
    // F11 is older than B's newest mail: B's date does not move.
    expect(inbox.forwarding.find((f) => f.memberId === w.B)?.lastReceivedOn).toBe(await pgDay(T.B.lastReceivedDay));

    // Removing the address never un-matches a stored message.
    expect((await api.patchMember(owner, w.B, { forwardingAddresses: [C.people.B] })).status).toBe(200);
    expect(await rowOf('F11')).toEqual({ attribution: 'matched', member_id: w.B });

    // An older message stored afterwards moves neither member's nor the program's date back.
    const old = await generated('old', -25, `From: statements@${C.programs.brand.domain}\nX-Forwarded-For: ${C.people.A}`);
    install([old]);
    expect((await polled()).stored).toBe(1);
    inbox = await inboxOf(owner);
    expect(inbox.forwarding.find((f) => f.memberId === w.A)?.lastReceivedOn).toBe(await pgDay(T.A.lastReceivedDay));
    expect(inbox.coverage.find((c) => c.programId === w.brand)?.lastSeenOn).toBe(await pgDay(T.brand.lastSeenDay));
  });

  it('T42c1-I5: retention deletes exactly what is older than 30 days, in both tables, on the daily step and after every poll, and nothing else', async () => {
    const w = await world();
    const plant = async (daysAgo: number, tag: string) => {
      const hex = (c: string) => `${tag}${c}`.padEnd(64, c).slice(0, 64);
      await db.query(`INSERT INTO loyalty_inbox_messages (dedupe_key, received_on, program_id, sender_domain, origin, attribution, raw_mail)
                      VALUES ($1, CURRENT_DATE - $2::int, $3, $4, 'direct', 'none_found', '\\x5a'::bytea)`, [hex('a'), daysAgo, w.brand, C.programs.brand.domain]);
      await db.query(`INSERT INTO loyalty_inbox_unknown_senders (dedupe_key, received_on, domain) VALUES ($1, CURRENT_DATE - $2::int, 'attacker.test')`, [hex('b'), daysAgo]);
    };
    await db.query('UPDATE loyalty_sender_domains SET last_seen_on = CURRENT_DATE - 40 WHERE program_id = $1', [w.brand]);
    await db.query('UPDATE household_member_addresses SET last_received_on = CURRENT_DATE - 40 WHERE member_id = $1', [w.A]);
    const config = async () => JSON.stringify([
      (await db.query(`SELECT * FROM loyalty_sender_domains WHERE program_id IN ($1, $2) ORDER BY id`, [w.brand, w.air])).rows,
      (await db.query(`SELECT * FROM household_member_addresses WHERE member_id IN ($1, $2) ORDER BY id`, [w.A, w.B])).rows,
      await stateRow(),
    ]);
    const before = await config();
    const seen: number[] = [];
    for (const [i, r] of C.retention.entries()) { await plant(r.daysAgo, String(i)); seen.push(r.daysAgo); }
    expect(seen).toEqual(C.retention.map((r) => r.daysAgo));
    const dropped = C.retention.filter((r) => !r.kept).length;
    expect(await purgeExpiredInbox()).toEqual({ messages: dropped, unknown: dropped });
    for (const table of ['loyalty_inbox_messages', 'loyalty_inbox_unknown_senders']) {
      const left = (await db.query<{ d: number }>(`SELECT (CURRENT_DATE - received_on) AS d FROM ${table} ORDER BY d`)).rows.map((r) => r.d);
      expect(left, table).toEqual(C.retention.filter((r) => r.kept).map((r) => r.daysAgo));
    }
    expect(await config()).toBe(before);
    expect(await purgeExpiredInbox()).toEqual({ messages: 0, unknown: 0 });

    // The daily step purges, with the poller disabled.
    await plant(31, 'c');
    setEnv({});
    await runLoyaltyInboxDaily();
    expect(await count(`SELECT count(*) AS n FROM loyalty_inbox_messages WHERE received_on < CURRENT_DATE - 30`)).toBe(0);
    expect(await count(`SELECT count(*) AS n FROM loyalty_inbox_unknown_senders WHERE received_on < CURRENT_DATE - 30`)).toBe(0);

    // An on-demand poll purges too; a message re-listed after its purge, now outside the window, is expired.
    setEnv(READY());
    await plant(31, 'd');
    const late = await generated('late', -31, `From: statements@${C.programs.brand.domain}\nX-Forwarded-For: ${C.people.A}`);
    const fake = install([late]);
    expect(await polled()).toMatchObject({ outcome: 'ok', fetched: 1, stored: 0, expired: 1 });
    expect(fake.fetched).toEqual([]);
    expect(await count(`SELECT count(*) AS n FROM loyalty_inbox_messages WHERE received_on < CURRENT_DATE - 30`)).toBe(0);
    expect(await count(`SELECT count(*) AS n FROM loyalty_inbox_unknown_senders WHERE received_on < CURRENT_DATE - 30`)).toBe(0);
  });

  it('T42c1-I6: forwarding health turns quiet only after 45 days, follows the added date with no mail, and ignores unattributed mail', async () => {
    const w = await world();
    const seen: string[] = [];
    const ids: number[] = [];
    for (const [i, h] of C.health.entries()) {
      const id = (await db.query<{ id: number }>('INSERT INTO household_members (display_name) VALUES ($1) RETURNING id', [`ZQ42C Health ${i}`])).rows[0].id;
      ids.push(id);
      if (h.addedDaysAgo !== null) {
        await db.query(`INSERT INTO household_member_addresses (member_id, address, added_on, last_received_on)
                        VALUES ($1, $2, CURRENT_DATE - $3::int, CASE WHEN $4::int IS NULL THEN NULL ELSE CURRENT_DATE - $4::int END)`,
          [id, `zq42c-health-${i}@example.com`, h.addedDaysAgo, h.lastReceivedDaysAgo]);
      }
      if (h.unattributedMailDaysAgo !== undefined) {
        await db.query(`INSERT INTO loyalty_inbox_messages (dedupe_key, received_on, program_id, sender_domain, origin, attribution, raw_mail)
                        VALUES (repeat('e', 64), CURRENT_DATE - $1::int, $2, $3, 'direct', 'unmatched', '\\x5a'::bytea)`, [h.unattributedMailDaysAgo, w.brand, C.programs.brand.domain]);
      }
    }
    const inbox = await inboxOf(owner);
    const html = renderToStaticMarkup(createElement(TravelBoard, { overview: (await api.overview(owner)).body.data as LoyaltyOverview })).replace(/<!-- -->/g, '');
    for (const [i, h] of C.health.entries()) {
      const f = inbox.forwarding.find((x) => x.memberId === ids[i]);
      expect(f?.state, h.name).toBe(h.expect.state);
      if ('quietDays' in h.expect) expect(f?.quietDays, h.name).toBe(h.expect.quietDays);
      if (h.lastReceivedDaysAgo !== null) expect(f?.quietDays, h.name).toBe(h.lastReceivedDaysAgo);
      if (h.lastReceivedDaysAgo === null && h.addedDaysAgo !== null) expect(f?.quietDays, h.name).toBe(h.addedDaysAgo);
      const name = `ZQ42C Health ${i}`;
      const line = { not_set_up: `${name}: no forwarding address set`, no_mail_yet: `${name}: no mail yet`, ok: `${name}: last mail ${f?.lastReceivedOn}`,
        quiet: `${name}: forwarding quiet for ${f?.quietDays} days` }[f?.state as string];
      expect(html.includes(line as string), `${h.name}: the page says ${line}`).toBe(true);
      seen.push(h.name);
    }
    expect(seen).toEqual(C.health.map((h) => h.name));
  });

  it('T42c1-I7: coverage shows the last mail seen and the count in the window, null as null, and the unknown senders by count, capped', async () => {
    const { w } = await fullPoll();
    const empty = (await db.query<{ id: number }>(`INSERT INTO loyalty_programs (name, kind, default_unit) VALUES ('ZQ42C Empty', 'hotel', 'points') RETURNING id`)).rows[0].id;
    await db.query(`INSERT INTO loyalty_sender_domains (program_id, domain) VALUES ($1, 'zq42c-empty.test')`, [empty]);
    let inbox = await inboxOf(owner);
    const T = C.totals.after;
    expect(inbox.coverage.find((c) => c.programId === w.brand)).toEqual({ programId: w.brand, lastSeenOn: await pgDay(T.brand.lastSeenDay), storedInWindow: T.brand.storedInWindow });
    expect(inbox.coverage.find((c) => c.programId === w.air)).toEqual({ programId: w.air, lastSeenOn: await pgDay(T.air.lastSeenDay), storedInWindow: T.air.storedInWindow });
    expect(inbox.coverage.find((c) => c.programId === empty)).toEqual({ programId: empty, lastSeenOn: null, storedInWindow: 0 });
    expect(inbox.unknownSenderTotal).toBe(C.totals.unknown);
    const sorted = Object.entries(C.totals.unknownByDomain).map(([domain, n]) => ({ domain, count: n }))
      .sort((a, b) => b.count - a.count || (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0));
    expect(inbox.unknownSenders).toEqual(sorted);
    for (const u of inbox.unknownSenders) expect(Object.keys(u).sort()).toEqual(['count', 'domain']);

    // Twenty-five more distinct unknown domains: twenty listed, every row in the total; one outside the window uncounted.
    for (let i = 0; i < 25; i++) {
      await db.query(`INSERT INTO loyalty_inbox_unknown_senders (dedupe_key, received_on, domain) VALUES ($1, CURRENT_DATE - 1, $2)`,
        [`${String(i).padStart(2, '0')}`.padEnd(64, 'f'), `zq42c-u${String(i).padStart(2, '0')}.test`]);
    }
    await db.query(`INSERT INTO loyalty_inbox_unknown_senders (dedupe_key, received_on, domain) VALUES (repeat('d', 64), CURRENT_DATE - 31, 'attacker.test')`);
    inbox = await inboxOf(owner);
    expect(inbox.unknownSenders).toHaveLength(20);
    expect(inbox.unknownSenderTotal).toBe(C.totals.unknown + 25);
    expect(inbox.unknownSenders[0]).toEqual({ domain: 'attacker.test', count: C.totals.unknownByDomain['attacker.test'] });

    // An older message for the brand stored later does not move its last-seen date back.
    install([await generated('older', -15, `From: news@${C.programs.brand.domain}`)]);
    expect((await polled()).stored).toBe(1);
    inbox = await inboxOf(owner);
    expect(inbox.coverage.find((c) => c.programId === w.brand)).toEqual({ programId: w.brand, lastSeenOn: await pgDay(T.brand.lastSeenDay), storedInWindow: T.brand.storedInWindow + 1 });
  });

  it('T42c1-I8: no raw body, subject, member number, password, user or host leaves the server, and the inbox carries exactly the contract keys', async () => {
    const { w } = await fullPoll();
    const texts: string[] = [];
    const take = (a: Answer) => { texts.push(a.text); return a; };
    take(await api.overview(owner));
    take(await api.overview(two));
    take(await api.patchMember(owner, w.A, { forwardingAddresses: [C.people.A, 'zq42c-anna2@example.com'] }));
    take(await api.patchMember(owner, w.A, { forwardingAddresses: [C.canaries.body] }));
    take(await api.patchMember(owner, w.A, { forwardingAddresses: [C.people.B] }));
    take(await api.patchProgram(owner, w.air, { senderDomains: [C.programs.brand.domain] }));
    take(await api.patchProgram(owner, w.air, { senderDomains: [`${C.canaries.subject}.test`] }));
    take(await api.patchProgram(owner, w.air, { senderDomains: [C.programs.air.domain, 'mail.zq42c-air.test'] }));
    install(await allFixtures());
    take(await api.poll(owner));
    install([], { fail: Object.assign(new Error(`${C.canaries.password} ${C.canaries.subject}`), { code: 'ECONNREFUSED' }) });
    take(await api.poll(owner));
    setEnv({ LOYALTY_IMAP_PASSWORD: C.canaries.password });
    take(await api.poll(owner));
    setEnv(READY());
    take(await api.poll(readTok));
    take(await api.poll(null));
    const overview = take(await api.overview(owner)).body.data as LoyaltyOverview;
    const html = renderToStaticMarkup(createElement(TravelBoard, { overview }));
    expect(html.includes('Loyalty inbox')).toBe(true);
    for (const t of [...texts, html, ...lines, ...bodies]) {
      for (const s of SECRETS) expect(t.toLowerCase().includes(s.toLowerCase()), `${s} in ${t.slice(0, 100)}`).toBe(false);
    }

    // The inbox's key set and every nested key set equal the contract's.
    const shape = (LoyaltyInboxSchema as unknown as { shape?: Record<string, unknown> }).shape;
    const keysOf = (o: object) => Object.keys(o).sort();
    expect(keysOf(overview.inbox)).toEqual(['configured', 'coverage', 'forwarding', 'lastCheck', 'missing', 'problem', 'retentionDays', 'senderDomains', 'silenceDays', 'unattributed', 'unknownSenderTotal', 'unknownSenders']);
    if (shape) expect(keysOf(overview.inbox)).toEqual(Object.keys(shape).sort());
    expect(keysOf(overview.inbox.lastCheck as object)).toEqual(['errorCode', 'on', 'outcome']);
    for (const s of overview.inbox.senderDomains) expect(keysOf(s)).toEqual(['domains', 'programId']);
    for (const c of overview.inbox.coverage) expect(keysOf(c)).toEqual(['lastSeenOn', 'programId', 'storedInWindow']);
    for (const f of overview.inbox.forwarding) expect(keysOf(f)).toEqual(['addresses', 'lastReceivedOn', 'memberId', 'quietDays', 'state']);
    for (const u of overview.inbox.unknownSenders) expect(keysOf(u)).toEqual(['count', 'domain']);
  });

  it('T42c1-I9: the two editors validate, replace atomically, refuse a taken entry with 409, echo nothing and refuse a read token', async () => {
    const w = await world();
    const domainsOf = async (id: number) => (await db.query<{ domain: string }>('SELECT domain FROM loyalty_sender_domains WHERE program_id = $1 ORDER BY domain', [id])).rows.map((r) => r.domain);
    const addressesOf = async (id: number) => (await db.query<{ address: string }>('SELECT address FROM household_member_addresses WHERE member_id = $1 ORDER BY address', [id])).rows.map((r) => r.address);
    const seen: string[] = [];
    // The accepted inputs include both fixture domains, so neither program holds one during the walk.
    await db.query('DELETE FROM loyalty_sender_domains WHERE program_id IN ($1, $2)', [w.brand, w.air]);
    for (const d of C.domainAccept) {
      expect((await api.patchProgram(owner, w.air, { senderDomains: [d.input] })).status, d.input).toBe(200);
      expect(await domainsOf(w.air)).toEqual([d.stored]);
      expect((await inboxOf(owner)).senderDomains.find((s) => s.programId === w.air)?.domains).toEqual([d.stored]);
      seen.push(d.input);
    }
    expect((await api.patchProgram(owner, w.brand, { senderDomains: [C.programs.brand.domain] })).status).toBe(200);
    expect((await api.patchProgram(owner, w.air, { senderDomains: [C.programs.air.domain] })).status).toBe(200);
    for (const d of C.domainRefuse) {
      const r = await api.patchProgram(owner, w.air, { senderDomains: [d] });
      expect([r.status, r.body.error?.code], d).toEqual([400, 'INVALID_INPUT']);
      if (d.trim().length > 4) expect(r.body.error?.message.toLowerCase().includes(d.trim().toLowerCase()), d).toBe(false);
      expect(await domainsOf(w.air)).toEqual([C.programs.air.domain]);
      seen.push(d);
    }
    expect(seen).toEqual([...C.domainAccept.map((d) => d.input), ...C.domainRefuse]);
    expect((await api.patchProgram(owner, w.air, { senderDomains: ['zq42c-a1.test', 'zq42c-a2.test', 'gmail.com'] })).status).toBe(400);
    expect(await domainsOf(w.air)).toEqual([C.programs.air.domain]);
    const taken = await api.patchProgram(owner, w.air, { senderDomains: ['zq42c-a1.test', C.programs.brand.domain] });
    expect([taken.status, taken.body.error?.code]).toEqual([409, 'DOMAIN_TAKEN']);
    expect(taken.text.includes(C.programs.brand.domain)).toBe(false);
    expect(await domainsOf(w.air)).toEqual([C.programs.air.domain]);
    expect(await domainsOf(w.brand)).toEqual([C.programs.brand.domain]);
    expect((await api.patchProgram(owner, w.air, { senderDomains: [] })).status).toBe(200);
    expect(await domainsOf(w.air)).toEqual([]);

    const seenA: string[] = [];
    for (const a of C.addressAccept) {
      expect((await api.patchMember(owner, w.A, { forwardingAddresses: [a.input] })).status, a.input).toBe(200);
      expect(await addressesOf(w.A)).toEqual([a.stored]);
      seenA.push(a.input);
    }
    await api.patchMember(owner, w.A, { forwardingAddresses: [C.people.A] });
    for (const a of C.addressRefuse) {
      const r = await api.patchMember(owner, w.A, { forwardingAddresses: [a] });
      expect([r.status, r.body.error?.code], a).toEqual([400, 'INVALID_INPUT']);
      if (a.trim().length > 4) expect(r.body.error?.message.toLowerCase().includes(a.trim().toLowerCase()), a).toBe(false);
      expect(await addressesOf(w.A)).toEqual([C.people.A]);
      seenA.push(a);
    }
    expect(seenA).toEqual([...C.addressAccept.map((a) => a.input), ...C.addressRefuse]);
    expect((await api.patchMember(owner, w.A, { forwardingAddresses: [C.people.A, 'zq42c-x@example.com', 'not an address'] })).status).toBe(400);
    expect(await addressesOf(w.A)).toEqual([C.people.A]);
    const takenA = await api.patchMember(owner, w.A, { forwardingAddresses: [C.people.A, C.people.B] });
    expect([takenA.status, takenA.body.error?.code]).toEqual([409, 'ADDRESS_TAKEN']);
    expect(takenA.text.includes(C.people.B)).toBe(false);
    expect(await addressesOf(w.A)).toEqual([C.people.A]);
    expect(await addressesOf(w.B)).toEqual([C.people.B]);
    expect((await api.patchMember(owner, w.A, { forwardingAddresses: [] })).status).toBe(200);
    expect(await addressesOf(w.A)).toEqual([]);

    // A read token and no session change nothing.
    for (const [who, status] of [[readTok, 403], [null, 401]] as const) {
      const p = await api.patchProgram(who, w.brand, { senderDomains: [] });
      const m = await api.patchMember(who, w.B, { forwardingAddresses: [] });
      expect([p.status, m.status]).toEqual([status, status]);
      if (status === 403) expect([p.body.error?.code, m.body.error?.code]).toEqual(['INSUFFICIENT_SCOPE', 'INSUFFICIENT_SCOPE']);
    }
    expect(await domainsOf(w.brand)).toEqual([C.programs.brand.domain]);
    expect(await addressesOf(w.B)).toEqual([C.people.B]);
    expect(JSON.stringify(await inboxOf(two))).toBe(JSON.stringify(await inboxOf(owner)));

    // The database refuses what the validator would.
    expect(await sqlState(`INSERT INTO loyalty_sender_domains (program_id, domain) VALUES ($1, 'ZQ42C-UP.test')`, [w.air])).toBe('23514');
    expect(await sqlState(`INSERT INTO loyalty_sender_domains (program_id, domain) VALUES ($1, 'zq42c up.test')`, [w.air])).toBe('23514');
    expect(await sqlState(`INSERT INTO loyalty_sender_domains (program_id, domain) VALUES ($1, $2)`, [w.air, C.programs.brand.domain])).toBe('23505');
    expect(await sqlState(`INSERT INTO household_member_addresses (member_id, address) VALUES ($1, 'ZQ42C-Up@example.com')`, [w.A])).toBe('23514');
    expect(await sqlState(`INSERT INTO household_member_addresses (member_id, address) VALUES ($1, $2)`, [w.A, C.people.B])).toBe('23505');
  });

  it('T42c1-I10: the poll route refuses a read token and no session, answers the contract shape for every outcome, and leaves the ledger as it was', async () => {
    await world();
    const ledger = async () => JSON.stringify(await (await ledgerOverviewGET(req('/api/v1/overview', owner))).json(), (k, v) => (/(At|Time|time|Ago|age)$/.test(k) ? undefined : v));
    const netBefore = await computeCurrentNetWorth();
    const sumBefore = await sumOf(LEDGER);
    const ledgerBefore = await ledger();
    const stateBefore = JSON.stringify(await stateRow());

    const fake = install(await allFixtures());
    const r = await api.poll(readTok);
    expect([r.status, r.body.error?.code]).toEqual([403, 'INSUFFICIENT_SCOPE']);
    expect((await api.poll(null)).status).toBe(401);
    expect(fake.calls).toEqual([]);
    expect(JSON.stringify(await stateRow())).toBe(stateBefore);

    const outcomes: string[] = [];
    outcomes.push((await polled()).outcome);
    install([], { fail: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }) });
    outcomes.push((await polled()).outcome);
    setEnv({});
    outcomes.push((await polled()).outcome);
    setEnv(READY());
    let open!: () => void;
    let listed!: () => void;
    const listing = new Promise<void>((res) => { listed = res; });
    install([], { gate: new Promise<void>((res) => { open = res; }), listed });
    const held = api.poll(owner);
    await listing;
    outcomes.push((await polled(two)).outcome);
    open();
    await held;
    expect(outcomes).toEqual(['ok', 'error', 'disabled', 'already_running']);
    await purgeExpiredInbox();
    await api.patchMember(owner, (await db.query<{ id: number }>(`SELECT id FROM household_members WHERE display_name = 'ZQ42C Anna'`)).rows[0].id, { forwardingAddresses: [C.people.A, C.people.inbox] });

    expect(await computeCurrentNetWorth()).toEqual(netBefore);
    expect(await sumOf(LEDGER)).toBe(sumBefore);
    expect(await ledger()).toBe(ledgerBefore);
    const dir = join(WEB, 'app/api/v1/loyalty');
    const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith('route.ts')).map((f) => relative(WEB, join(dir, f)).split('\\').join('/'));
    expect(files).toHaveLength(18);
    expect(ROUTES.find((x) => x.file === 'app/api/v1/loyalty/inbox/poll/route.ts')?.classes).toEqual(['no-transaction-data']);
  });

  it('T42c1-I11: the real adapter against a closed loopback port fails as connect_failed, records it, frees the lock and leaks nothing', async () => {
    const port = await new Promise<number>((resolve) => {
      const server = createServer();
      server.listen(0, '127.0.0.1', () => {
        const p = (server.address() as { port: number }).port;
        server.close(() => resolve(p));
      });
    });
    setEnv({ ...READY(), LOYALTY_IMAP_HOST: '127.0.0.1', LOYALTY_IMAP_PORT: String(port), LOYALTY_IMAP_TIMEOUT_SECONDS: '5' });
    H.source = 'real';
    const from = lines.length;
    const result = await pollLoyaltyInbox();
    expect(result).toEqual({ outcome: 'error', fetched: 0, stored: 0, duplicates: 0, unknown: 0, expired: 0, oversize: 0, errorCode: 'connect_failed' });
    const state = await stateRow();
    expect(state).toMatchObject({ last_outcome: 'error', last_error_code: 'connect_failed' });
    const lock = await db.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(hashtext('b8:loyalty-inbox:poll')) AS ok`);
    expect(lock.rows[0].ok).toBe(true);
    await db.query(`SELECT pg_advisory_unlock(hashtext('b8:loyalty-inbox:poll'))`);
    const said = [JSON.stringify(result), JSON.stringify(state), ...lines.slice(from)];
    for (const t of said) {
      for (const s of [C.canaries.password, C.canaries.user, '127.0.0.1', String(port), 'ECONNREFUSED', 'connect ']) expect(t.includes(s), `${s} in ${t.slice(0, 100)}`).toBe(false);
    }
  }, 20_000);

  it('T42c1-I12: nothing derived from the mail is stored, the five tables have the contract columns, and only the inbox tables move', async () => {
    const loyaltyBefore = await sumOf(LOYALTY.filter((t) => !['loyalty_programs', 'household_members'].includes(t)));
    const { w, mails } = await fullPoll();
    const coreBefore = await sumOf(['loyalty_programs', 'household_members']);
    const rows = (await db.query('SELECT * FROM loyalty_inbox_messages')).rows;
    expect(rows).toHaveLength(C.totals.stored);
    const ids = new Set(mails.map((m) => m.envelope.messageId).filter((x): x is string => x !== null).flatMap((x) => [x, x.replace(/^<|>$/g, '')]));
    for (const r of rows) {
      const nonNull = Object.keys(r).filter((k) => r[k] !== null).sort();
      const want = ['attribution', 'dedupe_key', 'id', 'origin', 'oversize', 'program_id', 'raw_mail', 'received_on', 'sender_domain', 'stored_on'];
      expect(nonNull).toEqual(r.attribution === 'matched' ? [...want, 'member_id'].sort() : want);
      expect(r.dedupe_key).toMatch(/^[0-9a-f]{64}$/);
      expect(ids.has(r.dedupe_key)).toBe(false);
      expect(r.sender_domain).toMatch(/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/);
    }
    const columns = async (t: string) => (await db.query<{ c: string }>(
      `SELECT string_agg(column_name, ',' ORDER BY column_name COLLATE "C") AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [t])).rows[0].c;
    expect(await columns('loyalty_sender_domains')).toBe('domain,id,last_seen_on,program_id');
    expect(await columns('household_member_addresses')).toBe('added_on,address,id,last_received_on,member_id');
    expect(await columns('loyalty_inbox_messages')).toBe('attribution,dedupe_key,id,member_id,origin,oversize,program_id,raw_mail,received_on,sender_domain,stored_on');
    expect(await columns('loyalty_inbox_unknown_senders')).toBe('dedupe_key,domain,received_on');
    expect(await columns('loyalty_inbox_state')).toBe('id,last_error_code,last_outcome,last_polled_on');
    expect(await count(`SELECT count(*) AS n FROM loyalty_inbox_unknown_senders
                         WHERE domain <> '(unreadable)' AND domain !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'`)).toBe(0);

    // Polls, purges and edits move the inbox tables and the two editable lists, nothing else.
    install(mails);
    await polled();
    await purgeExpiredInbox();
    await api.patchProgram(owner, w.air, { senderDomains: [C.programs.air.domain, 'mail.zq42c-air.test'] });
    await api.patchMember(owner, w.B, { forwardingAddresses: [C.people.B, C.people.inbox] });
    expect(await sumOf(['loyalty_programs', 'household_members'])).toBe(coreBefore);
    expect(await sumOf(LOYALTY.filter((t) => !['loyalty_programs', 'household_members'].includes(t)))).toBe(loyaltyBefore);
  });
});
