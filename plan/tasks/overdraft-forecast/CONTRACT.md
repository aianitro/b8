# overdraft-forecast — contract record

Owner's request (2026-10-12, ROADMAP backlog "[P1] Overdraft watch"), second half: warn when a watched
depository account is about to go below its cushion within 7 days, before it has. The first half
(already below the cushion) is `plan/tasks/overdraft-watch/CONTRACT.md` and migration
`1792000000000_overdraft-watch.sql`. That record's recommendation 4 said a projection must not become
a column on `overdraft_episodes`, and that if it needed a record, the record would be its own table.
This is that table.

## Surface (G1, authored by contract-guardian under lease `overdraft-forecast`)

- `migrations/1792100000000_overdraft-forecast.sql`, mirrored in `db/schema.sql` directly after
  `overdraft_episodes_one_open`:
  - `overdraft_forecasts`, one row per stretch during which an account's 7-day projection goes
    strictly below its cushion while the account has no open episode. Columns:
    - `account_id`: FK `ON UPDATE CASCADE ON DELETE CASCADE`.
    - `opened_at`, and `closed_at` (NULL = open).
    - `closed_reason`: `'cleared' | 'episode'`. It is NULL exactly when the row is open.
    - `cushion`: `NUMERIC(12,2)`, `>= 0`.
    - `balance`, `projected_low`: `NUMERIC(14,2)`, signed.
    - `low_on`: `DATE`.
    - `charges`: `JSONB NOT NULL`, no default, a non-empty array.
    - `projected_at`, `pushed_at`.
  - Six named CHECKs, plus the two inline ones (`cushion >= 0` and the `closed_reason` value list).
  - The partial unique index `overdraft_forecasts_one_open ON (account_id) WHERE closed_at IS NULL`.
- Classification (BUILD.md §9.2): **additive**. One new table and one new index. No existing column,
  default, constraint or row changes. No backfill, so no CSV backup is required.

## Where the guardian departed from the requested surface, and why

1. **`cushion` is the cushion of the latest stored projection, refreshed with it.** The request
   asked for the cushion the forecast opened against, following the episode precedent. The episode
   precedent fits episodes because their readings build up over the episode's life (`low_balance`
   only falls). A forecast's projection columns are replaced on every refresh. Suppose an opening
   cushion sat next to a refreshed balance and low:
   - The row would no longer explain why it is open.
   - The requested `balance >= cushion` CHECK would fail on a legitimate UPDATE after the owner
     lowered the cushion.

   With the cushion refreshed, the six projection columns always describe a single projection. Both
   `balance >= cushion` and `projected_low < cushion` can then be CHECKs, and nothing the owner does
   to `accounts.overdraft_cushion` can invalidate a stored row. Nothing that matters is lost:
   `accounts.overdraft_cushion` keeps no history, and the line a forecast was measured against is
   the line of the projection it shows.
2. **`balance >= cushion` is a CHECK** (`overdraft_forecasts_start_at_or_above_cushion`). Departure 1
   is what makes that safe. A start below the cushion is an episode, never a forecast.
3. **`projected_low < cushion` is a CHECK** (`overdraft_forecasts_low_below_cushion`). This is the
   same sign-trap guard as `overdraft_episodes_low_below_cushion`: a magnitude stored for a negative
   projected balance fails the write. Together with departure 2, it forces `projected_low < balance`.
4. **`closed_reason` values renamed to `'cleared'` and `'episode'`**, from the requested
   `'recovered'` and `'overdrawn'`.
   - "Recovered" claims the account had been in trouble. It never was: the projection stopped dipping
     because a deposit landed, a charge stopped being expected, or the cushion was lowered.
   - "Overdrawn" is false whenever the cushion is above zero, because an episode means below the
     cushion, not below zero.

   A stored reason should claim only what was observed.
5. **`charges` has no DEFAULT and must be a non-empty array** (`overdraft_forecasts_charges_nonempty_array`).
   The request asked for `DEFAULT '[]'`. Only outflows lower a projection, so a projection that
   starts at or above the cushion and ends below it has at least one outflow. An empty list would
   therefore be a forecast with no cause. Under a default, an INSERT that forgot the column would
   write one silently; without the default, it fails. This follows the `alert_sends.delivered`
   no-default precedent.
6. **JSONB kept, not a child table.** The array is replaced wholesale on every refresh, is never
   queried by element, and has no meaning apart from its projection. A child table would turn each
   refresh into a delete plus N inserts to keep consistent with the parent, and would buy nothing.
   The element shape is not CHECKed in SQL. It is pinned in the comments and below, and should be
   pinned in `shared/types.ts` (recommendation 1).
7. **Added CHECKs the request did not list:**
   - `closed_reason` is NULL exactly when the row is open, as the request asked.
   - `closed_at >= opened_at`.
   - `projected_at` lies within `[opened_at, closed_at]`.
   - `pushed_at` lies within `[opened_at, closed_at]`.

   The `pushed_at` CHECK goes further than episodes do. It makes "a closed forecast is never pushed
   late" a property of the database instead of a convention.
8. **`low_on` is not range-CHECKed against `projected_at`.** `projected_at::date` depends on the
   session time zone, so a CHECK would pass or fail depending on the connection. The 7-day bound is
   stated in the comments and is the implementer's to enforce.

## Semantics the implementer must honour (stated in the migration comments)

- **Who is evaluated.** Each watched (`overdraft_watch = TRUE`) Plaid-fed depository account that
  the sync **observed**. Observed means Plaid reported `available` or `current`. The watched balance
  is `min` over whichever of the two were reported, the same as for episodes.
- **Lifecycle**, judged against the **current** `accounts.overdraft_cushion`:
  - The account has an open episode, or opens one on this sync: close any open forecast with
    `closed_reason = 'episode'`, and open none. Do the episode INSERT and the forecast close in one
    transaction, so no reader sees both open.
  - No episode, projected low `<` cushion, none open: INSERT, with all projection columns taken from
    this projection.
  - No episode, projected low `<` cushion, one open: UPDATE `cushion`, `balance`, `projected_low`,
    `low_on`, `charges` and `projected_at` **together**. Never update a subset of them.
  - No episode, projected low `>=` cushion, one open: set `closed_at` and `closed_reason = 'cleared'`
    and nothing else. The closed row keeps the last projection that went below.
  - An account observed with no detectable recurring series projects flat, and that clears an open
    forecast. "No series" is an observation. It is not a missing one.
- **Not observed ≠ cleared.** If the feed is down, Plaid omits both balances, `overdraft_watch` is
  turned off, or the account is no longer depository, leave the forecast exactly as it was.
- **Projection rules:**
  - The window is 7 days.
  - Outflows apply on their due day.
  - Inflows count only from the day **after** they land.
  - "Strictly below": a projected low exactly at the cushion opens nothing.
  - Rounding: round to cents at every step of the running balance, and before every write and every
    comparison.
- **Signs.** `balance` and `projected_low` are signed (negative = overdrawn). `charges[].amount` is
  a **positive magnitude**. The two conventions sit side by side on one row, so the writer must not
  copy one into the other.
- **`low_on`** is the **first** local calendar day on which `projected_low` is reached, within the
  7 days after `projected_at`'s local date. Use the same zone the recurring due days are computed in.
- **`charges`** is every projected outflow due on or before `low_on`, in date order, as
  `[{ "label": string, "amount": number, "on": "YYYY-MM-DD" }]`, with `amount` rounded to cents. It
  is for display only: never sum it back into money math, because `projected_low` is authoritative.
  It is never empty.
- **Push.**
  - `pushed_at` NULL on an open row means retry on the next sync. NULL on a closed row means it was
    never delivered, and it is never pushed late (enforced by `overdraft_forecasts_pushed_while_open`).
  - "Delivered" means at least one live `web_push_subscriptions` row accepted the send.
  - The push carries no content. It never carries a figure, a merchant label, an account name or a
    mask.
- **Concurrency.** A unique violation on `overdraft_forecasts_one_open` means a forecast is already
  open. Treat it that way, and do not push.
- **Readers** show `projected_at`'s age beside the projection columns. They never present `balance`
  as the balance now, or `projected_low` as the current forecast.

## Recommendations to the orchestrator

1. **Type surface, if the implementer needs one.** If a route or component returns a forecast, the
   row shape, including the `charges` element type, belongs in `shared/types.ts`. Reopen the lease
   for that rather than letting a local interface appear in `lib/`. This record did not touch
   `shared/types.ts`: the brief listed three files, and the domain module can type its own
   internals.
2. **Push interplay with episodes.** A forecast that comes true is closed as `'episode'`, and the
   episode pushes for itself. Because the push is content-free, the owner sees two identical pings
   for one event: the forecast's earlier and the episode's later. That is acceptable, but the spec
   should state it as intended rather than leave it to be discovered. If it is not wanted, it needs
   an owner decision about the payload (see the first half's recommendation 1). No schema change can
   fix it.
3. **Series detection is not schema.** Cadence buckets, the minimum of 3 occurrences and the
   amount-stability tolerance live in `lib/domain/cashForecast.ts`. The spec's negative controls
   should cover the following cases:
   - A series with only 2 occurrences.
   - An inflow landing on the low day itself (it must not lift that day).
   - A low exactly at the cushion (it must open nothing).
4. **Verification.** The guardian holds no Bash, so the round trip below was **not run**. The
   orchestrator runs it at G1 against the scratch DB `b8_p640f` only, and never against
   `b8_finance`. First confirm the target: `psql "$DATABASE_URL" -c 'select current_database()'`
   must print `b8_p640f`. Then run:
   `export DATABASE_URL=postgres://localhost/b8_p640f && npx node-pg-migrate up && npx node-pg-migrate down && npx node-pg-migrate up`
   Do not use the `npm run migrate:*` scripts, because they load `apps/web/.env.local`, the
   owner-database env file. Suggested CHECK probes after `up`, each of which must be rejected:
   - An INSERT with `charges = '[]'`.
   - An INSERT with `balance < cushion`.
   - An INSERT with `projected_low >= cushion`.
   - An UPDATE that sets `closed_at` without `closed_reason`.
   - A second open INSERT for the same `account_id`.
