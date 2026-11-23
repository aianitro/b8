// P8-42c2 — reading the stored loyalty mail through the real pipeline, handlers and Postgres
// (I1–I14): availability, the happy path and idempotency, every decision of the fixture set, retries
// and their bounds, the lock and one effect per tap, the three queue actions and their authority,
// hostile reader output, an obedient reader, privacy, the real SDK client over loopback, retention
// and the panel's counts, ledger neutrality, the daily job, and what reaches the reader.
//
// TIER 2, collected by `vitest.integration.config.mts` with the scratch-database guard in its setup
// files, like `loyaltyInbox.test.ts` beside it. People sign in through the real passkey path
// (`../auth/secondUserTestKit.ts`); bearer tokens are minted with `createPersonalToken`. Every
// handler is called directly with a `NextRequest`.
//
// THE READER IS A FAKE. `createMailReader` in `@/lib/loyaltyReader` is mocked: each test installs a
// fake that answers from the pinned fixture, keyed by a marker line this suite appends to each
// stored message's text (the reader is given nothing but subject and text, so the marker is how the
// fake knows which message it is reading). With no fake installed the mock answers `api_error` and
// counts the call, so a read nobody expected is seen. Only T42c2-I10 asks for the real reader, aimed
// at loopback listeners this suite opened; no test reaches a real model.
//
// THE FIXTURES ARE PINNED. `lib/fixtures/loyalty-read/` (six `.eml` and `cases.json`) is fabricated,
// carries the canary ZQ42C2, and is pinned by a SHA-256 in the spec's command 16. Its `{{DAY:n}}`
// tokens become dates Postgres computes; every expected value is read from it, and each group walked
// is collected into `seen` and compared with the group's own ids.
//
// THE ENVIRONMENT. Tests set `ANTHROPIC_API_KEY` to the fixture's key canary themselves (or leave it
// unset) and the previous environment is restored afterwards. Every console line of the whole file
// is captured, for the privacy checks.
//
// CLEANUP IS OF THIS SUITE'S OWN ROWS: reads and not-mine rows, stored messages, observations and
// memberships of `ZQ42C2 …` programs, the programs and members themselves, the read state reset to
// never-read, and the auth tables through `resetAuth`.

import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server, type Socket } from 'node:net';
import { createHash } from 'node:crypto';
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
import { purgeExpiredReads, readStoredMail, runLoyaltyReadDaily } from '@/lib/loyaltyInboxRead';
import { membershipView } from '@/lib/loyaltyStore';
import type { MailReader, MailReaderInput, MailReaderResult } from '@/lib/loyaltyReader';
import TravelBoard from '@/components/TravelBoard';
import {
  LoyaltyInboxReadResponseSchema,
  LoyaltyInboxResolveResponseSchema,
  LoyaltyOverviewResponseSchema,
  LoyaltyReadMaskedSuffixSchema,
  LOYALTY_READ_MAX_CHARS,
  LOYALTY_READ_MAX_PER_RUN,
  LOYALTY_READ_QUEUE_LIMIT,
  type LoyaltyInboxReadPanel,
  type LoyaltyInboxReadRun,
  type LoyaltyOverview,
  type LoyaltyUnit,
} from '@b8/contracts/loyalty';
import { bearer, bootstrapOwner, cookie, enrolSecondUser, resetAuth, type EnrolledUser } from '../auth/secondUserTestKit';
import { GET as overviewGET } from './route';
import { POST as readPOST } from './inbox/read/route';
import { POST as resolvePOST } from './inbox/readings/[id]/route';

// ─── Mocks ─────────────────────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  /** The reader the next `createMailReader` call returns; `'real'` builds the real one. */
  reader: null as null | 'real' | { read(input: { subject: string | null; text: string }): Promise<unknown> },
  /** Reads made with no fake installed. */
  unexpected: 0,
  order: [] as string[],
}));

vi.mock('@/lib/loyaltyReader', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/loyaltyReader')>();
  return {
    ...real,
    createMailReader: vi.fn((env: Record<string, string | undefined>) => {
      if (H.reader === 'real') return real.createMailReader(env);
      if (H.reader === null) return { read: async () => { H.unexpected++; return { ok: false, code: 'api_error' }; } };
      return H.reader;
    }),
  };
});
// The daily job's other steps, so `runDailyJob` runs the real read step and nothing that needs Plaid,
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
  return { ...real, runLoyaltyInboxDaily: vi.fn(async () => { H.order.push('inbox'); }) };
});
vi.mock('@/lib/loyaltyInboxRead', async (o) => {
  const real = await o<typeof import('@/lib/loyaltyInboxRead')>();
  return { ...real, runLoyaltyReadDaily: vi.fn(async () => { H.order.push('read'); return real.runLoyaltyReadDaily(); }) };
});
// The board is a client component; rendered to a string here it needs a router.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

// ─── The fixture ───────────────────────────────────────────────────────────────────────────────

const DIR = fileURLToPath(new URL('../../../../lib/fixtures/loyalty-read/', import.meta.url));
const WEB = fileURLToPath(new URL('../../../../', import.meta.url));
type Baseline = { balance: string; unit: LoyaltyUnit; asOfOffset: number } | null;
type RetryStep = { attempts: number; state: string; code: string | null };
interface Fixture {
  canaries: Record<string, string> & { addresses: string[] };
  programs: { id: string; name: string; kind: string; defaultUnit: LoyaltyUnit; aliases: string[]; domain: string }[];
  members: { id: string; displayName: string }[];
  memberships: { id: string; program: string; member: string; memberNumber: string | null; baseline: Baseline }[];
  notMine: { program: string; suffix: string }[];
  decisions: {
    id: string; program: string; eml: string; reader: Record<string, unknown>;
    expect: { state: string; reason: string | null; membership: string | null; observation: boolean; balanceAfter: string | null };
  }[];
  clean: { id: string; input: unknown; expect: { balance: string | null } }[];
  retry: { id: string; messages: Record<string, string[]>; eml?: Record<string, string>; runs: { retryFailed: boolean; outcome: string; errorCode: string | null; after: Record<string, RetryStep> }[] }[];
  retention: { keptDays: number[]; deletedDays: number[] };
}
const C = JSON.parse(readFileSync(join(DIR, 'cases.json'), 'utf8')) as Fixture;
const K = C.canaries;
const emlText = (name: string) => readFileSync(join(DIR, `${name}.eml`), 'utf8');

const pgDay = async (n = 0) => (await db.query<{ d: string }>('SELECT (CURRENT_DATE + $1::int)::text AS d', [n])).rows[0].d;
/** Replaces every `{{DAY:n}}` token in a fixture value, at any depth, with Postgres's date. */
async function resolve<T>(v: T): Promise<T> {
  let text = JSON.stringify(v);
  for (const t of new Set(text.match(/\{\{DAY:-?\d+\}\}/g) ?? [])) text = text.split(t).join(await pgDay(Number(t.slice(6, -2))));
  return JSON.parse(text) as T;
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** The marker line a stored message carries, and the case it names in what the reader receives. */
const MARK = 'ZQ42C2-CASE ';
const markOf = (input: { text: string }) => /ZQ42C2-CASE (\S+)/.exec(input.text)?.[1] ?? null;
/** The fixture `.eml` with a marker line appended to its body. */
const marked = (name: string, mark: string) => Buffer.from(`${emlText(name).replace(/\s+$/, '')}\n${MARK}${mark}\n`, 'utf8');

// ─── Requests ──────────────────────────────────────────────────────────────────────────────────

const ORIGIN = 'http://localhost:3000';
type Who = EnrolledUser | { bearer: string } | null;
function req(path: string, who: Who, init: { method?: string; body?: unknown; raw?: string } = {}): NextRequest {
  const auth = who === null ? {} : 'bearer' in who ? bearer(who.bearer) : cookie(who.token);
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? 'GET',
    headers: { host: 'localhost:3000', 'content-type': 'application/json', ...auth },
    body: init.raw !== undefined ? init.raw : init.body === undefined ? undefined : JSON.stringify(init.body),
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
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const api = {
  overview: (who: Who) => read(overviewGET(req('/api/v1/loyalty', who))),
  read: (who: Who, body?: unknown) => read(readPOST(req('/api/v1/loyalty/inbox/read', who, { method: 'POST', body }))),
  readRaw: (who: Who, raw: string) => read(readPOST(req('/api/v1/loyalty/inbox/read', who, { method: 'POST', raw }))),
  resolve: (who: Who, id: number | string, body: unknown) => read(resolvePOST(req(`/api/v1/loyalty/inbox/readings/${id}`, who, { method: 'POST', body }), ctx(id))),
};
async function panelOf(who: Who = owner): Promise<LoyaltyInboxReadPanel> {
  const r = await api.overview(who);
  expect(r.status).toBe(200);
  expect(LoyaltyOverviewResponseSchema.safeParse(r.body).success).toBe(true);
  return (r.body.data as LoyaltyOverview).inboxRead;
}
async function readRun(who: Who = owner, body?: unknown): Promise<LoyaltyInboxReadRun> {
  const r = await api.read(who, body);
  expect(r.status).toBe(200);
  expect(LoyaltyInboxReadResponseSchema.safeParse(r.body).success).toBe(true);
  return r.body.data as LoyaltyInboxReadRun;
}

// ─── The world ─────────────────────────────────────────────────────────────────────────────────

const ENV_NAMES = ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'LOYALTY_READ_TIMEOUT_SECONDS'];
let savedEnv: Record<string, string | undefined> = {};
const withKey = () => { process.env.ANTHROPIC_API_KEY = K.key; };
const withoutKey = () => { delete process.env.ANTHROPIC_API_KEY; };

async function clearWorld(): Promise<void> {
  const ours = `SELECT id FROM loyalty_programs WHERE name LIKE 'ZQ42C2%'`;
  await db.query('DELETE FROM loyalty_inbox_reads');
  await db.query('DELETE FROM loyalty_inbox_not_mine');
  await db.query('DELETE FROM loyalty_inbox_messages');
  await db.query(`DELETE FROM loyalty_observations WHERE membership_id IN (SELECT id FROM loyalty_memberships WHERE program_id IN (${ours}))`);
  await db.query(`DELETE FROM loyalty_memberships WHERE program_id IN (${ours})`);
  await db.query(`DELETE FROM loyalty_sender_domains WHERE program_id IN (${ours})`);
  await db.query(`DELETE FROM loyalty_programs WHERE name LIKE 'ZQ42C2%'`);
  await db.query(`DELETE FROM household_members WHERE display_name LIKE 'ZQ42C2%'`);
  await db.query('UPDATE loyalty_inbox_read_state SET last_read_on = NULL, last_outcome = NULL, last_error_code = NULL WHERE id = 1');
}

interface World { program: Map<string, number>; member: Map<string, number>; membership: Map<string, number>; name: Map<number, string> }
/** The fixture's programs (with aliases and a sender domain), members, memberships with baselines and the not-mine list. */
async function world(): Promise<World> {
  const w: World = { program: new Map(), member: new Map(), membership: new Map(), name: new Map() };
  for (const p of C.programs) {
    const id = (await db.query<{ id: number }>('INSERT INTO loyalty_programs (name, kind, default_unit) VALUES ($1, $2, $3) RETURNING id', [p.name, p.kind, p.defaultUnit])).rows[0].id;
    for (const a of p.aliases) await db.query('INSERT INTO loyalty_program_aliases (program_id, alias) VALUES ($1, $2)', [id, a.toLowerCase()]);
    await db.query('INSERT INTO loyalty_sender_domains (program_id, domain) VALUES ($1, $2)', [id, p.domain]);
    w.program.set(p.id, id);
  }
  for (const m of C.members) w.member.set(m.id, (await db.query<{ id: number }>('INSERT INTO household_members (display_name) VALUES ($1) RETURNING id', [m.displayName])).rows[0].id);
  // A person holds at most one membership of a program (UNIQUE member_id, program_id), and the fixture
  // gives one person several of one program; no rule reads who holds a membership, so each fixture
  // membership gets its own household member, named after the fixture person and the membership.
  const holder = async (m: Fixture['memberships'][number]) => (await db.query<{ id: number }>('INSERT INTO household_members (display_name) VALUES ($1) RETURNING id',
    [`${C.members.find((x) => x.id === m.member)?.displayName} ${m.id}`])).rows[0].id;
  for (const m of C.memberships) {
    const id = (await db.query<{ id: number }>('INSERT INTO loyalty_memberships (member_id, program_id, member_number) VALUES ($1, $2, $3) RETURNING id',
      [await holder(m), w.program.get(m.program), m.memberNumber])).rows[0].id;
    w.membership.set(m.id, id);
    w.name.set(id, m.id);
    if (m.baseline) {
      await db.query(`INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source) VALUES ($1, CURRENT_DATE + $2::int, $3::numeric, $4, 'typed')`,
        [id, m.baseline.asOfOffset, m.baseline.balance, m.baseline.unit]);
    }
  }
  for (const n of C.notMine) await db.query('INSERT INTO loyalty_inbox_not_mine (program_id, suffix) VALUES ($1, $2)', [w.program.get(n.program), n.suffix]);
  return w;
}

/** Stores one message for `program` (a fixture program id) received `day` days from today; returns its dedupe key. */
async function store(w: World, program: string, raw: Buffer | null, day = -1, label = `${program}-${Math.random()}`): Promise<string> {
  const key = sha(`zq42c2-read-${label}`);
  const domain = C.programs.find((p) => p.id === program)?.domain;
  await db.query(
    `INSERT INTO loyalty_inbox_messages (dedupe_key, received_on, program_id, sender_domain, origin, attribution, raw_mail, oversize)
     VALUES ($1, CURRENT_DATE + $2::int, $3, $4, 'direct', 'none_found', $5, $6)`,
    [key, day, w.program.get(program), domain, raw, raw === null]
  );
  return key;
}

type Answerer = (input: MailReaderInput) => MailReaderResult | Promise<MailReaderResult>;
/** A fake reader that records what it was given and answers through `answer`. */
function install(answer: Answerer): { inputs: MailReaderInput[] } {
  const rec = { inputs: [] as MailReaderInput[] };
  const reader: MailReader = { read: async (input) => { rec.inputs.push(input); return answer(input); } };
  H.reader = reader;
  return rec;
}
/** A fake that answers each marked message with its fixture reading. */
const byMark = (outputs: Map<string, unknown>): Answerer => (input) => {
  const m = markOf(input);
  return m !== null && outputs.has(m) ? { ok: true, reading: outputs.get(m) } : { ok: false, code: 'api_error' };
};

const count = async (sql: string, values: unknown[] = []) => Number((await db.query<{ n: string }>(sql, values)).rows[0].n);
const rowOf = async (key: string) => (await db.query(`SELECT *, balance::text AS balance, as_of::text AS as_of FROM loyalty_inbox_reads WHERE dedupe_key = $1`, [key])).rows[0];
const currentBalance = async (membershipId: number) => {
  const v = await membershipView(membershipId);
  return v?.balance ?? null;
};
const sumOf = async (tables: string[]) => (await db.query<{ s: string }>(`SELECT md5(${tables
  .map((t) => `coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM ${t} x), '')`).join(' || ')}) AS s`)).rows[0].s;
const sumWhole = async (tables: string[]) => (await db.query<{ s: string }>(`SELECT md5(${tables
  .map((t) => `coalesce((SELECT string_agg(x::text, '|' ORDER BY x::text) FROM ${t} x), '')`).join(' || ')}) AS s`)).rows[0].s;
const LEDGER = ['accounts', 'transactions', 'budget_categories', 'transfer_groups'];
const UNMOVED = ['loyalty_programs', 'household_members', 'loyalty_memberships', 'loyalty_instruments', 'loyalty_earn_rules', 'loyalty_sender_domains',
  'household_member_addresses', 'loyalty_inbox_messages'];
const lockHeld = async (name: string) => {
  const c = await db.connect();
  try {
    const r = await c.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [name]);
    if (r.rows[0].ok) await c.query(`SELECT pg_advisory_unlock(hashtext($1))`, [name]);
    return !r.rows[0].ok;
  } finally {
    c.release();
  }
};

/** Every console line of the file, for the privacy checks. */
const lines: string[] = [];
let owner: EnrolledUser;
let two: EnrolledUser;
let readTok: { bearer: string };
let writeTok: { bearer: string };

beforeAll(async () => {
  const capture = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  for (const m of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(capture);
  savedEnv = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
  await clearWorld();
  await resetAuth();
  owner = await bootstrapOwner();
  two = await enrolSecondUser(owner.token);
  readTok = { bearer: (await createPersonalToken({ label: 'zq42c2 read', scope: 'read', userId: owner.userId })).token };
  writeTok = { bearer: (await createPersonalToken({ label: 'zq42c2 write', scope: 'full', userId: owner.userId })).token };
}, 60_000);

beforeEach(async () => {
  H.reader = null;
  H.unexpected = 0;
  H.order.length = 0;
  for (const n of ENV_NAMES) delete process.env[n];
  await clearWorld();
});

afterEach(async () => {
  vi.useRealTimers();
  H.reader = null;
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
});

/** Runs every `decisions` case through the pipeline, one message each, in fixture order. */
async function allDecisions(w: World) {
  const outputs = new Map<string, unknown>();
  const keys = new Map<string, string>();
  for (const d of C.decisions) {
    outputs.set(d.id, await resolve(d.reader));
    keys.set(d.id, await store(w, d.program, marked(d.eml, d.id), -1, d.id));
  }
  withKey();
  install(byMark(outputs));
  const runs: LoyaltyInboxReadRun[] = [];
  while ((await count(`SELECT count(*) AS n FROM loyalty_inbox_messages m WHERE NOT EXISTS (SELECT 1 FROM loyalty_inbox_reads r WHERE r.dedupe_key = m.dedupe_key)`)) > 0) {
    runs.push(await readRun());
  }
  return { keys, runs };
}

describe('reading the loyalty inbox (P8-42c2)', () => {
  it('T42c2-I1: with no key nothing is read, counted or written, the daily step stays green, and with a key the same call reads', async () => {
    const w = await world();
    const d = C.decisions.find((x) => x.id === 'apply-ok') as Fixture['decisions'][number];
    const key = await store(w, d.program, marked(d.eml, d.id), -1, d.id);
    const zero = { outcome: 'disabled', read: 0, applied: 0, queued: 0, stale: 0, noBalance: 0, discarded: 0, failed: 0, remaining: 0, errorCode: null };
    const stateBefore = (await db.query('SELECT * FROM loyalty_inbox_read_state')).rows;
    install(byMark(new Map([[d.id, await resolve(d.reader)]])));
    for (const value of [undefined, '', '   ']) {
      if (value === undefined) withoutKey();
      else process.env.ANTHROPIC_API_KEY = value;
      expect(await readRun()).toEqual(zero);
      expect(await readRun(owner, { retryFailed: true })).toEqual(zero);
      await runLoyaltyReadDaily();
      const panel = await panelOf();
      expect(panel.readable).toBe(false);
      expect(panel.waiting).toBe(1);
      expect(JSON.stringify(panel)).not.toContain(K.key);
    }
    expect(await count('SELECT count(*) AS n FROM loyalty_inbox_reads')).toBe(0);
    expect((await db.query('SELECT * FROM loyalty_inbox_read_state')).rows).toEqual(stateBefore);

    withKey();
    const run = await readRun();
    expect([run.outcome, run.read, run.applied]).toEqual(['ok', 1, 1]);
    expect((await rowOf(key)).state).toBe('applied');
    expect((await panelOf()).readable).toBe(true);
    expect(H.unexpected).toBe(0);
  });

  it('T42c2-I2: an applied reading appends exactly one email observation, current through the shared reducer, and nothing is read twice', async () => {
    const w = await world();
    const cases = C.decisions.filter((d) => d.id === 'apply-ok' || d.id === 'apply-ok-usd');
    const outputs = new Map<string, unknown>();
    const keys = new Map<string, string>();
    for (const d of cases) {
      outputs.set(d.id, await resolve(d.reader));
      keys.set(d.id, await store(w, d.program, marked(d.eml, d.id), -1, d.id));
    }
    const before = new Map<string, unknown[]>();
    for (const d of cases) {
      const ms = w.membership.get(d.expect.membership as string) as number;
      before.set(d.id, (await db.query('SELECT * FROM loyalty_observations WHERE membership_id = $1 ORDER BY id', [ms])).rows);
    }
    withKey();
    const rec = install(byMark(outputs));
    const first = await readRun();
    expect([first.read, first.applied]).toEqual([2, 2]);
    for (const d of cases) {
      const ms = w.membership.get(d.expect.membership as string) as number;
      const rows = (await db.query(`SELECT id, source, balance::text AS balance, unit, as_of::text AS as_of FROM loyalty_observations WHERE membership_id = $1 ORDER BY id`, [ms])).rows;
      const old = before.get(d.id) as { id: number }[];
      expect(rows).toHaveLength(old.length + 1);
      const added = rows[rows.length - 1];
      const reading = outputs.get(d.id) as { balance: string; unit: string; asOf: string };
      expect([added.source, added.balance, added.unit, added.as_of]).toEqual(['email', d.expect.balanceAfter, reading.unit, reading.asOf]);
      const row = await rowOf(keys.get(d.id) as string);
      expect([row.state, row.observation_id, row.membership_id]).toEqual(['applied', added.id, ms]);
      expect(await currentBalance(ms)).toBe(d.expect.balanceAfter);
      // Append-only: the earlier rows are exactly as they were.
      expect((await db.query('SELECT * FROM loyalty_observations WHERE membership_id = $1 AND id <> $2 ORDER BY id', [ms, added.id])).rows).toEqual(old);
    }
    // A second run reads nothing more and appends nothing.
    const obsBefore = await count('SELECT count(*) AS n FROM loyalty_observations');
    const calls = rec.inputs.length;
    const second = await readRun();
    expect(second).toEqual({ outcome: 'ok', read: 0, applied: 0, queued: 0, stale: 0, noBalance: 0, discarded: 0, failed: 0, remaining: 0, errorCode: null });
    expect(rec.inputs.length).toBe(calls);
    expect(await count('SELECT count(*) AS n FROM loyalty_observations')).toBe(obsBefore);
    // The same statement under a second dedupe key is stale and appends nothing.
    const again = await store(w, 'air', marked('R01', 'apply-ok'), -1, 'apply-ok-again');
    const third = await readRun();
    expect([third.read, third.stale]).toEqual([1, 1]);
    expect((await rowOf(again)).state).toBe('stale');
    expect(await count('SELECT count(*) AS n FROM loyalty_observations')).toBe(obsBefore);
  });

  it('T42c2-I3: every decision of the fixture set lands in its state, with its reason, membership and balance, and the queue holds exactly the queued ones', async () => {
    const w = await world();
    const obsBefore = await count('SELECT count(*) AS n FROM loyalty_observations');
    const { keys, runs } = await allDecisions(w);
    expect(runs.length).toBe(Math.ceil(C.decisions.length / LOYALTY_READ_MAX_PER_RUN));
    const seen: string[] = [];
    const queued: number[] = [];
    let appended = 0;
    for (const d of C.decisions) {
      const row = await rowOf(keys.get(d.id) as string);
      const membership = row.membership_id === null ? null : w.name.get(row.membership_id);
      expect({ state: row.state, reason: row.reason, membership, observation: row.observation_id !== null }, d.id)
        .toEqual({ state: d.expect.state, reason: d.expect.reason, membership: d.expect.membership, observation: d.expect.observation });
      if (d.expect.membership !== null) expect(await currentBalance(w.membership.get(d.expect.membership) as number), d.id).toBe(d.expect.balanceAfter);
      if (row.state === 'pending') queued.push(row.id);
      if (d.expect.observation) appended++;
      seen.push(d.id);
    }
    expect(seen).toEqual(C.decisions.map((d) => d.id));
    expect(await count('SELECT count(*) AS n FROM loyalty_observations')).toBe(obsBefore + appended);
    expect(await count(`SELECT count(*) AS n FROM loyalty_observations WHERE source = 'email'`)).toBe(appended);
    // The queue is exactly the queued ids, newest first (one received day, so id descending).
    const panel = await panelOf();
    expect(panel.needsAttention.map((i) => i.id)).toEqual([...queued].sort((a, b) => b - a));
    expect(panel.needsAttentionTotal).toBe(queued.length);
    // The run counts add up to the states.
    const total = (k: keyof LoyaltyInboxReadRun) => runs.reduce((n, r) => n + (r[k] as number), 0);
    const states = C.decisions.map((d) => d.expect.state);
    expect([total('applied'), total('queued'), total('stale'), total('noBalance'), total('discarded')]).toEqual(
      ['applied', 'pending', 'stale', 'no_balance', 'not_mine_known'].map((s) => states.filter((x) => x === s).length));
    expect(H.unexpected).toBe(0);
  }, 60_000);

  it('T42c2-I4: one bad message never blocks the rest, every attempt is counted, retries are bounded and a rate limit stops the run', async () => {
    const w = await world();
    const seen: string[] = [];
    for (const script of C.retry) {
      await db.query('DELETE FROM loyalty_inbox_reads');
      await db.query('DELETE FROM loyalty_inbox_messages');
      const names = Object.keys(script.messages);
      const keys = new Map<string, string>();
      // Received on successive days, so the run's order is the order of the names.
      for (const [k, name] of names.entries()) {
        const raw = script.eml?.[name] ? Buffer.from(emlText(script.eml[name]), 'utf8') : marked('R01', `${script.id}.${name}`);
        keys.set(name, await store(w, 'other', raw, -10 + k, `${script.id}.${name}`));
      }
      const used = new Map<string, number>();
      const hanging = script.messages[names[0]]?.includes('hang');
      withKey();
      install((input) => {
        const name = (markOf(input) ?? '').split('.')[1];
        const list = script.messages[name] ?? [];
        const k = used.get(name) ?? 0;
        used.set(name, k + 1);
        const step = list[Math.min(k, list.length - 1)];
        if (step === 'ok') return { ok: true, reading: { programName: null, memberNumberSuffix: null, balance: null, unit: null, asOf: null, expiryWarnings: [], instruments: [] } };
        if (step === 'throw') throw new Error(`${K.key} thrown`);
        if (step === 'hang') {
          // The call never settles; the pipeline's own bound (the reader's timeout plus five seconds)
          // is advanced past on the fake clock once this call is under way.
          setImmediate(() => { vi.advanceTimersByTime(65_000); });
          return new Promise<MailReaderResult>(() => {});
        }
        return { ok: false, code: step as never };
      });
      for (const [r, run] of script.runs.entries()) {
        if (hanging) vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const result = await readStoredMail({ retryFailed: run.retryFailed });
        vi.useRealTimers();
        expect([result.outcome, result.errorCode], `${script.id} run ${r}`).toEqual([run.outcome, run.errorCode]);
        for (const name of names) {
          const row = await rowOf(keys.get(name) as string);
          const got = row === undefined ? { attempts: 0, state: 'unread', code: null } : { attempts: row.attempts, state: row.state, code: row.last_error_code };
          expect(got, `${script.id} run ${r} ${name}`).toEqual(run.after[name]);
        }
        // The lock is released after every run, whatever happened in it.
        expect(await lockHeld('b8:loyalty-inbox:read')).toBe(false);
      }
      seen.push(script.id);
    }
    expect(seen).toEqual(C.retry.map((s) => s.id));

    // A run reads at most LOYALTY_READ_MAX_PER_RUN messages; the rest wait, and `remaining` says how many.
    await db.query('DELETE FROM loyalty_inbox_reads');
    await db.query('DELETE FROM loyalty_inbox_messages');
    const extra = 3;
    for (let k = 0; k < LOYALTY_READ_MAX_PER_RUN + extra; k++) await store(w, 'other', marked('R01', `cap.${k}`), -5, `cap.${k}`);
    install(() => ({ ok: true, reading: {} }));
    const capped = await readRun();
    expect([capped.read, capped.remaining]).toEqual([LOYALTY_READ_MAX_PER_RUN, extra]);

    // The run budget, on the fake clock: once it is spent no new message starts.
    await db.query('DELETE FROM loyalty_inbox_reads');
    await db.query('DELETE FROM loyalty_inbox_messages');
    const k1 = await store(w, 'other', marked('R01', 'budget.1'), -3, 'budget.1');
    const k2 = await store(w, 'other', marked('R01', 'budget.2'), -2, 'budget.2');
    install(() => {
      setImmediate(() => { vi.advanceTimersByTime(300_000); });
      return { ok: true, reading: {} };
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const budget = await readStoredMail();
    vi.useRealTimers();
    expect([budget.read, budget.remaining]).toEqual([1, 1]);
    expect((await rowOf(k1)).state).toBe('no_balance');
    expect(await rowOf(k2)).toBeUndefined();
    for (const t of lines) expect(t).not.toContain(K.key);
  }, 60_000);

  it('T42c2-I5: one reader at a time, independent of the poll, the lock always released, and one effect per tap', async () => {
    const w = await world();
    const d = C.decisions.find((x) => x.id === 'apply-ok') as Fixture['decisions'][number];
    const keyA = await store(w, d.program, marked(d.eml, d.id), -2, d.id);
    const keyB = await store(w, 'other', marked('R01', 'second'), -1, 'second');
    withKey();
    let open!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((res) => { open = res; });
    const reading = new Promise<void>((res) => { started = res; });
    const reading0 = await resolve(d.reader);
    const rec = install(async (input) => {
      if (markOf(input) === d.id) { started(); await gate; return { ok: true, reading: reading0 }; }
      return { ok: true, reading: {} };
    });
    const held = api.read(owner);
    await reading;
    const zero = { read: 0, applied: 0, queued: 0, stale: 0, noBalance: 0, discarded: 0, failed: 0, remaining: 0, errorCode: null };
    expect(await readRun(two)).toEqual({ outcome: 'already_running', ...zero });
    expect(await readStoredMail()).toEqual({ outcome: 'already_running', ...zero });
    open();
    const first = (await held).body.data as LoyaltyInboxReadRun;
    expect([first.outcome, first.read]).toEqual(['ok', 2]);
    expect(rec.inputs.map(markOf)).toEqual([d.id, 'second']);
    expect((await rowOf(keyA)).state).toBe('applied');
    expect((await rowOf(keyB)).state).toBe('no_balance');

    // Held elsewhere: already running. The poll's lock does not block a read.
    const other = await db.connect();
    try {
      await other.query(`SELECT pg_advisory_lock(hashtext('b8:loyalty-inbox:read'))`);
      expect((await readStoredMail()).outcome).toBe('already_running');
      await other.query(`SELECT pg_advisory_unlock(hashtext('b8:loyalty-inbox:read'))`);
      await other.query(`SELECT pg_advisory_lock(hashtext('b8:loyalty-inbox:poll'))`);
      await store(w, 'other', marked('R01', 'during-poll'), -1, 'during-poll');
      expect((await readStoredMail()).outcome).toBe('ok');
      await other.query(`SELECT pg_advisory_unlock(hashtext('b8:loyalty-inbox:poll'))`);
    } finally {
      other.release();
    }
    // A throwing reader and a reader timeout both release the lock.
    await store(w, 'other', marked('R01', 'throws'), -1, 'throws');
    install(() => { throw new Error('reader failed'); });
    expect((await readStoredMail()).outcome).toBe('ok');
    expect(await lockHeld('b8:loyalty-inbox:read')).toBe(false);
    install(() => ({ ok: false, code: 'timeout' }));
    await readStoredMail();
    expect(await lockHeld('b8:loyalty-inbox:read')).toBe(false);

    // Two simultaneous applies on one item: one observation, one 200 and one 409.
    const q = C.decisions.find((x) => x.id === 'jump-over-up') as Fixture['decisions'][number];
    const qKey = await store(w, q.program, marked(q.eml, q.id), -1, q.id);
    install(byMark(new Map([[q.id, await resolve(q.reader)]])));
    await readStoredMail();
    const item = await rowOf(qKey);
    expect(item.state).toBe('pending');
    const obsBefore = await count('SELECT count(*) AS n FROM loyalty_observations');
    const both = await Promise.all([api.resolve(owner, item.id, { action: 'apply' }), api.resolve(two, item.id, { action: 'apply' })]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(both.find((r) => r.status === 409)?.body.error?.code).toBe('ITEM_RESOLVED');
    expect(await count('SELECT count(*) AS n FROM loyalty_observations')).toBe(obsBefore + 1);
  }, 30_000);

  it('T42c2-I6: apply, not mine and ignore do what they say, once, only for a write credential, and echo nothing', async () => {
    const w = await world();
    const pick = (id: string) => C.decisions.find((x) => x.id === id) as Fixture['decisions'][number];
    const ids = ['jump-over-up', 'suffix-ambiguous', 'as-of-missing', 'as-of-future', 'suffix-unmatched', 'zero-from-positive-queued'];
    const outputs = new Map<string, unknown>();
    const keys = new Map<string, string>();
    for (const id of ids) {
      outputs.set(id, await resolve(pick(id).reader));
      keys.set(id, await store(w, pick(id).program, marked(pick(id).eml, id), -1, id));
    }
    withKey();
    install(byMark(outputs));
    await readStoredMail();
    const itemOf = async (id: string) => rowOf(keys.get(id) as string);
    for (const id of ids) expect((await itemOf(id)).state, id).toBe('pending');
    const obs = () => count('SELECT count(*) AS n FROM loyalty_observations');

    // Authority first: a read token is 403 and changes nothing; no credential is 401.
    const jump = await itemOf('jump-over-up');
    const before = await obs();
    const denied = await api.resolve(readTok, jump.id, { action: 'apply' });
    expect([denied.status, denied.body.error?.code]).toEqual([403, 'INSUFFICIENT_SCOPE']);
    expect((await api.resolve(null, jump.id, { action: 'apply' })).status).toBe(401);
    const readDenied = await api.read(readTok);
    expect([readDenied.status, readDenied.body.error?.code]).toEqual([403, 'INSUFFICIENT_SCOPE']);
    expect((await api.read(null)).status).toBe(401);
    expect(await obs()).toBe(before);
    expect((await itemOf('jump-over-up')).state).toBe('pending');

    // Apply on a unique match (no membership in the body), by a write token.
    const ok = await api.resolve(writeTok, jump.id, { action: 'apply' });
    expect(ok.status).toBe(200);
    expect(LoyaltyInboxResolveResponseSchema.safeParse(ok.body).success).toBe(true);
    expect(ok.body.data).toEqual({ id: jump.id, state: 'applied_by_hand' });
    const jumpMs = w.membership.get(pick('jump-over-up').expect.membership as string) as number;
    expect(await currentBalance(jumpMs)).toBe((outputs.get('jump-over-up') as { balance: string }).balance);
    expect((await api.resolve(owner, jump.id, { action: 'apply' })).body.error?.code).toBe('ITEM_RESOLVED');
    expect((await api.resolve(owner, jump.id, { action: 'ignore' })).status).toBe(409);

    // An ambiguous item: a membership is required, and must be of the item's program.
    const amb = await itemOf('suffix-ambiguous');
    const missing = await api.resolve(owner, amb.id, { action: 'apply' });
    expect([missing.status, missing.body.error?.code]).toEqual([400, 'INVALID_INPUT']);
    const foreign = await api.resolve(owner, amb.id, { action: 'apply', membershipId: w.membership.get('s-unit') });
    expect([foreign.status, foreign.body.error?.code]).toEqual([400, 'INVALID_INPUT']);
    const ambTarget = w.membership.get('a-amb-2') as number;
    expect((await api.resolve(two, amb.id, { action: 'apply', membershipId: ambTarget })).status).toBe(200);
    expect(await currentBalance(ambTarget)).toBe((outputs.get('suffix-ambiguous') as { balance: string }).balance);

    // No as-of: dated by the day the mail arrived.
    const noDate = await itemOf('as-of-missing');
    expect((await api.resolve(owner, noDate.id, { action: 'apply' })).status).toBe(200);
    const dated = (await db.query(`SELECT as_of::text AS d FROM loyalty_observations WHERE id = (SELECT observation_id FROM loyalty_inbox_reads WHERE id = $1)`, [noDate.id])).rows[0].d;
    expect(dated).toBe(await pgDay(-1));
    // A future as-of is refused by hand too.
    const future = await itemOf('as-of-future');
    const refused = await api.resolve(owner, future.id, { action: 'apply' });
    expect([refused.status, refused.body.error?.code]).toEqual([400, 'INVALID_INPUT']);
    expect((await itemOf('as-of-future')).state).toBe('pending');
    // An older as-of is written as history and does not become current.
    const olderMs = w.membership.get('a-zero-cand') as number;
    await db.query(`INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source) SELECT $1, CURRENT_DATE, balance, unit, 'typed' FROM loyalty_observations WHERE membership_id = $1 ORDER BY id LIMIT 1`, [olderMs]);
    const currentBefore = await currentBalance(olderMs);
    const zeroItem = await itemOf('zero-from-positive-queued');
    expect((await api.resolve(owner, zeroItem.id, { action: 'apply' })).status).toBe(200);
    expect(await currentBalance(olderMs)).toBe(currentBefore);

    // Not mine: recorded, and a later reading of that suffix is discarded while no membership matches it.
    const un = await itemOf('suffix-unmatched');
    const unSuffix = un.suffix as string;
    const twin = await store(w, 'air', marked('R01', 'suffix-unmatched'), -1, 'suffix-unmatched-twin');
    await readStoredMail();
    expect((await rowOf(twin)).state).toBe('pending');
    const nm = await api.resolve(owner, un.id, { action: 'not_mine' });
    expect(nm.body.data).toEqual({ id: un.id, state: 'not_mine' });
    expect((await rowOf(twin)).state).toBe('not_mine');
    expect(await count('SELECT count(*) AS n FROM loyalty_inbox_not_mine WHERE program_id = $1 AND suffix = $2', [w.program.get('air'), unSuffix])).toBe(1);
    const later = await store(w, 'air', marked('R01', 'suffix-unmatched'), -1, 'suffix-unmatched-later');
    await readStoredMail();
    expect((await rowOf(later)).state).toBe('not_mine_known');
    // Once a membership carries the suffix, the record has no effect.
    await db.query('INSERT INTO loyalty_memberships (member_id, program_id, member_number) VALUES ($1, $2, $3)', [w.member.get('pb'), w.program.get('air'), `ZQ42C2X${unSuffix}`]);
    const afterAdd = await store(w, 'air', marked('R01', 'suffix-unmatched'), -1, 'suffix-unmatched-after');
    await readStoredMail();
    expect((await rowOf(afterAdd)).state).toBe('pending');
    expect((await rowOf(afterAdd)).reason).toBe('no_baseline');

    // Ignore: no record, no observation.
    const obsNow = await obs();
    const notMineNow = await count('SELECT count(*) AS n FROM loyalty_inbox_not_mine');
    const ig = await api.resolve(owner, (await rowOf(afterAdd)).id, { action: 'ignore' });
    expect(ig.body.data).toMatchObject({ state: 'ignored' });
    expect([await obs(), await count('SELECT count(*) AS n FROM loyalty_inbox_not_mine')]).toEqual([obsNow, notMineNow]);

    // Unknown id 404, malformed bodies and ids 400, and no message echoes what was sent.
    const echo = 'ZQ42C2-ECHO';
    expect((await api.resolve(owner, 2147483000, { action: 'ignore' })).status).toBe(404);
    for (const [id, body] of [[jump.id, { action: echo }], [jump.id, { action: 'apply', membershipId: echo }], [jump.id, { action: 'ignore', membershipId: 1 }], [echo, { action: 'ignore' }]] as const) {
      const r = await api.resolve(owner, id, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.text).not.toContain(echo);
    }
    const badRead = await api.readRaw(owner, `{"retryFailed":"${echo}"}`);
    expect(badRead.status).toBe(400);
    expect(badRead.text).not.toContain(echo);
    expect((await api.readRaw(owner, 'not json')).status).toBe(400);
    expect((await api.readRaw(owner, '')).status).toBe(200);

    // The owner and the second user see the identical panel.
    expect(JSON.stringify(await panelOf(two))).toBe(JSON.stringify(await panelOf(owner)));
  }, 30_000);

  it('T42c2-I7: hostile reader output reaches storage only as enums, dates, decimal text, a short suffix and checked arrays', async () => {
    const w = await world();
    const outputs = new Map<string, unknown>();
    const keys = new Map<string, string>();
    for (const c of C.clean) {
      outputs.set(c.id, c.input);
      keys.set(c.id, await store(w, 'air', marked('R01', c.id), -1, c.id));
    }
    withKey();
    install(byMark(outputs));
    await readStoredMail();
    await readStoredMail();
    const seen: string[] = [];
    for (const c of C.clean) {
      const row = await rowOf(keys.get(c.id) as string);
      expect(row, c.id).toBeDefined();
      // A balance the clean pass refused makes the row balance-less and never a queue item.
      if (c.expect.balance === null) expect(row.state, c.id).toBe('no_balance');
      if (row.balance !== null) expect(row.balance, c.id).toBe(c.expect.balance);
      seen.push(c.id);
    }
    expect(seen).toEqual(C.clean.map((c) => c.id));
    const textCols = (await db.query<{ t: string; c: string }>(
      `SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public'
         AND table_name IN ('loyalty_inbox_reads', 'loyalty_inbox_not_mine', 'loyalty_inbox_read_state') AND data_type = 'text'`)).rows;
    expect(textCols.length).toBeGreaterThan(5);
    const banned = ['<', '>', ' ', 'ignore', ...Object.values(K).flat().filter((v): v is string => typeof v === 'string')];
    for (const { t, c } of textCols) {
      for (const b of banned) expect(await count(`SELECT count(*) AS n FROM ${t} WHERE strpos(lower(${c}), lower($1)) > 0`, [b]), `${t}.${c} holds ${b}`).toBe(0);
    }
    for (const c of ['expiry_warnings', 'instruments']) {
      for (const b of ['<', '>', 'ignore', 'ZQ42C2', 'memberName', 'note']) expect(await count(`SELECT count(*) AS n FROM loyalty_inbox_reads WHERE strpos(${c}::text, $1) > 0`, [b]), `${c} holds ${b}`).toBe(0);
    }
    expect(await count(`SELECT count(*) AS n FROM loyalty_inbox_reads WHERE state = 'pending' AND balance IS NULL`)).toBe(0);
  }, 30_000);

  it('T42c2-I8: a reader that obeys the mail still cannot move a balance past the rules', async () => {
    const w = await world();
    const ids = ['injection-obedient-jump', 'injection-obedient-wrong-suffix', 'injection-obedient-within-bound'];
    const outputs = new Map<string, unknown>();
    const keys = new Map<string, string>();
    for (const id of ids) {
      const d = C.decisions.find((x) => x.id === id) as Fixture['decisions'][number];
      expect(d.eml).toBe('R05');
      outputs.set(id, await resolve(d.reader));
      keys.set(id, await store(w, d.program, marked(d.eml, id), -1, id));
    }
    withKey();
    const rec = install(byMark(outputs));
    await readStoredMail();
    expect(rec.inputs.every((i) => i.text.includes(K.injection))).toBe(true);
    for (const id of ids) {
      const d = C.decisions.find((x) => x.id === id) as Fixture['decisions'][number];
      const row = await rowOf(keys.get(id) as string);
      expect([row.state, row.reason], id).toEqual([d.expect.state, d.expect.reason]);
      if (d.expect.membership) expect(await currentBalance(w.membership.get(d.expect.membership) as number), id).toBe(d.expect.balanceAfter);
    }
    // The residual risk, stated: a newer, unit-matching reading within the bound DOES apply.
    expect((await rowOf(keys.get('injection-obedient-within-bound') as string)).state).toBe('applied');
    // No applied row lacks a suffix that ends exactly one membership number of its own program.
    const applied = (await db.query(`SELECT r.program_id, r.suffix, r.membership_id FROM loyalty_inbox_reads r WHERE r.state = 'applied'`)).rows;
    expect(applied.length).toBeGreaterThan(0);
    for (const a of applied) {
      const hits = (await db.query(`SELECT id FROM loyalty_memberships WHERE program_id = $1 AND upper(regexp_replace(coalesce(member_number, ''), '[^A-Za-z0-9]', '', 'g')) LIKE '%' || $2`, [a.program_id, a.suffix])).rows;
      expect(hits.map((h) => h.id)).toEqual([a.membership_id]);
    }
  });

  it('T42c2-I9: responses, the page and every log line carry counts, codes and a masked suffix, never a key, a body, a number or the model output', async () => {
    const w = await world();
    const full = K.memberNumber;
    await db.query('INSERT INTO loyalty_memberships (member_id, program_id, member_number) VALUES ($1, $2, $3)', [w.member.get('pa'), w.program.get('other'), full]);
    process.env.ANTHROPIC_BASE_URL = `https://${K.baseUrlHost}`;
    withKey();
    const keyQ = await store(w, 'other', marked('R01', 'privacy-queued'), -1, 'privacy-queued');
    await store(w, 'other', marked('R02', 'privacy-plain'), -2, 'privacy-plain');
    const suffix = full.slice(-4);
    install((input) => markOf(input) === 'privacy-queued'
      ? { ok: true, reading: { programName: null, memberNumberSuffix: full, balance: '5', unit: 'points', asOf: null, expiryWarnings: [], instruments: [], note: K.modelOutput, raw: input.text } }
      : { ok: false, code: 'bad_output' });
    const said: string[] = [];
    const runOk = await api.read(owner);
    said.push(runOk.text);
    expect((await rowOf(keyQ)).suffix).toBe(suffix);
    // Every outcome and error of both routes.
    install(() => ({ ok: false, code: 'rate_limited' }));
    await db.query(`DELETE FROM loyalty_inbox_reads WHERE state = 'retry'`);
    said.push((await api.read(owner)).text);
    withoutKey();
    said.push((await api.read(owner)).text);
    withKey();
    said.push((await api.read(readTok)).text, (await api.read(null)).text, (await api.readRaw(owner, `{"x":"${full}"}`)).text);
    const item = await rowOf(keyQ);
    said.push((await api.resolve(owner, item.id, { action: 'apply', membershipId: full })).text);
    said.push((await api.resolve(readTok, item.id, { action: 'ignore' })).text, (await api.resolve(null, item.id, { action: 'ignore' })).text);
    said.push((await api.resolve(owner, 2147483000, { action: 'ignore' })).text);
    for (const who of [owner, two]) said.push((await api.overview(who)).text);
    const overview = (await api.overview(owner)).body.data as LoyaltyOverview;
    const page = renderToStaticMarkup(createElement(TravelBoard, { overview }));
    said.push(page);
    said.push((await api.resolve(owner, item.id, { action: 'ignore' })).text, (await api.resolve(owner, item.id, { action: 'ignore' })).text);

    const secrets = [K.key, K.baseUrlHost, full, K.modelOutput, K.body, K.subject, K.urlToken, K.header, K.htmlVisible, ...K.addresses, 'track.zq42c2-brand.test'];
    for (const t of [...said, ...bodies, ...lines]) for (const s of secrets) expect(t.includes(s), `${s} in ${t.slice(0, 80)}`).toBe(false);
    // The panel carries exactly the contract keys, at every depth.
    const panel = overview.inboxRead;
    expect(Object.keys(panel).sort()).toEqual(['coverage', 'failed', 'fromMail', 'lastRead', 'needsAttention', 'needsAttentionTotal', 'readable', 'waiting']);
    expect(panel.needsAttention.length).toBeGreaterThan(0);
    for (const i of panel.needsAttention) {
      expect(Object.keys(i).sort()).toEqual(['asOf', 'balance', 'candidateMembershipIds', 'id', 'maskedSuffix', 'programId', 'reason', 'receivedOn', 'unit']);
      if (i.maskedSuffix !== null) expect(LoyaltyReadMaskedSuffixSchema.safeParse(i.maskedSuffix).success).toBe(true);
    }
    for (const c of panel.coverage) expect(Object.keys(c).sort()).toEqual(['balanceInLastStatement', 'programId']);
    expect(page).toContain('Needs attention: ');
  }, 30_000);

  it('T42c2-I10: the real reader, over loopback, makes one connection per attempt, fails as a code and frees the lock', async () => {
    const w = await world();
    const listen = async (onSocket: (s: Socket) => void) => {
      const server: Server = createServer(onSocket);
      await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
      return { server, port: (server.address() as { port: number }).port };
    };
    let connections = 0;
    const closing = await listen((s) => { connections++; s.destroy(); });
    const key = await store(w, 'other', marked('R01', 'loopback'), -1, 'loopback');
    withKey();
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${closing.port}`;
    H.reader = 'real';
    const from = lines.length;
    const result = await readStoredMail();
    closing.server.close();
    expect(result).toMatchObject({ outcome: 'ok', read: 0, failed: 1 });
    expect(connections).toBe(1);
    const row = await rowOf(key);
    expect([row.state, row.last_error_code, row.attempts]).toEqual(['retry', 'api_error', 1]);
    expect(await lockHeld('b8:loyalty-inbox:read')).toBe(false);
    const state = (await db.query('SELECT * FROM loyalty_inbox_read_state')).rows[0];
    for (const t of [JSON.stringify(result), JSON.stringify(row), JSON.stringify(state), ...lines.slice(from)]) {
      for (const s of [K.key, '127.0.0.1', String(closing.port), 'ECONNRESET', 'socket', 'Connection error']) expect(t.includes(s), `${s} in ${t.slice(0, 80)}`).toBe(false);
    }
    // Straight to stdout: console is captured above, and EVIDENCE.md quotes this count.
    process.stdout.write(`T42c2-I10 loopback connections: ${connections}\n`);

    // A listener that accepts and never answers, with a one-second timeout: `timeout`, lock freed.
    // The aborted call leaves the HTTP client opening a fresh idle socket, which carries no request, so
    // what is counted here is requests: sockets on which bytes arrived.
    const held: Socket[] = [];
    let requests = 0;
    const silent = await listen((s) => { held.push(s); s.once('data', () => { requests++; }); });
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${silent.port}`;
    process.env.LOYALTY_READ_TIMEOUT_SECONDS = '1';
    const timed = await readStoredMail();
    for (const s of held) s.destroy();
    silent.server.close();
    expect(timed).toMatchObject({ outcome: 'ok', failed: 1 });
    const row2 = await rowOf(key);
    expect([row2.state, row2.last_error_code, row2.attempts]).toEqual(['retry', 'timeout', 2]);
    expect(requests).toBe(1);
    expect(await lockHeld('b8:loyalty-inbox:read')).toBe(false);
  }, 30_000);

  it('T42c2-I11: retention is strict, coverage says yes, no or not read, the counts are right and a null is never a zero', async () => {
    const w = await world();
    const air = w.program.get('air') as number;
    const ins = async (day: number, state: string, extra: Record<string, unknown> = {}) => {
      const key = sha(`zq42c2-ret-${day}-${state}-${Math.random()}`);
      const base: Record<string, unknown> = { dedupe_key: key, program_id: air, state, attempts: 1 };
      const filled: Record<string, unknown> = state === 'retry' || state === 'failed'
        ? { ...base, last_error_code: 'timeout' }
        : { ...base, program_check: 'not_stated', reason: state === 'pending' ? 'no_suffix' : null, balance: state === 'no_balance' ? null : '0', unit: state === 'no_balance' ? null : 'points' };
      const row = { ...filled, ...extra };
      const cols = Object.keys(row);
      await db.query(
        `INSERT INTO loyalty_inbox_reads (received_on, read_on, resolved_on, ${cols.join(', ')})
         VALUES (CURRENT_DATE - $1::int, ${state === 'retry' || state === 'failed' ? 'NULL' : 'CURRENT_DATE'}, ${['retry', 'failed', 'pending'].includes(state) ? 'NULL' : 'CURRENT_DATE'}, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`,
        [day, ...cols.map((c) => row[c])]);
      return key;
    };
    // Retention: every state, kept at 399 and 400 days, deleted at 401, the not-mine list untouched.
    const kept: string[] = [];
    const gone: string[] = [];
    for (const state of ['pending', 'no_balance', 'failed']) {
      for (const d of C.retention.keptDays) kept.push(await ins(d, state));
      for (const d of C.retention.deletedDays) gone.push(await ins(d, state));
    }
    const notMine = await count('SELECT count(*) AS n FROM loyalty_inbox_not_mine');
    expect(await purgeExpiredReads()).toBe(gone.length);
    expect(await purgeExpiredReads()).toBe(0);
    for (const k of kept) expect(await rowOf(k)).toBeDefined();
    for (const k of gone) expect(await rowOf(k)).toBeUndefined();
    expect(await count('SELECT count(*) AS n FROM loyalty_inbox_not_mine')).toBe(notMine);
    expect(await count(`SELECT count(*) AS n FROM loyalty_inbox_reads WHERE received_on < CURRENT_DATE - 400`)).toBe(0);
    await db.query('DELETE FROM loyalty_inbox_reads');

    // Never read: no lastRead, coverage not_read for every program with a domain, never "no".
    let panel = await panelOf();
    expect(panel.lastRead).toBeNull();
    expect(panel.coverage.filter((c) => [...w.program.values()].includes(c.programId)).map((c) => c.balanceInLastStatement)).toEqual(C.programs.map(() => 'not_read'));
    // Coverage follows the newest read row's balance, whatever its state; retry and failed rows do not count.
    const stays = w.program.get('stays') as number;
    const cash = w.program.get('cash') as number;
    await ins(5, 'pending', { program_id: air, reason: 'no_suffix', balance: '0', unit: 'points' });
    await ins(3, 'no_balance', { program_id: stays });
    await ins(6, 'stale', { program_id: stays, suffix: 'AB12', as_of: await pgDay(-6), balance: '1', unit: 'points', program_check: 'match' });
    await ins(1, 'failed', { program_id: cash });
    await ins(2, 'retry', { program_id: cash });
    panel = await panelOf();
    const cov = new Map(panel.coverage.map((c) => [c.programId, c.balanceInLastStatement]));
    expect([cov.get(air), cov.get(stays), cov.get(cash), cov.get(w.program.get('other') as number)]).toEqual(['yes', 'no', 'not_read', 'not_read']);
    expect(panel.failed).toBe(1);
    // A zero balance is present in an item, never dropped.
    expect(panel.needsAttention.map((i) => i.balance)).toEqual(['0']);
    // waiting: stored with bytes and unread or in retry; a message without bytes is not counted.
    await store(w, 'air', marked('R01', 'w1'), -1, 'w1');
    await store(w, 'air', null, -1, 'w-no-bytes');
    expect((await panelOf()).waiting).toBe(1);
    // lastRead after a run: ok, then error with its code.
    withKey();
    install(() => ({ ok: true, reading: {} }));
    await readStoredMail();
    expect((await panelOf()).lastRead).toEqual({ on: await pgDay(0), outcome: 'ok', errorCode: null });
    await store(w, 'air', marked('R01', 'w2'), -1, 'w2');
    install(() => ({ ok: false, code: 'rate_limited' }));
    await readStoredMail();
    expect((await panelOf()).lastRead).toEqual({ on: await pgDay(0), outcome: 'error', errorCode: 'rate_limited' });
    // The list is capped at the queue limit; the total is not.
    await db.query('DELETE FROM loyalty_inbox_reads');
    for (let k = 0; k < LOYALTY_READ_QUEUE_LIMIT + 2; k++) await ins(1, 'pending');
    panel = await panelOf();
    expect([panel.needsAttention.length, panel.needsAttentionTotal]).toEqual([LOYALTY_READ_QUEUE_LIMIT, LOYALTY_READ_QUEUE_LIMIT + 2]);
    // fromMail: the newest qualifying row per membership; never pending, never both arrays empty.
    await db.query('DELETE FROM loyalty_inbox_reads');
    const ms = w.membership.get('a-nobal') as number;
    const warn = (n: number) => JSON.stringify([{ what: 'miles', expiresOn: '2027-01-01', amount: String(n) }]);
    await ins(9, 'no_balance', { membership_id: ms, program_check: 'match', expiry_warnings: warn(1) });
    await ins(8, 'no_balance', { membership_id: ms, program_check: 'match', expiry_warnings: warn(2) });
    await ins(7, 'no_balance', { membership_id: ms, program_check: 'match' });
    await ins(1, 'pending', { membership_id: ms, reason: 'program_mismatch', program_check: 'mismatch', expiry_warnings: warn(3) });
    panel = await panelOf();
    expect(panel.fromMail.map((f) => [f.membershipId, f.expiryWarnings[0]?.amount])).toEqual([[ms, '2']]);
  }, 30_000);

  it('T42c2-I12: a read, a purge and every queue action move only the reads tables and email observations; the ledger and net worth stay put', async () => {
    const w = await world();
    const netBefore = await computeCurrentNetWorth();
    const ledgerBefore = await sumOf(LEDGER);
    const CORE = UNMOVED.filter((t) => t !== 'household_member_addresses' && t !== 'loyalty_inbox_messages');
    const coreBefore = await sumOf(CORE);
    const addressesBefore = await sumWhole(['household_member_addresses', 'loyalty_inbox_unknown_senders']);
    const instrumentsBefore = await count('SELECT count(*) AS n FROM loyalty_instruments');
    const obsBefore = (await db.query('SELECT id FROM loyalty_observations')).rows.map((r) => r.id);
    const ids = ['apply-ok', 'expiry-only', 'jump-over-up', 'suffix-unmatched', 'as-of-missing'];
    const outputs = new Map<string, unknown>();
    const keys = new Map<string, string>();
    for (const id of ids) {
      const d = C.decisions.find((x) => x.id === id) as Fixture['decisions'][number];
      outputs.set(id, await resolve(d.reader));
      keys.set(id, await store(w, d.program, marked(d.eml, id), -1, id));
    }
    const messagesBefore = await sumOf(['loyalty_inbox_messages']);
    withKey();
    install(byMark(outputs));
    await readStoredMail();
    await purgeExpiredReads();
    await api.resolve(owner, (await rowOf(keys.get('jump-over-up') as string)).id, { action: 'apply' });
    await api.resolve(owner, (await rowOf(keys.get('suffix-unmatched') as string)).id, { action: 'not_mine' });
    await api.resolve(owner, (await rowOf(keys.get('as-of-missing') as string)).id, { action: 'ignore' });

    expect(await computeCurrentNetWorth()).toEqual(netBefore);
    expect(await sumOf(LEDGER)).toBe(ledgerBefore);
    expect(await sumOf(CORE)).toBe(coreBefore);
    expect(await sumOf(['loyalty_inbox_messages'])).toBe(messagesBefore);
    expect(await sumWhole(['household_member_addresses', 'loyalty_inbox_unknown_senders'])).toBe(addressesBefore);
    expect(await count('SELECT count(*) AS n FROM loyalty_instruments')).toBe(instrumentsBefore);
    // The only new observations are the two applies, both from mail; no old row changed.
    const added = (await db.query(`SELECT id, source FROM loyalty_observations WHERE NOT (id = ANY($1::int[]))`, [obsBefore])).rows;
    expect(added.map((r) => r.source)).toEqual(['email', 'email']);
    expect(await count('SELECT count(*) AS n FROM loyalty_memberships WHERE program_id = ANY($1::int[])', [[...w.program.values()]])).toBe(C.memberships.length);
    // The loyalty routes number fourteen and the two new ones are classified no-transaction-data.
    const dir = join(WEB, 'app/api/v1/loyalty');
    const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith('route.ts')).map((f) => relative(WEB, join(dir, f)).split('\\').join('/'));
    expect(files).toHaveLength(14);
    for (const f of ['app/api/v1/loyalty/inbox/read/route.ts', 'app/api/v1/loyalty/inbox/readings/[id]/route.ts']) {
      expect(ROUTES.find((x) => x.file === f)?.classes, f).toEqual(['no-transaction-data']);
    }
  });

  it('T42c2-I13: the daily job reads after the poll and before the digest, and a read failure never costs the digest or leaks', async () => {
    const w = await world();
    await runDailyJob();
    expect(H.order.filter((s) => ['inbox', 'read', 'digest'].includes(s))).toEqual(['inbox', 'read', 'digest']);
    // With the key unset the read step wrote nothing.
    await store(w, 'air', marked('R01', 'daily'), -1, 'daily');
    H.order.length = 0;
    await runDailyJob();
    expect(H.order).toContain('digest');
    expect(await count('SELECT count(*) AS n FROM loyalty_inbox_reads')).toBe(0);
    expect((await db.query('SELECT last_outcome FROM loyalty_inbox_read_state')).rows[0].last_outcome).toBeNull();
    // A reader that rejects with the key in its message: the job resolves, the digest runs, nothing leaks.
    withKey();
    H.reader = { read: async () => { throw new Error(`failure ${K.key}`); } };
    H.order.length = 0;
    const from = lines.length;
    await runDailyJob();
    expect(H.order).toContain('digest');
    for (const t of lines.slice(from)) expect(t).not.toContain(K.key);
    // The step purges rows past retention.
    await db.query(`INSERT INTO loyalty_inbox_reads (dedupe_key, program_id, received_on, state, attempts, last_error_code)
                    VALUES ($1, $2, CURRENT_DATE - 401, 'failed', 1, 'timeout')`, [sha('zq42c2-old'), w.program.get('air')]);
    withoutKey();
    await runLoyaltyReadDaily();
    expect(await count(`SELECT count(*) AS n FROM loyalty_inbox_reads WHERE received_on < CURRENT_DATE - 400`)).toBe(0);
  }, 30_000);

  it('T42c2-I14: the reader receives exactly the subject and text of each stored message, bounded, and nothing for a message with nothing to read', async () => {
    const w = await world();
    const keys = new Map<string, string>();
    for (const [k, name] of ['R01', 'R02', 'R03', 'R04', 'R05', 'R06'].entries()) keys.set(name, await store(w, 'other', Buffer.from(emlText(name), 'utf8'), -10 + k, name));
    const gone = await store(w, 'other', null, -1, 'gone');
    withKey();
    const rec = install(() => ({ ok: true, reading: {} }));
    await readStoredMail();
    expect(rec.inputs).toHaveLength(5);
    for (const i of rec.inputs) expect(Object.keys(i).sort()).toEqual(['subject', 'text']);
    const [r01, r02, r04, r05, r06] = rec.inputs;
    const all01 = `${r01.subject}\n${r01.text}`;
    expect(r01.subject).toContain(K.subject);
    expect(r01.text).toContain(K.body);
    for (const s of [K.header, K.urlToken, 'zq42c2-r01@', 'Delivered-To', 'Received', ...K.addresses]) expect(all01).not.toContain(s);
    expect(r02.text).toContain(K.htmlVisible);
    for (const s of [K.script, K.urlTokenHtml, '<p>', 'href']) expect(r02.text).not.toContain(s);
    expect(Array.from(r04.text).length).toBeLessThanOrEqual(LOYALTY_READ_MAX_CHARS);
    expect(r04.text).toContain(K.head);
    expect(r04.text).not.toContain(K.tail);
    expect(r05.text).toContain(K.injection);
    expect(r06.text).toContain(K.textPart);
    expect(r06.text).not.toContain(K.htmlPart);
    const r03 = await rowOf(keys.get('R03') as string);
    expect([r03.state, r03.last_error_code, r03.attempts]).toEqual(['failed', 'empty_message', 1]);
    expect(rec.inputs.some((i) => i.text.includes(K.attachment))).toBe(false);
    expect(await rowOf(gone)).toBeUndefined();
    // The privacy sweep of the whole file, now that every test has run.
    for (const t of [...bodies, ...lines]) for (const s of [K.key, K.memberNumber, K.modelOutput, K.body]) expect(t.includes(s), `${s} in ${t.slice(0, 80)}`).toBe(false);
  });
});
