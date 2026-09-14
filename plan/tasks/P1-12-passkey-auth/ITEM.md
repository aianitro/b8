# Roadmap item — P1-12-passkey-auth

**Lineage:** ROADMAP.md §5 Phase 1, step 12. Orchestrator's reading.

> 12. **Passkey/WebAuthn auth** (SimpleWebAuthn): registration, login, Postgres sessions,
> access+refresh tokens for future mobile; `mutation_audit_log` lands in the same change; host-guard
> allowlist test flips from "Tailscale hostname rejected" to "accepted." (M)

**Position.** P1-10 and P1-11 merged 2026-09-12/13. Phase 1's exit — *"`curl` with a bearer token
returns everything the dashboard needs; UI fully on v1"* — needs the bearer token this step issues.

## This is the highest-risk task in the roadmap so far, and it should be treated that way

Every task before this one changed what the app *computes*. This one changes **who may reach it**.
The distinction matters for how the gates are run: a wrong figure is visible on a screen, and a
wrong auth boundary is visible to nobody until it is used.

**It is the exact opposite of an A8 tier-down candidate.** BUILD.md §15's new amendment lets a task
skip a blocking adversarial gate when it touches no contract, no migration, no outbound surface and
no money arithmetic. This task touches a migration, a contract, the process boundary *and* the
reachability boundary. **Full ceremony, and the spec should expect the adversarial gate to earn its
cost here more than anywhere yet.**

**Run `/security-review` on the diff before G3**, in addition to the adversarial reviewer, and
record it in `GATES.md`. The two look for different things: the reviewer falsifies against the spec,
the security review looks for the class of defect a spec does not think to forbid.

## Measured state before scoping — nothing here exists yet

```
@simplewebauthn/server   not installed
sessions table           absent
mutation_audit_log       absent
app/api/**/route.ts      28 routes
middleware.ts            host guard active, ALLOWED_HOSTNAMES = localhost, 127.0.0.1, [::1], 0.0.0.0
```

`lib/hostGuard.ts` is a pure predicate with its own tests; `middleware.ts` returns 403 for anything
else and matches every path except Next's static assets. **All 28 routes are currently unauthenticated
and reachable by anything that can send a request to 127.0.0.1** — which the guard's own comment
already says plainly, since a same-machine attacker satisfies it.

## The sizing concern, recorded before the spec is written

As written, step 12 bundles **five separable changes** behind one (M):

1. **Passkey registration + login** — SimpleWebAuthn, the credential table, the ceremony endpoints.
2. **Postgres sessions** — a session store, cookie handling, expiry, revocation.
3. **Access + refresh tokens for future mobile** — a second auth mode, for a client that does not
   exist until Phase 3.
4. **`mutation_audit_log`** — a contract change whose first real consumer is Phase 4's write-capable
   agent tools.
5. **The host-guard flip** — admitting a Tailscale hostname, which is the change that actually
   widens reachability.

P1-10 was split for less. **The orchestrator's disposition, for the spec to accept or argue with:**

- **(1), (2) and (5) belong together and must not be separated.** §5's standing rule is explicit:
  *"passkey auth ships in the same change as any reachability change."* Shipping the flip without
  the auth, or the auth without the flip, is the failure the rule exists to prevent.
- **(3) is deferrable and probably should be.** It exists for a client that Phase 3 cannot start
  before the Month 7 harness. A token format designed against no consumer is a contract frozen on
  guesswork — the exact argument P1-10's ITEM.md made about defining `/overview` before the
  dashboard was re-pointed. If the spec keeps it, it must say what fixes the shape.
- **(4) is a contract change with no consumer in this task.** It is cheap and additive, and there is
  a real argument for landing the table before anything writes — but "it lands in the same change"
  should be a decision with a stated reason, not inherited from a sentence.

## The question the spec must answer first

**Which of the 28 routes are protected, and what happens to the 27 that are not `/api/v1/*`?**

The roadmap's Phase 1 exit says the UI ends up fully on v1, but `P1-10b` — the migration of the
other 26 handlers — is a queued successor that has not started. So this task lands auth into a tree
where one route is v1 and 27 are not. Three options, and the spec picks one with reasoning:
protect everything, protect only v1, or protect everything except an explicit allowlist. **Silence
here is the dangerous answer**, because the default is whatever the middleware matcher happens to do.

## Contracts touched — expected

`migrations/**` and `db/schema.sql` (new: credentials, sessions, and — if kept — `mutation_audit_log`),
`shared/types.ts`. Guardian work; **G1 runs.** Forward-only migration discipline (§9.3) applies.

## What this task must not do

- Not the remaining 26 routes' v1 migration (`P1-10b`).
- Not rate limiting (step 13).
- Not the dashboard's adoption of `/overview` (`P1-11a`).
- Not multi-user or household sharing — single user, and the schema should not pretend otherwise
  without a reason.

## A note on this session's pattern, for whoever writes the spec

Two tasks in a row failed G0 on controls that measured a proxy rather than the rule, and a proposed
Phase 0.6 was withdrawn because four of its five steps did not survive being checked against the
database. **Check every claim in this ITEM.md against the tree before building on it.** The numbers
above were measured on 2026-09-13 and are exactly as trustworthy as their age.
