import { NextRequest } from 'next/server';
import type { ApiResponse } from '@b8/contracts/types';
import { recordCashTransfer, type CashTransferArgs } from '@/lib/cashTransferStore';

const STATUS: Record<string, number> = {
  NOT_FOUND: 404, NOT_COUNTABLE: 400, ALREADY_GROUPED: 409, INVALID: 400, UNBALANCED: 400,
};

/**
 * Record cash arriving — either from a withdrawal that already exists, or moved between wallets.
 *
 * Two shapes on one endpoint because they are one operation: create the leg no feed will produce,
 * then group. Splitting them into two routes would duplicate the countable checks and the grouping,
 * which is how two paths end up disagreeing about what a valid transfer is.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'Body must be JSON' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  let args: CashTransferArgs;
  if (typeof body.anchorTransactionId === 'number' && typeof body.toAccountId === 'string') {
    args = { kind: 'fund', anchorTransactionId: body.anchorTransactionId, toAccountId: body.toAccountId };
  } else if (
    typeof body.fromAccountId === 'string' &&
    typeof body.toAccountId === 'string' &&
    typeof body.date === 'string'
  ) {
    args = {
      kind: 'move',
      fromAccountId: body.fromAccountId,
      toAccountId: body.toAccountId,
      // `Number()` rather than parseFloat: parseFloat('40abc') is 40, which would accept a typo.
      amount: typeof body.amount === 'number' ? body.amount : Number(body.amount),
      date: body.date,
    };
  } else {
    return Response.json(
      {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Send either { anchorTransactionId, toAccountId } or { fromAccountId, toAccountId, amount, date }',
        },
      } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  try {
    const result = await recordCashTransfer(args);
    if (!result.ok) {
      return Response.json(
        { success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>,
        { status: STATUS[result.code] ?? 400 }
      );
    }
    return Response.json(
      { success: true, data: { groupId: result.groupId, created: result.createdTransactionIds } } satisfies ApiResponse<unknown>,
      { status: 201 }
    );
  } catch {
    return Response.json(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Failed to record the transfer' } } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}
