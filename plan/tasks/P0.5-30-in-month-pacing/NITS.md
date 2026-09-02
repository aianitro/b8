# NITS — P0.5-30-in-month-pacing
<!-- From REVIEW-1 (G3, ACCEPT_WITH_NITS). None blocked a gate. Numbering continues from
     P0.5-29a's N29 so cross-task references stay unambiguous. Ordered by what step 31 must
     settle before wiring this output to a surface. -->

## N30 — G2's A3 correction is itself wrong: the implementer's mechanism is the binding one **[re-adjudicates A3]**
`lib/domain/pacing.ts:290`. G2 ruled the `withoutNegativeZero` on `projectedVariance` unreachable
and **replaced** the implementer's stated reason (*"`-0` requires `budgeted === 0`, intercepted by
the status branches"*) with its own (*"both operands are `roundCents` outputs of the form `k/100`,
so the difference is exactly `+0` for identical `k` and at least a cent otherwise"*). The conclusion
holds. The correction does not, on two counts.

**1. The route G2 dismissed is the binding one.** `roundCents(-0.001)` is `-0`; on a `complete`
month `elapsedFraction` is `1`, so `projected` is `roundCents(-0 / 1)` = `-0`. With `budgeted` at
`+0`, `projected - budgeted` is **`-0`**, `roundCents(-0)` is `-0`, and `withoutNegativeZero` fires
and changes the emitted value. Verified:

```
projected = -0, budgeted = +0  →  diff -0, roundCents -0, guard changes it   ← LIVE
projected = -0, budgeted = -0  →  diff +0                                     (blocked anyway)
projected = -0, budgeted = 500 →  diff -500
```

That route is closed by exactly one thing: `budgeted === 0` sits ahead of `complete` and `projected`
in the status ladder (`:254-265`), so a zero budget is intercepted as `off-cycle`/`no-budget` and
`projected` is `null` before the subtraction is reached. Which is precisely what the implementer
said. **The guard becomes live the moment that precedence changes** — and [[N31]] records that the
precedence is entirely ungated, so the change is a green-suite refactor away.

**2. "at least a cent otherwise" is false above ≈ $1.76e13.** Two distinct `roundCents` outputs can
differ by less than a cent once the double spacing exceeds the cent grid:

```
22517998136850.48  and  22517998136850.49   differ by 0.0078125   (2 ULP at 2^44)
```

The conclusion still survives, but by a different argument: `roundCents(d)` is `-0` only for
`d ∈ [-0.005, -0)`, the difference of two distinct roundCents outputs is a nonzero multiple of the
local ULP and is at least `0.01 − ULP`, and the window requires `ULP ≤ 0.005` i.e. `ULP ≤ 2^-8`,
which gives `|d| ≥ 0.0061 > 0.005`. Swept: no `-0` at any binade boundary from 2^30 to 2^62, and
none at cent-adjacent, 2-, 3- or 4-cent-apart operand pairs.

**Disposition unchanged — retain the guard, per [[N23]]/[[N28]] precedent.** What changes is the
recorded reason. G2's ruling says *"if a future change makes either operand un-quantized, the branch
becomes live and this ruling lapses"*; the accurate lapse condition is **"if `budgeted === 0` stops
being intercepted ahead of the projecting statuses"**, which is a far more likely edit than
un-quantizing an operand. Owner: this file, so the refuted correction is not inherited as fact — the
same treatment [[N27]] and G2 itself prescribed.

## N31 — the status ladder's money-before-calendar precedence is completely ungated
`lib/domain/pacing.ts:254-265`, against SPEC.md Q6's *"status precedence is total and ordered:
`off-cycle` → `no-budget` → `future` → `complete` → `too-early` → `projected`"*.

**No fixture in the suite has a month that is both outside the as-of month and zero-budgeted.**
Checked all sixteen: P1/P2/P3/P7/P8/P9/P14/P15 use `month === asOf.month`; P4/P10's future months
and P5/P6/P16's past months all carry `budgeted > 0`; P11–P13 throw. So the first two rungs of the
ladder are never observed competing with the middle two, and an implementation that ordered
`future`/`complete` **ahead of** `off-cycle`/`no-budget` passes all 18 named tests. The implementer's
own eighteen-mutation table does not include this mutation.

**Concrete failure scenario for the precedence-swapped implementation.** A March-only category
(`monthly_amounts: [0,0,1200,0,…]`) with a $250 pre-authorised December charge, as of April 8, month
supplied as `11`: correct answer is `status: 'off-cycle'`, `budgeted: 0`, `actual: 250` — §5's
elevated breach. The swapped implementation answers `status: 'future'` with the same all-null money
fields, filing a real off-cycle breach as a month that has not started. Symmetrically, a past month
on an unbudgeted category (`annual_budget: 0`, month 0, `actual: 275`) would answer `'complete'` with
`projected: 275, projectedVariance: 275` instead of `'no-budget'` with nulls — and that variant also
makes [[N30]]'s `-0` branch live.

**The shipped code is correct.** This is a gate gap, not a defect. Owner: step 31's spec, or a
follow-up adding one fixture — a scheduled row with `months: [{ month: 11, actual: 250 }]` asserting
`status: 'off-cycle'` and `not.toBe('future')`, plus an unbudgeted past month asserting `'no-budget'`
and `not.toBe('complete')`. Two assertions close it.

## N32 — `spentRatio` means three different things across statuses **[G2's A4, ruled here]**
`lib/domain/pacing.ts:287`. The rule is uniform (`null` iff `budgeted <= 0`) and the module is
correct against it. The hazard is that the resulting field is not comparable across the records it
sits beside:

| status | what `spentRatio` is | example |
|---|---|---|
| `projected` / `too-early` | spend so far this month, mid-flight | April, day 8: `0.71` |
| `complete` | the finished month's final position; equals `projectedRatio` | January: `1.43` |
| `future` | **money already committed against a month that has not begun** | December: `2.5` |

**Concrete rendering scenario.** Step 31 draws a per-category table with a "% of budget" column
bound to `spentRatio` and a "projected close" column bound to `projected`, over a caller-supplied
full twelve months. As of April 8 the December row reads **"250% of budget · projection —"**,
directly under April's "71%". A reader parses the column as one quantity and sees a category 250%
over in a month that has not started; the `projected: null` reads as missing data rather than as
"there is nothing to project yet".

**Should the module withhold it? No — and the reason is that withholding loses nothing.** The caller
has `actual` and `budgeted` on the same record, so `actual / budgeted` is one division away, while
nulling it would make the spec's one-line null rule a two-clause status-dependent one. The fix is
one column becoming two, or a status-driven label, and it belongs to the renderer. **G2's A4 is
resolved as: correctly step 31's problem, with the constraint that `spentRatio` may not be rendered
in a single column across statuses, and `status` must be carried into whatever renders it.**

## N33 — validation strictness depends on category classification, and the throw's blast radius is the whole call **[G2's A5, ruled here]**
`lib/domain/pacing.ts:332` vs `:230`. An out-of-range `MonthSpend.month` throws `RangeError` for a
tracked row and is silently skipped for an untracked one, because `isTrackedCategory` gates before
the months are resolved.

**Defensible, and for a stronger reason than G2 gave.** `detectAdherence` ranges over the *identical*
predicate (`adherence.ts:382`), so the set of rows either module reports on is the same set. A row
neither module reports on cannot produce a wrong number in either, and the module comment at `:331`
states the principle correctly: *"this function has nothing to say about a row it does not report
on."* The asymmetry is therefore invisible in output. **Not a finding.**

**What is a finding is the blast radius.** The throw is per-call, not per-row: one 1-indexed month on
one tracked category aborts pacing for *every* category. A dashboard drawing an adherence panel and a
pacing panel from one `rows` array loses the whole pacing panel while the adherence panel beside it
renders the wrong number for the same row ([[N34]]). Owner: step 31's caller contract — normalise the
month index upstream of both calls, as SPEC.md Q6 already instructs.

## N34 — the deliberate N15 divergence is sound, but step 31 must be told not to catch the `RangeError`
`lib/domain/pacing.ts:230` and `pacing.test.ts` (the acceptance-#18 case), against G0's A2, deferred
to this review.

**Ruled: not the two-definitions defect (BUILD.md §10.3), and the safest of the available options.**
The hazard that row names is two implementations of one *computation* that can disagree on a *valid*
input. Here the computation is single-sourced — `budgetedForMonth`, `isTrackedCategory`,
`isScoredCategory`, `roundCents` and `withoutNegativeZero` are all imported, and `daysInMonth` is new
with no rival in shipped code — and the two modules disagree only on an input the contract does not
admit. On every conforming input they agree by construction, which is the property the hazard is
about. The three alternatives are all worse: making `detectAdherence` throw is forbidden (frozen, 47
tests byte-identical); making `pacing` substitute requires inventing a month length that does not
exist; skipping the row silently drops money. Pinning both halves in one test, so a "fix" to either
side goes red, is the correct treatment of a forced divergence.

**The residual, and it is a real one.** SPEC.md Q1 hands step 31 the sequence
`detectAdherence(rows); …; categoryPacing(rows, asOf)`. With a 1-indexed month index the first call
returns a *confidently wrong finding* — N15's confirmed probe, a $1,050 breach at 1150% — and the
second throws. The natural defensive move at a render boundary ("pacing failed, show the findings
anyway") swallows the only loud signal in the system and ships the wrong number alone. Step 31's
caller contract must say: normalise the month index before either call, and do not catch this
`RangeError` to render the sibling's output.

## N35 — a negative `actual` breaks the spec's own `projected >= actual` invariant and yields the inverted percentage [[N21]] forbids one field over
`lib/domain/pacing.ts:249, 272, 287, 296`. `MonthSpend.actual` is documented as a non-negative
magnitude and nothing enforces it; the type is `number`.

**Concrete scenario.** A $500/month category where the owner returns a $600 purchase, so the caller's
`SUM` nets `actual: -100`. As of April 8: `projected = roundCents(-100 / (8/30))` = **`-375`**,
`spentRatio: -0.2`, `projectedRatio: -0.75`, `projectedVariance: -875`. A renderer prints
"projected to close at −$375, −75% of budget".

Two things break. **(a)** SPEC.md Conventions states *"if a projection ever comes out below its own
spend-to-date, that is a defect"* and pins `projected >= actual` at acceptance #4 — here `-375 < -100`,
because a multiplier `≥ 1` moves a negative number *down*. The spec's reasoning ("the multiplier is
never negative, so it can never flip a sign") is true and does not imply the invariant it is offered
for. **(b)** [[N21]] ruled that a negative *budget* must yield `null` rather than an inverted
percentage, and this module honours that at `:287`/`:296` — but a negative *numerator* produces a
negative percentage with no such guard, so the same hazard class is answered two ways within one
struct.

Not a regression and not this delta's doing — `toMonthVariance` has the identical exposure. Recorded
because the spec asserts the invariant unconditionally while the code holds it only under an
undeclared precondition. Owner: step 31's caller contract, in the same sentence [[N26]] and [[N29]]
already owe it — the money fields are finite **and `actual` is non-negative**.

## N36 — two null-check idioms for one column, five lines apart
`lib/domain/pacing.ts:252` writes `schedule !== null && schedule.length === MONTHS_PER_YEAR`;
`adherence.ts:307`, called seven lines earlier at `:245` on the same value, writes `schedule &&
schedule.length === MONTHS_PER_YEAR`. The declared type is `number[] | null`, so the two agree on
every value TypeScript admits.

They diverge on `undefined`: `budgetedForMonth` returns the even spread, and `paceForMonth` throws a
**`TypeError`** — not the `RangeError` the module's error contract names — from `undefined.length`,
after the budget has already been computed successfully. Reachability is thin but not nil: `pg`
yields `undefined` for a column that was not selected, `db.query<T>` generics are caller-asserted
rather than checked, and `app/api/categories/route.ts:68` already types this column as `string[] |
null`, which is the evidence that runtime shapes here are not what the type says ([[N20]]). Match the
sibling's idiom, or state the divergence. Owner: whoever next has an authorised reason to edit this
file.

## N37 — the floor bounds the multiplier at 4×; nothing on the record signals lumpiness
`lib/domain/pacing.ts:103`, against SPEC.md Q2's three mitigations. Answering the review question
directly: the mitigations are **sufficient for a caller that filters on `scored`, and insufficient
for one that does not**, and the record carries nothing that distinguishes the two cases.

`PROJECTION_MIN_ELAPSED = 0.25` caps `1/elapsedFraction` at `4`. It does not distinguish diffuse
spend from a single transaction. The implementer's own demo-data example is the sharp one: Property
Tax draws $1,100 on day 10 of every month and nothing on any other day, so on day 10 the module
answers `projected: 3300` at `status: 'projected'` — three times the truth, in a record structurally
identical to Dining's genuinely informative one. `elapsedDays`/`daysInMonth`/`elapsedFraction` let a
renderer *print the qualifier*; they do not let it *decide whether to print the number*.

The one signal that exists is `scored`, which is `false` for exactly the `fixed` and
`variable-necessary` rows where lumpiness is structural — so `.filter(p => p.scored)`, which SPEC.md
Q5 already prescribes for step 31, removes the worst of it. `control_mode` is **not** on
`CategoryPace`, so a caller wanting a finer distinction than the scored/unscored binary must re-read
the rows. Recorded as the residual risk step 31 inherits, with the note that adding `control_mode` to
the record would cost nothing and is the cheapest place to put it. Not a defect: SPEC.md Q2 states
this scope explicitly and assigns rendering to step 31.

## N38 — `daysInMonth` is now the canonical month-length arithmetic; the seed script keeps a clock-based rival
`lib/domain/pacing.ts:185` against `scripts/seed-demo.mjs:215` (`const lastDay = (m) => new Date(YEAR,
m, 0).getDate()`) — 1-indexed, timezone-sensitive, and the exact construction SPEC.md's non-goals
forbid inside the module. No shipped code has a second copy (swept `app/`, `lib/`, `components/`,
`shared/`). Recorded only so the next month-length need imports rather than re-derives; the seed
script is explicitly out of this task's scope and its own copy is harmless where it sits.

## N39 — two further gate gaps the mutation table did not cover
Both are places where the shipped code is right and the suite does not prove it.

1. **`[...row.months].sort(...)` at `:336`.** Replacing the copy with an in-place sort of the
   caller's array leaves all 22 tests green — no test re-reads its input after the call. A module
   documented as pure would then reorder the caller's `AdherenceInput.months` as a side effect. One
   assertion closes it: pass a `months` array held in a `const` and assert its order afterwards.
2. **The placement of the `actual` normalisation.** Normalising at `:249` instead of at the four
   emission points also leaves the suite green, and would silently make M1b/M1c/M1d vacuous — the
   P0.5-29a [[N22]]/[[N27]] failure repeated. The implementer chose the gate-maximising placement
   deliberately and said so in `EVIDENCE.md`; recorded here so the reasoning survives the evidence
   file.
