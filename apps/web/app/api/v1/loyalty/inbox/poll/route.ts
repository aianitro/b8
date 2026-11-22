import type { NextRequest } from 'next/server';
import { pollLoyaltyInbox } from '@/lib/loyaltyInbox';
import { callerOf, ok } from '../../loyaltyResponses';

/**
 * `POST /api/v1/loyalty/inbox/poll` (P8-42c1) — "Check inbox now": one poll of the dedicated loyalty
 * mailbox, now, instead of waiting for the daily job. No body.
 *
 * A WRITE ROUTE, so the caller is resolved first, before anything else: no credential is 401, a
 * read-scope token is 403 `INSUFFICIENT_SCOPE`, and neither opens a connection or writes a row. It
 * opens a connection to the mailbox and records rows, which is why a read token may not.
 *
 * HTTP 200 FOR EVERY OUTCOME. `disabled` (the environment is not set up), `already_running` (another
 * poll, from this route or the daily job, holds the lock) and `error` (a classified code, never the
 * library's text) are answers about the mailbox, not failures of this request. The body is counts
 * and a code only (`LoyaltyInboxPollResponseSchema`): no subject, address, byte of mail or host.
 *
 * No rate limit beyond single-flight: at most one connection is open at a time, so a caller holding
 * a write token can cause repeated polls but never parallel ones (SPEC.md Open question 10).
 *
 * `no-transaction-data`: it reads the environment and the five inbox tables, never a ledger row.
 */
export async function POST(req: NextRequest) {
  const caller = await callerOf(req);
  if (caller instanceof Response) return caller;
  return ok(await pollLoyaltyInbox());
}
