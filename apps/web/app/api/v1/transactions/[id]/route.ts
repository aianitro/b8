import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { parseWatchInput } from '@/lib/watchlist';
import type { ApiResponse } from '@b8/contracts/types';
import { createLogger } from '@/lib/logger';
import { transactionDetail, type DetailRow, type TransactionDetail } from '@/lib/transactionDetail';

const log = createLogger('transactions');

/**
 * One transaction for the detail sheet. `plaid_raw` is selected here and goes no further than
 * `transactionDetail`, which picks out named fields; the blob itself never reaches the response.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return Response.json({ success: false, error: { code: 'NOT_FOUND', message: 'No such transaction' } } satisfies ApiResponse<never>, { status: 404 });
  }
  const result = await db.query<DetailRow>(
    `SELECT t.id, t.date::text AS date, t.authorized_date::text AS authorized_date, t.amount,
            t.name, t.merchant_name, t.logo_url, t.website, t.account_id, a.name AS account_name,
            t.mapped_category, t.plaid_category, t.plaid_category_detailed, t.plaid_category_confidence,
            t.payment_channel, t.location_city, t.location_region, t.location_country,
            t.note, t.watched_at, t.hidden, t.plaid_raw
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE t.id = $1`,
    [id]
  );
  if (result.rowCount === 0) {
    return Response.json({ success: false, error: { code: 'NOT_FOUND', message: 'No such transaction' } } satisfies ApiResponse<never>, { status: 404 });
  }
  return Response.json({ success: true, data: transactionDetail(result.rows[0]) } satisfies ApiResponse<TransactionDetail>);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  if ('hidden' in body) {
    await db.query('UPDATE transactions SET hidden = $1 WHERE id = $2', [Boolean(body.hidden), id]);
  } else if ('mapped_category' in body) {
    await db.query(
      'UPDATE transactions SET mapped_category = $1, rule_applied = false WHERE id = $2',
      [body.mapped_category ?? null, id]
    );
  } else if ('watched' in body || 'note' in body) {
    // The rules live in `lib/watchlist.ts` so the unit suite can reach them; this branch is one
    // statement. `watched_at` is set by NOW() rather than by a timestamp the client sends: the
    // digest reports how long an entry has been open, and a clock the caller controls is a clock
    // that can make an entry younger than it is.
    const parsed = parseWatchInput(body);
    if (!parsed.ok) {
      return Response.json(
        { success: false, error: parsed.error } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }
    const { watched, note } = parsed.value;
    await db.query(
      // EACH COLUMN IS TOUCHED ONLY IF ITS KEY WAS SENT. `$1` is null when the caller said nothing
      // about the flag and `$2` is false when it said nothing about the note — absent is not the
      // same as null, and writing `note = $3` unconditionally would wipe a note on every flag
      // toggle. That is precisely the coupling the 2026-09-22 migration removed.
      //
      // COALESCE keeps the ORIGINAL flag time when an already-watched row is flagged again. Written
      // as a bare NOW() this would restart the clock, and an entry that gets touched would silently
      // read as new — which is the one thing that timestamp exists to prevent.
      `UPDATE transactions
          SET watched_at = CASE
                             WHEN $1::boolean IS NULL THEN watched_at
                             WHEN $1::boolean THEN COALESCE(watched_at, NOW())
                             ELSE NULL
                           END,
              note = CASE WHEN $2::boolean THEN $3::text ELSE note END
        WHERE id = $4`,
      [watched ?? null, note !== undefined, note ?? null, id]
    );
  } else if ('property_id' in body) {
    // null clears the tag, restoring inheritance from the account — it does not mean
    // "belongs to no property". See the migration's note on COALESCE resolution order.
    const propertyId = body.property_id === null ? null : Number(body.property_id);
    if (propertyId !== null && !Number.isInteger(propertyId)) {
      return Response.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'property_id must be an integer or null' } } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }
    await db.query('UPDATE transactions SET property_id = $1 WHERE id = $2', [propertyId, id]);
  } else {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'mapped_category, hidden, watched, note, or property_id required' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}

/**
 * Deletes a transaction and tombstones its Plaid id, so the next sync cannot bring it back.
 *
 * ─── WHY A TOMBSTONE AT ALL ───────────────────────────────────────────────────────────────────
 *
 * Plaid has no idea the owner deleted anything. Its next `modified` for this id would reach the
 * sync upsert and insert the row again, and a reset cursor would do the same through `added`. The
 * fact "the owner deleted this" cannot live on the row, because the row is what is being removed;
 * `transaction_tombstones` is where it lives instead, and `lib/sync.ts` refuses every id in it.
 *
 * ─── WHY ONE TRANSACTION, AND WHY THE KEY COMES FROM `RETURNING` ──────────────────────────────
 *
 * Half of this pair is worse than neither. A delete without its tombstone is the bug this exists
 * to fix, only quieter: the row vanishes, the owner sees it gone, and a sync days later restores
 * it. A tombstone without the delete protects a row that is still there. So both statements share
 * one BEGIN/COMMIT, and a failed tombstone write rolls the delete back with it and answers 5xx —
 * the owner sees the delete fail and can retry, rather than seeing it succeed and later undo itself.
 *
 * The key is read from the deleted row's own `RETURNING`, in the same statement that removes it,
 * not looked up beforehand or afterwards. Afterwards the row is gone and the lookup returns
 * nothing; beforehand is a second read that can disagree with what was actually deleted. When no
 * row matched, `RETURNING` is empty and nothing is tombstoned — the response stays the same
 * success it always was, and an id that named no row leaves no tombstone protecting nothing.
 *
 * `ON CONFLICT DO NOTHING`, not `DO UPDATE SET deleted_at = NOW()`. A repeat delete of the same
 * id (in practice a `csv_` row re-created by re-importing its file) must succeed, and the contract
 * defines `deleted_at` as the FIRST time this id was deleted — the owner's decision, not the
 * latest repeat of it.
 *
 * Not conditioned on `hidden`, the id's prefix, or anything else about the row. A `manual_` or
 * `csv_` tombstone is inert (sync never receives those ids), and a prefix test that decided which
 * ids "look like Plaid's" is a test that one day misreads a real Plaid id. Transfer partners are
 * deliberately left alone: deleting one leg is a statement about that leg only.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const deleted = await client.query<{ plaid_transaction_id: string }>(
      'DELETE FROM transactions WHERE id = $1 RETURNING plaid_transaction_id',
      [id]
    );
    for (const { plaid_transaction_id } of deleted.rows) {
      await client.query(
        `INSERT INTO transaction_tombstones (plaid_transaction_id) VALUES ($1)
         ON CONFLICT (plaid_transaction_id) DO NOTHING`,
        [plaid_transaction_id]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    // Message only. The error text is Postgres's, and it stays server-side; the client gets the
    // generic envelope, the same split `/api/v1/sync` makes for the same reason.
    log.error('delete failed', { error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Delete failed' } } satisfies ApiResponse<never>,
      { status: 500 }
    );
  } finally {
    client.release();
  }

  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}
