// Loyalty inbox, reading (P8-42c2) — the second half of 42c. Each stored message is read once by
// Claude as a PROPOSAL; the clean pass and the decision order (`lib/domain/loyaltyRead.ts`) decide
// whether it becomes a balance, waits in the one-tap queue on /travel, or is settled without one.
// This file lists, asks those rules, and records. Besides `lib/loyaltyInbox.ts` it is the only
// non-test file that names the raw bytes column, and it reads that column one message at a time,
// only to prepare the text the reader is given.
//
// ─── WHAT A READ RUN DOES, IN ORDER (SPEC.md "What a read run does") ──────────────────────────
//
//   1. Availability. No API key: `disabled`; nothing read, counted or written, the state row
//      included.
//   2. The lock. A Postgres session advisory lock on ONE dedicated client, taken by the route and the
//      daily job alike and distinct from the poll's, so a poll in progress never blocks a read. Not
//      taken: `already_running`, nothing written. Released on every path.
//   3. Candidates: stored messages with bytes that have no reads row, or one in `retry`, oldest
//      received first, at most `LOYALTY_READ_MAX_PER_RUN`. `retryFailed` first deletes every `failed`
//      row whose message still has its bytes, returning it to unread with zero attempts.
//   4. Per message, isolated. The attempt is written and committed BEFORE the model is called, as
//      the row a crash would leave (`retry`, or `failed` on the last attempt, with the provisional
//      code `api_error`; amendment A2), so a crash or a throwing reader still costs an attempt. The
//      text is prepared; no text is `failed`/`empty_message` with no call. The reader runs under a
//      bound of its timeout plus five seconds. A result is cleaned and decided in one transaction
//      with the program's memberships locked. Anything that goes wrong for one message is caught
//      and recorded for that message, and the next message is read.
//   5. Failure handling. `refused` and `empty_message` are terminal at once; the other codes retry
//      until the third attempt. A rate limit stops the run at once; three consecutive timeouts or API
//      errors stop it; a run past its time budget starts no new message.
//   6. The remaining count, the retention purge, and LAST the state row (`ok`, or `error` with the
//      first failure's code), so nothing after it can contradict what was stored (P8-42c4, D3).
//
// ─── LOGS CARRY COUNTS AND CODES ONLY ─────────────────────────────────────────────────────────
//
// Never a subject, text, balance, suffix, member number, address, URL, key or library error text.
// The model's output is never logged or stored; only the cleaned fields reach the reads row.
//
// ─── DATES ARE POSTGRES'S ─────────────────────────────────────────────────────────────────────
//
// "Today", the one-day slack for an as-of, strictly-newer and the retention cut-off are CURRENT_DATE
// arithmetic in SQL or exact `YYYY-MM-DD` text order. No JS clock is read; `setTimeout` bounds a call
// and the run, and is never read as a date.

import type { PoolClient } from 'pg';
import db from './db';
import { createLogger } from './logger';
import type { LoyaltyFailure, LoyaltyResult, Queryable } from './loyaltyStore';
import { textForReader } from './domain/loyaltyInbox';
import { currentObservationByMembership } from './domain/loyalty';
import { cleanReading, decideReading, type CleanReading, type Decision, type StoredReading } from './domain/loyaltyRead';
import { createMailReader, readerAvailable, readTimeoutSeconds, type MailReader, type MailReaderResult } from './loyaltyReader';
import {
  LOYALTY_MASK_BULLETS,
  LOYALTY_READ_MAX_ATTEMPTS,
  LOYALTY_READ_MAX_CHARS,
  LOYALTY_READ_MAX_PER_RUN,
  LOYALTY_READ_QUEUE_LIMIT,
  LOYALTY_READ_RETENTION_DAYS,
  LOYALTY_READ_RUN_BUDGET_SECONDS,
  LOYALTY_READ_STOP_AFTER,
  type LoyaltyErrorCode,
  type LoyaltyInboxReadPanel,
  type LoyaltyInboxReadRequest,
  type LoyaltyInboxReadRun,
  type LoyaltyInboxResolve,
  type LoyaltyInboxOrigin,
  type LoyaltyInboxResolveRequest,
  type LoyaltyReadCoverage,
  type LoyaltyReadErrorCode,
  type LoyaltyReadFromMail,
  type LoyaltyReadItem,
  type LoyaltyReadRunErrorCode,
  type LoyaltyUnit,
} from '@b8/contracts/loyalty';

const log = createLogger('loyalty-read');

/**
 * The advisory lock's key: Postgres's hash of a name no other feature uses, and NOT the poll's, so a
 * read and a poll never wait on each other.
 */
const LOCK_SQL = `hashtext('b8:loyalty-inbox:read')`;

/** How much longer than the reader's own timeout the pipeline waits before it gives up on a call. */
const BOUND_SLACK_SECONDS = 5;

type Env = Readonly<Record<string, string | undefined>>;

const zeroRun = (outcome: LoyaltyInboxReadRun['outcome'], errorCode: LoyaltyReadRunErrorCode | null = null): LoyaltyInboxReadRun => ({
  outcome, read: 0, applied: 0, queued: 0, stale: 0, noBalance: 0, discarded: 0, failed: 0, remaining: 0, errorCode,
});

// ─── The lock ──────────────────────────────────────────────────────────────────────────────────

/** Takes the read lock on a dedicated client, or returns null (and releases it) when held elsewhere. */
async function takeLock(): Promise<PoolClient | null> {
  const client = await db.connect();
  try {
    const r = await client.query<{ locked: boolean }>(`SELECT pg_try_advisory_lock(${LOCK_SQL}) AS locked`);
    if (r.rows[0].locked) return client;
    client.release();
    return null;
  } catch (err) {
    client.release(true);
    throw err;
  }
}

async function releaseLock(client: PoolClient): Promise<void> {
  try {
    await client.query(`SELECT pg_advisory_unlock(${LOCK_SQL})`);
    client.release();
  } catch {
    // Destroyed rather than returned to the pool still holding the lock; closing its session frees it.
    client.release(true);
  }
}

/**
 * Rolls back a failed transaction on `client`, and never lets a failed ROLLBACK decide anything
 * (P8-42c4, D2). The statement or refusal that caused the rollback is what the caller answers with;
 * a ROLLBACK that itself fails (usually a dead connection) is logged once, in a fixed shape, and
 * swallowed. It used to be an empty arrow, which is the same swallow made silent. The line carries
 * a code only: the error object, its text and the SQL are never logged, because a driver's error
 * text can quote the statement and its values. The caller still releases the client exactly as
 * before.
 */
async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    log.warn('loyalty read rollback failed', { code: 'store_failed' });
  }
}

// ─── One message ───────────────────────────────────────────────────────────────────────────────

interface Candidate {
  messageId: number;
  key: string;
  programId: number;
  receivedOn: string;
  /** Attempts already made: 0 for a message with no reads row. */
  attempts: number;
  /**
   * Where 42c1's poll found the original sender (P8-42c3). `attachment` is its record that a registered
   * member forwarded the statement as an attached message, and it alone makes the text path read that
   * attached original. Taken from the stored row, never re-derived from the member addresses at read
   * time: the poll's decision is the one the message was filed under.
   */
  origin: LoyaltyInboxOrigin;
}

/** Codes that end a message at their first occurrence: asking again would get the same answer. */
const TERMINAL: readonly LoyaltyReadErrorCode[] = ['refused', 'empty_message'];
/** Codes that count towards stopping the run: the service, not the message, is failing. */
const TRANSPORT: readonly LoyaltyReadErrorCode[] = ['timeout', 'api_error'];

/**
 * Counts the attempt, committed, before anything else happens to the message: the row is written as
 * the outcome a crash right now would leave (amendment A2). Returns the new attempt count, or null
 * when the row is no longer `retry` (another writer settled it), in which case the message is skipped.
 */
async function countAttempt(c: Candidate): Promise<number | null> {
  const attempts = c.attempts + 1;
  const state = attempts >= LOYALTY_READ_MAX_ATTEMPTS ? 'failed' : 'retry';
  const r = await db.query(
    `INSERT INTO loyalty_inbox_reads (dedupe_key, program_id, received_on, state, attempts, last_error_code)
     VALUES ($1, $2, $3::date, $4, $5, 'api_error')
     ON CONFLICT (dedupe_key) DO UPDATE SET state = EXCLUDED.state, attempts = EXCLUDED.attempts, last_error_code = 'api_error'
       WHERE loyalty_inbox_reads.state = 'retry' AND loyalty_inbox_reads.attempts = $5 - 1
     RETURNING id`,
    [c.key, c.programId, c.receivedOn, state, attempts]
  );
  return r.rows.length === 1 ? attempts : null;
}

/** Records a failed attempt: terminal codes and the last attempt are `failed`, the rest `retry`. */
async function recordFailure(key: string, attempts: number, code: LoyaltyReadErrorCode): Promise<void> {
  const state = TERMINAL.includes(code) || attempts >= LOYALTY_READ_MAX_ATTEMPTS ? 'failed' : 'retry';
  await db.query(
    `UPDATE loyalty_inbox_reads SET state = $2, last_error_code = $3 WHERE dedupe_key = $1 AND state IN ('retry', 'failed')`,
    [key, state, code]
  );
}

/** The bytes of one message, or null when they are gone (purged, or never kept). */
async function bytesOf(messageId: number): Promise<Buffer | null> {
  const r = await db.query<{ raw: Buffer | null }>('SELECT raw_mail AS raw FROM loyalty_inbox_messages WHERE id = $1', [messageId]);
  return r.rows[0]?.raw ?? null;
}

/**
 * Calls the reader under a bound: its own timeout plus five seconds. A reader that throws (it should
 * not) is `api_error`; one that never settles is cut off as `timeout`, and its promise is left to
 * settle into nothing, so the lock and the run move on.
 */
async function readBounded(reader: MailReader, input: { subject: string | null; text: string }, boundMs: number): Promise<MailReaderResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<MailReaderResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, code: 'timeout' }), boundMs);
  });
  const call = Promise.resolve()
    .then(() => reader.read(input))
    .catch((): MailReaderResult => ({ ok: false, code: 'api_error' }));
  try {
    return await Promise.race([call, bound]);
  } finally {
    clearTimeout(timer);
  }
}

/** The normalisation the suffix rule applies to a stored number, in SQL: letters and digits, upper-cased. */
const NUMBER_KEY_SQL = (column: string) => `upper(regexp_replace(${column}, '[^A-Za-z0-9]', '', 'g'))`;

/**
 * Decides one cleaned reading and stores the outcome in ONE transaction: the program's memberships
 * are locked first, so the "stored reading" every rule compares with is the newest by the shared
 * reduction at the moment of the write, and an applied reading's observation, its reads row and its
 * state are written together or not at all.
 */
async function decideAndStore(key: string, programId: number, reading: CleanReading): Promise<Decision> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const memberships = await client.query<{ id: number; programId: number; number: string | null }>(
      `SELECT id, program_id AS "programId", member_number AS number FROM loyalty_memberships WHERE program_id = $1 ORDER BY id FOR UPDATE`,
      [programId]
    );
    const ids = memberships.rows.map((m) => m.id);
    const [observations, program, notMine, today] = await Promise.all([
      client.query<{ membershipId: number; id: number; asOf: string; recordedAt: string; balance: string; unit: LoyaltyUnit }>(
        `SELECT membership_id AS "membershipId", id, as_of::text AS "asOf",
                to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "recordedAt",
                balance::text AS balance, unit
           FROM loyalty_observations WHERE membership_id = ANY($1::int[])`,
        [ids]
      ),
      client.query<{ defaultUnit: LoyaltyUnit; names: string[] }>(
        `SELECT p.default_unit AS "defaultUnit",
                array_prepend(p.name, coalesce((SELECT array_agg(a.alias ORDER BY a.id) FROM loyalty_program_aliases a WHERE a.program_id = p.id), '{}')) AS names
           FROM loyalty_programs p WHERE p.id = $1`,
        [programId]
      ),
      client.query<{ suffix: string }>('SELECT suffix FROM loyalty_inbox_not_mine WHERE program_id = $1', [programId]),
      client.query<{ latest: string }>('SELECT (CURRENT_DATE + 1)::text AS latest'),
    ]);
    // "Current" is the shared newest-wins reduction (as-of, then recorded_at, then id), never the
    // last row of a query.
    const current = new Map<number, StoredReading>();
    for (const [id, o] of currentObservationByMembership(observations.rows)) current.set(id, { balance: o.balance, unit: o.unit, asOf: o.asOf });
    const decision = decideReading({
      reading,
      programId,
      programNames: program.rows[0].names,
      defaultUnit: program.rows[0].defaultUnit,
      memberships: memberships.rows,
      notMine: notMine.rows.map((r) => r.suffix),
      current,
      latestAsOf: today.rows[0].latest,
    });

    let observationId: number | null = null;
    if (decision.state === 'applied') {
      const o = await client.query<{ id: number }>(
        `INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source)
         VALUES ($1, $2::date, $3::numeric, $4, 'email') RETURNING id`,
        [decision.membershipId, reading.asOf, reading.balance, reading.unit]
      );
      observationId = o.rows[0].id;
    }
    const updated = await client.query(
      `UPDATE loyalty_inbox_reads
          SET state = $2, last_error_code = NULL, reason = $3, suffix = $4, balance = $5::numeric, unit = $6,
              as_of = $7::date, program_check = $8, membership_id = $9, observation_id = $10,
              expiry_warnings = $11::jsonb, instruments = $12::jsonb, read_on = CURRENT_DATE,
              resolved_on = CASE WHEN $2 = 'pending' THEN NULL ELSE CURRENT_DATE END
        WHERE dedupe_key = $1 AND state IN ('retry', 'failed')`,
      [
        key, decision.state, decision.reason, reading.suffix, reading.balance, reading.unit, reading.asOf,
        decision.programCheck, decision.membershipId, observationId,
        JSON.stringify(reading.expiryWarnings), JSON.stringify(reading.instruments),
      ]
    );
    // The attempt row was written by this run under the lock; if it is gone the observation must not stand alone.
    if ((updated.rowCount ?? 0) !== 1) throw new Error('reads row missing');
    await client.query('COMMIT');
    return decision;
  } catch (err) {
    // The original error is re-thrown whatever the rollback did: the run records it as this
    // message's `store_failed`, and a failed rollback must not replace it.
    await rollback(client);
    throw err;
  } finally {
    client.release();
  }
}

// ─── The run ───────────────────────────────────────────────────────────────────────────────────

type Counts = Omit<LoyaltyInboxReadRun, 'outcome' | 'errorCode'>;

/** Messages still to read: stored with bytes, and unread or in `retry`. */
async function remainingCount(q: Queryable = db): Promise<number> {
  const r = await q.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM loyalty_inbox_messages m
      WHERE m.raw_mail IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM loyalty_inbox_reads r WHERE r.dedupe_key = m.dedupe_key AND r.state <> 'retry')`
  );
  return r.rows[0].n;
}

/** The body of one run, under the lock. Returns the run's error code, or null. */
async function readAll(reader: MailReader, env: Env, retryFailed: boolean, counts: Counts): Promise<LoyaltyReadRunErrorCode | null> {
  if (retryFailed) {
    // Only rows whose message still has its bytes: a row whose mail is gone could never be read again.
    await db.query(
      `DELETE FROM loyalty_inbox_reads r WHERE r.state = 'failed'
          AND EXISTS (SELECT 1 FROM loyalty_inbox_messages m WHERE m.dedupe_key = r.dedupe_key AND m.raw_mail IS NOT NULL)`
    );
  }
  const candidates = await db.query<Candidate>(
    `SELECT m.id AS "messageId", m.dedupe_key AS key, m.program_id AS "programId", m.received_on::text AS "receivedOn",
            coalesce(r.attempts, 0)::int AS attempts, m.origin
       FROM loyalty_inbox_messages m LEFT JOIN loyalty_inbox_reads r ON r.dedupe_key = m.dedupe_key
      WHERE m.raw_mail IS NOT NULL AND (r.id IS NULL OR r.state = 'retry')
      ORDER BY m.received_on, m.id
      LIMIT $1`,
    [LOYALTY_READ_MAX_PER_RUN]
  );

  const boundMs = (readTimeoutSeconds(env) + BOUND_SLACK_SECONDS) * 1000;
  // The run budget is a timer that flips a flag, never a clock read: a run past it starts no new
  // message, and the messages it did not reach stay unread for the next run.
  let spent = false;
  const budget = setTimeout(() => { spent = true; }, LOYALTY_READ_RUN_BUDGET_SECONDS * 1000);
  let errorCode: LoyaltyReadRunErrorCode | null = null;
  let consecutive = 0;
  try {
    for (const c of candidates.rows) {
      if (spent) break;
      let attempts: number | null;
      try {
        attempts = await countAttempt(c);
      } catch {
        errorCode = errorCode ?? 'store_failed';
        continue;
      }
      if (attempts === null) continue;

      let code: LoyaltyReadErrorCode | null = null;
      try {
        const raw = await bytesOf(c.messageId);
        // Bytes that vanished between selection and now (42c1's retention deleted the row or nulled
        // its `raw_mail`) are NOT an empty message (P8-42c4, D5): the fate of a message nobody can
        // read any more is not a decision about its content. The reads row stays exactly as
        // `countAttempt` just wrote it (`retry`/`api_error`, or `failed` on the last attempt), which
        // the panel counts as failed because its bytes are gone (D4), and no undo write is made that
        // could itself fail. The run counts it as neither read nor failed, sets no code and leaves
        // the consecutive-failure streak alone. A `bytesOf` that THROWS is the database failing, not
        // the bytes missing, and still lands in the catch below as a store failure.
        if (raw === null) continue;
        const input = await textForReader(raw, LOYALTY_READ_MAX_CHARS, c.origin).catch(() => null);
        if (input === null || input.text === '') {
          code = 'empty_message';
        } else {
          const result = await readBounded(reader, input, boundMs);
          if (!result.ok) {
            code = result.code;
          } else {
            const decision = await decideAndStore(c.key, c.programId, cleanReading(result.reading));
            counts.read++;
            if (decision.state === 'applied') counts.applied++;
            else if (decision.state === 'pending') counts.queued++;
            else if (decision.state === 'stale') counts.stale++;
            else if (decision.state === 'no_balance') counts.noBalance++;
            else counts.discarded++;
          }
        }
      } catch {
        // A database failure while deciding this message: its row stays as the attempt left it
        // (`retry`/`api_error`, or `failed` on the last attempt), and the next message is read.
        counts.failed++;
        errorCode = errorCode ?? 'store_failed';
        consecutive = 0;
        continue;
      }

      if (code === null) { consecutive = 0; continue; }
      counts.failed++;
      try {
        await recordFailure(c.key, attempts, code);
      } catch {
        errorCode = errorCode ?? 'store_failed';
      }
      if (code === 'rate_limited') return 'rate_limited';
      if (TRANSPORT.includes(code)) {
        consecutive++;
        if (consecutive >= LOYALTY_READ_STOP_AFTER) return code as LoyaltyReadRunErrorCode;
      } else {
        consecutive = 0;
      }
    }
  } finally {
    clearTimeout(budget);
  }
  return errorCode;
}

/** Sets the state row's three columns together: the CHECKs refuse any partial combination. */
async function recordState(errorCode: LoyaltyReadRunErrorCode | null): Promise<void> {
  await db.query(
    `UPDATE loyalty_inbox_read_state SET last_read_on = CURRENT_DATE, last_outcome = $1, last_error_code = $2 WHERE id = 1`,
    [errorCode === null ? 'ok' : 'error', errorCode]
  );
}

/**
 * One read run over the stored mail. Resolves, never rejects: a failure is `outcome: 'error'` with a
 * code. The environment is read now, not at import.
 */
export async function readStoredMail(request: LoyaltyInboxReadRequest = {}, env: Env = process.env): Promise<LoyaltyInboxReadRun> {
  if (!readerAvailable(env)) return zeroRun('disabled');

  let lock: PoolClient | null;
  try {
    lock = await takeLock();
  } catch {
    log.error('loyalty read failed', { code: 'store_failed' });
    return zeroRun('error', 'store_failed');
  }
  if (lock === null) return zeroRun('already_running');

  const counts: Counts = { read: 0, applied: 0, queued: 0, stale: 0, noBalance: 0, discarded: 0, failed: 0, remaining: 0 };
  let errorCode: LoyaltyReadRunErrorCode | null = null;
  try {
    // THE STORED LAST READ IS WRITTEN LAST (P8-42c4, D3). Each step below is attempted whatever the
    // earlier ones did, in this order: the read, the remaining count, the purge, then the state
    // write. The final code is the FIRST failure in that order (a read run code wins; else
    // `store_failed` from the count or the purge), and the state row is written from that same
    // code, so whenever it can be written it equals the answer. It used to be written before the
    // purge, so a purge that threw answered `error` beside a stored `ok`; and a failed count used
    // to skip both the state write and the purge. When the state write itself fails, the row is
    // left exactly as it was (one atomic UPDATE under CHECKs, never half written) and the answer
    // is `error` with the final code, or `store_failed` when there was none.
    try {
      errorCode = await readAll(createMailReader(env), env, request.retryFailed === true, counts);
    } catch {
      errorCode = 'store_failed';
    }
    try {
      counts.remaining = await remainingCount();
    } catch {
      errorCode = errorCode ?? 'store_failed';
    }
    try {
      await purgeExpiredReads();
    } catch {
      errorCode = errorCode ?? 'store_failed';
    }
    try {
      await recordState(errorCode);
    } catch {
      errorCode = errorCode ?? 'store_failed';
    }
  } finally {
    await releaseLock(lock);
  }
  const result: LoyaltyInboxReadRun = { outcome: errorCode === null ? 'ok' : 'error', ...counts, errorCode };
  if (errorCode === null) log.info('loyalty inbox read', { ...counts });
  else log.warn('loyalty inbox read failed', { code: errorCode, ...counts });
  return result;
}

// ─── Retention ─────────────────────────────────────────────────────────────────────────────────

/**
 * Deletes reads rows received STRICTLY before CURRENT_DATE minus the retention days, in every state,
 * pending items included: exactly four hundred days old is kept, four hundred and one is deleted.
 * The not-mine list and the state row are never touched. The raw mail goes on 42c1's own, shorter
 * schedule; these rows outlive it on purpose.
 */
export async function purgeExpiredReads(q: Queryable = db): Promise<number> {
  const r = await q.query('DELETE FROM loyalty_inbox_reads WHERE received_on < CURRENT_DATE - $1::int', [LOYALTY_READ_RETENTION_DAYS]);
  return r.rowCount ?? 0;
}

/**
 * The daily job's step, after the poll and before the digest: read, then purge (the purge runs even
 * when reading is disabled, so retention never waits on a key). Resolves, never rejects: a read
 * failure must never cost the digest after it.
 */
export async function runLoyaltyReadDaily(): Promise<void> {
  try {
    const run = await readStoredMail();
    const purged = await purgeExpiredReads();
    log.info('loyalty read daily step', { outcome: run.outcome, code: run.errorCode, read: run.read, applied: run.applied, queued: run.queued, purged });
  } catch {
    log.error('loyalty read daily step failed', { code: 'store_failed' });
  }
}

// ─── The queue actions ─────────────────────────────────────────────────────────────────────────

const refuse = (code: LoyaltyErrorCode, message?: string): LoyaltyFailure => {
  log.warn('loyalty read action refused', { code });
  return { ok: false, code, message };
};

/** Raised inside the action's transaction to roll it back and answer with a refusal. */
class Refusal extends Error {
  constructor(readonly failure: LoyaltyFailure) { super('refused'); }
}

interface ItemRow {
  id: number;
  programId: number;
  state: string;
  suffix: string | null;
  balance: string;
  unit: LoyaltyUnit;
  date: string;
  membershipId: number | null;
}

/**
 * One action on one queued item (SPEC.md "Queue actions"), in one transaction with the item's row
 * locked, so two simultaneous taps resolve it once: the second sees a row that is no longer
 * `pending` and is 409 `ITEM_RESOLVED`. Error messages are fixed sentences and never echo input.
 *
 *   apply    — one `email` observation with the item's balance and unit, dated by the item's as-of
 *              or, when it has none, its received date (a person's explicit decision). The
 *              membership is `membershipId` when given (it must belong to the item's program), else
 *              the item's unique match; with neither it is refused. An as-of more than a day ahead is
 *              refused. An older as-of is written and does not become current, as on the typed path.
 *   not_mine — the item, and every other pending `unmatched_suffix` item of its program and suffix,
 *              becomes `not_mine`; the pair is recorded (idempotently) when there is a suffix.
 *   ignore   — the item becomes `ignored`. Nothing else.
 */
export async function resolveReading(id: number, body: LoyaltyInboxResolveRequest): Promise<LoyaltyResult<LoyaltyInboxResolve>> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<ItemRow>(
      `SELECT id, program_id AS "programId", state, suffix, balance::text AS balance, unit,
              coalesce(as_of, received_on)::text AS date, membership_id AS "membershipId"
         FROM loyalty_inbox_reads WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const item = r.rows[0];
    if (!item) throw new Refusal(refuse('NOT_FOUND'));
    if (item.state !== 'pending') throw new Refusal(refuse('ITEM_RESOLVED'));

    let state: LoyaltyInboxResolve['state'];
    if (body.action === 'apply') {
      const membershipId = body.membershipId ?? item.membershipId;
      if (membershipId === null) throw new Refusal(refuse('INVALID_INPUT', 'Choose the membership this balance belongs to.'));
      const ofProgram = await client.query(
        'SELECT 1 FROM loyalty_memberships WHERE id = $1 AND program_id = $2', [membershipId, item.programId]
      );
      if (ofProgram.rows.length === 0) throw new Refusal(refuse('INVALID_INPUT', 'That membership is not one of this program.'));
      const future = await client.query<{ future: boolean }>('SELECT $1::date > CURRENT_DATE + 1 AS future', [item.date]);
      if (future.rows[0].future) throw new Refusal(refuse('INVALID_INPUT', 'A balance cannot be dated more than a day ahead.'));
      const o = await client.query<{ id: number }>(
        `INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source)
         VALUES ($1, $2::date, $3::numeric, $4, 'email') RETURNING id`,
        [membershipId, item.date, item.balance, item.unit]
      );
      await client.query(
        `UPDATE loyalty_inbox_reads SET state = 'applied_by_hand', membership_id = $2, observation_id = $3, resolved_on = CURRENT_DATE
          WHERE id = $1`,
        [id, membershipId, o.rows[0].id]
      );
      state = 'applied_by_hand';
    } else if (body.action === 'not_mine') {
      await client.query(`UPDATE loyalty_inbox_reads SET state = 'not_mine', resolved_on = CURRENT_DATE WHERE id = $1`, [id]);
      if (item.suffix !== null) {
        await client.query(
          `INSERT INTO loyalty_inbox_not_mine (program_id, suffix) VALUES ($1, $2) ON CONFLICT (program_id, suffix) DO NOTHING`,
          [item.programId, item.suffix]
        );
        await client.query(
          `UPDATE loyalty_inbox_reads SET state = 'not_mine', resolved_on = CURRENT_DATE
            WHERE state = 'pending' AND reason = 'unmatched_suffix' AND program_id = $1 AND suffix = $2`,
          [item.programId, item.suffix]
        );
      }
      state = 'not_mine';
    } else {
      await client.query(`UPDATE loyalty_inbox_reads SET state = 'ignored', resolved_on = CURRENT_DATE WHERE id = $1`, [id]);
      state = 'ignored';
    }
    await client.query('COMMIT');
    log.info('loyalty read item resolved', { state });
    return { ok: true, value: { id, state } };
  } catch (err) {
    // A refusal is still answered as that refusal, and any other error still rejects as itself,
    // even when the rollback after it fails.
    await rollback(client);
    if (err instanceof Refusal) return err.failure;
    throw err;
  } finally {
    client.release();
  }
}

// ─── The overview's reading panel ──────────────────────────────────────────────────────────────

/**
 * The `inboxRead` object of the overview. Every count, date and match is Postgres's; balances and
 * dates are `::text`; the suffix leaves the database already masked. `candidateMembershipIds` applies
 * the suffix rule's normalisation and ending test to the stored numbers INSIDE the query, which
 * selects only ids, so no member number ever reaches this process from here.
 *
 * ONE SNAPSHOT (P8-42c4, D6). Called with the pool, whether defaulted or passed explicitly as
 * `loadOverview` does, the five statements run on ONE checked-out connection inside ONE
 * `READ ONLY` transaction at `REPEATABLE READ`, which is then committed (or rolled back) and the
 * client released on every path. They used to run in parallel on the pool as separate statements,
 * so a read run finishing between them could make the list longer than its own total. Under
 * `REPEATABLE READ` the snapshot is taken at the first statement and every later one sees exactly
 * it, so `needsAttention.length <= needsAttentionTotal` holds whatever commits meanwhile. The
 * isolation and the read-only mode are set on the `BEGIN` itself, because Postgres refuses a
 * `SET TRANSACTION` once a statement has run.
 *
 * Any other handle is a client a caller already checked out, so its transaction is the caller's:
 * the five run on it, in the same order, and no second `BEGIN` is sent on top of whatever the caller
 * opened (a nested `BEGIN` is only a warning, and the `COMMIT` after it would end the caller's work
 * early). No caller passes one today.
 */
export async function loadReadOverview(q: Queryable = db, env: Env = process.env): Promise<LoyaltyInboxReadPanel> {
  if (q !== db) return readPanel(q, env);
  const client = await db.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const panel = await readPanel(client, env);
    await client.query('COMMIT');
    return panel;
  } catch (err) {
    await rollback(client);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The panel's five statements on one handle, one after another. Sequential rather than
 * `Promise.all`: on a single client they would queue anyway, and awaiting each keeps a failing
 * statement from leaving others in flight behind the rollback.
 */
async function readPanel(q: Queryable, env: Env): Promise<LoyaltyInboxReadPanel> {
  const state = await q.query<{ on: string | null; outcome: 'ok' | 'error' | null; errorCode: LoyaltyReadRunErrorCode | null }>(
    `SELECT last_read_on::text AS "on", last_outcome AS outcome, last_error_code AS "errorCode" FROM loyalty_inbox_read_state WHERE id = 1`
  );
  // `failed` counts the `failed` rows PLUS the `retry` rows whose bytes are gone (P8-42c4, D4): no
  // stored message with that key still has `raw_mail`, because 42c1's retention deleted the row or
  // nulled the column. Such a row can never be read again and used to be counted nowhere. `NOT
  // EXISTS`, not a JOIN (two messages sharing a key would count one row twice) and not `NOT IN` (a
  // null would empty the set). A `retry` row whose bytes are present stays in `waiting` only, so no
  // message counts in both. Read-only on purpose: nothing is closed, so it holds with no API key
  // and for bytes that go after the last run.
  const counts = await q.query<{ waiting: number; failed: number; pending: number }>(
    `SELECT (SELECT count(*) FROM loyalty_inbox_messages m
              WHERE m.raw_mail IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM loyalty_inbox_reads r WHERE r.dedupe_key = m.dedupe_key AND r.state <> 'retry'))::int AS waiting,
            (SELECT count(*) FROM loyalty_inbox_reads r
              WHERE r.state = 'failed'
                 OR (r.state = 'retry'
                     AND NOT EXISTS (SELECT 1 FROM loyalty_inbox_messages m WHERE m.dedupe_key = r.dedupe_key AND m.raw_mail IS NOT NULL)))::int AS failed,
            (SELECT count(*) FROM loyalty_inbox_reads WHERE state = 'pending')::int AS pending`
  );
  const items = await q.query<LoyaltyReadItem>(
    `SELECT r.id, r.program_id AS "programId",
            CASE WHEN r.suffix IS NULL THEN NULL ELSE $2 || r.suffix END AS "maskedSuffix",
            r.balance::text AS balance, r.unit, r.as_of::text AS "asOf", r.received_on::text AS "receivedOn", r.reason,
            CASE WHEN r.suffix IS NULL THEN '{}'::int[] ELSE ARRAY(
              SELECT ms.id FROM loyalty_memberships ms
               WHERE ms.program_id = r.program_id AND ms.member_number IS NOT NULL
                 AND right(${NUMBER_KEY_SQL('ms.member_number')}, length(r.suffix)) = r.suffix
               ORDER BY ms.id) END AS "candidateMembershipIds"
       FROM loyalty_inbox_reads r
      WHERE r.state = 'pending'
      ORDER BY r.received_on DESC, r.id DESC
      LIMIT $1`,
    [LOYALTY_READ_QUEUE_LIMIT, LOYALTY_MASK_BULLETS]
  );
  const coverage = await q.query<{ programId: number; balanceInLastStatement: LoyaltyReadCoverage }>(
    `SELECT p.program_id AS "programId",
            CASE WHEN x.id IS NULL THEN 'not_read' WHEN x.balance IS NULL THEN 'no' ELSE 'yes' END AS "balanceInLastStatement"
       FROM (SELECT DISTINCT program_id FROM loyalty_sender_domains) p
       LEFT JOIN LATERAL (
         SELECT r.id, r.balance FROM loyalty_inbox_reads r
          WHERE r.program_id = p.program_id AND r.state NOT IN ('retry', 'failed')
          ORDER BY r.received_on DESC, r.id DESC LIMIT 1) x ON true
      ORDER BY p.program_id`
  );
  const fromMail = await q.query<LoyaltyReadFromMail>(
    `SELECT DISTINCT ON (r.membership_id)
            r.membership_id AS "membershipId", r.received_on::text AS "receivedOn",
            r.expiry_warnings AS "expiryWarnings", r.instruments
       FROM loyalty_inbox_reads r
      WHERE r.membership_id IS NOT NULL
        AND r.state IN ('applied', 'applied_by_hand', 'stale', 'no_balance')
        AND (r.expiry_warnings <> '[]'::jsonb OR r.instruments <> '[]'::jsonb)
      ORDER BY r.membership_id, r.received_on DESC, r.id DESC`
  );
  const s = state.rows[0];
  // A state row whose outcome is null has never been read; the CHECKs keep the date null with it.
  const lastRead = s && s.on !== null && s.outcome !== null ? { on: s.on, outcome: s.outcome, errorCode: s.errorCode } : null;
  return {
    readable: readerAvailable(env),
    lastRead,
    waiting: counts.rows[0].waiting,
    failed: counts.rows[0].failed,
    needsAttentionTotal: counts.rows[0].pending,
    needsAttention: items.rows,
    coverage: coverage.rows,
    fromMail: fromMail.rows,
  };
}
