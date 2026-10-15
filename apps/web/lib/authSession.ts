// Every statement this task runs against the two new tables, in one module.
//
// WHY ONE MODULE. The validity predicate is the sentence a call site is most likely to re-derive
// with one conjunct missing, and a missing conjunct here is an authentication bypass that renders
// perfectly. `migrations/1789300800000_…` writes it down once; this file is the one place in the
// application that speaks it, so the boundary and the five handlers cannot drift into two readings
// of "is this request signed in".
//
// THE PREDICATE IS EVALUATED BY POSTGRES, NEVER IN JAVASCRIPT, and that is not a style preference.
// `expires_at` and `revoked_at` are `TIMESTAMPTZ`; `pg` hands them back as a JS `Date` inside a
// handler and `Response.json` turns them into an ISO string on the way out, so a comparison written
// in JS works against one representation and silently misbehaves against the other — P1-11 shipped
// exactly that boundary defect once. It would also introduce a second clock. `NOW()` is the
// database's clock and there is one of it.
//
// FAIL CLOSED IS THE CALLER'S JOB, and this module is written so the caller can do it: nothing here
// catches a connection failure and returns a benign value. A lookup that cannot reach Postgres
// THROWS, and `proxy.ts` turns a throw into a refusal. The one shape this file must never take is
// `catch { return null }` where `null` would read as "no session" — which is also a refusal here,
// but only by luck, and luck is not a boundary.

import type { PoolClient } from 'pg';
import db from './db';
import { SESSION_TTL_SECONDS, generateSessionToken, hashSessionToken } from './sessionToken';
import { personalTokenDays, type SessionKind, type SessionScope } from './bearerAuth';
import type { StoredCredential } from './webauthnVerify';

/** A session that exists, is unrevoked, and has not expired — the only kind this module returns. */
export interface ActiveSession {
  tokenHash: string;
  credentialId: string;
  /** Which carrier may present it and how long it lives — see lib/bearerAuth.ts. */
  kind: SessionKind;
  /** What it may do. Only personal tokens are ever `read`; the schema enforces that. */
  scope: SessionScope;
  /**
   * The person this session belongs to — `users.id`, reached through the session's credential.
   *
   * NEVER NULL, AND NEVER DEFAULTED. A session row names a credential (`NOT NULL`), and a credential
   * names a user (`NOT NULL`, P7-41a), so the join below has no gap to fall through: a lookup that
   * finds no user has found no session, and returns `null` for the whole thing. There is no branch
   * anywhere that answers "the owner" for want of an answer — that guess is exactly what would let a
   * removed user's surviving cookie act as the owner.
   */
  userId: number;
}

/**
 * The session a raw cookie value names, or `null`.
 *
 * NO COOKIE, AN EMPTY COOKIE, AND A COOKIE MATCHING NO ROW ARE THE SAME OUTCOME — SPEC.md's null
 * semantics for this task, and the reason the argument is `string | null | undefined` rather than
 * `string`. There is no guest, no read-only and no partially-resolved session in this app's model,
 * so every one of those inputs produces `null` and every caller treats `null` as "refuse".
 *
 * The empty/absent case returns without a query. That is not an optimisation: hashing `''` produces
 * a perfectly valid 64-character digest, and a row could in principle be created whose token hashes
 * to it, so refusing before the lookup keeps "the caller presented nothing" from ever being a
 * lookup that could succeed.
 */
export async function resolveSession(token: string | null | undefined): Promise<ActiveSession | null> {
  if (!token) return null;

  // THROUGH THE CREDENTIAL TO THE USER, and the user must not be removed. Sessions carry no user of
  // their own (the migration says why: a second copy is a second answer that could disagree), so
  // the person is read off `webauthn_credentials.user_id`. `users.revoked_at IS NULL` is the third
  // conjunct of "is this request signed in" since P7-41a. Revoking a user also deletes their
  // credentials, which cascades the sessions away — so on its own this conjunct is belt and braces;
  // it is here so that a revoke which somehow left a credential behind still signs nobody in.
  const result = await db.query<{
    token_hash: string; credential_id: string; kind: SessionKind; scope: SessionScope; user_id: number;
  }>(
    `SELECT s.token_hash, s.credential_id, s.kind, s.scope, c.user_id
       FROM auth_sessions s
       JOIN webauthn_credentials c ON c.credential_id = s.credential_id
       JOIN users u ON u.id = c.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
        AND u.revoked_at IS NULL`,
    [hashSessionToken(token)]
  );

  const row = result.rows[0];
  return row
    ? {
        tokenHash: row.token_hash,
        credentialId: row.credential_id,
        kind: row.kind,
        scope: row.scope,
        userId: row.user_id,
      }
    : null;
}

/**
 * How many credentials are enrolled.
 *
 * THE BOOTSTRAP GATE READS THIS, and it is a GLOBAL count — still, after P7-41a gave every
 * credential a user. "Zero credentials exist" is a question with one answer; "zero for this user"
 * is a question an unauthenticated request cannot ask without naming a user it has invented, which
 * is the argument the passkey migration made and the second-user migration keeps. A count per user
 * would reopen the bootstrap window for every person the app has never heard of.
 *
 * It is not the whole gate. A count is a read-modify-write with a window in it, and the window is
 * closed by `webauthn_credentials_one_bootstrap` — see `enrolCredential`. The count is what
 * produces a clean refusal in the ordinary case; the index is what covers the concurrent one.
 */
/**
 * Record that a session was used.
 *
 * THROTTLED TO ONCE EVERY FIVE MINUTES PER SESSION, in the WHERE clause, so a client polling the
 * API does not turn every read into a write. The boundary and the handler both resolve the same
 * request; the second call finds the row already touched and does nothing.
 *
 * Nothing is extended. A browser session is 12 hours from sign-in by design, and a personal token's
 * lifetime is whatever the owner chose when minting it. The sliding expiry that lived here was the
 * phone app's device session, retired with `apps/mobile`.
 */
export async function touchSession(tokenHash: string): Promise<void> {
  await db.query(
    `UPDATE auth_sessions
        SET last_used_at = NOW()
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '5 minutes')`,
    [tokenHash]
  );
}

export async function countCredentials(): Promise<number> {
  const result = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM webauthn_credentials');
  return Number(result.rows[0].count);
}

/**
 * Every enrolled credential, oldest first — or every credential of ONE user, when `of` names one.
 *
 * EVERY one, by default. `allowCredentials` in a login ceremony lists all of them, and the assertion
 * lookup matches over all of them; a query that returned only the newest would let a second device
 * register successfully and never sign in, which looks like a hardware fault and is a `LIMIT 1`. The
 * login path stays unfiltered after P7-41a: it is pre-auth, it does not yet know who is asking, and
 * the user is read off whichever credential the assertion turns out to name.
 *
 * `of` IS FOR `excludeCredentials` ON REGISTRATION, and only for that. A signed-in user adding a
 * device should be told not to re-enrol an authenticator THEY already enrolled. Listing the other
 * user's credentials there would hand one person the other's credential ids for no benefit — the
 * authenticator holds the other person's passkey under a different user handle, so excluding it
 * would not stop a duplicate anyway.
 *
 * `sign_count` is `BIGINT`, which `pg` hands back as a STRING to avoid silently truncating values
 * past 2^53. The conversion is explicit here rather than left to a `==` somewhere downstream: a
 * counter compared as a string orders `'9'` after `'10'`, which would make clone detection fire on
 * an honest authenticator and stay silent on a cloned one.
 */
export async function listCredentials(of?: { userId: number }): Promise<StoredCredential[]> {
  const result = await db.query<{
    credential_id: string;
    public_key: Buffer;
    sign_count: string;
    transports: string[] | null;
  }>(
    `SELECT credential_id, public_key, sign_count, transports
       FROM webauthn_credentials
      WHERE $1::int IS NULL OR user_id = $1::int
      ORDER BY created_at, credential_id`,
    [of?.userId ?? null]
  );
  return result.rows.map((row) => ({
    credentialId: row.credential_id,
    publicKey: row.public_key,
    signCount: Number(row.sign_count),
    transports: row.transports,
  }));
}

/** Why an enrolment did not happen, for the handler to turn into a wire code. */
export type EnrolmentRefusal = 'REGISTRATION_CLOSED' | 'CREDENTIAL_ALREADY_ENROLLED';

export type EnrolmentResult =
  | { enrolled: true; sessionToken: string; userId: number }
  | { enrolled: false; refusal: EnrolmentRefusal };

/**
 * Which door an enrolment came through, and therefore WHOSE credential it becomes.
 *
 * The three cases are a union rather than a tag plus an optional user id, because each one decides
 * the user differently and a shape that let a caller pass `{ via: 'invitation', userId: owner }`
 * would be a shape in which an invited passkey can be attached to the owner:
 *
 *   `bootstrap` — zero credentials existed. The user is CREATED here, as the owner, in the same
 *   transaction. Nobody else is ever created this way: `users_one_owner` refuses a second owner.
 *
 *   `authenticated` — a signed-in browser added a device. The user is the SIGNED-IN user, taken
 *   from the session by the caller. Not the owner by default, which is the mutation S10 holds.
 *
 *   `invitation` — no session, a live invitation presented. The user is CREATED here, not the
 *   owner, from the invitation's display name, and the invitation is consumed in the same
 *   transaction. The caller passes only the code's hash; whether that hash names a live invitation
 *   is decided inside the transaction, under a row lock, by Postgres `NOW()`.
 */
export type EnrolmentPath =
  | { via: 'bootstrap' }
  | { via: 'authenticated'; userId: number }
  | { via: 'invitation'; codeHash: string };

/** The Postgres SQLSTATE for a unique violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Unique violations that mean "somebody else got there first" rather than "this authenticator is
 * already enrolled". Each is a race this request lost, and each is reported exactly as the count
 * check reports a closed gate: `webauthn_credentials_one_bootstrap` and `users_one_owner` are two
 * concurrent bootstraps; `user_invitations_consumed_by_key` is two concurrent redemptions of one
 * invitation that both slipped past the row lock's re-check (which READ COMMITTED should make
 * impossible — the constraint is the backstop, and a backstop that fires must still refuse cleanly).
 */
const LOST_RACE_CONSTRAINTS: ReadonlySet<string> = new Set([
  'webauthn_credentials_one_bootstrap',
  'users_one_owner',
  'user_invitations_consumed_by_key',
]);

/**
 * Enrol a credential and open a session for it, in one transaction.
 *
 * ONE TRANSACTION, USER AND CREDENTIAL FIRST. `auth_sessions.credential_id` is `NOT NULL` and
 * `webauthn_credentials.user_id` is `NOT NULL`, so the order is forced; the transaction is what
 * stops a bootstrap credential existing with NO session after a mid-write failure. That state would
 * be unrecoverable in the worst way available here: the single `'bootstrap'` slot is spent,
 * registration is therefore closed, and nobody is signed in to open it again.
 *
 * FOR AN INVITATION, THE CONSUMPTION IS INSIDE THE SAME TRANSACTION, and that is the property S8
 * and S6 hold together. The invitation is locked first (`FOR UPDATE`, with the liveness predicate
 * in the WHERE clause so a concurrent redeemer that committed first makes this one find nothing),
 * then the user, the credential, the consumption and the session are written, then COMMIT. Any
 * failure — a credential already enrolled, a lost race, a dropped connection — rolls back all of
 * it, so there is no state with a consumed code and no user, or a user and an unconsumed code. The
 * ceremony itself is verified by the CALLER before this runs; nothing here consumes anything for a
 * ceremony that did not verify.
 *
 * THE PATH IS THE CALLER'S, AND IT IS THE HALF THE DATABASE CANNOT CHECK. The partial unique index
 * makes at most one `'bootstrap'` row possible however two concurrent requests interleave — the
 * race is closed in the schema — but Postgres cannot see whether a request carried a session, so a
 * handler that tags a session-less enrolment `'authenticated'` still enrols a stranger and
 * satisfies every constraint. That is the authorization hole, it is closed in
 * `app/api/v1/auth/register/verify/route.ts`, and the register fixtures hold it.
 *
 * THE UNIQUE VIOLATION IS CAUGHT, NOT PRE-EMPTED. There is no retry: a retry would be an attempt to
 * win a race this code has already lost, and losing it is the correct outcome.
 */
export async function enrolCredential(options: {
  credential: StoredCredential;
  path: EnrolmentPath;
}): Promise<EnrolmentResult> {
  const client: PoolClient = await db.connect();
  try {
    await client.query('BEGIN');

    let userId: number;
    let enrolledVia: 'bootstrap' | 'authenticated' | 'invitation';
    if (options.path.via === 'bootstrap') {
      // The neutral name the migration gives a backfilled owner, for the same reason: the app has
      // never been told this person's name, and inventing one would be a guess. A second
      // concurrent bootstrap fails here on `users_one_owner`, before it reaches the credential.
      const created = await client.query<{ id: number }>(
        `INSERT INTO users (display_name, is_owner) VALUES ('Owner', TRUE) RETURNING id`
      );
      userId = created.rows[0].id;
      enrolledVia = 'bootstrap';
    } else if (options.path.via === 'authenticated') {
      // THE SIGNED-IN USER MUST STILL BE A USER, checked here, in this transaction, rather than
      // trusted from the session the caller resolved a moment ago. `resolveSession` refuses a removed
      // user's session, but a removal can commit between that read and this INSERT, and the result
      // would be a fresh passkey for someone the owner has just removed — one that survives the
      // removal, because `revokeUser` deleted the credentials that existed when it ran.
      //
      // `FOR SHARE` makes the two orderings safe. If the removal commits first, this read finds
      // `revoked_at` set and refuses. If this read comes first, `revokeUser`'s `FOR UPDATE` on the
      // same row waits for this transaction, and its DELETE then removes the credential written
      // here as well. Refused as `REGISTRATION_CLOSED`: from the caller's side the gate is shut.
      const live = await client.query(
        'SELECT 1 FROM users WHERE id = $1 AND revoked_at IS NULL FOR SHARE',
        [options.path.userId]
      );
      if (live.rows.length === 0) {
        await client.query('ROLLBACK');
        return { enrolled: false, refusal: 'REGISTRATION_CLOSED' };
      }
      userId = options.path.userId;
      enrolledVia = 'authenticated';
    } else {
      // BOTH CONJUNCTS OF "LIVE", in SQL, on the clock that decides every other expiry in this
      // module. The code was hashed by the caller; it is compared here as a primary-key lookup,
      // never in JavaScript.
      const invitation = await client.query<{ display_name: string }>(
        `SELECT display_name FROM user_invitations
          WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()
          FOR UPDATE`,
        [options.path.codeHash]
      );
      if (invitation.rows.length === 0) {
        await client.query('ROLLBACK');
        return { enrolled: false, refusal: 'REGISTRATION_CLOSED' };
      }
      // `is_owner` is stated FALSE rather than left to the column default, so the one line that
      // decides whether an invitee becomes a peer or the owner is a line a reader can see.
      const created = await client.query<{ id: number }>(
        `INSERT INTO users (display_name, is_owner) VALUES ($1, FALSE) RETURNING id`,
        [invitation.rows[0].display_name]
      );
      userId = created.rows[0].id;
      enrolledVia = 'invitation';
    }

    await client.query(
      `INSERT INTO webauthn_credentials (credential_id, public_key, sign_count, transports, enrolled_via, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        options.credential.credentialId,
        Buffer.from(options.credential.publicKey),
        options.credential.signCount,
        options.credential.transports,
        enrolledVia,
        userId,
      ]
    );

    if (options.path.via === 'invitation') {
      await client.query(
        `UPDATE user_invitations SET consumed_at = NOW(), consumed_by = $2 WHERE code_hash = $1`,
        [options.path.codeHash, userId]
      );
    }

    const sessionToken = await insertSession(client, options.credential.credentialId);
    await client.query('COMMIT');
    return { enrolled: true, sessionToken, userId };
  } catch (caught) {
    await client.query('ROLLBACK');
    const constraint = (caught as { code?: string; constraint?: string });
    if (constraint.code === UNIQUE_VIOLATION) {
      // Two kinds of unique constraint can fire here and they mean different things. The lost-race
      // set says "somebody else already bootstrapped, or already redeemed this invitation"; the
      // primary key says "this authenticator is already enrolled", which a browser should never
      // produce because `excludeCredentials` tells it not to, and which is not a reason to report
      // that registration is closed.
      return {
        enrolled: false,
        refusal: LOST_RACE_CONSTRAINTS.has(constraint.constraint ?? '')
          ? 'REGISTRATION_CLOSED'
          : 'CREDENTIAL_ALREADY_ENROLLED',
      };
    }
    throw caught;
  } finally {
    client.release();
  }
}

/**
 * Open a session for an already-enrolled credential, and return the RAW token for the cookie.
 *
 * The raw token exists in this process and in the `Set-Cookie` header, and nowhere else. What goes
 * to Postgres is its SHA-256 digest, which the column's CHECK makes structural rather than
 * advisory: the base64url token is the wrong alphabet and the wrong length, so "just store the
 * cookie value" is a statement the database refuses.
 *
 * `expires_at` IS COMPUTED IN SQL from `NOW()`, for the same one-clock reason the validity
 * predicate is. A JS `Date` rendered into an interval here would be this app's clock deciding when
 * the database's clock thinks a session ends.
 */
async function insertSession(client: PoolClient, credentialId: string): Promise<string> {
  const token = generateSessionToken();
  await client.query(
    `INSERT INTO auth_sessions (token_hash, credential_id, expires_at)
     VALUES ($1, $2, NOW() + make_interval(secs => $3::int))`,
    [hashSessionToken(token), credentialId, SESSION_TTL_SECONDS]
  );
  return token;
}

/** Open a session outside an enrolment — the login path. Same statement, its own connection. */
/**
 * A personal token for a script — minted only by `scripts/tokens.ts`, run by the owner over SSH.
 *
 * THERE IS NO HTTP ENDPOINT THAT MINTS THESE, deliberately. A minting endpoint is a way for a
 * compromised browser session to create a durable credential for itself; SSH access to the server
 * is a stronger proof of being the owner than anything the web app can check, and the owner is the
 * only person who ever needs one.
 *
 * IT BELONGS TO A USER, NAMED OR DEFAULTED TO THE OWNER — never to "whoever enrolled last". Until
 * P7-41a this attached the token to the most recently enrolled passkey of anyone, which was the
 * owner's only because there was nobody else. With a second user, the newest passkey is quite
 * likely theirs, and a token minted over SSH by the owner for the owner's script would silently
 * resolve as the second user. So the user is chosen FIRST — `userId`, or the `is_owner` row when it
 * is omitted, resolved in SQL — and only then a credential of THAT user.
 *
 * Which of that user's credentials: their newest, because `credential_id` is required and a token
 * must die with the credential it was minted under (the foreign key cascades). Among one person's
 * own passkeys any choice is theirs, and the newest is the one least likely to be retired soon. A
 * removed user (`revoked_at` set) has no credentials left and is refused by the same query.
 */
export async function createPersonalToken(options: {
  label: string;
  scope: SessionScope;
  days?: number;
  /** `users.id`. Omitted means the owner — stated, not inferred from the credential list. */
  userId?: number;
}): Promise<{ token: string; tokenHash: string; expiresAt: string }> {
  const days = personalTokenDays(options.days);
  const label = options.label.trim();
  if (label.length < 1 || label.length > 60) throw new RangeError('a token label is 1–60 characters');

  const owner = await db.query<{ credential_id: string }>(
    `SELECT c.credential_id
       FROM webauthn_credentials c
       JOIN users u ON u.id = c.user_id
      WHERE u.id = COALESCE($1::int, (SELECT id FROM users WHERE is_owner))
        AND u.revoked_at IS NULL
      ORDER BY c.created_at DESC, c.credential_id DESC
      LIMIT 1`,
    [options.userId ?? null]
  );
  if (owner.rows.length === 0) {
    throw new Error(
      options.userId === undefined
        ? 'the owner has no passkey enrolled; register one before minting tokens'
        : `user ${options.userId} does not exist, has been removed, or has no passkey enrolled`
    );
  }

  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const result = await db.query<{ expires_at: string }>(
    `INSERT INTO auth_sessions (token_hash, credential_id, kind, scope, label, expires_at)
     VALUES ($1, $2, 'personal', $3, $4, NOW() + make_interval(days => $5::int))
     RETURNING expires_at::text`,
    [tokenHash, owner.rows[0].credential_id, options.scope, label, days]
  );
  return { token, tokenHash, expiresAt: result.rows[0].expires_at };
}

/** Every live session, newest first, with nothing that could be used to authenticate. */
export async function listSessions(): Promise<Array<{
  tokenHash: string; kind: SessionKind; scope: SessionScope; label: string | null;
  createdAt: string; expiresAt: string; lastUsedAt: string | null;
}>> {
  const result = await db.query<{
    token_hash: string; kind: SessionKind; scope: SessionScope; label: string | null;
    created_at: string; expires_at: string; last_used_at: string | null;
  }>(
    `SELECT token_hash, kind, scope, label, created_at::text, expires_at::text, last_used_at::text
       FROM auth_sessions
      WHERE revoked_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC`
  );
  return result.rows.map((r) => ({
    tokenHash: r.token_hash, kind: r.kind, scope: r.scope, label: r.label,
    createdAt: r.created_at, expiresAt: r.expires_at, lastUsedAt: r.last_used_at,
  }));
}

/**
 * Revoke the one live session whose hash starts with `prefix`.
 *
 * A PREFIX, because a person types it from a list, but at least eight characters and it must match
 * EXACTLY ONE live row — an ambiguous prefix revokes nothing and says so, rather than revoking the
 * first match and leaving the owner believing a different token is gone.
 */
export async function revokeByPrefix(prefix: string): Promise<'revoked' | 'none' | 'ambiguous' | 'too-short'> {
  const p = prefix.trim().toLowerCase();
  if (!/^[0-9a-f]{8,64}$/.test(p)) return 'too-short';
  const matches = await db.query<{ token_hash: string }>(
    `SELECT token_hash FROM auth_sessions
      WHERE token_hash LIKE $1 || '%' AND revoked_at IS NULL AND expires_at > NOW()`,
    [p]
  );
  if (matches.rows.length === 0) return 'none';
  if (matches.rows.length > 1) return 'ambiguous';
  await revokeSession(matches.rows[0].token_hash);
  return 'revoked';
}

export async function createSession(credentialId: string): Promise<string> {
  const client: PoolClient = await db.connect();
  try {
    return await insertSession(client, credentialId);
  } finally {
    client.release();
  }
}

/**
 * Revoke a session, by the hash of the token that names it.
 *
 * AN `UPDATE`, NEVER A `DELETE`, and never a cookie clear alone. `revoked_at` is the record that a
 * sign-out happened; a `DELETE` would leave a store in which "signed out" and "never existed" are
 * the same answer, and clearing the cookie alone leaves a row that still authenticates anybody
 * holding a copy — which is exactly what SPEC.md's I9 replays.
 *
 * `revoked_at IS NULL` in the WHERE clause so a second logout does not overwrite the first
 * timestamp: when the owner signed out is a fact about the first time.
 */
export async function revokeSession(tokenHash: string): Promise<void> {
  await db.query(
    'UPDATE auth_sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL',
    [tokenHash]
  );
}

/**
 * Record the counter an accepted assertion reported.
 *
 * The one mutable column in this schema, and it is authenticator state mirrored here rather than a
 * derived value: clone detection IS the comparison against the highest value seen before, so the
 * high-water mark has to be stored for the comparison to exist at all. `@simplewebauthn/server`
 * performs the comparison; this is what makes the next one meaningful.
 *
 * `GREATEST` rather than a bare assignment: two accepted assertions racing must not be able to move
 * the mark backwards, which would weaken the next comparison rather than merely reorder two writes.
 */
export async function recordSignCount(credentialId: string, newSignCount: number): Promise<void> {
  await db.query(
    'UPDATE webauthn_credentials SET sign_count = GREATEST(sign_count, $2) WHERE credential_id = $1',
    [credentialId, newSignCount]
  );
}
