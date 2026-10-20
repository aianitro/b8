# P5-34-finding-vocabulary — One finding vocabulary
**Roadmap item:** ROADMAP.md §5 Phase 5 step 34 — one `Finding` union for what is worth telling the owner
**Status:** FROZEN@G0 (2026-10-19)
**Author:** spec-writer

## Goal
After this task the repository has exactly one definition of "a thing worth telling the owner". A new contract file, `packages/contracts/findings.ts`, defines a `Finding` union. Every member carries a `kind`, a `severity`, a `confidence`, a `subject` (category, account, institution or system) and a `period`. It also carries the producer's own distinguishing fields with their null-ness preserved. A pure module under `apps/web/lib/domain/` converts the output of each existing finding producer into that union. The producers are adherence breach and chronic-underspend, drift, feed health, sync health, job health, cash-wallet staleness, valuation staleness, open overdraft episodes and open overdraft forecasts. A second pure function takes those producers' outputs plus an as-of date and assembles one deterministic, severity-ordered list. It also states which sources it was not given, so that a producer that was never run cannot read as a producer that found nothing.

Nothing visible changes. No existing file is modified. Dashboard cards, the `/api/v1/overview` payload, the daily digest, alerts and push behave byte-for-byte as before, because nothing existing imports the new modules. Steps 35 (freshness as a property of every finding) and 36 (the composed digest) are the first consumers. This step builds neither.

**Decision on the overview payload: it does not carry the combined list in this task.**
- Step 36 is the first consumer. A field with no reader drifts. `overviewFromWire.ts` records that this payload already went four days missing sections its only reader needed.
- Adding a field changes `OverviewDataSchema` and the route response, which the owner scoped out.
- The payload could not hold a complete list today. Sync health, valuation staleness, open overdraft episodes and open overdraft forecasts are not in it. Sync health is computed inside `SyncHealthCard`. The other three are loaded separately by the dashboard page. A combined list in the payload would therefore be a confident list that silently omits four sources. That is the shape of the P0.5-29a N11 defect.
- Putting those four sources into the payload is its own scoped change, and step 36 can decide it with a consumer in hand.

## Producer inventory (found by reading code; ITEM.md's list was a starting point)
The wiring test W3 pins this table. The registry's dispositions must equal it.

| Producer (file) | Exported type | What it computes | Its own severity / confidence notion | Unknown / no-data states | Subject | In the vocabulary? |
|---|---|---|---|---|---|---|
| `lib/domain/adherence.ts` `detectAdherence` | `BreachFinding` | one month in which `actual > budgeted`, strictly, over operational, non-excluded, non-income categories | `scored` flag (`control_mode = 'discretionary'`); none other | `ratio` null when nothing was budgeted | category (id, name) | **yes**, `budget-breach` |
| same | `ChronicUnderspendFinding`, union `AdherenceFinding` | a category whose every qualifying month in the window ran under half its budget, with at least three such months | `scored` flag; the doc says breach and defect are "not addable" | zero-budget months are excluded from the window by construction | category | **yes**, `budget-underspend` |
| `lib/domain/drift.ts` `detectDrift` | `DriftFinding` | ledger vs Plaid balance disagreement beyond a threshold, worst first | `safeToDerive` says whether adjusting the opening balance is legitimate; magnitude is `drift` | accounts with no Plaid balance are skipped, not reported; `observedAt` may be null | account | **yes**, `balance-drift` |
| `lib/domain/feedHealth.ts` `feedFindings` | `FeedFinding` | Plaid-side feed `failing` or `stale` per item | its own sort: failing before stale | `unknown` state is deliberately not reported; `institutionStatus` null means unread, not healthy; `hoursStale` null when never succeeded | institution (item) | **yes**, `feed-degraded` |
| `lib/domain/syncHealth.ts` `classifySyncHealth` | `SyncItemHealth` | per-item time since this app's last successful sync; status `ok`, `stale` or `never` | its own sort: never before stale | `daysStale` null when never synced; bank null becomes the string `Unknown` inside the producer | institution (item) | **yes**, `sync-stale`. Only `stale` and `never` are findings; the "reportable" predicate (`status !== 'ok'`) lives today only in `SyncHealthCard`. |
| `lib/domain/jobHealth.ts` `jobHealth` | `JobHealth` | whether the daily job ran: `fresh`, `late`, `missed`, `never` | status ladder; message sentence | `daysSince` null when never run | system (the daily job) | **yes**, `job-overdue`. Only `late`, `missed` and `never` are findings; the predicate (`status !== 'fresh'`) lives today only in the dashboard page and digest read. |
| `lib/domain/walletStaleness.ts` `staleWallets` | `WalletFinding` (postdates the roadmap text) | cash wallets never counted while holding money, or not counted for the stale-after period | its own sort: never before stale | `daysSinceCount` null when never counted | account | **yes**, `cash-uncounted` |
| `lib/domain/valuationStaleness.ts` `staleValuations` | `ValuationFinding` (absent from ITEM.md) | hand-valued accounts never valued or last valued at least the threshold ago | its own sort: never first, then oldest | `never` has no day count | account | **yes**, `valuation-stale` |
| `lib/overdraftWatch.ts` `loadOverdrafts` | `OverdraftFinding` (absent from ITEM.md) | an open episode: watched balance below the account's cushion now | the push is sent at `high` priority for episodes | none | account | **yes**, `overdraft-open` |
| `lib/overdraftWatch.ts` `loadForecasts` | `ForecastFinding` (absent from ITEM.md) | an open forecast: projected low below the cushion within the forecast horizon | the push is sent at `normal` priority for forecasts | none | account | **yes**, `overdraft-forecast`. Its `charges` array carries transaction-derived merchant labels and is **deliberately not carried**. |
| `lib/domain/monthOutlook.ts` `monthOutlook` (`sayingNo`, `holding`, `withheld`, `offCycleElsewhere`, `state`) | `MonthOutlook`, `OutlookCategory` | a position report: every scored category appears in exactly one list; `sayingNo` holds projected breaches | `OutlookState`, `reason` | `withheld`, `nothing-to-score`, `too-early` | category | **no.** It is a verdict over all scored categories, not a list of detections. Folding it in would invent a "projected" finding kind and a per-category confidence. Open question Q3. |
| `lib/domain/monthOutlook.ts` `categorizationCoverage` | `CategorizationCoverage` | how much spend the headline could see; `authoritative` | the coverage share and threshold | share null on an empty month | none | **no.** It is a confidence qualifier on a headline, not an item. Step 35/36 may use it. |
| `lib/domain/breachAlert.ts` `planAlert` | `AlertMessage` | an outbound message derived from the outlook | `AlertKind` | none | none | **no.** It is a message, not a detection. |
| `lib/domain/digest.ts`, `lib/digestRead.ts` | `DigestData` (`jobGap`, `staleValuations` strings) | a consumer and renderer; those strings are re-renderings of job-health and valuation findings | none | none | none | **no.** A consumer, not a producer. Its output must not change. |
| `lib/domain/propertyPnl.ts`, `propertyLedger.ts`, `property.ts` | `PropertyPnl`, `LedgerRow` | P&L and ledger arithmetic | none | `appreciation` null | property | **no.** No anomaly or finding producer exists in these files (searched). The roadmap's "property-ledger anomalies" names something that does not exist; "no new detectors" forbids creating it. Open question Q2. |
| `lib/domain/pacing.ts`, `lib/domain/overdraft.ts`, `cashForecast.ts` | `CategoryPace`, `EpisodeStep`, `ForecastStep`, `CashProjection` | positions and state transitions that feed the producers above | none | various | n/a | **no.** Inputs to producers, not outputs worth telling. |
| `lib/watchlistRead.ts` | `WatchedTransaction` | transactions the owner flagged | none | n/a | none | **no.** Owner-authored, not a detection. |
| `lib/domain/giftMatch.ts`, `lib/giftStore.ts` | the gift window-end notice | a notice visible to the giver only | none | n/a | n/a | **no.** It is private to one viewer. The vocabulary has no viewer concept, and a household-wide list carrying it would let a non-giver learn that a gift exists. |
| `lib/domain/txnMatch.ts` | `TxnMatchResult` | ingest re-identification | none | n/a | n/a | **no.** Not a finding. |

## Non-goals
Each is enforced by the reviewer as a defect if present.
- **No existing file under `apps/`, `packages/`, `migrations/` or `db/` is modified, deleted or renamed.** `packages/contracts/index.ts` is NOT edited: the new contract is imported by subpath (`@b8/contracts/findings`), as `overview.ts` is. No existing test is edited or removed. The tree's only additions are the files listed in acceptance #8.
- **No new field on `OverviewData`.** `packages/contracts/overview.ts`, `lib/overviewRead.ts`, `lib/overviewFromWire.ts`, `app/api/v1/overview/route.ts` and `app/dashboard/page.tsx` are unchanged. The decision above stands.
- **No change to any card, the alert bell count, the daily digest, `breachAlert`, push, or any threshold.** `SyncHealthCard.tsx`, `JobHealthCard.tsx`, `FeedHealthCard.tsx`, `DriftAlertCard.tsx`, `CashStalenessCard.tsx`, `ValuationStalenessCard.tsx` and the overdraft cards are untouched. Constants such as `STALE_AFTER_DAYS` (which exists, with different values, in both `syncHealth.ts` and `walletStaleness.ts`), `STALE_AFTER_HOURS`, `VALUATION_STALE_DAYS`, `CHRONIC_UNDERSPEND_RATIO` and `CHRONIC_MIN_MONTHS` are not changed, not re-exported, not copied.
- **No new detector and no new threshold.** In particular, no property-ledger anomaly detector, no month-outlook finding kinds, no coverage finding.
- **No freshness property on `Finding`** (step 35) and **no narration, wording composition, `Digest` type or digest page** (step 36). `JobHealth.message` is carried verbatim as the producer wrote it. No new sentence is composed anywhere.
- **No deduplication, merging or correlation between kinds.** A feed finding and a sync-health finding for the same institution name are two findings. The vocabulary does not decide that they are one problem.
- **No finding identifier, dismissal, persistence, table, read module that queries, route, page, environment variable or scheduler hook.** The assembler is a pure function of its arguments.
- **No wire-to-domain converters.** The conversions take the producers' domain outputs (`Date`s, numbers) and not `OverviewData` wire shapes. `overviewFromWire.ts` is not extended and no `adherenceFromWire` is added. Step 36 chooses how to feed the assembler from the payload.
- **No row-level transaction content in a `Finding`.** No merchant label, name, note or description. `ForecastFinding.charges` is dropped.
- **No re-derivation of `scored`, tracked-ness, landscape or `exclude_from_budget`.** The conversions copy the flag the producer set and filter nothing the producer reported. Neither `isScoredCategory` nor `isTrackedCategory` is imported.
- **No clock read.** No `Date.now()`, no zero-argument `new Date()`, no `Math.random()` in the vocabulary modules.
- **No refactor of existing duplicated definitions**, for example the four even-spread budget implementations named in `adherence.ts`, or the duplicated "reportable" predicates in `SyncHealthCard` and the dashboard page. They are restated in the conversions' tests and left alone.
- **No real name, merchant or money figure** in any tracked file, commit message or EVIDENCE.md (repository is public). Fixtures are fabricated: institutions like `Fabricated Credit Union`, accounts like `Fixture Checking`, categories like `Fixture Category`.

## Open questions for the owner
Product decisions not derivable from ROADMAP, ITEM or code. The spec is written assuming each default.
1. **Severity calibration across kinds.** Within a producer, severity follows that producer's own order, and that is enforced. The step across producers is a judgment: a three-level scale (`critical`, `warning`, `notice`) with only an open overdraft episode at `critical`, a "never observed" or "failing" state at `warning`, and an elapsed-threshold or pattern state at `notice`. The mapping table below is the default. Alternative: two levels only (`warning`, `notice`), so nothing is called critical before the digest has run for a quarter.
2. **"Property-ledger anomalies" and a property subject.** Default: no such producer exists, so the vocabulary has no property subject and no kind for it. The orchestrator should record that ROADMAP §5 step 34's phrase is stale. A property subject becomes an additive variant when step 35 has a producer for it (last valuation per property).
3. **Month outlook and coverage.** Default: excluded from this step. If step 36 wants "heading for a breach this month" or "coverage is below the authoritative threshold" in the composed digest, each becomes a new kind added later as an additive contract change, with its own conversion. The exhaustive registry makes that a deliberate act.
4. **Confidence as a three-valued label** (`observed`, `inferred`, `projected`), fixed per kind and never numeric. Default as stated. Alternative: a numeric score. Rejected as default because no producer computes one, so any number would be invented.

## Contracts touched
| File | Change | Class (§9.2) |
|---|---|---|
| `packages/contracts/findings.ts` (new) | `FindingSchema` and its derived types | additive |
| `packages/contracts/findings.test.ts` (new) | scenarios C1–C6. It sits inside the guarded contract package, so whoever holds the G1 lease writes it. | additive |
| `packages/contracts/index.ts`, `CONTRACT_SCHEMAS` | none, deliberately not re-exported | none |
| `migrations/**`, `db/schema.sql`, `shared/types.ts` | none | none |

Notes for contract-guardian. The observable requirements on the contract:
- `FindingSchema` is a discriminated union on `kind` whose members are strict objects (unknown keys rejected, not stripped). The overview contract strips because its inputs are written by other modules. This one is authored end to end by one assembler, and a stripped extra key would hide exactly the leak (a merchant label) the strictness exists to catch.
- The ten kinds are exactly: `budget-breach`, `budget-underspend`, `balance-drift`, `feed-degraded`, `sync-stale`, `job-overdue`, `cash-uncounted`, `valuation-stale`, `overdraft-open`, `overdraft-forecast`.
- `severity` is exactly `critical | warning | notice`. `confidence` is exactly `observed | inferred | projected`.
- `subject` is one of `{type:'category', id:int, name}`, `{type:'account', id:string, name}`, `{type:'institution', name}`, `{type:'system', name}`.
- `period` is one of `{type:'month', month:'YYYY-MM'}`, `{type:'months', months:[…non-empty 'YYYY-MM' strings in ascending order]}`, `{type:'asOf', date:'YYYY-MM-DD'}`. Calendar text is used instead of integers because the domain's 0-based month and the digest's 1-based month are the exact trap this repo has hit.
- No field is optional. Absence is `null`. Money fields use the existing `moneyString` representation (exactly two fraction digits). Timestamps are strings (the existing `timestamptz` representation).
- The module exports the inferred TypeScript types `Finding`, `FindingKind`, `Severity` and `Confidence`. It imports nothing from `apps/web`.

## Conventions this task must honor
- **Sign:** no normalisation anywhere. Every money field is carried with the sign its producer used, and the conversions never negate, take absolute values, or apply the credit/loan flip (`OWED_AS_POSITIVE`), which `drift.ts` has already applied.
  - `balance-drift`: `ledgerBalance` and `expectedBalance` are in the ledger's signed convention (money owed on a credit or loan account is negative). `drift` is `expected − ledger`, so positive means the ledger is short of the bank. A negative `drift` stays negative.
  - `budget-breach` / `budget-underspend`: `budgeted` and `actual` are non-negative magnitudes as the budget grid aggregates them. They are not transaction-ledger signs, where positive means money out. `variance` is `actual − budgeted`: positive is over budget, so a breach's variance is strictly positive and a chronic-underspend window's is negative.
  - `cash-uncounted.balance` is the wallet's ledger balance. It may be negative.
  - `overdraft-open.balance` is the lower of Plaid's current and available balance. It may be negative.
  - `overdraft-forecast.low` is the projected low point.
- **Rounding:** the conversions compute nothing arithmetic. There are no sums, no averages, and no ratios computed. The only numeric act is formatting a producer's number as a money string, once per field at the end, by the same three steps as `wireMoney` in `lib/overviewRead.ts`: round to the cent, normalise negative zero, print two decimals. Their output must equal `wireMoney`'s for every finite input (scenario V12). `wireMoney` itself cannot be imported, because that file imports the database. Ratios (`budget-breach.ratio`) stay unrounded numbers or null and are not money. Day, hour and count fields pass through as integers.
- **Landscape + exclusions:** not applicable at this layer, with a reason. Landscape (`operational`/`capital`) and the `hidden` / `exclude_from_budget` flags apply to rows and categories, and the producers apply them before they emit. Adherence's tracked set (operational, not excluded, not income) is inside `detectAdherence`. The conversions add no filter, remove none, and carry `scored` as given. A breach on an unscored `fixed` category is still a finding, with `scored: false`. The only filtering the conversions do is the two "reportable" predicates the UI applies today (sync status not `ok`; job status not `fresh`).
- **Null semantics:** this is the load-bearing convention.
  - A producer's null stays null in the Finding: `daysSinceCount` (never counted), `hoursStale` (no success yet), `daysStale` and `daysSince` (never synced or run), `institutionStatus` (unread, not healthy), `institutionStatusAt`, `lastSuccessfulUpdate`, `observedAt`, `ratio` (nothing budgeted), `bank`. Null is never `0`, never `""`, never `'HEALTHY'`, never `Infinity`.
  - Where a producer's variant has no such field (`ValuationFinding` of reason `never` has no `daysSince`), the Finding carries `daysSince: null`, not absence.
  - A producer's "unknown" is never mapped to "fine". Its severity is at least that of the same kind's elapsed-threshold state. `never` is at least `stale`.
  - A producer that deliberately does not report an unknown state (feed `unknown`) continues not to. The vocabulary does not change what a producer reports. That limit (an unobserved feed is invisible, not "ok") is recorded for step 35 and not fixed here.
  - **An omitted source is not an empty source.** The assembler reports a source it was not given in `notEvaluated`. A supplied empty list means evaluated and clean.
- **Time:** no clock. The assembler takes the as-of triple the overview already uses (`{year, month, day}`, month 0-based, January = 0). It renders it as `YYYY-MM-DD` with month + 1 and zero-padding. An invalid triple (month outside 0–11, day outside 1–31) throws a `RangeError` and is not silently formatted. Adherence periods use the as-of year, which is the caller-contract precondition `pacing.ts` already states for `AdherenceInput`. Adherence month `m` (0-based) becomes `YYYY-MM` with `m + 1`. Feed timestamps (`Date`) become ISO strings with `toISOString()`, as `wireFeedFinding` does. The conversions compute no date differences: the day and hour counts come from the producers. Results must not depend on the process time zone (tested under three).

## Mapping tables (the conversion rules)
Severity and confidence are derived from the producer's own state. Each row names the input that must NOT map to the severity shown (the negative control, asserted by the scenario named).

| Kind | Producer input state | Subject | Period | Severity | Confidence | Must NOT map to |
|---|---|---|---|---|---|---|
| `budget-breach` | `scored: true` | category `{id: categoryId, name: category}` | `{month, year-month}` | `warning` | `inferred` | `critical`, `notice` (V1) |
| `budget-breach` | `scored: false` (for example a fixed mortgage line over its budget) | same | same | `notice` | `inferred` | `warning`; and it must still be emitted (V1) |
| `budget-underspend` | any `scored` | category | `{months, year, ascending}` from the finding's qualifying months | `notice` | `inferred` | `warning`: an under-spent budget line is a wrong budget, not money at risk (V2) |
| `balance-drift` | `safeToDerive` true or false | account `{id: accountId, name}` | `asOf` | `warning` | `observed` | `notice` for either flag; the sign of `drift` never changes the severity (V3) |
| `feed-degraded` | `state: 'failing'` | institution | `asOf` | `warning` | `observed` | `notice` (V4) |
| `feed-degraded` | `state: 'stale'` | institution | `asOf` | `notice` | `observed` | `warning`; a `HEALTHY` institution status never suppresses the finding or lowers it (V4) |
| `sync-stale` | `status: 'never'` | institution `{name: bank}` | `asOf` | `warning` | `observed` | `notice` (V5) |
| `sync-stale` | `status: 'stale'` | institution | `asOf` | `notice` | `observed` | `warning`; `status: 'ok'` yields no finding at all (V5) |
| `job-overdue` | `missed` or `never` | system `{name: 'daily-job'}` | `asOf` | `warning` | `observed` | `notice` (V6) |
| `job-overdue` | `late` | system | `asOf` | `notice` | `observed` | `warning`; `fresh` yields no finding (V6) |
| `cash-uncounted` | `reason: 'never'` | account | `asOf` | `warning` | `observed` | `notice`; `daysSinceCount` stays null, not 0 (V7) |
| `cash-uncounted` | `reason: 'stale'` | account | `asOf` | `notice` | `observed` | `warning` (V7) |
| `valuation-stale` | `reason: 'never'` | account | `asOf` | `warning` | `observed` | `notice`; `daysSince` null (V8) |
| `valuation-stale` | `reason: 'stale'` | account | `asOf` | `notice` | `observed` | `warning` (V8) |
| `overdraft-open` | an open episode | account `{id: accountId, name: account}` | `asOf` | `critical` | `observed` | `warning`: the only `critical` in the vocabulary. The producer sends its push at `high` priority and the doc calls this "the one cost that is pure waste" (V9) |
| `overdraft-forecast` | an open forecast | account | `asOf` | `warning` | `projected` | `critical`; `confidence` never `observed` (V10) |

Carried fields (each with its producer's null-ness; the type-level and runtime exactness checks below force a decision for any producer field not listed):
- `budget-breach`: `scored`, `budgeted`, `actual`, `variance` (money strings), `ratio` (number or null).
- `budget-underspend`: `scored`, window `budgeted`, `actual`, `variance` (money strings), and the qualifying months as the period.
- `balance-drift`: `ledgerBalance`, `expectedBalance`, `drift`, `suggestedBeginningBalance` (money strings), `observedAt` (string or null), `safeToDerive`.
- `feed-degraded`: `accountCount`, `state`, `lastSuccessfulUpdate`, `hoursStale`, `institutionStatus`, `institutionStatusAt`.
- `sync-stale`: `key`, `accountCount`, `daysStale`, `status`.
- `job-overdue`: `status`, `daysSince`, `message` (verbatim).
- `cash-uncounted`: `balance` (money string), `daysSinceCount`, `reason`.
- `valuation-stale`: `reason`, `daysSince`.
- `overdraft-open`: `bank`, `balance`, `cushion` (money strings), `since`, `seenAt`.
- `overdraft-forecast`: `bank`, `cushion`, `low` (money strings), `lowOn`, `projectedAt`. **Not `charges`.**

**Producer-order monotonicity.** Four producers sort worst-first: feed (failing before stale), sync (never before stale), wallets (never before stale) and valuations (never first). For each, the converted list taken in the producer's own order has non-increasing severity. Scenario V11 asserts it. That is what "derived, not invented" means testably: the conversions cannot rank a state above one the producer itself ranks above it.

**Assembler behaviour.**
- Input: an object with one optional key per source, `adherence`, `drift`, `feed`, `sync`, `job`, `wallets`, `valuations`, `overdrafts`, `forecasts`, plus the as-of triple.
- Output: `{ findings, notEvaluated }`.
- `notEvaluated` lists the omitted source ids in a fixed canonical order. An explicitly `undefined` source counts as omitted.
- `findings` are ordered by severity (`critical`, then `warning`, then `notice`). Ties are broken by a fixed source order and then by the producer's own order. The tests pin that the result does not depend on the key order of the input object.
- The count is one Finding per reportable producer finding. Nothing is merged or dropped.
- Inputs are not mutated and are not aliased by the output.

## Toolchain prerequisites
All commands run under `bash` (this machine's zsh `grep` is a different tool). Every row is verified by the orchestrator before G0 passes.

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `psql`, `createdb`, `dropdb`, a local Postgres with CREATEDB | **yes** (command #6 only) | local install | `psql -d postgres -tAc "select 1"` → `1` | filled at G0 |
| T2 | A fresh throwaway DB migrated at the current head, not `b8_finance` | **yes** (command #6) | `createdb b8_p34_throwaway` then `DATABASE_URL=postgresql://localhost/b8_p34_throwaway npm run migrate:up` | `psql postgresql://localhost/b8_p34_throwaway -tAc "select to_regclass('public.user_invitations')::text"` → `user_invitations` | filled at G0 |
| T3 | An exported `DATABASE_URL` wins over `apps/web/.env.local` in `npm run migrate:up` | **yes** | n/a | `DATABASE_URL=postgresql://nobody@127.0.0.1:1/b8_p34_throwaway npm run migrate:up; echo "exit=$?"` → non-zero, connection error to port 1 | filled at G0 |
| T4 | Unit baseline recorded before the change: BASE files and BASE tests | **yes** | existing | `npm test 2>&1 \| tail -8` → record files and tests as BASE | filled at G0 |
| T5 | `tsc` clean in `apps/web` | **yes** | existing | `(cd apps/web && npx tsc --noEmit; echo "exit=$?")` → `exit=0` | filled at G0 |
| T6 | Root `tsc` clean (CI's command, which includes the contract package; hold H9 says the package alone may not type-check, so the root run is the arbiter) | **yes** | existing | `npx tsc --noEmit; echo "exit=$?"` → `exit=0` | filled at G0 |
| T7 | Integration baseline on the unmodified tree: the only failing title, if any, begins `RC-03:`. Record the total test count as IBASE | **yes** | existing | run command #6 on the unmodified tree | filled at G0 |
| T8 | `typescript` resolvable from `apps/web` (the AST wiring tests, as `giftSurfaceWiring.test.ts`) | **yes** | existing dependency | `(cd apps/web && node -e 'require.resolve("typescript")'; echo "exit=$?")` → `exit=0` | filled at G0 |
| T9 | The `TZ` variable changes `Date` behaviour in Node here | **yes** | OS tz database | `TZ=Pacific/Auckland node -e 'console.log(new Date(2026,0,1).getTimezoneOffset())'` → `-780`, and `TZ=America/Los_Angeles node -e 'console.log(new Date(2026,0,1).getTimezoneOffset())'` → `480` | filled at G0 |
| T10 | `git merge-base HEAD main` resolves, and nothing under `apps`, `packages`, `migrations`, `db` is already modified (so command #8 isolates this task's diff) | **yes** | existing | `git merge-base HEAD main \| wc -l` → `1`; `git status --short -- apps packages migrations db ':(exclude)*AGENTS.md' ':(exclude)*CLAUDE.md'` → no output | filled at G0 |
| T11 | Google Chrome, a dev server, live Plaid, SMTP, push services, the Anthropic API, network | **NO** | n/a | n/a | n/a |
| T12 | The dev database `b8_finance` and `.env.local` data | **NO** | n/a | n/a | n/a |

Prerequisites the implementer must create (none exist today). Every scenario title begins with its id exactly as listed (`T34-C1:` …), so the scenario command finds each by structure. All fixtures are fabricated and seed what they assert on. The money-bearing fixtures are written inside the test files only.
- `packages/contracts/findings.ts` and `packages/contracts/findings.test.ts` — the contract and scenarios C1–C6 (written under the G1 lease).
- Vocabulary modules at `apps/web/lib/domain/findings*.ts` (for example `findings.ts` for the conversions and assembler, `findingsInventory.ts` for the registries). Every file name begins `findings`, so the wiring tests can find them. They are pure.
- `apps/web/lib/domain/findings.test.ts` — scenarios V1–V14 and A1–A8. Imports only pure modules, plus `wireMoney` from `../overviewRead` for V12.
- `apps/web/lib/findingsWiring.test.ts` — scenarios W1–W6, AST checks with the TypeScript compiler API, patterned on `lib/giftSurfaceWiring.test.ts`. Every checker is also run against fabricated violating and clean sources, so a checker that matches nothing cannot pass the real tree.

## Scenarios
| Id | Observable rule | Fixture and assertion | Catches |
|---|---|---|---|
| C1 | The kind set is exactly the ten. | The union's kind literals equal the hard-coded list of ten, with no extras and none missing. | A missing or extra kind. |
| C2 | The enums are exact. | Severity equals `critical, warning, notice`; confidence `observed, inferred, projected`; subject types `category, account, institution, system`; period types `month, months, asOf`. | A quietly widened vocabulary. |
| C3 | Members are strict. | For each kind, a valid fixture parses; the same fixture plus an unknown key fails. | `z.object` stripping a leaked field. |
| C4 | Null is a value, absence is not. | For each nullable field, `null` parses and an omitted key fails. | Optional fields; null conflated with missing. |
| C5 | Money fields are strict. | `"12.5"`, a bare number, `"abc"` and `""` fail; two-fraction-digit strings pass. | A money field typed loosely. |
| C6 | Calendar text is strict. | Month `YYYY-MM` rejects `2026-13`, `2026-00`, `2026-1`; accepts `2026-01` and `2026-12`. Date rejects `2026-1-5`. A `months` period rejects an empty array and descending order. | 0- vs 1-based month confusion at the schema. |
| V1 | `budget-breach` mapping. | The table's two rows; adherence month 0 gives `<year>-01` and month 11 gives `<year>-12`; `ratio: null` (spend against nothing budgeted) stays null; an unscored breach is still emitted. | A severity ignoring `scored`; an off-by-one month; a re-filter. |
| V2 | `budget-underspend` mapping. | Qualifying months `[2, 5, 6]` become ascending `YYYY-MM` strings, not assumed contiguous; window totals are carried; severity `notice` for scored and unscored. | Contiguity assumption; a `warning`. |
| V3 | `balance-drift` mapping. | A positive and a negative `drift`; a credit-account fixture whose ledger and expected balances are negative stay negative strings; `observedAt: null` stays null; both `safeToDerive` values give `warning`; no `-0.00` string. | Sign inversion; null defaulted to a time; `-0.00`. |
| V4 | `feed-degraded` mapping. | Failing and stale rows; `institutionStatus: null` stays null and `'HEALTHY'` stays `'HEALTHY'`; `hoursStale: null` stays null; timestamps are ISO strings. | Unknown mapped to healthy; hours null coerced to 0. |
| V5 | `sync-stale` mapping. | `ok` yields nothing; `never` yields `warning` with `daysStale: null`; `stale` yields `notice`. | Converting healthy items; null as 0. |
| V6 | `job-overdue` mapping. | `fresh` yields nothing; `late` `notice`; `missed` and `never` `warning`; `daysSince: null` for `never`; `message` verbatim. | A `fresh` converted; message rewritten. |
| V7 | `cash-uncounted` mapping. | `never` `warning` with `daysSinceCount: null`; `stale` `notice`; a negative balance keeps its sign. | Null as 0 ("counted today"). |
| V8 | `valuation-stale` mapping. | `never` `warning` with `daysSince: null`; `stale` `notice` with the day count. | Absent vs null; severity swapped. |
| V9 | `overdraft-open` mapping. | `critical`, `observed`, a negative balance keeps its sign, `bank: null` stays null. | A softened or inverted severity. |
| V10 | `overdraft-forecast` mapping. | `warning`, `projected`; a fixture whose `charges` hold a canary label emits a Finding that contains the canary nowhere. | Row text leaking; confidence `observed`. |
| V11 | Producer-order monotonicity. | For feed, sync, wallets and valuations, a fixture exercising both states in the producer's own sorted order: converted severities are non-increasing. | Ranking a state above one the producer ranks higher. |
| V12 | Money formatting equals `wireMoney`. | A table of at least 12 inputs including `-0.004`, `0.005`, `1.005`, `-0`, `1e-7`, a large magnitude: the conversions' string equals `wireMoney(n)` for each. | A second rounding rule. |
| V13 | Lossless carriage. | For each kind, a fully populated producer fixture in which every field holds a distinct sentinel: each sentinel appears in the serialised Finding, except the explicitly dropped set, which equals exactly `ForecastFinding.charges`. | A producer field silently dropped. |
| V14 | Count and reportability. | One Finding per reportable producer finding; the unreportable states (sync `ok`, job `fresh`) yield none; for each source the output count equals the input's reportable count. | Dropping, duplicating, or converting unreportable states. |
| A1 | All sources omitted. | `findings` is `[]` and `notEvaluated` has all nine ids in canonical order. | An omitted source reading as clean. |
| A2 | Supplied but empty. | Nine empty arrays (and a `fresh` job) give `findings: []` and `notEvaluated: []`. | Conflating empty with omitted. |
| A3 | Partial. | Omitting only `valuations` gives `notEvaluated: ['valuations']` and no valuation finding even though the other sources emit. | A source missing from the report. |
| A4 | Ordering and determinism. | Severity non-increasing across the output; within a source the producer's order is preserved; permuting the input object's keys leaves the output deep-equal. | Ascending sort; order dependent on call shape. |
| A5 | Purity. | Deep-frozen inputs do not throw; the output shares no reference with the inputs; fake timers at two different system times give deep-equal output. | Mutation, aliasing, a hidden clock. |
| A6 | Full coverage parses. | A fixture exercising all ten kinds in every state yields a list in which every Finding parses against the strict schema, and the set of kinds present equals the ten. | A kind the assembler never emits. |
| A7 | As-of formatting. | `{year, month:0, day:5}` → `YYYY-01-05`; `{month:11, day:31}` → `YYYY-12-31`; `{month:12}` and `{day:0}` throw `RangeError`. | The 0/1-based month error; an invalid date formatted. |
| A8 | No merge and no row text. | A feed and a sync finding for the same institution name both appear; the serialised full output of the A6 fixture, with canaries planted in the forecast charges, contains no canary. | Deduplication; a leaked label. |
| W1 | Severity is assigned only in the vocabulary modules. | AST over every non-test, non-kit source under `apps/web/app`, `apps/web/lib`, `apps/web/components` and `packages/contracts`, excluding `lib/domain/findings*.ts`: no property assignment, shorthand property or computed key named `severity` takes a `critical`/`warning`/`notice` literal (directly, through a ternary, or through a same-file const). Reads such as `f.severity === 'critical'` are allowed. Fabricated violators are each flagged and a clean source is not. | A card, a digest builder or a new detector inventing its own severity. |
| W2 | The kind registry matches the contract exactly. | The registry (the exported conversion map) names every kind the contract names and no other. A fabricated contract/registry pair missing a kind, and one with an extra kind, are each flagged. | A kind added without a conversion. |
| W3 | Producer inventory is complete. | Every exported `interface`/`type` named `*Finding` or `*Health` in a non-test source under `apps/web/lib` or `apps/web/components`, excluding `lib/domain/findings*.ts`, appears in the inventory registry with a disposition `converted` (naming its kinds) or `excluded` (with a reason of at least 20 characters). Expected real set: `BreachFinding`, `ChronicUnderspendFinding`, `AdherenceFinding`, `DriftFinding`, `FeedFinding`, `SyncItemHealth`, `JobHealth`, `WalletFinding`, `ValuationFinding`, `OverdraftFinding`, `ForecastFinding`. Every `converted` entry names a kind that exists, and every kind has at least one. A fabricated source declaring `export interface RentFinding` is flagged. This is a naming heuristic, a proxy for "is a finding producer"; the hand inventory above is the other half of the control. | A new producer added with no decision about the vocabulary. |
| W4 | The vocabulary is pure and single-sourced. | In `lib/domain/findings*.ts`: every non-type import resolves inside `lib/domain/**`, `lib/budgetMath`, `@b8/contracts/findings` or `zod`; `import type` of `lib/overdraftWatch` is allowed; none imports `isScoredCategory` or `isTrackedCategory`; no `Date.now(`, zero-argument `new Date(`, `Math.random(`, `parseFloat` appears. The check is run on fabricated violators and clean sources. | A database import, a hidden clock, a second copy of the scored-set definition. |
| W5 | The contract file is closed. | `packages/contracts/findings.ts` imports nothing from `apps/web`, never calls `.optional()`, and never builds a member with `z.object(` (only the strict form). Fabricated violators flagged. | An optional field or a stripping schema. |
| W6 | Registry integrity. | Every inventory entry names a file that exists; every `excluded` entry has a reason; every `converted` entry's producer file exists. | A stale or blanket entry. |

## Acceptance commands
All from the repo root, under `bash`. BASE and IBASE are T4's and T7's recorded numbers. `B="$(git merge-base HEAD main)"`. A stub fails because every scenario command asserts concrete values by named scenario, exactly once each.

| # | Command | Expected | Catches |
|---|---|---|---|
| 1 | `(cd apps/web && npx tsc --noEmit; echo "exit=$?")` | `exit=0` | A conversion typed against a stale producer shape; a producer field added without a carriage decision. |
| 2 | `npx tsc --noEmit; echo "exit=$?"` | `exit=0` | The new contract file failing the whole-repo check. |
| 3 | `npm run lint; echo "exit=$?"` | `exit=0`, warnings not above the pre-change count | Lint regressions. |
| 4 | `npm test 2>&1 \| tail -8` | 0 failed; test files exactly BASE + 3; tests at least BASE + 34 | A stray test file; an existing test removed or skipped. |
| 5 | Scenario command, below | three lines `OK 34 scenarios C V A W each present once and passed TZ=<zone>` | A missing, skipped, duplicated or untitled scenario; behaviour that depends on the process zone. |
| 6 | Integration command, below | `OK <IBASE> integration tests, none failing except RC-03` | The overview route test and every other route test still green; the throwaway DB untouched by this task. |
| 7 | Added-lines guard, below | no output | A UTC date slice or a comma-grouped dollar figure in new files (weak by design; never the feature's evidence). |
| 8 | Nothing-existing-changed guard, below | no output | An edit to any existing file, deletion or rename; any new file outside the five declared. This is the proof that no card, payload or digest output can have changed. |
| 9 | `npm run build; echo "exit=$?"` | `exit=0` | The new contract subpath failing to resolve in the Next build. |

**#5 (scenarios; three zones).**
```
set -e; for TZV in UTC Pacific/Auckland America/Los_Angeles; do O="$(mktemp)"; (cd apps/web && TZ=$TZV npx vitest run findings.test.ts findingsWiring.test.ts --reporter=json --outputFile="$O") || true; node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);const rng=(p,n)=>[...Array(n).keys()].map(i=>p+(i+1));const ids=[...rng("C",6),...rng("V",14),...rng("A",8),...rng("W",6)];let bad=[];for(const id of ids){const m=t.filter(x=>x.title.startsWith("T34-"+id+":"));if(m.length!==1||m[0].status!=="passed")bad.push(id+"="+m.map(x=>x.status).join("/")+"("+m.length+")")}const failed=t.filter(x=>x.status!=="passed").map(x=>x.title);if(bad.length||failed.length){console.log("FAIL",process.argv[2],bad.join(","),failed.join(" ; "));process.exit(1)}console.log("OK 34 scenarios C V A W each present once and passed TZ="+process.argv[2])' "$O" "$TZV"; done
```
The filters `findings.test.ts` and `findingsWiring.test.ts` match `packages/contracts/findings.test.ts`, `lib/domain/findings.test.ts` and `lib/findingsWiring.test.ts` (no other file contains those strings today).

**#6 (integration).**
```
set -e; O="$(mktemp)"; (cd apps/web && DATABASE_URL=postgresql://localhost/b8_p34_throwaway npx vitest run --config vitest.integration.config.mts --reporter=json --outputFile="$O") || true; node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);const bad=t.filter(x=>x.status==="failed"&&!x.title.startsWith("RC-03:")).map(x=>x.title);if(bad.length||t.length<1){console.log("FAIL",bad.join(" ; "));process.exit(1)}console.log("OK",t.length,"integration tests, none failing except RC-03")' "$O"
```
Expected output has `<n>` equal to IBASE (the orchestrator compares to T7). KNOWN failing is RC-03 only.

**#7 (added-lines guard; weak by design).**
```
{ git ls-files -o --exclude-standard -- apps packages | grep -E 'findings' | xargs -r cat; } | grep -nE "toISOString\(\)\.(slice|split)|\\\$[0-9]+\.[0-9]{2}\b|\\\$[0-9]{1,3}(,[0-9]{3})+"
```
Expected no output (grep exit 1). A fixture amount written as a bare number is allowed; the guard only catches figures written as currency.

**#8 (nothing existing changed; only the declared files added).**
```
B="$(git merge-base HEAD main)"; set -e; git diff --name-status "$B" -- apps packages migrations db ':(exclude)*AGENTS.md' ':(exclude)*CLAUDE.md' | grep -v '^A' || true; { git ls-files -o --exclude-standard -- apps packages migrations db; git diff --name-only --diff-filter=A "$B" -- apps packages migrations db; } | sort -u | grep -vE '^(packages/contracts/findings(\.test)?\.ts|apps/web/lib/domain/findings[A-Za-z]*(\.test)?\.ts|apps/web/lib/findingsWiring\.test\.ts)$' || true
```
Expected no output from either half. The first half prints any modified, deleted or renamed tracked file. The second prints any new file outside the declared set. If `tsc` leaves a build-info file that git does not ignore, the orchestrator adjudicates at G2 and records it.

Orchestrator-applied mutations (G2/G3), one at a time, each reverted afterwards with the tree's checksum unchanged. Exactly the named scenarios must fail:
- Swap the severities of `never` and `stale` for wallets → V7, V11.
- Map `institutionStatus: null` to `'HEALTHY'` → V4.
- Coerce `daysSinceCount: null` to `0` → V7, V13.
- Ignore `scored` when choosing a breach's severity → V1.
- Format the adherence month without adding 1 → V1, V2, A7.
- Drop `notEvaluated` (always empty) → A1, A3.
- Negate `drift` → V3.
- Carry `ForecastFinding.charges` → V10, V13, A8, C3.
- Sort the assembled list ascending → A4.
- Add `severity: 'warning'` to an object literal in a component → W1.
- Add `export interface RentFinding` under `lib/domain/` → W3.
- Remove one kind from the conversion registry → W2 (and `tsc` fails, command #1).
- Convert sync `ok` items → V5, V14.
- Call `Date.now()` inside the assembler → W4, A5.

## Negative controls
| # | Rule | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | Severity follows `scored` for breaches | a breach with `scored: false` must not be `warning`; it must still be emitted | V1 |
| 2 | Chronic underspend is not money at risk | a chronic-underspend finding must not be `warning` | V2 |
| 3 | Drift keeps its sign | a negative `drift` and a credit-account negative balance must not be negated or absolute-valued | V3 |
| 4 | Unknown is never fine | feed `institutionStatus: null` must not become `'HEALTHY'`; `hoursStale`, `daysStale`, `daysSince`, `daysSinceCount` nulls must not become `0` | V4–V8, V13 |
| 5 | Unreportable states stay unreported | sync `ok` and job `fresh` must not appear | V5, V6, V14 |
| 6 | The producer's own order is respected | a state the producer sorts first must not receive a lower severity than one it sorts after | V11 |
| 7 | An omitted source is not a clean source | a missing `valuations` key must not appear as "no valuation findings" without being named | A1, A3 |
| 8 | No row text in a Finding | a `ForecastFinding.charges` entry with a canary label | V10, A8 |
| 9 | No merging across kinds | a feed finding and a sync finding for the same institution must both appear | A8 |
| 10 | Severity is assigned in one place | a `severity: 'warning'` literal anywhere outside `lib/domain/findings*.ts` | W1 |
| 11 | Every producer is decided | an unregistered exported `*Finding` type | W3 |
| 12 | A kind without a conversion is impossible | a contract kind with no registry entry (and the reverse) | W2 |
| 13 | The scored-set definition has one home | an import of `isScoredCategory` or `isTrackedCategory` in a vocabulary module | W4 |
| 14 | The contract is closed | an unknown key on any member; an omitted nullable key | C3, C4 |
| 15 | Months are not ambiguous | adherence month 11 must not become `-11` or `-13`; as-of month 12 must not format | V1, C6, A7 |
| 16 | One rounding rule | any money string differing from `wireMoney` for the same number | V12 |
| 17 | Nothing existing changed | any modified, deleted or renamed file under `apps`, `packages`, `migrations`, `db` | acceptance #8 |

## Evidence required
- The command-#5 output for all three zones, and the command-#4, #6 and #8 outputs, captured verbatim by the orchestrator.
- A printed table of kind × producer state → severity and confidence, generated by a test run (names and enum values only, no figures), matching the mapping table above.
- The inventory registry's dispositions, printed, matching the inventory table above.
- The mutation log (14 entries) with each run's failing scenario ids.
- A short note in EVIDENCE.md recording the overview-payload decision and why, for step 36's author.
- No money figure, name or merchant in EVIDENCE.md.

## Failure modes to test
- A severity table that quietly ranks `stale` above `never`, or `scored` above `unscored`, in the wrong direction.
- Null coerced to zero: "never counted" becomes "counted today", "no successful update" becomes "0 hours stale", "never valued" becomes "valued 0 days ago".
- `institutionStatus: null` (unread) turned into `'HEALTHY'`, or a `HEALTHY` status used to suppress or lower a stale feed.
- Month off-by-one: adherence's 0-based month used raw in `YYYY-MM`, or the as-of month rendered without adding 1, shifting every period a month; December rolling to `13` or January to `00`.
- Year taken from the wrong source: a finding for month `m` labelled with the current year when the producer's implicit year is `asOf.year`.
- A second money formatter that rounds differently from `wireMoney` at half-cent values, or emits `-0.00`.
- Sign inversion: the credit/loan normalisation applied a second time, `drift` negated, `variance` computed as `budgeted − actual`.
- `ratio` as `Infinity`, `NaN` or `0` for a zero-budget breach.
- An empty combined list read as "all clear" when a source was simply never supplied, the P0.5-29a N11 shape at the digest level.
- A feed `unknown` or a never-observed institution being invisible: documented as inherited, not hidden or fixed here.
- A new producer added later with its own severity, because nothing forced a decision (W1, W3).
- A kind added to the contract without a conversion, or the reverse (W2, tsc).
- The scored-set predicate re-implemented in a conversion and drifting on its third conjunct.
- `ForecastFinding.charges` (merchant labels) carried into a household-wide list.
- The assembler's order depending on object key order, or on `Array.sort` instability across the producers' own orders.
- The assembler mutating a producer's array when sorting, or returning references into it.
- The strict schema accepting an extra key because `z.object` was used.
- A required nullable field typed optional, so "absent" and "null" become the same thing.
- Time-zone dependence: a conversion that builds a `Date` from a calendar string and shifts it a day under a negative offset (the suite runs under three zones).
- Coupling creep: a vocabulary module importing the database through `overviewRead` or `overdraftWatch` at runtime (W4 allows `import type` only).
- A "reportable" predicate (sync not `ok`, job not `fresh`) restated differently from the UI's, so the list and the card disagree on whether something is a problem. The predicates are pinned by V5, V6 and V14 against the same producer outputs the cards see.
- Double counting: one overdraft account appearing as both an episode and a forecast. The producer already closes the forecast when an episode opens; the converter must not synthesise either.

## Rollback
Nothing is deployed behaviour, no data is written, and no migration exists. Revert the commit, or delete exactly the declared new files: `packages/contracts/findings.ts`, `packages/contracts/findings.test.ts`, `apps/web/lib/domain/findings*.ts` (including the test) and `apps/web/lib/findingsWiring.test.ts`. No existing file was modified, so there is nothing to restore. Because nothing imports the new modules, removing them cannot affect any page, route, digest or job. Step 35 and step 36 depend on this contract, so reverting after either starts is not clean. If this task is reverted, they must not have begun.