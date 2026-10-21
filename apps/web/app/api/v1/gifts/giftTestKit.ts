// P7-41b fixtures — the world the three gift suites share: people, a gift category, accounts on a
// fake Plaid item, canary rows, and the requests each person makes.
//
// NOT A TEST FILE AND NOT A ROUTE, like `../auth/secondUserTestKit.ts`, whose ceremonies it reuses
// (`bootstrapOwner`, `enrolSecondUser`, `invite`, `register`, `resetAuth`, `cookie`, `bearer`), so
// every person here signed in through the real passkey path.
//
// CANARIES. Every text field of every fabricated Plaid row carries the row's own token — an
// alphanumeric string such as `ZQ41BGIFTA` — in its name, merchant, both Plaid categories, the
// confidence, channel, entity, logo, website, every location field, counterparties and payment
// meta. A leak is then found by searching a response or a log for that token, case-insensitively,
// whatever field it came through. None of the tokens is a real name, merchant or figure.
//
// CLEANUP IS OF THIS SUITE'S OWN ROWS: accounts and Plaid ids prefixed `zq41b`, categories and rules
// prefixed `ZQ41B`, the gift tables (which only these suites write), and the auth tables through
// `resetAuth`, as the auth suites do. The gift category designation is put back to what it was.

import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { runSync } from '@/lib/sync';
import { createPersonalToken } from '@/lib/authSession';
import {
  bootstrapOwner,
  cookie,
  bearer,
  enrolSecondUser,
  invite,
  invitationHeader,
  register,
  resetAuth,
  sessionTokenFrom,
  userIdOf,
  type EnrolledUser,
} from '../auth/secondUserTestKit';
import { createTestAuthenticator } from '@/lib/webauthnTestFixtures';
import { GIFT_ITEM_TOKEN, plaidFake, type FakePage } from './giftFakesTestKit';

export { cookie, bearer, resetAuth, type EnrolledUser };

export const ORIGIN = 'http://localhost:3000';
export const CARD = 'zq41b_card';
export const CARD_TWO = 'zq41b_card_two';
export const MANUAL = 'zq41b_manual';
export const GIFT_CATEGORY = 'ZQ41B Gift Shelf';
export const OTHER_CATEGORY = 'ZQ41B Household';

export interface World {
  owner: EnrolledUser;
  two: EnrolledUser;
  three: EnrolledUser | null;
  categoryId: number;
}

/**
 * The designation found before this suite touched it: absent (`'none'`), or a category id or null.
 * Absent is a real state on the scratch database — `overview/route.test.ts` truncates
 * `budget_categories` CASCADE, which empties `gift_settings` with it — and it is put back as found.
 */
let priorDesignation: { present: false } | { present: true; categoryId: number | null } | undefined;

/** Point the singleton designation at `categoryId` (or NULL), creating its row if it is missing. */
export async function designate(categoryId: number | null): Promise<void> {
  await db.query(
    `INSERT INTO gift_settings (singleton, category_id) VALUES (TRUE, $1)
     ON CONFLICT (singleton) DO UPDATE SET category_id = EXCLUDED.category_id`,
    [categoryId],
  );
}

/** Everything this suite writes outside the auth tables, removed. Safe to call twice. */
export async function clearOwn(): Promise<void> {
  await db.query('TRUNCATE gift_transactions, gifts');
  await db.query(`DELETE FROM agent_proposals WHERE subject_id IN (SELECT id FROM transactions WHERE account_id LIKE 'zq41b%')`);
  await db.query(`DELETE FROM transactions WHERE account_id LIKE 'zq41b%'`);
  await db.query(`DELETE FROM transaction_tombstones WHERE plaid_transaction_id LIKE 'zq41b%'`);
  await db.query(`DELETE FROM category_rules WHERE mapped_category LIKE 'ZQ41B%' OR merchant_name ILIKE 'zq41b%' OR plaid_category ILIKE 'zq41b%'`);
  await db.query(`DELETE FROM account_balances WHERE account_id LIKE 'zq41b%'`);
  await db.query(`DELETE FROM accounts WHERE id LIKE 'zq41b%'`);
  if (priorDesignation !== undefined) {
    if (priorDesignation.present) await designate(priorDesignation.categoryId);
    else await db.query('DELETE FROM gift_settings');
  }
  await db.query(`DELETE FROM budget_categories WHERE name LIKE 'ZQ41B%'`);
}

/** A third person, enrolled through the same invitation ceremony as the second. */
async function enrolThird(ownerToken: string): Promise<EnrolledUser> {
  const code = await invite(ownerToken, 'Test User Three');
  const authenticator = createTestAuthenticator();
  const response = await register(authenticator, invitationHeader(code));
  if (response.status !== 200) throw new Error(`third enrolment refused: ${response.status}`);
  const token = sessionTokenFrom(response) as string;
  const userId = await userIdOf(token);
  if (userId === null) throw new Error('third session resolves to nobody');
  return { authenticator, token, userId };
}

/**
 * A fresh world: the owner, `Test User Two` (and optionally a third person), a designated gift
 * category and an ordinary one, two accounts on the fake Plaid item and one hand-kept account.
 */
export async function buildWorld(options: { third?: boolean } = {}): Promise<World> {
  await clearOwn();
  await resetAuth();
  const owner = await bootstrapOwner();
  const two = await enrolSecondUser(owner.token);
  const three = options.third ? await enrolThird(owner.token) : null;

  const cat = await db.query<{ id: number }>(
    `INSERT INTO budget_categories (name, annual_budget, landscape) VALUES ($1, 0, 'operational'), ($2, 0, 'operational')
     RETURNING id`,
    [GIFT_CATEGORY, OTHER_CATEGORY],
  );
  const designation = await db.query<{ category_id: number | null }>('SELECT category_id FROM gift_settings');
  if (priorDesignation === undefined) {
    priorDesignation = designation.rows.length === 0
      ? { present: false }
      : { present: true, categoryId: designation.rows[0].category_id };
  }
  await designate(cat.rows[0].id);

  await db.query(
    `INSERT INTO accounts (id, name, type, access_token, cursor) VALUES
       ($1, 'ZQ41B Fabricated Card', 'credit', $4, 'zq41b-cursor-0'),
       ($2, 'ZQ41B Fabricated Card Two', 'credit', $4, 'zq41b-cursor-0'),
       ($3, 'ZQ41B Fabricated Wallet', 'depository', NULL, NULL)`,
    [CARD, CARD_TWO, MANUAL, GIFT_ITEM_TOKEN],
  );
  return { owner, two, three, categoryId: cat.rows[0].id };
}

export async function teardownWorld(): Promise<void> {
  await clearOwn();
  await resetAuth();
  priorDesignation = undefined;
}

/** A read-only personal token for `user`, as a script would hold one. */
export async function readToken(user: EnrolledUser): Promise<string> {
  return (await createPersonalToken({ label: 'zq41b read', scope: 'read', userId: user.userId })).token;
}

// ─── Plaid rows ────────────────────────────────────────────────────────────────────────────────

export interface RowSpec {
  /** The canary, e.g. `ZQ41BGIFTA`; becomes the Plaid id (`zq41b-…`) and every text field. */
  canary: string;
  amount: number;
  date: string;
  /** Plaid's purchase date; defaults to `date`. `null` is a row Plaid gives no authorized date. */
  authorizedDate?: string | null;
  account?: string;
  pending?: boolean;
  /** Overrides, for the merchant-matching shapes. */
  merchant?: string | null;
  name?: string | null;
  plaidCategory?: string;
  id?: string;
}

/** The Plaid id a spec is delivered under. */
export const plaidIdOf = (spec: RowSpec) => spec.id ?? `zq41b-${spec.canary.toLowerCase()}`;

/** A Plaid `Transaction` with the canary in every text field it has. */
export function plaidTxn(spec: RowSpec): Record<string, unknown> {
  const c = spec.canary;
  return {
    transaction_id: plaidIdOf(spec),
    account_id: spec.account ?? CARD,
    date: spec.date,
    authorized_date: spec.authorizedDate === undefined ? spec.date : spec.authorizedDate,
    amount: spec.amount,
    name: spec.name === undefined ? `${c} POS NAME` : spec.name,
    merchant_name: spec.merchant === undefined ? `${c} Merchant` : spec.merchant,
    pending: spec.pending ?? false,
    payment_channel: `${c}channel`,
    merchant_entity_id: `${c}entity`,
    logo_url: `https://${c.toLowerCase()}.example/logo.png`,
    website: `${c.toLowerCase()}.example`,
    personal_finance_category: {
      primary: spec.plaidCategory ?? `${c}_PRIMARY`,
      detailed: `${c}_DETAILED`,
      confidence_level: `${c}CONF`,
    },
    location: {
      address: `${c} Street`, city: `${c}City`, region: `${c}Region`, postal_code: `${c}Postal`,
      country: `${c}Country`, store_number: `${c}Store`, lat: null, lon: null,
    },
    counterparties: [{ name: `${c} Counterparty`, type: 'merchant', website: `${c.toLowerCase()}cp.example`, logo_url: null }],
    payment_meta: { payment_processor: `${c}Processor`, payment_method: `${c}Method` },
  };
}

export const page = (p: Partial<FakePage>): FakePage => ({
  added: [], modified: [], removed: [], next_cursor: `zq41b-cursor-${Math.random().toString(36).slice(2)}`,
  has_more: false, ...p,
});

/** Queue `pages` for the fake item and run the sync on it, as the Sync button does. */
export async function syncWith(...pages: FakePage[]) {
  plaidFake.pages.push(...pages);
  const result = await runSync({ accountId: CARD });
  if (plaidFake.pages.length !== 0) throw new Error('p41b: the sync did not consume every queued page');
  return result;
}

/** Deliver rows as `added` in one page. */
export const syncAdded = (...specs: RowSpec[]) => syncWith(page({ added: specs.map(plaidTxn) }));

/** The `transactions.id` a Plaid id is stored under, or null. */
export async function rowIdOf(spec: RowSpec | string): Promise<number | null> {
  const id = typeof spec === 'string' ? spec : plaidIdOf(spec);
  const r = await db.query<{ id: number }>('SELECT id FROM transactions WHERE plaid_transaction_id = $1', [id]);
  return r.rows[0]?.id ?? null;
}

/** What a stored row holds that a gift moves: its category, its rule flag, and its link. */
export async function rowState(id: number) {
  const r = await db.query<{ mapped_category: string | null; rule_applied: boolean; gift_id: number | null }>(
    `SELECT t.mapped_category, t.rule_applied, gt.gift_id
       FROM transactions t LEFT JOIN gift_transactions gt ON gt.transaction_id = t.id WHERE t.id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function giftState(id: number) {
  const r = await db.query<{ state: string; notice_at: string | null }>('SELECT state, notice_at::text FROM gifts WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}

// ─── Gifts and requests ────────────────────────────────────────────────────────────────────────

/** A NextRequest as `who` — a cookie for a person, a bearer header for a token, nothing for null. */
export function req(
  path: string,
  who: EnrolledUser | { bearer: string } | null,
  init: { method?: string; body?: unknown } = {},
): NextRequest {
  const auth = who === null ? {} : 'bearer' in who ? bearer(who.bearer) : cookie(who.token);
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? 'GET',
    headers: { host: 'localhost:3000', 'content-type': 'application/json', ...auth },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** A handler's answer, read once: status, parsed body, and the raw text for canary searches. */
export async function read(response: Response) {
  const text = await response.text();
  let body: { success?: boolean; data?: unknown; error?: { code: string; message: string } } = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, body, text };
}

/** Whether `text` holds `canary` in any case. */
export const holds = (text: string, canary: string) => text.toLowerCase().includes(canary.toLowerCase());

/** Insert a gift directly, for fixtures that need a state or a date the route would not make. */
export async function seedGift(g: {
  giver: number; recipient: number; amount?: string | null; merchant?: string | null; account?: string | null;
  windowStart: string; windowEnd: string; revealSql?: string; reveal?: string; createdAt?: string;
}): Promise<number> {
  const reveal = g.revealSql ?? (g.reveal ? `'${g.reveal}'::date` : `'2099-12-31'::date`);
  const r = await db.query<{ id: number }>(
    `INSERT INTO gifts (giver_user_id, recipient_user_id, amount, merchant, account_id, window_start, window_end, reveal_date, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, ${reveal}, COALESCE($8::timestamptz, NOW()))
     RETURNING id`,
    [g.giver, g.recipient, g.amount ?? null, g.merchant ?? null, g.account ?? null, g.windowStart, g.windowEnd, g.createdAt ?? null],
  );
  return r.rows[0].id;
}

/** Today on Postgres's calendar, plus `days`, as `YYYY-MM-DD`. */
export async function pgDay(days = 0): Promise<string> {
  const r = await db.query<{ d: string }>('SELECT (CURRENT_DATE + $1::int)::text AS d', [days]);
  return r.rows[0].d;
}
