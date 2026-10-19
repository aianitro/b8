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
import { visibleTransactions, type GiftViewer } from './giftReadPath';
import {
  assignCandidates,
  stateAfterClaim,
  sweepDecision,
  type CandidateRow,
  type GiftCriteria,
  type ValidGiftRequest,
} from './domain/giftMatch';
import type { Gift, GiftCandidate, GiftState } from '@b8/contracts/gifts';

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
            COALESCE(NULLIF(t.merchant_name, ''), NULLIF(t.name, ''), 'Unnamed') AS label
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
