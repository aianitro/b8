# year-end-moves — contract record

Owner's request (ROADMAP backlog "[P1] How much did the year-end P/L target move, and what moved
it"). On 2026-10-12 the owner chose to show both "since yesterday" and "since month start". Plan
drift (the target against the plan the year started with) is out of scope.

## Surface (G1, authored by contract-guardian under lease `year-end-moves`)

- `migrations/1792200000000_year-end-snapshots.sql`, mirrored in `db/schema.sql` directly after the
  `net_worth_snapshots.liabilities_security_deposits` ALTER:
  - `year_end_snapshots`, one row per snapshot_date × landscape × budgeted category:
    - `snapshot_date DATE NOT NULL`: the app's local calendar date of the morning described.
    - `landscape TEXT NOT NULL CHECK IN ('operational','capital')`.
    - `category_name TEXT NOT NULL`: the name, not an id (reason in the migration).
    - `is_income BOOLEAN NOT NULL`.
    - `plan NUMERIC(12,2)[] NOT NULL`, constraint `year_end_snapshots_plan_twelve_months`.
    - `actuals NUMERIC(12,2)[] NOT NULL`, constraint `year_end_snapshots_actuals_twelve_months`.
    - `recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
    - `PRIMARY KEY (snapshot_date, landscape, category_name)`.
- No change to `shared/types.ts` or `shared/contracts/**`. No route or contract type returns these
  rows today, so a row type, if the reader needs one, is local to the reader.
- Classification (BUILD.md §9.2): **additive**. One new table. No existing column, default,
  constraint, function or row changes. No backfill, so no CSV backup is required.

## Why this is a stored table, given that the projection is a derived read

The projection stays derived. It is computed by `apps/web/lib/domain/yearEnd.ts` and read through
`apps/web/lib/yearEndRead.ts`, and no column anywhere holds it. What is stored are its inputs as of a
morning. Those cannot be rebuilt later:

- The plan is edited in place. `budget_categories.annual_budget` and `monthly_amounts` keep no
  history.
- The ledger is edited in place. Re-filing rewrites `transactions.mapped_category`, hiding flips
  `transactions.hidden`, and deleting a row leaves no trace. `transactions.created_at` would recover
  late arrivals and nothing else.

That is the `net_worth_snapshots` exception (BUILD.md §5.3) and the `budget_unspent` precedent. A
total-only row cannot be decomposed into its four causes. The per-category 12-month plan and
actuals arrays can.

## Where the guardian departed from the requested surface, and why

No column, type, key or default departs from the request. Two points tighten or clarify it:

1. **The 12-element CHECK checks the array's shape as well as its count.** Each array constraint is
   `array_ndims(x) = 1 AND array_lower(x, 1) = 1 AND cardinality(x) = 12 AND
   array_position(x, NULL) IS NULL`. A bare `array_length(x, 1) = 12` lets three wrong arrays through:
   - **An empty array.** `array_length` returns NULL for an empty array, and a CHECK that evaluates to
     NULL passes.
   - **A 2-D array with 12 elements.** `cardinality` alone counts every element, so a 3×4 array would
     pass without `array_ndims`.
   - **A `[0:11]` array.** It has 12 elements, but `x[1]` would then read February, and every month
     would be shifted by one with no error.

   `array_position(x, NULL)` finds NULL elements, because it compares with `IS NOT DISTINCT FROM`.
2. **An absent snapshot is defined as unknown.** If a (snapshot_date, landscape) has no rows, no
   snapshot was taken that day. It does not mean nothing was budgeted. The migration states this, so
   that a reader never reports a missing day as a move of zero. It also stops a reader from treating
   every category in the later snapshot as newly added, which would report the whole target as one
   giant plan edit.

## Rules the implementer must follow

Each rule below is a constraint the schema cannot express. The reviewer should hunt for violations
by name.

1. **First write wins for the whole (snapshot_date, landscape), not row by row.** Do not use
   `INSERT ... ON CONFLICT DO NOTHING` as the idempotency mechanism. It would let a second run that
   day add rows for a category created between the two runs, so that one snapshot describes two
   mornings. Instead, write each landscape's rows in one transaction:
   1. Take `pg_advisory_xact_lock` on a fixed key for this table. The lock serialises two
      overlapping runs.
   2. Check `EXISTS (SELECT 1 FROM year_end_snapshots WHERE snapshot_date = $1 AND landscape = $2)`.
   3. If a row exists, write nothing. If none exists, insert every row.

   A failure partway through must roll back the whole landscape-day.
2. **One definition of the inputs.** Build the snapshot's per-category plan and actuals with the
   same query and filters as `loadYearEnd`: `exclude_from_budget = FALSE`, the landscape,
   `effective_budget(year)`, `hidden = FALSE`, `track_transactions = TRUE`, and the name match on
   `mapped_category`. Extract that query into one shared function, then call it from both
   `loadYearEnd` and the writer. A second copy of the query is the drifting-definitions defect
   (BUILD.md §1), aimed at the figure the owner steers by. Two notes on that query:
   - The existing `monthly_actuals` subquery matches `t2.mapped_category = bc.name` with no landscape
     scoping. The snapshot must reproduce the live read exactly, including that behaviour. Whether
     the behaviour is itself a defect is a separate task (see recommendation 3), not this one.
   - Uncategorized money is not snapshotted, since it is counted in no projected figure.
3. **`plan` is the resolved schedule.** If `effective_budget` returns a 12-element `monthly_amounts`,
   use it. Otherwise use `annual_budget / 12` for each month. The rule matches `plannedForMonth`.
   Round each month to cents in SQL (`ROUND(x, 2)`) before writing. Store plans as positive amounts
   for income and spending alike, never in the ledger's sign.
4. **`actuals` are in the ledger's sign**: money out positive, money in negative. Round each month to
   cents. Write all 12 months, with 0 for a month that has no transactions. Never write NULL.
5. **`snapshot_date` is the app's local calendar date.** It is not `CURRENT_DATE` under a UTC
   session. The year and month the writer projects must be the year and month of `snapshot_date`.
   A writer that projects one month and dates the row in another produces a calendar step from
   nothing.
6. **Decompose from stored numbers only, in a fixed order.** Treat each side as a state of
   (plan[], actuals[], month in progress). From A (earlier) to B (later), substitute in this order:
   1. All plans, A to B.
   2. Actuals for months before A's month in progress.
   3. Actuals for A's month in progress and every later month, so that each array element is
      replaced in exactly one step.
   4. The month in progress, A to B.

   The four steps then sum exactly to projection(B) − projection(A). The decomposition depends on
   the order, because the month in progress takes `max(actual, plan)`. Pin the order, and add a test
   asserting that the steps sum to the total.
7. **Match categories across two snapshots by (landscape, category_name).**
   - A category present on one side only gets a plan of zeros and actuals of zeros on the other side.
   - Project each side with its own `is_income`. A category whose `is_income` flipped is removed from
     one side and added to the other.
   - A rename reads as a removal plus an addition, with offsetting moves in steps 1 to 3. State this
     in the UI, or accept it; do not paper over it.
8. **The live figure and the snapshot figure differ by rounding.** `loadYearEnd` uses the unrounded
   even spread, and the snapshot stores the spread rounded to cents. If the "now" end of "since
   yesterday" is live rather than this morning's snapshot, build it through the same rounded
   per-category builder as the writer. Never compute it as `loadYearEnd().profitLoss`, or a residual
   of a few cents appears that belongs to no step. Never compare a JavaScript number with a stored
   NUMERIC without rounding both to cents.
9. **Baselines.**
   - "Since yesterday" uses the snapshot dated the day before.
   - "Since month start" uses the snapshot dated the 1st of the current month.

   If the baseline snapshot is missing, the move is unknown and renders "—". Never render it as zero,
   and never silently substitute an older date. If the spec chooses a fallback, for example the
   earliest snapshot in the month, the UI must show the date actually used. On 1 January, "since
   yesterday" compares two different years' targets, so the spec must decide what that shows.
10. **No figures leave the machine.** These rows hold figures and category names. Keep them out of
    push payloads, logs, fixtures copied from a real database, and commit messages.

## Rollback

`migrate:down` drops the table, and every recorded morning is lost. The data is not reconstructible,
which is the reason the table exists. Revert the reader and the writer before running it. No
backfill is possible, because past mornings were never observed. The first snapshot is the first
morning the job runs after deploy. "Since month start" therefore has no baseline until the 1st of
the following month, unless the spec accepts the fallback in rule 9.

## Recommendations (not done; outside this task's surface or scope)

1. **Rename continuity.** If renames turn out to be common, an additive nullable
   `category_id INT` (no foreign key, so a deleted category's history survives) would let a reader
   match a renamed category across snapshots. It was not added because the request keyed on the
   name, and transactions do too.
2. **Retention.** None is needed. Volume is the number of budgeted categories per landscape per day,
   on the order of tens of thousands of rows a year.
3. **The cross-landscape name match** in `loadYearEnd`'s `monthly_actuals` subquery (the
   `t2.mapped_category = bc.name` join, unscoped by landscape) should be checked as its own task
   against the "JOIN where EXISTS was needed" hazard (BUILD.md §10.3). This task must not change it,
   because then the snapshot and the live read would be computed under different definitions.
