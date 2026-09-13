# CONTRACT — P1-11-api-v1-overview
**Author:** contract-guardian
**Lease:** open for the G1 window while this diff was written (2026-09-12) · exact open/close
timestamps are the orchestrator's to record from `.claude/bin/lease`, which this role cannot run

## Change

| File | Change | Class (§9.2) |
|---|---|---|
| `shared/contracts/overview.ts` | **new.** `OverviewDataSchema` (eleven sections), `OverviewResponseSchema`, the inferred `OverviewData` type, one new representation primitive (`moneyString`), and eighteen named nested schemas — `AsOfSchema`, `OverviewStatsSchema`, `OverviewTodaySchema`, `OverviewWeekSchema`, `MonthlySpendPointSchema`, `RecentArrivalSchema`, `BudgetVsActualRowSchema`, `MonthVarianceSchema`, `BreachFindingSchema`, `ChronicUnderspendFindingSchema`, `AdherenceFindingSchema`, `ScoredHeadlineSchema`, `CategorizationCoverageSchema`, `OutlookCategorySchema`, `MonthOutlookSchema`, `MonthPointSchema`, `YearEndReadSchema`, `FeedFindingSchema`, `DriftFindingSchema` | **additive** |
| `shared/types.ts` | **none.** The discretionary new export was considered and declined — see "Judgements SPEC.md left open", row 2 | — |
| `shared/contracts/{enums,shapes,envelope,representation,index}.ts` | **none.** `ControlModeSchema`, `apiResponseSchema`, `numericString`, `timestamptz`, `dateString` and `serialId` are imported, not amended or re-declared | — |
| `migrations/*`, `db/schema.sql` | **none** — this task composes existing reads | — |

Byte-identical to `HEAD`: `shared/types.ts`, every other file under `shared/contracts/`, `migrations/`,
`db/schema.sql`. All 61 importers of `shared/types.ts` see the surface they saw before this diff, and
nothing existing imports `shared/contracts/overview.ts` yet.

## Rationale

**Why the money rule is pinned to two decimals here when `representation.ts` deliberately refuses to
pin it.** `numericString` describes a `NUMERIC` arriving from `pg` untouched, and its docblock gives
the reason it carries no scale restriction: an aggregate or an unrounded expression is printed at
whatever scale Postgres computes, and a validator demanding two decimals would reject figures the
database really produces. `SUM(annual_budget) / 52` — `week.weeklyBudgetReference`'s own source — is
exactly such a figure. But none of the values in this payload is that. Every one of them is written
by this endpoint's own formatting step, and SPEC.md makes exactly-two-places the property of that
step. So `moneyString` is `numericString` **narrowed by one more regex**, not a second money pattern
written beside it: it inherits every refusal the primitive already makes (no exponent, no `NaN`, no
bare `.50`), and the narrowing is what makes the schema a detector for the defect it exists to
catch. A scale-free schema would wave `"993.7500000000001"` through — the exact value SPEC.md's F2
fixture is built around — and the contract would have no opinion about the one rule the payload is
defined by.

It describes and does not round: no `.transform()`, no coercion anywhere in this file. A schema that
quietly rounded its input would accept the very payload it exists to reject and then destroy the
evidence. Rounding happens once, in the composer, where a test can see it.

**Why the scalar/array split is preserved rather than tidied.** `numericString` and `numericArray`
disagree because `pg` registers the scalar and array parsers independently: `annual_budget` arrives
as `"8400.00"` and `monthly_amounts[i]` as `4200`, off the same row through the same client. This
payload carries no `NUMERIC[]` — `monthly_amounts` is an input to `lib/domain/**`, never an output of
it, and nothing in SPEC.md's enumeration is an array of raw NUMERIC elements — so `numericArray` is
not imported. The asymmetry is nonetheless the reason `moneyString` is built from `numericString`
specifically and not from a fresh `z.string().regex(...)`: the primitive is where that measurement
is recorded, and a copy of the pattern here is a copy that can stop agreeing with it.

**Why `feedHealth[].lastSuccessfulUpdate` is `timestamptz.nullable()` and never `z.date()`.** This is
the whole reason the endpoint was judged likely to ship a known defect. `lib/domain/feedHealth.ts`
declares the field `Date | null`, `lib/feedHealthRead.ts` passes `pg`'s `Date` straight into it, and
nothing between there and the wire converts it — `Response.json` does, via
`Date.prototype.toJSON`, and a consumer receives an ISO-8601 string. The schema describes the
consumer's value. The practical consequence, stated in the file and repeated here because it is the
step that gets skipped: **validate the JSON-round-tripped value, not the object you just built.**
`driftFindings[].observedAt` is the instructive contrast — same wire type, different provenance,
because `lib/drift.ts` already calls `.toISOString()` itself. The one that has to be converted is the
one that is easy to miss, so both carry a comment saying which they are.

**Why the payload's sections are `z.object` (stripping) and not `z.strictObject`.** The envelope is
strict because this application authors it end to end and nothing legitimately adds a key. This
payload does not have that property: `monthOutlook`, `yearEnd`, `feedHealth` and `driftFindings` are
carried verbatim from `lib/domain/**` and `lib/yearEndRead.ts`, which are implementation and may gain
a field without consulting this file. Under a strict schema, an *additive* change one layer down
becomes a rejected response here — a 500 for a change that broke nothing. Under a stripping one the
new field does not reach the client until this contract is amended deliberately, which is the
direction of failure that loses least. Applied uniformly, including to the six sections this task
composes itself, so the rule is the same at every use site rather than something a reader has to
look up per section. The one live consequence: `getBudgetVsActual` selects `bc.landscape` today and
spreads it into its row; `BudgetVsActualRowSchema` strips it rather than rejecting the payload, and
SPEC.md's three enumerated fields are what a consumer may rely on.

**Why `shared/contracts/overview.ts` imports nothing from `lib/`, not even `import type`.** Four of
the eleven sections stand 1:1 against a type declared under `lib/`, so the tempting move is
`import type { MonthOutlook } from '../../lib/domain/monthOutlook'` plus the `Assert<Equals<…>>`
idiom enums.ts and shapes.ts use, which would make schema↔type agreement a `tsc` failure instead of a
review item. It is refused for two reasons. First, direction: `shared/` is the base layer —
`lib/domain/adherence.ts` imports `shared/types.ts` — and a contract reaching back inverts that.
Second, and concretely: `YearEndRead` is declared in `lib/yearEndRead.ts`, which imports `./db`. A
type-only import is erased at runtime but is a real `ImportDeclaration` in the AST, and the checks
this repo uses to prove the contract surface cannot reach a connection pool parse exactly those
nodes (P1-10 G1-D1 rebuilt them as an AST walk for precisely this reason). A module specifier
pointing at a database shell, sitting in the contract file, is indistinguishable from the violation
those checks exist to catch.

**The cost of that refusal is real and is not waived — it is relocated.** The compile-time assertion
belongs in a module that may legitimately import both sides. The exact lines are handed to the
implementer below. Until they exist, the correspondence between `MonthOutlookSchema` and
`MonthOutlook` is checked by review and by the integration fixture that validates a real composed
payload (acceptance #29), not by the compiler — which is weaker than P1-10's guarantee and is
recorded as such.

**Why `AdherenceFindingSchema` is a `z.discriminatedUnion` while the envelope is a `z.union`.** Not
an inconsistency. `apiResponseSchema` is generic over a `data` schema nobody can prove discriminable,
so the union form is what lets that file compile for every `T` a handler returns. Here both options
are concrete objects each pinning its own `kind` literal, so discriminability is provable and the
error on a malformed finding points at the branch that was meant instead of reporting both as
failures. A breach carries one month and a defect carries a whole window; the discriminant is what
keeps a consumer from adding them, which is the scale-mixing defect P0.5-29a removed a field to make
unrepresentable.

**Why `OverviewData` is `z.infer` and not a hand-written interface in `shared/types.ts`.** P1-10
could not do this and said why: `z.infer` types every money field `string`, while 61 importers
compile against `number`, so adopting the inferred type there would be a §9.2 breaking change landed
on the validator's own diff. This payload has no importers — it is born at v1 — so the honest type is
free, and taking it means the type and the validator cannot drift, because there is only one of them.
Writing a `number`-money twin in `shared/types.ts` instead would *manufacture* on day one the exact
divergence P1-10 recorded as a debt, for no consumer's benefit.

## Domain invariants preserved

- **Derived, not stored.** No schema here introduces a "current" or "latest" field, and no table is
  touched. This endpoint is the purest form of the rule: every figure in it is a derived read —
  `stats`, `today`, `week`, `monthlySpending`, `recentArrivals` and `budgetVsActual` are aggregates
  computed per request, and `monthOutlook`, `yearEnd`, `feedHealth` and `driftFindings` come from
  readers that recompute rather than cache (`lib/drift.ts` records why: a stored result would only
  ever be a cache that goes stale between syncs). Nothing in this contract invites any of it to be
  written down. `net_worth_snapshots`, the repo's one deliberate stored-derivation, is not in this
  payload at all.
- **Money.** No database change, so every money column stays `NUMERIC(12,2)`/`NUMERIC(14,2)` and no
  float is introduced anywhere. At this boundary money is a **decimal string at exactly cent scale**
  (`moneyString`) and never a bare JSON number — deliberately string-only, not
  `z.union([string, number])`, for P1-10's recorded reason: a schema that accepts both
  representations can no longer tell them apart, so the day a handler starts emitting
  `Number(amount)` nothing fails. Ratios, percentages, counts, ids, days and flags are plain JSON
  values, matching the split the directory already draws.
- **Null semantics.** Every nullable field is `.nullable()` **and required**; nothing anywhere in
  this file is `.optional()`, and nothing is defaulted to `0`. The fields this rule is load-bearing
  for: `recentArrivals[].category` (`null` = uncategorized, never `''` or `'Uncategorized'`);
  `OutlookCategory.projected`/`.projectedVariance`/`.recurringExpected`/`.recurringPosted` (`null` =
  the record does not project or was not split — a `"0.00"` there says a category is heading for
  nothing, which is a different and false statement); `reason`/`withheldReason`;
  `headline` (`null` = nothing is in the scored set, which is not "perfect adherence");
  `coverageShare`/`coveragePercent` (`null` = an empty population, never `0`, `1` or `NaN`);
  `hoursStale` (`null` = there has never been a successful update, not "fresh");
  `observedAt`/`lastSuccessfulUpdate`. The one deliberate zero sentinel is
  `today.avgSameWeekday === "0.00"`, which is the dashboard's own pre-existing
  `COALESCE(AVG(...), 0)` carried through unchanged; it is documented in the schema as inherited
  rather than silently absorbed, so nobody converts it to a nullable field without deciding to.
- **Inheritance.** No column with inheriting-NULL semantics appears in this payload.
  `transactions.property_id` — the `COALESCE(t.property_id, a.property_id)` case, where NULL means
  *inherit from the account* rather than *unattributed* — is not exposed by any section here, and no
  property data enters this endpoint at all (Phase 0.5 moved it to `/properties`). No nullable field
  added by this diff inherits from anything; each one's null means exactly what its docblock says.

## Migration

**None.** This task composes existing reads; it adds no column, no constraint and no index, and
`migrations/` and `db/schema.sql` are byte-identical to `HEAD` (SPEC.md acceptance #41). G1's
`migrate:up && migrate:down && migrate:up` item is therefore satisfied **vacuously** — recorded
explicitly so the gate does not read an absent migration as an unanswered box.

If implementation discovers it needs a migration, that is scope drift per SPEC.md and must be
reported rather than absorbed. I found nothing in the payload enumeration that requires one: every
figure is computable from columns that exist today, and the six ad hoc queries already compute them.

## Backfill / data correction required

**None.** This contract reads nothing from and writes nothing to Postgres, so there is no CSV backup
to take and nothing to restore on revert. The only writes anywhere in this task are the integration
suite's fixtures, which SPEC.md's `assertScratchDatabase` control confines to a scratch database —
not a data correction, and not this role's to run in any case.

## Consumers checked

- `npx tsc --noEmit` → **must be run by the orchestrator at G1.** This role holds no Bash; every
  command here is stated for the gate to execute, not reported as already-green. The diff is one new
  file and no change to any existing declaration, so the expectation is `exit=0`, unchanged.
- `npm test` → expected unchanged. `shared/contracts/index.test.ts` reads `shared/types.ts`'s AST and
  requires `Object.keys(CONTRACT_SCHEMAS)` to equal its exported names minus `ApiResponse`. **That
  fixture is the reason `shared/types.ts` is untouched** — see the judgements table. The new file
  adds no export to `shared/types.ts` and does not modify `index.ts`, so the fixture's two sides are
  unchanged. `vitest.config.mts` includes `shared/**/*.test.ts`; this diff adds no test file, by
  design (SPEC.md: the implementer writes the fixtures).
- `npm run lint` → expected unchanged at the one pre-existing warning. Every import in the new file
  is used: `z`, `ControlModeSchema`, `apiResponseSchema`, `numericString`, `timestamptz`,
  `dateString`, `serialId`. Note that SPEC.md's Contracts-touched row also suggests reusing
  `LandscapeSchema` — the payload enumeration contains no landscape-typed field, so importing it
  would be an unused import and a second warning. Reported below, not acted on.
- **Layering**: `shared/contracts/overview.ts` imports `zod` and three sibling modules in its own
  directory. No `next/server`, no `pg`, no `@/lib/db`, no `lib/**` of any kind — not even
  `import type`. Imports are relative (`./enums`, `./envelope`, `./representation`), matching the
  directory's existing style, because `vitest.config.mts` registers no tsconfig-paths resolver.
- **Existing importers of `shared/contracts`**: unaffected. Nothing is re-exported through
  `index.ts`, so no existing import's resolution changes; consumers import
  `shared/contracts/overview` directly.

## Judgements SPEC.md left open

| Decision | Taken | Rejected, and why |
|---|---|---|
| A money schema for this payload | `moneyString` — `numericString` narrowed by `/^-?\d+\.\d{2}$/`, declared in `overview.ts` | Reusing bare `numericString` (accepts `"993.7500000000001"`, the exact value F2 exists to catch — the contract would have no opinion on the payload's defining rule); a fresh `z.string().regex(...)` (a second money pattern beside the primitive, the miniature of the duplication hazard `representation.ts`'s header names); adding it to `representation.ts` (out of this task's declared surface, and cent-scale is this payload's formatting convention, not a `pg` representation fact) |
| One new export on `shared/types.ts` | **None.** `OverviewData` is `z.infer<typeof OverviewDataSchema>`, exported from `overview.ts` | A hand-written interface with `number` money would manufacture P1-10's documented type↔wire divergence on day one, for zero existing importers. It would also **break a passing fixture**: `shared/contracts/index.test.ts` requires one `CONTRACT_SCHEMAS` entry per exported name of `shared/types.ts`, and `index.ts` is outside this task's declared surface, so the option SPEC.md offers cannot be exercised without a diff it forbids |
| Unknown keys | Stripped (`z.object`), uniformly | `z.strictObject` — four sections are verbatim passthroughs of `lib/domain/**`, so an additive change one layer down would become a rejected response here; mixing strict and stripping per section makes the rule unguessable at each use site |
| `AdherenceFinding` union form | `z.discriminatedUnion('kind', …)` | `z.union` — the envelope's form, taken there because a generic `data` schema cannot be proven discriminable; here both branches pin a literal, and the union form would report a malformed finding as two failures instead of one |
| Coverage's three spend figures (`scoredSpend`, `unattributedSpend`, `orphanedSpend`) | **Money strings.** SPEC.md's money rule governs "every field representing a dollar amount, in every section"; its parenthetical list of `monthOutlook` money fields does not name them, but it is an illustration of the rule, not an exhaustive enumeration | Leaving them plain numbers on the strength of the omission — they are dollar figures, and a payload where two of its dollar figures are numbers and thirty are strings is one a consumer cannot parse by rule |
| `headline.budgeted`/`.actual`/`.variance` and `findings[].budgeted`/`.actual`/`.variance`/`months[].*` | **Money strings**, same reading | As above |
| `yearEnd.monthly[].net` | **Money string.** SPEC.md's yearEnd list names `income`/`expense`/`cumulative` and omits `net`; it is `income − expense` for that month and is money | As above |
| Counts (`uncategorized`, `totalTxns`, `totalCount`, `accountCount`, `scoredCount`, `breachCount`, …) | Bare `z.int()` | `.nonnegative()` — `z.int()` already refuses `NaN`, a float and a string, and non-negativity is a property of `COUNT(*)` nothing between here and the wire could violate. Matches `serialId`'s recorded restraint about inventing an unenforced bound |
| `asOf.month` range | Bounded `0..11`, stated as 0-based | Unbounded — a 1-based December makes `MONTHS[asOf.month]` `undefined`, and the 0-based convention is the repo's most-documented off-by-one. The bound is honest about what it catches: a 1-based January still validates and still means February |
| `asOf.day` range | Bounded `1..31` | Bounding by the month's real length — that would put a second copy of the leap-year rule here, which `lib/domain/pacing.ts` exports `daysInMonth` specifically to prevent |
| `week.isoDow` range | Bounded `1..7` | Unbounded — `getTodayStats` uses `EXTRACT(DOW)` (0–6, Sunday = 0) and `getWeekStats` uses `EXTRACT(ISODOW)` (1–7, Monday = 1) *in the same file*; swapping them still returns a plausible integer, and this value is a denominator, so a `0` silently zeroes the week's pace on exactly one day a week |
| `monthlySpending` and `yearEnd.monthly` length | Pinned to `12` | Unbounded — both arrays are positional (index `i` is month `i`) and twelve is structural in both producers. A short array does not render eleven months; it shifts every month it does render |
| `monthlySpending[].month` | Open `z.string()` | `z.enum(['Jan', …])` — would copy `lib/drilldown.ts`'s `MONTHS` into the contract, creating a second definition of it, to catch a misspelling nothing produces |
| `feedHealth[].state` | `z.enum(['failing','stale'])` | The full four-value `FeedState` — `feedFindings` drops `'ok'` and `'unknown'` before returning, deliberately, and a schema admitting them would re-open a state the domain refuses to report |
| `OutlookCategory.status`/`.reason`/`.withheldReason`, `MonthOutlook.state` | Declared in `overview.ts` | Adding them to `enums.ts` — that file holds only the five vocabularies backed by a `db/schema.sql` CHECK, and SPEC.md's non-goals forbid touching it. `controlMode` **is** one of the five and is imported, not re-spelled |
| `-0.00` | Accepted by `moneyString` | Rejecting it — `(-0.004).toFixed(2)` reaches it, and it is the "minus sign that means nothing" `withoutNegativeZero` exists to prevent, but that is a formatting rule and belongs in the composer (handed over below), not a second place to maintain the same rule |
| `today.transactions` length | Unbounded | `.max(3)` — the `LIMIT 3` is the query's rendering decision, and pinning it here freezes it into the contract |
| `OverviewResponseSchema` | Exported, pre-composed | Leaving every consumer to write `apiResponseSchema(OverviewDataSchema)` — the route's test and a future mobile client would each pin their own, which is two places to disagree |

## Handed to the implementer

Specified here, executed there — this role runs no commands and writes no code outside the contract
surface.

1. **Put the compile-time schema↔type assertions in `lib/overviewRead.ts`** (or its test), which may
   legitimately import both sides. This recovers the property `shared/contracts/overview.ts` gives
   up, and it fails at `npx tsc --noEmit` — acceptance #1 — rather than needing a fixture. Compare
   **key sets**, not value types, exactly as shapes.ts does: the values diverge on purpose, because
   money is a string on the wire and a number in `MonthOutlook`.

   ```ts
   import type { Assert, Equals } from '../shared/contracts/exact';
   import type { MonthOutlook } from './domain/monthOutlook';
   import type { OverviewData } from '../shared/contracts/overview';

   export type MonthOutlookFieldsAreExact = Assert<
     Equals<keyof OverviewData['monthOutlook'], keyof MonthOutlook>
   >;
   ```

   The same line is worth writing for `OutlookCategory`, `ScoredHeadline`,
   `CategorizationCoverage`, `MonthVariance`, `YearEndRead`, `MonthPoint`, `FeedFinding` and
   `DriftFinding`. Export each alias — an unexported unused type alias is a lint warning, and
   acceptance #3 pins the repo at exactly one pre-existing warning.

2. **Fixtures are wire values, not composed objects.** `feedHealth[].lastSuccessfulUpdate` and
   `driftFindings[].observedAt` must be ISO-8601 **strings** in any fixture parsed directly; a
   `new Date(...)` will fail `timestamptz`, correctly. F4 is the deliberate exception and is the
   whole point of it: build the fixture *with* a live `Date`, round-trip it through
   `JSON.parse(JSON.stringify(...))`, and parse the result.

3. **Normalize `-0` before formatting.** `moneyString` accepts `"-0.00"` and
   `(-0.004).toFixed(2)` produces it. `lib/domain/adherence.ts` exports `withoutNegativeZero` for
   exactly this; import it rather than writing `n === 0 ? 0 : n` again.

4. **`stats.remaining` is computed before either operand is formatted** — from the raw numbers, never
   by parsing two decimal strings back. Invisible on already-2-decimal data, live the moment any
   upstream figure carries more precision (SPEC.md F6).

5. **Two cross-field invariants this schema states but cannot enforce**, both worth a fixture:
   `data.asOf` must deep-equal `data.monthOutlook.asOf` (the page performs exactly one clock read,
   and a schema cannot assert equality between two of its own fields); and
   `monthOutlook.coverageShare`/`.coveragePercent`/`.authoritative` must be identical to the same
   three fields on `monthOutlook.coverage` — the domain module copies them by reference precisely so
   the hero and the caveat under it cannot disagree.

6. **Import relatively.** From `lib/`: `'../shared/contracts/overview'`. `vitest.config.mts`
   registers no tsconfig-paths resolver, so `@/shared/...` will not resolve under the test runner —
   the same constraint P1-10 hit.

7. **Nothing is re-exported through `shared/contracts/index.ts`.** That file is outside this task's
   declared surface, so import `shared/contracts/overview` directly. If a later task adds the
   barrel entry, it must also add a `CONTRACT_SCHEMAS`-equivalent story or explicitly record why
   this payload has none — `CONTRACT_SCHEMAS` is keyed by `shared/types.ts` export names, and
   `OverviewData` is deliberately not one of them.

## Reported, not acted on

- **SPEC.md's `shared/types.ts` option cannot be exercised as written.** The Contracts-touched table
  offers "one new exported type (e.g. `OverviewData`)" at the guardian's discretion, and its
  Expected column allows "additive, or none". Taking it would fail
  `shared/contracts/index.test.ts` — which reads every exported name out of `shared/types.ts`'s AST
  and requires exactly one `CONTRACT_SCHEMAS` entry per name — and therefore acceptance #2, and the
  only repair is a change to `index.ts` that the same spec's non-goals exclude. I took the "none"
  branch, which the spec permits, so this is not a spec defect that blocks. It is recorded because
  the option reads as free and is not, and a future task that adds a `shared/types.ts` export must
  budget the `index.ts` change with it.
- **SPEC.md's Contracts-touched row names `LandscapeSchema` among the primitives to reuse.** No field
  in the enumerated payload is landscape-typed — `budgetVsActual` is operational-only by predicate
  and carries no landscape column per the payload table, and `yearEnd`'s landscape is an argument to
  the reader rather than a field on its result. Importing it would be an unused import and a second
  lint warning against acceptance #3's "one pre-existing warning". Not imported.
- **SPEC.md's money enumeration is narrower than SPEC.md's money rule, in three places.** The rule is
  "every field representing a dollar amount, in every section"; the parenthetical list omits
  `coverage.scoredSpend`/`.unattributedSpend`/`.orphanedSpend`, `headline.budgeted`/`.actual`/
  `.variance` (and the same three on each adherence finding, plus `months[].budgeted`/`.actual`/
  `.variance`), and `yearEnd.monthly[].net`. I resolved all three toward the rule and against the
  list, because the alternative is a payload whose money representation cannot be stated as a rule at
  all. Flagged rather than silently decided: it changes what the implementer must format, and it is
  the kind of divergence a reviewer should see argued rather than discover.
- **`MonthPoint.projected` is a boolean and `OutlookCategory.projected` is a nullable money field**,
  in the same payload, from two domain modules that never meet. The collision is named in both
  docblocks rather than repaired: renaming a field on the way through would make this payload
  disagree with the module that produced it, which is worse than a documented collision.
- **Non-finite numbers cannot be detected at this boundary.** JSON has no representation for them, so
  `Infinity` and `NaN` both serialize to `null`; a ratio that went non-finite upstream arrives
  indistinguishable from an honest "no baseline". The domain modules refuse to emit either, at four
  levels; this is recorded so nobody expects the schema to be the place that check happens.
- **No defect found in SPEC.md's payload enumeration.** Each of the eleven sections matches what
  `app/dashboard/page.tsx` renders today, and the four shared readers' shapes are transcribed field
  for field: `MonthOutlook` (13 keys), `YearEndRead` (6), `FeedFinding` (5), `DriftFinding` (8).
  Net worth and property data are correctly absent.

## Commands this role could not run

This role holds no Bash. Everything below is stated for the orchestrator to execute at G1; none of it
is reported as already-green.

- `npx tsc --noEmit` → expect `exit=0`. The new file's only compile-time risks are zod-4 API surface:
  `ZodString.regex()` chained onto `numericString`, `z.int().min().max()`, `ZodArray.length(n, msg)`,
  `ZodObject.extend()` on `MonthVarianceSchema`, and `z.discriminatedUnion` over two literal-keyed
  objects. All are zod 4 API and the directory already uses `z.int()`, `z.enum`, `z.literal` and
  `z.strictObject`; if any of them does not compile, it is mine to fix and not the implementer's.
- `npm test` → expect the pre-existing pass count, unchanged. I could not confirm whether any fixture
  under `shared/contracts/` enumerates the *directory's files* rather than `shared/types.ts`'s
  exports; `index.test.ts` does not, and it is the only one that reads a file's AST. If a new file in
  this directory trips a fixture I could not see, it will surface here.
- `npm run lint` → expect the one pre-existing warning and no other.
- `npm run build`, `npm ci` → expect `exit=0`. No dependency change: `zod` was already a direct
  dependency after P1-10, so `npm ls zod --depth=0` is unchanged and no install is needed.
