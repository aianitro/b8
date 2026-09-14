-- Up Migration

-- The app's first authentication boundary needs two things it has never had: a record of which
-- authenticators are allowed to speak for the owner, and a record of who is currently signed in
-- (ROADMAP.md §5 Phase 1 step 12; plan/tasks/P1-12-passkey-auth/SPEC.md).
--
-- Two tables, and they are the first in this schema that hold no financial data of any kind. They
-- belong to the app's boundary, not to its ledger: nothing here is an observation of the world, a
-- figure, a payee or an account. Every other table in this file answers "what is true of the
-- owner's money"; these two answer "who is allowed to ask".
--
-- ─── WHY NEITHER TABLE HAS A user_id ──────────────────────────────────────────────────────────
--
-- Stated here, at length, because an absence is invisible in a diff and the first instinct on
-- reading an auth schema is that a foreign key is missing. It is not missing. It is refused, for
-- the same kind of reason property_tenant_funds refuses a `source` column.
--
-- This application has exactly one principal — the owner — and ROADMAP.md's scoping for this step
-- says so explicitly: not multi-user, not household sharing, and the schema should not pretend
-- otherwise without a reason. A `user_id` here would have to reference a `users` table holding
-- exactly one row forever, and every query in the app would then carry a predicate that can only
-- ever have one value. That is not modelling; it is decoration that reads as multi-user support to
-- everyone who arrives later, and the day someone believes it they will write a query that trusts
-- it.
--
-- The decisive argument is not tidiness, though. It is that the single-user model is what makes
-- this step's central rule *expressible at all*:
--
--     registration is open only while ZERO credentials exist, and requires a valid session
--     afterwards.
--
-- "Zero credentials exist" is a global count. With a `user_id`, it necessarily becomes "zero
-- credentials exist FOR THIS USER" — and an unauthenticated request cannot name a user, so either
-- the request gets to choose one (in which case anybody enrols themselves as a brand-new user and
-- the gate is worth nothing), or the server picks the one row (in which case the column was never
-- carrying information). The bootstrap gate and the one-row users table cannot both be honest.
--
-- If multi-user ever arrives, it is an additive migration: add the column nullable, backfill the
-- single owner, tighten. That is cheaper than maintaining a decorative column now, and it forces
-- whoever does it to confront the bootstrap question deliberately instead of inheriting an answer.

-- ─── The credential store ─────────────────────────────────────────────────────────────────────
--
-- One row per authenticator enrolled to speak for the owner. Multi-credential by construction: a
-- laptop's Touch ID and a phone are two rows, and every read over this table must handle N rows.
-- A query that takes the newest row ("the" passkey) produces a second device that registers
-- successfully and can then never log in — which looks like a hardware problem and is not.
CREATE TABLE webauthn_credentials (
  -- The credential's own identifier, as the browser sends it: unpadded base64url text.
  --
  -- Natural primary key, like accounts.id, and for a stronger reason: uniqueness here is not a
  -- convenience, it is the property that makes "which stored public key verifies this assertion"
  -- a question with one answer. Two rows sharing an id is not a duplicate to clean up later; it is
  -- an ambiguity at the exact moment a signature is being checked.
  --
  -- TEXT and not BYTEA, deliberately, and the asymmetry with public_key below is the point. This
  -- value's entire job is to be COMPARED against what a browser sends, and a browser sends it
  -- already encoded; storing the encoded form makes the lookup `WHERE credential_id = $1` with no
  -- decode step, and a decode step is exactly where padded-vs-unpadded and base64-vs-base64url go
  -- wrong. The CHECK is what turns "unpadded base64url" from a convention into a property of the
  -- database: standard base64's '+' and '/' are refused, and so is any '=' padding, so the
  -- divergent encoding cannot be written here even by a caller who has forgotten why it matters.
  -- (A lookup performed with the *other* encoding still finds nothing — but finding nothing means
  -- refusing the login, which is the safe direction.)
  credential_id TEXT PRIMARY KEY
                  CONSTRAINT webauthn_credentials_credential_id_check
                  CHECK (credential_id ~ '^[A-Za-z0-9_-]+$'),

  -- The COSE public key, as bytes.
  --
  -- BYTEA rather than an encoded string, and for the mirror image of the reason above: this value
  -- is never compared and never matched — it is handed to a verifier that wants bytes. Storing it
  -- as bytes removes an encoding decision from the round trip entirely rather than pinning one,
  -- and an encoding decision that does not exist cannot be made inconsistently at the two ends.
  --
  -- The length CHECK catches one specific, quiet failure: a library upgrade renames the field the
  -- verification result carries the key in, the insert stores an empty buffer, registration
  -- reports success, and every subsequent login fails a signature check for reasons that look
  -- nothing like the cause. This moves that failure to the INSERT, next to the mistake.
  public_key    BYTEA NOT NULL
                  CONSTRAINT webauthn_credentials_public_key_check
                  CHECK (octet_length(public_key) > 0),

  -- The authenticator's signature counter, as of the last accepted assertion.
  --
  -- THIS IS THE ONE MUTABLE COLUMN IN EITHER TABLE, and that is deliberate rather than an
  -- oversight against this repo's append-only habit. It is not a derived value and not a cached
  -- "latest": it is a high-water mark of state that lives inside the authenticator, mirrored here
  -- because the only way to detect a cloned authenticator is to compare what was just presented
  -- against the highest value seen before. An append-only counter series was considered and
  -- rejected — it would write a row on every single login, for no consumer, and turn a comparison
  -- that must be atomic with the accept/reject decision into a reduction over history.
  --
  -- 0 IS A REAL READING, NOT A MISSING OBSERVATION, and this is the one place in this schema where
  -- that needs saying out loud. Per the WebAuthn specification, an authenticator that does not
  -- implement a counter reports 0 forever — which is most platform authenticators, including Touch
  -- ID and anything synced through a passkey provider. So a stored 0 means "this authenticator
  -- told us it has no counter", clone detection is genuinely inert for that credential, and the
  -- app must not treat a non-increasing counter as an attack when both the stored and the
  -- presented value are 0. That is the difference between a check that is inert because the
  -- hardware says so and a check that was wired to a no-op; only one of them is honest, and they
  -- are indistinguishable in the code if this column's meaning is not written down.
  --
  -- NOT NULL with NO DEFAULT, exactly as alert_sends.delivered is and for the same reason: the
  -- verifier knows the counter by the time this row is written. A DEFAULT 0 would let an INSERT
  -- that forgot the column assert "no counter support" for an authenticator that has one,
  -- permanently disabling clone detection for that credential with nothing looking wrong.
  sign_count    BIGINT NOT NULL
                  CONSTRAINT webauthn_credentials_sign_count_check
                  CHECK (sign_count >= 0),

  -- How the authenticator says it can be reached next time ('internal', 'hybrid', 'usb', 'nfc', …).
  -- Passed back to the browser in a later ceremony's allowCredentials so it can offer the right
  -- affordance; the app never branches on it.
  --
  -- NULL means the authenticator reported nothing — genuinely unknown. An empty array means it
  -- reported an empty list. Those are different and must not be collapsed: DEFAULT '{}' would turn
  -- "we were not told" into "we were told there are none", which is this repo's null-means-unknown
  -- rule broken in the usual direction.
  --
  -- No CHECK on the element values, unlike every other vocabulary in this schema. The transport
  -- list is open and still moving — 'cable' was retired, 'hybrid' and 'smart-card' were added —
  -- and a closed CHECK here would make a future browser's registration fail at the INSERT with no
  -- recourse but a migration. BUILD.md §9.2's rule for enum-ish values applies: a consumer must
  -- handle an unknown value without crashing, which for a column nothing branches on is free.
  transports    TEXT[],

  -- Which rule admitted this credential. Provenance, not derivation — it records the state of the
  -- world at the moment of enrolment, which nothing later can reconstruct, in the same way
  -- account_valuations.source records who observed a value.
  --
  --   'bootstrap'     — enrolled by an UNAUTHENTICATED request, permitted only because zero
  --                     credentials existed. There is exactly one of these, ever (see below).
  --   'authenticated' — enrolled by a request carrying a valid session. Every subsequent device.
  --
  -- Not derivable from created_at: "the oldest row" answers a different question and answers it
  -- badly, since a re-enrolment after the bootstrap credential is deleted would inherit a title it
  -- did not earn.
  enrolled_via  TEXT NOT NULL
                  CONSTRAINT webauthn_credentials_enrolled_via_check
                  CHECK (enrolled_via IN ('bootstrap', 'authenticated')),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── The race this index closes, and why the count check alone does not ───────────────────────
--
-- SPEC.md names the defect: two concurrent unauthenticated registrations both read "zero
-- credentials exist" before either write lands, and both enrol. A count-then-insert is a
-- read-modify-write with a window in it, and under Postgres's default READ COMMITTED the window is
-- real — neither transaction sees the other's uninserted row, and there is no row to lock.
--
-- A partial unique index removes the window rather than narrowing it: at most one row in this
-- table may ever carry enrolled_via = 'bootstrap', enforced by the index, so the second concurrent
-- INSERT fails with a unique violation no matter how the two transactions interleave. The handler
-- translates that violation into the same refusal the count check produces; it does not retry.
--
-- WHAT THIS DOES AND DOES NOT BUY, stated precisely so nobody reads more into it. It makes the
-- RACE impossible. It does not make the CHECK unnecessary: the database cannot tell whether the
-- request carried a valid session, so a handler that tags a session-less enrolment
-- 'authenticated' still enrols a stranger, and only the application can refuse that. The schema
-- closes the concurrency hole; SPEC.md's I2 closes the logic hole. Both are needed.
--
-- Deleting the bootstrap credential (the retired-device path, a direct database operation for now)
-- legitimately re-opens the window — zero credentials exist again, and that is the correct
-- posture, not a leak.
CREATE UNIQUE INDEX webauthn_credentials_one_bootstrap
  ON webauthn_credentials (enrolled_via)
  WHERE enrolled_via = 'bootstrap';

-- ─── The session store ────────────────────────────────────────────────────────────────────────
--
-- One row per successful ceremony. The row IS the session: a cookie that matches no row here is
-- not a session, and "no session" is never a reduced access level — this app has no guest role and
-- no read-only role for a cookie to fall back to.
CREATE TABLE auth_sessions (
  -- SHA-256, lowercase hex, of the opaque token in the cookie. NOT the token.
  --
  -- This column is the reason the table is safe to read. The cookie's value is a bearer credential:
  -- anything holding it is signed in. If that value were stored here verbatim, then a database
  -- read, a CSV backup, a `psql` scrollback or a row pasted into an EVIDENCE.md would each be a
  -- live login — and alert_sends' comment already makes the case that a diagnostic table is read
  -- by a far leakier audience than the app's own tables are. Storing the digest means the store can
  -- recognise a token it is shown and cannot produce one it has not been shown.
  --
  -- The CHECK is what makes that structural rather than a hope about the caller: the raw token is
  -- CSPRNG bytes rendered as base64url, which contains characters this pattern refuses and is not
  -- 64 characters long, so "just store the cookie value" is a statement the database will not
  -- accept. Same idiom as alert_sends.fingerprint, and for the same reason — a comment asking for
  -- opacity is advice; a regexp is a property.
  --
  -- Primary key, because the one hot read on this table is the lookup by exactly this value, on
  -- every request to every protected surface.
  token_hash    TEXT PRIMARY KEY
                  CONSTRAINT auth_sessions_token_hash_check
                  CHECK (token_hash ~ '^[0-9a-f]{64}$'),

  -- Which authenticator signed in. NOT NULL: every session is born from a completed ceremony, and
  -- there is no other way to create one — a session that cannot name the credential behind it is a
  -- session nobody can attribute. This forces the write order inside the registration handler
  -- (credential first, session second, one transaction), which is the correct order anyway.
  --
  -- ON DELETE CASCADE is doing real work, not ceremony. Removing a retired device's passkey is a
  -- direct database operation in v1 (SPEC.md names that gap), and a DELETE that left that device's
  -- sessions alive would retire the key while leaving the door it opened propped. RESTRICT was
  -- rejected: it would block the delete and invite whoever is doing it to clear the sessions by
  -- hand first, which is the same outcome reached less reliably.
  --
  -- No ON UPDATE CASCADE, unlike the accounts(id) references elsewhere in this schema. Those exist
  -- because Plaid genuinely reissues an account_id. A credential id is the authenticator's own
  -- immutable identifier; if it changed it would be a different credential, so the clause would be
  -- a promise about something that cannot happen.
  credential_id TEXT NOT NULL REFERENCES webauthn_credentials(credential_id) ON DELETE CASCADE,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- When this session stops being valid on its own. Absolute, set once at creation from the
  -- server's TTL, never extended in place — a sliding expiry rewritten on each request would make
  -- a stolen cookie immortal as long as it is used.
  --
  -- NOT NULL and no default: a session with no expiry is not a session, it is a permanent
  -- credential, and there is no honest value for a default to assert.
  expires_at    TIMESTAMPTZ NOT NULL,

  -- When the session was explicitly ended — a sign-out, or a revocation done by hand.
  --
  -- A SEPARATE COLUMN FROM expires_at, AND NOT MERGEABLE WITH IT. The tempting shortcut is to
  -- implement logout as `UPDATE ... SET expires_at = NOW()`, which needs no column at all. It is
  -- refused for three reasons, in ascending order of importance: it overwrites a value that was a
  -- fact about the session's creation; it loses the distinction between "the owner signed out" and
  -- "the session aged out", which is the whole of what this row can ever say about itself, since
  -- this task deliberately creates no separate log; and it makes a logout that does nothing at all
  -- indistinguishable from one that worked, because a session left to expire on its own reaches
  -- the same state a few hours later. SPEC.md's I8 (expired is rejected) and I9 (revoked is
  -- rejected on replay) are two different assertions precisely because these are two different
  -- facts.
  --
  -- NULL MEANS "NOT REVOKED", WHICH IS A STATED DEPARTURE from this repo's null-means-unknown rule
  -- — the same kind of departure budget_categories.control_mode records for itself, and stated
  -- here for the same reason. Revocation is an event; this application is the only thing that can
  -- ever cause one, so the absence of a timestamp is knowledge ("no revocation has happened"), not
  -- ignorance. There is no third state for a nullable column to be hiding.
  revoked_at    TIMESTAMPTZ,

  -- Refuses a session born already dead: an inverted sign in the TTL arithmetic, or a TTL of zero.
  -- Such a session fails closed rather than open, so this is not a security hole — it is the
  -- difference between "login succeeds and the next request 401s for no visible reason" and a
  -- failure at the INSERT that names the cause.
  CONSTRAINT auth_sessions_expires_after_created CHECK (expires_at > created_at)
);

-- ─── The only predicate that decides whether a request is authenticated ───────────────────────
--
--     SELECT 1 FROM auth_sessions
--      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()
--
-- Written here so it is not re-derived at each call site with one conjunct missing. Three things
-- about it are load-bearing:
--
--   * All three conjuncts, always. `WHERE token_hash = $1` alone accepts a revoked cookie and an
--     expired one; a cookie that merely exists is not a session.
--   * `>` and not `>=`. expires_at is the first instant at which the session is no longer valid —
--     the interval is half-open, [created_at, expires_at). Stated because the off-by-one has no
--     visible symptom and picking the other one silently extends every session by an instant.
--   * EVALUATED BY POSTGRES, NEVER IN JAVASCRIPT. Both of these columns are TIMESTAMPTZ, which
--     `pg` hands back as a JS Date inside a handler and which becomes an ISO string the moment it
--     crosses Response.json — the boundary P1-11's N4 already caught once. A comparison written in
--     JS works against the Date and silently misbehaves against the string, and it also introduces
--     a second clock. NOW() is the database's clock, and there is exactly one of it.
--
-- No index beyond the primary key. The hot read is by token_hash, which the PK serves; a sweep of
-- expired rows and the cascade from a deleted credential both scan a table that holds one row per
-- sign-in on a single-user app. sync_log carries a second index because it is read on a page
-- render; this one is not. Stated so nobody adds one reflexively for symmetry.
--
-- Pruning expired or revoked rows is a maintenance operation and may DELETE freely. It must never
-- be how logout is implemented: revoked_at is the record that a sign-out happened, and a DELETE
-- leaves a store in which "signed out" and "never existed" are the same answer.

-- Down Migration

-- Order matters: auth_sessions holds the foreign key, so it goes first. Dropping the parent first
-- would fail, and writing it that way and then adding CASCADE to make it work would silently take
-- the sessions with it in every future rollback.
--
-- NO CSV BACKUP IS SPECIFIED, and this is the second deliberate exception to BUILD.md §9.3's
-- standing practice rather than an oversight. The practice protects observations of the world that
-- exist nowhere else. Nothing here is one: a credential is re-creatable by re-registering the same
-- physical authenticator, and a session is re-creatable by signing in. Both tables are created
-- empty by this migration, so at the moment it first runs there is nothing to lose at all.
--
-- THE REAL RISK OF A ROLLBACK IS NOT DATA LOSS, and this is the sentence to read before running
-- one. Dropping these tables returns the app to zero credentials — which means that on re-apply,
-- the bootstrap window is OPEN again, and the first unauthenticated visitor may enrol themselves
-- as the owner. That is safe only if the boundary is rolled back in the same motion, which
-- SPEC.md's rollback section requires: revert the code and the migration together, so the host
-- guard narrows again at the same instant the credential store empties. A migration rolled back
-- while the application keeps serving is the one rollback shape this step exists to prevent, and
-- the app must not be reachable while it is true.

DROP TABLE IF EXISTS auth_sessions;
DROP TABLE IF EXISTS webauthn_credentials;
