-- Up Migration

-- Lets a *category* mark its transactions as debt service, alongside the existing rule that an
-- account marked `is_liability` does so (see lib/domain/propertyPnl.ts).
--
-- Why a second signal is needed: the per-property P&L flags debt service from the account a
-- transaction sits on, which works only when the mortgage account carries its own payment
-- stream. Myrtle Beach's does — it is Plaid-linked, so `PAYMENT` rows land directly on the
-- liability account. Gastonia's does not: it is a manual account holding a balance and nothing
-- else, while its payments leave from the rental's trust checking account. The liability flag
-- and the payments therefore sit on two different accounts and never meet, so ~$8.8K/yr of
-- mortgage payments were being counted as operating expenses — understating NOI and reporting
-- $0 debt service on a property that plainly has a mortgage.
--
-- Cash flow was unaffected throughout (the payment is subtracted either way), which is exactly
-- why this survived unnoticed: only the middle of the statement was wrong.
--
-- Category-level rather than transaction-level so the classification is stated once and applies
-- to every future payment automatically, including any manual mortgage added later.
ALTER TABLE budget_categories
  ADD COLUMN is_debt_service BOOLEAN NOT NULL DEFAULT FALSE;

-- Down Migration

ALTER TABLE budget_categories DROP COLUMN IF EXISTS is_debt_service;
