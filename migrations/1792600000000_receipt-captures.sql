-- Up Migration

-- A RECEIPT PHOTOGRAPHED BEFORE ITS CHARGE EXISTS, AND THE WATCH FOR THAT CHARGE.
--
-- At a restaurant the bill is in hand days before the bank posts the charge, and the posted charge
-- is the bill plus whatever tip was written on the slip. The owner photographs the receipt, a model
-- reads the merchant and the total, the owner confirms the charge they expect, and every sync after
-- that looks for it. A posted charge of exactly that amount is linked and the photo attached to it.
-- One from the same merchant for a different amount is an alert, because a charge that differs from
-- the signed slip is the thing worth catching. Nothing within seven days is an alert too.
--
-- SEPARATE FROM transaction_receipts, which is keyed by a transaction that here does not exist yet.
-- On a match the image is copied there, so a receipt attached by hand and one attached by the watch
-- read the same way; the capture keeps its own copy, because a link the owner rejects must be able
-- to go back to waiting with its photo.
--
-- PERSONAL, NOT LEDGER. captured_by is the person who took the photo, and only they see the capture,
-- its alert and its push. A capture is not shared bookkeeping the way a transaction is: it is one
-- person's claim about what they will be charged. Rows are never attributed by guess; the route sets
-- it from the session.
CREATE TABLE receipt_captures (
  id              SERIAL PRIMARY KEY,
  -- No ON DELETE: users rows are never deleted.
  captured_by     INTEGER NOT NULL REFERENCES users(id),
  -- The day on the phone's calendar, which is the day the meal was paid for. The match window is
  -- counted from it, and the server's calendar can be a day behind the owner's.
  captured_on     DATE NOT NULL,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The same image rules as transaction_receipts: the type read from the bytes by the route.
  content_type    TEXT NOT NULL
                    CONSTRAINT receipt_captures_content_type CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  image           BYTEA NOT NULL
                    CONSTRAINT receipt_captures_image_size CHECK (octet_length(image) BETWEEN 1 AND 4194304),
  -- As the model read it, or as the owner corrected it. Matched against the bank's merchant text.
  merchant        TEXT
                    CONSTRAINT receipt_captures_merchant_length CHECK (merchant IS NULL OR char_length(merchant) BETWEEN 1 AND 200),
  -- What the model read off the photo, kept beside what the owner confirmed so a wrong reading can
  -- be seen for what it was. NULL when nothing could be read.
  read_total      NUMERIC(12, 2)
                    CONSTRAINT receipt_captures_read_total_positive CHECK (read_total IS NULL OR read_total > 0),
  -- The charge the owner expects, in the ledger's sign (positive is money out). NULL only while the
  -- capture is a draft the owner has not confirmed.
  expected_amount NUMERIC(12, 2)
                    CONSTRAINT receipt_captures_expected_positive CHECK (expected_amount IS NULL OR expected_amount > 0),
  -- draft     read, not yet confirmed; nothing is watched.
  -- waiting   confirmed; each sync looks for the charge.
  -- matched   linked to a charge of exactly the expected amount; the photo is on the transaction.
  -- mismatch  linked to the merchant's charge, for a different amount; an open alert.
  -- overdue   no charge seven days after the meal; an open alert.
  -- closed    the owner settled it: a difference accepted, a cash payment, or a draft abandoned.
  state           TEXT NOT NULL DEFAULT 'draft'
                    CONSTRAINT receipt_captures_state_check
                      CHECK (state IN ('draft', 'waiting', 'matched', 'mismatch', 'overdue', 'closed')),
  -- When state last changed, so an alert can say how long it has been open.
  state_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The charge it was linked to. UNIQUE: two captures cannot claim one charge, however two watch
  -- runs interleave. SET NULL rather than CASCADE: if the owner deletes the transaction, the capture
  -- and its photo stay, with charged_amount saying what the charge was.
  transaction_id  INTEGER UNIQUE REFERENCES transactions(id) ON DELETE SET NULL,
  -- The posted amount at the moment of linking, in the ledger's sign.
  charged_amount  NUMERIC(12, 2),
  -- Charges the owner said were not this receipt's, so the watch does not offer them again.
  rejected_ids    INTEGER[] NOT NULL DEFAULT '{}',
  -- Confirmed means an amount to look for.
  CONSTRAINT receipt_captures_confirmed_has_amount CHECK (state = 'draft' OR expected_amount IS NOT NULL),
  -- A link records what was charged; matched and mismatch are links.
  CONSTRAINT receipt_captures_link_has_charge CHECK (transaction_id IS NULL OR charged_amount IS NOT NULL),
  CONSTRAINT receipt_captures_linked_states_charged CHECK (state NOT IN ('matched', 'mismatch') OR charged_amount IS NOT NULL)
);

-- What every sync reads: the captures still waiting.
CREATE INDEX receipt_captures_waiting ON receipt_captures (captured_on) WHERE state = 'waiting';
-- A person's own list.
CREATE INDEX receipt_captures_by_person ON receipt_captures (captured_by, captured_at DESC);

-- Down Migration

-- NOT LOSSLESS: every capture and its photo is discarded. Photos already copied onto transactions
-- stay in transaction_receipts. Back up first if any matter.
DROP TABLE receipt_captures;
