-- Up Migration
-- Why a feed is dead, not just that it is.
--
-- ─── THE SIGNAL THE APP NEVER ASKED FOR ───────────────────────────────────────────────────────
--
-- `feedHealth` already catches an outage correctly: `item_last_failed_update` moves ahead of
-- `item_last_successful_update` and the dashboard says the data is N hours old. What it cannot say
-- is WHY, so the owner is left to guess between "my bank needs re-authenticating", "Plaid is having
-- a bad day" and "nothing is wrong, there were no transactions". Those want three different
-- reactions and only one of them is any work.
--
-- Plaid publishes the answer and the app never asked. During a four-day Chase outage in September
-- 2026, `/institutions/get_by_id` with `include_status` reported DEGRADED since 2026-09-10T09:45:18Z
-- with a 22.7% Plaid-side error rate — a figure that would have explained the dead feed on day one.
--
-- ─── THESE ARE ITEM-LEVEL FACTS ON AN ACCOUNT ROW, LIKE THE TWO BESIDE THEM ───────────────────
--
-- `item_last_successful_update` and `item_last_failed_update` are already per-item facts stored per
-- account and grouped by `access_token` at read time. These follow that precedent rather than
-- introducing an `institutions` table: the duplication is real but it is the duplication this table
-- already has, and one shape is easier to reason about than two. A separate table becomes worth it
-- the day something other than an account needs to know an institution's status.
--
-- `institution_id` is free: `/item/get` is already called once per item per sync for the two
-- freshness columns, and carries `item.institution_id` in the same response, discarded until now.
--
-- ─── WHICH STATUS, WHICH IS NOT THE ONE THE BACKLOG NAMED ─────────────────────────────────────
--
-- Plaid reports status per product. The backlog cited `item_logins`, which measures whether LOGINS
-- succeed — the right signal when re-authentication is the problem. But a dead transaction feed is
-- about `transactions_updates`, the product this app actually consumes, and an institution can log
-- in fine while refusing to hand over transactions. The reader prefers `transactions_updates` and
-- falls back to `item_logins` when absent.
--
-- `status` itself is DEPRECATED in Plaid's SDK in favour of `breakdown`, which gives success and
-- error rates as decimals. It is used anyway, and deliberately: `breakdown` would mean inventing
-- thresholds for what counts as degraded, and a number this app made up is worse than a
-- classification the party with the data made. If `status` is withdrawn, the migration path is to
-- derive the level from `breakdown.success` — and that decision should be made then, with Plaid's
-- own guidance, not guessed at now.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS institution_id TEXT;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS item_institution_status TEXT
  CONSTRAINT accounts_institution_status_known
    CHECK (item_institution_status IS NULL
           OR item_institution_status IN ('HEALTHY', 'DEGRADED', 'DOWN'));

-- Plaid's `last_status_change`, not when this app read it. "Degraded since Thursday" is the useful
-- sentence; "we noticed at 6am" is about us.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS item_institution_status_at TIMESTAMPTZ;

COMMENT ON COLUMN accounts.item_institution_status IS
  'Plaid institution status for transactions_updates (falling back to item_logins). NULL = never read.';

-- Down Migration
ALTER TABLE accounts DROP COLUMN IF EXISTS item_institution_status_at;
ALTER TABLE accounts DROP COLUMN IF EXISTS item_institution_status;
ALTER TABLE accounts DROP COLUMN IF EXISTS institution_id;
