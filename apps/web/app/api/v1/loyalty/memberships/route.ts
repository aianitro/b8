import type { NextRequest } from 'next/server';
import { createMembership } from '@/lib/loyaltyStore';
import { LoyaltyMembershipCreateRequestSchema } from '@b8/contracts/loyalty';
import { answer, bodyOf, callerOf } from '../loyaltyResponses';

/**
 * `POST /api/v1/loyalty/memberships` — a member in a program, with an optional member number and
 * tier. The answer carries the number MASKED; the full value is stored and only the copy route
 * returns it. One membership per (member, program): the unique constraint decides, so two
 * concurrent creates give one 201 and one 409, never a 500.
 */
export async function POST(req: NextRequest) {
  const caller = await callerOf(req);
  if (caller instanceof Response) return caller;
  const body = await bodyOf(req, LoyaltyMembershipCreateRequestSchema);
  if (!body.ok) return body.response;
  return answer(await createMembership(body.value), 201);
}
