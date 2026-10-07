# P6-40e-plaid-rekey — Re-key stored Plaid rows to the ids Plaid now uses
**Roadmap item:** ROADMAP.md §5 step 40e. A one-off, re-runnable script that re-keys only unambiguous one-to-one matches, using sync's own matcher, dry-run first, with a verified CSV backup. Plus a tested root cause for why sync did not re-key these rows, with a fix if the cause is still live in code.
**Status:** FROZEN@G0 (2026-10-07; reconciliation in the G0 record at the end)
**Author:** spec-writer

## Goal
Add an operator-run script, `npm run rekey:plaid-ids -w @b8/web [-- --apply]` (root forwarder `npm run rekey:plaid-ids -- ...`).

For every Plaid item in the database, the script reads the item's current transaction history from Plaid. It then finds stored rows whose `plaid_transaction_id` Plaid no longer uses (orphans) and pairs each orphan with a Plaid transaction that is the same transaction under a new id. "Same transaction" is decided by sync's own matcher, `matchReissuedTransactions` in `apps/web/lib/domain/txnMatch.ts`, and by no second definition (§10.3, "two definitions of one concept"). A pair is re-keyed only if it is strictly one-to-one.

A re-key changes one column, `plaid_transaction_id`, on one existing row, selected by primary key. The script never inserts or deletes a row. It never touches `accounts` (including `accounts.cursor`) or `transaction_tombstones`, and it changes no other `transactions` column.

- **Dry run (default):** writes nothing (no database write, no file) and reports counts only.
- **`--apply`:** first writes a verified CSV backup of the full pre-update rows it is about to change, then updates them in one transaction per item. Each UPDATE re-checks, inside the statement, that the row still holds its old id and that the new id is still unused and not tombstoned.
- **Idempotency:** a second `--apply` re-keys nothing.
- **Output:** neither stdout/stderr nor the returned summary contains a name, merchant, amount, date, id, token, cursor or raw error object.

Separately, the task must deliver a **root-cause finding** (RC section below). It must explain, with tests, why sync did not re-key these rows although the exchange-token route resets the cursor on a token change. If the explanation is a defect still live in current code, the task fixes it with a regression test. Otherwise the evidence says so, with commit or reasoning.

**Decisions made by this spec (owner-approved scope made precise):**
- **D1 Endpoint and walk.** Same as 40c's D1. Each item's history is read with `/transactions/sync` from NO cursor, following `next_cursor`/`has_more` in memory, and the final cursor is discarded. The stored `accounts.cursor` is never selected or sent. 40c's walk guards (cursor-must-advance, page cap) apply and fail the item whole. The script reuses 40c's shared machinery rather than copying it:
  - argument parsing
  - the backup-directory refusal
  - the verified backup writer
  - the error-code allowlist
  - the history walk
  - Editing `apps/web/scripts/backfill-enrichment.ts` to export or extract those pieces is allowed. Its observable behaviour must not change, and its test file must stay green unmodified (acceptance #9).
- **D2 Items and scoping.** Items are the distinct non-null `accounts.access_token` values, as in 40c D5. They are processed in a stable order and named only by 1-based ordinal. For an item, the stored side is rows whose `account_id` belongs to that item. The Plaid side is statements whose `account_id` belongs to that same item. A stored row is never paired with a statement from another item's walk, and never with a statement carrying a different `account_id`.
- **D3 "Current history".** The set of ids in an item's walk, minus any id named in a `removed` list of that walk. This is deliberately stricter than 40c, which ignores `removed`. An id that was added and then removed during the walk is neither "present" for the holder of that id nor a valid re-key target. Pending statements are present for the "not orphaned" test (see D4) but are never a re-key target.
- **D4 Stored-row classification.** The first applicable bucket wins, in this order, for every stored row on the item's accounts:
  1. `excluded_csv_manual`: id starts with `csv_` or `manual_`. Never re-keyed, regardless of whether Plaid has a lookalike (owner decision: CSV rows stay CSV rows).
  2. `stored_tombstoned`: the row's own id is in `transaction_tombstones`. Not re-keyed, and kept out of the pool, as sync keeps it out.
  3. `not_orphaned`: the row's id is in Plaid's current history (D3), pending or posted. Untouched.
  4. Otherwise it is an **orphan**.
- **D5 Orphan classification.** Let K be the matcher's key for the orphan, and let C be the posted, current (D3) Plaid statements in the item's accounts with key K. The orphan's bucket is the first that applies:
  - `no_match`: C is empty.
  - Remove from C every statement whose id is stored on ANY row in the database (any account, any item). Remove every statement whose id is tombstoned. Call the rest C_free.
  - If C_free is empty, the bucket is `excluded_new_id_stored` if any removed statement was removed for being stored. Otherwise it is `excluded_new_id_tombstoned`.
  - If C_free is non-empty: let S be the number of orphans with key K, plus the number of `csv_`/`manual_` rows on the item's accounts with key K. Let P be |C_free|.
    - The orphan is `would_rekey` iff S = 1 and P = 1.
    - Otherwise it is `ambiguous`, counted once per stored orphan row. That covers 1 stored vs several candidates, several stored vs 1 candidate, and equal multiplicity above 1 (for example 2 vs 2). A CSV/manual row sharing the key with an orphan and a candidate makes that orphan ambiguous. The owner may relax this at G0 (D-csv, flagged below).
  - A tombstoned statement therefore never uses up a claim, and never makes a group ambiguous. This mirrors sync's re-identification block (P6-40a NITS N1 reasoning).
- **D-csv (flag for G0).** CSV/manual rows count on the stored side only for ambiguity (D5). They are never re-keyed.

## Non-goals
Each is something an implementer might plausibly reach for. The reviewer enforces them as defects.
- **No enrichment.** Do not write `plaid_raw`, `logo_url`, `authorized_date`, location or any 40b column. A re-keyed row stays un-enriched, and 40c's re-run does the enrichment afterwards.
- **No change to the matching rules.** Do not change the matcher's key (account, date, amount to 2 dp, trimmed lowercase name). Do not add fuzzy name, date-window or amount-tolerance matching. A small export or refactor of `txnMatch.ts` so the script can share the key definition is allowed. Its existing tests must pass unmodified, and sync's behaviour must be byte-identical.
- **No CSV/manual re-keying.** Do not re-key, delete or merge `csv_`/`manual_` rows, even when a Plaid lookalike exists.
- **No deduplication.** Do not merge, delete or flag genuine duplicates, including rows that arose when sync inserted a second copy under the new ids. Never DELETE.
- **No INSERT of Plaid transactions.** Plaid statements with no stored counterpart (for example, ones dated this month that the next sync will deliver) are counted and left alone.
- **No `accounts` or cursor write.** No call to reconcile, `/item/get`, `/institutions/get_by_id`, `/accounts/get`, `/transactions/refresh` or `/transactions/get`. No `recordPlaidBalances`.
- **No tombstone writes or deletions.** Tombstones are read only.
- **No act on Plaid's `removed` list.** It is read only to compute D3, never to delete a local row.
- **No re-categorisation.** No rules are loaded, and `mapped_category` is never evaluated.
- **No amount, date or name rewrite.** Even where the matcher paired rows whose stored and Plaid values differ only in case or whitespace of `name`, `name` is left as stored.
- **No UI, API route, scheduler or daily-job wiring.** Nothing imports the script except its own test. No CI wiring. No CSV encryption or rotation, and no change to `scripts/backup.ts`.
- **No migration, no `db/schema.sql` edit, no `packages/contracts` change.**
- **No change to `lib/sync.ts` or the exchange-token route** unless the root-cause finding (RC) identifies a live defect there. If it does, the fix is the minimal change that closes that defect and nothing else. It is not a refactor and not a change to matcher semantics.
- **The real run is an orchestrator step after merge**, not an acceptance command. Re-running 40c afterwards is likewise an orchestrator step.

## Contracts touched
none. The script reads existing tables and writes one existing column.

Files that change, none of them a contract surface:
- `apps/web/package.json`: one new script.
- Root `package.json`: one forwarder, with the trailing `--` as 40c's now has.
- `apps/web/vitest.integration.config.mts`: `include` gains the exact new test path(s). No glob.
- `apps/web/scripts/backfill-enrichment.ts`: export or extract only, if the shared pieces are factored out.
- `apps/web/lib/domain/txnMatch.ts`: an export only, if needed.
- `lib/sync.ts` and `exchange-token/route.ts`: only if RC finds a live defect.

If the implementer finds a schema need (for example no unique index on `plaid_transaction_id`), STOP and report. Do not work around it.

## Conventions this task must honor
- **Sign:** The script never converts, negates or writes `amount`. Stored Plaid rows hold Plaid's amount as sync wrote it (positive = money out), and the matcher compares stored and Plaid amounts in that same convention. So a stored `-X` and a Plaid `+X` are NOT the same transaction and are not re-keyed (`no_match`). Loan, mortgage and checking sign normalisation does not apply, because no amount is touched.
- **Rounding:** The script adds no rounding of its own. The only rounding is the matcher's `toFixed(2)` key, applied once to the stored value (`Number(row.amount)`) and once to Plaid's value, exactly as sync does. Counts are integers. No float appears in the output.
- **Landscape + exclusions:** None apply as filters. `hidden`, `exclude_from_budget`, `landscape`, `track_transactions` and `transfer_group_id` are neither read as filters nor written. A hidden row, an excluded-category row, a capital-landscape row and a row in a transfer group are re-keyed like any other, and keep every flag.
- **Null semantics:** Every count is a number, 0 when nothing applies, and never null or omitted. A row with `name` NULL is matched by the matcher's own rule (NULL equals NULL, and NULL never equals a non-empty name). The script writes no NULL and no empty string anywhere. Items that failed contribute no counts and appear only as `items_failed`.
- **Date handling:** The stored DATE is turned into a date-only string by the repo's shared helper `toDateInputValue` (as `lib/sync.ts` does) and never through `toISOString()`. The Plaid date string is used as given.
- **Output privacy:** Same rule as 40c. stdout/stderr contain only:
  - fixed English words, the mode, ordinals and integers
  - the backup file path and its row count
  - for a failed item, a Plaid error CODE matching `^[A-Z_]+$` (anything else prints `UNKNOWN`)
  - No names, merchants, amounts, dates, ids (transaction, account, item, institution), tokens, cursors, raw error objects, messages or response bodies.
  - The CSV is the one artifact that may hold real rows, and it is never printed.
  - Not the structured logger, because its lines carry timestamps.
- **Public repo (AGENTS.md):** Fixtures, comments, test titles and the evidence file contain only fabricated, obviously fake values. No figure from a real ledger appears. Counts of things are allowed.
- **Exit codes (as 40c):** 0 clean. 1 if any item failed or the backup could not be written/verified. 2 for a usage error or a refused backup directory.

## Toolchain prerequisites
| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | A scratch Postgres at `$DATABASE_URL` whose database name is not `b8_finance`, migrated through the current head | **yes** | `createdb b8_p640e_throwaway && DATABASE_URL=postgresql://localhost/b8_p640e_throwaway npx node-pg-migrate up` | `psql "$DATABASE_URL" -tAc "select current_database()"` prints a name other than `b8_finance`; `psql "$DATABASE_URL" -tAc "select count(*) from information_schema.tables where table_name in ('transactions','transaction_tombstones','accounts')"` prints `3` | filled in at G0 |
| T2 | 40a, 40b and 40c are merged (tombstone table, `plaid_raw`, `backfill-enrichment.ts`) | **yes** | merged | `ls apps/web/scripts/backfill-enrichment.ts apps/web/scripts/backfill-enrichment.test.ts` exit 0 | filled in at G0 |
| T3 | `PLAID_CLIENT_ID`/`PLAID_SECRET` absent from the acceptance runs | **yes** (must be absent) | `env -u` | `env -u PLAID_CLIENT_ID -u PLAID_SECRET sh -c 'echo ok'` prints `ok` | filled in at G0 |
| T4 | Live Plaid, the dev database, the owner's server | **NO** | n/a | n/a | n/a |
| T5 | `rekey:plaid-ids` registered in `apps/web/package.json` and root `package.json` | **yes, created by this task** | the implementer adds both, the root one in the `npm run X -w @b8/web --` form | acceptance #3, #4 | filled in at G0 |
| T6 | A Plaid-transport substitute for tests | **yes, created by this task** | requirement, not design: the script logic and sync's `runSync` are each callable from a test with fabricated `/transactions/sync` pages. That covers multi-page `has_more`, `modified` and `removed` lists, a rejecting fetch carrying a secret in `.config.headers`, and recording of every request's `cursor`. Only `@/lib/plaid` is faked, as in `scripts/backfill-enrichment.test.ts` and `app/api/v1/sync/enrichment.test.ts`. | acceptance #6, #7 | filled in at G0 |
| T7 | The new script test (DB-backed) must be in the integration set and NOT the pure set, so it lives outside `lib/` (suggested `apps/web/scripts/rekey-plaid-ids.test.ts`) and `include` in `vitest.integration.config.mts` names it exactly. The RC test file may live under `app/api/v1/` (already collected). Otherwise its exact path is added the same way. | **yes** | implementer | acceptance #10 | filled in at G0 |
| T8 | Unit-suite baseline recorded by the orchestrator at G0 (expected 72 files / 1112 tests after Phase 6) | **yes** | orchestrator | `npm test` | filled in at G0 |

## Acceptance commands
`⟨R⟩` = `(cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts --reporter=verbose scripts/rekey-plaid-ids.test.ts 2>&1)`, run with `$DATABASE_URL` set to the scratch database (T1), never `.env.local`'s value.

`⟨C⟩` = the same with the root-cause test file (path chosen by the implementer, recorded in EVIDENCE.md, and the orchestrator substitutes it).

Test titles must begin with the tags named below, each exactly once.

| # | Command | Expected |
|---|---|---|
| 1 | `cd apps/web && npx tsc --noEmit` | exit 0 |
| 2 | `npm test` | exit 0, no `failed` in the output, passed count at least the T8 baseline |
| 3 | `grep -c '"rekey:plaid-ids"' apps/web/package.json package.json` | `apps/web/package.json:1` and `package.json:1` |
| 4 | `DATABASE_URL=postgresql://nobody@127.0.0.1:1/b8_p640e_throwaway PLAID_CLIENT_ID=fixture PLAID_SECRET=fixture npm run rekey:plaid-ids -- --aply 2>&1; echo "exit=$?"` (from the repo root) | output contains `usage:` and `--apply`, and `exit=2`. A forwarder that swallows the flag would instead run and print "could not run", exit 1, and no `usage:`. |
| 5 | The same environment: `npm run rekey:plaid-ids -- --apply --backup-dir "$PWD/apps/web/p640e-x" 2>&1; echo "exit=$?"; ls apps/web/p640e-x 2>&1` | output contains `refusing a backup directory inside a git work tree`, `exit=2`, and `ls` reports no such directory. It proves the refusal precedes any DB or network access (port 1 is unreachable) and that no directory is created. |
| 6 | `⟨R⟩`, then for each tag `RK-01`..`RK-22`: `⟨R⟩ \| grep -c 'RK-<nn>'` | the run ends with all tests passed and 0 failed; each tag line count is exactly `1`. Tags are in "Tests required" below. |
| 7 | `⟨C⟩`, then for each tag `RC-01`..`RC-03`: `⟨C⟩ \| grep -c 'RC-<nn>'` | all passed; each tag count is exactly `1` (RC section below) |
| 8 | `cd apps/web && TZ=Pacific/Auckland env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts scripts/rekey-plaid-ids.test.ts 2>&1 \| tail -5` and the same with `TZ=America/Los_Angeles` | both end with all passed and 0 failed. This pins the date-only handling at UTC+ and UTC- offsets. |
| 9 | `(cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts scripts/backfill-enrichment.test.ts app/api/v1/sync 2>&1 \| tail -6)`; `git diff --stat -- apps/web/scripts/backfill-enrichment.test.ts apps/web/lib/domain/txnMatch.test.ts` | the first reports no failed test (40c's 19 and the existing sync route tests, unchanged); the second prints nothing, so neither test file was edited. If H4's two known failures sit in this set, the orchestrator records the baseline at G0 and compares against it. |
| 10 | `npm test -- --reporter=verbose 2>&1 \| grep -cE 'rekey-plaid-ids.test'` | `0` (the DB-backed test is absent from the pure suite) |
| 11 | `grep -c 'txnMatch' apps/web/scripts/rekey-plaid-ids.ts` | at least `1` (the script uses the shared matcher module) |
| 12 | `grep -cE 'toFixed\|toLowerCase\|toISOString' apps/web/scripts/rekey-plaid-ids.ts` | `0` (static pin per A7: no second definition of the match key or date handling). Comments must not contain these words either. |
| 13 | `grep -cE 'INSERT INTO\|DELETE FROM\|UPDATE accounts\|UPDATE transaction_tombstones\|TRUNCATE\|DROP ' apps/web/scripts/rekey-plaid-ids.ts` | `0`. If the script factors writes into a shared module, run the same grep on that module's changed region. |
| 14 | `grep -cE 'transactionsGet\|itemGet\|transactionsRefresh\|institutionsGetById\|accountsGet' apps/web/scripts/rekey-plaid-ids.ts && grep -c 'transactionsSync' apps/web/scripts/rekey-plaid-ids.ts apps/web/scripts/backfill-enrichment.ts` | first prints `0`. The second prints at least `1` for the walk's home. A stub passes #13 and #14 alone, which is why #6 carries the weight. |
| 15 | `git diff --name-only HEAD -- apps/web/lib/sync.ts apps/web/app/api/v1/plaid/exchange-token/route.ts apps/web/lib/domain/txnMatch.ts` | either empty, or non-empty and EVIDENCE.md has a "Root cause" section naming the defect and showing the regression test RED on the pre-fix code and GREEN after. For a `txnMatch.ts` export-only change the diff must add no logic, and `⟨C⟩` plus acceptance #9 must still pass. |
| 16 | `cd apps/web && DATABASE_URL=$DATABASE_URL env -u PLAID_CLIENT_ID -u PLAID_SECRET npx tsx scripts/rekey-plaid-ids.ts 2>&1; echo "exit=$?"` against a scratch DB with zero token-bearing accounts | exit 0, output states dry-run, every count is `0`, and no backup directory is created. A stub printing a canned zero report passes this alone. |

### Tests required (`apps/web/scripts/rekey-plaid-ids.test.ts`; fixtures fabricated; each RK test seeds everything it asserts on)
**Common fixture.** Three Plaid items with distinct fabricated tokens and accounts. Every account has a non-null sentinel `accounts.cursor`. Stored rows carry deliberately non-default owner-set values: `hidden=TRUE`, `watched_at`, `note`, `transfer_group_id`, `property_id`, a `mapped_category` with `rule_applied=FALSE`, one capital-landscape account, one excluded-category row. The fake Plaid layer serves fixture pages and records every request.

- **RK-01 dry run writes nothing.** Full-row snapshots of `transactions`, `accounts` and `transaction_tombstones` (all columns, ordered) are identical before and after, and no CSV exists. `would_rekey` is greater than 0, so a no-op reporting zeros fails.
- **RK-02 apply re-keys exactly the unambiguous orphans and changes only the id.** For each re-keyed row, the primary key `id` is unchanged. The new `plaid_transaction_id` equals the paired statement's id. Every OTHER column (including owner-set ones, `plaid_raw` staying NULL, `created_at`, `name`, `amount` and `date`) is identical to before. Compared as "all columns minus `plaid_transaction_id`". The rows in the fixture include a hidden row, a capital-landscape row, an excluded-category row and a row in a transfer group (no flag filter).
- **RK-03 same definition as sync.** The pairing includes a stored `WEBOX` and a Plaid `  webox ` (case and whitespace-insensitive, as the matcher). It excludes, each counted `no_match` and left untouched:
  - a different name
  - a date one day off
  - an amount differing by 0.01
  - an opposite-sign amount of equal magnitude
  - a different `account_id`
  - a stored NULL name against a non-empty Plaid name
  - A stored NULL name against a Plaid NULL name is paired.
- **RK-04 not orphaned stays.** A stored row whose id is in Plaid's history is untouched, even when another statement with the same key but a new id exists. That second statement is not inserted and not used. A stored row whose id appears in the history only as `pending: true` is also untouched (`not_orphaned`).
- **RK-05 CSV/manual excluded.** A `csv_` row and a `manual_` row, each with an exact lookalike statement under a new id, are untouched and counted `excluded_csv_manual`. The lookalike is not inserted. A `csv_` row sharing the key with an orphan and with one candidate makes that orphan `ambiguous` (D5) and nothing is re-keyed.
- **RK-06 new id already stored.** A candidate whose id is stored on another row (same account; another account; another item's account) is never used. The orphan is `excluded_new_id_stored`. No unique-violation occurs and no row changes.
- **RK-07 new id tombstoned.** A candidate whose id is in the tombstone table is never used, the orphan is `excluded_new_id_tombstoned`, and the tombstone table is identical afterwards. Second case: an orphan with two same-key statements, one tombstoned and one free, IS re-keyed to the free one (the tombstoned id takes no claim). Third case: a stored row bearing a tombstoned id is `stored_tombstoned` and untouched.
- **RK-08 ambiguity in both directions, and the rest still proceeds.** Each of the following leaves every involved row untouched and counts each stored row `ambiguous` once:
  - 1 orphan vs 2 free candidates
  - 2 orphans vs 1 free candidate
  - 2 orphans vs 2 free candidates
  - In the same run, a separate 1:1 group IS re-keyed. A wholesale skip fails.
- **RK-09 cross-item safety.** Item A's walk returns a statement whose `account_id` is an account of item B (and the key matches a stored orphan on B's account). Nothing is applied from A's walk to B's row; the statement is not a candidate for B. A stored row on an account that has no token is untouched. A statement for an account not in the database is skipped, with no insert.
- **RK-10 pending and removed.** A pending statement is never a re-key target. A statement that was `added` on page 1 and named in `removed` on page 2 is not a target, and its would-be holder is therefore an orphan with no candidate (`no_match`) rather than "present".
- **RK-11 whole walk before matching.** The orphan's candidate is served on page 2 (or 3) of a multi-page walk, and the orphan is paired. A candidate in the `modified` list is also considered.
- **RK-12 atomic per item; a failing item is isolated.**
  - A failure injected on the Nth UPDATE of item 1 (via a wrapped db layer) rolls back ALL of item 1's re-keys, item 2 commits, `items_failed` is 1 and the exit is non-zero.
  - Separately, an item whose fetch rejects on page 2 (after page 1 was received) is untouched, contributes nothing to the CSV, and the other items are processed. This is also checked in apply mode.
- **RK-13 write-time guards.** The test lands a concurrent change between plan and write (via a wrapped db layer):
  - (a) the row was re-keyed by something else
  - (b) a row with the new id was inserted
  - (c) the new id was tombstoned
  - In each case that row is NOT updated, the other planned rows are, no unique violation escapes, and `skipped_at_write` counts it. The exit is 0 and the CSV already contained the planned rows.
- **RK-14 backup content and ordering.** Apply creates exactly one CSV in the configured directory, mode `0600`. It has a header (every `transactions` column, from the catalogue) plus one data row per planned row, holding the full pre-update row, with the OLD `plaid_transaction_id`. It was complete on disk before the first UPDATE (observable via the wrapped db layer). The CSV ids equal the rows whose id changed plus any `skipped_at_write`. A write that falls short (a backup that does not verify) stops the apply with zero rows changed. An unwritable directory stops the apply with zero rows changed and exit 1.
- **RK-15 backup directory rules.** The default directory resolves to `$HOME/b8-backfill-backups` (a created directory is `0700`). `--backup-dir` inside the repo or inside any `backups` segment is refused before any DB or network access, with exit 2. A dry run creates no directory.
- **RK-16 idempotent.** A second `--apply` reports `rekeyed=0`, creates no new CSV, and leaves all tables identical to after the first apply. A dry run after apply reports `would_rekey=0`. The formerly orphaned rows now count `not_orphaned`.
- **RK-17 output privacy.** Fixture strings are unmistakable sentinels in every field (name, merchant, ids, account ids, token, stored cursor, an amount with a distinctive digit pattern). Plaid's rejection is an Error with `.config.headers['PLAID-SECRET']` set to a sentinel, a valid `error_code`, and a message containing a sentinel. Everything written to stdout, stderr and the returned summary is captured. None of the sentinels appear. The only digit-bearing tokens are counts and ordinals. The valid code appears, and a non-`^[A-Z_]+$` code prints `UNKNOWN`.
- **RK-18 cursor and accounts untouched; walk guards.** After dry-run and after apply, every `accounts` row (cursor, `last_synced_at`, freshness columns) is identical. The first request for each item carries no cursor. No request carries the stored sentinel. Follow-up requests carry only the fake's own `next_cursor`. A walk that does not advance, or never ends, fails its item with a code and loops forever on neither.
- **RK-19 never inserts or deletes; counts add up; mode selection.**
  - The `transactions` row count is unchanged by apply, and the tombstone table is identical.
  - A statement with no stored counterpart is not inserted, and a `removed` entry naming a stored id deletes nothing.
  - Per item the identities hold: `stored_rows = excluded_csv_manual + stored_tombstoned + not_orphaned + orphans`, and `orphans = no_match + excluded_new_id_stored + excluded_new_id_tombstoned + ambiguous + would_rekey`.
  - Dry-run `would_rekey` equals apply `rekeyed + skipped_at_write`.
  - No flag means dry run, `--apply` writes, and an unknown flag throws before any access. Importing the module neither connects nor runs `main`.
- **RK-20 report shape.** Every count named above is present, numeric and non-negative in each item report and in the totals (0 where none), including for an item that returns an empty history and an item with zero stored rows (exit 0, no CSV).
- **RK-21 hand-off to 40c.** After the script's apply, run 40c's real `runBackfill` apply over the same fake, which now serves its fixture under the new ids. The re-keyed rows become enriched (`plaid_raw` non-null), they no longer count as `not_local`, and the not re-keyed rows are still un-enriched. This proves the re-key serves its purpose.
- **RK-22 sync follow-through.** After apply, a fake sync delta (`modified` under the new id for a re-keyed row) run through the real `runSync` updates that row in place. No duplicate row exists, and the owner-set columns survive.

### Root cause (RC), a requirement with its own acceptance check
EVIDENCE.md must contain a "Root cause" section. It must state which of the following explains why sync left these rows orphaned, why the others were rejected, and the commit or reasoning for each. Candidate explanations to adjudicate (from reading the code):
- **H-a.** Plaid reissued the ids on the SAME item (same access token), so `exchange-token` never ran or never changed the token. The stored cursor stayed non-null, so sync was incremental and Plaid never re-delivered history, and `matchReissuedTransactions` never saw the new ids. This is not a code defect.
- **H-b.** The token changed through a path that does not null the cursor (anything other than the two UPDATEs in `exchange-token`, which handle the existing-account and dup branches).
- **H-c.** The `added` re-identification path ran but did not pair the rows. The ambiguity and name cases are candidates here. This is not consistent with the diagnosis that the new ids are NOT stored (they would be duplicate inserts), so the implementer must say why it is rejected.
- **H-d.** `runSyncInner` takes the cursor of the FIRST account row for a token (`SELECT ... FROM accounts` with no `ORDER BY`). An item whose accounts disagree on cursor sends whichever comes first. This is a live code characteristic, and the implementer must state whether it can produce this symptom.
- **H-e.** The cursor-null re-sync was never completed (a failing item, or a feature or deploy ordering where the matcher did not yet exist). The implementer must date this using `git log -S matchReissuedTransactions` (history before the P1-10a move is reachable only through the pre-workspace paths).

Required tests, in a DB-backed file (path recorded in EVIDENCE.md), using the real route/`runSync` over the fake `@/lib/plaid`:
- **RC-01 the designed path works.**
  - Seed accounts with token OLD, a non-null cursor, and stored posted rows.
  - Call the real exchange-token route handler (fake `itemPublicTokenExchange`, `accountsGet`, `itemGet`) with a NEW token for the same account ids, so `accounts.cursor` becomes NULL and the token is NEW.
  - Then `runSync`: the fake serves, to the first request (cursor undefined), the full history across at least two pages under new ids.
  - Assert the stored rows are re-keyed in place: same primary keys, owner-set columns intact, and the row count unchanged (no duplicates).
  - If this test FAILS today, there is a live defect: fix it, and the evidence shows the test RED before and GREEN after (acceptance #15).
- **RC-02 same-token reissue is invisible to sync.**
  - With a stored non-null cursor and an unchanged token, the fake serves only a delta (no history).
  - Assert the orphaned rows stay orphaned after `runSync`, and the first request carried the stored cursor.
  - This characterises why H-a leaves exactly the symptom 40e repairs. It is a characterisation, not a fix target, and it must pass today.
- **RC-03 mixed cursors.**
  - Seed one token with two accounts, one cursor NULL and one non-null. Record which cursor the first `transactionsSync` request carries.
  - Run it for both physical row orders (for example by updating the rows so their physical order swaps).
  - Assert, and record in EVIDENCE.md, whether the request cursor depends on row order. If it does, H-d is a live defect and must be fixed with the observable "a token with any NULL-cursor account syncs from no cursor, or the item's cursors are made consistent", and RC-03 is the red-then-green regression. If it does not, the evidence says why.
- **Orchestrator real-data read-only discrimination** (counts and months only, no ids). Per item ordinal: the number of accounts, the number with a NULL cursor, the number of distinct non-null cursors, the month of the most recent `last_synced_at`, and the earliest `created_at` month of the orphan rows against the item's `access_token`-change time if it is knowable. This is how H-a/H-d/H-e are adjudicated against real data. The evidence must state the chosen finding even if the cause was a one-time operational event.

## Negative controls
| # | Rule | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | Dry run writes nothing, DB or file | any seeded orphan | RK-01 (snapshot equality, no CSV) |
| 2 | Changes only `plaid_transaction_id` | owner-set columns on re-keyed rows, un-enriched `plaid_raw` | RK-02 |
| 3 | One definition of "same transaction" | name differing by more than case/whitespace, date +1 day, amount 0.01 off, opposite-sign amount, other account | RK-03; static #11, #12 |
| 4 | Not orphaned rows untouched | stored row whose id is in the history (posted or pending) | RK-04 |
| 5 | CSV/manual rows never re-keyed | `csv_` and `manual_` rows with an exact Plaid lookalike | RK-05 |
| 6 | New id already stored is never used | candidate id stored on a row of the same account, another account, another item | RK-06 |
| 7 | New id tombstoned is never used, tombstones unchanged | tombstoned candidate; stored row with tombstoned id | RK-07 |
| 8 | Ambiguous matches skipped | 1:2, 2:1, 2:2 groups | RK-08 |
| 9 | Cross-item safety | item A's statement for B's account; untokened account | RK-09 |
| 10 | Pending and removed never targets | pending statement; add-then-removed statement | RK-10 |
| 11 | Per-item atomicity and isolation | failure on the Nth UPDATE; fetch rejecting on page 2 | RK-12 |
| 12 | Write-time re-check | row re-keyed, new id inserted, new id tombstoned between plan and write | RK-13 |
| 13 | Backup first, verified, complete | short write; unwritable directory | RK-14 |
| 14 | Backup never in the tree or a `backups` dir | `--backup-dir` inside the repo or `backups` | RK-15; acceptance #5 |
| 15 | Idempotent | second apply | RK-16 |
| 16 | Output carries counts only | sentinel names/ids/token/cursor; error with secret in `.config.headers` | RK-17 |
| 17 | Cursor and `accounts` untouched; walk cannot loop | sentinel cursors; non-advancing cursor | RK-18; static #13 |
| 18 | Never inserts or deletes | unmatched statements; `removed` entry for a stored id | RK-19; static #13 |
| 19 | Unknown flag never degrades to dry-run/apply | `--aply` | acceptance #4, RK-19 |
| 20 | No refresh/status/balance calls | `itemGet`, `accountsGet`, etc. | static #14 |
| 21 | DB-backed test not in the pure suite | the test files | acceptance #10 |
| 22 | Timezone does not shift dates | same suite under UTC+12/UTC-8 | acceptance #8 |
| 23 | Sync and the matcher unchanged unless RC requires | edits to `sync.ts`, `exchange-token`, `txnMatch` | acceptance #9, #15 |
| 24 | Root cause stated and tested | n/a (a missing finding) | RC-01..03, acceptance #7, #15 |

## Evidence required
Implementer, in `plan/tasks/P6-40e-plaid-rekey/EVIDENCE.md`, with no real figures:
1. Output of acceptance #1-#16, including the verbose RK-01..RK-22 and RC-01..RC-03 lines, and the tag counts.
2. The "Root cause" section as above: the chosen explanation (H-a..H-e or another), why the others are rejected, and the commit/date reasoning from `git log -S`. If code changed, the RED-before and GREEN-after runs of the regression test.
3. Mutation probes, each applied to the script alone, `⟨R⟩` run, then reverted with a `cmp` against the saved original:
   - drop the ambiguity rule (re-key whenever any candidate exists)
   - bypass the matcher with a hand-rolled exact-equality key
   - drop the new-id-stored guard
   - drop the tombstone guard
   - drop the `csv_`/`manual_` exclusion
   - drop the "old id still held" WHERE clause
   - write the CSV after the first UPDATE
   - persist or send the stored cursor
   - ignore `removed`
   - Each must turn a named RK test red.

Orchestrator, operational record after merge, counts only:
4. Real dry-run: per item ordinal and totals of `stored_rows`, `excluded_csv_manual`, `stored_tombstoned`, `not_orphaned`, `orphans`, `no_match`, `excluded_new_id_stored`, `excluded_new_id_tombstoned`, `ambiguous`, `would_rekey`, `items_failed`. Reconcile `orphans` and `ambiguous` with DIAGNOSIS.md's 524 and 16 (explain any difference, since the script's rules are stricter) and with 40c's `not_local`.
5. Real `--apply`: the CSV path, its data-row count, `rekeyed`, `skipped_at_write` and `items_failed`.
6. Before/after, with no rows printed:
   - the `transactions` row count is identical
   - the count of rows whose `plaid_transaction_id` changed equals `rekeyed`
   - a read-only comparison of every CSV row to the table shows 0 differing columns other than `plaid_transaction_id`
   - the count of `csv_`/`manual_` rows and a hash over their ids are unchanged
   - the `transaction_tombstones` count is unchanged
   - the `accounts` cursor fingerprint is equal before and after
7. Idempotency: a second `--apply` gives `rekeyed=0` and creates no new CSV.
8. Then 40c: its dry-run `not_local` drops and its `would_update` rises by `rekeyed`, then 40c's `--apply` enriches those rows. Record the counts.
9. The real-data root-cause facts listed under RC (read-only, counts and months only).
10. The CSV is outside `git status`, under `$HOME/b8-backfill-backups`, mode `0600`.

## Failure modes to test
- **Greedy one-to-one claiming instead of ambiguity-skipping.** The matcher pairs lowest-id-first and would silently re-key 1:2 and 2:1 groups. Ambiguity must be decided before it. A 2:2 group of identical rows is also ambiguous. RK-08.
- **Second key definition.** A hand-rolled key (exact string equality, `toFixed` copied, `Number` rounding done differently) drifts from sync. Both silently under-match (case/whitespace) and over-match. RK-03, static #11/#12.
- **CSV rows filtered after matching rather than before.** A CSV row would claim the id, or a lookalike CSV row would be re-keyed to a Plaid id. It must be excluded from re-key and still count on the stored side for ambiguity (D5). RK-05.
- **"New id already stored" checked only within the item or the date window.** A unique violation then aborts an item's transaction, or a duplicate row is made. The check is global. RK-06.
- **Tombstoned id spending a claim.** It would make a legitimate pair ambiguous or skip it, or rename a live row to a deleted id. RK-07.
- **Pending or removed ids used as targets or as "present".** A pending id is presence-only. An added-then-removed id is neither present nor a target. RK-10.
- **Torn walk applied.** A page error mid-walk must fail the item whole. RK-12.
- **Matching before the whole history is read.** A candidate on a later page is missed. RK-11.
- **Cross-item collision.** Ids are scoped to an item. Pairing item A's statement to a row on B's account, or an account that has since been remapped, must not happen. RK-09.
- **Date artefacts.** `toISOString()` on the stored DATE shifts it by a day at UTC+ offsets, and the pairing then silently fails or mis-pairs. Acceptance #8.
- **`null` vs empty.** A NULL name pairs with NULL only. `''` is not NULL, and the matcher's `?? ''` collapses both, so the stored side must be passed as the matcher expects. RK-03.
- **Float artefacts.** `12.30` vs `12.3` and the `numeric` text turned into a float must key identically, as in sync. Seed amounts whose binary float differs from the 2-dp text (for example 0.1+0.2 forms) in RK-03.
- **Count double-bucketing.** A row counted in two buckets breaks the identities. RK-19.
- **Dry-run that writes.** A count query implemented as `UPDATE ... RETURNING`, or a CSV directory created in a dry run. RK-01, RK-15.
- **Backup after the UPDATE; backup incomplete (columns missing, only planned subset of columns); a backup failure that is ignored; CSV in the tree or world-readable.** RK-14, RK-15.
- **Idempotency by accident.** A second run that reports 0 only because the first never wrote. RK-02 and RK-16 together require the first run to have written.
- **UPDATE selecting by `plaid_transaction_id` alone** instead of the primary key plus old id: it could re-key a row sync has since renumbered, or another row. RK-13.
- **Output leakage:** logging a fixture while debugging, `JSON.stringify(err)`, printing the ids to explain "ambiguous", printing an account id. RK-17.
- **Raw axios error logged**, leaking `PLAID-SECRET` via `.config.headers`. RK-17.
- **Stored cursor reused or final cursor saved.** RK-18.
- **Re-key breaking later sync.** After re-key, a later `modified` under the new id must update the row, not insert a duplicate. RK-22. A re-key also must not leave the row un-enrichable. RK-21.
- **Items with a bad token** aborting the loop, or the exit code staying 0. RK-12.
- **Pure/DB suite contamination** by placing the test under `lib/`. Acceptance #10.
- **Refactor regression.** Extracting shared pieces from the 40c script changes 40c's behaviour (its 19 tests would then turn red). Acceptance #9.
- **Root cause left as prose.** Acceptance #7 and #15 require the RC tests and, if code changed, the RED/GREEN record.

## Rollback
- **Code:** revert the commit. The script is wired into nothing. There is no `down` migration because none was added. If `sync.ts`/`exchange-token` were fixed for a live defect, reverting restores the previous behaviour, and the RC regression test reverts with it.
- **Data, after a real `--apply`:** the CSV written before the run lists every attempted row's complete pre-run values, including its primary key `id` and old `plaid_transaction_id`. To undo, set `plaid_transaction_id` back to the CSV's old value, selecting each row by primary key `id`, for exactly the rows in the CSV. Do it only where the row still bears the new id. If a later sync has since touched the row, the id-only restore is still correct because no other column was changed by this task. Then re-count. No other column needs restoring. If anything differs from the CSV in a column other than `plaid_transaction_id`, restore that column from the CSV and from the nightly `scripts/backup.ts` dump, and record the discrepancy as a defect. Do not delete the CSV until the evidence record is complete.
- **40c enrichment applied afterwards** is rolled back by 40c's own recipe (NULL the eleven columns and `plaid_raw` for the rows in its CSV).
- **Cursor and `accounts`:** nothing to roll back; never written.

## Reconciliation points for G0 (orchestrator)
1. Confirm the interface names (`rekey:plaid-ids`, `scripts/rekey-plaid-ids.ts`, `--apply`, `--backup-dir`, tags `RK-nn`/`RC-nn`). They are choices made here so the commands are literal.
2. Confirm D-csv: CSV/manual rows on the stored side make a group ambiguous. This is the conservative reading of "CSV rows stay CSV rows". The alternative is to ignore them entirely, which risks re-keying an orphan that is really the lookalike of a CSV row. If the owner prefers the alternative, change D5's S, RK-05 and failure-mode wording together.
3. Confirm D3's stricter `removed` handling than 40c, and that sharing 40c's walk may mean extending it to return removals without changing 40c's observable results (acceptance #9).
4. Confirm that treating a stored id present only as pending as `not_orphaned` (D4) is wanted. It is the conservative choice.
5. T8's baseline, T1's scratch database, and the H4 known failures that may sit in acceptance #9's set are measured by the orchestrator.
6. The RC test file's path is recorded by the implementer. The orchestrator substitutes it into `⟨C⟩` and adds it to the integration `include` if it is outside `app/api/v1/`.

---
## Unverified by reading (for the orchestrator)
- I could not run anything (Read/Grep/Glob only). So I did not run `git log -S matchReissuedTransactions`, which is needed to date the matcher against the end-of-August re-link (H-e). I did not check that vitest verbose prints each title exactly once under the integration config (40c's evidence shows it did, with `disableConsoleIntercept` on).
- I did not open `lib/plaidReconcile.ts` in full. Whether `reconcileAccountIds` remapping account ids could explain orphan rows on a stable `account_id` (the diagnosis says account+date+amount match, which argues against it) is for the implementer to confirm.
- I did not verify that `transactions.plaid_transaction_id` has a UNIQUE constraint beyond `sync.ts`'s `ON CONFLICT (plaid_transaction_id)`, which implies one. RK-06 and RK-13 depend on it.
- The matcher's `key` function is not exported. Whether the cleanest shared-definition route is exporting it or exporting a grouping helper is the implementer's choice, and I did not prescribe it. Static #12 would catch a copy.
- The exact shape of 40c's walk and backup writer (`fetchHistory`, `writeBackup` are not currently exported) means the "reuse" step requires an edit to `backfill-enrichment.ts`. I assumed this is acceptable if its 19 tests stay green unmodified.
- The real-data root-cause facts (RC, orchestrator step) are not known. `sync_log` was unusable per DIAGNOSIS.md. `accounts.last_synced_at` and cursors were not read.
- Which of `accounts.cursor` rows per item disagree is unknown. H-d is a code-reading hypothesis, from `runSyncInner` taking the first account row's cursor with no `ORDER BY`.
- Plaid's exact `modified`/`removed` behaviour for a from-null-cursor walk (whether `removed` ever appears there) is not known. The spec handles it defensively.
- Files relevant: `/Users/andreianpilogov/Documents/b8/app/apps/web/lib/domain/txnMatch.ts`, `/Users/andreianpilogov/Documents/b8/app/apps/web/lib/sync.ts`, `/Users/andreianpilogov/Documents/b8/app/apps/web/app/api/v1/plaid/exchange-token/route.ts`, `/Users/andreianpilogov/Documents/b8/app/apps/web/scripts/backfill-enrichment.ts`, `/Users/andreianpilogov/Documents/b8/app/apps/web/vitest.integration.config.mts`, `/Users/andreianpilogov/Documents/b8/app/plan/tasks/P6-40e-plaid-rekey/DIAGNOSIS.md`.

---

## G0 record (orchestrator, 2026-10-07)
1. **Interface names confirmed:** `rekey:plaid-ids`, `apps/web/scripts/rekey-plaid-ids.ts`, `--apply`, `--backup-dir`, tags `RK-01..RK-22`, `RC-01..RC-03`.
2. **D-csv confirmed (conservative):** CSV/manual rows count on the stored side for ambiguity and are never re-keyed.
3. **D3 confirmed:** `removed` ids are neither present nor targets; extending 40c's walk to return removals is allowed provided 40c's 19 tests stay green unmodified (acceptance #9).
4. **D4 confirmed:** a stored id present only as pending is `not_orphaned`.
5. **Toolchain verified:** T1 `b8_p640e_throwaway` migrated (`tables=3`); T2 present; T3 `ok`; T8 baseline `72 files / 1112 tests`. `transactions` has `UNIQUE (plaid_transaction_id)` (RK-06/RK-13 premise holds). Acceptance #9's set at baseline: `Tests 42 passed (42)` — H4's two known failures are not in it, so #9 must show 0 failed.
6. **Real-data RC facts** are in DIAGNOSIS.md ("Root-cause facts gathered at G0"): no item has NULL or mixed cursors; no history-redelivery burst since mid-August; the matcher (2026-08-10) and the cursor reset (2026-08-11) predate the window. The implementer adjudicates H-a..H-e with RC-01..RC-03 against these facts.
