-- Up Migration

-- ROADMAP.md §5 step 16. The agent's first ability to CHANGE something, and the gate that stands
-- between proposing and doing.
--
-- WHY A TABLE RATHER THAN A SIGNED TOKEN. A stateless signed proposal looks cheaper until replay is
-- considered: a correctly-signed proposal resent ten times is correctly signed ten times, so
-- single-use requires a store of what has already been spent. Once that store exists, it may as
-- well be the proposal itself -- and then expiry, the audit trail, and "what did the agent ask for
-- last week" all come free rather than being three more mechanisms.
--
-- THIS TABLE IS THE AUDIT TRAIL FOR AGENT-ORIGINATED CHANGE, which is what §3's `mutation_audit_log`
-- was deferred for. It deliberately does NOT log mutations the owner makes directly in the UI:
-- those have a different provenance question and every route would have to participate. Naming that
-- limit here so the gap is visible rather than assumed covered.

CREATE TABLE agent_proposals (
  -- Opaque and CSPRNG, not a serial. This id travels to the browser and comes back as the thing
  -- being confirmed; a guessable one would let anyone who can reach the endpoint confirm a
  -- proposal they never saw.
  id TEXT PRIMARY KEY
    CONSTRAINT agent_proposals_id_format CHECK (id ~ '^[A-Za-z0-9_-]{22,64}$'),

  -- One kind today. The CHECK is the list of effects the gate knows how to apply, so adding a write
  -- tool is a migration -- which is the point: a new effect should not be reachable by a handler
  -- deciding it knows what to do with an unfamiliar string.
  kind TEXT NOT NULL
    CONSTRAINT agent_proposals_kind_check CHECK (kind IN ('categorize_transaction')),

  -- What the change is aimed at. For `categorize_transaction`, `transactions.id`.
  -- No foreign key on purpose: a proposal about a row that has since been deleted must remain
  -- readable as history, and the apply path re-checks existence anyway.
  subject_id INTEGER NOT NULL,

  -- The change asked for: { "category": "Groceries" }.
  proposed JSONB NOT NULL,

  -- THE WORLD AS THE PROPOSAL ASSUMED IT: { "category": "Dining Out" }.
  --
  -- This is optimistic concurrency and it is the difference between a gate and a rubber stamp. The
  -- owner may edit the same transaction in the UI between seeing a proposal and confirming it;
  -- applying blind would silently undo that edit, and the confirmation they clicked would have
  -- described a change that no longer matches reality. Apply compares and refuses on mismatch.
  observed JSONB NOT NULL,

  -- The model's stated reason, shown to the human verbatim. A confirmation with no reason is a
  -- button people learn to click.
  rationale TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Short by design. A proposal is a sentence in a conversation, not a standing instruction, and a
  -- week-old one confirmed by accident is exactly the shape of a mistake nobody can explain later.
  expires_at TIMESTAMPTZ NOT NULL
    CONSTRAINT agent_proposals_expires_after_created CHECK (expires_at > created_at),

  -- Terminal state. NULL `decided_at` is the only definition of "still pending", so the two can
  -- never disagree.
  decided_at TIMESTAMPTZ,
  decision TEXT
    CONSTRAINT agent_proposals_decision_check CHECK (decision IN ('confirmed', 'rejected')),
  CONSTRAINT agent_proposals_decision_iff_decided
    CHECK ((decided_at IS NULL) = (decision IS NULL)),

  -- Whether the effect actually landed. Separate from `decision` because a confirmed proposal can
  -- still fail to apply -- the row moved, the category was renamed -- and "the owner said yes" and
  -- "the ledger changed" are different facts that an audit trail must not conflate.
  applied BOOLEAN NOT NULL DEFAULT FALSE,
  failure_reason TEXT,
  CONSTRAINT agent_proposals_applied_only_when_confirmed
    CHECK (NOT applied OR decision = 'confirmed'),

  -- Provenance, by session. Which credential ASKED and which credential AGREED are different
  -- questions, and the whole design rests on them being allowed to differ: a read-only script may
  -- propose, and only a full-scope human session may confirm.
  proposed_by TEXT REFERENCES auth_sessions(token_hash) ON DELETE SET NULL,
  decided_by TEXT REFERENCES auth_sessions(token_hash) ON DELETE SET NULL
);

-- The dashboard's question: what is waiting for me right now.
CREATE INDEX agent_proposals_pending
  ON agent_proposals (created_at DESC)
  WHERE decided_at IS NULL;

-- AT MOST ONE PENDING PROPOSAL PER SUBJECT PER KIND. Without this, an agent asked the same question
-- three times leaves three pending proposals for one transaction, and confirming them in any order
-- applies the first and fails the other two on the `observed` check -- which is safe but reads to
-- the owner as the feature being broken.
CREATE UNIQUE INDEX agent_proposals_one_pending_per_subject
  ON agent_proposals (kind, subject_id)
  WHERE decided_at IS NULL;

-- Down Migration
DROP TABLE agent_proposals;
