-- Up Migration
-- How many force-refresh requests Plaid refused, as against how many found nothing.
--
-- ─── THE TWO OUTCOMES WERE INDISTINGUISHABLE, AND ONE OF THEM MATTERS ─────────────────────────
--
-- A force sync asks Plaid to re-pull from the institution before syncing. That call is wrapped in a
-- `.catch` that logs a warning and continues, which is deliberate and half-right: a refusal must not
-- fail the whole sync, for the same reason the `/item/get` call beside it does not. But the outcome
-- went only to a console nobody reads, so `sync_log` recorded `synced: 0, errors: 0` for BOTH
--
--   "I asked Plaid to refresh and it refused"      — the institution is down
--   "I asked Plaid to refresh and there was nothing new"  — everything is fine
--
-- and the UI reported a clean run either way. Measured during a four-day Chase outage in September
-- 2026: the call returned API_ERROR / INTERNAL_SERVER_ERROR on every attempt and the app said the
-- sync succeeded. Nothing was wrong with what it reported; the question it answered was the wrong one.
--
-- ─── WHY A COUNT AND NOT A PER-ITEM OUTCOME ───────────────────────────────────────────────────
--
-- Per-item would name which institution refused, which is more useful — and is already answerable
-- from `feedHealth`, which reads `item_last_failed_update` per item and already drives the dashboard
-- card. What is missing from `sync_log` is not identity but the FACT that asking was refused, so a
-- count restores the distinction that was lost without duplicating a per-item record that exists.
--
-- DEFAULT 0, so existing rows read as "no refusals" rather than as unknown. That is a claim about
-- history this migration cannot support — those rows genuinely do not know — but the alternative is
-- a nullable column whose NULL every consumer would have to decide how to render, to express
-- something true only of rows written before today.
ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS refresh_errors INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN sync_log.refresh_errors IS
  'Force-refresh calls Plaid refused this run. Distinguishes "asked and refused" from "asked and nothing new" — both used to record errors = 0.';

-- Down Migration
ALTER TABLE sync_log DROP COLUMN IF EXISTS refresh_errors;
