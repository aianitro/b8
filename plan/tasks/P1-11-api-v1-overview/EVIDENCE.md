# EVIDENCE — P1-11-api-v1-overview
**Author:** implementer · **HEAD at start:** `46b7dcf`
**Revision 2 (G3 cycle 1 → implementer cycle 1 of 3), 2026-09-12.** Both G3 blocks fixed, both
verified by measurement; one nit fixed; two items recorded rather than fixed. See §15.
**Revision 3 (G3 cycle 2 → implementer cycle 2 of 3), 2026-09-13.** One block fixed — a second
divergence from `pg` in the same expression — plus a third divergence I found myself while auditing
the rest of the function, and two nits. See §16.
**Revision 4 (G3 ACCEPT_WITH_NITS), 2026-09-13.** Three closing nits fixed and two overclaims in
this document corrected. See §17. **§16.3's "zero remain" was wrong when written** — it was scoped to
one file and stated as if repo-wide; two weak matchers survived in the other. Corrected in place.

**Headline, revision 2: all 44 acceptance commands pass.** Nothing is partial, skipped or red.

At revision 1, #44 returned `5` — five environment-duplicated files under `shared/contracts/`, which
the `PreToolUse` scope guard correctly refused to let me delete. They were removed between cycles by
someone holding that surface, and #44 is now `0`. §7 is kept as written, because it is the record of
an escalation that worked and of the eighth occurrence of a fault that has now broken a gate.

---

## 1. Files shipped

| File | Lines | Role |
|---|---|---|
| `lib/overviewRead.ts` | 809 | composition + wire-formatting + the six ad hoc reads + the relocated `Assert<Equals<…>>` block |
| `lib/overviewRead.test.ts` | 480 | fixtures **F1–F8** plus two extra (the cross-field invariants, the positional-twelve rule) |
| `lib/testDbGuard.ts` | 105 | `assertScratchDatabase`, `databaseNameFromUrl`, `REAL_DATABASE_NAME` |
| `lib/testDbGuard.test.ts` | 58 | the guard's parsing edges and the "unreadable is refused" judgement |
| `lib/testDbGuard.setup.ts` | 24 | the integration suite's `setupFiles` entry — see §4 on why it exists and why it is in scope |
| `app/api/v1/overview/route.ts` | 29 | the thin HTTP wrapper |
| `app/api/v1/overview/route.test.ts` | 347 | fixtures **I1–I10**, database-backed |
| `vitest.integration.config.mts` | 43 | the DB-requiring config |

`shared/contracts/overview.ts` is the guardian's, untouched by me.

---

## 2. Verbatim ⟨P⟩ output — the pure suite

```
$ npx vitest run --reporter=verbose lib/overviewRead.test.ts 2>&1

 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app

 ✓ lib/overviewRead.test.ts > the composed overview payload, on the wire > every money field in a composed payload serializes as a two-decimal-place decimal string 9ms
 ✓ lib/overviewRead.test.ts > the composed overview payload, on the wire > a projected figure carrying float drift beyond two decimals is rounded to the cent once, at the wire boundary 0ms
 ✓ lib/overviewRead.test.ts > the composed overview payload, on the wire > a null projection serializes as null, never as the string 0.00 1ms
 ✓ lib/overviewRead.test.ts > the composed overview payload, on the wire > a feedHealth fixture whose lastSuccessfulUpdate is a live Date instance validates against the schema after a JSON round-trip 1ms
 ✓ lib/overviewRead.test.ts > the composed overview payload, on the wire > a negative transaction amount, this ledger's income convention, round-trips as a negative decimal string, unflipped 0ms
 ✓ lib/overviewRead.test.ts > the composed overview payload, on the wire > stats.remaining is computed from the unformatted budget and spent numbers, not from their formatted strings 1ms
 ✓ lib/overviewRead.test.ts > the composed overview payload, on the wire > the payload states one as-of point and one coverage verdict, not two that can disagree 0ms
 ✓ lib/overviewRead.test.ts > the composed overview payload, on the wire > carries twelve positional months in both series, because a short array shifts rather than shortens 1ms
 ✓ lib/overviewRead.test.ts > assertScratchDatabase, the control that keeps a seeding suite off the real database > refuses when DATABASE_URL resolves to b8_finance, the name this repo treats as the real database 1ms
 ✓ lib/overviewRead.test.ts > assertScratchDatabase, the control that keeps a seeding suite off the real database > does not refuse a distinctly named scratch database 0ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  22:41:07
   Duration  945ms (transform 103ms, setup 0ms, import 168ms, tests 15ms, environment 0ms)
```

Fixture → acceptance map: F1 → #18, F2 → #19, F3 → #20, F4 → #21, F5 → #22, F6 → #23, F7 → #24,
F8 → #25. All eight titles are character-for-character SPEC.md's.

**F7 and F8 live in `lib/overviewRead.test.ts`, not in `lib/testDbGuard.test.ts`, and that is
forced rather than chosen.** ⟨P⟩ is defined as running *only* `lib/overviewRead.test.ts`, and #24/#25
grep ⟨P⟩'s output, so a title placed in the guard's own file would never appear. The two directional
proofs therefore sit in a `describe('assertScratchDatabase, …')` block inside the overview test file,
and `lib/testDbGuard.test.ts` (which acceptance #13 requires to exist) holds what those two do not:
the connection-string parsing, the percent-encoded spelling, and the decision to refuse a string the
guard cannot read rather than wave it through.

## 3. Verbatim ⟨I⟩ output — the database suite

```
$ DATABASE_URL=postgresql://localhost/b8_p111_throwaway \
  npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/overview/route.test.ts 2>&1

 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app

 ✓ app/api/v1/overview/route.test.ts > GET /api/v1/overview, against a seeded scratch database > the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio 10ms
 ✓ app/api/v1/overview/route.test.ts > GET /api/v1/overview, against a seeded scratch database > a hidden transaction dated within the last 36 hours does not appear in recentArrivals 1ms
 ✓ app/api/v1/overview/route.test.ts > GET /api/v1/overview, against a seeded scratch database > a transaction mapped to a capital-landscape category is excluded from stats, monthlySpending and budgetVsActual 0ms
 ✓ app/api/v1/overview/route.test.ts > GET /api/v1/overview, against a seeded scratch database > an exclude_from_budget category is excluded from stats and budgetVsActual though its landscape is operational 0ms
 ✓ app/api/v1/overview/route.test.ts > GET /api/v1/overview, against a seeded scratch database > an uncategorized transaction is excluded from today and week spend but counted in stats.uncategorized 0ms
 ✓ app/api/v1/overview/route.test.ts > GET /api/v1/overview, against a seeded scratch database > a refund nets against its category's spend rather than being ignored or double counted 0ms
 ✓ app/api/v1/overview/route.test.ts > GET /api/v1/overview, against a seeded scratch database > feedHealth reports one finding per Plaid item, not per account, for two accounts sharing a stale item 1ms
 ✓ app/api/v1/overview/route.test.ts > GET /api/v1/overview, against a seeded scratch database > driftFindings reports a seeded ledger/Plaid disagreement on a ledger-mode account and nothing for the same disagreement on a valuation-mode account 1ms
 ✓ app/api/v1/overview/route.test.ts > GET /api/v1/overview, against a seeded scratch database > monthOutlook never contains an OutlookCategory for the capital-landscape category 2ms
 ✓ app/api/v1/overview/route.test.ts > GET /api/v1/overview, against a seeded scratch database > yearEnd is scoped to the operational landscape and does not fold in the capital category's budget 3ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  22:41:09
   Duration  393ms (transform 79ms, setup 19ms, import 120ms, tests 113ms, environment 0ms)
```

I1 → #29, I2 → #30, I3 → #31, I4 → #32, I5 → #33, I6 → #34, I7 → #35, I8 → #36, I9 → #37,
I10 → #38.

## 4. All 44 acceptance commands, result by result

| # | Expected | Observed | |
|---|---|---|---|
| 1 | `exit=0` | `exit=0` | PASS |
| 2 | `1` | `1` — full suite `593 passed (35 files)`, up from `578 (33)`; nothing skipped, no DB | PASS |
| 3 | the one pre-existing warning | `✖ 1 problem (0 errors, 1 warning)` — the same `'pid' is assigned a value but never used` line | PASS |
| 4 | `exit=0` | `exit=0`; route listed as `ƒ /api/v1/overview` (dynamic, server-rendered on demand) | PASS |
| 5 | `exit=0` | `exit=0`, 386 packages | PASS |
| 6 | `OK` | `OK` | PASS |
| 7 | `OK` | `OK` | PASS |
| 8 | `OK` | `OK` | PASS |
| 9 | `OK` | `OK` | PASS |
| 10 | `OK` | `OK` | PASS |
| 11 | `OK` | `OK` | PASS |
| 12 | `OK` | `OK` | PASS |
| 13 | `OK` | `OK` | PASS |
| 14 | `0` | `0` | PASS |
| 15 | `OK` | `OK` (count is `2`) | PASS |
| 16 | `0` | `0` | PASS |
| 17 | `OK` | `OK` (10 `✓`) | PASS |
| 18 | `1` | `1` | PASS |
| 19 | `1` | `1` | PASS |
| 20 | `1` | `1` | PASS |
| 21 | `1` | `1` | PASS |
| 22 | `1` | `1` | PASS |
| 23 | `1` | `1` | PASS |
| 24 | `1` | `1` | PASS |
| 25 | `1` | `1` | PASS |
| 26 | `4` | `4` | PASS |
| 27 | `0` | `0` | PASS |
| 28 | `OK` | `OK` (10 `✓`) | PASS |
| 29 | `1` | `1` | PASS |
| 30 | `1` | `1` | PASS |
| 31 | `1` | `1` | PASS |
| 32 | `1` | `1` | PASS |
| 33 | `1` | `1` | PASS |
| 34 | `1` | `1` | PASS |
| 35 | `1` | `1` | PASS |
| 36 | `1` | `1` | PASS |
| 37 | `1` | `1` | PASS |
| 38 | `1` | `1` | PASS |
| 39 | `OK` | `OK` | PASS |
| 40 | `0` | `0` | PASS |
| 41 | `0` | `0` | PASS |
| 42 | `0` | `0` | PASS |
| 43 | `0` | `0` | PASS |
| 44 | `0` | `0` at revision 2 (**`5`** at revision 1 — see §7) | PASS |

### #39, the live-fire guard check, verbatim

```
$ DATABASE_URL="postgresql://nobody@127.0.0.1:1/b8_finance" npx vitest run \
    --config vitest.integration.config.mts app/api/v1/overview/route.test.ts > /tmp/p111-guard.log 2>&1
$ echo $?
1
$ grep -c b8_finance /tmp/p111-guard.log
1
→ OK
```

`/tmp/p111-guard.log`:

```
 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app

 ❯ app/api/v1/overview/route.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  app/api/v1/overview/route.test.ts [ app/api/v1/overview/route.test.ts ]
Error: Refusing to run the integration suite against the database named "b8_finance". "b8_finance" is what .env.local's DATABASE_URL and docker-compose.yml's db service both resolve to on a machine set up per README.md, and this suite SEEDS rows. Create a scratch database instead: createdb b8_p111_throwaway && DATABASE_URL=postgresql://localhost/b8_p111_throwaway npx node-pg-migrate up
 ❯ assertScratchDatabase lib/testDbGuard.ts:95:11
 ❯ lib/testDbGuard.setup.ts:24:1

 Test Files  1 failed (1)
      Tests  no tests
   Duration  161ms (transform 14ms, setup 0ms, import 0ms, tests 0ms, environment 0ms)
```

**`(0 test)` and `import 0ms` are the part worth reading.** They say the test module was never
loaded, so the chain `route.test.ts → route.ts → lib/overviewRead.ts → lib/db.ts` never ran and **no
`pg.Pool` was ever constructed**. The refusal happened on the string alone, before any client
existed — which is what SPEC.md's convention requires and what an import-presence check could not
have distinguished from a call placed one import too late. The stack frame `testDbGuard.setup.ts:24:1`
is the file's first and only statement.

**Why a separate `lib/testDbGuard.setup.ts` exists.** SPEC.md requires the guard to be "called,
synchronously, as the first statement" of "the integration suite's setup", and Vitest's only hook
that runs inside the worker *before* the test module is imported is `setupFiles`, which takes a file
path. The file is inside acceptance #43/#44's permitted prefix list (`lib/testDbGuard`), it is not
collected by either test config (it is not a `*.test.ts`), and it contains one import and one
statement.

I also tried calling the guard from `vitest.integration.config.mts` itself. It works — the refusal
then fires before a worker is even spawned — but Vite printed a standing deprecation warning for
importing a `.ts` module from a config under the forthcoming native config loader, and it is a second
call site for one rule. Dropped in favour of the single `setupFiles` wiring, which is what SPEC.md
describes and which #39 proves behaviourally.

## 5. The exact seeded fixture

Scratch database **`b8_p111_throwaway`**, emptied at `beforeAll` with
`TRUNCATE transactions, account_valuations, account_balances, budget_categories, accounts RESTART IDENTITY CASCADE`,
so every figure asserted is exact rather than relative. Read back out of the database after the run:

### `accounts` (4 rows)

| id | name | type | landscape | valuation_mode | track | access_token | bank | item_last_successful_update |
|---|---|---|---|---|---|---|---|---|
| `p111_checking` | Fabricated Checking | depository | operational | `ledger` | t | `p111-item-alpha` | Fabricated Bank Alpha | `NOW() - 96 hours` |
| `p111_savings` | Fabricated Savings | depository | operational | `ledger` | t | `p111-item-alpha` | Fabricated Bank Alpha | `NOW() - 96 hours` |
| `p111_ledger_drift` | Fabricated Ledger Card | depository | operational | `ledger` | t | `p111-item-beta` | Fabricated Bank Beta | `NOW()` |
| `p111_valuation_drift` | Fabricated Brokerage | depository | capital | `valuation` | t | `p111-item-beta` | Fabricated Bank Beta | `NOW()` |

`item_last_failed_update` is NULL on all four. **Item alpha is 96 hours stale** (threshold 36) and
carries **two accounts** → exactly one `FeedFinding` with `accountCount: 2` (**I7**, negative control
#6). **Item beta is fresh** → state `ok`, dropped by `feedFindings`, so the feedHealth assertion
stays exact at length 1.

### `budget_categories` (4 rows)

| name | annual_budget | landscape | exclude_from_budget | is_income | control_mode |
|---|---|---|---|---|---|
| `P111 Groceries` | **1200.00** | operational | f | f | discretionary |
| `P111 Excluded Ops` | **2000.00** | operational | **t** | f | discretionary |
| `P111 Remodel` | **50000.00** | **capital** | f | f | discretionary |
| `P111 Salary` | 60000.00 | operational | f | **t** | fixed |

`P111 Remodel` is `discretionary` deliberately: it then satisfies every conjunct of
`isScoredCategory` *except* landscape, so **I9**'s assertion of its absence is asserting the
landscape rule and not the control-mode rule.

### `transactions` (7 rows, all `date = CURRENT_DATE = 2026-09-12`, `created_at = NOW()` by default, all on `p111_checking`)

| plaid_transaction_id | amount | mapped_category | hidden | in 36h window | what it proves |
|---|---|---|---|---|---|
| `p111_txn_grocery` | **120.00** | P111 Groceries | f | t | the baseline spend |
| `p111_txn_refund` | **-20.00** | P111 Groceries | f | t | **I6** — nets to 100.00, not 120.00 (gross) and not 140.00 (double count) |
| `p111_txn_hidden` | **9999.99** | P111 Groceries | **t** | t | **I2**, negative control #1 |
| `p111_txn_capital` | **4000.00** | P111 Remodel | f | t | **I3**, negative control #2 |
| `p111_txn_excluded` | **300.00** | P111 Excluded Ops | f | t | **I4**, negative control #3 |
| `p111_txn_uncat` | **77.00** | **NULL** | f | t | **I5**, negative control #4 |
| `p111_txn_salary` | **-5000.00** | P111 Salary | f | t | income, negative sign unflipped |

### `account_balances` / `account_valuations` — the drift pair

| account_id | beginning_balance (2026) | plaid_balance valuation | finding? |
|---|---|---|---|
| `p111_ledger_drift` | 1000.00 | 1500.00 | **yes** — drift `500.00` |
| `p111_valuation_drift` | 1000.00 | 1500.00 | **no** — `valuation_mode = 'valuation'` |

Identical inputs, one differing column. **I8**, negative control #7.

### The payload figures the seed pins exactly

| field | value | why |
|---|---|---|
| `stats.budget` | `"1200.00"` | the capital 50000, the excluded 2000 and the income 60000 are all out |
| `stats.spent` | `"100.00"` | 120 − 20, net of the refund; capital/excluded/uncategorized/hidden all out |
| `stats.remaining` | `"1100.00"` | computed on the raw numbers, then formatted |
| `stats.uncategorized` | `1` | the unfiled row is excluded from every total and still counted |
| `stats.totalTxns` | `6` | seven rows minus the hidden one |
| `today.spent` / `week.spent` | `"120.00"` | not `"197.00"`, which is what leaks if the unfiled row enters |
| `week.weeklyBudgetReference` | `"23.08"` | 1200/52 = 23.0769…, rounded once at the boundary; 3200/52 = 61.54 if the exclusion leaks |
| `monthlySpending[8].operational` | `"120.00"` | month index 8 = September, 0-based |
| `budgetVsActual` | one row: `P111 Groceries`, `"1200.00"` / `"100.00"` | the other three categories are excluded by landscape, exclusion and is_income respectively |
| `recentArrivals` | 6 rows; contains `"4000.00"`, `"300.00"`, `"77.00"`, `"-20.00"`; never `"9999.99"` | no landscape filter, no exclusion filter, only `hidden = FALSE` |
| `feedHealth` | 1 finding, `Fabricated Bank Alpha`, `accountCount: 2`, `state: "stale"` | one per Plaid item |
| `driftFindings` | 1 finding, `p111_ledger_drift`, `"1000.00"` / `"1500.00"` / `"500.00"`, `safeToDerive: false` | ledger-mode only |
| `yearEnd.expense` | `wireMoney(operational.expense)` — `"400.00"` in September | the operational read. **Asserted relatively, not literally** — it is a projection and shrinks every month; see §15.2 |
| `yearEnd.uncategorized` | `"0.00"` / `"77.00"` / `"-77.00"` | disclosed, counted in nothing above it |

**The one surprising value, recorded rather than smoothed over:** `today.totalCount` is `4`, not `1`.
The page's own third query for "today's largest charges" carries **no category predicate at all** —
`WHERE t.date = CURRENT_DATE AND t.hidden = FALSE AND t.amount > 0` — so it counts the capital,
excluded and uncategorized rows that `today.spent` correctly excludes. That is the running code's
behaviour and this task composes rather than repairs it (SPEC.md non-goal: "No change to how any
figure is computed"). It is named here because `totalCount > transactions.length` is documented in
the contract as normal, while `totalCount` ranging over a *wider population than `spent`* is not,
and a reader comparing the two will otherwise think one of them is wrong. **Candidate for
`P1-11a`'s NITS, not a defect introduced here.**

## 6. The two configs never overlap in file selection

```
$ npx vitest list | sed 's/ > .*//' | sort -u            # the default config
.claude/hooks/scope-guard.test.mts
lib/accountTypes.test.ts … lib/transferValidation.test.ts        (30 files under lib/)
shared/contracts/enums.test.ts … shared/contracts/shapes.test.ts  (5 files)
                                                          → 35 files

$ DATABASE_URL=postgresql://localhost/b8_p111_throwaway \
  npx vitest list --config vitest.integration.config.mts | sed 's/ > .*//' | sort -u
app/api/v1/overview/route.test.ts
                                                          → 1 file
```

The intersection is empty. `npm test` collects 35 files and 593 tests and touches no database (it
runs under the unchanged `vitest.config.mts`, whose `include` this task did not edit — acceptance
#14 → `0`). The integration config collects exactly one file, and acceptance #16 → `0` confirms its
`include` carries neither of the pure config's two directory globs, so the pure suite cannot be
silently re-run under a DB-requiring config and mistaken for having been verified against one.

`lib/overviewRead.test.ts` is in the DB-free set and stays DB-free by `vi.mock('./db', …)`: the
module under test reaches `lib/db.ts` transitively through the four shared readers it calls, and
`lib/db.ts` builds a `pg.Pool` at module scope. The mock's `query` **throws**, so the isolation is
also an assertion — nothing those fixtures exercise may issue SQL.

## 7. The command that failed at revision 1, and why I did not fix it

> **Resolved before revision 2.** `git status --porcelain` is now clean apart from this task's own
> files, the five duplicates are gone, and #44 returns `0`. The section below is the revision-1
> record, left intact: it is the evidence that the escalation was the right call and that this fault
> has now cost a gate.

```
$ git status --porcelain | grep -vE '^.. (shared/contracts/overview\.ts|shared/types\.ts|lib/overviewRead|lib/testDbGuard|app/api/v1/|vitest\.integration\.config\.mts|plan/)'
?? "shared/contracts/enums.test 2.ts"
?? "shared/contracts/envelope.test 2.ts"
?? "shared/contracts/index.test 2.ts"
?? "shared/contracts/representation.test 2.ts"
?? "shared/contracts/shapes.test 2.ts"
→ 5
```

**None of these is mine.** Each is byte-identical (`cmp -s` → equal) to the tracked file whose name
it duplicates with a `" 2"` suffix. This is the environment-duplication fault GATES.md has already
recorded **seven** times in this session — it has previously broken a migration, `tsc`, a
`git fetch`, an `npm ci`, and duplicated a safety mechanism. This is the eighth occurrence, and the
first to break an acceptance command.

I attempted to delete them. The `PreToolUse` scope guard blocked it, correctly:

```
BLOCKED by scope-guard: shell write to the contract surface
  rm -f "shared/contracts/enums.test 2.ts" …
The contract surface has a single writer: contract-guardian, and only while a contract lease is open
```

The contract lease is CLOSED, which is right for G2, so I have no path to remove them and I did not
look for one. **Escalated rather than worked around.** Repair needs either the orchestrator deleting
them directly or a brief lease for contract-guardian. The one sibling artifact outside the contract
surface — `plan/tasks/P1-10-zod-contracts/EVIDENCE 2.md`, which failed the same check only because
`git status` quotes paths containing spaces — I did remove, so that every remaining offender is
unambiguously on the frozen surface.

**They are inert for everything except #44.** Vitest's `shared/**/*.test.ts` glob does not match
`enums.test 2.ts`, so they are not collected (35 files, not 40); `npx tsc --noEmit` is `exit=0`;
`npm run lint` is at the one pre-existing warning; `npm run build` is `exit=0`. Acceptance #43
(tracked files) is `0`.

## 8. Scratch database identity, and the teardown I deliberately did not run

```
$ psql "postgresql://localhost/b8_p111_throwaway" -At \
    -c "select current_database(), inet_server_addr(), inet_server_port(), version();"
b8_p111_throwaway|::1|5432|PostgreSQL 16.14 (Homebrew) on aarch64-apple-darwin25.4.0 …
```

| | value |
|---|---|
| database | **`b8_p111_throwaway`** — not `b8_finance` |
| host | `localhost` (`::1`) |
| port | **5432** |
| server | host Homebrew PostgreSQL 16.14, **not** the `docker-compose.yml` `db` service |
| compose `db` running? | no — `docker ps` fails, the Docker daemon is not running on this machine |

**The port is NOT distinct from the compose service's bound port, and it cannot be made so.**
SPEC.md's Evidence item 3 asks for confirmation that the scratch database is distinct from
`b8_finance` "and from the `docker-compose.yml` `db` service's bound port". The first half holds; the
second cannot, on this machine, for the reason G0-D1 measured in the first place: there is one local
Postgres and it listens on 5432, which is exactly the port `docker-compose.yml` binds
(`127.0.0.1:5432:5432`). README.md's own documented safe pattern — `createdb b8_demo` plus
`postgresql://localhost/b8_demo` — has the identical property. **The port is not the discriminator
and was never going to be; the name is**, which is precisely why SPEC.md required a name-checking
control rather than a port convention. Reported here instead of claimed, since the evidence item as
written is not satisfiable.

**`dropdb b8_p111_throwaway` was NOT run, and that is deliberate.** The orchestrator's dispatch
states the database already exists and is migrated, and acceptance #28–#38 are re-run independently
at G2/G4 — dropping it would make every one of those commands fail for a missing database. The
fixtures are confined to that database and are truncated at the start of each run, so nothing
accumulates. **Owner action after G4:** `dropdb b8_p111_throwaway`.

No write of any kind reached `b8_finance`. Every `DATABASE_URL` used in this task is recorded in this
file, and the only one naming `b8_finance` is acceptance #39's, which is the command that proves the
refusal fires.

## 9. Dependencies

**No dependency change occurred.** `package.json` is byte-identical to `HEAD` (acceptance #43 → `0`
covers it), no npm script was added, and `zod` was already a direct dependency after P1-10:

```
$ npm ls zod --depth=0
app@0.1.0 /Users/andreianpilogov/Documents/b8/app
└── zod@4.6.2
```

Before and after are the same line, so the "before/after" SPEC.md says is not required is stated
explicitly as unchanged rather than omitted.

## 10. The guardian's hand-off, item by item

| # | Handed over | Done |
|---|---|---|
| 1 | the compile-time schema↔type assertions, in `lib/overviewRead.ts`, on **key sets** | **13 exported `Assert<Equals<…>>` aliases** — `AsOf`, `MonthOutlook`, `OutlookCategory`, `ScoredHeadline`, `CategorizationCoverage`, `MonthVariance`, `BreachFinding`, `ChronicUnderspendFinding`, `YearEndRead`, `YearEndRead['uncategorized']`, `MonthPoint`, `FeedFinding`, `DriftFinding`. All exported, so none is an unused-local lint warning (#3 holds) |
| 2 | fixtures are wire values; F4 is the deliberate exception | the F4 fixture builds a live `new Date(…)`, round-trips through `JSON.parse(JSON.stringify(…))`, and parses the result — **and asserts the unconverted object is rejected**, so the conversion is proved load-bearing |
| 3 | normalize `-0` with `withoutNegativeZero`, imported not rewritten | imported from `lib/domain/adherence.ts`. **Applied after the rounding, not before** — see below |
| 4 | `stats.remaining` from the raw numbers | F6, with operands chosen so the two orders of operations disagree |
| 5 | the two cross-field invariants | a ninth fixture: `asOf` deep-equals `monthOutlook.asOf`, and the three coverage fields match their copies on `coverage` |
| 6 | import relatively from `lib/` | `'../shared/contracts/overview'`, `'../shared/contracts/exact'` |
| 7 | nothing through `shared/contracts/index.ts` | not touched; `overview` is imported directly |

**One correction to item 3, because following it literally would not have worked.** The guardian
wrote that `(-0.004).toFixed(2)` produces `"-0.00"` and that `withoutNegativeZero` is the fix. It is
— but only on the far side of the rounding. `withoutNegativeZero(-0.004)` returns `-0.004`, because
`-0.004 !== 0`, so normalizing the *input* changes nothing and `.toFixed(2)` still prints
`"-0.00"`. The `-0` does not exist until the value is rounded. `wireMoney` therefore reads
`withoutNegativeZero(Math.round(value * 100) / 100).toFixed(2)`, and F2 asserts
`wireMoney(-0.004) === '0.00'` together with `Object.is(Number(…), 0)`. Same helper, same rule, one
step later.

## 11. The four shared readers — reuse, and the limit of the check that proves it

Acceptance #26 returns `4`. Stated precisely, because the Expected column's wording is wider than
the script: **the script walks the files in `app/api/v1/overview/` and reads their own import
specifiers. It does not follow the module graph.** The four specifiers it finds are in
`route.test.ts`, which imports `@/lib/drift`, `@/lib/feedHealthRead`, `@/lib/monthOutlookRead` and
`@/lib/yearEndRead`. `route.ts` itself imports only `@/lib/overviewRead`, because SPEC.md makes it
the thin HTTP wrapper and puts the composition under `lib/`; the four readers are called from
`lib/overviewRead.ts`, one module deeper, which is the real graph.

So #26 as written could be satisfied by a test file's imports even over a handler that re-derived
every figure. **The control that actually closes the hazard is in the fixtures, and it is the one
BUILD.md §14's worked example asks for — agreement, not plausibility:**

* **I7** asserts `payload.feedHealth[0]` matches `await loadFeedHealth()` field for field, including
  that the reader hands back a `Date` where the wire carries its ISO string.
* **I8** asserts `payload.driftFindings.map(accountId)` equals `(await findBalanceDrift()).map(…)`
  and that the drift figure equals `wireMoney(direct[0].drift)`.
* **I9** asserts the outlook's `state`, `scoredCategoryCount`, the sorted union of all four
  partitions' category names, and `coverage.scoredSpend` all match `await loadMonthOutlook(asOf)`.
* **I10** asserts all four `yearEnd` scalars equal `wireMoney(await loadYearEnd('operational', asOf))`
  — and that `loadYearEnd('capital', asOf).expense` (16666.67, driven by the 50000.00 allocation) is
  *not* what the payload carries.

A handler that recomputed any of those would fail these four and pass everything else, which is the
property the reuse requirement is actually for. Flagged as a measurement limit of the command rather
than as a spec defect that blocks: the command is non-vacuous (it returned `0` before this diff) and
the stronger check ships alongside it.

**The six ad hoc reads are carried over, predicates unchanged**, because a route handler cannot
import a page's private function — the same constraint that created `lib/monthOutlookRead.ts`. They
are a temporary second copy by construction; `P1-11a` deletes the page's. Their SQL comments came
with them, since each records which figure was wrong before the predicate and by how much.

## 12. Judgements I made that SPEC.md left to implementation

| Decision | Taken | Why not the alternative |
|---|---|---|
| where the pure fixtures get their DB isolation | `vi.mock('./db')` with a **throwing** `query` | setting a dummy `DATABASE_URL` would construct a real `pg.Pool` in the pure suite and would silently aim it at a developer's exported value |
| the money rule's three disputed places | formatted as money strings — `coverage.{scoredSpend,unattributedSpend,orphanedSpend}`, `headline.{budgeted,actual,variance}` and the same three on every finding plus `months[].*`, and `yearEnd.monthly[].net` | the guardian resolved toward SPEC.md's governing sentence and against its parenthetical list (GATES.md names this as the third of three findings it left for the reviewer); the schema already requires `moneyString` there, so the list was not a live option |
| rounding mechanism | `roundCents` from `lib/budgetMath.ts`, then `.toFixed(2)` | `.toFixed(2)` alone delegates the cent to binary floating-point behaviour and cannot be normalized for `-0`; the explicit round is the one rounding and `toFixed` is padding. **Revision 2:** the G2 version respelled `Math.round(v * 100) / 100` inline, which is `roundCents`'s byte-identical body — two copies of one rounding rule. Imported now, per G3 |
| `export const dynamic` on the route | **not set** | no existing route under `app/api/` sets it, this build has no Cache Components, and `npm run build` already lists the route as `ƒ` (dynamic). Adding it would be a divergence from the 27 handlers beside it |
| response validation inside the handler | **not done** | SPEC.md's non-goals leave it to implementation and warn that a schema one additive change behind `lib/domain/**` would turn a harmless change into a 500. The contract is enforced by I1 instead |
| `fileParallelism: false` in the integration config | set | one scratch database is shared mutable state; a second test file added later would otherwise overwrite this one's fixtures mid-run |

## 13. Residual risks, recorded not waived

1. **The guard is still a denylist of one name.** GATES.md assigned G2 two things here, and both are
   discharged: the message **does** name the offending database (§4's log, and a fixture asserts the
   exact sentence), and the denylist question is put to the reviewer rather than decided by me. I did
   **not** widen it to a pattern: `b8_finance_backup` passes, and a fixture asserts that it does, so
   the edge is visible in the suite instead of being discovered. Widening is a judgement about what
   counts as production, which is the owner's, not the implementer's.
2. **The suite reads the clock, and as of revision 2 no assertion hard-codes a month.**
   **The G2 version of this paragraph claimed "there is no hard-coded month" and was wrong** — two
   I10 assertions did, and G3 caught it. Corrected: see §15.2. What remains is structural rather
   than literal. The seed dates every transaction `CURRENT_DATE`; every index into a
   twelve-element array is `asOf.month`, read from the same clock the endpoint reads; and the one
   remaining exposure is a run that straddles midnight *between* the `beforeAll` insert and the
   `fetchOverview()` two statements later, which would put the seeded rows in one day and the
   payload's `asOf` in the next. The window is milliseconds and the payload is fetched once.
3. **`today.totalCount` ranges over a wider population than `today.spent`** — §5. Pre-existing,
   unchanged by this task, and worth `P1-11a` knowing.
4. **`npm ci` was run twice** (once by hand, once inside the acceptance runner) and succeeded both
   times, `exit=0`, 386 packages. Given GATES.md's seventh recurrence was an `ENOTEMPTY` during
   exactly this command, it is stated that it did not need the tree repaired first this time.

## 14. Nothing outside the declared surface was touched

`app/dashboard/` → `0` (#40). `lib/domain/` → `0` (#27). `migrations/` and `db/schema.sql` → `0`
(#41). `.github/workflows/ci.yml` → `0` (#42). `vitest.config.mts` → `0` (#14). `package.json`,
`shared/types.ts` and every file under `shared/contracts/` other than the guardian's own new one →
untouched. Tracked-file scope (#43) → `0`.

No palette or UI surface was touched at all — this task ships no rendering, so the `slate-*`
accounts palette and the `uiux-promax` tokens never came into conflict here.

---

# 15. Revision 2 — the G3 cycle

Both blocks were reproduced here before being fixed, and both fixes were proved load-bearing by
removing them and watching a fixture go red. Nothing else in the diff changed.

## 15.1 BLOCK 1 — the guard read the wrong field for a scheme `pg` supports

**Reproduced.** Through `pg`'s own parser, parsing only, no connection:

```
$ node -e 'const {parse}=require("pg-connection-string"); …'
{"c":"socket:/var/run/postgresql?db=b8_finance","pg_db":"b8_finance","pg_host":"/var/run/postgresql","url_protocol":"socket:","url_path":"/var/run/postgresql"}
{"c":"socket:?db=b8_finance",                   "pg_db":"b8_finance","pg_host":"",                   "url_protocol":"socket:","url_path":""}
```

`pg-connection-string/index.js:47-52` returns early for `protocol == 'socket:'` and takes
`database` from `searchParams.get('db')`. The G2 guard took it from the path, so it reported
`var/run/postgresql`, found that was not the real database, and **returned normally** — the one
outcome its own docblock forbids, since "I cannot tell which database this is" and "this is a safe
database" are different answers.

**Fixed** in `lib/testDbGuard.ts` with one conjunct, placed before anything is read out of the URL:

```ts
const READABLE_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
…
if (!READABLE_PROTOCOLS.has(parsed.protocol)) return null;
```

`new URL` lower-cases the scheme, so `PostgreSQL://` and `POSTGRES://` are covered without a second
comparison; a fixture pins that.

**Proved load-bearing.** With the single line commented out:

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected [Function] to throw an error
AssertionError: expected [Function] to throw an error
AssertionError: expected 'var/run/postgresql' to be null
      Tests  3 failed | 13 passed (16)
```

The third message is the reviewer's measured wrong answer, verbatim, coming out of my own suite.
Restored → `16 passed (16)`.

**Refused, not special-cased.** `socket:` is declined rather than handled by reading `db`. Refusal is
the direction the function's contract allows, and it avoids a second connection-string parser here
that would have to stay in agreement with `pg`'s. The cost — a `socket:` URL is refused even with a
safe name — is pinned by a fixture in both directions so it is visible rather than surprising, and it
is nil in practice because the suite is run with the URL form README.md documents.

**I did not import `pg-connection-string` and read `.database`,** which would have made the guard read
literally the same field `pg` reads. It is a *transitive* dependency of `pg`, not a declared one, and
`package.json` is outside this task's surface — so the control would depend on a package nothing in
this repo has agreed to. Recorded as the stronger fix a future task could take if that dependency is
ever declared.

### The other schemes, answered as you asked

I enumerated what `new URL` accepts and compared each against what `pg` would do with it:

| string | `pg` reads | G2 guard read | now |
|---|---|---|---|
| `socket:/var/run/postgresql?db=b8_finance` | `b8_finance` (query param) | `var/run/postgresql` — **wrong and confident** | refused |
| `socket:?db=b8_finance` | `b8_finance` | `null` (empty path) → refused | refused |
| `http://localhost/b8_finance` | `b8_finance` (path) | `b8_finance` → correctly refused | refused on scheme |
| `file:///b8_finance` | `b8_finance` (path) | `b8_finance` → correctly refused | refused on scheme |
| `/var/run/postgresql b8_finance` | `b8_finance` (space-split, `index.js:9-13`) | `new URL` throws → refused | refused |
| `b8_finance` (relative) | `b8_finance` — `pg` resolves against `postgres://base` (`index.js:27`) | `new URL` throws → refused | refused |
| `postgresql://localhost/x?database=b8_finance` | `x` — the path **overwrites** the query param (`index.js:66-67`) | `x` | `x` |
| `postgresql://localhost/?database=b8_finance` | `null` | `null` → refused | refused |

`http:` and `file:` were already answered correctly by accident — `pg` reads the path for them too —
and are now refused on principle instead: a scheme this app never writes is not one this guard
should be the first thing to start interpreting. Every row is pinned by a fixture.

**One further divergence found while reading the source and fixed in passing.** `pg` applies
`decodeURI` to the path; the G2 guard applied `decodeURIComponent`. They agree on `%5F` → `_` (the
case already under test) and disagree on `%2F`. Switched to `decodeURI`, wrapped in a `try` that
refuses a malformed escape sequence rather than throwing an unrelated `URIError` out of the setup.

## 15.2 BLOCK 2 — two I10 assertions expired in October

**Reproduced by arithmetic and then by measurement.** `projectSide` sums planned months from
`asOf.month + 1` through December, so the operational projection is `100 × (12 − asOf.month)`.
`expect(payload.yearEnd.expense).toBe('400.00')` and `expect(capital.expense).toBeGreaterThan(16000)`
both held only because `new Date().getMonth()` is `8` today.

**Fixed** by replacing both with the bounds the *seed* pins rather than the ones today's calendar
produces:

```ts
expect(operational.expense).toBeLessThanOrEqual(1200);          // the whole operational allocation
expect(payload.yearEnd.expense).toBe(wireMoney(operational.expense));
expect(capital.expense).toBeGreaterThan(operational.expense * 10);
expect(capital.expense).toBeGreaterThan(1200);
```

The two projections shrink by the same `(12 − asOf.month)` factor, so their **ratio** is the
constant — 50000/1200 ≈ 41.7 — and the capital figure still exceeds the operational book's entire
annual allocation in December, when it is smallest.

**Measured for all twelve month indices** against the live seed, by handing `loadYearEnd` each month
in turn:

```
month= 0 op.expense=  1200.0000 cap.expense=  50000.0000 assertionsHold=true
month= 1 op.expense=  1100.0000 cap.expense=  45833.3333 assertionsHold=true
month= 2 op.expense=  1000.0000 cap.expense=  41666.6667 assertionsHold=true
month= 3 op.expense=   900.0000 cap.expense=  37500.0000 assertionsHold=true
month= 4 op.expense=   800.0000 cap.expense=  33333.3333 assertionsHold=true
month= 5 op.expense=   700.0000 cap.expense=  29166.6667 assertionsHold=true
month= 6 op.expense=   600.0000 cap.expense=  25000.0000 assertionsHold=true
month= 7 op.expense=   500.0000 cap.expense=  20833.3333 assertionsHold=true
month= 8 op.expense=   400.0000 cap.expense=  16666.6667 assertionsHold=true
month= 9 op.expense=   400.0000 cap.expense=  16500.0000 assertionsHold=true
month=10 op.expense=   300.0000 cap.expense=  12333.3333 assertionsHold=true
month=11 op.expense=   200.0000 cap.expense=   8166.6667 assertionsHold=true
```

`400.00` at month 8 and `300.00` at month 10 confirm the reviewer's arithmetic exactly. (From month 9
the seeded September row moves into the settled half, which is why 9 and 11 sit slightly off the
clean `100 × (12 − month)` line — the bounds hold at every one of the twelve either way.) The probe
file was deleted after the run; it is not part of the diff.

EVIDENCE.md §13.2's claim that "there is no hard-coded month" was **false when written** and is
corrected in place rather than quietly deleted.

## 15.3 Nit fixed — `wireMoney` no longer respells `roundCents`

`Math.round(value * 100) / 100` is the byte-identical body of `lib/budgetMath.ts:10`, which eight
modules already import. `wireMoney` now reads
`withoutNegativeZero(roundCents(value)).toFixed(2)`. Same argument CONTRACT.md made about
`withoutNegativeZero`, which I had followed — I should have applied it to both halves of the
expression the first time. F2 still asserts `wireMoney(-0.004) === '0.00'`, `wireMoney(7.006) ===
'7.01'` and `wireMoney(-7.006) === '-7.01'`, so the behaviour is pinned across the substitution.

## 15.4 Recorded, not fixed — the frozen spec contradicts the running code on `monthlySpending`

**This is SPEC.md Evidence item 6's report, which the G2 revision owed and did not give.**

SPEC.md's "Landscape + exclusions, stated per section" table puts `monthlySpending` on the same row
as `stats.budget`/`.spent` and `budgetVsActual`, and that row's `is_income` column reads
**`FALSE` only**. The running `getMonthlySpending` in `app/dashboard/page.tsx:263-277` has **no
`is_income` predicate at all**; its only category filters are
`bc.exclude_from_budget = FALSE AND bc.landscape = 'operational'`. I followed the running code.

**Following the table would have been wrong, and the seed shows why in one figure.**
`monthlySpending` has two halves: `operational` is `SUM(amount) FILTER (WHERE amount > 0)` and
`received` is `ABS(SUM(amount) FILTER (WHERE amount < 0))` — money out and money in, off the same
rows. Income categories carry only negative amounts, so an `is_income = FALSE` filter cannot change
`operational` at all; it can only **empty `received`**. Against this seed, `P111 Salary`'s −5000.00
is 5000.00 of the 5020.00 that `received` reports for September. Adding the predicate would have
dropped the salary out of the income bars, made `received` read 20.00, and put the endpoint in
disagreement with the dashboard chart it exists to feed — while every other section still agreed, so
nothing would have announced it.

The table's row is right about the two figures it shares that row with (`stats` and `budgetVsActual`
really are income-filtered, because they are *budget* totals and an income category's
`annual_budget` would otherwise be counted as something planned to be spent). `monthlySpending` is
not a budget total; it is a two-sided flow chart, and it was grouped with them in the table because
the other three flags happen to match.

**Not a blocking spec defect** — the spec's governing sentence is that this endpoint "applies the
identical filter predicates those six functions already apply… quoted from the running file", and
SPEC.md's own §31 names "behaves identically to code that already exists" as a correctness
requirement. The table and that sentence disagree, and the sentence is the one that says which wins.
Recorded for the reviewer and for `P1-11a`: **the table's `monthlySpending` row needs its `is_income`
cell corrected to "not filtered" when the spec is next amended**, because the next person to read it
without reading the query will add the predicate.

## 15.5 The reviewer's other three nits, acknowledged and left alone

Not fixed, because you scoped this cycle to the two blocks plus the two named items, and each of
these is a change I should not make unilaterally:

- **Acceptance #16 cannot measure disjointness.** `grep -c "lib/\*\*|shared/\*\*"` → `0` is also
  satisfied by `include: ['**/*.test.ts']`. The shipped config *is* disjoint and §6 proves it by
  collection rather than by grep — `npx vitest list` on each config, 35 files against 1, empty
  intersection. The command is in a frozen spec and is not mine to rewrite.
- **`monthRead.allPaces` is dropped.** It matches the frozen payload table, which omits it too. The
  endpoint therefore does not yet carry everything the dashboard fetches, and `P1-11a` needs a
  twelfth section plus a contract amendment. Adding it here would be an unapproved contract change.
- **Orphaned promises on the error path.** `findBalanceDrift()` and `loadFeedHealth()` are started
  before the `Promise.all` and awaited after it, exactly as the page does it; if the `Promise.all`
  rejects, the two remain unhandled. Inherited structure, and changing it is a behaviour change to
  the error path of a route with no `try`/`catch`, which is a design decision rather than a cleanup.

## 15.6 All 44 re-run after the fixes

**All 44 pass.** Unchanged from revision 1 except where noted — and #44, which was revision 1's one
failure, now returns `0`: the five environment-duplicated files under the frozen contract surface
that §7 reports were removed between cycles by someone holding that surface. I did not touch them.

```
$ git status --porcelain
?? app/api/v1/
?? lib/overviewRead.test.ts
?? lib/overviewRead.ts
?? lib/testDbGuard.setup.ts
?? lib/testDbGuard.test.ts
?? lib/testDbGuard.ts
?? plan/tasks/P1-11-api-v1-overview/
?? shared/contracts/overview.ts
?? vitest.integration.config.mts
$ find . -path ./node_modules -prune -o -path ./.next -prune -o -name "* 2.*" -print
(no output)
```

| | revision 1 | revision 2 |
|---|---|---|
| #2 — pure suite | `1` (`593 passed`, 35 files) | `1` (**`594 passed`**, 35 files — one new guard fixture) |
| **#44** | `5` | **`0`** — the five duplicates were removed between cycles by a holder of the contract surface |
| #17 / #28 | `OK` / `OK` | `OK` / `OK` |
| #18–#25, #29–#38 | `1` each | `1` each |
| #39 | `OK` | `OK` |
| #1, #3–#16, #26, #27, #40–#43 | as tabled in §4 | unchanged |

The per-command table in §4 is otherwise accurate as written; the verbatim ⟨P⟩ block in §2 now
reports `10 passed` from an 11-fixture file only because the new scheme fixture lives in
`lib/testDbGuard.test.ts`, which ⟨P⟩ does not collect. The ⟨I⟩ block in §3 is unchanged at
`10 passed (10)`.

## 15.7 `lib/testDbGuard.test.ts`, verbatim at revision 2

Not reached by ⟨P⟩ (which collects only `lib/overviewRead.test.ts`) and therefore not covered by any
of the eighteen title greps, so it is recorded here in full. The second fixture is BLOCK 1's.

```
$ npx vitest run --reporter=verbose lib/testDbGuard.test.ts 2>&1

 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app

 ✓ lib/testDbGuard.test.ts > databaseNameFromUrl > reads the database out of every connection-string form this repo writes 1ms
 ✓ lib/testDbGuard.test.ts > databaseNameFromUrl > refuses to read a socket: URL in either direction, because pg takes its database from the query string 1ms
 ✓ lib/testDbGuard.test.ts > databaseNameFromUrl > returns null rather than guessing when there is no database name to read 0ms
 ✓ lib/testDbGuard.test.ts > assertScratchDatabase, beyond the two directional proofs > returns the database name it approved, so a caller can say where the fixtures landed 0ms
 ✓ lib/testDbGuard.test.ts > assertScratchDatabase, beyond the two directional proofs > refuses a percent-encoded spelling of the real database, which a plain string compare would pass 0ms
 ✓ lib/testDbGuard.test.ts > assertScratchDatabase, beyond the two directional proofs > names the scratch pattern in every refusal, so the message is actionable and not only correct 0ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
```

F7 and F8 inside `lib/overviewRead.test.ts` also gained `socket:` coverage — F7 the refusal of
`socket:…?db=b8_finance` in both the path-bearing and pathless forms, F8 the stated cost of the
conjunct (`socket:` refused even with a safe name). Both titles are unchanged, so #24 and #25 still
return `1`.

## 15.8 Final file inventory at revision 2

| File | revision 1 | revision 2 |
|---|---|---|
| `lib/overviewRead.ts` | 809 | 814 |
| `lib/overviewRead.test.ts` | 480 | 493 |
| `lib/testDbGuard.ts` | 105 | 159 |
| `lib/testDbGuard.test.ts` | 58 | 98 |
| `lib/testDbGuard.setup.ts` | 24 | 24 |
| `app/api/v1/overview/route.ts` | 29 | 29 |
| `app/api/v1/overview/route.test.ts` | 347 | 357 |
| `vitest.integration.config.mts` | 43 | 43 |

Five files changed, three untouched. No new file, no deleted file, no dependency change, and nothing
outside the declared surface: #27, #40, #41, #42, #43 and #44 are all `0`, and #14 is `0`.

---

# 16. Revision 3 — the G3 cycle 2

## 16.1 BLOCK — the opaque path. Closure chosen: REFUSE

**Reproduced** before changing anything. `pg-connection-string/index.js:66` reads the database with
`result.pathname.slice(1)`, dropping the first character unconditionally; `lib/testDbGuard.ts:101`
read it with `.replace(/^\//, '')`, dropping it only when it is a slash:

```
{"c":"postgresql:_b8_finance",        "url_path":"_b8_finance",        "guard_regex":"_b8_finance",        "guard_slice":"b8_finance",        "pg_db":"b8_finance"}
{"c":"postgresql:b8_finance",         "url_path":"b8_finance",         "guard_regex":"b8_finance",         "guard_slice":"8_finance",         "pg_db":"8_finance"}
{"c":"postgresql:_b8_p111_throwaway", "url_path":"_b8_p111_throwaway", "guard_regex":"_b8_p111_throwaway", "guard_slice":"b8_p111_throwaway", "pg_db":"b8_p111_throwaway"}
{"c":"postgresql://localhost/b8_finance","url_path":"/b8_finance",     "guard_regex":"b8_finance",         "guard_slice":"b8_finance",        "pg_db":"b8_finance"}
```

Line 1 is the hole, confirming your measurement: the guard reads `_b8_finance`, finds it unequal,
approves; `pg` reads `b8_finance` with the host falling through to localhost. Line 4 shows why it
was invisible — every form anyone actually writes agrees.

### I chose REFUSE — `if (!parsed.pathname.startsWith('/')) return null;`

Stated plainly, since you asked me to choose and say why:

1. **`pg`'s `.slice(1)` is a latent defect on its side, not a specification.** It reads
   `postgresql:b8_finance` as the database `8_finance`. Copying an expression to stay in agreement
   makes this control's correctness depend on that defect *persisting*.
2. **Copying it re-arms the exact failure I have now been caught on twice.** The day
   `pg-connection-string` makes its slice slash-aware, a copied `.slice(1)` diverges again — and in
   the **unsafe** direction this time: fixed-`pg` would read `b8_finance` from
   `postgresql:b8_finance` where the copy still reads `8_finance`, the guard would approve, and the
   hole reopens silently. Refusal cannot be desynchronised by an upstream change, because it
   declines to read the field at all.
3. **It is what the function's own contract says.** Lines 92-93: it may return a name or `null` and
   may not return a guess. And the docblock has claimed the `//authority` form as its scope since it
   was written.
4. **The cost is nil.** No opaque form is written by README.md, `.env.local`, `docker-compose.yml`,
   the acceptance commands, or this suite.

**The disagreement between the two closures is pinned**, as you asked. `postgresql:_b8_p111_throwaway`
would be *approved as `b8_p111_throwaway`* under "agree" and is **refused** here, asserted in both
`lib/testDbGuard.test.ts` and F8.

**Proved load-bearing** by deleting the conjunct:

```
--- removed: if (!parsed.pathname.startsWith('/')) return null;
AssertionError: expected [Function] to throw error matching /cannot prove/ but got 'Refusing to run the integration suite…'
AssertionError: expected [Function] to throw an error
AssertionError: expected 'b8_finance' to be null
      Tests  3 failed | 15 passed (18)
```

The first line is worth reading: with the conjunct gone the guard falls back to `.slice(1)` and
refuses `postgresql:_b8_finance` on the *"Refusing"* branch instead of the *"cannot prove"* branch.
That is the two closures visibly disagreeing inside a failure message — and it is only visible
because of the discriminating matchers from nit 1 below. Restored → `18 passed (18)`.

## 16.2 A third divergence, found by audit rather than by review

You asked whether any other expression reads a field `pg` reads differently. I enumerated every
remaining one and ran the whole corpus through both parsers. **One more diverged.**

`index.js:56-59`: when `config.host` is set from a `host=` **query parameter** *and* the URL's
hostname is a percent-encoded socket path, `pg` **prepends the hostname to the pathname** before
slicing the database out of it.

```
DIFF {"c":"postgresql://%2Fvar%2Frun/b8_finance?host=/tmp","guard":"b8_finance","pg_db":"%2Fvar%2Frun/b8_finance","pg_host":"/tmp"}
```

**It cannot be made dangerous, and I closed it anyway.** The rewritten path always begins `%2f`, so
the slice always begins `2f` and can never equal `b8_finance` — the divergence is strictly
over-refusing. But a wrong answer in a safe direction is still the guess the contract forbids, and
leaving a known one in place after being told twice would be the wrong call.
`if (parsed.searchParams.has('host')) return null;` — load-bearing, proved by deletion
(`1 failed | 17 passed`).

Everything else I checked **agrees**, and is now pinned: spaces in the path (`pg` pre-`encodeURI`s,
WHATWG `URL` percent-encodes — same result), malformed escapes, `@/`-dummy-host, `?host=` on a normal
authority, `..` segments, a doubled slash, a fragment, a multi-segment path, uppercase, and `%00`.

### The shape the function settled into

Rather than patch a third expression, I restated the rule the conjuncts now express, in the
docblock: **it recognises one shape and refuses everything else.** That shape is
`postgres[ql]://<authority>/<database>` with no `host` query parameter — the only shape anything in
this repo writes. For it there is exactly one reading and both parsers produce it, so an *approval*
cannot diverge from what `pg` will connect to. That is a property, not a coincidence, and it is the
answer to "you keep re-deriving `pg`'s parser alongside it."

Verified against the full corpus — **zero fail-open cases**, where fail-open means "guard approves
and `pg` would connect to `b8_finance`":

```
ok {"c":"postgresql:_b8_finance",                        "guard":null,               "pg_db":"b8_finance"}
ok {"c":"postgresql:b8_finance",                         "guard":null,               "pg_db":"8_finance"}
ok {"c":"postgres:_b8_finance",                          "guard":null,               "pg_db":"b8_finance"}
ok {"c":"postgresql:_b8_p111_throwaway",                 "guard":null,               "pg_db":"b8_p111_throwaway"}
ok {"c":"postgresql://%2Fvar%2Frun/b8_finance?host=/tmp","guard":null,               "pg_db":"%2Fvar%2Frun/b8_finance"}
ok {"c":"postgresql://localhost/b8_finance?host=/tmp",   "guard":null,               "pg_db":"b8_finance"}
ok {"c":"postgresql://localhost/b8_finance",             "guard":"b8_finance",       "pg_db":"b8_finance"}
ok {"c":"postgresql://localhost/b8_p111_throwaway",      "guard":"b8_p111_throwaway","pg_db":"b8_p111_throwaway"}
ok {"c":"postgresql:///b8_finance",                      "guard":"b8_finance",       "pg_db":"b8_finance"}
ok {"c":"postgresql://localhost/b8%5Ffinance",           "guard":"b8_finance",       "pg_db":"b8_finance"}
ok {"c":"postgresql://localhost/",                       "guard":null,               "pg_db":null}
ok {"c":"socket:/var/run/postgresql?db=b8_finance",      "guard":null,               "pg_db":"b8_finance"}
holes: 0
```

`pg-connection-string` is still not imported: it is a transitive dependency of `pg` and
`package.json` is outside this task's surface.

## 16.3 Nit — the weak matcher, and why it mattered more than it looked

All three of the guard's messages interpolate `${REAL_DATABASE_NAME}`, so `.toThrow(/b8_finance/)`
was satisfied by any refusal and proved only that *something* threw. Five occurrences in
`lib/overviewRead.test.ts`, all replaced.

> **CORRECTION, revision 4.** The sentence that stood here — "zero remain" — was **false**. The
> sweep was scoped to `lib/overviewRead.test.ts`, which is where the nit had been reported, and I
> wrote the result as though it were repo-wide; `grep -c` in one file is not `grep -rn` across the
> surface. **Two survived in `lib/testDbGuard.test.ts`** and were found by the next review, not by
> me. Fixed in §17.2, where the count is now taken repo-wide. Third stale-or-overstated claim of
> this class in this document (§13.2, §16.4, this) — every one of them a sentence about the state of
> the work rather than about the code, and every one caught by review.

The four real-database cases now match
`/Refusing to run the integration suite against the database named/`, and every unreadable-form case
matches `/cannot prove/`. Two assertions were added to prove the branches are actually
distinguishable, so the matchers are load-bearing rather than merely narrower:

```ts
expect(() => assertScratchDatabase('postgresql://localhost/b8_finance')).not.toThrow(/cannot prove/);
expect(() => assertScratchDatabase('socket:?db=b8_finance')).not.toThrow(/Refusing to run/);
```

This paid for itself inside the same cycle: §16.1's deletion probe is legible *only* because the
matchers discriminate — a `/b8_finance/` matcher would have stayed green while the guard silently
switched branches. Your point about the blind spot is the general one: **the title gate cannot tell a
discriminating assertion from a vacuous one**, which is now the sixth control in this project that
does not measure its own rule.

## 16.4 Nit — the stale comment

`route.test.ts` said "`expense` is 400.00" three lines under the paragraph explaining why that
literal was deleted. Replaced with a statement that survives the calendar, and with the reason those
three `uncategorized` literals legitimately do not move: the uncategorized read is filtered by year
alone, not by `asOf.month`. Second stale-claim of this class after EVIDENCE §13.2 — both were
comments left behind by a fix, and both were found by review rather than by me.

## 16.5 All 44 re-run — all pass

```
1 exit=0   6-13 OK    14 0   15 OK  16 0   17 OK  18-25 1 (each)
2 1        26 4       27 0   28 OK  29-38 1 (each)   39 OK
3 ✖ 1 problem (0 errors, 1 warning)         40 0  41 0  42 0  43 0  44 0
4 exit=0   5 exit=0
```

| | rev 2 | rev 3 |
|---|---|---|
| #2 — pure suite | `594 passed` (35 files) | **`596 passed`** (35 files) — two new guard fixtures |
| ⟨P⟩ / #17 | 10 ✓, `OK` | 10 ✓, `OK` (titles unchanged) |
| ⟨I⟩ / #28 | `10 passed (10)`, `OK` | `10 passed (10)`, `OK` |
| #24 / #25 | `1` / `1` | `1` / `1` |
| #39 | `OK` | `OK` |
| #44 | `0` | `0` |
| everything else | as tabled | unchanged |

`lib/testDbGuard.test.ts` now holds 8 fixtures (`8 passed`), two of them added this cycle. It is not
collected by ⟨P⟩, so none of the eighteen title gates sees it — recorded here for the same reason
§15.7 was.

**Nothing failed. I know of no acceptance command a correct implementation cannot satisfy.**

## 16.6 File inventory at revision 3

| File | rev 2 | rev 3 |
|---|---|---|
| `lib/testDbGuard.ts` | 159 | 215 |
| `lib/testDbGuard.test.ts` | 98 | 147 |
| `lib/overviewRead.test.ts` | 493 | 514 |
| `app/api/v1/overview/route.test.ts` | 357 | 359 |
| `lib/overviewRead.ts` | 814 | 814 |
| `lib/testDbGuard.setup.ts`, `app/api/v1/overview/route.ts`, `vitest.integration.config.mts` | 24 / 29 / 43 | unchanged |

Four files changed, four untouched. No new file, no deleted file, no dependency change. Noted for the
record: the `.claude/.contract-lease` duplicate you quarantined was not mine and I did not touch it;
`.claude/` holds only `.contract-lease.log` now.

---

# 17. Revision 4 — closing the G3 nits

## 17.1 The refusal message now diagnoses the conjunct the operator actually broke

**The measured case, which is the strongest argument for the fix**, because it is not an exotic
string: `postgresql:///b8_p111_throwaway?host=/var/run/postgresql` is **PostgreSQL's own documented
socket URI**, `pg` reads its database correctly off the path, and the guard told whoever typed it
that "only the `postgres://` and `postgresql://` forms are read" — while they were holding a
`postgresql://` form. Correct to refuse, false about why, and pointing at a rule they had not
broken. My own fixture at `:142` names this failure mode — *a guard that stops work without saying
what to do instead is one somebody routes around* — and it could not see this one, because it
asserted only that the message contained the scratch pattern, which all branches do.

**The fix keeps one definition of the conjuncts.** `readDatabaseName` is now the single function and
returns a reading — `{ name }` or `{ name: null, why }` — with `databaseNameFromUrl` as a thin
wrapper over it. The reasons are not re-derived in the caller; the caller interpolates the one the
branch produced. Six branches, six phrases:

```
host=localhost dbname=x     → "…: it is not a URL. …"
socket:/var/run/…?db=…      → "…: its scheme is \"socket:\", and only postgres:// and postgresql:// are read. …"
postgresql:_b8_finance      → "…: its path is opaque — there is no \"/\" after the scheme. …"
postgresql:///db?host=/…    → "…: it carries a \"host=\" query parameter, which pg allows to rewrite the
                                 path the database is read out of. …"
postgresql://localhost/     → "…: it names no database after the host. …"
postgresql://localhost/b8_finance
                            → "Refusing to run the integration suite against the database named \"b8_finance\". …"
(empty)                     → "DATABASE_URL is not set. …"
```

Every one still ends with the actionable line — *"This guard reads one shape —
`postgres[ql]://<host>/<database>`, with no `host=` parameter. Use the form README.md documents:
`DATABASE_URL=postgresql://localhost/b8_p111_throwaway`"* — so the message gained a diagnosis without
losing what it already did right.

**A fixture per branch**, each asserting its own phrase *and* the absence of a neighbour's, so a
regression to one blanket sentence fails here rather than passing everywhere. Proved load-bearing by
reverting the interpolation to the old blanket string:

```
=== PROBE B: revert to one blanket diagnosis for every unreadable form ===
AssertionError: expected [Function] to throw error matching /it is not a URL/ but got 'DATABASE_URL does not name a database…'
      Tests  1 failed | 9 passed (10)
```

The documented socket URI gets its own explicit negative assertion: it must **not** be told that
only `postgresql://` forms are read.

## 17.2 The two weak matchers that survived the sweep

`lib/testDbGuard.test.ts:56` and `:138`, both `.toThrow(/b8_finance/)`, both now `/Refusing to run/`.
Count taken repo-wide this time rather than in one file:

```
$ grep -rn "toThrow(/b8_finance/" lib app shared | wc -l
0
```

**Your proof that `:56` was weak, reproduced against the strengthened matcher** — dropping
`postgres:` from the allowlist:

```
=== PROBE A: drop postgres: from the allowlist ===
AssertionError: expected null to be 'b8_scratch'
AssertionError: expected [Function] to throw error matching /Refusing to run/ but got 'DATABASE_URL does not name a database…'
      Tests  2 failed | 8 passed (10)
```

The second line is the assertion that used to stay green while its neighbour failed. It now fails
with it.

## 17.3 IPv6

```ts
expect(databaseNameFromUrl('postgresql://[::1]:5432/b8_p111_throwaway')).toBe('b8_p111_throwaway');
expect(databaseNameFromUrl('postgresql://[::1]/b8_p111_throwaway')).toBe('b8_p111_throwaway');
expect(assertScratchDatabase('postgresql://[::1]:5432/b8_p111_throwaway')).toBe('b8_p111_throwaway');
expect(() => assertScratchDatabase('postgresql://[::1]:5432/b8_finance')).toThrow(/Refusing to run/);
```

Pinned for the reason you gave: §8 of this document records `inet_server_addr()` returning `::1` for
the scratch database, so the bracket form is **this repo's own host** rather than an exotic shape,
and an over-refusal there would have been found by an operator instead of by a test. The last line
keeps the denylist honest through it — the host is not what the guard reads.

## 17.4 Two corrections to the record, both accepted

**Conjunct 2 is defence-in-depth, not the closure.** §16.1 implied the `startsWith('/')` conjunct is
what stands between an approval and a write. It is not, and the reviewer is right: because the
reader became `.slice(1)` in the same change, deleting the conjunct leaves the opaque form read
*exactly as `pg` reads it* and refused on the name. My own cycle-2 probe output said so and I did not
read it that way — the failure was `expected /cannot prove/ but got 'Refusing to run…'`, i.e. still
refused, on the other branch. **Only conjunct 1, the scheme allowlist, stands between an approval and
a write today.** That is now stated in the code beside conjunct 1, and conjunct 2's comment states
its real and sufficient justification: forward compatibility, so a future slash-aware `.slice` in
`pg` cannot reach this guard's reader at all.

**The "cannot diverge" claim is about the name, not the endpoint.** §16.2 and the docblock claimed an
approval cannot diverge from what `pg` connects to. Proved for the database *name* only — the guard
reads no host and no port. Both now say so:

> THE CLAIM IS ABOUT THE NAME AND NOT THE ENDPOINT, stated exactly as strongly as it is proved. This
> function reads no host and no port, so it cannot and does not say which SERVER the suite will
> reach — two clusters on one machine can both hold a `b8_p111_throwaway`, and a name-checking guard
> approves either. That is the denylist's known shape: it refuses one name, it does not certify a
> destination.

## 17.5 All 44 re-run — all pass

```
1 exit=0   6-13 OK   14 0   15 OK  16 0   17 OK  18-25 1 (each)
2 1        26 4      27 0   28 OK  29-38 1 (each)  39 OK
3 ✖ 1 problem (0 errors, 1 warning)        40 0  41 0  42 0  43 0  44 0
4 exit=0   5 exit=0
```

| | rev 3 | rev 4 |
|---|---|---|
| #2 — pure suite | `596 passed` (35 files) | **`598 passed`** (35 files) — two new guard fixtures |
| `lib/testDbGuard.test.ts` | 8 fixtures | **10 fixtures** |
| ⟨P⟩ / #17 / #24 / #25 | 10 ✓, `OK`, `1`, `1` | unchanged — no title touched |
| ⟨I⟩ / #28 | `10 passed (10)`, `OK` | unchanged |
| #39 / #44 | `OK` / `0` | `OK` / `0` |
| everything else | as tabled | unchanged |

**Nothing failed. I know of no acceptance command a correct implementation cannot satisfy.**

Files changed this revision: `lib/testDbGuard.ts` (215 → 259), `lib/testDbGuard.test.ts` (147 → 200),
and this document. `lib/overviewRead.ts`, `lib/overviewRead.test.ts`, `lib/testDbGuard.setup.ts`,
`app/api/v1/overview/route.ts`, `app/api/v1/overview/route.test.ts` and
`vitest.integration.config.mts` are untouched. No new file, no deleted file, no dependency change,
and no change to any fixture title.
