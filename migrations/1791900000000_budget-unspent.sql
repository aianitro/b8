-- Up Migration
-- An "Unspent" bucket per spending category (task budget-unspent).
--
-- ─── WHAT THIS ADDS, AND WHAT IT DOES NOT TOUCH ───────────────────────────────────────────────
--
-- Two new tables and one new function. No existing column changes type, nullability, default or
-- meaning, and no existing row is written. In particular `budget_categories.annual_budget` and
-- `budget_categories.monthly_amounts` keep meaning exactly what the owner typed: a carry is never
-- written into them (see effective_budget below for why it cannot be).
--
-- ─── THE RULE, AS DECIDED WITH THE OWNER ──────────────────────────────────────────────────────
--
-- When a month closes, a spending category's leftover (its plan for that month minus what it
-- actually spent, when that is positive) goes into the category's bucket. An overspent month adds
-- nothing and takes nothing. Nothing carries automatically: the owner allocates by hand, either
-- CARRYING an amount into a month (same category or another, current month or later), which raises
-- that month's plan, or RELEASING it to savings, which closes it out. Leftover the owner has not
-- allocated counts as saved: no figure anywhere may assume it will be spent.
--
-- Applies to operational AND capital spending categories; never to income or excluded categories.
-- Buckets start from the close of September 2026. Both of those are enforced by the daily job and
-- the allocation endpoint, not here: the schema cannot see a category's flags from these rows
-- without a trigger, and a trigger would be a second place the definition of "spending category"
-- lives.
--
-- ─── WHY THE CLOSE IS STORED, NOT DERIVED ON READ ─────────────────────────────────────────────
--
-- This is the same argument as net_worth_snapshots, and the same narrow exception to "derived
-- values are never stored". A month's leftover could be recomputed from transactions, but the
-- answer would move: a late Plaid backfill, a recategorisation or a deleted transaction would
-- shrink a bucket the owner has ALREADY allocated from, and the allocations would then overdraw a
-- balance that was positive when they were made. The close is the fact the owner acted on, so it is
-- recorded once and not revisited. `planned` and `actual` are stored beside `amount` so that
-- whoever later wonders why a bucket holds what it holds can see the two figures the job saw,
-- instead of re-deriving them from a ledger that has since changed.
--
-- ─── WHY THE BALANCE IS NOT A COLUMN ──────────────────────────────────────────────────────────
--
-- A category's bucket balance is
--     SUM(budget_unspent.amount) - SUM(budget_unspent_moves.amount)   for that category_id
-- computed by the application on read. A stored balance would be a "current value" column that a
-- missed update leaves silently stale; the two append-only tables are the whole record.
--
-- ─── MONEY ────────────────────────────────────────────────────────────────────────────────────
--
-- NUMERIC(12,2), the scale of budget_categories.annual_budget and monthly_amounts, which these
-- figures are compared against. Writers must round to cents before insert: a NUMERIC(12,2) column
-- compared against an unrounded JavaScript number compares unequal forever.

-- One row per spending category per CLOSED month, written once by the daily job, for EVERY spending
-- category with a plan above zero that month, including one that spent its plan or more (amount 0).
-- The zero rows are what make "closed" a recorded fact: without them, an overspent month would look
-- exactly like a month the job has not reached yet, so every run would re-examine it and a late
-- refund could insert a row long after the close. With them, each category-month is closed exactly
-- once. Zeros add nothing to a bucket's balance. A category with no plan that month gets no row, so
-- an absent row for a closed month means "nothing was planned", and for an unclosed month "not
-- closed yet"; it never stands for a zero leftover.
--
-- The job closes a month only from the 4th of the following month, so transactions still pending at
-- month end have posted before `actual` is frozen.
CREATE TABLE IF NOT EXISTS budget_unspent (
  id           SERIAL PRIMARY KEY,
  -- CASCADE: a deleted category takes its bucket with it, and its moves go too (see below).
  category_id  INT NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,
  year         INT NOT NULL,
  -- 1-based like the calendar (1 = January). Not the 0-based JavaScript month, and not an index
  -- into a Postgres array either, though Postgres arrays happen to be 1-based too.
  month        INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  -- What went into the bucket: max(0, planned - actual), computed from the cent-rounded `planned`.
  -- Zero for a month that spent its plan or more: an overspent month takes nothing out of the
  -- bucket. The CHECK makes a sign slip in the job a failed insert rather than a bucket that quietly
  -- holds debt.
  amount       NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  -- The month's plan as the job saw it, INCLUDING any carries into that month (that is, the
  -- effective_budget figure, not the raw monthly_amounts entry), rounded to cents before storing.
  planned      NUMERIC(12, 2) NOT NULL,
  -- What the category actually spent that month, as the job saw it at close. Frozen on purpose:
  -- later edits to the ledger do not reach back into it.
  actual       NUMERIC(12, 2) NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Written once. A re-run of the job for an already-closed month must leave the existing row as it
  -- is (ON CONFLICT DO NOTHING), never refresh it, for the backfill reason above.
  UNIQUE (category_id, year, month)
);

-- Each allocation out of a bucket. Append-only like budget_unspent: an allocation is an event the
-- owner made, and the balance is the difference of the two tables' sums.
CREATE TABLE IF NOT EXISTS budget_unspent_moves (
  id              SERIAL PRIMARY KEY,
  -- The bucket drawn FROM. CASCADE with the category, as budget_unspent is: a move from a bucket
  -- that no longer exists has nothing to be drawn from.
  category_id     INT NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,
  -- A positive magnitude; the direction is given by which table a row is in, never by a sign.
  amount          NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  -- 'carry'   = raise the plan of (to_category_id, to_year, to_month) by amount. The destination may
  --             be the same category or another one.
  -- 'release' = give it up to savings. No destination: the money simply stops being earmarked,
  --             which is what unallocated leftover already counts as, made final.
  action          TEXT NOT NULL CHECK (action IN ('carry', 'release')),
  -- Destination of a carry; all three NULL on a release (the CHECK below). These NULLs mean "no
  -- destination", not "unknown", which is why the constraint ties them to the action.
  -- CASCADE: if the destination category is deleted, the carry goes with it and the amount returns
  -- to the source bucket's balance, since the plan it raised no longer exists.
  to_category_id  INT REFERENCES budget_categories(id) ON DELETE CASCADE,
  to_year         INT,
  -- 1-based, like budget_unspent.month. "Current month or later" is enforced by the allocation
  -- endpoint: it depends on today's date, which a CHECK cannot read.
  to_month        INT CHECK (to_month BETWEEN 1 AND 12),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A carry names its full destination and a release names none of it. Without this, a carry with
  -- a missing month would raise no month's plan while still draining the bucket.
  CONSTRAINT budget_unspent_moves_destination
    CHECK ((action = 'carry') = (to_category_id IS NOT NULL AND to_year IS NOT NULL AND to_month IS NOT NULL))
);

-- Serves effective_budget(y): every carry into one year. Partial, because a release has no
-- destination and is never read this way.
CREATE INDEX IF NOT EXISTS budget_unspent_moves_into
  ON budget_unspent_moves (to_year, to_category_id) WHERE action = 'carry';

-- Every budget category's plan for year y, with the carries into that year added.
--
-- WHY A FUNCTION AND NOT A WRITE INTO budget_categories. monthly_amounts is a YEAR-LESS repeating
-- schedule (NULL = spread annual_budget evenly over the 12 months), so there is no cell to add
-- "a carry into March 2027" to without also raising every other year's March. Instead the carries
-- live in budget_unspent_moves and this function overlays them. Readers of a year's plan JOIN this
-- function rather than reading the two raw columns; reading the raw columns is reading the plan
-- WITHOUT the owner's carries, which is a different, smaller number.
--
-- CONTRACT, relied on by every reader:
--   * A category with NO carries into year y returns EXACTLY its stored annual_budget and
--     monthly_amounts. NULL monthly_amounts stays NULL, so the reader's existing "NULL means spread
--     evenly" handling is untouched for every category the feature has not touched.
--   * A category WITH carries into y returns annual_budget + the sum of those carries, and an
--     explicit 12-element schedule, January first: for each month g,
--     COALESCE(stored monthly_amounts[g], annual_budget / 12) + carries into month g.
--     The NULL schedule has to be expanded here because one month now differs from the rest.
--   * annual_budget / 12 is NUMERIC division and is NOT rounded to cents here. A reader comparing
--     or summing these values must round, exactly as it already must for its own even spread.
--
-- STABLE, not IMMUTABLE: it reads tables. Every category is returned, including income and
-- excluded ones (which never receive carries, so pass through unchanged); filtering stays with the
-- caller, as it does for budget_categories itself.
CREATE OR REPLACE FUNCTION effective_budget(y INT)
RETURNS TABLE (category_id INT, annual_budget NUMERIC, monthly_amounts NUMERIC[])
LANGUAGE sql STABLE
AS $$
  WITH carried AS (
    SELECT to_category_id AS cid, to_month AS m, SUM(amount) AS amt
      FROM budget_unspent_moves
     WHERE action = 'carry' AND to_year = y
     GROUP BY 1, 2
  ),
  touched AS (SELECT DISTINCT cid FROM carried)
  SELECT bc.id,
         CASE WHEN t.cid IS NULL THEN bc.annual_budget
              ELSE bc.annual_budget + (SELECT COALESCE(SUM(c.amt), 0) FROM carried c WHERE c.cid = bc.id)
         END,
         CASE WHEN t.cid IS NULL THEN bc.monthly_amounts
              ELSE ARRAY(
                SELECT COALESCE(bc.monthly_amounts[g], bc.annual_budget / 12)
                       + COALESCE((SELECT c.amt FROM carried c WHERE c.cid = bc.id AND c.m = g), 0)
                  FROM generate_series(1, 12) g
                 ORDER BY g)
         END
    FROM budget_categories bc
    LEFT JOIN touched t ON t.cid = bc.id
$$;

-- Down Migration
-- Drops exactly the function and the two tables above, function first since it reads the moves
-- table. Every recorded close and every allocation is lost; they are stored nowhere else. Budgets
-- revert to their stored schedules, which is a complete revert rather than a partial one, because
-- carries were only ever overlaid by effective_budget and never written into budget_categories.
-- Readers that JOIN effective_budget must be reverted before this runs.
DROP FUNCTION IF EXISTS effective_budget(INT);
DROP TABLE IF EXISTS budget_unspent_moves;
DROP TABLE IF EXISTS budget_unspent;
