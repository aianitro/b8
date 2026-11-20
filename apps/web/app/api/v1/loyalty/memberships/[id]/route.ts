import type { NextRequest } from 'next/server';
import { patchMembership } from '@/lib/loyaltyStore';
import { LoyaltyMembershipPatchRequestSchema } from '@b8/contracts/loyalty';
import { answer, bodyOf, callerOf, idFrom, invalid } from '../../loyaltyResponses';

/**
 * `PATCH /api/v1/loyalty/memberships/[id]` — the member number and the tier; `null` clears either.
 * Not the balance: a balance is never edited, only observed again (`…/observations`).
 *
 * P8-42b: also the card link and its annual benefit. `cardAccountId` links a credit card (an unknown
 * account or one of another type is 400 `INVALID_INPUT`; a card another membership holds is 409
 * `CARD_ALREADY_LINKED`) and `null` unlinks, leaving instruments and the benefit as they are.
 * `benefit` without `windowDays` is stored with the default window. `patchMembership` enforces both,
 * in one transaction with the write. No new route: the link is a field of this membership.
 *
 * The answer is the membership view, whose `feeWatch` carries a date derived from a ledger row —
 * never its text, its amount or anything that differs by viewer — so this route is `numeric-only`.
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
