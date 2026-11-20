# P8-42a-loyalty-model-page-import — gate log

Append-only. Every decision, the command run, and its output.

## G0 — spec gate — 2026-11-19 — FAIL (cycle 0, spec-writer fault, not counted)

First draft assumed the import reads a CSV the owner reshapes into `member,program` columns, and an
availability vocabulary (`available`/`issued`/`unused`) that the owner's sheet does not use (it uses
`yes`/`no`/`-`). Checked against the owner's sheet (viewed locally, never committed): the real export
has one label column combining program and member, a `$`-prefixed cash cell, and `-` placeholders.
Owner chose "read the sheet as-is"; unnamed rows belong to the owner (`--default-member`). Returned to
the spec-writer with the sheet's shape described generically, and with its five unverified code facts
to resolve.

## G0 — spec gate — 2026-11-19 — PASS

Spec persisted from the spec-writer's second final message by script (lines 1–493: heading through
Rollback). One orchestrator edit at persistence: the spec-writer's own caveman note flagged a
superseded first draft of command 9 (with a wrong `instruments_created=2`) left in the text above the
corrected block; that draft and the two sentences about it were deleted, leaving only the corrected
command under the `#9` heading. `grep -c "instruments_created=2\|I need to restate"` → `0`.

**Owner decisions.** Q1, Q2, Q4–Q10 accepted at defaults (owner, in chat). Q3 replaced by the owner's
availability rule. Q11–Q13 (dash account cell is null; blank rows skipped but numbered; default member
explicit) taken at the spec's defaults: the owner said "run it in auto mode, take spec defaults".

**Amendment A0 (orchestrator, before freeze) — command 7.** The stability check compared the full failing
set across two runs; RC-03 is the known order-dependent flake (hold H9) and would fail it for a reason
unrelated to this task. RC-03 is now excluded from the comparison (still permitted to fail). The
measured integration baseline had no failures at all, so the amendment cannot hide a new one.

**Risk tier: full pipeline.** New domain, migration, contract, page, eleven routes, a script that writes.

**Toolchain (measured under bash, unmodified tree at `2ec09e3`):**
T1 `1`. T2 `receipt_captures|` (throwaway DB `b8_p42a_throwaway` migrated to head). T3 `ECONNREFUSED`
(exported `DATABASE_URL` wins). T4 `1`. T5 **BASE = 99 files, 1393 tests**, all passed. T6 `exit=0`
(with `--incremental false`). T7 **LINT_BASE = 0 errors, 5 warnings**, `exit=0`. T8 integration: 299
tests, failed `[]` (⊆ KNOWN). T9 `tsx v4.23.15`, `exit=0`. T10 `1`. T11 `1`. T12 `1`. T13 `exit=0`.
T14 `0`. T15 `exit=0`. T16 `-780`. T17 `2ec09e3c3b433746f0fb7081d0597562a172b33b`. T18 first run hung
fetching Google Fonts (process idle with two open HTTPS connections to a Google host, `.next/lock` held,
no progress for ten minutes); killed and re-run: `exit=0`. T19 `H1 PASS … H10 PASS`, `OK H1-H10`, `exit=0`. **T20 PRIOR_REDUCER = 6.** T21 `2`.

**Vacuity checks run on the unmodified tree** (each must fail, and for the right reason):
#5 exits non-zero at the new-migration count; #10 `FAIL order … /properties /gifts …`; #12 exits
non-zero (`L` empty); #14 lists every required file and route as `MISSING` plus `WRONG ROUTE COUNT`;
#4, #6, #9, #11, #13 depend on files that do not exist yet. A stub implementation would fail #4 and #6
on the scenario-id census (each of U1–U10, C1–C11, I1–I11 must be present once and passed) and #9 on
exact count lines from a real `tsx` process.

**Real-label coverage** (owner's 29 labels, kept in the session scratchpad only, never in the repo):
checked at G2 against the migrated catalog's aliases.

**Frozen** 2026-11-19: `touch plan/tasks/P8-42a-loyalty-model-page-import/.frozen`; Status line set to FROZEN.

## G1 — contract gate — 2026-11-19 — PASS

Guardian deliverables: `migrations/1792700000000_loyalty.sql` (new), `db/schema.sql` (+152 lines, additions
only), `packages/contracts/loyalty.ts` (new), `packages/contracts/index.ts` (+1 line), `CONTRACT.md`.
Change class **additive**; no existing table or migration touched (`git diff --stat -- migrations db packages`
shows only `db/schema.sql` and `index.ts` modified; the migration and `loyalty.ts` are new).

- **#5 (migrate up → down → up, schema lists all 6 tables):** `OK 1 new migration; down removes every loyalty
  table; up restores them; schema.sql lists all 6 tables`, rc 0.
- **#16 (contract guard):** `packages/contracts/index.ts`, `packages/contracts/loyalty.ts`, then no output.
  (`loyalty.test.ts` is the implementer's U7 file; test files under `packages/contracts/` are exempt from the
  scope guard.)
- **tsc** `--incremental false`: `exit=0` — every existing consumer compiles.
- **Catalog:** airline 30, car 3, card_currency 6, hotel 11, travel_cash 1 (51 programs); 227 aliases.
- **Constraint probes** (one transaction, rolled back): `1.5 points`, `-1 points`, `1.005 usd`, unit `yen` →
  each `violates check constraint`; a second member whose name differs only in case → `duplicate key …
  household_members_display_name_ci`; `25.50 usd` accepted.
- **Money columns:** `balance` is `NUMERIC` with a per-unit scale CHECK (scale 0 for whole units, exactly 2 for
  `usd`) rather than `NUMERIC(p,2)`, so whole-unit balances print without decimals and `balance::text` is
  canonical. Accepted: the scale is stated and enforced, which is what §5.3 asks.
- **No figures:** `grep -nE '\$[0-9]'` over the migration, the contract and CONTRACT.md → no hits.
- **Real-label coverage (private, scratchpad only):** the owner's 29 sheet labels, normalised by the spec's
  rule and stripped of a member suffix → `labels=29 resolved=29 unresolved_rows=`. Done at G1, not G2, because
  the catalog is frozen with the contract.
- **Guardian departures, accepted:** plain `CREATE TABLE` form in `db/schema.sql` (command #5 greps it); a
  separate Hawaiian program; program-name uniqueness not enforced (aliases are); "avios" not an alias (shared
  currency); length bounds chosen; the alias leading-symbol rule lives in the app's normaliser.

Lease closed after this entry.

## G2 — build gate — 2026-11-19 — PASS (cycle 0)

**Amendment A1 (command #9), adjudicated by command.** The implementer reported #9 failing in its own leak check
(`ENAMETOOLONG … open 'mode=apply …`). Claim: under `node -e` the first extra argument is `process.argv[1]`, so
the spec's `process.argv[2]`/`[3]` read the captured stdout as the file path. Discriminating command:
`node -e 'console.log(JSON.stringify(process.argv.slice(1)))' first second` → `["first","second"]`. Claim
confirmed; the defect is in the command, not the implementation. Amendment: in #9's CSVJS and LEAK scripts only,
`process.argv[2]` → `[1]` and `process.argv[3]` → `[2]`; nothing else changed. Not caught at G0 because #9 cannot
run before the import script exists.

**Every acceptance command re-run by the orchestrator** (bash, `PRIOR_REDUCER=6`, DB `b8_p42a_throwaway`;
full raw output kept in the session scratchpad, verdict lines verbatim here):
- #1 `exit=0`
- #2 `✖ 5 problems (0 errors, 5 warnings)`, `exit=0` (= LINT_BASE)
- #3 `Test Files  102 passed (102)`, `Tests  1403 passed (1403)` (BASE + 3 files, + 10 tests)
- #4 `OK 10 scenarios U1-U10 each present once and passed; latestValueByKey tests >= 6; TZ=UTC` and the same for `TZ=Pacific/Auckland`
- #5 `OK 1 new migration; down removes every loyalty table; up restores them; schema.sql lists all 6 tables`
- #6 `OK 321 tests, C1-C11 and I1-I11 each present once and passed`
- #7 `[]`, `[]`, `OK failing set stable and within KNOWN`
- #8 `package.json:1`, `apps/web/package.json:1`
- #9 (A1) `leak-free tokens=14`, `leak-free tokens=14`, `OK import end to end`
- #10 `OK sidebar`
- #11 `H1 PASS` … `H11 PASS /travel and /api/v1/loyalty as both users: 200, label and masked suffix present, the 18-character number absent in any case`, `OK H1-H11`, `exit=0`
- #12 `OK source guards`
- #13 `OK fixtures fabricated`
- #14 no output
- #15 no output
- #16 `packages/contracts/index.ts`, `packages/contracts/loyalty.test.ts`, `packages/contracts/loyalty.ts`, then no output
- #17 `exit=0`; route list includes `/travel` and the eleven `/api/v1/loyalty/**` routes

**Diff surface** (`git status --short`, reviewed line by line): only the spec's declared files, plus `plan/` records.
`AGENTS.md` not dirty.

**Figures.** `$`-digit matches in non-test code are SQL placeholders (`$1`…). Test files and the CSV fixtures
carry the spec's fabricated `ZQ42A` fixture values (G0-approved: the `$` and thousands-separator rules cannot be
tested without them). No comment or prose carries one.

**Visual check** (implementer's screenshots, phone 390 and desktop 1440, scratch DB, not committed): sidebar order
Properties → Nights & Miles → Gifts; a membership without a reading shows `—`; numbers masked `••••` + suffix with a
Copy action; source badge and as-of date per line.

**For the reviewer** (from the implementer, not yet verified): mutation M23 (API accepting thousands separators)
was killed by U2 but not by C3 — hypothesis: the request schema refuses the separator before the store parser runs.
U10 used a different ambiguous-member pair than the spec text, because the spec's pair cannot be ambiguous under
its own whole-word rule. C6 compares the overview body (no accounts GET route exists).

## G3 — adversarial gate — 2026-11-19 — PASS (cycle 0)

REVIEW-1: **ACCEPT_WITH_NITS**, 27 hypotheses (23 refuted, 3 confirmed as NITs, 1 inconclusive + 1 header
check), no BLOCK, no scope violation. Six NITs recorded in NITS.md; N1 and N3 queued as `P8-42a2-loyalty-nits`.

**Inconclusive items converted to commands and run:**
1. zod built-in messages echoing a submitted value (would be a BLOCK against "Member-number handling").
   Reviewer's toy schema: enum → `"Invalid option: expected one of \"points\"|\"usd\""`, literal →
   `"Invalid input: expected \"typed\""`, unrecognised key → `"Unrecognized key: \"ZQ42A-NUM-0001-ZZ\""` (names the
   client's own key; acceptable). Then against the real contract: a throwaway `tsx` probe (deleted after the run)
   fed the canary into eleven fields of every exported `Loyalty*Request*Schema` →
   `schemas=9 issues=253 echoes=0`. **Refuted; no BLOCK.**
2. `grep -n -i "cache-control" apps/web/proxy.ts apps/web/next.config.*` → no hits. N6 stands as a NIT.

## G4 — integration gate — 2026-11-19 — PASS

Code tree unchanged since the G2 run (only `plan/` records since). Fresh runs: unit suite `Test Files  102 passed
(102)` / `Tests  1403 passed (1403)`; lint 0 errors (warnings = LINT_BASE). G2's #1 (tsc), #5 (migrate round-trip on
the throwaway), #6/#7 (integration, 321 tests, failing set `[]` twice), #11 (gift surfaces H1–H11) and #17 (build)
stand for the same tree. Additionally, a never-used database `b8_p42a_fresh` migrated from empty to head (`…
1792700000000_loyalty`, `Migrations complete!`), down one (0 errors), up again (`Migrations complete!`), dropped.
Truthfulness: C6 (net worth deep-equal, accounts/valuations checksums, overview byte-equal with loyalty rows
present) is in the G2 integration run. INCONCLUSIVE items: both converted to commands and run at G3. No real
data in the diff, fixtures or logs (`ZQ42A` fixtures; owner's labels checked only from the scratchpad).

**Cycle count:** 0 / 3. **MERGED.**
