# EVIDENCE — P8-42b-card-annual-instruments

**Implementer, 2026-11-20.** Work is on `main`, uncommitted (GATES.md T17). Every acceptance command was run from
the repo root under `/bin/bash` (3.2.57) exactly as written in SPEC.md, extracted from the frozen SPEC by its fenced
blocks. `PRIOR_REDUCER=6` was exported for the runs that need it.

## Verdict: NOT ALL GREEN — one conflict with a frozen P8-42a regression test, raised and not absorbed

Commands 3 and 9 fail, both on the single existing unit test `T42a-U8` in `apps/web/lib/loyalty.test.ts`. Every
other command (1, 2, 4 to 8, 10 to 18) passes. The failure is not a defect of the implementation; it is a
contradiction between this spec and a P8-42a test the spec forbids editing.

`T42a-U8` (lib/loyalty.test.ts, lines 387, 390, 392 and 394 on the unmodified tree) asserts:

- line 387: every one of the eleven loyalty routes is `['no-transaction-data']` in the registry;
- line 390: `app/travel/page.tsx` is `['no-transaction-data']` in the registry;
- line 392: the surface script contains `'app/travel/page.tsx': { cls: 'no-transaction-data', url: () => '/travel' }`;
- line 394: the surface script contains `console.log('OK H1-H11');`.

SPEC.md requires the opposite of each: command 14 asserts the four membership-view routes and `/travel` are
`numeric-only` in the registry and in the script, and command 13 asserts the script's last line is `OK H1-H12`.
No tree can satisfy both. SPEC.md Non-goals say "Existing tests are only added to" (the two bounded exceptions
cover fixture keys and the one `T42a-C10` class line, not `T42a-U8`) and "Any conflict with a frozen P8-42a or
P8-42a2 regression command is raised, not absorbed." So `T42a-U8` is left exactly as it was, and it fails.

Not done, deliberately: keeping a dead `console.log('OK H1-H11');` or a commented-out stale PAGES line in the
script to satisfy lines 392 and 394 would be gaming the test, and lines 387 and 390 cannot be satisfied at all.

Proposed amendment for the orchestrator: allow `T42a-U8` lines 387, 390, 392 and 394 to change to the new classes
and to `OK H1-H12` (four lines, same shape as the allowance already granted to `T42a-C10`), and widen command 17's
forgiven-line set to that test, or run command 17's diff over `lib/loyalty.test.ts` with the same rule. With that
amendment, the measured result is that `T42a-U8` is the only failing test in commands 3 and 9 (below), so commands
3 and 9 would then be expected to pass. That expectation is NOT verified, because the edit was not made.

## Acceptance commands — verbatim

**#1** `(cd apps/web && npx tsc --noEmit --incremental false; echo "exit=$?")`
```
exit=0
```

**#2** `npm run lint; echo "exit=$?"` (tail)
```
✖ 5 problems (0 errors, 5 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

exit=0
```
Warnings 5, not above LINT_BASE 5. All five are in files this task did not touch.

**#3** `npm test 2>&1 | tail -8` — FAIL (the conflict above). The command's own tail shows only npm's error lines:
```
npm error Lifecycle script `test` failed with error:
npm error code 1
npm error path /Users/andreianpilogov/Documents/b8/app/apps/web
npm error workspace @b8/web@0.1.0
npm error location /Users/andreianpilogov/Documents/b8/app/apps/web
npm error command failed
npm error command sh -c vitest run
```
The summary of the same run, from the full output:
```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed | 103 passed (104)
      Tests  1 failed | 1409 passed (1410)
 FAIL  lib/loyalty.test.ts > wiring > T42a-U8: sidebar order and label, the registry and the surface script list every loyalty surface, every route resolves its caller first, S6 checks for a browser session
```
The totals are the expected 104 files and 1410 tests; the single failure is `T42a-U8`. One earlier run, made while
`npm run lint` ran in parallel, reported 5 failures in 3 files; rerun alone it reported only `T42a-U8`, three times
over. I attribute the extra four to load (timeouts), and did not investigate further.

**#4**
```
OK migration up-down-up
```

**#5**
```
OK schema
```

**#6**
```
OK 4 scenarios T42b-U1..U4 each present once and passed; TZ=UTC
OK 4 scenarios T42b-U1..U4 each present once and passed; TZ=Pacific/Auckland
```

**#7** (the existing re-identification suite prints its own `[reid-dump …]` diagnostic lines, omitted here)
```
OK 334 tests, T42a-C1-C11 and I1-I11 and T42a2-I1-I3 and T42b-I1-I10 each present once and passed
OK no fixture rows left
```

**#8**
```
[]
[]
OK failing set stable and within KNOWN
```

**#9** — FAIL (the conflict above); `set -e` stops at the first extracted command:
```
FAIL UTC U8=failed(1) T42a-U8: sidebar order and label, the registry and the surface script list every loyalty surface, every route resolves its caller first, S6 checks for a browser session reducer=6
```
The second extracted command (P8-42a2 #4, SPEC line 137), run on its own on the same tree:
```
OK 3 scenarios T42a2-U1..U3 each present once and passed; TZ=UTC
OK 3 scenarios T42a2-U1..U3 each present once and passed; TZ=Pacific/Auckland
```

**#10**
```
OK as-of bound
OK failure class
```

**#11**
```
OK import end to end
```

**#12**
```
OK sidebar
OK source guards
OK fixtures fabricated
OK coarse source checks
```

**#13** — full output:
```
H1 PASS 22 page.tsx files on disk, all 22 classified (8 text-bearing)
H2 PASS 22 pages as the recipient: all 200, 0 hold the canary in any case; /transactions lists the ordinary row and the label Gift
H3 PASS the giver sees the canary on /transactions, /accounts/zq41b_check_card, /categories/Fabricated%20Gift%20Shelf, /dashboard, /properties/1
H4 PASS with the reveal date yesterday the recipient sees the canary on all 5 pages; moved back, masked again
H5 PASS recipient searches (full, prefix, payee) render the nonsense block {"count":"0","rows":0}; the amount finds the Gift row; the giver's search finds 1
H6 PASS merchant rule on the gift's payee counts 0 rows for the recipient and 1 for the giver; its Plaid category row is absent for the recipient and present for the giver
H7 PASS 24 alternating giver/recipient requests over 6 pages and routes: each viewer always got their own answer; API bodies byte-identical per viewer
H8 PASS dev-server output (7426 bytes): 0 lines hold the canary in any case, besides 3 access-log lines echoing this script's own search URLs
H9 PASS RSC: 1 /transactions as the recipient: 13716 bytes, ordinary row present, canary absent
H10 PASS giver's /gifts lists the gift and its criterion; recipient's lists none and holds no criterion; the Gifts nav entry is present for both
H11 PASS /travel and /api/v1/loyalty as both users: 200, label and masked suffix present, the 18-character number absent in any case
H12 PASS both users, 8 steps over /travel, /accounts/zq41b_check_card and /api/v1/loyalty: a gift-held fee is no fee for either; revealed, fee date 2026-11-15 and expected by 2026-12-30 (Postgres dates), then overdue, received, no state without a benefit, and no Earns into once unlinked; the held row's name and amount appear on neither /travel nor the API
OK H1-H12
OK surface
```
The fee date and the expected-by date in the H12 line are `psql` results of `(CURRENT_DATE - 5)::text` and
`(CURRENT_DATE + 40)::text`, read back after the step and compared with the API's `feeWatch`; the script computes
no date itself.

**#14**
```
OK classes
```

**#15**
```
OK task source guards
```

**#16** — no output.

**#17**
```
OK existing tests only gained the new keys; removed lines 3
```
No other output (the census lines are silent). The three removed lines are the `membership()` fixture line and the
overview fixture line in `packages/contracts/loyalty.test.ts` (both only gained null or empty keys) and the one
`T42a-C10` class-expectation line in `apps/web/app/api/v1/loyalty/loyalty.test.ts`.

**#18** `npm run build; echo "exit=$?"` (tail)
```
○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand

exit=0
```

Order and freshness: commands 2, 4, 6, 7, 8, 10, 11, 12, 14, 17 and 18 ran before one last, comment-only edit to
`lib/loyaltyStore.ts` (a numeric example removed from a comment, so no figure sits in a tracked file). After that
edit tsc (#1), #5, #15, #16 and the new integration file were re-run and passed, and the #3, #9 and #13 outputs
above are from runs after it. The others were not re-run after the comment edit.

## Toolchain rows measured

- iCloud: `find apps/web packages migrations db node_modules -flags +dataless …` gave `0` before the work.
- T4/BASE (orchestrator's, GATES.md G0): 103 files, 1406 tests. After: 104 files, 1410 tests.
- T5/LINT_BASE: 0 errors, 5 warnings. After: 0 errors, 5 warnings.
- T6: 324 integration tests, failing set `[]`. After: 334 tests, failing set `[]` (command 8).
- T9: port 3198 free (`lsof … | wc -l` gave `0`) before command 13.

## Mutation log

Each mutation was applied alone to the working tree, the named check run, and the file restored from a byte copy.
The tree checksum (`git diff HEAD` plus every untracked file, through `md5`) was the same before and after each
mutation round. "Integration" is `apps/web/app/api/v1/loyalty/loyaltyCard.test.ts` run alone against the throwaway
database; it passes 10 of 10 on the unmutated tree.

| # | Mutation | Caught by | Observed |
|---|---|---|---|
| M1 | Match the fee on category (`plaid_category_detailed = 'BANK_FEES_OTHER_BANK_FEES'`) instead of the name rule | T42b-I3, T42b-I5 (and I4, I6 to I10, whose fixtures carry no category) | integration: I3 I4 I5 I6 I7 I8 I9 I10 failed |
| M2 | `CURRENT_DATE < expectedBy` instead of `<=` (the `>` for `>=` boundary) | T42b-I6 | integration: I6 failed |
| M3 | Drop the "issued or recorded on or after the fee" condition, so an instrument before the fee closes the expectation | T42b-I7 | integration: I7 failed |
| M4 | Read `FROM transactions t` raw instead of `visibleTransactions(null)`, without the held-row exclusion | command 15, W1 (command 3), T42a-C10 (command 7), T42b-I8 | #15 `FAIL raw transactions read in apps/web/lib/loyaltyStore.ts`; `T41b-W1` failed; `T42a-C10` failed; integration: I8 failed (the giver's real row counted) |
| M5 | "Today" from the JS clock (`new Date().toISOString()` passed as the comparison date) | command 15 | #15 `FAIL clock or float in apps/web/lib/loyaltyStore.ts`. The integration file still passed 10 of 10 (server and database agree on the date here), so this mutation is caught by the source guard only |
| M6 | Drop `amount > 0` from the fee rule | T42b-I3, T42b-I5 | integration: I3 I5 failed |
| M7 | Allow a `depository` account to be linked | T42b-I1 | integration: I1 failed |
| M8 | `created_at` overrides a known `issued_on` | T42b-I7 | integration: I7 failed |
| M9 | Any equal-amount credit refunds a fee (name condition dropped) | T42b-I5 | integration: I5 failed |
| M10 | A second `cardAccountId: null` sender (the "Clear benefit" handler also unlinks) | T42b-U4 (command 6) | `FAIL UTC U4=failed(1) T42b-U4: …` |
| M11 | The account page shows `Earns into` for an unlinked credit card | T42b-H12 (command 13) | `H12 FAIL step 1: an unlinked card's page says Earns into (owner)` |

Not run from the spec's mutation list: pick-by-id, `authorized_date`, refund-cancels-every-fee, resurrection,
ignoring kind or membership, join repetition, unlink clearing instruments, stored fee column, emitting the amount,
leaving `/travel` unclassified, giver-only exclusion (M4 shows the giver's real row counting when the read path is
bypassed), dropping the unique index, and a `down` dropping `card_account_id` (the last three touch frozen contract
files). Their scenarios exist and pass on the unmutated tree; that they would catch those mutations is unverified.

## Interpretations recorded

- **H12 step 2, "no response holds `ZQ42B ANNUAL` or the fee amount".** `/accounts/<card>` is `text-bearing`: the
  giver sees their own row there by design (H3), and every viewer sees row amounts in the statement. So the name is
  checked on the account page for the recipient only, and the amount is checked on `/travel` and the API only. Both
  are checked on `/travel` and the API for both viewers.
- **U4 "No component or the travel page imports db".** Four existing, unrelated components import `@/lib/db`
  (`AccountBalancesSection`, `AccountStatementLinks`, `BudgetMonthlyGrid`, `SyncHealthCard`). The check is scoped to
  the loyalty page files (`components/(Loyalty|Travel|AccountEarns)*.tsx` and `app/travel/`), which none of them is.
- **Credit type "enforced in the PATCH route".** The PATCH handler calls `patchMembership`, which reads the account's
  type `FOR SHARE` in the same transaction as the write and answers 400 `INVALID_INPUT`. The route's doc comment says so.
- **Held rows.** The fee rows are read as viewer `null` through `visibleTransactions`, and `gift_masked` rows are
  excluded explicitly, so the answer is the same for every viewer (Open question 7).

## Docs and skills

- Read under `node_modules/next/dist/docs/01-app/`: `01-getting-started/05-server-and-client-components.md`,
  `03-api-reference/03-file-conventions/route.md`, `03-api-reference/03-file-conventions/page.md` (params),
  `03-api-reference/04-functions/use-router.md` (`router.refresh`).
- The `uiux-promax` skill was invoked before the controls were designed. Palette: `/travel` and its components are
  `gray-*` (the file's and the skill's tokens); the account page is `slate-*` (the file's), so the shared fee line
  takes a `tone` prop and never mixes the two. State colours: amber for overdue (warning), green for received. Tap
  targets use `min-h-8`, as P8-42a2.

## Limits

1. No renderer exists (T19). Wording is proved over real HTTP (H12) and by source checks (U4); no tap was executed.
   **The phone-width and desktop screenshots the spec asks for were not taken.** That is a gap in this bundle.
2. The fee rule's known limits stand: a partial refund, or a refund whose bank text carries none of the named words,
   leaves the fee posted; a fee whose bank text uses other words is not detected.
3. The window around Postgres midnight, when `CURRENT_DATE` could change between a test computing a date and the
   handler running, is not guarded; no command waits across midnight.
4. One refund cancels at most one fee, but two refunds can both choose the same fee (each picks the latest fee of its
   amount on or before its own date). The spec states no rule for that case and no scenario exercises it.

## Data hygiene

Every fixture is fabricated and carries `ZQ42B`; fabricated fee amounts live only in the two new test files and the
surface script's scratch database. No dev database or real ledger was read. This file was scanned for dollar figures
and comma-grouped numbers: the only numbers are counts, dates of fabricated rows, line numbers and versions.
