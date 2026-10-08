# GATES — P6-40f-sync-reid-across-pages
<!-- Append-only audit trail. The process analogue of this app's own append-only observation
     tables: the record of what happened is worth more than a summary of it. -->

| Gate | Result | When | Evidence |
|---|---|---|---|
| G0 spec | PASS (owner amendment R4) | 2026-10-07 | Owner chose to fix the cross-walk merge too (R4, PG-13/PG-14). T1–T3, T5, T7 verified; #5 baseline recorded. Vacuity: #9 requires named PG tests RED on base sync.ts and guards GREEN on base. Real-data check: 0 re-identification log lines on the server since 2026-09-17. Report arrived in caveman style (A11 working). |
| G1 contract | SKIP | 2026-10-07 | No contract surface. |
| G2 build | PASS | 2026-10-07 | Orchestrator re-ran plain: #1 0; #2 0; #3 `15 passed`, 15 PG lines; #5 `26 passed`; #6 empty; #7 `1 1` (with /usr/bin/grep — the shell's grep function is ugrep and misreads the second pattern; implementer finding 1); #8 `12 passed`; #9 base sync.ts RED exactly PG-01,02,03,04,06,07,08,09,13 and guards PG-04a,04b,05,10,12,14 pass, restored with cmp 0; #10 0; #11 `72/1112`; #12 empty. Orchestrator hypothesis handed to G3: R4 may drop owner-set fields when Plaid reissues incrementally as removed(old)+added(new) in one walk. |
| G3 adversarial | FAIL → cycle 1 (spec-level; R4 replaced by owner-approved R5) | 2026-10-07 | REVIEW-1 BLOCK B1 (re-auth historical pull duplicated under R4) + B2 (incremental removed+added loses owner fields; orchestrator's hypothesis). Both trace to R4 — the orchestrator's own recommendation — not to the implementation, which followed R4 exactly. SDK confirmed: `TransactionsSyncResponse.transactions_update_status` with NOT_READY / INITIAL_UPDATE_COMPLETE / HISTORICAL_UPDATE_COMPLETE / TRANSACTIONS_UPDATE_STATUS_UNKNOWN. Causal claims recorded as hypotheses until the cycle-1 probes run them (A2). |
| G3 adversarial | PASS (cycle 2) | 2026-10-07 | REVIEW-2 ACCEPT_WITH_NITS → N1–N3 fixed in cycle 2; REVIEW-3 (focused on the cycle-2 delta) ACCEPT_WITH_NITS, 0 BLOCK; N6/N7 recorded as follow-ups. |
| G4 integration | PASS | 2026-10-07 | Orchestrator, plain. `npm test` 72 files / `1112 passed`; `tsc --noEmit` exit 0; lint exit 0 (0 errors; 6 warnings, none in the changed files, which lint clean); `npm run build` exit 0; #3 `24 passed`; #5 `26 passed`; #6 empty. Migrate round-trip N/A (no migration). REVIEW-3 INCONCLUSIVE converted: production `select version()` = PostgreSQL 16.14, scratch DB = 16.14; the reviewer's xmax probe on the scratch DB printed `t`, `f`, then 0 rows (expected). Money scan of the diff and new files: SQL placeholders and one fabricated fixture amount only. |

**Cycle 1 G2 (2026-10-07, orchestrator, plain):** #1 0; #2 0; #3 `22 passed`, 22 PG lines (the R5 text said 21 — orchestrator's arithmetic; 15+7=22); #5 `26 passed`; #6/#12 empty; #8 `12 passed`; #11 `1112`. **A2 probes run:** cycle-0 sync.ts → RED PG-15, 15b, 15c, 16, 16b, 17 (B1 via PG-16/16b, B2 via PG-15/15b — REVIEW-1's causal claims now verified by command); base 8df05e7 → RED PG-01,02,03,04,06,07,08,09,13,15b,15c,15d,16,16b,17. Every swap restored, final cmp 0. PASS → REVIEW-2. Implementer findings for the reviewer: F6 (walk now buffered — a mid-walk failure writes no rows, where base wrote earlier pages; cursor never written on failure either way) and the open edge (an id both added and removed in one walk can claim a retired row which the DELETE then removes — Plaid retired both).

**REVIEW-2:** ACCEPT_WITH_NITS (0 BLOCK). Orchestrator sends N1–N3 back as cycle 2 rather than deferring: same nightly write path, small, and N1 is an owner-field loss.

**Cycle 2 G2 (orchestrator, plain):** #1 0; #2 0; #3 `24 passed`, 24 PG lines; #5 `26 passed`; #6/#12 empty; #8 `12`; #11 `1112`. Neighbouring suites (scripts, overview, transactions): 56/57, the one failure is H4's known stale overview test. **Adjudication — `synced` counting:** the implementer changed the `added` upsert to `RETURNING (xmax = 0) AS inserted` and counts only true inserts (and not ids whose last walk event is a removal). This crosses the spec's "added counter semantics" non-goal but implements its own Counting convention ("rows newly INSERTED"). Consumers checked by command: `sync_log.synced`, SyncHealthCard's per-phase sums, SyncControls' "N added" toast, and the route's `errors && synced === 0` check — all mean "new transactions", and base overcounted every re-delivered row. **Accepted**; historical sync_log rows keep their inflated counts.

**Cycle count:** 2 / 3 — closed

**Tier (A8):** full pipeline, G3 blocking — changes the nightly sync write path.
<!-- G2/G3-BLOCK/G4 failures increment. A reviewer-fault (empty falsification log) does NOT. -->

## Adjudications
<!-- Disputes settled by a discriminating command, never by argument (BUILD.md §5.1).
     A disposition may not be recorded as "verified" unless the causal claim behind it was
     itself run as a command. Otherwise it is recorded as a hypothesis. -->
| Claim in dispute | Discriminating command | Output | Decision |
|---|---|---|---|
