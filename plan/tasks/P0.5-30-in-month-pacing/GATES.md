# GATES — P0.5-30-in-month-pacing
<!-- Append-only audit trail. -->

| Gate | Result | When | Evidence |
|---|---|---|---|
| G0 spec | **PASS** | 2026-09-02 | 36 acceptance commands; the orchestrator re-ran every discriminating one in **both** directions rather than accepting the spec-writer's measurements. Two claims about the incumbent code verified independently. One scope conflict ruled. See the G0 log. |
| G1 contract | **SKIP** | 2026-09-02 | Contracts touched: none. `lib/domain/**` is not the contract surface (BUILD.md §2); `AsOf`/`CategoryPace` are module-local, matching `ScoredHeadline`/`DriftFinding`. Every column read (`annual_budget`, `monthly_amounts`, `control_mode`, `landscape`, `exclude_from_budget`, `is_income`) already exists. No lease opened. Re-opens if the implementer reports a contract change is genuinely required. |
| G2 build | **PASS** | 2026-09-02 | All 36 acceptance commands re-run by the orchestrator. `tsc` 0, lint 0 errors, `20 passed (20)` / `367 passed (367)`, adherence test file byte-identical, adherence diff exactly two `export` keywords. The implementer's one disclosed gap verified and ruled. See the G2 log. |
| G3 adversarial | **BLOCK** | 2026-09-02 | ACCEPT_WITH_NITS from the reviewer (N30–N39, 18 hypotheses, no defect constructible in shipped code). Orchestrator **escalates N31 to a block** on its own executed evidence, and **retracts its own G2 adjudication A3** as wrong. Cycle 1/3. |
| G4 integration | **PASS** | 2026-09-02 | Suite, tsc, lint, production build, migration round-trip on a throwaway, truthfulness invariant, no real data. Reviewer returned `inconclusive: []`, so none to convert. |

**Cycle count:** 0 / 3

## G0 log

**Template completeness.** All ten required sections present, plus three additions (the seven decided
questions, the signature-level shape, and the fixture-arithmetic table). Non-goals are specific and
name the files an implementer would reach for.

**Non-vacuity, tested in both directions.** A static command returning its expected `0` proves
nothing on its own — a pattern matching nothing returns `0` too, which is the G0 failure P0.5-29
shipped. Each was therefore given a positive case:

| Cmd | Negative | Positive |
|---|---|---|
| #23 even-spread reimplementation | clean file → `0` | file with `/ 12`, `/ MONTHS_PER_YEAR`, `/12` → `3` |
| #25a `Infinity` in code | — | 3 code forms → `3`, and a comment mentioning `Infinity` **not** counted (N16's point, honoured) |
| #26 clock read | `adherence.ts` → `0` | `lib/netWorth.ts` → `1` |
| #27 `categoryPacing` signature | `adherence.ts` → `0` | scratch file with the target line → `1` |
| #29 exported `budgetedForMonth` | current tree → `0` | exported form → `1` |
| #33 / #34 | — | `47` and `0` measured on the clean tree today |
| #3 lint | — | `✖ 1 problem (0 errors, 1 warning)` reproduced verbatim |

**#30 — the command that most needed a positive test**, since it is a four-stage pipeline whose
clean-tree answer is `0` for both "correct" and "broken". Exercised against three mutations of
`lib/domain/adherence.ts`:

| Mutation | #30 | Reading |
|---|---|---|
| clean tree | `0` | baseline |
| **sanctioned**: `function budgetedForMonth(` → `export function budgetedForMonth(` | `0` | the export this task authorises passes |
| **unsanctioned**: `CHRONIC_UNDERSPEND_RATIO` `0.5` → `0.6` | **`2`** | a function-body/constant change is caught |
| comment-only edit | `0` | prose is correctly exempt |

`sha256(lib/domain/adherence.ts)` `c3c9f47c…c65b1` before and after; all mutations reverted
byte-identically.

**Fixture arithmetic re-derived independently.** P1: `elapsedFraction 8/30 = 0.2666…`,
`actual/budget = 0.71`, `projected 1331.25`, `projectedRatio 2.6625`. P16: `budgetedForMonth(1000/12)
= 83.33`, `projected 200`, ratio **`2.4000960038401535`** against `2.4000000000000004` for an
unrounded even-spread copy and `2.4` for a cent-rounded ratio — three candidates distinguishable at
the fifth decimal, which is what makes #21 a one-definition gate rather than a comment.

**Two claims about the incumbent code, verified rather than accepted.**

1. **§5's own worked example is not arithmetically self-consistent.** *"day 8 of 30, Dining is at 71%
   of its month, projected to close 187% over"* — `0.71 × 30/8 = 2.6625`, i.e. 266.25% of budget and
   **166.25% over**. 187% over would require 76.5% spent at day 8. The spec is right to treat the
   sentence as an illustration of *shape* rather than a computable fixture, and right to pin
   `not.toBeCloseTo(2.87, 2)` against the 187% reading. **Recorded as a defect in `ROADMAP.md`'s
   prose, not in the spec.** Surfaced to the owner; the roadmap line is theirs to reword.
2. **The incumbent dashboard pace math has the defect the spec says it must not inherit.**
   `app/dashboard/page.tsx:356` computes `monthsElapsed = new Date().getMonth() + 1`, so on 1 April
   it treats **33.3%** of the year as elapsed when the true figure is **24.7%**. That inflates
   `expectedYearSpend`, which makes spend look *better* than it is — the flattering direction.
   Confirmed by execution. Note it is inconsistent with its own neighbour eleven lines below:
   `expectedWeekSpend = weeklyBudgetReference * (isoDow / 7)` is day-granular and correctly shaped.
   Acceptance #35 and P1's `elapsedFraction not.toBe(1)` pin that pacing does not copy it.

## Adjudications — G0
| Claim in dispute | Discriminating command | Output | Decision |
|---|---|---|---|
| **A1.** §5 step 30 says the work *"extends the existing pace math on the This Year card (`app/dashboard/page.tsx`)"*; `ITEM.md` says **no UI, no dashboard, no route**. The spec-writer flagged the collision and asked for a ruling. | Not an empirical dispute — resolved against §5's own structure. Step 31 is *"Re-point the dashboard"* and owns the renderer; steps 28 and 29 both shipped pure modules with no surface. | — | **`ITEM.md`'s reading stands: no UI in this task.** "Extends the pace math down to the per-category month" describes the *granularity of the computation*, not the card's markup. Acceptance #31 makes any `app/` edit a gate failure, which is the correct mechanical expression of the ruling. If step 31 later finds the pure function insufficient for the card, that is step 31's finding. |
| **A2.** Does the deliberate N15 divergence — `pacing` throws `RangeError` on an out-of-range month while `detectAdherence` silently substitutes the even spread for the same row — constitute two definitions of the same thing? | Deferred to G3, not ruled here. The spec pins **both halves** in fixture P13, so the divergence is recorded rather than accidental, and a "fix" to `detectAdherence` goes red. | — | **Carried to the adversarial reviewer as an open question.** It is defensible (`daysInMonth(2026, 12)` genuinely has no answer, so pacing cannot fail soft the way adherence does) and it is also exactly the shape of divergence this repo has been bitten by. Recording it as settled without a reviewer's attack would be the "looks good to me" outcome. |

## G2 log — all 36 re-run by the orchestrator

| Command | Expected | Measured |
|---|---|---|
| #1 `tsc` | exit 0 | `exit=0` |
| #2 suite, nothing skipped | `1` | `1` — `20 passed (20)`, `367 passed (367)` (345 + 22 new) |
| #3 lint | 1 pre-existing warning | `✖ 1 problem (0 errors, 1 warning)` |
| #4 pacing tests `-ge 17` | `OK` | `OK`, count `22` |
| #5–#21, #35 (18 named cases) | `1` each | `1` each |
| #22 `budgetedForMonth` imported | `1` | `1` |
| #23 no even-spread copy | `0` | `0` |
| #24 / #25 / #25a colour coupling | `0` | `0` / `0` / `0` |
| #26 clock | `0` | `0` |
| #27 signature | `1` | `1` |
| #28 `@ts-expect-error` used | `1` | `1` (and #1 clean, so TS2578 did not fire) |
| #29 export | `1` | `1` (`0` at G0 — a real transition) |
| #30 adherence body untouched | `0` | `0` |
| #31 scope | `0` | `0` |
| #32 both new files | `2` | `2` |
| #33 / #34 | `OK` / `0` | `OK` (47) / `0` — byte-identical |

**T10 note.** A first sweep flagged one `grep -cF` literal as missing from the pacing reporter
output. It is not an acceptance command — it is toolchain row **T10**, which greps the *adherence*
output to prove `grep -cF` matches em-dashed names. Re-run against the right file: `1`. The miss was
in the orchestrator's sweep script conflating the two tables, not in the spec.

**The adherence diff, read in full.** Two `export` keywords and two comment edits. The
`budgetedForMonth` comment previously read *"Deliberately private: exporting it would be an
invitation to make this the fifth even-spread implementation's home without doing the migration."*
The replacement narrows that warning rather than deleting it — it names `./pacing` as the one
sanctioned consumer and restates that the grid, the grid client, the budget page and the chat route
keep their own copies until someone migrates them deliberately. That is the right treatment of an
inherited warning: qualified, not quietly dropped.

## Adjudications — G2
| Claim in dispute | Discriminating command | Output | Decision |
|---|---|---|---|
| **A3.** The implementer disclosed that removing `withoutNegativeZero` from `projectedVariance` (line 290) leaves the suite green, and argued the branch is structurally unreachable because *"`-0` requires `budgeted === 0`, which the status branches intercept first, and `x − x` is `+0`."* | (a) Mutation: strip the call at 290 only, run the suite. (b) Control: strip it at `projected` instead. (c) Sweep 400,001 pairs of cent-quantized operands `kp/100 − kb/100` for a `roundCents` result of `-0`. | (a) `367 passed (367)` — green, gap confirmed. (b) `1 failed \| 366 passed` — that guard bites. (c) **0 occurrences**; same `k` → `+0`, one cent below → `-0.01`. | **Guard retained, deliberately ungated — the N23 disposition, not the N22 one.** Unreachable, so no conforming fixture can gate it, and manufacturing one would assert semantics for an input that cannot arrive. **But the implementer's stated mechanism is wrong**, and the correction matters for anyone who later edits this line: `-0` is unreachable not because of the status branches but because **both operands are already `roundCents` outputs of the form `k/100`** — identical `k` gives exactly `+0`, and any other pair differs by at least a cent. If a future change makes either operand un-quantized, the branch becomes live and this ruling lapses. Recorded so the refuted reason is not inherited as fact (the same treatment N27 got). |
| **A4.** Implementer finding 2: a `future` month carrying spend reports a real `spentRatio` (P4's second row: `status: 'future'`, `projected: null`, `spentRatio: 2.5`). | Not adjudicated at G2 — it follows exactly from the spec's stated null rule, and no acceptance command discriminates it. | — | **Carried to G3, and to step 31 as a rendering hazard.** "250% of December" for a month that has not begun is not wrong arithmetic, it is a number a surface must not print unqualified. The reviewer decides whether the module should withhold it; step 31 owns it either way. |
| **A5.** Implementer scoping decision where the spec is silent: an out-of-range `MonthSpend.month` throws only for *tracked* rows, since an untracked row is skipped before its months are resolved. | No command discriminates — P13 is tracked either way. | — | **Accepted as a reasonable reading, flagged to G3.** It means validation strictness depends on category classification, which is defensible (an unread month cannot be validated) and is also the kind of asymmetry that surprises a caller. Reviewer's call. |

## G3 log

**The review passes.** ACCEPT_WITH_NITS, 18 hypotheses with 11 refuted, each carrying method and
outcome, and the refuted work is real: fixtures P1–P16 were re-derived independently in node from
the spec's inputs *without reading the code's output*, and P16's three candidates
(`2.4000960038401535` / `2.4000000000000004` / `2.4`) were reconstructed rather than read off. No
input was found on which the shipped code produces a number the spec says should differ.

### The orchestrator's own A3 adjudication was wrong, and is retracted

At G2 I overturned the implementer's explanation of why `withoutNegativeZero` at `pacing.ts:290` is
unreachable. **The overturn was incorrect and the implementer was right.** Verified by execution:

```
roundCents(-0.001)            = -0        (Object.is -0 → true)
(-0) - (+0)                   = -0        ← IEEE: the guard WOULD fire
roundCents(-0)                = -0
```

So `projected = -0` against `budgeted = +0` does reach the branch. What closes it is precisely what
the implementer said — `budgeted === 0` sits ahead of `complete`/`projected` in the status ladder, so
a zero-budget month never projects and `projected` is `null` before the subtraction happens.

**Why my sweep missed it, which is the part worth keeping.** I swept `kp/100 − kb/100` over integer
`kp`, `kb`. `0/100` is `+0`, never `-0`, so the sweep **structurally could not construct the failing
operand**. 400,001 green pairs were 400,001 pairs of the wrong shape — a sweep that cannot express
the hypothesis it is testing is not evidence, and its size is not reassurance.

**And my replacement reason was independently false.** I claimed two distinct `roundCents` outputs
differ "by at least a cent". Measured: `22517998136850.48` and `22517998136850.49` differ by
`0.0078125` — 2 ULP at 2^44 — and both are genuine `roundCents` outputs. The cent grid dissolves
above ~$1.76e13. The reviewer's ULP argument (`|d| ≥ 0.01 − ULP`, and the `-0` window needs
`ULP ≤ 0.005`) is the sound one.

**The practical cost of my error was the recorded lapse condition.** I wrote that the ruling lapses
"if either operand becomes un-quantized" — an edit nobody is likely to make. The real condition is
"if `budgeted === 0` stops being intercepted ahead of `complete`", which N31 proves is a green-suite
refactor away. A future maintainer reading my version would have been watching the wrong line.

### N31 — escalated from nit to block, on executed evidence

The reviewer found that no fixture has a month that is **both** outside the as-of month **and**
zero-budgeted, so the ladder's money statuses (`off-cycle`, `no-budget`) are never observed competing
with its calendar statuses (`future`, `complete`). Verified by mutation — the ladder reordered so
calendar statuses win:

```
tsc exit=0
Tests  367 passed (367)     ← all green, nothing red
```

Failure scenario, from the reviewer and reachable in this app's own data shape: a March-only schedule
with a $250 pre-authorised December charge, month 11, as of April 8. Correct: `off-cycle`,
`budgeted 0`, `actual 250` — the breach §5 elevates in its own words (*"off-cycle spend is a breach
in its own right"*). Under the reordered ladder: `future`, every money field null. **A real breach
filed as a month that has not started, with a green suite.**

This is the same shape as P0.5-29a's N22 and gets the same disposition. BUILD.md §5.5: *a command
that passes vacuously is a gate that does not exist*; §5.4: untested behaviour is unverified
behaviour. The shipped code is correct; nothing stops a refactor from breaking it silently — and
N31's refactor is the exact one that would also revive the `-0` branch above, so the two findings
compound. Returned to the implementer. **Cycle 1/3.**

`sha256(lib/domain/pacing.ts)` `365f1f1a…bd3d` before and after both mutations; reverted
byte-identically.

## Adjudications — G3
| Claim in dispute | Discriminating command | Output | Decision |
|---|---|---|---|
| **A3 (retracted).** Orchestrator's G2 ruling that the implementer's mechanism for `:290` was wrong | `node -e` on the actual IEEE case: `roundCents(-0.001)`, then `(-0) − (+0)`, then `roundCents` of it; plus the large-magnitude pair | `-0`, `-0`, `-0`; and `22517998136850.49 − ...48 = 0.0078125` | **Implementer upheld, orchestrator overturned.** Both of my stated reasons are false. The conclusion (branch unreachable, guard retained ungated) survives — but via the implementer's mechanism, not mine. Recorded rather than edited away, because the wrong lapse condition is the actionable part. |
| **A6.** Reviewer grades N31 a nit; orchestrator grades it a block | Mutate the status ladder so `future`/`complete` precede `off-cycle`/`no-budget`; run `tsc` and the full suite | `tsc exit=0`, `367 passed (367)` — no test distinguishes the orderings | **Block.** Consistent with P0.5-29a's N22 ruling. Going *stricter* than the reviewer on executed evidence is what §5.1 permits and §5.5 requires; it is not an overrule of a BLOCK by argument. |
| **A4 / A5 resolved by the reviewer.** `spentRatio` on a `future` month; tracked-only month validation | Reviewer traced both | `spentRatio` is true and one division from `actual/budgeted`, so withholding costs the null rule and gains nothing; `detectAdherence` ranges over the identical `isTrackedCategory`, so no module reports on an unvalidated row | **Both stand as caller-contract hazards for step 31 (N32, N33), not defects here.** |

## G2 / G3 — cycle 1: the N31 fix

| Gate | Result | When | Evidence |
|---|---|---|---|
| G2 build (cycle 1) | **PASS** | 2026-09-02 | Two tests added, module byte-identical, all commands re-run. |
| G3 adversarial (cycle 1) | **PASS** | 2026-09-02 | Closed on the orchestrator's own mutation evidence + a direct read of the delta. **No re-dispatch — see the note below, which is a limitation of this gate, not a claim about it.** |

**Measured:** `tsc exit=0`; `Test Files 20 passed (20)`, `Tests 369 passed (369)` (367 + 2);
acceptance #4 count `24`; #30 `0`; #31 `0`; #32 `2`; #33 `OK` (47); #34 `0`; lint unchanged.
`sha256(lib/domain/pacing.ts)` `365f1f1a…bd3d` before and after every mutation run — **the whole
cycle landed in the test file.**

**Both rungs verified independently gated, by the orchestrator's own mutations:**

| Mutation | Suite | Red |
|---|---|---|
| both calendar statuses hoisted above both money statuses | `2 failed \| 367 passed (369)` | `expected 'future' to be 'off-cycle'` **and** `expected 'complete' to be 'no-budget'` |
| rung 1 only (`future` ahead of the money statuses) | `1 failed \| 368 passed (369)` | off-cycle vs future only |
| rung 2 only (`complete` ahead of `no-budget`) | `1 failed \| 368 passed (369)` | no-budget vs complete only |
| none | `369 passed (369)` | — |

Three configurations rather than one, because a single "reorder everything" mutation cannot show the
two rungs are *separately* gated — one test could have been carrying both.

**The delta read directly** (`pacing.test.ts:268–325`). Both tests assert the money fields *and* the
elapsed fields alongside the status, with explicit `not.toBe` against the wrong classification. The
elapsed assertions are the substantive part: they pin that a money status does **not** suppress the
time facts (`elapsedDays 0`, `elapsedFraction 0` for the December record; `31` and `1` for January),
which is the property that makes the precedence safe rather than merely ordered.

**A connection the implementer surfaced, and it is the right reading.** The ladder's precedence is
*what makes the M1e guard unreachable*: reorder so `complete` precedes `no-budget` and a zero-budget
month starts projecting, at which point `roundCents((-0) − 0)` is reachable and M1e stops being
vacuous. **N31 and the M1e vacuity are one fact seen from two sides**, and the two tests added here
now pin it. That is also the concrete lapse condition my retracted A3 failed to state.

**Note on G3 cycle 1 — recorded so the audit trail is not stronger than the work.** The adversarial
reviewer was **not** re-dispatched for this delta. The change is two tests closing a gap that
reviewer itself specified; the orchestrator verified biting by mutation in three configurations and
read the assertions directly. That is a defensible call for a two-test delta and it is **weaker
evidence than an independent falsification pass** — and worth flagging precisely because the last
re-review caught an orchestrator error (A3). If any later task builds on this ladder's precedence,
that is the place to look first.

## G4 log — integration

| §7.5 item | Command | Result |
|---|---|---|
| Full suite | `npm test` | `Test Files 20 passed (20)`, `Tests 369 passed (369)` |
| Types | `npx tsc --noEmit` | exit `0` |
| Lint | `npm run lint` | `0 errors, 1 warning` — pre-existing, `scripts/seed-demo.mjs:438`, untouched |
| Production build | `npm run build` | `✓ Compiled successfully in 1094ms` |
| Migration round-trip | `node-pg-migrate up → down 8 → up` on throwaway `b8_roundtrip_p0530` | clean: `8 → 0 → 8`, 16 tables. Throwaway dropped. |
| INCONCLUSIVE items | reviewer returned `inconclusive: []` | none to convert — it settled every hypothesis by reading plus pure-arithmetic probes over no repo state |
| Truthfulness invariant | `netWorth` + `drift` + `lib/netWorth` suites | `44 passed (44)`. This task adds no surface and recomputes no shared concept: `pacing.ts` imports `budgetedForMonth`, `isTrackedCategory`, `isScoredCategory`, `withoutNegativeZero` rather than re-typing any of them. |
| No real financial data | fixture-name sweep; clock/random/db sweep | `0` non-`Fabricated` fixture names; `0` matches for `new Date(` / `Date.now(` / `Math.random` / a db import |

**Standing hazard honoured again.** `migrate:up`/`migrate:down` read `--envPath .env.local`, which
points at the dev database holding real financial data. The round-trip ran under an explicit
`DATABASE_URL` override to a throwaway; the dev URL never entered the environment. The duplicate
migration file that broke this same gate during P0.5-29a is still quarantined, and `up` now lists
exactly 8 migrations.

**Final surface:** `lib/domain/pacing.ts` (new), `lib/domain/pacing.test.ts` (new, 24 tests),
`lib/domain/adherence.ts` (two `export` keywords + two comment edits), `plan/QUEUE.md` and
`plan/tasks/P0.5-30-in-month-pacing/` (orchestrator-owned). Nothing under `app/`, `shared/`,
`components/`, `migrations/` or `db/`.

**Cycle count: 1 / 3.** No escalation triggers hit.
