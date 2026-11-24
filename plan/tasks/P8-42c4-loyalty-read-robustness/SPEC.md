# P8-42c4-loyalty-read-robustness — the loyalty read tells the truth about what happened: a failed body read starts nothing, the stored last read matches the answer, purged mail is visible, vanished bytes are not a terminal failure, a failed rollback is logged, and the panel is one snapshot

**Roadmap item:** ROADMAP.md §5 Phase 8 step 42c, follow-up to P8-42c2 (`fda9eb9`) and P8-42c3 (`0c6b2ae`). Origin: `plan/tasks/P8-42c4-loyalty-read-robustness/ITEM.md` (binding); NITS N4, N5, N6, N7 and N10 in `plan/tasks/P8-42c2-loyalty-inbox-read/NITS.md`. "42c2 line n" means line n of `plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md`, "42c3 line n" means line n of `plan/tasks/P8-42c3-loyalty-read-forwards/SPEC.md`; both are FROZEN.
**Status:** FROZEN (G0 2026-11-24, amendments A1-A5 at the end)
**Author:** spec-writer

**How figures are handled (AGENTS.md public-repo rule).** This spec holds no money-looking figure, no balance and no member number. The new test is written with fabricated `ZQ42C4` data: program names `ZQ42C4 …`, sender domains and addresses on `.test` or `example.*` only, no balance literal (a reading the fake reader must return is `{}` or taken from the existing pinned fixture `apps/web/lib/fixtures/loyalty-read/cases.json`, which this task reads and never edits). Command 19 scans this spec for money-looking text. Under `node -e` the first extra argument is `process.argv[1]`; every `node -e` below reads its arguments that way. No `sed` range below is written as a comma-grouped number: ranges are `-e Np` pairs or variables.

## Goal
Six observable changes. Each makes the reading panel, the stored state or the route disagree less with what actually happened. Nothing about how a message is read, decided or applied changes.

### Decisions the item delegated to this spec
Each is binding; the one-line reason is for the reviewer.

**D1 — N7a, a failed body read.** After the caller is resolved (401 and 403 still come first, and neither reads the body), a body whose read fails answers the **same status and `code` as the route's existing invalid-JSON answer** (`INVALID_INPUT`) with a fixed sentence that echoes nothing, and starts nothing: no lock taken, no reader call, no row or state written. An absent or empty body is still `{}` and starts a run, as today. *Why:* a read that costs money must not start from a request whose intent could not be read; reusing the existing invalid answer adds no response shape.

**D2 — N7b, the form of the ROLLBACK handler.** A failed `ROLLBACK` is **logged and swallowed, never silent**: exactly one `warn` line through the module's logger with message `loyalty read rollback failed` and fields limited to `{ code: 'store_failed' }` (a code already in `LOYALTY_READ_RUN_ERROR_CODES`). The error object, its text, the SQL and any mail content are never logged. The statement or refusal that caused the rollback still decides the outcome: the original error is re-thrown (`decideAndStore`, which the run then records as `store_failed` and a failed message) and an original `Refusal` is still answered as that refusal (`resolveReading`). The pool client is released exactly as today. *Why:* an empty or `undefined` arrow is the same swallow with different syntax and defeats the reviewer's "silently swallowed errors" class; a failed rollback usually means a dead connection, which is worth one fixed-shape line, and the codebase's logging rule (counts and codes only) is kept. Only these two sites change: the same pattern in `lib/loyaltyInbox.ts` and `lib/loyaltyStore.ts` is out of scope (Non-goals).

**D3 — N5, the order and the rule.** The stored last read is **written last**, after every step that can fail, from the **same final code** the response carries. The steps run in this order, each attempted whatever the earlier ones did: the read (`readAll`), the remaining count, the purge, then the state write. The final code is the first failure in that order (a read run code wins; else `store_failed` if the remaining count or the purge failed; else none). When the state write succeeds, the stored `(last_outcome, last_error_code)` equals the response's `(outcome, errorCode)` and `last_read_on` is today's `CURRENT_DATE`. When the state write itself fails, the stored row is left **exactly as it was** (it is one atomic UPDATE under CHECKs, never half written) and the response is `error` with the final code, or `store_failed` when there was none; that is the one combination where response and stored state cannot agree, and it is asserted as "unchanged" rather than "equal". The purge no longer waits on the remaining count. The `disabled` and `already_running` answers still write nothing, and the daily job's own second purge is unchanged. *Why:* writing last is the only order in which no later failure can contradict what was stored, and it also stops a failed remaining count from skipping both the state write and the purge (which today leaves stale state and expired rows).

Every combination (R = the read, X = the remaining count, P = the purge, W = the state write; "stored" is the state row afterwards; a seeded expired row is deleted in every row whose P is not failing):

| # | R | X | P | W | Response | Stored |
|---|---|---|---|---|---|---|
| 1 | ok | ok | ok | ok | `ok`, code null | `ok`, null |
| 2 | ok | ok | fail | ok | `error`, `store_failed` | `error`, `store_failed` (today: `ok`) |
| 3 | ok | fail | ok | ok | `error`, `store_failed` | `error`, `store_failed` (today: unchanged) |
| 4 | ok | ok | ok | fail | `error`, `store_failed` | unchanged |
| 5 | ok | ok | fail | fail | `error`, `store_failed` | unchanged |
| 6 | run code `rate_limited` | ok | ok | ok | `error`, `rate_limited` | `error`, `rate_limited` |
| 7 | run code `rate_limited` | ok | fail | ok | `error`, `rate_limited` (first failure wins) | `error`, `rate_limited` |
| 8 | run code `rate_limited` | fail | ok | ok | `error`, `rate_limited` | `error`, `rate_limited` |
| 9 | run code `rate_limited` | ok | ok | fail | `error`, `rate_limited` | unchanged |
| 10 | threw (`store_failed`) | ok | ok | ok | `error`, `store_failed` | `error`, `store_failed` |
| 11 | threw | ok | fail | ok | `error`, `store_failed` | `error`, `store_failed` |
| 12 | threw | ok | ok | fail | `error`, `store_failed` | unchanged |
| 13 | ok | fail | fail | ok | `error`, `store_failed` | `error`, `store_failed` |

**D4 — N4, a `retry` row whose bytes are gone: counted as failed, not closed.** The panel's `failed` is the number of reads rows in state `failed` **plus** the rows in state `retry` for which no stored message with that `dedupe_key` still has its bytes (the message row deleted by 42c1's retention, or its `raw_mail` null). Each row counts once. A `retry` row whose bytes are present is **not** failed (it stays in `waiting`, so `waiting` and `failed` never count one message twice). The panel shows it through the existing line "Could not be read: n" and no new line, field, state or code. Nothing is written: no row is closed, no stored state changes. *Why:* it is read-only, so it works with no API key (a `disabled` run writes nothing by 42c2's rule), it also covers bytes that go after the last run, and it needs no edit to 42c1's frozen retention. Closing would need a write on a path the disabled run is forbidden. Accepted residual, stated so it is decided: a message whose bytes were purged **before any attempt** has no reads row and stays invisible (42c2 behaviour, `T42c2-I14` pins it), and "Try failed mail again" still resets only `failed` rows with bytes, so it can show for a count it cannot reduce (already true today for `failed` rows with purged bytes).

**D5 — N10, bytes that vanish between selection and read.** When the bytes are null at read time (the row is deleted or its `raw_mail` is null) after the attempt was counted, the message is **not** recorded as `failed/empty_message` and the model is not called. Its reads row stays exactly as `countAttempt` wrote it (state `retry`, or `failed` only through the ordinary attempt limit, `last_error_code` `api_error`, attempts one more than before), so D4 makes it visible. The run counts it as neither read nor failed, sets no run error code, does not touch the consecutive-failure streak, and goes on to the next message. A message whose bytes are present but yield no text is still `failed/empty_message` with no model call (42c2). *Why:* a vanished message is not an empty one and its fate is not a decision about its content; leaving the attempt row avoids an undo write that could itself fail, and the row has nothing left to retry.

**D6 — N6, one snapshot.** `loadReadOverview`, called with the pool (`db`), whether defaulted or passed explicitly as `loadOverview` in `lib/loyaltyStore.ts` does, reads **all five** of its statements (state row, counts, queue, coverage, from-mail) on one checked-out connection inside one `READ ONLY` transaction at `REPEATABLE READ` (or stronger), commits (or rolls back) and releases the client on every path. Every figure comes from that one snapshot, so `needsAttention.length <= needsAttentionTotal` holds whatever finishes meanwhile. The response shape is unchanged. *Why:* the counts and the list are one picture; the whole panel costs one connection for a few milliseconds.

## Non-goals
The reviewer enforces each as a defect if present.
- **No change to what a message becomes or how it is decided.** `decideReading`, `cleanReading`, the prompt, the reader (`lib/loyaltyReader.ts`), the model, the retry limits, the lock key, the text path (`lib/domain/loyaltyInbox.ts`, `lib/domain/loyaltyInboxText.ts`), storage and the scheduler are unchanged. `LOYALTY_READ_*` constants are unchanged.
- **No contract change.** No new reads state, no new error code, no new response or panel field, no migration, no `db/schema.sql` change. The one allowed edit under `packages/` is the comment-only correction of the `failed` field's doc line (Contracts touched).
- **No closing or rewriting of rows to fix N4**, no new reason, and no change to `retryFailed` (it still deletes only `failed` rows whose message still has bytes), to `remainingCount`, `waiting` or `coverage`.
- **No other empty catch is fixed.** The same `.catch(() => {})` in `lib/loyaltyInbox.ts`, `lib/loyaltyStore.ts`, `lib/proposalStore.ts` and elsewhere stays; `releaseLock`'s catch is unchanged. No change to how the failed client is released.
- **No automatic re-read.** Messages already read are not re-read; nothing offers a `no_balance`, `applied`, `stale`, `pending`, `ignored` or `not_mine` row again, and a row whose attempt was consumed by D5 is not re-selected because its bytes are gone.
- **No UI change.** The panel component, the page, its text and the "Try failed mail again" gating are untouched.
- **Out of scope by the item:** 42c2's N3, N8 and N9, 42c3's NITS, and anything from 42d on.
- **No new dependency, no new exported symbol, no new non-test source file.** The new tests must compile and run against today's sources (command 17).
- **No log line carries a subject, text, address, balance, member number, model output or library error text**, and no `console.` call is added; no JS clock and no float in any added line.
- **No existing test, fixture or script is edited, weakened or deleted** (`gifts-surface-check.mjs` and the registry included).

## Contracts touched
**None.** G1: **SKIP.** Every behaviour above uses existing states, codes, counts and response shapes: D1 reuses `INVALID_INPUT`, D2 and D3 use `store_failed` and the existing run codes, D4 widens only which rows an existing integer counts, D5 uses existing states, D6 is internal.

| File | Change | Class (§9.2) |
|---|---|---|
| `packages/contracts/loyalty.ts` | the doc comment of the panel's `failed` field (currently "retained reads rows in state `failed`") is corrected to say it also counts `retry` rows whose bytes are gone; comment only, no exported symbol, schema or constant changes | none (documentation) |

If the orchestrator's G1 rule treats any edit under `packages/contracts` as a contract change, this edit is the single item to route through contract-guardian; command 7 proves the diff is comment-only. If the implementer finds a real shape change is needed, it stops and names it; it is not made silently.

## Conventions this task must honor
- **Sign:** not applicable. No amount is parsed, computed or compared. Balances reach this task only as opaque values the fake reader returns (`{}` or from the pinned fixture). Nothing is negated.
- **Rounding:** none.
- **Landscape and exclusions:** not applicable. No ledger row is read or written; `landscape`, `hidden` and `exclude_from_budget` are never consulted. Command 14 asserts no ledger read is added, and the carried regression block proves the ledger is untouched.
- **Null semantics:** the panel counts are integers, `0` when there are none, never null; `lastRead` stays null only for "never read" (unchanged). A stored last read that was not written (W failed) is **unchanged, not reset to null**. No "—" is introduced.
- **Dates and clock:** "today" is Postgres `CURRENT_DATE`. None of `new Date(`, `Date.now(`, `toISOString`, `getTime(`, `setDate(`, `setHours(`, `getTimezoneOffset`, `toLocaleDateString`, `toLocaleTimeString`, `parseFloat`, `toFixed`, `Math.round` appears in any line this task adds (command 14).
- **Logs:** counts and fixed codes only (Non-goals). The new line has exactly the shape in D2.
- **Determinism:** no live Anthropic, Plaid or mailbox, no non-loopback socket, no dependence on the dev database `b8_finance`. Fault injection is by means the test installs and always removes (a trigger or spy; see Scenarios), never by timing.

## Toolchain prerequisites
All commands run under `/bin/bash` 3.2 from the repo root. The orchestrator measures each row at G0; a mismatch is a G0 FAIL. Baselines are the 42c3 close-out figures and are measured, not assumed.

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `psql` and a local Postgres with CREATEDB | **yes** | local install | `psql -d postgres -tAc "select 1"` → `1` | filled at G0 |
| T2 | Throwaway DB `b8_p42a_throwaway` at head (this task adds no migration) with no `ZQ42C` rows and no leftover test triggers or functions | **yes** | reuse; else `createdb b8_p42a_throwaway` then `DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npm run migrate:up` | `psql postgresql://localhost/b8_p42a_throwaway -Atc "select name from pgmigrations order by id desc limit 1"` ends `_loyalty_inbox_read`; and `psql postgresql://localhost/b8_p42a_throwaway -Atc "select (select count(*) from loyalty_programs where name like 'ZQ42C%')\|\|','\|\|(select count(*) from household_members where display_name like 'ZQ42C%')\|\|','\|\|(select count(*) from loyalty_inbox_messages)\|\|','\|\|(select count(*) from pg_trigger where tgname like 'zq42c4%')\|\|','\|\|(select count(*) from pg_proc where proname like 'zq42c4%')"` → five zeros | filled at G0 |
| T3 | Unit baseline | **yes** | existing | `npm test 2>&1 \| tail -8` → `Test Files  112 passed (112)` and `Tests  1430 passed (1430)` | filled at G0 |
| T4 | Lint baseline, and the finding that eslint does not flag the empty arrow catches | **yes** | existing | `npm run lint; echo "exit=$?"` → 0 errors, not above 5 warnings, with today's two `.catch(() => {})` in `loyaltyInboxRead.ts` present (`grep -c '\.catch(() => {})' apps/web/lib/loyaltyInboxRead.ts` → `2`) | filled at G0 |
| T5 | Integration baseline | **yes** | existing | 42c2 line 407 with `370` replaced by `373`, run on the unmodified tree (the body of 42c3 lines 210 to 220) → `OK 373 tests …`, `OK T42c3-I1-I3 …`, `OK no fixture rows left` | filled at G0 |
| T6 | `tsc` in `apps/web` with `--incremental false` | **yes** | existing | `(cd apps/web && npx tsc --noEmit --incremental false; echo "exit=$?")` → `exit=0` | filled at G0 |
| T7 | Node 22 or later | **yes** | local install | `node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22 ? 0 : 1)'; echo "exit=$?"` → `exit=0` | filled at G0 |
| T8 | Port 3198 free; surface script green on the unmodified tree | **yes** | existing | `lsof -nP -iTCP:3198 -sTCP:LISTEN \| wc -l` → `0`, then `node apps/web/scripts/gifts-surface-check.mjs; echo "exit=$?"` → `OK H1-H15`, `exit=0` | filled at G0 |
| T9 | `npm run build` succeeds on the unmodified tree | **yes** | existing | `npm run build; echo "exit=$?"` → `exit=0` | filled at G0 |
| T10 | The frozen 42c2 SPEC lines carried by commands 2, 5, 6, 7, 8, 9, 10, 11 and 12 sit where stated. Prefix checks: line 251 `set -e; O="$(mktemp)"; npm run lint`, 255 `echo "OK lint 0 errors`; 269 `set -e; B="$(git merge-base HEAD main)"`, 278 `echo "OK dependencies"`; 374 `set -e; U=postgresql://localhost/b8_p42a_throwaway`, 392 `echo "OK schema"`; 397 `set -e; unset ANTHROPIC_API_KEY`, 398 `for TZV in UTC Pacific/Auckland`; 407 `node -e 'const r=JSON.parse(require("fs")`, 408 `LEFT="$(psql `, 409 `[ "$LEFT" = `, 410 `echo "OK no fixture rows left"`; 416 `set -e; unset ANTHROPIC_API_KEY`, 420 `bash -c `; 426 `set -e; unset ANTHROPIC_API_KEY`, 440 `BODY="$(sed -n `; 446 `set -e; unset ANTHROPIC_API_KEY`, 457 `echo "OK surface"`; 574 `set -e; D=apps/web/lib/fixtures/loyalty-read; I=`, 605 `echo "OK fixtures pinned and covered"`. Line 407 holds the digits `370` exactly twice | **yes** | frozen | `S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; for n in 251 255 269 278 374 392 397 398 407 408 409 410 416 420 426 440 446 457 574 605; do printf '%s:' "$n"; sed -n "${n}p" "$S" \| cut -c1-60; done` shows each prefix, and `sed -n '407p' "$S" \| grep -o 370 \| wc -l \| tr -d ' '` → `2` | filled at G0 |
| T11 | The frozen 42c3 SPEC lines carried by commands 4 and 12 sit where stated: line 182 starts `set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN`, 183 starts `for TZV in UTC Pacific/Auckland; do O=`; 256 starts `set -e; D=apps/web/lib/fixtures/loyalty-read-forwards`, 288 is `echo "OK new fixtures pinned and covered"`, 289 starts `S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){`, 290 starts `RUN 574 605` | **yes** | frozen | `S=plan/tasks/P8-42c3-loyalty-read-forwards/SPEC.md; for n in 182 183 256 288 289 290; do printf '%s:' "$n"; sed -n "${n}p" "$S" \| cut -c1-70; done` shows each prefix | filled at G0 |
| T12 | The 42c3 fixture directory `apps/web/lib/fixtures/loyalty-read-forwards/` holds 11 entries and matches its pinned digest on the unmodified tree | **yes** | existing (merged) | command 12's first lines on the unmodified tree → `OK new fixtures pinned and covered` | filled at G0 |
| T13 | The DB role can create and drop a trigger and function on `loyalty_inbox_reads`, `loyalty_inbox_read_state` and `loyalty_inbox_messages` (fault injection) | **yes** | existing role | `psql postgresql://localhost/b8_p42a_throwaway -Atc "select has_table_privilege(current_user,'loyalty_inbox_reads','TRIGGER') and has_table_privilege(current_user,'loyalty_inbox_read_state','TRIGGER') and has_table_privilege(current_user,'loyalty_inbox_messages','TRIGGER')"` → `t`, and `psql postgresql://localhost/b8_p42a_throwaway -Atc "select has_schema_privilege(current_user,'public','CREATE')"` → `t` | filled at G0 |
| T14 | `vitest.integration.config.mts` collects `app/api/v1/**/*.test.ts`, so a new file in `apps/web/app/api/v1/loyalty/` is an integration test and is not in the unit suite | **yes** | existing | `grep -c "'app/api/v1/\*\*/\*.test.ts'" apps/web/vitest.integration.config.mts` → `1`, and `grep -c "app/" apps/web/vitest.config.mts` → `0` | filled at G0 |
| T15 | Work happens on `main`, uncommitted, with the 42c3 commit as HEAD, so `git diff` against `HEAD` is exactly this task's change | **yes** | adjudicated at G0 | `[ "$(git merge-base HEAD main)" = "$(git rev-parse HEAD)" ]; echo "exit=$?"` → `exit=0`; `git status --short \| grep -v ' plan/' \| wc -l \| tr -d ' '` → `0` | filled at G0 |
| T16 | No iCloud-evicted (dataless) files in the checked trees | **yes** (hazard) | n/a | `find apps/web packages migrations db node_modules -flags +dataless -type f -not -path "*/.next/*" -not -path "node_modules/react-native*" -not -path "node_modules/@react-native*" -not -path "node_modules/@expo*" -not -path "node_modules/expo*" \| wc -l` → `0`, re-checked before each gate run | filled at G0 |
| T17 | Under `set -e`, a leading `!` does not abort when the negated command succeeds; this spec writes no `! cmd` guard | **yes** (hazard) | n/a | `bash -c 'set -e; ! true; echo reached'` → `reached` | filled at G0 |
| T18 | `unset` of every `ANTHROPIC_` variable works, and a set `LOYALTY_IMAP_` variable is refused | **yes** | n/a | `bash -c 'ANTHROPIC_API_KEY=x; unset ANTHROPIC_API_KEY; [ -z "${ANTHROPIC_API_KEY:-}" ]'; echo "exit=$?"` → `exit=0` | filled at G0 |
| T19 | A browser or jsdom renderer | **NO** | n/a. The panel component is unchanged; the surface script proves the page over HTTP. | n/a | n/a |
| T20 | Live Anthropic, live Plaid, a real mailbox, any non-loopback socket, the dev database `b8_finance`, the owner's ledger | **NO** | n/a | n/a | n/a |

### Prerequisites the implementer creates
- **`apps/web/app/api/v1/loyalty/loyaltyReadRobust.test.ts`**, an integration test, the only new test file. Its scenarios are `T42c4-I1` to `T42c4-I6` (below), exactly six `it(` blocks, titles beginning `T42c4-I<n>:`. It builds its own world and messages from fabricated `ZQ42C4` strings in the file (one program `ZQ42C4 …` with a sender domain on `.test`, plain-text messages with no figures), reuses the existing helpers by copying what it needs (it must not import from another `*.test.ts`, which would re-run that file's tests), mocks `createMailReader` as `loyaltyRead.test.ts` does, and sets the API key canary itself. It uses only existing exports (`readStoredMail`, `loadReadOverview`, `resolveReading`, the route's `POST`), so it compiles against today's sources. It removes every row, trigger, function, spy and environment change it makes, and resets `loyalty_inbox_read_state` to never-read.
- **No fixture directory** is created or edited. The pinned `loyalty-read/` and `loyalty-read-forwards/` directories stay byte-identical.

## Acceptance commands
All run from the repo root under `bash` (macOS `/bin/bash` 3.2). `U=postgresql://localhost/b8_p42a_throwaway`. No command uses a leading `!` as a guard (T17). Every command that runs tests first unsets `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` and `ANTHROPIC_PROFILE`, and one that touches the database or the surface refuses a set `LOYALTY_IMAP_` variable. File lists come from git, never a glob under `set -f`. Run order: 1 to 3, 17, then the rest (no migration step).

The shared first line of every carried command is:
`S=<frozen SPEC path>; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }`

| # | Command | Expected | Would break if |
|---|---|---|---|
| 1 | `(cd apps/web && npx tsc --noEmit --incremental false; echo "exit=$?")` | `exit=0` | a type error, including in the new test |
| 2 | Lint, carried (42c2 #2), below | `OK lint 0 errors, warnings not above 5` | a lint regression |
| 3 | Unit totals, unchanged, below | `OK unit 112 files 1430 tests` | a test added to or removed from the unit suite, an existing unit test broken |
| 4 | 42c3 oracle, carried (42c3 #4), below | two lines `OK 3 scenarios T42c3-U1..U3 each present once and passed; TZ=<zone>` | any change to the text path or the pinned fixtures |
| 5 | 42c2 unit scenarios, carried (42c2 #7), below | two lines `OK 6 scenarios T42c2-U1..U6 each present once and passed; TZ=<zone>` | a regression in 42c2's pure decision rules |
| 6 | Dependencies and importers, carried (42c2 #4), below | `OK dependencies` | a dependency added; a wrong importer |
| 7 | Schema carried (42c2 #6); no migration; contracts diff comment-only and the `failed` doc corrected, below | `OK schema`, then `OK no migration, contracts comment-only` | a migration, a schema edit, a changed exported symbol, an uncorrected doc line |
| 8 | Integration, carried (42c2 #8 with the total adjusted) plus the 42c3 and 42c4 scenarios and leak checks, below | `OK 379 tests, … T42c2-I1-I14 each present once and passed`, `OK T42c3-I1-I3 and T42c4-I1-I6 each present once and passed in their files`, `OK no fixture rows left`, `OK no test trigger or function left` | any 42c2 or 42c3 scenario regresses; a new scenario fails; a leaked row, trigger or function |
| 9 | Integration stability, carried (42c2 #9), below | `[]`, `[]`, `OK failing set stable and within KNOWN` | an order-dependent or leaking new test |
| 10 | Regression block, carried (42c2 #10), below | the carried OK lines, ending `OK classes` | a 42a to 42c1 guarantee disturbed |
| 11 | Surface over real HTTP, carried (42c2 #11), below | `H1 PASS` to `H15 PASS` each once, `OK H1-H15`, `OK surface` | any page or route behaviour changed |
| 12 | 42c3 fixtures pinned (the digest check) then 42c2's fixtures, carried, below | `fixture shape ok`, `OK new fixtures pinned and covered`, `fixture shape ok`, `OK fixtures pinned and covered` | an edited fixture, the 42c3 digest not matching |
| 13 | Registry unchanged, below | `OK registry unchanged` | a registry line added, removed or reclassified |
| 14 | Source guards, below | `OK source guards` | an empty catch kept, the route still turning a failed read into an empty body, no transaction for the panel, a clock or float, console output, an error text, a ledger read, a figure in the new test |
| 15 | Scope guard, below | `OK scope` | a file outside the allowed set changed |
| 16 | Existing tests untouched and census, below | `OK existing tests untouched, census exact` | an existing test edited; the new file not holding exactly six titled scenarios |
| 17 | Baseline-fail proof: the new test against today's two source files, below | `OK all 6 scenarios fail on the original sources and the tree is restored` | a scenario that passes on today's code (vacuous), a baseline failure that is a setup error, a tree not restored |
| 18 | `npm run build; echo "exit=$?"` | `exit=0` | a type or bundling error |
| 19 | This spec's own public-safety scan, below | `OK spec has no money-looking text` | a figure or long number in the spec |
| 20 | Mutation evidence, below | `OK mutation evidence rows <n>` with n at least 10 | fewer than ten recorded mutations, or one not shown failing |

**#2 (lint, carried).**
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 251 255 'set -e; O="$(mktemp)"; npm run lint' 'echo "OK lint 0 errors'
```

**#3 (unit totals, unchanged).** The new test is an integration test (T14), so the unit totals equal T3.
```
set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_PROFILE
O="$(mktemp)"; npm test > "$O" 2>&1 || true; tail -8 "$O"
[ "$(grep -cE 'Test Files +112 passed \(112\)' "$O")" = 1 ]
[ "$(grep -cE 'Tests +1430 passed \(1430\)' "$O")" = 1 ]
echo "OK unit 112 files 1430 tests"
```

**#4 (42c3 oracle, carried).** Lines 182 and 183 of the 42c3 SPEC, run under `UTC` and `Pacific/Auckland`.
```
set -e; S=plan/tasks/P8-42c3-loyalty-read-forwards/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 182 183 'set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN' 'for TZV in UTC Pacific/Auckland; do O='
```

**#5 (42c2 unit scenarios, carried).**
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 397 398 'set -e; unset ANTHROPIC_API_KEY' 'for TZV in UTC Pacific/Auckland'
```

**#6 (dependencies and importers, carried).**
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 269 278 'set -e; B="$(git merge-base HEAD main)"' 'echo "OK dependencies"'
```

**#7 (schema carried; no migration; contracts comment-only; the doc line corrected).** The contracts diff may be empty only if the doc line was already correct, which it is not today, so the last check fails until the comment is fixed.
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 374 392 'set -e; U=postgresql://localhost/b8_p42a_throwaway' 'echo "OK schema"'
B="$(git rev-parse HEAD)"
[ -z "$(git diff --name-only "$B" -- migrations db)" ]
[ -z "$(git ls-files -o --exclude-standard migrations db packages)" ]
[ -z "$(git diff --name-only "$B" -- packages | grep -vxF packages/contracts/loyalty.ts || true)" ]
if git diff -U0 "$B" -- packages | grep -E '^[+-][^+-]' | grep -vE '^[+-][[:space:]]*(\*|//|/\*)'; then echo "FAIL a non-comment line changed under packages"; exit 1; fi
L="$(grep -E '^ \*   failed +' packages/contracts/loyalty.ts | head -1)"
case "$L" in *retry*) ;; *) echo "FAIL the failed field's doc line does not mention retry rows"; exit 1;; esac
echo "OK no migration, contracts comment-only"
```

**#8 (integration: 42c2's block with its total adjusted, then the 42c3 and 42c4 scenarios, then the leak checks).** The only edit to the carried line is replacing its two occurrences of `370` with `379`: 370 plus the three 42c3 tests plus the six new ones. The guard asserts there are exactly two, so any other change to that line fails. T5 measures the unmodified total at G0; if it differs, the orchestrator corrects both numbers here before freezing.
```
set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_PROFILE
S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }
U=postgresql://localhost/b8_p42a_throwaway; O="$(mktemp)"; export O U
if env | grep -q '^LOYALTY_IMAP_'; then echo "FAIL a LOYALTY_IMAP_ variable is set in the environment"; exit 1; fi
G 407 "node -e 'const r=JSON.parse(require(\"fs\")"; G 408 'LEFT="$(psql '; G 409 '[ "$LEFT" = '; G 410 'echo "OK no fixture rows left"'
(cd apps/web && DATABASE_URL=$U npx vitest run --config vitest.integration.config.mts --reporter=json --outputFile="$O") || true
L407="$(sed -n '407p' "$S")"
[ "$(printf '%s' "$L407" | grep -o '370' | wc -l | tr -d ' ')" = 2 ]
bash -c "${L407//370/379}"
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);const bad=[];const fam=[["T42c3-I",3,"loyaltyReadForwards.test.ts"],["T42c4-I",6,"loyaltyReadRobust.test.ts"]];for(const [p,n,file] of fam){for(let i=1;i<=n;i++){const m=t.filter(x=>x.title.startsWith(p+i+":"));if(m.length!==1||m[0].status!=="passed")bad.push(p+i+"="+m.map(x=>x.status).join("/")+"("+m.length+")")}const f=r.testResults.filter(x=>x.assertionResults.some(a=>a.title.startsWith(p)));if(f.length!==1||!f[0].name.endsWith("apps/web/app/api/v1/loyalty/"+file))bad.push(p+" files="+f.length)}if(bad.length){console.log("FAIL",bad.join(","));process.exit(1)}console.log("OK T42c3-I1-I3 and T42c4-I1-I6 each present once and passed in their files")' "$O"
bash -c "$(sed -n -e 408p -e 409p -e 410p "$S")"
LEFT2="$(psql "$U" -Atc "select (select count(*) from pg_trigger where tgname like 'zq42c4%')||','||(select count(*) from pg_proc where proname like 'zq42c4%')")"
[ "$LEFT2" = "0,0" ] || { echo "FAIL a test trigger or function was left behind: $LEFT2"; exit 1; }
echo "OK no test trigger or function left"
```

**#9 (integration stability, carried).**
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 416 420 'set -e; unset ANTHROPIC_API_KEY' 'bash -c '
```

**#10 (regression block, carried).**
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 426 440 'set -e; unset ANTHROPIC_API_KEY' 'BODY="$(sed -n '
```

**#11 (surface over real HTTP, carried).** The panel and routes are unchanged for a well-formed request; the script is not edited (command 15).
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 446 457 'set -e; unset ANTHROPIC_API_KEY' 'echo "OK surface"'
```

**#12 (the 42c3 fixture digest check, then 42c2's fixtures; carried).** 42c3 lines 256 to 290 hold the digest pin, the shape checks and, on the last two lines, the 42c2 fixtures. They are guarded on their first and last line and run in their own `bash -c`.
```
set -e; S=plan/tasks/P8-42c3-loyalty-read-forwards/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
G 256 'set -e; D=apps/web/lib/fixtures/loyalty-read-forwards'; G 288 'echo "OK new fixtures pinned and covered"'
A=256; Z=288; bash -c "$(sed -n "${A},${Z}p" "$S")"
S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G 574 'set -e; D=apps/web/lib/fixtures/loyalty-read; I='; G 605 'echo "OK fixtures pinned and covered"'
A=574; Z=605; BODY="$(sed -n "${A},${Z}p" "$S")"; [ "$(printf '%s' "$BODY" | grep -o 'a63773c1bd7db28be057caefbd246e2ae09b80b6ffa7774ed4b5bb04751d4cd8' | wc -l | tr -d ' ')" = 1 ]
bash -c "${BODY//a63773c1bd7db28be057caefbd246e2ae09b80b6ffa7774ed4b5bb04751d4cd8/67570ee60b87555ce5e21df4194b138740805caabd4584dbe2bef343b37027ca}"
[ "$(git diff -U0 HEAD -- apps/web/lib/fixtures | grep -E '^[+-][^+-]' | tr '\n' '|')" = '-      "Could not be read: 1",|+      "Could not be read: 2",|' ]
```

**#13 (registry unchanged).** A guard against collateral change; a no-op passes it by design. Non-vacuity of the task is carried by commands 8 and 17.
```
set -ef; B="$(git rev-parse HEAD)"; R=apps/web/lib/giftSurfaceRegistry.ts
[ -z "$(git diff --name-only "$B" -- "$R")" ]
[ "$(grep -c "'app/api/v1/loyalty/inbox/read/route.ts', classes: \['no-transaction-data'\]" "$R")" = 1 ]
[ "$(grep -c "'app/api/v1/loyalty/inbox/readings/\[id\]/route.ts', classes: \['no-transaction-data'\]" "$R")" = 1 ]
[ "$(grep -c "app/travel/page.tsx', classes: \['numeric-only'\]" "$R")" = 1 ]
echo "OK registry unchanged"
```

**#14 (source guards).** Several guards fail on today's code on purpose (the empty catches, the route's `req.text().catch`, no transaction in the panel).
```
set -ef; B="$(git rev-parse HEAD)"
R=apps/web/lib/loyaltyInboxRead.ts; RT=apps/web/app/api/v1/loyalty/inbox/read/route.ts; IT=apps/web/app/api/v1/loyalty/loyaltyReadRobust.test.ts
added(){ if git ls-files --error-unmatch "$1" >/dev/null 2>&1; then git diff -U0 "$B" -- "$1" | grep -E '^\+[^+]' | sed 's/^+//' || true; else cat "$1"; fi; }
for f in "$R" "$RT" "$IT"; do [ -f "$f" ] || { echo "FAIL missing $f"; exit 1; }; done
[ -n "$(git diff --name-only "$B" -- "$R")" ]
[ -n "$(git diff --name-only "$B" -- "$RT")" ]
# N7b: no swallowing catch of any spelling in the two files
if grep -nE '\.catch\([[:space:]]*(\([[:space:]]*\)|_|[A-Za-z]+)[[:space:]]*=>[[:space:]]*(\{[[:space:]]*\}|undefined|void 0)[[:space:]]*\)' "$R" "$RT"; then echo "FAIL an empty or value-less catch handler remains"; exit 1; fi
if grep -nE 'catch[[:space:]]*(\([^)]*\))?[[:space:]]*\{[[:space:]]*\}' "$R" "$RT"; then echo "FAIL an empty catch block remains"; exit 1; fi
# N7a: a failed body read is no longer turned into an empty string
if grep -nE 'req\.text\(\)[[:space:]]*\.catch' "$RT"; then echo "FAIL the route still swallows a failed body read"; exit 1; fi
[ "$(grep -cF 'loyalty read rollback failed' "$R")" -ge 1 ]
# N6: one snapshot
[ "$(grep -cE 'REPEATABLE READ|SERIALIZABLE' "$R")" -ge 1 ]
[ "$(grep -cF 'READ ONLY' "$R")" -ge 1 ]
BAN='toISOString|new Date\(|Date\.now\(|getTime\(|setDate\(|setHours\(|getTimezoneOffset|toLocaleDateString|toLocaleTimeString|parseFloat|toFixed|Math\.round'
for f in "$R" "$RT" "$IT"; do
if added "$f" | grep -nE "$BAN"; then echo "FAIL clock or float in $f"; exit 1; fi
if added "$f" | grep -nE '^[[:space:]]*(//|/\*|\*)' | grep -E '[0-9]+\.[0-9]{2}([^0-9]|$)|\$[0-9]'; then echo "FAIL a money-looking figure in an added comment of $f"; exit 1; fi
done
for f in "$R" "$RT"; do
if added "$f" | grep -nE 'console\.'; then echo "FAIL console output in $f"; exit 1; fi
if added "$f" | grep -nE 'err(or)?\.message|\)\.message|String\((err|error|e)\)|\.stack|JSON\.stringify\((err|error|e)\)'; then echo "FAIL a library error text may reach a log or response in $f"; exit 1; fi
done
LIT="['\"][-]?[0-9]+\.[0-9]{2,4}['\"]"
if grep -nE "$LIT" "$IT"; then echo "FAIL a figure literal in $IT"; exit 1; fi
if grep -nE "['\"][0-9]{4,}['\"]" "$IT"; then echo "FAIL a digit-only quoted string of four or more digits in $IT"; exit 1; fi
if grep -nE '(^|[^[:alnum:]_])(FROM|JOIN)[[:space:]]+(transactions|accounts|account_valuations)([^[:alnum:]_]|$)' "$R"; then echo "FAIL a ledger read in $R"; exit 1; fi
RMW="$(grep -rlF 'raw_mail' apps/web/lib apps/web/app apps/web/components apps/web/scripts | grep -vE '\.test\.ts$|gifts-surface-check\.mjs$|/fixtures/' | sort | tr '\n' ' ')"
[ "$RMW" = "apps/web/lib/loyaltyInbox.ts apps/web/lib/loyaltyInboxRead.ts " ]
[ "$(grep -cF 'b8:loyalty-inbox:read' "$R")" = 1 ]
[ "$(grep -cF 'b8:loyalty-inbox:poll' "$R")" = 0 ]
echo "OK source guards"
```

**#15 (scope guard).**
```
set -f; B="$(git rev-parse HEAD)"; [ "$B" = "$(git merge-base HEAD main)" ]
CH="$(mktemp)"; { git diff --name-only "$B"; git ls-files -o --exclude-standard; } | grep -v '^plan/' | sort -u > "$CH"
OUT="$(grep -vE '^(apps/web/lib/loyaltyInboxRead\.ts|apps/web/app/api/v1/loyalty/inbox/read/route\.ts|apps/web/app/api/v1/loyalty/loyaltyReadRobust\.test\.ts|apps/web/app/api/v1/loyalty/loyaltyRead\.test\.ts|apps/web/lib/fixtures/loyalty-read/cases\.json|packages/contracts/loyalty\.ts)$' "$CH" || true)"
[ -z "$OUT" ] || { echo "OUTSIDE THE ALLOWED SET:"; echo "$OUT"; exit 1; }
for f in apps/web/lib/loyaltyInboxRead.ts apps/web/app/api/v1/loyalty/inbox/read/route.ts apps/web/app/api/v1/loyalty/loyaltyReadRobust.test.ts packages/contracts/loyalty.ts; do grep -qxF "$f" "$CH" || { echo "MISSING $f"; exit 1; }; done
[ -z "$(git diff --name-only "$B" -- migrations db apps/web/package.json package.json package-lock.json 'apps/web/vitest*' evals apps/web/scripts apps/web/lib/loyaltyReader.ts apps/web/lib/loyaltyInbox.ts apps/web/lib/loyaltyStore.ts apps/web/lib/scheduler.ts apps/web/lib/giftSurfaceRegistry.ts apps/web/lib/domain apps/web/lib/fixtures/loyalty-read-forwards apps/web/lib/fixtures/loyalty-read/*.eml apps/web/components apps/web/app/travel)" ] || { echo "FAIL a frozen file changed"; exit 1; }
echo "OK scope"
```

**#16 (existing tests untouched, census exact).**
```
set -f; B="$(git rev-parse HEAD)"
[ -z "$(git diff --name-only "$B" -- '*.test.ts' '*.test.tsx' '*.test.mts' | grep -vxF apps/web/app/api/v1/loyalty/loyaltyRead.test.ts || true)" ] || { echo "FAIL a tracked test file changed"; exit 1; }
[ "$(git diff -U0 "$B" -- apps/web/app/api/v1/loyalty/loyaltyRead.test.ts | grep -E '^[+-][^+-]' | tr '\n' '|')" = '-    expect(panel.failed).toBe(1);|+    expect(panel.failed).toBe(2);|' ] || { echo "FAIL T42c2-I11 changed beyond its one failed-count line"; exit 1; }
NEW="$(git ls-files -o --exclude-standard | grep -E '\.test\.(ts|tsx|mts)$' | sort | tr '\n' ' ')"
[ "$NEW" = "apps/web/app/api/v1/loyalty/loyaltyReadRobust.test.ts " ] || { echo "FAIL the set of new test files is wrong: $NEW"; exit 1; }
IT=apps/web/app/api/v1/loyalty/loyaltyReadRobust.test.ts
[ "$(grep -cE "^[[:space:]]*(it|test)\(" "$IT")" = 6 ]
[ "$(grep -cE "it\('T42c4-I[1-6]:" "$IT")" = 6 ]
for i in 1 2 3 4 5 6; do [ "$(grep -cE "it\('T42c4-I$i:" "$IT")" = 1 ] || { echo "FAIL T42c4-I$i is not present exactly once"; exit 1; }; done
echo "OK existing tests untouched, census exact"
```

**#17 (baseline-fail proof).** Puts today's version of the two source files back, runs the new test file against them, requires all six scenarios to fail with assertion failures rather than setup errors, and restores the implementer's files whatever happens. Command 8 independently proves the same file passes on the modified tree, so a failure here can only come from the source difference.
```
set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_PROFILE
if env | grep -q '^LOYALTY_IMAP_'; then echo "FAIL a LOYALTY_IMAP_ variable is set in the environment"; exit 1; fi
ROOT="$(pwd)"; F1=apps/web/lib/loyaltyInboxRead.ts; F2=apps/web/app/api/v1/loyalty/inbox/read/route.ts; T=apps/web/app/api/v1/loyalty/loyaltyReadRobust.test.ts
U=postgresql://localhost/b8_p42a_throwaway; K="$(mktemp -d)"; O="$(mktemp)"
[ -f "$T" ]; [ -n "$(git diff --name-only HEAD -- "$F1")" ]; [ -n "$(git diff --name-only HEAD -- "$F2")" ]
cp "$F1" "$K/a"; cp "$F2" "$K/b"
( trap 'cp "$K/a" "$ROOT/$F1"; cp "$K/b" "$ROOT/$F2"' EXIT; git show "HEAD:$F1" > "$F1"; git show "HEAD:$F2" > "$F2"; cd apps/web && DATABASE_URL=$U npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyReadRobust.test.ts --reporter=json --outputFile="$O" ) || true
cmp -s "$K/a" "$F1" && cmp -s "$K/b" "$F2" || { echo "FAIL the implementer's files were not restored"; exit 1; }
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);const bad=[];for(let i=1;i<=6;i++){const m=t.filter(x=>x.title.startsWith("T42c4-I"+i+":"));if(m.length!==1||m[0].status!=="failed"){bad.push("I"+i+"="+m.map(x=>x.status).join("/")+"("+m.length+")");continue}if(/ECONNREFUSED|Cannot find module|SyntaxError|is not a function|is not defined/.test(m[0].failureMessages.join(" ")))bad.push("I"+i+" failed on a setup error, not an assertion")}if(bad.length){console.log("FAIL",bad.join(","));process.exit(1)}console.log("OK all 6 scenarios fail on the original sources and the tree is restored")' "$O"
```

**#19 (this spec's own public-safety scan).**
```
set -e; S=plan/tasks/P8-42c4-loyalty-read-robustness/SPEC.md; T="$(mktemp)"; sed -E 's/[0-9a-f]{64}//g' "$S" > "$T"
if grep -nE '\$[0-9]{3,}|\$[0-9]{1,3},[0-9]{3}|\$[0-9]+\.[0-9]{2}' "$T"; then echo "FAIL a dollar figure in the spec"; exit 1; fi
if grep -nE '[0-9]{1,3}(,[0-9]{3})+' "$T"; then echo "FAIL a thousands-separated figure in the spec"; exit 1; fi
BAD="$(grep -oE '[0-9]{6,}' "$T" | sort -u || true)"
[ -z "$BAD" ] || { echo "FAIL a long number in the spec: $BAD"; exit 1; }
if grep -nEi 'member number [0-9]|balance of [0-9]' "$T"; then echo "FAIL a balance or number stated in the spec"; exit 1; fi
echo "OK spec has no money-looking text"
```

**#20 (mutation evidence).** The implementer records, in `plan/tasks/P8-42c4-loyalty-read-robustness/EVIDENCE.md`, one row per deliberate single-line break: `| M<n> | <file and change in words> | <failing test id> | FAIL | reverted, green |`.
```
set -e; E=plan/tasks/P8-42c4-loyalty-read-robustness/EVIDENCE.md
[ -f "$E" ]
N="$(grep -cE '^\| M[0-9]+ \|.*\| FAIL \|.*reverted' "$E")"
[ "$N" -ge 10 ] || { echo "FAIL only $N mutation rows with FAIL and reverted"; exit 1; }
for id in T42c4-I1 T42c4-I2 T42c4-I3 T42c4-I4 T42c4-I5 T42c4-I6; do grep -qF "$id" "$E" || { echo "FAIL no mutation row names $id"; exit 1; }; done
if grep -nE '\$[0-9]{3,}|[0-9]{1,3}(,[0-9]{3})+' "$E"; then echo "FAIL EVIDENCE.md holds a money-looking figure"; exit 1; fi
echo "OK mutation evidence rows $N"
```

### What was not carried, and why
- 42c3's #3, #8 (totals), #14, #15, #16 and #18 pin 42c3's totals, merge-base diffs and change set; their intent is carried by commands 3, 8, 14, 15, 16 and 20 here. 42c3's #12 is rewritten as command 13 against `HEAD`.
- 42c2's #5 (migration up-down-up) is not re-run: no migration is added; commands 7 and 15 prove it.
- 42c3's integration scenarios `T42c3-I1` to `I3` run inside command 8 and are asserted present and passed there, so the origin wiring and the no-re-read rule are re-proven on the new code.

## Scenarios
Fixture canary `ZQ42C4`. Every scenario installs its fault or interleave by a means it removes in a `finally` (a statement-level trigger raising an exception, a spy on `db.query` or `db.connect` that delegates to the real function for everything else, or a proxy client); the means is the implementer's, the observables are not. Captured console lines are the whole file's, as in `loyaltyRead.test.ts`; each is a JSON line with `level`, `scope` and `message`. Every scenario seeds what it asserts on and ends with the world, the state row and the key environment restored.

| Id | Observable rule | Setup and assertion | Catches |
|---|---|---|---|
| T42c4-I1 | **N7a.** A failed body read answers the invalid-request response and starts nothing; an absent or empty body still starts a run; authorisation still comes first. | Key set, one unread stored message with bytes, a fake reader counting calls, the state row seeded to a known value. (a) A POST whose body stream errors while being read, with a write-scope bearer → the same HTTP status and `code` (`INVALID_INPUT`) as the answer to a body of `{not json`, and a message that does not repeat anything sent; the fake reader was called 0 times, no reads row exists, the state row equals its seed, and `loyalty_inbox_messages` is unchanged. (b) The same erroring body with **no credential** → 401, with a read-scope token → 403 `INSUFFICIENT_SCOPE`; in both the stream's read was never attempted (a flag on the stream's `pull`). (c) An empty body and an absent body → 200 with a run that read the stored message (reader called once). (d) `{"retryFailed":true}` still resets and reads a failed message; `{"x":1}` and `{not json` still answer the invalid response. | a failed read treated as `{}` (a full paid run starts); a body read before authorisation; an empty body refused; the strict-body rule loosened |
| T42c4-I2 | **N7b.** A failed ROLLBACK is logged once with a fixed shape and never changes the outcome. | A proxied client from `db.connect` whose queries delegate except: (a) in a run, the transaction statement that updates the reads row rejects with an error carrying the text `ZQ42C4-ORIGINAL`, then `ROLLBACK` rejects with `ZQ42C4-ROLLBACK`: the run answers `error`/`store_failed`, `failed` is 1, the message's reads row is `retry`, attempts 1, `api_error`, no observation exists, and the next message in the same run is still read. Exactly one captured line has message `loyalty read rollback failed`, level `warn`, scope `loyalty-read`, and its fields are exactly `time`, `level`, `scope`, `message`, `code` with `code` `store_failed`; no captured line contains either canary text, the SQL, the key, a subject or an address. (b) `resolveReading` on an already-resolved item with `ROLLBACK` rejecting still returns the refusal `ITEM_RESOLVED` (not a throw), with one such line; (c) `resolveReading` where a statement rejects (`ZQ42C4-ORIGINAL`) and `ROLLBACK` rejects (`ZQ42C4-ROLLBACK`) **rejects with the original error** (its text contains `ZQ42C4-ORIGINAL` and not `ZQ42C4-ROLLBACK`), one such line. (d) With `ROLLBACK` succeeding, no such line is logged. | the rollback error replacing the original; a silent swallow; a log line carrying error text; a refusal turned into a throw; a line logged on success |
| T42c4-I3 | **N5.** Response and stored state agree in every combination of the table; the state is written last; the purge no longer waits on the count. | One run per row of the D3 table (all 13), each from the same seed: the state row set to a known earlier read (`ok`, null, a date earlier than today), one expired reads row (received strictly before the retention cut-off, from the contract constant) and one row at exactly the cut-off, one unread message, a fake reader answering `{}` (rows 1 to 5, 13), `rate_limited` (6 to 9), or the candidates query made to throw (10 to 12). P fail is a statement-level `BEFORE DELETE` trigger on `loyalty_inbox_reads`; W fail is a `BEFORE UPDATE` trigger on `loyalty_inbox_read_state`; X fail is a spy rejecting the remaining-count statement once. For each row assert the response `(outcome, errorCode)`, then the stored `(last_outcome, last_error_code, last_read_on)` against the table (`last_read_on` is today's `CURRENT_DATE` read from Postgres when written, and the seeded earlier date when "unchanged"), that in every row where P does not fail the expired row is deleted and the cut-off row is kept, and that the three state columns are never half-written (all null or all set). Triggers and spies are removed after each row. | stored `ok` beside an `error` answer (rows 2, 3, 13); a skipped purge when the count fails; the state written before the purge; a purge failure overwriting a read's code; the state row reset to null by a failed write |
| T42c4-I4 | **N4.** A `retry` row with no bytes is counted failed, once; nothing else changes class. | Seed one reads row each: A `retry` with bytes; B `retry` whose message row is deleted; C `retry` whose `raw_mail` is null; D `failed` with bytes; E `failed` whose message row is deleted; F `pending`; G `applied`; plus H an unread stored message with bytes, and I a stored message with null bytes and **no** reads row. `loadReadOverview()` → `failed` is exactly the number of rows B, C, D and E, `waiting` is exactly the number of A and H, `needsAttentionTotal` counts F only, and no message counts in both `failed` and `waiting` (A is waiting only, E is failed once). The whole reads table's checksum is unchanged by the call and by a `disabled` run (no key). Through `GET /api/v1/loyalty` the body still passes the contract schema, and `retryFailed` resets D and not E, B or C. | the old count (B and C missing); A counted failed; E counted twice; a write on a read path; I made visible; `retryFailed` resetting a gone-bytes row |
| T42c4-I5 | **N10.** Vanished bytes are not a terminal failure; empty text still is. | A trigger (test-only) removes the bytes of one message at the moment its attempt is counted. Two runs, one per shape: (a) the message row is deleted, (b) its `raw_mail` is set null (with whatever column the table's CHECKs also demand). In each: three messages, the vanishing one oldest, an ordinary one, and one whose bytes are present but empty of text. The vanished message's reads row is `retry`, attempts 1, `api_error`, **not** `failed`/`empty_message`; the fake reader was never given its text; the run's `failed` counts only the empty-text message, no run `errorCode` is set, the ordinary message was read in the same run, and the empty-text message is `failed`/`empty_message` with attempts 1. A message already at attempts 2 whose bytes then vanish ends `failed`/`api_error` attempts 3, never `empty_message`. After the run `loadReadOverview()` counts the vanished row in `failed` (D4). | the old terminal `empty_message` for a vanished message; an empty-text message let through; the vanishing counted as a run failure or a read; a run stopped by it; an undone attempt |
| T42c4-I6 | **N6.** The panel is one snapshot: one connection, one `READ ONLY` `REPEATABLE READ` transaction, all five statements, no mixed figures. | `db.connect` is spied (delegating) and the checked-out client wrapped. Seed two `pending` items. Call `loadReadOverview()`; the wrapper, before it forwards the **queue statement**, waits for every earlier statement on that client to finish, then (on a separate pool connection) commits one more `pending` item and one more waiting message, then forwards. Assert: the client saw one `BEGIN` whose text holds `READ ONLY` and `REPEATABLE READ` or `SERIALIZABLE`, then all five panel statements, then `COMMIT` (or `ROLLBACK`), and was released exactly once; `db.query` (the pool) ran none of the five; the returned `needsAttentionTotal` equals the number of seeded items **before** the interleave (two), `needsAttention.length` is two (not three), `waiting` excludes the interleaved message; and a second call afterwards sees three and the new waiting message. A throwing statement still ends the transaction and releases the client. | separate statements; a plain `READ COMMITTED` transaction; the counts in the transaction and the list outside it; a leaked client; a snapshot that shows the later write |

## Negative controls
| # | Rule | Input that must be rejected or excluded | Asserted by |
|---|---|---|---|
| 1 | A failed body read starts nothing | a POST whose body stream errors, with a key set and an unread message waiting: reader calls 0, no reads row, state row unchanged | T42c4-I1 (a), commands 8 and 17 |
| 2 | An empty or absent body is still `{}` and still reads | an empty body and no body: 200, one read | T42c4-I1 (c) |
| 3 | The caller is resolved before the body is read | the erroring body with no credential (401) and with a read token (403): the stream is never pulled | T42c4-I1 (b) |
| 4 | The strict body and invalid JSON are unchanged | `{not json`, `{"x":1}`: the invalid response | T42c4-I1 (d) |
| 5 | A failed rollback is logged once, in a fixed shape | rollback rejecting with the canary text: one `loyalty read rollback failed` line, fields exactly as D2 | T42c4-I2, command 14 |
| 6 | The original error decides, never the rollback's | statement error plus rollback error: the original rejects; a refusal plus rollback error: still the refusal | T42c4-I2 (b), (c) |
| 7 | A successful rollback logs nothing new | the same failure with a working rollback: no such line | T42c4-I2 (d) |
| 8 | No log line carries error text, SQL, key, subject or address | both canary texts, the key canary and the ZQ42C4 subject and address strings across every captured line of the file | T42c4-I2, T42c4-I3, T42c4-I5 |
| 9 | Stored state equals the answer whenever it can be written | all 13 combinations of D3 | T42c4-I3 |
| 10 | A failed state write leaves the stored state exactly as it was, not reset | rows 4, 5, 9 and 12: the seeded earlier values remain | T42c4-I3 |
| 11 | A read run code is not overwritten by a later purge or count failure | rows 7 and 8: `rate_limited` stays | T42c4-I3 |
| 12 | The purge runs whatever the count or the read did, and keeps the cut-off row | an expired row deleted in every non-P-fail row; the row at exactly the cut-off kept | T42c4-I3 |
| 13 | A `retry` row with bytes present is not failed | row A: counted waiting only | T42c4-I4 |
| 14 | A `failed` row with gone bytes is counted once | row E: failed 1, not 2 | T42c4-I4 |
| 15 | Nothing is written to fix the count; a message purged before any attempt stays invisible | the reads table checksum unchanged; row I has no reads row and counts nowhere | T42c4-I4 |
| 16 | A vanished message is not `failed`/`empty_message` and does not count as a failed read | both vanish shapes: `retry`, `api_error`, run `failed` unchanged | T42c4-I5 |
| 17 | An empty message whose bytes are present is still `failed`/`empty_message` with no model call | the empty-text message in the same run | T42c4-I5, `T42c2-I14` (command 8) |
| 18 | One vanished message does not stop the run | the ordinary message after it is read | T42c4-I5 |
| 19 | The panel's figures come from one snapshot | a pending item and a waiting message committed mid-call are absent from that call and present in the next | T42c4-I6 |
| 20 | The panel never leaks a client | a throwing panel statement: transaction ended, client released once | T42c4-I6 |
| 21 | Already-read messages are never re-read | reads rows in `no_balance`, `applied`, `stale`, `pending`, `ignored`, `not_mine` not offered | `T42c3-I3` (command 8) |
| 22 | The text path and the pinned fixtures are unchanged | the 42c3 oracle and digest, the 42c2 unit scenarios | commands 4, 5, 12 |
| 23 | Nothing outside the two source files, the new test and one comment changed | any other file, a migration, a schema, a script, the registry | commands 7, 13, 15 |
| 24 | Today's code fails every new scenario | the new test against today's two source files | command 17 |

## Evidence required
- `EVIDENCE.md` at `plan/tasks/P8-42c4-loyalty-read-robustness/EVIDENCE.md` with the verbatim output of every acceptance command (numbers inside assertion diffs redacted) and the docs under `node_modules/next/dist/docs/` read for the route handler, if any.
- **The N5 table, observed:** for each of the 13 combinations, the response `(outcome, errorCode)`, the stored `(outcome, errorCode)` and a PASS, and a before column from command 17's run on today's code. Booleans, codes and counts only.
- **The N4 table, observed:** rows A to I of T42c4-I4 with the counted class (waiting, failed, none) before and after the change.
- **The command 17 output:** the six titles, each `failed` on today's sources, and the restore check.
- **Mutation evidence** (command 20), at least ten single-line breaks, each shown failing the named scenario and reverted: M1 write the state before the purge again (T42c4-I3); M2 skip the purge when the count fails (T42c4-I3); M3 let a purge failure overwrite a read's code (T42c4-I3); M4 reset the state to null on a failed write (T42c4-I3); M5 swallow the ROLLBACK error silently again (T42c4-I2); M6 let the rollback error replace the original (T42c4-I2); M7 log the error text in the rollback line (T42c4-I2); M8 count only `failed`-state rows (T42c4-I4); M9 count every `retry` row as failed (T42c4-I4); M10 record a vanished message as `failed/empty_message` (T42c4-I5); M11 use `READ COMMITTED` or no transaction for the panel (T42c4-I6); M12 leave one of the five statements on the pool (T42c4-I6); M13 treat a failed body read as `{}` again (T42c4-I1); M14 refuse an empty body (T42c4-I1); M15 read the body before authorising (T42c4-I1).
- The accepted residuals of D4 (a message purged before any attempt stays invisible, and "Try failed mail again" can show for a count it cannot reduce) restated in one sentence each.

## Failure modes to test
- **Sign, rounding, landscape:** none apply. Any change to a balance, a date or an observation is a defect (the carried decision scenarios and the regression block prove none).
- **N7a.** The body read failing after authorisation but the route still starting a run; the failure answered 500 or 200 instead of the invalid response; the body read before the caller is resolved; an empty body accidentally refused; the invalid message echoing request content.
- **N7b.** The rollback error becoming the thrown error and hiding the original; a `Refusal` turned into a 500 by a failed rollback; a log line carrying the error text, the SQL, a subject or an address; a log line per statement rather than per failed rollback; the client no longer released; a handler that is empty again in another spelling (`undefined`, `null`, an empty block, a variable unused).
- **N5, order.** The state written before a step that can still fail; the remaining count throwing and skipping the purge and the state write; the purge throwing and being masked; a read code overwritten by a later `store_failed`; the first failure not winning; a failed state write resetting the row to null or half writing it (the CHECKs refuse, but a retry loop that writes another value would not); the purge running after the state is already final, so a failure there is lost again; `disabled` or `already_running` now writing a state.
- **N5, off by one.** The retention cut-off moved (exactly the retention days kept, one more deleted) while reordering the purge; `last_read_on` taken from a JS clock instead of `CURRENT_DATE`.
- **N4.** A JOIN on the messages table duplicating a reads row when two messages share a key; `NOT EXISTS` written as `NOT IN` (a null key makes every row disappear); a `retry` row with bytes counted in both `waiting` and `failed`; a `failed` row counted once as failed and again as gone; the null-bytes message and the deleted message handled differently; the unread-no-bytes message made visible; a count that writes; the contract comment left saying the old thing.
- **N10.** The message with vanished bytes being recorded terminal anyway through another path (`textForReader` throwing is a different case and stays `empty_message`); the attempt undone by a write that can fail; the run's failed count or the consecutive-failure streak moved; an exception from `bytesOf` (the database failing, not the bytes missing) mistaken for vanished bytes and swallowed (it must still be a store failure as today); the next message skipped.
- **N6.** The transaction opened on one connection and some statements still sent to the pool; `BEGIN` issued twice if a caller ever passes one client already in a transaction; the client not released when a statement throws; the pool exhausted because a connection is held while `loadOverview` runs its other queries in parallel; `READ ONLY` missing so the panel could write; the isolation set with a `SET TRANSACTION` after the first statement (it would be refused); a snapshot taken before the lock or the state row is read.
- **Determinism.** A scenario that relies on timing instead of a gate (the interleave must wait for earlier statements); a trigger or spy left installed after a failed assertion; the wall clock; the order of tests; a leftover row, trigger or function (command 8's cleanup checks).
- **Vacuity.** A scenario that passes on today's code (command 17 catches it); a baseline failure that is only a setup error (command 17 rejects those messages); a test that asserts only the response and not the stored state.
- **Tooling traps.** A carried command whose extracted line moved (the guards fail loudly); the `370` substitution touching another token; `process.argv[1]` read as `[2]` under `node -e`; a comma-grouped number in a `sed` range.

## Rollback
1. Revert the task's commit(s): `apps/web/lib/loyaltyInboxRead.ts`, `apps/web/app/api/v1/loyalty/inbox/read/route.ts`, the new integration test and the comment line in `packages/contracts/loyalty.ts` go together.
2. There is **no migration, no `down` and no CSV restore**: the task adds no table, column, constant or state.
3. Rows written while the change was live stay valid. A message whose bytes vanished mid-run keeps its `retry` row (after a revert it reads as it did before D4, uncounted); a stored last read written under D3 is an ordinary state row. No observation is written or removed by this task's own paths.
4. After a revert, the six behaviours return exactly as the NITS describe them; nothing else is affected.

## Amendments (orchestrator, G0, 2026-11-24)

- **A1 — G1 runs, comment only.** The scope-guard hook (BUILD.md I2) blocks every agent but contract-guardian from
  `packages/contracts/**`, so the one doc-line correction in "Contracts touched" is made by contract-guardian at G1,
  before the implementer starts. It is comment-only; command 7 still proves it. G1 is therefore **PASS (comment only)**,
  not SKIP. The implementer does not edit `packages/contracts/loyalty.ts`.
- **A2 — command 14's catch guard no longer bans `() => null`.** The line `textForReader(...).catch(() => null)` in
  `loyaltyInboxRead.ts` is a deliberate mapping to the existing `empty_message` branch (Failure modes, N10: "textForReader
  throwing is a different case and stays `empty_message`"), not a swallowed ROLLBACK, and is out of scope. The guard's
  alternatives are now `{}`, `undefined` and `void 0`. That line is left unchanged.
- **A3 — D6 covers the explicit pool.** `loadOverview` passes `db` explicitly, so D6 applies whenever the handle is the
  pool, not only when defaulted. A caller that passes a checked-out client gets the same five statements run on that
  client inside the transaction D6 describes.
- **A4 — D4 changes two pinned expectations, and only those (G2 cycle 1, 2026-11-24).** 42c1's retention deletes the
  message row, so a `retry` row with no message row is exactly the N4 case, and two pins from 42c2 encode the old count:
  `T42c2-I11` in `apps/web/app/api/v1/loyalty/loyaltyRead.test.ts` (`expect(panel.failed).toBe(1)`, one `failed` and
  one `retry` row, neither with a message) and the surface fixture `apps/web/lib/fixtures/loyalty-read/cases.json`
  (`"Could not be read: 1"`). The orchestrator changes each to `2`, one line each, and nothing else in either file.
  This supersedes the Non-goal "no existing test or fixture is edited" for those two lines only. Command 12 now runs
  42c3's fixture block as carried and 42c2's with its pinned digest replaced by the new one (guarded to occur once),
  then proves the fixture diff is exactly that line; commands 15 and 16 admit the two files with exact-diff checks.
- **A5 — command 17 restores by absolute path.** Its subshell `cd`s into `apps/web` before the `EXIT` trap runs, so the
  relative `cp` in the trap could not restore the implementer's files. The trap now copies to `$ROOT/$F1` and `$ROOT/$F2` (`ROOT` is the repo root); `git show` keeps the repo-relative names. Command 12's sed ranges are written with variables so command 19 does not read them as figures. A3 is read
  as: with a caller-passed client, the five statements run on that client and this function opens no transaction of
  its own (the caller owns it); with the pool, D6 as written.
