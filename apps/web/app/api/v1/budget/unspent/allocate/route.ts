// `POST /api/v1/budget/unspent/allocate` — carry part of a category's unspent bucket into a month, or
// release it to savings. The rules (amount within the balance, a month no earlier than this one, a
// spending category as the destination) are lib/domain/unspent.ts's; this only parses the body.
import { NextRequest } from 'next/server';
import { allocate } from '@/lib/unspentStore';
import { createLogger } from '@/lib/logger';
import type { ApiResponse } from '@b8/contracts/types';

const log = createLogger('unspent');

const bad = (message: string, status = 400) =>
  Response.json({ success: false, error: { code: 'INVALID_INPUT', message } } satisfies ApiResponse<never>, { status });

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return bad('A JSON body is required.');
  const { categoryId, amount, action, toCategoryId, toYear, toMonth } = body;
  if (!isInt(categoryId)) return bad('categoryId is required.');
  if (typeof amount !== 'number') return bad('amount is required.');
  if (action !== 'carry' && action !== 'release') return bad("action must be 'carry' or 'release'.");
  if (action === 'carry' && (!isInt(toCategoryId) || !isInt(toYear) || !isInt(toMonth))) {
    return bad('A carry needs toCategoryId, toYear and toMonth.');
  }

  try {
    const result = await allocate({
      categoryId, amount, action,
      ...(action === 'carry' ? { toCategoryId: toCategoryId as number, to: { year: toYear as number, month: toMonth as number } } : {}),
    });
    if (!result.ok) return bad(result.message, result.status);
    log.info('allocated', { action });
    return Response.json({ success: true, data: null } satisfies ApiResponse<null>, { status: 201 });
  } catch (err) {
    log.error('allocate failed', { error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Could not save that allocation.' } } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}
