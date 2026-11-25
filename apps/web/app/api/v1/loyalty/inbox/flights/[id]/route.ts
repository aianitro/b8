import type { NextRequest } from 'next/server';
import { resolveFlight } from '@/lib/loyaltyFlightRead';
import { LoyaltyBookingResolveRequestSchema } from '@b8/contracts/loyalty';
import { answer, bodyOf, callerOf, idFrom, invalid } from '../../../loyaltyResponses';

/**
 * `POST /api/v1/loyalty/inbox/flights/[id]` (P8-42e1b) — one tap on one held flight booking: `place`
 * (with the `membershipId` of a membership of the item's program), `not_mine` or `ignore`. The same
 * body and answer as the held hotel bookings' route; the item lives in the flight read's own table.
 * Answers `{ id, state }`.
 *
 * A WRITE ROUTE: the caller is resolved first (401 with no credential, 403 `INSUFFICIENT_SCOPE` for a
 * read-scope token), before the id or the body is looked at. Then 400 `INVALID_INPUT` for a
 * malformed id or body, or a membership of another program; 404 `NOT_FOUND` for an unknown id; 409
 * `ITEM_RESOLVED` for an item that is no longer held, which is also what the second of two
 * simultaneous taps gets, so two taps make one set of segments. Messages never echo the submitted
 * values.
 *
 * `no-transaction-data`: a place writes segments and the item's row; nothing here touches the ledger.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await callerOf(req);
  if (caller instanceof Response) return caller;
  const id = idFrom((await ctx.params).id);
  if (id === null) return invalid('The id is not valid.');
  const body = await bodyOf(req, LoyaltyBookingResolveRequestSchema);
  if (!body.ok) return body.response;
  return answer(await resolveFlight(id, body.value));
}
