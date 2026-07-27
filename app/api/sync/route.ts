import { NextRequest } from 'next/server';
import { runSync } from '@/lib/sync';
import type { ApiResponse } from '@/shared/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const accountId: string | null = body?.accountId ?? null;
    const force: boolean = body?.force === true;

    const result = await runSync({ accountId, force });

    if (result.errors.length > 0 && result.synced === 0) {
      return Response.json(
        { success: false, error: { code: 'SYNC_ERROR', message: result.errors[0] } } satisfies ApiResponse<never>,
        { status: 500 }
      );
    }

    return Response.json({
      success: true,
      data: result,
    } satisfies ApiResponse<typeof result>);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    console.error('[sync]', err);
    const status = message === 'Account not found or has no access token' ? 404 : 500;
    return Response.json(
      { success: false, error: { code: 'SYNC_ERROR', message } } satisfies ApiResponse<never>,
      { status }
    );
  }
}
