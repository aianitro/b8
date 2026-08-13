import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse } from '@/shared/types';

export async function PATCH(req: NextRequest) {
  const body = await req.json() as {
    ids: number[];
    mapped_category?: string | null;
    property_id?: number | null;
  };
  const { ids } = body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return Response.json({ success: false, error: { code: 'BAD_REQUEST', message: 'ids required' } } satisfies ApiResponse<null>, { status: 400 });
  }

  // One field per call, matching the single-transaction PATCH. Bulk property tagging is the
  // whole reason this route grew a second field: attributing a property's pre-dedicated-account
  // history means selecting a run of transactions and applying one property to all of them.
  if ('property_id' in body) {
    const propertyId = body.property_id === null ? null : Number(body.property_id);
    if (propertyId !== null && !Number.isInteger(propertyId)) {
      return Response.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'property_id must be an integer or null' } } satisfies ApiResponse<null>,
        { status: 400 }
      );
    }
    await db.query('UPDATE transactions SET property_id = $1 WHERE id = ANY($2)', [propertyId, ids]);
  } else if ('mapped_category' in body) {
    await db.query(
      'UPDATE transactions SET mapped_category = $1, rule_applied = false WHERE id = ANY($2)',
      [body.mapped_category ?? null, ids],
    );
  } else {
    return Response.json(
      { success: false, error: { code: 'BAD_REQUEST', message: 'mapped_category or property_id required' } } satisfies ApiResponse<null>,
      { status: 400 }
    );
  }

  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}
