import { describe, expect, it } from 'vitest';
import {
  PERSONAL_DEFAULT_DAYS,
  PERSONAL_MAX_DAYS,
  bearerMayReach,
  kindAllowedFor,
  mayIssueDeviceToken,
  parseBearer,
  personalTokenDays,
  scopePermits,
  wantsDeviceToken,
} from './bearerAuth';
import { generateSessionToken } from './sessionToken';

const headers = (h: Record<string, string>) => new Headers(h);

describe('parseBearer', () => {
  const token = generateSessionToken();

  it('accepts exactly the token shape this app issues', () => {
    expect(parseBearer(`Bearer ${token}`)).toBe(token);
    // RFC 6750: the scheme is case-insensitive.
    expect(parseBearer(`bearer ${token}`)).toBe(token);
  });

  it('refuses everything else before it reaches a lookup', () => {
    for (const bad of [
      null, undefined, '', 'Bearer', `Bearer  ${token}`, `Basic ${token}`, `Bearer ${token}x`,
      `Bearer ${token.slice(1)}`, `Bearer ${token}, Bearer ${token}`, `Bearer ${token.replace(/./, '=')}`,
      `Token ${token}`, ` Bearer ${token}`,
    ]) {
      expect(parseBearer(bad as string | null)).toBeNull();
    }
  });
});

describe('bearerMayReach', () => {
  it('lets a token reach the API and nothing else', () => {
    // A leaked script token must not become a way to browse the app.
    expect(bearerMayReach('/api/v1/overview')).toBe(true);
    expect(bearerMayReach('/dashboard')).toBe(false);
    expect(bearerMayReach('/')).toBe(false);
    expect(bearerMayReach('/apix/v1/overview')).toBe(false);
  });
});

describe('scopePermits', () => {
  it('lets a full token do anything the boundary allows', () => {
    for (const m of ['GET', 'POST', 'PATCH', 'DELETE']) {
      expect(scopePermits('full', m, '/api/v1/transactions/5')).toBe(true);
    }
  });

  it('lets a read token read', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS', 'get']) {
      expect(scopePermits('read', m, '/api/v1/overview')).toBe(true);
    }
  });

  it('refuses a read token anything that writes', () => {
    for (const [m, p] of [
      ['POST', '/api/v1/transactions'], ['PATCH', '/api/v1/transactions/5'],
      ['DELETE', '/api/v1/accounts/x'], ['PUT', '/api/v1/categories'], ['POST', '/api/v1/sync'],
    ]) {
      expect(scopePermits('read', m, p)).toBe(false);
    }
  });

  it('allows a read token to call chat, which writes nothing — and only that POST', () => {
    // The one reason a read token exists: the eval runner has to reach chat.
    expect(scopePermits('read', 'POST', '/api/v1/chat')).toBe(true);
    expect(scopePermits('read', 'POST', '/api/v1/chat/')).toBe(true);
    expect(scopePermits('read', 'POST', '/api/v1/chatx')).toBe(false);
    expect(scopePermits('read', 'POST', '/api/v1/chat/anything')).toBe(false);
    // The legacy path is not honoured for a new kind of client.
    expect(scopePermits('read', 'POST', '/api/chat')).toBe(false);
  });
});

describe('kindAllowedFor', () => {
  it('keeps cookies for browsers and headers for everything else', () => {
    expect(kindAllowedFor('cookie', 'browser')).toBe(true);
    expect(kindAllowedFor('cookie', 'device')).toBe(false);
    expect(kindAllowedFor('cookie', 'personal')).toBe(false);
    expect(kindAllowedFor('bearer', 'browser')).toBe(false);
    expect(kindAllowedFor('bearer', 'device')).toBe(true);
    expect(kindAllowedFor('bearer', 'personal')).toBe(true);
  });
});

describe('mayIssueDeviceToken — a browser can never obtain a readable token', () => {
  it('refuses any request carrying the Sec-Fetch headers every browser sends', () => {
    // Page script cannot remove these: they are forbidden headers. So no web page — including one
    // with injected script — can turn a passkey prompt into a 30-day token it can read and send away.
    expect(mayIssueDeviceToken(headers({ 'sec-fetch-mode': 'cors' }))).toBe(false);
    expect(mayIssueDeviceToken(headers({ 'sec-fetch-site': 'same-origin' }))).toBe(false);
    expect(mayIssueDeviceToken(headers({ 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none' }))).toBe(false);
  });

  it('allows a native client, whose HTTP stack sends neither', () => {
    expect(mayIssueDeviceToken(headers({ 'x-b8-client': 'device', 'content-type': 'application/json' }))).toBe(true);
  });
});

describe('wantsDeviceToken', () => {
  it('is an explicit opt-in, not a default', () => {
    expect(wantsDeviceToken(headers({ 'x-b8-client': 'device' }))).toBe(true);
    expect(wantsDeviceToken(headers({ 'x-b8-client': 'DEVICE' }))).toBe(true);
    expect(wantsDeviceToken(headers({}))).toBe(false);
    expect(wantsDeviceToken(headers({ 'x-b8-client': 'browser' }))).toBe(false);
  });
});

describe('personalTokenDays', () => {
  it('defaults, and accepts whole days within the bound', () => {
    expect(personalTokenDays(undefined)).toBe(PERSONAL_DEFAULT_DAYS);
    expect(personalTokenDays(1)).toBe(1);
    expect(personalTokenDays(PERSONAL_MAX_DAYS)).toBe(PERSONAL_MAX_DAYS);
  });

  it('refuses a token that would never expire, or anything else odd', () => {
    for (const bad of [0, -1, PERSONAL_MAX_DAYS + 1, 1.5, Number.NaN, Infinity]) {
      expect(() => personalTokenDays(bad)).toThrow(RangeError);
    }
  });
});
