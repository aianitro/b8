-- Up Migration

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
-- number the annual budget page nets everything else against. Found via schema drift: this
-- table existed live but was never captured in db/schema.sql (see app/api/budget/settings/route.ts,
-- app/budget/page.tsx, components/BudgetMonthlyGrid.tsx for its three call sites) — this baseline
-- migration is the first place its definition is actually version-controlled.
CREATE TABLE IF NOT EXISTS budget_settings (
  year                INT NOT NULL,
  landscape           TEXT NOT NULL DEFAULT 'operational',
  beginning_balance   NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (year, landscape)
);

-- Down Migration

DROP TABLE IF EXISTS budget_settings;
DROP TABLE IF EXISTS sync_log;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS transfer_groups;
DROP TABLE IF EXISTS category_rules;
DROP TABLE IF EXISTS category_balances;
DROP TABLE IF EXISTS budget_categories;
DROP TABLE IF EXISTS account_balances;
DROP TABLE IF EXISTS accounts;
DROP EXTENSION IF EXISTS vector;
