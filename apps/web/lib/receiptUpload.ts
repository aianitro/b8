// Attaching a receipt photo from the browser: shrink it, then send it.
//
// SHRUNK ON THE PHONE, BEFORE IT LEAVES. A camera photo is several megabytes and twelve megapixels,
// far more than a receipt needs to stay legible, and every byte of it lands in the database and so
// in every nightly backup. Redrawn to at most 2000 px on the long edge and re-encoded as JPEG, a
// receipt comes out at a few hundred kilobytes and its print is still sharp.
//
// RE-ENCODING ALSO STRIPS THE METADATA. A canvas carries pixels only, so the photo's EXIF — the GPS
// position it was taken at, the device — does not reach the server. `createImageBitmap` applies the
// EXIF orientation before the redraw, so a portrait shot is not stored on its side.
//
// Browser-only: it needs `createImageBitmap` and a canvas.

import { TransactionEditError } from './transactionEdits';

const LONG_EDGE = 2000;
/** Under the route's 4 MiB bound with room to spare; a second, lower-quality pass if a first lands over it. */
const TARGET_BYTES = 3 * 1024 * 1024;

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality));
}

/** The photo, redrawn small and re-encoded as JPEG. Throws a readable error when it cannot be read. */
export async function shrinkReceipt(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Most often a HEIC file on a browser that cannot decode one. iOS Safari converts on pick.
    throw new TransactionEditError('That file could not be read as an image. Try a JPEG or PNG.');
  }
  const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new TransactionEditError('This browser cannot prepare the image.');
  // White under any transparency: JPEG has no alpha, and a transparent PNG would otherwise go black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const first = await toJpeg(canvas, 0.82);
  return first.size <= TARGET_BYTES ? first : toJpeg(canvas, 0.6);
}

export const receiptUrl = (id: number) => `/api/v1/transactions/${id}/receipt`;

async function send(id: number, init: RequestInit, fallback: string): Promise<void> {
  const res = await fetch(receiptUrl(id), init);
  const data = await res.json().catch(() => null);
  if (!data?.success) throw new TransactionEditError(data?.error?.message ?? fallback);
}

/** Shrink and attach a photo, replacing any receipt already there. */
export async function attachReceipt(id: number, file: File): Promise<void> {
  const image = await shrinkReceipt(file);
  await send(id, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: image }, 'Could not attach the receipt. Try again.');
}

export const removeReceipt = (id: number) =>
  send(id, { method: 'DELETE' }, 'Could not remove the receipt. Try again.');
