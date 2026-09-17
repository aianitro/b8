import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { roundCents } from '@/lib/budgetMath';
import type { ApiResponse } from '@/shared/types';

// Appends a manual point-in-time valuation, mirroring app/api/accounts/[id]/valuation/route.ts:
// always INSERT, never upsert — property_valuations is an observation history, and a quarterly
// re-entry is meant to build the series, not overwrite last quarter's number.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { value, valued_at } = await req.json();

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'value must be a number' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  // Backdating is the point, not an edge case: values are entered by hand every few months, so
  // the series only means anything if "what it was worth in Q2" can be recorded in Q3. Omitting
  // valued_at falls back to the column's NOW() default.
  let valuedAt: string | null = null;
  if (valued_at !== undefined && valued_at !== null && valued_at !== '') {
    if (typeof valued_at !== 'string' || Number.isNaN(new Date(valued_at).getTime())) {
      return Response.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'valued_at must be a valid date' } } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }
    // A future valuation is always a typo (a mistyped year), and it would sit at the right edge
    // of the chart dragging the axis with it — rejecting beats silently charting it.
    if (new Date(valued_at).getTime() > Date.now()) {
      return Response.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'Valuation date cannot be in the future' } } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }
    valuedAt = valued_at;
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

  // COALESCE so an omitted date takes the column default rather than being written as NULL,
  // which the NOT NULL constraint would reject.
  await db.query(
    `INSERT INTO property_valuations (property_id, value, source, valued_at)
     VALUES ($1, $2, 'manual', COALESCE($3::timestamptz, NOW()))`,
    [id, roundCents(value), valuedAt]
  );

  return Response.json({ success: true, data: null } satisfies ApiResponse<null>, { status: 201 });
}
