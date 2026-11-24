import type { NextRequest } from 'next/server';
import { readStoredMail } from '@/lib/loyaltyInboxRead';
import { LoyaltyInboxReadRequestSchema } from '@b8/contracts/loyalty';
import { callerOf, invalid, ok } from '../../loyaltyResponses';

/**
 * `POST /api/v1/loyalty/inbox/read` (P8-42c2) — read the stored loyalty mail now, instead of waiting
 * for the daily job: every stored, readable, not-yet-read message from an allowlisted sender is read
 * once by Claude as a proposal, auto-applied only where every rule holds, and queued otherwise. The
 * body is optional; `{ retryFailed: true }` first returns every failed message that still has its
 * bytes to unread (the "Try failed mail again" control).
 *
 * A WRITE ROUTE, so the caller is resolved first, before anything else: no credential is 401, a
 * read-scope token is 403 `INSUFFICIENT_SCOPE`, and neither reads a body, calls a model or writes a
 * row. A read costs money and can append balance observations, which is why a read token may not.
 * A body that cannot be read at all is refused as invalid rather than treated as empty (P8-42c4).
 *
 * HTTP 200 FOR EVERY OUTCOME. `disabled` (no API key), `already_running` (another read, from this
 * route or the daily job, holds the lock) and `error` (a classified code, never library text) are
 * answers about the reading, not failures of this request. The body is counts and a code only
 * (`LoyaltyInboxReadResponseSchema`): no subject, text, balance, suffix or model output.
 *
 * `no-transaction-data`: it reads the inbox tables, the memberships and their observations, and
 * appends `email` observations; it never reads or writes a ledger row.
 */
export async function POST(req: NextRequest) {
  const caller = await callerOf(req);
  if (caller instanceof Response) return caller;
  // An absent or empty body is `{}`; anything else must be the strict request object.
  //
  // A body whose read FAILS is not an empty body (P8-42c4, D1). It used to become `''`, then `{}`,
  // and so started a full read run, which costs money, from a request whose intent could not be
  // read. It now answers exactly what invalid JSON answers (400 `INVALID_INPUT`), with a fixed
  // sentence that echoes nothing, and starts nothing: no lock, no reader call, no row or state
  // written. The caller is still resolved above first, so 401 and 403 never pull the stream.
  let text: string;
  try {
    text = await req.text();
  } catch {
    return invalid('The body could not be read.');
  }
  let raw: unknown = {};
  if (text.trim() !== '') {
    try {
      raw = JSON.parse(text);
    } catch {
      return invalid('The body is not valid JSON.');
    }
  }
  const body = LoyaltyInboxReadRequestSchema.safeParse(raw);
  if (!body.success) return invalid('The body may hold only retryFailed, true or false.');
  return ok(await readStoredMail(body.data));
}
