# EVIDENCE — P1-12-passkey-auth

**Author:** implementer · **Run date:** 2026-09-14 · **HEAD at start:** `e0cf22b`
**Scratch database:** `b8_p112_throwaway` — `select current_database()` → `b8_p112_throwaway`, which is
**not** `b8_finance`. The migration round-trip (#38) used a second, separate scratch database,
`b8_p112_migtest`, created and dropped inside the command.

**Headline: 38 of the 40 acceptance commands pass. Two — #39 and #40 — report `1` instead of `0`,
and the single file they report is `proxy.test.ts`, which SPEC.md itself requires.** That is a defect
in the two commands' allowlist regex, not in the diff; it is analysed in full at the end of this
document rather than worked around. Nothing else is partial, skipped or failing, with one item that
could not be run at all: the human browser confirmation (Evidence #3), which this role has no browser
and no platform authenticator to perform. It is reported as NOT DONE, not as done.

---

## 1. The acceptance commands, one row each

`⟨P⟩` = `npx vitest run --reporter=verbose lib/hostGuard.test.ts lib/webauthnOrigins.test.ts lib/sessionToken.test.ts lib/webauthnVerify.test.ts 2>&1`
`⟨I⟩` = `npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/auth/register/route.test.ts app/api/v1/auth/login/route.test.ts proxy.test.ts 2>&1`,
run with `DATABASE_URL=postgresql://localhost/b8_p112_throwaway` (T5).

| # | Expected | Observed | Verdict |
|---|---|---|---|
| 1 | `exit=0` | `exit=0` | PASS |
| 2 | `1` | `1` (whole suite: `Tests 614 passed (614)`) | PASS |
| 3 | the one pre-existing warning | `✖ 1 problem (0 errors, 1 warning)` — `scripts/seed-demo.mjs:457 'pid' is assigned a value but never used` | PASS |
| 4 | `exit=0` | `exit=0` | PASS |
| 5 | `exit=0` | `exit=0` | PASS |
| 6 | a resolved version | `└── @simplewebauthn/server@14.0.2` | PASS |
| 7 | `OK` (≥20 ✓ in ⟨P⟩) | `OK` — **21** | PASS |
| 8 | `1` — F1 | `1` | PASS |
| 9 | `1` — F2 | `1` | PASS |
| 10 | `1` — F3 | `1` | PASS |
| 11 | `1` — F5 | `1` | PASS |
| 12 | `1` — F6 | `1` | PASS |
| 13 | `1` — F7 | `1` | PASS |
| 14 | `1` — F8 | `1` | PASS |
| 15 | `1` — F9 | `1` | PASS |
| 16 | `1` — F10 | `1` | PASS |
| 17 | `1` — F11 | `1` | PASS |
| 18 | `1` — F12 | `1` | PASS |
| 19 | `1` — F13 | `1` | PASS |
| 20 | `NO_MATH_RANDOM=true HAS_CSPRNG=true` | `NO_MATH_RANDOM=true HAS_CSPRNG=true` (9 files scanned) | PASS |
| 21 | `OK` (≥11 ✓ in ⟨I⟩) | `OK` — **13** | PASS |
| 22 | `1` — I1 | `1` | PASS |
| 23 | `1` — I2 | `1` | PASS |
| 24 | `1` — I3 | `1` | PASS |
| 25 | `1` — I4 | `1` | PASS |
| 26 | `1` — I5 | `1` | PASS |
| 27 | `1` — I6 | `1` | PASS |
| 28 | `1` — I7 | `1` | PASS |
| 29 | `1` — I8 | `1` | PASS |
| 30 | `1` — I9 | `1` | PASS |
| 31 | `1` — I10 | `1` | PASS |
| 32 | `1` — I11 | `1` | PASS |
| 33 | `0` | `0` | PASS |
| 34 | `0` | `0` | PASS |
| 35 | `0` | `0`, and **not by blindness** — see §5 | PASS |
| 36 | deleted/renamed + added | `D middleware.ts` / `A proxy.ts` | PASS |
| 37 | `0` | `0` | PASS |
| 38 | `up=0 down=0 up=0`, `2`, `0` | `up=0 down=0 up=0`, `2`, `0` | PASS |
| 39 | `0` | **`1`** — `proxy.test.ts` | **FAIL — see §6** |
| 40 | `0` | **`1`** — `proxy.test.ts` | **FAIL — see §6** |

### #20, verbatim

```
NO_MATH_RANDOM=true HAS_CSPRNG=true
```

Files the script scanned (printed by an added diagnostic line, not part of the command):
`lib/authSession.ts lib/hostGuard.ts lib/nextNodeRuntime.setup.ts lib/registrationGate.ts
lib/sessionToken.ts lib/webauthnChallenge.ts lib/webauthnOrigins.ts lib/webauthnTestFixtures.ts
lib/webauthnVerify.ts` — nine files, so the two booleans are taken over a non-empty population.

### #38, verbatim

```
up=0 down=0 up=0
2
0
```

Plus two checks the command does not make and that are worth recording: after the `down`,
`information_schema.tables` held `0` of the two tables; after the second `up`, `2`. And
`b8_finance` — the real ledger — holds `0` of them, checked before and after (§7).

---

## 2. ⟨P⟩ — verbatim

```
 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app

 ✓ lib/hostGuard.test.ts > isAllowedHost > allows the hostnames the dev/start scripts actually serve on 1ms
 ✓ lib/hostGuard.test.ts > isAllowedHost > allows those hostnames with no port 0ms
 ✓ lib/hostGuard.test.ts > isAllowedHost > is case-insensitive on the hostname 0ms
 ✓ lib/hostGuard.test.ts > isAllowedHost > allows the IPv6 loopback literal, bracketed with a port 0ms
 ✓ lib/hostGuard.test.ts > isAllowedHost > rejects a spoofed Host header — the DNS-rebinding case this exists for 0ms
 ✓ lib/hostGuard.test.ts > isAllowedHost > the host allowlist accepts the Tailscale hostname this task admits 0ms
 ✓ lib/hostGuard.test.ts > isAllowedHost > an unrelated hostname, never admitted, is still rejected after the flip 0ms
 ✓ lib/hostGuard.test.ts > isAllowedHost > rejects null and empty Host headers 0ms
 ✓ lib/hostGuard.test.ts > isAllowedHost > does not mistake an IPv6 literal’s internal colons for the port separator 0ms
 ✓ lib/hostGuard.test.ts > isAllowedHost > rejects a hostname that merely contains an allowed one as a substring 0ms
 ✓ lib/sessionToken.test.ts > the session identifier > 1000 generated session identifiers are pairwise distinct and each carries at least 128 bits of encoded entropy 19ms
 ✓ lib/sessionToken.test.ts > the session identifier > the session cookie is HttpOnly, carries an explicit SameSite, and its Max-Age never exceeds the configured session TTL 1ms
 ✓ lib/sessionToken.test.ts > the session identifier > the stored form of a token is a lowercase 64-character hex digest, which is the only form the column accepts 0ms
 ✓ lib/webauthnOrigins.test.ts > the WebAuthn relying-party configuration > the WebAuthn expected-origin set is a non-empty, explicit subset of the host-guard allowlist, never the wildcard, never derived from the request 18ms
 ✓ lib/webauthnVerify.test.ts > the registration ceremony > a correctly-formed registration ceremony response verifies and yields a storable credential 8ms
 ✓ lib/webauthnVerify.test.ts > the registration ceremony > a registration response is rejected when the server's expected origin differs from the one embedded in clientDataJSON 1ms
 ✓ lib/webauthnVerify.test.ts > the registration ceremony > a registration response is rejected when the server's expected challenge differs from the one embedded in clientDataJSON 1ms
 ✓ lib/webauthnVerify.test.ts > the authentication ceremony > a correctly-formed authentication response, signed by the registered credential's real private key, verifies against its stored public key 4ms
 ✓ lib/webauthnVerify.test.ts > the authentication ceremony > an authentication response signed by a DIFFERENT private key than the one whose public key is stored is rejected 2ms
 ✓ lib/webauthnVerify.test.ts > the authentication ceremony > an authentication response for a credential ID that was never registered is rejected 1ms
 ✓ lib/webauthnVerify.test.ts > the authentication ceremony > an authentication response is rejected when its origin does not match the fixed expected-origin allowlist 1ms

 Test Files  4 passed (4)
      Tests  21 passed (21)
   Start at  08:04:29
   Duration  403ms (transform 178ms, setup 0ms, import 561ms, tests 61ms, environment 0ms)
```

(Two `ExperimentalWarning` lines from Node's Web Crypto surface are interleaved in the raw output and
are elided here; they are Node's, not this diff's, and appear in the P1-11 runs too.)

## 3. ⟨I⟩ — verbatim

```
 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app

{"time":"2026-09-14T15:04:31.287Z","level":"info","scope":"auth","message":"session revoked"}
 ✓ proxy.test.ts > the request boundary > a representative non-v1 API route is unreachable without a session cookie 35ms
 ✓ proxy.test.ts > the request boundary > a session cookie matching no stored session row is rejected 14ms
 ✓ proxy.test.ts > the request boundary > an expired session row is rejected 10ms
 ✓ proxy.test.ts > the request boundary > logout invalidates the session server-side; the same cookie replayed afterward is rejected 11ms
 ✓ proxy.test.ts > the request boundary > the pre-auth ceremony endpoints remain reachable with no session cookie at all 9ms
 ✓ proxy.test.ts > the request boundary > a representative page route is unreachable without a session cookie 8ms
 ✓ proxy.test.ts > the request boundary > the matcher still excludes Next's own static assets, so the login page a refused visitor is sent to can render 7ms
{"time":"2026-09-14T15:04:31.650Z","level":"info","scope":"auth","message":"credential enrolled","enrolledVia":"bootstrap"}
{"time":"2026-09-14T15:04:31.657Z","level":"info","scope":"auth","message":"session opened"}
{"time":"2026-09-14T15:04:31.668Z","level":"info","scope":"auth","message":"credential enrolled","enrolledVia":"bootstrap"}
{"time":"2026-09-14T15:04:31.670Z","level":"warn","scope":"auth","message":"login ceremony refused","reason":"the authentication response did not verify"}
{"time":"2026-09-14T15:04:31.680Z","level":"info","scope":"auth","message":"credential enrolled","enrolledVia":"bootstrap"}
{"time":"2026-09-14T15:04:31.682Z","level":"info","scope":"auth","message":"credential enrolled","enrolledVia":"authenticated"}
{"time":"2026-09-14T15:04:31.685Z","level":"info","scope":"auth","message":"session opened"}
 ✓ app/api/v1/auth/login/route.test.ts > POST /api/v1/auth/login/*, against a scratch database > the login ceremony succeeds end to end for a registered credential and sets a session cookie 40ms
 ✓ app/api/v1/auth/login/route.test.ts > POST /api/v1/auth/login/*, against a scratch database > login is refused end to end for an authentication response signed by the wrong key against a really-stored credential 12ms
 ✓ app/api/v1/auth/login/route.test.ts > POST /api/v1/auth/login/*, against a scratch database > a second enrolled device can sign in, over a credential list that is never truncated to one row 15ms
{"time":"2026-09-14T15:04:31.979Z","level":"info","scope":"auth","message":"credential enrolled","enrolledVia":"bootstrap"}
{"time":"2026-09-14T15:04:32.002Z","level":"info","scope":"auth","message":"credential enrolled","enrolledVia":"bootstrap"}
{"time":"2026-09-14T15:04:32.006Z","level":"info","scope":"auth","message":"credential enrolled","enrolledVia":"authenticated"}
 ✓ app/api/v1/auth/register/route.test.ts > POST /api/v1/auth/register/*, against a scratch database > the first registration ceremony succeeds with no session, when zero credentials exist, and sets a session cookie 36ms
 ✓ app/api/v1/auth/register/route.test.ts > POST /api/v1/auth/register/*, against a scratch database > registration is refused without a session once at least one credential already exists 11ms
 ✓ app/api/v1/auth/register/route.test.ts > POST /api/v1/auth/register/*, against a scratch database > a second device registers successfully when a valid session is presented 14ms

 Test Files  3 passed (3)
      Tests  13 passed (13)
   Start at  08:04:30
   Duration  1.18s (transform 84ms, setup 31ms, import 558ms, tests 224ms, environment 0ms)
```

**One change to `vitest.integration.config.mts` was needed to make #22–#32 read `1`, and it is
disclosed here rather than buried.** Vitest's default console interception prefixes anything a test
logs with `stdout | <file> > <suite> > <test name>`, which prints a fixture's own title a second
time. Measured before the change: #22 → `2`, #24 → `3`, #25 → `3`, #26 → `3`, #30 → `2`; every one of
those is a fixture whose subject writes an auth log line. The two available fixes were to delete the
logs or to stop the reporter repeating the title. **Deleting them was refused**: an enrolment, a
sign-in, a revocation and a refused ceremony are exactly what an owner needs in the server's output,
and this task deliberately creates no audit table. `disableConsoleIntercept: true` keeps both — the
log lines are still printed (they are visible above), and each title appears once.

---

## 4. T-Fixture — the fabricated WebAuthn material

Built in `lib/webauthnTestFixtures.ts`. Nothing here is real: no real credential, no real key, no
hostname beyond the `localhost` the dev server already binds.

| Axis | Value |
|---|---|
| RP id | `localhost` (`FIXTURE_RP_ID`) |
| Origin | `http://localhost:3000` (`FIXTURE_ORIGIN`) |
| Foreign origin, for the negatives | `https://evil.example.com` (`FOREIGN_ORIGIN`) |
| Challenge | 32 CSPRNG bytes, unpadded base64url (43 chars), generated per test |
| Keypair | EC P-256 / ES256 (COSE alg `-7`), generated per test, never reused across files |
| Credential id | 32 CSPRNG bytes, unpadded base64url |
| Attestation | `fmt: 'none'`, empty `attStmt` — what a passkey provider returns |
| AAGUID | 16 zero bytes |
| Flags | registration `0x45` (UP+UV+AT), assertion `0x05` (UP+UV) |
| Sign counter | `0` — a real reading, and the case clone detection must treat as inert |
| `response.transports` | `['internal','hybrid']`, carried through so a stripping parse would be caught |

**The fixture values are asserted to be values the server is really configured for** (F7's first two
lines: `EXPECTED_ORIGINS` contains `FIXTURE_ORIGIN`, `EXPECTED_RP_IDS` contains `FIXTURE_RP_ID`).
Without that check every negative below could be passing because the configuration rejects the
fixture outright rather than because of the axis it varies.

**Each negative differs from its positive along exactly one axis, and each is paired with a control
that differs along none:**

| Fixture | Varies | Everything else | Control in the same block |
|---|---|---|---|
| F8 | `clientDataJSON.origin` → `https://evil.example.com` | same keypair, challenge, RP id, attestation | the payload still parses cleanly against the contract (asserted), so the refusal is verification, not shape |
| F9 | the expected challenge the server holds | the identical payload bytes | the same payload against the challenge it answers → `verified: true` |
| F11 | the signing key | `id`, `authenticatorData` and `clientDataJSON` asserted byte-identical to the honest response; only `signature` differs | the honest response → `verified: true` |
| F12 | the credential id named by the assertion | signed by a genuinely enrolled key | both enrolled credentials are found by `selectCredential` over the same list |
| F13 | `clientDataJSON.origin` | real signature over that client data | same ceremony at `FIXTURE_ORIGIN` → `verified: true` |
| I5 | the signing key, end to end | the stored public key is read back out of Postgres, `octet_length > 0` asserted | I4 is the same flow with the real key → 200 |

**What the fixture builder does NOT do**, stated so it is not read as more than it is: it never
decides whether a response is valid. `@simplewebauthn/server` is the sole authority on that. A bug in
the builder shows up as the positive controls failing; it cannot make an invalid response verify.

---

## 5. The two issues G1 carried to this gate

**(a) The allowlist names `/login` but not its static assets — checked, and it is covered.**
The `proxy.ts` matcher is byte-identical to the one `middleware.ts` carried:
`['/((?!_next/static|_next/image|favicon.ico).*)']`. `/login`'s JS chunks and CSS are served from
`_next/static`, which the matcher excludes, so the proxy never runs for them and no sixth allowlist
entry is needed. This is asserted rather than assumed, in `proxy.test.ts`'s last block, through
Next's own `unstable_doesMiddlewareMatch` — four asset paths must not match, and ten protected or
allowlisted paths must match, so a matcher narrowed to exclude a protected route would also fail.

Confirmed on a **running production server** (`next start`, port 3100, pointed at the scratch
database): `GET /login` with no session → `200`; the real chunk referenced by that page,
`/_next/static/chunks/3mc6dra1m0098.js`, with no session → `200`. The built `/login` HTML references
no `_next/static/css/*` file, so there was none to fetch.

Two notes on scope, neither a hole: `public/*.svg` (the five unused Next template assets) IS behind
the boundary now, which is the "protect everything minus five surfaces" posture working as
specified; and the Next docs record that proxy still runs for `/_next/data/*` even when excluded by a
matcher, which is the behaviour we want — a page's data route is protected alongside the page.

**(b) Acceptance #35 cannot see an untracked migration — run after `git add -N`, and it now passes
for the right reason.** All new files were staged with `git add -N` before the battery. Measured
afterwards:

```
$ git diff HEAD -- migrations/ | wc -l                         → 308
$ git diff HEAD -- migrations/ db/schema.sql | grep -c '^+'     → 426
$ git diff HEAD -- migrations/ db/schema.sql | grep -ic webauthn_credentials → 13
$ git diff HEAD -- migrations/ db/schema.sql | grep -ic mutation_audit_log   → 0
```

The control grep finds 13 hits in the same diff the `mutation_audit_log` grep finds 0 in, so the `0`
is an absence in a diff the command can actually see.

---

## 6. The one thing a correct implementation cannot satisfy: #39 and #40

Both commands filter the changed-file list against a path allowlist and expect nothing left over.
Both report `1`, and the offender is the same file in each:

```
$ git diff --name-only HEAD | grep -vE '^(migrations/|db/schema\.sql|shared/contracts/auth\.ts|shared/types\.ts|lib/|app/api/v1/auth/|app/login/|proxy\.ts|middleware\.ts|vitest\.integration\.config\.mts|package(-lock)?\.json|plan/)'
proxy.test.ts

$ git status --porcelain | grep -vE '^.. (migrations/|db/schema\.sql|…|plan/)'
 A proxy.test.ts
```

**`proxy.test.ts` is required by SPEC.md.** It is named in the definition of `⟨I⟩` — *"the
integration config's `include` must be widened to also match root-level `proxy.test.ts`"* — and
acceptance #21 and #27–#32 cannot pass without it. The regex alternative `proxy\.ts` does not match
`proxy.test.ts`: anchored at `^`, it requires the literal `proxy.ts`, and the file's fourth character
onward is `test.ts`. So the spec requires a file at a path its own scope commands refuse.

There is no in-scope repair. The file cannot move: Next requires `proxy.ts` at the repo root beside
`app/`, so its fixture has nowhere else to sit, and `⟨I⟩` names the path literally. SPEC.md is frozen
and the scope guard refuses edits to it. **Reported rather than worked around**, per BUILD.md §5.4.

Adding `|proxy\.test\.ts` to both regexes takes both commands to `0`, which demonstrates that this
one file is the entire delta and that nothing else in the tree is out of scope:

```
$ git diff --name-only HEAD | grep -vE '^(…|proxy\.ts|proxy\.test\.ts|…)' | wc -l   → 0
$ git status --porcelain  | grep -vE '^.. (…|proxy\.ts|proxy\.test\.ts|…)' | wc -l  → 0
```

**Two files in the diff are inside the allowlist but were not named in SPEC.md's prose, and are
flagged here so the reviewer does not have to find them:**

- `lib/nextNodeRuntime.setup.ts` (+ one line in `vitest.integration.config.mts`). Importing
  `next/experimental/testing/server` — the package Next ships for testing a proxy's matcher — reaches
  Next's internals through CJS and leaves `globalThis.AsyncLocalStorage` unset, after which importing
  any route handler fails at import time with `Invariant: AsyncLocalStorage accessed in runtime where
  it is not available`. The setup file installs exactly what Next's own Node bootstrap installs
  (`next/dist/server/node-environment-baseline.js`, same guard, same assignment), so the suite's
  runtime is the one the server actually has. Measured: without it, I9 fails at import; with it, it
  passes.
- `lib/registrationGate.ts` + `lib/registrationGate.test.ts`. The bootstrap rule as a pure function,
  so the decision that permits an enrolment and the `enrolled_via` tag written to the database come
  from one place and can be stated over all four combinations of its two inputs — including "a valid
  session with an empty store", which no deployment reaches and which is exactly where a count-only
  implementation and a session-only one disagree.
- `@simplewebauthn/browser@14.0.0` was added to `package.json` alongside the server package. The
  `/login` page runs a browser ceremony, which is a pile of `ArrayBuffer`-to-base64url conversions,
  and SPEC.md's failure list names hand-rolled base64url round-tripping as a classic WebAuthn bug.
  Using the companion package to the server library removes the step rather than re-implementing it.

---

## 7. The live end-to-end run, and the confirmation this role could NOT perform

### Evidence #3 — the human browser confirmation: **NOT DONE**

SPEC.md requires *"a written, human-performed confirmation that registration and login via a real
platform authenticator succeed at `http://localhost:<port>/login` — browser and OS named, no
screenshot"*. **This role has no browser and no platform authenticator, so it has not been
performed, and no substitute below should be read as having performed it.** The one thing no
automated command in this task can prove — that a real Touch ID / passkey-provider ceremony
completes in a real browser — remains unproven and is the owner's to run before G3.

Two practical notes for whoever runs it. First, port 3000 was already occupied by a running server
during this work, which is why everything below used 3100; the configured WebAuthn origin is
`http://localhost:3000`, so **the manual test must be run on port 3000** or the browser ceremony will
fail with a `SecurityError` that is a configuration mismatch and not a defect. Second, the dev
server's `.env.local` points at `b8_finance`, the real ledger — a manual registration there writes a
real credential row, which is fine and intended for the owner's own machine, but it is a write and
should be a deliberate one.

### What was run live instead, and what it does prove

A production build (`next start -H 127.0.0.1 -p 3100`) pointed at the scratch database, driven by a
temporary script that fabricated ceremony payloads exactly as the unit fixtures do and spoke HTTP.
The script was deleted afterwards; the working tree is clean of it. All values fabricated.

```
1  GET /login with no session            -> 200
2  GET /dashboard with no session        -> 307 /login
3  GET /api/accounts with no session     -> 401
4  POST register/options (no session)    -> 200 rp.id=localhost challenge chars=43
5  POST register/verify (bootstrap)      -> 200 {"success":true,"data":null}
   Set-Cookie attributes                 -> b8_session=<redacted>; Path=/; Expires=Tue, 15 Sep 2026 03:03:38 GMT; Max-Age=43200; HttpOnly; SameSite=lax
6  GET /api/accounts WITH that session   -> 405   (the route exports POST only; the boundary let it through)
7  POST register/options, no session now -> 403 REGISTRATION_CLOSED
8  POST login/options                    -> 200 allowCredentials=1
9  POST login/verify (real key)          -> 200 {"success":true,"data":null}
10 POST login/verify, foreign origin     -> 400 CEREMONY_FAILED
11 POST login/verify, wrong private key  -> 400 CEREMONY_FAILED
12 POST logout with the session          -> 200
13 GET /api/accounts, cookie replayed    -> 401
14 GET /dashboard, cookie replayed       -> 307
A  GET /api/categories WITH session      -> 200 body length 26 bytes
B  GET /api/categories WITHOUT session   -> 401
C  a real /login JS chunk                -> /_next/static/chunks/3mc6dra1m0098.js -> 200
```

Rows 10 and 11 are the two crown-jewel negatives through a real server, and row 4 is worth one
sentence: the request arrived on **port 3100** and the ceremony claimed origin
`http://localhost:3000`, and it verified — because the expected origin comes from the server's fixed
configuration and not from the request. A relying party deriving `expectedOrigin` from the incoming
request would have refused row 5 and accepted row 10; this one does the opposite.

### Fail-closed, demonstrated on a live server rather than argued

The same build, started with `DATABASE_URL` pointing at a database that does not exist:

```
GET /api/accounts with a session cookie  -> 401 {"success":false,"error":{"code":"UNAUTHENTICATED",…}}
GET /dashboard  with a session cookie    -> 307 location=/login
server log: "session lookup failed at the boundary; refusing"   ×2
grep of the server log for the database it tried: b8_p112_no_such_db ×2, b8_finance ×0
```

An unreachable store refuses. It does not `NextResponse.next()`.

### The real database was never touched

`npm run migrate:up` hard-codes `--envPath .env.local`, which resolves to `b8_finance`. Before
running #38 I established, statically and then empirically, that an exported `DATABASE_URL` wins:
`node-pg-migrate`'s CLI calls `dotenv.config({ path })` with no `override`, and dotenv never
overwrites an existing `process.env` key; `dotenv-expand` is not installed, so the CLI's optional
expansion step is skipped. Empirically, with `DATABASE_URL` exported to a non-existent name:

```
$ DATABASE_URL=postgresql://localhost/b8_p112_no_such_db npm run migrate:up
could not connect to postgres: error: database "b8_p112_no_such_db" does not exist
```

It named the exported database, not `b8_finance`. And throughout:

```
$ psql postgresql://localhost/b8_finance -tAc "select count(*) from information_schema.tables
    where table_name in ('auth_sessions','webauthn_credentials');"
0
```

No real dollar amount, account number, balance, credential or hostname appears in this document or in
any log quoted by it.

---

## 8. Design decisions a reviewer will want stated

- **The challenge store is in-process, not a table and not a cookie.** The frozen schema has no
  challenge table, correctly: a challenge lives for one ceremony and a row per issued challenge on an
  unauthenticated endpoint is a write anybody can cause. A cookie was refused because a challenge the
  caller hands back is a challenge the caller chooses. `lib/webauthnChallenge.ts` is a bounded
  (64 per kind), TTL'd (5 min), spend-on-read set, keyed by ceremony kind so a registration challenge
  cannot be spent as an authentication one. Its costs are written into the file: a restart forgets
  outstanding challenges (fails closed — the owner clicks again), and it is per-process.
  `@simplewebauthn/server`'s predicate form of `expectedChallenge` is used so the store answers "did
  I issue this, and is it unspent?" — the payload proposes, the server decides, and an empty store
  refuses everything.
- **The refusal has two shapes.** `/api/**` gets 401 with `ApiErrorResponseSchema` — the body
  `shared/contracts/auth.ts` aliases as `UnauthenticatedResponseSchema`, parsed by I6 rather than
  eyeballed. A page gets a 307 to `/login`. That is a judgement call on the contract's sentence
  "the body the boundary returns for a request it refuses"; a redirect carries no body, and SPEC.md's
  own failure list names *"a page protected by a `redirect()` inside its own component rather than at
  the shared boundary"*, which reads as expecting the redirect to exist and to live at the boundary.
  Flagged explicitly so the reviewer can overrule it rather than discover it.
- **Handlers re-resolve the session rather than trusting a header from the proxy.** A request header
  set by the boundary is indistinguishable, from inside a handler, from one a caller sent. The cost
  is one primary-key lookup.
- **The Tailscale hostname is `b8.tailnet.ts.net`, a placeholder for a real name.** Phase 2 step 19
  binds the interface; until then nothing reaches this server over a tailnet and the entry admits
  nobody. `TAILNET_HOSTNAME` in `lib/hostGuard.ts` is the single place to change, and the WebAuthn
  origin set is derived from the allowlist, so replacing the literal moves both lists at once. F1
  asserts the literal as well as the constant, so a test written against the constant alone cannot
  vacuously follow a wrong value. One thing a future task must revisit rather than inherit:
  `PRIMARY_RP_ID` is `localhost`, so a page served over the tailnet will need it to become the tailnet
  name; that is recorded in `lib/webauthnOrigins.ts` beside the constant.
- **`http` for `localhost`, `https` for every other host, in the derived origin set.** WebAuthn runs
  only in a secure context and `localhost` is the single browser exemption, so an `http://` entry for
  the tailnet host would be an origin no browser can ever produce — worse than an entry that does not
  work yet, because it would look like configured support.
- **Clone detection is the library's, and it is deliberately inert for a 0/0 counter.**
  `@simplewebauthn/server` throws when `(counter > 0 || stored > 0) && counter <= stored`; the
  wrapper turns that into a refusal and logs the reason. `recordSignCount` writes
  `GREATEST(sign_count, $2)` so two racing accepts cannot move the high-water mark backwards.
- **`selectCredential` exists because the library does not compare the assertion's credential id to
  the credential it is handed** — measured in `verifyAuthenticationResponse`'s source, which
  destructures `id` and `rawId` and compares those two to each other only. So "the assertion names
  the credential we are checking it against" is the application's obligation; it is a named function
  with its own fixture, and `verifyAuthenticationCeremony` re-checks the pairing.

---

## 9. Evidence #6 — the Month-4 / Phase-3 sequencing gap, unresolved and recorded

This task ships a cookie-only, ceremony-gated session, and mobile access/refresh tokens are deferred
because no client exists to design them against before Phase 3. The consequence SPEC.md already names
is now concrete: **Month 4's Python eval-runner targets `/api/v1/chat`, and after this change that
endpoint — like all 27 other non-v1 handlers and every page — is behind a boundary whose only key is
an `HttpOnly` cookie obtained by completing a WebAuthn ceremony in a browser.** There is no
non-browser path a script can take, and this task deliberately invents no third auth mode to paper
over it: a token format designed against no consumer is a contract frozen on guesswork. The
contract-guardian added the shape constraint that matters when it is resolved: a row in
`auth_sessions` means *a WebAuthn ceremony completed*, so the honest form of a non-browser credential
is a second table with its own kind, not a nullable `token_type` column and not a hand-inserted
session row pointing at a passkey that did not authenticate it. The planning decision — either bring
the mobile-token step forward, or give the eval-runner its own credential kind — belongs to the
orchestrator and is unresolved here.

## 10. Evidence #5 — `/security-review`

Not run by this role: it is a slash command in the orchestrator's session, and ITEM.md assigns it to
the gate rather than to the implementer (*"Run `/security-review` on the diff before G3 … and record
it in `GATES.md`"*). Flagged so its absence from this document is not read as an omission.
