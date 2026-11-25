// Flights (P8-42e1b) — the flight read: every stored airline-program message is read once more by
// Claude, in a THIRD, SEPARATE read that asks only what kind of flight mail it is and, for a flight
// confirmation, change or cancellation, the fields a segment needs. The clean pass, the leg plan and
// the supersession rule (`lib/domain/loyaltyFlight.ts`) and 42e1's attribution order decide whether
// it becomes or updates segments, waits for one tap in the "need a membership" list of the `Flights`
// section on /travel, or is settled with nothing stored. This file lists, asks those rules, and
// records. It is the fourth and last non-test file that names the raw bytes column, and it reads that
// column one message at a time, only to prepare the text the reader is given.
//
// ─── WHY A SEPARATE PASS (SPEC.md D1 to D4) ───────────────────────────────────────────────────
//
// The balance read and the hotel booking read are not touched: not their schemas, prompts, tables,
// locks or runs. This pass has its own ledger (`loyalty_inbox_flight_reads`, keyed by the message's
// dedupe key), its own advisory lock and its own daily step, which the daily job runs right after the
// hotel booking step and before the digest. It reads only mail of programs of kind `airline`; a hotel
// program's mail that the hotel read classed as a flight names no airline membership and is never
// read here (D1).
//
// ─── WHAT A RUN DOES, IN ORDER ────────────────────────────────────────────────────────────────
//
//   1. Availability. No API key: `disabled`; nothing read, counted or written.
//   2. The lock, on ONE dedicated client, distinct from every other loyalty lock. Not taken:
//      `already_running`, nothing written. Released on every path.
//   3. Candidates: stored messages with bytes, of a program of kind `airline`, with no flight-read
//      row or one in `retry`, oldest received first, at most `LOYALTY_READ_MAX_PER_RUN`.
//   4. Per message, isolated: the attempt is written and committed BEFORE the model is called, as the
//      row a crash would leave (`retry`, or `failed` on the last attempt, with the provisional code
//      `api_error`); no text is `failed`/`empty_message` with no call; the reader runs under its
//      timeout plus five seconds; a result is cleaned and decided in one transaction with the
//      program's memberships and the code's segments locked.
//   5. Failures: `refused` and `empty_message` are terminal at once, the others retry until the third
//      attempt; a rate limit stops the run; three consecutive timeouts or API errors stop it; a run
//      past its time budget starts no new message.
//   6. The remaining count.
//
// ─── THE ORDER OF ONE DECISION ────────────────────────────────────────────────────────────────
//
// Unusable first (no code, no legs, void legs, a leg outside the date window: `no_booking`), then
// supersession against the code's group (`stale`), and only THEN attribution. Deciding staleness
// before the hold is deliberate (D8): a re-forward of an old confirmation for a cancelled booking is
// settled as `stale` and never offered for a tap that would re-book it by hand (42e1's NITS N6).
//
// ─── A SEGMENT IS NEVER DELETED ───────────────────────────────────────────────────────────────
//
// Nothing here deletes a segment. A cancellation sets its state and keeps the row, its date, number
// and code, which is what lets an older re-forwarded confirmation be recognised and refused. The
// retention purge deletes flight-read rows only.
//
// ─── LOGS CARRY COUNTS AND CODES ONLY ─────────────────────────────────────────────────────────
//
// Never a code, a suffix, an airport, a flight number, a date, a name, mail text, an error text,
// model output or a key. Only the cleaned fields reach a row, and the cleaned booking object lives on
// its row only while it waits for a person.
//
// ─── DATES ARE POSTGRES'S ─────────────────────────────────────────────────────────────────────
//
// "Today" and the retention cut-off are CURRENT_DATE arithmetic in SQL; supersession compares
// `YYYY-MM-DD` text and the date window is integer day arithmetic. No JS clock is read; `setTimeout`
// bounds a call and the run, and is never read as a date.

import type { PoolClient } from 'pg';
import db from './db';
import { createLogger } from './logger';
import type { LoyaltyFailure, LoyaltyResult, Queryable } from './loyaltyStore';
import { textForReader } from './domain/loyaltyInbox';
import { matchSuffix, programCheck, type SuffixCandidate } from './domain/loyaltyRead';
import { placeBooking } from './domain/loyaltyBooking';
import {
  cleanFlight,
  flightStanding,
  flightSupersedes,
  legsPlausible,
  planChanges,
  planFlight,
  type CleanFlight,
  type ExistingLeg,
  type FlightPlan,
  type Leg,
} from './domain/loyaltyFlight';
import { createFlightReader, readerAvailable, readTimeoutSeconds, type MailReader, type MailReaderResult } from './loyaltyReader';
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

const log = createLogger('loyalty-flights');

/**
 * The advisory lock's key: Postgres's hash of a name no other feature uses, so this pass never waits
 * on the poll, the balance read or the hotel booking read, nor they on it.
 */
const LOCK_SQL = `hashtext('b8:loyalty-flights:read')`;

/** How much longer than the reader's own timeout the pass waits before it gives up on a call. */
const BOUND_SLACK_SECONDS = 5;

type Env = Readonly<Record<string, string | undefined>>;

/** What one run did. Counts are messages; `errorCode` is the run's first failure, or null. */
export interface FlightRun {
  outcome: 'ok' | 'disabled' | 'already_running' | 'error';
  read: number;
  recorded: number;
  queued: number;
  stale: number;
  none: number;
  noBooking: number;
  discarded: number;
  failed: number;
  remaining: number;
  errorCode: LoyaltyReadRunErrorCode | null;
}

type Counts = Omit<FlightRun, 'outcome' | 'errorCode'>;

const zeroCounts = (): Counts => ({
  read: 0, recorded: 0, queued: 0, stale: 0, none: 0, noBooking: 0, discarded: 0, failed: 0, remaining: 0,
});

// ─── The lock ──────────────────────────────────────────────────────────────────────────────────

/** Takes the flight lock on a dedicated client, or returns null (and releases it) when held elsewhere. */
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
 * Rolls back a failed transaction and never lets a failed ROLLBACK decide anything: the statement or
 * refusal that caused the rollback is what the caller answers with. A ROLLBACK that itself fails is
 * logged once with a fixed code; the error object and its text are never logged.
 */
async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    log.warn('loyalty flight rollback failed', { code: 'store_failed' });
  }
}

// ─── One message ───────────────────────────────────────────────────────────────────────────────

interface Candidate {
  messageId: number;
  key: string;
  programId: number;
  receivedOn: string;
  /** Attempts already made: 0 for a message with no flight-read row. */
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
    `INSERT INTO loyalty_inbox_flight_reads (dedupe_key, program_id, received_on, state, attempts, last_error_code)
     VALUES ($1, $2, $3::date, $4, $5, 'api_error')
     ON CONFLICT (dedupe_key) DO UPDATE SET state = EXCLUDED.state, attempts = EXCLUDED.attempts, last_error_code = 'api_error'
       WHERE loyalty_inbox_flight_reads.state = 'retry' AND loyalty_inbox_flight_reads.attempts = $5 - 1
     RETURNING id`,
    [c.key, c.programId, c.receivedOn, state, attempts]
  );
  return r.rows.length === 1 ? attempts : null;
}

/** Records a failed attempt: terminal codes and the last attempt are `failed`, the rest `retry`. */
async function recordFailure(key: string, attempts: number, code: LoyaltyReadErrorCode): Promise<void> {
  const state = TERMINAL.includes(code) || attempts >= LOYALTY_READ_MAX_ATTEMPTS ? 'failed' : 'retry';
  await db.query(
    `UPDATE loyalty_inbox_flight_reads SET state = $2, last_error_code = $3 WHERE dedupe_key = $1 AND state IN ('retry', 'failed')`,
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
 * The booking segments are written from, and exactly the object a held row carries (the table's
 * CHECK fixes these five keys): always a flight kind and a valid code. `legs` is empty only for a
 * cancellation of the whole code.
 */
interface Booking {
  kind: 'flight_booked' | 'flight_cancelled';
  code: string;
  award: boolean | null;
  complete: boolean;
  legs: Leg[];
}

/** The mail a booking came from: its received date and dedupe key become the segments' evidence. */
interface Evidence {
  receivedOn: string;
  key: string;
}

/** A stored leg of a code: what the plan needs, its evidence date and the membership it sits on. */
type StoredLeg = ExistingLeg & { membershipId: number; evidenceReceivedOn: string | null };

/** The code's stored legs, locked, with what the plan and the standing need. */
async function legsOfCode(client: PoolClient, programId: number, code: string): Promise<StoredLeg[]> {
  const r = await client.query<StoredLeg>(
    `SELECT flight_date::text AS "flightDate", origin, destination, carrier, flight_number AS "flightNumber", state, source,
            evidence_received_on::text AS "evidenceReceivedOn", membership_id AS "membershipId"
       FROM loyalty_segments WHERE program_id = $1 AND confirmation_code = $2 ORDER BY id FOR UPDATE`,
    [programId, code]
  );
  return r.rows;
}

/**
 * Performs a plan inside the caller's transaction. Inserted legs go on `membershipId` (the membership
 * the code's legs are already on, or the placed one for a first leg), with this mail as evidence and
 * source `email`; every other change also makes the mail the row's evidence and its source `email`.
 * Nothing is deleted, and a row's membership is never changed.
 */
async function applyPlan(client: PoolClient, programId: number, membershipId: number, b: Booking, plan: FlightPlan, ev: Evidence): Promise<void> {
  const insertState = b.kind === 'flight_cancelled' ? 'cancelled' : 'booked';
  for (const leg of plan.insert) {
    await client.query(
      `INSERT INTO loyalty_segments (membership_id, program_id, confirmation_code, flight_date, origin, destination, carrier, flight_number,
                                     state, source, evidence_key, evidence_received_on, award)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, 'email', $10, $11::date, $12)`,
      [membershipId, programId, b.code, leg.flightDate, leg.origin, leg.destination, leg.carrier, leg.flightNumber, insertState, ev.key, ev.receivedOn, b.award]
    );
  }
  for (const leg of [...plan.rewrite, ...plan.rebook]) {
    await client.query(
      `UPDATE loyalty_segments SET origin = $6, destination = $7, award = $8, state = 'booked', source = 'email',
              evidence_key = $9, evidence_received_on = $10::date, updated_at = NOW()
        WHERE program_id = $1 AND confirmation_code = $2 AND flight_date = $3::date AND carrier = $4 AND flight_number = $5`,
      [programId, b.code, leg.flightDate, leg.carrier, leg.flightNumber, leg.origin, leg.destination, b.award, ev.key, ev.receivedOn]
    );
  }
  for (const leg of plan.cancel) {
    await client.query(
      `UPDATE loyalty_segments SET state = 'cancelled', source = 'email', evidence_key = $6, evidence_received_on = $7::date, updated_at = NOW()
        WHERE program_id = $1 AND confirmation_code = $2 AND flight_date = $3::date AND carrier = $4 AND flight_number = $5`,
      [programId, b.code, leg.flightDate, leg.carrier, leg.flightNumber, ev.key, ev.receivedOn]
    );
  }
}

/** What the pass decided for one read message; the run counts it. */
type Outcome = 'none' | 'no_booking' | 'stale' | 'recorded' | 'pending' | 'not_mine_known';

/** The booking a cleaned flight stands for, or null when it is unusable (`no_booking`). */
function bookingOf(flight: CleanFlight, receivedOn: string): Booking | null {
  if (flight.kind === 'none' || flight.code === null || flight.legsVoid) return null;
  if (flight.kind === 'flight_booked' && flight.legs.length === 0) return null;
  if (!legsPlausible(receivedOn, flight.legs)) return null;
  return { kind: flight.kind, code: flight.code, award: flight.award, complete: flight.complete, legs: flight.legs };
}

/**
 * Decides one cleaned flight and stores the outcome in ONE transaction: the program's memberships are
 * locked first, so two writers of the same program (this pass, a tap, a typed write) take turns, and
 * the code's segments, the flight-read row and its state are written together or not at all.
 */
async function decideAndStore(c: Candidate, flight: CleanFlight): Promise<Outcome> {
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
    const check: LoyaltyReadProgramCheck = programCheck(flight.programName, names.rows[0].names);

    let outcome: Outcome;
    let reason: LoyaltyBookingHoldReason | null = null;
    let membershipId: number | null = null;
    let held: Booking | null = null;
    const suffix = flight.kind === 'none' ? null : flight.suffix;
    const b = bookingOf(flight, c.receivedOn);

    if (flight.kind === 'none') {
      outcome = 'none';
    } else if (b === null) {
      outcome = 'no_booking';
    } else {
      const existing = await legsOfCode(client, c.programId, b.code);
      const standing = flightStanding(existing);
      if (!flightSupersedes(standing, { kind: b.kind, receivedOn: c.receivedOn })) {
        // Decided before attribution, so a mail that cannot apply is never held for a tap.
        outcome = 'stale';
      } else if (b.kind === 'flight_cancelled' && b.legs.length === 0 && existing.length === 0) {
        // A whole-code cancellation of a code nothing knows: there is nothing to cancel.
        outcome = 'no_booking';
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
          // Every flight mail goes through attribution, a cancellation included: one that cannot be
          // placed is held, never applied to whichever membership the code happens to be on.
          outcome = 'pending';
          reason = decision.reason;
          held = b;
        } else {
          // The first attribution is sticky: a code whose legs already sit on a membership keeps
          // them there, and the read row records where they are.
          membershipId = existing.length > 0 ? existing[0].membershipId : decision.membershipId;
          const plan = planFlight({ existing, incoming: b, receivedOn: c.receivedOn, byHand: false });
          if (planChanges(plan)) {
            await applyPlan(client, c.programId, membershipId, b, plan, { receivedOn: c.receivedOn, key: c.key });
            outcome = 'recorded';
          } else {
            outcome = 'stale';
          }
        }
      }
    }

    const updated = await client.query(
      `UPDATE loyalty_inbox_flight_reads
          SET state = $2, last_error_code = NULL, kind = $3, program_check = $4, reason = $5, suffix = $6,
              booking = $7::jsonb, membership_id = $8, read_on = CURRENT_DATE,
              resolved_on = CASE WHEN $2 = 'pending' THEN NULL ELSE CURRENT_DATE END
        WHERE dedupe_key = $1 AND state IN ('retry', 'failed')`,
      [
        c.key, outcome, flight.kind, check, reason,
        outcome === 'none' ? null : suffix,
        held === null ? null : JSON.stringify(held),
        outcome === 'recorded' ? membershipId : null,
      ]
    );
    // The attempt row was written by this run under the lock; if it is gone the segments must not stand alone.
    if ((updated.rowCount ?? 0) !== 1) throw new Error('flight read row missing');
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

/** The candidate rule, shared by the selection and the remaining count: airline programs only. */
const CANDIDATE_SQL = `m.raw_mail IS NOT NULL
        AND EXISTS (SELECT 1 FROM loyalty_programs p WHERE p.id = m.program_id AND p.kind = 'airline')`;

/** Airline-program messages still to read: stored with bytes, and unread or in `retry`. */
async function remainingCount(q: Queryable = db): Promise<number> {
  const r = await q.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM loyalty_inbox_messages m
      WHERE ${CANDIDATE_SQL}
        AND NOT EXISTS (SELECT 1 FROM loyalty_inbox_flight_reads f WHERE f.dedupe_key = m.dedupe_key AND f.state <> 'retry')`
  );
  return r.rows[0].n;
}

/** The body of one run, under the lock. Returns the run's error code, or null. */
async function readAll(reader: MailReader, env: Env, counts: Counts): Promise<LoyaltyReadRunErrorCode | null> {
  const candidates = await db.query<Candidate>(
    `SELECT m.id AS "messageId", m.dedupe_key AS key, m.program_id AS "programId", m.received_on::text AS "receivedOn",
            coalesce(f.attempts, 0)::int AS attempts, m.origin, m.member_id AS "memberId"
       FROM loyalty_inbox_messages m LEFT JOIN loyalty_inbox_flight_reads f ON f.dedupe_key = m.dedupe_key
      WHERE ${CANDIDATE_SQL} AND (f.id IS NULL OR f.state = 'retry')
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
        // attempt left it, and the run counts it as neither read nor failed.
        if (raw === null) continue;
        const input = await textForReader(raw, LOYALTY_READ_MAX_CHARS, c.origin).catch(() => null);
        if (input === null || input.text === '') {
          code = 'empty_message';
        } else {
          const result = await readBounded(reader, input, boundMs);
          if (!result.ok) {
            code = result.code;
          } else {
            const outcome = await decideAndStore(c, cleanFlight(result.reading));
            counts.read++;
            if (outcome === 'recorded') counts.recorded++;
            else if (outcome === 'pending') counts.queued++;
            else if (outcome === 'stale') counts.stale++;
            else if (outcome === 'none') counts.none++;
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
 * One flight-read run over the stored airline-program mail. Resolves, never rejects: a failure is
 * `outcome: 'error'` with a code. The environment is read now, not at import.
 */
export async function readStoredFlights(env: Env = process.env): Promise<FlightRun> {
  if (!readerAvailable(env)) return { outcome: 'disabled', ...zeroCounts(), errorCode: null };

  let lock: PoolClient | null;
  try {
    lock = await takeLock();
  } catch {
    log.error('loyalty flight read failed', { code: 'store_failed' });
    return { outcome: 'error', ...zeroCounts(), errorCode: 'store_failed' };
  }
  if (lock === null) return { outcome: 'already_running', ...zeroCounts(), errorCode: null };

  const counts = zeroCounts();
  let errorCode: LoyaltyReadRunErrorCode | null = null;
  try {
    try {
      errorCode = await readAll(createFlightReader(env), env, counts);
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
  if (errorCode === null) log.info('loyalty flight read', { ...counts });
  else log.warn('loyalty flight read failed', { code: errorCode, ...counts });
  return { outcome: errorCode === null ? 'ok' : 'error', ...counts, errorCode };
}

// ─── Retention ─────────────────────────────────────────────────────────────────────────────────

/**
 * Deletes flight-read rows received STRICTLY before CURRENT_DATE minus the retention days, in every
 * state, held bookings included: exactly the retention age is kept, one day older is deleted.
 * Segments are never deleted here, whatever their age; a segment outlives the read that wrote it.
 */
export async function purgeExpiredFlightReads(q: Queryable = db): Promise<number> {
  const r = await q.query('DELETE FROM loyalty_inbox_flight_reads WHERE received_on < CURRENT_DATE - $1::int', [LOYALTY_READ_RETENTION_DAYS]);
  return r.rowCount ?? 0;
}

/**
 * The daily job's step, directly after the hotel booking step and before the digest (SPEC.md D4):
 * read, then purge (the purge runs even when reading is disabled, so retention never waits on a key).
 * Resolves, never rejects: a flight-read failure must never cost the digest after it. The scheduler
 * carries only the import and the call, so this is where the step's place in the job is explained:
 * after the booking step because the two reads are independent and the booking step was there first,
 * and before the digest so a morning digest could one day count what was read overnight.
 */
export async function runLoyaltyFlightsDaily(): Promise<void> {
  try {
    const run = await readStoredFlights();
    const purged = await purgeExpiredFlightReads();
    log.info('loyalty flight daily step', { outcome: run.outcome, code: run.errorCode, read: run.read, recorded: run.recorded, queued: run.queued, purged });
  } catch {
    log.error('loyalty flight daily step failed', { code: 'store_failed' });
  }
}

// ─── The one-tap actions ───────────────────────────────────────────────────────────────────────

const refuse = (code: LoyaltyErrorCode, message?: string): LoyaltyFailure => {
  log.warn('loyalty flight action refused', { code });
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
 * One action on one held flight booking (SPEC.md D10), in one transaction with the item's row locked,
 * so two simultaneous taps resolve it once: the second sees a row that is no longer `pending` and is
 * 409 `ITEM_RESOLVED`, and exactly one set of segments is written. Error messages are fixed
 * sentences and never echo input.
 *
 *   place    — the membership must be one of the item's program. The held booking is planned against
 *              the code's legs BY HAND (a person chose it, so it may re-book a cancelled leg; the date
 *              rules still hold) with the item's mail as evidence; new legs go on the membership the
 *              code is already on, else the chosen one. The item becomes `placed_by_hand` with the
 *              chosen membership.
 *   not_mine — the item, and every other held FLIGHT booking of its program and suffix, becomes
 *              `not_mine`; the pair is recorded on the not-mine list (idempotently) when there is a
 *              suffix. Held hotel bookings are another table and are not touched.
 *   ignore   — the item becomes `ignored`. Nothing else.
 *
 * Every resolution clears the held booking object: it exists only while a person has not decided.
 */
export async function resolveFlight(id: number, body: LoyaltyBookingResolveRequest): Promise<LoyaltyResult<LoyaltyBookingResolve>> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<ItemRow>(
      `SELECT id, dedupe_key AS key, program_id AS "programId", state, suffix, received_on::text AS "receivedOn", booking
         FROM loyalty_inbox_flight_reads WHERE id = $1 FOR UPDATE`,
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
      const b = item.booking;
      const existing = await legsOfCode(client, item.programId, b.code);
      const plan = planFlight({ existing, incoming: b, receivedOn: item.receivedOn, byHand: true });
      if (planChanges(plan)) {
        const onto = existing.length > 0 ? existing[0].membershipId : body.membershipId;
        await applyPlan(client, item.programId, onto, b, plan, { receivedOn: item.receivedOn, key: item.key });
      }
      await client.query(
        `UPDATE loyalty_inbox_flight_reads SET state = 'placed_by_hand', booking = NULL, membership_id = $2, resolved_on = CURRENT_DATE
          WHERE id = $1`,
        [id, body.membershipId]
      );
      state = 'placed_by_hand';
    } else if (body.action === 'not_mine') {
      await client.query(`UPDATE loyalty_inbox_flight_reads SET state = 'not_mine', booking = NULL, resolved_on = CURRENT_DATE WHERE id = $1`, [id]);
      if (item.suffix !== null) {
        await client.query(
          `INSERT INTO loyalty_inbox_not_mine (program_id, suffix) VALUES ($1, $2) ON CONFLICT (program_id, suffix) DO NOTHING`,
          [item.programId, item.suffix]
        );
        await client.query(
          `UPDATE loyalty_inbox_flight_reads SET state = 'not_mine', booking = NULL, resolved_on = CURRENT_DATE
            WHERE state = 'pending' AND program_id = $1 AND suffix = $2`,
          [item.programId, item.suffix]
        );
      }
      state = 'not_mine';
    } else {
      await client.query(`UPDATE loyalty_inbox_flight_reads SET state = 'ignored', booking = NULL, resolved_on = CURRENT_DATE WHERE id = $1`, [id]);
      state = 'ignored';
    }
    await client.query('COMMIT');
    log.info('loyalty flight item resolved', { state });
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
