// The authorization property step 16 rests on, asserted directly.
//
// The gate is only a gate if a credential that may make the agent PROPOSE cannot make the change
// HAPPEN. That is not a claim about prose in a system prompt — it is a claim about `scopePermits`,
// and it is cheap to state as a test.

import { describe, expect, it } from 'vitest';
import { scopePermits } from './bearerAuth';

const DECIDE = '/api/v1/agent/proposals/abc123/decide';

describe('a read-only token', () => {
  it('may make the agent propose, because proposing writes nothing', () => {
    expect(scopePermits('read', 'POST', '/api/v1/chat')).toBe(true);
  });

  it('may NOT decide a proposal — this is the gate', () => {
    expect(scopePermits('read', 'POST', DECIDE)).toBe(false);
  });

  it('may not reach the decide path under a trailing slash either', () => {
    expect(scopePermits('read', 'POST', DECIDE + '/')).toBe(false);
  });

  it('may not reach it by looking like the chat endpoint', () => {
    // The allowlist is exact-match, so a path that merely starts with the safe one is still
    // refused. Without this the safe list would be a prefix rule nobody wrote down.
    expect(scopePermits('read', 'POST', '/api/v1/chat/../agent/proposals/x/decide')).toBe(false);
    expect(scopePermits('read', 'POST', '/api/v1/chatx')).toBe(false);
  });

  it('may still read anything', () => {
    expect(scopePermits('read', 'GET', '/api/v1/overview')).toBe(true);
  });
});

describe('a full-scope session', () => {
  it('may decide a proposal', () => {
    expect(scopePermits('full', 'POST', DECIDE)).toBe(true);
  });
});
