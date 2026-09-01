# GATES — P0.5-28-category-control-mode
<!-- Append-only audit trail. The process analogue of this app's own append-only observation
     tables: the record of what happened is worth more than a summary of it. -->

| Gate | Result | When | Evidence |
|---|---|---|---|
| G0 spec | FAIL → FAIL → **PASS** (draft 3) | 2026-09-01 | 5 findings across two rounds, all resolved; every fix re-verified by command, not accepted. Draft 3 frozen (`.frozen` created). Freeze enforcement audited and found **partial** — see "Process defect P-1". See "G0 review 3". |
| G1 contract | **PASS** | 2026-09-01 | Diff confined to 3 contract files; round-trip clean; all 7 constraint controls executed, not read; change class adjudicated on evidence; consumers intact (tsc 0, 298 tests). Guardian's parser hypothesis refuted by command — and the inverse hazard it led me to is real. Lease CLOSED. See "G1 review". |
| G2 build | *pending* | — | |
| G3 adversarial | *pending* | — | |
| G4 integration | *pending* | — | |

**Cycle count:** 0 / 3
<!-- G2/G3-BLOCK/G4 failures increment. A reviewer-fault (empty falsification log) does NOT. -->

## Toolchain, verified by the orchestrator ahead of G0
<!-- BUILD.md §7.1: a row whose verification command the orchestrator cannot run is a G0 FAIL,
     not a note. Pre-verified here so G0 is a check, not an investigation. -->

| Assumption | Verification command | Measured 2026-09-01 |
|---|---|---|
| Node ≥ 24 | `node -v` | v26.3.1 |
| npm | `npm -v` | 11.16.0 |
| psql client | `psql --version` | 16.14 (Homebrew) |
| Postgres reachable | connect via `DATABASE_URL` | **reachable**, db `b8_finance`, PostgreSQL 16.14 |
| Docker daemon | `docker info` | **NOT running.** Differs from P0-09a, which used Docker for its throwaway. Not required — superseded by the local throwaway below. |
| Throwaway DB for round-trip | `createdb b8_roundtrip_p0528` + full `node-pg-migrate up` | **provisioned**, full history applied through `1787871600000_tenant-held-funds` |
| Vitest runnable | `npx vitest run --pool=threads` | **18 files / 298 tests passed** |
| Typecheck baseline | `npx tsc --noEmit` | **exit 0, clean** |
| Lint baseline | `npm run lint` | exit 0, 1 pre-existing warning |

**Baseline corrections carried into this task.**
- The suite is **298** tests, not the 237 recorded in `ROADMAP.md` §5 (that was Phase 0's figure;
  P0-09a added the rest). The spec-writer was dispatched with 237 and corrected mid-flight.
- P0-09a's GATES.md records a standing pre-existing `tsc` condition — two errors from macOS
  filename-duplication artifacts (`routes.d 2.ts`, `cache-life.d 2.ts`) under the build output.
  **That condition is resolved**; the artifacts are gone and `tsc` is clean. It must not be
  carried forward as an excuse for a non-zero `tsc` at any gate in this task.
- Lint's single warning (`scripts/seed-demo.mjs:438`, unused `pid`) is pre-existing and out of
  scope. A gate asserting "0 warnings" would fail on unrelated code; gates assert exit 0.

**Standing hazard, restated from P0-09a because it has not changed.** `npm run migrate:up` and
`migrate:down` read `--envPath .env.local`, which points at the **dev database holding real
financial data**. The §7.2 up/down/up round-trip runs against `b8_roundtrip_p0528` with an
explicit `DATABASE_URL` override, never against dev. Nothing in the npm script prevents the
mistake, which is why the override is written into this log rather than left to recall.

## Pre-G0 finding — contract-surface drift, routed to G1

`db/schema.sql` is missing `budget_categories.is_debt_service`. Established by command, not
inspection:

- `migrations/1786644696767_debt-service-categories.sql:21` adds
  `is_debt_service BOOLEAN NOT NULL DEFAULT FALSE`.
- Column-set diff, throwaway DB (full migration history) vs the `budget_categories` block in
  `db/schema.sql`: **`is_debt_service` present in the DB, absent from the file**; no divergence
  in the other direction.
- Live consumers: `lib/domain/propertyPnl.ts:63` (`raw.onLiabilityAccount || raw.inDebtServiceCategory`)
  and `app/properties/[id]/page.tsx:131` (correlated subquery on `bc.is_debt_service`).

`db/schema.sql` is contract surface (BUILD.md §2) and single-writer (I2), so the fix belongs to
contract-guardian at G1 and to no one else. Recorded here pre-G0 so the repair is a scoped,
declared part of this task rather than an out-of-scope diff the reviewer flags as a defect at G3.

**Why this is more than bookkeeping.** `is_debt_service` already occupies part of the dimension
step 28 adds: a debt-service category is the `fixed` case. Shipping `control_mode` beside it
without stating their relationship would leave two overlapping classifications of one property on
one table — the "drifting definitions" failure of BUILD.md §1, and a future `AVG` over the wrong
one is a silently wrong headline number. The spec-writer was sent this finding and instructed to
resolve the relationship with a negative control rather than prose.

## Adjudications
<!-- Disputes settled by a discriminating command, never by argument (BUILD.md §5.1).
     A disposition may not be recorded as "verified" unless the causal claim behind it was
     itself run as a command. Otherwise it is recorded as a hypothesis. -->
| Claim in dispute | Discriminating command | Output | Decision |
|---|---|---|---|

## G0 review 1 — draft 1, 2026-09-01 — **FAIL**

Checked against BUILD.md §7.1. What passed, stated so the revision does not churn it: non-goals are
specific and enumerate real files; the Contracts-touched table is present with change classes; the
Conventions section covers sign, rounding, landscape/exclusions and null semantics explicitly; 13
negative controls map to named rules; 12 failure modes seed the reviewer. The three `ITEM.md`
questions are answered with reasoning, and the `is_debt_service` coupling was independently
re-verified by the spec-writer rather than taken from my message on faith.

**Baseline claims I re-ran rather than trusted — all four correct:** `grep -c "variable-necessary"
shared/types.ts` → 0; `grep -c "control_mode" db/schema.sql` → 0; `grep -c "is_debt_service"
db/schema.sql` → 0; the `-A3` grep for `control_mode` in the `GET` handler → 0. Command #12's
literal anchor string exists at `app/api/categories/route.ts:11`, and the whole `SELECT` is on that
one line, so `-A3` reaches an added column. `npm test -- --pool=threads` does forward the flag
(18 files / 298 tests). The `--reporter=verbose lib/` filter resolves to 17 files / 262 tests and
prints untruncated test names, so #3–8 are matchable; an em-dash in a name greps fine under `-F`.

### [BLOCK] G0-1 — acceptance #15, #16 and #17 assert the wrong exit code

The spec expects `3` from `psql -v ON_ERROR_STOP=1 -c "..."` on a constraint violation. Measured
against the throwaway with real violations of the same shape:

| Violation | Command form | Expected by spec | **Measured** |
|---|---|---|---|
| CHECK (`landscape` = `'nonsense'`) | `psql -v ON_ERROR_STOP=1 -c` | 3 | **1** |
| NOT NULL (`name` = NULL) | `psql -v ON_ERROR_STOP=1 -c` | 3 | **1** |
| success + `RETURNING` | `psql -v ON_ERROR_STOP=1 -c` | 0 | 0 ✅ |

Exit 3 is psql's *script* failure code — it applies to `-f` / `\i` with `ON_ERROR_STOP`, not to a
`-c` statement, which reports a SQL error as exit 1. All three of these are the negative controls
that prove the `CHECK` constraints actually constrain (NC #2, #3, #4). **As written they fail
against a correct implementation and pass against nothing** — the worst direction for a frozen
acceptance command, because the implementer's only route to green is to weaken the schema.

Fix: expect `1`, or make the assertion exit-code-agnostic by matching the error text. Verify
whichever is chosen; do not swap 3 for 1 on my word.

### [BLOCK] G0-2 — T1 declares a prerequisite that is both false and unnecessary

T1 is `Docker daemon running`, Required = **yes**. `docker info` → **not running** on this machine.
Under §7.1 a required toolchain row the orchestrator cannot satisfy is a G0 FAIL, not a note.

It is also the wrong prerequisite. What commands #13–18 need is *a throwaway Postgres*, and Docker
is one way to get one. I have already provisioned `b8_roundtrip_p0528` on the local Homebrew
Postgres 16.14 with the full migration history applied — so the underlying need is met and the row
as written is what is broken. P0-09a used Docker and the spec-writer reasonably carried that
forward; the environment changed.

Fix: restate T1 as "a throwaway Postgres reachable via an explicit `DATABASE_URL` override,"
verified by a connect-and-query command, with Docker named as one means rather than the assumption.

### [BLOCK] G0-3 — acceptance #2 asserts an exact total and will fail on added value

`npm test -- --pool=threads` → expected `304 passed` (298 + 6). The 298 baseline is right and the
arithmetic is right, but the assertion binds the implementer to *exactly six* new tests. A seventh
test — an extra edge case, a type-level assertion, anything the implementer judges worth adding —
turns a correct implementation red at G2. This exact class of drift was already adjudicated once in
this repo, at P0-09a's G2 ("#2's count adjudicated below — the drift is the orchestrator's, not the
implementer's"), and it should be designed out rather than adjudicated again.

The six required tests are already pinned individually by #3–8, which is the stronger and more
specific guarantee. #2's job is only "nothing else broke."

Fix: assert exit 0 with no failures, or a floor (`≥ 304`), not an exact total.

### [BLOCK] G0-4 — the exit criterion is met literally and not substantively

`DEFAULT 'fixed'` on every row, plus the explicit non-goal *"No write path... Nothing in this task,
the app, or any script ever changes a category's classification away from its `DEFAULT 'fixed'`"*,
means that when this task merges: every category is `fixed`; the scored set
(`... AND control_mode = 'discretionary'`) is **empty**; and there is no supported way to make it
non-empty short of hand-written SQL against the dev database.

§5's exit criterion — *"every operational category carries a control classification"* — is then true
the way a column of zeroes is true. But step 28's own title is **"Decide what a category *is*"**,
and no deciding has happened. Step 29 inherits an adherence metric that computes over the empty
set, which is not a metric a negative control would catch.

I am not ruling that the safe default is wrong — the argument for `fixed` over `discretionary` is
correct and well made, and I am upholding it. The gap is that the spec pairs a safe default with
*no mechanism whatsoever* for leaving it, and calls the step done.

Resolve one of three ways, not by re-arguing the default:
1. Seed classifications for the existing operational categories in the migration, as an explicit,
   reviewable per-category list (not a name-matching heuristic — the spec's own last failure mode
   rightly forbids that).
2. Bring the write path into scope: `PATCH /api/categories` accepts `control_mode`, with negative
   controls for the coupling `CHECK` on update, not only on insert.
3. State plainly that the scored set ships empty by design, name the task that fills it, and record
   in `ITEM.md` that step 29 is blocked until it lands.

**Note the update-path hole this exposes regardless of which is chosen.** Every one of #13–18 is an
`INSERT`. A `CHECK` constraint does police `UPDATE`, but nothing in the spec asserts it, and option
2 would make `UPDATE` the primary way a row ever reaches `discretionary`. Add an `UPDATE`-shaped
negative control for the coupling constraint.

## G0 review 2 — draft 2, 2026-09-01 — **FAIL** (one new finding + pending sign-off)

### Draft 1's four findings: all fixed, each re-verified rather than accepted

| Finding | Fix in draft 2 | My verification |
|---|---|---|
| G0-1 psql exit code | #15/#16/#17 now expect `1`; new #19 also `1` | Re-ran the #19 *shape* — `INSERT` then a CHECK-violating `UPDATE` inside one `-c` — → **exit 1**. Matches. |
| G0-2 T1 Docker | Restated as "a throwaway Postgres reachable via `DATABASE_URL`", Docker explicitly not required, verified by `psql -c "SELECT 1;"` | Runnable; `b8_roundtrip_p0528` satisfies it. |
| G0-3 exact test total | #2 now asserts exit 0 with no total | Correct — #3–8 carry the specific guarantee. |
| G0-4 empty scored set | 21-row literal seed in the migration; #20–22 verify it; #19 adds the `UPDATE` control | Seed present, keyed on exact name, no heuristic. NC #13 fails a no-op seed. |

The spec-writer did not claim to have run the psql correction it could not run, and said so explicitly
— correct conduct under §5.2's no-Bash grant, and it reasoned out *why* `-c` yields 1 rather than
merely copying my number.

### [BLOCK] G0-5 — acceptance #20 is one-shot; it fails on the second run

#20 inserts 21 placeholder rows under today's real category names, then runs `npx node-pg-migrate up`.
Expected: both steps exit 0. Measured against the throwaway:

| Run | Result |
|---|---|
| First insert of a given `(name, landscape)` | exit **0** |
| Second insert of the same pair | **exit 1** — `duplicate key value violates unique constraint "budget_categories_name_landscape_key"` |

`budget_categories` carries `UNIQUE (name, landscape)`, and #20's 21 tuples are a single `INSERT`
statement, so one duplicate aborts the whole statement. The command therefore passes exactly once
against a database in T1's precondition state and fails every time after — including when **I** re-run
it at G2, which §7.3 requires me to do independently of the implementer. A correct implementation
would go red in my hands purely because the implementer ran the command first.

The `migrate up` half compounds it: once this task's migration is applied, a re-run is a no-op, so the
seed would not reach any newly inserted rows even if the duplicates were cleared.

This also makes #21 and #22 order-dependent on #20 without saying so.

Fix: make #20 self-resetting — establish the T1 precondition inside the command (drop/recreate, or
`DELETE FROM budget_categories` followed by a migrate-down to the pre-task point, then re-apply) so
the sequence is deterministic and re-runnable by anyone, in any order, any number of times. State the
#20→#21→#22 ordering explicitly.

Two smaller notes to fold in, neither blocking on its own:
- #20 omits `-v ON_ERROR_STOP=1`. A single-statement `-c` does surface the error as exit 1 (measured),
  so it is not currently unsound, but the flag is present on every other psql command here and its
  absence reads as an oversight rather than a decision.
- #22's expected block renders `<br>` literally in the markdown table. Cosmetic; make it a fenced
  block so the expected output is unambiguous to whoever re-runs it.

### Not a defect — recorded so it is not re-raised

The seed writes real category *names* into a committed migration. This does not violate `ITEM.md`'s
constraint, which is about amounts, balances and valuations; names are structural. Draft 2 keeps every
figure fabricated ($1 placeholders) and asserts on no real amount. Flagged to the owner separately.

### Pending — owner sign-off on 8 seed classifications

Draft 2 marks 8 of 21 rows debatable: `Education`, `Grocery`, `Health`, `One time`, `Property Taxes`,
`Shared expenses`, `Transportation`, `Utilities/Maintenance`. It is correct that it did not present
these as settled. G0 cannot pass while a value the migration will write is unreviewed — the seed is
the "deciding" this step exists to do, so an unreviewed seed is the same defect as an empty one
wearing better clothes. Put to the owner; draft 3 folds in the answers alongside the G0-5 fix.

The spec-writer deliberately drew #22's six spot-checks from the 13 **non**-debatable rows, so the
verification mechanism does not move when the 8 are settled. That is the right construction.

## G0 review 3 — draft 3, 2026-09-01 — **PASS**. Spec frozen.

### G0-5 fixed, verified by running it rather than reading it

Draft 3 rewrites #20 to `dropdb --if-exists && createdb`, then `node-pg-migrate up 1787871600000
--timestamp` to land at the pre-this-migration state, then the 21-row insert, then a plain `up`.
I ran the whole command end to end three consecutive times:

| Run | Exit | Rows |
|---|---|---|
| 1 | 0 | 21 |
| 2 | 0 | 21 |
| 3 | 0 | 21 |

Draft 2's shape produced exit 1 on run 2. Precondition confirmed exact after the final run:
`pgmigrations` ends at `1787871600000_tenant-held-funds`, and
`information_schema.columns` reports `control_mode` **absent** — so #20 hands the implementer's
migration precisely the state the spec claims, with no residue from a prior run.

T3 (`CREATEDB` privilege) verified: `dropdb --if-exists b8_seed_probe_p0528 && createdb ...` → OK.
The two-database split (`$DATABASE_URL` → `b8_roundtrip_p0528` for #13–19 and the G1/G4 round-trip;
`$PROBE_DATABASE_URL` → `b8_seed_probe_p0528` for #20–22) is sound: the probe is dropped and rebuilt
per run, so it can never contaminate the round-trip database.

### Full §7.1 checklist

| Item | Verdict |
|---|---|
| Acceptance commands literal, runnable from root, deterministic | ✅ #1/#2/#9–12 and the `--reporter=verbose` filter run by me; #13–19's shapes run against real violations; #20 run three times |
| Every referenced script, test path, module exists | ✅ `lint`/`test`/`migrate:*` real; #12's anchor string at `app/api/categories/route.ts:11`; `lib/` filter resolves to 17 files / 262 tests |
| Non-goals stated and specific | ✅ 10, naming real files |
| Contracts-touched present | ✅ 4 rows with change classes |
| Conventions state sign, rounding, landscape/exclusions, null semantics | ✅ all four, plus the coupling and the seed rationale |
| Failure modes enumerated | ✅ 12 |
| No command passes vacuously | ✅ per-command analysis; #22 is what a no-op seed fails |
| Every prose rule carries a negative control | ✅ 16 NCs, incl. #16 for idempotency |
| Every toolchain row verified by a command I ran | ✅ T1–T4 measured; T5/T6 declared NO |

**Seed sign-off:** owner accepted all 21 rows exactly as proposed on 2026-09-01, including the 8
flagged debatable. Recorded in the spec's Seed classification table.

**Nit, not blocking, carried to `NITS.md` rather than a fourth draft:** draft 3 still rendered #22's
expected output inside a table cell. I moved it to a fenced block below the table when persisting —
a presentation change to the orchestrator's own copy, no change to any command or expected value.

### [PROCESS DEFECT P-1] The G0 freeze is enforced against Edit and Write, not against Bash

Found while auditing the freeze I had just applied, by probing the hook directly:

| Payload | Expected | Measured |
|---|---|---|
| `Edit` frozen `SPEC.md` | BLOCK (2) | **2** ✅ |
| `Write` frozen `SPEC.md` | BLOCK (2) | **2** ✅ |
| `Bash` `sed -i` on frozen `SPEC.md` | BLOCK (2) | **0 — ALLOWED** ❌ |
| `Bash` `> SPEC.md` | BLOCK (2) | **0 — ALLOWED** ❌ |
| `Edit` `GATES.md` | ALLOW (0) | 0 ✅ |
| `Edit` contract surface, no lease | BLOCK (2) | 2 ✅ |
| `Bash` write to contract surface, no lease | BLOCK (2) | 2 ✅ (it blocked my own probe harness) |

**Cause established by reading the code, not inferred from the behaviour** (§5.1 causal-claim rule):
`checkBash` loops over `GENERATED_PREFIXES`/`GENERATED_FILES` and `CONTRACT_PREFIXES`/`CONTRACT_FILES`
and has **no frozen-spec branch at all**. `checkPath` — the Edit/Write route — carries both the
contract check and the frozen-spec check. The omission is in `checkBash` specifically, not in the
freeze detection, which works.

**Why this matters here and now.** The implementer is the one role holding Bash (§4), and it is the
next agent to be dispatched on this task. BUILD.md §13.2 exists precisely because "the implementer
holds Bash, so `sed -i`, `>`, `tee`, `cp` and friends are a live bypass of any Edit/Write-only rule"
— and the hook's own header claims "Bash is matched too." For the contract surface that claim holds.
For the frozen spec it does not. I3 and the §6 freeze currently rest on the implementer's good
intentions, which is the thing I2 says a hook exists to replace.

**This is not a defect in P0.5-28.** It is a defect in the delivery system, surfaced by running it.
Note also that P0-09a's gate log records "freeze verified enforced by the hook — Edit on SPEC.md →
exit 2, GATES.md → exit 0": true, and tested only the Edit route, so the gap has been present since
the system shipped and was recorded as verified on incomplete evidence. Raised to the owner before
the implementer is dispatched.

## P-1 fixed, 2026-09-01 — before the implementer was dispatched

Owner chose "fix the hook first." Change to `.claude/hooks/scope-guard.mjs`, three edits:

1. `readdirSync` added to the `node:fs` import.
2. New `frozenSpecPaths(root)` helper — enumerates `plan/tasks/*/SPEC.md` for every task dir
   carrying a `.frozen` marker. The Edit/Write route resolves one concrete path and asks
   `specIsFrozen` about it; a shell command names no path the hook can resolve, so the Bash route
   must enumerate instead.
3. A frozen-spec loop in `checkBash`, **placed ahead of the `leaseHolder(root) !== null` early
   return**. That placement is the load-bearing part: the lease opens the *contract surface* to the
   guardian and must never open a *spec*. Behind the early return, a frozen spec would have been
   writable via Bash for the whole G1 window.

**Verified, not assumed** — the same probe that found the defect, re-run:

| Route | Before | After |
|---|---|---|
| `Edit` frozen SPEC.md | 2 | 2 |
| `Write` frozen SPEC.md | 2 | 2 |
| `Bash` `sed -i` on frozen SPEC.md | **0** | **2** |
| `Bash` `>` into frozen SPEC.md | **0** | **2** |
| `Edit` GATES.md | 0 | 0 |
| `Edit` lib/domain module | 0 | 0 |

Regression check: the hook's own suite, `npx vitest run .claude/hooks/scope-guard.test.mts` →
**36 passed**, unchanged.

Lease-window check, which is what the placement decision rests on: with
`.claude/bin/lease open P0.5-28-category-control-mode` **held**, the contract-surface rows correctly
flip to allowed (0) — the guardian's window working as designed — while all four frozen-spec rows
stay blocked (2). The freeze survives the lease.

Not covered: `.claude/hooks/scope-guard.test.mts` still has no case for the Bash freeze route, so
this fix is protected by a probe I ran, not by a committed test. The owner declined extending the
test suite for now; it is the reason the gap was invisible, and it remains the reason a future
refactor could reopen it. Recorded here rather than silently dropped.

## G1 review — 2026-09-01 — **PASS**. Lease closed.

### §7.2 checklist

| Item | Verdict |
|---|---|
| Diff minimal, confined to the contract surface | ✅ `git status` shows exactly `shared/types.ts`, `db/schema.sql`, and the new `migrations/1788271200000_category-control-mode.sql`. No `lib/`, `app/`, `components/`, no test. (`.claude/` and `plan/` in the tree are the orchestrator's P-1 fix and task record, not the guardian's.) |
| Change class matches | ✅ adjudicated below rather than inherited |
| `migrate up/down/up` clean | ✅ against `b8_roundtrip_p0528`, never `.env.local` |
| Consumers intact | ✅ `tsc --noEmit` exit 0; 18 files / 298 tests; lint exit 0 with the one pre-existing warning |

**Round-trip, measured:** `up` → column present. `down` → column gone (0) **and** both constraints gone (0), so the down is complete rather than leaving orphaned constraints. `up` again → column back, both constraints back, named `budget_categories_control_mode_check` and `budget_categories_debt_service_control_mode_check` exactly as the guardian stated.

**Seed transcription verified mechanically, not by eye.** Extracted the 21 `(name, control_mode)` pairs from the migration and the 21 rows from the frozen spec's signed-off table, sorted both, diffed: **identical, 21/21**. Distribution: 9 `discretionary`, 7 `variable-necessary`, 5 `fixed`. The resulting scored set is **9 categories** (Clothes/Beauty, Education, Entertainment, Home improvements, Pocket money, Restoraunts, Sport, Toys/Gifts/Flowers, Travel) — non-empty, which is the whole point of the G0-4 resolution.

**Constraints verified by executing them.** The guardian holds no Bash and could not run its own DDL, so I ran all seven controls against the migrated throwaway:

| # | Result | Want |
|---|---|---|
| 13 default on operational insert | prints `fixed`, exit 0 | 0 ✅ |
| 14 default on capital insert | prints `fixed`, exit 0 | 0 ✅ |
| 15 bad enum value | exit 1 | 1 ✅ |
| 16 explicit NULL | exit 1 | 1 ✅ |
| 17 coupling, INSERT | exit 1 | 1 ✅ |
| 18 coupling accept-case | prints `fixed`, exit 0 | 0 ✅ |
| 19 coupling, UPDATE | exit 1 | 1 ✅ |

### Adjudication — change class: **additive**, upheld on evidence

The guardian did the right thing in refusing to rubber-stamp the spec's label: §9.2 by the letter files "new required field" and "new `NOT NULL` column" under **breaking**. I am upholding **additive**, and not by argument — §9.2's breaking class is defined by what a change does to producers, so the discriminating question is whether any producer breaks.

| Claim in dispute | Discriminating command | Output | Decision |
|---|---|---|---|
| Does a `NOT NULL` column break existing `INSERT`s? | acceptance #13 — insert naming only `(name, annual_budget, landscape)`, the exact shape `POST /api/categories` uses | exit 0, `control_mode` = `fixed` | No. `DEFAULT` absorbs it. |
| Does a required TS field break any consumer? | `npx tsc --noEmit` | exit 0 | No. |
| Is there an object literal typed `BudgetCategory` to break? | `grep -rn ': BudgetCategory *=' lib app components shared scripts` | no matches | No. |

§9.2's prescribed mitigation for the breaking case — nullable, backfill, tighten later — is correctly **not** used: it would put a NULL `control_mode` in the database between the two migrations, and a NULL here is the fourth unnamed mode this task exists to remove. The `DEFAULT` reaches the same "no producer breaks" endpoint in one statement.

### Adjudication — the guardian's parser hypothesis: **REFUTED**, and the inverse is real

The guardian flagged, explicitly as a hypothesis it could not run, that a wrapped comment beginning `-- up migration above,` inside the Down section might be read as a second Up marker and silently truncate the down migration. It was right to label it a hypothesis. I ran it.

`node-pg-migrate`'s splitter (`dist/bundle/index.js:2690`) is `new RegExp('^\\s*--[\\s-]*' + direction + '\\s+migration', 'im')` applied via `content.search()` — which returns the **first** match only. The real `-- Up Migration` sits at offset 0, so a later `-- up migration ...` line is never seen.

| Case | Result |
|---|---|
| **A** — stray `-- up migration above,` inside the Down body (the hypothesis) | `up` 0, `down` 0, table dropped → down ran in full. **REFUTED.** |
| **B** — stray `-- down migration is below` inside the **Up** body | `up` exits **0**, first table created, **second table never created**. **CONFIRMED.** |

**Case B is a live, silent partial-application hazard** and nobody had considered it: any comment line matching `^\s*--[\s-]*down\s+migration` in an Up body truncates the Up there and still exits 0. Given how heavily commented this repo's migrations are, that is reachable.

Scanned all 8 migrations: every one has exactly one up marker and one down marker. **No live instance, including this task's.** Recorded to `NITS.md` as a CI/hook candidate — the check is one regex over `migrations/*.sql`.

The guardian's instinct was sound and its reasoning direction was backwards; investigating it is what surfaced the real defect. Logged as a refutation, not a criticism.

### Guardian's other reported items, verified

| # | Claim | Verified |
|---|---|---|
| 1 | `app/categories/page.tsx:9` will hold a type lie — its own explicit-column `SELECT` omits `control_mode` while the type requires it | ✅ confirmed at line 9. Inert (nothing reads it), file is an explicit spec non-goal. → `NITS.md`; repair is the `SELECT`, never the type |
| 2 | `POST` satisfies the new shape via `RETURNING *` | ✅ confirmed at `route.ts:32` |
| 3 | `shared/types.ts` is missing `is_debt_service` and `sort_order` — the same drift as `db/schema.sql`, only half in scope | ✅ confirmed. Correctly left alone; minimal diff. → follow-up task |
| 4 | Wrote the migration file by hand (no Bash for `migrate:create`); timestamp `1788271200000` > `1787871600000` | ✅ ordering confirmed — acceptance #20's `up 1787871600000 --timestamp` lands at the pre-this-migration state precisely because of it |
| 6 | The coupling CHECK can abort the migration on a contradictory operational row, by design | ✅ upheld as intended; no such row in dev, throwaway, or #20's probe |

The CSV-backup projection the guardian specified for the implementer (id/name/landscape/flags, deliberately no amounts) is sound and carries to G2.

**Lease closed. The contract surface is frozen for the remainder of this task.**
