# P0.5-31-dashboard-repoint — the dashboard answers a budget question first, and net worth is somewhere you go
**Roadmap item:** ROADMAP.md §5 Phase 0.5 step 31 — "Re-point the dashboard: budget adherence in, net worth out." Orchestrator's reading: `plan/tasks/P0.5-31-dashboard-repoint/ITEM.md`
**Status:** DRAFT
**Author:** spec-writer

## Goal

`app/dashboard/page.tsx` stops opening on a $2.9M net-worth hero and opens instead on the answer to **"will I close this month inside my limits, and which categories say no"** — a *state* drawn from a closed set of seven, and a *named list*, never a vanity percentage. The net-worth figure, its YTD delta, its sparkline and its four component links leave that page entirely and live at `/net-worth`, which the sidebar already links (`components/Sidebar.tsx:12`), so the figure is seen when it is sought.

The computation that produces the state and the list is **not written on the page**. A new pure module `lib/domain/monthOutlook.ts` exports

```
export function monthOutlook(rows: AdherenceInput[], asOf: AsOf, coverage: CategorizationCoverage): MonthOutlook
```

which is the **only** caller of `detectAdherence`, `scoredHeadline` and `categoryPacing` in the app, and which emits no money figure of its own: every `number` it reports other than counts is `Object.is`-identical to a field of the `CategoryPace`, `ScoredHeadline` or `AdherenceFinding` record it came from. The page becomes a query layer plus a renderer. It performs exactly **one** clock read, converts it through the module's own exported `asOfFromDate(now: Date): AsOf` (local calendar day, matching Postgres `CURRENT_DATE`), and passes plain integers downward.

Three consequences §5 binds into this diff rather than a follow-up:

1. **N2 is fixed where it lands.** The YTD delta relocates to `/net-worth` and stops straddling the P0-09a definition change: a new pure `comparableYtdDelta` in `lib/domain/netWorth.ts` measures from the earliest snapshot that carries `liabilities_security_deposits`, discloses how many older rows it skipped, and returns `null` — not `0` — when no comparable row exists.
2. **The incumbent pace defect dies.** `app/dashboard/page.tsx:356`'s `monthsElapsed = new Date().getMonth() + 1` — which calls 33.3% of the year elapsed on 1 April against a true 24.7%, inflating expected spend and flattering the pace — is removed along with the whole annual-pace card it feeds. The per-category month replaces it.
3. **The demo seed can render the new dashboard.** `scripts/seed-demo.mjs` writes `control_mode` for every category (P0.5-28 **N7**), so the scored set stops being empty by construction, and seeds at least one `monthly_amounts` schedule so an off-cycle breach is producible in demo data.

**Not in this diff, and stated as an owner handoff rather than absorbed:** the `docs/screenshots/*.jpg` images themselves. See Q6 below.

## Non-goals

- **No delivery, no outbound surface.** Step 33 owns email, the allowlist and the redaction boundary. No Nodemailer, no scheduler change, no `lib/scheduler.ts` edit.
- **No new adherence or pacing arithmetic.** `lib/domain/adherence.ts` and `lib/domain/pacing.ts` are **read-only inputs**. Neither file — nor `lib/domain/adherence.test.ts`, nor `lib/domain/pacing.test.ts` — may be edited by so much as a comment. Their 47 + 24 = 71 tests are the tripwire (acceptance #40–#42). A figure the dashboard needs that neither module produces is a finding to report in `EVIDENCE.md`, not a local calculation. `lib/domain/monthOutlook.ts` therefore contains **no `roundCents(`, no `Math.round(`, no `Math.abs(`, no `.toFixed(`, and no division by 12 or `MONTHS_PER_YEAR`** (acceptance #26, #27).
- **No confidence bound and no refusal to render.** Step 32 owns "computed over 96% of operational spend" and the threshold below which the figure refuses to be authoritative. This task ships a *count* of uncategorized transactions in the as-of month as a mandatory, unconditional caveat (Q3), and must not claim it is a share of spend, must not compute a percentage of spend, and must not suppress the hero below any threshold.
- **No auth, no API v1, no `packages/contracts`.** Phase 1, still blocked.
- **No contract change.** No migration, no `db/schema.sql` edit, no `shared/types.ts` edit. Every column needed exists, including `liabilities_security_deposits` (`db/schema.sql:316`). G1 is skipped. If the implementer finds a contract change genuinely required, that is a loud finding, not something to absorb.
- **No edit to any existing file under `components/`.** New components may be added; tracked ones are byte-identical (acceptance #46). In particular `components/Sidebar.tsx` is untouched — `/net-worth` is already in its nav — and `components/Nav.tsx` is dead code (no importer anywhere; verified) and stays dead.
- **No `docs/screenshots/**` change in this diff** (acceptance #38). See Q6.
- **No component-test toolchain.** No `@testing-library/*`, no `jsdom`, no `happy-dom`, no `playwright`, no change to `vitest.config.mts`. See Q1 for why, and for what is used instead.
- **No `try`/`catch` in `lib/domain/monthOutlook.ts`** (acceptance #29). P0.5-30's [[N34]] names the exact hazard: catching `categoryPacing`'s `RangeError` to render `detectAdherence`'s output anyway swallows the only loud signal in the system and ships the confidently-wrong sibling number alone.
- **No second even-spread implementation and no migration of the four incumbents.** N19 is inherited unchanged: `components/BudgetMonthlyGrid.tsx`, its client, `app/budget/page.tsx` and the chat route keep their own copies.
- **No `lib/budgetColors.ts` coupling on the hero path.** `monthPct` answers `Infinity` for exactly the off-cycle case this task must render as a dollar figure with no percentage. Neither the new module nor the re-pointed dashboard calls it (acceptance #24, #34).

## Contracts touched

| File | Change | Class (§9.2) |
|---|---|---|
| *(none)* | — | — |

`lib/domain/**` is not the contract surface (BUILD.md §2) — it is the same class as `drift.ts`, `propertyPnl.ts`, `adherence.ts` and `pacing.ts`. Every column read already exists: `budget_categories.{id,name,annual_budget,landscape,exclude_from_budget,is_income,control_mode,monthly_amounts}`, `transactions.{date,amount,hidden,mapped_category,account_id}`, `accounts.{track_transactions,landscape}`, and `net_worth_snapshots.{snapshot_date,total,liabilities_security_deposits}`. `CategorizationCoverage`, `MonthOutlook`, `OutlookState`, `OutlookCategory`, `SnapshotPoint` and `YtdDelta` are new **domain** types with no place in `shared/types.ts`: nothing crosses a process boundary here.

## The seven open questions, decided

### Q1 — how a page change is gated: **extract the computation, and say plainly what is left ungated**

**Decided: shape (a) — extraction — plus an explicit, written admission that the visual layer carries weaker evidence, with the strongest static proxies available attached to it. Shape (b) is rejected on a technical ground, not a taste one.**

**Why not (b), a component-test toolchain.** `app/dashboard/page.tsx` is an `async` server component with `export const dynamic = 'force-dynamic'` that issues its own SQL through `@/lib/db`. Rendering it under jsdom + RTL requires either a live Postgres (which `vitest.config.mts` deliberately excludes — "everything under test here is a pure function with no DB or network dependency") or a mock of `@/lib/db`. A mocked-DB render tests the mock's fixture and the JSX, and the JSX is the half least likely to be wrong; the SQL and the arithmetic — the two halves that have shipped three P&L bugs in this repo — are exactly what the mock replaces. So the toolchain would cost a dependency, an `environment` change and a per-test DB decision, and would buy evidence about the cheapest layer. That is not "more than convenience", which is the bar ITEM.md set.

**Why (a) works here.** The interesting half of this page is a *state machine over a closed set of seven states with a total precedence order*, plus a *partition of the scored categories into three named lists*. That is a pure function of `(rows, asOf, coverage)`. Extracted into `lib/domain/monthOutlook.ts` it is exhaustively testable in the existing `environment: 'node'` suite, it satisfies BUILD.md §7.5's G4 rule ("no surface computes a shared concept independently of `lib/netWorth.ts` / `lib/domain/`") which the incumbent page is already in tension with, and it matches steps 28–30 conjunct for conjunct.

**What is therefore gated, mechanically:**

- the state ladder, every rung and every adjacent-pair precedence (acceptance #6–#13);
- the three-way partition and its totality (acceptance #15);
- that no emitted money figure is a recomputation (acceptance #14, and the `Object.is` identity assertions in Fixture H10);
- that the page no longer computes: it calls `monthOutlook` and **not one of** `detectAdherence`, `scoredHeadline` or `categoryPacing` (acceptance #35), and contains none of the incumbent's pace identifiers (acceptance #32);
- that net worth is gone from the page by name, in every casing and both the SQL and the JSX spellings (acceptance #30);
- that exactly one clock read exists on the page (acceptance #31).

**What is NOT gated, stated out loud rather than dressed up:** *that the hero renders above everything else in the browser.* No command in this spec proves a DOM order. The best available proxy is source order in a server component that returns one tree, and it is used: acceptance #36 asserts that the **first** `data-testid` in `app/dashboard/page.tsx` is `data-testid="month-outlook-hero"`. This holds only because the page must emit the hero's `data-testid` on its own wrapper element (a component may fill the inside) and must define no helper carrying a `data-testid` above the default export. That is a real constraint, checked literally — and it is still a proxy. A reviewer who wants certainty must open the page. **This limitation is to be repeated verbatim in `EVIDENCE.md`; it must not be described anywhere as "the hero position is tested."**

### Q2 — where the clock lives: **one `new Date()` on the page, converted by a tested pure function, in local calendar time**

`categoryPacing` takes an explicit `AsOf` and reads no clock by design (P0.5-30 acceptance #26). Step 31 is the caller that owns the read. The decision, stated as observable behaviour:

- `app/dashboard/page.tsx` contains **exactly one** occurrence of `new Date(` and **zero** of `Date.now(` (acceptance #31). Today it holds seven.
- That `Date` is converted by `asOfFromDate(now: Date): AsOf`, exported from `lib/domain/monthOutlook.ts`, using `now.getFullYear()`, `now.getMonth()`, `now.getDate()` — the **local** getters, exactly three of them, and no `getUTC*` and no `toISOString` (acceptance #28).
- **Why local and not UTC.** Every other date predicate the page issues resolves against Postgres's `CURRENT_DATE`, which is the database server's calendar day. A `toISOString().slice(0,10)` read is UTC, which is the *previous* day for every hour before the offset in a negative-offset zone — so on those hours the hero would be scored against a different day than the SQL beside it filtered on. One clock, one calendar, one day.
- **The year travels with it.** `app/dashboard/page.tsx` must contain **zero** occurrences of `EXTRACT(YEAR FROM CURRENT_DATE)` (acceptance #33); today it holds five. Every year-scoped query on the re-pointed page takes `asOf.year` as a bound parameter, so the single clock read governs both the SQL and the module and the two cannot straddle a New Year boundary in opposite directions.
- The `AsOf` is carried onto the output (`MonthOutlook.asOf`) so a renderer cannot print a projection without the day it was projected from — and the page must actually render it: `elapsedDays` and `daysInMonth` both appear in `app/dashboard/page.tsx` (acceptance #37).

**A deterministic test still reaches the code path** because nothing below `asOfFromDate` reads a clock: every fixture in `lib/domain/monthOutlook.test.ts` passes a literal `AsOf`. `asOfFromDate` itself is pinned by Fixture H11 against `Date`s constructed from **local** components (so the assertion is timezone-independent), and the local-vs-UTC discrimination is enforced **statically** by acceptance #28 rather than dynamically. This is stated rather than glossed: in a UTC CI a UTC implementation would pass Fixture H11, which is precisely why the grep is the gate and the fixture is the contract.

### Q3 — the hero with nothing to score, and the interim caveat step 32 has not shipped

**`OutlookState` is a closed set of seven, and "nothing to score" is one of them.** The demo dataset is exactly this case today, so it is the first state to get right, not a corner:

| # | `state` | Fires when (over the scored set's **as-of-month** records) |
|---|---|---|
| 1 | `nothing-to-score` | no row in `rows` satisfies `isScoredCategory` — equivalently `scoredHeadline(rows)` is `null` |
| 2 | `off-cycle` | ≥1 record with `status === 'off-cycle'` |
| 3 | `breach` | ≥1 record with `budgeted > 0` **and** `actual > budgeted` |
| 4 | `projected-breach` | ≥1 record with `status === 'projected'`, `budgeted > 0` and `projectedVariance > 0` |
| 5 | `too-early` | ≥1 record with `status === 'too-early'` |
| 6 | `no-budget-basis` | **every** record has `budgeted <= 0` |
| 7 | `on-track` | none of the above |

**The order is total and each adjacent pair is separately gated** (P0.5-30's [[N31]] is the recorded cost of an ungated ladder). Three rungs earn their position:

- **`off-cycle` above `breach`**, because an off-cycle record has `budgeted === 0` and `actual > 0` and therefore *also* satisfies `actual > budgeted`. §5 elevates it as "a breach in its own right", and the two must not collapse. Fixture H3.
- **`breach` above `projected-breach`**, because a fact outranks a projection: a category already over its month is over whatever the multiplier says. Fixture H4.
- **`too-early` above `on-track`**, because a month too young to project has no basis for "you are holding". Rendering green there is the N12 failure one level up. Fixture H5.
- **`breach` requires `budgeted > 0`.** A category with nothing budgeted that drew $275 is *not* a breach — it is a category nobody has budgeted, and calling it a breach teaches the owner to ignore the word. Fixture H6 is the negative control, and it is the single most likely thing to get wrong.

**Nothing-to-score is never dressed as anything else.** In state `nothing-to-score`: `sayingNo`, `holding`, `withheld` and `offCycleElsewhere` are all `[]`, `scoredCategoryCount` is `0`, and `headline` is `null`. `findings` is **not** empty — `detectAdherence` ranges over `isTrackedCategory` (three conjuncts), so a `fixed` mortgage line drawing over its budget still produces a breach finding, which is §5's "tracked and reported, never scored" made observable. The page must render this state as a named cause with a route out (classify categories at `/categories`), never as a zero, never as a dash next to a green tick, and never as "on track". Fixture H2.

**The interim caveat — decided: yes, carry one, and make it structural.** §5 orders 31 before 32, so for one step the dashboard shows an adherence state with no stated share of spend behind it, in a phase whose thesis is not shipping confidently wrong numbers. Revisiting the ordering was considered and rejected: step 32's threshold and refusal-to-render need a surface to refuse *on*, so it cannot precede 31 without inventing one. Instead:

- `CategorizationCoverage` is a **required third parameter** of `monthOutlook`. It cannot be omitted — acceptance #25 pairs a `@ts-expect-error` on a two-argument call with `npx tsc --noEmit`, so an optional parameter makes the directive unused and fails TS2578 (verified: exit 2).
- Its two fields are counts, not shares: `uncategorizedCount` and `categorizedCount`, both over **the as-of month**, on tracked accounts, not hidden, on `operational`-landscape accounts (the landscape the scored set lives in). Acceptance #39 checks the landscape predicate is in the page's SQL.
- It is carried onto `MonthOutlook.coverage` unchanged (`toBe`, not `toEqual` on recomputed values) and rendered unconditionally at `data-testid="coverage-caveat"` (acceptance #23, #36c).
- **This is a count and must be described as one.** No percentage of spend, no threshold, no suppression. Those are step 32's, and a spec that quietly half-ships them makes step 32 a refactor instead of a feature.

### Q4 — the incumbent pace defect: **removed, not repaired in place**

`app/dashboard/page.tsx:356-360` computes `monthsElapsed = new Date().getMonth() + 1`, `pctYear`, `expectedYearSpend` and `yearPacePct`, and renders them as the "Year Pace" bar, the "This Year" card's subtitle and the header pill. It treats the current month as fully elapsed — 4/12 on 1 April against a true 24.7% — which over-counts expected spend and therefore *flatters* the pace, and it sits eleven lines above `expectedWeekSpend`, which is day-granular. The two conventions have coexisted in one component.

**The whole family is deleted**, not fixed: `monthsElapsed`, `pctYear`, `expectedYearSpend`, `yearPacePct` and the `getMonth() + 1` idiom must not appear in `app/dashboard/page.tsx` (acceptance #32; today the family greps to 14). The annual-budget pace is the net-worth-era furniture the phase exists to replace, and §5's supporting-card list does not include it. **If the implementer chooses to keep a year-elapsed figure at all, it must be day-granular and produced by a pure tested function — not by `getMonth()`** — and it still may not use any of those four identifiers. Deleting a defective flattering figure and replacing it with the per-category month is the strictly better of the two, and it is what "the question it answers first is a budget question" asks for.

### Q5 — inherited nits: what this step discharges, and what it re-defers

**Discharged here**, each with an acceptance command:

| Nit | Source | How it is discharged |
|---|---|---|
| **N7** | P0.5-28 | `scripts/seed-demo.mjs` writes an explicit `control_mode` for every category; the scored set is non-empty and plural in demo data. #47–#51 |
| **N26** | P0.5-29a | `monthOutlook` throws `RangeError` on a duplicate `categoryId` in `rows` — the caller contract "one entry per category" is enforced, not stated. Fixture H7a, #18 |
| **N29** | P0.5-29a | `monthOutlook` throws `RangeError` on a non-finite `annual_budget`, `monthly_amounts` entry or `actual` — the "money fields are finite" half of the same sentence. Fixture H7c, #20 |
| **N20** | P0.5-29 | `monthOutlook` throws `RangeError` when any money field is not `typeof 'number'` — a `NUMERIC` column arriving as a string. Fixture H7e, #22 |
| **N18** | P0.5-29 | `monthOutlook` throws `RangeError` on a duplicate `month` within one row. Fixture H7b, #19 |
| **N35** | P0.5-30 | `monthOutlook` throws `RangeError` on a negative `actual`, which is the precondition `projected >= actual` silently rests on. Fixture H7d, #21 |
| **N15 / N33 / N34** | P0.5-29 / P0.5-30 | the month index is normalised at the SQL boundary (`EXTRACT(MONTH FROM t.date)::int - 1`, #34) **and** validated in `monthOutlook` **before** either domain function is called (#17), so `detectAdherence` can never silently price a row that makes `categoryPacing` throw; and the module contains no `try`/`catch`, so the `RangeError` is never swallowed to render the sibling's number (#29) |
| **N32** | P0.5-30 | only records whose `month === asOf.month` reach `sayingNo` / `holding` / `withheld`, so "250% of December" can never sit in a column under April's 71%; and every list item carries `status`, so no renderer can bind one column across statuses. Fixture H9, #16 |
| **N31 (its failure scenario)** | P0.5-30 | months after `asOf.month` are rejected outright (#17, Fixture H12), so the ladder rung the ungated precedence would mis-order is unreachable from this caller; and off-cycle in an *earlier elapsed* month is reported in its own `offCycleElsewhere` list rather than filed under a calendar status. Fixture H8, #16b |
| **N37 (its cheap half)** | P0.5-30 | the headline state ranges over `scored` records only — [[N37]]'s own prescribed mitigation — and every `OutlookCategory` carries `controlMode`, which [[N37]] noted "would cost nothing and is the cheapest place to put it". #14 |
| **N2** | P0-09a | fixed at its new home: `comparableYtdDelta` in `lib/domain/netWorth.ts`, tested, consumed by `/net-worth`. #43–#45, #52–#55 |

**Re-deferred, with the reason stated so it is not rediscovered:**

| Nit | Why not here |
|---|---|
| **N21** | Its durable fix is a `CHECK (annual_budget >= 0)` migration plus the missing `POST /api/categories` guard — a contract change, which re-opens G1 and takes a lease. This task instead **withholds** such a row (`withheldReason: 'negative-budget'`) rather than throwing: the schema permits a negative budget, and a dashboard that 500s on a legal row is worse than one that names it and moves on. Fixture H7f pins that it does **not** throw. The migration remains owed. |
| **N30, N36, N39** | Internal to `lib/domain/pacing.ts`, which this task may not edit at all (#42). |
| **N31 (the gate gap itself)** | Closing it means adding fixtures to `lib/domain/pacing.test.ts`, which would destroy the "24 tests, byte-identical" tripwire property this task depends on (#41, #42). Its *failure scenario* is covered here; the gap in that suite is a one-fixture follow-up. |
| **N38** | `scripts/seed-demo.mjs` is `.mjs` and cannot import the TypeScript `daysInMonth`. Its clock-based `lastDay` stays where it sits. |
| **N25, N28, N23** | Comment-level debts inside `lib/domain/adherence.ts`, which this task may not edit (#42). |
| **N1** | `app/categories/page.tsx` is outside the declared surface. Note that the *dashboard's* own query must select `control_mode` (#35b) or every category reads as `fixed` and the hero silently returns to `nothing-to-score` — the same defect one page over, and the reason that grep exists. |
| **N19, N24, N5, N6, N8** | Unchanged; none is reachable from this diff. |

**One new debt is created deliberately and recorded here rather than discovered at review.** The page's per-category month actual is `SUM(t.amount) FILTER (WHERE t.amount > 0)` — positive magnitudes only, refunds excluded — because `MonthSpend.actual` is contractually a non-negative magnitude and [[N35]] established that a negative one inverts the projection. `components/BudgetMonthlyGrid.tsx:66-72` **nets** refunds into the same concept. The two therefore disagree for any month containing a return, and this task takes the filtered form knowingly. It is a real divergence, it is not resolved here, and it belongs in `NITS.md` as a follow-up.

### Q6 — screenshots: **the owner captures; the agent performs nothing destructive**

README §77 documents the process as: back up the database, load synthetic data, capture, restore. Against the `DATABASE_URL` in `.env.local` that is a `TRUNCATE` of a database holding real financial data followed by a `DROP SCHEMA public CASCADE`, which is BUILD.md §5.1's human escalation on its face.

**Decision, and it deliberately splits §5's "part of this step's diff":**

- **In this diff, by the implementer:** the `scripts/seed-demo.mjs` change (N7 plus one `monthly_amounts` schedule), and the `README.md` caption change, because those are the reproducible half and a stale caption is a false claim shipped in text. Acceptance #47–#51 and #56–#57.
- **Not in this diff, by anyone:** running `npm run seed:demo`, running `pg_dump`, `pg_restore` or `DROP SCHEMA` against any database that is not a throwaway, and touching `docs/screenshots/**`. Acceptance #38 asserts the image files are untouched, so nobody can quietly half-do it.
- **Optional, and safe:** the implementer *may* run the README's own scratch-database path (`createdb b8_demo && DATABASE_URL=postgresql://localhost/b8_demo …`) to produce the Evidence item proving the seeded scored set is non-empty. It touches no real data. If Postgres is unavailable the static evidence in #47–#51 stands alone and the Evidence item is marked not-run with that reason. It is **not** a toolchain prerequisite of any acceptance command (T11).
- **The handoff is recorded as a task-blocking owner action**, not a nit: this task is not *complete* until the owner regenerates `docs/screenshots/dashboard.jpg` and `net-worth.jpg` and commits them. It is *mergeable* before that, because a stale image beside a corrected caption is a smaller lie than a corrected image beside a stale caption, and the escalation is the owner's to schedule.

**This is a plain contradiction with §5's text**, which says the screenshot set is "part of this step's diff, not a follow-up". It is resolved in favour of BUILD.md §5.1 and flagged for the orchestrator rather than papered over.

### Q7 — the shape, stated as signature-level fact

```
export interface CategorizationCoverage {
  uncategorizedCount: number;   // as-of month, tracked accounts, not hidden, operational landscape
  categorizedCount: number;     // same predicates, mapped_category IS NOT NULL
}

export type OutlookState =
  | 'nothing-to-score' | 'off-cycle' | 'breach' | 'projected-breach'
  | 'too-early' | 'no-budget-basis' | 'on-track';

export type SayingNoReason  = 'off-cycle' | 'breach' | 'projected-breach';
export type WithheldReason  = 'too-early' | 'no-budget' | 'negative-budget';

export interface OutlookCategory {
  categoryId: number;
  category: string;
  controlMode: ControlMode;           // N37's cheapest mitigation
  status: PaceStatus;                 // carried, per N32 — never rendered without it
  month: number;                      // always asOf.month for the three partition lists
  elapsedDays: number;
  daysInMonth: number;
  budgeted: number;
  actual: number;
  spentRatio: number | null;
  projected: number | null;
  projectedVariance: number | null;
  projectedRatio: number | null;
  reason: SayingNoReason | null;      // non-null iff the record is in sayingNo
  withheldReason: WithheldReason | null;  // non-null iff the record is in withheld
}

export interface MonthOutlook {
  asOf: AsOf;
  state: OutlookState;
  scoredCategoryCount: number;
  sayingNo: OutlookCategory[];          // ordered: reason precedence, then projectedVariance desc, then categoryId asc
  holding: OutlookCategory[];           // ordered: projectedVariance asc, then categoryId asc
  withheld: OutlookCategory[];          // ordered: categoryId asc
  offCycleElsewhere: OutlookCategory[]; // scored off-cycle records in elapsed months other than asOf.month
  headline: ScoredHeadline | null;      // scoredHeadline(rows), verbatim
  findings: AdherenceFinding[];         // detectAdherence(rows), verbatim
  coverage: CategorizationCoverage;     // the caller's, verbatim
}

export function asOfFromDate(now: Date): AsOf;
export function monthOutlook(rows: AdherenceInput[], asOf: AsOf, coverage: CategorizationCoverage): MonthOutlook;
```

And in `lib/domain/netWorth.ts`, additive:

```
export interface SnapshotPoint {
  date: string;                              // ISO 'YYYY-MM-DD', from snapshot_date::text
  total: number;
  liabilitiesSecurityDeposits: number | null; // null = pre-cutover, not comparable
}
export interface YtdDelta {
  delta: number;                    // roundCents(current - baseline.total); positive means net worth grew
  sinceDate: string;                // the baseline's ISO date
  comparableSnapshotCount: number;  // >= 1 by construction
  excludedPreCutoverCount: number;  // how many older rows were skipped, so the window can be disclosed
}
export function comparableYtdDelta(current: number, snapshots: SnapshotPoint[]): YtdDelta | null;
```

Comparators used for ordering are permitted; they are not emitted figures. **Every `number` on `MonthOutlook` other than `scoredCategoryCount` and `coverage`'s two counts must be `Object.is`-identical to the field of the `CategoryPace` / `ScoredHeadline` / `AdherenceFinding` record it came from** (Fixture H10, acceptance #14).

## Conventions this task must honor

- **Sign.**
  - `MonthSpend.actual` is a **non-negative magnitude**, not the ledger's signed convention. Plaid's convention, which this app keeps (`scripts/seed-demo.mjs:191`), is **positive = money out**. The page's per-month aggregate is therefore `COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)` — positive expense rows only. A negative `actual` reaching `monthOutlook` is a `RangeError` (Fixture H7d).
  - `projectedVariance` and `ScoredHeadline.variance` are `projected − budgeted` / `actual − budgeted`, in that order. **Negative is UNDER budget, positive is OVER.** The outlook never re-derives, negates, `Math.abs`es or reciprocates either; it reads the direction off the sign it was handed.
  - `projectedRatio` is a **fraction of budget**: `2.6625` reads "266.25% of budget", i.e. 166.25% over. A renderer that wants "over" subtracts one and owns that. The module never emits `1 − projectedRatio`.
  - `comparableYtdDelta` is **`current − baseline.total`**, in that order. Positive means net worth grew. `baseline − current` produces an equally plausible dollar figure whose only symptom is that growth reads as loss.
  - `liabilities_security_deposits` is stored **signed as it contributes** (`<= 0`, `db/schema.sql:310`). `comparableYtdDelta` never reads its value — only whether it is `null` — so no sign question arises there, and no magnitude/signed mixing is possible.
- **Rounding.** The outlook module rounds **nothing**: every money figure it emits was already cent-rounded per step by `pacing.ts` / `adherence.ts`, and re-rounding a rounded figure is how two surfaces come to disagree by a cent. `comparableYtdDelta` rounds **once, at the subtraction** — `roundCents(current − baseline.total)` — because it is one difference of two figures that are each already cent-quantized, and the residue is real: `2930000.11 − 2880000.33` is `49999.779999999795` in IEEE-754. Ratios are never rounded anywhere; cent-rounding a percentage quantizes it into 1% steps (P0.5-29a pinned this as a category error).
- **Landscape + exclusions.**
  - A category reaches the outlook's lists only through `isTrackedCategory` (`landscape = 'operational'` AND `exclude_from_budget = FALSE` AND `is_income = FALSE`), and is `scored` only with the fourth conjunct `control_mode = 'discretionary'`. Both predicates come from `adherence.ts` by import; neither is re-expressed as an inline filter.
  - `MonthOutlook.state`, `sayingNo`, `holding`, `withheld`, `offCycleElsewhere` and `scoredCategoryCount` range over **scored** rows only. `findings` and `headline` keep the ranges their own modules define (`isTrackedCategory` and `isScoredCategory` respectively) — the "tracked and reported, never scored" split, preserved rather than flattened.
  - The page's transaction predicates: `t.hidden = FALSE` and `a.track_transactions = TRUE` on every aggregate, and `a.landscape = 'operational'` on the coverage counts. Omitting `track_transactions` is how an untracked account's rows once entered a budget total; omitting the landscape scope on coverage would caveat an operational figure with capital-side noise.
  - `/net-worth` keeps `computeCurrentNetWorth`'s existing exclusions unchanged; this task adds a delta, not a definition.
- **Null semantics.**
  - `comparableYtdDelta` returns **`null`, never `0`**, when no snapshot carries the decomposition. `0` would assert "net worth did not move"; `null` says "there is no comparable earlier reading", and the page renders the existing "First recorded reading" copy rather than a zero. This is BUILD.md §10.3's rule and it is the exact shape of the bug being fixed.
  - `MonthOutlook.headline` is `null` **iff** no row is scored — and `state` is then `nothing-to-score`. "The budget was followed perfectly" (a real `ScoredHeadline` at variance `0`, `state: 'on-track'`) and "there is nothing to score" are different statements and must render as different things.
  - `spentRatio`, `projected`, `projectedVariance` and `projectedRatio` are `null` exactly where `pacing.ts` made them `null`; the outlook copies, never substitutes `0`, and never invents `Infinity` or `NaN`.
  - `withheldReason` is non-null iff the record is in `withheld`; `reason` is non-null iff the record is in `sayingNo`. Both are `null` for `holding`.
- **Negative zero.** The outlook emits no arithmetic of its own, so it introduces no new `-0` path; the `withoutNegativeZero`-normalised values arrive already normalised. It must not undo that: no `-x`, no `0 - x`, no `Math.abs` anywhere in the module (acceptance #26). `comparableYtdDelta` **does** create one: `roundCents(current − baseline.total)` for two equal totals can yield `-0` through `Math.round(-0.something-tiny)`. It normalises through the same imported idiom, and Fixture N6 asserts `Object.is(delta, -0) === false` on a path that reaches it.

## Toolchain prerequisites

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `node_modules`, vitest v4, typescript present | **yes** | `npm ci` | `test -d node_modules/vitest && test -d node_modules/typescript && echo OK` | `OK` (spec-writer, 2026-09-02) |
| T2 | **The tree is free of Finder/iCloud `" 2."` duplicates.** `.next/types/routes.d 2.ts` and `.next/types/cache-life.d 2.ts` are inside the tsc program and make `npx tsc --noEmit` exit `2` with TS6200/TS2300 **on the clean tree right now** | **yes** — acceptance #1 and the two scope commands fail otherwise | delete them; all 26 are untracked or generated (`git status --porcelain` and `.gitignore:17`) — `find . -path ./node_modules -prune -o -name "* 2.*" -print -delete` | `find . -path ./node_modules -prune -o -name "* 2.*" -print \| wc -l \| tr -d ' '` | **`26`** (spec-writer, 2026-09-02) — **must be `0` before G0 passes.** This is P0.5-30's T8 recurring at larger scale |
| T3 | Clean baseline: whole suite green, lint at 0 errors | **yes** | working tree at `39c939c`, after T2 | `npx vitest run 2>&1 \| tail -4; npm run lint 2>&1 \| tail -2` | `Test Files 20 passed (20)`, `Tests 369 passed (369)`, `✖ 1 problem (0 errors, 1 warning)` (spec-writer, 2026-09-02) |
| T4 | `npx tsc --noEmit` exits 0 | **yes** | after T2 | `npx tsc --noEmit; echo "exit=$?"` | `exit=2` **before** T2 (TS6200/TS2300 from `.next/types/*.d 2.ts`); must be `exit=0` after |
| T5 | The tripwire counts are exactly 47 / 24 / 25 today | **yes** — "unchanged" is meaningless without a measured baseline | branch state | `for f in adherence pacing netWorth; do npx vitest run --pool=threads --reporter=verbose lib/domain/$f.test.ts 2>&1 \| grep -cE "✓ lib/domain/$f\.test\.ts"; done` | `47`, `24`, `25` (spec-writer) |
| T6 | `lib/**/*.test.ts` is a vitest include glob, so `lib/domain/monthOutlook.test.ts` is collected at all | **yes** — a file outside the globs is silently uncollected and #5 reports `0` | `vitest.config.mts` | `grep -cF "lib/**/*.test.ts" vitest.config.mts` | `1` (spec-writer) |
| T7 | vitest v4 prints `Tests  N passed (N)` with no skipped segment only when nothing was skipped — load-bearing for #2, which turns every name-grep from "the test exists" into "the test passed" (P0.5-28 [[N6]]) | **yes** | carried from P0.5-29a T5, re-verified | `npx vitest run 2>&1 \| grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"` | `1` (spec-writer) |
| T8 | An unused `@ts-expect-error` is a hard error (TS2578), so #25 discriminates a required third parameter from an optional one | **yes** — load-bearing for #25 | `tsconfig.json` `"strict": true` | scratch file with `// @ts-expect-error` over a legal call → `./node_modules/.bin/tsc --noEmit --strict --skipLibCheck <file>` | `error TS2578: Unused '@ts-expect-error' directive.`, exit `2` (spec-writer, verified by experiment 2026-09-02) |
| T9 | `npm test`, `npm run lint`, `npm run build` exist with these names | **yes** | `package.json` | `grep -cE '"(test\|lint\|build)": "' package.json` | `3` (spec-writer) |
| T10 | The one pre-existing lint warning is `scripts/seed-demo.mjs:438` (`'pid' is assigned a value but never used`), in the net-worth-recomputation block — far from the category table this task edits — so #3's expectation is stable across the seed edit | **yes** | branch state | `npm run lint 2>&1 \| grep -c "scripts/seed-demo.mjs"` | `1` (spec-writer) |
| T11 | Postgres / a demo database | **NO** — every acceptance command is a pure-function test or a static grep. Needed only for the *optional* seeded-scored-set evidence item (Q6), via the README's scratch-DB path | n/a | n/a | n/a |
| T12 | `npm run build` needs no database | **yes** — #4 would otherwise be non-deterministic | both pages carry `export const dynamic = 'force-dynamic'`, so nothing prerenders | `grep -c "export const dynamic = 'force-dynamic'" app/dashboard/page.tsx app/net-worth/page.tsx` | `1` each (spec-writer); baseline build already compiles (orchestrator) |
| T13 | Plaid credentials, network | **NO** | n/a | n/a | n/a |
| T14 | `grep -cF` matches the long test names as the verbose reporter emits them | **yes** | carried from P0.5-30 T10 | any one of #6–#24 run against the delivered suite | pending (implementer) |

**No test name in #6–#24 or #43–#45 contains a `$`, a backtick, a `!`, or a `|`** — dollar amounts are written as bare numbers or the word "percent"/"dollars" — so every pattern is safe inside the double quotes the commands use.

## Acceptance commands

`…` abbreviates `npx vitest run --pool=threads --reporter=verbose lib/domain/monthOutlook.test.ts 2>&1`, and `≈` abbreviates `npx vitest run --pool=threads --reporter=verbose lib/domain/netWorth.test.ts 2>&1`. All commands run from the repo root.

> **Pipe-escaping convention, repeated because it has cost this queue a G0 failure twice.** Inside a Markdown table cell `\|` renders as one literal `|`, which inside an ERE is a **literal pipe, not alternation** — `grep -cE 'a\|b'` matches nothing and enforces nothing. Every regex-bearing command is repeated verbatim and unescaped in the code block below the table, and **that block is authoritative** if the two ever disagree.

| # | Command | Expected |
|---|---|---|
| 1 | `npx tsc --noEmit; echo "exit=$?"` | `exit=0` (requires T2) |
| 2 | `npm test 2>&1 \| grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"` | `1` — whole repo green, nothing skipped |
| 3 | `npm run lint 2>&1 \| tail -2` | `✖ 1 problem (0 errors, 1 warning)` — the pre-existing `scripts/seed-demo.mjs:438` warning and no other |
| 4 | `npm run build > /tmp/p31-build.log 2>&1; echo "exit=$?"` | `exit=0` — the re-pointed pages compile in a production build |
| 5 | `test $(… \| grep -cE "✓ lib/domain/monthOutlook\.test\.ts") -ge 20 && echo OK` | `OK` — at least the 20 named cases below |
| 6 | `… \| grep -cF "the roadmap's day-8-of-30 sentence becomes a hero state and a named list, so a category projecting to close at 266.25 percent of its month is the one saying no while the one projecting at 81.25 percent is holding"` | `1` — **the binding numeric case** |
| 7 | `… \| grep -cF "an empty scored set renders nothing to score rather than on track, and the tracked-but-unscored categories still produce adherence findings beside it"` | `1` — **the demo dataset's own case** |
| 8 | `… \| grep -cF "off-cycle spend outranks every other verdict, so a scheduled category drawing outside its window says off-cycle rather than breach"` | `1` |
| 9 | `… \| grep -cF "a category already over its month budget says breach rather than projected breach, because a fact outranks a projection"` | `1` |
| 10 | `… \| grep -cF "a month too young to project withholds the verdict instead of claiming the budget is being held"` | `1` |
| 11 | `… \| grep -cF "a category with nothing budgeted this month is withheld rather than reported as a breach for spending against no budget"` | `1` |
| 12 | `… \| grep -cF "a negative annual budget is withheld with its own reason rather than reported as a projected breach on an inverted percentage"` | `1` |
| 13 | `… \| grep -cF "two categories both holding under their projections report on track, and one of them slipping over flips the state without touching the other"` | `1` |
| 14 | `… \| grep -cF "every emitted money figure is the identical value the pacing module produced, never a re-rounded or re-derived copy of it"` | `1` — **the no-new-arithmetic gate** |
| 15 | `… \| grep -cF "the three as-of-month lists partition the scored categories exactly once each, so no category is counted twice or dropped"` | `1` |
| 16 | `… \| grep -cF "only the as-of month reaches the verdict lists, so a finished month's percentage never sits in the same column as a mid-flight one"` | `1` — **N32** |
| 17 | `… \| grep -cF "off-cycle spend in an earlier elapsed month is reported separately rather than folded into this month's verdict"` | `1` — **N31's scenario** |
| 18 | `… \| grep -cF "a month index after the as-of month is rejected, because a full calendar year of months turns a 24 percent year-to-date underspend into a 75 percent one"` | `1` |
| 19 | `… \| grep -cF "a one-indexed month index is rejected before either domain module is called, rather than one of them throwing while the other silently prices it"` | `1` — **N15 / N33 / N34** |
| 20 | `… \| grep -cF "the same category supplied twice is rejected rather than doubling the categories, the money and the counts"` | `1` — **N26** |
| 21 | `… \| grep -cF "a duplicated month within one category is rejected rather than counted twice"` | `1` — **N18** |
| 22 | `… \| grep -cF "a non-finite annual budget is rejected rather than reported as a dollar figure of NaN beside a benign-looking blank percentage"` | `1` — **N29** |
| 23 | `… \| grep -cF "a negative spend magnitude is rejected rather than projected downward by a multiplier that is always at least one"` | `1` — **N35** |
| 24 | `… \| grep -cF "a money field arriving as a string is rejected rather than concatenated into a plausible number"` | `1` — **N20** |
| 24a | `… \| grep -cF "a scored category with no entry for the as-of month is rejected rather than silently reported as holding"` | `1` |
| 24b | `… \| grep -cF "a legal but negative annual budget does not throw, because the database permits it and a crashed dashboard is worse than a withheld row"` | `1` — **N21's chosen disposition** |
| 24c | `… \| grep -cF "the as-of point is the local calendar day of the clock read, so one minute past midnight and one minute to it map to the same day"` | `1` |
| 24d | `… \| grep -cF "the coverage the figures were computed over is carried through unchanged and is reported even when every category is holding"` | `1` |
| 24e | `… \| grep -cF "the headline and the findings are the sibling modules' own output, passed through rather than recomputed"` | `1` |
| 25 | `grep -cF "// @ts-expect-error monthOutlook requires the coverage it was computed over; it cannot be omitted" lib/domain/monthOutlook.test.ts` | `1` — paired with #1: if `coverage` is optional or absent, the directive is unused and #1 fails TS2578 |
| 26 | `grep -cE '\b(roundCents\|Math\.round\|Math\.abs\|toFixed)\(' lib/domain/monthOutlook.ts` | `0` — no new money arithmetic. Prose in this file must write "cent rounding", not `roundCents(` |
| 27 | `grep -cE '/ *(12\|MONTHS_PER_YEAR)' lib/domain/monthOutlook.ts` | `0` — no seventh even-spread implementation |
| 28 | `grep -cE 'getUTC\|toISOString' lib/domain/monthOutlook.ts` | `0` — the as-of point is the local calendar day |
| 28a | `grep -oE 'now\.(getFullYear\|getMonth\|getDate)\(\)' lib/domain/monthOutlook.ts \| wc -l \| tr -d ' '` | `3` — exactly the three local getters |
| 28b | `grep -cE 'new Date\(\|Date\.now\(' lib/domain/monthOutlook.ts` | `0` — the module converts a `Date` it is handed and never constructs or reads one |
| 29 | `grep -cE 'catch *\(\|try *\{' lib/domain/monthOutlook.ts` | `0` — **N34**: the sibling's `RangeError` is never swallowed |
| 29a | `grep -cE '(= \|return \|: )Infinity\b' lib/domain/monthOutlook.ts` | `0` |
| 29b | `grep -cE 'Intl\.' lib/domain/monthOutlook.ts` | `0` — the domain emits numbers; the page formats them |
| 29c | `grep -cE "^export function monthOutlook\(rows: AdherenceInput\[\], asOf: AsOf, coverage: CategorizationCoverage\): MonthOutlook \{" lib/domain/monthOutlook.ts` | `1` |
| 29d | `grep -cE "^import .*from './pacing';" lib/domain/monthOutlook.ts` | `1` — pacing is imported, not reimplemented |
| 29e | `grep -cE "^import .*from './adherence';" lib/domain/monthOutlook.ts` | `1` |
| 30 | `grep -ciE 'netWorth\|net_worth\|Net Worth' app/dashboard/page.tsx` | `0` — **§5's exit criterion, literal.** `26` today |
| 30a | `grep -cE 'Sparkline\|NetWorthTrendChart\|nwHistory\|computeCurrentNetWorth' app/dashboard/page.tsx` | `0` |
| 31 | `grep -oE 'new Date\(' app/dashboard/page.tsx \| wc -l \| tr -d ' '` | `1` — exactly one clock read. `7` today |
| 31a | `grep -cE 'Date\.now\(' app/dashboard/page.tsx` | `0` |
| 32 | `grep -cE 'monthsElapsed\|expectedYearSpend\|yearPacePct\|pctYear\|getMonth\(\) \+ 1' app/dashboard/page.tsx` | `0` — the flattering annual pace is gone. `14` today |
| 33 | `grep -cF 'EXTRACT(YEAR FROM CURRENT_DATE)' app/dashboard/page.tsx` | `0` — every year-scoped query takes the one clock read's year. `5` today |
| 34 | `grep -cF 'EXTRACT(MONTH FROM t.date)::int - 1' app/dashboard/page.tsx` | `1` — the month index is 0-based at the SQL boundary. `0` today |
| 34a | `grep -cE '\bmonthPct\(' app/dashboard/page.tsx` | `0` — no `Infinity`-producing colour scale on the hero path |
| 35 | `grep -cE 'detectAdherence\(\|scoredHeadline\(\|categoryPacing\(' app/dashboard/page.tsx` | `0` — the page calls `monthOutlook` and nothing else, so the three domain functions can never be handed divergent inputs |
| 35a | `grep -cE "^import .*from '@/lib/domain/monthOutlook';" app/dashboard/page.tsx` | `1` |
| 35b | `test $(grep -c 'control_mode' app/dashboard/page.tsx) -ge 1 && echo OK` | `OK` — **N1's shape, one page over**: an unselected `control_mode` silently empties the scored set. `0` today |
| 36 | `grep -o 'data-testid="[^"]*"' app/dashboard/page.tsx \| head -1` | `data-testid="month-outlook-hero"` — the hero is the first testid in the file (Q1's stated proxy) |
| 36a | `grep -c 'data-testid="month-outlook-hero"' app/dashboard/page.tsx` | `1` |
| 36b | `grep -c 'data-testid="categories-saying-no"' app/dashboard/page.tsx` | `1` — §5's "named list" exists as a distinct region |
| 36c | `grep -c 'data-testid="coverage-caveat"' app/dashboard/page.tsx` | `1` — Q3's interim caveat is rendered unconditionally |
| 37 | `test $(grep -c 'elapsedDays' app/dashboard/page.tsx) -ge 1 && test $(grep -c 'daysInMonth' app/dashboard/page.tsx) -ge 1 && echo OK` | `OK` — the day the projection was made from is rendered, not merely available |
| 38 | `git diff --name-only HEAD -- docs/screenshots \| wc -l \| tr -d ' '` | `0` — no agent captured a screenshot (Q6) |
| 39 | `test $(grep -cE "a\.landscape = 'operational'" app/dashboard/page.tsx) -ge 1 && echo OK` | `OK` — the coverage counts are scoped to the scored set's landscape. `0` today |
| 40 | `test $(npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 \| grep -cE "✓ lib/domain/adherence\.test\.ts") -eq 47 && echo OK` | `OK` — the tripwire, exactly |
| 41 | `test $(npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 \| grep -cE "✓ lib/domain/pacing\.test\.ts") -eq 24 && echo OK` | `OK` |
| 42 | `git diff --stat HEAD -- lib/domain/adherence.ts lib/domain/pacing.ts lib/domain/adherence.test.ts lib/domain/pacing.test.ts \| wc -l \| tr -d ' '` | `0` — the read-only inputs are byte-identical, not merely re-passing |
| 43 | `≈ \| grep -cF "the year-to-date delta is measured from the earliest snapshot that carries the deposit decomposition, never from an older row written under the previous definition"` | `1` — **N2** |
| 43a | `≈ \| grep -cF "a history with no post-cutover snapshot yields no delta at all rather than a delta of zero"` | `1` |
| 43b | `≈ \| grep -cF "the delta is current minus baseline, so a net worth that grew reports a positive figure"` | `1` |
| 43c | `≈ \| grep -cF "the number of pre-cutover snapshots skipped is reported, so the window the comparison used can be disclosed rather than assumed"` | `1` |
| 43d | `≈ \| grep -cF "snapshots supplied out of order resolve to the same baseline as the sorted history"` | `1` |
| 43e | `≈ \| grep -cF "the delta is rounded to cents once and never carries a minus sign on a figure that did not move"` | `1` |
| 44 | `test $(≈ \| grep -cE "✓ lib/domain/netWorth\.test\.ts") -ge 31 && echo OK` | `OK` — the 25 that existed plus at least the 6 above |
| 45 | `grep -cE '^export function comparableYtdDelta\(current: number, snapshots: SnapshotPoint\[\]\): YtdDelta \| null \{' lib/domain/netWorth.ts` | `1` |
| 45a | `grep -cE 'new Date\(\|Date\.now\(' lib/domain/netWorth.ts` | `0` — the delta module reads no clock; the ISO strings are the calendar |
| 46 | `git diff --name-only HEAD -- components/ \| wc -l \| tr -d ' '` | `0` — no existing component is edited |
| 47 | `test $(grep -c 'control_mode' scripts/seed-demo.mjs) -ge 2 && echo OK` | `OK` — column list and value. `0` today (**N7**) |
| 48 | `test $(grep -cE "^  \{ name: '" scripts/seed-demo.mjs) -eq $(grep -cE "^  \{ name: '.*mode: '" scripts/seed-demo.mjs) && echo OK` | `OK` — **every one of the 21 category literals carries an explicit mode**; a partial edit fails |
| 49 | `test $(grep -cE "^  \{ name: '" scripts/seed-demo.mjs) -eq $(grep -cE "mode: '(fixed\|discretionary\|variable-necessary)'" scripts/seed-demo.mjs) && echo OK` | `OK` — every mode is one of the three literals (`21` vs `0` today, so it fails on the clean tree) |
| 50 | `test $(grep -cE "mode: 'discretionary'" scripts/seed-demo.mjs) -ge 6 && echo OK` | `OK` — the demo scored set is non-empty and plural |
| 51 | `grep -cE "\?\? 'fixed'\|\|\| 'fixed'" scripts/seed-demo.mjs` | `0` — no silent default; an unclassified category is a visible omission |
| 51a | `test $(grep -c 'monthly_amounts' scripts/seed-demo.mjs) -ge 2 && echo OK` | `OK` — at least one seeded schedule, so an off-cycle breach is producible in the screenshots. `0` today |
| 52 | `grep -c 'comparableYtdDelta' app/net-worth/page.tsx` | `1` — the delta relocated, and through the domain function |
| 53 | `test $(grep -c 'liabilities_security_deposits' app/net-worth/page.tsx) -ge 1 && echo OK` | `OK` — the cutover marker is actually selected |
| 54 | `grep -cF 'snapshot_date::text' app/net-worth/page.tsx` | `1` — ISO dates come from Postgres, not from a timezone-sensitive JS conversion |
| 54a | `grep -c 'toISOString' app/net-worth/page.tsx` | `0` |
| 55 | `test $(grep -c 'excludedPreCutoverCount' app/net-worth/page.tsx) -ge 1 && echo OK` | `OK` — the window the comparison used is disclosed, not assumed |
| 55a | `grep -c 'data-testid="ytd-delta"' app/net-worth/page.tsx` | `1` |
| 56 | `grep -c 'net worth composed from its four parts' README.md` | `0` — the stale dashboard caption is gone. `1` today |
| 57 | `grep -ciE '\*\*Dashboard\*\* — .*month' README.md` | `1` — the replacement caption names the *month* question. **`0` today**: the incumbent caption is "net worth composed from its four parts, spend pacing against budget", which already contains the word "budget" — so a looser pattern would have passed vacuously on the clean tree |
| 58 | `git diff --name-only HEAD \| grep -vE '^(lib/domain/(monthOutlook\|netWorth)(\.test)?\.ts\|app/(dashboard\|net-worth)/page\.tsx\|scripts/seed-demo\.mjs\|README\.md\|AGENTS\.md\|plan/)' \| wc -l \| tr -d ' '` | `0` — **the scope command for tracked files** |
| 59 | `git status --porcelain \| grep -vE '^.. (lib/domain/(monthOutlook\|netWorth)(\.test)?\.ts\|app/(dashboard\|net-worth)/page\.tsx\|components/[A-Za-z0-9]+\.tsx\|scripts/seed-demo\.mjs\|README\.md\|AGENTS\.md\|plan/)' \| wc -l \| tr -d ' '` | `0` — **the scope command including new files** (requires T2) |
| 60 | `git status --porcelain lib/domain/monthOutlook.ts lib/domain/monthOutlook.test.ts \| wc -l \| tr -d ' '` | `2` — both new files exist (`git diff` cannot see them) |

**The regex-bearing commands, verbatim and authoritative** (copy from here, not from the table):

```sh
# 2 — whole repo green, nothing skipped.  Expect: 1
npm test 2>&1 | grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"

# 26 — no new money arithmetic in the outlook module.  Expect: 0
grep -cE '\b(roundCents|Math\.round|Math\.abs|toFixed)\(' lib/domain/monthOutlook.ts

# 27 — no seventh even-spread implementation.  Expect: 0
grep -cE '/ *(12|MONTHS_PER_YEAR)' lib/domain/monthOutlook.ts

# 28 — the as-of point is the local calendar day.  Expect: 0
grep -cE 'getUTC|toISOString' lib/domain/monthOutlook.ts

# 28a — exactly the three local getters.  Expect: 3
grep -oE 'now\.(getFullYear|getMonth|getDate)\(\)' lib/domain/monthOutlook.ts | wc -l | tr -d ' '

# 28b — the module never constructs or reads a clock.  Expect: 0
grep -cE 'new Date\(|Date\.now\(' lib/domain/monthOutlook.ts

# 29 — the sibling's RangeError is never swallowed (N34).  Expect: 0
grep -cE 'catch *\(|try *\{' lib/domain/monthOutlook.ts

# 29a — no Infinity produced or returned in code.  Expect: 0
grep -cE '(= |return |: )Infinity\b' lib/domain/monthOutlook.ts

# 29c — the signature, literally.  Expect: 1
grep -cE "^export function monthOutlook\(rows: AdherenceInput\[\], asOf: AsOf, coverage: CategorizationCoverage\): MonthOutlook \{" lib/domain/monthOutlook.ts

# 29d / 29e — the two domain modules are imported, not reimplemented.  Expect: 1 each
grep -cE "^import .*from './pacing';" lib/domain/monthOutlook.ts
grep -cE "^import .*from './adherence';" lib/domain/monthOutlook.ts

# 30 — net worth has left the dashboard (§5's exit).  Expect: 0   (26 today)
grep -ciE 'netWorth|net_worth|Net Worth' app/dashboard/page.tsx

# 30a — and so has its furniture.  Expect: 0
grep -cE 'Sparkline|NetWorthTrendChart|nwHistory|computeCurrentNetWorth' app/dashboard/page.tsx

# 31 — exactly one clock read.  Expect: 1   (7 today)
grep -oE 'new Date\(' app/dashboard/page.tsx | wc -l | tr -d ' '

# 32 — the flattering annual pace is gone.  Expect: 0   (14 today)
grep -cE 'monthsElapsed|expectedYearSpend|yearPacePct|pctYear|getMonth\(\) \+ 1' app/dashboard/page.tsx

# 34a — no Infinity-producing colour scale on the hero path.  Expect: 0
grep -cE '\bmonthPct\(' app/dashboard/page.tsx

# 35 — the page calls monthOutlook and nothing else.  Expect: 0
grep -cE 'detectAdherence\(|scoredHeadline\(|categoryPacing\(' app/dashboard/page.tsx

# 35a — and imports it.  Expect: 1
grep -cE "^import .*from '@/lib/domain/monthOutlook';" app/dashboard/page.tsx

# 36 — the hero is the first testid in the file.  Expect: data-testid="month-outlook-hero"
grep -o 'data-testid="[^"]*"' app/dashboard/page.tsx | head -1

# 39 — coverage is scoped to the scored set's landscape.  Expect: OK
test $(grep -cE "a\.landscape = 'operational'" app/dashboard/page.tsx) -ge 1 && echo OK

# 45 — the delta function's signature, literally.  Expect: 1
grep -cE '^export function comparableYtdDelta\(current: number, snapshots: SnapshotPoint\[\]\): YtdDelta \| null \{' lib/domain/netWorth.ts

# 45a — no clock in the delta module.  Expect: 0
grep -cE 'new Date\(|Date\.now\(' lib/domain/netWorth.ts

# 48 — every category literal carries an explicit mode.  Expect: OK
test $(grep -cE "^  \{ name: '" scripts/seed-demo.mjs) -eq $(grep -cE "^  \{ name: '.*mode: '" scripts/seed-demo.mjs) && echo OK

# 49 — every mode is one of the three literals.  Expect: OK
test $(grep -cE "^  \{ name: '" scripts/seed-demo.mjs) -eq $(grep -cE "mode: '(fixed|discretionary|variable-necessary)'" scripts/seed-demo.mjs) && echo OK

# 51 — no silent default.  Expect: 0
grep -cE "\?\? 'fixed'|\|\| 'fixed'" scripts/seed-demo.mjs

# 57 — the replacement README caption names the month question.  Expect: 1   (0 today)
grep -ciE '\*\*Dashboard\*\* — .*month' README.md

# 58 — SCOPE, tracked files.  Expect: 0
git diff --name-only HEAD \
  | grep -vE '^(lib/domain/(monthOutlook|netWorth)(\.test)?\.ts|app/(dashboard|net-worth)/page\.tsx|scripts/seed-demo\.mjs|README\.md|AGENTS\.md|plan/)' \
  | wc -l | tr -d ' '

# 59 — SCOPE, including untracked.  Expect: 0   (requires T2's cleanup first)
git status --porcelain \
  | grep -vE '^.. (lib/domain/(monthOutlook|netWorth)(\.test)?\.ts|app/(dashboard|net-worth)/page\.tsx|components/[A-Za-z0-9]+\.tsx|scripts/seed-demo\.mjs|README\.md|AGENTS\.md|plan/)' \
  | wc -l | tr -d ' '
```

Every one was run at spec time against the clean tree; the "today" figures in the table are the measured before-values and each discriminates. Note that `grep -c` exits `1` when it prints `0`; the observable is the printed number, not the exit code. `git diff` ignores untracked files, so creating `monthOutlook.ts` cannot make #58 pass vacuously — #60 is what proves it was created.

### Required fixture arithmetic — literal expected values

`AS_OF` is `{ year: 2026, month: 3, day: 8 }` — April 8, 2026 — unless stated. April has 30 days, so `elapsedFraction = 8/30 = 0.26666666666666666` and the multiplier is `3.75`. Every figure below was computed at spec time with `roundCents(n) = Math.round(n * 100) / 100` and is reused from P0.5-30's anchor so the two specs' arithmetic cross-checks. `COVERAGE` is `{ uncategorizedCount: 17, categorizedCount: 183 }` unless stated. All category rows are `landscape: 'operational'`, `exclude_from_budget: false`, `is_income: false` unless stated.

**Fixture H1 — the roadmap's own sentence, as a state and a list (acceptance #6).**
- Row 1 "Dining Out": `discretionary`, `annual_budget: 6000`, `monthly_amounts: null` → `budgeted: 500`. `months: [{ month: 3, actual: 355 }]`.
- Row 2 "Groceries": `discretionary`, `annual_budget: 14400`, `monthly_amounts: null` → `budgeted: 1200`. `months: [{ month: 3, actual: 260 }]`.

| field | required value | explicit `not.toBe` |
|---|---|---|
| `state` | `'projected-breach'` | `'on-track'` (a state derived only from `actual > budgeted`), `'breach'` (355 ≤ 500), `'nothing-to-score'` |
| `scoredCategoryCount` | `2` | — |
| `sayingNo.length` / `holding.length` / `withheld.length` | `1` / `1` / `0` | `sayingNo.length` `not.toBe(2)` |
| `sayingNo[0].category` | `'Dining Out'` | `'Groceries'` |
| `sayingNo[0].reason` | `'projected-breach'` | `'breach'` |
| `sayingNo[0].projected` | `1331.25` | `not.toBe(355)` (spend-to-date passed off as a projection), `not.toBe(1375.63)` (`daysInMonth` assumed 31) |
| `sayingNo[0].projectedVariance` | `831.25` | `not.toBe(-831.25)` (sign inverted) |
| `sayingNo[0].projectedRatio` | `2.6625` exactly | `not.toBe(1.6625)` ("percent over" for "fraction of budget"), `not.toBe(2.66)` (a cent-rounded ratio), `not.toBe(0.71)` (spend ratio as projection) |
| `sayingNo[0].spentRatio` | `0.71` | — |
| `sayingNo[0].elapsedDays` / `daysInMonth` | `8` / `30` | `daysInMonth` `not.toBe(31)` |
| `sayingNo[0].controlMode` | `'discretionary'` | — |
| `sayingNo[0].status` | `'projected'` | — |
| `holding[0].category` | `'Groceries'` | — |
| `holding[0].projected` | `975` | `not.toBe(260)` |
| `holding[0].projectedVariance` | `-225` | `not.toBe(225)` |
| `holding[0].projectedRatio` | `0.8125` | — |
| `holding[0].spentRatio` | `0.21666666666666667` | — |
| `coverage` | `toBe(COVERAGE)` — the same object reference | — |

**Fixture H2 — nothing to score, which is the demo dataset (acceptance #7).** Three rows, all `control_mode: 'fixed'`, operational, not excluded, not income: "Mortgage Payment" `annual_budget: 24000` → `2000`/month, `months: [{3, 2000}]`; "Utilities" `annual_budget: 5400` → `450`/month, `months: [{3, 620}]`; "Insurance" `annual_budget: 7200` → `600`/month, `months: [{3, 600}]`. `AS_OF`, `COVERAGE`.

- `state` `toBe('nothing-to-score')` — and explicitly **`not.toBe('on-track')`**, `not.toBe('breach')` (Utilities is $170 over its month), `not.toBe('no-budget-basis')`.
- `scoredCategoryCount` `toBe(0)`; `sayingNo`, `holding`, `withheld`, `offCycleElsewhere` all `toEqual([])`.
- `headline` `toBe(null)` — and `Object.is(headline, undefined)` `toBe(false)`.
- **`findings.length` `toBe(1)`** — `detectAdherence` still reports Utilities' April breach, with `scored: false`, `budgeted: 450`, `actual: 620`, `variance: 170`. "Tracked and reported, never scored", made observable. Explicitly `findings.length` `not.toBe(0)`.
- `coverage.uncategorizedCount` `toBe(17)` — the caveat renders in this state too.

**Fixture H3 — off-cycle outranks breach (acceptance #8).** A March-only category: `discretionary`, `annual_budget: 1200`, `monthly_amounts: [0,0,1200,0,0,0,0,0,0,0,0,0]`, `months: [{ month: 2, actual: 1150 }, { month: 3, actual: 275 }]`. `AS_OF`.

- `state` `toBe('off-cycle')` — **`not.toBe('breach')`** (275 > 0 also satisfies `actual > budgeted`), `not.toBe('projected-breach')`, `not.toBe('no-budget-basis')`.
- `sayingNo.length` `toBe(1)`; `sayingNo[0].month` `toBe(3)`; `sayingNo[0].reason` `toBe('off-cycle')`; `sayingNo[0].status` `toBe('off-cycle')`.
- `sayingNo[0].budgeted` `toBe(0)`, `actual` `toBe(275)`, and **all four of `spentRatio`, `projected`, `projectedVariance`, `projectedRatio` `toBe(null)`** — "a breach in its own right, not a percentage". Explicit: `spentRatio !== Infinity` and `Number.isNaN(spentRatio as unknown as number) === false`.
- The March record (`month: 2`, `budgeted: 1200`, `actual: 1150`, `projectedVariance: -50`) appears in **no** partition list: `sayingNo.concat(holding, withheld).every(c => c.month === 3)` `toBe(true)`.

**Fixture H4 — breach outranks projected-breach (acceptance #9).** One `discretionary` row, `annual_budget: 6000` → `500`, `months: [{ month: 3, actual: 620 }]`. `AS_OF`.

- `state` `toBe('breach')` — **`not.toBe('projected-breach')`**, `not.toBe('on-track')`.
- `sayingNo[0].reason` `toBe('breach')` — `not.toBe('projected-breach')`.
- `projected` `toBe(2325)`, `projectedVariance` `toBe(1825)`, `projectedRatio` `toBe(4.65)`, `spentRatio` `toBe(1.24)` — all still reported; the projection is not withheld because the fact outranks it.

**Fixture H5 — too-early outranks on-track (acceptance #10).** `AS_OF7 = { year: 2026, month: 3, day: 7 }` → `elapsedFraction = 0.23333333333333334 < 0.25`. One `discretionary` row, `annual_budget: 6000` → `500`, `months: [{ month: 3, actual: 30 }]`.

- `state` `toBe('too-early')` — **`not.toBe('on-track')`**, `not.toBe('projected-breach')`.
- `withheld.length` `toBe(1)`; `withheld[0].withheldReason` `toBe('too-early')`; `withheld[0].status` `toBe('too-early')`.
- `withheld[0].projected` `toBe(null)`; `budgeted` `toBe(500)`, `actual` `toBe(30)`, `spentRatio` `toBe(0.06)` still reported.
- Explicit: no field of the outlook equals `128.57` (`roundCents(30 / (7/30))`, the projection a floorless caller would print) or `900` (`30 × 30`).
- `sayingNo` and `holding` both `toEqual([])`.

**Fixture H6 — a breach needs a budget to breach (acceptance #11).** One `discretionary` row, `annual_budget: 0`, `monthly_amounts: null`, `months: [{ month: 3, actual: 275 }]`. `AS_OF`.

- `state` `toBe('no-budget-basis')` — **`not.toBe('breach')`** (this is the single most likely wrong answer: `275 > 0` is true), `not.toBe('off-cycle')` (there is no schedule), `not.toBe('on-track')`.
- `withheld[0].withheldReason` `toBe('no-budget')` — `not.toBe('negative-budget')`, `not.toBe('too-early')`.
- `withheld[0].status` `toBe('no-budget')`; `budgeted` `toBe(0)`, `actual` `toBe(275)`; all four ratio/projection fields `toBe(null)`.
- `sayingNo` `toEqual([])`.

**Fixture H7 — the validator, seven inputs (acceptance #18–#24b).** Base row unless stated: `discretionary`, `annual_budget: 6000`, `monthly_amounts: null`, `months: [{ month: 3, actual: 355 }]`, `AS_OF`, `COVERAGE`. Out-of-contract values reach the function through one `outOfContract()` cast helper at the fixture boundary; **nothing in `shared/types.ts` or `lib/domain/adherence.ts` may be widened to make them compile** (the P0.5-28 N4 precedent).

| sub | input | required |
|---|---|---|
| H7a | two rows with the same `id: 1` | `toThrow(RangeError)` — **N26** |
| H7b | `months: [{ month: 3, actual: 355 }, { month: 3, actual: 20 }]` | `toThrow(RangeError)` — **N18** |
| H7c | `annual_budget: NaN`; and separately `annual_budget: Infinity`; and separately `monthly_amounts: [0,0,NaN,0,0,0,0,0,0,0,0,0]` | each `toThrow(RangeError)` — **N29** |
| H7d | `months: [{ month: 3, actual: -100 }]` | `toThrow(RangeError)` — **N35**. Explicitly: the un-validated answer is `projected: -375`, which is *below* its own spend-to-date and inverts the "multiplier ≥ 1" reasoning |
| H7e | `annual_budget: '6000'` (a `NUMERIC` arriving as text); and separately `months: [{ month: 3, actual: '355' }]` | each `toThrow(RangeError)` — **N20** |
| H7f | `annual_budget: -1200` | **`not.toThrow()`** — and `state` `toBe('no-budget-basis')`, `withheld[0].withheldReason` `toBe('negative-budget')`, `withheld[0].budgeted` `toBe(-100)`, `actual` `toBe(50)` (use `months: [{3, 50}]`), `projected` `toBe(187.5)`, `spentRatio` `toBe(null)`, `projectedRatio` `toBe(null)` — explicitly `not.toBe(-0.5)` and `not.toBe(-1.875)`, the inverted percentages a `budgeted !== 0` guard emits. `state` `not.toBe('projected-breach')` even though `projectedVariance` is `+287.5` — **N21** |
| H7g | a second `discretionary` row with `months: []`, alongside the base row | `toThrow(RangeError)` — a scored category with no as-of-month entry must not read as holding |

**Fixture H8 — a one-indexed month is rejected before either domain call (acceptance #19).** The H3 March-only row with `months: [{ month: 12, actual: 1150 }]` — [[N15]]'s confirmed probe. `monthOutlook` `toThrow(RangeError)`. In the same test, assert both sides of the divergence the throw exists to prevent, so a "fix" to either goes red:
- `detectAdherence` over the identical row still returns its silent substitution: `budgeted: 100`, `actual: 1150`, `variance: 1050`, `ratio: 11.5`;
- `categoryPacing(rows, AS_OF)` over the identical row `toThrow(RangeError)`.

That pair — one module confidently wrong, the other throwing — is exactly what a caller with a `try`/`catch` would ship alone, and #29 is the static half of the same rule.

**Fixture H9 — off-cycle in an earlier elapsed month is reported separately (acceptance #17).** [[N31]]'s scenario, rebased onto elapsed months. Two `discretionary` rows, `AS_OF`:
- Row 1, a March-only schedule `monthly_amounts: [0,0,1200,0,0,0,0,0,0,0,0,0]`, `months: [{ month: 1, actual: 250 }, { month: 2, actual: 1150 }, { month: 3, actual: 0 }]`. February is off-cycle (`budgeted: 0`, `actual: 250`, schedule present); April is `no-budget`… **no**: April's schedule entry is `0` and `actual` is `0`, so `status` is `'no-budget'` and it lands in `withheld` with `withheldReason: 'no-budget'`.
- Row 2, `annual_budget: 6000` → `500`, `months: [{ month: 3, actual: 300 }]` → `holding`.

Required: `offCycleElsewhere.length` `toBe(1)`; `offCycleElsewhere[0].month` `toBe(1)`; `offCycleElsewhere[0].status` `toBe('off-cycle')` — **`not.toBe('complete')`** and **`not.toBe('future')`**, which are the two answers a precedence-swapped ladder gives. `state` `toBe('on-track')` — the hero is scoped to *this* month and says so, while the separate list carries the earlier breach; explicitly `state` `not.toBe('off-cycle')`, and this is the decision recorded in Q3, not an accident. `withheld[0].withheldReason` `toBe('no-budget')`.

**Fixture H10 — identity, not recomputation (acceptance #14).** H1's rows. Compute `const pace = categoryPacing(rows, AS_OF)` and `const dining = pace.find(p => p.categoryId === 1 && p.month === 3)!` in the test, then assert for the `sayingNo[0]` record, with `toBe` (which is `Object.is` in vitest):

`budgeted`, `actual`, `spentRatio`, `projected`, `projectedVariance`, `projectedRatio`, `elapsedDays`, `daysInMonth`, `status` — each `toBe(dining.<same field>)`. Plus `outlook.headline` `toEqual(scoredHeadline(rows))` and `outlook.findings` `toEqual(detectAdherence(rows))`. Plus the discriminators already in H1: `projectedRatio` `not.toBe(2.66)` and `not.toBe(1.6625)`.

A module that re-derived any of these from `budgeted`/`actual` would land on a value differing at the 15th decimal or not at all, and `Object.is` separates them where `toBeCloseTo` would not.

**Fixture H11 — the as-of point is a local calendar day (acceptance #24c).** `asOfFromDate(new Date(2026, 3, 8, 0, 1))` and `asOfFromDate(new Date(2026, 3, 8, 23, 59))` must both `toEqual({ year: 2026, month: 3, day: 8 })`. Additionally `asOfFromDate(new Date(2026, 0, 1, 0, 30))` `toEqual({ year: 2026, month: 0, day: 1 })` — the New Year boundary — and `asOfFromDate(new Date(2026, 11, 31, 23, 30))` `toEqual({ year: 2026, month: 11, day: 31 })`. Explicit `not.toEqual({ year: 2026, month: 1, day: 8 })` (a 1-based month, which would make every `monthly_amounts` lookup off by one). **Stated in the test's own comment and in `EVIDENCE.md`: the local-vs-UTC discrimination is enforced by acceptance #28 and #28a, not by this fixture, because a UTC implementation passes these assertions in a UTC CI.**

**Fixture H12 — a future month is rejected, and the reason is a number (acceptance #18).** One `discretionary` row, `annual_budget: 6000` → `500`/month, `months` supplied as all twelve of 2026 with actuals `[355, 420, 390, 355, 0, 0, 0, 0, 0, 0, 0, 0]`. `AS_OF`.

- `monthOutlook(rows, AS_OF, COVERAGE)` `toThrow(RangeError)`.
- In the same test, the hazard recorded as arithmetic: `scoredHeadline(rows)` over those twelve months reports `budgeted: 6000`, `actual: 1520`, `variance: -4480`, `varianceRatio: -0.7466666666666667` — a 75% underspend — while `scoredHeadline` over the four elapsed months reports `budgeted: 2000`, `actual: 1520`, `variance: -480`, `varianceRatio: -0.24`. Assert both, and assert `-0.7466666666666667` `not.toBe(-0.24)`. The `generate_series(1, 12)` shape copied from `components/BudgetMonthlyGrid.tsx:73` is precisely what produces the first figure.
- The permitted shape, asserted in the same test: `months` of `0 … asOf.month` only (the four elapsed months) does **not** throw and reports `state: 'projected-breach'` with `holding.length` `toBe(0)` (355 of a 500 month at day 8 projects to `1331.25`).

**Fixture H13 — the partition is total and disjoint (acceptance #15).** Six `discretionary` rows plus three that are not scored, `AS_OF`, each with an April entry:

| id | row | expected |
|---|---|---|
| 1 | `discretionary`, `annual_budget: 6000`, `actual: 620` | `sayingNo`, reason `'breach'` |
| 2 | `discretionary`, `annual_budget: 6000`, `actual: 355` | `sayingNo`, reason `'projected-breach'` |
| 3 | `discretionary`, schedule `[0,…]`, `actual: 275` | `sayingNo`, reason `'off-cycle'` |
| 4 | `discretionary`, `annual_budget: 14400`, `actual: 260` | `holding` |
| 5 | `discretionary`, `annual_budget: 0`, `actual: 0` | `withheld`, `'no-budget'` |
| 6 | `discretionary`, `annual_budget: -1200`, `actual: 50` | `withheld`, `'negative-budget'` |
| 7 | `fixed`, `annual_budget: 24000`, `actual: 3000` | in **no** list; `scoredCategoryCount` unaffected |
| 8 | `landscape: 'capital'`, `discretionary` | in **no** list |
| 9 | `is_income: true`, `discretionary` | in **no** list |

Assert: `scoredCategoryCount` `toBe(6)` — **`not.toBe(9)`** (no gate) and **`not.toBe(7)`** (a three-conjunct gate admitting the `fixed` row). `sayingNo.length + holding.length + withheld.length` `toBe(6)`. The nine category ids across the three lists `toEqual([1, 2, 3, 4, 5, 6])` after flattening and sorting — no id appears twice. `sayingNo.map(c => c.categoryId)` `toEqual([3, 1, 2])` — off-cycle first, then breach, then projected-breach, the stated order. `state` `toBe('off-cycle')`.

**Fixture H14 — on track, and the caveat still ships (acceptance #13, #24d).** Two `discretionary` rows both projecting under: `annual_budget: 14400` → `1200`, `actual: 260` (`projected: 975`); `annual_budget: 12000` → `1000`, `actual: 200` (`projected: 750`, `projectedVariance: -250`, `projectedRatio: 0.75`). `AS_OF`, `COVERAGE`.
- `state` `toBe('on-track')`; `holding.length` `toBe(2)`; `sayingNo` `toEqual([])`.
- `holding.map(c => c.categoryId)` — ordered by `projectedVariance` ascending: the `-250` row before the `-225` row.
- `coverage.uncategorizedCount` `toBe(17)` and `coverage.categorizedCount` `toBe(183)` — present in the healthiest state, which is the state where a caveat is most likely to be dropped.
- Then raise the first row's `actual` to `355` (`projected: 1331.25`, `projectedVariance: +131.25`) and re-run: `state` `toBe('projected-breach')`, `sayingNo.length` `toBe(1)`, `holding.length` `toBe(1)` — the second row is untouched.

**Fixture N-A — the YTD delta stops straddling the definition change (acceptance #43, #43b, #43c).** `current = 2930000.11`; snapshots, in ascending ISO order:

| date | total | `liabilitiesSecurityDeposits` |
|---|---|---|
| `2026-01-02` | `2900000.00` | `null` — pre-cutover |
| `2026-02-01` | `2915000.00` | `null` — pre-cutover |
| `2026-03-01` | `2880000.33` | `-18400.00` — **first comparable** |
| `2026-04-01` | `2905000.00` | `-18400.00` |

Required: `delta` `toBe(49999.78)`; `sinceDate` `toBe('2026-03-01')`; `comparableSnapshotCount` `toBe(2)`; `excludedPreCutoverCount` `toBe(2)`.

Explicit `not.toBe`: `delta` **`not.toBe(30000.11)`** — `2930000.11 − 2900000.00`, which is exactly N2's bug, the incumbent's answer using the earliest snapshot regardless of era; **`not.toBe(25000.11)`** — the *latest* comparable snapshot used as the baseline; **`not.toBe(-49999.78)`** — sign inverted; **`not.toBe(49999.779999999795)`** — the unrounded IEEE-754 difference. `sinceDate` **`not.toBe('2026-01-02')`** and **`not.toBe('2026-04-01')`**.

**Fixture N-B — no comparable snapshot means no delta (acceptance #43a).** The same `current`, with only the two `null`-decomposition rows. `comparableYtdDelta(...)` `toBe(null)` — **`not.toBe(0)`**, and `Object.is(result, undefined)` `toBe(false)`. Same for `comparableYtdDelta(2930000.11, [])` → `null`. The page renders the existing "First recorded reading — a trend appears once more are collected" copy, never a `$0` delta.

**Fixture N-C — order independence (acceptance #43d).** N-A's four snapshots shuffled into `[2026-04-01, 2026-01-02, 2026-03-01, 2026-02-01]` produce a byte-identical `YtdDelta`: `toEqual` the N-A result. Baseline selection is by ISO date, not by array position.

**Fixture N-D — one rounding, and no minus sign on a figure that did not move (acceptance #43e).** `current = 2880000.33` against N-A's snapshots: `delta` `toBe(0)` with `Object.is(delta, -0)` `toBe(false)`, `sinceDate` `toBe('2026-03-01')`. And, per the [[N27]] discipline, pin the residue the guard depends on in the same test so it cannot silently stop gating:

```ts
expect(Object.is(roundCents(-0.001), -0)).toBe(true);
```

## Negative controls

| # | Rule stated in prose | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | Net worth does not appear on the dashboard | Any occurrence of `netWorth` / `net_worth` / `Net Worth` in `app/dashboard/page.tsx`, in any casing — SQL, JSX, identifier or comment | #30, #30a |
| 2 | The dashboard performs exactly one clock read | A second `new Date(` — e.g. one for the header year and one for the as-of point, which is how the two can disagree across midnight | #31, #31a |
| 3 | The flattering annual pace is gone | `monthsElapsed`, `pctYear`, `expectedYearSpend`, `yearPacePct`, or the `getMonth() + 1` idiom surviving anywhere on the page | #32 |
| 4 | One clock read governs the SQL too | `EXTRACT(YEAR FROM CURRENT_DATE)` in any query on the page — a second, database-side clock | #33 |
| 5 | The month index is 0-based at the boundary | A `generate_series(1, 12)` / `EXTRACT(MONTH …)::int` query copied from `BudgetMonthlyGrid.tsx`, which supplies `1…12` | #34, #19 (H8) |
| 6 | The page computes nothing shared | A direct `detectAdherence(`, `scoredHeadline(` or `categoryPacing(` call in `app/dashboard/page.tsx` | #35 |
| 7 | The scored set is really read | A query that omits `control_mode`, which makes every category `fixed`/`undefined` and silently returns the hero to `nothing-to-score` | #35b, and H2 as the observable |
| 8 | Off-cycle is a breach in its own right, not a percentage | H3: `state` `not.toBe('breach')`; all four ratio fields `null`; `spentRatio !== Infinity` | #8 |
| 9 | A fact outranks a projection | H4: `reason` `not.toBe('projected-breach')` for a category already $120 over | #9 |
| 10 | A month too young to project is not "on track" | H5: `state` `not.toBe('on-track')`; no field equals `128.57` or `900` | #10 |
| 11 | A breach needs a budget to breach | H6: `$275` against `$0` budgeted, no schedule → `state` `not.toBe('breach')`, `withheldReason` `toBe('no-budget')` | #11 |
| 12 | A negative budget is withheld, not scored | H7f: `state` `not.toBe('projected-breach')` despite `projectedVariance: +287.5`; ratios `not.toBe(-0.5)` / `not.toBe(-1.875)` | #12, #24b |
| 13 | Nothing to score is not perfect adherence | H2: `state` `not.toBe('on-track')`, `headline` `toBe(null)`, and `findings.length` `not.toBe(0)` | #7 |
| 14 | No money figure is recomputed | H10: every field `toBe` (i.e. `Object.is`) the pacing record's; `projectedRatio` `not.toBe(2.66)` (re-rounded) and `not.toBe(1.6625)` (percent-over) | #14, #26, #27 |
| 15 | Only the as-of month reaches the verdict lists | H3: the March record with `projectedVariance: -50` must appear in none of the three lists — N32's "250% of December under April's 71%" | #16 |
| 16 | An earlier off-cycle month is reported, not misfiled | H9: `offCycleElsewhere[0].status` `not.toBe('complete')` and `not.toBe('future')` — the two answers N31's swapped ladder gives | #17 |
| 17 | A full calendar year of months is rejected | H12: `toThrow(RangeError)`, plus the two headline ratios `-0.7466666666666667` vs `-0.24` proving what the un-rejected version reports | #18 |
| 18 | The month index is validated before either domain call | H8: `detectAdherence` still returns `variance: 1050`, `ratio: 11.5`, and `categoryPacing` still throws — so a `try`/`catch` caller ships the first alone | #19, #29 |
| 19 | One row per category | H7a: two rows sharing `id: 1` throw, rather than doubling `scoredCategoryCount`, the money and the counts | #20 |
| 20 | One entry per month | H7b: a duplicated `month: 3` throws | #21 |
| 21 | The money fields are finite | H7c: `NaN` and `Infinity` `annual_budget`, and a `NaN` schedule entry, each throw — rather than `variance: NaN` beside `varianceRatio: null` | #22 |
| 22 | Spend is a non-negative magnitude | H7d: `actual: -100` throws — the un-validated answer is `projected: -375`, below its own spend-to-date | #23 |
| 23 | Money arrives as numbers | H7e: `'6000'` and `'355'` throw rather than being concatenated into a plausible figure | #24 |
| 24 | A scored category always has an as-of-month entry | H7g: a scored row with `months: []` throws rather than being absent from every list and therefore reading as holding | #24a |
| 25 | The partition is total and disjoint | H13: `scoredCategoryCount` `not.toBe(9)` and `not.toBe(7)`; the three lengths sum to 6; no id appears twice | #15 |
| 26 | The coverage cannot be omitted | A two-argument `monthOutlook(rows, asOf)` call must not compile — the `@ts-expect-error` must be *used*, or TS2578 fails #1 | #1 + #25 |
| 27 | The coverage ships in every state | H2 (`nothing-to-score`) and H14 (`on-track`) both assert `coverage.uncategorizedCount` `toBe(17)` | #7, #24d |
| 28 | The coverage counts the scored set's landscape | A coverage query with no `a.landscape = 'operational'` predicate, which would caveat an operational figure with capital-side noise. **Static only — no acceptance command executes this SQL** | #39 |
| 29 | The projection's day is rendered, not merely available | A page that prints `projected` without `elapsedDays` / `daysInMonth` | #37 |
| 30 | The as-of point is the local calendar day | `getUTC*` or `toISOString` in the outlook module; a month that is 1-based | #28, #28a, #24c |
| 31 | The delta is measured within one definition | N-A: `delta` `not.toBe(30000.11)` — the pre-cutover baseline, which *is* N2 | #43 |
| 32 | The delta is `current − baseline` | N-A: `not.toBe(-49999.78)` | #43b |
| 33 | The delta is rounded once | N-A: `not.toBe(49999.779999999795)`; N-D: `Object.is(delta, -0)` `toBe(false)` plus the `roundCents(-0.001)` residue pin | #43e |
| 34 | No comparable snapshot means no delta | N-B: `toBe(null)`, `not.toBe(0)` — BUILD.md §10.3's null-is-not-zero rule at the exact site the bug lives | #43a |
| 35 | The baseline is the earliest comparable, not the latest | N-A: `not.toBe(25000.11)`, `sinceDate` `not.toBe('2026-04-01')` | #43 |
| 36 | The window used is disclosed | N-A: `excludedPreCutoverCount` `toBe(2)`, rendered on the page | #43c, #55 |
| 37 | ISO dates come from Postgres | A `toISOString()` on a `DATE` column, which is the previous day in every negative-offset zone | #54, #54a |
| 38 | The read-only inputs are untouched | Any diff at all to `adherence.ts`, `pacing.ts` or either test file — including a comment | #40, #41, #42 |
| 39 | No existing component is edited | Any tracked path under `components/` in the diff | #46 |
| 40 | Every demo category is classified explicitly | A partial seed edit (the two counts diverge), or a `?? 'fixed'` default that hides an unclassified row | #48, #49, #51 |
| 41 | The demo scored set is non-empty and plural | Fewer than six `discretionary` categories — the state the README screenshots are captured from | #50 |
| 42 | The demo data can produce an off-cycle breach | No seeded `monthly_amounts` schedule, which makes the off-cycle card permanently empty in the screenshots | #51a |
| 43 | No agent captures a screenshot | Any change under `docs/screenshots/` | #38 |
| 44 | The README stops describing a product that no longer exists | The caption "net worth composed from its four parts" surviving | #56, #57 |
| 45 | The sibling's error is never swallowed | A `try`/`catch` in the outlook module | #29 |
| 46 | The new test file is collected at all | A test file outside `lib/**/*.test.ts` — #5 would report `0` | T6, #5 |

**Vacuity check, command by command.** #1–#4 prove nothing broke, not that anything shipped — not load-bearing alone, though #4 is the only command that proves the re-pointed page compiles at all. #5 bounds the work: a diff adding a module with three tests fails it. #6 is the binding numeric case and no stub reaches `'projected-breach'`, `1331.25`, `831.25`, `2.6625` and a one-element `sayingNo` together; its five `not.toBe` values are five plausible wrong implementations. #7 is the demo dataset's own state and catches the single worst outcome — a green hero over an empty scored set — while its `findings.length` `not.toBe(0)` catches a module that narrowed the detectors to the scored set. #8–#13 are the six adjacent-pair precedence gates; each is the only command in the suite that distinguishes its pair, and #11 is the one a plain `actual > budgeted` breach test fails. #14 is the no-new-arithmetic gate: `Object.is` separates a copied `2.6625` from a recomputed one where `toBeCloseTo` would not. #15 catches a partition that overlaps or drops. #16 catches N32's cross-status column. #17 catches N31's swapped ladder without editing pacing's suite. #18 catches the twelve-month query copied from `BudgetMonthlyGrid.tsx`, and prints the number that copy would ship. #19 catches the 1-indexed month and pins both halves of the deliberate sibling divergence, so a "fix" to either goes red. #20–#24a are the six inherited caller-contract debts, each with a fixture that throws where the un-validated module returns a plausible figure; #24b is the one that must *not* throw and catches a validator that over-reaches into a legal DB state. #24c pins the calendar-day contract; #24d catches the caveat being dropped in the healthiest state, which is where a caveat is most likely to be dropped. #25 makes `coverage`'s requiredness mechanical through TS2578 — an optional third parameter makes the directive unused and fails #1. #26–#29e are static and catch what no type error reveals: new money arithmetic, a seventh even-spread copy, a UTC clock, a swallowed `RangeError`, a produced `Infinity`, formatting in the domain, and a re-implementation instead of an import. #30–#35b are the page's side of the same question and every one of them has a measured before-value that differs from its after-value, so none can pass on the clean tree: `26`→`0`, `7`→`1`, `14`→`0`, `5`→`0`, `0`→`1`, `0`→≥`1`. #35 in particular catches the tempting implementation — calling `categoryPacing` inline on the page — which is what an implementer reaches for first and what BUILD.md §7.5's G4 rule forbids. #36 is a source-order proxy and is labelled as one. #37 catches a projection printed without its day. #38 catches an agent running the destructive seed. #39 is static-only and labelled so. #40–#42 are the tripwire and would catch a "while I was in there" edit that all other commands would pass. #43–#45a are N2's fix: #43's `not.toBe(30000.11)` *is* the bug, and `30000.11` and `49999.78` differ by $19,999.67 on the fixture. #46 catches an existing component being edited. #47–#51a catch a no-op seed, a partial seed, a typo'd mode, a hidden default, and a demo dataset that still cannot show an off-cycle breach. #56/#57 catch a README that keeps describing the old product; #57's pattern is deliberately narrower than "budget" because the incumbent caption already contains that word. #58/#59 are the scope commands, and #60 proves the new files exist since `git diff` cannot see them.

## Evidence required

- Verbatim output of **every** acceptance command in `EVIDENCE.md`, including the exit code for #1 and #4 and the printed number for every `grep -c`. The "today" before-values in the acceptance table are reproduced from `39c939c` for the ones that change (#30 `26`→`0`, #31 `7`→`1`, #32 `14`→`0`, #33 `5`→`0`, #34 `0`→`1`, #35b `0`→≥`1`, #47 `0`→≥`2`, #56 `1`→`0`).
- **The state ladder as a truth table**, one row per fixture H1–H14, with inputs, every scored record's `(status, budgeted, actual, projected, projectedVariance)`, and the resulting `state` and list membership — so this spec's arithmetic can be checked against the tests' arithmetic without running either.
- **A rendered `MonthOutlook` for Fixture H1, printed as JSON**, beside the English sentence it licenses: *"As of day 8 of 30 — Dining Out is at 71% of its month and projects to close at $1,331.25, $831.25 over. Groceries is holding. Computed over 183 categorized transactions this month; 17 are still uncategorized."* It must be shown to be producible from the module's output alone, with no arithmetic beyond formatting.
- **A before/after of the pace defect, as numbers**: what the incumbent Year Pace card reports on 1 April 2026 (`monthsElapsed = 4`, `pctYear = 33%`, expected spend `budget × 4/12`) against the true day-granular elapsed share (`91/365 = 24.9%`), and the dollar gap between the two expected-spend figures on the demo budget. The size of that gap is the argument for the removal.
- **A before/after of the YTD delta on Fixture N-A's data**: `30000.11` (incumbent, straddling the definition change) against `49999.78` (corrected), with the sentence `/net-worth` now renders including the disclosure of the two skipped rows.
- **A statement, in the implementer's own words, of what is not gated** — repeating Q1's admission that no command proves the hero renders first in a browser, naming acceptance #36 as a source-order proxy and its limit. Copying Q1's paragraph is not sufficient; the point is that the implementer confirms it independently.
- **Optional, and marked not-run with a reason if Postgres is unavailable**: the README's scratch-database path run end to end (`createdb b8_demo && DATABASE_URL=postgresql://localhost/b8_demo npx node-pg-migrate up && DATABASE_URL=… npm run seed:demo -- --yes-wipe-my-database`), with the output of `SELECT name, control_mode, monthly_amounts IS NOT NULL AS scheduled FROM budget_categories ORDER BY sort_order` pasted, proving the seeded scored set is non-empty and at least one schedule exists. **`.env.local`'s `DATABASE_URL` must not be used, and no `pg_dump` / `pg_restore` / `DROP SCHEMA` may be run.**
- A one-line handoff note naming the owner action still outstanding: regenerate `docs/screenshots/dashboard.jpg` and `net-worth.jpg` from the updated seed, per README §79.

## Failure modes to test

- **The hero reads "on track" when there is nothing to score.** The demo dataset is exactly this input, so the first screenshot taken after this ships would be the lie. `scoredHeadline` returning `null` collapsed into a falsy check that renders the green state is the one-character version of it.
- **A category with no budget reported as a breach**, because `actual > budgeted` is true for `$275 > $0`. The single most likely wrong rung on the ladder, and the fastest way to teach the owner to ignore the word.
- **Off-cycle collapsed into the ordinary zero-budget breach**, losing §5's elevated case, or emitted *with* a percentage — the same loss in a different dress, and `monthPct` answers `Infinity` for exactly that input.
- **A projection rendered without the day it was projected from**, which is the entire qualifier P0.5-30 built `elapsedDays`/`daysInMonth` to carry.
- **"Too early" rendered as green**, so the first week of every month reads as success.
- **The page supplies all twelve months** — the `generate_series(1, 12)` shape sitting eleven files away in `BudgetMonthlyGrid.tsx` — which turns a 24% year-to-date underspend into a 75% one and makes the chronic-underspend detector fire on categories that are simply not December yet.
- **The page supplies 1-indexed months** from `EXTRACT(MONTH FROM t.date)::int`, which makes `detectAdherence` price a December-only category as a $1,050 breach at 1150% while `categoryPacing` throws — and then a `try`/`catch` at the render boundary ships the first alone.
- **A second clock read** — one for the header year, one for the as-of point — disagreeing across midnight or a New Year, or a UTC read disagreeing with Postgres's `CURRENT_DATE` for the hours before the offset.
- **The dashboard query omits `control_mode`**, reproducing N1 one page over: every category reads `fixed`, the scored set silently empties, and the hero renders `nothing-to-score` on real data that has categories classified.
- **A sign inversion on the delta or the variance** — `baseline − current`, `budgeted − projected`, `Math.abs`, or `1 − projectedRatio`. Each produces a plausible dollar figure whose only symptom is that growth reads as loss or thrift reads as overspending. This family has already shipped in this repo.
- **The YTD delta keeps its pre-cutover baseline**, which renders perfectly and understates growth by exactly the security deposits held — N2, relocated rather than fixed.
- **The delta rendered as `0` instead of `—`** when no comparable snapshot exists, asserting that net worth did not move.
- **`snapshot_date` converted with `toISOString()`**, moving every snapshot back a day in negative-offset zones and potentially selecting a different baseline.
- **A money figure re-rounded on its way through the outlook**, so the dashboard and `/budget` disagree by a cent on the same category.
- **A ratio cent-rounded**, quantizing a percentage into 1% steps — P0.5-29a's recorded category error.
- **`projectedRatio` rendered as "percent over"** so `2.6625` and `1.6625` become interchangeable in a renderer's hands.
- **A duplicated category row** from a JOIN against the non-FK `mapped_category` / `UNIQUE(name, landscape)` shape, doubling `scoredCategoryCount`, the money and the counts.
- **A refund netting `actual` negative**, producing `projected: -375` — below its own spend-to-date, because a multiplier ≥ 1 moves a negative number down.
- **A `NUMERIC` column arriving as a string**, silently concatenating rather than adding.
- **The three lists overlapping or dropping a category**, so a category saying no also appears as holding, or a scored category appears nowhere and is read as fine.
- **Scope creep into `lib/domain/adherence.ts` or `lib/domain/pacing.ts`** "while I was in there" — the 71 tests and the byte-identical requirement are the tripwire.
- **A screenshot regenerated by an agent**, i.e. `npm run seed:demo` run against `.env.local`'s `DATABASE_URL`, which truncates the database holding real financial data.
- **A partially classified seed** — some categories carrying `mode`, others falling through a `?? 'fixed'` default — so the demo scored set is silently smaller than it looks.
- **Empty and degenerate collections**: `rows: []`; every row untracked; every scored row at `budgeted: 0`; `snapshots: []`. Each must land on a stated answer — `nothing-to-score`, `no-budget-basis`, `null` — never on `NaN`, `Infinity`, `-0`, or an accidental `0`.
- **The hero rendered below the fold**, or below a surviving chart, which #36 catches only in source order and not in the browser. Named here so the reviewer opens the page.

## Rollback

No migration, no schema change, no data write, no persisted state, no outbound surface. Revert is `git revert` of this task's commit(s), which:

- deletes `lib/domain/monthOutlook.ts` and `lib/domain/monthOutlook.test.ts` — neither has any importer outside `app/dashboard/page.tsx`, which the same revert restores;
- restores `lib/domain/netWorth.ts` and its test to their pre-task form, removing `comparableYtdDelta`, `SnapshotPoint` and `YtdDelta`, whose only importer is `app/net-worth/page.tsx`, also restored;
- restores `app/dashboard/page.tsx` and `app/net-worth/page.tsx`, bringing the net-worth hero and the (defective) annual-pace card back with them;
- restores `scripts/seed-demo.mjs` to its `control_mode`-less form, which regenerates the pre-task demo dataset on the next run against a scratch database — no existing database is altered by the revert itself;
- restores the `README.md` caption.

`lib/domain/adherence.ts`, `lib/domain/pacing.ts` and their two test files are byte-identical before and after in both directions (#42), so nothing in the 71 tripwire tests is disturbed either way. `docs/screenshots/**` is untouched by this diff (#38), so the images are whatever the owner last committed and a revert does not strand a half-regenerated set. No CSV backup applies; no `down` migration exists because no `up` was written.
