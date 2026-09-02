# EVIDENCE — P0.5-29a-headline-scope

**Author:** implementer **Date:** 2026-09-01
**Files changed:** `lib/domain/adherence.ts`, `lib/domain/adherence.test.ts` — and nothing else
tracked outside `plan/` (acceptance #29 → `2`, #30 → `0`, both pasted below).

**Summary of the result:** all 30 acceptance commands produce their expected output. `npx tsc
--noEmit` exits 0; `npm test` is `Test Files 19 passed (19)` / `Tests 344 passed (344)` (332
baseline + 12 new); `lib/domain/adherence.test.ts` is 46 tests, of which **32 of P0.5-29's 34 are
present verbatim, byte-identical in name**, 2 are the renames the spec names, and 12 are new.

Nothing is failing, skipped, or partial. Every command below was run by me at the repo root and its
output is pasted verbatim.

> **A note on `grep -c` exit codes.** Acceptance #18, #19 and #21 expect the *printed value* `0`.
> `grep -c` exits `1` when its count is zero, so those three rows read `exit=1` and that is the
> success case, not a failure. The spec attaches an exit-code expectation to #1 alone.

---

## 1. What changed, and why it is exactly this

`scoredHeadline` stopped ranging over `AdherenceFinding[]` and now ranges over `AdherenceInput[]` —
the same array `detectAdherence` takes. Concretely:

- **Signature.** `export function scoredHeadline(rows: AdherenceInput[]): ScoredHeadline | null`
  (Q1). The old finding-taking overload is gone, not deprecated, which is what makes the
  `@ts-expect-error` in the test *used* and therefore what makes acceptance #1 a real gate on the
  change (TS2578 if the old signature ever comes back).
- **Struct.** `findingCount` removed; `scoredCategoryCount` added (Q2). The counts stay
  finding-scoped; `budgeted`/`actual`/`variance`/`varianceRatio` became category-scoped. The
  interface doc states which field belongs to which domain, field by field.
- **Membership.** `isScoredCategory` — all four conjuncts. Not `isTrackedCategory`.
- **Range.** Exactly the entries in `row.months` for each scored row. No clock, no assumed twelve.
- **Rounding.** Totals are `sumCents` over the already-rounded per-month `MonthVariance` figures;
  `varianceRatio` is computed from the two rounded totals and is itself **not** rounded.
- **`varianceRatio` at a $0 denominator** is `null` (Q3) — the identical rule `MonthVariance.ratio`
  applies one level down.
- **Negative zero** is normalised by a new private `withoutNegativeZero`, applied to `variance` and
  to `varianceRatio`.
- **Shared helper.** `monthVariances(row)` (sort by calendar month, map through `toMonthVariance`)
  was extracted from `detectAdherence` so both readers resolve a row's months through one
  definition. `detectAdherence`'s body is otherwise untouched and its observable behaviour is
  unchanged — see the 32-verbatim-test evidence in §5 and acceptance #24–#28.
- **Counts** come from `detectAdherence(scoredRows)` rather than from a second copy of the breach
  and chronic thresholds, so the headline structurally cannot disagree with the findings a caller
  lists beside it. Every finding over scored rows is scored by construction (four conjuncts subsume
  three), so no `scored` filter is needed; acceptance #13 pins the agreement against the
  `.filter(f => f.scored && …)` form anyway.

**No contract change was required.** `shared/types.ts`, `shared/contracts/**`, `migrations/**` and
`db/schema.sql` were not touched and did not need to be; `ScoredHeadline` is module-local, and every
column read already exists. G1's skip stands. I have nothing to report upward on contracts.

**N19 was left alone, deliberately**, per the spec's non-goal: `budgetedForMonth` still rounds per
month, so the $1,000-annual fixture still totals $999.96 and `components/BudgetMonthlyGrid.tsx` was
not opened. Acceptance #16 measures the inheritance rather than assuming it, and the mutation check
in §7 shows that test failing against a round-once-at-the-end implementation.

**N15 and N18 are re-stated, not fixed** (also a spec non-goal, and both get worse in blast radius
under this change): a duplicate `month` entry now inflates the headline *denominator* as well as a
window, and an out-of-range `month` now contributes a substituted even-spread budget to it. Both are
caller-contract hazards for step 31 to own. No input validation was added.

---

## 2. The defect, before and after, run as a command

The old implementation was taken from `HEAD` and executed side by side with the new one in the same
process, on ITEM.md's exact fixture. Reproduced as:

```sh
git show HEAD:lib/domain/adherence.ts > lib/domain/probeOldAdherence.ts
# a throwaway lib/domain/probe.test.ts importing both modules and printing each headline
npx vitest run --pool=threads lib/domain/probe.test.ts --disable-console-intercept 2>&1 \
  | grep -A2 -E "Fixture (A|B)"
rm -f lib/domain/probe.test.ts lib/domain/probeOldAdherence.ts
```

Both probe files were **deleted immediately after the run** and neither was ever tracked; acceptance
#29/#30 below were run after their removal and confirm the tree holds only the two intended files.
Verbatim output:

```
Fixture B (annual 1200)
  BEFORE (HEAD): {"findingCount":1,"breachCount":1,"defectCount":0,"budgeted":100,"actual":110,"variance":10,"varianceRatio":0.1}  =>  +10.0% over
  AFTER  (this): {"scoredCategoryCount":1,"breachCount":1,"defectCount":0,"budgeted":1200,"actual":1100,"variance":-100,"varianceRatio":-0.08333333333333333}  =>  −8.3% under
--
Fixture A (annual 1199.88)
  BEFORE (HEAD): {"findingCount":1,"breachCount":1,"defectCount":0,"budgeted":99.99,"actual":110,"variance":10.01,"varianceRatio":0.10011001100110012}  =>  +10.0% over
  AFTER  (this): {"scoredCategoryCount":1,"breachCount":1,"defectCount":0,"budgeted":1199.88,"actual":1100,"variance":-99.88,"varianceRatio":-0.08324165749908323}  =>  −8.3% under
```

In words, which is the whole point of the task:

| Fixture | Before (`HEAD`) | After (this change) |
|---|---|---|
| **B** — $1,200/yr, $110 in January, $90 × 11 | **+10.0% over** | **−8.3% under** |
| **A** — $1,199.88/yr, $110 in January, $90 × 11 | **+10.0% over** | **−8.3% under** |

Fixture B's "before" line is byte-identical to the figure ITEM.md records from P0.5-29's G4:
`{"findingCount":1,"breachCount":1,"defectCount":0,"budgeted":100,"actual":110,"variance":10,"varianceRatio":0.1}`.
Both causes of N11 are visible in it at once — the denominator is January's $100 alone (wrong
domain), and the sign is positive on a category that underspent by $100 (the consequence).

---

## 3. Fixture table — every fixture A–K, per category and in the headline

Arithmetic under `roundCents(n) = Math.round(n * 100) / 100`; totals are `sumCents` over the
already-rounded per-month figures. I re-derived every row with `node -e` before writing a line of
code, and all eleven agree with SPEC.md as frozen — including Fixture C's `-0.6222222222222222`
old-value pin, which is the *old* numerator (`3 × 140 + 600 = 1020`) over the *old* denominator
(`3 × 100 + 2400 = 2700`).

| Fixture | Scored categories, per category (`budgeted` / `actual` / `variance`) | Headline: `scoredCategoryCount`, `breachCount`, `defectCount` | `budgeted` | `actual` | `variance` | `varianceRatio` |
|---|---|---|---|---|---|---|
| **A** binding case, $1,199.88/yr → $99.99/mo, actuals `110, 90×11` | 1199.88 / 1100 / −99.88 | 1, 1, 0 | `1199.88` | `1100` | `-99.88` | `-0.08324165749908323` (**8.3% under**) |
| **B** even divide, $1,200/yr → $100/mo, actuals `110, 90×11` | 1200 / 1100 / −100 | 1, 1, 0 | `1200` | `1100` | `-100` | `-1/12` = `-0.08333333333333333` |
| **C** two domains — C1 $1,200/yr, `140,140,140,90×9`; C2 $2,400/yr, `50×12` | C1 1200 / 1230 / **+30**; C2 2400 / 600 / **−1800** | 2, 3, 1 | `3600` | `1830` | `-1770` | `-0.49166666666666664` |
| **D** perfect adherence, $1,200/yr, `100×12` | 1200 / 1200 / 0 | 1, 0, 0 | `1200` | `1200` | `0` | `0` (and `Object.is(·, -0) === false`) |
| **E** nothing to score — two `fixed` rows with real findings | *(no scored category)* | — | — | — | — | headline itself is **`null`** |
| **F** $0 total budget — Dec-only schedule, `[{month:0, actual:75}]` | 0 / 75 / +75 | 1, 1, 0 | `0` | `75` | `75` | **`null`** |
| **G** no observations — `months: []` | 0 / 0 / 0 | 1, 0, 0 | `0` | `0` | `0` | **`null`** |
| **H** partial year — $1,200/yr, months 0–2 at $50 | 300 / 150 / −150 | 1, 0, 0 | `300` | `150` | `-150` | `-0.5` |
| **I** C + five unscored contaminants | identical to C — contaminants contribute nothing | 2, 3, 1 | `3600` | `1830` | `-1770` | `-0.49166666666666664` |
| **J** rounding inheritance — $1,000/yr → $83.33/mo, `20×12` | 999.96 / 240 / −759.96 | 1, 0, 1 | `999.96` | `240` | `-759.96` | `-0.7599903996159847` |
| **K** count agreement, over I's rows | — | 2, **3**, **1** | — | — | — | scored counts 3/1 against unfiltered 15/2 |

**Explicit `not.toBe` pins asserted in the tests** (each is a value some plausible wrong
implementation actually lands on, not a decorative negation):

| Fixture | Pin | The implementation it rejects |
|---|---|---|
| A | `budgeted` ≠ `99.99`, `actual` ≠ `110`, `variance` ≠ `10.01` | ranging over findings — January alone |
| A | `varianceRatio` not close to `0.1001` (3 dp) | the measured defect value at G4 |
| B | `varianceRatio` ≠ `0.1` | the exact G4 figure |
| C | `budgeted` ≠ `2700` | the unchanged finding-scoped sum (month-scale + window-scale) |
| C | `budgeted` ≠ `6300` | categories **plus** findings — the likely partial fix |
| C | `varianceRatio` not close to `-0.6222222222222222` (6 dp) | the old implementation's own answer |
| C | `varianceRatio` ≠ `-0.49` | a ratio wrongly cent-rounded |
| F | `varianceRatio` ≠ `0`, ≠ `Infinity`, not NaN | "on budget" for $75 against nothing |
| H | `budgeted` ≠ `1200` | twelve months assumed, or read off a clock |
| J | `budgeted` ≠ `1000`, `variance` ≠ `-760`, `varianceRatio` ≠ `-0.76` | rounding once at the end |
| D | `Object.is(variance, -0)` and `Object.is(varianceRatio, -0)` both `false` | "-0.0% under" for a flawless year |

Fixture I's contaminants, all with extreme variance, are: a `fixed` $24,000/yr row drawing $2,400 a
month (twelve unscored breaches), a `variable-necessary` $24,000/yr row drawing $700 a month (one
unscored defect), and a capital-landscape, an `exclude_from_budget`, and an `is_income` row, each
`discretionary` and each drawing $5,000 against a $100 month. The test asserts the contaminants
really do produce findings and that every one is `scored === false`, then asserts the contaminated
headline is `toEqual` the clean one — every field, counts included.

---

## 4. The two tests that changed, and the 32 that did not

Exactly the two the spec names, for exactly the reasons it gives:

| Old name (`HEAD`) | New name | Why it was forced |
|---|---|---|
| `the scored-set headline is null, not zero or NaN, when no finding in the input belongs to the scored set` | `the scored-set headline is null, not zero or NaN, when no category in the input belongs to the scored set` | its call sites passed `detectAdherence(...)` output into `scoredHeadline` (no longer typechecks); its name asserted a *finding*-scoped null condition that Q3 replaces with a category-scoped one; and its `expect(withScored?.findingCount).toBe(1)` read a field this task removes. Substance kept and strengthened: the `null`, `not.toBe(0)` and `Number.isNaN` assertions all remain, `findingCount` is replaced by `scoredCategoryCount: 1` and `defectCount: 1`, and the `variance: -15600` figure is kept **unchanged** — `fixedChronic`'s window is all twelve months, so its category-scoped and finding-scoped totals coincide, and a changed value there would signal a different bug. |
| `reports null for the variance ratio when every scored finding sits on a month that budgeted nothing` | `reports null for the variance ratio, inside a real headline, when the scored categories supplied months budgeted nothing in total` | same forced signature change, and its name stated the finding-scoped condition Q3 replaces. Its three assertions (`budgeted: 0`, `variance: 75`, `varianceRatio: null`) are still correct and stay; what is added is the N12-critical part the old name could not express — the headline itself is **not** null. |

Mechanically verified rather than claimed — test names extracted from `git show
HEAD:lib/domain/adherence.test.ts` and from the working file, then set-compared:

```
HEAD test count: 34  current: 46
unchanged names still present verbatim: 32

removed from HEAD (2):
  - the scored-set headline is null, not zero or NaN, when no finding in the input belongs to the scored set
  - reports null for the variance ratio when every scored finding sits on a month that budgeted nothing

added (14):
  + the scored-set headline is null, not zero or NaN, when no category in the input belongs to the scored set
  + perfect adherence across the scored categories produces a real headline at variance zero rather than null, and the ratio is positive zero so no surface can print minus zero percent
  + reports null for the variance ratio, inside a real headline, when the scored categories supplied months budgeted nothing in total
  + the headline ranges over every supplied month of every scored category, so a category that drew 1,100 against 1,199.88 budgeted reads 8.3 percent under and not 10 percent over
  + an evenly divisible annual budget gives the same position at exactly minus one twelfth, so the corrected headline does not depend on the per-month rounding residue
  + breachCount and defectCount stay finding-scoped while budgeted, actual and variance range over the scored categories supplied months, and the headline reports how many categories it measured
  + no aggregate adds a month-scale breach magnitude to a window-scale defect magnitude, so the denominator is the scored categories own months and never the sum of their findings budgets
  + a category over budget and a category under budget produce headline variance ratios of opposite sign, so over and under are read from the sign rather than re-derived by a renderer
  + categories outside the scored set never move the headline, however extreme their variance
  + the headline never invents a month the caller did not supply, so a scored category with three supplied months of a twelve-month budget is measured over exactly those three
  + a scored category with no supplied months yields a real headline at zero budgeted with a null variance ratio, not a null headline and not a zero percentage
  + the headline denominator is the rounded per-month schedule, so a 1,000 annual budget with no schedule totals 999.96 and the ratio is computed from the rounded totals
  + the headline counts agree with the scored findings detectAdherence returns over the same rows
  + scoredHeadline takes the same AdherenceInput array detectAdherence takes, and a finding array no longer typechecks
```

14 added minus the 2 renames = **12 genuinely new tests**, which is the floor acceptance #3 sets.
**No `isScoredCategory` test and no `detectAdherence` test changed.**

---

## 5. Full verbose test listing

```
 ✓ lib/domain/adherence.test.ts > isScoredCategory > includes an operational, non-excluded, non-income category classified discretionary in the scored set 1ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > excludes a fixed category from the scored set even though it is operational, not excluded, and not income 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > excludes a variable-necessary category from the scored set — tracked and reported, never scored, same as fixed 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > excludes a capital-landscape category from the scored set even when its control_mode is discretionary 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > excludes an exclude_from_budget category from the scored set even when its control_mode is discretionary 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > excludes an is_income category from the scored set even when its control_mode is discretionary 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > treats the two non-discretionary modes identically rather than ranking them 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > stays out when more than one conjunct fails at once 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > accepts a whole BudgetCategory row, so no caller needs a local shape for it 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > excludes a row whose control_mode is absent, the shape an out-of-contract SELECT produces at runtime 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > excludes a row whose control_mode is an unrecognized string, rather than reading anything not-fixed as scored 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > excludes a row whose exclude_from_budget arrives null, rather than reading a missing flag as not-excluded 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > excludes a row whose is_income arrives undefined, rather than reading a missing flag as not-income 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a month where actual spend exceeds its budgeted amount produces a breach finding for that month 1ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a month at or under its budgeted amount never produces a breach finding 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a month with zero budgeted amount and nonzero spend produces a breach finding without computing a spend-to-budget ratio 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > spend under 50% of budget in every qualifying month of a window of at least three such months produces a single chronic-underspend defect finding for that category 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a single lean month never produces a defect finding on its own — chronic underspend requires at least three qualifying months of data 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > one on-budget or over-budget month among otherwise-lean months breaks the chronic streak and no defect finding is produced 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a month with zero budgeted amount is excluded from the chronic-underspend window entirely, whether or not it has spend, rather than being read as either perfectly adhered or fully underspent 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a fixed category with sustained overspend produces a breach finding marked not scored 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a fixed category with chronic underspend produces a defect finding marked not scored — a wrong fixed budget line is still a wrong budget 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a variable-necessary category with chronic underspend produces a defect finding marked not scored, tracked the same as fixed rather than as a softer case of it 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a discretionary category with chronic underspend produces a defect finding marked scored 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a capital-landscape category never produces a finding of either kind, regardless of variance, even when its control_mode is discretionary 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > an exclude_from_budget category never produces a finding of either kind, regardless of variance 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > an is_income category never produces a finding of either kind, regardless of variance 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > one category with sustained overspend and one category with chronic underspend at the roadmap's own 24%-of-budget shape produce a breach finding and a defect finding respectively in the same input, and lib/budgetColors.ts's expenseCellStyle renders every one of the chronically-under category's months as an on-budget green shade 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > an explicit monthly_amounts schedule is used verbatim for each month's budgeted amount, even when it disagrees with annual_budget divided by twelve 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a null monthly_amounts schedule falls back to annual_budget divided by twelve, rounded to cents, as every month's budgeted amount 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > variance is rounded to cents at each month rather than left to accumulate as float dust across a window 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > orders a category findings by calendar month whatever order the caller supplied them in 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > the scored-set headline is null, not zero or NaN, when no category in the input belongs to the scored set 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > perfect adherence across the scored categories produces a real headline at variance zero rather than null, and the ratio is positive zero so no surface can print minus zero percent 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > reports null for the variance ratio, inside a real headline, when the scored categories supplied months budgeted nothing in total 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > the headline ranges over every supplied month of every scored category, so a category that drew 1,100 against 1,199.88 budgeted reads 8.3 percent under and not 10 percent over 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > an evenly divisible annual budget gives the same position at exactly minus one twelfth, so the corrected headline does not depend on the per-month rounding residue 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > breachCount and defectCount stay finding-scoped while budgeted, actual and variance range over the scored categories supplied months, and the headline reports how many categories it measured 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > no aggregate adds a month-scale breach magnitude to a window-scale defect magnitude, so the denominator is the scored categories own months and never the sum of their findings budgets 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > a category over budget and a category under budget produce headline variance ratios of opposite sign, so over and under are read from the sign rather than re-derived by a renderer 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > categories outside the scored set never move the headline, however extreme their variance 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > the headline never invents a month the caller did not supply, so a scored category with three supplied months of a twelve-month budget is measured over exactly those three 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > a scored category with no supplied months yields a real headline at zero budgeted with a null variance ratio, not a null headline and not a zero percentage 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > the headline denominator is the rounded per-month schedule, so a 1,000 annual budget with no schedule totals 999.96 and the ratio is computed from the rounded totals 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > the headline counts agree with the scored findings detectAdherence returns over the same rows 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > scoredHeadline takes the same AdherenceInput array detectAdherence takes, and a finding array no longer typechecks 0ms
 Test Files  1 passed (1)
      Tests  46 passed (46)
```

---

## 6. T4 — resolution, recorded

**Not my action, and I did not touch it.** Per GATES.md, the **orchestrator** moved the untracked
Finder/iCloud duplicate `lib/domain/adherence.test 2.ts` (26,229 bytes) out of the tree to the
session scratchpad at `…/scratchpad/quarantine/adherence.test 2.ts` before dispatch, on 2026-09-01.
It was not deleted, not edited, not committed, and I never opened it, recreated it, referenced it,
or added anything to `tsconfig.json` on its account. Re-measured by me on the finished tree:

```
$ npx tsc --noEmit --listFiles 2>/dev/null | grep -c "adherence.test 2.ts"
0
```

`lib/domain/adherence 2.ts` and the ten other ` 2.` duplicates under `plan/` and `migrations/` are
still present and still untracked; none is compiled or imported and none was touched. `git status`
shows them as `??` only.

---

## 7. Non-vacuity — the new tests were checked against wrong implementations

A test that passes proves nothing unless a wrong implementation fails it. Each mutation below was
applied to `lib/domain/adherence.ts`, the suite run, and the file restored byte-identically
(verified with `diff -q`, and the final `tsc`/suite runs in §8 are on the restored file).

| Mutation | Result |
|---|---|
| `isScoredCategory` → `isTrackedCategory` in the headline's gate (three conjuncts instead of four — the spec's named plausible slip) | `Tests  3 failed \| 43 passed (46)` |
| `variance / budgeted` → `Math.abs(variance) / budgeted` (the sign stripped — the failure that shipped) | `Tests  6 failed \| 40 passed (46)` |
| `varianceRatio` cent-rounded (`roundCents(variance / budgeted)`) | `Tests  6 failed \| 40 passed (46)` |
| totals summed from **raw, unrounded** per-month budgets and rounded once at the end | `Tests  1 failed \| 45 passed (46)` — the failure is acceptance #16's test by name, exactly as the spec predicts |

One mutation I tried first did **not** fail the suite and I am recording it rather than hiding it:
re-summing `m.actual - m.budgeted` as raw floats over the *already-rounded* per-month budgets still
lands on `-759.96`, so it is indistinguishable by value from the correct implementation on Fixture J
— which is why the round-once mutation that actually discriminates is the one that skips
`roundCents` inside `budgetedForMonth`'s even spread, and that one does fail. The four-cent
discrimination acceptance #16 relies on lives in the *per-month budget* rounding, not in the
re-summation, and the table above confirms it bites there.

The two stub-catchers pair as the spec designs: a `null`-returning stub fails #4 (perfect adherence
must be a real struct) and a constant-struct stub fails #6 (all-`fixed` rows must be `null`).
Neither works without the other.

---

## 8. All 30 acceptance commands, verbatim

Each command below was run from the repo root. `…` in SPEC.md's table is expanded to
`npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1`. The three
regex-bearing commands (#19, #22, #30) are copied from the spec's authoritative code block, not from
the table cells.

```
### 1
$ npx tsc --noEmit
exit=0

### 2
$ npm test 2>&1 | grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"
1
exit=0

### 3
$ test $(npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cE "✓ lib/domain/adherence\.test\.ts") -ge 46 && echo OK
OK
exit=0

### 4
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cF "perfect adherence across the scored categories produces a real headline at variance zero rather than null, and the ratio is positive zero so no surface can print minus zero percent"
1
exit=0

### 5
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cF "reports null for the variance ratio, inside a real headline, when the scored categories supplied months budgeted nothing in total"
1
exit=0

### 6
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cF "the scored-set headline is null, not zero or NaN, when no category in the input belongs to the scored set"
1
exit=0

### 7
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cF "breachCount and defectCount stay finding-scoped while budgeted, actual and variance range over the scored categories supplied months, and the headline reports how many categories it measured"
1
exit=0

### 8
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cF "a category over budget and a category under budget produce headline variance ratios of opposite sign, so over and under are read from the sign rather than re-derived by a renderer"
1
exit=0

### 9
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cF "no aggregate adds a month-scale breach magnitude to a window-scale defect magnitude, so the denominator is the scored categories own months and never the sum of their findings budgets"
1
exit=0

### 10
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cF "categories outside the scored set never move the headline, however extreme their variance"
1
exit=0

### 11
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cF "the headline never invents a month the caller did not supply, so a scored category with three supplied months of a twelve-month budget is measured over exactly those three"
1
exit=0

### 12
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cF "a scored category with no supplied months yields a real headline at zero budgeted with a null variance ratio, not a null headline and not a zero percentage"
1
exit=0

### 13
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cF "the headline counts agree with the scored findings detectAdherence returns over the same rows"
1
exit=0

### 14
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cF "scoredHeadline takes the same AdherenceInput array detectAdherence takes, and a finding array no longer typechecks"
1
exit=0

### 15
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cF "the headline ranges over every supplied month of every scored category, so a category that drew 1,100 against 1,199.88 budgeted reads 8.3 percent under and not 10 percent over"
1
exit=0

### 16
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cF "the headline denominator is the rounded per-month schedule, so a 1,000 annual budget with no schedule totals 999.96 and the ratio is computed from the rounded totals"
1
exit=0

### 17
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cF "an evenly divisible annual budget gives the same position at exactly minus one twelfth, so the corrected headline does not depend on the per-month rounding residue"
1
exit=0

### 18
$ grep -c "budgetColors" lib/domain/adherence.ts
0
exit=1

### 19
$ grep -cE 'new Date\(|Date\.now\(' lib/domain/adherence.ts
0
exit=1

### 20
$ grep -cF "// @ts-expect-error scoredHeadline takes AdherenceInput[], not AdherenceFinding[]" lib/domain/adherence.test.ts
1
exit=0

### 21
$ grep -c "findingCount" lib/domain/adherence.ts
0
exit=1

### 22
$ grep -cE '^export function scoredHeadline\(rows: AdherenceInput\[\]\): ScoredHeadline \| null \{' lib/domain/adherence.ts
1
exit=0

### 23
$ test $(grep -cE 'scoredCategoryCount' lib/domain/adherence.ts) -ge 2 && echo OK
OK
exit=0

### 24
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cF "includes an operational, non-excluded, non-income category classified discretionary in the scored set"
1
exit=0

### 25
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cF "excludes a capital-landscape category from the scored set even when its control_mode is discretionary"
1
exit=0

### 26
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cF "one category with sustained overspend and one category with chronic underspend at the roadmap's own 24%-of-budget shape produce a breach finding and a defect finding respectively in the same input, and lib/budgetColors.ts's expenseCellStyle renders every one of the chronically-under category's months as an on-budget green shade"
1
exit=0

### 27
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cF "variance is rounded to cents at each month rather than left to accumulate as float dust across a window"
1
exit=0

### 28
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cF "orders a category findings by calendar month whatever order the caller supplied them in"
1
exit=0

### 29
$ git diff --name-only HEAD -- lib/domain/adherence.ts lib/domain/adherence.test.ts | wc -l | tr -d " "
2
exit=0

### 30
$ git diff --name-only HEAD | grep -vE '^(lib/domain/adherence(\.test)?\.ts|plan/)' | wc -l | tr -d ' '
0
exit=0

```

### Command-by-command verdict

| # | Expected | Measured | Verdict |
|---|---|---|---|
| 1 | exit 0 | `exit=0` | **PASS** |
| 2 | `1` | `1` | **PASS** |
| 3 | `OK` | `OK` | **PASS** |
| 4 | `1` | `1` | **PASS** |
| 5 | `1` | `1` | **PASS** |
| 6 | `1` | `1` | **PASS** |
| 7 | `1` | `1` | **PASS** |
| 8 | `1` | `1` | **PASS** |
| 9 | `1` | `1` | **PASS** |
| 10 | `1` | `1` | **PASS** |
| 11 | `1` | `1` | **PASS** |
| 12 | `1` | `1` | **PASS** |
| 13 | `1` | `1` | **PASS** |
| 14 | `1` | `1` | **PASS** |
| 15 | `1` | `1` | **PASS** |
| 16 | `1` | `1` | **PASS** |
| 17 | `1` | `1` | **PASS** |
| 18 | `0` | `0` (grep exit 1 — the zero-match exit code, expected) | **PASS** |
| 19 | `0` | `0` (grep exit 1, as above) | **PASS** |
| 20 | `1` | `1` | **PASS** |
| 21 | `0` | `0` (grep exit 1, as above) | **PASS** |
| 22 | `1` | `1` | **PASS** |
| 23 | `OK` | `OK` | **PASS** |
| 24 | `1` | `1` | **PASS** |
| 25 | `1` | `1` | **PASS** |
| 26 | `1` | `1` | **PASS** |
| 27 | `1` | `1` | **PASS** |
| 28 | `1` | `1` | **PASS** |
| 29 | `2` | `2` | **PASS** |
| 30 | `0` | `0` | **PASS** |

**30 of 30 pass. None was skipped, none was unobtainable, and none is partial.**

---

## 9. Scope — confirmation from #29 and #30

```
$ git diff --name-only HEAD -- lib/domain/adherence.ts lib/domain/adherence.test.ts | wc -l | tr -d " "
2

$ git diff --name-only HEAD | grep -vE '^(lib/domain/adherence(\.test)?\.ts|plan/)' | wc -l | tr -d ' '
0

$ git diff --stat HEAD
 lib/domain/adherence.test.ts | 376 +++++++++++++++++++++++++++++++++++++++----
 lib/domain/adherence.ts      | 166 +++++++++++++++----
 plan/QUEUE.md                |  38 +++++
 3 files changed, 523 insertions(+), 57 deletions(-)

$ git status --porcelain | grep -v '^??'
 M lib/domain/adherence.test.ts
 M lib/domain/adherence.ts
 M plan/QUEUE.md
```

`plan/QUEUE.md` is the orchestrator's, modified before I was dispatched, and I did not touch it.
`tsconfig.json`, `vitest.config.mts`, `components/BudgetMonthlyGrid.tsx`, `lib/budgetMath.ts`,
`scripts/`, `shared/` and `migrations/` are all unmodified. The only files I wrote are the two
source files above and this `EVIDENCE.md`. `SPEC.md` was not edited; its `.frozen` marker stands.

---

## 10. Whole-suite state

```
$ npm test 2>&1 | tail -6

 Test Files  19 passed (19)
      Tests  344 passed (344)
   Start at  22:27:50
   Duration  4.64s (transform 482ms, setup 0ms, import 849ms, tests 4.53s, environment 1ms)

```

Baseline was `19 passed (19)` / `332 passed (332)`. The delta is exactly the 12 new tests in this
module; no other test file's count moved.

---

## 11. Findings for the orchestrator

- **Nothing wrong found in the spec.** All eleven fixtures' arithmetic re-derived independently
  before implementation and all agree, including Fixture C's `-0.6222222222222222` old-value pin
  (old numerator over old denominator, exactly as GATES.md adjudicated). The four decided questions
  were implemented as decided and I have no dissent to record on any of them.
- **No contract change was required.** Nothing was worked around locally; no shape was widened at a
  call site; the `PreToolUse` hook was never hit because no protected path was approached.
- **One documentation nit, not a defect and not acted on:** SPEC.md acceptance #18's expectation is
  cross-referenced from the module's own comment at line 91 as "SPEC.md acceptance #25" — that
  pointer was inherited verbatim from P0.5-29's spec, where the coupling grep was #25, and it now
  points at a different row in *this* spec. I left the comment as it stands rather than renumbering
  it: the line is P0.5-29's, editing it would be an unrequested change to an unrelated comment, and
  the grep it refers to (#18 here) passes either way. Flagging it so it is a decision on the record
  rather than something the reviewer discovers.
- **Carried forward as known caller-contract hazards for step 31**, both worse in blast radius after
  this change and both explicitly out of scope: N18 (duplicate `month` entries now inflate the
  headline denominator as well as a window) and N15 (an out-of-range `month` now contributes a
  substituted even-spread budget to the denominator).
- **N19 inherited, measured, not fixed:** the headline's denominator is the rounded per-month
  schedule, so a $1,000 annual budget quotes against $999.96 rather than $1,000.00 — a denominator
  0.004% low. On the binding fixture that is −8.324% against −8.333%; both print as "8.3% under".

---

## 12. Cycle 1 after G3 BLOCK — the negative-zero guard gets a gate that exists

**Scope of this cycle:** `lib/domain/adherence.test.ts` only. `lib/domain/adherence.ts` is
byte-identical to what G2 measured; no implementation was re-opened, no existing test was modified
or renamed, two tests were added.

### 12.1 What was wrong

G3 measured `withoutNegativeZero` (`lib/domain/adherence.ts:354`, applied at `:466` and `:483`) as
load-bearing but ungated: stripping the guard from both call sites left `npx tsc --noEmit` at exit
0, `npm test` at `19 passed (19)` / `344 passed (344)`, and all 30 acceptance commands green —
including #4, which SPEC.md's Negative controls row 10 names as the control for "Perfect adherence
never prints as negative zero".

The reason is in Fixture D itself. Its twelve months land exactly on budget, so every per-month
variance is `+0`, and `+0 + +0` is `+0` deterministically for any number of terms. The fixture
therefore never produces the value its own `Object.is(..., -0)` assertions claim to exclude — it
asserts a property of an input that cannot violate it. Per BUILD.md §5.5 that is a command passing
vacuously, i.e. a gate that does not exist.

Fixture D is **not** modified. It is the N12 case (perfect adherence is a real headline, not
`null`) and acceptance #4 pins it by name. The two new tests sit immediately after it and carry the
negative-zero control that Fixture D cannot.

### 12.2 The two new tests

Both are in `describe('scoredHeadline', ...)`, added directly after the perfect-adherence case.
Verbatim names:

1. `per-month variances that cancel to negative float dust report a positive-zero headline variance, so a run that nets out to nothing cannot print minus zero either`
2. `a budgeted total that overflows to infinity divides a genuinely negative variance down to minus zero, so the ratio is normalised on its own account and not only through the variance`

**Test 1 — the `:466` gate.** One scored category, `annual_budget: 1200`, `monthly_amounts: null`
(so every month is budgeted exactly `100`), three supplied months with actuals `100.01`, `99.93`,
`100.06`. All data fabricated.

    per-month variance   roundCents(100.01 - 100) =  0.01
                         roundCents( 99.93 - 100) = -0.07
                         roundCents(100.06 - 100) =  0.06
    raw sum              0.01 + -0.07             = -0.060000000000000005
                         -0.060000000000000005 + 0.06 = -6.938893903907228e-18
    sumCents(residue)    Math.round(-6.938893903907228e-16) / 100 = -0
    budgeted             sumCents([100, 100, 100]) = 300
    actual               sumCents([100.01, 99.93, 100.06]) = 300

So `variance` arrives at the guard as `-0` from three months of ordinary cent arithmetic, and
`-0 / 300` is `-0` again. Asserted: `budgeted 300`, `actual 300`, `breachCount 2`, `defectCount 0`,
`variance` `toBe(0)` and `Object.is(variance, -0) === false`, `varianceRatio` `toBe(0)` and
`Object.is(varianceRatio, -0) === false`. (Vitest's `toBe` compares with `Object.is`, so the `toBe`
lines already separate `0` from `-0`; the explicit `Object.is` assertions state the intent rather
than leaving it to a matcher's equality semantics, exactly as Fixture D does.)

Two months are over budget in this fixture, which is unavoidable and is stated in the test's
comment: a sum of same-signed cent figures cannot land on float dust, so reaching the residue at all
requires variances of both signs. The assertion is about the sign of the *total*, and the total is
nothing.

**Test 2 — the `:483` gate.** NITS N23 is correct that the ratio guard is unreachable *given* the
variance guard for any finite denominator, and the reachability argument is worth recording because
it decides what the test has to look like:

- `roundCents(n)` is `Math.round(n * 100) / 100`, so every non-zero output is at least `0.01` in
  magnitude. A `variance` that survives the `:466` guard non-zero is therefore `<= -0.01` or
  `>= 0.01`.
- `-0.01 / budgeted` underflows to `-0` only once `budgeted` exceeds `0.01 / Number.MIN_VALUE`
  ≈ `2e321`, which is past `Number.MAX_VALUE` (`1.7976931348623157e308`).
- So the **only** input shape that reaches `:483` is `budgeted === Infinity` with a finite negative
  `variance` — and `sumCents` manufactures exactly that out of finite parts, because it re-rounds
  (i.e. re-multiplies by 100) a sum whose terms each individually survived `roundCents`.

The fixture: `monthly_amounts: [1e306 × 11, 100]`, twelve supplied months with actuals
`[1e306 × 11, 99.99]`. Each `roundCents(1e306)` is finite (`1e306 * 100 = 1e308`), each of the first
eleven months has variance `+0`, and the twelfth is a real one-cent underspend.

    budgeted   sumCents([1e306 × 11, 100]) -> raw 1.1e307, * 100 overflows -> Infinity
    actual     Infinity, same way
    variance   sumCents([0 × 11, -0.01]) = -0.01     (genuinely negative; :466 does not touch it)
    ratio      -0.01 / Infinity = -0

Asserted: `budgeted Infinity`, `actual Infinity`, `variance -0.01`, `breachCount 0`, `defectCount 0`
(no month is strictly over budget and none is below half its budget, so neither detector fires),
`varianceRatio` `toBe(0)` and `Object.is(varianceRatio, -0) === false`.

Nothing about this input is a plausible budget and the test does not present it as one. The
`budgeted`/`actual` `Infinity` assertions are recorded in the test as **preconditions of the probe,
not guarantees of the module**: if `sumCents` ever stopped overflowing here, the quotient would stop
underflowing too, and this test would fail loudly rather than silently returning `:483` to being an
unreached guard. That is the intended behaviour of the assertion.

### 12.3 Per-site mutation results

Each mutation replaces the named line with the unguarded expression, runs
`npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts`, then restores the
file. Mutation text used:

    :466   const variance = sumCents(months.map((month) => month.variance));
    :483       varianceRatio: budgeted > 0 ? variance / budgeted : null,

| Mutation | Result | What went red |
| --- | --- | --- |
| `:466` removed only | `Tests  1 failed \| 47 passed (48)` | Test 1, at `adherence.test.ts:635` — `expect(headline.variance).toBe(0)`, `AssertionError: expected -0 to be +0 // Object.is equality`. Test 1's `varianceRatio` assertions still pass, because `:483` normalises the `-0` back out one line later. |
| `:483` removed only | `Tests  1 failed \| 47 passed (48)` | Test 2, at `adherence.test.ts:686` — `expect(headline.varianceRatio).toBe(0)`, `AssertionError: expected -0 to be +0 // Object.is equality`. Test 1 stays green, as it must: with `:466` present its variance is `+0` and `0 / 300` is `+0`. |
| both removed | `Tests  2 failed \| 46 passed (48)` | Test 1 at `:635` and Test 2 at `:686`, both `expected -0 to be +0 // Object.is equality`. |
| neither (shipped state) | `Tests  48 passed (48)` | — |

No pre-existing test failed under any mutation, which is the same measurement G3 made and is why
the guard needed its own coverage rather than a strengthened assertion elsewhere.

`shasum -a 256 lib/domain/adherence.ts` after the last restore:

    c3c9f47cc8581773cd98213abffde92ae7f16c3ac9f5b210f0b5765de7ac65b1  lib/domain/adherence.ts

### 12.4 Test-name set comparison against `HEAD`

    git show HEAD:lib/domain/adherence.test.ts | grep -oE "^  it\(.*" | sort  -> head.names
    grep -oE "^  it\(.*" lib/domain/adherence.test.ts | sort                  -> now.names

    comm -23 head.names now.names   (present at HEAD, gone now)
      it('reports null for the variance ratio when every scored finding sits on a month that budgeted nothing', () => {
      it('the scored-set headline is null, not zero or NaN, when no finding in the input belongs to the scored set', () => {

    comm -13 head.names now.names | wc -l   (added)
      16

The two removals are exactly the two documented renames already adjudicated at G2 (`finding` ->
`category` scoping in both names); nothing else present at `HEAD` is gone. 16 additions = the 14
from the original cycle plus the 2 from this one. The 32 verbatim-unchanged tests are unchanged.

### 12.5 Re-run of the named acceptance commands

**#1** — not in the requested set but re-run because a test file changed:

    $ npx tsc --noEmit
    (no output)
    exit=0

**#2**

    $ npm test 2>&1 | grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"
    1

Whole-suite lines from the same run:

     Test Files  19 passed (19)
          Tests  346 passed (346)

`344 -> 346`: exactly the two tests added in this cycle. No other test file's count moved.

**#3**

    $ test $(npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 \
        | grep -cE "✓ lib/domain/adherence\.test\.ts") -ge 46 && echo OK
    OK

    $ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 \
        | grep -cE "✓ lib/domain/adherence\.test\.ts"
    48

`46 -> 48`, still `-ge 46`.

**#4**

    $ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 \
        | grep -cF "perfect adherence across the scored categories produces a real headline at variance zero rather than null, and the ratio is positive zero so no surface can print minus zero percent"
    1

Still `1` — Fixture D's test is untouched, and the two new names are deliberately distinct enough
that neither is matched by this `grep -cF`, so the count stays exactly `1` rather than becoming `3`.

**#29**

    $ git diff --name-only HEAD -- lib/domain/adherence.ts lib/domain/adherence.test.ts | wc -l | tr -d " "
    2

**#30**

    $ git diff --name-only HEAD | grep -vE '^(lib/domain/adherence(\.test)?\.ts|plan/)' | wc -l | tr -d " "
    0

**Module untouched**

    $ shasum -a 256 lib/domain/adherence.ts
    c3c9f47cc8581773cd98213abffde92ae7f16c3ac9f5b210f0b5765de7ac65b1  lib/domain/adherence.ts

Matches the hash the orchestrator recorded at dispatch.

### 12.6 Working tree

    $ git status --short
     M lib/domain/adherence.test.ts
     M lib/domain/adherence.ts
     M plan/QUEUE.md
    ?? "lib/domain/adherence 2.ts"
    ?? "migrations/1788271200000_category-control-mode 2.sql"
    ?? "plan/tasks/P0.5-28-category-control-mode/.frozen 2"
    ?? "plan/tasks/P0.5-28-category-control-mode/EVIDENCE 2.md"
    ?? "plan/tasks/P0.5-28-category-control-mode/GATES 2.md"
    ?? "plan/tasks/P0.5-28-category-control-mode/ITEM 2.md"
    ?? "plan/tasks/P0.5-28-category-control-mode/NITS 2.md"
    ?? "plan/tasks/P0.5-28-category-control-mode/SPEC 2.md"
    ?? "plan/tasks/P0.5-29-adherence-definition/.frozen 2"
    ?? "plan/tasks/P0.5-29-adherence-definition/EVIDENCE 2.md"
    ?? "plan/tasks/P0.5-29-adherence-definition/GATES 2.md"
    ?? "plan/tasks/P0.5-29-adherence-definition/ITEM 2.md"
    ?? "plan/tasks/P0.5-29-adherence-definition/SPEC 2.md"
    ?? plan/tasks/P0.5-29a-headline-scope/

Byte-identical to the status at the start of this cycle. The `… 2.*` entries are the pre-existing
Finder/iCloud duplicates covered by SPEC.md T4 — untracked, not created or touched here, and
therefore invisible to #30, which counts tracked modifications. All mutation and arithmetic probe
files were written under the session scratchpad, outside the repo, and deleted.

### 12.7 Findings for the orchestrator

- **N23 is half right, and the half that is wrong is worth recording.** The `:483` guard is
  unreachable for every input whose `budgeted` total is finite — the underflow arithmetic in §12.2
  is a proof, not an observation — but it is not dead code: `sumCents` can return `Infinity` from
  finite per-month figures, and that is a real, if degenerate, path to `-0`. Test 2 covers it and
  bites when only `:483` is removed.
- **If the reviewer judges Test 2's fixture out of scope** as a degenerate-float probe rather than a
  money case, the honest consequence is not "write a different test": it is that `:483` is
  unreachable for every input this domain will ever see, and the guard there is dead code that
  should be deleted from the module. That is a module change and therefore an orchestrator decision,
  not mine. I have not made it, and I state the alternative here so it is on the record rather than
  resolved silently by a test that appears to cover the site without biting.
- **Fixture D was left alone deliberately.** It could have been given a fourth over-budget month to
  make it produce the residue itself, but its whole point is that `detectAdherence(rows)` returns
  `[]` for a flawless run (the N12 case), and any month that produces the residue also produces a
  breach. Splitting the two concerns into separate tests keeps both provable.
- **No module change, no spec change, no `GATES.md` or `NITS.md` edit.** Nothing was worked around
  locally and the `PreToolUse` hook was not approached.

### 12.8 Coordinator ruling — Test 2 removed, `:483` guard kept and deliberately ungated

The escalation in §12.7 was adjudicated by the orchestrator against the **column types** rather
than against float limits, which settles the reachability question §12.2 could only bound:

    db/schema.sql:168   annual_budget    NUMERIC(12, 2)
    db/schema.sql:176   monthly_amounts  NUMERIC(12, 2)[]

`NUMERIC(12, 2)` caps a single entry at **9,999,999,999.99** (~1e10). Twelve entries therefore sum
to at most ~1.2e11, and `sumCents` re-multiplying that by 100 reaches ~1.2e13 — thirteen orders of
magnitude short of `Number.MAX_VALUE` (~1.7976931348623157e308). **`budgeted === Infinity` is
unreachable from any contract-conforming row.** §12.2's `1e306` fixture was asserting semantics for
an input the schema cannot produce.

So NITS N23 is confirmed in full, not half: given the normalisation at `:466`, the guard at `:483`
is unreachable for every input the contract permits.

**Why the test goes and the guard stays.** The G3 BLOCK was for a *reachable* defect with a vacuous
gate — `-0` genuinely escapes at `:466`, and Fixture D never reached it. An unreachable branch is a
different thing: there is no reachable defect for a legitimate fixture to gate, and a test whose
input cannot exist makes the suite look like it covers more than it does — the same failure the
BLOCK named, pointing the other way. `withoutNegativeZero` is a general helper and `:483` costs
nothing, so it stays as documented belt-and-braces, deliberately ungated because nothing conforming
reaches it. The module is **not** edited: the guard is not deleted.

**Change made:** the test named
`a budgeted total that overflows to infinity divides a genuinely negative variance down to minus zero, so the ratio is normalised on its own account and not only through the variance`
was deleted in full. It had no fixture helper of its own — its `overflowingSchedule` constant was
local to the test body — so nothing else needed removing, and `grep -c "1e306\|overflowingSchedule\|overflows to infinity" lib/domain/adherence.test.ts` returns `0`. Test 1
(`per-month variances that cancel to negative float dust…`) is kept byte-for-byte as §12.2
describes it. Nothing else in the file changed.

**Re-measured mutation results.** Same mutation text as §12.3, now run against the reduced suite
with `npm test`:

| Mutation | Result | Note |
| --- | --- | --- |
| `:466` removed only | `Tests  1 failed \| 344 passed (345)` | Test 1 red — `expected -0 to be +0 // Object.is equality`. The reachable guard is gated. |
| `:483` removed only | `Tests  345 passed (345)` | **Green, and this is the honest state, not a regression.** No contract-conforming input reaches this branch, so no test can distinguish its presence. Recorded explicitly so a future mutation sweep reads this as adjudicated rather than as a coverage hole. |
| both removed | `Tests  1 failed \| 344 passed (345)` | Test 1 red, from the `:466` removal alone. |
| neither (shipped state) | `Tests  345 passed (345)` | — |

**Re-measured acceptance commands.**

    $ npx tsc --noEmit
    exit=0                                    # #1, re-run because a test file changed

    $ npm test 2>&1 | grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"
    1                                         # #2

     Test Files  19 passed (19)
          Tests  345 passed (345)             # 346 -> 345, exactly the one test removed

    $ test $(npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 \
        | grep -cE "✓ lib/domain/adherence\.test\.ts") -ge 46 && echo OK
    OK                                        # #3

    $ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 \
        | grep -cE "✓ lib/domain/adherence\.test\.ts"
    47                                        # #3 count, 48 -> 47, still -ge 46

    $ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 \
        | grep -cF "perfect adherence across the scored categories produces a real headline at variance zero rather than null, and the ratio is positive zero so no surface can print minus zero percent"
    1                                         # #4

    $ git diff --name-only HEAD -- lib/domain/adherence.ts lib/domain/adherence.test.ts | wc -l | tr -d " "
    2                                         # #29

    $ git diff --name-only HEAD | grep -vE '^(lib/domain/adherence(\.test)?\.ts|plan/)' | wc -l | tr -d " "
    0                                         # #30

    $ shasum -a 256 lib/domain/adherence.ts
    c3c9f47cc8581773cd98213abffde92ae7f16c3ac9f5b210f0b5765de7ac65b1  lib/domain/adherence.ts

Module sha unchanged from dispatch, and unchanged across the three mutations above (each was
restored from a scratchpad copy outside the repo, since deleted). `git status --short` is
byte-identical to §12.6. The net of this cycle is **one** added test.
