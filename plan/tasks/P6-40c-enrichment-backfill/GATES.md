# GATES — P6-40c-enrichment-backfill
<!-- Append-only audit trail. The process analogue of this app's own append-only observation
     tables: the record of what happened is worth more than a summary of it. -->

| Gate | Result | When | Evidence |
|---|---|---|---|
| G0 spec | PASS (amended) | 2026-10-07 | Reconciled with merged 40a (tombstone table) and 40b (`plaidEnrichment`/`enrichmentParams`, `plaid_raw` done-marker). **Amendment, causal claim run as a command:** `ops/laptop/pull-backups.sh` line 61 rsyncs `b8/apps/backups/` wholesale (no include filter), so the spec's default CSV location would ship plaintext real rows to the laptop — default moved to `$HOME/b8-backfill-backups`, in-repo/in-backups paths refused, new BF-17 replaces #7. Toolchain T1–T4 verified; `tsx` + `lib/db` import pattern confirmed in two existing scripts. Vacuity: BF-01 requires `would_update > 0`; BF-02/BF-10 together require the first apply to write; #10 alone is admitted stub-satisfiable and is not load-bearing. |
| G1 contract | SKIP | 2026-10-07 | No contract surface (reads 40b's columns only). |
| G2 build | PASS/FAIL | <ts> | <every acceptance command re-run by the orchestrator + verbatim output> |
| G3 adversarial | PASS/FAIL | <ts> | <verdict, falsification log size, BLOCK count> |
| G4 integration | PASS/FAIL | <ts> | <full suite, tsc, lint, build, migrate round-trip, INCONCLUSIVE items converted to commands> |

**Cycle count:** 0 / 3

**Tier (A8):** full pipeline — outbound Plaid surface and a write to real data.
<!-- G2/G3-BLOCK/G4 failures increment. A reviewer-fault (empty falsification log) does NOT. -->

## Adjudications
<!-- Disputes settled by a discriminating command, never by argument (BUILD.md §5.1).
     A disposition may not be recorded as "verified" unless the causal claim behind it was
     itself run as a command. Otherwise it is recorded as a hypothesis. -->
| Claim in dispute | Discriminating command | Output | Decision |
|---|---|---|---|
