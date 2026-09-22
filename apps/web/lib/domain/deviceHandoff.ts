// Handing a credential from the browser that earned it to the app that will use it.
//
// Pure. The rules that matter — how long a code lives, when a claim is refused, and which redirect
// targets are allowed — are decided here from facts passed in, so each is testable without a
// database, a browser or a phone.

/** Sixty seconds. See the migration's note: the code is in flight for one redirect and one request. */
export const HANDOFF_TTL_MS = 60_000;

export function handoffExpiry(now: Date): Date {
  return new Date(now.getTime() + HANDOFF_TTL_MS);
}

/**
 * How long a spent or dead code is KEPT before being swept.
 *
 * NOT ZERO, and that was a real defect. The first version of the sweep deleted every claimed row
 * immediately, which made `ALREADY_CLAIMED` below UNREACHABLE IN PRODUCTION — a replayed code found
 * no row and was reported as `NOT_FOUND`. Still refused, so nothing was exploitable; but the check
 * was ordered ahead of `EXPIRED` on purpose, a fixture asserts that ordering, and the store had
 * quietly made the branch dead. A test over an unreachable branch is the defect class this repo
 * keeps finding, arriving this time through a `DELETE`.
 *
 * An hour is long enough that a replay within any plausible attack window is diagnosable, and short
 * enough that the table stays a handful of rows.
 */
export const HANDOFF_RETENTION_MS = 60 * 60_000;

/** The cutoff a sweep deletes below: anything whose expiry is older than the retention window. */
export function handoffSweepCutoff(now: Date): Date {
  return new Date(now.getTime() - HANDOFF_RETENTION_MS);
}

export interface StoredHandoff {
  credentialId: string;
  expiresAt: Date;
  claimedAt: Date | null;
}

export type ClaimVerdict =
  | { ok: true; credentialId: string }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_CLAIMED' | 'EXPIRED'; message: string };

/**
 * May this code be exchanged for a device session?
 *
 * ALREADY_CLAIMED IS CHECKED BEFORE EXPIRED, deliberately and for the same reason
 * `lib/domain/proposal.ts` orders its checks that way: a code presented twice inside its minute is a
 * replay, and a code presented after its minute is a slow user. Only one of those is an attack, and
 * reporting the clock for the first would hide it.
 */
export function decideClaim(handoff: StoredHandoff | null, now: Date): ClaimVerdict {
  if (!handoff) {
    return { ok: false, code: 'NOT_FOUND', message: 'That link is not valid. Sign in again.' };
  }
  if (handoff.claimedAt) {
    return { ok: false, code: 'ALREADY_CLAIMED', message: 'That link was already used. Sign in again.' };
  }
  if (now >= handoff.expiresAt) {
    return { ok: false, code: 'EXPIRED', message: 'That link expired. Sign in again.' };
  }
  return { ok: true, credentialId: handoff.credentialId };
}

/**
 * The only redirect targets the sign-in page may send a code to.
 *
 * AN OPEN REDIRECT CARRYING A SECRET IS THE OAUTH VULNERABILITY, so this is an allowlist of SCHEMES
 * rather than a check that the value looks like a URL. `b8://` is the app's own scheme, declared in
 * `apps/mobile/app.json`; `exp://` is how Expo Go addresses a development client and is what
 * `Linking.createURL` returns there. Anything else — `https://`, `javascript:`, a bare path — is
 * refused, so a crafted link cannot make an authenticated browser post a code somewhere else.
 */
const ALLOWED_SCHEMES = ['b8://', 'exp://'] as const;

export function isAllowedHandoffTarget(target: string): boolean {
  const value = target.trim();
  // Lowercased for the scheme test only: schemes are case-insensitive, and `B8://` is the same
  // target. The rest of the URI is left alone, because Expo Go's path is case-sensitive.
  const lower = value.toLowerCase();
  if (!ALLOWED_SCHEMES.some((scheme) => lower.startsWith(scheme))) return false;
  // A newline in a redirect target is header-injection shaped and has no legitimate use here.
  return !/[\r\n]/.test(value);
}
