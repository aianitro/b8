import type { NextRequest } from 'next/server';
import { checkReceipt } from '@/lib/receipt';
import { readerAvailable, readLoyaltyScreenshot } from '@/lib/loyaltyReader';
import { cleanReading } from '@/lib/domain/loyaltyRead';
import { compareScreenshot } from '@/lib/domain/loyaltyScreenshot';
import { screenshotTargetOf } from '@/lib/loyaltyStore';
import { LOYALTY_MASK_BULLETS, type LoyaltyReadErrorCode, type LoyaltyScreenshotRead } from '@b8/contracts/loyalty';
import { callerOf, failure, idFrom, invalid, ok } from '../../../loyaltyResponses';

/**
 * `POST /api/v1/loyalty/memberships/[id]/screenshot` (P8-42d) — read one screenshot of a program's
 * app as a PROPOSAL for this membership. Writes nothing: no observation, no capture row, no file, no
 * log of the image. The image is read, sent once, and dropped with this request (SPEC.md D4).
 *
 * THE ORDER IS THE GUARANTEE. The caller is resolved first (401, or 403 for a read-scope token,
 * because a read costs money), then the id and the membership (400, 404), and only then is the body
 * pulled: a refused or misaimed request never reads an image and never starts a paid call.
 *
 * THE BYTES ARE CHECKED BY THE RECEIPT RULE, imported, so the two uploads share one bound and one
 * list of formats: the magic number decides, the Content-Type header is not trusted, and an oversize
 * body is 413 with the same `INVALID_INPUT` code the receipts route answers.
 *
 * EVERY READ IS HTTP 200 (D10): `disabled` with no key (nothing is built or sent), `error` with a
 * classified code, or `read` after 42c2's clean pass and the three comparisons. A `mismatch` is a
 * warning for the form, never a refusal. The only member-number fragment in the answer is the suffix
 * the SCREENSHOT printed, masked; the membership's own stored number is compared and never returned.
 *
 * Carries no ledger row and nothing derived from one: `no-transaction-data`.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await callerOf(req);
  if (caller instanceof Response) return caller;
  const id = idFrom((await ctx.params).id);
  if (id === null) return invalid('The id is not valid.');
  const target = await screenshotTargetOf(id);
  if (target === null) return failure({ ok: false, code: 'NOT_FOUND' });

  // A body that fails while streaming is a refusal in a fixed sentence, never an empty image and
  // never whatever the stream managed to send before it broke.
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await req.arrayBuffer());
  } catch {
    return invalid('The image could not be received. Try again.');
  }
  const check = checkReceipt(bytes);
  if (!check.ok) {
    // 413 for an oversize image, as the receipts route answers it, with the same code and envelope;
    // the shared helper maps INVALID_INPUT to 400 only, so this one status is set here.
    if (check.code !== 'TOO_LARGE') return invalid(check.message);
    return Response.json({ success: false, error: { code: 'INVALID_INPUT', message: check.message } }, { status: 413 });
  }

  if (!readerAvailable()) return ok(nothingRead('disabled', null));
  // The reader never rejects; a rejection anyway (a defect, or a replaced reader) is still an answer,
  // `api_error`, so a read can never become a 500 that leaves the form unusable.
  const result = await readLoyaltyScreenshot(bytes, check.type).catch((): { ok: false; code: LoyaltyReadErrorCode } => ({ ok: false, code: 'api_error' }));
  if (!result.ok) return ok(nothingRead('error', result.code));

  const reading = cleanReading(result.reading);
  const checks = compareScreenshot({ reading, ...target });
  const answer: LoyaltyScreenshotRead = {
    outcome: 'read',
    errorCode: null,
    balance: reading.balance,
    unit: reading.unit,
    asOf: reading.asOf,
    maskedSuffix: reading.suffix === null ? null : `${LOYALTY_MASK_BULLETS}${reading.suffix}`,
    ...checks,
    expiryWarnings: reading.expiryWarnings,
    instruments: reading.instruments,
  };
  return ok(answer);
}

/** A read that produced no reading: every field null, every list empty, nothing compared. */
function nothingRead(outcome: 'disabled' | 'error', errorCode: LoyaltyReadErrorCode | null): LoyaltyScreenshotRead {
  return {
    outcome, errorCode, balance: null, unit: null, asOf: null, maskedSuffix: null,
    programCheck: 'not_stated', suffixCheck: 'not_stated', unitCheck: 'not_stated', expiryWarnings: [], instruments: [],
  };
}
