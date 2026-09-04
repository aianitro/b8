# P0.5-32-coverage-bound — the headline ships with the share of spend it actually saw, and refuses authority below a threshold
**Roadmap item:** ROADMAP.md §5 Phase 0.5 step 32 — "Close the categorization hole, because it is now load-bearing." Orchestrator's reading: `plan/tasks/P0.5-32-coverage-bound/ITEM.md`
**Status:** DRAFT
**Author:** spec-writer

## Goal

`CategorizationCoverage` stops being two counts over a population nobody scored and becomes **a share of dollars over exactly the population the headline ranges over**. `MonthOutlook` gains three derived, tested fields — `coverageShare` (an unrounded fraction, or `null`), `coveragePercent` (a floored integer, or `null`) and `authoritative` (a boolean) — and `lib/domain/monthOutlook.ts` exports a named `COVERAGE_THRESHOLD` below which the hero **refuses to render as authoritative**: it keeps showing the state and the named lists, and stops presenting them as a verdict.

The population is decided once and applied to both halves of the fraction, which is the whole substance of this step. Today's numerator and denominator come from different sets (N41, N42) and an orphaned mapping raises confidence exactly as truth falls (N43). After this step:

> **The population is:** every transaction in the as-of month to date, on an account with `track_transactions = TRUE`, with `hidden = FALSE` and `amount > 0`. **No account-landscape predicate.** Each transaction is then classified by resolving its `mapped_category` against `budget_categories` **by name**, using the app's single membership test `isScoredCategory`:
>
> | Class | Resolution | Counts toward |
> |---|---|---|
> | **scored** | some `budget_categories` row with that name satisfies `isScoredCategory` | numerator **and** denominator |
> | **known-unscored** | rows with that name exist, none is scored (income, `Transfers`, `fixed`, `variable-necessary`, capital categories) | **neither** |
> | **unattributed** | `mapped_category IS NULL`, **or** no `budget_categories` row carries that name (an *orphan*) | denominator only |
>
> `coverageShare = scoredSpend / (scoredSpend + unattributedSpend)`.

Known-unscored spend leaves both halves because it is spend the headline was never supposed to see — a categorized grocery run neither helps nor hurts the bound. Unattributed spend stays in the denominator because it *might* be discretionary and the headline could not tell: that is precisely what makes it unattributed. The result is a set that is knowable without the answer, and it is the same set on both sides of the division.

The classification is computed by a **pure function in `lib/domain/`**, not in SQL. That is not a style preference: re-expressing the four conjuncts of `isScoredCategory` in a `WHERE` clause is the drifting-definitions hazard (BUILD.md §1) landing on the one predicate P0.5-28 exists to have a single definition of, and it would put the coverage query's copy of the rule beyond the reach of every test in this repo. The page therefore issues **one** aggregation grouped by `mapped_category` (NULL included) and hands the groups plus the category rows it already fetches to the domain.

## Non-goals

- **No delivery, no outbound surface.** Step 33 owns the channel, the allowlist and the redaction boundary. No Nodemailer, no `lib/scheduler.ts` edit, no `app/api/**` change (acceptance #47).
- **No `category_rules` work and no sync-cadence change.** §5's closing sentence — *"pacing is only useful if a transaction is categorized within a day or two of landing, which puts pressure on `category_rules` coverage and sync cadence"* — **names a consequence; it commissions nothing.** It is a prediction about what this bound will make visible, not a work item hidden in a subordinate clause. Rules coverage and sync cadence are their own changes, and an implementer who touches `lib/plaid.ts`, the scheduler, or `category_rules` here has taken scope that was never granted (acceptance #47).
- **No new adherence or pacing arithmetic.** `lib/domain/adherence.ts` and `lib/domain/pacing.ts` are read-only inputs, byte-identical, along with their test files; their 47 + 24 = 71 tests are the tripwire (#40–#42). The hero's own money figures must not move: `getMonthlyActuals`'s SQL keeps its predicate set and its 0-based month normalisation (#43, #43a).
- **No eighth `OutlookState`.** The union stays exactly the seven it is today, byte-identical (#34, #34a). See Q3 for why coverage is a flag beside the state and not a rung in it.
- **No suppression of the hero.** "Refuses to render as authoritative" is not "renders nothing" — see Q4. `data-testid="month-outlook-hero"` and `data-testid="coverage-caveat"` both survive and are rendered in every state and both authority modes (#25, #27).
- **No `control_mode` write path.** N51 is real and missing; it is not this step and must not be smuggled in.
- **No contract change.** No migration, no `db/schema.sql` edit, no `shared/types.ts` edit (#46). G1 is skipped. If the implementer finds a contract change genuinely required, that is a loud finding, not something to absorb.
- **No `app/budget/page.tsx` change.** §5 says `/budget` "already counts uncategorized per landscape"; the *promotion* of that count into a bound happens on the hero. `/budget`'s own callout is untouched.
- **No component-test toolchain.** No `@testing-library/*`, no `jsdom`, no `happy-dom`, no `playwright`, and **no change to `vitest.config.mts`** (it has no `resolve.alias`, so a component test importing `@/...` would not resolve; see T5). The renderer stays ungated, exactly as step 31 declared — see Q4's stated limitation.
- **No edit to any file under `components/`** (#48 scope command).
- **No seed or screenshot change.** `scripts/seed-demo.mjs` and `docs/screenshots/**` are outside this diff.
- **No repair of the rename hazard itself.** N43 has two halves. This step fixes the half that lies to the owner — an orphan now *lowers* coverage instead of raising it. The other half, `PATCH /api/categories` not remapping transactions on a rename, stays a follow-up on the categories surface (see Q5).

## Contracts touched

| File | Change | Class (§9.2) |
|---|---|---|
| *(none)* | — | — |

Every column read already exists: `transactions.{date, amount, hidden, mapped_category, account_id}`, `accounts.track_transactions`, `budget_categories.{name, landscape, exclude_from_budget, is_income, control_mode}`. `CategorizationCoverage`, `MonthOutlook` and `COVERAGE_THRESHOLD` are **domain** types and values in `lib/domain/`, which BUILD.md §2 does not place on the contract surface — the same class as `drift.ts`, `propertyPnl.ts`, `adherence.ts` and `pacing.ts`. Nothing here crosses a process boundary. `db/schema.sql`, `migrations/**` and `shared/types.ts` are untouched and #46 asserts it.

`CategorizationCoverage`'s existing two fields (`uncategorizedCount`, `categorizedCount`) are **removed, not extended**. That is deliberate: they name a population this spec has just declared wrong (N41), and leaving them in place lets the defective caveat survive beside the corrected one. Removing them makes `tsc` enumerate every consumer (#1, #30).

## The seven open questions, decided

### Q1 — share of *what*: the population, stated once and applied to both halves

**Decided: the population in the Goal table above — month-to-date, tracked, not hidden, `amount > 0`, no account-landscape predicate — split three ways by resolving `mapped_category` through `isScoredCategory`.**

Three properties earn it, and each answers a specific inherited finding:

1. **It is knowable without the answer.** The denominator never asks "is this uncategorized row discretionary?" — a question whose unanswerability is the entire problem. It asks only "could the headline have seen it?", and for an uncategorized row the honest answer is *unknown*, which is why it sits in the denominator and not the numerator.
2. **It resolves N42 by deleting the second landscape column rather than choosing between two.** `getMonthlyActuals` — the query that feeds the hero's actuals — has no account-landscape predicate, and this step may not change it (the hero's figures must not move). So the coverage numerator adopts `getMonthlyActuals`'s predicate set exactly: tracked, not hidden, positive amounts, the month window. Landscape enters **once**, on the *category*, through `isScoredCategory`'s first conjunct. One column, one table, one gate. The N42 scenario — a $2,000 vacation paid from the capital `demo_sav_capex` account and mapped to `Travel` — now moves the hero **and** appears in the numerator, which is what "one population" means. Acceptance #29 asserts the account-landscape predicate is gone (`2` today).
   - **The cost, stated rather than discovered:** an uncategorized transaction on a *capital* account (a brokerage purchase, say) now sits in the denominator and drags coverage down. That is the correct reading — an uncategorized row on a capital account genuinely *might* be the Travel case — and it is self-resolving: the moment it is mapped to a capital category it becomes known-unscored and leaves both halves. If the owner's dev database is dominated by such rows the bound will refuse authority today, which is why the measured share is a required piece of evidence and not an assumption.
3. **It resolves N41 by excluding known-unscored spend from both halves.** Today's caveat reports a denominator of every operational-account transaction — income, `Transfers`, `fixed`, `variable-necessary`, capital-mapped rows — and asserts the figures above it were computed over that set. They were not. Under this population a `Groceries` (`variable-necessary`) charge is *known* not to belong to the scored set, so it is not spend the headline failed to see; it is spend the headline correctly ignored. Fixture #7 is the negative control: adding $4,000 of known-unscored spend must not move the share.

**Rejected alternative — "share of operational spend carrying any category"** (numerator = all categorized, denominator = all). It is a categorization-hygiene metric, not a confidence bound on *this* figure: it reads 98% while the scored set saw a tenth of that. §5's exit says "the share of spend **it** actually saw", and "it" is the headline. Fixture #6 pins the difference numerically.

### Q2 — dollars or transactions, and the sign

**Decided: the bound is a share of DOLLARS. Counts survive as supporting detail and are never divided.**

§5 says *spend*. ITEM.md's own example is the reason: one uncategorized $4,000 row against forty categorized $12 coffees is 97.6% by count and a rounding error away from useless by dollars. Fixture #6 is that example with literal figures — `480 / 4480 = 0.10714285714285714`, percent `10` — pinned `not.toBe(40/41)`.

**Sign.** This ledger keeps Plaid's convention: **positive is money out**. Spend is `t.amount > 0` and nothing else.

- Income is **negative** here. A denominator that admits a $9,000 inbound payroll row is not a share of spend, and the failure is silent because the row makes the denominator *larger* and the share *smaller* — it refuses authority for the wrong reason and nobody investigates a pessimistic caveat.
- Refunds are negative and are **excluded, not netted**. This is the divergence step 31 recorded knowingly against `components/BudgetMonthlyGrid.tsx`, inherited unchanged, and it is required here for consistency with `getMonthlyActuals`: a numerator that nets refunds against a denominator that does not is two populations again.
- The domain **rejects** a negative spend total outright with a `RangeError` (fixture #16), which is the negative control for the whole sign rule: a coverage query that forgot its positive filter produces negative group sums for the income groups and crashes loudly instead of shipping a plausible wrong denominator.

### Q3 — the threshold: a named policy constant at **0.95**, and why that number rather than an unexamined one

**Decided: `export const COVERAGE_THRESHOLD = 0.95;` in `lib/domain/monthOutlook.ts`, applied as `coverageShare >= COVERAGE_THRESHOLD` — a closed lower bound, not an open one.**

**It is a policy constant and this spec says so out loud.** No threshold can guarantee a verdict: a $12 unattributed coffee flips a category sitting $10 under its month, at any coverage whatsoever. The constant does not buy per-verdict certainty; it buys *aggregate* credibility, and pretending otherwise is the kind of false derivation this repo keeps finding. What follows is the reasoning for the value, not a proof of it.

- **It cannot be 1.0.** Any nonzero unattributed spend can flip a marginal category, so a certainty threshold refuses authority in every real month. A guardrail that always fires is one the owner learns to dismiss — the same failure mode §5 names for a caveat that is always green.
- **It should not be lower, on this data.** At coverage `c` the unattributed mass is `(1 − c)/c` of what the headline saw. At `c = 0.95` that is **5.26%** of the month's scored spend (verified: `(1-0.95)/0.95 = 0.0526315…`). The owner's scored set is **nine** categories (the P0.5-28 migration is applied; 9 of 21 operational candidates are scored), so at an even split that invisible mass is **47% of one average category's month** (verified: `0.0526… / (1/9) = 0.4737`). Below 0.95 the unattributed mass exceeds half an average category's budget and can create a breach on its own; at or above it, no single category can be flipped by the aggregate unless it was already inside 5% of its limit — a call the hero already renders as marginal.
- **It is named and exported so it can be moved by evidence** rather than rediscovered as a magic number, and it appears as a literal **exactly once** in the shipped code. The page must not restate it (#21).

**The boundary is closed.** `share === 0.95` is authoritative. Fixture #9 is exactly at it (`1900 / 2000 === 0.95`, verified exact in IEEE-754) and asserts `authoritative` is `true`, pinned `not.toBe(false)`; fixture #10 is one dollar below (`1899 / 2000 = 0.9495`, percent `94`) and asserts `false`. The two fixtures differ by one dollar moved from the numerator to the unattributed bucket, which is the only way to prove the comparison is `>=` and not `>` — and that it is applied to the fraction, not to the percent (`0.95` versus `95` is a live inversion; a threshold compared against `coveragePercent` would refuse everything).

**Rounding, because the threshold makes it load-bearing.** `coveragePercent` is `Math.floor(share * 100)`, computed **once, in the domain**, never on the page. `Math.round` is forbidden in `lib/domain/monthOutlook.ts` (#35, `0` today and enforced) and the page's own `pct()` helper — which rounds — must not be applied to the share. A rounded 99.6% renders "computed over 100% of spend" beside seven unattributed transactions, which is a confidently wrong number generated by a display convention. Fixture #11: `9999 / 10000` → percent `99`, pinned `not.toBe(100)`. Fixture #12: **100 is reachable only when `unattributedSpend === 0`**.

### Q4 — what "refuses to render as authoritative" does: **demote, never suppress**

**Decided: the hero keeps rendering — the state, the named lists, the whole struct — and stops being presented as a verdict. The mechanism is a boolean beside the state, not an eighth state.**

**Why not suppression.** §5's exit is "the headline number **always ships** with the share of spend it actually saw." A suppressed hero ships nothing, so it cannot ship with its share; the exit clause decides this, and the phase's thesis is satisfied without suppression because what is removed is the *confidence*, not the information. The three named lists are still true statements about the rows that were seen: a category that is already $400 over its month is over it whatever the coverage is. Deleting that because other spend is unattributed replaces a qualified truth with nothing.

**Why a flag and not an eighth state.** The ladder is closed at seven, **totally ordered**, and every adjacent pair is separately mutation-gated by the 24 tests in `lib/domain/monthOutlook.test.ts`. An eighth state would need a position in that total order — and there is no correct position, because coverage is **orthogonal** to which of the seven is true. `low-coverage` above `breach` would erase a real breach; below it, it would never fire in the months that most need it. A boolean composes with all seven at once and destroys no information: fixture #13 asserts a `breach` under low coverage is still `state: 'breach'` with `authoritative: false`, and fixture #14 asserts an `on-track` month can carry `authoritative: false` simultaneously. The union type is asserted byte-identical (#34, #34a).

**What the page must do, as observable requirements:**

1. `outlook.authoritative` is consulted (#22), and the hero's presentation is **not** selected by state alone: the expression `STATE_COPY[outlook.state]` must no longer appear (#23, `1` today). Any shape in which the tone and title depend on both the state and the authority satisfies this; the grep names the incumbent shape, not a replacement.
2. A distinct region `data-testid="coverage-refusal"` renders **if and only if** `authoritative === false` (#24), inside the hero and after it in source order (#26).
3. The share renders **in every state and in both authority modes** — §5's "always ships" (#25, #27, #33). When `coveragePercent` is `null` the caveat names the cause ("no spend recorded this month yet") and renders neither `0%` nor `100%`.
4. When the state is `nothing-to-score` the two messages stack, and the refusal copy must not contradict the "classify your categories" route out.

**The limitation, stated plainly and repeated verbatim in `EVIDENCE.md`.** *No command in this spec proves what the browser renders.* Step 31's Q1 established why — the page is an `async` server component issuing its own SQL, `vitest.config.mts` carries no `resolve.alias`, and a mocked-DB render would test the mock. The greps above are proxies for the refusal, not proof of it, and **the refusal must not be described anywhere as "tested."** What *is* mechanically gated is the decision — `coverageShare`, `coveragePercent` and `authoritative` are pure, and fixtures #6–#18 pin them.

### Q5 — orphans (N43): **detected, and counted as unattributed**

**Decided: a `mapped_category` matching no `budget_categories` row is unattributed, and its dollars are reported separately as `orphanedSpend` / `orphanedCount`.**

N43's own sentence is the argument: today an orphan makes the spend vanish from the category's `actual` **and** counts as categorized, so *confidence rises exactly as truth falls*. Under this spec the same rename moves that spend into the denominator only, and the share drops — which is the one direction that cannot mislead. It costs nothing: the classifier already resolves every group name against the category rows, and "no row matched" is the branch it must handle anyway.

Fixture #8 is the negative control with the wrong answer pinned: $1,900 on `Dining Out` plus $100 on the orphaned `Dining Ou` gives `0.95`, and `not.toBe(1)` — `1` being exactly what today's `mapped_category IS NOT NULL` shape reports.

Measured on the owner's database today: **0 orphans**, so this is latent rather than live, and the fixture is the only place it is observable. That is stated so a reviewer does not read a green dev-database check as evidence the branch works.

**Not fixed here:** `PATCH /api/categories` still renames a category without remapping its transactions (`app/api/categories/route.ts:89-98`). That is the cause; this step fixes the silence. The remap is a follow-up on the categories surface, in the same family as N1, and `app/api/**` is out of scope (#47).

### Q6 — the name-in-two-landscapes hazard

`budget_categories` is `UNIQUE (name, landscape)`, so one name can exist in both landscapes, and `mapped_category` is matched **by name**. The classifier's rule, stated because it is otherwise inferred from whichever fixture is seen first:

> A group is **scored** if **any** `budget_categories` row carrying that name satisfies `isScoredCategory`; **known-unscored** if rows carry the name but none is scored; **unattributed** if no row carries it. Its dollars are counted **once**, whatever the number of matching rows.

Fixture #18 is the negative control: `Travel` defined as operational/discretionary *and* capital/fixed, one group of $500, must yield `scoredSpend: 500`, pinned `not.toBe(1000)`. (The related double-count in `toAdherenceInput` — where both category rows read the same name-keyed actuals — is pre-existing, out of scope, and belongs in `NITS.md`.)

### Q7 — N40, the unconditionally reassuring subtitle

**Decided: discharged here, minimally, as copy.**

The `else` subtitle branch renders "No scored category is over or projecting over as of day N of M" under an emerald "On track to close inside your limits" while five unbudgeted discretionary categories sit in `withheld` having drawn $3,000. Both sentences are true under the module's definition of "over" and neither says so; in `no-budget-basis` the sentence is *vacuously* true and rendered as a finding.

The requirement: **when `outlook.withheld.length > 0`, the subtitle must say so and say how many** — the sentence must not read as a statement about the whole scored set when it is a statement about the budgeted part of it. The incumbent sentence must be gone (#44, `1` today) and `withheld.length` must be consulted a third time (#45, `2` today). The ladder itself is step 31's frozen output and **must not change**.

## Conventions this task must honor

- **Sign:** positive is money out (Plaid's convention, kept). Spend is `t.amount > 0` only. Income is negative and never enters either half of the fraction. Refunds are negative and are **excluded, not netted** — matching `getMonthlyActuals`, knowingly divergent from `components/BudgetMonthlyGrid.tsx` (the divergence step 31 recorded). A negative spend total reaching the domain is a `RangeError`, not a smaller share.
- **Rounding:** group totals arrive from Postgres `NUMERIC` as text and are converted to `number` **once**, at the page's query boundary — never string-concatenated (the [[N20]] class; the domain rejects a non-`number`). `coverageShare` is an **unrounded** fraction. `coveragePercent` is floored **once**, in the domain, and never rounded; the page's `pct()` helper must not touch the share. No cent rounding anywhere in this path: `roundCents(`, `Math.round(`, `Math.abs(` and `.toFixed(` remain absent from `lib/domain/monthOutlook.ts` (#35).
  - *Accepted imprecision, stated:* summing cent-quantized doubles can drift by ~1e-13, which is irrelevant at a 0.95 threshold except exactly on it. The boundary fixtures (#9, #10) use integer dollar totals that are exact in IEEE-754 precisely so the boundary assertion tests the comparison and not the float.
- **Landscape + exclusions:** **exactly one landscape gate, on the category**, via `isScoredCategory`'s first conjunct. **No `a.landscape` predicate scopes the coverage population** (#29). `hidden = FALSE` and `a.track_transactions = TRUE` apply to the entire population, both halves. `exclude_from_budget = TRUE` and `is_income = TRUE` reach the classification **only** through `isScoredCategory`: such a category's spend is known-unscored and leaves *both* halves — it is neither seen nor missed.
- **Window:** the as-of month to date — `[isoDay(asOf.year, asOf.month, 1), isoDay(asOf.year, asOf.month, asOf.day)]`, the same window the outlook's as-of month covers (#43b). Not the year, not the whole calendar month.
- **Null semantics:** an empty population (`scoredSpend + unattributedSpend === 0`) yields `coverageShare: null`, `coveragePercent: null`, `authoritative: false`. **Never `0`, never `1`, never `100`, never `NaN`** — 100%-of-nothing is the most confident possible statement about the least possible evidence, and this app shows "—" rather than a wrong zero. Fixture #15 pins all three, with `not.toBe(0)` and `not.toBe(1)`.
- **Internal consistency:** `0 <= orphanedSpend <= unattributedSpend` and `0 <= orphanedCount <= unattributedCount`; all six figures finite `number`s; all non-negative. Violations are `RangeError`s (fixtures #16, #17, #18a), thrown by the same `assertCallerContract` discipline the module already applies to rows — the caller contract is enforced here, before anything is computed, and never softened into a default.

## Toolchain prerequisites

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `vitest` runs `lib/**/*.test.ts` in `environment: 'node'`, no DB | **yes** | already configured (`vitest.config.mts`) | `npx vitest run --pool=threads --reporter=verbose lib/domain/monthOutlook.test.ts 2>&1 \| grep -cE "✓ lib/domain/monthOutlook\.test\.ts"` | `24` on the clean tree |
| T2 | `typescript` resolves the repo's `@/` paths for `npx tsc --noEmit` | **yes** | `tsconfig.json`, already present | `npx tsc --noEmit; echo "exit=$?"` | `exit=0` |
| T3 | `git` with `HEAD` at the merged step-31 commit, for the scope commands | **yes** | working tree | `git rev-parse --short HEAD` | `47c8c8e` |
| T4 | `node` for the arithmetic checks in Evidence | **yes** | installed | `node -e "console.log(1900/2000 === 0.95)"` | `true` |
| T5 | a component-render harness (`react-dom/server`, jsdom, RTL, Playwright) | **NO** | not obtained, not needed | n/a — no acceptance command renders a component | Q4 states the resulting limitation |
| T6 | a database of any kind | **NO** | n/a | n/a — every acceptance command is a pure test or a grep | the dev-DB measurement in Evidence is *evidence*, not acceptance |

## Acceptance commands

`…` abbreviates `npx vitest run --pool=threads --reporter=verbose lib/domain/monthOutlook.test.ts 2>&1`. All commands run from the repo root.

> **Pipe-escaping convention, repeated because it has cost this queue a G0 failure twice.** Inside a Markdown table cell `\|` renders as one literal `|`, which inside an ERE is a **literal pipe, not alternation**. Every regex-bearing command is repeated verbatim and unescaped in the code block below the table, and **that block is authoritative** if the two disagree.
>
> **A4's lesson, applied.** No command below pins an exact count for "this symbol appears"; presence is `-ge 1`. Where a count *is* pinned it is pinned to a value measured on the clean tree and named in the Expected column, and it is asserting a **removal** or a **byte-identity**, not a code shape. If a correct implementation cannot satisfy a counter here, **escalate it at G2 the way A3 and A4 were escalated** — report it, do not reshape the code to satisfy the counter, and do not edit this file.

| # | Command | Expected |
|---|---|---|
| 1 | `npx tsc --noEmit; echo "exit=$?"` | `exit=0` (T2). Paired with #30: removing the two count fields makes `tsc` enumerate every consumer |
| 2 | `npm test 2>&1 \| grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"` | `1` — whole repo green, nothing skipped |
| 3 | `npm run lint 2>&1 \| tail -2` | `✖ 1 problem (0 errors, 1 warning)` — the pre-existing `scripts/seed-demo.mjs:438` warning and no other |
| 4 | `npm run build > /tmp/p32-build.log 2>&1; echo "exit=$?"` | `exit=0` |
| 5 | `test $(… \| grep -cE "✓ lib/domain/monthOutlook\.test\.ts") -ge 38 && echo OK` | `OK` — the 24 that exist plus the 14 named below. `24` today |
| 6 | `… \| grep -cF "the bound is a share of dollars, so one uncategorized four-thousand-dollar row against forty categorized twelve-dollar ones reports ten percent seen and not ninety-seven"` | `1` — **Q2, the dollars-not-counts gate** |
| 7 | `… \| grep -cF "spend mapped to a category the headline never scores leaves both the numerator and the denominator, so a categorized grocery run neither helps nor hurts the bound"` | `1` — **N41** |
| 8 | `… \| grep -cF "an orphaned mapped category is unattributed rather than categorized, so a rename that hides a category's spend lowers confidence instead of raising it"` | `1` — **N43** |
| 9 | `… \| grep -cF "coverage exactly at the threshold is authoritative, because the bound is a closed floor and not an open one"` | `1` |
| 10 | `… \| grep -cF "one dollar moved from the seen spend to the unattributed spend crosses the threshold and withdraws authority"` | `1` |
| 11 | `… \| grep -cF "the percentage is floored and never rounded, so nine thousand nine hundred ninety-nine dollars of ten thousand reports ninety-nine and not a hundred"` | `1` |
| 12 | `… \| grep -cF "a hundred percent is reachable only when no spend at all is unattributed"` | `1` |
| 13 | `… \| grep -cF "unattributed spend does not change which of the seven states is true, so a breach under low coverage is still a breach"` | `1` — **Q4, flag not eighth state** |
| 14 | `… \| grep -cF "a month can be on track and non-authoritative at the same time, because the state and the bound are independent judgements"` | `1` |
| 15 | `… \| grep -cF "a month with no spend at all reports no share rather than a hundred percent or a zero"` | `1` — **null semantics** |
| 16 | `… \| grep -cF "a negative spend total is rejected, because income is negative in this ledger and a denominator that admits it is not a share of spend"` | `1` — **Q2's sign control** |
| 17 | `… \| grep -cF "orphaned spend larger than the unattributed total it belongs to is rejected rather than reported as a share above one"` | `1` |
| 18 | `… \| grep -cF "a category name defined in both landscapes resolves as scored once and its spend is counted once"` | `1` — **Q6** |
| 18a | `… \| grep -cF "a spend total arriving as a string is rejected rather than concatenated into a plausible denominator"` | `1` — the [[N20]] class |
| 19 | `… \| grep -cF "the roadmap's day-8-of-30 sentence becomes a hero state and a named list, so a category projecting to close at 266.25 percent of its month is the one saying no while the one projecting at 81.25 percent is holding"` | `1` — **retention**: step 31's binding numeric case survives |
| 19a | `… \| grep -cF "an empty scored set renders nothing to score rather than on track, and the tracked-but-unscored categories still produce adherence findings beside it"` | `1` — **retention**: the demo dataset's own case survives |
| 19b | `… \| grep -cF "the coverage the figures were computed over is carried through unchanged and is reported even when every category is holding"` | `1` — **retention**: `MonthOutlook.coverage` is still the caller's own object, carried by identity |
| 20 | `grep -cE "^export const COVERAGE_THRESHOLD = 0\.95;" lib/domain/monthOutlook.ts` | `1` — the constant is named, exported and pinned at the decided value. `0` today |
| 21 | `grep -c '0\.95' app/dashboard/page.tsx` | `0` — the page never restates the threshold. **Same before and after**; paired with #22, which witnesses the page consuming the decision instead of recomputing it |
| 22 | `test $(grep -c 'outlook.authoritative' app/dashboard/page.tsx) -ge 1 && echo OK` | `OK` — the refusal is driven by the domain's judgement. `0` today |
| 23 | `grep -cE 'STATE_COPY\[ *outlook\.state *\]' app/dashboard/page.tsx` | `0` — the hero's presentation is not chosen by state alone. `1` today |
| 24 | `grep -c 'data-testid="coverage-refusal"' app/dashboard/page.tsx` | `1` — the refusal is a distinct region. `0` today |
| 25 | `grep -c 'data-testid="coverage-caveat"' app/dashboard/page.tsx` | `1` — the caveat is never deleted, only corrected. **Same before and after**; paired with #24 and #33 |
| 26 | `test $(grep -n 'data-testid="month-outlook-hero"' app/dashboard/page.tsx \| cut -d: -f1) -lt $(grep -n 'data-testid="coverage-refusal"' app/dashboard/page.tsx \| cut -d: -f1) && echo OK` | `OK` — the refusal renders inside the hero, not instead of it |
| 27 | `grep -c 'data-testid="month-outlook-hero"' app/dashboard/page.tsx` | `1` — the hero is demoted, never suppressed. **Same before and after**; paired with #24 |
| 28 | `grep -o 'data-testid="[^"]*"' app/dashboard/page.tsx \| head -1` | `data-testid="month-outlook-hero"` — step 31's source-order proxy is preserved |
| 29 | `grep -cE "a\.landscape = 'operational'" app/dashboard/page.tsx` | `0` — **N42**: no account-landscape predicate scopes the coverage population. `2` today (the SQL and its doc comment). *The replacement comment must say "the account's landscape" in prose, not restate the literal predicate* |
| 30 | `grep -rl 'categorizedCount' lib/domain/monthOutlook.ts lib/domain/monthOutlook.test.ts app/dashboard/page.tsx \| wc -l \| tr -d ' '` | `0` — the fields naming the wrong population are gone, not left beside the right one. `3` today |
| 31 | `test $(grep -cE '^export function categorizationCoverage' lib/domain/monthOutlook.ts) -ge 1 && echo OK` | `OK` — the classification is a pure domain function. `0` today |
| 32 | `test $(grep -c 'categorizationCoverage' app/dashboard/page.tsx) -ge 1 && echo OK` | `OK` — the page calls it rather than classifying in SQL. `0` today |
| 32a | `grep -c "control_mode = 'discretionary'" app/dashboard/page.tsx` | `0` — `isScoredCategory` is not re-expressed in a `WHERE` clause. **Same before and after**; paired with #31 and fixture #7, which witness the classification living in tested code |
| 33 | `test $(grep -c 'coveragePercent' app/dashboard/page.tsx) -ge 1 && echo OK` | `OK` — the page renders the domain's floored integer, not its own rounding. `0` today |
| 34 | `grep -cF "  \| 'nothing-to-score' \| 'off-cycle' \| 'breach' \| 'projected-breach'" lib/domain/monthOutlook.ts` | `1` — the closed set of seven, line 1, byte-identical |
| 34a | `grep -cF "  \| 'too-early' \| 'no-budget-basis' \| 'on-track';" lib/domain/monthOutlook.ts` | `1` — line 2. **Same before and after** by design; paired with fixtures #13 and #14, which witness the flag mechanism that made an eighth state unnecessary |
| 35 | `grep -cE '\b(roundCents\|Math\.round\|Math\.abs\|toFixed)\(' lib/domain/monthOutlook.ts` | `0` — **this is the "never rounds up to 100" gate, statically.** `0` today; paired with fixture #11, which witnesses the floor |
| 36 | `grep -cE 'try *\{\|catch *\(' lib/domain/monthOutlook.ts` | `0` — [[N34]]: the `RangeError` is never swallowed. `0` today; paired with fixtures #16–#18a, which add three new throws to swallow |
| 37 | `grep -cE 'new Date\(\|Date\.now\(' lib/domain/monthOutlook.ts` | `0` — the module still reads no clock |
| 38 | `grep -oE 'new Date\(' app/dashboard/page.tsx \| wc -l \| tr -d ' '` | `1` — step 31's one clock read survives; the coverage window uses the same three integers |
| 39 | `grep -ciE 'netWorth\|net_worth\|Net Worth' app/dashboard/page.tsx` | `0` — step 31's exit criterion is not regressed |
| 40 | `test $(npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 \| grep -cE "✓ lib/domain/adherence\.test\.ts") -eq 47 && echo OK` | `OK` — the tripwire, exactly |
| 41 | `test $(npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 \| grep -cE "✓ lib/domain/pacing\.test\.ts") -eq 24 && echo OK` | `OK` |
| 42 | `git diff --stat HEAD -- lib/domain/adherence.ts lib/domain/pacing.ts lib/domain/adherence.test.ts lib/domain/pacing.test.ts \| wc -l \| tr -d ' '` | `0` — the read-only inputs are byte-identical |
| 43 | `grep -cF 'EXTRACT(MONTH FROM t.date)::int - 1' app/dashboard/page.tsx` | `1` — `getMonthlyActuals` keeps its 0-based normalisation; the hero's figures do not move |
| 43a | `grep -cF 'COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::text AS actual' app/dashboard/page.tsx` | `1` — and its predicate set |
| 43b | `test $(grep -c 'isoDay(asOf.year, asOf.month, 1)' app/dashboard/page.tsx) -ge 1 && echo OK` | `OK` — the coverage window starts at the first of the as-of month |
| 43c | `test $(grep -c 't\.amount > 0' app/dashboard/page.tsx) -ge 15 && echo OK` | `OK` — the coverage aggregation filters spend on its own line. `14` today. *If a correct implementation cannot satisfy this line counter, escalate at G2 per A4 rather than reshaping the query* |
| 44 | `grep -cF 'No scored category is over or projecting over as of day' app/dashboard/page.tsx` | `0` — **N40**: the unconditionally reassuring sentence is gone. `1` today |
| 45 | `test $(grep -c 'withheld\.length' app/dashboard/page.tsx) -ge 3 && echo OK` | `OK` — the subtitle consults it. `2` today (both in the panel conditionals) |
| 46 | `git diff --name-only HEAD -- shared/ db/ migrations/ \| wc -l \| tr -d ' '` | `0` — no contract change; G1 stays skipped |
| 47 | `git diff --name-only HEAD -- lib/scheduler.ts lib/plaid.ts app/api/ app/budget/ components/ scripts/ docs/ vitest.config.mts \| wc -l \| tr -d ' '` | `0` — no delivery, no `category_rules` work, no sync-cadence change, no seed, no toolchain |
| 48 | `git diff --name-only HEAD \| grep -vE '^(lib/domain/monthOutlook(\.test)?\.ts\|app/dashboard/page\.tsx\|AGENTS\.md\|plan/)' \| wc -l \| tr -d ' '` | `0` — **the scope command for tracked files** |
| 49 | `git status --porcelain \| grep -vE '^.. (lib/domain/monthOutlook(\.test)?\.ts\|app/dashboard/page\.tsx\|AGENTS\.md\|plan/)' \| wc -l \| tr -d ' '` | `0` — **the scope command including untracked files.** The scope-guard hook is inactive this session; this plus the orchestrator's diff review is the only enforcement |

**The regex-bearing commands, verbatim and authoritative** (copy from here, not from the table):

```sh
# 2 — whole repo green, nothing skipped.  Expect: 1
npm test 2>&1 | grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"

# 5 — the 24 existing plus 14 new.  Expect: OK
test $(npx vitest run --pool=threads --reporter=verbose lib/domain/monthOutlook.test.ts 2>&1 | grep -cE "✓ lib/domain/monthOutlook\.test\.ts") -ge 38 && echo OK

# 20 — the threshold is named, exported and pinned.  Expect: 1
grep -cE "^export const COVERAGE_THRESHOLD = 0\.95;" lib/domain/monthOutlook.ts

# 23 — the hero's presentation is not chosen by state alone.  Expect: 0  (1 today)
grep -cE 'STATE_COPY\[ *outlook\.state *\]' app/dashboard/page.tsx

# 26 — the refusal renders inside the hero.  Expect: OK
test $(grep -n 'data-testid="month-outlook-hero"' app/dashboard/page.tsx | cut -d: -f1) -lt $(grep -n 'data-testid="coverage-refusal"' app/dashboard/page.tsx | cut -d: -f1) && echo OK

# 29 — N42: no account-landscape predicate.  Expect: 0  (2 today)
grep -cE "a\.landscape = 'operational'" app/dashboard/page.tsx

# 30 — the wrong-population fields are gone.  Expect: 0  (3 today)
grep -rl 'categorizedCount' lib/domain/monthOutlook.ts lib/domain/monthOutlook.test.ts app/dashboard/page.tsx | wc -l | tr -d ' '

# 31 — the classification is a pure domain function.  Expect: OK  (0 today)
test $(grep -cE '^export function categorizationCoverage' lib/domain/monthOutlook.ts) -ge 1 && echo OK

# 34 / 34a — the closed set of seven, byte-identical.  Expect: 1 and 1
grep -cF "  | 'nothing-to-score' | 'off-cycle' | 'breach' | 'projected-breach'" lib/domain/monthOutlook.ts
grep -cF "  | 'too-early' | 'no-budget-basis' | 'on-track';" lib/domain/monthOutlook.ts

# 35 — no money rounding; the percentage is floored, never rounded.  Expect: 0
grep -cE '\b(roundCents|Math\.round|Math\.abs|toFixed)\(' lib/domain/monthOutlook.ts

# 36 — the RangeError is never swallowed (N34).  Expect: 0
grep -cE 'try *\{|catch *\(' lib/domain/monthOutlook.ts

# 37 — the module reads no clock.  Expect: 0
grep -cE 'new Date\(|Date\.now\(' lib/domain/monthOutlook.ts

# 38 — one clock read on the page.  Expect: 1
grep -oE 'new Date\(' app/dashboard/page.tsx | wc -l | tr -d ' '

# 39 — net worth stays gone.  Expect: 0
grep -ciE 'netWorth|net_worth|Net Worth' app/dashboard/page.tsx

# 48 — scope, tracked files.  Expect: 0
git diff --name-only HEAD | grep -vE '^(lib/domain/monthOutlook(\.test)?\.ts|app/dashboard/page\.tsx|AGENTS\.md|plan/)' | wc -l | tr -d ' '

# 49 — scope, including untracked.  Expect: 0
git status --porcelain | grep -vE '^.. (lib/domain/monthOutlook(\.test)?\.ts|app/dashboard/page\.tsx|AGENTS\.md|plan/)' | wc -l | tr -d ' '
```

### The fourteen new fixtures, with literal expected values

Every figure below was verified by execution (`node -e`) at spec time, per GATES A3. Each pins the plausible wrong answer with `not.toBe`, and for every share the wrong answer includes **the value the wrong population would produce**.

| Fixture | Input (groups: category → spend / count) | Expected | Pinned `not.toBe` |
|---|---|---|---|
| **C1** (#9) | `Dining Out` (op/disc) → 1900 / 20; `Groceries` (op/variable-necessary) → 4000 / 30; `null` → 100 / 4 | `scoredSpend 1900`, `unattributedSpend 100`, `orphanedSpend 0`, `coverageShare 0.95`, `coveragePercent 95`, `authoritative true` | share `not.toBe(0.9833333333333333)` (= `5900/6000`, **N41's population**); `authoritative` `not.toBe(false)` (the `>` boundary error) |
| **C2** (#10) | C1 with one dollar moved: `Dining Out` → 1899; `null` → 101 | `coverageShare 0.9495`, `coveragePercent 94`, `authoritative false` | percent `not.toBe(95)`; `authoritative` `not.toBe(true)` |
| **C3** (#6) | forty $12 rows on `Dining Out` → 480 / 40; `null` → 4000 / 1 | `coverageShare 0.10714285714285714`, `coveragePercent 10`, `authoritative false` | `not.toBe(0.975609756097561)` (= `40/41`, **the count-shaped answer**) |
| **C4** (#7) | `Dining Out` → 1900 / 20; `null` → 100 / 4; **plus** `Transfers` (`exclude_from_budget`) → 3000 / 2, `Salary` (`is_income`) → 0 / 0, `Mortgage` (`fixed`) → 2200 / 1, `Home Improvement` (capital) → 800 / 3 | `coverageShare 0.95` — identical to C1 | `not.toBe(1900/8000)` and `not.toBe(0.9833333333333333)` — known-unscored spend moves **neither** half |
| **C5** (#8) | `Dining Out` → 1900 / 20; `Dining Ou` (matching no category row) → 100 / 3 | `unattributedSpend 100`, `orphanedSpend 100`, `orphanedCount 3`, `coverageShare 0.95` | `not.toBe(1)` — **exactly what today's `mapped_category IS NOT NULL` shape reports** (N43) |
| **C6** (#11) | `Dining Out` → 9999 / 200; `null` → 1 / 1 | `coverageShare 0.9999`, `coveragePercent 99`, `authoritative true` | percent `not.toBe(100)` — the `Math.round` answer |
| **C7** (#12) | `Dining Out` → 2000 / 20; no unattributed group | `coverageShare 1`, `coveragePercent 100`, `authoritative true` | — (this is the *only* input in the suite permitted to report `100`) |
| **C8** (#15) | no groups at all | `coverageShare null`, `coveragePercent null`, `authoritative false` | share `not.toBe(0)` and `not.toBe(1)`; percent `not.toBe(0)` and `not.toBe(100)` |
| **C9** (#13) | C2's coverage + rows producing an already-over category | `state 'breach'`, `authoritative false`, `sayingNo` length unchanged from the same rows under C1's coverage | `state` `not.toBe('nothing-to-score')` — coverage must not erase a true verdict |
| **C10** (#14) | C2's coverage + step 31's two-holding-categories rows | `state 'on-track'`, `authoritative false` | `state` `not.toBe('breach')`; `authoritative` `not.toBe(true)` |
| **C11** (#16) | `Salary` group with spend `-9000` | `RangeError` naming the group and the sign rule | the function must **not** return a share |
| **C12** (#17) | `unattributedSpend 100`, `orphanedSpend 140` | `RangeError` | must not report a share above `1` |
| **C13** (#18a) | a group whose spend is the string `'6000'` | `RangeError` naming the type | must not concatenate ([[N20]]) |
| **C14** (#18) | `Travel` → 500 / 5, with `budget_categories` carrying **both** `Travel` (operational/discretionary) and `Travel` (capital/fixed) | `scoredSpend 500`, `coverageShare 1` | `not.toBe(1000)` — the double-count |

> **C1's boundary is exact in IEEE-754** — `1900/2000 === 0.95` returns `true`, verified — so `toBe(0.95)` is a legitimate assertion and the fixture tests the comparison operator rather than a float tolerance. C2's `1899/2000 = 0.9495`, `* 100 = 94.95`, `Math.floor → 94`: verified. C6's `9999/10000 = 0.9999`, `* 100 = 99.99`, `Math.floor → 99`: verified. C3's `480/4480 = 0.10714285714285714`, `* 100 = 10.714285714285714`, `Math.floor → 10`: verified.

## Negative controls

| # | Rule | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | Known-unscored spend is in neither half of the fraction | $3,000 of `Transfers` (`exclude_from_budget = TRUE`), $2,200 of `Mortgage` (`fixed`), $800 of a capital `Home Improvement` — the share must not move | fixture C4, acceptance #7 |
| 2 | The bound is dollars, never transactions | forty $12 rows against one $4,000 row must report `10`, not `97` | fixture C3, acceptance #6 |
| 3 | An orphaned `mapped_category` is unattributed, never categorized | `Dining Ou` after a rename must lower the share to `0.95`, not report `1` | fixture C5, acceptance #8 |
| 4 | Income never enters either half (sign) | a group summing `-9000` must throw, not shrink the share | fixture C11, acceptance #16 |
| 5 | The threshold is a closed floor on the *fraction* | `0.95` exactly must be authoritative; `0.9495` must not | fixtures C1 + C2, acceptance #9, #10 |
| 6 | The percentage is floored, never rounded | `0.9999` must render `99` | fixture C6, acceptance #11, and statically #35 |
| 7 | `100%` means complete attribution | only `unattributedSpend === 0` may report `100` | fixture C7, acceptance #12 |
| 8 | An empty population is `null`, not `0` and not `1` | no groups at all | fixture C8, acceptance #15 |
| 9 | Coverage is orthogonal to the state | low coverage must not turn a `breach` into anything else, nor an `on-track` into a state | fixtures C9 + C10, acceptance #13, #14 |
| 10 | A name in two landscapes is counted once | `Travel` in both landscapes with one $500 group | fixture C14, acceptance #18 |
| 11 | No account-landscape predicate scopes the population (N42) | `a.landscape = 'operational'` anywhere in the coverage query | acceptance #29 (`2` → `0`) |
| 12 | The membership test has one definition | `control_mode = 'discretionary'` in SQL | acceptance #32a, paired with #31 and fixture C4 |
| 13 | The wrong-population fields do not survive beside the right ones | any reference to `categorizedCount` | acceptance #30 (`3` → `0`) |
| 14 | The hero is demoted, never suppressed | a diff that removes `data-testid="month-outlook-hero"` or `data-testid="coverage-caveat"` | acceptance #25, #27, #26 |
| 15 | The ladder gains no eighth state | any change to the two `OutlookState` union lines | acceptance #34, #34a |
| 16 | The hero's own figures do not move | any edit to `getMonthlyActuals`'s predicate set or month normalisation | acceptance #43, #43a |
| 17 | The subtitle is not unconditionally reassuring (N40) | the incumbent sentence surviving | acceptance #44 (`1` → `0`), #45 (`2` → `≥3`) |
| 18 | §5's second-order sentence commissions nothing | any diff to `lib/plaid.ts`, `lib/scheduler.ts`, `app/api/**` | acceptance #47 |

## Evidence required

1. **The measured coverage on the owner's dev database, for the current month**, as one line: `scoredSpend`, `unattributedSpend`, `orphanedSpend`, `scoredCount`, `unattributedCount`, `orphanedCount`, `coverageShare`, `coveragePercent`, `authoritative`. Obtained by running the page's own aggregation through `psql` and the classifier by hand. **This is evidence, not acceptance** — it depends on dev-database state and no acceptance command may. It is required because it is the only way to learn whether the threshold refuses authority *today*, and Q1 flagged the capital-account case as the way that could happen. If it refuses, say so; do not adjust the threshold to make it green.
2. **The orphan count on the same database** (`0` at step 31's G4). If it is still `0`, say so explicitly, so a reviewer does not read a green dev check as evidence that the orphan branch works — fixture C5 is the only place that branch is observable.
3. **Before/after of the caveat sentence, quoted verbatim**, in all three shapes: authoritative, non-authoritative, and `coveragePercent === null`.
4. **The verbatim limitation from Q4**, repeated in `EVIDENCE.md`: no command in this spec proves what the browser renders; the refusal is gated as a decision, not as a rendering, and must not be described as "tested".
5. **The list of the 24 pre-existing `monthOutlook.test.ts` titles**, confirming all 24 survive the field rename (they must be edited, since `CategorizationCoverage`'s shape changes, but none may be deleted or renamed).
6. **Any counter in this spec that a correct implementation could not satisfy**, reported rather than worked around — the A3/A4 path.

## Failure modes to test

- **Numerator and denominator from different populations.** The defect this step exists to end (N41, N42). Symptom: a plausible percentage that is right about nothing.
- **Orphans counted as categorized** (N43): confidence rises as truth falls, silently, and the only signal is a category whose `actual` quietly went to zero.
- **Income admitted to the denominator.** Negative amounts make the denominator larger and the share *smaller* — the caveat refuses for the wrong reason and a pessimistic caveat is never investigated.
- **Refunds netted rather than excluded**, disagreeing with `getMonthlyActuals`, which nets nothing.
- **`Math.round` on the percentage**: `0.996` renders "computed over 100% of spend" beside four unattributed transactions.
- **The threshold compared against `coveragePercent` instead of `coverageShare`** — `95 >= 0.95` is always true, so the refusal never fires and every test that only checks the authoritative path passes.
- **`>` instead of `>=`** at the boundary: an off-by-one-cent refusal that only shows up on an exact 95%.
- **Denominator zero**: `0/0` is `NaN`, and `NaN >= 0.95` is `false`, so a naive implementation *accidentally* refuses — with `coveragePercent` rendering `NaN%`. The `null` contract exists to make the empty case explicit rather than accidentally-right.
- **A name defined in both landscapes counted twice**, doubling `scoredSpend` and pushing the share above `1`.
- **`hidden = TRUE` rows or `track_transactions = FALSE` accounts leaking into the population**, which no fixture can catch — the classification is pure, the population is SQL. Gated only by #43b and the reviewer reading the query.
- **The window widened to the whole year or the whole calendar month**, so a month's bound is computed over days that have not happened.
- **An eighth `OutlookState`** added "just for low coverage", breaking the closed set, its total order and the 24 adjacent-pair tests.
- **The hero suppressed rather than demoted**, contradicting §5's "always ships with the share it saw".
- **`float` drift in the summed group totals** landing exactly on the threshold. Accepted and bounded (~1e-13); the boundary fixtures use binary-exact integers so the assertion tests the operator.
- **The refusal rendered but the state's confident tone left intact** — the emerald "On track to close inside your limits" above a refusal banner. This is the failure the renderer's ungatedness makes most likely, and it is why #23 removes the state-only lookup.

## Rollback

One commit, no schema change, no data change: `git revert <sha>`. The revert restores `CategorizationCoverage`'s two counts and the unconditional count-shaped caveat, and `npx tsc --noEmit` is the completeness check — every consumer of the removed fields is a type error in both directions.

- **No `down` migration**, because there is no migration (#46).
- **No CSV restore**, because no row is written. This step reads.
- `plan/tasks/P0.5-32-coverage-bound/**` is documentation and is not reverted.
- If the threshold turns out to refuse authority permanently on the owner's data, **the rollback is not a revert** — it is a change to the single named `COVERAGE_THRESHOLD` constant, which is exactly why it is named and exported rather than inlined (Q3).

## Questions this spec could not settle

- **Whether 0.95 is the right number for the owner's actual data.** The reasoning in Q3 fixes the *shape* of the argument (an aggregate credibility bound, tied to the nine-category scored set) but the value cannot be validated without the measurement that Evidence #1 produces, which needs a database this spec may not depend on. If the measured share sits just under 0.95, that is information about the data, not about the constant — record it, do not tune the constant to clear it.
- **Whether the renderer actually demotes.** Q4 states this limitation rather than dressing it up. `vitest.config.mts` has no `resolve.alias` and adding a render harness is out of scope, so the refusal is gated as a decision and proxied as source. A reviewer who wants certainty must open the page.
- **Whether the `toAdherenceInput` double-count for a name in two landscapes is live on the owner's data.** Q6 fixes it inside the coverage classifier; the same hazard in the hero's own actuals is pre-existing, out of scope, and belongs in `NITS.md` as a follow-up.
