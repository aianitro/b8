# Roadmap item — P0.5-30-in-month-pacing

**Lineage:** ROADMAP.md §5 Phase 0.5 (the budget turn), step 30 — verbatim in §5. This file records
the orchestrator's reading of it, not a second definition of it. §5 calls it *"the mechanic the whole
phase exists for."*

**Position in the phase.** Steps 28 and 29 (+29a) are merged and are the definitional half: the app
can name the set it scores (`isScoredCategory`, four conjuncts) and can tell overspend from chronic
underspend (`detectAdherence`), with a headline that measures the categories it names. **All of it is
retrospective.** Step 30 is the first step whose output could change a decision before the money is
spent. Step 31 renders it; this step does not.

## The item

A retrospective score tells you the month is already lost. The intervention has to land while the
money is still unspent:

> *day 8 of 30, Dining is at 71% of its month, projected to close 187% over*

§5 states three constraints on it:

1. It **extends the existing pace math** on the dashboard's This Year card (`app/dashboard/page.tsx`
   — `expectedYearSpend`, `yearPacePct`, `paceColor`, the Year Pace bar) **down to the per-category
   month**. That math is currently inline in a page component and computes a whole-year figure.
2. It **reuses `monthly_amounts`** — the schedule already models a category that only spends in
   March — so pacing must be **schedule-aware and not a naive days-elapsed line**.
3. **Off-cycle spend is a breach in its own right, not a percentage.** (`monthPct`'s `offCycle`,
   `lib/budgetColors.ts`.)

*Exit (§5): every discretionary category reports projected month-end position, not just
spend-to-date.*

## What is already true, and must not be re-solved

- `budgetedForMonth` already resolves a month's budget from `monthly_amounts` when present and the
  even spread of `annual_budget` when not. Constraint 2's "schedule-aware" is **already discharged
  at the month-selection level** by that function.
- `detectAdherence` already emits a breach for a month with `budgeted === 0` and nonzero spend,
  without computing a ratio — see the test *"a month with zero budgeted amount and nonzero spend
  produces a breach finding without computing a spend-to-budget ratio"*. **Whether that already
  satisfies constraint 3, or whether off-cycle needs a distinct finding kind, is a question for the
  spec, not a decision here.** `monthPct` answers `Infinity`; this module deliberately answers
  `null`; §5 asks for "a breach in its own right".
- `MonthVariance` carries `budgeted`/`actual`/`variance`/`ratio` per month with the sign convention
  fixed (`actual − budgeted`, negative is under). Pacing must not invent a second one.

## Open questions for the spec — flagged, not decided here

- **Where does "today" enter, and how does it stay testable?** This is the central tension and the
  reason this step is harder than it looks. `lib/domain/adherence.ts` is deliberately clock-free:
  P0.5-29a acceptance #19 *statically forbids* `new Date(` / `Date.now(` in the module, and the
  whole suite is deterministic pure functions by `vitest.config.mts`'s own statement. Pacing is
  inherently "as of a moment". The as-of point must therefore be a **parameter**, but its shape is a
  spec decision with a caller-facing consequence: an as-of date, or an explicit
  (day-elapsed, days-in-month) pair, or a fraction. Whichever is chosen, the clock read moves to the
  caller and step 31 owns it.
- **What does "projected" actually assume?** The obvious projection is linear:
  `spend-to-date ÷ elapsed-fraction`. That assumes spend is **uniform within the month**, which is
  false for exactly the categories the schedule was built to model — and note that `monthly_amounts`
  gives a per-*month* amount, so it says nothing about the within-month curve. **§5's
  "schedule-aware, not a naive days-elapsed line" is satisfied at month granularity but not within
  the month.** The spec must state the intra-month assumption out loud and decide whether a
  projection carrying it is honest enough to render, or whether it needs a confidence qualifier. A
  projection that is confidently wrong in the first week is the N11 shape again.
- **Does it live in `adherence.ts` or a new module?** P0.5-29a's precedent is that one module owns
  the definition of adherence. Pacing shares `budgetedForMonth`, the scored set, and the sign
  convention; splitting it risks the second-reducer defect this repo has shipped twice. Against
  that, `adherence.ts` is already ~490 lines and pacing introduces a genuinely new input (the as-of
  point) that the rest of the module does not take.
- **Which categories?** The scored set (`isScoredCategory`) is the natural range, matching the
  headline. §5's exit says "every discretionary category". Whether tracked-but-unscored categories
  also get a projection — useful for a `variable-necessary` utility, meaningless for a `fixed`
  mortgage — is a spec decision.
- **A month that is not the current month.** The as-of point can fall before, inside, or after the
  month being measured. A past month is finished (projection = actual); a future month has no
  elapsed fraction. Both must land on a stated answer rather than a division by zero.
- **Partial categorization is out of scope and must be flagged as inherited.** Step 32 makes the
  uncategorized count a stated confidence bound. Until then a projection is computed over whatever
  share of spend happens to be categorized, and the error compounds with the projection multiplier —
  early in the month, a single uncategorized transaction moves the projected close far more than it
  moves spend-to-date. Not this step's to fix; this step's to *not* claim otherwise.

## Contracts touched

**Expected: none.** `monthly_amounts`, `annual_budget`, `control_mode` and the landscape/exclusion
flags all exist. A pure module change plus tests, in the shape of steps 29/29a. G1 skips unless the
spec finds otherwise.

## Non-goals, stated here because §5 splits them across steps

- **No UI, no dashboard, no route.** Step 31 re-points the dashboard and is the first renderer.
- **No delivery.** Step 33 owns that, and with it the app's first outbound surface and its allowlist.
- **No change to `isScoredCategory`, `detectAdherence`, or `scoredHeadline`'s observable behaviour.**
  P0.5-29a's 47 tests are the tripwire.
