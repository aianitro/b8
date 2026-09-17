import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { roundCents } from '@/lib/budgetMath';
import type { ApiResponse } from '@/shared/types';

// Appends a manual point-in-time valuation. Unlike the sibling balance route (which upserts a
// single beginning_balance per year), this always INSERTs: account_valuations is an append-only
// observation history, so re-entering a value quarterly builds the series §1f charts rather
// than overwriting last quarter's number.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { value } = await req.json();

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'value must be a number' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  // Liabilities are stored as a positive amount owed — the sign is derived from
  // accounts.is_liability by computeNetWorth(), never from the stored value. Accepting a
  // negative here would double-negate a mortgage into a $500k asset.
  if (value < 0) {
    return Response.json(
      {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Enter a positive amount. For a mortgage or loan, set the account to "Valuation (liability)" — the balance is subtracted automatically.',
        },
      } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  const account = await db.query<{ id: string }>('SELECT id FROM accounts WHERE id = $1', [id]);
  if (account.rows.length === 0) {
    return Response.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Account not found' } } satisfies ApiResponse<never>,
      { status: 404 }
    );
  }

  await db.query(
    `INSERT INTO account_valuations (account_id, value, source) VALUES ($1, $2, 'manual')`,
    [id, roundCents(value)]
  );

  return Response.json({ success: true, data: null } satisfies ApiResponse<null>, { status: 201 });
}
