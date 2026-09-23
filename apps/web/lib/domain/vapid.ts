/**
 * The claims and encoding a VAPID push is authorised by — §5 step 26b.
 *
 * ─── Pure, because the interesting parts are decisions rather than cryptography ───────────────
 *
 * Signing needs a key and belongs in the shell. What belongs here is everything that can be wrong
 * without failing loudly: the audience, the expiry, and the base64url spelling. A wrong `aud` is
 * accepted by nothing and reported by no one — the push service answers 401 and the owner's phone
 * simply never buzzes — so it is worth a test rather than a comment.
 *
 * ─── Why this repo does not depend on `web-push` ──────────────────────────────────────────────
 *
 * That library exists mostly to encrypt a payload: aes128gcm with an ECDH key agreement per
 * subscription, which is real cryptography and not worth hand-rolling. This app sends NO PAYLOAD.
 * The ping's text is a constant the service worker already holds (`pushPing.ts`'s `PING`, and its
 * docblock explains why it is a constant rather than a template), so a push here is a bare wake-up.
 *
 * That leaves only the VAPID JWT, which is an ES256 signature over two small JSON objects. The
 * property is worth stating plainly: THE PING'S TEXT CANNOT LEAK IN TRANSIT BECAUSE IT IS NEVER IN
 * TRANSIT. The owner's content-free decision did not just narrow what is sent — it removed the
 * cryptography that would otherwise be needed to protect it.
 */

/** Base64url, no padding — what JWTs and the Web Push spec use everywhere. */
export function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export interface VapidClaims {
  /** The push service's ORIGIN, not the subscription URL. */
  aud: string;
  /** Seconds since the epoch. */
  exp: number;
  /** How the push service contacts whoever sent this. */
  sub: string;
}

/**
 * Twelve hours. The spec's ceiling is 24 and a shorter life is the safer half of the range, but
 * this is not a session — it is signed fresh for every send. The only thing the window protects
 * against is a JWT captured in transit being replayed, and twelve hours costs nothing because
 * nothing reuses one.
 */
export const VAPID_TTL_SECONDS = 12 * 60 * 60;

/**
 * `aud` is the ORIGIN of the endpoint, and this is the mistake worth guarding.
 *
 * A subscription endpoint is a long URL with a per-device token in its path. Signing the whole URL
 * as the audience is the obvious reading, is wrong, and fails as a 401 from the push service with
 * no indication of which claim was at fault — the symptom is a phone that never buzzes.
 */
export function vapidClaims(endpoint: string, subject: string, nowMs: number): VapidClaims {
  return {
    aud: new URL(endpoint).origin,
    exp: Math.floor(nowMs / 1000) + VAPID_TTL_SECONDS,
    sub: subject,
  };
}

/** The signing input: `base64url(header) + '.' + base64url(claims)`. */
export function vapidSigningInput(claims: VapidClaims): string {
  const header = base64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = base64url(JSON.stringify(claims));
  return `${header}.${payload}`;
}

/**
 * The `Authorization` header value, given a signature.
 *
 * The `vapid` scheme carries BOTH the token and the public key, because the push service has never
 * seen this sender before and has nothing to verify the signature against otherwise.
 */
export function vapidAuthorization(signingInput: string, signature: string, publicKey: string): string {
  return `vapid t=${signingInput}.${signature}, k=${publicKey}`;
}
