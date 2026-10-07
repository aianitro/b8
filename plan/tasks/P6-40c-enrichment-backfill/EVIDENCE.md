# P6-40c-enrichment-backfill — Evidence (implementer)

Run on 2026-10-07 in the main working tree, branch `main` at `879ad00` (P6-40a and P6-40b present;
`git log --oneline -2` printed `879ad00 Keep more of each Plaid transaction (P6-40b)` /
`a236a34 Deleted Plaid transactions stay deleted (P6-40a)`). Scratch database
`b8_p640c_throwaway` only; `b8_finance` was never touched, and no `migrate:*` was run. No live Plaid
call: `@/lib/plaid` is faked in the test, and the script was never run with credentials against any
database other than the scratch one (see #4 for the one command that loads `.env.local`). Nothing
committed. The scratch DB was left with 0 transactions, 0 accounts and 0 tombstones afterwards.

## Files changed

| File | Change |
|---|---|
| `apps/web/scripts/backfill-enrichment.ts` | **New.** The operator script. `parseArgs` (strict: `--apply`, `--backup-dir <dir>` / `--backup-dir=<dir>`, anything else is a `UsageError`), `assertBackupDirAllowed` (refuses before any DB/network access), `runBackfill`, `main` (returns the exit code; 2 = usage/refused path, 1 = an item failed or the backup failed, 0 = clean), `isEntryPoint` (so importing never runs it). Reads each item's history with `transactionsSync` from no cursor, follows `has_more` in memory, discards the final cursor. Classifies every statement; writes only the eleven 40b columns from `enrichmentParams(plaidEnrichment(txn))`, via a guarded UPDATE in one transaction per item. In `--apply`, one CSV (0600, in a 0700 directory if it creates it) of the full pre-update rows of exactly the rows to change, fsynced before the first UPDATE. Output is counts, ordinals, the backup path and Plaid error codes only. |
| `apps/web/scripts/backfill-enrichment.test.ts` | **New**, integration (DB-backed), BF-01…BF-17, each tag once. Fakes only `@/lib/plaid` (records every request); the script's SQL, transport and 40b's mapping are real. Wraps the real `lib/db` where it needs to observe write order (BF-11) or land a concurrent sync between plan and write (BF-10). |
| `apps/web/package.json` | `"backfill:enrichment": "tsx --env-file=.env.local scripts/backfill-enrichment.ts"` |
| `package.json` | `"backfill:enrichment": "npm run backfill:enrichment -w @b8/web"` forwarder |
| `apps/web/vitest.integration.config.mts` | `include` gains the exact path `scripts/backfill-enrichment.test.ts` (no glob), with a comment saying why. |

Not touched: `lib/sync.ts`, `lib/plaidEnrichment.ts`, migrations, `db/schema.sql`, `packages/contracts/**`, any route/UI/display file, `daily-job.ts`/scheduler, `scripts/backup.ts`.

## Decisions the implementer made where the spec left room (for the reviewer)

1. **One CSV per run, written after every item has been fetched and classified and before any UPDATE.** Not one per item. A failed item (any page) contributes nothing to the CSV or the UPDATEs. The CSV re-selects with `plaid_raw IS NULL`, and only rows in the CSV are updated.
2. **The UPDATE's WHERE is `id = $1 AND plaid_transaction_id = $2 AND plaid_raw IS NULL`.** The Plaid id is repeated so that a row sync renumbered (re-identification) between plan and write is left alone.
3. **`TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` (or any error on any page) fails the item; it is not restarted.** The operator re-runs; the run is idempotent. BF-08 covers a failure on page 2 after page 1 was received.
4. **Item order is `ORDER BY min(accounts.id)` per access token.** Ordinals only; the token is never printed.
5. **Counts.** Every statement lands in exactly one bucket: `unknown_account` (its account is not one of this item's), then `pending_skipped`, then `not_local` / `already_enriched` / `would_update`. `matched` = `would_update + already_enriched` is also reported, because BF-13 states the identities in terms of it. `local_not_returned` counts LOCAL un-enriched rows on the item's accounts that no posted statement matched. It is a count of rows, not of statements, so it is outside the per-statement sum. A statement served twice (for example `added` on page 1 and `modified` on page 2) is counted once, and the later statement is used.
6. **Backup-directory refusal is stricter than the minimum G0 named.** Symlinks are resolved through the nearest existing ancestor. The path is refused if any segment is named `backups`, or if any ancestor contains a `.git` entry (any git work tree, not only this checkout). This needs no git binary and does not depend on the script's own location. If the owner ever keeps a dotfiles repo at `$HOME`, the default would be refused with a clear message and `--backup-dir` is the way out.
7. **CSV encoding.** Header = the `transactions` column names from `information_schema`, in ordinal order. Each value is Postgres's own `::text` of the column, always double-quoted with `""` escaping. NULL is an unquoted empty field, so NULL and `''` stay distinct. Text casts are used because node-postgres would turn DATE into a local-midnight Date and NUMERIC-through-JSON into a float.
8. **No structured logger in the script.** Its JSON lines carry an ISO timestamp, and BF-09 requires that the only digits in the output are counts and ordinals. Output goes through `console.log`/`console.error` (injectable in tests).
9. **The test tolerates other suites' leftover Plaid items.** Their tokens get an empty history from the fake. Per-item assertions find this file's items by ordinal, using the same ordering SQL. No `local_not_returned` total is asserted, because leftovers can contribute to it.

## Acceptance #1 — `cd apps/web && npx tsc --noEmit`
```
exit=0
```
(no compiler output)

## Acceptance #2 — `npm test`
```

> b8@0.1.0 test
> npm run test -w @b8/web


> @b8/web@0.1.0 test
> vitest run


 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app/apps/web

(node:1971) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:1971) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time

 Test Files  70 passed (70)
      Tests  1037 passed (1037)
   Start at  08:23:34
   Duration  6.06s (transform 1.91s, setup 0ms, import 4.32s, tests 6.60s, environment 6ms)

```
`exit=0`; `grep -c failed` on that output prints `0`. 70 files / 1037 tests, the same as the baseline (the new test is integration-only, by design).

## Acceptance #3 — `grep -c '"backfill:enrichment"' apps/web/package.json package.json`
```
package.json:1
apps/web/package.json:1
```

## Acceptance #4 — `npm run backfill:enrichment -w @b8/web -- --aply 2>&1; echo "exit=$?"`
Run with `DATABASE_URL=postgresql://nobody@127.0.0.1:1/b8_p640c_throwaway PLAID_CLIENT_ID=fixture-not-a-credential PLAID_SECRET=fixture-not-a-credential` in the environment. The npm script loads `.env.local` (`tsx --env-file`), and Node does not let an env file override a variable that is already set. These fabricated values therefore kept the real database URL and real Plaid credentials out of the process. Port 1 also shows that no connection was needed for the refusal.
```
$ npm run backfill:enrichment -w @b8/web -- --aply 2>&1; echo "exit=$?"

> @b8/web@0.1.0 backfill:enrichment
> tsx --env-file=.env.local scripts/backfill-enrichment.ts --aply

unknown argument; the only flags are --apply and --backup-dir
usage: npm run backfill:enrichment -w @b8/web [-- --apply] [--backup-dir <dir>]
  (no flag)          dry run: report counts, write nothing
  --apply            write a CSV backup of the rows to change, then update them
  --backup-dir <dir> where --apply writes the CSV (default $HOME/b8-backfill-backups;
                     never inside a git work tree or a backups directory)
npm error Lifecycle script `backfill:enrichment` failed with error:
npm error code 2
npm error path /Users/andreianpilogov/Documents/b8/app/apps/web
npm error workspace @b8/web@0.1.0
npm error location /Users/andreianpilogov/Documents/b8/app/apps/web
npm error command failed
npm error command sh -c tsx --env-file=.env.local scripts/backfill-enrichment.ts --aply
exit=2
```

## Acceptance #5 — ⟨I⟩ (`DATABASE_URL=postgresql://localhost/b8_p640c_throwaway`)
```

 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app/apps/web

 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-01: a dry run writes nothing to the database or the disk, and still finds rows to update 16ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-02: apply fills the eleven columns from 40b’s mapping, across pages and from the modified list 48ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-03: every column but the eleven is unchanged, although Plaid’s name, date, amount and category differ 19ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-04: never inserts and never deletes: unknown ids, a tombstoned id and a removed entry change no row count 20ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-05: the stored cursor is never sent and no accounts column changes, in a dry run or an apply 20ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-06: a pending statement for a stored id leaves that row un-enriched and is counted 14ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-07: an unknown account is skipped, and an id stored on another item’s account is never written from this item 15ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-08: a failing item is reported and skipped whole while the others are processed, and the exit is non-zero 30ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-09: stdout, stderr and the summary carry counts, ordinals, the backup path and an error code only 17ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-10: a second apply changes nothing, and neither a pre-enriched row nor one a sync enriched mid-run is overwritten 20ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-11: apply writes one 0600 CSV of the full pre-update rows it changes, complete before the first UPDATE 21ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-12: a backup directory that cannot be written stops the apply with no row changed 27ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-13: the dry run predicts the apply exactly, and every item’s counts add up 27ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-14: hidden, capital-landscape, excluded-category and grouped rows are enriched and keep their flags 13ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-15: an empty history and an item with no stored rows give numeric zero counts, exit 0 and no CSV 9ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-16: no flag is a dry run, --apply writes, an unknown flag is refused before any access, and import does not run 11ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-17: the default backup directory is $HOME/b8-backfill-backups, in-repo and backups paths are refused first, and a new one is 0700 12ms

 Test Files  1 passed (1)
      Tests  17 passed (17)
   Start at  08:23:47
   Duration  675ms (transform 66ms, setup 23ms, import 161ms, tests 372ms, environment 0ms)

```
Tag counts, `⟨I⟩ | grep -c 'BF-<nn>'`, each a fresh run:
```
BF-01: 1
BF-02: 1
BF-03: 1
BF-04: 1
BF-05: 1
BF-06: 1
BF-07: 1
BF-08: 1
BF-09: 1
BF-10: 1
BF-11: 1
BF-12: 1
BF-13: 1
BF-14: 1
BF-15: 1
BF-16: 1
BF-17: 1
```
(BF-17 is the G0 replacement for acceptance #7, so `⟨I⟩ | grep -c 'BF-17'` → `1` above is #7's result.)

## Acceptance #6 — `npm test -- --reporter=verbose 2>&1 | grep -c 'backfill-enrichment.test'`
```
0
```

## Acceptance #7 — replaced by BF-17 (G0 amendment 4); see #5.

## Acceptance #8 — `grep -cE 'INSERT INTO transactions|UPDATE accounts|DELETE FROM' apps/web/scripts/backfill-enrichment.ts`
```
0
```

## Acceptance #9 — `grep -c 'transactionsSync' … && grep -cE 'transactionsGet|itemGet|transactionsRefresh|institutionsGetById' …`
```
1
0
```

## Acceptance #10 — dry run against the scratch DB with zero token-bearing accounts
```
$ psql postgresql://localhost/b8_p640c_throwaway -tAc "select current_database(), (select count(*) from accounts where access_token is not null)"
b8_p640c_throwaway|0
$ ls -la $HOME/b8-backfill-backups (before)
ls: /Users/andreianpilogov/b8-backfill-backups: No such file or directory
$ cd apps/web && DATABASE_URL=$DATABASE_URL env -u PLAID_CLIENT_ID -u PLAID_SECRET npx tsx scripts/backfill-enrichment.ts 2>&1; echo "exit=$?"
backfill-enrichment: mode=dry-run items=0
totals: plaid_returned=0 pending_skipped=0 unknown_account=0 not_local=0 matched=0 would_update=0 already_enriched=0 local_not_returned=0 items_failed=0
exit=0
$ ls -la $HOME/b8-backfill-backups (after)
ls: /Users/andreianpilogov/b8-backfill-backups: No such file or directory
```
The dry run did not create the default directory either.

## Mutation probes (each applied to `backfill-enrichment.ts` alone, ⟨I⟩ run, then reverted; `cmp` against the saved original confirmed each revert)

All were run against the final test file. After the last revert, ⟨I⟩ printed `Tests  17 passed (17)`.

| Probe | Mutation | Result | Targeted test red |
|---|---|---|---|
| insert instead of update | a `not_local` statement is inserted (`INSERT INTO transactions (plaid_transaction_id, account_id, date, amount) …`) | `14 failed \| 3 passed (17)` | **BF-04** `AssertionError: expected 11 to be 9` (row count); also BF-01 and others |
| stored cursor reused | the walk starts from `SELECT cursor FROM accounts …` | `17 failed (17)` | **BF-05** `AssertionError: expected [ …(4) ] to not include 'SENTINEL-P40C-CURSOR-SENTINEL-P40C-AC…'` |
| dry-run writes | the `opts.apply &&` conditions removed from the backup and UPDATE phases | `5 failed \| 12 passed (17)` (BF-01 BF-08 BF-09 BF-13 BF-16) | **BF-01** `AssertionError: expected { transactions: [ …(9) ], …(2) } to deeply equal …` |
| missing NULL guard on the UPDATE | `AND plaid_raw IS NULL` removed from the UPDATE's WHERE (the CSV select keeps its own) | `1 failed \| 16 passed (17)` | **BF-10** `AssertionError: expected 4 to be 3` (the row a concurrent sync enriched mid-run was overwritten) |
| raw error object logged | `console.error('item failed', err)` in the item catch | `1 failed \| 16 passed (17)` | **BF-09** `AssertionError: expected 'backfill-enrichment: mode=dry-run ite…' not to contain 'SENTINEL-P40C'` |
| backup after the first UPDATE | the backup block moved after the UPDATE loop | `3 failed \| 14 passed (17)` (BF-08 BF-11 BF-12) | **BF-11** `AssertionError: expected { files: [], rows: -1 } to deeply equal { …(2) }` (no CSV on disk at the first UPDATE) |
| (extra) torn walk applied | a page error returns the pages received so far instead of failing the item | `2 failed \| 15 passed (17)` (BF-08 BF-09) | BF-08 (item A's page-1 rows written) |

The extra torn-walk probe was run before BF-08 gained the page-2 failure case. BF-08 covers that case now and went red under the probe.

## Not done / open items

- The real dry-run, `--apply`, before/after and idempotency evidence (spec "Evidence required" 2–7) is the orchestrator's operational step after merge. It was not run here.
- Acceptance #4 was run with fabricated Plaid values and a port-1 `DATABASE_URL` instead of with the Plaid variables unset (reason above). The refusal happens in argument parsing either way.
- The full integration suite was not run (only this file, per hold H4).
- Palette: not applicable (no UI).

---

## Cycle 1 (REVIEW-1 N1–N3), 2026-10-07

This work is in the same main working tree and is still uncommitted. Exit codes in this section were captured under `bash` (`$?` / `PIPESTATUS`).

### Changes
| File | Change |
|---|---|
| `package.json` (root) | **N3.** The forwarder is now `npm run backfill:enrichment -w @b8/web --`. The trailing `--` means anything after the root `npm run … --` is passed to the script. Before, npm parsed it as a flag of the inner `npm run`. |
| `apps/web/scripts/backfill-enrichment.ts` | **N1.** `BackfillDeps.writeChunk(fd, buf, offset, length)` defaults to `fs.writeSync`. The CSV is written in a loop until every byte is out, and a call that writes 0 bytes throws. After fsync and close, the file is read back. It must equal the intended buffer byte for byte, and its data-record count (`csvRecordCount`, which ignores newlines inside quotes) must equal the number of rows selected. Any mismatch throws. The caller then sends no UPDATE and exits 1 with `backup could not be written or verified; nothing was changed`. A file that fails verification is left in the backup directory (mode 0600). It is not deleted. **N2.** `fetchHistory` throws `WalkError('CURSOR_NOT_ADVANCING')` when `has_more` is true and `next_cursor` is missing, empty, or equal to the cursor just sent. It throws `WalkError('PAGE_LIMIT_EXCEEDED')` after `MAX_PAGES_PER_ITEM = 10000` pages. `safeErrorCode` prints these codes. The item fails whole: it is counted in `items_failed`, nothing it returned is applied, and the exit is non-zero. |
| `apps/web/scripts/backfill-enrichment.test.ts` | **BF-18:** (a) a write that reports every byte but writes half, and (b) a write that returns 0, each give a non-zero exit, `updated = 0`, no backup, and a full-table snapshot identical to before; (c) genuine short writes of 7 bytes per call are completed by the loop, and the run proceeds with a whole CSV. **BF-19:** item A's page 2 returns the cursor that fetched it, and item C returns `has_more` with `''`. Both fail with `CURSOR_NOT_ADVANCING`, there are exactly 2 and 1 requests (no loop), and the snapshot is unchanged. In a second run, C omits `next_cursor` (`CURSOR_NOT_ADVANCING`) and A's history never ends (`PAGE_LIMIT_EXCEEDED` after exactly `MAX_PAGES_PER_ITEM` requests). The fake gained an `endless` token set and per-cursor failures. `countingDeps` gained a `writeChunk` that counts as a touch. |

### N3: both forms of the command
Run with `DATABASE_URL=postgresql://nobody@127.0.0.1:1/b8_p640c_throwaway PLAID_CLIENT_ID=fixture PLAID_SECRET=fixture`. Port 1 means no database can be reached, and the fabricated Plaid values take precedence over `.env.local`. The repo path is shown as `<repo>`.
```
$ npm run backfill:enrichment -- --aply 2>&1; echo "exit=$?"     (repo root)

> b8@0.1.0 backfill:enrichment
> npm run backfill:enrichment -w @b8/web -- --aply


> @b8/web@0.1.0 backfill:enrichment
> tsx --env-file=.env.local scripts/backfill-enrichment.ts --aply

unknown argument; the only flags are --apply and --backup-dir
usage: npm run backfill:enrichment -w @b8/web [-- --apply] [--backup-dir <dir>]
  (no flag)          dry run: report counts, write nothing
  --apply            write a CSV backup of the rows to change, then update them
  --backup-dir <dir> where --apply writes the CSV (default $HOME/b8-backfill-backups;
                     never inside a git work tree or a backups directory)
npm error Lifecycle script `backfill:enrichment` failed with error:
npm error code 2
npm error path <repo>/apps/web
npm error workspace @b8/web@0.1.0
npm error location <repo>/apps/web
npm error command failed
npm error command sh -c tsx --env-file=.env.local scripts/backfill-enrichment.ts --aply
exit=2

$ npm run backfill:enrichment -w @b8/web -- --aply 2>&1; echo "exit=$?"

> @b8/web@0.1.0 backfill:enrichment
> tsx --env-file=.env.local scripts/backfill-enrichment.ts --aply

unknown argument; the only flags are --apply and --backup-dir
usage: npm run backfill:enrichment -w @b8/web [-- --apply] [--backup-dir <dir>]
  (no flag)          dry run: report counts, write nothing
  --apply            write a CSV backup of the rows to change, then update them
  --backup-dir <dir> where --apply writes the CSV (default $HOME/b8-backfill-backups;
                     never inside a git work tree or a backups directory)
npm error Lifecycle script `backfill:enrichment` failed with error:
npm error code 2
npm error path <repo>/apps/web
npm error workspace @b8/web@0.1.0
npm error location <repo>/apps/web
npm error command failed
npm error command sh -c tsx --env-file=.env.local scripts/backfill-enrichment.ts --aply
exit=2

$ npm run backfill:enrichment -- --apply --backup-dir <repo>/apps/web/p40c-x 2>&1; echo "exit=$?"     (repo root)

> b8@0.1.0 backfill:enrichment
> npm run backfill:enrichment -w @b8/web -- --apply --backup-dir <repo>/apps/web/p40c-x


> @b8/web@0.1.0 backfill:enrichment
> tsx --env-file=.env.local scripts/backfill-enrichment.ts --apply --backup-dir <repo>/apps/web/p40c-x

refusing a backup directory inside a git work tree
usage: npm run backfill:enrichment -w @b8/web [-- --apply] [--backup-dir <dir>]
  (no flag)          dry run: report counts, write nothing
  --apply            write a CSV backup of the rows to change, then update them
  --backup-dir <dir> where --apply writes the CSV (default $HOME/b8-backfill-backups;
                     never inside a git work tree or a backups directory)
npm error Lifecycle script `backfill:enrichment` failed with error:
npm error code 2
npm error path <repo>/apps/web
npm error workspace @b8/web@0.1.0
npm error location <repo>/apps/web
npm error command failed
npm error command sh -c tsx --env-file=.env.local scripts/backfill-enrichment.ts --apply --backup-dir <repo>/apps/web/p40c-x
exit=2

$ npm run backfill:enrichment -w @b8/web -- --apply --backup-dir <repo>/apps/web/p40c-x 2>&1; echo "exit=$?"

> @b8/web@0.1.0 backfill:enrichment
> tsx --env-file=.env.local scripts/backfill-enrichment.ts --apply --backup-dir <repo>/apps/web/p40c-x

refusing a backup directory inside a git work tree
usage: npm run backfill:enrichment -w @b8/web [-- --apply] [--backup-dir <dir>]
  (no flag)          dry run: report counts, write nothing
  --apply            write a CSV backup of the rows to change, then update them
  --backup-dir <dir> where --apply writes the CSV (default $HOME/b8-backfill-backups;
                     never inside a git work tree or a backups directory)
npm error Lifecycle script `backfill:enrichment` failed with error:
npm error code 2
npm error path <repo>/apps/web
npm error workspace @b8/web@0.1.0
npm error location <repo>/apps/web
npm error command failed
npm error command sh -c tsx --env-file=.env.local scripts/backfill-enrichment.ts --apply --backup-dir <repo>/apps/web/p40c-x
exit=2
ls: <repo>/apps/web/p40c-x: No such file or directory
```
The `--apply --backup-dir` lines show `--apply` reaching the script as `--apply` in both forms. The refusal comes from the backup-directory check, which only runs after both flags have parsed. No directory was created.

N3 probe: the root forwarder was temporarily put back to the pre-fix form (no trailing `--`), then restored.
```
> b8@0.1.0 backfill:enrichment
> npm run backfill:enrichment -w @b8/web --aply

> @b8/web@0.1.0 backfill:enrichment
> tsx --env-file=.env.local scripts/backfill-enrichment.ts

backfill could not run (listing items failed); nothing was changed
npm error Lifecycle script `backfill:enrichment` failed with error:
npm error code 1
exit=1
```

### Acceptance re-run
- **#1** `cd apps/web && npx tsc --noEmit` → `exit=0` (no output). `npx eslint` on the script, the test and the config → exit 0.
- **#2** `npm test` → `exit=0`, `Test Files  70 passed (70)`, `Tests  1037 passed (1037)`, `grep -c failed` → `0`.
- **#3** → `apps/web/package.json:1`, `package.json:1`.
- **#4** → see the N3 block above: `exit=2` with usage naming `--apply`, from the repo root and with `-w @b8/web`.
- **#5** ⟨I⟩ (`DATABASE_URL=postgresql://localhost/b8_p640c_throwaway`):
```

 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app/apps/web

 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-01: a dry run writes nothing to the database or the disk, and still finds rows to update 13ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-02: apply fills the eleven columns from 40b’s mapping, across pages and from the modified list 32ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-03: every column but the eleven is unchanged, although Plaid’s name, date, amount and category differ 16ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-04: never inserts and never deletes: unknown ids, a tombstoned id and a removed entry change no row count 15ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-05: the stored cursor is never sent and no accounts column changes, in a dry run or an apply 16ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-06: a pending statement for a stored id leaves that row un-enriched and is counted 14ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-07: an unknown account is skipped, and an id stored on another item’s account is never written from this item 13ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-08: a failing item is reported and skipped whole while the others are processed, and the exit is non-zero 25ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-09: stdout, stderr and the summary carry counts, ordinals, the backup path and an error code only 15ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-10: a second apply changes nothing, and neither a pre-enriched row nor one a sync enriched mid-run is overwritten 17ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-11: apply writes one 0600 CSV of the full pre-update rows it changes, complete before the first UPDATE 18ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-12: a backup directory that cannot be written stops the apply with no row changed 11ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-13: the dry run predicts the apply exactly, and every item’s counts add up 16ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-14: hidden, capital-landscape, excluded-category and grouped rows are enriched and keep their flags 14ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-15: an empty history and an item with no stored rows give numeric zero counts, exit 0 and no CSV 10ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-16: no flag is a dry run, --apply writes, an unknown flag is refused before any access, and import does not run 14ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-17: the default backup directory is $HOME/b8-backfill-backups, in-repo and backups paths are refused first, and a new one is 0700 17ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-18: a backup write that falls short is detected, and the apply stops before any UPDATE 26ms
 ✓ scripts/backfill-enrichment.test.ts > enrichment backfill > BF-19: a walk whose cursor does not advance, or never ends, fails its item instead of looping 17ms

 Test Files  1 passed (1)
      Tests  19 passed (19)
   Start at  10:05:21
   Duration  634ms (transform 65ms, setup 21ms, import 155ms, tests 347ms, environment 0ms)

```
Tag counts (a fresh ⟨I⟩ per tag):
```
BF-01: 1
BF-02: 1
BF-03: 1
BF-04: 1
BF-05: 1
BF-06: 1
BF-07: 1
BF-08: 1
BF-09: 1
BF-10: 1
BF-11: 1
BF-12: 1
BF-13: 1
BF-14: 1
BF-15: 1
BF-16: 1
BF-17: 1
BF-18: 1
BF-19: 1
```
- **#6** `npm test -- --reporter=verbose 2>&1 | grep -c 'backfill-enrichment.test'` → `0`.
- **#7** → BF-17 above (`1`).
- **#8** → `0`.
- **#9** → `1` then `0`.
- **#10** (scratch DB: `b8_p640c_throwaway|0` token-bearing accounts):
```
ls: /Users/andreianpilogov/b8-backfill-backups: No such file or directory
backfill-enrichment: mode=dry-run items=0
totals: plaid_returned=0 pending_skipped=0 unknown_account=0 not_local=0 matched=0 would_update=0 already_enriched=0 local_not_returned=0 items_failed=0
exit=0
ls: /Users/andreianpilogov/b8-backfill-backups: No such file or directory
```

### Mutation probes (cycle-1 script as the base; each applied, ⟨I⟩ run, reverted; `cmp` confirmed the restore and ⟨I⟩ was green again at 19/19)
| Probe | Result | Target |
|---|---|---|
| insert instead of update | `15 failed \| 4 passed (19)` | BF-04 red |
| stored cursor reused | `19 failed (19)` | BF-05 red |
| dry-run writes | `5 failed \| 14 passed (19)` (BF-01 BF-08 BF-09 BF-13 BF-16) | BF-01 red |
| no `plaid_raw IS NULL` on the UPDATE | `1 failed \| 18 passed (19)` | BF-10 red |
| raw error object logged | `1 failed \| 18 passed (19)` | BF-09 red |
| backup after the first UPDATE | `4 failed \| 15 passed (19)` (BF-08 BF-11 BF-12 BF-18) | BF-11 red |
| **N1 removed** (one `writeChunk` call with its return ignored, no read-back) | `1 failed \| 18 passed (19)` | **BF-18** red: `AssertionError: expected 4 to be +0` (rows were updated despite the short write) |
| **N1 read-back removed, loop kept** | `1 failed \| 18 passed (19)` | **BF-18** red: same assertion (the over-reporting write is caught only by the read-back) |
| **N2 cursor check removed, page cap kept** | `1 failed \| 18 passed (19)` | **BF-19** red: the item failed as `PAGE_LIMIT_EXCEEDED` after 10000 pages instead of `CURSOR_NOT_ADVANCING` |
| **N2 removed entirely** | run exit 1: `Tests  18 passed (19)`, `Errors  1 error`, `Error: [vitest-pool]: Worker forks emitted error. … Worker exited unexpectedly` after about 35 s | **BF-19** never completed. The walk looped until the worker died; that is the loop the fix removes. This probe is red as a run failure, not as an assertion. |

The crashed N2-off run skipped the file's `afterAll`. It left fabricated fixture rows in the scratch DB, plus one orphaned fixture `transfer_groups` row and one fixture `properties` row. The next normal run's cleanup removed the fixture rows. I deleted the two orphans by hand in `b8_p640c_throwaway` only. The scratch DB was then at 0 transactions, 0 accounts, 0 tombstones, 0 transfer groups, 0 properties and 0 budget categories, and it was still 0/0/0 (transactions/accounts/tombstones) after the final ⟨I⟩ run.

---

## Real run on the home server (orchestrator, 2026-10-07, after deploy a5f14b2) — counts only

**Before:** transactions 1777; `plaid_raw IS NULL` 1777 (of which Plaid-sourced, i.e. not `manual_`/`csv_`, 1262); Plaid items 5; cursor fingerprint (sha256 prefix over all accounts' id:cursor) `7d59cdf77eff8a79`.

**Dry run** (`npm run backfill:enrichment -w @b8/web`): exit 0, no backup dir created.
`totals: plaid_returned=957 pending_skipped=10 unknown_account=0 not_local=541 matched=406 would_update=406 already_enriched=0 local_not_returned=1315 items_failed=0`

**Apply** (`… -- --apply`): exit 0. `updated=406`, `items_failed=0`. Backup: 406 data rows, `~/b8-backfill-backups/enrichment-backfill-20261007T172258.750Z.csv`, file `-rw-------`, dir `drwx------`, outside the repo and outside `apps/backups`.

**After:** transactions 1777 (unchanged); `plaid_raw IS NULL` 1371 (−406 exactly); cursor fingerprint `7d59cdf77eff8a79` (unchanged). Read-only comparison of every backed-up row against the table over the 16 non-enrichment columns: `csv_rows 406, missing_rows 0, rows_differing_in_non_enrichment_columns 0, rows_still_unenriched 0`.

**Idempotency:** a second `--apply` → `would_update=0 already_enriched=406 updated=0`, "backup: none written, nothing to update"; still one CSV in the directory. Server checkout clean.

**The 541 `not_local` (read-only classification by account+date+amount, counts only):** tombstoned 0; a local row with the same account, date and amount exists for 531 — 524 under a *different Plaid id*, 7 as CSV-imported rows; no local counterpart 10, all dated in the current month (expected to arrive with the next daily sync). The 524 are rows stored under ids Plaid has since reissued (a re-link); they cannot be enriched by id and will not receive Plaid's `modified` corrections either — recorded as QUEUE hold H7.
