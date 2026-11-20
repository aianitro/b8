import type { NextRequest } from 'next/server';
import { createMember } from '@/lib/loyaltyStore';
import { LoyaltyMemberCreateRequestSchema } from '@b8/contracts/loyalty';
import { answer, bodyOf, callerOf } from '../loyaltyResponses';

/**
 * `POST /api/v1/loyalty/members` — a household member: a person who can hold a membership, linked to
 * a b8 user or not. A name equal to another member's ignoring case is 409 `MEMBER_NAME_TAKEN` (the
 * import tells members apart by name, case-folded); a user already linked is `MEMBER_USER_TAKEN`.
 * A read-scope token is refused (403) by `callerOf` before the body is read.
 */
export async function POST(req: NextRequest) {
  const caller = await callerOf(req);
  if (caller instanceof Response) return caller;
  const body = await bodyOf(req, LoyaltyMemberCreateRequestSchema);
  if (!body.ok) return body.response;
  return answer(await createMember(body.value), 201);
}
