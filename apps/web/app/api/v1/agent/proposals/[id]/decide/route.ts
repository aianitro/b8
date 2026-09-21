import { NextRequest } from 'next/server';
import type { ApiResponse } from '@b8/contracts/types';
import { createLogger } from '@/lib/logger';
import { credentialFrom } from '@/lib/requestAuth';
import { decideProposal } from '@/lib/proposalStore';

const log = createLogger('agent-proposals');

export const dynamic = 'force-dynamic';

/**
 * THE ONLY PLACE AN AGENT-ORIGINATED CHANGE ACTUALLY HAPPENS.
 *
 * It is a POST and it is deliberately NOT in `READ_SAFE_POSTS` (`lib/bearerAuth.ts`), so the scope
 * check refuses a read-scoped token here while still allowing it to call `/api/v1/chat`. That is
 * the whole shape of the gate expressed in the authorization layer rather than in prose: the eval
 * runner and any script may make the agent propose anything at all, and none of them can make it
 * happen.
 *
 * The model cannot reach this endpoint. It has no tool for it, and the loop performs no HTTP.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Re-asked here rather than trusted from the boundary. `credentialFrom` applies the scope check
  // itself — the lesson of P1-12a, where the authority test lived only at a boundary that two paths
  // legitimately skipped. Cheap, and it means this handler cannot hold a different opinion about
  // who is allowed than the rest of the app does.
  const session = await credentialFrom(req);
  if (!session) {
    return Response.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'A full-scope session is required to confirm a change.' } } satisfies ApiResponse<never>,
      { status: 403 }
    );
  }

  let body: { decision?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'A JSON body with `decision` is required.' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  // An unrecognised decision is refused rather than defaulted. "Confirm" must never be what happens
  // when a client sends something the server did not understand.
  if (body.decision !== 'confirmed' && body.decision !== 'rejected') {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: "`decision` must be 'confirmed' or 'rejected'." } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  try {
    const outcome = await decideProposal({
      id,
      decision: body.decision,
      decidedBy: session.tokenHash,
      now: new Date(),
    });

    if (!outcome.ok) {
      log.info('proposal refused', { proposalId: id, code: outcome.code });
      // 409: the proposal is real, the request is well-formed, and the WORLD refused it —
      // already decided, expired, or the row changed underneath. Distinct from a 400, which means
      // the caller sent something wrong.
      const status = outcome.code === 'NOT_FOUND' ? 404 : 409;
      return Response.json(
        { success: false, error: { code: outcome.code, message: outcome.message } } satisfies ApiResponse<never>,
        { status }
      );
    }

    log.info('proposal decided', { proposalId: id, decision: body.decision, applied: outcome.applied });
    return Response.json(
      { success: true, data: { applied: outcome.applied, message: outcome.message } } satisfies ApiResponse<{ applied: boolean; message: string }>
    );
  } catch (err) {
    log.error('decide failed', { proposalId: id, error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { success: false, error: { code: 'DECIDE_FAILED', message: 'Could not apply that change.' } } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}
