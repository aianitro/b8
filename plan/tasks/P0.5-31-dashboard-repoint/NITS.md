# NITS — P0.5-31-dashboard-repoint
<!-- Findings real enough to record, not severe enough to block a gate. Each names who owns it. -->

Raised by adversarial-reviewer at G3 (REVIEW-1). Verdict `ACCEPT_WITH_NITS`. None of the below is a
wrong number emitted by `lib/domain/monthOutlook.ts` — the state machine is correct against its
spec and mutation-verified. Every finding here lives in the layer the spec declared ungated (the
page) or in inherited surface the spec deliberately re-deferred.

Numbering continues the queue-wide sequence and starts at **N40**.

---

## N40 — the hero's copy is unconditionally reassuring when part of the scored set has no budget
**File:** `app/dashboard/page.tsx:666-670` (the `else` subtitle branch)
**Owner:** step 32's spec (it already owns "the threshold below which the figure refuses to be
authoritative"), or a one-line follow-up here.

The subtitle has three branches: `nothing-to-score`, `sayingNo.length > 0`, and everything else. The
"everything else" branch fires for exactly three states — `too-early`, `no-budget-basis`,
`on-track` — and renders, unconditionally:

> No scored category is over or projecting over as of day 8 of 30.

It never mentions `withheld`, and it is rendered under `STATE_COPY['on-track'].title` =
**"On track to close inside your limits"** in emerald.

**Failure scenario.** Six discretionary operational categories. Five have `annual_budget = 0` — the
state a real install lands in the moment somebody classifies categories before setting budgets, and
the exact state P0.5-28's migration default plus N7's seed fix makes reachable. Those five drew
$3,000 this month. The sixth has $500 budgeted and $100 spent at day 8.

- `verdictFor` puts the five in `withheld` with `no-budget`; the sixth in `holding`.
- `everyRecordUnbudgeted` is `false` (the sixth has `budgeted > 0`), so rung 6 does not fire.
- `state = 'on-track'`.
- The hero renders **"On track to close inside your limits"** plus "No scored category is over or
  projecting over as of day 8 of 30", over $3,000 of unbudgeted discretionary spend.

Both sentences are true *under the module's definition* of "over" (`budgeted > 0 && actual >
budgeted`) and neither says so. The `withheld` panel does name the five categories directly below,
which is why this is a nit and not a block — but the hero is the thing this task exists to make the
first thing read.

The same branch is worse in `no-budget-basis`: there, "No scored category is over or projecting
over" is **vacuously** true by construction — every record has `budgeted <= 0`, so no record *can*
be over — and it is rendered as if it were a finding.

**Suggested repair, one line:** condition the sentence on `outlook.withheld.length`, e.g. append
"; N withheld for want of a budget". The ladder itself is spec-mandated and must not change.

---

## N41 — the coverage caveat counts a strictly wider set than the figures it caveats
**File:** `app/dashboard/page.tsx:169-181` (`getCoverage`) and `676-681` (the rendered sentence)
**Owner:** step 32 (it owns the confidence bound and will need the right denominator to compute a
share from).

`getCoverage` counts **every** transaction in the as-of month on a tracked, operational-landscape
account: income, `Transfers` (`exclude_from_budget = TRUE`), `fixed` and `variable-necessary`
categories, and transactions mapped to capital-landscape categories. The hero, the three lists and
`scoredCategoryCount` range over `isScoredCategory` — four conjuncts, on the demo seed **six**
categories of twenty-one.

The page then renders:

> Computed over {categorizedCount} categorized transactions this month

That sentence asserts the figures above it were computed over those N. They were not. On the demo
seed a September month has roughly forty operational-account transactions, of which roughly eighteen
sit on a scored category; the caveat reports forty. The error is in the reassuring direction: it
makes the basis look broader than it is.

The *shape* (two counts, no share, no threshold) is what SPEC.md Q3 mandated and is correctly
implemented, and the spec's own "Evidence required" section supplies this exact sentence — so the
spec is co-author here. The fix is the wording, or a coverage query scoped to the scored set, and
step 32 needs to decide which before it turns this into a percentage.

---

## N42 — coverage and actuals are scoped by two different `landscape` columns
**File:** `app/dashboard/page.tsx:141-181`
**Owner:** step 32, with N41.

`getCoverage` filters `a.landscape = 'operational'` — the **account's** landscape.
`getMonthlyActuals` has no landscape predicate at all; the landscape gate is applied later, in
`isTrackedCategory`, on the **category's** landscape. These are different columns on different
tables, and the two sets are not nested in either direction.

**Failure scenario.** A $2,000 vacation paid from a capital-landscape savings account (the seed has
one: `demo_sav_capex`) and mapped to `Travel` (operational, discretionary). The transaction reaches
`getMonthlyActuals`, feeds `Travel`'s `actual`, and can flip the hero to `breach` or `off-cycle`.
It is excluded from `getCoverage` by the account-landscape predicate, so the caveat's counts do not
include the single transaction that produced the verdict.

The reverse also holds: a transaction on an operational account mapped to a capital category
(`Home Improvement`, in the seed) is counted as "categorized" in the caveat while contributing
nothing to the outlook.

---

## N43 — an orphaned `mapped_category` is invisible in the outlook *and* counted as categorized
**File:** `app/dashboard/page.tsx:141-159`, `169-181`; `app/api/categories/route.ts:89-98`
**Owner:** a follow-up on the categories surface (same family as N1).

`transactions.mapped_category` is deliberately not a foreign key (`db/schema.sql:200-203`), and
`PATCH /api/categories` with a `name` runs a bare `UPDATE budget_categories SET name = $1` — it
does **not** remap the transactions that carry the old name.

**Failure scenario.** The owner renames "Dining Out" to "Restaurants".

- Every existing transaction still carries `mapped_category = 'Dining Out'`.
- `getMonthlyActuals` returns a `'Dining Out'` key. `toAdherenceInput` looks up `actuals.get(c.name)`
  = `actuals.get('Restaurants')` → `undefined` → every month zero-filled.
- "Restaurants" reports `actual: 0` against its $500 month, lands in `holding`, and the hero can
  read `on-track`.
- `getCoverage` counts those same transactions as **categorized** (`mapped_category IS NOT NULL`), so
  `uncategorizedCount` does not move and the interim caveat gives no warning at all.

A whole category's spend disappears from the verdict while the caveat says coverage is complete.
This is the one place where the count-shaped caveat is not merely imprecise (N41) but actively
silent about the case it exists to surface.

---

## N44 — "Tracked, not scored" is an unbounded, unsorted, unlabelled list
**File:** `app/dashboard/page.tsx:620`, `723-734`
**Owner:** a rendering follow-up.

```ts
const unscoredBreaches = outlook.findings.filter((f): f is BreachFinding => f.kind === 'breach' && !f.scored);
```

`detectAdherence` ranges over every tracked category × every supplied month, and the page supplies
every elapsed month. In September that is 9 months × ~9 unscored tracked categories on the demo
seed. Healthcare (budget $300/mo, seeded spend $90–$520), Home Maintenance ($500 vs $120–$780) and
Transport ($400 vs ~$275 plus a triannual service) each breach in a large fraction of months, so the
panel renders on the order of **20–30 rows** — the same category name repeated up to nine times —
inside a one-third-width card, with no cap, no ordering, and no year on the label
(`{MONTHS[f.month]} · over by {fmtCents(f.variance)}`).

It sits directly under a hero whose stated purpose is a *short named list*. Nothing is numerically
wrong; the rendering is.

---

## N45 — `ChronicUnderspendFinding` and `MonthOutlook.headline` are computed on every render and discarded
**File:** `app/dashboard/page.tsx:601, 620`
**Owner:** step 32 or a later surface task.

`monthOutlook` returns `findings` (both detector kinds) and `headline` (`ScoredHeadline`). The page
reads `findings` only through the `kind === 'breach' && !scored` filter above, and never reads
`headline` at all. Verified repo-wide: after this diff there is **no consumer anywhere** of
`kind: 'chronic-underspend'` outside `lib/domain/adherence.ts` and its own test.

That is P0.5-29's entire second detector — §5's "$500 budgeted, $120 drawn every month is a wrong
budget, not good behaviour", the argument that made the metric two-sided — computed on every
dashboard request and thrown away. Likewise `headline.breachCount` / `defectCount` /
`varianceRatio`, which P0.5-29a spent a cycle getting the scope of right.

Not a spec violation (the spec required none of them rendered), but it should be recorded rather
than rediscovered when someone asks where the adherence headline went.

---

## N46 — `comparableYtdDelta` is not year-to-date
**File:** `lib/domain/netWorth.ts:243-256`; `app/net-worth/page.tsx:78`
**Owner:** naming follow-up; the rendered copy is already honest.

The function takes the earliest snapshot **of all time** that carries `liabilitiesSecurityDeposits`,
with no year predicate anywhere — not in the function, and not in `getSnapshots`'s
`SELECT … FROM net_worth_snapshots ORDER BY snapshot_date`. The type is `YtdDelta`, the field is
`sinceDate`, the doc comment says "Year-to-date movement", and the page comment says "The
year-to-date movement".

**Failure scenario.** On 2026-01-05, with a comparable snapshot history beginning 2026-03-01 (the
P0-09a cutover), the card correctly reads "+$X since 2026-03-01". On **2028-01-05** it reads
"+$450,000 since 2026-03-01" — two years of growth under a name and a type that both say
year-to-date. Nothing on the rendered page lies, because it prints the baseline date; the
identifier does.

Pre-existing in shape (the incumbent's `getNetWorthHistory` had no year filter either and its
comment claimed "recorded this year"), and SPEC.md Q7 specified this exact behaviour. Rename, or
add a window, before anything else consumes `YtdDelta`.

---

## N47 — five `CURRENT_DATE` reads survive beside the single JS clock read
**File:** `app/dashboard/page.tsx:277, 290-292, 329, 333, 344-345`
**Owner:** whoever next touches the Today / This Week cards.

Acceptance #31 (`new Date(` → 1) and #33 (`EXTRACT(YEAR FROM CURRENT_DATE)` → 0) both hold, and
every *year-scoped* query now takes `asOf.year` as a bound parameter — a genuine improvement, and
the diff also **fixed** a real seam by moving `isoDow` from `new Date().getDay()` into
`EXTRACT(ISODOW FROM CURRENT_DATE)` inside the query that already filters on `CURRENT_DATE`.

What remains: `getTodayStats` and `getWeekStats` still resolve against Postgres's `CURRENT_DATE` —
the **database server's** calendar day — while the hero, the header and the two new month queries
resolve against the **Node process's** local calendar day. SPEC.md Q2's justification for choosing
local over UTC ("every other date predicate the page issues resolves against Postgres's
`CURRENT_DATE`, which is the database server's calendar day") is only sound when the two
processes agree about the day, which is an unstated deployment assumption, not a property of the
code.

Where they agree: `docker-compose.yml` runs `pgvector/pgvector:pg16` and `node:24-alpine` with no
`TZ`/`PGTZ` on either, so both are UTC and the assumption holds.

Where they do not: `npm run dev` on a developer machine against that same containerised Postgres.
Node reads the host's zone; Postgres reads UTC.

**Failure scenario.** 23:00 EDT on 30 April, `npm run dev` against the compose database.
`asOfFromDate(new Date())` → `{2026, 3, 30}`. The header reads "Apr 2026 · day 30 of 30" and the
hero's verdict is April's, correctly. `getTodayStats` queries `t.date = CURRENT_DATE` = `2026-05-01`
and shows $0 spent "today"; `getWeekStats` computes `date_trunc('week', CURRENT_DATE)` and
`EXTRACT(ISODOW …)` from May 1, so the week card's expected-spend denominator is one seventh too
large against a week window shifted a day. Two cards on one page disagree about what day it is.

This is narrower than the seam the diff removed (the incumbent had `new Date().getFullYear()` in
`getCashFlowSeries` against `EXTRACT(YEAR FROM CURRENT_DATE)` in five other queries, i.e. a
disagreement about the *year* between charts on one page). Recorded because the spec's stated
rationale is stronger than what the code can guarantee.

---

## N48 — `withoutNegativeZero` now couples the net-worth domain to the budget-adherence domain
**File:** `lib/domain/netWorth.ts:9`
**Owner:** trivial follow-up.

`lib/domain/netWorth.ts` now does `import { withoutNegativeZero } from './adherence'`. `roundCents`
comes from the neutral `lib/budgetMath`; `withoutNegativeZero` is an equally general numeric idiom
(`n === 0 ? 0 : n`) that happens to live in the adherence module because that is where it was first
needed. Importing it from there makes the net-worth domain depend on the budget-adherence domain
for a three-token function. Its natural home is `lib/budgetMath.ts` beside `roundCents`.

Not fixable in this diff — `adherence.ts` is byte-identical-frozen by acceptance #42.

---

## N49 — the frozen `SPEC.md` still carries Fixture H9's impossible input
**File:** `plan/tasks/P0.5-31-dashboard-repoint/SPEC.md:69`
**Owner:** orchestrator / spec-writer, before step 32's spec is written.

G2 adjudication A3 upheld the implementer's `300 → 100` substitution. I re-derived it independently
and confirm the ruling: `$300 / (8/30) = $1,125` against a `$500` month is `projectedVariance
+$625`, which is a `projected-breach`, so H9's own required `state: 'on-track'` is unreachable from
its own inputs. `$100 → $375 → −$125` is holding, and every other assertion H9 states is preserved.

The correction exists only in `GATES.md` (A3) and `EVIDENCE.md` (§6, §12/F1). `SPEC.md` is frozen
and still says `actual: 300`. SPEC.md's own §"Required fixture arithmetic" states the anchor is
"reused from P0.5-30's … so the two specs' arithmetic cross-checks", and step 32's spec-writer is
the next reader. An `ERRATA` block appended below the freeze line, or a pointer at H9 to the
adjudication, would stop it being re-derived wrong.

**On the process question — one-input substitution versus returning the spec to its author:** the
substitution was the right call. The error is arithmetic rather than intentional, the correct value
is uniquely determined by the fixture's own stated purpose, the implementer escalated instead of
absorbing, and the orchestrator verified with a discriminating command rather than accepting the
claim. Returning it would have cost a cycle for a value a `node -e` settles. The defect in the
handling is only that the record lives beside the spec instead of in it.

---

## N50 — `JOIN budget_categories ON bc.name = t.mapped_category` survives on the re-pointed page
**File:** `app/dashboard/page.tsx:71-72` (`getStats.ytd_spent`), `421` (`getCategoryBreakdown`),
`438` (`getBudgetVsActual`)
**Owner:** a follow-up; pre-existing, and out of this task's declared behavioural surface.

BUILD.md §10.3's named hazard, live. `budget_categories` is `UNIQUE(name, landscape)` and
`mapped_category` is not an FK, so one name defined in both landscapes joins twice.

**Failure scenario.** A category named `Home Improvement` exists in both `operational` and `capital`
(the seed has only the capital one, so this is latent, not live on demo data), both
non-excluded and non-income. Every transaction mapped to it is duplicated by the join, so
`ytd_spent` counts it twice and the **"Remaining"** KPI — one of only three cards left below the
hero — is understated by the full amount. `getCategoryBreakdown` renders the name as two donut
slices; `getBudgetVsActual` gives both landscape rows the full `spent`.

The diff only parameterised the year in these queries and changed no join, and the *new* query that
matters — `getMonthlyActuals` — correctly aggregates by `t.mapped_category` and resolves the map in
JS instead, with the reasoning written down at `app/dashboard/page.tsx:137-139`. Recorded so the
correct new one is not read as evidence that the old ones are fine.

---

## N51 — nothing in the application can write `control_mode`, so the new hero is inert on real data
**Files:** `app/categories/page.tsx:9`, `components/CategoryManager.tsx`,
`app/api/categories/route.ts` (POST at `:32`, PATCH at `:56-104`)
**Owner:** the orchestrator, as a phase-ordering decision. This is the enlargement of P0.5-28's
**N1**, which recorded only the type lie.

Repo-wide, `control_mode` appears outside `lib/domain/**` in exactly two places: the dashboard's new
`SELECT` (this diff) and the categories API's `GET` column list. **There is no `INSERT` and no
`UPDATE` of `control_mode` anywhere in `app/`, `components/` or `lib/`.** The only writers in the
repo are `migrations/…category-control-mode.sql`'s column `DEFAULT 'fixed'` (which the migration's
own comment notes backfilled every pre-existing row) and, as of this diff,
`scripts/seed-demo.mjs`.

**Consequence, on the owner's actual database.** Every category is `control_mode = 'fixed'`.
`isScoredCategory` admits none. `scoredCategoryCount` is `0`. The re-pointed dashboard's hero renders
`nothing-to-score`:

> **This month · 0 scored categories · Nothing to score yet**
> No category is classified as discretionary yet, so there is nothing behaviour can be scored on.
> **Classify your categories** to give this month a verdict.

and the "Classify your categories" link goes to `/categories`, whose own `SELECT`
(`app/categories/page.tsx:9`) does not even select `control_mode` and whose `CategoryManager` offers
no control for it. **The route out of the empty state is a dead end.**

This is not a defect in this diff. SPEC.md Q5 re-defers N1 explicitly and correctly, the module
handles the empty scored set exactly right (that is Fixture H2, the most heavily argued case in the
suite), and the page renders it exactly right. But it means Phase 0.5's headline surface ships
answering "nothing to score" on the only database that matters, and it should be a conscious
decision rather than a discovery. A control-mode editor is the natural immediate successor to step
31 — and it is also a precondition for the owner's screenshot capture being representative.
