// Two accounts in one link that share a mask and a type — E*TRADE's brokerage and stock plan under
// one account number — must both be kept, and a re-link must pair each with its own old row.
// Fabricated ids and names throughout; nothing here is from a real account.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { POST as exchangeToken } from './route';

const fake = vi.hoisted(() => ({ token: '', accounts: [] as unknown[] }));

vi.mock('@/lib/plaid', () => ({
  plaidClient: () => ({
    itemPublicTokenExchange: async () => ({ data: { access_token: fake.token } }),
    accountsGet: async () => ({ data: { accounts: fake.accounts } }),
    itemGet: async () => ({ data: { item: { institution_id: null }, status: {} } }),
  }),
}));

const P = 'sm-test';
const acct = (id: string, name: string, subtype: string) => ({
  account_id: id, name, type: 'investment', subtype, mask: '0000', persistent_account_id: null,
  balances: { current: null, available: null, iso_currency_code: 'USD' },
});

async function link(token: string, accounts: unknown[]) {
  fake.token = token;
  fake.accounts = accounts;
  const res = await exchangeToken(new NextRequest('http://localhost/api/v1/plaid/exchange-token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_token: `${P}-public` }),
  }));
  expect((await res.json()).success).toBe(true);
}

const rows = async () =>
  (await db.query<{ id: string; subtype: string; access_token: string }>(
    `SELECT id, subtype, access_token FROM accounts WHERE id LIKE $1 ORDER BY subtype`, [`${P}-%`]
  )).rows;

beforeEach(async () => { await db.query('DELETE FROM accounts WHERE id LIKE $1', [`${P}-%`]); });
afterAll(async () => {
  await db.query('DELETE FROM accounts WHERE id LIKE $1', [`${P}-%`]);
  await db.end();
});

describe('exchange-token with two accounts under one number', () => {
  it('keeps both accounts of a single link', async () => {
    await link(`${P}-token-1`, [
      acct(`${P}-brokerage-1`, 'Fabricated Brokerage -0000', 'brokerage'),
      acct(`${P}-plan-1`, 'Fabricated Stock Plan -0000', 'stock plan'),
    ]);
    expect((await rows()).map((r) => r.id)).toEqual([`${P}-brokerage-1`, `${P}-plan-1`]);
  });

  it('re-attaches each to its own old row on a re-link with new ids', async () => {
    await link(`${P}-token-1`, [
      acct(`${P}-brokerage-1`, 'Fabricated Brokerage -0000', 'brokerage'),
      acct(`${P}-plan-1`, 'Fabricated Stock Plan -0000', 'stock plan'),
    ]);
    await link(`${P}-token-2`, [
      acct(`${P}-brokerage-2`, 'Fabricated Brokerage -0000', 'brokerage'),
      acct(`${P}-plan-2`, 'Fabricated Stock Plan -0000', 'stock plan'),
    ]);
    // The old rows survive with the new token; the new-id rows were folded into them.
    expect(await rows()).toEqual([
      { id: `${P}-brokerage-1`, subtype: 'brokerage', access_token: `${P}-token-2` },
      { id: `${P}-plan-1`, subtype: 'stock plan', access_token: `${P}-token-2` },
    ]);
  });
});
