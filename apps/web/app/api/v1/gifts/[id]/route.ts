import { NextRequest } from 'next/server';
import { getGift } from '@/lib/giftStore';
import { giftIdFrom, giverOf, notFound, ok } from '../giftResponses';

/**
 * `GET /api/v1/gifts/[id]` — one gift, to its giver. Anyone else's gift, and an id that does not
 * exist, answer the same 404 body (`notFound`), so a non-giver cannot learn a record exists.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const giver = await giverOf(req);
  if (giver instanceof Response) return giver;
  const id = giftIdFrom((await params).id);
  if (id === null) return notFound();
  const gift = await getGift(giver, id);
  return gift ? ok(gift) : notFound();
}
