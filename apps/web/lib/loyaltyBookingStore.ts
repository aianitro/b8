// Hotel stays (P8-42e1) — the typed write and the bookings payload. Every statement the `Hotel stays`
// section of /travel and the typed stays route make against `loyalty_stays` and the held bookings of
// `loyalty_inbox_booking_reads`, except the booking read itself (`loyaltyBookingRead.ts`).
//
// ─── NOTHING HERE READS THE LEDGER ────────────────────────────────────────────────────────────
//
// A stay is a date range at a hotel, not money. No statement in this file names a ledger table, and
// nothing here feeds any figure outside the stays section.
//
// ─── THE CONFIRMATION CODE NEVER LEAVES IN FULL ───────────────────────────────────────────────
//
// The code is stored in full (it is the dedupe key) and every value this file returns carries it
// through `maskMemberNumber`, the one masking function member numbers use: four bullets, then the
// last four characters of a code of eight or more, the last three of six or seven, nothing of five
// or fewer. No log line here carries a code, a date, a property or a name; only fixed codes.
//
// ─── "TODAY" AND "THIS YEAR" ARE POSTGRES'S ───────────────────────────────────────────────────
//
// The counted-nights rule (SPEC.md D11) is answered entirely in SQL from CURRENT_DATE, and every
// statement of the payload runs in ONE read-only REPEATABLE READ transaction, so the year, the nights,
// both lists and the held queue are one snapshot taken on one day. Dates leave the database as
// `::text`, never as a JS Date that a server time zone could move.

import type { PoolClient } from 'pg';
import db from './db';
import { createLogger } from './logger';
import type { LoyaltyResult, Queryable } from './loyaltyStore';
import { maskMemberNumber } from './domain/loyalty';
import { normaliseConfirmationCode } from './domain/loyaltyBooking';
import {
  LOYALTY_MASK_BULLETS,
  LOYALTY_READ_QUEUE_LIMIT,
  type LoyaltyBookingHoldReason,
  type LoyaltyBookingQueueItem,
  type LoyaltyBookings,
  type LoyaltyStay,
  type LoyaltyStayCreateRequest,
} from '@b8/contracts/loyalty';

const log = createLogger('loyalty-stays');

/** A stay as selected: every column the payload needs, the code still in full until `stayFrom`. */
interface StayRow {
  id: number;
  membershipId: number;
  programId: number;
  property: string | null;
  code: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  state: 'booked' | 'cancelled';
  source: 'typed' | 'email';
  award: boolean | null;
}

const STAY_SELECT = `SELECT s.id, s.membership_id AS "membershipId", s.program_id AS "programId", s.property,
         s.confirmation_code AS code, s.check_in::text AS "checkIn", s.check_out::text AS "checkOut", s.nights,
         s.state, s.source, s.award
    FROM loyalty_stays s`;

/** A stay as every payload shows it: the code masked, and nothing of the mail evidence behind it. */
function stayFrom(row: StayRow): LoyaltyStay {
  return {
    id: row.id,
    membershipId: row.membershipId,
    programId: row.programId,
    property: row.property,
    maskedCode: maskMemberNumber(row.code) ?? LOYALTY_MASK_BULLETS,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    nights: row.nights,
    state: row.state,
    source: row.source,
    award: row.award,
  };
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    log.warn('loyalty stays rollback failed', { code: 'store_failed' });
  }
}

/** The sentence a typed write answers when its code belongs to another membership. It echoes nothing. */
const CODE_ELSEWHERE = 'That confirmation code is already recorded under another membership of this program.';

/**
 * `POST /api/v1/loyalty/stays` (SPEC.md D12): adds a stay by hand, or corrects the one this
 * membership already holds under the same normalised code. One transaction, the membership locked
 * first (the booking read locks a program's memberships the same way, so a typed write and a run take
 * turns).
 *
 *   - The membership must exist (404) and be of a `hotel` program (400).
 *   - A code already recorded under ANOTHER membership of the program is 400 with a fixed sentence:
 *     the typed path never moves a stay, exactly as a mail never does.
 *   - A correction replaces dates, property, award and state and sets source `typed`, and KEEPS the
 *     mail evidence (`evidence_received_on`, `evidence_key`), so an older re-forwarded mail cannot
 *     undo it and only a strictly later mail supersedes it (D8). Nothing deletes: `cancelled` is a
 *     state, and a typed write may set `booked` again: re-booking a cancelled stay is a person's
 *     act, never a mail's (SPEC.md A5).
 *
 * Nights are the database's; the request has no key for them.
 */
export async function saveTypedStay(body: LoyaltyStayCreateRequest): Promise<LoyaltyResult<{ created: boolean; stay: LoyaltyStay }>> {
  const code = normaliseConfirmationCode(body.confirmationCode);
  // The schema already refused an invalid code; this keeps the write from ever trusting that alone.
  if (code === null) return { ok: false, code: 'INVALID_INPUT' };
  const property = body.property === null ? null : body.property.trim();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const membership = (await client.query<{ programId: number; kind: string }>(
      `SELECT ms.program_id AS "programId", p.kind FROM loyalty_memberships ms JOIN loyalty_programs p ON p.id = ms.program_id
        WHERE ms.id = $1 FOR UPDATE OF ms`,
      [body.membershipId]
    )).rows[0];
    if (!membership) {
      await rollback(client);
      return { ok: false, code: 'NOT_FOUND' };
    }
    if (membership.kind !== 'hotel') {
      await rollback(client);
      return { ok: false, code: 'INVALID_INPUT', message: 'A stay can only be recorded on a hotel membership.' };
    }
    const existing = (await client.query<{ id: number; membershipId: number }>(
      `SELECT id, membership_id AS "membershipId" FROM loyalty_stays WHERE program_id = $1 AND confirmation_code = $2 FOR UPDATE`,
      [membership.programId, code]
    )).rows[0];
    if (existing && existing.membershipId !== body.membershipId) {
      await rollback(client);
      return { ok: false, code: 'INVALID_INPUT', message: CODE_ELSEWHERE };
    }
    let id: number;
    if (existing) {
      await client.query(
        `UPDATE loyalty_stays SET check_in = $2::date, check_out = $3::date, property = $4, award = $5, state = $6, source = 'typed',
                updated_at = NOW()
          WHERE id = $1`,
        [existing.id, body.checkIn, body.checkOut, property, body.award, body.state]
      );
      id = existing.id;
    } else {
      id = (await client.query<{ id: number }>(
        `INSERT INTO loyalty_stays (membership_id, program_id, confirmation_code, check_in, check_out, property, state, source, award)
         VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, 'typed', $8) RETURNING id`,
        [body.membershipId, membership.programId, code, body.checkIn, body.checkOut, property, body.state, body.award]
      )).rows[0].id;
    }
    const row = (await client.query<StayRow>(`${STAY_SELECT} WHERE s.id = $1`, [id])).rows[0];
    await client.query('COMMIT');
    log.info('loyalty stay saved', { created: !existing });
    return { ok: true, value: { created: !existing, stay: stayFrom(row) } };
  } catch (err) {
    await rollback(client);
    // Two first writes of one code under two memberships at once: the UNIQUE (program, code) decides,
    // and the loser gets the same refusal as if it had come second.
    if ((err as { code?: unknown }).code === '23505') return { ok: false, code: 'INVALID_INPUT', message: CODE_ELSEWHERE };
    throw err;
  } finally {
    client.release();
  }
}

/** The normalisation the suffix rule applies to a stored number, in SQL: letters and digits, upper-cased. */
const NUMBER_KEY_SQL = (column: string) => `upper(regexp_replace(${column}, '[^A-Za-z0-9]', '', 'g'))`;

/** A counted stay (SPEC.md D11): booked, checked out on or before today, and checked out this year. */
const COUNTED_SQL = `s.state = 'booked' AND s.check_out <= CURRENT_DATE
                 AND EXTRACT(YEAR FROM s.check_out) = EXTRACT(YEAR FROM CURRENT_DATE)`;

interface QueueRow {
  id: number;
  programId: number;
  receivedOn: string;
  reason: LoyaltyBookingHoldReason;
  maskedSuffix: string | null;
  property: string | null;
  checkIn: string;
  checkOut: string;
  code: string;
  state: 'booked' | 'cancelled';
  candidateMembershipIds: number[];
}

/**
 * The bookings payload for the `Hotel stays` section (SPEC.md D10, D11). Called with the pool, the
 * five statements run on ONE checked-out connection inside ONE `READ ONLY` transaction at
 * `REPEATABLE READ`, so the year, the counts, the lists and the queue come from one snapshot and one
 * CURRENT_DATE. Any other handle is a caller's client whose transaction is the caller's, and the
 * statements simply run on it.
 */
export async function loadBookings(q: Queryable = db): Promise<LoyaltyBookings> {
  if (q !== db) return bookingsOn(q);
  const client = await db.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const bookings = await bookingsOn(client);
    await client.query('COMMIT');
    return bookings;
  } catch (err) {
    await rollback(client);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The five statements, one after another on one handle.
 *
 *   nights    — one entry per membership of a hotel-kind program (`EXISTS`, not a JOIN, so nothing
 *               can repeat a membership), ascending. The sum over no counted stay is SQL's NULL, which
 *               is exactly the payload's "nothing counted" and is never turned into 0. A counted stay
 *               adds ALL its nights to the year of its check-out.
 *   upcoming  — booked stays whose check-out is after today, by check-in then id.
 *   completed — the counted stays, by check-out descending then id.
 *   queue     — held bookings, newest received first then id descending, at most the queue limit;
 *               the suffix leaves the database already masked and the candidates are ids only.
 */
async function bookingsOn(q: Queryable): Promise<LoyaltyBookings> {
  const year = await q.query<{ year: number }>('SELECT EXTRACT(YEAR FROM CURRENT_DATE)::int AS year');
  const nights = await q.query<{ membershipId: number; nightsThisYear: number | null }>(
    `SELECT ms.id AS "membershipId",
            (SELECT sum(s.nights) FROM loyalty_stays s WHERE s.membership_id = ms.id AND ${COUNTED_SQL})::int AS "nightsThisYear"
       FROM loyalty_memberships ms
      WHERE EXISTS (SELECT 1 FROM loyalty_programs p WHERE p.id = ms.program_id AND p.kind = 'hotel')
      ORDER BY ms.id`
  );
  const upcoming = await q.query<StayRow>(`${STAY_SELECT} WHERE s.state = 'booked' AND s.check_out > CURRENT_DATE ORDER BY s.check_in, s.id`);
  const completed = await q.query<StayRow>(`${STAY_SELECT} WHERE ${COUNTED_SQL} ORDER BY s.check_out DESC, s.id`);
  const queue = await q.query<QueueRow>(
    `SELECT r.id, r.program_id AS "programId", r.received_on::text AS "receivedOn", r.reason,
            CASE WHEN r.suffix IS NULL THEN NULL ELSE $2 || r.suffix END AS "maskedSuffix",
            r.booking ->> 'property' AS property, r.booking ->> 'checkIn' AS "checkIn", r.booking ->> 'checkOut' AS "checkOut",
            r.booking ->> 'code' AS code,
            CASE WHEN r.booking ->> 'kind' = 'hotel_cancelled' THEN 'cancelled' ELSE 'booked' END AS state,
            CASE WHEN r.suffix IS NULL THEN '{}'::int[] ELSE ARRAY(
              SELECT ms.id FROM loyalty_memberships ms
               WHERE ms.program_id = r.program_id AND ms.member_number IS NOT NULL
                 AND right(${NUMBER_KEY_SQL('ms.member_number')}, length(r.suffix)) = r.suffix
               ORDER BY ms.id) END AS "candidateMembershipIds"
       FROM loyalty_inbox_booking_reads r
      WHERE r.state = 'pending'
      ORDER BY r.received_on DESC, r.id DESC
      LIMIT $1`,
    [LOYALTY_READ_QUEUE_LIMIT, LOYALTY_MASK_BULLETS]
  );
  return {
    year: year.rows[0].year,
    nights: nights.rows,
    upcoming: upcoming.rows.map(stayFrom),
    completed: completed.rows.map(stayFrom),
    queue: queue.rows.map(({ code, ...item }): LoyaltyBookingQueueItem => ({ ...item, maskedCode: maskMemberNumber(code) ?? LOYALTY_MASK_BULLETS })),
  };
}
