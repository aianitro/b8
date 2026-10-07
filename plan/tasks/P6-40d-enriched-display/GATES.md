# GATES — P6-40d-enriched-display
<!-- Append-only audit trail. The process analogue of this app's own append-only observation
     tables: the record of what happened is worth more than a summary of it. -->

| Gate | Result | When | Evidence |
|---|---|---|---|
| G0 spec | PASS | 2026-10-07 | Column names reconciled with P6-40b's frozen contract (identical). T1 unit baseline 1024; T2 `typescript` resolvable from apps/web. Baselines that make the commands discriminating: `next.config.ts` has 0 `images` entries (#6 would catch one); #7 `website` grep exit 1 today; #8 prints 0 today (no `authorized_date::text`) and turns 1 only with the cast; #3/#4 test files absent. `vitest.config.mts` includes `lib/**/*.test.ts` (AST wiring test lives there). Spec's own A8 assessment accepted: G1 skipped (no contract surface); **G3 stays blocking**, scoped to the logo privacy/robustness rules, because the browser now fetches third-party URLs. Implementation waits for P6-40b to merge (needs its columns). |
| G1 contract | SKIP | 2026-10-07 | No contract surface touched (#6 gates it). |
| G2 build | PASS/FAIL | <ts> | <every acceptance command re-run by the orchestrator + verbatim output> |
| G3 adversarial | PASS/FAIL | <ts> | <verdict, falsification log size, BLOCK count> |
| G4 integration | PASS/FAIL | <ts> | <full suite, tsc, lint, build, migrate round-trip, INCONCLUSIVE items converted to commands> |

**Cycle count:** 0 / 3

**Tier (A8):** G1 skipped; G3 blocking (outbound browser fetches of third-party logo URLs).
<!-- G2/G3-BLOCK/G4 failures increment. A reviewer-fault (empty falsification log) does NOT. -->

## Adjudications
<!-- Disputes settled by a discriminating command, never by argument (BUILD.md §5.1).
     A disposition may not be recorded as "verified" unless the causal claim behind it was
     itself run as a command. Otherwise it is recorded as a hypothesis. -->
| Claim in dispute | Discriminating command | Output | Decision |
|---|---|---|---|
