// The loyalty import against a real Postgres (P8-42a, scenarios I1–I11).
//
// TIER 2, under `vitest.integration.config.mts` with the scratch-database guard in `setupFiles`,
// named in that config's `include` by exact path (the `rekey-plaid-ids.test.ts` precedent). The
// script's `main` runs with the real `lib/db`, the real file reader and the committed fixtures;
// only `out` and `err` are captured, which is every line the script can print.
//
// THE FIXTURES are `scripts/fixtures/loyalty-import.*`: a seed of three members and six programs
// with their aliases, the good sheet in the owner's shape, and three bad copies that differ from it
// in the named rows only. Everything in them is fabricated and carries `ZQ42A`.
//
// CLEANUP IS OF THIS SUITE'S OWN ROWS: the household and membership tables, which only loyalty code
// writes, and the programs named `ZQ42A…` (their aliases go with them by the cascade).

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '@/lib/db';
import { membershipView } from '@/lib/loyaltyStore';
import { defaultDeps, isEntryPoint, main } from './import-loyalty';
import { Pool } from 'pg';
import type { ImportDb } from './import-loyalty';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIX = join(HERE, 'fixtures');
const GOOD = join(FIX, 'loyalty-import.fixture.csv');
const BAD_PROGRAM = join(FIX, 'loyalty-import.bad-program.csv');
const BAD_VALUE = join(FIX, 'loyalty-import.bad-value.csv');
const BAD_DUPLICATE = join(FIX, 'loyalty-import.bad-duplicate.csv');
const SEED = readFileSync(join(FIX, 'loyalty-import.seed.sql'), 'utf8');
const LINE = /^[a-z_]+=([0-9]+(,[0-9]+)*|dry-run|apply)?$/;
const AS_OF = '2026-01-15';

async function reset(): Promise<void> {
  await db.query('TRUNCATE loyalty_instruments, loyalty_observations, loyalty_memberships, household_members RESTART IDENTITY CASCADE');
  await db.query(`DELETE FROM loyalty_programs WHERE name LIKE 'ZQ42A%'`);
  await db.query(SEED);
}

beforeEach(reset);
afterAll(async () => {
  await db.query('TRUNCATE loyalty_instruments, loyalty_observations, loyalty_memberships, household_members RESTART IDENTITY CASCADE');
  await db.query(`DELETE FROM loyalty_programs WHERE name LIKE 'ZQ42A%'`);
});

/** One run of the script's `main`, with everything it prints captured. */
async function run(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const { exitCode } = await main(argv, {}, { ...defaultDeps, out: (l) => out.push(l), err: (l) => err.push(l) });
  return { exitCode, out, err, values: Object.fromEntries(out.map((l) => l.split('='))) as Record<string, string> };
}
const good = (...extra: string[]) => run('--file', GOOD, '--as-of', AS_OF, '--default-member', 'zq42aanna', ...extra);

const n = async (sql: string) => Number((await db.query<{ n: string }>(`SELECT (${sql})::text AS n`)).rows[0].n);
const counts = async () => [
  await n('SELECT count(*) FROM loyalty_memberships'),
  await n('SELECT count(*) FROM loyalty_observations'),
  await n('SELECT count(*) FROM loyalty_instruments'),
];
const structure = async () => [
  await n('SELECT count(*) FROM household_members'),
  await n('SELECT count(*) FROM loyalty_programs'),
  await n('SELECT count(*) FROM loyalty_program_aliases'),
];
async function checksum(tables: string[]): Promise<string> {
  const parts = tables.map((t) => `coalesce((SELECT string_agg(x::text, '|' ORDER BY x::text) FROM ${t} x), '')`);
  return (await db.query<{ s: string }>(`SELECT md5(${parts.join(' || ')}) AS s`)).rows[0].s;
}
const LOYALTY = ['loyalty_memberships', 'loyalty_observations', 'loyalty_instruments'];

/** Member and program ids of the seed, by name. */
async function ids() {
  const m = await db.query<{ id: number; display_name: string }>('SELECT id, display_name FROM household_members');
  const p = await db.query<{ id: number; name: string }>(`SELECT id, name FROM loyalty_programs WHERE name LIKE 'ZQ42A%'`);
  return {
    member: Object.fromEntries(m.rows.map((r) => [r.display_name, r.id])) as Record<string, number>,
    program: Object.fromEntries(p.rows.map((r) => [r.name, r.id])) as Record<string, number>,
  };
}

const GOOD_COUNTS = {
  rows: '12', memberships_existing: '0', observations_existing: '0', observations_skipped_empty: '5',
  instruments_existing: '0', bonus_unplaced: '2', refused_program: '0', refused_member: '0', refused_value: '0',
  refused_duplicate: '0', conflicts: '0', refused_rows_program: '', refused_rows_member: '', refused_rows_value: '',
  refused_rows_duplicate: '', refused_rows_conflict: '',
};

/** Every run of four or more digits in a fixture, separators removed: the figures that must not print. */
function figuresIn(file: string): string[] {
  const text = readFileSync(file, 'utf8').replace(/(\d),(\d)/g, '$1$2');
  return [...new Set(text.match(/\d{4,}(\.\d+)?/g) ?? [])];
}

describe('the loyalty import (P8-42a)', () => {
  it('T42a-I1: a dry run writes nothing and prints the 20 count lines', async () => {
    const struct = await structure();
    const r = await good();
    expect(r.exitCode).toBe(0);
    expect(await counts()).toEqual([0, 0, 0]);
    expect(await structure()).toEqual(struct);
    expect(r.out).toHaveLength(20);
    for (const l of r.out) expect(l).toMatch(LINE);
    expect(r.out[0]).toBe('mode=dry-run');
    expect(r.values).toEqual({ mode: 'dry-run', ...GOOD_COUNTS, memberships_created: '12', observations_created: '7', instruments_created: '3' });
    expect(r.err).toEqual([]);
  });

  it('T42a-I2: --apply creates exactly the expected memberships, readings and instruments', async () => {
    const struct = await structure();
    const r = await good('--apply');
    expect(r.exitCode).toBe(0);
    expect(r.values).toEqual({ mode: 'apply', ...GOOD_COUNTS, memberships_created: '12', observations_created: '7', instruments_created: '3' });
    expect(await counts()).toEqual([12, 7, 3]);
    expect(await structure()).toEqual(struct);
    const obs = await db.query<{ label: string; balance: string; unit: string; source: string; as_of: string }>(`
      SELECT p.name || '/' || hm.display_name AS label, o.balance::text AS balance, o.unit, o.source, o.as_of::text AS as_of
        FROM loyalty_observations o JOIN loyalty_memberships m ON m.id = o.membership_id
        JOIN loyalty_programs p ON p.id = m.program_id JOIN household_members hm ON hm.id = m.member_id
       ORDER BY 1`);
    expect(obs.rows.every((o) => o.source === 'import' && o.as_of === AS_OF)).toBe(true);
    expect(obs.rows.map((o) => [o.label, o.balance, o.unit])).toEqual([
      ['ZQ42A Carbrand Rewards/ZQ42AAnna', '7733', 'points'],
      ['ZQ42A Cardpay Points/ZQ42AAnna', '90210', 'points'],
      ['ZQ42A Skybrand Air/ZQ42AAnna', '16488', 'miles'],
      ['ZQ42A Skybrand Air/ZQ42ABob', '31207', 'miles'],
      ['ZQ42A Stayco Hotels/ZQ42AAnna', '55012', 'points'],
      ['ZQ42A Tripcash/ZQ42AAnna', '48.17', 'usd'],
      ['ZQ42A Tripcash/ZQ42ABob', '2031.50', 'usd'],
    ]);
    const inst = await db.query<{ kind: string; description: string; source: string; d: string | null }>(
      'SELECT kind, description, source, coalesce(issued_on, expires_on, used_on)::text AS d FROM loyalty_instruments ORDER BY description');
    expect(inst.rows).toEqual([
      { kind: 'other', description: 'ZQ42A 1 companion ticket', source: 'import', d: null },
      { kind: 'other', description: 'ZQ42A 1 night', source: 'import', d: null },
      { kind: 'other', description: 'ZQ42A 5000 points', source: 'import', d: null },
    ]);
    expect(await n('SELECT count(*) FROM loyalty_memberships m WHERE NOT EXISTS (SELECT 1 FROM loyalty_observations o WHERE o.membership_id = m.id)')).toBe(5);
    expect(await n('SELECT count(*) FROM loyalty_observations WHERE balance = 0')).toBe(0);
    expect(await n(`SELECT count(*) FROM loyalty_memberships WHERE member_number LIKE 'ZQ42A-%'`)).toBe(10);
    expect(await n('SELECT count(*) FROM loyalty_memberships WHERE member_number IS NULL')).toBe(2);
    expect(await n('SELECT count(*) FROM loyalty_memberships WHERE tier IS NOT NULL OR card_account_id IS NOT NULL')).toBe(0);
  });

  it('T42a-I3: a second --apply creates nothing and changes nothing; a third after a typed reading changes nothing else', async () => {
    await good('--apply');
    const sum = await checksum(LOYALTY);
    const again = await good('--apply');
    expect(again.exitCode).toBe(0);
    expect(again.values).toMatchObject({
      memberships_created: '0', memberships_existing: '12', observations_created: '0', observations_existing: '7',
      instruments_created: '0', instruments_existing: '3', bonus_unplaced: '2', conflicts: '0',
    });
    expect(await checksum(LOYALTY)).toBe(sum);
    const m = (await db.query<{ id: number }>('SELECT id FROM loyalty_memberships ORDER BY id LIMIT 1')).rows[0].id;
    await db.query(`INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source) VALUES ($1, '2026-02-01', 1, 'miles', 'typed')`, [m]);
    const withTyped = await checksum(LOYALTY);
    const third = await good('--apply');
    expect(third.exitCode).toBe(0);
    expect(third.values.observations_created).toBe('0');
    expect(await checksum(LOYALTY)).toBe(withTyped);
  });

  it('T42a-I4: a row naming no alias, or a bad value, refuses the whole run with nothing written', async () => {
    const struct = await structure();
    for (const apply of [[], ['--apply']]) {
      const prog = await run('--file', BAD_PROGRAM, '--as-of', AS_OF, '--default-member', 'zq42aanna', ...apply);
      expect(prog.exitCode).toBe(1);
      expect(prog.values).toMatchObject({
        rows: '12', refused_program: '1', refused_member: '0', refused_value: '0', refused_duplicate: '0', conflicts: '0',
        refused_rows_program: '2', refused_rows_value: '', memberships_created: '0', observations_created: '0', instruments_created: '0',
      });
      const value = await run('--file', BAD_VALUE, '--as-of', AS_OF, '--default-member', 'zq42aanna', ...apply);
      expect(value.exitCode).toBe(1);
      expect(value.values).toMatchObject({
        refused_program: '0', refused_value: '2', refused_rows_value: '2,8', refused_rows_program: '', memberships_created: '0',
      });
      for (const r of [prog, value]) expect(/zq42a/i.test([...r.out, ...r.err].join('\n'))).toBe(false);
      expect(await counts()).toEqual([0, 0, 0]);
      expect(await structure()).toEqual(struct);
    }
  });

  it('T42a-I5: output is counts and row numbers only, for every fixture and mode', async () => {
    const figures = figuresIn(GOOD);
    expect(figures.length).toBeGreaterThanOrEqual(12);
    let captured = 0;
    for (const file of [GOOD, BAD_PROGRAM, BAD_VALUE, BAD_DUPLICATE]) {
      for (const apply of [[], ['--apply']]) {
        await reset();
        const r = await run('--file', file, '--as-of', AS_OF, '--default-member', 'zq42aanna', ...apply);
        const text = [...r.out, ...r.err].join('\n');
        captured += r.out.length;
        for (const l of r.out) expect(l).toMatch(LINE);
        expect(/zq42a/i.test(text)).toBe(false);
        for (const f of [...figures, ...figuresIn(file)]) expect(text.includes(f), f).toBe(false);
      }
    }
    expect(captured).toBe(160);
  });

  it('T42a-I6: an older imported reading does not roll back a newer typed one', async () => {
    const { member, program } = await ids();
    const m = (await db.query<{ id: number }>(
      'INSERT INTO loyalty_memberships (member_id, program_id) VALUES ($1, $2) RETURNING id',
      [member.ZQ42AAnna, program['ZQ42A Skybrand Air']])).rows[0].id;
    await db.query(`INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source) VALUES ($1, '2026-03-01', 777, 'miles', 'typed')`, [m]);
    const r = await good('--apply');
    expect(r.exitCode).toBe(0);
    expect(r.values).toMatchObject({ memberships_created: '11', memberships_existing: '1', observations_created: '7' });
    expect(await n(`SELECT count(*) FROM loyalty_observations WHERE membership_id = ${m}`)).toBe(2);
    const view = await membershipView(m);
    expect([view?.balance, view?.asOf, view?.source]).toEqual(['777', '2026-03-01', 'typed']);
  });

  it('T42a-I7: an existing membership is never updated, and a different imported reading for the same day is a conflict', async () => {
    const { member, program } = await ids();
    const m = (await db.query<{ id: number }>(
      `INSERT INTO loyalty_memberships (member_id, program_id, member_number, tier) VALUES ($1, $2, 'ZQ42A-OTHER-9', 'ZQ42A Gold') RETURNING id`,
      [member.ZQ42ABob, program['ZQ42A Skybrand Air']])).rows[0].id;
    const ok = await good('--apply');
    expect(ok.exitCode).toBe(0);
    expect(ok.values.memberships_existing).toBe('1');
    const row = (await db.query<{ member_number: string; tier: string }>('SELECT member_number, tier FROM loyalty_memberships WHERE id = $1', [m])).rows[0];
    expect(row).toEqual({ member_number: 'ZQ42A-OTHER-9', tier: 'ZQ42A Gold' });

    await reset();
    const ids2 = await ids();
    const anna = (await db.query<{ id: number }>(
      'INSERT INTO loyalty_memberships (member_id, program_id) VALUES ($1, $2) RETURNING id',
      [ids2.member.ZQ42AAnna, ids2.program['ZQ42A Skybrand Air']])).rows[0].id;
    await db.query(`INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source) VALUES ($1, $2, 5, 'miles', 'import')`, [anna, AS_OF]);
    const sum = await checksum(LOYALTY);
    const conflict = await good('--apply');
    expect(conflict.exitCode).toBe(1);
    expect(conflict.values).toMatchObject({ conflicts: '1', refused_rows_conflict: '1', memberships_created: '0', observations_created: '0' });
    expect(await checksum(LOYALTY)).toBe(sum);
  });

  it('T42a-I8: a bonus becomes an instrument only where availability says issued and unused, once', async () => {
    const r = await good('--apply');
    expect(r.values).toMatchObject({ instruments_created: '3', bonus_unplaced: '2' });
    const holders = await db.query<{ label: string }>(`
      SELECT p.name || '/' || hm.display_name AS label FROM loyalty_instruments i
        JOIN loyalty_memberships m ON m.id = i.membership_id JOIN loyalty_programs p ON p.id = m.program_id
        JOIN household_members hm ON hm.id = m.member_id ORDER BY 1`);
    // Rows 4 (yes), 6 (Yes, the default member) and 11 (yes); not rows 5 (no) or 7 (empty).
    expect(holders.rows.map((h) => h.label)).toEqual([
      'ZQ42A Carbrand Rewards/ZQ42ABob', 'ZQ42A Cardpay Points/ZQ42AAnna', 'ZQ42A Stayco Hotels/ZQ42AAnna',
    ]);
    const again = await good('--apply');
    expect(again.values).toMatchObject({ instruments_created: '0', instruments_existing: '3', bonus_unplaced: '2' });
    expect(await n('SELECT count(*) FROM loyalty_instruments')).toBe(3);
  });

  it('T42a-I9: usage and file-level refusals exit 2 and write nothing', async () => {
    const dir = await import('node:os').then((os) => os.tmpdir());
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const tmp = mkdtempSync(join(dir, 'zq42a-import-'));
    try {
      const file = (name: string, text: string) => { const p = join(tmp, name); writeFileSync(p, text); return p; };
      const noBalance = file('a.csv', ',Annual Bonus\nZQ42A Skybrand ZQ42AAnna,x\n');
      const namedFirst = file('b.csv', 'Program,Balance\nZQ42A Skybrand ZQ42AAnna,1\n');
      const twoBalances = file('c.csv', ',Balance,BALANCE\nZQ42A Skybrand ZQ42AAnna,1,2\n');
      const refusals = [
        ['--as-of', AS_OF],
        ['--file', GOOD],
        ['--file', GOOD, '--as-of', '2026-02-30'],
        ['--file', GOOD, '--as-of', '15/01/2026'],
        ['--file', GOOD, '--as-of', AS_OF, '--default-member'],
        ['--file', GOOD, '--as-of', AS_OF, '--default-member', '--apply'],
        ['--file', GOOD, '--as-of', AS_OF, '--bogus'],
        ['--file', join(FIX, 'does-not-exist.csv'), '--as-of', AS_OF],
        ['--file', FIX, '--as-of', AS_OF, '--apply'],
        ['--file', noBalance, '--as-of', AS_OF, '--apply'],
        ['--file', namedFirst, '--as-of', AS_OF, '--apply'],
        ['--file', twoBalances, '--as-of', AS_OF, '--apply'],
      ];
      for (const argv of refusals) {
        const r = await run(...argv);
        expect(r.exitCode, argv.join(' ')).toBe(2);
        expect(r.out).toEqual([]);
        expect(r.err.length).toBeGreaterThan(0);
        expect(/zq42a/i.test(r.err.join('\n'))).toBe(false);
      }
      expect(await counts()).toEqual([0, 0, 0]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('T42a-I10: no network, no ledger, and the script does not start when imported', async () => {
    const sources = ['scripts/import-loyalty.ts', 'lib/domain/loyaltyImport.ts', 'lib/domain/loyalty.ts']
      .map((f) => readFileSync(join(HERE, '..', f), 'utf8'));
    for (const s of sources) {
      expect(s).not.toMatch(/from ['"](plaid|@anthropic-ai\/sdk|nodemailer|@simplewebauthn[^'"]*)['"]/);
      expect(s).not.toMatch(/plaid-script-shared/);
      expect(s).not.toMatch(/fetch\(/);
    }
    const ledger = ['accounts', 'transactions', 'users'];
    const before = await checksum(ledger);
    expect((await good('--apply')).exitCode).toBe(0);
    expect(await checksum(ledger)).toBe(before);
    expect(isEntryPoint()).toBe(false);
    expect(isEntryPoint(['node', '/x/apps/web/scripts/import-loyalty.ts'])).toBe(true);
    expect(isEntryPoint(['node', '/x/apps/web/scripts/rekey-plaid-ids.ts'])).toBe(false);
  });

  it('T42a-I11: the default member is explicit and exact, and a duplicate pair refuses its later row', async () => {
    const members = await n('SELECT count(*) FROM household_members');
    for (const dm of [[], ['--default-member', 'ZQ42Anobody']]) {
      const r = await run('--file', GOOD, '--as-of', AS_OF, '--apply', ...dm);
      expect(r.exitCode).toBe(1);
      expect(r.values).toMatchObject({ refused_member: '1', refused_rows_member: '6', memberships_created: '0' });
      expect(await counts()).toEqual([0, 0, 0]);
    }
    const dup = await run('--file', BAD_DUPLICATE, '--as-of', AS_OF, '--default-member', 'zq42aanna', '--apply');
    expect(dup.exitCode).toBe(1);
    expect(dup.values).toMatchObject({ refused_duplicate: '1', refused_rows_duplicate: '12', refused_program: '0' });
    expect(dup.values.refused_rows_duplicate.split(',')).not.toContain('1');
    expect(await counts()).toEqual([0, 0, 0]);
    const spaced = await run('--file', GOOD, '--as-of', AS_OF, '--default-member', '  ZQ42AANNA ', '--apply');
    expect(spaced.exitCode).toBe(0);
    expect(await counts()).toEqual([12, 7, 3]);
    expect(await n('SELECT count(*) FROM household_members')).toBe(members);
  });
});

// ─── P8-42a2: the --as-of bound and the failure class (T42a2-I1–I3) ─────────────────────────────
//
// Dates come from this suite's own database (`CURRENT_DATE + n`), never the JS clock, so the bound
// is tested as Postgres sees it. Failures are driven two ways: stub errors of every shape (I2), and
// real `pg` errors from a missing table and a closed port (I3). The canary `ZQ42A-NUM-0001-ZZ` is
// put in every message, detail, hint and stack, and must appear nowhere in what the script prints.

const FAILED = 'import could not run; nothing was changed';
const CANARY = 'ZQ42A-NUM-0001-ZZ';
const CLOSED_PORT = 'postgresql://nobody@127.0.0.1:1/x';

type Captured = { exitCode: number; out: string[]; err: string[] };
/** `main` with a substitute `deps.db`; everything printed is captured, as in `run`. */
async function runWith(dbDep: ImportDb, ...argv: string[]): Promise<Captured> {
  const out: string[] = [];
  const err: string[] = [];
  const { exitCode } = await main(argv, {}, { ...defaultDeps, db: dbDep, out: (l) => out.push(l), err: (l) => err.push(l) });
  return { exitCode, out, err };
}
const goodArgs = (asOf: string, ...extra: string[]) => ['--file', GOOD, '--as-of', asOf, '--default-member', 'zq42aanna', ...extra];
const dayAhead = async (days: number) => (await db.query<{ d: string }>(`SELECT (CURRENT_DATE + ${days})::text AS d`)).rows[0].d;

/** The real database, with every query text first passed through `rewrite` and recorded. */
function forwardingDb(texts: string[], rewrite: (t: string) => string = (t) => t): ImportDb {
  return {
    query: (t: string, v?: unknown[]) => { texts.push(t); return db.query(rewrite(t), v); },
    connect: async () => {
      const client = await db.connect();
      return {
        query: (t: string, v?: unknown[]) => { texts.push(t); return client.query(rewrite(t), v); },
        release: () => client.release(),
      };
    },
  } as unknown as ImportDb;
}

/**
 * A database whose first query on `deps.db` rejects with `thrown` (`at: 'bound'`), or which answers
 * the bound and rejects the first query after it — readState's in a dry run, the transaction's
 * BEGIN under --apply (`at: 'after'`). Everything after the rejection resolves empty.
 */
function failingDb(thrown: unknown, at: 'bound' | 'after'): ImportDb {
  let calls = 0;
  const next = () => {
    calls++;
    const fail = at === 'bound' ? calls === 1 : calls === 2;
    if (fail) return Promise.reject(thrown);
    return Promise.resolve({ rows: calls === 1 ? [{ future: false }] : [], rowCount: 0 });
  };
  return { query: next, connect: async () => ({ query: next, release: () => {} }) } as unknown as ImportDb;
}

describe('the loyalty import follow-ups (P8-42a2)', () => {
  it('T42a2-I1: --as-of is refused after CURRENT_DATE + 1, by Postgres, in both modes, with nothing written or echoed', async () => {
    const struct = await structure();
    for (const bad of [await dayAhead(2), await dayAhead(3), '2999-01-01']) {
      for (const mode of [[], ['--apply']]) {
        const r = await run(...goodArgs(bad, ...mode));
        expect(r.exitCode, `${bad} ${mode.join('')}`).toBe(2);
        expect(r.out).toEqual([]);
        expect(r.err.length).toBeGreaterThan(0);
        const text = r.err.join('\n');
        expect(/zq42a/i.test(text)).toBe(false);
        expect(text).not.toMatch(/\d{4}/);
        expect(text.includes(bad)).toBe(false);
        expect(await counts()).toEqual([0, 0, 0]);
        expect(await structure()).toEqual(struct);
      }
    }
    for (const ok of [await dayAhead(0), await dayAhead(1)]) {
      const dry = await run(...goodArgs(ok));
      expect(dry.exitCode, ok).toBe(0);
      expect(dry.out).toHaveLength(20);
      for (const l of dry.out) expect(l).toMatch(LINE);
      expect(dry.values).toMatchObject({ mode: 'dry-run', memberships_created: '12', observations_created: '7', instruments_created: '3' });
      expect(dry.err).toEqual([]);
      expect(await counts()).toEqual([0, 0, 0]);
    }
    const applied = await run(...goodArgs(await dayAhead(1), '--apply'));
    expect(applied.exitCode).toBe(0);
    expect(applied.err).toEqual([]);
    expect(await counts()).toEqual([12, 7, 3]);
    expect(await n('SELECT count(*) FROM loyalty_observations WHERE as_of = CURRENT_DATE + 1')).toBe(7);
    await reset();
    // No lower bound: an old sheet is fine.
    const past = await run(...goodArgs('2000-01-01'));
    expect(past.exitCode).toBe(0);
    expect(past.err).toEqual([]);
    // The bound comes from the database: the script asked a query naming CURRENT_DATE, in both modes.
    for (const mode of [[], ['--apply']]) {
      await reset();
      const texts: string[] = [];
      const r = await runWith(forwardingDb(texts), ...goodArgs('2999-01-01', ...mode));
      expect(r.exitCode).toBe(2);
      expect(texts.some((t) => t.includes('CURRENT_DATE'))).toBe(true);
      // Refused before the transaction: no BEGIN, no read of the loyalty tables.
      expect(texts.some((t) => /BEGIN|loyalty_memberships/.test(t))).toBe(false);
    }
  });

  it('T42a2-I2: a failed run prints the failure line and a shape-checked code, never any text of the error', async () => {
    const withCode = (code: unknown) => Object.assign(new Error(`${CANARY} message`), { code });
    const full = Object.assign(new Error(`${CANARY} message`), {
      code: '42P01', detail: `${CANARY} detail`, hint: `${CANARY} hint`, stack: `${CANARY} stack`,
    });
    const cases: [string, unknown, string][] = [
      ['sqlstate', full, '42P01'],
      ['errno', withCode('ECONNREFUSED'), 'ECONNREFUSED'],
      ['no code', new Error(`${CANARY} message`), 'unknown'],
      ['text code', withCode('ZQ42A secret value here'), 'unknown'],
      ['numeric code', withCode(42), 'unknown'],
      ['thrown string', `${CANARY} thrown`, 'unknown'],
      ['thrown null', null, 'unknown'],
    ];
    for (const [label, thrown, code] of cases) {
      for (const at of ['bound', 'after'] as const) {
        for (const mode of [[], ['--apply']]) {
          const r = await runWith(failingDb(thrown, at), ...goodArgs(AS_OF, ...mode));
          const where = `${label} ${at} ${mode.join('')}`;
          expect(r.exitCode, where).toBe(1);
          expect(r.out, where).toEqual([]);
          expect(r.err, where).toEqual([FAILED, `code=${code}`]);
          expect([...r.out, ...r.err].join('\n').includes(CANARY), where).toBe(false);
          expect(/secret value/.test(r.err.join('\n')), where).toBe(false);
        }
      }
    }
    // The control: a healthy run says nothing on stderr.
    const healthy = await good();
    expect(healthy.exitCode).toBe(0);
    expect(healthy.err).toEqual([]);
  });

  it('T42a2-I3: real driver errors give their real class and no text; a usage error stays a usage error', async () => {
    const struct = await structure();
    // (a) A real 42P01: the query is rewritten to name a table that does not exist.
    for (const mode of [[], ['--apply']]) {
      const texts: string[] = [];
      const r = await runWith(forwardingDb(texts, (t) => t.replace(/household_members/g, 'zq42a_missing_table')), ...goodArgs(AS_OF, ...mode));
      expect(r.exitCode).toBe(1);
      expect(r.out).toEqual([]);
      expect(r.err).toEqual([FAILED, 'code=42P01']);
      const text = [...r.out, ...r.err].join('\n');
      for (const word of ['zq42a_missing_table', 'relation', 'does not exist']) expect(text.includes(word), word).toBe(false);
      expect(texts.some((t) => t.includes('household_members'))).toBe(true);
      expect(await counts()).toEqual([0, 0, 0]);
      expect(await structure()).toEqual(struct);
    }
    // (b)–(d) A closed port: nothing listens on 127.0.0.1:1, so the connection is refused at once.
    const closed = new Pool({ connectionString: CLOSED_PORT });
    closed.on('error', () => {});
    try {
      const closedDb = closed as unknown as ImportDb;
      for (const mode of [[], ['--apply']]) {
        for (const asOf of [AS_OF, '2999-01-01']) {
          const r = await runWith(closedDb, ...goodArgs(asOf, ...mode));
          // A database failure while reading the bound is a failed run (1), not a refusal (2).
          expect(r.exitCode, asOf).toBe(1);
          expect(r.out).toEqual([]);
          expect(r.err).toEqual([FAILED, 'code=ECONNREFUSED']);
          expect(r.err.join('\n').includes('127.0.0.1')).toBe(false);
        }
        const usage = await runWith(closedDb, '--as-of', AS_OF, ...mode);
        expect(usage.exitCode).toBe(2);
        expect(usage.out).toEqual([]);
        expect(usage.err.some((l) => l.includes('code='))).toBe(false);
      }
    } finally {
      await closed.end().catch(() => {});
    }
    expect(await counts()).toEqual([0, 0, 0]);
  });
});
