# Roadmap item — P0.5-32-coverage-bound

**Lineage:** ROADMAP.md §5 Phase 0.5, step 32 — verbatim in §5. Orchestrator's reading, not a second
definition.

**Position.** Steps 28–31 are merged and the dashboard now opens on the budget question. Step 32 is
the step that decides **how much that answer can be trusted**, and it is the last one before the
delivery channel (33) starts sending it somewhere.

## The item

> An adherence number is only as true as the categorization under it: 40 uncategorized transactions
> mean a category's actual is understated and the headline figure is confidently wrong in the middle
> while looking fine at the edges. `/budget` already counts uncategorized per landscape; that count
> is promoted from a nuisance to a **stated confidence bound on the adherence figure** ("computed
> over 96% of operational spend"), and **the figure refuses to render as authoritative below a
> threshold**.

*Exit (§5): the headline number always ships with **the share of spend it actually saw**.*

## What step 31 deliberately left for this step

`CategorizationCoverage` exists and is already a **required** third parameter of `monthOutlook` —
enforced at the type level so a caller cannot compute an outlook without stating what it was
computed over. But it is deliberately only:

```ts
export interface CategorizationCoverage {
  uncategorizedCount: number;
  categorizedCount: number;
}
```

**A count, not a share of spend**, rendered unconditionally with no threshold and no refusal. Step 31's
spec named both the share and the threshold as explicit non-goals, so this step owns them. §5's exit
says *share of spend* — dollars, not transactions — and the two differ most exactly when it matters:
one uncategorized $4,000 transfer against forty categorized $12 coffees is 97.6% by count and a
rounding error away from useless by dollars.

## Four inherited findings that are this step's, not follow-ups

From `plan/tasks/P0.5-31-dashboard-repoint/NITS.md`:

- **N41 — the caveat counts a strictly wider set than the figures it caveats.** `getCoverage` counts
  *every* transaction in the month on a tracked operational account: income, `Transfers`
  (`exclude_from_budget = TRUE`), `fixed`, `variable-necessary`, and rows mapped to capital
  categories. The hero ranges over `isScoredCategory` — four conjuncts, nine of twenty-one on the
  owner's data. **A percentage computed from today's numerator and denominator would be a confident
  number over the wrong set**, which is the defect class this phase exists to end.
- **N42 — coverage and actuals are scoped by two different `landscape` columns.** `getCoverage`
  filters `a.landscape` (the **account**); `getMonthlyActuals` has no landscape predicate and the
  gate is applied later on `bc.landscape` (the **category**). Different columns, different tables,
  and the sets are not nested either way. A vacation paid from a capital savings account and mapped
  to `Travel` moves the hero and is absent from the caveat.
- **N43 — an orphaned `mapped_category` is invisible in the outlook *and* counted as categorized.**
  `transactions.mapped_category` is not a foreign key, and renaming a category does not remap its
  transactions. The spend disappears from the category's `actual` **and** inflates the coverage
  figure — confidence rises exactly as truth falls. Measured on the owner's database today: `0`
  orphans, so this is latent rather than live.
- **N40 — the hero's copy is unconditionally reassuring** when part of the scored set has no budget.
  The reviewer assigned it here because this step owns the refusal mechanic.

## Open questions for the spec — flagged, not decided

- **Share of *what*, exactly?** This is the hard one and the whole step turns on it. The denominator
  cannot be "spend in the scored set", because the uncategorized transactions are precisely the ones
  whose category is unknown — that is what makes them uncategorized. So the denominator must be a
  set that is knowable *without* the answer: probably operational spend in the month by some
  account- or sign-based predicate. Whatever is chosen, **N41 and N42 mean the current numerator and
  denominator are drawn from different populations**, and the spec must state one population and
  apply it to both.
- **Dollars or transactions, and what about sign?** §5 says share of *spend*. Refunds, transfers and
  income all have amounts; `MonthSpend.actual` is contractually non-negative and the page already
  filters `t.amount > 0`. A share of spend that silently includes a $9,000 inbound payroll row is
  not a share of spend.
- **What is the threshold, and what does "refuses to render as authoritative" mean?** A number needs
  choosing and justifying — an arbitrary 95% is exactly the kind of unexamined constant this repo
  keeps finding. And the refusal has a structural cost: `monthOutlook`'s state ladder is **closed at
  seven** ("there is no eighth"), totally ordered, with every adjacent pair separately mutation-gated
  and 24 tests pinning it. An eighth state is a real change to a tripwire; a non-state mechanism
  (a flag beside the state, a wrapper) may be better. The spec decides and justifies.
- **Does the refusal suppress the number, or qualify it?** "Refuses to render as authoritative" is
  not obviously "renders nothing". A suppressed figure and a caveated figure are different products,
  and the phase's own thesis — a confident number pointing the wrong way is worse than no number —
  argues one way while "the headline always ships with the share it saw" argues the other.
- **Which landscape column is correct** for both queries (N42), and **should coverage detect orphans**
  (N43) rather than counting them as categorized?
- **§5's second-order note.** *"Pacing is only useful if a transaction is categorized within a day or
  two of landing, which puts pressure on `category_rules` coverage and sync cadence."* Read here as
  **naming a consequence, not commissioning work** — rules coverage and sync cadence are their own
  changes. The spec should say so explicitly rather than leave the sentence to be read as scope.

## Contracts touched

**Expected: none.** Every column exists. If the spec finds otherwise, G1 re-opens and the lease is
taken before the guardian is dispatched.

## Non-goals

- **No delivery.** Step 33 owns the outbound channel and its allowlist.
- **No new adherence or pacing arithmetic.** `lib/domain/adherence.ts` and `pacing.ts` are read-only
  inputs; their 71 tests are the tripwire.
- **No `control_mode` write path.** Real and missing (N51), but it is not this step and should not be
  smuggled in.

## Two spec-authoring lessons from step 31, owed to this spec

1. **Verify every fixture's arithmetic by execution at spec time.** Step 31's Fixture H9 was
   arithmetically impossible — its own inputs could not produce its own expected state — and it
   reached a frozen spec. G2 adjudication A3.
2. **Never pin an exact `grep -c` for "this symbol appears".** An ordinary import-plus-call is two
   occurrences; step 31's #52 expected `1` and forced a code shape to satisfy a counter. Use
   `-ge 1`. G2 adjudication A4.
