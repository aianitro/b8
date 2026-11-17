-- Up Migration

-- A PHOTO OF THE RECEIPT, KEPT WITH THE TRANSACTION IT PROVES.
--
-- IN POSTGRES, NOT ON A DISK BESIDE IT. The nightly pg_dump is this app's one backup, and the restore
-- it rehearses is a database restore. A receipt kept as a file would need a second backup, a second
-- restore, and a reconciliation between them — a row pointing at a file that is gone, or a file no
-- row points at. As a column, a receipt is backed up, restored and deleted with its transaction, by
-- the machinery that already exists. The cost is dump size, which the size bound below keeps small:
-- the phone shrinks a photo before it is sent, so a typical receipt is a few hundred kilobytes.
--
-- ONE PER TRANSACTION. Its primary key is the transaction, so attaching again replaces. A second
-- photo of the same purchase is a re-take, not a second document.
--
-- ON DELETE CASCADE: a receipt for a transaction that no longer exists proves nothing. Sync never
-- deletes and re-inserts a posted row (a reissued Plaid id renames the row in place), so the
-- cascade fires only on the owner's own delete.
CREATE TABLE transaction_receipts (
  transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
  -- What the bytes are, checked against their magic number by the route before the write. Served
  -- back verbatim as the response's Content-Type, so only image types a browser renders inertly.
  content_type   TEXT NOT NULL
                   CONSTRAINT transaction_receipts_content_type CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  image          BYTEA NOT NULL
                   -- 4 MiB. The phone sends far less; this is the backstop against a raw camera file
                   -- posted by hand, and it sits under the proxy's 10 MB body buffer so a body the
                   -- route reads is always a whole one.
                   CONSTRAINT transaction_receipts_image_size CHECK (octet_length(image) BETWEEN 1 AND 4194304),
  attached_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Down Migration

-- NOT LOSSLESS: every attached receipt is discarded with the table. Back up first if any matter.
DROP TABLE transaction_receipts;
