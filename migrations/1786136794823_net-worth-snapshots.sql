-- Up Migration

-- Net worth over time (ROADMAP.md Phase 0 step 7). Unlike account_valuations and
-- property_valuations, which record observations of a single thing, this stores the *computed*
-- statement at a point in time — the four components plus their total.
--
-- Stored rather than recomputed because it cannot be reconstructed later: the calculation
-- depends on which accounts existed, how they were classified, and which properties were
-- valued on that date. Deleting an account or reclassifying it from ledger to valuation would
-- silently rewrite every historical figure if the chart derived them on the fly.
--
-- Components are non-overlapping and sum to `total` (see lib/domain/netWorth.ts) — in
-- particular a property-linked mortgage lives inside real_estate_equity and is deliberately
-- absent from liabilities, so the two can never double-count the same debt.
CREATE TABLE net_worth_snapshots (
  snapshot_date      DATE PRIMARY KEY,
  operational        NUMERIC(14, 2) NOT NULL,
  capital_financial  NUMERIC(14, 2) NOT NULL,
  real_estate_equity NUMERIC(14, 2) NOT NULL,
  liabilities        NUMERIC(14, 2) NOT NULL,
  total              NUMERIC(14, 2) NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Down Migration

DROP TABLE IF EXISTS net_worth_snapshots;
