-- Up Migration

-- When Plaid stops being able to reach an institution, nothing in this app can tell.
--
-- On 2026-09-11 Chase (ins_56) went DEGRADED on Plaid's side and the last transaction to reach
-- b8 was dated 2026-09-08. Every signal the app owns said healthy: the scheduler ran, the
-- `transactionsSync` call returned 200 with an empty page, `sync_log` recorded 0 synced and 0
-- errors, and `last_synced_at` advanced on all ten Chase accounts. The failure was real and it
-- was entirely outside the request — Plaid's own background refresh against the bank had been
-- failing since 02:04 UTC the previous day.
--
-- That state is reported, but only on a field nothing here reads: `/item/get` returns
-- `status.transactions.last_successful_update` and `last_failed_update`, which describe PLAID'S
-- refresh of the institution rather than our call to Plaid. The item's `error` stays null
-- throughout — this is not ITEM_LOGIN_REQUIRED, nothing needs re-authenticating, and a re-link
-- would be the wrong reflex.
--
-- Two columns rather than one boolean, because the pair is what distinguishes the three states a
-- single "stale" flag collapses: never updated, updating normally, and updating but failing on
-- the most recent attempt. The last of those is the one that caught this, and it is invisible in
-- `last_successful_update` alone — that timestamp simply stops moving, which also describes a
-- quiet week.
--
-- PER ITEM, STORED PER ACCOUNT, exactly as `cursor` and `access_token` already are. Ten Chase
-- account rows will carry ten identical copies of these two timestamps. That duplication is
-- deliberate and consistent with the existing shape: a `plaid_items` table is the normalised
-- answer and is the right migration to make when an item needs a second attribute of its own,
-- not as a side effect of adding observability. Writers must update every account row sharing an
-- access token together — `lib/sync.ts` already does exactly this for `cursor` via
-- `WHERE id = ANY($2)`, and this rides the same statement.
--
-- Nullable, and nullable means unknown: a manual account has no item, and a Plaid account that
-- has not been synced since this migration has no observation yet. Neither is "fresh" and neither
-- is "failing", so neither gets a timestamp. A DEFAULT NOW() here would manufacture an
-- observation that was never made, and the freshness check would report every account healthy on
-- the strength of it.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS item_last_successful_update TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS item_last_failed_update     TIMESTAMPTZ;

-- Down Migration

-- Dropping these loses only observations that the next sync re-fetches from Plaid in full — they
-- are a cache of someone else's state, not a record of anything that happened here. No CSV backup
-- (BUILD.md §9.3), for that reason and no other.

ALTER TABLE accounts DROP COLUMN IF EXISTS item_last_successful_update;
ALTER TABLE accounts DROP COLUMN IF EXISTS item_last_failed_update;
