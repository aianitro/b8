-- Up Migration

-- The app's first outbound surface needs a memory (ROADMAP.md §5 Phase 0.5 step 33;
-- plan/tasks/P0.5-33-delivery-channel/SPEC.md, Q4 and Q5). One row per *attempt* to hand a message
-- to the mail provider — not one row per message, and not one row per breach.
--
-- It exists to answer exactly one question for the sending shell:
--
--     has a message with this fingerprint already been DELIVERED?
--
-- and to make legible a failure that is otherwise invisible: an email that does not send looks
-- exactly like a quiet month. Nothing already in this schema remembers that a message existed.
-- sync_log records syncs, and there a job that never sent anything and a job that failed to send
-- every single day are the same empty set.
--
-- ─── What this table deliberately does not hold ───────────────────────────────────────────────
--
-- No figure of any kind. No name of anything the owner spends on. No payee, no account identifier,
-- no dollar, no ratio, no share, no percentage. Not one column below could carry one.
--
-- This is not squeamishness and it is not a style preference. A send log is precisely the row that
-- ends up pasted into an EVIDENCE.md, cropped into a screenshot, or read out of psql while someone
-- debugs a delivery — and BUILD.md §5.4 says real financial data never leaves into logs. Every
-- other table in this schema is read *behind* the app; this one is read by whoever is diagnosing
-- the app, which is a different and much leakier audience. So the redaction is structural: the
-- columns that would carry such a value do not exist, and the two that could have carried one as
-- free text are constrained to shapes that cannot.
--
-- SPEC.md acceptance #71 greps this file for that vocabulary and expects zero lines. That gate
-- reads as pedantry until you notice what it actually catches: a comment naming a figure is a
-- column somebody nearly added.
--
-- ─── Why append-only, and what makes the alternative unwritable ───────────────────────────────
--
-- Like account_valuations and property_valuations, this table is appended to and never updated.
-- "What was last sent" is a derived read here as everywhere else in this repo (BUILD.md §5.3; the
-- duplicated newest-wins reducer that had to be consolidated into latestValueByKey is what that
-- rule is made of).
--
-- The obvious cheaper shape — one mutable row per fingerprint carrying a `last_sent_at`, upserted
-- on every send — was considered and rejected in SPEC.md Q4, and this table is built so it cannot
-- be reintroduced by accident: there is NO unique constraint on fingerprint, and without one there
-- is no ON CONFLICT target, so `INSERT ... ON CONFLICT (fingerprint) DO UPDATE` will not run
-- against this table at all. The absence of that constraint is load-bearing. Do not add it to
-- "clean up duplicates" — the duplicates *are* the history, and a failed attempt followed the next
-- day by a successful one is two rows about one fingerprint on purpose.
--
-- ─── Suppression keys on delivered, never on attempted ────────────────────────────────────────
--
-- `delivered` is the whole reason this is a table and not a log line. The suppression read is
--
--     SELECT 1 FROM alert_sends WHERE fingerprint = $1 AND delivered LIMIT 1
--
-- and it must never be written as `WHERE fingerprint = $1` alone. A guardrail whose first network
-- blip silences it permanently is a guardrail that dies quietly, on the day it was needed, in a
-- way nobody notices for a month. A recorded failure must leave tomorrow's retry free to run.
CREATE TABLE alert_sends (
  id             SERIAL PRIMARY KEY,

  -- When the attempt was made. Every observation table here carries one of these; this one is
  -- doing more work than usual, because the *gap* between rows is itself the diagnostic. Nothing
  -- for three weeks means the job did not run. Three rows with delivered = FALSE means it ran and
  -- could not reach the provider. Those are different problems with different fixes, and without
  -- this table they look identical from outside.
  attempted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Which message this was. The *message* kind, not the transport — there is exactly one transport
  -- (SPEC.md non-goal, "no second destination"), and adding another re-triggers the BUILD.md §5.1
  -- human escalation rather than quietly adding a value here.
  --
  --   'projected-breach' — one or more budget lines are on course to overrun before the month ends
  --   'coverage'         — too little of the month has been classified for the above to be stated
  --                        at all, so the message degrades to the coverage share, a count, and a
  --                        route back into the app (SPEC.md Q2)
  --
  -- A closed CHECK rather than free text, and the two values are genuinely disjoint: a coverage
  -- message and a breach message for the same month must never collide in suppression, which holds
  -- only because `kind` is one of the inputs the fingerprint is computed over. A third message kind
  -- is an additive migration widening this list (BUILD.md §9.2) — the intended path for Phase 3
  -- step 25 and Phase 5 step 38, both of which inherit this step's allowlist.
  kind           TEXT NOT NULL
                   CONSTRAINT alert_sends_kind_check
                   CHECK (kind IN ('projected-breach', 'coverage')),

  -- The opaque digest of what the message said. Computed in lib/, never here. Lowercase hex, at
  -- least 16 characters, and the CHECK is what turns "opaque" into a property of the database
  -- rather than a hope about the caller.
  --
  -- The obvious cheap key — joining the names together with a separator — is exactly what this
  -- constraint exists to refuse. It would work perfectly, and it would write the owner's private
  -- reading of their own spending into the one table most likely to be pasted somewhere public.
  -- The regexp rejects it outright, so that mistake is not available even to a caller who has
  -- forgotten why it matters.
  fingerprint    TEXT NOT NULL
                   CONSTRAINT alert_sends_fingerprint_check
                   CHECK (fingerprint ~ '^[0-9a-f]{16,}$'),

  -- Whether the provider accepted it. NOT NULL and deliberately without a DEFAULT: the shell knows
  -- the outcome by the time it writes this row, and a default would let an INSERT that forgot the
  -- column assert one instead. DEFAULT TRUE would silence every future retry. DEFAULT FALSE would
  -- look harmless while making the log wrong about what actually happened. Neither is worth the
  -- keystrokes it saves.
  delivered      BOOLEAN NOT NULL,

  -- Why not — classified, never transcribed.
  --
  --   'config'    — the settings were absent or unusable and no connection was attempted
  --   'transport' — the provider could not be reached, or refused the connection or the credentials
  --   'rejected'  — the provider was reached and declined the message
  --
  -- Three classes, because they partition the space by construction: did not try; tried and could
  -- not connect; connected and was refused. NULL is the fourth honest answer and needs no value of
  -- its own — see the coupling note below for what NULL means in each kind of row.
  --
  -- Why a closed list and not the error text. A provider's rejection routinely quotes the message
  -- back at you, headers included, and the subject line on this surface carries precisely the
  -- things the section above says this table must never hold. A free-text column here would be a
  -- leak with a plausible excuse attached to it. The detail is not lost: it goes to lib/logger.ts
  -- like every other scheduler failure (SPEC.md Q5), which is where an operator looks anyway, and
  -- which is not the row that gets pasted into a report.
  --
  -- Nobody is ever blocked by this list. A failure fitting none of the three is recorded as NULL
  -- with its detail in the log; no migration is needed to record an outcome nobody anticipated.
  failure_reason TEXT
                   CONSTRAINT alert_sends_failure_reason_check
                   CHECK (failure_reason IN ('config', 'transport', 'rejected')),

  -- What NULL means depends on `delivered`, and both readings are honest:
  --
  --   delivered = TRUE,  failure_reason NULL — it went. There was no failure to classify.
  --   delivered = FALSE, failure_reason NULL — it did not go, and the cause was none of the three;
  --                                            the log for that run has the detail.
  --
  -- The contradictory combination is the one this refuses: a delivered row cannot also carry a
  -- reason it failed. One-directional on purpose, exactly as this repo's existing debt-service
  -- coupling is. The converse — "a failed row must carry a reason" — is deliberately NOT enforced,
  -- because forcing a classification the caller does not actually have produces a placeholder that
  -- reads as a diagnosis and is not one. `delivered` is NOT NULL, so there is no three-valued-logic
  -- hole where a NULL would let this pass by evaluating to UNKNOWN.
  CONSTRAINT alert_sends_delivered_failure_reason_check
    CHECK (NOT delivered OR failure_reason IS NULL)
);

-- The one read this table exists to serve:
--
--     SELECT 1 FROM alert_sends WHERE fingerprint = $1 AND delivered LIMIT 1
--
-- Not partial on `delivered`, deliberately. A partial index would be marginally tighter for that
-- read and would leave SPEC.md Q5's diagnostic read — "what has this job actually been doing" —
-- unserved, and the diagnostic read is the one a human runs while something is already wrong.
--
-- No second index on attempted_at, unlike sync_log. This table grows by roughly one row a day, so
-- a sequential scan over a year of it is a few hundred rows; sync_log carries its index because a
-- sync writes several rows a day and is read on a page render. Stated here so that nobody adds one
-- reflexively for symmetry.
CREATE INDEX idx_alert_sends_fingerprint ON alert_sends(fingerprint);

-- Down Migration

-- A pure schema rollback, and the first one in this repo that destroys nothing worth preserving:
-- every row here records the app's own behaviour, not an observation of the world. Losing the send
-- history costs at most one duplicate message on the first run after a re-apply, because the
-- fingerprint is recomputed from the outlook and the table refills itself from the next attempt.
--
-- No CSV backup is specified, and that is a deliberate exception to BUILD.md §9.3's standing
-- practice rather than an oversight. The standing practice protects observations that exist
-- nowhere else; these rows are reconstructible in the only sense that matters. A CSV of a send log
-- would also be one more copy of exactly the artifact the Up section argues should not be lying
-- around loose in a working directory.
--
-- If a later step ever gives this table a second consumer — a delivery-rate report, or the
-- heartbeat Phase 5 step 39 owns — that reasoning expires and the backup requirement comes back.
--
-- The index is dropped with the table; naming it separately would only imply it could outlive one.

DROP TABLE IF EXISTS alert_sends;
