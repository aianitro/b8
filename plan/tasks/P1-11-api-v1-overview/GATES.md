# GATES — P1-11-api-v1-overview
<!-- Append-only audit trail. -->

| Gate | Result | When | Evidence |
|---|---|---|---|
| G0 spec | **FAIL** (cycle 1) | 2026-09-12 | Draft answers the scope question well and enumerates the payload from the running dashboard. Three findings, one of them a safety defect that would point a seeding test suite at real financial data. Draft NOT written to disk; `.frozen` NOT created. |
| G0 spec | **PASS** (cycle 2) | 2026-09-12 | All three findings fixed and re-verified by command. 44 acceptance commands (up from 39), 14 negative controls. `.frozen` created. |
| G1 contract | **PASS** (cycle 1) | 2026-09-12 | Every checklist item green. `shared/types.ts` untouched, and the guardian's reason for that is empirically confirmed. Lease closed. |
| G2 build | **PASS** (cycle 1) | 2026-09-12 | All 44 acceptance commands re-run by the orchestrator. 10 pure fixtures, 10 database-backed, `578` repo-wide. Every named fixture opened and confirmed to assert its titled rule. The safety control fires before any pool is constructed. |
| G3 adversarial | **BLOCK** (cycle 1) | 2026-09-12 | 37 hypotheses, 31 refuted, **2 CONFIRMED blocking**, 5 nits. Both blocks verified by measurement, not accepted on argument. Returns to implementer. |
| G2 build | **PASS** (cycle 2) | 2026-09-12 | Both blocks fixed. All 44 re-run: `594 passed` pure (up from 578), `10 passed` integration, #39 `OK`, scope `0`/`0`. Both fixes independently proved load-bearing. |
| G3 adversarial | **BLOCK** (cycle 2) | 2026-09-12 | 27 hypotheses, 24 refuted, **1 CONFIRMED blocking**, 2 nits. A second, different divergence in the same guard — verified by an actual connection on the scratch database. Returns to implementer, cycle 2 of 3. |
| G2 build | **PASS** (cycle 3) | 2026-09-13 | Block and both nits fixed. All 44 re-run: `596 passed` pure, `10 passed` integration, #39 `OK`, scope `0`/`0`. **All three guard conjuncts proved individually load-bearing by deletion.** |
| G3 adversarial | **ACCEPT_WITH_NITS** (cycle 3) | 2026-09-13 | 23 hypotheses, 21 refuted, 0 blocking, 2 nits. **The structural claim survived a dedicated attempt to break it**, with a proof. All 3 INCONCLUSIVE items run by the orchestrator. |
| G4 integration | **PASS** | 2026-09-13 | `598 passed`, `tsc`/`build`/`npm ci` `exit=0`, integration `10 passed`, migrate `0,0,0`, 18 title gates exact, #39 `OK`, scope `0`/`0`. |

**Cycle count:** 2 / 3
<!-- G0 spec revisions do not consume the §11 implementer↔reviewer budget. -->

## What the draft got right, recorded before the findings

- **It answered the scope question this ITEM.md left open, and answered it well.** Two tasks: the
  endpoint here, the dashboard's adoption as `P1-11a`. The reasoning is the right one — a 691-line
  rewrite of the primary screen has regression surface the endpoint's own tests cannot cover.
- **It did not inherit the stale premise.** The payload is enumerated from `app/dashboard/page.tsx`
  as it stands — eleven sections, each naming its source loader — with net worth absent, against
  both ROADMAP.md's line and BUILD.md §14's field list.
- **It carried P1-10's lesson forward structurally.** The reuse check (#22) parses imports with the
  `typescript` package rather than grepping, citing the G1-D1 defect that produced that fix.
- **It found a real constraint I had not stated**: `vitest.config.mts` does not include `app/**`, so
  anything testable without a database has to be reachable under `lib/` or `shared/` to run in the
  existing suite. That is the repo's own documented rule, correctly applied.

Every referenced module verified present: `.github/workflows/ci.yml`, `docker-compose.yml`,
`lib/{drift,feedHealthRead,monthOutlookRead,yearEndRead}.ts`,
`lib/domain/{monthOutlook,feedHealth}.ts`. `app/api/v1/` and `vitest.integration.config.mts` are
correctly absent today.

## D1 — BLOCKING, safety. The stated database setup points at the owner's real financial data

T5 instructs: `docker compose --env-file .env.local up -d db`, then
`DATABASE_URL=postgresql://b8:$POSTGRES_PASSWORD@localhost:5432/b8_finance npm run migrate:up`.

Measured on this machine:

```
docker-compose.yml  db service  ports: "127.0.0.1:5432:5432"   POSTGRES_DB: b8_finance
host postgres                   listening on 5432, database b8_finance exists
.env.local          DATABASE_URL=postgresql://***@localhost:5432/b8_finance
```

**The container binds the port the real database already occupies, and carries the same database
name.** So `localhost:5432/b8_finance` is not a throwaway — on this machine it is the owner's live
financial data, and the instruction cannot distinguish the two. Either the container fails to bind
5432 and the URL silently resolves to the real database, or the owner stops their local Postgres
first, which T5 never says to do.

The suite this URL feeds **seeds fixtures** — negative controls #1–#7 require inserting a hidden
transaction, a capital category, an excluded category, a refund, two accounts sharing a Plaid item,
and a seeded balance disagreement. Pointed at `b8_finance` that is a write to real financial records.

This repo has already settled this exact question once: `scripts/seed-demo.mjs` refuses to run
without `--yes-wipe-my-database` **because** "the `DATABASE_URL` in `.env.local` is normally the real
database," and README §79 documents a scratch database as the safer path. P0.5-31's A1 adjudication
escalated the same hazard to the owner rather than let an agent perform it.

**The fix is a control, not a convention.** A distinct database name that cannot collide, and a
refusal in the integration config or suite setup if the resolved database name is `b8_finance` —
with an acceptance command proving the refusal fires. A spec that only *tells* the implementer to
use a throwaway has not made a throwaway mandatory.

## D2 — five prose cross-references point at the wrong command

| Claim in the prose | Cited | Actually | Correct |
|---|---|---|---|
| does not touch `app/dashboard/**` (Goal) | #29 | I5, the uncategorized fixture | #35 |
| No dashboard adoption (Non-goals) | #29 | as above | #35 |
| does not touch `lib/domain/**` (Non-goals) | #30 | I6, the refund fixture | #23 |
| CI runs only the pure suite (Non-goals) | #28 | I4, the exclusion fixture | #37 |
| the `Date` round-trip control (Goal) | #16 | F1, the money-string fixture | #19 |

The Negative-controls table's pointers are all correct; only the Goal and Non-goals prose is wrong.
BUILD.md §5.2 makes the reviewer enforce non-goals as defects, so a non-goal pointing at an
unrelated database fixture is an unenforceable boundary.

**Third occurrence of this class in two tasks** — P1-10 G0 cycle 1 finding D4 was the same defect.
Worth naming as a pattern rather than a slip: the numbering is edited late and the prose is not
re-checked against it.

## D3 — three commands pair a bare count with a non-literal expectation

#13 → `≥1`, #15 → `≥6`, #24 → `≥10`. Each runs `grep -c` (or the reporter piped to it), which emits
a bare number, while the Expected column states a range. §7.1 requires each command paired with its
expected observable result, and a range is not one.

P1-10 solved this and the form is in its own spec: `test $(…) -ge 28 && echo OK` → `OK`. This draft
regressed to the looser shape. Mechanical fix.


---

## G0 cycle 2 — PASS

**D1 fixed, and fixed as a control rather than a convention.** The spec now requires
`lib/testDbGuard.ts`'s `assertScratchDatabase(url)` — a pure function that throws when the
connection string's database name is `b8_finance` — called synchronously as the integration setup's
first statement, before any `pg` client exists. Three commands test it independently: #24 and #25
prove the predicate is right in both directions without a database, and **#39 is a live-fire run of
the real integration entry point** with `DATABASE_URL=postgresql://nobody@127.0.0.1:1/b8_finance`.

Port `1` is the detail that makes #39 worth having: a connection there cannot succeed, so the
command cannot pass by accidentally reaching something. It requires both a non-zero exit *and* the
database name in the output, which only a guard that actually fired can produce.

**#39 verified non-vacuous today, before anything exists:**

```
$ DATABASE_URL="postgresql://nobody@127.0.0.1:1/b8_finance" npx vitest run --config vitest.integration.config.mts …
exit=1                      (the config file does not exist yet)
grep -c b8_finance → 0      (nothing named the database)
→ no OK                     (correct: the command cannot pass before the guard exists)
```

The spec also added two failure modes anticipating how the guard could be present but useless — the
setup building a pool from discrete `PGHOST`/`PGDATABASE` variables so no URL is ever assembled, and
the call landing after the first seeding query or inside a swallowing `try/catch`. Those are the
right two, and they are why #39 is behavioural rather than an import-presence check like #26.

**D2 fixed.** Every prose pointer was resolved mechanically against the command table rather than
read: Goal → #40, #21, #24, #25, #39; Non-goals → #40, #27, #42, #21. All nine land on the command
the prose describes. Acceptance rows are contiguous `1..44`, negative controls `1..14`.

**D3 fixed.** No Expected column states a range. Every "at least N" is now
`test $(…) -ge N && echo OK` → `OK`.

**Toolchain rows verified, each by its own command:** T1 `1`; T2 `exit=0`; T3 `4.6.2`; T4 matches;
T5's safe pattern is the one README.md already documents (`createdb` + a scratch name), and the
spec's new non-goal forbids the compose `db` service by name; T6 `CONTRACT_PREFIXES =
['shared/contracts/', 'migrations/']` with neither `app/` nor `lib/` in it, so the implementer can
write this whole surface with the lease closed; T7 `HEAD = 46b7dcf`.

**Non-vacuity:** #6, #7, #8, #10, #12 all fail today (the files do not exist); #26 reports `0`
(the directory is absent); #14, #27, #40, #42, #43, #44 are `0` on a clean tree; #2 is `1`.

## One residual risk, recorded rather than waived

**The guard is a denylist of one name.** `assertScratchDatabase` refuses `b8_finance` specifically.
That closes the hazard measured on this machine — it is exactly the name `.env.local` resolves to
and exactly the name the compose service uses — but it is a proxy for "is this the real database,"
and a differently-named production clone would pass it.

Not failed for, because an allowlist has its own failure mode (refusing a legitimately-named scratch
database, blocking work) and because the measured hazard is the one that exists. **Assigned to G2**:
I will confirm the guard's message names the offending database so an operator who hits it
understands why, and the reviewer should consider whether the denylist should become a pattern.

## The environment broke the baseline again, for the sixth time today

`npx tsc --noEmit` — acceptance #1 — failed with 20 `Cannot find type definition file for 'node 2'`
errors while I was verifying the baseline. Cause: **782 directories duplicated inside
`node_modules` again**, including empty `@types/<name> 2` directories that TypeScript auto-loads as
implicit type libraries. Removed; `tsc` returned `exit=0` and the suite `578 passed`.

Sixth recurrence in this session (dependency directories twice, working-tree files twice, a git ref,
and this). It has now broken a database migration, the type checker, a `git fetch`, and duplicated a
safety mechanism. Recorded here because a G0 that measures a baseline has to say when the baseline
was not stable at the moment it measured it.

`touch plan/tasks/P1-11-api-v1-overview/.frozen` — acceptance criteria immutable from here.


---

## G1 cycle 1 — PASS

| §7.2 checklist item | Result |
|---|---|
| Diff minimal and confined to the contract surface | one new file, `shared/contracts/overview.ts` (689 lines). No existing contract file edited: `git diff HEAD -- shared/` → `0` |
| Change class matches (§9.2) | additive |
| `migrate:up && down && up` on a throwaway | `0`, `0`, `0` on `b8_p111_throwaway`. Vacuous — no migration in this task |
| `db/schema.sql` reflects the migration | n/a, no migration |
| No committed migration edited (§9.3) | `0` |
| `npx tsc --noEmit` | `exit=0` — this was the guardian's own stated risk, since it holds no Bash and could not check its zod-4 API usage. It compiles |
| Full suite | `578 passed (33 files)` |
| Lint | `✖ 1 problem (0 errors, 1 warning)` — the pre-existing warning, unchanged |
| Money columns / no stored current-value column | n/a, no schema change |
| Nullable-means-unknown preserved | 19 `.nullable()`, **0 `.optional()`** — the distinction P1-10 established, held without exception |
| Rationale in `CONTRACT.md` | 320 lines |
| Lease closed before the implementer is dispatched | closed |
| Layering (AST import parse over the whole directory) | `next/server` `0`, `pg` `0`, `lib/db` `0`, `categoryControl` `0`, and `lib/` `0`. Imports are `zod`, `./enums`, `./envelope`, `./representation` — nothing else |
| Scope #43 / #44 | `0`, `0` |

**The `z.date()` check is worth recording for how it was run.** A substring search reports `2`
occurrences in the new file. Both are comments *explaining* that `z.date()` must never be used — the
identical shape that failed P1-10's G1, where a sentence documenting compliance broke the compliance
check. Resolved by looking at whether each line was code or comment rather than by counting:
line 11 and line 566, both comments. `lastSuccessfulUpdate` is `timestamptz.nullable()` at line 590,
which is the rule. No violation.

**The guardian's most consequential judgement is confirmed by the suite, not just argued.** It
declined to add `OverviewData` to `shared/types.ts`, reasoning that P1-10's own F1 fixture reads
every exported name out of that file's AST and requires exactly one `CONTRACT_SCHEMAS` entry per
name — so a new export there fails acceptance #2 unless `index.ts` also changes. The suite passing
at `578` with `shared/types.ts` untouched is the empirical half of that argument. It also picked the
better of the two permitted branches on the merits: a `z.infer` type has no existing importers, so
P1-10's number-versus-string debt is not manufactured here.

**A real cost, accepted with its reason stated.** The guardian refused even an `import type` from
`lib/yearEndRead.ts`, because a type-only import is still a real `ImportDeclaration` pointing at a
module that imports the database shell — and acceptance #26 parses imports, not type positions. The
consequence is that P1-10's `Assert<Equals<…>>` exactness idiom cannot live in this file, so the
contract cannot type-check itself against the domain types it mirrors. It relocated the assertion to
`lib/overviewRead.ts` and handed the implementer the exact comparison to place there, on **key
sets** rather than value types, since the values diverge deliberately. **Carried to G2**: I will
confirm that assertion actually exists and fails on drift, the same way P1-10's was proved by
constructing the drift rather than trusting the claim.

## Three spec defects the guardian found and did not act on — all correct to leave

1. **The `shared/types.ts` option the spec offers cannot be exercised as written** (above). It took
   the "none" branch the spec also permits, so nothing is blocked. Recorded rather than escalated.
2. **`LandscapeSchema` is named as a primitive to reuse, but no field in the payload is
   landscape-typed.** Importing it would be an unused import and a second lint warning against
   acceptance #3. Not imported — right call.
3. **The money enumeration is narrower than the money rule in three places.** The spec's governing
   sentence says "every field representing a dollar amount, in every section"; its parenthetical
   list omits `coverage.{scoredSpend,unattributedSpend,orphanedSpend}`, `headline.{budgeted,actual,
   variance}` plus the same three on each adherence finding, and `yearEnd.monthly[].net`. Resolved
   toward the rule rather than the list. This widens what the implementer must format, so it is
   named here for the reviewer rather than left to be discovered at G3.

## The environment broke `npm ci` mid-flight — seventh recurrence

Acceptance #5 failed `ENOTEMPTY` on `node_modules/balanced-match`: the sync had duplicated a file
inside that package, so npm could not remove the directory it was replacing. The failure left
`node_modules` **partially wiped — 56 entries of 386** — which would have broken every subsequent
command had it not been caught here.

Cleared the duplicates, re-ran `npm ci` → `exit=0`, 386 packages, `tsc exit=0`, suite `578 passed`.

Seventh occurrence in this session. It has now broken a migration, the type checker, a `git fetch`,
a clean install, and duplicated a safety mechanism. **G1 is not failed for it** — it is not the
guardian's diff and the checklist item passes once the environment is repaired — but a gate that
reports `exit=0` for a command that needed the tree repaired first has to say so.


---

## G2 cycle 1 — PASS

**The one failing command was not the implementer's, and it refused to work around it.** #44 returned
`5`: five byte-identical duplicates of the P1-10 contract tests, the **eighth** occurrence of the
sync fault this log has recorded. The implementer tried `rm`, was blocked by the scope guard with the
lease closed, and escalated rather than routing around it — the correct response, and the guard
behaving correctly. It also removed the one sibling artifact that was outside the frozen surface,
so everything it handed up was unambiguously not its to touch. Quarantined under a brief lease;
#43/#44 both `0` afterwards.

**All 44 re-run by the orchestrator.**

| Group | Result |
|---|---|
| #1 `tsc` / #4 build | `exit=0`, `exit=0` |
| #2 pure suite | `1` — `578 passed` |
| #3 lint | the one pre-existing warning, unchanged |
| #6–#13 deliverables exist | all 8 present |
| #14–#16 config discipline | `0`, `OK`, `0` — the pure config untouched, the two configs disjoint |
| #17–#25 pure fixtures | `OK` (10 ✓ against a floor of 8); F1–F8 titles each exactly `1` |
| #26 reuse (AST) | `4` |
| #28–#38 database fixtures | `10 passed`; I1–I10 titles each exactly `1` |
| #39 the safety control | **`OK`** |
| #27, #40–#44 scope | `0` throughout |

**#39 is the command this task exists to have.** Run against
`postgresql://nobody@127.0.0.1:1/b8_finance`, the suite fails at
`assertScratchDatabase lib/testDbGuard.ts:95` called from `lib/testDbGuard.setup.ts:24:1`, and the
reporter says **`Tests no tests`** — the test module was never loaded, so `lib/db.ts` never ran and
no `pg.Pool` was ever constructed. The refusal is on the string, before any connection, which is
exactly what G0 cycle 1 demanded when it failed the first draft for pointing a seeding suite at real
financial data.

**The vacuity commitment is discharged.** All 18 named fixtures opened. They assert their titles,
and several are sharper than the spec required:

- **F6** asserts `stats.remaining` is `'500.00'` **and `not.toBe('499.99')`** — 499.99 is precisely
  what parsing the two formatted strings back into numbers would produce. A discriminating
  assertion, not a value check.
- **F2** pins the source at `993.7500000000001`, the wire at `'993.75'`, and re-rounding as
  idempotent — so the round happens once, at the boundary, which is the convention's actual wording.
- **F4** asserts the composed value **is** a `Date` instance before serialization and a string after.
  Both halves; either alone would pass against a wrong schema.
- **I9/I10** assert *agreement* with `loadMonthOutlook` and `loadYearEnd('operational', asOf)` called
  directly, and I10 checks the capital figure is 40× the operational one and absent from the payload.

**The exactness mechanism was proved, not accepted.** I appended a deliberately false assertion in
the file's own idiom and got `lib/overviewRead.ts(812,28): error TS2344: Type 'false' does not
satisfy the constraint 'true'`, then restored and reconfirmed `exit=0`. There are 13 real assertions
(14 `Assert<` occurrences, one in a comment); my first count said 3 because most are written
multi-line — **the implementer's figure was right and mine was wrong.**

## Finding — #26 does not measure what its Expected column claims

Reported by the implementer, verified here. The Expected column says "a real import of all four
shared readers is present somewhere in the route's **module graph**." The script walks files *in*
`app/api/v1/overview/` and reads their own specifiers; it does not follow the graph.

```
route.ts      imports @/lib/overviewRead — and nothing else of interest
route.test.ts imports findBalanceDrift, loadFeedHealth, loadMonthOutlook, loadYearEnd
lib/overviewRead.ts is where all four are actually called
```

So #26's `4` comes from the **test file**, not the route. It would be satisfied over a handler that
re-derived every figure, as long as the test file imported the readers. **Fourth instance in this
project of a control that does not measure the rule it stands for** — after the substring-vs-import
check, the path-prefix-vs-contract-surface check, and the version-pattern-vs-range check.

**G2 is not failed for it.** The command passes as literally written, and the hazard it was meant to
close is independently enforced by I7–I10, which assert agreement with the four readers called
directly — the §14 worked-example control, and a stronger one than an import check. Recorded for
NITS.md and flagged to the reviewer.

## Two more reports from the implementer, both correct

- **The guardian's `-0` instruction was one step off.** Normalizing the *input* leaves
  `.toFixed(2)` printing `"-0.00"`, because the negative zero only exists after rounding. The fix
  applies the same helper after the round, and F2 pins `wireMoney(-0.004) === '0.00'`.
- **Evidence item 3's "distinct port" is not satisfiable.** There is one local Postgres, so the
  scratch database shares `5432` with everything else. The name was always the discriminator, which
  is why the spec required a name-checking control rather than a port-based one.

## A pre-existing oddity found and correctly left alone

`today.totalCount` is `4` against the seed while `today.spent` is `"120.00"` — the dashboard's third
today-query carries **no category predicate**, so the count ranges over a wider population than the
spend. That is the running code, and "no change to how any figure is computed" is a non-goal. Left
alone, recorded as a candidate for `P1-11a`.


---

## G3 cycle 1 — BLOCK

37 hypotheses, 31 refuted by reading, 2 CONFIRMED blocking, 5 nits, 0 scope violations. The log is
the strongest of the three this session: it walked all six reimplemented queries clause by clause
against the originals, checked every plain-number field in the contract to prove none is a dollar
amount, and read `pg-connection-string`'s source rather than reasoning about connection strings from
memory.

## The three INCONCLUSIVE items, all run

**1. Do the title greps distinguish a passing fixture from a failing one? — RESOLVED in the diff's
favour, and it was the right question to ask.** Eighteen gates count title occurrences, not
checkmarks. If a failing test printed its title once, all eighteen would pass while red. Measured by
inverting `lib/overviewRead.test.ts`'s `stats.remaining` assertion to the wrong value:

```
title count with the fixture FAILING : 2      (the × line, plus the "Failed Tests" summary header)
title count restored                 : 1
```

So `= 1` genuinely means green. **The reviewer's related observation stands**: #17's floor of `-ge 8`
against 10 fixtures printed `OK` at 9 ✓ with one test red, so #17 alone has slack — closed only
because #18–#25 check each title individually.

**2. The `socket:` bypass — CONFIRMED, by parsing only, with no connection and a safe database
name.**

```
pg-connection-string.parse("socket:/var/run/postgresql?db=b8_p111_throwaway")
  -> database: "b8_p111_throwaway"   host: "/var/run/postgresql"
new URL(same).pathname               -> "/var/run/postgresql"
grep protocol lib/testDbGuard.ts     -> no match; the scheme is never checked
```

`pg` takes the database from the `db` **query parameter** for `socket:` URLs; the guard takes it from
the **path**. Substitute `b8_finance` for the safe name and `pg` connects to the real ledger while the
guard reports the database as `var/run/postgresql` and approves — after which `beforeAll` runs
`TRUNCATE … RESTART IDENTITY CASCADE` over it.

**3. The calendar dependency — CONFIRMED by arithmetic.** `projectSide`
(`lib/domain/yearEnd.ts:52-63`) sums planned months from `monthIdx + 1` to 11, so the projection
shrinks as the year advances: expense `= 100 × (12 − asOf.month)`. Today `new Date().getMonth()` is
`8`, which is why `'400.00'` passes. In October it is `'300.00'` and the assertion fails.

## Finding 1 — BLOCK. `databaseNameFromUrl` never checks the URL scheme

This is a hole in the one control the whole task was re-specified to add. G0 cycle 1 failed the first
draft for pointing a seeding suite at real financial data; the fix was "a control, not a convention."
The control reads the wrong field for one connection-string form that `pg` fully supports, and it
does so **confidently** — returning a plausible-looking name rather than `null`.

That is the case the guard's own docblock says it must refuse: *"'I could not tell which database
this is' and 'this is a safe database' are different answers, and only one of them is allowed to let
a write through"* (`lib/testDbGuard.ts:41-44`). The closure is one conjunct — refuse unless the
protocol is `postgres:` or `postgresql:` — which is the set the function's comment already claims to
handle.

Contradicts SPEC.md negative control #14: *"regardless of what `$DATABASE_URL` an operator
supplies."*

## Finding 2 — BLOCK. Two I10 assertions expire on a calendar boundary

`route.test.ts:329` (`expect(payload.yearEnd.expense).toBe('400.00')`) and `:336`
(`expect(capital.expense).toBeGreaterThan(16000)`) hold only while `asOf.month === 8`. From October
the first receives `'300.00'` and the second `12500`. Two of ten fixtures go red, so acceptance #28
stops printing `OK` and #38 stops returning `1` — a gate proving "yearEnd is scoped to the
operational landscape" expiring for a reason unrelated to the rule it measures.

Both are fixable from values already in scope: `asOf.month` is module-level, and line 321 already
compares the payload against `operational.expense` fetched on line 316, which is the durable form.
Line 329's literal adds nothing but the expiry.

Contradicts BUILD.md §10.3 (wall-clock non-determinism) and EVIDENCE.md §13.2's claim that "there is
no hard-coded month."

## Nits carried to NITS.md rather than blocking

- **`wireMoney` re-spells `roundCents`.** `Math.round(value * 100) / 100` is the byte-identical body
  of `lib/budgetMath.ts:10`, already imported by `lib/domain/{drift,pacing,propertyLedger}.ts`. Two
  copies of one rounding rule, and the same argument CONTRACT.md made about `withoutNegativeZero`,
  which the implementer *did* follow. Fix is an import.
- **A frozen-spec contradiction resolved silently.** SPEC.md's landscape table says `monthlySpending`
  filters `is_income = FALSE`; the running `getMonthlySpending` has no such predicate. The diff
  correctly followed the running code over the table — filtering income would drop salary from
  `received` and make the endpoint disagree with the dashboard — but EVIDENCE.md does not record the
  conflict, and the spec's own Evidence item 6 asks for exactly that.
- **Acceptance #16 cannot measure disjointness.** `grep -c "lib/\*\*|shared/\*\*"` → `0` is
  satisfied by `include: ['**/*.test.ts']`, the precise failure mode the spec lists. The shipped
  config is genuinely disjoint; the control is not what proves it. **Fifth instance in this project
  of a control that does not measure its rule**, after the substring-vs-import, path-prefix, version-
  pattern and module-graph cases.
- **`monthRead.allPaces` is dropped**, so the payload cannot yet feed the dashboard's lead widget.
  Matches the frozen payload table, which also omits it — so the spec's headline claim
  ("everything the dashboard currently fetches") is not quite true, and `P1-11a` needs a twelfth
  section and a contract amendment. Budget it there rather than discover it there.
- **Orphaned promises on the error path**, inherited verbatim from the page's structure. Blast radius
  differs: in a route handler with no `try`/`catch` it is the server worker rather than a render
  boundary.


---

## G2 cycle 2 — PASS

**BLOCK 1's fix verified three ways, not accepted on report.**

1. The conjunct exists and runs before any field is read: `READABLE_PROTOCOLS =
   new Set(['postgres:', 'postgresql:'])`, checked first.
2. `pg` and the guard now agree on the `socket:` form — `pg` resolves the `db` parameter, the guard
   refuses the scheme outright rather than reading a field it does not understand.
3. **Proved load-bearing by removing it.** Commenting the line out produces
   `AssertionError: expected 'var/run/postgresql' to be null` — the reviewer's own measurement
   surfacing as a test failure. Restored: `6 passed`.

The implementer refused rather than special-cased `socket:`, on the ground that a second
connection-string parser would have to stay in agreement with `pg`'s forever. That is the right
instinct and the same one behind the `roundCents` nit. It also found and fixed a divergence nobody
asked about: `pg` applies `decodeURI` to the path while the guard used `decodeURIComponent`, which
agree on `%5F` and disagree on `%2F`.

**BLOCK 2's fix is durable, not relocated.** The literals are gone. `payload.yearEnd.expense` is now
compared against `wireMoney(operational.expense)` — the same-run value, which cannot expire — and the
capital assertion is pinned to a *ratio* and to the seed's own annual allocation, both of which are
month-invariant because the projection factor divides out. The implementer measured all twelve month
indices against the live seed and confirmed `400.00` at month 8, `300.00` at month 10, matching the
arithmetic exactly.

EVIDENCE.md §13.2's false claim ("there is no hard-coded month") was corrected in place rather than
deleted, which is the right disposition for a record that was wrong when written.

**All 44 re-verified by the orchestrator:** `#1 exit=0`, `#2` `594 passed` (up from 578 — the new
guard fixtures), `#3` the one pre-existing warning, `#4 exit=0`, `#17` `OK` at 10 ✓, `#28` `OK` at
10 ✓, all **18 title gates exactly `1`**, `#39 OK`, `#43`/`#44` `0`.

`roundCents` is imported. The `monthlySpending`/`is_income` spec conflict is recorded in EVIDENCE
§15.4 with the concrete figure — the predicate can only empty `received`, which against this seed
would have read `20.00` instead of `5020.00` and disagreed with the chart the endpoint exists to
feed.


---

## G3 cycle 2 — BLOCK

27 hypotheses, 24 refuted, 1 CONFIRMED blocking, 2 nits. The re-review did what it was asked: it
attacked the new allowlist rather than re-reporting cycle 1, and it cleared the month-free fix
rigorously — deriving both figures under two different models (transactions fixed vs. moving with
the clock) and checking all four assertions at every month index including December, where the
projection factor is 1.

**Cycle 1's fixes are confirmed sound.** The scheme allowlist introduces no fail-open — a check can
only add refusals, and every approving fixture uses an allowlisted scheme. The
`decodeURIComponent` → `decodeURI` switch is strictly an improvement: the only behaviour change is
`%2F`, which both parsers now leave encoded, so the verdicts are identical *and* now identical to
`pg` by construction. `roundCents` preserved order and every F2 value.

## The finding — a second divergence, in the same expression the fix had just aligned

`pg-connection-string/index.js:66` takes the database with `result.pathname.slice(1)`, which drops
the first character **unconditionally**. `lib/testDbGuard.ts:101` takes it with
`.replace(/^\//, '')`, which drops the first character **only if it is a slash**. They agree for
every URL whose path starts with `/`, and diverge for every one that does not — which under the URL
Standard is exactly a `postgres:`/`postgresql:` URL not followed by `/`: an opaque path.

**Verified by execution, with the scratch name, no real database touched.**

```
$ node -e '…'  DATABASE_URL="postgresql:_b8_p111_throwaway"
guard reads: {"protocol":"postgresql:","pathname":"_b8_p111_throwaway","name":"_b8_p111_throwaway"}
pg reads   : {"database":"b8_p111_throwaway","host":""}

$ new Pool({connectionString:"postgresql:_b8_p111_throwaway"}).query("select current_database()")
CONNECTED to: b8_p111_throwaway
```

So the form is not theoretical — **it opens a real connection.** And for the real spelling, string
only, nothing opened:

```
protocol allowlisted   : true
guard would read name  : "_b8_finance"   → not equal to b8_finance → APPROVES
pg would read database : "b8_finance"
```

The guard approves, `lib/db.ts` builds a pool whose host falls through to `localhost`, and
`beforeAll` truncates the real ledger.

**Why this is BLOCK and not a nit, given it is less reachable by typo than the `socket:` case.** The
reviewer conceded reachability plainly, and the plausible slips are all safe. It blocks on the same
ground cycle 1 did: the guard **returns a guess rather than `null`**, which is the one thing its own
contract forbids — *"it may return a name or it may return `null`, and it may not return a guess"*
(`lib/testDbGuard.ts:92-93`). And it contradicts the rule the cycle-1 fix wrote eleven lines above
it: *"the guard has to read the name the same way the client that will connect reads it."* The
decoder was aligned to `pg`; the slicer on the same expression was not.

Contradicts SPEC.md negative control #14 — "regardless of what `$DATABASE_URL` an operator supplies."

## Two nits

- **F7's socket assertions match a string every refusal message contains.** All three error messages
  interpolate `${REAL_DATABASE_NAME}`, so `.toThrow(/b8_finance/)` is satisfied by the "cannot prove"
  branch as readily as by the "Refusing" branch. It proves only that something threw.
  `lib/testDbGuard.test.ts:43` gets this right with `.toThrow(/cannot prove/)`. Acceptance #24 is
  unaffected, **which is exactly why the weak matcher is invisible** — the title gate cannot see the
  difference between a discriminating assertion and a vacuous one.
- **A comment left stating the literal the fix removed.** `route.test.ts:351` still says "`expense`
  is 400.00", three lines below the paragraph explaining why that literal was deleted. Same class as
  the EVIDENCE §13.2 claim corrected in cycle 1.

## One fragility recorded, not a finding

At `asOf.month === 0` the operational projection is **exactly** 1200.00, so
`toBeLessThanOrEqual(1200)` passes at equality rather than with slack. It holds for this seed in all
twelve months, which is what was asked. Recorded so whoever adds a second operational expense
category knows which assertion will tell them first.


---

## G2 cycle 3 — PASS

**The implementer chose `refuse` over `agree`, and the reasoning is better than the instruction it
was given.** I offered both closures without preferring one. Its case for refusing:

1. `pg`'s `.slice(1)` is a latent defect on its side, not a specification — it reads
   `postgresql:b8_finance` as the database `8_finance`. Copying it makes this control's correctness
   depend on that defect persisting.
2. **Copying it re-arms the failure it had already been caught on twice, in the unsafe direction.**
   If `pg-connection-string` ever makes its slice slash-aware, a copied `.slice(1)` diverges again —
   fixed-`pg` would read `b8_finance` where the copy still reads `8_finance`, the guard approves, and
   the hole reopens silently. Refusal cannot be desynchronized by an upstream change, because it
   declines to read the field at all.
3. It is what the function's own contract at lines 92-93 says.

That second point is the argument I did not make and should have.

**It found a third divergence by audit rather than by being told.** `index.js:56-59`: when
`config.host` comes from a `host=` query parameter and the hostname is a percent-encoded socket path,
`pg` **prepends the hostname to the pathname** before slicing:

```
DIFF {"c":"postgresql://%2Fvar%2Frun/b8_finance?host=/tmp","guard":"b8_finance","pg_db":"%2Fvar%2Frun/b8_finance"}
```

It correctly judged this one harmless — the rewritten path always begins `%2f`, so the slice always
begins `2f` and can never equal `b8_finance` — and **closed it anyway**, on the ground that a wrong
answer in a safe direction is still the guess the contract forbids. That is the right standard.

**The structural answer matters more than the three patches.** Rather than fix a third expression, it
restated the rule the conjuncts now express: *the function recognises one shape and refuses
everything else* — `postgres[ql]://<authority>/<database>` with no `host` parameter, the only shape
anything in this repo writes. For that shape there is exactly one reading and both parsers produce
it, so an approval **cannot** diverge from what `pg` connects to. That is a property, not a
coincidence, and it is the correct answer to "you keep re-deriving `pg`'s parser alongside it."

**All three conjuncts proved individually load-bearing, by deleting each in turn:**

| conjunct removed | result |
|---|---|
| `!READABLE_PROTOCOLS.has(parsed.protocol)` | `1 failed \| 7 passed` |
| `!parsed.pathname.startsWith('/')` | `1 failed \| 7 passed` |
| `parsed.searchParams.has('host')` | `1 failed \| 7 passed` |
| all restored | `8 passed` |

Each has a regression that fails without it. That is the strongest form available for a control of
this kind, and it is now true of every conjunct rather than just the newest.

**Both nits fixed, and one paid for itself inside the same cycle.** Zero `.toThrow(/b8_finance/)`
remain (was 5); 14 discriminating matchers and 2 `.not.toThrow` assertions prove the matchers
discriminate rather than merely being narrower. The implementer reports that the deletion probe above
was only legible *because* of that fix — without it, removing the opaque-path conjunct would have
shown a passing test rather than the two closures visibly disagreeing.

**All 44 re-verified by the orchestrator:** `#1 exit=0`, `#2` `596 passed`, `#3` the one pre-existing
warning, `#4 exit=0`, `#17`/`#28` `OK`, all **18 title gates exactly `1`**, `#26` `4`, `#39 OK`,
`#27`/`#40`/`#41`/`#42` `0`, `#43`/`#44` `0`.

## Environment — ninth recurrence, and the first to land on a safety mechanism's own state

While the implementer was stopped on a session limit, the sync duplicated
`.claude/.contract-lease` — a stale copy naming `P1-11-api-v1-overview` and a timestamp from the
guardian's G1 window, hours after that lease was closed.

**Inert, and only because `scope-guard.mjs` reads an exact path** (`const LEASE =
'.claude/.contract-lease'`, line 49) rather than globbing. Had it matched a pattern, a stale
duplicate would have held the contract surface writable indefinitely with nothing reporting it —
the same glob-versus-manifest mechanism as H1's duplicated migration, aimed at the lock instead of
the data. Quarantined; `lease status` confirms CLOSED.


---

## G3 cycle 3 — ACCEPT_WITH_NITS

23 hypotheses, 21 refuted, **0 blocking**, 2 nits. The reviewer attacked the structural claim
directly, as asked, and reported that it could not be broken — *"further case-hunting on this control
is, as the coordinator suspected, wasted effort."*

**The proof is worth keeping.** The last asymmetry between the two parsers is `pg`'s pre-encode
transform (`index.js:20-23`). Character by character it can only do three things to a path position,
and in the one case where the two sides disagree it leaves a literal `%` in `pg`'s name.
**`b8_finance` contains no `%`.** Therefore if `pg`'s name is exactly the real database, no
disagreeing case occurred, the guard read the same name, and it refuses. Combined with conjunct 3
eliminating the prepend and `val()` preferring a non-empty parsed database over `PGDATABASE`, the
narrowed shape has exactly one reading on both sides. That is the property the implementer claimed,
independently established.

### The three INCONCLUSIVE items, all run

| # | Question | Result |
|---|---|---|
| 1 | Is IPv6 approved? EVIDENCE §8 records the scratch database resolving over `::1` | `postgresql://[::1]:5432/b8_p111_throwaway` → protocol allowlisted, pathname `/b8_p111_throwaway`, no `host` param → **all three conjuncts pass**. No over-refusal, but nothing pinned it |
| 2 | Does an operator really see a false diagnosis? | **Yes.** `postgresql:///b8_p111_throwaway?host=/var/run/postgresql` — PostgreSQL's own documented socket URI — was answered "Only the postgres:// and postgresql:// forms are read," while the operator was holding one |
| 3 | Are the two surviving matchers weak? | **Yes.** Dropping `postgres:` from the allowlist left `testDbGuard.test.ts:56` green while its discriminating neighbour failed — the definition of a matcher that cannot see what it claims to test |

### Two corrections to this log's own record, both accepted

1. **Conjunct 2 is defence-in-depth, not the closure.** Because the reader was changed to `.slice(1)`
   in the same commit, deleting conjunct 2 no longer reopens the cycle-2 hole — it only flips the
   opaque form from refused to approved-as-the-name-`pg`-reads, which `pg` agrees with. **Only
   conjunct 1 stands between an approval and a write today.** My G2 cycle-3 note said each conjunct
   was "load-bearing," which is true of the fixtures and overstated about safety. The implementer
   accepted it against its own evidence, noting its cycle-2 probe output had said so and it had read
   "load-bearing" where the output only showed "fixture-bearing."
2. **The structural claim is about the database name, not the endpoint.** The guard reads no host and
   no port, so two clusters on one machine can both hold a `b8_p111_throwaway`. Qualified in the
   docblock and in EVIDENCE §16.2.

## Revision 4 — all three nits closed

- **Six refusal branches, six distinct phrases.** `readDatabaseName` now returns
  `{ name } | { name: null, why }` so the conjuncts keep one definition and the caller does not
  re-derive reasons. A fixture per branch asserts its own phrase *and* the absence of a neighbour's,
  including an explicit negative for the socket URI. Re-measured: that input is now told it carries a
  `host=` parameter, with the actionable line intact.
- **Zero weak matchers repo-wide** (`grep -rn "toThrow(/b8_finance/" lib app shared` → `0`). The
  implementer reproduced my proof against the strengthened matcher: dropping `postgres:` now yields
  `2 failed`, including the assertion that used to stay green.
- **IPv6 pinned**, both bracket forms, plus a line keeping the denylist honest through it
  (`postgresql://[::1]:5432/b8_finance` → refused).

**EVIDENCE §16.3's "zero remain" was false when written**, and the implementer corrected it in place
with the reason — noting it is the third claim of that shape in the document (§13.2, §16.4, §16.3),
every one a sentence about the state of the work rather than about the code, and every one caught by
review rather than by itself. That pattern is worth more than the three corrections.

## G4 — PASS

| Check | Result |
|---|---|
| Full suite | `598 passed` — 540 at task start |
| `npx tsc --noEmit` | `exit=0` |
| `npm run build` | `exit=0` |
| `npm ci` | `exit=0` |
| Lint | the one pre-existing `seed-demo.mjs:457` warning |
| Integration suite | `10 passed`, exit `0` |
| Migrate up/down/up on a throwaway | `0`, `0`, `0` — vacuous, no migration |
| 18 title gates | each exactly `1` |
| #39 safety control | `OK` |
| Scope #43 / #44 | `0`, `0` |
| INCONCLUSIVE items converted to commands | all 3 run at G3 cycle 3, above |

**Cycle count: 2 / 3.** Both consumed by the same control, and both by the same defect class — the
guard reading a field differently from the client that would connect through the same string.
