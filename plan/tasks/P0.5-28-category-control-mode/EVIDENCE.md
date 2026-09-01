# EVIDENCE — P0.5-28-category-control-mode

**Author:** implementer  **Date:** 2026-09-01  **Submitted for:** G2

All 22 acceptance commands were run by me, in this repository. Every one passed. Nothing is
reported green that I did not execute. Deviations, caveats and one environment discrepancy I did
**not** act on are in §8.

Environment for #13–22, exported exactly as instructed:

```
export DATABASE_URL="postgresql://localhost:5432/b8_roundtrip_p0528"
export PROBE_DATABASE_URL="postgresql://localhost:5432/b8_seed_probe_p0528"
```

`.env.local`'s `DATABASE_URL` — the dev database holding real financial data — was never read,
never connected to, and never migrated. `npm run migrate:up` / `migrate:down` were never invoked;
every migration step below used `npx node-pg-migrate` with an explicit `DATABASE_URL` override.

## 1. What shipped

| File | Change |
|---|---|
| `lib/domain/adherence.ts` | **new.** One exported predicate, `isScoredCategory`, plus the `ScorableCategory` projection off `BudgetCategory`. No metric. |
| `lib/domain/adherence.test.ts` | **new.** 9 tests, including the six acceptance #3–8 names verbatim. |
| `app/api/categories/route.ts` | **one line.** `control_mode` added to the `GET` handler's `SELECT` list. `POST` / `PATCH` / `DELETE` untouched. |

Nothing else. `git status --short` at submission:

```
 M app/api/categories/route.ts
?? lib/domain/adherence.test.ts
?? lib/domain/adherence.ts
```

No diff in `shared/types.ts`, `db/schema.sql`, `migrations/`, `lib/domain/propertyPnl.ts`,
`app/properties/[id]/page.tsx`, `app/categories/page.tsx`, `components/CategoryManager.tsx`,
`lib/budgetMath.ts`, or anything touching `roundCents`. `AGENTS.md` did not reappear dirty.

## 2. Acceptance commands — summary

| # | Expected | Observed | Verdict |
|---|---|---|---|
| 1 | exit 0 | exit 0 | PASS |
| 2 | exit 0 | exit 0 — 19 files / 307 tests passed | PASS |
| 3 | `1` | `1` | PASS |
| 4 | `1` | `1` | PASS |
| 5 | `1` | `1` | PASS |
| 6 | `1` | `1` | PASS |
| 7 | `1` | `1` | PASS |
| 8 | `1` | `1` | PASS |
| 9 | `≥ 1` | `2` | PASS |
| 10 | `≥ 1` | `8` | PASS |
| 11 | `≥ 1` | `4` | PASS |
| 12 | `≥ 1` | `1` | PASS |
| 13 | prints `fixed`; exits `0` | `fixed`, exit 0 | PASS |
| 14 | prints `fixed`; exits `0` | `fixed`, exit 0 | PASS |
| 15 | exits `1` | exit 1 | PASS |
| 16 | exits `1` | exit 1 | PASS |
| 17 | exits `1` | exit 1 | PASS |
| 18 | prints `fixed`; exits `0` | `fixed`, exit 0 | PASS |
| 19 | exits `1` | exit 1 | PASS |
| 20 | every step exits `0` | exit 0 (run twice, both 0) | PASS |
| 21 | `0` | `0` | PASS |
| 22 | exactly the six lines | the six lines, exact | PASS |

**22 / 22 PASS.** No partials, no skips, no failures.

## 3. Acceptance commands — verbatim output

`EXIT=` lines come from an `echo "EXIT=$?"` run immediately after each command; they are not part
of the command's own output. #20 echoes every migration it applies (568 lines) and is reproduced
in full in Appendix A rather than inline.

### #1

```
npx tsc --noEmit
```

```
(no output)
EXIT=0
```

### #2

```
npm test -- --pool=threads
```

```

> app@0.1.0 test
> vitest run --pool=threads


 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app


 Test Files  19 passed (19)
      Tests  307 passed (307)
   Start at  13:40:37
   Duration  4.29s (transform 433ms, setup 0ms, import 684ms, tests 4.17s, environment 1ms)

EXIT=0
```

### #3

```
npx vitest run --pool=threads --reporter=verbose lib/ | grep -cF "includes an operational, non-excluded, non-income category classified discretionary in the scored set"
```

```
1
EXIT=0
```

### #4

```
npx vitest run --pool=threads --reporter=verbose lib/ | grep -cF "excludes a fixed category from the scored set even though it is operational, not excluded, and not income"
```

```
1
EXIT=0
```

### #5

```
npx vitest run --pool=threads --reporter=verbose lib/ | grep -cF "excludes a variable-necessary category from the scored set — tracked and reported, never scored, same as fixed"
```

```
1
EXIT=0
```

### #6

```
npx vitest run --pool=threads --reporter=verbose lib/ | grep -cF "excludes a capital-landscape category from the scored set even when its control_mode is discretionary"
```

```
1
EXIT=0
```

### #7

```
npx vitest run --pool=threads --reporter=verbose lib/ | grep -cF "excludes an exclude_from_budget category from the scored set even when its control_mode is discretionary"
```

```
1
EXIT=0
```

### #8

```
npx vitest run --pool=threads --reporter=verbose lib/ | grep -cF "excludes an is_income category from the scored set even when its control_mode is discretionary"
```

```
1
EXIT=0
```

### #9

```
grep -c "variable-necessary" shared/types.ts
```

```
2
EXIT=0
```

### #10

```
grep -c "control_mode" db/schema.sql
```

```
8
EXIT=0
```

### #11

```
grep -c "is_debt_service" db/schema.sql
```

```
4
EXIT=0
```

### #12

```
grep -A3 "SELECT id, name, annual_budget" app/api/categories/route.ts | grep -c control_mode
```

```
1
EXIT=0
```

### #13

```
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO budget_categories (name, annual_budget, landscape) VALUES ('spec28-op-default', 1, 'operational') RETURNING control_mode; ROLLBACK;"
```

```
BEGIN
 control_mode 
--------------
 fixed
(1 row)

INSERT 0 1
ROLLBACK
EXIT=0
```

### #14

```
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO budget_categories (name, annual_budget, landscape) VALUES ('spec28-cap-default', 1, 'capital') RETURNING control_mode; ROLLBACK;"
```

```
BEGIN
 control_mode 
--------------
 fixed
(1 row)

INSERT 0 1
ROLLBACK
EXIT=0
```

### #15

```
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO budget_categories (name, annual_budget, landscape, control_mode) VALUES ('spec28-bad-value', 1, 'operational', 'whatever'); ROLLBACK;"
```

```
BEGIN
ERROR:  new row for relation "budget_categories" violates check constraint "budget_categories_control_mode_check"
DETAIL:  Failing row contains (26, spec28-bad-value, 1.00, operational, f, f, 0, null, null, 2026-09-01 13:41:14.434182-07, f, whatever).
EXIT=1
```

### #16

```
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO budget_categories (name, annual_budget, landscape, control_mode) VALUES ('spec28-null-reject', 1, 'operational', NULL); ROLLBACK;"
```

```
BEGIN
ERROR:  null value in column "control_mode" of relation "budget_categories" violates not-null constraint
DETAIL:  Failing row contains (27, spec28-null-reject, 1.00, operational, f, f, 0, null, null, 2026-09-01 13:41:14.455273-07, f, null).
EXIT=1
```

### #17

```
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO budget_categories (name, annual_budget, landscape, is_debt_service, control_mode) VALUES ('spec28-debt-mismatch', 1, 'operational', TRUE, 'discretionary'); ROLLBACK;"
```

```
BEGIN
ERROR:  new row for relation "budget_categories" violates check constraint "budget_categories_debt_service_control_mode_check"
DETAIL:  Failing row contains (28, spec28-debt-mismatch, 1.00, operational, f, f, 0, null, null, 2026-09-01 13:41:14.476511-07, t, discretionary).
EXIT=1
```

### #18

```
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO budget_categories (name, annual_budget, landscape, is_debt_service, control_mode) VALUES ('spec28-debt-ok', 1, 'operational', TRUE, 'fixed') RETURNING control_mode; ROLLBACK;"
```

```
BEGIN
 control_mode 
--------------
 fixed
(1 row)

INSERT 0 1
ROLLBACK
EXIT=0
```

### #19

```
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO budget_categories (name, annual_budget, landscape, is_debt_service, control_mode) VALUES ('spec28-update-fixture', 1, 'operational', TRUE, 'fixed'); UPDATE budget_categories SET control_mode = 'discretionary' WHERE name = 'spec28-update-fixture'; ROLLBACK;"
```

```
BEGIN
INSERT 0 1
ERROR:  new row for relation "budget_categories" violates check constraint "budget_categories_debt_service_control_mode_check"
DETAIL:  Failing row contains (30, spec28-update-fixture, 1.00, operational, f, f, 0, null, null, 2026-09-01 13:41:14.517394-07, t, discretionary).
EXIT=1
```

### #20

```
dropdb --if-exists b8_seed_probe_p0528 && createdb b8_seed_probe_p0528 && DATABASE_URL="$PROBE_DATABASE_URL" npx node-pg-migrate up 1787871600000 --timestamp && psql "$PROBE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO budget_categories (name, annual_budget, landscape) VALUES ('Auto insurance',1,'operational'), ... all 21 tuples, verbatim from SPEC.md ... ;" && DATABASE_URL="$PROBE_DATABASE_URL" npx node-pg-migrate up
```

Run twice, end to end, to exercise NC #16 (idempotency). Both runs exited `0` and left 21
rows. Full output of the second run is **Appendix A**; its tail:

```
  ) AS seed(name, control_mode)
 WHERE bc.name = seed.name
   AND bc.landscape = 'operational';

INSERT INTO "public"."pgmigrations" (name, run_on) VALUES ('1788271200000_category-control-mode', NOW());


Migrations complete!
EXIT=0
```

### #21

```
psql "$PROBE_DATABASE_URL" -tA -c "SELECT COUNT(*) FROM budget_categories WHERE landscape='operational' AND control_mode IS NULL;"
```

```
0
EXIT=0
```

### #22

```
psql "$PROBE_DATABASE_URL" -tA -F',' -c "SELECT name, control_mode FROM budget_categories WHERE landscape='operational' AND name IN ('Auto insurance','Entertainment','Gas','Online services','Pets','Restoraunts') ORDER BY name;"
```

```
Auto insurance,fixed
Entertainment,discretionary
Gas,variable-necessary
Online services,fixed
Pets,variable-necessary
Restoraunts,discretionary
EXIT=0
```

Note on #22: the six lines match the spec's expected block character for character, including
`variable-necessary` on `Gas` and `Pets` — the values a no-op seed would report as `fixed`.

## 4. The migration, quoted verbatim

`migrations/1788271200000_category-control-mode.sql` as committed at G1. **Unmodified by me** —
this is a read of the frozen contract surface, not a diff.

### 4.1 The DDL, excerpted

```sql
ALTER TABLE budget_categories
  ADD COLUMN control_mode TEXT NOT NULL DEFAULT 'fixed'
    CONSTRAINT budget_categories_control_mode_check
    CHECK (control_mode IN ('fixed', 'discretionary', 'variable-necessary'));

ALTER TABLE budget_categories
  ADD CONSTRAINT budget_categories_debt_service_control_mode_check
  CHECK (NOT is_debt_service OR control_mode = 'fixed');
```

### 4.2 The whole file — up **and** down — verbatim

```sql
-- Up Migration

-- A third classification dimension on a budget category, orthogonal to the three it already
-- carries (landscape / exclude_from_budget / is_income): how much of a *decision* the spend is.
--
--   'fixed'              — a contractually or externally set debit. The amount and cadence are
--                          not a month-to-month choice (an insurance premium, a property tax
--                          assessment, a mortgage payment, a subscription).
--   'discretionary'      — the spend is the choice. Both whether and how much are behaviour
--                          (a restaurant dinner, a trip, a gift).
--   'variable-necessary' — necessary, but the amount moves with circumstance and use rather
--                          than with a decision to spend (groceries, fuel, utilities, vet care).
--
-- Why three values and not a boolean `is_discretionary`: utilities are neither a free choice nor
-- a fixed debit, and a boolean has nowhere to put them (ROADMAP.md §5 step 28 makes exactly this
-- argument). The third value is not a hedge — it is the case that forced the dimension.
--
-- Why the column exists at all. An adherence figure averaged over every budget category is
-- diluted by construction: a mortgage payment and a restaurant dinner are both budget lines and
-- only one of them is a decision. A metric mixing them moves when nothing behavioural happened,
-- and looks fine while doing it. This column is what lets the set such a metric ranges over be
-- named out loud:
--
--     landscape = 'operational'
--       AND exclude_from_budget = FALSE
--       AND is_income = FALSE
--       AND control_mode = 'discretionary'
--
-- All four conjuncts are independently required. `variable-necessary` and `fixed` are tracked and
-- reported, never scored. Nothing in this migration computes that set; it only makes it statable.
--
-- NOT NULL with a column DEFAULT, rather than this repo's usual nullable-then-backfill-then-
-- tighten (BUILD.md §9.2): a NULL control_mode would be a fourth, unnamed mode that a later
-- AVG()/COUNT() ranges over silently, which is the precise failure this column exists to remove.
-- The standing "nullable means unknown" rule does not apply here — a missing property valuation
-- is genuinely unknown, whereas every category has a control mode the moment it exists; we may be
-- wrong about it, but we are never ignorant of it. Because the default is a column-level DEFAULT,
-- every pre-existing row is backfilled in this same statement and every future INSERT carries a
-- real value whether or not the inserting code mentions the column.
--
-- The default is 'fixed' and deliberately not 'discretionary'. A blanket 'discretionary' would
-- classify every legacy category — a mortgage payment included — as a scored behavioural choice,
-- which is the exact dilution this step exists to remove. 'fixed' is the conservative reading: it
-- keeps an unreviewed category out of the scored set until someone reviews it.
--
-- The column is physically present on capital-landscape rows too, and its value there is INERT:
-- capital is savings and investment movement, not spending discipline. No consumer may act on
-- control_mode without first checking landscape = 'operational', exactly as exclude_from_budget
-- and is_income are already gated ahead of any category-level flag throughout this codebase. That
-- is predicate discipline, not a DB constraint, matching how those two flags are already
-- unconstrained across landscapes on this table.
ALTER TABLE budget_categories
  ADD COLUMN control_mode TEXT NOT NULL DEFAULT 'fixed'
    CONSTRAINT budget_categories_control_mode_check
    CHECK (control_mode IN ('fixed', 'discretionary', 'variable-necessary'));

-- control_mode and is_debt_service (migrations/1786644696767_debt-service-categories.sql) both
-- classify the same property of a category, and two overlapping classifications of one property on
-- one table is how definitions drift. They are not merged — is_debt_service means something
-- narrower and has its own live consumers (lib/domain/propertyPnl.ts, app/properties/[id]/page.tsx)
-- — so the relationship is stated as a constraint instead: a debt-service category IS the fixed
-- case, and the two dimensions can never be made to disagree.
--
-- One-directional on purpose. is_debt_service ⇒ control_mode = 'fixed'; the converse must NOT
-- hold, because most fixed categories (insurance, taxes, subscriptions) are not debt service.
-- Written as `NOT is_debt_service OR control_mode = 'fixed'` rather than an implication operator
-- Postgres does not have; both columns are NOT NULL, so there is no three-valued-logic hole where
-- a NULL would let the constraint pass by evaluating to UNKNOWN.
--
-- A CHECK rather than application-level validation, because a CHECK also polices UPDATE. An
-- application check placed on the one write path that exists today is silently bypassed by the
-- next write path, by a script, and by a hand-run psql statement.
--
-- Vacuous on today's data, and stated anyway: no *operational* category is currently
-- is_debt_service = TRUE — both mortgage categories are capital-landscape — so this constrains no
-- existing operational row. It is a forward invariant against a future operational debt-service
-- category being simultaneously classified as a behavioural choice. The two capital mortgage rows
-- (is_debt_service = TRUE) satisfy it automatically via DEFAULT 'fixed'; no special-casing needed.
ALTER TABLE budget_categories
  ADD CONSTRAINT budget_categories_debt_service_control_mode_check
  CHECK (NOT is_debt_service OR control_mode = 'fixed');

-- The seed: a one-time, reviewed, literal classification of today's operational categories that
-- are neither income nor excluded from the budget. Owner-signed-off 2026-09-01, all 21 rows
-- accepted as proposed (plan/tasks/P0.5-28-category-control-mode/SPEC.md, "Seed classification").
--
-- Why the seed ships inside the migration rather than through a write path. Without it, the column
-- lands with every row at its 'fixed' default and the scored set is empty by construction —
-- "every category carries a classification" would be true the way a column of zeroes is true, and
-- the step whose whole job is deciding what a category *is* would have decided nothing. There is
-- deliberately no ongoing write path in this task; reclassification is later work. This is the
-- one-time exception, not a mechanism.
--
-- Why a literal enumerated list and not a name-matching heuristic. A regex over "insurance" or
-- "rent" reclassifies silently the first time a category is renamed or added, and its output is
-- unreviewable — the classification would exist without anyone having made it. Every row below was
-- read and accepted individually. Transcribe, do not re-derive.
--
-- Real category *names* appear here as literal matches. That is structural taxonomy, distinct from
-- the amounts, balances, and valuations this project keeps out of committed diffs; the owner was
-- asked and approved. No figure appears in this file.
--
-- Matched on name AND landscape = 'operational' because budget_categories is UNIQUE (name,
-- landscape) — the same name may legitimately exist in both landscapes, and a capital row's
-- control_mode must stay at its inert default. None of these 21 currently collide, but the
-- qualifier is what keeps that true if one ever does.
--
-- A name not present matches zero rows and is a silent no-op, which is correct: this migration
-- must apply cleanly to a fresh or fabricated database that has none of these categories.
--
-- Note what this UPDATE will do if it ever meets a database where an *operational* category is
-- both is_debt_service = TRUE and seeded to something other than 'fixed': the coupling CHECK above
-- aborts the migration. That is the intended outcome. A loud failure at migrate time is the cheap
-- version of the two classifications disagreeing in a headline number later.
UPDATE budget_categories bc
   SET control_mode = seed.control_mode
  FROM (VALUES
    ('Auto insurance',       'fixed'),
    ('Auto service',         'variable-necessary'),
    ('Clothes/Beauty',       'discretionary'),
    ('Education',            'discretionary'),
    ('Entertainment',        'discretionary'),
    ('Gas',                  'variable-necessary'),
    ('Grocery',              'variable-necessary'),
    ('Health',               'variable-necessary'),
    ('Home improvements',    'discretionary'),
    ('One time',             'fixed'),
    ('Online services',      'fixed'),
    ('Pets',                 'variable-necessary'),
    ('Pocket money',         'discretionary'),
    ('Property Taxes',       'fixed'),
    ('Restoraunts',          'discretionary'),
    ('Shared expenses',      'fixed'),
    ('Sport',                'discretionary'),
    ('Toys/Gifts/Flowers',   'discretionary'),
    ('Transportation',       'variable-necessary'),
    ('Travel',               'discretionary'),
    ('Utilities/Maintenance','variable-necessary')
  ) AS seed(name, control_mode)
 WHERE bc.name = seed.name
   AND bc.landscape = 'operational';

-- Deliberately NOT seeded, left at the 'fixed' default:
--   * is_income rows (Salary, Other income (O)) and exclude_from_budget rows (Transfer) — their
--     exclusion from the scored set is already guaranteed by those two flags, whatever
--     control_mode reads.
--   * every capital-landscape row — inert there, per the landscape note above.

-- Down Migration

-- A pure schema rollback. The seeded values are discarded with the column, and no CSV backup is
-- specified for them because they are not observations: the 21 pairs are written literally into
-- the statement above, so re-applying this file restores them exactly for any category still
-- present by name. That equivalence holds only while this task's "no ongoing write path" non-goal
-- holds — it is a property of the seed being a constant, not of anything the database remembers.
-- Once a later task ships a way to reclassify a category, this rollback starts destroying
-- decisions that exist nowhere else, and it must then be preceded by the standing practice
-- (BUILD.md §9.3 — CSV first, always):
--
--   \copy (SELECT name, landscape, control_mode FROM budget_categories ORDER BY landscape, name)
--     TO 'backup-budget_categories-control_mode.csv' CSV HEADER
--
-- The constraint is dropped explicitly before the column rather than relying on DROP COLUMN's
-- cascade to constraints that reference it — the drop order is then readable rather than implied.
-- is_debt_service predates this task and is untouched in both directions.

ALTER TABLE budget_categories
  DROP CONSTRAINT IF EXISTS budget_categories_debt_service_control_mode_check;

ALTER TABLE budget_categories DROP COLUMN IF EXISTS control_mode;
```

## 5. Seed conformance

The orchestrator verified at G1, by sorted diff, that the migration's 21 `(name, control_mode)`
pairs are identical to the frozen spec's signed-off Seed classification table. I have not
re-derived that. **I did run the equivalent check from the other end** — not against the
migration's source text but against what the migration actually wrote into the probe database —
and it is identical, 21/21:

```
$ psql "$PROBE_DATABASE_URL" -tA -F',' -c "SELECT name, control_mode FROM budget_categories WHERE landscape='operational' ORDER BY name;" | sort > probe.txt
$ awk ... plan/tasks/P0.5-28-category-control-mode/SPEC.md | sort > spec.txt   # the 21 Seed classification rows
$ diff probe.txt spec.txt && echo "IDENTICAL 21/21"
IDENTICAL 21/21
```

No discrepancy, none expected. Distribution: 9 `discretionary`, 7 `variable-necessary`, 5 `fixed`,
matching the figures in `GATES.md`'s G1 review.

The scored set on the probe is therefore 9 categories — non-empty, which is the substance of the
G0-4 resolution rather than its letter:

```
$ psql "$PROBE_DATABASE_URL" -tA -c "SELECT name FROM budget_categories WHERE landscape='operational' AND exclude_from_budget=FALSE AND is_income=FALSE AND control_mode='discretionary' ORDER BY name;"
Clothes/Beauty
Education
Entertainment
Home improvements
Pocket money
Restoraunts
Sport
Toys/Gifts/Flowers
Travel
```

That `WHERE` clause is the same four conjuncts `isScoredCategory` evaluates. It appears here as a
**verification query typed at a psql prompt**, not as a second implementation: no file in this
diff — no module, route, migration or `.sql` — contains a second copy of the definition. The one
copy that ships is `lib/domain/adherence.ts`, and it is exported so step 29 imports it rather than
rewriting it.

## 6. Fabricated fixture table — all 21 seeded pairs

Against the probe database acceptance #20 builds and tears down. **Every dollar figure here is
fabricated**: the rows are the placeholders #20 inserts with `annual_budget = 1`, and `1.00` is
literally the only monetary value anywhere in this file. No real amount, balance, or valuation was
read, asserted on, or written in producing this evidence, and the dev database was never touched.
The category *names* are today's real taxonomy, which the frozen spec explicitly approves as
structural rather than financial content.

This covers all 21 seeded pairs, not only the 6 acceptance #22 spot-checks.

```
         name          |  landscape  | annual_budget | exclude_from_budget | is_income | is_debt_service |    control_mode    
-----------------------+-------------+---------------+---------------------+-----------+-----------------+--------------------
 Auto insurance        | operational |          1.00 | f                   | f         | f               | fixed
 Auto service          | operational |          1.00 | f                   | f         | f               | variable-necessary
 Clothes/Beauty        | operational |          1.00 | f                   | f         | f               | discretionary
 Education             | operational |          1.00 | f                   | f         | f               | discretionary
 Entertainment         | operational |          1.00 | f                   | f         | f               | discretionary
 Gas                   | operational |          1.00 | f                   | f         | f               | variable-necessary
 Grocery               | operational |          1.00 | f                   | f         | f               | variable-necessary
 Health                | operational |          1.00 | f                   | f         | f               | variable-necessary
 Home improvements     | operational |          1.00 | f                   | f         | f               | discretionary
 One time              | operational |          1.00 | f                   | f         | f               | fixed
 Online services       | operational |          1.00 | f                   | f         | f               | fixed
 Pets                  | operational |          1.00 | f                   | f         | f               | variable-necessary
 Pocket money          | operational |          1.00 | f                   | f         | f               | discretionary
 Property Taxes        | operational |          1.00 | f                   | f         | f               | fixed
 Restoraunts           | operational |          1.00 | f                   | f         | f               | discretionary
 Shared expenses       | operational |          1.00 | f                   | f         | f               | fixed
 Sport                 | operational |          1.00 | f                   | f         | f               | discretionary
 Toys/Gifts/Flowers    | operational |          1.00 | f                   | f         | f               | discretionary
 Transportation        | operational |          1.00 | f                   | f         | f               | variable-necessary
 Travel                | operational |          1.00 | f                   | f         | f               | discretionary
 Utilities/Maintenance | operational |          1.00 | f                   | f         | f               | variable-necessary
(21 rows)
```

Read against the spec's table: 5 `fixed` (Auto insurance, One time, Online services, Property
Taxes, Shared expenses), 7 `variable-necessary` (Auto service, Gas, Grocery, Health, Pets,
Transportation, Utilities/Maintenance), 9 `discretionary` (Clothes/Beauty, Education,
Entertainment, Home improvements, Pocket money, Restoraunts, Sport, Toys/Gifts/Flowers, Travel).
21 rows, no NULLs, and every `is_debt_service` reads `f` — so the coupling `CHECK` is vacuous on
this fixture, exactly as the spec says it is vacuous on today's operational data. #17/#18/#19 are
what prove it is not vacuous in general.

## 7. `POST` and `PATCH` are unchanged

The complete diff for `app/api/categories/route.ts` is one hunk, inside `GET`:

```diff
diff --git a/app/api/categories/route.ts b/app/api/categories/route.ts
index bd657f1..591cf45 100644
--- a/app/api/categories/route.ts
+++ b/app/api/categories/route.ts
@@ -8,7 +8,7 @@ const log = createLogger('categories');
 
 export async function GET() {
   const result = await db.query<BudgetCategory>(
-    'SELECT id, name, annual_budget, landscape, exclude_from_budget, is_income, dedicated_account_id, monthly_amounts, created_at FROM budget_categories ORDER BY name'
+    'SELECT id, name, annual_budget, landscape, exclude_from_budget, is_income, control_mode, dedicated_account_id, monthly_amounts, created_at FROM budget_categories ORDER BY name'
   );
   return Response.json({ success: true, data: result.rows } satisfies ApiResponse<BudgetCategory[]>);
 }
```

**`POST`, `PATCH` and `DELETE` are byte-for-byte unchanged.** The hunk header is `@@ -8,7 +8,7 @@`;
`POST` begins at line 18, `PATCH` at line 47 and `DELETE` at line 109, all outside it. `PATCH`
still accepts only `is_income`, `annual_budget`, `dedicated_account_id`, `monthly_amounts`, `name`
— no `control_mode` branch was added, per the "no ongoing write path" non-goal. `POST` continues
to `RETURNING *`, which now carries `control_mode` from the column `DEFAULT` without the insert
naming it; acceptance #13 is that exact insert shape and returns `fixed`.

## 8. Notes, deviations, and one thing I did not do

### 8.1 Branch — a discrepancy I flagged rather than resolved

I was dispatched against branch `p0.5-28/category-control-mode`. That branch exists but points at
`dc152c4`, the P0-09a merge. This task's frozen contract commit — `0985eb2` "Classify what a
budget category is: control_mode on budget_categories (P0.5-28)" — and the P-1 hook fix `096b972`
are both on **`main`**, which is 2 commits ahead of both the task branch and `origin/main`.

Checking out the task branch as it stands would remove the frozen contract surface I am required
to build against, so I worked on `main`, where that surface is present. I did **not** move the
branch pointer, rebase, or commit: rearranging git history is outside this task's declared surface,
and guessing at the intended topology is the kind of local workaround the operating rules say to
escalate instead. The three files above are left uncommitted in the working tree for the
orchestrator to place on whichever branch is correct.

### 8.2 Test count

Baseline was 18 files / 298 tests; now 19 files / 307 tests — the 9 in `adherence.test.ts`. Six are
the names #3–8 pin. The other three are the extras #2 was deliberately loosened to permit: the two
non-discretionary modes ranking identically, a multi-conjunct failure that a predicate built with
`||` would wrongly admit, and a whole `BudgetCategory` accepted structurally. None of the three
contains any of the six pinned names as a substring, so #3–8 each still count exactly `1`.

### 8.3 Things I deliberately did not do

- **No dev-database contact of any kind**, and no `npm run migrate:*` invocation.
- **No CSV backup run.** The guardian specified one at G1; the orchestrator deferred it along with
  the dev-database migration, so it was not mine to run. Recorded so its absence is not read as an
  oversight.
- **`NITS.md` N1, N2 and N3 left alone.** `app/categories/page.tsx:9` still holds the type lie N1
  describes — it is an explicit non-goal, and repairing it here would be an out-of-scope diff.
- **No lint or formatting changes.** `npm run lint` exits 0 with the same single pre-existing
  warning (`scripts/seed-demo.mjs:438`) recorded in `GATES.md`.
- **No second scored-set predicate anywhere.** Verified by inspection of the whole diff: three
  files, one definition.

### 8.4 Domain constraints

- **Money math is exact:** this task performs none. `isScoredCategory` returns a boolean and
  touches no amount; `roundCents` and `lib/budgetMath.ts` are untouched. The only figure in this
  bundle is the fabricated `1.00` placeholder.
- **Sign conventions:** N/A — no directional quantity is computed or stored.
- **"Latest" is a derived read:** N/A — `budget_categories` is current-state, not an append-only
  observation series, so there is no history to reduce and nothing that could become a
  last-row-wins shortcut.
- **`null` is not `0`:** `control_mode` is `NOT NULL` on every row in both landscapes (acceptance
  #16, #21), so the predicate has no missing-value case to invent a default for. It does not
  coerce or fall back — an unexpected value would have to pass both a database `CHECK` and a
  TypeScript union, and it would be *excluded* rather than silently read as `discretionary`.
- **Category lookups via `EXISTS`, not `JOIN`:** no cross-table category lookup is added by this
  task. The seed's `UPDATE ... FROM (VALUES ...)` lives in the frozen migration and is keyed on
  `name AND landscape = 'operational'`, so it cannot double-count a name present in both
  landscapes.
- **Real financial data never left the machine:** fabricated fixtures only, throwaway databases
  only, and no real amount in this file, in any command output above, or in anything I reported.

## Appendix A — acceptance #20, full verbatim output (second of two runs)

```
> Migrating files:
> - 1786029579465_baseline-schema
> - 1786078316923_account-valuations
> - 1786082024168_properties
> - 1786136794823_net-worth-snapshots
> - 1786644696767_debt-service-categories
> - 1786646344365_property-transaction-attribution
> - 1787871600000_tenant-held-funds
### MIGRATION 1786029579465_baseline-schema (UP) ###
-- Up Migration

-- Enabled with no schema depending on it yet — groundwork for future semantic search over
-- transaction/merchant history (see ROADMAP.md's pgvector-backed RAG section). On Homebrew
-- Postgres, note the bottled `pgvector` formula only targets postgresql@17/@18; against
-- postgresql@16 it has to be built from source against that version's pg_config.
CREATE EXTENSION IF NOT EXISTS vector;

-- Plaid-linked accounts
CREATE TABLE IF NOT EXISTS accounts (
  id                     TEXT PRIMARY KEY,  -- Plaid account_id (NOT guaranteed permanently stable — see lib/plaidReconcile.ts)
  name                   TEXT NOT NULL,
  type                   TEXT NOT NULL,
  subtype                TEXT,
  mask                   TEXT,              -- last 4 digits, used to re-match accounts if Plaid reissues account_id
  persistent_account_id  TEXT,              -- Plaid's stable identifier, preferred over account_id for reconciliation
  landscape              TEXT NOT NULL DEFAULT 'operational' CHECK (landscape IN ('operational', 'capital')),
  access_token    TEXT,              -- NULL for manually-created accounts
  cursor              TEXT,              -- Plaid sync cursor for incremental updates
  last_synced_at      TIMESTAMPTZ,
  track_transactions  BOOLEAN NOT NULL DEFAULT TRUE,
  bank                TEXT,
  sort_order          INT NOT NULL DEFAULT 0,  -- manual drag-and-drop order within a landscape group on /accounts
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Editable starting balance per account per year; combined with that year's
-- transactions to compute the running/ending balance shown on the account statement.
CREATE TABLE IF NOT EXISTS account_balances (
  account_id         TEXT NOT NULL REFERENCES accounts(id) ON UPDATE CASCADE,
  year               INT NOT NULL,
  beginning_balance  NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, year)
);

-- Budget categories with annual allocations
CREATE TABLE IF NOT EXISTS budget_categories (
  id                    SERIAL PRIMARY KEY,
  name                  TEXT NOT NULL,
  annual_budget         NUMERIC(12, 2) NOT NULL,
  landscape             TEXT NOT NULL DEFAULT 'operational' CHECK (landscape IN ('operational', 'capital')),
  exclude_from_budget   BOOLEAN NOT NULL DEFAULT FALSE,
  is_income             BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order            INT NOT NULL DEFAULT 0,
  dedicated_account_id  TEXT REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE SET NULL,
  monthly_amounts       NUMERIC(12, 2)[], -- expected amount per month (12 values, Jan-Dec); NULL = spread annual_budget evenly across all 12
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, landscape)
);

-- Editable starting balance per category per year, for categories that track a real
-- pool of money (e.g. a rental fund) rather than pure spending — see category_balances
-- below. Mirrors account_balances but keyed by category name, since a category's
-- transactions can span multiple accounts (money moved between them mid-year).
CREATE TABLE IF NOT EXISTS category_balances (
  category_name      TEXT NOT NULL,
  year                INT NOT NULL,
  beginning_balance   NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (category_name, year)
);

-- Rules mapping Plaid categories to user budget categories. mapped_category and
-- transactions.mapped_category below are intentionally not FKs to budget_categories(name)
-- — name alone isn't unique (see UNIQUE(name, landscape) above), and category names are
-- allowed to be renamed/reused loosely.
CREATE TABLE IF NOT EXISTS category_rules (
  id               SERIAL PRIMARY KEY,
  plaid_category   TEXT NOT NULL UNIQUE,
  mapped_category  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A transfer is any set of 2+ transactions whose amounts sum to zero (moving money
-- between your own accounts). Group size isn't fixed at 2 — e.g. one withdrawal
-- split across three deposits nets to zero just as validly as a simple pair.
CREATE TABLE IF NOT EXISTS transfer_groups (
  id         SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Transactions pulled from Plaid
CREATE TABLE IF NOT EXISTS transactions (
  id                    SERIAL PRIMARY KEY,
  plaid_transaction_id  TEXT NOT NULL UNIQUE,
  account_id            TEXT NOT NULL REFERENCES accounts(id) ON UPDATE CASCADE,
  date                  DATE NOT NULL,
  amount                NUMERIC(12, 2) NOT NULL,
  name                  TEXT,
  merchant_name         TEXT,
  plaid_category        TEXT,
  mapped_category       TEXT,
  rule_applied          BOOLEAN NOT NULL DEFAULT FALSE,
  transfer_group_id     INT REFERENCES transfer_groups(id) ON DELETE SET NULL,
  hidden                BOOLEAN NOT NULL DEFAULT FALSE,  -- excluded from budget/dashboard calcs; still visible (grayed out) on /transactions
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_mapped_category ON transactions(mapped_category);
CREATE INDEX IF NOT EXISTS idx_transactions_transfer_group ON transactions(transfer_group_id);

-- One row per sync run, split by phase so the incremental value of a Plaid
-- transactionsRefresh (force) beyond a plain transactionsSync (plain) is visible over time.
CREATE TABLE IF NOT EXISTS sync_log (
  id         SERIAL PRIMARY KEY,
  ran_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger    TEXT NOT NULL,   -- 'scheduler' | 'manual_sync' | 'manual_force'
  phase      TEXT NOT NULL CHECK (phase IN ('plain', 'force')),
  synced     INT NOT NULL,
  unmatched  INT NOT NULL DEFAULT 0,
  errors     INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sync_log_ran_at ON sync_log(ran_at);

-- Editable beginning balance for a whole landscape's budget in a given year — distinct from
-- account_balances (per-account) and category_balances (per-category); this is the top-level
-- number the annual budget page nets everything else against. Found via schema drift: this
-- table existed live but was never captured in db/schema.sql (see app/api/budget/settings/route.ts,
-- app/budget/page.tsx, components/BudgetMonthlyGrid.tsx for its three call sites) — this baseline
-- migration is the first place its definition is actually version-controlled.
CREATE TABLE IF NOT EXISTS budget_settings (
  year                INT NOT NULL,
  landscape           TEXT NOT NULL DEFAULT 'operational',
  beginning_balance   NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (year, landscape)
);
;
INSERT INTO "public"."pgmigrations" (name, run_on) VALUES ('1786029579465_baseline-schema', NOW());


### MIGRATION 1786078316923_account-valuations (UP) ###
-- Up Migration

-- Phase 0 keystone (ROADMAP.md): dual-regime balance model. Operational/ledger accounts keep
-- the existing flow-derived running balance (beginning_balance + Σ transactions) — correct for
-- cash accounts, unchanged by this migration. Capital accounts (brokerage, 401k, real estate,
-- mortgages) get a periodic point-in-time valuation instead, since market-value assets and
-- amortizing liabilities have no meaningful "sum of transactions" balance.
ALTER TABLE accounts
  ADD COLUMN valuation_mode TEXT NOT NULL DEFAULT 'ledger' CHECK (valuation_mode IN ('ledger', 'valuation')),
  ADD COLUMN is_liability   BOOLEAN NOT NULL DEFAULT FALSE;

-- Append-only: one row per observation, not an editable "current value" column, so the manual
-- quarterly entries this starts with naturally become a value-over-time history later (§1f's
-- net_worth_snapshots) without a schema change. "Latest per account" is valued_at DESC LIMIT 1.
CREATE TABLE account_valuations (
  id          SERIAL PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON UPDATE CASCADE,
  value       NUMERIC(14, 2) NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('manual', 'plaid_balance', 'plaid_investments', 'derived')),
  valued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_account_valuations_account_id ON account_valuations(account_id, valued_at DESC);
;
INSERT INTO "public"."pgmigrations" (name, run_on) VALUES ('1786078316923_account-valuations', NOW());


### MIGRATION 1786082024168_properties (UP) ###
-- Up Migration

-- Real estate as a first-class capital asset (ROADMAP.md Phase 0 step 5). Deliberately its own
-- entity, not a shadow "account": a property has no Plaid id, no track_transactions/cursor
-- semantics, and (unlike a brokerage) two independent things move over time — its market
-- value and, separately, the mortgage balance secured against it. Modeling it as an account
-- would leave nowhere to put purchase price / cost basis, and no clean way to net a mortgage
-- against specifically its own property rather than the capital landscape as a whole.
CREATE TABLE properties (
  id             SERIAL PRIMARY KEY,
  nickname       TEXT NOT NULL,
  address        TEXT,
  type           TEXT NOT NULL CHECK (type IN ('primary', 'rental')),
  purchase_price NUMERIC(14, 2),
  purchase_date  DATE,
  -- Starts equal to purchase_price; bumped manually as capital improvements happen. No
  -- separate improvements ledger yet — a single editable running total is the honest v1, same
  -- call as manual valuations below (a real ledger is a later add if per-improvement detail
  -- ever matters for a sale).
  cost_basis     NUMERIC(14, 2),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Same append-only shape as account_valuations, but a property's own market value has no
-- Plaid-sourced counterpart today, so 'source' only has one live value for now — CHECK still
-- named/scoped like account_valuations' so adding an API source (Zillow-shaped) later is a
-- one-line constraint change, not a new table.
CREATE TABLE property_valuations (
  id          SERIAL PRIMARY KEY,
  property_id INT NOT NULL REFERENCES properties(id) ON UPDATE CASCADE,
  value       NUMERIC(14, 2) NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('manual')),
  valued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_property_valuations_property_id ON property_valuations(property_id, valued_at DESC);

-- Links a mortgage LIABILITY account to the property it's secured against, so per-property
-- equity = property_valuations.latest − this account's latest account_valuations balance.
-- Nullable: most accounts (checking, brokerages, unrelated liabilities) have no property.
ALTER TABLE accounts ADD COLUMN property_id INT REFERENCES properties(id) ON UPDATE CASCADE;
;
INSERT INTO "public"."pgmigrations" (name, run_on) VALUES ('1786082024168_properties', NOW());


### MIGRATION 1786136794823_net-worth-snapshots (UP) ###
-- Up Migration

-- Net worth over time (ROADMAP.md Phase 0 step 7). Unlike account_valuations and
-- property_valuations, which record observations of a single thing, this stores the *computed*
-- statement at a point in time — the four components plus their total.
--
-- Stored rather than recomputed because it cannot be reconstructed later: the calculation
-- depends on which accounts existed, how they were classified, and which properties were
-- valued on that date. Deleting an account or reclassifying it from ledger to valuation would
-- silently rewrite every historical figure if the chart derived them on the fly.
--
-- Components are non-overlapping and sum to `total` (see lib/domain/netWorth.ts) — in
-- particular a property-linked mortgage lives inside real_estate_equity and is deliberately
-- absent from liabilities, so the two can never double-count the same debt.
CREATE TABLE net_worth_snapshots (
  snapshot_date      DATE PRIMARY KEY,
  operational        NUMERIC(14, 2) NOT NULL,
  capital_financial  NUMERIC(14, 2) NOT NULL,
  real_estate_equity NUMERIC(14, 2) NOT NULL,
  liabilities        NUMERIC(14, 2) NOT NULL,
  total              NUMERIC(14, 2) NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
;
INSERT INTO "public"."pgmigrations" (name, run_on) VALUES ('1786136794823_net-worth-snapshots', NOW());


### MIGRATION 1786644696767_debt-service-categories (UP) ###
-- Up Migration

-- Lets a *category* mark its transactions as debt service, alongside the existing rule that an
-- account marked `is_liability` does so (see lib/domain/propertyPnl.ts).
--
-- Why a second signal is needed: the per-property P&L flags debt service from the account a
-- transaction sits on, which works only when the mortgage account carries its own payment
-- stream. Myrtle Beach's does — it is Plaid-linked, so `PAYMENT` rows land directly on the
-- liability account. Gastonia's does not: it is a manual account holding a balance and nothing
-- else, while its payments leave from the rental's trust checking account. The liability flag
-- and the payments therefore sit on two different accounts and never meet, so ~$8.8K/yr of
-- mortgage payments were being counted as operating expenses — understating NOI and reporting
-- $0 debt service on a property that plainly has a mortgage.
--
-- Cash flow was unaffected throughout (the payment is subtracted either way), which is exactly
-- why this survived unnoticed: only the middle of the statement was wrong.
--
-- Category-level rather than transaction-level so the classification is stated once and applies
-- to every future payment automatically, including any manual mortgage added later.
ALTER TABLE budget_categories
  ADD COLUMN is_debt_service BOOLEAN NOT NULL DEFAULT FALSE;
;
INSERT INTO "public"."pgmigrations" (name, run_on) VALUES ('1786644696767_debt-service-categories', NOW());


### MIGRATION 1786646344365_property-transaction-attribution (UP) ###
-- Up Migration

-- Attribute a single transaction to a property directly, overriding the account it sits on.
--
-- Until now a property's activity was defined purely by accounts.property_id: everything in a
-- linked account belonged to that property, everything else did not. That is the right default
-- and stays the default — a dedicated trust account per rental has no attribution ambiguity,
-- which is why accounts.property_id was introduced in the first place.
--
-- It breaks whenever the property's money moves through an account that isn't its own. Gastonia
-- is the worked example: its trust checking was opened 2026-03-09, so January through early
-- March of that property's year — mortgage payments, rent, HOA — ran through the primary
-- residence's trust savings and was invisible to the property's statement. Linking that savings
-- account to Gastonia would be worse than the gap, dragging every unrelated primary-residence
-- transaction onto the rental's books.
--
-- Resolution order is COALESCE(t.property_id, a.property_id): an explicit tag wins, the account
-- supplies the default. NULL therefore means "inherit", not "unattributed" — so tagging is
-- purely additive and no existing attribution changes when this column appears.
ALTER TABLE transactions
  ADD COLUMN property_id INT REFERENCES properties(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- Partial: the overwhelming majority of transactions inherit from their account and are never
-- looked up this way, so indexing only the tagged rows keeps this small.
CREATE INDEX idx_transactions_property_id ON transactions(property_id) WHERE property_id IS NOT NULL;

-- Per-property opening cash position, mirroring account_balances and category_balances exactly
-- (same three columns, same composite key, same editable-per-year semantics).
--
-- A property-level balance cannot be derived from its linked accounts once transactions are
-- attributed across account boundaries: Gastonia's operating cash on 2026-01-01 lived in an
-- account that is not linked to it, and its own account did not yet exist. The spreadsheet this
-- replaces keeps exactly this figure — the Gastonia sheet opens at a Beginning balance row —
-- so the concept is the owner's, not an invention of the schema.
CREATE TABLE property_balances (
  property_id        INT NOT NULL REFERENCES properties(id) ON UPDATE CASCADE ON DELETE CASCADE,
  year               INT NOT NULL,
  beginning_balance  NUMERIC(14, 2) NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id, year)
);
;
INSERT INTO "public"."pgmigrations" (name, run_on) VALUES ('1786646344365_property-transaction-attribution', NOW());


### MIGRATION 1787871600000_tenant-held-funds (UP) ###
-- Up Migration

-- Money a rental holds that arrived from its tenant. Two kinds, deliberately in ONE table with a
-- discriminator rather than two sibling tables: they are the same observation motif (per-property,
-- manually entered, positive magnitude, newest-wins) and differ only in how the app treats them.
-- Putting the difference in a column lets the schema state it, right here, next to the thing it
-- describes; splitting them across two tables would leave "which of these reduces net worth?"
-- answered nowhere in the schema and only implicitly in whichever query read which table. A third
-- kind (pet deposit, prepaid HOA) is then a one-line CHECK change rather than a fourth table.
--
--   'security_deposit' — refundable, owed back to the tenant at move-out, and a genuine liability.
--                        The cash sits in the property's trust checking account and is already
--                        counted there at full value, so net worth subtracts it exactly once, in
--                        the `liabilities` component (lib/domain/netWorth.ts). It counts whether
--                        or not the property has a current valuation — deliberately unlike a
--                        linked mortgage, which is netted *against* a property's value and is
--                        therefore dropped along with an unvalued property to avoid a naked debt.
--                        A deposit is netted against nothing; it is owed in full either way.
--   'last_month_rent'  — NOT a liability here, and that omission is a recorded decision rather
--                        than an oversight. Under accrual accounting it would be unearned
--                        revenue; this app is cash-basis throughout (computePropertyPnl sums
--                        transactions), so the payment was already recognized as rent income on
--                        the day it landed. Booking it as a liability now would make the
--                        net-worth statement and the P&L disagree about the same dollar. It is
--                        recorded and shown because "you are holding $X of tenant money" is true
--                        of it too; it contributes to no net-worth component and emits no
--                        contribution line.
--
-- Append-only, same as account_valuations/property_valuations: there is no "current amount"
-- column, so a changed holding is a new row and the history survives. "Currently held" is the
-- newest row per (property_id, kind), reduced through latestValueByKey (lib/domain/observations.ts)
-- rather than last-row-wins — none of the queries that feed it carry an ORDER BY to rely on.
-- No row for a property means the amount is UNKNOWN and renders "—"; a row whose value is 0 is a
-- real reading (a waived deposit, a last month's rent fully applied and not yet re-collected) and
-- renders $0. Nothing may collapse the first case into the second.
--
-- No `source` column, unlike the two valuation tables: those carry one because a Zillow-shaped API
-- is a named, plausible future observer of a property's market value. Nothing outside this app can
-- observe a security deposit, so a column with exactly one permitted value would be ceremony.
CREATE TABLE property_tenant_funds (
  id          SERIAL PRIMARY KEY,
  property_id INT NOT NULL REFERENCES properties(id) ON UPDATE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('security_deposit', 'last_month_rent')),
  -- Named value/valued_at, not amount/recorded_at: this is the third series in the app with the
  -- shape latestValueByKey() reduces, and the other two spell these two fields exactly so. A third
  -- spelling would make the shared reducer look like a coincidence rather than a rule.
  -- Always a positive magnitude; the sign is derived at use (`liabilities -= value`), never stored.
  -- The CHECK has no counterpart on account_valuations/property_valuations, where "always
  -- positive" is only a comment. It is enforced here because this is the one series whose sign is
  -- flipped on read: a negative row would turn an obligation into an asset and *raise* net worth,
  -- with nothing downstream looking wrong.
  value       NUMERIC(14, 2) NOT NULL CHECK (value >= 0),
  valued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_property_tenant_funds_property_id
  ON property_tenant_funds(property_id, kind, valued_at DESC);

-- Marks the boundary between two definitions of `liabilities` (and therefore of `total`).
--
-- P0-09a folded tenant security deposits (property_tenant_funds) into the liabilities component.
-- Rows written before that date mean "unlinked valuation-mode liability accounts"; rows written
-- after mean "…plus security deposits held." Same column, same type, different meaning — BUILD.md
-- §9.2's breaking class, and the one that renders perfectly while being false.
--
-- §9.2's stated remedy is a new field name rather than a redefinition. That remedy is not used
-- here, for a reason worth recording rather than inferring:
--
--   * Nothing reads `liabilities` from this table. app/net-worth/page.tsx selects snapshot_date,
--     operational, capital_financial, real_estate_equity, total; app/dashboard/page.tsx selects
--     snapshot_date, total. A `liabilities_v2` would put a boundary marker on a series no surface
--     plots, and leave the discontinuity that IS plotted — in `total` — unmarked.
--   * `total` is where the break actually lands, and it must not be renamed. It is the headline
--     figure on two pages and the basis of the dashboard's since-first-snapshot delta. Its meaning
--     also has not changed: "net worth on this date, as truthfully as the app could then state
--     it." Every future truthfulness fix would otherwise demand a total_v3, total_v4, and the
--     scheme collapses.
--   * A decomposition column is strictly more useful than a rename. Any post-cutover row converts
--     exactly back to the old definition (`liabilities - liabilities_security_deposits`), so a
--     consumer can plot either definition consistently across the whole history. A rename yields
--     two half-series with no bridge in either direction.
--
-- NULL on pre-cutover rows is the marker AND the honest value: it means "this row predates deposit
-- modelling," not "no deposits were held that day." Deposits were held; they had not been recorded
-- yet, and the figure is unrecoverable. 0 would assert something false, so no backfill is done.
-- Signed exactly as it lands in `liabilities` (i.e. <= 0) — every column in this row is signed as
-- it contributes, and mixing a magnitude in among them is the sign trap this repo has shipped once.
--
-- Load-bearing consequence for whoever writes the snapshot: every INSERT *and* the ON CONFLICT DO
-- UPDATE must set this column. A post-cutover row left NULL claims to be old-definition while
-- carrying a deposit-adjusted `liabilities` — a marker that lies is worse than no marker.
ALTER TABLE net_worth_snapshots
  ADD COLUMN liabilities_security_deposits NUMERIC(14, 2);
;
INSERT INTO "public"."pgmigrations" (name, run_on) VALUES ('1787871600000_tenant-held-funds', NOW());


Migrations complete!
INSERT 0 21
> Migrating files:
> - 1788271200000_category-control-mode
### MIGRATION 1788271200000_category-control-mode (UP) ###
-- Up Migration

-- A third classification dimension on a budget category, orthogonal to the three it already
-- carries (landscape / exclude_from_budget / is_income): how much of a *decision* the spend is.
--
--   'fixed'              — a contractually or externally set debit. The amount and cadence are
--                          not a month-to-month choice (an insurance premium, a property tax
--                          assessment, a mortgage payment, a subscription).
--   'discretionary'      — the spend is the choice. Both whether and how much are behaviour
--                          (a restaurant dinner, a trip, a gift).
--   'variable-necessary' — necessary, but the amount moves with circumstance and use rather
--                          than with a decision to spend (groceries, fuel, utilities, vet care).
--
-- Why three values and not a boolean `is_discretionary`: utilities are neither a free choice nor
-- a fixed debit, and a boolean has nowhere to put them (ROADMAP.md §5 step 28 makes exactly this
-- argument). The third value is not a hedge — it is the case that forced the dimension.
--
-- Why the column exists at all. An adherence figure averaged over every budget category is
-- diluted by construction: a mortgage payment and a restaurant dinner are both budget lines and
-- only one of them is a decision. A metric mixing them moves when nothing behavioural happened,
-- and looks fine while doing it. This column is what lets the set such a metric ranges over be
-- named out loud:
--
--     landscape = 'operational'
--       AND exclude_from_budget = FALSE
--       AND is_income = FALSE
--       AND control_mode = 'discretionary'
--
-- All four conjuncts are independently required. `variable-necessary` and `fixed` are tracked and
-- reported, never scored. Nothing in this migration computes that set; it only makes it statable.
--
-- NOT NULL with a column DEFAULT, rather than this repo's usual nullable-then-backfill-then-
-- tighten (BUILD.md §9.2): a NULL control_mode would be a fourth, unnamed mode that a later
-- AVG()/COUNT() ranges over silently, which is the precise failure this column exists to remove.
-- The standing "nullable means unknown" rule does not apply here — a missing property valuation
-- is genuinely unknown, whereas every category has a control mode the moment it exists; we may be
-- wrong about it, but we are never ignorant of it. Because the default is a column-level DEFAULT,
-- every pre-existing row is backfilled in this same statement and every future INSERT carries a
-- real value whether or not the inserting code mentions the column.
--
-- The default is 'fixed' and deliberately not 'discretionary'. A blanket 'discretionary' would
-- classify every legacy category — a mortgage payment included — as a scored behavioural choice,
-- which is the exact dilution this step exists to remove. 'fixed' is the conservative reading: it
-- keeps an unreviewed category out of the scored set until someone reviews it.
--
-- The column is physically present on capital-landscape rows too, and its value there is INERT:
-- capital is savings and investment movement, not spending discipline. No consumer may act on
-- control_mode without first checking landscape = 'operational', exactly as exclude_from_budget
-- and is_income are already gated ahead of any category-level flag throughout this codebase. That
-- is predicate discipline, not a DB constraint, matching how those two flags are already
-- unconstrained across landscapes on this table.
ALTER TABLE budget_categories
  ADD COLUMN control_mode TEXT NOT NULL DEFAULT 'fixed'
    CONSTRAINT budget_categories_control_mode_check
    CHECK (control_mode IN ('fixed', 'discretionary', 'variable-necessary'));

-- control_mode and is_debt_service (migrations/1786644696767_debt-service-categories.sql) both
-- classify the same property of a category, and two overlapping classifications of one property on
-- one table is how definitions drift. They are not merged — is_debt_service means something
-- narrower and has its own live consumers (lib/domain/propertyPnl.ts, app/properties/[id]/page.tsx)
-- — so the relationship is stated as a constraint instead: a debt-service category IS the fixed
-- case, and the two dimensions can never be made to disagree.
--
-- One-directional on purpose. is_debt_service ⇒ control_mode = 'fixed'; the converse must NOT
-- hold, because most fixed categories (insurance, taxes, subscriptions) are not debt service.
-- Written as `NOT is_debt_service OR control_mode = 'fixed'` rather than an implication operator
-- Postgres does not have; both columns are NOT NULL, so there is no three-valued-logic hole where
-- a NULL would let the constraint pass by evaluating to UNKNOWN.
--
-- A CHECK rather than application-level validation, because a CHECK also polices UPDATE. An
-- application check placed on the one write path that exists today is silently bypassed by the
-- next write path, by a script, and by a hand-run psql statement.
--
-- Vacuous on today's data, and stated anyway: no *operational* category is currently
-- is_debt_service = TRUE — both mortgage categories are capital-landscape — so this constrains no
-- existing operational row. It is a forward invariant against a future operational debt-service
-- category being simultaneously classified as a behavioural choice. The two capital mortgage rows
-- (is_debt_service = TRUE) satisfy it automatically via DEFAULT 'fixed'; no special-casing needed.
ALTER TABLE budget_categories
  ADD CONSTRAINT budget_categories_debt_service_control_mode_check
  CHECK (NOT is_debt_service OR control_mode = 'fixed');

-- The seed: a one-time, reviewed, literal classification of today's operational categories that
-- are neither income nor excluded from the budget. Owner-signed-off 2026-09-01, all 21 rows
-- accepted as proposed (plan/tasks/P0.5-28-category-control-mode/SPEC.md, "Seed classification").
--
-- Why the seed ships inside the migration rather than through a write path. Without it, the column
-- lands with every row at its 'fixed' default and the scored set is empty by construction —
-- "every category carries a classification" would be true the way a column of zeroes is true, and
-- the step whose whole job is deciding what a category *is* would have decided nothing. There is
-- deliberately no ongoing write path in this task; reclassification is later work. This is the
-- one-time exception, not a mechanism.
--
-- Why a literal enumerated list and not a name-matching heuristic. A regex over "insurance" or
-- "rent" reclassifies silently the first time a category is renamed or added, and its output is
-- unreviewable — the classification would exist without anyone having made it. Every row below was
-- read and accepted individually. Transcribe, do not re-derive.
--
-- Real category *names* appear here as literal matches. That is structural taxonomy, distinct from
-- the amounts, balances, and valuations this project keeps out of committed diffs; the owner was
-- asked and approved. No figure appears in this file.
--
-- Matched on name AND landscape = 'operational' because budget_categories is UNIQUE (name,
-- landscape) — the same name may legitimately exist in both landscapes, and a capital row's
-- control_mode must stay at its inert default. None of these 21 currently collide, but the
-- qualifier is what keeps that true if one ever does.
--
-- A name not present matches zero rows and is a silent no-op, which is correct: this migration
-- must apply cleanly to a fresh or fabricated database that has none of these categories.
--
-- Note what this UPDATE will do if it ever meets a database where an *operational* category is
-- both is_debt_service = TRUE and seeded to something other than 'fixed': the coupling CHECK above
-- aborts the migration. That is the intended outcome. A loud failure at migrate time is the cheap
-- version of the two classifications disagreeing in a headline number later.
UPDATE budget_categories bc
   SET control_mode = seed.control_mode
  FROM (VALUES
    ('Auto insurance',       'fixed'),
    ('Auto service',         'variable-necessary'),
    ('Clothes/Beauty',       'discretionary'),
    ('Education',            'discretionary'),
    ('Entertainment',        'discretionary'),
    ('Gas',                  'variable-necessary'),
    ('Grocery',              'variable-necessary'),
    ('Health',               'variable-necessary'),
    ('Home improvements',    'discretionary'),
    ('One time',             'fixed'),
    ('Online services',      'fixed'),
    ('Pets',                 'variable-necessary'),
    ('Pocket money',         'discretionary'),
    ('Property Taxes',       'fixed'),
    ('Restoraunts',          'discretionary'),
    ('Shared expenses',      'fixed'),
    ('Sport',                'discretionary'),
    ('Toys/Gifts/Flowers',   'discretionary'),
    ('Transportation',       'variable-necessary'),
    ('Travel',               'discretionary'),
    ('Utilities/Maintenance','variable-necessary')
  ) AS seed(name, control_mode)
 WHERE bc.name = seed.name
   AND bc.landscape = 'operational';

-- Deliberately NOT seeded, left at the 'fixed' default:
--   * is_income rows (Salary, Other income (O)) and exclude_from_budget rows (Transfer) — their
--     exclusion from the scored set is already guaranteed by those two flags, whatever
--     control_mode reads.
--   * every capital-landscape row — inert there, per the landscape note above.
;
INSERT INTO "public"."pgmigrations" (name, run_on) VALUES ('1788271200000_category-control-mode', NOW());


Migrations complete!
EXIT=0
```
