// Invitations: how the owner lets a second person enrol a passkey of their own (P7-41a).
//
// THE SHAPE IS `device_handoffs`', FOR THE SAME PROBLEM. A short-lived, single-use secret in flight
// between two people. The owner mints it while signed in, reads it off the screen once, and hands it
// over in person; the invitee presents it in the `X-Invitation-Code` header on the two existing
// `register/*` endpoints. There is no new pre-auth path and no delivery mechanism — no mail, no
// link — because every one of those is a place the code would be written down.
//
// WHAT LIVES HERE AND WHAT DOES NOT. Minting, hashing and the read-only liveness check are here.
// REDEMPTION is not: consuming an invitation has to be one atomic outcome with creating the user,
// the credential and the session, so it is a branch of `enrolCredential` in `lib/authSession.ts`
// and runs on that transaction's connection. A redemption helper in this file would be a second
// transaction, which is exactly the "checked here, consumed there" split SPEC.md lists as a failure
// mode: a crash between the two leaves a consumed code with no user, or a user with a live code.
//
// THE CODE IS NEVER STORED, NEVER LOGGED, NEVER COMPARED IN JAVASCRIPT. The table holds its SHA-256
// (a CHECK makes the raw code an unwritable value), lookups are by that hash in SQL, and "is it
// still live" is Postgres `NOW()` against `expires_at` — the one clock every other expiry in the
// auth module uses.

import { createHash, randomBytes } from 'node:crypto';
import db from './db';
import { invitationCode } from '@b8/contracts/auth';

/**
 * How long a freshly minted invitation stays redeemable: forty-eight hours.
 *
 * Inside the seven-day ceiling the table enforces (`user_invitations_lifetime`), and deliberately
 * well short of it. The code is handed over in person and redeemed on the spot or that evening; it
 * is the only thing between any visitor and a new user, and it is presented to endpoints anyone can
 * reach. A code that sits in a pocket for a week is a week of exposure that buys nothing — minting
 * another costs the owner one tap. Two days rather than one so that "I'll set it up tomorrow" works.
 */
export const INVITATION_TTL_HOURS = 48;

/**
 * Sixteen CSPRNG bytes, unpadded base64url: 22 characters, the floor `invitationCode` pins.
 *
 * Not the 32 a session token carries. A session token is held by a browser and never seen; this
 * one is read off one screen and entered on another, so every character is a chance to mistype it.
 * 128 bits is far beyond guessable over a network for a code that lives two days and is checked
 * against a database by hash.
 */
export function generateInvitationCode(): string {
  return randomBytes(16).toString('base64url');
}

/** SHA-256, lowercase hex — the only form of the code Postgres ever sees. */
export function hashInvitationCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/**
 * Mint an invitation for a person the owner names, and return the raw code exactly once.
 *
 * The caller is responsible for having established that `createdBy` is the owner's full-scope
 * browser session (`sessionMayAdminister`); the database cannot see sessions and does not try.
 *
 * `expires_at` IS COMPUTED IN SQL, from the same statement's `NOW()` that fills `created_at`, so
 * the lifetime CHECK compares two values from one clock reading rather than a JS `Date` against the
 * database's.
 */
export async function createInvitation(options: {
  createdBy: number;
  displayName: string;
}): Promise<{ code: string; expiresAt: string }> {
  const code = generateInvitationCode();
  const result = await db.query<{ expires_at: Date }>(
    `INSERT INTO user_invitations (code_hash, created_by, display_name, expires_at)
     VALUES ($1, $2, $3, NOW() + make_interval(hours => $4::int))
     RETURNING expires_at`,
    [hashInvitationCode(code), options.createdBy, options.displayName, INVITATION_TTL_HOURS]
  );
  return { code, expiresAt: result.rows[0].expires_at.toISOString() };
}

/**
 * The hash of `presented`, if it names an invitation that is live right now — otherwise `null`.
 *
 * READ-ONLY, AND NOT THE GATE. `register/options` uses this to decide whether to issue creation
 * options at all, and `register/verify` uses it to refuse a dead code before spending the
 * ceremony's challenge on it. Neither of those is the decision that matters: between this read and
 * the enrolment another redemption may commit, and the code may expire. The decision is the locked
 * re-check inside `enrolCredential`, which this cannot replace.
 *
 * A HEADER THAT FAILS THE FORMAT IS `null`, EXACTLY AS A WELL-FORMED CODE THAT MATCHES NOTHING IS,
 * so a prober learns nothing from which of the two it sent. The format check runs first only to
 * avoid hashing arbitrary-length input.
 */
export async function liveInvitationHash(presented: string | null): Promise<string | null> {
  if (presented === null || !invitationCode.safeParse(presented).success) return null;
  const codeHash = hashInvitationCode(presented);
  const result = await db.query(
    `SELECT 1 FROM user_invitations
      WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()`,
    [codeHash]
  );
  return result.rows.length > 0 ? codeHash : null;
}

/**
 * The request header an invitee's code travels in, on BOTH `register/options` and
 * `register/verify` — lowercased, as `Headers.get` matches case-insensitively anyway.
 *
 * A header rather than a body field because the two endpoints have different bodies (options has
 * none, verify carries the ceremony response), and the code must be re-presented and re-checked on
 * each: options saying yes and verify not asking again is how a stranger gets enrolled.
 */
export const INVITATION_HEADER = 'x-invitation-code';
