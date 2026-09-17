import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse } from '@/shared/types';

const currentYear = () => new Date().getFullYear();

export async function GET(req: NextRequest) {
  const landscape = req.nextUrl.searchParams.get('landscape') ?? 'operational';
  const result = await db.query<{ beginning_balance: string }>(
    'SELECT beginning_balance FROM budget_settings WHERE year = $1 AND landscape = $2',
    [currentYear(), landscape]
  );
  const balance = Number(result.rows[0]?.beginning_balance ?? 0);
  return Response.json({ success: true, data: { beginning_balance: balance } } satisfies ApiResponse<{ beginning_balance: number }>);
}

export async function PATCH(req: NextRequest) {
  const { beginning_balance, landscape = 'operational' } = await req.json();
  if (typeof beginning_balance !== 'number' || isNaN(beginning_balance)) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'beginning_balance must be a number' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }
  await db.query(
    `INSERT INTO budget_settings (year, landscape, beginning_balance) VALUES ($1, $2, $3)
     ON CONFLICT (year, landscape) DO UPDATE SET beginning_balance = $3`,
    [currentYear(), landscape, beginning_balance]
  );
  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}
