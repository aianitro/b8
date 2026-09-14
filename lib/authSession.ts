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
import type { StoredCredential } from './webauthnVerify';

/** A session that exists, is unrevoked, and has not expired — the only kind this module returns. */
export interface ActiveSession {
  tokenHash: string;
  credentialId: string;
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

  const result = await db.query<{ token_hash: string; credential_id: string }>(
    `SELECT token_hash, credential_id
       FROM auth_sessions
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND expires_at > NOW()`,
    [hashSessionToken(token)]
  );

  const row = result.rows[0];
  return row ? { tokenHash: row.token_hash, credentialId: row.credential_id } : null;
}

/**
 * How many credentials are enrolled.
 *
 * THE BOOTSTRAP GATE READS THIS, and it is a global count because the schema is single-principal:
 * "zero credentials exist" is a question with one answer. The migration's own header argues at
 * length why a `user_id` would make it unanswerable.
 *
 * It is not the whole gate. A count is a read-modify-write with a window in it, and the window is
 * closed by `webauthn_credentials_one_bootstrap` — see `enrolCredential`. The count is what
 * produces a clean refusal in the ordinary case; the index is what covers the concurrent one.
 */
export async function countCredentials(): Promise<number> {
  const result = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM webauthn_credentials');
  return Number(result.rows[0].count);
}

/**
 * Every enrolled credential, oldest first.
 *
 * EVERY one. `allowCredentials` in a login ceremony lists all of them, and the assertion lookup
 * matches over all of them; a query that returned only the newest would let a second device
 * register successfully and never sign in, which looks like a hardware fault and is a `LIMIT 1`.
 *
 * `sign_count` is `BIGINT`, which `pg` hands back as a STRING to avoid silently truncating values
 * past 2^53. The conversion is explicit here rather than left to a `==` somewhere downstream: a
 * counter compared as a string orders `'9'` after `'10'`, which would make clone detection fire on
 * an honest authenticator and stay silent on a cloned one.
 */
export async function listCredentials(): Promise<StoredCredential[]> {
  const result = await db.query<{
    credential_id: string;
    public_key: Buffer;
    sign_count: string;
    transports: string[] | null;
  }>(
    `SELECT credential_id, public_key, sign_count, transports
       FROM webauthn_credentials
      ORDER BY created_at, credential_id`
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
  | { enrolled: true; sessionToken: string }
  | { enrolled: false; refusal: EnrolmentRefusal };

/** The Postgres SQLSTATE for a unique violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Enrol a credential and open a session for it, in one transaction.
 *
 * ONE TRANSACTION, CREDENTIAL FIRST. `auth_sessions.credential_id` is `NOT NULL`, so the order is
 * forced; the transaction is what stops a bootstrap credential existing with NO session after a
 * mid-write failure. That state would be unrecoverable in the worst way available here: the single
 * `'bootstrap'` slot is spent, registration is therefore closed, and nobody is signed in to open it
 * again.
 *
 * `enrolledVia` IS THE CALLER'S, AND IT IS THE HALF THE DATABASE CANNOT CHECK. The partial unique
 * index makes at most one `'bootstrap'` row possible however two concurrent requests interleave —
 * the race is closed in the schema — but Postgres cannot see whether a request carried a session,
 * so a handler that tags a session-less enrolment `'authenticated'` still enrols a stranger and
 * satisfies every constraint. That is the authorization hole, it is closed in
 * `app/api/v1/auth/register/verify/route.ts`, and SPEC.md's I2 is the fixture that holds it.
 *
 * THE UNIQUE VIOLATION IS CAUGHT, NOT PRE-EMPTED. The bootstrap `INSERT` may fail with `23505` on
 * `webauthn_credentials_one_bootstrap` when another unauthenticated registration won the race. That
 * becomes the same refusal the count check produces. There is no retry: a retry would be an attempt
 * to win a race this code has already lost, and losing it is the correct outcome.
 */
export async function enrolCredential(options: {
  credential: StoredCredential;
  enrolledVia: 'bootstrap' | 'authenticated';
}): Promise<EnrolmentResult> {
  const client: PoolClient = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO webauthn_credentials (credential_id, public_key, sign_count, transports, enrolled_via)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        options.credential.credentialId,
        Buffer.from(options.credential.publicKey),
        options.credential.signCount,
        options.credential.transports,
        options.enrolledVia,
      ]
    );
    const sessionToken = await insertSession(client, options.credential.credentialId);
    await client.query('COMMIT');
    return { enrolled: true, sessionToken };
  } catch (caught) {
    await client.query('ROLLBACK');
    const constraint = (caught as { code?: string; constraint?: string });
    if (constraint.code === UNIQUE_VIOLATION) {
      // Two unique constraints can fire here and they mean different things. The partial index says
      // "somebody else already bootstrapped"; the primary key says "this authenticator is already
      // enrolled", which a browser should never produce because `excludeCredentials` tells it not
      // to, and which is not a reason to report that registration is closed.
      return {
        enrolled: false,
        refusal:
          constraint.constraint === 'webauthn_credentials_one_bootstrap'
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
