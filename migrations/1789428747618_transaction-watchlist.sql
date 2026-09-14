-- Up Migration

-- "Keep an eye on this one" — a transaction the owner is not done with. The motivating case is a
-- PENDING RETURN: an item is going back, a refund is expected, and until it lands the charge is
-- real but provisional. Nothing in this schema could say that. `hidden` means "do not count this",
-- which is the opposite claim, and a category means "this is what it was", which is not in doubt.
--
-- ─── One nullable timestamp, not a boolean and a date ─────────────────────────────────────────
--
-- `watched_at IS NOT NULL` IS the flag. A `watched BOOLEAN` alongside a `watched_since TIMESTAMPTZ`
-- would be two columns that can disagree — true with no date, a date with false — and every reader
-- would have to decide which one wins. There is no state here the timestamp cannot express.
--
-- It also answers the question the flag is actually for. "Zara, $120.17" is a fact the transactions
-- page already shows; "Zara, $120.17, flagged eleven days ago" is the one that makes somebody chase
-- the refund. A boolean cannot age, and a watchlist whose entries cannot age is a list that only
-- grows.
--
-- CLEARING IS A NULL, not a `resolved` column. When the refund lands, the thing to look at is the
-- pair of transactions, not a tombstone on one of them — and a `resolved_at` would invite a second
-- reading of "watched" (ever flagged? still flagged?) in every query that touches it.
--
-- ─── The note ────────────────────────────────────────────────────────────────────────────────
--
-- Free text, short, and the owner's own words: "returning to Zara", "wrong size, sent back",
-- "double charged". The reason is the whole value of the flag a week later, when the merchant and
-- the amount no longer recall why anyone cared.
--
-- CHECKed non-empty rather than allowed to be `''`, because an empty string and NULL would be two
-- spellings of "no note" and the UI would eventually produce both. CHECKed to 200 characters
-- because this is a note, not a document: the digest email renders it on one line beside a figure,
-- and a paragraph there would push the amount off a phone.
--
-- A NOTE WITHOUT A FLAG IS REFUSED. `watch_note` is meaningless on a transaction nobody is
-- watching, and permitting the pair would mean a cleared flag could leave its reason behind to be
-- found later by a query filtering on the note instead of on the flag.

ALTER TABLE transactions
  ADD COLUMN watched_at TIMESTAMPTZ,
  ADD COLUMN watch_note TEXT;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_watch_note_length
    CHECK (watch_note IS NULL OR (length(watch_note) BETWEEN 1 AND 200));

ALTER TABLE transactions
  ADD CONSTRAINT transactions_watch_note_needs_flag
    CHECK (watched_at IS NOT NULL OR watch_note IS NULL);

-- Partial, because the watched rows are the rare ones and they are the only ones ever selected by
-- this predicate. A full index over a table that is overwhelmingly NULL here would be mostly a
-- record of rows nobody asks about. Ordered by the timestamp so "oldest first" — the order the
-- digest lists them in, because the oldest is the one most likely to have been forgotten — is the
-- index's own order.
CREATE INDEX idx_transactions_watched
  ON transactions (watched_at)
  WHERE watched_at IS NOT NULL;

-- Down Migration

-- Loses the flags and their notes. They are OBSERVATIONS THAT EXIST NOWHERE ELSE — a note saying
-- "returning to Zara" is not re-derivable from any feed, unlike a category, which can be re-mapped,
-- or a transfer pairing, which can be re-detected. BUILD.md §9.3's standing practice therefore
-- applies in full rather than by exception: back the rows up before running this.
--
--   \copy (SELECT id, date, merchant_name, amount, watched_at, watch_note FROM transactions
--          WHERE watched_at IS NOT NULL) TO 'watchlist-backup.csv' CSV HEADER
--
-- The index goes first: dropping a column drops the index over it, and doing it in that order
-- rather than this one leaves the second statement failing on something already gone.

DROP INDEX IF EXISTS idx_transactions_watched;

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_watch_note_needs_flag,
  DROP CONSTRAINT IF EXISTS transactions_watch_note_length;

ALTER TABLE transactions
  DROP COLUMN IF EXISTS watch_note,
  DROP COLUMN IF EXISTS watched_at;
