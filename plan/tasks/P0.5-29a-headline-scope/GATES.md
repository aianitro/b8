# GATES — P0.5-29a-headline-scope
<!-- Append-only audit trail. The process analogue of this app's own append-only observation
     tables: the record of what happened is worth more than a summary of it. -->

| Gate | Result | When | Evidence |
|---|---|---|---|
| G0 spec | **PASS** | 2026-09-01T18:52Z | Orchestrator re-ran the load-bearing commands itself rather than accepting the spec-writer's measurements. See the G0 log below. |
| G1 contract | **SKIP** | 2026-09-01T18:52Z | Contracts touched: none. `lib/domain/adherence.ts` is `lib/**`, not the contract surface (BUILD.md §2); `ScoredHeadline` is module-local, matching `DriftFinding`/`PropertyPnl`. Verified no importer outside its own test: `grep -rn scoredHeadline app components lib shared scripts .claude` → `lib/domain/adherence.ts` and `lib/domain/adherence.test.ts` only. No lease opened. Re-opens if the implementer reports a contract change is genuinely required. |
| G2 build (cycle 0) | **PASS** | 2026-09-01T22:40Z | All 30 acceptance commands re-run by the orchestrator. `tsc` exit 0, `eslint` 0 errors, suite `19 passed (19)` / `344 passed (344)`, diff exactly the two declared files. See the G2 log. |
| G3 adversarial (cycle 0) | **BLOCK** | 2026-09-01T22:50Z | Verdict ACCEPT_WITH_NITS, falsification log of 18 hypotheses (13 refuted, 5 confirmed) — review accepted as sound. Orchestrator **escalates N22 from nit to block** on its own executed evidence. Cycle 1/3. |
| G3 adversarial (cycle 1) | **PASS** | 2026-09-01T23:20Z | Targeted re-review of the delta. ACCEPT_WITH_NITS, **findings: []**, falsification log of 11 hypotheses (9 refuted, 2 confirmed as nits N27–N29). Reviewer re-derived the `-2^-57` residue from IEEE-754 rather than trusting the comment, and independently confirmed the orchestrator's ruling on the withdrawn fixture. |
| G4 integration | **PASS** | 2026-09-01T23:30Z | Suite, tsc, lint, production build, migration round-trip on a throwaway, truthfulness invariant, no real data. **One tree defect found and fixed at this gate — see the G4 log.** |

**Cycle count:** 0 / 3
<!-- G2/G3-BLOCK/G4 failures increment. A reviewer-fault (empty falsification log) does NOT. -->

## G0 log — what was checked, and what would catch a stub

**Template completeness.** All eleven `plan/tasks/.templates/SPEC.md` sections present, plus one
addition ("The four open questions, decided"). Non-goals are specific and name the files an
implementer would plausibly reach for (`components/BudgetMonthlyGrid.tsx`, `scripts/seed-demo.mjs`,
`lib/budgetColors.ts`). Contracts-touched present and "none".

**Toolchain rows re-measured by the orchestrator** (clean tree, `7344713`):

| Row | Command | Measured |
|---|---|---|
| T2 | `npx vitest run` / `npx tsc --noEmit` | `19 passed (19)`, `332 passed (332)`, exit 0 |
| T3 | verbose ✓-count on `lib/domain/adherence.test.ts` | `34` |
| T5 | `npm test 2>&1 \| grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"` | `1` |
| T6 | unused `@ts-expect-error` under this tsconfig | `error TS2578: Unused '@ts-expect-error' directive.` |
| T8 | `grep -F '"test": "vitest run"' package.json` | present |
| T4 | `npx tsc --noEmit --listFiles \| grep -c "adherence.test 2.ts"` | **`1` — blocker, unresolved at G0; see below** |

**Non-vacuity — the check G0 cares most about.** A command returning the expected `0` on today's
tree proves nothing on its own: a pattern that matches *nothing* returns `0` too. P0.5-29 shipped a
G0 failure of exactly this shape (`grep -cE "new Date\(\|Date\.now\("` — `\|` is a literal pipe in
an ERE, so the command enforced nothing). Each static command was therefore tested in **both**
directions:

| Cmd | Negative case | Positive case |
|---|---|---|
| #19 clock read | `lib/domain/adherence.ts` → `0` | `lib/netWorth.ts` → `1` (a file that does read the clock) |
| #22 corrected signature | current `adherence.ts` → `0`; scratch file holding the **old** signature → `0` | scratch file holding the target line → `1` |
| #18 / #21 / #23 | `budgetColors` → `0`, `scoredCategoryCount` → `0` | `findingCount` → `2` today, so #21's `0` is a real transition |
| #30 scope | clean tree → `0` | excludes untracked paths, so resolving T4 by deletion cannot make it pass falsely |

**Do #4–#17 assert that a test *passed*, or only that it exists?** The verbose reporter prints the
name of a failing or skipped test too, so `grep -cF "<name>"` alone is satisfied by a red test. The
spec leans on #2/#3 to close this. Verified by running a forced-skip:
`npx vitest run --pool=threads lib/domain/adherence.test.ts -t "orders a category"` →
`Tests  1 passed | 33 skipped (34)`, and that line scores `0` against #2's anchored pattern. The
pairing holds: #2 fails on any skip or failure anywhere, so #4–#17 do mean "present and green".

**Fixture arithmetic re-derived independently** under `roundCents(n) = Math.round(n*100)/100`.
A: `99.99`/mo → `budgeted 1199.88`, `actual 1100`, `variance -99.88`, `ratio -0.08324165749908323`
(and `90/99.99 = 0.90009` — above the 0.5 chronic threshold, so `defectCount 0` is right).
B: `-1/12` exactly. C: `3600 / 1830 / -1770`, ratio `-0.49166666666666664`. J: `999.96 / 240 /
-759.96`, ratio `-0.7599903996159847`, against `-0.76` for raw-float totals. H: `300`, `-0.5`.
All match the spec.

Fixture C's stated old-value pin `not.toBeCloseTo(-0.6222222222222222, 6)` was initially read as
wrong — see Adjudications.

**Correction applied before freezing.** Line 42 cross-referenced the `findingCount` absence check as
"Acceptance #15"; #15 is the binding numeric test and #21 is that grep. Corrected #15 → #21. The
command table was already right, so no command changed — this was a pointer that would have sent an
implementer to the wrong row. Recorded here rather than absorbed silently.

**Not fixed, carried as known:** the spec's own header for #4–#17 abbreviates the shared prefix as
`…`; the implementer must expand it. Called out in the spec, so not a G0 failure.

## Adjudications
<!-- Disputes settled by a discriminating command, never by argument (BUILD.md §5.1).
     A disposition may not be recorded as "verified" unless the causal claim behind it was
     itself run as a command. Otherwise it is recorded as a hypothesis. -->
| Claim in dispute | Discriminating command | Output | Decision |
|---|---|---|---|
| Fixture C's old-value pin `varianceRatio not.toBeCloseTo(-0.6222222222222222)` looked wrong: `-1770/2700 = -0.6555…` | `node -e` computing the old implementation's **own** numerator, not the new one: old `actual` is the sum of *finding* actuals (`3×140 + 600 = 1020`), old `budgeted` is `3×100 + 2400 = 2700`, so old ratio `= (1020-2700)/2700` | `-0.6222222222222222` | **Spec upheld.** The orchestrator's first derivation mixed scopes — new numerator over old denominator — which is the very error N11 is made of. The pin is correct as written. |

## T4 resolution — recorded before dispatch, per SPEC "Evidence required"

**What was done, and by whom.** The orchestrator moved `lib/domain/adherence.test 2.ts` (untracked
Finder/iCloud duplicate, 26,229 bytes) out of the tree to the session scratchpad at
`…/scratchpad/quarantine/adherence.test 2.ts`. It was not deleted, not edited, and not committed;
the implementer never sees it and must not recreate or reference it.

**Why it had to go before dispatch, demonstrated rather than asserted.** The duplicate is invisible
to vitest (`lib/**/*.test.ts` does not match `…test 2.ts` — `npx vitest list | grep -c "adherence.test 2"`
→ `0`) but visible to tsc (`tsconfig.json` includes `**/*.ts`), and its line 12 imports the **real**
module. The orchestrator copied the real module and the duplicate into a scratch directory, applied
**only** the signature change SPEC Q1 mandates, and ran tsc:

```
dup.test.ts(488,37): error TS2345: Argument of type 'AdherenceFinding[]' is not assignable
  to parameter of type 'AdherenceInput[]'.
    Type 'BreachFinding' is missing the following properties from type 'ScorableCategory':
    landscape, exclude_from_budget, is_income, control_mode
```

Three occurrences (488, 497, 510), and a fourth error would join at line 500 once `findingCount`
leaves the struct. So acceptance #1 would have gone red on a file outside the diff — the failure
mode that invites an implementer to edit the duplicate or weaken the gate, either of which would
have destroyed #1's pairing with #14/#20/#22 (TS2578). Scratch reproduction deleted; repo untouched
by it.

**Re-measured after the move:**

| Check | Command | Result |
|---|---|---|
| T4 cleared | `npx tsc --noEmit --listFiles \| grep -c "adherence.test 2.ts"` | `0` (was `1`) |
| Baseline tsc | `npx tsc --noEmit` | exit `0` |
| Baseline suite | `npx vitest run` | `19 passed (19)`, `332 passed (332)` — unchanged |
| Acceptance #30 | `git diff --name-only HEAD \| grep -vE '^(lib/domain/adherence(\.test)?\.ts\|plan/)' \| wc -l` | `0` |

**Rollback note.** Per SPEC §Rollback, this move is *not* part of the task's revert. If P0.5-29a is
ever reverted, restoring the duplicate would reintroduce a tsc failure against whichever signature
is current at that moment. It is tree hygiene, owned by the orchestrator, authorised by the owner
on 2026-09-01.

**Ten further ` 2.` duplicates remain** (`lib/domain/adherence 2.ts`, and markdown/SQL under
`plan/` and `migrations/`). None is load-bearing: `adherence 2.ts` is self-contained, and nothing
compiles the rest. Left in place deliberately.

## G2 log — every acceptance command re-run by the orchestrator

Re-run rather than read off `EVIDENCE.md`: the implementer's report is an input to this gate, not
the gate itself.

| Command | Expected | Measured |
|---|---|---|
| #1 `npx tsc --noEmit` | exit 0 | exit `0` |
| #2 whole suite, nothing skipped | `1` | `1` — `Test Files 19 passed (19)`, `Tests 344 passed (344)` |
| #3 verbose ✓-count `-ge 46` | `OK` | `46` → `OK` (see Adjudication A2) |
| #4–#17 the fourteen new/changed test names | `1` each | `1` each |
| #18 `budgetColors` | `0` | `0` |
| #19 clock read | `0` | `0` |
| #20 `@ts-expect-error` directive | `1` | `1` |
| #21 `findingCount` | `0` | `0` (was `2` at G0 — a real transition, not a dead pattern) |
| #22 corrected signature | `1` | `1` |
| #23 `scoredCategoryCount` `-ge 2` | `OK` | `3` → `OK` |
| #24–#28 five inherited neighbour tests, verbatim | `1` each | `1` each |
| #29 both files changed | `2` | `2` |
| #30 nothing else tracked changed | `0` | `0` |

**Lint (G2 requires it, the spec's commands do not).** `npm run lint` → `0 errors, 1 warning`. The
warning is `scripts/seed-demo.mjs:438` `'pid' is assigned a value but never used` — pre-existing,
in a file this task did not touch and acceptance #30 confirms was not modified.

**The 32-unchanged claim, verified mechanically rather than accepted.** Test names extracted from
`git show HEAD:lib/domain/adherence.test.ts` and from the working tree, sorted and set-compared:
34 old, 46 new, **32 kept verbatim**, 14 added, and exactly **two** removed —
`reports null for the variance ratio when every scored finding sits on a month that budgeted nothing`
and `the scored-set headline is null, not zero or NaN, when no finding in the input belongs to the
scored set`. Precisely the two the spec named, and no `isScoredCategory` or `detectAdherence` test
among them. ITEM.md requirement 4 satisfied as a measurement.

**Read for domain constraints, not only for green.** Gate is `isScoredCategory` (four conjuncts);
range is `row.months` via a shared `monthVariances(row)` that `detectAdherence` now also uses, so
the two readers cannot drift; totals are `sumCents` over already-rounded per-month figures;
`varianceRatio` comes from the two rounded totals and is not itself rounded; `withoutNegativeZero`
normalises `-0` on both `variance` and `varianceRatio`. Counts are taken from
`detectAdherence(scoredRows)` rather than a second copy of the thresholds — one definition of what
a breach is. Carried to G3 as a question rather than a finding: see A3.

## Adjudications — appended at G2
| Claim in dispute | Discriminating command | Output | Decision |
|---|---|---|---|
| **A2.** Acceptance #3 returned `0`, not `≥46` — apparent G2 FAIL, and it had measured `34` under the same command at G0 | The orchestrator's batch had put the shared prefix in a shell variable (`C=$($V 2>&1 \| grep -cE …)`). Re-ran the spec's **literal** inline form: `test $(npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 \| grep -cE "✓ lib/domain/adherence\.test\.ts") -ge 46` | literal form → `46`, `OK`; variable form → `0` | **Orchestrator error, not an implementation defect.** The failure was in the gate's own command construction. Recorded because a fabricated FAIL sent back to the implementer would have cost a cycle and taught the wrong lesson — and because "the gate misfired" is exactly the disposition that must never be inferred without running the discriminating command. |
| **A3.** `varianceRatio: budgeted > 0 ? … : null` vs the spec's "null **if and only if** `budgeted === 0`" | Not adjudicated at G2 — the two predicates diverge only for a **negative** total budget, and no fixture produces one | — | **Carried to G3 as an open question**, not ruled on. Whether a negative `annual_budget` or `monthly_amounts` entry is reachable is a domain question for the adversarial reviewer; recording it as "verified equivalent" without a command that reaches the case would violate BUILD.md §5.1's causal-claim rule. |

## G3 log — the review, and where the orchestrator went stricter than it

**The review itself passes.** Verdict `ACCEPT_WITH_NITS`, falsification log of 18 hypotheses with
13 refuted and 5 confirmed, each carrying method and outcome. Refuted-hypothesis work is real, not
decorative — the subsumption claim was checked against the predicates rather than the comment, the
`monthVariances` extraction was byte-compared against the removed inline block, and `variance ==
actual − budgeted` was sampled over 200,000 randomized cent fixtures. An empty log would have been a
process defect and sent the review back; this is the opposite.

**Both INCONCLUSIVE items were run by the orchestrator rather than carried.** §7.5 requires it, and
the causal-claim rule forbids recording either as settled on a prediction.

### N22 — run, and it converts the finding from a nit into a block

The reviewer predicted that deleting `withoutNegativeZero` leaves all 30 acceptance commands green.
**Measured, by mutating the module and running the suite:**

| | `variance` | `varianceRatio` | suite |
|---|---|---|---|
| guard removed | `Object.is(v, -0)` → **`true`** | **`true`** | `19 passed (19)`, **`344 passed (344)`** — #1 exit 0, #2 → `1`, #3 → `46`, **#4 → `1`** |
| guard present | `false` | `false` | same 344 green |

Probe input (fabricated): `monthly_amounts` `[100 × 12]`, months `[{0, 100.01}, {1, 99.93},
{2, 100.06}]` → `budgeted 300`, `actual 300`. Per-month variances `[0.01, −0.07, 0.06]` sum to
`−6.94e-18`, and `roundCents` of that is `-0`. A surface renders **"-0.0% under" for a category
exactly on budget**.

So the guard is load-bearing and correct, and **acceptance #4 — the command the spec names as the
negative control for it (Negative controls table, row 10) — passes identically with the guard
deleted.** Fixture D's per-month variances are each exactly `+0`, and `+0 + +0` is `+0`
deterministically, so the fixture never reaches the case its own assertion claims to gate.

**Why this is a block and not a nit, overruling the reviewer's own grading.** BUILD.md §5.5: *"is
any acceptance command satisfiable without the intended behaviour existing? A command that passes
vacuously is a gate that does not exist."* And §5.4: *"Tests accompany code in the same task. There
is no follow-up 'add tests' task; the reviewer treats untested behaviour as unverified behaviour."*
The spec's own rule — *"Every rule you state in prose carries a negative control"* — is satisfied in
name and not in substance here. The code is right; the gate protecting it is absent, so nothing
stops a later refactor from deleting the guard with a green suite. Returned to the implementer for
one targeted test. **Cycle 1/3.**

Mutation fully reverted: `sha256(lib/domain/adherence.ts)` `c3c9f47c…c65b1` before and after,
byte-identical. Probe file `lib/domain/__negzero_probe.test.ts` created and removed; #29 → `2` and
#30 → `0` re-measured on the cleaned tree.

### N21 / A3 — run, and it resolves G2's open question against the spec, not the code

Probe: a scored row with `annual_budget: -1200`, `monthly_amounts: null`, twelve months at `50`.

```
{ budgeted: -1200, actual: 600, variance: 1800, ratio: null, breaches: 12 }
```

No throw. The code's `budgeted > 0 ? … : null` yields `null`; the spec's literal *"null if and only
if `budgeted === 0`"* would yield `1800 / −1200 = −1.5` — **"150% under budget" for a category that
spent $600**, a sign inversion the spec's own convention section forbids outright. SPEC.md Q3's
prose separately endorses `budgeted > 0 ? … : null` verbatim, so the spec contradicts itself and the
code took the safer branch.

**A3 ruled: the implementation is correct and the spec's wording is the defect.** No code change.
Recorded rather than silently reconciled, because the frozen spec cannot be edited and a future
reader will otherwise hit the same contradiction. The residual — `budgeted: -1200` and
`variance: 1800` still emitted as-is — is inherited from P0.5-29 and belongs to step 31's caller
contract, tracked as N21.

## Adjudications — appended at G3
| Claim in dispute | Discriminating command | Output | Decision |
|---|---|---|---|
| **A4.** Reviewer grades N22 a nit ("code correct, gate absent"); orchestrator grades it a block | Mutate: strip `withoutNegativeZero` at both call sites, run all 30 acceptance commands; then probe `-0` reachability with and without the guard | guard removed → `344 passed`, #4 → `1`, and `Object.is(variance, -0)` → `true`; guard present → `false` | **Block.** Grading a vacuous negative control as a nit is the "looks good to me" outcome the architecture exists to convert into a checkable artifact. Not an overrule of a BLOCK by argument — the orchestrator went *stricter*, on executed evidence, which §5.1 permits and §5.5 requires. |
| **A5.** A3, carried unresolved from G2 | `scoredHeadline` probe on `annual_budget: -1200` | `{budgeted: -1200, actual: 600, variance: 1800, ratio: null}`, no throw | **Code upheld, spec's wording ruled defective.** The spec's literal rule would emit a sign-inverted "150% under". Hypothesis at G2, verified at G3 by execution — the distinction the causal-claim rule turns on. |

## G2 (cycle 1) — the N22 fix, re-measured

| Gate | Result | When | Evidence |
|---|---|---|---|
| G2 build (cycle 1) | **PASS** | 2026-09-01T23:05Z | Module byte-identical; one test added, one withdrawn on the orchestrator's ruling; all 30 commands re-run. |

`lib/domain/adherence.ts` sha256 `c3c9f47cc8581773cd98213abffde92ae7f16c3ac9f5b210f0b5765de7ac65b1` —
**unchanged from cycle 0**, verified before and after all three mutation runs. The entire cycle
landed in `lib/domain/adherence.test.ts`.

| Command | Measured |
|---|---|
| #1 `tsc` | exit `0` |
| #2 | `1` — `19 passed (19)`, `345 passed (345)` |
| #3 | `OK`, count `47` |
| #4 | `1` (still exactly one match — the new test's name cannot prefix-collide with Fixture D's) |
| #18 / #19 / #21 | `0` / `0` / `0` |
| #20 / #22 | `1` / `1` |
| #23 | `3` |
| #29 / #30 | `2` / `0` |
| withdrawn fixture gone | `grep -c "1e306\|overflows to infinity"` → `0` |

**Name-set diff vs `HEAD`, re-run:** 34 old, 47 new, **32 kept verbatim**, 2 removed (the two
documented renames, unchanged from cycle 0), 15 added. No existing test was modified in this cycle.

**Per-site mutation matrix, re-run by the orchestrator on the reduced suite:**

| Mutation | Suite | Red |
|---|---|---|
| `:466` removed | `1 failed \| 344 passed (345)` | the new float-dust test — `expected -0 to be +0 // Object.is equality` |
| `:483` removed | **`345 passed (345)` — green** | none, and this is the honest state |
| both removed | `1 failed \| 344 passed (345)` | the same one test, from `:466` alone |
| neither | `345 passed (345)` | — |

## Adjudications — appended at G2 cycle 1
| Claim in dispute | Discriminating command | Output | Decision |
|---|---|---|---|
| **A6.** The implementer's second test gated `:483` only by driving `budgeted` to `Infinity` via a `1e306` schedule, and asked whether that fixture is legitimate | Read the column types rather than reasoning about float limits: `grep -n "monthly_amounts\|annual_budget" db/schema.sql` | `:168 annual_budget NUMERIC(12, 2)`, `:176 monthly_amounts NUMERIC(12, 2)[]` — cap 9,999,999,999.99 per entry; twelve entries reach ~1.2e13 after `sumCents`, against `Number.MAX_VALUE` ≈ 1.8e308 | **Fixture ruled out of scope; test withdrawn, guard retained.** `budgeted === Infinity` is unreachable from a conforming row, so the test asserted semantics for an input the schema cannot produce. **N23 is confirmed in full, not half right.** |
| **A7.** Does withdrawing that test re-open the very gap the G3 BLOCK was raised over? | — (reasoning recorded, not a command; the empirical half is A4 and A6) | — | **No, and the distinction is the point.** A4 blocked because a *reachable* defect had a vacuous gate: `-0` genuinely escapes at `:466` and Fixture D never reached it. `:483` has no reachable defect for a legitimate fixture to gate. A test whose input cannot exist makes the suite look like it covers more than it does — the same failure as a vacuous gate, pointing the other way. `:483` is therefore retained as **deliberately ungated** belt-and-braces, recorded here so a later mutation sweep reads it as adjudicated rather than as a coverage hole. |

**Cycle count: 1 / 3.**

## G4 log — integration

| §7.5 item | Command | Result |
|---|---|---|
| Full suite | `npm test` | `Test Files 19 passed (19)`, `Tests 345 passed (345)` |
| Types | `npx tsc --noEmit` | exit `0` |
| Lint | `npm run lint` | `0 errors, 1 warning` — pre-existing, `scripts/seed-demo.mjs:438`, an untouched file |
| Production build | `npm run build` | succeeds; full route table emitted |
| Migration round-trip | `node-pg-migrate up → down 8 → up` on throwaway `b8_roundtrip_p0529a` | **clean: 8 applied → 0 → 8, 16 tables.** Throwaway dropped. See the defect below. |
| INCONCLUSIVE items | all run — cycle 0's three at G3, cycle 1's review returned none | recorded at G3 and below |
| Truthfulness invariant | `npx vitest run lib/domain/netWorth.test.ts lib/domain/drift.test.ts lib/netWorth.test.ts` | `44 passed (44)`. The module imports only `../budgetMath` and `../../shared/types` — it recomputes no shared concept independently. |
| No real financial data | `git diff HEAD -- lib/domain/adherence.test.ts \| grep "^+.*name: '" \| grep -vc Fabricated` | `0` — every added fixture name is `Fabricated …` |

**Standing hazard honoured.** `npm run migrate:up`/`migrate:down` read `--envPath .env.local`, which
points at the **dev database holding real financial data** (P0-09a and P0.5-28 both recorded this).
The round-trip was run with an explicit `DATABASE_URL` override to a throwaway; the dev URL never
entered the environment. Verified by echoing the override before and after.

### A tree defect found *by* this gate — `npm run migrate:up` was broken on any fresh database

The first round-trip attempt **failed**: `check_for_column_name_collision`, 0 migrations applied.
The migration list `node-pg-migrate` printed named the cause:

```
> - 1787871600000_tenant-held-funds
> - 1788271200000_category-control-mode 2      ← the Finder/iCloud duplicate
> - 1788271200000_category-control-mode
```

`node-pg-migrate` globs the directory, so the untracked duplicate was applied **first** and the real
migration then tried to add `control_mode` to a table that already had it.

**Causation proven before acting**, without touching the repo: `migrations/*.sql` was copied to a
scratch directory, the duplicate deleted from the copy, and the round-trip re-run with
`-m <scratch>` → `up → down 8 → up` clean, 16 tables, 8 migrations. With the duplicate present,
`up` fails immediately. That is the discriminating command §5.1 requires; the same conclusion read
off the file listing alone would have been a hypothesis.

**Disposition.** `migrations/1788271200000_category-control-mode 2.sql` moved to the session
quarantine alongside the earlier one. Untracked, so no tracked file changed and #30 stays `0`;
reversible with one `mv`. Round-trip then re-run against the **real** `migrations/` directory:
`8 → 0 → 8`, 16 tables, clean.

**Scope note.** This defect is not in the diff and did not fail because of it — it predates the task
and would have bitten the next person to provision a fresh database, run CI's migration step, or use
the Docker compose path. The dev database already has the history applied, which is exactly why it
stayed invisible. It is recorded here rather than in `NITS.md` because the fix was an
orchestrator-owned tree action, not an implementer finding. It also revises the judgement recorded
at T4, where ten remaining duplicates were called "not load-bearing: nothing compiles the rest" —
**wrong for the SQL one**, because `node-pg-migrate` globs rather than compiles. Eight duplicates
remain (`lib/domain/adherence 2.ts` and seven markdown files under `plan/`); none is reachable by a
glob that matters, which is now a measured claim for the two file classes tested rather than an
assumption about all of them.

## Adjudications — appended at G4
| Claim in dispute | Discriminating command | Output | Decision |
|---|---|---|---|
| **A8.** N27 predicts the new gate can be silently re-vacuumed: a `toFixed`-based `roundCents` would make `-0` unreachable while every assertion stays green, because `Number((-6.9e-18).toFixed(2))` is `+0` | `node -e` on the module's actual residue under both implementations | current `Math.round(n*100)/100` → `-0` (`Object.is` `true`); `Number((-6.938893903907228e-18).toFixed(2))` → **`-0`** (`Object.is` `true`) | **N27's stated mechanism is REFUTED** — the `toFixed` variant also yields `-0`, so that specific rewrite would leave the gate biting. The **general** fragility stands and the nit is kept: the gate's non-vacuity does rest on `roundCents`, which lives in `lib/budgetMath.ts`, a file this task does not own and whose tests pin no residue. Recorded so a future reader does not act on the refuted example. |
| **A9.** Review INCONCLUSIVE #3 (cycle 0): the negative-budget write path — is `POST /api/categories` really missing the guard `PATCH` has? | Read both handlers rather than running a server against a scratch DB | `route.ts:20` POST validates only `typeof annual_budget !== 'number'`; `:59-63` PATCH rejects with `annual_budget must be a non-negative number` | **CONFIRMED statically.** The asymmetry N21 names is real. Not run as a live request: it needs a server plus a scratch DB, the reachability question it answers is already settled by reading, and N21 is a step-31 caller-contract item, not a gate on this task. Recorded as read-verified, not as executed. |

**Cycle count: 1 / 3.** No escalation triggers hit.
