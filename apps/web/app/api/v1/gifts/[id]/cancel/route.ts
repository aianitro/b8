import { NextRequest } from 'next/server';
import { cancelGift } from '@/lib/giftStore';
import { failure, giftIdFrom, giverOf, notFound, ok } from '../../giftResponses';

/**
 * `POST /api/v1/gifts/[id]/cancel` — the giver withdraws a gift. Every row it holds is restored and
 * released, which unmasks it for the recipient at once: the one deliberate way to reveal early.
 * No body; any body is ignored.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const giver = await giverOf(req);
  if (giver instanceof Response) return giver;
  const id = giftIdFrom((await params).id);
  if (id === null) return notFound();
  const result = await cancelGift(giver, id);
  return result.ok ? ok(result.gift) : failure(result);
}
