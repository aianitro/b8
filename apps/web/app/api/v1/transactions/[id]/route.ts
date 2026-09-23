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

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.query('DELETE FROM transactions WHERE id = $1', [id]);
  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}
