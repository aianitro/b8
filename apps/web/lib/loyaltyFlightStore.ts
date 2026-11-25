// Flights (P8-42e1b) — the typed write and the flights payload. Every statement the `Flights` section
// of /travel and the typed segments route make against `loyalty_segments` and the held bookings of
// `loyalty_inbox_flight_reads`, except the flight read itself (`loyaltyFlightRead.ts`).
//
// ─── NOTHING HERE READS THE LEDGER, AND NOTHING IS COUNTED ────────────────────────────────────
//
// A segment is a dated leg between two airports, not money. No statement in this file names a ledger
// table. The payload carries ids, dates, codes of fixed shape and masked codes; no figure is summed,
// counted or derived from a flight, because what a flight earns follows each airline program's own
// rules and this step does not pretend to know them (SPEC.md D11).
//
// ─── THE CONFIRMATION CODE NEVER LEAVES IN FULL ───────────────────────────────────────────────
//
// The code is stored in full (it is part of a leg's identity) and every value this file returns
// carries it through `maskMemberNumber`, the one masking function member numbers use. No log line
// here carries a code, a date, an airport, a flight number or a name; only fixed codes.
//
// ─── "TODAY" IS POSTGRES'S ────────────────────────────────────────────────────────────────────
//
// The upcoming and recent rules are answered entirely in SQL from CURRENT_DATE, and every statement
// of the payload runs in ONE read-only REPEATABLE READ transaction, so the lists and the held queue
// are one snapshot taken on one day. Dates leave the database as `::text`, never as a JS Date that a
// server time zone could move. A flight dated today is upcoming for all of today: only the date of
// departure is stored.

import type { PoolClient } from 'pg';
import db from './db';
import { createLogger } from './logger';
import type { LoyaltyResult, Queryable } from './loyaltyStore';
import { maskMemberNumber } from './domain/loyalty';
import { normaliseConfirmationCode } from './domain/loyaltyBooking';
import {
  LOYALTY_MASK_BULLETS,
  LOYALTY_READ_QUEUE_LIMIT,
  LOYALTY_SEGMENT_RECENT_DAYS,
  type LoyaltyBookingHoldReason,
  type LoyaltyFlightLeg,
  type LoyaltyFlightQueueItem,
  type LoyaltyFlights,
  type LoyaltySegment,
  type LoyaltySegmentCreateRequest,
} from '@b8/contracts/loyalty';

const log = createLogger('loyalty-segments');

/** A segment as selected: every column the payload needs, the code still in full until `segmentFrom`. */
interface SegmentRow {
  id: number;
  membershipId: number;
  programId: number;
  code: string;
  flightDate: string;
  origin: string;
  destination: string;
  carrier: string;
  flightNumber: string;
  state: 'booked' | 'cancelled';
  source: 'typed' | 'email';
  award: boolean | null;
}

const SEGMENT_SELECT = `SELECT s.id, s.membership_id AS "membershipId", s.program_id AS "programId", s.confirmation_code AS code,
         s.flight_date::text AS "flightDate", s.origin, s.destination, s.carrier, s.flight_number AS "flightNumber",
         s.state, s.source, s.award
    FROM loyalty_segments s`;

/** A segment as every payload shows it: the code masked, and nothing of the mail evidence behind it. */
function segmentFrom(row: SegmentRow): LoyaltySegment {
  return {
    id: row.id,
    membershipId: row.membershipId,
    programId: row.programId,
    maskedCode: maskMemberNumber(row.code) ?? LOYALTY_MASK_BULLETS,
    flightDate: row.flightDate,
    origin: row.origin,
    destination: row.destination,
    carrier: row.carrier,
    flightNumber: row.flightNumber,
    state: row.state,
    source: row.source,
    award: row.award,
  };
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    log.warn('loyalty segments rollback failed', { code: 'store_failed' });
  }
}

/** The sentence a typed write answers when its code belongs to another membership. It echoes nothing. */
const CODE_ELSEWHERE = 'That confirmation code is already recorded under another membership of this program.';

/**
 * `POST /api/v1/loyalty/segments` (SPEC.md D12): adds a leg by hand, or rewrites the one this
 * membership already holds with the same identity (normalised code, flight date, carrier and flight
 * number). One transaction; EVERY membership of the program is locked first, exactly as the flight
 * read locks them, so a typed write, a tap and a run take turns, and two typed writes of one code
 * under two memberships cannot both pass the check below.
 *
 *   - The membership must exist (404) and be of an `airline` program (400).
 *   - A code already recorded under ANOTHER membership of the program is 400 with a fixed sentence:
 *     all legs of one code sit on one membership, and the typed path never moves them.
 *   - A rewrite replaces the airports, award and state and sets source `typed`, and KEEPS the mail
 *     evidence (`evidence_received_on`, `evidence_key`), so an older re-forwarded mail cannot undo it
 *     and only a strictly later mail supersedes it (D8). Nothing deletes: `cancelled` is a state, and
 *     a typed write may set `booked` again: re-booking a cancelled leg is a person's act.
 *
 * The body was parsed by the contract, which already trimmed and upper-cased the airports, carrier
 * and flight number; only the code is normalised here, as everywhere a code is stored.
 */
export async function saveTypedSegment(body: LoyaltySegmentCreateRequest): Promise<LoyaltyResult<{ created: boolean; segment: LoyaltySegment }>> {
  const code = normaliseConfirmationCode(body.confirmationCode);
  // The schema already refused an invalid code; this keeps the write from ever trusting that alone.
  if (code === null) return { ok: false, code: 'INVALID_INPUT' };
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const membership = (await client.query<{ programId: number; kind: string }>(
      `SELECT ms.program_id AS "programId", p.kind FROM loyalty_memberships ms JOIN loyalty_programs p ON p.id = ms.program_id
        WHERE ms.id = $1`,
      [body.membershipId]
    )).rows[0];
    if (!membership) {
      await rollback(client);
      return { ok: false, code: 'NOT_FOUND' };
    }
    if (membership.kind !== 'airline') {
      await rollback(client);
      return { ok: false, code: 'INVALID_INPUT', message: 'A flight can only be recorded on an airline membership.' };
    }
    await client.query('SELECT id FROM loyalty_memberships WHERE program_id = $1 ORDER BY id FOR UPDATE', [membership.programId]);
    const elsewhere = await client.query(
      'SELECT 1 FROM loyalty_segments WHERE program_id = $1 AND confirmation_code = $2 AND membership_id <> $3 LIMIT 1',
      [membership.programId, code, body.membershipId]
    );
    if (elsewhere.rows.length > 0) {
      await rollback(client);
      return { ok: false, code: 'INVALID_INPUT', message: CODE_ELSEWHERE };
    }
    const existing = (await client.query<{ id: number }>(
      `SELECT id FROM loyalty_segments
        WHERE program_id = $1 AND confirmation_code = $2 AND flight_date = $3::date AND carrier = $4 AND flight_number = $5 FOR UPDATE`,
      [membership.programId, code, body.flightDate, body.carrier, body.flightNumber]
    )).rows[0];
    let id: number;
    if (existing) {
      await client.query(
        `UPDATE loyalty_segments SET origin = $2, destination = $3, award = $4, state = $5, source = 'typed', updated_at = NOW()
          WHERE id = $1`,
        [existing.id, body.origin, body.destination, body.award, body.state]
      );
      id = existing.id;
    } else {
      id = (await client.query<{ id: number }>(
        `INSERT INTO loyalty_segments (membership_id, program_id, confirmation_code, flight_date, origin, destination, carrier, flight_number, state, source, award)
         VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, 'typed', $10) RETURNING id`,
        [body.membershipId, membership.programId, code, body.flightDate, body.origin, body.destination, body.carrier, body.flightNumber, body.state, body.award]
      )).rows[0].id;
    }
    const row = (await client.query<SegmentRow>(`${SEGMENT_SELECT} WHERE s.id = $1`, [id])).rows[0];
    await client.query('COMMIT');
    log.info('loyalty segment saved', { created: !existing });
    return { ok: true, value: { created: !existing, segment: segmentFrom(row) } };
  } catch (err) {
    await rollback(client);
    throw err;
  } finally {
    client.release();
  }
}

/** The normalisation the suffix rule applies to a stored number, in SQL: letters and digits, upper-cased. */
const NUMBER_KEY_SQL = (column: string) => `upper(regexp_replace(${column}, '[^A-Za-z0-9]', '', 'g'))`;

interface QueueRow {
  id: number;
  programId: number;
  receivedOn: string;
  reason: LoyaltyBookingHoldReason;
  maskedSuffix: string | null;
  code: string;
  state: 'booked' | 'cancelled';
  legs: LoyaltyFlightLeg[];
  candidateMembershipIds: number[];
}

/**
 * The flights payload for the `Flights` section (SPEC.md D10, D11). Called with the pool, the four
 * statements run on ONE checked-out connection inside ONE `READ ONLY` transaction at `REPEATABLE
 * READ`, so the lists and the queue come from one snapshot and one CURRENT_DATE. Any other handle is
 * a caller's client whose transaction is the caller's, and the statements simply run on it.
 */
export async function loadFlights(q: Queryable = db): Promise<LoyaltyFlights> {
  if (q !== db) return flightsOn(q);
  const client = await db.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const flights = await flightsOn(client);
    await client.query('COMMIT');
    return flights;
  } catch (err) {
    await rollback(client);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The four statements, one after another on one handle.
 *
 *   airlineMembershipIds — every membership of an airline-kind program (`EXISTS`, not a JOIN, so
 *                          nothing can repeat a membership), ascending.
 *   upcoming             — booked legs dated today or later, by date then id.
 *   recent               — booked legs dated before today and no more than the recent window before
 *                          it, by date descending then id ascending.
 *   queue                — held flight bookings, newest received first then id descending, at most
 *                          the queue limit; the suffix leaves the database already masked, the
 *                          candidates are ids only, and the code is masked before it leaves here.
 *
 * A cancelled leg is in no list.
 */
async function flightsOn(q: Queryable): Promise<LoyaltyFlights> {
  const memberships = await q.query<{ id: number }>(
    `SELECT ms.id FROM loyalty_memberships ms
      WHERE EXISTS (SELECT 1 FROM loyalty_programs p WHERE p.id = ms.program_id AND p.kind = 'airline')
      ORDER BY ms.id`
  );
  const upcoming = await q.query<SegmentRow>(`${SEGMENT_SELECT} WHERE s.state = 'booked' AND s.flight_date >= CURRENT_DATE ORDER BY s.flight_date, s.id`);
  const recent = await q.query<SegmentRow>(
    `${SEGMENT_SELECT} WHERE s.state = 'booked' AND s.flight_date < CURRENT_DATE AND s.flight_date >= CURRENT_DATE - $1::int
      ORDER BY s.flight_date DESC, s.id`,
    [LOYALTY_SEGMENT_RECENT_DAYS]
  );
  const queue = await q.query<QueueRow>(
    `SELECT r.id, r.program_id AS "programId", r.received_on::text AS "receivedOn", r.reason,
            CASE WHEN r.suffix IS NULL THEN NULL ELSE $2 || r.suffix END AS "maskedSuffix",
            r.booking ->> 'code' AS code,
            CASE WHEN r.booking ->> 'kind' = 'flight_cancelled' THEN 'cancelled' ELSE 'booked' END AS state,
            r.booking -> 'legs' AS legs,
            CASE WHEN r.suffix IS NULL THEN '{}'::int[] ELSE ARRAY(
              SELECT ms.id FROM loyalty_memberships ms
               WHERE ms.program_id = r.program_id AND ms.member_number IS NOT NULL
                 AND right(${NUMBER_KEY_SQL('ms.member_number')}, length(r.suffix)) = r.suffix
               ORDER BY ms.id) END AS "candidateMembershipIds"
       FROM loyalty_inbox_flight_reads r
      WHERE r.state = 'pending'
      ORDER BY r.received_on DESC, r.id DESC
      LIMIT $1`,
    [LOYALTY_READ_QUEUE_LIMIT, LOYALTY_MASK_BULLETS]
  );
  return {
    airlineMembershipIds: memberships.rows.map((m) => m.id),
    upcoming: upcoming.rows.map(segmentFrom),
    recent: recent.rows.map(segmentFrom),
    queue: queue.rows.map(({ code, legs, ...item }): LoyaltyFlightQueueItem => ({
      ...item,
      maskedCode: maskMemberNumber(code) ?? LOYALTY_MASK_BULLETS,
      // Each leg rebuilt with exactly the five keys, in a fixed order; the table's CHECK already
      // allows no other key, so this only fixes the order the payload is written in.
      legs: legs.map((l) => ({ flightDate: l.flightDate, origin: l.origin, destination: l.destination, carrier: l.carrier, flightNumber: l.flightNumber })),
    })),
  };
}
