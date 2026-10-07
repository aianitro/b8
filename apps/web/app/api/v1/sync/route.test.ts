// `POST /api/v1/sync` against a real Postgres, with only the Plaid boundary faked: tombstoned ids.
//
// TIER 2, under `vitest.integration.config.mts` with the scratch-database guard in `setupFiles` —
// this file writes rows, and the guard refuses to run it against the owner's real database.
//
// WHAT IS FAKED, AND WHY ONLY THAT. The three modules that reach Plaid over the network —
// `lib/plaid` (the client: `transactionsSync`, `itemGet`, and `institutionsGetById` should an
// institution id ever come back), `lib/plaidReconcile` and `lib/plaidBalances` — are replaced, and
// nothing else. The route, `runSync`, `syncItem`, the re-identification matcher and every SQL
// statement are the real ones, run against the scratch database. A tombstone check is a property of
// a SQL statement; a test that stubbed `lib/db` would be checking that a stub was asked a question,
// and the failure this file exists to catch — a check made against a stale reading instead of
// inside the write — would pass it.
//
// DETERMINISTIC WITHOUT TRUNCATING ANYONE ELSE'S ROWS. Other suites leave tokened accounts behind
// (the overview suite seeds two fabricated Plaid items). Every sync here is asked for this file's
// account by id, which `runSync` narrows to this file's item alone, so the fake `transactionsSync`
// is only ever called for this file's token and the leftovers are never synced. Reconciliation
// still visits every token, which is why it is faked to a no-op rather than left to fail.
//
// CLEANUP INCLUDES TOMBSTONES. `transaction_tombstones` has no foreign key to `transactions` by
// design, so deleting this file's transactions does not reach it; it is cleared explicitly by the
// keys this file uses, before each test as well as after the last, so a run that died half way
// cannot leave a tombstone that hides or causes a failure in the next one.
//
// EVERY ROW AND ID IS FABRICATED. The fixtures for S7, S10 and S11 are transcribed into EVIDENCE.md.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { POST as sync } from './route';
import { DELETE as deleteTxn, PATCH as patchTxn } from '../transactions/[id]/route';

// Hoisted alongside the mocks: a `vi.mock` factory runs before this module's own top-level code,
// so anything it closes over has to be created in the same hoisted phase.
const fake = vi.hoisted(() => ({
  TOKEN: 'p40a-sync-item-token',
  /** The `transactionsSync` pages still to be served, in order, for this file's token. */
  pages: [] as unknown[],
}));

vi.mock('@/lib/plaid', () => ({
  plaidClient: () => ({
    transactionsSync: async (req: { access_token: string; cursor?: string }) => {
      if (req.access_token !== fake.TOKEN) {
        throw new Error('p40a: sync reached an item this file does not own');
      }
      const page = fake.pages.shift();
      if (!page) throw new Error('p40a: sync asked for more pages than the test queued');
      return { data: page };
    },
    // No institution id comes back, so `institutionsGetById` is never reached; it is still
    // present so that if it ever is, the failure names this file rather than a missing method.
    itemGet: async () => ({ data: { item: { institution_id: null }, status: {} } }),
    institutionsGetById: async () => {
      throw new Error('p40a: institutionsGetById was not expected');
    },
  }),
}));

vi.mock('@/lib/plaidReconcile', () => ({
  reconcileAccountIds: async () => ({ remapped: [], unmatchedLive: [], unmatchedDb: [], liveBalances: [] }),
}));

vi.mock('@/lib/plaidBalances', () => ({
  recordPlaidBalances: async () => 0,
}));

const ACCOUNT = 'p40a_sync_acct';
const DATE = '2026-02-10';
const NAME = 'Fabricated P40a Cafe';

interface FakeTxn {
  transaction_id: string;
  account_id: string;
  date: string;
  amount: number;
  name: string;
  merchant_name: string;
  pending: boolean;
  personal_finance_category: { primary: string };
}

/** A posted Plaid transaction on this file's account. */
function txn(id: string, over: Partial<FakeTxn> = {}): FakeTxn {
  return {
    transaction_id: id,
    account_id: ACCOUNT,
    date: DATE,
    amount: 6.75,
    name: NAME,
    merchant_name: NAME,
    pending: false,
    personal_finance_category: { primary: 'P40A_FABRICATED' },
    ...over,
  };
}

function queuePage(page: {
  added?: FakeTxn[]; modified?: FakeTxn[]; removed?: { transaction_id: string }[];
  next_cursor: string; has_more?: boolean;
}): void {
  fake.pages.push({
    added: page.added ?? [], modified: page.modified ?? [], removed: page.removed ?? [],
    next_cursor: page.next_cursor, has_more: page.has_more ?? false,
  });
}

interface SyncData { synced: number; errors: string[] }

/** The real route, narrowed to this file's account. */
async function runSyncRoute(): Promise<SyncData> {
  const response = await sync(new NextRequest('http://localhost/api/v1/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: ACCOUNT }),
  }));
  const body = await response.json();
  expect(body.success).toBe(true);
  // Every queued page was consumed: a sync that stopped early would leave one behind.
  expect(fake.pages).toHaveLength(0);
  return body.data as SyncData;
}

async function storedCursor(): Promise<string | null> {
  const r = await db.query<{ cursor: string | null }>('SELECT cursor FROM accounts WHERE id = $1', [ACCOUNT]);
  return r.rows[0].cursor;
}

async function rowFor(plaidId: string): Promise<Record<string, unknown> | undefined> {
  const r = await db.query(
    `SELECT id, plaid_transaction_id, account_id, date::text AS date, amount::text AS amount, name,
            merchant_name, plaid_category, mapped_category, rule_applied, hidden
       FROM transactions WHERE plaid_transaction_id = $1`,
    [plaidId]
  );
  return r.rows[0];
}

async function tombstone(key: string): Promise<void> {
  await db.query('INSERT INTO transaction_tombstones (plaid_transaction_id) VALUES ($1)', [key]);
}

async function hasTombstone(key: string): Promise<boolean> {
  const r = await db.query('SELECT 1 FROM transaction_tombstones WHERE plaid_transaction_id = $1', [key]);
  return r.rows.length > 0;
}

async function seedRow(plaidId: string, over: { amount?: string; name?: string } = {}): Promise<number> {
  const r = await db.query<{ id: number }>(
    `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, merchant_name)
     VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
    [plaidId, ACCOUNT, DATE, over.amount ?? '6.75', over.name ?? NAME]
  );
  return r.rows[0].id;
}

let syncLogHighWater = 0;

async function cleanup(): Promise<void> {
  fake.pages.length = 0;
  await db.query('DELETE FROM transactions WHERE account_id = $1', [ACCOUNT]);
  // `p40a_live` is S10's id exactly as the spec names it; every other key carries the file prefix.
  await db.query(
    "DELETE FROM transaction_tombstones WHERE plaid_transaction_id LIKE 'p40a\\_sync\\_%' OR plaid_transaction_id = 'p40a_live'"
  );
  await db.query('DELETE FROM accounts WHERE id = $1', [ACCOUNT]);
}

beforeAll(async () => {
  const r = await db.query<{ n: number }>('SELECT COALESCE(MAX(id), 0)::int AS n FROM sync_log');
  syncLogHighWater = r.rows[0].n;
});

beforeEach(async () => {
  await cleanup();
  await db.query(
    `INSERT INTO accounts (id, name, type, landscape, access_token, bank)
     VALUES ($1, 'Fabricated P40a Sync Checking', 'depository', 'operational', $2, 'Fabricated Bank P40a')`,
    [ACCOUNT, fake.TOKEN]
  );
});

afterAll(async () => {
  await cleanup();
  // The sync_log rows these runs wrote, and only those.
  await db.query('DELETE FROM sync_log WHERE id > $1', [syncLogHighWater]);
  await db.end();
});

describe('sync never writes back a transaction the owner deleted', () => {
  it('T40a-S7: a tombstoned id arriving as added is skipped, its page-mate is inserted, and the sync completes', async () => {
    await tombstone('p40a_sync_s7_dead');
    queuePage({
      // The fresh id carries a different name, so re-identification has no reason to pair the two.
      added: [txn('p40a_sync_s7_dead'), txn('p40a_sync_s7_fresh', { name: 'Fabricated P40a Bakery' })],
      next_cursor: 'p40a-cursor-s7',
    });

    const data = await runSyncRoute();

    expect(await rowFor('p40a_sync_s7_fresh')).toBeDefined();
    expect(await rowFor('p40a_sync_s7_dead')).toBeUndefined();
    expect(data.synced).toBe(1);
    expect(data.errors).toEqual([]);
    expect(await storedCursor()).toBe('p40a-cursor-s7');
  });

  it('T40a-S8: a row deleted through the real route does not return on modified, while a live row updates and keeps its owner category', async () => {
    queuePage({
      added: [
        txn('p40a_sync_s8_gone'),
        txn('p40a_sync_s8_kept', { name: 'Fabricated P40a Grocer', amount: 9.1 }),
      ],
      next_cursor: 'p40a-cursor-s8-a',
    });
    expect((await runSyncRoute()).synced).toBe(2);

    const gone = await rowFor('p40a_sync_s8_gone');
    const kept = await rowFor('p40a_sync_s8_kept');
    // The owner's own choice, through the real PATCH, which is what sets rule_applied = FALSE.
    await patchTxn(
      new NextRequest(`http://localhost/api/v1/transactions/${kept!.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapped_category: 'P40a Owner Category' }),
      }),
      { params: Promise.resolve({ id: String(kept!.id) }) }
    );
    const del = await deleteTxn(
      new NextRequest(`http://localhost/api/v1/transactions/${gone!.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: String(gone!.id) }) }
    );
    expect((await del.json()).success).toBe(true);

    queuePage({
      modified: [
        txn('p40a_sync_s8_gone', { name: 'Fabricated P40a Cafe Revised', amount: 7.25 }),
        txn('p40a_sync_s8_kept', { name: 'Fabricated P40a Grocer', amount: 9.6 }),
      ],
      next_cursor: 'p40a-cursor-s8-b',
    });
    const second = await runSyncRoute();

    expect(second.errors).toEqual([]);
    expect(await rowFor('p40a_sync_s8_gone')).toBeUndefined();
    expect(await hasTombstone('p40a_sync_s8_gone')).toBe(true);
    const keptAfter = await rowFor('p40a_sync_s8_kept');
    expect(keptAfter!.amount).toBe('9.60');
    expect(keptAfter!.mapped_category).toBe('P40a Owner Category');
    expect(keptAfter!.rule_applied).toBe(false);
    expect(await storedCursor()).toBe('p40a-cursor-s8-b');
  });

  it('T40a-S9: modified for a tombstoned id writes nothing even when a row with that id exists', async () => {
    // Reachable in practice only through a CSV-style re-creation, but the rule is about the id,
    // not about how the row got there.
    await seedRow('p40a_sync_s9');
    await tombstone('p40a_sync_s9');
    const before = await rowFor('p40a_sync_s9');

    queuePage({
      modified: [txn('p40a_sync_s9', {
        date: '2026-02-11', amount: 8.4, name: 'Fabricated P40a Changed', merchant_name: 'Fabricated P40a Changed',
        personal_finance_category: { primary: 'P40A_CHANGED' },
      })],
      next_cursor: 'p40a-cursor-s9',
    });
    const data = await runSyncRoute();

    expect(data.errors).toEqual([]);
    expect(await rowFor('p40a_sync_s9')).toEqual(before);
  });

  it('T40a-S10: a tombstoned incoming id never claims a stored live row during re-identification', async () => {
    // Identical account, date, amount and name: exactly the key re-identification pairs on. With
    // nothing stopping it, the tombstoned id would rename the live row to itself.
    await seedRow('p40a_live');
    await tombstone('p40a_sync_s10_dead');
    const count = async () =>
      (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM transactions WHERE account_id = $1', [ACCOUNT])).rows[0].n;
    const before = await count();

    queuePage({ added: [txn('p40a_sync_s10_dead')], next_cursor: 'p40a-cursor-s10' });
    const data = await runSyncRoute();

    expect(data.errors).toEqual([]);
    expect(await rowFor('p40a_live')).toBeDefined();
    expect(await rowFor('p40a_sync_s10_dead')).toBeUndefined();
    expect(await count()).toBe(before);
    expect(data.synced).toBe(0);
  });

  it('T40a-S11: removed is a no-op for a tombstoned id and deletes a live row without tombstoning it', async () => {
    await tombstone('p40a_sync_s11_dead');
    await seedRow('p40a_sync_s11_live');

    queuePage({
      removed: [{ transaction_id: 'p40a_sync_s11_dead' }, { transaction_id: 'p40a_sync_s11_live' }],
      next_cursor: 'p40a-cursor-s11',
    });
    const data = await runSyncRoute();

    expect(data.errors).toEqual([]);
    expect(await storedCursor()).toBe('p40a-cursor-s11');
    expect(await hasTombstone('p40a_sync_s11_dead')).toBe(true);
    expect(await rowFor('p40a_sync_s11_live')).toBeUndefined();
    expect(await hasTombstone('p40a_sync_s11_live')).toBe(false);
  });
});
