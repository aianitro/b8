-- Up Migration
-- Loyalty inbox, second half: what Claude read from each stored message, as a proposal
-- (ROADMAP.md §5 Phase 8 step 42c, second task; plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md and
-- CONTRACT.md). Creates three tables and seeds one row. No existing table is altered:
-- loyalty_observations already allows source 'email' (reserved for this step by 1792700000000),
-- and loyalty_instruments gains no source because the read pipeline never writes an instrument.
--
-- ─── WHAT THIS ADDS ──────────────────────────────────────────────────────────────────────────
--
--   loyalty_inbox_reads      — one row per stored message the read pipeline ever attempted: its
--                              attempt count and failure code while it is not yet read, then the
--                              CLEANED fields of the reading and what the deterministic rules
--                              decided (applied, queued for a human, stale, no balance, discarded).
--   loyalty_inbox_not_mine   — (program, suffix) pairs the household has said are not theirs.
--   loyalty_inbox_read_state — exactly one row: when the read last ran and how that went.
--
-- A READING IS A PROPOSAL, NOT A BALANCE. The current balance of a membership is still, and only,
-- the newest loyalty_observations row by the existing reduction. A reading becomes part of it in
-- exactly one way: an appended observation with source 'email', written in the same transaction
-- that sets the reads row to applied or applied_by_hand and records observation_id. Nothing in
-- these tables is a "current" value, and no query should treat reads.balance as one.
--
-- NOTHING FREE-TEXT FROM THE MODEL OR THE MAIL IS STORED. Every text column holds an enum, a
-- 3 or 4 character upper-case suffix, or nothing; balance is NUMERIC; dates are DATE; the two JSONB
-- columns are arrays of fixed-key objects whose values are enums, YYYY-MM-DD text and canonical
-- decimal text, all CHECKed below. There is no column for a subject, a body, a program name as the
-- model wrote it, a member name, an address, a full member number, a prompt or the model's output.
-- The program name the model stated is reduced to program_check (match, mismatch, not_stated) and
-- then thrown away. Acceptance command 6 refuses a column whose name says otherwise.
--
-- RETENTION IS FOUR HUNDRED DAYS BY received_on (contract constant LOYALTY_READ_RETENTION_DAYS),
-- deliberately longer than the raw mail's thirty: the purge deletes reads rows whose received_on is
-- strictly before CURRENT_DATE minus four hundred, in every state, pending items included. The raw
-- message in loyalty_inbox_messages goes on its own thirty-day schedule; the reads row outlives it,
-- which is why dedupe_key here is the 42c1 key and NOT a foreign key to the message row. The
-- not-mine list and the state row are never purged.
--
-- DATES ARE Postgres DATE, compared with CURRENT_DATE in SQL. No CHECK compares a column with
-- CURRENT_DATE (it is not immutable, and a CHECK a restore can fail on is a trap); "the as-of is not
-- in the future" is the pipeline's and the apply route's rule, not this file's.
--
-- ─── BEFORE ANY migrate:down ON A REAL DATABASE ──────────────────────────────────────────────
--
-- The down is NOT lossless: every reads row (the queue, the coverage history, the extracted expiry
-- warnings and instruments), every not-mine record and the read state are discarded. Back up first
-- (SPEC.md Rollback, BUILD.md §9.3), to a path outside the repository, printing nothing:
--
--   \copy loyalty_inbox_reads TO '<a path outside the repo>/loyalty_inbox_reads.csv' CSV HEADER
--   \copy loyalty_inbox_not_mine TO '<a path outside the repo>/loyalty_inbox_not_mine.csv' CSV HEADER
--   \copy (SELECT * FROM loyalty_observations WHERE source = 'email') TO '<a path outside the repo>/loyalty_observations_email.csv' CSV HEADER
--
-- The observations a read appended are NOT dropped by the down: loyalty_observations is append-only
-- and those rows are real balance history. Removing them is an owner decision made from the CSV.

-- ─── loyalty_inbox_reads: one row per attempted message ──────────────────────────────────────
--
-- THE STATES, and what each row must and must not hold (the CHECKs below make every contradiction
-- unstorable; a pipeline bug fails loudly with 23514 instead of writing a row that lies):
--
--   Not yet read. No reading exists, so every extracted column is NULL, both arrays are empty,
--   program_check, read_on, resolved_on and reason are NULL, and last_error_code is set:
--     retry           — an attempt failed with a retryable code; 1 or 2 attempts so far.
--     failed          — terminal: refused or empty_message at once, or the third attempt failed.
--                       Only retryFailed (which DELETES the row) makes it readable again.
--
--   Read. program_check and read_on are set and last_error_code is NULL:
--     pending         — QUEUED for a human; reason says why; resolved_on NULL.
--     applied         — every rule held; observation_id is the appended 'email' observation.
--     stale           — the as-of was not strictly newer than the current reading's; nothing
--                       appended, never queued.
--     no_balance      — the reading carried no usable balance; nothing appended, never queued.
--     not_mine_known  — the suffix matched no membership and is on the not-mine list; discarded.
--   Resolved by a person from pending (reason is KEPT, so "was this a queue item, and why" stays
--   answerable):
--     applied_by_hand — the apply action; observation_id is the appended 'email' observation.
--     not_mine        — the not-mine action.
--     ignored         — the ignore action.
--
-- THE ATTEMPT IS COUNTED BEFORE THE MODEL IS CALLED (SPEC.md "What a read run does", step 4), and
-- there is no in-flight state: the pipeline writes the attempt pessimistically, as the outcome it
-- would be if the process died now (retry with 1 or 2 attempts, or failed on the third, with the
-- provisional code api_error), then overwrites that with the real outcome. So a crash between the
-- count and the result leaves an honest, classified row, never a half-written one.
CREATE TABLE loyalty_inbox_reads (
  id               SERIAL PRIMARY KEY,
  -- The 42c1 dedupe key of the stored message (lower-case hex SHA-256, the same key space as
  -- loyalty_inbox_messages.dedupe_key). NOT a foreign key: the message row and its bytes are purged
  -- after thirty days and this row must outlive them. UNIQUE: a message is read once, and a second
  -- run that loses a race gets 23505 rather than a second reading.
  dedupe_key       TEXT NOT NULL
                     CONSTRAINT loyalty_inbox_reads_dedupe_key_key UNIQUE
                     CONSTRAINT loyalty_inbox_reads_dedupe_key_shape CHECK (dedupe_key ~ '^[0-9a-f]{64}$'),
  -- The program of the message's allowlisted sender domain (42c1), copied so the row stands alone
  -- after the message is purged. The model's program name never sets it. No ON DELETE action: a
  -- program is never deleted while evidence references it.
  program_id       INTEGER NOT NULL REFERENCES loyalty_programs(id),
  -- The message's received_on, copied for the same reason. Retention and the queue order use it.
  received_on      DATE NOT NULL,
  state            TEXT NOT NULL
                     CONSTRAINT loyalty_inbox_reads_state_check
                       CHECK (state IN ('retry', 'failed', 'pending', 'applied', 'applied_by_hand',
                                        'stale', 'no_balance', 'not_mine_known', 'not_mine', 'ignored')),
  -- Attempts made so far, counted before each model call. At most three (LOYALTY_READ_MAX_ATTEMPTS).
  attempts         SMALLINT NOT NULL
                     CONSTRAINT loyalty_inbox_reads_attempts_range CHECK (attempts BETWEEN 0 AND 3),
  -- The classified code of the latest failed attempt, set exactly while the row is retry or failed
  -- and cleared when a later attempt reads the message. Never library text. Equals the contract's
  -- LOYALTY_READ_ERROR_CODES.
  last_error_code  TEXT
                     CONSTRAINT loyalty_inbox_reads_last_error_code_check
                       CHECK (last_error_code IS NULL
                              OR last_error_code IN ('rate_limited', 'timeout', 'api_error', 'refused',
                                                     'bad_output', 'empty_message')),
  -- Why a reading was queued (the first rule of the decision order that fired). Set exactly for a
  -- pending row and for the three states a person resolves it into. Equals LOYALTY_READ_REASONS.
  reason           TEXT
                     CONSTRAINT loyalty_inbox_reads_reason_check
                       CHECK (reason IS NULL
                              OR reason IN ('no_suffix', 'unmatched_suffix', 'ambiguous_suffix',
                                            'program_mismatch', 'unit_mismatch', 'no_as_of',
                                            'as_of_future', 'no_baseline', 'implausible_jump')),
  -- The printed member-number suffix as kept by the clean pass: at most its last 4 letters or digits,
  -- upper-cased, mask characters dropped; NULL = the mail showed fewer than 3. The ONLY fragment of
  -- a member number stored anywhere by this step; matching against the full stored number happens
  -- in SQL at read time and the full number never enters this row or a payload.
  suffix           TEXT
                     CONSTRAINT loyalty_inbox_reads_suffix_shape CHECK (suffix IS NULL OR suffix ~ '^[A-Z0-9]{3,4}$'),
  -- The proposed balance, in the same single spelling as loyalty_observations.balance: unconstrained
  -- NUMERIC (never float), non-negative, fewer than 13 integer digits, SCALE 0 for points, miles and
  -- nights and SCALE EXACTLY 2 for usd (the per-unit scale CHECK below states the scale; a typmod
  -- would mis-scale the whole units). So balance::text is the canonical emitted form and an apply
  -- copies it into an observation unchanged. NULL = no usable balance (never stored as zero; zero
  -- is a real reading). A proposal, never the current balance.
  balance          NUMERIC
                     CONSTRAINT loyalty_inbox_reads_balance_range CHECK (balance >= 0 AND balance < 1e12),
  -- The unit belongs to the balance (P8-42a): NULL exactly when balance is NULL.
  unit             TEXT
                     CONSTRAINT loyalty_inbox_reads_unit_check
                       CHECK (unit IS NULL OR unit IN ('points', 'miles', 'nights', 'usd')),
  -- The date the mail says the balance is true for. NULL = the mail gave none (queued as no_as_of;
  -- a person applying it dates the observation by received_on, never this column by default).
  as_of            DATE,
  -- The model's stated program name compared with the sender's program and its aliases, then
  -- discarded: match, mismatch, or not_stated (no name given). Set exactly when the message was read.
  program_check    TEXT
                     CONSTRAINT loyalty_inbox_reads_program_check_check
                       CHECK (program_check IS NULL OR program_check IN ('match', 'mismatch', 'not_stated')),
  -- The membership the reading belongs to: the unique suffix match of the message's program, or,
  -- after a person applies an item with no unique match, the membership they chose. NULL = no
  -- single membership (unmatched, ambiguous, no suffix, or a program mismatch on a balance-less
  -- mail). NOT an inheriting column. No ON DELETE action: no route deletes a membership.
  membership_id    INTEGER REFERENCES loyalty_memberships(id),
  -- The 'email' observation this reading appended; set exactly for applied and applied_by_hand. No
  -- ON DELETE action, which also means an observation a reading appended cannot be deleted while
  -- the reads row stands (the history and its provenance stay together).
  observation_id   INTEGER REFERENCES loyalty_observations(id),
  -- Expiry warnings as extracted and cleaned: a JSON array of at most 5 objects with exactly the keys
  -- what (points, miles, nights, usd, status, other), expiresOn (YYYY-MM-DD text) and amount (NULL,
  -- or canonical decimal text in the scale of what: whole for points, miles and nights, exactly two
  -- decimals for usd; always NULL for status and other). Displayed only; no rule reads them (42g).
  expiry_warnings  JSONB NOT NULL DEFAULT '[]'::jsonb
                     CONSTRAINT loyalty_inbox_reads_expiry_warnings_shape CHECK (
                       CASE WHEN jsonb_typeof(expiry_warnings) = 'array' THEN
                         jsonb_array_length(expiry_warnings) <= 5
                         AND NOT jsonb_path_exists(expiry_warnings, 'strict $[*] ? (@.type() != "object")')
                         AND NOT jsonb_path_exists(expiry_warnings,
                           '$[*].keyvalue() ? (!(@.key == "what" || @.key == "expiresOn" || @.key == "amount"))')
                         AND NOT jsonb_path_exists(expiry_warnings,
                           '$[*] ? (!(@.what.type() == "string" && (@.what == "points" || @.what == "miles" || @.what == "nights" || @.what == "usd" || @.what == "status" || @.what == "other")))')
                         AND NOT jsonb_path_exists(expiry_warnings,
                           '$[*] ? (!(@.expiresOn.type() == "string" && @.expiresOn like_regex "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"))')
                         AND NOT jsonb_path_exists(expiry_warnings,
                           '$[*] ? (!(@.amount.type() == "null" || (@.amount.type() == "string" && ((@.what == "usd" && @.amount like_regex "^(0|[1-9][0-9]{0,11})[.][0-9]{2}$") || ((@.what == "points" || @.what == "miles" || @.what == "nights") && @.amount like_regex "^(0|[1-9][0-9]{0,11})$")))))')
                       ELSE false END),
  -- Instruments as extracted and cleaned: a JSON array of at most 10 objects with exactly the keys
  -- kind (free_night, companion_fare, travel_credit, other: the loyalty_instruments kinds) and
  -- expiresOn (YYYY-MM-DD text, or NULL = the mail stated no expiry). Displayed only: the read
  -- pipeline never creates a loyalty_instruments row from them.
  instruments      JSONB NOT NULL DEFAULT '[]'::jsonb
                     CONSTRAINT loyalty_inbox_reads_instruments_shape CHECK (
                       CASE WHEN jsonb_typeof(instruments) = 'array' THEN
                         jsonb_array_length(instruments) <= 10
                         AND NOT jsonb_path_exists(instruments, 'strict $[*] ? (@.type() != "object")')
                         AND NOT jsonb_path_exists(instruments,
                           '$[*].keyvalue() ? (!(@.key == "kind" || @.key == "expiresOn"))')
                         AND NOT jsonb_path_exists(instruments,
                           '$[*] ? (!(@.kind.type() == "string" && (@.kind == "free_night" || @.kind == "companion_fare" || @.kind == "travel_credit" || @.kind == "other")))')
                         AND NOT jsonb_path_exists(instruments,
                           '$[*] ? (!(@.expiresOn.type() == "null" || (@.expiresOn.type() == "string" && @.expiresOn like_regex "^[0-9]{4}-[0-9]{2}-[0-9]{2}$")))')
                       ELSE false END),
  -- CURRENT_DATE of the attempt that read the message. NULL exactly while it is unread.
  read_on          DATE,
  -- CURRENT_DATE of the resolution: the read itself for a state decided by the rules, the tap for
  -- a state a person chose. NULL exactly while the row is retry, failed or pending.
  resolved_on      DATE,

  -- ── The balance is one spelling, with its unit ──
  CONSTRAINT loyalty_inbox_reads_balance_with_unit
    CHECK ((balance IS NULL) = (unit IS NULL)),
  CONSTRAINT loyalty_inbox_reads_unit_scale
    CHECK (balance IS NULL
           OR (unit = 'usd' AND scale(balance) = 2)
           OR (unit <> 'usd' AND scale(balance) = 0)),

  -- ── Unread rows: attempts, a code, and nothing extracted ──
  CONSTRAINT loyalty_inbox_reads_retry_attempts
    CHECK (state <> 'retry' OR attempts BETWEEN 1 AND 2),
  CONSTRAINT loyalty_inbox_reads_failed_attempts
    CHECK (state <> 'failed' OR attempts >= 1),
  CONSTRAINT loyalty_inbox_reads_code_iff_unread
    CHECK ((last_error_code IS NOT NULL) = (state IN ('retry', 'failed'))),
  CONSTRAINT loyalty_inbox_reads_unread_holds_nothing
    CHECK (state NOT IN ('retry', 'failed')
           OR (suffix IS NULL AND balance IS NULL AND as_of IS NULL AND program_check IS NULL
               AND read_on IS NULL AND membership_id IS NULL AND observation_id IS NULL
               AND expiry_warnings = '[]'::jsonb AND instruments = '[]'::jsonb)),

  -- ── Read rows: checked against the program and dated ──
  CONSTRAINT loyalty_inbox_reads_read_is_checked_and_dated
    CHECK (state IN ('retry', 'failed') OR (program_check IS NOT NULL AND read_on IS NOT NULL)),
  CONSTRAINT loyalty_inbox_reads_resolved_iff_settled
    CHECK ((resolved_on IS NULL) = (state IN ('retry', 'failed', 'pending'))),
  CONSTRAINT loyalty_inbox_reads_resolved_not_before_read
    CHECK (resolved_on IS NULL OR read_on IS NULL OR resolved_on >= read_on),

  -- ── Queue items: a reason exactly for pending and what a person resolved it into ──
  CONSTRAINT loyalty_inbox_reads_reason_iff_queued
    CHECK ((reason IS NOT NULL) = (state IN ('pending', 'applied_by_hand', 'not_mine', 'ignored'))),

  -- ── A balance exactly when the reading had one (decision rule 1 comes first) ──
  CONSTRAINT loyalty_inbox_reads_balance_iff_reading_had_one
    CHECK ((balance IS NULL) = (state IN ('retry', 'failed', 'no_balance'))),

  -- ── An appended observation exactly for the two applied states ──
  CONSTRAINT loyalty_inbox_reads_applied_complete
    CHECK (state NOT IN ('applied', 'applied_by_hand')
           OR (membership_id IS NOT NULL AND observation_id IS NOT NULL)),
  CONSTRAINT loyalty_inbox_reads_observation_only_when_applied
    CHECK (observation_id IS NULL OR state IN ('applied', 'applied_by_hand')),

  -- ── The decision order, as far as one row can show it ──
  -- applied and stale passed the suffix rule (3) and the as-of rule (5).
  CONSTRAINT loyalty_inbox_reads_rules_passed
    CHECK (state NOT IN ('applied', 'stale') OR (suffix IS NOT NULL AND as_of IS NOT NULL)),
  -- not_mine_known is an unmatched suffix on the not-mine list.
  CONSTRAINT loyalty_inbox_reads_not_mine_known_unmatched
    CHECK (state <> 'not_mine_known' OR (suffix IS NOT NULL AND membership_id IS NULL)),
  -- A program mismatch with a balance always queues (rule 2), and that reason means a mismatch.
  CONSTRAINT loyalty_inbox_reads_mismatch_queues
    CHECK (program_check IS DISTINCT FROM 'mismatch'
           OR state = 'no_balance'
           OR reason IS NOT DISTINCT FROM 'program_mismatch'),
  CONSTRAINT loyalty_inbox_reads_mismatch_reason_is_mismatch
    CHECK (reason IS DISTINCT FROM 'program_mismatch' OR program_check IS NOT DISTINCT FROM 'mismatch'),
  -- A balance-less mail naming another program decorates no membership (rule 1).
  CONSTRAINT loyalty_inbox_reads_mismatch_no_balance_unmatched
    CHECK (NOT (state = 'no_balance' AND program_check IS NOT DISTINCT FROM 'mismatch' AND membership_id IS NOT NULL)),
  -- no_suffix means no suffix was kept; every reason after rule 3 had one.
  CONSTRAINT loyalty_inbox_reads_reason_suffix
    CHECK ((reason IS DISTINCT FROM 'no_suffix' OR suffix IS NULL)
           AND (reason IS NULL OR reason IN ('no_suffix', 'program_mismatch') OR suffix IS NOT NULL)),
  -- no_as_of means no date; every reason after rule 5's first half had one.
  CONSTRAINT loyalty_inbox_reads_reason_as_of
    CHECK ((reason IS DISTINCT FROM 'no_as_of' OR as_of IS NULL)
           AND (reason IS NULL OR reason NOT IN ('as_of_future', 'no_baseline', 'implausible_jump') OR as_of IS NOT NULL)),
  -- While queued: the suffix reasons had no single match; rules 4 to 8 had exactly one.
  CONSTRAINT loyalty_inbox_reads_pending_membership
    CHECK (state <> 'pending'
           OR reason = 'program_mismatch'
           OR (reason IN ('no_suffix', 'unmatched_suffix', 'ambiguous_suffix') AND membership_id IS NULL)
           OR (reason IN ('unit_mismatch', 'no_as_of', 'as_of_future', 'no_baseline', 'implausible_jump')
               AND membership_id IS NOT NULL))
);

-- Serves the retention purge.
CREATE INDEX loyalty_inbox_reads_received ON loyalty_inbox_reads (received_on);
-- Serves per-program coverage (newest read row of each program).
CREATE INDEX loyalty_inbox_reads_program ON loyalty_inbox_reads (program_id, received_on);
-- Serves the per-membership extracted fields shown on /travel.
CREATE INDEX loyalty_inbox_reads_membership ON loyalty_inbox_reads (membership_id) WHERE membership_id IS NOT NULL;
-- Serves the queue, newest received first.
CREATE INDEX loyalty_inbox_reads_pending ON loyalty_inbox_reads (received_on DESC, id DESC) WHERE state = 'pending';

-- ─── loyalty_inbox_not_mine: suffixes the household disowned ─────────────────────────────────
--
-- Written by the not-mine action when the item has a suffix (idempotent: ON CONFLICT DO NOTHING on
-- the pair). A later reading whose suffix matches NO membership of the program and is listed here
-- is discarded as not_mine_known; once a membership with that suffix exists, the record has no
-- effect (a membership is the stronger fact). Never purged. No ON DELETE action on the program.
CREATE TABLE loyalty_inbox_not_mine (
  id          SERIAL PRIMARY KEY,
  program_id  INTEGER NOT NULL REFERENCES loyalty_programs(id),
  -- The same kept-suffix shape as loyalty_inbox_reads.suffix.
  suffix      TEXT NOT NULL
                CONSTRAINT loyalty_inbox_not_mine_suffix_shape CHECK (suffix ~ '^[A-Z0-9]{3,4}$'),
  added_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  CONSTRAINT loyalty_inbox_not_mine_program_suffix_key UNIQUE (program_id, suffix)
);

-- ─── loyalty_inbox_read_state: the last read run, one row ────────────────────────────────────
--
-- Exactly one row, id 1, seeded here and only ever updated. All three other columns NULL = never
-- read ("Not read yet"). A run that finds no key (disabled) or another run holding the lock
-- (already_running) writes nothing here.
--   last_read_on    — CURRENT_DATE of the last run that reached an outcome.
--   last_outcome    — ok or error.
--   last_error_code — the run's classified code, set exactly when the outcome is error. Equals the
--                     contract's LOYALTY_READ_RUN_ERROR_CODES. Never library text, a host or a key.
CREATE TABLE loyalty_inbox_read_state (
  id               SMALLINT PRIMARY KEY
                     CONSTRAINT loyalty_inbox_read_state_single_row CHECK (id = 1),
  last_read_on     DATE,
  last_outcome     TEXT
                     CONSTRAINT loyalty_inbox_read_state_last_outcome_check
                       CHECK (last_outcome IS NULL OR last_outcome IN ('ok', 'error')),
  last_error_code  TEXT
                     CONSTRAINT loyalty_inbox_read_state_last_error_code_check
                       CHECK (last_error_code IS NULL
                              OR last_error_code IN ('rate_limited', 'timeout', 'api_error', 'store_failed')),
  CONSTRAINT loyalty_inbox_read_state_outcome_dated
    CHECK ((last_read_on IS NULL) = (last_outcome IS NULL)),
  CONSTRAINT loyalty_inbox_read_state_code_iff_error
    CHECK ((last_error_code IS NOT NULL) = (last_outcome IS NOT DISTINCT FROM 'error'))
);

INSERT INTO loyalty_inbox_read_state (id) VALUES (1);

-- Down Migration
-- Drops the three read tables and nothing else. No program, membership, observation (including
-- every 'email' observation a read appended), instrument, inbox message or ledger row is touched;
-- indexes, constraints and the state row go with their tables. NOT LOSSLESS: take the \copy
-- backups in the header first, and revert the application code before running this so nothing
-- queries a missing table. The reads table first: it is the only one holding foreign keys to
-- tables that stay.

DROP TABLE loyalty_inbox_reads;
DROP TABLE loyalty_inbox_not_mine;
DROP TABLE loyalty_inbox_read_state;
