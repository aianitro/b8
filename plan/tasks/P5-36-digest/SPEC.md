# P5-36-digest — The digest, composed but not delivered
**Roadmap item:** ROADMAP.md §5 step 36 — a pure function from findings, a period and coverage to a Digest, rendered at an in-app route; no email, no schedule, no network
**Status:** FROZEN@G0 (2026-10-20)
**Author:** spec-writer

## Goal
After this task the signed-in owner (or second user) can visit an in-app page, `/digest`, that shows every finding the nine existing producers report, in a reader-facing order, each with a plain statement of how old its worst input is, and with an explicit statement of which of the nine sources were evaluated and which were not. The composition is a pure function, `composeDigest(findings, period, coverage)`, in a new `lib/domain/` module. It reads no clock, no database and no network, and every sentence a reader sees is composed inside it. The page is a thin renderer: one clock read, one loader call, one call to the pure function.

Three things must be true of what the page says, and are the point of the step:
1. **Freshness is never presented as health.** A `feed-degraded` finding whose last success is recent has freshness `fresh` while the feed is still failing. The digest says it is still failing and does not use "fresh", "healthy", "ok" or "recovered" for it. `undated` and `never` are stated as what they are and are never counted or worded as fresh.
2. **Not evaluated is never all clear.** A source that was not supplied, or whose read failed, is named on the page. A digest with zero findings is not good news: it states how many sources were evaluated and reported nothing, names any that were not evaluated, and uses none of the all-clear phrases listed under Conventions. The positive "nothing to report, and here is the figure behind it" statement belongs to step 37, not here.
3. **No viewer can learn a held gift from the digest.** The digest carries no transaction text at all (the contract's strict members already refuse it). Its figures are the same for every viewer, exactly as every other total in the app (P7-41b: "a total that differs by viewer is the one thing masking may never do"). The loader still takes the viewer as a required argument, as `loadOverview` does, and an integration scenario proves the output is identical for the giver, the recipient and an unresolved viewer.

Severity, confidence, the set of findings and the assembler's own order are unchanged. The digest reorders only its own view of the list. Whether `packages/contracts/**` is touched: **it is not**. The Digest is an in-process value passed from a server-side function to a server component; it is never parsed from, nor serialised across, a boundary. See "Contracts touched".

## Disposition of the carried-in nits
Each is decided here; none is left open.
1. **P5-35 N1 — widen the SQL-clock check (T35-W1's `SQL_CLOCKS`). In scope, tested.** The pattern must also flag `CURRENT_TIME`, `LOCALTIME` (but not `LOCALTIMESTAMP`'s existing coverage regressing, and not a column such as `localtime_name`), `timeofday()`, and the literal casts `'now'`, `'today'`, `'tomorrow'`, `'yesterday'` when followed by `::` or when passed to `CAST(`. Each gets a fabricated violator and there is a clean control per family (for example `known_at`, and `label = 'today'` with no cast). The scan set gains the new loader `lib/findingsDigestRead.ts`. Scenario T36-W1.
2. **P5-35 "fresh is not healthy" for `feed-degraded`. In scope, tested.** Scenarios T36-D5 (pure) and T36-D4. The caveat is a coded field plus a statement, defined under "What the Digest must contain".
3. **P5-35 N2 — the `INDEXES` cache in `findingsFreshness.ts`. Comment only.** The cache is a `WeakMap` keyed on the facts object, so it is safe only while facts are never mutated after being passed in. This step documents that precondition in a comment and does not change code. Open question Q8 offers dropping the cache; the default does not, because the step adds a caller that builds facts once per request and discards them, and a behavioural change to a module the digest depends on would widen the review for no new benefit.
4. **P5-35 N3 — inaccurate header comment in `scripts/findings-freshness-read.test.ts`. Comment only**, reworded to say what the fixtures actually do. Acceptance #9 proves the diff touches no code line.
5. **P5-35 note — the R-file empties tables before each world.** Inherited constraint, not a change. The new integration file must seed every row it reads and must not rely on rows left by another file; it empties the tables it reads at the start of each world, exactly as the R-file does, and acceptance #6b runs the suite with file order shuffled to prove it.
6. **P5-34 N1 — widen T34-W1 (severity has one home). In scope, tested.** `severityAssignments` must also flag a severity literal that reaches a `severity` key (a) through element access into a same-file lookup table or array whose values include a severity literal, and (b) through the return value of a same-file function or arrow function that can return one. The scanned set must also include every non-test file under `apps/web/scripts/` (`.ts` and `.mjs`) and `apps/web/instrumentation.ts`. Each form gets a fabricated violator and a clean control. At the time of writing, a text search finds the word `severity` nowhere under `scripts/` or in `instrumentation.ts`, so the real tree is expected to stay clean; if the widened scan reports a real hit, the implementer stops and reports it (fixing it is out of scope). Scenario T36-W2.
7. **P5-34 N4 — ranking across kinds. Decided in the digest only**, default in Q3: within a severity, a fixed reader-facing order of kinds, so a projected overdraft precedes "never synced" and "never valued" warnings. Severity is never inverted. The assembler's order is unchanged. Scenario T36-D2.
8. **P5-34 N5 — viewer masking. Decided: figures are viewer-invariant** (default in Q4). The reason is already written down in `lib/giftReadPath.ts` and `lib/domain/giftMask.ts`, and the dashboard already shows the same breach and drift figures to the same viewer; masking them in the digest alone would make two screens disagree, which is the failure the vocabulary exists to prevent. What the digest must guarantee instead is that it carries no row text and that its output is identical across viewers. Scenario T36-L4.
9. **P5-34 N6 — the zero-budget comment in `lib/domain/findings.ts`. Comment only**, reworded to say "months with nothing budgeted". The same file's header sentence "NOTHING EXISTING IMPORTS THIS YET" becomes false in this step and is reworded in the same comment-only edit.

## Names this spec fixes
`lib/domain/digest.ts` and `lib/digestRead.ts` already exist: they are the daily **email** digest (`DigestData`, `loadDigest`) and are unrelated to this task. To avoid two things called "the digest" in one folder, the new names are fixed and the existing files are not touched:
- `apps/web/lib/domain/findingsDigest.ts` exports `composeDigest`, the type `FindingsDigest` (the roadmap's `Digest`), and the types `DigestPeriod`, `DigestCoverage`, `DigestItem`.
- `apps/web/lib/findingsDigestRead.ts` exports `loadFindingsDigestInput`.
- The route is `/digest` (file `apps/web/app/digest/page.tsx`), its renderer `apps/web/components/DigestView.tsx`.
Open question Q2 covers the route name.

## What the Digest must contain (observable behaviour, not design)
The function signature is `composeDigest(findings: readonly Finding[], period: DigestPeriod, coverage: DigestCoverage): FindingsDigest`.
- `DigestPeriod` is `{ type: 'asOf', date: 'YYYY-MM-DD' }`, the same shape as the contract's as-of period, so no new calendar type exists. The date is a real calendar date (a 30th of February, a thirteenth month and an unpadded month are refused with `RangeError`). Any input finding whose own period is of type `asOf` and whose date differs from the period's date makes the function throw `RangeError`: one day's findings are never presented under another day's caption. Findings with `month` or `months` periods are not compared with it.
- `DigestCoverage` is `{ notEvaluated: readonly FindingSource[] }`, which is exactly what `assembleFindings` already returns beside the list. (Roadmap wording calls the third parameter "freshness". Each finding already carries its own freshness, so what the digest additionally needs is which sources were never asked. Open question Q1.)
- The result has: the echoed `period`; `status`; `items`; a `dating` tally; a `coverage` record; and a headline `statement`.
- `items`: one item per input finding, none dropped, none added, none merged or de-duplicated (two findings with the same kind and the same subject name stay two). Each item carries the finding unchanged (deep-equal, not the same object) and a `dating` record: the finding's freshness `state`, `basis`, `ageDays` and `undatedInputs`, copied and never upgraded, plus a coded `caveat` (below) and a `statement` sentence.
- `items` order: severity first, always (`critical`, then `warning`, then `notice`; a notice never precedes a warning). Within a severity, the kind order is the table in Q3's default: overdraft-open, overdraft-forecast, budget-breach, balance-drift, feed-degraded, sync-stale, job-overdue, cash-uncounted, valuation-stale, budget-underspend. Within one kind, the input order is kept. The result must not depend on the order the input list arrives in, except among findings of the same severity and kind.
- `dating`: integer tallies of items by freshness state (`fresh`, `stale`, `never`, `undated`) summing to the item count, and `undatedInputs` equal to the sum of the items' own undated-input counts. These are counts of things, not figures.
- `coverage`: `evaluated` and `notEvaluated`, each in the canonical source order of `FINDING_SOURCES`, together exactly the nine sources with none repeated, and a `statement` that names every source not evaluated.
- `status`: `findings` when there is at least one item; `incomplete` when there are none and at least one source was not evaluated; `none-reported` when there are none and all nine were evaluated. Nothing else.
- Item `statement` content, by freshness state. `fresh` or `stale`: contains the age in days as a number with the correct singular or plural ("1 day", "2 days", "0 days") and a plain-words label for the basis. `never`: contains the word "never". `undated`: contains the phrase "cannot be dated". Any item whose `undatedInputs` is above zero, whatever its state, additionally contains the phrase "cannot be dated" and the count.
- `caveat`: the value `recent-success-feed-still-failing` exactly when the finding is `feed-degraded` with `state: 'failing'` and its freshness state is `fresh`; `null` for every other combination. For that combination the item statement contains the word "failing". For every item of kind `feed-degraded`, `sync-stale` or `job-overdue`, whatever its state, the item statement does not match `\b(fresh|healthy|ok|recovered)\b` (case-insensitive): for these kinds the finding's existence is the failure, and a date says only when it last worked.
- Headline and coverage statements, and every item statement, contain none of the all-clear phrases: `all clear`, `good news`, `nothing to report`, `no issues`, `all good`, `on track`, `nothing wrong`, `healthy`, `up to date`, `up-to-date` (case-insensitive). The `none-reported` headline contains the number of sources evaluated and the word "reported". The `incomplete` headline contains the number of sources not evaluated.
- No statement contains a money amount: no `$` and no two-decimal figure. Money stays in the carried finding, as the contract's two-decimal string with the producer's sign, and the page renders that string verbatim.

## Non-goals
Each is enforced by the reviewer as a defect if present.
- **No delivery of any kind.** No email, no push, no file written, no schedule or cron, no network call, no outbound request, no Anthropic or other model call, no `fetch`. The existing daily email (`lib/domain/digest.ts`, `lib/digestRead.ts`, `lib/domain/digestWindow.ts`, `lib/scheduler.ts`) is not modified, not imported and not reused.
- **No weekly report content and no "nothing to report" statement.** No week window, no spend-against-categories figures, no rent-against-expected, no net-worth-movement threshold: those are step 37. The digest says what the checks reported and what they did not cover; it never says all is well.
- **No new contract, no change to `Finding`, `Freshness` or any schema** under `packages/contracts/**`; no zod schema for the Digest; no `CONTRACT_SCHEMAS` entry. Changing `Finding` or `Freshness` is breaking in effect now that this step is a consumer.
- **No API route, no JSON endpoint, no `/api/v1/digest`, no change to `OverviewDataSchema`, `overviewRead`, `overviewFromWire`,** or the overview route.
- **No change to the dashboard, `AlertBell`, any health card, the sidebar or any navigation component.** The page is reachable by its URL. (Q6.)
- **No new finding kind, detector or threshold,** and no copy of an existing threshold. The numbers behind sync, feed, wallet and valuation staleness do not appear in the digest module; it imports none of the four threshold constants, because it never judges age (it reports the age the finding already carries).
- **No change to `assembleFindings`, the conversions, the freshness rules, severities or the order of the assembler's output.** The only edits to existing non-test source files are comment-only (`findings.ts`, `findingsFreshness.ts`).
- **No merging, de-duplication, correlation or re-ranking across producers** beyond the reader-facing order above. A feed finding and a sync finding for one bank stay two items.
- **No per-viewer figures.** No masking of a figure for the recipient, no `visibleTransactions` import in the digest module, the loader, the page or the view. The loader is not to read a transaction's text for any reason.
- **No persistence.** No migration, table, column, index, cache, memoisation across requests or stored digest. The digest is derived at request time.
- **No refactor of `SyncHealthCard`, `loadFeedHealth`, `loadJobHealth`, `loadValuationFindings`, `loadOverdrafts`, `loadForecasts`, `findBalanceDrift`, `walletStatuses` or `loadMonthOutlook`.** The sync-item query is duplicated in the loader (the card's version is private to a component); the integration scenario T36-L2 pins the duplicate against what the card's query yields.
- **No interaction.** No dismiss, snooze, acknowledge, filter, sort control or per-item action; the page is read-only and a server component with no client state. No `'use client'` unless the uiux-promax skill's chosen pattern for a collapsible group strictly requires it, in which case only the view component may carry it and it may import types only.
- **No real name, merchant or money figure** in any tracked file, commit message or EVIDENCE.md (the repository is public). Fixtures are fabricated (`Fabricated Credit Union`, `Fixture Checking`, `Fixture Category`) and use single-digit amounts. Counts of days, tests, files and sources are allowed.
- **No edit that removes or weakens an existing test assertion** (acceptance #10). The existing scenarios `T34-*` and `T35-*` keep their ids and their asserted rules; only the widened checks in "Disposition" 1 and 6, and the declared-importer set in T35-W3, change.

## Contracts touched
| File | Change | Class (§9.2) |
|---|---|---|
| `packages/contracts/**` | **none.** `FindingsDigest` is a plain TypeScript type local to `lib/domain/findingsDigest.ts`, built from the existing `Finding` and `FindingSource` types. It crosses no boundary: its only producer and only consumer run in one server process. If a later step serves a digest over an API or to a client (step 38, or a mobile client), that step owns the contract. | none |
| `migrations/**`, `db/schema.sql`, `shared/types.ts`, `CONTRACT_SCHEMAS` | none | none |

Acceptance #12 proves `packages/`, `migrations/` and `db/` have no modified or added file.

## Conventions this task must honor
- **Sign:** this task adds, computes, sums, rounds and negates no money. Every money field keeps the contract string and the sign its producer gave it: drift is negative on a credit or loan account (owed money is negative); an overdraft balance and low point may be negative; a breach's variance is positive when over budget; a window variance for chronic underspend is negative. The digest carries these untouched; the view renders each money string verbatim (a negative figure keeps its leading minus) and neither the view nor the page may call `Math.abs`, `Math.round`, `parseFloat`, `Number(`, `.toFixed(` or `Intl.NumberFormat` on a finding's field (T36-W5). Adding a currency symbol or digit grouping is Q7; the default adds none.
- **Rounding:** none, because there is no money arithmetic. Ages are the findings' own whole-day integers (P5-35's floored days), copied; the digest recomputes none. The tallies are integer counts.
- **Landscape + exclusions:** the digest applies no filter and drops nothing. Operational versus capital, `hidden` and `exclude_from_budget` are applied by the producers already: the adherence source is the same list the dashboard's month outlook uses (`loadMonthOutlook(...).outlook.findings`), so a capital category or an excluded line reaches the digest only if it reaches the dashboard. The loader does not add, remove or re-derive a filter.
- **Null semantics (load-bearing):** a null stays null and is never rendered as a zero or a blank; where a finding has `daysStale: null`, `daysSince: null`, `hoursStale: null` or `ageDays: null`, the reader sees the producer's "never" or "cannot be dated" wording, never "0 days". The four freshness states are never conflated, never upgraded and never counted into one another's tally. An undated finding is counted as undated and nowhere else. A source not supplied is `notEvaluated`, which is not the same as "supplied and empty".
- **Time:** the page makes exactly one clock read, `new Date()`, and derives from it: the as-of triple with `asOfFromDate` (process-local, as the dashboard does), the loader's `now`, and the period date. The period date is formatted from the integer triple (month plus one, zero-padded), never from `toISOString().slice(0, 10)` (that reads the UTC day, a day early in any positive-offset zone). The pure module reads no clock. The output of `composeDigest` does not depend on the process time zone (tested under three).
- **Viewer:** the page resolves the viewer with `pageViewer('/digest')` (fail closed: no session resolves to `null`, a non-giver) and passes it to the loader as a required argument, never defaulted. The digest's content is identical for every viewer.
- **Wording:** all reader-facing sentences are composed in `composeDigest`; the view only lays them out. Sentences state facts and counts and never advise ("you should…").

## Toolchain prerequisites
All commands run under `bash` from the repo root. The orchestrator verifies every row before G0 passes. A row whose verification command cannot be run is a G0 FAIL.

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `psql`, `createdb`, `dropdb`, local Postgres with CREATEDB | **yes** (#6, #6b) | local install | `psql -d postgres -tAc "select 1"` → `1` | filled at G0 |
| T2 | a throwaway DB at current head, never `b8_finance` | **yes** | `createdb b8_p36_throwaway` then `DATABASE_URL=postgresql://localhost/b8_p36_throwaway npm run migrate:up` | `psql postgresql://localhost/b8_p36_throwaway -tAc "select to_regclass('public.gifts')::text"` → `gifts` | filled at G0 |
| T3 | an exported `DATABASE_URL` wins over `apps/web/.env.local` in `migrate:up` | **yes** | n/a | `DATABASE_URL=postgresql://nobody@127.0.0.1:1/b8_p36_throwaway npm run migrate:up; echo "exit=$?"` → non-zero, connection refused on port 1 | filled at G0 |
| T4 | unit baseline recorded before the change: BASE files, BASE tests | **yes** | existing | `npm test 2>&1 \| tail -8` → record | filled at G0 |
| T5 | `tsc` clean in `apps/web` and at the root | **yes** | existing | `(cd apps/web && npx tsc --noEmit; echo "exit=$?")` → `exit=0`; `npx tsc --noEmit; echo "exit=$?"` → `exit=0` | filled at G0 |
| T6 | the 54 existing scenarios are present once each and green before the change (the baseline command #5 is run with the old id lists) | **yes** | existing | run #5 on the unmodified tree with `t36` empty and the count 54 | filled at G0 |
| T7 | integration baseline on the unmodified tree: only failing title, if any, begins `RC-03:`; record the total as IBASE and confirm `T35-R1`..`T35-R9` each present once and passed | **yes** | existing | run #6 on the unmodified tree with the T36 ids removed | filled at G0 |
| T8 | `typescript` resolvable from `apps/web` (the wiring tests use the compiler API) | **yes** | existing | `(cd apps/web && node -e 'require.resolve("typescript")'; echo "exit=$?")` → `exit=0` | filled at G0 |
| T9 | `TZ` changes `Date` behaviour in Node here | **yes** | OS tz database | `TZ=Pacific/Auckland node -e 'console.log(new Date(2026,0,1).getTimezoneOffset())'` → `-780`; `TZ=America/Los_Angeles node -e 'console.log(new Date(2026,0,1).getTimezoneOffset())'` → `480` | filled at G0 |
| T10 | `git merge-base HEAD main` resolves and nothing outside `plan/` is already modified | **yes** | existing | `git merge-base HEAD main \| wc -l` → `1`; `git status --short -- . ':(exclude)plan' ':(exclude)*AGENTS.md' ':(exclude)*CLAUDE.md'` → no output | filled at G0 |
| T11 | integration config lists a DB-requiring test outside `lib/` by exact path | **yes** | precedent | `grep -c "findings-freshness-read.test.ts" apps/web/vitest.integration.config.mts` → `1` | filled at G0 |
| T12 | vitest supports shuffling file order (for #6b) | **yes** | existing | `(cd apps/web && npx vitest run --help 2>&1 \| grep -c "shuffle")` → a number of at least `1`; record the exact flag spelling that works and use it in #6b | filled at G0 |
| T13 | `npm run build` succeeds on the unmodified tree, and the orchestrator records how the route table prints a dynamic page (for example the line for `/dashboard`) so #13's pattern is right | **yes** | existing | `O="$(mktemp)"; npm run build >"$O" 2>&1; echo "exit=$?"; grep -n "dashboard" "$O"` → `exit=0` and one route line to copy the format from | filled at G0 |
| T14 | the scripts and instrumentation file set the widened W2 scans exists | **yes** | existing | `ls apps/web/scripts/*.ts apps/web/scripts/*.mjs apps/web/instrumentation.ts \| wc -l` → at least `10` | filled at G0 |
| T15 | Chrome, dev server, scratch demo database and the test session cookie | **NO** for any acceptance command. Required only for the orchestrator's separate browser check under "Evidence required", which is evidence and not a gate command | memory: local-ui-preview (passkey blocks the browser tools; scratch demo DB plus test session cookie; clear the service-worker cache in dev) | n/a | n/a |
| T16 | live Plaid, SMTP, push, Anthropic API, network, the dev database `b8_finance` | **NO** | n/a | n/a | n/a |

Prerequisites the implementer must create (none exist today). Every scenario title begins with its id exactly as listed (`T36-D1:` …).
- `apps/web/lib/domain/findingsDigest.ts` — pure. Imports only sibling modules in `lib/domain/` (by `./name`, no subdirectory) and `@b8/contracts/findings`; the type-only import of `FindingSource` and `FINDING_SOURCES` comes from `./findings`.
- `apps/web/lib/domain/findingsDigest.test.ts` — scenarios D1–D12. Imports only pure modules.
- `apps/web/lib/findingsDigestRead.ts` — the loader: given the viewer and `now`, runs the nine producers and the freshness facts read, assembles the findings, and returns what the page needs (the assembled list, its `notEvaluated`, and the period).
- `apps/web/scripts/findings-digest-read.test.ts` — scenarios L1–L7, against the throwaway DB with fabricated rows it seeds itself. It lives outside `lib/` for the same reason the R-file does, and its exact path is added to `include` in `apps/web/vitest.integration.config.mts`.
- `apps/web/app/digest/page.tsx` and `apps/web/components/DigestView.tsx`.
- Wiring scenarios W1–W5 are added to the existing `apps/web/lib/findingsWiring.test.ts` under the `T36-` prefix.

## Scenarios
Counts: 12 pure (D), 5 wiring (W), 7 integration (L). Every id is counted by script in #5 and #6.

| Id | Rule | Fixture and assertion | Catches |
|---|---|---|---|
| T36-D1 | carriage | built through the real conversions from fabricated producer inputs: one finding of each of the ten kinds, plus two `sync-stale` findings with the same bank name, plus two findings of one kind with the same subject name: `items.length` equals the input length; each `item.finding` deep-equals its input and is a different object; no finding missing, none added, none merged | de-duplication; dropping a kind; a field lost in copying |
| T36-D2 | reader order (N4) | a warning set containing `sync-stale` never, `valuation-stale` never, `overdraft-forecast`, `budget-breach`, `balance-drift`, plus a critical `overdraft-open` and notices, fed in eight different input orders: the resulting kind sequence is identical every time and follows the Q3 table; the forecast precedes both "never" warnings; severity is non-decreasing in rank (no notice before a warning, no warning before a critical); two findings of one kind keep input order; the digest's `items` order is the only thing that changed, the findings are untouched | severity-only sorting; input-order dependence; severity inversion |
| T36-D3 | period | valid date echoed; `2026-02-30`, `2026-13-01`, `2026-1-5`, `''` and `'2026-02-29'` (not a leap year) each throw `RangeError`; `2028-02-29` is accepted; an `asOf` finding dated one day off the period throws `RangeError`; a `month` finding is not compared | an unvalidated caption; one day's findings under another's date |
| T36-D4 | dating statements | one fixture per freshness state, plus ages 0, 1 and 2: `fresh`/`stale` statements contain the age number with correct plural and a basis label; `never` contains "never"; `undated` contains "cannot be dated"; a `stale` finding with undated inputs above zero also contains "cannot be dated" and the count; `dating.state/basis/ageDays/undatedInputs` equal the finding's own; `ageDays` null for `never` and `undated` | a statement that drops the undated count; "0 days" for a null |
| T36-D5 | fresh is not health | `feed-degraded` `failing` with freshness `fresh` has `caveat === 'recent-success-feed-still-failing'` and a statement containing "failing"; the same finding with state `stale` freshness `stale` has `caveat === null`; for every item of kind `feed-degraded`, `sync-stale` or `job-overdue` in all four freshness states the statement matches none of `fresh`, `healthy`, `ok`, `recovered` as whole words; no other kind has a non-null caveat | the P5-35 carry-in: a recent last success read as a working feed |
| T36-D6 | coverage and status | `[]` with nothing unevaluated → `none-reported`; `[]` with one unevaluated → `incomplete`; `[]` with all nine unevaluated → `incomplete` and the statement says no source was evaluated; one finding with two unevaluated → `findings`, and `coverage` still lists both; `evaluated` and `notEvaluated` partition the nine in canonical order for every permutation of the input `notEvaluated`; every unevaluated source's name appears in the coverage statement; a repeated source in the input appears once | an empty list read as all clear; a dropped unevaluated source |
| T36-D7 | empty is not good news | for each of the three statuses, the headline, the coverage statement and every item statement match none of the all-clear phrases; the `none-reported` headline contains `9` and "reported"; the `incomplete` headline contains the unevaluated count | a "nothing to worry about" sentence; a status that sounds clean |
| T36-D8 | tallies | a fixture of nine items across all four states with differing undated counts: the four tallies equal an independent count in the test; they sum to `items.length`; `dating.undatedInputs` equals the sum | undated counted as fresh; a stub returning zeros |
| T36-D9 | never upgraded | for every fixture, each item's `dating.state` equals `finding.freshness.state`; an `undated` item adds one to `undated` and to no other tally; swapping a finding's state in the input changes exactly one tally by one | `undated`/`never` collapsed into `fresh` |
| T36-D10 | purity | fake timers at two system times give deep-equal output; deep-frozen inputs do not throw; mutating an output item's finding does not change the input and the reverse; two calls with the same input are deep-equal; the result is identical under permuted `notEvaluated`; no process time zone changes the output | a hidden clock; aliasing; mutation |
| T36-D11 | no money text | across the full ten-kind fixture, no statement matches `\$` or `\d\.\d{2}\b` | a figure composed in prose with the wrong sign |
| T36-D12 | end to end through the real pipeline | fabricated producer inputs for all ten kinds go through `assembleFindings` with a freshness context, then `composeDigest`: every `item.finding` parses against `FindingSchema`; the item kinds are exactly the ten kinds; `coverage.notEvaluated` is empty; omitting the `valuations` source from the assembler input makes `valuations` appear in the digest's `notEvaluated` and none of the valuation findings appear | the assembler and the digest disagreeing |
| T36-W1 | SQL-clock check widened (P5-35 N1) | `CURRENT_TIME`, `LOCALTIME`, `timeofday()`, `'now'::timestamptz`, `'today'::date`, `'tomorrow'::date`, `'yesterday'::date`, and `CAST('now' AS timestamptz)` in a string or template literal are each flagged by the read-module check; the existing four families still are; `known_at`, `localtime_name`, `label = 'today'` and a column named `today_total` are not flagged; the real `findingsFreshnessRead.ts` and `findingsDigestRead.ts` are clean | a database clock hiding in the loader |
| T36-W2 | severity has one home, widened (P5-34 N1) | flagged: `const M = { a: 'warning' }; ({ severity: M[k] })`; `const L = ['notice']; ({ severity: L[0] })`; `function sev() { return 'warning'; } ({ severity: sev() })`; `const sev = (x: boolean) => (x ? 'warning' : 'notice'); ({ severity: sev(y) })`; clean: `({ severity: input.sevs[k] })`, a helper returning a non-literal, a table whose values are not severities. The scanned set includes at least one non-test file under `scripts/`, and `instrumentation.ts`; the tree is clean | severity written in a script or through a lookup |
| T36-W3 | containment, updated | the declared importers of the vocabulary, the freshness read and the contract are exactly: `lib/domain/findings*.ts`, `lib/findingsFreshnessRead.ts`, `lib/findingsDigestRead.ts`, `app/digest/page.tsx`, `components/DigestView.tsx`, and the contract itself. Fabricated consumers are each flagged: `app/dashboard/page.tsx`, `components/AlertBell.tsx`, `components/DigestCard.tsx`, `lib/digestRead.ts` (the email), `lib/overviewRead.ts`, an `app/api/v1/digest/route.ts`, and a dynamic `import()` of the digest module. The five declared files exist and import it | a card, route or the email digest starting to read the vocabulary |
| T36-W4 | digest module purity | `findingsDigest.ts` has no `Date.now(`, no zero-argument `new Date(`, no `Math.random(`, no `parseFloat`, no `performance.now`, no import of any of the four threshold constants or of `LATE_AFTER_HOURS`, no import outside `./name` siblings and `@b8/contracts/findings`, no numeric literal other than `0` and `1`, no SQL literal; and `severityAssignments` of it is empty (it reads severities and writes none, although it sits in the vocabulary directory where the severity check is exempt). Fabricated violators for each are flagged and a clean source is not | a hidden clock; a copied threshold; severity assigned in the digest |
| T36-W5 | the page and view are thin | `page.tsx` has a default async export, `export const dynamic = 'force-dynamic'`, calls `pageViewer`, calls the loader and `composeDigest`, contains exactly one `new Date()` and no `Date.now`, imports no `db`, no `pg`, no `giftReadPath`, no producer module and no `lib/domain/` module other than `findingsDigest` and `monthOutlook`; `page.tsx` and `DigestView.tsx` contain none of `Math.abs`, `Math.round`, `parseFloat`, `Number(`, `.toFixed(`, `Intl.NumberFormat`, and no string literal matching a severity word or an all-clear phrase; `DigestView.tsx` has no clock call. Fabricated violators for each are flagged | page-side figures, clocks, a second wording, a page reaching the database |
| T36-L1 | all nine sources, all ten kinds | a seeded world with at least one finding of each of the ten kinds: the loader's `notEvaluated` is empty; the digest's item kinds are exactly the ten, with the expected count per kind (asserted as a table); every `item.finding` parses against `FindingSchema`; none of the freshness states is missing a basis | a source silently omitted; freshness not attached |
| T36-L2 | one definition of "worth telling" | on the same seeded rows, each source the loader supplies deep-equals what the dashboard's reader returns for it: `loadFeedHealth`, `findBalanceDrift`, `loadJobHealth`, `loadValuationFindings`, `loadOverdrafts`, `loadForecasts`, `staleWallets(await walletStatuses(), now)`, and `loadMonthOutlook(asOf).outlook.findings`; the sync source deep-equals `classifySyncHealth` applied to rows the test computes with its own SQL grouped on `access_token` | a second, privately written detector in the loader |
| T36-L3 | sync items | two Plaid items, one with a null bank, one healthy: the null-bank item appears once with the inherited text `Unknown` and its own key; the healthy item yields no finding; an item shared by two accounts counts once | merged items; a healthy item reported |
| T36-L4 | viewer-invariant, no row text | a gift held until a future date, with a canary string in the merchant, name and note of its transaction, on an account whose category the held row pushes over budget; the test first asserts by SQL that the row exists, that the canary is in it, and that the gift is held. For the giver's user id, the recipient's, and `null`: the serialised digest (`JSON.stringify`) contains no canary and the three digests are deep-equal | a viewer-dependent figure; row text in the digest |
| T36-L5 | a failed source is not evaluated | with the table `overdraft_forecasts` renamed inside the test (and restored in a `finally`), the loader does not throw; `forecasts` is in `notEvaluated`; no `overdraft-forecast` finding appears; the error is logged; and, because the freshness facts read the same table, every returned finding has freshness `undated` with at least one undated input and none is `fresh`. After the table is restored the same call supplies all nine | a failure turned into "supplied and empty"; fresh by default after a failed facts read |
| T36-L6 | clock-free loader | the same seeded rows read with two different `now` values on the same calendar day, an hour apart, give deep-equal digests; no query text in the loader contains a database clock | `NOW()` in the loader |
| T36-L7 | empty is not good news, for real | a world with a scheduler run today, every account fresh, no budgets over, nothing stale: the digest has zero items, all nine sources evaluated, status `none-reported`, and the all-clear phrase check passes on every statement | the real-pipeline empty case reading as good news |

## Acceptance commands
All from the repo root under `bash`. `B="$(git merge-base HEAD main)"`. BASE and IBASE are T4's and T7's recorded numbers. Commands that need `|` are in blocks below the table.

| # | Command | Expected | Would break if |
|---|---|---|---|
| 1 | `(cd apps/web && npx tsc --noEmit; echo "exit=$?")` | `exit=0` | a type the page or view gets wrong; a producer type changed |
| 2 | `npx tsc --noEmit; echo "exit=$?"` | `exit=0` | a repo-wide type break |
| 3 | `npm run lint; echo "exit=$?"` | `exit=0`, warning count not above the pre-change count | a lint regression, including an unused viewer argument handled badly |
| 4 | block A below | 0 failed; test files exactly BASE + 1; tests at least BASE + 12 + 5 | a stray or skipped test |
| 5 | block B below, three zones | one line per zone: `OK 71 unit scenarios (34 T34 + 20 T35 + 17 T36) each present once and passed TZ=<zone>` | a missing, duplicated, skipped or zone-dependent scenario; any earlier rule regressed |
| 6 | block C below | `OK <IBASE + 7> integration tests, none failing except RC-03; T35-R1..R9 and T36-L1..L7 each present once and passed` | a missing integration scenario; any route test red |
| 6b | block C with the shuffle flag recorded at T12 | the same `OK` line | the new integration file relying on another file's leftover rows |
| 7 | block D below | no output | a UTC date slice; a comma-grouped or two-decimal currency figure in added code |
| 8 | block E below | no output | any file modified or added outside the declared set |
| 9 | block F below | no output | a code line changed in a file that may change only its comments |
| 10 | block G below | no output | an existing test assertion removed or weakened |
| 11 | block H below | no file listed, `rc=1` | any file other than the declared importers reading the vocabulary or the loader |
| 12 | `git diff --quiet "$B" -- packages migrations db && echo UNTOUCHED; git ls-files -o --exclude-standard -- packages migrations db` | `UNTOUCHED`, then no further output | any contract, migration or schema change |
| 13 | block I below | `exit=0`, then at least one line mentioning `/digest` in the format T13 recorded | the page failing the Next build or not being a route |
| 14 | block J below | no output | an all-clear phrase in the new files, even in a comment (weak by design; D7 and L7 are the real evidence) |

**Block A (#4).**
```
npm test 2>&1 | tail -8
```
Record the "Test Files" and "Tests" lines; they must be BASE files + 1 and at least BASE tests + 17 (the 12 pure scenarios plus the 5 wiring scenarios), with `0 failed`.

**Block B (#5, three zones).**
```
set -e; for TZV in UTC Pacific/Auckland America/Los_Angeles; do O="$(mktemp)"; (cd apps/web && TZ=$TZV npx vitest run findings.test.ts findingsFreshness.test.ts findingsDigest.test.ts findingsWiring.test.ts --reporter=json --outputFile="$O") || true; node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);const rng=(p,n)=>[...Array(n).keys()].map(i=>p+(i+1));const old=[...rng("C",6),...rng("V",14),...rng("A",8),...rng("W",6)].map(i=>"T34-"+i);const t35=[...rng("C",4),...rng("F",13),...rng("W",3)].map(i=>"T35-"+i);const t36=[...rng("D",12),...rng("W",5)].map(i=>"T36-"+i);let bad=[];for(const id of [...old,...t35,...t36]){const m=t.filter(x=>x.title.startsWith(id+":"));if(m.length!==1||m[0].status!=="passed")bad.push(id+"="+m.map(x=>x.status).join("/")+"("+m.length+")")}const failed=t.filter(x=>x.status!=="passed").map(x=>x.title);if(bad.length||failed.length){console.log("FAIL",process.argv[2],bad.join(","),failed.join(" ; "));process.exit(1)}console.log("OK 71 unit scenarios (34 T34 + 20 T35 + 17 T36) each present once and passed TZ="+process.argv[2])' "$O" "$TZV"; done
```
The filters match the four test files (`packages/contracts/findings.test.ts`, `lib/domain/findings.test.ts`, `lib/domain/findingsFreshness.test.ts`, `lib/domain/findingsDigest.test.ts`, and `lib/findingsWiring.test.ts`). Titles are matched by the id plus a colon, so `T36-D1:` does not match `T36-D10:`. A scenario that exists but is skipped fails (status must be `passed`).

**Block C (#6 and #6b).**
```
set -e; O="$(mktemp)"; (cd apps/web && DATABASE_URL=postgresql://localhost/b8_p36_throwaway npx vitest run --config vitest.integration.config.mts --reporter=json --outputFile="$O") || true; node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);const bad=t.filter(x=>x.status==="failed"&&!x.title.startsWith("RC-03:")).map(x=>x.title);const ids=[...Array(9).keys()].map(i=>"T35-R"+(i+1)).concat([...Array(7).keys()].map(i=>"T36-L"+(i+1)));const miss=[];for(const id of ids){const m=t.filter(x=>x.title.startsWith(id+":"));if(m.length!==1||m[0].status!=="passed")miss.push(id+"("+m.length+")")}if(bad.length||miss.length||t.length<1){console.log("FAIL",bad.join(" ; "),miss.join(","));process.exit(1)}console.log("OK",t.length,"integration tests, none failing except RC-03; T35-R1..R9 and T36-L1..L7 each present once and passed")' "$O"
```
Expected total equals IBASE + 7. For #6b, the vitest invocation gains the shuffle flag spelled as T12 recorded, with a fixed seed, and the same node check runs. Known failing: RC-03 only (it may also pass).

**Block D (#7, added-lines guard; weak by design, never the feature's evidence).**
```
B="$(git merge-base HEAD main)"; { git diff -U0 "$B" -- apps packages | grep '^+' ; git ls-files -o --exclude-standard -- apps packages | grep -E 'findings|Digest|digest' | xargs -r cat; } | grep -nE "toISOString\(\)\.(slice|split)|\\\$[0-9]+\.[0-9]{2}\b|\\\$[0-9]{1,3}(,[0-9]{3})+|\\\$[0-9]"
```
Expected no output (grep exit 1). The last alternative also rejects any dollar sign followed by a digit, because a comment such as a "zero-budget" example must not read as a figure.

**Block E (#8, scope guard).**
```
B="$(git merge-base HEAD main)"; set -e; { git diff --name-status "$B" -- . ':(exclude)plan' ':(exclude)*AGENTS.md' ':(exclude)*CLAUDE.md' | grep -vE '^M\s+(apps/web/lib/findingsWiring\.test\.ts|apps/web/vitest\.integration\.config\.mts|apps/web/lib/domain/findings\.ts|apps/web/lib/domain/findingsFreshness\.ts|apps/web/scripts/findings-freshness-read\.test\.ts|apps/web/lib/giftSurfaceRegistry\.ts)$' || true; } ; { git ls-files -o --exclude-standard -- . ':(exclude)plan'; git diff --name-only --diff-filter=A "$B" -- . ':(exclude)plan'; } | sort -u | grep -vE '^(apps/web/lib/domain/findingsDigest(\.test)?\.ts|apps/web/lib/findingsDigestRead\.ts|apps/web/scripts/findings-digest-read\.test\.ts|apps/web/app/digest/page\.tsx|apps/web/components/DigestView\.tsx)$' || true
```
Expected no output from either half. The first half prints any modified-but-undeclared, deleted or renamed file; the second any added-but-undeclared file. Discrimination: appending a comment to `apps/web/components/AlertBell.tsx` must make the first half print a line, and creating `apps/web/lib/zzprobe.ts` must make the second half print one (the orchestrator runs both probes and reverts). Five files are modified and six added; this is the complete scope.

**Block F (#9, comment-only files).**
```
B="$(git merge-base HEAD main)"; for f in apps/web/lib/domain/findings.ts apps/web/lib/domain/findingsFreshness.ts apps/web/scripts/findings-freshness-read.test.ts; do git diff -U0 "$B" -- "$f" | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -vE '^[+-][[:space:]]*(//|/\*|\*)'; done
```
Expected no output. Discrimination: changing one code token in `findingsFreshness.ts` makes it print that line (the orchestrator probes and reverts).

**Block G (#10, no assertion removed or weakened).**
```
B="$(git merge-base HEAD main)"; git diff -U0 "$B" -- apps/web/lib/findingsWiring.test.ts apps/web/lib/domain/findings.test.ts apps/web/lib/domain/findingsFreshness.test.ts packages/contracts/findings.test.ts apps/web/lib/domain/jobHealth.test.ts | grep -E '^-' | grep -vE '^---' | grep -E "expect\(|\bit\(|\btest\(|describe\("
```
Expected no output. Lines changed in the widened checks and the declared-importer set are definitions, not assertions, so they do not appear here; a deleted `expect(`, `it(` or `describe(` does.

**Block H (#11, who imports the vocabulary).**
```
grep -rlE "domain/findings|@b8/contracts/findings|findingsFreshnessRead|findingsDigestRead" apps/web packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=.next | grep -vE '\.test\.ts$|lib/domain/findings[A-Za-z]*\.ts$|packages/contracts/findings\.ts$|lib/findingsFreshnessRead\.ts$|lib/findingsDigestRead\.ts$|app/digest/page\.tsx$|components/DigestView\.tsx$' ; echo "rc=$?"
```
Expected no file listed and `rc=1`. This is the P5-35 containment check with the three new declared importers added. Discrimination: appending `import '@/lib/domain/findingsDigest';` to `apps/web/components/AlertBell.tsx` makes it list that file (probed and reverted by the orchestrator).

**Block I (#13).**
```
O="$(mktemp)"; npm run build >"$O" 2>&1; echo "exit=$?"; grep -n "/digest" "$O"
```
Expected `exit=0` and at least one matching line shown in the format T13 recorded for `/dashboard`.

**Block J (#14).**
```
grep -nEi "all clear|good news|nothing to report|no issues|all good|on track|nothing wrong" apps/web/lib/domain/findingsDigest.ts apps/web/lib/findingsDigestRead.ts apps/web/components/DigestView.tsx apps/web/app/digest/page.tsx; echo "rc=$?"
```
Expected no matches and `rc=1`. (A comment that quotes such a phrase to forbid it must paraphrase it.)

## Negative controls
| # | Rule | Input that must be rejected or excluded | Asserted by |
|---|---|---|---|
| 1 | undated and never are never fresh | an `undated` finding and a `never` finding counted into the `fresh` tally, or worded with age | T36-D4, T36-D8, T36-D9 |
| 2 | a recent last success is not a working feed | `feed-degraded` `failing` with freshness `fresh`, worded as fresh, healthy, ok or recovered | T36-D5 |
| 3 | not evaluated is not all clear | zero findings with a source not supplied reported as `none-reported` | T36-D6, T36-L5 |
| 4 | empty is not good news | any all-clear phrase in a headline, coverage or item statement; the real empty world | T36-D7, T36-L7, #14 |
| 5 | a failed source is not "supplied and empty" | the `overdraft_forecasts` table removed during the read | T36-L5 |
| 6 | a failed facts read is not fresh | every finding after the facts read fails | T36-L5 |
| 7 | the period is a real date and the findings share it | `2026-02-30`, `2026-13-01`, an `asOf` finding one day off | T36-D3 |
| 8 | severity is never inverted by the reader order | a notice above a warning, a warning above a critical | T36-D2 |
| 9 | the forecast leads the "never" warnings | `sync-stale` never and `valuation-stale` never ahead of `overdraft-forecast` | T36-D2 |
| 10 | nothing is merged or dropped | two findings, same kind, same subject name | T36-D1 |
| 11 | no money in prose | a `$` or two-decimal figure in a statement | T36-D11 |
| 12 | no viewer sees a held gift's text, and figures do not vary by viewer | a canary in merchant, name and note of a held row, read as giver, recipient and `null` | T36-L4 |
| 13 | the loader holds no database clock | `CURRENT_TIME`, `LOCALTIME`, `'now'::` and the older families | T36-W1, T36-L6 |
| 14 | severity has one home | a literal reaching `severity` through a lookup table, a helper return, or a file under `scripts/` | T36-W2 |
| 15 | the digest module neither judges age nor writes severity | a threshold import, a numeric literal, a severity assignment, a clock | T36-W4 |
| 16 | the page is thin | a second `new Date()`, `Math.abs` on a figure, a database import, a severity word in a literal | T36-W5 |
| 17 | the vocabulary has only the declared importers | the dashboard, the bell, the email digest, an API route | T36-W3, #11 |
| 18 | the loader is not a second detector | any source differing from the dashboard's reader on the same rows | T36-L2 |
| 19 | no contract, migration or schema change | any file under `packages`, `migrations`, `db` | #12 |
| 20 | existing assertions stay | a removed `expect(`, `it(`, `describe(` | #10 |
| 21 | comment-only means comment-only | a code line changed in `findings.ts`, `findingsFreshness.ts`, or the R-file | #9 |
| 22 | nothing outside the declared set changes | any other modified or added file | #8 |

## Evidence required
- Block B output for all three zones; blocks A, C, #6b, E, F, G, H, I and #12 outputs captured verbatim by the orchestrator, with BASE, IBASE and the T13 route-line format recorded.
- A printed table from a test run: for each of the four freshness states, and for the kinds `feed-degraded`, `sync-stale`, `job-overdue` and one other, the `caveat` value and the `status` the digest assigned (names and enum values only, no figures).
- One printed digest over fabricated data for each of the three statuses (`findings`, `incomplete`, `none-reported`): the headline, coverage statement, tallies, and the ordered list of kinds with each item's statement. No money figure in EVIDENCE.md: print statements and kinds only.
- The mutation log, one entry per mutation below, with the failing scenario ids.
- **Browser check by the orchestrator (evidence, not a gate command):** with the scratch demo database and the test session cookie per the local-ui-preview note, load `/digest` in three states: a world with findings of several kinds including a failing feed with a recent success; a world where one source is made unreadable; and a world with nothing reported. Confirm: the failing feed reads as failing and does not read as fresh; the unreadable source is named; the empty world states how many sources reported nothing and contains no all-clear wording; a negative amount keeps its minus; an undated finding says it cannot be dated; at a 390-pixel width nothing is clipped. The implementer must invoke the `uiux-promax` skill before building the page and the view.
- A short note in EVIDENCE.md for step 37's author: what the digest guarantees (carriage, order, dating, coverage, no row text), what it deliberately does not say (no all-clear, no weekly content), and the dispositions above.
- No money figure, real name or merchant in EVIDENCE.md.

Orchestrator-applied mutations (G2/G3), one at a time, each reverted with the tree checksum unchanged. At least the named scenarios must fail; a broader set is accepted with a reason:
- M1 de-duplicate items by kind and subject name → T36-D1.
- M2 sort by severity only, ignoring the kind table → T36-D2.
- M3 drop the input-order tie-break within a kind (unstable sort) → T36-D2.
- M4 give the feed caveat `null` and the word "fresh" in the statement → T36-D5.
- M5 report `none-reported` whenever the list is empty, whatever `notEvaluated` says → T36-D6.
- M6 add an "all clear" sentence for `none-reported` → T36-D7, #14.
- M7 count `undated` into the `fresh` tally → T36-D8, T36-D9.
- M8 skip period validation → T36-D3.
- M9 add `new Date()` inside `composeDigest` → T36-D10, T36-W4.
- M10 loader returns `[]` for a source whose read throws instead of omitting it → T36-L5.
- M11 loader drops the freshness context → T36-L1 (and the freshness states).
- M12 loader falls back to `fresh` when the facts read throws → T36-L5.
- M13 put `CURRENT_TIME` in a loader query → T36-W1.
- M14 assign `severity` from a lookup table in a file under `scripts/` → T36-W2.
- M15 loader reads `visibleTransactions(viewer)` and sums from it → T36-L4, T36-W5.
- M16 page makes a second `new Date()` → T36-W5.
- M17 loader writes its own drift query → T36-L2.
- M18 digest assigns a `severity` literal → T36-W4.
- M19 an undeclared module (the bell) imports the digest module → T36-W3, #11.
- M20 a statement composes a figure with `$` → T36-D11.

## Failure modes to test
- A recent last success on a failing feed reading as a working one: the headline carry-in of this step (D5).
- An empty list read as good news, in three forms: nothing supplied, a source silently dropped, a source that threw and was turned into an empty array (D6, D7, L5, L7).
- `never` and `undated` collapsed into `fresh`, or counted in the wrong tally; a null age rendered as "0 days" (D4, D8, D9).
- A kind order that puts a "never synced" notice-level thing above an overdraft that has not happened yet, or that lets a notice rise above a warning; a sort that depends on the order the producers happened to be listed (D2).
- Two findings merged because they share a bank name or a kind (D1), including the inherited `Unknown` text for a null bank, which is not identity (L3).
- A period caption that disagrees with the findings' own as-of dates; the date formed from the UTC day (a day early in any positive-offset zone), or from a leap-day that does not exist (D3).
- A year-end or New-Year boundary: the as-of triple and the period date read from two clocks. The page has one clock read (W5).
- A float artefact or a sign flip on a money figure: none is allowed to occur because none is computed, but a view that "formats" a string through `Number` would round or flip it; guarded by W5. A negative drift on a credit account and a negative overdraft balance both keep their minus.
- A viewer-dependent figure, or a transaction's merchant, name or note reaching the digest through a loader that was given a row source (L4, W5). The forecast's `charges` are dropped by the contract and must stay dropped.
- A database clock hiding in the loader under a name the old check did not know (`CURRENT_TIME`, `LOCALTIME`, `'now'::timestamptz`) (W1).
- A severity literal reaching a `severity` key through a lookup or a helper, in a file nobody scanned (W2).
- A source whose read fails taking the whole page down, or being swallowed as "nothing found" (L5). A facts read that fails leaving findings stamped `fresh` (L5).
- The loader's duplicate sync-item query drifting from what the card computes: the card is private, so the test computes the expected value independently (L2, L3).
- Double counting from a JOIN where an EXISTS was needed: the freshness read already guards this (the P5-35 R-file); the new loader must not add a transaction join of its own. Any new SQL that names `transactions` must select only kept columns and is scanned by W1/W3.
- `DigestView` re-deriving something already derived: a second count, a second threshold, a second sentence (W5).
- Test isolation: the new integration file leaning on rows another file leaves (6b), or leaving a renamed table behind after a failure (L5's `finally`).
- Name collision with the existing email digest: importing `lib/domain/digest.ts` or `lib/digestRead.ts` by mistake (W3).
- Counting tests by title prefix: a title that begins `T36-D1` also matches `T36-D10` unless the colon is part of the match (the scripts match the colon).

## Open questions for the owner
Product decisions not derivable from code. The spec is written assuming each default.
1. **What the third parameter is.** The roadmap writes `(findings, period, freshness) → Digest`. Every finding already carries its own freshness, so the third parameter would repeat it. Default: the third parameter is coverage, `{ notEvaluated }`, the one thing a list of findings cannot say about itself. Alternative: pass the freshness facts again and let the digest re-judge ages (a second implementation of what step 35 already did; rejected).
2. **The route name.** Default: `/digest`. The daily email is also called "the digest" in the code (`lib/domain/digest.ts`). Alternative: `/findings` or `/briefing`, which avoids the double meaning but moves away from the roadmap's word. Changing the route changes only one path string and one file path.
3. **The reader order of kinds within a severity (N4).** Default: overdraft-open, overdraft-forecast, budget-breach, balance-drift, feed-degraded, sync-stale, job-overdue, cash-uncounted, valuation-stale, budget-underspend. The reasoning: money at risk first, then figures that may be wrong, then the feeds that explain them, then reminders. Severity always wins first. Alternative: keep the assembler's source order (which puts a forecast after "never synced" warnings).
4. **Gift masking of figures (N5).** Default: figures are the same for every viewer, as everywhere else in the app, and the digest carries no row text. Consequence the owner should know: the recipient of a gift could in principle see a category breach caused by the gift's amount, exactly as the dashboard's tiles already show it. Alternative: build the producer inputs per viewer so the recipient's digest excludes held-gift amounts; the digest and the dashboard would then disagree for that person, which P7-41b ruled out.
5. **A source that fails to read.** Default: the page still renders, the failed source is listed as not evaluated, and the error is logged. Alternative: let the page error out (loud, but the owner sees nothing), which makes "not evaluated" unreachable on this page.
6. **A navigation entry.** Default: none; the page is reachable at its URL, to keep this step to its size and leave the sidebar alone. Alternative: one link in the sidebar, a one-line change to `components/Sidebar.tsx` that this spec would then add to the scope.
7. **Money display.** Default: each money string is shown exactly as the finding carries it (two decimals, leading minus when negative, no currency symbol, no digit grouping). Alternative: add a symbol and grouping in the view, which brings sign placement (the minus sign before or after the currency symbol) into the page and would need its own scenario.
8. **The `INDEXES` cache (P5-35 N2).** Default: document that facts must not be mutated after they are passed in, no code change. Alternative: delete the cache and index on every call; correct, slightly slower on a path that runs once per request.
9. **The empty statement.** Default: a neutral count ("N sources evaluated and reported nothing") with the unevaluated sources named, and nothing that reads as good news; step 37 writes the real "nothing to report" statement. Alternative: have this step already say "nothing to report" with a figure behind it; rejected because the figure is step 37's.

## Rollback
Nothing is stored and nothing is sent. Revert the commit, or restore the five modified files from `git` (`apps/web/lib/findingsWiring.test.ts`, `apps/web/vitest.integration.config.mts`, and the comment-only `apps/web/lib/domain/findings.ts`, `apps/web/lib/domain/findingsFreshness.ts`, `apps/web/scripts/findings-freshness-read.test.ts`) and delete exactly the six new files: `apps/web/lib/domain/findingsDigest.ts`, `apps/web/lib/domain/findingsDigest.test.ts`, `apps/web/lib/findingsDigestRead.ts`, `apps/web/scripts/findings-digest-read.test.ts`, `apps/web/app/digest/page.tsx` and `apps/web/components/DigestView.tsx`. No migration, no `down`, no data to restore. Because the page is reachable only by its URL and nothing links to it, removing it affects no other screen. After the revert the vocabulary again has no consumer, and acceptance #11 in its P5-35 form (without the three new declared importers) holds again. If step 37 has started, it depends on `composeDigest` and `FindingsDigest`, so reverting after it begins is not clean.
