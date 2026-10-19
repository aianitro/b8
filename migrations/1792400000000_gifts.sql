-- Up Migration
-- Gifts between the two people: marked in advance, masked from the recipient until the reveal date
-- (ROADMAP.md §5 Phase 7 step 41b; plan/tasks/P7-41b-gifts/SPEC.md and CONTRACT.md).
--
-- ─── WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────────────────────
--
-- Three new tables and nothing else. No existing column is added to, altered or reinterpreted:
-- transactions keeps every column with its old meaning, and in particular a gift row's
-- mapped_category means exactly what it means on any other row, so every total, budget, year-end
-- and P/L figure sums it the way it would if the owner had filed it there by hand. Masking is a
-- question about WHO IS LOOKING, which no column of transactions can answer, so it lives on the
-- link below and on the gift's reveal date — never on mapped_category, never on hidden, and never
-- on a "masked" flag that a forgotten UPDATE could leave stale.
--
-- No ledger table gains a user column, which 1792300000000 forbids. The only user references here
-- are the giver and the recipient of a gift, and those are facts about the gift, not ownership of
-- anything in the ledger: both people still see and edit the same accounts and transactions.
--
-- THE MASKING PREDICATE, written here once so it is not re-derived per surface with a conjunct
-- missing. A transaction t is masked for viewer V exactly when
--
--     EXISTS (SELECT 1 FROM gift_transactions gt JOIN gifts g ON g.id = gt.gift_id
--              WHERE gt.transaction_id = t.id
--                AND g.reveal_date > CURRENT_DATE
--                AND g.giver_user_id IS DISTINCT FROM V)
--
-- evaluated by Postgres, on its own calendar, in the same statement that reads the row. Reveal is
-- inclusive (revealed when reveal_date <= CURRENT_DATE, so masked while reveal_date > CURRENT_DATE).
-- IS DISTINCT FROM makes a NULL viewer — an unresolved or absent session — a non-giver for free: the
-- giver column is NOT NULL, so NULL is distinct from every giver, and the predicate fails closed
-- without a special case anyone could forget. The gift's state is deliberately NOT a conjunct: a
-- link row exists only while its gift holds the row (see gift_transactions), so a state check would
-- be a second answer to the same question, and a link left behind by a bug masks rather than leaks.

-- ─── gift_settings: which category a matched gift is filed in ─────────────────────────────────
--
-- One row, ever. A singleton table rather than a column on budget_categories, because "the gift
-- category" is a designation of at most one category, and a boolean on every category row would
-- need a partial unique index to say so and would let two writers race to set it on two rows.
--
-- BY id, NEVER BY NAME. transactions.mapped_category is a name and category names are renamed
-- loosely (see category_rules in db/schema.sql); a designation by name would silently stop finding
-- its category at the first rename. Matching reads this id and files the row under the category's
-- name AS IT IS AT MATCH TIME.
--
-- NULL means NO CATEGORY IS DESIGNATED, and creating a gift is then refused (GIFT_CATEGORY_UNSET):
-- a gift that matched would have nowhere to be filed. ON DELETE SET NULL, not NO ACTION, because
-- SPEC.md forbids any change to how a category is deleted — a designation that blocked the delete
-- would be one. When the designated category is deleted, rows already linked stay linked and masked
-- in whatever category they hold; a later match is still linked and masked, and is left in the
-- category it arrived with.
CREATE TABLE gift_settings (
  -- Always TRUE: the primary key plus the CHECK make a second row a statement Postgres refuses.
  singleton    BOOLEAN PRIMARY KEY DEFAULT TRUE
                 CONSTRAINT gift_settings_singleton CHECK (singleton),
  category_id  INTEGER REFERENCES budget_categories(id) ON DELETE SET NULL
);

-- Seeded ONCE, here, from the owner's existing operational category of that name (control_mode
-- seeded by name in 1788271200000). Matched on name AND landscape for the reason that migration
-- gives: budget_categories is UNIQUE (name, landscape). The scalar subquery yields NULL on a fresh
-- or fabricated database that has no such category, so the row always exists and this always
-- applies cleanly; such a database simply has no gift category until one is designated with psql
-- (SPEC.md: no UI or endpoint designates it). This is the only place the name appears outside a
-- test, and it is never read again: the application reads category_id.
INSERT INTO gift_settings (category_id)
SELECT (SELECT id FROM budget_categories
         WHERE name = 'Toys/Gifts/Flowers' AND landscape = 'operational');

-- ─── gifts: one marked-in-advance purchase for the other person ───────────────────────────────
--
-- Criteria are stored exactly as the giver set them and are never edited (SPEC.md non-goals: cancel
-- and re-create). NULL on any criterion means "ANY" — never zero and never an empty string. A NULL
-- amount stored as 0 would match nothing (only rows with amount > 0 match); a blank merchant stored
-- as '' would be a substring of everything. Both are refused below rather than trusted to the route.
CREATE TABLE gifts (
  id                 SERIAL PRIMARY KEY,

  -- Who marked it, and who must not see it. No ON DELETE action: users rows are never deleted
  -- (1792300000000). The giver is the only viewer who ever sees the gift record or a linked row's
  -- real details before the reveal; every other viewer, including a third user, is masked.
  giver_user_id      INTEGER NOT NULL REFERENCES users(id),
  recipient_user_id  INTEGER NOT NULL REFERENCES users(id),

  -- The exact price, a positive magnitude. NUMERIC(12,2), the scale of transactions.amount, so the
  -- match is exact decimal equality in SQL with no rounding anywhere. Only rows with amount > 0
  -- (money out, the Plaid sign convention) are candidates; a gift amount is never negated to match a
  -- refund. NULL = any amount; zero is refused, because a zero gift would match nothing ever.
  amount             NUMERIC(12, 2)
                       CONSTRAINT gifts_amount_positive CHECK (amount IS NULL OR amount > 0),

  -- A case-insensitive substring of the row's merchant_name, or of its name when merchant_name is
  -- NULL. Stored already trimmed (the route trims; the CHECK refuses an untrimmed value, so the
  -- matcher has no trim to forget), and at least 3 characters, so a one-letter criterion cannot
  -- claim half the ledger. The trim set is spelled out rather than left to btrim's default (spaces
  -- only) so whitespace-only criteria made of tabs or newlines are refused too; \x0B is vertical tab,
  -- written as a hex escape because E-strings have no \v. Counted in characters (char_length), not
  -- bytes. At most 200, the bound transactions.note uses for a human-typed string. The criterion is
  -- matched LITERALLY: '%', '_' and regex characters in it are characters, never patterns.
  -- NULL = any merchant.
  merchant           TEXT
                       CONSTRAINT gifts_merchant_criterion CHECK (
                         merchant IS NULL
                         OR (merchant = btrim(merchant, E' \t\n\r\f\x0B')
                             AND char_length(merchant) BETWEEN 3 AND 200)),

  -- Narrows matching to one account. NULL = any account the sync handles. ON UPDATE CASCADE like
  -- every accounts(id) reference, because reconciliation remaps a reissued Plaid account_id in place
  -- and the criterion must follow it. No ON DELETE action: SET NULL would silently widen "this card"
  -- into "any card" (NULL means any), and CASCADE would silently delete the giver's gift. That the
  -- account has a Plaid access token is checked by the route at creation; a CHECK cannot see it.
  account_id         TEXT REFERENCES accounts(id) ON UPDATE CASCADE,

  -- The matching window, both ends INCLUSIVE, as calendar DATEs on the server's calendar (no time of
  -- day, no per-user zone). A one-day window (start = end) is legal.
  window_start       DATE NOT NULL,
  window_end         DATE NOT NULL,

  -- The first day everyone sees real details: revealed when reveal_date <= CURRENT_DATE, evaluated
  -- by Postgres, never by a JS clock. Not before the window opens, which SPEC.md M12 refuses. It MAY
  -- fall inside the window; a gift still unresolved on its reveal date is expired by the daily sweep.
  reveal_date        DATE NOT NULL,

  --   awaiting  — no candidate yet; matching is live.
  --   choose    — two or more candidates arrived; all are linked, filed and masked until the giver
  --               picks one. Later arrivals are added while in this state.
  --   matched   — exactly one row is the gift. Final: later rows matching the criteria are ordinary.
  --   unmatched — the giver was told nothing matched (window end plus the grace period passed, or
  --               the reveal date arrived unresolved). No row is linked.
  --   cancelled — the giver cancelled; every linked row was restored and unlinked.
  -- DEFAULT 'awaiting' because every gift is born there, whoever creates it.
  state              TEXT NOT NULL DEFAULT 'awaiting'
                       CONSTRAINT gifts_state_check
                         CHECK (state IN ('awaiting', 'choose', 'matched', 'unmatched', 'cancelled')),

  -- When the giver was told — the one notice this feature sends, shown to the giver only (in-app,
  -- plus the existing content-free push to the giver's own subscriptions). NULL = NOT TOLD, a stated
  -- departure from null-means-unknown in the manner of auth_sessions.revoked_at: telling is an
  -- event only this app causes, so the absence of a timestamp is knowledge. The sweep sets it once
  -- and never again, which is what makes the notice idempotent.
  notice_at          TIMESTAMPTZ,

  -- Also the tie-break when two gifts compete for one row: the earlier-created gift wins, then the
  -- lower id, independent of evaluation order.
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- No self-gifts. Whether the recipient is a live (unrevoked) user is the route's to check.
  CONSTRAINT gifts_giver_not_recipient CHECK (giver_user_id <> recipient_user_id),

  -- A gift must say SOMETHING about the purchase. With neither an amount nor a merchant, every
  -- outflow in the window would match.
  CONSTRAINT gifts_has_criterion CHECK (amount IS NOT NULL OR merchant IS NOT NULL),

  CONSTRAINT gifts_window_ordered CHECK (window_start <= window_end),
  CONSTRAINT gifts_reveal_not_before_window CHECK (reveal_date >= window_start),

  -- "Unmatched" is a state the giver has been told about; it is reached only by the sweep that tells
  -- them, in the same statement. One-directional: a noticed gift may be in another state (a 'choose'
  -- gift is told at window end and stays 'choose' until the giver picks).
  CONSTRAINT gifts_unmatched_was_told CHECK (state <> 'unmatched' OR notice_at IS NOT NULL)
);

-- ─── gift_transactions: which ledger rows a gift currently holds ──────────────────────────────
--
-- One row per transaction a gift holds right now: the single matched row, or each candidate while
-- the gift is in 'choose'. A row EXISTS HERE ONLY WHILE ITS GIFT HOLDS THE TRANSACTION: a rejected
-- candidate, a released row (cancel) and the candidates of a gift expired at its reveal date are
-- restored and their link row is deleted in the same transaction. A matched gift's link stays after
-- the reveal, harmlessly: the reveal date, not the link's absence, is what unmasks it.
--
-- KEYED ON transactions.id, NEVER ON plaid_transaction_id. Re-identification after a bank re-auth
-- and `npm run rekey:plaid-ids` both rewrite plaid_transaction_id in place and neither ever changes
-- id, so a link on id survives both; a link on the Plaid id would break at exactly those moments.
--
-- transaction_id IS THE PRIMARY KEY: a transaction is held by at most one gift, so two gifts cannot
-- both claim it, and a LEFT JOIN from transactions to this table can never duplicate a row or
-- inflate a sum.
--
-- ON DELETE CASCADE from transactions: when Plaid removes a linked row, the link goes with it in
-- the same statement, so there is no dangling link and no foreign-key error to surface. (The
-- owner's delete of a linked row is refused by the routes while the gift is unrevealed.) The gift
-- itself is not touched by the cascade; the sync returns it to 'awaiting' if it no longer holds any
-- row.
CREATE TABLE gift_transactions (
  transaction_id         INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,

  -- No ON DELETE action: gifts are never deleted (cancel is a state), and a delete that took the
  -- links with it would lose the prior categories below, which exist nowhere else.
  gift_id                INTEGER NOT NULL REFERENCES gifts(id),

  -- What the row held before the link moved it into the gift category, so a rejected candidate, a
  -- released row and a cancelled gift are restored EXACTLY. NULL is a real prior value — the row was
  -- uncategorised — and restores to NULL; it does not mean unknown. Stored rather than recomputed
  -- from category_rules because the rules may have changed since, and restore means "as it was",
  -- not "as a rule would file it today".
  prior_mapped_category  TEXT,
  -- No DEFAULT: the linker read the row and knows the value; a default would assert one it did not
  -- read. While linked, the row itself holds rule_applied = FALSE so rule writes skip it.
  prior_rule_applied     BOOLEAN NOT NULL,

  linked_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Serves "which rows does this gift hold" (choose, cancel, the sweep, GET /api/v1/gifts/[id]).
-- The reverse lookup, the masking predicate, is served by the primary key.
CREATE INDEX gift_transactions_gift ON gift_transactions (gift_id);

-- Down Migration
-- Drops the three tables and nothing else; no existing column was touched, so nothing is restored.
--
-- ROLLING BACK IS A PRIVACY EVENT. With the links gone, every still-unrevealed gift row becomes an
-- ordinary row, visible with real details to the other person at their next page load. Roll back
-- only when no unrevealed gift matters, or after the giver has been told.
--
-- WHAT IS LOST, AND WHAT IS NOT: rows filed in the gift category stay there, including candidates of
-- a gift still in 'choose'. Their prior category and rule_applied exist only in gift_transactions,
-- so back up first (SPEC.md Rollback, BUILD.md §9.3) and restore any candidate by hand with psql:
--
--   \copy (SELECT * FROM gifts ORDER BY id) TO 'backup-gifts.csv' CSV HEADER
--   \copy (SELECT * FROM gift_transactions ORDER BY transaction_id) TO 'backup-gift_transactions.csv' CSV HEADER
--   \copy (SELECT * FROM gift_settings) TO 'backup-gift_settings.csv' CSV HEADER
--
-- Revert the application code before running this, so nothing queries a missing table.

DROP TABLE gift_transactions;
DROP TABLE gifts;
DROP TABLE gift_settings;
