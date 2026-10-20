# P5-35-finding-freshness — gate log

Append-only. Every decision, the command run, and its output.

## G0 — spec gate — 2026-10-19 — PASS

Spec persisted verbatim: extracted by script from the spec-writer's final message in its transcript (272 lines, from the
`# P5-35…` heading to the end of Rollback), not retyped. Only the Status line changed at freeze.

**Open questions:** answered by the owner in chat — Q1 manual-ledger accounts are `undated` (no import log now); Q2 a
future-stamped scheduler run is treated as a run at `now`; Q6 precedence `never > stale > undated > fresh`. All three are
the spec's defaults. Q3 (no property kind), Q4 (backup rehearsal and pending proposals excluded) and Q5 (overdraft rows
stale at the sync constant) are technical and taken at the defaults by the orchestrator; reported to the owner.

**Risk tier (A8): full pipeline.** Contract change (a required key on every `Finding` member; class for the guardian to
confirm under §9.2), a new module that queries the database, and one existing producer changed (`jobHealth.ts`, N3).

**Toolchain (measured, under bash):** T1 `1`. T2 `Migrations complete!`, `cash_counts`. T3 exit 1. T4 BASE **91 files,
1276 tests**. T5 exit 0. T6 exit 0. T7 integration on the unmodified tree → **IBASE 236, failed `[]`**. T8 exit 0. T9 `-780` /
`480`. T10 `1` / `0`. T11 `grep -c` → `2`, not the spec's `1`: the precedent path appears twice in the config (a comment and
the include entry). The row's purpose — the precedent exists — holds; recorded, not a failure. Lint baseline 0 errors,
5 warnings.

**Run on the unmodified tree (blocks extracted verbatim, under bash):** #5 → `FAIL UTC T35-C1=(0)…`: only the 20 new
scenarios missing; all 34 `T34-` scenarios present and passing. #6 → `FAIL R1(0)…R9(0)`, no unexpected failing title.
#7 → no output. #8 → no output. **#8 probes:** a comment appended to `components/SyncHealthCard.tsx` → first half prints
`M	apps/web/components/SyncHealthCard.tsx`; a comment appended to the declared `lib/domain/jobHealth.ts` → no output (the
allow-list works both ways). Both reverted with `git checkout`; tree clean.

**Vacuity:** #5/#6 require 54 unit and 9 integration scenarios by id; seventeen orchestrator mutations each name the
scenarios that must fail. A10: single-sourced thresholds and the absence of clocks and protected columns are AST checks
(W1, W3) with fabricated violators; #7 is the only grep and is declared weak. #10 proves no consumer imports the vocabulary,
which is what makes the required-key contract change safe.

Spec frozen: `touch .frozen`.

## G1 — contract gate — 2026-10-19 — PASS

Guardian changed `packages/contracts/findings.ts` only (+ CONTRACT.md); `git status` confirms. No test file edited.

**Class: breaking (§9.2), confirmed by the guardian rather than relabelled.** A required key on every member breaks
previously valid values. The add-nullable-then-tighten route is waived, recorded: (1) no non-test file imports the module —
**acceptance #10 run at G1 → no file listed, `rc=1`**; (2) nothing is stored or served; (3) a nullable `freshness` would let
"forgot the key" read as "nothing to say", the undated-read-as-fresh failure this task exists to prevent. Once step 36
consumes the shape, any change to it is breaking in effect.

**Run by the orchestrator:**
- Root `npx tsc --noEmit` → **20 errors, as the guardian predicted**: 10 in `apps/web/lib/domain/findings.ts`, 10 in
  `packages/contracts/findings.test.ts`; **every one names `freshness`** (`grep -vc freshness` → `0`) and **none is inside
  `packages/contracts/findings.ts`** (`0`). These are the implementer's to fix; G2 requires both tsc runs exit 0.
- Control script, extracted by script from CONTRACT.md (68 lines; line count checked this time before trusting the result) →
  `OK 17 valid, 59 invalid`, exit 0.
- Probes on a temporary copy (deleted; contract sha256 unchanged): P1 fresh-needs-zero-undated neutralised →
  exactly `UNEXPECTED accept fresh with an undated input`; P2 precision refinement made always true → exactly the two
  predicted C4 lines. (The orchestrator's first P2 pattern did not apply — the refinement has a leading
  `f.lastObserved === null ||` — detected by the `cmp` guard and redone.)

**Ambiguities accepted as resolved by the guardian:** an empty input set counts as one undated input (the only reading
under which "no inputs is undated" and "undated needs at least one" both hold — the implementer must emit 1, not 0);
`basis: 'none'` only with `undated`; instants spelled only as `toISOString()` output; no threshold or per-kind table in
the schema (F1/F4 own those); `FreshnessBasisSchema.options` is the tie-break order — the implementer reads it rather than
keeping a second list.

Contract-file digest at close, for G2's freeze check:
    6cd72690b4da6ad3511b8fa08316ae97a342a4e1d40e072734028dfe937b3440  packages/contracts/findings.ts

Lease closed.

## G2 — build gate — 2026-10-20 — PASS

The first implementer was cut off by the session ending; a second was dispatched in the main tree to build on the
uncommitted work (fixed one tsc error in a test helper; added `scripts/findings-freshness-read.test.ts` with T35-R1..R9
and its include entry). Contract sha256 re-checked: `6cd72690…3440`, unchanged since G1.

**Acceptance, run by the orchestrator under plain shell; #5–#8 extracted from SPEC.md by script, not retyped:**
- #1 `exit=0` · #2 `exit=0`
- #3 `✖ 5 problems (0 errors, 5 warnings)` — equal to baseline
- #4 `Test Files  92 passed (92)` / `Tests  1296 passed (1296)` — BASE + 1 file, BASE + 20 tests
- #5 `OK 54 unit scenarios (34 T34 + 20 T35) each present once and passed TZ=UTC`, same for `Pacific/Auckland`, `America/Los_Angeles`
- #6 `OK 245 integration tests, none failing except RC-03; R1..R9 each present once and passed` — IBASE + 9
- #7 no output (grep rc=1) · #8 no output from either half
- #9 `Tests  21 passed (21)`, `exit=0`, `UNMODIFIED`
- #10 no file, `rc=1` · #11 `exit=0`

**Mutations M1–M17**, applied one at a time by script (exact single-match replacement, match count checked, file restored
from memory), unit file set + `jobHealth.test.ts`, and the R-file when the read module was mutated. Tree checksum before
and after identical.

| M | Named | Failed |
|---|---|---|
| M1 | F6 | F1, F5, F6 |
| M2 | F3, F8, F9, C2 | F1, F3, F5, F7, F8, F9, F11, F12 |
| M3 | F4 | F4 |
| M4 | W1 | W1 |
| M5 | F5 | F1, F5 |
| M6 | F10 | F10 |
| M7 | R7 | W3, R7 |
| M8 | R7 | R7 |
| M9 | W1, R6 | W1 |
| M10 | F7, R1 | R1, R2 |
| M11 | F7 | F7, F9 |
| M12 | F2 | F2 |
| M13 | F13 | T34-A4, T34-A6, F13 |
| M14 | F8 | F8, F12 |
| M15 | W3, R8 | W3 |
| M16 | R4 | R4 |
| M17 | F9 | F7, F8, F9 |

Every mutation is killed. Four named ids did not fail; each accepted with a reason, none is an uncaught defect:
- **C2 (M2):** a contract test; it does not import the module mutated, so no module mutation can reach it. Spec mapping error.
- **F7 (M10):** the mutation is in SQL; F7 is a unit test over facts. R1 is the scenario that owns it, and failed.
- **R6 (M9):** R6 reads twice with two app-side instants; SQL `NOW()` is the database clock, identical across both reads,
  so R6 cannot see it by construction. The AST check W1 is the guard (A10) and failed. Note for G3.
- **R8 (M15):** a protected column selected and then dropped by the row mapping never reaches the output R8 inspects.
  W3 (static) is the guard and failed.

Implementer flag for G3: the R-file TRUNCATEs the read tables before each world and in `afterAll` (the read is global);
the full integration run stays green.

## G3 — review gate — 2026-10-20 — ACCEPT_WITH_NITS

REVIEW-1.md persisted (23 hypotheses, one CONFIRMED: the SQL-clock guard is W1 alone). No BLOCK, three nits → NITS.md.
The two inconclusive items were run by the orchestrator:
- Integration suite with `--sequence.shuffle`, seeds 1 and 2 → each `total 245`, failed `[]`, T35-R1..R9 passed 9/9.
  The R-file's TRUNCATE does not break other suites in either order.
- W1 blind spot: a `CURRENT_TIME` query appended to `lib/findingsFreshnessRead.ts` → `T35-W1` still passes
  (`Tests  1 passed | 9 skipped (10)`). Confirmed; recorded as N1, not a G3 failure — the spec's named list is met.
  File restored, `cmp` identical to the backup.

## G4 — integration gate — 2026-10-20 — PASS

Code tree unchanged since G2 (only the task's plan files changed since). Unit suite `92 passed (92)` / `1296 passed (1296)`.
`packages/contracts/findings.ts` sha256 `6cd72690…` = G1. #8 no output. Migrations on `b8_p35_throwaway` (none in this
task) → `No migrations to run!` / `Migrations complete!`, `cash_counts`. G2's #6, #11 and #1/#2 stand for the same tree.
Commit awaits the owner's go-ahead.
