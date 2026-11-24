// P8-42e1 — the booking read through the real pass, handlers and Postgres (I1–I7, I9–I11): which
// messages are read, a confirmation becoming a stay, dedupe by program and code, cancellations that
// never delete, arrival order against event order, typed and mail superseding each other, attribution,
// failures and the lock, privacy and logs, and the daily step with its retention.
//
// TIER 2, collected by `vitest.integration.config.mts` with the scratch-database guard in its setup
// files. People sign in through the real passkey path (`../auth/secondUserTestKit.ts`); handlers are
// called directly with a `NextRequest`.
//
// THE READER IS A FAKE. `createBookingReader` in `@/lib/loyaltyReader` is mocked: each test installs a
// fake that answers by a marker line this suite writes into each fabricated message (the reader is
// given nothing but subject and text, so the marker is how the fake knows which message it reads).
// With no fake installed the mock answers `api_error` and counts the call. `createMailReader` is
// mocked too, only to count: the booking pass must never call it. No test reaches a real model.
//
// EVERYTHING IS FABRICATED: programs, people and properties named `ZQ42E …`, sender domains on `.test`,
// codes of letters and digits made up here, dates from Postgres's CURRENT_DATE with day offsets.
//
// CLEANUP IS OF THIS SUITE'S OWN ROWS: booking reads, stays, balance reads, not-mine rows, messages,
// observations and memberships of `ZQ42E …` programs, then the programs and people, and the auth
// tables through `resetAuth`. Every trigger, spy and environment change is undone in a `finally` or
// an `afterEach`.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { runDailyJob } from '@/lib/scheduler';
import { purgeExpiredBookingReads, readStoredBookings, runLoyaltyBookingsDaily, type BookingRun } from '@/lib/loyaltyBookingRead';
import { loadBookings } from '@/lib/loyaltyBookingStore';
import { createBookingReader, createMailReader, type MailReader, type MailReaderInput, type MailReaderResult } from '@/lib/loyaltyReader';
import { LOYALTY_READ_MAX_PER_RUN, LoyaltyInboxReadResponseSchema, LoyaltyStayResponseSchema } from '@b8/contracts/loyalty';
import { bootstrapOwner, cookie, bearer, enrolSecondUser, resetAuth, type EnrolledUser } from '../auth/secondUserTestKit';
import { POST as staysPOST } from './stays/route';
import { POST as readPOST } from './inbox/read/route';

// ─── Mocks ─────────────────────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  /** The fake the next `createBookingReader` call returns. */
  reader: null as null | { read(input: { subject: string | null; text: string }): Promise<unknown> },
  /** Booking reads made with no fake installed. */
  unexpected: 0,
  /** Reads the balance reader was asked for. */
  mailReads: 0,
  order: [] as string[],
}));

vi.mock('@/lib/loyaltyReader', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/loyaltyReader')>();
  return {
    ...real,
    createMailReader: vi.fn(() => ({ read: async () => { H.mailReads++; return { ok: false, code: 'api_error' }; } })),
    createBookingReader: vi.fn(() => H.reader ?? { read: async () => { H.unexpected++; return { ok: false, code: 'api_error' }; } }),
  };
});
// The daily job's other steps, so `runDailyJob` runs nothing that needs Plaid, mail or push. The
// balance read step only records its turn; the booking step records its turn and runs for real.
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

const program = async (name: string, kind = 'hotel') =>
  (await db.query<{ id: number }>(`INSERT INTO loyalty_programs (name, kind, default_unit) VALUES ($1, $2, 'points') RETURNING id`, [name, kind])).rows[0].id;
const person = async (name: string) =>
  (await db.query<{ id: number }>('INSERT INTO household_members (display_name) VALUES ($1) RETURNING id', [name])).rows[0].id;
const membership = async (memberId: number, programId: number, number: string | null = null) =>
  (await db.query<{ id: number }>('INSERT INTO loyalty_memberships (member_id, program_id, member_number) VALUES ($1, $2, $3) RETURNING id', [memberId, programId, number])).rows[0].id;

/** One hotel program with two people holding numbered memberships. */
async function harbour() {
  const h = await program('ZQ42E Read Harbour');
  const ana = await person('ZQ42E Read Ana');
  const ben = await person('ZQ42E Read Ben');
  return { h, ana, ben, mA: await membership(ana, h, 'ZQ42E-0001-7K9X'), mB: await membership(ben, h, 'ZQ42E-0002-4M2P') };
}

let seq = 0;
/**
 * Stores one fabricated message for `programId`, received `day` days from today, forwarded by
 * `memberId` (attribution `matched`) or by nobody known. Its text carries the marker the fake reads.
 */
async function mail(programId: number, mark: string, opts: { day?: number; memberId?: number | null; oversize?: boolean } = {}): Promise<string> {
  seq++;
  const key = sha(`zq42e-booking-${mark}-${seq}`);
  const raw = opts.oversize ? null : Buffer.from([
    'From: ZQ42E Stays <stays@zq42e-harbour.test>',
    'To: inbox@example.com',
    `Subject: ZQ42E reservation ${mark}`,
    `Message-ID: <${mark}.${seq}@zq42e-harbour.test>`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    `Your reservation. ZQ42E-CASE ${mark}`,
    '',
  ].join('\r\n'), 'utf8');
  const memberId = opts.memberId ?? null;
  await db.query(
    `INSERT INTO loyalty_inbox_messages (dedupe_key, received_on, program_id, sender_domain, origin, attribution, member_id, raw_mail, oversize)
     VALUES ($1, CURRENT_DATE + $2::int, $3, 'zq42e-harbour.test', 'direct', $4, $5, $6, $7)`,
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

/** A hotel answer; each case overrides what it is about. */
const hotel = (over: Record<string, unknown>) => ({
  kind: 'hotel_booked', programName: null, memberNumberSuffix: null, property: 'ZQ42E Harbour Inn',
  confirmationCode: null, checkIn: null, checkOut: null, award: null, ...over,
});
const run = (): Promise<BookingRun> => readStoredBookings(ENV);
const readRow = async (key: string) => (await db.query(
  `SELECT state, kind, reason, suffix, booking, membership_id, stay_id, attempts, last_error_code, program_check FROM loyalty_inbox_booking_reads WHERE dedupe_key = $1`, [key]
)).rows[0];
const stayOf = async (programId: number, code: string) => (await db.query(
  `SELECT id, membership_id, state, source, property, award, check_in::text AS check_in, check_out::text AS check_out, nights,
          evidence_key, evidence_received_on::text AS evidence_received_on, updated_at::text AS updated_at
     FROM loyalty_stays WHERE program_id = $1 AND confirmation_code = $2`, [programId, code]
)).rows[0];
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
const typed = (who: Who, body: unknown) => answerOf(staysPOST(post('/api/v1/loyalty/stays', who, body)));

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
  H.order.length = 0;
  vi.mocked(createMailReader).mockClear();
  vi.mocked(createBookingReader).mockClear();
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

describe('the booking read (P8-42e1)', () => {
  it('T42e1-I1: every stored hotel message is booking-read whatever its balance read did, oldest first and bounded; balances are not touched', async () => {
    const { h, mA } = await harbour();
    const air = await program('ZQ42E Read Air', 'airline');
    const keys = {
      never: await mail(h, 'i1-never', { day: -6 }),
      applied: await mail(h, 'i1-applied', { day: -5 }),
      nobal: await mail(h, 'i1-nobal', { day: -4 }),
      pending: await mail(h, 'i1-pending', { day: -3 }),
      oversize: await mail(h, 'i1-oversize', { day: -2, oversize: true }),
      done: await mail(h, 'i1-done', { day: -1 }),
      air: await mail(air, 'i1-air', { day: -7 }),
    };
    const obs = (await db.query<{ id: number }>(`INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source) VALUES ($1, CURRENT_DATE - 5, 12, 'points', 'email') RETURNING id`, [mA])).rows[0].id;
    await db.query(`INSERT INTO loyalty_inbox_reads (dedupe_key, program_id, received_on, state, attempts, suffix, balance, unit, as_of, program_check, membership_id, observation_id, read_on, resolved_on)
                    VALUES ($1, $2, CURRENT_DATE - 5, 'applied', 1, '7K9X', 12, 'points', CURRENT_DATE - 5, 'match', $3, $4, CURRENT_DATE, CURRENT_DATE)`, [keys.applied, h, mA, obs]);
    await db.query(`INSERT INTO loyalty_inbox_reads (dedupe_key, program_id, received_on, state, attempts, program_check, read_on, resolved_on)
                    VALUES ($1, $2, CURRENT_DATE - 4, 'no_balance', 1, 'not_stated', CURRENT_DATE, CURRENT_DATE)`, [keys.nobal, h]);
    await db.query(`INSERT INTO loyalty_inbox_reads (dedupe_key, program_id, received_on, state, attempts, reason, balance, unit, program_check, read_on)
                    VALUES ($1, $2, CURRENT_DATE - 3, 'pending', 1, 'no_suffix', 12, 'points', 'match', CURRENT_DATE)`, [keys.pending, h]);
    await db.query(`INSERT INTO loyalty_inbox_booking_reads (dedupe_key, program_id, received_on, state, attempts, kind, program_check, read_on, resolved_on)
                    VALUES ($1, $2, CURRENT_DATE - 1, 'none', 1, 'none', 'not_stated', CURRENT_DATE, CURRENT_DATE)`, [keys.done, h]);
    const before = await sumOf(['loyalty_inbox_reads', 'loyalty_observations']);
    const counts = [await count('SELECT count(*) AS n FROM loyalty_inbox_reads'), await count('SELECT count(*) AS n FROM loyalty_observations')];
    const none = { kind: 'none' };
    const order = install({ 'i1-never': none, 'i1-applied': none, 'i1-nobal': none, 'i1-pending': none, 'i1-oversize': none, 'i1-done': none, 'i1-air': none });

    const r = await run();
    expect(order).toEqual(['i1-never', 'i1-applied', 'i1-nobal', 'i1-pending']);
    expect(r).toMatchObject({ outcome: 'ok', read: 4, none: 4, failed: 0, remaining: 0, errorCode: null });
    expect(H.mailReads).toBe(0);
    expect(vi.mocked(createMailReader)).not.toHaveBeenCalled();
    expect(await sumOf(['loyalty_inbox_reads', 'loyalty_observations'])).toBe(before);
    expect([await count('SELECT count(*) AS n FROM loyalty_inbox_reads'), await count('SELECT count(*) AS n FROM loyalty_observations')]).toEqual(counts);
    expect(await count('SELECT count(*) AS n FROM loyalty_inbox_booking_reads WHERE dedupe_key = ANY($1)', [[keys.air, keys.oversize]])).toBe(0);
    expect((await readRow(keys.done)).attempts).toBe(1);

    // At most the per-run bound, the rest left for the next run.
    const many: Record<string, Answer> = {};
    for (let i = 0; i <= LOYALTY_READ_MAX_PER_RUN; i++) {
      await mail(h, `i1-many-${i}`, { day: -30 + (i % 5) });
      many[`i1-many-${i}`] = none;
    }
    const second = install(many);
    const r2 = await run();
    expect(second).toHaveLength(LOYALTY_READ_MAX_PER_RUN);
    expect(r2).toMatchObject({ read: LOYALTY_READ_MAX_PER_RUN, remaining: 1 });
    const third = install(many);
    expect(await run()).toMatchObject({ read: 1, remaining: 0 });
    expect(third).toHaveLength(1);
    expect(second).not.toContain(third[0]);
  });

  it('T42e1-I2: a confirmation becomes a stay on the forwarder\'s membership; a flight, a none and an unusable booking store nothing', async () => {
    const { h, ana, mA } = await harbour();
    const [d10, d12] = [await pgDay(10), await pgDay(12)];
    const keys = {
      booked: await mail(h, 'i2-booked', { day: -2, memberId: ana }),
      flight: await mail(h, 'i2-flight', { day: -2, memberId: ana }),
      none: await mail(h, 'i2-none', { day: -2, memberId: ana }),
      noCode: await mail(h, 'i2-nocode', { day: -2, memberId: ana }),
      badDates: await mail(h, 'i2-baddates', { day: -2, memberId: ana }),
    };
    install({
      'i2-booked': hotel({ confirmationCode: 'zq42e-ab12', checkIn: d10, checkOut: d12, award: true }),
      'i2-flight': hotel({ kind: 'flight', confirmationCode: 'ZQ42EFL99', checkIn: d10, checkOut: d12 }),
      'i2-none': { kind: 'none' },
      'i2-nocode': hotel({ confirmationCode: null, checkIn: d10, checkOut: d12 }),
      'i2-baddates': hotel({ confirmationCode: 'ZQ42EBD77', checkIn: d12, checkOut: d12 }),
    });
    const r = await run();
    expect(r).toMatchObject({ read: 5, recorded: 1, flights: 1, none: 1, noBooking: 2 });
    const stay = await stayOf(h, 'ZQ42EAB12');
    expect(stay).toMatchObject({ membership_id: mA, state: 'booked', source: 'email', award: true, check_in: d10, check_out: d12, evidence_key: keys.booked, evidence_received_on: await pgDay(-2) });
    expect((await db.query('SELECT nights = check_out - check_in AS ok, nights FROM loyalty_stays WHERE id = $1', [stay.id])).rows[0]).toEqual({ ok: true, nights: 2 });
    expect(await readRow(keys.booked)).toMatchObject({ state: 'recorded', kind: 'hotel_booked', booking: null, stay_id: stay.id, membership_id: mA });
    expect(await readRow(keys.flight)).toMatchObject({ state: 'flight', kind: 'flight', suffix: null, stay_id: null, booking: null });
    expect(await readRow(keys.none)).toMatchObject({ state: 'none', kind: 'none' });
    expect(await readRow(keys.noCode)).toMatchObject({ state: 'no_booking', kind: 'hotel_booked', stay_id: null });
    expect(await readRow(keys.badDates)).toMatchObject({ state: 'no_booking', stay_id: null });
    expect(await count(`SELECT count(*) AS n FROM loyalty_stays WHERE program_id = $1`, [h])).toBe(1);
  });

  it('T42e1-I3: one row per program and normalised code; a change updates it, a respelling matches it, another program keeps its own', async () => {
    const { h, ana } = await harbour();
    const h2 = await program('ZQ42E Read Second');
    await membership(ana, h2, null);
    const stays = () => count(`SELECT count(*) AS n FROM loyalty_stays WHERE program_id IN (${OURS})`);
    const [d10, d12, d20, d23] = [await pgDay(10), await pgDay(12), await pgDay(20), await pgDay(23)];

    await mail(h, 'i3-first', { day: -4, memberId: ana });
    install({ 'i3-first': hotel({ confirmationCode: 'ZQ42EAB12', checkIn: d10, checkOut: d12, property: 'ZQ42E Inn One' }) });
    await run();
    expect(await stays()).toBe(1);
    const first = await stayOf(h, 'ZQ42EAB12');

    await mail(h, 'i3-change', { day: -3, memberId: ana });
    install({ 'i3-change': hotel({ confirmationCode: 'ZQ42EAB12', checkIn: d20, checkOut: d23, property: 'ZQ42E Inn Two' }) });
    await run();
    expect(await stays()).toBe(1);
    const changed = await stayOf(h, 'ZQ42EAB12');
    expect(changed).toMatchObject({ id: first.id, check_in: d20, check_out: d23, property: 'ZQ42E Inn Two', nights: 3 });
    expect(changed.updated_at).not.toBe(first.updated_at);

    await mail(h, 'i3-respelt', { day: -2, memberId: ana });
    install({ 'i3-respelt': hotel({ confirmationCode: 'zq42e-ab12', checkIn: d20, checkOut: d23 }) });
    await run();
    expect(await stays()).toBe(1);

    await mail(h2, 'i3-other', { day: -2, memberId: ana });
    install({ 'i3-other': hotel({ confirmationCode: 'ZQ42EAB12', checkIn: d10, checkOut: d12 }) });
    await run();
    expect(await stays()).toBe(2);
    expect((await stayOf(h2, 'ZQ42EAB12')).id).not.toBe(first.id);

    await mail(h, 'i3-twin-a', { day: -1, memberId: ana });
    await mail(h, 'i3-twin-b', { day: -1, memberId: ana });
    install({
      'i3-twin-a': hotel({ confirmationCode: 'ZQ42ECD34', checkIn: d10, checkOut: d12 }),
      'i3-twin-b': hotel({ confirmationCode: 'zq42e cd 34', checkIn: d10, checkOut: d12 }),
    });
    expect(await run()).toMatchObject({ read: 2, recorded: 2 });
    expect(await stays()).toBe(3);
  });

  it('T42e1-I4: a cancellation keeps the row and its dates, counts nowhere and lists nowhere; nothing ever deletes a stay', async () => {
    const { h, ana, mA } = await harbour();
    await db.query(`CREATE FUNCTION zq42e_no_stay_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'zq42e: a stay was deleted'; END $$`);
    await db.query(`CREATE TRIGGER zq42e_no_stay_delete BEFORE DELETE ON loyalty_stays FOR EACH ROW EXECUTE FUNCTION zq42e_no_stay_delete()`);
    try {
      const [p10, p8] = [await pgDay(-10), await pgDay(-8)];
      await mail(h, 'i4-book', { day: -3, memberId: ana });
      install({ 'i4-book': hotel({ confirmationCode: 'ZQ42ECX01', checkIn: p10, checkOut: p8 }) });
      await run();
      expect((await loadBookings()).nights.find((n) => n.membershipId === mA)?.nightsThisYear ?? null).toBe(p8.slice(0, 4) === (await pgDay(0)).slice(0, 4) ? 2 : null);

      const cancel = await mail(h, 'i4-cancel', { day: -2, memberId: ana });
      const unknownDated = await mail(h, 'i4-unknown-dated', { day: -2, memberId: ana });
      const unknownBare = await mail(h, 'i4-unknown-bare', { day: -2, memberId: ana });
      install({
        'i4-cancel': hotel({ kind: 'hotel_cancelled', confirmationCode: 'ZQ42ECX01' }),
        'i4-unknown-dated': hotel({ kind: 'hotel_cancelled', confirmationCode: 'ZQ42ECX02', checkIn: await pgDay(5), checkOut: await pgDay(7) }),
        'i4-unknown-bare': hotel({ kind: 'hotel_cancelled', confirmationCode: 'ZQ42ECX03' }),
      });
      expect(await run()).toMatchObject({ read: 3, recorded: 2, noBooking: 1 });
      expect(await stayOf(h, 'ZQ42ECX01')).toMatchObject({ state: 'cancelled', check_in: p10, check_out: p8, source: 'email', evidence_key: cancel });
      expect(await stayOf(h, 'ZQ42ECX02')).toMatchObject({ state: 'cancelled', membership_id: mA });
      expect(await stayOf(h, 'ZQ42ECX03')).toBeUndefined();
      expect((await readRow(unknownDated)).state).toBe('recorded');
      expect((await readRow(unknownBare)).state).toBe('no_booking');
      const b = await loadBookings();
      expect(b.nights.find((n) => n.membershipId === mA)?.nightsThisYear).toBeNull();
      const listed = [...b.upcoming, ...b.completed].filter((s) => s.membershipId === mA);
      expect(listed).toEqual([]);
      expect(await count(`SELECT count(*) AS n FROM loyalty_stays WHERE program_id = $1`, [h])).toBe(2);
    } finally {
      await db.query('DROP TRIGGER IF EXISTS zq42e_no_stay_delete ON loyalty_stays');
      await db.query('DROP FUNCTION IF EXISTS zq42e_no_stay_delete()');
    }
  });

  it('T42e1-I5: the received date orders mail, and no mailed booking ever revives a cancelled stay, however late it arrives', async () => {
    const { h, ana, mA } = await harbour();
    const [d10, d12] = [await pgDay(10), await pgDay(12)];
    const step = async (mark: string, day: number, kind: 'hotel_booked' | 'hotel_cancelled', code: string, dates = [d10, d12]) => {
      const key = await mail(h, mark, { day, memberId: ana });
      install({ [mark]: hotel({ kind, confirmationCode: code, checkIn: dates[0], checkOut: dates[1] }) });
      await run();
      return (await readRow(key)).state as string;
    };
    const state = async (code: string) => (await stayOf(h, code)).state as string;

    // Cancelled, then an OLDER confirmation arrives.
    expect(await step('i5-a1', -2, 'hotel_cancelled', 'ZQ42EOA01')).toBe('recorded');
    expect(await step('i5-a2', -5, 'hotel_booked', 'ZQ42EOA01')).toBe('stale');
    expect(await state('ZQ42EOA01')).toBe('cancelled');
    // Booked, then a same-day cancellation (applies), then a same-day booking (does not).
    expect(await step('i5-b1', -3, 'hotel_booked', 'ZQ42EOB02')).toBe('recorded');
    expect(await step('i5-b2', -3, 'hotel_cancelled', 'ZQ42EOB02')).toBe('recorded');
    expect(await state('ZQ42EOB02')).toBe('cancelled');
    expect(await step('i5-b3', -3, 'hotel_booked', 'ZQ42EOB02')).toBe('stale');
    expect(await state('ZQ42EOB02')).toBe('cancelled');
    // Cancelled, then a strictly LATER booking: still cancelled (SPEC.md A5). The received date is the
    // day the forward reached the inbox, not the day the hotel wrote it.
    expect(await step('i5-c1', -4, 'hotel_cancelled', 'ZQ42EOC03')).toBe('recorded');
    expect(await step('i5-c2', -2, 'hotel_booked', 'ZQ42EOC03')).toBe('stale');
    expect(await state('ZQ42EOC03')).toBe('cancelled');
    // The reviewer's case (REVIEW-1 N1): a past stay is confirmed, cancelled, and then the ORIGINAL
    // confirmation is forwarded again, arriving after the cancellation. It stays cancelled, keeps the
    // cancellation as its evidence, and none of its nights are counted.
    const past = [await pgDay(-5), await pgDay(-2)];
    expect(await step('i5-e1', -6, 'hotel_booked', 'ZQ42EOE05', past)).toBe('recorded');
    const cancelKey = await mail(h, 'i5-e2', { day: -4, memberId: ana });
    install({ 'i5-e2': hotel({ kind: 'hotel_cancelled', confirmationCode: 'ZQ42EOE05' }) });
    await run();
    expect((await readRow(cancelKey)).state).toBe('recorded');
    expect(await step('i5-e3', -1, 'hotel_booked', 'ZQ42EOE05', past)).toBe('stale');
    expect(await stayOf(h, 'ZQ42EOE05')).toMatchObject({ state: 'cancelled', evidence_key: cancelKey, check_in: past[0], check_out: past[1] });
    expect((await loadBookings()).nights.find((n) => n.membershipId === mA)?.nightsThisYear).toBeNull();
    // Booked, then an OLDER cancellation: stays booked.
    expect(await step('i5-d1', -2, 'hotel_booked', 'ZQ42EOD04')).toBe('recorded');
    expect(await step('i5-d2', -4, 'hotel_cancelled', 'ZQ42EOD04')).toBe('stale');
    expect(await state('ZQ42EOD04')).toBe('booked');
  });

  it('T42e1-I6: typed and mail supersede each other by the mail\'s date; a correction survives older mail and no mail moves a stay', async () => {
    const { h, ana, ben, mA, mB } = await harbour();
    const [d10, d12, d14, d15, d16, d18] = await Promise.all([10, 12, 14, 15, 16, 18].map((n) => pgDay(n)));
    const body = (over: Record<string, unknown>) => ({ membershipId: mA, confirmationCode: 'ZQ42ETY01', checkIn: d10, checkOut: d12, property: 'ZQ42E Typed Inn', state: 'booked', award: null, ...over });

    // A typed stay yields to the first mail for its code.
    expect((await typed(owner, body({}))).status).toBe(201);
    const k1 = await mail(h, 'i6-first', { day: -3, memberId: ana });
    install({ 'i6-first': hotel({ confirmationCode: 'ZQ42ETY01', checkIn: d14, checkOut: d16, property: 'ZQ42E Mail Inn' }) });
    await run();
    expect(await stayOf(h, 'ZQ42ETY01')).toMatchObject({ source: 'email', property: 'ZQ42E Mail Inn', check_in: d14, evidence_key: k1, evidence_received_on: await pgDay(-3) });

    // A mail-made stay, then a typed correction: typed fields, the evidence kept.
    const k2 = await mail(h, 'i6-mail', { day: -3, memberId: ana });
    install({ 'i6-mail': hotel({ confirmationCode: 'ZQ42ETY02', checkIn: d10, checkOut: d12 }) });
    await run();
    const corrected = await typed(two, body({ confirmationCode: 'zq42e-ty02', checkIn: d15, checkOut: d18, property: 'ZQ42E Corrected Inn' }));
    expect(corrected.status).toBe(200);
    expect(LoyaltyStayResponseSchema.safeParse(corrected.body).success).toBe(true);
    const afterTyped = await stayOf(h, 'ZQ42ETY02');
    expect(afterTyped).toMatchObject({ source: 'typed', property: 'ZQ42E Corrected Inn', check_in: d15, evidence_key: k2, evidence_received_on: await pgDay(-3) });
    // An OLDER re-forwarded mail is stale and the correction stands.
    const k3 = await mail(h, 'i6-older', { day: -5, memberId: ana });
    install({ 'i6-older': hotel({ confirmationCode: 'ZQ42ETY02', checkIn: d10, checkOut: d12 }) });
    await run();
    expect((await readRow(k3)).state).toBe('stale');
    expect(await stayOf(h, 'ZQ42ETY02')).toMatchObject({ source: 'typed', property: 'ZQ42E Corrected Inn', check_in: d15, evidence_key: k2 });
    // The same code typed under another membership is refused, with nothing changed.
    const elsewhere = await typed(owner, body({ membershipId: mB, confirmationCode: 'ZQ42ETY02' }));
    expect(elsewhere.status).toBe(400);
    expect(elsewhere.body.error?.message).toBe('That confirmation code is already recorded under another membership of this program.');
    expect(elsewhere.text).not.toMatch(/ZQ42ETY02/i);
    // A strictly later mail, forwarded by the other person, supersedes but never moves the stay.
    const k4 = await mail(h, 'i6-later', { day: -1, memberId: ben });
    install({ 'i6-later': hotel({ confirmationCode: 'ZQ42ETY02', checkIn: d10, checkOut: d12, property: 'ZQ42E Later Inn' }) });
    await run();
    expect((await readRow(k4)).state).toBe('recorded');
    expect(await stayOf(h, 'ZQ42ETY02')).toMatchObject({ source: 'email', property: 'ZQ42E Later Inn', membership_id: mA, evidence_key: k4 });
    expect(await count(`SELECT count(*) AS n FROM loyalty_stays WHERE program_id = $1`, [h])).toBe(2);
  });

  it('T42e1-I7: attribution through the pass places only what nothing contradicts; every other booking is held with its reason or settled', async () => {
    const { h, ana, ben, mA, mB } = await harbour();
    const d1 = await person('ZQ42E Read Dee');
    const e1 = await person('ZQ42E Read Eve');
    const mD = await membership(d1, h, 'ZQ42E-0003-5Q5Q');
    const mE = await membership(e1, h, 'ZQ42E-0004-5Q5Q');
    await db.query(`INSERT INTO loyalty_inbox_not_mine (program_id, suffix) VALUES ($1, 'NM77')`, [h]);
    const [p6, p4] = [await pgDay(-6), await pgDay(-4)];
    const cases: [string, number | null, Record<string, unknown>, string, string | null, number | null][] = [
      ['i7-forwarder', ana, {}, 'recorded', null, mA],
      ['i7-suffix', null, { memberNumberSuffix: '••••7K9X' }, 'recorded', null, mA],
      ['i7-conflict', ben, { memberNumberSuffix: '••••7K9X' }, 'pending', 'forwarder_conflict', null],
      ['i7-unmatched', null, { memberNumberSuffix: 'ZZ99' }, 'pending', 'unmatched_suffix', null],
      ['i7-ambiguous', null, { memberNumberSuffix: '5Q5Q' }, 'pending', 'ambiguous_suffix', null],
      ['i7-ambiguous-fwd', ana, { memberNumberSuffix: '5Q5Q' }, 'pending', 'ambiguous_suffix', null],
      ['i7-nobody', null, {}, 'pending', 'no_suffix', null],
      ['i7-mismatch', ana, { programName: 'ZQ42E Other Brand' }, 'pending', 'program_mismatch', null],
      ['i7-notmine', null, { memberNumberSuffix: 'NM77' }, 'not_mine_known', null, null],
    ];
    const keys = new Map<string, string>();
    const answers: Record<string, Answer> = {};
    let n = 0;
    for (const [mark, by, over] of cases) {
      keys.set(mark, await mail(h, mark, { day: -2, memberId: by }));
      answers[mark] = hotel({ confirmationCode: `ZQ42EAT${String(++n).padStart(2, '0')}`, checkIn: p6, checkOut: p4, ...over });
    }
    install(answers);
    const r = await run();
    expect(r).toMatchObject({ read: cases.length, recorded: 2, queued: 6, discarded: 1 });
    for (const [mark, , , state, reason, placed] of cases) {
      const row = await readRow(keys.get(mark) as string);
      expect(row.state, mark).toBe(state);
      expect(row.reason, mark).toBe(reason);
      expect(row.membership_id, mark).toBe(placed);
      if (state === 'pending') {
        expect(Object.keys(row.booking).sort(), mark).toEqual(['award', 'checkIn', 'checkOut', 'code', 'kind', 'property']);
        expect(row.stay_id, mark).toBeNull();
      } else {
        expect(row.booking, mark).toBeNull();
      }
    }
    // Only the two placed bookings are stays, both on mA; the held ones change no count.
    expect((await db.query(`SELECT membership_id FROM loyalty_stays WHERE program_id = $1 ORDER BY id`, [h])).rows.map((x) => x.membership_id)).toEqual([mA, mA]);
    const b = await loadBookings();
    const thisYear = p4.slice(0, 4) === (await pgDay(0)).slice(0, 4);
    expect(b.nights.filter((x) => [mA, mB, mD, mE].includes(x.membershipId)).map((x) => x.nightsThisYear)).toEqual([thisYear ? 4 : null, null, null, null]);
    expect(b.queue.filter((q) => q.programId === h)).toHaveLength(6);
    expect(b.queue.map((q) => q.id)).not.toContain((await db.query('SELECT id FROM loyalty_inbox_booking_reads WHERE dedupe_key = $1', [keys.get('i7-notmine')])).rows[0].id);
  });

  it('T42e1-I9: no key reads nothing; the attempt is committed before the call; failures retry to a bound, stop the run, and one run at a time', async () => {
    const { h } = await harbour();
    const [d10, d12] = [await pgDay(10), await pgDay(12)];
    const reset = async () => {
      await db.query(`DELETE FROM loyalty_inbox_booking_reads WHERE program_id = $1`, [h]);
      await db.query(`DELETE FROM loyalty_inbox_messages WHERE program_id = $1`, [h]);
    };

    // No key: disabled, nothing written, no reader built or asked.
    await mail(h, 'i9-off');
    const calls = install({ 'i9-off': { kind: 'none' } });
    for (const env of [{}, { ANTHROPIC_API_KEY: '' }, { ANTHROPIC_API_KEY: '  ' }]) {
      expect(await readStoredBookings(env)).toEqual({
        outcome: 'disabled', read: 0, recorded: 0, queued: 0, stale: 0, none: 0, flights: 0, noBooking: 0, discarded: 0, failed: 0, remaining: 0, errorCode: null,
      });
    }
    expect(calls).toEqual([]);
    expect(vi.mocked(createBookingReader)).not.toHaveBeenCalled();
    expect(await count('SELECT count(*) AS n FROM loyalty_inbox_booking_reads WHERE program_id = $1', [h])).toBe(0);
    await reset();

    // The attempt row exists, committed, while the reader runs.
    const seen: unknown[] = [];
    const k = await mail(h, 'i9-seen');
    install({
      'i9-seen': async () => {
        seen.push((await db.query('SELECT state, attempts, last_error_code FROM loyalty_inbox_booking_reads WHERE dedupe_key = $1', [k])).rows[0]);
        return { ok: true, reading: { kind: 'none' } };
      },
    });
    await run();
    expect(seen).toEqual([{ state: 'retry', attempts: 1, last_error_code: 'api_error' }]);
    // A message is read once: a second run asks nothing.
    const again = install({ 'i9-seen': hotel({ confirmationCode: 'ZQ42ERO01', checkIn: d10, checkOut: d12 }) });
    expect(await run()).toMatchObject({ read: 0 });
    expect(again).toEqual([]);
    expect((await readRow(k)).state).toBe('none');
    await reset();

    // A throwing fake is api_error; refused is terminal at once; a timeout retries until the third attempt.
    const kThrow = await mail(h, 'i9-throw', { day: -3 });
    const kRefused = await mail(h, 'i9-refused', { day: -2 });
    H.reader = { read: async (input) => (markOf(input) === 'i9-throw' ? Promise.reject(new Error('zq42e reader blew up')) : { ok: false, code: 'refused' }) };
    await run();
    expect(await readRow(kThrow)).toMatchObject({ state: 'retry', attempts: 1, last_error_code: 'api_error' });
    expect(await readRow(kRefused)).toMatchObject({ state: 'failed', attempts: 1, last_error_code: 'refused' });
    await reset();
    const kTimeout = await mail(h, 'i9-timeout');
    install({ 'i9-timeout': () => ({ ok: false, code: 'timeout' }) });
    const states: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      await run();
      const row = await readRow(kTimeout);
      states.push([row.state, row.attempts]);
    }
    expect(states).toEqual([['retry', 1], ['retry', 2], ['failed', 3], ['failed', 3]]);
    await reset();

    // A rate limit stops the run at once; three transport failures in a row stop it too.
    const rl = [await mail(h, 'i9-rl-1', { day: -3 }), await mail(h, 'i9-rl-2', { day: -2 })];
    install({ 'i9-rl-1': () => ({ ok: false, code: 'rate_limited' }), 'i9-rl-2': { kind: 'none' } });
    expect(await run()).toMatchObject({ outcome: 'error', errorCode: 'rate_limited', failed: 1 });
    expect(await readRow(rl[1])).toBeUndefined();
    await reset();
    const tr = [await mail(h, 'i9-tr-1', { day: -5 }), await mail(h, 'i9-tr-2', { day: -4 }), await mail(h, 'i9-tr-3', { day: -3 }), await mail(h, 'i9-tr-4', { day: -2 })];
    install({ 'i9-tr-1': () => ({ ok: false, code: 'timeout' }), 'i9-tr-2': () => ({ ok: false, code: 'api_error' }), 'i9-tr-3': () => ({ ok: false, code: 'timeout' }), 'i9-tr-4': { kind: 'none' } });
    expect(await run()).toMatchObject({ outcome: 'error', errorCode: 'timeout', failed: 3 });
    expect(await readRow(tr[3])).toBeUndefined();
    await reset();

    // Two overlapping runs: one reads, the other is already_running and writes nothing.
    await mail(h, 'i9-gate');
    let open!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    const inside = new Promise<void>((r) => { entered = r; });
    install({ 'i9-gate': async () => { entered(); await gate; return { ok: true, reading: { kind: 'none' } }; } });
    const first = run();
    await inside;
    expect(await run()).toMatchObject({ outcome: 'already_running', read: 0 });
    open();
    expect(await first).toMatchObject({ outcome: 'ok', read: 1 });
    expect(H.unexpected).toBe(0);
  }, 60_000);

  it('T42e1-I10: no guest field, full number or code reaches a row, a payload or a log; logs carry counts and codes only', async () => {
    const { h, mA } = await harbour();
    const C = {
      guest: 'ZQ42E-GUEST-NAME-CANARY', address: 'ZQ42E-ADDRESS-CANARY', phone: 'ZQ42E-PHONE-CANARY', card: 'ZQ42E-CARD-CANARY',
      total: 'ZQ42E-TOTAL-CANARY', number: 'ZQ42E-NUMBER-CANARY-0001-7K9X', code: 'ZQ42ECODECANARY1', typedCode: 'ZQ42ETYPEDCANARY2', property: '<b>ZQ42E-PROPERTY-CANARY</b>',
    };
    const [d10, d12] = [await pgDay(10), await pgDay(12)];
    const k = await mail(h, 'i10-hostile');
    const held = await mail(h, 'i10-held');
    install({
      'i10-hostile': hotel({
        memberNumberSuffix: C.number, confirmationCode: C.code, checkIn: d10, checkOut: d12, property: C.property,
        guestName: C.guest, address: C.address, phone: C.phone, cardLast4: C.card, total: C.total,
      }),
      'i10-held': hotel({ memberNumberSuffix: 'ZZ88', confirmationCode: 'ZQ42EHELDCANARY3', checkIn: d10, checkOut: d12, guestName: C.guest }),
    });
    const from = lines.length;
    await run();
    expect(await stayOf(h, C.code)).toMatchObject({ membership_id: mA, property: null });
    expect((await readRow(k)).suffix).toBe('7K9X');
    const typedAnswer = await typed(owner, { membershipId: mA, confirmationCode: C.typedCode, checkIn: d10, checkOut: d12, property: null, state: 'booked', award: null });
    expect(typedAnswer.status).toBe(201);
    expect(typedAnswer.body.data?.maskedCode).toBe('••••ARY2');
    const rows = (await db.query(`SELECT row_to_json(x)::text AS t FROM loyalty_stays x WHERE program_id = $1
                                  UNION ALL SELECT row_to_json(y)::text FROM loyalty_inbox_booking_reads y WHERE program_id = $1`, [h])).rows.map((r) => r.t as string);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const t of rows) for (const c of [C.guest, C.address, C.phone, C.card, C.total, C.number, 'ZQ42E-PROPERTY-CANARY']) expect(t).not.toContain(c);
    const payload = JSON.stringify(await loadBookings());
    for (const c of Object.values(C)) expect(payload).not.toContain(c);
    expect(payload).toContain('••••ARY1');
    expect(payload).not.toContain('ZQ42EHELDCANARY3');
    for (const c of Object.values(C)) expect(typedAnswer.text).not.toContain(c);
    // Logs: none of the values, and only counts and fixed codes beside the line's own fields.
    const mine = lines.slice(from);
    expect(mine.length).toBeGreaterThan(0);
    for (const line of mine) {
      for (const c of [...Object.values(C), 'ZQ42EHELDCANARY3', d10, d12, KEY, 'ZQ42E Harbour Inn', 'ZQ42E-CASE']) expect(line).not.toContain(c);
    }
    const allowed = new Set(['time', 'level', 'scope', 'message', 'code', 'model', 'inputTokens', 'outputTokens', 'outcome', 'state', 'created',
      'read', 'recorded', 'queued', 'stale', 'none', 'flights', 'noBooking', 'discarded', 'failed', 'remaining', 'purged']);
    for (const line of mine.filter((l) => /"scope":"loyalty-(bookings|stays)"/.test(l))) {
      const fields = JSON.parse(line) as Record<string, unknown>;
      for (const [name, value] of Object.entries(fields)) {
        expect(allowed.has(name), `${name} in ${fields.message}`).toBe(true);
        if (!['time', 'message', 'scope', 'level'].includes(name)) expect(['number', 'boolean', 'string'].includes(typeof value) || value === null).toBe(true);
      }
    }
    expect(held).not.toBe(k);
  });

  it('T42e1-I11: the daily step resolves whatever fails, runs after the balance read and before the digest, and its purge reaches reads, not stays', async () => {
    const { h, mA } = await harbour();
    // The reader throws, then the database is gone for the step: it still resolves.
    process.env.ANTHROPIC_API_KEY = KEY;
    await mail(h, 'i11-throw');
    H.reader = { read: async () => { throw new Error(`zq42e ${KEY}`); } };
    await expect(runLoyaltyBookingsDaily()).resolves.toBeUndefined();
    const connect = vi.spyOn(db, 'connect').mockRejectedValue(new Error('zq42e database down') as never);
    const query = vi.spyOn(db, 'query').mockRejectedValue(new Error('zq42e database down') as never);
    try {
      await expect(runLoyaltyBookingsDaily()).resolves.toBeUndefined();
    } finally {
      connect.mockRestore();
      query.mockRestore();
    }
    delete process.env.ANTHROPIC_API_KEY;

    // The order inside the daily job.
    H.order.length = 0;
    await runDailyJob();
    expect(H.order.filter((s) => ['read', 'bookings', 'digest'].includes(s))).toEqual(['read', 'bookings', 'digest']);

    // Retention: the boundary day is kept, one older is deleted, held rows included; stays stay.
    await db.query(`DELETE FROM loyalty_inbox_booking_reads WHERE program_id = $1`, [h]);
    const ins = (key: string, days: number, state: string) => db.query(
      state === 'pending'
        ? `INSERT INTO loyalty_inbox_booking_reads (dedupe_key, program_id, received_on, state, attempts, kind, program_check, read_on, reason, booking)
           VALUES ($1, $2, CURRENT_DATE - $3::int, 'pending', 1, 'hotel_booked', 'not_stated', CURRENT_DATE, 'no_suffix',
                   jsonb_build_object('kind', 'hotel_booked', 'property', NULL, 'checkIn', '2020-01-01', 'checkOut', '2020-01-03', 'code', 'ZQ42EOLD1', 'award', NULL))`
        : `INSERT INTO loyalty_inbox_booking_reads (dedupe_key, program_id, received_on, state, attempts, kind, program_check, read_on, resolved_on)
           VALUES ($1, $2, CURRENT_DATE - $3::int, 'none', 1, 'none', 'not_stated', CURRENT_DATE, CURRENT_DATE)`,
      [key, h, days]
    );
    await ins(sha('zq42e-kept'), 400, 'none');
    await ins(sha('zq42e-kept-held'), 400, 'pending');
    await ins(sha('zq42e-gone'), 401, 'none');
    await ins(sha('zq42e-gone-held'), 401, 'pending');
    await db.query(`INSERT INTO loyalty_stays (membership_id, program_id, confirmation_code, check_in, check_out, state, source, evidence_key, evidence_received_on)
                    VALUES ($1, $2, 'ZQ42EOLD2', CURRENT_DATE - 405, CURRENT_DATE - 403, 'booked', 'email', $3, CURRENT_DATE - 401)`, [mA, h, sha('zq42e-gone')]);
    const staysBefore = await count('SELECT count(*) AS n FROM loyalty_stays');
    expect(await purgeExpiredBookingReads()).toBe(2);
    expect((await db.query(`SELECT dedupe_key FROM loyalty_inbox_booking_reads WHERE program_id = $1 ORDER BY dedupe_key`, [h])).rows.map((r) => r.dedupe_key))
      .toEqual([sha('zq42e-kept'), sha('zq42e-kept-held')].sort());
    expect(await count('SELECT count(*) AS n FROM loyalty_stays')).toBe(staysBefore);
    expect(await stayOf(h, 'ZQ42EOLD2')).toBeTruthy();

    // The balance run's route answers as before and asks the booking reader nothing.
    await db.query(`DELETE FROM loyalty_inbox_booking_reads WHERE program_id = $1`, [h]);
    process.env.ANTHROPIC_API_KEY = KEY;
    vi.mocked(createBookingReader).mockClear();
    const answer = await answerOf(readPOST(post('/api/v1/loyalty/inbox/read', owner, {})));
    expect(answer.status).toBe(200);
    expect(LoyaltyInboxReadResponseSchema.safeParse(answer.body).success).toBe(true);
    expect(Object.keys(answer.body.data ?? {}).sort()).toEqual(['applied', 'discarded', 'errorCode', 'failed', 'noBalance', 'outcome', 'queued', 'read', 'remaining', 'stale']);
    expect(vi.mocked(createBookingReader)).not.toHaveBeenCalled();
    expect(await count('SELECT count(*) AS n FROM loyalty_inbox_booking_reads WHERE program_id = $1', [h])).toBe(0);
    for (const t of bodies) expect(t).not.toContain(KEY);
  }, 30_000);
});
