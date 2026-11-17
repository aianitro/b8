import { NextRequest } from 'next/server';
import type { ApiResponse } from '@b8/contracts/types';
import { viewerOf } from '@/lib/giftViewer';
import {
  acknowledgeCapture, confirmCapture, deleteCapture, dismissCapture, getCapture, linkByHand, rejectLink, type CaptureView,
} from '@/lib/receiptCaptureStore';

// One receipt capture: what the owner does with it.
//
//   { action: 'confirm', merchant, expected, capturedOn }  start (or correct) the wait
//   { action: 'accept' }                                   a mismatch is the charge after all
//   { action: 'reject' }                                   a mismatch is not this receipt's charge
//   { action: 'dismiss' }                                  stop waiting: paid in cash, never charged
//   { action: 'link', transactionId }                      this is the charge, picked by hand
//
// Each answers with the capture as it now stands. Another person's capture answers 404, the same
// as one that does not exist.

const refuse = (status: number, code: string, message: string) =>
  Response.json({ success: false, error: { code, message } } satisfies ApiResponse<never>, { status });

const notFound = () => refuse(404, 'NOT_FOUND', 'No such receipt.');

const isDay = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === s;
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const viewer = await viewerOf(req);
  if (viewer === null || !/^\d+$/.test(raw)) return notFound();
  const id = Number(raw);
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const action = body?.action;

  let outcome;
  if (action === 'confirm') {
    const expected = Number(body?.expected);
    // Cents, positive, and short of absurd. Typed by a person, so said back in words when wrong.
    if (!Number.isFinite(expected) || expected <= 0 || expected >= 1_000_000 || Math.round(expected * 100) !== expected * 100) {
      return refuse(400, 'INVALID_INPUT', 'The expected charge must be a positive amount in dollars and cents.');
    }
    if (!isDay(body?.capturedOn)) return refuse(400, 'INVALID_INPUT', 'capturedOn must be a real day, YYYY-MM-DD');
    const merchantText = typeof body?.merchant === 'string' ? body.merchant.replace(/\s+/g, ' ').trim() : '';
    if (merchantText.length > 200) return refuse(400, 'INVALID_INPUT', 'The merchant name is too long.');
    outcome = await confirmCapture(viewer, id, {
      merchant: merchantText === '' ? null : merchantText, expected, capturedOn: body.capturedOn as string,
    });
  } else if (action === 'accept') {
    outcome = await acknowledgeCapture(viewer, id);
  } else if (action === 'reject') {
    outcome = await rejectLink(viewer, id);
  } else if (action === 'dismiss') {
    outcome = await dismissCapture(viewer, id);
  } else if (action === 'link') {
    const transactionId = Number(body?.transactionId);
    if (!Number.isSafeInteger(transactionId) || transactionId <= 0) return refuse(400, 'INVALID_INPUT', 'transactionId must be a transaction id');
    outcome = await linkByHand(viewer, id, transactionId);
  } else {
    return refuse(400, 'INVALID_INPUT', 'action must be confirm, accept, reject, dismiss or link');
  }

  if (!outcome.ok) return refuse(outcome.status, outcome.status === 404 ? 'NOT_FOUND' : 'CONFLICT', outcome.message);
  const capture = await getCapture(viewer, id);
  return capture ? Response.json({ success: true, data: capture } satisfies ApiResponse<CaptureView>) : notFound();
}

/** Throw the capture away. A photo already attached to a transaction stays there. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const viewer = await viewerOf(req);
  if (viewer === null || !/^\d+$/.test(raw)) return notFound();
  const outcome = await deleteCapture(viewer, Number(raw));
  return outcome.ok ? Response.json({ success: true, data: null } satisfies ApiResponse<null>) : notFound();
}
