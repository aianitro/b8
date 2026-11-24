-- Enabled with no schema depending on it yet — groundwork for future semantic search over
-- transaction/merchant history (see ROADMAP.md's pgvector-backed RAG section). On Homebrew
-- Postgres, note the bottled `pgvector` formula only targets postgresql@17/@18; against
-- postgresql@16 it has to be built from source against that version's pg_config.
CREATE EXTENSION IF NOT EXISTS vector;

-- Plaid-linked accounts
CREATE TABLE IF NOT EXISTS accounts (
  id                     TEXT PRIMARY KEY,  -- Plaid account_id (NOT guaranteed permanently stable — see lib/plaidReconcile.ts)
  name                   TEXT NOT NULL,
  type                   TEXT NOT NULL,
  subtype                TEXT,
  mask                   TEXT,              -- last 4 digits, used to re-match accounts if Plaid reissues account_id
  persistent_account_id  TEXT,              -- Plaid's stable identifier, preferred over account_id for reconciliation
  landscape              TEXT NOT NULL DEFAULT 'operational' CHECK (landscape IN ('operational', 'capital')),
  access_token    TEXT,              -- NULL for manually-created accounts
  cursor              TEXT,              -- Plaid sync cursor for incremental updates
  last_synced_at      TIMESTAMPTZ,
  track_transactions  BOOLEAN NOT NULL DEFAULT TRUE,
  bank                TEXT,
  sort_order          INT NOT NULL DEFAULT 0,  -- manual drag-and-drop order within a landscape group on /accounts
  valuation_mode      TEXT NOT NULL DEFAULT 'ledger' CHECK (valuation_mode IN ('ledger', 'valuation')),  -- 'ledger': balance = flow-derived (below); 'valuation': balance = latest account_valuations row
  is_liability        BOOLEAN NOT NULL DEFAULT FALSE,  -- valuation-mode accounts only (see lib/domain/valuation.ts) — subtracted rather than added
  -- Money physically counted rather than reported by a feed: wallets, gift cards. Gates the
  -- cash-count flow (lib/cashCountStore.ts). Stored rather than inferred because every available
  -- rule is a coincidence — `access_token IS NULL` also catches a hand-added credit card, and
  -- `type = 'other'` only happens to fit today. "Can you hold it and count it" is a fact about the
  -- account, like valuation_mode and is_liability, not something its transactions reveal.
  countable           BOOLEAN NOT NULL DEFAULT FALSE,
  -- Plaid's institution id, free from the `/item/get` call sync already makes for the two freshness
  -- columns below, and the key `/institutions/get_by_id` needs.
  institution_id      TEXT,
  -- WHY a feed is dead, not just that it is. feedHealth already reports staleness; this is what
  -- turns "your data is 98 hours old" into "...because Plaid has had this bank degraded since
  -- Thursday" — which is the difference between waiting and re-authenticating. Read from
  -- `transactions_updates` (the product this app consumes), falling back to `item_logins`.
  -- Item-level facts stored per account, exactly like item_last_*_update beside them.
  item_institution_status    TEXT
    CONSTRAINT accounts_institution_status_known
      CHECK (item_institution_status IS NULL OR item_institution_status IN ('HEALTHY', 'DEGRADED', 'DOWN')),
  -- Plaid's own last_status_change, not when this app read it: "degraded since Thursday" is useful,
  -- "we noticed at 6am" is about us.
  item_institution_status_at TIMESTAMPTZ,
  -- Overdraft watch (migration 1792000000000; table overdraft_episodes below). Both INERT on any
  -- account that is not a Plaid-fed depository account: the watcher never reads them there.
  -- overdraft_watch is the per-account opt-out (e.g. overdraft protection drawing on savings),
  -- TRUE by default so existing accounts are watched from the first sync. overdraft_cushion is the
  -- line below which (strictly) the account is in an episode; zero means "warn when overdrawn" and
  -- is a chosen threshold, not a missing value. Never negative.
  overdraft_watch     BOOLEAN NOT NULL DEFAULT TRUE,
  overdraft_cushion   NUMERIC(12, 2) NOT NULL DEFAULT 0
    CONSTRAINT accounts_overdraft_cushion_nonnegative CHECK (overdraft_cushion >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Editable starting balance per account per year; combined with that year's
-- transactions to compute the running/ending balance shown on the account statement.
CREATE TABLE IF NOT EXISTS account_balances (
  account_id         TEXT NOT NULL REFERENCES accounts(id) ON UPDATE CASCADE,
  year               INT NOT NULL,
  beginning_balance  NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, year)
);

-- Point-in-time valuations for 'valuation'-mode accounts (market-value assets, real estate,
-- amortizing liabilities) — a flow-derived running balance is meaningless for these. Append-only:
-- one row per observation, not an editable "current value" column, so manual quarterly entries
-- and eventual Plaid balance pulls both just add rows; "latest" is valued_at DESC LIMIT 1.
CREATE TABLE IF NOT EXISTS account_valuations (
  id          SERIAL PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON UPDATE CASCADE,
  value       NUMERIC(14, 2) NOT NULL,  -- always a positive magnitude; sign is derived from accounts.is_liability, not stored here
  source      TEXT NOT NULL CHECK (source IN ('manual', 'plaid_balance', 'plaid_investments', 'derived')),
  valued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_valuations_account_id ON account_valuations(account_id, valued_at DESC);

-- Real estate as a first-class capital asset — deliberately its own entity, not a shadow
-- "account": a property has no Plaid id or track_transactions/cursor semantics, and (unlike a
-- brokerage) two independent things move over time — its market value and, separately, the
-- mortgage balance secured against it (accounts.property_id below).
CREATE TABLE IF NOT EXISTS properties (
  id             SERIAL PRIMARY KEY,
  nickname       TEXT NOT NULL,
  address        TEXT,
  type           TEXT NOT NULL CHECK (type IN ('primary', 'rental')),
  purchase_price NUMERIC(14, 2),
  purchase_date  DATE,
  cost_basis     NUMERIC(14, 2),  -- starts at purchase_price; bumped manually for capital improvements — no separate improvements ledger yet
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Same append-only shape as account_valuations. 'source' has only one live value today — a
-- property's market value has no Plaid-sourced counterpart — kept as a CHECK (not a narrower
-- type) so an API source (Zillow-shaped) can slot in later as a one-line constraint change.
CREATE TABLE IF NOT EXISTS property_valuations (
  id          SERIAL PRIMARY KEY,
  property_id INT NOT NULL REFERENCES properties(id) ON UPDATE CASCADE,
  value       NUMERIC(14, 2) NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('manual')),
  valued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_valuations_property_id ON property_valuations(property_id, valued_at DESC);

-- Money a rental holds that arrived from its tenant. Two kinds, deliberately in ONE table with a
-- discriminator rather than two sibling tables: they are the same observation motif (per-property,
-- manually entered, positive magnitude, newest-wins) and differ only in how the app treats them.
-- Putting the difference in a column lets the schema state it, right here, next to the thing it
-- describes; splitting them across two tables would leave "which of these reduces net worth?"
-- answered nowhere in the schema and only implicitly in whichever query read which table. A third
-- kind (pet deposit, prepaid HOA) is then a one-line CHECK change rather than a fourth table.
--
--   'security_deposit' — refundable, owed back to the tenant at move-out, and a genuine liability.
--                        The cash sits in the property's trust checking account and is already
--                        counted there at full value, so net worth subtracts it exactly once, in
--                        the `liabilities` component (lib/domain/netWorth.ts). It counts whether
--                        or not the property has a current valuation — deliberately unlike a
--                        linked mortgage, which is netted *against* a property's value and is
--                        therefore dropped along with an unvalued property to avoid a naked debt.
--                        A deposit is netted against nothing; it is owed in full either way.
--   'last_month_rent'  — NOT a liability here, and that omission is a recorded decision rather
--                        than an oversight. Under accrual accounting it would be unearned
--                        revenue; this app is cash-basis throughout (computePropertyPnl sums
--                        transactions), so the payment was already recognized as rent income on
--                        the day it landed. Booking it as a liability now would make the
--                        net-worth statement and the P&L disagree about the same dollar. It is
--                        recorded and shown because "you are holding $X of tenant money" is true
--                        of it too; it contributes to no net-worth component and emits no
--                        contribution line.
--
-- Append-only, same as account_valuations/property_valuations: there is no "current amount"
-- column, so a changed holding is a new row and the history survives. "Currently held" is the
-- newest row per (property_id, kind), reduced through latestValueByKey (lib/domain/observations.ts)
-- rather than last-row-wins — none of the queries that feed it carry an ORDER BY to rely on.
-- No row for a property means the amount is UNKNOWN and renders "—"; a row whose value is 0 is a
-- real reading (a waived deposit, a last month's rent fully applied and not yet re-collected) and
-- renders $0. Nothing may collapse the first case into the second.
--
-- No `source` column, unlike the two valuation tables: those carry one because a Zillow-shaped API
-- is a named, plausible future observer of a property's market value. Nothing outside this app can
-- observe a security deposit, so a column with exactly one permitted value would be ceremony.
CREATE TABLE IF NOT EXISTS property_tenant_funds (
  id          SERIAL PRIMARY KEY,
  property_id INT NOT NULL REFERENCES properties(id) ON UPDATE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('security_deposit', 'last_month_rent')),
  -- Named value/valued_at, not amount/recorded_at: this is the third series in the app with the
  -- shape latestValueByKey() reduces, and the other two spell these two fields exactly so. A third
  -- spelling would make the shared reducer look like a coincidence rather than a rule.
  -- Always a positive magnitude; the sign is derived at use (`liabilities -= value`), never stored.
  -- The CHECK has no counterpart on account_valuations/property_valuations, where "always
  -- positive" is only a comment. It is enforced here because this is the one series whose sign is
  -- flipped on read: a negative row would turn an obligation into an asset and *raise* net worth,
  -- with nothing downstream looking wrong.
  value       NUMERIC(14, 2) NOT NULL CHECK (value >= 0),
  valued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_tenant_funds_property_id
  ON property_tenant_funds(property_id, kind, valued_at DESC);

-- Links a mortgage LIABILITY account to the property it's secured against, so per-property
-- equity = property_valuations.latest − this account's latest account_valuations balance.
-- Nullable: most accounts (checking, brokerages, unrelated liabilities) have no property.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS property_id INT REFERENCES properties(id) ON UPDATE CASCADE;

-- Budget categories with annual allocations.
--
-- A category carries four independent classifications, and confusing any two of them is how a
-- headline number goes quietly wrong:
--   landscape            — which book it belongs to (spending vs. savings/investment movement)
--   exclude_from_budget  — counted in the ledger, absent from budget math (transfers)
--   is_income            — money in rather than out
--   control_mode         — how much of a *decision* the spend is (below)
--
-- control_mode exists because an adherence figure averaged over every category is diluted by
-- construction: a mortgage payment and a restaurant dinner are both budget lines and only one of
-- them is a decision. It makes the set such a metric ranges over nameable out loud —
--   landscape = 'operational' AND exclude_from_budget = FALSE
--     AND is_income = FALSE AND control_mode = 'discretionary'
-- — with all four conjuncts independently required. 'variable-necessary' (utilities, groceries,
-- fuel: necessary, but the amount moves with circumstance rather than with a decision) and
-- 'fixed' are tracked and reported, never scored. Three values rather than a boolean precisely
-- because 'variable-necessary' has nowhere correct to go in a boolean.
--
-- NOT NULL, never nullable: a NULL here would be a fourth, unnamed mode that a later AVG() ranges
-- over silently. This is a stated departure from the repo's "nullable means unknown" rule — a
-- missing valuation is genuinely unknown; a category's control mode is at worst mis-decided,
-- never absent. DEFAULT 'fixed' rather than 'discretionary' so an unreviewed category stays out
-- of the scored set instead of being counted as a behavioural choice it was never checked to be.
-- Present on capital rows and INERT there: no consumer may read control_mode without first
-- gating on landscape = 'operational', exactly as exclude_from_budget/is_income are already gated.
CREATE TABLE IF NOT EXISTS budget_categories (
  id                    SERIAL PRIMARY KEY,
  name                  TEXT NOT NULL,
  annual_budget         NUMERIC(12, 2) NOT NULL,
  landscape             TEXT NOT NULL DEFAULT 'operational' CHECK (landscape IN ('operational', 'capital')),
  exclude_from_budget   BOOLEAN NOT NULL DEFAULT FALSE,
  is_income             BOOLEAN NOT NULL DEFAULT FALSE,
  is_debt_service       BOOLEAN NOT NULL DEFAULT FALSE,  -- category-level debt-service signal, alongside accounts.is_liability: a manual mortgage's balance and its payment stream sit on different accounts and never meet (lib/domain/propertyPnl.ts, app/properties/[id]/page.tsx)
  control_mode          TEXT NOT NULL DEFAULT 'fixed' CHECK (control_mode IN ('fixed', 'discretionary', 'variable-necessary')),  -- see the note above; only 'discretionary' is ever scored
  sort_order            INT NOT NULL DEFAULT 0,
  dedicated_account_id  TEXT REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE SET NULL,
  monthly_amounts       NUMERIC(12, 2)[], -- expected amount per month (12 values, Jan-Dec); NULL = spread annual_budget evenly across all 12
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, landscape),
  -- is_debt_service and control_mode classify the same property of a category, and two
  -- overlapping classifications of one property on one table are how definitions drift. They are
  -- not merged (is_debt_service is narrower and has its own consumers), so their relationship is
  -- stated here instead: a debt-service category IS the fixed case. One-directional on purpose —
  -- the converse must not hold, since most fixed categories (insurance, taxes, subscriptions) are
  -- not debt service. A CHECK rather than an application check because it also polices UPDATE.
  CONSTRAINT budget_categories_debt_service_control_mode_check
    CHECK (NOT is_debt_service OR control_mode = 'fixed')
);

-- Editable starting balance per category per year, for categories that track a real
-- pool of money (e.g. a rental fund) rather than pure spending — see category_balances
-- below. Mirrors account_balances but keyed by category name, since a category's
-- transactions can span multiple accounts (money moved between them mid-year).
CREATE TABLE IF NOT EXISTS category_balances (
  category_name      TEXT NOT NULL,
  year                INT NOT NULL,
  beginning_balance   NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (category_name, year)
);

-- Rules mapping Plaid categories to user budget categories. mapped_category and
-- transactions.mapped_category below are intentionally not FKs to budget_categories(name)
-- — name alone isn't unique (see UNIQUE(name, landscape) above), and category names are
-- allowed to be renamed/reused loosely.
-- A standing instruction for filing. Two kinds, exactly one match column set per row: a rule can
-- name a Plaid category or a payee, and the payee rule wins where both could claim a transaction.
-- Plaid's primary categories are too coarse to file with alone — FOOD_AND_DRINK covers the
-- supermarket and the pizzeria — which is what the merchant kind exists to answer.
CREATE TABLE IF NOT EXISTS category_rules (
  id               SERIAL PRIMARY KEY,
  plaid_category   TEXT UNIQUE,
  merchant_name    TEXT,
  mapped_category  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT category_rules_one_match_kind
    CHECK ((plaid_category IS NULL) <> (merchant_name IS NULL))
);
-- Matching is case-insensitive, so uniqueness is too — otherwise two spellings of one payee
-- become two rules that disagree and whichever is read last wins.
CREATE UNIQUE INDEX IF NOT EXISTS category_rules_merchant_lower
  ON category_rules (LOWER(merchant_name)) WHERE merchant_name IS NOT NULL;

-- A transfer is any set of 2+ transactions whose amounts sum to zero (moving money
-- between your own accounts). Group size isn't fixed at 2 — e.g. one withdrawal
-- split across three deposits nets to zero just as validly as a simple pair.
CREATE TABLE IF NOT EXISTS transfer_groups (
  id         SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Transactions pulled from Plaid
CREATE TABLE IF NOT EXISTS transactions (
  id                    SERIAL PRIMARY KEY,
  plaid_transaction_id  TEXT NOT NULL UNIQUE,
  account_id            TEXT NOT NULL REFERENCES accounts(id) ON UPDATE CASCADE,
  date                  DATE NOT NULL,
  amount                NUMERIC(12, 2) NOT NULL,
  name                  TEXT,
  merchant_name         TEXT,
  plaid_category        TEXT,
  mapped_category       TEXT,
  rule_applied          BOOLEAN NOT NULL DEFAULT FALSE,
  transfer_group_id     INT REFERENCES transfer_groups(id) ON DELETE SET NULL,
  -- Attributes this one transaction to a property, overriding the account it sits on. INHERITING:
  -- resolved as COALESCE(t.property_id, a.property_id), so an explicit tag wins and the account's
  -- accounts.property_id supplies the default. NULL means "inherit from the account", NOT
  -- "unattributed" -- a reader that treats NULL as unattributed silently drops every row of a
  -- linked account. Exists for a property's money that moved through an account not its own (e.g.
  -- before its dedicated account was opened), where linking that whole account would drag every
  -- unrelated transaction onto the property's books. Added by migration 1786646344365.
  property_id           INT REFERENCES properties(id) ON UPDATE CASCADE ON DELETE SET NULL,
  hidden                BOOLEAN NOT NULL DEFAULT FALSE,  -- excluded from budget/dashboard calcs; still visible (grayed out) on /transactions
  watched_at            TIMESTAMPTZ,                     -- NOT NULL *is* the "keep an eye on this" flag; the timestamp is what lets an entry age
  note                  TEXT,                            -- the owner's own comment, e.g. "returning to Zara". INDEPENDENT of watched_at since 2026-09-22: writing a note does not flag a row, and unflagging does not discard the note
  -- Plaid's enrichment (P6-40b). All eleven nullable with no default and no CHECK, and no index.
  -- NULL has two meanings and plaid_raw tells them apart: with plaid_raw set, a NULL column means
  -- Plaid did not say (omitted, null, or a blank string -- never stored as '' or 0); with plaid_raw
  -- NULL, nothing was captured (a row older than the migration and not re-synced since, or a
  -- manual/CSV/cash row), so the enrichment is UNKNOWN. No CHECKs because these are Plaid's
  -- vocabularies and Plaid extends them; a closed list would fail a whole item's sync over one new
  -- value. Coordinates, street address and store number are too sparse to earn columns (see
  -- plan/tasks/P6-40b-plaid-enrichment/COVERAGE.md) and are kept in plaid_raw instead.
  plaid_category_detailed   TEXT,                        -- personal_finance_category.detailed. A NEW name on purpose: plaid_category above stays the PRIMARY category, because stored rows and every category_rules.plaid_category key depend on that meaning (BUILD.md §9.2). Does not drive categorisation
  plaid_category_confidence TEXT,                        -- personal_finance_category.confidence_level, verbatim
  authorized_date           DATE,                        -- the day the card was authorised (date above is posted). DATE, not text or timestamptz: Plaid sends a zone-less calendar date
  payment_channel           TEXT,                        -- verbatim ('in store' stays 'in store'), unconstrained. NOT an exclusion signal: 'other' hides nothing
  merchant_entity_id        TEXT,
  logo_url                  TEXT,
  website                   TEXT,
  location_city             TEXT,
  location_region           TEXT,
  location_country          TEXT,
  -- The single Plaid Transaction object as received: every key, null-valued ones included, nothing
  -- renamed, flattened or added. Kept so a field wanted later needs no second backfill. EXACTLY ONE
  -- redaction: counterparties[*].account_numbers is removed, the only part carrying a third party's
  -- bank account number (BUILD.md §10.3). account_owner and payment_meta are kept on purpose. JSONB
  -- so it is queryable in place. A record only: its `amount` is never read as money (the amount
  -- column is authoritative), and no route or contract type may select or return it.
  plaid_raw                 JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- No constraint tying the note to the flag. There WAS one, and it made writing a comment the same
  -- act as putting a row on the watchlist -- which, once watched rows started being excused from the
  -- budget grading, meant a note silently changed the figures. See the 2026-09-22 migration.
  CONSTRAINT transactions_note_length           CHECK (note IS NULL OR (length(note) BETWEEN 1 AND 200))
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_mapped_category ON transactions(mapped_category);
CREATE INDEX IF NOT EXISTS idx_transactions_transfer_group ON transactions(transfer_group_id);
-- Partial: almost every transaction inherits its property from its account and is never looked up
-- this way, so only the explicitly tagged rows are indexed.
CREATE INDEX IF NOT EXISTS idx_transactions_property_id ON transactions(property_id) WHERE property_id IS NOT NULL;
-- Partial: watched rows are the rare ones and the only ones this predicate ever selects.
CREATE INDEX IF NOT EXISTS idx_transactions_watched ON transactions(watched_at) WHERE watched_at IS NOT NULL;

-- Plaid transaction ids the OWNER deleted. Sync must never write one of these ids to `transactions`
-- again, whether it arrives as `added` or `modified`, and must not let one claim a stored row during
-- re-identification. Deleting a row is not enough by itself: Plaid does not know about the delete,
-- and the next `modified` for that id would upsert the row back.
--
-- Keyed on plaid_transaction_id alone because that is the only thing sync has for an incoming
-- transaction, and it is TEXT NOT NULL UNIQUE on every transactions row, including the synthetic
-- `manual_`/`csv_` ids. Those tombstones are inert: sync never receives such ids, and the CSV
-- importer and manual create deliberately do not read this table.
--
-- NO FOREIGN KEY TO transactions, ON PURPOSE. A tombstone exists to outlive the row it names: an FK
-- would either refuse the delete or cascade the tombstone away with it, and it would let
-- `TRUNCATE transactions ... CASCADE` clear this table too.
--
-- Only the owner's delete writes a row here. Plaid's own `removed` events delete the transaction and
-- write NO tombstone, because that is Plaid's view changing, not the owner's decision.
--
-- KNOWN GAP: after a bank re-auth Plaid issues NEW ids for the same real transactions, so a deleted
-- transaction can come back under its new id. Covering that would need account/date/amount/name
-- matching, which is a different shape with its own false positives. Documented, not fixed.
--
-- Permanent: nothing removes or expires a tombstone.
CREATE TABLE IF NOT EXISTS transaction_tombstones (
  -- An empty key matches nothing sync receives. The CHECK makes a delete that read its key from the
  -- wrong place fail and roll back, instead of leaving a tombstone that protects nothing.
  plaid_transaction_id TEXT PRIMARY KEY
    CONSTRAINT transaction_tombstones_key_not_empty CHECK (plaid_transaction_id <> ''),
  deleted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- FIRST tombstoning; a repeat delete of the same id leaves it unchanged
);

-- A photo of a transaction's receipt, one per transaction; attaching again replaces it. In the
-- database rather than on disk so the nightly pg_dump backs it up and a transaction's delete takes
-- it along (migrations/1792500000000_transaction-receipts.sql has the argument). The phone shrinks
-- and re-encodes a photo before sending it, which also drops its EXIF location.
CREATE TABLE IF NOT EXISTS transaction_receipts (
  transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
  -- Checked against the bytes' magic number by the route; served back as the Content-Type.
  content_type   TEXT NOT NULL
                   CONSTRAINT transaction_receipts_content_type CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  image          BYTEA NOT NULL
                   CONSTRAINT transaction_receipts_image_size CHECK (octet_length(image) BETWEEN 1 AND 4194304),  -- 4 MiB backstop
  attached_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Counting a wallet. Cash is the one account kind with a feed on only ONE side: the withdrawal is on
-- the bank feed, the coffee is on no feed at all, so the only way the ledger learns what a wallet
-- holds is the owner counting it.
--
-- PLACED HERE, AFTER `transactions`, ONLY BECAUSE IT REFERENCES IT. Conceptually it belongs beside
-- account_valuations with the other observation tables, but this file is written to run top to
-- bottom — `accounts.property_id` is a deferred ALTER further down for exactly that reason — and a
-- forward reference would break that for whoever runs it.
--
-- SEPARATE FROM account_valuations ON PURPOSE. That table is the valuation-mode regime — "this
-- account's balance IS its latest observation". A wallet is a LEDGER account: its balance is still
-- flow-derived, and a count does not replace that balance, it produces a correcting transaction
-- against it. Folding counts into account_valuations would put a valuation row on a ledger account
-- and blur the dual-regime split the Phase 0 keystone rests on.
--
-- THE COUNT THAT FINDS NOTHING IS WHY THIS IS A TABLE. If the only trace of counting were the
-- adjustment transaction, "counted on Sunday, it matched" would leave no trace and be
-- indistinguishable from "not counted since April" — and a wallet nobody spends from would report as
-- freshly counted exactly when it is most stale. `expected` is stored rather than recomputed for the
-- same reason net_worth_snapshots is: replaying a past balance through an edited ledger would quietly
-- make every historical count agree, which is the one thing this table exists to contradict.
CREATE TABLE IF NOT EXISTS cash_counts (
  id           SERIAL PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON UPDATE CASCADE,
  counted      NUMERIC(14, 2) NOT NULL CHECK (counted >= 0),  -- a wallet cannot hold less than nothing
  expected     NUMERIC(14, 2) NOT NULL,                       -- may be negative: spent-before-opening-balance computes below zero
  adjustment_transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,  -- NULL when the count matched
  counted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cash_counts_account_counted_at ON cash_counts (account_id, counted_at DESC);

-- One row per sync run, split by phase so the incremental value of a Plaid
-- transactionsRefresh (force) beyond a plain transactionsSync (plain) is visible over time.
CREATE TABLE IF NOT EXISTS sync_log (
  id         SERIAL PRIMARY KEY,
  ran_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger    TEXT NOT NULL,   -- 'scheduler' | 'manual_sync' | 'manual_force'
  phase      TEXT NOT NULL CHECK (phase IN ('plain', 'force')),
  synced     INT NOT NULL,
  unmatched  INT NOT NULL DEFAULT 0,
  errors     INT NOT NULL DEFAULT 0,
  -- Force-refresh calls Plaid REFUSED this run, which `errors` never saw: that call is caught and
  -- logged so a refusal cannot fail the whole sync, which is right, but it left "asked and was
  -- refused" and "asked and there was nothing new" both recording synced 0, errors 0. Measured
  -- during a four-day Chase outage: every refresh returned API_ERROR and the app reported clean runs.
  refresh_errors INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sync_log_ran_at ON sync_log(ran_at);

-- One row per *attempt* to hand an alert to the mail provider — the app's only outbound surface
-- (ROADMAP.md §5 Phase 0.5 step 33). It exists to answer one question for the sending shell,
-- "has a message with this fingerprint already been DELIVERED?", and to separate two failures that
-- otherwise look identical: nothing here for three weeks means the job never ran, whereas three
-- rows with delivered = FALSE means it ran and could not reach the provider.
--
-- Holds no figure of any kind, no name of anything the owner spends on, no payee and no account
-- identifier — by construction, not by convention. A send log is the row that gets pasted into an
-- EVIDENCE.md or read out of psql while someone debugs a delivery, and BUILD.md §5.4 says real
-- financial data never leaves into logs. The fingerprint's CHECK is what makes that structural: a
-- caller cannot key on the names because the regexp will not store them.
--
-- Append-only, like account_valuations and property_valuations. There is deliberately NO unique
-- constraint on fingerprint — without one there is no ON CONFLICT target, so the mutable
-- "last sent" row this design rejects cannot be written against this table at all. Duplicate
-- fingerprints are the history: a failed attempt and the next day's success are two rows on
-- purpose. Suppression keys on `delivered`, never on the mere existence of a row, or the first
-- network blip silences the guardrail permanently.
CREATE TABLE IF NOT EXISTS alert_sends (
  id             SERIAL PRIMARY KEY,
  attempted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind           TEXT NOT NULL CHECK (kind IN ('projected-breach', 'coverage', 'digest')),  -- the *message* kind, not the transport; a second destination re-triggers the BUILD.md §5.1 escalation
  fingerprint    TEXT NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{16,}$'),           -- opaque digest computed in lib/; the CHECK is what makes "opaque" enforceable
  delivered      BOOLEAN NOT NULL,                                                -- no DEFAULT: the shell knows the outcome, and either default would assert one it did not observe
  failure_reason TEXT CHECK (failure_reason IN ('config', 'transport', 'rejected')),  -- classified, never transcribed: a provider's rejection quotes the message back, subject line included
  -- NULL reads off `delivered`: on a delivered row there was no failure; on a failed row the cause
  -- was none of the three and lib/logger.ts has the detail. One-directional, like the debt-service
  -- coupling above — a failed row is never forced to carry a classification the caller lacks,
  -- because a placeholder reads as a diagnosis and is not one.
  CONSTRAINT alert_sends_delivered_failure_reason_check CHECK (NOT delivered OR failure_reason IS NULL)
);

-- Serves `WHERE fingerprint = $1 AND delivered`. Not partial on delivered, so the diagnostic read
-- is served too. No attempted_at index unlike sync_log: this table grows by about one row a day.
CREATE INDEX IF NOT EXISTS idx_alert_sends_fingerprint ON alert_sends(fingerprint);

-- Overdraft watch (migration 1792000000000): one row per stretch a watched account spends below
-- its cushion (accounts.overdraft_watch, accounts.overdraft_cushion).
--
-- The watched balance is, for a Plaid-fed depository account at sync time, the LOWER of Plaid's
-- `available` and `current`, so neither pending holds nor pending deposits can hide a shortfall.
-- It is stored nowhere else, which is why the episode is a stored record (the net_worth_snapshots
-- exception): the readings cannot be reconstructed later. A sync where Plaid reported neither
-- figure made no observation and must not open, extend or close anything.
--
-- Lifecycle per observed account, judged against the CURRENT accounts.overdraft_cushion:
-- below with no open episode = INSERT; below with one open = UPDATE last_balance, last_seen_at,
-- low_balance = LEAST(low_balance, reading); at or above with one open = set closed_at and nothing
-- else, so last_balance stays the last BELOW-cushion reading. An account not observed (feed down,
-- watch turned off) keeps its episode OPEN: closing it would claim a recovery nobody saw, and the
-- ageing last_seen_at is how a reader tells "still below" from "not looked at since".
--
-- Holds figures, so it is never read into a push payload: the PWA push stays content-free
-- (web_push_subscriptions below, and plan/tasks/P3-25-push-ping/DECISION.md).
CREATE TABLE IF NOT EXISTS overdraft_episodes (
  id            SERIAL PRIMARY KEY,
  -- ON UPDATE CASCADE like every accounts(id) reference (reconciliation remaps ids in place).
  -- ON DELETE CASCADE unlike most: alert state means nothing without its account, and NO ACTION
  -- would break any account-delete path the first time the account had ever been low.
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE CASCADE,
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at     TIMESTAMPTZ,                       -- NULL = open, not "unknown"
  cushion       NUMERIC(12, 2) NOT NULL CHECK (cushion >= 0),  -- the cushion the episode OPENED against; accounts.overdraft_cushion keeps no history
  low_balance   NUMERIC(14, 2) NOT NULL,           -- signed (negative = overdrawn), lowest reading in the episode
  last_balance  NUMERIC(14, 2) NOT NULL,           -- signed, most recent BELOW-cushion reading; never the balance "now"
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- when last_balance was read
  -- Accepted by at least one live web push subscription. NULL while open = retry next sync; NULL on
  -- a closed row = never delivered, and never pushed late, since by then it would be false.
  pushed_at     TIMESTAMPTZ,
  CONSTRAINT overdraft_episodes_closed_after_opened
    CHECK (closed_at IS NULL OR closed_at >= opened_at),
  CONSTRAINT overdraft_episodes_seen_in_episode
    CHECK (last_seen_at >= opened_at AND (closed_at IS NULL OR last_seen_at <= closed_at)),
  CONSTRAINT overdraft_episodes_pushed_after_opened
    CHECK (pushed_at IS NULL OR pushed_at >= opened_at),
  CONSTRAINT overdraft_episodes_low_is_lowest
    CHECK (low_balance <= last_balance),
  -- The opening reading was strictly below the opening cushion and the low only falls; a magnitude
  -- stored for an overdrawn balance fails here instead of reading as healthy.
  CONSTRAINT overdraft_episodes_low_below_cushion
    CHECK (low_balance < cushion)
);

-- At most one open episode per account, so overlapping syncs cannot open two and push twice.
CREATE UNIQUE INDEX IF NOT EXISTS overdraft_episodes_one_open
  ON overdraft_episodes (account_id) WHERE closed_at IS NULL;

-- Overdraft forecast (migration 1792100000000): one row per stretch during which a watched account's
-- 7-day projection goes STRICTLY below its cushion while the account is not yet in an episode.
--
-- The projection starts from the same watched balance as episodes (min of Plaid available/current at
-- sync time) and applies recurring series detected from the account's own history: outflows on their
-- due day, inflows only from the day after they land. It is derived and moves every sync, so it is
-- not a column anywhere; it is stored here only because its starting reading is recorded nowhere
-- else and the row is the push's idempotency record. The projection columns are a SNAPSHOT of the
-- latest projection that went below, never "the forecast now"; readers show projected_at's age.
--
-- Lifecycle per observed watched account, against the CURRENT accounts.overdraft_cushion: open or
-- opening episode = close any open forecast as 'episode' and open none; projected low below with
-- none open = INSERT; below with one open = UPDATE all six projection columns together (cushion,
-- balance, projected_low, low_on, charges, projected_at), never a subset; at or above with one open
-- = set closed_at and closed_reason = 'cleared' and nothing else. Observed with no recurring series
-- = a flat projection, which clears. Not observed (feed down, no balances, watch off) = leave as is.
--
-- Holds figures and merchant labels, so it is never read into a push payload (content-free push,
-- plan/tasks/P3-25-push-ping/DECISION.md).
CREATE TABLE IF NOT EXISTS overdraft_forecasts (
  id             SERIAL PRIMARY KEY,
  -- Same FK actions as overdraft_episodes.account_id, for the same reasons.
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE CASCADE,
  opened_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at      TIMESTAMPTZ,                       -- NULL = open, not "unknown"
  -- 'cleared' = a later projection no longer went below (not "recovered": the account was never
  -- below); 'episode' = the account opened an overdraft_episodes row (not "overdrawn": below the
  -- cushion is overdrawn only when the cushion is zero). NULL exactly when open.
  closed_reason  TEXT CHECK (closed_reason IN ('cleared', 'episode')),
  -- The cushion the LATEST stored projection was judged against, refreshed with it; unlike episodes,
  -- whose readings accumulate, a forecast's projection is replaced wholesale and must stay
  -- self-consistent. accounts.overdraft_cushion keeps no history.
  cushion        NUMERIC(12, 2) NOT NULL CHECK (cushion >= 0),
  balance        NUMERIC(14, 2) NOT NULL,           -- signed (negative = overdrawn), the reading the latest stored projection started from
  projected_low  NUMERIC(14, 2) NOT NULL,           -- signed, lowest balance in that projection's 7-day window
  low_on         DATE NOT NULL,                     -- first local calendar day projected_low is reached, within 7 days of projected_at
  -- [{"label": text, "amount": number, "on": "YYYY-MM-DD"}, ...]: every projected outflow due on or
  -- before low_on, date order, amount a POSITIVE magnitude rounded to cents. Display only, never
  -- summed back into money math; projected_low is authoritative. Never empty, and no DEFAULT, so an
  -- INSERT that forgot it fails instead of recording a forecast with no cause.
  charges        JSONB NOT NULL
    CONSTRAINT overdraft_forecasts_charges_nonempty_array
      CHECK (jsonb_typeof(charges) = 'array' AND jsonb_array_length(charges) >= 1),
  projected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- when the latest stored projection was computed
  -- Accepted by at least one live web push subscription. NULL while open = retry next sync; NULL on
  -- a closed row = never delivered, and never pushed late.
  pushed_at      TIMESTAMPTZ,
  CONSTRAINT overdraft_forecasts_closed_reason_iff_closed
    CHECK ((closed_at IS NULL) = (closed_reason IS NULL)),
  CONSTRAINT overdraft_forecasts_closed_after_opened
    CHECK (closed_at IS NULL OR closed_at >= opened_at),
  CONSTRAINT overdraft_forecasts_projected_in_forecast
    CHECK (projected_at >= opened_at AND (closed_at IS NULL OR projected_at <= closed_at)),
  CONSTRAINT overdraft_forecasts_pushed_while_open
    CHECK (pushed_at IS NULL OR (pushed_at >= opened_at AND (closed_at IS NULL OR pushed_at <= closed_at))),
  -- A start below the cushion is an episode, never a forecast. Safe only because cushion is
  -- refreshed with balance.
  CONSTRAINT overdraft_forecasts_start_at_or_above_cushion
    CHECK (balance >= cushion),
  -- Why the row exists; a magnitude stored for a negative projected balance fails here.
  CONSTRAINT overdraft_forecasts_low_below_cushion
    CHECK (projected_low < cushion)
);

-- At most one open forecast per account, so overlapping syncs cannot open two and push twice.
CREATE UNIQUE INDEX IF NOT EXISTS overdraft_forecasts_one_open
  ON overdraft_forecasts (account_id) WHERE closed_at IS NULL;

-- Editable beginning balance for a whole landscape's budget in a given year — distinct from
-- account_balances (per-account) and category_balances (per-category); this is the top-level
-- number the annual budget page nets everything else against. See app/api/budget/settings/route.ts,
-- app/budget/page.tsx, components/BudgetMonthlyGrid.tsx for its call sites.
CREATE TABLE IF NOT EXISTS budget_settings (
  year                INT NOT NULL,
  landscape           TEXT NOT NULL DEFAULT 'operational',
  beginning_balance   NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (year, landscape)
);

-- The "Unspent" bucket per spending category (migration 1791900000000). When a month closes, a
-- spending category's leftover (that month's plan minus what it actually spent, when positive) goes
-- into its bucket; an overspent month adds and takes nothing. Nothing carries automatically: the
-- owner CARRIES an amount into a month (same category or another, current month or later), raising
-- that month's plan, or RELEASES it to savings. Unallocated leftover counts as saved, so no figure
-- may assume it will be spent. Operational and capital spending categories only, never income or
-- excluded ones, from the September 2026 close onward: enforced by the job and the allocation
-- endpoint, not here.
--
-- Balance = SUM(budget_unspent.amount) - SUM(budget_unspent_moves.amount) per category_id,
-- computed on read. No stored balance column: it would be a "current value" that goes stale.
--
-- budget_unspent is a recorded snapshot, the same narrow exception as net_worth_snapshots: the
-- leftover could be recomputed from transactions, but a late Plaid backfill would then shrink a
-- bucket the owner had already allocated from. One row per spending category with a plan above zero
-- per CLOSED month, written once (a re-run must not refresh it), INCLUDING a zero row when the
-- category spent its plan or more. The zero rows record "closed" exactly once per category-month, so
-- a late refund can never insert a row afterwards; they add nothing to the balance. Months close only
-- from the 4th of the following month, so pending transactions have posted before actual is frozen.
CREATE TABLE IF NOT EXISTS budget_unspent (
  id           SERIAL PRIMARY KEY,
  category_id  INT NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,
  year         INT NOT NULL,
  month        INT NOT NULL CHECK (month BETWEEN 1 AND 12),  -- 1-based, like the calendar; not JavaScript's 0-based month
  amount       NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),  -- max(0, planned - actual) from the rounded planned; 0 = spent the plan or more
  planned      NUMERIC(12, 2) NOT NULL,                      -- the month's plan as the job saw it, carries into that month included (effective_budget), rounded to cents
  actual       NUMERIC(12, 2) NOT NULL,                      -- spend at close, frozen; later ledger edits do not reach it
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (category_id, year, month)
);

-- Each allocation out of a bucket, append-only. 'carry' raises the plan of (to_category_id,
-- to_year, to_month); 'release' gives the amount up to savings and has no destination. The
-- destination NULLs mean "no destination", not "unknown", hence the constraint tying them to the
-- action. "Current month or later" depends on today's date and is enforced by the endpoint.
-- Deleting the destination category cascades the carry away and returns the amount to the source
-- bucket's balance.
CREATE TABLE IF NOT EXISTS budget_unspent_moves (
  id              SERIAL PRIMARY KEY,
  category_id     INT NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,  -- the bucket drawn FROM
  amount          NUMERIC(12, 2) NOT NULL CHECK (amount > 0),                        -- positive magnitude; direction is never a sign
  action          TEXT NOT NULL CHECK (action IN ('carry', 'release')),
  to_category_id  INT REFERENCES budget_categories(id) ON DELETE CASCADE,
  to_year         INT,
  to_month        INT CHECK (to_month BETWEEN 1 AND 12),                             -- 1-based, like budget_unspent.month
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT budget_unspent_moves_destination
    CHECK ((action = 'carry') = (to_category_id IS NOT NULL AND to_year IS NOT NULL AND to_month IS NOT NULL))
);

-- Serves effective_budget(y). Partial: a release has no destination and is never read this way.
CREATE INDEX IF NOT EXISTS budget_unspent_moves_into
  ON budget_unspent_moves (to_year, to_category_id) WHERE action = 'carry';

-- Every category's plan for year y with carries into that year overlaid. A function, not a write
-- into budget_categories, because monthly_amounts is a YEAR-LESS repeating schedule: a carry into
-- one year's March has no cell of its own there. Readers of a year's plan JOIN this function; the
-- raw columns are the plan WITHOUT the owner's carries.
--   * No carries into y: EXACTLY the stored annual_budget and monthly_amounts (NULL stays NULL).
--   * Carries into y: annual_budget + their sum, and an explicit 12-element schedule, January
--     first, of COALESCE(monthly_amounts[g], annual_budget / 12) + carries into month g.
--   * annual_budget / 12 is NOT rounded here; readers round, as they already must for an even spread.
-- Returns every category, income and excluded included; filtering stays with the caller.
CREATE OR REPLACE FUNCTION effective_budget(y INT)
RETURNS TABLE (category_id INT, annual_budget NUMERIC, monthly_amounts NUMERIC[])
LANGUAGE sql STABLE
AS $$
  WITH carried AS (
    SELECT to_category_id AS cid, to_month AS m, SUM(amount) AS amt
      FROM budget_unspent_moves
     WHERE action = 'carry' AND to_year = y
     GROUP BY 1, 2
  ),
  touched AS (SELECT DISTINCT cid FROM carried)
  SELECT bc.id,
         CASE WHEN t.cid IS NULL THEN bc.annual_budget
              ELSE bc.annual_budget + (SELECT COALESCE(SUM(c.amt), 0) FROM carried c WHERE c.cid = bc.id)
         END,
         CASE WHEN t.cid IS NULL THEN bc.monthly_amounts
              ELSE ARRAY(
                SELECT COALESCE(bc.monthly_amounts[g], bc.annual_budget / 12)
                       + COALESCE((SELECT c.amt FROM carried c WHERE c.cid = bc.id AND c.m = g), 0)
                  FROM generate_series(1, 12) g
                 ORDER BY g)
         END
    FROM budget_categories bc
    LEFT JOIN touched t ON t.cid = bc.id
$$;

-- Net worth over time. Unlike account_valuations/property_valuations, which record observations
-- of a single thing, this stores the *computed* statement at a point in time. Stored rather than
-- recomputed because it can't be reconstructed later: the calculation depends on which accounts
-- existed and how they were classified that day, so deleting or reclassifying an account would
-- silently rewrite history if the chart derived it on the fly. Components are non-overlapping and
-- sum to total (lib/domain/netWorth.ts) — a property-linked mortgage lives in real_estate_equity
-- and is deliberately absent from liabilities so the same debt is never counted twice.
-- snapshot_date is the PK: re-running on the same day updates in place instead of duplicating.
CREATE TABLE IF NOT EXISTS net_worth_snapshots (
  snapshot_date      DATE PRIMARY KEY,
  operational        NUMERIC(14, 2) NOT NULL,
  capital_financial  NUMERIC(14, 2) NOT NULL,
  real_estate_equity NUMERIC(14, 2) NOT NULL,
  liabilities        NUMERIC(14, 2) NOT NULL,
  total              NUMERIC(14, 2) NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Marks the boundary between two definitions of `liabilities` (and therefore of `total`).
--
-- P0-09a folded tenant security deposits (property_tenant_funds) into the liabilities component.
-- Rows written before that date mean "unlinked valuation-mode liability accounts"; rows written
-- after mean "…plus security deposits held." Same column, same type, different meaning — BUILD.md
-- §9.2's breaking class, and the one that renders perfectly while being false.
--
-- §9.2's stated remedy is a new field name rather than a redefinition. That remedy is not used
-- here, for a reason worth recording rather than inferring:
--
--   * Nothing reads `liabilities` from this table. app/net-worth/page.tsx selects snapshot_date,
--     operational, capital_financial, real_estate_equity, total; app/dashboard/page.tsx selects
--     snapshot_date, total. A `liabilities_v2` would put a boundary marker on a series no surface
--     plots, and leave the discontinuity that IS plotted — in `total` — unmarked.
--   * `total` is where the break actually lands, and it must not be renamed. It is the headline
--     figure on two pages and the basis of the dashboard's since-first-snapshot delta. Its meaning
--     also has not changed: "net worth on this date, as truthfully as the app could then state
--     it." Every future truthfulness fix would otherwise demand a total_v3, total_v4, and the
--     scheme collapses.
--   * A decomposition column is strictly more useful than a rename. Any post-cutover row converts
--     exactly back to the old definition (`liabilities - liabilities_security_deposits`), so a
--     consumer can plot either definition consistently across the whole history. A rename yields
--     two half-series with no bridge in either direction.
--
-- NULL on pre-cutover rows is the marker AND the honest value: it means "this row predates deposit
-- modelling," not "no deposits were held that day." Deposits were held; they had not been recorded
-- yet, and the figure is unrecoverable. 0 would assert something false, so no backfill is done.
-- Signed exactly as it lands in `liabilities` (i.e. <= 0) — every column in this row is signed as
-- it contributes, and mixing a magnitude in among them is the sign trap this repo has shipped once.
--
-- Load-bearing consequence for whoever writes the snapshot: every INSERT *and* the ON CONFLICT DO
-- UPDATE must set this column. A post-cutover row left NULL claims to be old-definition while
-- carrying a deposit-adjusted `liabilities` — a marker that lies is worse than no marker.
ALTER TABLE net_worth_snapshots
  ADD COLUMN IF NOT EXISTS liabilities_security_deposits NUMERIC(14, 2);

-- The year-end projection's INPUTS, per budgeted category, as they stood each morning (migration
-- 1792200000000). The projection itself (lib/domain/yearEnd.ts via lib/yearEndRead.ts) stays a
-- derived read. These are stored for the net_worth_snapshots reason: the plan is edited in place and
-- re-filing, hiding or deleting a transaction keeps no history, so an earlier morning's inputs cannot
-- be rebuilt. Per category and per month, not one total, because "what moved the target" is a
-- sequential substitution over two snapshots (plan edits, closed months' actuals, the month in
-- progress, the calendar advancing), and a total cannot be decomposed. Never the figure "now".
--
-- Written once each morning; the first write of a (snapshot_date, landscape) wins AS A WHOLE, so a
-- second run that day adds, changes and removes nothing. No rows for a (date, landscape) means no
-- snapshot was taken, never "nothing budgeted": the move is then unknown, not zero. Year and month in
-- progress are derived from snapshot_date (the app's local calendar date), not stored.
CREATE TABLE IF NOT EXISTS year_end_snapshots (
  snapshot_date  DATE NOT NULL,
  landscape      TEXT NOT NULL CHECK (landscape IN ('operational', 'capital')),
  -- The NAME, not an id: actuals are summed by transactions.mapped_category, which is a name, and a
  -- deleted or renamed category's past must still read. A rename between two snapshots therefore
  -- reads as one category removed and another added, with offsetting moves.
  category_name  TEXT NOT NULL,
  is_income      BOOLEAN NOT NULL,  -- as of that morning; it can be flipped in place
  -- effective_budget(year) resolved to 12 months, January first: the explicit schedule or the even
  -- spread, carries included, rounded to cents. Positive for income and spending alike, never the
  -- ledger's sign. A zero month is a real plan of zero.
  plan           NUMERIC(12, 2)[] NOT NULL
    CONSTRAINT year_end_snapshots_plan_twelve_months
      CHECK (array_ndims(plan) = 1 AND array_lower(plan, 1) = 1 AND cardinality(plan) = 12
             AND array_position(plan, NULL) IS NULL),
  -- The 12 monthly actuals of that year, January first, in the LEDGER's sign (money out positive,
  -- money in negative), on loadYearEnd's rule (hidden = FALSE, track_transactions = TRUE), rounded to
  -- cents. A month with no transactions is a real 0, so NULL is refused.
  actuals        NUMERIC(12, 2)[] NOT NULL
    CONSTRAINT year_end_snapshots_actuals_twelve_months
      CHECK (array_ndims(actuals) = 1 AND array_lower(actuals, 1) = 1 AND cardinality(actuals) = 12
             AND array_position(actuals, NULL) IS NULL),
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (snapshot_date, landscape, category_name)
);

-- ══ The authentication boundary ═══════════════════════════════════════════════════════════════
--
-- The two tables below are the first in this schema that hold no financial data of any kind: no
-- figure, no payee, no account identifier. Everything above answers "what is true of the owner's
-- money"; these two answer "who is allowed to ask". They are grouped at the end, as their own
-- section, rather than interleaved with the ledger, because nothing above joins to them.
--
-- TWO USERS, ONE LEDGER (migration 1792300000000, P7-41a). The passkey migration refused a users
-- table while there was one principal, and named the way out: add the column nullable, backfill the
-- owner, tighten. There are now two people, and every credential belongs to one of them. Its
-- decisive objection — an unauthenticated request cannot name a user without inventing one — is
-- answered rather than dropped: the bootstrap gate stays a GLOBAL count of credentials, and the only
-- way an unauthenticated request creates a user is by presenting an invitation the owner minted while
-- signed in. NO LEDGER TABLE ABOVE HAS A user COLUMN, AND NONE MAY: both users are full peers over the
-- same data. The only actor columns are agent_proposals.proposed_by_user_id / decided_by_user_id.
-- auth_sessions and device_handoffs reach their user through credential_id and carry no copy of it.

-- One row per person who may sign in. Never deleted — agent_proposals names users as history.
-- Removing a user is revoked_at plus deleting that user's credentials, which cascades their sessions
-- and personal tokens. id is a plain integer: it appears only in the owner-only revoke URL, and it is
-- never a WebAuthn user handle. is_owner is the one asymmetry (only the owner invites or removes), and
-- it is stored, not derived from "the oldest row". revoked_at NULL means NOT REMOVED, the same stated
-- departure auth_sessions.revoked_at makes. The backfilled owner is named 'Owner'.
CREATE TABLE IF NOT EXISTS users (
  id           SERIAL PRIMARY KEY,
  display_name TEXT NOT NULL
                 CONSTRAINT users_display_name_length CHECK (length(display_name) BETWEEN 1 AND 60),
  is_owner     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMPTZ,
  -- The owner cannot be removed; otherwise one careless UPDATE leaves an app nobody can administer.
  CONSTRAINT users_owner_not_revoked CHECK (NOT (is_owner AND revoked_at IS NOT NULL))
);

-- At most one owner, as webauthn_credentials_one_bootstrap is at most one bootstrap: two concurrent
-- bootstraps both read "no owner yet", and this makes the second INSERT fail however they interleave.
-- It does not require an owner to exist — a database with zero credentials has none until bootstrap.
CREATE UNIQUE INDEX IF NOT EXISTS users_one_owner ON users (is_owner) WHERE is_owner;

-- The owner's invitation to a second user: the only way an unauthenticated request may enrol a
-- passkey once any credential exists, presented at the existing register/* endpoints. device_handoffs'
-- shape for device_handoffs' reason. code_hash is SHA-256 of the code, never the code; redemption is a
-- lookup on it in SQL. Live while expires_at > NOW() AND consumed_at IS NULL, evaluated by Postgres.
-- consumed_at and consumed_by are set together, in the same transaction that creates the user and the
-- credential; consumed_by is UNIQUE so one invitation makes exactly one user. created_by is always the
-- owner, which only the application can check.
CREATE TABLE IF NOT EXISTS user_invitations (
  code_hash    TEXT PRIMARY KEY
                 CONSTRAINT user_invitations_code_hash_format CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  created_by   INTEGER NOT NULL REFERENCES users(id),
  display_name TEXT NOT NULL
                 CONSTRAINT user_invitations_display_name_length CHECK (length(display_name) BETWEEN 1 AND 60),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL
                 CONSTRAINT user_invitations_expires_after_created CHECK (expires_at > created_at),
  consumed_at  TIMESTAMPTZ,
  consumed_by  INTEGER UNIQUE REFERENCES users(id),
  CONSTRAINT user_invitations_consumed_together CHECK ((consumed_at IS NULL) = (consumed_by IS NULL)),
  -- Seven days at most, in the database, like auth_sessions_personal_lifetime.
  CONSTRAINT user_invitations_lifetime CHECK (expires_at <= created_at + INTERVAL '7 days')
);

-- One row per authenticator enrolled to speak for a user. Multi-credential by construction — a
-- laptop and a phone are two rows — so every read here handles N rows. A query that takes the
-- newest row ("the" passkey) produces a second device that registers fine and can never log in.
--
-- credential_id is TEXT and public_key is BYTEA, and the asymmetry is the point: the id exists to
-- be COMPARED against what a browser sends already-encoded, so storing the encoded form removes
-- the decode step where padded-vs-unpadded goes wrong, and the CHECK makes unpadded base64url a
-- property of the database rather than a convention. The public key is never compared, only handed
-- to a verifier that wants bytes, so storing bytes removes the encoding decision entirely. Its
-- length CHECK moves "the verification result's field was renamed and we stored an empty buffer"
-- from a signature failure at some later login to a failure at the INSERT.
--
-- sign_count is THE ONE MUTABLE COLUMN in either table, deliberately: it is not a derived value
-- but a high-water mark of state living inside the authenticator, and clone detection is a
-- comparison against the highest value seen before. 0 IS A REAL READING, not a missing
-- observation — per the WebAuthn spec an authenticator with no counter reports 0 forever, which is
-- most platform authenticators — so clone detection is genuinely inert for such a credential and a
-- non-increasing counter must not be read as an attack when both values are 0. NOT NULL with no
-- DEFAULT, like alert_sends.delivered: a default would let an INSERT that forgot the column assert
-- "no counter support" for an authenticator that has one, disabling the check permanently.
--
-- transports NULL = the authenticator reported nothing (unknown); '{}' = it reported an empty
-- list. Not defaulted, and no CHECK on the elements — the transport vocabulary is open and still
-- moving ('cable' retired, 'hybrid' and 'smart-card' added), so a closed list would fail a future
-- browser's registration at the INSERT with no recourse but a migration.
--
-- enrolled_via is provenance, not derivation: 'bootstrap' = enrolled by an unauthenticated request
-- while zero credentials existed; 'authenticated' = enrolled by a request carrying a valid
-- session, and the credential belongs to that session's user; 'invitation' = enrolled by an
-- unauthenticated request presenting a live user_invitations code, which created a new user. Not
-- recoverable from created_at, which answers a different question. An invited enrolment is never
-- tagged 'bootstrap': that would trip the one-bootstrap index for the second user.
--
-- user_id is NOT NULL: every session resolves to a user through its credential with no gap, so a
-- lookup that finds no user has found no session and must fail closed, never default to the owner.
-- Every credential that predates migration 1792300000000 was backfilled to the owner.
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  credential_id TEXT PRIMARY KEY CHECK (credential_id ~ '^[A-Za-z0-9_-]+$'),  -- unpadded base64url, as the browser sends it
  public_key    BYTEA NOT NULL CHECK (octet_length(public_key) > 0),          -- COSE public key, as bytes
  sign_count    BIGINT NOT NULL CHECK (sign_count >= 0),                      -- no DEFAULT on purpose; 0 means "this authenticator has no counter"
  transports    TEXT[],                                                       -- NULL = not reported; never defaulted to '{}'
  enrolled_via  TEXT NOT NULL CHECK (enrolled_via IN ('bootstrap', 'authenticated', 'invitation')),
  user_id       INTEGER NOT NULL REFERENCES users(id),                        -- no ON DELETE: users rows are never deleted
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one 'bootstrap' row, ever — the schema's half of the rule that registration is open only
-- while zero credentials exist. A count-then-insert is a read-modify-write with a window in it,
-- and under READ COMMITTED two concurrent unauthenticated registrations both read "zero" and both
-- enrol; neither sees the other's uninserted row and there is no row to lock. This index removes
-- the window instead of narrowing it: the second INSERT raises a unique violation however the
-- transactions interleave, and the handler returns the same refusal the count check produces.
--
-- It makes the RACE impossible, not the CHECK unnecessary: the database cannot tell whether a
-- request carried a valid session, so a handler that tags a session-less enrolment 'authenticated'
-- still enrols a stranger. Deleting the bootstrap credential legitimately re-opens the window.
CREATE UNIQUE INDEX IF NOT EXISTS webauthn_credentials_one_bootstrap
  ON webauthn_credentials(enrolled_via) WHERE enrolled_via = 'bootstrap';

-- One row per successful ceremony. The row IS the session: a cookie matching no row here is not a
-- session, and "no session" is never a reduced access level — this app has no guest or read-only
-- role for a cookie to fall back to.
--
-- token_hash is the SHA-256 of the cookie's token, NOT the token. The cookie value is a bearer
-- credential; stored verbatim, a database read, a CSV backup or a psql scrollback would each be a
-- live login. The CHECK makes that structural rather than advisory — the raw token is base64url
-- CSPRNG output and cannot satisfy a 64-character lowercase-hex pattern, so "just store the cookie
-- value" is a statement the database refuses. Same idiom as alert_sends.fingerprint.
--
-- credential_id is NOT NULL (every session is born from a completed ceremony, so the write order
-- is credential then session, one transaction) with ON DELETE CASCADE, because removing a retired
-- device's passkey is a direct database operation in v1 and a delete that left its sessions alive
-- would retire the key while leaving the door it opened propped. No ON UPDATE CASCADE, unlike the
-- accounts(id) references above: Plaid really does reissue an account_id, whereas a credential id
-- is the authenticator's own immutable identifier.
--
-- expires_at and revoked_at ARE TWO FACTS AND ARE NOT MERGEABLE. Implementing logout as
-- `SET expires_at = NOW()` needs no second column and is refused: it overwrites a fact about the
-- session's creation, it loses the distinction between "the owner signed out" and "the session
-- aged out" (all this row can ever say about itself, since no separate log exists), and it makes a
-- logout that does nothing indistinguishable from one that worked, since an untouched session
-- reaches the same state on its own a few hours later. expires_at is absolute and never extended
-- in place — a sliding expiry rewritten per request makes a stolen cookie immortal while it is
-- used. revoked_at NULL means NOT REVOKED, a stated departure from null-means-unknown (as
-- budget_categories.control_mode is): revocation is an event only this app can cause, so the
-- absence of a timestamp is knowledge, not ignorance.
--
-- THE ONLY PREDICATE THAT DECIDES WHETHER A REQUEST IS AUTHENTICATED, written here so it is not
-- re-derived at each call site with one conjunct missing:
--
--     SELECT 1 FROM auth_sessions
--      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()
--
-- All three conjuncts, always. `>` and not `>=` — expires_at is the first instant at which the
-- session is no longer valid, so the interval is half-open. And EVALUATED BY POSTGRES, NEVER IN
-- JAVASCRIPT: both columns are TIMESTAMPTZ, which `pg` yields as a Date inside a handler and which
-- becomes an ISO string across Response.json (the boundary P1-11's N4 caught once), so a JS
-- comparison works against one and misbehaves against the other — and introduces a second clock.
--
-- No index beyond the primary key: the hot read is by token_hash, and the expiry sweep and the
-- cascade both scan a table holding one row per sign-in on a single-user app.
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash    TEXT PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),  -- SHA-256 of the cookie's token, never the token
  credential_id TEXT NOT NULL REFERENCES webauthn_credentials(credential_id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,  -- absolute; never extended in place
  revoked_at    TIMESTAMPTZ,           -- NULL = not revoked, which here is knowledge rather than unknown
  -- Refuses a session born already dead — an inverted sign in the TTL arithmetic, or a TTL of
  -- zero. It fails closed rather than open, so this is not a security hole; it is the difference
  -- between "login succeeds and the next request 401s for no visible reason" and a named failure.
  CONSTRAINT auth_sessions_expires_after_created CHECK (expires_at > created_at),

  -- P1-12a: three kinds of session in one table. browser = cookie, 12h fixed; device = phone app,
  -- 30 days sliding; personal = a named script token minted over SSH. See lib/bearerAuth.ts.
  kind          TEXT NOT NULL DEFAULT 'browser'
                  CONSTRAINT auth_sessions_kind_check CHECK (kind IN ('browser', 'device', 'personal')),
  scope         TEXT NOT NULL DEFAULT 'full'
                  CONSTRAINT auth_sessions_scope_check CHECK (scope IN ('full', 'read')),
  label         TEXT
                  CONSTRAINT auth_sessions_label_length CHECK (label IS NULL OR length(label) BETWEEN 1 AND 60),
  last_used_at  TIMESTAMPTZ,

  CONSTRAINT auth_sessions_label_iff_personal CHECK ((kind = 'personal') = (label IS NOT NULL)),
  CONSTRAINT auth_sessions_read_scope_personal_only CHECK (scope = 'full' OR kind = 'personal'),
  CONSTRAINT auth_sessions_personal_lifetime
    CHECK (kind <> 'personal' OR expires_at <= created_at + INTERVAL '366 days')
);

-- ROADMAP.md §5 step 16. The gate between what the agent ASKS for and what happens.
--
-- A write tool returns a PROPOSAL, not an effect: the model records a row here and the change lands
-- only when a full-scope session POSTs to the decide endpoint. That separation is the one
-- mitigation that survives the model being fully persuaded by a prompt injection, because it does
-- not rely on the model at all (docs/agent-authorization.md §4).
--
-- This is the audit trail for agent-originated change — what §3's `mutation_audit_log` was deferred
-- for. It deliberately does NOT record mutations the owner makes directly in the UI; naming that
-- limit so the gap is visible rather than assumed covered.
CREATE TABLE IF NOT EXISTS agent_proposals (
  -- Opaque and CSPRNG, not a serial: this id travels to the browser and comes back as the thing
  -- being confirmed, and a guessable one would let anyone reaching the endpoint confirm a proposal
  -- they never saw.
  id TEXT PRIMARY KEY CONSTRAINT agent_proposals_id_format CHECK (id ~ '^[A-Za-z0-9_-]{22,64}$'),

  -- The list of effects the gate knows how to apply. Adding a write tool is a migration, which is
  -- the point — a new effect must not be reachable by a handler improvising on an unfamiliar string.
  kind TEXT NOT NULL CONSTRAINT agent_proposals_kind_check CHECK (kind IN ('categorize_transaction')),

  -- `transactions.id` for this kind. No foreign key on purpose: a proposal about a row since
  -- deleted must stay readable as history, and the apply path re-checks existence anyway.
  subject_id INTEGER NOT NULL,

  proposed JSONB NOT NULL,

  -- THE WORLD AS THE PROPOSAL ASSUMED IT. Optimistic concurrency, and the difference between a gate
  -- and a rubber stamp: if the owner edits the same transaction between seeing the card and
  -- confirming it, applying blind would silently undo that edit and perform a change they were
  -- never shown. Apply compares and refuses on mismatch.
  observed JSONB NOT NULL,

  -- Shown to the human verbatim. A confirmation with no reason is a button people learn to click.
  rationale TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Short by design: a proposal is a sentence in a conversation, not a standing instruction.
  expires_at TIMESTAMPTZ NOT NULL
    CONSTRAINT agent_proposals_expires_after_created CHECK (expires_at > created_at),

  -- NULL `decided_at` is the only definition of "pending", so the two can never disagree.
  decided_at TIMESTAMPTZ,
  decision TEXT CONSTRAINT agent_proposals_decision_check CHECK (decision IN ('confirmed', 'rejected')),
  CONSTRAINT agent_proposals_decision_iff_decided CHECK ((decided_at IS NULL) = (decision IS NULL)),

  -- Separate from `decision`, because a confirmed proposal can still fail to apply and "the owner
  -- said yes" and "the ledger changed" are different facts an audit trail must not conflate.
  applied BOOLEAN NOT NULL DEFAULT FALSE,
  failure_reason TEXT,
  CONSTRAINT agent_proposals_applied_only_when_confirmed CHECK (NOT applied OR decision = 'confirmed'),

  -- Which credential ASKED and which AGREED are different questions, and the design rests on them
  -- being allowed to differ: a read-only script may propose, only a full-scope session may confirm.
  proposed_by TEXT REFERENCES auth_sessions(token_hash) ON DELETE SET NULL,
  decided_by TEXT REFERENCES auth_sessions(token_hash) ON DELETE SET NULL,

  -- The PERSON behind those sessions (migration 1792300000000). A session row is pruned or cascaded
  -- away and SET NULL erases it; these survive, with no ON DELETE action, because users rows are
  -- never deleted. NULL means no person is known: a system-made proposal (the category suggester
  -- writes proposed_by NULL), or one whose session was already gone when the column was backfilled.
  -- NEVER the owner by default. The suggester keeps selecting on proposed_by IS NULL.
  proposed_by_user_id INTEGER REFERENCES users(id),
  decided_by_user_id INTEGER REFERENCES users(id),
  -- Naming a session means naming its person. One-directional: the session may go while the person
  -- stays. Refuses a writer that records the session and forgets the user.
  CONSTRAINT agent_proposals_proposer_has_user CHECK (proposed_by IS NULL OR proposed_by_user_id IS NOT NULL),
  CONSTRAINT agent_proposals_decider_has_user CHECK (decided_by IS NULL OR decided_by_user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS agent_proposals_pending
  ON agent_proposals (created_at DESC) WHERE decided_at IS NULL;

-- At most one pending proposal per subject: three cards for one transaction, two of which must
-- fail the `observed` check, reads to the owner as the feature being broken.
CREATE UNIQUE INDEX IF NOT EXISTS agent_proposals_one_pending_per_subject
  ON agent_proposals (kind, subject_id) WHERE decided_at IS NULL;

-- ROADMAP.md §5 Phase 3 step 25. Where to send a ping — and deliberately nothing about what is in it.
--
-- THE PAYLOAD DECISION IS RECORDED, NOT IMPLIED. `plan/tasks/P3-25-push-ping/DECISION.md` is the
-- BUILD.md §5.1 escalation that §5's outbound carve-out requires every time the destination changes,
-- and `alert_sends.kind` above already anticipated it: "the *message* kind, not the transport; a
-- second destination re-triggers the BUILD.md §5.1 escalation."
--
-- The owner chose a CONTENT-FREE ping: no category, no figure, no merchant, no balance. Push adds two
-- intermediaries email does not have — Expo's servers and Apple's APNs — and lands on a lock screen
-- readable without unlocking the phone. The value of push is the INTERRUPT; the figures still travel
-- only over the tailnet. So this table holds no financial data and must never grow a column that does.
CREATE TABLE IF NOT EXISTS push_devices (
  -- The ExpoPushToken. It ADDRESSES A DEVICE, which makes it credential-shaped: anyone holding it can
  -- make this owner's phone buzz. Primary key rather than a serial, because the token IS the identity
  -- and a second row for one device would send two pings for one event.
  token TEXT PRIMARY KEY
    CONSTRAINT push_devices_token_format CHECK (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$'),

  -- Which phone, in the owner's words. The same argument as `auth_sessions.label`: a list is how a
  -- device that should no longer be notified gets found.
  label TEXT
    CONSTRAINT push_devices_label_length CHECK (label IS NULL OR length(label) BETWEEN 1 AND 60),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Set on every accepted send: "is anything still listening on this token?", answerable before
  -- somebody revokes one.
  last_sent_at TIMESTAMPTZ,

  -- Expo's CLASSIFICATION of the last failure, never its message. A provider's rejection quotes the
  -- request back, and a table holding no financial data should not start holding it in an error
  -- string. Same reasoning as `alert_sends.failure_reason`.
  last_error TEXT
    CONSTRAINT push_devices_last_error_check CHECK (last_error IN ('unregistered', 'transport', 'rejected')),

  -- A lost phone is one UPDATE, like a revoked session. Kept rather than deleted, so what was
  -- registered survives the revocation.
  revoked_at TIMESTAMPTZ
);


-- Where an installed PWA is reached for the daily ping (§5 step 26b). A sibling of `push_devices`,
-- not a replacement: that table addresses the Expo app and this one a browser, and both send during
-- the changeover.
--
-- WHAT IS NOT STORED HERE IS THE POINT. A browser's PushSubscription also carries `p256dh` and
-- `auth` — the keys needed to ENCRYPT A PAYLOAD — and they are absent on purpose. This app sends no
-- payload: the ping's text is a constant the service worker already holds. Not storing those keys
-- makes the content-free decision structural rather than habitual, because the server cannot send
-- content it has nothing to encrypt with, and widening the payload would mean re-subscribing every
-- device.
CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  -- The push service's URL for this device. It ADDRESSES A DEVICE, which makes it
  -- credential-shaped in exactly the way `push_devices.token` is: anyone holding it can make this
  -- owner's phone buzz. Primary key rather than a serial, because the endpoint IS the identity and
  -- a second row for one device would send two pings for one event.
  --
  -- No format CHECK. `push_devices` can assert `^ExpoPushToken[...]$` because one vendor issues
  -- them; an endpoint is whatever Apple, Mozilla or Google chooses today, and a pattern here would
  -- reject a valid subscription the first time one of them changed a hostname. `https://` is the
  -- only thing true of all of them and the only thing asserted.
  endpoint TEXT PRIMARY KEY
    CONSTRAINT web_push_subscriptions_endpoint_https CHECK (endpoint LIKE 'https://%'),

  -- Which phone, in the owner's words. The same argument as `auth_sessions.label` and
  -- `push_devices.label`: a list is how a device that should no longer be notified gets found.
  label TEXT
    CONSTRAINT web_push_subscriptions_label_length CHECK (label IS NULL OR length(label) BETWEEN 1 AND 60),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Set on every accepted send: "is anything still listening here?", answerable before somebody
  -- revokes one.
  last_sent_at TIMESTAMPTZ,

  -- The CLASSIFICATION of the last failure, never the body of it. A push service's rejection quotes
  -- the request back, and a table holding no financial data should not start holding it in an error
  -- string. Same reasoning as `alert_sends.failure_reason` and `push_devices.last_error`.
  --
  -- 'gone' is Web Push's 404/410: the subscription is dead and will never work again, which is a
  -- different fact from a transport failure and is the one that should stop the retries.
  last_error TEXT
    CONSTRAINT web_push_subscriptions_last_error_check CHECK (last_error IN ('gone', 'transport', 'rejected')),

  -- A lost phone is one UPDATE, like a revoked session. Kept rather than deleted, so what was
  -- registered survives the revocation.
  revoked_at TIMESTAMPTZ,

  -- Whose device this is (migration 1792300000000). A push sent for a user reaches only that user's
  -- live subscriptions; re-registering an endpoint under another user's session moves it, so the row
  -- always has exactly one user. Existing rows were backfilled to the owner, except on a database with
  -- no credentials at all, where there was no owner to give them to and they were deleted rather than
  -- handed to whoever bootstraps next.
  user_id INTEGER NOT NULL REFERENCES users(id)
);

-- Serves the only read on the send path: every live subscription. Partial, because a revoked row is
-- never a send target and there is no query that wants one.
CREATE INDEX IF NOT EXISTS idx_web_push_live
  ON web_push_subscriptions(created_at) WHERE revoked_at IS NULL;

-- The send path's only read: every device still listening.
CREATE INDEX IF NOT EXISTS push_devices_active ON push_devices (created_at) WHERE revoked_at IS NULL;

-- ROADMAP.md §5 Phase 3, step 23's remaining piece: how the phone gets a real credential.
--
-- THE PROBLEM IS ONE THE AUTH DESIGN CREATED ON PURPOSE. `mayIssueDeviceToken` refuses to hand a
-- device token to anything carrying `Sec-Fetch-*` headers — a browser. So the browser can complete
-- the passkey ceremony and cannot receive the token; the app can receive the token and cannot do the
-- ceremony, because iOS passkeys are domain-bound and Apple's CDN cannot reach a tailnet-only host to
-- validate an associated domain. The browser therefore hands the app a short-lived single-use code,
-- and the app exchanges it from outside a browser, where it is allowed to.
--
-- The OAuth authorization-code shape, for the OAuth reason: a bearer token in a redirect URL ends up
-- in history and in anything logging between here and there, while a code useless once spent and
-- dead in a minute is worth little to whoever finds it.
CREATE TABLE IF NOT EXISTS device_handoffs (
  -- SHA-256 of the code, never the code — the rule `auth_sessions.token_hash` follows. The CHECK
  -- makes storing a raw code a statement Postgres refuses rather than a convention to remember.
  code_hash TEXT PRIMARY KEY
    CONSTRAINT device_handoffs_code_hash_format CHECK (code_hash ~ '^[0-9a-f]{64}$'),

  -- Which credential completed the ceremony; the device session inherits it, so the phone's session
  -- traces back to the passkey that authorised it rather than to a code from nowhere.
  credential_id TEXT NOT NULL REFERENCES webauthn_credentials(credential_id) ON DELETE CASCADE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Sixty seconds. The code is in flight between a browser redirect and one app request; longer is a
  -- window with no purpose, and the short expiry is most of what makes the redirect acceptable.
  expires_at TIMESTAMPTZ NOT NULL
    CONSTRAINT device_handoffs_expires_after_created CHECK (expires_at > created_at),

  -- Single use. A replay is refused on this column rather than on the clock, so a second claim inside
  -- the sixty seconds fails too — the distinction `agent_proposals.decided_at` draws between
  -- "already decided" and "expired".
  claimed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS device_handoffs_unclaimed
  ON device_handoffs (expires_at) WHERE claimed_at IS NULL;

-- ══ Gifts between the two people (migration 1792400000000, P7-41b) ═══════════════════════════
--
-- Placed after the authentication section because gifts reference users. Three tables, and no
-- existing column changed: a gift row's mapped_category means what it means on any other row, so
-- totals, budgets, year-end and P/L sum it exactly as if it had been filed by hand. Masking is a
-- question about who is looking, which no transactions column can answer, so it lives on the link
-- and the reveal date — never on mapped_category, hidden, or a stored "masked" flag.
--
-- THE MASKING PREDICATE, stated once. A transaction t is masked for viewer V exactly when
--
--     EXISTS (SELECT 1 FROM gift_transactions gt JOIN gifts g ON g.id = gt.gift_id
--              WHERE gt.transaction_id = t.id
--                AND g.reveal_date > CURRENT_DATE
--                AND g.giver_user_id IS DISTINCT FROM V)
--
-- evaluated by Postgres on its own calendar in the statement that reads the row; reveal is inclusive.
-- IS DISTINCT FROM makes a NULL viewer a non-giver, so the predicate fails closed with no special
-- case. Gift state is not a conjunct: a link row exists only while its gift holds the row.

-- Which category a matched gift is filed in. One row, ever (singleton PK + CHECK). By id, never by
-- name, so a rename does not break matching; a match is filed under the category's name at match
-- time. NULL = no category designated, and creating a gift is refused (GIFT_CATEGORY_UNSET). ON
-- DELETE SET NULL so a category delete behaves exactly as before; rows already linked stay linked and
-- masked where they are. Seeded once by the migration from the operational category of the owner's
-- gift name, NULL on a database without it; never designated by any route or UI.
CREATE TABLE IF NOT EXISTS gift_settings (
  singleton    BOOLEAN PRIMARY KEY DEFAULT TRUE
                 CONSTRAINT gift_settings_singleton CHECK (singleton),
  category_id  INTEGER REFERENCES budget_categories(id) ON DELETE SET NULL
);

-- One purchase marked in advance for the other person. Criteria are never edited (cancel and
-- re-create). NULL on any criterion means ANY, never 0 and never '': a 0 amount would match nothing
-- and a '' merchant would match everything, so both are refused here.
--   amount     — exact price, positive magnitude, NUMERIC(12,2) like transactions.amount; matched by
--                exact decimal equality against rows with amount > 0 only (money out). Never negated.
--   merchant   — case-insensitive LITERAL substring of merchant_name, or of name when merchant_name
--                is NULL. Stored trimmed (the CHECK refuses an untrimmed value; \x0B is vertical
--                tab), 3 to 200 characters.
--   account_id — narrows matching to one account. ON UPDATE CASCADE (reconciliation remaps ids in
--                place); no ON DELETE action, since SET NULL would widen "this card" to "any card".
--                That the account has a Plaid access token is the route's check at creation.
--   window_start / window_end — inclusive calendar DATEs on the server's calendar.
--   reveal_date — revealed when reveal_date <= CURRENT_DATE (Postgres, never a JS clock); not before
--                the window opens.
--   state      — awaiting (matching live) · choose (two or more candidates, all linked, filed and
--                masked until the giver picks; later arrivals added) · matched (final) · unmatched
--                (giver told nothing matched; no row linked) · cancelled (rows restored, unlinked).
--   notice_at  — when the giver was told; NULL = NOT TOLD (knowledge, as auth_sessions.revoked_at).
--                Set once by the daily sweep. 'unmatched' requires it.
--   created_at — also the tie-break when two gifts compete for one row: earlier gift, then lower id.
CREATE TABLE IF NOT EXISTS gifts (
  id                 SERIAL PRIMARY KEY,
  giver_user_id      INTEGER NOT NULL REFERENCES users(id),   -- no ON DELETE: users rows are never deleted
  recipient_user_id  INTEGER NOT NULL REFERENCES users(id),
  amount             NUMERIC(12, 2)
                       CONSTRAINT gifts_amount_positive CHECK (amount IS NULL OR amount > 0),
  merchant           TEXT
                       CONSTRAINT gifts_merchant_criterion CHECK (
                         merchant IS NULL
                         OR (merchant = btrim(merchant, E' \t\n\r\f\x0B')
                             AND char_length(merchant) BETWEEN 3 AND 200)),
  account_id         TEXT REFERENCES accounts(id) ON UPDATE CASCADE,
  window_start       DATE NOT NULL,
  window_end         DATE NOT NULL,
  reveal_date        DATE NOT NULL,
  state              TEXT NOT NULL DEFAULT 'awaiting'
                       CONSTRAINT gifts_state_check
                         CHECK (state IN ('awaiting', 'choose', 'matched', 'unmatched', 'cancelled')),
  notice_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gifts_giver_not_recipient CHECK (giver_user_id <> recipient_user_id),
  CONSTRAINT gifts_has_criterion CHECK (amount IS NOT NULL OR merchant IS NOT NULL),
  CONSTRAINT gifts_window_ordered CHECK (window_start <= window_end),
  CONSTRAINT gifts_reveal_not_before_window CHECK (reveal_date >= window_start),
  CONSTRAINT gifts_unmatched_was_told CHECK (state <> 'unmatched' OR notice_at IS NOT NULL)
);

-- Which ledger rows a gift holds RIGHT NOW: its matched row, or each candidate while 'choose'. A
-- rejected candidate, a released row and an expired gift's candidates are restored from the two
-- prior_ columns and unlinked in one transaction. Keyed on transactions.id, which neither
-- re-identification nor the re-key script ever changes (a Plaid-id key would break at both).
-- transaction_id is the PRIMARY KEY: one row, one gift, and a LEFT JOIN cannot duplicate a row or
-- inflate a sum. ON DELETE CASCADE from transactions, so a Plaid removal leaves no dangling link and
-- raises no error. prior_mapped_category NULL is a real value (the row was uncategorised) and
-- restores to NULL. prior_rule_applied has no DEFAULT: the linker read it. While linked, the row
-- itself holds rule_applied = FALSE so rule writes skip it.
CREATE TABLE IF NOT EXISTS gift_transactions (
  transaction_id         INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
  gift_id                INTEGER NOT NULL REFERENCES gifts(id),  -- no ON DELETE: gifts are never deleted
  prior_mapped_category  TEXT,
  prior_rule_applied     BOOLEAN NOT NULL,
  linked_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gift_transactions_gift ON gift_transactions (gift_id);

-- A receipt photographed before its charge exists, and the watch for that charge
-- (migrations/1792600000000_receipt-captures.sql has the argument). The owner confirms the charge
-- they expect; each sync looks for it. Exactly that amount links it and copies the photo to
-- transaction_receipts; the merchant's charge for a different amount is an alert; nothing in seven
-- days is an alert. Personal: only captured_by sees a capture, its alert and its push.
CREATE TABLE IF NOT EXISTS receipt_captures (
  id              SERIAL PRIMARY KEY,
  captured_by     INTEGER NOT NULL REFERENCES users(id),  -- no ON DELETE: users rows are never deleted
  captured_on     DATE NOT NULL,                          -- the phone's calendar day; the match window counts from it
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content_type    TEXT NOT NULL
                    CONSTRAINT receipt_captures_content_type CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  image           BYTEA NOT NULL
                    CONSTRAINT receipt_captures_image_size CHECK (octet_length(image) BETWEEN 1 AND 4194304),
  merchant        TEXT                                    -- as read, or as corrected
                    CONSTRAINT receipt_captures_merchant_length CHECK (merchant IS NULL OR char_length(merchant) BETWEEN 1 AND 200),
  read_total      NUMERIC(12, 2)                          -- what the model read; NULL when nothing could be
                    CONSTRAINT receipt_captures_read_total_positive CHECK (read_total IS NULL OR read_total > 0),
  expected_amount NUMERIC(12, 2)                          -- confirmed by the owner; positive is money out
                    CONSTRAINT receipt_captures_expected_positive CHECK (expected_amount IS NULL OR expected_amount > 0),
  state           TEXT NOT NULL DEFAULT 'draft'           -- draft, waiting, matched, mismatch, overdue, closed
                    CONSTRAINT receipt_captures_state_check
                      CHECK (state IN ('draft', 'waiting', 'matched', 'mismatch', 'overdue', 'closed')),
  state_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  transaction_id  INTEGER UNIQUE REFERENCES transactions(id) ON DELETE SET NULL,  -- one capture per charge
  charged_amount  NUMERIC(12, 2),                         -- the posted amount when linked
  rejected_ids    INTEGER[] NOT NULL DEFAULT '{}',        -- charges the owner said were not this one
  CONSTRAINT receipt_captures_confirmed_has_amount CHECK (state = 'draft' OR expected_amount IS NOT NULL),
  CONSTRAINT receipt_captures_link_has_charge CHECK (transaction_id IS NULL OR charged_amount IS NOT NULL),
  CONSTRAINT receipt_captures_linked_states_charged CHECK (state NOT IN ('matched', 'mismatch') OR charged_amount IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS receipt_captures_waiting ON receipt_captures (captured_on) WHERE state = 'waiting';
CREATE INDEX IF NOT EXISTS receipt_captures_by_person ON receipt_captures (captured_by, captured_at DESC);

-- ─── Loyalty (migrations/1792700000000_loyalty.sql has the argument; step 42a) ───────────────
-- A domain of its own beside the ledger, like properties: nothing in accounts, account_valuations
-- or net worth reads these tables, and no loyalty figure is ever summed into money. The catalog
-- seed (program names and aliases, public facts only) lives in the migration, not here.
-- Written as plain CREATE TABLE rather than IF NOT EXISTS so each reads as "CREATE TABLE <name> ",
-- the form the task's acceptance command looks for.
--
-- NO "CURRENT" COLUMN. A membership's current balance is derived on read from loyalty_observations:
-- greatest as_of, then greatest recorded_at, then greatest id, through the shared reducer in
-- apps/web/lib/domain/observations.ts. Never newest-by-arrival, never stored. No observation means
-- no current balance: NULL, rendered "—", never 0.
--
-- A person who can hold a membership. user_id NULL = not a b8 user (no access to anything); UNIQUE,
-- one member per user. Names unique ignoring case, because the import resolves a member by a
-- case-folded label suffix.
CREATE TABLE household_members (
  id            SERIAL PRIMARY KEY,
  display_name  TEXT NOT NULL                             -- stored trimmed
                  CONSTRAINT household_members_display_name_trimmed CHECK (
                    display_name = btrim(display_name, E' \t\n\r\f\x0B')
                    AND char_length(display_name) BETWEEN 1 AND 100),
  user_id       INTEGER UNIQUE REFERENCES users(id),    -- no ON DELETE: users rows are never deleted
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS household_members_display_name_ci ON household_members (lower(display_name));

-- The program catalog. default_unit is only what an unlabelled balance takes; each observation
-- carries its own unit. The import never creates a program.
CREATE TABLE loyalty_programs (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL
                  CONSTRAINT loyalty_programs_name_trimmed CHECK (
                    name = btrim(name, E' \t\n\r\f\x0B')
                    AND char_length(name) BETWEEN 1 AND 200),
  kind          TEXT NOT NULL
                  CONSTRAINT loyalty_programs_kind_check
                    CHECK (kind IN ('airline', 'hotel', 'card_currency', 'travel_cash', 'car', 'other')),
  default_unit  TEXT NOT NULL
                  CONSTRAINT loyalty_programs_default_unit_check
                    CHECK (default_unit IN ('points', 'miles', 'nights', 'usd')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The names a program is known by, stored ALREADY NORMALISED (trim; drop leading non-letters and
-- non-digits; remove parenthesised groups; case-fold; collapse whitespace; trim), because the import
-- matches a sheet label against them by exact equality and never fuzzily. UNIQUE across the whole
-- table: an alias can never name two programs. The CHECK refuses what normalisation cannot produce;
-- the leading-symbol rule is the application's alone.
CREATE TABLE loyalty_program_aliases (
  id          SERIAL PRIMARY KEY,
  program_id  INTEGER NOT NULL REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  alias       TEXT NOT NULL
                CONSTRAINT loyalty_program_aliases_alias_key UNIQUE
                CONSTRAINT loyalty_program_aliases_normalised CHECK (
                  char_length(alias) BETWEEN 1 AND 200
                  AND alias = btrim(alias)
                  AND alias = lower(alias)
                  AND position('  ' IN alias) = 0
                  AND alias !~ '[\t\n\r\f\v ]'
                  AND alias !~ '\(.*\)')
);

CREATE INDEX IF NOT EXISTS loyalty_program_aliases_program ON loyalty_program_aliases (program_id);

-- One member in one program; one row per pair (a duplicate is the route's 409, never a 500).
--   member_number   — FULL value, stored trimmed; emitted MASKED everywhere except the one copy
--                     route for a browser session. Never logged. NULL = none known (never '' or '-').
--   tier            — free text as the program names it; NULL = not known.
--   card_account_id — the credit card that earns into this membership (step 42b); NULL = no card
--                     linked, NOT "inherit". Type 'credit' is the PATCH route's check (a CHECK cannot
--                     read accounts). At most one membership per card (the unique index below).
--                     Unlinking sets only this column to NULL: instruments and benefit stay.
--   benefit_*       — the card's annual benefit, described once per link (migration
--                     1792800000000_loyalty_card_benefit): the instrument kind it issues, its
--                     description, and the window in days after the fee posts. All three NULL
--                     together (no benefit described) or all set. No column DEFAULT: the route
--                     writes the default window. Not tied to the card, so it survives an unlink.
--   earn_base_rate  — the earn description's base rate (step 42b-2, migration
--                     1792900000000_loyalty_earn_rules): units of the estimate's unit per one
--                     currency unit of spend no rule matches, zero to one hundred inclusive. NULL =
--                     no earn description stored (and then no loyalty_earn_rules rows), so the
--                     estimate is null, never zero. NOT an inheriting column. Kept across an unlink.
-- NO FEE, FEE DATE, EXPECTED-BY DATE OR STATE COLUMN. The annual fee is found in the ledger on
-- every read through the gift read path, and the state is derived from it, the instruments and
-- CURRENT_DATE; a stored copy would go stale the moment a row synced or was refunded.
-- NO EARN ESTIMATE, COMPARISON, MISS MARK, SPEND FIGURE OR PERIOD COLUMN, for the same reason: all
-- are derived on every read from the ledger, the rules, the readings and CURRENT_DATE.
CREATE TABLE loyalty_memberships (
  id               SERIAL PRIMARY KEY,
  member_id        INTEGER NOT NULL REFERENCES household_members(id),   -- no ON DELETE: nothing deletes members
  program_id       INTEGER NOT NULL REFERENCES loyalty_programs(id),    -- no ON DELETE: history must not cascade away
  member_number    TEXT
                     CONSTRAINT loyalty_memberships_member_number_trimmed CHECK (
                       member_number IS NULL
                       OR (member_number = btrim(member_number, E' \t\n\r\f\x0B')
                           AND char_length(member_number) BETWEEN 1 AND 64)),
  tier             TEXT
                     CONSTRAINT loyalty_memberships_tier_trimmed CHECK (
                       tier IS NULL
                       OR (tier = btrim(tier, E' \t\n\r\f\x0B')
                           AND char_length(tier) BETWEEN 1 AND 100)),
  card_account_id  TEXT REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Same four kinds as loyalty_instruments_kind_check: "received" matches an instrument of this kind.
  benefit_kind     TEXT
                     CONSTRAINT loyalty_memberships_benefit_kind_check
                       CHECK (benefit_kind IS NULL
                              OR benefit_kind IN ('free_night', 'companion_fare', 'travel_credit', 'other')),
  benefit_description TEXT                                -- stored trimmed, 1 to 200 characters
                     CONSTRAINT loyalty_memberships_benefit_description_trimmed
                       CHECK (benefit_description IS NULL
                              OR (benefit_description = btrim(benefit_description, E' \t\n\r\f\x0B')
                                  AND char_length(benefit_description) BETWEEN 1 AND 200)),
  benefit_window_days INTEGER                             -- calendar days after the fee's posted date
                     CONSTRAINT loyalty_memberships_benefit_window_range
                       CHECK (benefit_window_days IS NULL OR benefit_window_days BETWEEN 1 AND 365),
  earn_base_rate   NUMERIC(7, 4)                          -- NULL = no earn description; never float
                     CONSTRAINT loyalty_memberships_earn_base_rate_range
                       CHECK (earn_base_rate IS NULL OR earn_base_rate BETWEEN 0 AND 100),
  CONSTRAINT loyalty_memberships_member_program_key UNIQUE (member_id, program_id),
  CONSTRAINT loyalty_memberships_benefit_complete
    CHECK ((benefit_kind IS NULL) = (benefit_description IS NULL)
           AND (benefit_kind IS NULL) = (benefit_window_days IS NULL))
);

CREATE INDEX IF NOT EXISTS loyalty_memberships_program ON loyalty_memberships (program_id);
-- One card, one membership: one fee row must not open two expectations. A race is the route's 409
-- CARD_ALREADY_LINKED (23505), never a 500.
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_memberships_one_per_card
  ON loyalty_memberships (card_account_id) WHERE card_account_id IS NOT NULL;

-- The bonus rules of a membership's earn description (step 42b-2; the migration
-- 1792900000000_loyalty_earn_rules has the argument for a table over a JSON column). CONFIGURATION,
-- typed by a person: read in ascending position, and the first rule that matches a spend row decides
-- its rate; earn_base_rate prices the rest. The rules belong to the membership, not the card link,
-- so an unlink keeps them; ON DELETE CASCADE because a rule cannot outlive its membership.
--   match_kind — 'category': exact equality with mapped_category after trimming and case-folding
--                (never prefix, substring or pattern). 'merchant': a whole-word literal phrase in
--                name or merchant_name, case-folded and whitespace-collapsed.
--   match_text — stored trimmed, 1 to 100 characters; the merchant-only limits are the request
--                schema's. Compared literally, never as a pattern.
--   rate       — NUMERIC(7,4), zero to one hundred inclusive; zero earns nothing.
-- One rule per position, so the match order is total and a duplicate position is 23505.
CREATE TABLE loyalty_earn_rules (
  id             SERIAL PRIMARY KEY,
  membership_id  INTEGER NOT NULL REFERENCES loyalty_memberships(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  match_kind     TEXT NOT NULL
                   CONSTRAINT loyalty_earn_rules_match_kind_check
                     CHECK (match_kind IN ('category', 'merchant')),
  match_text     TEXT NOT NULL
                   CONSTRAINT loyalty_earn_rules_match_text_trimmed
                     CHECK (match_text = btrim(match_text, E' \t\n\r\f\x0B')
                            AND char_length(match_text) BETWEEN 1 AND 100),
  rate           NUMERIC(7, 4) NOT NULL
                   CONSTRAINT loyalty_earn_rules_rate_range CHECK (rate BETWEEN 0 AND 100),
  CONSTRAINT loyalty_earn_rules_membership_position_key UNIQUE (membership_id, position)
);

-- APPEND-ONLY balance readings: nothing updates or deletes a row; a correction is a newer row.
--   as_of   — the calendar date the reading is true for; routes refuse one more than a day past
--             CURRENT_DATE.
--   balance — NUMERIC, never float, non-negative (zero is a real reading), under 13 integer digits.
--             One spelling per value: whole units (points, miles, nights) at scale 0, usd at scale
--             exactly 2, so balance::text is already the emitted form and nothing rounds it. No
--             typmod, which would force two decimals onto points.
--   source  — typed (the only one a request may send) · import · email (42c) · screenshot (42d).
--   recorded_at — arrival; the newest-wins order's SECOND key, never the first.
CREATE TABLE loyalty_observations (
  id             SERIAL PRIMARY KEY,
  membership_id  INTEGER NOT NULL REFERENCES loyalty_memberships(id),  -- no ON DELETE: history is kept
  as_of          DATE NOT NULL,
  balance        NUMERIC NOT NULL
                   CONSTRAINT loyalty_observations_balance_range CHECK (balance >= 0 AND balance < 1e12),
  unit           TEXT NOT NULL
                   CONSTRAINT loyalty_observations_unit_check
                     CHECK (unit IN ('points', 'miles', 'nights', 'usd')),
  source         TEXT NOT NULL
                   CONSTRAINT loyalty_observations_source_check
                     CHECK (source IN ('typed', 'import', 'email', 'screenshot')),
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT loyalty_observations_unit_scale CHECK (
    (unit = 'usd' AND scale(balance) = 2)
    OR (unit <> 'usd' AND scale(balance) = 0))
);

CREATE INDEX IF NOT EXISTS loyalty_observations_newest
  ON loyalty_observations (membership_id, as_of DESC, recorded_at DESC, id DESC);
-- One imported reading per membership and date: keeps the import idempotent under any interleaving.
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_observations_one_import_per_day
  ON loyalty_observations (membership_id, as_of) WHERE source = 'import';

-- Certificates, companion fares, travel credits. Every date NULL = unknown; a NULL expiry sorts last.
CREATE TABLE loyalty_instruments (
  id             SERIAL PRIMARY KEY,
  membership_id  INTEGER NOT NULL REFERENCES loyalty_memberships(id),
  kind           TEXT NOT NULL
                   CONSTRAINT loyalty_instruments_kind_check
                     CHECK (kind IN ('free_night', 'companion_fare', 'travel_credit', 'other')),
  description    TEXT NOT NULL                          -- not blank, at most 200 characters
                   CONSTRAINT loyalty_instruments_description_length CHECK (
                     char_length(btrim(description, E' \t\n\r\f\x0B')) >= 1
                     AND char_length(description) <= 200),
  issued_on      DATE,
  expires_on     DATE,
  used_on        DATE,
  source         TEXT NOT NULL
                   CONSTRAINT loyalty_instruments_source_check CHECK (source IN ('typed', 'import')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT loyalty_instruments_expires_not_before_issued
    CHECK (issued_on IS NULL OR expires_on IS NULL OR expires_on >= issued_on),
  CONSTRAINT loyalty_instruments_used_not_before_issued
    CHECK (issued_on IS NULL OR used_on IS NULL OR used_on >= issued_on)
);

CREATE INDEX IF NOT EXISTS loyalty_instruments_membership ON loyalty_instruments (membership_id);
-- One imported instrument per membership: a second import run creates none.
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_instruments_one_import
  ON loyalty_instruments (membership_id) WHERE source = 'import';

-- ─── Loyalty inbox (step 42c, migration 1793000000000_loyalty_inbox) ─────────────────────────
-- Forwarded loyalty mail from a dedicated mailbox polled read-only. Two configuration tables
-- (the sender allowlist and the members' forwarding addresses) and three the poller writes (kept
-- raw mail, counted unknown senders, the last poll). NOTHING DERIVED FROM A MESSAGE IS STORED
-- except sender_domain, origin, attribution, member_id, received_on, the dedupe hash and the raw
-- bytes: no subject, sender local part or address, recipient, snippet, parsed text or extracted
-- value. Mail and unknown rows are kept 30 days by received_on (strictly older is purged); the
-- configuration, the state row and the two durable dates are never purged. Dates are compared with
-- CURRENT_DATE in SQL. Hostname shape below: lower-case ASCII letters, digits and hyphens, two or
-- more labels of 1 to 63 characters not starting or ending with a hyphen, at most 253 characters.
-- The application refuses more on input (shared mail providers, shared multi-label suffixes).

-- The allowlist. A sender matches a domain it equals or is a dot-subdomain of; the longest stored
-- domain wins. UNIQUE across programs (a taken domain is the route's 409 DOMAIN_TAKEN). The final
-- label must be 2 to 24 letters or xn-- punycode, so no IP literal can be trusted.
--   last_seen_on — received_on of the newest stored message this domain decided; NULL = no mail seen
--                  yet. MONOTONE (only moves forward) and durable (outlives the mail it observed).
-- Seeded by the migration with every catalog program's public mail domain, a starting point.
CREATE TABLE loyalty_sender_domains (
  id            SERIAL PRIMARY KEY,
  program_id    INTEGER NOT NULL REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  domain        TEXT NOT NULL
                  CONSTRAINT loyalty_sender_domains_domain_key UNIQUE
                  CONSTRAINT loyalty_sender_domains_domain_shape CHECK (
                    char_length(domain) <= 253
                    AND domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,24}|xn--[a-z0-9-]{0,58}[a-z0-9])$'),
  last_seen_on  DATE
);

CREATE INDEX IF NOT EXISTS loyalty_sender_domains_program ON loyalty_sender_domains (program_id);

-- Where each household member forwards from. Compared exactly, case-folded: stored lower-case, no
-- plus-tag or dot normalisation, no display name. UNIQUE across members (409 ADDRESS_TAKEN).
--   added_on         — registration day; with no mail yet, quiet days count from the earliest one.
--   last_received_on — received_on of the newest message ATTRIBUTED to this member through this
--                      address; NULL = none yet. Unattributed mail never sets it. MONOTONE, durable.
CREATE TABLE household_member_addresses (
  id                SERIAL PRIMARY KEY,
  member_id         INTEGER NOT NULL REFERENCES household_members(id) ON DELETE CASCADE,
  address           TEXT NOT NULL
                      CONSTRAINT household_member_addresses_address_key UNIQUE
                      CONSTRAINT household_member_addresses_address_shape CHECK (
                        char_length(address) <= 254
                        AND address ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]{1,64}@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  added_on          DATE NOT NULL DEFAULT CURRENT_DATE,
  last_received_on  DATE
);

CREATE INDEX IF NOT EXISTS household_member_addresses_member ON household_member_addresses (member_id);

-- Kept mail. raw_mail is the RFC 822 bytes; no route, page or log returns them.
--   dedupe_key    — lower-case hex SHA-256 of the outer Message-ID (brackets and whitespace removed),
--                   or of 'raw:' plus the bytes when there is none. Shared key space with
--                   loyalty_inbox_unknown_senders: a key in either table is a duplicate (the
--                   poller's check across tables; this UNIQUE within one).
--   received_on   — UTC date of the server's received time (INTERNALDATE), never the Date header.
--   program_id    — the program whose domain matched. No ON DELETE: mail must not cascade away.
--   sender_domain — the original sender's domain only, hostname shape.
--   origin        — direct (outer From) · attachment (message/rfc822 part) · inline (forward
--                   marker); the last two only from a registered member address.
--   attribution   — matched · unmatched · none_found · ambiguous. Only matched sets member_id, and a
--                   matched row is never re-attributed.
--   member_id     — NULL = attributed to nobody. NOT an inheriting column.
--   raw_mail      — NULL exactly when oversize (over LOYALTY_INBOX_MAX_BYTES, recorded, never fetched).
CREATE TABLE loyalty_inbox_messages (
  id             SERIAL PRIMARY KEY,
  dedupe_key     TEXT NOT NULL
                   CONSTRAINT loyalty_inbox_messages_dedupe_key_key UNIQUE
                   CONSTRAINT loyalty_inbox_messages_dedupe_key_shape CHECK (dedupe_key ~ '^[0-9a-f]{64}$'),
  received_on    DATE NOT NULL,
  stored_on      DATE NOT NULL DEFAULT CURRENT_DATE,
  program_id     INTEGER NOT NULL REFERENCES loyalty_programs(id),
  sender_domain  TEXT NOT NULL
                   CONSTRAINT loyalty_inbox_messages_sender_domain_shape CHECK (
                     char_length(sender_domain) <= 253
                     AND sender_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  origin         TEXT NOT NULL
                   CONSTRAINT loyalty_inbox_messages_origin_check
                     CHECK (origin IN ('direct', 'attachment', 'inline')),
  attribution    TEXT NOT NULL
                   CONSTRAINT loyalty_inbox_messages_attribution_check
                     CHECK (attribution IN ('matched', 'unmatched', 'none_found', 'ambiguous')),
  member_id      INTEGER REFERENCES household_members(id),
  raw_mail       BYTEA,
  oversize       BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT loyalty_inbox_messages_member_iff_matched
    CHECK ((attribution = 'matched') = (member_id IS NOT NULL)),
  CONSTRAINT loyalty_inbox_messages_bytes_iff_not_oversize
    CHECK ((raw_mail IS NULL) = oversize)
);

CREATE INDEX IF NOT EXISTS loyalty_inbox_messages_received ON loyalty_inbox_messages (received_on);
CREATE INDEX IF NOT EXISTS loyalty_inbox_messages_program ON loyalty_inbox_messages (program_id, received_on);

-- Mail from senders nobody allowlisted: counted, never downloaded, never kept. The hash keeps the
-- count idempotent across re-polls; domain is a hostname or the exact sentinel '(unreadable)', so
-- no attacker-chosen text is stored.
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

CREATE INDEX IF NOT EXISTS loyalty_inbox_unknown_senders_received ON loyalty_inbox_unknown_senders (received_on);

-- The last poll: exactly one row (id 1, seeded by the migration). All NULL = never polled ("Not
-- checked yet"). last_error_code is a classified code only, never library text or a credential,
-- and is set exactly when last_outcome is error. A disabled or already-running poll writes nothing.
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

-- ─── Loyalty inbox reading (step 42c, migration 1793100000000_loyalty_inbox_read) ────────────
-- What Claude read from each stored message, as a PROPOSAL. The current balance is still only the
-- newest loyalty_observations row; a reading reaches it solely by an appended 'email' observation,
-- written in the same transaction that marks the reads row applied or applied_by_hand. Nothing
-- free-text from the model or the mail is stored: text columns hold enums or a 3 or 4 character
-- suffix, the JSONB arrays hold fixed-key objects of enums, dates and canonical decimal text.
-- Reads rows are kept 400 days by received_on (strictly older is purged, pending included), so
-- they outlive the raw mail's thirty; the not-mine list and the state row are never purged.

-- One row per attempted message. States:
--   retry, failed    — not read yet: attempts and last_error_code set, nothing extracted. The
--                      attempt is written before the model call as the outcome it would be on a
--                      crash (retry, or failed on the third attempt, provisional code api_error).
--   pending          — queued for a human, with a reason.
--   applied          — every rule held; observation_id is the appended 'email' observation.
--   stale, no_balance, not_mine_known — settled by the rules, never queued, nothing appended.
--   applied_by_hand, not_mine, ignored — resolved by a person from pending; reason is KEPT.
--   dedupe_key    — the 42c1 message key; deliberately NOT a foreign key (the message is purged first).
--   suffix        — at most the last 4 printed letters or digits, upper-case; the only number fragment.
--   balance, unit — the proposal, same single spelling as loyalty_observations (scale 0 for whole
--                   units, exactly 2 for usd); NULL together = no usable balance, never zero.
--   as_of         — NULL = the mail gave no date.
--   program_check — the model's program name reduced to match, mismatch or not_stated, then dropped.
--   membership_id — the unique suffix match, or the membership a person chose; NOT inheriting.
-- The CHECKs below make a row that contradicts its state unstorable.
CREATE TABLE loyalty_inbox_reads (
  id               SERIAL PRIMARY KEY,
  dedupe_key       TEXT NOT NULL
                     CONSTRAINT loyalty_inbox_reads_dedupe_key_key UNIQUE
                     CONSTRAINT loyalty_inbox_reads_dedupe_key_shape CHECK (dedupe_key ~ '^[0-9a-f]{64}$'),
  program_id       INTEGER NOT NULL REFERENCES loyalty_programs(id),
  received_on      DATE NOT NULL,
  state            TEXT NOT NULL
                     CONSTRAINT loyalty_inbox_reads_state_check
                       CHECK (state IN ('retry', 'failed', 'pending', 'applied', 'applied_by_hand',
                                        'stale', 'no_balance', 'not_mine_known', 'not_mine', 'ignored')),
  attempts         SMALLINT NOT NULL
                     CONSTRAINT loyalty_inbox_reads_attempts_range CHECK (attempts BETWEEN 0 AND 3),
  last_error_code  TEXT
                     CONSTRAINT loyalty_inbox_reads_last_error_code_check
                       CHECK (last_error_code IS NULL
                              OR last_error_code IN ('rate_limited', 'timeout', 'api_error', 'refused',
                                                     'bad_output', 'empty_message')),
  reason           TEXT
                     CONSTRAINT loyalty_inbox_reads_reason_check
                       CHECK (reason IS NULL
                              OR reason IN ('no_suffix', 'unmatched_suffix', 'ambiguous_suffix',
                                            'program_mismatch', 'unit_mismatch', 'no_as_of',
                                            'as_of_future', 'no_baseline', 'implausible_jump')),
  suffix           TEXT
                     CONSTRAINT loyalty_inbox_reads_suffix_shape CHECK (suffix IS NULL OR suffix ~ '^[A-Z0-9]{3,4}$'),
  balance          NUMERIC
                     CONSTRAINT loyalty_inbox_reads_balance_range CHECK (balance >= 0 AND balance < 1e12),
  unit             TEXT
                     CONSTRAINT loyalty_inbox_reads_unit_check
                       CHECK (unit IS NULL OR unit IN ('points', 'miles', 'nights', 'usd')),
  as_of            DATE,
  program_check    TEXT
                     CONSTRAINT loyalty_inbox_reads_program_check_check
                       CHECK (program_check IS NULL OR program_check IN ('match', 'mismatch', 'not_stated')),
  membership_id    INTEGER REFERENCES loyalty_memberships(id),
  observation_id   INTEGER REFERENCES loyalty_observations(id),
  -- At most 5 of {what, expiresOn, amount}; amount NULL or canonical in the scale of what, always
  -- NULL for status and other. Displayed only (42g evaluates nothing yet).
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
  -- At most 10 of {kind, expiresOn}; kind is a loyalty_instruments kind, expiresOn NULL = none
  -- stated. Displayed only: never turned into a loyalty_instruments row.
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
  read_on          DATE,                                  -- NULL exactly while unread
  resolved_on      DATE,                                  -- NULL exactly while retry, failed or pending
  CONSTRAINT loyalty_inbox_reads_balance_with_unit
    CHECK ((balance IS NULL) = (unit IS NULL)),
  CONSTRAINT loyalty_inbox_reads_unit_scale
    CHECK (balance IS NULL
           OR (unit = 'usd' AND scale(balance) = 2)
           OR (unit <> 'usd' AND scale(balance) = 0)),
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
  CONSTRAINT loyalty_inbox_reads_read_is_checked_and_dated
    CHECK (state IN ('retry', 'failed') OR (program_check IS NOT NULL AND read_on IS NOT NULL)),
  CONSTRAINT loyalty_inbox_reads_resolved_iff_settled
    CHECK ((resolved_on IS NULL) = (state IN ('retry', 'failed', 'pending'))),
  CONSTRAINT loyalty_inbox_reads_resolved_not_before_read
    CHECK (resolved_on IS NULL OR read_on IS NULL OR resolved_on >= read_on),
  CONSTRAINT loyalty_inbox_reads_reason_iff_queued
    CHECK ((reason IS NOT NULL) = (state IN ('pending', 'applied_by_hand', 'not_mine', 'ignored'))),
  CONSTRAINT loyalty_inbox_reads_balance_iff_reading_had_one
    CHECK ((balance IS NULL) = (state IN ('retry', 'failed', 'no_balance'))),
  CONSTRAINT loyalty_inbox_reads_applied_complete
    CHECK (state NOT IN ('applied', 'applied_by_hand')
           OR (membership_id IS NOT NULL AND observation_id IS NOT NULL)),
  CONSTRAINT loyalty_inbox_reads_observation_only_when_applied
    CHECK (observation_id IS NULL OR state IN ('applied', 'applied_by_hand')),
  CONSTRAINT loyalty_inbox_reads_rules_passed
    CHECK (state NOT IN ('applied', 'stale') OR (suffix IS NOT NULL AND as_of IS NOT NULL)),
  CONSTRAINT loyalty_inbox_reads_not_mine_known_unmatched
    CHECK (state <> 'not_mine_known' OR (suffix IS NOT NULL AND membership_id IS NULL)),
  CONSTRAINT loyalty_inbox_reads_mismatch_queues
    CHECK (program_check IS DISTINCT FROM 'mismatch'
           OR state = 'no_balance'
           OR reason IS NOT DISTINCT FROM 'program_mismatch'),
  CONSTRAINT loyalty_inbox_reads_mismatch_reason_is_mismatch
    CHECK (reason IS DISTINCT FROM 'program_mismatch' OR program_check IS NOT DISTINCT FROM 'mismatch'),
  CONSTRAINT loyalty_inbox_reads_mismatch_no_balance_unmatched
    CHECK (NOT (state = 'no_balance' AND program_check IS NOT DISTINCT FROM 'mismatch' AND membership_id IS NOT NULL)),
  CONSTRAINT loyalty_inbox_reads_reason_suffix
    CHECK ((reason IS DISTINCT FROM 'no_suffix' OR suffix IS NULL)
           AND (reason IS NULL OR reason IN ('no_suffix', 'program_mismatch') OR suffix IS NOT NULL)),
  CONSTRAINT loyalty_inbox_reads_reason_as_of
    CHECK ((reason IS DISTINCT FROM 'no_as_of' OR as_of IS NULL)
           AND (reason IS NULL OR reason NOT IN ('as_of_future', 'no_baseline', 'implausible_jump') OR as_of IS NOT NULL)),
  CONSTRAINT loyalty_inbox_reads_pending_membership
    CHECK (state <> 'pending'
           OR reason = 'program_mismatch'
           OR (reason IN ('no_suffix', 'unmatched_suffix', 'ambiguous_suffix') AND membership_id IS NULL)
           OR (reason IN ('unit_mismatch', 'no_as_of', 'as_of_future', 'no_baseline', 'implausible_jump')
               AND membership_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS loyalty_inbox_reads_received ON loyalty_inbox_reads (received_on);
CREATE INDEX IF NOT EXISTS loyalty_inbox_reads_program ON loyalty_inbox_reads (program_id, received_on);
CREATE INDEX IF NOT EXISTS loyalty_inbox_reads_membership ON loyalty_inbox_reads (membership_id) WHERE membership_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS loyalty_inbox_reads_pending ON loyalty_inbox_reads (received_on DESC, id DESC) WHERE state = 'pending';

-- (program, suffix) pairs the household disowned. Suppresses a later reading only while the suffix
-- matches NO membership of the program. Never purged.
CREATE TABLE loyalty_inbox_not_mine (
  id          SERIAL PRIMARY KEY,
  program_id  INTEGER NOT NULL REFERENCES loyalty_programs(id),
  suffix      TEXT NOT NULL
                CONSTRAINT loyalty_inbox_not_mine_suffix_shape CHECK (suffix ~ '^[A-Z0-9]{3,4}$'),
  added_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  CONSTRAINT loyalty_inbox_not_mine_program_suffix_key UNIQUE (program_id, suffix)
);

-- The last read run: exactly one row (id 1, seeded by the migration). All NULL = never read ("Not
-- read yet"). last_error_code is a run code, set exactly when last_outcome is error. A disabled or
-- already-running run writes nothing.
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

-- ─── Hotel stays (step 42e, migration 1793200000000_loyalty_stays) ──────────────────────────
-- Hotel confirmations, changes and cancellations from the loyalty inbox, read by a SECOND,
-- separate booking read, become stays; a typed route adds or corrects one by hand. The balance read
-- and its tables are untouched: a message may have a row in both loyalty_inbox_reads and
-- loyalty_inbox_booking_reads, and neither read consults the other's row. A stay is NEVER deleted
-- (a cancellation sets state, keeping the row, its dates and its code) and nothing here cascades.
-- "Nights this year" is not stored anywhere: it is summed on every read from CURRENT_DATE. No CHECK
-- compares a column with CURRENT_DATE.

-- The referenced key of loyalty_stays' composite foreign key. id is already unique, so this index
-- refuses nothing; it exists so a stay cannot sit under a membership of another program.
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_memberships_id_program_key ON loyalty_memberships (id, program_id);

-- One row per hotel booking, keyed by program and normalised confirmation code.
--   confirmation_code    — letters and digits only, upper-cased, 4 to 20; stored in full because it
--                          is the dedupe key, masked in every payload, never logged.
--   nights               — GENERATED from the two dates and written by nobody; it cannot go stale.
--                          Stored only so the 1..60 bound (LOYALTY_STAY_MAX_NIGHTS) is a CHECK.
--   property             — the one model free-text value: trimmed, 1 to 80, no '<', '>' or control
--                          character. NULL = not stated, never ''.
--   source               — typed (the typed route last wrote it) or email (a mail last decided it).
--   evidence_received_on — received date of the mail that last decided the stay; NULL = never
--                          touched by mail. A typed write KEEPS it, so only a strictly later mail can
--                          supersede a typed correction (SPEC.md D8).
--   evidence_key         — that mail's dedupe_key; NOT a foreign key (the mail is purged first).
--   award                — true points or certificate, false cash, NULL not stated (never false).
--   membership_id        — the first attribution is sticky; the composite key pins its program.
CREATE TABLE loyalty_stays (
  id                    SERIAL PRIMARY KEY,
  membership_id         INTEGER NOT NULL,
  program_id            INTEGER NOT NULL REFERENCES loyalty_programs(id),
  confirmation_code     TEXT NOT NULL
                          CONSTRAINT loyalty_stays_confirmation_code_shape
                            CHECK (confirmation_code ~ '^[A-Z0-9]{4,20}$'),
  check_in              DATE NOT NULL,
  check_out             DATE NOT NULL,
  nights                INTEGER GENERATED ALWAYS AS (check_out - check_in) STORED,
  property              TEXT
                          CONSTRAINT loyalty_stays_property_shape
                            CHECK (property IS NULL
                                   OR (property = btrim(property)
                                       AND char_length(property) BETWEEN 1 AND 80
                                       AND property !~ '[<>[:cntrl:]]')),
  state                 TEXT NOT NULL
                          CONSTRAINT loyalty_stays_state_check CHECK (state IN ('booked', 'cancelled')),
  source                TEXT NOT NULL
                          CONSTRAINT loyalty_stays_source_check CHECK (source IN ('typed', 'email')),
  evidence_key          TEXT
                          CONSTRAINT loyalty_stays_evidence_key_shape
                            CHECK (evidence_key IS NULL OR evidence_key ~ '^[0-9a-f]{64}$'),
  evidence_received_on  DATE,
  award                 BOOLEAN,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT loyalty_stays_program_code_key UNIQUE (program_id, confirmation_code),
  CONSTRAINT loyalty_stays_nights_range CHECK (nights BETWEEN 1 AND 60),
  CONSTRAINT loyalty_stays_evidence_pair
    CHECK ((evidence_key IS NULL) = (evidence_received_on IS NULL)),
  CONSTRAINT loyalty_stays_email_has_evidence
    CHECK (source <> 'email' OR evidence_key IS NOT NULL),
  CONSTRAINT loyalty_stays_membership_program_fkey
    FOREIGN KEY (membership_id, program_id) REFERENCES loyalty_memberships (id, program_id)
);

CREATE INDEX IF NOT EXISTS loyalty_stays_membership_check_out ON loyalty_stays (membership_id, check_out);

-- One row per stored hotel-program message the booking read attempted; a mirror of
-- loyalty_inbox_reads with the same crash-safe attempt row (counted before the model call), no
-- balance, and the cleaned booking held only while a person has not decided. States:
--   retry, failed  — not read yet: attempts and last_error_code set, nothing else.
--   none, flight   — the kind said so; nothing extracted (flight rows are 42e1b's to re-read).
--   no_booking     — a hotel kind with no valid code or unusable dates; nothing stored.
--   stale          — older than what the stay already reflects; nothing changed.
--   recorded       — placed by the rules; stay_id is the stay written or updated.
--   not_mine_known — an unmatched suffix on loyalty_inbox_not_mine; discarded.
--   pending        — HELD for one tap; reason set, booking set.
--   placed_by_hand, not_mine, ignored — resolved by a person; reason KEPT, booking cleared.
--   dedupe_key    — the 42c1 message key; NOT a foreign key (the message is purged first).
--   booking       — exactly {kind, property, checkIn, checkOut, code, award}; NOT NULL exactly while
--                   pending. No other key can be stored.
--   membership_id — the membership the booking was placed on; NOT inheriting.
--   stay_id       — always for recorded; for placed_by_hand when the tap wrote or updated a stay.
-- Purged by received_on strictly older than LOYALTY_READ_RETENTION_DAYS, pending included; stays
-- are never purged.
CREATE TABLE loyalty_inbox_booking_reads (
  id               SERIAL PRIMARY KEY,
  dedupe_key       TEXT NOT NULL
                     CONSTRAINT loyalty_inbox_booking_reads_dedupe_key_key UNIQUE
                     CONSTRAINT loyalty_inbox_booking_reads_dedupe_key_shape CHECK (dedupe_key ~ '^[0-9a-f]{64}$'),
  program_id       INTEGER NOT NULL REFERENCES loyalty_programs(id),
  received_on      DATE NOT NULL,
  state            TEXT NOT NULL
                     CONSTRAINT loyalty_inbox_booking_reads_state_check
                       CHECK (state IN ('retry', 'failed', 'none', 'flight', 'no_booking', 'stale',
                                        'recorded', 'pending', 'placed_by_hand', 'not_mine_known',
                                        'not_mine', 'ignored')),
  attempts         SMALLINT NOT NULL
                     CONSTRAINT loyalty_inbox_booking_reads_attempts_range CHECK (attempts BETWEEN 0 AND 3),
  last_error_code  TEXT
                     CONSTRAINT loyalty_inbox_booking_reads_last_error_code_check
                       CHECK (last_error_code IS NULL
                              OR last_error_code IN ('rate_limited', 'timeout', 'api_error', 'refused',
                                                     'bad_output', 'empty_message')),
  kind             TEXT
                     CONSTRAINT loyalty_inbox_booking_reads_kind_check
                       CHECK (kind IS NULL OR kind IN ('hotel_booked', 'hotel_cancelled', 'flight', 'none')),
  program_check    TEXT
                     CONSTRAINT loyalty_inbox_booking_reads_program_check_check
                       CHECK (program_check IS NULL OR program_check IN ('match', 'mismatch', 'not_stated')),
  reason           TEXT
                     CONSTRAINT loyalty_inbox_booking_reads_reason_check
                       CHECK (reason IS NULL
                              OR reason IN ('no_suffix', 'unmatched_suffix', 'ambiguous_suffix',
                                            'forwarder_conflict', 'program_mismatch')),
  suffix           TEXT
                     CONSTRAINT loyalty_inbox_booking_reads_suffix_shape CHECK (suffix IS NULL OR suffix ~ '^[A-Z0-9]{3,4}$'),
  -- CASE, not AND: the path tests must never run on a non-object.
  booking          JSONB
                     CONSTRAINT loyalty_inbox_booking_reads_booking_shape CHECK (
                       booking IS NULL
                       OR CASE WHEN jsonb_typeof(booking) = 'object' THEN
                           booking ?& ARRAY['kind', 'property', 'checkIn', 'checkOut', 'code', 'award']
                           AND NOT jsonb_path_exists(booking,
                             '$.keyvalue() ? (!(@.key == "kind" || @.key == "property" || @.key == "checkIn" || @.key == "checkOut" || @.key == "code" || @.key == "award"))')
                           AND jsonb_path_exists(booking,
                             '$ ? (@.kind.type() == "string" && (@.kind == "hotel_booked" || @.kind == "hotel_cancelled"))')
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
  membership_id    INTEGER REFERENCES loyalty_memberships(id),
  stay_id          INTEGER REFERENCES loyalty_stays(id),
  read_on          DATE,                                  -- NULL exactly while unread
  resolved_on      DATE,                                  -- NULL exactly while retry, failed or pending
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
  CONSTRAINT loyalty_inbox_booking_reads_read_is_checked_and_dated
    CHECK (state IN ('retry', 'failed') OR (program_check IS NOT NULL AND read_on IS NOT NULL)),
  CONSTRAINT loyalty_inbox_booking_reads_resolved_iff_settled
    CHECK ((resolved_on IS NULL) = (state IN ('retry', 'failed', 'pending'))),
  CONSTRAINT loyalty_inbox_booking_reads_resolved_not_before_read
    CHECK (resolved_on IS NULL OR read_on IS NULL OR resolved_on >= read_on),
  CONSTRAINT loyalty_inbox_booking_reads_flight_state
    CHECK ((state = 'flight') = (kind IS NOT DISTINCT FROM 'flight')),
  CONSTRAINT loyalty_inbox_booking_reads_none_state
    CHECK ((state = 'none') = (kind IS NOT DISTINCT FROM 'none')),
  CONSTRAINT loyalty_inbox_booking_reads_non_booking_holds_nothing
    CHECK (state NOT IN ('none', 'flight')
           OR (suffix IS NULL AND membership_id IS NULL AND stay_id IS NULL)),
  CONSTRAINT loyalty_inbox_booking_reads_reason_iff_held
    CHECK ((reason IS NOT NULL) = (state IN ('pending', 'placed_by_hand', 'not_mine', 'ignored'))),
  CONSTRAINT loyalty_inbox_booking_reads_booking_iff_pending
    CHECK ((booking IS NOT NULL) = (state = 'pending')),
  CONSTRAINT loyalty_inbox_booking_reads_pending_unplaced
    CHECK (state <> 'pending' OR (membership_id IS NULL AND stay_id IS NULL)),
  CONSTRAINT loyalty_inbox_booking_reads_recorded_has_stay
    CHECK (state <> 'recorded' OR (stay_id IS NOT NULL AND membership_id IS NOT NULL)),
  CONSTRAINT loyalty_inbox_booking_reads_stay_only_when_placed
    CHECK (stay_id IS NULL OR state IN ('recorded', 'placed_by_hand')),
  CONSTRAINT loyalty_inbox_booking_reads_not_mine_known_unmatched
    CHECK (state <> 'not_mine_known' OR (suffix IS NOT NULL AND membership_id IS NULL)),
  CONSTRAINT loyalty_inbox_booking_reads_mismatch_reason_is_mismatch
    CHECK (reason IS DISTINCT FROM 'program_mismatch' OR program_check IS NOT DISTINCT FROM 'mismatch'),
  CONSTRAINT loyalty_inbox_booking_reads_reason_suffix
    CHECK ((reason IS DISTINCT FROM 'no_suffix' OR suffix IS NULL)
           AND (reason IS NULL OR reason IN ('no_suffix', 'program_mismatch') OR suffix IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS loyalty_inbox_booking_reads_received ON loyalty_inbox_booking_reads (received_on);
CREATE INDEX IF NOT EXISTS loyalty_inbox_booking_reads_program ON loyalty_inbox_booking_reads (program_id, received_on);
CREATE INDEX IF NOT EXISTS loyalty_inbox_booking_reads_pending ON loyalty_inbox_booking_reads (received_on DESC, id DESC) WHERE state = 'pending';
