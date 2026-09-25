-- A rule can now name a MERCHANT, not only a Plaid category.
--
-- ─── Why ──────────────────────────────────────────────────────────────────────────────────────
--
-- `category_rules` matched on `plaid_category` alone, and Plaid's primary categories are too coarse
-- to file with: `FOOD_AND_DRINK` covers the supermarket and the pizzeria alike. The owner's one
-- rule mapped it to Grocery, so every restaurant arrived as groceries — 152 rows filed that way and
-- 114 corrected by hand before the rule was deleted. Deleting it stops the damage and leaves no way
-- to say the thing that is actually true: Panda Express is always Restoraunts.
--
-- ─── Shape ────────────────────────────────────────────────────────────────────────────────────
--
-- One table, two kinds of rule, exactly one match column populated per row. The alternative was a
-- second table, which duplicates `mapped_category`, the apply logic and the UI, and then has to
-- define precedence ACROSS tables anyway.
--
-- `plaid_category` becomes nullable, which it could not be while it was the only way to match.
-- The table is empty at the time of writing — the owner deleted the only row — so nothing is
-- migrated and the CHECK cannot fail on existing data.

ALTER TABLE category_rules ALTER COLUMN plaid_category DROP NOT NULL;
ALTER TABLE category_rules ADD COLUMN merchant_name TEXT;

-- EXACTLY ONE, never both and never neither. A rule matching on both would need a precedence story
-- inside a single row, and a rule matching on neither would apply to everything.
ALTER TABLE category_rules ADD CONSTRAINT category_rules_one_match_kind
  CHECK ((plaid_category IS NULL) <> (merchant_name IS NULL));

-- Matching is case-insensitive, so uniqueness must be too, or "Panda Express" and "panda express"
-- become two rules that disagree and whichever is read last wins.
CREATE UNIQUE INDEX category_rules_merchant_lower ON category_rules (LOWER(merchant_name))
  WHERE merchant_name IS NOT NULL;

-- The original UNIQUE constraint on `plaid_category` allowed only one row per category, which is
-- still right; it now has to tolerate the NULLs that merchant rules carry. Postgres treats NULLs as
-- distinct in a unique constraint, so this needs no change — recorded here because reading the
-- constraint list and assuming otherwise is the easy mistake.
