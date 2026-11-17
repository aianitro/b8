// `PATCH /api/v1/transactions/[id]` with `{ date }` against a real Postgres: moving a cash row.
//
// TIER 2, under `vitest.integration.config.mts` with the scratch-database guard in `setupFiles`.
//
// WHY THIS CANNOT BE A PURE TEST. What the edit promises is which rows the UPDATE reaches: a
// hand-entered row on a wallet, its wallet-to-wallet mirror with it, and nothing else — not a
// bank-fed row, not a hand-entered row on a card, not the bank's half of a pair. That is the WHERE
// clause, and only the database can say what it matches.
//
// EVERY ROW IS FABRICATED and carries a `dte_` account id or a `manual_dte_` / `dte_` transaction id,
// so cleanup finds exactly what this file seeded.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { PATCH, GET } from './route';

const WALLET = 'dte_wallet';
const JAR = 'dte_jar';
const CHECKING = 'dte_checking';
const groupIds: number[] = [];

async function cleanup(): Promise<void> {
  await db.query('DELETE FROM transactions WHERE account_id = ANY($1)', [[WALLET, JAR, CHECKING]]);
  await db.query('DELETE FROM transfer_groups WHERE id = ANY($1)', [groupIds]);
  await db.query('DELETE FROM accounts WHERE id = ANY($1)', [[WALLET, JAR, CHECKING]]);
}

async function seedAccounts(): Promise<void> {
  await db.query(
    `INSERT INTO accounts (id, name, type, landscape, countable) VALUES
       ($1, 'Fabricated Wallet', 'depository', 'operational', true),
       ($2, 'Fabricated Jar', 'depository', 'operational', true),
       ($3, 'Fabricated Checking', 'depository', 'operational', false)
     ON CONFLICT (id) DO NOTHING`,
    [WALLET, JAR, CHECKING]
  );
}

async function seedTxn(account: string, plaidId: string, groupId: number | null = null): Promise<number> {
  const r = await db.query<{ id: number }>(
    `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, transfer_group_id)
     VALUES ($1, $2, DATE '2026-01-15', '4.25', 'Fabricated Row', $3) RETURNING id`,
    [plaidId, account, groupId]
  );
  return r.rows[0].id;
}

async function newGroup(): Promise<number> {
  const g = await db.query<{ id: number }>('INSERT INTO transfer_groups DEFAULT VALUES RETURNING id');
  groupIds.push(g.rows[0].id);
  return g.rows[0].id;
}

async function patchDate(id: number, date: unknown): Promise<{ status: number; body: { success: boolean; error?: { code: string } } }> {
  const response = await PATCH(
    new NextRequest(`http://localhost/api/v1/transactions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date }),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  return { status: response.status, body: await response.json() };
}

async function dateOf(id: number): Promise<string> {
  const r = await db.query<{ date: string }>('SELECT date::text FROM transactions WHERE id = $1', [id]);
  return r.rows[0].date;
}

async function editable(id: number): Promise<boolean> {
  const response = await GET(
    new NextRequest(`http://localhost/api/v1/transactions/${id}`),
    { params: Promise.resolve({ id: String(id) }) }
  );
  const body = await response.json();
  return body.data.dateEditable;
}

beforeEach(async () => {
  await cleanup();
  await seedAccounts();
});

afterAll(async () => {
  await cleanup();
  await db.end();
});

describe('moving a cash row to another day', () => {
  it('moves a hand-entered wallet row, and the detail offers it', async () => {
    const id = await seedTxn(WALLET, 'manual_dte_a');
    expect(await editable(id)).toBe(true);
    const res = await patchDate(id, '2026-01-10');
    expect(res.status).toBe(200);
    expect(await dateOf(id)).toBe('2026-01-10');
  });

  it('moves both halves of a wallet-to-wallet move together', async () => {
    const g = await newGroup();
    const out = await seedTxn(WALLET, 'manual_dte_out', g);
    const into = await seedTxn(JAR, 'manual_dte_in', g);
    expect((await patchDate(out, '2026-01-12')).status).toBe(200);
    expect(await dateOf(out)).toBe('2026-01-12');
    expect(await dateOf(into)).toBe('2026-01-12');
  });

  it('leaves the bank half of a cash pair where it is', async () => {
    const g = await newGroup();
    const cash = await seedTxn(WALLET, 'manual_dte_atm_cash', g);
    const bank = await seedTxn(CHECKING, 'dte_bank_atm', g);
    expect((await patchDate(cash, '2026-01-13')).status).toBe(200);
    expect(await dateOf(cash)).toBe('2026-01-13');
    expect(await dateOf(bank)).toBe('2026-01-15');
  });

  it('refuses a bank-fed row, even on a wallet', async () => {
    const id = await seedTxn(WALLET, 'dte_feed_row');
    expect(await editable(id)).toBe(false);
    const res = await patchDate(id, '2026-01-10');
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('NOT_EDITABLE');
    expect(await dateOf(id)).toBe('2026-01-15');
  });

  it('refuses a hand-entered row on an account that is not a wallet', async () => {
    const id = await seedTxn(CHECKING, 'manual_dte_checking');
    expect(await editable(id)).toBe(false);
    expect((await patchDate(id, '2026-01-10')).status).toBe(400);
    expect(await dateOf(id)).toBe('2026-01-15');
  });

  it('refuses a day in the future and a day that does not exist', async () => {
    const id = await seedTxn(WALLET, 'manual_dte_bad');
    expect((await patchDate(id, '2099-01-01')).status).toBe(400);
    const notADay = await patchDate(id, '2026-02-30');
    expect(notADay.status).toBe(400);
    expect(notADay.body.error?.code).toBe('INVALID_INPUT');
    expect((await patchDate(id, 'yesterday')).status).toBe(400);
    expect(await dateOf(id)).toBe('2026-01-15');
  });
});
