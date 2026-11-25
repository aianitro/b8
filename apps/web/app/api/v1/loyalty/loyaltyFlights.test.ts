// P8-42e1b — the flights a person sees and touches, through the real handlers, loaders and Postgres
// (I10–I14): the one-tap actions on a held flight booking, the typed segments route, the flights
// loader, the `Flights` section rendered from the real loaders, and the neighbours left exactly as
// they were by a flight run that wrote segments and held a booking.
//
// TIER 2, collected by `vitest.integration.config.mts`. People sign in through the real passkey path
// (`../auth/secondUserTestKit.ts`); bearer tokens are minted with `createPersonalToken`; handlers are
// called directly with a `NextRequest`. Held bookings and segments are written here directly, in the
// shapes the flight read writes them, so each scenario controls its own days. Only I14 runs the flight
// pass, against a fake `createFlightReader`; the balance and booking readers are mocked to count, so
// nothing here reaches a model or opens a socket.
//
// EVERYTHING IS FABRICATED: `ZQ42E …` programs and people, codes of letters and digits, plain airport
// and carrier fixtures, and dates as offsets from Postgres's CURRENT_DATE.
//
// CLEANUP IS OF THIS SUITE'S OWN ROWS, the two new tables first, and the auth tables through
// `resetAuth`.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { createPersonalToken } from '@/lib/authSession';
import { loadBookings } from '@/lib/loyaltyBookingStore';
import { loadReadOverview } from '@/lib/loyaltyInboxRead';
import { loadOverview } from '@/lib/loyaltyStore';
import * as flightRead from '@/lib/loyaltyFlightRead';
import * as flightStore from '@/lib/loyaltyFlightStore';
import { createBookingReader, createMailReader, type MailReader } from '@/lib/loyaltyReader';
import TravelBoard from '@/components/TravelBoard';
import * as loyalty from '@b8/contracts/loyalty';
import { bearer, bootstrapOwner, cookie, enrolSecondUser, resetAuth, type EnrolledUser } from '../auth/secondUserTestKit';
import { GET as overviewGET } from './route';
import * as segmentsRoute from './segments/route';
import * as resolveRoute from './inbox/flights/[id]/route';

// The board is a client component; rendered to a string here it needs a router.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

const H = vi.hoisted(() => ({
  reader: null as null | { read(input: { subject: string | null; text: string }): Promise<unknown> },
  otherReads: 0,
}));
vi.mock('@/lib/loyaltyReader', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/loyaltyReader')>();
  return {
    ...real,
    createMailReader: vi.fn(() => ({ read: async () => { H.otherReads++; return { ok: false, code: 'api_error' }; } })),
    createBookingReader: vi.fn(() => ({ read: async () => { H.otherReads++; return { ok: false, code: 'api_error' }; } })),
    createFlightReader: vi.fn(() => H.reader ?? { read: async () => ({ ok: false, code: 'api_error' }) }),
  };
});

// ─── The modules under test, reached as namespaces ─────────────────────────────────────────────

function exported<T>(mod: Record<string, unknown>, name: string): T {
  expect(typeof mod[name], `${name} is exported`).toBe('function');
  return mod[name] as T;
}
type Flights = loyalty.LoyaltyFlights;
const loadFlights = (q?: unknown) => exported<(q?: unknown) => Promise<Flights>>(flightStore, 'loadFlights')(q);
const readStoredFlights = (env: Record<string, string>) =>
  exported<(e: Record<string, string>) => Promise<{ recorded: number; queued: number }>>(flightRead, 'readStoredFlights')(env);
const typedPOST = (req: NextRequest) => exported<(r: NextRequest) => Promise<Response>>(segmentsRoute, 'POST')(req);
const resolvePOST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  exported<(r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>>(resolveRoute, 'POST')(req, ctx);
/** A named contract schema, after asserting it exists. */
function schema(name: string): { safeParse(v: unknown): { success: boolean } } {
  const s = (loyalty as Record<string, unknown>)[name] as { safeParse?: unknown } | undefined;
  expect(typeof s?.safeParse, `${name} is exported`).toBe('function');
  return s as { safeParse(v: unknown): { success: boolean } };
}

// ─── The world ─────────────────────────────────────────────────────────────────────────────────

const KEY = 'zq42e-key-canary-not-a-real-key';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const pgDay = async (n = 0) => (await db.query<{ d: string }>('SELECT (CURRENT_DATE + $1::int)::text AS d', [n])).rows[0].d;
const count = async (sql: string, values: unknown[] = []) => Number((await db.query<{ n: string }>(sql, values)).rows[0].n);
const OURS = `SELECT id FROM loyalty_programs WHERE name LIKE 'ZQ42E%'`;
const sumOf = async (tables: string[]) => (await db.query<{ s: string }>(`SELECT md5(${tables
  .map((t) => `coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM ${t} x), '')`).join(' || ')}) AS s`)).rows[0].s;

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

type Leg = { flightDate: string; origin: string; destination: string; carrier: string; flightNumber: string };
const leg = (flightDate: string, flightNumber = '412', origin = 'JFK', destination = 'LHR'): Leg => ({ flightDate, origin, destination, carrier: 'ZQ', flightNumber });

/** One segment written directly; `day` is the flight date's offset from today. */
async function segment(membershipId: number, code: string, day: number, opts: { state?: string; number?: string; source?: string; evidenceDay?: number } = {}): Promise<number> {
  const email = (opts.source ?? 'typed') === 'email';
  return (await db.query<{ id: number }>(
    `INSERT INTO loyalty_segments (membership_id, program_id, confirmation_code, flight_date, origin, destination, carrier, flight_number, state, source, evidence_key, evidence_received_on)
     SELECT id, program_id, $2, CURRENT_DATE + $3::int, 'JFK', 'LHR', 'ZQ', $4, $5, $6, $7, CASE WHEN $7::text IS NULL THEN NULL ELSE CURRENT_DATE + $8::int END
       FROM loyalty_memberships WHERE id = $1 RETURNING id`,
    [membershipId, code, day, opts.number ?? '412', opts.state ?? 'booked', opts.source ?? 'typed', email ? sha(`zq42e-ev-${code}-${day}`) : null, opts.evidenceDay ?? -10]
  )).rows[0].id;
}

let seq = 0;
/** One held flight booking, as the flight read leaves it: pending, with its reason, suffix and booking object. */
async function held(programId: number, opts: { code: string; suffix?: string | null; reason?: string; day?: number; kind?: string; legs?: Leg[] }): Promise<number> {
  seq++;
  const suffix = opts.suffix ?? null;
  const kind = opts.kind ?? 'flight_booked';
  const booking = { kind, code: opts.code, award: null, complete: false, legs: opts.legs ?? [leg(await pgDay(10))] };
  return (await db.query<{ id: number }>(
    `INSERT INTO loyalty_inbox_flight_reads (dedupe_key, program_id, received_on, state, attempts, kind, program_check, read_on, reason, suffix, booking)
     VALUES ($1, $2, CURRENT_DATE + $3::int, 'pending', 1, $4, 'not_stated', CURRENT_DATE, $5, $6, $7::jsonb) RETURNING id`,
    [sha(`zq42e-held-flight-${seq}-${opts.code}`), programId, opts.day ?? -1, kind, opts.reason ?? (suffix === null ? 'no_suffix' : 'unmatched_suffix'), suffix, JSON.stringify(booking)]
  )).rows[0].id;
}
/** A held HOTEL booking (42e1's table), for the negative controls. */
async function heldHotel(programId: number, code: string, suffix: string): Promise<number> {
  const booking = { kind: 'hotel_booked', property: 'ZQ42E Held Inn', checkIn: await pgDay(10), checkOut: await pgDay(12), code, award: null };
  return (await db.query<{ id: number }>(
    `INSERT INTO loyalty_inbox_booking_reads (dedupe_key, program_id, received_on, state, attempts, kind, program_check, read_on, reason, suffix, booking)
     VALUES ($1, $2, CURRENT_DATE - 1, 'pending', 1, 'hotel_booked', 'not_stated', CURRENT_DATE, 'unmatched_suffix', $3, $4::jsonb) RETURNING id`,
    [sha(`zq42e-held-hotel-${code}`), programId, suffix, JSON.stringify(booking)]
  )).rows[0].id;
}

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
/** A JSON body as a stream that records whether anything pulled it. */
function streamOf(value: unknown) {
  const flag = { pulled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      flag.pulled = true;
      controller.enqueue(new TextEncoder().encode(JSON.stringify(value)));
      controller.close();
    },
  }, { highWaterMark: 0 });
  return { stream, flag };
}
function request(path: string, who: Who, body: unknown, raw?: string) {
  const init = { method: 'POST', headers: { host: 'localhost:3000', 'content-type': 'application/json', ...auth(who) }, body: raw ?? JSON.stringify(body) };
  return new NextRequest(`${ORIGIN}${path}`, init);
}
function streamed(path: string, who: Who, stream: ReadableStream<Uint8Array>) {
  const init = { method: 'POST', headers: { host: 'localhost:3000', 'content-type': 'application/json', ...auth(who) }, body: stream, duplex: 'half' };
  return new NextRequest(`${ORIGIN}${path}`, init as ConstructorParameters<typeof NextRequest>[1]);
}
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const resolve = (who: Who, id: number | string, body: unknown, raw?: string) =>
  answerOf(resolvePOST(request(`/api/v1/loyalty/inbox/flights/${id}`, who, body, raw), ctx(id)));
const typed = (who: Who, body: unknown, raw?: string) => answerOf(typedPOST(request('/api/v1/loyalty/segments', who, body, raw)));
const overview = (who: EnrolledUser) => answerOf(overviewGET(new NextRequest(`${ORIGIN}/api/v1/loyalty`, { headers: { host: 'localhost:3000', ...cookie(who.token) } })));

let owner: EnrolledUser;
let two: EnrolledUser;
let readTok: { bearer: string };

beforeAll(async () => {
  for (const m of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {});
  await clearWorld();
  await resetAuth();
  owner = await bootstrapOwner();
  two = await enrolSecondUser(owner.token);
  readTok = { bearer: (await createPersonalToken({ label: 'zq42e read', scope: 'read', userId: owner.userId })).token };
}, 60_000);
beforeEach(async () => {
  H.reader = null;
  H.otherReads = 0;
  await clearWorld();
});
afterEach(async () => {
  H.reader = null;
  await clearWorld();
});
afterAll(async () => {
  await clearWorld();
  await resetAuth();
  vi.restoreAllMocks();
});

const ourSegments = (programId: number) => count('SELECT count(*) AS n FROM loyalty_segments WHERE program_id = $1', [programId]);

describe('flights on /travel (P8-42e1b)', () => {
  it('T42e1b-I10: the three taps resolve a held flight once, only into its own program, never touch a held hotel booking, and never before the caller', async () => {
    const a = await program('ZQ42E Taps Wings');
    const other = await program('ZQ42E Taps Other');
    const h = await program('ZQ42E Taps Harbour', 'hotel');
    const ana = await person('ZQ42E Taps Ana');
    const mA = await membership(ana, a, 'ZQ42E-0001-7K9X');
    const mOther = await membership(ana, other);
    await membership(ana, h, 'ZQ42E-0009-NM12');
    const tables = ['loyalty_inbox_flight_reads', 'loyalty_segments'];

    // Caller first: neither a missing credential nor a read-scope token pulls the body or writes.
    const place = await held(a, { code: 'ZQ42ETP01', suffix: '7K9X', reason: 'forwarder_conflict', legs: [leg(await pgDay(10)), leg(await pgDay(17), '413', 'LHR', 'JFK')] });
    const before = await sumOf(tables);
    for (const [who, status] of [[null, 401], [readTok, 403]] as const) {
      const s = streamOf({ action: 'place', membershipId: mA });
      const r = await answerOf(resolvePOST(streamed(`/api/v1/loyalty/inbox/flights/${place}`, who, s.stream), ctx(place)));
      expect(r.status).toBe(status);
      expect(s.flag.pulled).toBe(false);
    }
    expect(await sumOf(tables)).toBe(before);
    expect((await resolve(owner, 'abc', { action: 'ignore' })).status).toBe(400);
    expect((await resolve(owner, place, { action: 'place' })).status).toBe(400);
    const unknown = await resolve(owner, 2147483000, { action: 'ignore' });
    expect([unknown.status, unknown.body.error?.code]).toEqual([404, 'NOT_FOUND']);

    // Another program's membership is refused and changes nothing.
    const wrong = await resolve(owner, place, { action: 'place', membershipId: mOther });
    expect([wrong.status, wrong.body.error?.code]).toEqual([400, 'INVALID_INPUT']);
    expect(await sumOf(tables)).toBe(before);

    // Place: the segments from the held booking, by hand; the object cleared, the membership set.
    const placed = await resolve(two, place, { action: 'place', membershipId: mA });
    expect(placed.status).toBe(200);
    expect(schema('LoyaltyBookingResolveResponseSchema').safeParse(placed.body).success).toBe(true);
    expect(placed.body.data).toEqual({ id: place, state: 'placed_by_hand' });
    const row = (await db.query('SELECT state, booking, membership_id, dedupe_key, received_on::text AS r FROM loyalty_inbox_flight_reads WHERE id = $1', [place])).rows[0];
    expect(row).toMatchObject({ state: 'placed_by_hand', booking: null, membership_id: mA });
    const legs = (await db.query(`SELECT membership_id, source, evidence_key, evidence_received_on::text AS e, state FROM loyalty_segments WHERE confirmation_code = 'ZQ42ETP01' ORDER BY flight_date`)).rows;
    expect(legs).toEqual([1, 2].map(() => ({ membership_id: mA, source: 'email', evidence_key: row.dedupe_key, e: row.r, state: 'booked' })));
    const again = await resolve(owner, place, { action: 'ignore' });
    expect([again.status, again.body.error?.code]).toEqual([409, 'ITEM_RESOLVED']);

    // Place is by hand, so it re-books a cancelled leg of the same identity.
    await segment(mA, 'ZQ42ETP08', 10, { state: 'cancelled', source: 'email', evidenceDay: -5 });
    const revive = await held(a, { code: 'ZQ42ETP08', day: -1 });
    expect((await resolve(owner, revive, { action: 'place', membershipId: mA })).status).toBe(200);
    expect((await db.query(`SELECT state FROM loyalty_segments WHERE confirmation_code = 'ZQ42ETP08'`)).rows).toEqual([{ state: 'booked' }]);

    // Ignore: that item alone.
    const ig = await held(a, { code: 'ZQ42ETP02' });
    const segs = await ourSegments(a);
    expect((await resolve(owner, ig, { action: 'ignore' })).body.data).toEqual({ id: ig, state: 'ignored' });
    expect(await ourSegments(a)).toBe(segs);
    expect(await count('SELECT count(*) AS n FROM loyalty_inbox_not_mine WHERE program_id = $1', [a])).toBe(0);
    expect((await db.query('SELECT booking FROM loyalty_inbox_flight_reads WHERE id = $1', [ig])).rows[0].booking).toBeNull();

    // Not mine: the pair once, every held flight of the pair follows; another suffix and a held hotel
    // booking of the same suffix do not.
    const hotelHeld = await heldHotel(h, 'ZQ42EHTL01', 'NM12');
    const hotelBefore = await sumOf(['loyalty_inbox_booking_reads']);
    const x = await held(a, { code: 'ZQ42ETP03', suffix: 'NM12' });
    const y = await held(a, { code: 'ZQ42ETP04', suffix: 'NM12', reason: 'ambiguous_suffix' });
    const z = await held(a, { code: 'ZQ42ETP05', suffix: 'QQ34' });
    expect((await resolve(owner, x, { action: 'not_mine' })).body.data).toEqual({ id: x, state: 'not_mine' });
    const states = async () => (await db.query('SELECT id, state FROM loyalty_inbox_flight_reads WHERE id = ANY($1) ORDER BY id', [[x, y, z]])).rows.map((r) => r.state);
    expect(await states()).toEqual(['not_mine', 'not_mine', 'pending']);
    const w = await held(a, { code: 'ZQ42ETP06', suffix: 'NM12' });
    expect((await resolve(owner, w, { action: 'not_mine' })).status).toBe(200);
    expect(await count(`SELECT count(*) AS n FROM loyalty_inbox_not_mine WHERE program_id = $1 AND suffix = 'NM12'`, [a])).toBe(1);
    expect((await resolve(owner, y, { action: 'not_mine' })).body.error?.code).toBe('ITEM_RESOLVED');
    expect(await sumOf(['loyalty_inbox_booking_reads'])).toBe(hotelBefore);
    expect((await db.query('SELECT state FROM loyalty_inbox_booking_reads WHERE id = $1', [hotelHeld])).rows[0].state).toBe('pending');
    expect(await ourSegments(a)).toBe(segs);

    // Two simultaneous places: one 200, one 409, one set of segments.
    const race = await held(a, { code: 'ZQ42ETP07' });
    const answers = await Promise.all([resolve(owner, race, { action: 'place', membershipId: mA }), resolve(two, race, { action: 'place', membershipId: mA })]);
    expect(answers.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await count(`SELECT count(*) AS n FROM loyalty_segments WHERE confirmation_code = 'ZQ42ETP07'`)).toBe(1);
  });

  it('T42e1b-I11: the typed route resolves the caller first, refuses what the strict body and the rules refuse, and upserts by identity without deleting', async () => {
    const a = await program('ZQ42E Typed Wings');
    const h = await program('ZQ42E Typed Harbour', 'hotel');
    const ana = await person('ZQ42E Typed Ana');
    const ben = await person('ZQ42E Typed Ben');
    const mA = await membership(ana, a);
    const mB = await membership(ben, a);
    const mH = await membership(ana, h);
    const d10 = await pgDay(10);
    const valid = { membershipId: mA, confirmationCode: 'zq42e-ty 01', flightDate: d10, origin: ' jfk ', destination: 'lhr', carrier: 'zq', flightNumber: '412', state: 'booked', award: null };
    const tables = ['loyalty_segments', 'loyalty_inbox_flight_reads'];
    const before = await sumOf(tables);

    for (const [who, status] of [[null, 401], [readTok, 403]] as const) {
      const s = streamOf(valid);
      const r = await answerOf(typedPOST(streamed('/api/v1/loyalty/segments', who, s.stream)));
      expect(r.status).toBe(status);
      expect(s.flag.pulled).toBe(false);
    }
    expect((await typed(owner, null, 'not json')).status).toBe(400);
    const refusals: [string, unknown, number][] = [
      ['source', { ...valid, source: 'email' }, 400],
      ['id', { ...valid, id: 1 }, 400],
      ['nights', { ...valid, nights: 2 }, 400],
      ['an extra key', { ...valid, seat: 'ZQ42E Seat' }, 400],
      ['a short code', { ...valid, confirmationCode: 'Z-Q4' }, 400],
      ['equal airports', { ...valid, destination: 'JFK' }, 400],
      ['five digits', { ...valid, flightNumber: '4'.repeat(5) }, 400],
      ['a bad date', { ...valid, flightDate: '2026-02-30' }, 400],
      ['a bad state', { ...valid, state: 'maybe' }, 400],
      ['a hotel membership', { ...valid, membershipId: mH }, 400],
      ['an unknown membership', { ...valid, membershipId: 2147483000 }, 404],
    ];
    for (const [what, body, status] of refusals) {
      const r = await typed(owner, body);
      expect(r.status, what).toBe(status);
      expect(r.text, what).not.toMatch(/zq42e-ty|ZQ42ETY01|ZQ42E Seat/i);
    }
    expect(await sumOf(tables)).toBe(before);

    const created = await typed(owner, valid);
    expect(created.status).toBe(201);
    expect(schema('LoyaltySegmentResponseSchema').safeParse(created.body).success).toBe(true);
    expect(created.body.data).toMatchObject({ membershipId: mA, maskedCode: '••••TY01', source: 'typed', origin: 'JFK', destination: 'LHR', carrier: 'ZQ', state: 'booked' });
    expect(created.text).not.toContain('ZQ42ETY01');
    expect((await db.query(`SELECT origin, destination, carrier, confirmation_code FROM loyalty_segments WHERE program_id = $1`, [a])).rows)
      .toEqual([{ origin: 'JFK', destination: 'LHR', carrier: 'ZQ', confirmation_code: 'ZQ42ETY01' }]);
    const again = await typed(two, { ...valid, confirmationCode: 'ZQ42ETY01', destination: 'CDG' });
    expect(again.status).toBe(200);
    expect(again.body.data?.id).toBe(created.body.data?.id);
    expect(again.body.data?.destination).toBe('CDG');
    expect(await ourSegments(a)).toBe(1);
    const cancelled = await typed(owner, { ...valid, state: 'cancelled' });
    expect([cancelled.status, cancelled.body.data?.state]).toEqual([200, 'cancelled']);
    expect((await db.query(`SELECT state FROM loyalty_segments WHERE program_id = $1`, [a])).rows).toEqual([{ state: 'cancelled' }]);
    const elsewhere = await typed(owner, { ...valid, membershipId: mB });
    expect([elsewhere.status, elsewhere.body.error?.message]).toEqual([400, 'That confirmation code is already recorded under another membership of this program.']);
    expect(elsewhere.text).not.toMatch(/TY01|ty 01/i);
    const second = await typed(two, { ...valid, membershipId: mB, confirmationCode: 'ZQ42ETY02' });
    expect(second.status).toBe(201);
    expect(schema('LoyaltySegmentResponseSchema').safeParse(second.body).success).toBe(true);
    expect(await ourSegments(a)).toBe(2);
  });

  it('T42e1b-I12: the loader is one ordered, schema-valid snapshot with masked codes and suffixes, a thirty-day window, and no ledger read', async () => {
    const a = await program('ZQ42E Loader Wings');
    const h = await program('ZQ42E Loader Harbour', 'hotel');
    const ana = await person('ZQ42E Loader Ana');
    const ben = await person('ZQ42E Loader Ben');
    const mA = await membership(ana, a, 'ZQ42E-0001-7K9X');
    const mB = await membership(ben, a, 'ZQ42E-0002-7K9X');
    await membership(ana, h);
    const u2 = await segment(mA, 'ZQ42ELD01', 20);
    const u1 = await segment(mB, 'ZQ42ELD02', 5);
    const u3 = await segment(mA, 'ZQ42ELD03', 5, { number: '7' });
    const today = await segment(mA, 'ZQ42ELD04', 0);
    const r1 = await segment(mA, 'ZQ42ELD05', -1);
    const r30 = await segment(mB, 'ZQ42ELD06', -30);
    const r31 = await segment(mA, 'ZQ42ELD07', -31);
    const gone = await segment(mA, 'ZQ42ELD08', 3, { state: 'cancelled' });
    const goneRecent = await segment(mA, 'ZQ42ELD09', -2, { state: 'cancelled' });
    const q1 = await held(a, { code: 'ZQ42ELDQ1', suffix: '7K9X', reason: 'ambiguous_suffix', day: -3 });
    const q2 = await held(a, { code: 'ZQ42ELDQ2', day: -1 });
    const q3 = await held(a, { code: 'ZQ42ELDQ3', suffix: '7K9X', day: -1, kind: 'flight_cancelled', legs: [] });

    const texts: string[] = [];
    const spy = { query: (text: string, values?: unknown[]) => { texts.push(text); return db.query(text, values); } };
    const viaSpy = await loadFlights(spy);
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t).not.toMatch(/\b(transactions|accounts|account_valuations)\b/);
    const f = await loadFlights();
    expect(f).toEqual(viaSpy);
    expect(await loadFlights()).toEqual(f);
    expect(schema('LoyaltyFlightsSchema').safeParse(f).success).toBe(true);
    expect(Object.keys(f).sort()).toEqual(['airlineMembershipIds', 'queue', 'recent', 'upcoming']);
    const ours = (list: { id: number }[]) => list.map((s) => s.id).filter((id) => [u1, u2, u3, today, r1, r30, r31, gone, goneRecent].includes(id));
    expect(ours(f.upcoming)).toEqual([today, ...(u1 < u3 ? [u1, u3] : [u3, u1]), u2]);
    expect(ours(f.recent)).toEqual([r1, r30]);
    expect(f.airlineMembershipIds.filter((id) => [mA, mB].includes(id))).toEqual([mA, mB].sort((p, q) => p - q));
    expect(await count(`SELECT count(*) AS n FROM loyalty_memberships ms WHERE EXISTS (SELECT 1 FROM loyalty_programs p WHERE p.id = ms.program_id AND p.kind = 'airline')`))
      .toBe(f.airlineMembershipIds.length);
    // A segment of a hotel membership cannot exist: the composite key and the typed route's kind check.
    const queue = f.queue.filter((x) => x.programId === a);
    expect(queue.map((x) => x.id)).toEqual([Math.max(q2, q3), Math.min(q2, q3), q1]);
    expect(queue.find((x) => x.id === q1)).toMatchObject({ maskedSuffix: '••••7K9X', maskedCode: '••••LDQ1', candidateMembershipIds: [mA, mB].sort((p, q) => p - q), state: 'booked' });
    expect(queue.find((x) => x.id === q1)?.legs).toEqual([leg(await pgDay(10))]);
    expect(queue.find((x) => x.id === q2)).toMatchObject({ maskedSuffix: null, candidateMembershipIds: [], reason: 'no_suffix' });
    expect(queue.find((x) => x.id === q3)).toMatchObject({ state: 'cancelled', legs: [] });
    const text = JSON.stringify(f);
    for (const code of ['ZQ42ELD0', 'ZQ42ELDQ', 'ZQ42E-0001', 'ZQ42E-0002']) expect(text).not.toContain(code);
    expect(text).not.toMatch(/"(count|total|miles|mileage|credits|nights)"/);

    // The overview is unchanged: it still parses, and its reading panel keeps exactly its keys.
    for (const who of [owner, two]) {
      const r = await overview(who);
      expect(r.status).toBe(200);
      expect(loyalty.LoyaltyOverviewResponseSchema.safeParse(r.body).success).toBe(true);
      expect(Object.keys((r.body.data as unknown as loyalty.LoyaltyOverview).inboxRead).sort()).toEqual(
        ['coverage', 'failed', 'fromMail', 'lastRead', 'needsAttention', 'needsAttentionTotal', 'readable', 'screenshotDue', 'waiting']
      );
      expect(Object.keys(r.body.data ?? {}).sort()).toEqual(['cardAccounts', 'cards', 'inbox', 'inboxRead', 'instruments', 'members', 'programs']);
    }
  });

  it('T42e1b-I13: the page shows both flight lists and the held flight with masked codes, no cancelled flight, the stays section undisturbed, and words for nothing', async () => {
    const NUMBER = 'ZQ42ENUMBERCANARY7K9X';
    const CODES = { up: 'ZQ42EUPCANARY1', past: 'ZQ42EPASTCANARY2', gone: 'ZQ42EGONECANARY3', held: 'ZQ42EHELDCANARY4' };
    const a = await program('ZQ42E Page Wings');
    const h = await program('ZQ42E Page Harbour', 'hotel');
    const ana = await person('ZQ42E Page Ana');
    const mA = await membership(ana, a, NUMBER);
    const mH = await membership(ana, h);
    await segment(mA, CODES.up, 12, { number: '31' });
    await segment(mA, CODES.past, -4, { number: '32' });
    await segment(mA, CODES.gone, 6, { state: 'cancelled', number: '33' });
    await held(a, { code: CODES.held, suffix: '7K9X', reason: 'forwarder_conflict' });
    await db.query(`INSERT INTO loyalty_stays (membership_id, program_id, confirmation_code, check_in, check_out, state, source)
                    VALUES ($1, $2, 'ZQ42ESTAY01', CURRENT_DATE - 3, CURRENT_DATE - 1, 'booked', 'typed')`, [mH, h]);
    const render = async (withFlights: boolean) => renderToStaticMarkup(createElement(TravelBoard, {
      overview: await loadOverview(), bookings: await loadBookings(), flights: withFlights ? await loadFlights() : undefined,
    })).replace(/<!-- -->/g, '');
    const occurrences = (html: string, s: string) => html.split(s).length - 1;
    const sectionOf = (html: string, heading: string) => {
      const start = html.indexOf(heading);
      return start < 0 ? '' : html.slice(start, html.indexOf('</section>', start));
    };

    const html = await render(true);
    expect(occurrences(html, '>Flights<')).toBe(1);
    expect(occurrences(html, 'Upcoming flights')).toBe(1);
    expect(occurrences(html, 'Recent flights')).toBe(1);
    expect(html).toContain('ZQ31');
    expect(html).toContain('ZQ32');
    expect(html).not.toContain('ZQ33');
    expect(html).toContain('Flights that need a membership');
    for (const label of ['Add to this membership', 'Not mine', 'Ignore']) expect(sectionOf(html, '>Flights<')).toContain(label);
    for (const masked of ['••••ARY1', '••••ARY2', '••••ARY4']) expect(html).toContain(masked);
    expect(html).not.toContain('••••ARY3');
    const flights = sectionOf(html, '>Flights<');
    expect(flights).not.toMatch(/(flights|miles|credits)\s*:?\s*\d/i);
    expect(flights.replace(/<[^>]+>/g, ' ')).not.toMatch(/\b0\b/);
    // The stays section is byte-identical with and without flights.
    const without = await render(false);
    expect(sectionOf(html, 'Hotel stays')).not.toBe('');
    expect(sectionOf(html, 'Hotel stays')).toBe(sectionOf(without, 'Hotel stays'));
    expect(occurrences(without, '>Flights<')).toBe(0);
    const answers = [await overview(owner), await overview(two)];
    for (const text of [html, ...bodies, ...answers.map((r) => r.text)]) {
      for (const c of [...Object.values(CODES), NUMBER]) expect(text).not.toContain(c);
    }

    // An airline membership with no segment: the words, never a zero.
    await db.query(`DELETE FROM loyalty_inbox_flight_reads WHERE program_id = $1`, [a]);
    await db.query(`UPDATE loyalty_segments SET state = 'cancelled' WHERE program_id = $1`, [a]);
    const empty = await render(true);
    expect(empty).toContain('No flights to show');
    expect(empty).not.toMatch(/\b0 flights/);
    expect(empty).not.toContain('Upcoming flights');

    // No airline membership and no segment: no section at all.
    await clearWorld();
    expect(await count(`SELECT count(*) AS n FROM loyalty_memberships ms WHERE EXISTS (SELECT 1 FROM loyalty_programs p WHERE p.id = ms.program_id AND p.kind = 'airline')`)).toBe(0);
    expect(await count(`SELECT count(*) AS n FROM loyalty_segments WHERE state = 'booked'`)).toBe(0);
    expect(occurrences(await render(true), '>Flights<')).toBe(0);
  });

  it('T42e1b-I14: a flight run that recorded segments and held a booking leaves the stays, the balance queue, the not-mine list and observations exactly as they were', async () => {
    const a = await program('ZQ42E Neighbour Wings');
    const h = await program('ZQ42E Neighbour Harbour', 'hotel');
    const ana = await person('ZQ42E Neighbour Ana');
    await membership(ana, a, 'ZQ42E-0001-7K9X');
    const mH = await membership(ana, h, 'ZQ42E-0002-4M2P');
    const d10 = await pgDay(10);
    // The hotel world: a stay, a held hotel booking, a message 42e1 left in `flight`, a pending balance
    // read, an observation and a not-mine pair.
    await db.query(`INSERT INTO loyalty_stays (membership_id, program_id, confirmation_code, check_in, check_out, state, source)
                    VALUES ($1, $2, 'ZQ42ENBST1', CURRENT_DATE + 3, CURRENT_DATE + 5, 'booked', 'typed')`, [mH, h]);
    await heldHotel(h, 'ZQ42ENBHT1', 'ZZ77');
    await db.query(`INSERT INTO loyalty_inbox_not_mine (program_id, suffix) VALUES ($1, 'NM55')`, [h]);
    await db.query(`INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source) VALUES ($1, CURRENT_DATE - 5, 12, 'points', 'email')`, [mH]);
    const msg = async (programId: number, mark: string, memberId: number | null = null) => {
      seq++;
      const key = sha(`zq42e-neighbour-${mark}-${seq}`);
      const raw = Buffer.from(['From: ZQ42E <trips@zq42e-wings.test>', 'To: inbox@example.com', `Subject: ZQ42E ${mark}`, 'Content-Type: text/plain; charset=utf-8', '', `ZQ42E-CASE ${mark}`, ''].join('\r\n'), 'utf8');
      await db.query(
        `INSERT INTO loyalty_inbox_messages (dedupe_key, received_on, program_id, sender_domain, origin, attribution, member_id, raw_mail, oversize)
         VALUES ($1, CURRENT_DATE - 2, $2, 'zq42e-wings.test', 'direct', $3, $4, $5, false)`,
        [key, programId, memberId === null ? 'none_found' : 'matched', memberId, raw]
      );
      return key;
    };
    const flightRow = await msg(h, 'n-hotel-flight');
    await db.query(`INSERT INTO loyalty_inbox_booking_reads (dedupe_key, program_id, received_on, state, attempts, kind, program_check, read_on, resolved_on)
                    VALUES ($1, $2, CURRENT_DATE - 2, 'flight', 1, 'flight', 'not_stated', CURRENT_DATE, CURRENT_DATE)`, [flightRow, h]);
    const balance = await msg(h, 'n-balance');
    await db.query(`INSERT INTO loyalty_inbox_reads (dedupe_key, program_id, received_on, state, attempts, reason, balance, unit, program_check, read_on)
                    VALUES ($1, $2, CURRENT_DATE - 2, 'pending', 1, 'no_suffix', 12, 'points', 'match', CURRENT_DATE)`, [balance, h]);
    await msg(a, 'n-placed', ana);
    await msg(a, 'n-held');

    const NEIGHBOURS = ['loyalty_inbox_booking_reads', 'loyalty_stays', 'loyalty_inbox_not_mine', 'loyalty_inbox_reads', 'loyalty_observations'];
    const bookingsBefore = await loadBookings();
    const panelBefore = await loadReadOverview();
    const sumBefore = await sumOf(NEIGHBOURS);
    const notMineBefore = (await db.query('SELECT program_id, suffix FROM loyalty_inbox_not_mine WHERE program_id IN (' + OURS + ') ORDER BY id')).rows;

    const reader: MailReader = {
      read: async (input) => {
        const mark = /ZQ42E-CASE (\S+)/.exec(input.text)?.[1];
        if (mark === 'n-placed') return { ok: true, reading: { kind: 'flight_booked', programName: null, memberNumberSuffix: null, confirmationCode: 'ZQ42ENBFL1', award: null, completeItinerary: true, segments: [leg(d10)] } };
        if (mark === 'n-held') return { ok: true, reading: { kind: 'flight_booked', programName: null, memberNumberSuffix: 'ZZ66', confirmationCode: 'ZQ42ENBFL2', award: null, completeItinerary: false, segments: [leg(d10, '9')] } };
        return { ok: false, code: 'api_error' };
      },
    };
    H.reader = reader;
    const r = await readStoredFlights({ ANTHROPIC_API_KEY: KEY });
    // Non-vacuity: the run wrote a segment and held a booking before anything is compared.
    expect(r).toMatchObject({ recorded: 1, queued: 1 });
    expect(await ourSegments(a)).toBe(1);
    expect(await count(`SELECT count(*) AS n FROM loyalty_inbox_flight_reads WHERE program_id = $1 AND state = 'pending'`, [a])).toBe(1);
    expect(H.otherReads).toBe(0);
    expect(vi.mocked(createBookingReader)).not.toHaveBeenCalled();
    expect(vi.mocked(createMailReader)).not.toHaveBeenCalled();

    expect(await loadBookings()).toEqual(bookingsBefore);
    expect(await sumOf(NEIGHBOURS)).toBe(sumBefore);
    expect((await db.query('SELECT state FROM loyalty_inbox_booking_reads WHERE dedupe_key = $1', [flightRow])).rows).toEqual([{ state: 'flight' }]);
    expect(await count('SELECT count(*) AS n FROM loyalty_inbox_flight_reads WHERE dedupe_key = $1', [flightRow])).toBe(0);
    expect((await db.query('SELECT program_id, suffix FROM loyalty_inbox_not_mine WHERE program_id IN (' + OURS + ') ORDER BY id')).rows).toEqual(notMineBefore);
    const panelAfter = await loadReadOverview();
    expect(loyalty.LoyaltyInboxReadPanelSchema.safeParse(panelAfter).success).toBe(true);
    expect(panelAfter).toEqual(panelBefore);
  });
});
