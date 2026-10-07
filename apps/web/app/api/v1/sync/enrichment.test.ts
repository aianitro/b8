// `runSync` against a real Postgres, with only the Plaid boundary faked: the enrichment (P6-40b).
//
// TIER 2, under `vitest.integration.config.mts` with the scratch-database guard in `setupFiles` —
// this file writes rows, and the guard refuses to run it against the owner's real database.
//
// WHAT IS FAKED, AND WHY ONLY THAT. The same three modules P6-40a's `route.test.ts` beside this
// file replaces — `lib/plaid` (the client), `lib/plaidReconcile` and `lib/plaidBalances` — and
// nothing else. `runSync`, `syncItem`, the re-identification matcher, the rule lookup and both
// upserts are the real ones. Whether a stale logo survives a `modified` event, whether a date
// shifts, whether `plaid_raw` lands as an object or as a quoted string — all of those are
// properties of the SQL and of how its parameters are bound, and a stubbed `lib/db` would assert
// none of them.
//
// THE FIXTURES CARRY EVERY KEY OF THE SDK'S `Transaction`. `fullTxn` builds each one as a const
// declared `Required<Transaction>` (a declaration, not an `as`), so the compiler refuses it if a
// key is missing, and `plaid_raw`'s "as received" check compares key sets exactly. A fixture that
// left out, say, `check_number` would let a mapping that dropped null-valued keys pass, because
// there would be nothing to drop.
//
// DETERMINISTIC WITHOUT TRUNCATING ANYONE ELSE'S ROWS. Every sync is narrowed to this file's
// account, so the fake `transactionsSync` only ever serves this file's token. Cleanup is by this
// file's keys only — its account, its FIXTURE-p40b- ids and tombstones, the rules, transfer group
// and property it seeded, and the sync_log rows written after it started.
//
// THE RULE LOOKUP IS GLOBAL. `runSync` loads every `category_rules` row, so the primary category
// this file uses (`FOOD_AND_DRINK`, as the spec names it) would be categorised by a leftover rule
// for it in the scratch database. Scenario 14 inserts that rule itself, and the unique index on
// `plaid_category` makes a leftover fail that insert loudly rather than pass the scenario quietly.
//
// EVERY ROW AND ID IS FABRICATED. Amounts are small whole numbers, merchants are invented, and the
// counterparty "account numbers" are sentinel strings, not account numbers.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CounterpartyType, TransactionPaymentChannelEnum, TransactionTransactionTypeEnum, type Transaction,
} from 'plaid';
import db from '@/lib/db';
import { runSync } from '@/lib/sync';

// Hoisted alongside the mocks: a `vi.mock` factory runs before this module's own top-level code.
const fake = vi.hoisted(() => ({
  TOKEN: 'p40b-enrichment-item-token',
  /** The `transactionsSync` pages still to be served, in order, for this file's token. */
  pages: [] as unknown[],
}));

vi.mock('@/lib/plaid', () => ({
  plaidClient: () => ({
    transactionsSync: async (req: { access_token: string }) => {
      if (req.access_token !== fake.TOKEN) {
        throw new Error('p40b: sync reached an item this file does not own');
      }
      const page = fake.pages.shift();
      if (!page) throw new Error('p40b: sync asked for more pages than the test queued');
      return { data: page };
    },
    itemGet: async () => ({ data: { item: { institution_id: null }, status: {} } }),
    institutionsGetById: async () => {
      throw new Error('p40b: institutionsGetById was not expected');
    },
  }),
}));

vi.mock('@/lib/plaidReconcile', () => ({
  reconcileAccountIds: async () => ({ remapped: [], unmatchedLive: [], unmatchedDb: [], liveBalances: [] }),
}));

vi.mock('@/lib/plaidBalances', () => ({
  recordPlaidBalances: async () => 0,
}));

const ACCOUNT = 'p40b_enrich_acct';
const UNKNOWN_ACCOUNT = 'p40b_enrich_unknown_acct';
const DATE = '2026-03-04';
/** Negative control 11: read back unchanged in both time zones #6 and #7 run in. */
const AUTH_DATE = '2026-03-02';

const SENTINELS = ['SENTINEL-P40B-IBAN', 'SENTINEL-P40B-BIC', 'SENTINEL-P40B-BACS-ACCT', 'SENTINEL-P40B-SORT'];

/** A posted Plaid transaction on this file's account carrying every `Transaction` key. */
function fullTxn(id: string, over: Partial<Transaction> = {}): Transaction {
  // A TYPED CONST, NOT AN ASSERTION. `{ ... } as Required<Transaction>` would compile with a key
  // missing (an assertion only asks that the two types overlap); a declared type makes the
  // compiler check this literal against every key, optional ones included. The overrides are
  // applied after the check, so a scenario can still omit or null a field on purpose.
  const complete: Required<Transaction> = {
    account_id: ACCOUNT,
    amount: 1,
    iso_currency_code: 'USD',
    unofficial_currency_code: null,
    category: ['Food and Drink', 'Coffee Shop'],
    category_id: 'FIXTURE-cat-coffee',
    check_number: null,
    date: DATE,
    location: {
      address: 'Fixture Lane', city: 'Fixtureville', region: 'FX', postal_code: 'FX-0',
      country: 'US', lat: null, lon: null, store_number: null,
    },
    name: `Fabricated P40b Cafe ${id}`,
    merchant_name: `Fabricated P40b Cafe ${id}`,
    original_description: null,
    payment_meta: {
      reference_number: 'FIXTURE-ref', ppd_id: null, payee: 'Fabricated Payee', by_order_of: null,
      payer: 'Fabricated Payer', payment_method: null, payment_processor: null, reason: null,
    },
    pending: false,
    pending_transaction_id: null,
    account_owner: 'Fabricated Owner',
    transaction_id: id,
    transaction_type: TransactionTransactionTypeEnum.Place,
    logo_url: 'https://logo.fixture.invalid/cafe.png',
    website: 'cafe.fixture.invalid',
    authorized_date: AUTH_DATE,
    authorized_datetime: '2026-03-02T00:00:00Z',
    datetime: null,
    payment_channel: TransactionPaymentChannelEnum.InStore,
    personal_finance_category: {
      primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_COFFEE', confidence_level: 'VERY_HIGH',
    },
    business_finance_category: null,
    transaction_code: null,
    personal_finance_category_icon_url: 'https://icon.fixture.invalid/food.png',
    counterparties: [{
      name: 'Fabricated P40b Cafe', entity_id: 'FIXTURE-entity-cafe', type: CounterpartyType.Merchant,
      website: 'cafe.fixture.invalid', logo_url: 'https://logo.fixture.invalid/cafe.png',
      confidence_level: 'HIGH',
      account_numbers: {
        bacs: { account: 'SENTINEL-P40B-BACS-ACCT', sort_code: 'SENTINEL-P40B-SORT' },
        international: { iban: 'SENTINEL-P40B-IBAN', bic: 'SENTINEL-P40B-BIC' },
      },
    }],
    merchant_entity_id: 'FIXTURE-entity-cafe',
    client_customization: null,
  };
  return { ...complete, ...over };
}

/** What `plaid_raw` must equal for `t`: `t` as JSON, minus each counterparty's account_numbers. */
function expectedRaw(t: Transaction): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(t)) as Record<string, unknown>;
  if (Array.isArray(copy.counterparties)) {
    for (const c of copy.counterparties as Record<string, unknown>[]) delete c.account_numbers;
  }
  return copy;
}

function queuePage(page: {
  added?: Transaction[]; modified?: Transaction[]; next_cursor: string;
}): void {
  fake.pages.push({
    added: page.added ?? [], modified: page.modified ?? [], removed: [],
    next_cursor: page.next_cursor, has_more: false,
  });
}

/** The real `runSync`, narrowed to this file's account. */
async function sync(): Promise<Awaited<ReturnType<typeof runSync>>> {
  const r = await runSync({ accountId: ACCOUNT });
  expect(r.errors).toEqual([]);
  expect(fake.pages).toHaveLength(0);
  return r;
}

const ENRICHMENT = [
  'plaid_category_detailed', 'plaid_category_confidence', 'authorized_date', 'payment_channel',
  'merchant_entity_id', 'logo_url', 'website', 'location_city', 'location_region', 'location_country',
] as const;

interface Row {
  id: number; plaid_transaction_id: string; plaid_category: string | null;
  mapped_category: string | null; rule_applied: boolean; hidden: boolean; watched_at: string | null;
  note: string | null; transfer_group_id: number | null; property_id: number | null;
  plaid_category_detailed: string | null; plaid_category_confidence: string | null;
  authorized_date: string | null; payment_channel: string | null; merchant_entity_id: string | null;
  logo_url: string | null; website: string | null; location_city: string | null;
  location_region: string | null; location_country: string | null;
  plaid_raw: Record<string, unknown> | null; raw_type: string | null; raw_amount: string | null;
  raw_text: string | null;
}

async function rowFor(plaidId: string): Promise<Row | undefined> {
  // `to_char`, not the DATE itself: node-postgres would hand back a JS Date at local midnight,
  // and reading it back through a Date is the very shift this file is checking for.
  const r = await db.query<Row>(
    `SELECT id, plaid_transaction_id, plaid_category, mapped_category, rule_applied, hidden,
            watched_at::text AS watched_at, note, transfer_group_id, property_id,
            plaid_category_detailed, plaid_category_confidence,
            to_char(authorized_date, 'YYYY-MM-DD') AS authorized_date,
            payment_channel, merchant_entity_id, logo_url, website,
            location_city, location_region, location_country,
            plaid_raw, jsonb_typeof(plaid_raw) AS raw_type, plaid_raw->>'amount' AS raw_amount,
            plaid_raw::text AS raw_text
       FROM transactions WHERE plaid_transaction_id = $1`,
    [plaidId]
  );
  return r.rows[0];
}

async function storedCursor(): Promise<string | null> {
  const r = await db.query<{ cursor: string | null }>('SELECT cursor FROM accounts WHERE id = $1', [ACCOUNT]);
  return r.rows[0].cursor;
}

async function rowCount(): Promise<number> {
  const r = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM transactions WHERE account_id = $1', [ACCOUNT]);
  return r.rows[0].n;
}

/** The six fields only the owner sets, as text so "byte-identical" is a string comparison. */
function ownerFields(r: Row) {
  return {
    mapped_category: r.mapped_category, hidden: r.hidden, watched_at: r.watched_at, note: r.note,
    transfer_group_id: r.transfer_group_id, property_id: r.property_id,
  };
}

// Seeded per test where needed, and removed in cleanup by the ids recorded here.
const seededRules: string[] = [];
let transferGroupId = 0;
let propertyId = 0;
let syncLogHighWater = 0;

/** A stored row as the owner left it: own category, hidden, watched, noted, grouped, attributed. */
async function seedOwnerRow(plaidId: string, over: { name?: string; ruleApplied?: boolean; mapped?: string } = {}): Promise<Row> {
  await db.query(
    `INSERT INTO transactions
       (plaid_transaction_id, account_id, date, amount, name, merchant_name, plaid_category,
        mapped_category, rule_applied, hidden, watched_at, note, transfer_group_id, property_id,
        logo_url, location_city, plaid_category_detailed)
     VALUES ($1, $2, $3, 1, $4, $4, 'FIXTURE_OLD_PRIMARY', $5, $6, TRUE, '2026-03-05T10:00:00Z',
             'Fabricated owner note', $7, $8, 'https://old.fixture.invalid/logo.png', 'Oldtown', 'FIXTURE_OLD_DETAILED')`,
    [plaidId, ACCOUNT, DATE, over.name ?? `Fabricated P40b Cafe ${plaidId}`,
     over.mapped ?? 'Owner Pick', over.ruleApplied ?? false, transferGroupId, propertyId]
  );
  return (await rowFor(plaidId))!;
}

async function cleanup(): Promise<void> {
  fake.pages.length = 0;
  await db.query('DELETE FROM transactions WHERE account_id IN ($1, $2)', [ACCOUNT, UNKNOWN_ACCOUNT]);
  await db.query("DELETE FROM transaction_tombstones WHERE plaid_transaction_id LIKE 'FIXTURE-p40b-%'");
  if (seededRules.length) {
    await db.query('DELETE FROM category_rules WHERE plaid_category = ANY($1)', [seededRules]);
    seededRules.length = 0;
  }
  await db.query('DELETE FROM accounts WHERE id = $1', [ACCOUNT]);
}

async function seedRule(plaidCategory: string, mapped: string): Promise<void> {
  seededRules.push(plaidCategory);
  await db.query('INSERT INTO category_rules (plaid_category, mapped_category) VALUES ($1, $2)', [plaidCategory, mapped]);
}

beforeAll(async () => {
  const r = await db.query<{ n: number }>('SELECT COALESCE(MAX(id), 0)::int AS n FROM sync_log');
  syncLogHighWater = r.rows[0].n;
  transferGroupId = (await db.query<{ id: number }>('INSERT INTO transfer_groups DEFAULT VALUES RETURNING id')).rows[0].id;
  propertyId = (await db.query<{ id: number }>(
    "INSERT INTO properties (nickname, type) VALUES ('Fabricated P40b Property', 'rental') RETURNING id"
  )).rows[0].id;
});

beforeEach(async () => {
  await cleanup();
  await db.query(
    `INSERT INTO accounts (id, name, type, landscape, access_token, bank)
     VALUES ($1, 'Fabricated P40b Checking', 'depository', 'operational', $2, 'Fabricated Bank P40b')`,
    [ACCOUNT, fake.TOKEN]
  );
});

afterAll(async () => {
  await cleanup();
  await db.query('DELETE FROM transfer_groups WHERE id = $1', [transferGroupId]);
  await db.query('DELETE FROM properties WHERE id = $1', [propertyId]);
  await db.query('DELETE FROM sync_log WHERE id > $1', [syncLogHighWater]);
  await db.end();
});

describe('sync keeps Plaid enrichment', () => {
  it('T40b-S1: an added row stores all ten columns, the primary category unchanged and the date unshifted', async () => {
    const t = fullTxn('FIXTURE-p40b-s1');
    queuePage({ added: [t], next_cursor: 'p40b-s1' });
    expect((await sync()).synced).toBe(1);

    const r = (await rowFor('FIXTURE-p40b-s1'))!;
    expect(r.plaid_category).toBe('FOOD_AND_DRINK');
    expect(r).toMatchObject({
      plaid_category_detailed: 'FOOD_AND_DRINK_COFFEE',
      plaid_category_confidence: 'VERY_HIGH',
      authorized_date: AUTH_DATE,
      payment_channel: 'in store',
      merchant_entity_id: 'FIXTURE-entity-cafe',
      logo_url: 'https://logo.fixture.invalid/cafe.png',
      website: 'cafe.fixture.invalid',
      location_city: 'Fixtureville',
      location_region: 'FX',
      location_country: 'US',
    });
    // An object, not a JSON string holding one: `->>` reaches into it.
    expect(r.raw_type).toBe('object');
    expect(r.raw_amount).toBe('1');
  });

  it('T40b-S2: when Plaid omits everything optional, all ten columns are NULL and plaid_raw is still an object', async () => {
    const t = fullTxn('FIXTURE-p40b-s2', {
      location: { address: null, city: null, region: null, postal_code: null, country: null, lat: null, lon: null, store_number: null },
      authorized_date: null,
      personal_finance_category: null,
    });
    delete t.logo_url;
    delete t.website;
    delete t.merchant_entity_id;
    // The one field the SDK always sends, omitted too, so every column is shown NULL-able here.
    delete (t as Partial<Transaction>).payment_channel;
    queuePage({ added: [t], next_cursor: 'p40b-s2' });
    await sync();

    const r = (await rowFor('FIXTURE-p40b-s2'))!;
    for (const c of ENRICHMENT) expect(r[c], c).toBeNull();
    expect(r.plaid_category).toBeNull();
    expect(r.raw_type).toBe('object');
    expect(r.plaid_raw).toEqual(expectedRaw(t));
    // NULL, not the empty string: the SQL predicate, not only the JS value.
    const blanks = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM transactions WHERE plaid_transaction_id = $1 AND
         (logo_url = '' OR website = '' OR merchant_entity_id = '' OR location_city = '' OR payment_channel = '')`,
      ['FIXTURE-p40b-s2']
    );
    expect(blanks.rows[0].n).toBe(0);
  });

  it('T40b-S3: empty and whitespace-only strings are stored as NULL', async () => {
    const base = fullTxn('FIXTURE-p40b-s3');
    const t = fullTxn('FIXTURE-p40b-s3', { logo_url: '', website: '   ', location: { ...base.location, city: '' } });
    queuePage({ added: [t], next_cursor: 'p40b-s3' });
    await sync();

    const r = (await rowFor('FIXTURE-p40b-s3'))!;
    expect(r.logo_url).toBeNull();
    expect(r.website).toBeNull();
    expect(r.location_city).toBeNull();
    // The neighbours in the same objects are untouched by the blank rule.
    expect(r.location_region).toBe('FX');
    expect(r.merchant_entity_id).toBe('FIXTURE-entity-cafe');
  });

  it('T40b-S4: modified with changed values overwrites every column and plaid_raw becomes the new object', async () => {
    queuePage({ added: [fullTxn('FIXTURE-p40b-s4')], next_cursor: 'p40b-s4-a' });
    await sync();

    const changed = fullTxn('FIXTURE-p40b-s4', {
      amount: 2,
      authorized_date: '2026-03-03',
      payment_channel: TransactionPaymentChannelEnum.Online,
      personal_finance_category: { primary: 'GENERAL_MERCHANDISE', detailed: 'GENERAL_MERCHANDISE_OTHER', confidence_level: 'LOW' },
      merchant_entity_id: 'FIXTURE-entity-shop',
      logo_url: 'https://logo.fixture.invalid/shop.png',
      website: 'shop.fixture.invalid',
      location: { address: null, city: 'Newtown', region: 'NW', postal_code: null, country: 'CA', lat: 10.5, lon: -20.25, store_number: 'FIXTURE-7' },
    });
    queuePage({ modified: [changed], next_cursor: 'p40b-s4-b' });
    await sync();

    const r = (await rowFor('FIXTURE-p40b-s4'))!;
    expect(r).toMatchObject({
      plaid_category: 'GENERAL_MERCHANDISE',
      plaid_category_detailed: 'GENERAL_MERCHANDISE_OTHER',
      plaid_category_confidence: 'LOW',
      authorized_date: '2026-03-03',
      payment_channel: 'online',
      merchant_entity_id: 'FIXTURE-entity-shop',
      logo_url: 'https://logo.fixture.invalid/shop.png',
      website: 'shop.fixture.invalid',
      location_city: 'Newtown',
      location_region: 'NW',
      location_country: 'CA',
    });
    expect(r.plaid_raw).toEqual(expectedRaw(changed));
  });

  it('T40b-S5: modified that omits previously stored fields sets them to NULL rather than keeping the stale values', async () => {
    const first = fullTxn('FIXTURE-p40b-s5');
    queuePage({ added: [first], next_cursor: 'p40b-s5-a' });
    await sync();
    const before = (await rowFor('FIXTURE-p40b-s5'))!;
    expect(before.location_city).toBe('Fixtureville');
    expect(before.authorized_date).toBe(AUTH_DATE);

    const later = fullTxn('FIXTURE-p40b-s5', {
      location: { ...first.location, city: null },
      website: null,
      authorized_date: null,
    });
    delete later.logo_url;
    delete later.merchant_entity_id;
    queuePage({ modified: [later], next_cursor: 'p40b-s5-b' });
    await sync();

    const r = (await rowFor('FIXTURE-p40b-s5'))!;
    expect(r.location_city).toBeNull();
    expect(r.logo_url).toBeNull();
    expect(r.website).toBeNull();
    expect(r.merchant_entity_id).toBeNull();
    expect(r.authorized_date).toBeNull();
    expect(r.plaid_raw).toEqual(expectedRaw(later));
    expect(r.plaid_raw).not.toHaveProperty('logo_url');
  });

  it('T40b-S6: modified for an id not yet stored creates the row with every field', async () => {
    const t = fullTxn('FIXTURE-p40b-s6');
    queuePage({ modified: [t], next_cursor: 'p40b-s6' });
    await sync();

    const r = (await rowFor('FIXTURE-p40b-s6'))!;
    for (const c of ENRICHMENT) expect(r[c], c).not.toBeNull();
    expect(r.authorized_date).toBe(AUTH_DATE);
    expect(r.plaid_raw).toEqual(expectedRaw(t));
  });

  it('T40b-S7: modified leaves the six owner-set fields byte-identical while refreshing enrichment and plaid_category', async () => {
    const seeded = await seedOwnerRow('FIXTURE-p40b-s7');
    const t = fullTxn('FIXTURE-p40b-s7', { personal_finance_category: { primary: 'GENERAL_SERVICES', detailed: 'GENERAL_SERVICES_OTHER', confidence_level: 'MEDIUM' } });
    queuePage({ modified: [t], next_cursor: 'p40b-s7' });
    await sync();

    const r = (await rowFor('FIXTURE-p40b-s7'))!;
    expect(ownerFields(r)).toEqual(ownerFields(seeded));
    expect(r.mapped_category).toBe('Owner Pick');
    expect(r.rule_applied).toBe(false);
    expect(r.transfer_group_id).toBe(transferGroupId);
    expect(r.property_id).toBe(propertyId);
    expect(r.plaid_category).toBe('GENERAL_SERVICES');
    expect(r.plaid_category_detailed).toBe('GENERAL_SERVICES_OTHER');
    expect(r.logo_url).toBe('https://logo.fixture.invalid/cafe.png');
    expect(r.location_city).toBe('Fixtureville');
    expect(r.plaid_raw).toEqual(expectedRaw(t));
  });

  it('T40b-S8: an added event re-delivering a stored id leaves the owner-set fields byte-identical too', async () => {
    const seeded = await seedOwnerRow('FIXTURE-p40b-s8');
    const t = fullTxn('FIXTURE-p40b-s8', { personal_finance_category: { primary: 'GENERAL_SERVICES', detailed: 'GENERAL_SERVICES_OTHER', confidence_level: 'MEDIUM' } });
    queuePage({ added: [t], next_cursor: 'p40b-s8' });
    await sync();

    const r = (await rowFor('FIXTURE-p40b-s8'))!;
    expect(ownerFields(r)).toEqual(ownerFields(seeded));
    expect(r.rule_applied).toBe(false);
    expect(r.plaid_category).toBe('GENERAL_SERVICES');
    expect(r.plaid_category_detailed).toBe('GENERAL_SERVICES_OTHER');
    expect(r.logo_url).toBe('https://logo.fixture.invalid/cafe.png');
    expect(r.plaid_raw).toEqual(expectedRaw(t));
    expect(await rowCount()).toBe(1);
  });

  it('T40b-S9: a rule-managed row still has mapped_category re-derived on modified, and gets the new enrichment', async () => {
    await seedRule('P40B_FABRICATED_RULED', 'P40b Rule Category');
    await seedOwnerRow('FIXTURE-p40b-s9', { ruleApplied: true, mapped: 'P40b Old Rule Category' });
    const t = fullTxn('FIXTURE-p40b-s9', {
      personal_finance_category: { primary: 'P40B_FABRICATED_RULED', detailed: 'P40B_FABRICATED_RULED_DETAIL', confidence_level: 'HIGH' },
    });
    queuePage({ modified: [t], next_cursor: 'p40b-s9' });
    await sync();

    const r = (await rowFor('FIXTURE-p40b-s9'))!;
    expect(r.mapped_category).toBe('P40b Rule Category');
    expect(r.rule_applied).toBe(true);
    expect(r.plaid_category_detailed).toBe('P40B_FABRICATED_RULED_DETAIL');
    expect(r.location_city).toBe('Fixtureville');
    expect(r.plaid_raw).toEqual(expectedRaw(t));
  });

  it('T40b-S10: a re-identified row keeps its id and owner fields and gains the new id, enrichment and plaid_raw', async () => {
    const name = 'Fabricated P40b Reissued Cafe';
    const seeded = await seedOwnerRow('FIXTURE-p40b-s10-old', { name });
    for (const c of ['plaid_category_detailed', 'logo_url', 'location_city'] as const) {
      await db.query(`UPDATE transactions SET ${c} = NULL WHERE id = $1`, [seeded.id]);
    }
    const t = fullTxn('FIXTURE-p40b-s10-new', { name, merchant_name: name });
    queuePage({ added: [t], next_cursor: 'p40b-s10' });
    const result = await sync();

    expect(await rowCount()).toBe(1);
    expect(await rowFor('FIXTURE-p40b-s10-old')).toBeUndefined();
    const r = (await rowFor('FIXTURE-p40b-s10-new'))!;
    expect(r.id).toBe(seeded.id);
    expect(ownerFields(r)).toEqual(ownerFields(seeded));
    for (const c of ENRICHMENT) expect(r[c], c).not.toBeNull();
    expect(r.plaid_category_detailed).toBe('FOOD_AND_DRINK_COFFEE');
    expect(r.plaid_raw).toEqual(expectedRaw(t));
    // Renumbered, not new.
    expect(result.synced).toBe(0);
  });

  it('T40b-S11: a pending transaction with full enrichment creates no row, as added or as modified', async () => {
    queuePage({
      added: [fullTxn('FIXTURE-p40b-s11-a', { pending: true })],
      modified: [fullTxn('FIXTURE-p40b-s11-m', { pending: true })],
      next_cursor: 'p40b-s11',
    });
    await sync();
    expect(await rowFor('FIXTURE-p40b-s11-a')).toBeUndefined();
    expect(await rowFor('FIXTURE-p40b-s11-m')).toBeUndefined();
    expect(await rowCount()).toBe(0);
  });

  it('T40b-S12: a transaction for an unknown account creates no row', async () => {
    queuePage({ added: [fullTxn('FIXTURE-p40b-s12', { account_id: UNKNOWN_ACCOUNT })], next_cursor: 'p40b-s12' });
    const result = await sync();
    expect(await rowFor('FIXTURE-p40b-s12')).toBeUndefined();
    expect(result.unmatchedAccountIds).toContain(UNKNOWN_ACCOUNT);
  });

  it('T40b-S13: plaid_raw is the object as received, minus only counterparties[*].account_numbers', async () => {
    const t = fullTxn('FIXTURE-p40b-s13', {
      location: { address: 'Fixture Lane', city: 'Fixtureville', region: 'FX', postal_code: 'FX-0', country: 'US', lat: null, lon: null, store_number: null },
    });
    const asSent = structuredClone(t);
    queuePage({ added: [t], next_cursor: 'p40b-s13' });
    await sync();

    // The response object was not edited in place by the redaction.
    expect(t).toEqual(asSent);

    const r = (await rowFor('FIXTURE-p40b-s13'))!;
    const raw = r.plaid_raw!;
    expect(Object.keys(raw).sort()).toEqual(Object.keys(t).sort());
    expect(raw).toHaveProperty('check_number', null);
    expect(Object.keys(raw.location as object).sort()).toEqual(Object.keys(t.location).sort());
    expect(raw.location).toMatchObject({ lat: null, lon: null, store_number: null });
    expect(raw).toHaveProperty('authorized_datetime', '2026-03-02T00:00:00Z');
    expect(raw.payment_meta).toEqual(t.payment_meta);
    expect(raw).toHaveProperty('account_owner', 'Fabricated Owner');
    expect(raw).toEqual(expectedRaw(t));

    for (const s of SENTINELS) expect(r.raw_text).not.toContain(s);
    expect(r.raw_text).not.toContain('account_numbers');

    const cp = (raw.counterparties as Record<string, unknown>[])[0];
    expect(Object.keys(cp).sort()).toEqual(['confidence_level', 'entity_id', 'logo_url', 'name', 'type', 'website']);

    for (const k of ['mapped_category', 'rule_applied', 'hidden', 'id']) expect(raw).not.toHaveProperty(k);
  });

  it('T40b-S14: the detailed category does not drive rules; the primary one still does', async () => {
    await seedRule('FOOD_AND_DRINK_COFFEE', 'P40b Detailed Rule Category');
    queuePage({ added: [fullTxn('FIXTURE-p40b-s14-a')], next_cursor: 'p40b-s14-a' });
    await sync();
    const a = (await rowFor('FIXTURE-p40b-s14-a'))!;
    expect(a.plaid_category_detailed).toBe('FOOD_AND_DRINK_COFFEE');
    expect(a.mapped_category).toBeNull();
    expect(a.rule_applied).toBe(false);

    await seedRule('FOOD_AND_DRINK', 'P40b Primary Rule Category');
    queuePage({ added: [fullTxn('FIXTURE-p40b-s14-b')], next_cursor: 'p40b-s14-b' });
    await sync();
    const b = (await rowFor('FIXTURE-p40b-s14-b'))!;
    expect(b.mapped_category).toBe('P40b Primary Rule Category');
    expect(b.rule_applied).toBe(true);
  });

  it('T40b-S15: a tombstoned id carrying full enrichment creates no row, as added or as modified', async () => {
    await db.query("INSERT INTO transaction_tombstones (plaid_transaction_id) VALUES ('FIXTURE-p40b-s15-a'), ('FIXTURE-p40b-s15-m')");
    queuePage({
      added: [fullTxn('FIXTURE-p40b-s15-a')],
      modified: [fullTxn('FIXTURE-p40b-s15-m')],
      next_cursor: 'p40b-s15',
    });
    const result = await sync();
    expect(await rowFor('FIXTURE-p40b-s15-a')).toBeUndefined();
    expect(await rowFor('FIXTURE-p40b-s15-m')).toBeUndefined();
    expect(result.synced).toBe(0);
  });

  it('T40b-S16: the same sync response twice leaves one row with identical values and a deep-equal plaid_raw', async () => {
    const t = fullTxn('FIXTURE-p40b-s16');
    queuePage({ added: [structuredClone(t)], next_cursor: 'p40b-s16-a' });
    await sync();
    const first = (await rowFor('FIXTURE-p40b-s16'))!;
    queuePage({ added: [structuredClone(t)], next_cursor: 'p40b-s16-b' });
    await sync();
    const second = (await rowFor('FIXTURE-p40b-s16'))!;

    expect(await rowCount()).toBe(1);
    expect(second).toEqual(first);
    expect(second.plaid_raw).toEqual(expectedRaw(t));
  });

  it('T40b-S17: one transaction with objects missing outright does not fail the batch', async () => {
    const odd = fullTxn('FIXTURE-p40b-s17-odd') as unknown as Record<string, unknown>;
    delete odd.location;
    delete odd.counterparties;
    odd.personal_finance_category = null;
    queuePage({ added: [odd as unknown as Transaction, fullTxn('FIXTURE-p40b-s17-mate')], next_cursor: 'p40b-s17' });
    expect((await sync()).synced).toBe(2);

    const r = (await rowFor('FIXTURE-p40b-s17-odd'))!;
    expect(r.location_city).toBeNull();
    expect(r.plaid_category_detailed).toBeNull();
    expect(r.plaid_raw).toEqual(odd);
    expect((await rowFor('FIXTURE-p40b-s17-mate'))!.location_city).toBe('Fixtureville');
  });

  it('T40b-S18: U+0000 and lone surrogates in enrichment text become U+FFFD; the page and its page-mate still sync and the cursor advances', async () => {
    // Code units, not escapes in literals, so the input is unambiguous. U+0000 is refused by both
    // `text` and `jsonb`; a lone surrogate is refused by `jsonb` once JSON.stringify writes it as an
    // escape. Before the G3 amendment this page failed its upsert and the cursor never moved.
    const NUL = String.fromCharCode(0);
    const HIGH = String.fromCharCode(0xd800);
    const FFFD = String.fromCharCode(0xfffd);
    const base = fullTxn('FIXTURE-p40b-s18-bad');
    // name / merchant_name stay clean: the base columns are QUEUE hold H6, not this task's.
    const bad = fullTxn('FIXTURE-p40b-s18-bad', {
      location: { ...base.location, city: `Fixture${NUL}ville${HIGH}` },
      payment_meta: { ...base.payment_meta, reference_number: `REF${NUL}-${HIGH}-1` },
      counterparties: [{ ...base.counterparties![0], name: `Fabricated${HIGH} Counterparty${NUL}` }],
      logo_url: `https://logo.fixture.invalid/${NUL}.png`,
      website: `cafe${HIGH}.fixture.invalid`,
      merchant_entity_id: `FIXTURE-entity${NUL}`,
      personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: `FOOD_AND_DRINK_COFFEE${HIGH}`, confidence_level: 'VERY_HIGH' },
    });
    const asSent = structuredClone(bad);
    const mate = fullTxn('FIXTURE-p40b-s18-mate');
    queuePage({ added: [bad, mate], next_cursor: 'p40b-s18' });

    const result = await sync();
    expect(result.synced).toBe(2);
    expect(await storedCursor()).toBe('p40b-s18');
    expect(bad).toEqual(asSent);

    const r = (await rowFor('FIXTURE-p40b-s18-bad'))!;
    expect(r.location_city).toBe(`Fixture${FFFD}ville${FFFD}`);
    expect(r.logo_url).toBe(`https://logo.fixture.invalid/${FFFD}.png`);
    expect(r.website).toBe(`cafe${FFFD}.fixture.invalid`);
    expect(r.merchant_entity_id).toBe(`FIXTURE-entity${FFFD}`);
    expect(r.plaid_category_detailed).toBe(`FOOD_AND_DRINK_COFFEE${FFFD}`);
    // Columns not carrying a bad code unit are exactly as sent.
    expect(r.location_region).toBe('FX');
    expect(r.payment_channel).toBe('in store');

    const raw = r.plaid_raw!;
    expect((raw.payment_meta as Record<string, unknown>).reference_number).toBe(`REF${FFFD}-${FFFD}-1`);
    const cp = (raw.counterparties as Record<string, unknown>[])[0];
    expect(cp.name).toBe(`Fabricated${FFFD} Counterparty${FFFD}`);
    expect(cp).not.toHaveProperty('account_numbers');
    expect((raw.location as Record<string, unknown>).city).toBe(`Fixture${FFFD}ville${FFFD}`);
    // Everything else in the object is the fixture, unchanged.
    const expected = expectedRaw(bad);
    (expected.payment_meta as Record<string, unknown>).reference_number = `REF${FFFD}-${FFFD}-1`;
    (expected.counterparties as Record<string, unknown>[])[0].name = `Fabricated${FFFD} Counterparty${FFFD}`;
    (expected.location as Record<string, unknown>).city = `Fixture${FFFD}ville${FFFD}`;
    (expected.personal_finance_category as Record<string, unknown>).detailed = `FOOD_AND_DRINK_COFFEE${FFFD}`;
    expected.logo_url = `https://logo.fixture.invalid/${FFFD}.png`;
    expected.website = `cafe${FFFD}.fixture.invalid`;
    expected.merchant_entity_id = `FIXTURE-entity${FFFD}`;
    expect(raw).toEqual(expected);

    const m = (await rowFor('FIXTURE-p40b-s18-mate'))!;
    expect(m.location_city).toBe('Fixtureville');
    expect(m.plaid_raw).toEqual(expectedRaw(mate));
  });
});
