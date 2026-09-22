import { NextRequest } from 'next/server';
import type { ApiResponse } from '@b8/contracts/types';
import { createLogger } from '@/lib/logger';
import { credentialFrom } from '@/lib/requestAuth';
import { createHandoff } from '@/lib/deviceHandoffStore';

const log = createLogger('device-handoff');

export const dynamic = 'force-dynamic';

/**
 * A signed-in BROWSER mints a one-minute code for the app.
 *
 * Behind the boundary on purpose: only a caller that has already completed the passkey ceremony can
 * reach this, and `credentialFrom` applies the scope check itself. The code inherits that caller's
 * credential, so the device session the app ends up with traces back to the passkey that authorised
 * it rather than to a code that appeared from nowhere.
 *
 * The response carries the code ONCE and is `no-store`, like every other credential this app issues.
 */
export async function POST(req: NextRequest) {
  const session = await credentialFrom(req);
  if (!session) {
    return Response.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Sign in first.' } } satisfies ApiResponse<never>,
      { status: 403 }
    );
  }

  // A DEVICE OR PERSONAL TOKEN MAY NOT MINT ONE. The point of the handoff is that a browser earned a
  // credential through a ceremony and is passing it on; letting an existing bearer token mint another
  // would make a token self-renewing and outlive its own revocation — the same reasoning that keeps a
  // personal token out of `sessionMayEnrol`.
  if (session.kind !== 'browser') {
    log.warn('handoff refused: not a browser session', { kind: session.kind });
    return Response.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Only a browser sign-in can link a device.' } } satisfies ApiResponse<never>,
      { status: 403 }
    );
  }

  try {
    const code = await createHandoff(session.credentialId, new Date());
    log.info('device handoff minted');
    return Response.json(
      { success: true, data: { code } } satisfies ApiResponse<{ code: string }>,
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    log.error('handoff failed', { error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { success: false, error: { code: 'HANDOFF_FAILED', message: 'Could not create a link code.' } } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}
