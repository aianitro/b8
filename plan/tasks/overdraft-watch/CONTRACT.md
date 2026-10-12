# overdraft-watch — contract record

Owner's request (2026-10-12, ROADMAP backlog "[P1] Overdraft watch"), first half: detect a depository
account that is already below its cushion, and send a PWA push when it goes below. Per-account opt-out
for accounts where a low reading is not a danger (overdraft protection linked to savings). Projection
("will go negative") is the second half and is not part of this surface.

## Surface (G1, authored by contract-guardian under lease `overdraft-watch`)

- `migrations/1792000000000_overdraft-watch.sql`, mirrored in `db/schema.sql`:
  - `accounts.overdraft_watch BOOLEAN NOT NULL DEFAULT TRUE` — per-account opt-out.
  - `accounts.overdraft_cushion NUMERIC(12,2) NOT NULL DEFAULT 0`, `CHECK (overdraft_cushion >= 0)`
    (constraint `accounts_overdraft_cushion_nonnegative`) — an episode is a reading **strictly** below
    this line.
  - Both columns are inert on any account that is not a Plaid-fed depository account.
  - `overdraft_episodes` — one row per stretch below the cushion: `account_id` (FK `ON UPDATE CASCADE
    ON DELETE CASCADE`), `opened_at`, `closed_at` (NULL = open), `cushion`, `low_balance`,
    `last_balance`, `last_seen_at`, `pushed_at`, with five named CHECKs and the partial unique index
    `overdraft_episodes_one_open ON (account_id) WHERE closed_at IS NULL`.
- The watched balance is `min(available, current)` from Plaid at sync time, over whichever of the two
  Plaid reported. If neither was reported, that sync made no observation of the account.
- Classification (BUILD.md §9.2): **additive**. One new table, one new index, two new columns that are
  NOT NULL with constant defaults. No existing column changes type, nullability, default or meaning, and
  no existing row is written beyond receiving the defaults. No backfill, so no CSV backup is required.

## Where the guardian departed from the requested surface, and why

1. **Added `overdraft_episodes.cushion`** (the cushion the episode opened against). The requested
   surface had none. `accounts.overdraft_cushion` is mutable and keeps no history, so once the owner
   changes it, every past episode would be read against a line that did not exist when it opened. This
   is a semantic change with no type change (§9.2's trap), and it cannot be reconstructed later. That
   is the `net_worth_snapshots` argument, so the value is stored.
2. **FK `ON DELETE CASCADE` kept as requested, although it differs from the other `accounts(id)`
   references.** `account_valuations`, `cash_counts`, `transactions` and `account_balances` use
   `ON UPDATE CASCADE` alone. `ON UPDATE CASCADE` is matched. `ON DELETE CASCADE` stays because an episode
   is alert state with no meaning apart from its account. Under NO ACTION, any account-delete path
   would start failing the first time that account had ever been low.
3. **Added CHECKs the request did not list:**
   - `last_seen_at` lies within `[opened_at, closed_at]`.
   - `pushed_at >= opened_at`.
   - `low_balance <= last_balance`.
   - `low_balance < cushion`.

   The last one is the important one. If the writer stores a magnitude for an overdrawn balance, which
   is the repo's recurring sign trap, the INSERT fails. Without the CHECK, the row would be written and
   would read as healthy.
4. **Pinned `last_balance` / `last_seen_at` semantics.** They are the most recent *below-cushion* reading.
   Closing an episode sets `closed_at` and nothing else. As requested, `last_balance` is a mutable
   "latest" column, which this role normally refuses. It is accepted here only because the reading is
   stored nowhere else and `last_seen_at` comes with it. Readers must show that timestamp's age, and must
   never present `last_balance` as the balance now.

## Semantics the implementer must honour (stated in the migration comments)

- Lifecycle per *observed* watched account, judged against the **current** `accounts.overdraft_cushion`:
  - Below the cushion with no open episode: INSERT.
  - Below the cushion with an open episode: UPDATE `last_balance` and `last_seen_at`, and set
    `low_balance = LEAST(low_balance, reading)`.
  - At or above the cushion with an open episode: set `closed_at` only.
- **Not observed ≠ recovered.** If the feed is down, Plaid omits both balances, or `overdraft_watch` is
  turned off, the open episode stays OPEN. Turning the watch off must not close an episode.
- `pushed_at` NULL on an open row means retry on the next sync. NULL on a closed row means it was never
  delivered, and it is never pushed late. "Delivered" means at least one live `web_push_subscriptions`
  row accepted the send.
- Balances are signed (negative = overdrawn) and rounded to cents before every write and every
  comparison.
- The unique index is the concurrency guard. If a second open INSERT hits a unique violation, treat
  that as "already open" and do not push.

## Recommendations to the orchestrator

1. **Payload — escalation check before G2.** `web_push_subscriptions` stores no encryption keys, so the
   push cannot carry content. The service worker shows one constant text (P3-25 DECISION, option C).
   An overdraft push therefore cannot be told apart from the daily ping on the lock screen unless the
   app fetches the detail over the tailnet when it is opened. The spec must state which of these holds:
   - the overdraft push reuses the content-free ping; or
   - a distinguishable push needs a new owner decision under BUILD.md §5.1.

   Nothing in this surface permits a balance, an account name or a mask in a push.
2. **First sync after deploy.** `overdraft_watch` defaults to TRUE, so any depository account that is
   already below zero opens an episode and pushes on the first sync. That is the requested
   "already negative" behaviour. The owner should expect it.
3. **Manual / non-Plaid depository accounts** have no `available`/`current` to watch. The schema
   treats both columns as inert there. The settings UI should not offer the cushion on such accounts,
   because offering it implies the account is watched.
4. **Second half (projection).** Do not add a "projected low" column to `overdraft_episodes`. A
   projection is a derived read that moves on every sync. If it needs a record, that record is its own
   table with its own episode semantics.
5. **Verification.** The guardian holds no Bash, so the round trip below was **not run**. The
   orchestrator must run it at G1 against the scratch DB only, and never against `b8_finance`:
   `export DATABASE_URL=postgres://localhost/b8_p640f && npx node-pg-migrate up && npx node-pg-migrate down && npx node-pg-migrate up`
   Use plain `npx node-pg-migrate` here, not `npm run migrate:*`. Those npm scripts pass
   `--envPath apps/web/.env.local`, and that file is the one pointing at the owner's database. The
   exported variable should take precedence, because dotenv does not override variables that are
   already set. The safety of the round trip should not depend on that precedence, so leave the env
   file out entirely. Before running, check that the target is right with
   `psql "$DATABASE_URL" -c 'select current_database()'`; it must print `b8_p640f`.
