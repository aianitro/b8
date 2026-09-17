# Roadmap item — P1-12a-mobile-tokens

**Lineage:** ROADMAP.md §5 Phase 1, step 12's deferred third part. Orchestrator's reading.

> 12. **Passkey/WebAuthn auth** … **access+refresh tokens for future mobile** …

Deferred by P1-12's SPEC.md with a reason that has now expired:

> **(3) mobile access+refresh tokens are deferred.** No client exists before Phase 3, so a token
> format designed today is frozen against guesswork.

A client now exists in intent: the owner stated on 2026-09-15 that they are moving towards a mobile
app, and on 09-17 chose to settle this before `P1-10b`. The deferral was right and is now spent.

---

## The part of the roadmap line I think is wrong

**"access+refresh" is convention, not a requirement this app has.** The pattern exists so that an
access token can be SHORT-LIVED AND STATELESS — a JWT the server validates by signature without a
database round trip — with a refresh token as the revocable thing behind it. The split buys exactly
one property: revocation without per-request lookups.

This app already does per-request lookups. `lib/authSession.ts` resolves every request against
`auth_sessions` by primary key, and `revoked_at` makes revocation instant. So a refresh token here
would add a second token, a second endpoint, rotation, and the replay-detection question that
rotation creates — to buy a property the design already has.

**DECIDED 2026-09-17: one opaque token, revocable, with a sliding expiry.** The owner accepted the
argument. If a stateless access token is ever wanted it is a later optimisation with a measurable
trigger — per-request database lookups becoming a cost anyone has measured — not a starting shape.

This contradicts a roadmap line. It is written down here rather than quietly done, and ROADMAP.md
§5 step 12 should be amended to match rather than left describing a design nobody built.

---

## What should NOT change, because it is already right

`lib/sessionToken.ts` and `auth_sessions` are the correct machinery and the mobile path should reuse
them rather than grow a parallel one:

- 256 bits of CSPRNG, base64url.
- SHA-256 in the database, enforced by `CHECK (token_hash ~ '^[0-9a-f]{64}$')` — so storing a raw
  token is a statement Postgres refuses, not a convention a caller can forget.
- `expires_at` and `revoked_at` already there; a lost phone is one `UPDATE`.

A second token table would be a second answer to "is this caller allowed in", which is the class of
duplication this repo has been bitten by before.

---

## Three decisions, with what I would do

### 1. How the phone gets its first token

- **(a) WebAuthn from the native app.** iOS and Android both support passkeys natively; the app runs
  the ceremony against the endpoints that already exist. **No new way in.** Costs: the native app
  must implement platform credential APIs, and passkeys bind to a domain, so the relying-party id
  has to be the tailnet hostname and the app needs the associated-domains / asset-links files served
  from it.
- **(b) Pairing code.** Sign in on the web, the server shows a short-lived one-time code, the phone
  redeems it for a token. Much less native work. **Costs: a second credential path into the app** —
  a code that grants full access, which must be short-lived, single-use, rate-limited and displayed
  only to an already-authenticated session.

**DECIDED 2026-09-17: (a).** The owner chose the passkey ceremony. Every credential path is permanent
attack surface and the app already has one that works; (b) stays available if the native work proves
too slow, but it is then a decision made against real effort rather than against a guess.

**What (a) obliges, recorded so it is not discovered by the mobile developer:** passkeys bind to a
domain, so `PRIMARY_RP_ID` must be the tailnet hostname before a phone can register, and the tailnet
host must serve `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`. That
is a Phase 2 step 19 dependency this task inherits — the server has to exist and be named before a
phone can sign in at all.

### 2. Is a phone's token the same kind of thing as a script's?

**No, and conflating them is the mistake worth avoiding.** Month 4's Python eval runner needs to
reach `/api/v1/chat` with no browser and no human — the gap P1-12's SPEC.md recorded. That is not a
sign-in; it is a credential the owner mints deliberately, names, and can look at in a list.

Two kinds, one table, distinguished by a column:

| | how it is obtained | lifetime | revoked by |
|---|---|---|---|
| phone session | passkey ceremony from the app | sliding, ~30 days idle | signing the device out, or the list |
| personal token | minted in the UI, shown once | until revoked | the list |

**A personal token should be able to be read-only**, because the eval runner does not need write
access and the whole point of Month 5's agent-authorization work is that credentials should not carry
authority they do not use.

### 3. How long a phone session lives

The web session is 12 hours, which is right for a browser and wrong for a phone — an app that signs
the owner out every twelve hours gets deleted. **A sliding window: valid 30 days from last use,
refreshed on each authenticated request.** The refresh is one `UPDATE` on a row already being read.

---

## Out of scope

- Not the mobile app itself (Phase 3).
- Not multi-user: a token belongs to the single owner, as credentials already do.
- Not OAuth or third-party sign-in.
- Not JWT. See above; if it ever arrives it needs a stated trigger.

## Contracts touched — expected

`migrations/**` and `db/schema.sql` — `auth_sessions` gains a kind and a label, and a personal token
needs a name and a scope. `shared/contracts/auth.ts` gains the token-issuing shapes. **G1 runs.**

## How this should be built

**Full ceremony, and `/security-review` before merge, exactly as P1-12 had.** This widens who may
reach the app — the same category as step 12, which is the one place in this codebase where a wrong
answer is invisible until it is used. The bearer path in particular removes the browser's own
protections: a cookie is `httpOnly` and `sameSite`, and a header is neither.

---

## The security review, and what it found — 2026-09-17

`/security-review` ran on `git diff main...auth/mobile-tokens` before the merge, as this ITEM.md
required. One finding, HIGH, confirmed by a second pass that read the code independently.

**A read-only token could enrol a passkey and walk away with full, permanent access.** The two
`register/*` paths are in `PRE_AUTH_PATHS`, so `proxy.ts` returns `NextResponse.next()` for them
*before* `authorize` runs — and `authorize` was the only place `scopePermits` was applied. The
handlers then looked the session up themselves through `credentialFrom`, which this task had taught
to accept bearer tokens and which asked only whether a session existed. So a `read` personal token
counted as authority to enrol, and the reply to a registration is a full-scope session plus a
credential that keeps working after the token is revoked. The scope check existed; it simply did not
run on the two paths where it mattered most.

**Fixed in the two places the mistake was possible, not in the two routes that showed it.**

1. `credentialFrom` applies `scopePermits` itself. Its old comment — "the boundary already made it"
   — was true of every path except the five that skip the boundary, and that is the whole bug. A
   future handler on an allowlisted path can no longer inherit the hole by calling it.
2. `registrationDecision` takes **the session**, not a `hasValidSession` boolean each route derived.
   `sessionMayEnrol` is the rule: full scope, and a browser or device session. A personal token is
   refused even at full scope — a script has no passkey to enrol, and a credential minted through
   one would outlive `npm run tokens -- revoke`, which would quietly stop meaning what it says.

Registration's bootstrap window is unchanged: while zero credentials exist it is open to anyone, and
a token buys nothing extra there.

**Proved:** 759 unit tests and 49 integration tests on a scratch database. The new integration block
runs the attack — options, then a fabricated ceremony — with a read token and a full personal token,
and asserts `REGISTRATION_CLOSED` from both endpoints, no new credential, and no new session. One
test enrols a second device from a phone token, because that is the path the fix must not break.
