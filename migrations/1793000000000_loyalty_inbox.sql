-- Up Migration
-- Loyalty inbox: forwarded loyalty mail collected from a dedicated, read-only polled mailbox
-- (ROADMAP.md §5 Phase 8 step 42c, first task; plan/tasks/P8-42c1-loyalty-inbox/SPEC.md and
-- CONTRACT.md). Creates five tables and seeds two of them. No existing table is altered.
--
-- ─── WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────────────────────
--
-- Two tables are CONFIGURATION typed by the owner on /travel:
--   loyalty_sender_domains      — which sender domains belong to which catalog program (the
--                                 allowlist). Seeded below for the whole catalog.
--   household_member_addresses  — the addresses each household member forwards from, used to
--                                 attribute a stored message to a person.
-- Three tables are what the poller records:
--   loyalty_inbox_messages        — one row per kept message: its raw bytes (for 42c2 to read
--                                   later) and the four header-derived facts the attribution needs.
--   loyalty_inbox_unknown_senders — one row per message from a sender nobody allowlisted: its
--                                   dedupe hash, its received date and its sender domain, nothing
--                                   else. A row and not a per-domain counter, because a counter
--                                   cannot tell a re-poll from a new message (SPEC.md Open question 11).
--   loyalty_inbox_state           — exactly one row: when the mailbox was last polled and how that
--                                   went, as a classified code only.
--
-- NOTHING DERIVED FROM THE MAIL IS STORED except sender_domain, origin, attribution, member_id,
-- received_on, the dedupe hash and the raw bytes. There is no column for a subject, a sender's
-- local part or full address, a recipient address, a snippet, parsed text, an attachment, a size
-- history, or anything 42c2 will extract (a balance, an expiry, a member number). Extraction is a
-- read of raw_mail, done later; a stored copy of any extracted value would be a second answer that
-- goes stale silently. Acceptance command 6 refuses a column whose name says otherwise.
--
-- RETENTION IS THIRTY DAYS BY received_on (contract constant LOYALTY_INBOX_RETENTION_DAYS). The
-- purge deletes loyalty_inbox_messages and loyalty_inbox_unknown_senders rows whose received_on is
-- strictly before CURRENT_DATE minus thirty. It never deletes configuration, the state row, or the
-- two durable "last seen" dates (loyalty_sender_domains.last_seen_on and
-- household_member_addresses.last_received_on), which must outlive the mail so a quiet forwarder
-- does not read as "never". There is no CHECK on received_on against CURRENT_DATE: CURRENT_DATE is
-- not immutable, and a CHECK that a restore can fail on is a trap. Physical erasure of deleted
-- bytes follows autovacuum (a stated limit; nothing here runs VACUUM FULL).
--
-- DATES ARE Postgres DATE, compared with CURRENT_DATE in SQL, never computed by JavaScript.
-- received_on is the UTC calendar date of the server-side received time (IMAP INTERNALDATE),
-- derived in SQL as (<ISO text>::timestamptz AT TIME ZONE 'UTC')::date. CURRENT_DATE follows the
-- session time zone, so a boundary message can move by one day for a few hours; that is accepted.
--
-- THE HOSTNAME SHAPE used by every domain CHECK below, stated once: lower-case ASCII letters,
-- digits and hyphens; at least two dot-separated labels; each label 1 to 63 characters, not
-- starting or ending with a hyphen; no leading, trailing or doubled dot; at most 253 characters.
-- The CHECKs are the floor. The application refuses more on input (shared mail providers, a short
-- list of shared multi-label suffixes) through the one validator in packages/contracts/loyalty.ts.
--
-- NO SENDER AUTHENTICATION. The From header is unauthenticated (no DKIM, SPF or DMARC check), so a
-- stored message is untrusted input for 42c2 even though its domain was allowlisted.
--
-- ─── THE SEEDED SENDER DOMAINS ───────────────────────────────────────────────────────────────
--
-- Written on 2026-11-21 (SPEC.md amendment A1) as each catalog program's primary public mail
-- domain. It is a STARTING POINT, not a verified list: it is editable on /travel ("Edit sender
-- domains"), and the unknown-sender readout there is how the household learns the marketing
-- domains a program actually mails from. A subdomain of a stored domain matches, so a sender at a
-- mail. or email. subdomain needs no extra row.
--
-- One deviation from the amendment's table, made because the table cannot be stored as written: it
-- lists hawaiianairlines.com under both Atmos Rewards and HawaiianMiles, but a domain is UNIQUE
-- across programs (two programs owning one domain would make a message's program depend on which
-- row a query returned first). Following SPEC.md Open question 7 ("a domain two programs share goes
-- to one of them; the owner can move it"), it is seeded once, for HawaiianMiles, which would
-- otherwise have no domain at all; Atmos Rewards keeps alaskaair.com. Raised in CONTRACT.md.
--
-- ─── BEFORE ANY migrate:down ON A REAL DATABASE ──────────────────────────────────────────────
--
-- The down is NOT lossless for the configuration made while this was live: every sender-domain
-- edit, every forwarding address and the poll state are discarded (the seeded domains come back
-- with the next up, the owner's edits do not). Back up first (SPEC.md Rollback, BUILD.md §9.3):
--
--   \copy (SELECT p.name, d.domain FROM loyalty_sender_domains d JOIN loyalty_programs p ON p.id = d.program_id ORDER BY d.domain) TO 'backup-loyalty_sender_domains.csv' CSV HEADER
--   \copy (SELECT m.display_name, a.address, a.added_on, a.last_received_on FROM household_member_addresses a JOIN household_members m ON m.id = a.member_id ORDER BY a.address) TO 'backup-household_member_addresses.csv' CSV HEADER
--
-- The stored mail and the unknown-sender rows are deliberately NOT backed up: they are at most
-- thirty days old, derived from the mailbox, and a backup would keep raw mail past its retention.
-- A restore re-runs migrate:up and loads the two files back by program name and member name.

-- ─── loyalty_sender_domains: the allowlist ───────────────────────────────────────────────────
--
-- A message is kept only when its original sender's domain equals a stored domain or ends with a
-- dot followed by one; the longest stored domain wins. So a stored domain must be exactly what the
-- owner meant to trust, which is why the CHECK refuses anything that is not a lower-case hostname,
-- and additionally requires a final label of 2 to 24 letters or the punycode xn-- form (an IP
-- literal or a numeric final label names no mail domain).
--
-- UNIQUE (domain) ACROSS THE WHOLE TABLE, not per program: a domain owned by two programs would
-- make a message's program depend on row order. A taken domain is the route's 409 DOMAIN_TAKEN
-- (23505 from this constraint, so a lost race is the same 409, never a 500).
CREATE TABLE loyalty_sender_domains (
  id            SERIAL PRIMARY KEY,
  -- CASCADE: an allowlist entry means nothing without its program. (No route deletes a program;
  -- this keeps a hand-run delete of a fabricated test program to one statement, as the aliases do.)
  program_id    INTEGER NOT NULL REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  domain        TEXT NOT NULL
                  CONSTRAINT loyalty_sender_domains_domain_key UNIQUE
                  CONSTRAINT loyalty_sender_domains_domain_shape CHECK (
                    char_length(domain) <= 253
                    AND domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,24}|xn--[a-z0-9-]{0,58}[a-z0-9])$'),
  -- The received_on of the newest stored message this domain decided, or NULL = no mail seen yet
  -- (rendered "No mail seen yet", never a date and never the epoch). MONOTONE: a writer sets it to
  -- the greater of the old value and the new message's received_on, so an older message stored
  -- later never moves it back. Durable: the retention purge does not touch it. It is an observation
  -- of mail that has since been deleted, which cannot be re-derived once the mail is gone; that is
  -- why it is a column and not a read over loyalty_inbox_messages.
  last_seen_on  DATE
);

CREATE INDEX loyalty_sender_domains_program ON loyalty_sender_domains (program_id);

-- ─── household_member_addresses: where each person forwards from ─────────────────────────────
--
-- Compared EXACTLY, case-folded: no plus-tag and no dot normalisation (a member who forwards from
-- an alias registers the alias). Stored lower-case so the comparison has no case-fold to forget.
-- The shape is a plain addr-spec: a local part of 1 to 64 characters from ASCII letters, digits and
-- the atext punctuation, an @, and a hostname of at least two labels; at most 254 characters. No
-- display name, angle bracket or quoted local part can be stored.
--
-- UNIQUE (address) ACROSS THE WHOLE TABLE: an address held by two members would make attribution
-- a guess. A taken address is the route's 409 ADDRESS_TAKEN (23505, so a lost race is the same).
CREATE TABLE household_member_addresses (
  id                SERIAL PRIMARY KEY,
  -- CASCADE: an address means nothing without its member. No route deletes a member.
  member_id         INTEGER NOT NULL REFERENCES household_members(id) ON DELETE CASCADE,
  address           TEXT NOT NULL
                      CONSTRAINT household_member_addresses_address_key UNIQUE
                      CONSTRAINT household_member_addresses_address_shape CHECK (
                        char_length(address) <= 254
                        AND address ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]{1,64}@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  -- The day the address was registered. With no mail yet, forwarding health counts its quiet days
  -- from the earliest added_on of the member's addresses, so a person who set up forwarding and
  -- never received anything becomes "quiet" after the silence threshold instead of waiting forever.
  -- A replace of the list keeps the added_on of an address that stays in it.
  added_on          DATE NOT NULL DEFAULT CURRENT_DATE,
  -- The received_on of the newest stored message ATTRIBUTED (attribution 'matched') to this member
  -- through this address, or NULL = none yet. Unattributed mail never sets it. MONOTONE and durable
  -- exactly as loyalty_sender_domains.last_seen_on: never moved back, never purged.
  last_received_on  DATE
);

CREATE INDEX household_member_addresses_member ON household_member_addresses (member_id);

-- ─── loyalty_inbox_messages: kept mail, raw ──────────────────────────────────────────────────
--
-- One row per allowlisted message, for at most the retention window. raw_mail is the RFC 822 bytes
-- exactly as fetched; no route, page or log ever returns or prints them, and only the inbox library
-- file reads or writes the column.
CREATE TABLE loyalty_inbox_messages (
  id             SERIAL PRIMARY KEY,
  -- Lower-case hex SHA-256 of the outer Message-ID (angle brackets and surrounding whitespace
  -- removed), or of the text 'raw:' followed by the raw bytes when there is no Message-ID. Hashed so
  -- no Message-ID text (which can embed an address) is stored. The same key space as
  -- loyalty_inbox_unknown_senders.dedupe_key: a key present in EITHER table is a duplicate, never
  -- downloaded or counted again. Uniqueness across the two tables is the poller's check, not a
  -- constraint (a CHECK cannot see another table); within this table it is the constraint, and a
  -- store that loses a race is ON CONFLICT DO NOTHING, never a 500.
  dedupe_key     TEXT NOT NULL
                   CONSTRAINT loyalty_inbox_messages_dedupe_key_key UNIQUE
                   CONSTRAINT loyalty_inbox_messages_dedupe_key_shape CHECK (dedupe_key ~ '^[0-9a-f]{64}$'),
  -- The UTC calendar date of the server's received time (see the top of this file). Retention, the
  -- fetch window, health and coverage compare it with CURRENT_DATE. Never the Date header, which the
  -- sender writes.
  received_on    DATE NOT NULL,
  -- The day the row was written. Bookkeeping only; nothing derives health or retention from it.
  stored_on      DATE NOT NULL DEFAULT CURRENT_DATE,
  -- The program whose stored domain matched (longest match). No ON DELETE action: a program is
  -- never deleted while mail references it, and a cascade would silently drop evidence.
  program_id     INTEGER NOT NULL REFERENCES loyalty_programs(id),
  -- The original sender's domain, lower-case hostname shape. The domain only, never the local part.
  sender_domain  TEXT NOT NULL
                   CONSTRAINT loyalty_inbox_messages_sender_domain_shape CHECK (
                     char_length(sender_domain) <= 253
                     AND sender_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  -- Where the original sender was read:
  --   direct     — the outer From (an automatic filter forward preserves it).
  --   attachment — the From of a message/rfc822 part, honoured only from a registered member address.
  --   inline     — the From: line after a forward marker in the text body, likewise member-only.
  origin         TEXT NOT NULL
                   CONSTRAINT loyalty_inbox_messages_origin_check
                     CHECK (origin IN ('direct', 'attachment', 'inline')),
  -- Who the message was for, by the recipient tiers of SPEC.md Conventions:
  --   matched    — one member's registered address decided it; member_id is that member.
  --   unmatched  — candidate addresses existed, none registered.
  --   none_found — no candidate address anywhere in the message.
  --   ambiguous  — the deciding tier matched two or more different members. Never guessed.
  -- Only unmatched, none_found and ambiguous are ever re-attributed (after an address edit), and
  -- only to matched; a matched row is never changed.
  attribution    TEXT NOT NULL
                   CONSTRAINT loyalty_inbox_messages_attribution_check
                     CHECK (attribution IN ('matched', 'unmatched', 'none_found', 'ambiguous')),
  -- NULL = not attributed to anyone (any attribution but matched). NOT an inheriting column:
  -- nothing resolves it through COALESCE. No ON DELETE action, as program_id.
  member_id      INTEGER REFERENCES household_members(id),
  -- The raw bytes. NULL exactly when oversize is true: a message over LOYALTY_INBOX_MAX_BYTES is
  -- recorded (so it is not re-listed and re-skipped on every poll) without ever being downloaded.
  raw_mail       BYTEA,
  oversize       BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT loyalty_inbox_messages_member_iff_matched
    CHECK ((attribution = 'matched') = (member_id IS NOT NULL)),
  CONSTRAINT loyalty_inbox_messages_bytes_iff_not_oversize
    CHECK ((raw_mail IS NULL) = oversize)
);

-- Serves the retention purge and the in-window counts.
CREATE INDEX loyalty_inbox_messages_received ON loyalty_inbox_messages (received_on);
CREATE INDEX loyalty_inbox_messages_program ON loyalty_inbox_messages (program_id, received_on);

-- ─── loyalty_inbox_unknown_senders: mail nobody allowlisted, counted, never kept ─────────────
--
-- Never downloaded in full. Holds nothing that identifies the message, its subject or its sender's
-- local part: the hash makes the count idempotent across re-polls, received_on lets it expire with
-- the window, and domain is what the owner reads to decide whether to allowlist it. A sender whose
-- domain cannot be read as a hostname is stored as the exact sentinel '(unreadable)', so this table
-- never holds attacker-chosen text.
CREATE TABLE loyalty_inbox_unknown_senders (
  dedupe_key   TEXT PRIMARY KEY
                 CONSTRAINT loyalty_inbox_unknown_senders_dedupe_key_shape CHECK (dedupe_key ~ '^[0-9a-f]{64}$'),
  received_on  DATE NOT NULL,
  domain       TEXT NOT NULL
                 CONSTRAINT loyalty_inbox_unknown_senders_domain_shape CHECK (
                   domain = '(unreadable)'
                   OR (char_length(domain) <= 253
                       AND domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'))
);

CREATE INDEX loyalty_inbox_unknown_senders_received ON loyalty_inbox_unknown_senders (received_on);

-- ─── loyalty_inbox_state: the last poll, one row ─────────────────────────────────────────────
--
-- Exactly one row, id 1, seeded here and only ever updated. All three other columns NULL = never
-- polled (rendered "Not checked yet", never a date and never ok). A poll that finds the poller
-- disabled, or another poll already running, writes nothing here.
--   last_polled_on  — CURRENT_DATE of the last poll that ran to an outcome.
--   last_outcome    — ok or error.
--   last_error_code — the classified code of an error outcome, never library text, a host, a user
--                     or a password. Equals the contract's LOYALTY_INBOX_POLL_ERROR_CODES.
-- The CHECKs make a contradictory state unstorable: a date without an outcome, an error without a
-- code, or a code on an ok.
CREATE TABLE loyalty_inbox_state (
  id               SMALLINT PRIMARY KEY
                     CONSTRAINT loyalty_inbox_state_single_row CHECK (id = 1),
  last_polled_on   DATE,
  last_outcome     TEXT
                     CONSTRAINT loyalty_inbox_state_last_outcome_check
                       CHECK (last_outcome IS NULL OR last_outcome IN ('ok', 'error')),
  last_error_code  TEXT
                     CONSTRAINT loyalty_inbox_state_last_error_code_check
                       CHECK (last_error_code IS NULL
                              OR last_error_code IN ('connect_failed', 'tls_failed', 'auth_failed',
                                                     'timeout', 'mailbox_missing', 'source_failed')),
  CONSTRAINT loyalty_inbox_state_outcome_dated
    CHECK ((last_polled_on IS NULL) = (last_outcome IS NULL)),
  CONSTRAINT loyalty_inbox_state_code_iff_error
    CHECK ((last_error_code IS NOT NULL) = (last_outcome IS NOT DISTINCT FROM 'error'))
);

INSERT INTO loyalty_inbox_state (id) VALUES (1);

-- ─── The sender-domain seed ──────────────────────────────────────────────────────────────────
--
-- Resolved by exact catalog name to the lowest id with that name (loyalty_programs.name is not
-- unique, and two rows for one domain would violate the UNIQUE). A name with no program is SKIPPED,
-- not fatal: unlike the catalog seed, which created the names it referenced, this runs against a
-- live catalog the owner may already have renamed through the program PATCH route, and a deploy
-- must not fail on that. A skipped program simply has no domain yet (/travel says "No sender
-- domains set"); the notice below names the count. On a fresh database every name resolves, and
-- acceptance command 5 asserts that every catalog program received a domain, which is the guard
-- against a misspelt name here.
INSERT INTO loyalty_sender_domains (program_id, domain)
SELECT s.program_id, s.domain
FROM (
  SELECT (SELECT min(p.id) FROM loyalty_programs p WHERE p.name = v.program) AS program_id, v.domain
  FROM (VALUES
    ('AAdvantage', 'aa.com'),
    ('Atmos Rewards', 'alaskaair.com'),
    ('Delta SkyMiles', 'delta.com'),
    ('United MileagePlus', 'united.com'),
    ('Southwest Rapid Rewards', 'southwest.com'),
    ('JetBlue TrueBlue', 'jetblue.com'),
    ('HawaiianMiles', 'hawaiianairlines.com'),
    ('Frontier Miles', 'flyfrontier.com'),
    ('Spirit Free Spirit', 'spirit.com'),
    ('Sun Country Rewards', 'suncountry.com'),
    ('Emirates Skywards', 'emirates.com'),
    ('Miles & More', 'miles-and-more.com'),
    ('Miles & More', 'lufthansa.com'),
    ('Miles&Smiles', 'turkishairlines.com'),
    ('Iberia Club', 'iberia.com'),
    ('ITA Airways Volare', 'ita-airways.com'),
    ('British Airways Club', 'britishairways.com'),
    ('British Airways Club', 'ba.com'),
    ('Flying Blue', 'flyingblue.com'),
    ('Flying Blue', 'airfrance.com'),
    ('Flying Blue', 'klm.com'),
    ('Qatar Airways Privilege Club', 'qatarairways.com'),
    ('Singapore Airlines KrisFlyer', 'singaporeair.com'),
    ('Aeroplan', 'aircanada.com'),
    ('Aeroplan', 'aeroplan.com'),
    ('Virgin Atlantic Flying Club', 'virginatlantic.com'),
    ('Cathay', 'cathaypacific.com'),
    ('ANA Mileage Club', 'ana.co.jp'),
    ('Etihad Guest', 'etihad.com'),
    ('LifeMiles', 'lifemiles.com'),
    ('LifeMiles', 'avianca.com'),
    ('Aer Lingus AerClub', 'aerlingus.com'),
    ('JAL Mileage Bank', 'jal.com'),
    ('JAL Mileage Bank', 'jal.co.jp'),
    ('Korean Air SKYPASS', 'koreanair.com'),
    ('Qantas Frequent Flyer', 'qantas.com'),
    ('Qantas Frequent Flyer', 'qantas.com.au'),
    ('Copa ConnectMiles', 'copaair.com'),
    ('Marriott Bonvoy', 'marriott.com'),
    ('Hilton Honors', 'hilton.com'),
    ('World of Hyatt', 'hyatt.com'),
    ('IHG One Rewards', 'ihg.com'),
    ('Best Western Rewards', 'bestwestern.com'),
    ('Wyndham Rewards', 'wyndhamhotels.com'),
    ('Choice Privileges', 'choicehotels.com'),
    ('ALL Accor', 'accor.com'),
    ('Radisson Rewards', 'radissonhotels.com'),
    ('Sonesta Travel Pass', 'sonesta.com'),
    ('GHA DISCOVERY', 'ghadiscovery.com'),
    ('Chase Ultimate Rewards', 'chase.com'),
    ('American Express Membership Rewards', 'americanexpress.com'),
    ('Citi ThankYou Rewards', 'citi.com'),
    ('Capital One Miles', 'capitalone.com'),
    ('Bilt Rewards', 'biltrewards.com'),
    ('Wells Fargo Rewards', 'wellsfargo.com'),
    ('One Key', 'expedia.com'),
    ('One Key', 'hotels.com'),
    ('One Key', 'vrbo.com'),
    ('Ford Rewards', 'ford.com'),
    ('GM Rewards', 'gm.com'),
    ('Toyota Rewards', 'toyota.com')
  ) AS v(program, domain)
) AS s
WHERE s.program_id IS NOT NULL;

DO $$
DECLARE
  missing integer;
BEGIN
  SELECT count(*) INTO missing
    FROM loyalty_programs p
   WHERE NOT EXISTS (SELECT 1 FROM loyalty_sender_domains d WHERE d.program_id = p.id);
  IF missing > 0 THEN
    RAISE NOTICE 'loyalty inbox: % loyalty programs have no seeded sender domain; add them on /travel', missing;
  END IF;
END
$$;

-- Down Migration
-- Drops the five inbox tables and nothing else. No program, member, alias, membership,
-- observation, instrument, earn rule or ledger row is touched; indexes, constraints, the seeded
-- domains and the state row go with their tables. NOT LOSSLESS for the configuration: take the two
-- \copy backups in the header first. Revert the application code before running this, so nothing
-- queries a missing table. Children of the configuration tables first.

DROP TABLE loyalty_inbox_messages;
DROP TABLE loyalty_inbox_unknown_senders;
DROP TABLE loyalty_inbox_state;
DROP TABLE household_member_addresses;
DROP TABLE loyalty_sender_domains;
