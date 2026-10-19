import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse } from '@b8/contracts/types';
import { viewerOf } from '@/lib/giftViewer';
import { giftLockedResponse, giftLockSql, lockedFor } from '@/lib/giftLock';
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

  // A row a gift holds cannot be paired (P7-41b): pairing re-files it as Transfer, out of the gift
  // category, which nobody may do before the reveal. Refused before anything is validated against it,
  // with the locked refusal, so the answer says nothing about the row's amount or group.
  const viewer = await viewerOf(req);
  if (await lockedFor(ids, 'transfer', viewer)) return giftLockedResponse();

  const rows = await db.query<{ id: number; amount: string; transfer_group_id: number | null }>(
    'SELECT id, amount, transfer_group_id FROM transactions WHERE id = ANY($1)',
    [ids]
  );

  const rowsError = validateTransferRows(ids, rows.rows);
  if (rowsError) return errorResponse(rowsError);

  const group = await db.query<{ id: number }>('INSERT INTO transfer_groups DEFAULT VALUES RETURNING id');
  const groupId = group.rows[0].id;
  await db.query(
    `UPDATE transactions SET transfer_group_id = $1, mapped_category = 'Transfer'
      WHERE id = ANY($2) AND NOT ${giftLockSql('transactions', 'transfer', viewer)}`,
    [groupId, ids]
  );

  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}

// Unlink a transfer group — clears every member, given any one member's id
export async function DELETE(req: NextRequest) {
  const { id } = await req.json();

  // Unlinking touches every member of the group; a held row is never in one (pairing refuses it), but
  // the lock is asked anyway so this route cannot be the way around it.
  const viewer = await viewerOf(req);
  if (await lockedFor([Number(id)], 'transfer', viewer)) return giftLockedResponse();

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
