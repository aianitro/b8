-- Up Migration
-- Keep Plaid's enrichment instead of throwing it away (P6-40b).
--
-- ─── WHAT THIS ADDS, AND WHAT IT DOES NOT TOUCH ───────────────────────────────────────────────
--
-- Sync has always received far more per transaction than it stored: the detailed category, the
-- date the card was authorised, the channel, the merchant's logo/website/entity id and a location.
-- This adds eleven nullable columns to hold them. No existing column changes type, nullability,
-- default or meaning, and no row is written: every row that exists when this runs has NULL in all
-- eleven. Filling them for history is P6-40c's backfill, deliberately not done here.
--
-- ─── WHAT NULL MEANS IN THESE COLUMNS ─────────────────────────────────────────────────────────
--
-- Two different things, and `plaid_raw` is how a reader tells them apart:
--   * plaid_raw IS NOT NULL, a scalar column NULL  -> sync wrote this row and Plaid did not say
--     (omitted the key, sent null, or sent an empty/blank string). Never stored as '' or 0.
--   * plaid_raw IS NULL                            -> nothing was captured for this row: it predates
--     this migration and no sync has rewritten it since, or it is not a Plaid row at all (manual,
--     CSV, cash). The enrichment is UNKNOWN, not absent.
-- Hence no NOT NULL and no DEFAULT anywhere below. A default would assert something Plaid never
-- said, and a NOT NULL would make every non-Plaid insert path invent a value.
--
-- ─── WHY THE DETAILED CATEGORY IS A NEW COLUMN, NOT A NEW MEANING FOR plaid_category ──────────
--
-- `plaid_category` keeps meaning Plaid's PRIMARY category (FOOD_AND_DRINK), exactly as before.
-- Every stored row holds a primary value and every `category_rules.plaid_category` key is a primary
-- value. Repointing the existing column at the detailed category would be BUILD.md §9.2's semantic
-- change with no type change: history would become a mixture of two vocabularies with nothing
-- marking the boundary, and every category rule would silently stop matching new rows. The detailed
-- value (FOOD_AND_DRINK_COFFEE) therefore gets its own name. It does not drive categorisation.
--
-- ─── WHY NO CHECK CONSTRAINTS ─────────────────────────────────────────────────────────────────
--
-- payment_channel, the category columns and the confidence level are Plaid's vocabularies, not
-- this app's, and Plaid extends them without notice. A CHECK listing today's values would make the
-- first new value fail the INSERT, and with it the whole item's sync. Values are stored verbatim
-- (`in store` stays `in store`), so nothing here normalises them either.
--
-- ─── WHY NO INDEX ─────────────────────────────────────────────────────────────────────────────
--
-- Nothing queries these columns yet. An index is added with the first query that needs one.
--
-- ─── WHY COORDINATES, STREET ADDRESS AND STORE NUMBER ARE NOT COLUMNS ─────────────────────────
--
-- Measured before this was specified (plan/tasks/P6-40b-plaid-enrichment/COVERAGE.md): the detailed
-- category and the authorised date are near-universal, logo/website/entity id are present on about
-- two rows in five, and city on about a quarter (nearly half of in-store rows). Latitude/longitude,
-- street address and store number are each under a fifth, and authorized_datetime is often a
-- placeholder midnight. Those are too sparse or too lossy to earn a column, and they are not lost:
-- they stay in `plaid_raw`. Confidence and country travel inside objects already being read
-- (personal_finance_category, location), so they cost nothing to keep.
--
-- ─── plaid_raw: WHAT "AS RECEIVED" MEANS, AND THE ONE REDACTION ───────────────────────────────
--
-- The single Plaid Transaction object for this row, exactly as transactionsSync returned it: every
-- key Plaid sent, including null-valued ones, nested objects intact, nothing renamed or flattened,
-- and no app-derived key (mapped_category, rule_applied, id...) added. It exists so that a field
-- wanted later can be read from rows already stored, instead of needing a second backfill against
-- Plaid, which only reaches back so far.
--
-- EXACTLY ONE thing is removed before storing: `account_numbers` on every element of
-- `counterparties`. It is the only part of the object that carries a THIRD PARTY's bank account
-- number (BACS sort code and account, IBAN and BIC). No planned reader needs it, and BUILD.md §10.3
-- lists account numbers as a leakage class. Everything else in the counterparty is kept.
-- `account_owner` and `payment_meta` are kept on purpose (orchestrator decision at G0, recorded in
-- the spec): they are the same class of personal text as `name` and `merchant_name`.
--
-- JSONB rather than JSON or TEXT so it is queryable in place (plaid_raw->'location'->>'lat').
--
-- plaid_raw IS A RECORD, NOT A SOURCE OF FIGURES. It carries Plaid's own `amount` verbatim; the
-- `amount` column (NUMERIC, signed as Plaid states it) stays the only authoritative figure, and no
-- code may read money out of this object. It must also never be selected by a route or returned to
-- a client: that is why it is not in any contract type.
ALTER TABLE transactions
  -- personal_finance_category.detailed. Its own column so plaid_category keeps meaning PRIMARY.
  ADD COLUMN IF NOT EXISTS plaid_category_detailed   TEXT,
  -- personal_finance_category.confidence_level, verbatim (Plaid's VERY_HIGH ... UNKNOWN scale).
  ADD COLUMN IF NOT EXISTS plaid_category_confidence TEXT,
  -- The day the card was authorised, as opposed to `date` (posted). DATE, not TEXT or TIMESTAMPTZ:
  -- Plaid sends a calendar date with no zone, and a timestamp would invite a zone shift of a day.
  ADD COLUMN IF NOT EXISTS authorized_date           DATE,
  -- 'online', 'in store', 'other' today; verbatim, unconstrained (see above). Not an exclusion
  -- signal: 'other' must never be used to hide or exclude anything.
  ADD COLUMN IF NOT EXISTS payment_channel           TEXT,
  -- Plaid's stable merchant identity, steadier than the merchant_name string.
  ADD COLUMN IF NOT EXISTS merchant_entity_id        TEXT,
  ADD COLUMN IF NOT EXISTS logo_url                  TEXT,
  ADD COLUMN IF NOT EXISTS website                   TEXT,
  -- The three cheap parts of `location`. The rest of it stays in plaid_raw.
  ADD COLUMN IF NOT EXISTS location_city             TEXT,
  ADD COLUMN IF NOT EXISTS location_region           TEXT,
  ADD COLUMN IF NOT EXISTS location_country          TEXT,
  -- The Transaction object as received, minus counterparties[*].account_numbers. Never NULL for a
  -- row a sync has written since this migration; NULL means "not captured", see above.
  ADD COLUMN IF NOT EXISTS plaid_raw                 JSONB;

-- Down Migration
-- Drops exactly the eleven columns above and nothing else. The enrichment captured since deploy is
-- discarded; it is stored nowhere else and comes back only by re-running the P6-40c backfill. No
-- pre-existing column is touched, and transaction_tombstones (P6-40a) is untouched.
ALTER TABLE transactions
  DROP COLUMN IF EXISTS plaid_category_detailed,
  DROP COLUMN IF EXISTS plaid_category_confidence,
  DROP COLUMN IF EXISTS authorized_date,
  DROP COLUMN IF EXISTS payment_channel,
  DROP COLUMN IF EXISTS merchant_entity_id,
  DROP COLUMN IF EXISTS logo_url,
  DROP COLUMN IF EXISTS website,
  DROP COLUMN IF EXISTS location_city,
  DROP COLUMN IF EXISTS location_region,
  DROP COLUMN IF EXISTS location_country,
  DROP COLUMN IF EXISTS plaid_raw;
