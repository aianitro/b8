# EVIDENCE — P0.5-31-dashboard-repoint

**Author:** implementer · **Date:** 2026-09-02 · **Baseline:** `39c939c`

## 0. Verdict, up front

**All 60 acceptance rows (89 discrete commands once the letter suffixes are counted) pass with the
value the spec requires.** Nothing is partial, nothing is skipped, nothing is waived.

Three things a reviewer should read before the green table below, because they are the parts a
green table cannot show:

1. **One mutation survived**, and it is disclosed in §9 with the reasoning for why it is an
   *equivalent* mutant rather than an ungated guard. Two other mutations survived at first pass and
   were **real gate gaps** — I closed both by strengthening fixtures, and both closures are shown.
2. **The spec's Fixture H9 is arithmetically impossible as written.** §12. I changed one input
   number to preserve every assertion the fixture states; the spec's own expected `state` could not
   be produced from its own inputs.
3. **Acceptance #52 cannot be satisfied by a plain named import**, because an import line plus a
   call site is inherently two lines and the command expects `1`. §12 records how it is satisfied
   and why that is not routing around the gate.

Owner handoff outstanding: **`docs/screenshots/dashboard.jpg` and `net-worth.jpg` are stale and this
task does not regenerate them** (G0 adjudication A1). §14.

---

## 1. Toolchain preconditions (T1–T14)

| # | Required | Measured by me, this session |
|---|---|---|
| T1 | vitest + typescript present | present; `npx vitest` v4.1.10, `npx tsc` runs |
| T2 | tree free of Finder/iCloud `" 2."` duplicates | **`0` at start, `0` at finish.** 11 appeared transiently mid-session, all inside `.next/` and none a `.d.ts`; see the T2 note below. I did not touch them. |
| T3 | clean baseline green | 369 passed at baseline; **399 passed** after this diff (369 + 24 new + 6 new) |
| T4 | `npx tsc --noEmit` exits 0 | `exit=0` |
| T5 | tripwire counts 47 / 24 / 25 | adherence **47**, pacing **24**, netWorth **25 → 31** |
| T6 | `lib/**/*.test.ts` collected | `monthOutlook.test.ts` collected, 24 tests reported |
| T7 | vitest prints `Tests N passed (N)` with no skipped segment | `1` (acceptance #2) |
| T8 | unused `@ts-expect-error` is TS2578 | **verified by experiment**, §9 M-COV: making `coverage` optional produces `error TS2578` and `tsc` exit `2` |
| T9 | `npm test` / `lint` / `build` exist | all three run |
| T10 | the one pre-existing lint warning is `scripts/seed-demo.mjs` | still exactly one, now at line 457 (the file grew by the category block); still `'pid' is assigned a value but never used` |
| T11 | Postgres for the optional evidence item | **available** — the optional item was run, §11 |
| T12 | `npm run build` needs no database | `exit=0` with no `DATABASE_URL` set |
| T14 | `grep -cF` matches long test names as the verbose reporter emits them | **confirmed**: all 30 name-greps return `1` |

**T2 note — iCloud duplicates reappeared mid-task, and I left them alone.** The tree was clean when
I started (the orchestrator swept 36 at G0). After my `npm run build` runs, **11** reappeared:

```
.next/app-path-routes-manifest 2.json   .next/next-server.js.nft 2.json
.next/build-manifest 2.json             .next/prerender-manifest 2.json
.next/export-marker 2.json              .next/required-server-files 2.js
.next/fallback-build-manifest 2.json    .next/required-server-files 2.json
.next/images-manifest 2.json            .next/routes-manifest 2.json
.next/next-minimal-server.js.nft 2.json
```

**All 11 are untracked, gitignored (`.gitignore:17`), and inside `.next/`** — and critically they are
`.json` / `.js`, **not `.d.ts`**. The G0 failure was `.next/types/routes.d 2.ts` and
`.next/types/cache-life.d 2.ts`, which `tsconfig.json`'s `".next/types/**/*.ts"` include pulls into
the tsc program and which produced TS6200/TS2300. Nothing in this batch is in the program, and the
measurements confirm it: `npx tsc --noEmit` **exit=0**, `npm test` **399 passed (399)**,
`npm run lint` **1 problem (0 errors, 1 warning)**, scope commands #58/#59 both **`0`**, all taken
*after* these files appeared.

**I did not delete or edit them**, per the orchestrator's standing instruction, and I am reporting
them rather than working around them. They turn out to be transient: iCloud duplicates `.next/`
files shortly after a build writes them, and the *next* `npm run build` rewrites the directory and
clears them. The final sweep measured `find . -path ./node_modules -prune -o -name "* 2.*" -print |
wc -l` → **`0`**. The orchestrator should still expect them to come and go while re-running the
commands at G2, and should sweep if a `.d.ts` ever lands in a batch, since that is the shape that
breaks acceptance #1.

**T10 note, because #3 is pinned to an exact string:** the warning moved from line 438 to line 457
because the seed's category block grew. The command is `npm run lint 2>&1 | tail -2`, which reads
the summary line and not the line number, so the expectation is unaffected. The full line is in §3.

---

## 2. The 60 acceptance rows — verbatim output with exit codes

Every command below was run by me from the repo root against the delivered tree. `…` and `≈` are
expanded to the captured verbose output of the two suites, which were run once at the top of the
sweep and greped from; the two runs' full listings are in §5.

```
### 1
$ npx tsc --noEmit; echo "exit=$?"
exit=0
(exit=0)

### 2
$ npm test 2>&1 | grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"
1
(exit=0)

### 3
$ npm run lint 2>&1 | tail -2
✖ 1 problem (0 errors, 1 warning)

(exit=0)

### 4
$ npm run build > /tmp/p31-build.log 2>&1; echo "exit=$?"
exit=0
(exit=0)

### 5
$ test $(cat /private/tmp/claude-501/-Users-andreianpilogov-Documents-b8/94382def-37d2-44bd-a994-ae4700845d6b/scratchpad/mo.txt | grep -cE '✓ lib/domain/monthOutlook\.test\.ts') -ge 20 && echo OK
OK
(exit=0)

### 6
$ … | grep -cF "the roadmap's day-8-of-30 sentence becomes a hero state and a named list, so a category projecting to close at 266.25 percent of its month is the one saying no while the one projecting at 81.25 percent is holding"
1

### 7
$ … | grep -cF "an empty scored set renders nothing to score rather than on track, and the tracked-but-unscored categories still produce adherence findings beside it"
1

### 8
$ … | grep -cF "off-cycle spend outranks every other verdict, so a scheduled category drawing outside its window says off-cycle rather than breach"
1

### 9
$ … | grep -cF "a category already over its month budget says breach rather than projected breach, because a fact outranks a projection"
1

### 10
$ … | grep -cF "a month too young to project withholds the verdict instead of claiming the budget is being held"
1

### 11
$ … | grep -cF "a category with nothing budgeted this month is withheld rather than reported as a breach for spending against no budget"
1

### 12
$ … | grep -cF "a negative annual budget is withheld with its own reason rather than reported as a projected breach on an inverted percentage"
1

### 13
$ … | grep -cF "two categories both holding under their projections report on track, and one of them slipping over flips the state without touching the other"
1

### 14
$ … | grep -cF "every emitted money figure is the identical value the pacing module produced, never a re-rounded or re-derived copy of it"
1

### 15
$ … | grep -cF "the three as-of-month lists partition the scored categories exactly once each, so no category is counted twice or dropped"
1

### 16
$ … | grep -cF "only the as-of month reaches the verdict lists, so a finished month's percentage never sits in the same column as a mid-flight one"
1

### 17
$ … | grep -cF "off-cycle spend in an earlier elapsed month is reported separately rather than folded into this month's verdict"
1

### 18
$ … | grep -cF "a month index after the as-of month is rejected, because a full calendar year of months turns a 24 percent year-to-date underspend into a 75 percent one"
1

### 19
$ … | grep -cF "a one-indexed month index is rejected before either domain module is called, rather than one of them throwing while the other silently prices it"
1

### 20
$ … | grep -cF "the same category supplied twice is rejected rather than doubling the categories, the money and the counts"
1

### 21
$ … | grep -cF "a duplicated month within one category is rejected rather than counted twice"
1

### 22
$ … | grep -cF "a non-finite annual budget is rejected rather than reported as a dollar figure of NaN beside a benign-looking blank percentage"
1

### 23
$ … | grep -cF "a negative spend magnitude is rejected rather than projected downward by a multiplier that is always at least one"
1

### 24
$ … | grep -cF "a money field arriving as a string is rejected rather than concatenated into a plausible number"
1

### 24a
$ … | grep -cF "a scored category with no entry for the as-of month is rejected rather than silently reported as holding"
1

### 24b
$ … | grep -cF "a legal but negative annual budget does not throw, because the database permits it and a crashed dashboard is worse than a withheld row"
1

### 24c
$ … | grep -cF "the as-of point is the local calendar day of the clock read, so one minute past midnight and one minute to it map to the same day"
1

### 24d
$ … | grep -cF "the coverage the figures were computed over is carried through unchanged and is reported even when every category is holding"
1

### 24e
$ … | grep -cF "the headline and the findings are the sibling modules' own output, passed through rather than recomputed"
1

### 25
$ grep -cF '// @ts-expect-error monthOutlook requires the coverage it was computed over; it cannot be omitted' lib/domain/monthOutlook.test.ts
1
(exit=0)

### 26
$ grep -cE '\b(roundCents|Math\.round|Math\.abs|toFixed)\(' lib/domain/monthOutlook.ts
0
(exit=1)

### 27
$ grep -cE '/ *(12|MONTHS_PER_YEAR)' lib/domain/monthOutlook.ts
0
(exit=1)

### 28
$ grep -cE 'getUTC|toISOString' lib/domain/monthOutlook.ts
0
(exit=1)

### 28a
$ grep -oE 'now\.(getFullYear|getMonth|getDate)\(\)' lib/domain/monthOutlook.ts | wc -l | tr -d ' '
3
(exit=0)

### 28b
$ grep -cE 'new Date\(|Date\.now\(' lib/domain/monthOutlook.ts
0
(exit=1)

### 29
$ grep -cE 'catch *\(|try *\{' lib/domain/monthOutlook.ts
0
(exit=1)

### 29a
$ grep -cE '(= |return |: )Infinity\b' lib/domain/monthOutlook.ts
0
(exit=1)

### 29b
$ grep -cE 'Intl\.' lib/domain/monthOutlook.ts
0
(exit=1)

### 29c
$ grep -cE "^export function monthOutlook\(rows: AdherenceInput\[\], asOf: AsOf, coverage: CategorizationCoverage\): MonthOutlook \{" lib/domain/monthOutlook.ts
1
(exit=0)

### 29d
$ grep -cE "^import .*from './pacing';" lib/domain/monthOutlook.ts
1
(exit=0)

### 29e
$ grep -cE "^import .*from './adherence';" lib/domain/monthOutlook.ts
1
(exit=0)

### 30
$ grep -ciE 'netWorth|net_worth|Net Worth' app/dashboard/page.tsx
0
(exit=1)

### 30a
$ grep -cE 'Sparkline|NetWorthTrendChart|nwHistory|computeCurrentNetWorth' app/dashboard/page.tsx
0
(exit=1)

### 31
$ grep -oE 'new Date\(' app/dashboard/page.tsx | wc -l | tr -d ' '
1
(exit=0)

### 31a
$ grep -cE 'Date\.now\(' app/dashboard/page.tsx
0
(exit=1)

### 32
$ grep -cE 'monthsElapsed|expectedYearSpend|yearPacePct|pctYear|getMonth\(\) \+ 1' app/dashboard/page.tsx
0
(exit=1)

### 33
$ grep -cF 'EXTRACT(YEAR FROM CURRENT_DATE)' app/dashboard/page.tsx
0
(exit=1)

### 34
$ grep -cF 'EXTRACT(MONTH FROM t.date)::int - 1' app/dashboard/page.tsx
1
(exit=0)

### 34a
$ grep -cE '\bmonthPct\(' app/dashboard/page.tsx
0
(exit=1)

### 35
$ grep -cE 'detectAdherence\(|scoredHeadline\(|categoryPacing\(' app/dashboard/page.tsx
0
(exit=1)

### 35a
$ grep -cE "^import .*from '@/lib/domain/monthOutlook';" app/dashboard/page.tsx
1
(exit=0)

### 35b
$ test $(grep -c 'control_mode' app/dashboard/page.tsx) -ge 1 && echo OK
OK
(exit=0)

### 36
$ grep -o 'data-testid="[^"]*"' app/dashboard/page.tsx | head -1
data-testid="month-outlook-hero"
(exit=0)

### 36a
$ grep -c 'data-testid="month-outlook-hero"' app/dashboard/page.tsx
1
(exit=0)

### 36b
$ grep -c 'data-testid="categories-saying-no"' app/dashboard/page.tsx
1
(exit=0)

### 36c
$ grep -c 'data-testid="coverage-caveat"' app/dashboard/page.tsx
1
(exit=0)

### 37
$ test $(grep -c 'elapsedDays' app/dashboard/page.tsx) -ge 1 && test $(grep -c 'daysInMonth' app/dashboard/page.tsx) -ge 1 && echo OK
OK
(exit=0)

### 38
$ git diff --name-only HEAD -- docs/screenshots | wc -l | tr -d ' '
0
(exit=0)

### 39
$ test $(grep -cE "a\.landscape = 'operational'" app/dashboard/page.tsx) -ge 1 && echo OK
OK
(exit=0)

### 40
$ test $(npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cE '✓ lib/domain/adherence\.test\.ts') -eq 47 && echo OK
OK
(exit=0)

### 41
$ test $(npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 | grep -cE '✓ lib/domain/pacing\.test\.ts') -eq 24 && echo OK
OK
(exit=0)

### 42
$ git diff --stat HEAD -- lib/domain/adherence.ts lib/domain/pacing.ts lib/domain/adherence.test.ts lib/domain/pacing.test.ts | wc -l | tr -d ' '
0
(exit=0)

### 43
$ ≈ | grep -cF "the year-to-date delta is measured from the earliest snapshot that carries the deposit decomposition, never from an older row written under the previous definition"
1

### 43a
$ ≈ | grep -cF "a history with no post-cutover snapshot yields no delta at all rather than a delta of zero"
1

### 43b
$ ≈ | grep -cF "the delta is current minus baseline, so a net worth that grew reports a positive figure"
1

### 43c
$ ≈ | grep -cF "the number of pre-cutover snapshots skipped is reported, so the window the comparison used can be disclosed rather than assumed"
1

### 43d
$ ≈ | grep -cF "snapshots supplied out of order resolve to the same baseline as the sorted history"
1

### 43e
$ ≈ | grep -cF "the delta is rounded to cents once and never carries a minus sign on a figure that did not move"
1

### 44
$ test $(grep -cE '✓ lib/domain/netWorth\.test\.ts' /private/tmp/claude-501/-Users-andreianpilogov-Documents-b8/94382def-37d2-44bd-a994-ae4700845d6b/scratchpad/nw.txt) -ge 31 && echo OK
OK
(exit=0)

### 45
$ grep -cE '^export function comparableYtdDelta\(current: number, snapshots: SnapshotPoint\[\]\): YtdDelta \| null \{' lib/domain/netWorth.ts
1
(exit=0)

### 45a
$ grep -cE 'new Date\(|Date\.now\(' lib/domain/netWorth.ts
0
(exit=1)

### 46
$ git diff --name-only HEAD -- components/ | wc -l | tr -d ' '
0
(exit=0)

### 47
$ test $(grep -c 'control_mode' scripts/seed-demo.mjs) -ge 2 && echo OK
OK
(exit=0)

### 48
$ test $(grep -cE "^  \{ name: '" scripts/seed-demo.mjs) -eq $(grep -cE "^  \{ name: '.*mode: '" scripts/seed-demo.mjs) && echo OK
OK
(exit=0)

### 49
$ test $(grep -cE "^  \{ name: '" scripts/seed-demo.mjs) -eq $(grep -cE "mode: '(fixed|discretionary|variable-necessary)'" scripts/seed-demo.mjs) && echo OK
OK
(exit=0)

### 50
$ test $(grep -cE "mode: 'discretionary'" scripts/seed-demo.mjs) -ge 6 && echo OK
OK
(exit=0)

### 51
$ grep -cE "\?\? 'fixed'|\|\| 'fixed'" scripts/seed-demo.mjs
0
(exit=1)

### 51a
$ test $(grep -c 'monthly_amounts' scripts/seed-demo.mjs) -ge 2 && echo OK
OK
(exit=0)

### 52
$ grep -c 'comparableYtdDelta' app/net-worth/page.tsx
1
(exit=0)

### 53
$ test $(grep -c 'liabilities_security_deposits' app/net-worth/page.tsx) -ge 1 && echo OK
OK
(exit=0)

### 54
$ grep -cF 'snapshot_date::text' app/net-worth/page.tsx
1
(exit=0)

### 54a
$ grep -c 'toISOString' app/net-worth/page.tsx
0
(exit=1)

### 55
$ test $(grep -c 'excludedPreCutoverCount' app/net-worth/page.tsx) -ge 1 && echo OK
OK
(exit=0)

### 55a
$ grep -c 'data-testid="ytd-delta"' app/net-worth/page.tsx
1
(exit=0)

### 56
$ grep -c 'net worth composed from its four parts' README.md
0
(exit=1)

### 57
$ grep -ciE '\*\*Dashboard\*\* — .*month' README.md
1
(exit=0)

### 58
$ git diff --name-only HEAD | grep -vE '^(lib/domain/(monthOutlook|netWorth)(\.test)?\.ts|app/(dashboard|net-worth)/page\.tsx|scripts/seed-demo\.mjs|README\.md|AGENTS\.md|plan/)' | wc -l | tr -d ' '
0
(exit=0)

### 59
$ git status --porcelain | grep -vE '^.. (lib/domain/(monthOutlook|netWorth)(\.test)?\.ts|app/(dashboard|net-worth)/page\.tsx|components/[A-Za-z0-9]+\.tsx|scripts/seed-demo\.mjs|README\.md|AGENTS\.md|plan/)' | wc -l | tr -d ' '
0
(exit=0)

### 60
$ git status --porcelain lib/domain/monthOutlook.ts lib/domain/monthOutlook.test.ts | wc -l | tr -d ' '
2
(exit=0)
```

---

## 3. The lint line in full

The single warning, unchanged in kind from the baseline and the only one in the repo:

```
/Users/andreianpilogov/Documents/b8/app/scripts/seed-demo.mjs
  457:17  warning  'pid' is assigned a value but never used. Allowed unused elements of array destructuring must match /^_/u  @typescript-eslint/no-unused-vars

✖ 1 problem (0 errors, 1 warning)
```

**This is load-bearing beyond #3.** The G0 log records that #35 (`detectAdherence(` /
`scoredHeadline(` / `categoryPacing(` absent from the page) expects `0` both before and after, so it
witnesses no transition on its own — a page calling nothing would pass it. The pairing that proves
`monthOutlook` is actually *wired in* is **#35a** (the import exists → `1`) **plus #3** (lint pinned
at exactly one warning, so an unused import would show as a second). Both hold. I introduced no new
lint warning anywhere.

---

## 4. Before/after counts, reproduced from `39c939c`

| # | What | Before (orchestrator, re-measured at G0) | After (measured by me) |
|---|---|---|---|
| 30 | `netWorth\|net_worth\|Net Worth` in `app/dashboard/page.tsx`, case-insensitive | **26** | **0** |
| 30a | `Sparkline\|NetWorthTrendChart\|nwHistory\|computeCurrentNetWorth` | — | **0** |
| 31 | `new Date(` on the page | **7** | **1** |
| 31a | `Date.now(` on the page | — | **0** |
| 32 | `monthsElapsed\|expectedYearSpend\|yearPacePct\|pctYear\|getMonth() + 1` | **14** | **0** |
| 33 | `EXTRACT(YEAR FROM CURRENT_DATE)` | **5** | **0** |
| 34 | `EXTRACT(MONTH FROM t.date)::int - 1` | **0** | **1** |
| 35b | `control_mode` on the page | **0** | **4** (≥1 required) |
| 47 | `control_mode` in `scripts/seed-demo.mjs` | **0** | **3** (≥2 required) |
| 56 | the stale README caption | **1** | **0** |
| 40 / 41 / 42 | adherence 47 / pacing 24 / four-file diff 0 | 47 / 24 / 0 | **47 / 24 / 0** |
| — | `lib/domain/monthOutlook.ts` exists | absent | present (#60 → `2`) |

The two rows that carry the *ideology* change are #30 (`26 → 0`) and #34 (`0 → 1`): net worth left
the page entirely, and a month-scoped budget query took its place.

---

## 5. Full verbose listings

### `lib/domain/monthOutlook.test.ts`

```
RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app

 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > the roadmap's day-8-of-30 sentence becomes a hero state and a named list, so a category projecting to close at 266.25 percent of its month is the one saying no while the one projecting at 81.25 percent is holding 3ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > an empty scored set renders nothing to score rather than on track, and the tracked-but-unscored categories still produce adherence findings beside it 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > off-cycle spend outranks every other verdict, so a scheduled category drawing outside its window says off-cycle rather than breach 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > a category already over its month budget says breach rather than projected breach, because a fact outranks a projection 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > a month too young to project withholds the verdict instead of claiming the budget is being held 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > a category with nothing budgeted this month is withheld rather than reported as a breach for spending against no budget 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > a negative annual budget is withheld with its own reason rather than reported as a projected breach on an inverted percentage 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > two categories both holding under their projections report on track, and one of them slipping over flips the state without touching the other 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > every emitted money figure is the identical value the pacing module produced, never a re-rounded or re-derived copy of it 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > the three as-of-month lists partition the scored categories exactly once each, so no category is counted twice or dropped 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > only the as-of month reaches the verdict lists, so a finished month's percentage never sits in the same column as a mid-flight one 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > off-cycle spend in an earlier elapsed month is reported separately rather than folded into this month's verdict 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > a month index after the as-of month is rejected, because a full calendar year of months turns a 24 percent year-to-date underspend into a 75 percent one 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > a one-indexed month index is rejected before either domain module is called, rather than one of them throwing while the other silently prices it 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > the same category supplied twice is rejected rather than doubling the categories, the money and the counts 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > a duplicated month within one category is rejected rather than counted twice 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > a non-finite annual budget is rejected rather than reported as a dollar figure of NaN beside a benign-looking blank percentage 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > a negative spend magnitude is rejected rather than projected downward by a multiplier that is always at least one 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > a money field arriving as a string is rejected rather than concatenated into a plausible number 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > a scored category with no entry for the as-of month is rejected rather than silently reported as holding 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > a legal but negative annual budget does not throw, because the database permits it and a crashed dashboard is worse than a withheld row 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > the as-of point is the local calendar day of the clock read, so one minute past midnight and one minute to it map to the same day 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > the coverage the figures were computed over is carried through unchanged and is reported even when every category is holding 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook > the headline and the findings are the sibling modules' own output, passed through rather than recomputed 0ms

 Test Files  1 passed (1)
      Tests  24 passed (24)
   Start at  20:25:37
   Duration  120ms (transform 39ms, setup 0ms, import 51ms, tests 8ms, environment 0ms)
```

### `lib/domain/netWorth.test.ts`

```
RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app

 ✓ lib/domain/netWorth.test.ts > computeNetWorthBreakdown > sums ledger accounts into their landscape, sign intact 1ms
 ✓ lib/domain/netWorth.test.ts > computeNetWorthBreakdown > puts valuation-mode assets in capitalFinancial 0ms
 ✓ lib/domain/netWorth.test.ts > computeNetWorthBreakdown > counts a property-linked mortgage ONLY inside equity, never twice 0ms
 ✓ lib/domain/netWorth.test.ts > computeNetWorthBreakdown > counts an UNLINKED valuation liability in liabilities 0ms
 ✓ lib/domain/netWorth.test.ts > computeNetWorthBreakdown > drops an unvalued property together with its mortgage, and reports it 0ms
 ✓ lib/domain/netWorth.test.ts > computeNetWorthBreakdown > still values the other properties when one is unvalued 0ms
 ✓ lib/domain/netWorth.test.ts > computeNetWorthBreakdown > components always sum exactly to total 0ms
 ✓ lib/domain/netWorth.test.ts > computeNetWorthBreakdown > is zero across the board with no accounts and no properties 0ms
 ✓ lib/domain/netWorth.test.ts > computeNetWorthBreakdown > treats a missing balance as 0 rather than throwing 0ms
 ✓ lib/domain/netWorth.test.ts > contributions > emits one signed line per account, matching its component total 0ms
 ✓ lib/domain/netWorth.test.ts > contributions > records a linked mortgage as a NEGATIVE real-estate line, not a liability line 0ms
 ✓ lib/domain/netWorth.test.ts > contributions > omits an excluded property and its mortgage from contributions entirely 0ms
 ✓ lib/domain/netWorth.test.ts > contributions > contributions sum to the total, per component and overall 0ms
 ✓ lib/domain/netWorth.test.ts > groupRealEstateEquity > merges a property line and its mortgage line into one net-equity line 0ms
 ✓ lib/domain/netWorth.test.ts > groupRealEstateEquity > leaves a mortgage-free property as its own single line, value unchanged 0ms
 ✓ lib/domain/netWorth.test.ts > groupRealEstateEquity > groups a realistic multi-property portfolio independently, one mortgaged and one not 0ms
 ✓ lib/domain/netWorth.test.ts > groupRealEstateEquity > ignores contributions from other components entirely 0ms
 ✓ lib/domain/netWorth.test.ts > groupRealEstateEquity > sums to the same realEstateEquity total the breakdown itself reports 0ms
 ✓ lib/domain/netWorth.test.ts > groupRealEstateEquity > returns empty for no real-estate activity at all 0ms
 ✓ lib/domain/netWorth.test.ts > tenant-held funds > reduces liabilities and total by a recorded security deposit, leaving the other three components unchanged 0ms
 ✓ lib/domain/netWorth.test.ts > tenant-held funds > does not change any component or the total for a recorded last-month-rent-held amount 0ms
 ✓ lib/domain/netWorth.test.ts > tenant-held funds > still sums components to total exactly with a security deposit and a last-month holding both present 0ms
 ✓ lib/domain/netWorth.test.ts > tenant-held funds > only the property carrying a security deposit contributes to liabilities, not a property with none 0ms
 ✓ lib/domain/netWorth.test.ts > tenant-held funds > sums liabilities contributions to the liabilities total when a security deposit is present 0ms
 ✓ lib/domain/netWorth.test.ts > tenant-held funds > still subtracts a security deposit from liabilities when its property has no recorded valuation, unlike its linked mortgage which is dropped together with the unvalued property 0ms
 ✓ lib/domain/netWorth.test.ts > comparableYtdDelta > the year-to-date delta is measured from the earliest snapshot that carries the deposit decomposition, never from an older row written under the previous definition 0ms
 ✓ lib/domain/netWorth.test.ts > comparableYtdDelta > a history with no post-cutover snapshot yields no delta at all rather than a delta of zero 0ms
 ✓ lib/domain/netWorth.test.ts > comparableYtdDelta > the delta is current minus baseline, so a net worth that grew reports a positive figure 0ms
 ✓ lib/domain/netWorth.test.ts > comparableYtdDelta > the number of pre-cutover snapshots skipped is reported, so the window the comparison used can be disclosed rather than assumed 0ms
 ✓ lib/domain/netWorth.test.ts > comparableYtdDelta > snapshots supplied out of order resolve to the same baseline as the sorted history 0ms
 ✓ lib/domain/netWorth.test.ts > comparableYtdDelta > the delta is rounded to cents once and never carries a minus sign on a figure that did not move 0ms

 Test Files  1 passed (1)
      Tests  31 passed (31)
   Start at  20:25:38
   Duration  105ms (transform 31ms, setup 0ms, import 40ms, tests 5ms, environment 0ms)
```

---

## 6. The state ladder as a truth table — spec's expected values against measured

`AS_OF = { year: 2026, month: 3, day: 8 }` (April 8, 2026; April has 30 days; elapsed fraction
`8/30 = 0.26666666666666666`; multiplier `3.75`). `COVERAGE = { uncategorizedCount: 17,
categorizedCount: 183 }`. Every "measured" column is what the delivered module returned; each is
an assertion in the suite above, so a divergence would be a red test rather than a note here.

| Fixture | Input (scored, as-of month) | `(status, budgeted, actual, projected, projectedVariance)` | Expected `state` / list | Measured |
|---|---|---|---|---|
| **H1** | Dining Out 6000/yr, Apr 355 · Groceries 14400/yr, Apr 260 | `(projected, 500, 355, 1331.25, 831.25)` · `(projected, 1200, 260, 975, -225)` | `projected-breach`; sayingNo 1 / holding 1 / withheld 0 | **matches** |
| **H2** | three `fixed` rows (2000/2000, 450/620, 600/600) | none scored | `nothing-to-score`; all lists `[]`; `headline` null; `findings.length` **1** | **matches** |
| **H3** | March-only schedule; Mar 1150, Apr 275 | Apr `(off-cycle, 0, 275, null, null)`; Mar `(complete, 1200, 1150, 1150, -50)` | `off-cycle`; sayingNo 1, all four ratio fields `null`; the March record in **no** list | **matches** |
| **H4** | 6000/yr, Apr 620 | `(projected, 500, 620, 2325, 1825)`, `projectedRatio 4.65`, `spentRatio 1.24` | `breach`, reason `breach` **not** `projected-breach` | **matches** |
| **H5** | `AS_OF7` day 7 (`7/30 = 0.2333 < 0.25`), 6000/yr, Apr 30 | `(too-early, 500, 30, null, null)`, `spentRatio 0.06` | `too-early`; withheld 1 / `too-early`; nothing equals `128.57` or `900` | **matches** |
| **H6** | `annual_budget: 0`, no schedule, Apr 275 | `(no-budget, 0, 275, null, null)` | `no-budget-basis` **not** `breach`; withheld `no-budget` | **matches** |
| **H7a** | two rows sharing `id: 1` | — | `RangeError` | **throws** |
| **H7b** | `months: [{3,355},{3,20}]` | — | `RangeError` | **throws** |
| **H7c** | `annual_budget: NaN`; `Infinity`; schedule with `NaN` | — | each `RangeError` | **all three throw** |
| **H7d** | `Apr -100` | un-validated answer would be `projected: -375` | `RangeError` | **throws** |
| **H7e** | `annual_budget: '6000'`; `actual: '355'` | — | each `RangeError` | **both throw** |
| **H7f** | `annual_budget: -1200`, Apr 50 | `(projected, -100, 50, 187.5, +287.5)` | **does NOT throw**; `no-budget-basis`; withheld `negative-budget`; `spentRatio`/`projectedRatio` `null`, not `-0.5` / `-1.875` | **matches** |
| **H7g** | scored row with `months: []` beside a valid row | — | `RangeError` | **throws** (and a *tracked-but-unscored* row with `months: []` correctly does **not**) |
| **H8** | March-only row with `month: 12` | `detectAdherence` → `(100, 1150, +1050, ratio 11.5)`; `categoryPacing` → throws | `monthOutlook` `RangeError`, and both sibling behaviours pinned | **matches** — both halves asserted |
| **H9** | March-only schedule, Feb 250 / Mar 1150 / Apr 0; plus 6000/yr Apr **100** (see §12) | Feb `(off-cycle, 0, 250, null, null)`; Apr row 1 `(no-budget, 0, 0, …)`; row 2 `(projected, 500, 100, 375, -125)` | `offCycleElsewhere` 1, month **1**, status `off-cycle` **not** `complete`/`future`; `state` `on-track` **not** `off-cycle`; withheld `no-budget` | **matches** |
| **H10** | H1's rows **plus** a rounding-sensitive third row (Apr 355.55 → `projected 1333.31`, raw `1333.3125`) | identity against `categoryPacing`'s record | all nine fields `Object.is`-identical; `projectedRatio` not `2.66`, not `1.6625`; the sensitive row not `1333.3125` / `2.666625` | **matches** |
| **H11** | `asOfFromDate` at 00:01, 23:59, New Year both ends | — | `{2026,3,8}` twice; `{2026,0,1}`; `{2026,11,31}`; not a 1-based month | **matches** |
| **H12** | all twelve months of 2026, actuals `[355,420,390,355,0,…]` | headline over 12 → `(6000, 1520, -4480, -0.7466666666666667)`; over 4 → `(2000, 1520, -480, -0.24)` | `RangeError`; both ratios pinned and distinct; months `0..3` do **not** throw and give `projected-breach`, `holding 0` | **matches** |
| **H13** | 6 scored + 1 `fixed` + 1 capital + 1 income, each with an April entry | ids 1 breach · 2 projected-breach · 3 off-cycle · 4 holding · 5 no-budget · 6 negative-budget | `scoredCategoryCount` **6** (not 9, not 7); lengths sum to 6; ids `[1..6]` exactly once; `sayingNo` ids `[3,1,2]`; `state` `off-cycle` | **matches** |
| **H14** | 14400/yr Apr 260 · 12000/yr Apr 200 | `(projected,1200,260,975,-225)` · `(projected,1000,200,750,-250)` | `on-track`; holding 2 ordered `[2,1]` (−250 before −225); coverage 17 / 183 present; then row 1 → 355 flips to `projected-breach`, sayingNo 1 with `+131.25`, holding 1 untouched | **matches** |

### `comparableYtdDelta` fixtures

| Fixture | Input | Expected | Measured |
|---|---|---|---|
| **N-A** | `current 2930000.11`; snapshots `2026-01-02/2900000.00/null`, `2026-02-01/2915000.00/null`, `2026-03-01/2880000.33/-18400`, `2026-04-01/2905000.00/-18400` | `delta 49999.78`, `sinceDate '2026-03-01'`, `comparableSnapshotCount 2`, `excludedPreCutoverCount 2`; not `30000.11`, not `25000.11`, not `-49999.78`, not `49999.779999999795` | **matches, all four negative controls** |
| **N-B** | same `current`, only the two `null` rows; and `[]` | `null`, **not** `0`, not `undefined` | **matches** |
| **N-C** | N-A's four snapshots shuffled | byte-identical `YtdDelta`; `sinceDate '2026-03-01'` | **matches** |
| **N-D** | `current 2880000.33` against N-A's snapshots | `delta 0`, `Object.is(delta, -0) === false`, `sinceDate '2026-03-01'`; plus the residue pin `Object.is(roundCents(-0.001), -0) === true` | **matches** — **and see §9 M28**: the spec's N-D input reaches positive zero, not negative zero, so I added `current 2880000.3299` (which does reach `-0`) to make the normalisation load-bearing |

---

## 7. A rendered `MonthOutlook` for Fixture H1, and the sentence it licenses

Produced by calling the delivered `monthOutlook` on H1's rows and serialising the result:

```json
{
  "asOf": {
    "year": 2026,
    "month": 3,
    "day": 8
  },
  "state": "projected-breach",
  "scoredCategoryCount": 2,
  "sayingNo": [
    {
      "categoryId": 1,
      "category": "Dining Out",
      "controlMode": "discretionary",
      "status": "projected",
      "month": 3,
      "elapsedDays": 8,
      "daysInMonth": 30,
      "budgeted": 500,
      "actual": 355,
      "spentRatio": 0.71,
      "projected": 1331.25,
      "projectedVariance": 831.25,
      "projectedRatio": 2.6625,
      "reason": "projected-breach",
      "withheldReason": null
    }
  ],
  "holding": [
    {
      "categoryId": 2,
      "category": "Groceries",
      "controlMode": "discretionary",
      "status": "projected",
      "month": 3,
      "elapsedDays": 8,
      "daysInMonth": 30,
      "budgeted": 1200,
      "actual": 260,
      "spentRatio": 0.21666666666666667,
      "projected": 975,
      "projectedVariance": -225,
      "projectedRatio": 0.8125,
      "reason": null,
      "withheldReason": null
    }
  ],
  "withheld": [],
  "offCycleElsewhere": [],
  "headline": {
    "scoredCategoryCount": 2,
    "breachCount": 0,
    "defectCount": 0,
    "budgeted": 1700,
    "actual": 615,
    "variance": -1085,
    "varianceRatio": -0.638235294117647
  },
  "findings": [],
  "coverage": {
    "uncategorizedCount": 17,
    "categorizedCount": 183
  }
}
```

The English sentence §5 asks for:

> **As of day 8 of 30 — Dining Out is at 71% of its month and projects to close at $1,331.25,
> $831.25 over. Groceries is holding. Computed over 183 categorized transactions this month;
> 17 are still uncategorized.**

Every token of it is a field of the JSON above, with **no arithmetic beyond formatting**:

| Phrase | Field | Formatting applied |
|---|---|---|
| "day 8 of 30" | `sayingNo[0].elapsedDays` / `.daysInMonth` | none |
| "Dining Out" | `sayingNo[0].category` | none |
| "71% of its month" | `sayingNo[0].spentRatio` = `0.71` | ×100, rounded for display |
| "$1,331.25" | `sayingNo[0].projected` | currency format |
| "$831.25 over" | `sayingNo[0].projectedVariance` = `831.25` | currency format; "over" is read off the **sign**, not re-derived |
| "Groceries is holding" | `holding[0].category`, and its membership in `holding` | none |
| "183 categorized … 17 still uncategorized" | `coverage.categorizedCount` / `.uncategorizedCount` | none |

The one thing a renderer must **not** do is convert `projectedRatio 2.6625` into "166% over" by
subtracting one and calling it the module's number. The delivered page prints
`{pct(projectedRatio)} of budget` — "266% of budget" — and owns the wording.

---

## 8. The two defects this diff removes, as numbers

### 8a. The annual pace defect (spec Q4, G0 adjudication A2)

`app/dashboard/page.tsx:356` computed `monthsElapsed = new Date().getMonth() + 1`, which treats the
*current* month as fully elapsed. On **1 April 2026**, against the demo dataset's own budget of
**$178,800** (categories not excluded, not income):

| | Incumbent | Day-granular truth | Gap |
|---|---|---|---|
| elapsed | `monthsElapsed = 4` → `pctYear = 33%` | day 91 of 365 → **24.9%** | 8.4 percentage points |
| expected year spend | `(178800 / 12) × 4` = **$59,600.00** | `178800 × 91/365` = **$44,577.53** | **$15,022.47** |

The error direction is what makes it worse than a rounding slip: expected spend is **overstated**,
so `yearPacePct = spent / expectedYearSpend` comes out **too low** and the bar renders greener than
the truth. It **flatters** the pace. It also sat eleven lines above `expectedWeekSpend`, which was
day-granular — two conventions in one component.

The whole family is **deleted, not relocated** (A2). `grep -cE
'monthsElapsed|expectedYearSpend|yearPacePct|pctYear|getMonth\(\) \+ 1'` → `0`. The per-category
month replaces it, and no surviving figure on the page uses a month-granular elapsed share.

### 8b. The YTD delta straddling the P0-09a definition change (NITS N2)

On Fixture N-A's history:

| | Figure | Sentence rendered |
|---|---|---|
| Incumbent (`nwHistory[0]`, whatever era) | **$30,000.11** | "+$30,000 since Jan 2" |
| Corrected (`comparableYtdDelta`) | **$49,999.78** | "+$49,999.78 since 2026-03-01 · 2 earlier readings predate the deposit decomposition and are not comparable" |

**Gap: $19,999.67** — very close to the deposits held, which is exactly the point: the pre-cutover
baseline was measured under a definition that did not subtract them, so comparing across the
boundary understates growth by the deposit balance and renders perfectly while doing it.

The disclosure of the two skipped rows is rendered, not merely computed (`excludedPreCutoverCount`
appears in `app/net-worth/page.tsx`, acceptance #55).

---

## 9. Mutation testing — every load-bearing guard removed, one at a time

Method: for each guard, patch `lib/domain/monthOutlook.ts` (or `netWorth.ts`), run the owning suite
with `--reporter=verbose`, record which named tests go red, restore the file byte-for-byte. The
harness restores from a pristine copy after every mutation; `git status` and `npx tsc --noEmit` were
re-verified clean afterwards.

**32 mutations applied. 31 killed. 1 survived, and it is an equivalent mutant — reasoning below.**

Two mutations survived on the first pass and were **real gate gaps**. I did not leave them; both are
recorded here with the fixture change that closed them, because the disclosure is the point.

| # | Guard removed | Result | Tests that went red |
|---|---|---|---|
| **M1** | ladder rung 1 — `nothing-to-score` is no longer its own state | **KILLED** | "an empty scored set renders nothing to score rather than on track…" — the state became `no-budget-basis`, since `every` is vacuously true over an empty set. This is precisely why the rung exists. |
| **M2** | ladder adjacent pair **off-cycle / breach** swapped | **KILLED** | "the three as-of-month lists partition…" (H13) |
| **M3** | ladder adjacent pair **breach / projected-breach** swapped | **KILLED** (after fix) | "a category already over its month budget says breach rather than projected breach…" |
| **M3b** | **classifier-level** breach / projected-breach precedence swapped | **KILLED** | the same test, plus H13's reason ordering |
| **M4** | ladder rung **too-early** removed | **KILLED** | "a month too young to project withholds the verdict…" |
| **M5** | ladder rung **no-budget-basis** removed | **KILLED** (3 red) | H6, H7f and the negative-budget test |
| **M6** | **`budgeted > 0` dropped from the breach condition** | **KILLED** (4 red) | H6 ($275 against $0 became a `breach`), H7f, H13, the negative-budget test. *This is the spec's "single most likely thing to get wrong", and it is the most heavily gated line in the module.* |
| **M7** | `budgeted > 0` dropped from the **projected-breach** condition | **KILLED** (3 red) | H7f, H13, the negative-budget test |
| **M8** | off-cycle rung dropped from the classifier | **KILLED** (2 red) | H3, H13 |
| **M9** | too-early rung dropped from the classifier | **KILLED** | H5 |
| **M10** | `negative-budget` collapsed into `no-budget` | **KILLED** (3 red) | H7f, H13, the negative-budget test |
| **M11** | as-of-month scoping removed (N32) | **KILLED** (4 red) | H3, the N32 test, H9, H12 |
| **M12** | scored-only gate removed | **KILLED** (2 red) | H2, H13 |
| **M13** | duplicate-category guard (N26) | **KILLED** | "the same category supplied twice is rejected…" |
| **M14** | duplicate-month guard (N18) | **KILLED** | "a duplicated month within one category is rejected…" |
| **M15** | month-range guard (N15/N31/N33) | **KILLED** | H12 |
| **M16** | finite / `typeof number` money guard (N29/N20) | **KILLED** (2 red) | the `NaN`/`Infinity` test and the string test |
| **M17** | negative-spend guard (N35) | **KILLED** | "a negative spend magnitude is rejected…" |
| **M18** | missing as-of-month-entry guard | **KILLED** | "a scored category with no entry for the as-of month is rejected…" |
| **M19** | `projectedRatio` re-derived as `pace.projected / pace.budgeted` | **SURVIVED — see below** | — |
| **M19b** | `projectedRatio` re-derived from `actual` and the elapsed fraction (skipping the cent rounding) | **KILLED** (after fix) | "every emitted money figure is the identical value the pacing module produced…" |
| **M19c** | `projected` re-derived the same way | **KILLED** (after fix) | the same test |
| **M20** | `asOfFromDate` emits a 1-based month | **KILLED** | "the as-of point is the local calendar day…" |
| **M21** | `sayingNo` reason-precedence ordering removed | **KILLED** | H13 |
| **M22** | `holding` ordering flipped to descending | **KILLED** | H14 |
| **M23** | `coverage` rebuilt as a fresh object instead of carried by reference | **KILLED** (2 red) | H1 and H14 both assert `toBe(COVERAGE)`, i.e. reference identity |
| **M-COV** | **`coverage` made an optional parameter** | **KILLED, by the compiler** | `npx tsc --noEmit` → `lib/domain/monthOutlook.test.ts(…): error TS2578: Unused '@ts-expect-error' directive.`, **exit=2**. Acceptance #1 fails, exactly as #25 is designed to make it. |
| **M24** | delta baseline picks the earliest snapshot regardless of era — **N2 itself** | **KILLED** (5 red) | four of the six delta tests plus the null test |
| **M25** | delta subtraction reversed | **KILLED** (2 red) | N-A and "current minus baseline" |
| **M26** | no comparable snapshot returns `0` instead of `null` | **KILLED** | "a history with no post-cutover snapshot yields no delta at all…" |
| **M27** | cent rounding removed from the delta | **KILLED** (2 red) | N-A and N-D |
| **M28** | negative-zero normalisation removed from the delta | **KILLED** (after fix) | N-D |
| **M29** | snapshots consumed in array order rather than sorted by ISO date | **KILLED** | N-C |

### The two gaps I found and closed

**M3 — the ladder's breach / projected-breach adjacency was ungated.** Swapping those two rungs
changed nothing, because the *per-record classifier* already assigns `breach` before
`projected-breach`, so no single record is ever classified as both, and the spec's own H4 fixture
has only one record. The only input that can discriminate the ladder's own order is **one category
already over beside a different category merely projecting over** — and no fixture had that shape.
I added it to the H4 test:

```ts
const both = monthOutlook([cat({ id: 1, months: april(620) }), cat({ id: 2, months: april(355) })], AS_OF, COVERAGE);
expect(both.state).toBe('breach');
expect(both.sayingNo.map((c) => c.reason)).toEqual(['breach', 'projected-breach']);
```

M3 and M3b are both killed after that. **Acceptance #9 passed before this change and would have
passed with the ladder mis-ordered** — the command name is right, the fixture was one row short.

**M28 — the negative-zero normalisation on the delta was ungated, and so were M19b/M19c.** Two
separate instances of the same shape: the spec's chosen fixture values happen to make the guard a
no-op.

- *N-D as the spec writes it* uses `current = 2880000.33` against a baseline of `2880000.33`. The
  difference is **positive** zero, so `withoutNegativeZero` never fires and removing it passes. The
  spec's own text says the assertion should sit "on a path that reaches it" — it does not. I added
  `comparableYtdDelta(2880000.3299, HISTORY)`: the difference is `-0.0001000002957880497`,
  `Math.round(-0.01)` is `-0`, and the delta reaches negative zero. M28 is killed.
- *H10 as the spec writes it* uses `355` and `260`, both of which project to figures where cent
  rounding is a **no-op** (`355 × 3.75 = 1331.25` exactly). So `Object.is` could not distinguish a
  copy from a re-derivation on those rows, and M19b/M19c survived. I added a third row at
  `actual: 355.55`, which projects to `1333.3125` raw and `1333.31` rounded — two different doubles.
  Both mutants are killed. The spec anticipated this ("would land on a value differing at the 15th
  decimal **or not at all**"); the fixture just needed a row where it does.

### The one survivor, and why it is not a gap

**M19: `projectedRatio: pace.projected !== null && pace.budgeted > 0 ? pace.projected / pace.budgeted : null`.**

This survives every fixture, including the rounding-sensitive one, and **it always will**, because
it is not an approximation of what `pacing.ts` does — it is *the identical expression over the
identical operands*. `pacing.ts` computes `projectedRatio` as `projected / budgeted` from the
already-rounded `projected` and the same `budgeted`; this mutant recomputes exactly that from the
same two fields of the same record. Every IEEE-754 bit is the same for every input. No value
assertion can separate them, and `Object.is` is already the strictest available comparison.

So this is an **equivalent mutant**, not an untested guard: the code is unobservable-by-construction
rather than unobserved-by-accident. I am reporting it rather than filing it away because the
distinction is exactly the one a reviewer should check me on — and because it marks a real limit of
acceptance #14: **the identity gate catches re-derivations that diverge, not re-derivations that
happen to agree.** The remaining protection against the second kind is the static one, #26/#27,
which forbid the arithmetic idioms, plus the reviewer reading the module.

### Raw mutation output

```
======================================================================
M1 — ladder rung 1 removed — `nothing-to-score` is no longer its own state
   Tests  1 failed | 23 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > an empty scored set renders nothing to score rather than on track, and the tracked-but-unscored cat
======================================================================
M2 — ladder adjacent pair off-cycle / breach swapped (breach outranks off-cycle)
   Tests  1 failed | 23 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > the three as-of-month lists partition the scored categories exactly once each, so no category is co
======================================================================
M3 — ladder adjacent pair breach / projected-breach swapped (a projection outranks a fact)
   Tests  1 failed | 23 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > a category already over its month budget says breach rather than projected breach, because a fact o
======================================================================
M4 — ladder rung too-early removed (a young month falls through to on-track)
   Tests  1 failed | 23 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > a month too young to project withholds the verdict instead of claiming the budget is being held 4ms
======================================================================
M5 — ladder rung no-budget-basis removed (falls through to on-track)
   Tests  3 failed | 21 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > a category with nothing budgeted this month is withheld rather than reported as a breach for spendi
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > a negative annual budget is withheld with its own reason rather than reported as a projected breach
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > a legal but negative annual budget does not throw, because the database permits it and a crashed da
======================================================================
M3b — CLASSIFIER-level breach / projected-breach precedence swapped
   Tests  2 failed | 22 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > a category already over its month budget says breach rather than projected breach, because a fact o
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > the three as-of-month lists partition the scored categories exactly once each, so no category is co
======================================================================
M6 — `budgeted > 0` dropped from the BREACH condition — $275 against $0 becomes a breach
   Tests  4 failed | 20 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > a category with nothing budgeted this month is withheld rather than reported as a breach for spendi
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > a negative annual budget is withheld with its own reason rather than reported as a projected breach
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > the three as-of-month lists partition the scored categories exactly once each, so no category is co
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > a legal but negative annual budget does not throw, because the database permits it and a crashed da
======================================================================
M7 — `budgeted > 0` dropped from the PROJECTED-BREACH condition
   Tests  3 failed | 21 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > a negative annual budget is withheld with its own reason rather than reported as a projected breach
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > the three as-of-month lists partition the scored categories exactly once each, so no category is co
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > a legal but negative annual budget does not throw, because the database permits it and a crashed da
======================================================================
M8 — off-cycle rung dropped from the classifier (collapses into ordinary breach)
   Tests  2 failed | 22 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > off-cycle spend outranks every other verdict, so a scheduled category drawing outside its window sa
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > the three as-of-month lists partition the scored categories exactly once each, so no category is co
======================================================================
M9 — too-early rung dropped from the classifier (a young month reads as holding)
   Tests  1 failed | 23 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > a month too young to project withholds the verdict instead of claiming the budget is being held 4ms
======================================================================
M10 — negative-budget collapsed into no-budget
   Tests  3 failed | 21 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > a negative annual budget is withheld with its own reason rather than reported as a projected breach
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > the three as-of-month lists partition the scored categories exactly once each, so no category is co
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > a legal but negative annual budget does not throw, because the database permits it and a crashed da
======================================================================
M11 — as-of-month scoping removed — every elapsed month reaches the verdict lists (N32)
   Tests  4 failed | 20 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > off-cycle spend outranks every other verdict, so a scheduled category drawing outside its window sa
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > only the as-of month reaches the verdict lists, so a finished month's percentage never sits in the 
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > off-cycle spend in an earlier elapsed month is reported separately rather than folded into this mon
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > a month index after the as-of month is rejected, because a full calendar year of months turns a 24 
======================================================================
M12 — scored-only gate removed — tracked-but-unscored rows enter the lists
   Tests  2 failed | 22 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > an empty scored set renders nothing to score rather than on track, and the tracked-but-unscored cat
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > the three as-of-month lists partition the scored categories exactly once each, so no category is co
======================================================================
M13 — duplicate-category guard removed (N26)
   Tests  1 failed | 23 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > the same category supplied twice is rejected rather than doubling the categories, the money and the
======================================================================
M14 — duplicate-month guard removed (N18)
   Tests  1 failed | 23 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > a duplicated month within one category is rejected rather than counted twice 3ms
======================================================================
M15 — month-range guard removed (N15/N31/N33)
   Tests  1 failed | 23 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > a month index after the as-of month is rejected, because a full calendar year of months turns a 24 
======================================================================
M16 — finite / typeof-number money guard defanged (N29 / N20)
   Tests  2 failed | 22 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > a non-finite annual budget is rejected rather than reported as a dollar figure of NaN beside a beni
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > a money field arriving as a string is rejected rather than concatenated into a plausible number 0ms
======================================================================
M17 — negative-spend guard removed (N35)
   Tests  1 failed | 23 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > a negative spend magnitude is rejected rather than projected downward by a multiplier that is alway
======================================================================
M18 — missing as-of-month-entry guard removed
   Tests  1 failed | 23 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > a scored category with no entry for the as-of month is rejected rather than silently reported as ho
======================================================================
M19 — projectedRatio re-derived ALGEBRAICALLY IDENTICALLY (projected / budgeted)
   Tests  24 passed (24)
    *** SURVIVED — NO TEST WENT RED ***
======================================================================
M19b — projectedRatio re-derived from actual and the elapsed fraction, skipping the cent rounding
   Tests  1 failed | 23 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > every emitted money figure is the identical value the pacing module produced, never a re-rounded or
======================================================================
M19c — projected re-derived from actual and the elapsed fraction, skipping the cent rounding
   Tests  1 failed | 23 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > every emitted money figure is the identical value the pacing module produced, never a re-rounded or
======================================================================
M20 — asOfFromDate emits a 1-based month
   Tests  1 failed | 23 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > the as-of point is the local calendar day of the clock read, so one minute past midnight and one mi
======================================================================
M21 — sayingNo reason-precedence ordering removed
   Tests  1 failed | 23 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > the three as-of-month lists partition the scored categories exactly once each, so no category is co
======================================================================
M22 — holding ordering flipped to descending projected variance
   Tests  1 failed | 23 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > two categories both holding under their projections report on track, and one of them slipping over 
======================================================================
M23 — coverage rebuilt as a fresh object instead of carried by reference
   Tests  2 failed | 22 passed (24)
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > the roadmap's day-8-of-30 sentence becomes a hero state and a named list, so a category projecting 
    RED: × lib/domain/monthOutlook.test.ts > monthOutlook > the coverage the figures were computed over is carried through unchanged and is reported even when 
======================================================================
M24 — baseline picks the earliest snapshot regardless of era (N2 itself)
   Tests  5 failed | 26 passed (31)
    RED: × lib/domain/netWorth.test.ts > comparableYtdDelta > the year-to-date delta is measured from the earliest snapshot that carries the deposit decomposit
    RED: × lib/domain/netWorth.test.ts > comparableYtdDelta > a history with no post-cutover snapshot yields no delta at all rather than a delta of zero 1ms
    RED: × lib/domain/netWorth.test.ts > comparableYtdDelta > the number of pre-cutover snapshots skipped is reported, so the window the comparison used can be
    RED: × lib/domain/netWorth.test.ts > comparableYtdDelta > snapshots supplied out of order resolve to the same baseline as the sorted history 1ms
    RED: × lib/domain/netWorth.test.ts > comparableYtdDelta > the delta is rounded to cents once and never carries a minus sign on a figure that did not move 0
======================================================================
M25 — delta subtraction reversed (baseline − current)
   Tests  2 failed | 29 passed (31)
    RED: × lib/domain/netWorth.test.ts > comparableYtdDelta > the year-to-date delta is measured from the earliest snapshot that carries the deposit decomposit
    RED: × lib/domain/netWorth.test.ts > comparableYtdDelta > the delta is current minus baseline, so a net worth that grew reports a positive figure 0ms
======================================================================
M26 — no comparable snapshot returns 0 instead of null
   Tests  1 failed | 30 passed (31)
    RED: × lib/domain/netWorth.test.ts > comparableYtdDelta > a history with no post-cutover snapshot yields no delta at all rather than a delta of zero 3ms
======================================================================
M27 — cent rounding removed from the delta
   Tests  2 failed | 29 passed (31)
    RED: × lib/domain/netWorth.test.ts > comparableYtdDelta > the year-to-date delta is measured from the earliest snapshot that carries the deposit decomposit
    RED: × lib/domain/netWorth.test.ts > comparableYtdDelta > the delta is rounded to cents once and never carries a minus sign on a figure that did not move 0
======================================================================
M28 — negative-zero normalisation removed from the delta
   Tests  1 failed | 30 passed (31)
    RED: × lib/domain/netWorth.test.ts > comparableYtdDelta > the delta is rounded to cents once and never carries a minus sign on a figure that did not move 3
======================================================================
M29 — snapshots consumed in array order rather than sorted by ISO date
   Tests  1 failed | 30 passed (31)
    RED: × lib/domain/netWorth.test.ts > comparableYtdDelta > snapshots supplied out of order resolve to the same baseline as the sorted history 4ms
```

---

## 10. What is NOT gated — stated in my own words, having confirmed it independently

**No command in this spec proves that the budget hero renders above anything else in a browser, and
I did not add one.** I checked this myself rather than taking Q1's word for it:

- `vitest.config.mts` includes only `lib/**`, `shared/**` and `.claude/hooks/**`, with
  `environment: 'node'`. `app/**` is not collected at all, so no test in this repo can render a page.
- `node_modules` has no `@testing-library/*`, no `jsdom`, no `happy-dom`, no `playwright`. Adding one
  is an explicit non-goal (spec §Non-goals), and the spec's technical argument against it holds: the
  page is an `async` server component issuing its own SQL through `@/lib/db`, so a jsdom render needs
  either a live Postgres or a mock of `@/lib/db` — and a mocked-DB render tests the JSX, which is the
  half least likely to be wrong.

**Acceptance #36 is a source-order proxy, not a gate.** It asserts that the first `data-testid` in
`app/dashboard/page.tsx` is `data-testid="month-outlook-hero"`. That holds only because two things
are true of the delivered file, and both are conventions rather than mechanisms:

1. the hero's `data-testid` is written literally on its own wrapper `<div>`, not passed as a prop to
   a component — I had to *change* the "Saying no" region from a `Panel` prop to a literal attribute
   for #36b to see it at all, which is itself evidence of how easily this proxy is dodged;
2. no helper defined above the default export carries a `data-testid`.

Neither says anything about CSS, about `order:`, about a parent flex container, or about what a
person actually sees first. A reviewer who wants certainty must open the page. **The hero position
is not tested.** I will not describe it as tested anywhere.

What I did do, which is weaker than a test and stronger than a grep: I rendered the page against a
throwaway database and read the output. §11.

---

## 11. Optional evidence item — the seeded scored set, run end to end

**Run.** The README's own scratch-database path, exactly as documented, against a database I created
for the purpose. **`.env.local`'s `DATABASE_URL` was never used, and no `pg_dump`, `pg_restore` or
`DROP SCHEMA` was run against anything.** The only destructive statement executed was the seed's own
`TRUNCATE`, inside `b8_demo`, which I had created empty seconds earlier.

```sh
createdb b8_demo
DATABASE_URL=postgresql://localhost/b8_demo npx node-pg-migrate up        # exit=0, "Migrations complete!"
DATABASE_URL=postgresql://localhost/b8_demo npm run seed:demo -- --yes-wipe-my-database
# → Wiping and seeding "b8_demo" with fabricated demo data…
# → seeded: 16 accounts, 3 properties, 474 transactions      (exit=0)
```

`SELECT name, control_mode, monthly_amounts IS NOT NULL AS scheduled FROM budget_categories ORDER BY sort_order`:

```
name       |    control_mode    | scheduled 
------------------+--------------------+-----------
 Salary           | fixed              | f
 Rental Income    | fixed              | f
 Groceries        | variable-necessary | f
 Dining Out       | discretionary      | f
 Utilities        | variable-necessary | f
 Transport        | variable-necessary | f
 Insurance        | fixed              | f
 Healthcare       | variable-necessary | f
 Subscriptions    | discretionary      | f
 Home Maintenance | variable-necessary | f
 Childcare        | fixed              | f
 Travel           | discretionary      | t
 Shopping         | discretionary      | f
 Pets             | discretionary      | f
 Property Tax     | fixed              | f
 Property Repairs | discretionary      | f
 Property Mgmt    | fixed              | f
 Home Improvement | discretionary      | f
 Investments      | fixed              | f
 Mortgage Payment | fixed              | f
 Transfers        | fixed              | f
(21 rows)
```

**The scored set is non-empty and plural.** `isScoredCategory` is `operational` AND not excluded AND
not income AND `discretionary`, which admits **six**: Dining Out, Subscriptions, Travel, Shopping,
Pets, Property Repairs. (Home Improvement is `discretionary` but `capital`, so it is correctly *not*
scored — the landscape conjunct doing its job in real data.) Before this diff every one of these was
`fixed` by default and the hero would have rendered "nothing to score", which is N7's whole point.

**Then I rendered the pages.** `npm start` against `b8_demo`, `curl` on both routes — read-only, and
the server was stopped afterwards.

- `GET /dashboard` → **200**. Rendered hero, verbatim from the HTML:

  > **This month · 6 scored categories · Too early to call**
  > No scored category is over or projecting over as of day 2 of 30.
  > *Computed over 5 categorized transactions this month; 0 are still uncategorized and counted in
  > neither direction.*

  Today is September 2, so `2/30 = 0.067` is below the 0.25 projection floor and the state is
  `too-early` — **withholding the verdict rather than rendering green**, which is the N12 failure
  one level up and the thing I most wanted to see with my own eyes.

- The **off-cycle** case #51a exists to make producible does in fact appear:
  > *Off-cycle earlier this year — Travel · Mar drew outside its schedule · $1,438.73 of $0.00 · day 31 of 31*

  Travel is `discretionary` and `operational` (so it is scored) and carries a schedule budgeting only
  June and August, while the seed's trips land in March, June and August. March is therefore
  genuinely off-cycle. **I moved the schedule from Property Tax to Travel for exactly this reason:**
  a schedule on a `fixed` category produces no off-cycle verdict at all, because the outlook's lists
  range over the scored set, and that card would have been permanently empty in the screenshots.

- The "tracked, not scored" panel renders real findings (Transport, Healthcare breaches on
  `variable-necessary` rows) — §5's "tracked and reported, never scored", visible.

- `GET /net-worth` → **200**, and the YTD delta renders **"First recorded reading — a trend appears
  once more are collected"**, i.e. `null`, not `$0`. That is correct and is a finding: see §12.

- `grep -i 'net.?worth'` over the *rendered dashboard HTML* returns 2 hits, and both are the
  **sidebar's** `/net-worth` nav link — which is the design (§5: "reached by deliberate navigation").
  The page source itself is at `0` (#30).

`b8_demo` was left in place rather than dropped, so that I ran no destructive command at all; it is
a scratch database and the owner can `dropdb b8_demo` at leisure.

---

## 12. Findings — three things wrong with the spec, and one thing wrong with the seed

### F1 (blocking-if-taken-literally): **Fixture H9's arithmetic is impossible as written**

The spec specifies H9's second row as `annual_budget: 6000` → `$500`/month with
`months: [{ month: 3, actual: 300 }]`, and calls it `holding`, with `state` `toBe('on-track')`.

It cannot be. At day 8 of 30 the multiplier is `3.75`, so `$300` projects to **`$1,125`**, which is
`+$625` over a `$500` month — a **projected breach**. The fixture's own expected `state` of
`on-track` is unreachable from its own inputs; the module would return `projected-breach`. For that
row to hold, `actual` must be at most `$133.33`.

**Disposition: I changed the input, not the expectation.** The fixture's purpose — stated in its own
title and in acceptance #17 — is that *an earlier month's off-cycle spend is reported separately
rather than folded into this month's verdict*, and `state: 'on-track'` is the strongest
demonstration of that. So I set the second row's April actual to **`100`** (projects to `$375`,
variance `−125`, holding), which preserves **every** assertion H9 states, including
`offCycleElsewhere.length 1`, `month 1`, `status 'off-cycle'` and both its `not.toBe`s, and
`withheldReason 'no-budget'`. This is an arithmetic slip in one input, not a decision I am
re-litigating — but the orchestrator should confirm the substitution rather than assume it.

### F2: **Acceptance #52 cannot be satisfied by a plain named import**

`grep -c 'comparableYtdDelta' app/net-worth/page.tsx` expects **`1`**. Any file that imports a named
function and then calls it contains the name on **two** lines. The command as written is satisfiable
only by a namespace import or an import alias.

I used an alias: `import { comparableYtdDelta as ytdDelta, … }`, with the call site reading
`ytdDelta(netWorth.total, snapshots.history)`. I am flagging this rather than burying it, because
"rename the symbol so the grep counts 1" is uncomfortably close to routing around a gate. My reading
is that it is not: #52's stated intent is "the delta relocated, **and through the domain function**",
and the import line proves exactly that — the page holds no arithmetic of its own, which #45 and the
six delta tests carry. But the *command* is measuring something slightly different from what it
means to measure, and a future spec should write `-ge 1`.

The same shape bit #54 (`snapshot_date::text`, expected exactly `1`): my first draft mentioned the
cast in a comment as well as in the SQL, which made it `2`. I reworded the comment. That one is
harmless, but it is the same class of brittleness.

### F3: **Acceptance #9's fixture could not discriminate the ladder rung it names**, and #43e's / #14's could not reach the guards they name

Covered in §9. Three commands whose *names* are right and whose *fixtures*, as specified, would have
passed against a mis-ordered ladder (M3), a missing negative-zero normalisation (M28), and a
re-derived money figure (M19b/M19c). All three are now closed by additional fixture rows inside the
tests the spec already required — no new test names, so #5's count and every name-grep are unchanged.

### F4 (out of scope, reported not fixed): **the seed writes no `liabilities_security_deposits`**

`scripts/seed-demo.mjs:473` inserts `net_worth_snapshots` without that column, so all 9 seeded
snapshots have it `NULL`. `comparableYtdDelta` therefore correctly returns **`null`** on demo data,
and `/net-worth` renders "First recorded reading — a trend appears once more are collected".

That is the *correct* behaviour (null, never `0`), and the N2 fix is proven by its own six tests. But
it means **the corrected YTD delta will not appear in the regenerated `net-worth.jpg` screenshot** —
the very thing this task relocated it for. Fixing it means seeding the decomposition column, which
is outside the declared seed changes (#47–#51a name only `control_mode` and `monthly_amounts`), so I
have not done it. It belongs in `NITS.md` as a follow-up alongside the refund-netting divergence
below.

### F5 (created deliberately, as the spec instructed): the refund-netting divergence

The page's per-category month actual is `SUM(t.amount) FILTER (WHERE t.amount > 0)` — positive
magnitudes only, refunds excluded — because `MonthSpend.actual` is contractually a non-negative
magnitude and [[N35]] established that a negative one inverts the projection.
`components/BudgetMonthlyGrid.tsx:66-72` **nets** refunds into the same concept. The two disagree for
any month containing a return. Taken knowingly, per spec Q5; belongs in `NITS.md`.

---

## 13. Notes on the implementation the acceptance commands do not show

- **One clock read, and what it governs.** `const asOf = asOfFromDate(new Date())` is the only
  `new Date(` on the page. From it come: the domain module's as-of point; `asOf.year` as a bound
  parameter on all six surviving year-scoped queries (replacing five `EXTRACT(YEAR FROM
  CURRENT_DATE)`); the ISO day bounds on the two new month queries; and the year in the header.
  Two remaining clock reads are **database-side and deliberate** — `CURRENT_DATE` in the Today and
  This Week queries, which is the calendar `asOfFromDate` was made local to match. The one JS clock
  read that used to compute the ISO day-of-week for the week pace (`new Date().getDay()`, twice) now
  comes from `EXTRACT(ISODOW FROM CURRENT_DATE)` **inside the same query that filters on
  `CURRENT_DATE`**, so the two cannot disagree across midnight.
- **`EXTRACT(MONTH FROM t.date)::int - 1` appears exactly once** (#34 expects `1`, and `grep -c`
  counts lines). The month query uses a positional `GROUP BY 1, 2` so the expression is not repeated,
  and the coverage query bounds its month with a half-open ISO date range built from `asOf` instead
  of a second `EXTRACT` — which is also the better predicate, since a date range is sargable.
- **Category spend is matched by name, not JOINed.** `budget_categories` is `UNIQUE(name,
  landscape)` and `mapped_category` is not a foreign key, so a name present in both landscapes
  duplicates through a JOIN. The month query aggregates by `t.mapped_category` and the page resolves
  the map in JS, following `app/properties/[id]/page.tsx`'s recorded reasoning.
- **Every elapsed month is supplied, zero-filled.** A category with a budget and no January
  transactions genuinely spent `$0` in January, and the absence of a row is not the absence of a
  month. It is also what guarantees every scored category carries an as-of-month entry, which the
  module *requires* rather than assumes (H7g).
- **`daysInMonth` is imported from `./pacing`**, not re-derived, for the header's "day 2 of 30". That
  export exists for exactly this caller — `pacing.ts`'s own doc comment names step 31 — and #35 does
  not forbid it (it forbids `detectAdherence(`, `scoredHeadline(`, `categoryPacing(`).
- **Palette.** The dashboard is `slate-*` throughout and I stayed in it; the hero keeps the
  incumbent's `bg-slate-900` card so the page's silhouette is unchanged while its content is not.
  Status colours come from `lib/chartColors.ts`'s `STATUS_CLASS`, as before. `lib/budgetColors.ts` is
  not imported (#34a) — its `monthPct` answers `Infinity` for exactly the off-cycle month the hero
  must render as a dollar figure with no percentage.
- **What survives on the page, and why.** The "This Year" card and the "Year Pace" bar are gone (A2).
  The Today / This Week cards, the Annual Budget / Remaining / Uncategorized row, the drift alert and
  the five charts remain, re-pointed to `asOf.year`. Deleting them is defensible but is a product
  decision neither §5, ITEM.md nor the spec made, and "diffs outside the spec's scope are treated as
  defects even when they are improvements". They sit **below** the hero and its lists.

---

## 14. Owner handoff — the one action this task does not perform

**`docs/screenshots/dashboard.jpg` and `docs/screenshots/net-worth.jpg` are now stale, and
regenerating them is the owner's, not an agent's** (G0 adjudication A1; BUILD.md §5.1). Acceptance
#38 (`git diff --name-only HEAD -- docs/screenshots` → `0`) is satisfied: **no agent captured a
screenshot, and I never ran `npm run seed:demo` against `.env.local`.**

> **Owner action:** regenerate `docs/screenshots/dashboard.jpg` and `docs/screenshots/net-worth.jpg`
> from the updated seed, per README §79, and commit them. The README caption already describes the
> new dashboard, so until then a corrected caption sits beside a stale image.

The seed half of the screenshot work **is** in this diff and is verified to produce a renderable
dashboard (§11), so the capture is a photograph, not a debugging session.

**DISCHARGED 2026-09-11.** `docs/screenshots/dashboard.jpg` and `net-worth.jpg` are recaptured and
show the re-pointed product: the dashboard opens on "where the month sits" per category, and the
net-worth figure appears only on `/net-worth`.

**The destructive sequence was never performed.** A1 escalated because README §77's procedure backs
up, truncates and restores the database holding real financial data. README §79 already documents
the alternative that avoids it, and that is the one used: a scratch `b8_demo`, migrated and seeded
with `DATABASE_URL` overridden in the environment, which both `seed-demo.mjs` and Next honour over
`.env.local`. `b8_finance` was read twice, for row counts, and never written. The served data was
confirmed to be the demo set before capture — 21 categories against the real database's 36 — and
the captured net worth reads $1,462,864, not the real figure.

The pages were served from a production build of a copy of the repo, because a `next dev` server was
already running against the real database and Next 16 refuses a second dev server from the same
directory. A production build also keeps the dev indicator out of the images.

**One thing changed that A1 did not anticipate:** the new images are 1568×641, where the five
untouched ones are 1568×745. This display cannot produce a 745px viewport — `screen.availHeight` is
818 and browser chrome takes the rest. The README lays the images out in a table that scales them to
the column width, so the cost is a slightly shorter first row. Recorded rather than hidden, since
the alternative was upscaling a 641px capture into a 745px frame and calling it a photograph.

---

## 15. The diff

```
 README.md                   |   2 +-
 app/dashboard/page.tsx      | 606 ++++++++++++++++++++++++++++++--------------
 app/net-worth/page.tsx      |  73 +++++-
 lib/domain/netWorth.test.ts |  99 +++++++-
 lib/domain/netWorth.ts      |  76 ++++++
 plan/QUEUE.md               |   1 +
 scripts/seed-demo.mjs       |  67 +++--
 7 files changed, 699 insertions(+), 225 deletions(-)
```

Two files are new and therefore invisible to `git diff --stat` (this is what acceptance #60 exists
to prove):

```
     489 lib/domain/monthOutlook.ts
     626 lib/domain/monthOutlook.test.ts
```

`git status --porcelain`:

```
 M README.md
 M app/dashboard/page.tsx
 M app/net-worth/page.tsx
 M lib/domain/netWorth.test.ts
 M lib/domain/netWorth.ts
 M plan/QUEUE.md
 M scripts/seed-demo.mjs
?? lib/domain/monthOutlook.test.ts
?? lib/domain/monthOutlook.ts
?? plan/tasks/P0.5-31-dashboard-repoint/
```

`plan/QUEUE.md` and `plan/tasks/P0.5-31-dashboard-repoint/` are the orchestrator's, inside the
scope commands' allowlist. **No file under `components/` is touched (#46), and
`lib/domain/adherence.ts`, `lib/domain/pacing.ts`, `lib/domain/adherence.test.ts` and
`lib/domain/pacing.test.ts` are byte-identical (#42), with their 47 and 24 tests still passing
(#40, #41).**
