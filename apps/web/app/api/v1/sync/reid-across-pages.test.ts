// Re-identification across the pages of one sync walk, and the two R5 rules beside it: the re-auth
// phase that keeps the cursor NULL until Plaid reports history complete, and the stored-cursor walk
// that re-identifies only a row Plaid listed in `removed` (P6-40f, PG-01..PG-17, with PG-15e and PG-16c from cycle 2).
//
// TIER 2, under `vitest.integration.config.mts` (collected by its `app/api/v1/**` glob) with the
// scratch-database guard in `setupFiles` — this file writes rows.
//
// WHAT IS FAKED, AND WHY ONLY THAT. `lib/plaid` and nothing else, in the same shape as
// `reissue-root-cause.test.ts`: per-token queued pages, and every `/transactions/sync` request
// recorded. `runSync`, the account reconcile, the balance recording and the re-identification
// matcher are the real ones. The defect this file pins (H-g from P6-40e) lives in how `syncItem`
// carries — or failed to carry — what it learned on one page into the next, so the pages have to
// be served one at a time to the real walk; a test of the matcher alone cannot see it, because the
// matcher is only ever handed one page.
//
// EVERY TEST ASSERTS THE PAGES WERE ALL SERVED and the cursors each request carried. A fixture whose
// later page was never asked for would pass any "the row was not renamed twice" assertion for the
// wrong reason.
//
// OWNER VALUES ARE READ BACK BY PRIMARY KEY, never by Plaid id. The failure being tested is a row
// changing ids, so finding a row by its id would look in the wrong place for exactly the case that
// matters; the primary key is the one thing a correct sync never changes.
//
// THE DUMP LINES ARE LABELLED WITHOUT THE TEST TAG. SPEC.md's acceptance counts output lines that
// contain the tag, so a dump line carrying it would make a passing file fail that count.
//
// EVERY VALUE IS FABRICATED. Ids, tokens and cursors are `p640f-` sentinels; amounts are small whole
// numbers; names are invented.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '@/lib/db';
import { runSync } from '@/lib/sync';

const fake = vi.hoisted(() => ({
  /** Every `/transactions/sync` request, in order. */
  requests: [] as { access_token: string; cursor: string | undefined }[],
  /** Per token, the pages still to be served, in order. */
  pages: new Map<string, unknown[]>(),
  /** Per token, what `/accounts/get` reports — read by sync's real reconcile. */
  accounts: new Map<string, unknown[]>(),
}));

vi.mock('@/lib/plaid', () => ({
  plaidClient: () => ({
    // Another suite's leftover token gets no accounts, which reconciles to nothing.
    accountsGet: async (req: { access_token: string }) => ({ data: { accounts: fake.accounts.get(req.access_token) ?? [] } }),
    itemGet: async () => ({ data: { item: { institution_id: null }, status: {} } }),
    institutionsGetById: async () => {
      throw new Error('p640f: institutionsGetById was not expected');
    },
    transactionsSync: async (req: { access_token: string; cursor?: string }) => {
      fake.requests.push({ access_token: req.access_token, cursor: req.cursor });
      const page = fake.pages.get(req.access_token)?.shift();
      if (!page) throw new Error('p640f: sync asked for a page the test did not queue');
      return { data: page };
    },
  }),
}));

const P = 'p640f';
const TOKEN = `${P}-token`;
const ACCT = `${P}-acct`;
const STORED_CURSOR = `${P}-cursor-stored`;
const DATE = '2026-03-10';
const AMOUNT = 3;
const NAME = 'Fabricated P640f Cafe';
const RELOG = 're-identified transactions after item change';

const oldId = (k: number) => `${P}-old-${k}`;
const newId = (k: number) => `${P}-new-${k}`;

interface FakeTxn {
  transaction_id: string; account_id: string; date: string; amount: number; name: string;
  merchant_name: string; pending: boolean; personal_finance_category: { primary: string };
}

/** A posted Plaid transaction on this file's account, by default in the shared group's key. */
function txn(id: string, over: Partial<FakeTxn> = {}): FakeTxn {
  return {
    transaction_id: id, account_id: ACCT, date: DATE, amount: AMOUNT, name: NAME, merchant_name: NAME,
    pending: false, personal_finance_category: { primary: 'P640F_FABRICATED' }, ...over,
  };
}

interface FakePage {
  added?: FakeTxn[]; modified?: FakeTxn[];
  /** Ids Plaid retires on this page. */
  removed?: string[];
  /** Plaid's `transactions_update_status`; left out of the page entirely when not given. */
  status?: string;
  /** Overrides this page's `next_cursor` (PG-16b's NOT_READY page answers with ''). */
  next?: string;
}

/**
 * Queues one walk: page k (1-based) carries `next_cursor` `p640f-<tag>next-k` unless overridden,
 * and every page but the last says `has_more`. Returns the cursors the walk must send, starting
 * from `start` — an empty or absent cursor is sent as none.
 */
function queueWalk(start: string | null, pages: FakePage[], tag = ''): (string | undefined)[] {
  const next = (i: number) => pages[i].next ?? `${P}-${tag}next-${i + 1}`;
  fake.pages.set(TOKEN, pages.map((p, i) => ({
    added: p.added ?? [], modified: p.modified ?? [],
    removed: (p.removed ?? []).map((id) => ({ transaction_id: id })),
    next_cursor: next(i), has_more: i < pages.length - 1, accounts: [],
    ...(p.status === undefined ? {} : { transactions_update_status: p.status }),
  })));
  return [start || undefined, ...pages.slice(1).map((_, i) => next(i) || undefined)];
}

async function seedAccount(cursor: string | null): Promise<void> {
  await db.query(
    `INSERT INTO accounts (id, name, type, subtype, mask, persistent_account_id, access_token, cursor)
     VALUES ($1, 'Fabricated P640f Checking', 'depository', 'checking', '0640', $2, $3, $4)`,
    [ACCT, `${P}-persistent`, TOKEN, cursor]
  );
  // The same id the table holds, so the real reconcile finds nothing to remap.
  fake.accounts.set(TOKEN, [{
    account_id: ACCT, name: 'Fabricated P640f Checking', type: 'depository', subtype: 'checking',
    mask: '0640', persistent_account_id: `${P}-persistent`,
    balances: { current: null, available: null, iso_currency_code: 'USD' },
  }]);
}

// One transfer group and one property per seeded row position, so each row's pair is its own.
const transferGroups: number[] = [];
const properties: number[] = [];

/**
 * `n` identical stored rows under `old-<first>..`, inserted one at a time so their primary keys
 * ascend in that order. Each carries all seven owner values, and none of them is shared with another
 * row: its own note, category (with `rule_applied = FALSE`), watch time, transfer group and property,
 * and row 2 alone is hidden — so a rename that swapped two rows shows up as a value on the wrong
 * primary key. Returns the primary keys, lowest first.
 */
async function seedGroup(n: number, over: { amount?: number; name?: string; first?: number } = {}): Promise<number[]> {
  const ids: number[] = [];
  const first = over.first ?? 1;
  for (let k = first; k < first + n; k++) {
    const r = await db.query<{ id: number }>(
      `INSERT INTO transactions
         (plaid_transaction_id, account_id, date, amount, name, merchant_name, mapped_category, rule_applied, hidden, note,
          watched_at, transfer_group_id, property_id)
       VALUES ($1, $2, $3, $4, $5, $5, $6, FALSE, $7, $8, $9, $10, $11) RETURNING id`,
      [oldId(k), ACCT, DATE, over.amount ?? AMOUNT, over.name ?? NAME, `Fabricated P640f Pick ${k}`, k === 2,
       `Fabricated P640f note ${k}`, `2026-03-0${k}T10:00:00Z`, transferGroups[k - 1], properties[k - 1]]
    );
    ids.push(r.rows[0].id);
  }
  return ids;
}

interface StoredRow {
  id: number; plaid_transaction_id: string; amount: string; merchant_name: string | null;
  hidden: boolean; note: string | null; mapped_category: string | null; rule_applied: boolean;
  watched_at: string | null; transfer_group_id: number | null; property_id: number | null;
}

/** Every row on this file's account, in primary-key order. */
async function rows(): Promise<StoredRow[]> {
  return (await db.query<StoredRow>(
    `SELECT id, plaid_transaction_id, amount::text AS amount, merchant_name, hidden, note, mapped_category, rule_applied,
            watched_at::text AS watched_at, transfer_group_id, property_id
       FROM transactions WHERE account_id = $1 ORDER BY id`,
    [ACCT]
  )).rows;
}

/** The owner's values, keyed by primary key, which a correct walk never moves between rows. */
const owner = (r: StoredRow) => ({
  id: r.id, hidden: r.hidden, note: r.note, mapped_category: r.mapped_category, rule_applied: r.rule_applied,
  watched_at: r.watched_at, transfer_group_id: r.transfer_group_id, property_id: r.property_id,
});

/**
 * The real `runSync`, narrowed to this file's item; asserts the walk asked for exactly `cursors`.
 * The request log is cleared first, so a test that syncs twice checks each walk on its own.
 */
async function sync(cursors: (string | undefined)[]) {
  fake.requests.length = 0;
  const result = await runSync({ accountId: ACCT });
  expect(result.errors).toEqual([]);
  // Every queued page was served: a walk that stopped early would leave one behind.
  expect(fake.pages.get(TOKEN)).toEqual([]);
  expect(fake.requests.filter((q) => q.access_token === TOKEN).map((q) => q.cursor)).toEqual(cursors);
  return result;
}

/**
 * `sync`, also returning the `re-identified transactions after item change` lines it logged. That
 * line is the only trace of a re-identification an owner ever sees, so it must add up to the renames
 * that happened. The calls are copied before the restore, which clears them.
 */
async function syncLogged(cursors: (string | undefined)[]) {
  const logSpy = vi.spyOn(console, 'log');
  let result;
  let calls: unknown[][] = [];
  try {
    result = await sync(cursors);
  } finally {
    calls = [...logSpy.mock.calls];
    logSpy.mockRestore();
  }
  const lines = calls
    .map((c) => { try { return JSON.parse(String(c[0])); } catch { return null; } })
    .filter((l) => l !== null) as Record<string, unknown>[];
  const reLines = lines.filter((l) => l.message === RELOG) as { count: number }[];
  return { result, reLines, lines };
}

const HELD = 'cursor held until Plaid reports history complete';

/** The held-cursor lines: exactly one per walk, carrying the status and no id, token or name. */
function expectOneHeldLine(lines: Record<string, unknown>[], status: string): void {
  const held = lines.filter((l) => l.message === HELD);
  expect(held).toHaveLength(1);
  expect(Object.keys(held[0]).sort()).toEqual(['level', 'message', 'scope', 'status', 'time']);
  expect(held[0].status).toBe(status);
}

async function storedCursor(): Promise<string | null> {
  return (await db.query<{ cursor: string | null }>('SELECT cursor FROM accounts WHERE id = $1', [ACCT])).rows[0].cursor;
}

let startedAt = '';

async function cleanup(): Promise<void> {
  await db.query('DELETE FROM transactions WHERE account_id = $1 OR plaid_transaction_id LIKE $2', [ACCT, `${P}-%`]);
  await db.query('DELETE FROM transaction_tombstones WHERE plaid_transaction_id LIKE $1', [`${P}-%`]);
  await db.query('DELETE FROM account_valuations WHERE account_id = $1', [ACCT]);
  await db.query('DELETE FROM accounts WHERE id = $1', [ACCT]);
}

beforeAll(async () => {
  for (let k = 1; k <= 4; k++) {
    transferGroups.push((await db.query<{ id: number }>('INSERT INTO transfer_groups DEFAULT VALUES RETURNING id')).rows[0].id);
    properties.push((await db.query<{ id: number }>(
      "INSERT INTO properties (nickname, type) VALUES ($1, 'rental') RETURNING id", [`Fabricated P640f Property ${k}`]
    )).rows[0].id);
  }
});

beforeEach(async () => {
  startedAt ||= (await db.query<{ now: string }>('SELECT now()::text AS now')).rows[0].now;
  fake.requests.length = 0;
  fake.pages.clear();
  fake.accounts.clear();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await db.query('DELETE FROM transfer_groups WHERE id = ANY($1)', [transferGroups]);
  await db.query('DELETE FROM properties WHERE id = ANY($1)', [properties]);
  await db.query('DELETE FROM sync_log WHERE ran_at >= $1', [startedAt]);
  await db.end();
});

describe('a sync walk re-identifies each stored row at most once, across pages', () => {
  it('PG-01: two identical rows, their new ids one per page: each row takes its own id, once', async () => {
    await seedAccount(null);
    const [a, b] = await seedGroup(2);
    const before = await rows();
    const cursors = queueWalk(null, [{ added: [txn(newId(1))] }, { added: [txn(newId(2))] }]);

    // Two renames happened, so the log adds up to two — not one more for a row claimed twice.
    const { result, reLines } = await syncLogged(cursors);

    const after = await rows();
    console.log(`[reid-dump pg01] ${JSON.stringify(after.map((r) => ({ ...owner(r), plaid_transaction_id: r.plaid_transaction_id })))}`);
    console.log(`[reid-dump pg01] re-identified log lines=${reLines.length} total count=${reLines.reduce((s, l) => s + l.count, 0)}`);

    expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([[a, newId(1)], [b, newId(2)]]);
    expect(after.map(owner)).toEqual(before.map(owner));
    expect(result.synced).toBe(0);
    expect(reLines.reduce((s, l) => s + l.count, 0)).toBe(2);
  });

  it('PG-02: three identical rows, three pages: the k-th id goes to the k-th lowest primary key', async () => {
    await seedAccount(null);
    const [a, b, c] = await seedGroup(3);
    const before = await rows();
    const cursors = queueWalk(null, [1, 2, 3].map((k) => ({ added: [txn(newId(k))] })));
    const result = await sync(cursors);

    const after = await rows();
    expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([[a, newId(1)], [b, newId(2)], [c, newId(3)]]);
    expect(after.map(owner)).toEqual(before.map(owner));
    expect(result.synced).toBe(0);
  });

  it('PG-03: an empty page between the two ids neither resets what the walk remembers nor blocks the second claim', async () => {
    await seedAccount(null);
    const [a, b] = await seedGroup(2);
    const before = await rows();
    const cursors = queueWalk(null, [{ added: [txn(newId(1))] }, { added: [] }, { added: [txn(newId(2))] }]);
    const result = await sync(cursors);

    const after = await rows();
    expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([[a, newId(1)], [b, newId(2)]]);
    expect(after.map(owner)).toEqual(before.map(owner));
    expect(result.synced).toBe(0);
  });

  it('PG-04: a tombstoned id on the middle page claims nothing, is stored nowhere, and the last page takes the next row', async () => {
    await seedAccount(null);
    const [a, b, c] = await seedGroup(3);
    const tomb = `${P}-tomb-x`;
    await db.query('INSERT INTO transaction_tombstones (plaid_transaction_id) VALUES ($1)', [tomb]);
    const tombsBefore = (await db.query('SELECT plaid_transaction_id, deleted_at::text FROM transaction_tombstones WHERE plaid_transaction_id LIKE $1', [`${P}-%`])).rows;
    const before = await rows();
    const cursors = queueWalk(null, [{ added: [txn(newId(1))] }, { added: [txn(tomb)] }, { added: [txn(newId(3))] }]);
    const result = await sync(cursors);

    const after = await rows();
    console.log(`[reid-dump pg04] ${JSON.stringify(after.map((r) => ({ ...owner(r), plaid_transaction_id: r.plaid_transaction_id })))}`);
    expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([[a, newId(1)], [b, newId(3)], [c, oldId(3)]]);
    expect(after.map(owner)).toEqual(before.map(owner));
    const carrying = await db.query('SELECT 1 FROM transactions WHERE plaid_transaction_id = $1', [tomb]);
    expect(carrying.rowCount).toBe(0);
    const tombsAfter = (await db.query('SELECT plaid_transaction_id, deleted_at::text FROM transaction_tombstones WHERE plaid_transaction_id LIKE $1', [`${P}-%`])).rows;
    expect(tombsAfter).toEqual(tombsBefore);
    expect(tombsAfter).toHaveLength(1);
    expect(result.synced).toBe(0);
  });

  it('PG-04a: a tombstoned id on the page after a rename leaves the second row on its old id', async () => {
    await seedAccount(null);
    const [a, b] = await seedGroup(2);
    const tomb = `${P}-tomb-x`;
    await db.query('INSERT INTO transaction_tombstones (plaid_transaction_id) VALUES ($1)', [tomb]);
    const cursors = queueWalk(null, [{ added: [txn(newId(1))] }, { added: [txn(tomb)] }]);
    const result = await sync(cursors);

    expect((await rows()).map((r) => [r.id, r.plaid_transaction_id])).toEqual([[a, newId(1)], [b, oldId(2)]]);
    expect((await db.query('SELECT 1 FROM transactions WHERE plaid_transaction_id = $1', [tomb])).rowCount).toBe(0);
    expect(result.synced).toBe(0);
  });

  it('PG-04b: a tombstoned id on the first page spends no claim, so the next page takes the lowest row', async () => {
    await seedAccount(null);
    const [a, b] = await seedGroup(2);
    const tomb = `${P}-tomb-x`;
    await db.query('INSERT INTO transaction_tombstones (plaid_transaction_id) VALUES ($1)', [tomb]);
    const cursors = queueWalk(null, [{ added: [txn(tomb)] }, { added: [txn(newId(2))] }]);
    const result = await sync(cursors);

    expect((await rows()).map((r) => [r.id, r.plaid_transaction_id])).toEqual([[a, newId(2)], [b, oldId(2)]]);
    expect((await db.query('SELECT 1 FROM transactions WHERE plaid_transaction_id = $1', [tomb])).rowCount).toBe(0);
    expect(result.synced).toBe(0);
  });

  it('PG-05: one new id for two rows leaves the second on its old id, and an unrelated later row is inserted once', async () => {
    await seedAccount(null);
    const [a, b] = await seedGroup(2);
    const before = await rows();
    // A later date as well as a different name: page 2's date range then excludes the group, so the
    // renamed row is not even read there — and still must not be duplicated.
    const other = txn(`${P}-other-1`, { date: '2026-03-20', name: 'Fabricated P640f Grocer', merchant_name: 'Fabricated P640f Grocer' });
    const cursors = queueWalk(null, [{ added: [txn(newId(1))] }, { added: [other] }]);
    const result = await sync(cursors);

    const after = await rows();
    const group = after.filter((r) => r.id === a || r.id === b);
    expect(group.map((r) => [r.id, r.plaid_transaction_id])).toEqual([[a, newId(1)], [b, oldId(2)]]);
    expect(group.map(owner)).toEqual(before.map(owner));
    expect(after.filter((r) => r.plaid_transaction_id === other.transaction_id)).toHaveLength(1);
    expect(after).toHaveLength(3);
    expect(result.synced).toBe(1);
  });

  it('PG-06: modified for an id renamed on an earlier page refreshes that row and never inserts a third', async () => {
    await seedAccount(null);
    const [a, b] = await seedGroup(2);
    const before = await rows();
    const revised = 'Fabricated P640f Cafe Revised';
    const cursors = queueWalk(null, [
      { added: [txn(newId(1))] },
      { added: [txn(newId(2))], modified: [txn(newId(1), { merchant_name: revised })] },
    ]);
    const result = await sync(cursors);

    const after = await rows();
    expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([[a, newId(1)], [b, newId(2)]]);
    expect(after[0].merchant_name).toBe(revised);
    expect(after.map(owner)).toEqual(before.map(owner));
    expect(result.synced).toBe(0);
  });

  it('PG-07: the same new id on two pages claims one row only, and is not counted again', async () => {
    await seedAccount(null);
    const [a, b] = await seedGroup(2);
    const before = await rows();
    const cursors = queueWalk(null, [{ added: [txn(newId(1))] }, { added: [txn(newId(1))] }]);
    const result = await sync(cursors);

    const after = await rows();
    expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([[a, newId(1)], [b, oldId(2)]]);
    expect(after.map(owner)).toEqual(before.map(owner));
    expect(result.synced).toBe(0);
  });

  it('PG-08: two genuine identical transactions on two pages, no stored history, are both stored', async () => {
    await seedAccount(null);
    const cursors = queueWalk(null, [{ added: [txn(`${P}-c-1`)] }, { added: [txn(`${P}-c-2`)] }]);
    const result = await sync(cursors);

    expect((await rows()).map((r) => r.plaid_transaction_id)).toEqual([`${P}-c-1`, `${P}-c-2`]);
    expect(result.synced).toBe(2);
  });

  it('PG-09: a row inserted by modified on page 1 is not renamed by a same-key added id on page 2', async () => {
    await seedAccount(null);
    const cursors = queueWalk(null, [{ modified: [txn(`${P}-m-1`)] }, { added: [txn(`${P}-c-2`)] }]);
    const result = await sync(cursors);

    expect((await rows()).map((r) => r.plaid_transaction_id)).toEqual([`${P}-m-1`, `${P}-c-2`]);
    // Only the `added` insert counts; `modified` has never been counted.
    expect(result.synced).toBe(1);
  });

  it('PG-10: a single page carrying both new ids still pairs them in order (unchanged)', async () => {
    await seedAccount(null);
    const [a, b] = await seedGroup(2);
    const before = await rows();
    const cursors = queueWalk(null, [{ added: [txn(newId(1)), txn(newId(2))] }]);
    const result = await sync(cursors);

    const after = await rows();
    expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([[a, newId(1)], [b, newId(2)]]);
    expect(after.map(owner)).toEqual(before.map(owner));
    expect(result.synced).toBe(0);
  });

  it('PG-12: an opposite-sign amount is a different transaction; only the same-key id claims the stored row', async () => {
    await seedAccount(null);
    const [a] = await seedGroup(1, { amount: 5 });
    const opposite = txn(`${P}-opp-1`, { amount: -5 });
    const cursors = queueWalk(null, [{ added: [opposite] }, { added: [txn(newId(1), { amount: 5 })] }]);
    const result = await sync(cursors);

    const after = await rows();
    expect(after.map((r) => [r.plaid_transaction_id, r.amount])).toEqual([[newId(1), '5.00'], [opposite.transaction_id, '-5.00']]);
    expect(after[0].id).toBe(a);
    expect(after[1].id).not.toBe(a);
    expect(result.synced).toBe(1);
  });

  it('PG-13: a stored-cursor walk with no removed licence never re-identifies: a same-key new id is a second transaction', async () => {
    await seedAccount(STORED_CURSOR);
    const [r] = await seedGroup(1);
    const before = await rows();
    const cursors = queueWalk(STORED_CURSOR, [{ added: [txn(newId(1))] }]);
    const result = await sync(cursors);

    const after = await rows();
    expect(after.map((x) => x.plaid_transaction_id)).toEqual([oldId(1), newId(1)]);
    expect(owner(after[0])).toEqual(owner(before[0]));
    expect(after[0].id).toBe(r);
    expect(result.synced).toBe(1);
  });

  it('PG-14: the same delivery from no cursor still re-identifies the stored row in place', async () => {
    await seedAccount(null);
    const [r] = await seedGroup(1);
    const before = await rows();
    // Declared complete, so this stays the designed path: one walk, renamed in place, cursor stored.
    const cursors = queueWalk(null, [{ added: [txn(newId(1))], status: 'HISTORICAL_UPDATE_COMPLETE' }]);
    const result = await sync(cursors);

    const after = await rows();
    expect(after.map((x) => [x.id, x.plaid_transaction_id])).toEqual([[r, newId(1)]]);
    expect(await storedCursor()).toBe(`${P}-next-1`);
    expect(after.map(owner)).toEqual(before.map(owner));
    expect(result.synced).toBe(0);
  });

  it('PG-15: a stored-cursor walk that retires the old id renames the row in place instead of deleting it', async () => {
    await seedAccount(STORED_CURSOR);
    const [r] = await seedGroup(1);
    const before = await rows();
    const cursors = queueWalk(STORED_CURSOR, [{ added: [txn(newId(1))], removed: [oldId(1)] }]);
    const { result, reLines } = await syncLogged(cursors);

    const after = await rows();
    expect(after.map((x) => [x.id, x.plaid_transaction_id])).toEqual([[r, newId(1)]]);
    expect(after.map(owner)).toEqual(before.map(owner));
    expect((await db.query('SELECT 1 FROM transactions WHERE plaid_transaction_id = $1', [oldId(1)])).rowCount).toBe(0);
    expect(result.synced).toBe(0);
    expect(reLines.map((l) => l.count)).toEqual([1]);
  });

  it('PG-15b: the licence works across pages in either order (added then removed, removed then added)', async () => {
    const orders: FakePage[][] = [
      [{ added: [txn(newId(1))] }, { removed: [oldId(1)] }],
      [{ removed: [oldId(1)] }, { added: [txn(newId(1))] }],
    ];
    for (const pages of orders) {
      await cleanup();
      await seedAccount(STORED_CURSOR);
      const [r] = await seedGroup(1);
      const before = await rows();
      const cursors = queueWalk(STORED_CURSOR, pages);
      const { result, reLines } = await syncLogged(cursors);

      const after = await rows();
      expect(after.map((x) => [x.id, x.plaid_transaction_id])).toEqual([[r, newId(1)]]);
      expect(after.map(owner)).toEqual(before.map(owner));
      expect((await db.query('SELECT 1 FROM transactions WHERE plaid_transaction_id = $1', [oldId(1)])).rowCount).toBe(0);
      expect(result.synced).toBe(0);
      expect(reLines.map((l) => l.count)).toEqual([1]);
    }
  });

  it('PG-15c: only the retired row is claimable, and once: a same-key second new id is inserted, a repeated one claims nothing', async () => {
    await seedAccount(STORED_CURSOR);
    const [r1, r2] = await seedGroup(2);
    const before = await rows();
    const cursors = queueWalk(STORED_CURSOR, [{ added: [txn(newId(1)), txn(newId(9))], removed: [oldId(1)] }]);
    const result = await sync(cursors);

    const after = await rows();
    expect(after.map((x) => x.plaid_transaction_id)).toEqual([newId(1), oldId(2), newId(9)]);
    expect(after.slice(0, 2).map((x) => x.id)).toEqual([r1, r2]);
    expect(after.slice(0, 2).map(owner)).toEqual(before.map(owner));
    expect(result.synced).toBe(1);

    // The same new id on two pages with BOTH rows retired: the first delivery claims the lower row,
    // the repeat claims nothing (a second claim would rename the other row to an id already stored),
    // and the other retired row is deleted as Plaid asked.
    await cleanup();
    await seedAccount(STORED_CURSOR);
    const [q1] = await seedGroup(2);
    const qBefore = await rows();
    const again = queueWalk(STORED_CURSOR, [
      { added: [txn(newId(1))], removed: [oldId(1), oldId(2)] },
      { added: [txn(newId(1))] },
    ]);
    const second = await sync(again);
    const qAfter = await rows();
    expect(qAfter.map((x) => [x.id, x.plaid_transaction_id])).toEqual([[q1, newId(1)]]);
    expect(owner(qAfter[0])).toEqual(owner(qBefore[0]));
    expect(second.synced).toBe(0);
  });

  it('PG-15d: a removed id of a different key licenses nothing: the new id is inserted and the retired row deleted', async () => {
    await seedAccount(STORED_CURSOR);
    const [r] = await seedGroup(1);
    await seedGroup(1, { first: 2, name: 'Fabricated P640f Other Shop' });
    const before = await rows();
    const cursors = queueWalk(STORED_CURSOR, [{ added: [txn(newId(1))], removed: [oldId(2)] }]);
    const result = await sync(cursors);

    const after = await rows();
    expect(after.map((x) => x.plaid_transaction_id)).toEqual([oldId(1), newId(1)]);
    expect(owner(after[0])).toEqual(owner(before[0]));
    expect(after[0].id).toBe(r);
    expect(result.synced).toBe(1);
  });

  it('PG-15e: a claimant Plaid retires later in the walk takes nothing; the row goes to the id Plaid ends on', async () => {
    await seedAccount(STORED_CURSOR);
    const [r] = await seedGroup(1);
    const before = await rows();
    // A double reissue in one walk: old-1 becomes new-1, then new-1 becomes new-2.
    const cursors = queueWalk(STORED_CURSOR, [
      { added: [txn(newId(1))], removed: [oldId(1)] },
      { added: [txn(newId(2))], removed: [newId(1)] },
    ]);
    const result = await sync(cursors);

    const after = await rows();
    expect(after.map((x) => [x.id, x.plaid_transaction_id])).toEqual([[r, newId(2)]]);
    expect(after.map(owner)).toEqual(before.map(owner));
    expect(result.synced).toBe(0);

    // Guard: the same retirement with no further same-key id. Plaid's net view is that the
    // transaction is gone, so the stored row is deleted and nothing is counted.
    await cleanup();
    await seedAccount(STORED_CURSOR);
    await seedGroup(1);
    const gone = queueWalk(STORED_CURSOR, [
      { added: [txn(newId(1))], removed: [oldId(1)] },
      { removed: [newId(1)] },
    ]);
    const second = await sync(gone);
    expect(await rows()).toEqual([]);
    expect(second.synced).toBe(0);
  });

  it('PG-16: a re-auth walk ending on INITIAL_UPDATE_COMPLETE keeps the cursor NULL, so the historical pull re-identifies', async () => {
    await seedAccount(null);
    const [r] = await seedGroup(1);
    const before = await rows();

    const run1 = queueWalk(null, [{ added: [], status: 'INITIAL_UPDATE_COMPLETE' }], 'r1-');
    expectOneHeldLine((await syncLogged(run1)).lines, 'INITIAL_UPDATE_COMPLETE');
    expect(await storedCursor()).toBeNull();

    const run2 = queueWalk(null, [{ added: [txn(newId(1))], status: 'HISTORICAL_UPDATE_COMPLETE' }], 'r2-');
    const result = await sync(run2);

    const after = await rows();
    expect(after.map((x) => [x.id, x.plaid_transaction_id])).toEqual([[r, newId(1)]]);
    expect(after.map(owner)).toEqual(before.map(owner));
    expect(result.synced).toBe(0);
    expect(await storedCursor()).toBe(`${P}-r2-next-1`);
  });

  it('PG-16b: a NOT_READY walk answering with an empty cursor leaves no usable cursor, and the next walk re-identifies', async () => {
    await seedAccount(null);
    const [r] = await seedGroup(1);
    const before = await rows();

    const run1 = queueWalk(null, [{ added: [], status: 'NOT_READY', next: '' }], 'r1-');
    expectOneHeldLine((await syncLogged(run1)).lines, 'NOT_READY');
    // Either NULL or '' would do — '' is treated as no cursor — but it must not be a real cursor.
    expect(await storedCursor()).toBeFalsy();

    const run2 = queueWalk(null, [{ added: [txn(newId(1))], status: 'HISTORICAL_UPDATE_COMPLETE' }], 'r2-');
    const result = await sync(run2);

    const after = await rows();
    expect(after.map((x) => [x.id, x.plaid_transaction_id])).toEqual([[r, newId(1)]]);
    expect(after.map(owner)).toEqual(before.map(owner));
    expect(result.synced).toBe(0);

    // An account whose cursor is ALREADY '' — as code before this fix stored a NOT_READY answer —
    // is walked from no cursor and re-identifies, rather than being treated as an incremental walk.
    await cleanup();
    await seedAccount('');
    const [e] = await seedGroup(1);
    const eBefore = await rows();
    const run3 = queueWalk('', [{ added: [txn(newId(1))], status: 'HISTORICAL_UPDATE_COMPLETE' }], 'r3-');
    expect((await sync(run3)).synced).toBe(0);
    const eAfter = await rows();
    expect(eAfter.map((x) => [x.id, x.plaid_transaction_id])).toEqual([[e, newId(1)]]);
    expect(eAfter.map(owner)).toEqual(eBefore.map(owner));
  });

  it('PG-16c: rows a held-cursor walk writes are real writes: renamed in place, then joined by the historical pull', async () => {
    await seedAccount(null);
    const [r1, r2] = await seedGroup(2);
    const before = await rows();

    // Run 1: the initial pull carries one of the two, and the cursor is held.
    const run1 = queueWalk(null, [{ added: [txn(newId(1))], status: 'INITIAL_UPDATE_COMPLETE' }], 'r1-');
    const first = await sync(run1);
    const mid = await rows();
    expect(mid.map((x) => [x.id, x.plaid_transaction_id])).toEqual([[r1, newId(1)], [r2, oldId(2)]]);
    expect(mid.map(owner)).toEqual(before.map(owner));
    expect(first.synced).toBe(0);
    expect(await storedCursor()).toBeNull();

    // Run 2, again from no cursor: the historical pull re-delivers new-1 and adds new-2.
    const run2 = queueWalk(null, [{ added: [txn(newId(1)), txn(newId(2))], status: 'HISTORICAL_UPDATE_COMPLETE' }], 'r2-');
    const second = await sync(run2);
    const after = await rows();
    expect(after.map((x) => [x.id, x.plaid_transaction_id])).toEqual([[r1, newId(1)], [r2, newId(2)]]);
    expect(after.map(owner)).toEqual(before.map(owner));
    expect(second.synced).toBe(0);
    expect(await storedCursor()).toBe(`${P}-r2-next-1`);
  });

  it('PG-17: after HISTORICAL_UPDATE_COMPLETE the next walk is incremental, and a same-key second purchase is inserted', async () => {
    await seedAccount(null);
    const [r] = await seedGroup(1);
    const before = await rows();

    const run1 = queueWalk(null, [{ added: [txn(newId(1))], status: 'HISTORICAL_UPDATE_COMPLETE' }], 'r1-');
    expect((await sync(run1)).synced).toBe(0);
    expect(await storedCursor()).toBe(`${P}-r1-next-1`);

    // Run 2 reports UNKNOWN, which must keep today's behaviour: the cursor is stored, and one line
    // says so, carrying no ids.
    const run2 = queueWalk(`${P}-r1-next-1`, [{ added: [txn(newId(2))], status: 'TRANSACTIONS_UPDATE_STATUS_UNKNOWN' }], 'r2-');
    const logSpy = vi.spyOn(console, 'log');
    let result;
    let calls: unknown[][] = [];
    try {
      result = await sync(run2);
    } finally {
      calls = [...logSpy.mock.calls];
      logSpy.mockRestore();
    }
    const unknownLines = calls.map((c) => String(c[0])).filter((l) => l.includes('update status unknown'));

    const after = await rows();
    expect(after.map((x) => x.plaid_transaction_id)).toEqual([newId(1), newId(2)]);
    expect(after[0].id).toBe(r);
    expect(owner(after[0])).toEqual(owner(before[0]));
    expect(result.synced).toBe(1);
    expect(await storedCursor()).toBe(`${P}-r2-next-1`);
    expect(unknownLines).toHaveLength(1);
    expect(Object.keys(JSON.parse(unknownLines[0])).sort()).toEqual(['level', 'message', 'scope', 'time']);
  });
});
