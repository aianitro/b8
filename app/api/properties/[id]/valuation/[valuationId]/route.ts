import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse } from '@/shared/types';

// Deleting a valuation is not a contradiction of property_valuations being append-only —
// "append-only" means a recorded value is never edited in place, so the history stays an honest
// record of what was believed when. But every row here is hand-typed, and a fat-fingered
// $15,060,000 would otherwise permanently skew both the chart's axis and net worth with no way
// back. Removing a bad observation is correcting the record; rewriting one would be falsifying it.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; valuationId: string }> }) {
  const { id, valuationId } = await params;

  // Scoped by property_id as well as row id so a valuation can only be deleted through the
  // property that owns it — a mismatched pair is a 404, not a silent no-op.
  const result = await db.query(
    'DELETE FROM property_valuations WHERE id = $1 AND property_id = $2',
    [valuationId, id]
  );

  if (result.rowCount === 0) {
    return Response.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Valuation not found for this property' } } satisfies ApiResponse<never>,
      { status: 404 }
    );
  }

  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}
