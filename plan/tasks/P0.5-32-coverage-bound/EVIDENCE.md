# EVIDENCE — P0.5-32-coverage-bound

**Implementer.** Written against the frozen `SPEC.md`. Every command below was run by me from the
repo root at the commit under test; output is verbatim.

**Tree at start:** `47c8c8e`, clean apart from `plan/QUEUE.md` and `plan/tasks/P0.5-32-coverage-bound/`
(the orchestrator's). `tsc` exit 0; `Tests 399 passed (399)`; lint `✖ 1 problem (0 errors, 1 warning)`.

**Headline result: all 49 acceptance rows pass.** Five mutations survive a green suite; all five are
disclosed in §7 with the reason, and four of them are the renderer limitation Q4 states rather than
new gaps.

---

## 0. The limitation from Q4, repeated verbatim as Evidence #4 requires

> *No command in this spec proves what the browser renders.* Step 31's Q1 established why — the page
> is an `async` server component issuing its own SQL, `vitest.config.mts` carries no `resolve.alias`,
> and a mocked-DB render would test the mock. The greps above are proxies for the refusal, not proof
> of it, and **the refusal must not be described anywhere as "tested."** What *is* mechanically gated
> is the decision — `coverageShare`, `coveragePercent` and `authoritative` are pure, and fixtures
> #6–#18 pin them.

I have honoured that wording. Nowhere in this bundle is the *rendering* called tested. §6 records a
**live render against a throwaway database**, which is weaker than a test and stronger than a grep,
and §7 records four renderer mutations that survive the whole suite — which is the same limitation,
measured rather than asserted.

---

## 1. Acceptance rows 1–4 — the whole-repo gates

```
$ npx tsc --noEmit; echo "exit=$?"
exit=0

$ npm test 2>&1 | grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"
1

$ npm test 2>&1 | tail -6

 Test Files  21 passed (21)
      Tests  413 passed (413)
   Start at  13:03:36
   Duration  4.39s (transform 662ms, setup 0ms, import 1.04s, tests 4.27s, environment 1ms)


$ npm run lint 2>&1 | tail -2
✖ 1 problem (0 errors, 1 warning)


$ npm run build > /tmp/p32-build.log 2>&1; echo "exit=$?"
exit=0
```

| # | Expected | Measured | |
|---|---|---|---|
| 1 | `exit=0` | `exit=0` | PASS |
| 2 | `1` | `1` | PASS |
| 3 | `✖ 1 problem (0 errors, 1 warning)` | identical | PASS |
| 4 | `exit=0` | `exit=0` | PASS |

Row 2's underlying total moved `399 → 413`: the 14 new fixtures, and nothing skipped. Row 3's single
warning is the pre-existing `scripts/seed-demo.mjs:438`; I introduced no new lint output and touched
no file outside the declared surface.

---

## 2. Row 5 and the full verbose listing (Evidence #5)

```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/monthOutlook.test.ts

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
 ✓ lib/domain/monthOutlook.test.ts > categorizationCoverage > coverage exactly at the threshold is authoritative, because the bound is a closed floor and not an open one 0ms
 ✓ lib/domain/monthOutlook.test.ts > categorizationCoverage > one dollar moved from the seen spend to the unattributed spend crosses the threshold and withdraws authority 0ms
 ✓ lib/domain/monthOutlook.test.ts > categorizationCoverage > the bound is a share of dollars, so one uncategorized four-thousand-dollar row against forty categorized twelve-dollar ones reports ten percent seen and not ninety-seven 0ms
 ✓ lib/domain/monthOutlook.test.ts > categorizationCoverage > spend mapped to a category the headline never scores leaves both the numerator and the denominator, so a categorized grocery run neither helps nor hurts the bound 0ms
 ✓ lib/domain/monthOutlook.test.ts > categorizationCoverage > an orphaned mapped category is unattributed rather than categorized, so a rename that hides a category's spend lowers confidence instead of raising it 0ms
 ✓ lib/domain/monthOutlook.test.ts > categorizationCoverage > the percentage is floored and never rounded, so nine thousand nine hundred ninety-nine dollars of ten thousand reports ninety-nine and not a hundred 0ms
 ✓ lib/domain/monthOutlook.test.ts > categorizationCoverage > a hundred percent is reachable only when no spend at all is unattributed 0ms
 ✓ lib/domain/monthOutlook.test.ts > categorizationCoverage > a month with no spend at all reports no share rather than a hundred percent or a zero 0ms
 ✓ lib/domain/monthOutlook.test.ts > categorizationCoverage > a negative spend total is rejected, because income is negative in this ledger and a denominator that admits it is not a share of spend 0ms
 ✓ lib/domain/monthOutlook.test.ts > categorizationCoverage > a spend total arriving as a string is rejected rather than concatenated into a plausible denominator 0ms
 ✓ lib/domain/monthOutlook.test.ts > categorizationCoverage > a category name defined in both landscapes resolves as scored once and its spend is counted once 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook with a bound on its coverage > unattributed spend does not change which of the seven states is true, so a breach under low coverage is still a breach 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook with a bound on its coverage > a month can be on track and non-authoritative at the same time, because the state and the bound are independent judgements 0ms
 ✓ lib/domain/monthOutlook.test.ts > monthOutlook with a bound on its coverage > orphaned spend larger than the unattributed total it belongs to is rejected rather than reported as a share above one 0ms

 Test Files  1 passed (1)
      Tests  38 passed (38)
   Start at  13:04:01
   Duration  128ms (transform 41ms, setup 0ms, import 52ms, tests 10ms, environment 0ms)

```

```
$ test $(… | grep -cE "✓ lib/domain/monthOutlook\.test\.ts") -ge 38 && echo OK
OK          # count = 38 exactly: the 24 that existed plus the 14 the spec names
```

**Evidence #5 — all 24 pre-existing titles survive, none deleted, none renamed.** They are the first
24 lines of the listing above, in their original order, under the original `describe('monthOutlook')`.
The only edits inside them were forced by `CategorizationCoverage`'s shape change, and there were
exactly three:

| Site | Before | After |
|---|---|---|
| the shared `COVERAGE` fixture | `{ uncategorizedCount: 17, categorizedCount: 183 }` | the nine-field record; `17` and `183` carried across as `unattributedCount` / `scoredCount` |
| "an empty scored set renders nothing to score…" | `outlook.coverage.uncategorizedCount).toBe(17)` | `outlook.coverage.unattributedCount).toBe(17)` |
| "the coverage the figures were computed over…" | `.uncategorizedCount).toBe(17)` / `.categorizedCount).toBe(183)` | `.unattributedCount` / `.scoredCount`, plus three added assertions that the outlook's `coverageShare` / `coveragePercent` / `authoritative` are the coverage record's own values |

**One forced choice worth flagging.** The shared `COVERAGE` fixture's dollar figures are `1520 / 1600`
rather than the `1900 / 2000` the new fixtures use. `1900` contains the substring `900`, and the
pre-existing too-early fixture asserts `JSON.stringify(outlook)` contains no `'900'` anywhere — so
`1900` reddened a test for a reason that has nothing to do with what that test asserts. Both
quotients are exact in IEEE-754 (`1520/1600 === 0.95` → `true`, verified by execution), so the
boundary is a real boundary either way. I changed the fixture, not the assertion.

---

## 3. Rows 6–19b — the fixture title greps

Each `grep -cF` was run against the verbose output above. Expected `1` for every row.

| # | Fixture | Title grepped (`-cF`) | Measured |
|---|---|---|---|
| 6 | C3 | `the bound is a share of dollars, so one uncategorized four-thousand-dollar row against forty categorized twelve-dollar ones reports ten percent seen and not ninety-seven` | `1` |
| 7 | C4 | `spend mapped to a category the headline never scores leaves both the numerator and the denominator, so a categorized grocery run neither helps nor hurts the bound` | `1` |
| 8 | C5 | `an orphaned mapped category is unattributed rather than categorized, so a rename that hides a category's spend lowers confidence instead of raising it` | `1` |
| 9 | C1 | `coverage exactly at the threshold is authoritative, because the bound is a closed floor and not an open one` | `1` |
| 10 | C2 | `one dollar moved from the seen spend to the unattributed spend crosses the threshold and withdraws authority` | `1` |
| 11 | C6 | `the percentage is floored and never rounded, so nine thousand nine hundred ninety-nine dollars of ten thousand reports ninety-nine and not a hundred` | `1` |
| 12 | C7 | `a hundred percent is reachable only when no spend at all is unattributed` | `1` |
| 13 | C9 | `unattributed spend does not change which of the seven states is true, so a breach under low coverage is still a breach` | `1` |
| 14 | C10 | `a month can be on track and non-authoritative at the same time, because the state and the bound are independent judgements` | `1` |
| 15 | C8 | `a month with no spend at all reports no share rather than a hundred percent or a zero` | `1` |
| 16 | C11 | `a negative spend total is rejected, because income is negative in this ledger and a denominator that admits it is not a share of spend` | `1` |
| 17 | C12 | `orphaned spend larger than the unattributed total it belongs to is rejected rather than reported as a share above one` | `1` |
| 18 | C14 | `a category name defined in both landscapes resolves as scored once and its spend is counted once` | `1` |
| 18a | C13 | `a spend total arriving as a string is rejected rather than concatenated into a plausible denominator` | `1` |
| 19 | retention | `the roadmap's day-8-of-30 sentence becomes a hero state and a named list, so a category projecting to close at 266.25 percent of its month is the one saying no while the one projecting at 81.25 percent is holding` | `1` |
| 19a | retention | `an empty scored set renders nothing to score rather than on track, and the tracked-but-unscored categories still produce adherence findings beside it` | `1` |
| 19b | retention | `the coverage the figures were computed over is carried through unchanged and is reported even when every category is holding` | `1` |

---

## 4. Every fixture, expected vs measured

All fourteen fixtures assert their expected values with `toBe`, so **the suite passing IS the
measurement** — a divergence between expected and measured is a red test, and there are none. The
table restates it explicitly anyway, because "the suite is green" and "this figure is that figure"
are different claims.

### 4.1 The arithmetic, re-derived by execution at implementation time

```
$ node -e "…"
1900/2000 === 0.95 -> true
0.95*100 -> 95
Math.floor(0.95*100) -> 95
1899/2000 -> 0.9495
Math.floor(1899/2000*100) -> 94
Math.round(1899/2000*100) -> 95
9999/10000 -> 0.9999
Math.floor(...*100) -> 99
Math.round(...*100) -> 100
480/4480 -> 0.10714285714285714
Math.floor(...*100) -> 10
40/41 (count-shaped) -> 0.975609756097561
5900/6000 (N41 population) -> 0.9833333333333333
1900/8000 (everything in the denominator) -> 0.2375
1520/1600 === 0.95 -> true
55.27/575.27 -> floor -> 9
```

Two of those lines are the whole reason `Math.round` is banned rather than discouraged:
`1899/2000` rounds to **95** (clearing a threshold the month fails) and `9999/10000` rounds to
**100** (claiming complete attribution beside a dollar nobody categorized). Both are floored to
`94` and `99`. This reproduces the orchestrator's G0 derivation exactly.

### 4.2 Fixture by fixture

| Fixture | Input | Expected | Measured | Wrong answer pinned |
|---|---|---|---|---|
| **C1** (#9) | `Dining Out` 1900/20, `Groceries` 4000/30, `null` 100/4 | `scoredSpend 1900`, `unattributedSpend 100`, `orphanedSpend 0`, `share 0.95`, `percent 95`, `authoritative true` | identical | `share not.toBe(0.9833333333333333)` (N41's population); `authoritative not.toBe(false)` (the `>` error). Also asserts `share === COVERAGE_THRESHOLD` |
| **C2** (#10) | C1 with one dollar moved: `Dining Out` 1899, `null` 101 | `share 0.9495`, `percent 94`, `authoritative false` | identical | `percent not.toBe(95)`; `authoritative not.toBe(true)` |
| **C3** (#6) | `Dining Out` 480/40, `null` 4000/1 | `share 0.10714285714285714`, `percent 10`, `authoritative false` | identical | `not.toBe(0.975609756097561)` (= 40/41); `percent not.toBe(97)` |
| **C4** (#7) | C1's scored+unattributed **plus** `Transfers` 3000/2, `Salary` 0/0, `Mortgage` 2200/1, `Home Improvement` 800/3 | `share 0.95` — identical to C1; `scoredSpend 1900`, `unattributedSpend 100` | identical | `not.toBe(0.2375)` (= 1900/8000) and `not.toBe(0.9833333333333333)` |
| **C5** (#8) | `Dining Out` 1900/20, `Dining Ou` 100/3 | `unattributedSpend 100`, `orphanedSpend 100`, `orphanedCount 3`, `share 0.95` | identical | `share not.toBe(1)` — what `mapped_category IS NOT NULL` reports; `percent not.toBe(100)` |
| **C6** (#11) | `Dining Out` 9999/200, `null` 1/1 | `share 0.9999`, `percent 99`, `authoritative true` | identical | `percent not.toBe(100)` |
| **C7** (#12) | `Dining Out` 2000/20, nothing unattributed | `share 1`, `percent 100`, `authoritative true` | identical | plus a second case: one unattributed **cent** takes it to `percent 99`, `not.toBe(100)` |
| **C8** (#15) | no groups at all | `share null`, `percent null`, `authoritative false` | identical | `share not.toBe(0)`, `not.toBe(1)`; `percent not.toBe(0)`, `not.toBe(100)`; `Number.isNaN(share)` is `false`. Plus: an all-known-unscored month is the same empty population and also `null` |
| **C9** (#13) | C2's coverage + a category $120 over its month | `state 'breach'`, `authoritative false`; `sayingNo` length equal to the same rows under C1's coverage | identical | `state not.toBe('nothing-to-score')`, `not.toBe('on-track')`; also asserts `refused.state === trusted.state` and `refused.scoredCategoryCount === trusted.scoredCategoryCount` |
| **C10** (#14) | C2's coverage + step 31's two holding categories | `state 'on-track'`, `authoritative false`, `share 0.9495`, `percent 94` | identical | `state not.toBe('breach')`, `not.toBe('nothing-to-score')`; `authoritative not.toBe(true)` |
| **C11** (#16) | `Salary` group with spend `-9000` | `RangeError` naming the group and the sign rule | throws; matched against `/Salary/` and `/money out/` | plus a second shape where the negative would net invisibly against a positive scored group |
| **C12** (#17) | `unattributedSpend 100`, `orphanedSpend 140` handed to `monthOutlook` | `RangeError` | throws; matched against `/orphanedSpend/` | plus `orphanedCount 99`, a negative `unattributedSpend`, and a string `scoredSpend` |
| **C13** (#18a) | a group whose spend is the string `'6000'` | `RangeError` naming the type | throws; matched against `/string/` | plus `NaN`, `Infinity`, and (added, see §7 M16) a string / negative / non-integer `count` |
| **C14** (#18) | `Travel` 500/5 with `Travel` defined operational/discretionary **and** capital/fixed | `scoredSpend 500`, `share 1` | identical | `not.toBe(1000)`; `scoredCount not.toBe(10)`; and the same assertion with the two category rows in reverse order |

**Note on C14, offered as a spec observation rather than a defect (see §9, O1).** C14 as specified
cannot double-count under the real schema: `budget_categories` is `UNIQUE(name, landscape)` and
`isScoredCategory` requires `landscape = 'operational'`, so at most one row carrying a name is ever
scored. My first attempt at the corresponding mutation — "add once per matching *scored* row" —
therefore **survived**. The mutation that C14 does kill is "add once per matching row, scored or
not", which is the JOIN shape the spec's Q6 is actually about; that is the mutation recorded as M9
in §7, and it dies.

---

## 5. Rows 20–49 — the static gates

```
===== 1 =====
exit=0
===== 3 =====
✖ 1 problem (0 errors, 1 warning)

===== 20 =====
1
===== 21 =====
0
===== 22 =====
OK
===== 23 =====
0
===== 24 =====
1
===== 25 =====
1
===== 26 =====
OK
===== 27 =====
1
===== 28 =====
data-testid="month-outlook-hero"
===== 29 =====
0
===== 30 =====
0
===== 31 =====
OK
===== 32 =====
OK
===== 32a =====
0
===== 33 =====
OK
===== 34 =====
1
===== 34a =====
1
===== 35 =====
0
===== 36 =====
0
===== 37 =====
0
===== 38 =====
1
===== 39 =====
0
===== 42 =====
0
===== 43 =====
1
===== 43a =====
1
===== 43b =====
OK
===== 43c =====
count=16
OK
===== 44 =====
0
===== 45 =====
count=8
OK
===== 46 =====
0
===== 47 =====
0
===== 48 =====
0
===== 49 =====
0
```

### 5.1 Before/after for every transition row

The spec names a clean-tree baseline for each of these; I re-measured all of them before editing and
every one matched the orchestrator's G0 figures.

| # | Command | Before | After | Expected | |
|---|---|---|---|---|---|
| 20 | `grep -cE "^export const COVERAGE_THRESHOLD = 0\.95;" lib/domain/monthOutlook.ts` | `0` | `1` | `1` | PASS |
| 21 | `grep -c '0\.95' app/dashboard/page.tsx` | `0` | `0` | `0` (same before/after) | PASS |
| 22 | `grep -c 'outlook.authoritative' app/dashboard/page.tsx` | `0` | `3` (`-ge 1`) | `OK` | PASS |
| 23 | `grep -cE 'STATE_COPY\[ *outlook\.state *\]' app/dashboard/page.tsx` | `1` | `0` | `0` | PASS |
| 24 | `grep -c 'data-testid="coverage-refusal"'` | `0` | `1` | `1` | PASS |
| 25 | `grep -c 'data-testid="coverage-caveat"'` | `1` | `1` | `1` (same) | PASS |
| 26 | hero line number `<` refusal line number | n/a | `698 < 804` | `OK` | PASS |
| 27 | `grep -c 'data-testid="month-outlook-hero"'` | `1` | `1` | `1` (same) | PASS |
| 28 | first `data-testid` in file | `month-outlook-hero` | `month-outlook-hero` | same | PASS |
| 29 | `grep -cE "a\.landscape = 'operational'"` | `2` | `0` | `0` | PASS |
| 30 | files mentioning `categorizedCount` | `3` | `0` | `0` | PASS |
| 31 | `grep -cE '^export function categorizationCoverage'` | `0` | `1` (`-ge 1`) | `OK` | PASS |
| 32 | `grep -c 'categorizationCoverage' app/dashboard/page.tsx` | `0` | `3` (`-ge 1`) | `OK` | PASS |
| 32a | `grep -c "control_mode = 'discretionary'"` | `0` | `0` | `0` (same) | PASS |
| 33 | `grep -c 'coveragePercent' app/dashboard/page.tsx` | `0` | `3` (`-ge 1`) | `OK` | PASS |
| 34 / 34a | the two `OutlookState` union lines | `1` / `1` | `1` / `1` | byte-identical | PASS |
| 35 | `roundCents\|Math.round\|Math.abs\|toFixed` in the module | `0` | `0` | `0` | PASS |
| 36 | `try {` / `catch (` in the module | `0` | `0` | `0` | PASS |
| 37 | `new Date(` / `Date.now(` in the module | `0` | `0` | `0` | PASS |
| 38 | `new Date(` on the page | `1` | `1` | `1` | PASS |
| 39 | net-worth mentions on the page | `0` | `0` | `0` | PASS |
| 40 | `adherence.test.ts` count | `47` | `47` | `-eq 47` | PASS |
| 41 | `pacing.test.ts` count | `24` | `24` | `-eq 24` | PASS |
| 42 | diff of the four read-only inputs | `0` | `0` | `0` | PASS |
| 43 / 43a | `getMonthlyActuals`'s normalisation and predicate set | `1` / `1` | `1` / `1` | `1` / `1` | PASS |
| 43b | `isoDay(asOf.year, asOf.month, 1)` | `1` | `1` (`-ge 1`) | `OK` | PASS |
| 43c | `t.amount > 0` line count | `14` | `16` (`-ge 15`) | `OK` | PASS |
| 44 | the incumbent reassuring sentence | `1` | `0` | `0` | PASS |
| 45 | `withheld.length` | `2` | `8` (`-ge 3`) | `OK` | PASS |
| 46 | contract-surface diff | `0` | `0` | `0` | PASS |
| 47 | out-of-scope diff | `0` | `0` | `0` | PASS |
| 48 / 49 | scope commands | `0` / `0` | `0` / `0` | `0` / `0` | PASS |

**Row 34 / 34a were satisfied by not touching the lines at all.** The `OutlookState` union is
byte-identical to `47c8c8e`; `authoritative` is a sibling field on `MonthOutlook`, never a rung.

**Row 43c reads 16, not 15.** `grep -c` counts *lines*: one is the new
`AND t.amount > 0` predicate in the coverage aggregation, the other is the sentence in that
function's doc comment explaining why the predicate is the whole sign rule. Both are genuine
occurrences of the string; neither was written to satisfy the counter. See §7 M12 — this counter
does **not** in fact catch the removal of that predicate.

**Row 45 reads 8**, comfortably over the `-ge 3` floor: the two pre-existing panel conditionals plus
six in the rewritten subtitle (which now has three branches — all-withheld, some-withheld, none).

### 5.2 Row 29, and what replaced the predicate

The spec requires the replacement comment to say "the account's landscape" **in prose, not by
restating the literal predicate**. `getCoverageGroups`'s doc comment now reads, in part:

> …this query filtered the ACCOUNT's landscape while the hero's figures gate the CATEGORY's —
> different columns, different tables, and the two sets are not nested either way… There is now NO
> account-landscape predicate at all. Landscape enters once, downstream, through
> `isScoredCategory`'s first conjunct, on the category.

`grep -cE "a\.landscape = 'operational'"` on the page is `0`.

---

## 6. Evidence #1, #2 and #3 — the measurements

### 6.1 Evidence #1 — the coverage on the owner's dev database

**I did not run this. I am citing the orchestrator's G0 measurement, on instruction**, because it was
already made read-only against the dev database, applying this spec's own population, and repeating
it would add risk without adding information. From `GATES.md`:

| Month (2026) | Coverage under this spec's rule | Unattributed txns |
|---|---|---|
| Jan–Jul | **100.0%** | 0 |
| **Aug** | **7.7%** | **22** |
| **Sep (to date)** | **no scored spend at all** | **5** |

**So the headline renders non-authoritative from day one on the owner's real data, and that is the
feature working.** Seven clean months at 100% establish the rule is not systematically pessimistic;
August is a real categorization backlog and September has no scored spend recorded yet. Under
`coverageShare === null` for September the hero renders the state and the lists, says *"No spend is
recorded this month yet, so there is no share to compute one over"*, and refuses authority — which
is the `null` contract doing exactly what Q4 specifies rather than printing `0%`.

**`COVERAGE_THRESHOLD` is untouched at `0.95`.** Nothing in my implementation or testing gave me a
reason to move it, and had it done so the finding would be here rather than in the constant. It
appears as a literal exactly once in shipped code (row 20 = `1`, row 21 = `0`).

### 6.2 Evidence #2 — the orphan count

**Still `0` on the owner's database** (step 31's G4 figure, unchanged; I did not re-measure and did
not need to — nothing in this diff writes a transaction). Stated explicitly as the spec requires:
**the orphan branch is latent, not live, and no green dev-database check is evidence that it works.**
Fixture C5 is the only place it is observable, and mutations M5 and M6 in §7 both kill it. I also
exercised it once against a throwaway database by inserting a fabricated `Dining Ou` row — §6.4.

### 6.3 Evidence #3 — the caveat sentence, before and after, verbatim

**Before** (step 31, one shape only, rendered unconditionally):

> Computed over 5 categorized transactions this month; 0 are still uncategorized and counted in
> neither direction. *Review them.*

**After — shape 1, authoritative.** Rendered HTML, throwaway database, no refusal region present:

> Computed over 100% of this month's spend — $55.27 the scored categories account for, against $0.00
> across 0 transactions they could not. Spend in categories this hero never scores is in neither
> figure. *Review them.*

**After — shape 2, non-authoritative.** Same database with a fabricated $400 uncategorized row and a
fabricated $120 row mapped to the orphan `Dining Ou`:

> Computed over 9% of this month's spend — $55.27 the scored categories account for, against $520.00
> across 2 transactions they could not. 1 of those carries a category that no longer exists — most
> likely a rename. Spend in categories this hero never scores is in neither figure. *Review them.*
>
> **Not a verdict yet**
> Too much of this month's spend is unaccounted for to read the figures above as a judgement on the
> month. They are accurate about what was seen and silent about the rest, so treat them as a partial
> reading — categorizing the transactions above will settle it.

`55.27 / (55.27 + 520) = 0.09607…`, floored to **9**. The rounded answer is 10; the floor is what
rendered.

**After — shape 3, `coveragePercent === null`.** Same database with every positive-amount row of the
current month hidden:

> No spend is recorded this month yet, so there is no share to compute one over.
>
> **Not a verdict yet**
> Too much of this month's spend is unaccounted for … so treat them as a partial reading — there is
> nothing recorded to compute a share over yet.

Neither `0%` nor `100%` appears anywhere in that region — checked programmatically against the
rendered HTML, both `False`.

### 6.4 The live render — weaker than a test, stronger than a grep

**No `.env.local` value was used and nothing was run against the owner's database.** I used the
`b8_demo` throwaway database step 31 created and left in place, started the built app against it on
port 3999, `curl`ed `/dashboard`, and stopped the server afterwards. `npm run seed:demo` was **not**
run. The only writes were four statements inside `b8_demo` — two fabricated transaction inserts, one
`UPDATE … SET hidden`, one `UPDATE … SET control_mode` — and **all four were reverted**; the
fabricated rows are deleted and `control_mode` was restored row by row from a CSV taken beforehand
(`SELECT COUNT(*) … LIKE 'p32-fab%'` → `0`; `control_mode = 'discretionary'` → `7`, matching step 31).

Four shapes rendered, all HTTP 200:

| Shape | State | Coverage | `coverage-refusal` in HTML | Result |
|---|---|---|---|---|
| A — authoritative | `too-early` | 100% ($55.27 / $55.27) | **absent** | correct |
| B — refused, with an orphan | `too-early` | 9% ($55.27 / $575.27), 1 orphan | **present**, after the hero | correct |
| C — `null` share | `too-early` | no spend at all | **present** | correct, names the cause |
| D — `nothing-to-score` stacked | `nothing-to-score` | 0% | **present** | correct, see below |

In every shape `data-testid="month-outlook-hero"` and `data-testid="coverage-caveat"` were present:
**the hero is demoted, never suppressed.**

**Shape D is Q4's fourth observable requirement.** With every category forced to `fixed`, the two
messages stack and the refusal copy does not contradict the route out:

> **Nothing to score yet** — No category is classified as discretionary yet, so there is nothing
> behaviour can be scored on. *Classify your categories* to give this month a verdict.
>
> Computed over 0% of this month's spend — …
>
> **Not a verdict yet** — … treat them as a partial reading — *classifying your categories is the
> first half of settling it, and categorizing these transactions is the second.*

**The demotion path demonstrably executes.** Comparing shape A's HTML with shape B's, the hero's pill
class changes from `bg-slate-800 text-slate-300` to `bg-slate-800 text-slate-400` — `heroCopy`'s
non-authoritative branch, observed in a real render. **The stronger claim I cannot make:** the title
tone is `text-slate-300` in both, because `too-early`'s own tone is already slate. A confident state
(`on-track`'s emerald, `breach`'s red) under low coverage needs a day-of-month at or past the
projection floor, which today's date does not supply and which I will not manufacture by editing the
clock read. **So the demotion of a confident colour is verified by source reading only**, and
mutation M15 in §7 confirms it is not gated. This is Q4's limitation, in its most specific form.

**A defect the render found that no command would have.** Shape A's first draft rendered:

> None of the **0** categories with a budget this month is over or projecting over as of day 3 of 30;
> the other 6 have no verdict.

"None of the 0 categories" is vacuously true and rendered as a finding — [[N40]]'s own failure mode,
one shape along, introduced by my own N40 fix. I added a third branch for
`withheld.length === scoredCategoryCount`, which now reads *"No scored category has a verdict this
month yet — all 6 are withheld, for the reasons under 'No verdict' below."* Acceptance #44 and #45
still pass (`0` and `8`). **I would not have caught this from the greps.**

---

## 7. Mutation testing

Every load-bearing guard, removed or inverted, the suite re-run, then restored. Files were restored
from byte-copies taken before the first mutation and verified identical afterwards (`diff` clean on
both). "KILLED" means at least one test went red; the named tests are the ones that did.

### 7.1 Killed — 12 of 17

| # | Mutation | Result | Tests that went red |
|---|---|---|---|
| **M1** | **threshold `>=` → `>`** (the closed floor opens) | KILLED 2/38 | *coverage exactly at the threshold is authoritative…*; *unattributed spend does not change which of the seven states is true…* |
| **M2** | **`Math.floor` → `Math.round`** on the percentage | KILLED 6/38 | *the percentage is floored and never rounded…*; *a hundred percent is reachable only when…*; *the bound is a share of dollars…*; *one dollar moved…*; both `monthOutlook`-with-a-bound fixtures |
| **M3** | threshold compared against `coveragePercent` instead of `coverageShare` | KILLED 4/38 | *one dollar moved…*; *the bound is a share of dollars…*; both `monthOutlook`-with-a-bound fixtures |
| **M4** | **population predicate, domain half:** known-unscored spend falls into the denominator (N41's shape) | KILLED 6/38 | *spend mapped to a category the headline never scores…*; *coverage exactly at the threshold…*; *one dollar moved…*; *a month with no spend at all…*; both bound fixtures |
| **M5** | **orphan classification inverted:** an orphan counts as scored (N43's old behaviour) | KILLED 1/38 | *an orphaned mapped category is unattributed rather than categorized…* |
| **M6** | orphans stay unattributed but stop being reported separately | KILLED 1/38 | *an orphaned mapped category…* |
| **M7** | **the `authoritative` flag itself**, hardcoded `true` | KILLED 5/38 | *one dollar moved…*; *the bound is a share of dollars…*; *a month with no spend at all…*; both bound fixtures |
| **M8** | `null` semantics removed: an empty population reports a share of `1` | KILLED 1/38 | *a month with no spend at all reports no share rather than a hundred percent or a zero* |
| **M9** | name-in-two-landscapes: one add per matching category row (the JOIN shape) | KILLED 1/38 | *a category name defined in both landscapes resolves as scored once…* |
| **M10** | sign guard removed: a negative group total is accepted | KILLED 1/38 | *a negative spend total is rejected…* |
| **M11** | `orphanedSpend <= unattributedSpend` guard removed | KILLED 1/38 | *orphaned spend larger than the unattributed total…* |
| **M16** | group `count` guard removed | KILLED 1/38 | *a spend total arriving as a string is rejected…* — see 7.3 |

The five guards the orchestrator named specifically: **threshold comparison — M1, killed.
Floor-vs-round — M2, killed. Population predicate — M4 (domain half) killed, M12 (SQL half)
SURVIVED. Orphan classification — M5 and M6, both killed. The `authoritative` flag — M7, killed.**

### 7.2 Survived — 5 of 17, all disclosed

**Every one of these leaves the suite at `38 passed (38)` and `tsc` at exit 0.** I checked each
against the acceptance greps as well; only one is caught there.

| # | Mutation | Suite | Acceptance greps | Assessment |
|---|---|---|---|---|
| **M12** | **SQL half of the population predicate: `AND t.amount > 0` deleted** | green | **#43c still passes** — the count falls `16 → 15`, and the floor is `-ge 15` | **A real gate gap, and the one I would most want a reviewer to see.** Income is negative in this ledger, so this mutation admits payroll rows to the denominator and the share silently *shrinks*. The domain's `RangeError` does not fire, because Postgres sums the group and only a group that is net-negative overall throws — an income category with any expense in it nets positive and passes. Row #43c reads as a guard against this and is not one: it survives the deletion by exactly one line, and the line that saves it is a doc comment. |
| **M13** | account-landscape predicate restored (N42) | green | **#29 catches it** (`0 → 1`) | Gated statically, as the spec intends. |
| **M14** | `{!outlook.authoritative && (` → `{false && (` — the refusal region never renders | green | all pass (#22 still `-ge 1` via `heroCopy`'s argument; #24 still finds the testid in dead code) | Q4's limitation, exactly. The testid grep proves the region exists in source, not that it renders. |
| **M15** | `if (authoritative)` → `if (authoritative \|\| true)` — the hero's tone stops depending on authority | green | all pass (#23 is still `0`) | Q4's limitation. This is the spec's own named worst case — "the emerald 'On track to close inside your limits' above a refusal banner" — and nothing mechanical catches it. |
| **M17** | the page prints `pct(outlook.coverageShare)` instead of the domain's floored integer | green | all pass (#33 still `-ge 1` via the `=== null` test) | Q4's limitation, and the most insidious of the four: the domain's floor is correct and untouched, and the page rounds it back to `100%` at the point of display. #35 bans rounding in the *module*; nothing bans it on the *page*. |

**Summary of the gap, stated plainly.** The decision is thoroughly gated: twelve mutations across the
threshold, the floor, the population, the orphan branch, the sign rule, the null contract and the
flag itself all die. **The rendering is not gated at all** — four independent ways to render the
wrong thing (hide the refusal, keep the confident colour, round the share, or drop the SQL sign
filter) leave 38/38 green and every acceptance row passing. That is precisely the limitation Q4
states and T5 declines to fix, so it is not a deviation from the spec; but "stated as a limitation"
and "measured as four live holes" are different things, and the second is more useful at G3.

### 7.3 One guard I added a test for rather than leaving unverified

M16 — removing the `count` validation in `assertGroup` — **survived on first measurement**. That
guard is mine (the spec's §"Internal consistency" names the six figures, and I extended the same
discipline to the per-group counts). Rather than ship an untested guard, I folded three assertions
into the existing `#18a` fixture — a string `count`, a negative `count`, a non-integer `count` — so
the fixture now covers the whole `assertGroup` contract rather than half of it. Re-measured: **M16
KILLED**. The test count stays at 38 and its title is unchanged, so no acceptance row moves.

---

## 8. The diff

```
$ git diff --stat HEAD
 app/dashboard/page.tsx          | 190 +++++++++++++++++---
 lib/domain/monthOutlook.test.ts | 389 +++++++++++++++++++++++++++++++++++++++-
 lib/domain/monthOutlook.ts      | 377 +++++++++++++++++++++++++++++++++++---
 plan/QUEUE.md                   |   1 +
 4 files changed, 904 insertions(+), 53 deletions(-)

$ git status --porcelain
 M app/dashboard/page.tsx
 M lib/domain/monthOutlook.test.ts
 M lib/domain/monthOutlook.ts
 M plan/QUEUE.md
?? plan/tasks/P0.5-32-coverage-bound/
```

Three code files plus the plan directory. `plan/QUEUE.md` and `plan/tasks/P0.5-32-coverage-bound/`
are the orchestrator's, and both are excluded by rows 48 and 49's regex. `AGENTS.md` did not
reappear dirty. **No file under `shared/`, `db/`, `migrations/`, `components/`, `app/api/`,
`app/budget/`, `scripts/`, `docs/`, `lib/plaid.ts`, `lib/scheduler.ts` or `vitest.config.mts` was
touched** (rows 46, 47, both `0`).

### What changed, in one paragraph each

**`lib/domain/monthOutlook.ts`.** `COVERAGE_THRESHOLD` is exported at `0.95` with its policy
justification in the comment. `CategorizationCoverage`'s two counts are **removed** and replaced by
nine fields — three spend/count pairs plus `coverageShare`, `coveragePercent` and `authoritative`.
`CoverageGroup` and `CoverageCategory` are new input types, the latter projected off `BudgetCategory`
via `ScorableCategory` rather than declared locally. `categorizationCoverage(groups, categories)` is
the new pure classifier; `assertGroup` and `assertCoverage` are its guards. `monthOutlook` calls
`assertCoverage` before `assertCallerContract` and surfaces the three derived fields **by reference**
off the coverage record. The `OutlookState` union is byte-identical. The module header's claim that
there is "no division" here was true before this step and is not now, so I amended it to name the one
division and why it lives here — leaving a stale claim would have been a small lie in a file whose
whole discipline is that its comments are accurate.

**`app/dashboard/page.tsx`.** `getCoverage` becomes `getCoverageGroups`: one aggregation grouped by
`mapped_category` (NULL included), `getMonthlyActuals`'s predicate set exactly, **no account-landscape
predicate**, `t.amount > 0`, windowed to the as-of month to date, `NUMERIC` converted at the boundary.
`heroCopy(state, authoritative)` replaces the bare `STATE_COPY[outlook.state]` lookup. The caveat
renders the domain's floored percentage in three shapes and never calls `pct()`. A
`data-testid="coverage-refusal"` region renders inside the hero iff `authoritative === false`. The
subtitle's unconditionally reassuring `else` branch is replaced by three branches keyed on
`withheld.length`.

**`lib/domain/monthOutlook.test.ts`.** Three edits to the pre-existing 24 (§2), and 14 new fixtures
in two new `describe` blocks.

---

## 9. Findings, and things I would flag rather than absorb

**Nothing in this spec was unsatisfiable, and I worked around nothing.** No A3/A4 escalation is
required (Evidence #6): every counter in the spec was met by a correct implementation, including
#43c, which I reached without reshaping the query — the predicate needed to be there anyway.

**O1 — C14 is a weaker negative control than Q6 implies, and this is a spec observation, not a
defect.** Q6's hazard is a name in two landscapes being counted twice. Under the real schema
(`UNIQUE(name, landscape)` plus `isScoredCategory`'s `landscape = 'operational'` conjunct) **at most
one row carrying a name can ever be scored**, so an implementation that adds once per matching
*scored* row is indistinguishable from the correct one on C14's input — I mutated to exactly that and
it survived. What C14 does kill is the JOIN shape (add once per matching row, scored or not), which
is the shape the page's SQL avoids by matching on name without a JOIN. The fixture is worth keeping;
its `not.toBe(1000)` is just narrower than it reads.

**O2 — #43c does not gate what it appears to gate.** Detailed in §7 M12. Deleting the coverage
query's `AND t.amount > 0` takes the line count from 16 to 15 and the row still passes, because a doc
comment in the same function contains the string. I am reporting this rather than adjusting the code
to game it upward, per A4's instruction. If the orchestrator wants a real gate here the cheapest one
is a row asserting `SUM(t.amount)` appears in a query whose `WHERE` carries the filter — but that is
a spec change, not mine to make.

**O3 — the renderer's four live holes.** §7.2. Stated as a limitation by Q4, measured as four
surviving mutations here. T5 explicitly declines a render harness and I did not add one (it is a
non-goal, and `vitest.config.mts` is out of scope). Flagging it as the highest-value follow-up on
this surface.

**O4 — `toAdherenceInput`'s double-count for a name in two landscapes is still live**, exactly as Q6
predicted: both category rows read the same name-keyed actuals map, so a `Travel` defined in both
landscapes contributes its spend to both rows' `actual`. Pre-existing, out of scope, and belongs in
`NITS.md`. The coverage classifier does **not** have this bug (fixture C14).

**O5 — the vacuous-subtitle defect I introduced and fixed**, §6.4. Recorded because it is the second
time this hero has produced a true-but-vacuous sentence, and both times the greps were silent.

**On `COVERAGE_THRESHOLD`.** I left it at `0.95`. Nothing in implementation or testing made 0.95 look
wrong to me: the constant is doing exactly what Q3 says it should on the owner's data — refusing a
month with 22 unattributed transactions and accepting seven months with none. The refusal is
information about the categorization backlog, not about the constant.

---

## 10. What is not proven

- **What the browser renders.** §0, repeated: the refusal is gated as a *decision*, not as a
  rendering, and I have not described it as tested anywhere. §6.4's render is one machine, one
  throwaway database, four shapes, read out of the HTML — evidence, not a gate.
- **The demotion of a confident colour.** §6.4: `too-early` is slate in both authority modes, so the
  render could not distinguish them on the title. Source reading and M15 are all there is.
- **`hidden = TRUE` / `track_transactions = FALSE` leakage into the population.** The spec says no
  fixture can catch this; none does. The query carries both predicates and a reviewer reading it is
  the only gate, as the spec's failure-mode list states.
- **That `0.95` is the right number for the owner's data over time.** One month's measurement is not
  a validation. The constant is named and exported so this can be revisited from evidence.

---

# 11. G2 cycle 1 — the M12 finding, closed

**Returned finding:** deleting `AND t.amount > 0` from `getCoverageGroups` left `tsc` at exit 0 and
the suite fully green. Confirmed independently by the orchestrator. **Scope of this cycle: one test,
no production change.**

**Production code is byte-identical to what G2 measured.** `diff` against my pre-cycle byte-copy of
`lib/domain/monthOutlook.ts` is empty, and
`sha256(app/dashboard/page.tsx) = 8f67a939830b88f64028c409a47f87589499c157cc25c8e11f24fcb02e3f4453`,
matching the hash in the finding. `COVERAGE_THRESHOLD` is still `0.95` (row 20 = `1`). The only file
changed in this cycle is `lib/domain/monthOutlook.test.ts`.

## 11.1 The honest part first: what a fixture can and cannot reach

Per the N23/A3 disposition, stated plainly rather than papered over:

> **No behavioural test of `categorizationCoverage` can detect the removal of that predicate.** The
> function's inputs are `CoverageGroup[]` — spend and counts that have *already been aggregated by
> Postgres*. No value of those inputs distinguishes "the query filtered on sign" from "the query did
> not"; the two produce different *groups*, and the function is correct on both. The predicate is
> genuinely out of reach of a fixture, exactly as the finding's own framing allows for.

So I did **not** write a behavioural test that appears to cover it. The new test asserts the
predicate against the **source text of the query itself**, and its title says so:

> *"the coverage aggregation carries its own positive-amount filter, asserted against the query
> source because a predicate living in SQL cannot be reached from the classifier own inputs"*

That is a **static gate moved into the suite**, so it runs on every `npm test` rather than only when
someone re-runs an acceptance grep. It is strictly stronger than row #43c, which it replaces in
practice: #43c counts `t.amount > 0` lines across the whole file against a `-ge 15` floor, so the
deletion slid past it 16 → 15 with a doc comment holding the count up. The new assertion slices
`getCoverageGroups`'s SQL out of the page, takes the substring between `WHERE` and `GROUP BY`, and
asserts on **that clause alone** — no sibling query and no comment can satisfy it.

It is the first test in this repo to read a source file (`grep -rl node:fs` over the suites returns
nothing else), so it is a new pattern and I am flagging it as one rather than letting it pass as
routine.

**Where the guard *could* be gated behaviourally**, offered as the structural answer since prose is
not one: move the aggregation boundary. If `getCoverageGroups` returned rows — `{ category, amount }`
— and the domain summed them, the sign rule would become part of the classifier's own contract and
fixture-reachable, and the existing `assertGroup` sign check would move from "validate what SQL
produced" to "implement the population". That is a production change and therefore not this cycle's;
recording it as the shape of the real fix.

## 11.2 The mutation, per direction

```
$ python3 -c "…"   # delete `AND t.amount > 0` from getCoverageGroups
M12 applied

$ npx vitest run --pool=threads --reporter=verbose lib/domain/monthOutlook.test.ts
 × lib/domain/monthOutlook.test.ts > the coverage population, where it is decided > the coverage
   aggregation carries its own positive-amount filter, asserted against the query source because a
   predicate living in SQL cannot be reached from the classifier own inputs 5ms
      Tests  1 failed | 38 passed (39)

AssertionError: expected 'WHERE t.hidden = FALSE\n       AND t.…' to contain 't.amount > 0'
 ❯ lib/domain/monthOutlook.test.ts:1048:19

$ npm test        # whole repo, under the mutation
 Test Files  1 failed | 20 passed (21)
      Tests  1 failed | 413 passed (414)

$ cp <backup> app/dashboard/page.tsx      # restored
$ shasum -a 256 app/dashboard/page.tsx
8f67a939830b88f64028c409a47f87589499c157cc25c8e11f24fcb02e3f4453   # matches the finding's hash
```

**M12: KILLED.** Before this cycle it survived with 413/413 green.

### Which way the share moves, and by how much

The finding asks for a direction. **There is no single direction, and that is the substantive
answer** — it depends on which group absorbs the negative rows. Measured against the C1 baseline
(`Dining Out` 1900 scored, `null` 100 unattributed, share `0.95`, authoritative):

| Where the negative row lands | Group arrives as | Share | Percent | Authoritative | Direction |
|---|---|---|---|---|---|
| *baseline, filter present* | 1900 / 100 | `0.95` | 95 | **true** | — |
| income in an **income category** | `Salary` −7750 | — | — | — | **throws `RangeError`** — loud |
| refund netted into a **scored** group | 1800 / 100 | `0.9473684210526315` | 94 | **false** | **DOWN by 0.00263** — refuses for the wrong reason |
| transfer-in netted into the **unattributed** group | 1900 / 50 | `0.9743589743589743` | 97 | **true** | **UP by 0.02436** — keeps authority it has not earned |

All three are asserted in the new test with literal expected values, and all three are reachable from
the classifier's inputs — this is the half a fixture *can* reach, and it is what makes "wrong either
way" a measurement rather than a phrase. The downward case is the pessimistic caveat nobody
investigates; the upward case is the over-confident one, and it moves the month back across the
threshold in the direction this entire step exists to prevent.

**Measured on the throwaway `b8_demo` database** (read-only `SELECT`s; `.env.local` never used) for
August 2026, all three paths are live in real-shaped data: `Salary` sums to −7750.00 and
`Rental Income` to −5200.00 (both would throw), while `Transfers` has `SUM(amount) FILTER (amount>0)`
of 5985.93 against a signed sum of **0.00** — a group whose entire value is netted away by a single
inbound row. That is the netting effect at full size, in data nobody constructed for the purpose.

### Bonus: the same test also kills M13

The new assertion additionally requires the query's `WHERE` clause **not** to contain `a.landscape`,
so [[N42]]'s account-landscape predicate returning is now a red test rather than only a grep:

```
$ # M13 applied: AND a.landscape = 'operational' restored to the coverage query
      Tests  1 failed | 38 passed (39)
$ # restored, sha back to 8f67a939…
```

This is one extra `expect` on the same predicate set in the same test, not a second test. Disclosed
because it is marginally more than the finding asked for.

## 11.3 Name-set diff — additions only

```
before = 38 tests    after = 39 tests

$ comm -23 names.before names.after      # removals or renames
(empty)

$ comm -13 names.before names.after      # additions
the coverage population, where it is decided > the coverage aggregation carries its own
positive-amount filter, asserted against the query source because a predicate living in SQL cannot
be reached from the classifier own inputs
```

**None of the 38 existing tests was modified**, renamed or reordered. The only edit outside the
appended block is one added `import { readFileSync } from 'node:fs';` line with a four-line comment
saying why it is there.

## 11.4 Re-run of #1, #2 and the scope rows

```
$ npx tsc --noEmit; echo "exit=$?"
exit=1

# errors NOT in the duplicated .next/types sync artifacts:
0

$ npm test 2>&1 | grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"
1

$ npm test 2>&1 | tail -5
 Test Files  21 passed (21)
      Tests  414 passed (414)
   Start at  17:40:05
   Duration  4.52s (transform 708ms, setup 0ms, import 1.07s, tests 4.43s, environment 1ms)


$ npm run lint 2>&1 | tail -2
✖ 1 problem (0 errors, 1 warning)


# 48 scope, tracked
0
# 49 scope, incl. untracked
0
# 46 contract surface
0
# 47 out-of-scope surface
0
# 5
OK
# 20 threshold unchanged
1
# sha of page (must equal 8f67a939...)
8f67a939830b88f64028c409a47f87589499c157cc25c8e11f24fcb02e3f4453  app/dashboard/page.tsx
# sha of domain module vs pre-G2
b228340b8d7ae7b19f0231b50d389a5ae35900e1354f33d5d7fe5a3d1571e413  lib/domain/monthOutlook.ts
```

| # | Expected | Measured | |
|---|---|---|---|
| 1 | `exit=0` | **non-zero — see below** | **environment, not code** |
| 2 | `1` | `1` (`Tests 414 passed (414)`) | PASS |
| 3 | `✖ 1 problem (0 errors, 1 warning)` | identical | PASS |
| 5 | `-ge 38` | `39` → `OK` | PASS |
| 20 | `1` | `1` — threshold untouched at `0.95` | PASS |
| 46 | `0` | `0` | PASS |
| 47 | `0` | `0` | PASS |
| 48 | `0` | `0` | PASS |
| 49 | `0` | `0` | PASS |

### Row 1 — the sync artifacts are back, reported rather than worked around

`npx tsc --noEmit` exits non-zero, and **every error is in a duplicated `.next/types` build
artifact**, this time as ` 3.` *and* ` 4.` variants — the same Finder/iCloud noise you cleared before
picking this up:

```
.next/types/cache-life.d 3.ts(3,1)
.next/types/cache-life.d 4.ts(3,1)
.next/types/routes.d 3.ts(93,8)
.next/types/routes.d 4.ts(93,8)
```

Eight such files exist (`cache-life.d`, `root-params.d`, `routes.d`, `validator`, each ` 3.` and
` 4.`). **Errors outside them: `0`.** Per your instruction I have not edited them, not deleted them
and not added a `tsconfig` exclude — I am telling you. My `npm run build` runs during this task are
the likely trigger for the sync client regenerating them. Row 1 was `exit=0` at the end of the
implementation cycle, and no source file changed between then and now except the test file.

---

# 12. G3 cycle 2 — the BLOCK and two findings

Three items returned. All three fixed and verified by the mutation or the render that motivated
each. **Test count 39 → 40, additions only.** `COVERAGE_THRESHOLD` untouched at `0.95`.

Hashes after this cycle: `app/dashboard/page.tsx` `b935fa8d…`, `lib/domain/monthOutlook.ts`
`c77dba9c…`.

## 12.1 THE BLOCK — the page stated something false about the owner's money

**Reproduced exactly.** On the throwaway `b8_demo` database I hid this month's single scored row,
leaving `Childcare` $1,000.00, `Groceries` $133.34 and `Transfers` $2,400.00 — all known-unscored —
and nothing unattributed. `scoredSpend 0`, `unattributedSpend 0`, `population 0`,
`coverageShare null`. The page rendered, with $3,533.34 of spend posted:

> **coverage-caveat:** "No spend is recorded this month yet, so there is no share to compute one over."
> **coverage-refusal:** "…treat them as a partial reading — there is nothing recorded to compute a share over yet."

Both false, no qualifier near either. Agreed on every point, including that it is reachable monthly
rather than a corner: `unattributedSpend === 0` is the owner's normal condition (G0: Jan–Jul, zero
unattributed transactions) and `scoredSpend === 0` is the first days of any month, when rent and
utilities have posted and no discretionary charge has.

**The fix.** An empty POPULATION is not an empty MONTH, and the page can tell them apart:
`coverageGroups` is the unfiltered aggregation, so — unlike the coverage record, which by design
drops known-unscored spend from both halves — it still distinguishes "nothing happened" from
"nothing this hero scores happened". `coverageGroups.length === 0` is that test, and it needs no
arithmetic: every group comes from `GROUP BY` over rows already filtered to `amount > 0`, so a group
exists if and only if spend was recorded. **No domain change was needed for this item.**

### What the page now renders, both states, read out of the rendered HTML

**State 1 — spend recorded, none of it in this hero's reach** (the blocked state, $3,533.34 posted):

> **coverage-caveat:** "None of this month's spend is in reach of this hero — every transaction
> recorded so far is mapped to a category it never scores, and none is unattributed — so there is no
> share to compute one over."
>
> **coverage-refusal:** "Not a verdict yet — Nothing recorded this month falls in the scored set or
> outside it unattributed, so the bound has nothing to range over and the figures above are not a
> judgement on the month."

**State 2 — genuinely nothing recorded:**

> **coverage-caveat:** "No spend is recorded this month yet, so there is no share to compute one over."
>
> **coverage-refusal:** "Not a verdict yet — Nothing is recorded this month yet, so the bound has
> nothing to range over and the figures above are not yet a judgement on the month."

Programmatic check on State 1's HTML: `'No spend is recorded this month yet'` → **absent**;
`'there is nothing recorded to compute a share over yet'` → **absent**. The authoritative shape is
unchanged (re-rendered after restoring the database: "Computed over 100% of this month's spend —
$55.27 … against $0.00 across 0 transactions they could not", no refusal region).

### A second falsehood in the same region, found by the render and also fixed

The two sites named in the finding were the caveat and the refusal's **tail clause**. Rendering the
fix showed the refusal's **leading sentence** is false in the same state:

> "Too much of this month's spend is unaccounted for to read the figures above as a judgement on the
> month."

With `unattributedSpend === 0`, **nothing** is unaccounted for. The bound refuses because it has
nothing to range over, which is a different fact — a refusal that misstates its own cause is the
same defect one clause up. So the whole sentence is now conditional rather than only its tail, which
is what the two quoted refusal strings above reflect. Flagging it as slightly more than the two
sites named, on the grounds that shipping a second falsehood in the region I was blocked for fixing
the first in would not be a defensible reading of the instruction.

**Scratch-database hygiene:** `.env.local` never used; every write reverted; `hidden = TRUE` rows in
the current month → `0`, fabricated rows → `0`.

## 12.2 N56 — the gate widened from one clause to the query's whole predicate set

**Reproduced:** with `a.landscape = 'operational'` bolted onto the `JOIN accounts a ON …` clause
instead of the `WHERE`, the cycle-1 assertion sliced `WHERE`→`GROUP BY` and never saw it —
`Tests 414 passed (414)`, N42 silently returned.

**Fixed inside the same single test**, as directed. A second slice now spans the query's entire
predicate set, `FROM`→`GROUP BY`, which covers the `JOIN … ON` conditions and the `WHERE` clause
together, and the negative assertion runs against that:

```ts
const predicates = sql.slice(sql.indexOf('FROM'), sql.indexOf('GROUP BY'));
…
expect(predicates).not.toContain('a.landscape');
expect(predicates).not.toContain('landscape');
```

The positive assertions still run against the narrower `WHERE` slice, so nothing was weakened. The
bare `'landscape'` line is deliberate: an alias other than `a` would slip past `a.landscape`, and no
correct form of this query mentions the word at all.

**Verified by the mutation that motivated it:**

```
$ # a.landscape = 'operational' appended to the JOIN ... ON clause
 × the coverage aggregation carries its own positive-amount filter, asserted against the query
   source because a predicate living in SQL cannot be reached from the classifier own inputs
AssertionError: expected 'FROM transactions t\n      JOIN accou…' not to contain 'a.landscape'
      Tests  1 failed | 38 passed (39)
$ # restored
      Tests  39 passed (39)
```

This is a modification to a test I added in cycle 1 rather than an addition, made under the explicit
instruction to widen it and keep it a single test. The name set is unchanged by it.

## 12.3 N53 — an exact 95% displayed as 94%

**Reproduced with the stated figures.** $1,052.03 scored against $55.37 unattributed is an exact
19:1 ratio (`55.37 * 19 === 1052.03` is `true`), i.e. exactly 95.000000%. Split across eight groups —
six scored, two unattributed — it computes to `0.9499999999999998`, and a bare floor prints **94**.

**The origin, isolated:** the scored side accumulates exactly (`500 + 200 + 150 + 100 + 60 + 42.03`
is `1052.03` on the nose). The unattributed side does not: `27.68 + 27.69` is
`55.370000000000005`. A denominator five femtocents high is the entire defect.

### Does the fix perturb threshold semantics? **No — and here is precisely what it does and does not touch.**

`coveragePercent` is now `Math.floor(share * 100 + 1e-9)`, wrapped in a helper. **`authoritative` is
untouched**: it still compares the raw `coverageShare` against the raw `COVERAGE_THRESHOLD` with
`>=`, so `0.95` means exactly what it meant before this cycle and no month changes authority as a
result of this fix.

**The consequence, stated rather than left to be discovered.** The two halves now disagree at the
boundary under adverse drift: this month reports **95%** and is still **`authoritative: false`**.
That pairing looks odd and it is *true* — 95% of the spend was seen, and the bound refused on an
imprecision SPEC.md's "Accepted imprecision, stated" pre-accepted. The previous pairing, 94% and
refused, contained a number that was simply **wrong**. I fixed the half the spec left unreasoned and
left the half it settled.

**Making the two agree would change what `0.95` means** — it needs a tolerance on the comparison,
which moves the closed floor to `[0.95 − ε, ∞)`. That is a spec question and I have not settled it.
For completeness: the fix that would need no tolerance anywhere is exact integer-cent accumulation,
and that is **statically forbidden in this module by acceptance #35**, which bans `Math.round(`,
`roundCents(`, `Math.abs(` and `.toFixed(`. So no exact option exists inside the current constraints.

**Why `lib/domain/monthOutlook.ts` had to change**, as asked before doing it: `coveragePercent` is
computed in the domain by SPEC Q3's own decision — *"computed once, in the domain, never on the
page"* — and acceptance #33/#35 gate that placement. The floor cannot be corrected anywhere else
without moving the computation onto the page, which the spec forbids. The change is one helper plus
one named constant; the module's public surface is unchanged.

**The `Math.min(floored, 99)` guard.** Negative control #7 — "100% means complete attribution" —
was previously safe by arithmetic accident. A tolerance makes that accidental, so the guard makes it
structural: `unattributedSpend === 0 ? floored : Math.min(floored, 99)`.

### Verified by mutation, both halves

| Mutation | Result |
|---|---|
| revert the tolerance to a bare `Math.floor(share * 100)` | **KILLED** — `AssertionError: expected 94 to be 95`, `1 failed \| 39 passed (40)` |
| remove the `Math.min` guard (first attempt) | **SURVIVED** — the fixture could not reach it |
| remove the `Math.min` guard (after strengthening the fixture) | **KILLED** — `AssertionError: expected 100 to be 99` |

The middle row is disclosed rather than quietly fixed. My first negative control ($1,000,000 against
one unattributed cent) floors to 99 with or without the guard, so it verified nothing. The guard
only bites where the tolerance would carry a share over the line — measured, that is around **$1e9
scored against $0.01 unattributed**, where `Math.floor(share * 100 + 1e-9)` is exactly `100`. The
fixture now includes that case, so the invariant is verified rather than assumed. Household money
never reaches there, and "100 means every dollar is attributed" is not allowed to depend on that.

## 12.4 Gates after cycle 2

```
$ npx tsc --noEmit   (errors outside the .next/types sync duplicates)
0
$ npx tsc --noEmit 2>&1 | grep -cE "error TS"   (total, incl. sync duplicates)
0

$ npm test
 Test Files  21 passed (21)
      Tests  415 passed (415)
   Start at  18:04:08
   Duration  4.28s (transform 549ms, setup 0ms, import 904ms, tests 4.20s, environment 1ms)

$ npm test 2>&1 | grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"
1

$ npm run lint 2>&1 | tail -2
✖ 1 problem (0 errors, 1 warning)


$ npm run build; echo exit=$?
exit=0

# 20 threshold pinned at 0.95
1
# 21 page never restates it
0
# 35 no banned rounding
0
# 5  test count
40
# 46/47/48/49 scope
0
0
0
0
```

| # | Expected | Measured | |
|---|---|---|---|
| 1 | `exit=0` | `exit=0` | PASS |
| 2 | `1` | `1` (`Tests 415 passed (415)`) | PASS |
| 3 | `✖ 1 problem (0 errors, 1 warning)` | identical | PASS |
| 4 | `exit=0` | `exit=0` | PASS |
| 5 | `-ge 38` | `40` | PASS |
| 20 / 21 / 35 | `1` / `0` / `0` | `1` / `0` / `0` | PASS |
| 46 / 47 / 48 / 49 | all `0` | all `0` | PASS |

Every static row is byte-identical to the passing baseline captured in §5 (`diff` clean).

**Row 1 is `exit=0` again.** The duplicated `.next/types` artifacts I reported at the end of cycle 1
were cleared by this cycle's `npm run build` regenerating the directory; `ls .next/types | grep -c
' [0-9]\.'` is now `0`. I neither deleted nor edited them, so this is the build doing it, not me.

### Name-set diff — additions only

```
before = 39    after = 40

$ comm -23 names.cycle1 names.cycle2      # removals or renames
(empty)

$ comm -13 names.cycle1 names.cycle2      # additions
the boundary under float drift > a month whose spend is an exact nineteen-to-one ratio reports
ninety-five percent rather than the ninety-four its accumulated rounding error would print
```

None of the 39 existing tests was renamed, reordered or deleted. One was modified — the cycle-1
source-assertion test, under the explicit instruction in item 2.
