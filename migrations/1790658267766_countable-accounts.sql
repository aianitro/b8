-- Up Migration
-- Which accounts are money you physically count.
--
-- ─── Why a column and not a rule ──────────────────────────────────────────────────────────────
--
-- The cash-count feature listed every manual ledger account, which put a manually-added credit card
-- in a panel headed "Cash on hand" and offered to count it. Counting it would have written a real
-- adjustment against a card balance, correcting nothing and inventing a transaction.
--
-- Every available rule for inferring this is a coincidence rather than a fact. `access_token IS NULL`
-- means "not from Plaid", which is how the card got in. `type = 'other'` happens to select exactly the
-- four wallets today, and would stop the moment another kind of manual account is added — and the
-- failure is silent, because nothing would look wrong until someone counted the wrong thing.
--
-- "Is this money you can hold in your hand and count" is not derivable from any other column. It is a
-- property of the account, so it is stored as one. Same reasoning as `valuation_mode` and
-- `is_liability`, which are also facts about an account that no amount of inspecting its transactions
-- would reveal.
--
-- ─── Default FALSE, and the backfill is a one-off ─────────────────────────────────────────────
--
-- FALSE, so a new account is not countable until someone says it is. The opposite default would mean
-- every account added from now on appears under "Cash on hand" until noticed, which is the failure
-- this migration exists to remove.
--
-- The backfill below uses the `type = 'other' AND access_token IS NULL` heuristic — the very rule
-- rejected above as a permanent inference. That is deliberate and not a contradiction: as a ONE-TIME
-- statement over today's known rows it is checkably correct (it selects the four wallets and nothing
-- else, verified against production before writing this), whereas as a standing rule it would keep
-- being re-evaluated against rows that do not exist yet. A heuristic you can verify once is a
-- migration; a heuristic that keeps running is a bug waiting.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS countable BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN accounts.countable IS
  'Money physically counted rather than reported by a feed — wallets, gift cards. Gates the cash-count flow.';

UPDATE accounts SET countable = TRUE
 WHERE type = 'other' AND access_token IS NULL AND valuation_mode = 'ledger';

-- Down Migration
ALTER TABLE accounts DROP COLUMN IF EXISTS countable;
