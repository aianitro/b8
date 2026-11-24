import type { NextRequest } from 'next/server';
import { saveTypedStay } from '@/lib/loyaltyBookingStore';
import { LoyaltyStayCreateRequestSchema } from '@b8/contracts/loyalty';
import { bodyOf, callerOf, failure, ok } from '../loyaltyResponses';

/**
 * `POST /api/v1/loyalty/stays` (P8-42e1) — add a hotel stay by hand (201), or correct the one the same
 * membership already holds under the same normalised confirmation code (200). Answers the stay with
 * its code MASKED; no route returns a full code.
 *
 * A WRITE ROUTE: the caller is resolved first (401 with no credential, 403 `INSUFFICIENT_SCOPE` for a
 * read-scope token), before the body is pulled. Then 400 `INVALID_INPUT` for a body the strict
 * contract refuses (any of `source`, `nights` or `id`, an unknown key, a code that is not 4 to 20
 * letters or digits, dates out of order or beyond the night limit), a membership of a program that
 * is not a hotel's, or a code already recorded under another membership of the program; 404
 * `NOT_FOUND` for an unknown membership. Messages never echo the submitted values.
 *
 * `no-transaction-data`: it writes `loyalty_stays` alone and reads no ledger row.
 */
export async function POST(req: NextRequest) {
  const caller = await callerOf(req);
  if (caller instanceof Response) return caller;
  const body = await bodyOf(req, LoyaltyStayCreateRequestSchema);
  if (!body.ok) return body.response;
  const result = await saveTypedStay(body.value);
  if (!result.ok) return failure(result);
  return ok(result.value.stay, result.value.created ? 201 : 200);
}
