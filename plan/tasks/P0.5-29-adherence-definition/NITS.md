# NITS — P0.5-29-adherence-definition
<!-- From REVIEW-1 (G3, ACCEPT_WITH_NITS). None blocked a gate. Ordered by what step 31 must
     settle before wiring any of this to a surface. -->

## N11 — the scored headline can report "over" for a category that is under **[highest value]**
`lib/domain/adherence.ts:362-373`. **Confirmed by execution at G4, not by reading.**

One scored category budgeted $100/month, spending $110 in January and $90 in each of the other
eleven months. Actual $1,100 against $1,199.88 budgeted — **8.3% under**. Measured output:

```
{"findingCount":1,"breachCount":1,"defectCount":0,"budgeted":100,"actual":110,"variance":10,"varianceRatio":0.1}
```

**A headline of +10% over.** Two causes compound: the aggregate ranges over *findings*, so the eleven
compliant months are invisible to it; and it sums a breach's month-scale `budgeted` together with a
defect's window-scale `budgeted` in one denominator. `findingCount` is incommensurable the same way —
six breach months count six, a twelve-month defect counts one.

Inside the frozen spec, which constrains only the `null` case, so not a defect against this task. But
the type is named `ScoredHeadline` and documented as "the headline number a dashboard would
eventually show, computed here so there is exactly one definition of it" — which invites exactly this
misreading. **Settle before step 31 gives it a consumer.** Owner: step 31's spec, or a follow-up here.

## N12 — `scoredHeadline` returns `null` for two opposite states
`lib/domain/adherence.ts:358-360`. Three scored categories each spending exactly their budget every
month produce `[]`, so the headline is `null` — byte-identical to the demo-seed case where there is
nothing to score. The module's own docstring at `:351-353` says these are different statements:
*"'the budget was followed perfectly' and 'there is nothing to score' are different statements."* The
signature cannot make the distinction because it takes findings rather than categories. A dashboard
wired to it renders "—" for a month of flawless adherence. Related to [[N11]]; same fix window.

## N13 — the 50% chronic threshold boundary is unasserted
`lib/domain/adherence.ts:320`. **Confirmed by mutation at G4:** changing `<` to `<=` leaves all 34
tests green. No fixture produces `ratio === 0.5`; the suite's ratios are 0.01, 0.2, 0.24, 0.25, 0.35,
0.9999, 1.0, 1.1667, 1.2, 1.3, 1.375, 1.4, 4.0 and `null`. Test #9 breaks the streak with a 100%
month, which pins the `every` reduction but not the threshold's edge. Behaviour is correct today.
Fix: one twelve-month fixture at exactly half budget asserting `[]`. Cheap, and it is the same shape
of gap as P0.5-28's N4.

## N14 — acceptance #22 pins the budget rounding, not the variance rounding it names
`lib/domain/adherence.test.ts:425-439`. **Confirmed by mutation at G4:** removing `roundCents` from
`:272` leaves all 34 tests green. Once `budgeted` and `actual` are each cent-rounded,
`actual − budgeted` is mathematically cent-exact, so the call is float-dust hygiene with no
observable effect on any cent-valued fixture. What #22 actually catches is an unrounded monthly
budget — which #21 already pins. The implementation is correct; the spec's vacuity note for #22
overstated what that command could ever catch. Recorded so "per-step rounding was gate-proven" is
never claimed for the variance half.

## N15 — an out-of-range month silently substitutes a different budget definition
`lib/domain/adherence.ts:254-260`. **Confirmed by probe at G4.** A December-only category
(`monthly_amounts = [0×11, 1200]`) given `{month: 12, actual: 1150}` — the plausible off-by-one for a
caller deriving `month` from SQL `EXTRACT(MONTH …)`, which is 1-indexed while this contract is
0-indexed — produces:

```
{"kind":"breach","month":12,"budgeted":100,"actual":1150,"variance":1050,"ratio":11.5}
```

The schedule is abandoned and the even spread substituted, so a category that spent slightly *under*
its December budget reads as a $1,050 breach at 1150%. The guard exists for a real reason
(`schedule[12]` → `undefined` → `NaN`, which the spec forbids), but it resolves an invalid input by
silently choosing a *different* budget rule. Returning `0`, or throwing, would be loud; the even
spread is plausible and therefore worse. Owner: a follow-up, or step 31's caller contract.

## N16 — acceptance #25 is one filename grep doing three jobs
`grep -c "budgetColors" lib/domain/adherence.ts` → 0 stands for negative control #17's real rule: no
import, no `monthPct` call, no `Infinity`. It measures none of them directly — it cannot see a
`monthPct` call, an `Infinity` literal, or an import through a re-export or path alias, and it
penalises prose that names the module the code is deliberately *not* coupled to. It failed the
implementer's first draft at `3` for three explanatory comments.

**The reviewer's verdict on whether that cost the reader anything: no.** `monthPct` and its `Infinity`
return are still named at `:92` and `:142`, and `monthPct` is unique to `lib/budgetColors.ts`
repo-wide, so the pointer survives in a more specific form than the filename. All three substantive
properties were established by reading, not by the command. A future spec should pin
`grep -cE "^import .*budgetColors"` plus a code-scoped `Infinity` check instead.

## N17 — `isTrackedCategory` is exported, imported by nothing, asserted by no test
`lib/domain/adherence.ts:232`. **Confirmed at G4:** repo-wide, `isTrackedCategory` appears only at
lines 62, 64, 232 and 293 of its own module. Covered transitively through `isScoredCategory` and
`detectAdherence`, never directly. Contrast `budgetedForMonth`, which the same diff deliberately
keeps private with a comment explaining why — the export decision was reasoned for one helper and not
the other. Non-goal 3 sanctions refactoring shared conjuncts into a helper, not widening the public
surface. If a later change inlines the conjuncts back, this rots with no test to notice.

## N18 — duplicate `month` values are accepted silently and inflate the window
`lib/domain/adherence.ts:298-313`. A caller whose SQL grouped by `(category, month, account)` instead
of `(category, month)` supplies two entries for month 0; `window.length` reaches 3 on two calendar
months and `budgeted` double-counts. The spec makes pre-aggregation the caller's job, so this is a
contract boundary rather than a violation — but the module has no other input validation and the
failure is silent and plausible. Step 31 writes the first real caller.

## N19 — the fifth even-spread implementation rounds; the four incumbents do not
`lib/domain/adherence.ts:259` returns `roundCents(annual / 12)` per month, as acceptance #21
requires. `components/BudgetMonthlyGrid.tsx:33-36`'s `monthsBudget()` returns
`new Array(12).fill(annual / 12)` **unrounded**. Concrete divergence: `annual_budget = $1,000` gives
this module a window total of **$999.96** (pinned at `adherence.test.ts:437`) while the budget grid's
twelve cells total $1,000.00 for the same category. Sanctioned by non-goal 4 and consistent with
`resolveAnnualBudget`'s "the rounded schedule is authoritative" precedent — recorded so whoever
renders both surfaces in step 31+ does not read the four cents as a bug in one of them.

## N20 — `AdherenceInput` types two NUMERIC columns as `number`; the driver returns strings
`lib/domain/adherence.ts:116-119`. `annual_budget` is `NUMERIC(12,2)` and `monthly_amounts` is
`NUMERIC(12,2)[]` (`db/schema.sql:168,176`); `pg` returns both as strings, which
`components/BudgetMonthlyGrid.tsx:23-24` already acknowledges by typing the identical columns
`string` / `string[] | null`. The reviewer traced every consumption site: all coerce safely through
`roundCents`' arithmetic, and no comparison is ever reached with an unrounded operand, so a
string-carrying row produces correct numbers today. This is the pre-existing `shared/types.ts`↔driver
mismatch inherited here (same family as P0.5-28's N3). Step 31's caller is the first code to feed
real rows in — worth a runtime check there rather than trusting the declared type.
