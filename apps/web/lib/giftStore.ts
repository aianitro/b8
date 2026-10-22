// Gifts (P7-41b) — every statement against `gifts`, `gift_transactions` and `gift_settings`, and
// the writes a gift makes to the rows it holds. The decisions are `lib/domain/giftMatch.ts`'s; this
// file reads facts, asks those functions, and performs what they decided.
//
// ─── THE GIVER IS THE ONLY READER OF A GIFT ───────────────────────────────────────────────────
//
// Every read here is scoped `WHERE g.giver_user_id = $viewer`. A gift belonging to someone else is
// therefore not "forbidden" but ABSENT: the same `null` a nonexistent id produces, so a route built
// on these functions answers both the same way and a non-giver cannot learn that a record exists
// (SPEC.md "Existence is not visible"). The candidate rows a gift holds are read through
// `visibleTransactions(giver)`, the read path every surface uses — for the giver, that is the real
// row, and nothing here reads ledger text around it.
//
// ─── HOLDING AND RELEASING A ROW ──────────────────────────────────────────────────────────────
//
// A link row exists only while its gift holds the transaction (CONTRACT.md). Holding a row files it
// in the gift category with `rule_applied = FALSE`, after recording what it held before. Releasing
// one — a rejected candidate, a cancel, an expiry at the reveal date — puts back EXACTLY what was
// recorded and deletes the link, in one statement per gift, inside the transaction that also moves
// the gift's state. A release that restored the category but left the link would keep the row
// masked in its old category; one that dropped the link first would unmask it in the gift category.
//
// ─── LOGS CARRY COUNTS ────────────────────────────────────────────────────────────────────────
//
// No log line in this file names a merchant, an amount, a criterion or a row. A gift's criteria are
// the secret; a server log is a place the other person could read it.

import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import db from './db';
import { createLogger } from './logger';
import { sendWebPush } from './webPush';
import { giftLinkedSql, visibleTransactions, type GiftViewer } from './giftReadPath';
import {
  GIFT_ATTACH_LIST_CAP,
  GIFT_ATTACH_LOOKBACK_DAYS,
  acceptsAttach,
  assignCandidates,
  attachFloor,
  isAttachCandidate,
  stateAfterClaim,
  sweepDecision,
  type AttachRow,
  type CandidateRow,
  type GiftCriteria,
  type ValidGiftRequest,
} from './domain/giftMatch';
import type { Gift, GiftCandidate, GiftCandidateList, GiftState } from '@b8/contracts/gifts';

const log = createLogger('gifts');

/** Anything that runs a query: the pool, or one client inside a transaction. */
export type Queryable = {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
};

/** A store outcome a route turns into a response. Codes are the contract's. */
export type GiftFailure =
  | { ok: false; code: 'NOT_FOUND' }
  | { ok: false; code: 'INVALID_INPUT'; message: string }
  | { ok: false; code: 'NO_RECIPIENT' }
  | { ok: false; code: 'GIFT_CATEGORY_UNSET' }
  | { ok: false; code: 'ALREADY_RESOLVED' };

export type GiftResult = { ok: true; gift: Gift } | GiftFailure;

// ─── Reading ────────────────────────────────────────────────────────────────────────────────────

interface GiftRow {
  id: number;
  recipient_user_id: number;
  recipient_display_name: string;
  amount: string | null;
  merchant: string | null;
  account_id: string | null;
  account_name: string | null;
  window_start: string;
  window_end: string;
  reveal_date: string;
  state: GiftState;
  revealed: boolean;
  notice_at: string | null;
  created_at: string;
}

/**
 * Timestamps as ISO text, produced by Postgres. A `TIMESTAMPTZ` would otherwise reach this module
 * as a JS `Date` and need converting here — and a gift module converting dates in JS is exactly
 * what the wiring tests forbid, because that is where a zone slips in.
 */
const ISO = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const GIFT_SELECT = `
  SELECT g.id, g.recipient_user_id, u.display_name AS recipient_display_name,
         g.amount::text AS amount, g.merchant, g.account_id, a.name AS account_name,
         g.window_start::text AS window_start, g.window_end::text AS window_end,
         g.reveal_date::text AS reveal_date, g.state,
         -- Postgres's calendar, in the statement that reads the gift: the page never compares a
         -- reveal date against a clock of its own.
         (g.reveal_date <= CURRENT_DATE) AS revealed,
         ${ISO('g.notice_at')} AS notice_at, ${ISO('g.created_at')} AS created_at
    FROM gifts g
    JOIN users u ON u.id = g.recipient_user_id
    LEFT JOIN accounts a ON a.id = g.account_id`;

/**
 * A candidate row's label as the giver sees it: the merchant, else the raw name, else `Unnamed`.
 * One expression for the rows a gift holds and the rows it could attach (P7-41c), so the two lists
 * can never label the same row two ways. Read over `visibleTransactions(giver)` only.
 */
const CANDIDATE_LABEL = "COALESCE(NULLIF(t.merchant_name, ''), NULLIF(t.name, ''), 'Unnamed')";

/** The rows each of `giftIds` holds, real, as their giver sees them. Ordered by transaction id. */
async function candidatesOf(q: Queryable, giver: number, giftIds: number[]): Promise<Map<number, GiftCandidate[]>> {
  const out = new Map<number, GiftCandidate[]>();
  if (giftIds.length === 0) return out;
  const { rows } = await q.query<{
    gift_id: number; transaction_id: number; date: string; amount: string;
    account_id: string; account_name: string; label: string;
  }>(
    `SELECT gt.gift_id, t.id AS transaction_id, t.date::text AS date, t.amount::text AS amount,
            t.account_id, a.name AS account_name,
            ${CANDIDATE_LABEL} AS label
       FROM gift_transactions gt
       JOIN ${visibleTransactions(giver)} t ON t.id = gt.transaction_id
       JOIN accounts a ON a.id = t.account_id
      WHERE gt.gift_id = ANY($1::int[])
      ORDER BY gt.transaction_id`,
    [giftIds],
  );
  for (const r of rows) {
    const list = out.get(r.gift_id) ?? [];
    list.push({
      transactionId: r.transaction_id,
      date: r.date,
      amount: r.amount,
      accountId: r.account_id,
      accountName: r.account_name,
      label: r.label,
    });
    out.set(r.gift_id, list);
  }
  return out;
}

function toGift(r: GiftRow, candidates: GiftCandidate[]): Gift {
  return {
    id: r.id,
    recipientUserId: r.recipient_user_id,
    recipientDisplayName: r.recipient_display_name,
    amount: r.amount,
    merchant: r.merchant,
    accountId: r.account_id,
    accountName: r.account_id === null ? null : r.account_name,
    windowStart: r.window_start,
    windowEnd: r.window_end,
    revealDate: r.reveal_date,
    state: r.state,
    revealed: r.revealed,
    noticeAt: r.notice_at,
    createdAt: r.created_at,
    candidates,
  };
}

/** The viewer's own gifts as giver, newest first. `[]` for everyone who has marked none. */
export async function listGifts(viewer: GiftViewer, q: Queryable = db): Promise<Gift[]> {
  if (viewer === null) return [];
  const { rows } = await q.query<GiftRow>(
    `${GIFT_SELECT} WHERE g.giver_user_id = $1 ORDER BY g.created_at DESC, g.id DESC`,
    [viewer],
  );
  const candidates = await candidatesOf(q, viewer, rows.map((r) => r.id));
  return rows.map((r) => toGift(r, candidates.get(r.id) ?? []));
}

/** One gift, if `viewer` is its giver; otherwise null — exactly as for an id that does not exist. */
export async function getGift(viewer: GiftViewer, id: number, q: Queryable = db): Promise<Gift | null> {
  if (viewer === null || !Number.isSafeInteger(id)) return null;
  const { rows } = await q.query<GiftRow>(`${GIFT_SELECT} WHERE g.giver_user_id = $1 AND g.id = $2`, [viewer, id]);
  if (rows.length === 0) return null;
  const candidates = await candidatesOf(q, viewer, [id]);
  return toGift(rows[0], candidates.get(id) ?? []);
}

// ─── Creating ───────────────────────────────────────────────────────────────────────────────────

/**
 * Store a validated gift for `giver`.
 *
 * The checks only the database can make, in the order a refusal should report them: a gift
 * category must be designated (a match would otherwise have nowhere to be filed); there must be a
 * live recipient who is not the giver — the one other live user when none is named, and a refusal
 * when there are several and none was named; and a named account must be one the Plaid sync
 * handles, since a gift on a hand-kept account could never match.
 */
export async function createGift(giver: number, req: ValidGiftRequest): Promise<GiftResult> {
  const designated = await db.query<{ category_id: number | null }>(
    `SELECT gs.category_id
       FROM gift_settings gs
       JOIN budget_categories bc ON bc.id = gs.category_id`,
  );
  if (designated.rows.length === 0) return { ok: false, code: 'GIFT_CATEGORY_UNSET' };

  let recipient = req.recipientUserId;
  if (recipient === null) {
    const others = await db.query<{ id: number }>(
      'SELECT id FROM users WHERE revoked_at IS NULL AND id <> $1 ORDER BY id',
      [giver],
    );
    if (others.rows.length === 0) return { ok: false, code: 'NO_RECIPIENT' };
    if (others.rows.length > 1) {
      return { ok: false, code: 'INVALID_INPUT', message: 'Choose who the gift is for.' };
    }
    recipient = others.rows[0].id;
  } else {
    const named = await db.query('SELECT 1 FROM users WHERE id = $1 AND revoked_at IS NULL', [recipient]);
    if (named.rows.length === 0) {
      return { ok: false, code: 'INVALID_INPUT', message: 'That person cannot receive a gift.' };
    }
  }

  if (req.accountId !== null) {
    const account = await db.query('SELECT 1 FROM accounts WHERE id = $1 AND access_token IS NOT NULL', [req.accountId]);
    if (account.rows.length === 0) {
      return { ok: false, code: 'INVALID_INPUT', message: 'A gift can only watch an account the bank sync updates.' };
    }
  }

  const inserted = await db.query<{ id: number }>(
    `INSERT INTO gifts (giver_user_id, recipient_user_id, amount, merchant, account_id,
                        window_start, window_end, reveal_date)
     VALUES ($1, $2, $3::numeric, $4, $5, $6::date, $7::date, $8::date)
     RETURNING id`,
    [giver, recipient, req.amount, req.merchant, req.accountId, req.windowStart, req.windowEnd, req.revealDate],
  );
  log.info('gift created', { count: 1 });
  const gift = await getGift(giver, inserted.rows[0].id);
  return gift ? { ok: true, gift } : { ok: false, code: 'NOT_FOUND' };
}

// ─── Releasing ──────────────────────────────────────────────────────────────────────────────────

/**
 * Put back what each held row had before its gift took it, and unlink it — for every row `giftId`
 * holds except `keep`. One UPDATE and one DELETE, on the caller's transaction.
 */
async function release(q: Queryable, giftId: number, keep: number | null): Promise<number> {
  const restored = await q.query(
    `UPDATE transactions t
        SET mapped_category = gt.prior_mapped_category,
            rule_applied = gt.prior_rule_applied
       FROM gift_transactions gt
      WHERE gt.gift_id = $1 AND gt.transaction_id = t.id
        AND ($2::int IS NULL OR gt.transaction_id <> $2::int)`,
    [giftId, keep],
  );
  await q.query(
    'DELETE FROM gift_transactions WHERE gift_id = $1 AND ($2::int IS NULL OR transaction_id <> $2::int)',
    [giftId, keep],
  );
  return restored.rowCount ?? 0;
}

/** Run `work` in one transaction on one client, with the gift row locked by the caller's SELECT. */
async function inTransaction<T>(work: (q: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** The gift `viewer` gives, locked for this transaction, or null. */
async function lockOwn(q: Queryable, viewer: number, id: number): Promise<{ state: GiftState } | null> {
  const { rows } = await q.query<{ state: GiftState }>(
    'SELECT state FROM gifts WHERE id = $1 AND giver_user_id = $2 FOR UPDATE',
    [id, viewer],
  );
  return rows[0] ?? null;
}

/**
 * The giver picks which candidate is the gift. The chosen row stays held; every other candidate is
 * restored to exactly what it was and released, which unmasks it for the recipient at once. One
 * transaction, so no reader can see the loser restored but the gift not yet matched, or the reverse.
 */
export async function chooseGift(viewer: GiftViewer, id: number, transactionId: number): Promise<GiftResult> {
  if (viewer === null || !Number.isSafeInteger(id)) return { ok: false, code: 'NOT_FOUND' };
  const outcome = await inTransaction(async (q): Promise<GiftFailure | null> => {
    const gift = await lockOwn(q, viewer, id);
    if (!gift) return { ok: false, code: 'NOT_FOUND' };
    if (gift.state !== 'choose') return { ok: false, code: 'ALREADY_RESOLVED' };
    const held = await q.query('SELECT 1 FROM gift_transactions WHERE gift_id = $1 AND transaction_id = $2', [id, transactionId]);
    if (held.rows.length === 0) {
      return { ok: false, code: 'INVALID_INPUT', message: 'That transaction is not one of this gift\'s candidates.' };
    }
    const released = await release(q, id, transactionId);
    await q.query(`UPDATE gifts SET state = 'matched' WHERE id = $1`, [id]);
    log.info('gift chosen', { released });
    return null;
  });
  if (outcome) return outcome;
  const gift = await getGift(viewer, id);
  return gift ? { ok: true, gift } : { ok: false, code: 'NOT_FOUND' };
}

/**
 * The giver cancels. Every held row is restored and released — the only way to unmask a row before
 * its reveal date, and a deliberate act of the giver's. A second cancel answers ALREADY_RESOLVED.
 */
export async function cancelGift(viewer: GiftViewer, id: number): Promise<GiftResult> {
  if (viewer === null || !Number.isSafeInteger(id)) return { ok: false, code: 'NOT_FOUND' };
  const outcome = await inTransaction(async (q): Promise<GiftFailure | null> => {
    const gift = await lockOwn(q, viewer, id);
    if (!gift) return { ok: false, code: 'NOT_FOUND' };
    if (gift.state === 'cancelled') return { ok: false, code: 'ALREADY_RESOLVED' };
    const released = await release(q, id, null);
    await q.query(`UPDATE gifts SET state = 'cancelled' WHERE id = $1`, [id]);
    log.info('gift cancelled', { released });
    return null;
  });
  if (outcome) return outcome;
  const gift = await getGift(viewer, id);
  return gift ? { ok: true, gift } : { ok: false, code: 'NOT_FOUND' };
}

// ─── Matching, inside the sync's transaction ───────────────────────────────────────────────────

/**
 * Link what this sync pass first inserted to the gifts waiting for it, ON THE SYNC'S OWN CLIENT,
 * before the sync commits — so no reader, digest, suggestion or notification can observe one of
 * these rows unlinked (SPEC.md S2). `fresh` are the rows the pass inserted, read by the sync itself.
 *
 * In order:
 *   1. A gift left holding nothing — its row removed by Plaid this pass, the link gone with it by
 *      cascade — returns to `awaiting`, so a replacement the same pass inserted can claim it.
 *   2. The open gifts are read and locked, oldest first; the pure `assignCandidates` decides which
 *      rows each claims (one row, one gift, the older gift wins).
 *   3. Each claimed row records what it held, is filed in the gift category with `rule_applied`
 *      FALSE, and is linked; each gift's state moves as `stateAfterClaim` says.
 *
 * The gift category is read by id at this moment, so a rename since the gift was made is followed.
 * With no category designated (deleted since), rows are still linked and masked, left where they
 * are, and one count is logged.
 *
 * Returns how many rows were linked.
 */
export async function linkFreshRows(
  q: Queryable,
  fresh: readonly (CandidateRow & { mapped_category: string | null; rule_applied: boolean })[],
): Promise<number> {
  // ONLY WHILE THE GIFT IS STILL A SECRET (G3 cycle 1, N2). Once revealed, a matched gift is a
  // finished fact: its row may be deleted by the owner or removed by Plaid, and the cascade then
  // leaves it holding nothing. Reopening it here would let the sweep expire it as `unmatched` and
  // push the giver a false "nothing matched", and could re-file a late row into the gift category.
  // A revealed matched gift therefore stays `matched` with no link. Postgres's calendar decides, in
  // this statement, as it does for the mask.
  await q.query(
    `UPDATE gifts g SET state = 'awaiting'
      WHERE g.state IN ('matched', 'choose')
        AND g.reveal_date > CURRENT_DATE
        AND NOT EXISTS (SELECT 1 FROM gift_transactions gt WHERE gt.gift_id = g.id)`,
  );
  if (fresh.length === 0) return 0;

  // `created_at <= NOW()`: NOW() is this transaction's start, so a gift created while the sync was
  // already running is not offered rows the sync had inserted before it existed (no retroactive
  // gifts), even though READ COMMITTED would let this statement see it.
  //
  // `reveal_date > CURRENT_DATE` (P7-41b NITS N7, closed in P7-41c): a gift whose reveal date has
  // come is no longer a secret, even while it still says `awaiting` because the daily sweep has not
  // run yet. Offering it a row here would file a late purchase into the gift category on the very
  // day it should be expiring, and attach already refuses the same gift (`acceptsAttach`), so the
  // two ways a row joins a gift agree on "revealed means closed". Postgres's calendar, in this
  // statement, as for the mask.
  const { rows: open } = await q.query<{
    id: number; created_at: string; state: GiftState; amount: string | null; merchant: string | null;
    account_id: string | null; window_start: string; window_end: string; held: number;
  }>(
    `SELECT g.id, to_char(g.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS created_at,
            g.state, g.amount::text AS amount, g.merchant, g.account_id,
            g.window_start::text AS window_start, g.window_end::text AS window_end,
            (SELECT COUNT(*) FROM gift_transactions gt WHERE gt.gift_id = g.id)::int AS held
       FROM gifts g
      WHERE g.state IN ('awaiting', 'choose') AND g.created_at <= NOW()
        AND g.reveal_date > CURRENT_DATE
      ORDER BY g.created_at, g.id
        FOR UPDATE`,
  );
  if (open.length === 0) return 0;

  const criteria: GiftCriteria[] = open.map((g) => ({
    id: g.id, createdAt: g.created_at, state: g.state, amount: g.amount, merchant: g.merchant,
    accountId: g.account_id, windowStart: g.window_start, windowEnd: g.window_end,
  }));
  const claims = assignCandidates(criteria, fresh);
  if (claims.size === 0) return 0;

  const category = await q.query<{ name: string }>(
    `SELECT bc.name FROM gift_settings gs JOIN budget_categories bc ON bc.id = gs.category_id`,
  );
  const giftCategory = category.rows[0]?.name ?? null;
  const byId = new Map(fresh.map((r) => [r.id, r]));

  let linked = 0;
  for (const gift of open) {
    const ids = claims.get(gift.id);
    if (!ids) continue;
    for (const transactionId of ids) {
      const row = byId.get(transactionId);
      if (!row) continue;
      await q.query(
        `INSERT INTO gift_transactions (transaction_id, gift_id, prior_mapped_category, prior_rule_applied)
         VALUES ($1, $2, $3, $4)`,
        [transactionId, gift.id, row.mapped_category, row.rule_applied],
      );
      if (giftCategory !== null) {
        await q.query(
          'UPDATE transactions SET mapped_category = $1, rule_applied = FALSE WHERE id = $2',
          [giftCategory, transactionId],
        );
      } else {
        await q.query('UPDATE transactions SET rule_applied = FALSE WHERE id = $1', [transactionId]);
      }
      linked++;
    }
    await q.query('UPDATE gifts SET state = $2 WHERE id = $1', [gift.id, stateAfterClaim(gift.state, gift.held, ids.length)]);
  }
  if (giftCategory === null) {
    log.warn('gift category not designated; held rows left in their category', { count: linked });
  }
  return linked;
}

// ─── Attaching a row already in the ledger (P7-41c) ────────────────────────────────────────────

/**
 * The one refusal for "this row cannot be attached", whatever the reason: no such row, linked to
 * any gift, a `manual_`/`csv_` row, not money out, half of a transfer, before the candidate floor,
 * or failing the amount, merchant or account criterion. Fixed text with no row detail and no
 * criterion, so the body never tells the giver why — and a malformed request body answers it too.
 */
export const ATTACH_REFUSED_MESSAGE = 'That transaction cannot be attached to this gift.';

const attachRefused = (): GiftFailure => ({ ok: false, code: 'INVALID_INPUT', message: ATTACH_REFUSED_MESSAGE });

export type GiftCandidatesResult = { ok: true; candidates: GiftCandidateList } | GiftFailure;

/** A gift as attaching reads it: its criteria, its dates as text, and Postgres's today. */
interface AttachGiftRow {
  id: number;
  /** Fixed-width UTC text, as `GiftCriteria.createdAt` wants it. */
  created_at: string;
  /** The creation date on Postgres's calendar — the one `CURRENT_DATE` reads. */
  created_date: string;
  state: GiftState;
  amount: string | null;
  merchant: string | null;
  account_id: string | null;
  window_start: string;
  window_end: string;
  reveal_date: string;
  today: string;
}

/**
 * `today` and the creation date come from the same statement as the gift, so eligibility and the
 * candidate floor are Postgres's calendar and never a JS clock (SPEC.md "Time").
 */
const ATTACH_GIFT_SELECT = `
  SELECT g.id, to_char(g.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS created_at,
         (g.created_at::date)::text AS created_date,
         g.state, g.amount::text AS amount, g.merchant, g.account_id,
         g.window_start::text AS window_start, g.window_end::text AS window_end,
         g.reveal_date::text AS reveal_date, CURRENT_DATE::text AS today
    FROM gifts g
   WHERE g.id = $1 AND g.giver_user_id = $2`;

/** The viewer's own gift, or null — exactly as for an id that does not exist. Locked on request. */
async function attachGift(q: Queryable, viewer: number, id: number, lock: boolean): Promise<AttachGiftRow | null> {
  const { rows } = await q.query<AttachGiftRow>(`${ATTACH_GIFT_SELECT}${lock ? ' FOR UPDATE' : ''}`, [id, viewer]);
  return rows[0] ?? null;
}

const criteriaOf = (g: AttachGiftRow): GiftCriteria => ({
  id: g.id, createdAt: g.created_at, state: g.state, amount: g.amount, merchant: g.merchant,
  accountId: g.account_id, windowStart: g.window_start, windowEnd: g.window_end,
});

/** A ledger row as the attach decision and the candidate list read it. */
interface AttachRowRecord {
  id: number;
  /** NULL only when the row is masked for this viewer — held by a gift they do not give. */
  plaid_transaction_id: string | null;
  account_id: string;
  account_name: string;
  date: string;
  authorized_date: string | null;
  amount: string;
  name: string | null;
  merchant_name: string | null;
  label: string;
  mapped_category: string | null;
  rule_applied: boolean;
  linked: boolean;
  in_transfer_group: boolean;
}

/**
 * Rows as `viewer` sees them, through the read path like every other reader of a row's text. The
 * filter is the caller's, and carries no criterion: whether a row qualifies is decided by
 * `isAttachCandidate` below, never restated in SQL, so the list and the attach cannot drift from
 * the matcher (SPEC.md "No second definition").
 */
async function attachRows(q: Queryable, viewer: number, where: string, values: unknown[]): Promise<AttachRowRecord[]> {
  const { rows } = await q.query<AttachRowRecord>(
    `SELECT t.id, t.plaid_transaction_id, t.account_id, a.name AS account_name,
            t.date::text AS date, t.authorized_date::text AS authorized_date, t.amount::text AS amount,
            t.name, t.merchant_name, ${CANDIDATE_LABEL} AS label, t.mapped_category, t.rule_applied,
            ${giftLinkedSql('t')} AS linked,
            (t.transfer_group_id IS NOT NULL) AS in_transfer_group
       FROM ${visibleTransactions(viewer)} t
       JOIN accounts a ON a.id = t.account_id
      WHERE ${where}
      ORDER BY t.date DESC, t.id DESC`,
    values,
  );
  return rows;
}

/**
 * Whether `r` may be attached to `gift`: posted on or after the floor, and `isAttachCandidate`.
 * A row masked for this viewer (no Plaid id in their projection) is held by someone else's gift
 * and fails closed here even before the `linked` conjunct refuses it.
 */
function attachable(gift: GiftCriteria, floor: string, r: AttachRowRecord): boolean {
  if (r.plaid_transaction_id === null || r.date < floor) return false;
  const row: AttachRow = {
    id: r.id, plaidTransactionId: r.plaid_transaction_id, accountId: r.account_id, date: r.date,
    authorizedDate: r.authorized_date, amount: r.amount, name: r.name, merchantName: r.merchant_name,
    // The ledger has no pending column: the sync never stores a pending row.
    pending: false, linked: r.linked, inTransferGroup: r.in_transfer_group,
  };
  return isAttachCandidate(gift, row);
}

/** Whether `viewer` gives gift `id`. The question both new routes answer first, before any body. */
export async function ownsGift(viewer: GiftViewer, id: number): Promise<boolean> {
  if (viewer === null || !Number.isSafeInteger(id)) return false;
  return (await attachGift(db, viewer, id, false)) !== null;
}

/**
 * `GET /api/v1/gifts/[id]/candidates` — the unlinked rows the giver could attach to their gift,
 * newest first, at most `GIFT_ATTACH_LIST_CAP`.
 *
 * Someone else's gift is NOT_FOUND, as for every gift read. The giver's own closed gift (resolved,
 * or its reveal date come) is ALREADY_RESOLVED, never `[]`: an empty list would read as "nothing
 * fits", which is false for a gift that can no longer take a row (SPEC.md Open question 5).
 *
 * The cap is applied after `isAttachCandidate`, not as a SQL LIMIT, because the criteria are the
 * matcher's and are evaluated here: a LIMIT before them would cut the list at fifty rows of any
 * kind and could drop every qualifying one. The rows read are bounded by the floor.
 */
export async function listAttachCandidates(viewer: GiftViewer, id: number, q: Queryable = db): Promise<GiftCandidatesResult> {
  if (viewer === null || !Number.isSafeInteger(id)) return { ok: false, code: 'NOT_FOUND' };
  const gift = await attachGift(q, viewer, id, false);
  if (!gift) return { ok: false, code: 'NOT_FOUND' };
  if (!acceptsAttach(gift.state, gift.reveal_date, gift.today)) return { ok: false, code: 'ALREADY_RESOLVED' };
  const floor = attachFloor(gift.created_date, GIFT_ATTACH_LOOKBACK_DAYS);
  const criteria = criteriaOf(gift);
  const rows = await attachRows(q, viewer, 't.date >= $1::date', [floor]);
  const candidates = rows
    .filter((r) => attachable(criteria, floor, r))
    .slice(0, GIFT_ATTACH_LIST_CAP)
    .map((r): GiftCandidate => ({
      transactionId: r.id, date: r.date, amount: r.amount, accountId: r.account_id,
      accountName: r.account_name, label: r.label,
    }));
  log.info('gift candidates listed', { count: candidates.length });
  return { ok: true, candidates };
}

/**
 * `POST /api/v1/gifts/[id]/attach` — the giver names a row already in the ledger as this gift, and
 * it is linked exactly as `linkFreshRows` would have linked it: the row's own category and rule flag
 * recorded, the row filed in the gift category with `rule_applied` FALSE, the gift moved by
 * `stateAfterClaim` (`awaiting` to `matched`; `choose` stays `choose` holding one more). From the
 * commit on, the row is masked for every non-giver — masking is keyed on the link, so no surface
 * needs to know how the link was made.
 *
 * `transactionId` is null when the request body did not parse; the gift is still looked up first,
 * so a non-giver's malformed body is the 404 a missing gift is, never a 400.
 *
 * ─── LOCK ORDER: THE ROW, THEN THE GIFT ───────────────────────────────────────────────────────
 *
 * `linkFreshRows` holds its rows (it inserted or updated them) before it locks gifts, so attach
 * takes the row first too. `chooseGift`, `cancelGift` and the sweep go the other way — the gift,
 * then the rows it HOLDS — which cannot meet attach's order because of the second step below: with
 * the row locked, attach asks whether it is linked to any gift, and if it is, refuses without ever
 * asking for a gift lock. A row attach holds while waiting for a gift is therefore unlinked, and
 * stays unlinked while attach holds it (every other linker would need the same row lock, and the
 * sync links only rows it has just inserted), so no gift-first transaction ever waits for it.
 *
 * Everything that decides is read AFTER both locks, from committed data: the gift's state and
 * reveal date with Postgres's today, and the row's amount, account, merchant, link and transfer
 * group. A row deleted, revised or attached elsewhere while attach waited is refused with the one
 * 400; a gift matched by the sync meanwhile is the 409. The primary key on
 * `gift_transactions.transaction_id` is the last word on "one link per row", and losing that race
 * is the same 400, never a 500.
 */
export async function attachToGift(viewer: GiftViewer, id: number, transactionId: number | null): Promise<GiftResult> {
  if (viewer === null || !Number.isSafeInteger(id)) return { ok: false, code: 'NOT_FOUND' };
  if (!(await ownsGift(viewer, id))) return { ok: false, code: 'NOT_FOUND' };
  if (transactionId === null || !Number.isSafeInteger(transactionId) || transactionId <= 0) return attachRefused();

  let outcome: GiftFailure | null;
  try {
    outcome = await inTransaction(async (q): Promise<GiftFailure | null> => {
      // 1. The row, locked; `id` only — its text is read through the read path in step 3.
      const locked = await q.query('SELECT id FROM transactions WHERE id = $1 FOR UPDATE', [transactionId]);
      const linked = locked.rows.length > 0 && (await q.query<{ linked: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM gift_transactions WHERE transaction_id = $1) AS linked',
        [transactionId],
      )).rows[0].linked;
      if (locked.rows.length === 0 || linked) {
        // Refused without a gift lock (see LOCK ORDER). A closed gift still answers as closed, so
        // the giver hears the same thing whichever row they named.
        const gift = await attachGift(q, viewer, id, false);
        if (!gift) return { ok: false, code: 'NOT_FOUND' };
        return acceptsAttach(gift.state, gift.reveal_date, gift.today) ? attachRefused() : { ok: false, code: 'ALREADY_RESOLVED' };
      }

      // 2. The gift, locked, and whether it can still take a row — Postgres's today, this statement.
      const gift = await attachGift(q, viewer, id, true);
      if (!gift) return { ok: false, code: 'NOT_FOUND' };
      if (!acceptsAttach(gift.state, gift.reveal_date, gift.today)) return { ok: false, code: 'ALREADY_RESOLVED' };

      // 3. The row as it is now, under both locks, against the matcher's own rule.
      const floor = attachFloor(gift.created_date, GIFT_ATTACH_LOOKBACK_DAYS);
      const [row] = await attachRows(q, viewer, 't.id = $1', [transactionId]);
      if (!row || !attachable(criteriaOf(gift), floor, row)) return attachRefused();

      // 4. Linked as `linkFreshRows` links: the same three writes, in the same order. Written out
      // here rather than shared because `linkFreshRows` is the sync's and this task changes it in
      // one respect only (N7); the integration suite pins the two to the same outcome (C1).
      const held = await q.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM gift_transactions WHERE gift_id = $1', [id]);
      const category = await q.query<{ name: string }>(
        `SELECT bc.name FROM gift_settings gs JOIN budget_categories bc ON bc.id = gs.category_id`,
      );
      const giftCategory = category.rows[0]?.name ?? null;
      await q.query(
        `INSERT INTO gift_transactions (transaction_id, gift_id, prior_mapped_category, prior_rule_applied)
         VALUES ($1, $2, $3, $4)`,
        [transactionId, id, row.mapped_category, row.rule_applied],
      );
      if (giftCategory !== null) {
        await q.query(
          'UPDATE transactions SET mapped_category = $1, rule_applied = FALSE WHERE id = $2',
          [giftCategory, transactionId],
        );
      } else {
        await q.query('UPDATE transactions SET rule_applied = FALSE WHERE id = $1', [transactionId]);
        log.warn('gift category not designated; held rows left in their category', { count: 1 });
      }
      await q.query('UPDATE gifts SET state = $2 WHERE id = $1', [id, stateAfterClaim(gift.state, held.rows[0].n, 1)]);
      log.info('gift attached', { count: 1 });
      return null;
    });
  } catch (err) {
    // A second link to the same row: the primary key refused it. The race is lost, not broken.
    if ((err as { code?: string }).code === '23505') return attachRefused();
    throw err;
  }
  if (outcome) return outcome;
  const gift = await getGift(viewer, id);
  return gift ? { ok: true, gift } : { ok: false, code: 'NOT_FOUND' };
}

// ─── The daily sweep ────────────────────────────────────────────────────────────────────────────

/**
 * Tell givers what is due, once, and expire what reached its reveal date unresolved. Rides
 * `runDailyJob`; no timer of its own.
 *
 * `today` is Postgres's `CURRENT_DATE`, read in the statement that locks the gifts, and every
 * decision is `sweepDecision`'s. The notice is the gift's `notice_at`, set once and never again —
 * which is what makes a second run add nothing — and the only push is the app's existing
 * content-free ping, to the GIVER's own subscriptions. Resolves always: a sweep failure must not
 * cost the daily job anything after it.
 */
export async function runGiftSweep(): Promise<{ told: number; expired: number }> {
  try {
    const result = await inTransaction(async (q) => {
      const { rows } = await q.query<{
        id: number; giver_user_id: number; state: GiftState; window_end: string;
        reveal_date: string; notice_at: string | null; today: string;
      }>(
        `SELECT id, giver_user_id, state, window_end::text AS window_end, reveal_date::text AS reveal_date,
                notice_at::text AS notice_at, CURRENT_DATE::text AS today
           FROM gifts
          WHERE state IN ('awaiting', 'choose')
          ORDER BY id
            FOR UPDATE`,
      );
      const tell = new Set<number>();
      let expired = 0;
      for (const g of rows) {
        const decision = sweepDecision(
          { state: g.state, windowEnd: g.window_end, revealDate: g.reveal_date, noticeAt: g.notice_at },
          g.today,
        );
        if (decision === 'expire') {
          await release(q, g.id, null);
          await q.query(
            `UPDATE gifts SET state = 'unmatched', notice_at = COALESCE(notice_at, NOW()) WHERE id = $1`,
            [g.id],
          );
          expired++;
          if (g.notice_at === null) tell.add(g.giver_user_id);
        } else if (decision === 'notice') {
          await q.query(
            `UPDATE gifts
                SET notice_at = NOW(),
                    state = CASE WHEN state = 'awaiting' THEN 'unmatched' ELSE state END
              WHERE id = $1`,
            [g.id],
          );
          tell.add(g.giver_user_id);
        }
      }
      return { tell: [...tell], expired };
    });
    for (const giver of result.tell) await sendWebPush('normal', giver);
    log.info('gift sweep', { told: result.tell.length, expired: result.expired });
    return { told: result.tell.length, expired: result.expired };
  } catch (err) {
    log.error('gift sweep failed', { error: err instanceof Error ? err.message : String(err) });
    return { told: 0, expired: 0 };
  }
}
