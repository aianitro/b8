import { NextRequest } from 'next/server';
import { createGift, listGifts } from '@/lib/giftStore';
import { validateGiftRequest } from '@/lib/domain/giftMatch';
import { failure, giverOf, invalid, ok } from './giftResponses';

/**
 * `POST /api/v1/gifts` — mark an upcoming purchase as a gift for the other person (P7-41b).
 *
 * The giver is always the signed-in user and never in the body. The body is checked by the contract
 * schema (`validateGiftRequest`), then by what only the database knows (`createGift`): a designated
 * gift category, a live recipient, an account the bank sync updates. A refusal never repeats a
 * submitted criterion back.
 */
export async function POST(req: NextRequest) {
  const giver = await giverOf(req);
  if (giver instanceof Response) return giver;
  const body = await req.json().catch(() => undefined);
  const checked = validateGiftRequest(body, giver);
  if (!checked.ok) return invalid(checked.message);
  const result = await createGift(giver, checked.value);
  return result.ok ? ok(result.gift, 201) : failure(result);
}

/**
 * `GET /api/v1/gifts` — the signed-in user's own gifts AS GIVER, newest first. Someone who has
 * marked none — including the recipient of every gift in the database — gets `[]`.
 */
export async function GET(req: NextRequest) {
  const giver = await giverOf(req);
  if (giver instanceof Response) return giver;
  return Response.json({ success: true, data: await listGifts(giver) });
}
