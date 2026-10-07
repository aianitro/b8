# GATES — P6-40e-plaid-rekey
<!-- Append-only audit trail. The process analogue of this app's own append-only observation
     tables: the record of what happened is worth more than a summary of it. -->

| Gate | Result | When | Evidence |
|---|---|---|---|
| G0 spec | PASS | 2026-10-07 | T1/T2/T3/T8 verified by command; UNIQUE on `plaid_transaction_id` confirmed; #9 baseline 42 passed; git history dates the matcher and the cursor reset; real-data cursor facts gathered (DIAGNOSIS.md). Four reconciliation points settled conservatively. Vacuity: RK-01 requires `would_rekey > 0`; RK-02/RK-16 together require the first apply to write; RK-08 includes a 1:1 group that must still re-key; static #11–#14 admitted as pins only. |
| G1 contract | SKIP | 2026-10-07 | No contract surface (reads tables, writes one existing column). |
| G2 build | PASS | 2026-10-07 | Orchestrator re-ran in the main tree: #1 exit 0; #2 `72 files / 1112 passed`; #3 `:1` ×2; #4 exit 2, `usage:`; #5 exit 2, refusal shown, no dir; #6 `22 passed`, RK-01…22 each once; #7 `3 passed`, RC-01/02/03 each once; #8 22 passed in Auckland and Los Angeles; #9 `42 passed` (= G0 baseline), test-file diff empty; #10 `0`; #11 `2`; #12 `0`; #13 script `0`, shared module's three matches are all comments (lines 12, 276, 283); #14 forbidden calls `0` in both, `transactionsSync` in the script/backfill (the spec's `&&` form exits early on a zero count — run as two commands); #15 `sync.ts` (H-d fix, RED/GREEN in EVIDENCE) and `txnMatch.ts` (export only); #16 zeros, exit 0. |
| G3 adversarial | PASS | 2026-10-07 | REVIEW-1 ACCEPT_WITH_NITS: 25 hypotheses, 0 BLOCK, 5 NITs (NITS.md). Both INCONCLUSIVE items run: `git diff HEAD` on sync.ts/txnMatch.ts shows only the `byToken` grouping line (+`if (a.cursor === null) group.cursor = null;`) and `export const key`; the 40c code moved to plaid-script-shared.ts differs from HEAD in 11 code lines, all renames/parameterisation — 40c passes the same `stillTarget: 'plaid_raw IS NULL'` and `fileStem: 'enrichment-backfill'`, and the walk ends at `!page.has_more` returning `{ latest, removed }`. |
| G4 integration | PASS | 2026-10-07 | `npm test` 1112 passed; tsc exit 0; lint exit 0; build compiled; no migration; INCONCLUSIVE items run (G3 row); money scan clean. Real run scheduled outside the 06:00 daily-sync window (NIT 4). |

**Cycle count:** 0 / 3

**Tier (A8):** full pipeline — writes real data and calls Plaid.
<!-- G2/G3-BLOCK/G4 failures increment. A reviewer-fault (empty falsification log) does NOT. -->

## Adjudications
<!-- Disputes settled by a discriminating command, never by argument (BUILD.md §5.1).
     A disposition may not be recorded as "verified" unless the causal claim behind it was
     itself run as a command. Otherwise it is recorded as a hypothesis. -->
| Claim in dispute | Discriminating command | Output | Decision |
|---|---|---|---|

## Root-cause discrimination run by the orchestrator (H-a vs H-f)
Server logs begin 2026-09-17 (home-server cutover); the end-of-August window predates them, so H-f (cursor-less sync before account remap, statements dropped as unrecognized) cannot be settled from logs. The only `reconcile failed` / `unrecognized account` lines on the server are 30 × `reconcile failed for token` on 2026-09-18…20, all `getaddrinfo ENOTFOUND production.plaid.com` — a DNS outage, unrelated. Finding recorded: **H-a**, with H-f an unrefuted alternative for the laptop-era window. H-g (re-claim across pages, reproduced) and H-f's mechanism go to NITS as follow-ups.
