-- Up Migration
-- A record of counting a wallet, kept separately from what the count changed.
--
-- ─── Why this exists at all, since a count already writes a transaction ───────────────────────
--
-- Because the interesting count is the one that finds NOTHING. Cash spending is invisible: the
-- withdrawal is on the bank feed, the coffee is on no feed at all, so the only way the ledger learns
-- what a wallet holds is the owner counting it. If the only trace of counting were the adjustment
-- transaction, then "I counted on Sunday and it matched" would leave no trace whatsoever, and would
-- be indistinguishable from "I have not counted since April".
--
-- That distinction IS the feature. A cash balance is only as true as its last count, and the app can
-- say so — the same way it says a bank feed has gone dark — but only if the count itself is a fact it
-- stores. Deriving staleness from the newest adjustment transaction would report a wallet as freshly
-- counted exactly when it is most stale, because a wallet nobody spends from generates no adjustments.
--
-- ─── Why `expected` is stored rather than recomputed ─────────────────────────────────────────
--
-- `expected` is what the ledger believed at the moment of counting. It is stored, not derived, because
-- the ledger behind it keeps moving: a later edit to a transaction's amount, a recategorisation, a
-- backfilled row, all change what a replayed "balance as of that date" would produce. Recomputing it
-- would quietly rewrite history so that every past count looks like it agreed, which is the one thing
-- this table exists to be able to contradict.
--
-- Same reasoning as `net_worth_snapshots`, which db/schema.sql already documents as stored precisely
-- because a point-in-time figure cannot be recalculated once the accounts beneath it are reclassified.
--
-- ─── Append-only, like the other observation tables ───────────────────────────────────────────
--
-- A count is an observation made at a time, not a mutable current value: it is never updated, only
-- superseded by a later one. `account_valuations` and `property_valuations` have the same shape, and
-- "current" is a read-time `latest` rather than a column anyone writes.
CREATE TABLE IF NOT EXISTS cash_counts (
  id           SERIAL PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON UPDATE CASCADE,

  -- What was actually in the wallet. A wallet cannot hold less than nothing, and a negative here
  -- would silently invert the adjustment's direction, so it is refused at the column.
  counted      NUMERIC(14, 2) NOT NULL CHECK (counted >= 0),

  -- What the ledger said at that moment. May legitimately be negative: a wallet spent from before
  -- its opening balance was recorded computes below zero, and refusing to store that would mean
  -- refusing to record the very count that fixes it.
  expected     NUMERIC(14, 2) NOT NULL,

  -- The transaction written to close the gap. NULL when `counted = expected` — the case this table
  -- exists for — and NULL again if that transaction is later deleted, which loses the link but must
  -- never delete the count: the observation happened whatever became of its consequence.
  adjustment_transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,

  counted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The only access pattern: the newest count for an account, and the history behind it.
CREATE INDEX IF NOT EXISTS cash_counts_account_counted_at
  ON cash_counts (account_id, counted_at DESC);

-- Down Migration
DROP INDEX IF EXISTS cash_counts_account_counted_at;
DROP TABLE IF EXISTS cash_counts;
