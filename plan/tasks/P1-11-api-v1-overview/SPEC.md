# P1-11-api-v1-overview — `GET /api/v1/overview` returns, in one request, everything `app/dashboard/page.tsx` currently fetches with ten queries and four shared readers

**Roadmap item:** ROADMAP.md §5 Phase 1, step 11 — `GET /api/v1/overview` — single-round-trip dashboard payload; web dashboard adopts it too. Orchestrator's reading: `plan/tasks/P1-11-api-v1-overview/ITEM.md`.
**Status:** DRAFT
**Author:** spec-writer

## Goal

**This spec covers the endpoint only.** ROADMAP.md's step-11 line and BUILD.md §14's worked example bundle the endpoint and the dashboard's adoption of it into one task. ITEM.md leaves the split as an open question for this spec to answer, and the answer is **two tasks**, for the same reason P1-10 was split from the route migration it made possible: rewriting `app/dashboard/page.tsx` (691 lines, the app's primary screen, ten `db.query` calls and four shared readers wired into a render tree with its own drift-alert bell, chart bars, and category bubbles) is a change with real regression surface that this endpoint's own tests cannot prove correct. That rewrite becomes **`P1-11a`**, queued as this task's successor once G4 passes here. This task's own diff does not touch `app/dashboard/**` — enforced by acceptance #40.

**What ships.** `GET /api/v1/overview` — no query parameters, no auth (step 12), no rate limit (step 13) — returns `{ success: true, data: OverviewData }` (the same `ApiResponse<T>` envelope every existing route already returns, validated at the response boundary against a new `shared/contracts/overview.ts`). `OverviewData` is derived from what `app/dashboard/page.tsx` renders **today**, not from BUILD.md §14's net-worth-first field list — Phase 0.5 step 31 moved net worth off the dashboard entirely (`grep -cin "net.worth\|netWorth" app/dashboard/page.tsx` → `0`, measured in ITEM.md), and net worth has no place in this payload. §14 remains right about the *form* — one request, a typed contract, a consumer reading it instead of issuing its own queries — and wrong about the *content*; this spec corrects the content and does not edit §14 itself.

**The payload, enumerated** (this enumeration is this spec's central deliverable, per ITEM.md — "deciding what belongs in one payload... is the spec's first job"). Each section names its source, so a reader can check this spec against the running code:

| `OverviewData` field | Shape | Source in `app/dashboard/page.tsx` today |
|---|---|---|
| `asOf` | `{ year: number; month: number; day: number }` | the page's one clock read, `asOfFromDate(new Date())` |
| `stats` | `{ budget, spent, remaining: string; uncategorized, totalTxns: number }` | `getStats` |
| `today` | `{ spent, avgSameWeekday: string; transactions: { label: string; amount: string }[]; totalCount: number }` | `getTodayStats` |
| `week` | `{ spent, spentComparableLastWeek, weeklyBudgetReference: string; isoDow: number }` | `getWeekStats` |
| `monthlySpending` | `{ month: string; operational, received: string }[]`, 12 entries Jan–Dec | `getMonthlySpending` |
| `recentArrivals` | `{ id: number; date: string; amount: string; label: string; category: string \| null }[]` | `getRecentArrivals` |
| `budgetVsActual` | `{ category: string; budget, spent: string }[]` | `getBudgetVsActual` |
| `monthOutlook` | `MonthOutlook`, verbatim (`lib/domain/monthOutlook.ts`) | `loadMonthOutlook(asOf)` |
| `yearEnd` | `YearEndRead`, verbatim shape (`lib/yearEndRead.ts`), for `landscape: 'operational'` | `loadYearEnd('operational', asOf)` |
| `feedHealth` | `FeedFinding[]`, verbatim shape (`lib/domain/feedHealth.ts`) | `loadFeedHealth()` |
| `driftFindings` | `DriftFinding[]`, verbatim shape (`lib/domain/drift.ts`) | `findBalanceDrift()` |

**The four already-shared readers must be reused, not reimplemented.** `loadFeedHealth`, `loadMonthOutlook` (via its own DB shell, `lib/monthOutlookRead.ts`), `loadYearEnd`, and `findBalanceDrift` are each already the *single* definition of their concept, shared today between the dashboard and (for `loadMonthOutlook`) the daily breach-alert job. A second SQL path computing the same figures is exactly BUILD.md §10.3's "two definitions of one concept" hazard, and it is the specific defect the §14 worked example's own reviewer finding demonstrates: an endpoint that recomputes a shared figure passes every test that checks the figure looks right and fails the one that checks it *agrees* with the other caller. Acceptance #26 enforces this structurally.

**The six ad hoc dashboard queries (`getStats`, `getRecentArrivals`, `getTodayStats`, `getWeekStats`, `getMonthlySpending`, `getBudgetVsActual`) are not shared today — they are private, unexported functions inside the page.** This task does not mandate extracting them into a named `lib/` module with a particular internal structure (that is implementation's call); it requires only that whatever computes `stats`/`today`/`week`/`monthlySpending`/`recentArrivals`/`budgetVsActual` for this endpoint applies **the identical filter predicates** those six functions already apply, documented in their own SQL comments today: operational-landscape + `exclude_from_budget = FALSE` + `is_income = FALSE` for every budget total; `hidden = FALSE` and `track_transactions = TRUE` everywhere; net of refunds, never gross; the 36-hour `created_at` window for `recentArrivals`; no landscape filter on `recentArrivals` (it deliberately shows both books). "Behaves identically to code that already exists and is not the subject of this task" is a correctness requirement, not a design proposal — the specific predicates are quoted from the running file, not invented here.

**Why the composition logic has to live under `lib/`, not only inside the route file.** `vitest.config.mts`'s own header states the rule this repo already lives by: "Unit tests only, deliberately... API-route contract tests against a test DB are tier 2." Its `include` list is `['lib/**/*.test.ts', 'shared/**/*.test.ts', '.claude/hooks/**/*.test.mts']` — **`app/**` is not in it and this task does not add it.** So any part of this endpoint's logic that can be tested without a database (money-string formatting, null preservation, the Date-to-string serialization boundary named below) has to be reachable by a test file under `lib/` or `shared/` to run under the existing, unchanged `npm test` — this is a constraint the repo already states, not a preference this spec is inventing. Concretely: a module at `lib/overviewRead.ts` (naming it after this repo's own established convention for a dashboard data shell — `lib/feedHealthRead.ts`, `lib/monthOutlookRead.ts`, `lib/yearEndRead.ts` already exist) does the composition and the wire-formatting; `app/api/v1/overview/route.ts` is the thin HTTP wrapper that calls it and returns `Response.json(...)`.

**The defect this step is most likely to ship — stated once, tested directly, not left to be rediscovered.** `plan/tasks/P1-10-zod-contracts/NITS.md` N4, measured against a live database: `pg` hands a `TIMESTAMPTZ` column back as a JS `Date`; `Response.json` (via `JSON.stringify`, which calls `Date.prototype.toJSON`) turns it into an ISO string on the wire — but a handler that validates its own composed object **before** that serialization step, with the `Date` still live, fails against a schema that (correctly) declares the field a string. This payload carries exactly one live example: `FeedFinding.lastSuccessfulUpdate` is typed `Date | null` all the way through `lib/domain/feedHealth.ts` and `lib/feedHealthRead.ts` — nothing converts it before this task. The wire response is fine regardless (`Response.json` serializes a `Date` correctly on its own), but a composer that calls `.parse()`/`.safeParse()` on the pre-serialization object reproduces N4 exactly. This spec does not require validating the response *inside* the route handler at all (see Non-goals), but it does require, as a regression control, that if the composed value is round-tripped through `JSON.parse(JSON.stringify(...))` — which is what actually reaches an HTTP client — the result validates against the schema even where a `Date` instance was present before that round-trip (acceptance #21).

**Seeding a test fixture is a write, and this repo has already settled where writes are allowed to land.** `scripts/seed-demo.mjs` refuses to run without `--yes-wipe-my-database` "because... the `DATABASE_URL` in `.env.local` is normally the real database," and `README.md`'s "Regenerating the screenshots" section documents the safe alternative: `createdb <scratch-name> && DATABASE_URL=postgresql://localhost/<scratch-name> npx node-pg-migrate up`. This task's integration suite (below) seeds fixtures the same way that script writes demo data, and it is bound by the identical hazard — enforced here as a control, not left as an instruction (see Conventions and acceptance #24, #25, #39).

## Non-goals

- **No dashboard adoption.** `app/dashboard/page.tsx` is not touched by this task's diff (acceptance #40). It becomes `P1-11a`.
- **No auth.** Step 12. This endpoint is reachable exactly as unauthenticated as all 27 existing `app/api/**` routes are today — a pre-existing condition of the whole route surface, not a new exposure this task introduces.
- **No rate limiting.** Step 13.
- **No change to how any figure is computed.** This task composes and formats; it calls `loadFeedHealth`/`loadMonthOutlook`/`loadYearEnd`/`findBalanceDrift` and reimplements the six ad hoc queries' *existing* predicates. It invents no new business rule, tightens no filter, and does not touch `lib/domain/**` (acceptance #27).
- **No `/api/v1/*` route migration beyond this one endpoint.** The other 26 existing routes are untouched; migrating them is a separate successor per P1-10's own ITEM.md (`P1-10b`).
- **No CI wiring for the new database-backed suite.** `.github/workflows/ci.yml`'s `test` job continues to run only the pure suite (acceptance #42) — unchanged, so it stays deterministic and DB-free exactly as `vitest.config.mts` documents. The new integration suite is run by the orchestrator directly (at G2/G4), the same way the orchestrator already stands up a throwaway Postgres for the migration up/down/up check without that check running inside CI's `test` job. Wiring CI to run it automatically is recorded as a follow-up, not bundled here.
- **No new npm script.** The integration suite is invoked with `npx vitest run --config vitest.integration.config.mts ...` directly; `package.json`'s `scripts` block is not touched.
- **No response validation mandated inside the route handler itself.** This spec requires that the composed value, once JSON-round-tripped, *would* validate (acceptance #21) — a property of the composer's output — not that the handler calls `.parse()` on every request. Whether to validate defensively at runtime is implementation's choice and does not gate this task.
- **No change to `shared/contracts/enums.ts`, `shapes.ts`, `envelope.ts`, or `representation.ts`'s existing exports.** This task's only contract diff is one new, additive file plus (at the guardian's discretion) one new export on `shared/types.ts`.
- **No property/real-estate data in this payload.** Nothing in `app/dashboard/page.tsx` today renders a property figure (Phase 0.5 moved that to `/net-worth` and `/properties` alongside net worth itself), so none enters this endpoint either.
- **No use of the `docker-compose.yml` `db` service, and no database named `b8_finance`, for anything this task's acceptance commands run.** That service binds `127.0.0.1:5432` with `POSTGRES_DB: b8_finance` — the identical port and name `.env.local` already resolves `DATABASE_URL` to on a machine with the app set up per the README. Neither the toolchain setup nor any acceptance command below may rely on it; see Conventions and T5.

## Contracts touched

| File | Change | Class (§9.2) |
|---|---|---|
| `shared/contracts/overview.ts` | new: `OverviewDataSchema` (or the guardian's chosen name) plus any small nested schemas it needs, built by **reusing** `numericString`, `timestamptz`, `serialId`, `LandscapeSchema` and `apiResponseSchema` from the existing sibling files rather than re-declaring parallel logic | additive |
| `shared/types.ts` | optional, guardian's discretion: one new exported type (e.g. `OverviewData`) matching this spec's payload table, following the file's own established pattern of declaring money fields as `number` while the zod contract states the true wire representation | additive, or none |
| `migrations/*`, `db/schema.sql` | none — this task composes existing reads | — |

No migration is expected. If implementation discovers it needs one, that is scope drift and must be reported, not absorbed.

## Conventions this task must honor

- **Sign.** Every transaction amount in this payload (`recentArrivals[].amount`, `today.transactions[].amount`) keeps this ledger's Plaid-derived convention unchanged: positive is money out, negative is income. No filter or formatting step in this task may flip or clamp a sign — normalizing signs is not this task's job at all, since it composes existing, already-normalized reads (negative control #5).
- **Money representation — the single rule for the whole payload.** Every field representing a dollar amount, in every section, crosses the wire as a **decimal string formatted to exactly two places**, never a bare JSON number, and this applies uniformly whether the figure was read straight off a `NUMERIC` column (`stats`, `today`, `week`, `monthlySpending`, `recentArrivals`, `budgetVsActual` — already exactly two decimal digits by construction, since `NUMERIC(12,2)`/`NUMERIC(14,2)` and their SQL sums preserve that scale) or produced by `lib/domain/**`'s own float arithmetic (`monthOutlook`'s `budgeted`/`actual`/`projected`/`projectedVariance`/`recurringExpected`/`recurringPosted`; `yearEnd`'s `income`/`expense`/`profitLoss`/`netToDate`/`uncategorized.*`/`monthly[].income`/`.expense`/`.cumulative`; `driftFindings[].ledgerBalance`/`.expectedBalance`/`.drift`/`.suggestedBeginningBalance`), which **can** carry more than two decimal digits (a projection is a multiplication of a ratio against a dollar figure) and must be rounded to the cent exactly once, at this formatting step, and never fed back into any comparison. This is the same rounding this app's own renderers already perform for display (`fmtCents`, `pct` in `app/dashboard/page.tsx`, both built on `Intl.NumberFormat`) — moved from the client to the response boundary, not a new rule. **Ratios, percentages, counts, ids, days and booleans are never stringified** — `spentRatio`, `projectedRatio`, `coverageShare`, `coveragePercent`, `elapsedDays`, `daysInMonth`, `categoryId`, `scoredCategoryCount`, `hoursStale`, `accountCount`, `isoDow`, `totalCount`, `uncategorized`, `totalTxns` remain plain JSON numbers, matching `shared/contracts`'s existing split between `numericString` (scalars) and plain numbers (everything that isn't money).
- **Rounding — per-step vs. once.** This task performs exactly one arithmetic operation of its own (`stats.remaining = budget − spent`), and it is computed on the raw numbers **before** either operand is formatted to a string — never by parsing two already-formatted decimal strings back into numbers. Every other figure in the payload is either already-computed (the four shared readers) or a direct pass-through of a SQL aggregate; this task introduces no second rounding pass over either.
- **Landscape + exclusions, stated per section** (the two independent flags — `hidden` and `exclude_from_budget` — are different, and BUILD.md §10.3 records what conflating them once cost):

  | Section | `landscape` | `exclude_from_budget` | `hidden` | `is_income` |
  |---|---|---|---|---|
  | `stats.budget`/`.spent`, `monthlySpending`, `budgetVsActual` | `operational` only | `FALSE` only | `FALSE` only | `FALSE` only (budget/spend totals; income categories excluded) |
  | `today`, `week` | `operational` only (via the joined category) | `FALSE` only | `FALSE` only | n/a |
  | `recentArrivals` | **both** — no landscape filter | **not filtered** — an excluded category's transactions still appear | `FALSE` only | n/a |
  | `monthOutlook` | operational only (`isScoredCategory`'s own first conjunct) | per `lib/domain/adherence.ts`'s existing rule | per existing rule | per existing rule |
  | `yearEnd` | `operational` only, passed explicitly as `loadYearEnd('operational', asOf)` — matching the dashboard, not the capital book, because the capital year is lumpy by construction (a remodel draws $40,000 in one month) and averaging it in would produce a P/L nobody is steering by | n/a | n/a | both, netted |
  | `feedHealth`, `driftFindings` | n/a — these are sync/reconciliation signals, not P&L | n/a | n/a | n/a |

- **Null semantics.** `recentArrivals[].category` is `null` for an uncategorized transaction, never `''` or `'Uncategorized'`. Every nullable money field this task passes through unchanged from `MonthOutlook`/`YearEndRead` (`projected`, `projectedVariance`, `recurringExpected`, `recurringPosted`, `reason`, `withheldReason`) stays `null` when its source is `null` — the wire-formatting step (previous bullet) must preserve `null` rather than formatting it to `"0.00"` or `0`, which would be exactly the "`null` rendered as `0`" hazard BUILD.md §10.3 names by name. `today.avgSameWeekday` legitimately renders as the two-decimal string `"0.00"` when there is no trailing-30-day baseline (the dashboard's own existing `COALESCE(..., 0)`, unchanged by this task) — that is a pre-existing sentinel, not a null-vs-zero defect this task introduces or is asked to fix.
- **The `Date`-to-string boundary.** `feedHealth[].lastSuccessfulUpdate` is a live `Date` object inside the composing code (per `lib/domain/feedHealth.ts`'s own declared type) and must be a string on the wire. `driftFindings[].observedAt` is already a string by the time `findBalanceDrift` returns it (`lib/drift.ts` calls `.toISOString()` itself) and needs no further conversion. `shared/contracts/overview.ts` must model `feedHealth[].lastSuccessfulUpdate` with `timestamptz.nullable()` (the existing string schema, reused from `shared/contracts/representation.ts`) — describing the value **after** `Response.json`, never `z.date()`, per representation.ts's own stated boundary rule.
- **The integration database must be structurally distinguishable from the real one, not merely instructed to be different.** On a machine set up per the README, `docker-compose.yml`'s `db` service binds `127.0.0.1:5432` with `POSTGRES_DB: b8_finance`, and `.env.local`'s `DATABASE_URL` resolves to exactly that host, port and database name — so a URL that only *happens* to be scratch, by an operator remembering to type a different name, is one typo away from seeding fixtures into real financial records. This task therefore requires a **control**, not a convention: a pure function, `lib/testDbGuard.ts`'s `assertScratchDatabase(url: string)`, that inspects the database name in a connection string and throws if it is `b8_finance` — and the integration suite's setup calls it, synchronously, as the first statement, before any `pg` client or pool is constructed, so the refusal fires on the string alone and never depends on a connection attempt succeeding or failing. Acceptance #24, #25, and #39 test the function and its wiring independently: #24/#25 are pure, DB-free proofs the predicate itself is correct in both directions; #39 is a live run of the actual integration entry point proving the guard is actually invoked, not merely present and unused.

## Toolchain prerequisites

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `vitest` runs `lib/**/*.test.ts` and `shared/**/*.test.ts`, `environment: 'node'`, no DB | **yes** | already configured | `grep -c "lib/\*\*/\*\.test\.ts" vitest.config.mts` | `1` today |
| T2 | `typescript` resolves the repo's `@/` paths for `npx tsc --noEmit` | **yes** | already present | `npx tsc --noEmit; echo "exit=$?"` | `exit=0` |
| T3 | `zod` resolves as a direct dependency (P1-10) | **yes** | already merged | `node -e "console.log(require('zod/package.json').version)"` | `4.6.2` |
| T4 | `typescript` resolves via `require("typescript")`, for the AST-import checks reused from P1-10 | **yes** | already a resolvable devDependency | `node -e "console.log(require('typescript').version)"` | matches `npx tsc --version` |
| T5 | **A reachable Postgres, schema migrated, exposed as `$DATABASE_URL`, for the new integration suite only — a name that cannot be `b8_finance` and a setup that does not use the `docker-compose.yml` `db` service**, because that service's bound port (`127.0.0.1:5432`) and database name (`b8_finance`) are identical to this machine's real `.env.local` values and cannot be told apart from production by port or name alone | **yes** | the exact safe pattern `README.md`'s "Regenerating the screenshots" section already documents for `b8_demo`, with a task-specific scratch name instead: `createdb b8_p111_throwaway && DATABASE_URL=postgresql://localhost/b8_p111_throwaway npx node-pg-migrate up`; tear down afterward with `dropdb b8_p111_throwaway` | `psql "$DATABASE_URL" -c "select current_database();"` | prints a name that is **not** `b8_finance` |
| T6 | `.claude/hooks/scope-guard.mjs`'s contract lease does **not** cover `app/`, `lib/`, or a new `vitest.*.config.mts` — the implementer must be able to write this task's whole surface without the lease open | **yes** | unchanged today | `grep -n "CONTRACT_PREFIXES = " .claude/hooks/scope-guard.mjs` | `CONTRACT_PREFIXES = ['shared/contracts/', 'migrations/'];` — neither `app/` nor `lib/` nor `vitest` is in the list |
| T7 | `git` at a known `HEAD`, for the scope commands | **yes** | working tree | `git rev-parse --short HEAD` | filled in at G0 |
| T8 | A database of any kind, for #1–#27 (everything except the integration suite) | **NO** | n/a | n/a — every one of those commands is `tsc`, `vitest run` against the unchanged pure config, `lint`, `build`, `npm ci`, an AST/grep script, or a `git diff`/`git status` scope check | no fixture below that isn't explicitly in the integration group depends on a live database |

## Acceptance commands

`⟨P⟩` abbreviates `npx vitest run --reporter=verbose lib/overviewRead.test.ts 2>&1` (the pure suite, already covered by the unmodified `vitest.config.mts`). `⟨I⟩` abbreviates `npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/overview/route.test.ts 2>&1` (the new, DB-requiring suite; requires T5, run with `$DATABASE_URL` set to the scratch database, never to `.env.local`'s value). All commands run from the repo root.

> **Why the reuse/layering checks parse imports instead of matching substrings.** `plan/tasks/P1-10-zod-contracts/GATES.md` G1-D1 measured that a text search over a directory both flags a comment merely *describing* an import and misses a real import written with a different quote style. Command #26 below reuses the exact AST-walking script that fix produced (`GATES.md` G0 cycle 3): parse every file with the `typescript` package, walk `ImportDeclaration`/`require`/dynamic-`import` nodes, and check only the decoded module-specifier string of those node kinds.
>
> **Why a count is never paired with a range.** Every command below that reports a bare number is checked against an exact number. Where the true requirement is "at least N," the command wraps the count in `test $(…) -ge N && echo OK`, so the expected observable result is always the literal string it produces — `OK` — never a range a bare count cannot itself express (P1-10's own acceptance #6 established this form).

| # | Command | Expected |
|---|---|---|
| 1 | `npx tsc --noEmit; echo "exit=$?"` | `exit=0` |
| 2 | `npm test 2>&1 \| grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"` | `1` — the existing pure suite, still green, still nothing skipped, still DB-free |
| 3 | `npm run lint 2>&1 \| tail -2` | the same pre-existing warning line measured at G0 and no other |
| 4 | `npm run build > /tmp/p111-build.log 2>&1; echo "exit=$?"` | `exit=0` |
| 5 | `npm ci > /tmp/p111-ci.log 2>&1; echo "exit=$?"` | `exit=0` |
| 6 | `test -f shared/contracts/overview.ts && echo OK` | `OK` — absent today |
| 7 | `test -f app/api/v1/overview/route.ts && echo OK` | `OK` — absent today (`test -d app/api/v1` fails today) |
| 8 | `test -f lib/overviewRead.ts && echo OK` | `OK` |
| 9 | `test -f lib/overviewRead.test.ts && echo OK` | `OK` |
| 10 | `test -f vitest.integration.config.mts && echo OK` | `OK` |
| 11 | `test -f app/api/v1/overview/route.test.ts && echo OK` | `OK` |
| 12 | `test -f lib/testDbGuard.ts && echo OK` | `OK` |
| 13 | `test -f lib/testDbGuard.test.ts && echo OK` | `OK` |
| 14 | `git diff --name-only HEAD -- vitest.config.mts \| wc -l \| tr -d ' '` | `0` — the existing pure config is untouched |
| 15 | `test $(grep -c "app/api/v1" vitest.integration.config.mts) -ge 1 && echo OK` | `OK` — the new config's `include` reaches the new route test |
| 16 | `grep -cE "lib/\*\*\|shared/\*\*" vitest.integration.config.mts` | `0` — the two configs stay disjoint; the integration config does not silently re-run the pure suite |
| 17 | `test $(⟨P⟩ \| grep -cE "✓") -ge 8 && echo OK` | `OK` — fixtures F1–F8 below |
| 18 | `⟨P⟩ \| grep -cF "every money field in a composed payload serializes as a two-decimal-place decimal string"` | `1` — **F1** |
| 19 | `⟨P⟩ \| grep -cF "a projected figure carrying float drift beyond two decimals is rounded to the cent once, at the wire boundary"` | `1` — **F2** |
| 20 | `⟨P⟩ \| grep -cF "a null projection serializes as null, never as the string 0.00"` | `1` — **F3** |
| 21 | `⟨P⟩ \| grep -cF "a feedHealth fixture whose lastSuccessfulUpdate is a live Date instance validates against the schema after a JSON round-trip"` | `1` — **F4, the N4 regression control** |
| 22 | `⟨P⟩ \| grep -cF "a negative transaction amount, this ledger's income convention, round-trips as a negative decimal string, unflipped"` | `1` — **F5** |
| 23 | `⟨P⟩ \| grep -cF "stats.remaining is computed from the unformatted budget and spent numbers, not from their formatted strings"` | `1` — **F6** |
| 24 | `⟨P⟩ \| grep -cF "refuses when DATABASE_URL resolves to b8_finance, the name this repo treats as the real database"` | `1` — **F7** |
| 25 | `⟨P⟩ \| grep -cF "does not refuse a distinctly named scratch database"` | `1` — **F8** |
| 26 | *(AST script, verbatim block below, `target="app/api/v1/overview"`, `wanted=["feedHealthRead","monthOutlookRead","yearEndRead","drift"]`)* | `4` — a real import of all four shared readers is present somewhere in the route's module graph |
| 27 | `git diff --name-only HEAD -- lib/domain/ \| wc -l \| tr -d ' '` | `0` — no change to the pure computation layer these readers call |
| 28 | `test $(⟨I⟩ \| grep -cE "✓") -ge 10 && echo OK` | `OK` — fixtures I1–I10 |
| 29 | `⟨I⟩ \| grep -cF "the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio"` | `1` — **I1** |
| 30 | `⟨I⟩ \| grep -cF "a hidden transaction dated within the last 36 hours does not appear in recentArrivals"` | `1` — **I2** |
| 31 | `⟨I⟩ \| grep -cF "a transaction mapped to a capital-landscape category is excluded from stats, monthlySpending and budgetVsActual"` | `1` — **I3** |
| 32 | `⟨I⟩ \| grep -cF "an exclude_from_budget category is excluded from stats and budgetVsActual though its landscape is operational"` | `1` — **I4** |
| 33 | `⟨I⟩ \| grep -cF "an uncategorized transaction is excluded from today and week spend but counted in stats.uncategorized"` | `1` — **I5** |
| 34 | `⟨I⟩ \| grep -cF "a refund nets against its category's spend rather than being ignored or double counted"` | `1` — **I6** |
| 35 | `⟨I⟩ \| grep -cF "feedHealth reports one finding per Plaid item, not per account, for two accounts sharing a stale item"` | `1` — **I7** |
| 36 | `⟨I⟩ \| grep -cF "driftFindings reports a seeded ledger/Plaid disagreement on a ledger-mode account and nothing for the same disagreement on a valuation-mode account"` | `1` — **I8** |
| 37 | `⟨I⟩ \| grep -cF "monthOutlook never contains an OutlookCategory for the capital-landscape category"` | `1` — **I9** |
| 38 | `⟨I⟩ \| grep -cF "yearEnd is scoped to the operational landscape and does not fold in the capital category's budget"` | `1` — **I10** |
| 39 | `DATABASE_URL="postgresql://nobody@127.0.0.1:1/b8_finance" npx vitest run --config vitest.integration.config.mts app/api/v1/overview/route.test.ts > /tmp/p111-guard.log 2>&1; code=$?; test $code -ne 0 && test $(grep -c "b8_finance" /tmp/p111-guard.log) -ge 1 && echo OK` | `OK` — the suite refuses before attempting any connection (port `1` guarantees a real connection could not have succeeded either way) |
| 40 | `git diff --name-only HEAD -- app/dashboard/ \| wc -l \| tr -d ' '` | `0` — **the scope decision, enforced**: no dashboard adoption in this task |
| 41 | `git diff --name-only HEAD -- migrations/ db/schema.sql \| wc -l \| tr -d ' '` | `0` |
| 42 | `git diff --name-only HEAD -- .github/workflows/ci.yml \| wc -l \| tr -d ' '` | `0` — CI wiring deferred, per non-goals |
| 43 | `git diff --name-only HEAD \| grep -vE '^(shared/contracts/overview\.ts\|shared/types\.ts\|lib/overviewRead\|lib/testDbGuard\|app/api/v1/\|vitest\.integration\.config\.mts\|plan/)' \| wc -l \| tr -d ' '` | `0` — scope, tracked files |
| 44 | `git status --porcelain \| grep -vE '^.. (shared/contracts/overview\.ts\|shared/types\.ts\|lib/overviewRead\|lib/testDbGuard\|app/api/v1/\|vitest\.integration\.config\.mts\|plan/)' \| wc -l \| tr -d ' '` | `0` — scope, including untracked |

**The regex-bearing and AST commands, verbatim:**

```sh
# 2
npm test 2>&1 | grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"

# 26 — a real import of the four shared readers somewhere in app/api/v1/overview's module graph.
node -e '
const ts=require("typescript");const fs=require("fs");const path=require("path");
const dir="app/api/v1/overview";
const wanted=["feedHealthRead","monthOutlookRead","yearEndRead","drift"];
function walk(d){let out=[];for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())out=out.concat(walk(p));else if(/\.tsx?$/.test(e.name))out.push(p);}return out;}
const found=new Set();
if(fs.existsSync(dir)){
  for(const file of walk(dir)){
    const src=ts.createSourceFile(file,fs.readFileSync(file,"utf8"),ts.ScriptTarget.Latest);
    (function visit(node){
      let spec=null;
      if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier){spec=node.moduleSpecifier.text;}
      else if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==="require"&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])){spec=node.arguments[0].text;}
      else if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])){spec=node.arguments[0].text;}
      if(spec){for(const w of wanted){if(spec.includes(w))found.add(w);}}
      ts.forEachChild(node,visit);
    })(src);
  }
}
console.log(found.size);
'

# 39 — the scratch-database guard refuses before any connection is attempted. Port 1 guarantees
# that even a wiring failure could not have accidentally reached a real database instead.
DATABASE_URL="postgresql://nobody@127.0.0.1:1/b8_finance" npx vitest run --config vitest.integration.config.mts app/api/v1/overview/route.test.ts > /tmp/p111-guard.log 2>&1
code=$?
test $code -ne 0 && test $(grep -c "b8_finance" /tmp/p111-guard.log) -ge 1 && echo OK
```

## Negative controls

| # | Rule | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | `hidden = TRUE` transactions never reach `recentArrivals`, `stats`, `today`, `week`, `monthlySpending`, or `budgetVsActual` | a fabricated transaction with `hidden = TRUE`, a distinctive amount (`9999.99`), dated and `created_at`'d inside every window the payload uses | I2 — acceptance #30 |
| 2 | `landscape = 'capital'` never enters `stats`, `monthlySpending`, `budgetVsActual`, `monthOutlook`, or `yearEnd('operational', …)` | a capital-landscape budget category with a distinctively large `annual_budget` (`50000.00`) and a transaction mapped to it | I3, I9, I10 — acceptance #31, #37, #38 |
| 3 | `exclude_from_budget = TRUE` is a separate flag from `hidden`, and both must be checked independently | an operational, non-hidden, `exclude_from_budget = TRUE` category with a distinctive budget (`2000.00`) — must be absent from `stats.budget`/`budgetVsActual` while its transactions still appear in `recentArrivals` | I4 — acceptance #32 |
| 4 | An uncategorized transaction (`mapped_category IS NULL`) is not spend the app can classify, so it must not enter any budget-tracking total, but it is not hidden either | a `mapped_category = NULL`, `hidden = FALSE`, positive-amount transaction dated today | I5 — acceptance #33 |
| 5 | This ledger nets refunds against spend rather than ignoring or double-counting them | a negative-amount transaction mapped to the same category as a positive one in the same period | I6, F5 — acceptance #34, #22 |
| 6 | `feedHealth` groups by Plaid item (`access_token`), not by account | two accounts sharing one `access_token`, both stale | I7 — acceptance #35 |
| 7 | Balance drift is reported for ledger-mode accounts only | the identical ledger/Plaid disagreement seeded on both a `valuation_mode = 'ledger'` and a `valuation_mode = 'valuation'` account — only the first produces a finding | I8 — acceptance #36 |
| 8 | Every money field is a decimal string, never a bare JSON number, and every ratio/count stays a plain number | a fixture asserting `typeof` on both a money field and a ratio field in the same object | F1 — acceptance #18 |
| 9 | Float drift beyond two decimals is rounded once, at the boundary, never left unrounded and never rounded a second time | a fixture value of `993.7500000000001` | F2 — acceptance #19 |
| 10 | `null` is never rendered as `0` or `"0.00"` | a `MonthOutlook` category fixture with `projected: null` | F3 — acceptance #20 |
| 11 | A live `Date` object at composition time must not defeat the wire schema, which describes the value after serialization | a `feedHealth` fixture whose `lastSuccessfulUpdate` is `new Date(...)`, not a string | F4 — acceptance #21 |
| 12 | This endpoint calls the four existing shared readers rather than re-deriving their SQL | absence of a real import of `feedHealthRead`, `monthOutlookRead`, `yearEndRead`, or `drift` anywhere under `app/api/v1/overview/` | acceptance #26 |
| 13 | This task does not touch the dashboard, the domain layer, the schema, or CI | any diff to `app/dashboard/`, `lib/domain/`, `migrations/`, `db/schema.sql`, or `.github/workflows/ci.yml` | acceptance #27, #40–#42 |
| 14 | **The integration suite must never seed data against a database named `b8_finance`, regardless of what `$DATABASE_URL` an operator supplies** | `DATABASE_URL` whose path is `/b8_finance` — the exact value `.env.local` resolves to on a machine set up per the README | F7, F8, #39 — acceptance #24, #25, #39 |

## Evidence required

1. **Verbatim `⟨P⟩` and `⟨I⟩` output**, showing all named fixtures passing.
2. **The exact seeded fixture** used by `app/api/v1/overview/route.test.ts` — every row inserted, with its distinguishing values (the `9999.99` hidden transaction, the `50000.00` capital category, etc.) — recorded in `EVIDENCE.md` so a reviewer can check an assertion against the row it claims to test without re-deriving the seed from the test file alone.
3. **The exact scratch database name, host and port used for the integration suite**, confirmed distinct from `b8_finance` and from the `docker-compose.yml` `db` service's bound port, plus confirmation the `dropdb` teardown ran.
4. **A one-paragraph confirmation, with the command run, that `npm test` (default config) and the new integration command never overlap in file selection** — i.e. the fixture from acceptance #16 plus a manual note of which files each command actually collected.
5. **Before/after `npm ls zod --depth=0`** is not required (no dependency change); state explicitly that none occurred.
6. **Any acceptance command in this spec a correct implementation could not satisfy**, reported per the standing escalation path, not worked around.

## Failure modes to test

- The composer re-derives net worth, a P&L, or any other figure `lib/domain/**` already owns, rather than calling the shared reader — passes every test that checks the number looks plausible and fails only a test that checks it *agrees* with the other caller (the exact §14 worked-example finding).
- `feedHealth[].lastSuccessfulUpdate` handed to `.parse()` while still a `Date` instance, reproducing NITS.md N4 inside a brand-new endpoint on day one.
- A money field left as a bare JS number because `Number(...)` was already applied upstream in the six ad hoc queries, silently breaking this payload's "money is always a string" rule the moment a consumer starts parsing it as text.
- A `null` projection defaulted to `"0.00"` by a formatting helper that runs `.toFixed(2)` unconditionally without a null guard.
- `stats.remaining` computed by parsing the two already-formatted strings back into numbers rather than from the underlying floats — invisible on real (already 2-decimal) data, live the moment any upstream figure carries more precision.
- The `hidden` and `exclude_from_budget` flags conflated — a category-level exclusion applied to the transaction-level flag or vice versa, which is BUILD.md §10.3's own named defect, verbatim.
- `recentArrivals` accidentally landscape-filtered (matching the other sections' predicate by copy-paste) when the dashboard's own version deliberately shows both books.
- `yearEnd` invoked with the wrong landscape argument (`'capital'` or unfiltered), folding a lumpy capital draw into the operational P/L the owner steers by.
- `feedHealth` grouped by account instead of by Plaid item, reporting ten findings for one outage instead of one.
- The integration test's `include` glob widened to also catch `lib/**`/`shared/**`, silently double-running the pure suite under the DB-requiring config and making a passing pure test look like it was verified against a database when it never touched one.
- A new import of `pg`/`@/lib/db` sneaking into `shared/contracts/overview.ts`, reintroducing the layering violation P1-10 built the AST-import checks to catch.
- **`assertScratchDatabase` checks `process.env.DATABASE_URL`'s string, but the setup code instead builds the pool from discrete `PGHOST`/`PGDATABASE`/`PGPORT` variables** — the guard never sees a `b8_finance` name because nothing ever assembled it into a URL, and the check silently passes over the exact case it exists for.
- **`assertScratchDatabase` is imported but called after the first seeding query, or inside a `try/catch` that swallows its throw** — an import-presence check alone cannot distinguish "wired in" from "wired in too late," which is exactly why acceptance #39 is a live, behavioral run of the real integration entry point rather than a structural check like #26.

## Rollback

One commit, no schema change, no data change: `git revert <sha>`.

- The revert removes `shared/contracts/overview.ts`, `app/api/v1/overview/**`, `lib/overviewRead.ts`/`lib/testDbGuard.ts` and their tests, and `vitest.integration.config.mts`, and restores `shared/types.ts` to its prior form if the guardian added an export there.
- `npx tsc --noEmit` in both directions confirms completeness: forward, every existing importer of `shared/types.ts` still compiles after this task lands; in reverse, nothing outside the declared surface (acceptance #43–#44, true throughout the task's life) was left depending on `shared/contracts/overview.ts`, `lib/overviewRead.ts`, or `lib/testDbGuard.ts`.
- **No `down` migration**, because there is no migration.
- **No CSV restore**, because this task writes nothing to Postgres's real database — it only reads there, and every write it performs anywhere lands in the scratch database T5 describes and #39's control refuses to let it be anything else.
- `plan/tasks/P1-11-api-v1-overview/**` is documentation and is not reverted.
