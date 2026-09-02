# EVIDENCE — P0.5-30-in-month-pacing

**Implementer.** Run at `79c3a42` + this task's working tree. Every command below was executed from
the repo root by me, in this order, and every output is pasted verbatim.

## Verdict

**All 36 acceptance commands pass** (1–35 plus 25a). Nothing is partial, skipped, or hand-waved.
Two things a reviewer should read before the tables, because they are the only places where my
judgement went beyond what the spec dictates:

1. **One guard in the module is not load-bearing and I could not make it so.** Removing
   `withoutNegativeZero` from `projectedVariance` leaves the suite green (mutation **M1e**). The
   other four `-0` normalisations — `actual`, `projected`, `spentRatio`, `projectedRatio` — each go
   red on their own. My reading is that `projectedVariance` cannot reach `-0` at all: a projection
   is emitted only when `budgeted !== 0`, and `x - y` is `+0` whenever `x === y`, so the only
   arrival route (`-0` minus `+0`) is gated out by the status. The spec's "Conventions" section
   names `projectedVariance` among the fields that must be normalised, so I kept the call and am
   reporting the vacuity rather than quietly dropping either the call or the claim. Full detail in
   the mutation section.
2. **Out-of-range `MonthSpend.month` is validated for tracked rows only.** A `capital`,
   `exclude_from_budget` or `is_income` row carrying `month: 12` produces no record and no throw,
   because untracked rows are skipped before their months are resolved. The spec states the
   rejection (Q6) and states separately that untracked rows produce "no record at all" (Q5) without
   saying which wins. I chose "a function has nothing to say about a row it does not report on";
   fixture P13 is a tracked row either way, so no acceptance command discriminates. Flagging it as
   a decision, not smuggling it.

## Files

| File | Change |
|---|---|
| `lib/domain/pacing.ts` | new — 342 lines |
| `lib/domain/pacing.test.ts` | new — 22 tests |
| `lib/domain/adherence.ts` | two `export` keywords and the two comments that called those functions private |

Nothing else. `lib/domain/adherence.test.ts` is byte-identical (#34 = `0`); nothing under `app/`
was opened, let alone edited (#31 = `0`).

## The 36 acceptance commands

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
$ test $(npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 | grep -cE "✓ lib/domain/pacing\.test\.ts") -ge 17 && echo OK
OK
(exit=0)

```

Full lint output for #3, so the single warning can be seen to be the pre-existing one:

```

> app@0.1.0 lint
> eslint


/Users/andreianpilogov/Documents/b8/app/scripts/seed-demo.mjs
  438:17  warning  'pid' is assigned a value but never used. Allowed unused elements of array destructuring must match /^_/u  @typescript-eslint/no-unused-vars

✖ 1 problem (0 errors, 1 warning)

```

The count behind #4 (`grep -cE "✓ lib/domain/pacing\.test\.ts"`) is **22**, against a floor of 17.

### #5–#21 and #35 — the named cases

Each is `npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1` piped to its own `grep -cF`.

```
### 5
$ npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 | grep -cF "the roadmap's own day-8-of-30 sentence computes exactly: a category at 71 percent of its month projects to close at 266.25 percent of its budget, and the projection is not the spend-to-date figure"
1

### 6
$ npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 | grep -cF "the projection floor is inclusive at exactly a quarter of the month elapsed, so day 7 of a 28-day February projects while day 7 of a 30-day April and day 7 of a 29-day leap February do not"
1

### 7
$ npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 | grep -cF "day one of a thirty-day month has a real elapsed fraction of one thirtieth rather than zero, and the projection is withheld as too early rather than multiplied by thirty"
1

### 8
$ npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 | grep -cF "a month that begins after the as-of point has no elapsed fraction and reports a null projection rather than NaN or Infinity, whether its supplied actual is zero or nonzero"
1

### 9
$ npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 | grep -cF "a month that ended before the as-of point is complete, its elapsed fraction is one and its projection is its actual, never the as-of month's fraction applied to it"
1

### 10
$ npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 | grep -cF "off-cycle spend, where a scheduled category draws money in a month its schedule budgeted nothing for, reports a distinct off-cycle status and no percentage of any kind"
1

### 11
$ npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 | grep -cF "a zero-budget month on a category with no schedule at all reports no-budget rather than off-cycle, so money outside its window is distinguishable from money against no window"
1

### 12
$ npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 | grep -cF "a scheduled category is on budget in the month its schedule funds and off-cycle in a month it does not, in one call over one row"
1

### 13
$ npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 | grep -cF "the projection multiplier amplifies a single late-categorized transaction by the reciprocal of the elapsed fraction, so 50 dollars of newly categorized spend at day 8 of 30 moves the projected close by 187.50"
1

### 14
$ npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 | grep -cF "pacing ranges over every tracked category and flags the scored ones, so fixed and variable-necessary lines still report a projection while capital, excluded and income lines report nothing at all"
1

### 15
$ npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 | grep -cF "pacing never invents a month the caller did not supply and returns the supplied months in calendar order whatever order they arrived in"
1

### 16
$ npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 | grep -cF "an as-of day outside the real length of its own month is rejected with a RangeError rather than producing an elapsed fraction of zero or above one"
1

### 17
$ npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 | grep -cF "the leap rule is Gregorian, so February 29 is a valid as-of day in 2024 and rejected in 2026, and 2100 is not a leap year while 2000 is"
1

### 18
$ npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 | grep -cF "a supplied month index outside 0 through 11 is rejected with a RangeError rather than silently substituting the even spread the adherence module substitutes"
1

### 19
$ npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 | grep -cF "a per-month actual that rounds to negative zero is normalized away at every emitted figure, so no surface can print a minus sign on a category that spent nothing"
1

### 20
$ npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 | grep -cF "a negative budgeted amount yields null for both ratios rather than an inverted percentage, while the dollar projection is still reported"
1

### 21
$ npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 | grep -cF "pacing resolves a month's budget through the same budgetedForMonth the adherence module uses, so the two agree on 83.33 for a 1,000 annual budget and the projected ratio carries the rounded denominator"
1

### 35
$ npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 | grep -cF "the elapsed fraction is day-granular, so a category eight days into a thirty-day month is not treated as having spent a whole month the way the dashboard's year pace treats the current month"
1

```

#5, #21 and #35 were additionally re-run as complete live pipelines (vitest → grep, not against a saved capture):

```
$ ... | grep -cF "the roadmap's own day-8-of-30 sentence computes exactly: ..."
1
$ ... | grep -cF "pacing resolves a month's budget through the same budgetedForMonth ..."
1
$ ... | grep -cF "the elapsed fraction is day-granular, ..."
1
```

### #22–#34 — the static and tree-shaped commands

Commands copied from the SPEC's authoritative code block; the shell echo below strips one layer
of backslashes on #25/#25a, so the canonical forms are restated after the output.

```
### 22
$ grep -cE "^import \{[^}]*budgetedForMonth[^}]*\} from './adherence';" lib/domain/pacing.ts
1

### 23
$ grep -cE '/ *(12|MONTHS_PER_YEAR)' lib/domain/pacing.ts
0

### 24
$ grep -cE '^import .*budgetColors' lib/domain/pacing.ts
0

### 25
$ grep -cE 'monthPct\(' lib/domain/pacing.ts
0

### 25a
$ grep -cE '(= |return |: )Infinity' lib/domain/pacing.ts
0

### 26
$ grep -cE 'new Date\(|Date\.now\(' lib/domain/pacing.ts
0

### 27
$ grep -cE '^export function categoryPacing\(rows: AdherenceInput\[\], asOf: AsOf\): CategoryPace\[\] \{' lib/domain/pacing.ts
1

### 28
$ grep -cF "// @ts-expect-error categoryPacing requires an explicit as-of point; there is no clock inside the module" lib/domain/pacing.test.ts
1

### 29
$ grep -cE '^export function budgetedForMonth\(row: AdherenceInput, month: number\): number \{' lib/domain/adherence.ts
1

### 30
$ git diff -U0 HEAD -- lib/domain/adherence.ts | grep -E '^[+-][^+-]' | grep -vE '^[+-][[:space:]]*(//|\*|/\*)' | grep -cvE 'budgetedForMonth|withoutNegativeZero'
0

### 31
$ git diff --name-only HEAD | grep -vE '^(lib/domain/(adherence|pacing)(\.test)?\.ts|plan/)' | wc -l | tr -d ' '
0


### 32
$ git status --porcelain lib/domain/pacing.ts lib/domain/pacing.test.ts | wc -l | tr -d ' '
2


### 33
$ test $(npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cE "✓ lib/domain/adherence\.test\.ts") -eq 47 && echo OK
OK

### 34
$ git diff --stat HEAD -- lib/domain/adherence.test.ts | wc -l | tr -d ' '
0

```

Canonical forms of the two whose echo lost a backslash, re-run:

```sh
grep -cE 'monthPct\(' lib/domain/pacing.ts        # 0
grep -cE '(= |return |: )Infinity' lib/domain/pacing.ts   # 0
```

## The fixture table — P1 through P16, expected against measured

Produced by compiling the two modules with `tsc` into a scratch directory and calling
`categoryPacing` / `daysInMonth` / `detectAdherence` directly, so these figures come from the
shipped code rather than from the test file's own assertions. Every row matches; there is no
`NO` anywhere in the table (`grep -c '| NO |'` over it returns `0`).


**P1** — 6000/yr, no schedule, months [{3, 355}], as-of 2026-04-08
| field | expected | measured | ok |
|---|---|---|---|
| status | projected | projected | yes |
| scored | true | true | yes |
| elapsedDays | 8 | 8 | yes |
| daysInMonth | 30 | 30 | yes |
| elapsedFraction | 0.26666666666666666 | 0.26666666666666666 | yes |
| budgeted | 500 | 500 | yes |
| actual | 355 | 355 | yes |
| spentRatio | 0.71 | 0.71 | yes |
| projected | 1331.25 | 1331.25 | yes |
| projectedVariance | 831.25 | 831.25 | yes |
| projectedRatio | 2.6625 | 2.6625 | yes |

**P2a** — 1200/yr, months [{3, 30}], as-of 2026-04-07 (below the floor)
| field | expected | measured | ok |
|---|---|---|---|
| status | too-early | too-early | yes |
| scored | true | true | yes |
| elapsedDays | 7 | 7 | yes |
| daysInMonth | 30 | 30 | yes |
| elapsedFraction | 0.23333333333333334 | 0.23333333333333334 | yes |
| budgeted | 100 | 100 | yes |
| actual | 30 | 30 | yes |
| spentRatio | 0.3 | 0.3 | yes |
| projected | null | null | yes |
| projectedVariance | null | null | yes |
| projectedRatio | null | null | yes |

**P2b** — 1200/yr, months [{1, 30}], as-of 2026-02-07 (exactly the floor)
| field | expected | measured | ok |
|---|---|---|---|
| status | projected | projected | yes |
| scored | true | true | yes |
| elapsedDays | 7 | 7 | yes |
| daysInMonth | 28 | 28 | yes |
| elapsedFraction | 0.25 | 0.25 | yes |
| budgeted | 100 | 100 | yes |
| actual | 30 | 30 | yes |
| spentRatio | 0.3 | 0.3 | yes |
| projected | 120 | 120 | yes |
| projectedVariance | 20 | 20 | yes |
| projectedRatio | 1.2 | 1.2 | yes |

**P2c** — 1200/yr, months [{1, 30}], as-of 2024-02-07 (leap year, below the floor)
| field | expected | measured | ok |
|---|---|---|---|
| status | too-early | too-early | yes |
| scored | true | true | yes |
| elapsedDays | 7 | 7 | yes |
| daysInMonth | 29 | 29 | yes |
| elapsedFraction | 0.2413793103448276 | 0.2413793103448276 | yes |
| budgeted | 100 | 100 | yes |
| actual | 30 | 30 | yes |
| spentRatio | 0.3 | 0.3 | yes |
| projected | null | null | yes |
| projectedVariance | null | null | yes |
| projectedRatio | null | null | yes |

**P3** — P1 row, as-of 2026-04-01 (day 1 is not a division by zero)
| field | expected | measured | ok |
|---|---|---|---|
| status | too-early | too-early | yes |
| scored | true | true | yes |
| elapsedDays | 1 | 1 | yes |
| daysInMonth | 30 | 30 | yes |
| elapsedFraction | 0.03333333333333333 | 0.03333333333333333 | yes |
| budgeted | 500 | 500 | yes |
| actual | 355 | 355 | yes |
| spentRatio | 0.71 | 0.71 | yes |
| projected | null | null | yes |
| projectedVariance | null | null | yes |
| projectedRatio | null | null | yes |

**P4a** — 1200/yr, months [{11, 0}], as-of 2026-04-08 (future month, zero spend)
| field | expected | measured | ok |
|---|---|---|---|
| status | future | future | yes |
| scored | true | true | yes |
| elapsedDays | 0 | 0 | yes |
| daysInMonth | 31 | 31 | yes |
| elapsedFraction | 0 | 0 | yes |
| budgeted | 100 | 100 | yes |
| actual | 0 | 0 | yes |
| spentRatio | 0 | 0 | yes |
| projected | null | null | yes |
| projectedVariance | null | null | yes |
| projectedRatio | null | null | yes |

**P4b** — same, months [{11, 250}] (future month, pre-authorised charge)
| field | expected | measured | ok |
|---|---|---|---|
| status | future | future | yes |
| scored | true | true | yes |
| elapsedDays | 0 | 0 | yes |
| daysInMonth | 31 | 31 | yes |
| elapsedFraction | 0 | 0 | yes |
| budgeted | 100 | 100 | yes |
| actual | 250 | 250 | yes |
| spentRatio | 2.5 | 2.5 | yes |
| projected | null | null | yes |
| projectedVariance | null | null | yes |
| projectedRatio | null | null | yes |

**P5** — 1200/yr, months [{0, 143}], as-of 2026-04-08 (completed month)
| field | expected | measured | ok |
|---|---|---|---|
| status | complete | complete | yes |
| scored | true | true | yes |
| elapsedDays | 31 | 31 | yes |
| daysInMonth | 31 | 31 | yes |
| elapsedFraction | 1 | 1 | yes |
| budgeted | 100 | 100 | yes |
| actual | 143 | 143 | yes |
| spentRatio | 1.43 | 1.43 | yes |
| projected | 143 | 143 | yes |
| projectedVariance | 43 | 43 | yes |
| projectedRatio | 1.43 | 1.43 | yes |

**P6a** — March-only schedule, month 2 (the month the schedule funds)
| field | expected | measured | ok |
|---|---|---|---|
| status | complete | complete | yes |
| scored | true | true | yes |
| elapsedDays | 31 | 31 | yes |
| daysInMonth | 31 | 31 | yes |
| elapsedFraction | 1 | 1 | yes |
| budgeted | 1200 | 1200 | yes |
| actual | 1150 | 1150 | yes |
| spentRatio | 0.9583333333333334 | 0.9583333333333334 | yes |
| projected | 1150 | 1150 | yes |
| projectedVariance | -50 | -50 | yes |
| projectedRatio | 0.9583333333333334 | 0.9583333333333334 | yes |

**P6b** — same row, month 3 (outside its window)
| field | expected | measured | ok |
|---|---|---|---|
| status | off-cycle | off-cycle | yes |
| scored | true | true | yes |
| elapsedDays | 8 | 8 | yes |
| daysInMonth | 30 | 30 | yes |
| elapsedFraction | 0.26666666666666666 | 0.26666666666666666 | yes |
| budgeted | 0 | 0 | yes |
| actual | 275 | 275 | yes |
| spentRatio | null | null | yes |
| projected | null | null | yes |
| projectedVariance | null | null | yes |
| projectedRatio | null | null | yes |

**P7a** — annual_budget 0, no schedule, months [{3, 275}]
| field | expected | measured | ok |
|---|---|---|---|
| status | no-budget | no-budget | yes |
| scored | true | true | yes |
| elapsedDays | 8 | 8 | yes |
| daysInMonth | 30 | 30 | yes |
| elapsedFraction | 0.26666666666666666 | 0.26666666666666666 | yes |
| budgeted | 0 | 0 | yes |
| actual | 275 | 275 | yes |
| spentRatio | null | null | yes |
| projected | null | null | yes |
| projectedVariance | null | null | yes |
| projectedRatio | null | null | yes |

**P7b** — March-only schedule, months [{3, 0}] (scheduled $0 with no spend)
| field | expected | measured | ok |
|---|---|---|---|
| status | no-budget | no-budget | yes |
| scored | true | true | yes |
| elapsedDays | 8 | 8 | yes |
| daysInMonth | 30 | 30 | yes |
| elapsedFraction | 0.26666666666666666 | 0.26666666666666666 | yes |
| budgeted | 0 | 0 | yes |
| actual | 0 | 0 | yes |
| spentRatio | null | null | yes |
| projected | null | null | yes |
| projectedVariance | null | null | yes |
| projectedRatio | null | null | yes |

**P8** — the same row differing by one $50 transaction, as-of 2026-04-08
| quantity | expected | measured | ok |
|---|---|---|---|
| run A projected | 1331.25 | 1331.25 | yes |
| run B projected | 1518.75 | 1518.75 | yes |
| actualB − actualA | 50 | 50 | yes |
| projectedB − projectedA | 187.5 | 187.5 | yes |

**P9** — six categories, one supplied month each
| quantity | expected | measured | ok |
|---|---|---|---|
| categoryIds emitted | 1,2,3 | 1,2,3 | yes |
| length | 3 | 3 | yes |
| scored flags | true,false,false | true,false,false | yes |
| statuses | projected×3 | projected,projected,projected | yes |

**P10** — months supplied out of order
| quantity | expected | measured | ok |
|---|---|---|---|
| months emitted | 0,3,11 | 0,3,11 | yes |
| length | 3 | 3 | yes |
| statuses | complete,projected,future | complete,projected,future | yes |

**P11** — as-of points that are not real days (over the P1 row)
| as-of | expected | measured |
|---|---|---|
| {2026, 3, 0} | RangeError | RangeError |
| {2026, 3, 31} | RangeError | RangeError |
| {2026, 1, 29} | RangeError | RangeError |
| {2026, 12, 1} | RangeError | RangeError |
| {2026, -1, 1} | RangeError | RangeError |
| {2026, 3, 8.5} | RangeError | RangeError |
| {2026, 3, 30} | no throw | no throw |

**P12** — the Gregorian leap rule
| call | expected | measured |
|---|---|---|
| categoryPacing(row, {2024, 1, 29}) | no throw, daysInMonth 29 | no throw, daysInMonth 29 |
| categoryPacing(row, {2026, 1, 29}) | RangeError | RangeError |
| daysInMonth(2100, 1) | 28 | 28 |
| daysInMonth(2000, 1) | 29 | 29 |
| daysInMonth(2026, 1) | 28 | 28 |
| daysInMonth(2024, 1) | 29 | 29 |
| daysInMonth(2026, 3) | 30 | 30 |
| daysInMonth(2026, 0) | 31 | 31 |

**P13** — a supplied month index of 12
| quantity | expected | measured |
|---|---|---|
| categoryPacing | RangeError | RangeError: daysInMonth: month must be an integer 0-11 (0 = January), got 12 |
| detectAdherence budgeted / variance / ratio | 100 / 1050 / 11.5 | 100 / 1050 / 11.5 |

**P14** — a per-month actual of -0.001
| field | expected | measured | Object.is(v, -0) |
|---|---|---|---|
| actual | 0 | 0 | false |
| projected | 0 | 0 | false |
| spentRatio | 0 | 0 | false |
| projectedRatio | 0 | 0 | false |
| projectedVariance | -500 | -500 | false |

**P15** — annual_budget -1200, months [{3, 50}], as-of 2026-04-08
| field | expected | measured | ok |
|---|---|---|---|
| status | projected | projected | yes |
| scored | true | true | yes |
| elapsedDays | 8 | 8 | yes |
| daysInMonth | 30 | 30 | yes |
| elapsedFraction | 0.26666666666666666 | 0.26666666666666666 | yes |
| budgeted | -100 | -100 | yes |
| actual | 50 | 50 | yes |
| spentRatio | null | null | yes |
| projected | 187.5 | 187.5 | yes |
| projectedVariance | 287.5 | 287.5 | yes |
| projectedRatio | null | null | yes |

**P16** — annual_budget 1000, months [{0, 200}], as-of 2026-04-08
| field | expected | measured | ok |
|---|---|---|---|
| status | complete | complete | yes |
| scored | true | true | yes |
| elapsedDays | 31 | 31 | yes |
| daysInMonth | 31 | 31 | yes |
| elapsedFraction | 1 | 1 | yes |
| budgeted | 83.33 | 83.33 | yes |
| actual | 200 | 200 | yes |
| spentRatio | 2.4000960038401535 | 2.4000960038401535 | yes |
| projected | 200 | 200 | yes |
| projectedVariance | 116.67 | 116.67 | yes |
| projectedRatio | 2.4000960038401535 | 2.4000960038401535 | yes |

detectAdherence over the same row reports budgeted = 83.33; pace.budgeted = 83.33; identical: true
projectedRatio 2.4000960038401535 vs unrounded-denominator 2.4000000000000004 vs cent-rounded 2.4

## The worked rendering of §5's sentence, run as a command

The P1 record printed as JSON, then the English sentence it licenses, produced from that record
with formatting only — `toLocaleString` for the dollars and `toFixed` for the percents. No
arithmetic of any kind happens in the renderer: every number in the sentence, including "day 8
of 30", is a field on the record.

```
=== The worked rendering of §5's sentence, from the module output alone ===

{
  "categoryId": 1,
  "category": "Dining Out (fabricated)",
  "scored": true,
  "month": 3,
  "elapsedDays": 8,
  "daysInMonth": 30,
  "elapsedFraction": 0.26666666666666666,
  "budgeted": 500,
  "actual": 355,
  "spentRatio": 0.71,
  "projected": 1331.25,
  "projectedVariance": 831.25,
  "projectedRatio": 2.6625,
  "status": "projected"
}

Rendered with formatting only — no arithmetic beyond toFixed and a percent sign:

  "as of day 8 of 30, Dining Out is at 71.00% of its month, projected to close at $1,331.25, which is 266.25% of its $500.00 budget — $831.25 over."

=== The floor, as numbers: the same April row at day 1, day 7 and day 8 ===

```

## The intra-month honesty decision, before and after

The same April row at day 1, day 7 and day 8, with the projection each day *would* have produced
if the floor were removed. The spread between the first and the last row is the argument for the
floor, stated as numbers: on day 1 a floorless module announces a **$10,650** April for a
category that has drawn $355 against a $500 budget.

```
=== The floor, as numbers: the same April row at day 1, day 7 and day 8 ===

day | status     | elapsedFraction        | projected | projection WITHOUT the floor
  1 | too-early  | 0.03333333333333333    | null      | 10650
  7 | too-early  | 0.23333333333333334    | null      | 1521.43
  8 | projected  | 0.26666666666666666    | 1331.25   | 1331.25
```

## Mutation testing — is each guard actually load-bearing?

Method: restore `lib/domain/pacing.ts` from a pristine copy, apply exactly one edit, run
`npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts`, record the summary
line and every red test, restore. Eighteen mutations, seventeen caught. The script is
`mutate.py` in the session scratchpad; the file was verified byte-identical afterwards
(`sha256` = `365f1f1a16d22711a1c5d14f0b99eb74793625441df17ea0c6ebb6688243bd3d` before and after).

| # | mutation | suite result | tests that went red |
|---|---|---|---|
| M1a | -0 normalisation on `actual` | `Tests 1 failed \| 21 passed (22)` | `a per-month actual that rounds to negative zero is normalized away at every emit…` |
| M1b | -0 normalisation on `spentRatio` | `Tests 1 failed \| 21 passed (22)` | `a per-month actual that rounds to negative zero is normalized away at every emit…` |
| M1c | -0 normalisation on `projected` | `Tests 1 failed \| 21 passed (22)` | `a per-month actual that rounds to negative zero is normalized away at every emit…` |
| M1d | -0 normalisation on `projectedRatio` | `Tests 1 failed \| 21 passed (22)` | `a per-month actual that rounds to negative zero is normalized away at every emit…` |
| M1e | -0 normalisation on `projectedVariance` | `Tests 22 passed (22)` | **none — the suite stays green** |
| M2 | floor made exclusive (>= becomes >) | `Tests 1 failed \| 21 passed (22)` | `the projection floor is inclusive at exactly a quarter of the month elapsed, so …` |
| M3 | floor removed entirely (every in-month record projects) | `Tests 2 failed \| 20 passed (22)` | `the projection floor is inclusive at exactly a quarter of the month elapsed, so …`<br>`day one of a thirty-day month has a real elapsed fraction of one thirtieth rathe…` |
| M4 | as-of validation removed (assertRealAsOf call deleted) | `Tests 3 failed \| 19 passed (22)` | `an as-of day outside the real length of its own month is rejected with a RangeEr…`<br>`validates the as-of point before any row is read, so an impossible day is reject…`<br>`the leap rule is Gregorian, so February 29 is a valid as-of day in 2024 and reje…` |
| M5 | supplied-month validation removed (daysInMonth accepts any index) | `Tests 3 failed \| 19 passed (22)` | `an as-of day outside the real length of its own month is rejected with a RangeEr…`<br>`a supplied month index outside 0 through 11 is rejected with a RangeError rather…`<br>`returns the real length of every month of a non-leap year, and rejects a month i…` |
| M6 | ratio denominator un-rounded (even spread recomputed in place) | `Tests 2 failed \| 20 passed (22)` | `a scheduled category is on budget in the month its schedule funds and off-cycle …`<br>`pacing resolves a month's budget through the same budgetedForMonth the adherence…` |
| M7 | ratio cent-rounded like money | `Tests 3 failed \| 19 passed (22)` | `the roadmap's own day-8-of-30 sentence computes exactly: a category at 71 percen…`<br>`a scheduled category is on budget in the month its schedule funds and off-cycle …`<br>`pacing resolves a month's budget through the same budgetedForMonth the adherence…` |
| M8 | variance sign reversed (budgeted - projected) | `Tests 7 failed \| 15 passed (22)` | `the roadmap's own day-8-of-30 sentence computes exactly: a category at 71 percen…`<br>`the projection floor is inclusive at exactly a quarter of the month elapsed, so …`<br>`a month that ended before the as-of point is complete, its elapsed fraction is o…`<br>`a scheduled category is on budget in the month its schedule funds and off-cycle …`<br>`a per-month actual that rounds to negative zero is normalized away at every emit…`<br>`a negative budgeted amount yields null for both ratios rather than an inverted p…`<br>`pacing resolves a month's budget through the same budgetedForMonth the adherence…` |
| M9 | elapsed day made 0-based | `Tests 9 failed \| 13 passed (22)` | `the roadmap's own day-8-of-30 sentence computes exactly: a category at 71 percen…`<br>`the elapsed fraction is day-granular, so a category eight days into a thirty-day…`<br>`the projection floor is inclusive at exactly a quarter of the month elapsed, so …`<br>`day one of a thirty-day month has a real elapsed fraction of one thirtieth rathe…`<br>`the projection multiplier amplifies a single late-categorized transaction by the…`<br>`pacing ranges over every tracked category and flags the scored ones, so fixed an…`<br>`pacing never invents a month the caller did not supply and returns the supplied …`<br>`a per-month actual that rounds to negative zero is normalized away at every emit…`<br>`a negative budgeted amount yields null for both ratios rather than an inverted p…` |
| M10 | elapsed fraction made month-granular (dashboard convention) | `Tests 7 failed \| 15 passed (22)` | `the roadmap's own day-8-of-30 sentence computes exactly: a category at 71 percen…`<br>`the elapsed fraction is day-granular, so a category eight days into a thirty-day…`<br>`the projection floor is inclusive at exactly a quarter of the month elapsed, so …`<br>`day one of a thirty-day month has a real elapsed fraction of one thirtieth rathe…`<br>`the projection multiplier amplifies a single late-categorized transaction by the…`<br>`pacing ranges over every tracked category and flags the scored ones, so fixed an…`<br>`a negative budgeted amount yields null for both ratios rather than an inverted p…` |
| M11 | off-cycle collapsed into no-budget | `Tests 2 failed \| 20 passed (22)` | `off-cycle spend, where a scheduled category draws money in a month its schedule …`<br>`a scheduled category is on budget in the month its schedule funds and off-cycle …` |
| M12 | range gate narrowed to the scored set | `Tests 1 failed \| 21 passed (22)` | `pacing ranges over every tracked category and flags the scored ones, so fixed an…` |
| M13 | February hardcoded to 28 days (leap rule dropped) | `Tests 2 failed \| 20 passed (22)` | `the projection floor is inclusive at exactly a quarter of the month elapsed, so …`<br>`the leap rule is Gregorian, so February 29 is a valid as-of day in 2024 and reje…` |
| M14 | completed month projected at the as-of month's fraction | `Tests 3 failed \| 19 passed (22)` | `a month that ended before the as-of point is complete, its elapsed fraction is o…`<br>`a scheduled category is on budget in the month its schedule funds and off-cycle …`<br>`pacing resolves a month's budget through the same budgetedForMonth the adherence…` |

### The one gap, stated plainly

**M1e — `withoutNegativeZero` on `projectedVariance` can be removed with the suite still green.**
This is a gate gap and I would rather report it than have G3 find it. My analysis of why no
fixture reaches it: `projectedVariance` is emitted only for statuses `complete` and `projected`,
both of which require `budgeted !== 0`; `roundCents(projected - budgeted)` is `-0` only if the
subtraction itself yields `-0` or a value in `(-0.005, 0)`; IEEE-754 gives `+0` for `x - x`, and
both operands are already cent-quantized so their difference is either exactly zero or at least
a cent in magnitude. The one arrival route that would produce `-0` — a `-0` projection minus a
`+0` budget — is exactly the case the `budgeted === 0` status branches intercept first. So the
call is defensive rather than load-bearing. I left it in because the spec's Conventions section
names `projectedVariance` among the fields that must be normalised, and removing it would make
the module disagree with its own spec on a reading a future edit could easily invalidate; but
the suite does not currently prove it does anything, and no fixture I could construct makes it.
The other four normalisations are each independently gated, which is why `actual` is kept
**un-normalised** inside `paceForMonth` and normalised only at the emission points — normalising
it at the source would have made M1b/M1c/M1d vacuous, which is the P0.5-29a failure repeated.

## The intra-month uniformity assumption, in my own words

The projection is spend-to-date divided by the fraction of the month that has elapsed, which is the
same as asserting that the rest of the month will spend at the rate the first part of it did — that
spend is spread uniformly across the days of the month. Nothing in this repo underwrites that.
`monthly_amounts` constrains a month's **total** and says nothing whatever about the curve inside
it, so §5's "schedule-aware, not a naive days-elapsed line" is honoured at month granularity, by the
imported `budgetedForMonth`, and is simply not available within the month. The demo data has a clean
counterexample: **Property Tax**, budgeted $14,400 a year, draws its entire monthly activity on a
single day — `scripts/seed-demo.mjs` posts $620 (Kestrel Court) and $480 (Sandpiper Bay) on day 10
of every month and nothing on any other day. Before day 10 its spend-to-date is $0 and the module
projects a $0 close for a category that will draw $1,100. On day 10 itself, spend-to-date is $1,100
and the projection is $1,100 ÷ (10/30) = **$3,300**, three times the truth, and it stays wrong,
decreasing monotonically, for the rest of the month. The day the projection for Property Tax first
tells the truth is therefore the **last day of the month** — day 30 or 31, where `elapsedFraction`
reaches 1 and the record turns `complete`, at which point the projection is the actual and is not
really a projection at all. `PROJECTION_MIN_ELAPSED` does not fix this; it only removes the days
where the multiplier is most violent. That is the honest scope of the floor: it bounds the size of
the error, not its existence, and it is why every record carries `elapsedDays`, `daysInMonth` and
`elapsedFraction` so no surface can print the projection without the basis it rests on. A category
whose spend genuinely is diffuse — `Dining Out`, which the seed posts every three days — is the case
the projection is honest about, and it is not an accident that §5's own example is that one.

## The adherence module: hash, diff, and its 47 tests

```
$ git show HEAD:lib/domain/adherence.ts | shasum -a 256
c3c9f47cc8581773cd98213abffde92ae7f16c3ac9f5b210f0b5765de7ac65b1  -
$ shasum -a 256 lib/domain/adherence.ts
c6b76a43889599dedd95991da088cf96a24f1b2e292ef3c34af8e8200caa2dc8  lib/domain/adherence.ts
```

The hash necessarily changes — the task's whole edit to this file is two `export` keywords.
What must not change is any function body, which is what #30 measures mechanically (`0`) and
what the diff below shows by inspection:

```diff
diff --git a/lib/domain/adherence.ts b/lib/domain/adherence.ts
index eda72a3..5b26a5c 100644
--- a/lib/domain/adherence.ts
+++ b/lib/domain/adherence.ts
@@ -295,10 +295,14 @@ export function isTrackedCategory(category: ScorableCategory): boolean {
  * function taking `monthly_amounts: number[] | null` cannot dodge deciding what a null schedule
  * means either way. Stated here rather than left implicit.
  *
- * Deliberately private: exporting it would be an invitation to make this the fifth even-spread
- * implementation's home without doing the migration.
+ * Exported for exactly one consumer — `./pacing`, which must resolve a month's budget to the same
+ * cent this module does or the two disagree at the fifth decimal on a $1,000 annual budget. That is
+ * the narrow reason, and it is not the wider one this comment used to disclaim: exporting it is
+ * still NOT an invitation to make this the fifth even-spread implementation's home without doing
+ * the migration. The grid, the grid client's label, the budget page and the chat route keep their
+ * own copies until someone migrates them deliberately.
  */
-function budgetedForMonth(row: AdherenceInput, month: number): number {
+export function budgetedForMonth(row: AdherenceInput, month: number): number {
   const schedule = row.monthly_amounts;
   if (schedule && schedule.length === MONTHS_PER_YEAR && month >= 0 && month < MONTHS_PER_YEAR) {
     return roundCents(schedule[month]);
@@ -350,8 +354,12 @@ function monthVariances(row: AdherenceInput): MonthVariance[] {
  * for a month of flawless adherence is "-0.0% under" — a minus sign that means nothing, attached to
  * the one figure whose sign is load-bearing. `Object.is` is the only way to see the difference, so
  * it is normalised here rather than left for every renderer to remember.
+ *
+ * Exported alongside `budgetedForMonth` for `./pacing`, which reaches `-0` on more paths than this
+ * module does — a projection divides spend by a fraction, and `-0` survives every division on the
+ * way. One definition of "not a sign", imported, rather than a second `n === 0 ? 0 : n` next door.
  */
-function withoutNegativeZero(n: number): number {
+export function withoutNegativeZero(n: number): number {
   return n === 0 ? 0 : n;
 }
 
```

`lib/domain/adherence.test.ts` is untouched:

```
$ git diff --stat HEAD -- lib/domain/adherence.test.ts | wc -l | tr -d ' '
0
$ shasum -a 256 lib/domain/adherence.test.ts
42ef375223f3290b050562e9fa3d4e2a9bd183a66819570feb98ad8473b8b059  lib/domain/adherence.test.ts
$ git show HEAD:lib/domain/adherence.test.ts | shasum -a 256
42ef375223f3290b050562e9fa3d4e2a9bd183a66819570feb98ad8473b8b059  -
```

### Full verbose listing — `lib/domain/adherence.test.ts` (47 passing, none skipped)

```

 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app

 ✓ lib/domain/adherence.test.ts > isScoredCategory > includes an operational, non-excluded, non-income category classified discretionary in the scored set 1ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > excludes a fixed category from the scored set even though it is operational, not excluded, and not income 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > excludes a variable-necessary category from the scored set — tracked and reported, never scored, same as fixed 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > excludes a capital-landscape category from the scored set even when its control_mode is discretionary 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > excludes an exclude_from_budget category from the scored set even when its control_mode is discretionary 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > excludes an is_income category from the scored set even when its control_mode is discretionary 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > treats the two non-discretionary modes identically rather than ranking them 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > stays out when more than one conjunct fails at once 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > accepts a whole BudgetCategory row, so no caller needs a local shape for it 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > excludes a row whose control_mode is absent, the shape an out-of-contract SELECT produces at runtime 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > excludes a row whose control_mode is an unrecognized string, rather than reading anything not-fixed as scored 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > excludes a row whose exclude_from_budget arrives null, rather than reading a missing flag as not-excluded 0ms
 ✓ lib/domain/adherence.test.ts > isScoredCategory > excludes a row whose is_income arrives undefined, rather than reading a missing flag as not-income 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a month where actual spend exceeds its budgeted amount produces a breach finding for that month 1ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a month at or under its budgeted amount never produces a breach finding 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a month with zero budgeted amount and nonzero spend produces a breach finding without computing a spend-to-budget ratio 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > spend under 50% of budget in every qualifying month of a window of at least three such months produces a single chronic-underspend defect finding for that category 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a single lean month never produces a defect finding on its own — chronic underspend requires at least three qualifying months of data 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > one on-budget or over-budget month among otherwise-lean months breaks the chronic streak and no defect finding is produced 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a month with zero budgeted amount is excluded from the chronic-underspend window entirely, whether or not it has spend, rather than being read as either perfectly adhered or fully underspent 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a fixed category with sustained overspend produces a breach finding marked not scored 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a fixed category with chronic underspend produces a defect finding marked not scored — a wrong fixed budget line is still a wrong budget 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a variable-necessary category with chronic underspend produces a defect finding marked not scored, tracked the same as fixed rather than as a softer case of it 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a discretionary category with chronic underspend produces a defect finding marked scored 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a capital-landscape category never produces a finding of either kind, regardless of variance, even when its control_mode is discretionary 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > an exclude_from_budget category never produces a finding of either kind, regardless of variance 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > an is_income category never produces a finding of either kind, regardless of variance 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > one category with sustained overspend and one category with chronic underspend at the roadmap's own 24%-of-budget shape produce a breach finding and a defect finding respectively in the same input, and lib/budgetColors.ts's expenseCellStyle renders every one of the chronically-under category's months as an on-budget green shade 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > an explicit monthly_amounts schedule is used verbatim for each month's budgeted amount, even when it disagrees with annual_budget divided by twelve 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > a null monthly_amounts schedule falls back to annual_budget divided by twelve, rounded to cents, as every month's budgeted amount 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > variance is rounded to cents at each month rather than left to accumulate as float dust across a window 0ms
 ✓ lib/domain/adherence.test.ts > detectAdherence > orders a category findings by calendar month whatever order the caller supplied them in 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > the scored-set headline is null, not zero or NaN, when no category in the input belongs to the scored set 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > perfect adherence across the scored categories produces a real headline at variance zero rather than null, and the ratio is positive zero so no surface can print minus zero percent 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > per-month variances that cancel to negative float dust report a positive-zero headline variance, so a run that nets out to nothing cannot print minus zero either 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > reports null for the variance ratio, inside a real headline, when the scored categories supplied months budgeted nothing in total 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > the headline ranges over every supplied month of every scored category, so a category that drew 1,100 against 1,199.88 budgeted reads 8.3 percent under and not 10 percent over 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > an evenly divisible annual budget gives the same position at exactly minus one twelfth, so the corrected headline does not depend on the per-month rounding residue 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > breachCount and defectCount stay finding-scoped while budgeted, actual and variance range over the scored categories supplied months, and the headline reports how many categories it measured 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > no aggregate adds a month-scale breach magnitude to a window-scale defect magnitude, so the denominator is the scored categories own months and never the sum of their findings budgets 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > a category over budget and a category under budget produce headline variance ratios of opposite sign, so over and under are read from the sign rather than re-derived by a renderer 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > categories outside the scored set never move the headline, however extreme their variance 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > the headline never invents a month the caller did not supply, so a scored category with three supplied months of a twelve-month budget is measured over exactly those three 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > a scored category with no supplied months yields a real headline at zero budgeted with a null variance ratio, not a null headline and not a zero percentage 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > the headline denominator is the rounded per-month schedule, so a 1,000 annual budget with no schedule totals 999.96 and the ratio is computed from the rounded totals 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > the headline counts agree with the scored findings detectAdherence returns over the same rows 0ms
 ✓ lib/domain/adherence.test.ts > scoredHeadline > scoredHeadline takes the same AdherenceInput array detectAdherence takes, and a finding array no longer typechecks 0ms

 Test Files  1 passed (1)
      Tests  47 passed (47)
   Start at  08:29:59
   Duration  106ms (transform 30ms, setup 0ms, import 40ms, tests 7ms, environment 0ms)

```

### Full verbose listing — `lib/domain/pacing.test.ts` (22 passing, none skipped)

```

 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app

 ✓ lib/domain/pacing.test.ts > categoryPacing > the roadmap's own day-8-of-30 sentence computes exactly: a category at 71 percent of its month projects to close at 266.25 percent of its budget, and the projection is not the spend-to-date figure 2ms
 ✓ lib/domain/pacing.test.ts > categoryPacing > the elapsed fraction is day-granular, so a category eight days into a thirty-day month is not treated as having spent a whole month the way the dashboard's year pace treats the current month 0ms
 ✓ lib/domain/pacing.test.ts > categoryPacing > the projection floor is inclusive at exactly a quarter of the month elapsed, so day 7 of a 28-day February projects while day 7 of a 30-day April and day 7 of a 29-day leap February do not 0ms
 ✓ lib/domain/pacing.test.ts > categoryPacing > day one of a thirty-day month has a real elapsed fraction of one thirtieth rather than zero, and the projection is withheld as too early rather than multiplied by thirty 0ms
 ✓ lib/domain/pacing.test.ts > categoryPacing > a month that begins after the as-of point has no elapsed fraction and reports a null projection rather than NaN or Infinity, whether its supplied actual is zero or nonzero 0ms
 ✓ lib/domain/pacing.test.ts > categoryPacing > a month that ended before the as-of point is complete, its elapsed fraction is one and its projection is its actual, never the as-of month's fraction applied to it 0ms
 ✓ lib/domain/pacing.test.ts > categoryPacing > off-cycle spend, where a scheduled category draws money in a month its schedule budgeted nothing for, reports a distinct off-cycle status and no percentage of any kind 0ms
 ✓ lib/domain/pacing.test.ts > categoryPacing > a zero-budget month on a category with no schedule at all reports no-budget rather than off-cycle, so money outside its window is distinguishable from money against no window 0ms
 ✓ lib/domain/pacing.test.ts > categoryPacing > a scheduled category is on budget in the month its schedule funds and off-cycle in a month it does not, in one call over one row 0ms
 ✓ lib/domain/pacing.test.ts > categoryPacing > the projection multiplier amplifies a single late-categorized transaction by the reciprocal of the elapsed fraction, so 50 dollars of newly categorized spend at day 8 of 30 moves the projected close by 187.50 0ms
 ✓ lib/domain/pacing.test.ts > categoryPacing > pacing ranges over every tracked category and flags the scored ones, so fixed and variable-necessary lines still report a projection while capital, excluded and income lines report nothing at all 0ms
 ✓ lib/domain/pacing.test.ts > categoryPacing > pacing never invents a month the caller did not supply and returns the supplied months in calendar order whatever order they arrived in 0ms
 ✓ lib/domain/pacing.test.ts > categoryPacing > an as-of day outside the real length of its own month is rejected with a RangeError rather than producing an elapsed fraction of zero or above one 0ms
 ✓ lib/domain/pacing.test.ts > categoryPacing > a supplied month index outside 0 through 11 is rejected with a RangeError rather than silently substituting the even spread the adherence module substitutes 0ms
 ✓ lib/domain/pacing.test.ts > categoryPacing > a per-month actual that rounds to negative zero is normalized away at every emitted figure, so no surface can print a minus sign on a category that spent nothing 0ms
 ✓ lib/domain/pacing.test.ts > categoryPacing > a negative budgeted amount yields null for both ratios rather than an inverted percentage, while the dollar projection is still reported 0ms
 ✓ lib/domain/pacing.test.ts > categoryPacing > pacing resolves a month's budget through the same budgetedForMonth the adherence module uses, so the two agree on 83.33 for a 1,000 annual budget and the projected ratio carries the rounded denominator 0ms
 ✓ lib/domain/pacing.test.ts > categoryPacing > returns an empty array rather than null for an empty input, a wholly untracked input, and a tracked row with no supplied months 0ms
 ✓ lib/domain/pacing.test.ts > categoryPacing > validates the as-of point before any row is read, so an impossible day is rejected even for an input that would produce no records 0ms
 ✓ lib/domain/pacing.test.ts > categoryPacing > requires an explicit as-of point rather than defaulting to a clock read 0ms
 ✓ lib/domain/pacing.test.ts > daysInMonth > the leap rule is Gregorian, so February 29 is a valid as-of day in 2024 and rejected in 2026, and 2100 is not a leap year while 2000 is 0ms
 ✓ lib/domain/pacing.test.ts > daysInMonth > returns the real length of every month of a non-leap year, and rejects a month index that is not a month 0ms

 Test Files  1 passed (1)
      Tests  22 passed (22)
   Start at  08:26:12
   Duration  109ms (transform 30ms, setup 0ms, import 38ms, tests 7ms, environment 0ms)```

## Findings — things a reviewer should decide on, not things I decided

None of these blocked implementation, and none of them contradicts the frozen spec. They are
reported because the spec says a defect in it is a finding for the orchestrator rather than a
decision for me.

1. **The `projectedVariance` `-0` normalisation is unreachable** (M1e above). Either the spec's
   Conventions list is one field too long, or there is an arrival route I could not find. My
   analysis says the former; the code currently satisfies the spec's letter with a call the suite
   cannot prove does anything.

2. **A future month with spend reports a real `spentRatio`.** Fixture P4's second row —
   `{ month: 11, actual: 250 }` against a $100/month budget, as of April — comes out with
   `status: 'future'`, `projected: null`, and **`spentRatio: 2.5`**. That follows exactly from the
   spec's stated rule (`spentRatio` is null iff `budgeted <= 0`, and it is a fact about money rather
   than about time), and the spec pins the zero-spend variant's `spentRatio: 0` without addressing
   this one. It is nevertheless a rendering hazard for step 31: "250% of December" is true and reads
   as a breach for a month that has not begun. Flagged for step 31's spec, not changed here.

3. **`daysInMonth` validates its own arguments.** The spec exports it and pins only valid inputs.
   I made it throw `RangeError` for a non-integer year, and for a month index outside 0–11, rather
   than returning `undefined` from the lookup table — which is also the mechanism by which an
   out-of-range `MonthSpend.month` is rejected (Q6). Covered by a test; mutation M5 confirms it is
   load-bearing.

4. **N18 (duplicate `month` entries) is carried forward untouched, as instructed, and the
   projection multiplies it too.** Two entries for the same month produce two `CategoryPace`
   records, each with the full month's budget. No test pins this, because the spec explicitly
   carries the debt rather than closing it; restating it here so step 31's caller contract does not
   rediscover it.

5. **The A2 divergence is recorded in the suite, per the spec.** The test named at acceptance #18
   asserts both halves: `categoryPacing` throws `RangeError` on `month: 12`, and `detectAdherence`
   over the identical row still returns its silent even-spread substitution (`budgeted: 100`,
   `variance: 1050`, `ratio: 11.5`). If the adversarial reviewer rules the divergence unacceptable,
   that test is where the ruling lands, and it will go red rather than pass quietly.

6. **§5's "187% over" remains arithmetically inconsistent** with its own "71% at day 8 of 30", as
   G0 recorded. The suite pins `projectedRatio not.toBeCloseTo(2.87, 2)` per the spec, so the
   roadmap's prose and the module's arithmetic are explicitly on the record as disagreeing. The
   roadmap line is the owner's to reword.

---

# G3 cycle 1 — N31: the status ladder's precedence is now gated

**Block accepted; both rungs were reachable, so this is real coverage rather than an honest
"unreachable" statement.** The gap was exactly as described: no fixture in the original 22 supplied
a month that is **both** outside the as-of month **and** zero-budgeted, so `off-cycle`/`no-budget`
were never observed competing with `future`/`complete`. My 18-mutation table missed the axis — it
mutated each rung's *condition* but never their *order*, and order is the one property a ladder has
that its individual rungs do not.

## What was added

Two tests in `lib/domain/pacing.test.ts`, placed immediately after the existing no-budget case.
`lib/domain/pacing.ts` was not opened; its sha256 is unchanged.

| rung | fixture | correct today | what a reordered ladder reports instead |
|---|---|---|---|
| money-over-future | March-only schedule, `months: [{ month: 11, actual: 250 }]`, as of April 8 | `status: 'off-cycle'`, `budgeted: 0`, `actual: 250`, all four money ratios `null`, `elapsedDays: 0`, `elapsedFraction: 0` | `status: 'future'` — a $250 breach filed as a month that has not started |
| money-over-complete | no schedule, `annual_budget: 0`, `months: [{ month: 0, actual: 143 }]`, as of April 8 | `status: 'no-budget'`, `budgeted: 0`, `actual: 143`, all four money ratios `null`, `elapsedDays: 31`, `elapsedFraction: 1` | `status: 'complete'` with `projected: 143` and `projectedVariance: 143` — a projection and a variance against a budget that does not exist |

Both tests assert the money fields alongside the status, and both assert the elapsed fields too, so
they state that a money status does **not** suppress the time facts — which is the property that
makes the precedence safe to have in the first place.

## Per-rung mutation results

Method as before: restore `lib/domain/pacing.ts` from the pristine copy, apply one edit to the
status ladder, run `tsc --noEmit` and the pacing suite, restore. The reordering is type-valid in
every case, which is the point — nothing but a test can see it.

| # | mutation to `pacing.ts`'s status ladder | tsc | suite result | tests that went red |
|---|---|---|---|---|
| N31a | the whole ladder reordered: both calendar statuses ahead of both money statuses (the coordinator's mutation) | `exit=0` | `Tests 2 failed \| 22 passed (24)` | `off-cycle spend keeps its status in a month that has not begun, so a p…`<br>`a zero-budget month that has already ended reports no-budget rather th…` |
| N31b | rung 1 only: `future` moved ahead of `off-cycle`/`no-budget`, `complete` left where it is | `exit=0` | `Tests 1 failed \| 23 passed (24)` | `off-cycle spend keeps its status in a month that has not begun, so a p…` |
| N31c | rung 2 only: `complete` moved ahead of `no-budget`, `off-cycle` left first | `exit=0` | `Tests 1 failed \| 23 passed (24)` | `a zero-budget month that has already ended reports no-budget rather th…` |

Each rung is independently gated: **N31b** reddens only the off-cycle-vs-future test, **N31c** only
the no-budget-vs-complete test, and **N31a** — your mutation, both calendar statuses hoisted above
both money statuses — reddens both and nothing else. Before this change N31a was green on all 22
tests with `tsc exit=0`, which is what made it a gate gap rather than a latent bug.

The assertion text under N31a:

```
      Tests  2 failed | 22 passed (24)
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  lib/domain/pacing.test.ts > categoryPacing > off-cycle spend keeps its status in a month that has not begun, so a pre-authorised charge against a zero-budget month is a breach rather than a month with nothing in it yet
AssertionError: expected 'future' to be 'off-cycle' // Object.is equality
 FAIL  lib/domain/pacing.test.ts > categoryPacing > a zero-budget month that has already ended reports no-budget rather than complete, so a month with no baseline never acquires a projection by having finished
AssertionError: expected 'complete' to be 'no-budget' // Object.is equality
```

`lib/domain/pacing.ts` was verified byte-identical after every mutation run:
`sha256 = 365f1f1a16d22711a1c5d14f0b99eb74793625441df17ea0c6ebb6688243bd3d`.

## Re-run of the commands you named

```
### 1
$ npx tsc --noEmit; echo "exit=$?"
exit=0

### 2
$ npm test 2>&1 | grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"
1

    (whole-suite summary, for the record:)
      Tests  369 passed (369)
   Start at  13:27:31
   Duration  4.39s (transform 546ms, setup 0ms, import 845ms, tests 4.32s, environment 1ms)


### 4
$ test $(npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 | grep -cE "✓ lib/domain/pacing\.test\.ts") -ge 17 && echo OK
OK
    (the count itself:)
24

### 30
$ git diff -U0 HEAD -- lib/domain/adherence.ts | grep -E '^[+-][^+-]' | grep -vE '^[+-][[:space:]]*(//|\*|/\*)' | grep -cvE 'budgetedForMonth|withoutNegativeZero'
0

### 31
$ git diff --name-only HEAD | grep -vE '^(lib/domain/(adherence|pacing)(\.test)?\.ts|plan/)' | wc -l | tr -d ' '
0


### 32
$ git status --porcelain lib/domain/pacing.ts lib/domain/pacing.test.ts | wc -l | tr -d ' '
2


### 33
$ test $(npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 | grep -cE "✓ lib/domain/adherence\.test\.ts") -eq 47 && echo OK
OK

### 34
$ git diff --stat HEAD -- lib/domain/adherence.test.ts | wc -l | tr -d ' '
0

### hashes
$ shasum -a 256 lib/domain/pacing.ts lib/domain/adherence.ts lib/domain/adherence.test.ts
365f1f1a16d22711a1c5d14f0b99eb74793625441df17ea0c6ebb6688243bd3d  lib/domain/pacing.ts
c6b76a43889599dedd95991da088cf96a24f1b2e292ef3c34af8e8200caa2dc8  lib/domain/adherence.ts
42ef375223f3290b050562e9fa3d4e2a9bd183a66819570feb98ad8473b8b059  lib/domain/adherence.test.ts
```

`Tests 369 passed (369)` (367 + 2), acceptance #4's count is **24**, and #30/#31/#32/#33/#34 are
unchanged at `0` / `0` / `2` / `OK` / `0`. The 18 name-gated commands (#5–#21, #35) were re-checked
against the new verbose output and all still return `1`.

## The name-set diff — additions only

```
$ diff <(old names, sorted) <(new names, sorted)
7a8
> ✓ lib/domain/pacing.test.ts > categoryPacing > a zero-budget month that has already ended reports no-budget rather than complete, so a month with no baseline never acquires a projection by having finished
9a11
> ✓ lib/domain/pacing.test.ts > categoryPacing > off-cycle spend keeps its status in a month that has not begun, so a pre-authorised charge against a zero-budget month is a breach rather than a month with nothing in it yet

old: 22 names   new: 24 names
```

No existing test was renamed, reordered in content, or otherwise modified — the diff is two added
lines and nothing else.

## One correction to my own earlier evidence

The "Findings" item 1 above and the M1e discussion said the `withoutNegativeZero` call on
`projectedVariance` is unreachable, and gave the status ladder as the reason. That reasoning stands
and you have now confirmed it by execution; I am leaving both the guard and the disclosure exactly
as written. Worth recording the connection N31 makes visible, though: **the ladder's precedence is
what makes that guard unreachable.** Reorder it so `complete` precedes `no-budget` and a
zero-budgeted month starts projecting — at which point `roundCents((-0) - 0)` is reachable and the
M1e mutation would go red rather than green. The two findings are the same fact seen from two
sides, and the two tests added here are what now pin it.
