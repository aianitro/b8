// `POST /api/v1/auth/logout` — revoke the session server-side and clear the cookie.
//
// NOT ON THE PRE-AUTH ALLOWLIST, and that is a decision rather than an omission: logout is
// meaningless without a session, so it gets the same 401 from `proxy.ts` as anything else. The
// handler nonetheless resolves the session itself and refuses when there is none — the boundary and
// the handler agreeing is what keeps this endpoint correct if the matcher ever changes.
//
// THE REVOCATION IS THE POINT. `lib/authSession.ts` writes `revoked_at = NOW()`; it does not
// DELETE the row and it does not expire it. A logout implemented as a cookie clear alone passes
// "logout returns 200" and fails only when the same cookie is replayed — which is exactly what
// SPEC.md's I9 does.

import type { NextRequest } from 'next/server';
import { revokeSession } from '@/lib/authSession';
import { createLogger } from '@/lib/logger';
import { authError, sessionCleared, sessionFrom, withEnvelope } from '../shared';

const log = createLogger('auth');

export const POST = withEnvelope(async (request: NextRequest) => {
  const session = await sessionFrom(request);
  if (!session) {
    return authError('UNAUTHENTICATED', 'This request carried no valid session.', 401);
  }

  await revokeSession(session.tokenHash);
  log.info('session revoked');
  return sessionCleared();
});
