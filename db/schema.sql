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

-- Links a mortgage LIABILITY account to the property it's secured against, so per-property
-- equity = property_valuations.latest − this account's latest account_valuations balance.
-- Nullable: most accounts (checking, brokerages, unrelated liabilities) have no property.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS property_id INT REFERENCES properties(id) ON UPDATE CASCADE;

-- Budget categories with annual allocations
CREATE TABLE IF NOT EXISTS budget_categories (
  id                    SERIAL PRIMARY KEY,
  name                  TEXT NOT NULL,
  annual_budget         NUMERIC(12, 2) NOT NULL,
  landscape             TEXT NOT NULL DEFAULT 'operational' CHECK (landscape IN ('operational', 'capital')),
  exclude_from_budget   BOOLEAN NOT NULL DEFAULT FALSE,
  is_income             BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order            INT NOT NULL DEFAULT 0,
  dedicated_account_id  TEXT REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE SET NULL,
  monthly_amounts       NUMERIC(12, 2)[], -- expected amount per month (12 values, Jan-Dec); NULL = spread annual_budget evenly across all 12
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, landscape)
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
CREATE TABLE IF NOT EXISTS category_rules (
  id               SERIAL PRIMARY KEY,
  plaid_category   TEXT NOT NULL UNIQUE,
  mapped_category  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
  hidden                BOOLEAN NOT NULL DEFAULT FALSE,  -- excluded from budget/dashboard calcs; still visible (grayed out) on /transactions
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_mapped_category ON transactions(mapped_category);
CREATE INDEX IF NOT EXISTS idx_transactions_transfer_group ON transactions(transfer_group_id);

-- One row per sync run, split by phase so the incremental value of a Plaid
-- transactionsRefresh (force) beyond a plain transactionsSync (plain) is visible over time.
CREATE TABLE IF NOT EXISTS sync_log (
  id         SERIAL PRIMARY KEY,
  ran_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger    TEXT NOT NULL,   -- 'scheduler' | 'manual_sync' | 'manual_force'
  phase      TEXT NOT NULL CHECK (phase IN ('plain', 'force')),
  synced     INT NOT NULL,
  unmatched  INT NOT NULL DEFAULT 0,
  errors     INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sync_log_ran_at ON sync_log(ran_at);

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
