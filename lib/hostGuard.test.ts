import { describe, it, expect } from 'vitest';
import { isAllowedHost } from './hostGuard';

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

  it('rejects a Tailscale/VPN hostname that is not yet in the allowlist', () => {
    // Deliberately strict: the AWS/Tailscale deployment track (ROADMAP.md §2) will need to
    // extend this allowlist explicitly, not fall through by accident.
    expect(isAllowedHost('my-tailnet-host.ts.net:3000')).toBe(false);
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
