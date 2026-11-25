// P8-42e1b — the flight read through the real pass, handlers and Postgres (I1–I9): which messages are
// read, a confirmation becoming segments, leg identity across mails, cancellations that never delete
// and mail that never revives, arrival order against event order, typed and mail against each other,
// attribution, failures and the lock, privacy and logs, and the daily step with its retention.
//
// TIER 2, collected by `vitest.integration.config.mts` with the scratch-database guard in its setup
// files. People sign in through the real passkey path (`../auth/secondUserTestKit.ts`); handlers are
// called directly with a `NextRequest`.
//
// THE READER IS A FAKE. `createFlightReader` in `@/lib/loyaltyReader` is mocked: each test installs a
// fake that answers by a marker line this suite writes into each fabricated message (the reader is
// given nothing but subject and text, so the marker is how the fake knows which message it reads).
// With no fake installed the mock answers `api_error` and counts the call. `createBookingReader` and
// `createMailReader` are mocked too, only to count: the flight pass must never call them, and with a
// key set no other step of the daily job may reach a real model either. No test opens a socket.
//
// EVERYTHING IS FABRICATED: programs and people named `ZQ42E …`, sender domains on `.test`, codes of
// letters and digits made up here, plain airport and carrier fixtures, dates from Postgres's
// CURRENT_DATE with day offsets.
//
// CLEANUP IS OF THIS SUITE'S OWN ROWS: flight reads and segments first, then the hotel and balance rows
// of `ZQ42E …` programs, messages, memberships, programs and people, and the auth tables through
// `resetAuth`. Every trigger, spy and environment change is undone in a `finally` or an `afterEach`.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { runDailyJob } from '@/lib/scheduler';
import * as flightRead from '@/lib/loyaltyFlightRead';
import * as flightStore from '@/lib/loyaltyFlightStore';
import { createBookingReader, createFlightReader, createMailReader, type MailReader, type MailReaderInput, type MailReaderResult } from '@/lib/loyaltyReader';
import { LOYALTY_READ_MAX_PER_RUN, LoyaltyInboxReadResponseSchema, LoyaltySegmentResponseSchema } from '@b8/contracts/loyalty';
import { bootstrapOwner, cookie, bearer, enrolSecondUser, resetAuth, type EnrolledUser } from '../auth/secondUserTestKit';
import * as segmentsRoute from './segments/route';
import { POST as readPOST } from './inbox/read/route';

// ─── Mocks ─────────────────────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  /** The fake the next `createFlightReader` call returns. */
  reader: null as null | { read(input: { subject: string | null; text: string }): Promise<unknown> },
  /** Flight reads made with no fake installed. */
  unexpected: 0,
  /** Reads the balance and booking readers were asked for. */
  mailReads: 0,
  bookingReads: 0,
  order: [] as string[],
}));

vi.mock('@/lib/loyaltyReader', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/loyaltyReader')>();
  return {
    ...real,
    createMailReader: vi.fn(() => ({ read: async () => { H.mailReads++; return { ok: false, code: 'api_error' }; } })),
    createBookingReader: vi.fn(() => ({ read: async () => { H.bookingReads++; return { ok: false, code: 'api_error' }; } })),
    createFlightReader: vi.fn(() => H.reader ?? { read: async () => { H.unexpected++; return { ok: false, code: 'api_error' }; } }),
  };
});
// The daily job's other steps, so `runDailyJob` runs nothing that needs Plaid, mail or push. The
// balance read step only records its turn; the booking and flight steps record theirs and run for real.
vi.mock('@/lib/sync', async (o) => ({ ...(await o<object>()), runSync: vi.fn(async () => { H.order.push('sync'); return {}; }) }));
vi.mock('@/lib/dailyDigest', async (o) => ({ ...(await o<object>()), runDailyDigest: vi.fn(async () => { H.order.push('digest'); return false; }) }));
vi.mock('@/lib/webPush', async (o) => ({ ...(await o<object>()), sendWebPushIfDelivered: vi.fn(async () => {}) }));
vi.mock('@/lib/categorySuggester', async (o) => ({ ...(await o<object>()), suggestCategories: vi.fn(async () => {}) }));
vi.mock('@/lib/receiptCaptureStore', async (o) => ({ ...(await o<object>()), watchReceipts: vi.fn(async () => {}) }));
vi.mock('@/lib/unspentStore', async (o) => ({ ...(await o<object>()), recordCloses: vi.fn(async () => {}) }));
vi.mock('@/lib/yearEndSnapshots', async (o) => ({ ...(await o<object>()), writeYearEndSnapshot: vi.fn(async () => {}) }));
vi.mock('@/lib/netWorth', async (o) => ({ ...(await o<object>()), writeNetWorthSnapshot: vi.fn(async () => {}) }));
vi.mock('@/lib/giftStore', async (o) => ({ ...(await o<object>()), runGiftSweep: vi.fn(async () => {}) }));
vi.mock('@/lib/loyaltyInbox', async (o) => ({ ...(await o<object>()), runLoyaltyInboxDaily: vi.fn(async () => { H.order.push('inbox'); }) }));
vi.mock('@/lib/loyaltyInboxRead', async (o) => ({ ...(await o<object>()), runLoyaltyReadDaily: vi.fn(async () => { H.order.push('read'); }) }));
vi.mock('@/lib/loyaltyBookingRead', async (o) => {
  const real = await o<typeof import('@/lib/loyaltyBookingRead')>();
  return { ...real, runLoyaltyBookingsDaily: vi.fn(async () => { H.order.push('bookings'); return real.runLoyaltyBookingsDaily(); }) };
});
vi.mock('@/lib/loyaltyFlightRead', async (o) => {
  const real = await o<typeof import('@/lib/loyaltyFlightRead')>();
  if (typeof real.runLoyaltyFlightsDaily !== 'function') return real;
  return { ...real, runLoyaltyFlightsDaily: vi.fn(async () => { H.order.push('flights'); return real.runLoyaltyFlightsDaily(); }) };
});

// ─── The module under test, reached as a namespace ─────────────────────────────────────────────

/** A named export as a function, after asserting that it is one (a tree without it fails here). */
function exported<T>(mod: Record<string, unknown>, name: string): T {
  expect(typeof mod[name], `${name} is exported`).toBe('function');
  return mod[name] as T;
}
type Run = { outcome: string; read: number; recorded: number; queued: number; stale: number; none: number; noBooking: number; discarded: number; failed: number; remaining: number; errorCode: string | null };
const readStoredFlights = (env: Record<string, string | undefined>) =>
  exported<(e: Record<string, string | undefined>) => Promise<Run>>(flightRead, 'readStoredFlights')(env);
const loadFlights = () => exported<() => Promise<Record<string, unknown[]>>>(flightStore, 'loadFlights')();
const typedPOST = (req: NextRequest) => exported<(r: NextRequest) => Promise<Response>>(segmentsRoute, 'POST')(req);

// ─── The world ─────────────────────────────────────────────────────────────────────────────────

const KEY = 'zq42e-key-canary-not-a-real-key';
const ENV = { ANTHROPIC_API_KEY: KEY };
const ENV_NAMES = ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'LOYALTY_READ_TIMEOUT_SECONDS'];
let savedEnv: Record<string, string | undefined> = {};

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const pgDay = async (n = 0) => (await db.query<{ d: string }>('SELECT (CURRENT_DATE + $1::int)::text AS d', [n])).rows[0].d;
const count = async (sql: string, values: unknown[] = []) => Number((await db.query<{ n: string }>(sql, values)).rows[0].n);
const OURS = `SELECT id FROM loyalty_programs WHERE name LIKE 'ZQ42E%'`;

async function clearWorld(): Promise<void> {
  await db.query(`DELETE FROM loyalty_inbox_flight_reads WHERE program_id IN (${OURS})`);
  await db.query(`DELETE FROM loyalty_segments WHERE program_id IN (${OURS})`);
  await db.query(`DELETE FROM loyalty_inbox_booking_reads WHERE program_id IN (${OURS})`);
  await db.query(`DELETE FROM loyalty_stays WHERE program_id IN (${OURS})`);
  await db.query(`DELETE FROM loyalty_inbox_reads WHERE program_id IN (${OURS})`);
  await db.query(`DELETE FROM loyalty_inbox_not_mine WHERE program_id IN (${OURS})`);
  await db.query(`DELETE FROM loyalty_inbox_messages WHERE program_id IN (${OURS})`);
  await db.query(`DELETE FROM loyalty_observations WHERE membership_id IN (SELECT id FROM loyalty_memberships WHERE program_id IN (${OURS}))`);
  await db.query(`DELETE FROM loyalty_memberships WHERE program_id IN (${OURS})`);
  await db.query(`DELETE FROM loyalty_programs WHERE name LIKE 'ZQ42E%'`);
  await db.query(`DELETE FROM household_members WHERE display_name LIKE 'ZQ42E%'`);
}

const program = async (name: string, kind = 'airline') =>
  (await db.query<{ id: number }>(`INSERT INTO loyalty_programs (name, kind, default_unit) VALUES ($1, $2, 'points') RETURNING id`, [name, kind])).rows[0].id;
const person = async (name: string) =>
  (await db.query<{ id: number }>('INSERT INTO household_members (display_name) VALUES ($1) RETURNING id', [name])).rows[0].id;
const membership = async (memberId: number, programId: number, number: string | null = null) =>
  (await db.query<{ id: number }>('INSERT INTO loyalty_memberships (member_id, program_id, member_number) VALUES ($1, $2, $3) RETURNING id', [memberId, programId, number])).rows[0].id;

/** One airline program with two people holding numbered memberships. */
async function wings() {
  const a = await program('ZQ42E Fly Wings');
  const ana = await person('ZQ42E Fly Ana');
  const ben = await person('ZQ42E Fly Ben');
  return { a, ana, ben, mA: await membership(ana, a, 'ZQ42E-0001-7K9X'), mB: await membership(ben, a, 'ZQ42E-0002-4M2P') };
}

let seq = 0;
/**
 * Stores one fabricated message for `programId`, received `day` days from today, forwarded by
 * `memberId` (attribution `matched`) or by nobody known. Its text carries the marker the fake reads.
 */
async function mail(programId: number, mark: string, opts: { day?: number; memberId?: number | null; oversize?: boolean } = {}): Promise<string> {
  seq++;
  const key = sha(`zq42e-flight-${mark}-${seq}`);
  const raw = opts.oversize ? null : Buffer.from([
    'From: ZQ42E Wings <trips@zq42e-wings.test>',
    'To: inbox@example.com',
    `Subject: ZQ42E itinerary ${mark}`,
    `Message-ID: <${mark}.${seq}@zq42e-wings.test>`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    `Your trip. ZQ42E-CASE ${mark}`,
    '',
  ].join('\r\n'), 'utf8');
  const memberId = opts.memberId ?? null;
  await db.query(
    `INSERT INTO loyalty_inbox_messages (dedupe_key, received_on, program_id, sender_domain, origin, attribution, member_id, raw_mail, oversize)
     VALUES ($1, CURRENT_DATE + $2::int, $3, 'zq42e-wings.test', 'direct', $4, $5, $6, $7)`,
    [key, opts.day ?? -1, programId, memberId === null ? 'none_found' : 'matched', memberId, raw, raw === null]
  );
  return key;
}

const markOf = (input: { text: string }) => /ZQ42E-CASE (\S+)/.exec(input.text)?.[1] ?? null;
type Answer = unknown | ((input: MailReaderInput) => MailReaderResult | Promise<MailReaderResult>);
/** Installs a fake answering each marker from `answers`; returns the markers in the order read. */
function install(answers: Record<string, Answer>): string[] {
  const order: string[] = [];
  const reader: MailReader = {
    read: async (input) => {
      const mark = markOf(input);
      order.push(mark ?? '?');
      const a = mark === null ? undefined : answers[mark];
      if (a === undefined) return { ok: false, code: 'api_error' };
      return typeof a === 'function' ? (a as (i: MailReaderInput) => MailReaderResult)(input) : { ok: true, reading: a };
    },
  };
  H.reader = reader;
  return order;
}

type Leg = { flightDate: string; origin: string; destination: string; carrier: string; flightNumber: string };
const leg = (flightDate: string, flightNumber = '412', origin = 'JFK', destination = 'LHR', carrier = 'ZQ'): Leg =>
  ({ flightDate, origin, destination, carrier, flightNumber });
/** A flight answer; each case overrides what it is about. */
const fly = (over: Record<string, unknown>) => ({
  kind: 'flight_booked', programName: null, memberNumberSuffix: null, confirmationCode: null, award: null, completeItinerary: false, segments: [], ...over,
});
const run = (): Promise<Run> => readStoredFlights(ENV);
const readRow = async (key: string) => (await db.query(
  `SELECT id, state, kind, reason, suffix, booking, membership_id, attempts, last_error_code, program_check FROM loyalty_inbox_flight_reads WHERE dedupe_key = $1`, [key]
)).rows[0];
const legsOf = async (programId: number, code: string) => (await db.query(
  `SELECT id, membership_id, state, source, origin, destination, carrier, flight_number, flight_date::text AS flight_date, award,
          evidence_key, evidence_received_on::text AS evidence_received_on, updated_at::text AS updated_at
     FROM loyalty_segments WHERE program_id = $1 AND confirmation_code = $2 ORDER BY flight_date, flight_number`, [programId, code]
)).rows;
const segments = (programId: number) => count('SELECT count(*) AS n FROM loyalty_segments WHERE program_id = $1', [programId]);
const sumOf = async (tables: string[]) => (await db.query<{ s: string }>(`SELECT md5(${tables
  .map((t) => `coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM ${t} x), '')`).join(' || ')}) AS s`)).rows[0].s;

// ─── Requests ──────────────────────────────────────────────────────────────────────────────────

const ORIGIN = 'http://localhost:3000';
type Who = EnrolledUser | { bearer: string } | null;
const auth = (who: Who) => (who === null ? {} : 'bearer' in who ? bearer(who.bearer) : cookie(who.token));
const bodies: string[] = [];
async function answerOf(res: Response | Promise<Response>) {
  const r = await res;
  const text = await r.text();
  bodies.push(text);
  let body: { success?: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } } = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, text, body };
}
const post = (path: string, who: Who, body: unknown) =>
  new NextRequest(`${ORIGIN}${path}`, { method: 'POST', headers: { host: 'localhost:3000', 'content-type': 'application/json', ...auth(who) }, body: JSON.stringify(body) });
const typed = (who: Who, body: unknown) => answerOf(typedPOST(post('/api/v1/loyalty/segments', who, body)));

/** Every console line of the whole file, for the privacy checks. */
const lines: string[] = [];
let owner: EnrolledUser;
let two: EnrolledUser;

beforeAll(async () => {
  const capture = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  for (const m of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(capture);
  savedEnv = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
  await clearWorld();
  await resetAuth();
  owner = await bootstrapOwner();
  two = await enrolSecondUser(owner.token);
}, 60_000);

beforeEach(async () => {
  H.reader = null;
  H.unexpected = 0;
  H.mailReads = 0;
  H.bookingReads = 0;
  H.order.length = 0;
  vi.mocked(createMailReader).mockClear();
  vi.mocked(createBookingReader).mockClear();
  vi.mocked(createFlightReader).mockClear();
  for (const n of ENV_NAMES) delete process.env[n];
  await clearWorld();
});

afterEach(async () => {
  H.reader = null;
  for (const n of ENV_NAMES) delete process.env[n];
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

describe('the flight read (P8-42e1b)', () => {
  it('T42e1b-I1: only airline-program mail is flight-read, oldest first, once and bounded; hotel, balance and observation rows are untouched', async () => {
    const a = await program('ZQ42E Fly One');
    const a2 = await program('ZQ42E Fly Two');
    const h = await program('ZQ42E Fly Harbour', 'hotel');
    const card = await program('ZQ42E Fly Card', 'card_currency');
    const car = await program('ZQ42E Fly Car', 'car');
    const hp = await person('ZQ42E Fly Guest');
    const mH = await membership(hp, h);
    const keys = {
      a1: await mail(a, 'i1-a1', { day: -9 }),
      a2: await mail(a, 'i1-a2', { day: -8, oversize: true }),
      a3: await mail(a, 'i1-a3', { day: -7 }),
      a4: await mail(a, 'i1-a4', { day: -10 }),
      a5: await mail(a, 'i1-a5', { day: -6 }),
      a6: await mail(a2, 'i1-a6', { day: -5 }),
      h1: await mail(h, 'i1-h1', { day: -11 }),
      h2: await mail(h, 'i1-h2', { day: -12 }),
      card: await mail(card, 'i1-card', { day: -13 }),
      car: await mail(car, 'i1-car', { day: -14 }),
    };
    await db.query(`INSERT INTO loyalty_inbox_flight_reads (dedupe_key, program_id, received_on, state, attempts, kind, program_check, read_on, resolved_on)
                    VALUES ($1, $2, CURRENT_DATE - 7, 'none', 1, 'none', 'not_stated', CURRENT_DATE, CURRENT_DATE)`, [keys.a3, a]);
    await db.query(`INSERT INTO loyalty_inbox_flight_reads (dedupe_key, program_id, received_on, state, attempts, last_error_code)
                    VALUES ($1, $2, CURRENT_DATE - 10, 'retry', 1, 'timeout')`, [keys.a4, a]);
    await db.query(`INSERT INTO loyalty_inbox_flight_reads (dedupe_key, program_id, received_on, state, attempts, last_error_code)
                    VALUES ($1, $2, CURRENT_DATE - 6, 'failed', 3, 'timeout')`, [keys.a5, a]);
    // The hotel program's message that 42e1's booking pass left in `flight`, and a balance read and
    // observation beside it, so every snapshot below has rows in it.
    await db.query(`INSERT INTO loyalty_inbox_booking_reads (dedupe_key, program_id, received_on, state, attempts, kind, program_check, read_on, resolved_on)
                    VALUES ($1, $2, CURRENT_DATE - 11, 'flight', 1, 'flight', 'not_stated', CURRENT_DATE, CURRENT_DATE)`, [keys.h1, h]);
    await db.query(`INSERT INTO loyalty_inbox_reads (dedupe_key, program_id, received_on, state, attempts, program_check, read_on, resolved_on)
                    VALUES ($1, $2, CURRENT_DATE - 12, 'no_balance', 1, 'not_stated', CURRENT_DATE, CURRENT_DATE)`, [keys.h2, h]);
    await db.query(`INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source) VALUES ($1, CURRENT_DATE - 5, 12, 'points', 'email')`, [mH]);
    await db.query(`INSERT INTO loyalty_stays (membership_id, program_id, confirmation_code, check_in, check_out, state, source)
                    VALUES ($1, $2, 'ZQ42EHST1', CURRENT_DATE + 3, CURRENT_DATE + 5, 'booked', 'typed')`, [mH, h]);
    const NEIGHBOURS = ['loyalty_inbox_booking_reads', 'loyalty_inbox_reads', 'loyalty_observations', 'loyalty_stays'];
    const before = await sumOf(NEIGHBOURS);
    const none = { kind: 'none' };
    const all = Object.fromEntries(['i1-a1', 'i1-a2', 'i1-a3', 'i1-a4', 'i1-a5', 'i1-a6', 'i1-h1', 'i1-h2', 'i1-card', 'i1-car'].map((m) => [m, none]));
    const order = install(all);

    const r = await run();
    expect(order).toEqual(['i1-a4', 'i1-a1', 'i1-a6']);
    expect(r).toMatchObject({ outcome: 'ok', read: 3, none: 3, failed: 0, remaining: 0, errorCode: null });
    expect(H.mailReads + H.bookingReads).toBe(0);
    expect(vi.mocked(createMailReader)).not.toHaveBeenCalled();
    expect(vi.mocked(createBookingReader)).not.toHaveBeenCalled();
    expect(await sumOf(NEIGHBOURS)).toBe(before);
    expect((await db.query('SELECT state, kind FROM loyalty_inbox_booking_reads WHERE dedupe_key = $1', [keys.h1])).rows).toEqual([{ state: 'flight', kind: 'flight' }]);
    expect(await count('SELECT count(*) AS n FROM loyalty_inbox_flight_reads WHERE dedupe_key = ANY($1)', [[keys.a2, keys.h1, keys.h2, keys.card, keys.car]])).toBe(0);
    expect(await readRow(keys.a4)).toMatchObject({ state: 'none', attempts: 2 });
    expect(await readRow(keys.a3)).toMatchObject({ state: 'none', attempts: 1 });
    expect(await readRow(keys.a5)).toMatchObject({ state: 'failed', attempts: 3 });

    // Read once: a second run asks for nothing that settled.
    const again = install(all);
    expect(await run()).toMatchObject({ read: 0, remaining: 0 });
    expect(again).toEqual([]);

    // At most the per-run bound, the rest left for the next run.
    const many: Record<string, Answer> = {};
    for (let i = 0; i <= LOYALTY_READ_MAX_PER_RUN; i++) {
      await mail(a, `i1-many-${i}`, { day: -30 + (i % 5) });
      many[`i1-many-${i}`] = none;
    }
    const second = install(many);
    expect(await run()).toMatchObject({ read: LOYALTY_READ_MAX_PER_RUN, remaining: 1 });
    expect(second).toHaveLength(LOYALTY_READ_MAX_PER_RUN);
    const third = install(many);
    expect(await run()).toMatchObject({ read: 1, remaining: 0 });
    expect(third).toHaveLength(1);
    expect(second).not.toContain(third[0]);
    expect(await sumOf(NEIGHBOURS)).toBe(before);
  });

  it('T42e1b-I2: a complete confirmation becomes booked segments on the forwarder\'s membership; a none and every unusable booking store nothing', async () => {
    const { a, ana, mA } = await wings();
    const [d10, d17, d365] = [await pgDay(10), await pgDay(17), await pgDay(365)];
    const keys = {
      booked: await mail(a, 'i2-booked', { day: -2, memberId: ana }),
      none: await mail(a, 'i2-none', { day: -2, memberId: ana }),
      noCode: await mail(a, 'i2-nocode', { day: -2, memberId: ana }),
      noLegs: await mail(a, 'i2-nolegs', { day: -2, memberId: ana }),
      oneBad: await mail(a, 'i2-onebad', { day: -2, memberId: ana }),
      thirteen: await mail(a, 'i2-thirteen', { day: -2, memberId: ana }),
      far: await mail(a, 'i2-far', { day: -2, memberId: ana }),
    };
    install({
      'i2-booked': fly({
        confirmationCode: 'zq42e-ab12', award: true, completeItinerary: true, passengerName: 'ZQ42E-PASSENGER-CANARY',
        segments: [{ ...leg(d10), origin: 'jfk', seat: 'ZQ42E-SEAT-CANARY' }, leg(d17, '413', 'LHR', 'JFK')],
      }),
      'i2-none': { kind: 'none' },
      'i2-nocode': fly({ segments: [leg(d10)] }),
      'i2-nolegs': fly({ confirmationCode: 'ZQ42ENL01', segments: [] }),
      'i2-onebad': fly({ confirmationCode: 'ZQ42EOB01', segments: [leg(d10), leg(d17, '413', 'LH1', 'JFK')] }),
      'i2-thirteen': fly({ confirmationCode: 'ZQ42ETH01', segments: Array.from({ length: 13 }, (_, i) => leg(d10, String(100 + i))) }),
      'i2-far': fly({ confirmationCode: 'ZQ42EFR01', segments: [leg(d365)] }),
    });
    expect(await run()).toMatchObject({ read: 7, recorded: 1, none: 1, noBooking: 5 });
    const rows = await legsOf(a, 'ZQ42EAB12');
    expect(rows).toHaveLength(2);
    const ev = { membership_id: mA, state: 'booked', source: 'email', award: true, evidence_key: keys.booked, evidence_received_on: await pgDay(-2) };
    expect(rows[0]).toMatchObject({ ...ev, flight_date: d10, origin: 'JFK', destination: 'LHR', carrier: 'ZQ', flight_number: '412' });
    expect(rows[1]).toMatchObject({ ...ev, flight_date: d17, origin: 'LHR', destination: 'JFK', carrier: 'ZQ', flight_number: '413' });
    expect(await readRow(keys.booked)).toMatchObject({ state: 'recorded', kind: 'flight_booked', booking: null, membership_id: mA });
    expect(await readRow(keys.none)).toMatchObject({ state: 'none', kind: 'none', membership_id: null });
    for (const k of [keys.noCode, keys.noLegs, keys.oneBad, keys.thirteen, keys.far]) {
      expect(await readRow(k)).toMatchObject({ state: 'no_booking', kind: 'flight_booked', membership_id: null, booking: null });
    }
    // Negative control: the valid leg beside the invalid one is NOT stored.
    expect(await legsOf(a, 'ZQ42EOB01')).toEqual([]);
    expect(await segments(a)).toBe(2);
    const all = (await db.query(`SELECT row_to_json(x)::text AS t FROM loyalty_segments x WHERE program_id = $1
                                 UNION ALL SELECT row_to_json(y)::text FROM loyalty_inbox_flight_reads y WHERE program_id = $1`, [a])).rows.map((r) => r.t as string);
    for (const t of all) expect(t).not.toMatch(/PASSENGER|SEAT-CANARY/);
  });

  it('T42e1b-I3: a leg is its date, carrier, number and code; a change rewrites or adds, a complete mail cancels only email legs, and nothing moves', async () => {
    const { a, ana, ben, mA } = await wings();
    const a2 = await program('ZQ42E Fly Second');
    await membership(ana, a2);
    const [d10, d17, d18, d20] = [await pgDay(10), await pgDay(17), await pgDay(18), await pgDay(20)];
    const A = leg(d10);
    const B = leg(d17, '413', 'LHR', 'JFK');
    const B2 = leg(d18, '413', 'LHR', 'JFK');
    const step = async (mark: string, day: number, by: number, over: Record<string, unknown>, programId = a) => {
      const key = await mail(programId, mark, { day, memberId: by });
      install({ [mark]: fly({ confirmationCode: 'ZQ42EIT01', ...over }) });
      await run();
      return key;
    };
    const states = async () => (await legsOf(a, 'ZQ42EIT01')).map((r) => `${r.flight_date}|${r.flight_number}|${r.state}|${r.source}`);

    await step('i3-first', -6, ana, { segments: [A, B], completeItinerary: true });
    expect(await segments(a)).toBe(2);
    const first = await legsOf(a, 'ZQ42EIT01');
    // A new origin on A is the same leg, rewritten.
    await step('i3-origin', -5, ana, { segments: [{ ...A, origin: 'EWR' }, B] });
    expect(await segments(a)).toBe(2);
    const moved = await legsOf(a, 'ZQ42EIT01');
    expect(moved[0]).toMatchObject({ id: first[0].id, origin: 'EWR' });
    expect(moved[0].updated_at).not.toBe(first[0].updated_at);
    // A new date on B, not complete: the old B stays booked (negative control), the new one is added.
    await step('i3-partial', -4, ana, { segments: [A, B2] });
    expect(await segments(a)).toBe(3);
    expect(await states()).toEqual([`${d10}|412|booked|email`, `${d17}|413|booked|email`, `${d18}|413|booked|email`]);
    // The same change, complete: the old B is cancelled, none deleted.
    await step('i3-complete', -3, ana, { segments: [A, B2], completeItinerary: true });
    expect(await segments(a)).toBe(3);
    expect(await states()).toEqual([`${d10}|412|booked|email`, `${d17}|413|cancelled|email`, `${d18}|413|booked|email`]);
    // A typed leg of the code is never cancelled by omission (negative control).
    await db.query(`INSERT INTO loyalty_segments (membership_id, program_id, confirmation_code, flight_date, origin, destination, carrier, flight_number, state, source)
                    VALUES ($1, $2, 'ZQ42EIT01', $3::date, 'JFK', 'SFO', 'ZQ', '900', 'booked', 'typed')`, [mA, a, d20]);
    await step('i3-typed', -2, ana, { segments: [A, B2], completeItinerary: true });
    expect(await segments(a)).toBe(4);
    expect((await legsOf(a, 'ZQ42EIT01')).find((r) => r.flight_number === '900')).toMatchObject({ state: 'booked', source: 'typed' });
    // The code respelled is the same code.
    await step('i3-respelled', -1, ana, { confirmationCode: 'zq42e-it01', segments: [A] });
    expect(await segments(a)).toBe(4);
    // The same code in another airline program is another booking (negative control: no merge).
    await step('i3-other', -1, ana, { segments: [A] }, a2);
    expect(await segments(a)).toBe(4);
    expect(await segments(a2)).toBe(1);
    // The same identity twice in one mail is one row.
    await step('i3-twice', -1, ana, { confirmationCode: 'ZQ42EIT02', segments: [A, { ...A, origin: 'EWR' }] });
    expect(await legsOf(a, 'ZQ42EIT02')).toHaveLength(1);
    // A mail placed on the other person's membership updates the rows where they are.
    const key = await step('i3-ben', 0, ben, { segments: [{ ...A, origin: 'BOS' }] });
    expect(await readRow(key)).toMatchObject({ state: 'recorded', membership_id: mA });
    expect((await legsOf(a, 'ZQ42EIT01')).map((r) => r.membership_id)).toEqual([mA, mA, mA, mA]);
    expect((await legsOf(a, 'ZQ42EIT01'))[0].origin).toBe('BOS');
    expect(await segments(a)).toBe(5);
  });

  it('T42e1b-I4: a cancellation keeps every row and lists none; mail never revives a cancelled flight and never offers it for one tap', async () => {
    const { a, ana } = await wings();
    await db.query(`CREATE FUNCTION zq42e_no_segment_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'zq42e: a segment was deleted'; END $$`);
    await db.query(`CREATE TRIGGER zq42e_no_segment_delete BEFORE DELETE ON loyalty_segments FOR EACH ROW EXECUTE FUNCTION zq42e_no_segment_delete()`);
    try {
      const [d10, d17] = [await pgDay(10), await pgDay(17)];
      const A = leg(d10);
      const B = leg(d17, '413', 'LHR', 'JFK');
      const step = async (mark: string, day: number, over: Record<string, unknown>, by: number | null = ana) => {
        const key = await mail(a, mark, { day, memberId: by });
        install({ [mark]: fly(over) });
        await run();
        return key;
      };
      // A whole cancellation: both rows cancelled, dates and codes kept, neither listed.
      await step('i4-book', -6, { confirmationCode: 'ZQ42ECX01', segments: [A, B], completeItinerary: true });
      const cancel = await step('i4-cancel', -5, { kind: 'flight_cancelled', confirmationCode: 'ZQ42ECX01' });
      expect(await readRow(cancel)).toMatchObject({ state: 'recorded' });
      expect((await legsOf(a, 'ZQ42ECX01')).map((r) => [r.state, r.flight_date, r.evidence_key])).toEqual([['cancelled', d10, cancel], ['cancelled', d17, cancel]]);
      const listed = await loadFlights();
      const ids = [...(listed.upcoming as { id: number }[]), ...(listed.recent as { id: number }[])].map((s) => s.id);
      for (const r of await legsOf(a, 'ZQ42ECX01')) expect(ids).not.toContain(r.id);
      // A one-leg cancellation: only that leg.
      await step('i4-book2', -6, { confirmationCode: 'ZQ42ECX02', segments: [A, B], completeItinerary: true });
      await step('i4-one', -5, { kind: 'flight_cancelled', confirmationCode: 'ZQ42ECX02', segments: [A] });
      expect((await legsOf(a, 'ZQ42ECX02')).map((r) => r.state)).toEqual(['cancelled', 'booked']);
      // A listed leg with no row is created cancelled; an unknown code with no legs is no_booking.
      await step('i4-new', -5, { kind: 'flight_cancelled', confirmationCode: 'ZQ42ECX03', segments: [A] });
      expect((await legsOf(a, 'ZQ42ECX03')).map((r) => r.state)).toEqual(['cancelled']);
      const unknown = await step('i4-unknown', -5, { kind: 'flight_cancelled', confirmationCode: 'ZQ42ECX04' });
      expect(await readRow(unknown)).toMatchObject({ state: 'no_booking' });
      expect(await legsOf(a, 'ZQ42ECX04')).toEqual([]);
      // The original confirmation re-forwarded AFTER the cancellation: stale, still cancelled, not held;
      // with an unmatchable suffix and no forwarder too.
      const pending = () => count(`SELECT count(*) AS n FROM loyalty_inbox_flight_reads WHERE program_id = $1 AND state = 'pending'`, [a]);
      const again = await step('i4-again', -3, { confirmationCode: 'ZQ42ECX01', segments: [A, B], completeItinerary: true });
      expect(await readRow(again)).toMatchObject({ state: 'stale', booking: null, reason: null });
      const lost = await step('i4-lost', -2, { confirmationCode: 'ZQ42ECX01', memberNumberSuffix: 'ZZ99', segments: [A, B] }, null);
      expect(await readRow(lost)).toMatchObject({ state: 'stale', booking: null, reason: null });
      expect(await pending()).toBe(0);
      expect((await legsOf(a, 'ZQ42ECX01')).map((r) => [r.state, r.evidence_key])).toEqual([['cancelled', cancel], ['cancelled', cancel]]);
      expect(await segments(a)).toBe(5);
    } finally {
      await db.query('DROP TRIGGER IF EXISTS zq42e_no_segment_delete ON loyalty_segments');
      await db.query('DROP FUNCTION IF EXISTS zq42e_no_segment_delete()');
    }
  });

  it('T42e1b-I5: the received date orders mail; a typed correction keeps its evidence and stands against older mail; typed writes stay in their membership', async () => {
    const { a, ana, mA, mB } = await wings();
    const d10 = await pgDay(10);
    const A = leg(d10);
    const step = async (mark: string, day: number, kind: 'flight_booked' | 'flight_cancelled', code: string, legs: Leg[] = [A]) => {
      const key = await mail(a, mark, { day, memberId: ana });
      install({ [mark]: fly({ kind, confirmationCode: code, segments: legs }) });
      await run();
      return { key, state: (await readRow(key)).state as string };
    };
    const state = async (code: string) => (await legsOf(a, code)).map((r) => r.state);

    // An older booking after a newer one: stale, the rows unchanged.
    expect((await step('i5-a1', -2, 'flight_booked', 'ZQ42EOA01')).state).toBe('recorded');
    const before = await sumOf(['loyalty_segments']);
    expect((await step('i5-a2', -5, 'flight_booked', 'ZQ42EOA01', [{ ...A, origin: 'EWR' }])).state).toBe('stale');
    expect(await sumOf(['loyalty_segments'])).toBe(before);
    // An older cancellation after a newer booking: stale, still booked.
    expect((await step('i5-b1', -2, 'flight_booked', 'ZQ42EOB02')).state).toBe('recorded');
    expect((await step('i5-b2', -4, 'flight_cancelled', 'ZQ42EOB02', [])).state).toBe('stale');
    expect(await state('ZQ42EOB02')).toEqual(['booked']);
    // An equal-dated cancellation applies; an equal-dated booking after it does not.
    expect((await step('i5-c1', -3, 'flight_booked', 'ZQ42EOC03')).state).toBe('recorded');
    expect((await step('i5-c2', -3, 'flight_cancelled', 'ZQ42EOC03', [])).state).toBe('recorded');
    expect(await state('ZQ42EOC03')).toEqual(['cancelled']);
    expect((await step('i5-c3', -3, 'flight_booked', 'ZQ42EOC03')).state).toBe('stale');
    expect(await state('ZQ42EOC03')).toEqual(['cancelled']);

    // A typed leg yields to the first mail for its code.
    const body = (over: Record<string, unknown>) => ({ membershipId: mA, confirmationCode: 'ZQ42ETY01', ...A, state: 'booked', award: null, ...over });
    expect((await typed(owner, body({ destination: 'CDG' }))).status).toBe(201);
    const k1 = await step('i5-first', -3, 'flight_booked', 'ZQ42ETY01');
    expect((await legsOf(a, 'ZQ42ETY01'))[0]).toMatchObject({ source: 'email', destination: 'LHR', evidence_key: k1.key, evidence_received_on: await pgDay(-3) });
    // A mail-made leg, then a typed correction: typed fields, the evidence kept.
    const k2 = await step('i5-mail', -3, 'flight_booked', 'ZQ42ETY02');
    const corrected = await typed(two, body({ confirmationCode: 'zq42e-ty02', destination: 'CDG' }));
    expect(corrected.status).toBe(200);
    expect(LoyaltySegmentResponseSchema.safeParse(corrected.body).success).toBe(true);
    expect((await legsOf(a, 'ZQ42ETY02'))[0]).toMatchObject({ source: 'typed', destination: 'CDG', evidence_key: k2.key, evidence_received_on: await pgDay(-3) });
    // An older re-forwarded mail is stale and the correction stands; a strictly later one supersedes.
    expect((await step('i5-older', -5, 'flight_booked', 'ZQ42ETY02')).state).toBe('stale');
    expect((await legsOf(a, 'ZQ42ETY02'))[0]).toMatchObject({ source: 'typed', destination: 'CDG', evidence_key: k2.key });
    const k4 = await step('i5-later', -1, 'flight_booked', 'ZQ42ETY02');
    expect(k4.state).toBe('recorded');
    expect((await legsOf(a, 'ZQ42ETY02'))[0]).toMatchObject({ source: 'email', destination: 'LHR', evidence_key: k4.key });
    // A typed booked write re-books the cancelled leg: a person's act.
    const rebooked = await typed(owner, body({ confirmationCode: 'ZQ42EOC03' }));
    expect([rebooked.status, rebooked.body.data?.state]).toEqual([200, 'booked']);
    expect(await state('ZQ42EOC03')).toEqual(['booked']);
    // A typed write for a code under another membership of the program is refused, nothing changed.
    const snapshot = await sumOf(['loyalty_segments']);
    const elsewhere = await typed(owner, body({ membershipId: mB, confirmationCode: 'ZQ42ETY02' }));
    expect([elsewhere.status, elsewhere.body.error?.message]).toEqual([400, 'That confirmation code is already recorded under another membership of this program.']);
    expect(elsewhere.text).not.toMatch(/ZQ42ETY02/i);
    expect(await sumOf(['loyalty_segments'])).toBe(snapshot);
  });

  it('T42e1b-I6: attribution places only what nothing contradicts; every other flight is held with its reason, a cancellation included, or settled', async () => {
    const { a, ana, ben, mA } = await wings();
    const dee = await person('ZQ42E Fly Dee');
    const eve = await person('ZQ42E Fly Eve');
    await membership(dee, a, 'ZQ42E-0003-5Q5Q');
    await membership(eve, a, 'ZQ42E-0004-5Q5Q');
    await db.query(`INSERT INTO loyalty_inbox_not_mine (program_id, suffix) VALUES ($1, 'NM77')`, [a]);
    const d10 = await pgDay(10);
    // A booked code on mA, for the unplaceable cancellation below.
    await mail(a, 'i6-known', { day: -4, memberId: ana });
    install({ 'i6-known': fly({ confirmationCode: 'ZQ42EAT10', segments: [leg(d10, '10')] }) });
    await run();
    expect((await legsOf(a, 'ZQ42EAT10')).map((r) => r.state)).toEqual(['booked']);

    const cases: [string, number | null, Record<string, unknown>, string, string | null, number | null][] = [
      ['i6-forwarder', ana, {}, 'recorded', null, mA],
      ['i6-suffix', null, { memberNumberSuffix: '••••7K9X' }, 'recorded', null, mA],
      ['i6-conflict', ben, { memberNumberSuffix: '••••7K9X' }, 'pending', 'forwarder_conflict', null],
      ['i6-unmatched', null, { memberNumberSuffix: 'ZZ99' }, 'pending', 'unmatched_suffix', null],
      ['i6-ambiguous', null, { memberNumberSuffix: '5Q5Q' }, 'pending', 'ambiguous_suffix', null],
      ['i6-ambiguous-fwd', ana, { memberNumberSuffix: '5Q5Q' }, 'pending', 'ambiguous_suffix', null],
      ['i6-nobody', null, {}, 'pending', 'no_suffix', null],
      ['i6-mismatch', ana, { programName: 'ZQ42E Other Brand' }, 'pending', 'program_mismatch', null],
      ['i6-notmine', null, { memberNumberSuffix: 'NM77' }, 'not_mine_known', null, null],
      ['i6-cancel', null, { kind: 'flight_cancelled', confirmationCode: 'ZQ42EAT10', segments: [leg(d10, '10')] }, 'pending', 'no_suffix', null],
    ];
    const keys = new Map<string, string>();
    const answers: Record<string, Answer> = {};
    let n = 0;
    for (const [mark, by, over] of cases) {
      keys.set(mark, await mail(a, mark, { day: -2, memberId: by }));
      n++;
      answers[mark] = fly({ confirmationCode: `ZQ42EAT${String.fromCharCode(64 + n)}`, segments: [leg(d10, String(20 + n))], ...over });
    }
    const listsBefore = await loadFlights();
    install(answers);
    expect(await run()).toMatchObject({ read: cases.length, recorded: 2, queued: 7, discarded: 1 });
    for (const [mark, , , st, reason, placed] of cases) {
      const row = await readRow(keys.get(mark) as string);
      expect(row.state, mark).toBe(st);
      expect(row.reason, mark).toBe(reason);
      expect(row.membership_id, mark).toBe(placed);
      if (st === 'pending') expect(Object.keys(row.booking).sort(), mark).toEqual(['award', 'code', 'complete', 'kind', 'legs']);
      else expect(row.booking, mark).toBeNull();
    }
    // The unplaced cancellation was held, not applied: the leg stays booked.
    expect((await legsOf(a, 'ZQ42EAT10')).map((r) => r.state)).toEqual(['booked']);
    expect(((await readRow(keys.get('i6-cancel') as string)).booking as { kind: string }).kind).toBe('flight_cancelled');
    // Only the two placed bookings became segments, both on mA; no hold changed a list.
    expect((await db.query(`SELECT membership_id FROM loyalty_segments WHERE program_id = $1 ORDER BY id`, [a])).rows.map((x) => x.membership_id)).toEqual([mA, mA, mA]);
    const listsAfter = await loadFlights();
    const ids = (f: Record<string, unknown[]>) => [...(f.upcoming as { id: number; programId: number }[]), ...(f.recent as { id: number; programId: number }[])].filter((s) => s.programId === a).length;
    expect(ids(listsAfter)).toBe(ids(listsBefore) + 2);
    expect((listsAfter.queue as { programId: number }[]).filter((q) => q.programId === a)).toHaveLength(7);
  });

  it('T42e1b-I7: no key reads nothing; the attempt is committed before the call; failures retry to a bound, stop the run, and one run at a time', async () => {
    const { a } = await wings();
    const d10 = await pgDay(10);
    const reset = async () => {
      await db.query(`DELETE FROM loyalty_inbox_flight_reads WHERE program_id = $1`, [a]);
      await db.query(`DELETE FROM loyalty_inbox_messages WHERE program_id = $1`, [a]);
    };

    // No key: disabled, nothing written, no reader built or asked.
    await mail(a, 'i7-off');
    const calls = install({ 'i7-off': { kind: 'none' } });
    for (const env of [{}, { ANTHROPIC_API_KEY: '' }, { ANTHROPIC_API_KEY: '  ' }]) {
      expect(await readStoredFlights(env)).toEqual({
        outcome: 'disabled', read: 0, recorded: 0, queued: 0, stale: 0, none: 0, noBooking: 0, discarded: 0, failed: 0, remaining: 0, errorCode: null,
      });
    }
    expect(calls).toEqual([]);
    expect(vi.mocked(createFlightReader)).not.toHaveBeenCalled();
    expect(await count('SELECT count(*) AS n FROM loyalty_inbox_flight_reads WHERE program_id = $1', [a])).toBe(0);
    await reset();

    // The attempt row exists, committed, while the reader runs.
    const seen: unknown[] = [];
    const k = await mail(a, 'i7-seen');
    install({
      'i7-seen': async () => {
        seen.push((await db.query('SELECT state, attempts, last_error_code FROM loyalty_inbox_flight_reads WHERE dedupe_key = $1', [k])).rows[0]);
        return { ok: true, reading: { kind: 'none' } };
      },
    });
    await run();
    expect(seen).toEqual([{ state: 'retry', attempts: 1, last_error_code: 'api_error' }]);
    // A settled message is never given to the reader again.
    const again = install({ 'i7-seen': fly({ confirmationCode: 'ZQ42ERO01', segments: [leg(d10)] }) });
    expect(await run()).toMatchObject({ read: 0 });
    expect(again).toEqual([]);
    expect((await readRow(k)).state).toBe('none');
    await reset();

    // A throwing fake is api_error; refused is terminal at once; a timeout retries until the third attempt.
    const kThrow = await mail(a, 'i7-throw', { day: -3 });
    const kRefused = await mail(a, 'i7-refused', { day: -2 });
    H.reader = { read: async (input) => (markOf(input) === 'i7-throw' ? Promise.reject(new Error('zq42e reader blew up')) : { ok: false, code: 'refused' }) };
    await run();
    expect(await readRow(kThrow)).toMatchObject({ state: 'retry', attempts: 1, last_error_code: 'api_error' });
    expect(await readRow(kRefused)).toMatchObject({ state: 'failed', attempts: 1, last_error_code: 'refused' });
    await reset();
    const kTimeout = await mail(a, 'i7-timeout');
    install({ 'i7-timeout': () => ({ ok: false, code: 'timeout' }) });
    const states: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      await run();
      const row = await readRow(kTimeout);
      states.push([row.state, row.attempts]);
    }
    expect(states).toEqual([['retry', 1], ['retry', 2], ['failed', 3], ['failed', 3]]);
    await reset();

    // A rate limit stops the run at once; three transport failures in a row stop it too.
    const rl = [await mail(a, 'i7-rl-1', { day: -3 }), await mail(a, 'i7-rl-2', { day: -2 })];
    install({ 'i7-rl-1': () => ({ ok: false, code: 'rate_limited' }), 'i7-rl-2': { kind: 'none' } });
    expect(await run()).toMatchObject({ outcome: 'error', errorCode: 'rate_limited', failed: 1 });
    expect(await readRow(rl[1])).toBeUndefined();
    await reset();
    const tr = [await mail(a, 'i7-tr-1', { day: -5 }), await mail(a, 'i7-tr-2', { day: -4 }), await mail(a, 'i7-tr-3', { day: -3 }), await mail(a, 'i7-tr-4', { day: -2 })];
    install({ 'i7-tr-1': () => ({ ok: false, code: 'timeout' }), 'i7-tr-2': () => ({ ok: false, code: 'api_error' }), 'i7-tr-3': () => ({ ok: false, code: 'timeout' }), 'i7-tr-4': { kind: 'none' } });
    expect(await run()).toMatchObject({ outcome: 'error', errorCode: 'timeout', failed: 3 });
    expect(await readRow(tr[3])).toBeUndefined();
    await reset();

    // Two overlapping runs: one reads, the other is already_running and writes nothing.
    await mail(a, 'i7-gate');
    let open!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    const inside = new Promise<void>((r) => { entered = r; });
    install({ 'i7-gate': async () => { entered(); await gate; return { ok: true, reading: { kind: 'none' } }; } });
    const first = run();
    await inside;
    expect(await run()).toMatchObject({ outcome: 'already_running', read: 0 });
    open();
    expect(await first).toMatchObject({ outcome: 'ok', read: 1 });
    expect(H.unexpected).toBe(0);
  }, 60_000);

  it('T42e1b-I8: no passenger field, full number or code reaches a row, a payload or a log; logs carry counts and codes only', async () => {
    const { a, mA } = await wings();
    const C = {
      passenger: 'ZQ42E-PASSENGER-NAME-CANARY', ticket: 'ZQ42E-TICKET-CANARY', seat: 'ZQ42E-SEAT-CANARY', address: 'ZQ42E-ADDRESS-CANARY',
      phone: 'ZQ42E-PHONE-CANARY', card: 'ZQ42E-CARD-CANARY', total: 'ZQ42E-TOTAL-CANARY', number: 'ZQ42E-NUMBER-CANARY-0001-7K9X',
    };
    const CODES = { code: 'ZQ42ECODECANARY1', typed: 'ZQ42ETYPEDCANARY2', held: 'ZQ42EHELDCANARY3' };
    const d10 = await pgDay(10);
    const odd = leg(d10, '771', 'QZX', 'XQZ', 'Q7');
    const k = await mail(a, 'i8-hostile');
    await mail(a, 'i8-held');
    install({
      'i8-hostile': fly({
        memberNumberSuffix: C.number, confirmationCode: CODES.code, award: true, segments: [{ ...odd, seat: C.seat }],
        passengerName: C.passenger, ticketNumber: C.ticket, address: C.address, phone: C.phone, cardLast4: C.card, total: C.total,
      }),
      'i8-held': fly({ memberNumberSuffix: 'ZZ88', confirmationCode: CODES.held, segments: [odd], passengerName: C.passenger }),
    });
    const from = lines.length;
    await run();
    expect((await legsOf(a, CODES.code))[0]).toMatchObject({ membership_id: mA, origin: 'QZX' });
    expect((await readRow(k)).suffix).toBe('7K9X');
    const typedAnswer = await typed(owner, { membershipId: mA, confirmationCode: CODES.typed, ...leg(d10, '772', 'QZX', 'XQZ', 'Q7'), state: 'booked', award: null });
    expect(typedAnswer.status).toBe(201);
    expect(typedAnswer.body.data?.maskedCode).toBe('••••ARY2');
    // Every column of both tables, as text, for each canary.
    const rows = (await db.query(`SELECT row_to_json(x)::text AS t FROM loyalty_segments x WHERE program_id = $1
                                  UNION ALL SELECT row_to_json(y)::text FROM loyalty_inbox_flight_reads y WHERE program_id = $1`, [a])).rows.map((r) => r.t as string);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const t of rows) for (const c of Object.values(C)) expect(t).not.toContain(c);
    const payload = JSON.stringify(await loadFlights());
    for (const c of [...Object.values(C), ...Object.values(CODES)]) expect(payload).not.toContain(c);
    expect(payload).toContain('••••ARY1');
    expect(payload).toContain('••••ARY3');
    for (const c of [...Object.values(C), ...Object.values(CODES)]) expect(typedAnswer.text).not.toContain(c);
    // Logs: none of the values, and only counts and fixed codes beside the line's own fields.
    const mine = lines.slice(from);
    expect(mine.length).toBeGreaterThan(0);
    for (const line of mine) {
      for (const c of [...Object.values(C), ...Object.values(CODES), d10, KEY, 'QZX', 'XQZ', 'ZQ42E-CASE']) expect(line).not.toContain(c);
    }
    const allowed = new Set(['time', 'level', 'scope', 'message', 'code', 'model', 'inputTokens', 'outputTokens', 'outcome', 'state', 'created',
      'read', 'recorded', 'queued', 'stale', 'none', 'noBooking', 'discarded', 'failed', 'remaining', 'purged']);
    const flightLines = mine.filter((l) => /"scope":"loyalty-(flights|segments)"/.test(l));
    expect(flightLines.length).toBeGreaterThan(0);
    for (const line of flightLines) {
      const fields = JSON.parse(line) as Record<string, unknown>;
      for (const [name, value] of Object.entries(fields)) {
        expect(allowed.has(name), `${name} in ${fields.message}`).toBe(true);
        expect(['771', '772', 'Q7']).not.toContain(value);
        if (!['time', 'message', 'scope', 'level'].includes(name)) expect(['number', 'boolean', 'string'].includes(typeof value) || value === null).toBe(true);
      }
    }
  });

  it('T42e1b-I9: the daily step resolves whatever fails and runs after the booking step and before the digest; its purge reaches reads, not segments', async () => {
    const { a, mA } = await wings();
    const daily = exported<() => Promise<void>>(flightRead, 'runLoyaltyFlightsDaily');
    const purge = exported<() => Promise<number>>(flightRead, 'purgeExpiredFlightReads');
    // The reader throws, then the database is gone for the step: it still resolves.
    process.env.ANTHROPIC_API_KEY = KEY;
    await mail(a, 'i9-throw');
    H.reader = { read: async () => { throw new Error(`zq42e ${KEY}`); } };
    await expect(daily()).resolves.toBeUndefined();
    const connect = vi.spyOn(db, 'connect').mockRejectedValue(new Error('zq42e database down') as never);
    const query = vi.spyOn(db, 'query').mockRejectedValue(new Error('zq42e database down') as never);
    try {
      await expect(daily()).resolves.toBeUndefined();
    } finally {
      connect.mockRestore();
      query.mockRestore();
    }
    delete process.env.ANTHROPIC_API_KEY;
    H.reader = null;

    // The order inside the daily job.
    H.order.length = 0;
    await runDailyJob();
    expect(H.order.filter((s) => ['read', 'bookings', 'flights', 'digest'].includes(s))).toEqual(['read', 'bookings', 'flights', 'digest']);

    // Retention: the boundary day is kept, one older is deleted, held rows included; segments stay.
    await db.query(`DELETE FROM loyalty_inbox_flight_reads WHERE program_id = $1`, [a]);
    await db.query(`DELETE FROM loyalty_inbox_messages WHERE program_id = $1`, [a]);
    const ins = (key: string, days: number, state: string) => db.query(
      state === 'pending'
        ? `INSERT INTO loyalty_inbox_flight_reads (dedupe_key, program_id, received_on, state, attempts, kind, program_check, read_on, reason, booking)
           VALUES ($1, $2, CURRENT_DATE - $3::int, 'pending', 1, 'flight_booked', 'not_stated', CURRENT_DATE, 'no_suffix',
                   jsonb_build_object('kind', 'flight_booked', 'code', 'ZQ42EOLD1', 'award', NULL, 'complete', false,
                     'legs', jsonb_build_array(jsonb_build_object('flightDate', '2020-01-01', 'origin', 'JFK', 'destination', 'LHR', 'carrier', 'ZQ', 'flightNumber', '1'))))`
        : `INSERT INTO loyalty_inbox_flight_reads (dedupe_key, program_id, received_on, state, attempts, kind, program_check, read_on, resolved_on)
           VALUES ($1, $2, CURRENT_DATE - $3::int, 'none', 1, 'none', 'not_stated', CURRENT_DATE, CURRENT_DATE)`,
      [key, a, days]
    );
    await ins(sha('zq42e-kept'), 400, 'none');
    await ins(sha('zq42e-kept-held'), 400, 'pending');
    await ins(sha('zq42e-gone'), 401, 'none');
    await ins(sha('zq42e-gone-held'), 401, 'pending');
    await db.query(`INSERT INTO loyalty_segments (membership_id, program_id, confirmation_code, flight_date, origin, destination, carrier, flight_number, state, source, evidence_key, evidence_received_on)
                    VALUES ($1, $2, 'ZQ42EOLD2', CURRENT_DATE - 405, 'JFK', 'LHR', 'ZQ', '2', 'booked', 'email', $3, CURRENT_DATE - 401)`, [mA, a, sha('zq42e-gone')]);
    const segmentsBefore = await count('SELECT count(*) AS n FROM loyalty_segments');
    expect(await purge()).toBe(2);
    expect((await db.query(`SELECT dedupe_key FROM loyalty_inbox_flight_reads WHERE program_id = $1 ORDER BY dedupe_key`, [a])).rows.map((r) => r.dedupe_key))
      .toEqual([sha('zq42e-kept'), sha('zq42e-kept-held')].sort());
    expect(await count('SELECT count(*) AS n FROM loyalty_segments')).toBe(segmentsBefore);
    expect(await legsOf(a, 'ZQ42EOLD2')).toHaveLength(1);

    // The balance run's route answers as before and asks neither the booking nor the flight reader.
    await db.query(`DELETE FROM loyalty_inbox_flight_reads WHERE program_id = $1`, [a]);
    await mail(a, 'i9-balance');
    process.env.ANTHROPIC_API_KEY = KEY;
    vi.mocked(createBookingReader).mockClear();
    vi.mocked(createFlightReader).mockClear();
    const answer = await answerOf(readPOST(post('/api/v1/loyalty/inbox/read', owner, {})));
    expect(answer.status).toBe(200);
    expect(LoyaltyInboxReadResponseSchema.safeParse(answer.body).success).toBe(true);
    expect(Object.keys(answer.body.data ?? {}).sort()).toEqual(['applied', 'discarded', 'errorCode', 'failed', 'noBalance', 'outcome', 'queued', 'read', 'remaining', 'stale']);
    expect(vi.mocked(createBookingReader)).not.toHaveBeenCalled();
    expect(vi.mocked(createFlightReader)).not.toHaveBeenCalled();
    expect(await count('SELECT count(*) AS n FROM loyalty_inbox_flight_reads WHERE program_id = $1', [a])).toBe(0);

    // The real daily job with a key and the flight reader failing: it resolves, the digest ran, the
    // stored airline message is in retry after one attempt, and no line holds the key.
    await db.query(`DELETE FROM loyalty_inbox_messages WHERE program_id = $1`, [a]);
    const k = await mail(a, 'i9-daily');
    H.order.length = 0;
    const from = lines.length;
    await expect(runDailyJob()).resolves.toBeUndefined();
    expect(H.order).toContain('digest');
    expect(await readRow(k)).toMatchObject({ state: 'retry', attempts: 1, last_error_code: 'api_error' });
    for (const line of lines.slice(from)) expect(line).not.toContain(KEY);
    for (const t of bodies) expect(t).not.toContain(KEY);
  }, 30_000);
});
