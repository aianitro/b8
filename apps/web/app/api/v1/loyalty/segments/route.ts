import type { NextRequest } from 'next/server';
import { saveTypedSegment } from '@/lib/loyaltyFlightStore';
import { LoyaltySegmentCreateRequestSchema } from '@b8/contracts/loyalty';
import { bodyOf, callerOf, failure, ok } from '../loyaltyResponses';

/**
 * `POST /api/v1/loyalty/segments` (P8-42e1b) — add a flight leg by hand (201), or rewrite the one the
 * same membership already holds with the same identity: normalised confirmation code, flight date,
 * carrier and flight number (200). Answers the segment with its code MASKED; no route returns a full
 * code. To correct a wrong date or flight number a person adds the right leg and cancels the wrong
 * one: there is no edit by id and nothing deletes.
 *
 * A WRITE ROUTE: the caller is resolved first (401 with no credential, 403 `INSUFFICIENT_SCOPE` for a
 * read-scope token), before the body is pulled. Then 400 `INVALID_INPUT` for a body the strict
 * contract refuses (any of `source` or `id`, an unknown key, a code that is not 4 to 20 letters or
 * digits, an airport, carrier or flight number of the wrong shape, equal airports, a state other than
 * booked or cancelled), a membership of a program that is not an airline's, or a code already
 * recorded under another membership of the program; 404 `NOT_FOUND` for an unknown membership.
 * Messages never echo the submitted values.
 *
 * `no-transaction-data`: it writes `loyalty_segments` alone and reads no ledger row.
 */
export async function POST(req: NextRequest) {
  const caller = await callerOf(req);
  if (caller instanceof Response) return caller;
  const body = await bodyOf(req, LoyaltySegmentCreateRequestSchema);
  if (!body.ok) return body.response;
  const result = await saveTypedSegment(body.value);
  if (!result.ok) return failure(result);
  return ok(result.value.segment, result.value.created ? 201 : 200);
}
