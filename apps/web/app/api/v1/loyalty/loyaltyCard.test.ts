// P8-42b — a credit card linked to its loyalty membership, its annual fee found in the ledger, and
// the state of the benefit that fee should bring (I1–I10), through the real handlers against a real
// Postgres.
//
// TIER 2, collected by `vitest.integration.config.mts` (`app/api/v1/**/*.test.ts`) with the
// scratch-database guard in its setup files, like `loyalty.test.ts` beside it. People sign in
// through the real passkey path (`../auth/secondUserTestKit.ts`); bearer tokens are minted with
// `createPersonalToken`. Every handler is called directly with a `NextRequest`.
//
// EVERY DATE IS POSTGRES'S. A fixture's date is written as `CURRENT_DATE + n` inside the INSERT, and
// every expected date is read back with `pgDay(n)`, never from a JS clock — the state depends on
// CURRENT_DATE and nothing else.
//
// THE FEE AMOUNTS ARE FABRICATED, chosen once per test and distinct within it, so a test can search a
// response for one and know that a hit is a leak. They live only in this file.
//
// CLEANUP IS OF THIS SUITE'S OWN ROWS: accounts with ids `zq42b…` (and their transactions), gifts
// whose merchant starts `ZQ42B`, the transfer groups made here, the household and membership tables
// (which only loyalty code writes), and the auth tables through `resetAuth`. Every name carries
// `ZQ42B`.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { createPersonalToken } from '@/lib/authSession';
import { computeCurrentNetWorth } from '@/lib/netWorth';
import {
  LoyaltyMembershipResponseSchema,
  LoyaltyOverviewResponseSchema,
  type LoyaltyFeeWatch,
  type LoyaltyMember,
  type LoyaltyMembership,
  type LoyaltyOverview,
} from '@b8/contracts/loyalty';
import { bearer, bootstrapOwner, cookie, enrolSecondUser, resetAuth, type EnrolledUser } from '../auth/secondUserTestKit';
import { GET as overviewGET } from './route';
import { POST as membersPOST } from './members/route';
import { POST as membershipsPOST } from './memberships/route';
import { PATCH as membershipPATCH } from './memberships/[id]/route';
import { POST as instrumentsPOST } from './instruments/route';
import { GET as ledgerOverviewGET } from '../overview/route';

const ORIGIN = 'http://localhost:3000';
const LOYALTY_DIR = fileURLToPath(new URL('.', import.meta.url));

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
const holds = (text: string, needle: string) => text.toLowerCase().includes(needle.toLowerCase());

const api = {
  overview: (who: Who) => overviewGET(req('/api/v1/loyalty', who)),
  createMember: (who: Who, body: unknown) => membersPOST(req('/api/v1/loyalty/members', who, { method: 'POST', body })),
  createMembership: (who: Who, body: unknown) => membershipsPOST(req('/api/v1/loyalty/memberships', who, { method: 'POST', body })),
  patchMembership: (who: Who, id: number, body: unknown) =>
    membershipPATCH(req(`/api/v1/loyalty/memberships/${id}`, who, { method: 'PATCH', body }), ctx(id)),
  createInstrument: (who: Who, body: unknown) => instrumentsPOST(req('/api/v1/loyalty/instruments', who, { method: 'POST', body })),
};

async function data<T>(response: Response | Promise<Response>, status = 200): Promise<T> {
  const r = await read(response);
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${r.body.error?.code}`);
  return r.body.data as T;
}

const pgDay = async (days = 0) => (await db.query<{ d: string }>('SELECT (CURRENT_DATE + $1::int)::text AS d', [days])).rows[0].d;

/** Row checksum of every loyalty table, as `loyalty.test.ts` computes it. */
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
const instrumentSum = async () =>
  (await db.query<{ s: string }>(`SELECT md5(coalesce((SELECT string_agg(t::text, '|' ORDER BY t.id) FROM loyalty_instruments t), '')) AS s`)).rows[0].s;
const ledgerSum = async () => (await db.query<{ s: string }>(`SELECT md5(
    coalesce((SELECT string_agg(a::text, '|' ORDER BY a.id) FROM accounts a), '') ||
    coalesce((SELECT string_agg(t::text, '|' ORDER BY t.id) FROM transactions t), '')) AS s`)).rows[0].s;

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
  await db.query(`DELETE FROM transactions WHERE account_id LIKE 'zq42b%'`);
  await db.query(`DELETE FROM gifts WHERE merchant LIKE 'ZQ42B%'`);
  if (transferGroups.length) await db.query('DELETE FROM transfer_groups WHERE id = ANY($1::int[])', [transferGroups.splice(0)]);
  await db.query('TRUNCATE loyalty_instruments, loyalty_observations, loyalty_memberships, household_members RESTART IDENTITY CASCADE');
  await db.query(`DELETE FROM accounts WHERE id LIKE 'zq42b%'`);
}

let owner: EnrolledUser;
let two: EnrolledUser;
let readTok: { bearer: string };
let fullTok: { bearer: string };
let programId: number;

beforeAll(async () => {
  await clearWorld();
  await resetAuth();
  owner = await bootstrapOwner();
  two = await enrolSecondUser(owner.token);
  readTok = { bearer: (await createPersonalToken({ label: 'zq42b read', scope: 'read', userId: owner.userId })).token };
  fullTok = { bearer: (await createPersonalToken({ label: 'zq42b full', scope: 'full', userId: owner.userId })).token };
  programId = (await db.query<{ id: number }>('SELECT min(id) AS id FROM loyalty_programs')).rows[0].id;
}, 60_000);

afterAll(async () => {
  await clearWorld();
  await resetAuth();
});

let seq = 0;

/** A fabricated account. `feed` gives it an access token, as a Plaid-linked card has. */
async function account(type = 'credit', opts: { feed?: boolean; name?: string } = {}): Promise<string> {
  seq++;
  const id = `zq42b_${type}_${seq}`;
  await db.query(
    `INSERT INTO accounts (id, name, type, access_token) VALUES ($1, $2, $3, $4)`,
    [id, opts.name ?? `ZQ42B ${type} ${String(seq).padStart(3, '0')}`, type, opts.feed ? `zq42b-token-${seq}` : null]
  );
  return id;
}

/** A fresh member and a membership on the first catalog program, unlinked and with no benefit. */
async function membership(): Promise<LoyaltyMembership> {
  seq++;
  const member = await data<LoyaltyMember>(api.createMember(owner, { displayName: `ZQ42B Member ${seq}` }), 201);
  return data<LoyaltyMembership>(api.createMembership(owner, { memberId: member.id, programId }), 201);
}

const NIGHT = { kind: 'free_night', description: 'ZQ42B night' } as const;

/** A membership linked to `card` (a new credit card when absent) with `benefit` set, through the PATCH route. */
async function linked(benefit: Record<string, unknown> | null = NIGHT, card?: string): Promise<{ m: LoyaltyMembership; card: string }> {
  const c = card ?? await account('credit');
  const m = await membership();
  const body: Record<string, unknown> = { cardAccountId: c };
  if (benefit !== null) body.benefit = benefit;
  return { m: await data<LoyaltyMembership>(api.patchMembership(owner, m.id, body)), card: c };
}

interface Tx {
  days: number; amount: string; name: string | null;
  merchant?: string; detailed?: string | null; hidden?: boolean; transfer?: boolean; authorizedDays?: number;
}

/** One fabricated ledger row on `accountId`, dated `CURRENT_DATE + days` by Postgres. Returns its id. */
async function tx(accountId: string, t: Tx): Promise<number> {
  seq++;
  let group: number | null = null;
  if (t.transfer) {
    group = (await db.query<{ id: number }>('INSERT INTO transfer_groups DEFAULT VALUES RETURNING id')).rows[0].id;
    transferGroups.push(group);
  }
  const r = await db.query<{ id: number }>(
    `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, merchant_name,
                               plaid_category_detailed, hidden, transfer_group_id, authorized_date)
     VALUES ($1, $2, CURRENT_DATE + $3::int, $4::numeric, $5, $6, $7, $8, $9,
             CASE WHEN $10::int IS NULL THEN NULL ELSE CURRENT_DATE + $10::int END)
     RETURNING id`,
    [`zq42b-${seq}`, accountId, t.days, t.amount, t.name, t.merchant ?? null, t.detailed ?? null, t.hidden ?? false, group,
      t.authorizedDays ?? null]
  );
  return r.rows[0].id;
}

/** An instrument on `membershipId`, with `created_at` at midday of `CURRENT_DATE + createdDays`. */
async function instrument(membershipId: number, kind: string, o: { issued?: number | null; used?: number; createdDays?: number } = {}): Promise<void> {
  await db.query(
    `INSERT INTO loyalty_instruments (membership_id, kind, description, issued_on, used_on, source, created_at)
     VALUES ($1, $2, 'ZQ42B instrument',
             CASE WHEN $3::int IS NULL THEN NULL ELSE CURRENT_DATE + $3::int END,
             CASE WHEN $4::int IS NULL THEN NULL ELSE CURRENT_DATE + $4::int END,
             'typed', (CURRENT_DATE + $5::int)::timestamp + interval '12 hours')`,
    [membershipId, kind, o.issued ?? null, o.used ?? null, o.createdDays ?? 0]
  );
}

/** The membership as `who` reads it from the overview. */
async function viewOf(id: number, who: Who = owner): Promise<LoyaltyMembership> {
  const overview = await data<LoyaltyOverview>(api.overview(who));
  const found = overview.cards.flatMap((c) => c.memberships).filter((x) => x.id === id);
  if (found.length !== 1) throw new Error(`membership ${id} appears ${found.length} times`);
  return found[0];
}
const watchOf = async (id: number, who: Who = owner): Promise<LoyaltyFeeWatch | null> => (await viewOf(id, who)).feeWatch;

const FEE = 'ZQ42B ANNUAL MEMBERSHIP FEE';

// ─── Scenarios ─────────────────────────────────────────────────────────────────────────────────

describe('loyalty card link, annual fee and benefit state (P8-42b)', () => {
  it('T42b-I1: only a credit card links, one card per membership, re-link and move work, unlink keeps the benefit, read tokens cannot write', async () => {
    const plaidCard = await account('credit', { feed: true, name: 'ZQ42B Card B' });
    const handCard = await account('credit', { name: 'ZQ42B Card A' });
    const others = [await account('depository'), await account('investment'), await account('loan')];
    const a = await membership();
    const b = await membership();
    const column = async (id: number) => (await db.query<{ c: string | null }>('SELECT card_account_id AS c FROM loyalty_memberships WHERE id = $1', [id])).rows[0].c;

    for (const card of [plaidCard, handCard]) {
      const view = await data<LoyaltyMembership>(api.patchMembership(owner, a.id, { cardAccountId: card }));
      expect([view.cardAccountId, view.cardAccountName]).toEqual([card, card === plaidCard ? 'ZQ42B Card B' : 'ZQ42B Card A']);
      expect(await column(a.id)).toBe(card);
    }
    // Non-credit and unknown accounts: 400, nothing changed.
    for (const card of [...others, 'zq42b_no_such_account']) {
      const sum = await loyaltySum();
      const r = await read(api.patchMembership(owner, b.id, { cardAccountId: card }));
      expect([r.status, r.body.error?.code]).toEqual([400, 'INVALID_INPUT']);
      expect(await column(b.id)).toBeNull();
      expect(await loyaltySum()).toBe(sum);
    }
    // One card, one membership: the route says 409 and the index says 23505.
    const taken = await read(api.patchMembership(owner, b.id, { cardAccountId: handCard }));
    expect([taken.status, taken.body.error?.code]).toEqual([409, 'CARD_ALREADY_LINKED']);
    expect(await column(a.id)).toBe(handCard);
    expect(await column(b.id)).toBeNull();
    expect(await sqlState('UPDATE loyalty_memberships SET card_account_id = $1 WHERE id = $2', [handCard, b.id])).toBe('23505');
    // Concurrent links of one card: one 200, one 409, never a 500.
    const free = await account('credit');
    const c = await membership();
    const statuses = (await Promise.all([
      api.patchMembership(owner, b.id, { cardAccountId: free }), api.patchMembership(two, c.id, { cardAccountId: free }),
    ])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    await data(api.patchMembership(owner, b.id, { cardAccountId: null }));
    await data(api.patchMembership(owner, c.id, { cardAccountId: null }));
    // Idempotent re-link; a move frees the old card.
    expect((await data<LoyaltyMembership>(api.patchMembership(owner, a.id, { cardAccountId: handCard }))).cardAccountId).toBe(handCard);
    await data(api.patchMembership(owner, a.id, { cardAccountId: plaidCard }));
    expect((await data<LoyaltyMembership>(api.patchMembership(owner, b.id, { cardAccountId: handCard }))).cardAccountId).toBe(handCard);
    // Unlink: card and fee watch null, benefit untouched.
    await data(api.patchMembership(owner, a.id, { benefit: NIGHT }));
    const unlinked = await data<LoyaltyMembership>(api.patchMembership(owner, a.id, { cardAccountId: null }));
    expect([unlinked.cardAccountId, unlinked.cardAccountName, unlinked.feeWatch]).toEqual([null, null, null]);
    expect(unlinked.benefit).toEqual({ ...NIGHT, windowDays: 45 });
    // The picker: exactly the credit accounts, by name then id.
    const overview = await data<LoyaltyOverview>(api.overview(owner));
    const credit = (await db.query<{ id: string }>(`SELECT id FROM accounts WHERE type = 'credit' ORDER BY name, id`)).rows.map((r) => r.id);
    expect(overview.cardAccounts.map((x) => x.id)).toEqual(credit);
    expect(credit).toEqual(expect.arrayContaining([plaidCard, handCard, free]));
    for (const o of others) expect(overview.cardAccounts.some((x) => x.id === o)).toBe(false);
    expect(overview.cardAccounts.findIndex((x) => x.id === handCard)).toBeLessThan(overview.cardAccounts.findIndex((x) => x.id === plaidCard));
    // A read token cannot link; no session is 401.
    const sum = await loyaltySum();
    const refused = await read(api.patchMembership(readTok, a.id, { cardAccountId: plaidCard }));
    expect([refused.status, refused.body.error?.code]).toEqual([403, 'INSUFFICIENT_SCOPE']);
    const anonymous = await read(api.patchMembership(null, a.id, { cardAccountId: plaidCard }));
    expect(anonymous.status).toBe(401);
    expect(await loyaltySum()).toBe(sum);
  });

  it('T42b-I2: the benefit is stored trimmed with the default window, validated by the route and by the table, and never echoed', async () => {
    const { m } = await linked(null);
    const cols = async () => (await db.query<{ k: string | null; d: string | null; w: number | null }>(
      'SELECT benefit_kind AS k, benefit_description AS d, benefit_window_days AS w FROM loyalty_memberships WHERE id = $1', [m.id]
    )).rows[0];
    const set = await data<LoyaltyMembership>(api.patchMembership(owner, m.id, { benefit: { kind: 'free_night', description: '  ZQ42B night  ' } }));
    expect(set.benefit).toEqual({ kind: 'free_night', description: 'ZQ42B night', windowDays: 45 });
    expect(await cols()).toEqual({ k: 'free_night', d: 'ZQ42B night', w: 45 });
    await data(api.patchMembership(owner, m.id, { benefit: { kind: 'companion_fare', description: 'ZQ42B fare', windowDays: 10 } }));
    expect(await cols()).toEqual({ k: 'companion_fare', d: 'ZQ42B fare', w: 10 });
    const cleared = await data<LoyaltyMembership>(api.patchMembership(owner, m.id, { benefit: null }));
    expect(cleared.benefit).toBeNull();
    expect(await cols()).toEqual({ k: null, d: null, w: null });
    // On an unlinked membership: accepted, no fee watch.
    const u = await membership();
    const onUnlinked = await data<LoyaltyMembership>(api.patchMembership(owner, u.id, { benefit: NIGHT }));
    expect([onUnlinked.benefit?.windowDays, onUnlinked.feeWatch]).toEqual([45, null]);
    // Every invalid body of U1, through the route: 400 and nothing changed. The description echo
    // canary must not come back in any error body.
    const ECHO = 'ZQ42BECHO';
    await data(api.patchMembership(owner, m.id, { benefit: NIGHT }));
    const before = await loyaltySum();
    for (const body of [
      { cardAccountId: '' }, { cardAccountId: 7 }, { cardAccountId: { id: 'x' } },
      { benefit: { ...NIGHT, windowDays: 0 } }, { benefit: { ...NIGHT, windowDays: 366 } }, { benefit: { ...NIGHT, windowDays: 1.5 } },
      { benefit: { ...NIGHT, windowDays: -1 } }, { benefit: { ...NIGHT, windowDays: '30' } },
      { benefit: { kind: 'points_deposit', description: ECHO } }, { benefit: { kind: 'free_night', description: '   ' } },
      { benefit: { kind: 'free_night', description: ECHO.padEnd(201, 'Z') } }, { benefit: { kind: 'free_night', description: ECHO, zq42b: 1 } },
      { benefit: NIGHT, zq42bExtra: 1 }, {},
    ]) {
      const r = await read(api.patchMembership(owner, m.id, body));
      expect([r.status, r.body.error?.code], JSON.stringify(body)).toEqual([400, 'INVALID_INPUT']);
      expect(holds(r.text, ECHO)).toBe(false);
    }
    expect(await loyaltySum()).toBe(before);
    // The table refuses a half-described or out-of-range benefit on its own.
    const update = (sets: string) => sqlState(`UPDATE loyalty_memberships SET ${sets} WHERE id = $1`, [m.id]);
    expect(await update(`benefit_kind = 'free_night', benefit_description = NULL`)).toBe('23514');
    expect(await update(`benefit_kind = NULL, benefit_description = NULL`)).toBe('23514');
    expect(await update('benefit_window_days = 0')).toBe('23514');
    expect(await update('benefit_window_days = 366')).toBe('23514');
    expect(await update(`benefit_kind = 'points_deposit'`)).toBe('23514');
    expect(await update(`benefit_description = repeat('Z', 201)`)).toBe('23514');
    expect(await update(`benefit_description = ' ZQ42B night'`)).toBe('23514');
    expect(await update('benefit_window_days = 30')).toBe('accepted');
  });

  it('T42b-I3: the fee is found by name, whole words, money out, on this card, outside transfers — never by category or merchant', async () => {
    const tenAgo = await pgDay(-10);
    const amount = '93.17';
    const cases: { label: string; detected: boolean; rows: (card: string) => Promise<unknown> }[] = [
      { label: 'a', detected: true, rows: (c) => tx(c, { days: -10, amount, name: FEE, detailed: 'BANK_FEES_OTHER_BANK_FEES' }) },
      { label: 'c', detected: true, rows: (c) => tx(c, { days: -10, amount, name: 'zq42b Annual Fee' }) },
      { label: 'd', detected: true, rows: (c) => tx(c, { days: -10, amount, name: 'zq42b Annual Fee', hidden: true }) },
      { label: 'e', detected: true, rows: (c) => tx(c, { days: -10, amount, name: 'ZQ42B  ANNUAL   MEMBERSHIP FEE' }) },
      { label: 'f', detected: true, rows: (c) => tx(c, { days: -10, amount, name: `${FEE} 00123` }) },
      { label: 'g', detected: false, rows: (c) => tx(c, { days: -10, amount, name: 'ZQ42B LATE FEE', detailed: 'BANK_FEES_LATE_PAYMENT' }) },
      { label: 'h', detected: false, rows: (c) => tx(c, { days: -10, amount, name: 'ZQ42B PURCHASE INTEREST CHARGE', detailed: 'BANK_FEES_INTEREST_CHARGES' }) },
      { label: 'i', detected: false, rows: (c) => tx(c, { days: -10, amount, name: 'ZQ42B FOREIGN TRANSACTION FEE', detailed: 'BANK_FEES_OTHER_BANK_FEES' }) },
      { label: 'j', detected: false, rows: (c) => tx(c, { days: -10, amount: '-93.17', name: FEE }) },
      { label: 'k', detected: false, rows: (c) => tx(c, { days: -10, amount: '0.00', name: FEE }) },
      { label: 'l', detected: false, rows: async () => tx(await account('credit'), { days: -10, amount, name: FEE }) },
      { label: 'm', detected: false, rows: (c) => tx(c, { days: -10, amount, name: FEE, transfer: true }) },
      { label: 'n', detected: false, rows: (c) => tx(c, { days: -10, amount, name: 'ZQ42B BIANNUAL FEE' }) },
      { label: 'n2', detected: false, rows: (c) => tx(c, { days: -10, amount, name: 'ZQ42B ANNUAL FEES' }) },
      { label: 'o', detected: false, rows: (c) => tx(c, { days: -10, amount, name: 'ZQ42B POS 0001', merchant: FEE }) },
    ];
    for (const k of cases) {
      const { m, card } = await linked();
      await k.rows(card);
      const w = await watchOf(m.id);
      expect(w, k.label).toEqual(k.detected
        ? { feeDate: tenAgo, expectedBy: await pgDay(35), state: 'awaiting' }
        : { feeDate: null, expectedBy: null, state: 'no_fee_seen' });
    }
    // (b) A card with no Plaid feed, a null category and a null plaid_raw.
    const hand = await account('credit');
    expect((await db.query<{ a: string | null }>('SELECT access_token AS a FROM accounts WHERE id = $1', [hand])).rows[0].a).toBeNull();
    const { m } = await linked(NIGHT, hand);
    const id = await tx(hand, { days: -10, amount, name: FEE, detailed: null });
    expect((await db.query<{ n: boolean }>('SELECT plaid_raw IS NULL AND plaid_category IS NULL AS n FROM transactions WHERE id = $1', [id])).rows[0].n).toBe(true);
    expect((await watchOf(m.id))?.feeDate).toBe(tenAgo);
  });

  it('T42b-I4: the most recent fee by posted date wins, never by insertion order or the authorized date, and a membership is listed once', async () => {
    const { m, card } = await linked();
    await tx(card, { days: -20, amount: '71.40', name: FEE });
    await tx(card, { days: -400, amount: '71.40', name: FEE });
    expect((await watchOf(m.id))?.feeDate).toBe(await pgDay(-20));

    const auth = await linked();
    await tx(auth.card, { days: -20, amount: '71.41', name: FEE, authorizedDays: -23 });
    expect(await watchOf(auth.m.id)).toEqual({ feeDate: await pgDay(-20), expectedBy: await pgDay(25), state: 'awaiting' });

    const tie = await linked();
    await tx(tie.card, { days: -20, amount: '71.42', name: FEE });
    await tx(tie.card, { days: -20, amount: '71.43', name: FEE });
    const overview = await data<LoyaltyOverview>(api.overview(owner));
    expect(overview.cards.flatMap((c) => c.memberships).filter((x) => x.id === tie.m.id)).toHaveLength(1);
    expect((await watchOf(tie.m.id))?.feeDate).toBe(await pgDay(-20));

    // The same memberships, in the same order, with the card linked and unlinked.
    const order = async () => (await data<LoyaltyOverview>(api.overview(owner))).cards.flatMap((c) => c.memberships.map((x) => x.id));
    const linkedOrder = await order();
    for (const x of [m, auth.m, tie.m]) await data(api.patchMembership(owner, x.id, { cardAccountId: null }));
    expect(await order()).toEqual(linkedOrder);
  });

  it('T42b-I5: an exact, later, refund-named credit on the same card cancels one fee; payments, other amounts and other cards cancel nothing', async () => {
    const fee = '88.26';
    const twenty = await pgDay(-20);
    const cancelled = [`${FEE} REFUND`, 'ZQ42B STATEMENT REFUND'];
    for (const name of cancelled) {
      const { m, card } = await linked();
      await tx(card, { days: -20, amount: fee, name: FEE });
      await tx(card, { days: -10, amount: `-${fee}`, name });
      expect(await watchOf(m.id), name).toEqual({ feeDate: null, expectedBy: null, state: 'no_fee_seen' });
    }
    const standing: { label: string; credit: (card: string) => Promise<unknown> }[] = [
      { label: 'payment', credit: (c) => tx(c, { days: -10, amount: `-${fee}`, name: 'ZQ42B PAYMENT THANK YOU' }) },
      { label: 'other amount', credit: (c) => tx(c, { days: -10, amount: '-88.25', name: `${FEE} REFUND` }) },
      { label: 'before the fee', credit: (c) => tx(c, { days: -25, amount: `-${fee}`, name: `${FEE} REFUND` }) },
      { label: 'other card', credit: async () => tx(await account('credit'), { days: -10, amount: `-${fee}`, name: `${FEE} REFUND` }) },
    ];
    for (const s of standing) {
      const { m, card } = await linked();
      await tx(card, { days: -20, amount: fee, name: FEE });
      await s.credit(card);
      expect((await watchOf(m.id))?.feeDate, s.label).toBe(twenty);
    }
    // Pairing: one refund, two equal fees. Dated after both, it cancels the latest; the older fee is
    // not resurrected. Dated between them, it cancels the older and the latest stands.
    const late = await linked();
    await tx(late.card, { days: -400, amount: fee, name: FEE });
    await tx(late.card, { days: -20, amount: fee, name: FEE });
    await tx(late.card, { days: -10, amount: `-${fee}`, name: `${FEE} REFUND` });
    expect(await watchOf(late.m.id)).toEqual({ feeDate: null, expectedBy: null, state: 'no_fee_seen' });
    const mid = await linked();
    await tx(mid.card, { days: -400, amount: fee, name: FEE });
    await tx(mid.card, { days: -20, amount: fee, name: FEE });
    await tx(mid.card, { days: -100, amount: `-${fee}`, name: `${FEE} REFUND` });
    expect((await watchOf(mid.m.id))?.feeDate).toBe(twenty);
  });

  it('T42b-I6: the four states at their boundaries, by Postgres dates; no benefit means no state; no card means no watch', async () => {
    const watch = async (feeDays: number | null, benefit: Record<string, unknown> | null = NIGHT) => {
      const { m, card } = await linked(benefit);
      if (feeDays !== null) await tx(card, { days: feeDays, amount: '64.09', name: FEE });
      return { m, card, w: await watchOf(m.id) };
    };
    expect((await watch(null)).w).toEqual({ feeDate: null, expectedBy: null, state: 'no_fee_seen' });
    expect((await watch(-10)).w).toEqual({ feeDate: await pgDay(-10), expectedBy: await pgDay(35), state: 'awaiting' });
    expect((await watch(-45)).w).toEqual({ feeDate: await pgDay(-45), expectedBy: await pgDay(0), state: 'awaiting' });
    expect((await watch(-46)).w).toEqual({ feeDate: await pgDay(-46), expectedBy: await pgDay(-1), state: 'overdue' });
    expect((await watch(0)).w).toEqual({ feeDate: await pgDay(0), expectedBy: await pgDay(45), state: 'awaiting' });
    const ten = { ...NIGHT, windowDays: 10 };
    expect((await watch(-10, ten)).w).toEqual({ feeDate: await pgDay(-10), expectedBy: await pgDay(0), state: 'awaiting' });
    expect((await watch(-11, ten)).w).toEqual({ feeDate: await pgDay(-11), expectedBy: await pgDay(-1), state: 'overdue' });
    const got = await watch(-100);
    await instrument(got.m.id, 'free_night', { issued: -90 });
    expect(await watchOf(got.m.id)).toEqual({ feeDate: await pgDay(-100), expectedBy: await pgDay(-55), state: 'received' });
    expect((await watch(-10, null)).w).toEqual({ feeDate: await pgDay(-10), expectedBy: null, state: null });
    expect((await watch(null, null)).w).toEqual({ feeDate: null, expectedBy: null, state: null });
    const u = await membership();
    expect((await data<LoyaltyMembership>(api.patchMembership(owner, u.id, { benefit: NIGHT }))).feeWatch).toBeNull();
  });

  it('T42b-I7: only an instrument of the benefit kind, on this membership, dated on or after the fee closes the expectation', async () => {
    const { m, card } = await linked();
    const other = await linked();
    await tx(card, { days: -30, amount: '52.80', name: FEE });
    const awaiting = { feeDate: await pgDay(-30), expectedBy: await pgDay(15), state: 'awaiting' };
    const received = { ...awaiting, state: 'received' };
    const reset = () => db.query('DELETE FROM loyalty_instruments WHERE membership_id = ANY($1::int[])', [[m.id, other.m.id]]);
    const after = async (place: () => Promise<unknown>) => { await reset(); await place(); return watchOf(m.id); };

    expect(await watchOf(m.id)).toEqual(awaiting);
    expect(await after(() => instrument(m.id, 'travel_credit', { issued: -5 }))).toEqual(awaiting);
    expect(await after(() => instrument(other.m.id, 'free_night', { issued: -5 }))).toEqual(awaiting);
    expect(await after(() => instrument(m.id, 'free_night', { issued: -31 }))).toEqual(awaiting);
    expect(await after(() => instrument(m.id, 'free_night', { issued: null, createdDays: -31 }))).toEqual(awaiting);
    expect(await after(() => instrument(m.id, 'free_night', { issued: -31, createdDays: 0 }))).toEqual(awaiting);

    expect(await after(() => instrument(m.id, 'free_night', { issued: -30 }))).toEqual(received);
    expect(await after(() => instrument(m.id, 'free_night', { issued: null, createdDays: -30 }))).toEqual(received);
    expect(await after(() => instrument(m.id, 'free_night', { issued: null, createdDays: 0 }))).toEqual(received);
    expect(await after(() => instrument(m.id, 'free_night', { issued: -20, used: -2 }))).toEqual(received);
    expect(await after(() => instrument(m.id, 'free_night', { issued: 20 }))).toEqual(received);
    // Through the instruments route as well, with no dates: recorded today, so received.
    await reset();
    await data(api.createInstrument(owner, { membershipId: m.id, kind: 'free_night', description: 'ZQ42B typed night' }), 201);
    expect(await watchOf(m.id)).toEqual(received);
    // Two matching instruments: still one line, still received.
    await instrument(m.id, 'free_night', { issued: -1 });
    expect(await watchOf(m.id)).toEqual(received);
    // Kind `other` closes only on `other`.
    await reset();
    await data(api.patchMembership(owner, m.id, { benefit: { kind: 'other', description: 'ZQ42B other', windowDays: 45 } }));
    expect(await after(() => instrument(m.id, 'free_night', { issued: -1 }))).toEqual(awaiting);
    expect(await after(() => instrument(m.id, 'other', { issued: -1 }))).toEqual(received);
  });

  it('T42b-I8: a fee row held by an unrevealed gift is no fee for anyone — giver, recipient or token — until the reveal date', async () => {
    const { m, card } = await linked();
    const control = await linked();
    const name = 'ZQ42B ANNUAL MEMBERSHIP FEE HELD';
    const held = await tx(card, { days: -5, amount: '47.31', name });
    await tx(control.card, { days: -5, amount: '47.32', name: 'zq42b control Annual Fee' });
    const gift = (await db.query<{ id: number }>(
      `INSERT INTO gifts (giver_user_id, recipient_user_id, merchant, window_start, window_end, reveal_date, state)
       VALUES ($1, $2, 'ZQ42B GIFT', CURRENT_DATE - 10, CURRENT_DATE - 1, CURRENT_DATE + 30, 'matched') RETURNING id`,
      [two.userId, owner.userId]
    )).rows[0].id;
    await db.query('INSERT INTO gift_transactions (transaction_id, gift_id, prior_mapped_category, prior_rule_applied) VALUES ($1, $2, NULL, FALSE)', [held, gift]);
    const viewers: Who[] = [owner, two, fullTok, readTok];
    const fiveAgo = await pgDay(-5);
    const controlWatch = { feeDate: fiveAgo, expectedBy: await pgDay(40), state: 'awaiting' };

    for (const [reveal, isHeld] of [[30, true], [1, true], [0, false], [-1, false]] as const) {
      await db.query('UPDATE gifts SET reveal_date = CURRENT_DATE + $1::int WHERE id = $2', [reveal, gift]);
      const texts: string[] = [];
      for (const who of viewers) {
        const r = await read(api.overview(who));
        expect(r.status).toBe(200);
        texts.push(r.text);
        const ms = (r.body.data as LoyaltyOverview).cards.flatMap((c) => c.memberships);
        const w = ms.find((x) => x.id === m.id)?.feeWatch;
        expect(w, `reveal ${reveal}`).toEqual(isHeld ? { feeDate: null, expectedBy: null, state: 'no_fee_seen' } : controlWatch);
        expect(ms.find((x) => x.id === control.m.id)?.feeWatch).toEqual(controlWatch);
        expect(holds(r.text, name)).toBe(false);
        expect(holds(r.text, 'ZQ42B ANNUAL')).toBe(false);
        expect(r.text.includes('47.31')).toBe(false);
      }
      expect(new Set(texts).size, `reveal ${reveal}: viewers disagree`).toBe(1);
      // The single-membership view (the PATCH answer) agrees with the overview, as the giver too.
      const patched = await data<LoyaltyMembership>(api.patchMembership(two, m.id, { tier: `ZQ42B tier ${reveal}` }));
      expect(patched.feeWatch?.state).toBe(isHeld ? 'no_fee_seen' : 'awaiting');
    }
  });

  it('T42b-I9: nothing is stored, the shapes are exact, no amount or name is emitted, and unlink or account delete keeps instruments and benefit', async () => {
    const { m, card } = await linked();
    await tx(card, { days: -46, amount: '39.57', name: FEE });
    await instrument(m.id, 'travel_credit', { issued: -1 });
    expect((await watchOf(m.id))?.state).toBe('overdue');
    const sum = await loyaltySum();
    await data(api.overview(owner));
    await data(api.overview(two));
    expect(await loyaltySum()).toBe(sum);
    const extra = await tx(card, { days: -2, amount: '39.58', name: FEE });
    expect((await watchOf(m.id))?.state).toBe('awaiting');
    await db.query('DELETE FROM transactions WHERE id = $1', [extra]);
    expect((await watchOf(m.id))?.state).toBe('overdue');
    expect(await loyaltySum()).toBe(sum);

    const view = await viewOf(m.id);
    expect(Object.keys(view).sort()).toEqual(['id', 'memberId', 'memberDisplayName', 'programId', 'memberNumberMasked', 'tier', 'balance', 'unit',
      'asOf', 'source', 'cardAccountId', 'cardAccountName', 'benefit', 'feeWatch'].sort());
    expect(Object.keys(view.feeWatch ?? {}).sort()).toEqual(['expectedBy', 'feeDate', 'state']);
    expect(Object.keys(view.benefit ?? {}).sort()).toEqual(['description', 'kind', 'windowDays']);
    const overview = await read(api.overview(owner));
    expect(LoyaltyOverviewResponseSchema.safeParse(overview.body).success).toBe(true);
    expect(overview.text.includes('39.57')).toBe(false);
    expect(holds(overview.text, FEE)).toBe(false);

    const instruments = await instrumentSum();
    const unlinked = await read(api.patchMembership(owner, m.id, { cardAccountId: null }));
    expect(LoyaltyMembershipResponseSchema.safeParse(unlinked.body).success).toBe(true);
    expect(await instrumentSum()).toBe(instruments);
    expect((unlinked.body.data as LoyaltyMembership).benefit).toEqual({ ...NIGHT, windowDays: 45 });

    // Deleting a linked account with no transactions: the membership, instruments and benefit stay.
    const spare = await account('credit');
    await data(api.patchMembership(owner, m.id, { cardAccountId: spare }));
    await db.query('DELETE FROM accounts WHERE id = $1', [spare]);
    const after = await viewOf(m.id);
    expect([after.cardAccountId, after.cardAccountName, after.feeWatch]).toEqual([null, null, null]);
    expect(after.benefit).toEqual({ ...NIGHT, windowDays: 45 });
    expect(await instrumentSum()).toBe(instruments);
  });

  it('T42b-I10: linking, describing and unlinking change no ledger figure, answer every viewer alike, and add no route', async () => {
    const card = await account('credit', { feed: true });
    await tx(card, { days: -12, amount: '58.64', name: FEE });
    const m = await membership();
    const ledger = async () => {
      const body = await (await ledgerOverviewGET(req('/api/v1/overview', owner))).json();
      return JSON.stringify(body, (k, v) => (/(At|Time|time|Ago|age)$/.test(k) ? undefined : v));
    };
    const netBefore = await computeCurrentNetWorth();
    const sumBefore = await ledgerSum();
    const ledgerBefore = await ledger();

    await data(api.patchMembership(owner, m.id, { cardAccountId: card }));
    await data(api.patchMembership(two, m.id, { benefit: NIGHT }));
    const mine = await watchOf(m.id, owner);
    expect(mine).toEqual({ feeDate: await pgDay(-12), expectedBy: await pgDay(33), state: 'awaiting' });
    for (const who of [two, readTok, fullTok]) expect(JSON.stringify(await watchOf(m.id, who))).toBe(JSON.stringify(mine));
    for (const body of [{ cardAccountId: null }, { benefit: null }, { benefit: NIGHT }, { cardAccountId: card }]) {
      const r = await read(api.patchMembership(readTok, m.id, body));
      expect([r.status, r.body.error?.code]).toEqual([403, 'INSUFFICIENT_SCOPE']);
    }
    await data(api.patchMembership(owner, m.id, { cardAccountId: null }));

    expect(await computeCurrentNetWorth()).toEqual(netBefore);
    expect(await ledgerSum()).toBe(sumBefore);
    expect(await ledger()).toBe(ledgerBefore);
    const routes = (readdirSync(LOYALTY_DIR, { recursive: true }) as string[]).filter((f) => f.endsWith('route.ts'));
    expect(routes).toHaveLength(11);
  });
});
