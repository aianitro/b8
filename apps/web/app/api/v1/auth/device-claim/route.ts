import { NextRequest } from 'next/server';
import type { ApiResponse } from '@b8/contracts/types';
import { createLogger } from '@/lib/logger';
import { mayIssueDeviceToken } from '@/lib/bearerAuth';
import { claimHandoff, pruneHandoffs } from '@/lib/deviceHandoffStore';

const log = createLogger('device-claim');

export const dynamic = 'force-dynamic';

/**
 * The app exchanges a handoff code for a device session.
 *
 * PRE-AUTH, NECESSARILY: the caller has no session yet — getting one is the point. The code is the
 * credential, and it is single-use and dead in sixty seconds.
 *
 * `mayIssueDeviceToken` is the same gate `login/verify` applies, and it is what makes this safe to
 * leave open: it refuses any caller carrying `Sec-Fetch-*` headers, so a browser — including a
 * malicious page that somehow obtained a code — cannot exchange it. Only a non-browser client can,
 * which is the app.
 */
export async function POST(req: NextRequest) {
  if (!mayIssueDeviceToken(req.headers)) {
    log.warn('claim refused: the caller is a browser');
    return Response.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'A browser cannot claim a device session.' } } satisfies ApiResponse<never>,
      { status: 403 }
    );
  }

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'A JSON body with `code` is required.' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  if (typeof body.code !== 'string' || body.code.length < 20) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'That is not a link code.' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  const now = new Date();
  try {
    const result = await claimHandoff(body.code, now);
    if (!result.ok) {
      log.info('claim refused', { code: result.code });
      // 409 rather than 401: the request is well formed and the credential real, and the WORLD
      // refused it — spent, or expired. The same distinction the proposal decide endpoint draws.
      return Response.json(
        { success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>,
        { status: result.code === 'NOT_FOUND' ? 404 : 409 }
      );
    }

    // Swept here rather than on a timer: the table is written once per sign-in, so the cheapest place
    // to keep it small is the moment it is already being touched. A failure to prune must not cost a
    // successful sign-in, hence the catch.
    await pruneHandoffs(now).catch(() => {});

    log.info('device session issued from handoff');
    return Response.json(
      { success: true, data: { token: result.token, expiresAt: result.expiresAt } } satisfies ApiResponse<{ token: string; expiresAt: string }>,
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    log.error('claim failed', { error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { success: false, error: { code: 'CLAIM_FAILED', message: 'Could not link this device.' } } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}
