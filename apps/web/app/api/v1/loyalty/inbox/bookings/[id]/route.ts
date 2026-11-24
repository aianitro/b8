import type { NextRequest } from 'next/server';
import { resolveBooking } from '@/lib/loyaltyBookingRead';
import { LoyaltyBookingResolveRequestSchema } from '@b8/contracts/loyalty';
import { answer, bodyOf, callerOf, idFrom, invalid } from '../../../loyaltyResponses';

/**
 * `POST /api/v1/loyalty/inbox/bookings/[id]` (P8-42e1) — one tap on one held hotel booking: `place`
 * (with the `membershipId` of a membership of the item's program), `not_mine` or `ignore`. Answers
 * `{ id, state }`.
 *
 * A WRITE ROUTE: the caller is resolved first (401 with no credential, 403 `INSUFFICIENT_SCOPE` for a
 * read-scope token), before the id or the body is looked at. Then 400 `INVALID_INPUT` for a
 * malformed id or body, or a membership of another program; 404 `NOT_FOUND` for an unknown id; 409
 * `ITEM_RESOLVED` for an item that is no longer held, which is also what the second of two
 * simultaneous taps gets, so two taps make one stay. Messages never echo the submitted values.
 *
 * `no-transaction-data`: a place writes one stay and the item's row; nothing here touches the ledger.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await callerOf(req);
  if (caller instanceof Response) return caller;
  const id = idFrom((await ctx.params).id);
  if (id === null) return invalid('The id is not valid.');
  const body = await bodyOf(req, LoyaltyBookingResolveRequestSchema);
  if (!body.ok) return body.response;
  return answer(await resolveBooking(id, body.value));
}
