import type { NextRequest } from 'next/server';
import { resolveReading } from '@/lib/loyaltyInboxRead';
import { LoyaltyInboxResolveRequestSchema } from '@b8/contracts/loyalty';
import { answer, bodyOf, callerOf, idFrom, invalid } from '../../../loyaltyResponses';

/**
 * `POST /api/v1/loyalty/inbox/readings/[id]` (P8-42c2) — one tap on one queued reading: `apply`
 * (with `membershipId` when the item has no unique match), `not_mine` or `ignore`. Answers
 * `{ id, state }`.
 *
 * A WRITE ROUTE: the caller is resolved first (401 with no credential, 403 `INSUFFICIENT_SCOPE` for a
 * read-scope token), before the id or the body is looked at. Then 400 `INVALID_INPUT` for a malformed
 * id or body, a membership of another program or an as-of more than a day ahead; 404 `NOT_FOUND`
 * for an unknown id; 409 `ITEM_RESOLVED` for an item that is not waiting (already resolved, or never
 * a queue item), which is also what the second of two simultaneous taps gets. Messages never echo
 * the submitted values.
 *
 * `no-transaction-data`: an apply appends one `email` observation; nothing here touches the ledger.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await callerOf(req);
  if (caller instanceof Response) return caller;
  const id = idFrom((await ctx.params).id);
  if (id === null) return invalid('The id is not valid.');
  const body = await bodyOf(req, LoyaltyInboxResolveRequestSchema);
  if (!body.ok) return body.response;
  return answer(await resolveReading(id, body.value));
}
