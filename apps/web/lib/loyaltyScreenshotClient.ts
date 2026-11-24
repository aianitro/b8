// Loyalty, reading a screenshot (P8-42d) — the browser half of "Update from screenshot": shrink the
// picked image, send it to the membership's read route, and hand back the answer or a sentence.
//
// THE RECEIPT PATH, REUSED BY IMPORT. `shrinkReceipt` is the one image encoder in the app: it redraws
// the picture at most 2000 px on the long edge and re-encodes it as JPEG, which also drops the EXIF
// block (the position it was taken at, the device). So the bytes that leave the phone are smaller and
// carry less than the screenshot did, and there is no second encoder here to drift from it.
//
// NOTHING IS KEPT IN THE BROWSER. The Blob lives in this function's scope for the one request and is
// never stored: no state, no storage API, no cache. The body is the Blob itself, sent as
// `image/jpeg`, the way an attached receipt is sent; the route reads the type from the bytes anyway.

import { shrinkReceipt } from '@/lib/receiptUpload';
import type { LoyaltyScreenshotRead } from '@b8/contracts/loyalty';

/** The read route for one membership. */
export const screenshotPath = (membershipId: number) => `/api/v1/loyalty/memberships/${membershipId}/screenshot`;
/** The confirm route for one membership. */
export const screenshotConfirmPath = (membershipId: number) => `${screenshotPath(membershipId)}/confirm`;

export type ScreenshotReadResult = { ok: true; read: LoyaltyScreenshotRead } | { ok: false; message: string };

/**
 * Shrinks `file` and asks the server to read it. Never throws: an image the browser cannot decode,
 * a refusal (with the server's own sentence, which never echoes what was sent) and a network failure
 * all come back as a message, and the form stays usable by hand.
 */
export async function readScreenshot(membershipId: number, file: File): Promise<ScreenshotReadResult> {
  let image: Blob;
  try {
    image = await shrinkReceipt(file);
  } catch {
    return { ok: false, message: 'That file could not be read as an image. Try a JPEG or PNG.' };
  }
  try {
    const res = await fetch(screenshotPath(membershipId), { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: image });
    const data = await res.json().catch(() => null);
    if (data?.success === true && data.data) return { ok: true, read: data.data as LoyaltyScreenshotRead };
    return { ok: false, message: data?.error?.message ?? 'The screenshot could not be sent. Try again.' };
  } catch {
    return { ok: false, message: 'The server could not be reached. Try again.' };
  }
}
