# NITS — P0.5-29a-headline-scope
<!-- From REVIEW-1 (G3, ACCEPT_WITH_NITS). None blocked a gate. Numbering continues from
     P0.5-29's N20 so cross-task references stay unambiguous. Ordered by what step 31 must settle
     before wiring the headline to a surface. -->

## N21 — `varianceRatio` is `null` for a NEGATIVE total budget, where the spec says a number **[G2's A3, ruled here]**
`lib/domain/adherence.ts:483`. The code writes `budgeted > 0 ? … : null`; SPEC.md's `ScoredHeadline`
shape comment says `null` **only when** `budgeted === 0`. The two predicates diverge on exactly one
input class: `budgeted < 0`.

**Reachability, traced.** Nothing forbids it.

- `migrations/1786029579465_baseline-schema.sql:40` declares `annual_budget NUMERIC(12,2) NOT NULL`
  with **no CHECK** for non-negativity, and `monthly_amounts NUMERIC(12,2)[]` likewise.
- `app/api/categories/route.ts:20` (POST) validates only `typeof annual_budget !== 'number'`. With
  no schedule, `resolveAnnualBudget(null, x)` returns `x` verbatim (`lib/budgetMath.ts:33`), so
  `POST /api/categories {name, annual_budget: -1200, landscape: 'operational'}` writes a negative
  budget today.
- `app/api/categories/route.ts:59-63` (PATCH) *does* reject `amount < 0`. The asymmetry is the
  evidence that non-negativity is an intended invariant that is only half-enforced.
- `monthly_amounts` is the safe half: `normalizeMonthlyAmounts` (`lib/budgetMath.ts:21-24`) clamps
  every entry to `0`, so a negative per-month figure cannot arrive through the API — only through
  direct SQL.
- `control_mode` has **no write path in the repo** (grep: it appears only in the SELECT at
  `app/api/categories/route.ts:11`, in `shared/types.ts`, in this module, and in the migration), so
  a row that is *both* negative-budget *and* `discretionary` requires direct SQL today. That makes
  the case latent, not impossible — and step 31 is the change that first puts a caller on it.

**What the code reports, and why it is the safer of the two answers.** One scored category,
`annual_budget: -1200`, twelve months at `actual: 50`. `budgetedForMonth` → `-100`/month;
`variance` → `roundCents(50 − (−100)) = 150`/month. Headline: `budgeted: -1200`, `actual: 600`,
`variance: +1800`, `varianceRatio: null`. The spec's literal rule would instead emit
`1800 / -1200 = -1.5` — **"150% under budget" for a category that spent $600**, a sign inversion
produced by a negative denominator, which is precisely what the spec's own sign convention forbids
("the module never emits an inverted ratio"). BUILD.md §10.3's null-is-not-zero rule points the same
way: a blank is better than a confidently wrong percentage.

**So the ruling is: the implementation is right and the spec's wording is wrong**, and SPEC.md Q3
already says so in prose — it endorses `budgeted > 0 ? … : null` verbatim as "the identical rule
`MonthVariance.ratio` already applies". The frozen spec is internally inconsistent between its Q3
prose and its struct comment; the implementer followed the prose.

**What is left undone, and is the actual nit.** `budgeted: -1200` and `variance: +1800` are still
emitted as real dollar figures for that row — a negative budget total in a struct whose whole
convention is non-negative magnitudes, and a positive variance that reads "over budget" for a
category that underspent. That is inherited (P0.5-29's `scoredHeadline` summed the same negative
finding budgets, and `detectAdherence` still emits a breach for every month of such a row, since
`50 > -100`), not introduced here. Owner: **step 31's caller contract**, alongside [[N15]], [[N18]]
and [[N20]] — or a `CHECK (annual_budget >= 0)` migration plus the missing POST guard, which is the
cheaper and more durable fix and closes it for every one of the module's readers at once.

## N22 — the negative-zero guard is correct, load-bearing, and completely ungated
`lib/domain/adherence.ts:354-356, 466, 483`. `withoutNegativeZero` is the only thing standing
between the headline and `-0`, and **no acceptance command can tell whether it exists.**

Acceptance #4's Fixture D is twelve months at exactly $100 against a $100 budget, so every
`MonthVariance.variance` is `roundCents(0) = +0`, and `+0 + +0 = +0` deterministically. Its two
`expect(Object.is(headline.variance, -0)).toBe(false)` assertions therefore pass with
`withoutNegativeZero` deleted. Same for #12 (Fixture G, `months: []` → `reduce` returns its `0`
seed). Deleting the function and both call sites leaves all 30 acceptance commands green.

**The guard is nevertheless required, and this is not theoretical.** `sumCents` is
`roundCents(values.reduce((s, n) => s + n, 0))`, and cent-quantized floats whose exact total is zero
can accumulate to a *tiny negative* intermediate, which `Math.round` maps to `-0`. Traced against
the module's exact arithmetic (`budgetedForMonth` → `toMonthVariance` → `monthVariances` →
`sumCents`):

```
row: annual_budget 1200, monthly_amounts [100 × 12],
     months [{0, 100.01}, {1, 99.93}, {2, 100.06}]
per-month variance: [0.01, -0.07, 0.06]
reduce → -6.938893903907228e-18   →   roundCents → -0
```

Without the guard: `variance: -0`, `varianceRatio: -0 / 300 = -0`, and a surface prints
**"-0.0% under"** for a category that landed exactly on budget. A randomized sweep over
exact-zero-total variance sequences (2–12 cent-valued months) put the `-0` outcome at **~25%** of
cases; the suite's fixtures land in the 75% that are safe, deterministically, because their
per-month variances are each exactly `+0`.

Note also that the guard makes the sign **order-independent**: without it, whether the headline
reports `0` or `-0` depends on the caller's row order and the within-row month order, which is a
non-determinism a snapshot test would eventually trip over.

Fix: one fixture like the above, asserting `expect(Object.is(headline.variance, -0)).toBe(false)` on
a *reachable* `-0` path. Cheap, and it converts #4's negative-zero arm from documentation into a
gate. Same shape of gap as P0.5-29's [[N13]] and [[N14]].

## N23 — `withoutNegativeZero` on `varianceRatio` is unreachable given the same guard on `variance`
`lib/domain/adherence.ts:483`. `variance` is normalised at `:466` before the ratio is computed, and
the branch is guarded by `budgeted > 0`, so the numerator is `+0` or a value of magnitude ≥ `0.01`
and the denominator is finite and positive: `variance / budgeted` can never be `-0`. Harmless
belt-and-braces, and the comment above it does not claim otherwise — recorded only so a later reader
does not infer from the second call that the first one is also decorative. It is not; see [[N22]].

## N24 — acceptance #16 gates the denominator arm, not the "re-summation" arm the spec advertises
`SPEC.md` Conventions and Vacuity-check both state that #16 "discriminates rounded-total arithmetic
from raw-float arithmetic at four cents", i.e. that the headline's *own* summation discipline is
under test. At the headline level that distinction does not exist: every value entering `sumCents`
has already been through `roundCents` in `toMonthVariance`, and `sumCents` **is itself**
"sum raw, round once". Summing raw per-month differences instead of the rounded ones lands on
`-759.96` either way — which is exactly the no-op mutation EVIDENCE.md §7 honestly discloses as
having failed to fail. Concretely, on cent-quantized inputs, `sumCents(variances)` and
`roundCents(actualTotal − budgetedTotal)` are equal; a 200,000-sample randomized sweep found zero
divergences.

What #16 *does* gate, and gates well: (a) the inherited N19 denominator — dropping `roundCents` from
`budgetedForMonth`'s even spread moves `budgeted` from `999.96` to `1000` and fails
`not.toBe(1000)`, `toBe(-759.96)` and the ratio pin (the implementer's mutation table confirms it,
1 failure); (b) a cent-rounded ratio, via `not.toBe(-0.76)`. Both matter, and the code is right on
both. The nit is that "per-step rounding was gate-proven at the headline level" must never be
claimed from #16 — this is the same overstatement P0.5-29 recorded as [[N14]], recurring one level
up. A future spec should attribute the four cents to `budgetedForMonth`, where they actually live.

## N25 — the stale cross-reference at `:91` now points at an unrelated test
`lib/domain/adherence.ts:91`: *"the coupling is checked by a literal grep (SPEC.md acceptance #25)"*.
That was P0.5-29's numbering. Under P0.5-29a the `budgetColors` grep is **acceptance #18**, and
acceptance #25 is now `excludes a capital-landscape category from the scored set even when its
control_mode is discretionary` — an unrelated P0.5-28 test. The implementer flagged this and
deliberately left it, correctly: SPEC.md authorised no such edit, and the module already carries two
task-numbered comments that will drift again at step 31.

The durable fix is not renumbering. Bare `#n` references into a per-task frozen spec have a shelf
life of one task; a reference that survives names the property (`no import of lib/budgetColors.ts`)
or the task (`P0.5-29 acceptance #25`). Owner: whoever next has an authorised reason to edit this
file. Inherited from P0.5-29's [[N16]], which already recorded that this grep is one filename check
doing three jobs.

## N26 — `scoredCategoryCount` counts rows, so a duplicated row inflates the headline three ways
`lib/domain/adherence.ts:456, 475`. Membership is `rows.filter(isScoredCategory)` with no
de-duplication by `id`. A caller whose SQL joins `budget_categories` to anything one-to-many — the
`UNIQUE(name, landscape)` / non-FK `mapped_category` shape BUILD.md §10.3 names — hands the same
category in twice and gets `scoredCategoryCount: 2`, a doubled `budgeted`/`actual`, and doubled
counts (because `detectAdherence(scoredRows)` emits the findings twice too). The landscape conjunct
already blocks the *two-landscapes* version of that hazard, and this matches `detectAdherence`'s
existing behaviour exactly, so it is a contract boundary rather than a regression — the same family
as [[N18]]'s duplicate `month` entries, now with a wider blast radius because it moves the money
figures as well as the window. Owner: step 31's caller contract, which should state that `rows` is
one entry per category.

## N27 — [[N22]] is closed by the exact fixture it prescribed, but the new gate is not self-checking
`lib/domain/adherence.test.ts:605-643`. The added test is [[N22]]'s prescribed fixture verbatim
(`annual_budget 1200`, `monthly_amounts null`, actuals `100.01 / 99.93 / 100.06`), and it bites for
the stated reason. Re-derived independently from IEEE-754 rather than taken from the comment:
`0.01d + (-0.07d)` is `-(0.06d + 2^-57)` = `-0.060000000000000005`; adding `0.06d` back leaves
exactly `-2^-57` = `-6.938893903907228e-18`; `roundCents` multiplies by 100 to
`-6.938893903907228e-16`, and ECMA-262 `Math.round` returns `-0` for any `x` in `[-0.5, 0)`, so
`sumCents` yields `-0` by precisely the route the comment describes and no other. `toBe` is
`Object.is` in vitest, so `expect(headline.variance).toBe(0)` separates `-0` from `+0` on its own
and the explicit `Object.is` line is intent, not redundancy. The orchestrator's mutation of `:466`
confirms it red.

The nit is durability, not correctness. **The test's non-vacuity depends on the float behaviour of
`roundCents`, which lives in `lib/budgetMath.ts` — a file this task does not own and whose own tests
pin no residue.** Concrete degradation: someone closes [[N19]] (or merely "tidies" cent rounding) by
changing `roundCents` to `Number(n.toFixed(2))` or to an epsilon-nudged form. `Number((-6.9e-18).toFixed(2))`
is `+0`, not `-0`. Every assertion in this test still passes, `withoutNegativeZero` at `:466` becomes
ungated again exactly as [[N22]] found it, and **nothing anywhere goes red to say so** — the gate
silently reverts to documentation, which is the failure this test was added to end.

Cheap fix, one line inside the test, importing the real `roundCents` the module uses:

```ts
// The residue this fixture depends on. If cent rounding ever stops producing it, this line goes
// red and the reader is told the guard below is no longer gated — instead of the test quietly
// passing for a reason that has nothing to do with the guard.
expect(Object.is(roundCents([0.01, -0.07, 0.06].reduce((sum, n) => sum + n, 0)), -0)).toBe(true);
```

Related and deliberately left alone: acceptance #4's (Fixture D) and #12's (Fixture G)
`Object.is(..., -0)` assertions remain **vacuous** — both reach `+0` without touching the guard, as
[[N22]] established. They are spec-mandated and harmless, but they are documentation, and only the
new test at `:605` is a gate. A future spec must not cite #4 or #12 as evidence that negative-zero
normalisation is covered.

## N28 — [[N23]] confirmed in full: `:483` fires only on `budgeted === Infinity`, which is unreachable
`lib/domain/adherence.ts:483`. Recorded so this question is not re-litigated a third time. The
second `withoutNegativeZero` can return a different value from its argument **iff** `variance / budgeted`
is `-0`, which requires a negative true quotient that underflows. Bound it: after `:466`, `variance`
is either `+0` or `|variance| >= 0.01` (it is `Math.round(s * 100) / 100`, so a nonzero finite result
is a nonzero integer over 100); the branch is guarded by `budgeted > 0`; and `Number.MAX_VALUE` is
`~1.798e308`. So the smallest reachable nonzero magnitude is `0.01 / 1.798e308 ≈ 5.6e-311` — subnormal,
but not zero, and roughly 13 orders of magnitude above the `4.94e-324` needed to flush to `-0`. The
only remaining route is `budgeted === Infinity`, and the removed `1e306` fixture is the only shape
that reaches it.

That fixture was correctly ruled out of scope. `annual_budget` is `NUMERIC(12,2)` (`db/schema.sql:168`)
and `monthly_amounts` is `NUMERIC(12,2)[]` (`:176`), capping any per-month figure at `9,999,999,999.99`;
reaching `1.798e308` from cent-capped addends needs on the order of `1e298` month entries. **The
in-memory-caller objection does not rescue it either**: `AdherenceInput` is a TypeScript type and an
in-memory caller is not bound by the schema, but such a caller must still either supply `~1e298`
`MonthSpend` entries or hand in a non-finite `annual_budget` / schedule entry — and the latter does
not produce a `-0` ratio, it produces `budgeted: Infinity`, `variance: -Infinity` and
`varianceRatio: NaN` (see [[N29]]), a struct already outside the spec's guarantees before `:483` is
consulted. Conclusion: `:483` is unreachable from every input the contract admits, and no test can
gate it without a non-conforming fixture. It should stay — deleting it invites its reintroduction —
but the comment above it should say **why** it can never fire, so the next reader does not spend a
review cycle rediscovering this. Owner: whoever next has an authorised reason to edit this file,
alongside [[N25]].

## N29 — "never NaN, never Infinity" is a precondition on the caller, not an invariant the module enforces
`lib/domain/adherence.ts:455-485`, against SPEC.md's *"it is never `NaN`, never `Infinity`, never `-0`"*.
That holds for every **finite** input and is unenforced otherwise. Concrete scenario for step 31: a
caller builds `AdherenceInput` in memory and lets a non-finite `annual_budget` through — the type is
`number`, which includes `NaN` and `Infinity`, and the likely source is a coercion (`Number(...)` over
a value `pg` returned in an unexpected shape) rather than a literal. With `annual_budget: NaN`,
`budgetedForMonth` returns `NaN`, every `MonthVariance.variance` is `NaN`, `sumCents` is `NaN`,
`withoutNegativeZero(NaN)` is `NaN` (`NaN === 0` is false), and the struct reports **`variance: NaN`
with `varianceRatio: null`** — a headline whose dollar figure is NaN while its percentage reads as the
benign "no baseline" null, i.e. the wrong-zero hazard one field over. With `annual_budget: Infinity`
it reports `variance: -Infinity`, `varianceRatio: NaN`.

Not a regression and not this delta's doing — `detectAdherence` has the same exposure, and the DB
column is `NUMERIC(12,2) NOT NULL` so no schema-sourced row can do it. Recorded because the spec
states the guarantee unconditionally while the code holds it only under a precondition nothing
declares. Owner: step 31's caller contract, which already owes a "one entry per category" statement
per [[N26]]; the same sentence should say the money fields are finite.
