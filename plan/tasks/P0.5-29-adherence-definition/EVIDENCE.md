# EVIDENCE — P0.5-29-adherence-definition

**Implementer.** Branch `p0.5-29/adherence-definition`. Spec frozen at G0 draft 2; G1 skipped
(contract surface untouched — and nothing during implementation contradicted that: no type or
column needed changing, `shared/types.ts` was read, never written).

**Result: all 26 acceptance commands produce their specified output.** Verbatim capture in §6.

## 1. Summary of the 26

| # | Expected | Observed | ✓ |
|---|---|---|---|
| 1 | exit 0 | exit 0 | ✅ |
| 2 | exit 0 | exit 0 — `19 passed (19)` files, `332 passed (332)` tests | ✅ |
| 3 | one matching line | `      Tests  34 passed (34)` — one line, no skipped segment | ✅ |
| 4 | `1` | `1` | ✅ |
| 5 | `1` | `1` | ✅ |
| 6 | `1` | `1` | ✅ |
| 7 | `1` | `1` | ✅ |
| 8 | `1` | `1` | ✅ |
| 9 | `1` | `1` | ✅ |
| 10 | `1` | `1` | ✅ |
| 11 | `1` | `1` | ✅ |
| 12 | `1` | `1` | ✅ |
| 13 | `1` | `1` | ✅ |
| 14 | `1` | `1` | ✅ |
| 15 | `1` | `1` | ✅ |
| 16 | `1` | `1` | ✅ |
| 17 | `1` | `1` | ✅ |
| 18 | `1` | `1` | ✅ |
| 19 | `1` | `1` | ✅ |
| 20 | `1` | `1` | ✅ |
| 21 | `1` | `1` | ✅ |
| 22 | `1` | `1` | ✅ |
| 23 | `1` — P0.5-28's test, unmodified | `1` | ✅ |
| 24 | `1` — P0.5-28's test, unmodified | `1` | ✅ |
| 25 | `0` | `0` | ✅ |
| 26 | `0` | `0` | ✅ |

**Two notes on exit codes, stated plainly so nobody has to guess at G2.**

- **#25 and #26 exit `1`, and that is the passing outcome.** `grep -c` exits 1 when the count is
  zero. The spec's Expected column for both is the *printed count* `0`, not exit 0 — the same
  reading the G0 review used when it measured the corrected #26 returning `1` on `lib/drift.ts` and
  `0` on `lib/domain/adherence.ts`. Both commands print `0`.
- **#25 caught a real defect in my first draft.** It is a literal string grep, not an import check:
  my first version of the module never imported the incumbent but *named* it three times in
  comments explaining why it doesn't, and #25 returned `3`. Rewritten to describe the incumbent
  without naming it, with a comment saying exactly that so the next reader does not re-add it. The
  substantive rule — no import, no `monthPct`, no `Infinity` — holds either way; the command is
  stricter than the rule and I conformed to the command.

## 2. Test-suite delta

Baseline on this branch (GATES.md): 19 files / 311 tests. Now: **19 files / 332 tests**, +21.
All 21 are in `lib/domain/adherence.test.ts`: the 19 pinned by #4–22, plus two unpinned ones that
close gaps the pinned set leaves open (finding order determinism; the headline's own
divide-by-zero, which is a different one from #19's). Nothing is `.skip`ped, `.todo`ed, or
`.only`ed — #3 is the assertion of that, and it matches because vitest prints no skipped segment.

## 3. Worked trace — the roadmap's own example

`$500 budgeted, $120 drawn, twelve months.` Fabricated figures. Input: `annual_budget = 6000`,
`monthly_amounts = null`, twelve `MonthSpend` entries `{ month: 0…11, actual: 120 }`, a category
that is `landscape = 'operational'`, `exclude_from_budget = false`, `is_income = false`.

**Step 1 — the gate.** `isTrackedCategory` passes on all three conjuncts, so findings are
*produced*. `control_mode` is not consulted here; it only sets `scored` in step 5.

**Step 2 — `budgeted[m]`.** No schedule, so the even-spread rule applies:
`roundCents(6000 / 12) = 500.00`, identically for all twelve months. Rounded here, at the month,
not carried as a raw quotient into the arithmetic below.

**Step 3 — per-month variance.** `variance[m] = roundCents(actual[m] − budgeted[m])`, in that
order, month by month:

| m | budgeted[m] | actual[m] | variance[m] | ratio[m] | breach? |
|---|---|---|---|---|---|
| 0 | 500.00 | 120.00 | −380.00 | 0.24 | no |
| 1 | 500.00 | 120.00 | −380.00 | 0.24 | no |
| 2 | 500.00 | 120.00 | −380.00 | 0.24 | no |
| 3 | 500.00 | 120.00 | −380.00 | 0.24 | no |
| 4 | 500.00 | 120.00 | −380.00 | 0.24 | no |
| 5 | 500.00 | 120.00 | −380.00 | 0.24 | no |
| 6 | 500.00 | 120.00 | −380.00 | 0.24 | no |
| 7 | 500.00 | 120.00 | −380.00 | 0.24 | no |
| 8 | 500.00 | 120.00 | −380.00 | 0.24 | no |
| 9 | 500.00 | 120.00 | −380.00 | 0.24 | no |
| 10 | 500.00 | 120.00 | −380.00 | 0.24 | no |
| 11 | 500.00 | 120.00 | −380.00 | 0.24 | no |

Measured, not asserted — this is the module's own `months` array, printed from a throwaway probe
that was deleted afterwards (`git status` in §5 confirms it left nothing behind).

**Step 4 — why no month breaches.** The breach test is `actual[m] > budgeted[m]`, strictly.
`120 > 500` is false in all twelve months, so the breach detector emits nothing for this category.
The variance is *negative* in every month, which is the whole point of fixing the subtraction order
at the type: reversed, this category would report twelve $380 "overspends" and the module would be
confidently backwards while every total still looked plausible.

**Step 5 — why the window qualifies as chronic.**
- Qualifying months = months with `budgeted[m] > 0`. All twelve qualify; none is a $0-budget month.
- `12 ≥ CHRONIC_MIN_MONTHS (3)` ✓
- `ratio[m] = 120 / 500 = 0.24 < CHRONIC_UNDERSPEND_RATIO (0.50)` for **every** qualifying month —
  not for their average. One month at 100% would break it; #9 is the negative control.
- ⇒ **one** `chronic-underspend` finding for the category, not twelve.

Window totals, summed from the already-rounded per-month figures and re-rounded:
`budgeted 6000.00`, `actual 1440.00`, `variance −4560.00` ( = 12 × −380.00 ).

**Step 6 — the `scored` flag, under each control mode.** Same input, only `control_mode` differing:

| `control_mode` | finding produced | `scored` | `scoredHeadline([finding])` |
|---|---|---|---|
| `discretionary` | 1 × chronic-underspend | **true** | `{findingCount:1, breachCount:0, defectCount:1, budgeted:6000, actual:1440, variance:-4560, varianceRatio:-0.76}` |
| `fixed` | 1 × chronic-underspend | **false** | **`null`** |
| `variable-necessary` | 1 × chronic-underspend | **false** | **`null`** |

The finding itself is byte-identical in all three rows apart from `scored` — `variable-necessary`
is tracked exactly as `fixed` is, not as a softer case of it (asserted by `toEqual` in #13).

**Step 7 — what the incumbent says about the same twelve months.**
`expenseCellStyle(120, 500, false, false)` → `monthPct = 0.24` → not `> 1.1`, not `> 1.0`, not
`> 0.5` → **`bg-green-50`**, twelve times. The grid is telling the truth about every individual
cell and saying nothing whatsoever about the year. That is the structural gap this module fills,
and #18 asserts both halves of it in one test.

## 4. Fixture table — every combination behind #11–17

Three `control_mode` values × two variance shapes × the three exclusion gates plus the passing
baseline. 24 rows, all measured by running `detectAdherence` (probe since deleted), not reasoned
about. Fabricated throughout: `annual_budget $1,200`, no schedule ⇒ `$100.00/month`.

| Category gates | `control_mode` | Shape | Result |
|---|---|---|---|
| operational, not excluded, not income | fixed | overspend $400/mo vs $100/mo, 3 months | 3x breach, scored=false |
| operational, not excluded, not income | fixed | chronic $20/mo vs $100/mo, 4 months | 1x chronic-underspend, scored=false |
| operational, not excluded, not income | variable-necessary | overspend $400/mo vs $100/mo, 3 months | 3x breach, scored=false |
| operational, not excluded, not income | variable-necessary | chronic $20/mo vs $100/mo, 4 months | 1x chronic-underspend, scored=false |
| operational, not excluded, not income | discretionary | overspend $400/mo vs $100/mo, 3 months | 3x breach, scored=true |
| operational, not excluded, not income | discretionary | chronic $20/mo vs $100/mo, 4 months | 1x chronic-underspend, scored=true |
| landscape = capital | fixed | overspend $400/mo vs $100/mo, 3 months | no finding |
| landscape = capital | fixed | chronic $20/mo vs $100/mo, 4 months | no finding |
| landscape = capital | variable-necessary | overspend $400/mo vs $100/mo, 3 months | no finding |
| landscape = capital | variable-necessary | chronic $20/mo vs $100/mo, 4 months | no finding |
| landscape = capital | discretionary | overspend $400/mo vs $100/mo, 3 months | no finding |
| landscape = capital | discretionary | chronic $20/mo vs $100/mo, 4 months | no finding |
| exclude_from_budget = TRUE | fixed | overspend $400/mo vs $100/mo, 3 months | no finding |
| exclude_from_budget = TRUE | fixed | chronic $20/mo vs $100/mo, 4 months | no finding |
| exclude_from_budget = TRUE | variable-necessary | overspend $400/mo vs $100/mo, 3 months | no finding |
| exclude_from_budget = TRUE | variable-necessary | chronic $20/mo vs $100/mo, 4 months | no finding |
| exclude_from_budget = TRUE | discretionary | overspend $400/mo vs $100/mo, 3 months | no finding |
| exclude_from_budget = TRUE | discretionary | chronic $20/mo vs $100/mo, 4 months | no finding |
| is_income = TRUE | fixed | overspend $400/mo vs $100/mo, 3 months | no finding |
| is_income = TRUE | fixed | chronic $20/mo vs $100/mo, 4 months | no finding |
| is_income = TRUE | variable-necessary | overspend $400/mo vs $100/mo, 3 months | no finding |
| is_income = TRUE | variable-necessary | chronic $20/mo vs $100/mo, 4 months | no finding |
| is_income = TRUE | discretionary | overspend $400/mo vs $100/mo, 3 months | no finding |
| is_income = TRUE | discretionary | chronic $20/mo vs $100/mo, 4 months | no finding |

**What the table shows, and what it would show if the implementation were wrong.**

- The first six rows are the Q3 answer made measurable: **both** detectors fire for all three
  control modes. A detector restricted to `isScoredCategory`'s four conjuncts — the blind spot the
  spec names — would read "no finding" in the four `fixed` / `variable-necessary` rows, and #11–13
  would fail while #14–17 still passed.
- The eighteen exclusion rows are uniformly "no finding" *including* the `discretionary` ones. That
  is the point: `landscape` / `exclude_from_budget` / `is_income` gate finding production
  regardless of `control_mode`, and a capital row's `control_mode` is inert.
- `scored` tracks `control_mode` alone, and only within the tracked set.

## 5. Diff-level confirmations

### 5.1 `isScoredCategory`'s 13 tests are present, unmodified

The whole diff to `lib/domain/adherence.test.ts` is two hunks:

```
@@ -1,5 +1,18 @@     — the import block
@@ -125,3 +138,385 @@  — a pure append after the existing describe's closing `});`
```

Exactly **one** line is removed from the file, and it is the import statement:

```
$ git diff lib/domain/adherence.test.ts | grep "^-" | grep -v "^---"
-import { isScoredCategory, type ScorableCategory } from './adherence';
```

Nothing inside `describe('isScoredCategory', …)` — lines 20–140 of the new file — is touched: no
name, no assertion, no comment, no fixture. The 13 names still print verbatim, in their original
order:

```
✓ … > isScoredCategory > includes an operational, non-excluded, non-income category classified discretionary in the scored set
✓ … > isScoredCategory > excludes a fixed category from the scored set even though it is operational, not excluded, and not income
✓ … > isScoredCategory > excludes a variable-necessary category from the scored set — tracked and reported, never scored, same as fixed
✓ … > isScoredCategory > excludes a capital-landscape category from the scored set even when its control_mode is discretionary
✓ … > isScoredCategory > excludes an exclude_from_budget category from the scored set even when its control_mode is discretionary
✓ … > isScoredCategory > excludes an is_income category from the scored set even when its control_mode is discretionary
✓ … > isScoredCategory > treats the two non-discretionary modes identically rather than ranking them
✓ … > isScoredCategory > stays out when more than one conjunct fails at once
✓ … > isScoredCategory > accepts a whole BudgetCategory row, so no caller needs a local shape for it
✓ … > isScoredCategory > excludes a row whose control_mode is absent, the shape an out-of-contract SELECT produces at runtime
✓ … > isScoredCategory > excludes a row whose control_mode is an unrecognized string, rather than reading anything not-fixed as scored
✓ … > isScoredCategory > excludes a row whose exclude_from_budget arrives null, rather than reading a missing flag as not-excluded
✓ … > isScoredCategory > excludes a row whose is_income arrives undefined, rather than reading a missing flag as not-income
```

13 of 13. #23 and #24 pin the first and fourth of them.

### 5.2 `isScoredCategory`'s observable behaviour is unchanged

The spec explicitly permits refactoring the shared conjuncts into a common helper; it forbids
changing what the predicate does. Exactly two lines were removed from the module:

```
$ git diff lib/domain/adherence.ts | grep "^-" | grep -v "^---"
-    category.is_income === false &&
-    category.control_mode === 'discretionary'
```

The body became `isTrackedCategory(category) && category.control_mode === 'discretionary'`, where
`isTrackedCategory` is the first three conjuncts verbatim, in the same order, with the same `===`
comparisons — including the `=== false` fail-closed forms the two null/undefined tests depend on.
`&&` is associative and short-circuits identically, so the truth table is unchanged; the 13 tests,
which include the four out-of-contract cases, are the mechanical check on that claim.

This is the reuse the spec asked for. Both detectors call `isTrackedCategory`; there is no second
copy of the three conjuncts anywhere in the module, which was the named failure mode — duplication
on the very predicate P0.5-28 exists to have one definition of.

### 5.3 Nothing outside the two files changed

```
$ git status --short
 M lib/domain/adherence.test.ts
 M lib/domain/adherence.ts
 M plan/QUEUE.md
?? plan/tasks/P0.5-29-adherence-definition/

$ git diff --stat
 lib/domain/adherence.test.ts | 397 ++++++++++++++++++++++++++++++++++++++++++-
 lib/domain/adherence.ts      | 312 +++++++++++++++++++++++++++++++++-
 plan/QUEUE.md                |   1 +
 3 files changed, 707 insertions(+), 3 deletions(-)
```

`plan/QUEUE.md` (1 line) and `plan/tasks/P0.5-29-adherence-definition/` are the **orchestrator's**
own task state — they were already in the tree when I was dispatched and I have not edited either,
other than adding this `EVIDENCE.md`. Reported rather than silently folded in, since G2 reviews
`git status --short` line by line.

`AGENTS.md` is **not** dirty — no `next dev` ran during this task, and nothing Next-facing was
touched (T8 correctly declared "NO").

Also confirmed clean: no new file was left behind by the probes used to produce §3 and §4. Both
were temporary test files under `lib/domain/`, run and then deleted; the `git status` above is
after the deletion, and `npm test` reports 19 files, the same count as the branch baseline.

Lint is unchanged from the branch baseline — exit 0 with the one pre-existing warning:

```
$ npm run lint
/Users/…/app/scripts/seed-demo.mjs
  438:17  warning  'pid' is assigned a value but never used…
✖ 1 problem (0 errors, 1 warning)
```

## 6. Design decisions worth a reviewer's attention

These are decisions the spec left to the implementer. Stated here rather than left to be inferred
from the diff.

1. **`AdherenceInput` is projected off `BudgetCategory`, not re-declared.**
   `ScorableCategory & Pick<BudgetCategory, 'id' | 'name' | 'annual_budget' | 'monthly_amounts'> &
   { months: MonthSpend[] }`. No local shape for a row `shared/types.ts` already describes, matching
   `ScorableCategory`'s own precedent. `shared/types.ts` was read and not written.
2. **`month` is the 0–11 calendar index**, the same indexing `monthly_amounts` uses and the same
   convention `components/BudgetMonthlyGrid.tsx`'s `GridRow` documents (`index 0–11`). Which months
   are supplied is entirely the caller's business — that is what makes the module clock-free.
3. **`ratio` is `number | null`, never `Infinity`.** A `$0`-budget month has no baseline, so there
   is no percentage to report. This is `null`-is-not-`0` applied to a ratio.
4. **Findings are emitted in calendar order**, from a sorted copy of the caller's array, so two
   callers holding the same year in different orders get identical output. Covered by an unpinned
   test; without it the module's output would be a function of an incidental array order.
5. **`scoredHeadline` returns `ScoredHeadline | null`, not a struct with nullable fields.** The
   empty-scored-set case is one state, not seven. It is `null` on exactly the input the demo seeder
   produces today (every row `fixed` ⇒ empty scored set, P0.5-28 N7), which #19 fixtures directly.
6. **The headline has a *second* divide-by-zero, which #19 does not reach**, so I covered it with
   an unpinned test: a scored finding can sit on a `$0`-budget month, making the headline's
   denominator zero even though the scored set is non-empty. `varianceRatio` is `null` there, not
   `Infinity`. Naming it because it is exactly the class of thing the spec's own failure-mode list
   is about, and it would otherwise have shipped untested.
7. **No month is double-counted in the headline.** A chronic window contains only months under half
   their budget, so none of them can also be a breach; and a `$0`-budget breach month is excluded
   from every window. The exclusivity is structural, not incidental, and is commented as such.
8. **`budgetedForMonth` is deliberately *not* exported.** Per non-goal #14 this module computes the
   even-spread rule for its own inputs without becoming the site the other four implementations
   call through; exporting it would be an invitation to make it the fifth one's home without doing
   the migration. `app/api/chat/route.ts`, `app/budget/page.tsx`,
   `components/BudgetMonthlyGridClient.tsx` and `components/BudgetMonthlyGrid.tsx` are all
   unchanged.
9. **Rounding is per step, everywhere.** `budgeted`, `actual` and `variance` are each rounded at the
   month; window and headline totals sum already-rounded values through one `sumCents` helper and
   re-round. #22's fixture is engineered so the shortcut is visible: on a $1,000 annual budget,
   round-per-month gives `−759.96` and round-once-at-the-end gives `−760.00`, and the test asserts
   the first *and* asserts inequality against the second computed inline.
10. **Palette:** none. This task ships no UI. The one colour literal anywhere in the diff is
    `'bg-green-50'` inside #18's assertion, which is `lib/budgetColors.ts`'s own return value being
    compared against, not a new token.

## 7. Verbatim output of all 26 acceptance commands

Run from the repo root, in order, against the tree as committed. `…` is not used below — every
command is reproduced in full, exactly as run.

#### 1
```
$ npx tsc --noEmit
[exit code: 0]
```

#### 2
```
$ npm test -- --pool=threads

> app@0.1.0 test
> vitest run --pool=threads


 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app


 Test Files  19 passed (19)
      Tests  332 passed (332)
   Start at  17:41:42
   Duration  4.31s (transform 393ms, setup 0ms, import 672ms, tests 4.20s, environment 1ms)

[exit code: 0]
```

#### 3
```
$ npx vitest run --pool=threads lib/domain/adherence.test.ts 2>&1 | grep -E "Tests +[0-9]+ passed \([0-9]+\)$"
      Tests  34 passed (34)
[exit code: 0]
```

#### 4
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts | grep -cF 'a month where actual spend exceeds its budgeted amount produces a breach finding for that month'
1
[exit code: 0]
```

#### 5
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts | grep -cF 'a month at or under its budgeted amount never produces a breach finding'
1
[exit code: 0]
```

#### 6
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts | grep -cF 'a month with zero budgeted amount and nonzero spend produces a breach finding without computing a spend-to-budget ratio'
1
[exit code: 0]
```

#### 7
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts | grep -cF 'spend under 50% of budget in every qualifying month of a window of at least three such months produces a single chronic-underspend defect finding for that category'
1
[exit code: 0]
```

#### 8
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts | grep -cF 'a single lean month never produces a defect finding on its own — chronic underspend requires at least three qualifying months of data'
1
[exit code: 0]
```

#### 9
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts | grep -cF 'one on-budget or over-budget month among otherwise-lean months breaks the chronic streak and no defect finding is produced'
1
[exit code: 0]
```

#### 10
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts | grep -cF 'a month with zero budgeted amount is excluded from the chronic-underspend window entirely, whether or not it has spend, rather than being read as either perfectly adhered or fully underspent'
1
[exit code: 0]
```

#### 11
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts | grep -cF 'a fixed category with sustained overspend produces a breach finding marked not scored'
1
[exit code: 0]
```

#### 12
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts | grep -cF 'a fixed category with chronic underspend produces a defect finding marked not scored — a wrong fixed budget line is still a wrong budget'
1
[exit code: 0]
```

#### 13
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts | grep -cF 'a variable-necessary category with chronic underspend produces a defect finding marked not scored, tracked the same as fixed rather than as a softer case of it'
1
[exit code: 0]
```

#### 14
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts | grep -cF 'a discretionary category with chronic underspend produces a defect finding marked scored'
1
[exit code: 0]
```

#### 15
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts | grep -cF 'a capital-landscape category never produces a finding of either kind, regardless of variance, even when its control_mode is discretionary'
1
[exit code: 0]
```

#### 16
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts | grep -cF 'an exclude_from_budget category never produces a finding of either kind, regardless of variance'
1
[exit code: 0]
```

#### 17
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts | grep -cF 'an is_income category never produces a finding of either kind, regardless of variance'
1
[exit code: 0]
```

#### 18
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts | grep -cF 'one category with sustained overspend and one category with chronic underspend at the roadmap'\''s own 24%-of-budget shape produce a breach finding and a defect finding respectively in the same input, and lib/budgetColors.ts'\''s expenseCellStyle renders every one of the chronically-under category'\''s months as an on-budget green shade'
1
[exit code: 0]
```

#### 19
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts | grep -cF 'the scored-set headline is null, not zero or NaN, when no finding in the input belongs to the scored set'
1
[exit code: 0]
```

#### 20
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts | grep -cF 'an explicit monthly_amounts schedule is used verbatim for each month'\''s budgeted amount, even when it disagrees with annual_budget divided by twelve'
1
[exit code: 0]
```

#### 21
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts | grep -cF 'a null monthly_amounts schedule falls back to annual_budget divided by twelve, rounded to cents, as every month'\''s budgeted amount'
1
[exit code: 0]
```

#### 22
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts | grep -cF 'variance is rounded to cents at each month rather than left to accumulate as float dust across a window'
1
[exit code: 0]
```

#### 23
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts | grep -cF 'includes an operational, non-excluded, non-income category classified discretionary in the scored set'
1
[exit code: 0]
```

#### 24
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts | grep -cF 'excludes a capital-landscape category from the scored set even when its control_mode is discretionary'
1
[exit code: 0]
```

#### 25
```
$ grep -c "budgetColors" lib/domain/adherence.ts
0
[exit code: 1]
```

#### 26
```
$ grep -cE "new Date\(|Date\.now\(" lib/domain/adherence.ts
0
[exit code: 1]
```

