import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse } from '@/shared/types';

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
      { success: false, error: { code: 'INVALID_INPUT', message: 'mapped_category, hidden, or property_id required' } } satisfies ApiResponse<never>,
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
