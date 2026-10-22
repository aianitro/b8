import { NextRequest } from 'next/server';
import { listAttachCandidates } from '@/lib/giftStore';
import { failure, giftIdFrom, giverOf, notFound } from '../../giftResponses';

/**
 * `GET /api/v1/gifts/[id]/candidates` — the unlinked outflows the giver could attach to their own
 * waiting gift (P7-41c): the gift's amount, merchant and account criteria with the window ignored,
 * newest first, at most fifty (`listAttachCandidates`).
 *
 * Fetched by the browser when the giver asks, never rendered into a page: the rows carry real
 * ledger text, and only the giver may receive them. Anyone else's gift, an unknown id and a
 * malformed one answer the same 404 body (`notFound`), so the list cannot show a non-giver that a
 * gift exists. The giver's own closed gift answers 409, not `[]` (SPEC.md Open question 5).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const giver = await giverOf(req);
  if (giver instanceof Response) return giver;
  const id = giftIdFrom((await params).id);
  if (id === null) return notFound();
  const result = await listAttachCandidates(giver, id);
  return result.ok ? Response.json({ success: true, data: result.candidates }) : failure(result);
}
