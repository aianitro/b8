# EVIDENCE — P1-10-zod-contracts

**Implementer.** Written against the frozen `SPEC.md` and the passed `CONTRACT.md`. Every command
below was run by me from the repo root; all output is verbatim, pasted from the run, not retyped.

**Tree at start:** `f958436`. The contract surface (`shared/contracts/*.ts`) and `zod` in
`dependencies` were already committed at that SHA by `ab04f17`, so my diff is the five
`shared/contracts/*.test.ts` files and this bundle. The working tree also carried two
**pre-existing, uncommitted** modifications I did not make and did not touch:
`.claude/hooks/scope-guard.mjs` and `.claude/hooks/scope-guard.test.mts` — the guard test-file
exemption GATES.md records as the owner action that unblocked this dispatch.

**Headline result: 50 of 52 acceptance commands pass. Two fail — #51 and #52 — and they fail for
that pre-existing `.claude/hooks/` change rather than for anything in my diff.** Proof in §6,
including the same command with `.claude/` added to its allow-list returning `0`. I have not routed
around it, committed it, or edited the guard: GATES.md already assigns that amendment to the owner
as its own infrastructure commit, "so it stays out of the task's diff and out of scope commands
#51/#52." It is still uncommitted, so those two commands still object to it.

**Nothing is skipped, and no fixture is asserted by its title alone.** All 28 named fixtures assert
the rule their title claims, at the value representation the database actually produces; §3 names
the subject of each one's assertion so the claim is checkable without reading the diff. Seven
further fixtures, disclosed in §9, cover contract decisions the 28 leave untested.

---

## 1. Rows 1–5 — the whole-repo gates

```
$ npx tsc --noEmit; echo "exit=$?"
exit=0

$ npm test 2>&1 | grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"
1

$ npm run lint 2>&1 | tail -2
✖ 1 problem (0 errors, 1 warning)

$ npm run build > /tmp/p10-build.log 2>&1; echo "exit=$?"
exit=0

$ npm ci > /tmp/p10-ci.log 2>&1; echo "exit=$?"
exit=0
```

| # | Expected | Measured | |
|---|---|---|---|
| 1 | `exit=0` | `exit=0` | PASS |
| 2 | `1` | `1` | PASS |
| 3 | `✖ 1 problem (0 errors, 1 warning)` | identical | PASS |
| 4 | `exit=0` | `exit=0` | PASS |
| 5 | `exit=0` | `exit=0` | PASS |

Row 2's underlying total moved `543 → 578`: the 35 fixtures in `shared/contracts`, nothing skipped.

```
$ npm test 2>&1 | tail -6

 Test Files  33 passed (33)
      Tests  578 passed (578)
   Start at  08:43:01
   Duration  4.94s (transform 987ms, setup 0ms, import 1.84s, tests 4.98s, environment 2ms)
```

Row 3's single warning is the pre-existing `scripts/seed-demo.mjs:457:17`, unchanged:

```
$ npm run lint 2>&1 | tail -6

/Users/andreianpilogov/Documents/b8/app/scripts/seed-demo.mjs
  457:17  warning  'pid' is assigned a value but never used. Allowed unused elements of array destructuring must match /^_/u  @typescript-eslint/no-unused-vars

✖ 1 problem (0 errors, 1 warning)
```

Row 5 was run after the test files were written, and it reinstalls from the lock alone — so `zod`
resolves for these schemas without `@anthropic-ai/sdk`'s or `eslint-config-next`'s transitive graph.
I re-ran rows 1 and 2 afterwards: still `exit=0` and `578 passed`. `npm ci` also created no
duplicated `node_modules` entries this time (`find node_modules -regex '.* 2'` → empty), the
environment defect GATES.md records at G1.

---

## 2. Row 6 and the full `⟨C⟩` verbose output — Evidence #1

```
$ test $(npx vitest run --pool=threads --reporter=verbose shared/contracts 2>&1 | grep -cE "✓") -ge 28 && echo OK
OK

$ npx vitest run --pool=threads --reporter=verbose shared/contracts

 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app

 ✓ shared/contracts/enums.test.ts > LandscapeSchema > an unknown landscape value is rejected rather than admitted as a third, unnamed landscape 1ms
 ✓ shared/contracts/enums.test.ts > ValuationModeSchema > an unknown valuation_mode value is rejected 0ms
 ✓ shared/contracts/enums.test.ts > PropertyTypeSchema and TenantFundKindSchema > both remaining closed vocabularies accept their own values and reject one outside their CHECK constraint 0ms
 ✓ shared/contracts/shapes.test.ts > BudgetCategorySchema > a BudgetCategory row exactly as Postgres and the existing GET /api/categories handler produce it, with annual_budget as the numeric string 1200.00 rather than a JS number, parses successfully 3ms
 ✓ shared/contracts/shapes.test.ts > BudgetCategorySchema > annual_budget as the non-numeric string abc is rejected rather than silently coerced 0ms
 ✓ shared/contracts/shapes.test.ts > BudgetCategorySchema > control_mode accepts all three CHECK-constrained values: fixed, discretionary, and variable-necessary 0ms
 ✓ shared/contracts/shapes.test.ts > BudgetCategorySchema > control_mode rejects variable, the truncated value an implementer reaching for the CHECK constraint from memory could plausibly type instead of variable-necessary 0ms
 ✓ shared/contracts/shapes.test.ts > BudgetCategorySchema > control_mode is required and non-nullable, so a row with control_mode explicitly null is rejected exactly as the NOT NULL column would refuse it 0ms
 ✓ shared/contracts/shapes.test.ts > BudgetCategorySchema > a row missing the control_mode key entirely is rejected, because every real row carries the column 0ms
 ✓ shared/contracts/shapes.test.ts > BudgetCategorySchema > dedicated_account_id null is accepted, because the column is genuinely nullable and every real row carries the key 0ms
 ✓ shared/contracts/shapes.test.ts > BudgetCategorySchema > a row missing the dedicated_account_id key entirely is rejected, because Postgres never omits a selected column 0ms
 ✓ shared/contracts/shapes.test.ts > BudgetCategorySchema > monthly_amounts null is accepted as the no-custom-schedule case 0ms
 ✓ shared/contracts/shapes.test.ts > BudgetCategorySchema > a twelve-element monthly_amounts array of JS numbers, the representation pg's array parser actually produces, is accepted 0ms
 ✓ shared/contracts/shapes.test.ts > BudgetCategorySchema > a twelve-element monthly_amounts array of numeric strings, which pg's array parser never produces, is rejected 0ms
 ✓ shared/contracts/shapes.test.ts > PropertySchema > purchase_price and cost_basis accept a numeric string or null, the same Postgres NUMERIC representation as annual_budget 1ms
 ✓ shared/contracts/shapes.test.ts > TransactionSchema > a transaction amount of a negative numeric string is accepted, because income is negative under this ledger's Plaid-derived sign convention 1ms
 ✓ shared/contracts/shapes.test.ts > TransactionSchema > a transaction amount of a positive numeric string is accepted, because spend is positive under the same convention 0ms
 ✓ shared/contracts/shapes.test.ts > TransactionSchema > merchant_name null is accepted and a row missing the merchant_name key entirely is rejected 0ms
 ✓ shared/contracts/shapes.test.ts > CategoryRuleSchema > a canonical CategoryRule fixture parses 0ms
 ✓ shared/contracts/shapes.test.ts > BudgetSummarySchema > a canonical BudgetSummary fixture with numeric-string money fields parses 0ms
 ✓ shared/contracts/shapes.test.ts > LinkedAccountSummarySchema > a canonical LinkedAccountSummary fixture with null mask and null subtype parses 0ms
 ✓ shared/contracts/shapes.test.ts > AccountSchema > a canonical Account row carries all twelve declared keys, including the null property_id of an account secured against no property, and parses 1ms
 ✓ shared/contracts/envelope.test.ts > the ApiResponse envelope > the success branch success true with a data payload and no error key parses 3ms
 ✓ shared/contracts/envelope.test.ts > the ApiResponse envelope > the error branch success false with a populated error object and no data key parses 1ms
 ✓ shared/contracts/envelope.test.ts > the ApiResponse envelope > success true paired with an error key instead of data is rejected 0ms
 ✓ shared/contracts/envelope.test.ts > the ApiResponse envelope > success false paired with a data key instead of error is rejected 0ms
 ✓ shared/contracts/envelope.test.ts > the ApiResponse envelope > the string true is rejected as a value for success, because only the literal boolean is a valid discriminant 0ms
 ✓ shared/contracts/envelope.test.ts > the ApiResponse envelope > an empty error code is rejected 0ms
 ✓ shared/contracts/envelope.test.ts > the ApiResponse envelope > an envelope carrying both a data and an error key is refused rather than quietly stripped down to something that looks correct 0ms
 ✓ shared/contracts/envelope.test.ts > the ApiResponse envelope > the mutating routes envelope, success true with a data payload of null, parses, while success true with no data key at all is rejected 0ms
 ✓ shared/contracts/representation.test.ts > numericString > rejects NaN, the one NUMERIC value Postgres can store that this contract refuses 1ms
 ✓ shared/contracts/representation.test.ts > numericString > accepts an aggregate printed at more than two decimal places, because the scale is Postgres's and not the validator's 0ms
 ✓ shared/contracts/representation.test.ts > numericArray and timestamptz > a JS Date is rejected where the wire carries an ISO-8601 string, because these schemas describe the payload and not the pg row object 1ms
 ✓ shared/contracts/index.test.ts > the contract surface against shared/types.ts > every exported shape in shared/types.ts other than the response envelope has exactly one corresponding schema in shared/contracts 2ms
 ✓ shared/contracts/index.test.ts > the contract surface against shared/types.ts > the BudgetCategory schema's field set matches shared/types.ts exactly and admits none of budget_categories' extra columns is_debt_service or sort_order 2ms

 Test Files  5 passed (5)
      Tests  35 passed (35)
   Start at  08:43:00
   Duration  324ms (transform 140ms, setup 0ms, import 545ms, tests 23ms, environment 0ms)

```

35 fixtures across five files, `5 passed (5)`, none skipped. `grep -cE "✓"` counts 35 — one line per
fixture, this reporter prints no per-file checkmark — which is `-ge 28`.

---

## 3. Rows 7–34 — the 28 named fixtures, and what each one actually asserts

Each command below was run in full and verbatim (`⟨C⟩ | grep -cF "<title>"`); every one returned
`1`. Titles were extracted programmatically from `SPEC.md`'s own acceptance table rather than
retyped, so a paraphrase was not possible.

The right-hand column is the part that matters for grading, because a title grep cannot see it: the
**subject of the assertion** each fixture carries. Every negative fixture on a row schema asserts
the *issue path*, not merely `success === false` — a row missing `control_mode` and a row with a
typo'd `landscape` both "fail to parse", and a test that checks only the boolean passes for the
wrong reason.

| # | id | Out | File | What it asserts |
|---|---|---|---|---|
| 7 | F1 | `1` | `index.test.ts` | `Object.keys(CONTRACT_SCHEMAS)` equals the exported type/interface names read out of `shared/types.ts`'s **AST**, minus `ApiResponse`; each key holds a distinct `z.ZodType` (so twelve keys cannot share one schema, or hold `undefined`) |
| 8 | F2 | `1` | `shapes.test.ts` | the ten-field wire row with `annual_budget: '1200.00'` parses and the value survives byte-identical; **and** the same row with `annual_budget: 1200` is rejected at path `annual_budget` — the "rather than a JS number" half |
| 9 | F3 | `1` | `shapes.test.ts` | `annual_budget: 'abc'` rejected at path `annual_budget`. A `z.coerce.number()` would have *succeeded* here and yielded `NaN`; the rejection is what "not silently coerced" means |
| 10 | F4 | `1` | `shapes.test.ts` | all three CHECK values parse through `BudgetCategorySchema` and round-trip unchanged. One `it` looping the three, not `it.each`, because `it.each` would emit three interpolated titles and none would match the grep |
| 11 | F5 | `1` | `shapes.test.ts` | `control_mode: 'variable'` rejected at path `control_mode` — the truncated value a schema transcribed from memory produces |
| 12 | F6 | `1` | `shapes.test.ts` | `control_mode: null` rejected at path `control_mode` |
| 13 | F7 | `1` | `shapes.test.ts` | the key removed by destructuring → rejected at path `control_mode` |
| 14 | F8 | `1` | `shapes.test.ts` | `dedicated_account_id: null` parses, stays `null` (not `''`, not dropped from the output), and the key is present in the parsed object; the populated case parses too, so this is not a field that accepts nothing |
| 15 | F9 | `1` | `shapes.test.ts` | the same key *absent* → rejected at path `dedicated_account_id`. F8 and F9 together are the `.nullable()`-vs-`.optional()` control: modelled `.optional()`, both would pass |
| 16 | F10 | `1` | `shapes.test.ts` | `monthly_amounts: null` parses and stays `null` — "spread the annual budget evenly", never twelve zeroes |
| 17 | F11 | `1` | `shapes.test.ts` | a twelve-element array of JS **numbers** parses, round-trips, and every element is `typeof 'number'` |
| 18 | F11b | `1` | `shapes.test.ts` | the same twelve values as `toFixed(2)` **strings** are rejected, and the assertion pins all twelve issue paths `monthly_amounts.0 … monthly_amounts.11` — so the failure is the elements, not a missing field or a length rule |
| 19 | F12 | `1` | `index.test.ts` | `Object.keys(BudgetCategorySchema.shape)` equals `BudgetCategory`'s ten declared fields read from the AST, and contains neither `is_debt_service` nor `sort_order`; plus a `RETURNING *`-shaped payload carrying both is parsed and the extras are **stripped**. Asserted on the declared field set, not on a rejection, per CONTRACT.md — a strict row schema would reject `POST /api/categories`'s live response today |
| 20 | F13 | `1` | `shapes.test.ts` | `purchase_price`/`cost_basis` as numeric strings parse; both as `null` parse; **and** each as a JS number is rejected at its own path — which is what "the same representation as `annual_budget`" has to mean to be falsifiable |
| 21 | F14 | `1` | `shapes.test.ts` | `amount: '-3410.00'` parses and is returned unchanged — an inadvertent `.positive()` would fail here and reject every income row |
| 22 | F15 | `1` | `shapes.test.ts` | `amount: '128.45'` parses; both signs through one schema, neither normalized |
| 23 | F16 | `1` | `shapes.test.ts` | `merchant_name: null` parses and stays `null`; the key absent → rejected at path `merchant_name` |
| 24 | F17 | `1` | `enums.test.ts` | `'hybrid'`, `'Operational'` and `''` rejected; both real values parse; `LandscapeSchema.options` is exactly the two — so the rejection is a closed vocabulary, not a schema that refuses everything |
| 25 | F18 | `1` | `enums.test.ts` | `'market'` and `'Ledger'` rejected; `'ledger'`/`'valuation'` parse; `.options` is exactly those two |
| 26 | F19 | `1` | `envelope.test.ts` | `{ success: true, data: [<a real BudgetCategory row>] }` parses through `apiResponseSchema(z.array(BudgetCategorySchema))`, `Object.keys` is exactly `['success','data']`, and the payload is returned intact — a whole realistic envelope, not the discriminant alone |
| 27 | F20 | `1` | `envelope.test.ts` | `{ success: false, error: { code, message } }` parses through the closed `ApiErrorResponseSchema`, keys exactly `['success','error']`, and through the full union of a route whose success payload is a category array |
| 28 | F21 | `1` | `envelope.test.ts` | `{ success: true, error: {...} }` (no `data`) rejected by the success-branch factory, by the full envelope, and by the mutating-route envelope |
| 29 | F22 | `1` | `envelope.test.ts` | `{ success: false, data: [...] }` rejected by `ApiErrorResponseSchema` and by the full envelope; `{ success: false, data: null }` likewise |
| 30 | F23 | `1` | `envelope.test.ts` | `success: 'true'` rejected on both branches; `1`/`0` rejected too; and `{ data: null }` with no `success` key rejected — literal boolean, never optional, never truthy |
| 31 | F24 | `1` | `envelope.test.ts` | `code: ''` rejected by `ApiErrorSchema` and through the whole error envelope; `message: ''` rejected; and an unused-but-nonempty code still parses, so the code *vocabulary* stays open |
| 32 | F25 | `1` | `shapes.test.ts` | a canonical `CategoryRule` parses and round-trips; a `mapped_category` naming no existing category still parses, since neither name is a foreign key |
| 33 | F26 | `1` | `shapes.test.ts` | all four money fields as numeric strings parse and round-trip; a negative `remaining` (over-spend) parses |
| 34 | F27 | `1` | `shapes.test.ts` | `subtype: null` and `mask: null` both parse, both stay `null`, and the row round-trips |

---

## 4. Rows 35–39 — toolchain and the `zod` dependency, plus Evidence #3

```
$ grep -c "shared/\*\*/\*\.test\.ts" vitest.config.mts
1

$ git diff --name-only HEAD -- vitest.config.mts | wc -l | tr -d ' '
0

$ node -e "const p=require('./package.json'); console.log(Object.prototype.hasOwnProperty.call(p.dependencies,'zod'))"
true

$ grep -cE '"zod":\s*"\^?4\.' package.json
1

$ grep -c '"zod"' package.json
1
```

All five PASS. No toolchain edit was needed: `shared/**/*.test.ts` was already in
`vitest.config.mts`'s include list, which is why five new test files under `shared/contracts/` are
picked up by `npm test` with zero config change.

**Evidence #3 — `npm ls zod --depth=0`, before and after.** The install itself is not in my diff: it
landed in `ab04f17`, before this dispatch, which the parent's brief confirms and instructs me to
verify rather than redo. So the "before" state is no longer runnable, and I am reporting what is
actually checkable rather than staging a fake:

```
$ git show ab04f17^:package.json | grep -c '"zod"'
0

$ npm ls zod --depth=0
app@0.1.0 /Users/andreianpilogov/Documents/b8/app
└── zod@4.6.2
```

Before: `zod` appeared **nowhere** in `package.json` — it resolved only through
`@anthropic-ai/sdk`/`eslint-config-next`. After: a top-level entry, `zod@4.6.2`, and `npm ci` (row 5)
installs it from the lock alone. `4.6.2` satisfies the `^4.` range SPEC.md pins; the spec's
`4.4.3` is the version that happened to be resolved transitively at spec time.

---

## 5. Rows 40–43 — layering and derivation source

```
$ node -e '...forbidden="next/server"...'
0
$ node -e '...forbidden="pg"...'
0
$ node -e '...forbidden="lib/db"...'
0
$ node -e '...forbidden="categoryControl"...'
0
```

All four PASS, run verbatim from `SPEC.md`'s authoritative code block (extracted from the file, not
retyped). These now walk each file's AST for `import`/`export` module specifiers, `require(...)` and
dynamic `import(...)` — so they measure dependencies, not text, which is the G1-D1 correction.

Worth recording, since it changes what these commands cover: they walk **every** `.ts` under
`shared/contracts`, which now includes my five test files. My tests import `vitest`, `zod`,
`node:fs`, `node:url`, `typescript`, and sibling `./` modules — no `pg`, no `@/lib/db`, no
`next/server`, no `lib/categoryControl`. `index.test.ts` deliberately imports `typescript` (a
devDependency) to read `shared/types.ts`'s AST; that is not one of the four forbidden specifiers and
the commands confirm it.

---

## 6. Rows 44–52 — scope, and the two commands that do not pass

```
$ git diff --name-only HEAD -- app/ | wc -l | tr -d ' '
0
$ git diff --name-only HEAD -- components/ lib/ | wc -l | tr -d ' '
0
$ test -d app/api/v1 && echo FAIL || echo OK
OK
$ test -d apps && echo FAIL || echo OK
OK
$ test -d packages && echo FAIL || echo OK
OK
$ grep -c '"workspaces"' package.json
0
$ git diff --name-only HEAD -- migrations/ db/schema.sql | wc -l | tr -d ' '
0
$ git diff --name-only HEAD | grep -vE '^(shared/contracts/|shared/types\.ts|package\.json|package-lock\.json|AGENTS\.md|plan/)' | wc -l | tr -d ' '
2
$ git status --porcelain | grep -vE '^.. (shared/contracts/|shared/types\.ts|package\.json|package-lock\.json|AGENTS\.md|plan/)' | wc -l | tr -d ' '
2
```

| # | Expected | Measured | |
|---|---|---|---|
| 44 | `0` | `0` | PASS |
| 45 | `0` | `0` | PASS |
| 46 | `OK` | `OK` | PASS |
| 47 | `OK` | `OK` | PASS |
| 48 | `OK` | `OK` | PASS |
| 49 | `0` | `0` | PASS |
| 50 | `0` | `0` | PASS |
| 51 | `0` | **`2`** | **FAIL — cause outside this task, see below** |
| 52 | `0` | **`2`** | **FAIL — same two files** |

**What the two are, and that they are not mine.**

```
$ git status --porcelain
 M .claude/hooks/scope-guard.mjs
 M .claude/hooks/scope-guard.test.mts
?? shared/contracts/enums.test.ts
?? shared/contracts/envelope.test.ts
?? shared/contracts/index.test.ts
?? shared/contracts/representation.test.ts
?? shared/contracts/shapes.test.ts

$ git diff --stat HEAD
 .claude/hooks/scope-guard.mjs      | 33 +++++++++++++++++++++++++++++----
 .claude/hooks/scope-guard.test.mts | 21 +++++++++++++++++++++
 2 files changed, 50 insertions(+), 4 deletions(-)
```

My whole diff is the five untracked test files, all of which match the `shared/contracts/`
allow-list. The two modified files are the guard test-file exemption GATES.md's "Owner action"
section prepared and validated — present in the tree when I started, unmodified by me, and the
reason I could write a test beside the module it tests at all.

The discriminating check, the same command with `.claude/` added to its allow-list:

```
$ git diff --name-only HEAD | grep -vE '^(shared/contracts/|shared/types\.ts|package\.json|package-lock\.json|AGENTS\.md|plan/|\.claude/)' | wc -l | tr -d ' '
0
```

`0`. Every out-of-scope path #51 and #52 object to is one of those two files.

I did not commit them, and I did not touch the guard. GATES.md already assigns that amendment to
the owner as its own infrastructure commit, explicitly "so it stays out of the task's diff and out
of scope commands #51/#52" — committing it inside this task's diff would put a safety-mechanism
change under my authorship and inside the surface the reviewer grades, which is the opposite of what
that plan says. **Once those two files are committed (or stashed), #51 and #52 return `0` with no
change to my work.** GATES.md predicted exactly this at G1 cycle 2: "they must be gone before the
implementer is dispatched, or G2 will fail #52 and the implementer will be blamed for it."

---

## 7. Evidence #2 — the measured `pg` representations, both directions

Quoted verbatim from `GATES.md` (G0 cycle 1 and finding D1), which measured them against `b8_demo`
through `lib/db.ts`'s own client with no `setTypeParser` anywhere in that file. Quoted rather than
re-measured on purpose: SPEC.md T6 states that no acceptance command depends on database state, and
re-measuring is the step at which the asymmetry gets got wrong.

**Scalar `NUMERIC` → string:**

```
budget_categories.annual_budget  → "8400.00"      typeof string
transactions.amount              → "-7750.00"     typeof string
properties.purchase_price        → "720000.00"    typeof string
SUM(amount)                      → "-103712.31"   typeof string
```

**`NUMERIC[]` elements → number**, same table, same row, same client:

```
budget_categories.monthly_amounts[i] → 4200        typeof number
```

Why the two rules differ: `pg` registers the scalar parser and the array parser **independently**.
The scalar parser leaves OID 1700 as text so an arbitrary-precision decimal cannot lose digits to a
float; the `numeric[]` parser converts each element before the row reaches application code. This is
a parser asymmetry, not an inconsistency to tidy — making the schemas uniform in either direction
produces one that rejects every real payload of one kind: either every `GET /api/categories`
response, or every category carrying a custom monthly schedule.

My fixtures use the representation each side actually produces. `annual_budget: '1200.00'` (string,
F2) and `monthly_amounts: [80, 80, 100, …]` (numbers, F11), with the reverse controls on both sides:
`annual_budget: 1200` rejected inside F2, and `monthly_amounts` as twelve `toFixed(2)` strings
rejected element-by-element in F11b.

Timestamps are the second representation decision and it shows up in every fixture: `created_at`,
`last_synced_at`, `date` and `purchase_date` are ISO-8601 **strings**, because `pg` hands a handler a
`Date` and `Response.json` is what serializes it. A `new Date()` in a fixture fails `timestamptz`,
correctly — asserted in `representation.test.ts`.

---

## 8. Evidence #4 — the mapping table, one row per `shared/types.ts` export

Twelve shapes plus the envelope. The `Fixtures` column is what makes F1 auditable by a human rather
than only by a key-set comparison.

| `shared/types.ts` export | Schema | File | Fixtures |
|---|---|---|---|
| `Landscape` | `LandscapeSchema` | `enums.ts` | F17; and inside every `BudgetCategory`/`Account` row fixture |
| `ValuationMode` | `ValuationModeSchema` | `enums.ts` | F18; the canonical `Account` row |
| `PropertyType` | `PropertyTypeSchema` | `enums.ts` | F13's row; the extra closed-vocabulary fixture |
| `TenantFundKind` | `TenantFundKindSchema` | `enums.ts` | the extra closed-vocabulary fixture |
| `ControlMode` | `ControlModeSchema` | `enums.ts` | F4, F5, F6, F7 |
| `Property` | `PropertySchema` | `shapes.ts` | F13 |
| `Account` | `AccountSchema` | `shapes.ts` | the canonical twelve-key `Account` fixture (extra) |
| `BudgetCategory` | `BudgetCategorySchema` | `shapes.ts` | F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F11b, F12 |
| `CategoryRule` | `CategoryRuleSchema` | `shapes.ts` | F25 |
| `Transaction` | `TransactionSchema` | `shapes.ts` | F14, F15, F16 |
| `BudgetSummary` | `BudgetSummarySchema` | `shapes.ts` | F26 |
| `LinkedAccountSummary` | `LinkedAccountSummarySchema` | `shapes.ts` | F27 |
| `ApiResponse<T>` | `ApiErrorSchema` + `ApiErrorResponseSchema` + `apiSuccessResponseSchema(T)` + `apiResponseSchema(T)` | `envelope.ts` | F19–F24, plus two extras |

The envelope is the one row that is not a single constant, which is why F1 excludes it and
`CONTRACT_SCHEMAS` omits it: its error branch is closed and complete, its success branch is a
factory a call site pins.

Test files, one per module, per this repo's convention:

| Test file | Fixtures |
|---|---|
| `shared/contracts/index.test.ts` | F1, F12 |
| `shared/contracts/enums.test.ts` | F17, F18, +1 extra |
| `shared/contracts/shapes.test.ts` | F2–F11b, F13–F16, F25–F27, +1 extra |
| `shared/contracts/envelope.test.ts` | F19–F24, +2 extras |
| `shared/contracts/representation.test.ts` | 3 extras |

F12 sits in `index.test.ts` rather than beside the other `BudgetCategory` fixtures for one reason,
recorded in both files: it asserts a correspondence with `shared/types.ts`'s own declaration, which
it reads from that file's AST, and F1 needs the same parse. Splitting it out beat either duplicating
the AST helper or importing one test file from another — the latter re-registers the imported file's
suites and runs every fixture twice, which would make each `grep -cF` count `2` and fail the gate.

---

## 9. Evidence #5 — what a correct implementation cannot satisfy, and everything else I am disclosing

**1. Acceptance #51 and #52 cannot pass while `.claude/hooks/` is dirty, and nothing I am permitted
to do changes that.** Full proof in §6. The cause is a pre-existing uncommitted change that
GATES.md itself assigns to the owner and deliberately excludes from this task's diff. Reported, not
worked around: I did not commit those files, did not stash them, and did not edit the guard. Every
other scope command (#44–#50) is `0`/`OK`.

**2. No other acceptance command is unsatisfiable.** All 50 remaining pass as written, including the
four AST-parsing layering commands that failed G1 cycle 1 in their old grep form.

**3. Seven fixtures beyond SPEC.md's 28, disclosed here so the count is explained.** `⟨C⟩` reports
35. The extras each pin a decision recorded in `CONTRACT.md` that none of the 28 touches, and none
of their titles contains any of the 28 as a substring (checked mechanically — every named title
greps to exactly `1`):

- *(enums)* `PropertyType`/`TenantFundKind` accept their own values and reject one outside the
  CHECK — the two contracted vocabularies no object schema carries yet, which is precisely why an
  untested one would go unnoticed.
- *(shapes)* a canonical twelve-key `Account` row, including `property_id: null` meaning "secured
  against no property", plus proof that `type` stays an open vocabulary.
- *(envelope)* `{ success: true, data, error }` refused rather than stripped — the property
  `z.strictObject` buys over `z.object` on the envelope, and the reason its unknown-key policy
  differs from the row schemas'.
- *(envelope)* `{ success: true, data: null }` parses while `{ success: true }` is rejected — `data`
  required even when its schema is `z.null()`, which is what every mutating route returns.
- *(representation)* `numericString` rejects `NaN` (a legal Postgres NUMERIC this contract refuses
  as a data defect), `''`, `'1,200.00'` and `'1.2e5'`.
- *(representation)* `numericString` accepts more than two decimals, because the scale is Postgres's
  and not the validator's — an aggregate prints at whatever scale it computes.
- *(representation)* a `Date` is rejected where the wire carries an ISO-8601 string, plus
  `numericArray` accepting numbers and rejecting a numeric string at the primitive level.

**4. The contract surface is unmodified.** `git status` shows no change to any
`shared/contracts/*.ts` module, to `shared/types.ts`, to `package.json` or to `package-lock.json`
(`npm ci` restored the lock's tree without rewriting it). I found no defect in the schemas; the
string-vs-number divergence with `shared/types.ts` is stated in three places and every fixture
passed at the representation the contract declares, first run.

**5. The `app/accounts/page.tsx` finding is untouched, as instructed.** `CONTRACT.md` reports that
the page selects eleven of `Account`'s twelve fields while casting to the full type, so a real row
from that query would fail `AccountSchema`'s required-key rule. I did not fix the query, did not
weaken `property_id` to `.optional()`, and wrote no fixture asserting anything about that query. The
canonical `Account` fixture carries all twelve keys, which is what the schema requires and what a
complete SELECT would return. It remains route work for a later task.

**6. One thing I chose that a reviewer should see stated.** The negative row fixtures assert issue
*paths* rather than just `success === false`. That is a stronger assertion than SPEC.md asks for,
and it is the reason I can claim each fixture's subject is its title's subject: `expect(paths)
.toEqual(['control_mode'])` fails if the row was refused for any other field, which is exactly how
a correctly-titled test ends up passing for the wrong reason.
