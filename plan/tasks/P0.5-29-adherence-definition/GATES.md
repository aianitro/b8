# GATES — P0.5-29-adherence-definition
<!-- Append-only audit trail. -->

| Gate | Result | When | Evidence |
|---|---|---|---|
| G0 spec | FAIL → **PASS** (draft 2) | 2026-09-01 | 1 finding, fixed and re-verified. Draft 2 frozen; freeze enforcement re-audited on all four routes. See "G0 review 1", "G0 review 2". |
| G1 contract | **SKIP** | 2026-09-01 | Contracts touched: none. Verified — the diff surface is `lib/**` only; §7.2 skips when the contract surface is untouched. No lease opened. |
| G2 build | **PASS** | 2026-09-01 | All 26 acceptance commands re-run independently; all 26 match. Diff confined to the two declared files. Shared-conjunct reuse and the 13 inherited tests verified structurally, not taken on report. See "G2 review". |
| G3 adversarial | **PASS** | 2026-09-01 | `REVIEW-1.md` ACCEPT_WITH_NITS: 29 hypotheses, 0 BLOCK, 0 scope violations, 10 nits → `NITS.md`. All 5 INCONCLUSIVE items run; **all 5 confirmed exactly as predicted**, two of them producing demonstrably wrong numbers. See "G3 review". |
| G4 integration | **PASS** | 2026-09-01 | Suite 19/332, tsc 0, lint 0, production build 0, inherited migration round-trip clean, all 5 INCONCLUSIVE items executed at G3. See "G4 review". |

**Cycle count:** 0 / 3

## Toolchain, verified by the orchestrator ahead of G0

| Row | Command | Measured |
|---|---|---|
| T1 branch stacked on P0.5-28 | `grep -c 'control_mode: ControlMode' shared/types.ts`; `grep -c '^export function isScoredCategory' lib/domain/adherence.ts` | **1** and **1** ✅ |
| T2 P0.5-28 migration present | `test -f migrations/1788271200000_category-control-mode.sql` | OK ✅ |
| T3 node_modules | `test -d node_modules/vitest && test -d node_modules/typescript` | OK ✅ |
| T4 13 existing tests | `npx vitest run --pool=threads lib/domain/adherence.test.ts` | **13 passed (13)** ✅ |
| T5 vitest summary format | see below — **verified by experiment, not eyeballed** | ✅ |
| T6/T7/T8 (DB, Plaid, next docs) | declared **NO** | correctly not required — this task is a pure module |

**Branch baseline:** `npx tsc --noEmit` exit 0; `npm test -- --pool=threads` → 19 files / 311 tests;
lint exit 0 with the one pre-existing `scripts/seed-demo.mjs:438` warning.

**Contracts touched — none, confirmed.** `lib/domain/adherence.ts` and its test are `lib/**`, not the
contract surface (BUILD.md §2). The spec's precedent argument checks out: `DriftFinding` lives in
`drift.ts` and `PropertyPnl`/`PnlLine` in `propertyPnl.ts`, neither in `shared/types.ts`. Every column
the module reads already exists on this branch. **G1 will be SKIPPED** unless the implementer reports
otherwise.

`roundCents` — which the Conventions section leans on for per-step rounding — exists at
`lib/budgetMath.ts:10`. Importing it is fine; the spec does not propose changing that file.

## G0 review 1 — draft 1, 2026-09-01 — **FAIL**

One finding. Everything else passed, and the spec applied every lesson carried over from P0.5-28
rather than re-earning it: #2 asserts exit 0 with no exact total (G0-3's lesson), the toolchain table
declares no database for a pure module, and #3 is a genuine anti-N6 pairing rather than a gesture at
one.

### [BLOCK] G0-1 — acceptance #26 is vacuous; it passes unconditionally

```
grep -cE "new Date\(\|Date\.now\(" lib/domain/adherence.ts     → expects 0
```

In an **ERE**, `\|` is a *literal pipe*, not alternation — so the pattern reads "`new Date(`,
then a literal `|`, then `Date.now(`", which no source file contains. Measured against files that
plainly do call the wall clock:

| File | `grep -c 'new Date('` | The spec's pattern |
|---|---|---|
| `lib/drift.ts` | **1** | **0** |
| `lib/logger.test.ts` | **1** | **0** |

The command returns `0` on a module that reads the clock on every line, and `0` is what it expects.
It therefore enforces nothing. This is exactly §7.1's vacuity criterion — *"for each, the orchestrator
can name a plausible broken implementation the command would catch"* — and #26 catches none.

It matters beyond the typo: #26 is the **sole** enforcement of the "no wall clock" convention, and
that convention is what makes the whole suite deterministic. A `new Date()` inside the module would
make the tests depend on the day they run, which every other acceptance command would then inherit.

Fix: correct ERE alternation — `grep -cE 'new Date\(|Date\.now\(' lib/domain/adherence.ts` (measured
above returning `1` on `lib/drift.ts`, so it discriminates). Verify whichever form is chosen against
a file that does call the clock; do not take the corrected pattern on my word either.

### Verified rather than assumed — the rest of the checklist

| Item | Verdict |
|---|---|
| **#3 is a real anti-N6 pairing** | Ran it both ways. All-passing → **1 match**. With one test `.skip`ped → **0 matches**. Vitest inserts a skipped segment that breaks the `$` anchor, so the pairing genuinely catches what a bare name-grep cannot. T5 confirmed by experiment. |
| **Long test names survive the reporter** | #18's name is **329 characters** and #10's is 190. Wrote a probe test file with both, ran `--reporter=verbose`: **both matched in full**, no truncation. Removed the probe. Had they truncated, #18 — the literal exit criterion — would have failed at G2 after the implementer had written it correctly. |
| Verbose reporter on a single-file path | Spot-checked an existing 90-char name → `1`. #4–24's form works. |
| Acceptance commands literal, runnable from root, deterministic | Yes — pure-function tests, no DB, no clock (once #26 actually enforces it) |
| Non-goals stated and specific | 9, naming real files and real line numbers |
| Contracts-touched present | Yes — "none", with the precedent argument, verified above |
| Conventions: sign, rounding, landscape/exclusions, null semantics | All four, plus the $0-budget-month rule and the no-wall-clock rule |
| Failure modes enumerated | 13 |
| Every prose rule carries a negative control | 18 NCs, each mapped to a numbered command |

**On the four open questions**, all four are answered with reasoning rather than deferred, and the
answers are defensible:
1. *Chronic* = every qualifying month under 50% of budget across **≥3** months, with #8 as the
   negative control proving one lean month is not reported and #9 proving one on-budget month breaks
   the streak. A stated threshold and window, as demanded.
2. Breach is per-month, defect is per-window — two distinct finding kinds rather than one blurred shape.
3. **Both detectors range wider than the scored set**; only the headline aggregate is scored-restricted.
   This is the better answer: a `fixed` mortgage budgeted $2,000 that draws $1,400 is a wrong budget
   line whether or not anyone scores it, and §5's "the rest are tracked and reported" says so.
   NC #7/#8 make it falsifiable in both directions.
4. The module computes the even-spread rule for its own inputs but does **not** become the site the
   other implementations call through, and the four are left unmigrated — stated as an explicit
   non-goal rather than left silent, which is what ITEM.md's Q4 asked for. Worth noting the spec
   found a **fourth** site I had missed: `components/BudgetMonthlyGrid.tsx:33-36`'s `monthsBudget()`,
   which actually drives the grid's month math rather than only a label.

N7 and N8 are both carried in as accepted inputs: #19 makes the aggregate null-safe against exactly
the demo seeder's shape, and the wider-ranging detectors mean spend booked to `One time` is now
tracked and reported even though it stays outside the headline.

## G0 review 2 — draft 2, 2026-09-01 — **PASS**. Spec frozen.

### G0-1 fixed, and the fix verified against a discriminating case

The spec-writer corrected #26 to unescaped ERE alternation and — correctly — verified it itself
rather than taking my correction on faith, the same conduct it showed on P0.5-28's psql exit code.
I re-ran it independently:

| File | corrected `new Date\(|Date\.now\(` | broken `new Date\(\|Date\.now\(` |
|---|---|---|
| `lib/drift.ts` (reads the clock) | **1** | 0 |
| `lib/netWorth.ts` (reads the clock) | **1** | — |
| a file containing only `Date.now()` | **1** | **0** |
| `lib/domain/adherence.ts` (does not) | **0** ✅ | 0 |

The last row is the one that matters: the broken form was blind to `Date.now()` as well as to
`new Date(`, so it discriminated nothing in either direction. The corrected form now catches both.

Only #26 changed between drafts; the other 25 commands and every prose section are unchanged, as
instructed.

### Freeze enforcement re-audited — the P-1 fix generalises

P0.5-28's freeze was applied *before* the P-1 hook fix; this one *after*. Probed both, all routes:

| Route | Task 28 | Task 29 |
|---|---|---|
| `Edit` frozen SPEC.md | 2 ✅ | 2 ✅ |
| `Write` frozen SPEC.md | 2 ✅ | 2 ✅ |
| `Bash` `sed -i` | 2 ✅ | 2 ✅ |
| `Bash` `>` redirect | 2 ✅ | 2 ✅ |
| `Bash` `tee` | 2 ✅ | 2 ✅ |
| `Edit` GATES.md (must stay writable) | 0 ✅ | 0 ✅ |

Plus `Edit lib/domain/adherence.ts` → 0, confirming the implementer's own surface stays writable.
**13/13.** `tee` was not among the routes tested when P-1 was fixed; it blocks too, because
`frozenSpecPaths()` feeds the same `mutates()` template set the contract-surface check uses.

### §7.1 checklist

| Item | Verdict |
|---|---|
| Commands literal, runnable from root, deterministic | ✅ pure-function tests, no DB, no clock — and #26 now actually enforces the last of those |
| Referenced scripts, paths, modules exist | ✅ `roundCents` at `lib/budgetMath.ts:10`; `expenseCellStyle`/`monthPct` in `budgetColors.ts`; the four even-spread sites all real |
| Non-goals specific | ✅ 10, naming real files and line numbers |
| Contracts-touched present | ✅ "none", argued from the `DriftFinding`/`PropertyPnl` precedent — **G1 SKIPPED** |
| Conventions: sign, rounding, landscape/exclusions, null semantics | ✅ all four, plus the $0-budget-month rule and no-wall-clock |
| Failure modes enumerated | ✅ 13 |
| No command passes vacuously | ✅ — the one that did is fixed and measured |
| Every prose rule carries a negative control | ✅ 18 NCs |
| Every toolchain row verified by a command I ran | ✅ T1–T5 measured; T6–T8 declared NO |

**Long-name exposure, checked at review 1 and worth keeping in the record:** #18's pinned test name
is **329 characters** and #10's is 190. I wrote a probe test file carrying both and ran
`--reporter=verbose`: neither truncated. Had they, #18 — the literal exit criterion — would have
failed at G2 against a correct implementation.

**Cycle count 0 / 3.** G0 failures do not charge the implementer loop.

## G2 review — 2026-09-01 — **PASS**

All 26 re-run by me, not read from `EVIDENCE.md`.

| # | Result |
|---|---|
| 1 `tsc --noEmit` | exit 0 ✅ |
| 2 full suite | exit 0, **19 files / 332 tests** (311 + 21) ✅ |
| 3 anti-N6 pairing | one match, `Tests  34 passed (34)` — whole file green, nothing skipped ✅ |
| 4–24 pinned names | **all 21 → `1`** ✅ (#4 and #18 also re-run in their exact full pipeline form, both `1`) |
| 25 `budgetColors` in module | prints `0` ✅ |
| 26 wall clock in module | prints `0` ✅ |

**On #25/#26's exit code.** Both exit `1`, and that is the passing outcome — `grep -c` exits 1 when
the count is zero, and the spec's Expected column is the *printed count*, `0`. The implementer
flagged this unprompted rather than letting me read two failures at G2. Recorded so no later re-run
misreads it.

### Verified structurally rather than accepted from the report

| Claim | How I checked | Result |
|---|---|---|
| No second copy of the three shared conjuncts | `grep -n` each conjunct in the module | Each appears **exactly once**, inside `isTrackedCategory` ✅ |
| `isScoredCategory` delegates rather than duplicating | read both function bodies | `isTrackedCategory(category) && category.control_mode === 'discretionary'` ✅ |
| Module does not import the incumbent | `grep -nE '^import\|require\('` | Only `../budgetMath` (`roundCents`, `MONTHS_PER_YEAR`) and a `type` import ✅ |
| No `Infinity`/`NaN` in code | `grep -nE 'Infinity\|NaN'` | 4 hits, **all in comments** (93, 140, 142, 347); none in an expression ✅ |
| `lib/budgetMath.ts` untouched (non-goal) | `git diff --stat` | unmodified; `MONTHS_PER_YEAR` pre-existed at line 7 ✅ |
| P0.5-28's 13 tests present and unmodified | extracted every `it()` name from `HEAD` and from the working tree, sorted, `comm` | **all 13 present**; 34 total. The only line removed from the file is the `import` statement, widened for the new symbols — **no test body changed** ✅ |
| Diff confined to the declared surface | `git status --short` | `lib/domain/adherence.ts`, `lib/domain/adherence.test.ts`, plus `plan/` (mine). **Zero out-of-scope files** ✅ |

### Implementer conduct

It self-reported three things it did not have to: that **#25 caught a real defect in its first
draft** (the module named `budgetColors` three times in explanatory comments — `grep -c` is a
literal-string match, not an import check, so it failed at `3`); that #25/#26 exit 1 on a zero count;
and two judgement calls the spec left open. It also added **two unpinned tests** beyond the 19
required, one of which covers a divide-by-zero **#19 does not reach** — a *scored* finding sitting on
a $0-budget month, where the denominator is zero even though the scored set is non-empty. That path
would have shipped untested. Acceptance #2's deliberate refusal to pin an exact total (G0-3's lesson
from P0.5-28) is what made adding them possible.

**Carried to G3 as a question, not a finding:** #25 is a literal-string grep, and the fix was to stop
*naming* the incumbent in comments rather than to change any dependency. The substantive rule — no
import, no `monthPct`, no `Infinity` — I verified independently above and it holds. But the command
as frozen would also pass a module that imported `budgetColors` under an aliased path, and it now
mildly penalises explanatory prose. Worth the reviewer's attention.

**Cycle count 0 / 3.**

## G3 review — 2026-09-01 — **PASS** (ACCEPT_WITH_NITS)

29 hypotheses, 24 refuted outright, **0 BLOCK**, 0 scope violations, 10 nits. The log went after the
sign trap across every arithmetic site, both threshold boundaries, the `$0`-budget interactions in
combination, `pg`'s NUMERIC-as-string behaviour against the declared types, and — most valuably —
**the gate commands themselves**, including two of its own pinned tests.

### All 5 INCONCLUSIVE items executed. Every prediction was correct.

| Item | What I ran | Predicted | Measured |
|---|---|---|---|
| **I1** — does #22 pin *variance* rounding? | Mutated `:272` to `variance: actual - budgeted` | still 34 passed | **34 passed** — the mutation is invisible |
| **I2** — is the 50% boundary asserted? | Mutated `:320` to `ratio <= CHRONIC_UNDERSPEND_RATIO` | still 34 passed | **34 passed** — the boundary is unpinned |
| **I3** — does `isTrackedCategory` have a consumer? | repo-wide grep | only lines 62/64/232/293, no importer, no direct test | **exactly that** |
| **I4** — out-of-range month with a schedule | Throwaway probe, `{month: 12}` on a December-only schedule | breach `budgeted 100`, `variance 1050`, `ratio 11.5` | **`{"kind":"breach","month":12,"budgeted":100,"actual":1150,"variance":1050,"ratio":11.5}`** |
| **I5** — headline scale mixing | Throwaway probe, $110 in Jan + $90 × 11 | `varianceRatio: 0.1` (+10%) on a category actually 8.3% under | **`{"budgeted":100,"actual":110,"variance":10,"varianceRatio":0.1}`** |

Module restored byte-identical after both mutations (`diff` against a pre-mutation copy), suite back
to 34 passed, both sites confirmed at their correct form. Both probes deleted.

**I5 is the finding that matters.** A scored category that spent $1,100 against $1,199.88 — 8.3%
**under** — produces a headline reading **+10% over**, because the aggregate sums only the months
that produced findings and mixes month-scale `budgeted` (a breach) with window-scale `budgeted` (a
defect) in one denominator. It is inside the frozen spec, which constrains only the `null` case, so
not a BLOCK. But it is precisely the "right for the wrong reason" hazard this phase exists to
eliminate, and step 31 is the step that would wire it to a dashboard.

**I1 and I2 are both gate weaknesses, not code defects.** The implementation is correct at both
sites; nothing in the suite would notice if it stopped being. I2's fix is one fixture at exactly 50%.
I1's is harder — once `budgeted` and `actual` are each cent-rounded, `actual − budgeted` is
mathematically cent-exact, so the spec's own vacuity note for #22 overstated what that command could
ever catch.

**On the orchestrator's #25 question, answered directly:** no, the module lost nothing a reader
needed. `monthPct` and its `Infinity` return are still named at `:92` and `:142`, and `monthPct` is
unique to `lib/budgetColors.ts` repo-wide, so the pointer survives in a *more* specific form than the
filename. The reviewer's separate point stands and is recorded as N16: #25 is one filename grep doing
three jobs, and it cannot see a `monthPct` call, an `Infinity` literal, or an aliased import.

**Cycle count 0 / 3** — no BLOCK, no rework charged.

## G4 review — 2026-09-01 — **PASS**

| Check | Result |
|---|---|
| Full suite | **19 files / 332 tests** (311 + 21) |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0; the one pre-existing `seed-demo.mjs:438` warning |
| `npx next build` | exit 0 |
| Inherited migration round-trip (branch stacked on P0.5-28) | `down` + `up` clean, both constraints back |
| Build regenerated `" 2"` artifacts? | **0** this time — the duplication is intermittent, not deterministic |
| INCONCLUSIVE items | all 5 executed at G3 |
| Diff surface | `lib/domain/adherence.ts`, `lib/domain/adherence.test.ts`, plus `plan/` (orchestrator's) |

**Cycle count 0 / 3.** Second consecutive task through G0–G4 with no BLOCK at any gate and no rework
cycle charged.

**Not merged.** G4 makes this mergeable. The branch is stacked on `p0.5-28/category-control-mode`,
which is itself unmerged — so merging this implies a decision about that one first.
