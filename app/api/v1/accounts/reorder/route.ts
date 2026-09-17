import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse } from '@/shared/types';

// Body: [{ id, sort_order }]
export async function PATCH(req: NextRequest) {
  const items: { id: string; sort_order: number }[] = await req.json();
  if (!Array.isArray(items) || items.length === 0) {
    return Response.json(
      { success: false, error: { code: 'BAD_REQUEST', message: 'items array required' } } satisfies ApiResponse<null>,
      { status: 400 }
    );
  }
  await Promise.all(
    items.map(({ id, sort_order }) =>
      db.query('UPDATE accounts SET sort_order = $1 WHERE id = $2', [sort_order, id])
    )
  );
  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}
