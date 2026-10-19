// P7-41a2: the login page's ceremony sequence, driven with a recording `fetch` and a stub
// authenticator — scenarios C1 to C7 of plan/tasks/P7-41a2-browser-onboarding/SPEC.md.
//
// The function under test is the one `app/login/page.tsx` calls, not a copy of it, so what these
// assert about the requests is what the browser sends. Every value is fabricated: the code, the
// options, and the "authenticator response", which is an opaque object the ceremony only forwards.

import { afterEach, describe, expect, it } from 'vitest';
import { runCeremony, type CeremonyCollaborators } from './passkeyCeremony';

const CODE = 'Qr-_stUVwx56yzAB78cd-_';
const OPTIONS = { challenge: 'fabricated-challenge-value', rp: { id: 'localhost', name: 'B8 Finance' } };
const AUTHENTICATOR_RESPONSE = { id: 'fabricated-credential', rawId: 'fabricated-credential', type: 'public-key', response: {} };

interface Recorded { url: string; init: RequestInit | undefined }

type Answer = { status: number; body: unknown };
const ok = (data: unknown = OPTIONS): Answer => ({ status: 200, body: { success: true, data } });

/**
 * A `fetch` that records every call and answers from `answers` by path suffix, and an authenticator
 * whose every call is counted. `fail` makes the authenticator throw what a cancelled prompt throws.
 */
function harness(answers: Record<string, Answer> = {}, fail?: Error) {
  const calls: Recorded[] = [];
  let authenticatorCalls = 0;
  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(answers).find((suffix) => url.endsWith(suffix));
    const answer = key ? answers[key] : url.endsWith('/options') ? ok() : ok({ verified: true });
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const authenticator = async () => {
    authenticatorCalls += 1;
    if (fail) throw fail;
    return AUTHENTICATOR_RESPONSE;
  };
  const collaborators = {
    fetch: fetchStub,
    startRegistration: authenticator,
    startAuthentication: authenticator,
  } as unknown as CeremonyCollaborators;
  return { calls, collaborators, authenticatorCalls: () => authenticatorCalls };
}

const header = (init: RequestInit | undefined) => new Headers(init?.headers);

function notAllowed(): Error {
  const error = new Error('The operation either timed out or was not allowed.');
  error.name = 'NotAllowedError';
  return error;
}

/** C1's assertions, reused by C7 under hostile globals. */
async function assertCodeOnBothRegistrationRequests() {
  const h = harness();
  await runCeremony('register', h.collaborators, CODE);
  expect(h.calls.map((c) => [c.init?.method, c.url])).toEqual([
    ['POST', '/api/v1/auth/register/options'],
    ['POST', '/api/v1/auth/register/verify'],
  ]);
  for (const call of h.calls) {
    expect(header(call.init).get('x-invitation-code')).toBe(CODE);
    expect(call.url).not.toContain(CODE);
  }
  expect(h.calls[0].init?.body).toBeUndefined();
  expect(h.calls[1].init?.body).toBe(JSON.stringify(AUTHENTICATOR_RESPONSE));
  expect(String(h.calls[1].init?.body)).not.toContain(CODE);
  expect(header(h.calls[1].init).get('content-type')).toBe('application/json');
}

async function assertOptionsRefusalStops() {
  const h = harness({ '/register/options': { status: 403, body: { success: false, error: { code: 'REGISTRATION_CLOSED', message: 'Fabricated refusal M.' } } } });
  await expect(runCeremony('register', h.collaborators, CODE)).rejects.toThrow('Fabricated refusal M.');
  expect(h.authenticatorCalls()).toBe(0);
  expect(h.calls.map((c) => c.url)).toEqual(['/api/v1/auth/register/options']);
}

async function assertCancelThenRetry() {
  const cancelled = harness({}, notAllowed());
  await expect(runCeremony('register', cancelled.collaborators, CODE)).rejects.toMatchObject({ name: 'NotAllowedError' });
  expect(cancelled.calls.map((c) => c.url)).toEqual(['/api/v1/auth/register/options']);

  // The same function, the same code, a fresh authenticator that completes: the same two requests.
  const retry = harness();
  await runCeremony('register', retry.collaborators, CODE);
  expect(retry.calls.map((c) => c.url)).toEqual(['/api/v1/auth/register/options', '/api/v1/auth/register/verify']);
  for (const call of retry.calls) expect(header(call.init).get('x-invitation-code')).toBe(CODE);
}

describe('P7-41a2: the passkey ceremony sequence', () => {
  it('T41a2-C1: an invitation code rides on BOTH registration requests, and only in the header', async () => {
    await assertCodeOnBothRegistrationRequests();
  });

  it('T41a2-C2: with no code, the requests are exactly what /login sent before this step', async () => {
    for (const none of [null, undefined]) {
      const h = harness();
      await runCeremony('register', h.collaborators, none);
      expect(h.calls.map((c) => c.url)).toEqual(['/api/v1/auth/register/options', '/api/v1/auth/register/verify']);
      for (const call of h.calls) expect(header(call.init).has('x-invitation-code')).toBe(false);
      expect(h.calls[0].init).toStrictEqual({ method: 'POST' });
      expect(h.calls[1].init).toStrictEqual({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(AUTHENTICATOR_RESPONSE),
      });
    }
  });

  it('T41a2-C3: a sign-in never carries the code, even with one in hand', async () => {
    const h = harness();
    await runCeremony('login', h.collaborators, CODE);
    expect(h.calls.map((c) => c.url)).toEqual(['/api/v1/auth/login/options', '/api/v1/auth/login/verify']);
    for (const call of h.calls) {
      expect(header(call.init).has('x-invitation-code')).toBe(false);
      expect(JSON.stringify(call.init)).not.toContain(CODE);
    }
    expect(h.calls[0].init).toStrictEqual({ method: 'POST' });
  });

  it('T41a2-C4: a refusal at options rejects with its message and runs nothing further', async () => {
    await assertOptionsRefusalStops();
    // An error branch with no readable message still says something readable, never `undefined`.
    const bare = harness({ '/register/options': { status: 403, body: { success: false } } });
    await expect(runCeremony('register', bare.collaborators, CODE)).rejects.toThrow('That did not work. Try again.');
    expect(bare.authenticatorCalls()).toBe(0);
  });

  it('T41a2-C5: a refusal at verify surfaces, and a success that is not exactly true is a refusal', async () => {
    const refused = harness({ '/register/verify': { status: 403, body: { success: false, error: { code: 'REGISTRATION_CLOSED', message: 'Fabricated refusal M2.' } } } });
    await expect(runCeremony('register', refused.collaborators, CODE)).rejects.toThrow('Fabricated refusal M2.');
    expect(refused.authenticatorCalls()).toBe(1);

    for (const success of ['true', 1, undefined]) {
      const odd = harness({ '/register/verify': { status: 200, body: { success, data: { verified: true } } } });
      await expect(runCeremony('register', odd.collaborators, CODE)).rejects.toThrow();
    }
  });

  it('T41a2-C6: a cancelled prompt makes no verify request and leaves the retry intact', async () => {
    await assertCancelThenRetry();
  });

  describe('with every client storage surface booby-trapped', () => {
    const saved = {
      localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
      sessionStorage: Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage'),
      document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    };

    afterEach(() => {
      for (const [name, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
      }
    });

    it('T41a2-C7: the ceremony module touches no client storage', async () => {
      const trap = (name: string) => new Proxy({}, {
        get: (_target, property) => { throw new Error(`ceremony touched ${name}.${String(property)}`); },
        set: (_target, property) => { throw new Error(`ceremony wrote ${name}.${String(property)}`); },
        has: (_target, property) => { throw new Error(`ceremony probed ${name}.${String(property)}`); },
      });
      for (const name of ['localStorage', 'sessionStorage', 'document']) {
        Object.defineProperty(globalThis, name, { value: trap(name), configurable: true, writable: true });
      }
      await assertCodeOnBothRegistrationRequests();
      await assertOptionsRefusalStops();
      await assertCancelThenRetry();
    });
  });
});
