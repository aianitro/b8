# CONTRACT — P1-12-passkey-auth

**Author:** contract-guardian
**Lease:** open for the G1 window while this diff was written (2026-09-13) · exact open/close
timestamps are the orchestrator's to record from `.claude/bin/lease`, which this role cannot run

## Change

| File | Change | Class (§9.2) |
|---|---|---|
| `migrations/1789300800000_passkey-credentials-and-sessions.sql` | **new.** Two tables — `webauthn_credentials` and `auth_sessions` — one partial unique index, seven CHECK constraints, one foreign key. Nothing existing is altered, renamed, or redefined. Reversible; the `down` drops both, child first. | **additive** |
| `db/schema.sql` | Reflects the migration. A pure append at the end of the file, under a new `The authentication boundary` section header, with condensed rationale. | **additive** |
| `shared/contracts/auth.ts` | **new.** `base64url`, `challengeString`, `relyingPartyId`; `RegistrationCeremonyOptionsSchema`, `AuthenticationCeremonyOptionsSchema`, `RegistrationCeremonyResponseSchema`, `AuthenticationCeremonyResponseSchema`; the three envelopes `RegistrationOptionsResponseSchema`, `AuthenticationOptionsResponseSchema`, `CeremonyVerifiedResponseSchema`; `UnauthenticatedResponseSchema`; `AuthErrorCodeSchema`; five inferred types. | **additive** |
| `shared/types.ts` | **none.** The discretionary export was considered and declined — and, on this task's surface, could not have been taken without a diff the spec forbids. See "Judgements SPEC.md left open", row 1. | — |
| `shared/contracts/{enums,shapes,envelope,representation,index}.ts` | **none.** `apiResponseSchema` and `ApiErrorResponseSchema` are imported, not amended and not re-declared. Nothing is re-exported through `index.ts`. | — |

Byte-identical to `HEAD`: `shared/types.ts`, every other file under `shared/contracts/`, every
existing file under `migrations/`, and every line of `db/schema.sql` above the appended section.

**Change class, and why it is not something stronger.** Two `CREATE TABLE`s, one `CREATE INDEX`, and
no statement that touches an existing relation. No existing column changes type, name, nullability
or *meaning* — §9.2's dangerous class does not apply, because nothing above the appended section
knows these tables exist and nothing joins to them. The `NOT NULL` columns are not §9.2's breaking
case either: that row is about adding a required column to a *populated* table, where existing rows
have no value to put in it. Both tables are created empty and have no producer until the implementer
writes one, so there is nothing to backfill and no nullable-then-tighten path to prefer.

---

## Rationale

### The TOCTOU race is closed in the schema, because it is a schema problem

SPEC.md's "Failure modes to test" names it first and says a naive count check does not close it
*without a uniqueness constraint behind it*. That sentence makes it mine, so here is the decision and
its exact reach.

The rule is: registration is open only while zero credentials exist. Written as a count-then-insert,
that is a read-modify-write with a window in it, and the window is real rather than theoretical —
under Postgres's default READ COMMITTED, two concurrent unauthenticated registrations each read
"zero", neither sees the other's uninserted row, and there is no row to lock because the whole
condition is the *absence* of rows. Both enrol. The app then has two owners and no way to tell which
one the owner is.

`webauthn_credentials.enrolled_via` plus a partial unique index removes the window rather than
narrowing it:

```sql
CREATE UNIQUE INDEX webauthn_credentials_one_bootstrap
  ON webauthn_credentials (enrolled_via)
  WHERE enrolled_via = 'bootstrap';
```

At most one row may ever carry `'bootstrap'`. The second concurrent `INSERT` raises a unique
violation however the two transactions interleave, and the handler turns that violation into the
same refusal the count check produces. No advisory lock, no `SERIALIZABLE`, no retry loop.

**What this buys and what it does not, stated precisely so nobody reads more into it.** It makes the
RACE impossible. It does not make the CHECK unnecessary: the database cannot see whether a request
carried a valid session, so a handler that tags a session-less enrolment `'authenticated'` still
enrols a stranger, and only I2 catches that. The schema closes the concurrency hole; the application
closes the authorization hole. Both are needed, and a reviewer should read the index as covering
exactly one of them.

**Why `enrolled_via` and not `is_bootstrap`.** A boolean would work identically for the index and
would be a *derived* column — "the bootstrap credential is the oldest row" — which is the shape this
role exists to refuse. `enrolled_via` is provenance: it records which rule admitted the credential,
which is a fact about the moment of enrolment that nothing later can reconstruct. It is the same
column motif as `account_valuations.source`, and it survives the case that breaks the derived
version: delete the bootstrap credential, re-register, and "the oldest row" now names a credential
that was never a bootstrap. That deletion legitimately re-opens the window — zero credentials exist
again — and the index permits a new `'bootstrap'` row, which is the correct posture rather than a
leak.

### Expiry and revocation are two facts, and merging them would make I9 unfalsifiable

The brief asked for a stated reason if they were collapsed. They are not collapsed, and the reason
they are not is the interesting half.

The cheap shape is `UPDATE auth_sessions SET expires_at = NOW()` as the implementation of logout: no
second column, one statement, and every acceptance command about expiry still passes. It is refused
on three grounds, in ascending order of weight:

1. It overwrites a value that was a fact about the session's *creation* with one about its end — a
   stored figure mutated into a different figure with nothing marking the boundary, §9.2's semantic
   change at row scale.
2. It loses the only thing this row can ever say about itself. This task deliberately creates no
   separate log, and SPEC.md's own justification for that exclusion is *"a session row's own
   timestamps are its audit trail"*. A merged column makes "the owner signed out at 14:02" and "this
   aged out overnight" the same record.
3. **It makes SPEC.md's I8 and I9 the same test.** A logout implemented as a no-op — clear the
   cookie, touch nothing server-side — reaches the identical database state a few hours later when
   the session expires on its own. With one column, "was it revoked?" and "did it expire?" have one
   answer, and the replay fixture cannot tell a working logout from a patient one. Two columns are
   what make I9 a falsifiable claim.

`revoked_at IS NULL` therefore means **not revoked**, which is a **stated departure** from this
repo's null-means-unknown rule, in the same way `budget_categories.control_mode`'s NOT NULL is one
and recorded in the same place — the column's own comment. The justification: revocation is an
event, this application is the only thing that can cause one, and there is no third state in which
the system does not know whether a session was revoked. The absence of a timestamp is knowledge, not
ignorance. A `revoked BOOLEAN NOT NULL DEFAULT FALSE` was rejected for losing the *when*, which is
the audit trail argument above.

`expires_at` is `NOT NULL` with no default: a session with no expiry is not a session, it is a
permanent credential, and no default can honestly assert a TTL the caller did not state. It is
absolute and never extended in place — a sliding expiry rewritten on each request makes a stolen
cookie immortal for as long as it is used.

### The validity predicate is written into the schema, once

```sql
SELECT 1 FROM auth_sessions
 WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()
```

It is in both files because it is the sentence a call site is most likely to re-derive with one
conjunct missing, and a missing conjunct here is an authentication bypass that renders perfectly.
Three properties of it are load-bearing and all three are stated next to the columns:

- **All three conjuncts, always.** `WHERE token_hash = $1` alone accepts a revoked cookie and an
  expired one.
- **`>`, not `>=`.** `expires_at` is the first instant at which the session is no longer valid; the
  interval is half-open. SPEC.md names the `<` vs `<=` slip as a failure mode, and the reason it is
  worth pinning is that neither choice has a visible symptom.
- **Evaluated by Postgres, never in JavaScript.** This is P1-11's N4 recurring on a new timestamp,
  and it is the one the brief flagged. Both columns are `TIMESTAMPTZ`; `pg` yields a JS `Date` inside
  a handler and `Response.json` yields an ISO-8601 string across the wire, so a comparison written in
  JS works against one representation and silently misbehaves against the other. It also introduces
  a second clock. `NOW()` is the database's clock and there is exactly one of it.

### `token_hash` stores the digest, and the CHECK is what makes that structural

The cookie's value is a bearer credential: anything holding it is signed in. Stored verbatim, this
table becomes a table of live logins — and `alert_sends`' own comment already makes the case that a
diagnostic table is read by a far leakier audience than the app's ledger is: a `psql` scrollback, a
CSV backup, a row pasted into an `EVIDENCE.md`. Storing SHA-256 means the store can *recognise* a
token it is shown and cannot *produce* one it has not been shown.

`CHECK (token_hash ~ '^[0-9a-f]{64}$')` is the same idiom as `alert_sends.fingerprint`, for the same
reason: a comment asking for opacity is advice about the caller, and a regexp is a property of the
database. The raw token is CSPRNG bytes rendered as base64url — wrong alphabet, wrong length — so
"just store the cookie value" is a statement Postgres will not accept. The cost is one `createHash`
call at two sites, and it is the primary key, so the hot read is unchanged.

### `credential_id` is TEXT and `public_key` is BYTEA, and the asymmetry is the argument

SPEC.md lists "base64url versus base64, padded versus unpadded, in credential-id round-tripping" as a
classic bug a hand-rolled encoding step reintroduces easily. The two columns answer it differently
because they have different jobs:

- `credential_id` exists to be **compared** against a value the browser sends already encoded.
  Storing the encoded form makes the lookup `WHERE credential_id = $1` with no decode step at all,
  and a decode step is where the bug lives. The `^[A-Za-z0-9_-]+$` CHECK refuses standard base64's
  `+`/`/` and any `=` padding, so the divergent encoding cannot be *written*. The identical pattern
  is `base64url` in `shared/contracts/auth.ts`, so the rule holds at both ends of the round trip
  rather than at one of them. A lookup performed in the other encoding still matches nothing — but
  matching nothing means refusing the login, which is the safe direction.
- `public_key` is never compared and never matched; it is handed to a verifier that wants bytes.
  `BYTEA` removes the encoding decision entirely rather than pinning one, and a decision that does
  not exist cannot be made inconsistently at two ends.

`octet_length(public_key) > 0` moves one specific quiet failure — a library upgrade renames the
field the verification result carries the key in, the insert stores an empty buffer, registration
reports success and every later login fails a signature check — from a symptom far from its cause to
a failure at the `INSERT`.

### `sign_count` is the one mutable column, and `0` is a real reading

It is `UPDATE`d on every accepted assertion. That is deliberate and is not the append-only rule being
waived: it is not a derived value and not a cached "latest", it is a high-water mark of state that
lives inside the authenticator, mirrored here because clone detection *is* the comparison against
the highest value seen before. An append-only counter series was considered and rejected — a row per
login, for no consumer, turning a comparison that must be atomic with the accept/reject decision into
a reduction over history.

The part worth the ink: **`0` means "this authenticator told us it has no counter", not "we have no
observation".** Per the WebAuthn specification an authenticator that does not implement a counter
reports 0 forever, which is most platform authenticators — Touch ID and anything synced through a
passkey provider. So clone detection is genuinely inert for such a credential, and the app must not
read a non-increasing counter as an attack when both the stored and the presented value are 0.
SPEC.md's failure list contains "sign-counter clone detection wired to a no-op"; the difference
between a check that is inert because the hardware says so and a check that was wired to a no-op is
invisible in the code unless this column's meaning is written down, which is why it is.

Making the column nullable to mean "no counter support" was considered and rejected: it would give
the app two representations of the same fact and force every comparison to handle both, and it would
misapply the null rule, since the authenticator really did report a value.

`NOT NULL` with **no DEFAULT**, exactly as `alert_sends.delivered`: the verifier knows the counter by
the time the row is written, and a `DEFAULT 0` would let an `INSERT` that forgot the column assert
"no counter support" for an authenticator that has one — permanently disabling the check for that
credential with nothing looking wrong.

### `shared/contracts/auth.ts` pins what this app owns, not what the library owns

`@simplewebauthn/server` already owns the definitive types for a ceremony. Re-declaring them here
would be a second definition of one concept, which is the defect BUILD.md §1 opens with. So the file
pins three things the library does not:

1. **`rp.id` and `rpId` are required.** The library's type makes them optional, and when absent the
   *browser* fills them in from the page's own origin — which is "derived from the request", the
   textbook relying-party mistake SPEC.md names, arriving through an omission rather than through a
   line anyone would review. A response missing it fails this schema instead of becoming a silently
   different relying party in the field. `relyingPartyId` additionally refuses IP literals, ports and
   URLs, which is the schema-level half of SPEC.md's rule that the WebAuthn origin set is *derived
   from* the host allowlist: `127.0.0.1`, `[::1]` and `0.0.0.0` are legitimate host-guard entries and
   can never be RP IDs, so a copied list fails to validate rather than failing in a browser with an
   opaque `SecurityError`. `localhost` is accepted — it is a domain and it is what the app runs under
   until Phase 2 supplies TLS.
2. **A failed ceremony is the error branch.** `CeremonyVerifiedResponseSchema` is
   `apiResponseSchema(z.null())`, so `{ success: true, data: { verified: false } }` cannot be
   expressed against this contract. That payload reads fine and lets a client which branches on
   `success` alone treat a failed login as a login — the whole defect wearing a different hat.
3. **The boundary's 401 speaks the same envelope as the 28 handlers.**
   `UnauthenticatedResponseSchema` is `ApiErrorResponseSchema` itself, named at its use site rather
   than re-declared. It is deliberately *not* `apiResponseSchema(z.null())`, which would also accept
   `{ success: true, data: null }` — a boundary that refuses a request "successfully" is
   indistinguishable on the wire from one that let it through.

**Every object in the file is `z.looseObject`, which is the opposite of the envelope's choice, and
the difference is load-bearing.** The envelope is strict because this application authors it end to
end. A ceremony object is authored by a browser at one end and a library at the other, and both add
keys this app has never heard of. A *stripping* schema would be worse than a strict one and quietly:
`.parse()` returns the stripped value, so a handler that parses the body and hands the RESULT to the
verifier hands it a payload with `response.transports` removed, loses the transports it was about to
store, and nothing fails until a second device is offered the wrong affordance. Loose objects retain
unknown keys, so the parsed value is safe to pass on. The rule for the implementer is one line:
**parse to refuse malformed input, never to reshape it.**

---

## Domain invariants preserved

- **Derived, not stored.** No "current", "latest" or "last used" column exists on either table. The
  one I was tempted by and refused is `webauthn_credentials.last_used_at`: it has no consumer (the
  credential-management UI is an explicit non-goal), it would be a mutable latest-value column of
  exactly the shape this role exists to refuse, and its honest home is an authentication log that
  this task deliberately does not create. `sign_count` is the single mutable column and is argued
  above as authenticator state rather than a derivation. `auth_sessions` carries no
  `is_valid`/`is_expired` column: validity is the derived read printed above, computed at the moment
  it is asked.
- **Money.** *Satisfied vacuously, and stated rather than left ambiguous:* neither table has a money
  column, a figure-bearing column, or a column that could carry one. No `NUMERIC`, no float, nothing
  to state a scale for. The sibling rule that does bite is timestamps, and it does: every one of the
  five timestamp columns is `TIMESTAMPTZ`, and the comparison that reads two of them is specified to
  run in SQL for the Date-versus-string reason recorded above.
- **Null semantics.** Three nullable columns, each with a documented meaning, none defaulted:
  - `webauthn_credentials.transports` — NULL = the authenticator reported nothing (genuinely
    unknown); `'{}'` = it reported an empty list. `DEFAULT '{}'` is refused because it turns "we were
    not told" into "we were told there are none".
  - `auth_sessions.revoked_at` — NULL = not revoked. The **stated departure**, argued above.
  - `AuthenticationCeremonyResponse.response.userHandle` — nullable and optional, because a
    non-discoverable credential returns none. It carries no routing information in a single-principal
    app and must never select a credential.
  Nothing is defaulted to zero. The one place a zero appears at all — `sign_count = 0` — is
  documented as a **real reading**, not a missing observation, which is the rule applied rather than
  broken.
- **Inheritance.** Not applicable. No column on either table inherits from a parent row and nothing
  resolves through a `COALESCE`. `auth_sessions.credential_id` is a plain `NOT NULL` foreign key, not
  an inheriting nullable in the `COALESCE(t.property_id, a.property_id)` sense; stated so the box is
  answered rather than skipped.

---

## Migration

**This role holds no Bash. Nothing below is reported as already-green** — it is stated for the
orchestrator to execute at G1.

```
createdb b8_p112_migtest
export DATABASE_URL=postgresql://localhost/b8_p112_migtest
npx node-pg-migrate up     # expect ... 1789300800000_passkey-credentials-and-sessions (UP)
npx node-pg-migrate down   # expect ... (DOWN)
npx node-pg-migrate up     # expect ... (UP)
dropdb b8_p112_migtest
```

`npm run migrate:up` hard-codes `--envPath .env.local`, which points at `b8_finance` — the dev
database holding real financial data. SPEC.md's verbatim script at acceptance #38 exports
`DATABASE_URL` first, which node-pg-migrate prefers; P0.5-33 nonetheless invoked
`npx node-pg-migrate` directly to remove the ambiguity, and that is the safer form to run by hand.

**Forward-only history (§9.3).** No existing migration is edited. The new file is
`1789300800000_passkey-credentials-and-sessions.sql`; `1789300800000` is 2026-09-13T12:00:00Z, later
than the previous newest, `1788505200000_alert-sends` (2026-09-04T07:00:00Z), so it sorts last under
node-pg-migrate's glob.

**The `down` drops the child first.** `auth_sessions` holds the foreign key; dropping the parent
first would fail, and "fixing" that with a `CASCADE` would silently take the sessions with it on
every future rollback.

**Expected shape** (stated for the gate to compare against, not observed):

```
webauthn_credentials
  credential_id  text                     not null   PK    CHECK ~ '^[A-Za-z0-9_-]+$'
  public_key     bytea                    not null         CHECK octet_length > 0
  sign_count     bigint                   not null         CHECK >= 0          (no default)
  transports     text[]                                                        (no default)
  enrolled_via   text                     not null         CHECK IN ('bootstrap','authenticated')
  created_at     timestamp with time zone not null   now()
  UNIQUE INDEX webauthn_credentials_one_bootstrap (enrolled_via) WHERE enrolled_via = 'bootstrap'

auth_sessions
  token_hash     text                     not null   PK    CHECK ~ '^[0-9a-f]{64}$'
  credential_id  text                     not null   FK -> webauthn_credentials(credential_id) ON DELETE CASCADE
  created_at     timestamp with time zone not null   now()
  expires_at     timestamp with time zone not null
  revoked_at     timestamp with time zone
  CHECK auth_sessions_expires_after_created (expires_at > created_at)
```

**Constraint names match between the two files.** The migration names its column-level CHECKs
explicitly; `db/schema.sql` writes them unnamed and lets Postgres generate `<table>_<column>_check`,
which is the same string in every case. The one table-level constraint,
`auth_sessions_expires_after_created`, is named explicitly in both. This is the property P0.5-33
verified by building a second database from `db/schema.sql` alone and diffing; the same check is
worth running here and is listed below as a command I could not run.

**Controls worth executing against the migrated scratch database**, with fabricated values only.
These are the statements whose refusal is the whole point of the constraints, and reading them is not
the same as running them:

| # | Statement | Expected |
|---|---|---|
| C1 | two rows with `enrolled_via = 'bootstrap'` | **rejected** — `webauthn_credentials_one_bootstrap`; the TOCTOU closure, proven by the database rather than by argument |
| C2 | one `'bootstrap'` row plus three `'authenticated'` rows | accepted — the gate is "needs a session", not "permanently closed" |
| C3 | delete the `'bootstrap'` row, then insert a new one | accepted — the window legitimately re-opens at zero credentials |
| C4 | `credential_id` containing `+`, `/`, or `=` | **rejected** — `webauthn_credentials_credential_id_check`; the padded/standard-base64 mistake is unwritable |
| C5 | `INSERT` omitting `sign_count` | **rejected** — not-null violation, no default to silently assert "no counter support" |
| C6 | `sign_count = 0` | accepted — a real reading, not a missing observation |
| C7 | `public_key = ''::bytea` | **rejected** — `webauthn_credentials_public_key_check` |
| C8 | `token_hash` = a 43-character base64url token | **rejected** — `auth_sessions_token_hash_check`; storing the raw cookie value is not a statement the database accepts |
| C9 | `expires_at < created_at` | **rejected** — `auth_sessions_expires_after_created` |
| C10 | `auth_sessions` row referencing an unknown `credential_id` | **rejected** — foreign key; a session cannot outlive attribution |
| C11 | delete a credential holding live sessions | accepted, and the sessions disappear with it — `ON DELETE CASCADE`, the retired-device path |
| C12 | the validity predicate against three rows: valid, expired, revoked | returns exactly the valid one |

---

## Backfill / data correction required

**None.** Both tables are created empty and have no producer until the implementer writes one. There
are no existing rows to correct, no column to backfill, and therefore **no CSV backup to take
first** — which is a deliberate exception to §9.3's standing practice, the second in this repo, and
is reasoned in the migration rather than left to be inferred: the practice protects observations of
the world that exist nowhere else, and nothing here is one. A credential is re-creatable by
re-registering the same physical authenticator; a session is re-creatable by signing in.

**The real risk of a rollback is not data loss, and it is written into the `down`.** Dropping these
tables returns the app to zero credentials, which means that on re-apply **the bootstrap window is
open again** and the first unauthenticated visitor may enrol themselves as the owner. That is safe
only if the boundary is rolled back in the same motion — which SPEC.md's rollback section already
requires, and which is exactly the partial-revert shape it says this step exists to prevent. The app
must not be reachable while the migration is down and the code is not.

---

## Consumers checked

- **`npx tsc --noEmit`** → expect `exit=0`. The diff adds one TypeScript file and changes no existing
  declaration, so no existing consumer's types move. Nothing imports `shared/contracts/auth.ts` yet.
- **`npm test`** → expect the pre-existing pass count, unchanged. The fixture that constrains this
  role most is `shared/contracts/index.test.ts`: it reads every exported name out of
  `shared/types.ts`'s AST and requires `Object.keys(CONTRACT_SCHEMAS)` to equal that set minus
  `ApiResponse`. Because `shared/types.ts` is untouched and `index.ts` is untouched, both sides of
  that comparison are unchanged. `vitest.config.mts` includes `shared/**/*.test.ts`; this diff adds
  no test file, by design — the implementer writes the fixtures.
- **`npm run lint`** → expect the one pre-existing warning and no other. Every import in
  `auth.ts` is used: `z`, `apiResponseSchema` (three envelopes), `ApiErrorResponseSchema`
  (`UnauthenticatedResponseSchema`). Every exported const and type is exported, so none can trip an
  unused-symbol rule.
- **Layering.** `shared/contracts/auth.ts` imports `zod` and `./envelope`. No `next/server`, no `pg`,
  no `@/lib/db`, no `lib/**` — not even `import type`, for the reason P1-11's CONTRACT.md recorded: a
  type-only import is erased at runtime but is a real import node in the AST, and the checks that
  prove the contract surface cannot reach a connection pool parse exactly those nodes. Imports are
  relative, matching the directory, because vitest registers no tsconfig-paths resolver.
- **Existing SQL consumers: none affected.** Two `CREATE TABLE`s and one `CREATE INDEX`; no existing
  relation, column, constraint or index is touched, so no query in `app/`, `lib/`, `components/` or
  `scripts/` can change behaviour.
- **`shared/contracts/index.ts` is not amended**, so no existing import's resolution changes.
  Consumers import `shared/contracts/auth` directly, as they do `shared/contracts/overview`.
- **`scripts/seed-demo.mjs`** needs no change and must not gain one: a demo database legitimately has
  no credentials and no sessions, and seeding a credential would fabricate an enrolment that never
  happened — and, worse, consume the single `'bootstrap'` slot on a database someone may then try to
  register against.

---

## Judgements SPEC.md left open

| Decision | Taken | Rejected, and why |
|---|---|---|
| **Does `shared/types.ts` gain anything?** | **No.** The inferred ceremony types are exported from `auth.ts`. | An export there would have no importer — these are server-only concepts and the one client surface, `/login`, needs no row type. On P1-11's precedent that is already sufficient. It is also **not exercisable on this surface**: `shared/contracts/index.test.ts` requires exactly one `CONTRACT_SCHEMAS` entry per exported name of `shared/types.ts`, and `index.ts` is not on this task's declared file list (acceptance #39/#40), so taking the option would fail acceptance #2 with no in-scope repair. |
| **Session token: raw or digest?** | `token_hash` = SHA-256, lowercase hex, CHECK-constrained. | Storing the cookie value verbatim — it makes a database read, a CSV backup or a `psql` scrollback a live login, and a session store is exactly the table a human reads while debugging. Storing an HMAC with a server secret was also rejected: it adds a key to manage and a second failure mode (a rotated secret invalidates every session) for a property the digest already has here, since the token is CSPRNG and not guessable. |
| **Expiry vs revocation** | Two columns: `expires_at NOT NULL`, `revoked_at` nullable. | `SET expires_at = NOW()` as logout (argued above — it makes I8 and I9 the same test, so a no-op logout passes); `revoked BOOLEAN NOT NULL DEFAULT FALSE` (loses the *when*, which is the session row's whole audit trail given no separate log exists); a single nullable `invalidated_at` meaning either (same collapse, plus it would need `expires_at` to become nullable, which turns "no expiry" into a representable state). |
| **Session primary key** | `token_hash`. | A surrogate `SERIAL id` with `UNIQUE (token_hash)` — the id would have no reader, since nothing ever addresses a session by anything but its cookie, and a second unique index on the one hot read is cost with no consumer. |
| **Does the session record which credential signed it in?** | Yes — `credential_id NOT NULL REFERENCES ... ON DELETE CASCADE`. | Omitting it. The FK is not decoration: removing a retired device's passkey is a direct database operation in v1 (SPEC.md names the gap), and a delete that left that device's sessions alive would retire the key while leaving the door it opened propped. `ON DELETE SET NULL` (keeps the session alive — the exact failure) and `ON DELETE RESTRICT` (blocks the delete and invites clearing sessions by hand first, the same outcome reached less reliably) were both rejected. |
| **Credential primary key** | `credential_id` (natural), like `accounts.id`. | `SERIAL id` + `UNIQUE (credential_id)`. Uniqueness on the credential id is not a convenience here, it is the property that makes "which stored public key verifies this assertion" a question with one answer; making it the PK says so directly, and a surrogate key would have no reader now that the session's FK points at the natural one. |
| **Credential id storage** | `TEXT` + base64url CHECK. | `BYTEA` with a decode on every lookup — it would make padded-vs-unpadded harmless at the cost of putting a decode step in the hot path of every login, which is the step the bug lives in. Pinning one canonical encoding at the column is the cheaper half of the same guarantee, and `alert_sends.fingerprint` is the house precedent for it. |
| **Public key storage** | `BYTEA`. | Base64url `TEXT` for symmetry with the id — symmetry is the wrong goal; the key is never compared, so an encoding it does not need is an encoding that can go wrong. |
| **Sign counter** | Stored, mutable, `NOT NULL`, no default, `0` documented as a real reading. | An append-only counter series (a row per login, no consumer, and a comparison that must be atomic becomes a reduction over history); nullable-means-no-counter (two representations of one fact, and a misapplication of the null rule — the authenticator really did report a value); `DEFAULT 0` (an `INSERT` that forgot the column would permanently assert "no counter support"). |
| **Transports** | `TEXT[]`, nullable, no CHECK on elements. | A CHECK over the known transports — the vocabulary is open and still moving (`cable` retired, `hybrid` and `smart-card` added), so a closed list fails a future browser's registration at the `INSERT` with no recourse but a migration. `DEFAULT '{}'` — turns "not reported" into "reported none". |
| **Columns NOT added to `webauthn_credentials`** | None of `aaguid`, `backed_up`, `credential_device_type`, `nickname`, `last_used_at`. | Each has exactly one plausible consumer — a credential-management UI — which is an explicit non-goal. They are additive later at no cost. `last_used_at` is the one refused on principle rather than on scope: it is a mutable latest-value column, and its honest home is an authentication log this task does not create. |
| **Table names** | `webauthn_credentials`, `auth_sessions`. | A bare `sessions` — Phase 3's agent chat has an obvious claim on that noun, and a schema in which `sessions` might mean conversations is one where a query gets written against the wrong table. `credentials` alone — this repo will hold Plaid access tokens, SMTP settings and eventually API keys, and only one kind of credential belongs in this table. |
| **`user_id` on either table** | **Absent**, with the reason written into both files at length. | Not mine to relax, and the argument is stronger than the instruction: with a `user_id`, "zero credentials exist" necessarily becomes "zero for this user", and an unauthenticated request cannot name a user without being permitted to invent one — at which point the bootstrap gate is worth nothing and the partial unique index would have to be unique-*per-user*, re-opening the very race it closes. The bootstrap rule and a one-row users table cannot both be honest. |
| **Ceremony objects: strict, stripping, or loose?** | **Loose**, uniformly. | Stripping (`z.object`) is the dangerous one and is what a reader would reach for by habit: `.parse()` returns the stripped value, so a handler that passes the parsed body to the verifier silently drops `response.transports` and `clientExtensionResults`. Strict would reject every real browser payload, since browsers add keys this app has never heard of. |
| **Modelling depth of the ceremony payloads** | Only the fields verification cannot proceed without, plus `rp.id`/`rpId`. | A full transcription of `@simplewebauthn/server`'s types — a second definition of one concept, which would drift with the library and be discovered by a failed login. |
| **Verify/logout response body** | `apiResponseSchema(z.null())`. | `{ verified: boolean }` — it lets a client branching on `success` alone treat a failed login as a login, and a failed ceremony belongs in the error branch. `{ expiresAt }` — no consumer this task creates reads it, the cookie is `HttpOnly` so the client cannot corroborate it, and a body describing the session is a second representation that can disagree with the cookie. |
| **The boundary's 401 body** | `UnauthenticatedResponseSchema = ApiErrorResponseSchema`, aliased at the use site. | `apiResponseSchema(z.null())` — it would also accept `{ success: true, data: null }`, and a boundary that refuses "successfully" is indistinguishable on the wire from one that let the request through. Leaving it unspecified — the proxy is not a handler and will hand-build the body; a hand-built `{ error: 'unauthorized' }` is discovered by a client, not by a test. |
| **Error codes** | `AuthErrorCodeSchema` — three codes, as a documented **subset**, not a narrowing of `ApiErrorResponseSchema`. | Closing the vocabulary — `envelope.ts` keeps `code` open deliberately, so a new failure mode can be reported without a contract amendment. Leaving codes unnamed — the `/login` page must distinguish "registration is closed, sign in instead" from "your ceremony failed", and with no code it would have to match on `message` text, which is not a contract and will be reworded. |
| **One code for all four verification failures** | Yes — `CEREMONY_FAILED` covers wrong origin, wrong challenge, wrong key, unknown credential. | Four distinct codes. Telling an unauthenticated caller which axis it got wrong is free reconnaissance; the four are already separate *fixtures* (F8, F9, F11, F12), where a test can see them and a stranger cannot. |
| **A `GET /api/v1/auth/status` telling `/login` whether registration is open** | **Not added.** | SPEC.md's allowlist is "exactly five surfaces, and no others", and negative control #12 asserts it is neither empty nor total. A sixth unauthenticated endpoint would contradict a frozen spec, and it would also publish "this deployment has no owner yet" to anyone who asks. The page offers both actions and renders `REGISTRATION_CLOSED` when it comes back. |
| **Challenge minimum length** | `>= 22` base64url characters (16 bytes), the WebAuthn specification's floor. | Unbounded — a 4-byte challenge passes every "the challenge did not match" negative control while being guessable, which is the same hole F5 puts a floor under for the session identifier. |
| **`SESSION_COOKIE_NAME` / the session TTL in the contract** | **Not added.** | Both are single-definition concerns, but neither crosses a boundary: the cookie is `HttpOnly`, so the only readers are the proxy and the handlers, all server code, and `lib/` is where one definition serves them all. Putting a policy constant in `shared/contracts/` would start that directory meaning "all the shared values" rather than "the wire contract" — the same line `alert_sends`' contract drew when it kept `AlertKind` in `lib/`. |
| **`base64url` in `representation.ts`** | Declared in `auth.ts`. | `representation.ts` names how a *Postgres* value reaches a consumer, measured against `pg`; base64url is a WebAuthn wire convention with nothing to do with the driver. `representation.ts` is also outside this task's declared file list. Same reasoning that put `moneyString` in `overview.ts`. |
| **`db/schema.sql` placement** | Appended at the end, under its own section header. | Interleaving beside an existing table — nothing above joins to these two, and the point worth making at the top of the section is that they are the first tables in the file holding no financial data. A pure append also keeps the diff trivially reviewable. |
| **A `revoked_at >= created_at` CHECK** | **Not added.** | Considered. It refuses a nonsense row, but no plausible writer produces one (`revoked_at` is set to `NOW()` by the same process that created the row), and this role's standing rule is a minimal diff. Recorded so its absence reads as a decision. |

---

## Handed to the implementer

Specified here, executed there — this role runs no commands and writes no code outside the contract
surface.

1. **Wrap the registration ceremony's two writes in one transaction**, credential first, session
   second. `auth_sessions.credential_id` is `NOT NULL`, so the order is forced; the transaction is
   what stops a bootstrap credential existing with no session after a mid-write failure, which would
   consume the single `'bootstrap'` slot and lock the owner out permanently.

2. **Catch the unique violation, do not pre-empt it.** The bootstrap `INSERT` may fail with SQLSTATE
   `23505` on `webauthn_credentials_one_bootstrap`. Map it to the same refusal the count check
   produces (`REGISTRATION_CLOSED`). Do **not** retry, and do **not** replace the count check with
   the constraint — the count check is what produces a clean refusal in the ordinary case, and the
   index is what covers the concurrent one.

3. **Tag `enrolled_via` from the request's session state, not from the count.** `'bootstrap'` if the
   request carried no session; `'authenticated'` if it did. Writing `'authenticated'` for a
   session-less request would satisfy the index and defeat the rule — this is the hole the schema
   cannot close, and it is what I2 tests.

4. **The validity predicate runs in SQL.** `WHERE token_hash = $1 AND revoked_at IS NULL AND
   expires_at > NOW()`. Not a JS `Date` comparison, not `>=`, and not two of the three conjuncts.
   This is P1-11's N4 boundary on a new timestamp: `pg` gives you a `Date` and the wire gives you a
   string, and a JS comparison works against one of those.

5. **Hash the token with `node:crypto`'s `createHash('sha256')` and store the lowercase hex.** The
   cookie carries the raw base64url token; the database never sees it. The column's CHECK will refuse
   the raw value, so this is not a rule you can forget silently — but it is a rule you can discover
   late, which is why it is here.

6. **Logout is an `UPDATE ... SET revoked_at = NOW()`, never a `DELETE`, and never a cookie clear
   alone.** Clearing the cookie is also required, and is not sufficient: I9 replays the same cookie.
   A `DELETE` would leave a store in which "signed out" and "never existed" are the same answer.
   Pruning old rows is a separate maintenance concern and may `DELETE` freely.

7. **Parse to refuse, never to reshape.** The ceremony schemas are `z.looseObject`, so
   `.parse()` retains unknown keys and its result is safe to hand to `@simplewebauthn/server`. Do not
   re-build a narrowed object from the parsed fields before verifying — that is the stripping bug
   written by hand.

8. **`rp.id` / `rpId` come from the server's fixed configuration.** The schemas require the field, so
   an omission fails; only you can ensure the value did not come from `request.headers.get('host')`.
   `relyingPartyId` refuses IP literals, which means the WebAuthn set cannot simply be a copy of the
   host-guard allowlist — derive it, as F3 requires.

9. **`allowCredentials` lists every stored credential, not the newest.** No schema can tell a
   complete list from a truncated one. The fixture that catches it is a two-credential login.

10. **The user handle is a stable constant in `lib/`.** Not a column — a table holding one handle
    forever is a users table under another name. It must not be regenerated per ceremony: a changing
    handle makes every registration look like a different user to the authenticator, so a platform
    authenticator silently creates a second passkey instead of recognising the first.

11. **Import relatively**: from `lib/` or `app/`, `'../shared/contracts/auth'` at the appropriate
    depth. `vitest.config.mts` registers no tsconfig-paths resolver, so `@/shared/...` will not
    resolve under the test runner — the constraint P1-10 and P1-11 both hit.

12. **Nothing is re-exported through `shared/contracts/index.ts`.** That file is outside this task's
    declared surface. Import `shared/contracts/auth` directly.

---

## Reported, not acted on

- **SPEC.md's allowlist omits `/login`'s own static assets, and that is probably fine but is worth
  one look at G2.** The five allowlisted surfaces are four endpoints and the `/login` page. A Next
  page pulls its own JS chunks and CSS; the current `middleware.ts` matcher already excludes Next's
  static assets, and if the new `proxy.ts` matcher preserves that exclusion the question does not
  arise. If it does not, `/login` renders unstyled and inert for an unauthenticated visitor, and the
  failure mode is a blank login page rather than a security hole. Nothing in my surface can settle
  it; SPEC.md's own failure list already names "the `proxy` matcher narrowed or reordered", which is
  the same object.

- **The Month-4 sequencing gap that SPEC.md records has a schema consequence it does not name.** A
  cookie-only session has no non-browser path, and the Python eval-runner targeting `/api/v1/chat`
  before Phase 3 will need one. When that arrives, the honest shape is a *second* credential kind
  with its own table — not a nullable `token_type` column on `auth_sessions`, and not a
  hand-inserted row whose `credential_id` points at a passkey that did not authenticate it. I am
  recording the constraint now, while `credential_id NOT NULL` is a fresh decision rather than an
  obstacle someone works around at 2am: a session in this table means *a WebAuthn ceremony
  completed*, and anything else is a different kind of thing.

- **`db/schema.sql` is hand-maintained, so "it reflects the migration" is a claim that can rot.**
  P0.5-33 checked it by building a second database from `db/schema.sql` alone and diffing the column,
  constraint and index sets against the migrated one. I could not run that. I have matched the
  constraint names between the two files by construction (see Migration), but the check is worth
  re-running here because this diff introduces the first `BYTEA` column, the first `TEXT[]` column
  and the first partial unique index in the schema, and all three are places a hand-maintained
  reflection can differ invisibly.

- **A brand-new migration file is untracked, so `git diff --name-only HEAD -- migrations/` reads
  `0` for it** — the wrinkle P0.5-33 hit at its acceptance #67. It affects acceptance #35 (`git diff
  HEAD -- migrations/ db/schema.sql | grep -ic mutation_audit_log`), which reads `0` either way and
  so passes for the right reason only after `git add -N`. #40's `git status --porcelain` form sees
  the untracked file correctly. Flagged as a command wrinkle, not a contract defect.

- **No defect found in SPEC.md that blocks.** The scope answer, the allowlist, the bootstrap rule and
  the non-goals are all consistent with what this surface can express, and the one judgement it
  explicitly delegated — whether the schema can close the TOCTOU race — turned out to be answerable
  yes, which is the outcome that most justifies the delegation.

---

## Commands this role could not run

This role holds no Bash. Everything here is stated for the orchestrator to execute at G1; none of it
is reported as already-green.

- `npx tsc --noEmit` → expect `exit=0`. The new file's only compile-time risks are zod-4 API surface:
  **`z.looseObject`** (used eight times, and the one API in this file the directory does not already
  exercise — `enums.ts`/`shapes.ts`/`envelope.ts` use `z.object`, `z.strictObject`, `z.enum`,
  `z.literal`, `z.int`), `ZodString.min()` chained onto a `.regex()` result, `.refine()` with a
  message string, and `z.array(...).min(n, msg)`. If any does not compile it is mine to fix and not
  the implementer's; the loose-object requirement is load-bearing, so the fallback if `z.looseObject`
  is unavailable in the installed version is `z.object({...}).loose()`, not `z.object`.
- `npm test`, `npm run lint` → expect unchanged, for the reasons under "Consumers checked".
- `npx node-pg-migrate up | down | up` against a scratch database → expect a clean round trip and the
  shape printed above. **Not run.** No migration in this repo has ever been merged without this, and
  the twelve controls above are the part that a reading cannot substitute for — particularly C1,
  which is the only evidence that the TOCTOU closure is real rather than argued.
- `npm run build`, `npm ci` → expect `exit=0`. This diff adds no dependency; SPEC.md's acceptance #6
  (`npm ls @simplewebauthn/server`) is the implementer's to satisfy, not mine — nothing in the
  contract surface imports it, deliberately.
- `psql "$DATABASE_URL" -c "select current_database();"` → must not be `b8_finance`. Every command
  above must be run against a scratch database; `npm run migrate:up` hard-codes `--envPath .env.local`
  and that file points at the dev database holding real financial data.
