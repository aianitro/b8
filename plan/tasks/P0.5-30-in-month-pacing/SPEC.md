# P0.5-30-in-month-pacing — a category's projected month-end position, as of a stated day, with the assumption it carries said out loud
**Roadmap item:** ROADMAP.md §5 Phase 0.5 step 30 — "In-the-moment pacing — the mechanic the whole phase exists for." Orchestrator's reading: `plan/tasks/P0.5-30-in-month-pacing/ITEM.md`
**Status:** DRAFT
**Author:** spec-writer

## Goal

A new pure module `lib/domain/pacing.ts` exports `categoryPacing(rows: AdherenceInput[], asOf: AsOf): CategoryPace[]`, which answers, for every tracked category and every month the caller supplied, **where that month is projected to close** — not merely what it has spent. It takes the same `AdherenceInput[]` `detectAdherence` and `scoredHeadline` take, plus one new parameter: an explicit as-of point `{ year, month, day }` of plain integers. The module reads no clock; the clock read moves to the caller, and ROADMAP step 31 owns it.

The observable change: today the repo can say "Dining has spent $355 of its $500 April budget" (`MonthVariance`) and, on the dashboard, "the year is 33% elapsed and 41% of the annual budget is used" (`yearPacePct`, whole-year and month-granular). After this task it can say, from a pure function, **"as of day 8 of 30, Dining is at 71% of its month and projects to close at $1,331.25 — 266.25% of its $500 budget, $831.25 over"** — with `elapsedDays: 8`, `daysInMonth: 30` and `elapsedFraction: 0.26666666666666666` carried on the same record, so no surface can print the projection without the day it is projected from.

The projection is `spend-to-date ÷ elapsed-fraction`, and that **assumes spend is uniform within the month** — an assumption `monthly_amounts` does not underwrite, because a schedule constrains a month's *total* and says nothing about its curve. §5's "schedule-aware, not a naive days-elapsed line" is therefore satisfied at **month** granularity, by the existing `budgetedForMonth`, and **not within the month**. Rather than pretend otherwise, this task makes the assumption structurally visible in two ways that are both enforced by acceptance commands: below `PROJECTION_MIN_ELAPSED = 0.25` of a month elapsed the projection is **not emitted at all** (`projected: null`, `status: 'too-early'`, with spend-to-date still fully reported), and above it every projection carries the elapsed day, the month length and the fraction it was multiplied by. Off-cycle spend — a scheduled category drawing money in a month its schedule budgeted `$0` for — gets its own `status: 'off-cycle'` and **no percentage of any kind**, per §5's "a breach in its own right, not a percentage", which is a statement neither `monthPct` (`Infinity`) nor `detectAdherence` (an ordinary `budgeted === 0` breach, indistinguishable from "no budget configured") can make today.

`lib/domain/adherence.ts` changes in exactly one respect: `budgetedForMonth` and `withoutNegativeZero` gain the `export` keyword, and the stale comments that call them private are corrected. No function body in that file changes; all 47 of its tests pass verbatim.

## Non-goals

- **No UI, no dashboard, no page, no component, no route, no API surface.** Step 31 re-points the dashboard and is the first renderer of this output; step 33 owns delivery and the outbound allowlist. `app/dashboard/page.tsx` is **not edited by this task** — not its `expectedYearSpend`, not `yearPacePct`, not `paceColor`, not the Year Pace bar. §5's "extends the existing pace math ... down to the per-category month" is discharged here by *building the per-category month math as a pure function*; re-pointing the card that currently holds the whole-year version is step 31's diff. Acceptance #31 makes any edit to `app/` a failure.
- **No aggregate, no headline, no rollup.** `categoryPacing` returns per-category, per-month records and nothing else. §5's exit is "every discretionary category reports projected month-end position" — a per-category statement. A "projected headline" would re-open exactly the scale-mixing defect N11 (a month-scale magnitude summed with a window-scale one) that P0.5-29a exists to have closed, and it would do so with a projection multiplier attached. If step 31 wants one, it is step 31's spec's decision with its own negative controls.
- **No change to the observable behaviour of `isScoredCategory`, `isTrackedCategory`, `detectAdherence`, `scoredHeadline`, `ScorableCategory`, `AdherenceInput`, `MonthSpend`, `MonthVariance`, `BreachFinding`, `ChronicUnderspendFinding`, `AdherenceFinding`, or `ScoredHeadline`.** All 47 existing tests in `lib/domain/adherence.test.ts` pass **unmodified** — no rename, no re-fixture. The only permitted edit to `lib/domain/adherence.ts` is adding `export` to `budgetedForMonth` and `withoutNegativeZero` and correcting the comments that describe them as private. Acceptance #29 and #30 enforce that no other line of that file changes.
- **No second even-spread implementation, and no migration of the four incumbents.** NITS N19 is inherited unchanged: `budgetedForMonth` keeps `roundCents(annual_budget / 12)` per month, so a $1,000 annual budget still resolves to `$83.33`/month here and `$83.3333…` in `components/BudgetMonthlyGrid.tsx`. `pacing.ts` must contain **no division by 12 and no division by `MONTHS_PER_YEAR`** — it imports the one definition. Acceptance #22 and #23.
- **No row validation beyond the two things this task makes uncomputable.** NITS N18 (duplicate `month` entries), N26 (the same category row supplied twice), N20 (`NUMERIC` columns arriving as strings) and N29 (non-finite `annual_budget`) are all carried forward untouched, exactly as P0.5-29a carried them, and remain step 31's caller-contract debt. The two exceptions are stated as behaviour below and are forced rather than chosen: an out-of-range `asOf` and an out-of-range `MonthSpend.month` have no computable answer, because there is no such day and no such month to take a length of.
- **No fix for partial categorization.** Step 32 owns it. This task must *not claim otherwise*, and it makes the inherited error's amplification measurable rather than merely warned about — acceptance #12.
- **No coupling to `lib/budgetColors.ts`.** `pacing.ts` does not import it and does not call `monthPct`. `monthPct` answers `Infinity` for exactly the off-cycle case this module answers `null` for, and a non-finite number has no business inside a projection. Acceptance #24 and #25.
- **No wall clock, anywhere.** `pacing.ts` contains no `new Date(` and no `Date.now(`. This is stronger than a determinism nicety here: it also forbids the `new Date(year, month + 1, 0).getDate()` trick for month length, which is timezone-sensitive, and so forces `daysInMonth` to be plain arithmetic that a test can pin at 2100 and 2000. Acceptance #26.
- **No persistence, no migration, no schema change, no route handler, no scheduled job, no email, no `scripts/seed-demo.mjs` change.** P0.5-28's N7 remains true (every seeded category is `fixed`), and this task does not make the demo data produce a scored projection.

## Contracts touched

| File | Change | Class (§9.2) |
|---|---|---|
| *(none)* | — | — |

`lib/domain/pacing.ts` and `lib/domain/adherence.ts` are `lib/**`, not the contract surface (BUILD.md §2), matching `DriftFinding` in `drift.ts` and `PropertyPnl` in `propertyPnl.ts`. Every column read (`landscape`, `exclude_from_budget`, `is_income`, `control_mode`, `annual_budget`, `monthly_amounts`) already exists; `AdherenceInput` is reused verbatim rather than a second row shape being invented. `categoryPacing`, `CategoryPace`, `AsOf` and `PaceStatus` are new and have **no importer in the repo** on delivery, so no shipped surface can break. Adding `export` to two existing internal functions is additive and changes no behaviour. **G1 is skipped.** If the implementer finds a contract change genuinely required, that is a finding to report loudly, not to absorb.

## The seven open questions, decided

**Q1 — where "today" enters: an explicit `AsOf` struct of three plain integers, and nothing else.**

```
export interface AsOf { year: number; month: number; day: number }   // month 0 = January; day 1-based
export function categoryPacing(rows: AdherenceInput[], asOf: AsOf): CategoryPace[]
```

Stated as signature-level fact and observable behaviour, not as design:

- **A bare elapsed fraction is rejected** because the module must also decide, per supplied month, whether that month is before, inside, or after the as-of point (Q6). A single fraction cannot say which month it is a fraction *of*, and a fraction-per-month is a shape the caller would have to compute — which is the calendar arithmetic being moved, not removed.
- **A `Date` is rejected** because `Date.prototype.getMonth()` is local-time: a test writing `new Date('2026-04-08')` gets UTC midnight, which is April 7 in every negative-offset zone. That is a suite that means something different on a laptop in Los Angeles than in CI, which is precisely the property `vitest.config.mts` claims for this suite. `AsOf` has no timezone because it has no instant.
- **`daysInMonth` is derived by the module, not supplied by the caller**, and is exported as `daysInMonth(year: number, month: number): number`. Supplying it would admit an internally inconsistent as-of point — day 31 of a 30-day month, February 29 in 2026 — which no validation on the caller's side is forced to catch. Deriving it makes that pair unrepresentable-wrong and puts the Gregorian rule under test (acceptance #14: 2024 → 29, 2026 → 28, 2100 → 28, 2000 → 29; the naive `year % 4` gets 2100 wrong).
- **`asOf.year` is required** solely because February's length depends on it. `AdherenceInput` carries no year; the caller assembles one implicit calendar year of months, and `asOf.year` is that year. The module does not and cannot verify that claim — stated here as a caller-contract precondition alongside N18/N26/N29.

**Caller-facing consequence for step 31**, stated so it is designed for rather than discovered: step 31 performs exactly one clock read and derives three integers from it, in whatever timezone it decides is the owner's, and passes them. `const rows = …; const findings = detectAdherence(rows); const pace = categoryPacing(rows, { year, month, day });` — one array, three independent reads, no intermediate to get wrong and no ordering dependency.

**Q2 — what the projection assumes, and what must accompany it. It is *not* honest enough to stand unqualified.**

The projection is `actual ÷ elapsedFraction`. The assumption it carries is **uniform spend within the month**, and it is false for precisely the categories `monthly_amounts` exists to model: `monthly_amounts` fixes a per-*month* amount and constrains nothing about the within-month curve, so a March-only category's March is as lumpy inside itself as any other. §5's "schedule-aware, not a naive days-elapsed line" is satisfied at month granularity by `budgetedForMonth` and **not** within the month. A projection that is confidently wrong in the first week is the N11 shape again: a plausible number, pointing the wrong way, with nothing on it saying so.

Three things must therefore accompany it, all enforced:

1. **A stated elapsed floor.** `export const PROJECTION_MIN_ELAPSED = 0.25`. Below it, `projected`, `projectedVariance` and `projectedRatio` are all `null` and `status` is `'too-early'`; `budgeted`, `actual` and `spentRatio` are still fully reported, so the caller loses the projection and nothing else. The comparison is `elapsedFraction >= PROJECTION_MIN_ELAPSED` — **inclusive**, pinned in both directions by acceptance #6. The threshold is stated rather than emergent, in the same style as `CHRONIC_UNDERSPEND_RATIO` and `CHRONIC_MIN_MONTHS`, and it is calibrated against §5's own worked example: day 8 of a 30-day month is `0.2666…` and **must** project, because §5 says it does. Day 7 of 30 is `0.2333…` and must not. The floor therefore reads, in words, "roughly the first week of a month is not enough to project from" — which is a claim a reviewer can argue with, rather than a number nobody chose.
2. **The elapsed basis travels with the number.** Every `CategoryPace` carries `elapsedDays`, `daysInMonth` and `elapsedFraction`, whatever its status. These are facts, not judgements, and they are what turns "projected to close 266% over" into §5's own sentence, "day 8 of 30, projected to close 266% over". A renderer that wants to print the projection has the qualifier in hand and no excuse.
3. **The elapsed fraction is day-granular and treats the as-of day as complete.** `elapsedFraction = elapsedDays / daysInMonth`, with `elapsedDays = asOf.day`, 1-based. This is the consistent choice, not a convenience: `MonthSpend.actual` is spend through the end of the as-of day (transactions carry dates, not times), so the numerator includes all of day *d* and the denominator must too. It also means the current month's fraction is never `0` — the smallest reachable value is `1/31` — so **division by zero at elapsed-fraction 0 is structurally unreachable in the current-month branch**, rather than guarded after the fact. The alternative, `(day − 1) / daysInMonth`, divides a full day of spend by zero on day 1.

This is deliberately **not** the incumbent's convention. `app/dashboard/page.tsx:356` uses `monthsElapsed = new Date().getMonth() + 1`, which treats the current month as *fully* elapsed: on April 1 it claims 4/12 of the year is gone. That over-counts expected spend and so flatters the pace, and it is a month-granular figure where §5 explicitly asks for "day 8 of 30". Acceptance #2 and #18 pin that pacing does not inherit it.

**Q3 — off-cycle gets its own status, and no percentage. Reusing `detectAdherence`'s `budgeted === 0` breach is not enough.**

`lib/budgetColors.ts` defines `offCycle` as "$0 expected AND real activity, **for a category that DOES have an explicit schedule** — distinct from 'no budget configured at all' (`monthlyBudget === 0` with no schedule), which stays neutral." `detectAdherence` cannot draw that line: it emits an identical `budgeted === 0` breach for both, so "money landed outside its window" and "this category has no budget at all" are the same finding today. §5 asks for the first to be "a breach in its own right".

So pacing distinguishes them, **without touching `detectAdherence`**:

- `status: 'off-cycle'` iff the row has a full-length `monthly_amounts` schedule **and** `budgeted === 0` **and** `actual > 0`. In that state `spentRatio`, `projected`, `projectedVariance` and `projectedRatio` are **all `null`** — "not a percentage", literally. `actual` and `budgeted: 0` are the whole content of the record, and the dollar figure is the breach.
- `status: 'no-budget'` iff `budgeted === 0` and the off-cycle test fails — no schedule, or a schedule with no spend that month. Same all-`null` ratios, a different word.

`spentRatio: null` here is the deliberate contrast with `monthPct`, which answers `Infinity` for the same input. Acceptance #8, #9 and #10.

**Q4 — a new module, `lib/domain/pacing.ts`, importing the two internals it must not duplicate.**

The drifting-definitions hazard (BUILD.md §1, §9.1) is about a *second copy of a definition*, not about file count, and the repo's own stated remedy is "one definition, exported, imported by every consumer." Pacing shares exactly two definitions with `adherence.ts`: the tracked/scored membership tests (already exported) and `budgetedForMonth` (private, with a comment saying so). A new module that re-implemented `budgetedForMonth` would be the sixth even-spread implementation and would drift from the fifth on its rounding — the exact defect. A new module that imports it is the fix.

`adherence.ts`'s "deliberately private" comment argues against becoming *the home the four incumbent even-spread implementations migrate to* — a real change with real blast radius that this task still does not do. It does not argue against a sibling in the same `lib/domain/` folder that must agree with it by construction. Against keeping pacing inside `adherence.ts`: that file is already 485 lines carrying three exported concepts, the phase has step 31 and step 32 still to land near it, and pacing takes an input dimension — the as-of point — that no other function in the file takes or should. `withoutNegativeZero` is exported for the same reason and is load-bearing here (Q7 below and acceptance #15).

The import is not asserted, it is measured: acceptance #22 pins the import line, #23 pins that `pacing.ts` contains no `/ 12` or `/ MONTHS_PER_YEAR`, and **#20 cross-checks the two modules' answers on the same row** — `detectAdherence`'s `budgeted` and `categoryPacing`'s `budgeted` must be the identical `83.33` on a $1,000 annual budget, and the derived `projectedRatio` must be `2.4000960038401535` (the rounded-per-month denominator) and explicitly **not** `2.4000000000000004` (an unrounded copy). That single decimal is the difference between importing the definition and re-typing it.

**Q5 — pacing ranges over `isTrackedCategory` (three conjuncts) and flags `scored`, exactly as `detectAdherence` does.**

§5's exit — "every discretionary category reports projected month-end position" — is satisfied as a superset: a caller wanting exactly §5's set writes `.filter(p => p.scored)`. Four reasons for the wider range:

1. It matches the sibling detector over the same rows. Two functions in one domain folder taking one array, one gated on three conjuncts and one on four, is a difference a caller has to remember and will eventually get wrong.
2. `adherence.ts` already records the argument, and it applies unchanged: "a detector quietly restricted to `isScoredCategory` would be blind to exactly the categories where a wrong budget line is most expensive" — a `fixed` mortgage budgeted $2,000 drawing $1,400, and `variable-necessary` utilities.
3. ITEM.md's objection — a projection is "meaningless for a `fixed` mortgage" — is a *rendering* judgement, and rendering is step 31's. A `fixed` line projecting to close 140% over is a true fact, and a pure module has no business withholding it.
4. Off-cycle spend on a `variable-necessary` utility is precisely the breach §5 elevates, and a four-conjunct gate would drop it silently.

The three landscape/exclusion conjuncts still gate whether a record exists **at all**: a `capital` row, an `exclude_from_budget` row and an `is_income` row produce **no** `CategoryPace`, however extreme their variance. Acceptance #11.

**Q6 — months before and after the as-of point, and every other divisor, land on a stated answer.**

Pacing ranges over exactly the entries in `row.months` — no more, no fewer, no invented twelve — and emits one `CategoryPace` per (tracked category, supplied month), in calendar order within a category, categories in input order. So past and future months are ordinary inputs, and each has a stated answer:

| Case | `elapsedDays` | `elapsedFraction` | `projected` |
|---|---|---|---|
| `month > asOf.month` — future | `0` | `0` | `null`, `status: 'future'` |
| `month < asOf.month` — complete | `daysInMonth(asOf.year, month)` | `1` | `= actual`, `status: 'complete'` |
| `month === asOf.month` — current | `asOf.day` | `asOf.day / daysInMonth(asOf.year, month)` | per the floor |

A completed month's projection **equals its actual because the arithmetic says so** — `actual / 1` — not because a special case says so, so the two can never disagree. A future month's `elapsedFraction` is `0` and its projection is `null` **by status, before any division is reached**, which is the stated answer to "division by zero at elapsed-fraction 0": `actual / 0` is `Infinity` for nonzero spend and `NaN` for zero spend, and acceptance #7 asserts neither value appears. Note that `elapsedFraction` and `elapsedDays` are facts about *time* and are reported for every status including `off-cycle` and `no-budget`; only the money projections are nulled.

**Status precedence is total and ordered**, so no record can qualify for two: `off-cycle` → `no-budget` → `future` → `complete` → `too-early` → `projected`. Off-cycle sits first because it is a statement about the *money*, true regardless of where the month sits relative to today, and it is the one §5 elevates.

The remaining divisors: `spentRatio` and `projectedRatio` are guarded `budgeted > 0 ? … : null` — the identical rule `MonthVariance.ratio` applies one level down, and the same rule NITS N21 ruled correct for a **negative** total budget. So a category with `annual_budget: -1200` reports both ratios `null` rather than an inverted percentage, while still reporting real dollar figures. Acceptance #16.

**Two inputs are rejected loudly rather than resolved silently**, because pacing has no answer for them at all:

- **`asOf` that is not a real day**: `month` outside the integers 0–11, `day` outside `1 … daysInMonth(asOf.year, asOf.month)`, or any of the three non-integer or non-finite. `RangeError`. Acceptance #13 and #14. A validator that merely checks `1 <= day <= 31` admits April 31 and February 29 of 2026 and fails those commands.
- **`MonthSpend.month` outside the integers 0–11**: `RangeError`. This is forced — `daysInMonth(2026, 12)` has no answer, and there is no month to take the length of. **It is a deliberate divergence from `detectAdherence`, which for the same input silently substitutes the even spread (NITS N15's confirmed probe: a December-only category given `month: 12` reads as a $1,050 breach at 1150%).** N15's own ruling says "returning 0, or throwing, would be loud; the even spread is plausible and therefore worse." Pacing takes the loud option; `detectAdherence` is frozen and keeps the silent one. **The divergence is itself a hazard and is recorded as such**: two sibling functions over one array, one of which throws on a row the other quietly mis-prices. Step 31's caller contract inherits it and should normalise `month` upstream of both.

**Q7 — partial categorization is inherited, not fixed, and its amplification is measured rather than warned about.**

Step 32 makes the uncategorized count a stated confidence bound. Until then, `actual` is whatever share of spend happens to be categorized, and the projection multiplies that error by `1 / elapsedFraction`. This task does not fix it and must not imply it has. What it does instead is make the amplification an arithmetic fact under test: acceptance #12 runs the identical row twice at day 8 of 30, differing by one $50 transaction, and pins that `actual` moves by exactly `50` while `projected` moves by exactly `187.50` — `50 × 30/8`. A prose warning nobody can run is how this compounds unnoticed; a pinned number is a thing step 32 can cite.

## The shape, stated as signature-level fact

```
export type PaceStatus = 'off-cycle' | 'no-budget' | 'future' | 'complete' | 'too-early' | 'projected';

export interface CategoryPace {
  categoryId: number;
  category: string;
  scored: boolean;              // isScoredCategory(row) — a flag, never a filter (Q5)
  month: number;                // 0 = January, as MonthSpend.month and monthly_amounts index
  elapsedDays: number;          // 0 future / asOf.day current / daysInMonth complete
  daysInMonth: number;          // of THIS record's month, in asOf.year — Gregorian
  elapsedFraction: number;      // elapsedDays / daysInMonth; in [0, 1]; not rounded
  budgeted: number;             // budgetedForMonth, cent-rounded — the imported definition
  actual: number;               // cent-rounded, non-negative magnitude
  spentRatio: number | null;    // actual / budgeted, or null when budgeted <= 0; not rounded
  projected: number | null;     // roundCents(actual / elapsedFraction), per Q2/Q6; money, rounded
  projectedVariance: number | null;  // roundCents(projected - budgeted); negative is UNDER
  projectedRatio: number | null;     // projected / budgeted, or null when budgeted <= 0; not rounded
  status: PaceStatus;
}
```

## Conventions this task must honor

- **Sign — the projection introduces a multiplier, which is a new place for a sign to hide.** All magnitudes are non-negative dollar amounts, not the ledger's signed-transaction convention; resolving that is the caller's job, exactly as for `MonthSpend.actual`. **`projectedVariance = projected − budgeted`, always in that order.** Negative is UNDER budget, positive is OVER — the identical convention `MonthVariance.variance` and `ScoredHeadline.variance` state, never a second one. `projectedRatio = projected ÷ budgeted` and is therefore ≥ 0 whenever it is non-null; it is a **fraction of budget**, so `2.6625` reads "266.25% of budget", i.e. "166.25% over" — a renderer that wants "over" subtracts 1 and owns that. The module never emits `Math.abs(...)`, never `budgeted − projected`, never `1 − projected / budgeted`, and never `budgeted / projected`. **The multiplier itself is `1 / elapsedFraction`, always ≥ 1 and never negative**, so it can never flip a sign; if a projection ever comes out below its own spend-to-date, that is a defect, and acceptance #4 pins `projected >= actual` on the current-month fixtures.
- **Rounding — per step, never once at the end; money rounds, ratios do not.** `budgeted` is `budgetedForMonth`'s already-cent-rounded figure (imported, not recomputed). `actual` is `roundCents(spend.actual)`. `projected` is **money** and is `roundCents(actual / elapsedFraction)`. `projectedVariance` is computed **from the already-rounded `projected`**, then cent-rounded again — the same per-step discipline `toMonthVariance` follows, and never a raw-float difference carried to the end. `spentRatio`, `projectedRatio` and `elapsedFraction` are **ratios, not money, and are never rounded** — cent-rounding a percentage quantizes it into 1% steps, which P0.5-29a pinned as a category error. Acceptance #20's `2.4000960038401535` is the discriminator: it is what you get from a cent-rounded denominator and an unrounded ratio, and nothing else produces it.
- **Negative zero is not a sign, and here it is reachable.** `roundCents(-0.001)` is `-0` (`Math.round(-0.1)` is `-0`, and `-0 / 100` is `-0`), which is a plausible arrival — a caller's SQL `SUM` over signed rows netting a hair below zero. It then propagates: `-0 / 0.2666…` is `-0`, `roundCents(-0)` is `-0`, and `-0 / 500` is `-0`. Every emitted number that can reach `-0` — `actual`, `projected`, `projectedVariance`, `spentRatio`, `projectedRatio` — must be normalised through the **imported** `withoutNegativeZero`, such that `Object.is(value, -0)` is `false`. This is a *reachable* path, unlike P0.5-29a's #4/#12 which NITS N22/N27 established were vacuous: acceptance #15 supplies `actual: -0.001` and asserts on the real route.
- **Landscape + exclusions — three conjuncts to exist, four to be `scored`.** A record exists iff `isTrackedCategory(row)`: `landscape = 'operational'` AND `exclude_from_budget = FALSE` AND `is_income = FALSE`. `scored` is `isScoredCategory(row)`, adding `control_mode = 'discretionary'`. Both predicates are **imported from `adherence.ts`**, never re-expressed as an inline filter. `hidden` and `track_transactions` are `transactions`/`accounts` flags this module never sees; resolving them upstream is the caller's job.
- **Null semantics — one rule per divisor, stated.** `spentRatio` and `projectedRatio` are `null` iff `budgeted <= 0`; never `0`, never `NaN`, never `Infinity`, never `-0`. `projected`, `projectedVariance` and `projectedRatio` are `null` for statuses `'off-cycle'`, `'no-budget'`, `'future'` and `'too-early'`, and non-null for `'complete'` and `'projected'` (subject to the `budgeted <= 0` rule on the ratio). `categoryPacing` returns `[]` — never `null` — when no row is tracked. `elapsedFraction` is always a real number in `[0, 1]`.
- **No wall clock.** `pacing.ts` contains no `new Date(` and no `Date.now(`. Acceptance #26.

## Toolchain prerequisites

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `node_modules`, vitest v4, typescript present | **yes** | `npm ci` | `test -d node_modules/vitest && test -d node_modules/typescript && echo OK` | `OK` (spec-writer, 2026-09-02) |
| T2 | Clean baseline: whole suite green, tsc clean, lint at 0 errors | **yes** | working tree at `79c3a42` | `npx vitest run 2>&1 \| tail -4; npx tsc --noEmit; echo "tsc=$?"; npm run lint 2>&1 \| tail -2` | `Test Files 19 passed (19)`, `Tests 345 passed (345)`, `tsc=0`, `1 problem (0 errors, 1 warning)` (spec-writer, re-measured 2026-09-02) |
| T3 | `lib/domain/adherence.test.ts` holds exactly 47 passing tests today, none skipped — the "all 47 unmodified" claim rests on it | **yes** | branch state | `npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 \| grep -cE "✓ lib/domain/adherence\.test\.ts"` | `47` (spec-writer) |
| T4 | The one pre-existing lint warning is in `scripts/seed-demo.mjs`, which this task does not touch, so acceptance #3 is a real gate on new code | **yes** | branch state | `npm run lint 2>&1 \| grep -c "scripts/seed-demo.mjs"` | `1` (spec-writer) |
| T5 | `lib/**/*.test.ts` is a vitest include glob, so `lib/domain/pacing.test.ts` runs at all | **yes** — a new test file outside the globs would be silently uncollected | `vitest.config.mts` | `grep -cF "lib/**/*.test.ts" vitest.config.mts` | `1` (spec-writer) |
| T6 | vitest v4 prints `Tests  N passed (N)` with no skipped segment only when nothing was skipped — load-bearing for #2/#4, which turn the name-greps in #5–#21 from "the test exists" into "the test passed" | **yes** | carried from P0.5-29a T5, re-verified | `npx vitest run --pool=threads lib/domain/adherence.test.ts 2>&1 \| grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"` | `1` (spec-writer) |
| T7 | An unused `@ts-expect-error` is a hard error (TS2578) under this `tsconfig.json`, so #28 discriminates a required second parameter from an optional one | **yes** — load-bearing for #28 | tsc default; `"strict": true` in `tsconfig.json` | scratch file with `// @ts-expect-error` over a legal call → `npx tsc --noEmit --strict --skipLibCheck <file>` | `error TS2578: Unused '@ts-expect-error' directive.`, exit 2 (carried from P0.5-29a T6, verified by experiment) |
| T8 | The Finder/iCloud duplicate files that blocked P0.5-29a (`lib/domain/adherence*2.ts`) are gone from the tsc program | **yes** — #1 fails otherwise | tree hygiene already done | `ls lib/domain/ \| grep -c " 2\."` | `0` (spec-writer) |
| T9 | `npm run lint` and `npm test` exist with these names | **yes** | `package.json` | `grep -cE '"(test\|lint)": "' package.json` | `2` (spec-writer) |
| T10 | `grep -cF` matches test names containing em dashes and commas as emitted by the verbose reporter | **yes** | carried from P0.5-29a T7 | `npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 \| grep -cF "excludes a variable-necessary category from the scored set — tracked and reported, never scored, same as fixed"` | `1` (spec-writer) |
| T10a | The N16-style import-scoped and code-scoped greps (#24, #25, #25a) discriminate: a file whose *comments* name `budgetColors`, `monthPct` and `Infinity` scores `0/0/0`, while a file that imports and calls them scores `1/1/2` | **yes** — otherwise #24/#25/#25a penalise the explanatory comment rather than the coupling | scratch files | two scratch files as described, run through the three commands | `0/0/0` and `1/1/2` (spec-writer, verified by experiment) |
| T11 | Postgres / a database | **NO** — every test here is a pure function over fabricated inputs | n/a | n/a | n/a |
| T12 | Plaid credentials, network | **NO** | n/a | n/a | n/a |
| T13 | `node_modules/next/dist/docs/` | **NO** — no Next-facing code is touched | n/a | n/a | n/a |

**No test name in #5–#21 contains a `$`, a backtick, a `!`, or a `|`** — dollar amounts are written as bare numbers or the word "dollars" in the descriptions — so each pattern is safe inside the double quotes the commands use.

## Acceptance commands

`…` abbreviates `npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1` for width; each of #5–#21 is that prefix piped to its own `grep -cF`. All commands run from the repo root.

> **Pipe-escaping convention, repeating P0.5-29a's warning because it cost that task a G0 failure.** Inside a Markdown table cell, `\|` renders as one literal `|` and means one literal pipe character in the command. `\|` inside an ERE is a **literal pipe, not alternation** — `grep -cE "new Date\(\|Date\.now\("` matches nothing and enforces nothing. The regex-bearing commands (#26, #27, #29, #30, #31) are therefore repeated verbatim and unescaped in the code block below the table, and **that block is authoritative** if the two ever disagree.

| # | Command | Expected |
|---|---|---|
| 1 | `npx tsc --noEmit; echo "exit=$?"` | `exit=0` |
| 2 | `npm test 2>&1 \| grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"` | `1` — whole repo green, nothing skipped |
| 3 | `npm run lint 2>&1 \| tail -2` | `1 problem (0 errors, 1 warning)` — the pre-existing `scripts/seed-demo.mjs` warning and no other |
| 4 | `test $(npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 \| grep -cE "✓ lib/domain/pacing\.test\.ts") -ge 17 && echo OK` | `OK` — at least the 17 named cases below |
| 5 | `… \| grep -cF "the roadmap's own day-8-of-30 sentence computes exactly: a category at 71 percent of its month projects to close at 266.25 percent of its budget, and the projection is not the spend-to-date figure"` | `1` — **the binding numeric case** |
| 6 | `… \| grep -cF "the projection floor is inclusive at exactly a quarter of the month elapsed, so day 7 of a 28-day February projects while day 7 of a 30-day April and day 7 of a 29-day leap February do not"` | `1` |
| 7 | `… \| grep -cF "day one of a thirty-day month has a real elapsed fraction of one thirtieth rather than zero, and the projection is withheld as too early rather than multiplied by thirty"` | `1` |
| 8 | `… \| grep -cF "a month that begins after the as-of point has no elapsed fraction and reports a null projection rather than NaN or Infinity, whether its supplied actual is zero or nonzero"` | `1` |
| 9 | `… \| grep -cF "a month that ended before the as-of point is complete, its elapsed fraction is one and its projection is its actual, never the as-of month's fraction applied to it"` | `1` |
| 10 | `… \| grep -cF "off-cycle spend, where a scheduled category draws money in a month its schedule budgeted nothing for, reports a distinct off-cycle status and no percentage of any kind"` | `1` |
| 11 | `… \| grep -cF "a zero-budget month on a category with no schedule at all reports no-budget rather than off-cycle, so money outside its window is distinguishable from money against no window"` | `1` |
| 12 | `… \| grep -cF "a scheduled category is on budget in the month its schedule funds and off-cycle in a month it does not, in one call over one row"` | `1` |
| 13 | `… \| grep -cF "the projection multiplier amplifies a single late-categorized transaction by the reciprocal of the elapsed fraction, so 50 dollars of newly categorized spend at day 8 of 30 moves the projected close by 187.50"` | `1` — the inherited-error bound, measured |
| 14 | `… \| grep -cF "pacing ranges over every tracked category and flags the scored ones, so fixed and variable-necessary lines still report a projection while capital, excluded and income lines report nothing at all"` | `1` |
| 15 | `… \| grep -cF "pacing never invents a month the caller did not supply and returns the supplied months in calendar order whatever order they arrived in"` | `1` |
| 16 | `… \| grep -cF "an as-of day outside the real length of its own month is rejected with a RangeError rather than producing an elapsed fraction of zero or above one"` | `1` |
| 17 | `… \| grep -cF "the leap rule is Gregorian, so February 29 is a valid as-of day in 2024 and rejected in 2026, and 2100 is not a leap year while 2000 is"` | `1` |
| 18 | `… \| grep -cF "a supplied month index outside 0 through 11 is rejected with a RangeError rather than silently substituting the even spread the adherence module substitutes"` | `1` |
| 19 | `… \| grep -cF "a per-month actual that rounds to negative zero is normalized away at every emitted figure, so no surface can print a minus sign on a category that spent nothing"` | `1` |
| 20 | `… \| grep -cF "a negative budgeted amount yields null for both ratios rather than an inverted percentage, while the dollar projection is still reported"` | `1` |
| 21 | `… \| grep -cF "pacing resolves a month's budget through the same budgetedForMonth the adherence module uses, so the two agree on 83.33 for a 1,000 annual budget and the projected ratio carries the rounded denominator"` | `1` — **the one-definition gate** |
| 22 | `grep -cE "^import \{[^}]*budgetedForMonth[^}]*\} from './adherence';" lib/domain/pacing.ts` | `1` — the definition is imported, not retyped |
| 23 | `grep -cE '/ *(12\|MONTHS_PER_YEAR)' lib/domain/pacing.ts` | `0` — no sixth even-spread implementation |
| 24 | `grep -cE '^import .*budgetColors' lib/domain/pacing.ts` | `0` — no import. **Import-scoped rather than the filename grep P0.5-29a used**, per NITS N16's explicit request: the blunt form penalised prose naming the module the code is deliberately *not* coupled to, and failed a draft at `3` for three explanatory comments |
| 25 | `grep -cE '\bmonthPct\(' lib/domain/pacing.ts` | `0` — no call, prose free to name it |
| 25a | `grep -cE '(= \|return \|: )Infinity\b' lib/domain/pacing.ts` | `0` — N16's code-scoped `Infinity` check: no non-finite value is produced or returned, while a comment may still explain why |
| 26 | `grep -cE 'new Date\(\|Date\.now\(' lib/domain/pacing.ts` — ERE **alternation**, unescaped pipe | `0` |
| 27 | `grep -cE '^export function categoryPacing\(rows: AdherenceInput\[\], asOf: AsOf\): CategoryPace\[\] \{' lib/domain/pacing.ts` | `1` |
| 28 | `grep -cF "// @ts-expect-error categoryPacing requires an explicit as-of point; there is no clock inside the module" lib/domain/pacing.test.ts` | `1` — paired with #1: if `asOf` is optional or absent, the directive is unused and #1 fails TS2578 |
| 29 | `grep -cE '^export function budgetedForMonth\(row: AdherenceInput, month: number\): number \{' lib/domain/adherence.ts` | `1` — `0` today |
| 30 | `git diff -U0 HEAD -- lib/domain/adherence.ts \| grep -E '^[+-][^+-]' \| grep -vE '^[+-][[:space:]]*(//\|\*\|/\*)' \| grep -cvE 'budgetedForMonth\|withoutNegativeZero'` | `0` — every non-comment changed line in the adherence module mentions one of the two functions being exported; no function body changed |
| 31 | `git diff --name-only HEAD \| grep -vE '^(lib/domain/(adherence\|pacing)(\.test)?\.ts\|plan/)' \| wc -l \| tr -d ' '` | `0` — nothing outside the two modules, their tests, and `plan/` was modified |
| 32 | `git status --porcelain lib/domain/pacing.ts lib/domain/pacing.test.ts \| wc -l \| tr -d ' '` | `2` — both new files exist |
| 33 | `test $(npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 \| grep -cE "✓ lib/domain/adherence\.test\.ts") -eq 47 && echo OK` | `OK` — all 47 still pass, none added, none removed |
| 34 | `git diff --stat HEAD -- lib/domain/adherence.test.ts \| wc -l \| tr -d ' '` | `0` — the adherence **test** file is byte-identical; the 47 are unmodified, not merely re-passing |
| 35 | `… \| grep -cF "the elapsed fraction is day-granular, so a category eight days into a thirty-day month is not treated as having spent a whole month the way the dashboard's year pace treats the current month"` | `1` |

**The regex-bearing commands, verbatim and authoritative** (copy from here, not from the table):

```sh
# 23 — no sixth even-spread implementation.  Expect: 0
grep -cE '/ *(12|MONTHS_PER_YEAR)' lib/domain/pacing.ts

# 24 — no import of the incumbent colour module; a comment naming it is allowed.  Expect: 0
grep -cE '^import .*budgetColors' lib/domain/pacing.ts

# 25 — no call to monthPct.  Expect: 0
grep -cE '\bmonthPct\(' lib/domain/pacing.ts

# 25a — no Infinity produced or returned in code. Unescaped | = ERE alternation.  Expect: 0
grep -cE '(= |return |: )Infinity\b' lib/domain/pacing.ts

# 26 — no wall clock inside the module. Unescaped | = ERE alternation.  Expect: 0
grep -cE 'new Date\(|Date\.now\(' lib/domain/pacing.ts

# 27 — the signature is present, literally, with the as-of parameter.  Expect: 1
grep -cE '^export function categoryPacing\(rows: AdherenceInput\[\], asOf: AsOf\): CategoryPace\[\] \{' lib/domain/pacing.ts

# 29 — budgetedForMonth is exported.  Expect: 1  (0 on the current tree)
grep -cE '^export function budgetedForMonth\(row: AdherenceInput, month: number\): number \{' lib/domain/adherence.ts

# 30 — the adherence diff touches no function body.  Expect: 0
git diff -U0 HEAD -- lib/domain/adherence.ts \
  | grep -E '^[+-][^+-]' \
  | grep -vE '^[+-][[:space:]]*(//|\*|/\*)' \
  | grep -cvE 'budgetedForMonth|withoutNegativeZero'

# 31 — nothing outside the two modules, their tests, and plan/ was modified.  Expect: 0
git diff --name-only HEAD | grep -vE '^(lib/domain/(adherence|pacing)(\.test)?\.ts|plan/)' | wc -l | tr -d ' '
```

Each was run at spec time and discriminates. #26 returns `1` on `lib/netWorth.ts` (a file that does read the clock) and `0` on `lib/domain/adherence.ts`. #27 returns `1` against a scratch file holding the target line and `0` against `lib/domain/adherence.ts`. #29 returns `1` against the exported form and `0` against the file as it stands (whose line is `function budgetedForMonth(row: AdherenceInput, month: number): number {`). #30 and #31 both return `0` on the clean tree, and `git diff` ignores untracked files, so creating `pacing.ts` cannot make #31 fail — #32 is what proves it was created. Note that `grep -c` exits `1` when it prints `0`; the observable is the printed number, not the exit code.

### Required fixture arithmetic — literal expected values

Every figure below was computed at spec time with `roundCents(n) = Math.round(n * 100) / 100` and the exact IEEE-754 results are given where they matter. These are the values the tests must assert, **not approximations to be re-derived**. `AS_OF` is `{ year: 2026, month: 3, day: 8 }` — April 8, 2026 — unless stated. April has 30 days, so `elapsedFraction = 8/30 = 0.26666666666666666` and the multiplier is `3.75`.

**Fixture P1 — §5's own sentence, made exact (acceptance #5, #35).** One scored category (`operational`, not excluded, not income, `discretionary`), `annual_budget: 6000`, `monthly_amounts: null` → `budgetedForMonth` = `roundCents(6000/12)` = `500`. `months: [{ month: 3, actual: 355 }]`. `AS_OF`.

| field | required value | explicit `not.toBe` |
|---|---|---|
| `status` | `'projected'` | `'too-early'` |
| `scored` | `true` | — |
| `elapsedDays` / `daysInMonth` | `8` / `30` | `daysInMonth` `not.toBe(31)` |
| `elapsedFraction` | `toBeCloseTo(0.26666666666666666, 15)` | `not.toBe(1)` (the dashboard's month-granular convention), `not.toBe(0.25806451612903225)` (`8/31`), `not.toBe(0.23333333333333334)` (`7/30`, the 0-based off-by-one) |
| `budgeted` / `actual` | `500` / `355` | — |
| `spentRatio` | `0.71` exactly | — |
| `projected` | `1331.25` | `not.toBe(355)` (spend-to-date passed off as a projection, i.e. `elapsedFraction: 1`), `not.toBe(1375.63)` (`daysInMonth` assumed 31), `not.toBe(1521.43)` (day 7) |
| `projectedVariance` | `831.25` | `not.toBe(-831.25)` (sign inverted) |
| `projectedRatio` | `2.6625` exactly | `not.toBe(0.71)` (spend ratio reported as the projection), `not.toBeCloseTo(2.87, 2)` (§5's illustrative "187% over", which no elapsed-fraction projection produces — see Underspecified below) |

`projected >= actual` must hold, since the multiplier is `1/0.2666… = 3.75 >= 1`.

**Fixture P2 — the floor, inclusive, both sides, across three month lengths (acceptance #6).** `annual_budget: 1200`, `monthly_amounts: null` → `100`/month.
- **April, day 7** (`{2026, 3, 7}`), `months: [{3, 30}]`: `elapsedFraction` `0.23333333333333334` < `0.25` → `status: 'too-early'`, `projected`/`projectedVariance`/`projectedRatio` all `null`; `budgeted: 100`, `actual: 30`, `spentRatio: 0.3` still reported.
- **February 2026, day 7** (`{2026, 1, 7}`), `months: [{1, 30}]`: 2026 is not a leap year → `daysInMonth: 28`, `elapsedFraction` **exactly `0.25`** → `status: 'projected'`, `projected: 120`, `projectedVariance: 20`, `projectedRatio: 1.2`. This is the case a `>` comparison fails and a `>=` passes.
- **February 2024, day 7** (`{2024, 1, 7}`), `months: [{1, 30}]`: leap → `daysInMonth: 29`, `elapsedFraction` `0.2413793103448276` < `0.25` → `status: 'too-early'`, `projected: null`. A `daysInMonth` hardcoded to 28 for February would project here and fail.

**Fixture P3 — day 1 is not a division by zero (acceptance #7).** P1's row, `AS_OF = {2026, 3, 1}`. `elapsedDays: 1`, `elapsedFraction` `toBeCloseTo(0.03333333333333333, 15)` and **`not.toBe(0)`**; `status: 'too-early'`; `projected`/`projectedVariance`/`projectedRatio` all `null`. `actual: 355`, `spentRatio: 0.71` still real. Explicit: no field equals `10650` (`355 × 30`, the projection a floorless implementation would print on day 1), and `Number.isFinite` holds for every numeric field that is non-null.

**Fixture P4 — the future month (acceptance #8).** `annual_budget: 1200`, `monthly_amounts: null`, `months: [{ month: 11, actual: 0 }]`, `AS_OF`. `status: 'future'`, `elapsedDays: 0`, `elapsedFraction: 0`, `daysInMonth: 31` (December), `budgeted: 100`, `actual: 0`, `spentRatio: 0`, and `projected`/`projectedVariance`/`projectedRatio` all `null`. Asserted explicitly: `Number.isNaN(projected as unknown as number) === false` — a naive `actual / elapsedFraction` here is `0/0 = NaN`. Second row in the same test, `months: [{ month: 11, actual: 250 }]` (a pre-authorised charge): same status, `projected: null`, and `projected !== Infinity` — the naive answer is `250/0 = Infinity`.

**Fixture P5 — the completed month (acceptance #9).** `annual_budget: 1200`, `monthly_amounts: null`, `months: [{ month: 0, actual: 143 }]`, `AS_OF`. January: `status: 'complete'`, `daysInMonth: 31`, `elapsedDays: 31`, `elapsedFraction: 1`, `budgeted: 100`, `actual: 143`, `projected: 143` — **and explicitly `toBe(actual)`**, plus `not.toBe(536.25)` (`143 × 3.75`, the as-of month's fraction wrongly applied to a finished month). `projectedVariance: 43`, `projectedRatio: 1.43`.

**Fixture P6 — off-cycle is a breach in its own right, not a percentage (acceptance #10, #12).** A March-only category: `annual_budget: 1200`, `monthly_amounts: [0,0,1200,0,0,0,0,0,0,0,0,0]`, `months: [{ month: 2, actual: 1150 }, { month: 3, actual: 275 }]`, `AS_OF`.
- **Month 2 (March)** — the month the schedule funds: `status: 'complete'`, `budgeted: 1200`, `actual: 1150`, `projected: 1150`, `projectedVariance: -50` (negative ⇒ **under**), `projectedRatio: 0.9583333333333334`.
- **Month 3 (April)** — outside its window: `budgeted: 0`, `actual: 275`, `status: 'off-cycle'`, and **all four of `spentRatio`, `projected`, `projectedVariance`, `projectedRatio` are `null`**. Explicit: `spentRatio !== Infinity` (what `monthPct` answers for this input), `Number.isNaN(spentRatio as unknown as number) === false`, and `projected` `not.toBe(1031.25)` (`275 × 3.75`).

One row, one call, two statuses — which is also the schedule-awareness demonstration §5's constraint 2 asks for, at the granularity where it is actually true.

**Fixture P7 — no-budget is not off-cycle (acceptance #11).** `annual_budget: 0`, `monthly_amounts: null`, `months: [{ month: 3, actual: 275 }]`, `AS_OF`. `budgeted: 0`, `actual: 275`, `status: 'no-budget'` — **and explicitly `not.toBe('off-cycle')`**; all four ratio/projection fields `null`. Companion row in the same test: the P6 schedule with `months: [{ month: 3, actual: 0 }]` → `status: 'no-budget'`, **not** `'off-cycle'`, pinning the `actual > 0` conjunct.

**Fixture P8 — the projection multiplier amplifies the inherited categorization error (acceptance #13).** P1's row run twice at `AS_OF`, identical but for one $50 transaction:
- Run A, `actual: 355` → `projected: 1331.25`.
- Run B, `actual: 405` → `projected: 1518.75`.
- `actualB − actualA` `toBe(50)`; `projectedB − projectedA` `toBeCloseTo(187.5, 10)` — and **explicitly `not.toBe(50)`**. `187.5 = 50 × 30/8`, the reciprocal of the elapsed fraction.

**Fixture P9 — range and flag (acceptance #14).** One `rows` array of six categories, all with `months: [{ month: 3, actual: 400 }]`, `annual_budget: 1200`, `monthly_amounts: null`, `AS_OF`:

| id | row | expected |
|---|---|---|
| 1 | `discretionary`, operational, not excluded, not income | record present, `scored: true` |
| 2 | `fixed` | record present, `scored: false` |
| 3 | `variable-necessary` | record present, `scored: false` |
| 4 | `landscape: 'capital'`, `discretionary` | **no record at all** |
| 5 | `exclude_from_budget: true`, `discretionary` | **no record at all** |
| 6 | `is_income: true`, `discretionary` | **no record at all** |

Assert `result.map(p => p.categoryId)` `toEqual([1, 2, 3])` and `result.length` `toBe(3)` — **and explicitly `not.toBe(1)`** (a four-conjunct gate) and `not.toBe(6)` (no gate).

**Fixture P10 — no invented months, calendar order (acceptance #15).** `annual_budget: 1200`, `monthly_amounts: null`, `months` supplied as `[{3, 40}, {0, 40}, {11, 0}]`, `AS_OF`. `result.map(p => p.month)` `toEqual([0, 3, 11])`; `result.length` `toBe(3)` — **and explicitly `not.toBe(12)`** (an implementation that ranged over the calendar year, or read a clock for it).

**Fixture P11 — an as-of that is not a real day throws (acceptance #16).** Each of the following, over P1's row, must `toThrow(RangeError)`: `{2026, 3, 0}` (day 0 → an elapsed fraction of 0 → `Infinity`); `{2026, 3, 31}` (April has 30 days); `{2026, 1, 29}` (2026's February has 28); `{2026, 12, 1}` (month out of 0–11); `{2026, -1, 1}`; `{2026, 3, 8.5}` (non-integer). And `{2026, 3, 30}` must **not** throw. A validator checking only `1 <= day <= 31` passes the second and third and fails this test.

**Fixture P12 — the Gregorian leap rule, observed through pacing (acceptance #17).** `{2024, 1, 29}` over a row with `months: [{ month: 1, actual: 60 }]` does **not** throw and reports `daysInMonth: 29`; `{2026, 1, 29}` throws `RangeError`. Plus the exported helper directly: `daysInMonth(2100, 1)` `toBe(28)` — **the case a `year % 4 === 0` rule gets wrong** — and `daysInMonth(2000, 1)` `toBe(29)`, `daysInMonth(2026, 1)` `toBe(28)`, `daysInMonth(2024, 1)` `toBe(29)`, `daysInMonth(2026, 3)` `toBe(30)`, `daysInMonth(2026, 0)` `toBe(31)`.

**Fixture P13 — an out-of-range supplied month throws (acceptance #18).** P6's March-only row with `months: [{ month: 12, actual: 1150 }]` — NITS N15's exact confirmed probe, the 1-indexed-`EXTRACT(MONTH …)` off-by-one — must `toThrow(RangeError)` from `categoryPacing`. In the same test, assert that `detectAdherence` over the identical row still returns its unchanged silent-substitution finding (`budgeted: 100`, `variance: 1050`, `ratio: 11.5`), so the deliberate sibling divergence is a recorded fact rather than an accident, and so a "fix" to `detectAdherence` goes red.

**Fixture P14 — negative zero, on a reachable path (acceptance #19).** P1's row with `months: [{ month: 3, actual: -0.001 }]`, `AS_OF`. `roundCents(-0.001)` is `-0`, which propagates to `projected` and `spentRatio`. Required: `actual` `toBe(0)` with `Object.is(actual, -0) === false`; `projected` `toBe(0)` with `Object.is(projected, -0) === false`; `spentRatio` `toBe(0)` with `Object.is(spentRatio, -0) === false`; `projectedRatio` `toBe(0)` with `Object.is(projectedRatio, -0) === false`; `projectedVariance` `toBe(-500)`. Per NITS N27, the test must also pin the residue it depends on, so it cannot silently stop gating if `roundCents` is ever retuned:

```ts
expect(Object.is(roundCents(-0.001), -0)).toBe(true);
```

**Fixture P15 — a negative budget yields no percentage (acceptance #20).** `annual_budget: -1200`, `monthly_amounts: null` → `budgetedForMonth` = `-100`. `months: [{ month: 3, actual: 50 }]`, `AS_OF`. `budgeted: -100`, `actual: 50`, `projected: 187.5`, `projectedVariance: 287.5`, and **`spentRatio: null`, `projectedRatio: null`** — explicitly `not.toBe(-0.5)` and `not.toBe(-1.875)`, the inverted percentages a `budgeted !== 0` guard would emit. This applies NITS N21's ruling consistently one module over: a blank beats a confidently wrong sign.

**Fixture P16 — one definition of the month's budget, proven by a decimal (acceptance #21).** `annual_budget: 1000`, `monthly_amounts: null`, `months: [{ month: 0, actual: 200 }]`, `AS_OF` (so January is `complete`).
- `budgetedForMonth` → `roundCents(1000/12)` = **`83.33`**, and `detectAdherence` over the same row emits a breach whose `budgeted` is `83.33`. Assert `pace.budgeted` `toBe(detectAdherence(rows)[0].budgeted)` and `toBe(83.33)` — **`not.toBe(83.33333333333333)`**.
- `projected: 200`, `projectedVariance: 116.67`, and `projectedRatio` `toBe(2.4000960038401535)` — **`not.toBe(2.4000000000000004)`**, which is what an unrounded even-spread denominator produces, and **`not.toBe(2.4)`**, which is what a cent-rounded ratio produces. The three values are distinguishable at the 5th decimal and only the first is reachable from the imported definition with an unrounded ratio. N19's four-cents divergence from `components/BudgetMonthlyGrid.tsx` is inherited here unchanged and deliberately.

## Negative controls

| # | Rule stated in prose | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | The projection is spend-to-date divided by the elapsed fraction, not spend-to-date | P1: `projected` `not.toBe(355)` — the value an `elapsedFraction: 1` (dashboard-style) implementation gives | #5 |
| 2 | The elapsed fraction is day-granular, not month-granular | P1: `elapsedFraction` `not.toBe(1)`; `projected` `not.toBe(355)` | #5, #35 |
| 3 | `daysInMonth` is the real length of *that* month | P1: `daysInMonth` `not.toBe(31)`; `projected` `not.toBe(1375.63)` | #5 |
| 4 | The as-of day is 1-based and treated as elapsed | P1: `projected` `not.toBe(1521.43)` (`355 × 30/7`) | #5 |
| 5 | The floor is inclusive at exactly 0.25 | P2: February 2026 day 7, `elapsedFraction` exactly `0.25`, must be `'projected'` — a `>` comparison reports `'too-early'` | #6 |
| 6 | The floor withholds only the projection, not the spend-to-date figures | P2 April day 7: `projected: null` **and** `actual: 30`, `spentRatio: 0.3` still present | #6 |
| 7 | A projection is never emitted below the floor | P3: no field equals `10650`; `projected` is `null` on day 1 | #7 |
| 8 | Elapsed fraction 0 never reaches a division | P4: `Number.isNaN(projected) === false` for `actual: 0`; `projected !== Infinity` for `actual: 250` | #8 |
| 9 | A finished month is projected at fraction 1, not at the as-of month's fraction | P5: `projected` `toBe(actual)` and `not.toBe(536.25)` | #9 |
| 10 | Off-cycle spend yields no percentage of any kind | P6 month 3: all four of `spentRatio`/`projected`/`projectedVariance`/`projectedRatio` are `null`; `spentRatio !== Infinity`; `projected` `not.toBe(1031.25)` | #10 |
| 11 | Off-cycle and no-budget are different statements | P7: `status` `toBe('no-budget')` and `not.toBe('off-cycle')` for a no-schedule row; and `'no-budget'`, not `'off-cycle'`, for a scheduled $0 month with zero spend | #11 |
| 12 | The schedule is authoritative per month | P6 month 2: `budgeted: 1200` from `monthly_amounts[2]`, not `100` from the even spread | #12 |
| 13 | The projection amplifies the inherited categorization error by `1/elapsedFraction` | P8: `projectedB − projectedA` `not.toBe(50)`; must be `187.5` | #13 |
| 14 | Three conjuncts gate existence, four gate `scored` | P9: `length` `not.toBe(1)` (four-conjunct gate drops the `fixed` and `variable-necessary` rows) and `not.toBe(6)` (no gate admits capital/excluded/income) | #14 |
| 15 | No month the caller did not supply is invented | P10: `length` `not.toBe(12)`; `map(p => p.month)` `toEqual([0, 3, 11])` | #15, #26 |
| 16 | An as-of point that is not a real day is rejected, not resolved | P11: April 31 and February 29 of 2026 must throw — a `1 <= day <= 31` validator admits both | #16 |
| 17 | The leap rule is Gregorian, not `year % 4` | P12: `daysInMonth(2100, 1)` `toBe(28)`; `{2026, 1, 29}` throws while `{2024, 1, 29}` does not | #17 |
| 18 | An out-of-range supplied month is rejected here, and `detectAdherence` still substitutes | P13: `categoryPacing` throws; `detectAdherence` still returns `budgeted: 100, variance: 1050, ratio: 11.5` for the same row | #18 |
| 19 | Negative zero is normalised on a path that actually reaches it | P14: `Object.is(actual, -0)`, `(projected, -0)`, `(spentRatio, -0)`, `(projectedRatio, -0)` all `false`, plus the `roundCents(-0.001)` residue pin | #19 |
| 20 | A negative budget yields `null` ratios, never an inverted percentage | P15: `spentRatio` and `projectedRatio` `not.toBe(-0.5)` / `not.toBe(-1.875)` | #20 |
| 21 | The per-month budget is the imported definition, not a copy | P16: `budgeted` `not.toBe(83.33333333333333)`; `projectedRatio` `not.toBe(2.4000000000000004)` | #21, #22, #23 |
| 22 | Ratios are not rounded; money is | P16: `projectedRatio` `not.toBe(2.4)` | #21 |
| 23 | `projectedVariance` is `projected − budgeted`, negative is under | P1: `not.toBe(-831.25)`; P6 month 2: `toBe(-50)` for a category that came in under | #5, #12 |
| 24 | There is no clock inside the module | Any `new Date(` or `Date.now(` in `pacing.ts` — including `new Date(y, m+1, 0).getDate()` for month length | #26 |
| 25 | No coupling to the incumbent colour module and its `Infinity` | An `import` of `budgetColors`, a `monthPct(` call, or an `Infinity` produced or returned in code — while a comment explaining the deliberate non-coupling is explicitly permitted | #24, #25, #25a |
| 26 | The as-of point is a required parameter, not an optional one with a clock default | A call `categoryPacing(rows)` must not compile — the `@ts-expect-error` directive must be *used* | #1 + #28 |
| 27 | `adherence.ts` changes only by exporting two functions | Any non-comment changed line in that file that does not mention `budgetedForMonth` or `withoutNegativeZero` | #29, #30 |
| 28 | The 47 adherence tests are unmodified, not merely re-passing | Any diff at all to `lib/domain/adherence.test.ts` — including a rename to accommodate the export | #33, #34 |
| 29 | No renderer, route or page is touched | Any tracked modified path outside the two modules, their tests, and `plan/` — including `app/dashboard/page.tsx` | #31 |
| 30 | The new test file is actually collected by vitest | A test file outside `lib/**/*.test.ts` would be silently uncollected and #4 would report `0` | T5, #4 |

**Vacuity check, command by command.** #1/#2/#3 prove nothing broke, not that anything shipped — not load-bearing alone. #4 bounds the work: a diff adding a module and two tests fails it. #5 is the binding numeric case and no stub reaches `1331.25`, `831.25` and `2.6625` together; its four `not.toBe` values are the four plausible wrong implementations (elapsed fraction 1, `daysInMonth` 31, day 7, spend-ratio-as-projection). #6 is the only command that can tell `>` from `>=` and simultaneously the only one that catches a February hardcoded to 28. #7 catches an implementation with no floor, which is the tempting simple version, and #8 catches the two divide-by-zero leaks (`NaN` and `Infinity`) that a future month produces. #9 catches a completed month being multiplied by the current month's fraction. #10 is the §5 constraint-3 gate: an implementation reusing `detectAdherence`'s `budgeted === 0` breach, or `monthPct`'s `Infinity`, fails it. #11 catches the two zero-budget cases being collapsed — the distinction `lib/budgetColors.ts` already draws and `detectAdherence` cannot. #12 proves month-granular schedule awareness in the same row that proves off-cycle. #13 turns the inherited-error prose into a number. #14 catches both the four-conjunct slip (plausible: it matches `scoredHeadline` two modules over) and a missing landscape gate. #15 catches a clock-derived or twelve-month range. #16 and #17 catch a day validator that does not know month lengths and a leap rule that fails in 2100 — the latter reachable *only* because the clock grep forbids `new Date`. #18 catches a silent even-spread substitution in a module that cannot survive one. #19 is a genuine `-0` gate on a reachable path, unlike P0.5-29a's #4/#12 which NITS N22/N27 measured as vacuous. #20 catches a `budgeted !== 0` guard. #21 is the one-definition gate and its three candidate decimals are distinguishable — no copy of the even spread lands on `2.4000960038401535`. #22/#23/#24/#25/#25a/#26 are static and catch an import that never happened, a re-typed divisor, colour-module coupling, a produced `Infinity`, and a clock, none of which any type error reveals; #24/#25/#25a are scoped to imports, calls and code respectively so they gate the coupling rather than the comment that explains its absence (NITS N16). #27 pins the signature literally. #28 makes the as-of parameter's requiredness mechanical via TS2578. #29/#30 confine the adherence diff to two `export` keywords. #31 catches scope creep into `app/dashboard/page.tsx`, which §5's wording actively invites. #32 proves the files were created rather than the tests being smuggled into an existing file. #33/#34 make "the 47 are unmodified" a byte-level fact rather than a claim. #35 pins the specific defect the incumbent pace math has and this module must not inherit.

## Evidence required

- Verbatim output of all 35 acceptance commands in `EVIDENCE.md`, including the exit code for #1 and the printed number for every `grep -c`.
- **A worked rendering of §5's sentence, run as a command**: the Fixture P1 record printed as JSON, beside the English sentence it licenses — "as of day 8 of 30, Dining is at 71% of its month, projected to close at $1,331.25, which is 266.25% of its $500 budget — $831.25 over." This is the artifact step 31 will render from, and it must be shown to be producible from the module's output alone, with no additional arithmetic beyond formatting.
- **A before/after of the intra-month honesty decision**: the same P1 row evaluated at day 1, day 7 and day 8 of the same April, showing `projected: null, null, 1331.25` and the `status` transition `'too-early' → 'too-early' → 'projected'`, plus the projection each day *would* have produced without the floor (`10650`, `1521.43`, `1331.25`). The spread between the first and the last is the argument for the floor, stated as numbers.
- A table of every fixture P1–P16 with its inputs and its full `CategoryPace` record, so this spec's arithmetic can be checked against the tests' arithmetic without running either.
- The full verbose listing of `lib/domain/pacing.test.ts`, and the full verbose listing of `lib/domain/adherence.test.ts` showing all 47 names present verbatim.
- Commands #30, #31 and #34 run with their output pasted, confirming: `adherence.ts` changed only where the two `export` keywords and their comments are, `adherence.test.ts` did not change at all, and nothing outside `lib/domain/` and `plan/` was modified.
- A one-paragraph statement, in `EVIDENCE.md`, of the **intra-month uniformity assumption** in the implementer's own words, naming a category in the demo data for which it is false and the day of the month at which the projection for that category would first be trustworthy. This is the assumption the whole task rests on and it must be shown to have been understood, not merely coded around.

## Failure modes to test

- **The floor omitted**, so day 1 of a 30-day month multiplies a single dinner by 30 and the app announces a $10,650 April. This is the N11 shape — a plausible number pointing confidently the wrong way — with a 30× amplifier attached, and it is the single most likely thing to ship.
- **The floor written as `>` instead of `>=`**, silently withholding the projection for the whole of a 28-day February's day 7 and for no other input in the suite.
- **`daysInMonth` hardcoded to 30, or to 31, or February hardcoded to 28.** A 30-day assumption is off by 3.3% in January and 7% in February; the leap case is off once every four years and wrong in 2100 for anyone using `year % 4`.
- **`new Date(year, month + 1, 0).getDate()` used for month length** — arithmetically right, timezone-fragile, and a clock read inside a module that forbids one.
- **The as-of day treated as 0-based**, or `(day − 1) / daysInMonth` used, which divides day 1's spend by zero and produces `Infinity` for the one input the floor is not there to catch.
- **Elapsed fraction taken month-granularly**, inheriting `app/dashboard/page.tsx:356`'s `getMonth() + 1` convention, which treats the current month as fully elapsed and so silently reports every projection as equal to spend-to-date — the exact figure §5 says is not enough.
- **Division by zero at `elapsedFraction === 0`** on a future month: `Infinity` for nonzero spend, `NaN` for zero spend, both rendering as a plausible-looking blank or a wild number depending on the formatter.
- **A month with `budgeted === 0` producing `Infinity` or `NaN` for a ratio** rather than `null`, which is exactly what `monthPct` does and exactly what `MonthVariance.ratio` was written to avoid.
- **Off-cycle collapsed into the ordinary zero-budget breach**, losing §5's constraint 3 entirely, or off-cycle emitted *with* a percentage, which is the same loss in a different dress.
- **`'no-budget'` reported as `'off-cycle'`**, so a category nobody has budgeted reads as a scheduling breach every month of the year — the fastest way to teach an owner to ignore the status.
- **A past month projected using the current month's elapsed fraction**, inflating every finished month by `1/elapsedFraction` and making the whole year read as a catastrophe every April.
- **The sign inverted or stripped** — `budgeted − projected`, or `Math.abs`, or `1 − projected/budgeted`. Each produces a plausible dollar figure and the only symptom is that thrift reads as overspending. This is the failure that already shipped once in this module family.
- **`projectedRatio` reported as "percent over" rather than "fraction of budget"**, or vice versa, so `2.6625` and `1.6625` become interchangeable in a renderer's hands.
- **Rounding once at the end**, or rounding `projectedVariance` from raw floats instead of from the already-rounded `projected`, which drifts from a statement by cents.
- **Ratios cent-rounded**, quantizing a percentage into 1% steps — a category error dressed as consistency.
- **Negative zero** on `actual`, `projected`, `spentRatio` or `projectedRatio`, printing "-0.0%" for a category that spent nothing. Reachable from `actual: -0.001`, which a caller's `SUM` can produce.
- **A sixth even-spread implementation** inside `pacing.ts`, or `budgetedForMonth` re-typed with the `roundCents` dropped, which diverges from `adherence.ts` at the 5th decimal and from `BudgetMonthlyGrid.tsx` at four cents — three answers to one question.
- **`isScoredCategory` used as the range gate** instead of `isTrackedCategory`, dropping every `fixed` and `variable-necessary` category — plausible precisely because `scoredHeadline`, two functions away in the imported module, does exactly that.
- **A missing landscape/exclusion gate**, admitting a `capital`, `exclude_from_budget` or `is_income` row into the output.
- **Twelve months assumed**, or the supplied months re-ordered, or duplicated months silently doubling a record (N18 inherited).
- **An out-of-range `MonthSpend.month` resolved by substitution rather than rejection**, reproducing N15's confirmed probe — a December-only category reading as a $1,050 breach at 1150% — inside a projection.
- **`detectAdherence` perturbed while adding the two `export` keywords**, or a shared helper refactored on the way past. The 47 tests and command #34's byte-identical requirement are the tripwire.
- **Scope creep into `app/dashboard/page.tsx`**, which §5's "extends the existing pace math on the This Year card" actively invites and which is step 31's diff, not this one's.
- **Empty and degenerate collections**: `rows: []`; every row untracked; a tracked row with `months: []`; a row whose every supplied month budgets $0. Each must land on a stated answer — `[]` or a real record with `null` ratios — never on `NaN`, `Infinity`, `-0`, or an accidental `0`.
- **Inherited and explicitly not fixed here, restated so step 31 does not rediscover them**: N15 (out-of-range month in `detectAdherence`), N18 (duplicate months), N19 (four incumbent even-spread implementations), N20 (`NUMERIC` columns arriving as strings), N21 (negative budgets emitted as real dollar figures), N26 (a duplicated category row inflating everything), N29 (non-finite `annual_budget` producing `NaN` money with a benign-looking `null` ratio). Every one of them is amplified by a projection multiplier, and none is this step's to close.

## Rollback

Pure module change: no migration, no schema, no data, no persisted state, no route, no outbound surface. Revert is `git revert` of this task's commit(s), which deletes `lib/domain/pacing.ts` and `lib/domain/pacing.test.ts` and restores the two `export` keywords in `lib/domain/adherence.ts` to their private form along with their original comments. `categoryPacing`, `CategoryPace`, `AsOf`, `PaceStatus` and `daysInMonth` have no importer anywhere in the repo on delivery (step 31 writes the first), and `budgetedForMonth` / `withoutNegativeZero` have no importer outside `pacing.ts`, so a revert cannot break a consumer. `lib/domain/adherence.test.ts` is byte-identical before and after, so nothing in the existing 47 tests is disturbed in either direction. No CSV backup applies; no data was written.
