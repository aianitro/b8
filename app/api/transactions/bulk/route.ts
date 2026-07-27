import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse } from '@/shared/types';

export async function PATCH(req: NextRequest) {
  const { ids, mapped_category } = await req.json() as { ids: number[]; mapped_category: string | null };
  if (!Array.isArray(ids) || ids.length === 0) {
    return Response.json({ success: false, error: { code: 'BAD_REQUEST', message: 'ids required' } } satisfies ApiResponse<null>, { status: 400 });
  }
  await db.query(
    'UPDATE transactions SET mapped_category = $1, rule_applied = false WHERE id = ANY($2)',
    [mapped_category ?? null, ids],
  );
  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}
