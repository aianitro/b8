import { NextRequest } from 'next/server';
import { GiftChooseRequestSchema } from '@b8/contracts/gifts';
import { chooseGift } from '@/lib/giftStore';
import { failure, giftIdFrom, giverOf, invalid, notFound, ok } from '../../giftResponses';

/**
 * `POST /api/v1/gifts/[id]/choose` — the giver says which of several candidates is the gift. The
 * others are restored exactly and released in the same transaction (`chooseGift`).
 *
 * The id is resolved BEFORE the body is judged, so a non-giver sending a malformed body still gets
 * the 404 a missing gift gets, rather than a 400 that would confirm the id is worth asking about.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const giver = await giverOf(req);
  if (giver instanceof Response) return giver;
  const id = giftIdFrom((await params).id);
  if (id === null) return notFound();
  const parsed = GiftChooseRequestSchema.safeParse(await req.json().catch(() => undefined));
  const result = await chooseGift(giver, id, parsed.success ? parsed.data.transactionId : -1);
  if (!result.ok && result.code === 'INVALID_INPUT' && !parsed.success) {
    return invalid('Say which candidate is the gift.');
  }
  return result.ok ? ok(result.gift) : failure(result);
}
