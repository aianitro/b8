# P0.5-29a-headline-scope — the scored headline measures the categories it names, and its sign says which direction
**Roadmap item:** addendum to ROADMAP.md §5 Phase 0.5 step 29 — `plan/tasks/P0.5-29a-headline-scope/ITEM.md`
**Status:** FROZEN — G0 passed 2026-09-01, `.frozen` set
**Author:** spec-writer

## Goal

`scoredHeadline` in `lib/domain/adherence.ts` stops describing the findings it was handed and starts describing the **position of the scored categories** — every month the caller supplied for every category `isScoredCategory` admits, whether or not that month produced a finding. Today it ranges over `AdherenceFinding[]`, which makes eleven compliant months invisible and adds a breach's month-scale `budgeted` to a defect's window-scale `budgeted` in one denominator; the measured consequence (NITS N11, confirmed by execution at P0.5-29's G4) is a headline of **+10% over** for a category that is **8.3% under**. After this task, one scored category budgeted evenly at $99.99/month that drew $110 in January and $90 in each of the other eleven months reports `budgeted: 1199.88`, `actual: 1100`, `variance: -99.88`, `varianceRatio ≈ -0.0832` — negative meaning under budget — instead of `budgeted: 100, actual: 110, varianceRatio: 0.1`. N12 ships in the same change, because ranging over categories is what makes it expressible: `null` narrows to mean **"no category in this input is in the scored set"** and nothing else, so a month of flawless adherence reports a real headline at variance `0` rather than the "—" a dashboard would render today. `isScoredCategory` and `detectAdherence` keep their observable behaviour exactly; the only observable change outside `scoredHeadline` is that its parameter type and the shape of `ScoredHeadline` change, and it has no callers in the repo today (verified: `grep -rn scoredHeadline app components lib shared scripts .claude` matches only `lib/domain/adherence.ts` and its own test), so ROADMAP step 31 writes the first real caller against the corrected surface rather than the defective one.

## Non-goals

- **No dashboard, route, component, or API surface renders the headline.** Step 31 wires it; this task does not. No file outside `lib/domain/adherence.ts` and `lib/domain/adherence.test.ts` is edited by the implementer.
- **No change to `isScoredCategory`, `ScorableCategory`, `isTrackedCategory`, `detectAdherence`, `AdherenceInput`, `MonthSpend`, `MonthVariance`, `BreachFinding`, `ChronicUnderspendFinding`, or `AdherenceFinding`** — not their signatures, not their outputs, not their documented semantics. Every one of P0.5-29's 32 non-headline tests passes verbatim, unmodified. Refactoring a shared internal helper is acceptable; changing what any of those exports observably does is not.
- **N19 is out of scope, deliberately.** `budgetedForMonth` keeps `roundCents(annual_budget / 12)` per month, so a $1,000 annual budget with no schedule still totals **$999.96** across twelve months while `components/BudgetMonthlyGrid.tsx`'s `monthsBudget()` totals `$1,000.00` for the same category. Neither that function nor the grid changes here. **What the headline inherits as a result:** its denominator is the rounded per-month schedule, so the quoted percentage is computed against $999.96, not $1,000.00 — a denominator 0.004% low, which biases the ratio 0.004% *relative* toward "under". On this task's binding fixture that is the difference between −8.324% and −8.333%; both present as "≈ 8.3% under", so the divergence is below the resolution of anything a surface would print. Bringing N19 in would mean either changing `budgetedForMonth` (which would invalidate P0.5-29's acceptance #21/#22 — tests that pin *per-month budget rounding*, not headline arithmetic, and which ITEM.md's "except where a test pins the old headline arithmetic" carve-out therefore does not cover) or migrating four incumbent even-spread implementations outside this module. Both exceed this addendum's mandate. Acceptance #16 pins the inherited $999.96 figure so the inheritance is measured rather than assumed.
- **No input validation added.** NITS N18 (duplicate `month` entries silently inflating a window — and now also the headline denominator) and N15 (an out-of-range `month` silently substituting the even spread — and now also contributing that substituted budget to the denominator) are carried forward unchanged as caller-contract boundaries. Both get worse in blast radius under this change and neither is fixed here; step 31's caller contract owns them.
- **No wall clock, no "months elapsed", no "current month".** The tempting shortcut for "the actual position" is to range over the months of the year so far. The months the headline measures are exactly the entries the caller put in `row.months` — nothing else. Acceptance #19 statically forbids a clock read.
- **No coupling to `lib/budgetColors.ts`.** Unchanged from P0.5-29: no import, and `monthPct`'s `Infinity` has no business in this arithmetic. Acceptance #18.
- **No `scripts/seed-demo.mjs` change.** P0.5-28 NITS N7 is still true (every seeded row is `fixed`); this task only guarantees the headline answers `null` on exactly that shape.
- **No new module, no new file.** The corrected function stays `scoredHeadline`, exported from `lib/domain/adherence.ts`, and its tests stay in `lib/domain/adherence.test.ts` — the only paths matched by `vitest.config.mts`'s `lib/**/*.test.ts` glob for this module.
- **No persistence, no route, no scheduled job, no email.**

## Contracts touched

| File | Change | Class (§9.2) |
|---|---|---|
| *(none)* | — | — |

`lib/domain/adherence.ts` is `lib/**`, not the contract surface (BUILD.md §2). `ScoredHeadline` lives in the module itself, matching `DriftFinding` in `drift.ts` and `PropertyPnl` in `propertyPnl.ts`. Every column read (`landscape`, `exclude_from_budget`, `is_income`, `control_mode`, `annual_budget`, `monthly_amounts`) already exists. `scoredHeadline` and `ScoredHeadline` have **no importer anywhere in the repo** outside their own test, so the signature change is not a breaking change to any shipped surface. **G1 is skipped.** If the implementer finds a contract change genuinely required, that is a finding to report loudly, not absorb.

## The four open questions, decided

**Q1 — what `scoredHeadline` takes.** It takes `AdherenceInput[]`: the **same array `detectAdherence` takes**, one parameter, nothing else.

```
export function scoredHeadline(rows: AdherenceInput[]): ScoredHeadline | null
```

Stated as observable fact rather than design: (a) a call passing an `AdherenceFinding[]` must fail to typecheck — acceptance #14 makes `npx tsc --noEmit` prove it, via a `@ts-expect-error` directive that TypeScript reports as unused (TS2578) if the old signature survives; (b) for any `rows`, `scoredHeadline(rows)` and `detectAdherence(rows)` are two independent reads of one input, so a caller cannot feed one a filtered or reordered version of the other. The two rejected alternatives and why: **`(rows, findings)`** puts two sources of truth in one call and nothing forces the findings to have come from those rows — the caller who filters findings before passing them re-creates exactly the divergence this task exists to close; **returning the headline from `detectAdherence`** changes `detectAdherence`'s observable output, which ITEM.md requirement 4 forbids outright. Caller-facing consequence for step 31: `const findings = detectAdherence(rows); const headline = scoredHeadline(rows);` — one array, two calls, no ordering dependency and no intermediate to get wrong.

**Q2 — the counts stay finding-scoped, and the struct says so.** `breachCount` and `defectCount` remain counts of *scored findings* (a breach is one month; a defect is one category-window) and are meaningful only that way. `budgeted`, `actual`, `variance` and `varianceRatio` become *category-scoped*: sums over every supplied month of every scored category. One struct therefore carries two domains, and it must declare that at the type surface in two enforceable ways:

1. **`findingCount` is removed.** It is the count-shaped instance of the same defect — it adds a month-scale count to a window-scale one, so six breach months count six while a twelve-month defect counts one, and nothing legitimate consumes the sum. A caller that wants a total adds `breachCount + defectCount` and owns that decision. Acceptance #21 (`grep -c "findingCount" lib/domain/adherence.ts` → `0`) pins its absence, because `tsc` cannot catch a field nobody reads.
2. **`scoredCategoryCount: number` is added** — how many rows of the input `isScoredCategory` admitted, and therefore what the money figures range over. It is ≥ 1 whenever the struct is non-null, taking over the "at least 1 by construction" guarantee `findingCount` used to carry. Its presence beside two finding counts is what makes the two domains legible from the type alone rather than from a comment, and acceptance #7 pins a fixture where all three differ (2 categories, 3 breaches, 1 defect) so a struct that quietly collapses them fails.

The full shape after this task:

```
export interface ScoredHeadline {
  scoredCategoryCount: number;   // category-scoped: rows isScoredCategory admitted; >= 1 by construction
  breachCount: number;           // finding-scoped: scored breach findings (one per month)
  defectCount: number;           // finding-scoped: scored chronic-underspend findings (one per category)
  budgeted: number;              // category-scoped: every supplied month of every scored category
  actual: number;                // category-scoped
  variance: number;              // category-scoped, actual - budgeted
  varianceRatio: number | null;  // category-scoped; null only when budgeted === 0
}
```

**Q3 — `varianceRatio` when scored categories exist but total budgeted is $0: `null`.** Reachable two ways under the new ranging — a scored category with `months: []` (no observations loaded yet), and a scored category all of whose supplied months sit on `$0` schedule entries (the existing off-cycle fixture). `null`, because a percentage of $0 has no baseline: it is the identical rule `MonthVariance.ratio` already applies at `budgeted > 0 ? actual / budgeted : null`, and a second, different answer for the same question one level up is precisely the drifting-definitions hazard this module exists to avoid. `0` is the wrong available answer — it reads "on budget" for a category that drew $75 against nothing budgeted. Crucially, this `null` no longer carries N12's ambiguity, because it now sits **one level below** the struct's own null: `ScoredHeadline | null` being `null` means "no scored category exists"; a non-null struct with `varianceRatio: null` means "scored categories exist, and their supplied months budgeted nothing to be a percentage of" — and `variance` is still a real signed dollar figure in that struct saying what happened. Two nulls, two levels, two distinct statements, each with its own acceptance command (#5 and #12).

**Q4 — N19 stays out of scope.** Rationale and inherited consequence are stated in full under Non-goals above, and the inheritance is pinned by acceptance #16 rather than left as prose.

## Conventions this task must honor

- **Sign — this is the convention the defect exploited.** All magnitudes are non-negative dollar amounts, not the ledger's signed-transaction convention. `variance = actual − budgeted`, always in that order, at every level: per month, per category, and in the headline. **Negative variance means UNDER budget; positive variance means OVER budget.** `varianceRatio = variance ÷ budgeted` and therefore carries the same sign as `variance`: `-0.0832` is "8.3% under", `+0.1` is "10% over". The module **never emits an unsigned magnitude and never emits an inverted ratio** — not `Math.abs(...)`, not `budgeted / actual`, not `1 − actual / budgeted`. An unsigned percentage is exactly how the present defect manages to read plausible: `0.1` and `-0.0832` are both "a small percentage" until the sign is load-bearing, and a renderer that re-derives the word "under" or "over" from anything other than this sign is re-implementing the comparison that went wrong. Acceptance #8 asserts opposite signs from an over-budget and an under-budget category in one run.
- **Negative zero is not a sign.** `roundCents` is `Math.round(n * 100) / 100`, and `Math.round(-0.1)` is `-0`, so a variance of `-0` is reachable and `-0 / 1200` is `-0`. Perfect adherence must report `variance: 0` and `varianceRatio: 0` such that `Object.is(value, -0)` is `false` — otherwise a surface prints "-0.0% under" for a flawless month. Acceptance #4.
- **Rounding — per step, never once at the end.** Each month's `budgeted`, `actual` and `variance` is cent-rounded individually (the `MonthVariance` rule P0.5-29 established, unchanged). The headline's `budgeted`, `actual` and `variance` are sums of those already-rounded per-month figures, re-rounded — never raw float sums. `varianceRatio` is computed **from the two rounded totals** and is itself **not rounded**: it is a ratio, not money, and rounding it to cents would quantize a percentage to 1% steps. Acceptance #16 discriminates: the $1,000-annual fixture gives `-759.96 / 999.96 = -0.7599903996159847`, while raw-float totals give exactly `-0.76`.
- **Landscape + exclusions — all four conjuncts, via `isScoredCategory`.** A row contributes to the headline if and only if `isScoredCategory(row)` is true: `landscape = 'operational'` AND `exclude_from_budget = FALSE` AND `is_income = FALSE` AND `control_mode = 'discretionary'`. This is narrower than `detectAdherence`'s three-conjunct `isTrackedCategory` gate, deliberately and unchanged from P0.5-29 — `fixed` and `variable-necessary` categories still produce findings and still must not move the headline. `hidden` and `track_transactions` are `transactions`/`accounts` flags this module never sees; resolving them upstream is the caller's job. Acceptance #10.
- **Which months are measured.** Exactly the entries in `row.months`, for each scored row — no more and no fewer. A scored category with three supplied months of a twelve-month budget is measured over three months (`budgeted` = 3 × the monthly figure), not twelve. Months that produced no finding are included; that inclusion *is* the fix. `$0`-budget months are included at their real figures (`budgeted` 0, whatever `actual` was), because excluding them would drop real spend from `actual`. Acceptance #11.
- **Null semantics — two levels, stated above under Q3.** `scoredHeadline(rows)` returns `null` **if and only if** no row in `rows` satisfies `isScoredCategory`. It never returns `null` for perfect adherence (acceptance #4), never for a scored category with no supplied months (acceptance #12), and never for a $0 total budget (acceptance #5). Within a non-null struct, `varianceRatio` is `null` if and only if `budgeted === 0`; it is never `NaN`, never `Infinity`, never `-0`.
- **No wall clock.** The module never calls `new Date()` or `Date.now()`. Acceptance #19.

## Toolchain prerequisites

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `node_modules`, vitest v4, typescript present | **yes** | `npm ci` | `test -d node_modules/vitest && test -d node_modules/typescript && echo OK` | `OK` (spec-writer, 2026-09-01) |
| T2 | Clean baseline: whole suite green, tsc clean | **yes** | working tree at `7344713` | `npx vitest run 2>&1 \| tail -5; npx tsc --noEmit; echo "tsc=$?"` | `Test Files 19 passed (19)`, `Tests 332 passed (332)`, `tsc=0` (orchestrator) |
| T3 | `lib/domain/adherence.test.ts` holds exactly 34 passing tests today, none skipped | **yes** — the 32-unchanged claim rests on it | branch state | `npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 \| grep -cE "✓ lib/domain/adherence\.test\.ts"` | `34` (spec-writer) |
| T4 | **BLOCKER — the Finder/iCloud duplicate `lib/domain/adherence.test 2.ts` is inside the tsconfig program and imports `./adherence`** (line 12, `from './adherence'`), calling `scoredHeadline(findings)` at lines 488/496/509 and reading `findingCount` at line 500. It typechecks today only because the signature it targets still exists. **Acceptance #1 cannot pass while it is in the program.** | **yes** | it must leave the tsc program — deleted, or added to `tsconfig.json`'s `exclude` — **by the orchestrator, before dispatch.** The implementer must not "fix" it by editing it, and must not weaken acceptance #1 to route around it. `lib/domain/adherence 2.ts` is self-contained (imports only `budgetMath`/`shared/types`) and is harmless; only the `.test 2.ts` file blocks. | `npx tsc --noEmit --listFiles 2>/dev/null \| grep -c "adherence.test 2.ts"` | **`1` today — must read `0` before G2** (spec-writer) |
| T5 | vitest v4 prints `Tests  N passed (N)` with no skipped segment only when nothing was skipped — load-bearing for #2/#3, which turn the name-greps in #4–#17 from "the test exists" into "the test passed" | **yes** | carried from P0.5-29 T5, re-verified | `npx vitest run --pool=threads lib/domain/adherence.test.ts 2>&1 \| grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"` | `1` (spec-writer) |
| T6 | An unused `@ts-expect-error` is a hard error (TS2578) under this `tsconfig.json`, so #14 discriminates a changed signature from an unchanged one | **yes** — load-bearing for #14 | tsc default | scratch file with `// @ts-expect-error` over a legal call → `npx tsc --noEmit --strict --skipLibCheck <file>` | **`error TS2578: Unused '@ts-expect-error' directive.`, exit 2** (spec-writer, verified by experiment) |
| T7 | `grep -cF` matches test names containing em dashes as emitted by the verbose reporter | **yes** | — | `npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 \| grep -cF "a single lean month never produces a defect finding on its own — chronic underspend requires at least three qualifying months of data"` | `1` (spec-writer) |
| T8 | `npm test` exists and is `vitest run` | **yes** | `package.json` | `grep -F '"test": "vitest run"' package.json` | present (spec-writer) |
| T9 | Postgres / a database | **NO** — every test here is a pure function over fabricated inputs | n/a | n/a | n/a |
| T10 | Plaid credentials, network | **NO** | n/a | n/a | n/a |
| T11 | `node_modules/next/dist/docs/` | **NO** — no Next-facing code is touched | n/a | n/a | n/a |

**No test name in #4–#17 contains a `$`, a backtick, or a `!`** — dollar amounts are written as bare numbers in the descriptions — so each pattern is safe inside the double quotes the commands use.

## Acceptance commands

`…` abbreviates `npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1` for width; each of #4–#17 is that prefix piped to its own `grep -cF`. All commands run from the repo root.

> **Pipe-escaping convention for this table, and why it is called out.** Inside a Markdown table cell, `\|` renders as a single `|` and means **one literal pipe character in the command**. Where a command genuinely needs a *backslash followed by a pipe* — #22, matching the `|` of a TypeScript union type — the cell is written `\\|`. This matters because P0.5-29 shipped a G0 failure on exactly this confusion: `\|` inside an ERE is a **literal pipe**, not alternation, so `grep -cE "new Date\(\|Date\.now\("` matched nothing and enforced nothing. The three regex-bearing commands (#19, #22, #30) are therefore repeated verbatim, unescaped, in the code block below the table, and **that block is authoritative** if the table and it ever disagree.

| # | Command | Expected |
|---|---|---|
| 1 | `npx tsc --noEmit` | exit 0 — **requires T4 resolved** |
| 2 | `npm test 2>&1 \| grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"` | `1` — whole repo green, nothing skipped |
| 3 | `test $(npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 \| grep -cE "✓ lib/domain/adherence\.test\.ts") -ge 46 && echo OK` | `OK` — 32 unchanged + 2 changed + at least 12 new |
| 4 | `… \| grep -cF "perfect adherence across the scored categories produces a real headline at variance zero rather than null, and the ratio is positive zero so no surface can print minus zero percent"` | `1` |
| 5 | `… \| grep -cF "reports null for the variance ratio, inside a real headline, when the scored categories supplied months budgeted nothing in total"` | `1` — **changed test, see below** |
| 6 | `… \| grep -cF "the scored-set headline is null, not zero or NaN, when no category in the input belongs to the scored set"` | `1` — **changed test, see below** |
| 7 | `… \| grep -cF "breachCount and defectCount stay finding-scoped while budgeted, actual and variance range over the scored categories supplied months, and the headline reports how many categories it measured"` | `1` |
| 8 | `… \| grep -cF "a category over budget and a category under budget produce headline variance ratios of opposite sign, so over and under are read from the sign rather than re-derived by a renderer"` | `1` |
| 9 | `… \| grep -cF "no aggregate adds a month-scale breach magnitude to a window-scale defect magnitude, so the denominator is the scored categories own months and never the sum of their findings budgets"` | `1` |
| 10 | `… \| grep -cF "categories outside the scored set never move the headline, however extreme their variance"` | `1` |
| 11 | `… \| grep -cF "the headline never invents a month the caller did not supply, so a scored category with three supplied months of a twelve-month budget is measured over exactly those three"` | `1` |
| 12 | `… \| grep -cF "a scored category with no supplied months yields a real headline at zero budgeted with a null variance ratio, not a null headline and not a zero percentage"` | `1` |
| 13 | `… \| grep -cF "the headline counts agree with the scored findings detectAdherence returns over the same rows"` | `1` |
| 14 | `… \| grep -cF "scoredHeadline takes the same AdherenceInput array detectAdherence takes, and a finding array no longer typechecks"` | `1` — and see #20 |
| 15 | `… \| grep -cF "the headline ranges over every supplied month of every scored category, so a category that drew 1,100 against 1,199.88 budgeted reads 8.3 percent under and not 10 percent over"` | `1` — **the binding numeric case** |
| 16 | `… \| grep -cF "the headline denominator is the rounded per-month schedule, so a 1,000 annual budget with no schedule totals 999.96 and the ratio is computed from the rounded totals"` | `1` |
| 17 | `… \| grep -cF "an evenly divisible annual budget gives the same position at exactly minus one twelfth, so the corrected headline does not depend on the per-month rounding residue"` | `1` |
| 18 | `grep -c "budgetColors" lib/domain/adherence.ts` | `0` |
| 19 | `grep -cE 'new Date\(\|Date\.now\(' lib/domain/adherence.ts` — ERE **alternation**, unescaped pipe | `0` |
| 20 | `grep -cF "// @ts-expect-error scoredHeadline takes AdherenceInput[], not AdherenceFinding[]" lib/domain/adherence.test.ts` | `1` — paired with #1; if the old signature survives, the directive is unused and #1 fails TS2578 |
| 21 | `grep -c "findingCount" lib/domain/adherence.ts` | `0` |
| 22 | `grep -cE '^export function scoredHeadline\(rows: AdherenceInput\[\]\): ScoredHeadline \\| null \{' lib/domain/adherence.ts` — here `\\|` is a **backslash-escaped pipe**, i.e. an ERE matching a literal `\|` character, which is what the TypeScript union needs; verified at spec time to return `1` against the target line and `0` against the current signature. See the authoritative code block below. | `1` |
| 23 | `test $(grep -cE 'scoredCategoryCount' lib/domain/adherence.ts) -ge 2 && echo OK` | `OK` — the declaration and its assignment; `0` today |
| 24 | `… \| grep -cF "includes an operational, non-excluded, non-income category classified discretionary in the scored set"` | `1` — P0.5-28 test, unmodified |
| 25 | `… \| grep -cF "excludes a capital-landscape category from the scored set even when its control_mode is discretionary"` | `1` — P0.5-28 test, unmodified |
| 26 | `… \| grep -cF "one category with sustained overspend and one category with chronic underspend at the roadmap's own 24%-of-budget shape produce a breach finding and a defect finding respectively in the same input, and lib/budgetColors.ts's expenseCellStyle renders every one of the chronically-under category's months as an on-budget green shade"` | `1` — P0.5-29's exit criterion, unmodified |
| 27 | `… \| grep -cF "variance is rounded to cents at each month rather than left to accumulate as float dust across a window"` | `1` — P0.5-29 test, unmodified; also pins that N19's rounding was not "fixed" |
| 28 | `… \| grep -cF "orders a category findings by calendar month whatever order the caller supplied them in"` | `1` — P0.5-29 test, unmodified |
| 29 | `git diff --name-only HEAD -- lib/domain/adherence.ts lib/domain/adherence.test.ts \| wc -l \| tr -d " "` | `2` — both files actually changed |
| 30 | `git diff --name-only HEAD \| grep -vE '^(lib/domain/adherence(\.test)?\.ts\|plan/)' \| wc -l \| tr -d " "` | `0` — no tracked file outside the module, its test, and `plan/` was modified |

**The three regex-bearing commands, verbatim and authoritative** (copy from here, not from the table):

```sh
# 19 — no wall clock inside the module. Unescaped | = ERE alternation.  Expect: 0
grep -cE 'new Date\(|Date\.now\(' lib/domain/adherence.ts

# 22 — the corrected signature is present, literally.  Expect: 1
grep -cE '^export function scoredHeadline\(rows: AdherenceInput\[\]\): ScoredHeadline \| null \{' lib/domain/adherence.ts

# 30 — no tracked file outside the module, its test, and plan/ was modified.  Expect: 0
git diff --name-only HEAD | grep -vE '^(lib/domain/adherence(\.test)?\.ts|plan/)' | wc -l | tr -d ' '
```

Each was run at spec time and discriminates: #19 returns `1` on `lib/netWorth.ts` (a file that does read the clock) and `0` on `lib/domain/adherence.ts`; #22 returns `1` against a scratch file holding the target line and `0` against `lib/domain/adherence.ts` as it stands today; #30 returns `0` on the clean tree, and `git diff` ignores the untracked Finder duplicates entirely, so resolving T4 by deleting one cannot make it fail.

### Required fixture arithmetic — literal expected values

Every figure below was computed at spec time against `roundCents(n) = Math.round(n * 100) / 100` and `sumCents` semantics. These are the values the tests must assert, not approximations to be re-derived.

**Fixture A — the binding case (acceptance #15).** One scored (`discretionary`, operational, not excluded, not income) category, `annual_budget: 1199.88`, `monthly_amounts: null`, twelve supplied months with actuals `[110, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90]`. Per-month budget `roundCents(1199.88 / 12) = 99.99`.

| field | required value |
|---|---|
| `scoredCategoryCount` | `1` |
| `breachCount` | `1` (January only: `110 > 99.99`) |
| `defectCount` | `0` (`90 / 99.99 = 0.9001`, above the 0.5 threshold) |
| `budgeted` | `1199.88` — **and explicitly `not.toBe(99.99)`**, the old finding-scoped denominator |
| `actual` | `1100` — **and explicitly `not.toBe(110)`** |
| `variance` | `-99.88` — **and explicitly `not.toBe(10.01)`** |
| `varianceRatio` | `toBeCloseTo(-0.08324165749908323, 10)`; `toBeLessThan(0)`; **`not.toBeCloseTo(0.1001, 3)`** |
| direction | negative ⇒ **under**. `Math.abs(varianceRatio) * 100` rounds to `8.3` |

**Fixture B — the G4-measured probe (acceptance #17).** Identical, but `annual_budget: 1200` → per-month `100`. `budgeted: 1200`, `actual: 1100`, `variance: -100`, `varianceRatio` `toBeCloseTo(-1/12, 12)` = `-0.08333333333333333`, and **`not.toBe(0.1)`** — the exact value G4 measured from the defective implementation. Fixtures A and B together settle that "≈ 8.3% under" holds whether or not the annual budget divides evenly into cents.

**Fixture C — two domains in one struct (acceptance #7, #9).** Two scored categories in one `rows` array:
- C1: `annual_budget: 1200` (→ `100`/month), actuals `[140, 140, 140, 90, 90, 90, 90, 90, 90, 90, 90, 90]` → 3 breaches, no defect. Category totals: `budgeted 1200`, `actual 1230`, `variance +30`.
- C2: `annual_budget: 2400` (→ `200`/month), actuals `50 × 12` → `0.25` every month, one chronic defect. Category totals: `budgeted 2400`, `actual 600`, `variance -1800`.

Headline: `scoredCategoryCount: 2`, `breachCount: 3`, `defectCount: 1`, `budgeted: 3600`, `actual: 1830`, `variance: -1770`, `varianceRatio` `toBeCloseTo(-0.49166666666666664, 12)`. **And explicitly:** `budgeted` `not.toBe(2700)` — the old finding-scoped sum (`3 × 100 + 2400`) — and `not.toBe(6300)` — categories plus findings double-counted. `varianceRatio` `not.toBeCloseTo(-0.6222222222222222, 6)` (the old value) and `not.toBe(-0.49)` (a ratio wrongly cent-rounded).

**Fixture D — perfect adherence (acceptance #4).** One scored category, `annual_budget: 1200`, `monthly_amounts: null`, actuals `100 × 12`. `detectAdherence(rows)` returns `[]` — assert that in the same test, because it is what makes the case N12's. Headline is **not null**: `scoredCategoryCount: 1`, `breachCount: 0`, `defectCount: 0`, `budgeted: 1200`, `actual: 1200`, `variance: 0`, `varianceRatio: 0`, and `Object.is(headline.variance, -0) === false`, `Object.is(headline.varianceRatio, -0) === false`.

**Fixture E — nothing to score (acceptance #6).** The demo-seed shape: two `fixed` categories with real findings (reuse P0.5-29's `fixedChronic()` and a breaching `fixed` row). `detectAdherence(rows).length > 0` and every finding `scored === false`; `scoredHeadline(rows)` is `null`, `Number.isNaN(headline as unknown as number) === false`. Then add one `discretionary` row and assert the result is **not** null — so `null` is not the constant answer.

**Fixture F — $0 total budgeted, scored category present (acceptance #5).** One scored category, `monthly_amounts: [0,0,0,0,0,0,0,0,0,0,0,1200]`, `months: [{ month: 0, actual: 75 }]`. Headline is **not null**: `scoredCategoryCount: 1`, `breachCount: 1`, `budgeted: 0`, `actual: 75`, `variance: 75`, `varianceRatio: null` — and `Number.isNaN(varianceRatio as unknown as number) === false`, `varianceRatio !== Infinity`.

**Fixture G — scored category, no observations (acceptance #12).** One scored category, `months: []`. Headline is **not null**: `scoredCategoryCount: 1`, `breachCount: 0`, `defectCount: 0`, `budgeted: 0`, `actual: 0`, `variance: 0`, `varianceRatio: null`.

**Fixture H — partial year (acceptance #11).** One scored category, `annual_budget: 1200`, `monthly_amounts: null`, `months: [{0,50},{1,50},{2,50}]`. `budgeted: 300` — **and explicitly `not.toBe(1200)`** — `actual: 150`, `variance: -150`, `varianceRatio: -0.5`.

**Fixture I — unscored contamination (acceptance #10).** Fixture C's two rows, plus, in the same array: a `fixed` category (`annual_budget: 24000`, actuals `2400 × 12` — twelve unscored breaches), a `variable-necessary` category with chronic underspend, a `landscape: 'capital'` + `control_mode: 'discretionary'` category with extreme overspend, an `exclude_from_budget: true` discretionary category with extreme overspend, and an `is_income: true` discretionary category with extreme overspend. The headline must be **deep-equal to Fixture C's headline** — every field, including the counts.

**Fixture J — rounding inheritance (acceptance #16).** P0.5-29's `evenSpreadDust()`: one scored category, `annual_budget: 1000`, `monthly_amounts: null`, actuals `20 × 12`. `budgeted: 999.96` — **and `not.toBe(1000)`** — `actual: 240`, `variance: -759.96` — and `not.toBe(-760)` — `varianceRatio` `toBeCloseTo(-0.7599903996159847, 12)` and **`not.toBe(-0.76)`**, which is what raw-float totals would give.

**Fixture K — count agreement (acceptance #13).** Over Fixture I's rows: `scoredHeadline(rows).breachCount` equals `detectAdherence(rows).filter(f => f.scored && f.kind === 'breach').length` (3), `defectCount` equals the scored `chronic-underspend` count (1), and both are strictly less than the same counts taken without the `scored` filter (15 and 2 respectively) — so an implementation that forgets the `scored` filter fails.

### Tests that change, and why

ITEM.md requires P0.5-29's 34 tests stay green "except where a test pins the old headline arithmetic," with any such change called out rather than absorbed. **Exactly two tests change. Both are in the `scoredHeadline` describe block. No `isScoredCategory` test and no `detectAdherence` test changes — 32 of 34 pass verbatim.**

1. **`the scored-set headline is null, not zero or NaN, when no finding in the input belongs to the scored set`** (`lib/domain/adherence.test.ts:477`) → renamed to **`the scored-set headline is null, not zero or NaN, when no category in the input belongs to the scored set`**. Three reasons, all forced: its call sites pass `detectAdherence(...)` output into `scoredHeadline`, which no longer typechecks (Q1); its name asserts a *finding*-scoped null condition that is no longer the rule (Q3 — the condition is now "no scored **category**"); and its line 500 assertion `expect(withScored?.findingCount).toBe(1)` reads a field this task removes (Q2). Its substance survives intact and is strengthened: the `null` assertions, the `not.toBe(0)` and `Number.isNaN` assertions, and the "null is not the constant answer" second half all remain, with `findingCount` replaced by `scoredCategoryCount: 1` and `defectCount: 1`. Note that its `variance: -15600` figure is *unchanged* by the correction — `fixedChronic`'s chronic window is all twelve months, so the category-scoped and finding-scoped totals coincide there; keep the assertion, since a changed value would signal a different bug.

2. **`reports null for the variance ratio when every scored finding sits on a month that budgeted nothing`** (`lib/domain/adherence.test.ts:506`) → renamed to **`reports null for the variance ratio, inside a real headline, when the scored categories supplied months budgeted nothing in total`** (Fixture F). Same forced signature change, and its name states the finding-scoped condition ("every scored *finding* sits on a month") that Q3 replaces with a category-scoped one. Its three existing assertions (`budgeted: 0`, `variance: 75`, `varianceRatio: null`) are all still correct under the new ranging and stay; what is added is the N12-critical part the old name could not express — the headline itself is **not** null.

## Negative controls

| # | Rule stated in prose | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | The headline ranges over every supplied month, not over findings | Fixture A: eleven compliant months must be in the denominator — `budgeted` `not.toBe(99.99)`, `actual` `not.toBe(110)` | #15 |
| 2 | The sign says the direction; an unsigned or inverted ratio is forbidden | Fixture A: `varianceRatio` must be `< 0`; `not.toBeCloseTo(0.1001, 3)`, i.e. the measured defect value | #15, #8 |
| 3 | Both signs are reachable in one run | Fixture C1 alone (over) vs C2 alone (under): `+0.025` and `-0.75`, strictly opposite signs | #8 |
| 4 | No month-scale magnitude is added to a window-scale one | Fixture C: `budgeted` `not.toBe(2700)` (the old finding sum) | #9 |
| 5 | No double-counting of categories plus findings | Fixture C: `budgeted` `not.toBe(6300)` | #9 |
| 6 | Counts are finding-scoped, money is category-scoped, and the struct says which | Fixture C: `scoredCategoryCount 2`, `breachCount 3`, `defectCount 1` — three distinct values a collapsed struct cannot produce | #7 |
| 7 | `findingCount` is gone, not merely unread | Any surviving `findingCount` in the module | #21 |
| 8 | `null` means "nothing to score" and nothing else | Fixture D: perfect adherence, `detectAdherence` returns `[]`, headline must **not** be null — a stub returning `null` fails | #4 |
| 9 | `null` is still the right answer when there really is nothing to score | Fixture E: all-`fixed` rows with real findings — a stub returning a constant struct fails | #6 |
| 10 | Perfect adherence never prints as negative zero | Fixture D: `Object.is(varianceRatio, -0) === false` | #4 |
| 11 | `varianceRatio` is `null`, never `0`/`NaN`/`Infinity`, at a $0 denominator | Fixture F: `budgeted 0`, `variance 75` — a `0` ratio would read "on budget" | #5 |
| 12 | A scored category with no observations is still a scored category | Fixture G: `months: []` must not collapse the struct to `null` | #12 |
| 13 | Only `isScoredCategory` rows contribute | Fixture I: `fixed`, `variable-necessary`, capital-discretionary, excluded, and income rows with extreme variance must leave the headline deep-equal to Fixture C's | #10 |
| 14 | The `scored` filter is not forgotten | Fixture K: scored counts (3, 1) must be strictly below unfiltered counts (15, 2) | #13 |
| 15 | No month the caller did not supply is invented | Fixture H: `budgeted` `not.toBe(1200)` — an implementation summing the annual budget, or a clock-derived twelve months, fails | #11, #19 |
| 16 | Totals are sums of rounded per-month figures; the ratio comes from the rounded totals and is not itself rounded | Fixture J: `variance` `not.toBe(-760)`, `varianceRatio` `not.toBe(-0.76)` and `not.toBe(-0.76)`-rounded forms | #16 |
| 17 | N19 is inherited, not silently "fixed" | Fixture J: `budgeted` must be `999.96`, not `1000` — and P0.5-29's per-month rounding test still passes verbatim | #16, #27 |
| 18 | The old finding-taking signature is genuinely gone | A call `scoredHeadline(detectAdherence(rows))` must not compile — the `@ts-expect-error` directive is *used* | #1 + #14 + #20 + #22 |
| 19 | `isScoredCategory` and `detectAdherence` are untouched | P0.5-28's two representative tests, P0.5-29's exit criterion, its ordering test, and its per-month-rounding test, all by verbatim name | #24, #25, #26, #27, #28 |
| 20 | No wall clock | Any `new Date()` / `Date.now()` in the module | #19 |
| 21 | No coupling to the incumbent colour module | Any `budgetColors` mention in the module | #18 |
| 22 | The module and its test both actually change | A diff that edits only one of them | #29 |
| 23 | Nothing outside the module and its test changes | Any other tracked modified path — including an implementer "fixing" the Finder duplicate or editing `components/BudgetMonthlyGrid.tsx` to close N19 | #30 |

**Vacuity check, command by command.** #1/#2 prove nothing broke, not that anything shipped — they are not load-bearing alone. #3 bounds the work: a diff that renames two tests and adds nothing fails it. #4 is the N12 gate a `null`-returning stub cannot pass, and #6 is the gate a constant-struct stub cannot pass — neither works without the other. #5 catches a `0` ratio at a $0 denominator and any `Infinity`/`NaN` leak. #7 catches a struct that keeps one domain or collapses both. #8 catches an absolute-value or inverted ratio, which is the specific dressing that made the present defect readable. #9 is the direct N11 regression: an implementation that ranges over categories but still adds finding magnitudes lands on 6300, and the unchanged implementation lands on 2700. #10 catches a headline gated on `isTrackedCategory` (three conjuncts) instead of `isScoredCategory` (four) — the plausible slip, since `detectAdherence` uses the three-conjunct gate two functions above. #11 catches an implementation that assumes twelve months or reads a clock. #12 catches "no months ⇒ null", the tempting shortcut that would re-merge the two nulls N12 separates. #13 catches a forgotten `scored` filter. #14+#20+#22 together make the signature change mechanical rather than asserted: TS2578 fires if the old signature survives, so #1 goes red. #15 and #17 are the binding numeric case, pinned literally at both an evenly-dividing and a non-evenly-dividing annual budget, each with an explicit `not.toBe` against the exact value G4 measured from the defect. #16 discriminates rounded-total arithmetic from raw-float arithmetic at four cents, and would fail an implementer who "fixed" N19 on the way past. #18/#19/#21 are static and catch coupling, a clock read, and a resurrected field that no type error would reveal. #23 pins that the two-domain field actually exists rather than being documented. #24–#28 catch a diff that rewrites the neighbours. #29 catches a diff that changes the module without changing its test, or vice versa. #30 catches scope creep — an implementer editing the Finder duplicate, or reaching sideways into `components/BudgetMonthlyGrid.tsx` to close N19.

## Evidence required

- Verbatim output of all 30 acceptance commands in `EVIDENCE.md`, including exit codes for #1.
- **A before/after of the defect, run as a command.** The exact fixture from ITEM.md / NITS N11 (Fixture A and Fixture B), with the pre-change output (`{"budgeted":100,"actual":110,"variance":10,"varianceRatio":0.1}` for B, as measured at P0.5-29's G4) beside the post-change output, and the percentage each implies stated in words: "+10.0% over" then "−8.3% under".
- A table of every fixture A–K with its per-category `budgeted`/`actual`/`variance` and the resulting headline fields, so the arithmetic in this spec can be checked against the arithmetic in the tests without running them.
- The full verbose test listing for `lib/domain/adherence.test.ts`, showing the 32 unchanged names present verbatim, the 2 changed names in their new form, and the new names — so "32 of 34 unchanged" is a visible fact rather than a claim.
- Confirmation, with commands #29 and #30 run and their output pasted, that exactly `lib/domain/adherence.ts` and `lib/domain/adherence.test.ts` changed under `lib/`, and no other tracked file outside `plan/` did.
- The resolution of T4 recorded explicitly — what was done to `lib/domain/adherence.test 2.ts`, by whom, and the re-measured `npx tsc --noEmit --listFiles | grep -c "adherence.test 2.ts"` → `0`.

## Failure modes to test

- **Ranging corrected but scale mixing left in** — the headline sums each scored category's supplied months *and* still adds each finding's `budgeted`, double-counting (Fixture C → 6300). The two causes of N11 are independent and fixing one is the likely partial fix.
- **`isTrackedCategory` used where `isScoredCategory` was meant** — three conjuncts instead of four, so `fixed` and `variable-necessary` categories silently enter the headline. `detectAdherence` twenty lines up uses the three-conjunct gate correctly, which is exactly what makes the copy plausible.
- **Sign inverted or stripped** — `budgeted − actual`, or `Math.abs`, or `1 − actual / budgeted`. Each still produces a plausible small percentage, and the only symptom is that thrift reads as overspending. This is the failure that shipped.
- **`varianceRatio` returned as `0` rather than `null` at a $0 denominator** — reads "perfectly on budget" for a category that spent $75 against nothing.
- **The struct's `null` kept for perfect adherence** (N12 not shipped), leaving a dashboard rendering "—" for a flawless month.
- **The struct's `null` widened to "no scored category with any months"**, silently re-merging the two states N12 separates.
- **Negative zero** — `roundCents(-0.001)` is `-0`, and `-0 / 1200` is `-0`, so a near-perfect month can print "-0.0% under".
- **Twelve months assumed, or derived from a clock** — "the actual position" invites ranging over the calendar year rather than the caller's supplied months, which makes the suite mean something different in December than in March and inflates every partial-year denominator.
- **Rounding once at the end** — summing raw per-month floats and rounding the total, which disagrees by four cents on the $1,000 fixture and shifts the ratio from `-0.75999…` to `-0.76`.
- **`varianceRatio` rounded to cents** — quantizing a percentage into 1% steps, a category error dressed as consistency.
- **`findingCount` retained** — the count-shaped instance of the same incommensurability, invisible to `tsc` because nothing reads it.
- **Empty-collection cases**: `rows: []`; all rows unscored; a scored row with `months: []`; a scored row all of whose supplied months budget $0. Each must land on a stated answer, not on `NaN`, `Infinity`, `-0`, or an accidental `0`.
- **`detectAdherence` perturbed while refactoring a shared helper** — a shared internal for "resolve a row's months into `MonthVariance[]`" is the natural reuse, and touching it changes finding output. P0.5-29's 32 tests are the tripwire.
- **N15 and N18 amplified** — an out-of-range `month` now contributes a substituted even-spread budget to the *denominator*, and a duplicated `month` now inflates it. Both are out of scope, and both should be re-stated as known caller-contract hazards rather than discovered again at step 31.

## Rollback

Pure module change: no migration, no schema, no data, no persisted state. Revert is `git revert` of this task's commit(s), restoring `lib/domain/adherence.ts` and `lib/domain/adherence.test.ts` to their P0.5-29 state — which reinstates the finding-taking `scoredHeadline`, `findingCount`, and defect N11 along with them. Nothing outside those two files changes, and `scoredHeadline` has no importer in the repo, so a revert cannot break a consumer. No CSV backup applies; no data was written. **One caveat:** if T4 was resolved by deleting `lib/domain/adherence.test 2.ts`, that deletion is *not* part of the rollback — it is an orchestrator-owned tree hygiene action taken before dispatch, and restoring the file would reintroduce a tsc failure against whichever signature is current at that moment.
