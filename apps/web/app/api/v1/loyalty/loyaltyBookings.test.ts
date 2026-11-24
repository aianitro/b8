// P8-42e1 — the stays a person sees and touches, through the real handlers, loader and Postgres (I8,
// I12–I15): the one-tap actions on a held booking, this year's counted nights, the typed stays route,
// the bookings loader, and the `Hotel stays` section rendered from the real loader.
//
// TIER 2, collected by `vitest.integration.config.mts`. People sign in through the real passkey path
// (`../auth/secondUserTestKit.ts`); bearer tokens are minted with `createPersonalToken`; handlers are
// called directly with a `NextRequest`. No reader is involved: held bookings and stays are written
// here directly, in the shapes the booking read writes them, so each scenario controls its own days.
//
// EVERYTHING IS FABRICATED: `ZQ42E …` programs, people and properties, codes of letters and digits,
// and dates as offsets from Postgres's CURRENT_DATE (year-boundary cases from `date_trunc('year', …)`,
// so no expectation depends on the day the suite runs).
//
// CLEANUP IS OF THIS SUITE'S OWN ROWS, the two new tables included, and the auth tables through
// `resetAuth`.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { createPersonalToken } from '@/lib/authSession';
import { loadBookings } from '@/lib/loyaltyBookingStore';
import { loadOverview } from '@/lib/loyaltyStore';
import TravelBoard from '@/components/TravelBoard';
import {
  LoyaltyBookingResolveResponseSchema,
  LoyaltyBookingsSchema,
  LoyaltyOverviewResponseSchema,
  LoyaltyStayResponseSchema,
  type LoyaltyOverview,
} from '@b8/contracts/loyalty';
import { bearer, bootstrapOwner, cookie, enrolSecondUser, resetAuth, type EnrolledUser } from '../auth/secondUserTestKit';
import { GET as overviewGET } from './route';
import { POST as staysPOST } from './stays/route';
import { POST as resolvePOST } from './inbox/bookings/[id]/route';

// The board is a client component; rendered to a string here it needs a router.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

// ─── The world ─────────────────────────────────────────────────────────────────────────────────

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const pgDay = async (n = 0) => (await db.query<{ d: string }>('SELECT (CURRENT_DATE + $1::int)::text AS d', [n])).rows[0].d;
const pgYear = async () => (await db.query<{ y: number }>('SELECT EXTRACT(YEAR FROM CURRENT_DATE)::int AS y')).rows[0].y;
const count = async (sql: string, values: unknown[] = []) => Number((await db.query<{ n: string }>(sql, values)).rows[0].n);
const OURS = `SELECT id FROM loyalty_programs WHERE name LIKE 'ZQ42E%'`;
const sumOf = async (tables: string[]) => (await db.query<{ s: string }>(`SELECT md5(${tables
  .map((t) => `coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM ${t} x), '')`).join(' || ')}) AS s`)).rows[0].s;

async function clearWorld(): Promise<void> {
  await db.query(`DELETE FROM loyalty_inbox_booking_reads WHERE program_id IN (${OURS})`);
  await db.query(`DELETE FROM loyalty_stays WHERE program_id IN (${OURS})`);
  await db.query(`DELETE FROM loyalty_inbox_not_mine WHERE program_id IN (${OURS})`);
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

/**
 * One stay written directly. `checkIn` and `checkOut` are SQL date expressions, so a case can be
 * placed on the year boundary with `date_trunc`.
 */
async function stay(membershipId: number, code: string, checkIn: string, checkOut: string, state = 'booked', property: string | null = null): Promise<number> {
  return (await db.query<{ id: number }>(
    `INSERT INTO loyalty_stays (membership_id, program_id, confirmation_code, check_in, check_out, state, source, property)
     SELECT id, program_id, $2, (${checkIn})::date, (${checkOut})::date, $3, 'typed', $4 FROM loyalty_memberships WHERE id = $1 RETURNING id`,
    [membershipId, code, state, property]
  )).rows[0].id;
}

let seq = 0;
/** One held booking, as the booking read leaves it: pending, with its reason, suffix and booking object. */
async function held(programId: number, opts: { code: string; suffix?: string | null; reason?: string; day?: number; kind?: string; checkIn?: string; checkOut?: string }): Promise<number> {
  seq++;
  const suffix = opts.suffix ?? null;
  const booking = { kind: opts.kind ?? 'hotel_booked', property: 'ZQ42E Held Inn', checkIn: opts.checkIn ?? await pgDay(10), checkOut: opts.checkOut ?? await pgDay(12), code: opts.code, award: null };
  return (await db.query<{ id: number }>(
    `INSERT INTO loyalty_inbox_booking_reads (dedupe_key, program_id, received_on, state, attempts, kind, program_check, read_on, reason, suffix, booking)
     VALUES ($1, $2, CURRENT_DATE + $3::int, 'pending', 1, $4, 'not_stated', CURRENT_DATE, $5, $6, $7::jsonb) RETURNING id`,
    [sha(`zq42e-held-${seq}-${opts.code}`), programId, opts.day ?? -1, booking.kind, opts.reason ?? (suffix === null ? 'no_suffix' : 'unmatched_suffix'), suffix, JSON.stringify(booking)]
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
  answerOf(resolvePOST(request(`/api/v1/loyalty/inbox/bookings/${id}`, who, body, raw), ctx(id)));
const typed = (who: Who, body: unknown, raw?: string) => answerOf(staysPOST(request('/api/v1/loyalty/stays', who, body, raw)));

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
beforeEach(clearWorld);
afterEach(clearWorld);
afterAll(async () => {
  await clearWorld();
  await resetAuth();
  vi.restoreAllMocks();
});

describe('hotel stays on /travel (P8-42e1)', () => {
  it('T42e1-I8: the three taps resolve a held booking once, only into its own program, and never before the caller is known', async () => {
    const h = await program('ZQ42E Taps Harbour');
    const other = await program('ZQ42E Taps Other');
    const ana = await person('ZQ42E Taps Ana');
    const mA = await membership(ana, h, 'ZQ42E-0001-7K9X');
    const mOther = await membership(ana, other);

    // Caller first: neither a missing credential nor a read-scope token pulls the body or writes.
    const place = await held(h, { code: 'ZQ42ETP01', suffix: '7K9X', reason: 'forwarder_conflict' });
    const before = await sumOf(['loyalty_inbox_booking_reads', 'loyalty_stays']);
    for (const [who, status] of [[null, 401], [readTok, 403]] as const) {
      const s = streamOf({ action: 'place', membershipId: mA });
      const r = await answerOf(resolvePOST(streamed(`/api/v1/loyalty/inbox/bookings/${place}`, who, s.stream), ctx(place)));
      expect(r.status).toBe(status);
      expect(s.flag.pulled).toBe(false);
    }
    expect(await sumOf(['loyalty_inbox_booking_reads', 'loyalty_stays'])).toBe(before);
    expect((await resolve(owner, 'abc', { action: 'ignore' })).status).toBe(400);
    expect((await resolve(owner, place, { action: 'place' })).status).toBe(400);
    expect((await resolve(owner, 2147483000, { action: 'ignore' })).body.error?.code).toBe('NOT_FOUND');

    // Another program's membership is refused and changes nothing.
    const wrong = await resolve(owner, place, { action: 'place', membershipId: mOther });
    expect([wrong.status, wrong.body.error?.code]).toEqual([400, 'INVALID_INPUT']);
    expect(await sumOf(['loyalty_inbox_booking_reads', 'loyalty_stays'])).toBe(before);

    // Place: one stay from the held booking, with the mail as evidence; the object is cleared.
    const placed = await resolve(two, place, { action: 'place', membershipId: mA });
    expect(placed.status).toBe(200);
    expect(LoyaltyBookingResolveResponseSchema.safeParse(placed.body).success).toBe(true);
    expect(placed.body.data).toEqual({ id: place, state: 'placed_by_hand' });
    const row = (await db.query('SELECT state, booking, stay_id, membership_id, dedupe_key, received_on::text AS r FROM loyalty_inbox_booking_reads WHERE id = $1', [place])).rows[0];
    expect(row).toMatchObject({ state: 'placed_by_hand', booking: null, membership_id: mA });
    const s = (await db.query('SELECT id, membership_id, source, evidence_key, evidence_received_on::text AS e, state FROM loyalty_stays WHERE id = $1', [row.stay_id])).rows[0];
    expect(s).toMatchObject({ membership_id: mA, source: 'email', evidence_key: row.dedupe_key, e: row.r, state: 'booked' });
    expect((await resolve(owner, place, { action: 'ignore' })).body.error?.code).toBe('ITEM_RESOLVED');

    // Ignore: that item alone.
    const ig = await held(h, { code: 'ZQ42ETP02' });
    const stays = await count('SELECT count(*) AS n FROM loyalty_stays');
    expect((await resolve(owner, ig, { action: 'ignore' })).body.data).toEqual({ id: ig, state: 'ignored' });
    expect(await count('SELECT count(*) AS n FROM loyalty_stays')).toBe(stays);
    expect(await count('SELECT count(*) AS n FROM loyalty_inbox_not_mine WHERE program_id = $1', [h])).toBe(0);
    expect((await db.query('SELECT booking FROM loyalty_inbox_booking_reads WHERE id = $1', [ig])).rows[0].booking).toBeNull();

    // Not mine: the pair once, and every held booking of the pair follows; another suffix does not.
    const x = await held(h, { code: 'ZQ42ETP03', suffix: 'NM12' });
    const y = await held(h, { code: 'ZQ42ETP04', suffix: 'NM12', reason: 'ambiguous_suffix' });
    const z = await held(h, { code: 'ZQ42ETP05', suffix: 'QQ34' });
    expect((await resolve(owner, x, { action: 'not_mine' })).body.data).toEqual({ id: x, state: 'not_mine' });
    const states = async () => (await db.query('SELECT id, state FROM loyalty_inbox_booking_reads WHERE id = ANY($1) ORDER BY id', [[x, y, z]])).rows.map((r) => r.state);
    expect(await states()).toEqual(['not_mine', 'not_mine', 'pending']);
    const w = await held(h, { code: 'ZQ42ETP06', suffix: 'NM12' });
    expect((await resolve(owner, w, { action: 'not_mine' })).status).toBe(200);
    expect(await count(`SELECT count(*) AS n FROM loyalty_inbox_not_mine WHERE program_id = $1 AND suffix = 'NM12'`, [h])).toBe(1);
    expect((await resolve(owner, y, { action: 'not_mine' })).body.error?.code).toBe('ITEM_RESOLVED');

    // Place is by hand, so it may re-book a cancelled stay of the same code (SPEC.md A5).
    await stay(mA, 'ZQ42ETP08', 'CURRENT_DATE + 10', 'CURRENT_DATE + 12', 'cancelled');
    const revive = await held(h, { code: 'ZQ42ETP08' });
    expect((await resolve(owner, revive, { action: 'place', membershipId: mA })).status).toBe(200);
    expect((await db.query(`SELECT state FROM loyalty_stays WHERE confirmation_code = 'ZQ42ETP08'`)).rows).toEqual([{ state: 'booked' }]);
    // By hand the dates still decide: a held booking received the same day as the cancellation the stay
    // already reflects does not re-book it; the item is resolved and the stay is untouched.
    const same = await stay(mA, 'ZQ42ETP09', 'CURRENT_DATE + 10', 'CURRENT_DATE + 12', 'cancelled');
    await db.query(`UPDATE loyalty_stays SET source = 'email', evidence_key = $2, evidence_received_on = CURRENT_DATE - 1 WHERE id = $1`, [same, sha('zq42e-same-day')]);
    const sameDay = await held(h, { code: 'ZQ42ETP09', day: -1 });
    expect((await resolve(owner, sameDay, { action: 'place', membershipId: mA })).body.data).toEqual({ id: sameDay, state: 'placed_by_hand' });
    expect((await db.query('SELECT state, evidence_key FROM loyalty_stays WHERE id = $1', [same])).rows).toEqual([{ state: 'cancelled', evidence_key: sha('zq42e-same-day') }]);
    expect((await db.query('SELECT stay_id FROM loyalty_inbox_booking_reads WHERE id = $1', [sameDay])).rows[0].stay_id).toBeNull();

    // Two simultaneous places: one 200, one 409, one stay.
    const race = await held(h, { code: 'ZQ42ETP07' });
    const answers = await Promise.all([resolve(owner, race, { action: 'place', membershipId: mA }), resolve(two, race, { action: 'place', membershipId: mA })]);
    expect(answers.map((a) => a.status).sort()).toEqual([200, 409]);
    expect(await count(`SELECT count(*) AS n FROM loyalty_stays WHERE confirmation_code = 'ZQ42ETP07'`)).toBe(1);
  });

  it('T42e1-I12: this year\'s nights count booked stays checked out by today, wholly in their check-out year, and nothing counted is null', async () => {
    const h = await program('ZQ42E Nights Harbour');
    const air = await program('ZQ42E Nights Air', 'airline');
    const [ana, ben, cy] = [await person('ZQ42E Nights Ana'), await person('ZQ42E Nights Ben'), await person('ZQ42E Nights Cy')];
    const mA = await membership(ana, h);
    const mB = await membership(ben, h);
    const mEmpty = await membership(cy, h);
    const mAir = await membership(ana, air);
    const jan1 = `date_trunc('year', CURRENT_DATE)::date`;
    // The cases; the expected column is whether the stay counts.
    const cases: [string, number, string, string, string, number | null][] = [
      ['out today', mA, 'CURRENT_DATE - 2', 'CURRENT_DATE', 'booked', 2],
      ['out tomorrow', mA, 'CURRENT_DATE - 1', 'CURRENT_DATE + 1', 'booked', null],
      ['cancelled', mA, 'CURRENT_DATE - 6', 'CURRENT_DATE', 'cancelled', null],
      ['spans new year', mA, `${jan1} - 3`, jan1, 'booked', 3],
      ['last year', mA, `${jan1} - 3`, `${jan1} - 1`, 'booked', null],
      ['other membership', mB, 'CURRENT_DATE - 4', 'CURRENT_DATE', 'booked', 4],
      ['only cancelled', mEmpty, 'CURRENT_DATE - 4', 'CURRENT_DATE', 'cancelled', null],
    ];
    let n = 0;
    for (const [, m, a, b, state] of cases) await stay(m, `ZQ42ENT${String(++n).padStart(2, '0')}`, a, b, state);
    // A held booking with dates in the past changes nothing.
    await held(h, { code: 'ZQ42ENTHELD', checkIn: await pgDay(-3), checkOut: await pgDay(-1) });

    const first = await loadBookings();
    const second = await loadBookings();
    expect(second).toEqual(first);
    expect(LoyaltyBookingsSchema.safeParse(first).success).toBe(true);
    expect(first.year).toBe(await pgYear());
    const ours = first.nights.filter((x) => [mA, mB, mEmpty, mAir].includes(x.membershipId));
    const sum = (m: number) => cases.filter((c) => c[1] === m && c[5] !== null).reduce((t, c) => t + (c[5] as number), 0) || null;
    expect(ours).toEqual([
      { membershipId: mA, nightsThisYear: sum(mA) },
      { membershipId: mB, nightsThisYear: sum(mB) },
      { membershipId: mEmpty, nightsThisYear: null },
    ].sort((p, q) => p.membershipId - q.membershipId));
    expect(sum(mA)).toBe(5);
    expect(ours.find((x) => x.membershipId === mEmpty)?.nightsThisYear).not.toBe(0);
    expect(first.nights.some((x) => x.membershipId === mAir)).toBe(false);
    // The completed list is exactly the counted stays.
    expect(first.completed.filter((s) => [mA, mB, mEmpty].includes(s.membershipId)).map((s) => s.nights).sort()).toEqual([2, 3, 4]);
  });

  it('T42e1-I13: the typed route resolves the caller first, refuses what the strict body and the rules refuse, and upserts by code without deleting', async () => {
    const h = await program('ZQ42E Typed Harbour');
    const air = await program('ZQ42E Typed Air', 'airline');
    const ana = await person('ZQ42E Typed Ana');
    const ben = await person('ZQ42E Typed Ben');
    const mA = await membership(ana, h);
    const mB = await membership(ben, h);
    const mAir = await membership(ana, air);
    const [d10, d12, d71] = [await pgDay(10), await pgDay(12), await pgDay(71)];
    const valid = { membershipId: mA, confirmationCode: 'zq42e-ty 01', checkIn: d10, checkOut: d12, property: '  ZQ42E Typed Inn ', state: 'booked', award: null };
    const tables = ['loyalty_stays', 'loyalty_inbox_booking_reads'];
    const before = await sumOf(tables);

    for (const [who, status] of [[null, 401], [readTok, 403]] as const) {
      const s = streamOf(valid);
      const r = await answerOf(staysPOST(streamed('/api/v1/loyalty/stays', who, s.stream)));
      expect(r.status).toBe(status);
      expect(s.flag.pulled).toBe(false);
    }
    expect((await typed(owner, null, 'not json')).status).toBe(400);
    const refusals: [string, unknown, number][] = [
      ['source', { ...valid, source: 'email' }, 400],
      ['nights', { ...valid, nights: 2 }, 400],
      ['id', { ...valid, id: 1 }, 400],
      ['an extra key', { ...valid, note: 'ZQ42E Guest' }, 400],
      ['a short code', { ...valid, confirmationCode: 'Z-Q4' }, 400],
      ['check-out not after check-in', { ...valid, checkOut: d10 }, 400],
      ['61 nights', { ...valid, checkOut: d71 }, 400],
      ['a bad date', { ...valid, checkIn: '2026-02-30' }, 400],
      ['a bad state', { ...valid, state: 'maybe' }, 400],
      ['a non-hotel membership', { ...valid, membershipId: mAir }, 400],
      ['an unknown membership', { ...valid, membershipId: 2147483000 }, 404],
    ];
    for (const [what, body, status] of refusals) {
      const r = await typed(owner, body);
      expect(r.status, what).toBe(status);
      expect(r.text, what).not.toMatch(/zq42e-ty|ZQ42ETY01|Typed Inn|Guest/i);
    }
    expect(await sumOf(tables)).toBe(before);

    const created = await typed(owner, valid);
    expect(created.status).toBe(201);
    expect(LoyaltyStayResponseSchema.safeParse(created.body).success).toBe(true);
    expect(created.body.data).toMatchObject({ membershipId: mA, maskedCode: '••••TY01', source: 'typed', property: 'ZQ42E Typed Inn', nights: 2, state: 'booked' });
    expect(created.text).not.toContain('ZQ42ETY01');
    const again = await typed(two, { ...valid, confirmationCode: 'ZQ42ETY01', property: 'ZQ42E Renamed Inn' });
    expect(again.status).toBe(200);
    expect(again.body.data?.id).toBe(created.body.data?.id);
    expect(again.body.data?.property).toBe('ZQ42E Renamed Inn');
    expect(await count(`SELECT count(*) AS n FROM loyalty_stays WHERE program_id = $1`, [h])).toBe(1);
    const cancelled = await typed(owner, { ...valid, state: 'cancelled' });
    expect([cancelled.status, cancelled.body.data?.state]).toEqual([200, 'cancelled']);
    expect((await db.query(`SELECT state FROM loyalty_stays WHERE program_id = $1`, [h])).rows).toEqual([{ state: 'cancelled' }]);
    // A typed write may re-book a cancelled stay: that is a person's act, which a mail can never do (SPEC.md A5).
    const rebooked = await typed(two, valid);
    expect([rebooked.status, rebooked.body.data?.state, rebooked.body.data?.id]).toEqual([200, 'booked', created.body.data?.id]);
    expect((await db.query(`SELECT state FROM loyalty_stays WHERE program_id = $1`, [h])).rows).toEqual([{ state: 'booked' }]);
    const elsewhere = await typed(owner, { ...valid, membershipId: mB });
    expect([elsewhere.status, elsewhere.body.error?.message]).toEqual([400, 'That confirmation code is already recorded under another membership of this program.']);
    expect(elsewhere.text).not.toMatch(/TY01|ty 01/i);
    const second = await typed(two, { ...valid, membershipId: mB, confirmationCode: 'ZQ42ETY02' });
    expect(second.status).toBe(201);
    expect(await count(`SELECT count(*) AS n FROM loyalty_stays WHERE program_id = $1`, [h])).toBe(2);
  });

  it('T42e1-I14: the loader is one ordered, schema-valid snapshot with masked codes and suffixes, and reads no ledger table', async () => {
    const h = await program('ZQ42E Loader Harbour');
    const ana = await person('ZQ42E Loader Ana');
    const ben = await person('ZQ42E Loader Ben');
    const mA = await membership(ana, h, 'ZQ42E-0001-7K9X');
    const mB = await membership(ben, h, 'ZQ42E-0002-7K9X');
    const u2 = await stay(mA, 'ZQ42ELD01', 'CURRENT_DATE + 20', 'CURRENT_DATE + 22');
    const u1 = await stay(mB, 'ZQ42ELD02', 'CURRENT_DATE + 5', 'CURRENT_DATE + 7');
    const u3 = await stay(mA, 'ZQ42ELD03', 'CURRENT_DATE + 5', 'CURRENT_DATE + 6');
    const c1 = await stay(mA, 'ZQ42ELD04', 'CURRENT_DATE - 2', 'CURRENT_DATE');
    await stay(mA, 'ZQ42ELD05', 'CURRENT_DATE - 9', 'CURRENT_DATE - 1', 'cancelled');
    await stay(mA, 'ZQ42ELD06', `date_trunc('year', CURRENT_DATE)::date - 4`, `date_trunc('year', CURRENT_DATE)::date - 2`);
    await stay(mB, 'ZQ42ELD07', 'CURRENT_DATE + 3', 'CURRENT_DATE + 4', 'cancelled');
    const q1 = await held(h, { code: 'ZQ42ELDQ1', suffix: '7K9X', reason: 'ambiguous_suffix', day: -3 });
    const q2 = await held(h, { code: 'ZQ42ELDQ2', day: -1 });
    const q3 = await held(h, { code: 'ZQ42ELDQ3', suffix: '7K9X', day: -1, kind: 'hotel_cancelled' });

    const texts: string[] = [];
    const spy = { query: (text: string, values?: unknown[]) => { texts.push(text); return db.query(text, values); } };
    const viaSpy = await loadBookings(spy as never);
    for (const t of texts) expect(t).not.toMatch(/\b(transactions|accounts|account_valuations)\b/);
    expect(texts.length).toBe(5);
    const b = await loadBookings();
    expect(b).toEqual(viaSpy);
    expect(LoyaltyBookingsSchema.safeParse(b).success).toBe(true);
    expect(b.year).toBe(await pgYear());
    const ours = (ids: number[]) => ids;
    expect(b.upcoming.map((s) => s.id).filter((id) => [u1, u2, u3].includes(id))).toEqual(ours(u1 < u3 ? [u1, u3, u2] : [u3, u1, u2]));
    expect(b.completed.filter((s) => [mA, mB].includes(s.membershipId)).map((s) => s.id)).toEqual([c1]);
    const queue = b.queue.filter((x) => x.programId === h);
    expect(queue.map((x) => x.id)).toEqual([Math.max(q2, q3), Math.min(q2, q3), q1]);
    const one = queue.find((x) => x.id === q1);
    expect(one).toMatchObject({ maskedSuffix: '••••7K9X', maskedCode: '••••LDQ1', candidateMembershipIds: [mA, mB].sort((p, q) => p - q), state: 'booked', property: 'ZQ42E Held Inn' });
    expect(queue.find((x) => x.id === q2)).toMatchObject({ maskedSuffix: null, candidateMembershipIds: [], reason: 'no_suffix' });
    expect(queue.find((x) => x.id === q3)?.state).toBe('cancelled');
    const text = JSON.stringify(b);
    for (const code of ['ZQ42ELD0', 'ZQ42ELDQ', 'ZQ42E-0001', 'ZQ42E-0002']) expect(text).not.toContain(code);

    // The overview is unchanged: it still parses, and its reading panel keeps exactly its keys.
    const r = await answerOf(overviewGET(new NextRequest(`${ORIGIN}/api/v1/loyalty`, { headers: { host: 'localhost:3000', ...cookie(owner.token) } })));
    expect(r.status).toBe(200);
    expect(LoyaltyOverviewResponseSchema.safeParse(r.body).success).toBe(true);
    expect(Object.keys((r.body.data as unknown as LoyaltyOverview).inboxRead).sort()).toEqual(
      ['coverage', 'failed', 'fromMail', 'lastRead', 'needsAttention', 'needsAttentionTotal', 'readable', 'screenshotDue', 'waiting']
    );
    expect(Object.keys(r.body.data ?? {}).sort()).toEqual(['cardAccounts', 'cards', 'inbox', 'inboxRead', 'instruments', 'members', 'programs']);
  });

  it('T42e1-I15: the page shows the counted nights, the lists and the held booking with masked codes, a dash for nothing, and no section for no one', async () => {
    const NUMBER = 'ZQ42ENUMBERCANARY7K9X';
    const CODES = ['ZQ42EDONECANARY1', 'ZQ42ESOONCANARY2', 'ZQ42EGONECANARY3', 'ZQ42EHELDCANARY4'];
    const h = await program('ZQ42E Page Harbour');
    const ana = await person('ZQ42E Page Ana');
    const mA = await membership(ana, h, NUMBER);
    await stay(mA, CODES[0], 'CURRENT_DATE - 3', 'CURRENT_DATE - 1');
    await stay(mA, CODES[1], 'CURRENT_DATE + 30', 'CURRENT_DATE + 33', 'booked', 'ZQ42E Soon Inn');
    await stay(mA, CODES[2], 'CURRENT_DATE - 9', 'CURRENT_DATE - 7', 'cancelled', 'ZQ42E Gone Inn');
    await held(h, { code: CODES[3], suffix: '7K9X', reason: 'forwarder_conflict' });
    const year = await pgYear();
    const lastYear = (await pgDay(-1)).slice(0, 4) !== String(year);
    const page = async () => renderToStaticMarkup(createElement(TravelBoard, { overview: await loadOverview(), bookings: await loadBookings() })).replace(/<!-- -->/g, '');
    const occurrences = (html: string, s: string) => html.split(s).length - 1;

    const html = await page();
    expect(occurrences(html, 'Hotel stays')).toBe(1);
    if (lastYear) expect(html).toContain('No stay counted yet');
    else expect(occurrences(html, `2 nights counted in ${year}`)).toBe(1);
    expect(html).toContain('Upcoming');
    expect(html).toContain('ZQ42E Soon Inn');
    expect(html).not.toContain('ZQ42E Gone Inn');
    expect(html).toContain('Stays that need a membership');
    for (const label of ['Add to this membership', 'Not mine', 'Ignore']) expect(html).toContain(label);
    expect(html).toContain('••••ARY2');
    expect(html).toContain('••••ARY4');
    const api = await answerOf(overviewGET(new NextRequest(`${ORIGIN}/api/v1/loyalty`, { headers: { host: 'localhost:3000', ...cookie(two.token) } })));
    for (const text of [html, ...bodies, api.text]) {
      for (const c of [...CODES, NUMBER]) expect(text).not.toContain(c);
    }

    // A hotel membership with no stay: the dash and its sentence, never a zero.
    await db.query(`DELETE FROM loyalty_inbox_booking_reads WHERE program_id = $1`, [h]);
    await db.query(`UPDATE loyalty_stays SET state = 'cancelled' WHERE program_id = $1`, [h]);
    const empty = await page();
    expect(empty).toContain('— · No stay counted yet');
    expect(empty).not.toMatch(/\b0 nights/);
    expect(empty).not.toContain('Upcoming');

    // No hotel membership and no stay: no section at all.
    await clearWorld();
    expect(await count(`SELECT count(*) AS n FROM loyalty_memberships ms WHERE EXISTS (SELECT 1 FROM loyalty_programs p WHERE p.id = ms.program_id AND p.kind = 'hotel')`)).toBe(0);
    expect(await page()).not.toContain('Hotel stays');
  });
});
