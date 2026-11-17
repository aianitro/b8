import { NextRequest } from 'next/server';
import type { ApiResponse } from '@b8/contracts/types';
import { viewerOf } from '@/lib/giftViewer';
import { captureImage } from '@/lib/receiptCaptureStore';

/**
 * A capture's photo, to its own photographer only; anyone else gets the 404 a missing one gets.
 * Served with the same inert headers as an attached receipt (`transactions/[id]/receipt`).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await viewerOf(req);
  const found = /^\d+$/.test(id) ? await captureImage(viewer, Number(id)) : null;
  if (!found) {
    return Response.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'No such receipt.' } } satisfies ApiResponse<never>,
      { status: 404 }
    );
  }
  return new Response(new Uint8Array(found.image), {
    headers: {
      'Content-Type': found.type,
      'Content-Length': String(found.image.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    },
  });
}
