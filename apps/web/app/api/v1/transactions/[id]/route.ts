import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { parseWatchInput } from '@/lib/watchlist';
import type { ApiResponse } from '@b8/contracts/types';

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
  } else if ('watched' in body) {
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
      // COALESCE keeps the ORIGINAL flag time when a note is edited on an already-watched row.
      // Written as a bare NOW() this would restart the clock on every note edit, and an entry that
      // gets its wording fixed would silently read as new — which is the one thing the timestamp
      // exists to prevent.
      `UPDATE transactions
          SET watched_at = CASE WHEN $1 THEN COALESCE(watched_at, NOW()) ELSE NULL END,
              watch_note = $2
        WHERE id = $3`,
      [watched, note, id]
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
      { success: false, error: { code: 'INVALID_INPUT', message: 'mapped_category, hidden, watched, or property_id required' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.query('DELETE FROM transactions WHERE id = $1', [id]);
  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}
