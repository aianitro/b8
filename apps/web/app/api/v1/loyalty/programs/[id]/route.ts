import type { NextRequest } from 'next/server';
import { patchProgram } from '@/lib/loyaltyStore';
import { LoyaltyProgramPatchRequestSchema } from '@b8/contracts/loyalty';
import { answer, bodyOf, callerOf, idFrom, invalid } from '../../loyaltyResponses';

/**
 * `PATCH /api/v1/loyalty/programs/[id]` — the program's name, kind, default unit, and its aliases.
 * `aliases` is the COMPLETE new list, applied atomically: a collision with another program's alias
 * is 409 and leaves the old list exactly as it was. This is how the owner makes an unresolved sheet
 * label resolve — by adding the spelling as data, never by loosening the matcher.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await callerOf(req);
  if (caller instanceof Response) return caller;
  const id = idFrom((await ctx.params).id);
  if (id === null) return invalid('The id is not valid.');
  const body = await bodyOf(req, LoyaltyProgramPatchRequestSchema);
  if (!body.ok) return body.response;
  return answer(await patchProgram(id, body.value));
}
