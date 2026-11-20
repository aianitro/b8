import type { NextRequest } from 'next/server';
import { addObservation } from '@/lib/loyaltyStore';
import { LoyaltyObservationCreateRequestSchema } from '@b8/contracts/loyalty';
import { answer, bodyOf, callerOf, idFrom, invalid } from '../../../loyaltyResponses';

/**
 * `POST /api/v1/loyalty/memberships/[id]/observations` — a new balance reading, the only way a
 * balance changes. Appends one row with source `typed`; a body claiming any other source is refused
 * by the contract schema. Answers with the refreshed membership, whose balance is the CURRENT
 * reading — so an older as-of entered now is stored and leaves the shown balance as it was.
 *
 * Only POST is exported: there is no route that updates or deletes an observation, and Next answers
 * any other method here with 405.
 *
 * The membership view returned carries the card's fee watch (P8-42b): a date derived from a ledger
 * row, never its text or amount, the same for every viewer — so this route is `numeric-only`.
 */export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await callerOf(req);
  if (caller instanceof Response) return caller;
  const id = idFrom((await ctx.params).id);
  if (id === null) return invalid('The id is not valid.');
  const body = await bodyOf(req, LoyaltyObservationCreateRequestSchema);
  if (!body.ok) return body.response;
  return answer(await addObservation(id, body.value), 201);
}
