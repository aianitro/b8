// P8-42c3 — what the production read path sends the model for each stored loyalty message, through
// the real `readStoredMail`, the real read route and Postgres (I1–I3): the stored `origin` chooses
// the attached original, per message and nothing else; an attached forward now reaches 42c2's
// unchanged decision rules and yields a balance without leaking an address, a host or the covering
// note; and messages already read are not offered again, while `retryFailed` still resets `failed`
// rows only.
//
// TIER 2, collected by `vitest.integration.config.mts` with the scratch-database guard in its setup
// files, like `loyaltyRead.test.ts` beside it. The owner signs in through the real passkey path
// (`../auth/secondUserTestKit.ts`) for the one test that goes through the route.
//
// THE READER IS A FAKE, mocked exactly as 42c2's suite mocks it: `createMailReader` in
// `@/lib/loyaltyReader` returns whatever fake the test installed, and with none installed answers
// `api_error` and counts the call, so a read nobody expected is seen. The fake records every input,
// which is the point of this file: the input IS what would have gone to Anthropic. No test reaches a
// real model, a real mailbox or a non-loopback socket.
//
// THE FIXTURES ARE PINNED. `lib/fixtures/loyalty-read-forwards/` (eight `.eml` and `cases.json`) is
// fabricated, carries the canary ZQ42C3, and is pinned by a SHA-256 in the spec's command 13. Its
// `integration` group is this file's world: the program, the member and membership, the reading the
// fake answers for the attached original, the expected states, and the exact subject and text the
// reader must receive for each of the nine stored rows. Every expected value is read from it; its
// `{{DAY:n}}` tokens become dates Postgres computes. The `shapes` group, which the oracle reads, is
// cross-checked against `integration` so the two expectations of one message cannot drift apart.
//
// NO MEMBER ADDRESS IS REGISTERED. `household_member_addresses` stays empty and is asserted empty: the
// stored `origin` is 42c1's record of "a registered member forwarded this", so a read path that
// re-derived it from the addresses would see no member and read every covering note, and I1 fails.
//
// CLEANUP IS OF THIS SUITE'S OWN ROWS: the reads rows and stored messages of its dedupe keys, the
// observations and memberships of `ZQ42C3 …` programs, their sender domains, the programs and members
// themselves, the read state reset to never-read, and the auth tables through `resetAuth`.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { readStoredMail } from '@/lib/loyaltyInboxRead';
import { membershipView } from '@/lib/loyaltyStore';
import type { MailReader, MailReaderInput, MailReaderResult } from '@/lib/loyaltyReader';
import {
  LoyaltyInboxReadResponseSchema,
  type LoyaltyInboxOrigin,
  type LoyaltyInboxReadRun,
  type LoyaltyUnit,
} from '@b8/contracts/loyalty';
import { bootstrapOwner, cookie, resetAuth, type EnrolledUser } from '../auth/secondUserTestKit';
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

// ─── The fixture ───────────────────────────────────────────────────────────────────────────────

const DIR = fileURLToPath(new URL('../../../../lib/fixtures/loyalty-read-forwards/', import.meta.url));
type Input = { subject: string | null; text: string };
interface StoredCase { key: string; eml: string; origin: LoyaltyInboxOrigin; offered: boolean; expectInput: Input | null }
interface Fixture {
  canaries: Record<string, string> & { addresses: string[]; linkHosts: string[] };
  shapes: { id: string; eml: string; origin: LoyaltyInboxOrigin | 'omitted'; expect?: Input }[];
  integration: {
    program: { name: string; kind: string; defaultUnit: LoyaltyUnit; domain: string };
    member: { displayName: string };
    membership: { memberNumber: string; baseline: { balance: string; unit: LoyaltyUnit; asOfOffset: number } };
    messages: StoredCase[];
    emptyOriginal: { key: string; state: string; code: string; attempts: number };
    reading: { answerWhenTextContains: string; otherwise: { ok: false; code: string }; reader: Record<string, unknown> & { balance: string; unit: LoyaltyUnit } };
    expect: {
      attachment: { key: string; state: string; observationSource: string; balanceAfter: string; unit: LoyaltyUnit; asOfOffset: number; inputSubject: string };
      direct: { key: string; state: string; attempts: number; observation: boolean };
    };
    preRead: {
      notReoffered: string[];
      resetByRetryFailed: { state: string; attempts: number; code: string; expectInput: Input };
    };
  };
}
const C = JSON.parse(readFileSync(join(DIR, 'cases.json'), 'utf8')) as Fixture;
const K = C.canaries;
const W = C.integration;
const eml = (name: string) => readFileSync(join(DIR, `${name}.eml`));
/** The fixture case of one stored-row key. */
const caseOf = (key: string) => {
  const m = W.messages.find((x) => x.key === key);
  if (!m) throw new Error(`no integration message ${key}`);
  return m;
};

const pgDay = async (n = 0) => (await db.query<{ d: string }>('SELECT (CURRENT_DATE + $1::int)::text AS d', [n])).rows[0].d;
/** Replaces every `{{DAY:n}}` token in a fixture value, at any depth, with Postgres's date. */
async function resolve<T>(v: T): Promise<T> {
  let text = JSON.stringify(v);
  for (const t of new Set(text.match(/\{\{DAY:-?\d+\}\}/g) ?? [])) text = text.split(t).join(await pgDay(Number(t.slice(6, -2))));
  return JSON.parse(text) as T;
}
/** The stored dedupe key of a fixture key (the column holds lower-case hex SHA-256 only). */
const dedupe = (key: string) => createHash('sha256').update(`zq42c3-read-forwards-${key}`).digest('hex');
/** Every dedupe key this file may store, so cleanup removes exactly its own rows. */
const OWN_KEYS = [
  ...W.messages.map((m) => m.key),
  ...W.preRead.notReoffered.map((s) => `pre-${s}`),
  'pre-failed',
].map(dedupe);

// ─── Requests (I2 goes through the route, so its response bodies are real) ───────────────────

const ORIGIN = 'http://localhost:3000';
function req(path: string, who: EnrolledUser, method = 'GET', body?: unknown): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: { host: 'localhost:3000', 'content-type': 'application/json', ...cookie(who.token) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const bodies: string[] = [];
async function textOf(response: Response | Promise<Response>): Promise<{ status: number; text: string }> {
  const res = await response;
  const text = await res.text();
  bodies.push(text);
  return { status: res.status, text };
}

// ─── The world ─────────────────────────────────────────────────────────────────────────────────

const ENV_NAMES = ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'LOYALTY_READ_TIMEOUT_SECONDS'];
let savedEnv: Record<string, string | undefined> = {};
const withKey = () => { process.env.ANTHROPIC_API_KEY = K.key; };

async function clearWorld(): Promise<void> {
  const ours = `SELECT id FROM loyalty_programs WHERE name LIKE 'ZQ42C3%'`;
  await db.query('DELETE FROM loyalty_inbox_reads WHERE dedupe_key = ANY($1)', [OWN_KEYS]);
  await db.query('DELETE FROM loyalty_inbox_messages WHERE dedupe_key = ANY($1)', [OWN_KEYS]);
  await db.query(`DELETE FROM loyalty_inbox_reads WHERE program_id IN (${ours})`);
  await db.query(`DELETE FROM loyalty_inbox_messages WHERE program_id IN (${ours})`);
  await db.query(`DELETE FROM loyalty_observations WHERE membership_id IN (SELECT id FROM loyalty_memberships WHERE program_id IN (${ours}))`);
  await db.query(`DELETE FROM loyalty_memberships WHERE program_id IN (${ours})`);
  await db.query(`DELETE FROM loyalty_sender_domains WHERE program_id IN (${ours})`);
  await db.query(`DELETE FROM loyalty_programs WHERE name LIKE 'ZQ42C3%'`);
  await db.query(`DELETE FROM household_members WHERE display_name LIKE 'ZQ42C3%'`);
  await db.query('UPDATE loyalty_inbox_read_state SET last_read_on = NULL, last_outcome = NULL, last_error_code = NULL WHERE id = 1');
}

interface World { programId: number; membershipId: number }
/** The fixture's program with its sender domain, its member, and one membership with a typed baseline. */
async function world(): Promise<World> {
  const p = W.program;
  const programId = (await db.query<{ id: number }>('INSERT INTO loyalty_programs (name, kind, default_unit) VALUES ($1, $2, $3) RETURNING id',
    [p.name, p.kind, p.defaultUnit])).rows[0].id;
  await db.query('INSERT INTO loyalty_sender_domains (program_id, domain) VALUES ($1, $2)', [programId, p.domain]);
  const memberId = (await db.query<{ id: number }>('INSERT INTO household_members (display_name) VALUES ($1) RETURNING id', [W.member.displayName])).rows[0].id;
  const ms = W.membership;
  const membershipId = (await db.query<{ id: number }>('INSERT INTO loyalty_memberships (member_id, program_id, member_number) VALUES ($1, $2, $3) RETURNING id',
    [memberId, programId, ms.memberNumber])).rows[0].id;
  await db.query(`INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source) VALUES ($1, CURRENT_DATE + $2::int, $3::numeric, $4, 'typed')`,
    [membershipId, ms.baseline.asOfOffset, ms.baseline.balance, ms.baseline.unit]);
  return { programId, membershipId };
}

/**
 * Stores one fixture message under `label`, with the fixture's stored origin (or `origin`), received
 * `day` days from today. Attribution is `none_found`: no member address is registered, and nothing in
 * the read path consults attribution. Returns the dedupe key.
 */
async function store(w: World, label: string, emlName: string, origin: LoyaltyInboxOrigin, day: number): Promise<string> {
  const key = dedupe(label);
  await db.query(
    `INSERT INTO loyalty_inbox_messages (dedupe_key, received_on, program_id, sender_domain, origin, attribution, raw_mail, oversize)
     VALUES ($1, CURRENT_DATE + $2::int, $3, $4, $5, 'none_found', $6, false)`,
    [key, day, w.programId, W.program.domain, origin, eml(emlName)]
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

const count = async (sql: string, values: unknown[] = []) => Number((await db.query<{ n: string }>(sql, values)).rows[0].n);
const rowOf = async (key: string) => (await db.query(`SELECT *, balance::text AS balance, as_of::text AS as_of FROM loyalty_inbox_reads WHERE dedupe_key = $1`, [key])).rows[0];
/** A checksum of the whole reads row, every column, so "unchanged" means unchanged. */
const rowSum = async (key: string) => (await db.query<{ s: string }>(`SELECT md5(r::text) AS s FROM loyalty_inbox_reads r WHERE dedupe_key = $1`, [key])).rows[0]?.s ?? null;

/** Every console line of the file (the logger writes through console), for the privacy checks. */
const lines: string[] = [];
let owner: EnrolledUser;

beforeAll(async () => {
  const capture = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  for (const m of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(capture);
  savedEnv = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
  await clearWorld();
  await resetAuth();
  owner = await bootstrapOwner();
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

describe('what the read path sends for forwarded loyalty mail (P8-42c3)', () => {
  it('T42c3-I1: the production wiring passes each message\'s stored origin, and nothing else decides which message is read', async () => {
    // The two fixture groups agree: where the oracle's `shapes` pin an exact result for the same bytes
    // and origin, the integration expectation is that result, and an unoffered message is one whose
    // chosen text is empty.
    const shapeFor = (m: StoredCase) => C.shapes.find((s) => s.eml === m.eml && (s.origin === 'omitted' ? 'direct' : s.origin) === m.origin && s.expect);
    for (const m of W.messages) {
      const s = shapeFor(m);
      if (s?.expect && m.expectInput) expect(m.expectInput, `${m.key} against ${s.id}`).toEqual(s.expect);
      if (!m.offered) expect(s?.expect?.text, m.key).toBe('');
    }

    const w = await world();
    expect(await count('SELECT count(*) AS n FROM household_member_addresses')).toBe(0);
    // Received on consecutive days in fixture order, so the reader is called in that order.
    const keys = new Map<string, string>();
    for (const [i, m] of W.messages.entries()) keys.set(m.key, await store(w, m.key, m.eml, m.origin, -30 + i));
    withKey();
    const rec = install(() => ({ ok: true, reading: {} }));
    const run = await readStoredMail();
    expect(run.outcome).toBe('ok');
    expect(H.unexpected).toBe(0);

    const offered = W.messages.filter((m) => m.offered);
    expect(rec.inputs).toHaveLength(offered.length);
    expect(rec.inputs.length).toBe(W.messages.length - 1);
    const seen: string[] = [];
    for (const [i, m] of offered.entries()) {
      expect(Object.keys(rec.inputs[i]).sort(), m.key).toEqual(['subject', 'text']);
      expect(rec.inputs[i], m.key).toEqual(m.expectInput);
      seen.push(m.key);
    }
    expect(seen).toEqual(offered.map((m) => m.key));

    // The empty original: settled with no model call, and its covering note reached no input.
    const e = W.emptyOriginal;
    const empty = await rowOf(keys.get(e.key) as string);
    expect([empty.state, empty.last_error_code, empty.attempts]).toEqual([e.state, e.code, e.attempts]);
    const emptyNote = `${K.outerNote} ${K.body} ${caseOf(e.key).eml}`;
    for (const i of rec.inputs) expect(`${i.subject}\n${i.text}`).not.toContain(emptyNote);

    // The same bytes, two stored origins, two different messages read.
    const att = rec.inputs[offered.findIndex((m) => m.key === W.expect.attachment.key)];
    const dir = rec.inputs[offered.findIndex((m) => m.key === W.expect.direct.key)];
    expect(att.text).toContain(K.innerBody);
    expect(att.text).not.toContain(K.outerNote);
    expect(dir.text).toContain(K.outerNote);
    expect(dir.text).not.toContain(K.innerBody);
    // A stranger's attachment (stored `direct`) is never opened.
    for (const i of rec.inputs) expect(`${i.subject}\n${i.text}`).not.toContain(K.strangerInner);
    expect(await count('SELECT count(*) AS n FROM household_member_addresses')).toBe(0);
  });

  it('T42c3-I2: an attached forward yields a balance through the unchanged decision rules, and nothing leaks', async () => {
    const w = await world();
    const a = W.expect.attachment;
    const d = W.expect.direct;
    const keyA = await store(w, a.key, caseOf(a.key).eml, caseOf(a.key).origin, -2);
    const keyD = await store(w, d.key, caseOf(d.key).eml, caseOf(d.key).origin, -1);
    const reading = await resolve(W.reading.reader);
    withKey();
    const rec = install((input) => (input.text.includes(W.reading.answerWhenTextContains)
      ? { ok: true, reading }
      : (W.reading.otherwise as MailReaderResult)));
    const before = await count('SELECT count(*) AS n FROM loyalty_observations WHERE membership_id = $1', [w.membershipId]);

    const res = await textOf(readPOST(req('/api/v1/loyalty/inbox/read', owner, 'POST', {})));
    expect(res.status).toBe(200);
    const parsed = LoyaltyInboxReadResponseSchema.safeParse(JSON.parse(res.text));
    expect(parsed.success).toBe(true);
    const run = (JSON.parse(res.text) as { data: LoyaltyInboxReadRun }).data;
    expect([run.read, run.applied, run.failed]).toEqual([1, 1, 1]);
    expect(rec.inputs).toHaveLength(2);

    // The attached original was read and applied.
    const forAttachment = rec.inputs.filter((i) => i.text.includes(W.reading.answerWhenTextContains));
    expect(forAttachment).toHaveLength(1);
    expect(forAttachment[0].subject).toBe(a.inputSubject);
    const rowA = await rowOf(keyA);
    expect(rowA.state).toBe(a.state);
    expect(rowA.attempts).toBe(1);
    const obs = (await db.query(`SELECT balance::text AS balance, unit, as_of::text AS as_of, source FROM loyalty_observations WHERE id = $1`, [rowA.observation_id])).rows[0];
    expect(obs).toEqual({ balance: a.balanceAfter, unit: a.unit, as_of: await pgDay(a.asOfOffset), source: a.observationSource });
    expect(await count('SELECT count(*) AS n FROM loyalty_observations WHERE membership_id = $1', [w.membershipId])).toBe(before + 1);
    expect((await membershipView(w.membershipId))?.balance).toBe(a.balanceAfter);

    // The same bytes stored `direct` were read as the covering note, which yields nothing.
    const rowD = await rowOf(keyD);
    expect([rowD.state, rowD.attempts, rowD.observation_id !== null]).toEqual([d.state, d.attempts, d.observation]);

    // The panel after the run, as the page would fetch it.
    const overview = await textOf(overviewGET(req('/api/v1/loyalty', owner)));
    expect(overview.status).toBe(200);

    // Privacy, over every response body and every captured console or logger line of the file.
    const secrets = [K.key, K.memberNumber, K.outerNote, ...K.addresses, ...K.linkHosts];
    expect(bodies.length).toBeGreaterThan(0);
    for (const t of [...bodies, ...lines]) for (const s of secrets) expect(t.includes(s), `${s} in a body or log line`).toBe(false);
    for (const i of rec.inputs) for (const s of [...K.addresses, ...K.linkHosts]) expect(`${i.subject}\n${i.text}`.includes(s), `${s} reached the reader`).toBe(false);
  });

  it('T42c3-I3: messages already read are not re-read automatically, and retryFailed resets failed rows only', async () => {
    const w = await world();
    const attached = W.messages.find((m) => m.key === W.expect.attachment.key) as StoredCase;
    const reading = await resolve(W.reading.reader);
    const suffix = String(reading.memberNumberSuffix).slice(-4);
    // One observation for the `applied` row to point at, as a real apply would have written.
    const obsId = (await db.query<{ id: number }>(`INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source)
       VALUES ($1, CURRENT_DATE - 3, $2::numeric, $3, 'email') RETURNING id`, [w.membershipId, reading.balance, reading.unit])).rows[0].id;

    // A reads row in every settled or queued state 42c2 can leave, each on its own stored copy of
    // the attached forward. Each satisfies the table's CHECKs for its state.
    const B = reading.balance;
    const U = reading.unit;
    const rowsByState: Record<string, { sql: string; values: unknown[] }> = {
      no_balance: { sql: `state, attempts, program_check, read_on, resolved_on`, values: ['no_balance', 1, 'not_stated', 0, 0] },
      applied: {
        sql: `state, attempts, program_check, read_on, resolved_on, suffix, balance, unit, as_of, membership_id, observation_id`,
        values: ['applied', 1, 'match', 0, 0, suffix, B, U, -3, w.membershipId, obsId],
      },
      stale: { sql: `state, attempts, program_check, read_on, resolved_on, suffix, balance, unit, as_of, membership_id`, values: ['stale', 1, 'match', 0, 0, suffix, B, U, -3, w.membershipId] },
      pending: { sql: `state, attempts, program_check, read_on, resolved_on, reason, balance, unit`, values: ['pending', 1, 'not_stated', 0, null, 'no_suffix', B, U] },
      ignored: { sql: `state, attempts, program_check, read_on, resolved_on, reason, balance, unit`, values: ['ignored', 1, 'not_stated', 0, 0, 'no_suffix', B, U] },
      not_mine: { sql: `state, attempts, program_check, read_on, resolved_on, reason, suffix, balance, unit`, values: ['not_mine', 1, 'match', 0, 0, 'unmatched_suffix', 'ZQ43', B, U] },
    };
    const settled = new Map<string, string>();
    for (const [i, state] of W.preRead.notReoffered.entries()) {
      const r = rowsByState[state];
      expect(r, `a row shape for ${state}`).toBeDefined();
      const key = await store(w, `pre-${state}`, attached.eml, attached.origin, -20 + i);
      // Day offsets become dates in SQL: read_on, resolved_on and as_of are CURRENT_DATE arithmetic.
      const cols = r.sql.split(', ');
      const params = r.values.map((v, n) => (['read_on', 'resolved_on', 'as_of'].includes(cols[n]) && v !== null ? `CURRENT_DATE + ($${n + 4})::int` : `$${n + 4}`));
      await db.query(
        `INSERT INTO loyalty_inbox_reads (dedupe_key, program_id, received_on, ${r.sql}) VALUES ($1, $2, CURRENT_DATE + $3::int, ${params.join(', ')})`,
        [key, w.programId, -20 + i, ...r.values]
      );
      settled.set(state, key);
    }
    const f = W.preRead.resetByRetryFailed;
    const failedKey = await store(w, 'pre-failed', attached.eml, attached.origin, -5);
    await db.query(
      `INSERT INTO loyalty_inbox_reads (dedupe_key, program_id, received_on, state, attempts, last_error_code) VALUES ($1, $2, CURRENT_DATE - 5, $3, $4, $5)`,
      [failedKey, w.programId, f.state, f.attempts, f.code]
    );
    const sums = new Map<string, string | null>();
    for (const [state, key] of settled) sums.set(state, await rowSum(key));
    const failedSum = await rowSum(failedKey);

    withKey();
    const rec = install(() => ({ ok: true, reading: {} }));

    // A plain run offers nothing: every row is settled, queued or failed.
    expect((await readStoredMail()).outcome).toBe('ok');
    expect(rec.inputs).toHaveLength(0);
    expect(await rowSum(failedKey)).toBe(failedSum);

    // retryFailed under someone else's lock: nothing happens, the failed row included.
    const other = await db.connect();
    try {
      await other.query(`SELECT pg_advisory_lock(hashtext('b8:loyalty-inbox:read'))`);
      expect((await readStoredMail({ retryFailed: true })).outcome).toBe('already_running');
      await other.query(`SELECT pg_advisory_unlock(hashtext('b8:loyalty-inbox:read'))`);
    } finally {
      other.release();
    }
    expect(rec.inputs).toHaveLength(0);
    expect(await rowSum(failedKey)).toBe(failedSum);

    // retryFailed: only the failed row is reset and read again, and what is read is the original.
    expect((await readStoredMail({ retryFailed: true })).outcome).toBe('ok');
    expect(rec.inputs).toEqual([f.expectInput]);
    const again = await rowOf(failedKey);
    expect([again.state, again.attempts]).not.toEqual([f.state, f.attempts]);
    expect(again.attempts).toBe(1);

    const seen: string[] = [];
    for (const [state, key] of settled) {
      expect(await rowSum(key), `${state} row changed`).toBe(sums.get(state));
      seen.push(state);
    }
    expect(seen).toEqual(W.preRead.notReoffered);
    expect(H.unexpected).toBe(0);
  });
});
