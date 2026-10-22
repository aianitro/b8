// Gifts (P7-41b) — what the gift endpoints answer, stated once so they cannot drift. Five in P7-41b;
// P7-41c added `candidates` and `attach`, which answer through the same functions.
//
// NOT A ROUTE. Next treats only `route.ts` as an endpoint; this file adds none.
//
// ─── NOT_FOUND IS ONE BODY, BYTE FOR BYTE ──────────────────────────────────────────────────────
//
// `GET`, `choose`, `cancel`, `candidates` and `attach` on someone else's gift answer exactly what an
// id that does not exist answers: the same status, the same code, the same message, built by the
// same function. A 403, or a message that differed by a word, would tell the recipient that a gift
// record exists — which is most of the secret.
//
// ─── WHO IS ASKING ────────────────────────────────────────────────────────────────────────────
//
// `authorize` is the boundary's own function. The boundary has already run it on every request that
// reaches a handler in production; running it again here costs one lookup and means a handler
// called directly (as the integration fixtures do) refuses exactly what the boundary would, with
// the same 401 / 403 split — a read-only token creating a gift is a 403, not a write.

import type { NextRequest } from 'next/server';
import { authorize } from '@/lib/requestAuth';
import type { Gift } from '@b8/contracts/gifts';
import type { GiftFailure } from '@/lib/giftStore';

const STATUS: Record<GiftFailure['code'], number> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  NO_RECIPIENT: 409,
  GIFT_CATEGORY_UNSET: 409,
  ALREADY_RESOLVED: 409,
};

const MESSAGE: Record<Exclude<GiftFailure['code'], 'INVALID_INPUT'>, string> = {
  NOT_FOUND: 'No such gift.',
  NO_RECIPIENT: 'There is nobody else to give a gift to yet.',
  GIFT_CATEGORY_UNSET: 'No gift category is set up, so a gift would have nowhere to be filed.',
  ALREADY_RESOLVED: 'This gift has already been settled.',
};

/** A refusal from the store, as a response. */
export function failure(f: GiftFailure): Response {
  const message = f.code === 'INVALID_INPUT' ? f.message : MESSAGE[f.code];
  return Response.json({ success: false, error: { code: f.code, message } }, { status: STATUS[f.code] });
}

/** The body every unknown-or-not-yours gift id answers. */
export const notFound = (): Response => failure({ ok: false, code: 'NOT_FOUND' });

/** A refusal of the request body itself. Never echoes what was sent. */
export const invalid = (message: string): Response => failure({ ok: false, code: 'INVALID_INPUT', message });

export const ok = (gift: Gift, status = 200): Response => Response.json({ success: true, data: gift }, { status });

/**
 * The signed-in person, or the boundary's refusal. A `Response` comes back when the request may not
 * proceed; a user id when it may.
 */
export async function giverOf(req: NextRequest): Promise<number | Response> {
  const decision = await authorize(req);
  if (decision.ok) return decision.session.userId;
  const message = decision.status === 401
    ? 'This request carried no valid session.'
    : 'This credential may not make changes.';
  return Response.json({ success: false, error: { code: decision.code, message } }, { status: decision.status });
}

/** A gift id from the path: digits only, as a positive safe integer, else null. */
export function giftIdFrom(raw: string): number | null {
  if (!/^\d{1,9}$/.test(raw)) return null;
  const id = Number(raw);
  return id > 0 ? id : null;
}
