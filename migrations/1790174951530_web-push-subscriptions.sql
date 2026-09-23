-- Up Migration

-- Where an installed PWA is reached for the daily ping — §5 step 26b.
--
-- A sibling of `push_devices` rather than a replacement: that table addresses the Expo app, this one
-- addresses a browser, and both will send during the changeover. `apps/mobile` is retired when 26b
-- ships, and its table goes with it — deliberately not in this migration, because deleting the only
-- working notification path in the same change that introduces an untested one is how an owner ends
-- up with neither.
--
-- ─── WHAT IS NOT STORED HERE, WHICH IS THE POINT ─────────────────────────────────────────────
--
-- A browser's `PushSubscription` carries two more values: `p256dh` and `auth`, the keys a sender
-- needs to ENCRYPT A PAYLOAD. They are absent from this table on purpose.
--
-- This app sends no payload. The ping's text is a constant the service worker already holds
-- (`lib/domain/pushPing.ts`), recorded in plan/tasks/P3-25-push-ping/DECISION.md as the owner's
-- choice: no figure, no category, no merchant leaves the machine. Not storing the encryption keys
-- makes that decision STRUCTURAL rather than a habit — the server cannot send content, because it
-- does not hold what content would have to be encrypted with, and widening the payload would
-- require re-subscribing every device. A visible change, not a silent one.

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  -- The push service's URL for this device. It ADDRESSES A DEVICE, which makes it
  -- credential-shaped in exactly the way `push_devices.token` is: anyone holding it can make this
  -- owner's phone buzz. Primary key rather than a serial, because the endpoint IS the identity and
  -- a second row for one device would send two pings for one event.
  --
  -- No format CHECK. `push_devices` can assert `^ExpoPushToken[...]$` because one vendor issues
  -- them; an endpoint is whatever Apple, Mozilla or Google chooses today, and a pattern here would
  -- reject a valid subscription the first time one of them changed a hostname. `https://` is the
  -- only thing true of all of them and the only thing asserted.
  endpoint TEXT PRIMARY KEY
    CONSTRAINT web_push_subscriptions_endpoint_https CHECK (endpoint LIKE 'https://%'),

  -- Which phone, in the owner's words. The same argument as `auth_sessions.label` and
  -- `push_devices.label`: a list is how a device that should no longer be notified gets found.
  label TEXT
    CONSTRAINT web_push_subscriptions_label_length CHECK (label IS NULL OR length(label) BETWEEN 1 AND 60),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Set on every accepted send: "is anything still listening here?", answerable before somebody
  -- revokes one.
  last_sent_at TIMESTAMPTZ,

  -- The CLASSIFICATION of the last failure, never the body of it. A push service's rejection quotes
  -- the request back, and a table holding no financial data should not start holding it in an error
  -- string. Same reasoning as `alert_sends.failure_reason` and `push_devices.last_error`.
  --
  -- 'gone' is Web Push's 404/410: the subscription is dead and will never work again, which is a
  -- different fact from a transport failure and is the one that should stop the retries.
  last_error TEXT
    CONSTRAINT web_push_subscriptions_last_error_check CHECK (last_error IN ('gone', 'transport', 'rejected')),

  -- A lost phone is one UPDATE, like a revoked session. Kept rather than deleted, so what was
  -- registered survives the revocation.
  revoked_at TIMESTAMPTZ
);

-- Serves the only read on the send path: every live subscription. Partial, because a revoked row is
-- never a send target and there is no query that wants one.
CREATE INDEX IF NOT EXISTS idx_web_push_live
  ON web_push_subscriptions(created_at) WHERE revoked_at IS NULL;

-- Down Migration

DROP INDEX IF EXISTS idx_web_push_live;
DROP TABLE IF EXISTS web_push_subscriptions;
