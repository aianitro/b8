# P7-41a2-browser-onboarding — Onboarding the second user from the browser
**Roadmap item:** ROADMAP.md §5 Phase 7 step 41a-2 — onboarding in the browser (the two screens P7-41a's API needs)
**Status:** FROZEN@G0 (2026-10-18)
**Author:** spec-writer

## Goal
Today the second user cannot onboard, because the endpoints exist (`POST /api/v1/auth/invitations`, and redemption through the `X-Invitation-Code` header on `register/options` and `register/verify`) but no screen calls either. After this change: (1) the owner, signed in with a full browser session, can create an invitation from inside the app by typing a display name, and is shown a link that carries the code, exactly once, ready to copy; the second user and any other signed-in non-owner never see that control. (2) A visitor who opens that link on another device with no session lands on the login page in an invitation mode, runs the existing registration ceremony with the code sent on BOTH `register/options` and `register/verify`, and ends up signed in as the new user (not the owner) on the same landing page every sign-in uses. A malformed, expired, consumed or unknown code shows a plain refusal and enrols nothing. (3) `/login` without an invitation behaves exactly as it does today. (4) The code is a secret for up to seven days and never leaks: it travels in the URL fragment (never the path or query, so it reaches no server, proxy or access log and no Referer), it is removed from the address bar once read, it is never written to localStorage, sessionStorage, a cookie or any log, and the login page sends no Referer-bearing request to any other origin.

## Non-goals
Each is enforced by the reviewer as a defect if present.
- **No server change.** No edit to any file under `apps/web/app/api/v1/` except new `*.test.ts` files and additions to the existing test kit `apps/web/app/api/v1/auth/secondUserTestKit.ts`. No edit to `apps/web/lib/authSession.ts`, `invitations.ts`, `registrationGate.ts`, `users.ts`. `PRE_AUTH_PATHS` keeps exactly its current twelve members. The server keeps reading the code only from the `X-Invitation-Code` header.
- **No new endpoint of any kind**, in particular none that validates a code, previews an invitation, or returns the invitee's name to an unauthenticated caller. Consequently the login page cannot know or show the invitee's display name, and the link carries the code and nothing else (no name, no user id, no expiry).
- **No invitation list, revoke, resend or management UI**, no "my pending invitations", no way to re-display a code after the owner dismisses or leaves the panel. A lost code is replaced by minting another.
- **No email, SMS, share-sheet integration, QR code or push** delivery of the link. The owner copies it by hand.
- **No change to the existing ceremony semantics**: the login ceremony, the "Register this device" action on an ordinary `/login`, the first-passkey bootstrap, `AFTER_SIGN_IN`, the full-navigation landing (`window.location.assign`), and the server's error messages are unchanged. No restyle of `/login` beyond what the invitation mode needs.
- **No change to what the sidebar's "Signed in as" line does** (still renders nothing when `me` fails, still not asked on `/login`).
- **41a's follow-ups are out of scope** (NITS.md, including binding the code to the challenge). If the implementer finds the UI cannot work without one, that is a finding to report, not a change to make.
- **No contract change** (see below). **No migration.**
- **No third-party request from the login page**: no fonts, analytics, CDN scripts or external images added to it.
- **The second user's real name appears in no tracked file, fixture, comment or commit.** Fixtures use `Test User Two`. **No money figures** anywhere.
- **No real invitation code in any tracked file or EVIDENCE.md.** Evidence records lengths and booleans, never the code.

## Contracts touched
None. `Me` / `MeSchema` (`isOwner`), `InvitationCreateRequestSchema`, `InvitationCreatedSchema` / `InvitationCreatedResponseSchema` and `invitationCode` in `packages/contracts/auth.ts` already express everything the UI needs. No migration, no `db/schema.sql` change. If the implementer concludes otherwise, that is a G-gate escalation to the orchestrator before any contract edit, not an edit.

## Conventions this task must honor
- **Sign / rounding / landscape / exclusions:** not applicable. No amount, account, transaction or budget is read, written or displayed. Touching one is a defect.
- **Secrecy (this task's worst trap).** The raw code exists in exactly these places and no others: the owner's create response; the on-screen link and the in-memory state of the owner's panel while it is shown; the invitee's URL fragment until the page reads it, then only in the page's in-memory state; the `X-Invitation-Code` request header on `register/options` and `register/verify` and nowhere else. It is never in a URL path or query, a request body, a cookie, local or session storage, a console line, a server log line, or a Referer. Dismissing or leaving the owner's panel discards it.
- **Header semantics.** The server tests `header present`, not `header non-empty`. Therefore "no invitation" must mean the header is ABSENT. An empty-string header is a defect: it routes ordinary registration into the invitation branch and refuses it.
- **Authority.** Hiding the control from non-owners is a convenience; the server (owner-only full browser session) remains the gate. The control is shown only when `GET /api/v1/auth/me` returned `isOwner` strictly `true`. A failed, malformed or missing `me` shows nothing, never the control and never an error banner (null is "unknown", not "owner" and not "not owner").
- **Time.** Whether a code is live is decided only by the server at redemption (Postgres). The page never decides a code is expired. The owner's panel shows the server's `expiresAt` verbatim as a date/time; it computes no expiry from the client clock.
- **Validation single-sourced.** What counts as a well-formed code on the client is whatever the contract's `invitationCode` schema accepts; the rule is not restated by hand.
- **Null semantics.** No invitation in the URL means ordinary `/login`. A present-but-unreadable invitation means refusal, never silent fall-through to ordinary mode and never a request carrying a partial code.

## Toolchain prerequisites
| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `psql`, `createdb`, `dropdb` and a local Postgres with CREATEDB | **yes** | local install | `psql -d postgres -tAc "select 1"` → `1` | filled at G0 |
| T2 | A fresh empty throwaway DB for integration tests, not `b8_finance` | **yes** | `createdb b8_p41a2_throwaway` then `DATABASE_URL=postgresql://localhost/b8_p41a2_throwaway npm run migrate:up` | `psql postgresql://localhost/b8_p41a2_throwaway -tAc "select to_regclass('public.user_invitations')::text"` → `user_invitations` | filled at G0 |
| T3 | An exported `DATABASE_URL` wins over `apps/web/.env.local` in `npm run migrate:up` | **yes** | n/a | `DATABASE_URL=postgresql://nobody@127.0.0.1:1/b8_p41a2_throwaway npm run migrate:up; echo "exit=$?"` → non-zero with a connection error to port 1 | filled at G0 |
| T4 | Integration scratch-DB guard refuses `b8_finance` before any pool exists | **yes** | existing `lib/testDbGuard.setup.ts` | `(cd apps/web && DATABASE_URL=postgresql://nobody@127.0.0.1:1/b8_finance npx vitest run --config vitest.integration.config.mts 2>&1 \| grep -c b8_finance)` → ≥ 1 | filled at G0 |
| T5 | Unit baseline recorded before the change | **yes** | existing | `npm test 2>&1 \| tail -8` → record files and tests as BASE | filled at G0 |
| T6 | `tsc` runs in `apps/web` | **yes** | existing | `(cd apps/web && npx tsc --noEmit; echo "exit=$?")` → `exit=0` | filled at G0 |
| T7 | Google Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (or `$CHROME`), with the DevTools `WebAuthn` domain available for a virtual authenticator | **yes** (browser check only) | local install, as `scripts/screenshots.mjs` already assumes | `"${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}" --version` → a version string | filled at G0 |
| T8 | Port 3000 free, because the WebAuthn origin is the constant `http://localhost:3000` (`APP_PORT` in `lib/webauthnOrigins.ts`) and cannot be the screenshots script's port | **yes** (browser check only) | stop any running dev server | `lsof -nP -iTCP:3000 -sTCP:LISTEN \| wc -l` → `0` | filled at G0 |
| T9 | Live Plaid, live push services, network, the dev DB `b8_finance`, `.env.local` data | **NO** | n/a | n/a | n/a |

Prerequisites the implementer must create (none exist today). Every scenario title begins with its id exactly as listed (`T41a2-U1:` …), so the scenario commands find each by structure. All fixtures use fabricated data only and seed what they assert on.
- `apps/web/lib/invitationLink.test.ts` — pure unit tests U1–U7. Collected by the existing `lib/**/*.test.ts` glob. Imports only pure modules (no DB, no network).
- `apps/web/lib/passkeyCeremony.test.ts` — pure unit tests C1–C7. The ceremony request sequence the login page runs (options request, authenticator step, verify request, error handling) must live in a module that takes its collaborators (`fetch` and the authenticator functions) as parameters, so a node test can drive it with a recording `fetch` and a stub authenticator. That extraction is required for testability; its internal shape is the implementer's.
- `apps/web/app/api/v1/auth/invitations/onboarding.test.ts` — integration tests I1–I6, using the existing kit `secondUserTestKit.ts`. Collected by `app/api/v1/**/*.test.ts`. Truncates its own rows with `resetAuth()`, passes alone and in any order after the existing suites.
- `apps/web/scripts/onboarding-browser-check.mjs` — the browser check, B1–B9, patterned on `scripts/screenshots.mjs` (headless Chrome over CDP with Node's own WebSocket). It makes its OWN scratch database by hard-coded name `b8_onboarding_check` (never reads `DATABASE_URL`, refuses any other name, drops it at the end), migrates it, seeds a fabricated owner credential and browser session with `psql` as `screenshots.mjs` does, starts the dev server on port 3000 with that database passed explicitly, uses a virtual authenticator (`WebAuthn.addVirtualAuthenticator`) for each browser profile, and uses a separate browser profile (no shared cookies) per "device". It prints one line per step, `B<n> PASS <what was observed>`, and a final line `OK B1-B9`; any failed step prints `B<n> FAIL <observed>` and exits non-zero. It records server stdout/stderr to a file it greps for the code.

## Scenarios
| Id | Observable rule | Fixture and assertion |
|---|---|---|
| U1 | **Link shape.** The invitation link keeps the code out of everything a server sees. | For fabricated codes of 22 and 43 base64url characters (including `-` and `_`) and origins `https://app.example.invalid`, `https://app.example.invalid/` (trailing slash) and `http://localhost:3000`: `new URL(link)` has `pathname` exactly `/login`, `search` exactly `''`, the expected `origin`, exactly one `#`, the code present in `hash`, and `link.slice(0, link.indexOf('#'))` does NOT contain the code. |
| U2 | **Round trip.** What the owner copies is what the page reads. | For each U1 input, reading `new URL(link).hash` yields the original code, byte for byte. |
| U3 | **Absence is ordinary mode.** | Hash values `''`, `'#'`, `'#other=1'`, `'#invitee'`, `'#section'` read as "no invitation" (not as invalid). |
| U4 | **Presence-but-unreadable is refusal, and equals the contract.** | `'#invite='`, 21-character code, codes containing `+`, `/`, `=`, a space or `%20`, two `invite=` keys, and `invite=<code>&x=1` with a bad code read as "invalid invitation", never "no invitation". Across a table of 12 or more such strings and valid ones, the reader's accept/reject verdict equals `invitationCode.safeParse(candidate).success` (the contract is the single source). |
| U5 | **Header builder.** | With a code: a `Headers` built from the result has `x-invitation-code` equal to the code and nothing else added. Without a code (`null`/absent): `new Headers(result).has('x-invitation-code')` is `false` — absent, not empty. |
| U6 | **Owner-only visibility decision.** | True only for `{ isOwner: true, ... }` with a non-empty `displayName`. False for `isOwner: false`, `null`, `undefined`, `{}`, `{ isOwner: 'true' }`, `{ isOwner: 1 }`, and a missing `displayName`. |
| U7 | **Address-bar scrub.** | `/login#invite=<code>` → `/login`; `/login?x=1#invite=<code>` → `/login?x=1`; `/login` → `/login`. The result never contains `#` or the code. |
| C1 | **Code on BOTH registration requests.** | Stub authenticator returning a fabricated registration response; recording `fetch`. With code `C`: exactly two requests in order, `POST /api/v1/auth/register/options` then `POST /api/v1/auth/register/verify`; each carries `x-invitation-code: C`; neither URL contains `C`; the verify body (the authenticator response as JSON) does not contain `C`; the options request has no body. |
| C2 | **Ordinary mode is byte-identical to today.** | With no code: the same two requests, neither carrying any `x-invitation-code` header (`has()` false, not `''`); the options init is `{ method: 'POST' }` and nothing more; the verify init is `{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(authenticatorResponse) }` and nothing more. |
| C3 | **The code is not spread wider than needed.** | Running the LOGIN ceremony while an invitation code is in hand: `login/options` and `login/verify` carry no `x-invitation-code` header. |
| C4 | **Options refusal stops everything.** | `register/options` answers the error envelope `{ success: false, error: { code: 'REGISTRATION_CLOSED', message: M } }` (status 403): the ceremony rejects with message `M`; the authenticator stub is called zero times; no `verify` request is made. |
| C5 | **Verify refusal surfaces.** | Options succeed, authenticator stub resolves, `verify` answers an error envelope with message `M2`: rejects with `M2`; a success-shaped body whose `success` is not `true` is also a rejection. |
| C6 | **Cancel does not consume or corrupt the retry.** | Authenticator stub throws a `NotAllowedError`-like error: rejects, no `verify` request. Calling the same function again with the same code afterwards issues the same correct two requests (no state mutated by the failed attempt). |
| C7 | **No client persistence in the ceremony module.** | With `globalThis.localStorage`, `globalThis.sessionStorage` and `globalThis.document` replaced by objects whose every property access throws, C1, C4 and C6 still pass. |
| I1 | **End to end through the real handlers.** | `bootstrapOwner()`, then the owner cookie POSTs `/api/v1/auth/invitations` with `{ displayName: 'Test User Two' }`; build the link from the response code, parse its hash with the page's reader, build headers with the page's header builder, run `register(authenticator, headers)` with a NEW authenticator and NO cookie: 200; a new `users` row with `is_owner` false and display name `Test User Two`; the returned session cookie resolves to that user, not the owner; `GET /api/v1/auth/me` with that cookie returns `isOwner: false`, `displayName: 'Test User Two'`; the owner's credential count is still 1; the owner's `me` is unchanged. |
| I2 | **Headerless is today's behavior.** | With a credential present, no cookie, headers from the page's header builder given no code: `register/options` and `register/verify` answer 403 `REGISTRATION_CLOSED`; `authCounts()` (users, credentials, sessions, bootstrap) unchanged. |
| I3 | **Owner opening the link enrols nobody for the owner.** | The owner's cookie AND a valid code together (what a signed-in owner's browser sends): refused on both endpoints; `authCounts()` unchanged; the owner's credential count unchanged; the invitation is still unconsumed (a later cookie-less redemption with a new authenticator succeeds and creates a user that is not the owner). |
| I4 | **Every dead code refuses with a readable message.** | Each of: a well-formed 22-character code that matches no row; a 21-character code; a consumed code (redeemed once); an expired code (`created_at` and `expires_at` moved into the past by SQL); and an EMPTY-STRING header value: HTTP 403, `error.code === 'REGISTRATION_CLOSED'`, `error.message` a non-empty string, `authCounts()` unchanged. |
| I5 | **No leak into logs or other responses.** | `vi.spyOn` on `console.log`, `console.info`, `console.warn`, `console.error` and `process.stdout.write` / `process.stderr.write` across: invitation creation, a successful redemption, and the refusals of I3 and I4. No captured argument contains the raw code or its SHA-256 hex. The bodies and headers (including `Set-Cookie`) of the `register/options` and `register/verify` responses do not contain the code. The create response carries `Cache-Control: no-store`. |
| I6 | **The control's visibility follows the real `me`.** | The page's visibility decision applied to the parsed body of `GET /api/v1/auth/me` is `true` for the owner's cookie and `false` for the second user's cookie; a second-user `POST /api/v1/auth/invitations` is refused with zero rows inserted. |
| B1 | **Owner creates and sees the link once.** | Browser profile A holds the seeded owner session. On a desktop-width page and on a 390-pixel-wide page (control reachable from the drawer) the owner finds the control, types `Test User Two`, submits, and sees a link whose `URL.search` is `''`, `pathname` `/login`, `hash` non-empty, and the server's `expiresAt` shown. While the request is in flight the submit control is disabled. After dismissing the panel, no element in the document contains the code, and `localStorage`, `sessionStorage` and `document.cookie` of profile A contain no occurrence of it. |
| B2 | **Invitee onboards on another device.** | Profile B (no cookies, own virtual authenticator) opens the link. Immediately after load and before any click, `location.hash` is `''` and `location.href` contains no code. The invitee takes the register action in invitation mode; the ceremony completes; the browser lands on the standard post-sign-in page; `fetch('/api/v1/auth/me')` from that page returns `displayName` `Test User Two` and `isOwner` `false`; the sidebar shows that name; `psql` shows a second `users` row, `is_owner` false, and the new credential belonging to it. Pressing Back does not return to a URL containing the code. |
| B3 | **No leak in the browser.** | CDP network log of profile B across B2: every request URL lacks the code; no request has a `Referer` containing the code; only `register/options` and `register/verify` carry `x-invitation-code`; no request goes to an origin other than `http://localhost:3000`. `localStorage`, `sessionStorage` and readable cookies of profile B contain no occurrence of the code. The recorded dev-server output contains zero occurrences of the code (`grep -c`). |
| B4 | **Single use in the browser.** | Profile C (fresh) opens the same, now consumed, link: a refusal message is visible, the virtual authenticator holds zero credentials, `users` count unchanged. |
| B5 | **Malformed link.** | Profile D opens `/login#invite=short`: a refusal message is visible and the network log shows no request to `register/options`. |
| B6 | **Owner opening an invite link on the owner's own browser.** | Profile A opens a freshly minted valid link while signed in as the owner: a refusal is shown, `webauthn_credentials` for the owner is unchanged, `users` count unchanged, the invitation is still unconsumed. |
| B7 | **Ordinary `/login` is unchanged.** | Profile E (fresh) opens `/login` with no fragment: both existing buttons ("Sign in with a passkey", "Register this device") and the existing explanatory text are present, no invitation UI is shown, and "Register this device" yields the existing closed-registration refusal (credentials exist) with the request carrying no `x-invitation-code`. |
| B8 | **Non-owners never see the control.** | In profile B (second user) on desktop and 390-pixel widths, on `/dashboard` and one other page: the invite control is absent from the DOM. In profile A it is present. |
| B9 | **Referrer policy on the login page.** | The `/login` response carries `Referrer-Policy: no-referrer`, or its HTML contains `<meta name="referrer" content="no-referrer">`; either satisfies. Checked with `curl -s -D - http://localhost:3000/login`. |

## Acceptance commands
All from the repo root. `U=postgresql://localhost/b8_p41a2_throwaway`, fresh and migrated (T2). BASE is T5's recorded unit baseline.

| # | Command | Expected |
|---|---|---|
| 1 | `(cd apps/web && npx tsc --noEmit; echo "exit=$?")` | `exit=0` |
| 2 | `npm run lint; echo "exit=$?"` | `exit=0`, no warning count above the pre-change count |
| 3 | `npm test 2>&1 \| tail -8` | 0 failed; tests passed strictly greater than BASE tests (the U and C scenarios add at least 14); test files ≥ BASE files + 2; no existing unit test removed or weakened |
| 4 | Unit scenario run, below | `OK 14 scenarios U1-U7 C1-C7 each present once and passed` |
| 5 | Integration scenario run, below | `OK <n> tests, I1-I6 each present once and passed` |
| 6 | The integration command from #5 (without the node checker) run twice in a row | the same set of failing titles both times, and every failing title is in KNOWN ∪ {RC-03} |
| 7 | Static discipline greps, below | exit 0, no output |
| 8 | Server-untouched guard, below | no output, exit 0 |
| 9 | `node apps/web/scripts/onboarding-browser-check.mjs; echo "exit=$?"` | nine lines `B1 PASS …` to `B9 PASS …`, a final line `OK B1-B9`, `exit=0` |

**#4 (unit scenarios).**
```
set -e; O="$(mktemp)"; (cd apps/web && npx vitest run lib/invitationLink.test.ts lib/passkeyCeremony.test.ts --reporter=json --outputFile="$O") || true
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);let bad=[];const ids=[...Array(7).keys()].map(i=>"U"+(i+1)).concat([...Array(7).keys()].map(i=>"C"+(i+1)));for(const id of ids){const m=t.filter(x=>x.title.startsWith("T41a2-"+id+":"));if(m.length!==1||m[0].status!=="passed")bad.push(id+"="+m.map(x=>x.status).join("/")+"("+m.length+")")}const failed=t.filter(x=>x.status!=="passed").map(x=>x.title);if(bad.length||failed.length){console.log("FAIL",bad.join(","),failed.join(" ; "));process.exit(1)}console.log("OK 14 scenarios U1-U7 C1-C7 each present once and passed")' "$O"
```
Expected `OK 14 scenarios U1-U7 C1-C7 each present once and passed`, exit 0. A missing file, a skipped, duplicated or untitled scenario fails. A stub implementation fails because U1/U2/U4/C1/C2 assert on concrete values.

**#5 (integration scenarios; the whole integration config, so the KNOWN failures are named).**
```
set -e; O="$(mktemp)"; (cd apps/web && DATABASE_URL=postgresql://localhost/b8_p41a2_throwaway npx vitest run --config vitest.integration.config.mts --reporter=json --outputFile="$O") || true
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);let bad=[];for(let n=1;n<=6;n++){const m=t.filter(x=>x.title.startsWith("T41a2-I"+n+":"));if(m.length!==1||m[0].status!=="passed")bad.push("I"+n+"="+m.map(x=>x.status).join("/")+"("+m.length+")")}const KNOWN=["the pre-auth ceremony endpoints remain reachable with no session cookie at all","the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio","RC-03: an item whose accounts disagree on the cursor syncs from no cursor, whichever account the table returns first"];const unexpected=t.filter(x=>x.status==="failed"&&!KNOWN.includes(x.title)).map(x=>x.title);if(unexpected.length||bad.length){console.log("FAIL",unexpected.join(" ; "),bad.join(","));process.exit(1)}console.log("OK",t.length,"tests, I1-I6 each present once and passed")' "$O"
```
Expected `OK <n> tests, I1-I6 each present once and passed`, exit 0. KNOWN is exactly the two stale tests of QUEUE hold H4 (the `proxy.test.ts` pre-auth reachability title and the `overview` route title) plus RC-03, the order-dependent flake of hold H9; RC-03 may also pass, and that is not a failure. Any other failure, including any P7-41a scenario `T41a-S1`–`S17`, fails the gate. The previously passing `T41a-S17` (the `PRE_AUTH_PATHS` twelve-member check) is the guard that no pre-auth path was added.

**#7 (static discipline, weak by design; never the feature's evidence).**
```
F=$( (git diff --name-only "$(git merge-base HEAD main)" -- apps/web; git ls-files -o --exclude-standard -- apps/web) | sort -u | grep -E '\.tsx?$' | grep -vE '\.test\.|secondUserTestKit' ); echo "$F" | grep -q 'app/login/page.tsx' && ! grep -nE "localStorage|sessionStorage|document\.cookie|useSearchParams|searchParams|[?&]invite|[?&]code=|console\.(log|info|warn|error|debug)" $F
```
Expected exit 0 and no output. The first clause fails if the login page was not modified (a stub that never touches the page cannot satisfy this task). The second asserts the changed non-test sources neither persist client-side, nor read the code from a query, nor print.

**#8 (server-untouched guard).**
```
git diff --name-only "$(git merge-base HEAD main)" -- apps/web/app/api apps/web/lib/authSession.ts apps/web/lib/invitations.ts apps/web/lib/registrationGate.ts apps/web/lib/users.ts migrations db packages | grep -vE '\.test\.ts$|secondUserTestKit\.ts$'
```
Expected no output, exit status of the pipeline irrelevant (grep exit 1 on empty is expected). Any file listed is a non-goal violation.

Mutation expectations (G2/G3 apply one at a time; exactly the named scenarios must fail, then green after revert):
- Send the header only on `register/options`, or only on `register/verify`: C1 fails.
- Send `x-invitation-code: ''` when there is no code: U5 and C2 fail, I4's empty-header row documents why.
- Put the code in the query string (`/login?invite=…`): U1 fails (and #7).
- Send the header on login requests: C3 fails.
- Reader accepts a 21-character code or ignores the contract: U4 fails.
- Treat `'#invite='` as ordinary mode: U3/U4 fail.
- Show the control for `isOwner` truthy-but-not-`true`, or when `me` is null: U6 fails.
- Leave the fragment in the address bar after reading: U7 fails for the helper; the unit mutation where the page simply never calls the helper is caught only by B2/B3 — the orchestrator applies this mutation and must see #9 print a `FAIL`.
- Write the code to `localStorage`/`sessionStorage`: C7 fails if in the ceremony module, #7 fails if anywhere in changed sources; the orchestrator also applies it in the page and must see B1 or B3 FAIL.
- Swallow a `REGISTRATION_CLOSED` envelope so the page appears to succeed: C4 fails.
- Log the code in the page or in a test-kit-visible path: I5 fails.

## Negative controls
| # | Rule | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | The code never appears in the server-visible part of the URL | A link whose path or query contains the code | #4 (U1) |
| 2 | "No invitation" sends no header at all | An empty-string `x-invitation-code` | #4 (U5, C2); #5 (I4 empty-header row) |
| 3 | The code is sent on both registration requests, and only on them | Header on options only; header on verify only; header on login requests | #4 (C1, C3) |
| 4 | A present-but-unreadable invitation is refused, not treated as ordinary | `#invite=`, short, illegal characters, duplicate keys | #4 (U3, U4); #9 (B5) |
| 5 | Dead codes enrol nothing and say so | Unknown, 21-character, consumed, expired, empty-string | #5 (I4); #9 (B4) |
| 6 | A signed-in owner opening the link must not enrol anything for the owner | Owner cookie plus valid code | #5 (I3); #9 (B6) |
| 7 | Ordinary `/login` is unchanged | An ordinary request that carries an invitation header or alters the request shape | #4 (C2); #5 (I2); #9 (B7) |
| 8 | The control is owner-only | `isOwner` false, null, missing, truthy-but-not-true | #4 (U6); #5 (I6); #9 (B8) |
| 9 | The code is not logged or echoed | A console or stdio line, or a response body or header, containing the code or its hash | #5 (I5); #9 (B3) |
| 10 | The code is not persisted client-side | A write to local storage, session storage or a cookie | #4 (C7); #7; #9 (B1, B3) |
| 11 | The code is removed from the address bar | `location.hash` still holding the code after load; Back returning to it | #4 (U7); #9 (B2) |
| 12 | No third-party request and no leaking Referer from the login page | Any request to a non-`localhost:3000` origin; a Referer carrying the code | #9 (B3, B9) |
| 13 | The code is shown once | The code readable in the DOM or storage after the owner dismisses the panel | #9 (B1) |
| 14 | No server change, no new pre-auth path | Edits to handlers, libs or `PRE_AUTH_PATHS` | #8; #5 (`T41a-S17`) |

## Evidence required
- The final `OK` lines of #4 and #5, and the full output of #9 (nine PASS lines plus `OK B1-B9`), verbatim, with no code values.
- A mutation log: for each mutation above, the scenarios that failed, then green after revert. The orchestrator-applied browser mutations (fragment never scrubbed; code written to storage) must show #9 failing.
- Screenshots from the browser check, taken over fabricated data on the scratch database `b8_onboarding_check`: the owner's panel at desktop and at 390 pixels with the code visually blurred or cropped out, the invitee's page in invitation mode, and the refusal message. No real name, no real code in any committed file.
- Plain statement in EVIDENCE.md of what is and is not provable here: the fragment property (never reaching a server, proxy log or Referer) is a browser guarantee asserted by B2 and B3 against Chrome only; the production reverse proxy's access-log format and any header-logging configuration cannot be checked from this repo.

## Failure modes to test
- The code sent on `register/options` but not `register/verify`, or the reverse: options says yes and verify enrols a stranger, or verify refuses after the user already created a passkey. (C1, mutation.)
- The code placed in the query string because it is easier to read with `useSearchParams`, putting it in the Next dev log, any proxy log and the Referer. (U1, #7.)
- An empty-string header sent in ordinary mode, which the server treats as "presented" and refuses; ordinary registration and the owner's add-a-device flow break. (U5, C2, I4.)
- The invite link opened by the signed-in owner sends the cookie and the code together; a "helpful" fallback that retries without the code, or with the cookie only, enrols a passkey for the OWNER instead. (I3, B6.)
- The invite control rendered for the second user, for a failed `me` (null treated as owner), or for a loosely truthy value; or rendered in the drawer but not the sidebar (or the reverse). (U6, I6, B8 at both widths.)
- The control hidden but the request still possible: the server remains the gate, and the UI must not be the only check. Server tests S4 already cover this; do not weaken them.
- The fragment read during server rendering (`window` is undefined; `next build` or hydration breaks), or read once at module load so a later navigation within the page misses it. (B2.)
- The code left in the address bar, in browser history (Back returns to it), or in a bfcache snapshot. (U7, B2.)
- The code written to storage "to survive a refresh". The stated trade-off is that a reload loses it and the owner mints another. (C7, #7, B1, B3.)
- The page deciding a code is expired from the client clock, or showing the invitee's name taken from the link. (Non-goal; reviewer.)
- A double click on "create" mints two invitations and the first code is lost with its panel; the submit control must be disabled in flight. (B1.)
- The create call failing (401 because the session expired, 400, 403, network error) shows a readable error and NO link; a half-formed link must never be displayed. (B1 error branch reviewed by the reviewer's falsification log; no automated browser step covers a failed create, so this is stated as unproven by command.)
- Float-free: no amounts exist here; any amount appearing is a defect.
- A refusal that exposes which axis failed (expired versus consumed versus unknown). The server returns one refusal; the UI must show that message and not invent a more specific one.
- The error text rendered as raw JSON or `undefined` when the envelope's `error.message` is absent. (C4, C5.)
- `zod` or the contracts' runtime validators pulled into the shell bundle by the sidebar's invite control, against the existing comment in `Sidebar.tsx` that the shell avoids it; the control uses a structural check on `me` and on the create response. (Reviewer.)
- A user with a stale service-worker cache seeing an old `/login` in dev. The browser check starts from fresh profiles, so this is not covered; note only.
- Ceremony module extracted but the page still using its old inline copy, so the unit tests pass against dead code. (#7 requires the login page changed; C-scenarios are meaningful only if the page imports the module — B2 and B3 are the proof, and the reviewer checks the import.)
- Any real name or any money figure in a tracked file; any real code in EVIDENCE.md.
- The test kit extended in a way that weakens an existing assertion.

## Rollback
No migration and no contract: revert the commit (login page, owner control and any component it lives in, the extracted ceremony and link modules, their tests, `onboarding-browser-check.mjs`, and any `Referrer-Policy` setting). Invitations already minted through the UI remain valid in the database until their server-side expiry, and no endpoint or screen revokes one; if a link is believed leaked before then, the remedy is on the owner's database directly (expire the row), not part of this rollback. A second user who already redeemed a link stays enrolled; removing them is the existing `POST /api/v1/auth/users/[id]/revoke`.
