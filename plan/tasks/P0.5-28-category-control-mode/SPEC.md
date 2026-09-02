# P0.5-28-category-control-mode — every category gets a control classification, and the scored set becomes nameable
**Roadmap item:** ROADMAP.md §5 Phase 0.5 step 28 — `plan/tasks/P0.5-28-category-control-mode/ITEM.md`
**Status:** DRAFT 3 — **FROZEN@G0** 2026-09-01 (drafts 1 and 2 failed G0; see `GATES.md` reviews 1–3)
**Author:** spec-writer

## Goal
Every row in `budget_categories` gains a third classification dimension, orthogonal to `landscape` / `exclude_from_budget` / `is_income`: a `control_mode` of `fixed`, `discretionary`, or `variable-necessary`, stored as a `NOT NULL` column that defaults to `fixed`. Because the default is a column-level `DEFAULT`, every existing row and every row created after this migration lands — whether or not the inserting code even mentions the column — carries a real value the instant it exists; there is no NULL fourth state for a later `AVG` to land on. On top of that default, the migration also carries an explicit, literal, per-category **seed** for today's operational categories that are neither income nor excluded (21 rows — see "Seed classification," signed off by the owner), so the scored set is not merely well-defined but actually populated at merge time, not empty by construction. The seed is a reviewed, enumerated list, not a name-matching heuristic. A category already marked `is_debt_service = TRUE` (the existing signal `lib/domain/propertyPnl.ts` and `app/properties/[id]/page.tsx` already read, independently of this task) is constrained by a database `CHECK` to also read `control_mode = 'fixed'` — the two dimensions can never disagree — though neither of `is_debt_service`'s two existing consumers is touched, and no *operational* category is currently `is_debt_service = TRUE`, so this CHECK is a forward invariant on today's data rather than one that currently bites. The set of categories a future adherence headline is computed over — "the scored set" — becomes exactly nameable out loud: `landscape = 'operational' AND exclude_from_budget = FALSE AND is_income = FALSE AND control_mode = 'discretionary'`, and a new pure function proves each of those four conditions independently necessary. `GET /api/categories` returns the new column. No metric, no UI, and no write path for changing a category's classification after this migration ships in this task — the seed is the one-time, reviewed exception to "no write path," not a mechanism.

## Non-goals
- **No adherence math, pacing math, dashboard re-point, uncategorized-confidence gating, or email delivery** (ROADMAP.md §5 steps 29–33). This task ships the classification only, per `ITEM.md`: "It ships no metric."
- **No ongoing write path.** `PATCH /api/categories` is not extended to accept `control_mode`. After this migration's one-time seed lands, nothing in the app or any script changes a category's classification. Reclassifying a category going forward (or classifying one created after this task merges) is future work — a later task ships that mechanism, per the owner's decision recorded in `GATES.md` G0 review 1.
- **No UI.** No page renders, edits, or otherwise surfaces `control_mode`. `app/categories/page.tsx`, `components/CategoryManager.tsx`, `app/categories/[name]/page.tsx`, `app/budget/page.tsx`, and `components/BudgetMonthlyGrid.tsx` are all unmodified. `app/categories/page.tsx`'s own `SELECT` (a separate query from the API route's) is explicitly out of scope — only `app/api/categories/route.ts`'s `GET` handler is required to expose the column.
- **No change to `monthly_amounts` or any schedule-aware math.** `lib/budgetMath.ts` is unmodified — per `ITEM.md`, schedule-awareness is step 30's.
- **No change to `lib/domain/propertyPnl.ts` or `app/properties/[id]/page.tsx`.** The coupling between `control_mode` and `is_debt_service` is enforced at the database layer by a `CHECK` constraint, not by touching either of `is_debt_service`'s existing consumers.
- **No deprecation, rename, or removal of `is_debt_service`.** It is not subsumed by `control_mode`. The two remain two columns; a `CHECK` constrains how they may combine, but `is_debt_service`'s own meaning, storage, and consumers are unchanged.
- **No trigger-based or generated-column enforcement that a capital-landscape row's `control_mode` stays NULL.** The column carries the same `DEFAULT 'fixed'` on every row regardless of landscape (see Conventions for why); capital rows' values are inert by predicate discipline, not by a stronger DB mechanism, matching how `is_income`/`exclude_from_budget` are already unconstrained across landscapes in this schema.
- **No name-matching or pattern-based inference for the seed.** The 21-row seed is a literal, reviewed, one-time enumerated list keyed on exact category name, not a heuristic (e.g. regex on "insurance" ⇒ `fixed`). Writing real category *names* (not amounts, balances, or valuations) into the migration's literal `UPDATE` is a deliberate, owner-approved choice, not an oversight to be "fixed" — see Conventions.
- **No new authentication, API versioning, or caching layer.**
- **No live-rendered screenshot or dev-database evidence.** Fabricated fixtures only, against throwaway databases — including for the seed's own verification (acceptance #20–22 insert fabricated placeholder rows carrying today's real category *names* with fabricated $1 amounts, into a database built and torn down solely for this purpose; no real amount, balance, or dev-database row is read or asserted on).

## Contracts touched
| File | Change | Class (§9.2) |
|---|---|---|
| `shared/types.ts` | A new exported union type for the three literal values (naming is the guardian's call; the roadmap's own literals are `'fixed'` \| `'discretionary'` \| `'variable-necessary'`), and a new required field on `BudgetCategory`, non-nullable — same shape precedent as `landscape: Landscape` (line 47). | additive |
| `migrations/<new>_category-control-mode.sql` + `db/schema.sql` | New `budget_categories.control_mode` column: `NOT NULL`, `DEFAULT 'fixed'`, `CHECK` restricting it to the three named values, and a second `CHECK` coupling it to the existing `is_debt_service` column (`is_debt_service ⇒ control_mode = 'fixed'`, i.e. `CHECK (NOT is_debt_service OR control_mode = 'fixed')`). The `DEFAULT` backfills every pre-existing row to `'fixed'` in the same statement that adds the column. | additive |
| `migrations/<new>_category-control-mode.sql` (seed) | The same migration also carries a literal, reviewed `UPDATE` (or equivalent `CASE`) setting `control_mode` for the 21 named operational, non-income, non-excluded categories enumerated in "Seed classification" below (**final, owner-signed-off**), each matched by exact `name` and `landscape = 'operational'` (defensively, since `UNIQUE(name, landscape)` permits the same name in both landscapes even though none of these 21 currently collide with a capital-landscape name). This is data content, not schema shape, but it ships inside the migration per the owner's decision (`GATES.md` G0 review 1, resolution 1) rather than as a separate `PATCH`-driven write path. | additive |
| `db/schema.sql` (pre-existing drift, not introduced by this task) | `budget_categories.is_debt_service BOOLEAN NOT NULL DEFAULT FALSE` is live via `migrations/1786644696767_debt-service-categories.sql` but absent from `db/schema.sql`. Flagged for the guardian to resolve at G1 in the same pass. | additive (schema-sync correction; no behavioral change) |

## Conventions this task must honor
- **Sign:** N/A. `control_mode` is a classification, not a monetary or directional figure, and this task performs no arithmetic.
- **Rounding:** N/A. No money is summed, combined, or rounded by this task. `monthly_amounts`/`annual_budget` are untouched — a diff that touches `roundCents` or `lib/budgetMath.ts` "while in the area" is out of scope and a regression risk, not a convenience.
- **Landscape + exclusions — the core of this task:**
  - `control_mode` physically exists (and defaults to `'fixed'`) on **every** `budget_categories` row, regardless of `landscape`. A capital row's `control_mode` value must be treated as **inert** — no consumer may act on it without first checking `landscape = 'operational'`, exactly as `exclude_from_budget`/`is_income` are already gated ahead of any category-level flag throughout this codebase.
  - **The scored set — the thing the exit criterion requires be "nameable out loud" — is exactly:** `landscape = 'operational' AND exclude_from_budget = FALSE AND is_income = FALSE AND control_mode = 'discretionary'`. All four conjuncts are independently required. `variable-necessary` is **not** scored — per ROADMAP.md §5's own text, "The headline metric covers the categories where behaviour is the variable; the rest are tracked and reported, never scored."
  - `is_debt_service` does not appear in the scored-set definition directly and does not need to — the coupling `CHECK` already forces every `is_debt_service = TRUE` row to `control_mode = 'fixed'`, which the scored-set definition already excludes.
- **`is_debt_service` coupling — currently vacuous on operational data, still a required forward invariant.** In today's live category set (36 rows, names/flags only — no amounts appear anywhere in this document), **no operational category has `is_debt_service = TRUE`; both mortgage categories (`Mortgage Gastonia`, `Mortgage Myrtle Beach`) are `capital`-landscape.** The coupling `CHECK` therefore constrains no *existing* operational row today — it is a forward invariant, guarding against a future operational debt-service category being simultaneously misclassified as `discretionary`. `DEFAULT 'fixed'` applies uniformly, so both capital mortgage rows — already `is_debt_service = TRUE` — are backfilled to `control_mode = 'fixed'` automatically and satisfy the coupling `CHECK` with no special-casing needed in the migration for those two rows.
- **`control_mode` (three-way) vs. `is_discretionary` (boolean) — decided: three-way.** ROADMAP.md §5 offers both and argues for three in the same sentence it poses the choice: "utilities are neither a free choice nor a fixed debit." A boolean has nowhere to put a variable-necessary category. The three-way `control_mode` matches the existing `landscape TEXT NOT NULL CHECK (...)` precedent already in this schema and BUILD.md §9.2's named, additive "new enum-ish value" change class.
- **Backfill — decided: `'fixed'` as the column default for every row, plus a literal, reviewed, owner-signed-off per-category seed for today's 21 scorable-candidate operational categories.** A blanket `'discretionary'` default would silently classify every legacy category — including a mortgage payment — as a scored behavioral decision, the exact dilution step 28 exists to remove. A NULL default reintroduces the "fourth, unnamed mode" the exit criterion forbids. `'fixed'` remains the correct **default** for anything not explicitly reviewed (new categories created after this migration, `is_income`/`exclude_from_budget` rows, capital rows). Pairing that default with no way at all to leave it — draft 1's shape — satisfied the exit criterion's letter without its substance (`GATES.md` G0-4): it guaranteed the scored set was *permanently* empty. The owner resolved this by seeding today's real classifications into the migration as an explicit, literal, reviewed list — not a heuristic, and not an ongoing write path (see Non-goals).
- **Real category names in the migration — reviewed and approved, not a defect.** The seed `UPDATE` necessarily references today's real category *names* as literal `WHERE name = '...'` matches. This is distinct from real *amounts*, *balances*, or *valuations* — the class of data this codebase's fabricate-test-data convention and this task's own non-goals exist to keep out of a committed diff. Category names are structural taxonomy, not sensitive financial content, and the owner was asked and is content with them appearing in the migration.
- **`is_income` / `exclude_from_budget` interaction — decided: every operational row is classified, including income and excluded rows; only the scored-set definition excludes them.** Income (`Salary`, `Other income (O)`) and excluded (`Transfer`) rows are left at the column `DEFAULT` (`'fixed'`), not individually seeded — their exclusion from the scored set is already guaranteed by `is_income`/`exclude_from_budget` regardless of `control_mode`'s value.
- **Null semantics:** `control_mode` is **never** NULL, on any row, in either landscape, from the moment this migration lands — enforced by a `NOT NULL` constraint, not by application convention. This is a deliberate, stated departure from this repo's usual "nullable means unknown" rule: there is no legitimate "unknown" reading of a category's control mode worth preserving, the way a missing valuation genuinely is unknown.

## Seed classification — final, signed off by the owner (2026-09-01)
The 21 operational, non-income, non-excluded categories in today's live set. **All 21 rows, including the 8 originally flagged debatable, were put to the owner and accepted exactly as proposed** — no row's value changed between proposal and this final table. The last column is an audit record of which rows were judgment calls; it does not mean any remain open.

| Category | `control_mode` | Rationale | Originally flagged debatable? |
|---|---|---|---|
| Auto insurance | `fixed` | A recurring, contractually-set premium; amount and cadence aren't a month-to-month decision. | no |
| Auto service | `variable-necessary` | Upkeep/repairs needed to keep a vehicle running; timing and amount vary with wear, not elective, not a fixed recurring debit. | no |
| Clothes/Beauty | `discretionary` | Genuinely elective purchases; timing and amount are a choice. | no |
| Education | `discretionary` | Courses/materials-style spend, distinct from a fixed tuition obligation. | yes (spec-writer) — accepted as proposed |
| Entertainment | `discretionary` | Textbook elective spend — the roadmap's own worked example category. | no |
| Gas | `variable-necessary` | Necessary for transportation; amount varies with use, not a free choice to skip, not a fixed debit. | no |
| Grocery | `variable-necessary` | Food is a necessity; amount has real day-to-day behavioral variability but isn't a free choice the way dining out is. | yes (orchestrator) — accepted as proposed |
| Health | `variable-necessary` | Necessary, cost varies, not elective, not a fixed monthly debit. | yes (orchestrator) — accepted as proposed |
| Home improvements | `discretionary` | Optional projects; timing and amount elective (distinct from necessary repair/upkeep). | no |
| One time | `fixed` | A heterogeneous, non-recurring catch-all by definition — no single stable behavioral pattern to score; the conservative default is the honest answer. | yes (spec-writer) — accepted as proposed |
| Online services | `fixed` | Subscriptions with fixed recurring billing (streaming, software). | no |
| Pets | `variable-necessary` | Pet food/vet care is necessity-like for the animal; amount varies, not a fixed debit. | no |
| Pocket money | `discretionary` | A personal allowance; clearly elective by nature. | no |
| Property Taxes | `fixed` | A government-assessed obligation, non-negotiable within a tax year. | yes (orchestrator) — accepted as proposed |
| Restoraunts | `discretionary` | The roadmap's own "restaurant dinner" example, verbatim. | no |
| Shared expenses | `fixed` | A recurring cost-sharing arrangement. | yes (spec-writer) — accepted as proposed |
| Sport | `discretionary` | Recreational activity spend; elective. | no |
| Toys/Gifts/Flowers | `discretionary` | Elective gift-giving spend. | no |
| Transportation | `variable-necessary` | Necessity spend like `Gas`, though with more available substitutes. | yes (orchestrator) — accepted as proposed |
| Travel | `discretionary` | Vacation/trip spend; clearly elective. | no |
| Utilities/Maintenance | `variable-necessary` | The roadmap's own worked example, verbatim ("utilities are neither a free choice nor a fixed debit"). | yes (orchestrator) — accepted as proposed |

Left at the column `DEFAULT` (`'fixed'`), not individually seeded, per the `is_income`/`exclude_from_budget` convention: `Salary`, `Other income (O)` (`is_income = TRUE`), `Transfer` (`exclude_from_budget = TRUE`). Left at the column `DEFAULT` (`'fixed'`, inert), not individually seeded, per the landscape convention: all 12 capital-landscape categories (`College`, `Escrow refund`, `Home projects`, `Income tax`, `Investment`, `Mortgage Gastonia`, `Mortgage Myrtle Beach`, `Other`, `Other income (C)`, `Rent Gastonia`, `Rent Myrtle Beach`, `Stock sale`).

## Toolchain prerequisites
| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | A throwaway Postgres reachable via an explicit `DATABASE_URL` override, with schema history through `1787871600000_tenant-held-funds.sql` applied — used by acceptance #13–19 | **yes** | Provisioned by the orchestrator as `b8_roundtrip_p0528` (local Homebrew Postgres 16.14); also the G1/G4 round-trip database | `psql "$DATABASE_URL" -c "SELECT 1;"` | reachable, PostgreSQL 16.14 ✅ |
| T2 | `psql` client available, plus `dropdb`/`createdb` from the same install | **yes** | Homebrew Postgres client | `psql --version` | 16.14 (Homebrew) ✅ |
| T3 | The role behind `$PROBE_DATABASE_URL` has `CREATEDB` — acceptance #20 self-provisions a disposable `b8_seed_probe_p0528`, **distinct from T1's database**, torn down and rebuilt on every run | **yes** | Same local role T1/T2 use | `dropdb --if-exists b8_seed_probe_p0528 && createdb b8_seed_probe_p0528 && echo OK` | OK ✅ |
| T4 | `node_modules` installed, `vitest`/`typescript` available | **yes** | `npm ci` | `test -d node_modules/vitest && test -d node_modules/typescript && echo OK` | OK; 18 files / 298 tests baseline ✅ |
| T5 | Live Plaid credentials / network access | **NO** | n/a | n/a | n/a |
| T6 | `node_modules/next/dist/docs/` present | **NO** (implementer's standing operating rule per `AGENTS.md`, not a gate for this spec) | n/a | n/a | n/a |

**Two distinct throwaway databases, two distinct env vars, on purpose.** `$DATABASE_URL` → `b8_roundtrip_p0528`, reserved for T1 and acceptance #13–19 (schema/CHECK invariants via rolled-back transactions against a fully-migrated database). `$PROBE_DATABASE_URL` → `b8_seed_probe_p0528`, reserved for T3 and acceptance #20–22 (the seed's idempotent, order-sensitive verification, which must control the exact moment relative to this task's migration). Neither is ever `.env.local`'s `DATABASE_URL`, which points at the dev database holding real financial data.

**Exit-code note (G0-1 fix).** #15–17 and #19 assert `psql -v ON_ERROR_STOP=1 -c "..."` exits **1**, not `3`. Exit 3 is psql's *script* code (`-f` / stdin / `\i`); a `-c` argument is transmitted as one combined query, so a constraint violation surfaces via the ordinary query-error path. The spec-writer cannot execute `psql` (Read/Grep/Glob only, §5.2); the correction was measured by the orchestrator and re-confirmed for #19's exact shape (`GATES.md` reviews 1–2).

**Idempotency note (G0-5 fix).** Draft 2's #20 was a non-idempotent 21-tuple `INSERT` that collided on `UNIQUE (name, landscape)` and exited 1 on any second run — including the orchestrator's independent G2 re-run. The mechanism below (`dropdb --if-exists && createdb`, then `node-pg-migrate up <timestamp> --timestamp` to land precisely at the pre-this-migration state) was confirmed by the orchestrator on a scratch database and then run three consecutive times in full (`GATES.md` review 3).

## Acceptance commands
**#20, #21 and #22 must run in that order, against the same probe database #20 just rebuilt.** #20 is safe to re-run any number of times — each run tears down and rebuilds `b8_seed_probe_p0528` from scratch. #21/#22 read whatever that database currently holds; run without a preceding #20 they are not meaningful.

| # | Command | Expected |
|---|---|---|
| 1 | `npx tsc --noEmit` | exit 0 |
| 2 | `npm test -- --pool=threads` | exit 0 (no exact total asserted — #3–8 pin the six required tests by name; this command's only job is "nothing else broke") |
| 3 | `npx vitest run --pool=threads --reporter=verbose lib/ \| grep -cF "includes an operational, non-excluded, non-income category classified discretionary in the scored set"` | `1` |
| 4 | `npx vitest run --pool=threads --reporter=verbose lib/ \| grep -cF "excludes a fixed category from the scored set even though it is operational, not excluded, and not income"` | `1` |
| 5 | `npx vitest run --pool=threads --reporter=verbose lib/ \| grep -cF "excludes a variable-necessary category from the scored set — tracked and reported, never scored, same as fixed"` | `1` |
| 6 | `npx vitest run --pool=threads --reporter=verbose lib/ \| grep -cF "excludes a capital-landscape category from the scored set even when its control_mode is discretionary"` | `1` |
| 7 | `npx vitest run --pool=threads --reporter=verbose lib/ \| grep -cF "excludes an exclude_from_budget category from the scored set even when its control_mode is discretionary"` | `1` |
| 8 | `npx vitest run --pool=threads --reporter=verbose lib/ \| grep -cF "excludes an is_income category from the scored set even when its control_mode is discretionary"` | `1` |
| 9 | `grep -c "variable-necessary" shared/types.ts` | `≥ 1` (`0` on the untouched tree — verified twice) |
| 10 | `grep -c "control_mode" db/schema.sql` | `≥ 1` (`0` on the untouched tree) |
| 11 | `grep -c "is_debt_service" db/schema.sql` | `≥ 1` (`0` on the untouched tree) |
| 12 | `grep -A3 "SELECT id, name, annual_budget" app/api/categories/route.ts \| grep -c control_mode` | `≥ 1` (`0` on the untouched tree) |
| 13 | `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO budget_categories (name, annual_budget, landscape) VALUES ('spec28-op-default', 1, 'operational') RETURNING control_mode; ROLLBACK;"` | prints `fixed`; exits `0` |
| 14 | `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO budget_categories (name, annual_budget, landscape) VALUES ('spec28-cap-default', 1, 'capital') RETURNING control_mode; ROLLBACK;"` | prints `fixed`; exits `0` (present but inert) |
| 15 | `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO budget_categories (name, annual_budget, landscape, control_mode) VALUES ('spec28-bad-value', 1, 'operational', 'whatever'); ROLLBACK;"` | exits `1` (CHECK violation) |
| 16 | `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO budget_categories (name, annual_budget, landscape, control_mode) VALUES ('spec28-null-reject', 1, 'operational', NULL); ROLLBACK;"` | exits `1` (NOT NULL violation) |
| 17 | `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO budget_categories (name, annual_budget, landscape, is_debt_service, control_mode) VALUES ('spec28-debt-mismatch', 1, 'operational', TRUE, 'discretionary'); ROLLBACK;"` | exits `1` (coupling CHECK, on INSERT) |
| 18 | `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO budget_categories (name, annual_budget, landscape, is_debt_service, control_mode) VALUES ('spec28-debt-ok', 1, 'operational', TRUE, 'fixed') RETURNING control_mode; ROLLBACK;"` | prints `fixed`; exits `0` (proves #17 isn't a blanket reject) |
| 19 | `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO budget_categories (name, annual_budget, landscape, is_debt_service, control_mode) VALUES ('spec28-update-fixture', 1, 'operational', TRUE, 'fixed'); UPDATE budget_categories SET control_mode = 'discretionary' WHERE name = 'spec28-update-fixture'; ROLLBACK;"` | exits `1` (coupling CHECK fires on `UPDATE`, not only `INSERT`) |
| 20 | `dropdb --if-exists b8_seed_probe_p0528 && createdb b8_seed_probe_p0528 && DATABASE_URL="$PROBE_DATABASE_URL" npx node-pg-migrate up 1787871600000 --timestamp && psql "$PROBE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO budget_categories (name, annual_budget, landscape) VALUES ('Auto insurance',1,'operational'),('Auto service',1,'operational'),('Clothes/Beauty',1,'operational'),('Education',1,'operational'),('Entertainment',1,'operational'),('Gas',1,'operational'),('Grocery',1,'operational'),('Health',1,'operational'),('Home improvements',1,'operational'),('One time',1,'operational'),('Online services',1,'operational'),('Pets',1,'operational'),('Pocket money',1,'operational'),('Property Taxes',1,'operational'),('Restoraunts',1,'operational'),('Shared expenses',1,'operational'),('Sport',1,'operational'),('Toys/Gifts/Flowers',1,'operational'),('Transportation',1,'operational'),('Travel',1,'operational'),('Utilities/Maintenance',1,'operational');" && DATABASE_URL="$PROBE_DATABASE_URL" npx node-pg-migrate up` | every step exits `0`; re-runnable indefinitely |
| 21 | `psql "$PROBE_DATABASE_URL" -tA -c "SELECT COUNT(*) FROM budget_categories WHERE landscape='operational' AND control_mode IS NULL;"` | `0` (completeness) |
| 22 | `psql "$PROBE_DATABASE_URL" -tA -F',' -c "SELECT name, control_mode FROM budget_categories WHERE landscape='operational' AND name IN ('Auto insurance','Entertainment','Gas','Online services','Pets','Restoraunts') ORDER BY name;"` | exactly the six lines below |

Expected output for #22, verbatim:

```
Auto insurance,fixed
Entertainment,discretionary
Gas,variable-necessary
Online services,fixed
Pets,variable-necessary
Restoraunts,discretionary
```

**Vacuity check, per command.** #1/#2 prove nothing broke, not that anything shipped. #3–8: no single shortcut predicate (always-true, always-false, landscape-only, control_mode-only) passes all six. #9: a boolean `is_discretionary` design never introduces the string `variable-necessary`. #10/#11: a migration that never updates `db/schema.sql` fails both. #12: a migration-only change that never threads the field through the read API fails. #13/#14: a design with no `DEFAULT` fails both. #15: a `CHECK (control_mode IS NOT NULL)`-only design with no value-list restriction lets `'whatever'` insert and print. #16: a plain nullable column fails to error. #17/#18 catch the coupling bug in both directions. #19 catches a coupling that only fires on `INSERT` (e.g. an application-level check rather than a real `CHECK`). **#20–22 catch draft 1's actual defect (G0-4) and are themselves re-runnable and order-explicit (G0-5):** a "fix" that keeps the uniform default and skips the seed passes #21 but fails #22, since `Restoraunts`/`Entertainment` would read `fixed`. A seed that only works the first time a migration meets a given database now fails #20 on its own second invocation.

## Negative controls
| # | Rule | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | Backfill/default is `'fixed'`, never `'discretionary'` | A newly inserted operational row with no `control_mode` | acceptance #13 |
| 2 | `control_mode` is never NULL, on any row, either landscape | An explicit `NULL` on insert | acceptance #16 |
| 3 | `control_mode` accepts only the three named values | An arbitrary string (`'whatever'`) | acceptance #15 |
| 4 | `is_debt_service = TRUE` forces `'fixed'` on insert | `is_debt_service = TRUE, control_mode = 'discretionary'` | acceptance #17 |
| 5 | The same holds on update, not just insert | A valid row `UPDATE`d to `'discretionary'` while `is_debt_service` stays `TRUE` | acceptance #19 |
| 6 | The rule is one-directional | `is_debt_service = TRUE, control_mode = 'fixed'` (must be *accepted*) | acceptance #18 |
| 7 | The scored set requires `landscape = 'operational'` | A capital category with `control_mode = 'discretionary'` | acceptance #6 |
| 8 | The scored set requires `exclude_from_budget = FALSE` | An excluded category with `control_mode = 'discretionary'` | acceptance #7 |
| 9 | The scored set requires `is_income = FALSE` | An income category with `control_mode = 'discretionary'` | acceptance #8 |
| 10 | `variable-necessary` is tracked, never scored | A `variable-necessary` category, otherwise qualifying | acceptance #5 |
| 11 | `fixed` is tracked, never scored | A `fixed` category, otherwise qualifying | acceptance #4 |
| 12 | Three-way, not boolean | `variable-necessary` absent from `shared/types.ts` | acceptance #9 |
| 13 | The seed is a reviewed literal list, not a heuristic or a no-op | Every category left at the `'fixed'` default with no seed applied | acceptance #22 |
| 14 | `is_debt_service`'s two existing consumers are untouched | Any diff hunk in `lib/domain/propertyPnl.ts` or `app/properties/[id]/page.tsx` | G2 diff review |
| 15 | `db/schema.sql` is not left further out of sync | `control_mode` or `is_debt_service` absent post-migration | acceptance #10, #11 |
| 16 | The seed and its verification are idempotent, not a one-shot | A second independent run of #20 against an already-built probe | acceptance #20 |

## Evidence required
- Verbatim output of all 22 acceptance commands in `EVIDENCE.md`.
- The exact DDL added by the migration (`ADD COLUMN ... DEFAULT ... CHECK (...)`, the coupling `CHECK`, and the seed `UPDATE`/`CASE`), quoted verbatim.
- Confirmation that the migration's literal seed matches this spec's finalized 21-row table exactly — any discrepancy called out explicitly, since none is expected.
- A fabricated fixture table (never real dollar amounts) covering all 21 seeded `name`/`control_mode` pairs, not just the 6 spot-checked in #22, run against the same probe #20 builds.
- A diff excerpt (or explicit statement) confirming `app/api/categories/route.ts`'s `POST` and `PATCH` handlers are **unchanged**.
- The migration's up **and** down SQL, quoted verbatim.

## Failure modes to test
- A blanket `'discretionary'` backfill/default instead of `'fixed'` — silently classifies every legacy category, including a mortgage payment, as a scored decision.
- NULL left as the backfill/default — reintroduces the fourth, unnamed mode.
- `control_mode` implemented as a boolean — a variable-necessary category has nowhere correct to go.
- The scored-set predicate omits the `exclude_from_budget` or `is_income` conjunct — reproduces the $3,120-transfer-as-income failure class for the adherence metric.
- The scored-set predicate omits the `landscape` conjunct — a capital category leaks into an operational-only headline number.
- `is_debt_service = TRUE` and a non-`fixed` `control_mode` coexist with nothing preventing it (missing, backwards, or INSERT-only coupling).
- The coupling `CHECK` implemented backwards (`control_mode = 'fixed' ⇒ is_debt_service`) — rejects a legitimate non-debt `fixed` category.
- `db/schema.sql` updated for `control_mode` but the pre-existing `is_debt_service` drift left uncorrected.
- A second, independently written "is this category scored" check appears elsewhere instead of importing the one predicate this task ships.
- `GET /api/categories`'s `SELECT` updated but `shared/types.ts`'s field typed optional/nullable despite `NOT NULL`, or the reverse.
- An implementer "fixes" or reformats `lib/budgetMath.ts` / `roundCents` while in the area, out of scope.
- `control_mode` derived via a name-matching heuristic instead of the literal reviewed seed.

## Rollback
The down migration drops the `control_mode` column together with both `CHECK` constraints — a pure schema rollback; the seed `UPDATE` needs no separate reversal, since dropping the column discards the seeded values with it. If the guardian folds the `is_debt_service`/`db/schema.sql` sync-fix into the same migration, reverting reverts only `control_mode`'s presence — `is_debt_service` predates this task and is untouched by the down migration. `migrate up && migrate down && migrate up` must run clean against `b8_roundtrip_p0528` (T1) at G1/G4, using the direct `npx node-pg-migrate` invocation with an explicit `DATABASE_URL` override — never `npm run migrate:up`'s packaged `--envPath .env.local`, which points at the dev database holding real financial data and does not yield to an exported override. The probe `b8_seed_probe_p0528` (T3) is disposable by design and needs no rollback.

## Open questions
None outstanding. All three of `ITEM.md`'s original questions are resolved: (1) three-way, not boolean — NC #12; (2) the default for non-seeded rows is `'fixed'` via a column `DEFAULT` — NC #1; (3) `is_income`/`exclude_from_budget` rows are classified like every other operational row but excluded from the *scored* set by name — NC #8–9. The `is_debt_service` coupling is a database-enforced one-directional `CHECK`, proven on both `INSERT` and `UPDATE` — NC #4–6. The seed's substance (G0-4) is resolved: the 21-row table is final and owner-accepted on all rows. The seed's verification (G0-5) is resolved: #20–22 are idempotent, explicitly ordered, and run against a probe database distinct from the G1/G4 round-trip database.
