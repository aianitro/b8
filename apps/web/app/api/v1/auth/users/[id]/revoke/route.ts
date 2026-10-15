// `POST /api/v1/auth/users/[id]/revoke` — the owner removes the second user (P7-41a).
//
// OWNER-ONLY, AND ONLY FROM A BROWSER, by the same `ownerSessionFrom` the invitation endpoint uses.
// No body: the user is named by the path, and the outcome is a state change the caller already
// asked for, so the success envelope carries `data: null` (`UserRevokedResponseSchema`).
//
// WHAT REMOVAL DOES is `revokeUser`'s, in one transaction: the user's passkeys are deleted (which
// takes their sessions and personal tokens with them), their push devices are revoked, and the
// `users` row stays, with `revoked_at` set, so the proposals they decided still name them.
//
// REFUSED WITH NOTHING CHANGED: the owner as the target (400 — the owner cannot be removed, and the
// database's `users_owner_not_revoked` would refuse it anyway), an id that is not a positive
// integer (400), and an id that names nobody (404).

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { revokeUser } from '@/lib/users';
import { UserIdSchema, UserRevokedResponseSchema } from '@b8/contracts/auth';
import { authError, ownerSessionFrom, withEnvelope } from '../../../shared';

const log = createLogger('auth');

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // `withEnvelope` is typed for single-argument handlers; the dynamic segment is read first and
  // closed over, so a throw below still reaches the client as an envelope rather than an empty 500.
  return withEnvelope(async (req: NextRequest) => {
    const owner = await ownerSessionFrom(req);
    if (!owner.ok) return owner.response;

    // A path segment is text. `Number('2abc')` is NaN and `Number('')` is 0, and both are refused by
    // the contract's own id schema rather than by a hand-written check that could disagree with it.
    const target = UserIdSchema.safeParse(/^\d+$/.test(id) ? Number(id) : NaN);
    if (!target.success) return authError('INVALID_INPUT', 'That is not a user id.', 400);

    const outcome = await revokeUser(target.data);
    if (outcome === 'not-found') return authError('NOT_FOUND', 'No such user.', 404);
    if (outcome === 'owner') return authError('INVALID_INPUT', 'The owner cannot be removed.', 400);

    log.info('user removed');
    return NextResponse.json(UserRevokedResponseSchema.parse({ success: true, data: null }));
  })(request);
}
