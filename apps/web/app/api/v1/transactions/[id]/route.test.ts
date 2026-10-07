// `DELETE /api/v1/transactions/[id]` against a real Postgres: the delete and its tombstone.
//
// TIER 2, under `vitest.integration.config.mts` with the scratch-database guard in `setupFiles` —
// this file writes rows, and the guard refuses to run it against the owner's real database.
//
// WHY THIS CANNOT BE A PURE TEST. Everything this endpoint promises is a property of the database
// work, not of any arithmetic: that the tombstone key is the deleted row's own id and not something
// read around it, that the two writes commit or fail together, that a repeat delete does not trip
// the primary key, and that a delete naming no row leaves nothing behind. A stubbed `db` would be
// asserting that the stub was called in order, which is the one thing that cannot go wrong.
//
// EVERY ROW IS FABRICATED and carries a `p40a_` / `manual_p40a` id, so cleanup can find exactly
// what this file seeded and nothing else. Tombstones are cleaned explicitly: the table has no
// foreign key to `transactions` (that is its whole point), so neither deleting rows nor another
// suite's `TRUNCATE transactions ... CASCADE` reaches it, and a tombstone left by one run would
// otherwise still be there for the next. The fixtures for S1 are transcribed into EVIDENCE.md.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { DELETE } from './route';
import { POST as importCsv } from '../../import/csv/route';

const ACCOUNT = 'p40a_route_acct';

/**
 * Keys this file may leave in `transaction_tombstones`. The `csv_` key is not knowable up front —
 * the importer hashes it from the row — so S5 adds it here once it has seen it.
 */
const tombstoneKeys = new Set<string>();

/** Transfer groups this file created, so cleanup removes those and never anyone else's. */
const groupIds: number[] = [];

async function cleanup(): Promise<void> {
  await db.query(
    "DELETE FROM transactions WHERE account_id = $1 OR plaid_transaction_id LIKE 'p40a\\_route\\_%'",
    [ACCOUNT]
  );
  await db.query(
    "DELETE FROM transaction_tombstones WHERE plaid_transaction_id LIKE 'p40a\\_route\\_%' OR plaid_transaction_id = ANY($1)",
    [[...tombstoneKeys]]
  );
  await db.query('DELETE FROM transfer_groups WHERE id = ANY($1)', [groupIds]);
  await db.query('DELETE FROM accounts WHERE id = $1', [ACCOUNT]);
}

async function seedAccount(): Promise<void> {
  // No access token: this account must never be picked up by a sync another suite runs.
  await db.query(
    `INSERT INTO accounts (id, name, type, landscape)
     VALUES ($1, 'Fabricated P40a Checking', 'depository', 'operational')
     ON CONFLICT (id) DO NOTHING`,
    [ACCOUNT]
  );
}

async function seedTxn(
  plaidId: string,
  opts: { hidden?: boolean; transferGroupId?: number | null; amount?: string } = {}
): Promise<number> {
  const r = await db.query<{ id: number }>(
    `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, hidden, transfer_group_id)
     VALUES ($1, $2, DATE '2026-01-15', $3, 'Fabricated Merchant', $4, $5)
     RETURNING id`,
    [plaidId, ACCOUNT, opts.amount ?? '4.25', opts.hidden ?? false, opts.transferGroupId ?? null]
  );
  return r.rows[0].id;
}

/** The handler exactly as Next calls it: a request, and `params` as a Promise (Next 16). */
async function del(id: number | string): Promise<{ status: number; body: { success: boolean } }> {
  const response = await DELETE(
    new NextRequest(`http://localhost/api/v1/transactions/${id}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  return { status: response.status, body: await response.json() };
}

async function rowExists(id: number): Promise<boolean> {
  const r = await db.query('SELECT 1 FROM transactions WHERE id = $1', [id]);
  return r.rows.length > 0;
}

async function tombstonesFor(key: string): Promise<number> {
  const r = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM transaction_tombstones WHERE plaid_transaction_id = $1',
    [key]
  );
  return r.rows[0].n;
}

async function tombstoneTotal(): Promise<number> {
  const r = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM transaction_tombstones');
  return r.rows[0].n;
}

beforeEach(async () => {
  await cleanup();
  await seedAccount();
});

afterAll(async () => {
  await cleanup();
  await db.end();
});

describe('DELETE /api/v1/transactions/[id] writes a tombstone with the delete', () => {
  it('T40a-S1: deleting a hidden Plaid-id row removes it and leaves exactly one tombstone keyed on its exact plaid_transaction_id', async () => {
    // Hidden on purpose: tombstoning must not depend on a flag the budget reads care about. The
    // sibling row is what makes "rose by exactly 1" mean something — a delete that tombstoned
    // every row in the table, or every row on the account, would raise the count by two.
    const target = await seedTxn('p40a_route_s1', { hidden: true });
    await seedTxn('p40a_route_s1_sibling');
    const before = await tombstoneTotal();

    const { status, body } = await del(target);

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, data: null });
    expect(await rowExists(target)).toBe(false);
    expect(await tombstonesFor('p40a_route_s1')).toBe(1);
    expect(await tombstonesFor('p40a_route_s1_sibling')).toBe(0);
    expect(await tombstoneTotal()).toBe(before + 1);
    // Keyed on the Plaid id, not the integer row id that was in the URL.
    expect(await tombstonesFor(String(target))).toBe(0);
  });

  it('T40a-S2: deleting an id that matches no row returns the same success and writes no tombstone', async () => {
    // A row that is NOT being deleted. Without one, a delete that tombstoned every row in the
    // table could pass this test on an empty table by having nothing to tombstone.
    await seedTxn('p40a_route_s2_bystander');
    // Past the largest id the sequence has handed out, so it is guaranteed to name no row now.
    const r = await db.query<{ n: number }>("SELECT (last_value + 1000)::int AS n FROM transactions_id_seq");
    const missing = r.rows[0].n;
    const before = await tombstoneTotal();

    const { status, body } = await del(missing);

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, data: null });
    expect(await tombstoneTotal()).toBe(before);
    expect(await tombstonesFor('p40a_route_s2_bystander')).toBe(0);
  });

  it('T40a-S3: deleting a row whose key is already tombstoned succeeds and leaves one tombstone, not a duplicate-key failure', async () => {
    const target = await seedTxn('p40a_route_s3');
    await db.query("INSERT INTO transaction_tombstones (plaid_transaction_id) VALUES ('p40a_route_s3')");

    const { status, body } = await del(target);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(await rowExists(target)).toBe(false);
    expect(await tombstonesFor('p40a_route_s3')).toBe(1);
  });

  it('T40a-S4: when the tombstone cannot be written the delete does not happen and the response is a 5xx', async () => {
    const target = await seedTxn('p40a_route_s4');
    // A trigger that refuses every tombstone insert: the cheapest honest way to make the second
    // write fail after the first has already succeeded inside the same transaction.
    await db.query(`
      CREATE OR REPLACE FUNCTION p40a_refuse_tombstone() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'p40a: tombstone write refused for the test'; END;
      $$ LANGUAGE plpgsql`);
    await db.query(`
      CREATE TRIGGER p40a_refuse_tombstone BEFORE INSERT ON transaction_tombstones
      FOR EACH ROW EXECUTE FUNCTION p40a_refuse_tombstone()`);
    try {
      const { status, body } = await del(target);

      expect(status).toBeGreaterThanOrEqual(500);
      expect(body.success).not.toBe(true);
      expect(await rowExists(target)).toBe(true);
      expect(await tombstonesFor('p40a_route_s4')).toBe(0);
    } finally {
      await db.query('DROP TRIGGER IF EXISTS p40a_refuse_tombstone ON transaction_tombstones');
      await db.query('DROP FUNCTION IF EXISTS p40a_refuse_tombstone()');
    }

    // The other direction: the DELETE is what fails. The case above cannot see a tombstone written
    // EARLY and outside the transaction, because that early write is the one the trigger refuses,
    // so nothing is deleted and the outcome looks atomic by accident. Here the tombstone write
    // would succeed, and only a tombstone inside the same transaction is rolled back with the
    // failed delete. Scoped to this one fabricated id so it cannot refuse any other delete.
    await db.query(`
      CREATE OR REPLACE FUNCTION p40a_refuse_delete() RETURNS trigger AS $$
      BEGIN
        IF OLD.plaid_transaction_id = 'p40a_route_s4' THEN
          RAISE EXCEPTION 'p40a: delete refused for the test';
        END IF;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql`);
    await db.query(`
      CREATE TRIGGER p40a_refuse_delete BEFORE DELETE ON transactions
      FOR EACH ROW EXECUTE FUNCTION p40a_refuse_delete()`);
    try {
      const { status, body } = await del(target);

      expect(status).toBeGreaterThanOrEqual(500);
      expect(body.success).not.toBe(true);
      expect(await rowExists(target)).toBe(true);
      expect(await tombstonesFor('p40a_route_s4')).toBe(0);
    } finally {
      await db.query('DROP TRIGGER IF EXISTS p40a_refuse_delete ON transactions');
      await db.query('DROP FUNCTION IF EXISTS p40a_refuse_delete()');
    }
  });

  it('T40a-S5: manual and CSV rows delete normally, and the CSV importer does not consult tombstones', async () => {
    const manual = await seedTxn('manual_p40a_route_s5');
    tombstoneKeys.add('manual_p40a_route_s5');
    const deletedManual = await del(manual);
    expect(deletedManual.body.success).toBe(true);
    expect(await rowExists(manual)).toBe(false);

    const payload = JSON.stringify({
      accountId: ACCOUNT,
      rows: [{ date: '2026-01-20', description: 'Fabricated P40a CSV Row', amount: 3.5 }],
    });
    const importOnce = async () => {
      const res = await importCsv(new NextRequest('http://localhost/api/v1/import/csv', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
      }));
      return (await res.json()) as { success: boolean; data: { imported: number; skipped: number } };
    };

    const first = await importOnce();
    expect(first.data.imported).toBe(1);
    const csvRow = await db.query<{ id: number; plaid_transaction_id: string }>(
      "SELECT id, plaid_transaction_id FROM transactions WHERE account_id = $1 AND plaid_transaction_id LIKE 'csv\\_%'",
      [ACCOUNT]
    );
    expect(csvRow.rows).toHaveLength(1);
    const { id: csvId, plaid_transaction_id: csvKey } = csvRow.rows[0];
    tombstoneKeys.add(csvKey);
    // A tombstone a crashed earlier run left behind is cleared before it can matter — though it
    // would not, which is the point of the assertion below.
    await db.query('DELETE FROM transaction_tombstones WHERE plaid_transaction_id = $1', [csvKey]);

    expect((await del(csvId)).body.success).toBe(true);
    expect(await tombstonesFor(csvKey)).toBe(1);

    // Re-created exactly as before this task: the importer's ON CONFLICT DO NOTHING sees no row
    // and inserts, tombstone or not. Honouring tombstones there is a non-goal.
    const second = await importOnce();
    expect(second.success).toBe(true);
    expect(second.data.imported).toBe(1);
  });

  it('T40a-S6: deleting one leg of a transfer leaves the partner, its group and its absence of a tombstone untouched', async () => {
    const g = await db.query<{ id: number }>('INSERT INTO transfer_groups DEFAULT VALUES RETURNING id');
    const groupId = g.rows[0].id;
    groupIds.push(groupId);
    const leg = await seedTxn('p40a_route_s6_out', { transferGroupId: groupId, amount: '7.00' });
    const partner = await seedTxn('p40a_route_s6_in', { transferGroupId: groupId, amount: '-7.00' });

    expect((await del(leg)).body.success).toBe(true);

    const p = await db.query<{ transfer_group_id: number | null }>(
      'SELECT transfer_group_id FROM transactions WHERE id = $1', [partner]
    );
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].transfer_group_id).toBe(groupId);
    const grp = await db.query('SELECT 1 FROM transfer_groups WHERE id = $1', [groupId]);
    expect(grp.rows).toHaveLength(1);
    expect(await tombstonesFor('p40a_route_s6_in')).toBe(0);
    expect(await tombstonesFor('p40a_route_s6_out')).toBe(1);
  });
});
