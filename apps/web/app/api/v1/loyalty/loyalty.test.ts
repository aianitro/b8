// P8-42a — the loyalty routes against a real Postgres (C1–C11), through the real handlers.
//
// TIER 2, collected by `vitest.integration.config.mts` (`app/api/v1/**/*.test.ts`) with the
// scratch-database guard in its setup files. Every person signs in through the real passkey path
// (`../auth/secondUserTestKit.ts`); bearer tokens are minted with `createPersonalToken`, as the
// `tokens` script does. Each handler is called directly with a `NextRequest`, which is why the
// write routes must refuse a read-scope token themselves and not rely on the boundary.
//
// CLEANUP IS OF THIS SUITE'S OWN ROWS: the household and membership tables (which only loyalty code
// writes), programs named `ZQ42A…`, accounts with ids `zq42a…`, and the auth tables through
// `resetAuth`. The seeded catalog is never changed except by C11's own fabricated programs.
//
// Every name, number and description is fabricated and carries `ZQ42A`; the figures are fabricated.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { createPersonalToken } from '@/lib/authSession';
import { computeCurrentNetWorth } from '@/lib/netWorth';
import { normalizeLabel } from '@/lib/domain/loyalty';
import { planImport } from '@/lib/domain/loyaltyImport';
import { ROUTES } from '@/lib/giftSurfaceRegistry';
import {
  LoyaltyInstrumentResponseSchema,
  LoyaltyMemberNumberResponseSchema,
  LoyaltyMemberResponseSchema,
  LoyaltyMembershipResponseSchema,
  LoyaltyOverviewResponseSchema,
  LoyaltyProgramResponseSchema,
  type LoyaltyInstrument,
  type LoyaltyMember,
  type LoyaltyMembership,
  type LoyaltyOverview,
  type LoyaltyProgram,
} from '@b8/contracts/loyalty';
import {
  bearer, bootstrapOwner, cookie, enrolSecondUser, resetAuth, type EnrolledUser,
} from '../auth/secondUserTestKit';
import { GET as overviewGET } from './route';
import { POST as membersPOST } from './members/route';
import { PATCH as memberPATCH } from './members/[id]/route';
import { POST as programsPOST } from './programs/route';
import { PATCH as programPATCH } from './programs/[id]/route';
import { POST as membershipsPOST } from './memberships/route';
import { PATCH as membershipPATCH } from './memberships/[id]/route';
import { GET as memberNumberGET } from './memberships/[id]/member-number/route';
import * as observationsRoute from './memberships/[id]/observations/route';
import { POST as instrumentsPOST } from './instruments/route';
import { PATCH as instrumentPATCH } from './instruments/[id]/route';
import { GET as ledgerOverviewGET } from '../overview/route';

const ORIGIN = 'http://localhost:3000';
const WEB = fileURLToPath(new URL('../../../../', import.meta.url));

type Who = EnrolledUser | { bearer: string } | null;
type Ctx = { params: Promise<{ id: string }> };
const ctx = (id: number | string): Ctx => ({ params: Promise.resolve({ id: String(id) }) });

function req(path: string, who: Who, init: { method?: string; body?: unknown; raw?: string } = {}): NextRequest {
  const auth = who === null ? {} : 'bearer' in who ? bearer(who.bearer) : cookie(who.token);
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? 'GET',
    headers: { host: 'localhost:3000', 'content-type': 'application/json', ...auth },
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}

interface Answer { status: number; text: string; body: { success?: boolean; data?: unknown; error?: { code: string; message: string } } }
async function read(response: Response): Promise<Answer> {
  const text = await response.text();
  let body: Answer['body'] = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, text, body };
}
const holds = (text: string, canary: string) => text.toLowerCase().includes(canary.toLowerCase());

// ─── The routes, by name, so a sweep can call every one ─────────────────────────────────────────

const api = {
  overview: (who: Who) => overviewGET(req('/api/v1/loyalty', who)),
  createMember: (who: Who, body: unknown) => membersPOST(req('/api/v1/loyalty/members', who, { method: 'POST', body })),
  patchMember: (who: Who, id: number | string, body: unknown) => memberPATCH(req(`/api/v1/loyalty/members/${id}`, who, { method: 'PATCH', body }), ctx(id)),
  createProgram: (who: Who, body: unknown) => programsPOST(req('/api/v1/loyalty/programs', who, { method: 'POST', body })),
  patchProgram: (who: Who, id: number | string, body: unknown) => programPATCH(req(`/api/v1/loyalty/programs/${id}`, who, { method: 'PATCH', body }), ctx(id)),
  createMembership: (who: Who, body: unknown) => membershipsPOST(req('/api/v1/loyalty/memberships', who, { method: 'POST', body })),
  patchMembership: (who: Who, id: number | string, body: unknown) => membershipPATCH(req(`/api/v1/loyalty/memberships/${id}`, who, { method: 'PATCH', body }), ctx(id)),
  memberNumber: (who: Who, id: number | string) => memberNumberGET(req(`/api/v1/loyalty/memberships/${id}/member-number`, who), ctx(id)),
  observe: (who: Who, id: number | string, body: unknown) => observationsRoute.POST(req(`/api/v1/loyalty/memberships/${id}/observations`, who, { method: 'POST', body }), ctx(id)),
  createInstrument: (who: Who, body: unknown) => instrumentsPOST(req('/api/v1/loyalty/instruments', who, { method: 'POST', body })),
  patchInstrument: (who: Who, id: number | string, body: unknown) => instrumentPATCH(req(`/api/v1/loyalty/instruments/${id}`, who, { method: 'PATCH', body }), ctx(id)),
};

async function data<T>(response: Response | Promise<Response>, status = 200): Promise<T> {
  const r = await read(await response);
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${r.body.error?.code}`);
  return r.body.data as T;
}

// ─── The world ─────────────────────────────────────────────────────────────────────────────────

async function clearLoyalty(): Promise<void> {
  await db.query('TRUNCATE loyalty_instruments, loyalty_observations, loyalty_memberships, household_members RESTART IDENTITY CASCADE');
  await db.query(`DELETE FROM loyalty_programs WHERE name LIKE 'ZQ42A%'`);
  await db.query(`DELETE FROM account_valuations WHERE account_id LIKE 'zq42a%'`);
  await db.query(`DELETE FROM accounts WHERE id LIKE 'zq42a%'`);
}

/** Row checksum of every loyalty table, for "nothing changed". */
async function loyaltySum(): Promise<string> {
  const r = await db.query<{ s: string }>(`SELECT md5(
      coalesce((SELECT string_agg(t::text, '|' ORDER BY t.id) FROM household_members t), '') ||
      coalesce((SELECT string_agg(t::text, '|' ORDER BY t.id) FROM loyalty_programs t), '') ||
      coalesce((SELECT string_agg(t::text, '|' ORDER BY t.id) FROM loyalty_program_aliases t), '') ||
      coalesce((SELECT string_agg(t::text, '|' ORDER BY t.id) FROM loyalty_memberships t), '') ||
      coalesce((SELECT string_agg(t::text, '|' ORDER BY t.id) FROM loyalty_observations t), '') ||
      coalesce((SELECT string_agg(t::text, '|' ORDER BY t.id) FROM loyalty_instruments t), '')) AS s`);
  return r.rows[0].s;
}

const count = async (table: string) => Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)).rows[0].n);
const pgDay = async (days = 0) => (await db.query<{ d: string }>('SELECT (CURRENT_DATE + $1::int)::text AS d', [days])).rows[0].d;

/** The first catalog programs, by id: real seeded rows the memberships here hang off. */
let catalog: LoyaltyProgram[] = [];
let owner: EnrolledUser;
let two: EnrolledUser;
let readTok: { bearer: string };
let fullTok: { bearer: string };

beforeAll(async () => {
  await clearLoyalty();
  await resetAuth();
  owner = await bootstrapOwner();
  two = await enrolSecondUser(owner.token);
  readTok = { bearer: (await createPersonalToken({ label: 'zq42a read', scope: 'read', userId: owner.userId })).token };
  fullTok = { bearer: (await createPersonalToken({ label: 'zq42a full', scope: 'full', userId: owner.userId })).token };
  const overview = await data<LoyaltyOverview>(api.overview(owner));
  catalog = overview.programs.filter((p) => !p.name.startsWith('ZQ42A'));
}, 60_000);

afterAll(async () => {
  await clearLoyalty();
  await resetAuth();
});

let memberSeq = 0;
/** A fresh member and a membership on catalog program `programIndex`. */
async function membershipFor(programIndex: number, extra: Record<string, unknown> = {}): Promise<LoyaltyMembership> {
  memberSeq++;
  const member = await data<LoyaltyMember>(api.createMember(owner, { displayName: `ZQ42A Member ${memberSeq}` }), 201);
  return data<LoyaltyMembership>(api.createMembership(owner, { memberId: member.id, programId: catalog[programIndex].id, ...extra }), 201);
}

/** Run `sql` inside a transaction that is always rolled back; resolves to the error it raised. */
async function refusal(sql: string): Promise<string> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    return 'accepted';
  } catch (err) {
    return (err as Error).message;
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

// ─── Scenarios ─────────────────────────────────────────────────────────────────────────────────

describe('loyalty routes (P8-42a)', () => {
  it('T42a-C1: the migrated catalog is wide and the schema refuses every bad row directly', async () => {
    const kinds = await db.query<{ kind: string; n: string }>(`SELECT kind, count(*)::text AS n FROM loyalty_programs WHERE name NOT LIKE 'ZQ42A%' GROUP BY kind`);
    const by = Object.fromEntries(kinds.rows.map((r) => [r.kind, Number(r.n)]));
    expect(Object.values(by).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(40);
    expect(by.airline).toBeGreaterThanOrEqual(20);
    expect(by.hotel).toBeGreaterThanOrEqual(10);
    expect(by.card_currency).toBeGreaterThanOrEqual(5);
    expect(by.travel_cash).toBeGreaterThanOrEqual(1);
    expect(by.car).toBeGreaterThanOrEqual(3);
    // The migration seeds no household rows (this suite started from emptied tables; the migration
    // text itself inserts into none of them) and carries no fixture text.
    const migration = readFileSync(join(WEB, '../../migrations/1792700000000_loyalty.sql'), 'utf8');
    expect(migration).not.toMatch(/INSERT INTO (household_members|loyalty_memberships|loyalty_observations|loyalty_instruments)/);
    expect(migration).not.toMatch(/zq42a/i);

    const m = await membershipFor(0);
    const p = catalog[0].id;
    const ins = (balance: string, unit: string, source = 'typed') =>
      `INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source) VALUES (${m.id}, CURRENT_DATE, ${balance}, '${unit}', '${source}')`;
    expect(await refusal(ins('10', 'yen'))).toMatch(/violates check constraint/);
    expect(await refusal(ins('-1', 'points'))).toMatch(/violates check constraint/);
    expect(await refusal(ins('1.5', 'points'))).toMatch(/violates check constraint/);
    expect(await refusal(ins('1.005', 'usd'))).toMatch(/violates check constraint/);
    expect(await refusal(ins('10', 'points', 'scraped'))).toMatch(/violates check constraint/);
    expect(await refusal(ins('25.50', 'usd'))).toBe('accepted');
    expect(await refusal(`INSERT INTO loyalty_memberships (member_id, program_id) VALUES (${m.memberId}, ${p})`)).toMatch(/duplicate key/);
    expect(await refusal(`INSERT INTO household_members (display_name) VALUES ('zq42a member 1')`)).toMatch(/duplicate key.*household_members_display_name_ci/);
    expect(await refusal(`INSERT INTO household_members (display_name, user_id) VALUES ('ZQ42A U1', ${owner.userId}), ('ZQ42A U2', ${owner.userId})`)).toMatch(/duplicate key/);
    expect(await refusal(`INSERT INTO loyalty_instruments (membership_id, kind, description, issued_on, used_on, source) VALUES (${m.id}, 'other', 'ZQ42A x', '2026-02-01', '2026-01-01', 'typed')`)).toMatch(/violates check constraint/);
  });

  it('T42a-C2: the current balance is the newest as-of, not the last arrival; ties go to the later reading; zero is a reading', async () => {
    const m = await membershipFor(1);
    expect([m.balance, m.unit, m.asOf, m.source]).toEqual([null, null, null, null]);
    const [d1, d2, d3] = [await pgDay(-10), await pgDay(-5), await pgDay(0)];
    const a = await data<LoyaltyMembership>(api.observe(owner, m.id, { asOf: d2, balance: '5000', unit: 'points' }), 201);
    expect([a.balance, a.asOf, a.source]).toEqual(['5000', d2, 'typed']);
    // B is older and arrives later: stored, but not current.
    const b = await data<LoyaltyMembership>(api.observe(owner, m.id, { asOf: d1, balance: '9000', unit: 'points' }), 201);
    expect(b.balance).toBe('5000');
    expect(await db.query('SELECT 1 FROM loyalty_observations WHERE membership_id = $1', [m.id]).then((r) => r.rows.length)).toBe(2);
    // C: the same day as A, a different balance: the later reading wins the tie.
    const c = await data<LoyaltyMembership>(api.observe(owner, m.id, { asOf: d2, balance: '5100', unit: 'points' }), 201);
    expect(c.balance).toBe('5100');
    // Zero, newest: shown as 0 with its unit, not null.
    const z = await data<LoyaltyMembership>(api.observe(owner, m.id, { asOf: d3, balance: '0', unit: 'points' }), 201);
    expect([z.balance, z.unit, z.asOf]).toEqual(['0', 'points', d3]);
    const overview = await data<LoyaltyOverview>(api.overview(two));
    const line = overview.cards.flatMap((card) => card.memberships).find((x) => x.id === m.id);
    expect(line?.balance).toBe('0');
    expect(LoyaltyOverviewResponseSchema.safeParse({ success: true, data: overview }).success).toBe(true);
  });

  it('T42a-C3: units and balances are validated by the route; usd keeps two decimals; no future date; no client-chosen source', async () => {
    const m = await membershipFor(2);
    const before = await count('loyalty_observations');
    const today = await pgDay(0);
    for (const balance of ['1500.5', '1500.0', '-1', '1,500', 1500]) {
      const r = await read(await api.observe(owner, m.id, { asOf: today, balance, unit: 'points' }));
      expect([r.status, r.body.error?.code]).toEqual([400, 'INVALID_INPUT']);
    }
    expect(await count('loyalty_observations')).toBe(before);
    const usd = await data<LoyaltyMembership>(api.observe(owner, m.id, { asOf: today, balance: '25.5', unit: 'usd' }), 201);
    expect([usd.balance, usd.unit]).toEqual(['25.50', 'usd']);
    expect((await db.query<{ b: string }>(`SELECT balance::text AS b FROM loyalty_observations WHERE membership_id = $1`, [m.id])).rows[0].b).toBe('25.50');
    for (const [balance, unit] of [['25.005', 'usd'], ['2,031.50', 'usd'], ['10', 'yen']]) {
      expect((await api.observe(owner, m.id, { asOf: today, balance, unit })).status).toBe(400);
    }
    const whole = await data<LoyaltyMembership>(api.observe(owner, m.id, { asOf: await pgDay(1), balance: '1200', unit: 'miles' }), 201);
    expect(whole.balance).toBe('1200');
    expect(whole.balance).not.toContain('.');
    expect((await api.observe(owner, m.id, { asOf: '2999-01-01', balance: '1', unit: 'points' })).status).toBe(400);
    expect((await api.observe(owner, m.id, { asOf: await pgDay(2), balance: '1', unit: 'points' })).status).toBe(400);
    for (const source of ['import', 'email', 'screenshot']) {
      expect((await api.observe(owner, m.id, { asOf: today, balance: '1', unit: 'points', source })).status).toBe(400);
    }
    const n = await count('loyalty_observations');
    await data(api.observe(owner, m.id, { asOf: today, balance: '1', unit: 'points', source: 'typed' }), 201);
    await data(api.observe(owner, m.id, { asOf: today, balance: '2', unit: 'points' }), 201);
    const added = await db.query<{ source: string }>('SELECT source FROM loyalty_observations ORDER BY id DESC LIMIT 2');
    expect(added.rows.map((r) => r.source)).toEqual(['typed', 'typed']);
    expect(await count('loyalty_observations')).toBe(n + 2);
  });

  it('T42a-C4: the member number is masked on every route and in every log line; only a browser session copies it', async () => {
    const CANARY = 'ZQ42A-NUM-0001-ZZ';
    const substrings = (s: string, len: number) => Array.from({ length: s.length - len + 1 }, (_, i) => s.slice(i, i + len));
    const lines: string[] = [];
    const capture = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(capture), vi.spyOn(console, 'info').mockImplementation(capture),
      vi.spyOn(console, 'warn').mockImplementation(capture), vi.spyOn(console, 'error').mockImplementation(capture),
      vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => { lines.push(String(c)); return true; }),
      vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => { lines.push(String(c)); return true; }),
    ];
    const bodies: string[] = [];
    let m: LoyaltyMembership;
    try {
      memberSeq++;
      const member = await data<LoyaltyMember>(api.createMember(owner, { displayName: `ZQ42A Member ${memberSeq}` }), 201);
      const created = await read(await api.createMembership(owner, { memberId: member.id, programId: catalog[3].id, memberNumber: `  ${CANARY} `, tier: 'ZQ42A Gold' }));
      expect(created.status).toBe(201);
      bodies.push(created.text);
      m = created.body.data as LoyaltyMembership;
      expect(m.memberNumberMasked).toBe('••••1-ZZ');
      expect(LoyaltyMembershipResponseSchema.safeParse(created.body).success).toBe(true);
      // A refusal of a body carrying the number: the error says what is wrong and echoes none of it.
      const refused = await read(await api.patchMembership(owner, m.id, { memberNumber: CANARY, tier: 'x'.repeat(101) }));
      expect(refused.status).toBe(400);
      for (const s of substrings(CANARY, 5)) expect(holds(refused.text, s), s).toBe(false);
      const refusedCreate = await read(await api.createMembership(owner, { memberId: member.id, programId: catalog[3].id, memberNumber: CANARY }));
      expect(refusedCreate.status).toBe(409);
      for (const s of substrings(CANARY, 5)) expect(holds(refusedCreate.text, s), s).toBe(false);
      bodies.push(refused.text, refusedCreate.text);
      // Every route, for both users and for a read-scope token.
      for (const who of [owner, two, readTok] as Who[]) {
        const overview = await read(await api.overview(who));
        expect(overview.status).toBe(200);
        expect(overview.text).toContain('••••1-ZZ');
        bodies.push(overview.text);
        bodies.push((await read(await api.patchMembership(who, m.id, { tier: 'ZQ42A Silver' }))).text);
        bodies.push((await read(await api.observe(who, m.id, { asOf: await pgDay(0), balance: '10', unit: 'points' }))).text);
        bodies.push((await read(await api.patchMember(who, member.id, { displayName: member.displayName }))).text);
        bodies.push((await read(await api.createInstrument(who, { membershipId: m.id, kind: 'other', description: 'ZQ42A cert' }))).text);
        bodies.push((await read(await api.createProgram(who, { name: `ZQ42A Prog ${bodies.length}`, kind: 'other', defaultUnit: 'points' }))).text);
      }
      for (const body of bodies) expect(holds(body, CANARY)).toBe(false);
      // The copy route: the full number to a browser session, 403 to any bearer token.
      const full = await read(await api.memberNumber(owner, m.id));
      expect(full.status).toBe(200);
      expect(LoyaltyMemberNumberResponseSchema.parse(full.body)).toEqual({ success: true, data: { membershipId: m.id, memberNumber: CANARY } });
      expect((await data<{ memberNumber: string }>(api.memberNumber(two, m.id))).memberNumber).toBe(CANARY);
      for (const tok of [readTok, fullTok]) {
        const r = await read(await api.memberNumber(tok, m.id));
        expect([r.status, r.body.error?.code]).toEqual([403, 'BROWSER_SESSION_REQUIRED']);
        expect(holds(r.text, CANARY)).toBe(false);
        for (const s of substrings(CANARY, 6)) expect(holds(r.text, s)).toBe(false);
      }
      // A null or blank number emits null, never bare bullets.
      const blank = await membershipFor(4, { memberNumber: '   ' });
      expect(blank.memberNumberMasked).toBeNull();
      expect((await data<{ memberNumber: string | null }>(api.memberNumber(owner, blank.id))).memberNumber).toBeNull();
      expect((await membershipFor(5)).memberNumberMasked).toBeNull();
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
    const logText = lines.join('\n');
    expect(lines.length).toBeGreaterThan(0);
    expect(logText).toMatch(/loyalty (membership created|observation recorded|member number served)/);
    for (const s of substrings(CANARY, 6)) expect(holds(logText, s), s).toBe(false);
  });

  it('T42a-C5: no session is 401 everywhere; both users are peers; a read token reads and is refused every write at the handler', async () => {
    const m = await membershipFor(6);
    const inst = await data<LoyaltyInstrument>(api.createInstrument(owner, { membershipId: m.id, kind: 'other', description: 'ZQ42A five' }), 201);
    const today = await pgDay(0);
    const writes = (who: Who) => [
      () => api.createMember(who, { displayName: 'ZQ42A Nobody' }),
      () => api.patchMember(who, m.memberId, { displayName: 'ZQ42A Renamed' }),
      () => api.createProgram(who, { name: 'ZQ42A Nowhere Air', kind: 'airline', defaultUnit: 'miles' }),
      () => api.patchProgram(who, m.programId, { kind: 'other' }),
      () => api.createMembership(who, { memberId: m.memberId, programId: catalog[7].id }),
      () => api.patchMembership(who, m.id, { tier: 'ZQ42A Gold' }),
      () => api.observe(who, m.id, { asOf: today, balance: '1', unit: 'points' }),
      () => api.createInstrument(who, { membershipId: m.id, kind: 'other', description: 'ZQ42A x' }),
      () => api.patchInstrument(who, inst.id, { description: 'ZQ42A y' }),
    ];
    const sum = await loyaltySum();
    for (const call of [...writes(null), () => api.overview(null), () => api.memberNumber(null, m.id)]) {
      const r = await read(await call());
      expect([r.status, r.body.error?.code]).toEqual([401, 'UNAUTHENTICATED']);
    }
    for (const call of writes(readTok)) {
      const r = await read(await call());
      expect([r.status, r.body.error?.code]).toEqual([403, 'INSUFFICIENT_SCOPE']);
    }
    expect(await loyaltySum()).toBe(sum);
    expect((await api.overview(readTok)).status).toBe(200);
    // Peers: the second user edits the owner's rows and sees them.
    const tiered = await data<LoyaltyMembership>(api.patchMembership(two, m.id, { tier: 'ZQ42A Peer' }));
    expect(tiered.tier).toBe('ZQ42A Peer');
    const seen = (await data<LoyaltyOverview>(api.overview(two))).cards.flatMap((c) => c.memberships).find((x) => x.id === m.id);
    expect(seen?.tier).toBe('ZQ42A Peer');
    // A member with no user exists and is nobody's identity: no header naming it gets in.
    const r = await db.query<{ user_id: number | null }>('SELECT user_id FROM household_members WHERE id = $1', [m.memberId]);
    expect(r.rows[0].user_id).toBeNull();
    const asMember = new NextRequest(`${ORIGIN}/api/v1/loyalty`, { headers: { host: 'localhost:3000', 'x-member-id': String(m.memberId) } });
    expect((await overviewGET(asMember)).status).toBe(401);
  });

  it('T42a-C6: net worth, accounts and the ledger overview are untouched by loyalty rows in every unit', async () => {
    await db.query(`INSERT INTO accounts (id, name, type, landscape, valuation_mode, track_transactions)
                    VALUES ('zq42a_brokerage', 'ZQ42A Fabricated Brokerage', 'investment', 'capital', 'valuation', TRUE)`);
    await db.query(`INSERT INTO account_valuations (account_id, value, source) VALUES ('zq42a_brokerage', 7, 'manual')`);
    const accountSum = async () => (await db.query<{ s: string }>(`SELECT md5(
        coalesce((SELECT string_agg(a::text, '|' ORDER BY a.id) FROM accounts a), '') ||
        coalesce((SELECT string_agg(v::text, '|' ORDER BY v.id) FROM account_valuations v), '')) AS s`)).rows[0].s;
    const ledger = async () => {
      const body = await (await ledgerOverviewGET(req('/api/v1/overview', owner))).json();
      // Volatile: anything stamped with the moment of the read.
      return JSON.stringify(body, (k, v) => (/(At|Time|time|Ago|age)$/.test(k) ? undefined : v));
    };
    const netBefore = await computeCurrentNetWorth();
    const sumBefore = await accountSum();
    const ledgerBefore = await ledger();

    const today = await pgDay(0);
    const units: [number, string, string][] = [[8, '999999999999', 'points'], [9, '1200', 'miles'], [10, '3', 'nights'], [11, '1.10', 'usd']];
    for (const [i, balance, unit] of units) {
      const m = await membershipFor(i);
      await data(api.observe(owner, m.id, { asOf: today, balance, unit }), 201);
      await data(api.createInstrument(owner, { membershipId: m.id, kind: 'travel_credit', description: 'ZQ42A credit' }), 201);
    }
    expect(await computeCurrentNetWorth()).toEqual(netBefore);
    expect(await accountSum()).toBe(sumBefore);
    expect(await ledger()).toBe(ledgerBefore);
  });

  it('T42a-C7: every editable field edits in place and alone; a balance edit appends one typed row and rewrites none', async () => {
    const m = await membershipFor(12, { memberNumber: 'ZQ42A-EDIT-0001', tier: 'ZQ42A Base' });
    const member = await data<LoyaltyMember>(api.patchMember(owner, m.memberId, { displayName: 'ZQ42A Edited' }));
    expect(member).toEqual({ id: m.memberId, displayName: 'ZQ42A Edited', userId: null });
    expect(await data<LoyaltyMember>(api.patchMember(owner, m.memberId, { userId: two.userId }))).toEqual({ id: m.memberId, displayName: 'ZQ42A Edited', userId: two.userId });
    expect(await data<LoyaltyMember>(api.patchMember(owner, m.memberId, { userId: null }))).toEqual({ id: m.memberId, displayName: 'ZQ42A Edited', userId: null });

    const prog = await data<LoyaltyProgram>(api.createProgram(owner, { name: 'ZQ42A Edit Air', kind: 'airline', defaultUnit: 'miles' }), 201);
    expect(prog.aliases).toEqual(['zq42a edit air']);
    expect(await data<LoyaltyProgram>(api.patchProgram(owner, prog.id, { name: 'ZQ42A Edit Air Two' }))).toEqual({ ...prog, name: 'ZQ42A Edit Air Two' });
    expect(await data<LoyaltyProgram>(api.patchProgram(owner, prog.id, { kind: 'other' }))).toEqual({ ...prog, name: 'ZQ42A Edit Air Two', kind: 'other' });
    expect(await data<LoyaltyProgram>(api.patchProgram(owner, prog.id, { defaultUnit: 'points' }))).toEqual({ ...prog, name: 'ZQ42A Edit Air Two', kind: 'other', defaultUnit: 'points' });

    const tier = await data<LoyaltyMembership>(api.patchMembership(owner, m.id, { tier: 'ZQ42A Top' }));
    expect(tier).toEqual({ ...m, memberDisplayName: 'ZQ42A Edited', tier: 'ZQ42A Top' });
    const num = await data<LoyaltyMembership>(api.patchMembership(owner, m.id, { memberNumber: 'ZQ42A-EDIT-0002' }));
    expect(num).toEqual({ ...tier, memberNumberMasked: '••••0002' });
    expect((await data<{ memberNumber: string }>(api.memberNumber(owner, m.id))).memberNumber).toBe('ZQ42A-EDIT-0002');
    expect((await data<LoyaltyMembership>(api.patchMembership(owner, m.id, { tier: null }))).tier).toBeNull();

    const i = await data<LoyaltyInstrument>(api.createInstrument(owner, { membershipId: m.id, kind: 'other', description: 'ZQ42A cert' }), 201);
    const steps: [Record<string, unknown>, Partial<LoyaltyInstrument>][] = [
      [{ kind: 'free_night' }, { kind: 'free_night' }],
      [{ description: 'ZQ42A night' }, { description: 'ZQ42A night' }],
      [{ issuedOn: '2026-01-01' }, { issuedOn: '2026-01-01' }],
      [{ expiresOn: '2026-12-31' }, { expiresOn: '2026-12-31' }],
      [{ usedOn: '2026-06-01' }, { usedOn: '2026-06-01' }],
    ];
    let expected: LoyaltyInstrument = i;
    for (const [body, change] of steps) {
      expected = { ...expected, ...change };
      expect(await data<LoyaltyInstrument>(api.patchInstrument(owner, i.id, body))).toEqual(expected);
    }
    // The order rule against the STORED row: an issue date after the stored expiry is refused.
    expect((await api.patchInstrument(owner, i.id, { issuedOn: '2027-01-01' })).status).toBe(400);
    expect(LoyaltyInstrumentResponseSchema.safeParse({ success: true, data: expected }).success).toBe(true);

    // A balance edit is a new row; earlier rows byte-identical.
    await data(api.observe(owner, m.id, { asOf: await pgDay(-3), balance: '100', unit: 'points' }), 201);
    const rows = async () => (await db.query<{ s: string }>(`SELECT string_agg(o::text, '|' ORDER BY o.id) AS s FROM loyalty_observations o WHERE membership_id = $1`, [m.id])).rows[0].s;
    const before = await rows();
    const n = await count('loyalty_observations');
    const after = await data<LoyaltyMembership>(api.observe(owner, m.id, { asOf: await pgDay(0), balance: '150', unit: 'points' }), 201);
    expect(after.balance).toBe('150');
    expect(await count('loyalty_observations')).toBe(n + 1);
    expect((await rows()).startsWith(`${before}|`)).toBe(true);
    // No route updates or deletes an observation: the observations route exports POST alone.
    expect(Object.keys(observationsRoute).sort()).toEqual(['POST']);
  });

  it('T42a-C8: instruments come in the page order; cards only for held programs, one line per membership; an unread membership is null', async () => {
    const a = await membershipFor(13);
    const b = await data<LoyaltyMembership>(api.createMembership(owner, { memberId: (await data<LoyaltyMember>(api.createMember(owner, { displayName: 'ZQ42A Second Holder' }), 201)).id, programId: catalog[13].id }), 201);
    const today = await pgDay(0);
    const later = await pgDay(200);
    const soon = await pgDay(20);
    const mk = (body: Record<string, unknown>) => data<LoyaltyInstrument>(api.createInstrument(owner, { membershipId: a.id, kind: 'other', ...body }), 201);
    const nullExpiry = await mk({ description: 'ZQ42A unknown expiry' });
    const expLater = await mk({ description: 'ZQ42A later', expiresOn: later });
    const used = await mk({ description: 'ZQ42A used', issuedOn: today, usedOn: today, expiresOn: soon });
    const expSoon = await mk({ description: 'ZQ42A soon', expiresOn: soon });
    expect((await api.createInstrument(owner, { membershipId: a.id, kind: 'other', description: 'ZQ42A bad', issuedOn: later, expiresOn: today })).status).toBe(400);
    const overview = await data<LoyaltyOverview>(api.overview(owner));
    const mine = overview.instruments.filter((i) => [nullExpiry.id, expLater.id, used.id, expSoon.id].includes(i.id)).map((i) => i.id);
    expect(mine).toEqual([expSoon.id, expLater.id, nullExpiry.id, used.id]);
    const card = overview.cards.filter((c) => c.programId === catalog[13].id);
    expect(card).toHaveLength(1);
    expect(card[0].memberships.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(card[0].memberships.every((x) => x.balance === null && x.unit === null)).toBe(true);
    const unheld = catalog[catalog.length - 1];
    expect(overview.programs.some((p) => p.id === unheld.id)).toBe(true);
    expect(overview.cards.some((c) => c.programId === unheld.id)).toBe(false);
    expect(overview.cards.length).toBeLessThan(overview.programs.length);
    expect(LoyaltyOverviewResponseSchema.safeParse({ success: true, data: overview }).success).toBe(true);
  });

  it('T42a-C9: unknown and malformed ids, unknown references, duplicates (also concurrent) and stray keys are refused cleanly', async () => {
    const missing = 2147480000;
    const notFound = [
      await read(await api.patchMember(owner, missing, { displayName: 'ZQ42A x' })),
      await read(await api.patchProgram(owner, missing, { kind: 'other' })),
      await read(await api.patchMembership(owner, missing, { tier: 'ZQ42A x' })),
      await read(await api.patchInstrument(owner, missing, { description: 'ZQ42A x' })),
      await read(await api.memberNumber(owner, missing)),
      await read(await api.observe(owner, missing, { asOf: await pgDay(0), balance: '1', unit: 'points' })),
    ];
    for (const r of notFound) expect([r.status, r.text]).toEqual([404, notFound[0].text]);
    for (const bad of ['0', '-1', 'abc', '01', '2147483648', '1.5']) {
      expect((await api.patchMembership(owner, bad, { tier: 'ZQ42A x' })).status).toBe(400);
      expect((await api.memberNumber(owner, bad)).status).toBe(400);
    }
    const before = await count('loyalty_memberships');
    const m = await membershipFor(14);
    expect((await api.createMembership(owner, { memberId: missing, programId: catalog[0].id })).status).toBe(400);
    expect((await api.createMembership(owner, { memberId: m.memberId, programId: missing })).status).toBe(400);
    const dup = await read(await api.createMembership(owner, { memberId: m.memberId, programId: m.programId }));
    expect([dup.status, dup.body.error?.code]).toEqual([409, 'MEMBERSHIP_EXISTS']);
    expect(await count('loyalty_memberships')).toBe(before + 1);
    expect((await api.createMember(owner, { displayName: 'ZQ42A x', role: 'admin' })).status).toBe(400);
    expect((await api.observe(owner, m.id, { asOf: await pgDay(0), balance: '1', unit: 'points', note: 'x' })).status).toBe(400);
    expect((await membershipsPOST(req('/api/v1/loyalty/memberships', owner, { method: 'POST', raw: '{not json' }))).status).toBe(400);
    // Two concurrent creates of one pair, ten times: exactly one 201 and one 409, never a 500.
    for (let i = 0; i < 10; i++) {
      const member = await data<LoyaltyMember>(api.createMember(owner, { displayName: `ZQ42A Race ${i}` }), 201);
      const body = { memberId: member.id, programId: catalog[15].id };
      const statuses = (await Promise.all([api.createMembership(owner, body), api.createMembership(two, body)])).map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409]);
    }
  });

  it('T42a-C10: every loyalty route is registered as no-transaction-data and no loyalty source reads the ledger', async () => {
    const dir = join(WEB, 'app/api/v1/loyalty');
    const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith('route.ts')).map((f) => relative(WEB, join(dir, f)).split('\\').join('/'));
    expect(files).toHaveLength(11);
    // P8-42b: the four routes answering with a membership view carry a linked card's fee date (a
    // date derived from a ledger row, the same for every viewer) and are numeric-only.
    const MEMBERSHIP_VIEW_ROUTES = ['app/api/v1/loyalty/route.ts', 'app/api/v1/loyalty/memberships/route.ts',
      'app/api/v1/loyalty/memberships/[id]/route.ts', 'app/api/v1/loyalty/memberships/[id]/observations/route.ts'];
    for (const f of files) expect(ROUTES.find((r) => r.file === f)?.classes).toEqual(MEMBERSHIP_VIEW_ROUTES.includes(f) ? ['numeric-only'] : ['no-transaction-data']);
    const sources = [
      'lib/loyaltyStore.ts', 'lib/domain/loyalty.ts', 'lib/domain/loyaltyImport.ts', 'scripts/import-loyalty.ts',
      'app/travel/page.tsx', ...files, 'app/api/v1/loyalty/loyaltyResponses.ts',
    ];
    for (const f of sources) expect(readFileSync(join(WEB, f), 'utf8'), f).not.toMatch(/\b(FROM|JOIN)\s+transactions\b/i);
  });

  it('T42a-C11: aliases are normalised, unique across programs, replaced atomically, and drive resolution', async () => {
    const counts = await db.query<{ id: number; name: string; kind: string; n: string; own: boolean }>(`
      SELECT p.id, p.name, p.kind, (SELECT count(*) FROM loyalty_program_aliases a WHERE a.program_id = p.id)::text AS n,
             EXISTS (SELECT 1 FROM loyalty_program_aliases a WHERE a.program_id = p.id AND a.alias = lower(p.name)) AS own
        FROM loyalty_programs p WHERE p.name NOT LIKE 'ZQ42A%'`);
    for (const p of counts.rows) {
      expect(Number(p.n), p.name).toBeGreaterThanOrEqual(['airline', 'hotel', 'card_currency'].includes(p.kind) ? 2 : 1);
      expect(p.own, p.name).toBe(true);
      expect(normalizeLabel(p.name)).toBe(p.name.toLowerCase());
    }
    const aliases = await db.query<{ alias: string; program_id: number }>('SELECT alias, program_id FROM loyalty_program_aliases');
    expect(aliases.rows.length).toBeGreaterThanOrEqual(counts.rows.length + 35);
    for (const a of aliases.rows) expect(normalizeLabel(a.alias)).toBe(a.alias);
    const taken = aliases.rows.find((a) => a.program_id === catalog[0].id) as { alias: string };
    expect(await refusal(`INSERT INTO loyalty_program_aliases (program_id, alias) VALUES (${catalog[1].id}, '${taken.alias}')`)).toMatch(/duplicate key/);

    // A program whose normalised name is already an alias: 409, nothing created.
    const programs = await count('loyalty_programs');
    const clash = await read(await api.createProgram(owner, { name: `  ${taken.alias.toUpperCase()} `, kind: 'other', defaultUnit: 'points' }));
    expect([clash.status, clash.body.error?.code]).toEqual([409, 'ALIAS_TAKEN']);
    expect(await count('loyalty_programs')).toBe(programs);
    // A PATCH whose list holds one alias of another program: 409 and the list exactly as it was.
    const prog = await data<LoyaltyProgram>(api.createProgram(owner, { name: 'ZQ42A Alias Air', kind: 'airline', defaultUnit: 'miles' }), 201);
    expect(LoyaltyProgramResponseSchema.safeParse({ success: true, data: prog }).success).toBe(true);
    const half = await read(await api.patchProgram(owner, prog.id, { aliases: ['zq42a fresh one', taken.alias], name: 'ZQ42A Should Not Stick' }));
    expect([half.status, half.body.error?.code]).toEqual([409, 'ALIAS_TAKEN']);
    const unchanged = (await data<LoyaltyOverview>(api.overview(owner))).programs.find((p) => p.id === prog.id);
    expect(unchanged).toEqual(prog);
    expect((await api.patchProgram(owner, prog.id, { aliases: [] })).status).toBe(400);
    expect((await api.patchProgram(owner, prog.id, { aliases: [' ✈ - '] })).status).toBe(400);
    const stored = await data<LoyaltyProgram>(api.patchProgram(owner, prog.id, { aliases: ['  ZQ42A Alias (note) ', 'zq42a alias'] }));
    expect(stored.aliases).toEqual(['zq42a alias']);
    // Resolution follows the stored aliases: the old spelling no longer resolves, the new one does.
    const state = async () => ({
      members: [{ id: 1, displayName: 'ZQ42AAnna' }],
      programs: (await data<LoyaltyOverview>(api.overview(owner))).programs.map((p) => ({ id: p.id, defaultUnit: p.defaultUnit })),
      aliases: (await db.query<{ programId: number; alias: string }>('SELECT program_id AS "programId", alias FROM loyalty_program_aliases')).rows,
      memberships: [], importObservations: [], importInstrumentMemberships: [],
    });
    const plan = (label: string, s: Awaited<ReturnType<typeof state>>) => planImport([{ rowNumber: 1, label, balance: '', bonus: '', availability: '', account: '' }], s, { asOf: '2026-01-15' });
    const s = await state();
    expect(plan('ZQ42A Alias Air ZQ42AAnna', s).refusedRows.program).toEqual([1]);
    expect(plan('ZQ42A Alias ZQ42AAnna', s).writes[0]?.programId).toBe(prog.id);
    expect(LoyaltyMemberResponseSchema.safeParse({ success: true, data: { id: 1, displayName: 'ZQ42A x', userId: null } }).success).toBe(true);
  });
});
