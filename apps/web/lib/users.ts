// Every statement this app runs against `users`, apart from the two INSERTs that create one —
// those belong to `enrolCredential` (lib/authSession.ts), because a user is only ever created in
// the same transaction as their first passkey.
//
// THE PEERS SEE THE SAME LEDGER. Nothing in this file is, or may become, a predicate on a data
// query: `users` decides who may sign in, whose push devices a ping goes to, and who is shown as
// signed in. It decides nothing about which accounts, transactions or budgets anybody sees
// (SPEC.md's first non-goal, and acceptance #8's grep).

import type { PoolClient } from 'pg';
import db from './db';
import { OWNER_USER_HANDLE, OWNER_USER_NAME } from './webauthnOrigins';

export interface UserRecord {
  id: number;
  displayName: string;
  isOwner: boolean;
}

/**
 * The user `id` names, if they exist and have not been removed — otherwise `null`.
 *
 * A REMOVED USER IS `null`, not a record with a flag. Every caller of this asks "who is this
 * session's person", and a removed person is nobody's answer to that; a session for one cannot
 * resolve in the first place (`resolveSession` requires `users.revoked_at IS NULL`), so this is the
 * same rule stated where a second reader would look for it.
 */
export async function findUser(id: number): Promise<UserRecord | null> {
  const result = await db.query<{ id: number; display_name: string; is_owner: boolean }>(
    'SELECT id, display_name, is_owner FROM users WHERE id = $1 AND revoked_at IS NULL',
    [id]
  );
  const row = result.rows[0];
  return row ? { id: row.id, displayName: row.display_name, isOwner: row.is_owner } : null;
}

export type RevokeOutcome = 'revoked' | 'not-found' | 'owner';

/**
 * Remove a user: their passkeys, sessions and personal tokens stop working, their push devices stop
 * receiving, and the `users` row stays.
 *
 * ONE TRANSACTION, WITH THE ROW LOCKED. Four writes that must land together — a removal that set
 * `revoked_at` and then failed before deleting the credentials would leave a user who is "removed"
 * and can still sign in on any path that forgot the `revoked_at` conjunct.
 *
 * WHY EACH WRITE:
 *
 *   `users.revoked_at = NOW()` — the record that removal happened, and when. Guarded by
 *   `revoked_at IS NULL` so a second removal does not overwrite the first timestamp. The owner is
 *   refused above it AND by `users_owner_not_revoked`, so a path that forgot the check still cannot
 *   leave the app with nobody able to invite or remove.
 *
 *   DELETE the user's `webauthn_credentials` — what actually stops the passkeys. It cascades their
 *   sessions of every kind (browser, device and personal tokens all hang off a credential) and their
 *   device handoffs. Setting a flag instead would leave the credential rows answering login
 *   assertions, and a login path that did not read the flag would sign them in.
 *
 *   `web_push_subscriptions.revoked_at = NOW()` — their phones stop receiving. An UPDATE, not a
 *   DELETE, for the reason `revokeSession` gives: "revoked" and "never existed" are different facts.
 *
 *   NOT deleted: the `users` row. `agent_proposals.decided_by_user_id` points at it as history, and
 *   the foreign key (no ON DELETE action) would refuse the delete anyway. Deleting the credentials
 *   sets `agent_proposals.decided_by` (the SESSION) to NULL through its own SET NULL — the person
 *   column is untouched, which is what that column exists for.
 */
export async function revokeUser(id: number): Promise<RevokeOutcome> {
  const client: PoolClient = await db.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query<{ is_owner: boolean }>(
      'SELECT is_owner FROM users WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (found.rows.length === 0) {
      await client.query('ROLLBACK');
      return 'not-found';
    }
    if (found.rows[0].is_owner) {
      await client.query('ROLLBACK');
      return 'owner';
    }

    await client.query('UPDATE users SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL', [id]);
    await client.query('DELETE FROM webauthn_credentials WHERE user_id = $1', [id]);
    await client.query(
      'UPDATE web_push_subscriptions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
      [id]
    );
    await client.query('COMMIT');
    return 'revoked';
  } catch (caught) {
    await client.query('ROLLBACK').catch(() => {});
    throw caught;
  } finally {
    client.release();
  }
}

/** The WebAuthn `user` fields a registration ceremony carries: the handle and the shown name. */
export interface WebauthnIdentity {
  handle: string;
  name: string;
}

/**
 * The stable WebAuthn user handle and name for whoever is enrolling — the owner, an existing
 * second user adding a device, or an invitee who is not yet anybody.
 *
 * THE OWNER KEEPS THE CONSTANT. The owner's passkeys were enrolled under `OWNER_USER_HANDLE` before
 * P7-41a, and a platform authenticator recognises "the same account" by that handle; changing it
 * would make the owner's next added device a second account on the same phone.
 *
 * EVERYONE ELSE GETS A DIFFERENT, STABLE HANDLE, derived from the invitation that created them. Two
 * people enrolling under ONE handle on a shared password manager makes the second enrolment silently
 * REPLACE the first person's passkey, which is why the handle must differ. It must also be stable —
 * the same at the invitee's first enrolment and at every device they add later — and the invitee
 * has no `users.id` yet when `register/options` runs (the user is created at `verify`). The one
 * fact present at both moments is the invitation: its hash at redemption, and the row
 * `consumed_by` that user afterwards. So the handle is a prefix of that hash, under a `b8-invited-`
 * label the owner's `b8-owner` cannot collide with. It reveals nothing: a SHA-256 prefix is not a
 * route back to the code, and the only party that ever sees it is the invitee's own authenticator.
 *
 * NEVER READ BACK. The handle a browser returns is never used to find a user or a credential; the
 * user is always read off the credential row. This function only decides what to WRITE.
 *
 * `null` when there is nobody to name — an invitation hash that matches nothing, or a user who is
 * not the owner and was created by no invitation (which no code path produces). The caller refuses.
 */
export async function webauthnIdentityFor(
  of: { bootstrap: true } | { userId: number } | { codeHash: string }
): Promise<WebauthnIdentity | null> {
  const owner = { handle: OWNER_USER_HANDLE, name: OWNER_USER_NAME };
  if ('bootstrap' in of) return owner;

  if ('codeHash' in of) {
    const result = await db.query<{ display_name: string }>(
      'SELECT display_name FROM user_invitations WHERE code_hash = $1',
      [of.codeHash]
    );
    const row = result.rows[0];
    return row ? { handle: invitedHandle(of.codeHash), name: row.display_name } : null;
  }

  const result = await db.query<{ is_owner: boolean; display_name: string; code_hash: string | null }>(
    `SELECT u.is_owner, u.display_name, i.code_hash
       FROM users u
       LEFT JOIN user_invitations i ON i.consumed_by = u.id
      WHERE u.id = $1 AND u.revoked_at IS NULL`,
    [of.userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.is_owner) return owner;
  return row.code_hash ? { handle: invitedHandle(row.code_hash), name: row.display_name } : null;
}

/** 128 bits of the invitation's hash, hex — inside the base64url alphabet the contract requires. */
function invitedHandle(codeHash: string): string {
  return `b8-invited-${codeHash.slice(0, 32)}`;
}
