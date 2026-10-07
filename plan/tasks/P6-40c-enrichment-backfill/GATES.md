# GATES — P6-40c-enrichment-backfill
<!-- Append-only audit trail. The process analogue of this app's own append-only observation
     tables: the record of what happened is worth more than a summary of it. -->

| Gate | Result | When | Evidence |
|---|---|---|---|
| G0 spec | PASS (amended) | 2026-10-07 | Reconciled with merged 40a (tombstone table) and 40b (`plaidEnrichment`/`enrichmentParams`, `plaid_raw` done-marker). **Amendment, causal claim run as a command:** `ops/laptop/pull-backups.sh` line 61 rsyncs `b8/apps/backups/` wholesale (no include filter), so the spec's default CSV location would ship plaintext real rows to the laptop — default moved to `$HOME/b8-backfill-backups`, in-repo/in-backups paths refused, new BF-17 replaces #7. Toolchain T1–T4 verified; `tsx` + `lib/db` import pattern confirmed in two existing scripts. Vacuity: BF-01 requires `would_update > 0`; BF-02/BF-10 together require the first apply to write; #10 alone is admitted stub-satisfiable and is not load-bearing. |
| G1 contract | SKIP | 2026-10-07 | No contract surface (reads 40b's columns only). |
| G2 build | PASS | 2026-10-07 | Orchestrator re-ran in the main tree (implementer ran there after a worktree started at the wrong commit — see Adjudications). #1 tsc exit 0; #2 `Tests 1037 passed` (no `failed`); #3 `package.json:1` `apps/web/package.json:1`; #4 exit 2, usage names `--apply` ×4; #5 `Tests 17 passed (17)`, BF-01…BF-17 each exactly 1; #6 `0`; #7 → BF-17 (in #5); #8 `0`; #9 `1` / `0`; #10 dry-run, every total 0, exit 0, `~/b8-backfill-backups` not created (did not exist before). |
| G3 adversarial | ACCEPT_WITH_NITS → cycle 1 by orchestrator decision | 2026-10-07 | REVIEW-1: 0 BLOCK; N1–N3. INCONCLUSIVE run: root forwarder `-- --aply` → exit 1 `listing items failed`, usage never shown — N3 CONFIRMED. Because this script runs once against the owner's real data and real Plaid, all three nits are fixed now as an explicit cycle rather than deferred (recorded, not absorbed). |
| G4 integration | PASS/FAIL | <ts> | <full suite, tsc, lint, build, migrate round-trip, INCONCLUSIVE items converted to commands> |

**Cycle count:** 1 / 3

**Tier (A8):** full pipeline — outbound Plaid surface and a write to real data.
<!-- G2/G3-BLOCK/G4 failures increment. A reviewer-fault (empty falsification log) does NOT. -->

## Adjudications
<!-- Disputes settled by a discriminating command, never by argument (BUILD.md §5.1).
     A disposition may not be recorded as "verified" unless the causal claim behind it was
     itself run as a command. Otherwise it is recorded as a hypothesis. -->
| Claim in dispute | Discriminating command | Output | Decision |
|---|---|---|---|
| #4 as written (Plaid vars unset) is safe to run | read the npm script: `tsx --env-file=.env.local` loads the real DATABASE_URL and Plaid credentials when they are unset | unset vars would be filled from `.env.local` | Implementer's variant adopted: fabricated Plaid values + `DATABASE_URL` at port 1, so the real ones never enter the process; rejection happens in argument parsing, before either is used. Orchestrator ran the variant: exit 2. |
| The first implementer's worktree could be fast-forwarded on its behalf | n/a — auto mode had denied the subagent that action | — | Not done by the orchestrator (no laundering of a denied action). Re-dispatched to the main tree at 879ad00 instead; file-disjoint from 40d's worktree. |

## Cycle 1 — orchestrator G2 (2026-10-07)
#1 exit 0; #2 `1037 passed`; #4 root form `exit 2`, usage ×4 and `-w` form `exit 2`, usage ×4 (N3 fixed — first attempt at this check returned 127 because zsh does not word-split a command held in a variable; rerun written out); #5 `19 passed`, BF-01…BF-19 each exactly once; #6 `0`; #8 `0`; #9 `1` / `0`; #10 dry-run all zeros, exit 0, no backup dir; scratch DB left empty.

**G3 (cycle 1):** PASS — REVIEW-2 ACCEPT, 9 hypotheses, 0 BLOCK; NIT: a failed-verification partial CSV stays in the backup dir — use the path printed by the successful run for evidence/rollback.

**G4:** PASS 2026-10-07 — `npm test` 1037 passed; tsc exit 0; `npm run build` compiled; lint exit 0 with `.claude/worktrees/**` excluded (the unexcluded run fails only on files inside P6-40d's nested worktree — its `.next` output and copies — not on any tracked file); money scan of the diff clean.
