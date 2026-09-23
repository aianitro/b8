import { describe, expect, it } from 'vitest';
import {
  base64url, vapidAuthorization, vapidClaims, vapidSigningInput, VAPID_TTL_SECONDS,
} from './vapid';

const ENDPOINT = 'https://web.push.apple.com/QWERTY/abc123/def456';
const NOW = Date.UTC(2026, 8, 23, 6, 0, 0);

describe('vapidClaims', () => {
  // THE MISTAKE THIS FILE EXISTS TO CATCH. Signing the whole endpoint as the audience is the
  // obvious reading and is wrong; the push service answers 401 and says nothing about which claim
  // it disliked, so the symptom is a phone that never buzzes.
  it('uses the push service ORIGIN as the audience, not the endpoint', () => {
    expect(vapidClaims(ENDPOINT, 'mailto:x@y', NOW).aud).toBe('https://web.push.apple.com');
  });

  it('carries no part of the per-device path into the audience', () => {
    const { aud } = vapidClaims(ENDPOINT, 'mailto:x@y', NOW);
    for (const secret of ['QWERTY', 'abc123', 'def456']) expect(aud).not.toContain(secret);
  });

  it('expires in seconds, not milliseconds', () => {
    const { exp } = vapidClaims(ENDPOINT, 'mailto:x@y', NOW);
    expect(exp).toBe(Math.floor(NOW / 1000) + VAPID_TTL_SECONDS);
    // A millisecond expiry is 1000x too far out and every push service refuses it.
    expect(exp).toBeLessThan(NOW);
  });

  it('is inside the spec ceiling of 24 hours', () => {
    expect(VAPID_TTL_SECONDS).toBeLessThanOrEqual(24 * 60 * 60);
  });

  it('passes the subject through unchanged', () => {
    expect(vapidClaims(ENDPOINT, 'mailto:b8@localhost', NOW).sub).toBe('mailto:b8@localhost');
  });

  it('works for any push service, not just Apple', () => {
    expect(vapidClaims('https://fcm.googleapis.com/fcm/send/xyz', 'mailto:x@y', NOW).aud)
      .toBe('https://fcm.googleapis.com');
  });
});

describe('base64url', () => {
  it('is unpadded and URL-safe', () => {
    // '>>>' and '???' are the inputs that produce '+' and '/' in standard base64.
    for (const raw of ['>>>', '???', 'any carnal pleasure']) {
      const encoded = base64url(raw);
      expect(encoded).not.toContain('=');
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(Buffer.from(encoded, 'base64url').toString()).toBe(raw);
    }
  });
});

describe('vapidSigningInput', () => {
  it('is two base64url segments joined by a dot, and round-trips', () => {
    const claims = vapidClaims(ENDPOINT, 'mailto:x@y', NOW);
    const input = vapidSigningInput(claims);
    const [header, payload] = input.split('.');
    expect(input.split('.')).toHaveLength(2);
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual(claims);
  });

  it('declares ES256, which is the only algorithm the spec allows', () => {
    const [header] = vapidSigningInput(vapidClaims(ENDPOINT, 'mailto:x@y', NOW)).split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString()).alg).toBe('ES256');
  });
});

describe('vapidAuthorization', () => {
  it('carries the token and the public key, because the service has never seen this sender', () => {
    const header = vapidAuthorization('aaa.bbb', 'ccc', 'PUB');
    expect(header).toBe('vapid t=aaa.bbb.ccc, k=PUB');
    // Three dot-separated JWT segments, not two: the signature is appended to the signing input.
    expect(header.split(' ')[1].replace('t=', '').replace(',', '').split('.')).toHaveLength(3);
  });
});
