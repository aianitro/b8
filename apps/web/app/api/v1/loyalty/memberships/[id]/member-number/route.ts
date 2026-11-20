import type { NextRequest } from 'next/server';
import { memberNumberOf } from '@/lib/loyaltyStore';
import { answer, callerOf, failure, idFrom, invalid } from '../../../loyaltyResponses';

/**
 * `GET /api/v1/loyalty/memberships/[id]/member-number` — the ONE response that carries a full
 * member number, for the page's copy action, fetched on click and never on load.
 *
 * BROWSER SESSIONS ONLY. A cookie carries only a session of kind `browser`; a bearer token is always
 * kind `personal`, and it is refused here WHATEVER ITS SCOPE — a full-scope script token has no need
 * to read member numbers, and a scope check alone would let it. The refusal's body carries no number,
 * and nothing here logs one.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await callerOf(req);
  if (caller instanceof Response) return caller;
  if (caller.kind !== 'browser') return failure({ ok: false, code: 'BROWSER_SESSION_REQUIRED' });
  const id = idFrom((await ctx.params).id);
  if (id === null) return invalid('The id is not valid.');
  return answer(await memberNumberOf(id));
}
