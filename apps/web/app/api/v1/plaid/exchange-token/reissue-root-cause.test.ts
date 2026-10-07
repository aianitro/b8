// Why sync left reissued rows orphaned: the designed path, the path that bypasses it, and the cursor
// sync picks for an item whose accounts disagree (P6-40e, RC-01..RC-03).
//
// TIER 2, under `vitest.integration.config.mts` (collected by its `app/api/v1/**` glob) with the
// scratch-database guard in `setupFiles` — this file writes rows.
//
// WHAT IS FAKED, AND WHY ONLY THAT. `lib/plaid` and nothing else: the exchange-token route, `runSync`,
// the account reconcile, the balance recording and the re-identification matcher are all the real
// ones. The question this file answers is what the real code does with a given sequence of Plaid
// answers — a token change, a history re-delivered from no cursor, a delta that never mentions the
// history — so every layer between Plaid and the table has to be the one that runs in production.
// The fake records every `/transactions/sync` request, because the cursor sync SENDS is the finding.
//
// EVERY VALUE IS FABRICATED. Ids, tokens and cursors are `rc-p40e-` sentinels; amounts are small
// whole numbers; names are invented.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { runSync } from '@/lib/sync';
import { POST as exchangeToken } from './route';

const fake = vi.hoisted(() => ({
  /** Every `/transactions/sync` request, in order. */
  requests: [] as { access_token: string; cursor: string | undefined }[],
  /** Per token, the pages still to be served, in order. */
  pages: new Map<string, unknown[]>(),
  /** Per token, a page served to every request, for a test that syncs an item repeatedly. */
  always: new Map<string, unknown>(),
  /** Per token, what `/accounts/get` reports — read by the route and by sync's reconcile. */
  accounts: new Map<string, unknown[]>(),
  /** The access token `/item/public_token/exchange` hands back. */
  exchangeTo: '',
}));

vi.mock('@/lib/plaid', () => ({
  plaidClient: () => ({
    itemPublicTokenExchange: async () => ({ data: { access_token: fake.exchangeTo } }),
    // Another suite's leftover token gets no accounts, which reconciles to nothing.
    accountsGet: async (req: { access_token: string }) => ({ data: { accounts: fake.accounts.get(req.access_token) ?? [] } }),
    itemGet: async () => ({ data: { item: { institution_id: null }, status: {} } }),
    institutionsGetById: async () => {
      throw new Error('rc-p40e: institutionsGetById was not expected');
    },
    transactionsSync: async (req: { access_token: string; cursor?: string }) => {
      fake.requests.push({ access_token: req.access_token, cursor: req.cursor });
      const always = fake.always.get(req.access_token);
      if (always) return { data: always };
      const page = fake.pages.get(req.access_token)?.shift();
      if (!page) throw new Error('rc-p40e: sync asked for a page the test did not queue');
      return { data: page };
    },
  }),
}));

const P = 'rc-p40e';
const OLD_TOKEN = `${P}-token-old`;
const NEW_TOKEN = `${P}-token-new`;
const MIX_TOKEN = `${P}-token-mixed`;
const OLD_CURSOR = `${P}-cursor-old`;
const MIX_CURSOR = `${P}-cursor-mixed`;
const ACCT_1 = `${P}-acct-1`;
const ACCT_2 = `${P}-acct-2`;
const MIX_NULL = `${P}-acct-mix-null`;
const MIX_SET = `${P}-acct-mix-set`;
const MY_ACCOUNTS = [ACCT_1, ACCT_2, MIX_NULL, MIX_SET];

/** The four stored transactions, and the dates/accounts Plaid re-delivers them under new ids. */
const HISTORY = [
  { k: 1, account: ACCT_1, date: '2026-01-03', amount: 1 },
  { k: 2, account: ACCT_1, date: '2026-01-05', amount: 2 },
  { k: 3, account: ACCT_2, date: '2026-01-07', amount: 3 },
  { k: 4, account: ACCT_2, date: '2026-01-09', amount: 4 },
];
const oldId = (k: number) => `${P}-old-${k}`;
const newId = (k: number) => `${P}-new-${k}`;
const nameOf = (k: number) => `Fabricated RC Shop ${k}`;

/** A posted Plaid transaction, as minimal as sync reads it. */
function txn(id: string, account: string, date: string, amount: number, name: string) {
  return {
    transaction_id: id, account_id: account, date, amount, name, merchant_name: name, pending: false,
    personal_finance_category: { primary: 'P40E_RC_FABRICATED' },
  };
}

function page(added: unknown[], next: string, hasMore: boolean) {
  return { added, modified: [], removed: [], next_cursor: next, has_more: hasMore, accounts: [] };
}

/** What `/accounts/get` says about the two linked accounts — the same ids, so no remap. */
function liveAccounts() {
  return [ACCT_1, ACCT_2].map((id, i) => ({
    account_id: id, name: `Fabricated RC Account ${i + 1}`, type: 'depository', subtype: 'checking',
    mask: `00${i + 1}`, persistent_account_id: `${P}-persistent-${i + 1}`,
    balances: { current: null, available: null, iso_currency_code: 'USD' },
  }));
}

let startedAt = '';

async function cleanup(): Promise<void> {
  await db.query('DELETE FROM transactions WHERE account_id = ANY($1) OR plaid_transaction_id LIKE $2', [MY_ACCOUNTS, `${P}-%`]);
  await db.query('DELETE FROM account_valuations WHERE account_id = ANY($1)', [MY_ACCOUNTS]);
  await db.query('DELETE FROM accounts WHERE id = ANY($1)', [MY_ACCOUNTS]);
}

async function seedLinkedItem(token: string, cursor: string): Promise<void> {
  for (const a of liveAccounts()) {
    await db.query(
      `INSERT INTO accounts (id, name, type, subtype, mask, persistent_account_id, access_token, cursor)
       VALUES ($1, $2, 'depository', 'checking', $3, $4, $5, $6)`,
      [a.account_id, a.name, a.mask, a.persistent_account_id, token, cursor]
    );
  }
  for (const h of HISTORY) {
    await db.query(
      `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, merchant_name)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [oldId(h.k), h.account, h.date, h.amount, nameOf(h.k)]
    );
  }
  // Owner-set values on one row, which a re-key must carry and a duplicate would not have.
  await db.query(
    `UPDATE transactions SET hidden = TRUE, note = 'Fabricated RC note', watched_at = '2026-01-04T10:00:00Z',
            mapped_category = 'Fabricated RC Pick', rule_applied = FALSE
      WHERE plaid_transaction_id = $1`,
    [oldId(1)]
  );
}

/** This file's linked rows: primary key, Plaid id and the owner-set columns, in primary-key order. */
async function linkedRows() {
  return (await db.query<{
    id: number; plaid_transaction_id: string; hidden: boolean; note: string | null;
    watched_at: string | null; mapped_category: string | null;
  }>(
    `SELECT id, plaid_transaction_id, hidden, note, watched_at::text AS watched_at, mapped_category
       FROM transactions WHERE account_id = ANY($1) ORDER BY id`,
    [[ACCT_1, ACCT_2]]
  )).rows;
}

beforeEach(async () => {
  startedAt ||= (await db.query<{ now: string }>('SELECT now()::text AS now')).rows[0].now;
  fake.requests.length = 0;
  fake.pages.clear();
  fake.always.clear();
  fake.accounts.clear();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await db.query('DELETE FROM sync_log WHERE ran_at >= $1', [startedAt]);
  await db.end();
});

describe('why reissued rows stayed orphaned', () => {
  it('RC-01: a token change through exchange-token nulls the cursor, and the full re-delivery re-keys every row in place', async () => {
    await seedLinkedItem(OLD_TOKEN, OLD_CURSOR);
    const before = await linkedRows();

    // The re-link: Plaid hands back a NEW token for the same two account ids.
    fake.exchangeTo = NEW_TOKEN;
    fake.accounts.set(NEW_TOKEN, liveAccounts());
    const res = await exchangeToken(new NextRequest('http://localhost/api/v1/plaid/exchange-token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_token: `${P}-public-token` }),
    }));
    expect((await res.json()).success).toBe(true);
    const accounts = (await db.query<{ access_token: string; cursor: string | null }>(
      'SELECT access_token, cursor FROM accounts WHERE id = ANY($1) ORDER BY id', [[ACCT_1, ACCT_2]]
    )).rows;
    expect(accounts).toEqual([{ access_token: NEW_TOKEN, cursor: null }, { access_token: NEW_TOKEN, cursor: null }]);

    // The whole history again, under new ids, across two pages — what Plaid sends a cursor-less sync.
    fake.pages.set(NEW_TOKEN, [
      page(HISTORY.slice(0, 2).map((h) => txn(newId(h.k), h.account, h.date, h.amount, nameOf(h.k))), `${P}-next-1`, true),
      page(HISTORY.slice(2).map((h) => txn(newId(h.k), h.account, h.date, h.amount, nameOf(h.k))), `${P}-next-2`, false),
    ]);
    const result = await runSync({ accountId: ACCT_1 });
    expect(result.errors).toEqual([]);

    const mine = fake.requests.filter((q) => q.access_token === NEW_TOKEN);
    expect(mine.map((q) => q.cursor)).toEqual([undefined, `${P}-next-1`]);
    const after = await linkedRows();
    // Same rows, same primary keys, renamed — no duplicate, owner-set values carried.
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(after.map((r) => r.plaid_transaction_id)).toEqual(HISTORY.map((h) => newId(h.k)));
    expect(after.map(({ plaid_transaction_id: _p, ...rest }) => rest))
      .toEqual(before.map(({ plaid_transaction_id: _p, ...rest }) => rest));
    expect(after[0]).toMatchObject({ hidden: true, note: 'Fabricated RC note', mapped_category: 'Fabricated RC Pick' });
  });

  it('RC-02: ids reissued on the SAME item never reach sync: an incremental delta leaves the old rows orphaned', async () => {
    await seedLinkedItem(OLD_TOKEN, OLD_CURSOR);
    const before = await linkedRows();
    fake.accounts.set(OLD_TOKEN, liveAccounts());
    // Plaid's history now uses new ids for the four (what 40e repairs), but a sync from the stored
    // cursor is handed only what changed since: one genuinely new transaction, no history.
    fake.pages.set(OLD_TOKEN, [
      page([txn(`${P}-delta-1`, ACCT_1, '2026-02-01', 5, 'Fabricated RC Delta')], `${P}-cursor-after-delta`, false),
    ]);
    const result = await runSync({ accountId: ACCT_1 });
    expect(result.errors).toEqual([]);

    // The stored cursor was sent: sync was incremental, as designed for an unchanged token.
    expect(fake.requests.filter((q) => q.access_token === OLD_TOKEN).map((q) => q.cursor)).toEqual([OLD_CURSOR]);
    const after = await linkedRows();
    // The four rows are untouched and still carry the ids Plaid no longer uses; none of the new ids
    // is stored; the only new row is the delta's.
    expect(after.slice(0, 4)).toEqual(before);
    expect(after.map((r) => r.plaid_transaction_id)).toEqual([...HISTORY.map((h) => oldId(h.k)), `${P}-delta-1`]);
    const stored = await db.query('SELECT 1 FROM transactions WHERE plaid_transaction_id = ANY($1)', [HISTORY.map((h) => newId(h.k))]);
    expect(stored.rowCount).toBe(0);
  });

  it('RC-03: an item whose accounts disagree on the cursor syncs from no cursor, whichever account the table returns first', async () => {
    // One token, two accounts: one never synced (NULL cursor — an account added to an existing item),
    // one with a cursor. Plaid's answer is irrelevant here; the request is the finding.
    for (const id of [MIX_NULL, MIX_SET]) {
      await db.query(
        `INSERT INTO accounts (id, name, type, access_token) VALUES ($1, $2, 'depository', $3)`,
        [id, `Fabricated RC Mixed ${id.endsWith('null') ? 'A' : 'B'}`, MIX_TOKEN]
      );
    }
    fake.always.set(MIX_TOKEN, page([], `${P}-mixed-next`, false));

    // The order sync's own `SELECT ... FROM accounts WHERE access_token IS NOT NULL` returns them
    // in, which has no ORDER BY and so is the table's physical order.
    const physicalOrder = async () => (await db.query<{ id: string }>(
      'SELECT id FROM accounts WHERE access_token IS NOT NULL'
    )).rows.map((r) => r.id).filter((id) => id === MIX_NULL || id === MIX_SET);

    // Restores the mixed state (the sync before wrote one cursor to both), then moves whichever row
    // comes first until `first` does: an UPDATE writes a new row version, which lands after the
    // other row more often than not, so a few tries flip the order.
    const arrange = async (first: string) => {
      await db.query('UPDATE accounts SET cursor = NULL WHERE id = $1', [MIX_NULL]);
      await db.query('UPDATE accounts SET cursor = $2 WHERE id = $1', [MIX_SET, MIX_CURSOR]);
      for (let i = 0; i < 200; i++) {
        const order = await physicalOrder();
        if (order[0] === first) return order;
        await db.query('UPDATE accounts SET name = name WHERE id = $1', [order[0]]);
      }
      throw new Error('rc-p40e: could not arrange the physical row order');
    };

    const observed: { first: string; cursor: string | undefined }[] = [];
    for (const first of [MIX_NULL, MIX_SET]) {
      const order = await arrange(first);
      fake.requests.length = 0;
      const result = await runSync({ accountId: MIX_NULL });
      expect(result.errors).toEqual([]);
      observed.push({ first: order[0], cursor: fake.requests.find((q) => q.access_token === MIX_TOKEN)?.cursor });
    }

    // Both physical orders were exercised, and in both the item synced from no cursor — so the
    // account that never received its history receives it, whichever row the table yields first.
    expect(observed).toEqual([
      { first: MIX_NULL, cursor: undefined },
      { first: MIX_SET, cursor: undefined },
    ]);
  });
});
