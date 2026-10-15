// `POST /api/v1/auth/invitations` — the owner mints a single-use code for a second person (P7-41a).
//
// OWNER-ONLY, AND ONLY FROM A BROWSER. The owner's decision at G0, enforced by `ownerSessionFrom`:
// a personal token of any scope, the second user's session, and no session are all refused, and
// none of them writes a row. The second user is a peer over the ledger, not over who may sign in.
//
// THE RAW CODE IS IN THIS RESPONSE AND NOWHERE ELSE. Not in the database (it holds the SHA-256), not
// in a log line, and not in any later response — there is no endpoint that lists or re-reads
// invitations, so a lost code is replaced by minting another. `Cache-Control: no-store` so no
// intermediary or browser cache keeps a copy of the one response that carries it.
//
// BEHIND THE BOUNDARY, NOT IN `PRE_AUTH_PATHS`: minting needs a session, so nothing about this
// endpoint needs to be reachable before one exists. Redemption is the pre-auth half, and it rides
// the two existing `register/*` endpoints rather than adding a path.

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createInvitation } from '@/lib/invitations';
import { createLogger } from '@/lib/logger';
import { InvitationCreateRequestSchema, InvitationCreatedResponseSchema } from '@b8/contracts/auth';
import { authError, ownerSessionFrom, withEnvelope } from '../shared';

const log = createLogger('auth');

export const dynamic = 'force-dynamic';

export const POST = withEnvelope(async (request: NextRequest) => {
  // AUTHORITY FIRST, before the body is even read, so a refused caller learns nothing about what a
  // valid body looks like and no code path below can run for them.
  const owner = await ownerSessionFrom(request);
  if (!owner.ok) return owner.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return authError('INVALID_INPUT', 'The request body is not JSON.', 400);
  }

  // Strict, and not trimmed: an empty name, a name over 60 characters, or a stray key is refused
  // rather than reshaped into something the owner did not type.
  const parsed = InvitationCreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return authError('INVALID_INPUT', 'A display name of 1 to 60 characters is required.', 400);
  }

  const created = await createInvitation({ createdBy: owner.user.id, displayName: parsed.data.displayName });
  // The fact, never the code and never the name.
  log.info('invitation created');

  const response = NextResponse.json(InvitationCreatedResponseSchema.parse({ success: true, data: created }));
  response.headers.set('Cache-Control', 'no-store');
  return response;
});
