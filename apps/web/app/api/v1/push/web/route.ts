import { NextRequest } from 'next/server';
import type { ApiResponse } from '@b8/contracts/types';
import { createLogger } from '@/lib/logger';
import { credentialFrom } from '@/lib/requestAuth';
import { registerSubscription } from '@/lib/webPush';

const log = createLogger('push-web');

export const dynamic = 'force-dynamic';

/**
 * The installed PWA registers itself for the same content-free ping — §5 step 26b.
 *
 * A sibling of `../devices`, which does this for the Expo app, and it follows that route's rules
 * rather than inventing its own: a POST, deliberately NOT in `READ_SAFE_POSTS`, because registering
 * makes this owner's phone addressable and a read-only token may not do it. `credentialFrom`
 * applies the scope check itself — the lesson of P1-12a, that the authority test travels with
 * identifying the caller rather than with the path the caller took.
 *
 * ONLY THE ENDPOINT IS ACCEPTED. A browser's `PushSubscription` also carries `p256dh` and `auth`,
 * and this route ignores them if sent: there is no column for them, because this app sends no
 * payload and therefore never encrypts one. See the migration for why that is structural rather
 * than an oversight.
 */
export async function POST(req: NextRequest) {
  const session = await credentialFrom(req);
  if (!session) {
    return Response.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'A full-scope session is required to register for notifications.' } } satisfies ApiResponse<never>,
      { status: 403 }
    );
  }

  let body: { endpoint?: unknown; label?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'A JSON body with `endpoint` is required.' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  // Validated HERE as well as by the column's CHECK. The database is the backstop, not the message:
  // a constraint violation reaches the client as a 500 and tells them nothing they can act on.
  //
  // `https://` and a parseable URL is the whole test. A tighter pattern would reject a valid
  // subscription the first time Apple, Mozilla or Google changed a hostname — see the migration.
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
  let valid = endpoint.startsWith('https://');
  if (valid) {
    try { new URL(endpoint); } catch { valid = false; }
  }
  if (!valid) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'That is not a push subscription endpoint.' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  const label = typeof body.label === 'string' && body.label.trim()
    ? body.label.trim().slice(0, 60)
    : null;

  try {
    await registerSubscription(endpoint, label);
    return Response.json({ success: true, data: { registered: true } } satisfies ApiResponse<{ registered: boolean }>);
  } catch (err) {
    // The endpoint is credential-shaped and is never logged, on this path or the send path.
    log.error('register failed', { error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { success: false, error: { code: 'REGISTER_FAILED', message: 'Could not register for notifications.' } } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}
