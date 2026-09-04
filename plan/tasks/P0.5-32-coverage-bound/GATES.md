# GATES — P0.5-32-coverage-bound
<!-- Append-only audit trail. -->

| Gate | Result | When | Evidence |
|---|---|---|---|
| G0 spec | **PASS** | 2026-09-03 | 49 rows. Every fixture's arithmetic re-derived by execution; every clean-tree baseline re-measured; the threshold's own justification checked as arithmetic. The spec's one unsettled question — whether 0.95 suits the owner's real data — was **measured at this gate**, and the answer is consequential. |
| G1 contract | **SKIP** | 2026-09-03 | Contracts touched: none. Every column exists; the coverage types are module-local. Re-opens if the implementer reports otherwise. |
| G2 build | **PASS on its criteria**, **one finding returned** | 2026-09-03 | All 49 rows re-run: `tsc` 0, lint 1 pre-existing warning, build compiles, `413 passed (413)`, every transition confirmed, scope clean. **M12 — a domain-layer guard the implementer disclosed as ungated — independently confirmed and returned for a test. Cycle 1/3.** |
| G3 adversarial | **BLOCK** | 2026-09-03 | 23 hypotheses, 16 refuted. The decision layer withstood every attack on the population rule. **BLOCK on a false sentence in the renderer**, verified reachable; plus N56, a hole in the gate the orchestrator accepted at A4, and N53, a float boundary that prints 94% at a true 95%. Cycle 2/3. |
| G4 integration | **PASS** | 2026-09-03 | Suite/tsc/lint/build clean, migration round-trip `8 → 0 → 8`, all three reviewer INCONCLUSIVE items converted and run, truthfulness green, no real data. |

**Cycle count:** 0 / 3

## G0 log

**Fixture arithmetic, re-derived rather than accepted.** Two of these turn a stylistic-looking ban
into a real gate:

| Fixture | Value | Note |
|---|---|---|
| `1900/2000` | `0.95` **exactly** (`=== 0.95` is `true`) | the closed floor is float-safe; a `>=` comparison at the boundary is not luck |
| `1899/2000` | `0.9495` → floor **94%** | `Math.round` would print **95%**, visually clearing a threshold the figure fails |
| `9999/10000` | `0.9999` → floor **99%** | `Math.round` would print **100%** with spend still unattributed |
| `480/4480` | → **10%** | ITEM.md's $4,000-transfer case |
| `5900/6000` | `0.98333…` | what **N41's wrong population** would have reported |
| `40/41` | `0.97561…` | what a **count-based** share would have reported |

So acceptance's `Math.round` ban is the "never rounds up to 100" gate the spec claims, statically.

**The threshold's justification is arithmetic, and it checks out.** At `c = 0.95` the unattributed
mass is `(1−c)/c = 5.26%` of scored spend; across the owner's **nine**-category scored set that is
`5.26% × 9 = 47.4%` of an average category's month — the point at which invisible spend could flip a
verdict on its own. Both figures reproduced. The spec is explicit that 0.95 is a **policy** constant,
not a derived one, which is the honest framing.

**Clean-tree baselines, all re-measured and all matching:** `a.landscape = 'operational'` on the
page **2**; files mentioning `categorizedCount` **3**; `COVERAGE_THRESHOLD` **0**; `coverage-refusal`
testid **0**; `STATE_COPY[outlook.state]` **1**; `monthOutlook.test.ts` **24** tests.

**Noted, not faulted:** the diff is larger than "add fields" because `CategorizationCoverage`'s two
counts name a population the spec declares wrong, so they are **removed** rather than extended, and
`tsc` then enumerates every consumer. The spec flagged this itself.

## The measurement the spec could not make — made here, and it changes what this step does

The spec deferred one question: whether `0.95` suits the owner's real data. Measured read-only
against the dev database, applying the spec's own population (tracked non-hidden accounts,
`amount > 0`, month-to-date, classified through `isScoredCategory`), for 2026:

| Month | Coverage under the spec's rule | Unattributed txns |
|---|---|---|
| Jan–Jul | **100.0%** | 0 |
| **Aug** | **7.7%** | **22** |
| **Sep (to date)** | **no scored spend at all** | **5** |

**On the owner's real data this feature refuses on day one, and it is right to.** Seven months at a
clean 100% establish that the rule is not systematically pessimistic; August's collapse to 7.7% with
22 unattributed rows is a real categorization backlog, and September has no scored spend recorded
yet. The dashboard's headline will render **non-authoritative** until categorization catches up.

That is the feature working, not a defect — and it is exactly the failure §5's own second-order
sentence predicted: *"pacing is only useful if a transaction is categorized within a day or two of
landing."* The spec correctly reads that sentence as naming a consequence rather than commissioning
work (Q7), and this measurement is what makes the consequence concrete.

**Explicitly recorded so it cannot happen quietly:** `0.95` must **not** be tuned to make the owner's
current data pass. A threshold chosen to clear the data it is meant to judge is not a threshold. The
spec's Evidence #1 already carries that instruction; it is repeated here because this measurement is
exactly the pressure that would motivate the change.

## G2 log

| Check | Result |
|---|---|
| #1 `tsc` / #3 lint / build | exit `0` / `✖ 1 problem (0 errors, 1 warning)` / compiles |
| #2 suite | `Test Files 21 passed (21)`, `Tests 413 passed (413)` (399 + 14) |
| `COVERAGE_THRESHOLD` | **0 → 5** |
| `a.landscape = 'operational'` on the page | **2 → 0** (N42 discharged) |
| files mentioning `categorizedCount` | **3 → 0** |
| `STATE_COPY[outlook.state]` | **1 → 0** |
| `coverage-refusal` testid | **0 → 1** |
| `monthOutlook.test.ts` | **24 → 38**, the 24 surviving unrenamed |
| `Math.round` in the module | `0` — the floor rule holds statically |
| tripwires: adherence / pacing / four-file diff | `47` / `24` / `0` |
| scope | page, module, module test, `plan/` — nothing else |

**`COVERAGE_THRESHOLD` untouched at `0.95`.** The pressure to tune it was named at G0 before it
could be felt, and the implementer confirms nothing made it look wrong.

### The four surviving mutations, split into two very different classes

The implementer disclosed five surviving mutations. **They are not the same kind of thing, and
collapsing them would be the mistake:**

**Declared-ungated (M14, M15, M17) — not gate gaps.** Hiding the refusal region, keeping the
confident colour, or rounding the share with `pct()` **on the page**. All three leave 38/38 green.
This is precisely the limitation SPEC Q4 and toolchain row T5 state in advance: there is no
component-test toolchain, so the renderer is unproven by construction. These *measure* a declared
limitation rather than revealing a new one, and the spec's prohibition on ever describing the
refusal as "tested" is the right disposition. **Recorded, not charged.**

**M12 — a real gate gap, and in the domain/query layer, not the renderer.** Deleting
`AND t.amount > 0` from `getCoverage`'s SQL. **Independently confirmed by the orchestrator:**

```
tsc exit=0
Tests  413 passed (413)     ← every row still passes, nothing red
```

The sign rule is the load-bearing half of "share of **spend**": income is negative in this ledger,
so without the filter income rows enter the coverage population and move the share — over-confident
or under-confident depending where they land, and wrong either way. **The number this entire step
exists to state can be silently changed with a green suite.** Row #43c does not catch it (a count
falling 16→15 against a `-ge 15` floor), and what currently "protects" the line is a doc comment.

Same shape as P0.5-29a's N22 and P0.5-30's N31, and it gets the same disposition: BUILD.md §5.5 —
a command that passes vacuously is a gate that does not exist; §5.4 — untested behaviour is
unverified behaviour. **Returned to the implementer for one test. Cycle 1/3.**

`sha256(app/dashboard/page.tsx)` `8f67a939…4453` before and after the mutation; reverted
byte-identically.

**Sequencing note.** The adversarial reviewer has **not** been dispatched yet. The implementer found
this itself, so spending a full falsification pass to rediscover it and *then* blocking would cost a
round-trip for no information. The reviewer gets the corrected diff once, whole.

## Adjudications — G2
| Claim | Basis | Decision |
|---|---|---|
| **A1. Fixture C14 proves less than it appears.** The implementer reports that under `UNIQUE(name, landscape)` plus the operational conjunct, at most one row per name can be scored, so "add once per matching **scored** row" is indistinguishable from correct on C14's input — it mutated to that and it survived. | Reported against its own fixture, unprompted | **Accepted, and worth keeping anyway.** What C14 genuinely kills is the JOIN-shaped double count (M9, 1 red), which is §10.3's named hazard and the one this repo has actually shipped. Its `not.toBe(1000)` pin is weaker than it reads; recorded so no future spec cites C14 as proof of the per-row rule. |
| **A2. `#43c` does not gate what it appears to** (M12 above) | Confirmed by the orchestrator's own mutation | **Spec defect, recorded.** A `-ge` floor over a count that moves by one is not a gate on the predicate that produced the count. The fix is a test, not a tighter grep — a grep asserting the SQL text would gate the *string*, not the behaviour. |
| **A3. `toAdherenceInput`'s two-landscape double count is still live** — pre-existing, predicted by SPEC Q6, and absent from the new coverage classifier | Reported | **Out of scope, carried to `NITS.md` as a follow-up.** It is in the hero's own actuals path, not in this step's declared surface. |

## G2 (cycle 1) — M12 closed

| Gate | Result | When | Evidence |
|---|---|---|---|
| G2 build (cycle 1) | **PASS** | 2026-09-03 | One test added, no production change. `tsc` 0, `414 passed (414)`, `monthOutlook.test.ts` 38 → 39, additions only. |

**Production untouched, verified rather than asserted:** `sha256(app/dashboard/page.tsx)` is
`8f67a939…4453` — byte-identical to its pre-cycle value — and `COVERAGE_THRESHOLD` is still `0.95`.
The whole cycle landed in `lib/domain/monthOutlook.test.ts`.

**One test kills both mutations, confirmed by the orchestrator in each direction:**

| Mutation | Suite |
|---|---|
| **M12** — delete `AND t.amount > 0` from the coverage query | `1 failed \| 413 passed (414)` |
| **M13** — re-add `AND a.landscape = 'operational'` to it | `1 failed \| 413 passed (414)` |
| neither | `414 passed (414)` |

Page restored byte-identically after both.

### The honest part, and an orchestrator framing that was too narrow

The implementer reports — correctly — that **no behavioural test can reach that predicate**:
`categorizationCoverage`'s inputs are groups Postgres has *already* aggregated, so no input value
distinguishes "the query filtered on sign" from "it did not". Rather than write a test that appears
to cover it, it asserted the predicate **against the source of the query**, slicing the substring
between `WHERE` and `GROUP BY` so that no sibling query and no doc comment can satisfy it — which is
exactly how #43c let the deletion through at 16→15.

**My G2 instruction said "the fix is a test, not a tighter grep — a grep asserting the SQL text would
gate the string, not the behaviour." That framing was too binary and the implementer found the third
option.** A *scoped* source assertion, bounded to one query's `WHERE` clause and titled so nobody can
mistake it for behavioural coverage, is materially different from a file-wide `grep -c`: it cannot be
satisfied by prose, by a neighbouring query, or by a comment. It is still weaker than a behavioural
test and it is brittle to reformatting — both recorded — but "no gate at all" was the alternative,
and this is the first honest gate that line has had.

**The structural fix, named and deferred.** Have `getCoverageGroups` return rows rather than sums and
let the domain aggregate; the sign rule then becomes the classifier's own contract, `assertGroup`
moves from validating SQL output to *implementing* the population, and the guard becomes behaviourally
testable. That is a production change and not this cycle's.

**Directionality, which is the part worth keeping.** There is no single direction, and the
implementer measured all three against the C1 baseline (`1900/100`, share `0.95`, authoritative):

| Where the negative lands | Share | Authoritative | Direction |
|---|---|---|---|
| income in an income category | — | — | **throws `RangeError`** — loud, the good case |
| refund netted into a **scored** group | `0.947368…` | **false** | **down** — refuses for the wrong reason |
| transfer-in netted into the **unattributed** group | `0.974359…` | **true** | **up** — keeps authority it has not earned |

All three are live in `b8_demo`'s August data: `Salary` −7750.00 and `Rental Income` −5200.00 would
throw, and `Transfers` carries 5985.93 positive against a **signed sum of 0.00** — the netting effect
at full size in data nobody constructed for it.

**Cycle count: 1 / 3.**

## Adjudications — G2 cycle 1
| Claim | Basis | Decision |
|---|---|---|
| **A4.** Is a test that reads a source file an acceptable gate? | Verified it kills M12 and M13 in both directions; read its title, which states it is a source assertion and why | **Accepted, with two nits recorded.** It is the first test in this repo to read source, so it is a new pattern rather than routine: brittle to SQL reformatting, and it gates text rather than behaviour. Both are strictly better than the doc comment it replaces. The structural fix above is the durable answer and belongs in a later step. |
| **A5.** `.next` duplicate artifacts broke `tsc` again mid-task — **fifth recurrence this session**, this time with ` 3.` and ` 4.` variants | The implementer correctly **did not** edit, delete, or `tsconfig`-exclude them, and reported instead, per instruction | **Cleared by the orchestrator; no charge to the task.** Recorded because the rate is now roughly once per task and each occurrence costs a gate check. The durable fix is excluding this working copy from iCloud sync, which is the owner's to make. |

## G3 log

**The review is strong and the decision layer survived it.** 23 hypotheses, 16 refuted, each with
method: name collisions across landscapes collapse into `Set`s before the group loop so dollars are
added once per *group*; orphans are exact-match misses on the same string Postgres grouped by, and
`getMonthlyActuals` keys the same way so both surfaces agree the row is invisible; `Transfers` with
`exclude_from_budget` never reaches either accumulator; the `JOIN accounts` is many-to-one on a PK so
it cannot fan out. It also **refuted** the possibility of a behavioural test reaching the SQL
predicate, upholding A4's premise, and confirmed **N40 is properly discharged** by proving the
subtitle's three branches exhaustive.

### BLOCK — the page states something false about the world

Verified by the orchestrator. On a month whose every positive row is categorized to a `fixed` or
`variable-necessary` category with nothing unattributed:

- `scoredSpend 0`, `unattributedSpend 0` ⟹ `population 0` ⟹ `coverageShare null` — **the module is
  correct**, and `monthOutlook.test.ts` asserts exactly this.
- The page then renders, as the entire content of `data-testid="coverage-caveat"`:

> **No spend is recorded this month yet, so there is no share to compute one over.**

with the refusal region echoing *"there is nothing recorded to compute a share over yet."*

$2,800 of spend is recorded. Both sentences are false, they are the only two the region emits in this
state, and there is no qualifier near either.

**Reachability, using this gate's own earlier measurement.** G0 measured the owner's Jan–Jul at 100%
coverage with **0 unattributed transactions** — so `unattributedSpend === 0` is the *normal*
condition on this data. `scoredSpend === 0` is the first day or two of any month, before the first
discretionary charge, while rent and utilities have already posted. **A recurring monthly window, not
a corner.**

**It is a spec defect faithfully implemented**: SPEC Q4.3's own parenthetical supplies the wording
and conflates "empty population" with "no spend". The fix is one branch of copy, inside the declared
surface — the honest sentence is about the hero's *reach*, not about the month.

This is renderer copy, the layer declared ungated, and it is still a BLOCK: the declaration covers
*styling and order being unproven*, not *emitting a false statement about the user's own money*. A
page that says "no spend recorded" beside a $2,200 mortgage payment is precisely the confidently
wrong statement this phase exists to end.

### N56 — a hole in the gate I accepted at A4, and it is mine

The source assertion slices `WHERE`→`GROUP BY`, so `not.toContain('a.landscape')` **cannot see a
landscape predicate added to the `JOIN … ON` clause**. Verified:

```
JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE AND a.landscape = 'operational'
Tests  414 passed (414)      ← N42 silently returns
```

At A4 I accepted the scoped source assertion as "materially different from a file-wide grep" because
it cannot be satisfied by prose or a neighbouring query. That remains true. What I did not check is
that it is also **scoped narrowly enough to miss an equivalent predicate one clause away**. The
pattern is sound; my acceptance of *this instance* was one clause too narrow.

### N53 — an exact 95% prints as 94% and is refused authority

Reproduced: scored `1052.03` across six groups against unattributed `55.37` across two — an exact
19:1 ratio, i.e. exactly 95.000000% — computes to `0.9499999999999998`, fails `>= 0.95`, and
`Math.floor` displays **94%**. The spec pre-accepted the comparison half; the `Math.floor` half is
new and unreasoned, and it converts a 2e-16 float error into a full displayed point.

## Adjudications — G3
| Claim | Discriminating command | Output | Decision |
|---|---|---|---|
| **A6.** Is the false null-branch copy a BLOCK, given the renderer is declared ungated? | Read the two sentences; re-read the ungated declaration's scope | copy is `"No spend is recorded this month yet"`; declaration covers DOM order and styling | **BLOCK.** "Unproven" is not "licensed to be false". Every other surviving renderer mutation (M14/M15/M17) degrades *presentation*; this one asserts a falsehood about the user's money. |
| **A7.** Does N56's hole invalidate A4's acceptance of the source-assertion pattern? | Move the predicate into `JOIN … ON`, run the suite | `414 passed (414)` — survives | **Pattern upheld, this instance widened.** Returned with the block: the assertion must cover the whole predicate set of that query, not one clause of it. **My A4 ruling is amended rather than reversed.** |
| **A8.** Is N53 block-worthy? | `node -e` on the six/two-group split | `0.9499999999999998`, `>= 0.95` false, floor `94` | **Not a block, but fix it in this cycle** since the file is open: it is a wrong *displayed number* at the threshold the whole step defines, and the implementer should say whether the fix perturbs threshold semantics rather than silently changing them. |

## G3 (cycle 2) — all three closed

| Gate | Result | When | Evidence |
|---|---|---|---|
| G3 adversarial (cycle 2) | **PASS** | 2026-09-03 | Block fixed and rendered; N56 widened and re-killed; N53 fixed with its residual disclosed. 39 → 40 tests, additions only. `415 passed (415)`. |

**Verified by the orchestrator:**

| Item | Mutation | Result |
|---|---|---|
| **N56** | landscape predicate into `JOIN … ON` | **`1 failed \| 414 passed (415)`** — was `414 passed` before the widening. Hole closed. |
| **Block** | collapse `coverageGroups.length === 0` so the old copy renders in both states | `415 passed (415)` — **the fix is correct but ungated**, see below |
| **N53** | reviewer's six-group / two-group exact-19:1 split | old floor **94** at a true 95.000000%; new floor **95**; `authoritative` **unchanged at `false`** |

**The old sentence survives, correctly.** `grep -c 'No spend is recorded this month yet'` is still `1`,
now guarded at both sites by `coverageGroups.length === 0` — the *unfiltered* aggregation, which can
distinguish "nothing happened" from "nothing this hero scores happened" where the coverage record
cannot. It fires only where it is true. No domain change was needed for the block.

**The implementer went one clause beyond instruction, correctly.** Rendering the fix showed the
refusal's *leading* sentence — "Too much of this month's spend is unaccounted for" — is false in the
same state, since `unattributedSpend` is 0. A refusal that misstates its own cause is the same defect
one clause up. It made the whole sentence conditional and flagged the overreach rather than doing it
quietly.

**An orchestrator error, recorded.** My first N53 check used the pre-summed totals `1052.03` and
`55.37` and got `0.9500000000000001` — above the threshold, no defect visible. The reviewer's case is
about **multi-group accumulation**: summing the six and two elements gives `55.370000000000005` and a
share of `0.9499999999999998`. I had verified the wrong inputs and would have concluded the fix was
unnecessary. Re-run with the arrays, it reproduces exactly.

## Adjudications — G3 cycle 2
| Claim | Basis | Decision |
|---|---|---|
| **A9.** N53's fix leaves the halves disagreeing: the boundary month now reports **95%** and is still **refused**. | The implementer disclosed this rather than making them agree silently, and stated the only alternatives: a tolerance on the comparison (which moves the floor to `[0.95−ε, ∞)` and changes what `0.95` means) or integer-cent accumulation (**statically banned by acceptance #35**). | **Accepted, residual recorded.** Odd-and-true beats the old pairing, which was odd and contained a *wrong number*. Whether the comparison should carry the same tolerance is a **spec question about threshold semantics**, correctly refused by the implementer and left for a follow-up. It is exactly the "no exact option exists inside the constraints" situation where saying so beats picking one quietly. |
| **A10.** The block's fix is itself ungated — collapsing the branch guard leaves 415 green. | Renderer; no component-test toolchain (SPEC Q4, T5 = NO). | **Accepted as the declared limitation, not a new gap.** Recorded so the audit trail does not imply the fix is proven: it was verified by **render**, on a scratch database, with both false strings confirmed absent from the emitted HTML — evidence, but not a gate. It joins M14/M15/M17 on the human check-list. |
| **A11.** The implementer disclosed that its own `Math.min(floored, 99)` negative control was vacuous — the mutation survived, because $1M-vs-1¢ floors to 99 either way. It strengthened the fixture to ~$1e9 scored against $0.01, where the tolerance yields exactly `100`. | Volunteered against its own new test, in the same message. | **Noted with credit.** Fourth consecutive task where the implementer disclosed a gap in its own gate rather than shipping it green, and the second where the disclosure concerned a test it had just written. |

## G4 log — integration

| §7.5 item | Result |
|---|---|
| Full suite | `Test Files 21 passed (21)`, `Tests 415 passed (415)` |
| Types / lint / build | exit `0` / `1 problem (0 errors, 1 warning)`, pre-existing / compiles |
| Migration round-trip (throwaway `b8_rt_p0532`) | `8 → 0 → 8`, 16 tables, clean |
| Truthfulness invariant | `netWorth` + `drift` + `lib/netWorth` → `50 passed (50)`. No shared concept recomputed: the page calls `monthOutlook` and `categorizationCoverage`, never `detectAdherence`/`scoredHeadline`/`categoryPacing` directly. |
| INCONCLUSIVE items | **all three converted and run** — N53's boundary reproduced through the reviewer's own arrays; N56's hole confirmed live and then confirmed closed; the block's state rendered on a scratch database with both false strings verified absent from the HTML |

**No real financial data — checked properly rather than by prefix.** A first sweep flagged 13 added
fixture names lacking the `Fabricated ` prefix. Cross-referenced against the owner's actual
`budget_categories`, three coincide: `Salary`, `Pets`, `Travel`. All three are **already in
`scripts/seed-demo.mjs` and already public on `origin/main`** — fabricated demo vocabulary that
overlaps generic real category names, which is unavoidable for words like "Travel". No amounts, no
merchants, no account identifiers, no dates tied to real activity. **Not a leak.** Recorded because
the prefix convention alone would have raised a false alarm here, and a future sweep will hit it
again.

**Cycle count: 2 / 3.** No escalation triggers hit.

## What remains for a human — the renderer is unproven by construction

Four page-layer mutations survive a green suite (M14 hide the refusal region, M15 keep the confident
colour, M17 round the share on the page, and the block's own branch guard). In order of what would
mislead most:

1. **A month whose spend is entirely `fixed`/`variable-necessary` with nothing uncategorized** — the
   blocked state. Confirm the caveat now describes the hero's *reach* and does not claim no spend is
   recorded.
2. **A month at 100% coverage with large known-unscored spend** (a mortgage plus one small
   discretionary charge). Decide whether "Computed over 100% of this month's spend" is a sentence
   this app should print (N52).
3. **M15** — force `authoritative === false` in an `on-track` month; confirm the title is slate, not
   emerald.
4. **M14** — confirm `data-testid="coverage-refusal"` is in the DOM when refused and absent when
   authoritative; the grep only proves it exists in source.
5. **M17** — compare the rendered percentage against `Math.floor(share * 100 + 1e-9)` near a whole
   number; `#35` bans rounding in the module and nothing bans it on the page.
6. **N57** — in the three already-slate states the demotion changes no tone at all; judge whether the
   refusal banner alone carries it.
