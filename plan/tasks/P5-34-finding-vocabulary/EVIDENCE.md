# P5-34-finding-vocabulary — evidence bundle (implementer)

**Date:** 2026-10-19. **Tree:** main at `0d8f8af`, uncommitted, no worktree. **Not committed.**

All commands were run from the repository root under `bash`, exactly as SPEC.md writes them (the #5–#8 blocks
extracted to scripts in the session scratchpad, byte-for-byte). Outputs below are verbatim except where a section
says it is truncated and why.

## Files added (the only changes under apps, packages, migrations, db)

| File | What it is |
|---|---|
| `packages/contracts/findings.test.ts` | C1–C6 (written by the implementer, per the G0 process ruling) |
| `apps/web/lib/domain/findings.ts` | the ten conversions, `findingMoney`, `calendarMonthOf`, `asOfDate`, the `FINDING_CONVERSIONS` registry, `FINDING_SOURCES`, `assembleFindings` |
| `apps/web/lib/domain/findingsInventory.ts` | `PRODUCER_INVENTORY`: the inventory table as data (11 converted, 13 excluded with reasons) |
| `apps/web/lib/domain/findings.test.ts` | V1–V14, A1–A8, the type-level producer-field exactness check, the printed mapping table |
| `apps/web/lib/findingsWiring.test.ts` | W1–W6 (TypeScript compiler API), each checker also run on fabricated violating and clean sources; the printed inventory |

`packages/contracts/findings.ts` is unchanged from G1. sha256 at the end of this task:

    b55590fadfca9db2dc5c12d8bb93a7e7574955cae7d4fcf66a8ca5777108b734  packages/contracts/findings.ts

(equal to the G1 digest in GATES.md). sha256 of the other declared files at hand-off:

    7b11bdc72b2c2430b26135b9af542ce2a4c899a2e76e20e19d0af6adb91a1067  apps/web/lib/domain/findings.ts
    e1d912c5f7d7b4c53b46ba9026c60a87d4b5bbf52df69a81b755015614576c4f  apps/web/lib/domain/findingsInventory.ts
    779287bc5c3b4a93c5636519c237ba0d78a27b5f546cf1133c046566dbde0831  apps/web/lib/domain/findings.test.ts
    f52f36262f12cfb35293da630748ae6ec9ca1502443015f925567d945ea2d57c  apps/web/lib/findingsWiring.test.ts
    11f314d08ba3eef0baafecde2f45866e959d62c108065e9fd9dadb926f183f04  packages/contracts/findings.test.ts

`git status --short` at hand-off:

```
 M plan/QUEUE.md
?? apps/web/lib/domain/findings.test.ts
?? apps/web/lib/domain/findings.ts
?? apps/web/lib/domain/findingsInventory.ts
?? apps/web/lib/findingsWiring.test.ts
?? packages/contracts/findings.test.ts
?? packages/contracts/findings.ts
?? plan/tasks/P5-34-finding-vocabulary/
```

`plan/QUEUE.md` was already modified before this task started (it is in the starting `git status`); this task did
not touch it. `EVIDENCE.md` is this file.

## Acceptance commands

### #1 `(cd apps/web && npx tsc --noEmit; echo "exit=$?")`
```
exit=0
```

### #2 `npx tsc --noEmit; echo "exit=$?"`
```
exit=0
```

### #3 `npm run lint; echo "exit=$?"`
Warnings 5, equal to the G0 baseline (0 errors, 5 warnings); none is in a new file.
```

> b8@0.1.0 lint
> eslint

Pages directory cannot be found at /Users/andreianpilogov/Documents/b8/app/pages or /Users/andreianpilogov/Documents/b8/app/src/pages. If using a custom path, please configure with the `no-html-link-for-pages` rule in your eslint config file.

/Users/andreianpilogov/Documents/b8/app/apps/web/app/login/page.tsx
  112:7  warning  Do not use `window.location.assign()` to navigate to internal Next.js pages. Use `redirect()` in the render phase, or `useRouter().push()` in Client Components' event handlers instead. See: https://nextjs.org/docs/messages/no-location-assign-relative-destination  @next/next/no-location-assign-relative-destination

/Users/andreianpilogov/Documents/b8/app/apps/web/lib/domain/digest.ts
  202:7  warning  'GREEN_SOFT' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  204:7  warning  'RED_SOFT' is assigned a value but never used. Allowed unused vars must match /^_/u    @typescript-eslint/no-unused-vars

/Users/andreianpilogov/Documents/b8/app/apps/web/public/sw.js
  1:1  warning  Unused eslint-disable directive (no problems were reported from 'no-restricted-globals')

/Users/andreianpilogov/Documents/b8/app/apps/web/scripts/seed-demo.mjs
  457:17  warning  'pid' is assigned a value but never used. Allowed unused elements of array destructuring must match /^_/u  @typescript-eslint/no-unused-vars

✖ 5 problems (0 errors, 5 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

exit=0
```

### #4 `npm test 2>&1 | tail -8`
BASE was 88 files, 1240 tests. Now 91 files (BASE + 3, exactly) and 1276 tests (BASE + 36, at least BASE + 34 as
required: 34 scenarios plus the two printed-evidence tests). 0 failed.
```
 Test Files  91 passed (91)
      Tests  1276 passed (1276)
   Start at  18:10:43
   Duration  12.42s (tests 63%, import 22%, transform 13%, worker 2%)

    Isolate  91 workers spawned · ~309ms startup each (spawn + environment, per file)
             at least ~3.71s faster with isolate: false — reuses workers across files instead of one per file

```

### #5 scenario command, three zones
```
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.kThuMK11F6
OK 34 scenarios C V A W each present once and passed TZ=UTC
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.Fl3sKErqJR
OK 34 scenarios C V A W each present once and passed TZ=Pacific/Auckland
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.Iev0LIaNn0
OK 34 scenarios C V A W each present once and passed TZ=America/Los_Angeles
```

### #6 integration command
IBASE was 236. The run prints the suite's own structured log lines first (498 of them, from existing route tests
exercising error paths, unrelated to this task); they are omitted here, and only the last two lines are shown. The
orchestrator re-runs the command independently.
```
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.qgCMZGoFoy
OK 236 integration tests, none failing except RC-03
```

### #7 added-lines guard
Expected no output (grep exit 1). The first run of this command DID print one line: a comment in
`apps/web/lib/domain/findings.ts` that named the UTC-slice anti-pattern literally while explaining why the module
does not use it. The comment was reworded to describe the pattern without writing it; the guard is weak by design
and that is exactly the kind of false positive it produces. Final run:
```
grep-exit=1
```
(`grep-exit=1` is the echo of grep's exit status: no match. Nothing else was printed.)

### #8 nothing existing changed
Expected no output from either half.
```
exit=0
```
(`exit=0` is the echo appended to the command; neither half printed anything.)

### #9 `npm run build; echo "exit=$?"`
Truncated: the first 15 lines and the last 12 lines; the middle is the per-route table and Node's
`ExperimentalWarning` lines about Web Crypto, which are pre-existing.
```

> b8@0.1.0 build
> npm run build -w @b8/web


> @b8/web@0.1.0 build
> next build

▲ Next.js 16.3.0 (Turbopack)
- Environments: .env.local
✓ Running next.config.ts took 71ms

  Creating an optimized production build ...
✓ Compiled successfully in 1623ms
  Running TypeScript ...
[...]
├ ƒ /properties/[id]
├ ƒ /rules
├ ƒ /sandbox
└ ƒ /transactions


ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand

exit=0
```

What #9 does and does not prove: the build succeeds with the new files present. Because nothing imports the new
modules yet, Next does not bundle them, so this build does not exercise the `@b8/contracts/findings` subpath inside
the Next bundler; `tsc` (#1, #2) and vitest (#4, #5) do resolve it. The first real proof of the subpath in a Next
bundle will be step 35 or 36's first import.

## Mutation log (SPEC.md's fourteen, one at a time, each reverted)

Run by a scratchpad script that applies one textual mutation, runs the #5 test files once under `TZ=UTC`
(`npx vitest run findings.test.ts findingsWiring.test.ts --reporter=json`), lists every non-passing title (the T34
id, or the full title of a non-scenario test), restores the file (or `git checkout`s / deletes the probe file for
M10 and M11), and compares a checksum of the whole tree (`git diff` plus the sha256 of every untracked file) with
the baseline taken before the first mutation. M12 also runs `(cd apps/web && npx tsc --noEmit)`.

Baseline tree checksum `a7a12321253a60817a6b603831b17adea07fc9cf6f9c69fad4544579910c6e34` (taken before
EVIDENCE.md existed). Output, verbatim:
```
baseline checksum a7a12321253a60817a6b603831b17adea07fc9cf6f9c69fad4544579910c6e34
M01 wallet never/stale severities swapped: failing T34-V11,T34-V7,the mapping table computed from the conversions equals SPEC.md | checksum after revert unchanged
M02 institutionStatus null mapped to HEALTHY: failing T34-V13,T34-V4 | checksum after revert unchanged
M03 daysSinceCount null coerced to 0: failing T34-A6,T34-V13,T34-V7 | checksum after revert unchanged
M04 breach severity ignores scored: failing T34-A6,T34-V1,the mapping table computed from the conversions equals SPEC.md | checksum after revert unchanged
M05 adherence month formatted without + 1: failing T34-A7,T34-V1,T34-V2 | checksum after revert unchanged
M06 notEvaluated always empty: failing T34-A1,T34-A3 | checksum after revert unchanged
M07 drift negated: failing T34-V13,T34-V3 | checksum after revert unchanged
M08 forecast charges carried: failing T34-A5,T34-A6,T34-A8,T34-V10,T34-V13 | checksum after revert unchanged
M09 assembled list sorted ascending: failing T34-A4 | checksum after revert unchanged
M10 severity: 'warning' added to a component: failing T34-W1 | checksum after revert unchanged
M11 export interface RentFinding under lib/domain: failing T34-W3 | checksum after revert unchanged
M12 one kind removed from the conversion registry: failing T34-A6,T34-W2,T34-W6 | apps/web tsc exit=2 | checksum after revert unchanged
M13 sync ok items converted: failing T34-V14,T34-V5,the mapping table computed from the conversions equals SPEC.md | checksum after revert unchanged
M14 Date.now() called inside the assembler: failing T34-A5,T34-W4 | checksum after revert unchanged
```

Comparison with the spec's prediction. Every scenario the spec names fails under its mutation. Some mutations
fail additional scenarios as well; each extra is a real detection, not a flaky test, and is listed so the
orchestrator can adjudicate "exactly the named scenarios":

| # | Mutation | Spec predicts | Observed | Extra / missing, and why |
|---|---|---|---|---|
| M01 | wallet never/stale swapped | V7, V11 | V7, V11 | plus the printed mapping-table test (not a scenario), which asserts the table |
| M02 | `institutionStatus: null` to `'HEALTHY'` | V4 | V4, V13 | V13 also checks that every producer null stays null under its own key, which this mutation breaks |
| M03 | `daysSinceCount: null` to `0` | V7, V13 | V7, V13, A6 | A6 parses every assembled finding; the contract's never/null refinement rejects `reason: 'never'` with a count of 0 |
| M04 | ignore `scored` for breaches | V1 | V1, A6 | A6 also requires every state of the mapping table to be present, and `budget-breach/notice` disappears; plus the table test |
| M05 | adherence month without `+ 1` | V1, V2, A7 | V1, V2, A7 | exact |
| M06 | `notEvaluated` always empty | A1, A3 | A1, A3 | exact |
| M07 | negate `drift` | V3 | V3, V13 | V13 looks for each sentinel's printed digits including its sign |
| M08 | carry `charges` | V10, V13, A8, C3 | V10, V13, A8, A5, A6 | **C3 does not fail**: C3 tests the contract with hand-built fixtures and never calls a conversion, so a converter mutation cannot reach it. C3 does assert that the strict schema refuses a forecast carrying `charges`, which is the property the spec attributes to it, and A6 shows that refusal firing on the mutated output. A5 also fails because the carried `charges` array is the input's own reference (aliasing) |
| M09 | sort ascending | A4 | A4 | exact |
| M10 | `severity: 'warning'` in a component (`components/AccountsList.tsx`, reverted with `git checkout`) | W1 | W1 | exact |
| M11 | `export interface RentFinding` under `lib/domain/` (probe file deleted after) | W3 | W3 | exact |
| M12 | remove one kind from the registry | W2, tsc | W2, tsc exit 2, A6, W6 | A6 compares the assembled kinds with the registry's keys; W6 checks every converted inventory kind has a registry entry |
| M13 | convert sync `ok` | V5, V14 | V5, V14 | plus the table test |
| M14 | `Date.now()` in the assembler | W4, A5 | W4, A5 | exact. A5 catches it by spying on `Date.now` and counting zero-argument `new Date()` during a call, not only by comparing outputs at two fake system times (a discarded clock read changes no output) |

Every revert left the tree checksum unchanged (each line ends `checksum after revert unchanged`).

## Printed evidence tables (generated by a test run, names and enum values only)

Command: `(cd apps/web && T34_PRINT=1 npx vitest run findings.test.ts findingsWiring.test.ts -t "evidence" --silent=false)`.
Both tests also assert their tables, so they are not print-only.

Kind × producer state → severity / confidence (matches SPEC.md's mapping table row for row):
```
budget-breach | scored: true -> warning / inferred
budget-breach | scored: false -> notice / inferred
budget-underspend | scored: true -> notice / inferred
budget-underspend | scored: false -> notice / inferred
balance-drift | safeToDerive: true -> warning / observed
balance-drift | safeToDerive: false -> warning / observed
feed-degraded | state: failing -> warning / observed
feed-degraded | state: stale -> notice / observed
sync-stale | status: never -> warning / observed
sync-stale | status: stale -> notice / observed
sync-stale | status: ok -> (no finding)
job-overdue | status: never -> warning / observed
job-overdue | status: missed -> warning / observed
job-overdue | status: late -> notice / observed
job-overdue | status: fresh -> (no finding)
cash-uncounted | reason: never -> warning / observed
cash-uncounted | reason: stale -> notice / observed
valuation-stale | reason: never -> warning / observed
valuation-stale | reason: stale -> notice / observed
overdraft-open | open episode -> critical / observed
overdraft-forecast | open forecast -> warning / projected
```

Inventory dispositions (matches SPEC.md's producer inventory; the gift row is keyed by `GiftOutcome`, the exported
type in `lib/domain/giftMatch.ts` nearest to "the gift window-end notice", which has no exported type of its own):
```
BreachFinding (lib/domain/adherence.ts) -> converted: budget-breach
ChronicUnderspendFinding (lib/domain/adherence.ts) -> converted: budget-underspend
AdherenceFinding (lib/domain/adherence.ts) -> converted: budget-breach, budget-underspend
DriftFinding (lib/domain/drift.ts) -> converted: balance-drift
FeedFinding (lib/domain/feedHealth.ts) -> converted: feed-degraded
SyncItemHealth (lib/domain/syncHealth.ts) -> converted: sync-stale
JobHealth (lib/domain/jobHealth.ts) -> converted: job-overdue
WalletFinding (lib/domain/walletStaleness.ts) -> converted: cash-uncounted
ValuationFinding (lib/domain/valuationStaleness.ts) -> converted: valuation-stale
OverdraftFinding (lib/overdraftWatch.ts) -> converted: overdraft-open
ForecastFinding (lib/overdraftWatch.ts) -> converted: overdraft-forecast
MonthOutlook (lib/domain/monthOutlook.ts) -> excluded: A verdict over every scored category, not a list of detections; folding it in would invent a projected kind and a per-category confidence (SPEC.md open question 3).
CategorizationCoverage (lib/domain/monthOutlook.ts) -> excluded: A confidence qualifier on the headline, not an item worth telling; step 35 or 36 may use it.
AlertMessage (lib/domain/breachAlert.ts) -> excluded: An outbound message derived from the month outlook, not a detection of its own.
DigestData (lib/domain/digest.ts) -> excluded: A consumer and renderer; its job-gap and valuation strings re-render findings already converted here.
PropertyPnl (lib/domain/propertyPnl.ts) -> excluded: Profit and loss arithmetic with no anomaly producer; "no new detectors" forbids inventing one (open question 2).
LedgerRow (lib/domain/propertyLedger.ts) -> excluded: Ledger arithmetic with no anomaly producer; "no new detectors" forbids inventing one (open question 2).
CategoryPace (lib/domain/pacing.ts) -> excluded: A position that feeds the month outlook, an input to a producer rather than an output worth telling.
EpisodeStep (lib/domain/overdraft.ts) -> excluded: A state transition that feeds the overdraft episode table; the open episode it produces is converted.
ForecastStep (lib/domain/overdraft.ts) -> excluded: A state transition that feeds the overdraft forecast table; the open forecast it produces is converted.
CashProjection (lib/domain/cashForecast.ts) -> excluded: A projected cash series that feeds the overdraft forecast, an input rather than a finding.
WatchedTransaction (lib/watchlistRead.ts) -> excluded: A transaction the owner flagged by hand; owner-authored, not a detection.
GiftOutcome (lib/domain/giftMatch.ts) -> excluded: Drives the gift window-end notice, which is private to the giver; a household-wide list carrying it would reveal that a gift exists.
TxnMatchResult (lib/domain/txnMatch.ts) -> excluded: Ingest re-identification of transactions, not anything worth telling the owner.
```

## Decisions made in implementation (for the reviewer)

- **As-of validation is stricter than the spec's floor.** SPEC.md requires a `RangeError` for month outside 0–11 and
  day outside 1–31. `asOfDate` bounds the day by the month's real length through `daysInMonth` from
  `lib/domain/pacing.ts` (the existing single definition), so February 30 also throws. Reason: CONTRACT.md ambiguity
  7 notes the schema refuses such a date, and formatting it would emit a list that fails its own schema. A7 pins the
  spec's cases and February 30. The year must be an integer 1–9999 (four-digit calendar text).
- **`findingMoney` throws `RangeError` on a non-finite input**, where `wireMoney` would print `"NaN"`. The spec
  requires equality for every finite input (V12, which also asserts the throw). No producer emits a non-finite
  money figure.
- **Source order** (for `notEvaluated` and the severity tie-break) is the spec's listing order:
  `adherence, drift, feed, sync, job, wallets, valuations, overdrafts, forecasts`.
- **Assembler input shape:** one object, the nine optional source keys plus `asOf`. `job` is a single `JobHealth`
  (the producer returns one verdict); an explicitly `undefined` key counts as omitted (A1).
- **Type-level exactness for producer fields** lives in `findings.test.ts` (`ProducerFieldsAreDecided`), not in the
  module, so the module's imports stay inside W4's allowed set. It is checked by `tsc` (#1), which includes test files.
- **W1 scope** covers object properties, shorthand properties, computed keys, `x.severity = …` assignments and JSX
  `severity=` props, through ternaries, `??`/`||`/`&&`, type assertions and same-file constants. **W4** restricts
  value imports to the spec's list and type imports to that list plus `lib/overdraftWatch`; it also flags dynamic
  `import()`, `require(`, `performance.now(`, and namespace access to the two scored-set predicates. **W5** also
  flags `.nullish()`, `.partial()`, `.passthrough()`, `.loose()`, `.strip()` and `z.looseObject(`, beside the spec's
  `.optional()` and `z.object(`. Each extension is exercised by a fabricated violator.
- **Palette:** not applicable; no UI was touched.

## What is and is not provable from this bundle

Provable here:
- No existing file under `apps`, `packages`, `migrations` or `db` changed, and the only additions are the five
  declared files plus the frozen contract (#8). Nothing existing imports the new modules, so no card, payload,
  digest, alert or push can have changed behaviour.
- The mapping from each producer state to severity and confidence, null carriage, sign carriage, the drop of
  `charges`, the month and date text, the money formatter's agreement with `wireMoney`, the assembler's
  `notEvaluated`, ordering, determinism and purity — each by a named scenario that the corresponding mutation fails.
- The contract file is byte-identical to the G1 digest.

Not provable here, stated plainly:
- **W3 is a naming heuristic.** A future producer whose type is not named `…Finding` or `…Health` is not caught; the
  hand inventory (13 excluded entries, checked to exist by W6) is the other half of that control, and it is only as
  complete as the reading that produced it.
- **The reportable predicates are restated, not shared.** `fromSync` and `fromJob` restate `status !== 'ok'` and
  `status !== 'fresh'`; V5, V6 and V14 pin them against the producers' own outputs, but nothing mechanically ties them
  to `SyncHealthCard` or the dashboard page (refactoring those was a non-goal).
- **Inherited limits, recorded for step 35, not fixed:** a feed in the `unknown` state is not reported by its
  producer and so is invisible in the list, not "ok"; the sync producer turns a null bank into the text `Unknown`
  before this module sees it.
- **#9 does not bundle the new modules** (nothing imports them), as noted under #9.
- **#6 and RC-03:** the integration command passed with 236 tests; I did not separately record whether RC-03 itself
  passed or flaked on this run, because the command's filter treats either as acceptable.
- Three time zones were tested (#5); others were not.

## Overview-payload decision (for step 36's author)

The `/api/v1/overview` payload does **not** carry the combined list in this step, as SPEC.md decides. Reasons, in
short: step 36 is the first consumer and a field with no reader drifts; adding it would change
`OverviewDataSchema` and the route response, which the owner scoped out; and the payload cannot hold a complete
list today, because sync health (computed inside `SyncHealthCard`), valuation staleness, open overdraft episodes
and open overdraft forecasts (loaded separately by the dashboard page) are not in it. A combined list in the
payload would therefore be a confident list silently missing four sources, the P0.5-29a N11 shape. Step 36 should
decide how to feed `assembleFindings` — and whether to move those four sources into the payload — with its consumer
in hand. Note that `assembleFindings` reports any source it is not given in `notEvaluated`, so a step-36 caller that
supplies only the payload's sources will be told, by name, which four it left out.

No money figure, real name or merchant appears in this file.
