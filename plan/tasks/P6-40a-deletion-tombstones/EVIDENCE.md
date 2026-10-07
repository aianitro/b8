# P6-40a-deletion-tombstones — Evidence (implementer)

Run on 2026-10-07 from the repo root. Scratch databases: `b8_p40a_throwaway` (dropped and recreated
empty immediately before #4) and `b8_p40a_schema` (dropped and recreated empty immediately before
#5). `b8_finance` was never touched.

## Files changed

| File | Change |
|---|---|
| `apps/web/app/api/v1/transactions/[id]/route.ts` | `DELETE` now runs `DELETE ... RETURNING plaid_transaction_id` and the tombstone insert (`ON CONFLICT (plaid_transaction_id) DO NOTHING`) in one pooled-client `BEGIN`/`COMMIT`. If either fails, it rolls back and returns 500 `{ success: false, error: { code: 'SERVER_ERROR', ... } }`. The success response is unchanged. `PATCH` is untouched. |
| `apps/web/lib/sync.ts` | `added` and `modified` upserts became `INSERT ... SELECT ... WHERE NOT EXISTS (tombstone)`, so the tombstone check happens inside the write itself. A tombstone lookup runs on each page, just before `matchReissuedTransactions`, to keep tombstoned incoming ids out of re-identification. The `added` count uses the write's `rowCount`, so skipped ids are not counted. `removed` is unchanged apart from a comment explaining why it writes no tombstone. One info log line gives the skipped count (never ids). |
| `apps/web/app/api/v1/transactions/[id]/route.test.ts` | New: S1–S6. |
| `apps/web/app/api/v1/sync/route.test.ts` | New: S7–S11. Fakes only `@/lib/plaid`, `@/lib/plaidReconcile` and `@/lib/plaidBalances`, and drives the real `POST /api/v1/sync` → `runSync` → `syncItem` against the scratch DB. `lib/db` is not stubbed. |

Not touched: the migration, `db/schema.sql`, `shared/**`, `packages/contracts/**`, any UI file,
the CSV importer, manual create.

## Spec defect found: acceptance #6 cannot pass as written (orchestrator action needed)

The G0 amendment lets #6's node checker tolerate the two KNOWN failures. The checker never runs,
though. #6 starts with `set -e`, and while those two tests fail, `npx vitest run` exits 1, so the
shell aborts before `node -e`. Run verbatim, #6 exits `1` and prints neither `OK` nor `FAIL` (output
below). I did not change the spec. To get #6's verdict, I also ran a variant that differs only by
`|| true` after the vitest subshell, so the same node checker reads the same JSON. A
minimal fix for the spec is that same `|| true` (or dropping `set -e` before `node`).

## Acceptance #1 — `(cd apps/web && npx tsc --noEmit)`

```
exit=0
```
(no compiler output)

## Acceptance #2 — `npm run lint`

```

> b8@0.1.0 lint
> eslint

Pages directory cannot be found at /Users/andreianpilogov/Documents/b8/app/pages or /Users/andreianpilogov/Documents/b8/app/src/pages. If using a custom path, please configure with the `no-html-link-for-pages` rule in your eslint config file.

/Users/andreianpilogov/Documents/b8/app/apps/web/lib/domain/digest.ts
  195:7  warning  'GREEN_SOFT' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  197:7  warning  'RED_SOFT' is assigned a value but never used. Allowed unused vars must match /^_/u    @typescript-eslint/no-unused-vars

/Users/andreianpilogov/Documents/b8/app/apps/web/public/sw.js
  1:1  warning  Unused eslint-disable directive (no problems were reported from 'no-restricted-globals')

/Users/andreianpilogov/Documents/b8/app/apps/web/scripts/seed-demo.mjs
  457:17  warning  'pid' is assigned a value but never used. Allowed unused elements of array destructuring must match /^_/u  @typescript-eslint/no-unused-vars

✖ 4 problems (0 errors, 4 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

exit=0
```
All four warnings are in files this task did not touch.

## Acceptance #3 — `npm test 2>&1 | tail -8`

```
(Use `node --trace-warnings ...` to show where the warning was created)
(node:47175) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time

 Test Files  69 passed (69)
      Tests  1024 passed (1024)
   Start at  22:16:18
   Duration  5.65s (transform 1.50s, setup 0ms, import 3.83s, tests 6.19s, environment 7ms)
```
Same as the baseline (69 / 1024). No unit test was added, removed or changed. The new tests are
integration tests, under the integration config.

## Acceptance #4 — migrate up / down / up (fresh `b8_p40a_throwaway`)

Precheck after `dropdb`/`createdb`: `b8_p40a_throwaway|0` (database name, public table count).

```
transaction_tombstones
gone
transactions
transaction_tombstones
exit=0
```

## Acceptance #5 — schema.sql parity (fresh `b8_p40a_schema`)

Verbatim output of #5. Both `diff`s print nothing, and `set -e` with `test -s` confirms the listings
are non-empty:
```
1
0
exit=0
```
The listings that were compared, identical in both databases:
```
deleted_at timestamp with time zone NO
plaid_transaction_id text NO
c CHECK ((plaid_transaction_id <> ''::text))
p PRIMARY KEY (plaid_transaction_id)
```

## Acceptance #6 — whole integration config, S1–S11 by title

**Verbatim (as written in SPEC.md): exit 1, no verdict line**, because of the `set -e` defect above.
Last lines (the full output is otherwise JSON log lines from the auth/proxy/sync suites):
```
{"time":"2026-10-07T05:16:59.175Z","level":"error","scope":"auth","message":"auth handler threw","error":"relation \"webauthn_credentials\" does not exist"}
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.IucJJS1cJm
exit=1
```
(Count of lines starting `OK` or `FAIL` in that output: `0`.)

**Same command with `|| true` after the vitest subshell (the only change):**
```
OK 68 tests, S1-S11 each present once and passed
exit=0
```
68 = the 57 tests at the pre-task baseline + 11 new. The only failures are the two named in `KNOWN`:
```
 FAIL  proxy.test.ts > the request boundary > the pre-auth ceremony endpoints remain reachable with no session cookie at all
 FAIL  app/api/v1/overview/route.test.ts > GET /api/v1/overview, against a seeded scratch database > the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio
```
Pre-task baseline on the same scratch DB (before any code change): `Tests  2 failed | 55 passed (57)`,
the same two titles.

Each new file run alone: `app/api/v1/sync` → `Tests  5 passed (5)`;
`app/api/v1/transactions` → `Tests  6 passed (6)`.

## Acceptance #7 — whole integration config, twice in a row

Run 1:
```

 Test Files  2 failed | 7 passed (9)
      Tests  2 failed | 66 passed (68)
   Start at  22:17:03
   Duration  3.10s (transform 213ms, setup 56ms, import 1.12s, tests 914ms, environment 0ms)

```
Run 2:
```

 Test Files  2 failed | 7 passed (9)
      Tests  2 failed | 66 passed (68)
   Start at  22:17:07
   Duration  3.10s (transform 207ms, setup 55ms, import 1.14s, tests 920ms, environment 1ms)

```
Same pass count both times. The two failures are the KNOWN pair (titles listed under #6). After the
runs, the scratch DB holds `0` tombstones, `0` `p40a` transactions, `0` `p40a` accounts and `0`
`p40a` triggers.

## Mutation log

Each mutation was applied alone, then #6 was run (the `|| true` variant, so the checker reports which
scenarios failed), then the mutation was reverted by restoring a byte-identical copy (`cmp` verified)
and #6 was run again.

| # | Mutation (as applied) | Failed when applied | After revert |
|---|---|---|---|
| M1 | Remove the `WHERE NOT EXISTS (tombstone)` guard from the `added` upsert | **S7**, S10 | OK 68, S1–S11 passed |
| M2 | Remove it from the `modified` upsert | **S8, S9** | OK 68 |
| M3 | Remove the tombstoned-id exclusion before `matchReissuedTransactions` (`eligible = pageCandidates`) | **S10** | OK 68 |
| M4 | DELETE handler: wrap the tombstone insert in `try { } catch {}` | **S4** | OK 68 |
| M5 | DELETE handler: insert the tombstone (from `SELECT ... FROM transactions WHERE id`) on a separate pool connection before `BEGIN`, and drop the in-transaction insert | **S4** | OK 68 |
| M6 | Sync `removed` loop: also insert a tombstone | **S11** | OK 68 |
| M7a | DELETE handler: tombstone every `plaid_transaction_id` in the table | **S2**, S1, S6, S8 | OK 68 |
| M7b | DELETE handler: tombstone unconditionally, keyed on the URL id | **S2**, S1 | OK 68 |

Why some mutations broke more scenarios than SPEC.md names. In every case the named scenario
failed. The extra failures are:
- **M1 also fails S10.** That follows from S10's fixture as the spec defines it. When the `added`
  write is unguarded, the tombstoned incoming id is (correctly) kept out of re-identification, but
  the unguarded upsert then inserts it as a new row, so "no row has the tombstoned id" and "row
  count unchanged" both fail. No S10 fixture can tell "excluded from matching, then inserted" apart
  from a correct run without also testing the `added` guard.
- **M7a/M7b also fail S1 (and M7a also S6, S8).** Those scenarios assert an exact tombstone count or
  the absence of a tombstone for a row that was not deleted.

M7a and M7b wrote stray tombstones for other suites' rows into the scratch DB during their runs.
`b8_p40a_throwaway` was dropped and recreated before #4, so none of that state reached #4–#7.

Two places where I made the tests stricter than the spec's literal fixture. Without these changes,
the spec's own mutation list would not have been killed:
- **S2 seeds a row that is not being deleted.** Without one, M7a ("tombstone every id in the
  table") passes S2 whenever the table happens to be empty at that moment.
- **S4 has a second half: a `BEFORE DELETE` trigger on `transactions`, scoped to S4's one fabricated
  id.** With only the spec's tombstone trigger, M5 survives. The early, out-of-transaction tombstone
  insert is exactly what that trigger refuses, so nothing is deleted and the outcome looks atomic by
  accident. With the delete refused instead, M5 leaves a stray tombstone, which fails S4's
  zero-tombstones assertion (verified: the failing assertion is that one, `expected 1 to be +0`).
  Both triggers and their functions are dropped in `finally`.

## Fixtures (fabricated ids only; amounts are small fabricated values that live in the test files and are deliberately not repeated here)

**S1** (`transactions/[id]/route.test.ts`). Account `p40a_route_acct` ("Fabricated P40a Checking",
depository, operational, **no access token**). Rows `p40a_route_s1` (`hidden = TRUE`) and
`p40a_route_s1_sibling` (`hidden = FALSE`), both dated `2026-01-15`, name "Fabricated Merchant".
DELETE the `p40a_route_s1` row by its integer id. Assertions: 200 with
`{ success: true, data: null }`; the row is gone; exactly one tombstone keyed `p40a_route_s1`; none
for the sibling; none keyed on the integer id; the total tombstone count rose by exactly 1.

**S7** (`sync/route.test.ts`). Account `p40a_sync_acct` with access token `p40a-sync-item-token`,
cursor NULL. Tombstone `p40a_sync_s7_dead` seeded. One faked `transactionsSync` page:
`added = [p40a_sync_s7_dead (name "Fabricated P40a Cafe"), p40a_sync_s7_fresh (name "Fabricated P40a Bakery")]`,
both on `p40a_sync_acct`, date `2026-02-10`, `pending: false`; `modified = []`, `removed = []`,
`next_cursor = 'p40a-cursor-s7'`, `has_more = false`. Sync is requested for `p40a_sync_acct`
through the real route. Assertions: a `p40a_sync_s7_fresh` row exists; no `p40a_sync_s7_dead` row;
`synced` is 1; `errors` is `[]`; the stored cursor is `p40a-cursor-s7`; every queued page was consumed.

**S10**. Same account. A stored row `p40a_live` (date `2026-02-10`, name "Fabricated P40a Cafe").
Tombstone `p40a_sync_s10_dead`. One page:
`added = [p40a_sync_s10_dead]` with the **same account, date, amount and name** as `p40a_live`,
`next_cursor = 'p40a-cursor-s10'`. Assertions: `errors` is `[]`; the `p40a_live` row still exists
under that id; no row has `p40a_sync_s10_dead`; the account's row count is unchanged (1); `synced` is 0.

**S11**. Same account. Tombstone `p40a_sync_s11_dead` (no row). A stored row `p40a_sync_s11_live`.
One page: `removed = [{ transaction_id: 'p40a_sync_s11_dead' }, { transaction_id: 'p40a_sync_s11_live' }]`,
`next_cursor = 'p40a-cursor-s11'`. Assertions: `errors` is `[]`; the cursor is `p40a-cursor-s11`;
the tombstone `p40a_sync_s11_dead` still exists; the `p40a_sync_s11_live` row is gone; no tombstone
exists for `p40a_sync_s11_live`.

Faked boundary (whole sync file): `plaidClient()` returns `transactionsSync` (serves the queued
pages and throws if called for any other token or past the queue), `itemGet` (returns no institution
id, so `institutionsGetById` is never reached, and that method throws if it ever is);
`reconcileAccountIds` returns empty results; `recordPlaidBalances` returns 0. Cleanup, before each
test and after the last: this file's transactions (by account), tombstones keyed `p40a_sync_%` and
`p40a_live`, the account, and only the `sync_log` rows above the high-water mark recorded in
`beforeAll`.

## Known limit: re-auth

After a bank re-auth, Plaid issues new transaction ids for the same real transactions. Those new ids
are not tombstoned, so a transaction the owner deleted can come back once as an `added` row under its
new id.

## Other notes for the reviewer

- **Non-integer `id` on DELETE.** Before this change, `DELETE ... WHERE id = 'abc'` threw out of the
  handler and Next answered with its default 500. Now the same Postgres error is caught inside the
  transaction, rolled back, and answered as a 500 with the repo's `ApiResponse` error envelope
  (`SERVER_ERROR`, "Delete failed"). The status code and the lack of any validation are unchanged.
  Only the body is now the JSON envelope, as required by the brief's "any failure ... returns a
  non-success 5xx with the repo's ApiResponse error shape". I am flagging this in case the reviewer
  reads the "behaves as it does today" non-goal as covering the body too.
- **The re-identification exclusion is a read, not an in-statement check.** It is per page, not once
  per sync. A tombstone can only newly appear for an id that has a stored row. The matcher hands any
  incoming id it can see stored (same accounts, inside the page's date range) to the upsert, whose
  in-statement guard catches it. **One narrow race remains, and I have not closed it:** an incoming
  id whose stored row is dated outside the page's range (Plaid moved its date), deleted by the owner
  in the moment between the per-page read and the re-id `UPDATE`. The in-code comment states this.
  I did not add a second `NOT EXISTS` guard to the re-id `UPDATE`. With that guard, M3 (removing the
  exclusion) no longer fails S10, so the exclusion would go untested. A refused `UPDATE` would also
  still use up the claim. The reviewer may judge this differently.
- Stored rows that still carry an incoming tombstoned id are also kept out of the re-identification
  candidate pool. This matches what the matcher already does for any id Plaid is still sending. No
  scenario exercises it, and no mutation was run against it.
- Delete statements on `transactions`: the code still has only the route's `DELETE` and sync's
  `removed` loop. No new delete path was added.
- Palette: no UI touched.
