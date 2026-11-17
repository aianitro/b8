import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse } from '@b8/contracts/types';
import { checkReceipt } from '@/lib/receipt';
import { giftMaskedSql } from '@/lib/giftReadPath';
import { viewerOf } from '@/lib/giftViewer';
import { giftLockedResponse, giftLockSql, lockedFor } from '@/lib/giftLock';

// A transaction's receipt photo: GET the image, PUT a new one (replacing any), DELETE it.
//
// THE BODY IS THE IMAGE ITSELF, not a multipart form. The phone has already shrunk and re-encoded
// the photo (`lib/receiptUpload.ts`), so there is exactly one file and nothing to name; the bytes'
// own magic number decides the type (`lib/receipt.ts`), never the request's Content-Type.
//
// A RECEIPT IS THE OWNER'S NOTE IN PICTURE FORM, and takes the note's gift lock: while a gift holds
// the row, the giver may attach or remove one and nobody else may, and a non-giver cannot see one —
// a receipt names exactly what was bought, which is the thing a gift hides. Reading it is refused
// with the same 404 as a row that has none, so the refusal says nothing about whether one exists.

const notFound = () =>
  Response.json(
    { success: false, error: { code: 'NOT_FOUND', message: 'No receipt for this transaction' } } satisfies ApiResponse<never>,
    { status: 404 }
  );

const badId = (id: string) => !/^\d+$/.test(id);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (badId(id)) return notFound();
  const viewer = await viewerOf(req);
  const { rows } = await db.query<{ content_type: string; image: Buffer }>(
    `SELECT r.content_type, r.image
       FROM transaction_receipts r JOIN transactions t ON t.id = r.transaction_id
      WHERE r.transaction_id = $1 AND NOT ${giftMaskedSql('t', viewer)}`,
    [id]
  );
  if (rows.length === 0) return notFound();
  const { content_type, image } = rows[0];
  return new Response(new Uint8Array(image), {
    headers: {
      'Content-Type': content_type,
      'Content-Length': String(image.length),
      // Never sniffed into anything but the image type it was stored as, and inert if opened alone.
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      // A financial document: not kept in any shared cache, and re-asked each time the sheet opens,
      // so a replaced or removed receipt does not linger on screen. The service worker already
      // leaves every /api/ response alone.
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (badId(id)) return notFound();

  const viewer = await viewerOf(req);
  if (await lockedFor([Number(id)], 'note', viewer)) return giftLockedResponse();

  const bytes = new Uint8Array(await req.arrayBuffer());
  const check = checkReceipt(bytes);
  if (!check.ok) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: check.message } } satisfies ApiResponse<never>,
      { status: check.code === 'TOO_LARGE' ? 413 : 400 }
    );
  }

  // Written only if the transaction exists and is still not locked — the lock repeated inside the
  // write, as every gift-locked writer does, so a gift that took the row a moment ago still wins.
  const written = await db.query(
    `INSERT INTO transaction_receipts (transaction_id, content_type, image)
     SELECT t.id, $2, $3 FROM transactions t
      WHERE t.id = $1 AND NOT ${giftLockSql('t', 'note', viewer)}
     ON CONFLICT (transaction_id) DO UPDATE
       SET content_type = EXCLUDED.content_type, image = EXCLUDED.image, attached_at = NOW()`,
    [id, check.type, Buffer.from(bytes)]
  );
  if (written.rowCount === 0) {
    return Response.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'No such transaction' } } satisfies ApiResponse<never>,
      { status: 404 }
    );
  }
  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (badId(id)) return notFound();

  const viewer = await viewerOf(req);
  if (await lockedFor([Number(id)], 'note', viewer)) return giftLockedResponse();

  // Removing a receipt that is not there succeeds: the owner's intent, "no receipt", already holds.
  await db.query(
    `DELETE FROM transaction_receipts r USING transactions t
      WHERE r.transaction_id = t.id AND t.id = $1 AND NOT ${giftLockSql('t', 'note', viewer)}`,
    [id]
  );
  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}
