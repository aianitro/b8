-- Up Migration
-- Loyalty: how a linked card's spend earns into a membership, described once per membership
-- (ROADMAP.md §5 Phase 8 step 42b-2; plan/tasks/P8-42b2-card-earn-estimate/SPEC.md and
-- CONTRACT.md). Adds one nullable column to loyalty_memberships and one new table,
-- loyalty_earn_rules. No other table changes.
--
-- ─── WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────────────────────
--
-- An EARN DESCRIPTION is configuration typed by a person: one base rate, and an ordered list of
-- bonus rules, each matching spend by b8 category or by merchant text, each with its own rate. The
-- first matching rule in stored order prices a row; the base rate prices everything else.
--
-- NO ESTIMATE, COMPARISON, "WORTH A LOOK" MARK, SPEND FIGURE, PERIOD OR "LAST COMPARED" DATE IS
-- STORED, under any name. The estimate is derived on every read from the ledger (through the gift
-- read path, so a row held by an unrevealed gift is never spend), these rules, the membership's
-- current reading and Postgres CURRENT_DATE. The comparison is derived from the two latest readings
-- on different dates. Each would go stale the moment a transaction synced, a reading was typed or a
-- rule was edited, and nothing would notice. Editing a rule therefore changes the derived figures
-- for past windows too, on the next read; that is intended (SPEC.md Open question 15).
--
-- A TABLE, NOT A JSON COLUMN, for the rules (SPEC.md Open question 1). Each rule needs a CHECKed
-- kind, a bounded rate and a bounded, trimmed text. A JSON array would move every one of those
-- checks into application code, where a second writer could skip them, and would hide from the
-- schema what the column holds. UNIQUE (membership_id, position) makes the match order total, with
-- no tie for a reader to break differently.
--
-- The rules belong to the MEMBERSHIP, not to the card link, exactly like the benefit columns:
-- unlinking a card (card_account_id set to NULL) keeps them, inert until a card is linked again.
--
-- RATES are NUMERIC(7,4), never float: "units of the estimate's unit per one currency unit of
-- spend". Four decimal places is the precision the API accepts; a fifth digit is refused by the
-- contract, never rounded (the typmod would round silently, which is why the refusal lives in the
-- request schema and nothing here is relied on to catch it). The bounds are zero to one hundred
-- inclusive (the contract's LOYALTY_EARN_MAX_RATE); zero is valid and means "earns nothing", the
-- way to neutralise a category. A rate carries no unit of its own.
--
-- ─── BEFORE ANY `migrate:down` ON A REAL DATABASE ────────────────────────────────────────────
--
-- The down is NOT lossless for the earn description: every base rate and every rule typed while
-- this was live is discarded. The card link, the benefit columns, every membership, observation
-- and instrument are untouched by the down. Back up first (SPEC.md Rollback, BUILD.md §9.3):
--
--   \copy (SELECT id, earn_base_rate FROM loyalty_memberships WHERE earn_base_rate IS NOT NULL ORDER BY id) TO 'backup-loyalty_earn_base.csv' CSV HEADER
--   \copy (SELECT membership_id, position, match_kind, match_text, rate FROM loyalty_earn_rules ORDER BY membership_id, position) TO 'backup-loyalty_earn_rules.csv' CSV HEADER
--
-- A restore re-runs migrate:up and loads both files back by membership id and position.

ALTER TABLE loyalty_memberships
  -- The rate for spend no rule matches. NULL = no earn description stored (then there is no rule
  -- row either, by the route's single-transaction replace), and the estimate is null, never zero.
  -- It is NOT an inheriting column: nothing is resolved through it by COALESCE. No DEFAULT, so
  -- every existing membership starts with no description.
  ADD COLUMN earn_base_rate NUMERIC(7, 4)
    CONSTRAINT loyalty_memberships_earn_base_rate_range
      CHECK (earn_base_rate IS NULL OR earn_base_rate BETWEEN 0 AND 100);

-- One bonus rule of a membership's earn description.
--   position   — the match order: rules are read in ascending position and the first that matches
--                a row decides its rate. The route writes the submitted array order. Only the
--                relative order means anything; gaps are harmless.
--   match_kind — 'category': the row's mapped_category equals match_text after both are trimmed and
--                case-folded (exact equality, never a prefix, substring or pattern).
--                'merchant': match_text, case-folded and whitespace-collapsed, appears as a whole-word
--                literal phrase in the row's name or merchant_name.
--   match_text — stored trimmed (the CHECK refuses an untrimmed value so no comparison has a trim
--                to forget; \x0B is vertical tab, as a hex escape because E-strings have no \v), 1 to
--                100 characters. The tighter merchant rules (at most 60 characters, a restricted
--                character set) are the request schema's; the table holds the bound both kinds share.
--                Always compared literally: a percent sign or underscore is a character, not a
--                wildcard.
--   rate       — as earn_base_rate, but required: a rule with no rate has no meaning.
-- ON DELETE CASCADE from the membership: a rule cannot outlive the membership it describes, and
-- nothing else references a rule.
CREATE TABLE loyalty_earn_rules (
  id             SERIAL PRIMARY KEY,
  membership_id  INTEGER NOT NULL REFERENCES loyalty_memberships(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  match_kind     TEXT NOT NULL
                   CONSTRAINT loyalty_earn_rules_match_kind_check
                     CHECK (match_kind IN ('category', 'merchant')),
  match_text     TEXT NOT NULL
                   CONSTRAINT loyalty_earn_rules_match_text_trimmed
                     CHECK (match_text = btrim(match_text, E' \t\n\r\f\x0B')
                            AND char_length(match_text) BETWEEN 1 AND 100),
  rate           NUMERIC(7, 4) NOT NULL
                   CONSTRAINT loyalty_earn_rules_rate_range CHECK (rate BETWEEN 0 AND 100),
  -- One rule per place in the order, so "first match" has exactly one answer. A second rule at an
  -- existing position is 23505. Its index also serves "this membership's rules, in order".
  CONSTRAINT loyalty_earn_rules_membership_position_key UNIQUE (membership_id, position)
);

-- Down Migration
-- Drops the rule table and the base-rate column (its CHECK goes with it), and nothing else.
-- card_account_id, the three benefit columns, the one-card index, and every membership,
-- observation, instrument, member, program and alias survive. Revert the application code before
-- running this, so nothing queries a missing column or table. Take the two \copy backups in the
-- header first: the earn descriptions are not recoverable otherwise.

DROP TABLE loyalty_earn_rules;
ALTER TABLE loyalty_memberships
  DROP COLUMN earn_base_rate;
