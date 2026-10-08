// `GET /api/v1/transactions/[id]` against a real Postgres: the detail sheet's read.
//
// TIER 2, under `vitest.integration.config.mts` with the scratch-database guard in `setupFiles`.
// What this pins is a property of the SQL and the route together, which a stubbed `db` could not
// show: that the query runs against the real schema, that `plaid_raw` is read but never returned,
// and that an unknown or malformed id is a 404 rather than a 500. Every row is fabricated and
// carries a `detail_route` id so cleanup finds exactly what this file seeded.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { GET } from './route';

const ACCOUNT = 'detail_route_acct';

async function cleanup(): Promise<void> {
  await db.query('DELETE FROM transactions WHERE account_id = $1', [ACCOUNT]);
  await db.query('DELETE FROM accounts WHERE id = $1', [ACCOUNT]);
}

async function get(id: number | string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await GET(
    new NextRequest(`http://localhost/api/v1/transactions/${id}`),
    { params: Promise.resolve({ id: String(id) }) }
  );
  return { status: response.status, body: await response.json() };
}

let enrichedId: number;
let bareId: number;

beforeAll(async () => {
  await cleanup();
  // No access token: this account must never be picked up by a sync another suite runs.
  await db.query(
    `INSERT INTO accounts (id, name, type, landscape) VALUES ($1, 'Fabricated Detail Checking', 'depository', 'operational')`,
    [ACCOUNT]
  );
  const raw = {
    amount: 999,
    location: { address: '1 Fabricated Way', city: 'Springfield', postal_code: '00000', lat: 12.5, lon: -45.25 },
    counterparties: [{ name: 'Fabricated Pay', type: 'payment_app', account_numbers: { iban: 'XX00' } }],
    a_key_nobody_named: 'must not leave the server',
  };
  enrichedId = (await db.query<{ id: number }>(
    `INSERT INTO transactions (plaid_transaction_id, account_id, date, authorized_date, amount, name, merchant_name,
                               plaid_category, plaid_category_detailed, location_city, location_region, website, plaid_raw)
     VALUES ('detail_route_1', $1, DATE '2026-03-04', DATE '2026-03-02', '4.25', 'SQ *FABRICATED', 'Fabricated Cafe',
             'FOOD_AND_DRINK', 'FOOD_AND_DRINK_COFFEE', 'Springfield', 'ST', 'example.com', $2)
     RETURNING id`,
    [ACCOUNT, JSON.stringify(raw)]
  )).rows[0].id;
  bareId = (await db.query<{ id: number }>(
    `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name)
     VALUES ('detail_route_2', $1, DATE '2026-03-05', '-10', 'Fabricated Deposit') RETURNING id`,
    [ACCOUNT]
  )).rows[0].id;
});

afterAll(async () => {
  await cleanup();
});

describe('GET /api/v1/transactions/[id]', () => {
  it('returns the curated detail, with the amount from the column', async () => {
    const { status, body } = await get(enrichedId);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      id: enrichedId, date: '2026-03-04', authorizedDate: '2026-03-02', amount: 4.25,
      title: 'Fabricated Cafe', bankDescription: 'SQ *FABRICATED',
      account: { id: ACCOUNT, name: 'Fabricated Detail Checking' },
      plaidCategory: 'Food and drink', plaidCategoryDetailed: 'Coffee', website: 'https://example.com/',
      location: { address: '1 Fabricated Way', city: 'Springfield', region: 'ST', postalCode: '00000' },
      mapsUrl: 'https://www.google.com/maps/search/?api=1&query=12.5%2C-45.25',
      counterparties: [{ name: 'Fabricated Pay', type: 'Payment app', website: null, logoUrl: null }],
      enriched: true,
    });
  });

  it('never sends the raw Plaid object or anything only it holds', async () => {
    const text = JSON.stringify((await get(enrichedId)).body);
    for (const leak of ['plaid_raw', 'a_key_nobody_named', 'must not leave', 'account_numbers', 'XX00']) {
      expect(text).not.toContain(leak);
    }
  });

  it('says a row with nothing captured is not enriched', async () => {
    const { body } = await get(bareId);
    expect(body.data).toMatchObject({ enriched: false, location: null, counterparties: [], amount: -10 });
  });

  it('is a 404 for an unknown or malformed id', async () => {
    expect((await get(2147483000)).status).toBe(404);
    expect((await get('abc')).status).toBe(404);
    expect((await get('1;DROP')).status).toBe(404);
  });
});
