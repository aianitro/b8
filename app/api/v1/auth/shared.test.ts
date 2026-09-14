import { NextRequest, NextResponse } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withEnvelope } from './shared';

/**
 * The regression this file exists for, stated as it happened.
 *
 * On 2026-09-14 the owner could not sign in. The passkey migration had never been applied to the
 * real database, `countCredentials()` threw on a missing relation, Next turned the throw into a 500
 * WITH AN EMPTY BODY, and `app/login/page.tsx` — which calls `.json()` like every other client here
 * — reported "Unexpected end of JSON input". That names the parser, not the problem.
 *
 * These fixtures pin the two properties that were missing: the refusal carries the envelope, and
 * outside production it carries the sentence that explains it.
 */

function boom(_request: NextRequest): Promise<NextResponse> {
  throw new Error('relation "webauthn_credentials" does not exist');
}

/** The same failure from a handler that takes no request, for the arity fixture at the bottom. */
function boomBare(): Promise<NextResponse> {
  throw new Error('relation "webauthn_credentials" does not exist');
}

function request(): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/auth/login/options', { method: 'POST' });
}

describe('withEnvelope', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('turns a throw into a 500 whose body parses as the error envelope', async () => {
    const response = await withEnvelope(boom)(request());
    expect(response.status).toBe(500);

    // The assertion that would have failed before the fix: not the status, the BODY. `.json()` on
    // an empty body throws, which is precisely the symptom the owner saw.
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SERVER_ERROR');
    expect(typeof body.error.message).toBe('string');
  });

  it('names the underlying failure outside production, where the reader is the owner', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const body = await (await withEnvelope(boom)(request())).json();
    expect(body.error.message).toContain('webauthn_credentials');
  });

  it('withholds it in production, where these endpoints answer before anyone has proved anything', async () => {
    // `login/options` responds with no session, so in production its body is readable by whatever
    // can reach the port — and a Postgres error routinely quotes a relation, a column list, or a
    // connection target.
    vi.stubEnv('NODE_ENV', 'production');
    const body = await (await withEnvelope(boom)(request())).json();
    expect(body.error.message).not.toContain('webauthn_credentials');
    expect(body.error.message).toContain('server log');
  });

  it('passes a successful response through untouched, cookies included', async () => {
    const wrapped = withEnvelope(async (_request: NextRequest) => {
      const ok = NextResponse.json({ success: true, data: null });
      ok.cookies.set('b8_session', 'token');
      return ok;
    });
    const response = await wrapped(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: null });
    // The wrapper must not rebuild the response. A ceremony sets its session cookie on the way out,
    // and a wrapper that copied only the body would sign the owner in without signing them in.
    expect(response.cookies.get('b8_session')?.value).toBe('token');
  });

  it('wraps a handler that takes no request at all', async () => {
    // `login/options` reads nothing off the request and its own test calls `POST()` bare. A wrapper
    // that forced a parameter would break that call at the type level.
    const response = await withEnvelope(boomBare)();
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe('SERVER_ERROR');
  });
});
