import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { roundCents } from '@/lib/budgetMath';
import type { ApiResponse, TenantFundKind } from '@/shared/types';

const KINDS: TenantFundKind[] = ['security_deposit', 'last_month_rent'];

// Appends a manual reading of the tenant money this property currently holds, mirroring
// app/api/properties/[id]/valuation/route.ts: always INSERT, never upsert. property_tenant_funds
// is an observation history, so raising a deposit at lease renewal — or applying last month's
// rent down to $0 — is a new reading, and the previous figure stays on the record rather than
// being overwritten. "Currently held" is then the newest row, derived on read.
//
// Not gated on properties.type: the rental-only restriction is an affordance in the UI, and
// enforcing it here as well would mean a figure entered before a property was reclassified could
// never be corrected. A deposit recorded against any property counts toward net worth identically.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { kind, value, valued_at } = await req.json();

  // Checked against the literal union rather than left to the column's CHECK constraint, so a
  // typo comes back as a 400 naming the problem instead of a 500 from Postgres.
  if (!KINDS.includes(kind)) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'kind must be security_deposit or last_month_rent' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'value must be a number' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  // Always a positive magnitude, exactly as the two valuation tables store theirs — the sign is
  // derived at use (computeNetWorthBreakdown negates a deposit into `liabilities`), never stored.
  // A negative row would turn an obligation into an asset and *raise* net worth with nothing
  // downstream looking wrong, which is why the column carries a CHECK as well as this guard.
  if (value < 0) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'Enter a positive amount' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  // Backdating is the point, as with a valuation: a deposit collected in March can be recorded in
  // July and still sit in the series where it belongs. Omitting valued_at takes the NOW() default.
  let valuedAt: string | null = null;
  if (valued_at !== undefined && valued_at !== null && valued_at !== '') {
    if (typeof valued_at !== 'string' || Number.isNaN(new Date(valued_at).getTime())) {
      return Response.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'valued_at must be a valid date' } } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }
    // A future date is always a typo, and here it is worse than on a chart: the newest row wins,
    // so a mistyped year would become "currently held" and stay there until it was noticed.
    if (new Date(valued_at).getTime() > Date.now()) {
      return Response.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'Date cannot be in the future' } } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }
    valuedAt = valued_at;
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
    `INSERT INTO property_tenant_funds (property_id, kind, value, valued_at)
     VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()))`,
    [id, kind, roundCents(value), valuedAt]
  );

  return Response.json({ success: true, data: null } satisfies ApiResponse<null>, { status: 201 });
}
