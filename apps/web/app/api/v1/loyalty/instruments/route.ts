import type { NextRequest } from 'next/server';
import { createInstrument } from '@/lib/loyaltyStore';
import { LoyaltyInstrumentCreateRequestSchema } from '@b8/contracts/loyalty';
import { answer, bodyOf, callerOf } from '../loyaltyResponses';

/**
 * `POST /api/v1/loyalty/instruments` — a certificate, companion fare or travel credit on a
 * membership, written with source `typed`. Every date may be unknown; an expiry or use before the
 * issue date is 400.
 */
export async function POST(req: NextRequest) {
  const caller = await callerOf(req);
  if (caller instanceof Response) return caller;
  const body = await bodyOf(req, LoyaltyInstrumentCreateRequestSchema);
  if (!body.ok) return body.response;
  return answer(await createInstrument(body.value), 201);
}
