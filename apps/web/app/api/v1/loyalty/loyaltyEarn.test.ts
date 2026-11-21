// P8-42b2 — a linked card's earn description, the estimate derived from its spend, and the comparison
// with the next reading (I1–I10), through the real handlers against a real Postgres.
//
// TIER 2, collected by `vitest.integration.config.mts` (`app/api/v1/**/*.test.ts`) with the
// scratch-database guard in its setup files, like `loyaltyCard.test.ts` beside it. People sign in
// through the real passkey path (`../auth/secondUserTestKit.ts`); bearer tokens are minted with
// `createPersonalToken`. Every handler is called directly with a `NextRequest`.
//
// EVERY FIGURE COMES FROM THE PINNED FIXTURE. `apps/web/lib/fixtures/loyalty-earn-cases.json` is
// fabricated, pinned by a SHA-256 in the spec's command 15, and holds every amount, rate, reading and
// expected figure these tests use. Nothing numeric that could be money is restated here: a test that
// chose its own numbers could agree with a wrong implementation. Each case group is walked into
// `seen` and compared with the group's ids, so a case cannot be silently skipped.
//
// EVERY DATE IS POSTGRES'S. A fixture's `day` is an offset from CURRENT_DATE, written as
// `CURRENT_DATE + n` inside the INSERT or read back with `pgDay(n)`, never from a JS clock.
//
// ONE CARD PER CASE. Each case links its own credit account `zq42b2_<case id>` to its own membership,
// so no case's spend can reach another's estimate.
//
// CLEANUP IS OF THIS SUITE'S OWN ROWS: accounts with ids `zq42b2…` (and their transactions), gifts
// whose merchant starts `ZQ42B2`, budget categories named `ZQ42B2 …`, programs named `ZQ42B2 …`, the
// transfer groups made here, the household and membership tables (which only loyalty code writes;
// the earn rules go with the memberships by cascade), and the auth tables through `resetAuth`.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { createPersonalToken } from '@/lib/authSession';
import { computeCurrentNetWorth } from '@/lib/netWorth';
import {
  LoyaltyMembershipResponseSchema,
  LoyaltyOverviewResponseSchema,
  type LoyaltyMember,
  type LoyaltyMembership,
  type LoyaltyOverview,
} from '@b8/contracts/loyalty';
import { bearer, bootstrapOwner, cookie, enrolSecondUser, resetAuth, type EnrolledUser } from '../auth/secondUserTestKit';
import { GET as overviewGET } from './route';
import { POST as membersPOST } from './members/route';
import { POST as membershipsPOST } from './memberships/route';
import { PATCH as membershipPATCH } from './memberships/[id]/route';
import { POST as observationsPOST } from './memberships/[id]/observations/route';
import { GET as ledgerOverviewGET } from '../overview/route';

const ORIGIN = 'http://localhost:3000';
const LOYALTY_DIR = fileURLToPath(new URL('.', import.meta.url));

// ─── The fixture ───────────────────────────────────────────────────────────────────────────────

type Rule = { kind: string; match: string; rate: string };
type Row = {
  ref?: string; day?: number; amount?: string; name?: string; category?: string | null; account?: string;
  hidden?: boolean; transferGroup?: boolean; merchantName?: string; authorizedDay?: number; heldByGift?: boolean;
};
type Reading = { day: number; balance: string; unit?: string };
type Comparison = {
  fromDay: number; toDay: number; unit: string; estimated: string; actual: string; differencePercent: string | null; worthALook: boolean;
};
interface Fixture {
  defaults: { row: Required<Pick<Row, 'day' | 'amount' | 'name' | 'account' | 'hidden' | 'transferGroup'>> & { category: string };
    reading: Reading; baseRate: string; spendBaselineExpected: string; matchRules: Rule[] };
  configCases: { id: string; baseRate: string; rules: Rule[]; emitted: { baseRate: string; rules: string[] } }[];
  estimateCases: { id: string; baseRate?: string; rules?: Rule[]; noEarn?: boolean; readingUnit?: string; readingBalance?: string; rows: Row[]; expected: string | null }[];
  spendCases: { id: string; setup?: { budgetCategories: { name: string; isIncome: boolean; excludeFromBudget: boolean }[] }; rows: Row[]; expected: string }[];
  matchCases: { id: string; rules?: Rule[]; rulesOrder?: string; rows: Row[]; expected: string }[];
  periodCases: { id: string; readings: Reading[]; programDefaultUnit?: string; baseRate?: string; rows: Row[];
    expected: { amount: string | null; sinceDay?: number; basis?: string; unit?: string } }[];
  comparisonCases: { id: string; baseRate: string; readings: Reading[]; rows: Row[]; expected: Comparison | null; estimateExpected?: string; estimateUnit?: string }[];
  giftCase: { baseRate: string; rules: Rule[]; reading: Reading; rows: Row[]; controlRow: Row & { expected: string };
    steps: { id: string; revealDay: number; expected: string }[]; forbiddenText: string[] };
  contractCases: { rateRefuse: string[]; rateRefuseNonString: unknown[]; merchantMatchRefuse: string[]; lengths: { categoryMax: number; merchantMax: number; rulesMax: number } };
}
const F = JSON.parse(readFileSync(new URL('../../../../lib/fixtures/loyalty-earn-cases.json', import.meta.url), 'utf8')) as Fixture;
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

// ─── Requests ──────────────────────────────────────────────────────────────────────────────────

type Who = EnrolledUser | { bearer: string } | null;
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

function req(path: string, who: Who, init: { method?: string; body?: unknown } = {}): NextRequest {
  const auth = who === null ? {} : 'bearer' in who ? bearer(who.bearer) : cookie(who.token);
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? 'GET',
    headers: { host: 'localhost:3000', 'content-type': 'application/json', ...auth },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

interface Answer { status: number; text: string; body: { success?: boolean; data?: unknown; error?: { code: string; message: string } } }
async function read(response: Response | Promise<Response>): Promise<Answer> {
  const res = await response;
  const text = await res.text();
  let body: Answer['body'] = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, text, body };
}

const api = {
  overview: (who: Who) => overviewGET(req('/api/v1/loyalty', who)),
  createMember: (who: Who, body: unknown) => membersPOST(req('/api/v1/loyalty/members', who, { method: 'POST', body })),
  createMembership: (who: Who, body: unknown) => membershipsPOST(req('/api/v1/loyalty/memberships', who, { method: 'POST', body })),
  patchMembership: (who: Who, id: number, body: unknown) =>
    membershipPATCH(req(`/api/v1/loyalty/memberships/${id}`, who, { method: 'PATCH', body }), ctx(id)),
  addReading: (who: Who, id: number, body: unknown) =>
    observationsPOST(req(`/api/v1/loyalty/memberships/${id}/observations`, who, { method: 'POST', body }), ctx(id)),
};

async function data<T>(response: Response | Promise<Response>, status = 200): Promise<T> {
  const r = await read(response);
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${r.body.error?.code} ${r.body.error?.message}`);
  return r.body.data as T;
}

const pgDay = async (days = 0) => (await db.query<{ d: string }>('SELECT (CURRENT_DATE + $1::int)::text AS d', [days])).rows[0].d;

/** Row checksum of every loyalty table, as `loyaltyCard.test.ts` computes it, extended by the earn rules. */
async function loyaltySum(): Promise<string> {
  const r = await db.query<{ s: string }>(`SELECT md5(
      coalesce((SELECT string_agg(t::text, '|' ORDER BY t.id) FROM household_members t), '') ||
      coalesce((SELECT string_agg(t::text, '|' ORDER BY t.id) FROM loyalty_programs t), '') ||
      coalesce((SELECT string_agg(t::text, '|' ORDER BY t.id) FROM loyalty_program_aliases t), '') ||
      coalesce((SELECT string_agg(t::text, '|' ORDER BY t.id) FROM loyalty_memberships t), '') ||
      coalesce((SELECT string_agg(t::text, '|' ORDER BY t.id) FROM loyalty_observations t), '') ||
      coalesce((SELECT string_agg(t::text, '|' ORDER BY t.id) FROM loyalty_instruments t), '') ||
      coalesce((SELECT string_agg(t::text, '|' ORDER BY t.id) FROM loyalty_earn_rules t), '')) AS s`);
  return r.rows[0].s;
}
const ledgerSum = async () => (await db.query<{ s: string }>(`SELECT md5(
    coalesce((SELECT string_agg(a::text, '|' ORDER BY a.id) FROM accounts a), '') ||
    coalesce((SELECT string_agg(t::text, '|' ORDER BY t.id) FROM transactions t), '') ||
    coalesce((SELECT string_agg(b::text, '|' ORDER BY b.id) FROM budget_categories b), '') ||
    coalesce((SELECT string_agg(g::text, '|' ORDER BY g.id) FROM transfer_groups g), '')) AS s`)).rows[0].s;

/** Run `sql` in a transaction that is always rolled back; resolves to the SQLSTATE it raised. */
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

// ─── The world ─────────────────────────────────────────────────────────────────────────────────

const transferGroups: number[] = [];

async function clearWorld(): Promise<void> {
  await db.query(`DELETE FROM transactions WHERE account_id LIKE 'zq42b2%'`);
  await db.query(`DELETE FROM gifts WHERE merchant LIKE 'ZQ42B2%'`);
  if (transferGroups.length) await db.query('DELETE FROM transfer_groups WHERE id = ANY($1::int[])', [transferGroups.splice(0)]);
  await db.query(`DELETE FROM budget_categories WHERE name LIKE 'ZQ42B2%'`);
  await db.query('TRUNCATE loyalty_instruments, loyalty_observations, loyalty_memberships, household_members RESTART IDENTITY CASCADE');
  await db.query(`DELETE FROM loyalty_programs WHERE name LIKE 'ZQ42B2%'`);
  await db.query(`DELETE FROM accounts WHERE id LIKE 'zq42b2%'`);
}

let owner: EnrolledUser;
let two: EnrolledUser;
let readTok: { bearer: string };
let catalogProgram: number;

beforeAll(async () => {
  await clearWorld();
  await resetAuth();
  owner = await bootstrapOwner();
  two = await enrolSecondUser(owner.token);
  readTok = { bearer: (await createPersonalToken({ label: 'zq42b2 read', scope: 'read', userId: owner.userId })).token };
  catalogProgram = (await db.query<{ id: number }>('SELECT min(id) AS id FROM loyalty_programs')).rows[0].id;
}, 60_000);

afterAll(async () => {
  await clearWorld();
  await resetAuth();
});

let seq = 0;

/** A fabricated credit account with the given id. */
async function account(id: string): Promise<string> {
  await db.query(`INSERT INTO accounts (id, name, type) VALUES ($1, $2, 'credit')`, [id, `ZQ42B2 Card ${id.slice(7)}`]);
  return id;
}

/** A program of its own, for a case whose unit comes from the program's default unit. */
async function programWithUnit(unit: string): Promise<number> {
  seq++;
  return (await db.query<{ id: number }>(
    `INSERT INTO loyalty_programs (name, kind, default_unit) VALUES ($1, 'other', $2) RETURNING id`, [`ZQ42B2 Program ${seq}`, unit]
  )).rows[0].id;
}

/** A fresh member and an unlinked membership on `programId`. */
async function membership(programId = catalogProgram): Promise<LoyaltyMembership> {
  seq++;
  const member = await data<LoyaltyMember>(api.createMember(owner, { displayName: `ZQ42B2 Member ${seq}` }), 201);
  return data<LoyaltyMembership>(api.createMembership(owner, { memberId: member.id, programId }), 201);
}

/** One fabricated ledger row: the fixture's defaults overlaid by `row`, dated by Postgres. Returns its id. */
async function tx(card: string, row: Row): Promise<number> {
  const r = { ...F.defaults.row, ...row };
  seq++;
  const accountId = r.account === 'card' ? card : `${card}_other`;
  if (r.account !== 'card') await db.query(`INSERT INTO accounts (id, name, type) VALUES ($1, 'ZQ42B2 Other Card', 'credit') ON CONFLICT (id) DO NOTHING`, [accountId]);
  let group: number | null = null;
  if (r.transferGroup) {
    group = (await db.query<{ id: number }>('INSERT INTO transfer_groups DEFAULT VALUES RETURNING id')).rows[0].id;
    transferGroups.push(group);
  }
  const inserted = await db.query<{ id: number }>(
    `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, merchant_name, mapped_category,
                               hidden, transfer_group_id, authorized_date)
     VALUES ($1, $2, CURRENT_DATE + $3::int, $4::numeric, $5, $6, $7, $8, $9,
             CASE WHEN $10::int IS NULL THEN NULL ELSE CURRENT_DATE + $10::int END)
     RETURNING id`,
    [`zq42b2-${seq}`, accountId, r.day, r.amount, r.name, r.merchantName ?? null, r.category, r.hidden, group, r.authorizedDay ?? null]
  );
  return inserted.rows[0].id;
}

/** A reading through the observations route, dated `day` from Postgres's today. */
async function reading(id: number, x: Reading): Promise<void> {
  await data(api.addReading(owner, id, { asOf: await pgDay(x.day), balance: x.balance, unit: x.unit ?? 'points' }), 201);
}

interface CaseSetup { baseRate?: string; rules?: Rule[]; noEarn?: boolean; readings: Reading[]; rows: Row[]; programUnit?: string }

/**
 * One case's world: its own card `zq42b2_<key>`, linked to its own membership, the earn description
 * set through the PATCH route (unless the case has none), the readings entered in order through the
 * observations route, and the rows seeded. Returns the membership id and the card.
 */
async function seedCase(key: string, c: CaseSetup): Promise<{ id: number; card: string }> {
  const card = await account(`zq42b2_${key.toLowerCase()}`);
  const m = await membership(c.programUnit === undefined ? catalogProgram : await programWithUnit(c.programUnit));
  const body: Record<string, unknown> = { cardAccountId: card };
  if (!c.noEarn) body.earn = { baseRate: c.baseRate ?? F.defaults.baseRate, rules: c.rules ?? [] };
  await data(api.patchMembership(owner, m.id, body));
  for (const r of c.readings) await reading(m.id, r);
  for (const row of c.rows) await tx(card, row);
  return { id: m.id, card };
}

/** The membership as `who` reads it from the overview, with the raw response text. */
async function viewOf(id: number, who: Who = owner): Promise<{ m: LoyaltyMembership; text: string }> {
  const r = await read(api.overview(who));
  if (r.status !== 200) throw new Error(`overview answered ${r.status}`);
  const found = (r.body.data as LoyaltyOverview).cards.flatMap((c) => c.memberships).filter((x) => x.id === id);
  if (found.length !== 1) throw new Error(`membership ${id} appears ${found.length} times`);
  return { m: found[0], text: r.text };
}
const view = async (id: number, who: Who = owner) => (await viewOf(id, who)).m;
const estimateOf = async (id: number) => (await view(id)).earnEstimate?.amount ?? null;

/** Case ids to the world they built, for the later scenarios that reuse them. */
const built = new Map<string, { id: number; card: string }>();

const NIGHT = { kind: 'free_night', description: 'ZQ42B2 night' } as const;

// ─── Scenarios ─────────────────────────────────────────────────────────────────────────────────

describe('loyalty earn description, estimate and comparison (P8-42b2)', () => {
  it('T42b2-I1: the earn description is stored in order, validated, replaced atomically and cleared', async () => {
    const card = await account('zq42b2_config');
    const m = await membership();
    await data(api.patchMembership(owner, m.id, { cardAccountId: card }));
    const stored = async () => ({
      base: (await db.query<{ b: string | null }>('SELECT earn_base_rate::text AS b FROM loyalty_memberships WHERE id = $1', [m.id])).rows[0].b,
      rules: (await db.query<{ position: number; kind: string; match: string; rate: string }>(
        'SELECT position, match_kind AS kind, match_text AS match, rate::text AS rate FROM loyalty_earn_rules WHERE membership_id = $1 ORDER BY id', [m.id]
      )).rows,
    });

    const seen: string[] = [];
    for (const k of F.configCases) {
      const v = await data<LoyaltyMembership>(api.patchMembership(owner, m.id, { earn: { baseRate: k.baseRate, rules: k.rules } }));
      const want = { baseRate: k.emitted.baseRate, rules: k.rules.map((r, i) => ({ kind: r.kind, match: r.match, rate: k.emitted.rules[i] })) };
      expect(v.earn, k.id).toEqual(want);
      const s = await stored();
      expect(s.base, k.id).toBe(k.emitted.baseRate);
      expect(s.rules.map((r) => ({ kind: r.kind, match: r.match, rate: r.rate })), k.id).toEqual(want.rules);
      const positions = s.rules.map((r) => r.position);
      expect(positions.every((p, i) => i === 0 || p > positions[i - 1]), k.id).toBe(true);
      seen.push(k.id);
    }
    expect(seen).toEqual(ids(F.configCases));

    // Re-submitting K1's rules in reverse order reverses the response order.
    const k1 = F.configCases[0];
    const reversed = await data<LoyaltyMembership>(api.patchMembership(owner, m.id, { earn: { baseRate: k1.baseRate, rules: [...k1.rules].reverse() } }));
    expect(reversed.earn?.rules.map((r) => r.match)).toEqual([...k1.rules].reverse().map((r) => r.match));
    expect((await stored()).rules.map((r) => r.match)).toEqual([...k1.rules].reverse().map((r) => r.match));

    // A body whose third rule is invalid: 400, and nothing changed (atomic).
    const c = F.contractCases;
    const before = await loyaltySum();
    const third = await read(api.patchMembership(owner, m.id, {
      earn: { baseRate: k1.baseRate, rules: [...k1.rules, { kind: 'category', match: 'ZQ42B2 Third', rate: c.rateRefuse[0] }] },
    }));
    expect([third.status, third.body.error?.code]).toEqual([400, 'INVALID_INPUT']);
    expect(await loyaltySum()).toBe(before);

    // Every refused body of U1, through the route: 400, nothing changed, the match text never echoed.
    const ECHO = 'ZQ42B2ECHO';
    const rule = (over: Record<string, unknown> = {}) => ({ kind: 'category', match: 'ZQ42B2 Hotel', rate: k1.baseRate, ...over });
    const earn = (over: Record<string, unknown> = {}) => ({ earn: { baseRate: k1.baseRate, rules: [rule()], ...over } });
    const refused = [
      ...[...c.rateRefuse, ...c.rateRefuseNonString].flatMap((rate) => [earn({ baseRate: rate }), earn({ rules: [rule({ rate })] })]),
      ...c.merchantMatchRefuse.map((match) => earn({ rules: [rule({ kind: 'merchant', match })] })),
      earn({ rules: [rule({ kind: 'merchant', match: `${ECHO}%` })] }),
      earn({ rules: [rule({ match: ECHO.padEnd(c.lengths.categoryMax + 1, 'Z') })] }),
      earn({ rules: [rule({ kind: 'merchant', match: ECHO.padEnd(c.lengths.merchantMax + 1, 'Z') })] }),
      earn({ rules: Array.from({ length: c.lengths.rulesMax + 1 }, (_, i) => rule({ match: `${ECHO} ${i}` })) }),
      earn({ rules: [rule({ match: '   ' })] }), earn({ rules: [rule({ kind: 'mcc', match: ECHO })] }),
      earn({ zq42b2Extra: 1 }), earn({ rules: [rule({ match: ECHO, zq42b2Extra: 1 })] }),
      { earn: {} }, { earn: { rules: [] } }, { earn: { baseRate: k1.baseRate } },
      earn({ rules: [rule({ match: ECHO }), rule({ match: ECHO.toLowerCase() })] }),
      {},
    ];
    for (const body of refused) {
      const r = await read(api.patchMembership(owner, m.id, body));
      expect([r.status, r.body.error?.code], JSON.stringify(body)).toEqual([400, 'INVALID_INPUT']);
      expect(r.text.toLowerCase().includes(ECHO.toLowerCase()), JSON.stringify(body)).toBe(false);
    }
    expect(await loyaltySum()).toBe(before);

    // Clear: no description, no rule rows, a null base rate.
    const cleared = await data<LoyaltyMembership>(api.patchMembership(owner, m.id, { earn: null }));
    expect([cleared.earn, cleared.earnEstimate, cleared.earnComparison]).toEqual([null, null, null]);
    expect(await stored()).toEqual({ base: null, rules: [] });

    // An unlinked membership accepts a description and has no estimate.
    const u = await membership();
    const unlinked = await data<LoyaltyMembership>(api.patchMembership(owner, u.id, { earn: { baseRate: k1.baseRate, rules: k1.rules } }));
    expect(unlinked.earn?.baseRate).toBe(k1.emitted.baseRate);
    expect([unlinked.cardAccountId, unlinked.earnEstimate, unlinked.earnComparison]).toEqual([null, null, null]);

    // The table refuses out-of-range and malformed rows on its own.
    await data(api.patchMembership(owner, m.id, { earn: { baseRate: k1.baseRate, rules: k1.rules } }));
    expect(await sqlState('UPDATE loyalty_memberships SET earn_base_rate = 101 WHERE id = $1', [m.id])).toBe('23514');
    expect(await sqlState('UPDATE loyalty_memberships SET earn_base_rate = -1 WHERE id = $1', [m.id])).toBe('23514');
    const insert = (position: number, kind: string, text: string, rate: string) => sqlState(
      'INSERT INTO loyalty_earn_rules (membership_id, position, match_kind, match_text, rate) VALUES ($1, $2, $3, $4, $5::numeric)',
      [m.id, position, kind, text, rate]
    );
    expect(await insert(9, 'category', 'ZQ42B2 x', '101')).toBe('23514');
    expect(await insert(9, 'category', 'ZQ42B2 x', '-1')).toBe('23514');
    expect(await insert(9, 'mcc', 'ZQ42B2 x', '1')).toBe('23514');
    expect(await insert(9, 'category', '', '1')).toBe('23514');
    expect(await insert(9, 'category', ' ZQ42B2 x', '1')).toBe('23514');
    expect(await insert(9, 'category', 'Z'.repeat(c.lengths.categoryMax + 1), '1')).toBe('23514');
    expect(await insert(1, 'category', 'ZQ42B2 dup', '1')).toBe('23505');
    expect(await insert(9, 'category', 'ZQ42B2 x', '1')).toBe('accepted');

    // A read token cannot write; no session is 401; the create route never takes earn.
    const sum = await loyaltySum();
    const byToken = await read(api.patchMembership(readTok, m.id, { earn: null }));
    expect([byToken.status, byToken.body.error?.code]).toEqual([403, 'INSUFFICIENT_SCOPE']);
    expect((await read(api.patchMembership(null, m.id, { earn: null }))).status).toBe(401);
    expect(await loyaltySum()).toBe(sum);
    const member = await data<LoyaltyMember>(api.createMember(owner, { displayName: 'ZQ42B2 Create Probe' }), 201);
    const create = await read(api.createMembership(owner, { memberId: member.id, programId: catalogProgram, earn: { baseRate: k1.baseRate, rules: [] } }));
    expect([create.status, create.body.error?.code]).toEqual([400, 'INVALID_INPUT']);
  });

  it('T42b2-I2: the estimate is the exact priced sum rounded once, half away from zero, at the unit scale', async () => {
    const seen: string[] = [];
    for (const c of F.estimateCases) {
      const w = await seedCase(c.id, {
        baseRate: c.baseRate, rules: c.rules, noEarn: c.noEarn, rows: c.rows,
        readings: [{ day: F.defaults.reading.day, balance: c.readingBalance ?? F.defaults.reading.balance, unit: c.readingUnit ?? F.defaults.reading.unit }],
      });
      built.set(c.id, w);
      const v = await view(w.id);
      expect(v.earnEstimate?.amount ?? null, `${c.id}: ${(c as { why?: string }).why}`).toBe(c.expected);
      if (c.expected !== null) expect(v.earnEstimate?.unit, c.id).toBe(c.readingUnit ?? F.defaults.reading.unit);
      seen.push(c.id);
    }
    expect(seen).toEqual(ids(F.estimateCases));
  });

  it('T42b2-I3: purchases count, refunds subtract, and payments, transfers, fees, income, loans and rewards do not', async () => {
    const seen: string[] = [];
    for (const c of F.spendCases) {
      for (const b of c.setup?.budgetCategories ?? []) {
        await db.query('INSERT INTO budget_categories (name, annual_budget, is_income, exclude_from_budget) VALUES ($1, 0, $2, $3)', [b.name, b.isIncome, b.excludeFromBudget]);
      }
      const w = await seedCase(c.id, { readings: [F.defaults.reading], rows: [{}, ...c.rows] });
      built.set(c.id, w);
      expect(await estimateOf(w.id), `${c.id}: ${(c as { why?: string }).why}`).toBe(c.expected);
      if (c.setup) await db.query('DELETE FROM budget_categories WHERE name = ANY($1::text[])', [c.setup.budgetCategories.map((b) => b.name)]);
      seen.push(c.id);
    }
    expect(seen).toEqual(ids(F.spendCases));
  });

  it('T42b2-I4: the first matching rule in stored order prices a row; category is exact, merchant is a whole-word literal', async () => {
    const seen: string[] = [];
    for (const c of F.matchCases) {
      const rules = c.rules ?? F.defaults.matchRules;
      const w = await seedCase(c.id, { rules, readings: [F.defaults.reading], rows: c.rows });
      if (c.rulesOrder === 'reversed') {
        await data(api.patchMembership(owner, w.id, { earn: { baseRate: F.defaults.baseRate, rules: [...rules].reverse() } }));
      }
      expect(await estimateOf(w.id), `${c.id}: ${(c as { why?: string }).why}`).toBe(c.expected);
      seen.push(c.id);
    }
    expect(seen).toEqual(ids(F.matchCases));
  });

  it('T42b2-I5: the period starts after the current reading, by posted date, ends today, and falls back to 30 days with no reading', async () => {
    const seen: string[] = [];
    for (const c of F.periodCases) {
      const w = await seedCase(c.id, {
        baseRate: c.baseRate, readings: c.readings, rows: c.rows,
        programUnit: c.readings.length === 0 ? c.programDefaultUnit : undefined,
      });
      built.set(c.id, w);
      const e = (await view(w.id)).earnEstimate;
      const why = `${c.id}: ${(c as { why?: string }).why}`;
      if (c.expected.amount === null) {
        expect(e, why).toBeNull();
      } else {
        expect(e, why).toEqual({
          since: await pgDay(c.expected.sinceDay as number), basis: c.expected.basis,
          unit: c.expected.unit ?? c.readings[c.readings.length - 1]?.unit ?? 'points', amount: c.expected.amount,
        });
      }
      seen.push(c.id);
    }
    expect(seen).toEqual(ids(F.periodCases));
  });

  it('T42b2-I6: the comparison is the latest pair of readings on different dates, its window, and the exact miss rule', async () => {
    const seen: string[] = [];
    for (const c of F.comparisonCases) {
      const w = await seedCase(c.id, { baseRate: c.baseRate, readings: c.readings, rows: c.rows });
      const v = await view(w.id);
      const why = `${c.id}: ${(c as { why?: string }).why}`;
      if (c.expected === null) {
        expect(v.earnComparison, why).toBeNull();
      } else {
        const { fromDay, toDay, ...rest } = c.expected;
        expect(v.earnComparison, why).toEqual({ from: await pgDay(fromDay), to: await pgDay(toDay), ...rest });
      }
      if (c.estimateExpected !== undefined) expect(v.earnEstimate?.amount, why).toBe(c.estimateExpected);
      if (c.estimateUnit !== undefined) expect(v.earnEstimate?.unit, why).toBe(c.estimateUnit);
      seen.push(c.id);
    }
    expect(seen).toEqual(ids(F.comparisonCases));
  });

  it('T42b2-I7: a gift-held row is never spend, for giver, recipient or token, until its reveal date', async () => {
    const g = F.giftCase;
    const held = g.rows.filter((r) => r.heldByGift);
    const w = await seedCase('gift', { baseRate: g.baseRate, rules: g.rules, readings: [g.reading], rows: g.rows.filter((r) => !r.heldByGift) });
    const heldIds: number[] = [];
    for (const r of held) heldIds.push(await tx(w.card, r));
    const { expected: controlExpected, ...controlRow } = g.controlRow;
    const control = await seedCase('gift_control', { baseRate: g.baseRate, rules: g.rules, readings: [g.reading], rows: [{ ...controlRow, account: 'card' }] });
    const gift = (await db.query<{ id: number }>(
      `INSERT INTO gifts (giver_user_id, recipient_user_id, merchant, window_start, window_end, reveal_date, state)
       VALUES ($1, $2, 'ZQ42B2 GIFT', CURRENT_DATE - 10, CURRENT_DATE - 1, CURRENT_DATE + 30, 'matched') RETURNING id`,
      [two.userId, owner.userId]
    )).rows[0].id;
    for (const t of heldIds) {
      await db.query('INSERT INTO gift_transactions (transaction_id, gift_id, prior_mapped_category, prior_rule_applied) VALUES ($1, $2, NULL, FALSE)', [t, gift]);
    }

    const seen: string[] = [];
    for (const step of g.steps) {
      await db.query('UPDATE gifts SET reveal_date = CURRENT_DATE + $1::int WHERE id = $2', [step.revealDay, gift]);
      const texts: string[] = [];
      for (const who of [owner, two, readTok]) {
        const { m, text } = await viewOf(w.id, who);
        expect(m.earnEstimate?.amount, `${step.id}: ${(step as { why?: string }).why}`).toBe(step.expected);
        expect((await view(control.id, who)).earnEstimate?.amount, `${step.id} control`).toBe(controlExpected);
        for (const f of g.forbiddenText) expect(text.includes(f), `${step.id}: the response holds ${f}`).toBe(false);
        texts.push(text);
      }
      expect(new Set(texts).size, `${step.id}: the viewers disagree`).toBe(1);
      seen.push(step.id);
    }
    expect(seen).toEqual(ids(g.steps));
  });

  it('T42b2-I8: nothing derived is stored, the shapes are exact, no spend leaves, and unlinking keeps the description', async () => {
    const e1 = built.get('E1') as { id: number; card: string };
    const e1Row = { ...F.defaults.row, ...F.estimateCases[0].rows[0] };
    const sum = await loyaltySum();
    await data(api.overview(owner));
    await data(api.overview(two));
    expect(await loyaltySum()).toBe(sum);
    // Ledger and readings written and removed elsewhere leave nothing behind in the loyalty tables.
    const other = await seedCase('i8_other', { readings: [], rows: [] });
    const afterSeed = await loyaltySum();
    const extra = await tx(other.card, {});
    await db.query(`INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source) VALUES ($1, CURRENT_DATE, 0, 'points', 'typed')`, [other.id]);
    await data(api.overview(owner));
    await db.query('DELETE FROM transactions WHERE id = $1', [extra]);
    await db.query('DELETE FROM loyalty_observations WHERE membership_id = $1', [other.id]);
    await data(api.overview(owner));
    expect(await loyaltySum()).toBe(afterSeed);

    // Exact key sets.
    const v = await view(e1.id);
    expect(Object.keys(v).sort()).toEqual(['id', 'memberId', 'memberDisplayName', 'programId', 'memberNumberMasked', 'tier', 'balance', 'unit',
      'asOf', 'source', 'cardAccountId', 'cardAccountName', 'benefit', 'feeWatch', 'earn', 'earnEstimate', 'earnComparison'].sort());
    expect(Object.keys(v.earn ?? {}).sort()).toEqual(['baseRate', 'rules']);
    expect(Object.keys(v.earnEstimate ?? {}).sort()).toEqual(['amount', 'basis', 'since', 'unit']);
    const c1 = await view((await seedCase('i8_cmp', { baseRate: F.comparisonCases[0].baseRate, readings: F.comparisonCases[0].readings, rows: F.comparisonCases[0].rows })).id);
    expect(Object.keys(c1.earnComparison ?? {}).sort()).toEqual(['actual', 'differencePercent', 'estimated', 'from', 'to', 'unit', 'worthALook']);
    const m1 = await view((built.get('M1') ?? built.get('E8') ?? e1).id);
    for (const r of m1.earn?.rules ?? []) expect(Object.keys(r).sort()).toEqual(['kind', 'match', 'rate']);
    const overview = await read(api.overview(owner));
    expect(LoyaltyOverviewResponseSchema.safeParse(overview.body).success).toBe(true);
    expect(overview.text.includes(e1Row.amount)).toBe(false);
    expect(overview.text.includes(e1Row.name)).toBe(false);

    // Unlink keeps the description; relinking restores the same estimate.
    const estimate = JSON.stringify(v.earnEstimate);
    const unlinked = await read(api.patchMembership(owner, e1.id, { cardAccountId: null }));
    expect(LoyaltyMembershipResponseSchema.safeParse(unlinked.body).success).toBe(true);
    const u = unlinked.body.data as LoyaltyMembership;
    expect(u.earn).toEqual(v.earn);
    expect([u.earnEstimate, u.earnComparison]).toEqual([null, null]);
    expect((await db.query<{ n: string }>('SELECT count(*)::text AS n FROM loyalty_earn_rules WHERE membership_id = $1', [e1.id])).rows[0].n)
      .toBe(String(v.earn?.rules.length));
    await data(api.patchMembership(owner, e1.id, { cardAccountId: e1.card }));
    expect(JSON.stringify((await view(e1.id)).earnEstimate)).toBe(estimate);

    // Deleting the linked account (no transactions): the description stays, the card and figures go.
    const spare = await account('zq42b2_i8_spare');
    await data(api.patchMembership(owner, e1.id, { cardAccountId: spare }));
    await db.query('DELETE FROM accounts WHERE id = $1', [spare]);
    const after = await view(e1.id);
    expect(after.earn).toEqual(v.earn);
    expect([after.cardAccountId, after.earnEstimate, after.earnComparison]).toEqual([null, null, null]);
    await data(api.patchMembership(owner, e1.id, { cardAccountId: e1.card }));

    // Two b8 users read identical figures.
    const mine = await view(e1.id, owner);
    const theirs = await view(e1.id, two);
    expect(JSON.stringify([theirs.earn, theirs.earnEstimate, theirs.earnComparison])).toBe(JSON.stringify([mine.earn, mine.earnEstimate, mine.earnComparison]));

    // A clear removes every rule row.
    await data(api.patchMembership(owner, e1.id, { earn: null }));
    expect((await db.query<{ n: string }>('SELECT count(*)::text AS n FROM loyalty_earn_rules WHERE membership_id = $1', [e1.id])).rows[0].n).toBe('0');
  });

  it('T42b2-I9: setting, reading and clearing an earn description touch no ledger figure and no fee watch, and add no route', async () => {
    const s9 = F.spendCases.find((c) => c.id === 'S9') as Fixture['spendCases'][number];
    const w = await seedCase('i9', { noEarn: true, readings: [F.defaults.reading], rows: [{}, ...s9.rows] });
    await data(api.patchMembership(owner, w.id, { benefit: NIGHT }));
    const ledger = async () => {
      const body = await (await ledgerOverviewGET(req('/api/v1/overview', owner))).json();
      return JSON.stringify(body, (k, v) => (/(At|Time|time|Ago|age)$/.test(k) ? undefined : v));
    };
    const netBefore = await computeCurrentNetWorth();
    const sumBefore = await ledgerSum();
    const ledgerBefore = await ledger();
    const watchBefore = JSON.stringify((await view(w.id)).feeWatch);
    expect((await view(w.id)).feeWatch?.feeDate).not.toBeNull();

    await data(api.patchMembership(owner, w.id, { earn: { baseRate: F.defaults.baseRate, rules: F.defaults.matchRules } }));
    const set = await view(w.id);
    expect(set.earnEstimate?.amount).toBe(s9.expected);
    expect(JSON.stringify(set.feeWatch)).toBe(watchBefore);
    for (const who of [two, readTok]) expect(JSON.stringify(await view(w.id, who))).toBe(JSON.stringify(set));
    for (const body of [{ earn: null }, { earn: { baseRate: F.defaults.baseRate, rules: [] } }]) {
      const r = await read(api.patchMembership(readTok, w.id, body));
      expect([r.status, r.body.error?.code]).toEqual([403, 'INSUFFICIENT_SCOPE']);
    }
    await data(api.patchMembership(owner, w.id, { earn: null }));
    expect(JSON.stringify((await view(w.id)).feeWatch)).toBe(watchBefore);

    expect(await computeCurrentNetWorth()).toEqual(netBefore);
    expect(await ledgerSum()).toBe(sumBefore);
    expect(await ledger()).toBe(ledgerBefore);
    const routes = (readdirSync(LOYALTY_DIR, { recursive: true }) as string[]).filter((f) => f.endsWith('route.ts'));
    expect(routes).toHaveLength(11);
  });

  it('T42b2-I10: a missing figure is null, never zero, in every gate, and every viewer gets the same body', async () => {
    const e19 = F.estimateCases.find((c) => c.id === 'E19') as Fixture['estimateCases'][number];
    const c13 = F.comparisonCases.find((c) => c.id === 'C13') as Fixture['comparisonCases'][number];
    const p11 = F.periodCases.find((c) => c.id === 'P11') as Fixture['periodCases'][number];
    const spend = [{}];
    const noEarn = await seedCase('i10_noearn', { noEarn: true, readings: [F.defaults.reading], rows: spend });
    const unlinked = await seedCase('i10_unlinked', { readings: [F.defaults.reading], rows: spend });
    await data(api.patchMembership(owner, unlinked.id, { cardAccountId: null }));
    const nights = await seedCase('i10_nights', {
      baseRate: e19.baseRate, rows: e19.rows, readings: [{ day: F.defaults.reading.day, balance: F.defaults.reading.balance, unit: e19.readingUnit }],
    });
    const units = await seedCase('i10_units', { baseRate: c13.baseRate, readings: c13.readings, rows: c13.rows });
    const nightsProgram = await seedCase('i10_program', { readings: [], rows: p11.rows, programUnit: p11.programDefaultUnit });

    const checks: [string, number, (m: LoyaltyMembership) => void][] = [
      ['linked, no description', noEarn.id, (m) => { expect(m.earn).toBeNull(); expect([m.earnEstimate, m.earnComparison]).toEqual([null, null]); }],
      ['described, not linked', unlinked.id, (m) => { expect(m.earn).not.toBeNull(); expect([m.earnEstimate, m.earnComparison]).toEqual([null, null]); }],
      ['nights reading', nights.id, (m) => expect([m.earnEstimate, m.earnComparison]).toEqual([null, null])],
      ['two units', units.id, (m) => {
        expect(m.earnComparison).toBeNull();
        expect(m.earnEstimate?.unit).toBe(c13.estimateUnit);
        expect(m.earnEstimate?.amount).toBe(c13.estimateExpected);
      }],
      ['nights program, no reading', nightsProgram.id, (m) => expect([m.earnEstimate, m.earnComparison]).toEqual([null, null])],
    ];
    for (const [label, id, assert] of checks) {
      const bodies: string[] = [];
      for (const who of [owner, two, readTok]) {
        const m = await view(id, who);
        assert(m);
        bodies.push(JSON.stringify(m));
      }
      expect(new Set(bodies).size, `${label}: the viewers disagree`).toBe(1);
    }
  });
});
