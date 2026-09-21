import { NextRequest } from 'next/server';
import type { ApiResponse } from '@b8/contracts/types';
import { createLogger } from '@/lib/logger';
import { credentialFrom } from '@/lib/requestAuth';
import { registerDevice } from '@/lib/push';

const log = createLogger('push-devices');

export const dynamic = 'force-dynamic';

const TOKEN_SHAPE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;

/**
 * The phone registers itself for a content-free ping.
 *
 * A POST, and deliberately NOT in `READ_SAFE_POSTS` — registering a device writes a row and makes
 * this owner's phone addressable, so a read-only token may not do it. `credentialFrom` applies the
 * scope check itself, which is the lesson of P1-12a: the authority test travels with identifying the
 * caller rather than with the path the caller took.
 */
export async function POST(req: NextRequest) {
  const session = await credentialFrom(req);
  if (!session) {
    return Response.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'A full-scope session is required to register a device.' } } satisfies ApiResponse<never>,
      { status: 403 }
    );
  }

  let body: { token?: unknown; label?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'A JSON body with `token` is required.' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  // Validated HERE as well as by the column's CHECK. The database is the backstop, not the message:
  // a constraint violation reaches the client as a 500 and tells them nothing they can act on.
  if (typeof body.token !== 'string' || !TOKEN_SHAPE.test(body.token)) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'That is not an Expo push token.' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  const label = typeof body.label === 'string' && body.label.trim()
    ? body.label.trim().slice(0, 60)
    : null;

  try {
    await registerDevice(body.token, label);
    return Response.json({ success: true, data: { registered: true } } satisfies ApiResponse<{ registered: boolean }>);
  } catch (err) {
    log.error('register failed', { error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { success: false, error: { code: 'REGISTER_FAILED', message: 'Could not register this device.' } } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}
