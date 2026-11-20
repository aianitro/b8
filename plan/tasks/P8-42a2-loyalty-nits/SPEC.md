# P8-42a2-loyalty-nits — three follow-ups to the loyalty page and import before the owner's first real import
**Roadmap item:** ROADMAP.md §5 Phase 8 step 42a, follow-up task P8-42a2. Origin: `plan/tasks/P8-42a2-loyalty-nits/ITEM.md` (binding). It covers NITS N1, N3 and N4 of `plan/tasks/P8-42a-loyalty-model-page-import/NITS.md`. Predecessor: `plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md`. "P8-42a #n" below means that spec's acceptance command n, with the G2 amendment A1 from its `GATES.md` applied. A1 says: under `node -e` the first extra argument is `process.argv[1]`.
**Status:** FROZEN at G0 2026-11-19
**Author:** spec-writer

## Goal
Three observable changes. Nothing else changes.

1. **N1.** On `/travel`, tapping a masked member number opens an editor that starts empty. Saving it empty, or with only whitespace, now changes nothing. It sends no request, shows no error, and the stored number and the mask stay as they were. A member number can still be removed, but only through a separate, explicit "Remove number" control that asks for confirmation before it sends `PATCH {memberNumber: null}`. That control is the only place in the page's components that can send `memberNumber: null`. Saving a non-empty number behaves as before. The editors for other fields (tier, names, descriptions, dates) behave exactly as before.
2. **N3.** The import script refuses an `--as-of` date later than Postgres's `CURRENT_DATE + 1`, in dry run and with `--apply`. Refusal means exit 2, nothing written, empty stdout, and a stderr message that carries no data. Postgres computes the bound. This is the same rule the API applies in `lib/loyaltyStore.ts`. `CURRENT_DATE` and `CURRENT_DATE + 1` are accepted. Any past date stays accepted.
3. **N4.** Every time the import prints "import could not run; nothing was changed", it also prints one further stderr line, `code=<CODE>`. `<CODE>` is the database error's SQLSTATE (for example `42P01`) or its errno name (for example `ECONNREFUSED`). If the error has no code, or the code is not of one of those two shapes, the line is `code=unknown`. The error's message, detail, hint, stack and any value are never printed. Stdout stays empty on a database failure. The 20-line stdout contract of a successful run is unchanged.

## Non-goals
The reviewer enforces each of these as a defect if present.
- **No server, contract, migration or schema change.** `PATCH {memberNumber: null}` keeps clearing a number exactly as it does today. The server is not taught to ignore an empty string. No file under `packages/contracts/`, `migrations/` or `db/schema.sql`, and no route, `lib/loyaltyStore.ts` or `lib/domain/*` file, changes.
- **The member number stays masked everywhere.** The editor still starts empty, so no mask is ever pre-filled, and a fix that pre-fills the mask and treats "unchanged" as a no-op is not acceptable. The copy action, the S6 route, the mask rule and the "fetch on tap only" rule are unchanged. The clear control must not name or fetch the `/member-number` path.
- **Other `LoyaltyInlineText` users are not changed.** Tier, member name, program name, alias list, instrument description and the date fields keep their current blank-save behaviour. Their editors are pre-filled with the current value, so a blank save there is a deliberate clear, not the N1 hazard. The only `startEmpty` user stays the member-number editor.
- **Out of scope:** N2, N5 and N6 (they stay in P8-42a's NITS.md). Also out of scope: anything from 42b onward, a new page, route, sidebar entry or surface-registry entry, a new fixture file, and the 20-line import stdout format.
- **No lower bound on `--as-of`.** A past date is accepted as today. The wall clock is never read, so there is no `new Date(`, `Date.now(` or `toISOString` in the script. Postgres supplies the date.
- **No diagnostic beyond the code.** The code line is the whole change to the catch. The import prints no other new line, and no stdout line is added on failure. The error object is never serialised, stringified or logged.
- **No change to existing tests' behaviour.** Existing tests are only added to, never weakened.

## Contracts touched
None. G1 is a SKIP. The clear control reuses the existing `PATCH /api/v1/loyalty/memberships/[id]` body `{memberNumber: null}`, which the contract already allows (`memberNumber` is `.nullable().optional()` in `packages/contracts/loyalty.ts`). The `--as-of` bound and the `code=` line live inside one script. If the implementer finds a contract change is needed, that is a spec defect to be raised, not absorbed.

| File | Change | Class (§9.2) |
|---|---|---|
| `packages/contracts/*`, `migrations/*`, `db/schema.sql` | none | none |

## Conventions this task must honor
- **Sign:** not applicable. No amount, balance or ledger figure is read, written or printed by this change. The import's balance rules (non-negative, `usd` scale 2, decimal text) are untouched.
- **Rounding:** not applicable. There is no arithmetic. The only comparison is a calendar-date comparison made by Postgres.
- **Landscape and exclusions:** not applicable. Loyalty rows are not ledger rows, and no query reads `transactions`. `hidden`, `exclude_from_budget` and `track_transactions` are never consulted.
- **Null semantics:**
  - After an empty save the membership still shows its mask. It is not nulled, and the editor closes without error.
  - After an explicit, confirmed removal the page shows the "No number" placeholder and no Copy action. This is the existing null rendering.
  - A database failure prints `code=unknown`, never a blank code, when no usable code exists.
- **Empty means empty after trimming.** A draft of `''`, `'   '` or `'\t\n'` is empty. A non-empty draft is sent as it is today (the server trims).
- **The bound.** A date D is refused if and only if Postgres evaluates `D::date > CURRENT_DATE + 1` as true. `CURRENT_DATE` is read from the database, never the JS clock, in dry run and with `--apply`. An `--as-of` that is not a real calendar date is still a usage error (exit 2) before any database access, as today.
- **Exit codes** (unchanged vocabulary): 0 success, 1 a refused row or a run that could not complete (including a database failure while reading the bound), 2 a usage or file-level refusal or the future-date refusal.
- **Order.** Refusals that need no database (missing or malformed arguments, an unreadable file, a malformed CSV) still exit 2 even when the database is unreachable. A future `--as-of` needs one database read, so with the database unreachable it is a database failure: exit 1 with `code=<errno>`, not exit 2.
- **The refusal message (exit 2, future date)** contains no data. It does not contain the supplied date, the database's date or bound, any run of four or more digits, any `ZQ42A` text, or any sheet content. Empty stdout. A non-empty stderr is required, so a silent exit 2 does not pass.
- **The code line.**
  - It is exactly `code=` followed by a value, on its own stderr line, directly after the line `import could not run; nothing was changed`.
  - The value is the error's `code` property when it is a string matching `^[0-9A-Z]{5}$` (SQLSTATE) or `^E[A-Z0-9_]{1,31}$` (errno or Node error code). Any other value, a non-string code, an error with no code, and a thrown non-Error (including `null` or a string) all give `unknown`.
  - Printing a non-matching code verbatim is a defect, because a string a database or driver chose could carry data.
  - Every path that prints the failure line prints the code line. A success run prints no `code=` line and writes nothing to stderr.
- **Testability constraint (N1).** The decision "an empty save sends nothing" must live in the callback handed as `onSave` to the `LoyaltyInlineText` labelled `member number` in `components/LoyaltyMembershipLine.tsx`. The unit test extracts that callback from source and executes it against recording stubs, because no renderer exists. A guard that lives only inside `LoyaltyInlineText` or in a disabled button state is not accepted as the sole guard, since Enter-key submits would bypass a button state. The same guard may additionally exist elsewhere.
- **Process requirements for the implementer.**
  - Read the relevant guides under `node_modules/next/dist/docs/` (resolved from `apps/web`) before changing the client component.
  - Invoke the `uiux-promax` skill before designing the clear control (phone-first, tap target not smaller than the existing `min-h-8` controls).
  - Record in EVIDENCE.md which docs files were read.
- **No money-looking figure** in any tracked comment or commit message (AGENTS.md rule). No real data. Fixtures are the existing `ZQ42A` ones; this task adds no fixture file.

## Open questions with defaults
The spec is written assuming every default. The orchestrator may confirm or override.
1. **Form of the explicit clear control.** Default: a text button labelled "Remove number", rendered only when the membership has a stored number (the masked field is non-null). A first tap does not send anything. It reveals an inline confirmation naming two controls, "Confirm" and "Keep". Only "Confirm" sends `PATCH {memberNumber: null}`, followed by the same refresh as every other edit. "Keep" closes the confirmation and sends nothing. Alternative: `window.confirm`, rejected as unreliable in an installed iOS PWA.
2. **Whitespace-only counts as empty.** Default: yes.
3. **What the user sees after an empty save.** Default: the editor closes silently, as if cancelled, with no message and no request. Alternative: keep it open with a hint. Either is acceptable if nothing is sent.
4. **Where the bound is checked relative to file errors.** Default: any order among exit-2 refusals. Only "exit 2, empty stdout, no data" is specified.
5. **Code when none exists.** Default: `code=unknown`, so the line is always present after a failure.
6. **Does the refusal name the bound?** Default: no. The message says the date is too far in the future, with no date in it.

## Toolchain prerequisites
All commands run under `bash`. The orchestrator verifies every row before G0 passes. `Measured` is filled at G0. The facts stated by the orchestrator today, on the tree at `194f049`, are entered here and still verified.

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `psql`, `createdb`, `dropdb`, and a local Postgres with CREATEDB | **yes** | local install | `psql -d postgres -tAc "select 1"` → `1` | filled at G0 |
| T2 | The throwaway DB `b8_p42a_throwaway` is at head, with the loyalty tables, and is reused | **yes** | already exists; if not, `createdb b8_p42a_throwaway` then `DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npm run migrate:up` | `psql postgresql://localhost/b8_p42a_throwaway -Atc "select to_regclass('public.loyalty_instruments')::text"` → `loyalty_instruments` | at head (orchestrator) |
| T3 | The name `b8_p42a2_empty` is free and a database can be created and dropped under it (the DB-failure command makes its own empty DB) | **yes** | the command creates and drops it | `psql -d postgres -Atc "select count(*) from pg_database where datname='b8_p42a2_empty'"` → `0` | filled at G0 |
| T4 | Unit baseline BASE | **yes** | existing | `npm test 2>&1 \| tail -8` → 102 files, 1403 tests | 102 files / 1403 tests |
| T5 | Lint baseline LINT_BASE | **yes** | existing | `npm run lint; echo "exit=$?"` → 0 errors, 5 warnings | 0 errors / 5 warnings |
| T6 | Integration baseline on the unmodified tree | **yes** | existing | P8-42a #6's single-run body; failing titles ⊆ KNOWN | 321 tests, failing set `[]` |
| T7 | `tsc` runs in `apps/web`, with `--incremental false` | **yes** | existing | `(cd apps/web && npx tsc --noEmit --incremental false; echo "exit=$?")` → `exit=0` | filled at G0 |
| T8 | `tsx` resolves in `apps/web` | **yes** | existing | `(cd apps/web && npx tsx --version; echo "exit=$?")` → a version, `exit=0` | filled at G0 |
| T9 | `typescript` resolvable from `apps/web` (the unit test parses and transpiles source with it) | **yes** | existing | `(cd apps/web && node -e 'require.resolve("typescript")'; echo "exit=$?")` → `exit=0` | filled at G0 |
| T10 | Node ≥ 22 with global `fetch` | **yes** (surface script) | local install | `node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22 && typeof fetch==="function" ? 0 : 1)'; echo "exit=$?"` → `exit=0` | filled at G0 |
| T11 | Nothing listens on 127.0.0.1:1, so a connection is refused immediately | **yes** | n/a | `node -e 'require("net").connect(1,"127.0.0.1").on("error",e=>console.log(e.code))'` → `ECONNREFUSED` | filled at G0 |
| T12 | `env -u` exists, and `tsx` does not load a `.env` file by itself, so an unset `DATABASE_URL` stays unset | **yes** | existing | `(cd apps/web && env -u DATABASE_URL npx tsx -e 'console.log(process.env.DATABASE_URL === undefined)')` → `true` | filled at G0 |
| T13 | On the unmodified tree, a real run with `DATABASE_URL` unset prints the failure line, exits 1, and has empty stdout. Commands 8 and 9 build on this. | **yes** | existing code path (`lib/db` is lazy) | `(cd apps/web && env -u DATABASE_URL npx tsx scripts/import-loyalty.ts --file scripts/fixtures/loyalty-import.fixture.csv --as-of 2026-01-15 --default-member zq42aanna >/dev/null 2>/tmp/p42a2.err; echo "exit=$?"; cat /tmp/p42a2.err)` → `exit=1`, then exactly `import could not run; nothing was changed` | filled at G0 |
| T14 | P8-42a's SPEC.md still has the blocks at the lines the regression commands extract: line 212 (#4), 228 (#7), 233 to 288 (#9), 294 (#10), 299 (#12), 304 (#13) | **yes** | the file is frozen | `sed -n '212p;228p;233p;288p;294p;299p;304p' plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md \| cut -c1-24` → starts `set -e; for TZV in UTC`, `set -e; A=""; for i in`, `set -e; U=postgresql://`, `echo "OK import end to end"`, `node -e 'const s=require(`, `set -e; L="$( { git ls-fi`, `node -e 'const fs=require("f` | filled at G0 |
| T15 | P8-42a #9, with A1 applied, passes on the unmodified tree (this is the regression's baseline) | **yes** | command 10 | command 10 → `OK import end to end` | filled at G0 |
| T16 | Under `set -e`, a leading `!` does NOT abort the script when the negated command succeeds. This is why this spec writes no `! cmd` guard. | **yes** (documents a hazard) | n/a | `bash -c 'set -e; ! true; echo reached'` → `reached` | filled at G0 |
| T17 | `PRIOR_REDUCER` = 6 (from P8-42a's T20), exported for command 5 | **yes** | existing | `export PRIOR_REDUCER=6` | 6 |
| T18 | `git merge-base HEAD main` resolves | **yes** | existing | `git merge-base HEAD main` → a SHA | filled at G0 |
| T19 | Port 3198 free and `OK H1-H11` green on the unmodified tree (surface script) | **yes** | existing | `lsof -nP -iTCP:3198 -sTCP:LISTEN \| wc -l` → `0`, then `node apps/web/scripts/gifts-surface-check.mjs; echo "exit=$?"` → `OK H1-H11`, `exit=0` | filled at G0 |
| T20 | `npm run build` succeeds on the unmodified tree (it once hung fetching Google Fonts; re-run if so) | **yes** | existing | `npm run build; echo "exit=$?"` → `exit=0` | filled at G0 |
| T21 | A browser or jsdom/testing-library renderer | **NO** | n/a. Neither is installed. UI behaviour is checked by executing the extracted callback and by AST checks. The limit is declared in Evidence. | n/a | n/a |
| T22 | Live Plaid, the Anthropic API, mail, the dev database `b8_finance`, the owner's real sheet | **NO** | n/a | n/a | n/a |

Prerequisites the implementer must create (none exist today).
- `apps/web/lib/loyaltyNits.test.ts` is a new unit test file, collected by the existing unit config (`lib/**/*.test.ts`). It contains exactly three tests, whose titles begin `T42a2-U1:`, `T42a2-U2:` and `T42a2-U3:`.
- Three integration tests are added to the existing `apps/web/scripts/import-loyalty.test.ts`. That file is already named in `vitest.integration.config.mts`, so the config is not edited. The tests are additions only. Their titles begin `T42a2-I1:`, `T42a2-I2:` and `T42a2-I3:`.
- Exactly these three integration tests are added, so the integration total is 321 + 3 = 324. Exactly these three unit tests are added, so the unit totals are 103 files and 1406 tests.
- No fixture file is added or changed. The fixtures guard (P8-42a #13) asserts exactly four `loyalty-import.*.csv` files.

## Scenarios
All fixtures are fabricated and canary-marked `ZQ42A`. No scenario reads the wall clock.

| Id | Observable rule | Fixture and assertion | Catches |
|---|---|---|---|
| T42a2-U1 | An empty save on the member-number editor sends no request, and a non-empty save still does. | The test parses `components/LoyaltyMembershipLine.tsx` with `typescript`, extracts the `onSave` callback of the `LoyaltyInlineText` labelled `member number`, transpiles it, and runs it against recording stubs for `patch`, `send` and any other function the callback calls. The test author supplies the stubs. A reference to an identifier with no stub fails the test. The test names the unresolved identifier, so a restructure cannot silently pass. Drafts `''`, `'   '`, `'\t\n'` and a non-breaking-space-only string record 0 requests, and the callback resolves to `null` (success, so the editor closes). Draft `'ZQ42A-NUM-0001'` and draft `'  ZQ42A-NUM-0001 '` each record exactly 1 PATCH to a path ending `/memberships/<id>` whose body is exactly one key, `memberNumber`, and whose value is a string whose trim equals `ZQ42A-NUM-0001`. No recorded request in any case has a `null` body value. The same harness is then run on fabricated violating callbacks. (a) The pre-change form `patch(path, { memberNumber: blankIsNull(t) })`, which must record a request with `memberNumber: null` for `''`. (b) A variant that sends `''` or `'   '` unchanged. (c) A variant that guards on `t.length === 0` without trimming, which must record a request for `'   '`. The test asserts the harness records at least one request for each, so a harness that records nothing fails. | The N1 bug itself, a whitespace-only save, a harness blind to requests, a guard only in a button state. |
| T42a2-U2 | The explicit clear control exists, is the only source of `memberNumber: null`, and is gated and confirmed. | AST checks over every file under `components/` and `app/travel/`. (1) The property `memberNumber: null` (literal `null`) appears exactly once, inside a function that is an event handler attached through a JSX `on…` attribute. (2) No `memberNumber` property in a PATCH body has an initializer that is a conditional, a `??` or `\|\|` expression, or a call to `blankIsNull` (a `.trim()` call is allowed). `LoyaltyAddPanel.tsx`'s create-time `optional(...)` call is outside this rule and unchanged. (3) A JSX element whose text or aria-label contains `Remove number` exists. It sits under a conditional that references the masked member number being non-null, so it is not rendered for a membership with no number. Its own `onClick` handler is not the function that contains the null literal, because a first tap must not send. The function containing the null literal is attached to an element whose text or aria-label contains `Confirm`. (4) No file other than `LoyaltyCopyNumber.tsx` mentions `/member-number`. The null-literal handler does not reference that path. Each checker is run against fabricated sources. A violating source where the `Remove number` button's `onClick` itself sends `{ memberNumber: null }` is rejected. A source with a second `memberNumber: null` inside a Cancel handler is rejected. A source that renders `Remove number` unconditionally is rejected. A source using `blankIsNull` on `memberNumber` is rejected. A clean source with the confirm step is accepted. | A one-tap destructive control, a second path that can null the number, a control shown when there is nothing to remove, a checker that matches nothing. |
| T42a2-U3 | Other editors are unchanged, and `startEmpty` has one user. | Using the same extraction harness on `LoyaltyMembershipLine.tsx`: the `tier` editor's `onSave` still sends `PATCH {tier: null}` for `''` and `'   '`, and `{tier: '<text>'}` for text (so the fix did not globally disable clearing). The `member name` editor's `onSave` still sends `{displayName: <text>}` for a non-empty draft. A source check over `components/` and `app/travel/`: the attribute `startEmpty` is used on exactly one JSX element, the member-number editor, and `LoyaltyInlineText.tsx` still defaults it to `false` and still pre-fills `value` when it is false. The editor for a member number is not pre-filled with the mask (`startEmpty` stays on it). Fabricated violating sources: a second `startEmpty` user is rejected, and a member-number editor without `startEmpty` is rejected. | An over-broad fix, a mask written back into the field, an unnoticed second startEmpty editor. |
| T42a2-I1 | `--as-of` is bounded by Postgres `CURRENT_DATE + 1`. | In `import-loyalty.test.ts`, with the seed reset as the file's existing tests do. Dates are computed through the test's own database (`SELECT (CURRENT_DATE + n)::text`), never the JS clock. For n = 2 and n = 3, and for `2999-01-01`, each with and without `--apply`: `main` returns exit code 2; `out` is empty; `err` is non-empty, contains no `ZQ42A` text in any case, contains no run of four or more digits, and does not contain the supplied date string; the membership, observation and instrument counts stay `[0, 0, 0]` and the household, program and alias counts are unchanged. For n = 0 and n = 1 in dry run: exit 0, `out` has exactly 20 lines each matching `^[a-z_]+=([0-9]+(,[0-9]+)*\|dry-run\|apply)?$`, `mode=dry-run`, `memberships_created=12`, `observations_created=7`, `instruments_created=3`, `err` empty, counts still `[0, 0, 0]`. For n = 1 with `--apply`: exit 0, counts `[12, 7, 3]`, every observation row has `as_of = CURRENT_DATE + 1`, `err` empty. A past date (`2000-01-01`) in dry run: exit 0. The test wraps `deps.db` to record query texts and asserts at least one recorded query text contains `CURRENT_DATE`, so the bound demonstrably comes from the database. | An off-by-one (`>=`), a bound of +2, the check only in one mode, a JS clock, a message that echoes the date, exit 1 instead of 2, a lower bound. |
| T42a2-I2 | The failure line carries a code only, for every error shape. | `main` is run with `deps.db` replaced by a stub whose first query rejects with each of the following (both in dry run and, through a stub `connect`, with `--apply`). (a) An Error with `code: '42P01'` and a `message`, `detail`, `hint` and `stack` that each contain `ZQ42A-NUM-0001-ZZ`. (b) `code: 'ECONNREFUSED'` with the same canary in `message`. (c) An Error with no code. (d) An Error whose `code` is the canary text `ZQ42A secret value here`. (e) An Error whose `code` is the number 42. (f) A thrown string. (g) A thrown `null`. For each: exit code 1; `out` is empty; `err` is exactly the two lines `import could not run; nothing was changed` and `code=<expected>`, where `<expected>` is `42P01`, `ECONNREFUSED`, `unknown`, `unknown`, `unknown`, `unknown`, `unknown`. The canary appears nowhere in `out` or `err`. A control run on a healthy database (the good fixture, dry run) has empty `err`. | A printed message, detail or stack, a non-whitelisted code printed verbatim, a crash on a thrown null, a code line on stdout, a missing code line on the apply path. |
| T42a2-I3 | Real driver errors give the real class and no text. | Using the real `pg` error objects. (a) A `deps.db` that forwards to the real database but rewrites the table name `household_members` in the query text to `zq42a_missing_table`, in dry run and with `--apply` against the throwaway DB: `err` is exactly the failure line then `code=42P01`, `out` empty, exit 1, all counts unchanged, and the text `zq42a_missing_table` and the words `relation` and `does not exist` appear nowhere. (b) A `deps.db` over a fresh `pg` pool pointed at `postgresql://nobody@127.0.0.1:1/x` (closed port) in dry run and with `--apply`: `err` is exactly the failure line then `code=ECONNREFUSED`, `out` empty, exit 1, and `127.0.0.1` appears nowhere. (c) With the closed-port pool and `--as-of 2999-01-01`: exit 1 (a database failure while reading the bound is not a usage refusal), `code=ECONNREFUSED`. (d) With the closed-port pool and a missing `--file`: exit 2, no `code=` line anywhere, so a usage error is not mistaken for a database failure. | A message leak from a real driver error, a lost class for an apply-time failure, a database failure reported as a usage refusal, the code line on usage errors. |

## Acceptance commands
*(G0 amendment A0, orchestrator, 2026-11-19: the line-position guards in #5, #7, #10, #11, #12 and #13 compared `cut -c1-N` against literals whose length was not N, so #5, #7, #11, #12 and #13 failed on the unmodified tree where they must pass. Each guard is now a prefix match on the same literal via `case … in '<literal>'*)`, with the same intent: refuse to run if the frozen P8-42a line has moved.)*
All run from the repo root under `bash`. `U=postgresql://localhost/b8_p42a_throwaway`. Under `node -e`, the first extra argument is `process.argv[1]` (A1). Every `node -e` below reads its arguments that way. No command uses a leading `!` as a guard, because under `set -e` that guard never fails the script (T16). Where a command must assert absence it uses `if … then echo FAIL; exit 1; fi` or an explicit string comparison.

| # | Command | Expected | Would break if |
|---|---|---|---|
| 1 | `(cd apps/web && npx tsc --noEmit --incremental false; echo "exit=$?")` | `exit=0` | the new test or component does not type-check |
| 2 | `npm run lint; echo "exit=$?"` | `exit=0`, 0 errors, warnings not above 5 | a lint regression in the edited files |
| 3 | `npm test 2>&1 \| tail -8` | `Test Files  103 passed (103)` and `Tests  1406 passed (1406)` | a missing new test file, an existing test broken or deleted, extra or fewer new tests |
| 4 | New unit scenarios, below | two lines `OK 3 scenarios T42a2-U1..U3 each present once and passed; TZ=<zone>` | a missing or duplicated scenario, a zone-dependent result |
| 5 | Regression: P8-42a #4, extracted unchanged, below | two lines `OK 10 scenarios U1-U10 each present once and passed; latestValueByKey tests >= 6; TZ=<zone>` | the existing wiring checks (including U9, which reads the changed component) no longer pass |
| 6 | Integration scenarios, below | `OK 324 tests, T42a-C1-C11 and I1-I11 and T42a2-I1-I3 each present once and passed` | any new behaviour fails, an old scenario regresses, a failing title outside KNOWN |
| 7 | Regression: P8-42a #7 stability, extracted unchanged, below | `[]`, `[]`, `OK failing set stable and within KNOWN` | an order-dependent or leaking new test |
| 8 | `--as-of` bound, real process, below | `OK as-of bound` | any case of the bound, the message content, atomicity |
| 9 | Database failure class, real process, below | `OK failure class` | a missing, wrong or leaking code line |
| 10 | Regression: P8-42a #9 with A1, extracted, below | `OK import end to end` | a change to the 20-line stdout contract, a leak, idempotence, refusals |
| 11 | Regression: P8-42a #10 sidebar, extracted unchanged, below | `OK sidebar` | the page's nav entry disturbed |
| 12 | Regression: P8-42a #12 source guards, extracted unchanged, below | `OK source guards` | a clock or float use, a network import, an observation UPDATE |
| 13 | Regression: P8-42a #13 fixture guard, extracted unchanged, below | `OK fixtures fabricated` | a fixture added or reshaped |
| 14 | `node apps/web/scripts/gifts-surface-check.mjs; echo "exit=$?"` | lines `H1 PASS` to `H11 PASS`, then `OK H1-H11`, `exit=0` | `/travel` leaking a number, a surface regression |
| 15 | Coarse source checks, below | `OK coarse source checks` | an obvious regression of N1 or N4 even if a test were gamed |
| 16 | Scope guard for this task, below | no output | a file outside the allowed set changed, a required file missing |
| 17 | Additions-only and census guard, below | no output | a removed line in an existing test, a missing or extra new integration test title |
| 18 | `npm run build; echo "exit=$?"` | `exit=0` | a type or bundling error in the edited component |

**#4 (new unit scenarios; two zones).**
```
set -e; for TZV in UTC Pacific/Auckland; do O="$(mktemp)"; (cd apps/web && TZ=$TZV npx vitest run lib/loyaltyNits.test.ts --reporter=json --outputFile="$O") || true; node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);let bad=[];for(const id of ["U1","U2","U3"]){const m=t.filter(x=>x.title.startsWith("T42a2-"+id+":"));if(m.length!==1||m[0].status!=="passed")bad.push(id+"="+m.map(x=>x.status).join("/")+"("+m.length+")")}if(bad.length||t.length!==3||r.testResults.length!==1){console.log("FAIL",process.argv[2],bad.join(","),"tests="+t.length);process.exit(1)}console.log("OK 3 scenarios T42a2-U1..U3 each present once and passed; TZ="+process.argv[2])' "$O" "$TZV"; done
```

**#5 (regression, P8-42a #4 extracted from the frozen spec, unchanged).**
```
set -e; S=plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md; case "$(sed -n '212p' "$S")" in 'set -e; for TZV in UTC'*) ;; *) echo "FAIL P8-42a SPEC line 212 moved"; exit 1;; esac; export PRIOR_REDUCER=6; bash -c "$(sed -n '212p' "$S")"
```

**#6 (integration scenarios: P8-42a's C and I scenarios plus the three new ones, from one run).**
```
set -e; O="$(mktemp)"; (cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts --reporter=json --outputFile="$O") || true
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);let bad=[];const want=[];for(let i=1;i<=11;i++){want.push("T42a-C"+i+":","T42a-I"+i+":")}want.push("T42a2-I1:","T42a2-I2:","T42a2-I3:");for(const p of want){const m=t.filter(x=>x.title.startsWith(p));if(m.length!==1||m[0].status!=="passed")bad.push(p+m.map(x=>x.status).join("/")+"("+m.length+")")}const KNOWN=["the pre-auth ceremony endpoints remain reachable with no session cookie at all","the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio"];const unexpected=t.filter(x=>x.status==="failed"&&!KNOWN.includes(x.title)&&!x.title.startsWith("RC-03:")).map(x=>x.title);if(unexpected.length||bad.length||t.length!==324){console.log("FAIL",unexpected.join(" ; "),bad.join(","),"total="+t.length);process.exit(1)}console.log("OK 324 tests, T42a-C1-C11 and I1-I11 and T42a2-I1-I3 each present once and passed")' "$O"
```

**#7 (regression, P8-42a #7 extracted unchanged).**
```
set -e; S=plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md; case "$(sed -n '228p' "$S")" in 'set -e; A=""; for '*) ;; *) echo "FAIL P8-42a SPEC line 228 moved"; exit 1;; esac; bash -c "$(sed -n '228p' "$S")"
```

**#8 (`--as-of` bound as a real `tsx` process against `$U`; run after the throwaway DB is at head).** The dates come from Postgres inside the command.
```
set -e; U=postgresql://localhost/b8_p42a_throwaway; F=scripts/fixtures; CSV=$F/loyalty-import.fixture.csv
Q(){ psql "$U" -v ON_ERROR_STOP=1 -Atq -c "$1"; }
RUN(){ (cd apps/web && DATABASE_URL="$U" npx tsx scripts/import-loyalty.ts "$@"); }
CNT="SELECT (SELECT count(*) FROM loyalty_memberships)||','||(SELECT count(*) FROM loyalty_observations)||','||(SELECT count(*) FROM loyalty_instruments)"
STRUCT="SELECT (SELECT count(*) FROM household_members)||','||(SELECT count(*) FROM loyalty_programs)||','||(SELECT count(*) FROM loyalty_program_aliases)"
DAY(){ Q "SELECT to_char(CURRENT_DATE + ($1), 'YYYY-MM-DD')"; }
RESET(){ Q "TRUNCATE loyalty_instruments, loyalty_observations, loyalty_memberships, household_members RESTART IDENTITY CASCADE"; Q "DELETE FROM loyalty_programs WHERE name LIKE 'ZQ42A%'"; psql "$U" -v ON_ERROR_STOP=1 -q -f apps/web/scripts/fixtures/loyalty-import.seed.sql; }
EF="$(mktemp)"; D0="$(DAY 0)"; D1="$(DAY 1)"; D2="$(DAY 2)"; D3="$(DAY 3)"; D400="$(DAY 400)"
RESET; [ "$(Q "$CNT")" = "0,0,0" ]; S0="$(Q "$STRUCT")"
for bad in "$D2" "$D3" "$D400" 2999-01-01; do for mode in "" "--apply"; do
  rc=0; OUT="$(RUN --file $CSV --as-of "$bad" --default-member zq42aanna $mode 2>"$EF")" || rc=$?
  [ "$rc" = 2 ]; [ -z "$OUT" ]; [ -s "$EF" ]
  if grep -qiE 'zq42a' "$EF"; then echo "FAIL leak text for $bad"; exit 1; fi
  if grep -qE '[0-9]{4}' "$EF"; then echo "FAIL digits in message for $bad"; exit 1; fi
  if grep -qF -- "$bad" "$EF"; then echo "FAIL date echoed for $bad"; exit 1; fi
  [ "$(Q "$CNT")" = "0,0,0" ]; [ "$(Q "$STRUCT")" = "$S0" ]
done; done
for ok in "$D0" "$D1" 2000-01-01; do
  OUT="$(RUN --file $CSV --as-of "$ok" --default-member zq42aanna 2>"$EF")"
  [ "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" = 20 ]
  [ "$(printf '%s\n' "$OUT" | grep -cE '^[a-z_]+=([0-9]+(,[0-9]+)*|dry-run|apply)?$')" = 20 ]
  for l in mode=dry-run rows=12 memberships_created=12 observations_created=7 instruments_created=3 refused_program=0 refused_member=0 refused_value=0 refused_duplicate=0 conflicts=0; do printf '%s\n' "$OUT" | grep -qxF -- "$l"; done
  [ ! -s "$EF" ]; [ "$(Q "$CNT")" = "0,0,0" ]
done
RUN --file $CSV --as-of "$D1" --default-member zq42aanna --apply >/dev/null 2>"$EF"
[ ! -s "$EF" ]; [ "$(Q "$CNT")" = "12,7,3" ]; [ "$(Q "SELECT count(*) FROM loyalty_observations WHERE as_of = CURRENT_DATE + 1")" = 7 ]
RESET
RUN --file $CSV --as-of "$D0" --default-member zq42aanna --apply >/dev/null 2>"$EF"
[ ! -s "$EF" ]; [ "$(Q "$CNT")" = "12,7,3" ]; [ "$(Q "SELECT count(*) FROM loyalty_observations WHERE as_of = CURRENT_DATE")" = 7 ]
RESET; echo "OK as-of bound"
```
This leaves `$U` with the ZQ42A seed rows present and no memberships. Command 10 begins by truncating and re-seeding, as P8-42a #9 does. The tiny window around Postgres midnight, when `CURRENT_DATE` could change between the date computation and the run, is accepted as negligible and noted as a failure mode.

**#9 (database failure class as a real process; makes and drops its own empty database).**
```
set -e; U=postgresql://localhost/b8_p42a_throwaway; E=b8_p42a2_empty; F=scripts/fixtures; CSV=$F/loyalty-import.fixture.csv
dropdb --if-exists "$E"; createdb "$E"; trap 'dropdb --if-exists b8_p42a2_empty' EXIT
OF="$(mktemp)"; EF="$(mktemp)"; MSG='import could not run; nothing was changed'
try(){ local url="$1" code="$2" mode="$3" rc=0; shift 3
  (cd apps/web && DATABASE_URL="$url" npx tsx scripts/import-loyalty.ts "$@" $mode >"$OF" 2>"$EF") || rc=$?
  [ "$rc" = 1 ]; [ ! -s "$OF" ]; [ "$(cat "$EF")" = "$(printf '%s\ncode=%s' "$MSG" "$code")" ]; }
for mode in "" "--apply"; do
  try "postgresql://localhost/$E" 42P01 "$mode" --file $CSV --as-of 2026-01-15 --default-member zq42aanna
  try "postgresql://nobody@127.0.0.1:1/$E" ECONNREFUSED "$mode" --file $CSV --as-of 2026-01-15 --default-member zq42aanna
  try "postgresql://nobody@127.0.0.1:1/$E" ECONNREFUSED "$mode" --file $CSV --as-of 2999-01-01 --default-member zq42aanna
done
rc=0; (cd apps/web && env -u DATABASE_URL npx tsx scripts/import-loyalty.ts --file $CSV --as-of 2026-01-15 --default-member zq42aanna >"$OF" 2>"$EF") || rc=$?
[ "$rc" = 1 ]; [ ! -s "$OF" ]; [ "$(cat "$EF")" = "$(printf '%s\ncode=unknown' "$MSG")" ]
for bad in "--as-of 2026-01-15" "--file $F/does-not-exist.csv --as-of 2026-01-15"; do rc=0; (cd apps/web && DATABASE_URL="postgresql://nobody@127.0.0.1:1/$E" npx tsx scripts/import-loyalty.ts $bad >"$OF" 2>"$EF") || rc=$?; [ "$rc" = 2 ]; [ ! -s "$OF" ]; if grep -q 'code=' "$EF"; then echo "FAIL code line on a usage error"; exit 1; fi; done
echo "OK failure class"
```
Under `set -e`, `try` is not run in a conditional context, so a failed `[ ]` inside it aborts the command.

**#10 (regression, P8-42a #9 extracted with A1 applied, unchanged otherwise).** Extraction applies, in order, `argv[2]`→`argv[1]` then `argv[3]`→`argv[2]` to the block's two node scripts, exactly as GATES.md A1 amended them.
```
set -e; S=plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md; case "$(sed -n '233p' "$S")" in 'set -e; U=postgresql'*) ;; *) echo "FAIL P8-42a SPEC line 233 moved"; exit 1;; esac; [ "$(sed -n '288p' "$S")" = 'echo "OK import end to end"' ]; bash -c "$(sed -n '233,288p' "$S" | sed -e 's/process\.argv\[2\]/process.argv[1]/g' -e 's/process\.argv\[3\]/process.argv[2]/g')"
```
This is the stdout contract regression: 20 exact lines for dry run, apply and second apply, the leak scripts over stdout (no `ZQ42A`, no balance or fee digit string), idempotence, every refusal, and the default member. It runs with `--as-of 2026-01-15`, a past date, so N3 must leave it passing.

**#11 (sidebar).**
```
set -e; S=plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md; case "$(sed -n '294p' "$S")" in "node -e 'const s=require("*) ;; *) echo "FAIL P8-42a SPEC line 294 moved"; exit 1;; esac; bash -c "$(sed -n '294p' "$S")"
```

**#12 (source guards, P8-42a #12 unchanged).** Its `!` guards are weak under `set -e` (T16), so it is a floor and command 15 carries the real assertions.
```
set -e; S=plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md; case "$(sed -n '299p' "$S")" in 'set -e; L="$( '*) ;; *) echo "FAIL P8-42a SPEC line 299 moved"; exit 1;; esac; bash -c "$(sed -n '299p' "$S")"
```

**#13 (fixture guard, P8-42a #13 unchanged).**
```
set -e; S=plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md; case "$(sed -n '304p' "$S")" in "node -e 'const fs=require("*) ;; *) echo "FAIL P8-42a SPEC line 304 moved"; exit 1;; esac; bash -c "$(sed -n '304p' "$S")"
```

**#15 (coarse source checks, written without `!`).**
```
set -e; C=apps/web/components; T=apps/web/app/travel; S=apps/web/scripts/import-loyalty.ts
if grep -rnE 'memberNumber:[[:space:]]*blankIsNull' "$C" "$T"; then echo "FAIL blank text can null the member number"; exit 1; fi
[ "$(grep -rhE 'memberNumber:[[:space:]]*null' "$C" "$T" | wc -l | tr -d ' ')" = 1 ]
[ "$(grep -rlE 'Remove number' "$C" "$T" | wc -l | tr -d ' ')" -ge 1 ]
[ "$(grep -rlE 'member-number' "$C" "$T" | sort | tr '\n' ' ')" = "$C/LoyaltyCopyNumber.tsx " ]
if grep -nE 'err(or)?\.(stack|detail|hint)|JSON\.stringify\((err|e)\)|String\((err|e)\)' "$S"; then echo "FAIL error text handled in the import"; exit 1; fi
if grep -nE 'toISOString|new Date\(|Date\.now\(|fetch\(' "$S"; then echo "FAIL clock or network in the import"; exit 1; fi
[ "$(grep -c 'CURRENT_DATE' "$S")" -ge 1 ]; [ "$(grep -c 'code=' "$S")" -ge 1 ]
echo "OK coarse source checks"
```

**#16 (scope guard).**
```
B="$(git merge-base HEAD main)"; CH="$(mktemp)"; { git diff --name-only "$B"; git ls-files -o --exclude-standard; } | grep -v '^plan/' | sort -u > "$CH"
grep -vE '^(apps/web/components/Loyalty[A-Za-z]*\.tsx|apps/web/scripts/import-loyalty(\.test)?\.ts|apps/web/lib/loyaltyNits\.test\.ts)$' "$CH" || true
for f in apps/web/components/LoyaltyMembershipLine.tsx apps/web/scripts/import-loyalty.ts apps/web/scripts/import-loyalty.test.ts apps/web/lib/loyaltyNits.test.ts; do grep -qxF "$f" "$CH" || echo "MISSING $f"; done
```
Expected: no output. Nothing under `packages/`, `migrations/`, `db/`, `app/api/`, `lib/` (other than the one new test), `package.json`, the vitest configs or the fixtures is touched. No existing test other than `import-loyalty.test.ts` changes.

**#17 (additions-only and census guard).**
```
B="$(git merge-base HEAD main)"
git diff -U0 "$B" -- apps/web/scripts/import-loyalty.test.ts | grep -E '^-[^-]' || true
[ "$(git diff -U0 "$B" -- apps/web/scripts/import-loyalty.test.ts | grep -cE "^\+.*it\('T42a2-I[123]:")" = 3 ] || echo "WRONG NEW INTEGRATION TEST COUNT"
[ "$(grep -cE "it\('T42a2-U[123]:" apps/web/lib/loyaltyNits.test.ts)" = 3 ] || echo "WRONG NEW UNIT TEST COUNT"
```
Expected: no output.

## Negative controls
| # | Rule | Input that must be rejected or excluded | Asserted by |
|---|---|---|---|
| 1 | An empty save on the member-number editor sends no request | Drafts `''`, `'   '`, `'\t\n'`, non-breaking-space-only. A fabricated violating callback (the pre-change `blankIsNull` form, an unguarded `''`, an untrimmed `length === 0` guard) must be seen to send, so the harness is not blind | T42a2-U1, commands 3 and 4, 15 |
| 2 | The explicit clear control is the only source of `memberNumber: null` | A second `memberNumber: null` (for example in a Cancel handler), a conditional or `blankIsNull` initializer on `memberNumber` | T42a2-U2, command 15 |
| 3 | A single tap on "Remove number" removes nothing | A fabricated `Remove number` button whose own `onClick` sends the null PATCH | T42a2-U2 |
| 4 | There is nothing to remove when there is no number | A fabricated `Remove number` rendered unconditionally | T42a2-U2 |
| 5 | A non-empty save still saves (the fix is not "never send") | Drafts `'ZQ42A-NUM-0001'` and `'  ZQ42A-NUM-0001 '` must each record exactly one PATCH | T42a2-U1 |
| 6 | Other editors keep clearing behaviour | The tier editor still sends `{tier: null}` for a blank draft; a second `startEmpty` user or a member-number editor without `startEmpty` is rejected | T42a2-U3 |
| 7 | The full number and the copy path stay confined | Any file other than `LoyaltyCopyNumber.tsx` naming `/member-number`; the clear handler naming it | T42a2-U2, command 15, command 5 (U9) |
| 8 | `--as-of` later than `CURRENT_DATE + 1` is refused, in both modes | Dates `+2`, `+3`, `+400` days and `2999-01-01`, each dry and `--apply` | T42a2-I1, command 8 |
| 9 | The refusal writes nothing and says nothing about the data | After each refusal, counts `0,0,0` and structure unchanged; stdout empty; stderr non-empty with no `ZQ42A`, no four-digit run, no echo of the date | T42a2-I1, command 8 |
| 10 | The boundary dates are accepted (no off-by-one) | `CURRENT_DATE` and `CURRENT_DATE + 1` accepted dry, and applied (12/7/3 written with the matching `as_of`); a past date accepted (no lower bound) | T42a2-I1, command 8 |
| 11 | The bound is read from the database | The wrapped `deps.db` must have been asked a query text containing `CURRENT_DATE`; no JS clock in the script | T42a2-I1, commands 12 and 15, 5 (U9) |
| 12 | A database failure prints a code and never text | Errors whose message, detail, hint and stack contain a canary; a real 42P01; a real ECONNREFUSED | T42a2-I2, T42a2-I3, command 9 |
| 13 | Only a SQLSTATE- or errno-shaped code is printed | A code equal to canary text, a numeric code, a thrown string, a thrown `null`, an error without a code: all give `code=unknown` | T42a2-I2, command 9 (unset `DATABASE_URL` case) |
| 14 | The code line goes to stderr only and stdout stays empty on failure | Any stdout line on a failed run | T42a2-I2, T42a2-I3, command 9 |
| 15 | A usage error is not a database failure | Missing `--file`, a nonexistent file, with the database unreachable: exit 2, no `code=` line | T42a2-I3(d), command 9 |
| 16 | A future date with an unreachable database is a database failure, not a usage refusal | `--as-of 2999-01-01` against the closed port: exit 1, `code=ECONNREFUSED` | T42a2-I3(c), command 9 |
| 17 | The success path is silent on stderr and the 20-line stdout is unchanged | Any `code=` line or other stderr text on a good run; any change to the stdout contract | T42a2-I1, T42a2-I2 control, commands 8 and 10 |
| 18 | No scope creep | A change to the API, contract, migration, fixtures, other components or other scripts | commands 16, 17 |

## Evidence required
- The verbatim final `OK` lines of commands 4 (both zones), 5 (both zones), 6, 7, 8, 9, 10, 11, 12, 13, 15, the full output of command 14, empty output of 16 and 17, and the `exit=` lines of 1, 2 and 18. Also the measured T-rows, including BASE, LINT_BASE and the 321-test integration baseline.
- A transcript of the real runs, stderr verbatim, for four cases: a `+2` refusal, an empty-database failure (`code=42P01`), a closed-port failure (`code=ECONNREFUSED`), and a run with `DATABASE_URL` unset (`code=unknown`).
- A mutation log. Each mutation is applied one at a time and reverted with the tree's checksum unchanged. The named scenarios and commands must fail, then pass after the revert.
  - Restore `blankIsNull(t)` on the member-number save: T42a2-U1, T42a2-U2, command 15.
  - Guard on `t.length === 0` without trim: T42a2-U1.
  - Add a second `memberNumber: null` in a Cancel handler: T42a2-U2, command 15.
  - Make the `Remove number` button's `onClick` send the PATCH directly: T42a2-U2.
  - Render `Remove number` when there is no number: T42a2-U2.
  - Pre-fill the member-number editor with the mask: T42a2-U3.
  - Change the bound to `>= CURRENT_DATE + 1`: T42a2-I1, command 8.
  - Change the bound to `> CURRENT_DATE + 2`: T42a2-I1, command 8.
  - Apply the bound only in dry run: T42a2-I1, command 8.
  - Compute the bound with the JS clock: commands 12 and 15, and 5's U9.
  - Echo the date in the refusal: T42a2-I1, command 8.
  - Exit 1 instead of 2 on the refusal: T42a2-I1, command 8.
  - Print `err.message` on failure: T42a2-I2, T42a2-I3, command 9.
  - Print the raw `code` without the shape check: T42a2-I2.
  - Print the code line on stdout: T42a2-I2, T42a2-I3, command 9.
  - Omit the code line on the apply path: T42a2-I3, command 9.
  - Map a database failure on the bound read to exit 2: T42a2-I3(c), command 9.
  - Drop the null-safety so a thrown `null` crashes: T42a2-I2.
- A statement of the limits.
  - (1) The page components are not rendered in a browser or jsdom (T21 is NO). The empty-save guard is proved by extracting and executing the `onSave` callback with stubs. The clear control's confirm step, its conditional rendering and its tap behaviour are proved by AST checks only. The implementer's phone-width and desktop screenshots against a scratch demo database with fabricated data are required, and none is committed if it shows a figure-like string.
  - (2) The `Enter`-key and button-submit paths of `LoyaltyInlineText` share one `save`, and are not independently exercised.
  - (3) The ECONNREFUSED code is verified for a plain address (`127.0.0.1:1`). Node's multi-address `AggregateError` shape for `localhost` is not asserted.
- A statement of which docs under `node_modules/next/dist/docs/` were read and that the `uiux-promax` skill was invoked.
- A scan of EVIDENCE.md and the commit messages for dollar figures, comma-grouped numbers and real data: none.
- A note for the orchestrator. P8-42a's `!`-style guards in its #9 `want` pattern check and in its #12 are weak under `set -e` (T16). Their regression runs are a floor, and commands 8, 9 and 15 assert the same absences explicitly.

## Failure modes to test
- **N1.**
  - The guard added to a disabled Save button or a `required` attribute, while Enter still submits an empty form.
  - A guard that trims in the display but sends the untrimmed whitespace.
  - A whitespace-only draft treated as non-empty.
  - A `length === 0` check without trim.
  - Success returned as an error string for an empty save, leaving the editor open with a message and a request sent.
  - A fix that pre-fills the mask and no-ops when unchanged, so saving the mask text could write bullets back.
  - A clear control that sends on the first tap.
  - A clear control shown when no number is stored.
  - A "Cancel" or "Keep" that sends the null PATCH.
  - The confirm handler reusing `blankIsNull`, so any blank value could null the number.
  - A second `memberNumber: null` elsewhere in the page.
  - The clear control reaching the `/member-number` route.
  - The tier, name, description or date editors accidentally given the new guard, so a deliberate blank clear stops working.
  - The Copy action left visible after the number is cleared (the existing `memberNumberMasked !== null` gate must still hold).
  - The page not refreshing after a confirmed removal.
- **N3.**
  - The comparison made in JavaScript or in UTC, so the accepted date moves with the machine's time zone.
  - `>=` instead of `>` (tomorrow refused), or `+ 2` slack.
  - The bound checked only inside the `--apply` branch, or only after `BEGIN`.
  - The refusal returned as exit 1, or printed with the supplied date, the bound, or the table's content.
  - A far-future date reaching `readState` or a write before being refused.
  - A usage error with the database unreachable turned into a database failure (a regression of the existing order).
  - A past date accidentally refused (a lower bound).
  - The date cast failing with a driver error for a syntactically valid but unusual date such as `0001-01-01` or `9999-12-31`, which would surface as `code=…` instead of a refusal. Postgres's date range holds both, so it must not.
  - A midnight crossing between computing the test's date and the script's read, which could turn `CURRENT_DATE + 2` into an accepted date. The window is milliseconds, and no command waits across midnight.
- **N4.**
  - `err.message`, `String(err)`, `err.stack`, `err.detail` or `err.hint` printed or logged.
  - A `code` that is not a string, or is a string of any other shape, printed verbatim.
  - A crash on a thrown `null`, `undefined` or string, because `.code` was read without a guard.
  - The code line printed on stdout, or printed on a successful run.
  - A code on the inner catch only, with the entry point's outer catch printing the old line alone.
  - A rollback failure hiding the original error's code.
  - Exit code changed from 1.
  - A usage error given a `code=` line.
  - An apply-time error whose class is lost because the code is read after `client.release()` or the rollback replaced the error.
  - `unknown` replaced by an empty code.
  - A stderr line count other than two, so an extra diagnostic line slips in.
  - A tsx or Node warning on stderr, which would make an exact-equality check fail for an unrelated reason. Command 9 would then fail on the unmodified code too, and the orchestrator should see that at T13.

## Rollback
Revert the commit. This task has no migration, no schema change and no contract change, so nothing else is needed. The import script change is stateless: it holds no data and leaves no table or file. The client change is a pure UI edit and stores nothing. After a revert the empty-save hazard and the lack of an `--as-of` bound and of a code line return exactly as they were at `194f049`. A member number removed through the new control while the change was live is not restorable by a revert. The owner can retype it, or restore it from a backup of `loyalty_memberships`.
