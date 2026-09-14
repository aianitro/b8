-- Up Migration

-- Admit 'digest' as an `alert_sends.kind` (ROADMAP.md §5 Phase 1; the daily digest built in
-- lib/domain/digest.ts and lib/digestRead.ts). One value added to a CHECK, nothing dropped and no
-- row rewritten.
--
-- ─── Why the column needed widening at all ────────────────────────────────────────────────────
--
-- The two values already there — 'projected-breach' and 'coverage' — are the two things the
-- guardrail email could say. The owner read one of those messages and called it "not informative,
-- not actionable", and the surface that replaced it is not a third kind of breach warning: it is a
-- daily report that sends whether or not anything is wrong. Recording it as 'coverage' would put
-- two different messages behind one name in the only table that remembers what was sent, and the
-- gap between rows is the whole diagnostic this table exists to provide.
--
-- ─── This widens a CHECK, which is the safe direction, and that is worth stating ──────────────
--
-- A CHECK that admits MORE values cannot invalidate a row that already satisfies the narrower one,
-- so no existing row is at risk and the constraint does not need validating against the table's
-- history. Narrowing would be the other case entirely: it can fail on data already written, and it
-- would need the rows inspected first. Written as DROP-then-ADD because Postgres has no ALTER for
-- a CHECK's expression; the pair is one statement's worth of intent and runs inside the migration's
-- transaction, so the table is never left without the constraint.
--
-- ─── What is NOT changed here, deliberately ───────────────────────────────────────────────────
--
-- `fingerprint` keeps its `^[0-9a-f]{16,}$` shape, so a digest's fingerprint is a hex digest like
-- every other — the CHECK is what makes "opaque" enforceable rather than merely intended, and a
-- daily message whose fingerprint was a readable date would put the send date in a column the table
-- goes out of its way to keep meaningless.
--
-- `failure_reason` keeps its three literals. A digest fails the same three ways a breach alert
-- does: misconfigured, unreachable, or refused by the provider.
--
-- No column holds a figure, a payee, an account or a ratio, and this migration adds none.

ALTER TABLE alert_sends DROP CONSTRAINT alert_sends_kind_check;
ALTER TABLE alert_sends ADD  CONSTRAINT alert_sends_kind_check
  CHECK (kind IN ('projected-breach', 'coverage', 'digest'));

-- Down Migration

-- Restores the two-value CHECK. It can FAIL, and that is correct rather than unfortunate: if any
-- 'digest' row has been written, the narrower constraint is false of data that exists and Postgres
-- refuses to add it. A rollback that silently deleted those rows to make itself possible would
-- destroy the record of messages that really were sent, in the one table whose purpose is to
-- remember them.
--
-- So the rollback is: decide what to do with the digest rows first, then run this. Deleting them is
-- a decision someone makes with their eyes open, not a side effect of a down migration.

ALTER TABLE alert_sends DROP CONSTRAINT alert_sends_kind_check;
ALTER TABLE alert_sends ADD  CONSTRAINT alert_sends_kind_check
  CHECK (kind IN ('projected-breach', 'coverage'));
