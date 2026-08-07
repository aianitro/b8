import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import db from '@/lib/db';
import type { ApiResponse } from '@/shared/types';
import { createLogger } from '@/lib/logger';

const log = createLogger('transactions');

// Manually create a transaction — used e.g. to recreate one that Plaid dropped/deduped away,
// or any other hand-entered entry. Gets a synthetic plaid_transaction_id (never collides with
// a real Plaid one) so it behaves like any other row everywhere else in the app.
export async function POST(req: NextRequest) {
  try {
    const { account_id, date, amount, name, merchant_name, mapped_category } = await req.json() as {
      account_id: string;
      date: string;
      amount: number;
      name?: string | null;
      merchant_name?: string | null;
      mapped_category?: string | null;
    };

    if (!account_id || !date || typeof amount !== 'number' || !Number.isFinite(amount)) {
      return Response.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'account_id, date, and amount are required' } } satisfies ApiResponse<null>,
        { status: 400 }
      );
    }

    const id = `manual_${randomUUID()}`;
    const result = await db.query<{ id: number }>(
      `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, merchant_name, mapped_category)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [id, account_id, date, amount, name?.trim() || null, merchant_name?.trim() || null, mapped_category || null]
    );

    return Response.json({ success: true, data: { id: result.rows[0].id } } satisfies ApiResponse<{ id: number }>, { status: 201 });
  } catch (err) {
    log.error('POST failed', { error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Failed to create transaction' } } satisfies ApiResponse<null>,
      { status: 500 }
    );
  }
}
