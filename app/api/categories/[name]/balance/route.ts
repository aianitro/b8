import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse } from '@/shared/types';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { beginning_balance } = await req.json();
  if (typeof beginning_balance !== 'number' || isNaN(beginning_balance)) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'beginning_balance must be a number' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }
  const year = new Date().getFullYear();
  await db.query(
    `INSERT INTO category_balances (category_name, year, beginning_balance)
     VALUES ($1, $2, $3)
     ON CONFLICT (category_name, year) DO UPDATE SET beginning_balance = $3`,
    [name, year, beginning_balance]
  );
  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}
