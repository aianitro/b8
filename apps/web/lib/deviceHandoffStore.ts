// Persistence for the browser → app credential handoff. The rules are in
// `lib/domain/deviceHandoff.ts`; this file only stores hashes and performs the exchange.

import { randomBytes } from 'node:crypto';
import db from '@/lib/db';
import { createDeviceSession } from '@/lib/authSession';
import { hashSessionToken } from '@/lib/sessionToken';
import { decideClaim, handoffExpiry, handoffSweepCutoff, type ClaimVerdict } from '@/lib/domain/deviceHandoff';

/** 32 CSPRNG bytes, base64url. The same generator the session tokens use, for the same reason. */
function generateCode(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Mint a handoff code for a credential that has just completed a ceremony.
 *
 * Returns the code ONCE. Only its SHA-256 is stored — `hashSessionToken` is reused rather than a
 * second hashing convention, so there is one answer in this codebase to "how is a credential stored".
 */
export async function createHandoff(credentialId: string, now: Date): Promise<string> {
  const code = generateCode();
  await db.query(
    'INSERT INTO device_handoffs (code_hash, credential_id, expires_at) VALUES ($1, $2, $3)',
    [hashSessionToken(code), credentialId, handoffExpiry(now).toISOString()]
  );
  return code;
}

export type ClaimResult =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; code: string; message: string };

/**
 * Exchange a code for a device session.
 *
 * ONE TRANSACTION WITH THE ROW LOCKED. Without `FOR UPDATE`, two claims racing both read
 * `claimed_at IS NULL`, both pass the pure check, and both mint a session — the replay the
 * single-use rule exists to prevent, arriving through concurrency instead of a resent request. The
 * same argument as `lib/proposalStore.ts`, and it is the second time it has applied.
 */
export async function claimHandoff(code: string, now: Date): Promise<ClaimResult> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const found = await client.query<{ credential_id: string; expires_at: Date; claimed_at: Date | null }>(
      `SELECT credential_id, expires_at, claimed_at
         FROM device_handoffs WHERE code_hash = $1 FOR UPDATE`,
      [hashSessionToken(code)]
    );

    const verdict: ClaimVerdict = decideClaim(
      found.rows.length
        ? {
            credentialId: found.rows[0].credential_id,
            expiresAt: new Date(found.rows[0].expires_at),
            claimedAt: found.rows[0].claimed_at ? new Date(found.rows[0].claimed_at) : null,
          }
        : null,
      now
    );

    if (!verdict.ok) {
      await client.query('ROLLBACK');
      return { ok: false, code: verdict.code, message: verdict.message };
    }

    // Marked spent BEFORE the session is minted, inside the same transaction. If minting throws, the
    // rollback takes the claim with it — the alternative is a code that is spent with nothing to show.
    await client.query(
      'UPDATE device_handoffs SET claimed_at = $2 WHERE code_hash = $1',
      [hashSessionToken(code), now.toISOString()]
    );

    const session = await createDeviceSession(verdict.credentialId);
    await client.query('COMMIT');
    return { ok: true, ...session };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Remove codes that can never be claimed again — after a retention window, not immediately.
 *
 * CORRECTED: this once read `expires_at < $1 OR claimed_at IS NOT NULL`, deleting every claimed row
 * the moment it was spent. That made `decideClaim`'s `ALREADY_CLAIMED` branch unreachable — a replay
 * found no row and came back `NOT_FOUND`. Refused either way, so nothing was exploitable, but the
 * ordering that branch exists for was asserted by a fixture and delivered by nothing. Found by
 * looking at the table after a real sign-in and seeing it empty.
 *
 * One condition now, and it covers both cases: a claimed row and an unclaimed one both have an
 * `expires_at` within a minute of creation, so a single cutoff sweeps both once they are an hour
 * old. See `HANDOFF_RETENTION_MS`.
 *
 * Called from the claim path rather than on a timer: the table is touched once per sign-in, so the
 * cheapest place to keep it small is where it is already being written. No timer to forget.
 */
export async function pruneHandoffs(now: Date): Promise<void> {
  await db.query(
    'DELETE FROM device_handoffs WHERE expires_at < $1',
    [handoffSweepCutoff(now).toISOString()]
  );
}
