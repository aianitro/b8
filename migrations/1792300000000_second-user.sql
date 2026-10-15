-- Up Migration
-- A second user, as a full peer (ROADMAP.md §5 Phase 7 step 41a;
-- plan/tasks/P7-41a-second-user/SPEC.md and CONTRACT.md).
--
-- ─── WHAT CHANGED SINCE "NEITHER TABLE HAS A user_id" ─────────────────────────────────────────
--
-- 1789300800000_passkey-credentials-and-sessions.sql refused a users table at length, and its
-- argument was right for the app it described: with one principal, a users table holds one row
-- forever and every predicate on it has one possible value. It also named the way out — "add the
-- column nullable, backfill the single owner, tighten" — and that is what this file does. Two things
-- are now true that were not then:
--
--   * There are two people. The owner asked for a second user with their own passkey, and the next
--     step (P7-41b) hides a gift's details from its recipient on every surface, which is impossible
--     unless every request knows WHICH user is asking and a push reaches only its own user's devices.
--   * The old migration's decisive objection was that a user_id turns "zero credentials exist" into
--     "zero for this user", and an unauthenticated request cannot name a user without inventing one.
--     That objection is answered, not ignored: the bootstrap gate stays a GLOBAL count (nothing here
--     changes webauthn_credentials_one_bootstrap), and the only way an unauthenticated request can
--     create a user is by presenting an invitation the owner minted while signed in. Nobody invents a
--     user; the owner does, and the invitee redeems it.
--
-- ─── WHAT THIS DOES NOT DO ────────────────────────────────────────────────────────────────────
--
-- No ledger table gains a user column, and none may. The two users see and edit the same accounts,
-- transactions, budgets and rules (SPEC.md non-goals). The only actor columns are on agent_proposals,
-- because that table already records an actor (the session) and this adds the person behind it.
-- auth_sessions and device_handoffs gain nothing: both reach a user through credential_id, and a
-- second copy of the user on a session would be a second answer to "who is this" that could
-- disagree with the first.

-- ─── users ────────────────────────────────────────────────────────────────────────────────────
--
-- One row per person who may sign in. Rows are never deleted: agent_proposals points at them as
-- history, and a removed user's past decisions must still name who made them. Removal is revoked_at
-- plus the deletion of that user's credentials (which cascades their sessions and personal tokens).
CREATE TABLE users (
  -- A plain integer. It appears in one URL (/api/v1/auth/users/[id]/revoke), reachable only by the
  -- owner's full-scope browser session, so guessability buys an attacker nothing; and it is never
  -- used as a WebAuthn user handle (see CONTRACT.md), so it need not be opaque.
  id           SERIAL PRIMARY KEY,

  -- What the app shows as "signed in as". 1 to 60 characters, the bound auth_sessions.label and the
  -- push tables already use for a human-chosen name. The backfilled owner is the neutral 'Owner'; an
  -- invited user takes the name the owner wrote on the invitation.
  display_name TEXT NOT NULL
                 CONSTRAINT users_display_name_length CHECK (length(display_name) BETWEEN 1 AND 60),

  -- The one asymmetry between the two peers: only the owner may invite or remove. Not "the first
  -- user" or "the oldest row" — that would be a derivation, and re-creating a user would inherit a
  -- title it did not earn, the same argument webauthn_credentials.enrolled_via makes.
  is_owner     BOOLEAN NOT NULL DEFAULT FALSE,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- When the owner removed this user. NULL means NOT REMOVED, the same stated departure from
  -- null-means-unknown that auth_sessions.revoked_at makes: removal is an event only this app can
  -- cause, so the absence of a timestamp is knowledge. Kept separately from deleting the user's
  -- credentials because a deleted credential leaves no trace of when, or that it ever happened.
  revoked_at   TIMESTAMPTZ,

  -- The owner cannot be removed. Without this, a revoke path that forgets to check is one UPDATE
  -- away from an app with no owner, where nobody can invite and nobody can remove — and the bootstrap
  -- gate stays shut because credentials still exist.
  CONSTRAINT users_owner_not_revoked CHECK (NOT (is_owner AND revoked_at IS NOT NULL))
);

-- AT MOST ONE OWNER, enforced by the database. The same idiom as webauthn_credentials_one_bootstrap,
-- for the same reason: two concurrent bootstrap ceremonies each read "no owner yet", and a
-- count-then-insert has a window in it. The second INSERT of is_owner = TRUE raises a unique
-- violation however the transactions interleave. It does not require that an owner EXISTS — a fresh
-- database with zero credentials has no owner until the first bootstrap creates one.
CREATE UNIQUE INDEX users_one_owner ON users (is_owner) WHERE is_owner;

-- ─── user_invitations ─────────────────────────────────────────────────────────────────────────
--
-- The only way an unauthenticated request may enrol a passkey once any credential exists. The owner
-- mints a code while signed in and hands it over in person; the invitee presents it at the existing
-- register/options and register/verify endpoints. Same shape as device_handoffs, for the same
-- reason: a short-lived, single-use secret is worth little to whoever finds it later.
CREATE TABLE user_invitations (
  -- SHA-256 of the code, lowercase hex, never the code. The rule auth_sessions.token_hash and
  -- device_handoffs.code_hash follow: a row holding the secret is a row whose leak is the secret. The
  -- CHECK makes storing the raw code a statement Postgres refuses. Redemption is a lookup on this
  -- key in SQL, never a comparison in JavaScript.
  code_hash    TEXT PRIMARY KEY
                 CONSTRAINT user_invitations_code_hash_format CHECK (code_hash ~ '^[0-9a-f]{64}$'),

  -- Who minted it: always the owner, which only the application can check (the database cannot see
  -- the session). No ON DELETE action, because users rows are never deleted.
  created_by   INTEGER NOT NULL REFERENCES users(id),

  -- The name the new user will carry. Chosen by the owner, because the invitee is not yet anyone the
  -- app can ask. Same bound as users.display_name, which it is copied into.
  display_name TEXT NOT NULL
                 CONSTRAINT user_invitations_display_name_length CHECK (length(display_name) BETWEEN 1 AND 60),

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Evaluated by Postgres NOW(), never the JS clock, exactly as auth_sessions.expires_at. A code is
  -- live while expires_at > NOW() and consumed_at IS NULL — both conjuncts, always.
  expires_at   TIMESTAMPTZ NOT NULL
                 CONSTRAINT user_invitations_expires_after_created CHECK (expires_at > created_at),

  -- Single use. Set in the same transaction that creates the user and the credential, so a crash
  -- cannot leave a consumed code with no user or a user with an unconsumed code. A replay is refused
  -- on this column rather than on the clock — the distinction device_handoffs.claimed_at draws.
  consumed_at  TIMESTAMPTZ,

  -- The user this invitation created. UNIQUE: one invitation makes exactly one user, so two
  -- concurrent redemptions that both slipped past a read cannot both attach to it.
  consumed_by  INTEGER UNIQUE REFERENCES users(id),

  -- Consumed means consumed BY someone. A timestamp with no user, or a user with no timestamp, is a
  -- half-finished redemption, which the atomic write above exists to make impossible.
  CONSTRAINT user_invitations_consumed_together CHECK ((consumed_at IS NULL) = (consumed_by IS NULL)),

  -- Seven days at most, the bound SPEC.md states. In the database, like
  -- auth_sessions_personal_lifetime, so a mis-typed TTL fails at the INSERT instead of minting a
  -- code that lives for a year.
  CONSTRAINT user_invitations_lifetime CHECK (expires_at <= created_at + INTERVAL '7 days')
);

-- ─── The owner, and only if there is one already ──────────────────────────────────────────────
--
-- If any credential exists, someone bootstrapped this app, and that person is the owner: every
-- credential before this migration was enrolled by the owner or by a session the owner held. If no
-- credential exists, there is no owner yet, and inventing one here would leave the first bootstrap
-- adopting a row it did not create. The first bootstrap creates the owner instead.
INSERT INTO users (display_name, is_owner)
SELECT 'Owner', TRUE
 WHERE EXISTS (SELECT 1 FROM webauthn_credentials);

-- ─── webauthn_credentials: every credential belongs to a user ─────────────────────────────────
--
-- Nullable, backfilled, then tightened — §9.2's preferred route to a NOT NULL column. After this,
-- a session resolves to a user through its credential with no possible gap: the credential is NOT
-- NULL on the session and the user is NOT NULL on the credential, so a lookup that finds no user
-- has found no session, and must fail closed rather than default to the owner.
--
-- Every existing credential is the owner's, whatever its enrolled_via: 'bootstrap' was the owner
-- by definition, and 'authenticated' was enrolled by a session the owner held, because there was
-- nobody else to hold one. Device and personal sessions, and device_handoffs, inherit the owner
-- through their credential_id and need no write of their own.
--
-- No ON DELETE action: a user row is never deleted, and if someone tries, a user who still has
-- passkeys should refuse the delete rather than take them with it.
ALTER TABLE webauthn_credentials ADD COLUMN user_id INTEGER REFERENCES users(id);
UPDATE webauthn_credentials SET user_id = (SELECT id FROM users WHERE is_owner);
ALTER TABLE webauthn_credentials ALTER COLUMN user_id SET NOT NULL;

-- A third way in. 'invitation' = enrolled by an UNAUTHENTICATED request that presented a live
-- invitation, while credentials already existed. Not 'bootstrap', which keeps meaning "zero
-- credentials existed" and keeps its at-most-one index; tagging an invited enrolment 'bootstrap'
-- would trip that index for the second user, and dropping the index to make room would reopen the
-- race it closes. Not 'authenticated' either: no session was presented, and that tag's meaning is
-- "a signed-in user added a device". A passkey a signed-in user adds is still 'authenticated', and
-- belongs to the signed-in user.
ALTER TABLE webauthn_credentials DROP CONSTRAINT webauthn_credentials_enrolled_via_check;
ALTER TABLE webauthn_credentials ADD CONSTRAINT webauthn_credentials_enrolled_via_check
  CHECK (enrolled_via IN ('bootstrap', 'authenticated', 'invitation'));

-- ─── web_push_subscriptions: a push reaches only its own user ─────────────────────────────────
--
-- Every existing subscription, revoked ones included, was registered by the owner's session, so
-- they are the owner's.
--
-- THE ONE CASE WITH NO OWNER TO GIVE THEM TO. A subscription can outlive every credential: sessions
-- cascade away when a passkey row is deleted, subscriptions do not. On such a database there is no
-- owner (see above), and the next bootstrap may be a different person — so attributing these rows to
-- whoever enrols next would be attribution by guess, and would send that person's pings to a phone
-- that is not theirs. They are DELETED instead. A subscription holds no financial data and is
-- re-created by the device registering again after sign-in, so nothing is lost that the app cannot
-- rebuild; it is also lost for good on the way down, which CONTRACT.md records. On any database with
-- a credential this statement deletes nothing.
ALTER TABLE web_push_subscriptions ADD COLUMN user_id INTEGER REFERENCES users(id);
DELETE FROM web_push_subscriptions WHERE NOT EXISTS (SELECT 1 FROM users WHERE is_owner);
UPDATE web_push_subscriptions SET user_id = (SELECT id FROM users WHERE is_owner);
ALTER TABLE web_push_subscriptions ALTER COLUMN user_id SET NOT NULL;

-- ─── agent_proposals: the person behind the session ───────────────────────────────────────────
--
-- proposed_by and decided_by name a SESSION, and a session is deleted on sign-in pruning or when
-- its passkey is removed, at which point ON DELETE SET NULL erases the attribution. These two name
-- the PERSON, and survive: no ON DELETE action, because users rows are never deleted, so nothing
-- cascades them away or nulls them.
--
-- NULL means "no person is known to have done this", and has two sources that this column does not
-- distinguish: a system-made proposal (the category suggester writes proposed_by = NULL), and a
-- proposal whose session was gone before this migration ran. It never means the owner. The
-- category suggester keeps selecting on proposed_by IS NULL, unchanged.
ALTER TABLE agent_proposals
  ADD COLUMN proposed_by_user_id INTEGER REFERENCES users(id),
  ADD COLUMN decided_by_user_id  INTEGER REFERENCES users(id);

-- Attributed ONLY through a session row that still exists. A proposal whose session is gone already
-- has proposed_by / decided_by NULL, so the join finds nothing and it keeps NULL. Nothing is
-- attributed by guess: the owner is the likely author of every old proposal, and "likely" is not a
-- fact this table may record.
UPDATE agent_proposals p
   SET proposed_by_user_id = c.user_id
  FROM auth_sessions s
  JOIN webauthn_credentials c ON c.credential_id = s.credential_id
 WHERE s.token_hash = p.proposed_by;

UPDATE agent_proposals p
   SET decided_by_user_id = c.user_id
  FROM auth_sessions s
  JOIN webauthn_credentials c ON c.credential_id = s.credential_id
 WHERE s.token_hash = p.decided_by;

-- A proposal that names a session also names its person. One-directional, like
-- budget_categories_debt_service_control_mode_check: the session may later be deleted (setting the
-- session column NULL) while the person stays, so the converse must not hold. What this refuses is a
-- writer recording the session and forgetting the user — the silent half of the attribution. Holds
-- for every existing row once the backfill above has run, since a live session always reaches a
-- credential and every credential now has a user.
ALTER TABLE agent_proposals
  ADD CONSTRAINT agent_proposals_proposer_has_user
    CHECK (proposed_by IS NULL OR proposed_by_user_id IS NOT NULL),
  ADD CONSTRAINT agent_proposals_decider_has_user
    CHECK (decided_by IS NULL OR decided_by_user_id IS NOT NULL);

-- Down Migration
-- Removes everything the up added and keeps every row that existed before it. Credentials, sessions,
-- subscriptions and proposals of the OWNER survive untouched, with their pre-migration columns.
--
-- WHAT IS LOST, AND WHY ON PURPOSE: the second user and everything that is theirs. The code this
-- rolls back to has one principal, and it treats every credential as the owner. A second user's
-- passkey left in place would therefore sign in AS THE OWNER on the old code — attribution by guess,
-- in the most dangerous direction. So their credentials are deleted here (which cascades their
-- sessions, personal tokens and device handoffs, and sets agent_proposals.proposed_by / decided_by
-- NULL where those sessions were named), and their push subscriptions are deleted, since the old send
-- path pings every live subscription. Every invitation, every users row and every acting-user
-- attribution goes with the tables and columns. Back up first if any of it matters (CONTRACT.md).
--
-- If any 'invitation' credential somehow belonged to the owner, re-narrowing the CHECK below fails
-- and the whole down rolls back. That is deliberate: no rewrite of enrolled_via is honest — such a
-- credential was neither a bootstrap nor enrolled by a session — so the down refuses rather than
-- relabels it.

ALTER TABLE agent_proposals
  DROP CONSTRAINT agent_proposals_decider_has_user,
  DROP CONSTRAINT agent_proposals_proposer_has_user,
  DROP COLUMN decided_by_user_id,
  DROP COLUMN proposed_by_user_id;

DELETE FROM web_push_subscriptions WHERE user_id IN (SELECT id FROM users WHERE NOT is_owner);
ALTER TABLE web_push_subscriptions DROP COLUMN user_id;

DELETE FROM webauthn_credentials WHERE user_id IN (SELECT id FROM users WHERE NOT is_owner);
ALTER TABLE webauthn_credentials DROP CONSTRAINT webauthn_credentials_enrolled_via_check;
ALTER TABLE webauthn_credentials ADD CONSTRAINT webauthn_credentials_enrolled_via_check
  CHECK (enrolled_via IN ('bootstrap', 'authenticated'));
ALTER TABLE webauthn_credentials DROP COLUMN user_id;

DROP TABLE user_invitations;
DROP TABLE users;
