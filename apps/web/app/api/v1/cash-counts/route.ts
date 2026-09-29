import { NextRequest } from 'next/server';
import type { ApiResponse } from '@b8/contracts/types';
import { recordCashCount, walletStatuses } from '@/lib/cashCountStore';
import { daysSinceCount } from '@/lib/domain/cashCount';

/** Every countable wallet, its balance, and how stale that balance is. */
export async function GET() {
  try {
    const wallets = await walletStatuses();
    return Response.json({
      success: true,
      data: wallets.map((w) => ({ ...w, daysSinceCount: daysSinceCount(w.lastCountedAt) })),
    } satisfies ApiResponse<unknown>);
  } catch {
    return Response.json(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Failed to read wallets' } } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}

/**
 * Record a count of one wallet.
 *
 * The response reports what the count DID — the gap it found and the direction — rather than just
 * succeeding. A count that silently returns 200 leaves the owner unable to tell "it matched" from
 * "it wrote off a large sum", and those want very different reactions.
 */
export async function POST(req: NextRequest) {
  let body: { account_id?: unknown; counted?: unknown; mapped_category?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'Body must be JSON' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  const accountId = typeof body.account_id === 'string' ? body.account_id : '';
  // `Number()` and not `parseFloat`: parseFloat('12abc') is 12, which would silently accept a typo
  // as a count and write an adjustment against it.
  const counted = typeof body.counted === 'number' ? body.counted : Number(body.counted);
  const mappedCategory =
    typeof body.mapped_category === 'string' && body.mapped_category.trim() !== ''
      ? body.mapped_category.trim()
      : null;

  if (!accountId || !Number.isFinite(counted)) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'account_id and a numeric counted are required' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  try {
    const result = await recordCashCount({ accountId, counted, mappedCategory });
    if (!result.ok) {
      const status = result.code === 'NOT_FOUND' ? 404 : 400;
      return Response.json(
        { success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>,
        { status }
      );
    }
    return Response.json(
      { success: true, data: { ...result.outcome, adjustmentTransactionId: result.adjustmentTransactionId } } satisfies ApiResponse<unknown>,
      { status: 201 }
    );
  } catch {
    return Response.json(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Failed to record the count' } } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}
