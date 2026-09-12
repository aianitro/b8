# CONTRACT — P1-10-zod-contracts
**Author:** contract-guardian
**Lease:** open for the G1 window while this diff was written (2026-09-11/12) · exact open/close
timestamps are the orchestrator's to record from `.claude/bin/lease`, which this role cannot run

## Change

| File | Change | Class (§9.2) |
|---|---|---|
| `shared/contracts/exact.ts` | new: `Equals` / `Assert`, two type-level utilities so schema↔type agreement is checked by `tsc` | additive |
| `shared/contracts/representation.ts` | new: the pg→JSON representation primitives — `numericString`, `numericArray`, `timestamptz`, `dateString`, `serialId` | additive |
| `shared/contracts/enums.ts` | new: the five closed vocabularies — `LandscapeSchema`, `ValuationModeSchema`, `PropertyTypeSchema`, `TenantFundKindSchema`, `ControlModeSchema`, each with a compile-time exactness assertion | additive |
| `shared/contracts/shapes.ts` | new: the seven object shapes — `PropertySchema`, `AccountSchema`, `BudgetCategorySchema`, `CategoryRuleSchema`, `TransactionSchema`, `BudgetSummarySchema`, `LinkedAccountSummarySchema`, each with a compile-time field-set assertion | additive |
| `shared/contracts/envelope.ts` | new: `ApiErrorSchema`, `ApiErrorResponseSchema` (closed, non-generic), `apiSuccessResponseSchema(T)`, `apiResponseSchema(T)` | additive |
| `shared/contracts/index.ts` | new: barrel, the one-row-per-export mapping table, and `CONTRACT_SCHEMAS` | additive |
| `shared/types.ts` | header comment only — names the measured NUMERIC divergence, why the declarations are *not* corrected in this task, and the NUMERIC[] counter-case. No declaration changed. | comment/doc only (§9.2 "comment / doc only" → additive) |
| `migrations/*`, `db/schema.sql` | none | — |
| `package.json`, `package-lock.json` | **not written here** — see "Handed to the implementer" below | additive (generated) |

Every existing export of `shared/types.ts` is untouched, so all 61 importers see the same surface
they saw before this diff.

## Rationale

**Why the schemas are not `z.infer` re-exports feeding `shared/types.ts`.** ITEM.md expected the
declarations to become inferred re-exports and SPEC.md explicitly declined to require it. They
cannot be, today, and the reason is the whole finding of this task: `z.infer<typeof
BudgetCategorySchema>['annual_budget']` is `string`, because that is what `pg` puts on the wire,
while `BudgetCategory.annual_budget` is `number`, which is what 61 importers compile against.
Deriving the type from the schema would be a correct type and a breaking change to every consumer
doing arithmetic on that field — a §9.2 type change landed without the consumers it breaks, on the
same diff that introduces the validator, which is the largest reviewable surface in the worst
possible place. The two therefore disagree on purpose, in one direction only, and the disagreement
is written down in three places (the header of `shared/types.ts`, rule 4 at the top of `shapes.ts`,
and here) rather than left for someone to rediscover from a runtime error. Closing it belongs to the
`/api/v1` migration, which touches those consumers anyway.

**Why the money representation is string-only and not `z.union([z.string(), z.number()])`.** The
permissive union is the tempting shape: it accepts today's payloads and tomorrow's, and no fixture
ever fails. That is precisely its defect. A schema that accepts both representations can no longer
tell them apart, so the day a handler starts returning `Number(annual_budget)` — reintroducing the
float drift the NUMERIC column exists to prevent, the same class of artifact that once appended a
spurious balance row on every sync — nothing anywhere would fail. The contract's job is to be the
detector, and a detector that accepts everything is not one.

**Why `numericArray` is `z.array(z.number())` while `numericString` is a string.** Measured, not
reasoned about, and the correction that cost this task a G0 cycle: `pg` registers the scalar and
array parsers independently, so `annual_budget → "8400.00"` (string) and `monthly_amounts[i] → 4200`
(number) come off the same row through the same client. Making these uniform in either direction
produces a schema that rejects every real payload of one kind — either every category response, or
every category carrying a custom monthly schedule. The asymmetry is stated as a named `pg` parser
property in `representation.ts` so it reads as a fact rather than as an inconsistency somebody
should tidy.

**Why row schemas strip unknown keys and the envelope does not.** `POST /api/categories` returns
`INSERT … RETURNING *`: its live response carries `is_debt_service` and `sort_order` alongside the
ten contracted fields. A strict `BudgetCategorySchema` would reject that payload today. The
envelope, by contrast, is authored entirely by this application — nothing legitimately adds a key to
it — so it is `z.strictObject`, which is what makes "the discriminant cannot coexist with the other
branch's key" literally true rather than true-by-stripping. The consequence for the implementer is
in "Handed to the implementer" below: F12 must be asserted against the schema's declared field set,
not by expecting a rejection.

**Why the accepted value sets are compiler-checked.** `Assert<Equals<…>>` under each enum makes
`npx tsc --noEmit` fail if a schema's value set and the TypeScript union stop being the same set.
ITEM.md's named failure — a contract whose vocabulary was transcribed from a route handler or from
memory — is caught by a test only for the wrong value somebody thought to write a case for (SPEC.md
F5 covers `'variable'`). The compile-time check covers the rest of the set, costs no runtime, and
rides on a command every gate already runs. The same idiom under each object schema pins the field
set, which is negative control #7 made structural.

## Domain invariants preserved

- **Derived, not stored:** no schema introduces a "current" or "latest" field. `Property` carries
  `purchase_price`/`cost_basis` and deliberately no current value — that stays the newest
  `property_valuations` row, a derived read. `Account.is_manual` is contracted as what it is: a
  per-query expression (`access_token IS NULL`), not a column, so nothing here invites it to be
  stored. The append-only observation tables are untouched.
- **Money:** unchanged in the database — every money column stays `NUMERIC(12,2)`/`NUMERIC(14,2)`,
  no float anywhere, no new column of any kind. At the contract layer money is a *numeric string*,
  which is the same discipline one layer up: the scale is the column's and the schema refuses to
  re-round or reformat it (SPEC.md §Conventions "a zod schema is a validator, not a computation").
- **Null semantics:** every genuinely nullable field is `.nullable()` **and required** — never
  `.optional()` — so "this row has no value" (renders "—") stays distinguishable from "a key went
  missing upstream" (a bug). Nothing is defaulted to `0`: `monthly_amounts: null` means *spread the
  annual budget evenly*, `purchase_price: null` means *unknown*, `mapped_category: null` means
  *uncategorized*. `control_mode` is the repo's stated exception and is the one field that must
  reject both `null` and an absent key.
- **Inheritance:** the inheriting column in this schema is `transactions.property_id`
  (`COALESCE(t.property_id, a.property_id)`; NULL means *inherit from the account*). It is not an
  export of `shared/types.ts`, so no schema here models it — and `AccountSchema.property_id`, which
  *is* modelled, carries a comment saying it is the other case: nullable there means the account is
  secured against no property. If `Transaction` ever gains the field, its NULL semantics must be
  stated in a comment, because they are not recoverable from the type.

## Migration

None. This task adds a runtime validator for shapes the database already constrains; it does not
change what the database accepts, and `migrations/` and `db/schema.sql` are byte-identical to
`HEAD`. G1's `migrate:up && migrate:down && migrate:up` checklist item is therefore satisfied
**vacuously** — recorded here explicitly, as SPEC.md asks, so the gate does not read an absent
migration as an unanswered box.

## Backfill / data correction required

**None.** This task reads nothing from and writes nothing to Postgres, so there is no CSV backup to
take and nothing to restore on revert.

## Consumers checked

- `npx tsc --noEmit` → **must be run by the orchestrator at G1.** This role holds no Bash; every
  command below is stated for the gate to execute, not reported as already-green. The contract is
  additive to `shared/types.ts` (one comment block, no declaration touched), so the expectation is
  `exit=0` unchanged, and the new files compile against the already-resolved `zod@4.4.3`.
- All 61 `shared/types.ts` importers: unaffected by construction — no exported name, type, or field
  changed. Nothing under `app/`, `components/`, or `lib/` imports `shared/contracts`, and nothing
  should until the route migration.
- `shared/contracts` imports `zod` and `../types` only: no `next/server`, no `pg`, no `@/lib/db`, no
  `lib/categoryControl` (SPEC.md acceptance #40–#43). Imports between these files are relative,
  matching `lib/categoryControl.ts`'s `'../shared/types'`, because `vitest.config.mts` registers no
  tsconfig-paths resolver and `@/` would not resolve under the test runner.

## Judgements SPEC.md left open

| Decision | Taken | Rejected, and why |
|---|---|---|
| Rewrite `shared/types.ts` as inferred re-exports | No — one header comment, no declaration changed | The inferred type of a money field is `string`; adopting it is a §9.2 breaking change to 61 importers, landed on the validator's own diff |
| Which boundary the schemas describe | The **JSON wire value**, after `Response.json` | The `db.query` row object: it is not what any consumer of an API sees, and it would force `created_at`/`date` to be `z.date()`, which the wire never carries |
| Money representation | `numericString`, string-only | `z.number()` (rejects every real payload); `z.union([string, number])` (accepts everything, detects nothing) |
| `monthly_amounts` elements | `z.number()`, no length or sign constraint | `z.array(numericString)` (a representation `pg` never produces); `.length(12)` / `.nonnegative()` — enforced by `normalizeMonthlyAmounts` on write but backed by no CHECK, so a read validator asserting it would make a legacy row unreadable |
| Unknown keys on row schemas | Stripped (`z.object`) | `z.strictObject` — would reject `POST /api/categories`'s live `RETURNING *` response |
| Unknown keys on the envelope | Refused (`z.strictObject`) | Stripping — `{ success: true, data, error }` would parse and quietly look correct |
| Envelope composition | `z.union` of two branches, each pinning its own `z.literal` | `z.discriminatedUnion` — identical accept/reject here, but it constrains the options to be discriminable, which a generic `data` schema cannot be proven to satisfy |
| `ApiErrorSchema` shape | Closed (`strictObject`), with an **open** `code` vocabulary | Enumerating today's codes: a new failure mode could then not be reported until the contract was amended |
| `NaN` for a money field | Rejected by `numericString` | Accepting it: Postgres can store it, but a NaN balance is a data defect, not an observation, and it renders as "NaN" |
| Compile-time schema↔type assertions | Included (`exact.ts`) | Leaving agreement to review and to hand-written fixtures — which only catch the wrong value someone anticipated |

## Handed to the implementer

Specified here, executed there — this role runs no commands.

1. **`zod` must become a direct dependency**, and this diff does not do it. Run
   `npm install zod@^4.4.3`, which writes `dependencies` in `package.json` and regenerates
   `package-lock.json` in one consistent step (SPEC.md acceptance #37–#39, #5). It is not
   hand-edited here on purpose: this role cannot run `npm`, the scope guard blocks writes to
   `package-lock.json` for everyone, and a `package.json` edited without its lock makes `npm ci`
   (acceptance #5) fail until the install runs. `4.4.3` is what already resolves transitively via
   `@anthropic-ai/sdk` and `eslint-config-next`; `^4.` keeps it inside the major the schemas are
   written against.
2. **Fixtures are wire values, not row objects.** `created_at`, `last_synced_at`, `date` and
   `purchase_date` must be ISO-8601 **strings** (`"2026-01-15T00:00:00.000Z"`), because `pg` hands a
   handler a `Date` and `Response.json` is what turns it into a string. A `new Date()` in a fixture
   will fail `timestamptz`/`dateString`, correctly.
3. **F12 asserts on the schema's declared field set**, e.g. `Object.keys(BudgetCategorySchema.shape)`
   — not on a rejection. Row schemas strip unknown keys by design (see Rationale), so feeding one
   `is_debt_service` parses and drops it; that is the contract, and the absent-field claim is about
   what the schema declares.
4. **F1 can iterate `CONTRACT_SCHEMAS`** in `shared/contracts/index.ts`, which is keyed by the exact
   export names of `shared/types.ts`. Compare its keys against those names rather than counting them
   — a count is satisfied by any twelve keys.
5. **Import relatively inside `shared/`** (`./index`, `../types`). `vitest.config.mts` has no
   tsconfig-paths resolver, so `@/shared/...` will not resolve in a test under `shared/`.

## Reported, not acted on

- **`app/accounts/page.tsx` selects eleven of `Account`'s twelve fields** — `property_id` is missing
  from its SELECT list while the result is cast to `Account`. `AccountSchema` requires the key (as
  SPEC.md's null-semantics rule requires), so that row would fail validation. The schema is right
  and the query is incomplete; softening the field to `.optional()` to accommodate it would destroy
  exactly the distinction the rule exists to keep. Fixing the query is route work and out of scope
  here — it belongs with whichever task first validates an `Account` payload.
- **No defect found in SPEC.md.** Its central rule matches what the code and the database actually
  do, including the array/scalar split. The one thing it asserts that is not universally true —
  "every real row carries the key, because Postgres always returns every selected column" — is true
  of Postgres and false of one *caller*, which is the bullet above rather than a spec error.
