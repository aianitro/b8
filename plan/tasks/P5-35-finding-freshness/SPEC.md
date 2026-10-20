# P5-35-finding-freshness — Freshness becomes a property of every finding
**Roadmap item:** ROADMAP.md §5 Phase 5 step 35 — a finding carries the staleness of its worst input, and a finding whose inputs cannot be dated says so
**Status:** FROZEN@G0 (2026-10-19)
**Author:** spec-writer

## Goal
After this task every `Finding` carries a required `freshness` object saying as of when its worst input is believed true. The object states one of four things: the worst input is `fresh`, it is `stale` (older than the threshold the existing producer for that input already uses), it was `never` observed, or it is `undated` (the database keeps no usable record of when it was last true, or the record is unusable). `undated` is a value in its own right. It is never reported as `fresh` and never defaults to `fresh`.

Freshness is judged against one instant, `now`, passed in. The pure modules read no clock. The assembler's existing as-of calendar triple must be the one derived from that same instant, and it throws `RangeError` if it is not. Facts about when each input was last observed come from one new read module that queries the database. That module takes no viewer and selects only columns that gift masking keeps, so it is identical for every viewer by construction.

Four steps of P5-34 carry-ins are disposed of here:
- **N3 (fix):** the producer `jobHealth` is wrong. The contract is right.
- **N2:** deferred with a stated reason.
- **Feed `unknown`:** becomes visible as `undated` inputs, not as a new kind.
- **Property subject:** not added.

Severity, ordering, count and every other field of every finding are unchanged by freshness. No card, no overview payload, no digest, no narration changes.

## Inputs by kind (found by reading code and `db/schema.sql`)
"Input" means a recorded fact the finding's truth rests on. The "last believed true" record is the column named. Thresholds are the existing exported constants, imported by name, never copied. Note that `STALE_AFTER_DAYS` exists with different values in both `syncHealth.ts` (sync) and `walletStaleness.ts` (wallets); the two must be imported under distinct aliases.

| Kind | Inputs and where "last believed true" is recorded | Threshold and comparator (the producer's own) | Cannot be dated when |
|---|---|---|---|
| `sync-stale` | the item's last successful sync: `MAX(accounts.last_synced_at)` over the item (grouped by `access_token`), keyed by the same key the producer uses, `MIN(accounts.id)`. `sync.ts` advances it only after a success. | `syncHealth.STALE_AFTER_DAYS`; whole days `floor(ms/86_400_000)`, stale when `>=` | no item row for the key |
| `feed-degraded` | Plaid's last successful refresh of the item: the finding's own `lastSuccessfulUpdate`. Self-contained; no join (the finding has no item key, only an institution name). Not-done and why: the app's own last sync of that item is a second input, but it is covered by the `sync-stale` finding for the same item. | `feedHealth.STALE_AFTER_HOURS`; stale when `ms > hours * 3_600_000`, strictly greater | never (a failing feed with no success is `never`, see feed-unknown below) |
| `balance-drift` | the ledger (transactions arrive by sync) and the Plaid balance (written by the same sync). Both are dated by the account's item sync (`last_synced_at`) and the item feed success. **Not** by `DriftFinding.observedAt`: `account_valuations` `plaid_balance` rows are a change log, so its newest `valued_at` is when the balance last changed, not when it was last confirmed. | as `sync-stale` and `feed-degraded` | the account has no item row |
| `cash-uncounted` | `MAX(cash_counts.counted_at)` for the wallet | `walletStaleness.STALE_AFTER_DAYS`; days floored, stale when `>=` | never (no count row), see below |
| `valuation-stale` | `MAX(account_valuations.valued_at)::date` for the account: a calendar date as Postgres renders it in the session zone, the same expression `loadValuationFindings` uses | `valuationStaleness.VALUATION_STALE_DAYS`; calendar-day difference between that date and the as-of date, stale when `>=` | never valued is `never`; a malformed date string is `undated` |
| `job-overdue` | latest `sync_log.ran_at` where `trigger = 'scheduler'` (manual syncs never count, as in `loadJobHealth`) | the producer's own status. `LATE_AFTER_HOURS` is private to `jobHealth.ts` and must not be copied: `late` and `missed` are `stale`, `never` is `never` | a last run later than `now` |
| `overdraft-open` | the open episode's `overdraft_episodes.last_seen_at` (when the balance was last read below the cushion; an episode stays open until a sync sees recovery) | `syncHealth.STALE_AFTER_DAYS` (the sync cadence) | the episode row has gone (closed) between reads |
| `overdraft-forecast` | the open forecast's `overdraft_forecasts.projected_at` | `syncHealth.STALE_AFTER_DAYS` | as above |
| `budget-breach` | for every account that has contributed at least one transaction to the category in the as-of year: that account's observation by account class (below). The budget allocation itself (`annual_budget`, `monthly_amounts`) is owner-authored configuration, not an observation; it is not an input (it has no "last believed true" and stops being true only by edit). | per account class | no contributing account found, or any contributing account is class-undatable |
| `budget-underspend` | the same set, over the same year | per account class | as above |

Contributing accounts for a category: the accounts with at least one transaction where `mapped_category = <category name>`, `hidden = FALSE`, the account has `track_transactions = TRUE`, and `EXTRACT(YEAR FROM date)` is the as-of year. This is the row filter `readBudgetVsActual` applies. Membership is an EXISTS: an account with many such transactions counts once. A category finding is only ever about an operational, non-excluded, non-income category (the producer already filters), so landscape and `exclude_from_budget` on categories are applied upstream and freshness adds none. An account's own `landscape` does not exclude it (the grid does not).

Account classes (what dates an account that contributed transactions):
1. **Plaid-linked** (`access_token IS NOT NULL`): two inputs, the item's sync (above) and the item's feed success. The feed input is: success timestamp present, dated; both success and failure timestamps null (feed state `unknown`), `undated`; failure recorded but no success, `never`.
2. **Countable cash** (`countable`, no token): the last cash count; `never` if none.
3. **Valuation-mode, no token**: the latest valuation date.
4. **Manual ledger, not countable, no token** (for example a hand-added credit card, a CSV-imported account): `undated`. The database records no import date for these; `transactions.created_at` is when a row was entered, not as of when the account is believed complete. Open question Q1.

## Non-goals
Each is enforced by the reviewer as a defect if present.
- **No narration.** No sentence, no wording, no digest, no `Digest` type, no page, no route, no delivery. `JobHealth.message` stays carried verbatim.
- **No change to severity, confidence, ordering, count or any non-freshness field of any finding.** Freshness never raises, lowers, hides, re-ranks or removes a finding. A stale finding and a fresh finding of the same kind and state keep the same severity.
- **No new finding kind and no new detector.** In particular: no `feed-unknown` kind, no backup-rehearsal kind, no pending-proposal kind, no property-valuation kind, no "stale input without a producer finding" kind.
- **No property subject, no property freshness.** See Q3.
- **No new threshold and no copy of one.** The numbers 2, 30, 36 and 100 do not appear as literals in the freshness modules. `LATE_AFTER_HOURS` is not exported, copied or re-derived.
- **No change to any card, the alert bell, the digest, `breachAlert`, push, `OverviewDataSchema`, `overviewRead`, `overviewFromWire`, the overview route or the dashboard page.** `SyncHealthCard`, `JobHealthCard`, `FeedHealthCard`, `loadFeedHealth`, `loadJobHealth`, `loadValuationFindings`, `findBalanceDrift`, `loadOverdrafts`, `loadForecasts` and `classifySyncHealth` are unmodified. The new read module duplicates their queries; it does not refactor them (the duplication is recorded in Failure modes).
- **No migration, no table, no column, no index, no persisted freshness.** Freshness is derived at read time.
- **No change to `syncHealth.ts`, `feedHealth.ts`, `walletStaleness.ts`, `valuationStaleness.ts`, `drift.ts` or `overdraftWatch.ts`.** The `Unknown` bank string substitution stays (see disposition). The only existing producer changed is `jobHealth.ts` (N3).
- **No viewer parameter and no row text.** The read module returns dates, ids and counts only. No merchant, name, note, description or amount of any transaction, and no `giftReadPath` import.
- **No clock read** in the pure modules (`Date.now()`, zero-argument `new Date()`, `Math.random()`), and no SQL clock (`NOW()`, `CURRENT_DATE`, `CURRENT_TIMESTAMP`, `clock_timestamp()`) in the read module's judgement path.
- **No parsing of a timestamp string in the pure modules.** The read module hands over `Date` objects (pg `timestamptz`) and the valuation date as `YYYY-MM-DD`. Postgres's `::text` rendering (for example `2026-03-05 06:00:00+00`) is not a format the pure modules may rely on `new Date()` to parse.
- **No real name, merchant or money figure** in any tracked file, commit message or EVIDENCE.md (public repository). Fixtures are fabricated: `Fabricated Credit Union`, `Fixture Checking`, `Fixture Category`. Counts of days, hours and tests are allowed.
- **No edit to any existing test's assertions or removal of any test.** Existing P5-34 scenarios `T34-C1..C6, V1..V14, A1..A8, W1..W6` keep their ids and their asserted rules. Their fixtures may be adapted only to supply the new required `freshness` key.

## Disposition of the P5-34 carry-ins
1. **N3 — `jobHealth` returns `late` with `daysSince: -1` when the last run is stamped later than `now` on a different calendar day. Producer wrong, contract right.** A count of days since an event cannot be negative; loosening the contract to admit `-1` would legitimise a skewed-clock artefact in every consumer. Required behaviour of the fixed `jobHealth`: for every `lastRun > now`, `daysSince >= 0`, and the verdict is the one it would give for `lastRun = now` (`fresh`, `daysSince: 0`, `'The daily job ran today.'`): a recorded run is evidence the job ran, and it is the clock that is wrong. For every `lastRun <= now`, the output is deep-equal to the pre-change function over all three fields. The freshness layer separately reports any instant-class input later than `now` as `undated`. Accepted consequence: a skewed future-dated run produces no `job-overdue` finding at all. Open question Q2.
2. **N2 — backup-rehearsal mismatch (`CountMismatch`) and pending proposals (`StoredProposal`): deferred, both registered `excluded` in the inventory with a reason of at least 20 characters.** `compareCounts` runs inside `scripts/backup.ts`, throws, and leaves no record anywhere the app can read later. A kind would need a persisted outcome, which is a migration. `StoredProposal` is a workflow item awaiting a decision, not a detection, and its expiry is not a staleness of any believed fact. Neither is a `*Finding`/`*Health` name, so the W3 heuristic cannot find them; they are hand-read entries, and W6 keeps them honest.
3. **Feed `unknown` (neither success nor failure recorded).** `feedFindings` still does not report it (unchanged producer). Freshness makes it visible without a new kind: an Plaid-linked account whose item is `unknown` contributes an `undated` feed input to every budget and drift finding that rests on it, counted in `undatedInputs`. A standalone row for it is rejected because a manual-only household would have permanent rows no action can clear, which is exactly why `feedHealth` skips it.
4. **`Unknown` bank string.** The sync producer's `bank ?? 'Unknown'` substitution is unchanged (changing it alters `SyncHealthCard`). Freshness is never keyed by an institution name: sync findings are looked up by the producer's `key`, and the feed's `COALESCE(MIN(bank), 'Unknown institution')` is a different string for the same absence. Two items that both have no bank must never share, merge or overwrite a freshness record.
5. **Property subject.** None added. No finding depends on a property value, `property_valuations` has no existing stale threshold, and `valuationStaleness.ts` documents that a property "has its own revaluation rhythm", so reusing `VALUATION_STALE_DAYS` would be a wrong copy. Open question Q3.

## Contracts touched
| File | Change | Class (§9.2) |
|---|---|---|
| `packages/contracts/findings.ts` | a required `freshness` object on each of the ten members (see shape); no existing field changes | additive in effect. A required key makes previously valid values fail to parse, which is breaking in form. It is treated as additive only because no non-test file imports the module (acceptance #10 proves it) and the value is never persisted or served. contract-guardian must confirm the class under §9.2 and record why. |
| `packages/contracts/findings.test.ts` | adapt fixtures; add C1–C4 | additive |
| `migrations/**`, `db/schema.sql`, `shared/types.ts`, `packages/contracts/index.ts`, `CONTRACT_SCHEMAS`, `overview.ts` | none | none |

Observable requirements on the freshness shape (field names are contract-guardian's to confirm; the semantics are not):
- Present on every member; not optional; not nullable; strict (an unknown key is rejected).
- It states: a state in exactly `fresh | stale | never | undated`; a basis naming which kind of input is the worst one, from a closed list (the sync, the feed, a valuation, a cash count, the job run, an overdraft sighting, an overdraft projection, or none); the worst dated input's observation, in its own precision; its age in whole days, an integer that is never negative; and a count of inputs that could not be dated.
- Coherence is enforced by refinement, as P5-34 enforced never⇔null: `fresh` and `stale` have an observation and an age; `never` and `undated` have neither; `fresh` requires zero undated inputs; `undated` requires at least one; an age below zero is rejected.
- **Precision.** A valuation is a calendar date and must be carried as a date, never as an instant at midnight (that would invent a time and a zone). Every other basis is an instant, carried as an ISO string.
- `job-overdue.daysSince` stays `>= 0` (the N3 decision).

## Conventions this task must honor
- **Sign:** no money amount is added, computed or changed. Every existing money field keeps its P5-34 sign (drift negative on a credit account; overdraft balance may be negative). The only numbers this task adds are ages, which are `>= 0`. An observation later than `now` is never carried as a negative age; the input is `undated`.
- **Rounding:** no money arithmetic. Ages are whole days floored per input, `floor(ms / 86_400_000)`, as `classifySyncHealth` and `staleWallets` do; the feed's strict `>` test is done on milliseconds, not on the floored day. Valuation age is an integer calendar-day difference of two `YYYY-MM-DD` strings by UTC date arithmetic, as `valuationStaleness` does. No input's age is rounded to compare against a threshold that the producer compares in milliseconds.
- **Landscape + exclusions:** freshness adds no filter to the findings and drops none. For the contributing-account set it applies `transactions.hidden = FALSE` and `accounts.track_transactions = TRUE`, the same as `readBudgetVsActual`; it applies neither `exclude_from_budget` nor a landscape test, because those are properties of the category already applied by the producer.
- **Null semantics (load-bearing):** the four states are never conflated. `never` means a recorded absence (no count row, no valuation row, `last_synced_at IS NULL`, a feed with only a failure). `undated` means the database keeps no usable record (manual ledger account, `unknown` feed, no contributing account, an unsupplied context, an observation after `now`, a malformed date). A finding with no inputs is `undated`, not `fresh`. The aggregation order is: any input `never` gives `never`; else any dated input stale gives `stale`; else any input undated, or no inputs, gives `undated`; else `fresh`. The worst dated input is the oldest; a tie is broken by the fixed order of the basis list. A finding that is `stale` and also has undated inputs says so in the count.
- **Time:** one instant `now: Date` passed in; the as-of triple is derived from it by the existing `asOfFromDate` (process-local fields), and the assembler throws `RangeError` when they disagree. Instant arithmetic is millisecond subtraction (zone-free). Valuation dates are Postgres session-zone dates of `valued_at` and compare to the as-of triple's calendar date; both are the server's calendar, which is the same assumption `loadValuationFindings` makes today. Results must not depend on the process time zone (tested under three). A last-sync write landing between the caller's clock read and the query can sit a few milliseconds after `now`; that reads as `undated`, accepted as safe.

## Toolchain prerequisites
All commands run under `bash`. The orchestrator verifies every row before G0 passes.

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `psql`, `createdb`, `dropdb`, local Postgres with CREATEDB | **yes** (#6) | local install | `psql -d postgres -tAc "select 1"` → `1` | filled at G0 |
| T2 | a throwaway DB at current head, never `b8_finance` | **yes** (#6) | `createdb b8_p35_throwaway` then `DATABASE_URL=postgresql://localhost/b8_p35_throwaway npm run migrate:up` | `psql postgresql://localhost/b8_p35_throwaway -tAc "select to_regclass('public.cash_counts')::text"` → `cash_counts` | filled at G0 |
| T3 | an exported `DATABASE_URL` wins over `apps/web/.env.local` in `migrate:up` | **yes** | n/a | `DATABASE_URL=postgresql://nobody@127.0.0.1:1/b8_p35_throwaway npm run migrate:up; echo "exit=$?"` → non-zero, connection refused on port 1 | filled at G0 |
| T4 | unit baseline recorded before the change: BASE files, BASE tests | **yes** | existing | `npm test 2>&1 \| tail -8` → record | filled at G0 |
| T5 | `tsc` clean in `apps/web` | **yes** | existing | `(cd apps/web && npx tsc --noEmit; echo "exit=$?")` → `exit=0` | filled at G0 |
| T6 | root `tsc` clean | **yes** | existing | `npx tsc --noEmit; echo "exit=$?"` → `exit=0` | filled at G0 |
| T7 | integration baseline on the unmodified tree: only failing title, if any, begins `RC-03:`; record total as IBASE (236 at the end of P5-34) | **yes** | existing | run command #6 with R-checks skipped | filled at G0 |
| T8 | `typescript` resolvable from `apps/web` | **yes** | existing | `(cd apps/web && node -e 'require.resolve("typescript")'; echo "exit=$?")` → `exit=0` | filled at G0 |
| T9 | `TZ` changes `Date` behaviour in Node here | **yes** | OS tz database | `TZ=Pacific/Auckland node -e 'console.log(new Date(2026,0,1).getTimezoneOffset())'` → `-780`; `TZ=America/Los_Angeles ...` → `480` | filled at G0 |
| T10 | `git merge-base HEAD main` resolves and nothing under `apps packages migrations db` is already modified | **yes** | existing | `git merge-base HEAD main \| wc -l` → `1`; `git status --short -- apps packages migrations db ':(exclude)*AGENTS.md' ':(exclude)*CLAUDE.md'` → no output | filled at G0 |
| T11 | integration config includes a DB-requiring test outside `lib/` by exact path | **yes** | precedent: `scripts/rekey-plaid-ids.test.ts` is listed by exact path in `apps/web/vitest.integration.config.mts` | `grep -c "rekey-plaid-ids.test.ts" apps/web/vitest.integration.config.mts` → `1` | filled at G0 |
| T12 | Chrome, dev server, live Plaid, SMTP, push, Anthropic API, network | **NO** | n/a | n/a | n/a |
| T13 | the dev database `b8_finance` and `.env.local` data | **NO** | n/a | n/a | n/a |

Prerequisites the implementer must create (none exist today). Every scenario title begins with its id exactly as listed (`T35-F1:` …).
- `apps/web/lib/domain/findingsFreshness.ts` — pure: the per-kind input rules, aggregation and the context types. Imports only `lib/domain/**`, the four threshold constants by name, and `@b8/contracts/findings`.
- `apps/web/lib/domain/findingsFreshness.test.ts` — scenarios F1–F13. Imports only pure modules.
- `apps/web/lib/findingsFreshnessRead.ts` — the read module that queries. It takes `now` and returns the facts above; no viewer parameter.
- `apps/web/scripts/findings-freshness-read.test.ts` — scenarios R1–R9, against the throwaway DB with fabricated rows it seeds itself. It must live outside `lib/` (the unit config sweeps `lib/**/*.test.ts` and has no database). Its exact path is added to the `include` list of `apps/web/vitest.integration.config.mts`.
- Contract scenarios C1–C4 inside the existing `packages/contracts/findings.test.ts`; wiring scenarios W1–W3 inside the existing `apps/web/lib/findingsWiring.test.ts`.
- A frozen copy of the pre-change `jobHealth` inside the test file only, as the differential oracle for F10.

## Scenarios
| Id | Rule | Fixture and assertion | Catches |
|---|---|---|---|
| C1 | `freshness` is required, non-null and strict on all ten kinds | each kind's valid fixture parses; omitting the key fails; `null` fails; an extra key inside it fails | an optional or nullable field; a stripping object |
| C2 | state/field coherence | `fresh`/`stale` without an observation or age fail; `never`/`undated` with an observation or age fail; `fresh` with a nonzero undated count fails; `undated` with a zero count fails; a negative age fails | `never` read as zero; `fresh` hiding an undated input |
| C3 | the N3 contract side is unchanged | `job-overdue` with `daysSince: -1` still fails; `0` and `3` pass | loosening the contract to fit a producer bug |
| C4 | precision | a valuation-basis observation as a full instant fails; a date passes; a non-valuation basis given a bare date fails | a date invented into an instant at midnight |
| F1 | every kind's input table | for each of the ten kinds: one fixture per state (fresh, stale, never, undated) asserts the state, basis and age | a kind with no dating rule; a kind defaulting to fresh |
| F2 | worst-input selection | inputs aged 3 and 40 days select the 40; `never` beats a 400-day stale; stale beats undated beats fresh; equal ages tie-break by the fixed basis order, independent of input order | newest chosen; order-dependent result |
| F3 | undated is never fresh | an empty input set, an unsupplied context, and one fresh plus one undated input are each `undated` with the right count; the unsupplied-context count is exactly 1 | defaulting to fresh |
| F4 | agreement with the real producers at the boundary | built from the imported constants: sync at the constant minus 1 day and at the constant, wallet at 29 and 30, feed at exactly 36 h and 36 h + 1 ms, valuation at 99 and 100. The real producers (`classifySyncHealth`, `staleWallets`, `feedFindings`, `staleValuations`) are called; every finding they emit has freshness `stale` or `never`, and every state they do not emit is `fresh` | a copied or off-by-one threshold; `>=` vs `>` confused |
| F5 | an observation after `now` is `undated` | one millisecond ahead, one day ahead, for each instant basis: state `undated`, no age field below zero anywhere | negative age; clamping to fresh |
| F6 | drift is dated by sync, not by `observedAt` | `observedAt` 200 days old with the item synced today is `fresh`; `observedAt: null` with the item synced today is `fresh`, not `undated`; sync `null` is `never` | the change-log trap |
| F7 | feed unknown and identity | both feed timestamps null → that input `undated`; failure only → `never`; two sync items both with a null bank and different dates keep their own records, found by `key`; two feeds named `Unknown institution` do not merge | unknown mapped to fresh; keyed by bank string |
| F8 | account classes | Plaid-linked uses sync and feed; countable uses the last count; valuation-mode uses the valuation date; manual ledger is `undated` | a manual account reading fresh |
| F9 | budget kinds | a category whose only contributor has a sync 20 days old is `stale` for both `budget-breach` and `budget-underspend`; an account that contributed only in an earlier month still counts; zero contributors is `undated`; one stale and one fresh contributor is `stale` | "8% under budget over a dead feed" reading fresh; a missing contributor |
| F10 | N3 | a grid of `(lastRun, now)` pairs across midnight, month-end and DST-sensitive offsets, including future runs: `daysSince >= 0` always, and any non-`fresh` result converts to a finding that parses; for `lastRun <= now` the result deep-equals the frozen pre-change oracle; the reported clock-skew case (a run one hour after `now` across midnight) no longer returns `-1` | the negative day count; a changed ordinary verdict |
| F11 | overdraft dating | open episode and forecast: stale at or beyond the sync constant, fresh inside, instants passed as `Date`, never parsed from text | text parsing; a missing threshold |
| F12 | purity | fake timers at two system times give deep-equal output; deep-frozen inputs do not throw; no returned object aliases an input; `asOf` triple differing from `asOfFromDate(now)` throws `RangeError` | a hidden clock; mutation; the two dates drifting |
| F13 | freshness changes nothing else | the same fixture assembled with and without a freshness context: count, order, severity, confidence and every non-freshness field are deep-equal; permuting freshness inputs does not reorder; a stale and a fresh finding of one kind share a severity | freshness leaking into ranking |
| W1 | freshness modules pure and single-sourced | AST: no `Date.now(`, zero-argument `new Date(`, `Math.random(`, `parseFloat`; the four constants are imported, and no numeric literal in `findingsFreshness.ts` other than a short allow-list of unit constants (`0`, `1`, `1000`, `3_600_000`, `86_400_000`); the read module's strings contain none of `NOW()`, `CURRENT_DATE`, `CURRENT_TIMESTAMP`, `clock_timestamp`. Fabricated violators are each flagged and a clean source is not. | a copied threshold; a SQL clock |
| W2 | inventory | `CountMismatch` (`lib/backupPlan.ts`) and `StoredProposal` (`lib/domain/proposal.ts`) are present with `excluded` and a reason of at least 20 characters; the entries' files exist and export the named types | N2 left undecided |
| W3 | viewer safety and containment | the protected-column set is derived from `TRANSACTION_COLUMN_MASK` entries whose treatment is not `keep`; no string or template literal in the read module that mentions `transactions` contains any of them as a word; the module does not import `giftReadPath`; no non-test file other than the three declared importers imports `lib/domain/findings*` or `@b8/contracts/findings`. Fabricated violators flagged. | a leaked merchant, name or note; a consumer sneaking in |
| R1 | sync facts | an item of two accounts with different `last_synced_at` yields the newer, keyed by the smallest account id; a never-synced item yields null | per-account instead of per-item |
| R2 | feed facts | per item: newest success; both null yields the unknown shape; failure-only yields the failure-only shape | unknown conflated with never |
| R3 | cash and valuation facts | newest `counted_at`; none yields never; valuation date only (no instant), newest per account | the oldest row taken |
| R4 | job fact | newest scheduler row; a newer `manual_sync` row is ignored | a manual sync hiding a dead scheduler |
| R5 | overdraft facts | open rows only; a closed episode and a closed forecast contribute nothing | closed rows read as open |
| R6 | clock-free | the same seeded data read with two different `now` values returns identical facts (the judgement is in the pure module) | `NOW()` in SQL |
| R7 | contributing accounts | an account with three qualifying transactions counts once; an account whose only transaction is `hidden` is absent; an account with `track_transactions = FALSE` is absent; a transaction dated in another year is ignored; a transaction in another category is ignored | a JOIN where EXISTS was needed; wrong filters |
| R8 | gift masking | a held gift (unrevealed) transaction carries a canary in its merchant, name and note; the serialised read output contains no canary string, only dates, ids and counts; an account whose only qualifying row is that gift appears as a contributor exactly as it does for a non-gift row (totals are viewer-invariant by design) | a protected column in the read |
| R9 | end to end | seeded rows drive the real read, the real producers called with a fixed `now`, and the assembler; every resulting finding parses against the schema and has the expected freshness state; one seeded account per class | the pieces not agreeing |

## Acceptance commands
All from the repo root under `bash`. `B="$(git merge-base HEAD main)"`. BASE and IBASE are T4's and T7's recorded numbers.

| # | Command | Expected | Would break if |
|---|---|---|---|
| 1 | `(cd apps/web && npx tsc --noEmit; echo "exit=$?")` | `exit=0` | a conversion not given the new required key; a stale producer type |
| 2 | `npx tsc --noEmit; echo "exit=$?"` | `exit=0` | the contract change failing the whole-repo check |
| 3 | `npm run lint; echo "exit=$?"` | `exit=0`, warnings not above the pre-change count | lint regressions |
| 4 | `npm test 2>&1 \| tail -8` | 0 failed; test files exactly BASE + 1; tests at least BASE + 20 | a stray test file; a skipped or removed test |
| 5 | scenario script below | one line per zone: `OK 54 unit scenarios (34 T34 + 20 T35) each present once and passed TZ=<zone>` | a missing, duplicated, skipped or zone-dependent scenario; any P5-34 rule regressed |
| 6 | integration script below | `OK <IBASE + 9> integration tests, none failing except RC-03; R1..R9 each present once and passed` | R-scenarios not actually included; any route test red |
| 7 | added-lines guard below | no output | a UTC date slice, a comma-grouped currency figure |
| 8 | scope guard below | no output | any existing file edited outside the eight named; any file added outside the four named |
| 9 | `(cd apps/web && npx vitest run lib/domain/jobHealth.test.ts lib/giftSurfaceWiring.test.ts; echo "exit=$?") ; git diff --quiet "$(git merge-base HEAD main)" -- apps/web/lib/domain/jobHealth.test.ts apps/web/lib/giftSurfaceWiring.test.ts && echo UNMODIFIED` | all pass, `exit=0`, then `UNMODIFIED` | the existing job tests weakened to fit the fix; the gift-surface rule broken by the read module |
| 10 | `grep -rlE "domain/findings|@b8/contracts/findings|findingsFreshnessRead" apps/web packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=.next \| grep -vE '\.test\.ts$\|lib/domain/findings[A-Za-z]*\.ts$\|packages/contracts/findings\.ts$\|lib/findingsFreshnessRead\.ts$' ; echo "rc=$?"` | no file listed, `rc=1` | any card, route or page importing the vocabulary (this is what makes the required-key change safe) |
| 11 | `npm run build; echo "exit=$?"` | `exit=0` | the new files failing the Next build |

**#5 (scenarios, three zones).**
```
set -e; for TZV in UTC Pacific/Auckland America/Los_Angeles; do O="$(mktemp)"; (cd apps/web && TZ=$TZV npx vitest run findings.test.ts findingsFreshness.test.ts findingsWiring.test.ts --reporter=json --outputFile="$O") || true; node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);const rng=(p,n)=>[...Array(n).keys()].map(i=>p+(i+1));const old=[...rng("C",6),...rng("V",14),...rng("A",8),...rng("W",6)].map(i=>"T34-"+i);const nw=[...rng("C",4),...rng("F",13),...rng("W",3)].map(i=>"T35-"+i);let bad=[];for(const id of [...old,...nw]){const m=t.filter(x=>x.title.startsWith(id+":"));if(m.length!==1||m[0].status!=="passed")bad.push(id+"="+m.map(x=>x.status).join("/")+"("+m.length+")")}const failed=t.filter(x=>x.status!=="passed").map(x=>x.title);if(bad.length||failed.length){console.log("FAIL",process.argv[2],bad.join(","),failed.join(" ; "));process.exit(1)}console.log("OK 54 unit scenarios (34 T34 + 20 T35) each present once and passed TZ="+process.argv[2])' "$O" "$TZV"; done
```
The filters match `packages/contracts/findings.test.ts`, `lib/domain/findings.test.ts`, `lib/domain/findingsFreshness.test.ts` and `lib/findingsWiring.test.ts` only. The `T35-C`/`T35-W` ids do not collide with the `T34-` ones because of the prefix.

**#6 (integration).**
```
set -e; O="$(mktemp)"; (cd apps/web && DATABASE_URL=postgresql://localhost/b8_p35_throwaway npx vitest run --config vitest.integration.config.mts --reporter=json --outputFile="$O") || true; node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);const bad=t.filter(x=>x.status==="failed"&&!x.title.startsWith("RC-03:")).map(x=>x.title);const miss=[];for(let i=1;i<=9;i++){const m=t.filter(x=>x.title.startsWith("T35-R"+i+":"));if(m.length!==1||m[0].status!=="passed")miss.push("R"+i+"("+m.length+")")}if(bad.length||miss.length||t.length<1){console.log("FAIL",bad.join(" ; "),miss.join(","));process.exit(1)}console.log("OK",t.length,"integration tests, none failing except RC-03; R1..R9 each present once and passed")' "$O"
```
Expected `<n>` equals IBASE + 9. Known failing: RC-03 only (it may also pass).

**#7 (added-lines guard; weak by design, never the feature's evidence).**
```
B="$(git merge-base HEAD main)"; { git diff -U0 "$B" -- apps packages | grep '^+' ; git ls-files -o --exclude-standard -- apps packages | grep -E 'findings|findings-freshness' | xargs -r cat; } | grep -nE "toISOString\(\)\.(slice|split)|\\\$[0-9]+\.[0-9]{2}\b|\\\$[0-9]{1,3}(,[0-9]{3})+"
```
Expected no output (grep exit 1).

**#8 (scope guard).**
```
B="$(git merge-base HEAD main)"; set -e; { git diff --name-status "$B" -- apps packages migrations db ':(exclude)*AGENTS.md' ':(exclude)*CLAUDE.md' | grep -vE '^M\s+(packages/contracts/findings(\.test)?\.ts|apps/web/lib/domain/(findings|findingsInventory|findings\.test|jobHealth)\.ts|apps/web/lib/domain/findings\.test\.ts|apps/web/lib/findingsWiring\.test\.ts|apps/web/vitest\.integration\.config\.mts)$' || true; } ; { git ls-files -o --exclude-standard -- apps packages migrations db; git diff --name-only --diff-filter=A "$B" -- apps packages migrations db; } | sort -u | grep -vE '^(apps/web/lib/domain/findingsFreshness(\.test)?\.ts|apps/web/lib/findingsFreshnessRead\.ts|apps/web/scripts/findings-freshness-read\.test\.ts)$' || true
```
Expected no output from either half. The first half prints any modified-but-undeclared, deleted or renamed file; the second any added-but-undeclared file. Discrimination: appending a comment to `apps/web/components/SyncHealthCard.tsx` must make the first half print a line (the orchestrator runs this probe and reverts).

## Negative controls
| # | Rule | Input that must be rejected or excluded | Asserted by |
|---|---|---|---|
| 1 | undated is never fresh | empty input set; unsupplied context; a manual ledger account; an `unknown` feed | F3, F7, F8, #5 |
| 2 | a dead feed makes a budget finding stale | a category under budget whose only contributor has not synced for 20 days must not read `fresh` | F9 |
| 3 | drift is dated by sync, not by the change log | `observedAt` 200 days old beside a sync made today must not read `stale` or `undated`; `observedAt: null` must not read `undated` | F6 |
| 4 | thresholds are the producers' | a finding the real producer emits must not be `fresh`; one it does not emit must not be `stale` | F4 |
| 5 | a future observation is not a negative age | an instant one millisecond after `now` must not be `fresh`, and no age is below zero | F5, C2 |
| 6 | N3 | a last run stamped after `now` must not yield `daysSince < 0`; an ordinary past run must not change verdict | F10, C3, #9 |
| 7 | manual sync does not date the job | a `manual_sync` row newer than the last scheduler row must not freshen the job | R4 |
| 8 | contributing account counted once, with the budget's filters | an account with three rows; a `hidden`-only account; a `track_transactions = FALSE` account; another year; another category | R7 |
| 9 | closed overdraft rows are not inputs | a closed episode and a closed forecast | R5 |
| 10 | no row text and no protected column | a held gift with a canary in merchant, name and note | R8, W3 |
| 11 | freshness changes no ranking | the same fixture with a freshness context versus none: count, order, severity | F13 |
| 12 | identity is not an institution name | two items both with a null bank, and two feeds both `Unknown institution`, with different dates | F7, R1 |
| 13 | no copied threshold, no SQL clock | numeric literal `2`, `30`, `36` or `100` in the freshness module; `NOW()` in the read | W1 |
| 14 | the backup mismatch and proposals are decided | both present and excluded, with reasons | W2 |
| 15 | the vocabulary has no consumers | any non-test importer outside the declared set | W3, #10 |
| 16 | nothing outside the declared set changes | any other modified or added file under `apps packages migrations db` | #8 |
| 17 | a valuation is a date | a valuation observation carried as an instant | C4 |
| 18 | the as-of date and the instant are one | an `asOf` triple that is not the local date of `now` | F12 |

## Evidence required
- Command #5 output for all three zones; #4, #6, #8, #9 and #10 outputs, captured verbatim by the orchestrator.
- A table printed by a test run: kind × input × state → the freshness state, with names and enum values only (no figures), matching "Inputs by kind".
- The `jobHealth` differential result (count of pairs compared, count that differed: 0) and the one skew case before and after, with no figures other than day counts.
- The mutation log, one entry per mutation below, each with the failing scenario ids.
- A short note in EVIDENCE.md for the step-36 author: what freshness covers, what is `undated` and why, the N2/feed/property/Unknown dispositions.
- No money figure, real name or merchant in EVIDENCE.md.

Orchestrator-applied mutations (G2/G3), one at a time, each reverted with the tree checksum unchanged. At least the named scenarios must fail; a broader set is accepted with a reason:
- M1 date drift by `observedAt` instead of the item sync → F6.
- M2 map `undated` to `fresh` (empty set, unsupplied, manual ledger) → F3, F8, F9, C2.
- M3 feed boundary `>=` instead of `>` → F4.
- M4 hard-code `2` for the sync threshold → W1 (and F4 if the literal drifts).
- M5 clamp a future observation to age 0 instead of `undated` → F5.
- M6 revert the `jobHealth` fix → F10.
- M7 contributor set built with a JOIN → R7.
- M8 contributor set includes hidden rows → R7.
- M9 put `NOW()` in a read query → W1, R6.
- M10 look up sync freshness by bank string → F7, R1.
- M11 map feed `unknown` to `never` → F7.
- M12 choose the newest input as the worst → F2.
- M13 let freshness lower a finding's severity → F13.
- M14 treat a manual ledger account as `fresh` → F8.
- M15 select `merchant_name` in a read query on `transactions` → W3, R8.
- M16 judge the job from any `sync_log` row, not `trigger = 'scheduler'` → R4.
- M17 ignore the feed input of a Plaid-linked contributor → F9.

## Failure modes to test
- A stable Plaid balance reading as ancient because `plaid_balance` rows are a change log (F6).
- "Under budget" over a feed that stopped three weeks ago reading `fresh`: the headline case this step exists for (F9).
- An unknown input collapsed into fresh: empty contributor set, a manual account, an `unknown` feed, an unsupplied context.
- `never` and `undated` conflated. They mean different things to a reader (a recorded absence versus a missing record).
- A threshold copied with a different comparator: the feed uses strict `>` on milliseconds, the others `>=` on floored days (F4).
- `STALE_AFTER_DAYS` imported from the wrong module; the two have different values.
- A count that reads off by one at the exact boundary (36 h versus 36 h + 1 ms; 99 versus 100 days).
- Double counting contributors from a JOIN where an EXISTS was needed (R7).
- `hidden` or `track_transactions = FALSE` rows making an account a contributor, so a category looks tied to an account the grid does not read.
- A category name shared across landscapes: contributors matched on name alone, picking up the capital twin. The contributor query must join the operational category.
- Sync items keyed or merged by bank text (`Unknown`, `Unknown institution`) (F7).
- A pg `::text` timestamp parsed by `new Date()` in a pure module: format-dependent and zone-dependent.
- A valuation date turned into a local midnight instant, then shifted a day by a negative zone offset (C4; three zones).
- Time zone dependence: instant arithmetic is zone-free, but the as-of triple (process-local) and the valuation date (Postgres session zone) are both the server's calendar. A process and session in different zones would disagree by a day at the boundary; recorded as an inherited assumption, not fixed.
- Negative age from a clock-skewed or racing write, or `NaN` from a malformed date (F5; a malformed date is `undated`).
- An unsupplied `now` silently becoming "now" via a default parameter.
- The N3 fix changing an ordinary verdict (F10 differential), or the `jobHealth` fix hiding a dead job behind a future-dated row (accepted, Q2).
- A freshness context for the wrong year: contributors read for one year, findings for another. The read takes the as-of year from `now`.
- A finding whose subject account is absent from the read (deleted, or not Plaid-linked) yielding `fresh` instead of `undated`.
- The overdraft episode that closed between the producer's read and the freshness read: its freshness is `undated`, not a crash.
- Duplicate queries drifting from the existing loaders (sync item grouping, feed grouping, valuation SQL). R1–R3 and R9 pin the read's output against what the loaders compute for the same seeded rows; a future change to one loader must fail R9.
- Freshness leaking into ordering or severity (F13).
- Merchant, name or note reaching the read output (R8, W3).

## Open questions for the owner
Product decisions not derivable from code. The spec is written assuming each default.
1. **Manual ledger accounts and "last import per budget row".** The database records no import date for hand-added or CSV-imported accounts. Default: they are `undated`, so any budget finding resting on one says so. Alternative: add an import log table (a migration, a new step) so the date is recorded. That makes the "undated" label temporary, and is out of scope here.
2. **A last scheduler run stamped in the future.** Default: treated as a run at `now`, so the job reads `fresh` and no finding appears. Trade-off: a badly wrong clock could mask a dead job until `now` catches up. Alternative: ignore future-dated runs and use the previous one, or surface a finding. Both cost more and need a decision on wording (step 36).
3. **Property valuations.** Default: no property subject and no property kind, because no finding depends on a property value and there is no existing property threshold. Alternative: a new `property-valuation-stale` kind with its own threshold (a new detector, which P5-34 and ROADMAP step 34 forbade as "no new detectors").
4. **Backup rehearsal and pending proposals.** Default: deferred and excluded with reasons. Revisit when a persisted rehearsal outcome exists.
5. **Overdraft thresholds.** Default: an open episode or forecast is stale at the sync constant (2 days), since both are rewritten by each sync. There is no threshold of their own in the code.
6. **Freshness precedence.** Default: `never` > `stale` > `undated` > `fresh`. Alternative: rank `undated` above `stale`. This is a ranking judgement, not derived from the code.

## Rollback
Nothing is deployed behaviour and no data is written. Revert the commit, or restore the eight modified files from `git` and delete exactly the four new files: `apps/web/lib/domain/findingsFreshness.ts`, `apps/web/lib/domain/findingsFreshness.test.ts`, `apps/web/lib/findingsFreshnessRead.ts` and `apps/web/scripts/findings-freshness-read.test.ts`. The one live-behaviour change is the `jobHealth` clock-skew branch; reverting restores a producer that can return `daysSince: -1` for a future-dated run. No consumer of the vocabulary exists (acceptance #10), so removing the modules cannot affect any page, route, digest or job. Step 36 depends on this contract: reverting after it begins is not clean, and if this task is reverted step 36 must not have started.
