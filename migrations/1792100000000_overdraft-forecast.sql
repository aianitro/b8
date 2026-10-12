-- Up Migration
-- Overdraft watch, second half: the 7-day "about to go below the cushion" forecast
-- (task overdraft-forecast). The first half is migration 1792000000000 (overdraft_episodes).
--
-- ─── WHAT THIS ADDS, AND WHAT IT DOES NOT TOUCH ───────────────────────────────────────────────
--
-- One new table and one new partial unique index. No existing table, column, default, constraint or
-- row is changed. accounts.overdraft_watch and accounts.overdraft_cushion keep exactly the meaning
-- migration 1792000000000 gave them; this table reads them and adds nothing to them.
--
-- ─── WHAT A FORECAST IS ───────────────────────────────────────────────────────────────────────
--
-- At a sync, for a watched Plaid-fed depository account that the sync observed and that has NO open
-- overdraft_episodes row, the app projects the watched balance (the lower of Plaid's `available` and
-- `current`, exactly as for episodes) forward 7 days, using recurring series detected from that
-- account's own transaction history. Outflows apply on their due day; inflows count only from the
-- day AFTER they land, so a late payroll deposit cannot hide a shortfall. If the lowest projected
-- balance in the window is STRICTLY below the account's current cushion, a forecast is open for the
-- account. A projection that only reaches the cushion exactly does not open one, matching episodes.
--
-- ─── WHY IT IS STORED, ALTHOUGH A PROJECTION IS A DERIVED READ ────────────────────────────────
--
-- The projection itself is derived and moves on every sync, which is why it is NOT a column on
-- overdraft_episodes or on accounts. It is stored here for the same two reasons episodes are:
--   * the starting balance (the Plaid reading at sync time) is recorded nowhere else, so the
--     projection cannot be recomputed afterwards; and
--   * the row is the push's idempotency record: one stretch of "about to go below" yields one
--     notification, not one per sync.
-- The projection columns are therefore a SNAPSHOT of the latest projection that went below the
-- cushion, never "the forecast now". A reader shows projected_at's age beside them.
--
-- LIFECYCLE, as the sync job must apply it, per watched Plaid-fed depository account that the sync
-- actually observed. "Cushion" here is the account's CURRENT accounts.overdraft_cushion.
--   * the account has an open episode, or opens one on this sync:
--                                  close any open forecast with closed_reason = 'episode'. Do not
--                                  open one. The episode carries the alert from here.
--   * no open episode, projected low < cushion, no open forecast:
--                                  INSERT one, every projection column from this projection.
--   * no open episode, projected low < cushion, open forecast:
--                                  UPDATE cushion, balance, projected_low, low_on, charges and
--                                  projected_at together, from this projection. Never a subset:
--                                  the CHECKs below hold only when the six describe one projection.
--   * no open episode, projected low >= cushion, open forecast:
--                                  set closed_at and closed_reason = 'cleared'. Nothing else
--                                  changes, so a closed row describes the last projection that went
--                                  below the cushion, not the one that cleared it.
--   * otherwise:                   nothing.
-- An account observed with no detectable recurring series projects flat (its balance for all
-- 7 days). That is an observation, not a missing one: an open forecast closes as 'cleared'.
--
-- An account the sync did NOT observe (feed down, Plaid omitted both balances, overdraft_watch
-- turned off, no longer a depository account) leaves its forecast exactly as it was, open or
-- closed. Closing it would assert a projection nobody computed. Its projected_at then ages.
--
-- Holds figures and merchant labels, so it must never be read into a push payload. The PWA push is
-- content-free by recorded owner decision (plan/tasks/P3-25-push-ping/DECISION.md), and this table
-- does not change that.
CREATE TABLE IF NOT EXISTS overdraft_forecasts (
  id             SERIAL PRIMARY KEY,
  -- Same references as overdraft_episodes.account_id, for the same reasons: ON UPDATE CASCADE so a
  -- forecast follows a Plaid account_id that reconciliation remaps in place; ON DELETE CASCADE
  -- because a forecast is alert state with no meaning apart from its account, and NO ACTION would
  -- make an account-delete path fail the first time that account had ever been forecast low.
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE CASCADE,
  opened_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL = open: the latest projection went below the cushion, or the account has not been observed
  -- since. Not "unknown".
  closed_at      TIMESTAMPTZ,
  -- Why it closed. NULL exactly when open (pinned by a CHECK below).
  --   'cleared' — an observed sync's projection no longer went below the cushion. Not "recovered":
  --               the account was never below; the deposit landed, the charge was not expected
  --               any more, or the owner lowered the cushion. The name claims only what was seen.
  --   'episode' — the account opened an overdraft_episodes row: the forecast came true. Not
  --               "overdrawn": an episode means below the cushion, which is overdrawn only when the
  --               cushion is zero.
  closed_reason  TEXT CHECK (closed_reason IN ('cleared', 'episode')),
  -- The account's overdraft_cushion that the LATEST stored projection was judged against, refreshed
  -- with it. Deliberately not the cushion the forecast opened against, unlike overdraft_episodes:
  -- an episode's readings accumulate over its life, whereas a forecast's projection columns are
  -- replaced wholesale, and a refreshed projection compared with a stale cushion would no longer
  -- explain why the row is open. Copied because accounts.overdraft_cushion keeps no history.
  cushion        NUMERIC(12, 2) NOT NULL CHECK (cushion >= 0),
  -- Signed balances, as Plaid reports them for a depository account: negative means overdrawn. Not
  -- magnitudes. Rounded to cents before writing and before every comparison, because a
  -- NUMERIC(14,2) column compared against an unrounded JavaScript number compares unequal forever.
  balance        NUMERIC(14, 2) NOT NULL,  -- the watched balance the latest stored projection started from
  projected_low  NUMERIC(14, 2) NOT NULL,  -- the lowest balance in that projection's 7-day window
  -- The first day the projection reaches projected_low, as a calendar date in the app's local zone
  -- (the zone recurring due days are computed in). Within the 7 days after projected_at's date; not
  -- pinned by a CHECK because projected_at::date depends on the session time zone.
  low_on         DATE NOT NULL,
  -- The expected outflows that drive the projection down to projected_low: every projected outflow
  -- due on or before low_on, in date order. A JSON array of objects
  --   {"label": <merchant label, text>, "amount": <number>, "on": <ISO date "YYYY-MM-DD">}
  -- with amount a POSITIVE magnitude rounded to cents. For display only: it is never summed back
  -- into money arithmetic, and projected_low, not this array, is authoritative. JSONB rather than a
  -- child table because it is replaced wholesale on every refresh, is never queried by its
  -- elements, and has no meaning apart from the one projection it belongs to.
  -- NOT NULL with NO DEFAULT, and never empty: the projection starts at or above the cushion and
  -- ends below it, and only outflows lower a projection, so at least one outflow must be listed. A
  -- default of an empty array would let an INSERT that forgot the column state a forecast with no
  -- cause; without one, that INSERT fails.
  charges        JSONB NOT NULL
    CONSTRAINT overdraft_forecasts_charges_nonempty_array
      CHECK (jsonb_typeof(charges) = 'array' AND jsonb_array_length(charges) >= 1),
  projected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- when the latest stored projection was computed
  -- When the web push for this forecast was accepted by at least one live subscription. NULL while
  -- open = not yet delivered: retry on the next sync. NULL on a closed row = never delivered, and it
  -- stays that way: a closed forecast is never pushed late, since by then it is false or superseded
  -- by an episode (which pushes for itself).
  pushed_at      TIMESTAMPTZ,

  -- Open exactly when it has no reason to be closed, and closed only with one.
  CONSTRAINT overdraft_forecasts_closed_reason_iff_closed
    CHECK ((closed_at IS NULL) = (closed_reason IS NULL)),
  CONSTRAINT overdraft_forecasts_closed_after_opened
    CHECK (closed_at IS NULL OR closed_at >= opened_at),
  CONSTRAINT overdraft_forecasts_projected_in_forecast
    CHECK (projected_at >= opened_at AND (closed_at IS NULL OR projected_at <= closed_at)),
  CONSTRAINT overdraft_forecasts_pushed_while_open
    CHECK (pushed_at IS NULL OR (pushed_at >= opened_at AND (closed_at IS NULL OR pushed_at <= closed_at))),
  -- The stored projection started at or above its cushion: a start below it is an episode, never a
  -- forecast. Safe as a CHECK only because cushion is refreshed together with balance (see above);
  -- an owner moving accounts.overdraft_cushion cannot invalidate a stored row.
  CONSTRAINT overdraft_forecasts_start_at_or_above_cushion
    CHECK (balance >= cushion),
  -- The stored projection went strictly below its cushion, which is why the row exists. Like
  -- overdraft_episodes_low_below_cushion, this turns a sign slip in the writer (a magnitude stored
  -- for a negative projected balance) into a failed write instead of a forecast that reads as
  -- harmless. Together with the CHECK above it also forces projected_low < balance.
  CONSTRAINT overdraft_forecasts_low_below_cushion
    CHECK (projected_low < cushion)
);

-- At most one open forecast per account: the sync's read ("is a forecast already open?") and the
-- guarantee that two overlapping syncs cannot open two and push twice. The second INSERT raises a
-- unique violation however the transactions interleave.
CREATE UNIQUE INDEX IF NOT EXISTS overdraft_forecasts_one_open
  ON overdraft_forecasts (account_id) WHERE closed_at IS NULL;

-- Down Migration
-- Drops the table, and its index with it. Every recorded forecast is lost, including which ones were
-- pushed; the starting balances they record are stored nowhere else. overdraft_episodes and the two
-- accounts columns from migration 1792000000000 are untouched. Code that reads this table must be
-- reverted before this runs.
DROP TABLE IF EXISTS overdraft_forecasts;
