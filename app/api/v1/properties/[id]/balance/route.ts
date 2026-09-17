import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse } from '@/shared/types';

// Deliberately the same shape as /api/accounts/[id]/balance — a property's opening cash
// position is the same concept as an account's, keyed by property instead. Upsert on
// (property_id, year) so re-entering the figure corrects it rather than failing.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { beginning_balance } = await req.json();
  if (typeof beginning_balance !== 'number' || isNaN(beginning_balance)) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'beginning_balance must be a number' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }
  const year = new Date().getFullYear();
  await db.query(
    `INSERT INTO property_balances (property_id, year, beginning_balance)
     VALUES ($1, $2, $3)
     ON CONFLICT (property_id, year) DO UPDATE SET beginning_balance = $3`,
    [id, year, beginning_balance]
  );
  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}
