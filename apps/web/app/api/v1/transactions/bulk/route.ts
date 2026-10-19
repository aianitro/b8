import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse } from '@b8/contracts/types';
import { viewerOf } from '@/lib/giftViewer';
import { giftLockedResponse, giftLockSql, lockedFor } from '@/lib/giftLock';

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

  // A SELECTION THAT INCLUDES A ROW A GIFT HOLDS IS REFUSED WHOLE (P7-41b), with the one locked
  // refusal the single-row PATCH gives. Applying the edit to the rest and skipping the held row would
  // answer "which of these is a gift" by what changed. Each UPDATE repeats the lock in its WHERE.
  const viewer = await viewerOf(req);
  const edit = 'property_id' in body ? 'property' : 'mapped_category' in body ? 'category' : null;
  if (edit !== null && await lockedFor(ids.map(Number), edit, viewer)) return giftLockedResponse();

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
    await db.query(
      `UPDATE transactions SET property_id = $1 WHERE id = ANY($2) AND NOT ${giftLockSql('transactions', 'property', viewer)}`,
      [propertyId, ids]
    );
  } else if ('mapped_category' in body) {
    await db.query(
      `UPDATE transactions SET mapped_category = $1, rule_applied = false
        WHERE id = ANY($2) AND NOT ${giftLockSql('transactions', 'category', viewer)}`,
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
