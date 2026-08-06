import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse } from '@/shared/types';
import {
  isValidTransferIds,
  invalidTransferIdsError,
  validateTransferRows,
  type TransferValidationError,
} from '@/lib/transferValidation';

const STATUS_BY_CODE: Record<TransferValidationError['code'], number> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  ALREADY_GROUPED: 409,
  UNBALANCED: 400,
};

const errorResponse = (error: TransferValidationError) =>
  Response.json({ success: false, error } satisfies ApiResponse<never>, { status: STATUS_BY_CODE[error.code] });

// Link 2+ transactions as a transfer group — any quantity, as long as the amounts sum to ~0
export async function POST(req: NextRequest) {
  const { ids } = await req.json() as { ids?: unknown };

  if (!isValidTransferIds(ids)) return errorResponse(invalidTransferIdsError);

  const rows = await db.query<{ id: number; amount: string; transfer_group_id: number | null }>(
    'SELECT id, amount, transfer_group_id FROM transactions WHERE id = ANY($1)',
    [ids]
  );

  const rowsError = validateTransferRows(ids, rows.rows);
  if (rowsError) return errorResponse(rowsError);

  const group = await db.query<{ id: number }>('INSERT INTO transfer_groups DEFAULT VALUES RETURNING id');
  const groupId = group.rows[0].id;
  await db.query(
    `UPDATE transactions SET transfer_group_id = $1, mapped_category = 'Transfer' WHERE id = ANY($2)`,
    [groupId, ids]
  );

  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}

// Unlink a transfer group — clears every member, given any one member's id
export async function DELETE(req: NextRequest) {
  const { id } = await req.json();

  const group = await db.query<{ transfer_group_id: number | null }>(
    'SELECT transfer_group_id FROM transactions WHERE id = $1',
    [id]
  );
  const groupId = group.rows[0]?.transfer_group_id;
  if (!groupId) {
    return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
  }

  await db.query('UPDATE transactions SET transfer_group_id = NULL WHERE transfer_group_id = $1', [groupId]);
  await db.query('DELETE FROM transfer_groups WHERE id = $1', [groupId]);

  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}
