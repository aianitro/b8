# GATES — P0.5-33-delivery-channel
<!-- Append-only audit trail. -->

| Gate | Result | When | Evidence |
|---|---|---|---|
| §5.1 escalation | **DISCHARGED** | 2026-09-03 | Owner decision recorded in [DECISION.md](DECISION.md): hosted SMTP, names+figures. ROADMAP.md amended in two places rather than silently contradicted. |
| G0 spec | **PASS** | 2026-09-03 | 79 rows. Every premise behind the spec's one deviation verified by the orchestrator; two rulings recorded. |
| G1 contract | **PASS** | 2026-09-04 | Additive. Round trip `9 → 8 → 9` clean on a throwaway; **all constraint controls executed, not read**; forward-only intact; reflection verified. Lease OPEN 06:03Z → CLOSED at pass. |
| G2 build | **PASS** | 2026-09-04 | 74/79 exact; the five explained and adjudicated. `tsc` 0, `448 passed (448)`, build compiles, `.env.local` untouched, nothing sent. Relocated gate re-verified in both directions. |
| G3 adversarial | **BLOCK** | 2026-09-04 | ACCEPT_WITH_NITS from the reviewer (N59–N66, 30+ hypotheses, no forbidden field reachable on the wire). Orchestrator **escalates N60** — two acceptance rows assert a message's count with `toContain('2')`, which the rendered month satisfies alone. Cycle 1/3. |
| G4 integration | **PASS** | 2026-09-04 | Suite/tsc/lint/build clean, migration round-trip `9 → 0 → 9` with `alert_sends` present (17 tables), truthfulness green, gitleaks `no leaks found`, no tracked `.env`. One reviewer item recorded as unconverted — see below. |

**Cycle count:** 0 / 3

## G0 log

**The spec's central honesty.** A test that sends is a test that leaks, so delivery is gated *not at
all* — and rather than shrug at that, acceptance **#38** forbids `lib/breachAlert.ts` from mentioning
`sayingNo`, `projectedRatio`, `coveragePercent`, `authoritative` or `projectedVariance`. Every branch
on a financial fact is forced into a pure module and the ungated shell is four I/O calls that decide
nothing. That is the right shape for an untestable boundary: shrink it until what it can get wrong is
almost nothing. **#42 (`0` — no test constructs a transport) is the affirmative "nothing sends".**

**The coverage interaction, resolved the strict way.** Below `COVERAGE_THRESHOLD` **no category name,
amount or ratio leaves the process** — the message degrades to a percentage, a count, and "open the
app". This **narrows below the owner's grant**, which is always permitted: the grant is a ceiling,
not a quota. Rejected alternatives are recorded — sending nothing would mean the guardrail never once
fired on the owner's real 7.7% August *and* its silence would be indistinguishable from a good month;
sending figures with a caveat is the incoherence `DECISION.md` names, with a sentence attached.

**Premises verified rather than accepted:**

| Claim | Measured |
|---|---|
| the four readers are private to the page | `getBudgetCategories`, `getMonthlyActuals`, `getCoverageGroups`, `toAdherenceInput` — each defined in `app/dashboard/page.tsx`, **`export` count 0** for all four; no importer anywhere else |
| `lib/netWorth.ts` is the in-repo precedent for a shared reader | 3 exports, imported by `app/net-worth/page.tsx` and the dashboard |
| `lib/` is reachable from the scheduler path | `instrumentation.ts` already does `await import('./lib/scheduler')` |
| the page rounds percentages | `page.tsx:38` — `const pct = (fraction) => \`${Math.round(fraction * 100)}%\`` |
| the rounding divergence is real | `projectedRatio 4.875` → page `488`, step-32 floor `487` |

## Adjudications — G0
| Claim in dispute | Basis | Decision |
|---|---|---|
| **A1. The spec deviates from ITEM.md's non-goal "No dashboard change"** by extracting the four private readers to `lib/monthOutlookRead.ts`. It flagged the deviation for this gate rather than taking it quietly. | Premise verified above: none of the four is exported, so a scheduler cannot import them. The only alternatives are copying the queries into the alert shell — the drifting-definitions defect landing on **the exact figures this phase exists to make trustworthy**, and a defect this repo has already shipped twice — or extracting to a shared reader, which is what `lib/netWorth.ts` already is. | **Extraction upheld; my non-goal was too broadly worded.** It was aimed at the *rendered surface*, and the spec preserves that: the page is touched only by deletion and import, #56a/#57a assert the SQL arrives byte-identical, and #61/#62/#62a/#62b assert the rendered output is unmoved. **The spec read the intent of my constraint more accurately than my wording of it**, and said so instead of silently complying or silently deviating. |
| **A2. Step 32's floor rule does not extend to this surface**, and the two would have disagreed: the alert matches the page's `Math.round` (`488`) rather than step 32's floor (`487`). | Step 32 banned `Math.round` for `coveragePercent` specifically because a rounded share can **round up to clear its own threshold** — the bound would become a decoration. `projectedRatio` has no threshold to clear. | **Upheld.** Two surfaces printing different numbers for the same fact is the worse failure, and the reason for step 32's ban does not transfer. #47 caps `Math.round` at ≤ 1 occurrence — a ceiling, not a shape — so money is still never rounded. F9 pins `not.toContain('487%')` so the divergence is asserted rather than assumed. |
| **A3. §5's own "(S–M)" sizing for this step is unreachable.** | New dependency, new secret, new table (G1), a reader extraction, two pure modules. | **Accepted and recorded.** §5 half-concedes it already. Noted because the size is now *measured* rather than predicted, and because a step whose sizing is wrong by this margin is worth flagging before someone plans around it. |

## G1 log — the first contract change of this phase

**Change class: additive**, and the guardian argued it on all three §9.2 tests rather than treating
"new table" as a free pass. The load-bearing one: the rejected alternative — remembering sends by
widening `sync_log` — would have made `trigger`/`phase`/`synced` mean *"or an alert run, in which
case `synced` counts messages"*. That is §9.2's semantic-change-without-type-change, the **breaking**
class. A separate table is what keeps this additive.

**Round trip, run by the orchestrator on throwaway `b8_g1_p0533`** (`.env.local` never used; an
explicit `DATABASE_URL` override on every command):

```
up      → 9 migrations applied
down    → alert_sends dropped;  SELECT to_regclass('alert_sends') IS NULL → t
up      → 9 applied again
```

**Constraint controls — executed against the migrated database, not read off the file:**

| Control | Result |
|---|---|
| opaque fingerprint accepted | `INSERT 0 1` |
| **`'Dining Out\|Travel'` as a fingerprint** | **ERROR — rejected** |
| **a provider transcript quoting a subject line** (`550 rejected: subject=Dining Out at 71%`) | **ERROR — rejected** |
| unknown `kind` (`'weekly-report'`) | ERROR — rejected |
| `delivered = true` carrying a `failure_reason` | ERROR — rejected |
| a failed send recording its reason | `INSERT 0 1` |
| **`ON CONFLICT (fingerprint) DO UPDATE`** | **ERROR — "no unique or exclusion constraint matching the ON CONFLICT specification"** |

Columns: `id`, `attempted_at`, `kind`, `fingerprint`, `delivered`, `failure_reason`. **No money
column, no category, no merchant, no account identifier, no amount** — #71 satisfied structurally.
G1's "money columns are `NUMERIC` with a stated scale" is satisfied **vacuously**, and the guardian
said so at the gate rather than leaving the box ambiguous.

**Two design choices worth recording because their value is invisible in a diff:**

- **The redaction is enforced by the database, not by the caller.** `CHECK (fingerprint ~ '^[0-9a-f]{16,}$')`
  means a comment saying "keep this opaque" — a hope about whoever writes the insert — is replaced by
  a property Postgres refuses to violate. The two rejections above are that CHECK doing its job on
  exactly the shapes §5.4 exists to keep out of logs.
- **Append-only is enforced by an absence.** No `UNIQUE (fingerprint)` means there is no `ON CONFLICT`
  target, so the mutable "last sent" row this repo's conventions forbid **cannot be written**. An
  absence is invisible in review, which is why it is commented in both files and tested above.

**Forward-only (§9.3) intact:** `git diff --stat HEAD -- migrations/` is empty; the only change is
one new untracked file with a later timestamp than every applied migration.

**Consumers intact:** `tsc` exit 0, `415 passed (415)` — after clearing `.next` duplicate artifacts,
the **sixth** recurrence this session.

## Adjudications — G1
| Claim | Basis | Decision |
|---|---|---|
| **A4. The guardian narrowed the spec**: `failure_reason` is a closed set (`config`/`transport`/`rejected`) where the spec said only "if not, why". It flagged this for me to overrule rather than taking it. | A provider's rejection quotes the message back, **subject line included** — which carries exactly what #71 exists to keep out of a table that ends up in evidence bundles and `psql` pastes. Detail is not lost; Q5 already routes it to `lib/logger.ts`. | **Upheld.** And the reason it cannot cost a cycle is the part that makes it safe: a failure fitting none of the three is written as `NULL` with detail in the log, so no implementer is ever blocked into needing a migration. A narrowing that cannot trap the next agent is a good narrowing. |
| **A5. No `shared/types.ts` change** — argued as a decision, not an omission. | `TenantFundKind` and `ControlMode` sit on row shapes that cross the server/client boundary. `alert_sends` has no client consumer by construction — the spec rules out any route, page or component. An `AlertKind` there would be a type in the boundary file that no boundary crosses. | **Upheld.** The file would quietly stop meaning "the wire contract" and start meaning "all the types". If a later step renders send history, it moves — under a fresh lease. |
| **A6. My dispatch brief was wrong.** I told the guardian *"seven migrations are applied to the dev database and eight exist on disk."* | Measured: **8 applied, 9 on disk.** I wrote that from the pre-migration state and forgot I had run `migrate:up` against dev myself on 2026-09-03. | **Guardian correct, orchestrator wrong.** Harmless here — its file is new, later, and edits nothing — but it caught a stale fact in its own brief and said so, which is the behaviour that catches the harmful version of this. |
| **A7. Acceptance #67 cannot read `2` until the migration is staged** — `git diff --name-only HEAD` lists tracked paths only, and a new migration file is untracked. | Guardian measured `2` after `git add -N`, then restored the index. | **Command wrinkle, not a contract defect. Carried to G2 as an instruction**: stage before running #67, or read #79's `git status --porcelain` form, which the spec already carries alongside it. |

## G2 log

| Check | Result |
|---|---|
| #1 `tsc` (after clearing `.next` duplicates) | exit `0` |
| #2 suite | `Test Files 23 passed (23)`, `Tests 448 passed (448)` |
| #3 lint | `✖ 1 problem (0 errors, 1 warning)` |
| build | compiles |
| **#38** — the ungated shell mentions no financial fact | **`0`** |
| **#42** — no test constructs a transport | **`0`** |
| transport constructed in exactly one file | `lib/breachAlert.ts` |
| **`.env.local` modified** | **`0` — untouched** |
| plausible secret in source or tests | none — the only literal is `'S3cret-Value-Not-Real'`, a fixture that names itself |

**The security-critical rows are the ones that matter here and they hold.** #38 = 0 means every branch
on a financial fact sits in a pure module and the untestable shell decides nothing; #42 = 0 is the
affirmative "nothing sends"; and the credential never leaves `process.env`.

**The relocated gate re-verified in both directions** (my ruling required it):

| Mutation on `lib/monthOutlookRead.ts` | Suite |
|---|---|
| **R1** — drop `AND t.amount > 0` from the coverage query | `1 failed \| 447 passed` |
| **R2** — bolt `a.landscape = 'operational'` onto the coverage query's `JOIN` | `1 failed \| 447 passed` |
| neither | `448 passed` |

R2 is the proof the slice survived relocation: the mutant hides in the `JOIN`, which only a
`FROM`→`GROUP BY` slice can see.

### An orchestrator error, and it is the second of its kind

My first R2 run came back **green**, and I nearly recorded the implementer's claim as unreproducible.
The reader holds two `JOIN accounts` clauses — `getMonthlyActuals` at `:106` and `getCoverageGroups`
at `:158` — and my `count=1` replace hit the **first**, i.e. the wrong query. The relocated test
slices the coverage query only, so a predicate added to a different query is *correctly* invisible to
it. The green was my aim, not the gate.

**This is the second mis-aimed mutation I have produced in this queue.** At step 32 I swept
`kp/100` operands that structurally could not contain `-0`, and concluded a branch was unreachable
for the wrong reason. Both times the shape was the same: **a mutation that does not actually
express the hypothesis returns green, and green reads as reassurance.** The lesson for this gate,
recorded because it will recur: *before* trusting a green mutation, confirm the mutation landed on
the thing under test — print the mutated line, not just the suite total.

## Adjudications — G2
| Claim | Basis | Decision |
|---|---|---|
| **A8. Four scope rows (#66, #69, #78, #79) each list one unexpected path** — and it is the same path in all four: `lib/domain/monthOutlook.test.ts`. | That file changed **because I authorised it** (the relocation ruling). The spec was frozen before that ruling existed, so its scope rows could not anticipate it. Verified nothing else is out of scope: `shared/` = 0, `instrumentation.ts` = 0. | **Not violations — the rows are stale relative to a later orchestrator decision.** Recorded here so G3 and G4 do not re-litigate them, and so the audit trail shows the divergence was authorised rather than tolerated. |
| **A9. #1 (`tsc`) is environment-flaky, not code-flaky.** The implementer measured `exit=0` at 08:06:41 and `exit=2` at 08:07 **on an unchanged tree**, and declined to report it as simply green. | `.next/types/* N.ts` duplicates — the **ninth** recurrence this session. With those files' own errors filtered, `tsc` reports nothing. I cleared them and measured `exit=0`. | **Accepted, and the refusal to round it up to green was correct.** Anyone re-running acceptance must confirm `find .next -name '* [0-9].*'` is empty first. The recurrence is now roughly once per agent dispatch and is the owner's to fix at source (iCloud sync on this working copy). |
| **A10. Declared divergence from `CONTRACT.md`'s *suggested* SQL** (not from the schema): the shell issues `SELECT fingerprint, delivered … WHERE fingerprint = $1` and lets `shouldSend` apply the `delivered` test, rather than pushing `AND delivered` into the `WHERE`. | With the predicate in SQL, the suppression decision would live in the one file no test can reach, and `shouldSend`'s `delivered` check would become dead code that still looked correct. Mutation M3 is the proof it is load-bearing where it now sits. | **Upheld.** This is the same principle as #38 — keep decisions out of the untestable shell — applied to a place the spec did not anticipate. The guardian's SQL was a suggestion, not the contract; the schema is unchanged. |
| **A11. My brief carried a stale line number** — I cited the pre-existing lint warning at `scripts/seed-demo.mjs:438`; it is `:457`. | Same warning, same rule, same file. | **Implementer correct.** Third stale fact I have handed an agent in this task (with the migration count and the mutation aim). Each was caught by the agent rather than inherited. |
| **A12. Five guards the implementer wrote survived mutation green** — `finite()` on `budgeted`/`projected`/both ratios, `describeSmtp` omitting the SMTP user, and `ALERT_EMAIL_FROM` validation. | All five were guards it wrote **beyond** what the spec's fixtures pin. It reported them, added two tests, re-ran, and all now bite. Suites 22→23 and 9→10; #5/#6 are floors so both still pass. | **Noted with credit — fifth consecutive task** where the implementer disclosed gaps in its own gates rather than shipping them green, and the third where the gaps were in tests it had just written. |

## G3 log

**The review is the most thorough of the queue, and the security questions all came back clean.**
Thirty-plus hypotheses. It could not put a forbidden field on the wire (`coverageMessage` dereferences
no `OutlookCategory` at all on the low-coverage rung; no whole-object interpolation, no
`JSON.stringify`, no `Object.values` anywhere in the module); could not find a path to `sendMail`
that bypasses `ALERTS_ENABLED === 'true'` (one call site, reached only from the scheduler, checked
before the DB query and long before a transport exists); could not route the password to a log,
throw, row or message; could not make a failed send silence its own retry; and could not get a
second destination past `ALERT_EMAIL_TO`'s regex (a comma list, a display name and a spaced list are
all rejected).

It also **verified the extraction byte-for-byte** — all four functions diffed against
`git show HEAD:app/dashboard/page.tsx`, differing in exactly one token each (`DashboardAsOf` → `AsOf`),
every SQL string and binding identical — and confirmed **both of the adjudications I offered it**:
A10 upheld (the query returns failed rows *because* `shouldSend` needs them, and M3 proves the
predicate is load-bearing where it sits), and A8's authorised file carries a pointer-only change
whose slice it re-extracted and found identical to the pre-move one.

### BLOCK — N60, a vacuous gate over the content of an outbound message

Two acceptance rows assert the message's flagged-line count as `toContain('2')`:

```
lib/domain/breachAlert.test.ts:139   expect(m.subject).toContain('2');
lib/domain/breachAlert.test.ts:183   expect(m.body).toContain('2');
```

**The rendered month is `2026-09`, which contains `'2'`.** The assertion passes on the month string
alone. Confirmed by execution: deleting `coverageMessage`'s entire count paragraph leaves
`Tests 23 passed (23)` and `448 passed (448)` — every `not.toContain` still holding, `'7%'` and
`'open the app'` still present, suite green.

**Why this is a block and not a nit, consistent with two prior rulings.** BUILD.md §5.5: *a command
that passes vacuously is a gate that does not exist.* P0.5-29a's N22 and P0.5-30's N31 were both
graded nits by their reviewers and both blocked here on the same reasoning — correct code, absent
gate, reachable regression. This one has an aggravating factor the other two did not: **it gates the
content of the only message that will actually send on the owner's real data today** (EVIDENCE §5 —
`authoritative: false`, `coveragePercent: 0`, so the coverage message is the live one). The fix is
one assertion per row, on a string the month cannot supply.

### An orchestrator failure worth recording against itself

**I mis-aimed three of four mutations while verifying this finding.** The first hit the *breach*
message's count line instead of the coverage one; the second left unused bindings so `tsc` failed for
an incidental reason; the third removed a `noun` binding the breach message also uses, reddening 18
tests for a reason unrelated to the hypothesis. Only the second run expressed the reviewer's actual
claim.

Combined with the two earlier instances — the `kp/100` sweep at step 32 that structurally could not
contain the value it hunted, and the `JOIN` mutation at G2 that hit the wrong query — **this is five
mis-aimed mutations across the queue, three of them in this task alone.** The failure mode is
identical every time: *a mutation that does not express the hypothesis returns a result that reads
like evidence.* Twice that result was green and nearly became "the finding is unreproducible".

The rule, now stated as a gate practice rather than a resolution: **print the mutated line and assert
it is the intended target before reading the suite result.** A mutation whose landing site is
unverified is not evidence, whichever way it comes out.

## Adjudications — G3
| Claim | Discriminating command | Output | Decision |
|---|---|---|---|
| **A13.** Is N60 a block, given the reviewer graded it a nit and the shipped behaviour is correct? | Delete `coverageMessage`'s count paragraph; run both suites | `23 passed (23)`, `448 passed (448)` — nothing red | **Block.** Third instance of this exact pattern in the queue and the third to be escalated above its reviewer's grade. Consistency matters here: grading it a nit *because the code happens to be right* is the "looks good to me" outcome the architecture exists to convert into a checkable artifact. |
| **A14. N59** — the coverage message's fingerprint keys on the flagged-category set, which that message never names, so two byte-identical coverage emails can be delivered in one month as the set churns. | Traced by the reviewer; not run. | — | **Accepted as a nit, carried.** It is spec-conformant — Q4's rule is *(kind, month, set, reasons)* and it is implemented faithfully; the defect is in the rule's fit to a message that renders only a count. Costs noise, not truth, and is invisible on the owner's data today (`sayingNo.length = 0`). Recorded for whoever revisits Q4. |
| **A15. N61** — `finite()`'s docblock says a refusal lets the shell record the attempt as failed; `planAlert` is called above `attempt()`, so the `RangeError` unwinds and **no `alert_sends` row is written**, merging "the job did not run" with "the job refused" for that cause. | Traced by the reviewer. | — | **Accepted as a nit.** The comment states a behaviour the shell does not have — a docblock that over-promises is the mild version of the "right for the wrong reason" hazard. Detail does survive in the log line. Fold the comment correction into the N60 cycle since the file is open. |

## G3 (cycle 1) — N60 closed

**The implementer fixed it additively and, notably, built the mutation I had failed to construct.**
It kept both `toContain('2')` lines — because that is how the frozen spec words F3 and F4, and
narrowing a fixture quietly is its own defect — and put the strength in neighbours the month cannot
supply: `'2 saying no'` with a 3-record variant giving `'3 saying no'` and **not** `'2 saying no'`,
and `'2 budget lines are currently flagged'` with a 1-record variant giving the singular and **not**
the plural. Eight count-bearing assertions where there were two ambiguous ones.

**Verified by the orchestrator, with the target printed before the run this time:**

```
TARGET LINE:    `${count} ${noun} currently flagged. …`
ALSO DROPPING:  const count = outlook.sayingNo.length;
ALSO DROPPING:  const noun  = count === 1 ? 'budget line is' : 'budget lines are';
tsc (code)  → clean          ← the mutant compiles, so the red is the hypothesis
vitest      → 1 failed | 22 passed (23)
whole repo  → 1 failed | 447 passed (448)
```

That is the discipline I wrote into the G3 log one cycle earlier, applied: **the mutant compiles**,
so the failure cannot be an artifact of a dangling binding — which is exactly how two of my three
mis-aimed attempts went wrong. Counts reconcile: `breachAlert` 23, `mailConfig` 10, `monthOutlook`
**exactly 40** (#65), total 448.

**N61 — comment corrected, and the implementer refused the control-flow change with a better reason
than "out of cycle".** Moving `planAlert` below `attempt()` *still* could not record the refusal:
`alert_sends.fingerprint` is `NOT NULL`, and a message that could not be rendered has no fingerprint
to key a row on. That is `CONTRACT.md`'s implementer-note-4 ruling transferring to a case it did not
name — the schema refuses a placeholder invented to make a row insertable. Recording it would require
a nullable fingerprint, i.e. a contract change against a frozen surface, for a failure the log
already captures in full. The docblock now states the gap and why it is not closable here.

## G4 log — integration

| §7.5 item | Result |
|---|---|
| Full suite | `Test Files 23 passed (23)`, `Tests 448 passed (448)` |
| Types / lint / build | exit `0` / `1 problem (0 errors, 1 warning)` pre-existing / compiles |
| **Migration round-trip** (throwaway `b8_g4_p0533`) | `up` 9 → `down 9` → 0 → `up` 9. **17 tables** (16 + `alert_sends`), `to_regclass('alert_sends')` non-null. `.env.local` never used. |
| Truthfulness invariant | `netWorth` + `drift` + `lib/netWorth` → `50 passed (50)`. This step **removes** a drift risk rather than adding one: the four month-outlook queries now have exactly one home. |
| Secrets | `gitleaks detect` → **`no leaks found`**; tracked `.env*` files: **0**; `.env.local` unmodified |
| **Nothing sent** | #42 = `0` (no test constructs a transport); EVIDENCE §8 records no transmission at any point |

**One reviewer item is recorded as unconverted rather than claimed.** N59's prediction — that two
different flagged sets produce two fingerprints but one byte-identical coverage body — I attempted to
convert into a measurement with a scratch probe and **failed on `planAlert`'s signature**, which I
had assumed rather than read. That is my fourth mis-aimed probe in this task, so I stopped rather
than iterating. **N59 therefore stands on the reviewer's reading, not on my execution**, and is
recorded that way. It is a nit, spec-conformant, costs noise rather than truth, and is invisible on
the owner's data today (`sayingNo.length = 0`). The probe file was removed and the tree re-verified
clean.

**Cycle count: 1 / 3.** No escalation triggers hit.
