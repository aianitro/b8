# P7-41b-gifts — evidence bundle (implementer)

Written by the implementer on 2026-10-19, in the main tree, nothing committed. Every acceptance
command below was run by the implementer under `bash`, from the repo root, against
`postgresql://localhost/b8_p41b_throwaway` where a database is needed. Outputs are verbatim except
where a line says it is an excerpt; no output here was summarised into a pass that the command did
not print. Every fixture value is fabricated (canary tokens such as `ZQ41BXGIFT`, people named
`Owner`, `Test User Two`, `Test User Three`). No money figure is quoted in this file.

The contract surface is unchanged since G1 — digests measured after the last run:

    da35145bf837bd29cd4a213fd2587668d3ffb0eb14507d2ade1f559d07e6e35a  migrations/1792400000000_gifts.sql
    d14755b7c2b7c3be579a1990b3559ea9ad9a19a3d3a8a4e5834605be209fb5e7  db/schema.sql
    fbf5a21ae250bad192f0bfd74e13a8edb824952638d11a104127356a45bace9d  packages/contracts/gifts.ts
    7e9ed6c1d59da614e05b950d9bde8fa755fd2fd801fb5c060da3b12cc316da6b  packages/contracts/index.ts

## Declaration: the read path (W11) and how masking is enforced

**Registered read path: `apps/web/lib/giftReadPath.ts`, and nothing else.** It exports
`visibleTransactions(viewer: GiftViewer)` — a parenthesised subquery with every column of
`transactions` under the same names, masked by Postgres for that viewer, plus `gift_masked` — and
three predicate helpers (`giftMaskedSql`, `giftHeldSql`, `giftLinkedSql`) registered in
`READ_PATH_PREDICATES`. `GiftViewer` is `number | null`; `viewer` is required. The masking predicate
is the migration's text verbatim (`g.reveal_date > CURRENT_DATE AND g.giver_user_id IS DISTINCT
FROM <viewer>`), so NULL fails closed.

The column treatment is one table, `TRANSACTION_COLUMN_MASK` in `lib/domain/giftMask.ts`, read by
both the SQL row source and the pure `maskedProjection` used as the detail route's second line.

**One interpretation to flag for the reviewer.** SPEC.md's allowlist says a masked row's `name` is
null and its label is `Gift`. Every existing surface derives its label as `merchant ?? name ??
<fallback>` (`Unnamed`, `Transaction`, `—`). The read path therefore carries the label in the `name`
column (`name = 'Gift'`, `merchant_name = NULL`), so every existing label chain yields exactly `Gift`
without each renderer having to know gifts exist. No real name reaches any surface; P5 pins the
label and P2 pins the pure projection's exact key set (which has no `name` key at all). Also kept
unmasked on purpose: `property_id`, so a property's ledger and P/L sum identically for every viewer
(SPEC.md lists "the effective property derived from the account" in the allowlist; an explicit tag
is kept because masking it would move a total between viewers, which the spec forbids outright).

Viewer resolution: `lib/giftViewer.ts` — `viewerOf(request)` for route handlers and
`pageViewer(pathname)` for server components, both through `credentialFrom` in `lib/requestAuth.ts`,
the function the boundary uses; any failure is `null`.

## Acceptance commands

### #1 `(cd apps/web && npx tsc --noEmit; echo "exit=$?")`

    exit=0

### #2 `npm run lint; echo "exit=$?"` (tail; baseline 0 errors, 5 warnings — unchanged)

    ✖ 5 problems (0 errors, 5 warnings)
      0 errors and 1 warning potentially fixable with the `--fix` option.

    exit=0

The five warnings are the pre-existing ones (`app/login/page.tsx`, `lib/domain/digest.ts` ×2,
`public/sw.js`, `scripts/seed-demo.mjs`); none is in a file this task touched.

### #3 `npm test 2>&1 | tail -8` (BASE 85 files, 1204 tests)

     Test Files  88 passed (88)
          Tests  1238 passed (1238)
       Start at  08:58:13
       Duration  6.57s (tests 61%, import 21%, transform 16%, worker 2%)

        Isolate  88 workers spawned · ~143ms startup each (spawn + environment, per file)
                 at least ~1.65s faster with isolate: false — reuses workers across files instead of one per file

0 failed; +34 tests (exactly the 34 M/L/P/W scenarios), +3 files. No existing unit test was edited.

### #4 unit scenarios, three zones (the OK lines; the command also prints vitest's "JSON report written to …" lines)

    OK 34 scenarios M L P W each present once and passed TZ=UTC
    OK 34 scenarios M L P W each present once and passed TZ=Pacific/Auckland
    OK 34 scenarios M L P W each present once and passed TZ=America/Los_Angeles

### #5 integration scenarios

    OK 235 tests, G1-G11 S1-S14 X1-X15 each present once and passed

### #6 integration stability (the failing-set lines and the verdict; the run also prints an existing suite's `[reid-dump …]` diagnostic lines, which are fabricated P6-40f fixtures)

    ["the pre-auth ceremony endpoints remain reachable with no session cookie at all","the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio"]
    ["the pre-auth ceremony endpoints remain reachable with no session cookie at all","the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio"]
    OK failing set stable and within KNOWN

### #7 `node apps/web/scripts/gifts-surface-check.mjs; echo "exit=$?"` (full output)

    H1 PASS 19 page.tsx files on disk, all 19 classified (7 text-bearing)
    H2 PASS 19 pages as the recipient: all 200, 0 hold the canary in any case; /transactions lists the ordinary row and the label Gift
    H3 PASS the giver sees the canary on /transactions, /accounts/zq41b_check_card, /categories/Fabricated%20Gift%20Shelf, /dashboard, /properties/1
    H4 PASS with the reveal date yesterday the recipient sees the canary on all 5 pages; moved back, masked again
    H5 PASS recipient searches (full, prefix, payee) render the nonsense block {"count":"0","rows":0}; the amount finds the Gift row; the giver's search finds 1
    H6 PASS merchant rule on the gift's payee counts 0 rows for the recipient and 1 for the giver; its Plaid category row is absent for the recipient and present for the giver
    H7 PASS 24 alternating giver/recipient requests over 6 pages and routes: each viewer always got their own answer; API bodies byte-identical per viewer
    H8 PASS dev-server output (7251 bytes): 0 lines hold the canary in any case, besides 3 access-log lines echoing this script's own search URLs
    H9 PASS RSC: 1 /transactions as the recipient: 12528 bytes, ordinary row present, canary absent
    H10 PASS giver's /gifts lists the gift and its criterion; recipient's lists none and holds no criterion; the Gifts nav entry is present for both
    OK H1-H10
    exit=0

**H8 carries one stated exemption.** H5 searches FOR the canary, and `next dev` prints an access-log
line `GET <path> <status> in <n>ms` per request, so three lines repeat the script's own query string.
The script excuses a line only when it has exactly that shape AND its path is one the script itself
requested; any other line mentioning the canary fails H8. Before this exemption was added H8 failed
on exactly those three lines and nothing else.

### #8 added-lines guard

    (no output)
    grep exit=1

### #9 untouched files

    (no output)
    exit=0

### #10 migration round trip and history (excerpt: the counted lines; the full log is node-pg-migrate's SQL echo)

    grep -c "Migrations complete!" → 3
    tail:
    Migrations complete!
           1
    exit=0

(no output from the MDR history check). Note: this round trip leaves `gift_settings.category_id`
NULL on the throwaway database, as on any database without the seeded category name; the gift
suites designate their own category and put the designation back as they found it.

### #11 `npm run build; echo "exit=$?"` (excerpt)

    ├ ƒ /api/v1/gifts
    ├ ƒ /api/v1/gifts/[id]
    ├ ƒ /api/v1/gifts/[id]/cancel
    ├ ƒ /api/v1/gifts/[id]/choose
    ├ ƒ /gifts
    exit=0

The only statically prerendered pages are `/`, `/_not-found`, `/insights`, `/login`, `/offline` (plus
the icon and manifest), none of which reads a ledger row.

## W1 detector: every file it classified

The detector (`lib/giftSurfaceWiring.test.ts`, `findingsIn`) reads SQL from string, template and `+`
literals with same-file constants resolved; a text that reads `transactions` itself (FROM / JOIN /
UPDATE / DELETE FROM) and names a protected column through a raw alias, `alias.*`, `SELECT *`,
`to_jsonb`/`row_to_json`, `alias::text`, `plaid_raw`, or a bare protected column is a finding; a
WHERE fragment naming a raw alias's protected column in a file that never binds that alias to the
row source is a finding. Run on the tree: 0 offenders.

| Class | File | Reason |
|---|---|---|
| read path | `lib/giftReadPath.ts` | the row source and predicates; the only direct reader for a viewer |
| exempt | `lib/sync.ts` | ingest and internal comparison (re-identification, the gift matcher's read of rows it just inserted); outputs links and counts only |
| reader (through the read path) | `app/transactions/page.tsx`, `app/accounts/[id]/page.tsx`, `app/categories/[name]/page.tsx`, `app/properties/[id]/page.tsx`, `app/rules/page.tsx`, `app/api/v1/transactions/route.ts`, `app/api/v1/transactions/[id]/route.ts`, `app/api/v1/transactions/[id]/counterparts/route.ts`, `app/api/v1/chat/route.ts`, `lib/overviewRead.ts`, `lib/watchlistRead.ts`, `lib/digestRead.ts`, `lib/monthOutlookRead.ts`, `lib/recurringDetection.ts`, `lib/overdraftWatch.ts`, `lib/categorySuggester.ts`, `lib/proposalStore.ts`, `lib/giftStore.ts` | `visibleTransactions(viewer)` — the session's person; `null` (masks every unrevealed gift) for the digest, suggester, recurring list, forecast and outlook recurrence, which also drop `gift_masked` rows outright |
| guarded writer (W12) | `app/api/v1/transactions/[id]/route.ts`, `app/api/v1/transactions/bulk/route.ts`, `app/api/v1/transfers/route.ts`, `lib/cashTransferStore.ts`, `app/api/v1/rules/route.ts`, `app/api/v1/rules/apply/route.ts`, `lib/proposalStore.ts` (X12) | each asks `lib/giftLock.ts` (or `giftLinkedSql` for rules) before the write and repeats the condition in the write's own WHERE |
| guarded writer, gift's own | `lib/giftStore.ts` (G7/G8/S13) | files a held row, restores it exactly on choose / cancel / expiry; touches only rows linked to the giver's own gift. **Added to the spec's expected writer list**, which did not name it |
| sums only (no finding) | every other file reading `transactions`: `lib/yearEndRead.ts`, `lib/netWorth.ts`, `lib/drift.ts`, `lib/unspentStore.ts`, `lib/cashCountStore.ts`, `app/budget/page.tsx`, `app/accounts/page.tsx`, `components/BudgetMonthlyGrid.tsx`, `components/AccountBalancesSection.tsx`, the statement and account routes | select no protected column, so they cannot carry text; this is why totals are viewer-independent |

`watched_at` is masked by the row source but is not a detector column: figures read it legitimately
(the drill-down's `pending`, the outlook's grading). A surface that shows the flag also shows the
row's label and is caught on that.

## Surface inventory with scenario status (all scenarios green in #4, #5, #7)

| Id | Surface | Done how | Scenarios |
|---|---|---|---|
| S01 | `/transactions` page and props | list and counts through `visibleTransactions(pageViewer)` | H2 H3 H9 ✓ |
| S02 | `?search=`, `?merchant=` | filters run against the row source; held row matches only as `Gift` and by amount | H5 ✓ |
| S03 | `/accounts/[id]` | statement read through the row source | H2 H3 ✓ |
| S04 | `/categories/[name]` | ledger through the row source; running totals unchanged | H2 H3 ✓ |
| S05 | `/properties/[id]` ledger | description through the row source (`Gift`, not `—`) | H2 H3 ✓ |
| S06 | `/dashboard` / overview read | arrivals, today's three, unfiled sample, watchlist through the row source | H2 X4 ✓ |
| S07 | `GET /api/v1/overview` | `loadOverview(viewerOf(req))` | X1 X4 ✓ |
| S08 | `GET /api/v1/transactions` | rows through the row source, figures from `transactions` | X1 X3 ✓ |
| S09 | `GET /api/v1/transactions/[id]` | row source + `maskedTransactionDetail` second line | X1 X2 ✓ |
| S10 | counterparts | candidates through the row source; no offer for, and no offer of, a held row | X1 X12 ✓ |
| S11 | `/rules` counts | the three counts over the row source | H6 X11 ✓ |
| S12 | rule writes | `NOT giftLinkedSql` in POST /rules and /rules/apply; counts exclude held rows | S7 X11 ✓ |
| S13 | one-tap merchant-rule offer | masked `merchant` is null → no offer | X2 ✓ |
| S14 | category suggestions | suggester reads `visibleTransactions(null)` and drops held rows from history and the unfiled set | X10 ✓ |
| S15 | proposal cards / decide | `loadSubject(id, viewer)`; decide refuses a held row (GIFT_LOCKED) | X6 X12 ✓ |
| S16 | chat agent | tool reads through `visibleTransactions(session.userId)`; categorise refuses held rows | X6 ✓ |
| S17 | digest text/HTML/subject | reads as `null` viewer (Q3: masked for everyone) | X7 ✓ |
| S18 | digest images | inputs are category names and figures; type-checked recursively | X8 W7 ✓ |
| S19 | web push | unchanged content-free ping; window-end ping to the giver via `sendWebPush(…, giver)` | X9 W6 S12 ✓ |
| S20 | forecast / recurring | held rows excluded for everyone | X15 ✓ |
| S21 | logs | gift modules log counts only | X13 W8 H8 ✓ |
| S22 | writes on a held row | `lib/giftLock.ts`, one refusal body | X12 W12 ✓ |
| S23 | sync response / sync_log | counts only (unchanged) | X1 X13 ✓ |
| S24 | cache / memory | no module-level state in any viewer read | X14 H7 ✓ |
| S25 | `/gifts` and the five routes | giver-scoped reads; others' gifts answer the nonexistent-id body | G2 H10 ✓ |
| S26 | export | none added | W5 ✓ |
| S27 | operator tools | unchanged | #9 ✓ |
| S28 | numeric-only surfaces | unchanged sums | X5 H2 ✓ |

## Mutation log

Driver: `p41b_mut.py` in the session scratchpad (not committed). For each mutation it applies exact
string edits, runs the named checks (unit files, the three gift integration files, the HTTP script,
or acceptance #8), restores the files, and compares a tree checksum (`sha256` over `git diff` plus
every untracked file) before and after. Every row reads `restored: true`. The checksum differs
between batches because two tests were strengthened between them (below); within each batch it is
constant, and the tree after the last batch, before this file was written, was `8540c2ecf0cdec91`.

| # | Mutation | Spec expects | Failed (only these) |
|---|---|---|---|
| 1 | insert, commit, match in a later statement | S2 | S2 |
| 2 | skip masking in the transactions routes (drill-down and detail) | X1 X2 X3 | X1 X2 X3, plus G7 G8 G9 G11 S1–S11 S13 S14 X14 — every scenario that observes masking through the detail route |
| 3 | digest reads rows unmasked | X7 | X7 |
| 4 | note dropped from the masked projection | P1 P2 X2 | P1 P2 X2 (X2 after strengthening, below) |
| 5 | reveal `<` instead of `<=` (SQL and pure) | L2 G11 | L2 G11, plus L3 S13 X7 (each crosses the reveal day) |
| 6 | today from `new Date().toISOString().slice(0, 10)` | W9, L2 (zones), #8 | W9, L2 and L3 in all three zones, #8 printed a line |
| 7 | search ILIKE against held rows | H5 | H5 |
| 8 | suggester history read from raw `transactions` | X10 | X10 |
| 9 | rules/apply re-files linked rows | S7 X11 | S7 X11 |
| 10 | null viewer treated as the giver | P3 | P3 P6 |
| 11 | link keyed on `plaid_transaction_id` | S9 S10 | **not applied**: the link column is `gift_transactions.transaction_id → transactions(id)` in the frozen migration, so a Plaid-id link cannot be written without changing the contract. S9 and S10 assert the `id`, link, category and mask survive re-identification and re-key |
| 12 | candidate test `amount <> 0` | M2 S5 | M2 S5 (S5 after strengthening, below) |
| 13 | push request given a body | X9 W6 | X9 W6, plus S12 (the sweep's ping is the same request) |
| 14 | `GET /gifts/[id]` answers 403 for someone else's gift | G2 | G2, plus X1 (sweeps the same route) |
| 15 | first of several candidates auto-picked | M9 S3 | M9 S3, plus G7 S11 S13 and X1–X15 (the X world asserts a gift in `choose`) |
| 16 | category found by the literal name | W13 S14 | W13 S14 |
| 17 | overview memoised across viewers | X14 H7 | X14 H7, plus X1 |
| 18 | gift criterion logged | X13 W8 | X13 W8, plus S14 (asserts the sync's log line carries a count and no row text) |
| 19 | held rows included in recurring detection | X15 | X15 |
| 20 | replacement row committed unmasked during a reissue walk | S2 | S2 |

Two tests were strengthened because a mutation survived them on the first pass, and the mutation
was re-run afterwards:
- **X2** had no note on the held row, so leaking the note leaked nothing. It now sets the giver's own
  note and watch flag on the row first (both allowed to the giver, Q5); mutation 4 then fails X2.
- **S5** gave every non-matching shape a gift with an amount criterion, which rejects a refund by
  amount before the money-out rule is reached. It now adds a refund against a merchant-only gift;
  mutation 12 then fails S5.

## What is and is not proven here

- The HTTP check (#7) runs against `next dev`, not a production server; #11 proves only that no
  viewer-dependent page is statically prerendered.
- Postgres statement logging, reverse-proxy logs, the operator tools (`backup.ts`,
  `rekey-plaid-ids.ts`, `backfill-enrichment.ts`) and direct `psql` are outside the viewer model and
  see everything, by design.
- Push services and the mail provider are stubbed (`fetch` and `nodemailer`); the Anthropic SDK is
  stubbed and its requests are read instead.
- A gift on a shared card can match the other person's own purchase; criteria, the choose step and
  the giver's cancel reduce this and do not eliminate it.
- The W1 detector reads SQL literals; SQL assembled from non-constant runtime strings is opaque to
  it. Its fragment rule catches a WHERE fragment only in a file that never binds that alias to the
  row source; the transactions page binds `t` to both, so a raw fragment there would rely on the
  HTTP check (H5) and on mutation 7 having shown H5 catches it.
- What differs by viewer, by design: the rules page counts, the watched chip on `/transactions`, and
  the watchlist (a giver's own watch flag on their gift is not on the recipient's list). All sums,
  budgets, year-end, P/L, net worth and the drill-down's `spent`/`pending`/`count` are identical (X3,
  X4, X5).
- Test-only fakes beyond the spec's list: `lib/rateLimit` is replaced in `giftSync.test.ts` and
  `giftSurfaces.test.ts`, because S2 and X13 call the chat once per sync statement and the global
  limiter would refuse the harness; `@/lib/giftViewer`'s `pageViewer` is replaced in
  `giftSurfaces.test.ts` so X11 can render the rules page outside a request.
- The overview route's `GET` now takes an optional request; without one (a bare fixture call) the
  viewer is `null`, which masks. This kept the existing overview fixture unedited.
- Palette: `/gifts` and its two components use the `slate-*` family of the surrounding pages, not
  the skill's `gray-*` tokens, following "the file you are in" (every page around it is slate).
- Schema observation, not a contract defect: `overview/route.test.ts` truncates `budget_categories`
  CASCADE, which empties `gift_settings` on the scratch database. The gift kit recreates the
  singleton row when missing and restores what it found.

## G3 cycle 1 — N2: a revealed matched gift reopened after its row is deleted

**Finding.** In `lib/giftStore.ts` `linkFreshRows`, the statement that returns a `matched`/`choose`
gift holding no link to `awaiting` had no reveal-date conjunct. Once a matched gift is revealed, its
row may be deleted by the owner or removed by Plaid; the cascade drops the link, the next sync
reopened the gift, and the sweep then expired it as `unmatched` with a false "nothing matched" push
to the giver. A late row in the window could also have been re-filed into the gift category.

**Fix.** The reset now also requires `g.reveal_date > CURRENT_DATE` (Postgres's calendar, in the same
statement). A revealed matched gift stays `matched` with no link and no notice. Contracts unchanged;
digests after the fix: `da35145b…`, `d14755b7…`, `fbf5a21a…`, `7e9ed6c1…` (as at G1).

**Regression test, written first.** A new `it` in `apps/web/app/api/v1/gifts/giftSync.test.ts`
(deliberately not a T41b id, because the acceptance checker counts ids): a matched gift with
`reveal_date = CURRENT_DATE - 1` and `window_end = CURRENT_DATE - 30`, linked to row X; X deleted;
a sync delivering one fresh row; `runGiftSweep()`; the gift must be `{ state: 'matched', notice_at: null }`.

Before the fix (`npx vitest run --config vitest.integration.config.mts app/api/v1/gifts/giftSync.test.ts -t "revealed matched gift"`):

         × a revealed matched gift whose row is later deleted stays matched through the next sync and sweep, with no notice 101ms
    ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
    AssertionError: expected { state: 'unmatched', …(1) } to deeply equal { state: 'matched', notice_at: null }
          Tests  1 failed | 14 skipped (15)

After the fix, the regression together with the unrevealed case (S9: Plaid removes an unrevealed
matched gift's row, and the gift returns to `awaiting`) and S2 (`-t "revealed matched gift|T41b-S9|T41b-S2"`):

          Tests  3 passed | 12 skipped (15)

**Reruns under bash after the fix:**

- #1 `exit=0`
- #3

       Test Files  88 passed (88)
            Tests  1238 passed (1238)

- #4

      OK 34 scenarios M L P W each present once and passed TZ=UTC
      OK 34 scenarios M L P W each present once and passed TZ=Pacific/Auckland
      OK 34 scenarios M L P W each present once and passed TZ=America/Los_Angeles

- #5 `OK 236 tests, G1-G11 S1-S14 X1-X15 each present once and passed`. There is one more test than
  before: the regression.
- #6

      ["the pre-auth ceremony endpoints remain reachable with no session cookie at all","the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio"]
      ["the pre-auth ceremony endpoints remain reachable with no session cookie at all","the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio"]
      OK failing set stable and within KNOWN
