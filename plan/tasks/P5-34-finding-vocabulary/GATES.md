# P5-34-finding-vocabulary — gate log

Append-only. Every decision, the command run, and its output.

## G0 — spec gate — 2026-10-19 — PASS

Spec persisted verbatim from the spec-writer's report (from the `# P5-34…` heading to the end); only the Status line
changed at freeze.

**Open questions:** Q1 (severity scale) answered by the owner in chat → **three levels**, `critical | warning | notice`,
the spec's default. Q2 (no property subject; ROADMAP §5 step 34's "property-ledger anomalies" names a producer that does
not exist), Q3 (month outlook and coverage excluded until step 36 needs them) and Q4 (confidence a fixed label, never
numeric) are technical and taken at the spec's defaults by the orchestrator; reported to the owner in chat.

**Process ruling — who writes `packages/contracts/findings.test.ts`:** the spec says "whoever holds the G1 lease". The
guardian's role excludes tests, and the scope guard (fixed for `packages/contracts/` in `0d8f8af`) exempts test files
from the lease. Ruling: **the implementer writes it**; G1's digests cover `findings.ts` only.

**Risk tier (A8): full pipeline.** Contract surface touched (a new contract file); no migration, no outbound surface, no
money arithmetic in shipped code.

**Toolchain (measured, under bash):** T1 `1`. T2 `Migrations complete!`, `user_invitations`. T3 exit 1. T4 BASE **88 files,
1240 tests**. T5 apps/web tsc exit 0. T6 root tsc exit 0 (H9 does not bite the root run). T7 #6 on the unmodified tree →
`OK 236 integration tests, none failing except RC-03` (IBASE = **236**, zero failures). T8 exit 0. T9 `-780` / `480`.
T10 merge-base resolves (`1`), nothing modified under apps/packages/migrations/db (`0`). Lint baseline 0 errors, 5 warnings.

**Run on the unmodified tree (blocks extracted verbatim, under bash):** #5 → `FAIL UTC C1=(0)…`: every scenario missing.
#6 → OK (= T7). #7 → no output. #8 → no output; **discrimination probe:** appending a comment to
`apps/web/lib/domain/drift.ts` made #8 print `M	apps/web/lib/domain/drift.ts`; reverted with `git checkout`, tree clean.

**Vacuity:** #5 requires 34 named scenarios passing once in three zones; fourteen orchestrator mutations each name the
scenarios that must fail. A10: single-sourcing of severity and kind exhaustiveness are AST/type checks (W1–W6, tsc on the
registry), not text search; #7 is the only grep and is declared weak. #8 is the mechanical proof of "nothing visible
changes".

Spec frozen: `touch .frozen`.

## G1 — contract gate — 2026-10-19 — PASS

Guardian wrote `packages/contracts/findings.ts` (new) and `CONTRACT.md`; nothing else (`git status`). `index.ts` untouched
(subpath import).

**Run by the orchestrator:**
- Root `npx tsc --noEmit` → exit 0; `(cd apps/web && npx tsc --noEmit)` → exit 0 (the `strictObject().refine()` members
  compile inside the discriminated union; `FindingKindIsExact` holds).
- CONTRACT.md control script (13 valid, 24 invalid fabricated findings), extracted verbatim to the scratchpad →
  `OK 13 valid, 24 invalid`, exit 0. **The orchestrator's first extraction was empty (0 lines) and `tsx` exited 0 on the
  empty file** — caught by checking the line count, re-extracted (56 lines) and rerun. Recorded because a vacuous pass is
  exactly what G0's vacuity rule exists to catch.
- Discrimination probes on a temporary copy (`findingsProbe.ts`, deleted after; `findings.ts` sha256 unchanged):
  P1 forecast member `z.strictObject` → `z.object` → `UNEXPECTED accept forecast carries charges`;
  P2 wallet never/null refinement neutralised → `UNEXPECTED accept wallet never with zero days`.

**Class:** additive (one new file, no existing contract or consumer touched).

**Ruling on the guardian's ambiguity 1 (`monthly` on budget-underspend):** the spec contradicts itself — its carried
list (line 123) names only the window totals, while V13 requires every producer field to survive except
`ForecastFinding.charges`, and `ChronicUnderspendFinding.months[]` is a producer field. V13, the stricter and testable
rule, governs; `monthly` stays, with the refinement tying `monthly[i].month` to `period.months[i]`. Ambiguities 2–6
accepted as written (notably: "never" pairs with null by refinement; states that are not findings — sync `ok`, job
`fresh`, feed `unknown` — are not representable; severity and confidence not pinned per kind, the mapping is the
conversions' job; the sync producer's `Unknown` bank string carried as is, recorded for step 35).

Contract-file digest at close, for G2's freeze check:
    b55590fadfca9db2dc5c12d8bb93a7e7574955cae7d4fcf66a8ca5777108b734  packages/contracts/findings.ts

Lease closed.

## G2 — build gate — 2026-10-19 — PASS

Run by the orchestrator, under bash where the spec says so.

**Contract freeze:** `findings.ts` sha256 `b55590fa…` = G1. **Scope:** `git status` shows exactly the five declared new
files (+ the task directory and `plan/QUEUE.md`); no existing file under apps/packages modified.

**Results:** #1 apps/web tsc exit 0. #2 root tsc exit 0. #3 lint 0 errors, 5 warnings (= baseline). #4 91 files (BASE + 3),
1276 tests (BASE + 36: 34 scenarios + 2 evidence-table tests). #5 `OK 34 scenarios C V A W …` for UTC, Pacific/Auckland,
America/Los_Angeles. #6 236 tests (= IBASE), failed `[]` (RC-03 passed). #7 no output. #8 no output from either half.
#9 build exit 0.

**Orchestrator-applied mutations** (independent of the implementer's list; `lib/domain/findings.ts`, one at a time,
sha256 identical after restore; baseline 0/36 failing):
- O1 open overdraft `critical` → `warning` → V9 A4 A6 (+ the evidence-table test).
- O2 an empty supplied source reported in `notEvaluated` → A1 A2.
- O3 job `fresh` converted into a finding → V6 V14 A2 (+ table).

**Implementer's mutation log** (EVIDENCE.md, 14/14 applied and killed). Rulings on deviations from "exactly the named
scenarios": extra failures (M02/M07 → V13; M03/M04/M12 → A6; M12 → W6 and tsc) are broader, not narrower, and each has
a stated reason — accepted. **M08 (carry `charges`) does not fail C3**: C3 parses its own fixtures and no converter
mutation can reach it, so naming it was a spec error; the leak is caught by A5 and A6 (and V10/V13/A8 as named).
Accepted; recorded.

## G3 — adversarial gate — 2026-10-19 — ACCEPT_WITH_NITS (0 implementer cycles)

Reviewer verdict ACCEPT_WITH_NITS (REVIEW-1.md), falsification log non-empty (20 hypotheses, 17 refuted). No BLOCK.

**INCONCLUSIVE items:**
- **N3 run by the orchestrator (A2):** scratchpad `nit3.mts` under `TZ=UTC`: `jobHealth(2026-03-06T01:00Z, 2026-03-05T13:00Z)`
  → `{"status":"late","daysSince":-1}`; `fromJob` carries it; `FindingSchema.safeParse` → `false`, `daysSince Too small:
  expected number to be >=0`. **Confirmed.** Ruling: deferred to step 35, not a cycle. Fixing it here needs either a
  contract change (reopen G1) or an edit to `jobHealth.ts` (forbidden by this task's no-existing-file rule), nothing
  consumes the assembler yet, and step 35 reworks time and freshness and reopens the contract anyway.
- **W1 lookup-table probe:** not run — it imports a test module outside vitest. N1 is accepted as confirmed by reading;
  the gap is within the spec's W1 wording and is a step-36 item.

**Rulings:** N1–N6 deferred to NITS.md (steps 35 and 36). N2 (backup-rehearsal producer) is an inventory omission in the
frozen spec, not an implementation defect.

## G4 — integration gate — 2026-10-19 — PASS

Tree unchanged since G2 except the task's plan files. Unit suite 91 files, 1276 tests passed. `findings.ts` sha256
`b55590fa…` = G1. Migration round-trip on `b8_p34_throwaway` (no migration in this task) → `Migrations complete!`. #8 no
output. G2's #6 (236/0 failing), #9 build and #1/#2 tsc stand for the same tree. Owner go-ahead to commit and push given in chat, 2026-10-19.
