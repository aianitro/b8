// The browser's side of `/api/v1/receipts`: one function per thing the owner does, each throwing a
// `TransactionEditError` with the route's own words when it refuses.

import { TransactionEditError } from './transactionEdits';
import { shrinkReceipt } from './receiptUpload';
import type { CandidateView, CaptureView, NewCapture } from './receiptCaptureStore';

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!body?.success) throw new TransactionEditError(body?.error?.message ?? fallback);
  return body.data as T;
}

/** Shrink the photo on the phone, send it, and get back the draft with what was read off it. */
export async function captureReceipt(file: File, on: string): Promise<NewCapture> {
  const image = await shrinkReceipt(file);
  const res = await fetch(`/api/v1/receipts?on=${encodeURIComponent(on)}`, {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: image,
  });
  return unwrap<NewCapture>(res, 'Could not save the receipt. Try again.');
}

export type CaptureAction =
  | { action: 'confirm'; merchant: string | null; expected: number; capturedOn: string }
  | { action: 'accept' } | { action: 'reject' } | { action: 'dismiss' }
  | { action: 'link'; transactionId: number };

export async function actOnCapture(id: number, body: CaptureAction): Promise<CaptureView> {
  const res = await fetch(`/api/v1/receipts/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return unwrap<CaptureView>(res, 'That did not work. Try again.');
}

export async function discardCapture(id: number): Promise<void> {
  await unwrap<null>(await fetch(`/api/v1/receipts/${id}`, { method: 'DELETE' }), 'Could not delete the receipt.');
}

export async function captureCandidates(id: number): Promise<CandidateView[]> {
  return unwrap<CandidateView[]>(await fetch(`/api/v1/receipts/${id}/candidates`), 'Could not load charges.');
}

export const captureImageUrl = (id: number) => `/api/v1/receipts/${id}/image`;

export const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/** `2026-03-04` → "Mar 4". Read as UTC, so no zone moves the day. */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}
