import type { NextRequest } from 'next/server';
import { loadOverview } from '@/lib/loyaltyStore';
import { callerOf, ok } from './loyaltyResponses';

/**
 * `GET /api/v1/loyalty` — the whole loyalty picture (P8-42a): members, the catalog with its aliases,
 * one card per program that has a membership, and the instruments in the page's order. Member
 * numbers are masked; the full one is only ever served by `memberships/[id]/member-number`.
 *
 * Open to a read-scope token, as every GET is: it changes nothing and carries nothing a read token
 * may not see. The same answer for both b8 users — they are peers over these rows.
 */
export async function GET(req: NextRequest) {
  const caller = await callerOf(req);
  if (caller instanceof Response) return caller;
  return ok(await loadOverview());
}
