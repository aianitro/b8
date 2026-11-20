import type { NextRequest } from 'next/server';
import { patchInstrument } from '@/lib/loyaltyStore';
import { LoyaltyInstrumentPatchRequestSchema } from '@b8/contracts/loyalty';
import { answer, bodyOf, callerOf, idFrom, invalid } from '../../loyaltyResponses';

/**
 * `PATCH /api/v1/loyalty/instruments/[id]` — kind, description and the three dates; `null` clears a
 * date. The date order is enforced on the row as it would be stored, not only on the body, so a
 * PATCH that moves the issue date past a stored expiry is the same 400.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await callerOf(req);
  if (caller instanceof Response) return caller;
  const id = idFrom((await ctx.params).id);
  if (id === null) return invalid('The id is not valid.');
  const body = await bodyOf(req, LoyaltyInstrumentPatchRequestSchema);
  if (!body.ok) return body.response;
  return answer(await patchInstrument(id, body.value));
}
