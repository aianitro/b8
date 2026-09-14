# GATES — P1-12-passkey-auth
<!-- Append-only audit trail. -->

| Gate | Result | When | Evidence |
|---|---|---|---|
| G0 spec | **FAIL** (cycle 1) | 2026-09-13 | Strong spec — it answered the scope question, found a deprecated file convention, and named the defect that matters most. Three fixture-count commands pass vacuously against the current tree. `.frozen` NOT created. |
| G0 spec | **PASS** (cycle 2) | 2026-09-13 | All three fixed, and the spec-writer found a fourth instance of the same defect itself and dropped it. 40 commands, both floors now measured non-vacuous. `.frozen` created. |
| G1 contract | **PASS** (cycle 1) | 2026-09-14 | Every checklist item green. **The TOCTOU closure proved by executing it**, and `db/schema.sql` proved to reflect the migration by building a second database from it and diffing. Lease closed. |
| G2 build | **PASS** (cycle 1) | 2026-09-14 | All 40 re-run by the orchestrator after the spec row was restored. `614 passed` pure (up from 598), 13 integration, both floors clear, 23 title gates exact. Every named fixture opened. |
| security review | **CLEAN** | 2026-09-14 | Nothing at confidence 8+. Matcher coverage machine-checked against all 49 routes; bypass shapes probed; origin binding traced; every statement parameterised. Ruled out with reasons rather than silence. |
| G3 adversarial | **ACCEPT_WITH_NITS** (cycle 1) | 2026-09-14 | 35 hypotheses, 30 refuted, 5 nits, 0 blocking, 0 scope violations. All 3 executable items run by the orchestrator; one corrected the orchestrator rather than the diff. |
| G4 integration | **PASS** | 2026-09-14 | `614 passed (39 files)`, tsc/build/`npm ci` `exit=0`, 13 integration, migrate `0,0,0`, 2 new tables / 0 alters, scope `0`/`0`. |

**Cycle count:** 0 / 3

## What the spec got right, recorded before the findings

- **It answered ITEM.md's open question, and argued it.** Protect everything minus five named surfaces, on the ground that gating only `/api/v1/*` would leave 27 routes and every page exactly as reachable as today — a worse posture the moment this task's own host-guard flip admits a second hostname.
- **It found a deprecated convention nobody had noticed.** `middleware.ts` was renamed to `proxy.ts` in Next 16. Verified: the installed docs say *"The `middleware.js` file convention has been **deprecated** in Next.js 16 and renamed to `proxy.js`"*, and `proxy` defaults to the Node runtime, which is what makes a session lookup at the boundary possible at all. `AGENTS.md` asks every task to read those docs; this is the first to do it and find something.
- **It named the crown-jewel defect, which the orchestrator had not.** A registration ceremony left permanently open lets the first unauthenticated visitor after deploy enroll their own passkey and own the app. Registration is open only while zero credentials exist; I2/I3 are that rule.
- **It deferred two of the five bundled pieces with reasons rather than inheritance**, and flagged a real sequencing conflict it refused to paper over: Month 4's Python eval-runner targets `/api/v1/chat` before Phase 3, and a browser-only ceremony has no path a script can complete. It declined to invent a third auth mode for it and recorded the conflict as a planning decision.
- **It qualified the urgency honestly** — the host flip is not live risk today because the server binds `127.0.0.1`; the point is that Phase 2 must not have to invent this boundary under time pressure.

**Every toolchain row verified by the orchestrator:** T1 `1` (and the deprecation notice read directly); T2 exports present; T3 `function function function`; T4 `5.9.3`; T6 `['shared/contracts/', 'migrations/']`. **Structure:** acceptance rows contiguous `1..42`, negative controls `1..14`, every `acceptance #N` pointer in range. **A9 clean** — zero existence-only commands, which the spec claimed and which checks out.

## The findings — three commands that pass against the tree as it stands

**D1 — #7 is vacuous, and it is the task's own fixture-count gate.** `⟨P⟩` is defined as
`npx vitest run --reporter=verbose`, the **whole** pure suite. Measured now:

```
$ npx vitest run --reporter=verbose | grep -cE "✓"    → 598
$ test 598 -ge 12 && echo OK                          → OK
```

It prints `OK` today, before a line of this task exists, and would keep printing `OK` if the
implementer wrote none of F1–F13. P1-11 solved exactly this by scoping its abbreviation to a single
test file; this spec widened it and lost the property.

**D2 — #21 has the same defect, milder, and is currently non-vacuous only by one.** `⟨I⟩` is the
whole integration run, which is `10` today from P1-11's fixtures. `-ge 11` therefore passes as soon
as the implementer adds **one** fixture, while claiming to prove eleven.

**D3 — #39 passes today and cannot fail.** The command asserts the integration config's include
reaches this task's tests. `vitest.integration.config.mts:35` already reads
`include: ['app/api/v1/**/*.test.ts']`, written by P1-11, which already matches
`app/api/v1/auth/**`. Measured: prints `OK` now. It proves a property P1-11 established, not
anything about this task.

**All three are the same class**, and it is the class §7.1's vacuity rule exists for: a count taken
over a population this task does not own. The spec applied A9 correctly and stated so; A9's sibling
question — *would a stub satisfy this?* — was not asked of the three commands where the answer is
yes.


---

## G0 cycle 2 — PASS

**All three findings fixed, and the fix is better than the instruction.** I asked for the two
abbreviations to be scoped and for #39 to be replaced or dropped. The spec-writer scoped both, then
applied the question I gave it — *would a stub satisfy this, and what population is this count taken
over* — to the rest of its own table and **found a fourth instance nobody had reported**: the
scratch-database guard re-fire command, which proved only that P1-11's `setupFiles` mechanism works,
not anything this task adds. It dropped both rather than patch them, on the ground that #22–#32
cannot pass unless the config reaches the new files, so the structural checks were restating a fact
the behavioural ones already prove.

Net: 42 → 40 commands, none added in their place.

**Both floors re-measured against the current tree, and both now fail as they must:**

```
⟨P⟩  (4 named files, 3 of which do not exist)   →  9 checkmarks,  floor 20  → no OK
⟨I⟩  (3 named files, none of which exist)       →  0 checkmarks,  floor 11  → no OK
```

The `⟨P⟩` floor deliberately includes `lib/hostGuard.test.ts`'s 9 pre-existing blocks, because F1 is
a *change to* one of them rather than a new file — so 9 of the 20 are inherited and 11 must be
written. That is disclosed in the Expected column rather than hidden in the arithmetic.

**Structure re-checked after the renumber:** acceptance rows contiguous `1..40`, every
`acceptance #N` pointer within range, negative controls unchanged at `1..14`.

**The class is now at seven instances across three tasks** — substring-vs-import, path-prefix-vs-
contract-surface, version-pattern-vs-range, file-walk-vs-module-graph, config-include-vs-behaviour,
and the two floors here. A10 was written this morning after the first four. It caught these two at
G0 rather than at G1 or G3, which is the first time the amendment has paid for itself, and the
spec-writer catching the fourth unprompted is the second.

`touch plan/tasks/P1-12-passkey-auth/.frozen`.


---

## G1 cycle 1 — PASS

| §7.2 checklist item | Result |
|---|---|
| Diff minimal, confined to the contract surface | `db/schema.sql` modified; one new migration; `shared/contracts/auth.ts` new. Nothing under `app/`, `lib/`, `components/` |
| Change class matches (§9.2) | additive throughout |
| `migrate:up && down && up` on a throwaway | `0`, `0`, `0`. **And the `down` verified to actually drop both tables** — count went to `0`, not merely "the command exited cleanly" |
| `db/schema.sql` reflects the migration | **proved, not assumed** — see below |
| No committed migration edited (§9.3) | `0` |
| `npx tsc --noEmit` | `exit=0` — this was the guardian's own stated risk (`z.looseObject`, eight uses, the one zod-4 surface this directory had not exercised). It compiles |
| Full suite | `598 passed (35 files)` |
| Lint | the one pre-existing warning, unchanged |
| Money `NUMERIC` / no stored current-value column | n/a — no money field. The sibling rule was honoured: both timestamps are `TIMESTAMPTZ` |
| Nullable-means-unknown preserved | expiry and revocation are **two columns**, `expires_at TIMESTAMPTZ NOT NULL` and `revoked_at TIMESTAMPTZ` nullable, not collapsed |
| Rationale in `CONTRACT.md` | present, with a rejections column throughout |
| Lease closed before the implementer is dispatched | closed |
| Layering (AST import parse) | `next/server` `0`, `pg` `0`, `lib/db` `0`, `lib/` `0`. Imports are `zod` and `./envelope` only |
| Exactly 2 new `CREATE TABLE`, 0 `ALTER TABLE` on a pre-existing table | `2`, `0` |

## The TOCTOU closure is real, and it was executed rather than argued

ITEM.md handed the guardian a question the spec framed as application logic: two concurrent
unauthenticated registrations both read "zero credentials" before either write lands. The guardian
answered it in the schema — `enrolled_via` with a **partial unique index** — and I ran it:

```sql
INSERT … enrolled_via='bootstrap'   → INSERT 0 1
INSERT … enrolled_via='bootstrap'   → ERROR: duplicate key value violates unique constraint
                                       "webauthn_credentials_one_bootstrap"
INSERT … enrolled_via='authenticated' → INSERT 0 1     (a second device is still allowed)
```

**At most one bootstrap credential can ever exist, whatever the interleaving.** The guardian was
also careful about what this does *not* do, and it is right: the database cannot see whether a
request carried a session, so a handler that tags a session-less enrolment `'authenticated'` still
enrols a stranger. That half remains I2's job. A schema constraint that closes the race without
claiming to close the rule is the correct division.

It chose `enrolled_via` over `is_bootstrap` because the latter is derivable ("the oldest row") and
therefore a stored derivation — §5.3's own operating rule — and breaks if the bootstrap credential is
deleted and re-enrolled.

## `db/schema.sql` reflects the migration — proved by construction

The guardian flagged this as the diff's riskiest unverifiable claim: it adds the schema's **first
`BYTEA` column, first `TEXT[]` column and first partial unique index**, three places a hand-maintained
reflection can differ invisibly. Checked the way P0.5-33 established — build a second database from
`db/schema.sql` alone and diff it against the migrated one:

| Comparison | Result |
|---|---|
| `schema.sql` loads standalone | `exit=0` |
| Columns (name, type, nullability), both tables | identical |
| Indexes, both tables | identical |
| CHECK and FK constraints, both tables | identical |

## Judgements worth recording

- **Session tokens are stored as SHA-256 hex** with `CHECK (token_hash ~ '^[0-9a-f]{64}$')`, so the
  raw cookie value is a string the database *refuses* — storage of the bearer itself is impossible
  rather than discouraged. Same idiom as `alert_sends.fingerprint`.
- **Logout is `revoked_at`, not `SET expires_at = NOW()`**, and the reason is a test-design one worth
  keeping: expiring-as-logout makes I8 and I9 the same test, so a no-op logout would reach the same
  state a few hours later and pass.
- **The validity predicate is pinned in both files** — `token_hash = $1 AND revoked_at IS NULL AND
  expires_at > NOW()`, three conjuncts, `>` not `>=`, **evaluated by Postgres, never in JS**. That
  last clause is P1-11's N4 defect pre-empted at the schema layer rather than rediscovered.
- **Contract objects are `z.looseObject`, deliberately opposite to the envelope's `strictObject`**,
  because a stripping schema would silently drop `response.transports` on the way to the verifier.
  The stated rule — *parse to refuse, never to reshape* — is the right one.
- **`rp.id`/`rpId` are required**, since the library makes them optional and an absent value has the
  *browser* infer it from the page: "derived from the request" arriving by omission.
- **No `user_id` on either table**, with the argument that matters rather than tidiness: with one,
  "zero credentials exist" becomes "zero *for this user*", which an unauthenticated request can only
  answer by naming a user it invents — and the unique index would have to be per-user, reopening the
  race it closes.
- **`shared/types.ts` unchanged**, for the same reason P1-11's guardian declined: `index.test.ts`
  requires one `CONTRACT_SCHEMAS` entry per exported name, and `index.ts` is not on the spec's
  declared file list, so taking the option would fail acceptance #2 with no in-scope repair.

## Three spec issues the guardian raised and correctly did not act on

1. **The allowlist names the `/login` page but not its static chunks.** Likely covered by the
   matcher's existing Next-asset exclusion, and the failure mode is a blank login page rather than a
   hole — **carried to G2** since the spec's own failure list names matcher narrowing.
2. **The Month-4 sequencing gap has a schema consequence the spec does not name.** When a
   non-browser auth path arrives, the honest shape is a second table, not a nullable `token_type` on
   `auth_sessions` and not a hand-inserted row pointing at a passkey that did not authenticate it.
   Recorded now, while `credential_id NOT NULL` is a fresh decision rather than an obstacle.
3. **Acceptance #35's `git diff HEAD -- migrations/` cannot see an untracked migration.** It reads
   `0` either way. **Carried to G2**: I will run it after `git add -N` so it passes for the right
   reason rather than by blindness.


---

## G2 cycle 1 — a defect in the frozen spec, and it is the orchestrator's, not the spec-writer's

The implementer reports 38 of 40, with #39 and #40 failing over exactly one file: `proxy.test.ts`.
Measured:

```
$ grep -c "proxy\.test\.ts" SPEC.md                    → 1   (the ⟨I⟩ definition, which REQUIRES it)
$ <the #40 scope command, run>                          → " A proxy.test.ts"
```

**The spec requires a file its own scope command rejects.** Next places `proxy.ts` at the repo root,
so its test has nowhere else to live, and #21 and #27–#32 cannot pass without it. There is no
in-scope repair available to the implementer, which is why it reported rather than worked around —
the correct response.

**The cause is a transcription error I made at G0 cycle 2, not a defect the spec-writer shipped.**
Its returned revision reads, in both rows:

```
…|app/login/|proxy\.ts|proxy\.test\.ts|middleware\.ts|…
```

When I applied the revision I renumbered the surviving rows `41→39` and `42→40` rather than
replacing them with the author's corrected text, which carried the *pre-revision* regex forward and
silently dropped `proxy\.test\.ts`. The spec-writer had already anticipated the file; I removed it.

**Disposition: the two rows are restored to the author's text, and the spec re-frozen.** This is not
"editing acceptance criteria to fit an implementation" — the rule §7.1 exists to enforce — because
the edit *restores* what the author wrote rather than changing what was asked for, and the author's
text is quoted above as the evidence. Recorded here before the change is made, so the sequence is
auditable rather than asserted. **No implementer cycle is consumed**; nothing about the diff changed.

**The wider lesson, which is mine to carry:** I hand-patched a frozen document instead of writing
the author's returned text wholesale, on a document whose entire purpose is to be the unedited
record of what was asked. The freeze mechanism protected the file from the implementer and from
later drift, and did nothing about the one actor who writes it. **Every future spec revision is
written from the author's returned text in full, never patched in place.**


**All 40 re-run by the orchestrator, after the restoration above.**

| Group | Result |
|---|---|
| #1 `tsc` / #3 lint | `exit=0`; the one pre-existing warning |
| #2 pure suite | `614 passed` — 598 at task start |
| #6 dependency | `@simplewebauthn/server@14.0.2`, resolved |
| #7 pure floor | `21` against a floor of `20` |
| #21 integration floor | `13` against `11`, exit `0` |
| #8–#19, #22–#32 title gates | all 23 exactly `1` |
| #20 AST | `NO_MATH_RANDOM=true HAS_CSPRNG=true` |
| #33 boundary moved | `D middleware.ts` / `A proxy.ts` — one boundary file, not two |
| #34–#37, #39–#40 scope | `0` throughout |

**The vacuity commitment is discharged.** 34 fixtures scanned across the seven test files; only two
carry a single assertion, and **both are pre-existing `hostGuard.test.ts` blocks**, not this task's.
Every fixture this task wrote carries two or more.

**The crown-jewel fixture is stronger than the spec asked for**, and it is worth quoting why. I2
seeds an incumbent credential, then exercises **both** registration endpoints — *"either one left
open is the defect; `options` would publish the enrolled credential list, `verify` would enrol the
stranger"* — and then asserts the **absence of a write**:

```
expect(rows).toHaveLength(1);
expect(rows.map(r => r.credential_id)).not.toContain(stranger.credentialId);
expect((await db.query('SELECT 1 FROM auth_sessions')).rowCount).toBe(0);
```

with the reasoning in place: *"a handler that enrolled the stranger as `'authenticated'` would
satisfy the partial unique index, return a plausible error, and still have handed the app away."*
That is precisely the gap between what the schema closes and what the rule requires — the division
G1 recorded — and the fixture closes it rather than restating it.

**Both G1 carry-overs are resolved.** The matcher's `_next/static` exclusion covers `/login`'s
assets, asserted via `unstable_doesMiddlewareMatch` and confirmed live at `200` on a real chunk. And
#35 was run after `git add -N`, over a visible 308-line migration diff, so it passes for the right
reason rather than by blindness.

**Three judgement calls the implementer raised rather than buried**, all carried to G3 for the
reviewer to rule on: page refusals are a 307 to `/login` while API refusals are a 401 (the spec's
failure list names per-page `redirect()` as the thing being replaced, which implies a redirect at
the shared boundary); `disableConsoleIntercept: true` in the integration config, because Vitest's
`stdout` header repeats a test title and inflated five title-gate counts to 2 or 3 while passing —
the alternative was deleting the auth logs; and three files added inside the allowlist but not named
in the spec's prose, each with a stated reason.

**Not performed, and not substituted for:** Evidence #3, the human confirmation that a real platform
authenticator completes the ceremony. The implementer has no browser and said so rather than
claiming a proxy for it. It ran a live `next start` against the scratch database driven by
fabricated payloads over HTTP instead — bootstrap, closed, login, forged origin, wrong key, logout,
replay — plus a fail-closed demonstration against an unreachable database. **That is a different
claim and is recorded as one.** The manual test must run on port 3000, since the configured origin
is `http://localhost:3000`.


---

## Security review — CLEAN

Run before G3 per ITEM.md, on the frozen diff. **No findings at confidence 8 or above.** It traced
every untrusted input — cookie value, ceremony JSON, `Host` header, request path — to every sensitive
operation, and recorded what it ruled out and why rather than reporting silence.

Settled with evidence: the matcher machine-checked against all 49 routes and pages; bypass shapes
probed (`../`, `%2e%2e`, doubled slashes, case) all failing closed; the single `try`/`catch`
terminating in a refusal on both branches; expected-origin and expected-RP-ID unreachable from any
request-shaped value; the registration gate applied in both endpoints before body parsing; 256-bit
CSPRNG tokens stored only as a hash the column's own CHECK enforces; all three session conjuncts
evaluated by Postgres; every statement parameterised.

**Two candidates it declined to inflate**, both correctly. The first-run enrolment window is the
intended design and not remotely reachable, because the browser enforces the RP-ID/origin
relationship. And the absent CSRF token is real but **not introduced here** — before this change
those handlers needed no cookie at all, so the diff strictly reduces exposure.

**One non-security note worth keeping:** the Next docs advise against relying on shared modules in
the proxy, since it may be deployed separately from render code. This proxy imports the `pg` pool and
argues for it explicitly. A deployment concern for Phase 2, and it fails closed if the assumption
breaks.

## G3 cycle 1 — ACCEPT_WITH_NITS

35 hypotheses, 30 refuted by reading, **0 blocking**, 0 scope violations. It ruled on all three
judgement calls the implementer raised and found each in scope: the 307/401 split leaks no existence
signal because the proxy runs before routing; `disableConsoleIntercept` changes only console
attribution; the three unnamed files are each forced by a spec requirement.

### The finding that matters — a control that stopped measuring its rule

**#20 no longer isolates the session identifier.** The AST script ORs `csprng` across every `lib/`
file this diff adds, and `lib/webauthnTestFixtures.ts` calls `randomBytes` three times. So
`HAS_CSPRNG=true` is now provable by a *test fixture*. Measured:

```
SESSION_TOKEN_CSPRNG=true                      (lib/sessionToken.ts really does call randomBytes)
randomBytes in webauthnTestFixtures.ts: 3      (which is what makes the gate unfalsifiable)
```

A session token built from `Date.now()` would print `NO_MATH_RANDOM=true HAS_CSPRNG=true` and pass
F5 as well, since F5 measures distinctness, length and alphabet — not entropy. **The shipped code is
correct; the gate is not.**

**This is the eighth instance of the proxy-not-rule class across four tasks, and the first of a new
sub-shape**: the spec was *correct when written*, and the implementation removed the control's teeth
by adding a second file that satisfies it. A10 asks the question at G0. Nothing asks it again after
the diff exists. Recorded as N1 and as a candidate amendment.

### The three executable items, all run — and one corrected me

| # | Question | Result |
|---|---|---|
| 1 | Is the session token itself CSPRNG-derived? | `SESSION_TOKEN_CSPRNG=true`. Code correct, gate weak |
| 2 | Does `disableConsoleIntercept` let a failing fixture satisfy its title gate? | **No.** A failing fixture prints its title twice (`×` line + `FAIL` header) → the gate reads `2` and fails correctly |
| 3 | Is I8's one-second expiry window flaky? | 5 consecutive runs, 5 passes. Real risk, did not reproduce |

**Item 2 is worth recording as an orchestrator error.** My first probe appeared to show a failing
fixture still reading `1`, and I was minutes from calling it a blocking defect. I had inverted the
wrong assertion — the one I replaced was I1's, not I2's — and then read I2's count, which was `1`
because I2 still passed. Re-measured: the failing fixture's own title reads `2`. **The reviewer's
reasoning was right and my measurement was wrong.** Recorded because a gate log that only preserves
the orchestrator's correct calls is a worse record than one that preserves both.

## G4 — PASS

| Check | Result |
|---|---|
| Full suite | `614 passed (39 files)` — 598 at task start |
| `tsc` / `build` / `npm ci` | `exit=0`, `exit=0`, `exit=0` |
| Lint | the one pre-existing warning |
| Integration suite | `13 passed`, exit `0` |
| Pure floor | `21` against `20` |
| Migrate up/down/up on a throwaway | `0`, `0`, `0` |
| Schema delta | `2` new `CREATE TABLE`, `0` `ALTER TABLE` on a pre-existing table |
| Scope #39 / #40 | `0`, `0` |

**Two G4 failures that were mine, not the diff's.** `tsc` and `build` first reported failure because
I ran `npm ci` in the same command sequence, so both executed against a half-installed tree —
re-run in order, both `exit=0`. And the migration round-trip first returned `1,1,1` because I omitted
the `createdb` the spec's own verbatim script performs; the database had been dropped by the previous
run's teardown. Run as written: `0,0,0`.

**#40 also caught a real sync duplicate** — `plan/tasks/P1-12-passkey-auth/.frozen 2`, the eleventh
today — which trips the quoted-path flaw recorded as P1-11's N3. Quarantined; `#40` returned to `0`.

**Evidence #3 remains outstanding and is the owner's.** No role in this pipeline has confirmed that a
real platform authenticator completes registration and login in a real browser. The live run against
fabricated payloads is a different claim and is recorded as one. It must run on **port 3000**, since
`PRIMARY_RP_ID` is `localhost` and `EXPECTED_ORIGINS` contains `http://localhost:3000`.

---

## Evidence #3 — 2026-09-14, partially discharged

**Registration on a real platform authenticator: CONFIRMED.** The owner enrolled a passkey against
the running dev server on port 3000 and the database holds the result:

```
webauthn_credentials  kf4u1_t6rtq6Derk7_2Xig  enrolled_via=bootstrap  2026-09-14 12:23:31.823267-07
auth_sessions         credential_id=kf4u1…    revoked_at=NULL         2026-09-14 12:23:31.823267-07
```

The bootstrap path is the one that was reasoned about hardest and it behaved as specified: the
window was open because the credential count was zero, and it closed on the same statement — a
second `POST /api/v1/auth/register/options` now returns **403 `REGISTRATION_CLOSED`**, measured.

**Login with an existing passkey: STILL OUTSTANDING.** The single session row carries the same
timestamp as the credential to the microsecond, so it is the one registration issues, not a
separate sign-in. Nothing has yet proved that an enrolled authenticator can complete the
authentication ceremony — which is a different code path with a different verifier call, and it is
the path the owner will use every day thereafter. No role in this pipeline can discharge it: the
ceremony requires the owner's biometric.

**To discharge it:** sign out, then sign in again at `http://localhost:3000/login` with
**Sign in with a passkey**. A second `auth_sessions` row with a later `created_at` is the evidence.
It must be `localhost` and not `127.0.0.1` — WebAuthn treats them as different origins and a
ceremony started on the wrong one fails with an opaque `SecurityError`.

### What this attempt found on the way, and what was done about it

The first attempt failed. The migration had never been applied to `b8_finance`, so the handler threw
on a missing relation, Next turned the throw into a **500 with an empty body**, and the login page's
`.json()` reported `Unexpected end of JSON input` — a message that names the parser rather than the
problem. `npm run migrate:up` applied the one pending migration.

**That is a gap in this task's own delivery, not only in its operation.** SPEC.md's rollback section
reasons carefully about applying the code and the migration together, and nothing in the gate log
checked that the migration had in fact been applied to the database the app runs against. The
merge was green because every suite runs against a scratch database that the harness migrates
itself. Recorded as a finding; the envelope fix that makes the next such failure legible is
`8e07eb4`.
