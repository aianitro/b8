// P8-42d — who needs a screenshot (the thirteen I1 scenarios): the panel's `screenshotDue`, through the real
// `GET /api/v1/loyalty` handler, `loadReadOverview` and Postgres, against fabricated `ZQ42D` worlds.
//
// TIER 2, collected by `vitest.integration.config.mts` with the scratch-database guard in its setup
// files, like the other loyalty suites beside it. People sign in through the real passkey path
// (`../auth/secondUserTestKit.ts`); every handler is called directly with a `NextRequest`.
//
// IT IMPORTS ONLY MODULES THAT EXISTED BEFORE P8-42d, so the same file runs against the panel code as
// it was (SPEC.md command 17, Part A), where every scenario must fail on an assertion. That is why each
// scenario first asserts that `screenshotDue` is a list, and why each "not due" case is paired with a
// due control seeded beside it: an absent field or an empty list can never pass a "not due" check.
//
// EVERY DAY IS POSTGRES'S. Ages are written as `CURRENT_DATE - n` by the seeding SQL; T is the
// contract's `LOYALTY_INBOX_SILENCE_DAYS`, read from the contract, never restated. Balances are small
// whole numbers written here; member numbers carry letters.
//
// CLEANUP IS OF THIS SUITE'S OWN ROWS: the reads rows, observations, memberships and sender domains of
// `ZQ42D …` programs, the programs and members themselves, and the auth tables through `resetAuth`.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { loadReadOverview } from '@/lib/loyaltyInboxRead';
import { LOYALTY_INBOX_SILENCE_DAYS as T, LoyaltyOverviewResponseSchema } from '@b8/contracts/loyalty';
import { bootstrapOwner, cookie, enrolSecondUser, ORIGIN, resetAuth, type EnrolledUser } from '../auth/secondUserTestKit';
import { GET as overviewGET } from './route';

// ─── The fabricated world ──────────────────────────────────────────────────────────────────────

let seq = 0;
const next = () => ++seq;
const key = (tag: string) => createHash('sha256').update(`zq42d-due-${tag}-${next()}`).digest('hex');

async function clearWorld(): Promise<void> {
  const ours = `SELECT id FROM loyalty_programs WHERE name LIKE 'ZQ42D%'`;
  await db.query(`DELETE FROM loyalty_inbox_reads WHERE program_id IN (${ours})`);
  await db.query(`DELETE FROM loyalty_observations WHERE membership_id IN (SELECT id FROM loyalty_memberships WHERE program_id IN (${ours}))`);
  await db.query(`DELETE FROM loyalty_memberships WHERE program_id IN (${ours})`);
  await db.query(`DELETE FROM loyalty_sender_domains WHERE program_id IN (${ours})`);
  await db.query(`DELETE FROM loyalty_programs WHERE name LIKE 'ZQ42D%'`);
  await db.query(`DELETE FROM household_members WHERE display_name LIKE 'ZQ42D%'`);
}

/** A program with one sender domain per entry of `seen` (days since last seen; null = never). */
async function program(seen: (number | null)[] = []): Promise<number> {
  const n = next();
  const id = (await db.query<{ id: number }>(
    `INSERT INTO loyalty_programs (name, kind, default_unit) VALUES ($1, 'airline', 'points') RETURNING id`, [`ZQ42D Due Air ${n}`]
  )).rows[0].id;
  for (const [i, days] of seen.entries()) {
    await db.query(
      `INSERT INTO loyalty_sender_domains (program_id, domain, last_seen_on)
       VALUES ($1, $2, CASE WHEN $3::int IS NULL THEN NULL ELSE CURRENT_DATE - $3::int END)`,
      [id, `zq42d-due-${n}-${i}.test`, days]
    );
  }
  return id;
}

/** A membership of `programId`, held by its own fabricated member. */
async function membership(programId: number): Promise<number> {
  const member = (await db.query<{ id: number }>('INSERT INTO household_members (display_name) VALUES ($1) RETURNING id', [`ZQ42D Due Holder ${next()}`])).rows[0].id;
  return (await db.query<{ id: number }>(
    `INSERT INTO loyalty_memberships (member_id, program_id, member_number) VALUES ($1, $2, $3) RETURNING id`, [member, programId, `ZQ42D-DUE-${next()}K`]
  )).rows[0].id;
}

/** An observation `age` days old (negative: in the future). Returns its id. */
async function observe(membershipId: number, age: number): Promise<number> {
  return (await db.query<{ id: number }>(
    `INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source) VALUES ($1, CURRENT_DATE - $2::int, 12, 'points', 'typed') RETURNING id`,
    [membershipId, age]
  )).rows[0].id;
}

/** Coverage `yes`: an `applied` reads row carrying a balance, tied to the membership's newest observation. */
async function coverYes(programId: number, membershipId: number): Promise<void> {
  const o = (await db.query<{ id: number }>('SELECT id FROM loyalty_observations WHERE membership_id = $1 ORDER BY id DESC LIMIT 1', [membershipId])).rows[0];
  await db.query(
    `INSERT INTO loyalty_inbox_reads (dedupe_key, program_id, received_on, state, attempts, suffix, balance, unit, as_of, program_check,
                                      membership_id, observation_id, read_on, resolved_on)
     SELECT $1, $2, CURRENT_DATE - 1, 'applied', 1, 'ZQK', o.balance, o.unit, o.as_of, 'match', $3, o.id, CURRENT_DATE, CURRENT_DATE
       FROM loyalty_observations o WHERE o.id = $4`,
    [key('yes'), programId, membershipId, o.id]
  );
}

/** Coverage `no`: the newest settled read carried no balance. */
async function coverNo(programId: number): Promise<void> {
  await db.query(
    `INSERT INTO loyalty_inbox_reads (dedupe_key, program_id, received_on, state, attempts, program_check, read_on, resolved_on)
     VALUES ($1, $2, CURRENT_DATE - 1, 'no_balance', 1, 'not_stated', CURRENT_DATE, CURRENT_DATE)`,
    [key('no'), programId]
  );
}

// ─── Reading the panel ─────────────────────────────────────────────────────────────────────────

let owner: EnrolledUser;
let two: EnrolledUser;

type Overview = { inboxRead: { screenshotDue: unknown; coverage: { programId: number; balanceInLastStatement: string }[] }; cards: { memberships: { id: number }[] }[] };
async function overviewAs(who: EnrolledUser): Promise<{ status: number; body: { success: boolean; data: Overview }; text: string }> {
  const res = await overviewGET(new NextRequest(`${ORIGIN}/api/v1/loyalty`, { headers: { host: 'localhost:3000', ...cookie(who.token) } }));
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text), text };
}

/** The due list from the real route, after asserting that it is a list of ids. */
async function due(who: EnrolledUser = owner): Promise<number[]> {
  const r = await overviewAs(who);
  expect(r.status).toBe(200);
  const list = r.body.data.inboxRead.screenshotDue;
  expect(Array.isArray(list), 'screenshotDue is a list').toBe(true);
  return list as number[];
}

beforeAll(async () => {
  await clearWorld();
  await resetAuth();
  owner = await bootstrapOwner();
  two = await enrolSecondUser(owner.token);
}, 60_000);
beforeEach(clearWorld);
afterEach(async () => {
  vi.restoreAllMocks();
  await clearWorld();
});
afterAll(async () => {
  await clearWorld();
  await resetAuth();
});

// ─── Scenarios ─────────────────────────────────────────────────────────────────────────────────

describe('who needs a screenshot (P8-42d, D3)', () => {
  it('T42d-I1.1: no sender domain and a current reading one day past T is due', async () => {
    const p = await program();
    const m = await membership(p);
    await observe(m, T + 1);
    expect(await due()).toContain(m);
  });

  it('T42d-I1.2: no sender domain and a reading exactly T days old is not due', async () => {
    const p = await program();
    const m = await membership(p);
    await observe(m, T);
    const control = await membership(p);
    await observe(control, T + 1);
    const list = await due();
    expect(list).toContain(control);
    expect(list).not.toContain(m);
  });

  it('T42d-I1.3: no sender domain and no reading at all is due', async () => {
    const p = await program();
    const m = await membership(p);
    expect(await due()).toContain(m);
  });

  it('T42d-I1.4: a program the inbox is bringing balances for is never prompted, however old the reading', async () => {
    const p = await program([3]);
    const m = await membership(p);
    await observe(m, 200);
    await coverYes(p, m);
    const quiet = await program();
    const control = await membership(quiet);
    await observe(control, 200);
    const list = await due();
    expect(list).toContain(control);
    expect(list).not.toContain(m);
  });

  it('T42d-I1.5: coverage yes but the mail last seen one day past T is due', async () => {
    const p = await program([T + 1]);
    const m = await membership(p);
    await observe(m, 100);
    await coverYes(p, m);
    expect(await due()).toContain(m);
  });

  it('T42d-I1.6: coverage yes and the mail last seen exactly T days ago is still bringing balances', async () => {
    const p = await program([T]);
    const m = await membership(p);
    await observe(m, 100);
    await coverYes(p, m);
    const q = await program([T + 1]);
    const control = await membership(q);
    await observe(control, 100);
    await coverYes(q, control);
    const list = await due();
    expect(list).toContain(control);
    expect(list).not.toContain(m);
  });

  it('T42d-I1.7: coverage no (the newest statement had no balance) with a reading past T is due', async () => {
    const p = await program([3]);
    const m = await membership(p);
    await observe(m, T + 1);
    await coverNo(p);
    const r = await overviewAs(owner);
    expect(r.body.data.inboxRead.coverage.find((c) => c.programId === p)?.balanceInLastStatement).toBe('no');
    expect(await due()).toContain(m);
  });

  it('T42d-I1.8: coverage no with a recent reading is not due', async () => {
    const p = await program([3]);
    const m = await membership(p);
    await observe(m, 10);
    const control = await membership(p);
    await observe(control, T + 1);
    await coverNo(p);
    const list = await due();
    expect(list).toContain(control);
    expect(list).not.toContain(m);
  });

  it('T42d-I1.9: coverage not_read (nothing read yet) with a reading past T is due', async () => {
    const p = await program([3]);
    const m = await membership(p);
    await observe(m, T + 1);
    const r = await overviewAs(owner);
    expect(r.body.data.inboxRead.coverage.find((c) => c.programId === p)?.balanceInLastStatement).toBe('not_read');
    expect(await due()).toContain(m);
  });

  it('T42d-I1.10: coverage yes with no last-seen date is not "recent", so an old reading is due', async () => {
    const p = await program([null]);
    const m = await membership(p);
    await observe(m, 100);
    await coverYes(p, m);
    expect(await due()).toContain(m);
  });

  it('T42d-I1.11: the rule is per membership: of two in one program only the old one is due', async () => {
    const p = await program();
    const old = await membership(p);
    await observe(old, T + 1);
    const fresh = await membership(p);
    await observe(fresh, 3);
    const list = await due();
    expect(list).toContain(old);
    expect(list).not.toContain(fresh);
  });

  it('T42d-I1.12: a program with three sender domains lists its due membership once', async () => {
    const p = await program([T + 1, T + 2, null]);
    const m = await membership(p);
    await observe(m, T + 1);
    const list = await due();
    expect(list.filter((id) => id === m)).toHaveLength(1);
  });

  it('T42d-I1.13: one ascending list, agreeing with the coverage beside it, the same for both users, from one snapshot that reads no ledger row', async () => {
    // A whole world: [age of the current reading (null = none), program kind of inbox].
    type Kind = 'none' | 'yes-recent' | 'yes-quiet' | 'no' | 'not_read';
    const cases: { kind: Kind; age: number | null }[] = [
      { kind: 'none', age: T + 1 }, { kind: 'none', age: T }, { kind: 'none', age: null }, { kind: 'none', age: -1 },
      { kind: 'yes-recent', age: 200 }, { kind: 'yes-quiet', age: 100 }, { kind: 'no', age: T + 1 }, { kind: 'no', age: 10 },
      { kind: 'not_read', age: T + 1 },
    ];
    const seeded: { id: number; programId: number; kind: Kind; age: number | null }[] = [];
    for (const c of cases) {
      const p = await program(c.kind === 'none' ? [] : [c.kind === 'yes-quiet' ? T + 1 : 3]);
      const m = await membership(p);
      if (c.age !== null) await observe(m, c.age);
      if (c.kind === 'yes-recent' || c.kind === 'yes-quiet') await coverYes(p, m);
      if (c.kind === 'no') await coverNo(p);
      seeded.push({ id: m, programId: p, ...c });
    }
    // An older reading recorded LATER does not become current: the reducer's current is the newest
    // as-of, so a recent membership stays not due (last-row-wins would make it due).
    const recent = seeded[7].id;
    await observe(recent, T + 30);

    // The panel's statements, captured on the one client it checks out.
    const seen: string[] = [];
    const realConnect = db.connect.bind(db);
    vi.spyOn(db, 'connect').mockImplementation((async () => {
      const client = await realConnect();
      return new Proxy(client, {
        get(target, prop) {
          if (prop === 'query') return (text: string, values?: unknown[]) => { seen.push(text); return target.query(text, values); };
          const v = Reflect.get(target, prop, target);
          return typeof v === 'function' ? v.bind(target) : v;
        },
      }) as PoolClient;
    }) as unknown as typeof db.connect);
    const panel = await loadReadOverview();
    vi.restoreAllMocks();
    expect(seen.join('\n')).not.toMatch(/\b(FROM|JOIN)\s+(transactions|accounts|account_valuations)\b/i);
    const fromPanel = (panel as { screenshotDue?: unknown }).screenshotDue;
    expect(Array.isArray(fromPanel)).toBe(true);

    const [a, b] = [await overviewAs(owner), await overviewAs(two)];
    for (const r of [a, b]) {
      expect(r.status).toBe(200);
      expect(LoyaltyOverviewResponseSchema.safeParse(r.body).success).toBe(true);
    }
    const list = a.body.data.inboxRead.screenshotDue as number[];
    expect(b.body.data.inboxRead.screenshotDue).toEqual(list);
    expect(fromPanel).toEqual(list);
    expect(list.every((id, i) => i === 0 || list[i - 1] < id)).toBe(true);
    const shown = new Set(a.body.data.cards.flatMap((c) => c.memberships.map((m) => m.id)));
    for (const id of list) expect(shown.has(id), `due id ${id} is a membership`).toBe(true);

    // Each decision follows from the coverage shown in the same response and the seeded ages.
    const coverage = new Map(a.body.data.inboxRead.coverage.map((c) => [c.programId, c.balanceInLastStatement]));
    for (const s of seeded) {
      const bringing = s.kind === 'yes-recent' && coverage.get(s.programId) === 'yes';
      if (s.kind === 'yes-recent' || s.kind === 'yes-quiet') expect(coverage.get(s.programId)).toBe('yes');
      if (s.kind === 'no') expect(coverage.get(s.programId)).toBe('no');
      if (s.kind === 'not_read') expect(coverage.get(s.programId)).toBe('not_read');
      if (s.kind === 'none') expect(coverage.has(s.programId)).toBe(false);
      const expected = !bringing && (s.age === null || s.age > T);
      expect(list.includes(s.id), `${s.kind} aged ${s.age}`).toBe(expected);
    }
    // Tomorrow's reading is current and not due; the old reading recorded last did not displace a recent one.
    expect(list).not.toContain(seeded[3].id);
    expect(list).not.toContain(recent);
  });
});
