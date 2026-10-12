-- Up Migration
-- Overdraft watch, first half: "already below the cushion" detection (task overdraft-watch).
--
-- ─── WHAT THIS ADDS, AND WHAT IT DOES NOT TOUCH ───────────────────────────────────────────────
--
-- Two new columns on accounts, both NOT NULL with a constant default (no table rewrite on
-- Postgres 11 or later), and one new table. No existing column changes type, nullability, default
-- or meaning, and no existing row is written beyond receiving the two defaults.
--
-- ─── THE BALANCE THAT IS WATCHED ──────────────────────────────────────────────────────────────
--
-- For a Plaid-fed depository account, at sync time: the LOWER of Plaid's `available` and
-- `current` balances, whichever of the two Plaid reported. Available is lower when holds and
-- pending debits have not posted yet, which is exactly when an overdraft is about to happen;
-- current is lower when a pending deposit inflates available. Taking the minimum means neither
-- direction can hide a shortfall. That reading is stored nowhere else in this schema (ledger-mode
-- balances are flow-derived), so the episode rows below are its only record.
--
-- If Plaid reports neither figure for an account on a sync, that sync made NO observation of it:
-- it must not open, extend or close an episode, and it must not treat the missing figure as zero.
--
-- ─── WHY EPISODES, AND WHY THEY ARE STORED ────────────────────────────────────────────────────
--
-- An episode is a stretch of syncs during which the account read below its cushion. Storing it is
-- the same narrow exception as net_worth_snapshots: the balance readings that define it are not
-- recorded anywhere else and cannot be reconstructed afterwards, and the episode is also the
-- push's idempotency record, so one stretch below the cushion yields one notification rather than
-- one per sync.

-- Per-account opt-out. TRUE by default so that every depository account the owner already has is
-- watched from the first sync after this migration, which is the point of the request. FALSE is for
-- an account where a low reading is not a danger (for example one with overdraft protection drawing
-- on a linked savings account). Inert on any account that is not a Plaid-fed depository account:
-- the watcher never reads it there, so a TRUE on a credit card or a manual account means nothing.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS overdraft_watch BOOLEAN NOT NULL DEFAULT TRUE;

-- The line below which a watched account is in an episode: strictly below, so a reading exactly at
-- the cushion is not one. The default of zero makes the watch mean "overdrawn" until the owner
-- raises it. Zero here is a threshold the owner chose (or accepted), not a missing observation;
-- there is no "unknown cushion". Never negative: a negative cushion would mean "warn only once
-- already overdrawn by some margin", which is a different feature with a different name.
-- Same scale as the balances it is compared against (two decimal places); writers round to cents.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS overdraft_cushion NUMERIC(12, 2) NOT NULL DEFAULT 0
    CONSTRAINT accounts_overdraft_cushion_nonnegative CHECK (overdraft_cushion >= 0);

-- One row per stretch a watched account spends below its cushion.
--
-- LIFECYCLE, as the sync job must apply it, per watched Plaid-fed depository account that the sync
-- actually observed:
--   * reading < cushion, no open episode  : INSERT one (opened_at, last_seen_at default to now;
--                                           low_balance = last_balance = the reading).
--   * reading < cushion, open episode     : UPDATE last_balance, last_seen_at, and
--                                           low_balance = LEAST(low_balance, reading).
--   * reading >= cushion, open episode    : set closed_at. Nothing else changes: last_balance and
--                                           last_seen_at stay the last BELOW-cushion reading, so a
--                                           closed row describes the episode, not the recovery.
--   * otherwise                           : nothing.
-- "Cushion" in the three cases above is the account's CURRENT overdraft_cushion: if the owner moves
-- it mid-episode, the next sync judges against the new line. The cushion the episode was OPENED
-- against is kept on the row (below) because accounts.overdraft_cushion has no history.
--
-- An account the sync did not observe (feed down, overdraft_watch turned off, Plaid omitted both
-- balances) leaves its open episode OPEN. Closing it would assert a recovery nobody saw. Its
-- last_seen_at then ages, and that age is how a reader tells "still below" from "not looked at
-- since"; a reader must show it rather than present last_balance as the balance now.
--
-- Holds figures, so it must never be read into a push payload. The PWA push is content-free by a
-- recorded owner decision (plan/tasks/P3-25-push-ping/DECISION.md; web_push_subscriptions stores
-- no encryption keys on purpose), and this table does not change that.
CREATE TABLE IF NOT EXISTS overdraft_episodes (
  id            SERIAL PRIMARY KEY,
  -- ON UPDATE CASCADE like every other reference to accounts(id): reconciliation remaps a reissued
  -- Plaid account_id in place, and an episode must follow its account. ON DELETE CASCADE unlike
  -- most of them, deliberately: an episode is alert state about the account and means nothing
  -- without it, and NO ACTION here would make any account-delete path start failing the first time
  -- an account had ever been low.
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE CASCADE,
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL = open: the last observation was below the cushion, or the account has not been observed
  -- since (see above). Not "unknown".
  closed_at     TIMESTAMPTZ,
  -- The account's overdraft_cushion when the episode opened, copied because that column is mutable
  -- and keeps no history. Without it, raising a cushion later would silently reinterpret every past
  -- episode as having been measured against a line that did not exist at the time.
  cushion       NUMERIC(12, 2) NOT NULL CHECK (cushion >= 0),
  -- Signed balances, as Plaid reports them for a depository account: negative means overdrawn.
  -- Not magnitudes; nothing flips their sign on read. Rounded to cents before writing, because a
  -- NUMERIC(14,2) column compared against an unrounded JavaScript number compares unequal forever.
  low_balance   NUMERIC(14, 2) NOT NULL,  -- lowest reading seen during the episode
  last_balance  NUMERIC(14, 2) NOT NULL,  -- most recent BELOW-cushion reading; never the balance "now"
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- when last_balance was read
  -- When the web push for this episode was accepted by at least one live subscription. NULL while
  -- open = not yet delivered: retry on the next sync. NULL on a closed row = never delivered, and
  -- it stays that way: a closed episode is never pushed late, since by then it would be false.
  pushed_at     TIMESTAMPTZ,

  CONSTRAINT overdraft_episodes_closed_after_opened
    CHECK (closed_at IS NULL OR closed_at >= opened_at),
  CONSTRAINT overdraft_episodes_seen_in_episode
    CHECK (last_seen_at >= opened_at AND (closed_at IS NULL OR last_seen_at <= closed_at)),
  CONSTRAINT overdraft_episodes_pushed_after_opened
    CHECK (pushed_at IS NULL OR pushed_at >= opened_at),
  -- The low is the minimum of the readings, the last one included.
  CONSTRAINT overdraft_episodes_low_is_lowest
    CHECK (low_balance <= last_balance),
  -- The opening reading was strictly below the opening cushion and the low can only fall, so this
  -- holds for the whole life of the row. It turns a sign slip in the writer (a magnitude stored for
  -- an overdrawn balance) into a failed insert rather than an episode that reads as healthy.
  CONSTRAINT overdraft_episodes_low_below_cushion
    CHECK (low_balance < cushion)
);

-- At most one open episode per account: the sync's read ("is this account already in an
-- episode?") and the guarantee that two overlapping syncs cannot open two and push twice. The
-- second INSERT raises a unique violation however the transactions interleave.
CREATE UNIQUE INDEX IF NOT EXISTS overdraft_episodes_one_open
  ON overdraft_episodes (account_id) WHERE closed_at IS NULL;

-- Down Migration
-- Drops the table and the two columns. Every recorded episode is lost, including which ones were
-- pushed; those readings are stored nowhere else. Each account's cushion and opt-out are lost too.
-- Code that reads either must be reverted before this runs.
DROP TABLE IF EXISTS overdraft_episodes;
ALTER TABLE accounts DROP COLUMN IF EXISTS overdraft_cushion;
ALTER TABLE accounts DROP COLUMN IF EXISTS overdraft_watch;
