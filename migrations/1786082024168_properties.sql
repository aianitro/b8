-- Up Migration

-- Real estate as a first-class capital asset (ROADMAP.md Phase 0 step 5). Deliberately its own
-- entity, not a shadow "account": a property has no Plaid id, no track_transactions/cursor
-- semantics, and (unlike a brokerage) two independent things move over time — its market
-- value and, separately, the mortgage balance secured against it. Modeling it as an account
-- would leave nowhere to put purchase price / cost basis, and no clean way to net a mortgage
-- against specifically its own property rather than the capital landscape as a whole.
CREATE TABLE properties (
  id             SERIAL PRIMARY KEY,
  nickname       TEXT NOT NULL,
  address        TEXT,
  type           TEXT NOT NULL CHECK (type IN ('primary', 'rental')),
  purchase_price NUMERIC(14, 2),
  purchase_date  DATE,
  -- Starts equal to purchase_price; bumped manually as capital improvements happen. No
  -- separate improvements ledger yet — a single editable running total is the honest v1, same
  -- call as manual valuations below (a real ledger is a later add if per-improvement detail
  -- ever matters for a sale).
  cost_basis     NUMERIC(14, 2),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Same append-only shape as account_valuations, but a property's own market value has no
-- Plaid-sourced counterpart today, so 'source' only has one live value for now — CHECK still
-- named/scoped like account_valuations' so adding an API source (Zillow-shaped) later is a
-- one-line constraint change, not a new table.
CREATE TABLE property_valuations (
  id          SERIAL PRIMARY KEY,
  property_id INT NOT NULL REFERENCES properties(id) ON UPDATE CASCADE,
  value       NUMERIC(14, 2) NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('manual')),
  valued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_property_valuations_property_id ON property_valuations(property_id, valued_at DESC);

-- Links a mortgage LIABILITY account to the property it's secured against, so per-property
-- equity = property_valuations.latest − this account's latest account_valuations balance.
-- Nullable: most accounts (checking, brokerages, unrelated liabilities) have no property.
ALTER TABLE accounts ADD COLUMN property_id INT REFERENCES properties(id) ON UPDATE CASCADE;

-- Down Migration

ALTER TABLE accounts DROP COLUMN IF EXISTS property_id;
DROP TABLE IF EXISTS property_valuations;
DROP TABLE IF EXISTS properties;
