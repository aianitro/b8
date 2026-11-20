import type { NextRequest } from 'next/server';
import { patchMembership } from '@/lib/loyaltyStore';
import { LoyaltyMembershipPatchRequestSchema } from '@b8/contracts/loyalty';
import { answer, bodyOf, callerOf, idFrom, invalid } from '../../loyaltyResponses';

/**
 * `PATCH /api/v1/loyalty/memberships/[id]` — the member number and the tier; `null` clears either.
 * Not the balance: a balance is never edited, only observed again (`…/observations`).
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await callerOf(req);
  if (caller instanceof Response) return caller;
  const id = idFrom((await ctx.params).id);
  if (id === null) return invalid('The id is not valid.');
  const body = await bodyOf(req, LoyaltyMembershipPatchRequestSchema);
  if (!body.ok) return body.response;
  return answer(await patchMembership(id, body.value));
}
