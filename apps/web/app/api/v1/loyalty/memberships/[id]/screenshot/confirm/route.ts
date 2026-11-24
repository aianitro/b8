import type { NextRequest } from 'next/server';
import { addScreenshotObservation } from '@/lib/loyaltyStore';
import { LoyaltyScreenshotConfirmRequestSchema } from '@b8/contracts/loyalty';
import { answer, bodyOf, callerOf, idFrom, invalid } from '../../../../loyaltyResponses';

/**
 * `POST /api/v1/loyalty/memberships/[id]/screenshot/confirm` (P8-42d) — the one tap that saves what
 * a screenshot read proposed, after the person has seen and possibly corrected it. Appends one
 * observation whose source the STORE sets to `screenshot`; the strict body has no `source` key, so a
 * client never picks provenance, and the typed route keeps refusing `screenshot`.
 *
 * STATELESS ON PURPOSE. Nothing of the read was kept (no image, no proposal), so there is nothing to
 * check the body against: a disagreement shown in the form never blocks here (SPEC.md D2), and the
 * rules are the typed path's (the unit's balance rule, at most one day after Postgres's CURRENT_DATE).
 * Whether the new row becomes current is the shared reducer's answer, which the form states before
 * the tap.
 *
 * The caller is resolved first, then the id, then the body, so a refused request writes nothing. Answers
 * the refreshed membership view, which carries the card's fee-watch date like every membership-view
 * route: `numeric-only`.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await callerOf(req);
  if (caller instanceof Response) return caller;
  const id = idFrom((await ctx.params).id);
  if (id === null) return invalid('The id is not valid.');
  const body = await bodyOf(req, LoyaltyScreenshotConfirmRequestSchema);
  if (!body.ok) return body.response;
  return answer(await addScreenshotObservation(id, body.value), 201);
}
