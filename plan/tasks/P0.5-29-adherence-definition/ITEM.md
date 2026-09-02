# Roadmap item — P0.5-29-adherence-definition

**Lineage:** ROADMAP.md §5 Phase 0.5 (the budget turn), step 29. Verbatim in §5; this file is the
orchestrator's reading of it, not a second definition.

**Depends on P0.5-28.** Step 29 computes over `control_mode`, which exists only on the
`p0.5-28/category-control-mode` branch — G4-passed but **not merged**. This task is therefore
branched off P0.5-28 rather than off `main`. If P0.5-28 merges first, this branch rebases onto it;
if it is revised, this one follows. Recorded because a reviewer seeing `control_mode` here should
know where it came from.

## The item

> "How accurately is the budget followed" is not "did I stay under."

A category budgeted $500 that draws $120 every month is a **wrong budget**, not good behaviour. A
metric that rewards it teaches the owner to set absurd limits and score perfectly against them —
the metric-gaming failure, and §5 notes it is reachable in one step.

Adherence is a **two-sided variance** against `monthly_amounts` (or the even spread of
`annual_budget` when NULL — the existing convention), with a deliberate asymmetry stated **in the
domain module** rather than implied by a chart colour:

- **Overspend is a breach.**
- **Chronic underspend is a budget defect** — routed to a "these limits are fiction" review, not
  rendered as a green cell.

Pure module (`lib/domain/adherence.ts` — the file P0.5-28 created), tested, in the shape of
`drift.ts` and `propertyPnl.ts`. Size (M).

## Exit criterion (§5, verbatim)

> Two categories, one over and one chronically under, produce distinguishable findings that a
> colour-threshold snapshot cannot express today.

**The incumbent this must beat is real and specific.** `lib/budgetColors.ts` already grades a month:
`expenseCellStyle` returns green under 100%, amber 100–110%, red above 110%. A category at 24% of
its budget every month for a year renders **green** in every cell. That is the snapshot the exit
criterion says cannot express the finding — the new module must produce something it structurally
cannot, not merely a different shade.

## What the orchestrator found before dispatch — facts for the spec, not decisions

1. **The even-spread rule already exists in three separate implementations**, and a fourth as prose:
   `app/api/chat/route.ts:66` (`ROUND(bc.annual_budget / 12, 2)`), `app/budget/page.tsx:25`
   (identical SQL), `components/BudgetMonthlyGridClient.tsx:29` (`row.annual_budget / 12` for the
   label), plus `app/api/chat/route.ts:183` stating the pacing rule in the LLM system prompt.
   This is the drifting-definitions hazard BUILD.md §1 names, already live. Whether step 29's module
   becomes the single owner of that rule — and whether migrating the existing three is in scope or a
   follow-up — is a spec decision with a real blast radius.
2. **`offCycle` is derived inline**, not in a module: `BudgetMonthlyGridClient.tsx:97` —
   `hasSchedule && monthBudget === 0 && amount !== 0`. §5 step 30 makes off-cycle spend "a breach in
   its own right." Step 30's problem, but step 29 should not contradict the existing derivation.
3. **`monthPct` returns `Infinity` for off-cycle** (`lib/budgetColors.ts:9`). Any variance arithmetic
   that reuses it inherits a non-finite value.
4. **The scored set is 9 categories** — `isScoredCategory` from P0.5-28. Step 29 must state whether
   its findings range over the scored set only, or over all operational categories with only the
   *headline* restricted.

## Open questions for the spec — flagged, not decided here

- **What makes underspend "chronic"?** §5 says "$500 budgeted, $120 drawn, every month" but names no
  threshold or window. A single quiet month is not a fiction; twelve are. The definition needs a
  stated window and magnitude, and a negative control proving one lean month is *not* reported.
- **What does a two-sided variance range over — a month, or a year?** The exit criterion says "two
  categories, one over and one chronically under," and "chronic" implies multiple periods. Whether
  a finding is per-category-per-month or per-category-over-a-window changes the shape entirely.
- **`variable-necessary` and `fixed` are unscored — are they unmeasured?** P0.5-28 decided they are
  "tracked and reported, never scored." A budget defect on a `fixed` category (a mortgage budgeted
  $2,000 that draws $1,400) is still a wrong budget. Whether the defect detector ranges wider than
  the breach detector must be stated. §5's own text — "the rest are tracked and reported" — suggests
  it does, and P0.5-28's frozen spec did not settle it.
- **N8 and N7 from P0.5-28 are inputs to this spec, not discoveries.** N8: "under-inclusion is
  silent but harmless" is directionally indeterminate — `One time` is seeded `fixed`, so an elective
  purchase booked there is invisible to the headline. N7: `scripts/seed-demo.mjs` produces an empty
  scored set, so the headline divides by zero in demo mode.

## Contracts touched

**Expected: none.** §5 specifies a pure module over data that already exists; `control_mode` landed
in P0.5-28 and `monthly_amounts` predates both. If the spec-writer finds a contract change is
genuinely required, that is a finding worth surfacing rather than absorbing — G1 is skipped only
when the contract surface is untouched.
