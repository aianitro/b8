-- Up Migration
-- Flights from the loyalty inbox (ROADMAP.md §5 Phase 8 step 42e, second half;
-- plan/tasks/P8-42e1b-loyalty-flights/SPEC.md, "Table design"). Creates two tables and their
-- indexes. NOTHING EXISTING IS ALTERED: no column, constraint or index of any existing table is
-- added, changed or dropped. The composite foreign key below reuses the UNIQUE index
-- loyalty_memberships_id_program_key, which the 42e1 migration (…_loyalty_stays.sql) created and
-- which belongs to it; this file neither creates nor drops it.
--
-- ─── WHAT THIS ADDS ──────────────────────────────────────────────────────────────────────────
--
--   loyalty_segments           — one row per flight LEG, identified by (program, confirmation code,
--                                flight date, carrier, flight number): its airports, its state
--                                (booked or cancelled), where it came from (typed or email) and the
--                                mail that last decided it.
--   loyalty_inbox_flight_reads — one row per stored airline-program message the THIRD read (the
--                                flight read) ever attempted. A sibling of loyalty_inbox_booking_reads
--                                with the same crash-safe attempt row, its own ledger so a message is
--                                flight-read once, and the cleaned booking held only while it waits
--                                for a person.
--
-- WHY A SEPARATE HELD-BOOKING TABLE, NOT loyalty_inbox_booking_reads. Sharing that table would mean
-- widening four of its CHECKs (kind, the flight state, the recorded-has-stay rule and the hotel-only
-- booking object) on a table with live rows, and a down could not restore the narrower rules once a
-- flight-shaped row existed (SPEC.md "Deviations from the ITEM" 2). Its rows in state 'flight' belong
-- to hotel programs and are not touched by anything here (SPEC.md D1).
--
-- WHY THE LEG, NOT THE BOOKING, IS THE ROW. Origin, destination and award are attributes a later mail
-- may update; date, carrier and number are the identity. Keying on the leg lets a change mail move one
-- flight without leaving a ghost of the old one booked (SPEC.md D7).
--
-- A SEGMENT IS NEVER DELETED. A cancellation sets state = 'cancelled' and keeps the row, so a
-- re-forwarded old confirmation can be recognised and refused. No foreign key in this file cascades:
-- a program or membership with segments cannot be deleted. The retention purge reaches flight-read
-- rows only, never segments.
--
-- NOTHING DERIVED IS STORED. There is no count of flights, no mileage, no status credit and no
-- per-airline total in any column: none is computed anywhere (SPEC.md D11). "Upcoming" and "recent"
-- are read-time rules against CURRENT_DATE; no CHECK compares a column with CURRENT_DATE (it is not
-- immutable, and a CHECK a restore can fail on is a trap).
--
-- NOTHING FREE-TEXT FROM THE MODEL IS STORED. Every text column holds an enum, a fixed-shape code or
-- a 3 or 4 character suffix. There is no column for a passenger name, a ticket number, a seat, a
-- cabin or fare class, a time of day, a frequent-flyer number beyond the suffix, a price, card digits
-- or the model's output. The confirmation code is stored in full (it is part of the identity) and is
-- masked in every payload.
--
-- ─── BEFORE ANY migrate:down ON A REAL DATABASE ──────────────────────────────────────────────
--
-- The down is NOT lossless: every segment (typed segments cannot be rebuilt from anything; email
-- segments only from the thirty days of mail still kept) and every flight-read row, the held queue
-- included, are discarded. Back up first (SPEC.md Rollback, BUILD.md §9.3), to a path outside the
-- repository, printing nothing:
--
--   \copy loyalty_segments TO '<a path outside the repo>/loyalty_segments.csv' CSV HEADER
--   \copy loyalty_inbox_flight_reads TO '<a path outside the repo>/loyalty_inbox_flight_reads.csv' CSV HEADER
--
-- Revert the application code before running the down, so nothing queries a missing table.

-- ─── loyalty_segments: one row per flight leg ────────────────────────────────────────────────
--
-- SUPERSESSION (SPEC.md D8) is the application's rule, applied to all legs of one code as a group,
-- but the columns it needs live here:
--   source               — 'typed' (the typed route last wrote it) or 'email' (a mail last decided
--                          it). An email segment always has evidence. A typed leg is never cancelled
--                          because a mail omitted it.
--   evidence_received_on — the received date of the mail that last decided the segment; NULL = never
--                          touched by mail. A typed write KEEPS it (and evidence_key), so an older
--                          re-forwarded mail cannot undo a typed correction.
--   evidence_key         — that mail's 42c1 dedupe_key. Deliberately NOT a foreign key: the mail
--                          row is purged after thirty days and the segment must outlive it.
--   membership_id        — the first attribution is sticky: all legs of one code sit on one
--                          membership and a later mail never moves them. NOT an inheriting column.
CREATE TABLE loyalty_segments (
  id                    SERIAL PRIMARY KEY,
  -- No ON DELETE on either key: a segment is history and nothing cascades it away. membership_id has
  -- no single-column foreign key of its own; the composite key below covers it and also pins the
  -- membership's program to program_id, so a leg under a membership of another program is
  -- unstorable.
  membership_id         INTEGER NOT NULL,
  program_id            INTEGER NOT NULL REFERENCES loyalty_programs(id),
  -- The code as normalised by the application: ASCII letters and digits only, upper-cased, 4 to 20
  -- characters, the same normal form as loyalty_stays.confirmation_code. Never emitted in full.
  confirmation_code     TEXT NOT NULL
                          CONSTRAINT loyalty_segments_confirmation_code_shape
                            CHECK (confirmation_code ~ '^[A-Z0-9]{4,20}$'),
  -- The departure date only. No time of day or time zone is stored, so a flight dated today is
  -- upcoming for the whole of the database's today.
  flight_date           DATE NOT NULL,
  -- IATA-style airport codes: exactly three upper-case letters A to Z, stored upper-case.
  origin                TEXT NOT NULL
                          CONSTRAINT loyalty_segments_origin_shape CHECK (origin ~ '^[A-Z]{3}$'),
  destination           TEXT NOT NULL
                          CONSTRAINT loyalty_segments_destination_shape CHECK (destination ~ '^[A-Z]{3}$'),
  -- Two characters, upper-case letters or digits (carrier designators can contain a digit).
  carrier               TEXT NOT NULL
                          CONSTRAINT loyalty_segments_carrier_shape CHECK (carrier ~ '^[A-Z0-9]{2}$'),
  -- One to four digits, optionally one upper-case letter suffix. TEXT, not a number: leading zeros
  -- are part of the identity and are kept.
  flight_number         TEXT NOT NULL
                          CONSTRAINT loyalty_segments_flight_number_shape
                            CHECK (flight_number ~ '^[0-9]{1,4}[A-Z]?$'),
  -- A cancelled segment is kept and listed nowhere.
  state                 TEXT NOT NULL
                          CONSTRAINT loyalty_segments_state_check CHECK (state IN ('booked', 'cancelled')),
  source                TEXT NOT NULL
                          CONSTRAINT loyalty_segments_source_check CHECK (source IN ('typed', 'email')),
  evidence_key          TEXT
                          CONSTRAINT loyalty_segments_evidence_key_shape
                            CHECK (evidence_key IS NULL OR evidence_key ~ '^[0-9a-f]{64}$'),
  evidence_received_on  DATE,
  -- true = paid with miles or an award, false = the mail stated cash, NULL = not stated (never read
  -- as false). Stored for 42e2; shown nowhere in this step.
  award                 BOOLEAN,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The identity of a leg (SPEC.md D7). The same code in another program is another booking; the
  -- same code, date, carrier and number is one row however many mails mention it.
  CONSTRAINT loyalty_segments_identity_key
    UNIQUE (program_id, confirmation_code, flight_date, carrier, flight_number),
  CONSTRAINT loyalty_segments_airports_differ CHECK (origin <> destination),
  -- The evidence is one fact: a date and a key together, or neither.
  CONSTRAINT loyalty_segments_evidence_pair
    CHECK ((evidence_key IS NULL) = (evidence_received_on IS NULL)),
  -- A segment a mail decided names that mail.
  CONSTRAINT loyalty_segments_email_has_evidence
    CHECK (source <> 'email' OR evidence_key IS NOT NULL),
  CONSTRAINT loyalty_segments_membership_program_fkey
    FOREIGN KEY (membership_id, program_id) REFERENCES loyalty_memberships (id, program_id)
);

-- Serves the per-membership upcoming and recent lists.
CREATE INDEX loyalty_segments_membership_flight_date ON loyalty_segments (membership_id, flight_date);

-- ─── loyalty_inbox_flight_reads: one row per flight-read message ─────────────────────────────
--
-- THE STATES, and what each row must and must not hold (the CHECKs make a contradiction
-- unstorable, so a pipeline bug fails loudly with 23514):
--
--   Not yet read. kind, program_check, read_on, resolved_on, reason, suffix, booking and
--   membership_id are NULL; last_error_code is set:
--     retry          — an attempt failed with a retryable code; 1 or 2 attempts so far.
--     failed         — terminal: refused or empty_message at once, or the third attempt failed.
--
--   Read. kind, program_check and read_on are set and last_error_code is NULL:
--     none           — the model said this is not a flight booking or cancellation (kind 'none').
--     no_booking     — a flight kind with no valid code, no legs, void legs or implausible dates,
--                      or a cancellation with no legs for a code with no rows; nothing stored.
--     stale          — the mail does not supersede what the code's legs already reflect (decided
--                      BEFORE attribution, so it is never held); nothing changed.
--     recorded       — placed by the rules and at least one segment inserted, rewritten or
--                      cancelled; membership_id is where the code's legs are.
--     not_mine_known — an unmatched suffix already on loyalty_inbox_not_mine; discarded.
--     pending        — HELD for one tap, with a reason; booking holds the cleaned booking.
--   Resolved by a person from pending (reason is KEPT, booking is cleared):
--     placed_by_hand — the place action; membership_id is the chosen membership.
--     not_mine       — the not-mine action.
--     ignored        — the ignore action.
--
-- There is deliberately no 'flight' state: that value belongs to loyalty_inbox_booking_reads.
--
-- THE ATTEMPT IS COUNTED BEFORE THE MODEL IS CALLED, exactly as in loyalty_inbox_reads and
-- loyalty_inbox_booking_reads: the row is written pessimistically as the outcome it would be if the
-- process died now (retry, or failed on the third attempt, provisional code api_error), then
-- overwritten with the real outcome.
--
-- RETENTION: rows are purged by received_on strictly older than LOYALTY_READ_RETENTION_DAYS, pending
-- included. Segments are never purged by it: no segment references this table and this table
-- references no segment.
CREATE TABLE loyalty_inbox_flight_reads (
  id               SERIAL PRIMARY KEY,
  -- The 42c1 dedupe key of the stored message. NOT a foreign key: the message is purged after thirty
  -- days and this row outlives it. UNIQUE: a message is flight-read once, and a run that loses a race
  -- gets 23505 rather than a second reading. Independent of the balance and booking reads' keys.
  dedupe_key       TEXT NOT NULL
                     CONSTRAINT loyalty_inbox_flight_reads_dedupe_key_key UNIQUE
                     CONSTRAINT loyalty_inbox_flight_reads_dedupe_key_shape CHECK (dedupe_key ~ '^[0-9a-f]{64}$'),
  -- The message's program (from its allowlisted sender domain), copied so the row stands alone.
  program_id       INTEGER NOT NULL REFERENCES loyalty_programs(id),
  -- The message's received_on, copied. Retention, the queue order and supersession use it.
  received_on      DATE NOT NULL,
  state            TEXT NOT NULL
                     CONSTRAINT loyalty_inbox_flight_reads_state_check
                       CHECK (state IN ('retry', 'failed', 'none', 'no_booking', 'stale', 'recorded',
                                        'pending', 'placed_by_hand', 'not_mine_known', 'not_mine',
                                        'ignored')),
  -- Attempts so far, counted before each model call. At most LOYALTY_READ_MAX_ATTEMPTS.
  attempts         SMALLINT NOT NULL
                     CONSTRAINT loyalty_inbox_flight_reads_attempts_range CHECK (attempts BETWEEN 0 AND 3),
  -- The classified code of the latest failed attempt; the same six codes as loyalty_inbox_reads.
  -- Never library text.
  last_error_code  TEXT
                     CONSTRAINT loyalty_inbox_flight_reads_last_error_code_check
                       CHECK (last_error_code IS NULL
                              OR last_error_code IN ('rate_limited', 'timeout', 'api_error', 'refused',
                                                     'bad_output', 'empty_message')),
  -- The kind the model reported, after the clean pass. NULL exactly while unread.
  kind             TEXT
                     CONSTRAINT loyalty_inbox_flight_reads_kind_check
                       CHECK (kind IS NULL OR kind IN ('flight_booked', 'flight_cancelled', 'none')),
  -- The model's program name reduced to match, mismatch or not_stated, then discarded. Set exactly
  -- when read.
  program_check    TEXT
                     CONSTRAINT loyalty_inbox_flight_reads_program_check_check
                       CHECK (program_check IS NULL OR program_check IN ('match', 'mismatch', 'not_stated')),
  -- Why a booking was held. Set exactly for pending and the three states a person resolves it into.
  -- The same five reasons as loyalty_inbox_booking_reads: one attribution rule for both reads.
  reason           TEXT
                     CONSTRAINT loyalty_inbox_flight_reads_reason_check
                       CHECK (reason IS NULL
                              OR reason IN ('no_suffix', 'unmatched_suffix', 'ambiguous_suffix',
                                            'forwarder_conflict', 'program_mismatch')),
  -- The printed frequent-flyer-number suffix as kept by the 42c2 clean pass: at most the last 4
  -- letters or digits, upper-cased. The only member-number fragment this table holds.
  suffix           TEXT
                     CONSTRAINT loyalty_inbox_flight_reads_suffix_shape CHECK (suffix IS NULL OR suffix ~ '^[A-Z0-9]{3,4}$'),
  -- The cleaned booking, held ONLY while the row is pending (so the one tap can apply it) and
  -- cleared on resolution. Exactly the keys:
  --   kind     — 'flight_booked' or 'flight_cancelled', and equal to the row's kind (a separate CHECK);
  --   code     — the normalised confirmation code;
  --   award    — NULL or a boolean;
  --   complete — a boolean: whether the mail called its itinerary complete (false unless it said so);
  --   legs     — an array of at most 12 legs (LOYALTY_SEGMENTS_MAX_PER_MAIL), at least one for a
  --              booking (a cancellation with none cancels the whole code); each leg exactly
  --              {flightDate, origin, destination, carrier, flightNumber} in the shapes of
  --              loyalty_segments, with origin different from destination, so placing it can never
  --              fail on a segment CHECK.
  -- No other key can be stored at any depth, so no passenger name, ticket, seat, price or model text.
  booking          JSONB
                     -- CASE, not AND: Postgres does not promise to evaluate AND left to right, and the
                     -- path tests and jsonb_array_length must never run on a value of the wrong type.
                     -- The keyvalue() tests filter to objects first, because keyvalue() on a scalar is
                     -- an error even in lax mode.
                     CONSTRAINT loyalty_inbox_flight_reads_booking_shape CHECK (
                       booking IS NULL
                       OR CASE WHEN jsonb_typeof(booking) = 'object' THEN
                           booking ?& ARRAY['kind', 'code', 'award', 'complete', 'legs']
                           AND NOT jsonb_path_exists(booking,
                             '$.keyvalue() ? (!(@.key == "kind" || @.key == "code" || @.key == "award" || @.key == "complete" || @.key == "legs"))')
                           AND jsonb_path_exists(booking,
                             '$ ? (@.kind.type() == "string" && (@.kind == "flight_booked" || @.kind == "flight_cancelled"))')
                           AND jsonb_path_exists(booking,
                             '$ ? (@.code.type() == "string" && @.code like_regex "^[A-Z0-9]{4,20}$")')
                           AND jsonb_path_exists(booking,
                             '$ ? (@.award.type() == "null" || @.award.type() == "boolean")')
                           AND jsonb_path_exists(booking,
                             '$ ? (@.complete.type() == "boolean")')
                           AND CASE WHEN jsonb_typeof(booking -> 'legs') = 'array' THEN
                               jsonb_array_length(booking -> 'legs') <= 12
                               AND (jsonb_array_length(booking -> 'legs') >= 1
                                    OR (booking ->> 'kind') IS DISTINCT FROM 'flight_booked')
                               AND NOT jsonb_path_exists(booking,
                                 'strict $.legs[*] ? (@.type() != "object")')
                               AND NOT jsonb_path_exists(booking,
                                 '$.legs[*] ? (@.type() == "object").keyvalue() ? (!(@.key == "flightDate" || @.key == "origin" || @.key == "destination" || @.key == "carrier" || @.key == "flightNumber"))')
                               AND NOT jsonb_path_exists(booking,
                                 '$.legs[*] ? (!(@.flightDate.type() == "string" && @.flightDate like_regex "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" && @.origin.type() == "string" && @.origin like_regex "^[A-Z]{3}$" && @.destination.type() == "string" && @.destination like_regex "^[A-Z]{3}$" && @.carrier.type() == "string" && @.carrier like_regex "^[A-Z0-9]{2}$" && @.flightNumber.type() == "string" && @.flightNumber like_regex "^[0-9]{1,4}[A-Z]?$" && @.origin != @.destination))')
                             ELSE false END
                         ELSE false END),
  -- The membership the booking was placed on: by the rules (recorded; the membership the code's legs
  -- are on) or by the person's tap (placed_by_hand). NULL = not placed. NOT an inheriting column.
  -- No ON DELETE action.
  membership_id    INTEGER REFERENCES loyalty_memberships(id),
  -- CURRENT_DATE of the attempt that read the message. NULL exactly while unread.
  read_on          DATE,
  -- CURRENT_DATE of the resolution. NULL exactly while retry, failed or pending.
  resolved_on      DATE,

  -- ── Unread rows: attempts, a code, and nothing extracted ──
  CONSTRAINT loyalty_inbox_flight_reads_retry_attempts
    CHECK (state <> 'retry' OR attempts BETWEEN 1 AND 2),
  CONSTRAINT loyalty_inbox_flight_reads_failed_attempts
    CHECK (state <> 'failed' OR attempts >= 1),
  CONSTRAINT loyalty_inbox_flight_reads_code_iff_unread
    CHECK ((last_error_code IS NOT NULL) = (state IN ('retry', 'failed'))),
  CONSTRAINT loyalty_inbox_flight_reads_kind_iff_read
    CHECK ((kind IS NULL) = (state IN ('retry', 'failed'))),
  CONSTRAINT loyalty_inbox_flight_reads_unread_holds_nothing
    CHECK (state NOT IN ('retry', 'failed')
           OR (suffix IS NULL AND program_check IS NULL AND read_on IS NULL AND membership_id IS NULL)),

  -- ── Read rows: checked against the program and dated ──
  CONSTRAINT loyalty_inbox_flight_reads_read_is_checked_and_dated
    CHECK (state IN ('retry', 'failed') OR (program_check IS NOT NULL AND read_on IS NOT NULL)),
  CONSTRAINT loyalty_inbox_flight_reads_resolved_iff_settled
    CHECK ((resolved_on IS NULL) = (state IN ('retry', 'failed', 'pending'))),
  CONSTRAINT loyalty_inbox_flight_reads_resolved_not_before_read
    CHECK (resolved_on IS NULL OR read_on IS NULL OR resolved_on >= read_on),

  -- ── Kind 'none' decides state 'none', and nothing is extracted from it ──
  CONSTRAINT loyalty_inbox_flight_reads_none_state
    CHECK ((state = 'none') = (kind IS NOT DISTINCT FROM 'none')),
  CONSTRAINT loyalty_inbox_flight_reads_none_holds_nothing
    CHECK (state <> 'none' OR (suffix IS NULL AND membership_id IS NULL)),

  -- ── Held items: a reason exactly for pending and what a person resolved it into ──
  CONSTRAINT loyalty_inbox_flight_reads_reason_iff_held
    CHECK ((reason IS NOT NULL) = (state IN ('pending', 'placed_by_hand', 'not_mine', 'ignored'))),
  -- The booking object exists exactly while a person has not yet decided.
  CONSTRAINT loyalty_inbox_flight_reads_booking_iff_pending
    CHECK ((booking IS NOT NULL) = (state = 'pending')),
  -- The held booking is the row's own reading: its kind is the row's kind.
  CONSTRAINT loyalty_inbox_flight_reads_booking_kind_is_row_kind
    CHECK (booking IS NULL
           OR CASE WHEN jsonb_typeof(booking) = 'object'
                   THEN (booking ->> 'kind') IS NOT DISTINCT FROM kind
                   ELSE false END),

  -- ── A membership exactly where one was chosen: by the rules (recorded) or by a tap ──
  -- This also says a pending row, a none row and a not_mine_known row have no membership, and a
  -- stale or no_booking row records none (stale is decided before attribution).
  CONSTRAINT loyalty_inbox_flight_reads_membership_iff_placed
    CHECK ((membership_id IS NOT NULL) = (state IN ('recorded', 'placed_by_hand'))),

  -- ── The decision order, as far as one row can show it (SPEC.md D9) ──
  -- not_mine_known is an unmatched suffix on the not-mine list.
  CONSTRAINT loyalty_inbox_flight_reads_not_mine_known_unmatched
    CHECK (state <> 'not_mine_known' OR suffix IS NOT NULL),
  -- program_mismatch means the model named another program.
  CONSTRAINT loyalty_inbox_flight_reads_mismatch_reason_is_mismatch
    CHECK (reason IS DISTINCT FROM 'program_mismatch' OR program_check IS NOT DISTINCT FROM 'mismatch'),
  -- no_suffix means no suffix was kept; the other suffix reasons were decided on one.
  CONSTRAINT loyalty_inbox_flight_reads_reason_suffix
    CHECK ((reason IS DISTINCT FROM 'no_suffix' OR suffix IS NULL)
           AND (reason IS NULL OR reason IN ('no_suffix', 'program_mismatch') OR suffix IS NOT NULL))
);

-- Serves the retention purge.
CREATE INDEX loyalty_inbox_flight_reads_received ON loyalty_inbox_flight_reads (received_on);
-- Serves per-program lookups (the not-mine follow-through and candidate selection).
CREATE INDEX loyalty_inbox_flight_reads_program ON loyalty_inbox_flight_reads (program_id, received_on);
-- Serves the held queue, newest received first.
CREATE INDEX loyalty_inbox_flight_reads_pending ON loyalty_inbox_flight_reads (received_on DESC, id DESC) WHERE state = 'pending';

-- Down Migration
-- Drops the flight-read table, then the segments table, and nothing else: no program, membership,
-- stay, booking-read row, observation, instrument, inbox message or balance-read row is touched, and
-- loyalty_memberships_id_program_key stays (it belongs to the 42e1 migration and loyalty_stays still
-- needs it). Indexes and constraints go with their tables. NOT LOSSLESS: take the \copy backups in
-- the header first, and revert the application code before running this.

DROP TABLE loyalty_inbox_flight_reads;
DROP TABLE loyalty_segments;
