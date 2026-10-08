# P6-40f-sync-reid-across-pages — Sync re-identification across pages
**Roadmap item:** ROADMAP.md §5 step 40f — sync re-identification across pages (H-g from 40e)
**Status:** FROZEN@G0 (2026-10-07; owner-approved scope amendment R4 in the G0 record at the end)
**Author:** spec-writer

## Goal
Within one sync walk of an item (the loop of `/transactions/sync` pages inside `syncItem`, from first request until `has_more` is false), a stored transaction row must be re-identified (given a new `plaid_transaction_id` because Plaid reissued it) at most once. An incoming id that has already been processed earlier in the same walk must never claim a stored row. A stored row that was written during the walk (renamed, or inserted or refreshed by an earlier page) is not a re-identification candidate for a later page. After a full re-delivery from no cursor, split across any number of pages, every stored row of a group of identical same-day transactions (same account, date, amount, name per `key` in `apps/web/lib/domain/txnMatch.ts`) ends up carrying exactly one of the new ids. No delivered new id is left stored nowhere, no duplicate row is created, primary keys do not change, and owner-set fields (`hidden`, `note`, `watched_at`, `mapped_category`, `rule_applied`, `transfer_group_id`, `property_id`) stay on the row they were on. The defect reproduced in P6-40e (H-g): two identical stored rows under old ids, with their two new ids delivered one per page, ended as `["tmp-new-2","tmp-old-2"]`, because page 2's id re-claimed the row page 1 had renamed. Behaviour for single-page walks, for syncs that re-identify nothing, and for the tombstone, enrichment and `modified`/`removed` paths is unchanged.

## Non-goals
- **H-f** (cursor advancing past statements for unrecognized accounts). Do not touch how `unmatchedAccountIds` or the cursor write behave.
- **Changing the matcher's key.** The exported `key` in `txnMatch.ts` and the one-definition-of-"same transaction" rule are untouched. Do not add fields (e.g. `authorized_date`, `merchant_name`, page number) to what makes two transactions "the same", and do not loosen it.
- **Cross-walk behaviour.** A stored row from an EARLIER sync run (not this walk) that no incoming id names is still a candidate for a later run's lone same-key id. That is the matcher's existing, accepted behaviour and a different problem. Do not add persisted "already re-identified" state, a new column or a new table to remember renames between runs. No test may assert on it.
- **Re-keying existing data.** 40e did that. No script, no backfill, no data repair.
- The tombstone race nits (P6-40a NITS, including N1's accepted narrow window), the H8/H9 holds, and the in-statement `NOT EXISTS` tombstone guard on the upserts. Do not weaken or relocate them.
- `matchReissuedTransactions` pairing order. Among identical rows the claim is greedy, lowest primary key first, in delivery order. Do not make it "smarter" (no fuzzy, date-tolerant or amount-tolerant matching).
- Pending-transaction handling, `modified` re-identification (the `modified` loop never re-identifies today and must not start), `removed` semantics (no tombstone from Plaid removals), the `added` counter semantics, and logging beyond keeping the existing `re-identified transactions after item change` line truthful.
- UI, API response shapes, `SyncResult` fields, the schema.
- Making this suite part of CI, or fixing H4's two unrelated stale failures in the full suite.

## Contracts touched
none. (No shared type, no migration, no `db/schema.sql` change, no change to the `key` export or to the `matchReissuedTransactions` signature or result shape. Changing the matcher's behaviour or key is out of scope. If the implementer concludes the matcher file must change at all, that is a spec question to escalate, not a quiet edit.)

## Conventions this task must honor
- **Sign:** Amounts are passed through as Plaid gives them and as stored (`transactions.amount`, Plaid convention: positive is money out of the account, negative is money in) and are never negated, re-signed or normalized here. The matcher compares `amount` as `toFixed(2)` text; two rows whose amounts differ only in sign are NOT the same transaction and must not pair (negative control PG-12).
- **Rounding:** None performed. No arithmetic on amounts anywhere in the change.
- **Landscape + exclusions:** Not applicable to the write path (sync stores all posted rows regardless of `hidden`, `exclude_from_budget`, landscape). The change must not read or filter on those columns. A `hidden = TRUE` stored row remains a normal re-identification candidate and keeps `hidden = TRUE` after being renamed.
- **Null semantics:** A row's `name` may be NULL; the matcher already treats NULL and empty as the same. Unchanged. "No row is claimed" must leave the old id untouched, never write NULL or a placeholder id. `SyncResult.synced` stays a count, never null.
- **Counting:** `synced` counts rows newly INSERTED to the ledger. A re-identified row is not counted (existing rule, `reidentified` set). After the change the count for an N-row full re-delivery with N stored rows is 0, whatever the page split.
- **Fixtures:** every id, token, cursor and name is a fabricated sentinel with a file-unique prefix; amounts are small whole numbers; nothing in a tracked file looks like a real money figure (AGENTS.md).

## Toolchain prerequisites
| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | A throwaway Postgres, schema applied incl. `transaction_tombstones`, `$DATABASE_URL` pointed at it (never `.env.local`'s value) | **yes** | orchestrator stands it up as for 40e | `psql "$DATABASE_URL" -tAc "select count(*) from transaction_tombstones"` exits 0 and prints a number | filled in at G0 |
| T2 | The scratch-DB guard works (`lib/testDbGuard.setup.ts` in `setupFiles`) | **yes** | exists | `ls apps/web/lib/testDbGuard.setup.ts apps/web/vitest.integration.config.mts` exit 0 | filled in at G0 |
| T3 | `PLAID_CLIENT_ID`/`PLAID_SECRET` absent from acceptance runs | **yes (must be absent)** | `env -u` | `env -u PLAID_CLIENT_ID -u PLAID_SECRET sh -c 'echo ok'` prints `ok` | filled in at G0 |
| T4 | Live Plaid, the dev DB, the owner's server | **NO** | n/a | n/a | n/a |
| T5 | Unit baseline recorded at G0 (expected 72 files / 1112 tests) | **yes** | orchestrator | `npm test` | filled in at G0 |
| T6 | The new test file lives under `apps/web/app/api/v1/` so the existing `include` glob `app/api/v1/**/*.test.ts` in `vitest.integration.config.mts` collects it. No config edit should be needed; if the implementer edits the config, that is a deviation to justify. Required path: `apps/web/app/api/v1/sync/reid-across-pages.test.ts` | **yes, created by this task** | implementer | acceptance #3 | filled in at G0 |
| T7 | Base commit for RED proof is `8df05e7` (current HEAD of `main` when this spec was written), so `git show 8df05e7:apps/web/lib/sync.ts` yields the defective file | **yes** | n/a | `git cat-file -e 8df05e7:apps/web/lib/sync.ts` exit 0 | filled in at G0 |

Command shorthand used below. `⟨I⟩` = `(cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts --reporter=verbose` followed by the file arguments and `)`, always run with `$DATABASE_URL` on the scratch database and always scoped to named files (hold H4: the full suite has two unrelated stale failures; never run it unscoped for this task).

## Acceptance commands
| # | Command | Expected |
|---|---|---|
| 1 | `(cd apps/web && npx tsc --noEmit)` | exit 0 |
| 2 | `npx eslint apps/web/lib/sync.ts apps/web/app/api/v1/sync/reid-across-pages.test.ts` | exit 0, no warnings |
| 3 | `⟨I⟩ app/api/v1/sync/reid-across-pages.test.ts` | every test named in the "Required tests" table below appears with a `✓`, `0 failed`, and the verbose output contains exactly 13 lines matching `PG-` (PG-01, 02, 03, 04, 04a, 04b, 05, 06, 07, 08, 09, 10, 12 — see table). A file with fewer, or with renamed titles, fails this check. |
| 4 | `⟨I⟩ app/api/v1/sync/reid-across-pages.test.ts 2>&1 \| grep -cE '^\s*(✓\|×).*PG-'` | `13` |
| 5 | `⟨I⟩ app/api/v1/sync/route.test.ts app/api/v1/sync/enrichment.test.ts app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts` | `0 failed`; these three files pass UNMODIFIED: 5 tests in `route.test.ts` (T40a-S7..S11), 18 in `enrichment.test.ts`, 3 in `reissue-root-cause.test.ts` (RC-01..RC-03), total `Tests  26 passed (26)`. |
| 6 | `git diff --stat 8df05e7 -- apps/web/app/api/v1/sync/route.test.ts apps/web/app/api/v1/sync/enrichment.test.ts apps/web/app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts apps/web/lib/domain/txnMatch.ts apps/web/lib/domain/txnMatch.test.ts apps/web/vitest.integration.config.mts` | prints nothing (the pre-existing tests, the matcher and the integration config are byte-identical to base). |
| 7 | `grep -c "export const key = (t: { accountId: string; date: string; amount: number; name: string \| null }) =>" apps/web/lib/domain/txnMatch.ts` and `grep -c "toFixed(2)}|\${(t.name ?? '').trim().toLowerCase()}" apps/web/lib/domain/txnMatch.ts` | `1` and `1` (key definition untouched; belt-and-braces beside #6). |
| 8 | `(cd apps/web && npx vitest run lib/domain/txnMatch.test.ts)` (pure config) | `0 failed` (matcher unit tests unchanged and green). |
| 9 | **RED-on-main proof (mutation probe).** Save the implemented file (`cp apps/web/lib/sync.ts $SCRATCH/sync.fixed.ts`), run `git show 8df05e7:apps/web/lib/sync.ts > apps/web/lib/sync.ts`, run `⟨I⟩ app/api/v1/sync/reid-across-pages.test.ts`, then restore (`cp $SCRATCH/sync.fixed.ts apps/web/lib/sync.ts`) and prove it with `cmp`. | With the base `sync.ts`: **exactly these fail** — PG-01, PG-02, PG-03, PG-04, PG-06, PG-07, PG-08, PG-09. **These pass even on base** (guards, not RED proofs) — PG-04a, PG-04b, PG-05, PG-10, PG-12. After restore: `cmp` exit 0 and acceptance #3 is green again. Any RED test passing on base, or any guard failing on base, is a finding. |
| 10 | `⟨I⟩ app/api/v1/sync/reid-across-pages.test.ts 2>&1 \| grep -c 'Tests .*failed'` after the restore | `0` |
| 11 | `npm test` | exit 0; `72 files / 1112 tests` at baseline (this task adds only integration-config tests, so the pure suite count must not move). |
| 12 | `git diff --stat 8df05e7 -- . ':!apps/web/lib/sync.ts' ':!apps/web/app/api/v1/sync/reid-across-pages.test.ts' ':!plan'` | prints nothing, apart from at most the AGENTS.md block `next dev` re-adds (owner's standing note); any other changed tracked file is out of surface and a finding. |

### Required tests (all in `apps/web/app/api/v1/sync/reid-across-pages.test.ts`)
Drive the real `runSync` against the scratch DB, with only `@/lib/plaid` faked (the same fake shape as `reissue-root-cause.test.ts`: per-token queued pages plus recorded requests). The reconcile, balance recording and matcher are real. Stored rows are seeded with the same account/date/amount/name per group and distinct owner-set values per row (distinct `note`, one `hidden = TRUE`, distinct `mapped_category` with `rule_applied = FALSE`). Accounts are seeded with `cursor = NULL` so the walk begins from no cursor (the H-d path: the full re-delivery case). Each test also records the request cursors and asserts the queued pages were all consumed (`pages` empty), so a test cannot pass because a page was never served. Every test seeds what it asserts on and cleans up by its own prefix. Owner values and pks are read back by primary key, not by id.

Pairing law asserted throughout (current single-page behaviour, now across pages): the k-th delivered usable id (walk order, page order then in-page order) goes to the group's k-th lowest primary key.

| Test | Scenario | Must be observably true |
|---|---|---|
| PG-01 | The 40e repro as a permanent test. Two identical stored rows (pk a < b, ids `old-1`, `old-2`). Page 1 added `[new-1]` (has_more), page 2 added `[new-2]` (last). | After sync: row a carries `new-1`, row b carries `new-2`; no `old-*` id remains in the group; the group has exactly 2 rows; pks a and b unchanged; each row's owner values equal their seeded values; `synced` is `0`. |
| PG-02 | Three identical stored rows, three pages, one new id each. | Rows a<b<c carry `new-1`, `new-2`, `new-3` in that order; exactly 3 rows; owner values stay with their pks; `synced` `0`. |
| PG-03 | Two identical stored rows. Page 1 added `[new-1]`, page 2 added `[]`, page 3 added `[new-2]`. | a carries `new-1`, b carries `new-2`; exactly 2 rows; `synced` `0`. |
| PG-04 | Tombstone interaction. Three identical stored rows a<b<c; tombstone `tomb-x`. Page 1 added `[new-1]`, page 2 added `[tomb-x]`, page 3 added `[new-3]`. | a carries `new-1`, b carries `new-3`, c still carries its old id; **no row anywhere carries `tomb-x`** and no row with that id is inserted; exactly 3 rows; `tomb-x` is still the only tombstone and is unchanged. |
| PG-04a | Two stored rows a<b, tombstone `tomb-x`. Page 1 `[new-1]`, page 2 `[tomb-x]`. | a carries `new-1`, b keeps its old id, no `tomb-x` row, 2 rows. (Passes on base; guards the P6-40a interaction.) |
| PG-04b | Same group, order reversed: page 1 `[tomb-x]`, page 2 `[new-2]`. | The tombstoned id spends no claim: a carries `new-2`, b keeps its old id, no `tomb-x` row, 2 rows. (Passes on base; mirrors T40a-S10 across pages.) |
| PG-05 | One new id ever delivered. Two identical stored rows a<b. Page 1 `[new-1]`, page 2 `[]` (and a later unrelated page-2 added row with a different key). | a carries `new-1`; **b keeps its old id exactly** (no wrong pairing, not renamed to a placeholder, not deleted); 2 rows in the group; the unrelated row is inserted once; `synced` `1`. (Passes on base.) |
| PG-06 | Interleaving with `modified`. Two identical stored rows a<b. Page 1 added `[new-1]`; page 2 added `[new-2]` and modified `[new-1]` with a changed `merchant_name`. | a carries `new-1` with `merchant_name` updated and owner values intact; b carries `new-2`; **exactly 2 rows in the group** (the modified event for an already-renamed id refreshes that row, never inserts a third); `synced` `0`. |
| PG-07 | The same id delivered on two pages. Two identical stored rows a<b. Page 1 added `[new-1]`, page 2 added `[new-1]` again. | a carries `new-1`; **b keeps its old id** (the repeated id must not claim the second row); 2 rows; `synced` `0`. |
| PG-08 | R3, no reissue involved. NO stored history. Two genuine identical new transactions: page 1 added `[c-1]`, page 2 added `[c-2]` (same account, date, amount, name). | **Both stored**: one row `c-1`, one row `c-2`, 2 rows; `synced` `2`. |
| PG-09 | R3 through `modified`. NO stored history for the key. Page 1 modified `[m-1]` (not stored; inserted by the upsert), page 2 added `[c-2]` with the same key as `m-1`. | Two rows, `m-1` and `c-2`; the `m-1` row is not renamed to `c-2`; `synced` `1` (only `c-2` is an `added` insert; `m-1` came from `modified`, which was never counted). |
| PG-10 | Single-page walk unchanged (the regression guard for "unchanged"). Two identical stored rows a<b, one page with added `[new-1, new-2]`. | a carries `new-1`, b carries `new-2`; owner values preserved; `synced` `0`. (Passes on base.) |
| PG-12 | Negative control for the key. Stored row with amount `5`; page 1 delivers a same-account/date/name row with the opposite sign amount (`-5`); page 2 delivers a same-key id for the stored row. | The opposite-sign row is NOT paired with the stored row (it is inserted as new, `synced` counts it); the stored row is claimed only by the same-key id on page 2. Both outcomes asserted. (Passes on base.) |

## Negative controls
| # | Rule | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | A renamed row is not a candidate again later in the walk (R1) | Page 2's id for a group whose lowest-pk row was renamed on page 1 | PG-01, PG-02, PG-03 (acceptance #3; RED on base per #9) |
| 2 | An id already processed earlier in the walk claims nothing (R2) | The same id `new-1` delivered again on page 2 while a second identical stored row exists | PG-07 (b keeps its old id) |
| 3 | A row written earlier in the walk (inserted by `added` or `modified`) is not claimed by a later page (R3) | `c-2` on page 2 vs. the row `c-1` or `m-1` inserted on page 1 | PG-08, PG-09 |
| 4 | A tombstoned incoming id takes no part in re-identification, in either role, and no row ever carries it | `tomb-x` on a middle page of a 3-row group | PG-04, PG-04a, PG-04b |
| 5 | A group where fewer new ids arrive than stored rows must not pair the leftover | The un-delivered row (b) | PG-05 (old id preserved, row count unchanged) |
| 6 | `modified` never re-identifies and never duplicates a renamed row | `modified [new-1]` after page 1 renamed a to `new-1` | PG-06 (exactly 2 rows) |
| 7 | "Same transaction" is the existing key and nothing else | An opposite-sign amount row | PG-12 |
| 8 | The matcher's key is not edited | A diff of `txnMatch.ts` / its unit test against base | acceptance #6 and #7 |
| 9 | The pre-existing sync, enrichment and RC suites are not edited to pass | A diff of those three test files against base | acceptance #6 (empty), #5 (26 passed) |
| 10 | Owner fields are not lost or swapped between rows | Distinct `note`/`hidden`/`mapped_category` per pk, compared after the walk | PG-01, PG-02, PG-03, PG-10 |

## Evidence required
- The raw verbose output of acceptance #9: the RED run on base `sync.ts` listing exactly the 8 failing PG ids (with each failing assertion's one-line message), then the GREEN run after restore, plus the `cmp` exit 0.
- Output of acceptance #3, #5, #6, #7, #8, #11, #12.
- The post-walk row dump (pk, id, owner values; fabricated sentinels only, no money-looking figures) for PG-01 and PG-04, printed from the test run, to show the pairing law.
- A one-paragraph statement in `EVIDENCE.md` of what the walk now remembers between pages and how that interacts with the tombstone pre-filter, without quoting figures.
- The count of `re-identified transactions after item change` log lines in the PG-01 run: it must report the true total of rows renamed in the walk (2), and must not report a rename that did not happen.
- If any of the 13 tests is not RED/GREEN as predicted by acceptance #9, a note explaining why (the prediction is the spec's; a mismatch is a spec bug or an implementation bug, to be surfaced, not hidden).

## Failure modes to test
- Fix keyed on "ids renamed this page" (a per-page set): passes PG-07's page-1-then-page-2 only if the set lives across the whole walk. PG-01 alone would not catch a per-page fix that is reset at the wrong place; PG-03 (empty middle page) and PG-02 (three pages) do.
- Memory kept per sync RUN across items instead of per item walk: a second item's rows would be wrongly excluded. Not directly testable from one item; the implementer must keep the walk's scope the item's walk, and the reviewer must check it. (Add a second item to the PG-02 fixture if cheap.)
- Excluding rows by the NEW id set only: renamed row`s new id is "known", but a row inserted through the plain upsert path (R3, PG-08/PG-09) is missed.
- Excluding too much: a stored row from a prior run whose old id is not in the incoming set must STILL be a candidate on the first page (PG-01 page 1, PG-10). An implementation that blocks all stored rows on pages after the first would pass PG-01 only if the renames happen on page 1; PG-03 (the second new id on page 3, B never touched before) catches over-blocking.
- Claim order drift: renaming the highest pk first, or not in delivery order, which swaps owner notes between rows. PG-01/PG-02 assert note-per-pk.
- Tombstoned id spending a claim (a refused UPDATE still using up the row): PG-04's c-row must keep its old id only if nothing absorbed it; and a tombstoned id on page 1 in PG-04b must leave a claimable.
- `null` vs `0`: `synced` is `0`, not undefined, after pure re-identification walks.
- Double-count: a renamed row counted into `added`/`synced` on a later page (the second page's `reidentified` set not carrying across pages), or a row counted twice by `modified` after rename (PG-06).
- Row duplication: after rename, the upsert on the same page finds a conflict. If the rename were skipped for a later page, the upsert INSERTS a new row (duplicate). Every test asserts the exact row count.
- A rename that the UPDATE performs but the page-local `reidentified` set does not record (or the reverse) would still pass PG-01 by luck: assert `synced` in every test.
- Time-of-check: the existing-rows read is per page (date-range filtered); a row renamed on page 1 whose date lies outside page 2's range must not become an inserted duplicate. Cover with a date spread across pages in PG-03 (different page date ranges around the same group date).
- Empty collections: `added: []` mid-walk (PG-03), a page of only unusable ids (PG-04a/b), and `pageCandidates.length === 0` must not reset, throw, or skip the cursor write.
- Fix leaking into non-reissue sync: a plain incremental sync with stored rows and brand-new unrelated ids must insert, exactly as before (PG-05 unrelated row, S7–S11, enrichment).

## Rollback
Pure code change to `apps/web/lib/sync.ts` plus one new test file. Revert with `git revert <merge-sha>`; no migration, no data change, no backfill to restore. Because the change writes no new state, a rollback leaves no residue. Rows renamed correctly by a deployed fix stay correct under the old code; the old code only re-misbehaves on the next multi-page full re-delivery.

---

## G0 record (orchestrator, 2026-10-07) — owner-approved amendment; overrides the text above where they differ
**R3 kept** (spec-writer's point 1): a row written earlier in the walk is not claimed by a later page.

**R4 — owner decision: re-identification happens only in a full re-delivery walk.** The cross-walk case
the spec named as a non-goal is in scope. Reading `txnMatch.ts`: any stored row with the same key whose
id is not in the current page is a candidate, so in an ordinary incremental sync a genuine second
identical same-day purchase that posts in a later sync **renames the first purchase's row instead of
being stored** — one real transaction silently lost. Rule: `matchReissuedTransactions` is applied only
in a walk that began from no cursor (after a token change, or the P6-40e H-d case). A walk that began
from a stored cursor never re-identifies: every new posted id is inserted (still subject to the
tombstone guard and the pending skip). The matcher's key and code stay unchanged.

**Added required tests (same file; counts in acceptance #3/#4/#9 rise accordingly — 15 `PG-` lines):**
- **PG-13 (RED on base):** accounts with a stored cursor; one stored row R (old id still valid, not in
  the delivery); an incremental page delivers a different id with R's exact key. After sync: R keeps
  its id and owner values, the new id is a second row, 2 rows in the group, `synced` 1.
- **PG-14 (guard, passes on base):** the same fixture but accounts with `cursor = NULL` (full
  re-delivery) still re-identifies R in place, as RC-01 asserts for the designed path.

**Acceptance #5/#6 amendment:** if an existing test asserts re-identification on a walk that starts from
a stored cursor, it encodes the defect R4 removes. The implementer may change that test's fixture to
start from no cursor (never weaken its assertions) and must list each such edit with the reason in
EVIDENCE.md; #6's diff for that file is then expected and reviewed at G3.

**Real-data check (orchestrator, read-only):** server logs since 2026-09-17 (daily.log, daily-manual.log,
web.log) contain **0** `re-identified transactions` lines, so no merge has happened on the home server;
the laptop era before that cannot be checked from logs.

---

## G3 amendment R5 (owner decision, 2026-10-07) — REPLACES R4; overrides everything above where they differ
R4 was the orchestrator's recommendation and REVIEW-1 showed it unsafe (B1 duplicates history after a
re-auth; B2 loses owner fields on an incremental reissue). The owner chose the proper fix:

1. **Re-auth phase.** A walk that begins with no cursor — NULL **or the empty string** (`!cursor`;
   the same test in `runSyncInner`'s H-d grouping) — re-identifies, as before. **The stored cursor is
   not advanced out of the re-auth phase until the walk's final page reports
   `transactions_update_status === 'HISTORICAL_UPDATE_COMPLETE'`**: while the final page reports
   `NOT_READY` or `INITIAL_UPDATE_COMPLETE`, the walk's rows are written as normal but the accounts'
   cursor is left NULL, so the next sync re-walks from no cursor and re-identifies the historical pull
   when it arrives. `HISTORICAL_UPDATE_COMPLETE`, `TRANSACTIONS_UPDATE_STATUS_UNKNOWN` or an absent field
   persist the cursor as today (absent/unknown keeps today's behaviour and existing fakes unchanged; log
   one line, no ids, when UNKNOWN is seen). This is the one sanctioned change to the cursor write; the
   H-f non-goal otherwise stands.
2. **Ordinary (stored-cursor) walks.** A new posted id is inserted — never claims a stored row — **unless
   the claimed stored row's own id appears in this walk's `removed` list** (Plaid explicitly retired it).
   Such "removed-licensed" re-identification uses the same key, pk order and delivery order, works across
   pages in either order (added before removed, or after), excludes tombstoned and seen-in-walk ids as in
   R1–R3, and preserves all seven owner fields (hidden, note, mapped_category with rule_applied=false,
   watched_at, transfer_group_id, property_id, plus the row's pk). A `removed` id that licensed a rename
   must not then delete the renamed row. PG-13's genuine second purchase (no `removed`) is still inserted.
3. **Matcher key unchanged; no schema change; no persisted flag.**

**Test helper:** the fake walk must accept `removed` and `transactions_update_status` per page. Owner-field
assertions cover all seven fields wherever owner values are asserted.

**Added required tests (same file; the PG- count in #3/#4 becomes 21):**
- **PG-15** stored cursor; one page added [new-1, R's key], removed [old-1] → exactly 1 row, pk = R's,
  id new-1, all seven owner fields as seeded, no row with old-1, `synced` 0, one re-identification log
  line with count 1. **RED on the cycle-0 diff.**
- **PG-15b** as PG-15 with added on page 1 and removed on page 2 → same assertions.
- **PG-15c** R1<R2 same key; added [new-1, new-9], removed [old-1] → R1 is new-1, R2 keeps old-2 and its
  owner values, new-9 inserted, 3 rows, `synced` 1.
- **PG-15d** removed names a stored row of a different key → does not license R's claim; R keeps old-1,
  the new id is inserted, the other row is deleted.
- **PG-16** re-auth in two runs: accounts cursor NULL, stored row old-1 with all owner fields. Run 1's final
  page has `INITIAL_UPDATE_COMPLETE`, added [] → accounts' cursor stays NULL after run 1. Run 2 (from no
  cursor) delivers new-1 with old-1's key and `HISTORICAL_UPDATE_COMPLETE` → 1 row, renamed in place,
  owner fields intact, cursor persisted. **RED on the cycle-0 diff.**
- **PG-16b** as PG-16 but run 1 returns `NOT_READY` with `next_cursor ''` → the cursor is not persisted
  as '' (or, if persisted, '' is treated as no cursor): run 2 re-identifies, 1 row.
- **PG-17** after `HISTORICAL_UPDATE_COMPLETE` the next walk is incremental, and a genuine same-key second
  purchase is inserted (PG-13 behaviour holds after a completed re-auth).
PG-13 and PG-14 keep their assertions. PG-14's fixture must declare `HISTORICAL_UPDATE_COMPLETE` (or omit
the field) so it remains the designed path.

**Probe evidence required at G2 (converts REVIEW-1's causal claims, A2):** run PG-15 and PG-16 against the
**cycle-0** sync.ts (save, swap, run, restore with cmp) and show them RED; run the full new file against
**base 8df05e7** and record which pass/fail.

