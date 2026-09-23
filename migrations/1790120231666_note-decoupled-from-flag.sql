-- Up Migration

-- A NOTE IS A NOTE; WATCHING IS A FLAG; NEITHER IMPLIES THE OTHER.
--
-- `watch_note` could only exist alongside `watched_at`, which made writing a comment the same act as
-- putting a row on the watchlist. That was tolerable while the flag only decided what appeared in a
-- list. It stopped being tolerable on 2026-09-22, when watched rows began to be EXCUSED FROM THE
-- BUDGET GRADING (see `getMonthlyActuals` in lib/monthOutlookRead.ts): from that moment a plain
-- comment silently removed its charge from overspend measurement and from the daily email's
-- picture. The owner found it the way these are always found -- an Airbnb charge annotated and then
-- noticed on a list it had no business being on.
--
-- RENAMED, NOT ADDED-AND-BACKFILLED. A rename is pure DDL: every existing note keeps its text, its
-- row keeps its flag, and nothing has to be copied between columns or reconciled afterwards. The
-- alternative -- add `note`, copy, drop `watch_note` -- moves the same data through two more states
-- for no gain, and each of those states is a chance to lose a row's text. The owner asked for no
-- data migration; this is how that request is satisfiable rather than merely honoured.
--
-- What it means for rows that already exist: a note written as a WATCH REASON is now simply a note,
-- and its row stays watched. That is the honest reading -- both facts were true before and both are
-- still true -- and any row whose flag is no longer wanted is one toggle away, which is the fix the
-- owner said they would make by hand.

ALTER TABLE transactions RENAME COLUMN watch_note TO note;

-- The length rule travels with the column. Renamed too, so the constraint's name does not go on
-- describing a column that no longer exists -- a constraint violation quotes its own name, and one
-- naming a vanished column sends the reader looking for the wrong thing.
ALTER TABLE transactions RENAME CONSTRAINT transactions_watch_note_length TO transactions_note_length;

-- THE COUPLING ITSELF. This is the whole point of the migration: a note no longer requires a flag.
ALTER TABLE transactions DROP CONSTRAINT transactions_watch_note_needs_flag;

-- NO `COMMENT ON COLUMN` here, though it is tempting. Nothing else in this schema carries database
-- comments, so one would be the only divergence between a database built from db/schema.sql and one
-- built from these migrations — and that diff is the check this repo uses to prove the two agree.
-- The explanation lives in schema.sql beside the column, where a reader of the schema meets it.

-- Down Migration

-- NOT LOSSLESS, AND IT CANNOT BE. Restoring the constraint requires that no unwatched row holds a
-- note, and after this migration some will. Their text is discarded rather than the rollback
-- failing halfway: a down migration that stops partway through leaves the schema in a state neither
-- version expects, which is worse to be in than a documented loss.
UPDATE transactions SET note = NULL WHERE watched_at IS NULL AND note IS NOT NULL;

ALTER TABLE transactions RENAME COLUMN note TO watch_note;
ALTER TABLE transactions RENAME CONSTRAINT transactions_note_length TO transactions_watch_note_length;
ALTER TABLE transactions ADD CONSTRAINT transactions_watch_note_needs_flag
  CHECK (watched_at IS NOT NULL OR watch_note IS NULL);
