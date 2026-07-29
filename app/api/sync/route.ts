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
    const rawMessage = err instanceof Error ? err.message : 'Sync failed';
    // Message only, never the raw error object — see create-link-token/route.ts for why
    // (runSync can throw axios errors from the Plaid SDK, which carry the live client
    // secret in `.config.headers`, and console.error on such an object prints that too).
    console.error('[sync]', rawMessage);
    // "Account not found" is a specific, deliberately-thrown, known-safe string from
    // runSyncInner — safe to pass through as-is. Anything else caught here is an
    // unanticipated failure (DB/Plaid internals) and must not reach the client verbatim.
    const isKnownNotFound = rawMessage === 'Account not found or has no access token';
    return Response.json(
      {
        success: false,
        error: { code: 'SYNC_ERROR', message: isKnownNotFound ? rawMessage : 'Sync failed' },
      } satisfies ApiResponse<never>,
      { status: isKnownNotFound ? 404 : 500 }
    );
  }
}
