# P6-40e-plaid-rekey — Evidence (implementer)

Run on 2026-10-07 in the main working tree, branch `main` at `ba87115`, against the scratch database
`b8_p640e_throwaway` only. `b8_finance` was never touched, no `migrate:*` was run, and nothing called
live Plaid: `@/lib/plaid` is faked in both test files, and the two commands that load `.env.local`
(#4, #5) ran with a port-1 `DATABASE_URL` and fabricated Plaid credentials already set, which an env
file cannot override. **Nothing is committed.** The scratch database was left with 0 accounts, 0
transactions and 0 tombstones (`select count(*)` of each printed `0|0|0`).

## Files changed

| File | Change |
|---|---|
| `apps/web/scripts/rekey-plaid-ids.ts` | **New.** The operator script (dry run default, `--apply`, `--backup-dir`). Uses the shared walk/backup/flags; groups by `txnMatch`'s exported `key`, decides ambiguity before pairing, and makes each pair with `matchReissuedTransactions` itself. One `UPDATE transactions SET plaid_transaction_id` per row, by primary key + old id, with in-statement NOT EXISTS re-checks on the new id (stored anywhere / tombstoned). |
| `apps/web/scripts/rekey-plaid-ids.test.ts` | **New**, integration, RK-01…RK-22, each tag once. Fakes only `@/lib/plaid`. |
| `apps/web/scripts/plaid-script-shared.ts` | **New.** 40c's flags, backup-directory refusal, verified backup writer, error-code allowlist and history walk, extracted (moved, comments with them). The walk now also collects `removed` ids (40c ignores them). The backup takes a file stem and an optional fixed re-check predicate (40c passes `plaid_raw IS NULL`). Contains no write SQL. |
| `apps/web/scripts/backfill-enrichment.ts` | Extract only: imports the pieces above and re-exports them under its old names (`BackfillDb`/`BackfillDeps`/`BackfillOptions` become aliases). Its own transport, planning, UPDATE and output are untouched; its test is unmodified and green (#9). |
| `apps/web/lib/domain/txnMatch.ts` | `key` gains `export` and a comment saying why. No logic change. |
| `apps/web/lib/sync.ts` | **RC fix (H-d), 3 lines of logic + comment:** an item with any NULL-cursor account syncs from no cursor. RED/GREEN below. |
| `apps/web/app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts` | **New**, RC-01…RC-03. Real route, real `runSync` (reconcile and balance recording included), only `@/lib/plaid` faked. **This is the ⟨C⟩ path**; it sits under `app/api/v1/`, so the existing include glob collects it and no `include` change was needed for it. |
| `apps/web/vitest.integration.config.mts` | `include` gains the exact path `scripts/rekey-plaid-ids.test.ts`. |
| `apps/web/package.json` | `"rekey:plaid-ids": "tsx --env-file=.env.local scripts/rekey-plaid-ids.ts"` |
| `package.json` | `"rekey:plaid-ids": "npm run rekey:plaid-ids -w @b8/web --"` (trailing `--`, as 40c's). |

Not touched: the exchange-token route, `plaidReconcile.ts`, migrations, `db/schema.sql`, `packages/contracts/**`, any UI, the daily job, `scripts/backup.ts`. `AGENTS.md` did not reappear dirty.

## Decisions made where the spec left room

1. **Presence (D4) is by id alone, on any account**; targets (D5) must be posted, current and on one of the item's own accounts. A stored id that Plaid still sends under some other account is therefore `not_orphaned` (never renamed), the conservative reading.
2. **Pairing.** Ambiguity is decided per key (S = orphans + csv_/manual_ rows with the key; P = free candidates). Only for S = 1, P = 1 is `matchReissuedTransactions([candidate], [orphan])` called, and its result is the pair. If it ever declined a pair the key grouped, the item fails (`UNKNOWN`) rather than guessing. That cannot happen while both use the same `key`.
3. **Plaid-side counts** (beyond the spec's list, informational): `plaid_returned = plaid_removed + unknown_account + pending + posted`; `plaid_not_stored` = posted statements stored nowhere and not chosen as a new id. `plaid_not_stored` includes a tombstoned statement, since it is stored nowhere.
4. **A planned row that disappears between plan and backup** is not attempted and is counted in `skipped_at_write`. This keeps `would_rekey = rekeyed + skipped_at_write`. In that race only, the CSV lacks the row. Not tested; it needs a delete in the gap between two reads of one run.
5. **No SAVEPOINT around each UPDATE.** The NOT EXISTS re-check covers every committed concurrent change (RK-13). A concurrent *uncommitted* insert of the same new id would raise a unique violation, and the item would then roll back whole and be reported failed. That is safe, and the next run re-plans it.
6. **Output in a dry run omits `rekeyed`/`skipped_at_write`** (as 40c omits `updated`). The summary object always carries all 18 counts (RK-20).
7. **The fixture uses one sentinel cursor per item on every account of it**, matching what sync leaves (the G0 facts show one distinct cursor per item). The H-d fix makes only a NULL among them significant.

## Root cause

**Finding.** The designed path works. A token change through exchange-token nulls the cursor, and the cursor-less re-delivery that follows re-keys every row in place (RC-01, green on unmodified code). The real symptom has three parts: old ids still stored, new ids stored *nowhere*, and every cursor non-null and consistent. It therefore means sync never processed those new ids as `added` or `modified`. Had it done so, the matcher would have renamed the rows, or the upsert would have inserted the new ids, and either way the new ids would be stored. RC-02 reproduces exactly this symptom with the real code: same item, stored cursor sent, a delta that never mentions the history. **The chosen explanation is H-a, an operational event, not a defect in the designed path.** One alternative (H-f below) fits the same facts and is *not* refuted by anything on file. A discriminating read-only check is given for it.

Separately, RC-03 found **H-d to be a live defect** (RED on unmodified code), and it is fixed here. It is **not** the cause of these orphans (reasons below). A second live defect, H-g, was found while reading sync. It is reported and **not fixed**, because it is outside this task's declared surface.

| Hypothesis | Verdict | Evidence |
|---|---|---|
| **H-a** same-item reissue, sync stayed incremental | **Chosen** (consistent with every fact on file) | RC-02 (green): with an unchanged token and a stored cursor, the first request carries the stored cursor, the history under new ids is never delivered, the four rows keep the ids Plaid no longer uses, and none of the new ids is stored. G0 facts: no NULL or mixed cursors on any item; no burst of re-delivered rows since mid-August; orphan rows all created before September, i.e. ids changed once, around end of August, and everything stored afterwards is fine. |
| **H-b** token changed through a path that keeps the cursor | Rejected | `git grep` over `apps/web` (tests excluded) finds exactly two statements that change `accounts.access_token`, both in the exchange-token route: the reconnect UPDATE, which sets `cursor = CASE WHEN access_token IS DISTINCT FROM $4 THEN NULL ELSE cursor END`, and the repoint UPDATE, which sets `cursor = NULL`. The only INSERTs are the route's own (a new row's cursor is NULL), the manual-account route (`access_token` NULL), and `seed-demo.mjs` (demo only). `plaidReconcile` changes `accounts.id`, not the token. RC-01 exercises the route and shows the cursor NULL afterwards. |
| **H-c** the `added` re-identification ran but did not pair | Rejected | Had the `added` path run for these statements, any statement it did not pair would have been inserted by the upsert right below it (sync.ts, same page loop), and its new id would now be stored. The diagnosis shows the candidates' ids are stored nowhere. RC-01 shows the path pairs correctly across two pages. |
| **H-d** first account row's cursor, no ORDER BY | **Live defect, fixed; not causal here** | RC-03 RED before the fix (below): in physical order NULL-first the request carried no cursor, in order set-first it carried the stored cursor. It is fixed so that any NULL-cursor account makes the item sync from no cursor. Not the cause of this symptom: (1) G0 shows no item with a NULL or mixed cursor; (2) after exchange-token every account of the new token is NULL (no mix), and sync then writes one cursor to all of them; (3) the state H-d mishandles is a never-synced account beside synced siblings (reachable when an account is added to an existing item under the same token, because the route inserts it with a NULL cursor). It loses *that account's* history. It does not orphan rows that were already stored. |
| **H-e** re-sync never completed / matcher did not exist yet | Rejected as unsupported | `git log -S matchReissuedTransactions`: `e7d787b 2026-08-10 Re-identify reissued transactions instead of duplicating history`. `git log -S 'IS DISTINCT FROM $4 THEN NULL'`: `8b0c2f1 2026-08-07`, merged as `898a845 2026-08-11`. Both predate the end-of-August window. The repo cannot show when the server was deployed. A failed first re-sync would leave the cursor NULL (sync writes the cursor only after a successful walk), and the next successful sync would re-deliver. That contradicts "no NULL cursors, no burst". |
| **H-f** (added) the re-delivery arrived but was dropped as "unrecognized account", with the cursor still advanced | **Not refuted; flagged** | `syncItem` skips every statement whose `account_id` is not in the item's stored account ids (`unmatchedAccountIds`, logged and not saved), and still writes `next_cursor` at the end. `runSyncInner` catches a reconcile failure and syncs anyway. So consider a re-link whose new item reports new account ids, whose first cursor-less sync ran before reconcile remapped them. Its whole history would be dropped while the cursor advanced, and a later reconcile would cascade the old rows onto the new account ids. The result is the same symptom: no burst, consistent non-null cursors, candidates on the same account id. **Discriminating read-only check for the orchestrator:** the server's sync logs around end of August, counting `reconcile failed for token` and `transactions for unrecognized account_ids` lines (counts and dates only), or the item-1 account ids in a nightly dump from before end of August compared with today's (count of ids that differ). Ids that differ implies H-f (or a re-link). Ids unchanged and no such log lines implies H-a. Not fixed: changing whether sync advances the cursor past dropped statements is a sync-semantics change outside this task. |
| **H-g** (added) cross-page re-claim in sync's re-identification | **Live defect, reproduced, not fixed; flagged** | `syncItem` matches per page, and a row it renamed on an earlier page is a candidate again on a later page, because its new id is not in *that* page's incoming ids. Reproduced with a throwaway test against the real `runSync` (written, run, deleted; not in the tree). Setup: two identical stored rows (same account, date, amount and name) under old ids; their two new ids are served from no cursor, one per page. Result: `RESULT ["tmp-new-2","tmp-old-2"]`. Page 2's id re-claimed the row page 1 had renamed. One row stays orphaned, and page 1's new id is stored nowhere. It can only affect same-key groups split across pages, so at most a few of the diagnosis's ambiguous rows, and it cannot explain the bulk. It is relevant to RC-01's "designed path" only for identical same-day transactions. A fix (exclude ids already seen earlier in the walk from the candidate pool) belongs in its own task with its own regression test. |

### RC-03 RED on unmodified `sync.ts`, then GREEN after the fix

RED: `git diff --stat -- apps/web/lib/sync.ts` printed nothing before this run (the line `sync.ts unmodified` was printed by `git diff --quiet -- lib/sync.ts && echo`). Verbatim, structured-log lines removed (4 lines, all fabricated `rc-p40e` fixtures: two `re-identified transactions after item change` with count 2, and two `could not confidently reconcile` naming the fabricated mixed accounts):
```
 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app/apps/web
 ✓ app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts > why reissued rows stayed orphaned > RC-01: a token change through exchange-token nulls the cursor, and the full re-delivery re-keys every row in place 31ms
 ✓ app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts > why reissued rows stayed orphaned > RC-02: ids reissued on the SAME item never reach sync: an incremental delta leaves the old rows orphaned 8ms
 × app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts > why reissued rows stayed orphaned > RC-03: an item whose accounts disagree on the cursor syncs from no cursor, whichever account the table returns first 20ms
   → expected [ { …(2) }, { …(2) } ] to deeply equal [ { …(2) }, { …(2) } ]
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts > why reissued rows stayed orphaned > RC-03: an item whose accounts disagree on the cursor syncs from no cursor, whichever account the table returns first
AssertionError: expected [ { …(2) }, { …(2) } ] to deeply equal [ { …(2) }, { …(2) } ]
- Expected
+ Received
@@ -2,9 +2,9 @@
    {
      "cursor": undefined,
      "first": "rc-p40e-acct-mix-null",
    },
    {
-     "cursor": undefined,
+     "cursor": "rc-p40e-cursor-mixed",
      "first": "rc-p40e-acct-mix-set",
    },
  ]
 ❯ app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts:261:22
    259|     // Both physical orders were exercised, and in both the item synce…
    260|     // account that never received its history receives it, whichever …
    261|     expect(observed).toEqual([
       |                      ^
    262|       { first: MIX_NULL, cursor: undefined },
    263|       { first: MIX_SET, cursor: undefined },
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)
   Start at  10:58:25
   Duration  357ms (transform 61ms, setup 21ms, import 163ms, tests 62ms, environment 0ms)
exit=1
```

GREEN, after the 3-line change to `runSyncInner`'s grouping:
```
 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app/apps/web
 ✓ app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts > why reissued rows stayed orphaned > RC-01: a token change through exchange-token nulls the cursor, and the full re-delivery re-keys every row in place 36ms
 ✓ app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts > why reissued rows stayed orphaned > RC-02: ids reissued on the SAME item never reach sync: an incremental delta leaves the old rows orphaned 8ms
 ✓ app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts > why reissued rows stayed orphaned > RC-03: an item whose accounts disagree on the cursor syncs from no cursor, whichever account the table returns first 6ms
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  10:58:41
   Duration  451ms (transform 71ms, setup 24ms, import 245ms, tests 54ms, environment 0ms)
exit=0
```
Repeated 5 more times after the fix: `Tests  3 passed (3)` each time.

## Acceptance #1 — `cd apps/web && npx tsc --noEmit`
```
## 1
exit=0
```
(no compiler output)

## Acceptance #2 — `npm test`
```
## 2

> b8@0.1.0 test
> npm run test -w @b8/web


> @b8/web@0.1.0 test
> vitest run


 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app/apps/web

(node:77006) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:77006) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time

 Test Files  72 passed (72)
      Tests  1112 passed (1112)
   Start at  15:08:44
   Duration  6.00s (transform 2.18s, setup 0ms, import 5.16s, tests 6.64s, environment 6ms)

exit=0
```
`grep -c failed` on that output: `0`. 72 files / 1112 tests, equal to the T8 baseline. The new tests are integration-only by design.

## Acceptance #3 — `grep -c '"rekey:plaid-ids"' apps/web/package.json package.json`
```
package.json:1
apps/web/package.json:1
```

## Acceptance #4 — from the repo root, `DATABASE_URL=postgresql://nobody@127.0.0.1:1/b8_p640e_throwaway PLAID_CLIENT_ID=fixture PLAID_SECRET=fixture npm run rekey:plaid-ids -- --aply 2>&1; echo "exit=$?"`
```

> b8@0.1.0 rekey:plaid-ids
> npm run rekey:plaid-ids -w @b8/web -- --aply


> @b8/web@0.1.0 rekey:plaid-ids
> tsx --env-file=.env.local scripts/rekey-plaid-ids.ts --aply

unknown argument; the only flags are --apply and --backup-dir
usage: npm run rekey:plaid-ids -w @b8/web [-- --apply] [--backup-dir <dir>]
  (no flag)          dry run: report counts, write nothing
  --apply            write a CSV backup of the rows to re-key, then re-key them
  --backup-dir <dir> where --apply writes the CSV (default $HOME/b8-backfill-backups;
                     never inside a git work tree or a backups directory)
npm error Lifecycle script `rekey:plaid-ids` failed with error:
npm error code 2
npm error path /Users/andreianpilogov/Documents/b8/app/apps/web
npm error workspace @b8/web@0.1.0
npm error location /Users/andreianpilogov/Documents/b8/app/apps/web
npm error command failed
npm error command sh -c tsx --env-file=.env.local scripts/rekey-plaid-ids.ts --aply
exit=2
```

## Acceptance #5 — same environment, `npm run rekey:plaid-ids -- --apply --backup-dir "$PWD/apps/web/p640e-x" 2>&1; echo "exit=$?"; ls apps/web/p640e-x 2>&1`
```

> b8@0.1.0 rekey:plaid-ids
> npm run rekey:plaid-ids -w @b8/web -- --apply --backup-dir /Users/andreianpilogov/Documents/b8/app/apps/web/p640e-x


> @b8/web@0.1.0 rekey:plaid-ids
> tsx --env-file=.env.local scripts/rekey-plaid-ids.ts --apply --backup-dir /Users/andreianpilogov/Documents/b8/app/apps/web/p640e-x

refusing a backup directory inside a git work tree
usage: npm run rekey:plaid-ids -w @b8/web [-- --apply] [--backup-dir <dir>]
  (no flag)          dry run: report counts, write nothing
  --apply            write a CSV backup of the rows to re-key, then re-key them
  --backup-dir <dir> where --apply writes the CSV (default $HOME/b8-backfill-backups;
                     never inside a git work tree or a backups directory)
npm error Lifecycle script `rekey:plaid-ids` failed with error:
npm error code 2
npm error path /Users/andreianpilogov/Documents/b8/app/apps/web
npm error workspace @b8/web@0.1.0
npm error location /Users/andreianpilogov/Documents/b8/app/apps/web
npm error command failed
npm error command sh -c tsx --env-file=.env.local scripts/rekey-plaid-ids.ts --apply --backup-dir /Users/andreianpilogov/Documents/b8/app/apps/web/p640e-x
exit=2
ls: apps/web/p640e-x: No such file or directory
```

## Acceptance #6 — ⟨R⟩, then the tag counts
⟨R⟩ verbatim, with blank lines removed and the 3 structured-log lines removed. Those lines are `plaidReconcile` warnings emitted by the *real `runSync`* in RK-22, naming only fabricated `SENTINEL-P40E` accounts. They are not the script's output.
```
 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app/apps/web
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-01: a dry run writes nothing to the database or the disk, and still finds rows to re-key 36ms
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-02: apply re-keys exactly the unambiguous orphans and changes nothing but the id 37ms
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-03: the pairing is sync’s matcher — case, whitespace and rounding pair; name, date, cent, sign and account do not 22ms
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-04: a row whose id Plaid still sends stays, posted or pending, and a same-key new id is not used 19ms
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-05: csv_ and manual_ rows are never re-keyed, and a csv_ row sharing a key makes the orphan ambiguous 19ms
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-06: a candidate whose id is stored anywhere — same account, another account, another item — is never used 20ms
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-07: a tombstoned candidate is never used and takes no claim; a tombstoned stored row is left alone 20ms
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-08: 1:2, 2:1 and 2:2 groups are skipped and counted once per stored row, while a 1:1 group in the same run is re-keyed 18ms
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-09: a statement from another item’s walk, an untokened account and an unknown account are never applied 18ms
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-10: a pending statement is never a target, and an id added then removed is neither present nor a target 17ms
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-11: the whole walk is read before matching — a page-2 candidate and a page-3 modified one are paired 17ms
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-12: an item is re-keyed whole or not at all, and a failing item is isolated from the others 34ms
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-13: the UPDATE re-checks the old id, the new id and the tombstones at the moment of the write 16ms
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-14: apply writes one 0600 CSV of the full pre-update rows, complete before the first UPDATE; a failed backup changes nothing 40ms
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-15: the default directory is $HOME/b8-backfill-backups, created 0700; in-repo and backups paths are refused first 20ms
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-16: a second apply re-keys nothing, writes no CSV and changes nothing; the re-keyed rows are then present 20ms
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-17: stdout, stderr and the summary carry counts, ordinals, the backup path and an error code only 20ms
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-18: the stored cursor is never sent and no accounts column changes; a walk that cannot end fails its item 43ms
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-19: never inserts or deletes; every item’s counts add up; the dry run predicts the apply; flags are strict 21ms
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-20: every count is present and numeric, including for an empty history and an item with no stored rows 23ms
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-21: after the re-key, 40c’s real backfill enriches the re-keyed rows and no longer counts them not_local 27ms
 ✓ scripts/rekey-plaid-ids.test.ts > plaid id re-key > RK-22: a later sync delivering the new id as modified updates the re-keyed row in place, owner columns intact 19ms
 Test Files  1 passed (1)
      Tests  22 passed (22)
   Start at  15:14:10
   Duration  946ms (transform 129ms, setup 23ms, import 243ms, tests 563ms, environment 0ms)
```
Tag counts (`⟨R⟩ | grep -c 'RK-<nn>'`):
```
RK-01 1
RK-02 1
RK-03 1
RK-04 1
RK-05 1
RK-06 1
RK-07 1
RK-08 1
RK-09 1
RK-10 1
RK-11 1
RK-12 1
RK-13 1
RK-14 1
RK-15 1
RK-16 1
RK-17 1
RK-18 1
RK-19 1
RK-20 1
RK-21 1
RK-22 1
```

## Acceptance #7 — ⟨C⟩ with ⟨C⟩ = `(cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts 2>&1)`
```
 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app/apps/web
 ✓ app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts > why reissued rows stayed orphaned > RC-01: a token change through exchange-token nulls the cursor, and the full re-delivery re-keys every row in place 49ms
 ✓ app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts > why reissued rows stayed orphaned > RC-02: ids reissued on the SAME item never reach sync: an incremental delta leaves the old rows orphaned 14ms
 ✓ app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts > why reissued rows stayed orphaned > RC-03: an item whose accounts disagree on the cursor syncs from no cursor, whichever account the table returns first 8ms
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  15:09:43
   Duration  381ms (transform 62ms, setup 22ms, import 173ms, tests 76ms, environment 0ms)
```
Tag counts:
```
RC-01 1
RC-02 1
RC-03 1
```

## Acceptance #8 — the RK suite at UTC+13 and UTC-7
```
TZ=Pacific/Auckland
 Test Files  1 passed (1)
      Tests  22 passed (22)
   Start at  11:14:43
   Duration  915ms (transform 101ms, setup 24ms, import 198ms, tests 583ms, environment 0ms)

TZ=America/Los_Angeles
 Test Files  1 passed (1)
      Tests  22 passed (22)
   Start at  15:14:44
   Duration  936ms (transform 101ms, setup 21ms, import 200ms, tests 603ms, environment 0ms)
```

## Acceptance #9 — 40c's suite and the sync route tests; the two test files unedited
```

 Test Files  3 passed (3)
      Tests  42 passed (42)
   Start at  15:09:50
   Duration  1.75s (transform 138ms, setup 31ms, import 503ms, tests 872ms, environment 0ms)

--- diff --stat:
--- end
```
Equal to the G0 baseline (`42 passed (42)`), 0 failed; the `diff --stat` printed nothing.

## Acceptance #10 — `npm test -- --reporter=verbose 2>&1 | grep -cE 'rekey-plaid-ids.test'`
```
0
```

## Acceptance #11 — `grep -c 'txnMatch' apps/web/scripts/rekey-plaid-ids.ts`
```
2
```

## Acceptance #12 — `grep -cE 'toFixed|toLowerCase|toISOString' apps/web/scripts/rekey-plaid-ids.ts`
```
0
```

## Acceptance #13 — write-statement grep on the script, and on the shared module it factors into
```
0
shared module:
0
```

## Acceptance #14
The command as written: `grep -cE '...' rekey-plaid-ids.ts && grep -c 'transactionsSync' ...`. The first `grep -c` prints `0` and, because it counted nothing, exits 1, so `&&` never runs the second half:
```
0
exit=1
```
The second half run on its own:
```
apps/web/scripts/backfill-enrichment.ts:1
apps/web/scripts/rekey-plaid-ids.ts:1
```
The walk logic lives in `plaid-script-shared.ts`. Each script keeps its own one-call transport, which is where `transactionsSync` appears.

## Acceptance #15 — `git diff --name-only HEAD -- apps/web/lib/sync.ts apps/web/app/api/v1/plaid/exchange-token/route.ts apps/web/lib/domain/txnMatch.ts`
```
apps/web/lib/domain/txnMatch.ts
apps/web/lib/sync.ts
```
Non-empty, as allowed. `sync.ts` is the H-d fix, named in "Root cause" with RC-03 RED before and GREEN after. `txnMatch.ts` is export-only: the diff adds the `export` keyword and a 4-line comment, and no logic. ⟨C⟩ (#7) and #9 pass.

## Acceptance #16 — zero token-bearing accounts in the scratch DB
First line: `select count(*) from accounts where access_token is not null`. Then `ls -d $HOME/b8-backfill-backups` before and after the run:
```
0
ls: /Users/andreianpilogov/b8-backfill-backups: No such file or directory
rekey-plaid-ids: mode=dry-run items=0
totals: stored_rows=0 excluded_csv_manual=0 stored_tombstoned=0 not_orphaned=0 orphans=0 no_match=0 excluded_new_id_stored=0 excluded_new_id_tombstoned=0 ambiguous=0 would_rekey=0 plaid_returned=0 plaid_removed=0 unknown_account=0 pending=0 posted=0 plaid_not_stored=0 items_failed=0
exit=0
ls: /Users/andreianpilogov/b8-backfill-backups: No such file or directory
```

## Mutation probes
Each probe was applied to `scripts/rekey-plaid-ids.ts` alone by `mutate.py` (scratchpad, untracked). The script was saved first, ⟨R⟩ was run, the saved original was copied back, and `cmp` was run against it. Output, verbatim:
```
probe 1: drop the ambiguity rule
  red: RK-01 RK-02 RK-05 RK-08 RK-13 RK-14 RK-16 RK-17 RK-19 RK-21
  Tests  10 failed | 12 passed (22)
  cmp after revert: exit 0
probe 2: bypass the matcher key with a hand-rolled exact-equality key
  red: RK-01 RK-02 RK-03 RK-08 RK-10 RK-13 RK-14 RK-16 RK-17 RK-19 RK-21 RK-22
  Tests  12 failed | 10 passed (22)
  cmp after revert: exit 0
probe 3: drop the new-id-stored guard
  red: RK-01 RK-06 RK-13 RK-14 RK-16 RK-19
  Tests  6 failed | 16 passed (22)
  cmp after revert: exit 0
probe 4: drop the tombstone guard
  red: RK-02 RK-05 RK-07 RK-08 RK-13 RK-14 RK-16 RK-17 RK-19 RK-21
  Tests  10 failed | 12 passed (22)
  cmp after revert: exit 0
probe 5: drop the csv_/manual_ exclusion
  red: RK-01 RK-02 RK-05 RK-08 RK-13 RK-14 RK-16 RK-17 RK-19 RK-21
  Tests  10 failed | 12 passed (22)
  cmp after revert: exit 0
probe 6: drop the old-id-still-held WHERE clause
  red: RK-13
  Tests  1 failed | 21 passed (22)
  cmp after revert: exit 0
probe 7: write the CSV after the first UPDATE
  red: RK-13 RK-14
  Tests  2 failed | 20 passed (22)
  cmp after revert: exit 0
probe 8: send the stored cursor
  red: RK-01 RK-02 RK-03 RK-04 RK-05 RK-06 RK-07 RK-08 RK-09 RK-10 RK-11 RK-12 RK-13 RK-14 RK-15 RK-16 RK-17 RK-18 RK-19 RK-20 RK-21 RK-22
  Tests  22 failed (22)
  cmp after revert: exit 0
probe 9: ignore removed
  red: RK-01 RK-02 RK-03 RK-04 RK-10 RK-13 RK-14 RK-16 RK-17 RK-19 RK-21
  Tests  11 failed | 11 passed (22)
  cmp after revert: exit 0
```
Notes on how each probe was made:
- **#6** keeps `$2` bound (`AND $2::text IS NOT NULL`), so the probe tests the missing guard and not a parameter-type error.
- **#7** moves the backup block after the UPDATE loop.
- **#8** selects `min(cursor)` and sends it as the walk's first cursor. The fake refuses a cursor it never issued, so every item fails. The named red test is RK-18.

The probes were run twice: first before a usage-limit interruption, then again after the test file's last edit (the RK-17 privacy amount was changed to a tiny value, and the backup path is now stripped before the digit checks). The output above is the second run, and the results were identical. After it, `cmp` of the saved original against the working file exited 0. #6, #8 and #10 above were also re-captured after that edit. #1 (`tsc`) and eslint on the test file passed again.

## Not done / caveats
- H-f and H-g are reported, not fixed: both are sync-semantics changes outside this spec's surface. H-f needs the orchestrator's read-only log/dump check described above to be confirmed or refuted against real data.
- The real dry run and apply, the reconciliation with DIAGNOSIS.md's counts, and the 40c re-run are orchestrator steps after merge (evidence items 4–10), and were not run.
- RC-03 arranges physical row order by re-writing the leading row until the order flips (up to 200 tries). That worked on every run here (7 runs). If a future Postgres placed row versions differently, the test fails loudly with `could not arrange the physical row order`. It does not pass vacuously.

---

## Real run on the home server (orchestrator, 2026-10-07 ~15:30 server time, after deploy 741d4e1) — counts and hashes only

**Before:** transactions 1777; enriched 406; cursor fingerprint `7d59cdf77eff8a79`; csv/manual rows 515 (id-set hash `d062ad9f1ba59957`); id-map hash `40b2f2cd5a572e48`; tombstones 0.

**Dry run:** `stored_rows=1721 excluded_csv_manual=459 stored_tombstoned=0 not_orphaned=406 orphans=856 no_match=333 excluded_new_id_stored=0 excluded_new_id_tombstoned=0 ambiguous=5 would_rekey=518 … items_failed=0`. Reconciliation with DIAGNOSIS.md: 518 + 5 ambiguous = 523 vs the diagnosis's 524 fingerprint matches — the script's rules are stricter (ambiguity counted per stored row, CSV lookalikes count on the stored side); item 2 = 38 exactly as diagnosed; `no_match=333` are rows older than Plaid's returned history.

**Apply** (outside the 06:00 sync window): `rekeyed=518 skipped_at_write=0 items_failed=0`; backup 518 rows, `~/b8-backfill-backups/plaid-rekey-20261007T223148.923Z.csv`, `-rw-------` in a `drwx------` dir.

**After:** total 1777 (unchanged); cursor fingerprint unchanged; csv/manual 515, hash unchanged; tombstones 0; id-map hash changed (`644d0aabaa867b20`). Backup vs table, every column except `plaid_transaction_id`: `csv_rows 518, missing 0, rows_differing_outside_id 0, rows_with_id_unchanged 0`.

**Idempotency:** second `--apply` → `would_rekey=0 rekeyed=0`, "nothing to re-key", no new CSV.

**40c re-run:** dry run `not_local=23 matched=924 would_update=518 already_enriched=406`; apply `updated=518 items_failed=0`, backup 518 rows. **Final: 924 of 1777 rows enriched** (the rest are 515 CSV/manual rows and ~333 Plaid rows older than Plaid's returned history). `not_local` fell from 541 to 23 — recent transactions the next daily sync will deliver.
