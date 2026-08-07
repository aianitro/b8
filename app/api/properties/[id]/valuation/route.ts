import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { roundCents } from '@/lib/budgetMath';
import type { ApiResponse } from '@/shared/types';

// Appends a manual point-in-time valuation, mirroring app/api/accounts/[id]/valuation/route.ts:
// always INSERT, never upsert — property_valuations is an observation history, and a quarterly
// re-entry is meant to build the series, not overwrite last quarter's number.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { value } = await req.json();

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'value must be a number' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  // Unlike the accounts valuation route, there's no liability variant to guard against here —
  // a property's own value is always an asset; the mortgage against it is a separate account.
  if (value < 0) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'Enter a positive market value' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  const property = await db.query<{ id: number }>('SELECT id FROM properties WHERE id = $1', [id]);
  if (property.rows.length === 0) {
    return Response.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Property not found' } } satisfies ApiResponse<never>,
      { status: 404 }
    );
  }

  await db.query(
    `INSERT INTO property_valuations (property_id, value, source) VALUES ($1, $2, 'manual')`,
    [id, roundCents(value)]
  );

  return Response.json({ success: true, data: null } satisfies ApiResponse<null>, { status: 201 });
}
