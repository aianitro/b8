import { NextRequest } from 'next/server';
import { GiftAttachRequestSchema } from '@b8/contracts/gifts';
import { ATTACH_REFUSED_MESSAGE, attachToGift, ownsGift } from '@/lib/giftStore';
import { failure, giftIdFrom, giverOf, invalid, notFound, ok } from '../../giftResponses';

/**
 * `POST /api/v1/gifts/[id]/attach` — the giver names a row already in the ledger as their waiting
 * gift (P7-41c). It is linked, filed and masked exactly as the sync would have done it, in one
 * transaction that re-checks the row and the gift under lock (`attachToGift`).
 *
 * WHO FIRST, THEN WHAT. Whether the gift is the signed-in person's is settled before the body is
 * read, so a non-giver — with a valid body, a malformed one, or the id of a real row — gets the
 * 404 a missing gift gets, never a 400 that would say the id is worth asking about. A read-only
 * token is refused by `giverOf` (403) before anything else. Every row that cannot be attached, and
 * a body that does not parse, answer one fixed 400 that says nothing about the row.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const giver = await giverOf(req);
  if (giver instanceof Response) return giver;
  const id = giftIdFrom((await params).id);
  if (id === null || !(await ownsGift(giver, id))) return notFound();
  const parsed = GiftAttachRequestSchema.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return invalid(ATTACH_REFUSED_MESSAGE);
  const result = await attachToGift(giver, id, parsed.data.transactionId);
  return result.ok ? ok(result.gift) : failure(result);
}
