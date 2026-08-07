import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse, PropertyType } from '@/shared/types';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body: {
    nickname?: string; address?: string | null; type?: PropertyType;
    purchase_price?: number | null; purchase_date?: string | null; cost_basis?: number | null;
  } = await req.json();

  if ('nickname' in body) {
    const nickname = body.nickname?.trim();
    if (!nickname) {
      return Response.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'Nickname cannot be empty' } } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }
    await db.query('UPDATE properties SET nickname = $1 WHERE id = $2', [nickname, id]);
  }

  if ('address' in body) {
    await db.query('UPDATE properties SET address = $1 WHERE id = $2', [body.address?.trim() || null, id]);
  }

  if ('type' in body) {
    if (body.type !== 'primary' && body.type !== 'rental') {
      return Response.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'type must be primary or rental' } } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }
    await db.query('UPDATE properties SET type = $1 WHERE id = $2', [body.type, id]);
  }

  if ('purchase_price' in body) {
    await db.query('UPDATE properties SET purchase_price = $1 WHERE id = $2', [body.purchase_price ?? null, id]);
  }

  if ('purchase_date' in body) {
    await db.query('UPDATE properties SET purchase_date = $1 WHERE id = $2', [body.purchase_date || null, id]);
  }

  if ('cost_basis' in body) {
    await db.query('UPDATE properties SET cost_basis = $1 WHERE id = $2', [body.cost_basis ?? null, id]);
  }

  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}
