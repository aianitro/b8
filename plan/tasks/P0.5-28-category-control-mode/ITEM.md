# Roadmap item — P0.5-28-category-control-mode

**Lineage:** ROADMAP.md §5 Phase 0.5 (the budget turn: adherence becomes the product), step 28
— the phase's first step, added 2026-09-01. Verbatim in §5; this file records the orchestrator's
reading of it, not a second definition of it.

**Why this and not `P1-10-zod-contracts`.** `plan/QUEUE.md` listed step 10 as next, and that entry
predates the Phase 0.5 amendment landed in `ROADMAP.md` on 2026-09-01. §5 is the single definition
of order (QUEUE.md's own preamble says so), and the phase closes with a rule that settles it
without interpretation: *"This phase is added ahead of Phase 1, not alongside it. If it is
underway, Phase 1 has not started."* The queue was stale, not ambiguous.

## The item

An adherence figure averaged over every budget category is diluted by design. A mortgage payment
and a restaurant dinner are both budget lines and only one of them is a decision. A metric that
mixes them moves when nothing behavioural happened, which makes it unactionable — and, worse,
looks fine while doing it.

Step 28 is the classification that the rest of the phase computes over. It ships no metric. Steps
29–30 (adherence math, pacing) are the consumers, and neither can be defined honestly until the
set they range over can be named.

## Required outcome

1. `budget_categories` carries a control dimension. §5 offers two shapes and prefers the second:
   a boolean `is_discretionary`, or a three-way `control_mode` of `fixed` / `discretionary` /
   `variable-necessary`. The roadmap's own argument for three is that utilities are *"neither a
   free choice nor a fixed debit"* — a boolean has nowhere to put them.
2. **Landscape scope is `operational` only.** The capital landscape is savings and investment
   movement, not spending discipline; it is out of scope for classification and for every
   downstream adherence number.
3. Every operational category carries a classification — no silent NULL that a later `AVG` reads
   as a fourth, unnamed mode.
4. The set the headline number will be computed over can be named out loud.

## Exit criterion (§5, verbatim)

> Every operational category carries a control classification, and the set the headline number is
> computed over can be named out loud.

## Open questions for the spec — flagged, not decided here

- **Backfill.** Existing rows need a value. A blanket default of `discretionary` would silently
  classify the mortgage as a decision, which is the exact dilution this step exists to remove.
  Whether the migration ships a seed classification per existing category, or the column is
  nullable-with-a-UI-queue, is a spec decision with a real correctness consequence.
- **`is_income` and `exclude_from_budget` interaction.** Income categories and excluded rows are
  presumably unscored. Whether they are `fixed`, a fourth mode, or simply out of the ranged set
  must be stated, because §5's exit criterion demands the set be nameable.
- **`monthly_amounts` is untouched here.** Schedule-awareness belongs to step 30's pacing math.

## Contracts touched

`shared/types.ts` · `migrations/**` · `db/schema.sql` — the same surface as P0-09a. G1 applies;
the contract lease opens before the guardian is dispatched.
