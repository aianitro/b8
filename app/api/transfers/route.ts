import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse } from '@/shared/types';

const EPSILON = 0.01;

// Link 2+ transactions as a transfer group — any quantity, as long as the amounts sum to ~0
export async function POST(req: NextRequest) {
  const { ids } = await req.json() as { ids?: number[] };

  if (!Array.isArray(ids) || ids.length < 2 || new Set(ids).size !== ids.length) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'ids must be 2 or more distinct transaction ids' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  const rows = await db.query<{ id: number; amount: string; transfer_group_id: number | null }>(
    'SELECT id, amount, transfer_group_id FROM transactions WHERE id = ANY($1)',
    [ids]
  );

  if (rows.rows.length !== ids.length) {
    return Response.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'One or more transactions not found' } } satisfies ApiResponse<never>,
      { status: 404 }
    );
  }
  if (rows.rows.some((r) => r.transfer_group_id !== null)) {
    return Response.json(
      { success: false, error: { code: 'ALREADY_GROUPED', message: 'One or more transactions are already part of a transfer group — unlink first' } } satisfies ApiResponse<never>,
      { status: 409 }
    );
  }

  const sum = rows.rows.reduce((s, r) => s + Number(r.amount), 0);
  if (Math.abs(sum) > EPSILON) {
    return Response.json(
      { success: false, error: { code: 'UNBALANCED', message: `Selected amounts must sum to 0 (currently ${sum.toFixed(2)})` } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

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
