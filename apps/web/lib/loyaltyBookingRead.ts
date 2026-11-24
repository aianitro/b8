// Hotel stays (P8-42e1) — the booking read: every stored hotel-program message is read once more by
// Claude, in a SECOND, SEPARATE read that asks only what kind of booking mail it is and, for a hotel
// confirmation, change or cancellation, the fields a stay needs. The clean pass, the attribution order
// and the supersession rule (`lib/domain/loyaltyBooking.ts`) decide whether it becomes or updates a
// stay, waits for one tap in the "need a membership" list on /travel, or is settled with nothing
// stored. This file lists, asks those rules, and records. Besides `lib/loyaltyInbox.ts` and
// `lib/loyaltyInboxRead.ts` it is the only non-test file that names the raw bytes column, and it
// reads that column one message at a time, only to prepare the text the reader is given.
//
// ─── WHY A SEPARATE PASS (SPEC.md D2 to D4) ───────────────────────────────────────────────────
//
// The balance read (`loyaltyInboxRead.ts`) is not touched: not its schema, its prompt, its tables,
// its lock or its run. This pass has its own table (`loyalty_inbox_booking_reads`, keyed by the
// message's dedupe key), its own advisory lock and its own daily step, which the daily job runs right
// after the balance read and before the digest. Whether the balance read already settled a message is
// irrelevant here: a confirmation that also prints a balance line must still become a stay, so a
// message's booking read never waits on, skips for or writes to its balance read.
//
// ─── WHAT A RUN DOES, IN ORDER ────────────────────────────────────────────────────────────────
//
//   1. Availability. No API key: `disabled`; nothing read, counted or written.
//   2. The lock, on ONE dedicated client, distinct from the poll's and the balance read's. Not taken:
//      `already_running`, nothing written. Released on every path.
//   3. Candidates: stored messages with bytes, of a program of kind `hotel`, with no booking-read row
//      or one in `retry`, oldest received first, at most `LOYALTY_READ_MAX_PER_RUN`. An airline or
//      card program's mail is never sent to the booking read.
//   4. Per message, isolated, exactly as the balance read does it: the attempt is written and
//      committed BEFORE the model is called, as the row a crash would leave (`retry`, or `failed` on
//      the last attempt, with the provisional code `api_error`); no text is `failed`/`empty_message`
//      with no call; the reader runs under its timeout plus five seconds; a result is cleaned and
//      decided in one transaction with the program's memberships locked.
//   5. Failures: `refused` and `empty_message` are terminal at once, the others retry until the third
//      attempt; a rate limit stops the run; three consecutive timeouts or API errors stop it; a run
//      past its time budget starts no new message.
//   6. The remaining count.
//
// ─── A STAY IS NEVER DELETED ──────────────────────────────────────────────────────────────────
//
// Nothing here deletes a stay. A cancellation sets its state and keeps the row, its dates and its
// code, which is what lets an older re-forwarded confirmation be recognised as older and refused.
// The retention purge deletes booking-read rows only.
//
// ─── LOGS CARRY COUNTS AND CODES ONLY ─────────────────────────────────────────────────────────
//
// Never a code, a suffix, a property, a date, a name, mail text, an error text, model output or a
// key. The model's output is never logged or stored; only the cleaned fields reach a row, and the
// cleaned booking object lives on its row only while it waits for a person.
//
// ─── DATES ARE POSTGRES'S ─────────────────────────────────────────────────────────────────────
//
// "Today" and the retention cut-off are CURRENT_DATE arithmetic in SQL; the supersession rule compares
// `YYYY-MM-DD` text. No JS clock is read; `setTimeout` bounds a call and the run, and is never read
// as a date.

import type { PoolClient } from 'pg';
import db from './db';
import { createLogger } from './logger';
import type { LoyaltyFailure, LoyaltyResult, Queryable } from './loyaltyStore';
import { textForReader } from './domain/loyaltyInbox';
import { matchSuffix, programCheck, type SuffixCandidate } from './domain/loyaltyRead';
import { cleanBooking, placeBooking, supersedes, type CleanBooking } from './domain/loyaltyBooking';
import { createBookingReader, readerAvailable, readTimeoutSeconds, type MailReader, type MailReaderResult } from './loyaltyReader';
import {
  LOYALTY_READ_MAX_ATTEMPTS,
  LOYALTY_READ_MAX_CHARS,
  LOYALTY_READ_MAX_PER_RUN,
  LOYALTY_READ_RETENTION_DAYS,
  LOYALTY_READ_RUN_BUDGET_SECONDS,
  LOYALTY_READ_STOP_AFTER,
  type LoyaltyBookingHoldReason,
  type LoyaltyBookingResolve,
  type LoyaltyBookingResolveRequest,
  type LoyaltyErrorCode,
  type LoyaltyInboxOrigin,
  type LoyaltyReadErrorCode,
  type LoyaltyReadProgramCheck,
  type LoyaltyReadRunErrorCode,
} from '@b8/contracts/loyalty';

const log = createLogger('loyalty-bookings');

/**
 * The advisory lock's key: Postgres's hash of a name no other feature uses, and neither the poll's nor
 * the balance read's, so the three never wait on each other.
 */
const LOCK_SQL = `hashtext('b8:loyalty-bookings:read')`;

/** How much longer than the reader's own timeout the pass waits before it gives up on a call. */
const BOUND_SLACK_SECONDS = 5;

type Env = Readonly<Record<string, string | undefined>>;

/** What one run did. Counts are messages; `errorCode` is the run's first failure, or null. */
export interface BookingRun {
  outcome: 'ok' | 'disabled' | 'already_running' | 'error';
  read: number;
  recorded: number;
  queued: number;
  stale: number;
  none: number;
  flights: number;
  noBooking: number;
  discarded: number;
  failed: number;
  remaining: number;
  errorCode: LoyaltyReadRunErrorCode | null;
}

type Counts = Omit<BookingRun, 'outcome' | 'errorCode'>;

const zeroCounts = (): Counts => ({
  read: 0, recorded: 0, queued: 0, stale: 0, none: 0, flights: 0, noBooking: 0, discarded: 0, failed: 0, remaining: 0,
});

// ─── The lock ──────────────────────────────────────────────────────────────────────────────────

/** Takes the booking lock on a dedicated client, or returns null (and releases it) when held elsewhere. */
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
 * Rolls back a failed transaction and never lets a failed ROLLBACK decide anything: the statement
 * or refusal that caused the rollback is what the caller answers with. A ROLLBACK that itself fails
 * is logged once with a fixed code; the error object and its text are never logged.
 */
async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    log.warn('loyalty booking rollback failed', { code: 'store_failed' });
  }
}

// ─── One message ───────────────────────────────────────────────────────────────────────────────

interface Candidate {
  messageId: number;
  key: string;
  programId: number;
  receivedOn: string;
  /** Attempts already made: 0 for a message with no booking-read row. */
  attempts: number;
  /** Where 42c1's poll found the original sender; `attachment` makes the text path read the attached original. */
  origin: LoyaltyInboxOrigin;
  /** The household member the poll attributed the message to (`matched` only), else null. */
  memberId: number | null;
}

/** Codes that end a message at their first occurrence: asking again would get the same answer. */
const TERMINAL: readonly LoyaltyReadErrorCode[] = ['refused', 'empty_message'];
/** Codes that count towards stopping the run: the service, not the message, is failing. */
const TRANSPORT: readonly LoyaltyReadErrorCode[] = ['timeout', 'api_error'];

/**
 * Counts the attempt, committed, before anything else happens to the message: the row is written as
 * the outcome a crash right now would leave. Returns the new attempt count, or null when the row is
 * no longer `retry` (another writer settled it), in which case the message is skipped.
 */
async function countAttempt(c: Candidate): Promise<number | null> {
  const attempts = c.attempts + 1;
  const state = attempts >= LOYALTY_READ_MAX_ATTEMPTS ? 'failed' : 'retry';
  const r = await db.query(
    `INSERT INTO loyalty_inbox_booking_reads (dedupe_key, program_id, received_on, state, attempts, last_error_code)
     VALUES ($1, $2, $3::date, $4, $5, 'api_error')
     ON CONFLICT (dedupe_key) DO UPDATE SET state = EXCLUDED.state, attempts = EXCLUDED.attempts, last_error_code = 'api_error'
       WHERE loyalty_inbox_booking_reads.state = 'retry' AND loyalty_inbox_booking_reads.attempts = $5 - 1
     RETURNING id`,
    [c.key, c.programId, c.receivedOn, state, attempts]
  );
  return r.rows.length === 1 ? attempts : null;
}

/** Records a failed attempt: terminal codes and the last attempt are `failed`, the rest `retry`. */
async function recordFailure(key: string, attempts: number, code: LoyaltyReadErrorCode): Promise<void> {
  const state = TERMINAL.includes(code) || attempts >= LOYALTY_READ_MAX_ATTEMPTS ? 'failed' : 'retry';
  await db.query(
    `UPDATE loyalty_inbox_booking_reads SET state = $2, last_error_code = $3 WHERE dedupe_key = $1 AND state IN ('retry', 'failed')`,
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

/**
 * The booking a stay is written from: always a hotel kind and a valid code. The dates are null only
 * for a cancellation that stated none, which can only cancel a stay that already exists.
 */
interface Booking {
  kind: 'hotel_booked' | 'hotel_cancelled';
  property: string | null;
  checkIn: string | null;
  checkOut: string | null;
  code: string;
  award: boolean | null;
}

/** The mail a booking came from: its received date and dedupe key become the stay's evidence. */
interface Evidence {
  receivedOn: string;
  key: string;
}

type Applied = { state: 'applied'; stayId: number } | { state: 'stale' } | { state: 'no_stay' };

/**
 * Applies one booking to the stays table, inside the caller's transaction, by the dedupe rule (one
 * row per program and normalised code) and the supersession rule:
 *
 *   no stay for the code — a dated booking inserts one on `membershipId`, source `email`, with this
 *     mail as its evidence (a cancellation with dates inserts it cancelled, so a late confirmation of
 *     the same code is recognised as older); an undated cancellation stores nothing (`no_stay`).
 *   a stay exists — when the mail supersedes it, its dates (when the mail states them), property,
 *     award and state are replaced, its source becomes `email` and its evidence this mail. Its
 *     MEMBERSHIP IS NEVER CHANGED: the first attribution is sticky, so a later mail placed on another
 *     membership of the program updates the stay where it is. Otherwise nothing changes (`stale`).
 *     A mailed booking never revives a cancelled stay (SPEC.md A5); `byHand`, the hold's `place`,
 *     may.
 *
 * The row is locked before the rule reads it, and an insert that loses a race to another writer of
 * the same code falls through to the existing-stay branch rather than failing.
 */
async function applyBooking(client: PoolClient, programId: number, membershipId: number | null, b: Booking, ev: Evidence, byHand = false): Promise<Applied> {
  const existing = async () => (await client.query<{ id: number; state: 'booked' | 'cancelled'; evidence: string | null }>(
    `SELECT id, state, evidence_received_on::text AS evidence FROM loyalty_stays
      WHERE program_id = $1 AND confirmation_code = $2 FOR UPDATE`,
    [programId, b.code]
  )).rows[0];
  const state = b.kind === 'hotel_cancelled' ? 'cancelled' : 'booked';
  let stay = await existing();
  if (!stay) {
    if (b.checkIn === null || b.checkOut === null || membershipId === null) return { state: 'no_stay' };
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO loyalty_stays (membership_id, program_id, confirmation_code, check_in, check_out, property, state, source,
                                  evidence_key, evidence_received_on, award)
       VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, 'email', $8, $9::date, $10)
       ON CONFLICT (program_id, confirmation_code) DO NOTHING RETURNING id`,
      [membershipId, programId, b.code, b.checkIn, b.checkOut, b.property, state, ev.key, ev.receivedOn, b.award]
    );
    if (inserted.rows.length === 1) return { state: 'applied', stayId: inserted.rows[0].id };
    stay = await existing();
    if (!stay) return { state: 'no_stay' };
  }
  if (!supersedes({ state: stay.state, evidenceReceivedOn: stay.evidence }, { kind: b.kind, receivedOn: ev.receivedOn }, byHand)) return { state: 'stale' };
  if (b.checkIn === null || b.checkOut === null) {
    // A cancellation that states no dates: the stay keeps everything it knew and is cancelled.
    await client.query(
      `UPDATE loyalty_stays SET state = $2, source = 'email', evidence_key = $3, evidence_received_on = $4::date, updated_at = NOW()
        WHERE id = $1`,
      [stay.id, state, ev.key, ev.receivedOn]
    );
  } else {
    await client.query(
      `UPDATE loyalty_stays SET check_in = $2::date, check_out = $3::date, property = $4, award = $5, state = $6, source = 'email',
              evidence_key = $7, evidence_received_on = $8::date, updated_at = NOW()
        WHERE id = $1`,
      [stay.id, b.checkIn, b.checkOut, b.property, b.award, state, ev.key, ev.receivedOn]
    );
  }
  return { state: 'applied', stayId: stay.id };
}

/** What the pass decided for one read message; the run counts it. */
type Outcome = 'none' | 'flight' | 'no_booking' | 'stale' | 'recorded' | 'pending' | 'not_mine_known';

/**
 * Decides one cleaned booking and stores the outcome in ONE transaction: the program's memberships
 * are locked first, so two writers of the same program (this pass, a tap, a typed write) take turns,
 * and a stay, its booking-read row and its state are written together or not at all.
 */
async function decideAndStore(c: Candidate, booking: CleanBooking): Promise<Outcome> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const memberships = await client.query<SuffixCandidate & { memberId: number }>(
      `SELECT id, program_id AS "programId", member_number AS number, member_id AS "memberId"
         FROM loyalty_memberships WHERE program_id = $1 ORDER BY id FOR UPDATE`,
      [c.programId]
    );
    const names = await client.query<{ names: string[] }>(
      `SELECT array_prepend(p.name, coalesce((SELECT array_agg(a.alias ORDER BY a.id) FROM loyalty_program_aliases a WHERE a.program_id = p.id), '{}')) AS names
         FROM loyalty_programs p WHERE p.id = $1`,
      [c.programId]
    );
    const check: LoyaltyReadProgramCheck = programCheck(booking.programName, names.rows[0].names);

    let outcome: Outcome;
    let reason: LoyaltyBookingHoldReason | null = null;
    let membershipId: number | null = null;
    let stayId: number | null = null;
    let held: Booking | null = null;
    // Only the hotel kinds keep their suffix: a flight or `none` stores nothing extracted.
    const suffix = booking.kind === 'hotel_booked' || booking.kind === 'hotel_cancelled' ? booking.suffix : null;

    if (booking.kind === 'none' || booking.kind === 'flight') {
      outcome = booking.kind;
    } else if (booking.code === null) {
      outcome = 'no_booking';
    } else {
      const b: Booking = {
        kind: booking.kind, property: booking.property, checkIn: booking.checkIn, checkOut: booking.checkOut, code: booking.code, award: booking.award,
      };
      const ev: Evidence = { receivedOn: c.receivedOn, key: c.key };
      if (b.checkIn === null) {
        // No usable dates. A booking is then no stay at all; a cancellation can still cancel the stay
        // its code already names (it changes nothing but the state, so it needs no attribution, and
        // the stay's own membership is the one it concerns). Without such a stay it is nothing.
        const applied = b.kind === 'hotel_cancelled' ? await applyBooking(client, c.programId, null, b, ev) : { state: 'no_stay' as const };
        if (applied.state === 'applied') {
          stayId = applied.stayId;
          membershipId = (await client.query<{ m: number }>('SELECT membership_id AS m FROM loyalty_stays WHERE id = $1', [stayId])).rows[0].m;
          outcome = 'recorded';
        } else {
          outcome = applied.state === 'stale' ? 'stale' : 'no_booking';
        }
      } else {
        const forwarder = c.memberId === null ? null : memberships.rows.find((m) => m.memberId === c.memberId)?.id ?? null;
        const notMine = suffix === null ? false : (await client.query(
          'SELECT 1 FROM loyalty_inbox_not_mine WHERE program_id = $1 AND suffix = $2', [c.programId, suffix]
        )).rows.length > 0;
        const decision = placeBooking({
          programCheck: check,
          suffix,
          match: suffix === null ? null : matchSuffix(suffix, c.programId, memberships.rows),
          forwarderMembershipId: forwarder,
          notMine,
        });
        if (decision.kind === 'discard') {
          outcome = 'not_mine_known';
        } else if (decision.kind === 'hold') {
          outcome = 'pending';
          reason = decision.reason;
          held = b;
        } else {
          membershipId = decision.membershipId;
          const applied = await applyBooking(client, c.programId, membershipId, b, ev);
          if (applied.state === 'applied') {
            stayId = applied.stayId;
            outcome = 'recorded';
          } else {
            outcome = 'stale';
          }
        }
      }
    }

    const updated = await client.query(
      `UPDATE loyalty_inbox_booking_reads
          SET state = $2, last_error_code = NULL, kind = $3, program_check = $4, reason = $5, suffix = $6,
              booking = $7::jsonb, membership_id = $8, stay_id = $9, read_on = CURRENT_DATE,
              resolved_on = CASE WHEN $2 = 'pending' THEN NULL ELSE CURRENT_DATE END
        WHERE dedupe_key = $1 AND state IN ('retry', 'failed')`,
      [
        c.key, outcome, booking.kind, check, reason,
        // A `not_mine_known` row keeps the suffix it was discarded on; `none` and `flight` keep none.
        outcome === 'none' || outcome === 'flight' ? null : suffix,
        held === null ? null : JSON.stringify(held),
        outcome === 'pending' || outcome === 'not_mine_known' ? null : membershipId,
        stayId,
      ]
    );
    // The attempt row was written by this run under the lock; if it is gone the stay must not stand alone.
    if ((updated.rowCount ?? 0) !== 1) throw new Error('booking read row missing');
    await client.query('COMMIT');
    return outcome;
  } catch (err) {
    await rollback(client);
    throw err;
  } finally {
    client.release();
  }
}

// ─── The run ───────────────────────────────────────────────────────────────────────────────────

/** The candidate rule, shared by the selection and the remaining count. */
const CANDIDATE_SQL = `m.raw_mail IS NOT NULL
        AND EXISTS (SELECT 1 FROM loyalty_programs p WHERE p.id = m.program_id AND p.kind = 'hotel')`;

/** Hotel-program messages still to read: stored with bytes, and unread or in `retry`. */
async function remainingCount(q: Queryable = db): Promise<number> {
  const r = await q.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM loyalty_inbox_messages m
      WHERE ${CANDIDATE_SQL}
        AND NOT EXISTS (SELECT 1 FROM loyalty_inbox_booking_reads b WHERE b.dedupe_key = m.dedupe_key AND b.state <> 'retry')`
  );
  return r.rows[0].n;
}

/** The body of one run, under the lock. Returns the run's error code, or null. */
async function readAll(reader: MailReader, env: Env, counts: Counts): Promise<LoyaltyReadRunErrorCode | null> {
  const candidates = await db.query<Candidate>(
    `SELECT m.id AS "messageId", m.dedupe_key AS key, m.program_id AS "programId", m.received_on::text AS "receivedOn",
            coalesce(b.attempts, 0)::int AS attempts, m.origin, m.member_id AS "memberId"
       FROM loyalty_inbox_messages m LEFT JOIN loyalty_inbox_booking_reads b ON b.dedupe_key = m.dedupe_key
      WHERE ${CANDIDATE_SQL} AND (b.id IS NULL OR b.state = 'retry')
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
        // Bytes that vanished since the selection are not an empty message: the row stays as the
        // attempt left it, and the run counts it as neither read nor failed (the balance read's rule).
        if (raw === null) continue;
        const input = await textForReader(raw, LOYALTY_READ_MAX_CHARS, c.origin).catch(() => null);
        if (input === null || input.text === '') {
          code = 'empty_message';
        } else {
          const result = await readBounded(reader, input, boundMs);
          if (!result.ok) {
            code = result.code;
          } else {
            const outcome = await decideAndStore(c, cleanBooking(result.reading));
            counts.read++;
            if (outcome === 'recorded') counts.recorded++;
            else if (outcome === 'pending') counts.queued++;
            else if (outcome === 'stale') counts.stale++;
            else if (outcome === 'none') counts.none++;
            else if (outcome === 'flight') counts.flights++;
            else if (outcome === 'no_booking') counts.noBooking++;
            else counts.discarded++;
          }
        }
      } catch {
        // A database failure while deciding this message: its row stays as the attempt left it, and
        // the next message is read.
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

/**
 * One booking-read run over the stored hotel-program mail. Resolves, never rejects: a failure is
 * `outcome: 'error'` with a code. The environment is read now, not at import.
 */
export async function readStoredBookings(env: Env = process.env): Promise<BookingRun> {
  if (!readerAvailable(env)) return { outcome: 'disabled', ...zeroCounts(), errorCode: null };

  let lock: PoolClient | null;
  try {
    lock = await takeLock();
  } catch {
    log.error('loyalty booking read failed', { code: 'store_failed' });
    return { outcome: 'error', ...zeroCounts(), errorCode: 'store_failed' };
  }
  if (lock === null) return { outcome: 'already_running', ...zeroCounts(), errorCode: null };

  const counts = zeroCounts();
  let errorCode: LoyaltyReadRunErrorCode | null = null;
  try {
    try {
      errorCode = await readAll(createBookingReader(env), env, counts);
    } catch {
      errorCode = 'store_failed';
    }
    try {
      counts.remaining = await remainingCount();
    } catch {
      errorCode = errorCode ?? 'store_failed';
    }
  } finally {
    await releaseLock(lock);
  }
  if (errorCode === null) log.info('loyalty booking read', { ...counts });
  else log.warn('loyalty booking read failed', { code: errorCode, ...counts });
  return { outcome: errorCode === null ? 'ok' : 'error', ...counts, errorCode };
}

// ─── Retention ─────────────────────────────────────────────────────────────────────────────────

/**
 * Deletes booking-read rows received STRICTLY before CURRENT_DATE minus the retention days, in every
 * state, held bookings included: exactly the retention age is kept, one day older is deleted. Stays
 * are never deleted here, whatever their age; a stay outlives the read that wrote it.
 */
export async function purgeExpiredBookingReads(q: Queryable = db): Promise<number> {
  const r = await q.query('DELETE FROM loyalty_inbox_booking_reads WHERE received_on < CURRENT_DATE - $1::int', [LOYALTY_READ_RETENTION_DAYS]);
  return r.rowCount ?? 0;
}

/**
 * The daily job's step, after the balance read and before the digest (SPEC.md D4): read, then purge
 * (the purge runs even when reading is disabled, so retention never waits on a key). Resolves, never
 * rejects: a booking-read failure must never cost the digest after it. The scheduler carries only
 * the import and the call, so this is where the step's ordering is explained.
 */
export async function runLoyaltyBookingsDaily(): Promise<void> {
  try {
    const run = await readStoredBookings();
    const purged = await purgeExpiredBookingReads();
    log.info('loyalty booking daily step', { outcome: run.outcome, code: run.errorCode, read: run.read, recorded: run.recorded, queued: run.queued, purged });
  } catch {
    log.error('loyalty booking daily step failed', { code: 'store_failed' });
  }
}

// ─── The one-tap actions ───────────────────────────────────────────────────────────────────────

const refuse = (code: LoyaltyErrorCode, message?: string): LoyaltyFailure => {
  log.warn('loyalty booking action refused', { code });
  return { ok: false, code, message };
};

/** Raised inside the action's transaction to roll it back and answer with a refusal. */
class Refusal extends Error {
  constructor(readonly failure: LoyaltyFailure) { super('refused'); }
}

interface ItemRow {
  id: number;
  key: string;
  programId: number;
  state: string;
  suffix: string | null;
  receivedOn: string;
  booking: Booking | null;
}

/**
 * One action on one held booking (SPEC.md D10), in one transaction with the item's row locked, so two
 * simultaneous taps resolve it once: the second sees a row that is no longer `pending` and is 409
 * `ITEM_RESOLVED`, and exactly one stay is written. Error messages are fixed sentences and never echo
 * input.
 *
 *   place    — the membership must be one of the item's program. The held booking is applied by the
 *              dedupe and supersession rules, with the item's mail as evidence; the item becomes
 *              `placed_by_hand` (with the stay it wrote or updated, or none when the stay already
 *              reflects a newer mail).
 *   not_mine — the item, and every other held booking of its program and suffix, becomes `not_mine`;
 *              the pair is recorded on the not-mine list (idempotently) when there is a suffix.
 *   ignore   — the item becomes `ignored`. Nothing else.
 *
 * Every resolution clears the held booking object: it exists only while a person has not decided.
 */
export async function resolveBooking(id: number, body: LoyaltyBookingResolveRequest): Promise<LoyaltyResult<LoyaltyBookingResolve>> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<ItemRow>(
      `SELECT id, dedupe_key AS key, program_id AS "programId", state, suffix, received_on::text AS "receivedOn", booking
         FROM loyalty_inbox_booking_reads WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const item = r.rows[0];
    if (!item) throw new Refusal(refuse('NOT_FOUND'));
    if (item.state !== 'pending' || item.booking === null) throw new Refusal(refuse('ITEM_RESOLVED'));

    let state: LoyaltyBookingResolve['state'];
    if (body.action === 'place') {
      // The program's memberships are locked as the pass locks them, so a tap and a run take turns.
      const memberships = await client.query<{ id: number }>(
        'SELECT id FROM loyalty_memberships WHERE program_id = $1 ORDER BY id FOR UPDATE', [item.programId]
      );
      if (!memberships.rows.some((m) => m.id === body.membershipId)) {
        throw new Refusal(refuse('INVALID_INPUT', 'That membership is not one of this program.'));
      }
      // By hand (SPEC.md A5): a person chose this booking, so it may re-book a cancelled stay.
      const applied = await applyBooking(client, item.programId, body.membershipId, item.booking, { receivedOn: item.receivedOn, key: item.key }, true);
      await client.query(
        `UPDATE loyalty_inbox_booking_reads SET state = 'placed_by_hand', booking = NULL, membership_id = $2, stay_id = $3,
                resolved_on = CURRENT_DATE
          WHERE id = $1`,
        [id, body.membershipId, applied.state === 'applied' ? applied.stayId : null]
      );
      state = 'placed_by_hand';
    } else if (body.action === 'not_mine') {
      await client.query(`UPDATE loyalty_inbox_booking_reads SET state = 'not_mine', booking = NULL, resolved_on = CURRENT_DATE WHERE id = $1`, [id]);
      if (item.suffix !== null) {
        await client.query(
          `INSERT INTO loyalty_inbox_not_mine (program_id, suffix) VALUES ($1, $2) ON CONFLICT (program_id, suffix) DO NOTHING`,
          [item.programId, item.suffix]
        );
        await client.query(
          `UPDATE loyalty_inbox_booking_reads SET state = 'not_mine', booking = NULL, resolved_on = CURRENT_DATE
            WHERE state = 'pending' AND program_id = $1 AND suffix = $2`,
          [item.programId, item.suffix]
        );
      }
      state = 'not_mine';
    } else {
      await client.query(`UPDATE loyalty_inbox_booking_reads SET state = 'ignored', booking = NULL, resolved_on = CURRENT_DATE WHERE id = $1`, [id]);
      state = 'ignored';
    }
    await client.query('COMMIT');
    log.info('loyalty booking item resolved', { state });
    return { ok: true, value: { id, state } };
  } catch (err) {
    // A refusal is still answered as that refusal, and any other error still rejects as itself, even
    // when the rollback after it fails.
    await rollback(client);
    if (err instanceof Refusal) return err.failure;
    throw err;
  } finally {
    client.release();
  }
}

