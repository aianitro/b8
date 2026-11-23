# P8-42c2 — Evidence

Implementer's evidence bundle. Everything is uncommitted on `main`. Every acceptance command was extracted
fresh from `SPEC.md` (with Amendment A3 applied to command 13), saved unchanged to a scratch file, and
run in its own `/bin/bash` from the repo root, in the order 1 to 4, 5, then the rest. Before running
them:

- the iCloud dataless count was 0 over `apps/web`, `packages`, `migrations`, `db` and `node_modules`;
- `ANTHROPIC_*` and `LOYALTY_IMAP_*` were unset;
- `PRIOR_REDUCER=6` was exported;
- port 3198 was free.

## Status

**Two of the nineteen commands do NOT pass as written: #4 and #13.** Each fails on a contradiction in the
spec itself, described below. I have reported both and not routed around either. Every other command
prints its expected verdict.

| # | Verdict as printed | Result |
|---|---|---|
| 1 | `exit=0` | pass |
| 2 | `OK lint 0 errors, warnings not above 5` | pass |
| 3 | `OK unit 111 files 1427 tests` | pass |
| 4 | *(no output, exit 1)* | **FAIL**: spec conflict C1 |
| 5 | `OK migration up-down-up` | pass |
| 6 | `OK schema` | pass |
| 7 | `OK 6 scenarios T42c2-U1..U6 each present once and passed; TZ=UTC`, then the same line with `TZ=Pacific/Auckland` | pass |
| 8 | `OK 370 tests, … T42c2-I1-I14 each present once and passed`, `OK no fixture rows left` | pass |
| 9 | `[]`, `[]`, `OK failing set stable and within KNOWN` | pass |
| 10 | all OK lines, `fixture shape ok`, `OK fixtures pinned and covered`, `OK classes` | pass |
| 11 | `H1 PASS` … `H15 PASS`, `OK H1-H15`, `OK surface` | pass |
| 12 | `OK two registry lines added, none changed` | pass |
| 13 | *(no output apart from two `grep` notices, exit 1)* | **FAIL**: spec conflict C2 |
| 14 | *(no output, exit 0)* | pass |
| 15 | `OK existing tests edited only as allowed; removed lines 12` | pass |
| 16 | `fixture shape ok`, `OK fixtures pinned and covered` | pass |
| 17 | `OK mutation evidence rows 27` | pass |
| 18 | `OK spec has no money-looking text` | pass |
| 19 | `exit=0` | pass |

### C1: command 4 expects three SDK importers, but the tree at HEAD already has four

Command 4 requires the files importing `@anthropic-ai/sdk` to be exactly:

```
apps/web/lib/categorySuggester.ts apps/web/lib/loyaltyReader.ts apps/web/lib/receiptReader.ts
```

`apps/web/app/api/v1/chat/route.ts` has imported the SDK (`import Anthropic from '@anthropic-ai/sdk';`,
line 2) since well before this task; its last change is commit `6472c64`. This task does not touch it, and
`git status` shows it clean. The expected list therefore cannot match without editing a file outside the
declared surface.

Diagnostic only, not acceptance evidence. I changed nothing but the comparison on that one line, to print the list
instead, in a scratch copy of the command:

```
apps/web/app/api/v1/chat/route.ts apps/web/lib/categorySuggester.ts apps/web/lib/loyaltyReader.ts apps/web/lib/receiptReader.ts 
OK dependencies
```

All other checks in command 4 pass: no dependency change, and `imapflow` and `mailparser` each have their
single expected importer.

### C2: the page must print `ANTHROPIC_API_KEY`, and only the reader may name it

Two parts of the spec cannot both hold for any component:

- **The page must print it.** "Visible text" (SPEC.md line 126) requires the text `ANTHROPIC_API_KEY`
  on the page when `readable` is false. T42c2-U6 (line 630) requires each fixed string of "Visible text"
  to occur in a non-test component source. H15 checks it over HTTP.
- **Only the reader may name it.** SPEC.md line 58 and command 13 lines 24 to 25 allow exactly one file
  among this task's changed `apps/web/(lib|components|app)` sources to name `ANTHROPIC_API_KEY`:
  `apps/web/lib/loyaltyReader.ts`.

Every component that could print the text is new or changed, so it falls in command 13's scan. Line 25
fails with:

```
AK='apps/web/components/LoyaltyInboxReadPanel.tsx apps/web/lib/loyaltyReader.ts '
```

There were two ways to make line 25 pass, and I took neither:

- **Pass the name down as a prop.** The text would come from `loyaltyReader.ts` through
  `app/travel/page.tsx`. That fails U6's literal requirement and so needs U6 weakened.
- **Split the literal in the component.** That evades the scan.

Both are workarounds the orchestrator should rule on, not something an implementer should pick.

Diagnostic only, not acceptance evidence: a scratch copy of command 13 with only line 25 disabled.

```
grep: apps/web/components/*.tsx: No such file or directory
grep: apps/web/components/*.tsx: No such file or directory
OK task source guards
```

Every other guard in command 13 passes. The two `grep` notices come from a separate observation, O1.

### Observations (not failures)

- **O1: two checks in command 13 never see a file.** Command 13 starts with `set -ef`. `-f` turns off
  pathname expansion, so `apps/web/components/*.tsx` on lines 31 and 34 is passed to `grep` as a literal
  name. Both checks therefore inspect no file: line 31 (server-only imports in components) and line 34
  (`member_number`, `raw_mail` and `dangerouslySetInnerHTML` in components). T42c2-U6 covers both
  properties through the AST; the shell checks do not.
- **O2: the surface script needs a blank key.** `next dev` loads `apps/web/.env.local` for every variable
  the process lacks. Deleting `ANTHROPIC_API_KEY` from the server's environment therefore let a local key
  back in, and H15 failed with "lacks `Reading mail is not set up`". The script now sets the variable
  blank, which `.env.local` never replaces and which the reader treats as not set up. No key reached any
  response; H15 also scans its 19 responses for one.
- **O3: one person cannot hold two memberships of one program.** The fixture's `surface` group gives one
  person two memberships of the same program, but `loyalty_memberships` is `UNIQUE (member_id,
  program_id)`. The test seeding and H15 therefore create one household member per fixture membership,
  named after the fixture person and the membership id. No rule reads who holds a membership, so no
  assertion depends on this.
- **O4: the HTTP client opens an idle socket after an aborted call.** In T42c2-I10's timeout half, the
  client opens a fresh socket with no request on it after the abort. The test counts requests (sockets
  on which bytes arrived), not sockets. The first half, with immediate destroy, counts connections as the
  spec says.

## Docs read and skills invoked

Docs, under `node_modules/next/dist/docs/01-app/`:

- `03-api-reference/03-file-conventions/route.md`, Reference through Route Context Helper: `context.params`
  is a Promise; `request` is a `NextRequest`; body via `request.json()` / `request.text()`.
- `01-getting-started/05-server-and-client-components.md`, the sections "Passing data from Server to
  Client Components" (serialisable props) and "Preventing environment poisoning" (non-`NEXT_PUBLIC_`
  variables are blank on the client, so the key is reported only as the boolean `readable`).
- `01-getting-started/15-route-handlers.md`: searched for the handler signature only, not read in full.

Skills invoked: `caveman` (for the final report only), `claude-api` (model ids, server-side fallback
beta, `output_config` effort and JSON schema, request options), and `uiux-promax`.

**Palette.** The new components follow the files they sit in, not the skill's tokens: `gray-*` text and
borders, `blue-600`/`blue-700` buttons, and `amber-50`/`amber-200` for the "not set up" box. Every one of
these classes is already used in the 42c1 inbox panel or the other loyalty components.

## Migration up/down/up log

Command 5 runs up, down and up with the tool's output discarded and printed `OK migration up-down-up`. A
separate down/up on the same throwaway database, with the tool's output kept:

```
head before: 1793100000000_loyalty_inbox_read
--- migrate:down
### MIGRATION 1793100000000_loyalty_inbox_read (DOWN) ###
-- Down Migration
-- Drops the three read tables and nothing else. No program, membership, observation (including
-- every 'email' observation a read appended), instrument, inbox message or ledger row is touched;
-- indexes, constraints and the state row go with their tables. NOT LOSSLESS: take the \copy
-- backups in the header first, and revert the application code before running this so nothing
-- queries a missing table. The reads table first: it is the only one holding foreign keys to
-- tables that stay.
DROP TABLE loyalty_inbox_reads;
DROP TABLE loyalty_inbox_not_mine;
DROP TABLE loyalty_inbox_read_state;
;
DELETE FROM "public"."pgmigrations" WHERE name='1793100000000_loyalty_inbox_read';
Migrations complete!
head after down: 1793000000000_loyalty_inbox
--- migrate:up
### MIGRATION 1793100000000_loyalty_inbox_read (UP) ###
-- Up Migration
(the migration's SQL as committed; omitted here)
INSERT INTO "public"."pgmigrations" (name, run_on) VALUES ('1793100000000_loyalty_inbox_read', NOW());
Migrations complete!
head after up: 1793100000000_loyalty_inbox_read
```

## Decision table (the `decisions` fixture, as T42c2-U3 and T42c2-I3 assert it)

| Case id | State | Reason | Observation appended |
|---|---|---|---|
| apply-ok | applied | — | yes |
| apply-ok-usd | applied | — | yes |
| apply-zero-from-zero | applied | — | yes |
| no-balance-null | no_balance | — | no |
| no-balance-unit-null | no_balance | — | no |
| expiry-only | no_balance | — | no |
| program-mismatch | pending | program_mismatch | no |
| program-not-stated | applied | — | yes |
| suffix-none | pending | no_suffix | no |
| suffix-short | pending | no_suffix | no |
| suffix-unmatched | pending | unmatched_suffix | no |
| suffix-unmatched-known-not-mine | not_mine_known | — | no |
| suffix-ambiguous | pending | ambiguous_suffix | no |
| suffix-other-program-only | pending | unmatched_suffix | no |
| unit-mismatch | pending | unit_mismatch | no |
| as-of-missing | pending | no_as_of | no |
| as-of-future | pending | as_of_future | no |
| as-of-equal-stale | stale | — | no |
| as-of-older-stale | stale | — | no |
| no-baseline-none | pending | no_baseline | no |
| no-baseline-zero | pending | no_baseline | no |
| jump-over-up | pending | implausible_jump | no |
| jump-over-down | pending | implausible_jump | no |
| jump-at-boundary-up | applied | — | yes |
| jump-at-boundary-down | applied | — | yes |
| zero-from-positive-queued | pending | implausible_jump | no |
| injection-obedient-jump | pending | implausible_jump | no |
| injection-obedient-wrong-suffix | pending | unmatched_suffix | no |
| injection-obedient-within-bound | applied | — | yes |

## Model decision record (OQ1)

Constants as implemented in `apps/web/lib/loyaltyReader.ts`:

- `MODEL = 'claude-opus-5-5'`.
- `FALLBACK_MODEL = 'claude-opus-4-8'`, used as the server-side fallback on a policy refusal through the
  beta `server-side-fallback-2026-07-01`.
- `output_config` with effort `'medium'` and a `json_schema` format (`READ_SCHEMA`).
- `MAX_TOKENS = 8192`, the receipt reader's setting, kept as the floor.
- One non-streaming `beta.messages.create` per attempt, with the request options
  `{ maxRetries: 0, timeout: seconds * 1000 }`. The client is also built with `maxRetries: 0`.
- `seconds` is `LOYALTY_READ_TIMEOUT_SECONDS` read at call time: a whole number from 1 to 600, and any
  other value means 60.

Effort is `medium` because pulling a few fields from a short mail needs little reasoning; the
deterministic rules after the read, not model depth, are the safety. The timeout is 60 seconds because
a short single request normally finishes in seconds, and the per-run budget cuts off a run of stalls.

## Residual risk (OQ17, reproduced from SPEC.md)

A spoofed mail from an allowlisted sender domain **will be applied automatically** when it carries all of:

- a suffix matching exactly one real membership of that program;
- a newer as-of date;
- the stored unit;
- a balance within 50 percent of the stored one.

Repeated mails with increasing dates can drift a balance step by step. There is no cumulative guard and no
undo UI; a typed reading corrects it.

Anyone who can mail the inbox can also fill the queue with unmatched-suffix items, and cause Anthropic
calls up to the per-run cap per day. The queue is bounded by the per-run cap and cleared by one
`Not mine` tap per suffix.

The suffix is an attacker-guessable value of 3 or 4 characters, so the match is a consistency check, not
authentication. Mitigations are out of scope here: sender authentication, DKIM or SPF are in 42c1's stated
non-goals.

**Counts read, applied and queued: not measured.** This task made no real run: no real key and no real
mail were used, by design. After the first real day, they come from:

```
SELECT count(*) FILTER (WHERE state NOT IN ('retry', 'failed')) AS read,
       count(*) FILTER (WHERE state IN ('applied', 'applied_by_hand')) AS applied,
       count(*) FILTER (WHERE state = 'pending') AS queued
  FROM loyalty_inbox_reads;
```

## Loopback connection count (T42c2-I10)

From `npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyRead.test.ts`
against the throwaway database:

```
T42c2-I10 loopback connections: 1
      Tests  14 passed (14)
```

## Mutation evidence

**Method.** A scratch script ran each mutation as follows:

1. Apply exactly one textual replacement in one source file.
2. Run the named test alone with `-t '<id>:'`: unit tests with the unit config, integration tests with
   the integration config against the throwaway database.
3. Restore the file from a copy taken before the mutation, and confirm byte-identity with `filecmp`.
4. Re-run the first named test green.

The "Tests" column quotes vitest's own summary line.

**Every row below failed, and every file was restored byte-identical.** Every after-revert run printed
`Tests  1 passed`.

**Two named pairs the spec lists did not fail**, and they are deliberately not given rows:

- **M3 under T42c2-I3** (`Tests  1 passed | 13 skipped (14)`). The frozen `decisions` fixture holds no
  case whose printed suffix occurs inside a stored number but not at its end, so `includes` and
  `endsWith` agree on every I3 case. T42c2-U3, run over the `suffix` group, does catch it.
- **M16 under T42c2-I10** (`Tests  1 passed | 13 skipped (14)`). The reader sets `maxRetries: 0` both on
  the client and on the request, so dropping either one alone still makes no retry. M16b removes both and
  fails I10: `AssertionError: expected 3 to be 1`, which is three connections against one.

| Id | File and change | Failing test | Result | After |
|---|---|---|---|---|
| M1 | `lib/domain/loyaltyRead.ts`: the jump rule's strictly-greater comparison becomes greater-or-equal | T42c2-U3 | FAIL | reverted, green |
| M1 | same change | T42c2-I3 | FAIL | reverted, green |
| M2 | `lib/domain/loyaltyRead.ts`: strictly-newer as-of becomes not-older (`<=` to `<` in the stale test) | T42c2-U3 | FAIL | reverted, green |
| M2 | same change | T42c2-I3 | FAIL | reverted, green |
| M3 | `lib/domain/loyaltyRead.ts`: the suffix is matched anywhere in the number (`includes`) instead of at its end | T42c2-U3 | FAIL | reverted, green |
| M4 | `lib/domain/loyaltyRead.ts`: an ambiguous suffix picks the first match (`=== 1` to `>= 1`) | T42c2-I3 | FAIL | reverted, green |
| M5 | `lib/domain/loyaltyRead.ts`: the not-mine record is applied before the match, even when a membership matches | T42c2-I6 | FAIL | reverted, green |
| M5 | same change | T42c2-U3 | FAIL | reverted, green |
| M6 | `lib/loyaltyInboxRead.ts`: a refusal is no longer terminal, so it is retried instead of being isolated as failed | T42c2-I4 | FAIL | reverted, green |
| M7 | `lib/loyaltyInboxRead.ts`: the attempt is no longer counted before the model call | T42c2-I4 | FAIL | reverted, green |
| M8 | `lib/loyaltyInboxRead.ts`: `rate_limited` no longer stops the run | T42c2-I4 | FAIL | reverted, green |
| M9 | `lib/loyaltyInboxRead.ts`: the read lock is never unlocked before the client returns to the pool | T42c2-I5 | FAIL | reverted, green |
| M10 | `lib/loyaltyInboxRead.ts`: a queue action without the resolved-state check | T42c2-I5 | FAIL | reverted, green |
| M10 | same change | T42c2-I6 | FAIL | reverted, green |
| M11 | `lib/domain/loyaltyRead.ts`: the clean pass keeps the printed number as free text instead of the short suffix | T42c2-I7 | FAIL | reverted, green |
| M12 | `lib/domain/loyaltyRead.ts`: decimals on a whole unit are cut to a whole number instead of rejected | T42c2-U2 | FAIL | reverted, green |
| M13 | `lib/domain/loyaltyInbox.ts`: the header lines, `To` included, are added to what the reader receives | T42c2-I14 | FAIL | reverted, green |
| M13 | same change | T42c2-U4 | FAIL | reverted, green |
| M14 | `lib/domain/loyaltyInbox.ts`: links are left in the text sent to the reader | T42c2-U4 | FAIL | reverted, green |
| M15 | `lib/loyaltyInboxRead.ts`: the queue suffix is emitted without its mask | T42c2-I9 | FAIL | reverted, green |
| M16 | `lib/loyaltyReader.ts`: SDK retries left at the default on the request | T42c2-U5 | FAIL | reverted, green |
| M16b | `lib/loyaltyReader.ts`: `maxRetries: 0` removed from both the client and the request (two lines, see above) | T42c2-I10 | FAIL | reverted, green |
| M17 | `lib/loyaltyInboxRead.ts`: the retention purge uses `<=` instead of `<` | T42c2-I11 | FAIL | reverted, green |
| M18 | `lib/loyaltyInboxRead.ts`: the auto-applied observation is written with source `typed` | T42c2-I2 | FAIL | reverted, green |
| M19 | `lib/loyaltyInboxRead.ts`: coverage is derived from the state (applied or not) instead of whether the read carried a balance | T42c2-I11 | FAIL | reverted, green |
| M20 | `app/api/v1/loyalty/inbox/read/route.ts`: the read route accepts a read-scope token (only a 401 is returned early) | T42c2-I6 | FAIL | reverted, green |
| M21 | `lib/domain/loyaltyRead.ts`: a program mismatch is ignored | T42c2-I3 | FAIL | reverted, green |
| M22 | `lib/domain/loyaltyRead.ts`: a mail without a balance is queued | T42c2-I3 | FAIL | reverted, green |

## Verbatim output of the acceptance commands

The integration log lines (JSON objects that start with `{"time"`, all about fabricated fixtures) are
left out of #8 and #9 here. Everything else is verbatim, except H13 in #11: there, point figures are
replaced with `[n]`, because this file is public and a figure cannot be told apart from a real one.

**#1**
```
exit=0
```

**#2**
```

✖ 5 problems (0 errors, 5 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

OK lint 0 errors, warnings not above 5
```

**#3**
```
 Test Files  111 passed (111)
      Tests  1427 passed (1427)
   Start at  23:05:25
   Duration  9.51s (tests 66%, import 23%, transform 10%, worker 2%)

    Isolate  111 workers spawned · ~182ms startup each (spawn + environment, per file)
             at least ~2.71s faster with isolate: false — reuses workers across files instead of one per file

OK unit 111 files 1427 tests
```

**#4**: exit 1, no output (see C1).

**#5**
```
OK migration up-down-up
```

**#6**
```
OK schema
```

**#7**
```
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.Yveu5qD1EL
OK 6 scenarios T42c2-U1..U6 each present once and passed; TZ=UTC
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.QArwVKoUIN
OK 6 scenarios T42c2-U1..U6 each present once and passed; TZ=Pacific/Auckland
```

**#8**: re-run after the last test-file change (the I10 count line now goes to stdout).
```
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.za0zDkOOwH
OK 370 tests, T42a-C1-C11 and I1-I11 and T42a2-I1-I3 and T42b-I1-I10 and T42b2-I1-I10 and T42c1-I1-I12 and T42c2-I1-I14 each present once and passed
OK no fixture rows left
```

**#9**: re-run after the same change. The lines that matter, from an output of about three thousand lines
of test logging:
```
[]
[]
OK failing set stable and within KNOWN
```

**#10**
```
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.QQdAnvJkz1
OK 7 scenarios T42c1-U1..U7 each present once and passed; TZ=UTC
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.QjVjTBe2Ma
OK 7 scenarios T42c1-U1..U7 each present once and passed; TZ=Pacific/Auckland
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.QlwMJwTX2V
OK 10 scenarios U1-U10 each present once and passed; latestValueByKey tests >= 6; TZ=UTC
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.bqDYoguREj
OK 10 scenarios U1-U10 each present once and passed; latestValueByKey tests >= 6; TZ=Pacific/Auckland
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.HACvTshnw5
OK 3 scenarios T42a2-U1..U3 each present once and passed; TZ=UTC
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.3Yhx9irBrV
OK 3 scenarios T42a2-U1..U3 each present once and passed; TZ=Pacific/Auckland
NOTICE:  truncate cascades to table "loyalty_earn_rules"
NOTICE:  truncate cascades to table "household_member_addresses"
NOTICE:  truncate cascades to table "loyalty_inbox_messages"
NOTICE:  truncate cascades to table "loyalty_inbox_reads"
NOTICE:  truncate cascades to table "loyalty_earn_rules"
NOTICE:  truncate cascades to table "household_member_addresses"
NOTICE:  truncate cascades to table "loyalty_inbox_messages"
NOTICE:  truncate cascades to table "loyalty_inbox_reads"
NOTICE:  truncate cascades to table "loyalty_earn_rules"
NOTICE:  truncate cascades to table "household_member_addresses"
NOTICE:  truncate cascades to table "loyalty_inbox_messages"
NOTICE:  truncate cascades to table "loyalty_inbox_reads"
OK as-of bound
NOTICE:  database "b8_p42a2_empty" does not exist, skipping
OK failure class
NOTICE:  truncate cascades to table "loyalty_earn_rules"
NOTICE:  truncate cascades to table "household_member_addresses"
NOTICE:  truncate cascades to table "loyalty_inbox_messages"
NOTICE:  truncate cascades to table "loyalty_inbox_reads"
leak-free tokens=14
leak-free tokens=14
OK import end to end
OK sidebar
apps/web/lib/loyaltyInbox.ts:231:    const raw = await source.fetch(env.id);
apps/web/lib/loyaltyInboxSource.ts:139:  fetch(id: string): Promise<Buffer>;
apps/web/lib/loyaltyReader.ts:1:import Anthropic from '@anthropic-ai/sdk';
apps/web/lib/loyaltyInboxSource.ts:26:// This file may use `new Date(` and `toISOString` to bridge imapflow's Date values to ISO text and
apps/web/lib/loyaltyInboxSource.ts:226:        const uids = await client.search({ since: new Date(`${since}T00:00:00Z`) }, { uid: true });
apps/web/lib/loyaltyInboxSource.ts:235:            receivedAt: new Date(m.internalDate ?? 0).toISOString(),
OK source guards
OK fixtures fabricated
OK coarse source checks
fixture shape ok
fixture shape ok
OK fixtures pinned and covered
OK classes
```

**#11**
```
H1 PASS 22 page.tsx files on disk, all 22 classified (8 text-bearing)
H2 PASS 22 pages as the recipient: all 200, 0 hold the canary in any case; /transactions lists the ordinary row and the label Gift
H3 PASS the giver sees the canary on /transactions, /accounts/zq41b_check_card, /categories/Fabricated%20Gift%20Shelf, /dashboard, /properties/1
H4 PASS with the reveal date yesterday the recipient sees the canary on all 5 pages; moved back, masked again
H5 PASS recipient searches (full, prefix, payee) render the nonsense block {"count":"0","rows":0}; the amount finds the Gift row; the giver's search finds 1
H6 PASS merchant rule on the gift's payee counts 0 rows for the recipient and 1 for the giver; its Plaid category row is absent for the recipient and present for the giver
H7 PASS 24 alternating giver/recipient requests over 6 pages and routes: each viewer always got their own answer; API bodies byte-identical per viewer
H8 PASS dev-server output (7511 bytes): 0 lines hold the canary in any case, besides 3 access-log lines echoing this script's own search URLs
H9 PASS RSC: 1 /transactions as the recipient: 13716 bytes, ordinary row present, canary absent
H10 PASS giver's /gifts lists the gift and its criterion; recipient's lists none and holds no criterion; the Gifts nav entry is present for both
H11 PASS /travel and /api/v1/loyalty as both users: 200, label and masked suffix present, the 18-character number absent in any case
H12 PASS both users, 8 steps over /travel, /accounts/zq41b_check_card and /api/v1/loyalty: a gift-held fee is no fee for either; revealed, fee date 2026-11-17 and expected by 2027-01-01 (Postgres dates), then overdue, received, no state without a benefit, and no Earns into once unlinked; the held row's name and amount appear on neither /travel nor the API
H13 PASS both users, 8 fixture steps over /travel, /accounts/zq41b_check_card and /api/v1/loyalty: estimate [n] points since 2026-11-02 (reading) with the held row excluded for both, counted once revealed, excluded again when held; comparison 2026-11-02 to 2026-11-17 estimated [n] reported [n] ([n]%, worth a look false); cleared and unlinked show no figure; the held row's name and the payment, fee and held amounts appear on neither /travel nor the API
H14 sample Loyalty inbox | Raw mail is kept 30 days, then deleted. | Check inbox now | Not checked yet | Mail from unknown senders: 3 | attacker.test × 2 | other-sender.test × 1 | Forwarding | ZQ42A Surface Member: no forwarding address set | Edit forwarding addresses | ZQ42B Surface Member: no forwarding address set | Edit forwarding addresses | ZQ42B2 Surface Member: no forwarding address set | Edit forwarding addresses | ZQ42C Surface Anna: last mail 2026-11-20 | zq42c-anna@example.com | Edit forwarding addresses | ZQ42C Surface Quiet: forwarding quiet for 46 days | zq42c-boris@example.net | Edit forwarding addresses | Reading stored mail | Reading mail is not set up | Set ANTHROPIC_API_KEY on the server; stored mail waits, unread, until then. | Not read yet
H14 PASS both users, /travel and /api/v1/loyalty before and after the poll: the panel shows 9 phrases, the unauthenticated poll is 401, the owner's poll is 200 error connect_failed against a closed loopback port, /travel then shows the failed check; 10 responses hold none of the body canary, the password, the user or the loopback host
H15 PASS both users, /travel and /api/v1/loyalty: 21 phrases present and 2 absent with reading not set up; the read route is 200 disabled for the owner, 401 with no cookie and 403 for a read-scope token; apply on the unique item is 200, reaches the membership's balance in the API and on /travel, and a second apply is 409; the ambiguous item refuses another program's membership with 400; not mine and ignore empty the queue; 19 responses hold no full member number, key or loopback host
OK H1-H15
OK surface
```

**#12**
```
OK two registry lines added, none changed
```

**#13**: exit 1, no output (see C2).

**#14**: no output, exit 0.

**#15**
```
OK existing tests edited only as allowed; removed lines 12
```

**#16**
```
fixture shape ok
OK fixtures pinned and covered
```

**#17**
```
OK mutation evidence rows 27
```

**#18**
```
OK spec has no money-looking text
```

**#19**: `npm run build; echo "exit=$?"`. The build's route table is left out.
```
✓ Compiled successfully in 19.3s
exit=0
```
