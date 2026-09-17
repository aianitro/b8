import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse } from '@/shared/types';

export async function POST(req: NextRequest) {
  const { plaid_category, mapped_category } = await req.json();
  if (!plaid_category || !mapped_category) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'plaid_category and mapped_category required' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }
  await db.query(
    `INSERT INTO category_rules (plaid_category, mapped_category)
     VALUES ($1, $2)
     ON CONFLICT (plaid_category) DO UPDATE SET mapped_category = EXCLUDED.mapped_category`,
    [plaid_category, mapped_category]
  );
  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}

export async function DELETE(req: NextRequest) {
  const { plaid_category } = await req.json();
  await db.query('DELETE FROM category_rules WHERE plaid_category = $1', [plaid_category]);
  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}
