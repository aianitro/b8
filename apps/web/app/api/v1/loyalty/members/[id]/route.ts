import type { NextRequest } from 'next/server';
import { patchMember } from '@/lib/loyaltyStore';
import { LoyaltyMemberPatchRequestSchema } from '@b8/contracts/loyalty';
import { answer, bodyOf, callerOf, idFrom, invalid } from '../../loyaltyResponses';

/**
 * `PATCH /api/v1/loyalty/members/[id]` — rename a member, or link or unlink (`userId: null`) a b8
 * user. A field absent from the body is left as it is. There is no DELETE: removing a person with a
 * balance history is out of scope for this step.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await callerOf(req);
  if (caller instanceof Response) return caller;
  const id = idFrom((await ctx.params).id);
  if (id === null) return invalid('The id is not valid.');
  const body = await bodyOf(req, LoyaltyMemberPatchRequestSchema);
  if (!body.ok) return body.response;
  return answer(await patchMember(id, body.value));
}
