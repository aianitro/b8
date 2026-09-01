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
