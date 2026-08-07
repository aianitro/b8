import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse, PropertyType } from '@/shared/types';
import { createLogger } from '@/lib/logger';

const log = createLogger('properties');

export async function POST(req: NextRequest) {
  try {
    const { nickname, address, type, purchase_price, purchase_date, cost_basis } = await req.json() as {
      nickname: string;
      address?: string;
      type: PropertyType;
      purchase_price?: number | null;
      purchase_date?: string | null;
      cost_basis?: number | null;
    };

    if (!nickname?.trim() || (type !== 'primary' && type !== 'rental')) {
      return Response.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'nickname and type (primary or rental) are required' } } satisfies ApiResponse<null>,
        { status: 400 }
      );
    }

    // cost_basis defaults to purchase_price on creation — the "starts equal, bumped manually
    // for improvements" convention documented on the column itself.
    const result = await db.query<{ id: number }>(
      `INSERT INTO properties (nickname, address, type, purchase_price, purchase_date, cost_basis)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [nickname.trim(), address?.trim() || null, type, purchase_price ?? null, purchase_date || null, cost_basis ?? purchase_price ?? null]
    );

    return Response.json({ success: true, data: { id: result.rows[0].id } } satisfies ApiResponse<{ id: number }>, { status: 201 });
  } catch (err) {
    log.error('POST failed', { error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Failed to create property' } } satisfies ApiResponse<null>,
      { status: 500 }
    );
  }
}
