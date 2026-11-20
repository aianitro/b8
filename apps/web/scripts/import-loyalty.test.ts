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
