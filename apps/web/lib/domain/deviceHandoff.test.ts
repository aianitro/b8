import { describe, expect, it } from 'vitest';
import {
  decideClaim, handoffExpiry, handoffSweepCutoff, HANDOFF_RETENTION_MS, HANDOFF_TTL_MS,
  isAllowedHandoffTarget, type StoredHandoff,
} from './deviceHandoff';

const NOW = new Date('2026-09-21T20:00:00Z');

function handoff(over: Partial<StoredHandoff> = {}): StoredHandoff {
  return {
    credentialId: 'cred-1',
    expiresAt: new Date(NOW.getTime() + 30_000),
    claimedAt: null,
    ...over,
  };
}

describe('the claim decision', () => {
  it('admits a fresh unclaimed code', () => {
    expect(decideClaim(handoff(), NOW)).toEqual({ ok: true, credentialId: 'cred-1' });
  });

  it('refuses an unknown code rather than treating it as permission', () => {
    expect(decideClaim(null, NOW)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('refuses a second claim — single use', () => {
    expect(decideClaim(handoff({ claimedAt: NOW }), NOW)).toMatchObject({ code: 'ALREADY_CLAIMED' });
  });

  it('refuses an expired code', () => {
    expect(decideClaim(handoff({ expiresAt: NOW }), NOW)).toMatchObject({ code: 'EXPIRED' });
  });

  it('is alive one millisecond before expiry', () => {
    expect(decideClaim(handoff({ expiresAt: new Date(NOW.getTime() + 1) }), NOW).ok).toBe(true);
  });

  it('reports the REPLAY, not the clock, when a spent code is presented late', () => {
    // Both conditions hold. A code presented twice inside its minute is an attack; one presented
    // after its minute is a slow user. Blaming the clock for the first would hide it.
    const spentAndStale = handoff({
      claimedAt: new Date(NOW.getTime() - 10_000),
      expiresAt: new Date(NOW.getTime() - 5_000),
    });
    expect(decideClaim(spentAndStale, NOW)).toMatchObject({ code: 'ALREADY_CLAIMED' });
  });
});

describe('expiry', () => {
  it('is sixty seconds from the clock it is given', () => {
    expect(handoffExpiry(NOW).getTime() - NOW.getTime()).toBe(HANDOFF_TTL_MS);
    expect(HANDOFF_TTL_MS).toBe(60_000);
  });
});

describe('the redirect allowlist — an open redirect carrying a secret is the OAuth bug', () => {
  it('allows the app’s own scheme', () => {
    expect(isAllowedHandoffTarget('b8://auth')).toBe(true);
    expect(isAllowedHandoffTarget('b8://auth?code=abc')).toBe(true);
  });

  it('allows Expo Go’s development scheme', () => {
    expect(isAllowedHandoffTarget('exp://192.168.4.23:8081/--/auth')).toBe(true);
  });

  it('is case-insensitive on the scheme only', () => {
    expect(isAllowedHandoffTarget('B8://auth')).toBe(true);
  });

  it('refuses http and https, which is the whole point', () => {
    expect(isAllowedHandoffTarget('https://evil.example/collect')).toBe(false);
    expect(isAllowedHandoffTarget('http://evil.example')).toBe(false);
  });

  it('refuses javascript and data URIs', () => {
    expect(isAllowedHandoffTarget('javascript:alert(1)')).toBe(false);
    expect(isAllowedHandoffTarget('data:text/html,<script>')).toBe(false);
  });

  it('refuses a scheme that merely contains an allowed one', () => {
    expect(isAllowedHandoffTarget('https://evil.example/?x=b8://')).toBe(false);
    expect(isAllowedHandoffTarget('notb8://auth')).toBe(false);
  });

  it('refuses a bare path or empty string', () => {
    expect(isAllowedHandoffTarget('/auth')).toBe(false);
    expect(isAllowedHandoffTarget('')).toBe(false);
  });

  it('refuses a newline, which is header-injection shaped', () => {
    expect(isAllowedHandoffTarget('b8://auth\r\nSet-Cookie: x=1')).toBe(false);
  });
});

describe('the sweep window — why a claimed row is kept', () => {
  it('retains a spent code long enough for a replay to be diagnosable', () => {
    // THE REGRESSION THIS PINS. The first sweep deleted claimed rows immediately, so a replayed code
    // found nothing and was reported NOT_FOUND — making the ALREADY_CLAIMED branch above, and the
    // fixture asserting its precedence, unreachable in production.
    const justClaimed = handoff({ claimedAt: NOW, expiresAt: new Date(NOW.getTime() + 30_000) });
    const minuteLater = new Date(NOW.getTime() + 60_000);
    expect(decideClaim(justClaimed, minuteLater)).toMatchObject({ code: 'ALREADY_CLAIMED' });
    // And the sweep would not have removed it yet.
    expect(handoffSweepCutoff(minuteLater) < justClaimed.expiresAt).toBe(true);
  });

  it('sweeps a code once it is an hour past expiry', () => {
    const expiresAt = new Date(NOW.getTime() + 30_000);
    const wellLater = new Date(NOW.getTime() + HANDOFF_RETENTION_MS + 120_000);
    expect(handoffSweepCutoff(wellLater) > expiresAt).toBe(true);
  });

  it('retains for an hour, which is longer than the code lives by a wide margin', () => {
    expect(HANDOFF_RETENTION_MS).toBeGreaterThan(HANDOFF_TTL_MS * 30);
  });
});
