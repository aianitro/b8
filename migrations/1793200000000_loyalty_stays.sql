-- Up Migration
-- Hotel stays from the loyalty inbox (ROADMAP.md §5 Phase 8 step 42e, first half;
-- plan/tasks/P8-42e1-loyalty-stays/SPEC.md, "Table design"). Creates two tables and one index. No
-- existing table or column is altered: the one addition to loyalty_memberships is a UNIQUE index on
-- (id, program_id), which exists only so loyalty_stays can carry a composite foreign key.
--
-- ─── WHAT THIS ADDS ──────────────────────────────────────────────────────────────────────────
--
--   loyalty_stays               — one row per hotel booking, keyed by (program, confirmation code):
--                                 its dates, its state (booked or cancelled), where it came from
--                                 (typed or email) and the mail that last decided it.
--   loyalty_inbox_booking_reads — one row per stored hotel-program message the SECOND read (the
--                                 booking read) ever attempted. A mirror of loyalty_inbox_reads with
--                                 the same crash-safe attempt row, no balance, and the cleaned
--                                 booking held only while it waits for a person.
--
-- The balance read and its tables are untouched. A message can have both a loyalty_inbox_reads row
-- and a loyalty_inbox_booking_reads row: a confirmation that prints a balance line is read twice by
-- design (SPEC.md D2, D3), and neither read consults the other's row.
--
-- NIGHTS ARE DERIVED ONCE, IN THE DATABASE. loyalty_stays.nights is a STORED GENERATED column,
-- check_out - check_in. It is a function of the row's own two dates, so it cannot go stale the way a
-- stored "current" value can; it is stored only so the 1..60 bound is a CHECK, and nobody (typed
-- route, mail pass or migration) can write it. "Nights this year" is NOT stored anywhere: it is a
-- sum computed on every read from CURRENT_DATE (SPEC.md D11).
--
-- A STAY IS NEVER DELETED. A cancellation sets state = 'cancelled' and keeps the row, its dates and
-- its code, so a re-forwarded old confirmation can be recognised as older and refused. No foreign
-- key in this file cascades: a program or membership with stays cannot be deleted.
--
-- NOTHING FREE-TEXT FROM THE MODEL IS STORED BUT THE PROPERTY NAME, and that one is bounded here:
-- trimmed, 1 to 80 characters, no '<', '>' or control character. There is no column for a guest
-- name, an address, a phone number, card digits, a price, a total, a subject or the model's output.
-- The confirmation code is stored in full (it is the dedupe key) and is masked in every payload.
--
-- DATES ARE Postgres DATE. No CHECK compares a column with CURRENT_DATE (it is not immutable, and a
-- CHECK a restore can fail on is a trap); "completed", "upcoming" and "this year" are read-time rules.
--
-- ─── BEFORE ANY migrate:down ON A REAL DATABASE ──────────────────────────────────────────────
--
-- The down is NOT lossless: every stay (typed stays cannot be rebuilt from anything; email stays only
-- from the thirty days of mail still kept) and every booking-read row, the held queue included, are
-- discarded. Back up first (SPEC.md Rollback, BUILD.md §9.3), to a path outside the repository,
-- printing nothing:
--
--   \copy loyalty_stays TO '<a path outside the repo>/loyalty_stays.csv' CSV HEADER
--   \copy loyalty_inbox_booking_reads TO '<a path outside the repo>/loyalty_inbox_booking_reads.csv' CSV HEADER
--
-- Revert the application code before running the down, so nothing queries a missing table.

-- ─── The composite-key target on loyalty_memberships ─────────────────────────────────────────
--
-- id alone is already unique, so this index admits exactly the rows that exist today and can never
-- refuse an insert. Its only purpose is to be the referenced key of loyalty_stays'
-- (membership_id, program_id) foreign key, which makes "a stay filed under a membership of another
-- program" unstorable rather than merely unlikely.
CREATE UNIQUE INDEX loyalty_memberships_id_program_key ON loyalty_memberships (id, program_id);

-- ─── loyalty_stays: one row per hotel booking ────────────────────────────────────────────────
--
-- SUPERSESSION (SPEC.md D8) is the application's rule, but the columns it needs live here:
--   source               — 'typed' (the typed route last wrote it) or 'email' (a mail last decided
--                          it). An email stay always has evidence.
--   evidence_received_on — the received date of the mail that last decided the stay; NULL = never
--                          touched by mail. A typed write KEEPS it, so an older re-forwarded mail
--                          cannot undo a typed correction and only a strictly later mail supersedes.
--   evidence_key         — that mail's 42c1 dedupe_key. Deliberately NOT a foreign key: the mail
--                          row is purged after thirty days and the stay must outlive it.
--   membership_id        — the first attribution is sticky: a later mail never moves it.
CREATE TABLE loyalty_stays (
  id                    SERIAL PRIMARY KEY,
  -- No ON DELETE on either key: a stay is history and nothing cascades it away. membership_id has
  -- no single-column foreign key of its own; the composite key below covers it and also pins the
  -- membership's program to program_id.
  membership_id         INTEGER NOT NULL,
  program_id            INTEGER NOT NULL REFERENCES loyalty_programs(id),
  -- The code as normalised by the application: letters and digits only, upper-cased, 4 to 20
  -- characters. So two spellings differing only by case, spaces or dashes are one row, by the
  -- UNIQUE below. Never emitted in full by any route.
  confirmation_code     TEXT NOT NULL
                          CONSTRAINT loyalty_stays_confirmation_code_shape
                            CHECK (confirmation_code ~ '^[A-Z0-9]{4,20}$'),
  check_in              DATE NOT NULL,
  check_out             DATE NOT NULL,
  -- Whole nights, derived from the two dates and never written by anyone. Bounded by the CHECK
  -- below to 1 through LOYALTY_STAY_MAX_NIGHTS, so a check-out not strictly after the check-in, or
  -- a stay longer than the maximum, cannot be stored.
  nights                INTEGER GENERATED ALWAYS AS (check_out - check_in) STORED,
  -- NULL = the mail or the person stated no property ("Property not stated"), never ''.
  property              TEXT
                          CONSTRAINT loyalty_stays_property_shape
                            CHECK (property IS NULL
                                   OR (property = btrim(property)
                                       AND char_length(property) BETWEEN 1 AND 80
                                       AND property !~ '[<>[:cntrl:]]')),
  -- A cancelled stay is kept, counted in no figure and listed nowhere.
  state                 TEXT NOT NULL
                          CONSTRAINT loyalty_stays_state_check CHECK (state IN ('booked', 'cancelled')),
  source                TEXT NOT NULL
                          CONSTRAINT loyalty_stays_source_check CHECK (source IN ('typed', 'email')),
  evidence_key          TEXT
                          CONSTRAINT loyalty_stays_evidence_key_shape
                            CHECK (evidence_key IS NULL OR evidence_key ~ '^[0-9a-f]{64}$'),
  evidence_received_on  DATE,
  -- true = paid with points or a certificate, false = the mail stated cash, NULL = not stated (never
  -- read as false). Stored for 42e2; shown nowhere in 42e1.
  award                 BOOLEAN,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The dedupe rule (SPEC.md D6): one row per program and normalised code. The same code in another
  -- program is another row.
  CONSTRAINT loyalty_stays_program_code_key UNIQUE (program_id, confirmation_code),
  CONSTRAINT loyalty_stays_nights_range CHECK (nights BETWEEN 1 AND 60),
  -- The evidence is one fact: a date and a key together, or neither.
  CONSTRAINT loyalty_stays_evidence_pair
    CHECK ((evidence_key IS NULL) = (evidence_received_on IS NULL)),
  -- A stay a mail decided names that mail.
  CONSTRAINT loyalty_stays_email_has_evidence
    CHECK (source <> 'email' OR evidence_key IS NOT NULL),
  CONSTRAINT loyalty_stays_membership_program_fkey
    FOREIGN KEY (membership_id, program_id) REFERENCES loyalty_memberships (id, program_id)
);

-- Serves the per-membership nights sum and the upcoming and completed lists.
CREATE INDEX loyalty_stays_membership_check_out ON loyalty_stays (membership_id, check_out);

-- ─── loyalty_inbox_booking_reads: one row per booking-read message ───────────────────────────
--
-- THE STATES, and what each row must and must not hold (the CHECKs make a contradiction
-- unstorable, so a pipeline bug fails loudly with 23514):
--
--   Not yet read. kind, program_check, read_on, resolved_on, reason, suffix, booking, membership_id
--   and stay_id are NULL; last_error_code is set:
--     retry          — an attempt failed with a retryable code; 1 or 2 attempts so far.
--     failed         — terminal: refused or empty_message at once, or the third attempt failed.
--
--   Read. kind, program_check and read_on are set and last_error_code is NULL:
--     none           — the model said this is not a booking mail (kind 'none').
--     flight         — a flight mail (kind 'flight'), recorded with nothing extracted, so 42e1b can
--                      reset exactly these rows and read them.
--     no_booking     — a hotel kind with no valid code or unusable dates; nothing stored.
--     stale          — a usable booking older than what the stay already reflects; nothing changed.
--     recorded       — the booking was placed by the rules and a stay written or updated (stay_id).
--     not_mine_known — an unmatched suffix already on loyalty_inbox_not_mine; discarded.
--     pending        — HELD for one tap, with a reason; booking holds the cleaned booking.
--   Resolved by a person from pending (reason is KEPT, booking is cleared):
--     placed_by_hand — the place action; stay_id is the stay written or updated, when one was.
--     not_mine       — the not-mine action.
--     ignored        — the ignore action.
--
-- THE ATTEMPT IS COUNTED BEFORE THE MODEL IS CALLED, exactly as in loyalty_inbox_reads: the row is
-- written pessimistically as the outcome it would be if the process died now (retry, or failed on
-- the third attempt, provisional code api_error), then overwritten with the real outcome.
--
-- RETENTION: rows are purged by received_on strictly older than LOYALTY_READ_RETENTION_DAYS, pending
-- included. Stays are never purged by it; stay_id has no ON DELETE action, and the purge deletes the
-- referencing row, never the stay.
CREATE TABLE loyalty_inbox_booking_reads (
  id               SERIAL PRIMARY KEY,
  -- The 42c1 dedupe key of the stored message. NOT a foreign key: the message is purged after thirty
  -- days and this row outlives it. UNIQUE: a message is booking-read once, and a run that loses a
  -- race gets 23505 rather than a second reading. Independent of loyalty_inbox_reads.dedupe_key.
  dedupe_key       TEXT NOT NULL
                     CONSTRAINT loyalty_inbox_booking_reads_dedupe_key_key UNIQUE
                     CONSTRAINT loyalty_inbox_booking_reads_dedupe_key_shape CHECK (dedupe_key ~ '^[0-9a-f]{64}$'),
  -- The message's program (from its allowlisted sender domain), copied so the row stands alone.
  program_id       INTEGER NOT NULL REFERENCES loyalty_programs(id),
  -- The message's received_on, copied. Retention, the queue order and supersession use it.
  received_on      DATE NOT NULL,
  state            TEXT NOT NULL
                     CONSTRAINT loyalty_inbox_booking_reads_state_check
                       CHECK (state IN ('retry', 'failed', 'none', 'flight', 'no_booking', 'stale',
                                        'recorded', 'pending', 'placed_by_hand', 'not_mine_known',
                                        'not_mine', 'ignored')),
  -- Attempts so far, counted before each model call. At most LOYALTY_READ_MAX_ATTEMPTS.
  attempts         SMALLINT NOT NULL
                     CONSTRAINT loyalty_inbox_booking_reads_attempts_range CHECK (attempts BETWEEN 0 AND 3),
  -- The classified code of the latest failed attempt; the same six codes as loyalty_inbox_reads.
  -- Never library text.
  last_error_code  TEXT
                     CONSTRAINT loyalty_inbox_booking_reads_last_error_code_check
                       CHECK (last_error_code IS NULL
                              OR last_error_code IN ('rate_limited', 'timeout', 'api_error', 'refused',
                                                     'bad_output', 'empty_message')),
  -- The kind the model reported, after the clean pass. NULL exactly while unread.
  kind             TEXT
                     CONSTRAINT loyalty_inbox_booking_reads_kind_check
                       CHECK (kind IS NULL OR kind IN ('hotel_booked', 'hotel_cancelled', 'flight', 'none')),
  -- The model's program name reduced to match, mismatch or not_stated, then discarded. Set exactly
  -- when read.
  program_check    TEXT
                     CONSTRAINT loyalty_inbox_booking_reads_program_check_check
                       CHECK (program_check IS NULL OR program_check IN ('match', 'mismatch', 'not_stated')),
  -- Why a booking was held. Set exactly for pending and the three states a person resolves it into.
  reason           TEXT
                     CONSTRAINT loyalty_inbox_booking_reads_reason_check
                       CHECK (reason IS NULL
                              OR reason IN ('no_suffix', 'unmatched_suffix', 'ambiguous_suffix',
                                            'forwarder_conflict', 'program_mismatch')),
  -- The printed member-number suffix as kept by the 42c2 clean pass: at most the last 4 letters or
  -- digits, upper-cased. The only member-number fragment this table holds.
  suffix           TEXT
                     CONSTRAINT loyalty_inbox_booking_reads_suffix_shape CHECK (suffix IS NULL OR suffix ~ '^[A-Z0-9]{3,4}$'),
  -- The cleaned booking, held ONLY while the row is pending (so the one tap can apply it) and
  -- cleared on resolution. Exactly the keys kind (one of the two hotel kinds), property (NULL or the
  -- bounded property text), checkIn and checkOut (YYYY-MM-DD text), code (the normalised code) and
  -- award (NULL or a boolean). No other key can be stored, so no guest name, price or model text.
  booking          JSONB
                     -- CASE, not AND: Postgres does not promise to evaluate AND left to right, and the
                     -- path tests must never run on a non-object.
                     CONSTRAINT loyalty_inbox_booking_reads_booking_shape CHECK (
                       booking IS NULL
                       OR CASE WHEN jsonb_typeof(booking) = 'object' THEN
                           booking ?& ARRAY['kind', 'property', 'checkIn', 'checkOut', 'code', 'award']
                           AND NOT jsonb_path_exists(booking,
                             '$.keyvalue() ? (!(@.key == "kind" || @.key == "property" || @.key == "checkIn" || @.key == "checkOut" || @.key == "code" || @.key == "award"))')
                           AND jsonb_path_exists(booking,
                             '$ ? (@.kind.type() == "string" && (@.kind == "hotel_booked" || @.kind == "hotel_cancelled"))')
                           -- The property obeys loyalty_stays_property_shape, so placing it can never fail.
                           AND CASE jsonb_typeof(booking -> 'property')
                                 WHEN 'null' THEN true
                                 WHEN 'string' THEN (booking ->> 'property') = btrim(booking ->> 'property')
                                                    AND char_length(booking ->> 'property') BETWEEN 1 AND 80
                                                    AND (booking ->> 'property') !~ '[<>[:cntrl:]]'
                                 ELSE false END
                           AND jsonb_path_exists(booking,
                             '$ ? (@.checkIn.type() == "string" && @.checkIn like_regex "^[0-9]{4}-[0-9]{2}-[0-9]{2}$")')
                           AND jsonb_path_exists(booking,
                             '$ ? (@.checkOut.type() == "string" && @.checkOut like_regex "^[0-9]{4}-[0-9]{2}-[0-9]{2}$")')
                           AND jsonb_path_exists(booking,
                             '$ ? (@.code.type() == "string" && @.code like_regex "^[A-Z0-9]{4,20}$")')
                           AND jsonb_path_exists(booking,
                             '$ ? (@.award.type() == "null" || @.award.type() == "boolean")')
                         ELSE false END),
  -- The membership the booking was placed on (by the rules, or by the person's tap). NULL = not
  -- placed. NOT an inheriting column. No ON DELETE action.
  membership_id    INTEGER REFERENCES loyalty_memberships(id),
  -- The stay this read wrote or updated. Set only for recorded (always) and placed_by_hand (when
  -- the tap wrote or updated a stay). No ON DELETE action; stays are never deleted.
  stay_id          INTEGER REFERENCES loyalty_stays(id),
  -- CURRENT_DATE of the attempt that read the message. NULL exactly while unread.
  read_on          DATE,
  -- CURRENT_DATE of the resolution. NULL exactly while retry, failed or pending.
  resolved_on      DATE,

  -- ── Unread rows: attempts, a code, and nothing extracted ──
  CONSTRAINT loyalty_inbox_booking_reads_retry_attempts
    CHECK (state <> 'retry' OR attempts BETWEEN 1 AND 2),
  CONSTRAINT loyalty_inbox_booking_reads_failed_attempts
    CHECK (state <> 'failed' OR attempts >= 1),
  CONSTRAINT loyalty_inbox_booking_reads_code_iff_unread
    CHECK ((last_error_code IS NOT NULL) = (state IN ('retry', 'failed'))),
  CONSTRAINT loyalty_inbox_booking_reads_kind_iff_read
    CHECK ((kind IS NULL) = (state IN ('retry', 'failed'))),
  CONSTRAINT loyalty_inbox_booking_reads_unread_holds_nothing
    CHECK (state NOT IN ('retry', 'failed')
           OR (suffix IS NULL AND program_check IS NULL AND read_on IS NULL
               AND membership_id IS NULL AND stay_id IS NULL)),

  -- ── Read rows: checked against the program and dated ──
  CONSTRAINT loyalty_inbox_booking_reads_read_is_checked_and_dated
    CHECK (state IN ('retry', 'failed') OR (program_check IS NOT NULL AND read_on IS NOT NULL)),
  CONSTRAINT loyalty_inbox_booking_reads_resolved_iff_settled
    CHECK ((resolved_on IS NULL) = (state IN ('retry', 'failed', 'pending'))),
  CONSTRAINT loyalty_inbox_booking_reads_resolved_not_before_read
    CHECK (resolved_on IS NULL OR read_on IS NULL OR resolved_on >= read_on),

  -- ── The kind decides the non-booking states, and nothing is extracted from them ──
  CONSTRAINT loyalty_inbox_booking_reads_flight_state
    CHECK ((state = 'flight') = (kind IS NOT DISTINCT FROM 'flight')),
  CONSTRAINT loyalty_inbox_booking_reads_none_state
    CHECK ((state = 'none') = (kind IS NOT DISTINCT FROM 'none')),
  CONSTRAINT loyalty_inbox_booking_reads_non_booking_holds_nothing
    CHECK (state NOT IN ('none', 'flight')
           OR (suffix IS NULL AND membership_id IS NULL AND stay_id IS NULL)),

  -- ── Held items: a reason exactly for pending and what a person resolved it into ──
  CONSTRAINT loyalty_inbox_booking_reads_reason_iff_held
    CHECK ((reason IS NOT NULL) = (state IN ('pending', 'placed_by_hand', 'not_mine', 'ignored'))),
  -- The booking object exists exactly while a person has not yet decided.
  CONSTRAINT loyalty_inbox_booking_reads_booking_iff_pending
    CHECK ((booking IS NOT NULL) = (state = 'pending')),
  -- A held booking was placed on nothing yet.
  CONSTRAINT loyalty_inbox_booking_reads_pending_unplaced
    CHECK (state <> 'pending' OR (membership_id IS NULL AND stay_id IS NULL)),

  -- ── A stay exactly where one can have been written ──
  CONSTRAINT loyalty_inbox_booking_reads_recorded_has_stay
    CHECK (state <> 'recorded' OR (stay_id IS NOT NULL AND membership_id IS NOT NULL)),
  CONSTRAINT loyalty_inbox_booking_reads_stay_only_when_placed
    CHECK (stay_id IS NULL OR state IN ('recorded', 'placed_by_hand')),

  -- ── The decision order, as far as one row can show it (SPEC.md D9) ──
  -- not_mine_known is an unmatched suffix on the not-mine list.
  CONSTRAINT loyalty_inbox_booking_reads_not_mine_known_unmatched
    CHECK (state <> 'not_mine_known' OR (suffix IS NOT NULL AND membership_id IS NULL)),
  -- program_mismatch means the model named another program.
  CONSTRAINT loyalty_inbox_booking_reads_mismatch_reason_is_mismatch
    CHECK (reason IS DISTINCT FROM 'program_mismatch' OR program_check IS NOT DISTINCT FROM 'mismatch'),
  -- no_suffix means no suffix was kept; the other suffix reasons were decided on one.
  CONSTRAINT loyalty_inbox_booking_reads_reason_suffix
    CHECK ((reason IS DISTINCT FROM 'no_suffix' OR suffix IS NULL)
           AND (reason IS NULL OR reason IN ('no_suffix', 'program_mismatch') OR suffix IS NOT NULL))
);

-- Serves the retention purge.
CREATE INDEX loyalty_inbox_booking_reads_received ON loyalty_inbox_booking_reads (received_on);
-- Serves per-program lookups (the not-mine follow-through and candidate selection).
CREATE INDEX loyalty_inbox_booking_reads_program ON loyalty_inbox_booking_reads (program_id, received_on);
-- Serves the held queue, newest received first.
CREATE INDEX loyalty_inbox_booking_reads_pending ON loyalty_inbox_booking_reads (received_on DESC, id DESC) WHERE state = 'pending';

-- Down Migration
-- Drops the booking-read table, then the stays table, then the composite-key index, and nothing
-- else: no program, membership, observation, instrument, inbox message, balance-read row or ledger
-- row is touched; indexes and constraints go with their tables. NOT LOSSLESS: take the \copy backups
-- in the header first, and revert the application code before running this. The order follows the
-- foreign keys: booking reads reference stays, and stays reference the index.

DROP TABLE loyalty_inbox_booking_reads;
DROP TABLE loyalty_stays;
DROP INDEX loyalty_memberships_id_program_key;
