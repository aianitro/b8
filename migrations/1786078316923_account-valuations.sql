-- Up Migration

-- Phase 0 keystone (ROADMAP.md): dual-regime balance model. Operational/ledger accounts keep
-- the existing flow-derived running balance (beginning_balance + Σ transactions) — correct for
-- cash accounts, unchanged by this migration. Capital accounts (brokerage, 401k, real estate,
-- mortgages) get a periodic point-in-time valuation instead, since market-value assets and
-- amortizing liabilities have no meaningful "sum of transactions" balance.
ALTER TABLE accounts
  ADD COLUMN valuation_mode TEXT NOT NULL DEFAULT 'ledger' CHECK (valuation_mode IN ('ledger', 'valuation')),
  ADD COLUMN is_liability   BOOLEAN NOT NULL DEFAULT FALSE;

-- Append-only: one row per observation, not an editable "current value" column, so the manual
-- quarterly entries this starts with naturally become a value-over-time history later (§1f's
-- net_worth_snapshots) without a schema change. "Latest per account" is valued_at DESC LIMIT 1.
CREATE TABLE account_valuations (
  id          SERIAL PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON UPDATE CASCADE,
  value       NUMERIC(14, 2) NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('manual', 'plaid_balance', 'plaid_investments', 'derived')),
  valued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_account_valuations_account_id ON account_valuations(account_id, valued_at DESC);

-- Down Migration

DROP TABLE IF EXISTS account_valuations;
ALTER TABLE accounts
  DROP COLUMN IF EXISTS valuation_mode,
  DROP COLUMN IF EXISTS is_liability;
