-- Up Migration

-- P1-12a. `auth_sessions` stops meaning only "a browser signed in" and starts holding three kinds of
-- session, so the phone app and the owner's scripts are admitted by the same lookup, revoked by the
-- same UPDATE, and listed by the same query as the browser. See lib/bearerAuth.ts for the rules.
--
-- EVERY EXISTING ROW IS A BROWSER SESSION, and the defaults say so, so this migration changes the
-- meaning of nothing already stored.

ALTER TABLE auth_sessions
  -- browser: the cookie session, 12h fixed. device: a phone app, 30 days sliding.
  -- personal: minted over SSH for a script, named, fixed lifetime.
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'browser'
    CONSTRAINT auth_sessions_kind_check CHECK (kind IN ('browser', 'device', 'personal')),

  -- full: whatever the boundary allows. read: safe methods plus the chat endpoint.
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'full'
    CONSTRAINT auth_sessions_scope_check CHECK (scope IN ('full', 'read')),

  -- The owner's name for a personal token — "eval runner". The only way to tell two apart in a
  -- list, and a list is how a forgotten token gets found and revoked.
  ADD COLUMN label TEXT
    CONSTRAINT auth_sessions_label_length CHECK (label IS NULL OR length(label) BETWEEN 1 AND 60),

  -- When the session last authenticated a request, updated at most every few minutes. It is what
  -- makes "is anything still using this token?" answerable before revoking it.
  ADD COLUMN last_used_at TIMESTAMPTZ;

-- A personal token is named and nothing else is. Written as an equivalence so a named device
-- session and an unnamed personal token are both unrepresentable.
ALTER TABLE auth_sessions
  ADD CONSTRAINT auth_sessions_label_iff_personal CHECK ((kind = 'personal') = (label IS NOT NULL));

-- Read-only scope exists for scripts. A phone app that could not write would be a broken app, and a
-- browser session is scoped by the UI; neither has a use for it.
ALTER TABLE auth_sessions
  ADD CONSTRAINT auth_sessions_read_scope_personal_only CHECK (scope = 'full' OR kind = 'personal');

-- A personal token cannot be minted to live forever, whatever the minting script is told. The
-- script enforces the same bound; this is what holds it for any other writer.
ALTER TABLE auth_sessions
  ADD CONSTRAINT auth_sessions_personal_lifetime
    CHECK (kind <> 'personal' OR expires_at <= created_at + INTERVAL '366 days');

-- Down Migration

-- Drops the three kinds back to one. It REFUSES while any device or personal session exists,
-- rather than deleting them: a down migration that silently revoked the phone and every script
-- would be a sign-out nobody asked for. Revoke and delete them deliberately first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth_sessions WHERE kind <> 'browser') THEN
    RAISE EXCEPTION 'auth_sessions holds device or personal sessions; delete them deliberately before rolling back';
  END IF;
END $$;

ALTER TABLE auth_sessions
  DROP CONSTRAINT IF EXISTS auth_sessions_personal_lifetime,
  DROP CONSTRAINT IF EXISTS auth_sessions_read_scope_personal_only,
  DROP CONSTRAINT IF EXISTS auth_sessions_label_iff_personal;

ALTER TABLE auth_sessions
  DROP COLUMN IF EXISTS last_used_at,
  DROP COLUMN IF EXISTS label,
  DROP COLUMN IF EXISTS scope,
  DROP COLUMN IF EXISTS kind;
