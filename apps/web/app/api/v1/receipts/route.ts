import { NextRequest } from 'next/server';
import type { ApiResponse } from '@b8/contracts/types';
import { checkReceipt } from '@/lib/receipt';
import { readReceipt } from '@/lib/receiptReader';
import { proposedCharge } from '@/lib/domain/receiptMatch';
import { createCapture, getCapture, listCaptures, type CaptureView, type NewCapture } from '@/lib/receiptCaptureStore';
import { viewerOf } from '@/lib/giftViewer';

// Receipts photographed before their charge exists — the list (GET) and a new photo (POST).
//
// Only ever the asker's own: `lib/receiptCaptureStore.ts` scopes every read to them.

const isDay = (s: string | null): s is string => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === s;
};

const refuse = (status: number, code: string, message: string) =>
  Response.json({ success: false, error: { code, message } } satisfies ApiResponse<never>, { status });

export async function GET(req: NextRequest) {
  const viewer = await viewerOf(req);
  return Response.json({ success: true, data: await listCaptures(viewer) } satisfies ApiResponse<CaptureView[]>);
}

/**
 * A new receipt photo. The body is the image itself (shrunk on the phone, as for an attached
 * receipt); `?on=YYYY-MM-DD` is the meal's day on the phone's calendar. The photo is read by the
 * model before answering — a few seconds — and stored as a draft whatever the reading says.
 */
export async function POST(req: NextRequest) {
  const viewer = await viewerOf(req);
  if (viewer === null) return refuse(401, 'UNAUTHENTICATED', 'Sign in to add a receipt.');

  const on = req.nextUrl.searchParams.get('on');
  if (!isDay(on)) return refuse(400, 'INVALID_INPUT', 'on must be a real day, YYYY-MM-DD');

  const bytes = new Uint8Array(await req.arrayBuffer());
  const check = checkReceipt(bytes);
  if (!check.ok) return refuse(check.code === 'TOO_LARGE' ? 413 : 400, 'INVALID_INPUT', check.message);

  const reading = await readReceipt(bytes, check.type);
  const proposed = proposedCharge(reading);
  const id = await createCapture({
    viewer, image: bytes, type: check.type, capturedOn: on, merchant: reading.merchant, readTotal: proposed,
  });
  const capture = await getCapture(viewer, id);
  return Response.json({ success: true, data: { capture: capture!, reading, proposed } } satisfies ApiResponse<NewCapture>);
}
