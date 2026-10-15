# P7-41a-second-user — A second user, as a full peer
**Roadmap item:** ROADMAP.md §5 Phase 7 step 41a — a second user
**Status:** FROZEN@G0 (2026-10-14)
**Author:** spec-writer

## Goal
The app can tell two people apart. Every passkey credential belongs to a user, and every session of every kind (browser, device, personal) resolves, through its credential, to that user; every credential and session that exists before this change becomes the owner's, with no re-enrolment, and keeps authenticating. The owner, signed in with a full-scope browser session, can create a single-use, expiring invitation. Presenting that invitation at the registration ceremony, from an unauthenticated device, enrols a NEW passkey belonging to a NEW user (not the owner) and opens a session for that user. The first-passkey bootstrap path is unchanged and stays closed once any credential exists; it can never create a second user. Registering an additional passkey while signed in adds it to the SIGNED-IN user. Every authenticated request knows its user: the auth module exposes a `userId` on the resolved session, and a new `GET /api/v1/auth/me` returns the signed-in user's id, display name and owner flag. A personal token belongs to the user it was minted for (default: the owner), never to "the most recently enrolled passkey". Where an actor is recorded today (agent proposals: who proposed, who decided) the acting user is recorded as well. A web push subscription belongs to a user, and a push sent for a user reaches only that user's live subscriptions. The owner can remove the second user: the second user's sessions, personal tokens and passkeys stop working. The app shows who is signed in. Both users are full peers: no data is filtered by user.

## Non-goals
Each is enforced by the reviewer as a defect if present.
- **No data filtering by user, anywhere.** No query over accounts, transactions, budgets, categories, properties, rules, notes, the chat agent's tools, the digest, search or export gains a user predicate. The two users see and edit exactly the same ledger. A grep-gated control is acceptance #8.
- **No gifts.** Nothing from P7-41b: no gift table, no reveal dates, no redaction, no "Gift" rendering, no recipient concept, no per-surface hiding.
- **No audit table.** No `mutation_audit_log`, and no actor column on `transactions`, budgets, rules, categories or any ledger table. The only actor columns are on `agent_proposals`. Direct UI edits stay unattributed, as the agent-proposals migration documents.
- **No change to what a session may do.** No new scope or kind, no change to `kindAllowedFor`, `scopePermits`, `READ_SAFE_POSTS`, or the rule that a read-only or personal token cannot enrol a passkey.
- **No HTTP endpoint that mints personal tokens.** `scripts/tokens.ts` stays the only minting path. It gains only the ability to name the user.
- **No new pre-auth path.** `PRE_AUTH_PATHS` in `proxy.ts` keeps exactly its current twelve members. Redemption rides the two existing `register/*` endpoints.
- **No password, no shared passkey, no email invitation delivery, no invitation list/management UI, no roles beyond owner/non-owner.** The owner hands the invitation code over in person.
- **No change to `device_handoffs` behaviour**; it remains keyed by credential and resolves to a user through it. No change to the retired Expo `push_devices` table.
- **No change to the daily digest, alert recipients, mail, or any figure it contains.** Existing scheduled pushes (daily ping, overdraft watch) are addressed to the owner only. Widening that is a product decision, not this step.
- **The second user's real name appears nowhere** in any tracked file, test fixture, seed, comment or commit message. Fixtures use "second user" and fabricated names such as `Test User Two`. The owner's display name in the migration is the neutral string `Owner`.
- **No money figures** in any tracked file or commit message.
- **No edit to a committed migration.**

## Contracts touched
| File | Change | Class (§9.2) |
|---|---|---|
| `migrations/<new>_second-user.sql` | New table `users` (id, display_name 1–60 chars, `is_owner` boolean, created_at; at most one row with `is_owner` true, enforced by the database). New table `user_invitations` (code stored only as SHA-256 hex hash, created by user, display_name for the invitee, created_at, expires_at, consumed_at, consumed_by user). `webauthn_credentials.user_id NOT NULL` referencing users. `web_push_subscriptions.user_id NOT NULL` referencing users. `agent_proposals.proposed_by_user_id` and `decided_by_user_id`, nullable, referencing users, not cascading away. `enrolled_via` vocabulary gains a value for invited enrolments. Backfill creates the owner user only when credentials already exist and points every existing credential, subscription and attributable proposal at it. `down` removes exactly what `up` added and leaves all pre-existing rows intact. | additive, except the CHECK widening on `enrolled_via` (guardian classifies) |
| `db/schema.sql` | Reflects all of the above | additive |
| `packages/contracts/auth.ts` | Schemas for the `me` response, the invitation-create request/response, and the revoke response | additive |
| `packages/contracts/*` other | None | none |

Names pinned here because acceptance commands reference them: tables `users`, `user_invitations`; columns `users.id`, `users.display_name`, `users.is_owner`, `user_invitations.expires_at`, `user_invitations.created_at`, `user_invitations.consumed_at`, `webauthn_credentials.user_id`, `web_push_subscriptions.user_id`, `agent_proposals.proposed_by_user_id`, `agent_proposals.decided_by_user_id`. Everything else is the guardian's and implementer's call. The type of `users.id` is the guardian's call; tests treat it as opaque and compare with `String(...)`.

Pinned interface (observable, for literal tests):
- `ActiveSession.userId` (from `resolveSession`, `identify`/`credentialFrom`) is never null for a resolved session.
- `GET /api/v1/auth/me` → `{ success: true, data: { userId, displayName, isOwner } }`, behind the boundary, reachable by cookie and by a full or read personal token.
- `POST /api/v1/auth/invitations` body `{ displayName }`, response `data: { code, expiresAt }`; the code is shown exactly once.
- Invitation presented as request header `X-Invitation-Code` on BOTH `POST /api/v1/auth/register/options` and `POST /api/v1/auth/register/verify`.
- `POST /api/v1/auth/users/[id]/revoke`, response envelope, no body required.
- `sendWebPush(urgency, userId?)`: omitted `userId` means the owner.
- `createPersonalToken({ label, scope, days?, userId? })`: omitted `userId` means the owner. `npm run tokens -- create "<label>" [--user <id>]`.

## Conventions this task must honor
- **Sign:** No amount is read, written or compared. If an implementation touches an amount, that is a defect.
- **Rounding:** Not applicable.
- **Landscape + exclusions:** Not applicable; `landscape`, `hidden` and `exclude_from_budget` are untouched, and no financial query changes.
- **Null semantics (this task's worst trap):**
  - A resolved session's `userId` is never null and never defaults to the owner for want of an answer. A session whose credential has no user cannot exist (NOT NULL), and the lookup fails closed rather than guessing the owner.
  - `agent_proposals.proposed_by_user_id` is NULL for system-made proposals (those with `proposed_by IS NULL`, made by the category suggester). It is NOT the owner. `categorySuggester` keeps selecting on `proposed_by IS NULL` unchanged.
  - The backfill sets an acting-user column only from a session that still exists. A proposal whose session row is already gone keeps NULL. Nothing is attributed by guess.
  - Acting-user columns survive deletion or revocation of the session that wrote them.
  - "No user" is never rendered as the owner's name in the app: a failed `me` shows nothing, not "Owner".
- **Time:** invitation expiry and consumption are evaluated by Postgres `NOW()`, as for sessions. No JS clock decides.
- **Secrets:** an invitation code is stored only as a SHA-256 hash; the raw code appears in the create response and nowhere else, including logs.
- **Authority:** only a full-scope BROWSER session of the owner user may create invitations or revoke a user. A personal token (any scope), the second user's session, and no session are all refused.

## Toolchain prerequisites
| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `psql`, `createdb`/`dropdb` and a local Postgres reachable with CREATEDB | **yes** | local install | `psql -d postgres -tAc "select 1"` → `1` | filled at G0 |
| T2 | Two fresh empty throwaway DBs, neither `b8_finance` | **yes** | `createdb b8_p41a_throwaway && createdb b8_p41a_schema` (drop after) | `psql postgresql://localhost/b8_p41a_throwaway -tAc "select current_database()"` → `b8_p41a_throwaway` | filled at G0 |
| T3 | Exported `DATABASE_URL` wins over `apps/web/.env.local` in `npm run migrate:up`/`down` | **yes** | n/a | `DATABASE_URL=postgresql://nobody@127.0.0.1:1/b8_p41a_throwaway npm run migrate:up; echo "exit=$?"` → non-zero with a connection error to port 1 | filled at G0 |
| T4 | Integration scratch-DB guard refuses `b8_finance` before any pool exists | **yes** | existing `lib/testDbGuard.setup.ts` | `(cd apps/web && DATABASE_URL=postgresql://nobody@127.0.0.1:1/b8_finance npx vitest run --config vitest.integration.config.mts 2>&1 \| grep -c b8_finance)` → ≥1 | filled at G0 |
| T5 | Unit baseline (files and tests) recorded before the change | **yes** | existing | `npm test 2>&1 \| tail -8` → record `<files>`/`<tests>` as BASE | filled at G0 |
| T6 | `tsc` runs in `apps/web` | **yes** | existing | `(cd apps/web && npx tsc --noEmit; echo "exit=$?")` → `exit=0` | filled at G0 |
| T7 | `tsx` available for one-off scripts | **yes** | `apps/web` devDependency | `(cd apps/web && npx tsx -e "console.log('ok')")` → `ok` | filled at G0 |
| T8 | Live Plaid, live push services, network | **NO** | n/a | n/a. Push tests stub global `fetch`; VAPID keys are generated in-process. | n/a |
| T9 | The dev DB `b8_finance`, `.env.local`, docker-compose `db` | **NO** | n/a | n/a | n/a |

Prerequisites the implementer must create (none exist today). Every scenario title begins with its id exactly as listed (`T41a-S1:` …), so command #6 finds each by structure. Files live under `app/api/v1/**` or are `proxy.test.ts`, which are the only paths the integration config collects. Tests seed what they assert on, truncate their own users/invitations/subscriptions, pass alone and in any order after the existing suites, and use only fabricated data. Existing integration fixtures that insert credentials directly (`bearer.test.ts`, `proxy.test.ts`, the auth route tests, the decide test) must be updated to supply a user; their assertions may not be weakened or removed.
- `apps/web/app/api/v1/auth/principal.test.ts` (S1, S2, S9–S12, S15)
- `apps/web/app/api/v1/auth/invitations/route.test.ts` (S3–S8)
- `apps/web/app/api/v1/auth/users/revoke.test.ts` (S16)
- `apps/web/app/api/v1/push/web/route.test.ts` (S13)
- additions to `apps/web/app/api/v1/agent/proposals/[id]/decide/route.test.ts` (S14) and `apps/web/proxy.test.ts` (S17)
- a pure unit test in `apps/web/lib/registrationGate.test.ts` for the registration decision's new input (invitation present or absent, session present or absent, credentials zero or more). Raises the unit count.
- For S13: VAPID env vars set in-process from a freshly generated P-256 PKCS8 key, `fetch` stubbed to record target URLs and return 201. Endpoints use `https://push.example.invalid/...`.

## Scenarios
| Id | Observable rule | Fixture and assertion |
|---|---|---|
| S1 | Bootstrap creates the owner and only the owner. | Zero credentials, unauthenticated ceremony succeeds: exactly one `users` row with `is_owner` true; the credential's user is that row; the returned session resolves with that `userId`; `me` says `isOwner: true`. Inserting a second `is_owner` row directly is rejected by Postgres. |
| S2 | **Gate stays closed.** With any credential present, an unauthenticated registration without a valid invitation is refused on both `register/options` and `register/verify`. | No cookie, no header: 403 `REGISTRATION_CLOSED`. Same with a garbage `X-Invitation-Code`, with a code of a consumed invitation, and with an expired one. After each: counts of `users`, `webauthn_credentials` and `auth_sessions` unchanged; no `bootstrap` row added. |
| S3 | Owner creates an invitation. | Owner browser session, `displayName` `Test User Two`: 200, `code` present, `expiresAt` after now and at most 7 days away. `user_invitations` has one row; no column of it equals the raw code or contains it as a substring; the stored hash equals SHA-256 of the code. |
| S4 | Creation authority. | Each of these is refused with 401 or 403 and inserts zero rows: no session; a read-scope personal token; a full-scope personal token; the second user's browser session. Also a `displayName` that is empty or longer than 60 characters → 400, zero rows. |
| S5 | Redemption enrols a NEW user. | Unauthenticated ceremony with the code: new `users` row (`is_owner` false, display name from the invitation); the new credential's `user_id` is that row and NOT the owner; `enrolled_via` is not `bootstrap`; response sets a session cookie resolving to the new user; invitation `consumed_at` set; the owner's user and credential rows unchanged; `bootstrap` credential count still exactly 1. |
| S6 | **Single use.** | Second redemption of the same code with a different authenticator: refused; no new user or credential. Two concurrent redemptions (`Promise.all`, two authenticators): exactly one succeeds, exactly one new user exists. |
| S7 | **Expiry.** | Create an invitation, then move its `created_at` and `expires_at` into the past by direct SQL. Redemption refused at `register/options` and at `register/verify`; no user created. A sibling invitation not aged redeems fine. |
| S8 | A failed attempt does not burn the invitation. | (a) ceremony with a wrong challenge → refused, invitation still unconsumed, later valid redemption succeeds. (b) enrolling an authenticator already enrolled (409) leaves the invitation unconsumed and creates no user. |
| S9 | Session and code together are refused. | A request carrying both the owner's session and a valid code: refused, invitation unconsumed, no user or credential created. |
| S10 | Additional passkey while signed in goes to the signed-in user. | Signed in as the second user, register a new authenticator: its `user_id` is the second user's. Signed in as the owner: owner's. Neither moves a credential across users. No new `users` row in either case. |
| S11 | Login resolves the right user. | Assertion by the second user's authenticator → session `userId` is the second user's; by the owner's → the owner's. |
| S12 | **Personal token ownership.** | After the second user's passkey exists (it is the newest credential), `createPersonalToken` with no `userId` yields a token whose `resolveSession` `userId` is the OWNER. With `userId` of the second user it resolves to the second user. `GET me` with that bearer returns the matching user. |
| S13 | **Push isolation.** | Owner and second user each register a distinct endpoint through `POST /api/v1/push/web` under their own session. `sendWebPush('normal', secondUserId)` → recorded fetch targets are exactly the second user's endpoint(s) and none of the owner's. `sendWebPush('normal')` → exactly the owner's. A revoked subscription is never targeted. The second user's session re-registering the OWNER's endpoint moves it: afterwards the owner's send does not target it and the second user's does, and the row has one user. `push/web/status` for an endpoint belonging to the other user reports not registered. |
| S14 | Acting user on proposals. | Decide a proposal (confirm, and separately reject) under the second user's session: `decided_by_user_id` is the second user's; under the owner's, the owner's. A proposal inserted with `proposed_by IS NULL` has `proposed_by_user_id` NULL. After the deciding session's row is deleted, `decided_by_user_id` is unchanged. |
| S15 | `me`. | Cookie of each user returns that user's `userId`, `displayName`, `isOwner`. No credential → refused, no body data. |
| S16 | **Removal.** | Owner revokes the second user (who holds a browser session, a personal token and a push subscription): afterwards `resolveSession` returns null for both, the second user's authenticator's login assertion is refused, the push send for the second user reaches nothing, the `users` row still exists, and `decided_by_user_id` rows referencing the second user remain. The owner's session, credential and subscription are untouched. Refused with nothing changed: the second user calling revoke (403), the owner revoking the owner (4xx), an unknown id (404). |
| S17 | Boundary. | `PRE_AUTH_PATHS` equals exactly its current twelve members. `proxy()` with no cookie on `/api/v1/auth/invitations`, `/api/v1/auth/me` and the revoke path refuses (401). |

## Acceptance commands
All run from the repo root. `U=postgresql://localhost/b8_p41a_throwaway`, `S=postgresql://localhost/b8_p41a_schema`, both freshly created and empty (T2).

| # | Command | Expected |
|---|---|---|
| 1 | `(cd apps/web && npx tsc --noEmit)` | exit 0 |
| 2 | `npm run lint` | exit 0 |
| 3 | `npm test 2>&1 \| tail -8` | 0 failed; tests passed strictly greater than T5's BASE tests, files ≥ BASE files. No existing unit test removed or weakened. |
| 4 | Legacy upgrade round trip, below | the listed lines, exit 0 |
| 5 | Schema parity, below | both diffs empty with non-empty listings |
| 6 | Scenario run, below | `OK <n> tests, S1-S17 each present once and passed` |
| 7 | the integration config run twice in a row | identical pass counts, no failures beyond KNOWN |
| 8 | Peer-ness grep, below | no output |
| 9 | `grep -c "auth/me" apps/web/components/Sidebar.tsx` | ≥ 1 (weak wiring pin; real evidence is the screenshot item) |

**#4 (legacy credentials and sessions keep working, and down is clean).**
```
set -e; export DATABASE_URL=postgresql://localhost/b8_p41a_throwaway; U=$DATABASE_URL
h() { printf %s "$1" | shasum -a 256 | cut -d' ' -f1; }
npm run migrate:up >/dev/null; npm run migrate:down >/dev/null
psql "$U" -tAc "select to_regclass('public.users')::text is null" | grep -qx t
psql -v ON_ERROR_STOP=1 "$U" -q <<SQL
INSERT INTO webauthn_credentials (credential_id, public_key, sign_count, enrolled_via) VALUES ('legacycred1', '\x01', 0, 'bootstrap');
INSERT INTO auth_sessions (token_hash, credential_id, kind, expires_at) VALUES ('$(h legacy-browser)', 'legacycred1', 'browser', now() + interval '12 hours'), ('$(h legacy-device)', 'legacycred1', 'device', now() + interval '12 hours');
INSERT INTO auth_sessions (token_hash, credential_id, kind, scope, label, expires_at) VALUES ('$(h legacy-personal)', 'legacycred1', 'personal', 'full', 'legacy script', now() + interval '30 days');
INSERT INTO web_push_subscriptions (endpoint) VALUES ('https://push.example.invalid/legacy');
INSERT INTO agent_proposals (id, kind, subject_id, proposed, observed, expires_at, decided_at, decision, proposed_by, decided_by) VALUES ('legacyproposaldecided01', 'categorize_transaction', 1, '{}', '{}', now() + interval '1 day', now(), 'rejected', NULL, '$(h legacy-browser)');
INSERT INTO agent_proposals (id, kind, subject_id, proposed, observed, expires_at) VALUES ('legacyproposalsystem001', 'categorize_transaction', 2, '{}', '{}', now() + interval '1 day');
SQL
npm run migrate:up >/dev/null
O=$(psql "$U" -tAc "select id from users where is_owner"); test -n "$O"
psql "$U" -tAc "select count(*) from users"                                  # 1
psql "$U" -tAc "select count(*) from webauthn_credentials where user_id::text='$O'"       # 1
psql "$U" -tAc "select count(*) from web_push_subscriptions where user_id::text='$O'"     # 1
psql "$U" -tAc "select coalesce(decided_by_user_id::text,'null')||' '||coalesce(proposed_by_user_id::text,'null') from agent_proposals where id='legacyproposaldecided01'"   # "<O> null"
psql "$U" -tAc "select coalesce(proposed_by_user_id::text,'null')||' '||coalesce(decided_by_user_id::text,'null') from agent_proposals where id='legacyproposalsystem001'"   # "null null"
(cd apps/web && OWNER_ID="$O" npx tsx -e "(async()=>{const {resolveSession}=await import('./lib/authSession');const {default:db}=await import('./lib/db');let ok=0;for(const t of ['legacy-browser','legacy-device','legacy-personal']){const s=await resolveSession(t);if(s&&String(s.userId)===process.env.OWNER_ID)ok++;}const gone=await resolveSession('never-issued');await db.end();console.log('resolved-as-owner',ok,'unknown',gone===null?'null':'LEAK');})()")
npm run migrate:down >/dev/null
psql "$U" -tAc "select (select count(*) from webauthn_credentials)||' '||(select count(*) from auth_sessions)||' '||(select count(*) from web_push_subscriptions)||' '||(select count(*) from agent_proposals)"   # 1 3 1 2
psql "$U" -tAc "select coalesce(to_regclass('public.users')::text,'gone')||' '||coalesce(to_regclass('public.user_invitations')::text,'gone')"   # gone gone
npm run migrate:up >/dev/null
psql "$U" -tAc "select count(*) from webauthn_credentials where user_id::text=(select id::text from users where is_owner)"   # 1
```
Expected outputs, in order: `t` check passes silently; `1`; `1`; `1`; `<O> null`; `null null`; `resolved-as-owner 3 unknown null`; `1 3 1 2`; `gone gone`; `1`. A stub that changes nothing fails (no `users` table); a migration that hands the system proposal to the owner fails (`null null`); a `down` that drops pre-existing rows fails (`1 3 1 2`).

**#5 (schema.sql parity).** Apply `db/schema.sql` to `$S` with `psql -v ON_ERROR_STOP=1 -q "$S" -f db/schema.sql`. For each of the tables `users`, `user_invitations`, `webauthn_credentials`, `web_push_subscriptions`, `agent_proposals`, write `select column_name||' '||data_type||' '||is_nullable from information_schema.columns where table_name='<t>' order by column_name` from `$U` and from `$S` to files, assert the `$U` file is non-empty, and `diff` them; repeat with `select contype::text||' '||pg_get_constraintdef(oid) from pg_constraint where conrelid='<t>'::regclass order by 1`. Then `psql "$U" -tAc "select count(*) from pg_indexes where tablename='users' and indexdef ilike '%is_owner%'"` → `≥ 1`. Expected: every diff empty. Run with `$U` left migrated up by #4.

**#6 (scenario run, whole integration config).**
```
set -e; O="$(mktemp)"; (cd apps/web && DATABASE_URL=postgresql://localhost/b8_p41a_throwaway npx vitest run --config vitest.integration.config.mts --reporter=json --outputFile="$O") || true
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);let bad=[];for(let n=1;n<=17;n++){const m=t.filter(x=>x.title.startsWith("T41a-S"+n+":"));if(m.length!==1||m[0].status!=="passed")bad.push("S"+n+"="+m.map(x=>x.status).join("/")+"("+m.length+")")}const KNOWN=["the pre-auth ceremony endpoints remain reachable with no session cookie at all","the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio"];const unexpected=t.filter(x=>x.status==="failed"&&!KNOWN.includes(x.title)).map(x=>x.title);if(unexpected.length||bad.length){console.log("FAIL",unexpected.join(" ; "),bad.join(","));process.exit(1)}console.log("OK",t.length,"tests, S1-S17 each present once and passed")' "$O"
```
Expected `OK <n> tests, S1-S17 each present once and passed`, exit 0. KNOWN is the two stale tests of QUEUE hold H4; any other failure fails the gate. A missing, skipped or duplicated scenario fails.

**#7.** `(cd apps/web && DATABASE_URL=postgresql://localhost/b8_p41a_throwaway npx vitest run --config vitest.integration.config.mts 2>&1 | tail -6)` twice in a row: same pass count both times, no failures beyond the two KNOWN.

**#8 (peer-ness, non-goal gate).** `grep -rEl "user_id|userId|users\b" apps/web/app/api/v1 --include=route.ts | grep -Ev "/(auth|push|agent)/|/chat/route.ts"` and `grep -rEl "user_id|userId" apps/web/lib | grep -Ev "authSession|requestAuth|registrationGate|webPush|proposalStore|invitation|user"`. Expected: no output from either. This guards the non-goal only; a stub passes it, so it is never the feature's evidence.

Mutation expectations (G2/G3 may apply one at a time; exactly the named scenarios must fail):
- Make the bootstrap gate accept any request with a code-shaped header regardless of validity: S2 fails.
- Leave `consumed_at` unset on success: S6 fails. Consume before the ceremony verifies: S8 fails.
- Ignore `expires_at`: S7 fails.
- Attach redeemed credentials to the owner: S5 fails.
- Attach a signed-in additional passkey to the owner by default: S10 fails.
- Pick the newest credential's user for `createPersonalToken`: S12 fails.
- `sendWebPush` ignoring `userId`: S13 fails. Backfill `proposed_by_user_id` for system proposals: S14 and #4 fail.
- Allow a personal token to create invitations: S4 fails.
- Revoke touches only sessions, not credentials: S16 fails.

## Negative controls
| # | Rule | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | Bootstrap gate stays closed once any credential exists | Unauthenticated register with no code / garbage code / consumed code / expired code | #6 (S2, S6, S7) |
| 2 | Bootstrap can never mint a second user | A second `is_owner` user; an invited enrolment tagged `bootstrap` | #6 (S1, S5) |
| 3 | An invitation is single-use | Second and concurrent redemption of the same code | #6 (S6) |
| 4 | An invitation expires | Code past `expires_at` | #6 (S7) |
| 5 | Only the owner's full browser session can invite | No session; read and full personal tokens; second user's session | #6 (S4) |
| 6 | The raw code is never stored | Any `user_invitations` column containing the raw code | #6 (S3) |
| 7 | A failed ceremony does not consume the code | Wrong challenge; already-enrolled authenticator | #6 (S8) |
| 8 | A session plus a code is ambiguous and refused | Both presented together | #6 (S9) |
| 9 | Additional passkey goes to the signed-in user, not the owner | Second user's session registering a device | #6 (S10) |
| 10 | A personal token does not belong to the newest passkey | Mint after the second user enrols, no user named | #6 (S12) |
| 11 | A push for one user never reaches the other's endpoints | Owner endpoint when sending for the second user, and the reverse; revoked subscription; re-registered endpoint | #6 (S13) |
| 12 | System-made proposals are not attributed to a person | `proposed_by IS NULL` proposal | #4, #6 (S14) |
| 13 | The owner is not removable and only the owner can remove | Owner revoking owner; second user revoking | #6 (S16) |
| 14 | No data filtering by user | A user predicate in any data route or lib | #8 |
| 15 | No new pre-auth path | `PRE_AUTH_PATHS` growth; unauthenticated `/auth/invitations`, `/auth/me`, revoke | #6 (S17) |
| 16 | Legacy sessions of every kind keep working as the owner | Browser, device and personal rows created before the migration | #4 |

## Evidence required
- Output of #4 verbatim (every line, including `resolved-as-owner 3 unknown null`), #5 and #6's final `OK` line.
- A mutation log: for each mutation above, the scenarios that failed, then green after revert.
- One screenshot of the app chrome (via `npm run screenshots -w @b8/web` against a scratch demo DB) showing the signed-in user's display name for the owner and for a fabricated second user. No real name in it.
- The fixtures of S2, S5, S6 and S13 transcribed into EVIDENCE.md with fabricated ids only.
- Plain statement in EVIDENCE.md that scheduled pushes still go only to the owner, and that the digest/overdraft recipients are unchanged.

## Failure modes to test
- Backfill misses a class of row: `device` or `personal` sessions, `device_handoffs`, or credentials created `authenticated`, leaving a NOT NULL violation or an orphan. Fresh DB (zero credentials) must also migrate cleanly with no owner row, and the first bootstrap must then create it.
- `down` drops pre-existing rows or fails when new users exist.
- The bootstrap gate becomes "credential count per user", or invitation redemption reuses the `bootstrap` tag and trips or bypasses `webauthn_credentials_one_bootstrap`.
- Count-then-insert race: two concurrent redemptions both create a user.
- The code is checked before the ceremony but consumed after in a separate step, so a crash leaves a user without a consumed code, or a consumed code without a user. Enrolment, user creation and consumption must be one atomic outcome.
- The invitation is consumed on a failed ceremony; or not consumed on success.
- The code is compared in JS rather than by hash lookup in SQL, or expiry uses the JS clock.
- A header present on `register/options` but not re-checked on `register/verify` (or vice versa): options says yes, verify enrols a stranger.
- `register/options` leaks the existing credential list to a code holder (`excludeCredentials` is a list of credentials; it must not enumerate the other user's credentials to an invitee).
- `sessionMayEnrol` regression: a personal token or read scope can now invite or enrol.
- `createPersonalToken` still orders by `created_at DESC LIMIT 1`.
- `userId` defaults to the owner when the lookup finds nothing. It must fail closed.
- Revoking a user leaves that user's personal tokens or push subscriptions live, or deletes the `users` row so acting-user history is lost or nulled.
- Push: the send query lacks the user predicate; `ON CONFLICT (endpoint)` re-registration keeps the old user; `subscriptionStatus` leaks another user's registration; a dead (410) subscription for one user revokes another's.
- `sendWebPush` with `userId` undefined sends to everyone (the pre-change behaviour) instead of the owner only.
- Proposal backfill attributes system-made proposals, or proposals whose session is gone, to the owner. The categorySuggester selects on `proposed_by IS NULL`; a rewrite onto the user column changes which suggestions show.
- Existing integration fixtures were "fixed" by weakening assertions.
- `db/schema.sql` omits a table, a column or the one-owner constraint (#5).
- Any real name, or any money figure, in a tracked file.
- A user predicate sneaks into a data query (#8).
- `Sidebar` renders "Owner" when `me` fails, instead of nothing.

## Rollback
Run `npm run migrate:down` against the target database; the down migration removes `users`, `user_invitations`, the added columns and the CHECK widening, and leaves every credential, session, subscription and proposal row intact (#4 proves it). Then revert the commit (auth lib, routes, push, tokens script, Sidebar, contracts, `db/schema.sql`, tests). Any second user, invitation and acting-user attribution recorded since is lost on `down`. Revoke the second user (or delete their credentials) BEFORE running `down`: otherwise their passkey survives the down migration and, on the old single-principal code, would sign in as the owner.
