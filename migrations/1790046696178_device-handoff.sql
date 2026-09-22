-- Up Migration

-- ROADMAP.md §5 Phase 3, step 23's remaining piece: how the phone gets a real credential.
--
-- THE PROBLEM THIS SOLVES IS ONE THE AUTH DESIGN CREATED ON PURPOSE. `mayIssueDeviceToken`
-- (lib/bearerAuth.ts) refuses to hand a device token to anything carrying `Sec-Fetch-*` headers —
-- that is, to a browser. So the browser can complete the passkey ceremony and CANNOT receive the
-- token, and the app can receive the token and CANNOT do the ceremony (iOS passkeys are domain-bound
-- and Apple's CDN cannot reach a tailnet-only host to validate an associated domain).
--
-- So: the browser signs in, mints a SHORT-LIVED SINGLE-USE CODE, and hands that to the app. The app
-- exchanges the code for the device token from outside a browser, where it is allowed to.
--
-- This is the OAuth authorization-code shape and it is here for the OAuth reason: a bearer token in
-- a redirect URL ends up in history and in any logging between here and there, while a code that is
-- useless once spent and dead in a minute is worth far less to whoever finds it.

CREATE TABLE device_handoffs (
  -- SHA-256 of the code, never the code. Same rule as `auth_sessions.token_hash`: a row that holds
  -- the secret is a row whose leak is the secret. The CHECK makes storing a raw code a statement
  -- Postgres refuses rather than a convention a caller can forget.
  code_hash TEXT PRIMARY KEY
    CONSTRAINT device_handoffs_code_hash_format CHECK (code_hash ~ '^[0-9a-f]{64}$'),

  -- Which credential completed the ceremony. The device session inherits it, so the phone's session
  -- traces back to the passkey that authorised it rather than to a code that appeared from nowhere.
  credential_id TEXT NOT NULL REFERENCES webauthn_credentials(credential_id) ON DELETE CASCADE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- SIXTY SECONDS. A handoff code is in flight between a browser redirect and one app request; any
  -- longer is a window with no purpose. Short expiry is most of what makes the redirect acceptable.
  expires_at TIMESTAMPTZ NOT NULL
    CONSTRAINT device_handoffs_expires_after_created CHECK (expires_at > created_at),

  -- SINGLE USE. Set when the app claims it. A replayed code is refused on this column rather than on
  -- the clock, so a second claim inside the sixty seconds fails too — the same distinction
  -- `agent_proposals.decided_at` draws between "already decided" and "expired".
  claimed_at TIMESTAMPTZ
);

-- The claim path's read: one code, unclaimed, unexpired. Partial on unclaimed, because a spent code
-- is only ever read as history.
CREATE INDEX device_handoffs_unclaimed ON device_handoffs (expires_at) WHERE claimed_at IS NULL;

-- Down Migration
DROP TABLE device_handoffs;
