# P6-40c-enrichment-backfill — Backfill Plaid enrichment onto stored transactions
**Roadmap item:** ROADMAP.md §5 step 40c — one-off, re-runnable backfill; fetches each item's history without touching the sync cursor, UPDATEs only existing rows, dry-run first, CSV backup before the real run
**Status:** DRAFT (to be reconciled with the frozen P6-40a and P6-40b specs at G0 by the orchestrator; see "Reconciliation points")
**Author:** spec-writer

## Goal
Add an operator-run script, `npm run backfill:enrichment -w @b8/web [-- --apply]`. For every Plaid item in the database it reads that item's transaction history from Plaid and, for each posted Plaid transaction that already exists locally (matched by Plaid transaction id, and only on an account belonging to that item), fills 40b's enrichment columns and retained raw Plaid object from the same field mapping that sync's upserts use. It never inserts a row, never deletes a row, never touches `accounts` (including `accounts.cursor`), and changes no column other than 40b's enrichment columns and raw-object column. The default mode is a dry run that writes nothing (no database write, no file) and reports counts only. `--apply` first writes a CSV backup of exactly the rows it is about to change, then updates them. A second `--apply` changes nothing. Neither stdout/stderr nor the returned summary contains any name, merchant, amount, date, id, token, cursor or raw error object.

**Decisions made by this spec (owner-approved intent, made precise):**
- **D1 Endpoint.** The history is read with `/transactions/sync` started from NO cursor, following `next_cursor` / `has_more` in memory only, and the final `next_cursor` is discarded. `/transactions/get` is not used. Reason: the sync endpoint returns the same Plaid `Transaction` shape that sync's upserts already map, so the backfill writes exactly what a normal sync would have written. This code base never sets `days_requested` at Link time (`app/api/v1/plaid/create-link-token/route.ts`), so Plaid's default window applies, and the orchestrator measured coverage over 90 days (COVERAGE.md). Local rows older than what Plaid returns stay un-enriched. That is accepted and reported as the `local_not_returned` count, not treated as an error.
- **D2 Enrichment-only.** The backfill writes ONLY 40b's enrichment columns and the raw-object column. It does NOT refresh `name`, `merchant_name`, `date`, `amount`, `plaid_category`, `account_id`, `plaid_transaction_id`, `mapped_category`, `rule_applied`, `hidden`, `watched_at`, `watch_note`, `note`, `transfer_group_id`, `property_id`, or `created_at`, even where Plaid's current value differs from the stored one.
- **D3 Target rows.** A local row is a target only if its retained-raw-object column IS NULL (never enriched). A matched row whose raw-object column is already non-null (enriched by 40b sync or an earlier backfill run) is left untouched and counted as `already_enriched`. For a target row, every enrichment column is written from the mapping, with NULL where Plaid has no value, so the raw-object column becoming non-null is the "done" marker. The UPDATE must itself be conditional on the raw-object column still being NULL, so a sync that enriched the row between read and write is not overwritten.
- **D4 Eligibility is not filtered by flags.** Every existing row is eligible regardless of `hidden`, `exclude_from_budget`, account `landscape`, `track_transactions`, or `transfer_group_id`. Enrichment is metadata and must not depend on how the owner classified the row.
- **D5 Items.** Items are the distinct non-null `accounts.access_token` values; the accounts of an item are those sharing the token. Items are processed one at a time, in a stable order, and referred to in output only by 1-based ordinal ("item 2 of 5").

## Non-goals
- No schema change, migration, `db/schema.sql` edit, or `packages/contracts` change. If the implementer finds a column is missing, STOP and report it: that means 40b's contract is incomplete and 40b must be amended, not worked around here.
- No UI, no API route, no scheduler/daily-job wiring. The script is never invoked by `daily-job.ts`, `lib/scheduler`, or any route.
- No change to `lib/sync.ts` behaviour. Do not refactor sync to share code with the script beyond using 40b's already-shared mapping; do not edit sync's SQL.
- Never INSERT into `transactions`; never DELETE or "heal" local rows Plaid no longer returns; never act on the `removed` list from Plaid; never touch 40a's tombstone store (no read-to-delete, no write).
- Never write `accounts` (cursor, last_synced_at, freshness columns, balances) and never call reconcile, `/item/get`, `/institutions/get_by_id`, `/transactions/refresh`, or anything but the transactions read. Do not call `recordPlaidBalances`.
- No re-categorisation: rules are not loaded, `mapped_category`/`rule_applied` are not evaluated or written.
- No re-identification of transactions after a re-auth (`matchReissuedTransactions` is not used). A Plaid id with no local row is counted and skipped, even if a fuzzy match exists.
- Pending Plaid transactions are never stored or used.
- No encryption of the CSV and no new backup-rotation logic (a mode-0600 file in a git-ignored directory is the whole requirement). No change to `scripts/backup.ts`.
- Nothing is wired into CI. The DB-backed test is run by the orchestrator, like the other integration tests.
- The real run against the owner's data is an operational step performed by the orchestrator after merge, not an acceptance command and not the implementer's job.

## Contracts touched
none. (Reads 40b's new `transactions` columns; writes no shared type and no migration. Test/tooling files that change: `apps/web/package.json` gains one script; `apps/web/vitest.integration.config.mts` `include` gains exactly the new test file path(s). Neither is a contract surface.)

## Conventions this task must honor
- **Sign:** The script never reads, writes, converts, or compares `amount`. Plaid's convention (positive = money out) is neither applied nor inverted. A fixture whose Plaid amount differs from the stored amount, in sign and in magnitude, must leave the stored amount byte-identical. Mortgage/loan sign normalisation does not apply because no amount is touched.
- **Rounding:** Not applicable; no figure is computed. Counts are integers. No float appears in the output.
- **Landscape + exclusions:** None apply as filters (D4). `hidden`, `exclude_from_budget`, `landscape`, `track_transactions` are neither read as filters nor written. A `hidden = TRUE` row and an `exclude_from_budget = TRUE` row on a capital-landscape account are enriched like any other and keep their flags.
- **Null semantics:** A field Plaid does not send is stored as NULL — never an empty string, 0, or "unknown". An absent `location` object yields NULL for city/region. Every count in the report is a number, with 0 when nothing matched; a count is never null and never omitted. Items that failed contribute no counts for the rows they never returned, and are reported only as `items_failed`.
- **Output privacy:** stdout and stderr contain only: fixed English words, the mode (dry-run/apply), ordinals, integers, the backup file's path and row count, and Plaid error CODES drawn from `^[A-Z_]+$` (anything else is printed as `UNKNOWN`). No names, merchants, amounts, dates, locations, ids (transaction, account, item, institution), access tokens, cursors, or raw error objects, error messages, or response bodies. The CSV is the one artifact that may hold real rows; it is never printed.
- **Plaid errors:** never logged as a raw object, and never as `.message` verbatim either, since Plaid messages can echo identifiers. The axios-error `.config.headers` hazard is documented in `lib/sync.ts` and `app/api/v1/plaid/create-link-token/route.ts`.
- **Public repo (AGENTS.md):** fixtures and comments contain only fabricated, obviously fake values; no figure copied from a real ledger or from COVERAGE.md appears in a comment, test title, or message.

## Toolchain prerequisites
| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | A scratch Postgres at `$DATABASE_URL` whose database name is not `b8_finance`, migrated through 40a's and 40b's migrations | **yes** | `createdb b8_p640c_throwaway && DATABASE_URL=postgresql://localhost/b8_p640c_throwaway npx node-pg-migrate up` (as P1-12 T5) | `psql "$DATABASE_URL" -tAc "select current_database()"` prints a name other than `b8_finance`, and `psql "$DATABASE_URL" -tAc "select count(*) from information_schema.columns where table_name='transactions'"` is greater than the pre-40b column count the orchestrator recorded | filled in at G0 |
| T2 | 40a and 40b are merged and their migrations present | **yes** | tasks run in order | `ls migrations | wc -l` is greater than the count recorded before 40a | filled in at G0 |
| T3 | `git check-ignore` available | **yes** | git | `git check-ignore --version \|\| git --version` exit 0 | filled in at G0 |
| T4 | No Plaid credentials needed or present for the acceptance run | **yes** (they must be absent) | n/a | `env -u PLAID_CLIENT_ID -u PLAID_SECRET sh -c 'echo ok'` | filled in at G0 |
| T5 | Live Plaid, the dev database, the owner's server | **NO** | n/a | n/a | n/a |
| T6 | `npm run backfill:enrichment` script registered in `apps/web/package.json` | **yes, created by this task** | the implementer adds it (`tsx --env-file=.env.local scripts/backfill-enrichment.ts`, same shape as `backup`/`tokens`) and a root `package.json` forwarder like the existing ones | acceptance #3 | filled in at G0 |
| T7 | A Plaid-transport substitute usable by tests without network or credentials | **yes, created by this task** | requirement, not design: the update logic must be callable from a test with fabricated Plaid `Transaction` pages (including multi-page `has_more` and `modified`/`removed` lists) and with an item whose fetch rejects with an error carrying a secret in `.config.headers` | acceptance #5 | filled in at G0 |
| T8 | The integration config currently collects only `app/api/v1/**/*.test.ts` and `proxy.test.ts`, and the pure config collects `lib/**/*.test.ts`. The new DB-backed test must be in the integration set and NOT the pure set, so it must live outside `lib/` and `app/api/v1/` (for example `apps/web/scripts/`), with `include` extended to name it | **yes** | implementer edits `vitest.integration.config.mts` `include` by adding the exact path only (no widened glob; the file's header explains why) | acceptance #6 | filled in at G0 |

## Acceptance commands
`⟨I⟩` = `(cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts --reporter=verbose scripts/backfill-enrichment.test.ts 2>&1)`, run with `$DATABASE_URL` set to the scratch database (T1), never `.env.local`'s value. Test titles must begin with the tags named below, exactly once each. A6 applies: the orchestrator records the pure-suite baseline at G0 rather than this spec hard-coding a number.

| # | Command | Expected |
|---|---|---|
| 1 | `cd apps/web && npx tsc --noEmit` | exit 0 |
| 2 | `npm test` | exit 0, output contains no `failed`; the passed count is at least the pre-task baseline recorded at G0 |
| 3 | `grep -c '"backfill:enrichment"' apps/web/package.json package.json` | `apps/web/package.json:1` and `package.json:1` |
| 4 | `npm run backfill:enrichment -w @b8/web -- --aply 2>&1; echo "exit=$?"` | non-zero exit, usage text names `--apply`; the unknown flag is rejected rather than silently running a dry run |
| 5 | `⟨I⟩`, then for each tag `BF-01`..`BF-16`: `⟨I⟩ \| grep -c 'BF-<nn>'` | the run ends with all tests passed and 0 failed; each tag line count is exactly `1`. Tags and what each asserts are in "Tests required" below |
| 6 | `npm test -- --reporter=verbose 2>&1 \| grep -c 'backfill-enrichment.test'` | `0` — the DB-backed test is absent from the pure suite (the two configs stay disjoint) |
| 7 | `git check-ignore -q apps/backups/enrichment-backfill-test.csv; echo $?` | `0` — the default backup directory is git-ignored |
| 8 | `grep -cE 'INSERT INTO transactions\|UPDATE accounts\|DELETE FROM' apps/web/scripts/backfill-enrichment.ts` | `0` (static pin on the never-insert / never-touch-accounts / never-delete rules, per A7) |
| 9 | `grep -c 'transactionsSync' apps/web/scripts/backfill-enrichment.ts && grep -cE 'transactionsGet\|itemGet\|transactionsRefresh\|institutionsGetById' apps/web/scripts/backfill-enrichment.ts` | first prints `1` or more; second prints `0` (D1 pinned) |
| 10 | `cd apps/web && DATABASE_URL=$DATABASE_URL env -u PLAID_CLIENT_ID -u PLAID_SECRET npx tsx scripts/backfill-enrichment.ts 2>&1; echo "exit=$?"` against a scratch DB with zero token-bearing accounts | exit 0; output states dry-run and every count is `0`; `ls` of the backup directory shows no new file. A stub that prints a canned zero report passes this one alone, which is why BF-01..BF-16 carry the weight |

### Tests required (fixtures fabricated; each BF test seeds everything it asserts on)
Common fixture: three Plaid items (three distinct fabricated access tokens) with accounts; `accounts.cursor` seeded with a sentinel string on every account; local rows seeded with deliberately non-default owner-set values (`hidden=TRUE`, `watched_at` set, `note` set, `transfer_group_id` set, `property_id` set, a `mapped_category` with `rule_applied=FALSE`, one row on a capital-landscape account, one with `exclude_from_budget` category). The fake Plaid layer returns fixture pages and records every request it receives.

- **BF-01 dry-run writes nothing.** Run with no apply flag. Full-row snapshots of `transactions` and `accounts` (all columns, ordered) and the row count of 40a's tombstone store are identical before and after. No CSV exists. The report shows `would_update` greater than 0 (non-vacuous: a no-op that reports zeros fails).
- **BF-02 apply fills enrichment, across pages.** Rows served on page 2 of an item, and rows served in the `modified` list, are enriched. Each target row's enrichment columns equal the 40b mapping of its fixture object, and its raw-object column is non-null and equals the fixture object. Fields absent from the fixture are NULL, not `''`/0.
- **BF-03 owner-set and Plaid-sourced base data untouched (D2).** Fixture objects have a different `name`, `merchant_name`, `date`, `amount` (opposite sign), and category from the stored row. After apply, every non-enrichment column of every row is identical to before. Compared as "all columns minus 40b's enrichment and raw-object columns".
- **BF-04 never inserts, never deletes.** Fixture contains ids with no local row (including one in a known account) and a `removed` entry naming a local id. Row count of `transactions` is unchanged; the `removed` id's local row still exists; 40a's tombstone store is unchanged; a fixture id matching a tombstoned/deleted transaction is not inserted. Counts: `not_local` equals the number of such fixture ids.
- **BF-05 cursor never read or changed.** After dry-run and after apply, every `accounts` row, including `cursor`, `last_synced_at`, and freshness columns, is identical. The fake's first request for each item carries no cursor; no request carries the stored sentinel cursor; follow-up requests carry only the fake's own `next_cursor`.
- **BF-06 pending skipped.** A fixture entry with `pending: true` whose id matches a local row leaves that row un-enriched; `pending_skipped` counts it.
- **BF-07 account scoping.** (a) A fixture entry whose `account_id` is not in the database is skipped and counted `unknown_account`. (b) A fixture entry for item A whose id matches a local row on an account of item B is NOT applied and is counted `not_local`/`unknown_account` rather than updated.
- **BF-08 failing item.** Item 2's fetch rejects; items 1 and 3 are fully processed; `items_failed` is 1; process exit status is non-zero; item 2's rows are untouched (also in apply mode); item 2 contributes nothing to the CSV.
- **BF-09 output privacy.** Fixture strings are unmistakable sentinels in every text and number field (name, merchant, logo URL, website, city, an amount with a distinctive digit pattern, transaction id, account id, access token, stored cursor). Plaid's rejection in BF-08 is an Error with `.config.headers['PLAID-SECRET']` set to a sentinel, a `.response.data.error_code` of a valid code, and a message containing a sentinel. Everything written to stdout, stderr (including via the logger), and the returned summary is captured; none of the sentinels appear. The only digits-bearing tokens are counts and ordinals. The error code appears; a non-`^[A-Z_]+$` code prints `UNKNOWN`.
- **BF-10 idempotent.** A second apply reports `updated = 0` and `would_update = 0`, writes no CSV (or a CSV with zero data rows is NOT created; state: no file), and all `transactions` rows are identical to after the first apply. A pre-seeded already-enriched row carrying sentinel enrichment values different from its fixture keeps those values and is counted `already_enriched`.
- **BF-11 backup content.** Apply creates exactly one CSV in the configured backup directory, mode `0600`, containing a header plus exactly one data row per row that is updated, holding the full current `transactions` row (all columns, as they were BEFORE the update, including the then-NULL enrichment and raw-object columns and the owner-set columns). The set of Plaid ids in the CSV equals the set of rows whose raw-object column changed. The CSV was complete on disk before the first UPDATE (the test makes the first UPDATE observable, e.g. by a failing UPDATE injected by the fake DB layer, or by checking CSV presence from within the item write path, and asserts the file already exists with full contents).
- **BF-12 backup failure aborts.** With the backup directory unwritable, apply exits non-zero and changes zero rows in `transactions`.
- **BF-13 dry-run equals apply.** For the same fixtures, dry-run's `would_update` equals apply's `updated`, and the counts satisfy per item: `matched = would_update + already_enriched`, and `posted_returned_in_known_accounts = matched + not_local`.
- **BF-14 no flag filter (D4).** The `hidden=TRUE` row, the capital-landscape row, the `exclude_from_budget`-category row, and a row with a `transfer_group_id` are all enriched and keep their flags/group.
- **BF-15 empty and zero cases.** An item whose fetch returns zero transactions, and an item whose accounts have zero local rows, yield all-zero counts (numbers, not omitted/null), exit 0, and no CSV when nothing would be updated.
- **BF-16 mode selection.** No flag means dry-run; the explicit apply flag means write; an unknown flag throws before any DB or network access. Importing the module (as the test does) neither connects nor runs `main`.

## Negative controls
| # | Rule | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | Dry-run writes nothing, DB or file | any seeded target row | BF-01 (snapshot equality, no CSV) |
| 2 | Never inserts | Plaid id with no local row, incl. one in a known account and one that is a deleted/tombstoned id | BF-04; static #8 |
| 3 | Never deletes | Plaid `removed` entry naming an existing local id | BF-04 |
| 4 | Cursor and `accounts` untouched | accounts seeded with a sentinel cursor; first request has none | BF-05; static #8 (`UPDATE accounts` = 0) |
| 5 | Enrichment-only (D2) | fixture with different name/merchant/date/amount (opposite sign)/category than stored | BF-03 |
| 6 | Owner-set data untouched | rows with hidden, watched_at, note, transfer_group_id, property_id, non-rule mapped_category | BF-03, BF-14 |
| 7 | Pending skipped | `pending: true` fixture for an existing local id | BF-06 |
| 8 | Account scoping | fixture for an account not in DB; id matching a row on another item's account | BF-07 |
| 9 | Already-enriched rows not overwritten (D3) | row with non-null raw object and different sentinel values than fixture | BF-10 |
| 10 | Output carries counts only | sentinel names/merchants/amounts/ids/tokens/cursor; error with secret in `.config.headers` | BF-09 |
| 11 | A failing item does not stop others or write partially | item whose fetch rejects | BF-08 |
| 12 | No backup, no write | unwritable backup directory | BF-12 |
| 13 | Unknown flag never degrades silently to dry-run or apply | `--aply` | acceptance #4, BF-16 |
| 14 | DB-backed test not in the pure suite | the test file | acceptance #6 |
| 15 | Backup is never inside the tracked tree | default directory | acceptance #7 |
| 16 | No refresh/status/balance calls | `itemGet`, `transactionsRefresh`, `transactionsGet` etc. | static #9 |

## Evidence required
Operational record, produced by the orchestrator after merge on the owner's server; the implementer provides the script and nothing else here. All output pasted into `plan/tasks/P6-40c-enrichment-backfill/EVIDENCE.md` is counts only (the script guarantees it; still, no figures from the ledger in EVIDENCE.md).
1. Output of the full acceptance run on the scratch DB (items 1-10), including the verbose BF-01..BF-16 lines.
2. Real dry-run: the report (per item ordinal and totals: `plaid_returned`, `pending_skipped`, `unknown_account`, `not_local`, `would_update`, `already_enriched`, `local_not_returned`, `items_failed`). The orchestrator records a pre-run count of rows with a NULL raw-object column, to compare with the totals.
3. Real `--apply`: the CSV path and its data-row count (equal to `updated`), `updated`, and `items_failed` (expected 0; if non-zero, say which ordinals and rerun).
4. Before/after: the count of `transactions` rows is identical; count with non-null raw object rose by exactly `updated`; the count of rows differing from the CSV in any non-enrichment column is 0 (orchestrator runs a read-only query against the CSV and the table without printing rows).
5. Idempotency re-run: a second `--apply` reports `updated = 0` and creates no new CSV.
6. `accounts.cursor` for every account is unchanged across the run (compare a hash of the cursors taken before and after; print only the equality result).
7. The CSV is not in `git status` and sits under a git-ignored path with mode `0600`.

## Failure modes to test
- **Cursor persisted by accident:** the sync loop copied from `lib/sync.ts` ends with `UPDATE accounts SET cursor ...`; copying it wholesale would advance the cursor to the end of history. A later normal sync would then see nothing new, silently losing nothing but also masking real breakage.
- **Stored cursor reused:** passing `accounts.cursor` into the request returns only the deltas since last sync, so the backfill would enrich almost nothing while reporting success.
- **Upsert instead of UPDATE:** `INSERT ... ON CONFLICT DO UPDATE` copied from sync re-creates deleted rows (the exact bug 40a exists to prevent) and re-creates tombstoned ones.
- **`modified`/`removed` mishandling:** treating `removed` as a delete; ignoring `modified` entries so changed rows stay un-enriched; or not following `has_more`, so only the first page is enriched.
- **Sync mutation during pagination:** Plaid can reject a paginated sync whose data changed mid-walk (`TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`). The item must be counted as failed or restarted cleanly and never half-applied; never partial rows from a torn read.
- **Cross-item id collision:** transaction ids are scoped to an Item; matching by id alone, without confining to the item's accounts, could write one item's object onto another's row after a re-auth.
- **Overwriting fresher enrichment:** an UPDATE without the NULL guard can clobber a row a concurrent sync just enriched with newer data.
- **Overwriting owner data:** copying sync's `DO UPDATE SET` list (name, merchant_name, date, amount, plaid_category) would silently rewrite owner-visible figures; `mapped_category`/`rule_applied` re-derivation would undo manual categorisation.
- **Backup incomplete or late:** CSV written after the UPDATEs; CSV missing owner-set columns (so it cannot restore); CSV row count differing from updated count; CSV covering all rows instead of only affected rows; a backup failure that is logged and ignored while the run proceeds.
- **CSV exposure:** default directory inside the working tree and not ignored; world-readable mode; the path printed along with a row sample.
- **Output leakage:** logging the fixture/transaction while debugging, `log.error('...', { error: err })`, `JSON.stringify(err)`, printing the item's institution name, printing account ids to explain "unknown account", printing the token to identify the failing item.
- **Raw axios error logged:** leaks `PLAID-SECRET` via `.config.headers`.
- **`null` vs empty:** an absent location written as `''` or a zero; `merchant_entity_id` empty string indistinguishable from missing; an absent field rendering a "wrong zero" in 40d later.
- **Dry-run that writes:** a count query implemented as `UPDATE ... RETURNING`, or a dry run that creates the CSV directory/file, or a backup file written during dry-run.
- **Idempotency by accident:** the second run reports `updated = 0` only because the first run never wrote (a stub); BF-02 and BF-10 together require the first run to have written.
- **Count identities broken:** a row counted in two buckets (e.g. both `already_enriched` and `would_update`), or Plaid rows in a skipped bucket also counted as `not_local`.
- **Timezone/date artefacts:** the script must not rewrite `date` at all. A mapping that parses `authorized_date` via `toISOString()` would shift it a day at UTC+ offsets; reuse the repo's date-only handling (see `toDateInputValue` use in `lib/sync.ts`) via 40b's shared mapping.
- **Items with a bad token:** an exception from one item aborting the loop (items after it never processed), or the exit code staying 0 so the operator does not notice.
- **Mutation of the sentinel by the test harness:** BF-05 passes vacuously if the fixture's accounts have NULL cursors; the fixture must seed non-null cursors.
- **Pure/DB suite contamination:** placing the test under `lib/` makes the pure CI suite require Postgres (acceptance #6).

## Rollback
- **Code:** revert the commit; the script is not wired into anything, so reverting removes it entirely. No `down` migration (none was added).
- **Data, after a real `--apply`:** every touched row was a target only because its raw-object column was NULL (D3), so its pre-run enrichment state was NULL. To undo: use the CSV written before the run (it lists every affected row's complete pre-run values) to set 40b's enrichment columns and raw-object column back to NULL for exactly the rows in the CSV, then re-count. No other column was changed, so none needs restoring from the CSV. If anything unexpected differs from the CSV in a non-enrichment column, restore those columns from the CSV and from the nightly `scripts/backup.ts` dump (the last dump before the run) and record the discrepancy as a defect. The CSV is the primary rollback artifact: do not delete it until the evidence record is complete.
- **Cursor:** nothing to roll back; `accounts` is never written.

## Reconciliation points for G0 (orchestrator)
1. 40b's frozen spec must name the shared mapping and its inputs/outputs; BF-02 asserts "equals the 40b mapping of the fixture", so the test must call that mapping or an equivalent independent expectation. If 40b's mapping also writes `plaid_category` or other base columns, D2 still stands: the backfill uses only the enrichment/raw outputs.
2. 40b must name the retained-raw-object column and confirm it is NULL on every pre-existing row and non-NULL after any write by either sync upsert (D3 depends on this). If 40b writes enrichment without the raw object, or the reverse, D3's "done marker" needs a different predicate.
3. 40a's tombstone store shape defines BF-01/BF-04's tombstone seed. If 40a freezes it as a table, BF-04 seeds a tombstone row for a fixture id; if as a column, BF-04 seeds that.
4. Acceptance #2's pure-suite baseline and T1/T2 numbers are measured by the orchestrator at G0.
5. Naming the npm script `backfill:enrichment`, the file `scripts/backfill-enrichment.ts`, the flag `--apply`, and the `BF-nn` tags is an interface choice made here so commands are literal; the orchestrator may rename them at G0 before freezing.

## Unverified by reading (for the orchestrator)
- Whether `tsx --env-file=.env.local scripts/backfill-enrichment.ts` loads `lib/db.ts` cleanly from a script (backup.ts avoids `lib/db`; `daily-job.ts` and `tokens.ts` should be checked for the pattern; I did not open them).
- Plaid's actual history window for `/transactions/sync` from a null cursor on the owner's items: the SDK shows no `days_requested` at Link, so default applies; COVERAGE.md measured 90 days via `/transactions/get`, not via sync. The dry-run's `local_not_returned` exposes it.
- Exact form of 40a's tombstone store and 40b's column names (do not exist yet).
- Whether `vitest` verbose output prints each test title exactly once per run in this repo's reporters when `disableConsoleIntercept` is true (prior specs P1-12 #22-#32 rely on it; I did not run it).
- Whether the root `package.json` forwarder pattern (`npm run X -w @b8/web`) is wanted for this script; acceptance #3 assumes yes.
- Whether the mode-0600 CSV in `apps/backups/` is replicated off-box by the owner's backup routine (backup.ts comments mention a laptop/Drive replication of the backups directory); plaintext real rows there would be a new exposure. Flagged for the orchestrator/owner, with no encryption added here (non-goal).
