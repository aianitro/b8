// P8-42c4 — the loyalty read tells the truth about what happened, through the real `readStoredMail`,
// `loadReadOverview`, `resolveReading`, the read route and Postgres (I1–I6): a body whose read fails
// starts nothing; a failed ROLLBACK is logged once in a fixed shape and never decides the outcome; the
// stored last read equals the answer in every combination of read, count, purge and state-write
// failure; a `retry` row whose bytes are gone is counted failed; bytes that vanish mid-run are not a
// terminal `empty_message`; and the panel's figures come from one snapshot.
//
// TIER 2, collected by `vitest.integration.config.mts` with the scratch-database guard in its setup
// files, like `loyaltyRead.test.ts` beside it. The owner signs in through the real passkey path
// (`../auth/secondUserTestKit.ts`); bearer tokens are minted with `createPersonalToken`. Every handler
// is called directly with a `NextRequest`.
//
// THE READER IS A FAKE, mocked exactly as 42c2's suite mocks it: `createMailReader` returns whatever
// fake the test installed, and with none installed answers `api_error` and counts the call, so a read
// nobody expected is seen. Its readings are `{}` or a classified failure; no test reaches a model.
//
// THE DATA IS FABRICATED IN THIS FILE. One program `ZQ42C4 …` with a sender domain on `.test`, and
// plain-text messages with no figures. The two queue items that must carry a balance (the CHECKs
// demand one on a `pending`, `ignored` or `applied` row) take it from the pinned 42c2 fixture, which
// this file reads and never edits, so no balance literal is written here.
//
// FAULTS ARE INSTALLED BY MEANS THIS FILE ALWAYS REMOVES, never by timing: statement-level triggers
// and functions named `zq42c4_*` (dropped in a `finally`, and again after every test), spies on
// `db.query` and `db.connect` that delegate to the real functions for everything they do not target,
// and proxied clients. A proxied ROLLBACK that is made to fail runs the real ROLLBACK first, so no
// connection goes back to the pool inside an aborted transaction.
//
// THE ENVIRONMENT. Tests set `ANTHROPIC_API_KEY` to a key canary themselves (or leave it unset) and
// the previous environment is restored afterwards. Every console line of the whole file is captured,
// for the privacy and log-shape checks.
//
// CLEANUP IS OF THIS SUITE'S OWN ROWS: the reads rows and stored messages of the `ZQ42C4 …` program,
// its observations, membership and sender domain, the program and members themselves, the read state
// reset to never-read, the test triggers and functions, and the auth tables through `resetAuth`.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient, QueryResult } from 'pg';
import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { createPersonalToken } from '@/lib/authSession';
import { loadReadOverview, readStoredMail, resolveReading } from '@/lib/loyaltyInboxRead';
import type { Queryable } from '@/lib/loyaltyStore';
import type { MailReader, MailReaderInput, MailReaderResult } from '@/lib/loyaltyReader';
import {
  LoyaltyOverviewResponseSchema,
  LOYALTY_READ_RETENTION_DAYS,
  type LoyaltyInboxReadPanel,
  type LoyaltyInboxReadRun,
  type LoyaltyUnit,
} from '@b8/contracts/loyalty';
import { bearer, bootstrapOwner, cookie, resetAuth, type EnrolledUser } from '../auth/secondUserTestKit';
import { GET as overviewGET } from './route';
import { POST as readPOST } from './inbox/read/route';

// ─── Mocks ─────────────────────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  /** The reader the next `createMailReader` call returns. */
  reader: null as null | { read(input: { subject: string | null; text: string }): Promise<unknown> },
  /** Reads made with no fake installed. */
  unexpected: 0,
}));

vi.mock('@/lib/loyaltyReader', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/loyaltyReader')>();
  return {
    ...real,
    createMailReader: vi.fn(() => {
      if (H.reader === null) return { read: async () => { H.unexpected++; return { ok: false, code: 'api_error' }; } };
      return H.reader;
    }),
  };
});

// ─── The fabricated world ──────────────────────────────────────────────────────────────────────

const PROGRAM = 'ZQ42C4 Robust Rewards';
const DOMAIN = 'zq42c4-rewards.test';
const MEMBER = 'ZQ42C4 Holder';
const SUBJECT = 'ZQ42C4 your statement is ready';
const FROM = `statements@${DOMAIN}`;
const TO = 'zq42c4-holder@example.com';
const KEY = 'zq42c4-key-canary-not-a-real-key';
/** What the erroring request body sends before it fails: a response must never repeat it. */
const SENT = 'ZQ42C4-SENT-BEFORE-THE-ERROR';
const ORIGINAL = 'ZQ42C4-ORIGINAL';
const ROLLBACK_TEXT = 'ZQ42C4-ROLLBACK';
const MARK = 'ZQ42C4-MARK';

/** A balance and unit for the rows the CHECKs require one on, from the pinned 42c2 fixture. */
const FIX = JSON.parse(readFileSync(join(fileURLToPath(new URL('../../../../lib/fixtures/loyalty-read/', import.meta.url)), 'cases.json'), 'utf8')) as {
  memberships: { id: string; baseline: { balance: string; unit: LoyaltyUnit } | null }[];
};
const HELD = FIX.memberships.find((m) => m.id === 'a-apply')?.baseline as { balance: string; unit: LoyaltyUnit };

let seq = 0;
const label = (p: string) => `${p}-${++seq}`;
const dedupe = (l: string) => createHash('sha256').update(`zq42c4-robust-${l}`).digest('hex');

/** A plain-text message with no figures; `body` empty gives bytes that yield no text. */
const mail = (body: string) => Buffer.from(
  [`From: ZQ42C4 Rewards <${FROM}>`, `To: ${TO}`, `Subject: ${SUBJECT}`, 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8', '', body, ''].join('\r\n'),
  'utf8'
);
const marked = (name: string) => mail(`ZQ42C4 your monthly statement is ready to view.\n${MARK} ${name}`);

async function clearWorld(): Promise<void> {
  await dropFaults();
  const ours = `SELECT id FROM loyalty_programs WHERE name LIKE 'ZQ42C4%'`;
  await db.query(`DELETE FROM loyalty_inbox_reads WHERE program_id IN (${ours})`);
  await db.query(`DELETE FROM loyalty_inbox_messages WHERE program_id IN (${ours})`);
  await db.query(`DELETE FROM loyalty_observations WHERE membership_id IN (SELECT id FROM loyalty_memberships WHERE program_id IN (${ours}))`);
  await db.query(`DELETE FROM loyalty_memberships WHERE program_id IN (${ours})`);
  await db.query(`DELETE FROM loyalty_sender_domains WHERE program_id IN (${ours})`);
  await db.query(`DELETE FROM loyalty_programs WHERE name LIKE 'ZQ42C4%'`);
  await db.query(`DELETE FROM household_members WHERE display_name LIKE 'ZQ42C4%'`);
  await db.query('UPDATE loyalty_inbox_read_state SET last_read_on = NULL, last_outcome = NULL, last_error_code = NULL WHERE id = 1');
}

/** The one program with its sender domain; returns its id. */
async function world(): Promise<number> {
  const id = (await db.query<{ id: number }>(`INSERT INTO loyalty_programs (name, kind, default_unit) VALUES ($1, 'airline', $2) RETURNING id`,
    [PROGRAM, HELD.unit])).rows[0].id;
  await db.query('INSERT INTO loyalty_sender_domains (program_id, domain) VALUES ($1, $2)', [id, DOMAIN]);
  return id;
}

/** Stores one message received `day` days from today, with bytes or (null) with none; returns its key. */
async function store(programId: number, name: string, raw: Buffer | null, day = -1): Promise<string> {
  const key = dedupe(name);
  await db.query(
    `INSERT INTO loyalty_inbox_messages (dedupe_key, received_on, program_id, sender_domain, origin, attribution, raw_mail, oversize)
     VALUES ($1, CURRENT_DATE + $2::int, $3, $4, 'direct', 'none_found', $5, $6)`,
    [key, day, programId, DOMAIN, raw, raw === null]
  );
  return key;
}

/** An unread-side reads row: `retry` or `failed`, with an attempt count and a code. */
async function seedAttempt(programId: number, key: string, state: 'retry' | 'failed', attempts: number, code: string, day = -1): Promise<void> {
  await db.query(
    `INSERT INTO loyalty_inbox_reads (dedupe_key, program_id, received_on, state, attempts, last_error_code)
     VALUES ($1, $2, CURRENT_DATE + $3::int, $4, $5, $6)`,
    [key, programId, day, state, attempts, code]
  );
}

/** A read reads row with no suffix: `pending` (queued) or `ignored` (already resolved). */
async function seedQueued(programId: number, key: string, state: 'pending' | 'ignored', q: Queryable = db): Promise<number> {
  return (await q.query<{ id: number }>(
    `INSERT INTO loyalty_inbox_reads (dedupe_key, program_id, received_on, state, attempts, reason, balance, unit, program_check, read_on, resolved_on)
     VALUES ($1, $2, CURRENT_DATE - 1, $3, 1, 'no_suffix', $4::numeric, $5, 'match', CURRENT_DATE,
             CASE WHEN $3 = 'pending' THEN NULL ELSE CURRENT_DATE END)
     RETURNING id`,
    [key, programId, state, HELD.balance, HELD.unit]
  )).rows[0].id;
}

/** An `applied` reads row, with the membership and the observation the CHECKs demand of it. */
async function seedApplied(programId: number, key: string): Promise<void> {
  const member = (await db.query<{ id: number }>('INSERT INTO household_members (display_name) VALUES ($1) RETURNING id', [MEMBER])).rows[0].id;
  const ms = (await db.query<{ id: number }>('INSERT INTO loyalty_memberships (member_id, program_id) VALUES ($1, $2) RETURNING id', [member, programId])).rows[0].id;
  const obs = (await db.query<{ id: number }>(
    `INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source) VALUES ($1, CURRENT_DATE - 1, $2::numeric, $3, 'email') RETURNING id`,
    [ms, HELD.balance, HELD.unit]
  )).rows[0].id;
  await db.query(
    `INSERT INTO loyalty_inbox_reads (dedupe_key, program_id, received_on, state, attempts, suffix, balance, unit, as_of, program_check,
                                      membership_id, observation_id, read_on, resolved_on)
     VALUES ($1, $2, CURRENT_DATE - 1, 'applied', 1, 'ZQC', $3::numeric, $4, CURRENT_DATE - 1, 'match', $5, $6, CURRENT_DATE, CURRENT_DATE)`,
    [key, programId, HELD.balance, HELD.unit, ms, obs]
  );
}

/** Seeds the stored last read: a known earlier read, `days` before today. */
async function seedState(outcome: 'ok' | 'error', code: string | null, days: number): Promise<void> {
  await db.query('UPDATE loyalty_inbox_read_state SET last_read_on = CURRENT_DATE - $1::int, last_outcome = $2, last_error_code = $3 WHERE id = 1',
    [days, outcome, code]);
}
const stateRow = async () => (await db.query<{ on: string | null; outcome: string | null; code: string | null; today: string }>(
  `SELECT last_read_on::text AS "on", last_outcome AS outcome, last_error_code AS code, CURRENT_DATE::text AS today FROM loyalty_inbox_read_state WHERE id = 1`
)).rows[0];

const count = async (sql: string, values: unknown[] = []) => Number((await db.query<{ n: string }>(sql, values)).rows[0].n);
const rowOf = async (key: string) => (await db.query<{ state: string; attempts: number; last_error_code: string | null }>(
  'SELECT state, attempts, last_error_code FROM loyalty_inbox_reads WHERE dedupe_key = $1', [key])).rows[0];
/** A checksum of a whole reads row, every column, so "unchanged" means unchanged. */
const rowSum = async (key: string) => (await db.query<{ s: string }>(`SELECT md5(r::text) AS s FROM loyalty_inbox_reads r WHERE dedupe_key = $1`, [key])).rows[0]?.s ?? null;
const tableSum = async (table: 'loyalty_inbox_reads' | 'loyalty_inbox_messages') => (await db.query<{ s: string }>(
  `SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), '')) AS s FROM ${table} x`)).rows[0].s;

type Answerer = (input: MailReaderInput) => MailReaderResult | Promise<MailReaderResult>;
/** A fake reader that records what it was given and answers through `answer`. */
function install(answer: Answerer): { inputs: MailReaderInput[] } {
  const rec = { inputs: [] as MailReaderInput[] };
  const reader: MailReader = { read: async (input) => { rec.inputs.push(input); return answer(input); } };
  H.reader = reader;
  return rec;
}
const nothingRead: Answerer = () => ({ ok: true, reading: {} });

// ─── Fault injection, always removed ───────────────────────────────────────────────────────────

const FAIL_FN = `CREATE OR REPLACE FUNCTION zq42c4_fail() RETURNS trigger LANGUAGE plpgsql AS $f$
  BEGIN RAISE EXCEPTION 'zq42c4 injected failure'; END $f$`;
const VANISH_FN = `CREATE OR REPLACE FUNCTION zq42c4_vanish() RETURNS trigger LANGUAGE plpgsql AS $f$
  BEGIN
    IF NEW.dedupe_key = TG_ARGV[0] THEN
      IF TG_ARGV[1] = 'delete' THEN
        DELETE FROM loyalty_inbox_messages WHERE dedupe_key = NEW.dedupe_key;
      ELSE
        UPDATE loyalty_inbox_messages SET raw_mail = NULL, oversize = true WHERE dedupe_key = NEW.dedupe_key;
      END IF;
    END IF;
    RETURN NULL;
  END $f$`;

async function failPurge(): Promise<void> {
  await db.query(FAIL_FN);
  await db.query('CREATE TRIGGER zq42c4_purge_fail BEFORE DELETE ON loyalty_inbox_reads FOR EACH STATEMENT EXECUTE FUNCTION zq42c4_fail()');
}
async function failStateWrite(): Promise<void> {
  await db.query(FAIL_FN);
  await db.query('CREATE TRIGGER zq42c4_state_fail BEFORE UPDATE ON loyalty_inbox_read_state FOR EACH STATEMENT EXECUTE FUNCTION zq42c4_fail()');
}
/** Removes the bytes of the message `key` in the same statement that counts its attempt. */
async function vanishOnAttempt(key: string, how: 'delete' | 'null'): Promise<void> {
  await db.query(VANISH_FN);
  await db.query(`CREATE TRIGGER zq42c4_vanish AFTER INSERT OR UPDATE ON loyalty_inbox_reads FOR EACH ROW EXECUTE FUNCTION zq42c4_vanish('${key}', '${how}')`);
}
async function dropFaults(): Promise<void> {
  await realQuery('DROP TRIGGER IF EXISTS zq42c4_purge_fail ON loyalty_inbox_reads');
  await realQuery('DROP TRIGGER IF EXISTS zq42c4_vanish ON loyalty_inbox_reads');
  await realQuery('DROP TRIGGER IF EXISTS zq42c4_state_fail ON loyalty_inbox_read_state');
  await realQuery('DROP FUNCTION IF EXISTS zq42c4_fail()');
  await realQuery('DROP FUNCTION IF EXISTS zq42c4_vanish()');
}

type Query = typeof db.query;
/** The pool's own functions, captured before any spy, so a spy and a cleanup can always reach them. */
const realQuery: Query = db.query.bind(db);
const realConnect = db.connect.bind(db);

/** Spies on the pool's `query`: `reject(text)` true rejects that statement; every other one is delegated. */
function poolFault(reject: (text: string) => boolean) {
  const seen: string[] = [];
  const spy = vi.spyOn(db, 'query').mockImplementation(((text: string, values?: unknown[]) => {
    seen.push(text);
    if (reject(text)) return Promise.reject(new Error('zq42c4 injected pool failure'));
    return realQuery(text, values);
  }) as unknown as Query);
  return { seen, restore: () => spy.mockRestore() };
}

/**
 * Spies on the pool's `connect`, handing out the real client behind a proxy whose `query` goes
 * through `intercept` (which calls `forward` to send the statement for real) and whose `release` is
 * counted. Every forwarded statement is kept in `inflight`, so an interleave can wait for all of them.
 */
type Intercept = (text: string, forward: () => Promise<QueryResult>) => Promise<QueryResult>;
function tapConnect(intercept: Intercept) {
  const tap = { seen: [] as string[], releases: 0, connects: 0, inflight: [] as Promise<unknown>[] };
  const spy = vi.spyOn(db, 'connect').mockImplementation(async () => {
    const client = await realConnect();
    tap.connects++;
    const query = (text: string, values?: unknown[]) => {
      tap.seen.push(text);
      return intercept(text, () => {
        const p = client.query(text, values);
        tap.inflight.push(p.catch(() => null));
        return p;
      });
    };
    return new Proxy(client, {
      get(target, prop) {
        if (prop === 'query') return query;
        if (prop === 'release') return (destroy?: boolean) => { tap.releases++; target.release(destroy); };
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    }) as PoolClient;
  });
  return { tap, restore: () => spy.mockRestore() };
}

// ─── Requests ──────────────────────────────────────────────────────────────────────────────────

const ORIGIN = 'http://localhost:3000';
type Who = EnrolledUser | { bearer: string } | null;
/** A body stream that sends a little, then errors; `pulled` says whether anything ever read it. */
function erroringBody() {
  const flag = { pulled: false };
  let sent = false;
  // highWaterMark 0: the stream asks for nothing until somebody reads it, so `pulled` is a read.
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      flag.pulled = true;
      if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode(SENT)); return; }
      controller.error(new Error('zq42c4 body stream failed'));
    },
  }, { highWaterMark: 0 });
  return { stream, flag };
}
function readReq(who: Who, body: string | ReadableStream<Uint8Array> | undefined): NextRequest {
  const auth = who === null ? {} : 'bearer' in who ? bearer(who.bearer) : cookie(who.token);
  const init = {
    method: 'POST',
    headers: { host: 'localhost:3000', 'content-type': 'application/json', ...auth },
    body,
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  };
  return new NextRequest(`${ORIGIN}/api/v1/loyalty/inbox/read`, init as ConstructorParameters<typeof NextRequest>[1]);
}
interface Answer { status: number; text: string; body: { success?: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } } }
async function answerOf(response: Response | Promise<Response>): Promise<Answer> {
  const res = await response;
  const text = await res.text();
  let body: Answer['body'] = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, text, body };
}
const post = (who: Who, body: string | ReadableStream<Uint8Array> | undefined) => answerOf(readPOST(readReq(who, body)));

// ─── Captured lines and the environment ────────────────────────────────────────────────────────

const ENV_NAMES = ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'LOYALTY_READ_TIMEOUT_SECONDS'];
let savedEnv: Record<string, string | undefined> = {};
const withKey = () => { process.env.ANTHROPIC_API_KEY = KEY; };
const withoutKey = () => { delete process.env.ANTHROPIC_API_KEY; };

/** Every console line of the file (the logger writes through console). */
const lines: string[] = [];
const rollbackLines = (from: number) => lines.slice(from).filter((l) => l.includes('loyalty read rollback failed'));
/** No captured line carries an injected error text, SQL, the key, the subject or an address. */
function expectPrivateLines(): void {
  for (const l of lines) {
    for (const bad of [ORIGINAL, ROLLBACK_TEXT, SENT, 'zq42c4 injected', 'loyalty_inbox_reads', 'UPDATE ', KEY, SUBJECT, FROM, TO]) {
      expect(l.includes(bad), `a captured line carries ${bad}`).toBe(false);
    }
  }
}

let owner: EnrolledUser;
let readTok: { bearer: string };
let writeTok: { bearer: string };

beforeAll(async () => {
  const capture = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  for (const m of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(capture);
  savedEnv = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
  await clearWorld();
  await resetAuth();
  owner = await bootstrapOwner();
  readTok = { bearer: (await createPersonalToken({ label: 'zq42c4 read', scope: 'read', userId: owner.userId })).token };
  writeTok = { bearer: (await createPersonalToken({ label: 'zq42c4 write', scope: 'full', userId: owner.userId })).token };
}, 60_000);

beforeEach(async () => {
  H.reader = null;
  H.unexpected = 0;
  for (const n of ENV_NAMES) delete process.env[n];
  await clearWorld();
});

afterEach(async () => {
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

// ─── Scenarios ─────────────────────────────────────────────────────────────────────────────────

describe('the loyalty read tells the truth about what happened (P8-42c4)', () => {
  it('T42c4-I1: a failed body read answers the invalid response and starts nothing; an empty or absent body still reads; the caller comes first', async () => {
    const programId = await world();
    await store(programId, label('unread'), marked('unread'));
    await seedState('error', 'rate_limited', 3);
    const stateBefore = await stateRow();
    const mailBefore = await tableSum('loyalty_inbox_messages');
    withKey();
    const rec = install(nothingRead);

    // (a) The erroring body with a write-scope bearer: exactly the invalid-JSON answer, nothing started.
    const notJson = await post(writeTok, '{not json');
    expect([notJson.status, notJson.body.error?.code]).toEqual([400, 'INVALID_INPUT']);
    const broken = erroringBody();
    const failedRead = await post(writeTok, broken.stream);
    expect(broken.flag.pulled).toBe(true);
    expect([failedRead.status, failedRead.body.success, failedRead.body.error?.code]).toEqual([notJson.status, false, notJson.body.error?.code]);
    expect(failedRead.text).not.toContain(SENT);
    expect(rec.inputs).toHaveLength(0);
    expect(H.unexpected).toBe(0);
    expect(await count(`SELECT count(*) AS n FROM loyalty_inbox_reads WHERE program_id = $1`, [programId])).toBe(0);
    expect(await stateRow()).toEqual(stateBefore);
    expect(await tableSum('loyalty_inbox_messages')).toBe(mailBefore);

    // (b) Authorisation still comes first: neither refusal ever pulls the stream.
    const anon = erroringBody();
    const noCred = await post(null, anon.stream);
    expect(noCred.status).toBe(401);
    expect(anon.flag.pulled).toBe(false);
    const readOnly = erroringBody();
    const scoped = await post(readTok, readOnly.stream);
    expect([scoped.status, scoped.body.error?.code]).toEqual([403, 'INSUFFICIENT_SCOPE']);
    expect(readOnly.flag.pulled).toBe(false);
    expect(rec.inputs).toHaveLength(0);

    // (c) An empty body and an absent body are `{}` and read the stored message, once each.
    const empty = await post(writeTok, '');
    expect([empty.status, empty.body.data?.outcome, empty.body.data?.read]).toEqual([200, 'ok', 1]);
    expect(rec.inputs).toHaveLength(1);
    await store(programId, label('unread'), marked('unread'));
    const absent = await post(writeTok, undefined);
    expect([absent.status, absent.body.data?.outcome, absent.body.data?.read]).toEqual([200, 'ok', 1]);
    expect(rec.inputs).toHaveLength(2);

    // (d) The strict body is unchanged: `retryFailed` still resets and reads a failed message, and
    // an unknown field or invalid JSON is still the invalid answer.
    const failedKey = await store(programId, label('failed'), marked('failed'));
    await seedAttempt(programId, failedKey, 'failed', 1, 'bad_output');
    const retried = await post(writeTok, JSON.stringify({ retryFailed: true }));
    expect([retried.status, retried.body.data?.read]).toEqual([200, 1]);
    expect(rec.inputs).toHaveLength(3);
    expect((await rowOf(failedKey)).state).toBe('no_balance');
    for (const raw of ['{"x":1}', '{not json']) {
      const r = await post(writeTok, raw);
      expect([r.status, r.body.error?.code], raw).toEqual([400, 'INVALID_INPUT']);
    }
    expect(rec.inputs).toHaveLength(3);
    expectPrivateLines();
  }, 60_000);

  it('T42c4-I2: a failed ROLLBACK is logged once in a fixed shape and never changes the outcome', async () => {
    const programId = await world();
    withKey();

    // (a) In a run: the decision's reads-row UPDATE rejects, then its ROLLBACK rejects. The run still
    // records the original failure, and the next message is still read.
    const first = await store(programId, label('first'), marked('first'), -2);
    const second = await store(programId, label('second'), marked('second'), -1);
    install(nothingRead);
    let failUpdate = true;
    const run = tapConnect(async (text, forward) => {
      if (failUpdate && text.includes('UPDATE loyalty_inbox_reads') && text.includes('read_on = CURRENT_DATE')) {
        failUpdate = false;
        throw new Error(`${ORIGINAL} the statement failed`);
      }
      if (text === 'ROLLBACK') { await forward(); throw new Error(`${ROLLBACK_TEXT} the rollback failed`); }
      return forward();
    });
    const mark = lines.length;
    let result: LoyaltyInboxReadRun;
    try {
      result = await readStoredMail();
    } finally {
      run.restore();
    }
    expect([result.outcome, result.errorCode, result.failed, result.read]).toEqual(['error', 'store_failed', 1, 1]);
    expect(await rowOf(first)).toEqual({ state: 'retry', attempts: 1, last_error_code: 'api_error' });
    expect((await rowOf(second)).state).toBe('no_balance');
    expect(await count(`SELECT count(*) AS n FROM loyalty_observations o JOIN loyalty_memberships m ON m.id = o.membership_id WHERE m.program_id = $1`, [programId])).toBe(0);
    const logged = rollbackLines(mark);
    expect(logged).toHaveLength(1);
    const line = JSON.parse(logged[0]) as Record<string, unknown>;
    expect(Object.keys(line).sort()).toEqual(['code', 'level', 'message', 'scope', 'time']);
    expect([line.level, line.scope, line.message, line.code]).toEqual(['warn', 'loyalty-read', 'loyalty read rollback failed', 'store_failed']);

    // (b) A refusal stays a refusal when its ROLLBACK fails.
    const resolved = await seedQueued(programId, dedupe(label('resolved')), 'ignored');
    const b = tapConnect(async (text, forward) => {
      if (text === 'ROLLBACK') { await forward(); throw new Error(`${ROLLBACK_TEXT} the rollback failed`); }
      return forward();
    });
    const markB = lines.length;
    let refusal;
    try {
      refusal = await resolveReading(resolved, { action: 'ignore' });
    } finally {
      b.restore();
    }
    expect(refusal).toMatchObject({ ok: false, code: 'ITEM_RESOLVED' });
    expect(rollbackLines(markB)).toHaveLength(1);
    expect(b.tap.releases).toBe(1);

    // (c) A statement error, then a ROLLBACK error: the ORIGINAL error rejects, never the rollback's.
    const pending = await seedQueued(programId, dedupe(label('pending')), 'pending');
    const failIgnore = (rollbackFails: boolean): Intercept => async (text, forward) => {
      if (text.includes(`SET state = 'ignored'`)) throw new Error(`${ORIGINAL} the statement failed`);
      if (text === 'ROLLBACK' && rollbackFails) { await forward(); throw new Error(`${ROLLBACK_TEXT} the rollback failed`); }
      return forward();
    };
    const c = tapConnect(failIgnore(true));
    const markC = lines.length;
    let thrown: unknown = null;
    try {
      await resolveReading(pending, { action: 'ignore' });
    } catch (err) {
      thrown = err;
    } finally {
      c.restore();
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(ORIGINAL);
    expect((thrown as Error).message).not.toContain(ROLLBACK_TEXT);
    expect(rollbackLines(markC)).toHaveLength(1);
    expect(c.tap.releases).toBe(1);
    expect(await count(`SELECT count(*) AS n FROM loyalty_inbox_reads WHERE id = $1 AND state = 'pending'`, [pending])).toBe(1);

    // (d) The same failure with a working ROLLBACK logs no such line.
    const d = tapConnect(failIgnore(false));
    const markD = lines.length;
    let thrownD: unknown = null;
    try {
      await resolveReading(pending, { action: 'ignore' });
    } catch (err) {
      thrownD = err;
    } finally {
      d.restore();
    }
    expect((thrownD as Error).message).toContain(ORIGINAL);
    expect(rollbackLines(markD)).toHaveLength(0);
    expectPrivateLines();
  }, 60_000);

  it('T42c4-I3: the stored last read equals the answer in every combination, is written last, and the purge never waits on the count', async () => {
    type Read = 'ok' | 'rate_limited' | 'threw';
    // The D3 table: read, count, purge, state write; the answer; and what is stored afterwards.
    const TABLE: { n: number; r: Read; x: boolean; p: boolean; w: boolean; answer: string; stored: string }[] = [
      { n: 1, r: 'ok', x: true, p: true, w: true, answer: 'ok/null', stored: 'ok/null/today' },
      { n: 2, r: 'ok', x: true, p: false, w: true, answer: 'error/store_failed', stored: 'error/store_failed/today' },
      { n: 3, r: 'ok', x: false, p: true, w: true, answer: 'error/store_failed', stored: 'error/store_failed/today' },
      { n: 4, r: 'ok', x: true, p: true, w: false, answer: 'error/store_failed', stored: 'ok/null/seed' },
      { n: 5, r: 'ok', x: true, p: false, w: false, answer: 'error/store_failed', stored: 'ok/null/seed' },
      { n: 6, r: 'rate_limited', x: true, p: true, w: true, answer: 'error/rate_limited', stored: 'error/rate_limited/today' },
      { n: 7, r: 'rate_limited', x: true, p: false, w: true, answer: 'error/rate_limited', stored: 'error/rate_limited/today' },
      { n: 8, r: 'rate_limited', x: false, p: true, w: true, answer: 'error/rate_limited', stored: 'error/rate_limited/today' },
      { n: 9, r: 'rate_limited', x: true, p: true, w: false, answer: 'error/rate_limited', stored: 'ok/null/seed' },
      { n: 10, r: 'threw', x: true, p: true, w: true, answer: 'error/store_failed', stored: 'error/store_failed/today' },
      { n: 11, r: 'threw', x: true, p: false, w: true, answer: 'error/store_failed', stored: 'error/store_failed/today' },
      { n: 12, r: 'threw', x: true, p: true, w: false, answer: 'error/store_failed', stored: 'ok/null/seed' },
      { n: 13, r: 'ok', x: false, p: false, w: true, answer: 'error/store_failed', stored: 'error/store_failed/today' },
    ];
    const SEED_DAYS = 5;
    const observed: string[] = [];
    const expected: string[] = [];
    withKey();
    for (const row of TABLE) {
      await clearWorld();
      const programId = await world();
      await store(programId, label('unread'), marked('unread'));
      // One row received strictly before the retention cut-off, and one exactly at it.
      const expired = dedupe(label('expired'));
      const atCutoff = dedupe(label('cutoff'));
      await seedAttempt(programId, expired, 'failed', 1, 'api_error', -(LOYALTY_READ_RETENTION_DAYS + 1));
      await seedAttempt(programId, atCutoff, 'failed', 1, 'api_error', -LOYALTY_READ_RETENTION_DAYS);
      await seedState('ok', null, SEED_DAYS);
      const seedOn = (await stateRow()).on;
      install(row.r === 'rate_limited' ? () => ({ ok: false, code: 'rate_limited' }) : nothingRead);

      let countFailedOnce = !row.x;
      const pool = poolFault((text) => {
        if (row.r === 'threw' && text.includes('LEFT JOIN loyalty_inbox_reads r ON r.dedupe_key = m.dedupe_key')) return true;
        if (countFailedOnce && text.includes('AS n FROM loyalty_inbox_messages m')) { countFailedOnce = false; return true; }
        return false;
      });
      let answer = 'none';
      try {
        if (!row.p) await failPurge();
        if (!row.w) await failStateWrite();
        const run = await readStoredMail();
        answer = `${run.outcome}/${run.errorCode}`;
      } finally {
        pool.restore();
        await dropFaults();
      }
      const s = await stateRow();
      const when = s.on === null ? 'null' : s.on === s.today ? 'today' : s.on === seedOn ? 'seed' : 'other';
      // Never half written: the date and the outcome are both set or both null, and a code only with `error`.
      const whole = (s.on === null) === (s.outcome === null) && (s.code !== null) === (s.outcome === 'error');
      const expiredGone = (await rowSum(expired)) === null;
      const cutoffKept = (await rowSum(atCutoff)) !== null;
      observed.push(`${row.n} answer=${answer} stored=${s.outcome}/${s.code}/${when} whole=${whole} expiredGone=${expiredGone} cutoffKept=${cutoffKept}`);
      expected.push(`${row.n} answer=${row.answer} stored=${row.stored} whole=true expiredGone=${row.p} cutoffKept=true`);
    }
    expect(observed).toEqual(expected);
    expectPrivateLines();
  }, 120_000);

  it('T42c4-I4: a retry row whose bytes are gone is counted failed, once; nothing else changes class and nothing is written', async () => {
    // Each row alone, then all together.
    type Seed = (programId: number) => Promise<string | null>;
    const ROWS: [string, Seed, string][] = [
      ['A', async (p) => { const k = await store(p, label('a'), marked('a')); await seedAttempt(p, k, 'retry', 1, 'api_error'); return k; }, 'waiting'],
      ['B', async (p) => { const k = dedupe(label('b')); await seedAttempt(p, k, 'retry', 1, 'api_error'); return k; }, 'failed'],
      ['C', async (p) => { const k = await store(p, label('c'), null); await seedAttempt(p, k, 'retry', 1, 'api_error'); return k; }, 'failed'],
      ['D', async (p) => { const k = await store(p, label('d'), marked('d')); await seedAttempt(p, k, 'failed', 1, 'bad_output'); return k; }, 'failed'],
      ['E', async (p) => { const k = dedupe(label('e')); await seedAttempt(p, k, 'failed', 1, 'bad_output'); return k; }, 'failed'],
      ['F', async (p) => { const k = dedupe(label('f')); await seedQueued(p, k, 'pending'); return k; }, 'attention'],
      ['G', async (p) => { const k = dedupe(label('g')); await seedApplied(p, k); return k; }, 'none'],
      ['H', async (p) => { await store(p, label('h'), marked('h')); return null; }, 'waiting'],
      ['I', async (p) => { await store(p, label('i'), null); return null; }, 'none'],
    ];
    const classOf = (before: LoyaltyInboxReadPanel, after: LoyaltyInboxReadPanel) => {
      const d = { waiting: after.waiting - before.waiting, failed: after.failed - before.failed, attention: after.needsAttentionTotal - before.needsAttentionTotal };
      const hit = Object.entries(d).filter(([, v]) => v !== 0).map(([k, v]) => (v === 1 ? k : `${k}x${v}`));
      return hit.length === 0 ? 'none' : hit.join('+');
    };
    const observed: string[] = [];
    for (const [name, seed] of ROWS) {
      await clearWorld();
      const p = await world();
      const before = await loadReadOverview();
      await seed(p);
      observed.push(`${name}=${classOf(before, await loadReadOverview())}`);
    }
    expect(observed).toEqual(ROWS.map(([name, , cls]) => `${name}=${cls}`));

    await clearWorld();
    const p = await world();
    const before = await loadReadOverview();
    const keys = new Map<string, string | null>();
    for (const [name, seed] of ROWS) keys.set(name, await seed(p));
    const sumBefore = await tableSum('loyalty_inbox_reads');
    const panel = await loadReadOverview();
    expect(panel.failed - before.failed).toBe(4);
    expect(panel.waiting - before.waiting).toBe(2);
    expect(panel.needsAttentionTotal - before.needsAttentionTotal).toBe(1);
    expect(await tableSum('loyalty_inbox_reads')).toBe(sumBefore);
    withoutKey();
    expect((await readStoredMail()).outcome).toBe('disabled');
    expect(await tableSum('loyalty_inbox_reads')).toBe(sumBefore);

    // Through the route the body still passes the contract schema, with the widened count in it.
    const res = await answerOf(overviewGET(new NextRequest(`${ORIGIN}/api/v1/loyalty`, { headers: { host: 'localhost:3000', ...cookie(owner.token) } })));
    expect(res.status).toBe(200);
    expect(LoyaltyOverviewResponseSchema.safeParse(res.body).success).toBe(true);
    expect((res.body.data as unknown as { inboxRead: LoyaltyInboxReadPanel }).inboxRead.failed).toBe(panel.failed);

    // "Try failed mail again" resets D (failed, bytes present) and leaves B, C and E exactly as they were.
    const gone = await Promise.all(['B', 'C', 'E'].map(async (n) => [n, await rowSum(keys.get(n) as string)] as const));
    withKey();
    install(nothingRead);
    await readStoredMail({ retryFailed: true });
    expect((await rowOf(keys.get('D') as string)).state).toBe('no_balance');
    for (const [n, sum] of gone) expect(await rowSum(keys.get(n) as string), n).toBe(sum);
  }, 60_000);

  it('T42c4-I5: bytes that vanish between selection and read are not a terminal failure; an empty message still is', async () => {
    withKey();
    for (const how of ['delete', 'null'] as const) {
      await clearWorld();
      const p = await world();
      const vanishing = await store(p, label(`vanish-${how}`), marked(`vanish-${how}`), -3);
      const ordinary = await store(p, label('ordinary'), marked('ordinary'), -2);
      const emptyText = await store(p, label('empty'), mail(''), -1);
      const before = await loadReadOverview();
      const rec = install(nothingRead);
      let run: LoyaltyInboxReadRun;
      try {
        await vanishOnAttempt(vanishing, how);
        run = await readStoredMail();
      } finally {
        await dropFaults();
      }
      expect(await rowOf(vanishing), how).toEqual({ state: 'retry', attempts: 1, last_error_code: 'api_error' });
      expect(rec.inputs.map((i) => i.text.includes(`${MARK} vanish-`))).toEqual([false]);
      expect(rec.inputs[0].text).toContain(`${MARK} ordinary`);
      expect([run.outcome, run.errorCode, run.read, run.failed], how).toEqual(['ok', null, 1, 1]);
      expect((await rowOf(ordinary)).state).toBe('no_balance');
      expect(await rowOf(emptyText)).toEqual({ state: 'failed', attempts: 1, last_error_code: 'empty_message' });
      // The vanished row and the empty message are both visible as failed (D4).
      const after = await loadReadOverview();
      expect(after.failed - before.failed, how).toBe(2);
    }

    // A message already at its second attempt whose bytes then vanish: the ordinary attempt limit,
    // `failed`/`api_error` at three, never `empty_message`, and still not a failure of the run.
    await clearWorld();
    const p = await world();
    const last = await store(p, label('last'), marked('last'), -1);
    await seedAttempt(p, last, 'retry', 2, 'api_error');
    const rec = install(nothingRead);
    let run: LoyaltyInboxReadRun;
    try {
      await vanishOnAttempt(last, 'null');
      run = await readStoredMail();
    } finally {
      await dropFaults();
    }
    expect(await rowOf(last)).toEqual({ state: 'failed', attempts: 3, last_error_code: 'api_error' });
    expect(rec.inputs).toHaveLength(0);
    expect([run.outcome, run.errorCode, run.read, run.failed]).toEqual(['ok', null, 0, 0]);
    expectPrivateLines();
  }, 60_000);

  it('T42c4-I6: the panel is one snapshot on one connection in one READ ONLY REPEATABLE READ transaction', async () => {
    const p = await world();
    await seedQueued(p, dedupe(label('pending')), 'pending');
    await seedQueued(p, dedupe(label('pending')), 'pending');
    const PANEL: [string, string][] = [
      ['state', 'FROM loyalty_inbox_read_state WHERE id = 1'],
      ['counts', 'AS waiting'],
      ['queue', `WHERE r.state = 'pending'`],
      ['coverage', 'balanceInLastStatement'],
      ['fromMail', 'DISTINCT ON (r.membership_id)'],
    ];
    const which = (text: string) => PANEL.find(([, m]) => text.includes(m))?.[0] ?? null;
    const before = await loadReadOverview();

    // The interleave: before the queue statement is forwarded, every earlier statement on the client
    // has finished, then one more pending item and one more waiting message are committed on a
    // separate connection.
    let interleaved = false;
    const conn = tapConnect(async (text, forward) => {
      if (!interleaved && which(text) === 'queue') {
        interleaved = true;
        await Promise.all(conn.tap.inflight);
        const other = await realConnect();
        try {
          await seedQueued(p, dedupe(label('late')), 'pending', other);
          await other.query(
            `INSERT INTO loyalty_inbox_messages (dedupe_key, received_on, program_id, sender_domain, origin, attribution, raw_mail, oversize)
             VALUES ($1, CURRENT_DATE - 1, $2, $3, 'direct', 'none_found', $4, false)`,
            [dedupe(label('late-mail')), p, DOMAIN, marked('late')]
          );
        } finally {
          other.release();
        }
      }
      return forward();
    });
    const pool = poolFault(() => false);
    let first: LoyaltyInboxReadPanel;
    try {
      first = await loadReadOverview();
    } finally {
      conn.restore();
      pool.restore();
    }
    expect(conn.tap.connects).toBe(1);
    expect(conn.tap.releases).toBe(1);
    expect(interleaved).toBe(true);
    const seen = conn.tap.seen;
    expect(seen[0]).toMatch(/READ ONLY/);
    expect(seen[0]).toMatch(/REPEATABLE READ|SERIALIZABLE/);
    expect(seen[0]).toMatch(/^BEGIN/);
    expect(seen.slice(1, -1).map(which)).toEqual(PANEL.map(([n]) => n));
    expect(seen[seen.length - 1]).toMatch(/^(COMMIT|ROLLBACK)$/);
    expect(pool.seen.map(which).filter((n) => n !== null)).toEqual([]);
    // The two seeded before the interleave, not three.
    expect(before.needsAttentionTotal).toBe(2);
    expect(first.needsAttentionTotal).toBe(2);
    expect(first.needsAttention).toHaveLength(2);
    expect(first.needsAttention.length).toBeLessThanOrEqual(first.needsAttentionTotal);
    expect(first.waiting).toBe(before.waiting);

    const second = await loadReadOverview();
    expect(second.needsAttentionTotal).toBe(before.needsAttentionTotal + 1);
    expect(second.needsAttention).toHaveLength(before.needsAttention.length + 1);
    expect(second.waiting).toBe(before.waiting + 1);

    // A throwing statement still ends the transaction and releases the client, once.
    const broken = tapConnect(async (text, forward) => {
      if (which(text) === 'coverage') throw new Error('zq42c4 injected statement failure');
      return forward();
    });
    let thrown: unknown = null;
    try {
      await loadReadOverview();
    } catch (err) {
      thrown = err;
    } finally {
      broken.restore();
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(broken.tap.seen[broken.tap.seen.length - 1]).toBe('ROLLBACK');
    expect(broken.tap.releases).toBe(1);
  }, 60_000);
});
