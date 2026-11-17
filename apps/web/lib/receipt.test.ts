import { describe, expect, it } from 'vitest';
import { checkReceipt, MAX_RECEIPT_BYTES, sniffReceiptType } from './receipt';

const bytes = (...b: number[]) => new Uint8Array(b);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50);

describe('sniffReceiptType', () => {
  it('reads the three formats from their magic numbers', () => {
    expect(sniffReceiptType(JPEG)).toBe('image/jpeg');
    expect(sniffReceiptType(PNG)).toBe('image/png');
    expect(sniffReceiptType(WEBP)).toBe('image/webp');
  });

  it('refuses anything else, whatever it might claim to be', () => {
    expect(sniffReceiptType(new TextEncoder().encode('<html><script>'))).toBeNull();
    expect(sniffReceiptType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    // A RIFF container that is not WebP (a WAV file).
    expect(sniffReceiptType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45))).toBeNull();
  });

  it('does not read past a short buffer', () => {
    expect(sniffReceiptType(bytes(0xff, 0xd8))).toBeNull();
    expect(sniffReceiptType(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(sniffReceiptType(bytes())).toBeNull();
  });
});

describe('checkReceipt', () => {
  it('accepts an image and names its type', () => {
    expect(checkReceipt(JPEG)).toEqual({ ok: true, type: 'image/jpeg' });
  });

  it('refuses an empty body', () => {
    expect(checkReceipt(bytes())).toMatchObject({ ok: false, code: 'EMPTY' });
  });

  it('refuses a body over the limit, and accepts one exactly at it', () => {
    const atLimit = new Uint8Array(MAX_RECEIPT_BYTES);
    atLimit.set(JPEG);
    expect(checkReceipt(atLimit)).toMatchObject({ ok: true });
    const over = new Uint8Array(MAX_RECEIPT_BYTES + 1);
    over.set(JPEG);
    expect(checkReceipt(over)).toMatchObject({ ok: false, code: 'TOO_LARGE' });
  });

  it('refuses a body that is not an image', () => {
    expect(checkReceipt(new TextEncoder().encode('hello'))).toMatchObject({ ok: false, code: 'NOT_AN_IMAGE' });
  });
});
