# P1-12-passkey-auth — Passkey/WebAuthn login, Postgres sessions, and the host-guard flip, shipped as one change

**Roadmap item:** ROADMAP.md §5 Phase 1, step 12. Orchestrator's reading: `plan/tasks/P1-12-passkey-auth/ITEM.md`.
**Status:** DRAFT
**Author:** spec-writer

## Goal

**Every one of the 28 existing `app/api/**/route.ts` handlers, and every page the app serves, becomes unreachable without a valid, server-verified session** — except the small, explicit set of surfaces a browser needs before a session exists. Today all 28 routes and every page are reachable by anything that can put the right `Host` header on a request to the bound port (`lib/hostGuard.ts`'s own docblock says as much). This task closes that at the same boundary that currently enforces the host check, so the closure covers routes this task's diff never touches.

**The scope question ITEM.md poses, answered: protect everything, minus an explicit allowlist.** Of the 28 routes, exactly one (`GET /api/v1/overview`) is on `/api/v1/*`; the other 27 are P1-10b's unstarted job. Gating only the v1 route would leave 27 routes and every page exactly as reachable as today — a **worse** posture the moment this task's own host-guard flip admits a second hostname. The standing rule *"passkey auth ships in the same change as any reachability change"* reads most naturally as "the reachability change may not outrun the auth", which requires the auth to cover everything the reachability change touches.

**Is the host-guard flip live risk today? No, and that is stated so nobody reads more urgency into it.** `package.json`'s `dev`/`start` bind `-H 127.0.0.1`; admitting a Tailscale hostname to the `Host` allowlist does not by itself make the server reachable from the tailnet — Phase 2 step 19 binds the interface. This task's job is to have the auth boundary already correct and already tested before that bind happens.

**The centerpiece defect, stated first because a WebAuthn quick-start gets it wrong most often:** a relying party that leaves registration open to anyone, forever, lets the first unauthenticated visitor after deploy enroll their own passkey and become the owner permanently. Registration must be open **only while zero credentials exist** and must require a valid session for every registration after that. I2/I3 are this rule, and it is this spec's single most important negative control.

**Sizing, per ITEM.md's request:**
- **(1) registration+login, (2) sessions, (5) the host-guard flip ship together.** Accepted, per the standing rule.
- **(3) mobile access+refresh tokens are deferred.** No client exists before Phase 3, so a token format designed today is frozen against guesswork — the argument P1-11's ITEM.md made about `/overview`. **A gap this creates and does not solve:** Month 4's Python eval-runner targets `/api/v1/chat` *before* Phase 3, and a cookie-only, ceremony-gated session has no non-browser path a script can obtain. This task does not invent a third auth mode to paper over it; the sequencing conflict is recorded for the orchestrator as a planning decision.
- **(4) `mutation_audit_log` is excluded, with a reason rather than inherited silence.** §3 describes it as actor/action/entity/before-after for **financial mutations**, load-bearing "the moment the agent gets write access" (Phase 4). This task writes exactly two row kinds — a credential and a session — neither financial, and a session row's own timestamps are its audit trail. Landing it here is a contract addition with zero call sites: the same "designed against no consumer" trap ITEM.md names for the mobile tokens.

## Non-goals

- **No `/api/v1/*` migration of the other 26 routes.** `P1-10b`'s job. Acceptance #34 enforces zero diff under `app/api/` outside `app/api/v1/auth/**`.
- **No `mutation_audit_log`.** Follow-up when the first write-capable financial route lands. Acceptance #36.
- **No mobile access/refresh tokens.**
- **No rate limiting or brute-force throttling**, including on the ceremony endpoints — step 13's job. Worth qualifying: WebAuthn's ceremony has no password to guess, so the missing throttle is a resource/DoS concern, not "the login can be brute-forced". Recorded, not waived.
- **No credential-management UI.** Removing a retired device's passkey is a direct database operation for now — an acceptable v1 gap for a single-user app, named rather than discovered.
- **No `Secure` cookie attribute mandate.** The app runs over plain HTTP until Phase 2 supplies TLS; requiring `Secure` today would mean the cookie never leaves the browser. `HttpOnly` and `SameSite` are required (F6); `Secure` is deferred to the Phase 2 task that adds TLS.
- **No unauthenticated health endpoint.** None exists; none is invented by omission.
- **No UI adoption beyond a minimal `/login` page.**
- **No change to `lib/domain/**`, `app/dashboard/**`, or the 27 non-v1 handlers' own logic.** Acceptance #33/#34.
- **No live browser or hardware-authenticator testing.** No Playwright, no WebDriver virtual authenticator, no WebAuthn polyfill exists in this repo. Every acceptance command is a deterministic Node-process test against fabricated ceremony responses (T-Fixture) or a direct call to a route/proxy function. The one thing no command can prove — that a real platform authenticator completes the ceremony — is a written manual confirmation in Evidence, never a screenshot: browser chrome beside this app can show real account data.
- **No change to existing tables.** Both new tables are additive; acceptance #37 enforces exactly two new `CREATE TABLE` and zero `ALTER TABLE` on a pre-existing table.

## Contracts touched

| File | Change | Class (§9.2) |
|---|---|---|
| `migrations/<new>` | two new tables: a WebAuthn credential store (credential id, COSE public key, sign counter, transports, timestamps) and a session store (opaque identifier, expiry, revocation state) — exact columns at the guardian's discretion. Single-user: **no `user_id` FK on either**, with a comment stating why, as `property_tenant_funds` does for its own omission | additive |
| `db/schema.sql` | reflects the migration | additive |
| `shared/types.ts` | none expected — server-only concepts with no client consumer this task adds. Guardian may add one at its discretion if it finds a real importer, following P1-11's precedent of declining an export with none | none, or additive |
| `shared/contracts/auth.ts` | new: zod envelopes for the ceremony endpoints, reusing `apiResponseSchema`/`ApiErrorResponseSchema` from `envelope.ts` rather than re-declaring the envelope | additive |
| `mutation_audit_log` | **explicitly not created** — see Goal | — |

No existing migration is edited (§9.3). Up→down→up applies (acceptance #37).

## Conventions this task must honor

The template's four categories do not map onto dollar amounts here, so each is answered on its own terms rather than left blank:

- **Sign / Rounding:** not applicable — this task introduces no numeric or currency field. Stated rather than omitted.
- **Landscape + exclusions, translated — the allowlist, named exactly.** Every request is protected **except** these five surfaces, and no others: `POST /api/v1/auth/register/options`, `POST /api/v1/auth/register/verify`, `POST /api/v1/auth/login/options`, `POST /api/v1/auth/login/verify`, and the `/login` page. **`POST /api/v1/auth/logout` is not on this list** — it is meaningless without a session and gets the same 401 as anything else. The two `register/*` endpoints are allowlisted at the boundary but further gated *inside* the handler by the bootstrap rule, because the boundary cannot count credentials without a database round trip on every request regardless of path — the wrong place for that check.
- **Null semantics, translated — "no session" is a value, never a default role.** No cookie, an empty cookie, and a cookie matching no row are **the same outcome**: never a "guest" or "read-only" access level, which this app's model does not have. A protected handler never runs with a partially-resolved session.
- **The two allowlists must not diverge independently — the rule with the worst failure mode if missed.** The host-guard's hostnames and the origins WebAuthn will accept are different lists for a real reason (a WebAuthn Relying Party ID cannot be an IP literal, so `127.0.0.1`/`[::1]`/`0.0.0.0` can never appear in the WebAuthn set). The WebAuthn set must be **derived from** the host-guard's, and **never from the incoming request's `Origin`/`Host` header at verify time**. The latter is the textbook RP mistake: `clientDataJSON.origin` is attacker-supplied JSON inside the very payload being verified, so trusting it makes origin-binding a no-op. F3, F8, F13.
- **Cookie semantics.** `HttpOnly` always. An explicit `SameSite` of `Lax` or `Strict`, never absent and never `None`. A finite `Max-Age`/`Expires` no greater than the server-side TTL. F6.
- **Fail closed on any error in session resolution.** An unreachable store, a throwing lookup, or a malformed cookie is unauthenticated — never `NextResponse.next()` inside a catch that assumes "couldn't check, so allow". BUILD.md §10.3's swallowed-error hazard, specific instance.

## Toolchain prerequisites

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | Next 16's request boundary is `proxy.ts`/`export function proxy`, **not** the deprecated `middleware.ts` this repo still uses, and `proxy` defaults to the **Node.js runtime**, so a real `pg` connection inside it is supported | **yes** | true of the installed version; migrating the file is this task's diff | `grep -c "Proxy defaults to using the Node.js runtime" node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` | `1` |
| T2 | `next/experimental/testing/server` resolves and can invoke a proxy function against a fabricated request with no running server | **yes** | bundled with the installed version | `node -e "console.log(Object.keys(require('next/experimental/testing/server')))"` | includes at least one export |
| T3 | `node:crypto` provides `randomBytes`/`randomUUID`/`timingSafeEqual` | **yes** | Node builtin | `node -e "const c=require('node:crypto'); console.log(typeof c.randomBytes, typeof c.randomUUID, typeof c.timingSafeEqual)"` | `function function function` |
| T4 | `typescript` resolves via `require('typescript')` for the AST script | **yes** | resolvable devDependency | `node -e "console.log(require('typescript').version)"` | matches `npx tsc --version` |
| T5 | A scratch Postgres, migrated, at `$DATABASE_URL` — **reusing `lib/testDbGuard.ts` and `vitest.integration.config.mts` exactly as P1-11 built them, not restated** | **yes** | `createdb b8_p112_throwaway && DATABASE_URL=postgresql://localhost/b8_p112_throwaway npx node-pg-migrate up` | `psql "$DATABASE_URL" -c "select current_database();"` | a name that is **not** `b8_finance` |
| T6 | `CONTRACT_PREFIXES` unchanged, so the implementer can write `proxy.ts`, `app/login/**`, `app/api/v1/auth/**`, `lib/**` and the integration config with the lease closed | **yes** | unchanged | `grep -n "CONTRACT_PREFIXES = " .claude/hooks/scope-guard.mjs` | `['shared/contracts/', 'migrations/']` |
| T7 | `git` at a known `HEAD` | **yes** | working tree | `git rev-parse --short HEAD` | filled in at G0 |
| T8 | A database, for the pure fixtures and the AST script | **NO** | n/a | n/a | every one is `vitest run` against the unmodified pure config, or a `typescript`-AST script over a `git diff` file list |
| **T-Fixture** | **A fabricated, self-consistent set of WebAuthn ceremony responses does not exist in this repo and must be created before F7 onward can run**: one registration response and one authentication response, internally consistent — a real test keypair whose public key is embedded in the registration response and whose private key signs the authentication response — fixed against a stated test RP id, origin and challenge. **The implementer creates this as part of its own diff; it is not tooling the orchestrator installs pre-dispatch** | **yes, before F7** | implementer's own helper, using `@simplewebauthn/server`'s verify functions as ground truth for "valid" | the real proof is that F7/F10 pass at all — they cannot pass against a stub | filled in at G0 |

## Acceptance commands

> **On `⟨P⟩` and `⟨I⟩`'s scope, fixed after G0 cycle 1.** The first draft defined both as whole-suite runs, and the floor commands were measured to pass **today**, before any of this task's code exists — 598 pure checkmarks and 10 integration checkmarks already existed from prior tasks, so a floor of 12 or 11 proved nothing. Both now name this task's own test files, so every floor and per-title grep is taken over a population that is empty until this task writes to it. The same review pass dropped two commands that measured only plumbing P1-11 already established — the scratch-DB guard firing at all, and the integration config's `include` containing a substring — both now proven behaviourally instead, since #22–#32 cannot pass without them.

`⟨P⟩` = `npx vitest run --reporter=verbose lib/hostGuard.test.ts lib/webauthnOrigins.test.ts lib/sessionToken.test.ts lib/webauthnVerify.test.ts 2>&1`. `⟨I⟩` = `npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/auth/register/route.test.ts app/api/v1/auth/login/route.test.ts proxy.test.ts 2>&1` (requires T5; the integration config's `include` must be widened to also match root-level `proxy.test.ts` — not separately checked, since #27–#32 cannot pass otherwise). All commands run from the repo root.

| # | Command | Expected |
|---|---|---|
| 1 | `npx tsc --noEmit; echo "exit=$?"` | `exit=0` |
| 2 | `npm test 2>&1 \| grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"` | `1` |
| 3 | `npm run lint 2>&1 \| tail -2` | the one pre-existing warning, unchanged |
| 4 | `npm run build > /tmp/p112-build.log 2>&1; echo "exit=$?"` | `exit=0` |
| 5 | `npm ci > /tmp/p112-ci.log 2>&1; echo "exit=$?"` | `exit=0` |
| 6 | `npm ls @simplewebauthn/server --depth=0 2>&1` | a resolved version, not `UNMET DEPENDENCY` |
| 7 | `test $(⟨P⟩ \| grep -cE "✓") -ge 20 && echo OK` | `OK` — 10 in `lib/hostGuard.test.ts` (9 pre-existing blocks + F2 as a tenth; F1 is the flip of an existing block) + 1 `webauthnOrigins` (F3) + 2 `sessionToken` (F5, F6) + 7 `webauthnVerify` (F7–F13) = 20 minimum. **Measured today: `9`** |
| 8 | `⟨P⟩ \| grep -cF "the host allowlist accepts the Tailscale hostname this task admits"` | `1` — **F1** |
| 9 | `⟨P⟩ \| grep -cF "an unrelated hostname, never admitted, is still rejected after the flip"` | `1` — **F2** |
| 10 | `⟨P⟩ \| grep -cF "the WebAuthn expected-origin set is a non-empty, explicit subset of the host-guard allowlist, never the wildcard, never derived from the request"` | `1` — **F3** |
| 11 | `⟨P⟩ \| grep -cF "1000 generated session identifiers are pairwise distinct and each carries at least 128 bits of encoded entropy"` | `1` — **F5** |
| 12 | `⟨P⟩ \| grep -cF "the session cookie is HttpOnly, carries an explicit SameSite, and its Max-Age never exceeds the configured session TTL"` | `1` — **F6** |
| 13 | `⟨P⟩ \| grep -cF "a correctly-formed registration ceremony response verifies and yields a storable credential"` | `1` — **F7**, positive control |
| 14 | `⟨P⟩ \| grep -cF "a registration response is rejected when the server's expected origin differs from the one embedded in clientDataJSON"` | `1` — **F8** |
| 15 | `⟨P⟩ \| grep -cF "a registration response is rejected when the server's expected challenge differs from the one embedded in clientDataJSON"` | `1` — **F9** |
| 16 | `⟨P⟩ \| grep -cF "a correctly-formed authentication response, signed by the registered credential's real private key, verifies against its stored public key"` | `1` — **F10**, positive control |
| 17 | `⟨P⟩ \| grep -cF "an authentication response signed by a DIFFERENT private key than the one whose public key is stored is rejected"` | `1` — **F11**, the crown-jewel negative control |
| 18 | `⟨P⟩ \| grep -cF "an authentication response for a credential ID that was never registered is rejected"` | `1` — **F12** |
| 19 | `⟨P⟩ \| grep -cF "an authentication response is rejected when its origin does not match the fixed expected-origin allowlist"` | `1` — **F13** |
| 20 | *(AST script, verbatim below)* | `NO_MATH_RANDOM=true HAS_CSPRNG=true` |
| 21 | `test $(⟨I⟩ \| grep -cE "✓") -ge 11 && echo OK` | `OK` — I1–I11, all in brand-new files with no pre-existing baseline. **Measured today: `0`** |
| 22 | `⟨I⟩ \| grep -cF "the first registration ceremony succeeds with no session, when zero credentials exist, and sets a session cookie"` | `1` — **I1** |
| 23 | `⟨I⟩ \| grep -cF "registration is refused without a session once at least one credential already exists"` | `1` — **I2**, the crown-jewel closure |
| 24 | `⟨I⟩ \| grep -cF "a second device registers successfully when a valid session is presented"` | `1` — **I3** |
| 25 | `⟨I⟩ \| grep -cF "the login ceremony succeeds end to end for a registered credential and sets a session cookie"` | `1` — **I4** |
| 26 | `⟨I⟩ \| grep -cF "login is refused end to end for an authentication response signed by the wrong key against a really-stored credential"` | `1` — **I5**, wiring proof |
| 27 | `⟨I⟩ \| grep -cF "a representative non-v1 API route is unreachable without a session cookie"` | `1` — **I6** |
| 28 | `⟨I⟩ \| grep -cF "a session cookie matching no stored session row is rejected"` | `1` — **I7** |
| 29 | `⟨I⟩ \| grep -cF "an expired session row is rejected"` | `1` — **I8** |
| 30 | `⟨I⟩ \| grep -cF "logout invalidates the session server-side; the same cookie replayed afterward is rejected"` | `1` — **I9** |
| 31 | `⟨I⟩ \| grep -cF "the pre-auth ceremony endpoints remain reachable with no session cookie at all"` | `1` — **I10** |
| 32 | `⟨I⟩ \| grep -cF "a representative page route is unreachable without a session cookie"` | `1` — **I11** |
| 33 | `git diff --name-only HEAD -- app/api/ \| grep -vE '^app/api/v1/auth/' \| wc -l \| tr -d ' '` | `0` |
| 34 | `git diff --name-only HEAD -- app/dashboard/ lib/domain/ \| wc -l \| tr -d ' '` | `0` |
| 35 | `git diff HEAD -- migrations/ db/schema.sql \| grep -ic mutation_audit_log` | `0` |
| 36 | `git diff --name-status HEAD -- middleware.ts proxy.ts` | `middleware.ts` deleted or renamed and `proxy.ts` added — no stray duplicate boundary file. *(Paired with #27/#32, which prove the retained file actually blocks; this command alone proves nothing about behaviour and is not offered as if it did.)* |
| 37 | `git diff --name-only HEAD -- vitest.config.mts \| wc -l \| tr -d ' '` | `0` |
| 38 | *(migration round-trip + table delta — verbatim below)* | `up=0 down=0 up=0`, `2` new `CREATE TABLE`, `0` `ALTER TABLE` on a pre-existing table |
| 39 | `git diff --name-only HEAD \| grep -vE '^(migrations/\|db/schema\.sql\|shared/contracts/auth\.ts\|shared/types\.ts\|lib/\|app/api/v1/auth/\|app/login/\|proxy\.ts\|proxy\.test\.ts\|middleware\.ts\|vitest\.integration\.config\.mts\|package(-lock)?\.json\|plan/)' \| wc -l \| tr -d ' '` | `0` |
| 40 | `git status --porcelain \| grep -vE '^.. (migrations/\|db/schema\.sql\|shared/contracts/auth\.ts\|shared/types\.ts\|lib/\|app/api/v1/auth/\|app/login/\|proxy\.ts\|proxy\.test\.ts\|middleware\.ts\|vitest\.integration\.config\.mts\|package(-lock)?\.json\|plan/)' \| wc -l \| tr -d ' '` | `0` |

**Verbatim scripts:**

```sh
# 20 — AST proof: no file this diff adds under lib/ calls Math.random, and at least one calls a
# real CSPRNG. AST rather than text search per A10: a comment reading "// never Math.random()"
# satisfies a substring search while proving nothing.
node -e '
const ts=require("typescript");const fs=require("fs");const {execSync}=require("child_process");
const files=execSync("git diff --name-only HEAD -- lib/").toString().split("\n")
  .filter(f=>f.endsWith(".ts") && !f.endsWith(".test.ts") && fs.existsSync(f));
let mathRandom=false, csprng=false;
for(const file of files){
  const src=ts.createSourceFile(file,fs.readFileSync(file,"utf8"),ts.ScriptTarget.Latest);
  (function visit(node){
    if(ts.isCallExpression(node)){
      const e=node.expression;
      if(ts.isPropertyAccessExpression(e)&&ts.isIdentifier(e.expression)&&e.expression.text==="Math"&&e.name.text==="random"){mathRandom=true;}
      if(ts.isPropertyAccessExpression(e)&&["randomBytes","randomUUID","getRandomValues"].includes(e.name.text)){csprng=true;}
      if(ts.isIdentifier(e)&&["randomBytes","randomUUID"].includes(e.text)){csprng=true;}
    }
    ts.forEachChild(node,visit);
  })(src);
}
console.log(`NO_MATH_RANDOM=${!mathRandom} HAS_CSPRNG=${csprng}`);
'

# 37 — migration round-trip + exact table delta.
createdb b8_p112_migtest
export DATABASE_URL=postgresql://localhost/b8_p112_migtest
npm run migrate:up;   up1=$?
npm run migrate:down; down1=$?
npm run migrate:up;   up2=$?
echo "up=$up1 down=$down1 up=$up2"
git diff HEAD -- db/schema.sql | grep -c '^+CREATE TABLE'
git diff HEAD -- db/schema.sql | grep -cE '^\+ALTER TABLE (accounts|transactions|budget_categories|properties)'
dropdb b8_p112_migtest
```

## Negative controls

| # | Rule | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | Registration is not permanently open | a registration attempt with no session, after ≥1 credential exists | I2 — #23 |
| 2 | A second device needs a session, not a second bootstrap window | a registration attempt with a **valid** session after ≥1 credential exists — must succeed, proving the gate is "needs a session", not "permanently closed" | I3 — #24 |
| 3 | The host flip is one named addition, not a relaxation | an arbitrary hostname distinct from every entry and the new one | F2 — #9 |
| 4 | Expected origin is never derived from the request | a forged response whose `clientDataJSON.origin` is attacker-chosen and differs from the server's fixed configuration | F8, F13, I5 — #14, #19, #26 |
| 5 | A signed response is verified against the stored public key, not merely well-formed | an authentication response structurally identical to a valid one but signed by a different private key | F11, I5 — #17, #26 |
| 6 | A challenge is single-use and attempt-specific | a registration response whose challenge does not match the one issued | F9 — #15 |
| 7 | An unknown credential id cannot authenticate | a login assertion naming a credential never registered | F12 — #18 |
| 8 | A session identifier is CSPRNG output, not guessable | absence of `Math.random`, presence of a real CSPRNG call, in every file this diff adds under `lib/` | AST — #20 |
| 9 | A forged cookie is rejected, not treated as valid by presence | a well-formed cookie matching no row | I7 — #28 |
| 10 | Expiry is enforced, not merely recorded | a session row expiring in the past, via its otherwise-valid cookie | I8 — #29 |
| 11 | Logout revokes server-side, not just the client's copy | the same cookie replayed after logout on a protected route | I9 — #30 |
| 12 | The allowlist is exactly five surfaces — neither empty nor total | each ceremony endpoint with no session (must succeed) alongside a non-allowlisted route with no session (must fail), in one run | I10 + I6 — #31, #27 |
| 13 | `mutation_audit_log` is a deliberate exclusion, not an oversight | its presence anywhere in the migration or schema diff | #36 |
| 14 | This task changes the boundary and the ceremony, nothing else | any diff to the 27 non-v1 routes, `lib/domain/**`, `app/dashboard/**`, or the pure config | #33, #34, #36 |

## Evidence required

1. **Verbatim `⟨P⟩` and `⟨I⟩` output**, all named fixtures passing, plus the AST script's line.
2. **The exact fabricated WebAuthn fixtures** (T-Fixture) — test RP id, origin, challenge — and confirmation the positive fixtures and each negative differ by exactly the one axis each is named for.
3. **A written, human-performed confirmation** that registration and login via a real platform authenticator succeed at `http://localhost:<port>/login` — browser and OS named, **no screenshot**, since this app renders real account data one click from the login page.
4. **The scratch database name** used for #33/#40, confirmed distinct from `b8_finance`.
5. **Confirmation `/security-review` was run on the frozen diff before G3**, per ITEM.md, recorded in `GATES.md` alongside the adversarial review.
6. **A one-paragraph statement of the Month-4/Phase-3 sequencing gap**, unresolved by this task but not absent from the record.
7. **Any acceptance command a correct implementation could not satisfy**, reported rather than worked around.

## Failure modes to test

- The bootstrap gate checks credential count with a race window — two concurrent unauthenticated registrations both read "zero" before either write lands. A TOCTOU version of the crown-jewel defect, not closed by a naive count check without a uniqueness constraint behind it.
- `expectedOrigin`/`expectedRPID` computed from `request.headers.get('origin')` "for convenience", silently defeating F8/F13/I5 while every other fixture still passes.
- The WebAuthn origin set hand-copied from the host allowlist rather than derived — passes today, drifts the next time either changes.
- Sign-counter clone detection wired to a no-op, so a cloned authenticator authenticates indefinitely with no signal.
- Logout implemented as a cookie delete with no server-side revocation — passes "logout returns 200" and fails only I9's replay.
- `try { … } catch { return NextResponse.next() }` — fail-open on a transient database blip, turning a hiccup into an authentication bypass.
- Expiry compared `<` vs `<=`, or a JS `Date` compared against an unconverted `TIMESTAMPTZ` string — P1-11's N4 boundary recurring on a new timestamp.
- `middleware.ts` left in place *alongside* `proxy.ts`, both defining a boundary and only one invoked — two definitions of "who may reach this", the shape BUILD.md §1 opens with.
- The `proxy` matcher narrowed or reordered so one existing route falls outside it — the Next 16 docs' own stated hazard: a matcher change can silently remove coverage.
- A page protected by a `redirect()` inside its own component rather than at the shared boundary — works for that page, reintroduces "protection is a per-file convention" for every page nobody remembers to edit.
- Multi-credential support assumed rather than tested: a query that silently reads only the most recent credential, so a second device registers but can never log in.
- Base64URL versus Base64, padded versus unpadded, in credential-id round-tripping — a classic WebAuthn bug that a hand-rolled encoding step reintroduces easily.
- `null` cookie handling inconsistent between "header absent" and "present but empty" — one path 401s, the other throws and some default turns it into a 200.

## Rollback

- `git revert` removes `shared/contracts/auth.ts`, `app/api/v1/auth/**`, `app/login/**`, the new `lib/**` modules and tests, the integration config's widened include, and restores `middleware.ts` from `proxy.ts` — a rename, cleanly reversible.
- **`npm run migrate:down`** drops both new tables, verified in the same up→down→up cycle acceptance #37 runs, not as a separate untested claim.
- **No CSV backup required.** Both tables are created empty; there is no pre-existing data to lose on a down.
- `npx tsc --noEmit` in both directions: forward, every existing importer still compiles; in reverse, nothing outside the declared surface depends on the new modules.
- Reverting **restores the prior posture exactly** — host guard rejects the Tailscale hostname again, all 28 routes unauthenticated again. Stated plainly because a partial revert that removed the auth and left the host flip in place is the one rollback shape this spec exists to prevent.

---

**Final acceptance-command count: 40.** Two dropped at G0 cycle 2 for measuring plumbing P1-11 already proved; none added in their place. 12 pure fixtures (F1–F3, F5–F13), 1 AST script, 11 integration fixtures (I1–I11), 18 baseline/scope/migration/dependency commands. **Zero commands assert only that a file exists, per A9.**
x