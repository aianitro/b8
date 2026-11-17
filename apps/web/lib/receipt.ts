// A receipt photo's bytes, as the route accepts them.
//
// THE BYTES SAY WHAT THEY ARE, NOT THE HEADER. The stored type is served back as the image's
// Content-Type, so it is read from the file's magic number and the request's Content-Type is not
// trusted at all: a body that claims `image/jpeg` and is HTML would otherwise be stored as a JPEG
// and, without `nosniff`, rendered by a browser as a page on this origin. Three formats and no
// others — the ones a browser draws as an inert image. SVG is deliberately absent: it is a document
// that can carry script.
//
// PURE, so the unit suite reaches it without a database.

/** The size bound the table's CHECK enforces, 4 MiB. The phone sends far less. */
export const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;

export type ReceiptType = 'image/jpeg' | 'image/png' | 'image/webp';

/** What the bytes are, by their magic number; null for anything that is not one of the three. */
export function sniffReceiptType(bytes: Uint8Array): ReceiptType | null {
  const at = (i: number, ...expected: number[]) => expected.every((b, k) => bytes[i + k] === b);
  if (bytes.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (bytes.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  // RIFF....WEBP
  if (bytes.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

export type ReceiptCheck =
  | { ok: true; type: ReceiptType }
  | { ok: false; code: 'EMPTY' | 'TOO_LARGE' | 'NOT_AN_IMAGE'; message: string };

/** Whether an upload may be stored, and as what. */
export function checkReceipt(bytes: Uint8Array): ReceiptCheck {
  if (bytes.length === 0) return { ok: false, code: 'EMPTY', message: 'No image was sent.' };
  if (bytes.length > MAX_RECEIPT_BYTES) {
    return { ok: false, code: 'TOO_LARGE', message: 'That image is too large. The limit is 4 MB.' };
  }
  const type = sniffReceiptType(bytes);
  return type === null
    ? { ok: false, code: 'NOT_AN_IMAGE', message: 'Only JPEG, PNG or WebP images can be attached.' }
    : { ok: true, type };
}
