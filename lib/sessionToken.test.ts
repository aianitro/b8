// F5 and F6 — the session identifier's entropy and the cookie's attributes.
//
// Both are properties nothing else in the suite can observe: a guessable token and a
// script-readable cookie both produce a working login, and the difference only shows up when
// somebody is attacking it.

import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  clearedSessionCookie,
  generateSessionToken,
  hashSessionToken,
  sessionCookie,
} from './sessionToken';

describe('the session identifier', () => {
  it('1000 generated session identifiers are pairwise distinct and each carries at least 128 bits of encoded entropy', () => {
    const tokens = Array.from({ length: 1000 }, () => generateSessionToken());

    // PAIRWISE DISTINCT. A Set is the whole test: a generator seeded once per process, or one
    // derived from a timestamp, collides inside a thousand draws.
    expect(new Set(tokens).size).toBe(1000);

    for (const token of tokens) {
      // AT LEAST 128 BITS, MEASURED ON THE ENCODED FORM. base64url carries 6 bits per character,
      // so 128 bits needs 22 characters — the floor, not the target. These are 32 bytes and
      // therefore 43 characters; the assertion is written against the requirement rather than
      // against the current constant so that shortening the token fails here.
      expect(token.length).toBeGreaterThanOrEqual(22);
      // And it really is base64url, unpadded — the encoding the cookie and the contract's
      // `base64url` both require. A token containing `=` or `+` would be a different bug in a
      // different place, and it would arrive silently.
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    }

    // A token that is not what a caller stores. Hashing is one-way, so the value in the table can
    // never be replayed as a cookie even by someone reading the table.
    expect(tokens.map(hashSessionToken)).not.toContain(tokens[0]);
  });

  it('the session cookie is HttpOnly, carries an explicit SameSite, and its Max-Age never exceeds the configured session TTL', () => {
    const cookie = sessionCookie(generateSessionToken());

    expect(cookie.name).toBe(SESSION_COOKIE_NAME);
    // HTTPONLY, ALWAYS. Not "truthy" — exactly `true`, because `NextResponse.cookies.set` treats
    // the attribute as present only for a boolean, and a string `'true'` is a bug this repo has
    // shipped once already on `ALERTS_ENABLED`.
    expect(cookie.httpOnly).toBe(true);
    // AN EXPLICIT SameSite: present, and one of the two values that constrain anything. Absent
    // leaves the choice to the browser and `'none'` attaches the session to cross-site requests.
    expect(cookie.sameSite).toBeDefined();
    expect(['lax', 'strict']).toContain(cookie.sameSite);
    expect(cookie.sameSite).not.toBe('none');
    // A FINITE Max-Age, no greater than the server-side TTL. Zero would expire it immediately and
    // a negative value is a session-cookie-by-accident, so the bound is two-sided.
    expect(cookie.maxAge).toBeGreaterThan(0);
    expect(cookie.maxAge).toBeLessThanOrEqual(SESSION_TTL_SECONDS);
    expect(cookie.path).toBe('/');

    // The cleared cookie is the same cookie by name and path — otherwise the browser keeps the
    // original alongside it — and it is the only one allowed a Max-Age of 0.
    const cleared = clearedSessionCookie();
    expect(cleared.name).toBe(SESSION_COOKIE_NAME);
    expect(cleared.path).toBe(cookie.path);
    expect(cleared.httpOnly).toBe(true);
    expect(cleared.maxAge).toBe(0);
    expect(cleared.value).toBe('');
  });

  it('the stored form of a token is a lowercase 64-character hex digest, which is the only form the column accepts', () => {
    // `auth_sessions.token_hash` carries CHECK (token_hash ~ '^[0-9a-f]{64}$'). This fixture is
    // the JavaScript half of that constraint: it proves the value this app computes is one
    // Postgres will accept, without needing a database to find out.
    const token = generateSessionToken();
    const digest = hashSessionToken(token);

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toBe(token);
    // Deterministic — the boundary recomputes it on every request and must land on the same row.
    expect(hashSessionToken(token)).toBe(digest);
    expect(hashSessionToken(generateSessionToken())).not.toBe(digest);
  });
});
