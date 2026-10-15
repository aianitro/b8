# CONTRACT — P7-41a-second-user
**Author:** contract-guardian
**Lease:** opened by the orchestrator before dispatch (2026-10-14) · closed <orchestrator records from `.claude/bin/lease`> — this role cannot run the lease script, so the exact timestamps are the orchestrator's to fill.

## Change
| File | Change | Class (§9.2) |
|---|---|---|
| `migrations/1792300000000_second-user.sql` | **New.** Tables `users` (with `users_one_owner` partial unique index and `users_owner_not_revoked` CHECK) and `user_invitations`. Owner row backfilled only when credentials exist. `webauthn_credentials.user_id` added nullable, backfilled to the owner, tightened to `NOT NULL`. `webauthn_credentials_enrolled_via_check` widened to admit `'invitation'`. `web_push_subscriptions.user_id` added, backfilled to the owner, tightened to `NOT NULL` (orphans on a credential-less database deleted — see Rationale). `agent_proposals.proposed_by_user_id` / `decided_by_user_id` added nullable, backfilled only through a session that still exists, plus two one-directional CHECKs. Reversible. | **breaking, by the letter** — two `NOT NULL` columns on populated tables. Handled by §9.2's preferred route (nullable, backfill, tighten) inside one transaction, so no reader ever sees a NULL. Everything else in the file is **additive**: two new tables, two nullable columns, and the `enrolled_via` widening (see below). |
| `webauthn_credentials.enrolled_via` CHECK widening (within the migration) | `('bootstrap','authenticated')` → `('bootstrap','authenticated','invitation')` | **additive** — §9.2's "new enum-ish value". Neither existing value changes meaning, so no stored row is reinterpreted; the semantic-change trap does not apply. Every consumer that branches on this column must treat an unknown value as "not bootstrap", which is the only branch that exists today. |
| `db/schema.sql` | Reflects all of the above. The auth section's "neither table has a user_id" paragraph is replaced, because it had become false. | additive (reference file) |
| `packages/contracts/auth.ts` | **Added:** `UserDisplayNameSchema`, `UserIdSchema`, `MeSchema`, `MeResponseSchema`, `invitationCode`, `InvitationCreateRequestSchema`, `InvitationCreatedSchema`, `InvitationCreatedResponseSchema`, `UserRevokedResponseSchema`, the error code `OWNER_ONLY`, and the types `Me`, `InvitationCreateRequest`, `InvitationCreated`. **Comment-only:** the `user.id` paragraph on `RegistrationCeremonyOptionsSchema` and the `userHandle` paragraph on `AuthenticationCeremonyResponseSchema`, both of which asserted a single principal and were about to be false. No existing schema changes shape. | additive |
| `packages/contracts/*` other, `packages/contracts/types.ts` | none | — |

## Rationale

### Why a users table now, when the passkey migration refused one
The 1789300800000 migration's refusal rested on two arguments. The first — a table with one row forever is decoration — stopped being true when the owner asked for a second person. The second was the decisive one: with a `user_id`, "zero credentials exist" becomes "zero for this user", and an unauthenticated request cannot name a user without inventing one. That argument is honoured, not overridden. The bootstrap gate stays a **global** count and `webauthn_credentials_one_bootstrap` is untouched. The only way an unauthenticated request creates a user is by presenting an invitation the owner minted while signed in. Nobody invents a user; the owner does.

### Why invited enrolments get a new `enrolled_via` value
Reusing `'bootstrap'` would trip the at-most-one-bootstrap index for the second user, and the only fix would be to drop the index, which reopens the race it closes. Reusing `'authenticated'` would be false: that tag means "a signed-in user added a device", and the invitee presented no session. `'invitation'` is provenance, the same kind of fact the column already records.

### Why at most one owner is an index, and the owner cannot be revoked
`users_one_owner` (`UNIQUE (is_owner) WHERE is_owner`) is the bootstrap index's twin. Two concurrent bootstrap ceremonies both read "no owner yet"; this makes the second INSERT fail however they interleave. It does not require an owner to exist, so a fresh database has none until the first bootstrap creates it.

`users_owner_not_revoked` exists because without it, one careless UPDATE leaves an app with no owner: nobody can invite and nobody can remove, and the bootstrap gate stays shut because credentials still exist. That is unrecoverable without psql, and the CHECK makes it unwritable.

### Why `users.revoked_at` exists alongside deleting credentials
SPEC.md requires that a removed user's passkeys stop working while the `users` row survives. Deleting the credentials does the first (and cascades sessions, personal tokens and handoffs). But a deleted row leaves no record of **when**, or that removal happened at all. `revoked_at` is that record, with the same "NULL means not removed" departure `auth_sessions.revoked_at` makes. Deleting the credentials is still required, not optional: see the down migration's reasoning below.

### Why `users.id` is a SERIAL and not an opaque token
It appears in one URL, `/api/v1/auth/users/[id]/revoke`, reachable only by the owner's full-scope browser session, so guessability buys an attacker nothing. It is never a WebAuthn user handle. A random text id would add opacity with no threat it answers. `pg` returns `INTEGER` as a JS number, so `UserIdSchema` is `z.int().positive()`.

### Why `user_invitations` is shaped like `device_handoffs`
The same problem: a short-lived, single-use secret in flight between two people or two devices. The code is stored only as SHA-256 hex under a format CHECK, so storing the raw code is a statement Postgres refuses. Redemption is a lookup by hash in SQL, never a comparison in JavaScript. `consumed_at` and `consumed_by` are tied by a CHECK so a half-finished redemption is unwritable, and `consumed_by` is UNIQUE so two concurrent redemptions cannot both attach a user to one invitation. The seven-day bound SPEC.md states is a CHECK, like `auth_sessions_personal_lifetime`, so a mis-typed TTL fails at the INSERT.

### Why the push orphan case deletes rather than attributes
A `web_push_subscriptions` row can outlive every credential, because deleting a passkey cascades its sessions but not the subscriptions those sessions registered. On such a database there is no owner, and the next bootstrap may be a different person. Giving the rows to whoever enrols next is attribution by guess, and would send that person's pings to a phone that is not theirs. Failing the migration instead was considered and rejected: the deploy applies migrations unattended, and a subscription holds no financial data and is re-created by the device registering again. So the up deletes them. On any database that has a credential — including the owner's — that statement deletes nothing. The cost is stated: those rows are not restored by the down.

### Why the acting-user columns carry a one-directional CHECK
`proposed_by IS NULL OR proposed_by_user_id IS NOT NULL` (and the same for `decided_by`). A writer that records the session but forgets the person is the silent half of the attribution, and S14's mutation shape. The converse must not hold: the session row can be pruned later (SET NULL on `proposed_by`) while the person stays, which is the whole reason these columns exist. The CHECK holds for every existing row once the backfill has run, because a live session always reaches a credential and every credential now has a user.

### Why the down deletes the second user's credentials and subscriptions
The code the down rolls back to has one principal and treats every credential as the owner. A second user's passkey left in place would sign in **as the owner** on the old code — attribution by guess, in its most dangerous direction. SPEC.md's Rollback section asks the operator to revoke the second user before running `down`; the down makes that unconditional instead of a step someone can forget. Their push subscriptions go too, because the old send path pings every live subscription. Every row that existed before the up belongs to the owner and survives untouched, which is what #4's `1 3 1 2` measures.

If an `'invitation'` credential ever belonged to the owner, re-narrowing the CHECK fails and the whole down rolls back. That is deliberate: no relabelling of such a row is honest, so the down refuses.

### Why the contract objects are strict
The ceremony objects are loose because a browser and a library both add keys this app never heard of. These new objects are authored by this app at both ends. A stray `isOwner: true` on an invitation request is exactly the key that must be refused, not carried through.

### Why `invitationCode` pins 16 bytes
The code is presented pre-auth, to endpoints any visitor can reach, and lives up to seven days. It is the only thing between a stranger and a new user. The database holds only its hash, so the contract is the one place its strength can be pinned. 22 base64url characters is the floor `challengeString` already uses.

## Domain invariants preserved
- **Derived, not stored:** no "current" or "latest" column is added. `is_owner` is a stored fact, not "the oldest user". No user's "current session" or "last login" column was added. Observation tables are untouched.
- **Money:** not applicable. No column added here holds a figure; nothing is `NUMERIC`, and nothing is float.
- **Null semantics:** `agent_proposals.proposed_by_user_id` / `decided_by_user_id` NULL means "no person is known" (a system proposal, or a session gone before backfill) — never the owner. `users.revoked_at` NULL means not removed, a stated departure documented at the column, like `auth_sessions.revoked_at`. `user_invitations.consumed_at` NULL means unconsumed. No NULL is defaulted to the owner anywhere; `webauthn_credentials.user_id` and `web_push_subscriptions.user_id` are NOT NULL precisely so a lookup never has a NULL to guess about.
- **Inheritance:** sessions (all three kinds) and `device_handoffs` **inherit** their user through `credential_id → webauthn_credentials.user_id`. They deliberately carry no `user_id` of their own, so there is one answer to "whose session is this". The schema.sql auth section states this.

## Migration
The orchestrator runs these. This role has no Bash, so nothing below is reported as green.

Prerequisite: `createdb b8_p41a_throwaway && createdb b8_p41a_schema`; confirm neither is `b8_finance`.

```
export DATABASE_URL=postgresql://localhost/b8_p41a_throwaway
psql "$DATABASE_URL" -tAc "select current_database()"     # b8_p41a_throwaway
npm run migrate:up && npm run migrate:down && npm run migrate:up
```
Then run SPEC.md acceptance **#4** verbatim (it begins from its own down/up and leaves `$U` migrated up), then **#5** verbatim against `S=postgresql://localhost/b8_p41a_schema`.

Expected #4 lines, in order: `1`, `1`, `1`, `<O> null`, `null null`, `resolved-as-owner 3 unknown null`, `1 3 1 2`, `gone gone`, `1`. The `resolved-as-owner` line depends on implementer code (`resolveSession` returning `userId`), so at G1 it is expected to read `resolved-as-owner 0 unknown null` or to fail to compile. Every other line is this migration's alone and must match at G1.

Expected #5: every diff empty, `$U` listings non-empty, index count `≥ 1` (`users_one_owner`). If a diff appears on `webauthn_credentials`, `web_push_subscriptions` or `agent_proposals` in a column or constraint this task did not add, it is pre-existing drift between `db/schema.sql` and the older migrations (the class H5 records). Report it to me rather than editing around it; I could not compare those older migrations without a directory listing.

Additional controls worth running against `$U` while migrated up (fabricated values only):

| # | Statement | Expected |
|---|---|---|
| C1 | `INSERT INTO users (display_name, is_owner) VALUES ('Test User Two', TRUE)` while an owner exists | rejected: `users_one_owner` |
| C2 | `UPDATE users SET revoked_at = NOW() WHERE is_owner` | rejected: `users_owner_not_revoked` |
| C3 | `INSERT INTO user_invitations (code_hash, created_by, display_name, expires_at) VALUES ('not-a-hash', <O>, 'Test User Two', NOW() + INTERVAL '1 day')` | rejected: `user_invitations_code_hash_format` |
| C4 | same with a valid 64-hex hash and `expires_at = NOW() + INTERVAL '8 days'` | rejected: `user_invitations_lifetime` |
| C5 | `UPDATE user_invitations SET consumed_at = NOW()` with `consumed_by` left NULL | rejected: `user_invitations_consumed_together` |
| C6 | `UPDATE agent_proposals SET decided_by_user_id = NULL WHERE id = 'legacyproposaldecided01'` | rejected: `agent_proposals_decider_has_user` |
| C7 | fresh empty DB: `migrate:up` | succeeds; `select count(*) from users` → `0` |
| C8 | fresh empty DB with one `web_push_subscriptions` row and zero credentials, then `migrate:up` | succeeds; subscriptions count → `0` (the documented deletion) |

## Backfill / data correction required
The backfill is inside the migration, so the implementer does not run a separate correction. It touches the owner's real `webauthn_credentials`, `web_push_subscriptions` and `agent_proposals` rows on `b8_finance` when the deploy applies it. Standing practice applies: **back up first, outside the repo**, before the migration reaches the real database:

```
mkdir -p ~/b8-backups/p41a && cd ~/b8-backups/p41a
for t in webauthn_credentials auth_sessions web_push_subscriptions agent_proposals; do
  psql "$REAL_DATABASE_URL" -c "\copy (select * from $t) to '$t.csv' csv header"
done
```
(`auth_sessions` is included because the down's cascade can remove rows from it.) Record row counts before and after in EVIDENCE.md — counts only, no values. Expected after: `users` = 1 row (`Owner`); every credential and subscription row has the owner's `user_id`; `agent_proposals` rows with a live `proposed_by` / `decided_by` gain a user, all others stay NULL.

## Consumers checked
- `npx tsc --noEmit` → **not run by this role.** Expected exit 0: every addition to `auth.ts` is new, and no existing schema changed shape. Compile risks are mine to fix: `z.int().positive()` and `base64url.min(22, …)` chained on an already-`min`ed string (the latter is the existing `challengeString` idiom).
- **SQL writers that will fail once the migration is applied** — expected, and the implementer's to update, not a contract defect: every INSERT into `webauthn_credentials` (the register route, plus the integration fixtures SPEC.md names) must supply `user_id`; every INSERT into `web_push_subscriptions` (`registerSubscription` in `apps/web/lib/webPush.ts`, which must also SET `user_id = EXCLUDED.user_id` on conflict so re-registration moves the row); every write of `agent_proposals.proposed_by` / `decided_by` must write the matching `_user_id` in the same statement, or the new CHECKs refuse it.
- **Readers unaffected:** no ledger query changes. `categorySuggester` keeps reading `proposed_by IS NULL`. `idx_web_push_live` still serves the send path; the per-user predicate is selective enough on a table of a few rows that no new index is added.
- **`AuthErrorCodeSchema` gains `OWNER_ONLY`.** If any test pins the enum's exact options, it needs updating; I found none by reading, but I could not search.

## Handed to the implementer
1. **WebAuthn user handle per user.** The owner keeps the existing constant handle from `lib/`, because the owner's passkeys are already enrolled under it. The second user must get a different, stable handle. Do not derive it from `users.id` alone in a way that could collide with the owner's constant. Never resolve a user from the handle a browser returns; resolve it from the credential row.
2. **Redemption is one transaction:** lock the invitation row by `code_hash` with `expires_at > NOW() AND consumed_at IS NULL`, verify the ceremony, then INSERT the user, INSERT the credential (`enrolled_via = 'invitation'`, `user_id` = the new user), set `consumed_at = NOW(), consumed_by = <new user>`, create the session, and commit. Any failure rolls back everything, so the invitation stays unconsumed (S8).
3. **Bootstrap creates the owner in the same transaction as the credential**: INSERT `users (display_name, is_owner) VALUES ('Owner', TRUE)` and map a `users_one_owner` unique violation to `REGISTRATION_CLOSED`, as for `webauthn_credentials_one_bootstrap`.
4. **Revoke is one transaction**: refuse if the target is the owner or unknown; set `users.revoked_at = NOW()`; DELETE that user's `webauthn_credentials` (cascades sessions, personal tokens, handoffs); set `revoked_at = NOW()` on that user's live `web_push_subscriptions`. Do not delete the `users` row: `agent_proposals` references it and the FK refuses.
5. **Session resolution fails closed**: join session → credential → user and require `users.revoked_at IS NULL` as well; a missing user is a missing session, never the owner.
6. **S7's ageing SQL must respect `user_invitations_lifetime`**: move `created_at` and `expires_at` back by the same interval, rather than setting `created_at` far in the past alone.
7. **Invitation codes**: at least 16 random bytes, base64url, validated with `invitationCode`; a header failing the format is refused as `REGISTRATION_CLOSED`, identical to a code that matches nothing.

## Spec ambiguities resolved here
- **Contract path.** SPEC.md and the guardian role file name different contract directories; the contracts moved to `packages/contracts/` in P1-10a, so `packages/contracts/auth.ts` is the file amended. QUEUE.md's H8 records that the scope-guard hook still guards only the old `shared/contracts/` path.
- **Push rows with zero credentials:** deleted, not attributed and not a migration failure (Rationale above).
- **Rollback with a second user present:** SPEC.md's Rollback says the second user's passkey "survives the down migration". This down removes it instead, which makes the operator step SPEC.md asks for unconditional. #4 is unaffected, because every row it creates belongs to the owner.
- **"Not cascading away":** read as no `ON DELETE` action on every reference to `users`, with users rows never deleted. A user who has history cannot be deleted at all; removal is `revoked_at`.
- **Columns not pinned by SPEC.md** and added as the guardian's call: `users.revoked_at`, `users.created_at`, `user_invitations.code_hash` (SPEC.md says "code stored only as SHA-256 hex hash" without naming the column), and the constraints named above.
