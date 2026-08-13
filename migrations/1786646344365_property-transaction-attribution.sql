-- Up Migration

-- Attribute a single transaction to a property directly, overriding the account it sits on.
--
-- Until now a property's activity was defined purely by accounts.property_id: everything in a
-- linked account belonged to that property, everything else did not. That is the right default
-- and stays the default — a dedicated trust account per rental has no attribution ambiguity,
-- which is why accounts.property_id was introduced in the first place.
--
-- It breaks whenever the property's money moves through an account that isn't its own. Gastonia
-- is the worked example: its trust checking was opened 2026-03-09, so January through early
-- March of that property's year — mortgage payments, rent, HOA — ran through the primary
-- residence's trust savings and was invisible to the property's statement. Linking that savings
-- account to Gastonia would be worse than the gap, dragging every unrelated primary-residence
-- transaction onto the rental's books.
--
-- Resolution order is COALESCE(t.property_id, a.property_id): an explicit tag wins, the account
-- supplies the default. NULL therefore means "inherit", not "unattributed" — so tagging is
-- purely additive and no existing attribution changes when this column appears.
ALTER TABLE transactions
  ADD COLUMN property_id INT REFERENCES properties(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- Partial: the overwhelming majority of transactions inherit from their account and are never
-- looked up this way, so indexing only the tagged rows keeps this small.
CREATE INDEX idx_transactions_property_id ON transactions(property_id) WHERE property_id IS NOT NULL;

-- Per-property opening cash position, mirroring account_balances and category_balances exactly
-- (same three columns, same composite key, same editable-per-year semantics).
--
-- A property-level balance cannot be derived from its linked accounts once transactions are
-- attributed across account boundaries: Gastonia's operating cash on 2026-01-01 lived in an
-- account that is not linked to it, and its own account did not yet exist. The spreadsheet this
-- replaces keeps exactly this figure — the Gastonia sheet opens at a Beginning balance row —
-- so the concept is the owner's, not an invention of the schema.
CREATE TABLE property_balances (
  property_id        INT NOT NULL REFERENCES properties(id) ON UPDATE CASCADE ON DELETE CASCADE,
  year               INT NOT NULL,
  beginning_balance  NUMERIC(14, 2) NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id, year)
);

-- Down Migration

DROP TABLE IF EXISTS property_balances;
DROP INDEX IF EXISTS idx_transactions_property_id;
ALTER TABLE transactions DROP COLUMN IF EXISTS property_id;
