# P7-41a-second-user — evidence bundle (implementer)

Every command below was run by the implementer on 2026-10-14, from the repo root unless stated,
against the scratch databases `b8_p41a_throwaway` (`$U`) and `b8_p41a_schema` (`$S`) only. Neither
`b8_finance` nor `apps/web/.env.local`'s URL was touched. Outputs are verbatim. #4, #5 and #6 were run
with `bash` from script files holding the spec's text exactly. The one deviation is labelled under #4.

The frozen contract files are byte-identical to G1's digests, measured after the last edit:

```
26f7d2d4b1b5af19e809fb54428764c3f8ecab4a4948885ae21fb327f940e899  migrations/1792300000000_second-user.sql
91351bf833c078cf830d9472f65ba35c975f1796297f9bd0458b0f09208f8151  db/schema.sql
000fa73d7c95cdfc75ab8dbe781aff80687e9a69867df2d6ba29443716338a05  packages/contracts/auth.ts
```

## Summary

| # | Result |
|---|---|
| 1 | PASS — exit 0 |
| 2 | PASS — exit 0, 0 errors; the 5 warnings are all in files this diff does not touch |
| 3 | PASS — 83 files (BASE 82), 1190 tests (BASE 1182), 0 failed; no existing unit test removed or weakened |
| 4 | **FAIL as written**, because of a defect in the command's `tsx` line (below), not in the feature. With only that expression corrected, every expected line appears and the exit code is 0. |
| 5 | PASS — every diff empty, every `$U` listing non-empty, index count `1` |
| 6 | PASS — `OK 189 tests, S1-S17 each present once and passed`, exit 0 |
| 7 | First pair **FAILED** (186 vs 187 passed) because of the flaky RC-03 test, which also flakes without this diff (measured below). Second pair PASS: 187 and 187, only the two KNOWN failures. |
| 8 | **Not empty as written**: one line, `apps/web/app/api/v1/plaid/create-link-token/route.ts`. That file is not in this diff; it matches only because of Plaid's `client_user_id`. The `lib` half of the grep has no output. |
| 9 | PASS — `2` |

## #1 — `(cd apps/web && npx tsc --noEmit)`

```
exit=0
```

## #2 — `npm run lint`

```
> b8@0.1.0 lint
> eslint

Pages directory cannot be found at /Users/andreianpilogov/Documents/b8/app/pages or /Users/andreianpilogov/Documents/b8/app/src/pages. If using a custom path, please configure with the `no-html-link-for-pages` rule in your eslint config file.

/Users/andreianpilogov/Documents/b8/app/apps/web/app/login/page.tsx
  85:7  warning  Do not use `window.location.assign()` to navigate to internal Next.js pages. Use `redirect()` in the render phase, or `useRouter().push()` in Client Components' event handlers instead. See: https://nextjs.org/docs/messages/no-location-assign-relative-destination  @next/next/no-location-assign-relative-destination

/Users/andreianpilogov/Documents/b8/app/apps/web/lib/domain/digest.ts
  202:7  warning  'GREEN_SOFT' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  204:7  warning  'RED_SOFT' is assigned a value but never used. Allowed unused vars must match /^_/u    @typescript-eslint/no-unused-vars

/Users/andreianpilogov/Documents/b8/app/apps/web/public/sw.js
  1:1  warning  Unused eslint-disable directive (no problems were reported from 'no-restricted-globals')

/Users/andreianpilogov/Documents/b8/app/apps/web/scripts/seed-demo.mjs
  457:17  warning  'pid' is assigned a value but never used. Allowed unused elements of array destructuring must match /^_/u  @typescript-eslint/no-unused-vars

✖ 5 problems (0 errors, 5 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

exit=0
```

## #3 — `npm test 2>&1 | tail -8`

```
 Test Files  83 passed (83)
      Tests  1190 passed (1190)
   Start at  20:06:38
   Duration  5.90s (tests 57%, import 22%, transform 18%, worker 3%)

    Isolate  83 workers spawned · ~148ms startup each (spawn + environment, per file)
             at least ~1.61s faster with isolate: false — reuses workers across files instead of one per file
```

The new unit tests are `lib/userAuthority.test.ts` (one new file, 4 tests) and four blocks added to
`lib/registrationGate.test.ts` (the invitation input). Every existing block in that file is unchanged.

## #4 — legacy upgrade round trip

### As written (fresh `$U`), verbatim

```
1
1
1
1 null
null null
[eval]:32
  await db.end();
           ^

TypeError: db.end is not a function
    at [eval]:32:12
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)

Node.js v26.3.1
exit=1
```

**Why it fails, and why the feature is not the cause.** `npx tsx -e` evaluates the snippet as
CommonJS. `lib/db.ts` has a default export only, so `await import('./lib/db')` returns
`{ default: { default: db } }`. The spec's `const {default:db}=…` therefore binds the module
namespace, which has no `end`. `lib/authSession` has named exports, so its import works. The three
`resolveSession` calls ran before the throw, but the line that prints their result comes after
`db.end()`, so it never prints. G1 skipped exactly this line ("it exercises implementer code"), so
it had never been run. Fixing it would mean changing `lib/db.ts`'s export shape, which is outside
this task's surface. I did not do that. The orchestrator should amend the command.

### With only that expression corrected (fresh `$U`), verbatim

The one change, as `diff a4.sh a4b.sh` printed it:

```
< …const {default:db}=await import('./lib/db');…
> …const dm=await import('./lib/db');const db=dm.default.default??dm.default;…
```

```
1
1
1
1 null
null null
resolved-as-owner 3 unknown null
1 3 1 2
gone gone
1
exit=0
```

Every expected line, in order: `1`, `1`, `1`, `<O> null` (the owner's id is `1` on a fresh
database), `null null`, `resolved-as-owner 3 unknown null`, `1 3 1 2`, `gone gone`, `1`.

## #5 — schema.sql parity (run with `$U` left migrated up by #4)

The script applies `db/schema.sql` to `$S`, then for each table writes the spec's column query and
constraint query from both databases to files. It asserts the `$U` files are non-empty (`test -s`),
diffs each pair under `set -e`, and prints a line only when both diffs were empty:

```
users: columns 5, constraints 3, both diffs empty
user_invitations: columns 7, constraints 9, both diffs empty
webauthn_credentials: columns 7, constraints 6, both diffs empty
web_push_subscriptions: columns 7, constraints 5, both diffs empty
agent_proposals: columns 16, constraints 13, both diffs empty
1
exit=0
```

## #6 — scenario run

```
OK 189 tests, S1-S17 each present once and passed
exit=0
```

Re-run four more times during the work, and once after the mutation reverts, all `OK 189 tests, S1-S17 each present once and passed`.
During development one run printed
`FAIL RC-03: an item whose accounts disagree on the cursor syncs from no cursor, whichever account the table returns first`.
That is the pre-existing flake measured under #7.

## #7 — the integration config twice in a row

### First pair — FAILED (different pass counts)

`tail -6` of each run, verbatim. With vitest 5 this falls entirely inside the trailing performance
note, so the spec's command never shows the counts:

```
   Duration  9.39s (tests 55%, import 37%, transform 7%, setup 1%)

     Import  126 modules were evaluated 498 times · 2.60s total, 37% of tracked time
             ~1.94s faster with isolate: false — shared modules are evaluated once per worker instead of once per file
             learn more: https://vitest.dev/guide/improving-performance#test-isolation

```
```
   Duration  9.28s (tests 53%, import 38%, transform 7%, setup 1%)

     Import  126 modules were evaluated 498 times · 2.63s total, 38% of tracked time
             ~1.97s faster with isolate: false — shared modules are evaluated once per worker instead of once per file
             learn more: https://vitest.dev/guide/improving-performance#test-isolation

```

The same two runs' summary lines (from the full output saved alongside):

```
run 1:
 FAIL  proxy.test.ts > the request boundary > the pre-auth ceremony endpoints remain reachable with no session cookie at all
 FAIL  app/api/v1/overview/route.test.ts > GET /api/v1/overview, against a seeded scratch database > the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio
 FAIL  app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts > why reissued rows stayed orphaned > RC-03: an item whose accounts disagree on the cursor syncs from no cursor, whichever account the table returns first
 Test Files  3 failed | 20 passed (23)
      Tests  3 failed | 186 passed (189)
run 2:
 FAIL  proxy.test.ts > the request boundary > the pre-auth ceremony endpoints remain reachable with no session cookie at all
 FAIL  app/api/v1/overview/route.test.ts > GET /api/v1/overview, against a seeded scratch database > the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio
 Test Files  2 failed | 21 passed (23)
      Tests  2 failed | 187 passed (189)
```

RC-03 failed with `Error: rc-p40e: could not arrange the physical row order`. That is the test's own
harness giving up after 200 attempts to reorder rows in `accounts`'s heap. It does not touch any
user, session or push table. **The flake is pre-existing.** It was measured as follows:

- On a detached worktree of `HEAD` (without this diff), migrated to `HEAD`'s migrations in
  `b8_p41a_schema`: 10 runs of the integration config failed RC-03 **2 times out of 10** (169 passed
  instead of 170).
- On this tree, against `b8_p41a_throwaway`: 10 runs failed RC-03 **1 time out of 10** (186 instead of 187).

The worktree was removed afterwards, and `b8_p41a_schema` was dropped and re-created empty.

### Second pair — PASS (identical counts, only the two KNOWN failures)

```
run 3:
 FAIL  proxy.test.ts > the request boundary > the pre-auth ceremony endpoints remain reachable with no session cookie at all
 FAIL  app/api/v1/overview/route.test.ts > GET /api/v1/overview, against a seeded scratch database > the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio
 Test Files  2 failed | 21 passed (23)
      Tests  2 failed | 187 passed (189)
run 4:
 FAIL  proxy.test.ts > the request boundary > the pre-auth ceremony endpoints remain reachable with no session cookie at all
 FAIL  app/api/v1/overview/route.test.ts > GET /api/v1/overview, against a seeded scratch database > the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio
 Test Files  2 failed | 21 passed (23)
      Tests  2 failed | 187 passed (189)
```

Before this diff the config collected 172 tests (170 passing on a migrated scratch DB). It now
collects 189. The 17 new tests are the 17 scenarios. Every pre-existing test still runs, and none of
their assertions was removed or loosened.

## #8 — peer-ness grep

```
$ grep -rEl "user_id|userId|users\b" apps/web/app/api/v1 --include=route.ts | grep -Ev "/(auth|push|agent)/|/chat/route.ts"
apps/web/app/api/v1/plaid/create-link-token/route.ts
$ grep -rEl "user_id|userId" apps/web/lib | grep -Ev "authSession|requestAuth|registrationGate|webPush|proposalStore|invitation|user"
$
```

The one hit is not in this diff (`git diff --stat -- apps/web/app/api/v1/plaid/` is empty). It
matches only because of `user: { client_user_id: 'local-user' }` on line 12, the identifier Plaid's
Link API requires. It is not a user predicate on any query. The grep's pattern has no word boundary
before `user_id`, so it was never empty on this repository. I did not edit the Plaid route to
silence it, because that would be a diff outside the surface made only to satisfy a grep. The
orchestrator may wish to amend the pattern (for example `\buser_id\b`).

No ledger query in the diff gained a user predicate. The only SQL that filters by user is in
`lib/authSession.ts` (session resolution, credential listing for `excludeCredentials`, token
minting), `lib/webPush.ts` (send and status), `lib/users.ts` (revoke) and `lib/invitations.ts`.

## #9 — `grep -c "auth/me" apps/web/components/Sidebar.tsx`

```
2
```

## Mutation log

Each mutation was applied alone to the final tree, #6 was run in full, and the file was restored
from an in-memory copy before the next mutation. Output is the scenario check's own `FAIL` line,
trimmed to the scenario list. After the last revert, #6 printed
`OK 189 tests, S1-S17 each present once and passed`.

| Mutation (what was changed) | Scenarios that failed | Spec expected |
|---|---|---|
| Bootstrap gate accepts any code-shaped header regardless of validity (`liveInvitationHash` returns the hash without the SQL check) | S2, S7 | S2 |
| `consumed_at` left unset on success (the consuming UPDATE replaced by a no-op SELECT) | S5, S6, S8, S10 | S6 |
| Consume before the ceremony verifies (verify route marks the invitation consumed before `verifyRegistrationCeremony`; the locked re-check drops `consumed_at IS NULL`) | S8 | S8 |
| Ignore `expires_at` (dropped from the liveness read and the locked re-check) | S2, S7 | S7 |
| Attach redeemed credentials to the owner | S4, S5, S6, S10, S11, S13, S15, S16 | S5 |
| Attach a signed-in additional passkey to the owner by default | S10 | S10 |
| `createPersonalToken` defaults to the newest credential's user | S12 | S12 |
| `sendWebPush` ignores `userId` (sends to every live subscription) | S13, S16 | S13 |
| System proposals attributed to the owner (applied in `createProposal`; see note) | S14 | S14 and #4 |
| A personal token may create invitations (`sessionMayAdminister` ignores the kind) | S4 | S4 |
| Revoke touches only sessions, not credentials | S16 | S16 |

During the first mutation (M1) the pre-existing RC-03 flake also appeared once, as an unexpected
failure. It is unrelated to the mutation.

**Where more scenarios fail than the spec names, the extra failures come from the spec's own
assertions, not from accidental coupling:**
- M1 also fails S7, because S7 asserts that an expired code is refused at `register/options`, and
  M1 removes exactly that check.
- M2 also fails S5 and S8, which assert that `consumed_at` is set after success. It also fails S10:
  the second user's stable WebAuthn handle is derived from the invitation that created them
  (`consumed_by`), so with no consumption their later add-a-device ceremony cannot be given a
  handle and is refused, failing closed.
- M5 makes every fixture's "second user" resolve to the owner, so every scenario that depends on
  two distinct users fails. That is the defect's real blast radius.
- M8 also fails S16, which asserts that a push for a removed user reaches nothing.

**The backfill mutation could not be applied to the migration.** `migrations/**` is frozen and
hook-guarded, so "backfill `proposed_by_user_id` for system proposals" was applied to the
application's writer instead (`createProposal` with no actor records the owner). S14 catches it.
#4's `null null` line guards the migration's own backfill, which is the guardian's and is unchanged.

## Fixtures (fabricated ids only)

Every key is generated in-process (`createTestAuthenticator`: a fresh P-256 keypair and a random
32-byte credential id per call). Every display name is `Owner`, `Test User Two` or `Test User Three`.
Every push endpoint is under `push.example.invalid`. User ids below are what a fresh scratch database
assigns (`1` for the owner, `2` for the first invitee). The tests treat them as opaque.

**S2** (`app/api/v1/auth/principal.test.ts`). Owner bootstrapped through the real ceremony (user
`1`, one `bootstrap` credential). An invitation for `Test User Two` is minted and redeemed for real,
which leaves a *consumed* code. A second invitation for `Test User Three` is minted and then aged:
`created_at` and `expires_at` both moved back 5 days, giving an *expired* code. Then, for each of
five attempts — no cookie and no header; header `not-a-real-invitation-code-at-all`; header `%%%`;
the consumed code; the expired code — the fixture does the following:
- `register/options` → 403 `REGISTRATION_CLOSED` with no `data`;
- `register/verify` with a fresh authenticator answering a random challenge → 403
  `REGISTRATION_CLOSED` and no `Set-Cookie`;
- counts of `users`, `webauthn_credentials`, `auth_sessions` and `bootstrap` credentials are equal
  to the snapshot taken before the attempts, and the stranger's credential id is absent.

The bootstrap count stays exactly `1`.

**S5** (`app/api/v1/auth/invitations/route.test.ts`). Owner bootstrapped (user `1`). The owner's
`users` row and credential row are snapshotted. An invitation for `Test User Two` is minted through
`POST /api/v1/auth/invitations` under the owner's cookie. A fresh authenticator runs options and
then verify, with `X-Invitation-Code: <code>` on both and no cookie. Result: 200. One new `users`
row (id `2`, `display_name = 'Test User Two'`, `is_owner = false`). The credential's `user_id` is
`2`, not `1`, and its `enrolled_via` is not `bootstrap` (it is `invitation`). The returned cookie
resolves to user `2`. The invitation row has `consumed_at` set and `consumed_by = 2`. The owner's
user and credential rows equal their snapshots, and the bootstrap count is still `1`.

**S6** (same file). Sequential: code A is redeemed once (200), then the same code with a different
authenticator is refused at options (403). All four counts are unchanged. Concurrent: code B (for
`Test User Three`) is minted. Two `register/options` calls with code B issue two challenges. Two
fresh authenticators then call `register/verify` under `Promise.all`. The statuses sort to
`[200, 403]`. `users` grew by exactly one, exactly one of the two credential ids is enrolled, and
code B is consumed.

**S13** (`app/api/v1/push/web/route.test.ts`). VAPID keys are generated in-process: a P-256
PKCS8 private key, base64, and a raw public point, base64url. `fetch` is stubbed with a recorder
that answers 201. Owner (user `1`) and invitee (user `2`) are enrolled through the real ceremonies.
They register through `POST /api/v1/push/web`, each under their own cookie:
`https://push.example.invalid/owner-phone` by user `1`;
`https://push.example.invalid/second-user-phone` and `https://push.example.invalid/second-user-old-tablet`
by user `2`, after which the tablet is marked `revoked_at = NOW()`. The assertions:
- `sendWebPush('normal', 2)` targets exactly `[second-user-phone]`;
- `sendWebPush('normal')` and `sendWebPush('normal', 1)` target exactly `[owner-phone]`;
- `push/web/status` asked by user `2` about `owner-phone` returns `{ registered: false, revoked: false }`,
  and the reverse holds;
- user `2` re-registers `owner-phone`: the row now has `user_id = 2`, and is the only row for that
  endpoint. `sendWebPush('normal')` then targets nothing, and `sendWebPush('normal', 2)` targets
  both of user `2`'s live endpoints. Status for `owner-phone` flips accordingly.

## Scheduled pushes and the digest

**Scheduled pushes still go only to the owner.** The daily ping (`sendWebPushIfDelivered`) and the
overdraft and cushion watch (`lib/overdraftWatch.ts`) both call `sendWebPush` with no user. Omitting
the user now means the owner, resolved in SQL from `users.is_owner`. It no longer means every live
subscription, which was the behaviour before this change. S13 asserts this: `sendWebPush('normal')`
targets only the owner's endpoint. Neither caller was edited.

**The daily digest, its mail recipients, the alert recipients and every figure they contain are
unchanged.** No file under `lib/dailyDigest.ts`, `lib/digestRead.ts`, `lib/breachAlert.ts`,
`lib/overdraftWatch.ts`, the mail path or any ledger query is in this diff.

## Screenshot

`npm run screenshots -w @b8/web` writes to the tracked `docs/screenshots/`. It also authenticates
only one fabricated owner session, so on its own it cannot show a second user. Two steps were taken
instead:

1. `apps/web/scripts/screenshots.mjs` was **broken by the frozen migration**: it inserted a
   credential with no `user_id`, which the new `NOT NULL` refuses. It now creates the fabricated
   owner first. That is the minimal consumer fix (three lines plus a comment). It was not run in
   place, so `docs/screenshots/` is unchanged.
2. A copy of that script in the session scratchpad, outside the repo, also inserted a second
   fabricated user, `Test User Two`, with an `invitation` credential and a browser session. It ran
   against its own scratch database `b8_p41a_screens` (seeded by `seed-demo.mjs`, dropped at the end)
   and captured `/dashboard` at 1440×900 once per cookie.

The committed evidence images are **crops of the sidebar only**, so no figure from the seeded
dashboard is in a tracked file:

- `plan/tasks/P7-41a-second-user/screenshot-chrome-owner.jpg` — footer reads "Signed in as **Owner**"
- `plan/tasks/P7-41a-second-user/screenshot-chrome-second-user.jpg` — footer reads "Signed in as **Test User Two**"

The phone drawer renders the same `SignedInAs` line under its nav. It was not captured.

**Palette:** the sidebar's ground is `cyan-700` and its ink is `cyan-100`/white, which is this
file's own palette, not the app's `slate-*`. The new line uses `text-cyan-100/80` with the name in
`text-white` and a `border-white/20` rule, matching the file it lives in.

## Other files outside the spec's listed paths, and why

- `apps/web/scripts/screenshots.mjs`: broken by the migration (see above).
- `evals/golden/README.md`: its documented setup command inserted a credential with no `user_id`,
  which the migration now refuses. The command now creates the owner first. Both statements were run
  against `b8_p41a_schema` and succeeded.
- `apps/web/lib/webauthnOrigins.ts`: comment-only. Two doc comments said the app was single-user.
- `apps/web/app/api/v1/auth/secondUserTestKit.ts`: the shared ceremony drivers for the five
  scenario files. It is not a route and not a test file, and no shipping module imports it.
- `apps/web/app/api/v1/chat/route.ts`: records the proposing user next to the proposing session,
  which the migration's `agent_proposals_proposer_has_user` CHECK requires.

## Known limitation, recorded rather than worked around

If the owner's `users` row exists but every credential has been deleted, the bootstrap window
reopens (the count is global) but the bootstrap INSERT of a new owner trips `users_one_owner`. The
request is then refused as `REGISTRATION_CLOSED`, as CONTRACT.md's "Handed to the implementer" item 3
directs. No path in the app deletes the owner's last credential: revoke refuses the owner, and there
is no credential-removal UI. Recovering from such a state would need a deliberate decision about
whether the next bootstrap may adopt the existing owner row. That is a contract question, so this
diff makes no guess.

---

# Cycle 1 (returned from G3, 2026-10-15)

Three changes, as G3 directed. The contract files are still byte-identical to G1's digests:
`26f7d2d4…` (migration), `91351bf8…` (`db/schema.sql`), `000fa73d…` (`packages/contracts/auth.ts`).

## 1. S6's concurrent half is now deterministic (REQUIRED)

**Change** (`apps/web/app/api/v1/auth/invitations/route.test.ts`, inside the existing `T41a-S6:` test,
title unchanged, the sequential half untouched):
- A third connection opens a transaction and takes `SELECT … FOR UPDATE` on the invitation row.
- Both redemptions are then started.
- The test polls `pg_stat_activity` (bounded at 200 × 25 ms) until **two** backends are waiting on
  a `Lock` in a statement touching `user_invitations`. It asserts that this count is 2, and only then
  rolls back the holder.

With the real code, both redemptions wait at the enrolment transaction's `SELECT … FOR UPDATE`. With
the lock removed, each reads the row freely, creates its user and credential, and waits at the
consuming UPDATE. The UPDATE does not re-check `consumed_at`, so once the lock is released both go
through. The overlap is therefore forced rather than left to the scheduler. The existing assertions
are unchanged: statuses `[200, 403]`, exactly one new user, exactly one of the two credentials, and
the invitation consumed.

**Probe.** The mutation is G3's: remove `FOR UPDATE` from the invitation SELECT in `enrolCredential`.
`diff original mutated`:

```
298,299c298
<           WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()
<           FOR UPDATE`,
---
>           WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()`,
```

Command, each run: `(cd apps/web && DATABASE_URL=postgresql://localhost/b8_p41a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/auth/invitations/route.test.ts -t "T41a-S6")`, output filtered to the result lines.

```
== lock REMOVED
-- run 1
     × T41a-S6: an invitation is single-use, sequentially and under concurrency 115ms
AssertionError: expected [ 200, 200 ] to deeply equal [ 200, 403 ]
      Tests  1 failed | 5 skipped (6)
-- run 2
     × T41a-S6: an invitation is single-use, sequentially and under concurrency 114ms
AssertionError: expected [ 200, 200 ] to deeply equal [ 200, 403 ]
      Tests  1 failed | 5 skipped (6)
-- run 3
     × T41a-S6: an invitation is single-use, sequentially and under concurrency 123ms
AssertionError: expected [ 200, 200 ] to deeply equal [ 200, 403 ]
      Tests  1 failed | 5 skipped (6)
-- run 4
     × T41a-S6: an invitation is single-use, sequentially and under concurrency 118ms
AssertionError: expected [ 200, 200 ] to deeply equal [ 200, 403 ]
      Tests  1 failed | 5 skipped (6)
-- run 5
     × T41a-S6: an invitation is single-use, sequentially and under concurrency 110ms
AssertionError: expected [ 200, 200 ] to deeply equal [ 200, 403 ]
      Tests  1 failed | 5 skipped (6)
```

File restored from the saved copy; `diff -q` → `restored identical`.

```
== lock RESTORED
-- run 1
      Tests  1 passed | 5 skipped (6)
-- run 2
      Tests  1 passed | 5 skipped (6)
-- run 3
      Tests  1 passed | 5 skipped (6)
-- run 4
      Tests  1 passed | 5 skipped (6)
-- run 5
      Tests  1 passed | 5 skipped (6)
```

Lock removed: **5 of 5 fail** (`[200, 200]`: both redemptions succeed and two users exist). Lock restored: **5 of 5 pass**.

## 2. NIT N3 — a removed user cannot gain a passkey (inside the transaction)

**Change** (`apps/web/lib/authSession.ts`, the `authenticated` branch of `enrolCredential`): the
branch now runs `SELECT 1 FROM users WHERE id = $1 AND revoked_at IS NULL FOR SHARE` on the
enrolment transaction's own connection. A user who is not live is refused with `REGISTRATION_CLOSED`
and everything rolls back. `FOR SHARE` closes the race in both orderings:
- If the removal commits first, the read finds `revoked_at` set and refuses.
- If the read comes first, `revokeUser`'s `FOR UPDATE` on the same `users` row waits for this
  transaction, and its DELETE then removes the new credential as well.

**Assertion** (added inside `T41a-S16:` in `apps/web/app/api/v1/auth/users/revoke.test.ts`; no
scenario renamed). After the revoke, `enrolCredential` is called directly with
`{ via: 'authenticated', userId: <second user> }` and a fabricated credential. The test asserts
three things:
- the result is `{ enrolled: false, refusal: 'REGISTRATION_CLOSED' }`;
- no row exists for that credential id;
- the removed user still has zero credentials.

It is asserted at the function because no route can reach this state today: a removed user's
session no longer resolves.

**Probe**, with `AND revoked_at IS NULL` deleted from the new check, then restored:

```
     × T41a-S16: the owner revokes the second user; every way in stops, the record and the owner remain 168ms
AssertionError: expected { enrolled: true, …(2) } to deeply equal { enrolled: false, …(1) }
      Tests  1 failed (1)
restored identical
      Tests  1 passed (1)
```

## 3. NIT N1 — sidebar contrast

`apps/web/components/Sidebar.tsx`: `text-cyan-100/80` → `text-cyan-100` on the "Signed in as" line
and on the "Finance" mark. The mark appears in three places (desktop sidebar, mobile header, drawer),
and all three were changed so the copies stay identical. The "Signed in as" comment now states the
reason (12px, a floor of 4.5:1, which solid cyan-100 clears at 4.79:1). This supersedes the palette
note in the original "Screenshot" section above, which described the `/80` value. The two sidebar
crops were taken before this change and still show the `/80` ink; the name text in them is
unchanged.

N2 and N4 were not touched (deferred to NITS.md).

## Acceptance re-run (cycle 1)

### #1 — `(cd apps/web && npx tsc --noEmit)`

```
exit=0
```

### #2 — `npm run lint` (tail; the 5 warnings are in the same 4 untouched files as before)

```
✖ 5 problems (0 errors, 5 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

exit=0
/Users/andreianpilogov/Documents/b8/app/apps/web/app/login/page.tsx
/Users/andreianpilogov/Documents/b8/app/apps/web/lib/domain/digest.ts
/Users/andreianpilogov/Documents/b8/app/apps/web/public/sw.js
/Users/andreianpilogov/Documents/b8/app/apps/web/scripts/seed-demo.mjs
```

### #3 — `npm test 2>&1 | tail -8`

```
 Test Files  83 passed (83)
      Tests  1190 passed (1190)
   Start at  21:57:40
   Duration  5.68s (tests 55%, import 24%, transform 18%, worker 3%)

    Isolate  83 workers spawned · ~142ms startup each (spawn + environment, per file)
             at least ~1.54s faster with isolate: false — reuses workers across files instead of one per file

```

### #4 — amended form A1, on a freshly created `b8_p41a_throwaway`

```
1
1
1
1 null
null null
resolved-as-owner 3 unknown null
1 3 1 2
gone gone
1
exit=0
```

### #6 — scenario run

```
OK 189 tests, S1-S17 each present once and passed
exit=0
```

## Pre-deploy backup (owner, on the home server, 2026-10-15)

CONTRACT.md's standing practice: `\copy` of the four touched tables to `~/b8-backups/p41a/` on the server, outside
the repo, before the deploy applies the migration. Row counts only:

| Table | Rows |
|---|---|
| `webauthn_credentials` | 1 |
| `auth_sessions` | 74 |
| `web_push_subscriptions` | 6 |
| `agent_proposals` | 24 |

Expected after the migration: `users` = 1 (`Owner`); the one credential and all six subscriptions carry the owner's
`user_id`; proposals gain a user only through a session row that still exists.
