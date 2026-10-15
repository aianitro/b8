// `GET /api/v1/auth/me` — who the session belongs to (P7-41a).
//
// BEHIND THE BOUNDARY, NOT IN `PRE_AUTH_PATHS`. An unauthenticated request never reaches this
// handler; `proxy.ts` answers it 401. The handler resolves the session again anyway, for the reason
// every auth handler does (`sessionFrom` in ../shared.ts): a header the proxy set is a header a
// caller can send.
//
// A GET, SO A READ-ONLY PERSONAL TOKEN MAY CALL IT, and that is intended: a script asking "which
// user am I running as" is reading, and the answer carries nothing but a name and a flag.
//
// THERE IS NO PARTIAL ANSWER. A session whose user cannot be found is refused, never answered with
// a null user and never answered as the owner. `MeSchema` has no nullable field for that reason,
// and `components/Sidebar.tsx` renders nothing at all when this fails.

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { findUser } from '@/lib/users';
import { MeResponseSchema } from '@b8/contracts/auth';
import { authError, sessionFrom, withEnvelope } from '../shared';

// Per-request by construction (it reads the cookie), stated anyway so a future caching default
// cannot serve one person's name to the other.
export const dynamic = 'force-dynamic';

export const GET = withEnvelope(async (request: NextRequest) => {
  const session = await sessionFrom(request);
  if (!session) return authError('UNAUTHENTICATED', 'Sign in to see who you are signed in as.', 401);

  const user = await findUser(session.userId);
  if (!user) return authError('UNAUTHENTICATED', 'Sign in to see who you are signed in as.', 401);

  // PARSE TO REFUSE: a display name the contract would not accept fails here, loudly, rather than
  // reaching the sidebar.
  const body = MeResponseSchema.parse({
    success: true,
    data: { userId: user.id, displayName: user.displayName, isOwner: user.isOwner },
  });
  return NextResponse.json(body);
});
