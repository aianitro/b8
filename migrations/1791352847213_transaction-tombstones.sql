-- Up Migration
-- A transaction the owner deleted stays deleted.
--
-- ─── WHY DELETING WAS NOT ENOUGH ──────────────────────────────────────────────────────────────
--
-- `DELETE /api/v1/transactions/[id]` removes the row, and the next sync can bring it back. Plaid
-- has no idea the owner deleted anything: if it sends `modified` for that id, the sync upsert
-- inserts the row again. If the cursor is ever reset, the same happens through `added`. Nothing in
-- `transactions` can prevent that, because the row that would carry the "deleted" fact is gone.
-- The fact has to be stored somewhere that outlives the row, which is what this table is.
--
-- ─── WHY THE KEY IS THE PLAID ID AND NOTHING ELSE ─────────────────────────────────────────────
--
-- Sync is the only reader, and the only thing it has for an incoming transaction is
-- `transaction_id`. `transactions.plaid_transaction_id` is TEXT NOT NULL UNIQUE on every row,
-- including the synthetic `manual_` and `csv_` ids, so every deletable row has a key to tombstone.
-- Tombstones for synthetic ids are harmless: sync never receives them, and the CSV importer and
-- manual create deliberately do not read this table.
--
-- No account, date, amount or name. After a bank re-auth, Plaid issues NEW ids for the same real
-- transactions, so a deleted transaction can come back under its new id. This table does NOT
-- cover that. Closing the gap would mean matching on account, date, amount and name, which is a
-- different data shape with its own false positives (two identical coffees on one day). It is a
-- known, documented limit, not an oversight.
--
-- ─── WHY THERE IS NO FOREIGN KEY TO transactions ──────────────────────────────────────────────
--
-- A tombstone exists to outlive the row it names. With an FK, the delete it records would either
-- be refused (RESTRICT) or would take the tombstone with it (CASCADE / SET NULL). It also must
-- survive `TRUNCATE transactions ... CASCADE`, which the integration suites run; a linked table
-- would be truncated along with it.
--
-- ─── ONLY THE OWNER WRITES HERE ───────────────────────────────────────────────────────────────
--
-- Plaid's own `removed` events delete the row and write NO tombstone. Plaid removing a transaction
-- (usually a pending one replaced by its posted form) is Plaid's view changing, not the owner's
-- decision. If the same id came back later, it would be because Plaid changed its mind again, and
-- that is not something to override.
--
-- A tombstone is permanent. There is no endpoint that removes one and no expiry. The table grows by
-- one small row per owner deletion.
CREATE TABLE IF NOT EXISTS transaction_tombstones (
  -- The sole key. An empty string would never match anything sync receives, so a row holding one
  -- means the delete read the key from somewhere other than the row it removed, for example after
  -- the row was already gone. The CHECK turns that into a failed delete, rolled back with it,
  -- instead of a tombstone that silently protects nothing.
  plaid_transaction_id TEXT PRIMARY KEY
    CONSTRAINT transaction_tombstones_key_not_empty CHECK (plaid_transaction_id <> ''),

  -- When this id was FIRST tombstoned. A second delete of the same id (possible only for a `csv_`
  -- row re-created by re-importing its file) leaves the existing row as it is, so this is never
  -- moved forward. It records the owner's decision, not the latest repeat of it.
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Down Migration
-- Drops only this table. Any tombstones recorded are lost, which means only that Plaid could
-- re-create those deleted transactions again. `transactions` is untouched in both directions.
DROP TABLE IF EXISTS transaction_tombstones;
