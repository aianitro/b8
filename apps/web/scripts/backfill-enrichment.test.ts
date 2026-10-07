// The enrichment backfill against a real Postgres, with only the Plaid client faked (P6-40c).
//
// TIER 2, under `vitest.integration.config.mts` with the scratch-database guard in `setupFiles` —
// this file writes rows, and the guard refuses to run it against the owner's real database. It is
// named in that config's `include` by exact path and is absent from the pure config, which collects
// only `lib/**`: a backfill test that stubbed the database would be asserting that a stub was asked
// for an UPDATE, and every rule this file checks — the NULL guard, the account scoping, "no column
// but the eleven" — is a property of the SQL.
//
// WHAT IS FAKED, AND WHY ONLY THAT. `lib/plaid`, so `plaidClient().transactionsSync` serves fixture
// pages and records every request it receives. The script's own transport, its SQL and 40b's mapping
// are the real ones. Where a test needs to see the ORDER of writes (BF-11) or to land a concurrent
// sync between the plan and the write (BF-10), it wraps the real `lib/db` rather than replacing it.
//
// OTHER SUITES' LEFTOVERS ARE TOLERATED, NOT TRUNCATED. The backfill visits every token-bearing
// account in the database, and other integration files leave fabricated Plaid items behind. The
// fake serves those an empty history, so they contribute zero to every count but
// `local_not_returned`; that is why per-item assertions find this file's items by ordinal (the same
// ordering the script uses) and no total of `local_not_returned` is asserted.
//
// EVERY VALUE IS FABRICATED, AND THE TEXT ONES ARE SENTINELS. Each string field that could leak —
// name, merchant, logo, website, city, ids, tokens, cursors, the Plaid secret and error message —
// carries `SENTINEL-P40C`, and the Plaid amount has a digit run that cannot be a count, so BF-09
// can look for both in everything the script printed. Stored amounts are small whole numbers.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CounterpartyType, TransactionPaymentChannelEnum, TransactionTransactionTypeEnum, type Transaction,
} from 'plaid';
import db from '@/lib/db';
import { enrichmentParams, plaidEnrichment } from '@/lib/plaidEnrichment';
import {
  defaultBackupDir, defaultDeps, isEntryPoint, main, MAX_PAGES_PER_ITEM, parseArgs, UsageError,
  type BackfillDb, type BackfillDeps, type BackfillSummary,
} from './backfill-enrichment';

const fake = vi.hoisted(() => ({
  /** Every request the fake client received, in order. */
  requests: [] as { access_token: string; cursor: string | undefined }[],
  /** Per token, the pages of its history: page i is served for the fake's own cursor `next-<token>-<i>`. */
  histories: new Map<string, unknown[]>(),
  /** Tokens whose history never ends: every page says `has_more` and hands out a fresh cursor. */
  endless: new Set<string>(),
  /** Per token, the error its fetch rejects with for a given cursor, or undefined to serve the page. */
  failures: new Map<string, (cursor: string | undefined) => unknown>(),
}));

vi.mock('@/lib/plaid', () => ({
  plaidClient: () => ({
    transactionsSync: async (req: { access_token: string; cursor?: string }) => {
      fake.requests.push({ access_token: req.access_token, cursor: req.cursor });
      const fail = fake.failures.get(req.access_token);
      const failure = fail?.(req.cursor);
      if (failure) throw failure;
      if (fake.endless.has(req.access_token)) {
        const n = req.cursor === undefined ? 0 : Number(/-(\d+)$/.exec(req.cursor)![1]);
        return { data: { added: [], modified: [], removed: [], next_cursor: `next-${req.access_token}-${n + 1}`, has_more: true } };
      }
      const pages = fake.histories.get(req.access_token);
      // A token this file did not seed is another suite's leftover: an empty history.
      if (!pages) {
        return { data: { added: [], modified: [], removed: [], next_cursor: 'next-foreign', has_more: false } };
      }
      let index = 0;
      if (req.cursor !== undefined) {
        const m = /^next-.*-(\d+)$/.exec(req.cursor);
        if (!m) throw new Error('p40c: a cursor the fake never issued');
        index = Number(m[1]);
      }
      return { data: pages[index] };
    },
  }),
}));

// Recorded before any test runs: importing the script must not have started it.
const requestsAtImport = fake.requests.length;

const P = 'SENTINEL-P40C';
const TOKEN_A = `${P}-TOKEN-A`;
const TOKEN_B = `${P}-TOKEN-B`;
const TOKEN_C = `${P}-TOKEN-C`;
const ACCT_A1 = `${P}-ACCT-A1`;
const ACCT_A2 = `${P}-ACCT-A2`;
const ACCT_B1 = `${P}-ACCT-B1`;
const ACCT_C1 = `${P}-ACCT-C1`;
const ACCT_NOWHERE = `${P}-ACCT-NOWHERE`;
const MY_ACCOUNTS = [ACCT_A1, ACCT_A2, ACCT_B1, ACCT_C1, `${P}-ACCT-D1`, `${P}-ACCT-E1`];
const SENTINEL_CURSOR = (acct: string) => `${P}-CURSOR-${acct}`;

const TXN = (k: string) => `${P}-TXN-${k}`;
const NEW_A = TXN('NEW-A');
const TOMB = TXN('TOMBSTONED');
const UNK = TXN('UNKNOWN-ACCT');

const EXCL_CAT = `${P}-Excluded Category`;
const STORED_DATE = '2026-03-04';
const PLAID_DATE = '2026-03-09';
/** A Plaid amount of opposite sign and different magnitude from every stored one, with a digit run no count has. */
const PLAID_AMOUNT = -0.0097531;
const PLAID_SECRET = `${P}-PLAID-SECRET`;
const ERROR_MESSAGE = `${P}-ERROR-MESSAGE`;

const ENRICHMENT = [
  'plaid_category_detailed', 'plaid_category_confidence', 'authorized_date', 'payment_channel',
  'merchant_entity_id', 'logo_url', 'website', 'location_city', 'location_region', 'location_country',
  'plaid_raw',
] as const;

/** A posted Plaid transaction carrying every `Transaction` key, every text one a sentinel. */
function txn(id: string, accountId: string, over: Partial<Transaction> = {}): Transaction {
  // A typed const rather than an assertion, so the compiler checks every key is present.
  const complete: Required<Transaction> = {
    account_id: accountId,
    amount: PLAID_AMOUNT,
    iso_currency_code: 'USD',
    unofficial_currency_code: null,
    category: ['Fixture'],
    category_id: `${P}-CATEGORY-ID`,
    check_number: null,
    date: PLAID_DATE,
    location: {
      address: `${P}-ADDRESS`, city: `${P}-CITY`, region: `${P}-REGION`, postal_code: null,
      country: 'US', lat: null, lon: null, store_number: null,
    },
    name: `${P}-NAME-${id}`,
    merchant_name: `${P}-MERCHANT-${id}`,
    original_description: null,
    payment_meta: {
      reference_number: null, ppd_id: null, payee: null, by_order_of: null,
      payer: null, payment_method: null, payment_processor: null, reason: null,
    },
    pending: false,
    pending_transaction_id: null,
    account_owner: null,
    transaction_id: id,
    transaction_type: TransactionTransactionTypeEnum.Place,
    logo_url: `https://${P}-logo.invalid/logo.png`,
    website: `${P}-website.invalid`,
    authorized_date: '2026-03-02',
    authorized_datetime: null,
    datetime: null,
    payment_channel: TransactionPaymentChannelEnum.InStore,
    personal_finance_category: {
      primary: 'FIXTURE_NEW_PRIMARY', detailed: 'FIXTURE_NEW_DETAILED', confidence_level: 'HIGH',
    },
    business_finance_category: null,
    transaction_code: null,
    personal_finance_category_icon_url: `https://${P}-icon.invalid/icon.png`,
    counterparties: [{
      name: `${P}-COUNTERPARTY`, entity_id: `${P}-ENTITY`, type: CounterpartyType.Merchant,
      website: null, logo_url: null, confidence_level: 'HIGH',
      account_numbers: { bacs: null, international: { iban: `${P}-IBAN`, bic: `${P}-BIC` } },
    }],
    merchant_entity_id: `${P}-ENTITY`,
    client_customization: null,
  };
  return { ...complete, ...over };
}

function page(p: { added?: Transaction[]; modified?: Transaction[]; removed?: string[]; next: string; hasMore: boolean }) {
  return {
    added: p.added ?? [], modified: p.modified ?? [],
    removed: (p.removed ?? []).map((transaction_id) => ({ transaction_id, account_id: ACCT_A1 })),
    next_cursor: p.next, has_more: p.hasMore, accounts: [], request_id: `${P}-REQUEST`,
  };
}

/** The fixture objects, kept so BF-02 can compare the stored columns with 40b's mapping of each. */
const FX = {
  A1: txn(TXN('A1'), ACCT_A1),
  A4: txn(TXN('A4'), ACCT_A1),
  A5: txn(TXN('A5'), ACCT_A1, { pending: true }),
  NEW_A: txn(NEW_A, ACCT_A1),
  TOMB: txn(TOMB, ACCT_A1),
  UNK: txn(UNK, ACCT_NOWHERE),
  // Ids of item B's rows, served in item A's history: one on an account of A, one on B's account.
  B1_AS_A: txn(TXN('B1'), ACCT_A1),
  B2_AS_B: txn(TXN('B2'), ACCT_B1),
  // Page 2, and sparse: no logo, website, location or category at all.
  A2: (() => {
    const t = txn(TXN('A2'), ACCT_A1, { personal_finance_category: null, authorized_date: null });
    delete t.logo_url;
    delete t.website;
    delete (t as Partial<Transaction>).location;
    return t;
  })(),
  // Page 2, in the `modified` list, on the capital-landscape account.
  A3: txn(TXN('A3'), ACCT_A2),
  C1: txn(TXN('C1'), ACCT_C1),
};

/** A Plaid-SDK-shaped rejection: a valid code, a sentinel message, the secret in the request headers. */
function plaidError(code: string): Error {
  return Object.assign(new Error(ERROR_MESSAGE), {
    config: { headers: { 'PLAID-SECRET': PLAID_SECRET, 'PLAID-CLIENT-ID': `${P}-CLIENT-ID` }, data: `{"access_token":"${TOKEN_B}"}` },
    response: { status: 400, data: { error_code: code, error_message: ERROR_MESSAGE, request_id: `${P}-REQUEST` } },
  });
}

function seedFake(): void {
  fake.requests.length = 0;
  fake.histories.clear();
  fake.failures.clear();
  fake.endless.clear();
  fake.histories.set(TOKEN_A, [
    page({
      added: [FX.A1, FX.A4, FX.A5, FX.NEW_A, FX.TOMB, FX.UNK, FX.B1_AS_A, FX.B2_AS_B],
      removed: [TXN('A6')], next: `next-${TOKEN_A}-1`, hasMore: true,
    }),
    page({ added: [FX.A2], modified: [FX.A3], next: `next-${TOKEN_A}-2`, hasMore: false }),
  ]);
  fake.failures.set(TOKEN_B, () => plaidError('ITEM_LOGIN_REQUIRED'));
  fake.histories.set(TOKEN_C, [page({ added: [FX.C1], next: `next-${TOKEN_C}-1`, hasMore: false })]);
}

let transferGroupId = 0;
let propertyId = 0;
let backupRoot = '';

async function cleanup(): Promise<void> {
  await db.query('DELETE FROM transactions WHERE account_id = ANY($1)', [MY_ACCOUNTS]);
  await db.query('DELETE FROM transaction_tombstones WHERE plaid_transaction_id LIKE $1', [`${P}-%`]);
  await db.query('DELETE FROM accounts WHERE id = ANY($1)', [MY_ACCOUNTS]);
  await db.query('DELETE FROM budget_categories WHERE name = $1', [EXCL_CAT]);
}

async function seedAccount(id: string, token: string, landscape = 'operational'): Promise<void> {
  await db.query(
    `INSERT INTO accounts (id, name, type, landscape, access_token, cursor, last_synced_at,
                           item_last_successful_update, item_last_failed_update, bank)
     VALUES ($1, $2, 'depository', $3, $4, $5, '2026-03-01T08:00:00Z', '2026-03-01T07:00:00Z',
             '2026-02-01T07:00:00Z', $6)`,
    [id, `${P}-ACCOUNT-NAME-${id}`, landscape, token, SENTINEL_CURSOR(id), `${P}-BANK`]
  );
}

async function seedRow(plaidId: string, accountId: string, amount: number, extra: Record<string, unknown> = {}): Promise<void> {
  const cols = ['plaid_transaction_id', 'account_id', 'date', 'amount', 'name', 'merchant_name', 'plaid_category', ...Object.keys(extra)];
  const vals = [plaidId, accountId, STORED_DATE, amount, `${P}-STORED-NAME`, `${P}-STORED-MERCHANT`, 'FIXTURE_OLD_PRIMARY', ...Object.values(extra)];
  await db.query(
    `INSERT INTO transactions (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    vals
  );
}

/** The common fixture: three items, every account with a sentinel cursor, rows with owner-set values. */
async function seedCommon(): Promise<void> {
  await seedAccount(ACCT_A1, TOKEN_A);
  await seedAccount(ACCT_A2, TOKEN_A, 'capital');
  await seedAccount(ACCT_B1, TOKEN_B);
  await seedAccount(ACCT_C1, TOKEN_C);
  await db.query(
    `INSERT INTO budget_categories (name, annual_budget, landscape, exclude_from_budget) VALUES ($1, 0, 'capital', TRUE)`,
    [EXCL_CAT]
  );
  await seedRow(TXN('A1'), ACCT_A1, 2, {
    hidden: true, watched_at: '2026-03-05T10:00:00Z', note: 'Fabricated owner note',
    transfer_group_id: transferGroupId, property_id: propertyId, mapped_category: 'Owner Pick', rule_applied: false,
  });
  await seedRow(TXN('A2'), ACCT_A1, 3);
  await seedRow(TXN('A3'), ACCT_A2, 4, { mapped_category: EXCL_CAT, rule_applied: false });
  await seedRow(TXN('A4'), ACCT_A1, 5, {
    plaid_raw: JSON.stringify({ sentinel: 'pre-enriched' }), logo_url: 'https://pre-enriched.fixture.invalid/logo.png',
    plaid_category_detailed: 'PRE_ENRICHED_DETAILED',
  });
  await seedRow(TXN('A5'), ACCT_A1, 6);
  await seedRow(TXN('A6'), ACCT_A1, 7);
  await seedRow(TXN('B1'), ACCT_B1, 8);
  await seedRow(TXN('B2'), ACCT_B1, 9);
  await seedRow(TXN('C1'), ACCT_C1, 1);
  // Tombstoned and absent: Plaid still sends it, and it must stay absent.
  await db.query('INSERT INTO transaction_tombstones (plaid_transaction_id) VALUES ($1)', [TOMB]);
  seedFake();
}

/** Every row of both tables and the tombstone count, as Postgres's own text. */
async function snapshot(): Promise<{ transactions: string[]; accounts: string[]; tombstones: number }> {
  const t = await db.query<{ r: string }>('SELECT t::text AS r FROM transactions t ORDER BY id');
  const a = await db.query<{ r: string }>('SELECT a::text AS r FROM accounts a ORDER BY id');
  const n = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM transaction_tombstones');
  return { transactions: t.rows.map((r) => r.r), accounts: a.rows.map((r) => r.r), tombstones: n.rows[0].n };
}

/** This file's rows with every column except the eleven the backfill may write. */
async function baseColumns(): Promise<string[]> {
  const r = await db.query<{ r: string }>(
    `SELECT (to_jsonb(t) - $2::text[])::text AS r FROM transactions t WHERE account_id = ANY($1) ORDER BY id`,
    [MY_ACCOUNTS, [...ENRICHMENT]]
  );
  return r.rows.map((x) => x.r);
}

async function enrichmentOf(plaidId: string): Promise<Record<string, unknown>> {
  const r = await db.query(
    `SELECT plaid_category_detailed, plaid_category_confidence, to_char(authorized_date, 'YYYY-MM-DD') AS authorized_date,
            payment_channel, merchant_entity_id, logo_url, website, location_city, location_region,
            location_country, plaid_raw
       FROM transactions WHERE plaid_transaction_id = $1`,
    [plaidId]
  );
  return r.rows[0];
}

/** What the eleven columns must hold for `t`: 40b's own mapping, unpacked the way the columns store it. */
function expectedEnrichment(t: Transaction): Record<string, unknown> {
  const params = enrichmentParams(plaidEnrichment(t));
  const out: Record<string, unknown> = {};
  ENRICHMENT.forEach((c, i) => { out[c] = c === 'plaid_raw' ? JSON.parse(params[i]!) : params[i]; });
  return out;
}

/** The ordinal the script gives `token`, by the same ordering it uses. */
async function ordinalOf(token: string): Promise<number> {
  const r = await db.query<{ access_token: string }>(
    `SELECT access_token FROM accounts WHERE access_token IS NOT NULL GROUP BY access_token ORDER BY min(id)`
  );
  return r.rows.findIndex((x) => x.access_token === token) + 1;
}

function itemOf(summary: BackfillSummary, ordinal: number) {
  const item = summary.items.find((i) => i.ordinal === ordinal);
  if (!item) throw new Error('p40c: no item at that ordinal');
  return item;
}

interface Captured { out: string[]; err: string[] }

/** `main` with the real database and transport, its output captured. */
async function run(argv: string[], over: Partial<BackfillDeps> = {}) {
  const captured: Captured = { out: [], err: [] };
  const deps: BackfillDeps = {
    ...defaultDeps,
    out: (l) => captured.out.push(l),
    err: (l) => captured.err.push(l),
    ...over,
  };
  const result = await main(argv, process.env, deps);
  return { ...result, ...captured };
}

/** A fresh, empty backup directory under the OS temp dir, outside any work tree. */
function freshDir(): string {
  return mkdtempSync(path.join(backupRoot, 'dir-'));
}

function csvFiles(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.csv')) : [];
}

/** RFC 4180, plus the script's NULL rule: an unquoted empty field is NULL, `""` is the empty string. */
function parseCsv(text: string): (string | null)[][] {
  const rows: (string | null)[][] = [];
  let row: (string | null)[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      let v = '';
      i++;
      for (;;) {
        if (text[i] === '"' && text[i + 1] === '"') { v += '"'; i += 2; }
        else if (text[i] === '"') { i++; break; }
        else { v += text[i]; i++; }
      }
      row.push(v);
    } else {
      let v = '';
      while (i < text.length && text[i] !== ',' && text[i] !== '\n') { v += text[i]; i++; }
      row.push(v === '' ? null : v);
    }
    if (text[i] === ',') { i++; continue; }
    if (text[i] === '\n') { rows.push(row); row = []; i++; }
  }
  return rows;
}

/** The real `lib/db`, wrapped so a test can act at the first write connection or the first UPDATE. */
function observedDb(hooks: { onFirstConnect?: () => Promise<void>; onFirstUpdate?: () => void }): BackfillDb {
  const real = db as unknown as BackfillDb;
  let connected = false;
  let updated = false;
  return {
    query: (text, values) => real.query(text, values),
    connect: async () => {
      if (!connected) { connected = true; await hooks.onFirstConnect?.(); }
      const client = await real.connect();
      return {
        query: async (text: string, values?: unknown[]) => {
          if (!updated && /^\s*UPDATE transactions/.test(text)) { updated = true; hooks.onFirstUpdate?.(); }
          return client.query(text, values);
        },
        release: () => client.release(),
      };
    },
  };
}

/** Dependencies that count every touch, for the tests that must show nothing was touched. */
function countingDeps() {
  const touched = { db: 0, fetch: 0 };
  const captured: Captured = { out: [], err: [] };
  const deps: BackfillDeps = {
    db: {
      query: async () => { touched.db++; throw new Error('p40c: database touched'); },
      connect: async () => { touched.db++; throw new Error('p40c: database touched'); },
    },
    fetchPage: async () => { touched.fetch++; throw new Error('p40c: network touched'); },
    out: (l) => captured.out.push(l),
    err: (l) => captured.err.push(l),
    now: () => new Date(),
    writeChunk: () => { touched.db++; throw new Error('p40c: disk touched'); },
  };
  return { deps, touched, captured };
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

beforeAll(async () => {
  backupRoot = mkdtempSync(path.join(tmpdir(), 'p40c-backfill-'));
  await cleanup();
  transferGroupId = (await db.query<{ id: number }>('INSERT INTO transfer_groups DEFAULT VALUES RETURNING id')).rows[0].id;
  propertyId = (await db.query<{ id: number }>(
    "INSERT INTO properties (nickname, type) VALUES ('Fabricated P40c Property', 'rental') RETURNING id"
  )).rows[0].id;
});

beforeEach(async () => {
  await cleanup();
  await seedCommon();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanup();
  await db.query('DELETE FROM transfer_groups WHERE id = $1', [transferGroupId]);
  await db.query('DELETE FROM properties WHERE id = $1', [propertyId]);
  await db.end();
  // Restore write permission anywhere BF-12 removed it, then remove the lot.
  for (const d of readdirSync(backupRoot)) chmodSync(path.join(backupRoot, d), 0o700);
  rmSync(backupRoot, { recursive: true, force: true });
});

describe('enrichment backfill', () => {
  it('BF-01: a dry run writes nothing to the database or the disk, and still finds rows to update', async () => {
    const before = await snapshot();
    const dir = path.join(freshDir(), 'not-yet');
    const r = await run(['--backup-dir', dir]);

    expect(r.summary!.mode).toBe('dry-run');
    expect(await snapshot()).toEqual(before);
    expect(existsSync(dir)).toBe(false);
    // Non-vacuous: a run that did nothing at all would report zero here.
    expect(r.summary!.totals.would_update).toBe(4);
    expect(r.summary!.backup).toBeNull();
  });

  it('BF-02: apply fills the eleven columns from 40b’s mapping, across pages and from the modified list', async () => {
    await run(['--apply', '--backup-dir', freshDir()]);

    // A1 on page 1; A2 on page 2 (`has_more` followed); A3 in page 2's `modified`; C1 another item.
    for (const [id, fixture] of [[TXN('A1'), FX.A1], [TXN('A2'), FX.A2], [TXN('A3'), FX.A3], [TXN('C1'), FX.C1]] as const) {
      expect(await enrichmentOf(id), id).toEqual(expectedEnrichment(fixture));
    }
    // The fixture object itself, minus only the counterparty's account numbers.
    const raw = (await enrichmentOf(TXN('A1'))).plaid_raw as Record<string, unknown>;
    expect(raw.transaction_id).toBe(TXN('A1'));
    expect(JSON.stringify(raw)).not.toContain(`${P}-IBAN`);
    // Absent in the fixture means NULL in the column, in SQL terms, not '' and not a zero.
    const a2 = await enrichmentOf(TXN('A2'));
    for (const c of ENRICHMENT.filter((c) => c !== 'plaid_raw' && c !== 'payment_channel' && c !== 'merchant_entity_id')) {
      expect(a2[c], c).toBeNull();
    }
    const blanks = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM transactions WHERE account_id = ANY($1) AND
         (logo_url = '' OR website = '' OR location_city = '' OR location_region = '' OR plaid_category_detailed = '')`,
      [MY_ACCOUNTS]
    );
    expect(blanks.rows[0].n).toBe(0);
  });

  it('BF-03: every column but the eleven is unchanged, although Plaid’s name, date, amount and category differ', async () => {
    const before = await baseColumns();
    const amounts = await db.query<{ amount: string }>('SELECT amount::text AS amount FROM transactions WHERE account_id = ANY($1) ORDER BY id', [MY_ACCOUNTS]);
    await run(['--apply', '--backup-dir', freshDir()]);

    expect(await baseColumns()).toEqual(before);
    // Spelled out for the one column the sign convention is about: byte-identical text.
    const after = await db.query<{ amount: string }>('SELECT amount::text AS amount FROM transactions WHERE account_id = ANY($1) ORDER BY id', [MY_ACCOUNTS]);
    expect(after.rows).toEqual(amounts.rows);
    // And the enrichment did land, so the equality above is not a run that wrote nothing.
    expect((await enrichmentOf(TXN('A1'))).plaid_raw).not.toBeNull();
  });

  it('BF-04: never inserts and never deletes: unknown ids, a tombstoned id and a removed entry change no row count', async () => {
    const count = async () => (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM transactions')).rows[0].n;
    const before = await count();
    const tombs = (await snapshot()).tombstones;
    const r = await run(['--apply', '--backup-dir', freshDir()]);

    expect(await count()).toBe(before);
    expect((await snapshot()).tombstones).toBe(tombs);
    const present = await db.query<{ plaid_transaction_id: string }>(
      'SELECT plaid_transaction_id FROM transactions WHERE plaid_transaction_id = ANY($1)',
      [[TXN('A6'), NEW_A, TOMB]]
    );
    // The `removed` id's row is still there; the new and the tombstoned ids were not created.
    expect(present.rows.map((x) => x.plaid_transaction_id)).toEqual([TXN('A6')]);
    // NEW_A, TOMB, and item B's id served on item A's account.
    expect(itemOf(r.summary!, await ordinalOf(TOKEN_A)).counts.not_local).toBe(3);
  });

  it('BF-05: the stored cursor is never sent and no accounts column changes, in a dry run or an apply', async () => {
    const before = (await snapshot()).accounts;
    await run(['--backup-dir', freshDir()]);
    expect((await snapshot()).accounts).toEqual(before);
    await run(['--apply', '--backup-dir', freshDir()]);
    expect((await snapshot()).accounts).toEqual(before);

    const sentinels = [ACCT_A1, ACCT_A2, ACCT_B1, ACCT_C1].map(SENTINEL_CURSOR);
    for (const req of fake.requests) expect(sentinels).not.toContain(req.cursor);
    for (const token of [TOKEN_A, TOKEN_B, TOKEN_C]) {
      const mine = fake.requests.filter((q) => q.access_token === token);
      expect(mine.length).toBeGreaterThan(0);
      // Each run starts its walk with no cursor, and continues only with the fake's own.
      expect(mine[0].cursor).toBeUndefined();
      for (const q of mine) expect(q.cursor === undefined || q.cursor.startsWith(`next-${token}-`)).toBe(true);
    }
    // Item A's two-page walk, twice: [none, page-1 cursor] per run.
    expect(fake.requests.filter((q) => q.access_token === TOKEN_A).map((q) => q.cursor))
      .toEqual([undefined, `next-${TOKEN_A}-1`, undefined, `next-${TOKEN_A}-1`]);
  });

  it('BF-06: a pending statement for a stored id leaves that row un-enriched and is counted', async () => {
    const r = await run(['--apply', '--backup-dir', freshDir()]);
    const e = await enrichmentOf(TXN('A5'));
    for (const c of ENRICHMENT) expect(e[c], c).toBeNull();
    expect(itemOf(r.summary!, await ordinalOf(TOKEN_A)).counts.pending_skipped).toBe(1);
  });

  it('BF-07: an unknown account is skipped, and an id stored on another item’s account is never written from this item', async () => {
    const r = await run(['--apply', '--backup-dir', freshDir()]);
    const a = itemOf(r.summary!, await ordinalOf(TOKEN_A)).counts;
    // UNK (an account not in the database) and B2 (served by item A on item B's account).
    expect(a.unknown_account).toBe(2);
    // B1, served by item A on item A's account, is counted not local rather than matched by id.
    expect(a.not_local).toBe(3);
    for (const id of [TXN('B1'), TXN('B2')]) {
      const e = await enrichmentOf(id);
      for (const c of ENRICHMENT) expect(e[c], `${id} ${c}`).toBeNull();
    }
  });

  it('BF-08: a failing item is reported and skipped whole while the others are processed, and the exit is non-zero', async () => {
    const dir = freshDir();
    const dry = await run(['--backup-dir', dir]);
    expect(dry.exitCode).not.toBe(0);
    expect(dry.summary!.items_failed).toBe(1);

    const r = await run(['--apply', '--backup-dir', dir]);
    expect(r.exitCode).not.toBe(0);
    expect(r.summary!.items_failed).toBe(1);
    const b = itemOf(r.summary!, await ordinalOf(TOKEN_B));
    expect(b.failed).toBe(true);
    expect(b.errorCode).toBe('ITEM_LOGIN_REQUIRED');
    // Items either side were fully processed.
    expect(itemOf(r.summary!, await ordinalOf(TOKEN_A)).counts.updated).toBe(3);
    expect(itemOf(r.summary!, await ordinalOf(TOKEN_C)).counts.updated).toBe(1);
    // B's rows untouched, and absent from the backup.
    for (const id of [TXN('B1'), TXN('B2')]) expect((await enrichmentOf(id)).plaid_raw).toBeNull();
    const [file] = csvFiles(dir);
    const ids = parseCsv(readFileSync(path.join(dir, file), 'utf8')).slice(1).map((row) => row[1]);
    expect(ids).not.toContain(TXN('B1'));
    expect(ids).not.toContain(TXN('B2'));

    // And an item whose walk fails on a LATER page applies nothing from the pages it did receive.
    // Plaid's own refusal of a walk whose data moved underneath it, on item A's SECOND page: page 1
    // (A1) was received, and must still not be written, because the item is never half-applied.
    await cleanup();
    await seedCommon();
    fake.failures.set(TOKEN_A, (cursor) =>
      cursor === undefined ? undefined : plaidError('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'));
    const torn = await run(['--apply', '--backup-dir', freshDir()]);

    expect(torn.exitCode).not.toBe(0);
    expect(itemOf(torn.summary!, await ordinalOf(TOKEN_A))).toMatchObject({
      failed: true, errorCode: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION',
    });
    for (const id of [TXN('A1'), TXN('A2'), TXN('A3')]) expect((await enrichmentOf(id)).plaid_raw, id).toBeNull();
    // C alone was updated and is the CSV's one row.
    expect(torn.summary!.totals.updated).toBe(1);
    expect(torn.summary!.backup!.rows).toBe(1);
  });

  it('BF-09: stdout, stderr and the summary carry counts, ordinals, the backup path and an error code only', async () => {
    const lines: string[] = [];
    const raw: string[] = [];
    for (const m of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(' ')); });
    }
    const outWrite = process.stdout.write.bind(process.stdout);
    const errWrite = process.stderr.write.bind(process.stderr);
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
      raw.push(String(chunk)); return (outWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stdout.write);
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
      raw.push(String(chunk)); return (errWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stderr.write);

    // The real writers this time: what reaches the console is what is checked.
    const dir = freshDir();
    const dry = await main(['--backup-dir', dir]);
    const applied = await main(['--apply', '--backup-dir', dir]);
    // A code that is not Plaid's shape is printed as UNKNOWN, never as itself.
    fake.failures.set(TOKEN_B, () => plaidError('not a code 42'));
    const odd = await main(['--backup-dir', dir]);
    vi.restoreAllMocks();

    const backupPath = applied.summary!.backup!.path;
    const everything = [...lines, ...raw, JSON.stringify([dry.summary, applied.summary, odd.summary])].join('\n');
    expect(everything).not.toContain(P);
    expect(everything).not.toContain('97531');
    expect(everything).not.toContain('not a code');
    expect(lines.join('\n')).toContain('code=ITEM_LOGIN_REQUIRED');
    expect(lines.join('\n')).toContain('code=UNKNOWN');

    // Every digit in the output is a count (`key=N`) or an ordinal (`item N of M`), once the backup
    // path — which the spec allows, and which a temp directory may put digits in — is taken out.
    const residue = lines.join('\n')
      .split(backupPath).join('<path>')
      .replace(/\b[a-z_]+=\d+\b/g, '')
      .replace(/\bitem \d+ of \d+\b/g, '');
    expect(residue).not.toMatch(/\d/);
    // And every number in the summary is an integer.
    const numbers: unknown[] = [];
    JSON.stringify([dry.summary, applied.summary, odd.summary], (_k, v) => { if (typeof v === 'number') numbers.push(v); return v; });
    for (const n of numbers) expect(Number.isInteger(n)).toBe(true);
  });

  it('BF-10: a second apply changes nothing, and neither a pre-enriched row nor one a sync enriched mid-run is overwritten', async () => {
    const raced = { plaid_raw: { sentinel: 'enriched-by-a-concurrent-sync' }, logo_url: 'https://raced.fixture.invalid/logo.png' };
    const dir = freshDir();
    // Between the plan (A1 un-enriched) and the first write, a sync enriches A1.
    const first = await run(['--apply', '--backup-dir', dir], {
      db: observedDb({
        onFirstConnect: async () => {
          await db.query('UPDATE transactions SET plaid_raw = $2::jsonb, logo_url = $3 WHERE plaid_transaction_id = $1',
            [TXN('A1'), JSON.stringify(raced.plaid_raw), raced.logo_url]);
        },
      }),
    });
    expect(first.summary!.totals.updated).toBe(3);
    expect(await enrichmentOf(TXN('A1'))).toMatchObject(raced);
    const pre = await enrichmentOf(TXN('A4'));
    expect(pre).toMatchObject({
      plaid_raw: { sentinel: 'pre-enriched' }, logo_url: 'https://pre-enriched.fixture.invalid/logo.png',
      plaid_category_detailed: 'PRE_ENRICHED_DETAILED',
    });
    expect(itemOf(first.summary!, await ordinalOf(TOKEN_A)).counts.already_enriched).toBe(1);

    const afterFirst = await snapshot();
    const filesAfterFirst = csvFiles(dir);
    const second = await run(['--apply', '--backup-dir', dir]);
    expect(second.summary!.totals.updated).toBe(0);
    expect(second.summary!.totals.would_update).toBe(0);
    expect(second.summary!.backup).toBeNull();
    expect(csvFiles(dir)).toEqual(filesAfterFirst);
    expect(await snapshot()).toEqual(afterFirst);
  });

  it('BF-11: apply writes one 0600 CSV of the full pre-update rows it changes, complete before the first UPDATE', async () => {
    const dir = freshDir();
    const columns = (await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'transactions' ORDER BY ordinal_position`
    )).rows.map((r) => r.column_name);
    const select = `SELECT ${columns.map((c) => `"${c}"::text AS "${c}"`).join(', ')} FROM transactions WHERE account_id = ANY($1) ORDER BY id`;
    const beforeRows = (await db.query<Record<string, string | null>>(select, [MY_ACCOUNTS])).rows;
    const rawBefore = new Map(beforeRows.map((r) => [r.plaid_transaction_id, r.plaid_raw]));

    let atFirstUpdate: { files: string[]; rows: number } | null = null;
    const r = await run(['--apply', '--backup-dir', dir], {
      db: observedDb({
        onFirstUpdate: () => {
          const files = csvFiles(dir);
          const rows = files.length === 1 ? parseCsv(readFileSync(path.join(dir, files[0]), 'utf8')).length - 1 : -1;
          atFirstUpdate = { files, rows };
        },
      }),
    });

    // On disk, whole, before the first UPDATE was sent.
    expect(atFirstUpdate).toEqual({ files: [expect.stringMatching(/\.csv$/)], rows: 4 });

    const files = csvFiles(dir);
    expect(files).toHaveLength(1);
    const file = path.join(dir, files[0]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(r.summary!.backup).toEqual({ path: file, rows: 4 });

    const [header, ...data] = parseCsv(readFileSync(file, 'utf8'));
    expect(header).toEqual(columns);
    expect(data).toHaveLength(r.summary!.totals.updated);
    // Each data row is the row exactly as it was before: every column, owner-set ones and the
    // then-NULL enrichment included.
    const byId = new Map(beforeRows.map((row) => [row.plaid_transaction_id, row]));
    for (const row of data) {
      const record = Object.fromEntries(columns.map((c, i) => [c, row[i]]));
      expect(record).toEqual(byId.get(record.plaid_transaction_id!));
    }
    // The CSV's ids are exactly the rows whose plaid_raw changed.
    const afterRows = (await db.query<Record<string, string | null>>(select, [MY_ACCOUNTS])).rows;
    const changed = afterRows.filter((a) => a.plaid_raw !== rawBefore.get(a.plaid_transaction_id)).map((a) => a.plaid_transaction_id).sort();
    expect(data.map((row) => row[columns.indexOf('plaid_transaction_id')]).sort()).toEqual(changed);
    expect(changed).toEqual([TXN('A1'), TXN('A2'), TXN('A3'), TXN('C1')].sort());
  });

  it('BF-12: a backup directory that cannot be written stops the apply with no row changed', async () => {
    const dir = freshDir();
    chmodSync(dir, 0o500);
    const before = await snapshot();
    const r = await run(['--apply', '--backup-dir', dir]);
    chmodSync(dir, 0o700);

    expect(r.exitCode).not.toBe(0);
    expect(r.summary!.totals.updated).toBe(0);
    expect(r.summary!.backup).toBeNull();
    expect(await snapshot()).toEqual(before);
    expect(r.err.join('\n')).toContain('nothing was changed');
  });

  it('BF-13: the dry run predicts the apply exactly, and every item’s counts add up', async () => {
    const dry = await run(['--backup-dir', freshDir()]);
    const applied = await run(['--apply', '--backup-dir', freshDir()]);

    for (const item of applied.summary!.items) {
      const predicted = itemOf(dry.summary!, item.ordinal);
      expect(item.counts.updated).toBe(predicted.counts.would_update);
      for (const c of [predicted.counts, item.counts]) {
        expect(c.matched).toBe(c.would_update + c.already_enriched);
        expect(c.plaid_returned - c.unknown_account - c.pending_skipped).toBe(c.matched + c.not_local);
      }
    }
    expect(applied.summary!.totals.updated).toBe(dry.summary!.totals.would_update);
    expect(itemOf(dry.summary!, await ordinalOf(TOKEN_A)).counts).toEqual({
      plaid_returned: 10, pending_skipped: 1, unknown_account: 2, not_local: 3, matched: 4,
      would_update: 3, already_enriched: 1, local_not_returned: 2, updated: 0,
    });
  });

  it('BF-14: hidden, capital-landscape, excluded-category and grouped rows are enriched and keep their flags', async () => {
    await run(['--apply', '--backup-dir', freshDir()]);
    const r = await db.query<{ plaid_transaction_id: string; hidden: boolean; transfer_group_id: number | null; mapped_category: string | null; enriched: boolean }>(
      `SELECT plaid_transaction_id, hidden, transfer_group_id, mapped_category, plaid_raw IS NOT NULL AS enriched
         FROM transactions WHERE plaid_transaction_id = ANY($1) ORDER BY plaid_transaction_id`,
      [[TXN('A1'), TXN('A3')]]
    );
    expect(r.rows).toEqual([
      { plaid_transaction_id: TXN('A1'), hidden: true, transfer_group_id: transferGroupId, mapped_category: 'Owner Pick', enriched: true },
      { plaid_transaction_id: TXN('A3'), hidden: false, transfer_group_id: null, mapped_category: EXCL_CAT, enriched: true },
    ]);
  });

  it('BF-15: an empty history and an item with no stored rows give numeric zero counts, exit 0 and no CSV', async () => {
    await cleanup();
    fake.histories.clear();
    fake.failures.clear();
    const D1 = `${P}-ACCT-D1`;
    const E1 = `${P}-ACCT-E1`;
    await seedAccount(D1, `${P}-TOKEN-D`);
    await seedAccount(E1, `${P}-TOKEN-E`);
    // D: Plaid returns nothing and nothing is stored. E: Plaid returns posted rows, none stored.
    fake.histories.set(`${P}-TOKEN-D`, [page({ next: `next-${P}-TOKEN-D-1`, hasMore: false })]);
    fake.histories.set(`${P}-TOKEN-E`, [page({ added: [txn(TXN('E-1'), E1), txn(TXN('E-2'), E1)], next: `next-${P}-TOKEN-E-1`, hasMore: false })]);

    const dir = freshDir();
    for (const argv of [['--backup-dir', dir], ['--apply', '--backup-dir', dir]]) {
      const r = await run(argv);
      expect(r.exitCode).toBe(0);
      expect(r.summary!.backup).toBeNull();
      for (const item of r.summary!.items) {
        for (const v of Object.values(item.counts)) expect(typeof v).toBe('number');
      }
      expect(itemOf(r.summary!, await ordinalOf(`${P}-TOKEN-D`)).counts).toEqual({
        plaid_returned: 0, pending_skipped: 0, unknown_account: 0, not_local: 0, matched: 0,
        would_update: 0, already_enriched: 0, local_not_returned: 0, updated: 0,
      });
      expect(itemOf(r.summary!, await ordinalOf(`${P}-TOKEN-E`)).counts).toEqual({
        plaid_returned: 2, pending_skipped: 0, unknown_account: 0, not_local: 2, matched: 0,
        would_update: 0, already_enriched: 0, local_not_returned: 0, updated: 0,
      });
      expect(r.out.join('\n')).toMatch(/would_update=0/);
    }
    expect(csvFiles(dir)).toEqual([]);
  });

  it('BF-16: no flag is a dry run, --apply writes, an unknown flag is refused before any access, and import does not run', async () => {
    expect(parseArgs([], { HOME: '/fixture-home' }).apply).toBe(false);
    expect(parseArgs(['--apply'], { HOME: '/fixture-home' }).apply).toBe(true);
    for (const bad of [['--aply'], ['--apply', '--force'], ['apply'], ['--backup-dir']]) {
      expect(() => parseArgs(bad, { HOME: '/fixture-home' })).toThrow(UsageError);
      const { deps, touched, captured } = countingDeps();
      const r = await main(bad, { HOME: '/fixture-home' }, deps);
      expect(r.exitCode).toBe(2);
      expect(touched).toEqual({ db: 0, fetch: 0 });
      expect(captured.err.join('\n')).toContain('--apply');
    }
    // Importing the module started nothing: no request was made before the first test, and the
    // runner's own argv is not the script's.
    expect(requestsAtImport).toBe(0);
    expect(isEntryPoint()).toBe(false);
    expect(isEntryPoint(['node', '/somewhere/apps/web/scripts/backfill-enrichment.ts'])).toBe(true);
    // And the two modes behave as named: the dry run wrote nothing, the apply wrote.
    await run(['--backup-dir', freshDir()]);
    expect((await enrichmentOf(TXN('A1'))).plaid_raw).toBeNull();
    await run(['--apply', '--backup-dir', freshDir()]);
    expect((await enrichmentOf(TXN('A1'))).plaid_raw).not.toBeNull();
  });

  it('BF-17: the default backup directory is $HOME/b8-backfill-backups, in-repo and backups paths are refused first, and a new one is 0700', async () => {
    // (a)
    expect(defaultBackupDir({ HOME: '/fixture-home' })).toBe('/fixture-home/b8-backfill-backups');
    expect(parseArgs(['--apply'], { HOME: '/fixture-home' }).backupDir).toBe('/fixture-home/b8-backfill-backups');

    // (b) Inside the work tree, inside apps/backups, inside any backups directory, and through a
    // symlink into the work tree — each refused before the database or Plaid is touched, and
    // without creating the directory.
    const link = path.join(freshDir(), 'link-into-repo');
    symlinkSync(path.join(REPO_ROOT, 'apps', 'web'), link);
    const refused = [
      path.join(REPO_ROOT, 'apps', 'web', 'p40c-should-not-exist'),
      path.join(REPO_ROOT, 'apps', 'backups', 'p40c-should-not-exist'),
      path.join(freshDir(), 'backups', 'p40c'),
      path.join(link, 'p40c-should-not-exist'),
    ];
    for (const dir of refused) {
      for (const argv of [['--apply', '--backup-dir', dir], [`--backup-dir=${dir}`]]) {
        const { deps, touched } = countingDeps();
        const r = await main(argv, { HOME: '/fixture-home' }, deps);
        expect(r.exitCode, dir).toBe(2);
        expect(touched).toEqual({ db: 0, fetch: 0 });
      }
      expect(existsSync(dir), dir).toBe(false);
    }

    // (c) A directory the apply creates is owner-only.
    const created = path.join(freshDir(), 'new', 'backfill');
    mkdirSync(path.dirname(created), { recursive: true });
    const r = await run(['--apply', '--backup-dir', created]);
    expect(r.summary!.backup).not.toBeNull();
    expect(statSync(created).mode & 0o777).toBe(0o700);
  });
  it('BF-18: a backup write that falls short is detected, and the apply stops before any UPDATE', async () => {
    const before = await snapshot();
    // (a) A write that claims every byte but puts only half of them on disk: caught by reading the
    // file back. (b) A write that makes no progress at all: caught by the loop.
    const liar: BackfillDeps['writeChunk'] = (fd, buf, offset, length) => {
      writeSync(fd, buf, offset, Math.floor(length / 2));
      return length;
    };
    const stuck: BackfillDeps['writeChunk'] = () => 0;
    for (const writeChunk of [liar, stuck]) {
      const r = await run(['--apply', '--backup-dir', freshDir()], { writeChunk });
      expect(r.exitCode).not.toBe(0);
      expect(r.summary!.totals.updated).toBe(0);
      expect(r.summary!.backup).toBeNull();
      expect(r.err.join('\n')).toContain('nothing was changed');
      expect(await snapshot()).toEqual(before);
    }

    // (c) Honest short writes — a few bytes per call, as a kernel may do — are completed by the
    // loop, and the run goes ahead with a whole backup.
    let calls = 0;
    const dribble: BackfillDeps['writeChunk'] = (fd, buf, offset, length) => {
      calls++;
      return writeSync(fd, buf, offset, Math.min(length, 7));
    };
    const dir = freshDir();
    const r = await run(['--apply', '--backup-dir', dir], { writeChunk: dribble });
    expect(calls).toBeGreaterThan(1);
    expect(r.summary!.backup!.rows).toBe(4);
    expect(r.summary!.totals.updated).toBe(4);
    expect(parseCsv(readFileSync(r.summary!.backup!.path, 'utf8'))).toHaveLength(5);
  });

  it('BF-19: a walk whose cursor does not advance, or never ends, fails its item instead of looping', async () => {
    const before = await snapshot();
    // A: page 2 says `has_more` and hands back the very cursor that fetched it.
    // C: page 1 says `has_more` with an empty cursor.
    fake.histories.set(TOKEN_A, [
      page({ added: [FX.A1], next: `next-${TOKEN_A}-1`, hasMore: true }),
      page({ added: [FX.A2], next: `next-${TOKEN_A}-1`, hasMore: true }),
    ]);
    fake.histories.set(TOKEN_C, [page({ added: [FX.C1], next: '', hasMore: true })]);
    const r = await run(['--apply', '--backup-dir', freshDir()]);

    expect(r.exitCode).not.toBe(0);
    expect(itemOf(r.summary!, await ordinalOf(TOKEN_A))).toMatchObject({ failed: true, errorCode: 'CURSOR_NOT_ADVANCING' });
    expect(itemOf(r.summary!, await ordinalOf(TOKEN_C))).toMatchObject({ failed: true, errorCode: 'CURSOR_NOT_ADVANCING' });
    expect(r.summary!.items_failed).toBe(3);
    expect(fake.requests.filter((q) => q.access_token === TOKEN_A)).toHaveLength(2);
    expect(fake.requests.filter((q) => q.access_token === TOKEN_C)).toHaveLength(1);
    expect(r.summary!.backup).toBeNull();
    expect(await snapshot()).toEqual(before);

    // C's cursor absent altogether; A's history never ends and is cut off at the page cap.
    fake.requests.length = 0;
    const missing: Record<string, unknown> = page({ added: [FX.C1], next: 'unused', hasMore: true });
    delete missing.next_cursor;
    fake.histories.set(TOKEN_C, [missing]);
    fake.endless.add(TOKEN_A);
    const r2 = await run(['--apply', '--backup-dir', freshDir()]);
    expect(itemOf(r2.summary!, await ordinalOf(TOKEN_C))).toMatchObject({ failed: true, errorCode: 'CURSOR_NOT_ADVANCING' });
    expect(itemOf(r2.summary!, await ordinalOf(TOKEN_A))).toMatchObject({ failed: true, errorCode: 'PAGE_LIMIT_EXCEEDED' });
    expect(fake.requests.filter((q) => q.access_token === TOKEN_A)).toHaveLength(MAX_PAGES_PER_ITEM);
    expect(r2.exitCode).not.toBe(0);
    expect(await snapshot()).toEqual(before);
  });
});
