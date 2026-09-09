# EVIDENCE — P0.5-33-delivery-channel
**Author:** implementer · **Measured:** 2026-09-04 · **Base:** `64cb0d6`

---

## 0. The headline, stated first

**74 of the 79 acceptance rows read exactly as the spec expects. Five do not, and they fall into two
groups.**

**Four are one cause: the coordinator-authorised repoint of one line in
`lib/domain/monthOutlook.test.ts`.** They are #66, #69, #78 and #79 — every one a scope or
byte-identity counter, and every one naming that one file and nothing else. Details in §3.

**The fifth is #1 (`tsc`), and it is the environment, not this task's code.** It reads `exit=0` on a
tree without the `.next/types/* N.ts` duplicate artifacts and `exit=2` with them. They reappeared
twice during this session — the **ninth** recurrence — and per instruction I did not touch them; a
`next build` cleared them both times. **On the tree as handed over they are absent and #1 reads
`exit=0`.** It is listed as off-spec anyway because the same command gave both answers on the same
tree today, and a row that can flip is not a row I am willing to report as simply green. The proof
that the code itself is clean is in §10.1: with those files' own errors filtered out, `tsc` reports
**nothing**.

**Nothing was sent. At any point. To any address.** No transport was constructed outside the shipped
`lib/breachAlert.ts`, no test names one (#42 = `0`), no test reads the owner's environment file
(#43 = `0`), no socket was opened, and `ALERTS_ENABLED` is unset everywhere on this machine. The two
rendered messages in §1 were produced by printing a string.

**No credential was invented, written, or committed.** `.env.local` was **not modified**. The seven
new key *names* are documented in `.env.local.example` with empty values. The SMTP credential is the
owner's to add (§8).

---

## 1. Evidence #1 and #2 — the two messages, verbatim

Rendered by calling `planAlert()` and printing the result. Fabricated data throughout: these are the
spec's fixtures, not the owner's database.

### The breach message, over fixture `O` (96% coverage, authoritative)

```
kind:        projected-breach
fingerprint: 010be172cc620cef90a861f10f881de43097c0269b834fc8a0878ba7214cdf91
SUBJECT:     Budget guardrail — 2 saying no in 2026-09
BODY:
----------------------------------------------------------------
2 budget lines are saying no in 2026-09, on day 8 of 30.

Dining Out — on course to close over its budget
  spent $284.00 of $400.00 (71%)
  projecting $1,065.00 (266%)

Travel — already over its budget
  spent $260.00 of $200.00 (130%)
  projecting $975.00 (488%)

Computed over 96% of the spend recorded so far in the month, across 9 scored categories.

To see the detail, open the app.
----------------------------------------------------------------
```

### The coverage message, over fixture `F4` — the *same outlook*, seen at 7%

Placed directly beside it, so the withdrawal is visible rather than asserted. Same two categories,
same figures in the input, and **not one of them leaves the process**:

```
kind:        coverage
fingerprint: fad0d018cc2130fa71d83bea77f63a4123f795ee1145dcf578acc267919ad861
SUBJECT:     Budget guardrail — 2026-09 is not categorized enough to judge
BODY:
----------------------------------------------------------------
Only 7% of the spend recorded so far in 2026-09 has been categorized, so no figure about any single budget line can be stated as a verdict yet.

2 budget lines are currently flagged. The figures are withheld here on purpose: the dashboard will not present them as a judgement at this coverage, and neither will this message.

To categorize what is left, open the app.
----------------------------------------------------------------
```

No category name. No amount. No ratio. No `$`. A percentage, a count, and a route back.

### F21 — the off-cycle record, which is the one a real message leads with

`off-cycle` is the highest-precedence reason, so it is the **first** line a real breach message
contains, and it is the one record whose `projected`, `spentRatio` and `projectedRatio` are all
`null`. The line names the spend and stops:

```
SUBJECT:     Budget guardrail — 3 saying no in 2026-09
BODY:
----------------------------------------------------------------
3 budget lines are saying no in 2026-09, on day 8 of 30.

Gym — spending in a month it budgets nothing for
  spent $150.00

Dining Out — on course to close over its budget
  spent $284.00 of $400.00 (71%)
  projecting $1,065.00 (266%)

Travel — already over its budget
  spent $260.00 of $200.00 (130%)
  projecting $975.00 (488%)

Computed over 96% of the spend recorded so far in the month, across 9 scored categories.

To see the detail, open the app.
----------------------------------------------------------------
```

No `null`. No `NaN`. No `$0.00` against the zero budget. The comparison is omitted, not emptied.

---

## 2. Evidence #3 — the Q1 limitation, verbatim and unhedged

> **No command in this spec proves that a message is delivered, that TLS is negotiated, or that the
> provider accepts the configuration. The content is gated; the delivery is not, and must not be
> described as tested.**

What this repo proves is narrower and is worth naming exactly: `lib/mailConfig.ts` proves that a
configuration is **rejected** when it would be unsafe. It does not prove that an accepted one works.
`lib/breachAlert.ts` has **no test file, deliberately** — it reads a database, `vitest.config.mts`
excludes anything that does, and a fake-transport test would test the fake. What stands in for a
test there is that the file is forbidden from deciding anything: acceptance **#38 = `0`** — it may
not so much as mention `sayingNo`, `projectedRatio`, `coveragePercent`, `authoritative` or
`projectedVariance`. Every branch on a financial fact is therefore in a fixture-pinned module, and
what is left ungated is four I/O calls in a fixed order.

The closest thing to a test of that shell is in §7.5: its two SQL statements, executed against a
scratch database with fabricated data.

---

## 3. Evidence #9 — the four rows the authorised edit costs

*(The fifth off-spec row, #1, is an environment artifact and is in §10.1.)*

### 3.1 What happened

`lib/domain/monthOutlook.test.ts:1029` read the coverage query's source out of
`app/dashboard/page.tsx` and asserted on its predicate set — step 32's static N42 control. G0
adjudication **A1** authorised moving that query to `lib/monthOutlookRead.ts`. After the move the
gate was **pointing at an empty room**: `getCoverageGroups` appears `0` times in the page.

Simultaneously the spec froze that file byte-identical (#66, #69) and demanded a whole-repo-green
suite (#2, #65). Those cannot all hold. I stopped and reported rather than choosing.

### 3.2 The ruling, and what I did under it

The coordinator ruled: **relocate the assertion with its subject**, under three conditions. All three
are met:

| Condition | Evidence |
|---|---|
| It must still bite in both directions | §6, mutations **R1** and **R2** — both go red |
| Keep the slice; do not degrade to a file-wide grep | The `FROM`→`GROUP BY` slice is unchanged. **R2 proves it**: the mutant was caught with the predicate bolted onto the `JOIN … ON` clause, which only that slice can see. A `grep -c` on the file would have missed nothing, but a `WHERE`-only slice would have |
| Declare it explicitly, with before/after | Below, and the full diff is in §9.2 |

**Before:** `const PAGE_SOURCE = readFileSync(new URL('../../app/dashboard/page.tsx', import.meta.url), 'utf8');`
**After:**  `const READER_SOURCE = readFileSync(new URL('../monthOutlookRead.ts', import.meta.url), 'utf8');`

Plus the error string on the next-but-four line, and a comment block declaring the change. **No
assertion changed. No assertion was added or removed.** Six assertions before, six after.

### 3.3 The four rows this costs

| # | Command | Expected | Measured | Why |
|---|---|---|---|---|
| **66** | `git diff --stat HEAD -- …monthOutlook.test.ts…` | `0` | **`2`** | the authorised edit |
| **69** | `git diff --name-only HEAD -- … lib/domain/` | `0` | **`1`** | the same file |
| **78** | scope, tracked files | `0` | **`1`** | `lib/domain/monthOutlook.test.ts` is not in the allowlist |
| **79** | scope, including untracked | `0` | **`1`** | the same file |

Each of the four lists **exactly one path** and it is the same path in all four:

```
$ git diff --name-only HEAD | grep -vE '^(lib/breachAlert\.ts|…|plan/)'
lib/domain/monthOutlook.test.ts

$ git status --porcelain | grep -vE '^.. (lib/domain/breachAlert(\.test)?\.ts|…|plan/)'
 M lib/domain/monthOutlook.test.ts
```

**Nothing else is out of scope.** #68 (`shared/`) = `0`, #55c (`instrumentation.ts`) = `0`, and #69's
other eight paths are all clean.

### 3.4 Noted, as instructed: a second patch on a gate that wants restructuring

Step 32 recorded this assertion as brittle to *reformatting*. Brittleness to *relocation* is the same
defect, and it has now bitten inside one task. The relocation is a patch, not a fix. The durable
answer — deferred, still outstanding, and explicitly **not mine to do here** — is for the reader to
return rows and let the domain aggregate, which makes the sign rule the classifier's own contract:
behaviourally testable, and indifferent to which file the SQL lives in.

---

## 4. Evidence #6 — the Q3 limitation, verbatim

> **The in-process timer only fires while the Next server is up. `net_worth_snapshots` has no row for
> 2026-08-12 for exactly this reason. The guardrail will miss days the same way, silently, until
> Phase 2 step 20 and Phase 5 step 39 land.**

And the second half, which this step also does not fix: **nothing shouts.** If the server is down for
a month, `alert_sends` is simply empty and no one is told. What this step buys instead, at near-zero
cost, is that the *record* is unambiguous — a row is written for a failed attempt too, so "nothing
for three weeks" (the job never ran) and "three rows with `delivered = FALSE`" (it ran and could not
reach the provider) stop looking identical.

---

## 5. Evidence #7 — measured on the owner's dev database, today

Read-only. Three `SELECT`s through `loadMonthOutlook`. Only counts, closed-vocabulary words and the
coverage share are reproduced here — no category name and no dollar figure.

```
as-of (0-based month):   2026-8-4
state:                   too-early
authoritative:           false
coveragePercent:         0
coverageShare === null:  false
scoredCategoryCount:     9
sayingNo.length:         0
coverageGroupCount:      2
planAlert would produce: coverage
```

**Said plainly, as the spec requires: on the owner's real data today, the only message this step can
ever send is the coverage message.** `authoritative` is `false`, so rung 3 fires and rungs 4 and 5 are
unreachable. The breach message — the thing the step is nominally for — will not fire until
categorization improves.

Two details worth recording because they sharpen it rather than soften it:

- **`coveragePercent` is `0`, not `null`.** There *is* spend recorded this month (`coverageGroupCount`
  = 2), but none of it is in the scored set. So rung 2 does not fire and rung 3 does, and the message
  would open *"Only 0% of the spend recorded so far in 2026-09 has been categorized"*. That is
  accurate and it is exactly what the ladder was built to produce. It is not a `0` standing in for a
  missing value — `coverageShare === null` is `false`.
- **`state` is `too-early`, on day 4 of 30.** `PROJECTION_MIN_ELAPSED` is `0.25` and `4/30 = 0.133`,
  so the domain declines to project at all yet. That is orthogonal to coverage and does not change
  the reading above.

**This is information about the data, not a reason to weaken Q2.** The spec says so and I agree: the
phase's exit criterion is satisfied in shape here and not yet in effect, and the honest response is
to record that.

---

## 6. Mutation section — every load-bearing guard, removed or inverted

Each mutation was applied, the suite run, the output recorded, and the file restored and verified
byte-identical (`cmp -s` → `IDENTICAL`) before the next.

### 6.1 The guards the spec names

| # | Mutation | Result | Caught by |
|---|---|---|---|
| **M1** | **Coverage degradation deleted** — rung 3 removed, so low coverage falls through to the full breach message | **2 failed / 20 passed** | F4 (#11) and F16 (#25) |
| **M1b** | **The refusal written as a *sentence*** — caveat kept, figures appended below it (the "reads as compliant" failure) | **1 failed / 21 passed** | F4 (#11) — `not.toContain('$284.00')` is the discriminator |
| **M2** | **Fingerprint stops excluding amounts** — `actual` added to the digest input | **1 failed / 21 passed** | F11 (#21) |
| **M3** | **Suppression keys on *attempted*** — `p.delivered &&` dropped from `shouldSend` | **1 failed / 21 passed** | F19 (#27) |
| **M4** | **The allowlist crossed** — the whole record interpolated into the body | **3 failed / 19 passed** | F1 (#7), F2 (#9), F21 (#18) — and the static control #10 went `0` → `2` |
| **M5** | **TLS: port 25 admitted** as a legal port | **2 failed / 7 passed** | F-M3 (#31), F-M6 (#34) |
| **M5b** | **TLS: 587 accepted without requiring STARTTLS** (the silent plaintext fallback) | **1 failed / 8 passed** | F-M2 (#30) |
| **M5c** | **TLS: certificate-verification opt-out honoured** instead of refused | **1 failed / 8 passed** | F-M4 (#32) |
| **M6** | **Credential leak** — the environment serialised into the thrown message | **1 failed / 8 passed** | F-M6 (#34) |
| **M7** | **Enable flag read as truthy** — `Boolean(env.ALERTS_ENABLED)`, so `'false'` enables sending | **1 failed / 8 passed** | F-M7 (#35) |

**Every guard the dispatch named bites.** No survivors among them.

### 6.2 The relocated N42 gate, per the coordinator's condition 1

| # | Mutation to `lib/monthOutlookRead.ts` | Result |
|---|---|---|
| **R1** | `AND t.amount > 0` removed from the relocated query | **1 failed / 39 passed** — `expected 'WHERE t.hidden = FALSE\n       AND t.…' to contain 't.amount > 0'` |
| **R2** | `AND a.landscape = 'operational'` bolted onto the `JOIN … ON` clause | **1 failed / 39 passed** — `expected 'FROM transactions t\n      JOIN accou…' not to contain 'a.landscape'` |

R2 is the one that matters for condition 2: the mutant hid in the `JOIN`, not the `WHERE`, and the
preserved `FROM`→`GROUP BY` slice is what caught it.

### 6.3 Survivors — found, reported, and then closed

**A sweep of eight further guards found five that survived with the suite entirely green.** They are
reported here in full rather than quietly fixed, because the fact that they survived is the finding.
All five were guards I had written *beyond* what the spec's fixtures pin — which is exactly the class
that rots, since a later refactor deleting them sees a green suite and concludes they were dead code.

| # | Guard | Before | After |
|---|---|---|---|
| **P3** | `finite()` on `budgeted` | **SURVIVOR** — 22 passed | CAUGHT — 1 failed / 22 passed |
| **P4** | `finite()` on `projected` | **SURVIVOR** — 22 passed | CAUGHT |
| **P5** | `finite()` on `projectedRatio` | **SURVIVOR** — 22 passed | CAUGHT |
| **P5b** | `finite()` on `spentRatio` | (same class) | CAUGHT |
| **P6** | `describeSmtp` omitting the SMTP user | **SURVIVOR** — 9 passed | CAUGHT — 1 failed / 9 passed |
| **P7** | `ALERT_EMAIL_FROM` address validation | **SURVIVOR** — 9 passed | CAUGHT — 1 failed / 9 passed |

The cause in each case: F22 corrupts only `actual`, F-M8 pins only the password's absence, and F-M9
pins only the recipient. Two tests were added — one per suite — and both are named for what they
close. The suites went 22 → 23 and 9 → 10; #5 (`-ge 22`) and #6 (`-ge 9`) are floors, so both still
pass.

Three guards in the same sweep were already caught and needed nothing: **P1** the 1-based month
(`String(month + 1)` → `String(month)`, 2 failed), **P2** the ratio floored instead of rounded — the
487/488 divergence — (2 failed), and **P8** rung 1 removed (1 failed).

### 6.4 What no mutation can reach, stated rather than glossed

`lib/breachAlert.ts` has no test file and no mutation of it can go red, because nothing exercises it.
That is Q1's accepted cost. The compensating control is #38 (`0`) — the shell cannot branch on a
financial fact — and the §7.5 execution of its two SQL statements against a scratch database.

---

## 7. Acceptance — all 79 rows

`⟨A⟩` and `⟨M⟩` were each run once with `--reporter=verbose` and captured; the `grep -cF` rows run
against that captured output, which is byte-identical to re-running. Full listings in §7.6.

### 7.1 Baseline (#1–#6)

```
#1     ENV  expected=exit=0                    measured=exit=0 clean / exit=2 with .next dupes  (§10.1)
#2     pass expected=1                         measured=1
#3     pass expected=✖ 1 problem (0 errors, 1 warning)   measured=✖ 1 problem (0 errors, 1 warning)
#4     pass expected=exit=0                    measured=exit=0
#5     pass expected=OK                        measured=OK
#6     pass expected=OK                        measured=OK
```

`npm test` → `Test Files 23 passed (23)` / `Tests 448 passed (448)`. Baseline was 21/415; this step
adds 2 files and 33 tests (23 in `breachAlert.test.ts`, 10 in `mailConfig.test.ts`). Nothing is
skipped, and the three tripwire suites are unchanged at 47 / 24 / 40.

**#3's warning is the pre-existing one and no other**: `scripts/seed-demo.mjs:457` — *'pid' is
assigned a value but never used*. (The dispatch brief said line 438; measured at 457. Same warning,
same file, same rule; the line number in the brief is stale. Nothing in this task touches that file —
#69 = `0` for `scripts/`.)

**#1 has an ordering hazard, and it is the environment issue, not the code.** See §10.

### 7.2 The message, allowlist, coverage refusal (#7–#19)

```
#7     pass expected=1   measured=1        #14    pass expected=1   measured=1
#8     pass expected=1   measured=1        #15    pass expected=1   measured=1
#9     pass expected=1   measured=1        #16    pass expected=1   measured=1
#10    pass expected=0   measured=0        #17    pass expected=1   measured=1
#11    pass expected=1   measured=1        #18    pass expected=1   measured=1
#12    pass expected=1   measured=1        #19    pass expected=1   measured=1
#13    pass expected=1   measured=1
```

### 7.3 Fingerprint and suppression (#20–#28)

```
#20    pass expected=1   measured=1        #25    pass expected=1   measured=1
#21    pass expected=1   measured=1        #26    pass expected=1   measured=1
#22    pass expected=1   measured=1        #27    pass expected=1   measured=1
#23    pass expected=1   measured=1        #28    pass expected=1   measured=1
#24    pass expected=1   measured=1
```

### 7.4 Mail configuration (#29–#37)

```
#29    pass expected=1   measured=1        #34    pass expected=1   measured=1
#30    pass expected=1   measured=1        #35    pass expected=1   measured=1
#31    pass expected=1   measured=1        #36    pass expected=1   measured=1
#32    pass expected=1   measured=1        #37    pass expected=1   measured=1
#33    pass expected=1   measured=1
```

### 7.5 The trigger, the extraction, the tripwires, secrets and scope (#38–#79)

```
#38    pass expected=0                      measured=0
#39    pass expected=OK                     measured=OK
#40    pass expected=OK                     measured=OK
#41    pass expected=1                      measured=1
#42    pass expected=0                      measured=0      ← NO TEST CONSTRUCTS A TRANSPORT
#43    pass expected=0                      measured=0      ← no test reads the real credentials
#44    pass expected=lib/breachAlert.ts     measured=lib/breachAlert.ts
#45    pass expected=0                      measured=0
#46    pass expected=0                      measured=0
#47    pass expected=OK                     measured=OK
#48    pass expected=0                      measured=0
#49    pass expected=0                      measured=0
#50    pass expected=0                      measured=0
#51    pass expected=0                      measured=0
#52    pass expected=0                      measured=0
#53    pass expected=0                      measured=0
#54    pass expected=0                      measured=0
#55    pass expected=0                      measured=0
#55a   pass expected=0                      measured=0
#55b   pass expected=2                      measured=2
#55c   pass expected=0                      measured=0
#55d   pass expected=OK                     measured=OK
#55e   pass expected=OK                     measured=OK
#56    pass expected=0                      measured=0
#56a   pass expected=1                      measured=1
#57    pass expected=0                      measured=0
#57a   pass expected=1                      measured=1
#58    pass expected=1                      measured=1
#59    pass expected=0                      measured=0
#60    pass expected=OK                     measured=OK
#61    pass expected=1/1/1/1                measured=1/1/1/1
#62    pass expected=data-testid="month-outlook-hero"   measured=data-testid="month-outlook-hero"
#62a   pass expected=1                      measured=1
#62b   pass expected=0                      measured=0
#63    pass expected=OK                     measured=OK     ← adherence, exactly 47
#64    pass expected=OK                     measured=OK     ← pacing, exactly 24
#65    pass expected=OK                     measured=OK     ← monthOutlook, exactly 40
#66    FAIL expected=0                      measured=2      ← §3, the authorised repoint
#67    pass expected=2                      measured=2      ← under A7, see below
#67a   pass expected=OK                     measured=OK
#68    pass expected=0                      measured=0
#69    FAIL expected=0                      measured=1      ← §3
#70    pass expected=1                      measured=1
#71    pass expected=0                      measured=0
#72    pass expected=OK                     measured=OK
#73    pass expected=OK                     measured=OK
#74    pass expected=1                      measured=1
#75    pass expected=1                      measured=1
#76    pass expected=0                      measured=0
#77    pass expected=no leaks found         measured=no leaks found
#78    FAIL expected=0                      measured=1      ← §3
#79    FAIL expected=0                      measured=1      ← §3
```

**#67, and which route I took (G1 A7).** I used **`git add -N`**, not the porcelain substitute:

```
$ git add -N migrations/1788505200000_alert-sends.sql
$ git diff --name-only HEAD -- migrations/ db/schema.sql | wc -l | tr -d ' '
2
$ git diff --name-only HEAD -- migrations/ db/schema.sql
db/schema.sql
migrations/1788505200000_alert-sends.sql
$ git reset -q -- migrations/1788505200000_alert-sends.sql      # index restored
```

Unstaged it reads `1`. I also verified the staging does **not** leak into the scope rows: #78 read
`1` in both the clean-index and the staged state — the same single file, `lib/domain/monthOutlook.test.ts`
— so staging the migration changes nothing except #67. The index was restored afterwards and
`git status --porcelain migrations/` reads `?? migrations/1788505200000_alert-sends.sql`, exactly as
this task found it.

---

## 8. Evidence #8 — the seven new keys, and what is left for the owner

```
$ tail -17 .env.local.example
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
ALERT_EMAIL_TO=
ALERT_EMAIL_FROM=
ALERTS_ENABLED=

$ git ls-files | grep -cE '^\.env'
0

$ gitleaks protect --no-banner --redact 2>&1 | tail -1
8:02AM INF no leaks found
```

**All seven values are empty.** #74 (`^SMTP_PASSWORD=$`) = `1` and #75 (`^ALERTS_ENABLED=$`) = `1`,
so a fresh checkout is off by construction rather than by convention: `alertsEnabled` demands the
literal string `true`, and the example file cannot supply it.

**`.env.local` was not modified.** It is the owner's, it holds the real `DATABASE_URL`, and adding a
placeholder SMTP password there would be inventing a credential. **The credential is the owner's to
add** — four SMTP values plus two addresses, and then `ALERTS_ENABLED=true` when they want it live.
Until that last one is set, `runBreachAlert` logs `alerts disabled, nothing attempted` and returns
before a query runs.

### Evidence #4 — the owner's manual send: **it did not happen.**

No agent sent anything, and I am not implying otherwise. Whether to verify delivery is the owner's
decision, on the owner's machine, with the owner's `.env.local`. If they do, the first send will be
the **coverage** message (§5), not a breach message.

---

## 9. The diff

### 9.1 `git diff --stat`

```
 app/dashboard/page.tsx                   | 203 +++----------------------------
 db/schema.sql                            |  36 ++++++
 lib/domain/monthOutlook.test.ts          |  30 ++++-
 lib/scheduler.ts                         |  15 +++
 migrations/1788505200000_alert-sends.sql | 176 +++++++++++++++++++++++++++
 package-lock.json                        |  21 ++++
 package.json                             |   2 +
 plan/QUEUE.md                            |   1 +
 8 files changed, 295 insertions(+), 189 deletions(-)
```

New files (untracked, so absent from `--stat`):

```
 366  lib/domain/breachAlert.ts        the pure decision: planAlert, shouldSend, the fingerprint
 425  lib/domain/breachAlert.test.ts   23 tests
 169  lib/mailConfig.ts                TLS, credentials, the enable flag
 129  lib/mailConfig.test.ts           10 tests
 242  lib/monthOutlookRead.ts          the extracted reader, one loadMonthOutlook
 193  lib/breachAlert.ts               the shell — the only createTransport in the repo
```

`git status --porcelain`:

```
 M app/dashboard/page.tsx
 M db/schema.sql
 M lib/domain/monthOutlook.test.ts     ← the one out-of-allowlist path (§3)
 M lib/scheduler.ts
?? migrations/1788505200000_alert-sends.sql
 M package-lock.json
 M package.json
 M plan/QUEUE.md
?? lib/breachAlert.ts
?? lib/domain/breachAlert.test.ts
?? lib/domain/breachAlert.ts
?? lib/mailConfig.test.ts
?? lib/mailConfig.ts
?? lib/monthOutlookRead.ts
?? plan/tasks/P0.5-33-delivery-channel/
```

### 9.2 The extraction, before and after

```
                                                     BEFORE (64cb0d6)   AFTER
getBudgetCategories in app/dashboard/page.tsx              1              0
getMonthlyActuals   in app/dashboard/page.tsx              1              0
getCoverageGroups   in app/dashboard/page.tsx              1              0
toAdherenceInput    in app/dashboard/page.tsx              1              0
isoDay              in app/dashboard/page.tsx              3              0
the actuals SQL, in the page                (#56)          1              0
the actuals SQL, in the reader              (#56a)    0 (no file)         1
the FILTER predicate, in the page           (#57)          1              0
the FILTER predicate, in the reader         (#57a)    0 (no file)         1
repo-wide definitions of the actuals SQL    (#58)          1              1   ← still exactly one
new Date( in the page                       (#62a)         1              1   ← one clock read
data-testid="month-outlook-hero"            (#61)          1              1
data-testid="coverage-caveat"               (#61)          1              1
data-testid="coverage-refusal"              (#61)          1              1
data-testid="categories-saying-no"          (#61)          1              1
first data-testid in source order           (#62)    month-outlook-hero   month-outlook-hero
```

**The rendered surface is unmoved.** The page's own copy, markup and figures are untouched; it is
touched only by deletion and import, plus the one permitted rename (`coverageGroups.length` →
`monthRead.coverageGroupCount`).

Two notes on the relocation, both recorded rather than discovered later:

- **`isoDay` moved with the queries, and it is a clean deletion.** It was used at exactly three sites
  in the page and *all three* were inside `getMonthlyActuals` and `getCoverageGroups`. Nothing left
  in the page calls it, so there is no second copy and no import back.
- **One type-only change in transit.** The four functions took the page's local `DashboardAsOf`, a
  structural duplicate of the domain's `AsOf`. They now take `AsOf`. `DashboardAsOf` stays in the
  page because `getStats` and five other surviving queries use it. The SQL strings themselves are
  byte-identical — #56a and #57a are the proof.

### 9.3 The diff to the frozen input, in full

Path and error string only, plus a declaring comment. **No assertion changed.**

```diff
-const PAGE_SOURCE = readFileSync(new URL('../../app/dashboard/page.tsx', import.meta.url), 'utf8');
+const READER_SOURCE = readFileSync(new URL('../monthOutlookRead.ts', import.meta.url), 'utf8');

 function coverageQuerySql(): string {
-  const from = PAGE_SOURCE.indexOf('async function getCoverageGroups');
-  if (from === -1) throw new Error('getCoverageGroups not found in app/dashboard/page.tsx');
-  const body = PAGE_SOURCE.slice(from, PAGE_SOURCE.indexOf('\n}\n', from));
+  const from = READER_SOURCE.indexOf('async function getCoverageGroups');
+  if (from === -1) throw new Error('getCoverageGroups not found in lib/monthOutlookRead.ts');
+  const body = READER_SOURCE.slice(from, READER_SOURCE.indexOf('\n}\n', from));
   const open = body.indexOf('`');
   return body.slice(open + 1, body.indexOf('`', open + 1));
 }
```

The other three read-only inputs are **byte-identical**: `adherence.ts`, `pacing.ts`,
`monthOutlook.ts`, `adherence.test.ts` and `pacing.test.ts` all show no diff, and #63/#64 confirm
47 and 24 tests exactly.

---

## 10. Environment findings, reported rather than touched

### 10.1 `.next` duplicate artifacts — the ninth recurrence, and it decides row #1

**I did not touch them, per instruction.** What follows is measurement only.

They recurred twice during this session. First as `* 2.ts`, which made `#1` return **exit=2**:

```
.next/types/cache-life.d 2.ts(3,1): error TS6200: Definitions of the following identifiers conflict
  with those in another file: unstable_cache, updateTag, revalidateTag, revalidatePath, refresh, …
.next/types/routes.d 2.ts(93,8): error TS2300: Duplicate identifier 'LayoutProps'.
exit=2
```

Row **#4**'s own `next build` then rewrote `.next/types/` and cleared that set, after which `tsc`
returned **exit=0** on the identical tree. Then a later build left a `* 3.ts` set behind, dated
`07:53`, which survived the `08:01` rebuild:

```
$ ls -l .next/types/
-rw-------  cache-life.d 3.ts     Sep  4 07:53      -rw-r--r--  cache-life.d.ts     Sep  4 08:01
-rw-------  root-params.d 3.ts    Sep  4 07:53      -rw-r--r--  root-params.d.ts    Sep  4 08:01
-rw-------  routes.d 3.ts         Sep  4 07:53      -rw-r--r--  routes.d.ts         Sep  4 08:01
-rw-------  validator 3.ts        Sep  4 07:53      -rw-r--r--  validator.ts        Sep  4 08:01
```

`tsconfig.json` includes `.next/types/**/*.ts`, so those are compiled, and they are byte-identical
copies of the real ones — hence TS6200 and TS2300. With them present `tsc` now fails **consistently**
(three consecutive runs, all non-zero).

**The code itself is clean, and here is the measurement that separates the two:**

```
$ npx tsc --noEmit --incremental false 2>&1 | grep -v '\.next/types/.* 3\.ts'
(no output)
```

Every error `tsc` reports comes from those four duplicate files. Nothing in this task's diff produces
one. `tsc` returned `exit=0` three separate times today on trees where the duplicates were absent
(07:16 baseline, 07:55, and 08:01 after the rebuild cleared the `* 2.ts` set).

Two further notes for whoever fixes this:

- **They are gitignored** (`git check-ignore -v` → `.gitignore:17:/.next/`), so they never enter the
  diff and no scope row sees them.
- **`#1` and `#4` interact, and the interaction is not stable.** A `next build` intermittently leaves
  a duplicate set behind; a later build may or may not clear it. So the same command on the same tree
  gave `exit=0` at 08:06:41 and `exit=2` at 08:07 — which is worse than a consistent failure, because
  a sweep can report either. Whoever re-runs acceptance should confirm `find .next -name '* [0-9].*'`
  is empty first, and treat #1 as unmeasurable until it is.

**Current state, as handed over: none.** The closing `npm run build` cleared the `* 3.ts` set, and
the tree now measures `find .next -name '* [0-9].*'` → `0`, `npx tsc --noEmit` → `exit=0`. So **#1
reads `exit=0` on the tree as delivered** — but it did so before the duplicates appeared too, and
will flip again the next time a build leaves a set behind. That is why it is recorded as
environment-dependent rather than simply green.

### 10.2 The lint warning's line number has moved

`scripts/seed-demo.mjs:457`, not `:438`. Same file, same rule, same single warning; the brief's line
number is stale. That file is untouched by this task (#69 = `0`).

---

## 11. Evidence #5 — the migration, round-tripped

**`.env.local` was never used.** `DATABASE_URL` was overridden explicitly on every command, against a
scratch database created and dropped for this purpose (`b8_impl_p0533`). `npm run migrate:up` does
not appear below because it hard-codes `--envPath .env.local`.

```
$ dropdb --if-exists b8_impl_p0533 && createdb b8_impl_p0533

$ DATABASE_URL="$SCRATCH" npx node-pg-migrate up
… CREATE INDEX idx_alert_sends_fingerprint ON alert_sends(fingerprint);
INSERT INTO "public"."pgmigrations" (name, run_on) VALUES ('1788505200000_alert-sends', NOW());
Migrations complete!

$ DATABASE_URL="$SCRATCH" npx node-pg-migrate down
DELETE FROM "public"."pgmigrations" WHERE name='1788505200000_alert-sends';
Migrations complete!

$ psql -Atc "SELECT to_regclass('alert_sends') IS NULL"
t

$ DATABASE_URL="$SCRATCH" npx node-pg-migrate up
INSERT INTO "public"."pgmigrations" (name, run_on) VALUES ('1788505200000_alert-sends', NOW());
Migrations complete!
round-trip exit=0

$ psql -Atc "SELECT count(*) || ' migrations applied' FROM pgmigrations"
9 migrations applied
```

### The `alert_sends` section of `db/schema.sql`, quoted so no money column can hide

```sql
CREATE TABLE IF NOT EXISTS alert_sends (
  id             SERIAL PRIMARY KEY,
  attempted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind           TEXT NOT NULL CHECK (kind IN ('projected-breach', 'coverage')),
  fingerprint    TEXT NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{16,}$'),
  delivered      BOOLEAN NOT NULL,
  failure_reason TEXT CHECK (failure_reason IN ('config', 'transport', 'rejected')),
  CONSTRAINT alert_sends_delivered_failure_reason_check CHECK (NOT delivered OR failure_reason IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_alert_sends_fingerprint ON alert_sends(fingerprint);
```

Six columns. **No money column, no category, no payee, no account identifier, no amount of any
kind** — #71 = `0` over the migration file, comments included. G1's "money columns are `NUMERIC` with
a stated scale" is satisfied **vacuously**, and I say so here rather than leaving the box ambiguous:
there is nothing for the rule to range over, by design.

### The shell's two statements, executed — the closest thing to a test `lib/breachAlert.ts` can have

Fabricated data. The fingerprint is the one from §1's breach message.

```
-- 1. the INSERT, failed attempt (delivered stated explicitly; there is no default)
1|projected-breach|f|transport
INSERT 0 1

-- 2. the suppression read AS THE SHELL WRITES IT (no delivered predicate; the pure function judges)
010be172cc620cef90a861f10f881de43097c0269b834fc8a0878ba7214cdf91 delivered=false
   shouldSend() over that row => true (a failed send never silences the retry)

-- 3. the INSERT again, this time delivered
2|t
INSERT 0 1
   two rows for one fingerprint — the duplicates ARE the history

-- 4. control: the contradictory row is refused
ERROR:  new row for relation "alert_sends" violates check constraint
        "alert_sends_delivered_failure_reason_check"

-- 5. control: the mutable "last sent" row is UNWRITABLE
ERROR:  there is no unique or exclusion constraint matching the ON CONFLICT specification

-- 6. control: the naive names-joined key is refused at the column
ERROR:  new row for relation "alert_sends" violates check constraint
        "alert_sends_fingerprint_check"
```

Scratch database dropped afterwards; `psql -lqt | grep -c b8_impl_p0533` → `0`.

**One deliberate divergence from the contract's suggested SQL, declared here.** `CONTRACT.md` names
the suppression read as `SELECT 1 FROM alert_sends WHERE fingerprint = $1 AND delivered LIMIT 1`. The
shell instead issues `SELECT fingerprint, delivered FROM alert_sends WHERE fingerprint = $1` and hands
the rows to `shouldSend`. **This is not a schema change and not a contract change** — same table, same
column, strictly more rows read. The reason is Q1: with `AND delivered` in the `WHERE` clause, the
suppression *decision* would live in the one file no test reaches, and `shouldSend`'s `delivered`
check would become dead code that still looked correct. Fetching and asking puts the decision where
F19 can hold it — and **M3 in §6.1 is the proof that it does**: inverting `shouldSend` goes red.
The contract's warning ("written as existence-of-a-row alone, the first network blip silences the
guardrail") is honoured, one layer further in.

---

## 11b. Every fixture, expected vs measured

All 33 assertions ran and all 33 passed. "Measured" is what the rendered artifact in §1 actually
contains, not a restatement of the expectation.

### `lib/domain/breachAlert.test.ts` — 23 tests

| Fixture | Expected | Measured |
|---|---|---|
| **F1** | `kind: 'projected-breach'`; body has `Dining Out`, `$284.00`, `$400.00`, `$1,065.00`, `71%`, `266%`, `day 8 of 30`, `Travel`, `$260.00`, `$200.00`, `$975.00`, `130%`, `488%`, `96%`, `open the app` | all 15 present — see §1 |
| **F1** neg | no `$665.00`, `$775.00`, `487%`, `NaN`, `null`, `undefined`, `Infinity`, `of this month's spend` | all 8 absent |
| **F2** | body keeps `Dining Out` / `$284.00`; body **and** subject carry none of `CHIPOTLE`, `0421`, `acct_9f3a2b`, `250000`, `txn_77` | 2 present, 10 absent (5 × 2 surfaces) |
| **F3** | subject has `2026-09` and `2`; no `$`, `266`, `284`, `Dining Out`, `Travel` | `Budget guardrail — 2 saying no in 2026-09` |
| **F4** | `kind: 'coverage'`; body has `7%`, `2`, `open the app`; body+subject carry no `Dining Out`, `Travel`, `$284.00`, `$400.00`, `266`, `488`, `$` | 3 present, 14 absent — see §1 |
| **F5** | `null` (rung 1 beats rung 3) | `null`; `?.kind` is not `'coverage'` |
| **F6** | `null` (rung 5, a quiet month) | `null` |
| **F7** | `null` (rung 2, empty population) | `null` |
| **F7a** | `null` — rung 2 beats rungs 3 **and** 4 | `null` with `sayingNo = [D, T]` |
| **F8** | subject and body contain `2026-09`, never `2026-08` | both contain `2026-09`; neither contains `2026-08` |
| **F9** | `488%` and `266%`; not `487%`, not `266.25` | `(488%)` and `(266%)` rendered |
| **F10** | `$1,065.00` and `$975.00`; not `$1065.00`, not `$1,312.50` | grouped forms rendered; both negatives absent |
| **F11** | `fingerprint(O) === fingerprint(O')` with `actual` 284→350, `projected`→1312.5, `projectedRatio`→3.28125 | identical |
| **F12** | order-independent | `[T, D]` gives the same digest |
| **F13** | a third `Groceries`/`breach` record changes it | different |
| **F14** | `Dining Out` `projected-breach`→`breach` changes it | different |
| **F15** | `asOf.month` 8→9 changes it | different |
| **F16** | breach vs coverage digests differ for one month | `010be172…` vs `fad0d018…` |
| **F17** | matches `/^[0-9a-f]{16,}$/`; no `Dining`, `Travel`, `\|` | 64 lowercase hex chars; all three absent |
| **F18** | `shouldSend(m, [{fp, delivered: true}])` → `false` | `false` |
| **F19** | `shouldSend(m, [{fp, delivered: false}])` → **`true`** | `true` |
| **F20** | `shouldSend(m, [])` and with a foreign fingerprint → `true` | `true`, `true` |
| **F21** | body has `Gym`, `$150.00`; no `null`, `NaN`, `$0.00`, `undefined` | `Gym — spending in a month it budgets nothing for` / `  spent $150.00` |
| **F22** | `RangeError` naming `Dining Out`; no message returned | throws `RangeError`, message matches `/Dining Out/` |
| *(added)* | every printed figure guarded, not just `actual` | `budgeted`, `projected`, `spentRatio`, `projectedRatio` and `NaN` all throw — see §6.3 |

### `lib/mailConfig.test.ts` — 10 tests

| Fixture | Expected | Measured |
|---|---|---|
| **F-M1** | `secure === true` on 465 | `true`; port `465`, host `smtp.provider.test` |
| **F-M2** | on 587, `secure === false` **and** `requireTLS === true` | `false` / `true` |
| **F-M3** | port 25 throws, naming the port and TLS | throws; matches `/25/` and `/TLS/` |
| **F-M4** | `SMTP_TLS_REJECT_UNAUTHORIZED: 'false'` throws | throws; no configuration returned |
| **F-M5** | missing `SMTP_PASSWORD` throws, message names the key | throws; matches `/SMTP_PASSWORD/` |
| **F-M6** | the thrown message omits `S3cret-Value-Not-Real` | thrown message non-empty and does not contain it |
| **F-M7** | `{}`, `TRUE`, `1`, `yes`, `true` → `false, false, false, false, true` | exactly that; the four falses also asserted `not.toBe(true)` |
| **F-M8** | `describeSmtp` has `smtp.provider.test` and `465`, not the password | `smtp.provider.test:465 (implicit TLS)` |
| **F-M9** | `ALERT_EMAIL_TO: 'not-an-address'` throws | throws; matches `/ALERT_EMAIL_TO/` |
| *(added)* | the sender is validated on the same rule; `describeSmtp` omits the user | both throw / absent — see §6.3 |

---

## 12. Verbose listings

### 12.1 `lib/domain/breachAlert.test.ts` — 23 passed

```
RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app

✓ lib/domain/breachAlert.test.ts > planAlert — the message, its allowlist, and the coverage refusal > two categories saying no under authoritative coverage produce one message naming both, their spend against their budgets and their projected share of the month 4ms
✓ lib/domain/breachAlert.test.ts > planAlert — the message, its allowlist, and the coverage refusal > the subject line carries the count and the month and never a dollar amount, because a subject is what a lock screen shows 0ms
✓ lib/domain/breachAlert.test.ts > planAlert — the message, its allowlist, and the coverage refusal > the message renders only the allowlisted fields, so a category record carrying a merchant, an account id and a balance leaks none of the three 0ms
✓ lib/domain/breachAlert.test.ts > planAlert — the message, its allowlist, and the coverage refusal > coverage below the threshold withdraws the figures as well as the confidence: the message names no category, no amount and no ratio 0ms
✓ lib/domain/breachAlert.test.ts > planAlert — the message, its allowlist, and the coverage refusal > a month with nothing scored produces no message at all, because there is no guardrail to report the state of 0ms
✓ lib/domain/breachAlert.test.ts > planAlert — the message, its allowlist, and the coverage refusal > a month where every scored category is holding produces no message, and that silence is what step 39's heartbeat exists to break 0ms
✓ lib/domain/breachAlert.test.ts > planAlert — the message, its allowlist, and the coverage refusal > a month with no spend at all produces no message rather than one reporting zero percent or a hundred 0ms
✓ lib/domain/breachAlert.test.ts > planAlert — the message, its allowlist, and the coverage refusal > an empty population beats a non-empty saying-no list, because there is no share to caveat the figures with 0ms
✓ lib/domain/breachAlert.test.ts > planAlert — the message, its allowlist, and the coverage refusal > the as-of month is rendered one-based against the domain's zero-based index, so September is 2026-09 and never 2026-08 0ms
✓ lib/domain/breachAlert.test.ts > planAlert — the message, its allowlist, and the coverage refusal > a category's share of budget is rendered by the same rule the dashboard uses, so the email and the page cannot disagree by a percentage point 0ms
✓ lib/domain/breachAlert.test.ts > planAlert — the message, its allowlist, and the coverage refusal > money is formatted once at the message boundary and never re-derived from the budget and the actual 0ms
✓ lib/domain/breachAlert.test.ts > planAlert — the message, its allowlist, and the coverage refusal > an off-cycle category has no projection to report, so its line names the spend and omits the comparison rather than printing null 0ms
✓ lib/domain/breachAlert.test.ts > planAlert — the message, its allowlist, and the coverage refusal > a non-finite figure reaching the renderer is rejected rather than printed as NaN 0ms
✓ lib/domain/breachAlert.test.ts > planAlert — the message, its allowlist, and the coverage refusal > every figure the message prints is guarded and not merely the first one, so a non-finite budget, projection or ratio is refused too 1ms
✓ lib/domain/breachAlert.test.ts > the fingerprint, and duplicate suppression > the fingerprint is an opaque digest carrying no category name 0ms
✓ lib/domain/breachAlert.test.ts > the fingerprint, and duplicate suppression > the fingerprint does not move when the month's spend does, because the same categories for the same reasons are not news twice 0ms
✓ lib/domain/breachAlert.test.ts > the fingerprint, and duplicate suppression > the fingerprint does not depend on the order the categories arrive in 0ms
✓ lib/domain/breachAlert.test.ts > the fingerprint, and duplicate suppression > a category joining the set changes the fingerprint, and a category escalating from projecting over to already over changes it too 1ms
✓ lib/domain/breachAlert.test.ts > the fingerprint, and duplicate suppression > the fingerprint changes when the month does, so a breach persisting into the next month is reported again 0ms
✓ lib/domain/breachAlert.test.ts > the fingerprint, and duplicate suppression > the coverage message and the breach message never share a fingerprint for the same month 0ms
✓ lib/domain/breachAlert.test.ts > the fingerprint, and duplicate suppression > a message whose fingerprint was already delivered is suppressed 0ms
✓ lib/domain/breachAlert.test.ts > the fingerprint, and duplicate suppression > a message whose fingerprint was recorded as undelivered is sent again, because a failed send must never silence the retry 0ms
✓ lib/domain/breachAlert.test.ts > the fingerprint, and duplicate suppression > a message whose fingerprint has never been recorded is sent 0ms

Test Files  1 passed (1)
Tests  23 passed (23)
Start at  08:00:55
Duration  108ms (transform 22ms, setup 0ms, import 31ms, tests 11ms, environment 0ms)

```

### 12.2 `lib/mailConfig.test.ts` — 10 passed

```
RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app

✓ lib/mailConfig.test.ts > smtpSettings — TLS is mandatory, and a bad configuration is a stated failure > port 465 is accepted as implicit TLS 1ms
✓ lib/mailConfig.test.ts > smtpSettings — TLS is mandatory, and a bad configuration is a stated failure > port 587 is accepted only with STARTTLS required 0ms
✓ lib/mailConfig.test.ts > smtpSettings — TLS is mandatory, and a bad configuration is a stated failure > port 25 is rejected, because plaintext SMTP would put these figures on the wire in clear 0ms
✓ lib/mailConfig.test.ts > smtpSettings — TLS is mandatory, and a bad configuration is a stated failure > a configuration disabling certificate verification is rejected, since an unverified peer is plaintext with extra steps 0ms
✓ lib/mailConfig.test.ts > smtpSettings — TLS is mandatory, and a bad configuration is a stated failure > a missing credential names the key that is missing and never substitutes a default 0ms
✓ lib/mailConfig.test.ts > smtpSettings — TLS is mandatory, and a bad configuration is a stated failure > a rejection message never contains the password it was handed 0ms
✓ lib/mailConfig.test.ts > smtpSettings — TLS is mandatory, and a bad configuration is a stated failure > a recipient that is not an address is rejected rather than handed to the transport 0ms
✓ lib/mailConfig.test.ts > smtpSettings — TLS is mandatory, and a bad configuration is a stated failure > the sender is validated on the same rule as the recipient, since a malformed from has no local symptom at all 0ms
✓ lib/mailConfig.test.ts > the enable flag and the loggable description > sending is disabled unless the enable flag is exactly the string true, so an unset, mistyped or merely truthy value all mean off 0ms
✓ lib/mailConfig.test.ts > the enable flag and the loggable description > the loggable description of a mail configuration carries the host and the port and never the password 0ms

Test Files  1 passed (1)
Tests  10 passed (10)
Start at  08:00:55
Duration  113ms (transform 16ms, setup 0ms, import 22ms, tests 4ms, environment 0ms)

```

### 12.3 The three tripwire suites

```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts   → 47 ✓  (#63 OK)
$ npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts      → 24 ✓  (#64 OK)
$ npx vitest run --pool=threads --reporter=verbose lib/domain/monthOutlook.test.ts → 40 ✓ (#65 OK)

$ npm test
 Test Files  23 passed (23)
      Tests  448 passed (448)
   Start at  08:06:15
   Duration  4.61s (transform 808ms, setup 0ms, import 1.20s, tests 4.54s, environment 2ms)

```

---

## 13. G3 cycle 1 — findings addressed

Two changes, both in `lib/domain/breachAlert.ts` and its test. No other existing test touched, no
control flow changed, `alert_sends` untouched, nothing sent, no credential invented.

### 13.1 N60 — two vacuous acceptance rows. **BLOCK. Fixed.**

**The finding is correct and I had not caught it.** Both assertions were satisfied by the rendered
month alone:

```
$ node -e "…"
the mutant body (count paragraph deleted) still contains '2': true
  because '2026-09'.includes('2') === true
  and it does NOT contain the count clause: true
```

`'2026-09'` contains a `'2'`, so `toContain('2')` passed whether or not the message carried a count
at all. It gated nothing — and it gated nothing on the **coverage** message, which §5 measured as the
only message that will send on the owner's real data today.

**The fix is additive.** The two `toContain('2')` lines are kept, because that is how the spec words
F3 and F4 and I am not quietly narrowing a fixture; the strength comes from assertions beside them
that name a phrase the month cannot supply, and that check the count **moves**:

| Row | Added |
|---|---|
| **#8** (subject) | `toContain('2 saying no')`; a 3-record outlook gives `'3 saying no'` and **not** `'2 saying no'`; a 1-record outlook gives `'1 saying no'` |
| **#11** (coverage body) | `toContain('2 budget lines are currently flagged')`; a 1-record outlook gives `'1 budget line is currently flagged'` and **not** `'budget lines are'` |

**Verified by the mutation that motivated it**, aimed at `coverageMessage` and nowhere else:

```
############ C1 — coverageMessage's ENTIRE count paragraph deleted ############
tsc:   exit=0        ← the mutant is well-formed, so the suite is the only thing judging it
 × … coverage below the threshold withdraws the figures as well as the confidence: …
AssertionError: expected 'Only 7% of the spend recorded so far …' to contain
                '2 budget lines are currently flagged'
      Tests  1 failed | 22 passed (23)
whole repo:  Tests  1 failed | 447 passed (448)      ← was 448 passed before the fix

############ C2 — the count removed from the BREACH subject ############
 × … the subject line carries the count and the month and never a dollar amount, …
AssertionError: expected 'Budget guardrail — saying no in 2026-…' to contain '2 saying no'
      Tests  1 failed | 22 passed (23)
```

Restored, `cmp -s` → `IDENTICAL`. `tsc exit=0` on the C1 mutant matters: the mutant compiles, so the
red is the hypothesis and not an unused binding.

The suite is 22 → 23 tests. #5 (`-ge 22`) still `OK`; both gated test **names** are unchanged, so #8
and #11 still read `1`.

### 13.2 N61 — a docblock that over-promised. **Fixed, comment only.**

`finite()` claimed a refusal would "let the shell record the attempt as failed". **It does not**, and
the review is right about the mechanism: `planAlert` runs above `attempt()`, so the `RangeError`
unwinds to `runBreachAlert`'s outer catch, is logged, and **no `alert_sends` row is written**. For
that one cause the table cannot separate "the job refused to render" from "the job never ran" — which
is precisely the distinction Q5 exists to preserve. The log keeps it; the table does not.

**Asked whether the control flow is the right fix instead: no, and not because it is out of cycle.**
Moving the call cannot record it either. `alert_sends.fingerprint` is `NOT NULL`, and a message that
could not be rendered *has no fingerprint* — there is nothing to key a row on. This is exactly the
case `CONTRACT.md`'s implementer note 4 already ruled on for a configuration failure, and its ruling
transfers unchanged: *what the schema refuses is a placeholder fingerprint invented to make the row
insertable*. Recording this outcome would need a nullable fingerprint — a contract change, against a
frozen surface, for a failure mode that is already fully captured in the log. So the comment is
corrected to state the gap, name why it is not closable here, and stop promising a row.

Control flow verified unchanged: `planAlert` at `lib/breachAlert.ts:82`, `shouldSend` at `:100`,
`attempt` at `:105` — the order this task shipped.

### 13.3 Nits accepted with no action

N59 (the coverage fingerprint keys on a set that message never names — spec-conformant; costs noise,
not truth; invisible on the owner's data today) and N62–N66.

### 13.4 State after the fixes

```
tsc:      exit=0
suite:    Tests 448 passed (448)          ← 23 + 10 in the new suites; tripwires still 47 / 24 / 40
lint:     ✖ 1 problem (0 errors, 1 warning)
gitleaks: no leaks found
build:    exit=0
.next dupes: 0
scope:    M lib/domain/monthOutlook.test.ts     ← still the only out-of-allowlist path (§3)
```

All 79 rows read as they did in §7, with #66/#69/#78/#79 still off-spec for the single reason in §3
and #1 still environment-dependent per §10.1. No row changed status as a result of this cycle.
