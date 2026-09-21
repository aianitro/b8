import { describe, it, expect } from 'vitest';
import { ALLOWED_HOSTNAMES, isAllowedHost, TAILNET_HOSTNAME } from './hostGuard';

describe('isAllowedHost', () => {
  it('allows the hostnames the dev/start scripts actually serve on', () => {
    expect(isAllowedHost('localhost:3000')).toBe(true);
    expect(isAllowedHost('127.0.0.1:3000')).toBe(true);
  });

  it('allows those hostnames with no port', () => {
    expect(isAllowedHost('localhost')).toBe(true);
    expect(isAllowedHost('127.0.0.1')).toBe(true);
  });

  it('is case-insensitive on the hostname', () => {
    expect(isAllowedHost('LOCALHOST:3000')).toBe(true);
  });

  it('allows the IPv6 loopback literal, bracketed with a port', () => {
    expect(isAllowedHost('[::1]:3000')).toBe(true);
    expect(isAllowedHost('[::1]')).toBe(true);
  });

  it('rejects a spoofed Host header — the DNS-rebinding case this exists for', () => {
    expect(isAllowedHost('evil.com')).toBe(false);
    expect(isAllowedHost('evil.com:3000')).toBe(false);
  });

  it('the host allowlist accepts the Tailscale hostname this task admits', () => {
    // THE FLIP. This block used to assert the opposite — that a `.ts.net` host was rejected —
    // and ROADMAP.md §5 step 12 names its inversion as part of this change. It is inverted
    // here rather than deleted so the diff shows the boundary moving rather than a test
    // disappearing.
    //
    // Both the literal and the constant are asserted. The literal is what makes this
    // falsifiable: a test written only against `TAILNET_HOSTNAME` asserts whatever the
    // constant happens to say today and would still pass if the constant were changed to
    // something the deployment does not answer to.
    expect(isAllowedHost('b8.tailnet.ts.net:3000')).toBe(true);
    expect(isAllowedHost('b8.tailnet.ts.net')).toBe(true);
    expect(isAllowedHost(`${TAILNET_HOSTNAME}:3000`)).toBe(true);
    // Case-folded like every other entry — a Host header is not case-sensitive in the hostname.
    expect(isAllowedHost('B8.Tailnet.TS.NET:3000')).toBe(true);
    // And it really is in the exported set the WebAuthn origins are derived from, rather than
    // admitted by some second code path.
    expect(ALLOWED_HOSTNAMES.has(TAILNET_HOSTNAME)).toBe(true);
  });

  it('an unrelated hostname, never admitted, is still rejected after the flip', () => {
    // NEGATIVE CONTROL #3: the flip is one named addition, not a relaxation. Each of these is a
    // host the allowlist has never contained, and two of them are the shapes a suffix or
    // substring rule would wrongly admit now that a real domain is on the list.
    expect(isAllowedHost('not-my-tailnet-host.ts.net:3000')).toBe(false);
    expect(isAllowedHost('b8.tailnet.ts.net.evil.com:3000')).toBe(false);
    expect(isAllowedHost('evil-b8.tailnet.ts.net:3000')).toBe(false);
    expect(isAllowedHost('192.168.1.10:3000')).toBe(false);
    expect(isAllowedHost('finance.internal')).toBe(false);
  });

  it('rejects null and empty Host headers', () => {
    expect(isAllowedHost(null)).toBe(false);
    expect(isAllowedHost('')).toBe(false);
  });

  it('does not mistake an IPv6 literal’s internal colons for the port separator', () => {
    // A pathological host string with no brackets would misparse under naive `split(':')`.
    expect(isAllowedHost('::1:3000')).toBe(false);
  });

  it('rejects a hostname that merely contains an allowed one as a substring', () => {
    expect(isAllowedHost('localhost.evil.com')).toBe(false);
    expect(isAllowedHost('notlocalhost:3000')).toBe(false);
  });
});
