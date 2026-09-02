# Roadmap item — P0.5-29a-headline-scope

**Lineage:** addendum to ROADMAP.md §5 Phase 0.5 step 29, authored by the orchestrator after
P0.5-29 merged. Not in §5 as written — the same shape as `P0-09a`, which was an addendum to step 9.

**Why now and not in step 29.** `NITS.md` N11 was found by the adversarial reviewer at P0.5-29's G3
and confirmed by execution at G4. It was correctly **not** a gate failure: P0.5-29's frozen spec
constrained the aggregate only in its `null` case and said nothing about its arithmetic, so the
implementation satisfied the spec. The spec was incomplete, not the code wrong against it. The owner
asked for the fix before step 30 or 31 picks the module up.

## The defect, as measured

`scoredHeadline` ranges over **findings**. One scored category budgeted $100/month spending $110 in
January and $90 in each of the other eleven months has spent **$1,100 against $1,199.88 — 8.3%
under**. Measured output at P0.5-29's G4:

```
{"findingCount":1,"breachCount":1,"defectCount":0,"budgeted":100,"actual":110,"variance":10,"varianceRatio":0.1}
```

**A headline of +10% over, for a category that is 8.3% under.** Two causes compound:

1. **Wrong domain.** Ranging over findings makes the eleven compliant months invisible. Only January
   produced a finding, so only January is in the sum.
2. **Mixed scales.** A `BreachFinding.budgeted` is *one month's* budget; a
   `ChronicUnderspendFinding.budgeted` is a *whole window's*. `sumCents` adds them into one
   denominator, and `findingCount` is incommensurable the same way — six breach months count six, a
   twelve-month defect counts one.

This is the failure class this phase exists to end. A dashboard is not wrong here because a number is
missing; it is wrong because a confident number points the opposite direction from the truth.

## Required outcome

1. The headline describes the **actual position of the scored categories** — every month of their
   supplied input, not only the months that produced findings. On the fixture above it must read
   ≈ **8.3% under**, not 10% over.
2. No aggregate ever sums a month-scale magnitude with a window-scale one.
3. **N12 comes with it.** Today `scoredHeadline` returns `null` both for "there is nothing to score"
   *and* for "every scored category adhered perfectly" — the module's own docstring says these are
   different statements and the signature cannot tell them apart, because it takes findings. Ranging
   over categories makes the distinction expressible: nothing to score stays `null`; perfect
   adherence becomes a real figure at variance 0. Fixing N11 without fixing N12 would leave a
   dashboard rendering "—" for a flawless month.
4. `isScoredCategory` and `detectAdherence` keep their current observable behaviour. P0.5-29's 34
   tests stay green except where a test pins the old headline arithmetic, and any such change is
   called out explicitly rather than absorbed.

## Open questions for the spec — flagged, not decided here

- **What does the function take?** It cannot compute a true position from `AdherenceFinding[]`.
  Whether it takes `AdherenceInput[]`, takes both rows and findings, or is replaced by something
  `detectAdherence` returns alongside the findings, is a spec decision with a caller-facing
  consequence — step 31 writes the first real caller.
- **Do the counts stay finding-scoped?** `breachCount`/`defectCount` are meaningful as finding
  counts. If `budgeted`/`actual` become category-scoped while the counts stay finding-scoped, one
  struct carries two domains and must say so, or they diverge silently the way this defect did.
- **What is `varianceRatio` when scored categories exist but budgeted $0 in total?** Currently
  `null`. Under the new ranging that case is rarer but still reachable.
- **N19 is adjacent and out of scope unless the spec says otherwise.** This module's even spread
  rounds per month (`$999.96` for a `$1,000` annual budget); `BudgetMonthlyGrid`'s does not
  (`$1,000.00`). A headline quoting a percentage inherits that four-cent divergence.

## Contracts touched

**Expected: none.** Pure module change inside `lib/domain/adherence.ts`, the same surface P0.5-29
occupied. G1 skips unless the spec finds otherwise.
