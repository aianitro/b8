// Unspent budget against a scratch database: the month close, allocation, and the effective plan.
// Fabricated categories, account and transactions throughout, under one prefix, removed afterwards.

import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import db from '@/lib/db';
import { recordCloses, loadBuckets } from '@/lib/unspentStore';
import { POST as allocateRoute } from './allocate/route';

const P = 'unspent-test';
const ACCOUNT = `${P}-acct`;
let under = 0, over = 0, dest = 0, income = 0;

const post = (body: unknown) => allocateRoute(new NextRequest('http://localhost/api/v1/budget/unspent/allocate', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));

async function cleanup() {
  await db.query(`DELETE FROM transactions WHERE plaid_transaction_id LIKE $1`, [`${P}-%`]);
  await db.query(`DELETE FROM accounts WHERE id = $1`, [ACCOUNT]);
  await db.query(`DELETE FROM budget_categories WHERE name LIKE $1`, [`${P}-%`]);
}

beforeEach(async () => {
  await cleanup();
  // September 2026 is closed in one pass; clear it so this run closes it afresh.
  await db.query('DELETE FROM budget_unspent WHERE year = 2026 AND month = 9');
  await db.query(`INSERT INTO accounts (id, name, type, landscape, track_transactions) VALUES ($1, 'Fabricated', 'depository', 'operational', TRUE)`, [ACCOUNT]);
  const cat = async (name: string, monthly: number[] | null, annual: number, isIncome = false) =>
    (await db.query<{ id: number }>(
      `INSERT INTO budget_categories (name, annual_budget, monthly_amounts, is_income) VALUES ($1, $2, $3, $4) RETURNING id`,
      [`${P}-${name}`, annual, monthly, isIncome])).rows[0].id;
  under = await cat('under', null, 1200);                             // 100 a month, spends 60 in Sep
  over = await cat('over', Array(12).fill(50), 600);                  // 50 a month, spends 80 in Sep
  dest = await cat('dest', Array(12).fill(10), 120);
  income = await cat('income', null, 1200, true);
  const txn = (n: number, cat: string, amount: number) => db.query(
    `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, mapped_category) VALUES ($1, $2, '2026-09-15', $3, 'Fabricated', $4)`,
    [`${P}-t${n}`, ACCOUNT, amount, `${P}-${cat}`]);
  await txn(1, 'under', 60);
  await txn(2, 'over', 80);
});

afterAll(async () => {
  await cleanup();
  await db.query('DELETE FROM budget_unspent WHERE year = 2026 AND month = 9');
  await db.end();
});

const closeOf = async (id: number) =>
  (await db.query<{ amount: string; planned: string; actual: string }>(
    'SELECT amount::text, planned::text, actual::text FROM budget_unspent WHERE category_id = $1 AND year = 2026 AND month = 9', [id])).rows[0];

describe('the month close', () => {
  it('waits out the grace days, then records each spending category once — zero when over', async () => {
    await recordCloses(new Date('2026-10-03T12:00:00'));
    expect(await closeOf(under)).toBeUndefined();

    await recordCloses(new Date('2026-10-04T12:00:00'));
    expect(await closeOf(under)).toEqual({ amount: '40.00', planned: '100.00', actual: '60.00' });
    expect(await closeOf(over)).toEqual({ amount: '0.00', planned: '50.00', actual: '80.00' });
    expect(await closeOf(income)).toBeUndefined();

    // Closed once: a late refund does not reopen it.
    await db.query(`INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, mapped_category) VALUES ($1, $2, '2026-09-20', -30, 'Fabricated refund', $3)`, [`${P}-late`, ACCOUNT, `${P}-over`]);
    await recordCloses(new Date('2026-10-20T12:00:00'));
    expect((await closeOf(over)).amount).toBe('0.00');

    const buckets = await loadBuckets();
    expect(buckets.find((b) => b.categoryId === under)?.balance).toBe(40);
    expect(buckets.find((b) => b.categoryId === over)).toBeUndefined();
  });
});

describe('allocation', () => {
  beforeEach(async () => { await recordCloses(new Date('2026-10-04T12:00:00')); });

  it('refuses more than the balance, a closed month, and a non-spending destination', async () => {
    const now = { toYear: 2099, toMonth: 1 };
    expect((await post({ categoryId: under, amount: 40.01, action: 'release' })).status).toBe(400);
    expect((await post({ categoryId: under, amount: 5, action: 'carry', toCategoryId: dest, toYear: 2026, toMonth: 9 })).status).toBe(400);
    expect((await post({ categoryId: under, amount: 5, action: 'carry', toCategoryId: income, ...now })).status).toBe(400);
  });

  it('carries into a future month, raising that month\'s effective plan, and releases the rest', async () => {
    expect((await post({ categoryId: under, amount: 25, action: 'carry', toCategoryId: dest, toYear: 2099, toMonth: 3 })).status).toBe(201);
    expect((await post({ categoryId: under, amount: 15, action: 'release' })).status).toBe(201);
    expect((await post({ categoryId: under, amount: 0.01, action: 'release' })).status).toBe(400);

    const eb = await db.query<{ annual: string; mar: string; feb: string }>(
      `SELECT annual_budget::text AS annual, monthly_amounts[3]::text AS mar, monthly_amounts[2]::text AS feb FROM effective_budget(2099) WHERE category_id = $1`, [dest]);
    expect(eb.rows[0]).toEqual({ annual: '145.00', mar: '35.00', feb: '10.00' });

    const untouched = await db.query(`SELECT monthly_amounts FROM effective_budget(2099) WHERE category_id = $1`, [under]);
    expect(untouched.rows[0].monthly_amounts).toBeNull();
    expect((await loadBuckets()).find((b) => b.categoryId === under)?.balance).toBe(0);
  });
});
