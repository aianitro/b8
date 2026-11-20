import type { NextRequest } from 'next/server';
import { createProgram } from '@/lib/loyaltyStore';
import { LoyaltyProgramCreateRequestSchema } from '@b8/contracts/loyalty';
import { answer, bodyOf, callerOf } from '../loyaltyResponses';

/**
 * `POST /api/v1/loyalty/programs` — a program the seeded catalog lacks. Its normalised name becomes
 * its first alias, in the same transaction; a name another program already answers to is 409
 * `ALIAS_TAKEN` and nothing is created, because one alias naming two programs would make an import
 * label resolve to whichever row a query happened to return.
 */
export async function POST(req: NextRequest) {
  const caller = await callerOf(req);
  if (caller instanceof Response) return caller;
  const body = await bodyOf(req, LoyaltyProgramCreateRequestSchema);
  if (!body.ok) return body.response;
  return answer(await createProgram(body.value), 201);
}
