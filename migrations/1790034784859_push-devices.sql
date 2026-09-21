-- Up Migration

-- ROADMAP.md §5 Phase 3 step 25. Where to send a ping, and nothing about what is in it.
--
-- THE PAYLOAD DECISION IS RECORDED, NOT IMPLIED: `plan/tasks/P3-25-push-ping/DECISION.md` is the
-- BUILD.md §5.1 escalation §5's outbound carve-out requires every time the destination changes. The
-- owner chose a CONTENT-FREE ping — no category, no figure, no merchant — because the value of push
-- is the interrupt and the figures still travel only over the tailnet. This table therefore holds no
-- financial data and must never grow a column that does.

CREATE TABLE push_devices (
  -- The ExpoPushToken, e.g. `ExponentPushToken[xxxxxxxx]`. It ADDRESSES A DEVICE, which makes it
  -- credential-shaped: anyone holding it can make this owner's phone buzz. Primary key rather than a
  -- serial with a unique index, because the token IS the identity and a second row for the same
  -- device would send two pings for one event.
  token TEXT PRIMARY KEY
    CONSTRAINT push_devices_token_format CHECK (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$'),

  -- The owner's word for which phone. The only way to tell two apart in a list, and a list is how a
  -- device that should no longer be notified gets found — the same argument as `auth_sessions.label`.
  label TEXT
    CONSTRAINT push_devices_label_length CHECK (label IS NULL OR length(label) BETWEEN 1 AND 60),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Set on every accepted send. It answers "is anything still listening on this token?" before
  -- somebody revokes one, which is the question `auth_sessions.last_used_at` exists to answer too.
  last_sent_at TIMESTAMPTZ,

  -- Expo's classification of the last failure, NOT its message. A provider's rejection quotes the
  -- request back, and a table that holds no financial data should not start holding it in an error
  -- string. The closed set mirrors `alert_sends.failure_reason`'s reasoning.
  last_error TEXT
    CONSTRAINT push_devices_last_error_check CHECK (last_error IN ('unregistered', 'transport', 'rejected')),

  -- A lost phone is one UPDATE, like a revoked session. Kept rather than deleted so the history of
  -- what was registered survives the revocation.
  revoked_at TIMESTAMPTZ
);

-- The send path's only read: every device still listening. Partial, because a revoked device is
-- never a send target and this table is small enough that nothing else needs an index.
CREATE INDEX push_devices_active ON push_devices (created_at) WHERE revoked_at IS NULL;

-- Down Migration
DROP TABLE push_devices;
