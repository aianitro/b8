# NITS — P1-12-passkey-auth

Five findings from the adversarial review, none blocking, plus one carried from the security review.
**N1 is the one worth acting on**, and it generalises past this task.

## N1 — acceptance #20 no longer isolates what it names, and the shape is new
The AST script ORs `csprng` across every `lib/` file the diff adds. `lib/webauthnTestFixtures.ts`
calls `randomBytes` three times, so `HAS_CSPRNG=true` is now provable by a **test fixture**. A
session token built from `Date.now()` would satisfy #20 *and* F5 — which measures distinctness,
length and alphabet, not entropy — and therefore all 40 commands.

Measured: `SESSION_TOKEN_CSPRNG=true`. **The code is correct; the control is not.** Fix is to scope
the assertion to the module that generates the token.

**Why this is worth an amendment rather than a one-line fix.** A10 asks *what does this command
measure, and is that the rule or a proxy* — at G0. This spec passed that question honestly, because
when it was written no other `lib/` file called a CSPRNG. **The implementation removed the control's
teeth by adding a file that satisfies it.** Nothing in the process asks the question a second time,
against the diff that exists rather than the tree that did. Eighth instance of the class across four
tasks, and the first of this sub-shape.

## N2 — clone detection is wired but unguarded
`verifyAuthenticationCeremony` feeds the stored `sign_count` to the library, which throws on a
non-advancing counter, and `recordSignCount` advances it with `GREATEST`. Correct today. But no
fixture exercises a **non-zero** counter, so changing `counter: credential.signCount` to `counter: 0`
— or deleting the `recordSignCount` call — leaves all 40 commands green while clone detection goes
inert for every counter-implementing authenticator. A hardware key at counter 5 could be replayed
indefinitely. One pure fixture (stored counter 5; replay at 5 refused, advance to 6 accepted) closes
it. SPEC.md names this failure mode and issues no command for it.

## N3 — `proxy.test.ts:125` pins a boundary with a one-second window
`seedSession({ expiresIn: '1 second' })` then asserts the session is still admitted, to pin `>` versus
`>=` — a distinction with no visible symptom either way, which is exactly why it is worth pinning.
But more than a second between the INSERT and the pooled SELECT turns it red with no defect behind
it. Five consecutive runs passed here; a loaded CI runner is the risk. A `'1 hour'` row proves the
same half-open interval deterministically.

## N4 — the challenge cap's comment says "per ceremony kind"; the code is global
`rememberChallenge` compares the **global** map size against `MAX_OUTSTANDING` and evicts the
globally oldest entry, so 64 outstanding registrations can evict an authentication challenge while
`outstandingChallenges('authentication')` reports 0. Behaviourally benign — eviction refuses a
ceremony, never admits one — but the comment states a property the code does not have, and the
eviction path has no fixture.

## N5 — `lib/db.ts` has no pool `'error'` listener, and the blast radius just changed
A Postgres restart emits `'error'` on an idle client; `pg`'s Pool re-emits it, and with no listener
Node terminates the process. Pre-existing and outside this task's declared surface — but this diff
moves the pool from "some route handlers" to **every page view and every API call**, so what was a
narrow failure is now total. Follow-up task, not an edit here.

## N6 — the proxy imports a shared module, which the framework docs advise against
`node_modules/next/dist/docs/…/proxy.md` states you should not rely on shared modules or globals in
the proxy, since it may be deployed separately from render code. This proxy imports `lib/authSession`
→ `lib/db` → a `pg.Pool`, and argues for it explicitly. Raised by the security review as an
architecture note, not a vulnerability, and it fails closed if the assumption breaks. **Phase 2 step
19 is where this gets tested for real**, when the app first runs somewhere other than one process on
a laptop.

## Outstanding, and not a nit — the owner's
Evidence #3: nobody has confirmed a real platform authenticator completes registration and login in a
real browser. The live run against fabricated payloads over HTTP is a different claim and is recorded
as one in EVIDENCE.md §7. **Must run on port 3000** — `PRIMARY_RP_ID` is `localhost` and
`EXPECTED_ORIGINS` contains `http://localhost:3000`. Until then the ceremony is proven against
fabricated inputs only.
