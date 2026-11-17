import { NextRequest } from 'next/server';
import type { ApiResponse } from '@b8/contracts/types';
import { viewerOf } from '@/lib/giftViewer';
import { candidatesFor, type CandidateView } from '@/lib/receiptCaptureStore';

/**
 * The charges near a capture's day that the owner could pick as its charge by hand — read as the
 * asker through the read path, never a row masked for them. Another person's capture answers 404.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await viewerOf(req);
  const found = viewer !== null && /^\d+$/.test(id) ? await candidatesFor(viewer, Number(id)) : null;
  if (found === null) {
    return Response.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'No such receipt.' } } satisfies ApiResponse<never>,
      { status: 404 }
    );
  }
  return Response.json({ success: true, data: found } satisfies ApiResponse<CandidateView[]>);
}
