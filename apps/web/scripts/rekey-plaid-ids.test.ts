// The Plaid id re-key against a real Postgres, with only the Plaid client faked (P6-40e).
//
// TIER 2, under `vitest.integration.config.mts` with the scratch-database guard in `setupFiles` —
// this file writes rows, and the guard refuses to run it against the owner's real database. It is
// named in that config's `include` by exact path and is absent from the pure config, which collects
// only `lib/**`: every rule checked here — the in-statement re-checks, the global "new id stored"
// test, "one column changes" — is a property of the SQL, and a stubbed database would assert none.
//
// WHAT IS FAKED, AND WHY ONLY THAT. `lib/plaid`, so `transactionsSync` serves fixture pages and
// records every request. The script, its SQL, the shared walk and backup, sync's matcher, 40c's
// backfill (RK-21) and `runSync` (RK-22) are the real ones; `/accounts/get` and `/item/get` exist on
// the fake only because `runSync` calls them, and the script must not (static #14). Where a test needs
// the ORDER of writes or a concurrent change between the plan and the write, it wraps the real
// `lib/db` rather than replacing it.
//
// OTHER SUITES' LEFTOVERS ARE TOLERATED, NOT TRUNCATED. The script visits every token-bearing account
// in the database; a token this file did not seed gets an empty history from the fake, so it adds
// orphans with no candidate and nothing else. Per-item assertions therefore find this file's items by
// ordinal, with the script's own ordering, and no stored-side total is asserted.
//
// THE FIXTURE, ONE ROW PER RULE. Item A carries a row for every bucket the spec names, each on its
// own date so that no two scenarios share a match key by accident; items B and C carry one re-key
// each, so a run has more than one item to commit or isolate. Every text value that could leak —
// names, merchants, ids, account ids, tokens, cursors, the Plaid secret and error message — carries
// `SENTINEL-P40E`; one pair carries an amount with a digit run no count has. Amounts are small and
// fabricated; the fractional ones exist only to pin the matcher's rounding (0.1 + 0.2 against a
// stored 0.30, 2.3 against a stored 2.30).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CounterpartyType, TransactionPaymentChannelEnum, TransactionTransactionTypeEnum, type Transaction,
} from 'plaid';
import db from '@/lib/db';
import { runSync } from '@/lib/sync';
import { defaultDeps as backfillDeps, runBackfill, type BackfillSummary } from './backfill-enrichment';
import {
  defaultBackupDir, MAX_PAGES_PER_ITEM, parseArgs, UsageError, type Env, type ScriptDb, type ScriptDeps,
} from './plaid-script-shared';
import { defaultDeps, isEntryPoint, main, type RekeyCounts, type RekeySummary } from './rekey-plaid-ids';

const fake = vi.hoisted(() => ({
  /** Every `/transactions/sync` request the fake received, in order. */
  requests: [] as { access_token: string; cursor: string | undefined }[],
  /** Per token, the pages of its history: page i is served for the fake's own cursor `next-<token>-<i>`. */
  histories: new Map<string, unknown[]>(),
  /** `<token>|<cursor>` → one page: what a real sync, sending its stored cursor, is handed (RK-22). */
  deltas: new Map<string, unknown>(),
  /** Tokens whose history never ends: every page says `has_more` and hands out a fresh cursor. */
  endless: new Set<string>(),
  /** Per token, the error its fetch rejects with for a given cursor, or undefined to serve the page. */
  failures: new Map<string, (cursor: string | undefined) => unknown>(),
}));

vi.mock('@/lib/plaid', () => ({
  plaidClient: () => ({
    transactionsSync: async (req: { access_token: string; cursor?: string }) => {
      fake.requests.push({ access_token: req.access_token, cursor: req.cursor });
      const failure = fake.failures.get(req.access_token)?.(req.cursor);
      if (failure) throw failure;
      const delta = fake.deltas.get(`${req.access_token}|${req.cursor}`);
      if (delta) return { data: delta };
      if (fake.endless.has(req.access_token)) {
        const n = req.cursor === undefined ? 0 : Number(/-(\d+)$/.exec(req.cursor)![1]);
        return { data: { added: [], modified: [], removed: [], next_cursor: `next-${req.access_token}-${n + 1}`, has_more: true } };
      }
      const pages = fake.histories.get(req.access_token);
      // A token this file did not seed is another suite's leftover: an empty history.
      if (!pages) return { data: { added: [], modified: [], removed: [], next_cursor: 'next-foreign', has_more: false } };
      let index = 0;
      if (req.cursor !== undefined) {
        const m = /^next-.*-(\d+)$/.exec(req.cursor);
        if (!m) throw new Error('p40e: a cursor the fake never issued');
        index = Number(m[1]);
      }
      return { data: pages[index] };
    },
    // For `runSync` only (RK-22). No accounts, so its reconcile remaps nothing.
    accountsGet: async () => ({ data: { accounts: [] } }),
    itemGet: async () => ({ data: { item: { institution_id: null }, status: {} } }),
    institutionsGetById: async () => {
      throw new Error('p40e: institutionsGetById was not expected');
    },
  }),
}));

// Recorded before any test runs: importing the script must not have started it.
const requestsAtImport = fake.requests.length;

const P = 'SENTINEL-P40E';
const TOKEN_A = `${P}-TOKEN-A`;
const TOKEN_B = `${P}-TOKEN-B`;
const TOKEN_C = `${P}-TOKEN-C`;
const ACCT_A1 = `${P}-ACCT-A1`;
const ACCT_A2 = `${P}-ACCT-A2`;
const ACCT_B1 = `${P}-ACCT-B1`;
const ACCT_C1 = `${P}-ACCT-C1`;
const ACCT_U = `${P}-ACCT-UNTOKENED`;
const ACCT_D1 = `${P}-ACCT-D1`;
const ACCT_E1 = `${P}-ACCT-E1`;
const ACCT_NOWHERE = `${P}-ACCT-NOWHERE`;
const MY_ACCOUNTS = [ACCT_A1, ACCT_A2, ACCT_B1, ACCT_C1, ACCT_U, ACCT_D1, ACCT_E1];
/** One cursor per item, on every account of it — what sync itself leaves behind. */
const CURSOR = (token: string) => `${token}-STORED-CURSOR`;

const TXN = (k: string) => `${P}-TXN-${k}`;
const CSV_1 = `csv_${P}-1`;
const CSV_2 = `csv_${P}-2`;
const MANUAL_1 = `manual_${P}-1`;
const EXCL_CAT = `${P}-Excluded Category`;
const NAME = (k: string) => `${P}-NAME-${k}`;
/** The `n`th day from the turn of a fabricated year, as a date-only string. */
const D = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString().slice(0, 10);
/**
 * The privacy pair's amount: tiny, fabricated, and with a digit run (`0.97`, `097`) that no count,
 * ordinal or key=value in the output can produce. Kept small on purpose — AGENTS.md: no money-shaped
 * figure in a tracked file.
 */
const ODD_AMOUNT = 0.97;
const PLAID_SECRET = `${P}-PLAID-SECRET`;
const ERROR_MESSAGE = `${P}-ERROR-MESSAGE`;

/** Every count the script reports, spelled out so a missing one fails RK-20. */
const COUNT_KEYS: (keyof RekeyCounts)[] = [
  'stored_rows', 'excluded_csv_manual', 'stored_tombstoned', 'not_orphaned', 'orphans',
  'no_match', 'excluded_new_id_stored', 'excluded_new_id_tombstoned', 'ambiguous', 'would_rekey',
  'plaid_returned', 'plaid_removed', 'unknown_account', 'pending', 'posted', 'plaid_not_stored',
  'rekeyed', 'skipped_at_write',
];

/** A Plaid statement carrying every `Transaction` key, every text one a sentinel. */
function st(id: string, accountId: string, date: string, amount: number, name: string | null, over: Partial<Transaction> = {}): Transaction {
  // A typed const rather than an assertion, so the compiler checks every key is present.
  const complete: Required<Transaction> = {
    account_id: accountId,
    amount,
    iso_currency_code: 'USD',
    unofficial_currency_code: null,
    category: ['Fixture'],
    category_id: `${P}-CATEGORY-ID`,
    check_number: null,
    date,
    location: {
      address: `${P}-ADDRESS`, city: `${P}-CITY`, region: `${P}-REGION`, postal_code: null,
      country: 'US', lat: null, lon: null, store_number: null,
    },
    // The SDK types `name` as a string, but sync reads it as `t.name ?? null` and the NULL-against-NULL
    // pair (R6) is the case that guard exists for, so a fixture may carry null here.
    name: name as string,
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
    authorized_date: null,
    authorized_datetime: null,
    datetime: null,
    payment_channel: TransactionPaymentChannelEnum.InStore,
    personal_finance_category: { primary: 'P40E_FIXTURE_PRIMARY', detailed: 'P40E_FIXTURE_DETAILED', confidence_level: 'HIGH' },
    business_finance_category: null,
    transaction_code: null,
    personal_finance_category_icon_url: `https://${P}-icon.invalid/icon.png`,
    counterparties: [{
      name: `${P}-COUNTERPARTY`, entity_id: `${P}-ENTITY`, type: CounterpartyType.Merchant,
      website: null, logo_url: null, confidence_level: 'HIGH',
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

/** A Plaid-SDK-shaped rejection: a code, a sentinel message, the secret in the request headers. */
function plaidError(code: string): Error {
  return Object.assign(new Error(ERROR_MESSAGE), {
    config: { headers: { 'PLAID-SECRET': PLAID_SECRET, 'PLAID-CLIENT-ID': `${P}-CLIENT-ID` }, data: `{"access_token":"${TOKEN_B}"}` },
    response: { status: 400, data: { error_code: code, error_message: ERROR_MESSAGE, request_id: `${P}-REQUEST` } },
  });
}

/**
 * The stored rows of the common fixture. `plaidId` is the id the row is seeded with; `expect` is the
 * id it must hold after an apply (absent = unchanged). Day numbers keep every scenario's key apart.
 */
interface Seed { plaidId: string; account: string; day: number; amount: string; name: string | null; extra?: Record<string, unknown>; rekeyTo?: string }

function seeds(transferGroupId: number, propertyId: number): Seed[] {
  return [
    // ── would_rekey (item A: 8) ──────────────────────────────────────────────────────────────
    // R1: owner-set everything, in a transfer group, hidden; stored `WEBOX` vs Plaid `  webox `.
    { plaidId: TXN('R1'), account: ACCT_A1, day: 1, amount: '2', name: 'WEBOX', rekeyTo: TXN('N1'), extra: {
      hidden: true, watched_at: '2026-01-05T10:00:00Z', note: 'Fabricated P40e owner note',
      transfer_group_id: transferGroupId, property_id: propertyId, mapped_category: 'Owner Pick', rule_applied: false,
    } },
    // R2: on the capital-landscape account; its candidate is in page 3's `modified`.
    { plaidId: TXN('R2'), account: ACCT_A2, day: 2, amount: '3', name: NAME('R2'), rekeyTo: TXN('N2') },
    // R3: an excluded-category row; its candidate is on page 2.
    { plaidId: TXN('R3'), account: ACCT_A1, day: 3, amount: '4', name: NAME('R3'), rekeyTo: TXN('N3'), extra: { mapped_category: EXCL_CAT, rule_applied: false } },
    // R4/R5: the matcher's rounding — 0.1 + 0.2 against 0.30, and 2.3 against 2.30.
    { plaidId: TXN('R4'), account: ACCT_A1, day: 4, amount: '0.30', name: NAME('R4'), rekeyTo: TXN('N4') },
    { plaidId: TXN('R5'), account: ACCT_A1, day: 5, amount: '2.30', name: NAME('R5'), rekeyTo: TXN('N5') },
    // R6: NULL name against Plaid's NULL name.
    { plaidId: TXN('R6'), account: ACCT_A1, day: 6, amount: '5', name: null, rekeyTo: TXN('N6') },
    // R7: two same-key statements, one tombstoned — the free one is taken, the tombstoned takes no claim.
    { plaidId: TXN('R7'), account: ACCT_A1, day: 7, amount: '6', name: NAME('R7'), rekeyTo: TXN('N7') },
    // R9: the privacy pair.
    { plaidId: TXN('R9'), account: ACCT_A1, day: 9, amount: String(ODD_AMOUNT), name: NAME('R9'), rekeyTo: TXN('N9') },

    // ── no_match (item A: 10) ────────────────────────────────────────────────────────────────
    { plaidId: TXN('M1'), account: ACCT_A1, day: 10, amount: '1', name: `${P}-Alpha` },   // name differs
    { plaidId: TXN('M2'), account: ACCT_A1, day: 11, amount: '1', name: NAME('M2') },     // date one day off
    { plaidId: TXN('M3'), account: ACCT_A1, day: 13, amount: '3.00', name: NAME('M3') },  // amount 0.01 off
    { plaidId: TXN('M4'), account: ACCT_A1, day: 14, amount: '-4', name: NAME('M4') },    // opposite sign
    { plaidId: TXN('M5'), account: ACCT_A1, day: 15, amount: '1', name: NAME('M5') },     // other account
    { plaidId: TXN('M6'), account: ACCT_A1, day: 16, amount: '1', name: null },           // NULL vs a name
    { plaidId: TXN('M7'), account: ACCT_A1, day: 17, amount: '1', name: NAME('M7') },     // only a pending lookalike
    { plaidId: TXN('M8'), account: ACCT_A1, day: 18, amount: '1', name: NAME('M8') },     // lookalike added then removed
    { plaidId: TXN('ADDREM'), account: ACCT_A1, day: 19, amount: '1', name: NAME('ADDREM') }, // own id added then removed
    { plaidId: TXN('REMONLY'), account: ACCT_A1, day: 39, amount: '1', name: NAME('REMONLY') }, // own id only in `removed`

    // ── not_orphaned (item A: 4) ─────────────────────────────────────────────────────────────
    { plaidId: TXN('K1'), account: ACCT_A1, day: 20, amount: '1', name: NAME('K1') },     // posted, plus a same-key new id
    { plaidId: TXN('K2'), account: ACCT_A1, day: 21, amount: '1', name: NAME('K2') },     // present only as pending
    { plaidId: TXN('NS1'), account: ACCT_A1, day: 22, amount: '1', name: NAME('HOLDER1') }, // holds a candidate's id
    { plaidId: TXN('NS2'), account: ACCT_A2, day: 22, amount: '1', name: NAME('HOLDER2') }, // same, on the other account

    // ── excluded_new_id_stored (item A: 3), excluded_new_id_tombstoned (1), stored_tombstoned (1) ──
    { plaidId: TXN('ST1'), account: ACCT_A1, day: 23, amount: '1', name: NAME('ST1') },
    { plaidId: TXN('ST2'), account: ACCT_A1, day: 24, amount: '1', name: NAME('ST2') },
    { plaidId: TXN('ST3'), account: ACCT_A1, day: 25, amount: '1', name: NAME('ST3') },
    { plaidId: TXN('TOMBO'), account: ACCT_A1, day: 26, amount: '1', name: NAME('TOMBO') },
    { plaidId: TXN('TS'), account: ACCT_A1, day: 27, amount: '1', name: NAME('TS') },

    // ── excluded_csv_manual (item A: 3), and the CSV row that makes an orphan ambiguous ────────
    { plaidId: CSV_1, account: ACCT_A1, day: 28, amount: '1', name: NAME('CSV1') },
    { plaidId: MANUAL_1, account: ACCT_A1, day: 29, amount: '1', name: NAME('MAN1') },
    { plaidId: CSV_2, account: ACCT_A1, day: 30, amount: '1', name: NAME('CA') },
    { plaidId: TXN('CA'), account: ACCT_A1, day: 30, amount: '1', name: NAME('CA') },

    // ── ambiguous (item A: 6 = these 5 + CA) ──────────────────────────────────────────────────
    { plaidId: TXN('AMB1'), account: ACCT_A1, day: 31, amount: '1', name: NAME('AMB1') },   // 1 vs 2
    { plaidId: TXN('AMB2A'), account: ACCT_A1, day: 32, amount: '1', name: NAME('AMB2') },  // 2 vs 1
    { plaidId: TXN('AMB2B'), account: ACCT_A1, day: 32, amount: '1', name: NAME('AMB2') },
    { plaidId: TXN('AMB3A'), account: ACCT_A1, day: 33, amount: '1', name: NAME('AMB3') },  // 2 vs 2
    { plaidId: TXN('AMB3B'), account: ACCT_A1, day: 33, amount: '1', name: NAME('AMB3') },

    // ── item B: one re-key, one cross-item lookalike, one holder of A's candidate id ──────────
    { plaidId: TXN('B1'), account: ACCT_B1, day: 40, amount: '1', name: NAME('B1'), rekeyTo: TXN('NB1') },
    { plaidId: TXN('XB'), account: ACCT_B1, day: 34, amount: '1', name: NAME('XB') },
    { plaidId: TXN('NS3'), account: ACCT_B1, day: 36, amount: '1', name: NAME('HOLDER3') },

    // ── item C: one re-key ──────────────────────────────────────────────────────────────────
    { plaidId: TXN('C1'), account: ACCT_C1, day: 41, amount: '1', name: NAME('C1'), rekeyTo: TXN('NC1') },

    // ── an account with no token: never visited ────────────────────────────────────────────────
    { plaidId: TXN('U1'), account: ACCT_U, day: 35, amount: '1', name: NAME('U1') },
  ];
}

/** Item A's three pages: everything on page 1, a candidate on page 2, a `modified` one on page 3. */
function historyA(): unknown[] {
  return [
    page({
      added: [
        st(TXN('N1'), ACCT_A1, D(1), 2, '  webox '),
        st(TXN('N4'), ACCT_A1, D(4), 0.1 + 0.2, NAME('R4')),
        st(TXN('N5'), ACCT_A1, D(5), 2.3, NAME('R5')),
        st(TXN('N6'), ACCT_A1, D(6), 5, null),
        st(TXN('N7T'), ACCT_A1, D(7), 6, NAME('R7')),
        st(TXN('N7'), ACCT_A1, D(7), 6, NAME('R7')),
        st(TXN('N9'), ACCT_A1, D(9), ODD_AMOUNT, NAME('R9')),
        st(TXN('NM1'), ACCT_A1, D(10), 1, `${P}-Alphb`),
        st(TXN('NM2'), ACCT_A1, D(12), 1, NAME('M2')),
        st(TXN('NM3'), ACCT_A1, D(13), 3.01, NAME('M3')),
        st(TXN('NM4'), ACCT_A1, D(14), 4, NAME('M4')),
        st(TXN('NM5'), ACCT_A2, D(15), 1, NAME('M5')),
        st(TXN('NM6'), ACCT_A1, D(16), 1, `${P}-Gamma`),
        st(TXN('NM7'), ACCT_A1, D(17), 1, NAME('M7'), { pending: true }),
        st(TXN('NM8'), ACCT_A1, D(18), 1, NAME('M8')),
        st(TXN('ADDREM'), ACCT_A1, D(19), 1, NAME('ADDREM')),
        st(TXN('K1'), ACCT_A1, D(20), 1, NAME('K1')),
        st(TXN('NK1'), ACCT_A1, D(20), 1, NAME('K1')),
        st(TXN('K2'), ACCT_A1, D(21), 1, NAME('K2'), { pending: true }),
        st(TXN('NS1'), ACCT_A1, D(23), 1, NAME('ST1')),
        st(TXN('NS2'), ACCT_A1, D(24), 1, NAME('ST2')),
        st(TXN('NS3'), ACCT_A1, D(25), 1, NAME('ST3')),
        st(TXN('NT'), ACCT_A1, D(26), 1, NAME('TOMBO')),
        st(TXN('NTS'), ACCT_A1, D(27), 1, NAME('TS')),
        st(TXN('NCSV1'), ACCT_A1, D(28), 1, NAME('CSV1')),
        st(TXN('NMAN1'), ACCT_A1, D(29), 1, NAME('MAN1')),
        st(TXN('NCA'), ACCT_A1, D(30), 1, NAME('CA')),
        st(TXN('NAMB1A'), ACCT_A1, D(31), 1, NAME('AMB1')),
        st(TXN('NAMB1B'), ACCT_A1, D(31), 1, NAME('AMB1')),
        st(TXN('NAMB2'), ACCT_A1, D(32), 1, NAME('AMB2')),
        st(TXN('NAMB3A'), ACCT_A1, D(33), 1, NAME('AMB3')),
        st(TXN('NAMB3B'), ACCT_A1, D(33), 1, NAME('AMB3')),
        // Item A serving a statement for item B's account, with the key of B's orphan XB.
        st(TXN('NXB'), ACCT_B1, D(34), 1, NAME('XB')),
        st(TXN('NUNK'), ACCT_NOWHERE, D(37), 1, NAME('UNK')),
        st(TXN('NU'), ACCT_U, D(35), 1, NAME('U1')),
      ],
      removed: [TXN('REMONLY')],
      next: `next-${TOKEN_A}-1`, hasMore: true,
    }),
    page({ added: [st(TXN('N3'), ACCT_A1, D(3), 4, NAME('R3'))], removed: [TXN('NM8'), TXN('ADDREM')], next: `next-${TOKEN_A}-2`, hasMore: true }),
    page({ modified: [st(TXN('N2'), ACCT_A2, D(2), 3, NAME('R2'))], next: `next-${TOKEN_A}-3`, hasMore: false }),
  ];
}

/** Item A's counts, for the fixture above — derived by hand from the comments in `seeds`. */
const A_DRY: Omit<RekeyCounts, 'rekeyed' | 'skipped_at_write'> = {
  stored_rows: 36, excluded_csv_manual: 3, stored_tombstoned: 1, not_orphaned: 4, orphans: 28,
  no_match: 10, excluded_new_id_stored: 3, excluded_new_id_tombstoned: 1, ambiguous: 6, would_rekey: 8,
  plaid_returned: 37, plaid_removed: 2, unknown_account: 3, pending: 2, posted: 30, plaid_not_stored: 18,
};

function seedFake(): void {
  fake.requests.length = 0;
  fake.histories.clear();
  fake.deltas.clear();
  fake.failures.clear();
  fake.endless.clear();
  fake.histories.set(TOKEN_A, historyA());
  fake.histories.set(TOKEN_B, [page({ added: [st(TXN('NB1'), ACCT_B1, D(40), 1, NAME('B1'))], next: `next-${TOKEN_B}-1`, hasMore: false })]);
  fake.histories.set(TOKEN_C, [page({ added: [st(TXN('NC1'), ACCT_C1, D(41), 1, NAME('C1'))], next: `next-${TOKEN_C}-1`, hasMore: false })]);
}

let transferGroupId = 0;
let propertyId = 0;
let backupRoot = '';
let startedAt = '';
/** Seeded Plaid id → primary key, for the common fixture. */
let pk = new Map<string, number>();
let SEEDS: Seed[] = [];

async function cleanup(): Promise<void> {
  await db.query('DELETE FROM transactions WHERE account_id = ANY($1) OR plaid_transaction_id LIKE $2', [MY_ACCOUNTS, `%${P}%`]);
  await db.query('DELETE FROM transaction_tombstones WHERE plaid_transaction_id LIKE $1', [`${P}-%`]);
  await db.query('DELETE FROM account_valuations WHERE account_id = ANY($1)', [MY_ACCOUNTS]);
  await db.query('DELETE FROM accounts WHERE id = ANY($1)', [MY_ACCOUNTS]);
  await db.query('DELETE FROM budget_categories WHERE name = $1', [EXCL_CAT]);
}

async function seedAccount(id: string, token: string | null, landscape = 'operational'): Promise<void> {
  await db.query(
    `INSERT INTO accounts (id, name, type, landscape, access_token, cursor, last_synced_at,
                           item_last_successful_update, item_last_failed_update, bank)
     VALUES ($1, $2, 'depository', $3, $4, $5, '2026-01-01T08:00:00Z', '2026-01-01T07:00:00Z',
             '2025-12-01T07:00:00Z', $6)`,
    [id, `${P}-ACCOUNT-NAME-${id}`, landscape, token, token ? CURSOR(token) : null, `${P}-BANK`]
  );
}

async function seedRow(s: Seed): Promise<number> {
  const extra = s.extra ?? {};
  const cols = ['plaid_transaction_id', 'account_id', 'date', 'amount', 'name', 'merchant_name', 'plaid_category', ...Object.keys(extra)];
  const vals = [s.plaidId, s.account, D(s.day), s.amount, s.name, `${P}-STORED-MERCHANT`, 'P40E_OLD_PRIMARY', ...Object.values(extra)];
  const r = await db.query<{ id: number }>(
    `INSERT INTO transactions (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    vals
  );
  return r.rows[0].id;
}

/** The common fixture: three items and an untokened account, every account with a sentinel cursor. */
async function seedCommon(): Promise<void> {
  await seedAccount(ACCT_A1, TOKEN_A);
  await seedAccount(ACCT_A2, TOKEN_A, 'capital');
  await seedAccount(ACCT_B1, TOKEN_B);
  await seedAccount(ACCT_C1, TOKEN_C);
  await seedAccount(ACCT_U, null);
  await db.query(
    `INSERT INTO budget_categories (name, annual_budget, landscape, exclude_from_budget) VALUES ($1, 0, 'capital', TRUE)`,
    [EXCL_CAT]
  );
  SEEDS = seeds(transferGroupId, propertyId);
  pk = new Map();
  for (const s of SEEDS) pk.set(s.plaidId, await seedRow(s));
  for (const id of [TXN('NT'), TXN('N7T'), TXN('TS')]) {
    await db.query('INSERT INTO transaction_tombstones (plaid_transaction_id) VALUES ($1)', [id]);
  }
  seedFake();
}

/** Every row of the three tables the script may read, every column, as Postgres's own text. */
async function snapshot(): Promise<{ transactions: string[]; accounts: string[]; tombstones: string[] }> {
  const t = await db.query<{ r: string }>('SELECT t::text AS r FROM transactions t ORDER BY id');
  const a = await db.query<{ r: string }>('SELECT a::text AS r FROM accounts a ORDER BY id');
  const b = await db.query<{ r: string }>('SELECT b::text AS r FROM transaction_tombstones b ORDER BY plaid_transaction_id');
  return { transactions: t.rows.map((r) => r.r), accounts: a.rows.map((r) => r.r), tombstones: b.rows.map((r) => r.r) };
}

/** The seeded row's current Plaid id, found by primary key. */
async function idNow(seeded: string): Promise<string | undefined> {
  const r = await db.query<{ plaid_transaction_id: string }>('SELECT plaid_transaction_id FROM transactions WHERE id = $1', [pk.get(seeded)]);
  return r.rows[0]?.plaid_transaction_id;
}

async function isStored(plaidId: string): Promise<boolean> {
  return ((await db.query('SELECT 1 FROM transactions WHERE plaid_transaction_id = $1', [plaidId])).rowCount ?? 0) > 0;
}

/** This file's rows with every column except the Plaid id, keyed by primary key. */
async function allButId(): Promise<Map<number, string>> {
  const r = await db.query<{ id: number; r: string }>(
    `SELECT id, (to_jsonb(t) - 'plaid_transaction_id')::text AS r FROM transactions t WHERE account_id = ANY($1) ORDER BY id`,
    [MY_ACCOUNTS]
  );
  return new Map(r.rows.map((x) => [x.id, x.r]));
}

/** The ordinal the script gives `token`, by the same ordering it uses. */
async function ordinalOf(token: string): Promise<number> {
  const r = await db.query<{ access_token: string }>(
    `SELECT access_token FROM accounts WHERE access_token IS NOT NULL GROUP BY access_token ORDER BY min(id)`
  );
  return r.rows.findIndex((x) => x.access_token === token) + 1;
}

async function itemOf(summary: RekeySummary, token: string) {
  const ordinal = await ordinalOf(token);
  const item = summary.items.find((i) => i.ordinal === ordinal);
  if (!item) throw new Error('p40e: no item at that ordinal');
  return item;
}

function dryPart(c: RekeyCounts): Omit<RekeyCounts, 'rekeyed' | 'skipped_at_write'> {
  const { rekeyed: _r, skipped_at_write: _s, ...rest } = c;
  return rest;
}

interface Captured { out: string[]; err: string[] }

/** `main` with the real database and transport, its output captured. */
async function run(argv: string[], over: Partial<ScriptDeps> = {}, env: Env = process.env) {
  const captured: Captured = { out: [], err: [] };
  const deps: ScriptDeps = {
    ...defaultDeps,
    out: (l) => captured.out.push(l),
    err: (l) => captured.err.push(l),
    ...over,
  };
  const result = await main(argv, env, deps);
  return { ...result, ...captured };
}

/** A fresh, empty backup directory under the OS temp dir, outside any work tree. */
function freshDir(): string {
  return mkdtempSync(path.join(backupRoot, 'dir-'));
}

function csvFiles(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.csv')) : [];
}

/** RFC 4180, plus the scripts' NULL rule: an unquoted empty field is NULL, `""` is the empty string. */
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

/**
 * The real `lib/db`, wrapped so a test can act at the first write connection, see the first UPDATE,
 * or make the Nth UPDATE (counted across the whole run) fail.
 */
function observedDb(hooks: { onFirstConnect?: () => Promise<void>; onFirstUpdate?: () => void; failUpdate?: number }): ScriptDb {
  const real = db as unknown as ScriptDb;
  let connected = false;
  let updates = 0;
  return {
    query: (text, values) => real.query(text, values),
    connect: async () => {
      if (!connected) { connected = true; await hooks.onFirstConnect?.(); }
      const client = await real.connect();
      return {
        query: async (text: string, values?: unknown[]) => {
          if (/^\s*UPDATE transactions/.test(text)) {
            updates++;
            if (updates === 1) hooks.onFirstUpdate?.();
            if (updates === hooks.failUpdate) throw new Error('p40e: injected UPDATE failure');
          }
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
  const deps: ScriptDeps = {
    db: {
      query: async () => { touched.db++; throw new Error('p40e: database touched'); },
      connect: async () => { touched.db++; throw new Error('p40e: database touched'); },
    },
    fetchPage: async () => { touched.fetch++; throw new Error('p40e: network touched'); },
    out: (l) => captured.out.push(l),
    err: (l) => captured.err.push(l),
    now: () => new Date(),
    writeChunk: () => { touched.db++; throw new Error('p40e: disk touched'); },
  };
  return { deps, touched, captured };
}

/** The seeded rows an apply must re-key, as primary key → new id. */
function expectedRekeys(): Map<number, string> {
  return new Map(SEEDS.filter((s) => s.rekeyTo).map((s) => [pk.get(s.plaidId)!, s.rekeyTo!]));
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

beforeAll(async () => {
  backupRoot = mkdtempSync(path.join(tmpdir(), 'p40e-rekey-'));
  startedAt = (await db.query<{ now: string }>('SELECT now()::text AS now')).rows[0].now;
  await cleanup();
  transferGroupId = (await db.query<{ id: number }>('INSERT INTO transfer_groups DEFAULT VALUES RETURNING id')).rows[0].id;
  propertyId = (await db.query<{ id: number }>(
    "INSERT INTO properties (nickname, type) VALUES ('Fabricated P40e Property', 'rental') RETURNING id"
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
  await db.query('DELETE FROM sync_log WHERE ran_at >= $1', [startedAt]);
  await db.end();
  // Restore write permission anywhere RK-14 removed it, then remove the lot.
  for (const d of readdirSync(backupRoot)) chmodSync(path.join(backupRoot, d), 0o700);
  rmSync(backupRoot, { recursive: true, force: true });
});

describe('plaid id re-key', () => {
  it('RK-01: a dry run writes nothing to the database or the disk, and still finds rows to re-key', async () => {
    const before = await snapshot();
    const dir = path.join(freshDir(), 'not-yet');
    const r = await run(['--backup-dir', dir]);

    expect(r.exitCode).toBe(0);
    expect(r.summary!.mode).toBe('dry-run');
    expect(await snapshot()).toEqual(before);
    expect(existsSync(dir)).toBe(false);
    expect(r.summary!.backup).toBeNull();
    // Non-vacuous: a run that did nothing at all would report zero here.
    expect((await itemOf(r.summary!, TOKEN_A)).counts.would_rekey).toBe(8);
    expect(r.summary!.totals.would_rekey).toBe(10);
    expect(r.out.join('\n')).toContain('mode=dry-run');
  });

  it('RK-02: apply re-keys exactly the unambiguous orphans and changes nothing but the id', async () => {
    const before = await allButId();
    const idsBefore = new Map<number, string>(SEEDS.map((s) => [pk.get(s.plaidId)!, s.plaidId]));
    const r = await run(['--apply', '--backup-dir', freshDir()]);
    expect(r.exitCode).toBe(0);
    expect(r.summary!.totals.rekeyed).toBe(10);

    // Every other column of every row — owner-set ones, `plaid_raw` still NULL, `created_at`, name,
    // amount, date — is identical, and no row appeared or vanished.
    expect(await allButId()).toEqual(before);
    const rekeys = expectedRekeys();
    const now = await db.query<{ id: number; plaid_transaction_id: string; plaid_raw: unknown }>(
      'SELECT id, plaid_transaction_id, plaid_raw FROM transactions WHERE account_id = ANY($1) ORDER BY id', [MY_ACCOUNTS]
    );
    for (const row of now.rows) {
      expect(row.plaid_transaction_id, String(row.id)).toBe(rekeys.get(row.id) ?? idsBefore.get(row.id));
      expect(row.plaid_raw).toBeNull();
    }
    // The flag-carrying rows are among those re-keyed: no flag is a filter.
    const flagged = await db.query<{ plaid_transaction_id: string; hidden: boolean; transfer_group_id: number | null; mapped_category: string | null; landscape: string }>(
      `SELECT t.plaid_transaction_id, t.hidden, t.transfer_group_id, t.mapped_category, a.landscape
         FROM transactions t JOIN accounts a ON a.id = t.account_id
        WHERE t.id = ANY($1) ORDER BY t.plaid_transaction_id`,
      [[pk.get(TXN('R1')), pk.get(TXN('R2')), pk.get(TXN('R3'))]]
    );
    expect(flagged.rows).toEqual([
      { plaid_transaction_id: TXN('N1'), hidden: true, transfer_group_id: transferGroupId, mapped_category: 'Owner Pick', landscape: 'operational' },
      { plaid_transaction_id: TXN('N2'), hidden: false, transfer_group_id: null, mapped_category: null, landscape: 'capital' },
      { plaid_transaction_id: TXN('N3'), hidden: false, transfer_group_id: null, mapped_category: EXCL_CAT, landscape: 'operational' },
    ]);
  });

  it('RK-03: the pairing is sync’s matcher — case, whitespace and rounding pair; name, date, cent, sign and account do not', async () => {
    const r = await run(['--apply', '--backup-dir', freshDir()]);
    // Paired: `WEBOX` / `  webox `; 0.30 / 0.1 + 0.2; 2.30 / 2.3; NULL / NULL.
    expect(await idNow(TXN('R1'))).toBe(TXN('N1'));
    expect(await idNow(TXN('R4'))).toBe(TXN('N4'));
    expect(await idNow(TXN('R5'))).toBe(TXN('N5'));
    expect(await idNow(TXN('R6'))).toBe(TXN('N6'));
    // Not paired, each left as it was and its lookalike not stored: a different name, a date one
    // day off, an amount one cent off, the opposite sign, another account, NULL against a name.
    for (const k of ['M1', 'M2', 'M3', 'M4', 'M5', 'M6']) {
      expect(await idNow(TXN(k)), k).toBe(TXN(k));
      expect(await isStored(TXN(`N${k}`)), k).toBe(false);
    }
    // The stored name is never rewritten, even where the matcher saw past its case and spacing.
    const name = await db.query<{ name: string }>('SELECT name FROM transactions WHERE id = $1', [pk.get(TXN('R1'))]);
    expect(name.rows[0].name).toBe('WEBOX');
    expect((await itemOf(r.summary!, TOKEN_A)).counts.no_match).toBe(10);
  });

  it('RK-04: a row whose id Plaid still sends stays, posted or pending, and a same-key new id is not used', async () => {
    const r = await run(['--apply', '--backup-dir', freshDir()]);
    expect(await idNow(TXN('K1'))).toBe(TXN('K1'));
    expect(await idNow(TXN('K2'))).toBe(TXN('K2'));
    expect(await isStored(TXN('NK1'))).toBe(false);
    expect((await itemOf(r.summary!, TOKEN_A)).counts.not_orphaned).toBe(4);
  });

  it('RK-05: csv_ and manual_ rows are never re-keyed, and a csv_ row sharing a key makes the orphan ambiguous', async () => {
    const r = await run(['--apply', '--backup-dir', freshDir()]);
    for (const id of [CSV_1, MANUAL_1, CSV_2, TXN('CA')]) expect(await idNow(id), id).toBe(id);
    for (const id of [TXN('NCSV1'), TXN('NMAN1'), TXN('NCA')]) expect(await isStored(id), id).toBe(false);
    const a = (await itemOf(r.summary!, TOKEN_A)).counts;
    expect(a.excluded_csv_manual).toBe(3);
    // CA's key: one orphan, one csv_ row, one free statement — ambiguous, not re-keyed.
    expect(a.ambiguous).toBe(6);
  });

  it('RK-06: a candidate whose id is stored anywhere — same account, another account, another item — is never used', async () => {
    const before = await snapshot();
    const r = await run(['--apply', '--backup-dir', freshDir()]);
    expect(r.exitCode).toBe(0);
    for (const k of ['ST1', 'ST2', 'ST3']) expect(await idNow(TXN(k)), k).toBe(TXN(k));
    // The holders are untouched, on A1, A2 and item B's B1.
    for (const k of ['NS1', 'NS2', 'NS3']) expect(await idNow(TXN(k)), k).toBe(TXN(k));
    expect((await itemOf(r.summary!, TOKEN_A)).counts.excluded_new_id_stored).toBe(3);
    // And none of those rows changed in any column.
    const after = await snapshot();
    const holders = [...['ST1', 'ST2', 'ST3', 'NS1', 'NS2', 'NS3']].map((k) => pk.get(TXN(k)));
    const pick = (rows: string[]) => rows.filter((x) => holders.some((id) => x.startsWith(`(${id},`)));
    expect(pick(after.transactions)).toEqual(pick(before.transactions));
  });

  it('RK-07: a tombstoned candidate is never used and takes no claim; a tombstoned stored row is left alone', async () => {
    const before = (await snapshot()).tombstones;
    const r = await run(['--apply', '--backup-dir', freshDir()]);
    const a = (await itemOf(r.summary!, TOKEN_A)).counts;
    expect(await idNow(TXN('TOMBO'))).toBe(TXN('TOMBO'));
    expect(a.excluded_new_id_tombstoned).toBe(1);
    // Two same-key statements, one tombstoned: the free one is taken.
    expect(await idNow(TXN('R7'))).toBe(TXN('N7'));
    // A stored row bearing a tombstoned id.
    expect(await idNow(TXN('TS'))).toBe(TXN('TS'));
    expect(a.stored_tombstoned).toBe(1);
    expect((await snapshot()).tombstones).toEqual(before);
  });

  it('RK-08: 1:2, 2:1 and 2:2 groups are skipped and counted once per stored row, while a 1:1 group in the same run is re-keyed', async () => {
    const r = await run(['--apply', '--backup-dir', freshDir()]);
    for (const k of ['AMB1', 'AMB2A', 'AMB2B', 'AMB3A', 'AMB3B']) expect(await idNow(TXN(k)), k).toBe(TXN(k));
    for (const k of ['NAMB1A', 'NAMB1B', 'NAMB2', 'NAMB3A', 'NAMB3B']) expect(await isStored(TXN(k)), k).toBe(false);
    // 1 + 2 + 2, plus the csv_-shared key of RK-05.
    expect((await itemOf(r.summary!, TOKEN_A)).counts.ambiguous).toBe(6);
    // Not a wholesale skip.
    expect(await idNow(TXN('R1'))).toBe(TXN('N1'));
  });

  it('RK-09: a statement from another item’s walk, an untokened account and an unknown account are never applied', async () => {
    const r = await run(['--apply', '--backup-dir', freshDir()]);
    // Item A's walk served NXB on item B's account with the key of B's orphan XB.
    expect(await idNow(TXN('XB'))).toBe(TXN('XB'));
    expect(await isStored(TXN('NXB'))).toBe(false);
    expect((await itemOf(r.summary!, TOKEN_B)).counts).toMatchObject({ orphans: 3, no_match: 2, would_rekey: 1, rekeyed: 1 });
    // The untokened account's row, and a statement for an account the database does not hold.
    expect(await idNow(TXN('U1'))).toBe(TXN('U1'));
    expect(await isStored(TXN('NU'))).toBe(false);
    expect(await isStored(TXN('NUNK'))).toBe(false);
    expect((await itemOf(r.summary!, TOKEN_A)).counts.unknown_account).toBe(3);
  });

  it('RK-10: a pending statement is never a target, and an id added then removed is neither present nor a target', async () => {
    const r = await run(['--apply', '--backup-dir', freshDir()]);
    const a = (await itemOf(r.summary!, TOKEN_A)).counts;
    // M7's only lookalike is pending; M8's was added on page 1 and removed on page 2.
    expect(await idNow(TXN('M7'))).toBe(TXN('M7'));
    expect(await idNow(TXN('M8'))).toBe(TXN('M8'));
    expect(await isStored(TXN('NM7'))).toBe(false);
    expect(await isStored(TXN('NM8'))).toBe(false);
    // ADDREM's own id was added then removed: an orphan with no candidate, not "present" — and
    // still stored, because `removed` deletes nothing.
    expect(await idNow(TXN('ADDREM'))).toBe(TXN('ADDREM'));
    expect(a.not_orphaned).toBe(4);
    expect(a.no_match).toBe(10);
    expect(a.plaid_removed).toBe(2);
    expect(a.pending).toBe(2);
  });

  it('RK-11: the whole walk is read before matching — a page-2 candidate and a page-3 modified one are paired', async () => {
    await run(['--apply', '--backup-dir', freshDir()]);
    expect(await idNow(TXN('R3'))).toBe(TXN('N3'));
    expect(await idNow(TXN('R2'))).toBe(TXN('N2'));
    expect(fake.requests.filter((q) => q.access_token === TOKEN_A).map((q) => q.cursor))
      .toEqual([undefined, `next-${TOKEN_A}-1`, `next-${TOKEN_A}-2`]);
  });

  it('RK-12: an item is re-keyed whole or not at all, and a failing item is isolated from the others', async () => {
    // (a) The second UPDATE of the run — item A's — fails: all of A rolls back, B and C commit.
    const r = await run(['--apply', '--backup-dir', freshDir()], { db: observedDb({ failUpdate: 2 }) });
    expect(r.exitCode).toBe(1);
    expect(r.summary!.items_failed).toBe(1);
    expect(await itemOf(r.summary!, TOKEN_A)).toMatchObject({ failed: true, errorCode: 'UNKNOWN' });
    for (const s of SEEDS.filter((x) => x.account === ACCT_A1 || x.account === ACCT_A2)) {
      expect(await idNow(s.plaidId), s.plaidId).toBe(s.plaidId);
    }
    expect(await idNow(TXN('B1'))).toBe(TXN('NB1'));
    expect(await idNow(TXN('C1'))).toBe(TXN('NC1'));

    // (b) Item A's fetch rejects on page 2, after page 1 arrived: A is untouched and absent from the
    // CSV, B and C are processed — in a dry run and in an apply.
    await cleanup();
    await seedCommon();
    fake.failures.set(TOKEN_A, (cursor) => (cursor === undefined ? undefined : plaidError('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION')));
    const dry = await run(['--backup-dir', freshDir()]);
    expect(dry.exitCode).toBe(1);
    expect(await itemOf(dry.summary!, TOKEN_A)).toMatchObject({ failed: true, errorCode: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' });
    expect(dry.summary!.totals.would_rekey).toBe(2);
    const dir = freshDir();
    const torn = await run(['--apply', '--backup-dir', dir]);
    expect(torn.exitCode).toBe(1);
    expect(torn.summary!.items_failed).toBe(1);
    expect(torn.summary!.totals.rekeyed).toBe(2);
    expect(await idNow(TXN('R1'))).toBe(TXN('R1'));
    expect(await idNow(TXN('R3'))).toBe(TXN('R3'));
    const [file] = csvFiles(dir);
    const [header, ...data] = parseCsv(readFileSync(path.join(dir, file), 'utf8'));
    expect(data.map((row) => Number(row[header.indexOf('id')])).sort()).toEqual([pk.get(TXN('B1')), pk.get(TXN('C1'))].sort());
  });

  it('RK-13: the UPDATE re-checks the old id, the new id and the tombstones at the moment of the write', async () => {
    const dir = freshDir();
    // Between the plan and the first write: (a) R4 is renamed by something else, (b) a row with R5's
    // new id appears, (c) R6's new id is tombstoned.
    const r = await run(['--apply', '--backup-dir', dir], {
      db: observedDb({
        onFirstConnect: async () => {
          await db.query('UPDATE transactions SET plaid_transaction_id = $2 WHERE id = $1', [pk.get(TXN('R4')), TXN('RACED')]);
          await db.query(
            `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name) VALUES ($1, $2, $3, 1, $4)`,
            [TXN('N5'), ACCT_A1, D(38), NAME('RACER')]
          );
          await db.query('INSERT INTO transaction_tombstones (plaid_transaction_id) VALUES ($1)', [TXN('N6')]);
        },
      }),
    });

    expect(r.exitCode).toBe(0);
    expect(await idNow(TXN('R4'))).toBe(TXN('RACED'));
    expect(await idNow(TXN('R5'))).toBe(TXN('R5'));
    expect(await idNow(TXN('R6'))).toBe(TXN('R6'));
    // The other planned rows were written.
    for (const k of ['R1', 'R2', 'R3', 'R7', 'R9']) expect(await idNow(TXN(k)), k).toBe(TXN(`N${k.slice(1)}`));
    const a = (await itemOf(r.summary!, TOKEN_A)).counts;
    expect(a).toMatchObject({ would_rekey: 8, rekeyed: 5, skipped_at_write: 3 });
    // The CSV, written before the race, already held all three refused rows with their old ids.
    const [header, ...data] = parseCsv(readFileSync(path.join(dir, csvFiles(dir)[0]), 'utf8'));
    const csvIds = new Map(data.map((row) => [Number(row[header.indexOf('id')]), row[header.indexOf('plaid_transaction_id')]]));
    for (const k of ['R4', 'R5', 'R6']) expect(csvIds.get(pk.get(TXN(k))!), k).toBe(TXN(k));
  });

  it('RK-14: apply writes one 0600 CSV of the full pre-update rows, complete before the first UPDATE; a failed backup changes nothing', async () => {
    const dir = freshDir();
    const columns = (await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'transactions' ORDER BY ordinal_position`
    )).rows.map((r) => r.column_name);
    const select = `SELECT ${columns.map((c) => `"${c}"::text AS "${c}"`).join(', ')} FROM transactions WHERE account_id = ANY($1) ORDER BY id`;
    const beforeRows = (await db.query<Record<string, string | null>>(select, [MY_ACCOUNTS])).rows;

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
    expect(atFirstUpdate).toEqual({ files: [expect.stringMatching(/\.csv$/)], rows: 10 });

    const files = csvFiles(dir);
    expect(files).toHaveLength(1);
    const file = path.join(dir, files[0]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(r.summary!.backup).toEqual({ path: file, rows: 10 });
    const [header, ...data] = parseCsv(readFileSync(file, 'utf8'));
    expect(header).toEqual(columns);
    // Each data row is the row exactly as it was: every column, the OLD Plaid id included.
    const byId = new Map(beforeRows.map((row) => [row.id, row]));
    for (const row of data) {
      const record = Object.fromEntries(columns.map((c, i) => [c, row[i]]));
      expect(record).toEqual(byId.get(record.id!));
    }
    // The CSV's rows are exactly the rows whose id changed (no write-time skips in this run).
    const afterRows = (await db.query<Record<string, string | null>>(select, [MY_ACCOUNTS])).rows;
    const oldIds = new Map(beforeRows.map((row) => [row.id, row.plaid_transaction_id]));
    const changed = afterRows.filter((a) => a.plaid_transaction_id !== oldIds.get(a.id)).map((a) => Number(a.id)).sort();
    expect(data.map((row) => Number(row[header.indexOf('id')])).sort()).toEqual(changed);
    expect(r.summary!.totals.skipped_at_write).toBe(0);
    expect(changed).toEqual([...expectedRekeys().keys()].sort());

    // A backup that does not verify — a write claiming bytes it did not put down, a write making no
    // progress — and a directory that cannot be written: each stops the apply with nothing changed.
    await cleanup();
    await seedCommon();
    const before = await snapshot();
    const liar: ScriptDeps['writeChunk'] = (fd, buf, offset, length) => { writeSync(fd, buf, offset, Math.floor(length / 2)); return length; };
    const stuck: ScriptDeps['writeChunk'] = () => 0;
    for (const writeChunk of [liar, stuck]) {
      const bad = await run(['--apply', '--backup-dir', freshDir()], { writeChunk });
      expect(bad.exitCode).toBe(1);
      expect(bad.summary!.totals.rekeyed).toBe(0);
      expect(bad.summary!.backup).toBeNull();
      expect(bad.err.join('\n')).toContain('nothing was changed');
      expect(await snapshot()).toEqual(before);
    }
    const locked = freshDir();
    chmodSync(locked, 0o500);
    const denied = await run(['--apply', '--backup-dir', locked]);
    chmodSync(locked, 0o700);
    expect(denied.exitCode).toBe(1);
    expect(denied.summary!.totals.rekeyed).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it('RK-15: the default directory is $HOME/b8-backfill-backups, created 0700; in-repo and backups paths are refused first', async () => {
    expect(defaultBackupDir({ HOME: '/fixture-home' })).toBe('/fixture-home/b8-backfill-backups');
    expect(parseArgs(['--apply'], { HOME: '/fixture-home' }).backupDir).toBe('/fixture-home/b8-backfill-backups');

    // Inside the work tree, inside apps/backups, inside any backups directory, and through a symlink
    // into the work tree — each refused before the database or Plaid is touched, nothing created.
    const link = path.join(freshDir(), 'link-into-repo');
    symlinkSync(path.join(REPO_ROOT, 'apps', 'web'), link);
    const refused = [
      path.join(REPO_ROOT, 'apps', 'web', 'p40e-should-not-exist'),
      path.join(REPO_ROOT, 'apps', 'backups', 'p40e-should-not-exist'),
      path.join(freshDir(), 'backups', 'p40e'),
      path.join(link, 'p40e-should-not-exist'),
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

    // A dry run with the default directory creates nothing; an apply creates it owner-only.
    const home = freshDir();
    await run([], {}, { HOME: home });
    expect(existsSync(path.join(home, 'b8-backfill-backups'))).toBe(false);
    const r = await run(['--apply'], {}, { HOME: home });
    expect(r.summary!.backup!.path.startsWith(path.join(home, 'b8-backfill-backups') + path.sep)).toBe(true);
    expect(statSync(path.join(home, 'b8-backfill-backups')).mode & 0o777).toBe(0o700);
  });

  it('RK-16: a second apply re-keys nothing, writes no CSV and changes nothing; the re-keyed rows are then present', async () => {
    const dir = freshDir();
    const first = await run(['--apply', '--backup-dir', dir]);
    expect(first.summary!.totals.rekeyed).toBe(10);
    const afterFirst = await snapshot();
    const filesAfterFirst = csvFiles(dir);

    const second = await run(['--apply', '--backup-dir', dir]);
    expect(second.exitCode).toBe(0);
    expect(second.summary!.totals.rekeyed).toBe(0);
    expect(second.summary!.totals.would_rekey).toBe(0);
    expect(second.summary!.backup).toBeNull();
    expect(csvFiles(dir)).toEqual(filesAfterFirst);
    expect(await snapshot()).toEqual(afterFirst);

    const dry = await run(['--backup-dir', dir]);
    expect(dry.summary!.totals.would_rekey).toBe(0);
    expect((await itemOf(dry.summary!, TOKEN_A)).counts.not_orphaned).toBe(4 + 8);
  });

  it('RK-17: stdout, stderr and the summary carry counts, ordinals, the backup path and an error code only', async () => {
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

    // The real writers: what reaches the console is what is checked. Item B rejects with a valid
    // code, its message and the secret in the error; then with a code that is not Plaid's shape.
    fake.failures.set(TOKEN_B, () => plaidError('ITEM_LOGIN_REQUIRED'));
    const dir = freshDir();
    const dry = await main(['--backup-dir', dir]);
    const applied = await main(['--apply', '--backup-dir', dir]);
    fake.failures.set(TOKEN_B, () => plaidError('not a code 42'));
    const odd = await main(['--backup-dir', dir]);
    vi.restoreAllMocks();

    expect(applied.summary!.totals.rekeyed).toBe(9);
    const backupPath = applied.summary!.backup!.path;
    // The backup path is allowed output and its timestamp can hold any digits, so it is taken out
    // before the digit-pattern checks below rather than letting them flake on a millisecond.
    const everything = [...lines, ...raw, JSON.stringify([dry.summary, applied.summary, odd.summary])].join('\n')
      .split(backupPath).join('<path>');
    expect(everything).not.toContain(P);
    // The csv_/manual_ ids carry the sentinel too; the bare prefixes cannot be checked, because the
    // bucket name `excluded_csv_manual` is itself output.
    expect(everything).not.toContain('0.97');
    expect(everything).not.toContain('097');
    expect(everything).not.toContain('webox');
    expect(everything).not.toContain('WEBOX');
    expect(everything).not.toMatch(/2026-0\d-/);
    expect(everything).not.toContain('not a code');
    expect(lines.join('\n')).toContain('code=ITEM_LOGIN_REQUIRED');
    expect(lines.join('\n')).toContain('code=UNKNOWN');

    // Every digit in the output is a count (`key=N`) or an ordinal (`item N of M`), once the backup
    // path — which may carry digits from the temp directory — is taken out.
    const residue = lines.join('\n')
      .split(backupPath).join('<path>')
      .replace(/\b[a-z_]+=\d+\b/g, '')
      .replace(/\bitem \d+ of \d+\b/g, '');
    expect(residue).not.toMatch(/\d/);
    const numbers: unknown[] = [];
    JSON.stringify([dry.summary, applied.summary, odd.summary], (_k, v) => { if (typeof v === 'number') numbers.push(v); return v; });
    for (const n of numbers) expect(Number.isInteger(n)).toBe(true);
  });

  it('RK-18: the stored cursor is never sent and no accounts column changes; a walk that cannot end fails its item', async () => {
    const before = await snapshot();
    await run(['--backup-dir', freshDir()]);
    expect((await snapshot()).accounts).toEqual(before.accounts);
    await run(['--apply', '--backup-dir', freshDir()]);
    expect((await snapshot()).accounts).toEqual(before.accounts);

    const stored = [TOKEN_A, TOKEN_B, TOKEN_C].map(CURSOR);
    for (const req of fake.requests) expect(stored).not.toContain(req.cursor);
    for (const token of [TOKEN_A, TOKEN_B, TOKEN_C]) {
      const mine = fake.requests.filter((q) => q.access_token === token);
      expect(mine.length).toBeGreaterThan(0);
      expect(mine[0].cursor).toBeUndefined();
      for (const q of mine) expect(q.cursor === undefined || q.cursor.startsWith(`next-${token}-`)).toBe(true);
    }

    // A: page 2 says `has_more` and hands back the cursor that fetched it. C: an empty next cursor.
    await cleanup();
    await seedCommon();
    const seeded = await snapshot();
    const pagesA = historyA();
    (pagesA[1] as { next_cursor: string }).next_cursor = `next-${TOKEN_A}-1`;
    fake.histories.set(TOKEN_A, pagesA);
    fake.histories.set(TOKEN_C, [page({ added: [st(TXN('NC1'), ACCT_C1, D(41), 1, NAME('C1'))], next: '', hasMore: true })]);
    const r = await run(['--apply', '--backup-dir', freshDir()]);
    expect(r.exitCode).toBe(1);
    expect(await itemOf(r.summary!, TOKEN_A)).toMatchObject({ failed: true, errorCode: 'CURSOR_NOT_ADVANCING' });
    expect(await itemOf(r.summary!, TOKEN_C)).toMatchObject({ failed: true, errorCode: 'CURSOR_NOT_ADVANCING' });
    expect(fake.requests.filter((q) => q.access_token === TOKEN_A)).toHaveLength(2);
    // A history that never ends is cut off at the page cap.
    fake.requests.length = 0;
    fake.endless.add(TOKEN_A);
    const r2 = await run(['--apply', '--backup-dir', freshDir()]);
    expect(await itemOf(r2.summary!, TOKEN_A)).toMatchObject({ failed: true, errorCode: 'PAGE_LIMIT_EXCEEDED' });
    expect(fake.requests.filter((q) => q.access_token === TOKEN_A)).toHaveLength(MAX_PAGES_PER_ITEM);
    // Only item B was whole, and its one re-key is the only change.
    const after = await snapshot();
    expect(after.accounts).toEqual(seeded.accounts);
    expect(after.tombstones).toEqual(seeded.tombstones);
    expect(await idNow(TXN('B1'))).toBe(TXN('NB1'));
    expect(await idNow(TXN('R1'))).toBe(TXN('R1'));
  });

  it('RK-19: never inserts or deletes; every item’s counts add up; the dry run predicts the apply; flags are strict', async () => {
    const count = async () => (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM transactions')).rows[0].n;
    const before = await count();
    const tombs = (await snapshot()).tombstones;
    const dry = await run(['--backup-dir', freshDir()]);
    const applied = await run(['--apply', '--backup-dir', freshDir()]);

    expect(await count()).toBe(before);
    expect((await snapshot()).tombstones).toEqual(tombs);
    // Unmatched statements were not inserted; ids `removed` named were not deleted.
    for (const k of ['NM1', 'NK1', 'NAMB2', 'NUNK', 'NT']) expect(await isStored(TXN(k)), k).toBe(false);
    for (const k of ['REMONLY', 'ADDREM']) expect(await idNow(TXN(k)), k).toBe(TXN(k));

    for (const summary of [dry.summary!, applied.summary!]) {
      for (const { counts: c } of summary.items) {
        expect(c.stored_rows).toBe(c.excluded_csv_manual + c.stored_tombstoned + c.not_orphaned + c.orphans);
        expect(c.orphans).toBe(c.no_match + c.excluded_new_id_stored + c.excluded_new_id_tombstoned + c.ambiguous + c.would_rekey);
        expect(c.plaid_returned).toBe(c.plaid_removed + c.unknown_account + c.pending + c.posted);
      }
    }
    for (const item of applied.summary!.items) {
      const predicted = dry.summary!.items.find((i) => i.ordinal === item.ordinal)!;
      expect(item.counts.rekeyed + item.counts.skipped_at_write).toBe(predicted.counts.would_rekey);
    }
    expect(dryPart((await itemOf(dry.summary!, TOKEN_A)).counts)).toEqual(A_DRY);

    // No flag is a dry run, `--apply` writes, anything else is refused before any access.
    expect(parseArgs([], { HOME: '/fixture-home' }).apply).toBe(false);
    expect(parseArgs(['--apply'], { HOME: '/fixture-home' }).apply).toBe(true);
    for (const bad of [['--aply'], ['--apply', '--force'], ['apply'], ['--backup-dir']]) {
      expect(() => parseArgs(bad, { HOME: '/fixture-home' })).toThrow(UsageError);
      const { deps, touched, captured } = countingDeps();
      const r = await main(bad, { HOME: '/fixture-home' }, deps);
      expect(r.exitCode).toBe(2);
      expect(touched).toEqual({ db: 0, fetch: 0 });
      expect(captured.err.join('\n')).toContain('usage:');
      expect(captured.err.join('\n')).toContain('--apply');
    }
    // Importing the module started nothing.
    expect(requestsAtImport).toBe(0);
    expect(isEntryPoint()).toBe(false);
    expect(isEntryPoint(['node', '/somewhere/apps/web/scripts/rekey-plaid-ids.ts'])).toBe(true);
  });

  it('RK-20: every count is present and numeric, including for an empty history and an item with no stored rows', async () => {
    const shapeOk = (c: RekeyCounts) => {
      expect(Object.keys(c).sort()).toEqual([...COUNT_KEYS].sort());
      for (const k of COUNT_KEYS) {
        expect(typeof c[k], k).toBe('number');
        expect(Number.isInteger(c[k]) && c[k] >= 0, k).toBe(true);
      }
    };
    for (const argv of [['--backup-dir', freshDir()], ['--apply', '--backup-dir', freshDir()]]) {
      const r = await run(argv);
      for (const item of r.summary!.items) shapeOk(item.counts);
      shapeOk(r.summary!.totals);
    }

    // D: Plaid returns nothing and nothing is stored. E: Plaid returns posted rows, none stored.
    await cleanup();
    fake.histories.clear();
    const TOKEN_D = `${P}-TOKEN-D`;
    const TOKEN_E = `${P}-TOKEN-E`;
    await seedAccount(ACCT_D1, TOKEN_D);
    await seedAccount(ACCT_E1, TOKEN_E);
    fake.histories.set(TOKEN_D, [page({ next: `next-${TOKEN_D}-1`, hasMore: false })]);
    fake.histories.set(TOKEN_E, [page({ added: [st(TXN('E1'), ACCT_E1, D(42), 1, NAME('E1')), st(TXN('E2'), ACCT_E1, D(43), 1, NAME('E2'))], next: `next-${TOKEN_E}-1`, hasMore: false })]);
    const zero = Object.fromEntries(COUNT_KEYS.map((k) => [k, 0]));
    const dir = freshDir();
    for (const argv of [['--backup-dir', dir], ['--apply', '--backup-dir', dir]]) {
      const r = await run(argv);
      expect(r.exitCode).toBe(0);
      expect(r.summary!.backup).toBeNull();
      expect((await itemOf(r.summary!, TOKEN_D)).counts).toEqual(zero);
      expect((await itemOf(r.summary!, TOKEN_E)).counts).toEqual({ ...zero, plaid_returned: 2, posted: 2, plaid_not_stored: 2 });
      shapeOk(r.summary!.totals);
    }
    expect(csvFiles(dir)).toEqual([]);
  });

  it('RK-21: after the re-key, 40c’s real backfill enriches the re-keyed rows and no longer counts them not_local', async () => {
    const backfill = async (apply: boolean): Promise<BackfillSummary> =>
      runBackfill({ apply, backupDir: freshDir() }, { ...backfillDeps, out: () => {}, err: () => {} });
    const ordinalA = await ordinalOf(TOKEN_A);
    const countsA = (s: BackfillSummary) => s.items.find((i) => i.ordinal === ordinalA)!.counts;

    const before = countsA(await backfill(false));
    const r = await run(['--apply', '--backup-dir', freshDir()]);
    expect((await itemOf(r.summary!, TOKEN_A)).counts.rekeyed).toBe(8);
    const between = countsA(await backfill(false));
    expect(before.not_local - between.not_local).toBe(8);
    expect(between.would_update - before.would_update).toBe(8);

    await backfill(true);
    const raw = async (seeded: string) =>
      (await db.query<{ enriched: boolean }>('SELECT plaid_raw IS NOT NULL AS enriched FROM transactions WHERE id = $1', [pk.get(seeded)])).rows[0].enriched;
    for (const s of SEEDS.filter((x) => x.rekeyTo)) expect(await raw(s.plaidId), s.plaidId).toBe(true);
    // Rows not re-keyed stay un-enriched: no 40c match by id exists for them.
    for (const k of [TXN('M1'), TXN('AMB1'), TXN('CA'), CSV_1, TXN('ST1'), TXN('TOMBO')]) expect(await raw(k), k).toBe(false);
  });

  it('RK-22: a later sync delivering the new id as modified updates the re-keyed row in place, owner columns intact', async () => {
    await run(['--apply', '--backup-dir', freshDir()]);
    const owner = async () => (await db.query(
      `SELECT id, hidden, note, watched_at::text AS watched_at, transfer_group_id, property_id, mapped_category, rule_applied
         FROM transactions WHERE id = $1`, [pk.get(TXN('R1'))]
    )).rows[0];
    const ownerBefore = await owner();
    const countA = async () => (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM transactions WHERE account_id = ANY($1)', [[ACCT_A1, ACCT_A2]])).rows[0].n;
    const rowsBefore = await countA();

    // The real sync sends item A's stored cursor and is handed a delta: N1 modified.
    fake.deltas.set(`${TOKEN_A}|${CURSOR(TOKEN_A)}`, page({
      modified: [st(TXN('N1'), ACCT_A1, D(1), 2, '  webox ', { merchant_name: `${P}-MERCHANT-REVISED` })],
      next: `${P}-AFTER-DELTA`, hasMore: false,
    }));
    const result = await runSync({ accountId: ACCT_A1 });
    expect(result.errors).toEqual([]);
    expect(fake.requests.filter((q) => q.access_token === TOKEN_A).at(-1)!.cursor).toBe(CURSOR(TOKEN_A));

    expect(await countA()).toBe(rowsBefore);
    const row = await db.query<{ id: number; merchant_name: string; enriched: boolean }>(
      'SELECT id, merchant_name, plaid_raw IS NOT NULL AS enriched FROM transactions WHERE plaid_transaction_id = $1', [TXN('N1')]
    );
    expect(row.rows).toEqual([{ id: pk.get(TXN('R1')), merchant_name: `${P}-MERCHANT-REVISED`, enriched: true }]);
    expect(await owner()).toEqual(ownerBefore);
  });
});
