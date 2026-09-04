# NITS — P0.5-32-coverage-bound
<!-- Findings real enough to record, not severe enough to block a gate. Each names who owns it. -->

Raised by adversarial-reviewer at G3 (REVIEW-1). Verdict `BLOCK` — the blocking finding is in
`REVIEW-1` and is **not** repeated here. Everything below is real, reproducible by reading, and not
sufficient on its own to hold the merge.

Numbering continues the queue-wide sequence and starts at **N52**.

---

## N52 — the caveat names its denominator "this month's spend" when known-unscored spend is in neither half
**File:** `app/dashboard/page.tsx:776` (`Computed over {outlook.coveragePercent}% of this month's spend`)
**Owner:** the same copy fix as the blocking finding in REVIEW-1; do both in one edit.

`coverageShare = scoredSpend / (scoredSpend + unattributedSpend)`. Known-unscored spend — `fixed`,
`variable-necessary`, income, `Transfers`, every capital category — is in neither half by design
(SPEC Q1.3, and correctly implemented). So the denominator is **not** this month's spend; it is the
subset of this month's spend that either was scored or could not be classified.

**Failure scenario.** A month to date holding $2,200 `Mortgage` (`fixed`), $600 `Groceries`
(`variable-necessary`) and $200 `Dining Out` (scored), with nothing unattributed. The hero renders:

> Computed over **100%** of this month's spend — $200.00 the scored categories account for, against
> $0.00 across 0 transactions they could not. Spend in categories this hero never scores is in
> neither figure.

The headline figure — the one the eye takes — says 100% of the month's spend. The share of the
month's actual $3,000 that the hero saw is **6.7%**. The third sentence does disclose the exclusion,
which is why this is a nit and not the block: the claim is recoverable by a careful reader, two
sentences later, after the number has already been read.

The share itself is right and the population is right. What is wrong is the noun. "Computed over
100% of the spend this hero can rule on" (or similar) states the same fraction truthfully.

---

## N53 — `Math.floor` over a float-summed share turns an exact integer percentage into the one below it
**File:** `lib/domain/monthOutlook.ts:465,477` (`scoredSpend / population`, `Math.floor(share * 100)`)
**Owner:** a follow-up on this module. Do **not** fix by reintroducing `Math.round` (#35).

SPEC's "Accepted imprecision" paragraph reasons about drift only at the `>=` comparison, and its
boundary fixtures (C1, C2) use integer-dollar group totals that are binary-exact. Real group totals
are cent-quantized doubles summed across several groups, and that sum is not exact.

**Failure scenario, reproduced by execution.** Six scored groups — $170.39, $51.01, $181.04,
$202.05, $0.98, $446.56 (`scoredSpend` = $1,052.03) — and two unattributed groups — $18.74, $36.63
(`unattributedSpend` = $55.37). The exact decimal ratio is **exactly 0.95** (1052.03 × 20 =
1107.40 × 19). In IEEE-754 the division yields `0.9499999999999998`, so:

- `authoritative` is `false` — the month is refused at exactly the threshold the spec declares a
  closed floor;
- `coveragePercent` is `Math.floor(94.99999999999998)` = **94** — the page prints 94% for a month
  that is 95.000000%.

Measured incidence: over 300,000 randomly generated exact-19:1 cent splits, `share < 0.95` in 543
(~0.18%); the remainder land exactly on or just above. The same mechanism applies at **every**
integer percentage, not just 95 — `Math.floor` converts a 2e-16 error into a full displayed point
whenever the true share is exactly `k/100`.

Both directions of the error are conservative (understated coverage, withheld authority), which is
why this is a nit. The durable fix is to compute the percent from integer cents, or to floor a
share nudged by one ulp, rather than to round.

---

## N54 — `assertCoverage` validates the six magnitudes and none of the three derived fields
**File:** `lib/domain/monthOutlook.ts:499-528`
**Owner:** a follow-up on this module.

The docblock states the reason the guard exists: *"`monthOutlook` takes coverage as data, not as
this module's own output — the page could hand it a hand-built object, and a future caller certainly
will."* It then checks `scoredSpend`, `scoredCount`, `unattributedSpend`, `unattributedCount`,
`orphanedSpend`, `orphanedCount` and the two subset relations — and does not check the three fields
the whole step exists to add.

**Failure scenario.** A future caller (or a fixture, or a cached record) hands
`{ scoredSpend: 100, unattributedSpend: 900, …, coverageShare: 0.99, coveragePercent: 99,
authoritative: true }`. `monthOutlook` copies all three by reference, `outlook.authoritative` is
`true`, the hero renders in emerald with no refusal region, and the caveat prints "99% of this
month's spend — $100.00 … against $900.00". The struct is self-contradictory and nothing objects.

Three lines close it, in the same style as the existing subset checks: `coverageShare` must equal
`scoredSpend / (scoredSpend + unattributedSpend)` (or be `null` exactly when that denominator is 0),
`coveragePercent` must equal `Math.floor(share * 100)` — note this would need the floor expressed
without `Math.floor` if #35's ban is read as covering it — and `authoritative` must equal
`share !== null && share >= COVERAGE_THRESHOLD`.

SPEC's "Internal consistency" convention names only the six figures, so the implementation is
spec-conformant. The gap is in the spec.

---

## N55 — `COVERAGE_THRESHOLD` cannot be moved by evidence without editing the suite, contradicting SPEC §Rollback
**File:** `lib/domain/monthOutlook.ts:74`; `lib/domain/monthOutlook.test.ts:742` and the two boundary fixtures
**Owner:** whoever first has evidence to move the constant.

SPEC §Rollback: *"If the threshold turns out to refuse authority permanently on the owner's data,
**the rollback is not a revert** — it is a change to the single named `COVERAGE_THRESHOLD`
constant, which is exactly why it is named and exported."* That rollback does not work as written.
Setting `COVERAGE_THRESHOLD = 0.90` leaves the suite red in at least four places:

- `monthOutlook.test.ts:742` — `expect(coverage.coverageShare).toBe(COVERAGE_THRESHOLD)` fails
  (`0.95 !== 0.90`);
- the `BELOW_THRESHOLD` fixture (`0.9495`) asserts `authoritative === false`, which becomes `true`;
- both `monthOutlook with a bound on its coverage` fixtures assert `authoritative: false` on that
  same coverage;
- acceptance row #20 pins the literal `= 0.95;`.

The tripwire is defensible — a policy constant should not move silently. The nit is that the spec
promises a one-line rollback and the suite does not permit one, so a future owner acting on the
rollback instruction will hit four red tests and have no written guidance on which are the pin and
which are the fixture.

---

## N56 — the source assertion's landscape guard is scoped to `WHERE`, and the predicate is expressible in the `JOIN`
**File:** `lib/domain/monthOutlook.test.ts:1043,1055`
**Owner:** a follow-up on the same test.

```ts
const where = sql.slice(sql.indexOf('WHERE'), sql.indexOf('GROUP BY'));
…
expect(where).not.toContain('a.landscape');
```

N42 returning through the join condition is not caught:

```sql
JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
                                       AND a.landscape = 'operational'
```

That predicate sits **before** `WHERE`, so `where` never sees it. It has exactly the effect N42
describes — the $2,000 vacation on `demo_sav_capex` mapped to operational `Travel` moves the hero
and leaves the caveat — and the suite stays at 39 passed. Acceptance #29 would catch it, but #29 is
a one-shot gate on this diff, not a regression gate that survives into later steps; the test is.

Same slice, second hole: `expect(where).toContain('t.amount > 0')` gates the string, not the
polarity — `AND NOT (t.amount > 0)` satisfies it. Contrived, but it is the honest boundary of what a
source assertion buys, and G2's A4 accepted it as text-gating rather than behaviour-gating.

Widening the two assertions from `where` to the whole `sql` (for the absence) and asserting the
full predicate line (for the presence) costs nothing. The durable fix is the one G2 already named
and deferred: have `getCoverageGroups` return rows and let the domain aggregate, so the sign and
landscape rules become `assertGroup`'s contract and are fixture-reachable.

---

## N57 — the demotion is invisible in four of the seven states
**File:** `app/dashboard/page.tsx:576-580` (`heroCopy`)
**Owner:** a rendering follow-up, with the render harness N-series (O3).

`heroCopy` demotes by replacing `tone` with `text-slate-300` and `pill` with
`bg-slate-800 text-slate-400`. For `nothing-to-score`, `too-early` and `no-budget-basis`,
`STATE_COPY`'s tone is **already** `text-slate-300` and its pill is `bg-slate-800 text-slate-300`.
So in three of the seven states the demotion changes nothing but one shade of the pill's text, and
in a fourth (`projected-breach`) it removes an amber that was itself a hedge.

The refusal region is then the only signal, which is exactly the arrangement Q4 was trying to avoid
(*"the refusal rendered but the state's confident tone left intact"*). The demotion is real and
correct where it matters most — emerald `on-track` and red `breach` — and this is a nit rather than
a finding for that reason. It is also the reason EVIDENCE §6.4's live render could not distinguish
the two authority modes: it rendered `too-early`, one of the three states where they are identical.

---

## N58 — `toAdherenceInput` still double-counts a category name defined in both landscapes
**File:** `app/dashboard/page.tsx:228-241` (`actuals.get(c.name)`)
**Owner:** a follow-up on the hero's actuals path. Carried here per G2 adjudication A3.

`budget_categories` is `UNIQUE(name, landscape)` and `getMonthlyActuals` keys its map by
`mapped_category` alone, so a `Travel` defined operational/discretionary **and** capital/fixed reads
the *same* actuals into both rows. The scored row is priced against every `Travel` dollar including
the capital ones, and the capital row produces a `detectAdherence` finding over the same dollars.

Pre-existing, predicted by SPEC Q6, and explicitly **not** present in the new coverage classifier —
`categorizationCoverage` counts the group once (fixture C14). The consequence is that `scoredSpend`
and the hero's own `actual` for such a name now disagree: the bound counts $500 once, the hero
counts it twice. One population was the point of this step; this is the one place the page still
has two.
