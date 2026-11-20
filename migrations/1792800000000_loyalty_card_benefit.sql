-- Up Migration
-- Loyalty: the credit card that earns into a membership, and the annual benefit that card brings
-- (ROADMAP.md §5 Phase 8 step 42b; plan/tasks/P8-42b-card-annual-instruments/SPEC.md and
-- CONTRACT.md). Alters loyalty_memberships only; no table is created and no other table changes.
--
-- ─── WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────────────────────
--
-- card_account_id already exists (1792700000000), unused until now. From this step it is the link:
-- the credit account whose spend earns into this membership. NULL means "no card linked" — it is
-- not an inheriting column and nothing is resolved through it by COALESCE. That the account's type
-- is 'credit' is the membership PATCH route's check (400 INVALID_INPUT otherwise), not a constraint
-- here: a CHECK cannot read another table, and a trigger would not see a later change of the
-- account's own type, so it would promise more than it could keep.
--
-- Three nullable columns describe the card's ANNUAL BENEFIT once per link: which instrument kind it
-- issues, in the issuer's words, and how many days after the fee posts it normally arrives. They
-- are DESCRIPTION, typed by a person, not observation.
--
-- NO FEE, FEE DATE, EXPECTED-BY DATE OR STATE IS STORED, under any name. The annual fee is found
-- in the ledger on every read (through the gift read path, so a row held by an unrevealed gift is
-- never a fee), the expected-by date is that fee's posted date plus benefit_window_days computed by
-- Postgres, and the state (no fee seen, awaiting, received, overdue) is derived from the fee, the
-- instruments and CURRENT_DATE. Each would go stale the moment a transaction synced, was refunded,
-- or an instrument was recorded, and nothing would notice. The ledger and loyalty_instruments
-- already answer the question; a stored copy would be a second answer that can disagree.
--
-- The benefit is NOT tied to the card by a constraint. Unlinking (card_account_id set to NULL by
-- the route) keeps the benefit, because it is inert without a card and survives a card reissue;
-- and ON DELETE SET NULL on card_account_id would otherwise have to fail an account delete.
--
-- ─── BEFORE ANY `migrate:down` ON A REAL DATABASE ────────────────────────────────────────────
--
-- The down is NOT lossless for the benefit: every description and window typed while this was
-- live is discarded. Links (card_account_id) and instruments are untouched by the down. Back up
-- first (SPEC.md Rollback, BUILD.md §9.3):
--
--   \copy (SELECT id, card_account_id, benefit_kind, benefit_description, benefit_window_days FROM loyalty_memberships ORDER BY id) TO 'backup-loyalty_card_benefit.csv' CSV HEADER
--
-- A restore re-runs migrate:up and loads the file back by membership id.

ALTER TABLE loyalty_memberships
  -- The instrument kind the card issues each year. The same four kinds, spelled exactly as
  -- loyalty_instruments_kind_check spells them, because "received" is decided by matching an
  -- instrument of THIS kind on this membership; a kind no instrument can carry could never be
  -- received and would read as overdue forever. A new instrument kind is added to both CHECKs
  -- together. NULL = no benefit described (a card whose fee buys nothing to watch for).
  ADD COLUMN benefit_kind TEXT
    CONSTRAINT loyalty_memberships_benefit_kind_check
      CHECK (benefit_kind IS NULL
             OR benefit_kind IN ('free_night', 'companion_fare', 'travel_credit', 'other')),
  -- What the benefit is, in the issuer's words. Stored trimmed (the route trims; the CHECK refuses
  -- an untrimmed value so no comparison has a trim to forget; \x0B is vertical tab, as a hex escape
  -- because E-strings have no \v), 1 to 200 characters counted in characters. Never '' — no
  -- description is NULL, together with the kind.
  ADD COLUMN benefit_description TEXT
    CONSTRAINT loyalty_memberships_benefit_description_trimmed
      CHECK (benefit_description IS NULL
             OR (benefit_description = btrim(benefit_description, E' \t\n\r\f\x0B')
                 AND char_length(benefit_description) BETWEEN 1 AND 200)),
  -- Calendar days after the fee's POSTED date within which the benefit normally arrives; the
  -- expected-by date is that date plus this many days, inclusive, by Postgres date arithmetic. An
  -- integer, never an interval or a float, so the arithmetic is date + integer and no time zone
  -- or daylight-saving hour can move it. 1 to 365: zero would make every fee overdue the day after
  -- it posts, and more than a year would overlap the next year's fee.
  --
  -- NO COLUMN DEFAULT, on purpose. The default window (the contract's
  -- LOYALTY_BENEFIT_DEFAULT_WINDOW_DAYS) is written by the route when a benefit is set without one.
  -- A DEFAULT here would fill every existing row on ADD COLUMN, giving a window to memberships that
  -- describe no benefit and breaking the all-or-nothing rule below.
  ADD COLUMN benefit_window_days INTEGER
    CONSTRAINT loyalty_memberships_benefit_window_range
      CHECK (benefit_window_days IS NULL OR benefit_window_days BETWEEN 1 AND 365),
  -- A benefit is described completely or not at all. A kind without a description cannot be shown;
  -- a window without a kind has nothing to wait for. So the three are NULL together or set together,
  -- and "no benefit" has exactly one spelling.
  ADD CONSTRAINT loyalty_memberships_benefit_complete
    CHECK ((benefit_kind IS NULL) = (benefit_description IS NULL)
           AND (benefit_kind IS NULL) = (benefit_window_days IS NULL));

-- ONE CARD, ONE MEMBERSHIP (SPEC.md Open question 5). A card's annual fee is one ledger row; linked
-- to two memberships it would open two expectations for one charge. A co-branded card earns into
-- one program, and a reissued card is a new account id. The constraint, not a prior SELECT, decides,
-- so two links racing for one card give the route's 409 CARD_ALREADY_LINKED (SQLSTATE 23505), never
-- a 500. Partial, so any number of memberships may have no card. Every existing value is NULL (no
-- path in 42a set it), so building the index cannot fail on existing data.
CREATE UNIQUE INDEX loyalty_memberships_one_per_card
  ON loyalty_memberships (card_account_id) WHERE card_account_id IS NOT NULL;

-- Down Migration
-- Drops the unique index and the three benefit columns, and nothing else. card_account_id, every
-- membership, observation, instrument, member, program and alias survive. The column CHECKs go with
-- their columns; the table CHECK is dropped first by name. Revert the application code before
-- running this, so nothing queries a missing column. Take the \copy backup in the header first: the
-- benefit descriptions and windows are not recoverable otherwise.

DROP INDEX loyalty_memberships_one_per_card;
ALTER TABLE loyalty_memberships
  DROP CONSTRAINT loyalty_memberships_benefit_complete,
  DROP COLUMN benefit_window_days,
  DROP COLUMN benefit_description,
  DROP COLUMN benefit_kind;
