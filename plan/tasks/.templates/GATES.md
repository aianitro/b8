# GATES — <task-id>
<!-- Append-only audit trail. The process analogue of this app's own append-only observation
     tables: the record of what happened is worth more than a summary of it. -->

| Gate | Result | When | Evidence |
|---|---|---|---|
| G0 spec | PASS/FAIL | <ts> | <what was checked; which command would catch a stub; toolchain rows verified> |
| G1 contract | PASS/FAIL/SKIP | <ts> | <change class, migrate up/down/up clean, lease open→close> |
| G2 build | PASS/FAIL | <ts> | <every acceptance command re-run by the orchestrator + verbatim output> |
| G3 adversarial | PASS/FAIL | <ts> | <verdict, falsification log size, BLOCK count> |
| G4 integration | PASS/FAIL | <ts> | <full suite, tsc, lint, build, migrate round-trip, INCONCLUSIVE items converted to commands> |

**Cycle count:** <n> / 3
<!-- G2/G3-BLOCK/G4 failures increment. A reviewer-fault (empty falsification log) does NOT. -->

## Adjudications
<!-- Disputes settled by a discriminating command, never by argument (BUILD.md §5.1).
     A disposition may not be recorded as "verified" unless the causal claim behind it was
     itself run as a command. Otherwise it is recorded as a hypothesis. -->
| Claim in dispute | Discriminating command | Output | Decision |
|---|---|---|---|
