import { NextRequest } from 'next/server';
import type { ApiResponse } from '@b8/contracts/types';
import { credentialFrom } from '@/lib/requestAuth';
import { subscriptionStatus } from '@/lib/webPush';

/**
 * Does the server consider this device subscribed?
 *
 * A POST, and a POST that only reads, because the endpoint is credential-shaped: in a GET it would
 * be a query string, and query strings land in access logs and browser history. The rest of this
 * feature is careful never to log an endpoint; putting one in a URL would undo that quietly.
 *
 * ANSWERED FOR THE CALLER'S OWN USER (P7-41a). An endpoint registered to the other user reads as
 * not registered here — see `subscriptionStatus`. The session is resolved again in the handler,
 * as every handler in this app does, because the boundary admitting the request says nothing about
 * WHO it admitted. A request the boundary admitted but `credentialFrom` refuses is the same request
 * the boundary would have refused on scope, so this adds no new refusal in practice.
 */
export async function POST(req: NextRequest) {
  const session = await credentialFrom(req);
  if (!session) {
    return Response.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'A session is required to read notification status.' } } satisfies ApiResponse<never>,
      { status: 403 }
    );
  }

  let body: { endpoint?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'A JSON body with `endpoint` is required.' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
  if (!endpoint.startsWith('https://')) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'That is not a push subscription endpoint.' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  try {
    return Response.json(
      { success: true, data: await subscriptionStatus(endpoint, session.userId) } satisfies ApiResponse<{ registered: boolean; revoked: boolean }>
    );
  } catch {
    return Response.json(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Could not read the subscription.' } } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}
