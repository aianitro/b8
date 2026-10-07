# P6-40a-deletion-tombstones — Deleted Plaid transactions stay deleted
**Roadmap item:** ROADMAP.md §5 Phase 6 step 40a — deletion tombstones
**Status:** FROZEN@G0 (2026-10-07; orchestrator amendment to #6/#7, see GATES.md)
**Author:** spec-writer

## Goal
When the owner deletes a transaction through `DELETE /api/v1/transactions/[id]` (the single endpoint behind both the account page's swipe/trash delete and the Transactions page), the transaction's Plaid transaction id is recorded in a durable tombstone. The tombstone is written in the same atomic step as the deletion and outlives the deleted row. `lib/sync.ts` then never writes a tombstoned id to `transactions`, whether Plaid delivers it as `added` or `modified`. A tombstoned incoming id must also not claim a stored row during re-identification (`matchReissuedTransactions`). Everything sync does today for non-tombstoned ids stays as it is: pending skip, owner-category preservation on `modified`, `removed` deleting the row, cursor advance, and the `added` count.

Findings from reading the code that shape the rules below:
- `plaid_transaction_id` is `TEXT NOT NULL UNIQUE` on every row, so a tombstone key always exists.
- Non-Plaid rows carry synthetic ids from the same column: `manual_<uuid>` (POST `/api/v1/transactions` and cash-count adjustments), `csv_<hash>` (CSV import, deterministic), and fabricated ids in seed/eval scripts.
- Re-identification (`matchReissuedTransactions`) rewrites a stored row's `plaid_transaction_id` in place. Without a guard, a tombstoned incoming id whose account, date, amount and name match a live row would claim that row.

## Non-goals
Each is enforced by the reviewer as a defect if present.
- **No enrichment fields** (detailed category, authorized date, channel, logo, etc.). That is 40b. `sync.ts` upsert column lists stay as they are.
- **No backfill and no data migration of existing rows or history.** That is 40c. The new table starts empty. Transactions deleted before this ships are not retroactively tombstoned.
- **No UI change.** `SwipeDeleteRow.tsx`, `ConfirmDeleteTransaction.tsx`, and the Transactions and account pages are untouched. No new confirmation text, no "restore" or "deleted items" view.
- **No undo or restore of a deleted transaction.** There is no endpoint that removes a tombstone.
- **No re-auth coverage.** After a bank re-auth, Plaid issues NEW ids for the same real transactions. A deleted row's new id is not tombstoned, so that transaction can return as an `added` row. Closing this needs the tombstone to record the row's account, date, amount and name so it can be matched, which is a different data shape and a different false-positive risk. Do not add fingerprint columns or fingerprint matching. This gap is documented, not fixed.
- **Tombstones are consulted only by `lib/sync.ts` `added` and `modified` handling.** The CSV importer (`app/api/v1/import/csv/route.ts`) and manual create do not read them. Re-importing a CSV file after deleting one of its `csv_` rows re-creates that row exactly as it does today (pinned by S5).
- **No tombstone is written by Plaid's `removed` events.** Only the owner's delete writes one.
- **Transfer partner rows are untouched.** Deleting one leg does not delete, un-group, or tombstone the other leg, and `transfer_groups` is not modified.
- **Not adding tombstone cleanup, expiry, or counting.** The table grows by one small row per owner deletion.
- **No change to the `DELETE` response shape or status codes** for the success path, and no change to input validation of `id` (a non-integer id behaves as it does today).
- **No edit to any committed migration** and no change to the `transactions` table definition.

## Contracts touched
| File | Change | Class (§9.2) |
|---|---|---|
| `migrations/<new>_transaction-tombstones.sql` | New table `transaction_tombstones`. Required: a `plaid_transaction_id TEXT NOT NULL` column that is the table's only key (primary key or unique). **No foreign key to `transactions`**, so a tombstone survives deleting the row and any `TRUNCATE transactions ... CASCADE`. The contract-guardian may add a timestamp column; the tests rely only on the key column. The `down` drops only this table. | additive |
| `db/schema.sql` | Reflects the new table with the same columns and constraints. | additive |
| `packages/contracts/*` | None expected. No wire shape changes. | none |

The table name `transaction_tombstones` and the column name `plaid_transaction_id` are pinned here because the acceptance commands and tests reference them. Everything else about the DDL is the guardian's call.

## Conventions this task must honor
- **Sign:** No amount is computed, transformed, or compared by this change. Sync keeps writing `txn.amount` exactly as Plaid delivers it, and the `DELETE` handler never reads the amount. The tombstone has no amount. If an implementation touches an amount, that is a defect.
- **Rounding:** Not applicable. No arithmetic. Re-identification keeps using its existing `toFixed(2)` key.
- **Landscape + exclusions:** Deletion and tombstoning apply regardless of `hidden`, `exclude_from_budget`, landscape, or category. A hidden row is still tombstoned when deleted (S1 uses `hidden = TRUE`). Tombstoning is not conditioned on any of these flags.
- **Null semantics:**
  - A tombstone key is never NULL or empty. Deleting an id that matches no row (the handler returns success today) writes **no** tombstone (S2).
  - A tombstoned incoming id is skipped entirely. It is not stored with partial fields and not stored as "unknown".
  - The `added` count returned by sync excludes skipped tombstoned ids.

## Toolchain prerequisites
| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `psql` and `createdb`/`dropdb` available, and a local Postgres reachable by the current user with CREATEDB | **yes** | local install | `psql -d postgres -tAc "select 1"` → `1` | filled at G0 |
| T2 | Two fresh throwaway databases, neither named `b8_finance`, and not the docker-compose `db` service's database | **yes** | `createdb b8_p40a_throwaway && createdb b8_p40a_schema` (drop both after) | `psql postgresql://localhost/b8_p40a_throwaway -tAc "select current_database()"` → `b8_p40a_throwaway` | filled at G0 |
| T3 | An exported `DATABASE_URL` wins over `apps/web/.env.local` in `npm run migrate:up`/`migrate:down`. The `--envPath` loader must not override it; otherwise the round trip could hit the real DB. | **yes** | n/a | `DATABASE_URL=postgresql://nobody@127.0.0.1:1/b8_p40a_throwaway npm run migrate:up; echo "exit=$?"` → non-zero exit with a connection error to port 1 (a success would mean `.env.local` overrode it) | filled at G0 |
| T4 | The integration config's scratch-DB guard refuses `b8_finance` before any pool exists | **yes** | existing (`lib/testDbGuard.setup.ts`) | `(cd apps/web && DATABASE_URL=postgresql://nobody@127.0.0.1:1/b8_finance npx vitest run --config vitest.integration.config.mts 2>&1 \| grep -c b8_finance)` → ≥1 (and non-zero vitest exit) | filled at G0 |
| T5 | Unit baseline | **yes** | existing | `npm test 2>&1 \| tail -8` → `69` files, `1024` tests passed, 0 failed | filled at G0 |
| T6 | `tsc` runs against the web app | **yes** | existing | `(cd apps/web && npx tsc --noEmit; echo "exit=$?")` → `exit=0` | filled at G0 |
| T7 | Live Plaid credentials or network | **NO** | n/a | n/a. Every sync scenario fakes the Plaid boundary (`plaidClient`, `reconcileAccountIds`, `recordPlaidBalances`) and drives the real `runSync`. | n/a |
| T8 | The dev database `b8_finance`, `.env.local` contents, docker-compose `db` | **NO** | n/a | n/a. No command below depends on them. | n/a |

Prerequisites the implementer must create. They do not exist today.
- `apps/web/app/api/v1/transactions/[id]/route.test.ts` (S1–S6).
- `apps/web/app/api/v1/sync/route.test.ts`, or an equivalent file under `app/api/v1/` (S7–S11). The integration config only collects `app/api/v1/**/*.test.ts`. The sync test must replace only the Plaid boundary and run the real `runSync` and the real route against the scratch DB. It must not stub `lib/db`.
- Fabricated fixtures only, with ids prefixed `p40a_` / `manual_p40a` / `csv_` as needed. Each test seeds what it asserts on. The files must pass alone and in any order after the existing suites, which leave tokened accounts behind. The sync test must therefore make its own account set deterministic, for example by truncating accounts as the overview suite does, and must clean its own tombstones. Tombstones have no FK, so `TRUNCATE transactions CASCADE` does not clear them.
- Every scenario test's title must begin with its id exactly as listed under Scenarios (`T40a-S1:` … `T40a-S11:`), so command #6 can find each by structure.

## Scenarios (what the new integration tests must establish)
Each is a separate `it` titled `T40a-Sn: …`.

| Id | Observable rule | Fixture and assertion |
|---|---|---|
| S1 | Deleting a Plaid-id row removes the row and writes exactly one tombstone whose key equals that row's exact `plaid_transaction_id`. The tombstone persists after the row is gone. | A `hidden = TRUE` row with id `p40a_s1`. After DELETE: no `transactions` row; `transaction_tombstones` has exactly one row with that key; the total tombstone count rose by exactly 1 (not one per row in the table). |
| S2 | Deleting an id that matches no row returns the same success response and writes no tombstone. | DELETE a non-existent numeric id; tombstone count unchanged; `success: true`. |
| S3 | Deleting a row whose key is already tombstoned still succeeds. The row is removed and exactly one tombstone remains, with no duplicate-key failure. | Seed a row and a tombstone with the same key; DELETE; success, row gone, count of tombstones with that key is 1. |
| S4 | **Atomic.** If the tombstone cannot be written, the delete does not happen and the response is not `success: true`. | Install a `BEFORE INSERT` trigger on `transaction_tombstones` that raises, DELETE a row, then drop the trigger in `finally`. Row still present, zero tombstones for the key, response `success` is not true (HTTP 5xx). |
| S5 | Non-Plaid rows delete normally. Tombstones are not consulted by the CSV importer. | Delete a `manual_`-prefixed row: success and row gone. Import a one-row CSV payload via the import route, delete that `csv_` row, import the identical payload again: second import reports `imported: 1` (re-created, as today). |
| S6 | Transfer partner is untouched. | Two rows in one `transfer_groups` row. Delete one leg. The partner row still exists with its `transfer_group_id` unchanged, the group row still exists, and no tombstone exists for the partner's key. |
| S7 | Sync skips a tombstoned id arriving as `added`, still processes its page-mates, and completes normally. | Faked page: `added` = [tombstoned id, a fresh id on a known account]. Fresh row inserted; no row for the tombstoned id; reported `added` count is 1; `errors` empty; the account's stored `cursor` equals the page's `next_cursor`. |
| S8 | **End to end.** A Plaid-sourced row deleted through the real DELETE route does not return when Plaid then sends `modified` for it. Live rows still update without losing owner edits. | Seed the row by a sync `added` event; DELETE it via the route; run sync with `modified` for the same id (changed name and amount). The row is absent. In the same run, a second live row whose owner-set `mapped_category` has `rule_applied = FALSE` receives `modified`: its amount updates and its `mapped_category` is unchanged. |
| S9 | A tombstoned id causes no write even if a row with that id exists. | Seed a row and a tombstone with the same key; `modified` with different fields; the row's fields are all unchanged. |
| S10 | **Re-identification control.** A tombstoned incoming id never claims a stored row. | A live stored row (id `p40a_live`) and an incoming `added` with a tombstoned id and the same account, date, amount and name. After sync: the live row's `plaid_transaction_id` is still `p40a_live`; no row has the tombstoned id; the row count did not change. |
| S11 | `removed` handling. For a tombstoned id it is a harmless no-op and keeps the tombstone. For a non-tombstoned live row it deletes the row and writes **no** tombstone. | Faked `removed` = [tombstoned id, a live row's id]. Sync completes with `errors` empty and the cursor advanced; the tombstone row still exists; the live row is gone; no tombstone exists for the live row's key. |

## Acceptance commands
All run from the repo root. `U=postgresql://localhost/b8_p40a_throwaway` against freshly created, empty databases (T2).

| # | Command | Expected |
|---|---|---|
| 1 | `(cd apps/web && npx tsc --noEmit)` | exit 0 |
| 2 | `npm run lint` | exit 0 |
| 3 | `npm test 2>&1 \| tail -8` | 0 failed; tests passed ≥ 1024 and files ≥ 69. No existing unit test is removed or weakened, and the count may only rise. |
| 4 | `set -e; U=postgresql://localhost/b8_p40a_throwaway; export DATABASE_URL=$U; npm run migrate:up >/dev/null; psql "$U" -tAc "select to_regclass('public.transaction_tombstones')"; npm run migrate:down >/dev/null; psql "$U" -tAc "select coalesce(to_regclass('public.transaction_tombstones')::text,'gone')"; psql "$U" -tAc "select to_regclass('public.transactions')"; npm run migrate:up >/dev/null; psql "$U" -tAc "select to_regclass('public.transaction_tombstones')"` | Four lines, exactly: `transaction_tombstones`, `gone`, `transactions`, `transaction_tombstones`. Catches a missing or incomplete `down` and a `down` that drops the wrong table. |
| 5 | `set -e; U=postgresql://localhost/b8_p40a_throwaway; S=postgresql://localhost/b8_p40a_schema; psql -v ON_ERROR_STOP=1 -q "$S" -f db/schema.sql >/dev/null; Q1="select column_name\|\|' '\|\|data_type\|\|' '\|\|is_nullable from information_schema.columns where table_name='transaction_tombstones' order by column_name"; Q2="select contype::text\|\|' '\|\|pg_get_constraintdef(oid) from pg_constraint where conrelid='transaction_tombstones'::regclass order by 1"; for Q in "$Q1" "$Q2"; do psql "$U" -tAc "$Q" > "${TMPDIR:-/tmp}/p40a.a"; psql "$S" -tAc "$Q" > "${TMPDIR:-/tmp}/p40a.b"; test -s "${TMPDIR:-/tmp}/p40a.a"; diff "${TMPDIR:-/tmp}/p40a.a" "${TMPDIR:-/tmp}/p40a.b"; done; psql "$U" -tAc "select count(*) from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey) where c.conrelid='transaction_tombstones'::regclass and c.contype in ('p','u') and array_length(c.conkey,1)=1 and a.attname='plaid_transaction_id'"; psql "$U" -tAc "select count(*) from pg_constraint where conrelid='transaction_tombstones'::regclass and contype='f'"` | Both diffs empty, with non-empty listings. Then `1` (the key column is the sole primary or unique key) and `0` (no foreign key, so a tombstone cannot cascade away with its transaction). Run after #4 left `$U` migrated up. |
| 6 | `set -e; O="$(mktemp)"; (cd apps/web && DATABASE_URL=postgresql://localhost/b8_p40a_throwaway npx vitest run --config vitest.integration.config.mts --reporter=json --outputFile="$O") \|\| true; node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);let bad=[];for(let n=1;n<=11;n++){const m=t.filter(x=>x.title.startsWith("T40a-S"+n+":"));if(m.length!==1\|\|m[0].status!=="passed")bad.push("S"+n+"="+m.map(x=>x.status).join("/")+"("+m.length+")")}const KNOWN=["the pre-auth ceremony endpoints remain reachable with no session cookie at all","the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio"];const unexpected=t.filter(x=>x.status==="failed"&&!KNOWN.includes(x.title)).map(x=>x.title);if(unexpected.length\|\|bad.length){console.log("FAIL",unexpected.join(" ; "),bad.join(","));process.exit(1)}console.log("OK",t.length,"tests, S1-S11 each present once and passed")' "$O"` | `OK <n> tests, S1-S11 each present once and passed`, exit 0. This runs the whole integration config, so existing route tests and the proxy test must still pass, except the two tests that already failed at the pre-task baseline (G0 amendment, named in `KNOWN`). Any other failure, including a new test failing, fails the gate. A stub, a missing scenario, a skipped scenario, or a duplicated title fails. |
| 7 | `(cd apps/web && DATABASE_URL=postgresql://localhost/b8_p40a_throwaway npx vitest run --config vitest.integration.config.mts 2>&1 \| tail -6)` run **twice in a row** | Both runs show the same pass count and no failures other than the two pre-existing ones named in #6's `KNOWN` list (G0 amendment). Seeded rows and tombstones are cleaned or idempotent, so a leftover tombstone from run 1 cannot hide or cause a failure in run 2. |

Mutation expectations. The orchestrator (G2/G3) may apply these one at a time and must see exactly the named scenarios fail while the rest still pass.
- Remove the tombstone check from the `added` loop: S7 fails.
- Remove it from the `modified` loop: S8 and S9 fail.
- Remove the tombstoned-id exclusion before `matchReissuedTransactions`: S10 fails.
- Make the DELETE handler swallow a tombstone-insert error: S4 fails.
- Insert the tombstone before and outside the delete's atomic unit: S4 fails.
- Write a tombstone in the sync `removed` loop: S11 fails.
- Tombstone every id in the table or unconditionally on any DELETE call: S2 fails.

Wiring note (A7). Production wiring is reached by command #6, because S7–S11 run the real `runSync` and S1–S6 run the real route handler. No separate static pin is needed. A static `grep` of `sync.ts` for a table name would be a proxy and is not used.

## Negative controls
| # | Rule | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | A tombstoned id is never re-created by `added` | `added` event carrying a tombstoned id | #6 (S7) |
| 2 | A tombstoned id is never re-created by `modified` | `modified` event for the id of a row just deleted via the real route | #6 (S8) |
| 3 | Sync does not write to any row bearing a tombstoned id | `modified` for a tombstoned id while a row with that id exists | #6 (S9) |
| 4 | A tombstoned incoming id does not claim a stored live row in re-identification | Live row with identical account, date, amount and name under a different id | #6 (S10) |
| 5 | Plaid's own removal is not an owner deletion | `removed` event for a live non-tombstoned id | #6 (S11) |
| 6 | No tombstone without a deleted row | DELETE of a non-existent id | #6 (S2) |
| 7 | Deletion and tombstone are atomic | Tombstone write forced to fail | #6 (S4) |
| 8 | Tombstones do not extend to the CSV importer or alter transfer partners | Re-import of a deleted `csv_` row; partner leg of a transfer group | #6 (S5, S6) |
| 9 | A tombstone does not depend on the transaction row | A foreign key to `transactions` | #5 (`0` foreign keys) and #6 (S1) |
| 10 | Existing sync behavior for live rows is preserved | `modified` on a live row with an owner-set category | #6 (S8) |

## Evidence required
- Output of acceptance #4 (migration up, down, up) captured verbatim.
- Output of #5 and of #6's final `OK` line.
- A mutation log: for each of the seven mutations above, the scenario ids that failed when applied, then green after revert. This proves S7–S11 are non-vacuous.
- The exact fixtures for S1, S7, S10 and S11 transcribed into EVIDENCE.md with fabricated ids only. No money figures in any tracked file.
- One sentence in EVIDENCE.md stating the re-auth gap (new ids after re-auth are not tombstoned) so the owner sees the known limit.

## Failure modes to test
- The tombstone is written but the check is added only to the `added` loop. `modified` is the live path that re-creates rows today (the upsert).
- The check is a read-then-write (SELECT tombstone, then INSERT) with a race. A row deleted mid-sync would return. The decision must be made in the write, not a prior read of tombstones that can go stale across a multi-page sync.
- The tombstone set is read once before paging and not after the owner deletes mid-sync.
- DELETE tombstones the integer `id` or some other value instead of `plaid_transaction_id`.
- DELETE reads the key after the row is gone, so a no-match returns NULL and fails or writes an empty key.
- A non-existent id writes a NULL or empty tombstone (S2).
- A second DELETE of an already-tombstoned id raises a unique violation and returns 500 (S3).
- The delete succeeds but the tombstone write fails silently (non-atomic, S4). The row is then re-creatable.
- Tombstone FK to `transactions` with `ON DELETE CASCADE` or `SET NULL`. It vanishes with the row (#5 and S1).
- `TRUNCATE transactions ... CASCADE` in another suite clears tombstones. They must not be linked.
- The re-identification step still sees the tombstoned incoming id and consumes a live row (S10).
- A skipped tombstoned id still bumps the returned `added` count, or the loop `continue`s past the cursor update, or an early return skips the cursor write.
- `removed` writes a tombstone (S11), or the `removed` DELETE is routed through shared code that now also tombstones.
- The sync `removed` path breaks for a tombstoned id (no matching row). It must not throw.
- The `modified` CASE that preserves owner `mapped_category` is accidentally rewritten (S8 sibling row).
- `hidden` rows skipped from tombstoning because a delete helper filters on `hidden` (S1 uses a hidden row).
- Manual or CSV rows: tombstoning skipped by a prefix test that misclassifies a real Plaid id, or CSV import accidentally starts honoring tombstones (S5).
- The down migration drops or alters `transactions`, or the guardian edits a committed migration.
- `db/schema.sql` omits the table or its key (#5).
- Tests that pass only on a clean DB or when run first. They leak fixtures that break the integration run, or depend on leftover tokened accounts from the overview suite (#7).
- Other delete paths for `transactions` are introduced without a tombstone. The reviewer checks that the only delete statements remain the route's DELETE and sync's `removed` loop.

## Rollback
Run `npm run migrate:down` against the target database to drop `transaction_tombstones`, then revert the commit (the route, `lib/sync.ts`, the new tests, `db/schema.sql`, and the migration file). No existing rows are modified by the up migration. Any tombstones recorded since are lost on `down`, which only means previously deleted transactions could be re-created by Plaid again. No CSV backup is needed because nothing is rewritten. After rollback, a `transactions` row deleted in the interim stays deleted.

---

## Could not verify by reading (orchestrator to verify)
1. `npm exec`/`npx tsc` location: I assumed `apps/web` holds the tsconfig (so `(cd apps/web && npx tsc --noEmit)`). I did not locate `tsconfig.json` at root versus `apps/web`.
2. That node-pg-migrate v9's `--envPath` loading does not override an already-exported `DATABASE_URL` (T3 verifies this).
3. That `db/schema.sql` applies cleanly in one pass to an empty database via `psql -f` (command #5 assumes it does).
4. That vitest's JSON reporter exposes `testResults[].assertionResults[].title/status` and `numFailedTests` in this version (vitest ^4.1.10). The shape is the Jest-compatible one, but I did not run it.
5. That `disableConsoleIntercept` in the integration config does not interfere with `--reporter=json --outputFile`.
6. Whether `vi.mock('@/lib/plaid')` and the other Plaid-boundary mocks resolve under the integration config's `@` alias. I expect so (the alias is declared there), but there is no existing mocked-Plaid route test to copy.
7. The 69 files / 1024 tests baseline was taken from the brief, not re-run.
8. Command #3's `tail -8` is a presentation choice. The orchestrator should read the vitest summary lines directly, since their format is not pinned.
9. Whether `apps/web/app/api/v1/transactions/[id]/` already contains a test file. The Glob for the sync route showed only `route.ts`. I did not glob the `[id]` directory, and brackets in paths are why the commands run the whole integration config rather than a path filter.
10. Neither integration scratch database is in use by another task (names `b8_p40a_throwaway` and `b8_p40a_schema`).
