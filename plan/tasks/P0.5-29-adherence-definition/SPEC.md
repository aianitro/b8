# P0.5-29-adherence-definition — a two-sided variance module that tells overspend and chronic underspend apart, and says so out loud
**Roadmap item:** ROADMAP.md §5 Phase 0.5 step 29 — `plan/tasks/P0.5-29-adherence-definition/ITEM.md`
**Status:** DRAFT 2 — **FROZEN@G0** 2026-09-01 (draft 1 failed G0 on one vacuous command; see `GATES.md`)
**Author:** spec-writer

## Goal
`lib/domain/adherence.ts` — the file P0.5-28 created and that today exports exactly one function, `isScoredCategory` — gains a two-sided budget-variance detector, in the `Input[] → Finding[]` shape `lib/domain/drift.ts` and `lib/domain/propertyPnl.ts` already use. Given a category's per-month budgeted and actual spend, the module tells apart two structurally distinct outcomes and never collapses them into one: an **overspend breach**, evaluated per month, and a **chronic-underspend defect** — a category that draws far less than its budget in *every* month of a multi-month window, which is a wrong budget line, not good behaviour. Both detectors range over every operational, non-excluded, non-income category — wider than the scored set `isScoredCategory` defines — because a `fixed` mortgage budgeted $2,000 that draws $1,400 every month is still a wrong budget even though it is never scored; each finding instead carries whether it counts toward the scored-set headline. The module also exposes a scored-set aggregate that reads `null`, never `0` or `NaN`, when no finding in a given input belongs to the scored set — the divide-by-zero this app's own demo dataset produces today (P0.5-28 NITS N7). The exit test: two fabricated categories, one with sustained overspend and one drawing 24% of its budget in every month of a year (the roadmap's own worked example), produce a breach finding and a defect finding respectively, while `lib/budgetColors.ts`'s `expenseCellStyle` — the incumbent — renders every one of the chronically-under category's twelve months as an on-budget green cell, proving the new module expresses something the existing per-cell colour threshold structurally cannot.

## Non-goals
- **No dashboard, route, or component renders any finding this module produces.** No page reads `lib/domain/adherence.ts`'s new exports. Wiring a headline into `app/budget/page.tsx` or `components/BudgetMonthlyGrid.tsx` is later work.
- **No change to `lib/budgetColors.ts`.** The new module does not import it, call it, or alter its thresholds — it is the incumbent this task must structurally beat, not refactor. (The test file *may* import it, read-only, purely to prove the contrast in acceptance #18.)
- **No change to `isScoredCategory`'s or `ScorableCategory`'s observable behaviour.** This task extends the same file with new exports; it does not rewrite the existing predicate. P0.5-28's 13 existing tests are unmodified and continue to pass verbatim (two are pinned again as a regression check — acceptance #23–24). Refactoring shared conjuncts into a common helper both the old and new logic call is acceptable; rewriting `isScoredCategory`'s own tests, or changing what they assert, is not.
- **No off-cycle-specific finding kind.** ROADMAP.md §5 step 30 makes off-cycle spend "a breach in its own right," as its own concept. This task's breach detector treats a $0-budgeted month with nonzero spend as an ordinary breach (see Conventions), which does not contradict step 30's future refinement — it just doesn't anticipate it.
- **No migration of the four existing even-spread implementations** — `app/api/chat/route.ts:66`, `app/budget/page.tsx:25`, `components/BudgetMonthlyGridClient.tsx:29`'s label, and `components/BudgetMonthlyGrid.tsx:33-36`'s `monthsBudget()`, which drives the grid's month-budget math rather than only a label. This module computes the even-spread rule itself, for its own inputs, because a pure function accepting `monthly_amounts: number[] | null` cannot avoid deciding what a `null` schedule means — but it does not become the site the other four call through, and none of those four files changes here. Both directions are defensible; leaving it unstated is not, per `ITEM.md` Q4. This task takes the narrower option and says so.
- **No fix to `scripts/seed-demo.mjs`.** P0.5-28 NITS N7 traced the empty-scored-set problem to the seeder never setting `control_mode`. This task does not touch the seeder; it only guarantees its *own* aggregate is null-safe against exactly that shape of input (acceptance #19).
- **No change to `One time`'s seed classification or any other row P0.5-28 seeded.** NITS N8 is carried in as a stated, accepted input, not re-litigated. This task's wider-ranging detectors mean spend booked to `One time` *is* tracked and reported (as an unscored finding) even though it stays outside the headline — an incidental improvement in visibility, not a fix to N8's root cause.
- **No persistence, no new API route, no scheduled job, no email delivery** (steps 31–33 are later).
- **No transaction-level or account-level reads.** The module takes pre-aggregated per-month actual spend, the same way `drift.ts` takes `ledgerBalance`/`plaidBalance` rather than raw rows. Deriving that aggregate from `transactions` (respecting `t.hidden = FALSE` and `a.track_transactions = TRUE`, as the existing budget-grid SQL does) is a caller's job.
- **No wall-clock reads inside the module.** No "current month," "months elapsed," or "today" is computed internally; every month the detectors evaluate is supplied by the caller.

## Contracts touched
| File | Change | Class (§9.2) |
|---|---|---|
| *(none)* | — | — |

`lib/domain/adherence.ts` and its test are `lib/**`, not the contract surface (BUILD.md §2). The new finding types live inside `lib/domain/adherence.ts` itself, matching precedent: `DriftFinding` lives in `drift.ts`, `PropertyPnl`/`PnlLine` in `propertyPnl.ts` — neither in `shared/types.ts`. Every column the module reads (`control_mode`, `landscape`, `exclude_from_budget`, `is_income`, `monthly_amounts`, `annual_budget`) already exists on this branch via P0.5-28. **G1 is skipped.** If the implementer finds a contract change is genuinely required, that is a finding to report loudly, not absorb.

## Conventions this task must honor
- **Sign:** Not the ledger's signed-transaction convention (positive = outflow). This module compares two non-negative dollar magnitudes per category per month — `budgeted[m]` and `actual[m]` — matching how `annual_budget`/`monthly_amounts` are stored and how the existing budget-grid SQL aggregates expense spend as a positive figure. **Variance is `actual[m] − budgeted[m]`**, always in that order: positive variance is overspend (breach), negative is underspend (defect). Reversing the subtraction silently inverts breach and defect — this task's version of the sign trap BUILD.md §10.3 names.
- **Rounding:** Per step, not once at the end — matching `propertyPnl.ts` and `drift.ts`. Each month's `variance[m]` is rounded to cents (`roundCents`, `lib/budgetMath.ts:10`) individually; a window aggregate sums already-rounded per-month values and re-rounds the sum, never sums raw floats and rounds once. Acceptance #22 exists to catch the shortcut.
- **Landscape + exclusions:** Three of `isScoredCategory`'s four conjuncts — `landscape = 'operational'`, `exclude_from_budget = FALSE`, `is_income = FALSE` — gate whether **either** detector produces a finding *at all*. A capital, excluded, or income category never produces a breach or defect finding, regardless of variance (#15–17). The fourth conjunct, `control_mode = 'discretionary'`, does **not** gate finding production — it only sets the `scored` flag on a finding the first three already allowed through. This resolves `ITEM.md` Q3: both detectors range over every tracked operational category; only the headline aggregate is scored-set-restricted. `hidden` is a `transactions` flag this module never sees — that exclusion is the caller's responsibility upstream.
- **Null semantics:** `budgeted[m]` is never null — `annual_budget` is `NOT NULL`, and a present `monthly_amounts` is always a full 12-length array. The one deliberate null is the scored-set aggregate: `null`, never `0`, when zero findings belong to the scored set (#19) — the "—" vs. wrong-zero distinction BUILD.md §10.3 names, applied to a count.
- **The $0-budget month:** `lib/budgetColors.ts`'s `monthPct` returns `Infinity` when off-cycle; this module must never produce `Infinity` or `NaN`. A month with `budgeted[m] === 0`: (a) if `actual[m] > 0`, produces an ordinary breach finding with no ratio computed — spend against a zero budget is unambiguous overspend, no division needed; (b) is excluded entirely from the chronic-underspend window, whether or not it has spend — "underspend relative to a $0 budget" has no baseline, and reading $0/$0 as "fully underspent" would corrupt the streak with a month that says nothing about behaviour.
- **No wall clock:** the module never calls `new Date()` or `Date.now()`. Which months constitute the window is entirely the caller's input; tests pin fixed fabricated month arrays. Acceptance #26 statically confirms it.

## Toolchain prerequisites
| # | Assumption | Required? | Verification command | Measured |
|---|---|---|---|---|
| T1 | Branch stacked on `p0.5-28/category-control-mode` — `control_mode`, `ControlMode`, `isScoredCategory` exist | **yes** | `grep -c "control_mode: ControlMode" shared/types.ts && grep -c "^export function isScoredCategory" lib/domain/adherence.ts` | `1` and `1` ✅ |
| T2 | P0.5-28's migration present (context only; no DB used) | **yes** | `test -f migrations/1788271200000_category-control-mode.sql && echo OK` | OK ✅ |
| T3 | `node_modules`, vitest, typescript | **yes** | `test -d node_modules/vitest && test -d node_modules/typescript && echo OK` | OK; baseline tsc 0, 19 files / 311 tests ✅ |
| T4 | 13 existing tests, passing, none skipped | **yes** | `npx vitest run --pool=threads lib/domain/adherence.test.ts` | **13 passed (13)** ✅ |
| T5 | vitest v4 prints `Tests  N passed (N)` with no skipped segment only when nothing was skipped | **yes** — load-bearing for #3 | `npx vitest run --pool=threads lib/domain/adherence.test.ts 2>&1 \| grep -E "Tests +[0-9]+ passed \([0-9]+\)$"` | **confirmed by experiment at G0**: all-passing → 1 match; one test `.skip`'d → 0 matches ✅ |
| T6 | Postgres | **NO** — pure-function tests | n/a | n/a |
| T7 | Plaid credentials / network | **NO** | n/a | n/a |
| T8 | `node_modules/next/dist/docs/` | **NO** — touches no Next-facing code | n/a | n/a |

**Regex note (G0-1 fix).** Draft 1's #26 was `grep -cE "new Date\(\|Date\.now\("`. In an ERE, `\|` is a *literal pipe*, not alternation — the pattern read "`new Date(` then a literal `|` then `Date.now(`", which no source file contains, so it returned `0` unconditionally and enforced nothing. Corrected to unescaped `|`. Verified independently by both spec-writer and orchestrator: the corrected pattern returns `1` on `lib/drift.ts` and `lib/netWorth.ts` (files that read the clock) and `0` on `lib/domain/adherence.ts`; the broken form returns `0` even on a file containing only `Date.now()`, proving it discriminated nothing.

## Acceptance commands
#4–24 pin one required test each by exact description via the verbose reporter; **#3 is the anti-N6 pairing** (P0.5-28 NITS N6: a name-grep alone cannot tell a passing test from a skipped one) — it asserts the whole file passed with nothing skipped, so #4–24's presence-only grep can only mean "passed."

| # | Command | Expected |
|---|---|---|
| 1 | `npx tsc --noEmit` | exit 0 |
| 2 | `npm test -- --pool=threads` | exit 0 (no exact total pinned) |
| 3 | `npx vitest run --pool=threads lib/domain/adherence.test.ts 2>&1 \| grep -E "Tests +[0-9]+ passed \([0-9]+\)$"` | one matching line |
| 4 | `… --reporter=verbose lib/domain/adherence.test.ts \| grep -cF "a month where actual spend exceeds its budgeted amount produces a breach finding for that month"` | `1` |
| 5 | `… \| grep -cF "a month at or under its budgeted amount never produces a breach finding"` | `1` |
| 6 | `… \| grep -cF "a month with zero budgeted amount and nonzero spend produces a breach finding without computing a spend-to-budget ratio"` | `1` |
| 7 | `… \| grep -cF "spend under 50% of budget in every qualifying month of a window of at least three such months produces a single chronic-underspend defect finding for that category"` | `1` |
| 8 | `… \| grep -cF "a single lean month never produces a defect finding on its own — chronic underspend requires at least three qualifying months of data"` | `1` |
| 9 | `… \| grep -cF "one on-budget or over-budget month among otherwise-lean months breaks the chronic streak and no defect finding is produced"` | `1` |
| 10 | `… \| grep -cF "a month with zero budgeted amount is excluded from the chronic-underspend window entirely, whether or not it has spend, rather than being read as either perfectly adhered or fully underspent"` | `1` |
| 11 | `… \| grep -cF "a fixed category with sustained overspend produces a breach finding marked not scored"` | `1` |
| 12 | `… \| grep -cF "a fixed category with chronic underspend produces a defect finding marked not scored — a wrong fixed budget line is still a wrong budget"` | `1` |
| 13 | `… \| grep -cF "a variable-necessary category with chronic underspend produces a defect finding marked not scored, tracked the same as fixed rather than as a softer case of it"` | `1` |
| 14 | `… \| grep -cF "a discretionary category with chronic underspend produces a defect finding marked scored"` | `1` |
| 15 | `… \| grep -cF "a capital-landscape category never produces a finding of either kind, regardless of variance, even when its control_mode is discretionary"` | `1` |
| 16 | `… \| grep -cF "an exclude_from_budget category never produces a finding of either kind, regardless of variance"` | `1` |
| 17 | `… \| grep -cF "an is_income category never produces a finding of either kind, regardless of variance"` | `1` |
| 18 | `… \| grep -cF "one category with sustained overspend and one category with chronic underspend at the roadmap's own 24%-of-budget shape produce a breach finding and a defect finding respectively in the same input, and lib/budgetColors.ts's expenseCellStyle renders every one of the chronically-under category's months as an on-budget green shade"` | `1` |
| 19 | `… \| grep -cF "the scored-set headline is null, not zero or NaN, when no finding in the input belongs to the scored set"` | `1` |
| 20 | `… \| grep -cF "an explicit monthly_amounts schedule is used verbatim for each month's budgeted amount, even when it disagrees with annual_budget divided by twelve"` | `1` |
| 21 | `… \| grep -cF "a null monthly_amounts schedule falls back to annual_budget divided by twelve, rounded to cents, as every month's budgeted amount"` | `1` |
| 22 | `… \| grep -cF "variance is rounded to cents at each month rather than left to accumulate as float dust across a window"` | `1` |
| 23 | `… \| grep -cF "includes an operational, non-excluded, non-income category classified discretionary in the scored set"` | `1` — P0.5-28's test, unmodified |
| 24 | `… \| grep -cF "excludes a capital-landscape category from the scored set even when its control_mode is discretionary"` | `1` — P0.5-28's test, unmodified |
| 25 | `grep -c "budgetColors" lib/domain/adherence.ts` | `0` |
| 26 | `grep -cE "new Date\(|Date\.now\(" lib/domain/adherence.ts` | `0` — corrected at G0-1 |

The `…` in #4–24 abbreviates `npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts` for width; each command is that prefix piped to its own `grep -cF`.

**Vacuity check, per command.** #1/#2 prove nothing broke, not that anything shipped. #3 is load-bearing: without it, #4–24 could not distinguish passing tests from `.skip`'d ones — a stub that throws on every call would still satisfy them. #4–6: a detector using `>=` instead of `>`, or reusing `monthPct`'s `Infinity` for a $0-budget month, fails #6. #7–10: no minimum-months floor, or comparing an average instead of every month, passes #7 but fails #8 or #9; not special-casing $0-budget months fails #10 by `Infinity`/`NaN` or a false-positive. #11–17: a detector quietly restricted to `isScoredCategory`'s four conjuncts — the Q3 blind spot — passes #14–17 but fails #11–13, since `fixed`/`variable-necessary` would produce no finding at all. #18 is the literal exit criterion: a stub checking percentages without a multi-month window fails to produce the defect, and the `expenseCellStyle` assertion is what discriminates "a different number" from "something a colour cell cannot express." #19: an aggregate without a zero-guard produces `NaN`. #20/#21: always using `annual_budget / 12` fails #20; never falling back fails #21. #22: summing unrounded floats and rounding once disagrees on a fixture engineered to expose it. #23/#24: a diff rewriting `isScoredCategory` while changing its test names fails these pins. #25: reaching for `monthPct` internally reintroduces `Infinity` and couples the module to the incumbent. #26: any clock call makes the suite non-deterministic — and, per the G0-1 fix, this is now measured to catch that rather than merely assert it.

## Negative controls
| # | Rule | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | Variance is `actual − budgeted`, not reversed | A month over budget classified as breach, not defect | #4 |
| 2 | On/under-budget months never breach | A month at exactly 100% or under | #5 |
| 3 | $0-budget-with-spend needs no ratio, never `Infinity`/`NaN` | `budgeted = 0`, `actual > 0` | #6 |
| 4 | Chronic requires **every** qualifying month under threshold, not an average | One on/over-budget month among lean ones | #9 |
| 5 | Chronic requires **at least three** qualifying months | A single lean month, however far under | #8 |
| 6 | $0-budget months never count toward or against the window | `budgeted = 0` inside an otherwise-chronic window | #10 |
| 7 | The defect detector ranges wider than the scored set | A `fixed` category with chronic underspend | #12 |
| 8 | The breach detector ranges wider, symmetrically | A `fixed` category with sustained overspend | #11 |
| 9 | `variable-necessary` tracked the same as `fixed`, not softer | A `variable-necessary` category with chronic underspend | #13 |
| 10 | Capital never produces a finding, even if `discretionary` | A capital category with extreme variance | #15 |
| 11 | Excluded categories never produce a finding | `exclude_from_budget = TRUE` with extreme variance | #16 |
| 12 | Income categories never produce a finding | `is_income = TRUE` with extreme variance | #17 |
| 13 | The aggregate is `null`, never `0`, on an empty scored set | A fixture shaped like the demo seed — all `fixed` | #19 |
| 14 | `monthly_amounts`, when present, wins over the even spread | A schedule disagreeing with `annual_budget / 12` | #20 |
| 15 | Rounding per month, not once at the end | A window engineered to expose float drift | #22 |
| 16 | `isScoredCategory`'s behaviour unchanged | P0.5-28's two representative tests, verbatim | #23–24 |
| 17 | The module never imports the incumbent | Any `budgetColors` import in `adherence.ts` | #25 |
| 18 | No wall-clock read inside the module | Any `new Date()`/`Date.now()` in `adherence.ts` | #26 |

## Evidence required
- Verbatim output of all 26 acceptance commands in `EVIDENCE.md`.
- A worked, end-to-end trace (prose) of the roadmap's own example — $500 budgeted, $120 drawn, twelve months — showing `budgeted[m]`, `actual[m]`, `variance[m]` per month, that all twelve are excluded from breach, that the window qualifies as chronic, and the finding's `scored` flag under each of `discretionary`/`fixed`/`variable-necessary`.
- A fabricated fixture table covering every combination exercised by #11–17 (three `control_mode` values × breach/defect × the three exclusion gates), not just the ones spot-checked by name.
- Diff-level confirmation that `isScoredCategory`'s existing 13 tests are present unmodified, beyond the two re-pinned by #23–24.
- Confirmation that nothing outside `lib/domain/adherence.ts` and its test changed.

## Failure modes to test
- Variance sign inverted (`budgeted − actual`), silently swapping breach and defect.
- Either detector quietly restricted to the scored set, reproducing the blind spot §5's text warns against for `fixed`/`variable-necessary`.
- `variable-necessary` treated as a softer case of `discretionary` rather than identically unscored to `fixed`.
- Chronic computed as an *average* under threshold instead of *every* month under threshold — lets one wildly-under month drag an on-budget category into a false defect, or lets an over-budget month hide inside an average still reading "chronic."
- No minimum-months floor, so one quiet month reads as chronic.
- `monthPct`/`Infinity` reused directly, reintroducing a non-finite value.
- A $0-budget, $0-spend month misread as "0% spent" and folded into the window instead of excluded.
- Rounding once at the end, letting float dust cross the 50% or exceeds-budget boundary.
- The aggregate computed as `scoredCount / totalCount` with no zero-guard, producing `NaN` or a silently coerced `0`.
- A second copy of `isScoredCategory`'s three shared conjuncts in the new detector instead of reuse — the drifting-definitions hazard, on the very predicate P0.5-28 exists to have one definition of.
- `monthly_amounts` silently ignored in favour of always computing `annual_budget / 12`.
- A `new Date()`/`Date.now()` call for "current month," making the suite depend on the day it runs.
- `isScoredCategory` rewritten in a way that drops or renames one of its 13 existing tests.

## Rollback
Pure module extension — no migration, no schema, no data. Revert is `git revert` of this task's commit(s), removing the new exports and tests and restoring both files to their exact P0.5-28 state. `isScoredCategory` and its 13 tests are untouched in either direction, so reverting carries zero risk to P0.5-28's shipped behaviour. No CSV backup applies — no data was written.
