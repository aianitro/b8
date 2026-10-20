# P5-36-digest — implementer's evidence

Run on 2026-10-20 in the main tree at `dfafc2f` (uncommitted work), under plain `bash` from the repo root, against
`b8_p36_throwaway`. Every block was extracted from SPEC.md by script, not retyped. #6b is block C with
`--sequence.shuffle --sequence.seed=1` inserted before `--outputFile` (GATES.md, T12 correction). No figures appear below:
only counts of tests, files, sources and days.

Baselines (GATES.md G0): BASE 92 files / 1296 tests; IBASE 245; lint 0 errors / 5 warnings; T13 route format `├ ƒ /dashboard`.

## Recovery note: a mutation probe was still applied

The previous implementer was stopped while running its own mutation probes. One probe was still in the tree:
`composeDigest`'s `none-reported` headline in `apps/web/lib/domain/findingsDigest.ts` ended with an appended all-clear
sentence (the spec's mutation M6). It was removed, restoring the neutral count the spec requires. Every other new and
modified file was read against the spec; nothing else looked like a probe (comparator, tie-break, filters, caveat,
status rule, tallies, period validation, loader `attempt` and freshness fallback all match SPEC.md).

## Scope note: `apps/web/lib/giftSurfaceRegistry.ts` (outside the declared set)

Block E (#8) prints `M	apps/web/lib/giftSurfaceRegistry.ts`. The change is one entry plus a one-line comment:
`{ file: 'app/digest/page.tsx', classes: ['numeric-only'] }`. It is required, not optional: the existing gift wiring
test `apps/web/lib/giftSurfaceWiring.test.ts` scenario `T41b-W4` fails for any `page.tsx` under `app/` that the
registry does not list. With the registry change reverted, measured:

```
 FAIL  lib/giftSurfaceWiring.test.ts > every page and route is classified (W4) > T41b-W4: the registry lists exactly the route.ts files under app/api/v1 and the page.tsx files under app, each with a class and, where text-bearing, its scenario
AssertionError: expected [ 'unclassified app/digest/page.tsx' ] to deeply equal []
+   "unclassified app/digest/page.tsx",
      Tests  1 failed | 12 passed (13)
```

`numeric-only` is the class whose definition matches the spec's goal 3 (no row text, figures the same for every
viewer; T36-L4 proves both). The spec's declared set should be amended to include this file.

## Palette note

The design system's tables say `gray-*`; `DigestView.tsx` follows the surrounding pages' `slate-*`, and severity is the
only hue (red critical, amber warning, slate notice). The design system's `Intl.NumberFormat` rule for currency is
deliberately not followed: SPEC.md Q7 and T36-W5 require money strings verbatim and forbid `Intl.NumberFormat` in the
view. Both departures are explained in the view's header comment.

## Acceptance commands

### #1
```
$ (cd apps/web && npx tsc --noEmit; echo "exit=$?")
exit=0
```

### #2
```
$ npx tsc --noEmit; echo "exit=$?"
exit=0
```

### #3
```
$ npm run lint; echo "exit=$?"
...
✖ 5 problems (0 errors, 5 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

exit=0
```
Five warnings, equal to the baseline; all five are in pre-existing files (`app/login/page.tsx`, two in
`lib/domain/digest.ts`, `public/sw.js`, `scripts/seed-demo.mjs`), none in this step's files.

### #4 (block A)
```
 Test Files  93 passed (93)
      Tests  1314 passed (1314)
   Start at  08:21:52
   Duration  7.38s (tests 64%, import 20%, transform 14%, worker 2%)

    Isolate  93 workers spawned · ~154ms startup each (spawn + environment, per file)
             at least ~1.89s faster with isolate: false — reuses workers across files instead of one per file
```
93 = BASE 92 + 1. 1314 ≥ BASE 1296 + 17 (the 18 new tests are D1–D12, W1–W5 and one evidence-printing test).

### #5 (block B, three zones)
```
OK 71 unit scenarios (34 T34 + 20 T35 + 17 T36) each present once and passed TZ=UTC
OK 71 unit scenarios (34 T34 + 20 T35 + 17 T36) each present once and passed TZ=Pacific/Auckland
OK 71 unit scenarios (34 T34 + 20 T35 + 17 T36) each present once and passed TZ=America/Los_Angeles
```

### #6 (block C)
```
OK 252 integration tests, none failing except RC-03; T35-R1..R9 and T36-L1..L7 each present once and passed
```
252 = IBASE 245 + 7.

### #6b (block C with `--sequence.shuffle --sequence.seed=1`)
```
OK 252 integration tests, none failing except RC-03; T35-R1..R9 and T36-L1..L7 each present once and passed
```

### #7 (block D)
No output; grep exit 1.

### #8 (block E)
```
M	apps/web/lib/giftSurfaceRegistry.ts
```
**Does not meet "no output".** The single line is the registry entry explained above, required by `T41b-W4`. The
second half (added files) prints nothing.

### #9 (block F)
No output; exit 1.

### #10 (block G)
No output; exit 1.

### #11 (block H)
```
rc=1
```
No file listed.

### #12
```
UNTOUCHED
```
No further output.

### #13 (block I)
```
exit=0
97:├ ƒ /digest
```
Same format as the T13 `/dashboard` line.

### #14 (block J)
```
rc=1
```
No matches.

## Caveat and status table (printed by the evidence test, `T36_PRINT=1`)

The status column is `findings` throughout because each row is a one-finding digest.

| kind | freshness state | caveat | status |
|---|---|---|---|
| feed-degraded (failing) | fresh | recent-success-feed-still-failing | findings |
| feed-degraded (failing) | stale | null | findings |
| feed-degraded (failing) | never | null | findings |
| feed-degraded (failing) | undated | null | findings |
| feed-degraded (stale) | fresh | null | findings |
| feed-degraded (stale) | stale | null | findings |
| feed-degraded (stale) | never | null | findings |
| feed-degraded (stale) | undated | null | findings |
| sync-stale | fresh | null | findings |
| sync-stale | stale | null | findings |
| sync-stale | never | null | findings |
| sync-stale | undated | null | findings |
| job-overdue | fresh | null | findings |
| job-overdue | stale | null | findings |
| job-overdue | never | null | findings |
| job-overdue | undated | null | findings |
| balance-drift | fresh | null | findings |
| balance-drift | stale | null | findings |
| balance-drift | never | null | findings |
| balance-drift | undated | null | findings |

## One digest per status (fabricated data, statements and kinds only)

The `findings` example pairs fabricated freshness values with kinds by position (the D8 fixture), so some basis
words do not match the kind they sit on (a job finding dated by a sync, for instance). The point is the wording per
state, the order and the tallies, not the pairing.

### findings — status findings
- headline: 10 findings reported by 8 of 9 sources. 1 source was not evaluated, so the list may be incomplete.
- coverage: 8 of 9 sources were evaluated. Not evaluated: balance drift.
- tallies: fresh 3, stale 2, never 2, undated 3, undated inputs 8
1. overdraft-open (critical) — This cannot be dated: there is no usable record of the last successful sync. 3 inputs behind it cannot be dated.
2. overdraft-forecast (warning) — This cannot be dated: there is no usable record of the last successful bank feed refresh. 1 input behind it cannot be dated.
3. budget-breach (warning) — Its oldest input is the last successful sync, 0 days ago.
4. feed-degraded (warning) — Its last successful sync was 9 days ago; that dates when it last worked, and the finding still stands.
5. feed-degraded (warning) — The feed is still failing. Its last successful bank feed refresh was 0 days ago; that dates when it last worked, and the failure is current.
6. job-overdue (warning) — A successful sync has never been recorded.
7. sync-stale (notice) — Its last successful sync was 4 days ago; that dates when it last worked, and the finding still stands. 2 inputs behind it cannot be dated.
8. cash-uncounted (notice) — A successful sync has never been recorded. 1 input behind it cannot be dated.
9. valuation-stale (notice) — This cannot be dated: nothing it rests on has a usable record of when it was last true. 1 input behind it cannot be dated.
10. budget-underspend (notice) — Its oldest input is the last successful sync, 2 days ago.

### incomplete — status incomplete
- headline: The 7 sources evaluated reported no findings, but 2 of 9 were not evaluated, so this is incomplete.
- coverage: 7 of 9 sources were evaluated. Not evaluated: cash wallets, overdraft forecasts.
- tallies: fresh 0, stale 0, never 0, undated 0, undated inputs 0

### none-reported — status none-reported
- headline: 9 of 9 sources were evaluated and none of them reported a finding.
- coverage: 9 of 9 sources were evaluated: budget adherence, balance drift, bank feed, sync status, daily job, cash wallets, valuations, open overdrafts, overdraft forecasts.
- tallies: fresh 0, stale 0, never 0, undated 0, undated inputs 0

## G2 cycle 1 fix: M14 survived through dot access

The orchestrator's M14 (a new `apps/web/scripts/zz-probe.ts` writing `{ severity: LEVELS.high }` from
`const LEVELS = { high: 'critical' } as const`) passed T36-W2, because `severityAssignments` followed bracket access
into a same-file table but not property (dot) access.

Fix, in `apps/web/lib/findingsWiring.test.ts` only:
- Two new helpers. `tableOf` resolves an expression to a same-file object or array literal: a constant, through
  `as const` and the other wrappers `unwrap` removes, or a named property of such a literal, recursively, so nested
  `M.a.b` and a property holding another constant (`{ a: N }`) resolve. `propertyValue` gives one named key's value,
  covering shorthand keys too.
- `takesSeverityLiteral` gains a property-access branch. It judges only the named property's value, so `M.a` is
  clean when `a` is not a severity even if a sibling is. The existing element-access branch now resolves its table
  through `tableOf`, which also covers nested tables. Its rule is unchanged: any value can be a severity.
- T36-W2 gains five fabricated violators: the exact M14 source as `zz-probe.ts`, plain dot access, nested
  `as const` dot access assigned to `finding.severity`, nesting through a second constant, and a `.tsx` JSX
  attribute. It also gains four clean cases: dot access into `{ a: 'high' }` (plain and `as const`), dot access to
  the non-severity sibling of a severity value, a `.tsx` JSX attribute reading `{ a: 'high' }`, and
  `input.levels.high`, which is not a same-file table.
- No existing assertion was removed or changed; #10 below stays empty. The real-tree scan stays clean.

Kill check (run, then the probe file deleted; `ls apps/web/scripts/zz-probe.ts` reports no such file afterwards):
```
+   "scripts/zz-probe.ts /Users/andreianpilogov/Documents/b8/app/apps/web/scripts/zz-probe.ts:2 property",
      Tests  1 failed | 14 skipped (15)
```

Re-run after the fix, under plain bash:
- #1 `exit=0`
- #3 `✖ 5 problems (0 errors, 5 warnings)` then `exit=0` (baseline unchanged)
- #4 `Test Files  93 passed (93)` / `Tests  1314 passed (1314)`
- #5 `OK 71 unit scenarios (34 T34 + 20 T35 + 17 T36) each present once and passed TZ=` UTC, Pacific/Auckland,
  America/Los_Angeles (three OK lines)
- #8 `M	apps/web/lib/giftSurfaceRegistry.ts`, the same single line as before, explained above, and nothing else
- #10 no output, rc=1
- #7 (re-checked, because the wiring test gained lines) no output, rc=1

## Mutation log

Not run by this implementer: the orchestrator runs M1–M20 at G2/G3. The only mutation observed was the leftover M6
probe described above, which was removed.

## Browser check

Not run by this implementer; it is the orchestrator's separate check (T15).

## Note for step 37's author

What `composeDigest` guarantees:
- **Carriage.** One item per input finding; nothing dropped, added, merged or de-duplicated; each item's finding is a
  deep copy, deep-equal to its input.
- **Order.** Severity first, then the Q3 kind table (money at risk first), then input position. Independent of input
  order except among findings of one severity and kind.
- **Dating.** Each item copies the finding's freshness state, basis, age and undated-input count, never upgraded;
  `never` and `undated` are never worded with an age or counted as fresh. A failing feed with a fresh last success
  carries the coded caveat `recent-success-feed-still-failing`, and no feed, sync or job item is worded as working.
- **Coverage.** Evaluated and not-evaluated sources partition the nine in canonical order; every unevaluated source is
  named. A source whose read fails in the loader is not evaluated, never an empty list, and a failed freshness-facts
  read leaves every finding undated.
- **No row text, no viewer dependence.** The digest carries no transaction text and is identical for every viewer.

What it deliberately does not say: no all-clear verdict and no positive "nothing to report" statement (the empty digest
is a neutral count of sources evaluated); no weekly content; no money in any sentence (money stays in the carried
finding as the contract's string, rendered verbatim).

Dispositions: P5-35 N1 (SQL-clock check widened, T36-W1); the fresh-is-not-health carry-in (T36-D5); P5-35 N2 (the
`INDEXES` cache precondition documented, comment only); P5-35 N3 (R-file header reworded, comment only); the R-file
isolation constraint (the new integration file seeds and empties everything it reads; #6b green); P5-34 N1 (severity
check widened to lookups, helper returns, scripts and `instrumentation.ts`, T36-W2; the real tree is clean); P5-34 N4
(kind order in the digest only, T36-D2); P5-34 N5 (figures viewer-invariant, T36-L4); P5-34 N6 (zero-budget comment and
the stale "nothing imports this" header reworded, comment only).
