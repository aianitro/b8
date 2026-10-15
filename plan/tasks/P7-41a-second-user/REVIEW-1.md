# REVIEW-1 — P7-41a-second-user
**Verdict:** ACCEPT_WITH_NITS
**Reviewer:** adversarial-reviewer (read-only; persisted by the orchestrator. The review was interrupted once by a usage limit and resumed with its context intact. The tree did not change in between.)

## Falsification log
| # | Hypothesis | Method | Result |
|---|---|---|---|
| 1 | The S1–S17 tests pass vacuously: mock assertions, swallowed errors, self-seeded rows. | Read all six scenario files and `secondUserTestKit.ts`. Users, credentials and sessions are made through the real route handlers (`bootstrapOwner`, `invite`, `enrolSecondUser` call the real options/verify/invitations routes). Assertions read DB rows (`authCounts`, `credentialUser`, `invitationRow`, `snapshot()`). Push uses real VAPID signing (`installFabricatedVapid`) with only `fetch` stubbed. S2's verify step uses `fabricateChallenge()` and asserts 403 `REGISTRATION_CLOSED`; an open gate would answer 400 `CEREMONY_FAILED`, so the test pins the gate's order. | REFUTED |
| 1b | S6's concurrent half is not really concurrent, so a version without `FOR UPDATE` passes. | `Promise.all` over two `verifyRegistration` calls that await several DB round trips before `db.connect()`, so they plausibly interleave. The mutation log has no "drop `FOR UPDATE`" entry, and reading cannot prove overlap. | INCONCLUSIVE (I1) |
| 2a | `register/options` lists the owner's credential ids to an invitee (`excludeCredentials`). | `register/options/route.ts:46-52`: invitation path `enrolled = []`; authenticated path `listCredentials({ userId: session.userId })`, filtered in SQL (`authSession.ts:165`). S10 asserts the list holds only the user's own ids. | REFUTED |
| 2b | Responses or timing tell an unknown code from an expired or consumed one. | `liveInvitationHash` (`invitations.ts:90-99`) is one primary-key SELECT with both liveness conjuncts; every dead code gets the same `registrationClosed()` 403. Malformed codes skip the query (a timing difference revealing only the format, which the public contract states). On verify, gate and liveness run before the body is parsed. | REFUTED |
| 2c | Verify can redeem a code different from the one presented at options. | The registration challenge store is not bound to an invitation. Options with live code A, then verify with live code B, enrols under B, while the authenticator holds A's handle and name. Needs two live codes, so no authority gain. | CONFIRMED (NIT N2) |
| 2d | A code checked on options is not re-checked on verify. | `register/verify/route.ts:48-51` re-runs `liveInvitationHash`; `enrolCredential` (`authSession.ts:278-287`) re-checks under `FOR UPDATE`. S7 ages the code between options and verify: 403. | REFUTED |
| 3 | Redemption is not atomic, or single use is count-then-insert. | `enrolCredential`, one client: BEGIN, `SELECT … FOR UPDATE` with both liveness conjuncts, INSERT user, INSERT credential, UPDATE invitation, INSERT session, COMMIT; any throw rolls back. Under READ COMMITTED a blocked second redeemer re-evaluates the WHERE and gets zero rows. Backstops: `consumed_by UNIQUE` (mapped to `REGISTRATION_CLOSED`), `consumed_together`. S8(b) proves a 409 rolls back the user INSERT. | REFUTED |
| 4a | After revoke, some path still authenticates the second user. | `resolveSession` is the only reader of `auth_sessions` (`authSession.ts:74`); identify, proxy, bearer and handlers go through it, and it requires `u.revoked_at IS NULL`. `revokeUser` in one transaction sets `revoked_at`, deletes credentials (cascading sessions and handoffs) and revokes subscriptions. `createPersonalToken` and `findUser` filter revoked users. S16 covers cookie, personal token, login assertion, push and history. | REFUTED |
| 4b | A registration in flight survives revoke. | If the owner's revoke commits between the second user's `sessionFrom` and `enrolCredential`, the authenticated branch inserts a credential for the revoked user (no `revoked_at` check there). Every session from it fails `resolveSession`, so nobody signs in, but `login/verify` answers 200 with a dead cookie. | CONFIRMED, not exploitable (NIT N3) |
| 5a | A missing user falls back to the owner. | No default in `resolveSession`. `sendWebPush`/`createPersonalToken` default to the owner only on `undefined`, resolved in SQL by `is_owner`; with no owner nothing matches. Only the two scheduled pushes omit `userId`. `tokens.ts:51` refuses a malformed `--user`. An unknown explicit id makes `createPersonalToken` throw (S12). | REFUTED |
| 5b | The sidebar shows "Owner" or a stale name when `me` fails. | `Sidebar.tsx:73-90`: every failure branch sets `me` to `null` and renders nothing. Sign-in is a hard navigation (`login/page.tsx:85`), which remounts. `import type { Me }` is type-only. | REFUTED |
| 6 | A user predicate reaches a data query outside #8's scope. | Grepped `apps/web` for `\buser_id\b\|\.userId\b`, `(FROM\|JOIN) users\b`, `is_owner`: every hit is auth, push, proposal-actor, chat-actor or test code. `categorySuggester` still selects on `proposed_by IS NULL`. | REFUTED |
| 7 | The new sidebar line fails the brand contrast floor. | `cyan-100` at 80% over `#0e7490` blends to about `#a8dfe8`, roughly 3.7:1 against the 4.5:1 floor (unblended `cyan-100` computes 4.78:1, matching the skill). The text is 12px. The white name passes at 5.36:1. The existing "Finance" mark (`Sidebar.tsx:174`) has the same ink, and its comment claims 4.5:1. | CONFIRMED (NIT N1) |
| 8 | A real name or money figure is in a touched tracked file. | G2 name grep: 0 files. `$`-digit grep found only SQL placeholders and a dollar figure in a comment at `apps/web/lib/proposalStore.ts:84`, whose age cannot be told without git. | INCONCLUSIVE (I2) |
| 9 | Backfill attributes system or orphaned proposals, or down loses rows. | Migration lines 200-210 attribute only through an existing session joined to its credential; down deletes only non-owner credentials and subscriptions. #4 (`null null`, `1 3 1 2`) run by the orchestrator. | REFUTED |
| 10 | Amendment A1 changes what #4 proves. | Only the `db` binding changes; assertions byte-identical; still fails on the old tree. | REFUTED |
| 11 | Amendment A2 hides a regression from this diff. | RC-03 touches no auth/user/push/proposal table, fails on its own row-order harness, and flaked on HEAD without this diff. The exemption names one test. | REFUTED |
| 12 | Amendment A3 weakens #8. | `\buser_id\b` no longer matches compound names (`created_by_user_id`), so it is weaker in general. On this tree the original wider pattern returns only the HEAD-era `client_user_id`, so the outcome is the same. | REFUTED for this tree; NIT N4 |
| 13 | S14 cannot catch the "backfill system proposals" mutation (the backfill is in the frozen migration). | The mutation was applied in `createProposal` instead; the migration side is covered by #4's `null null`. | REFUTED (covered by #4) |
| 14 | Fixtures were weakened, or `TRUNCATE … users CASCADE` breaks isolation. | Cascade empties `agent_proposals`, `user_invitations`, `web_push_subscriptions`; the integration config sets `fileParallelism: false`, and the decide suite re-seeds. `PRE_AUTH_PATHS.size === 12` intact; S17 adds an exact member list. Pre-existing assertions could not be diffed without git. | REFUTED for isolation; weakening INCONCLUSIVE (I3) |
| 15 | A read-scope token plus a code gets around S9. | `credentialFrom` nulls a read token on POST, so the gate sees no session and admits the invitation door; a full token plus a code is refused. No authority gain (the code alone redeems, and the new user is not the token's). | CONFIRMED, harmless (part of N2) |
| 16 | Invite or revoke reachable by a token, a non-owner, or no session. | `ownerSessionFrom`: 401 for no session or read token; 403 `OWNER_ONLY` unless owner + `browser` + `full`. S4 and S16 cover it; revoking the owner is 400 and refused by a DB CHECK. | REFUTED |
| 17 | Push isolation leaks on re-registration, status, or 410 handling. | `registerSubscription` sets `user_id = EXCLUDED.user_id`; `subscriptionStatus` filters by user; the 410 update is keyed by the unique endpoint. All asserted in S13. | REFUTED |

## Findings
### [NIT N1] `apps/web/components/Sidebar.tsx:99` — "Signed in as" label at about 3.7:1 against a 4.5:1 floor
`text-xs text-cyan-100/80` on `bg-cyan-700`. The name inside is white and passes. The existing "Finance" mark at line 174 has the same defect. Fix: `text-cyan-100` with no alpha, on both lines. A brand rule, not a SPEC acceptance item.

### [NIT N2] `apps/web/app/api/v1/auth/register/verify/route.ts:48` — invitation not bound to the options challenge; read token plus code treated as no session
Options with live code A, verify with live code B: user created from B, B consumed, authenticator holds A's handle and name. Read-scope bearer plus a code redeems while a full-scope bearer plus a code is refused. No authority gain in either.

### [NIT N3] `apps/web/lib/authSession.ts:271` — authenticated enrolment does not re-check `users.revoked_at`
A revoke committing mid-ceremony leaves a credential row for the removed user. Login with it returns 200 and a cookie that never resolves.

### [NIT N4] GATES.md amendment A3 — word-bounded #8 misses compound `*_user_id` names
A future `WHERE x.created_by_user_id = $1` in a data route would pass. Prefer excluding `client_user_id` explicitly.

## Scope violations
- `apps/web/scripts/screenshots.mjs`, `evals/golden/README.md`, `apps/web/lib/webauthnOrigins.ts` (comment only), `apps/web/app/api/v1/chat/route.ts`: accepted at G2 as forced by the frozen constraints. Reviewer agrees.
- `apps/web/app/api/v1/auth/secondUserTestKit.ts`: a test helper under `app/`; Next routes only `route.ts`/`page.tsx`, and no shipping module imports it.

## Inconclusive — requires execution
- **I1** — remove `FOR UPDATE` at `apps/web/lib/authSession.ts:281`, run `T41a-S6` five times; expected to fail at least once. If it passes all five, S6's concurrent half is vacuous (BLOCK on S6).
- **I2** — `git diff HEAD -- apps/web/lib/proposalStore.ts | grep -n '^\+.*\$[0-9]'`; expected no output.
- **I3** — `git diff HEAD --` the five pre-existing fixture files `| grep -E '^-\s*(expect|it\()'`; every removed line must have an at-least-as-strict added counterpart.

## Amendment rulings
- **A1** keeps intent. **A2** keeps intent. **A3** keeps the result on this tree but is weaker in general (N4).
