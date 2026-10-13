-- Up Migration
-- "How much did the year-end P/L target move, and what moved it" (task year-end-moves). The owner
-- chose, on 2026-10-12, to see the move both since yesterday and since the start of the month.
--
-- ─── WHAT THIS ADDS, AND WHAT IT DOES NOT TOUCH ───────────────────────────────────────────────
--
-- One new table. No existing table, column, default, constraint, function or row is changed.
-- effective_budget(), budget_categories and transactions keep exactly their current meaning; this
-- table records what they said on a given morning and adds nothing to them.
--
-- ─── WHY THIS IS STORED, ALTHOUGH THE PROJECTION IS A DERIVED READ ────────────────────────────
--
-- The year-end projection (apps/web/lib/domain/yearEnd.ts, read by apps/web/lib/yearEndRead.ts) is
-- derived and is never a column anywhere. What cannot be derived is what its INPUTS were on an
-- earlier morning, and "what moved it" needs exactly that:
--   * the plan keeps no history. budget_categories.annual_budget and monthly_amounts are edited in
--     place, so yesterday's plan is gone the moment the owner changes it;
--   * the actuals keep no history either. Re-filing a transaction rewrites mapped_category in place,
--     hiding one flips transactions.hidden in place, and a deleted row leaves no trace in the ledger.
--     transactions.created_at would reconstruct late arrivals, and nothing reconstructs the rest.
-- So this is the same narrow exception as net_worth_snapshots and budget_unspent: a recorded
-- snapshot of something that genuinely cannot be rebuilt later. It is NOT a "current" anything. No
-- reader may treat the newest row as the year-end figure now; the figure now is always the live
-- read through loadYearEnd.
--
-- ─── WHY PER CATEGORY, AND WHY ARRAYS, RATHER THAN ONE TOTAL PER DAY ──────────────────────────
--
-- A total-only row, shaped like net_worth_snapshots, can say how far the target moved but not why.
-- The move is decomposed by sequential substitution over two snapshots, A (earlier) and B (later),
-- each step swapping one input from A to B and re-running the same projection:
--   (1) plan edits                 — A's plans replaced by B's plans;
--   (2) closed months' actuals     — late arrivals and re-filing in months already over;
--   (3) the month in progress      — spending, or income, landing in the current month;
--   (4) the calendar advancing     — A's month in progress replaced by B's.
-- That needs, per category, the full 12-month plan and the full 12-month actuals as they stood that
-- morning. The steps then sum exactly to the difference between the two projections, because every
-- step is computed from stored numbers and nothing is re-read from the live ledger.
--
-- ─── WRITE DISCIPLINE ─────────────────────────────────────────────────────────────────────────
--
-- Written once each morning by the daily job, one row per budgeted category per landscape.
-- "Budgeted" means exactly the rows loadYearEnd projects over: budget_categories with
-- exclude_from_budget = FALSE in that landscape, joined to effective_budget(year). Uncategorized money
-- is not snapshotted, because it is counted in no projected figure.
--
-- The FIRST write of a (snapshot_date, landscape) wins, and it wins as a whole, not row by row. A
-- second run that day must change nothing, including adding a row for a category created between
-- the two runs; otherwise one snapshot would describe two different mornings. The PRIMARY KEY makes
-- a duplicate row impossible; it cannot make a partial day impossible, so that rule belongs to the
-- writer (see plan/tasks/year-end-moves/CONTRACT.md).
--
-- No rows for a (snapshot_date, landscape) means NO SNAPSHOT WAS TAKEN that day (the job did not
-- run, or failed), not "nothing was budgeted". A reader must report the move as unknown in that
-- case, never as zero, and never treat every category of the later snapshot as newly added.
CREATE TABLE IF NOT EXISTS year_end_snapshots (
  -- The morning the snapshot describes, as a calendar date in the app's local zone, NOT the UTC date
  -- of recorded_at. The year being projected and the month in progress are both DERIVED from it and
  -- deliberately not stored: a stored month next to a date could disagree with it.
  snapshot_date  DATE NOT NULL,
  landscape      TEXT NOT NULL CHECK (landscape IN ('operational', 'capital')),
  -- The category's NAME, not budget_categories.id. Transactions map to categories by name
  -- (transactions.mapped_category is not a foreign key), so the name is what the actuals were summed
  -- over. And a snapshot must outlive its category: an id would either need a foreign key, which would
  -- refuse the delete or cascade the history away, or would dangle and name nothing. A deleted or
  -- renamed category's past must still read. Unique within a landscape, as budget_categories is.
  --
  -- Consequence a reader must know: a RENAME between two snapshots reads as one category removed and
  -- another added. Its plan and actuals then move through steps (1) to (3) as offsetting amounts,
  -- although the target itself is unaffected by the rename.
  category_name  TEXT NOT NULL,
  -- The category's is_income as of that morning. Stored because it can be flipped in place, and a
  -- snapshot must be projected with the classification it was taken under: income is sign-flipped
  -- and lands on the other side of income − expense.
  is_income      BOOLEAN NOT NULL,
  -- The resolved plan, January first, as effective_budget(year) gave it that morning: the explicit
  -- monthly_amounts schedule, or annual_budget spread evenly across the 12 months when there is none,
  -- with every carry from budget_unspent_moves into that year already included. Each month is rounded
  -- to cents before writing. Signed as budget_categories stores it, a POSITIVE amount for income and
  -- for spending alike; it is never in the ledger's sign. Never NULL: a budgeted category always has
  -- a plan, and a month planned at zero is a real plan of zero, not a missing one.
  plan           NUMERIC(12, 2)[] NOT NULL
    CONSTRAINT year_end_snapshots_plan_twelve_months
      CHECK (array_ndims(plan) = 1 AND array_lower(plan, 1) = 1 AND cardinality(plan) = 12
             AND array_position(plan, NULL) IS NULL),
  -- The 12 monthly actuals of that year, January first, as of that morning, in the LEDGER's sign:
  -- money out positive, money in negative. So an income category's actuals are normally negative,
  -- and the projection flips them, exactly as it flips the live ledger. Summed on the same rule as
  -- loadYearEnd (hidden = FALSE, accounts with track_transactions = TRUE), and rounded to cents. A
  -- month with no transactions is a real zero, because the ledger was read and held nothing, so 0 is
  -- correct there and NULL is refused. Months after the month in progress are normally zero; they
  -- are stored anyway, since a future-dated transaction is still part of what the ledger said.
  actuals        NUMERIC(12, 2)[] NOT NULL
    CONSTRAINT year_end_snapshots_actuals_twelve_months
      CHECK (array_ndims(actuals) = 1 AND array_lower(actuals, 1) = 1 AND cardinality(actuals) = 12
             AND array_position(actuals, NULL) IS NULL),
  -- When the row was written. Distinguishes a snapshot taken on time from one written late in the
  -- day after a failed morning run, which describes a later state of the same date.
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Also serves every read this table has: one date, or two, for one landscape.
  PRIMARY KEY (snapshot_date, landscape, category_name)
);

-- Down Migration
-- Drops the table. Every recorded morning is lost, and it cannot be rebuilt: the plans and actuals
-- it held are stored nowhere else. No other table, column or function is touched. Code that reads
-- or writes this table must be reverted before this runs.
DROP TABLE IF EXISTS year_end_snapshots;
