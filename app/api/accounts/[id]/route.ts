import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse, Landscape, ValuationMode } from '@/shared/types';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body: {
    landscape?: Landscape; track_transactions?: boolean; bank?: string; name?: string;
    type?: string; subtype?: string | null;
    valuation_mode?: ValuationMode; is_liability?: boolean;
  } = await req.json();

  if ('landscape' in body) {
    const { landscape } = body;
    if (landscape !== 'operational' && landscape !== 'capital') {
      return Response.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'landscape must be operational or capital' } } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }
    await db.query('UPDATE accounts SET landscape = $1 WHERE id = $2', [landscape, id]);
  }

  if ('track_transactions' in body) {
    await db.query('UPDATE accounts SET track_transactions = $1 WHERE id = $2', [body.track_transactions, id]);
  }

  if ('bank' in body) {
    await db.query('UPDATE accounts SET bank = $1 WHERE id = $2', [body.bank ?? null, id]);
  }

  if ('name' in body) {
    const name = body.name?.trim();
    if (!name) {
      return Response.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'Name cannot be empty' } } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }
    await db.query('UPDATE accounts SET name = $1 WHERE id = $2', [name, id]);
  }

  if ('type' in body) {
    const type = body.type?.trim();
    if (!type) {
      return Response.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'type cannot be empty' } } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }
    await db.query('UPDATE accounts SET type = $1, subtype = $2 WHERE id = $3', [type, body.subtype ?? null, id]);
  }

  // Kept as two independent fields rather than one combined enum, even though the UI presents
  // them as a single three-way choice: is_liability is meaningful on its own, and only
  // computeNetWorth()'s valuation branch currently chooses to act on it.
  if ('valuation_mode' in body) {
    const { valuation_mode } = body;
    if (valuation_mode !== 'ledger' && valuation_mode !== 'valuation') {
      return Response.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'valuation_mode must be ledger or valuation' } } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }
    await db.query('UPDATE accounts SET valuation_mode = $1 WHERE id = $2', [valuation_mode, id]);
  }

  if ('is_liability' in body) {
    if (typeof body.is_liability !== 'boolean') {
      return Response.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'is_liability must be a boolean' } } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }
    await db.query('UPDATE accounts SET is_liability = $1 WHERE id = $2', [body.is_liability, id]);
  }

  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Refuse to delete an account with real transaction history — that's data loss, not
  // account cleanup. Use the "Tracking" toggle to exclude it from budgets/dashboards instead.
  const txnCount = await db.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM transactions WHERE account_id = $1', [id]
  );
  const count = Number(txnCount.rows[0].count);
  if (count > 0) {
    return Response.json(
      {
        success: false,
        error: {
          code: 'HAS_TRANSACTIONS',
          message: `This account has ${count.toLocaleString()} transaction${count === 1 ? '' : 's'} — remove or reassign them first, or use "Tracking" to exclude it instead.`,
        },
      } satisfies ApiResponse<never>,
      { status: 409 }
    );
  }

  // account_valuations has no ON DELETE CASCADE (deliberately — valuation history is not
  // something to drop by accident), so it has to be cleared explicitly here or the delete
  // below fails the FK. Same reason account_balances is cleared above.
  await db.query('DELETE FROM account_balances WHERE account_id = $1', [id]);
  await db.query('DELETE FROM account_valuations WHERE account_id = $1', [id]);
  await db.query('DELETE FROM accounts WHERE id = $1', [id]);

  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}
