# P1-10-zod-contracts — the domain shapes get one runtime-checked definition each, and the envelope's discriminant is provably enforceable without waiting for the routes that adopt it

**Roadmap item:** ROADMAP.md §5 Phase 1, step 10 — "zod contracts in `shared/contracts/`". Orchestrator's reading: `plan/tasks/P1-10-zod-contracts/ITEM.md`, which splits the roadmap line into three changes and scopes this task to the first only.
**Status:** DRAFT
**Author:** spec-writer

## Goal

`shared/contracts/` gains one importable zod schema for every shape `shared/types.ts` currently exports — the five closed-vocabulary types (`Landscape`, `ValuationMode`, `PropertyType`, `TenantFundKind`, `ControlMode`) and the seven object shapes (`Property`, `Account`, `BudgetCategory`, `CategoryRule`, `Transaction`, `BudgetSummary`, `LinkedAccountSummary`) — plus a closed, non-generic schema for the error branch of `ApiResponse<T>`. Each schema is derived from **domain truth** — `shared/types.ts`'s declared shape and `db/schema.sql`'s `NOT NULL`/`CHECK` constraints — never from what any single `app/api/**/route.ts` handler currently happens to accept or return. `zod` becomes a direct, pinned `dependencies` entry instead of a transitive resolution nobody declared.

This is the load-bearing finding the spec exists to name: **`shared/types.ts` already lies about the runtime type of every scalar field backed by a Postgres `NUMERIC` column.** `budget_categories.annual_budget` is `NUMERIC(12,2)`; `lib/db.ts` registers no custom type parser; `pg`'s documented default behavior for OID 1700 (`NUMERIC`) is to return it as a **string**, not a JS number, specifically to avoid float precision loss on money. Measured directly against `b8_demo` through `pg`, with no `setTypeParser` anywhere in `lib/db.ts`: `annual_budget → "8400.00"` (string), `transactions.amount → "-7750.00"` (string), `properties.purchase_price → "720000.00"` (string), `SUM(amount) → "-103712.31"` (string). `GET /api/categories` selects `annual_budget` unconverted and returns it through `Response.json({..., data: result.rows} satisfies ApiResponse<BudgetCategory[]>)` — so the wire value for a field `shared/types.ts` declares `annual_budget: number` is, in every real response today, a string. This is corroborated in the running code: `components/CategoryManager.tsx` already wraps every read of `c.annual_budget` in `Number(...)` (six call sites), and `app/budget/page.tsx` does the identical thing to `ytd_spent`, `annual_budget`, and `monthly_reference` (`BudgetSummary`'s fields, sourced from the same kind of `NUMERIC`/`SUM(NUMERIC)` columns) — defensive code written *because* the type is already wrong at the boundary, which is exactly what the comment on `BudgetCategory.control_mode` in `shared/types.ts` warns about generally: "these rows arrive through an unchecked `db.query<BudgetCategory>()` cast, nothing at runtime would contradict the lie." A schema that transcribes `annual_budget: number` into `z.number()` would be a plausible-looking translation that rejects every real payload the one route that already ships this type produces. This is the awkwardness the task exists to resolve, generalized beyond the one field ITEM.md named (`control_mode`) to the property class it belongs to (any *scalar* `NUMERIC`-backed field reached without an explicit SQL cast).

**The same mechanism does not extend to arrays, and the spec states this explicitly because a uniform generalization would silently reproduce the defect it exists to prevent.** `pg`'s scalar and array type parsers are independently registered and are *not* symmetric: measured against the same table, same client, `budget_categories.monthly_amounts[i] → 4200` with `typeof === 'number'`. `pg`'s array parser for `numeric[]` converts each element to a JS number; the scalar `NUMERIC` parser deliberately does not. So the numeric-string rule above applies to `Property.purchase_price`/`cost_basis` and to `Transaction.amount` (all scalar `NUMERIC` columns) — it does **not** apply to `BudgetCategory.monthly_amounts`'s elements, which arrive as JS numbers. A schema author who applies the scalar rule "for consistency" to the array case would produce a schema that rejects every `BudgetCategory` row that actually has a custom monthly schedule — the same class of defect as requiring `z.number()` on the scalar case, in the opposite direction. See Conventions, which states the split as a named parser asymmetry so it is not "corrected" into uniformity later.

The second decision this spec is required to make (ITEM.md's open question) is what must be observably true of `ApiResponse<T>`'s envelope. **Decided:** the envelope's two branches are asymmetric and are treated accordingly. The error branch — `{ success: false; error: { code: string; message: string } }` — has no type parameter, so nothing prevents it from being one closed, fully-specified zod schema, and this spec requires that it be one. The success branch — `{ success: true; data: T }` — is generic over 12 different `T`s; this spec does **not** require a single generic `ApiResponseSchema<T>` factory to exist (that is a design choice left to the guardian), but it does require that the **discriminant itself** — `success` as a literal boolean, never a truthy string, never optional, never coexisting with the other branch's key — be mechanically enforceable and mechanically tested against a realistic full envelope. That is the negative control the parent task explicitly demanded in place of "leave it as a TypeScript type for now": routes still validate their payloads, proven by tests that construct exactly the two envelope shapes every route already returns and reject the shapes none of them may.

Third, `shared/types.ts` stays the compiled, importable surface every one of its 61 current consumers already depends on. This spec does not require `shared/types.ts` to be rewritten as inferred re-exports of the new schemas (ITEM.md notes that as the guardian's *expected* shape, not this spec's mandate) — it requires only that every name `shared/types.ts` exports today continues to be exported with an assignable shape, checked the only way that is actually falsifiable at this granularity: `npx tsc --noEmit` across the whole repository, unchanged in exit code.

## Non-goals

- **No npm workspaces conversion.** No `apps/web`, no `apps/mobile`, no `packages/contracts`, no `"workspaces"` field in `package.json`. Verified absent today (Glob); must remain absent (acceptance #47–#49).
- **No `/api/v1/*` route migration and no proxying.** No `app/api/v1/**` directory, no change to any existing route's URL, no route reading from or writing through `shared/contracts` yet. Wiring validation into a live handler — even at its existing path, even for just one route — is explicitly out of scope: it is the first slice of a 27-handler migration that ITEM.md assigns to a successor task, and this task's diff touching `app/api/**` at all is a scope violation, not a helpful head start (acceptance #44, #46).
- **No migration and no `db/schema.sql` change.** This task adds a runtime validator for shapes the database already constrains; it does not change what the database accepts. If implementation discovers it needs one, that is scope drift back into steps 11–13 and must be reported, not absorbed (acceptance #50).
- **No new business rule invented for a field the database and the application do not already, consistently enforce.** Concretely: `budget_categories.annual_budget` has no `CHECK (annual_budget >= 0)` in `db/schema.sql`, and `POST /api/categories` does not enforce non-negativity either (only `PATCH`'s `annual_budget` branch does) — this spec therefore does **not** require the schema to reject a negative `annual_budget`, because doing so would encode a rule that is not actually true of the data today, which is the same "transcribe an incomplete picture as the specification" failure ITEM.md names for `control_mode`, just in the opposite direction (inventing a constraint nobody enforces, rather than omitting one the database does).
- **No change to `lib/`, `components/`, or any file under `app/`.** The contract surface is additive and self-contained; nothing outside `shared/` and `package.json`/`package-lock.json` may change (acceptance #44–#45).
- **No component-test toolchain, no change to `vitest.config.mts`.** `shared/**/*.test.ts` is already in its `include` list — verified in the file today — so no toolchain change is needed or permitted (acceptance #35–#36).
- **No schema for a shape not currently exported by `shared/types.ts`.** This task does not invent per-route request/response DTOs (e.g. `POST /api/accounts`'s ad hoc body shape, which is not one of `shared/types.ts`'s named exports) — that enumeration belongs to the route migration this task explicitly excludes.

## Contracts touched

| File | Change | Class (§9.2) |
|---|---|---|
| `shared/contracts/**` | new: one zod schema per `shared/types.ts` export listed in the Goal, plus a closed schema for `ApiResponse`'s error branch | additive |
| `shared/types.ts` | no required change to its public export surface; the guardian may edit declarations to derive from `shared/contracts` (e.g. via `z.infer`) at its discretion, provided every existing export name and shape remains assignable to all 61 current importers | additive, or comment/doc-only if untouched |
| `package.json` | `"zod"` added to `dependencies` (not `devDependencies`) at a range compatible with the version already resolved (`4.4.3`) | additive (new direct dependency) |
| `package-lock.json` | reflects the above, via `npm install` only | additive, generated |
| `migrations/*`, `db/schema.sql` | none | — |

No migration exists in this diff, so G1's "migrate up/down/up clean" checklist item is satisfied **vacuously** — stated here so the gate does not treat an absent migration as an unanswered box.

## Conventions this task must honor

- **Sign.** `Transaction.amount` keeps this ledger's Plaid-derived convention — positive is money out, negative is income — unchanged, unstated by `shared/types.ts` itself but established repo-wide (`plan/tasks/P0.5-32-coverage-bound/SPEC.md` §Q2). The schema for `amount` must accept **both** signs; a schema requiring `amount > 0` would reject every income row and is a defect this spec names explicitly (Negative control #8).
- **Rounding.** No schema in this task rounds anything. A zod schema is a validator, not a computation — it accepts or rejects the value it is handed at the representation Postgres and `Response.json` actually produce; it never reformats or re-rounds a money figure.
- **Numeric representation — the central decision of this task, and it is two rules, not one.** `pg` registers separate, asymmetric parsers for a scalar type and its array form:
  - **Scalar `NUMERIC` arrives as a string.** Every field backed by a Postgres `NUMERIC` column, read through `db.query<T>()` with no explicit `::text`/`::float` cast in its SQL, arrives at the JSON boundary as a **numeric-format string** (or `null`, if the column is nullable) — never a bare JS number. Measured live for `BudgetCategory.annual_budget`, `Transaction.amount`, and `Property.purchase_price`/`cost_basis` (see Goal). Every schema for such a field must accept the numeric-string representation; none may accept `z.number()` as the *only* valid representation.
  - **`NUMERIC[]` elements arrive as numbers.** `pg`'s array parser for `numeric[]` converts each element to a JS number before the row reaches application code — measured live for `BudgetCategory.monthly_amounts`. This is a **parser asymmetry**, not an inconsistency to "fix": the scalar and array parsers are registered independently inside `pg`, and this spec's schemas must reflect the asymmetry exactly as `pg` produces it, not correct it toward false uniformity. `monthly_amounts`'s schema must accept an array of JS numbers (or `null`) and must **reject** an array of numeric strings — the representation `pg` never produces for this column, and the representation an implementer would produce by applying the scalar rule to the array case out of habit.
- **Landscape + exclusions.** `Landscape`, `exclude_from_budget`, `is_income`, and `control_mode` are four independently-required, non-overlapping classifications on `BudgetCategory` (`db/schema.sql`'s own comment states this explicitly) — the schema must require **all four** as independent fields with no field's presence implying another's value, and must not collapse any two into one.
- **Null semantics.** Two distinct states, and a schema conflating them is the defect class this task exists to prevent:
  - A column that is genuinely nullable (`Property.address`, `Account.subtype`/`bank`/`last_synced_at`/`property_id`, `BudgetCategory.dedicated_account_id`/`monthly_amounts`, `Transaction.name`/`merchant_name`/`plaid_category`/`mapped_category`, `LinkedAccountSummary.subtype`/`mask`) must be modeled `.nullable()` **and required** (the key is never absent — Postgres always returns every selected column, `null` valued or not). A schema that models these as `.optional()` instead of `.nullable()` cannot distinguish "this row genuinely has no value" from "something upstream silently dropped the key," which is precisely the "nullable means unknown, and consumers must be able to tell" rule from `BUILD.md` §5.3, now applied to the schema layer instead of just the SQL layer.
  - `BudgetCategory.control_mode` is the repo's own stated, deliberate exception: `NOT NULL DEFAULT 'fixed'`, never nullable, "at worst mis-decided, never absent" (the column's own comment in `db/schema.sql`). Its schema must reject both `null` and a missing key — the opposite requirement from every other field in this list, and the reason it gets its own negative controls below.
- **Derivation source, stated as a rule because ITEM.md names its violation by name.** No schema's accepted-value set may be derived by reading what a single route handler's `if`/`else` chain currently accepts or what a route-adjacent helper module (e.g. `lib/categoryControl.ts`) currently exports — only from `shared/types.ts`'s declared type and `db/schema.sql`'s `NOT NULL`/`CHECK` constraints. `PATCH /api/categories`'s acceptance of `control_mode` was, at the time ITEM.md was written, narrower than the database's own three-value truth; it has since been fixed to accept all three, but the methodological point stands independent of that fix and is enforced structurally: `shared/contracts` must import nothing from `@/lib/db` or from `lib/categoryControl.ts` (acceptance #42–#43).
- **Layering.** `shared/contracts` is a pure validation module, the same class as `lib/domain/`: no `db.query`, no `NextRequest`/`NextResponse`, no `fetch`, no `pg` import (acceptance #40–#41).

## Toolchain prerequisites

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `vitest` runs `shared/**/*.test.ts` in `environment: 'node'`, no DB, no network | **yes** | already configured (`vitest.config.mts` line 14) | `grep -c "shared/\*\*/\*\.test\.ts" vitest.config.mts` | `1` today, unchanged |
| T2 | `typescript` resolves the repo's `@/` paths for `npx tsc --noEmit` | **yes** | `tsconfig.json`, already present | `npx tsc --noEmit; echo "exit=$?"` | `exit=0` |
| T3 | `zod` resolves in `node_modules` at `4.4.3`, today only as a transitive/`devOptional` dependency of `@anthropic-ai/sdk` and `eslint-config-next` — not a direct dependency | **yes** | already resolved; `npm install zod@^4.4.3` makes it direct | `node -e "console.log(require('zod/package.json').version)"` | `4.4.3` |
| T4 | `git` with `HEAD` at the merged `categories/control-mode-write-path` commit, for the scope commands | **yes** | working tree | `git rev-parse --short HEAD` | `f808acc` |
| T5 | a throwaway Postgres, for G1's migrate up/down/up | **NO** | n/a | n/a — no migration exists in this diff (see Contracts touched) | vacuous, stated at G1 rather than left ambiguous |
| T6 | a database of any kind, for the acceptance commands below | **NO** | n/a | n/a — every acceptance command is a pure `vitest` test, a `grep`, or a compiler/build check | no fixture in this spec depends on dev-database state; the pg-parser measurements in the Goal section are evidence gathered once at spec time, not a runtime dependency of any command below |
| T7 | `nodemailer`/`node-pg-migrate`/other existing dependencies remain resolvable after adding `zod` to `dependencies` | **yes** | `npm install` regenerates `package-lock.json` in place | `npm ci > /tmp/p10-ci.log 2>&1; echo "exit=$?"` | `exit=0` |

## Acceptance commands

`⟨C⟩` abbreviates `npx vitest run --pool=threads --reporter=verbose shared/contracts 2>&1`. All commands run from the repo root. **52 acceptance commands total (#1–#52).**

> **Pipe-escaping convention.** Inside a Markdown table cell `\|` renders as one literal `|`, which inside an ERE is a **literal pipe, not alternation**. Every regex-bearing command is repeated verbatim and unescaped in the code block below the table, and that block is authoritative if the two disagree.
>
> **Why #40–#43 use `grep -rl … | wc -l` and not `grep -rc`.** `grep -rc PATTERN DIR` does not emit one aggregate count: today, with `shared/contracts` absent, it exits `2` with no matching output; once the directory exists with more than one file, it emits one `path:count` line **per file** (verified against `grep -rc "import" lib/domain`, which returns four such lines) — neither form ever reads as a single `0`. `grep -rl PATTERN DIR | wc -l | tr -d ' '` lists matching *paths* and lets `wc -l` count them, which is `0` whether the directory is absent, empty, or populated with no match — the one shape that behaves correctly both before and after this task creates the directory.
>
> **No command below pins a code shape.** Presence is `-ge 1`; absence is `0`; every exact count is either a fixed, small, hand-countable set (e.g. "28 named fixtures") or a scope command counting file paths, never "this function must be written this way."

| # | Command | Expected |
|---|---|---|
| 1 | `npx tsc --noEmit; echo "exit=$?"` | `exit=0` (T2) — every one of the 61 existing `shared/types.ts` importers still compiles |
| 2 | `npm test 2>&1 \| grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"` | `1` — whole repo green, nothing skipped |
| 3 | `npm run lint 2>&1 \| tail -2` | `✖ 1 problem (0 errors, 1 warning)` — the pre-existing `scripts/seed-demo.mjs:457:17` warning and no other |
| 4 | `npm run build > /tmp/p10-build.log 2>&1; echo "exit=$?"` | `exit=0` |
| 5 | `npm ci > /tmp/p10-ci.log 2>&1; echo "exit=$?"` | `exit=0` (T7) — `zod` resolves from a clean install without relying on `@anthropic-ai/sdk`'s or `eslint-config-next`'s transitive graph |
| 6 | `test $(⟨C⟩ \| grep -cE "✓") -ge 28 && echo OK` | `OK` — the 28 named fixtures below (F1–F11, F11b, F12–F27). `0` today — the directory does not exist |
| 7 | `⟨C⟩ \| grep -cF "every exported shape in shared/types.ts other than the response envelope has exactly one corresponding schema in shared/contracts"` | `1` — **F1** |
| 8 | `⟨C⟩ \| grep -cF "a BudgetCategory row exactly as Postgres and the existing GET /api/categories handler produce it, with annual_budget as the numeric string 1200.00 rather than a JS number, parses successfully"` | `1` — **F2, the flagship scalar numeric-string proof** |
| 9 | `⟨C⟩ \| grep -cF "annual_budget as the non-numeric string abc is rejected rather than silently coerced"` | `1` — **F3** |
| 10 | `⟨C⟩ \| grep -cF "control_mode accepts all three CHECK-constrained values: fixed, discretionary, and variable-necessary"` | `1` — **F4** |
| 11 | `⟨C⟩ \| grep -cF "control_mode rejects variable, the truncated value an implementer reaching for the CHECK constraint from memory could plausibly type instead of variable-necessary"` | `1` — **F5, the derivation-source control** |
| 12 | `⟨C⟩ \| grep -cF "control_mode is required and non-nullable, so a row with control_mode explicitly null is rejected exactly as the NOT NULL column would refuse it"` | `1` — **F6** |
| 13 | `⟨C⟩ \| grep -cF "a row missing the control_mode key entirely is rejected, because every real row carries the column"` | `1` — **F7** |
| 14 | `⟨C⟩ \| grep -cF "dedicated_account_id null is accepted, because the column is genuinely nullable and every real row carries the key"` | `1` — **F8** |
| 15 | `⟨C⟩ \| grep -cF "a row missing the dedicated_account_id key entirely is rejected, because Postgres never omits a selected column"` | `1` — **F9, nullable vs. optional** |
| 16 | `⟨C⟩ \| grep -cF "monthly_amounts null is accepted as the no-custom-schedule case"` | `1` — **F10** |
| 17 | `⟨C⟩ \| grep -cF "a twelve-element monthly_amounts array of JS numbers, the representation pg's array parser actually produces, is accepted"` | `1` — **F11, corrected to the measured representation** |
| 18 | `⟨C⟩ \| grep -cF "a twelve-element monthly_amounts array of numeric strings, which pg's array parser never produces, is rejected"` | `1` — **F11b, the new reverse control for the array/scalar asymmetry** |
| 19 | `⟨C⟩ \| grep -cF "the BudgetCategory schema's field set matches shared/types.ts exactly and admits none of budget_categories' extra columns is_debt_service or sort_order"` | `1` — **F12, table-vs-type control** |
| 20 | `⟨C⟩ \| grep -cF "purchase_price and cost_basis accept a numeric string or null, the same Postgres NUMERIC representation as annual_budget"` | `1` — **F13** |
| 21 | `⟨C⟩ \| grep -cF "a transaction amount of a negative numeric string is accepted, because income is negative under this ledger's Plaid-derived sign convention"` | `1` — **F14, sign control** |
| 22 | `⟨C⟩ \| grep -cF "a transaction amount of a positive numeric string is accepted, because spend is positive under the same convention"` | `1` — **F15** |
| 23 | `⟨C⟩ \| grep -cF "merchant_name null is accepted and a row missing the merchant_name key entirely is rejected"` | `1` — **F16** |
| 24 | `⟨C⟩ \| grep -cF "an unknown landscape value is rejected rather than admitted as a third, unnamed landscape"` | `1` — **F17** |
| 25 | `⟨C⟩ \| grep -cF "an unknown valuation_mode value is rejected"` | `1` — **F18** |
| 26 | `⟨C⟩ \| grep -cF "the success branch success true with a data payload and no error key parses"` | `1` — **F19** |
| 27 | `⟨C⟩ \| grep -cF "the error branch success false with a populated error object and no data key parses"` | `1` — **F20** |
| 28 | `⟨C⟩ \| grep -cF "success true paired with an error key instead of data is rejected"` | `1` — **F21, the envelope's central control** |
| 29 | `⟨C⟩ \| grep -cF "success false paired with a data key instead of error is rejected"` | `1` — **F22** |
| 30 | `⟨C⟩ \| grep -cF "the string true is rejected as a value for success, because only the literal boolean is a valid discriminant"` | `1` — **F23**, the `ALERTS_ENABLED`-shaped bug class, applied to a new field |
| 31 | `⟨C⟩ \| grep -cF "an empty error code is rejected"` | `1` — **F24** |
| 32 | `⟨C⟩ \| grep -cF "a canonical CategoryRule fixture parses"` | `1` — **F25** |
| 33 | `⟨C⟩ \| grep -cF "a canonical BudgetSummary fixture with numeric-string money fields parses"` | `1` — **F26** |
| 34 | `⟨C⟩ \| grep -cF "a canonical LinkedAccountSummary fixture with null mask and null subtype parses"` | `1` — **F27** |
| 35 | `grep -c "shared/\*\*/\*\.test\.ts" vitest.config.mts` | `1` — unchanged (T1); no toolchain edit needed or permitted |
| 36 | `git diff --name-only HEAD -- vitest.config.mts \| wc -l \| tr -d ' '` | `0` |
| 37 | `node -e "const p=require('./package.json'); console.log(Object.prototype.hasOwnProperty.call(p.dependencies,'zod'))"` | `true` — zod is a **direct dependency**, not devDependencies |
| 38 | `grep -cE '"zod":\s*"\^?4\.' package.json` | `1` — pinned to a 4.x range compatible with the resolved `4.4.3`, not left to float across a major |
| 39 | `grep -c '"zod"' package.json` | `1` — appears exactly once (dependencies only, not also devDependencies) |
| 40 | `grep -rl "next/server" shared/contracts \| wc -l \| tr -d ' '` | `0` — no route-framework import in the contract surface |
| 41 | `grep -rl "from 'pg'" shared/contracts \| wc -l \| tr -d ' '` | `0` |
| 42 | `grep -rl "lib/db" shared/contracts \| wc -l \| tr -d ' '` | `0` |
| 43 | `grep -rl "categoryControl" shared/contracts \| wc -l \| tr -d ' '` | `0` — the schema does not import the route-adjacent helper it must not be derived from |
| 44 | `git diff --name-only HEAD -- app/ \| wc -l \| tr -d ' '` | `0` — **no route touched, at any path** |
| 45 | `git diff --name-only HEAD -- components/ lib/ \| wc -l \| tr -d ' '` | `0` |
| 46 | `test -d app/api/v1 && echo FAIL \|\| echo OK` | `OK` — no v1 route tree created |
| 47 | `test -d apps && echo FAIL \|\| echo OK` | `OK` — no workspaces conversion |
| 48 | `test -d packages && echo FAIL \|\| echo OK` | `OK` |
| 49 | `grep -c '"workspaces"' package.json` | `0` — **same before and after** |
| 50 | `git diff --name-only HEAD -- migrations/ db/schema.sql \| wc -l \| tr -d ' '` | `0` — no contract-database change |
| 51 | `git diff --name-only HEAD \| grep -vE '^(shared/contracts/\|shared/types\.ts\|package\.json\|package-lock\.json\|AGENTS\.md\|plan/)' \| wc -l \| tr -d ' '` | `0` — **the scope command for tracked files** |
| 52 | `git status --porcelain \| grep -vE '^.. (shared/contracts/\|shared/types\.ts\|package\.json\|package-lock\.json\|AGENTS\.md\|plan/)' \| wc -l \| tr -d ' '` | `0` — **the scope command including untracked files** (the new `shared/contracts/**` files themselves match the allowed prefix) |

**The regex-bearing commands, verbatim and authoritative** (copy from here, not from the table):

```sh
# 2 — whole repo green, nothing skipped.  Expect: 1
npm test 2>&1 | grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"

# 6 — the 28 named fixtures.  Expect: OK  (0 today)
test $(npx vitest run --pool=threads --reporter=verbose shared/contracts 2>&1 | grep -cE "✓") -ge 28 && echo OK

# 38 — zod pinned to a 4.x range.  Expect: 1
grep -cE '"zod":\s*"\^?4\.' package.json

# 40 — no next/server import.  Expect: 0
grep -rl "next/server" shared/contracts | wc -l | tr -d ' '

# 41 — no pg import.  Expect: 0
grep -rl "from 'pg'" shared/contracts | wc -l | tr -d ' '

# 42 — no lib/db import.  Expect: 0
grep -rl "lib/db" shared/contracts | wc -l | tr -d ' '

# 43 — no categoryControl import.  Expect: 0
grep -rl "categoryControl" shared/contracts | wc -l | tr -d ' '

# 46 — no v1 route tree.  Expect: OK
test -d app/api/v1 && echo FAIL || echo OK

# 47 — no workspaces conversion.  Expect: OK
test -d apps && echo FAIL || echo OK

# 48 — Expect: OK
test -d packages && echo FAIL || echo OK

# 51 — scope, tracked files.  Expect: 0
git diff --name-only HEAD | grep -vE '^(shared/contracts/|shared/types\.ts|package\.json|package-lock\.json|AGENTS\.md|plan/)' | wc -l | tr -d ' '

# 52 — scope, including untracked.  Expect: 0
git status --porcelain | grep -vE '^.. (shared/contracts/|shared/types\.ts|package\.json|package-lock\.json|AGENTS\.md|plan/)' | wc -l | tr -d ' '
```

## Negative controls

| # | Rule | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | A schema for a *scalar* `NUMERIC` field must accept the real wire representation | `annual_budget: "abc"` rejected; `annual_budget: "1200.00"` **accepted** (a schema requiring `typeof === 'number'` would reject the latter and every real response) | F2, F3 — acceptance #8, #9 |
| 2 | `NUMERIC[]` elements arrive as JS numbers, never strings — the parser asymmetry | a `monthly_amounts` array of numeric *strings* must be **rejected**; the same array as JS numbers must be **accepted** | F11, F11b — acceptance #17, #18 |
| 3 | `control_mode`'s value set is the CHECK constraint's three values, not a value transcribed from memory or from a UI label | `control_mode: "variable"` (truncated `variable-necessary`) | F5 — acceptance #11 |
| 4 | `control_mode` is `NOT NULL`, a stated exception to "nullable means unknown" | `control_mode: null` | F6 — acceptance #12 |
| 5 | Every real row carries every selected column, even when its value is `null` | an object missing `control_mode` entirely, and separately one missing `dedicated_account_id` entirely | F7, F9 — acceptance #13, #15 |
| 6 | `.nullable()` and `.optional()` are not interchangeable | `dedicated_account_id` present as `null` must be **accepted**; the same field's key **absent** must be **rejected** | F8, F9 — acceptance #14, #15 |
| 7 | The contract models `shared/types.ts`'s narrower application shape, not `db/schema.sql`'s full table | a `BudgetCategory` fixture is checked against the schema's own declared field set, which must **not** include `is_debt_service` or `sort_order` | F12 — acceptance #19 |
| 8 | Money fields carry no sign restriction | `Transaction.amount` as a negative numeric string (income) must be **accepted**, not rejected by an inadvertent `positive()` | F14 — acceptance #21 |
| 9 | An unknown enum value is never silently admitted | `landscape: "hybrid"`, `valuation_mode: "market"` | F17, F18 — acceptance #24, #25 |
| 10 | The envelope's discriminant cannot coexist with the other branch's key | `{ success: true, error: {...} }` (no `data`); `{ success: false, data: {...} }` (no `error`) | F21, F22 — acceptance #28, #29 |
| 11 | The discriminant is a literal boolean, not a truthy value | `{ success: "true", data: null }` | F23 — acceptance #30 |
| 12 | The error branch's fields are non-empty | `error: { code: "", message: "x" }` | F24 — acceptance #31 |
| 13 | The contract surface has no dependency on the code it must not be derived from | any import of `next/server`, `pg`, `@/lib/db`, or `lib/categoryControl` inside `shared/contracts` | acceptance #40–#43 |
| 14 | This task does not touch a route, a component, or `lib/` | any diff to `app/`, `components/`, or `lib/` | acceptance #44, #45 |
| 15 | This task does not perform the workspaces conversion or the v1 migration | an `apps/`, `packages/`, or `app/api/v1/` directory; a `"workspaces"` key | acceptance #46–#49 |

## Evidence required

1. **The verbatim `⟨C⟩` output**, showing all ≥28 named fixtures passing.
2. **The measured `pg` representations quoted verbatim in `EVIDENCE.md`**, both directions: the scalar case (`annual_budget → "8400.00"`, `transactions.amount → "-7750.00"`, `properties.purchase_price → "720000.00"`, `SUM(amount) → "-103712.31"`, all strings) and the array case (`monthly_amounts[i] → 4200`, a number) — so a reviewer does not have to re-derive, or worse re-measure and possibly get the asymmetry wrong, why the two rules differ.
3. **`npm ls zod --depth=0`, before and after** — before: empty (not a direct dependency); after: `zod@4.4.3` (or the pinned range), resolved as a top-level entry.
4. **A one-line mapping table**, one row per `shared/types.ts` export, naming the schema each is validated by — the artifact that makes acceptance #7 (F1) auditable by a human, not just by count.
5. **Any acceptance command in this spec that a correct implementation could not satisfy**, reported rather than worked around, per the standing `A3`/`A4` escalation path — do not edit this file.

## Failure modes to test

- A *scalar* `NUMERIC`-backed field modeled as `z.number()`, passing every hand-authored test fixture the implementer writes first (since JS test fixtures are typed as numbers by habit) while rejecting every payload the one live route (`GET`/`POST /api/categories`) actually produces.
- **The inverse of the above, on the array field.** `monthly_amounts`'s elements modeled as numeric *strings* — applying the scalar rule uniformly "for consistency" when `pg`'s array parser is asymmetric and already returns array elements as JS numbers. A schema built this way rejects every real row that carries a custom monthly schedule, which is precisely the defect this generalization would produce if the split were not stated explicitly.
- `control_mode` modeled as `z.string()` (open) instead of the closed three-value enum — silently admitting a typo'd or case-mismatched value the `NOT NULL CHECK` would have refused at the database.
- `control_mode`'s value set copied from `lib/categoryControl.ts`'s `CONTROL_MODES` array or from a stale reading of `PATCH /api/categories` rather than from `shared/types.ts`/`db/schema.sql` directly — today these happen to agree, but the schema's source of truth determines whether a *future* divergence between the route and the database is caught or silently ratified.
- Nullable fields modeled `.optional()` instead of `.nullable()` — collapsing "this row genuinely has no value" and "a key went missing somewhere upstream" into one indistinguishable case.
- `BudgetCategory`'s schema built by copying `db/schema.sql`'s `CREATE TABLE budget_categories` instead of `shared/types.ts`'s narrower interface, silently admitting `is_debt_service` and `sort_order` — fields no current consumer of the TS type ever sees, and which, if this schema is later used to validate an *inbound* payload, would let a client set `is_debt_service` without the debt-service/`control_mode` coupling check that exists only in the route handler today.
- The envelope collapsed into one loose `z.object` that lets `success: true` coexist with an `error` key (or vice versa) — a shape no route produces today but a careless refactor could, and nothing would catch it without the discriminant being separately enforced.
- `success` validated as merely truthy (`z.boolean().optional()` misused, or a string coerced) rather than the literal `true`/`false` — the same class of bug this repo already shipped once as `ALERTS_ENABLED` needing to be exactly the string `"true"`.
- `zod` left resolving only transitively; the schemas compile today only because `@anthropic-ai/sdk` and `eslint-config-next` happen to pull a compatible version, and a future dependency bump or pruned install silently breaks the build with no diff to this task's own files.
- A new `apps/`, `packages/` directory or a `"workspaces"` key sneaking in as "obviously the right long-term layout," re-introducing the item-2 scope this task explicitly excludes.
- A route handler quietly wired to call `.parse()` "since the schema is right there," re-introducing item-3's scope (and creating a partial, untested double-validation path) — this task's diff must not touch `app/api/**` at all.

## Rollback

One commit, no schema change, no data change: `git revert <sha>`.

- The revert removes `shared/contracts/**`, restores `shared/types.ts` to its prior form (if the guardian edited it) and `package.json`/`package-lock.json` to their prior dependency sets.
- `npx tsc --noEmit` is the completeness check in both directions: forward, every one of the 61 `shared/types.ts` importers must still compile after this task lands; in reverse, the same command confirms nothing outside `shared/` and the two package files was left depending on `shared/contracts` (which the scope commands #44–#45 make true throughout the task's life, not just at revert time).
- **No `down` migration**, because there is no migration.
- **No CSV restore**, because no row is written anywhere. This task reads nothing and writes nothing to Postgres.
- `plan/tasks/P1-10-zod-contracts/**` is documentation and is not reverted.
