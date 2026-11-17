// Receipts photographed before their charge exists (`receipt_captures`), and the watch for the
// charge. The matching rules are in `lib/domain/receiptMatch.ts`; this is the I/O around them.
//
// PERSONAL. Every read and every action is scoped to `captured_by = viewer`: a capture is one
// person's claim about what they will be charged, its alert is theirs, and the push goes to their
// devices only. A capture that is not the viewer's answers exactly as one that does not exist.
//
// THROUGH THE READ PATH. A charge's name and merchant are read from `visibleTransactions(viewer)`
// and a row masked for the capturer — a gift someone else is giving them — is never a candidate, so
// the watch cannot link a receipt to a gift and an alert cannot describe one. The same predicate is
// the note lock (`giftLockSql(…, 'note', …)`) that every copy into `transaction_receipts` repeats.

import db from './db';
import { createLogger } from './logger';
import { visibleTransactions } from './giftReadPath';
import { giftLockSql } from './giftLock';
import type { GiftViewer } from './domain/giftMask';
import { sendWebPush } from './webPush';
import {
  judgeReceipt, verdictForLink, WINDOW_AFTER_DAYS, WINDOW_BEFORE_DAYS, type ChargeCandidate, type ReceiptReading,
} from './domain/receiptMatch';
import type { ReceiptType } from './receipt';

const log = createLogger('receiptWatch');

export type CaptureState = 'draft' | 'waiting' | 'matched' | 'mismatch' | 'overdue' | 'closed';

export interface CaptureView {
  id: number;
  state: CaptureState;
  /** `YYYY-MM-DD`, the meal's day on the phone's calendar. */
  capturedOn: string;
  merchant: string | null;
  /** What the model read as the total; null when nothing could be read. */
  readTotal: number | null;
  /** What the owner confirmed. Null only on a draft. */
  expected: number | null;
  /** The linked charge's posted amount. */
  charged: number | null;
  /** The linked charge, as this viewer may see it. Null before a link, or after the charge was deleted. */
  transaction: { id: number; date: string; title: string } | null;
}

/** What a new photo answers with: the draft, and the reading broken down for the confirm form. */
export interface NewCapture {
  capture: CaptureView;
  reading: ReceiptReading;
  /** The charge to propose: the total read, or the parts added up. Null when nothing was read. */
  proposed: number | null;
}

/** A charge the owner can pick by hand. */
export interface CandidateView {
  id: number;
  date: string;
  amount: number;
  title: string;
  account: string;
}

interface CaptureRow {
  id: number; state: CaptureState; captured_on: string; merchant: string | null;
  read_total: string | null; expected_amount: string | null; charged_amount: string | null;
  t_id: number | null; t_date: string | null; t_title: string | null;
}

const num = (v: string | null) => (v === null ? null : Number(v));

function view(r: CaptureRow): CaptureView {
  return {
    id: r.id,
    state: r.state,
    capturedOn: r.captured_on,
    merchant: r.merchant,
    readTotal: num(r.read_total),
    expected: num(r.expected_amount),
    charged: num(r.charged_amount),
    transaction: r.t_id === null ? null : { id: r.t_id, date: r.t_date!, title: r.t_title ?? 'Transaction' },
  };
}

function selectCaptures(viewer: GiftViewer, where: string): string {
  return `SELECT c.id, c.state, c.captured_on::text, c.merchant, c.read_total::text, c.expected_amount::text,
                 c.charged_amount::text, t.id AS t_id, t.date::text AS t_date,
                 COALESCE(NULLIF(t.merchant_name, ''), t.name) AS t_title
            FROM receipt_captures c
            LEFT JOIN ${visibleTransactions(viewer)} t ON t.id = c.transaction_id
           WHERE c.captured_by = $1 AND ${where}`;
}

/**
 * The viewer's captures: everything still open, then the last few settled ones. Open first, alerts
 * leading, because those are the ones asking for something.
 */
export async function listCaptures(viewer: GiftViewer): Promise<CaptureView[]> {
  if (viewer === null) return [];
  const { rows } = await db.query<CaptureRow>(
    `(${selectCaptures(viewer, `c.state IN ('draft', 'waiting', 'mismatch', 'overdue')`)}
      ORDER BY CASE c.state WHEN 'mismatch' THEN 0 WHEN 'overdue' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END, c.captured_at DESC)
     UNION ALL
     (${selectCaptures(viewer, `c.state IN ('matched', 'closed') AND c.state_at > NOW() - INTERVAL '30 days'`)}
      ORDER BY c.state_at DESC LIMIT 20)`,
    [viewer]
  );
  return rows.map(view);
}

/** The viewer's open alerts, for the dashboard's bell. */
export async function loadReceiptAlerts(viewer: GiftViewer): Promise<CaptureView[]> {
  if (viewer === null) return [];
  const { rows } = await db.query<CaptureRow>(
    `${selectCaptures(viewer, `c.state IN ('mismatch', 'overdue')`)} ORDER BY c.state_at DESC`,
    [viewer]
  );
  return rows.map(view);
}

export async function getCapture(viewer: GiftViewer, id: number): Promise<CaptureView | null> {
  if (viewer === null) return null;
  const { rows } = await db.query<CaptureRow>(selectCaptures(viewer, 'c.id = $2'), [viewer, id]);
  return rows[0] ? view(rows[0]) : null;
}

export async function captureImage(viewer: GiftViewer, id: number): Promise<{ type: string; image: Buffer } | null> {
  if (viewer === null) return null;
  const { rows } = await db.query<{ content_type: string; image: Buffer }>(
    'SELECT content_type, image FROM receipt_captures WHERE id = $1 AND captured_by = $2',
    [id, viewer]
  );
  return rows[0] ? { type: rows[0].content_type, image: rows[0].image } : null;
}

/** A new draft: the photo, the meal's day, and what the model read (if anything). */
export async function createCapture(input: {
  viewer: number; image: Uint8Array; type: ReceiptType; capturedOn: string;
  merchant: string | null; readTotal: number | null;
}): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO receipt_captures (captured_by, captured_on, content_type, image, merchant, read_total)
     VALUES ($1, $2::date, $3, $4, $5, $6) RETURNING id`,
    [input.viewer, input.capturedOn, input.type, Buffer.from(input.image), input.merchant, input.readTotal]
  );
  return rows[0].id;
}

/** Which state an action may start from. */
type Outcome = { ok: true } | { ok: false; status: 404 | 409; message: string };
const NOT_FOUND: Outcome = { ok: false, status: 404, message: 'No such receipt.' };
const conflict = (message: string): Outcome => ({ ok: false, status: 409, message });

async function stateOf(viewer: number, id: number): Promise<CaptureState | null> {
  const { rows } = await db.query<{ state: CaptureState }>(
    'SELECT state FROM receipt_captures WHERE id = $1 AND captured_by = $2', [id, viewer]);
  return rows[0]?.state ?? null;
}

/**
 * Confirm (or correct) what to wait for, and start waiting. Allowed on a draft and on a capture
 * still waiting — correcting the amount before the charge arrives. The watch runs straight after,
 * so a charge that posted before the owner got round to confirming is found now, not at next sync.
 */
export async function confirmCapture(viewer: number, id: number, input: { merchant: string | null; expected: number; capturedOn: string }): Promise<Outcome> {
  const { rowCount } = await db.query(
    `UPDATE receipt_captures
        SET merchant = $3, expected_amount = $4, captured_on = $5::date, state = 'waiting', state_at = NOW()
      WHERE id = $1 AND captured_by = $2 AND state IN ('draft', 'waiting')`,
    [id, viewer, input.merchant, input.expected, input.capturedOn]
  );
  if (rowCount === 0) return (await stateOf(viewer, id)) === null ? NOT_FOUND : conflict('This receipt is no longer waiting.');
  await watchReceipts({ captureId: id, push: false });
  return { ok: true };
}

/**
 * "Yes, that is the charge" on a mismatch: the difference is noted, the alert closes, and the photo
 * goes onto the transaction like a matched one's.
 */
export async function acknowledgeCapture(viewer: number, id: number): Promise<Outcome> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ transaction_id: number | null }>(
      `UPDATE receipt_captures SET state = 'closed', state_at = NOW()
        WHERE id = $1 AND captured_by = $2 AND state = 'mismatch' RETURNING transaction_id`,
      [id, viewer]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return (await stateOf(viewer, id)) === null ? NOT_FOUND : conflict('There is no difference to accept on this receipt.');
    }
    if (rows[0].transaction_id !== null) await attachPhoto(client, id, rows[0].transaction_id, viewer);
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * "Not this charge" on a mismatch: unlink it, never offer it again, and go back to waiting — then
 * look again at once, since the right charge may already be there.
 */
export async function rejectLink(viewer: number, id: number): Promise<Outcome> {
  const { rowCount } = await db.query(
    `UPDATE receipt_captures
        SET rejected_ids = array_append(rejected_ids, transaction_id),
            transaction_id = NULL, charged_amount = NULL, state = 'waiting', state_at = NOW()
      WHERE id = $1 AND captured_by = $2 AND state = 'mismatch' AND transaction_id IS NOT NULL`,
    [id, viewer]
  );
  if (rowCount === 0) return (await stateOf(viewer, id)) === null ? NOT_FOUND : conflict('This receipt is not linked to a charge to reject.');
  await watchReceipts({ captureId: id, push: false });
  return { ok: true };
}

/** Stop watching: paid in cash, never charged, or simply not wanted. Allowed on waiting and overdue. */
export async function dismissCapture(viewer: number, id: number): Promise<Outcome> {
  const { rowCount } = await db.query(
    `UPDATE receipt_captures SET state = 'closed', state_at = NOW()
      WHERE id = $1 AND captured_by = $2 AND state IN ('waiting', 'overdue')`,
    [id, viewer]
  );
  if (rowCount === 0) return (await stateOf(viewer, id)) === null ? NOT_FOUND : conflict('This receipt is not being watched.');
  return { ok: true };
}

/** Throw the capture away, whatever its state. A photo already copied onto a transaction stays there. */
export async function deleteCapture(viewer: number, id: number): Promise<Outcome> {
  const { rowCount } = await db.query('DELETE FROM receipt_captures WHERE id = $1 AND captured_by = $2', [id, viewer]);
  return rowCount === 0 ? NOT_FOUND : { ok: true };
}

/** The charges near a capture's day, for picking one by hand: a wider window than the watch's. */
export async function candidatesFor(viewer: number, id: number): Promise<CandidateView[] | null> {
  const own = await db.query<{ captured_on: string }>(
    'SELECT captured_on::text FROM receipt_captures WHERE id = $1 AND captured_by = $2', [id, viewer]);
  if (own.rows.length === 0) return null;
  const { rows } = await db.query<{ id: number; date: string; amount: string; title: string | null; account: string }>(
    `SELECT t.id, t.date::text, t.amount::text, COALESCE(NULLIF(t.merchant_name, ''), t.name) AS title, a.name AS account
       FROM ${visibleTransactions(viewer)} t JOIN accounts a ON a.id = t.account_id
      WHERE NOT t.gift_masked AND NOT t.hidden AND t.amount > 0
        AND t.date BETWEEN $1::date - 3 AND $1::date + 14
        AND NOT EXISTS (SELECT 1 FROM receipt_captures rc WHERE rc.transaction_id = t.id)
      ORDER BY abs(t.date - $1::date), t.id
      LIMIT 60`,
    [own.rows[0].captured_on]
  );
  return rows.map((r) => ({ id: r.id, date: r.date, amount: Number(r.amount), title: r.title ?? 'Transaction', account: r.account }));
}

/**
 * Link a charge the owner picked by hand — from a capture that is waiting or overdue. Judged by the
 * same exact-cents rule as the watch: equal is matched and the photo is attached; different is a
 * mismatch, whose alert the owner then accepts or rejects like any other.
 */
export async function linkByHand(viewer: number, id: number, transactionId: number): Promise<Outcome> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const cap = await client.query<{ expected_amount: string }>(
      `SELECT expected_amount::text FROM receipt_captures
        WHERE id = $1 AND captured_by = $2 AND state IN ('waiting', 'overdue') FOR UPDATE`,
      [id, viewer]
    );
    if (cap.rows.length === 0) {
      await client.query('ROLLBACK');
      return (await stateOf(viewer, id)) === null ? NOT_FOUND : conflict('This receipt is not waiting for a charge.');
    }
    const charge = await client.query<{ amount: string }>(
      `SELECT t.amount::text FROM ${visibleTransactions(viewer)} t
        WHERE t.id = $1 AND NOT t.gift_masked
          AND NOT EXISTS (SELECT 1 FROM receipt_captures rc WHERE rc.transaction_id = t.id)`,
      [transactionId]
    );
    if (charge.rows.length === 0) {
      await client.query('ROLLBACK');
      return conflict('That charge cannot be linked to this receipt.');
    }
    const charged = Number(charge.rows[0].amount);
    const verdict = verdictForLink(Number(cap.rows[0].expected_amount), charged);
    await client.query(
      `UPDATE receipt_captures SET transaction_id = $2, charged_amount = $3, state = $4, state_at = NOW() WHERE id = $1`,
      [id, transactionId, charged, verdict]
    );
    if (verdict === 'matched') await attachPhoto(client, id, transactionId, viewer);
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    if ((err as { code?: string }).code === '23505') return conflict('That charge is already linked to another receipt.');
    throw err;
  } finally {
    client.release();
  }
}

type Queryable = { query: typeof db.query };

/**
 * The capture's photo onto the transaction, unless the transaction already has one — a receipt the
 * owner attached by hand is theirs and is not replaced — or a gift locks the row for this person.
 */
async function attachPhoto(q: Queryable, captureId: number, transactionId: number, viewer: number): Promise<void> {
  await q.query(
    `INSERT INTO transaction_receipts (transaction_id, content_type, image)
     SELECT t.id, c.content_type, c.image
       FROM receipt_captures c JOIN transactions t ON t.id = $2
      WHERE c.id = $1 AND NOT ${giftLockSql('t', 'note', viewer)}
     ON CONFLICT (transaction_id) DO NOTHING`,
    [captureId, transactionId]
  );
}

/**
 * THE WATCH. For every capture still waiting (or the one named): find its charge among the posted
 * rows in its window, link it, and judge it. Then mark the ones that have waited too long. Each
 * person whose captures opened an alert in this pass gets one push — the app's constant ping, no
 * merchant and no figure, the rule for every push this app sends (`lib/domain/pushPing.ts`).
 *
 * Runs after every sync (the Sync button's and the daily job's) and after the owner confirms or
 * rejects. Resolves always: nothing about a sync may fail because a receipt could not be matched.
 */
export async function watchReceipts(options: { captureId?: number; push?: boolean } = {}): Promise<{ matched: number; mismatched: number; overdue: number }> {
  const tally = { matched: 0, mismatched: 0, overdue: 0 };
  const alerted = new Set<number>();
  try {
    const waiting = await db.query<{ id: number; captured_by: number; captured_on: string; merchant: string | null; expected_amount: string; rejected_ids: number[] }>(
      `SELECT id, captured_by, captured_on::text, merchant, expected_amount::text, rejected_ids
         FROM receipt_captures WHERE state = 'waiting' AND ($1::int IS NULL OR id = $1)
        ORDER BY captured_at`,
      [options.captureId ?? null]
    );

    for (const c of waiting.rows) {
      // AS THE CAPTURER. A row masked for them is invisible here (its text is the label `Gift`, and
      // it is dropped), so the watch cannot link their receipt to a gift someone is giving them.
      const charges = await db.query<{ id: number; date: string; amount: string; merchant_name: string | null; name: string | null }>(
        `SELECT t.id, t.date::text, t.amount::text, t.merchant_name, t.name
           FROM ${visibleTransactions(c.captured_by)} t
          WHERE NOT t.gift_masked AND NOT t.hidden AND t.amount > 0 AND t.transfer_group_id IS NULL
            AND t.date BETWEEN $1::date - ${WINDOW_BEFORE_DAYS} AND $1::date + ${WINDOW_AFTER_DAYS}
            AND NOT EXISTS (SELECT 1 FROM receipt_captures rc WHERE rc.transaction_id = t.id)`,
        [c.captured_on]
      );
      const candidates: ChargeCandidate[] = charges.rows.map((r) => ({
        id: r.id, date: r.date, amount: Number(r.amount), merchantName: r.merchant_name, name: r.name,
      }));
      const verdict = judgeReceipt({
        id: c.id, capturedOn: c.captured_on, expected: Number(c.expected_amount), merchant: c.merchant, rejectedIds: c.rejected_ids,
      }, candidates);
      if (verdict.kind === 'none') continue;

      const client = await db.connect();
      try {
        await client.query('BEGIN');
        // `state = 'waiting'` again: an owner who dismissed it a moment ago wins.
        const linked = await client.query(
          `UPDATE receipt_captures SET transaction_id = $2, charged_amount = $3, state = $4, state_at = NOW()
            WHERE id = $1 AND state = 'waiting'`,
          [c.id, verdict.transactionId, verdict.charged, verdict.kind]
        );
        if (linked.rowCount === 1 && verdict.kind === 'matched') await attachPhoto(client, c.id, verdict.transactionId, c.captured_by);
        await client.query('COMMIT');
        if (linked.rowCount === 1) {
          if (verdict.kind === 'matched') tally.matched += 1;
          else { tally.mismatched += 1; alerted.add(c.captured_by); }
        }
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        // Another capture claimed this charge in a concurrent run: leave this one waiting.
        if ((err as { code?: string }).code !== '23505') throw err;
      } finally {
        client.release();
      }
    }

    // Seven days after the meal with nothing found. Postgres's calendar, as the rows are dated by it.
    const overdue = await db.query<{ captured_by: number }>(
      `UPDATE receipt_captures SET state = 'overdue', state_at = NOW()
        WHERE state = 'waiting' AND CURRENT_DATE - captured_on > ${WINDOW_AFTER_DAYS} AND ($1::int IS NULL OR id = $1)
        RETURNING captured_by`,
      [options.captureId ?? null]
    );
    tally.overdue = overdue.rowCount ?? 0;
    for (const r of overdue.rows) alerted.add(r.captured_by);

    if (tally.matched + tally.mismatched + tally.overdue > 0) log.info('receipt watch', tally);
    if (options.push !== false) for (const userId of alerted) await sendWebPush('normal', userId);
  } catch (err) {
    log.error('receipt watch failed', { error: err instanceof Error ? err.message : String(err) });
  }
  return tally;
}
