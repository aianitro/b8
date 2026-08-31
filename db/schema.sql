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
