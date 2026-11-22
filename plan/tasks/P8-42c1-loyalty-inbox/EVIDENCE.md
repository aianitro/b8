# EVIDENCE — P8-42c1 loyalty inbox

Implementer's evidence bundle. Every block below is verbatim output captured from a plain run
(no `rtk`), on `main`, uncommitted, against `postgresql://localhost/b8_p42a_throwaway` at head
`1793000000000_loyalty_inbox`, with `PRIOR_REDUCER=6` exported and no `LOYALTY_IMAP_` variable in the
environment. The iCloud dataless check (`find . ../../packages -path ./node_modules -prune -o -type f
-flags dataless -print | wc -l` from `apps/web`) printed `0` before the runs. Each acceptance command
was extracted verbatim from SPEC.md's code blocks into a file and run with `bash`; the trailing
`status=` line is the exit code the harness appended. Temporary paths are shown as `$TMPDIR` and
`$SCRATCH`.

## Cycle 2 — fixes for REVIEW-1 (G3 BLOCK, cycle 1)

This section supersedes the cycle-1 verdicts below; the cycle-1 sections are kept as history.
Amendment A3 changed command 13 (`/fixtures/` excluded from the PW and RM scans, and the error-text
guard also refuses `).message`) and command 14 (it no longer requires `.env.local.example`), which
resolves cycle-1 conflicts 1, 2 and 7. Every command was re-extracted from the amended SPEC.md and
run plainly, in order, after the fixes; the iCloud dataless check printed `0` first. All 18 pass.

### What changed

1. **BLOCK 1, a message the parser refuses aborted the poll** (`apps/web/lib/loyaltyInbox.ts`).
   `analyseMessage` (both the outer parse and the inner parse of a member's forwarded original) now
   runs inside a per-message `try`. A rejection is recorded with `unknown(key, receivedOn, null)`, so
   it is counted under `(unreadable)` with its dedupe key, and the walk continues. A message with a
   Message-ID is therefore never downloaded again. One without a Message-ID is keyed on its bytes and
   re-fetched while it is in the window, the same as F16 under A3.4, but it is counted once.
2. **NIT 2, the size cap depended on the server reporting a size.** `MailEnvelope.size` is now
   `number | null`, and the adapter maps a missing RFC822.SIZE to `null`, never to 0. The adapter's
   `fetchOne` asks for `source: { maxLength: LOYALTY_INBOX_MAX_BYTES + 1 }`. imapflow sends that as a
   partial `BODY.PEEK[]<0.n>`, so the seen flag is still untouched. After the fetch, the poller
   treats `raw.length > LOYALTY_INBOX_MAX_BYTES` as oversize: the truncated bytes are dropped, and the
   message is recorded without bytes, or counted unknown, through the same path as a listed oversize
   message. `envelopeKey` accepts a null size.
3. **NIT 3, an unbounded `close()` could hold the lock.** The poller now waits at most
   `CLOSE_WAIT_MS` (the adapter's bound plus one second) for `source.close()`, then releases the lock
   whatever the close did. The adapter's own `close()` races `client.logout()` against
   `CLOSE_BOUND_MS` (three seconds), then calls `client.close()` to drop the socket in every case.

Not addressed, because the coordinator's list did not include it: **NIT 4**, a member PATCH racing a
poll can leave a message `unmatched`.

### Tests (no new `it`; the counts and ids pinned by commands 8 and 16 are unchanged)

- **T42c1-I2** gains a message whose envelope reports no size and whose bytes are one over the cap.
  It is fetched, stored with `raw_mail` NULL and `oversize` true, and counted as oversize. A re-poll
  counts it as a duplicate.
- **T42c1-I3** gains two cases:
  - **A hanging close.** The fake's `close()` never settles after a stalled list. The poll still
    resolves as `timeout`, and the next poll is `ok`, which shows the lock was released.
  - **Two poison messages, built inline from fabricated ZQ42C and `.test` data.** One is an
    allowlisted message with 1001 parts. The other is a member's forward whose attached original has
    1001 parts. Both are first shown to make `analyseMessage` reject. A poll of
    [poison, forward, good] then:
    - answers `ok`;
    - stores the good message;
    - counts both poison messages unknown under `(unreadable)` with their keys, and stores neither;
    - records the state `ok`.

    A re-poll downloads nothing and counts three duplicates.

### Proving mutations (each applied, caught, reverted byte-identical)

R3's cascade into later tests is expected: the hanging close keeps the lock held for the rest of the
file. Afterwards, command 8's leftover query printed `0,0,0,0,0,0,0`.

```
### R1 the per-message parse guard removed (BLOCK 1)
file: apps/web/lib/loyaltyInbox.ts
-     try {
      analysis = await analyseMessage(raw, (a) => memberOf.has(a));
    } catch {
      await unknown(key, receivedOn, null);
      continue;
    }
+     analysis = await analyseMessage(raw, (a) => memberOf.has(a));
catching command: cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +|Test timed out" | sort -u
      Tests  1 failed | 11 passed (12)
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I3: a re-poll stores and counts nothing again, two polls never overlap, and every failure is a classified code that frees the lock
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
reverted byte-identical: True (9eed324c14b00f81)

### R2 the post-fetch length check removed (NIT 2)
file: apps/web/lib/loyaltyInbox.ts
-     if (raw.length > LOYALTY_INBOX_MAX_BYTES) { await oversize(); continue; }

+ 
catching command: cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +|Test timed out" | sort -u
      Tests  1 failed | 11 passed (12)
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I2: over the whole fixture set the allowlist keeps exactly the expected mail, downloads only what it may, and records it as the table says
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
reverted byte-identical: True (9eed324c14b00f81)

### R2b an unknown size read as 0 (NIT 2)
file: apps/web/lib/loyaltyInbox.ts
- if (env.size !== null && env.size > LOYALTY_INBOX_MAX_BYTES)
+ if ((env.size ?? 0) > LOYALTY_INBOX_MAX_BYTES)
-     if (raw.length > LOYALTY_INBOX_MAX_BYTES) { await oversize(); continue; }

+ 
catching command: cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +|Test timed out" | sort -u
      Tests  1 failed | 11 passed (12)
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I2: over the whole fixture set the allowlist keeps exactly the expected mail, downloads only what it may, and records it as the table says
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
reverted byte-identical: True (9eed324c14b00f81)

### R3 the close bound removed (NIT 3)
file: apps/web/lib/loyaltyInbox.ts
-     if (source !== null) await closeWithin(source, CLOSE_WAIT_MS);
+     if (source !== null) await source.close().catch(() => {});
catching command: cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +|Test timed out" | sort -u
      Tests  8 failed | 4 passed (12)
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I10: the poll route refuses a read token and no session, answers the contract shape for every outcome, and leaves the ledger as it was
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I11: the real adapter against a closed loopback port fails as connect_failed, records it, frees the lock and leaks nothing
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I12: nothing derived from the mail is stored, the five tables have the contract columns, and only the inbox tables move
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I3: a re-poll stores and counts nothing again, two polls never overlap, and every failure is a classified code that frees the lock
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I4: stored mail is attributed through the tiers, an added address re-attributes what was unmatched, and no date moves back
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I5: retention deletes exactly what is older than 30 days, in both tables, on the daily step and after every poll, and nothing else
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I7: coverage shows the last mail seen and the count in the window, null as null, and the unknown senders by count, capped
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I8: no raw body, subject, member number, password, user or host leaves the server, and the inbox carries exactly the contract keys
Error: Test timed out in 30000ms.
Error: Test timed out in 5000ms.
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 8 ⎯⎯⎯⎯⎯⎯⎯
reverted byte-identical: True (9eed324c14b00f81)
```

Residual, unverified: whether real imapflow `logout()` can hang against a live server is not
exercised by any test. The adapter's own bound is covered by reading only. The poller's bound is
tested, and it is the one that releases the lock.

### Cycle 2 verbatim verdict lines, commands 1 to 18

### 1
```
exit=0
status=0
```
### 2
```
OK lint 0 errors, warnings not above 5
status=0
```
### 3
```
OK unit 108 files 1421 tests
status=0
```
### 4
```
package files ok
OK dependencies
status=0
```
### 5
```
OK migration up-down-up
status=0
```
### 6
```
OK schema
status=0
```
### 7
```
OK 7 scenarios T42c1-U1..U7 each present once and passed; TZ=UTC
OK 7 scenarios T42c1-U1..U7 each present once and passed; TZ=Pacific/Auckland
status=0
```
### 8
```
OK 356 tests, T42a-C1-C11 and I1-I11 and T42a2-I1-I3 and T42b-I1-I10 and T42b2-I1-I10 and T42c1-I1-I12 each present once and passed
OK no fixture rows left
status=0
```
### 9
```
[]
[]
OK failing set stable and within KNOWN
status=0
```
### 10
```
OK 10 scenarios U1-U10 each present once and passed; latestValueByKey tests >= 6; TZ=UTC
OK 10 scenarios U1-U10 each present once and passed; latestValueByKey tests >= 6; TZ=Pacific/Auckland
OK 3 scenarios T42a2-U1..U3 each present once and passed; TZ=UTC
OK 3 scenarios T42a2-U1..U3 each present once and passed; TZ=Pacific/Auckland
OK as-of bound
OK failure class
OK import end to end
OK sidebar
OK source guards
OK fixtures fabricated
OK coarse source checks
fixture shape ok
status=0
```
### 11
```
(H1 to H13 shortened to their step names, figure rule: H1 PASS, H2 PASS, H3 PASS, H4 PASS, H5 PASS, H6 PASS, H7 PASS, H8 PASS, H9 PASS, H10 PASS, H11 PASS, H12 PASS, H13 PASS)
H14 sample Loyalty inbox | Raw mail is kept 30 days, then deleted. | Check inbox now | Not checked yet | Mail from unknown senders: 3 | attacker.test × 2 | other-sender.test × 1 | Forwarding | ZQ42A Surface Member: no forwarding address set | Edit forwarding addresses | ZQ42B Surface Member: no forwarding address set | Edit forwarding addresses | ZQ42B2 Surface Member: no forwarding address set | Edit forwarding addresses | ZQ42C Surface Anna: last mail 2026-11-19 | zq42c-anna@example.com | Edit forwarding addresses | ZQ42C Surface Quiet: forwarding quiet for 46 days | zq42c-boris@example.net | Edit forwarding addresses | Sender domains · 52 programs | AAdvantage | aa.com | No mail seen yet · 0 in the last 30 days
H14 PASS both users, /travel and /api/v1/loyalty before and after the poll: the panel shows 9 phrases, the unauthenticated poll is 401, the owner's poll is 200 error connect_failed against a closed loopback port, /travel then shows the failed check; 10 responses hold none of the body canary, the password, the user or the loopback host
OK H1-H14
OK surface
status=0
```
### 12
```
OK classes
OK one registry line added, none changed
status=0
```
### 13
```
OK task source guards
status=0
```
### 14
```
status=0
(no output before the status line: the expected "no output")
```
### 15
```
OK existing tests edited only as allowed; removed lines 9
status=0
```
### 16
```
fixture shape ok
OK fixtures pinned and covered
status=0
```
### 17
```
OK env example
status=0
```
### 18
```
exit=0
status=0
```

## Cycle 1 (history)

## Verdicts at a glance

| # | Verdict |
|---|---|
| 1 | PASS `exit=0` |
| 2 | PASS `OK lint 0 errors, warnings not above 5` (the 5 warnings are pre-existing; `eslint` over every file this task touched reports none) |
| 3 | PASS `OK unit 108 files 1421 tests` |
| 4 | PASS `OK dependencies` |
| 5 | PASS `OK migration up-down-up` |
| 6 | PASS `OK schema` |
| 7 | PASS, both zones |
| 8 | PASS `OK 356 tests, …` and `OK no fixture rows left` |
| 9 | PASS `[]`, `[]`, `OK failing set stable and within KNOWN` |
| 10 | PASS, the eleven OK lines and `fixture shape ok` |
| 11 | PASS `OK H1-H14`, `OK surface` |
| 12 | PASS `OK classes`, `OK one registry line added, none changed` |
| **13** | **FAIL — exits 1 with no output.** A conflict inside the frozen spec, not a code defect; see "Spec conflicts" 1 |
| **14** | **FAIL — prints `MISSING .env.local.example`** (the expected output is none). A conflict with `.gitignore`; see "Spec conflicts" 2 |
| 15 | PASS `OK existing tests edited only as allowed; removed lines 9` |
| 16 | PASS `OK fixtures pinned and covered` |
| 17 | PASS `OK env example` |
| 18 | PASS `exit=0` |

## Verbatim output

### 1
```
exit=0
status=0
```
### 2
```
✖ 5 problems (0 errors, 5 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

OK lint 0 errors, warnings not above 5
status=0
```
### 3
```
 Test Files  108 passed (108)
      Tests  1421 passed (1421)
   Start at  23:46:52
   Duration  9.16s (tests 65%, import 22%, transform 11%, worker 1%)

    Isolate  108 workers spawned · ~186ms startup each (spawn + environment, per file)
             at least ~2.69s faster with isolate: false — reuses workers across files instead of one per file

OK unit 108 files 1421 tests
status=0
```
### 4
```
package files ok
OK dependencies
status=0
```
### 5
The command sends the migration runner's own output to `/dev/null`, so its verdict line is the up,
down, up log: it migrates up, asserts the five tables' columns, the seeds and the 33 refusals, migrates
down (the five tables gone, `loyalty_earn_rules` and the fixture program and member kept), and migrates
up again.
```
OK migration up-down-up
status=0
```
Afterwards: `SELECT name FROM pgmigrations ORDER BY id DESC LIMIT 2` gives `1793000000000_loyalty_inbox`,
then `1792900000000_loyalty_earn_rules`.
### 6
```
OK schema
status=0
```
### 7
```
JSON report written to $TMPDIR/tmp.Q38DhMqdbI
OK 7 scenarios T42c1-U1..U7 each present once and passed; TZ=UTC
JSON report written to $TMPDIR/tmp.BZvjFmVEnn
OK 7 scenarios T42c1-U1..U7 each present once and passed; TZ=Pacific/Auckland
status=0
```
### 8 (verdict lines; the vitest progress output is omitted)
```
OK 356 tests, T42a-C1-C11 and I1-I11 and T42a2-I1-I3 and T42b-I1-I10 and T42b2-I1-I10 and T42c1-I1-I12 each present once and passed
OK no fixture rows left
status=0
```
### 9 (verdict lines; the pre-existing suites' fabricated `[reid-dump …]` diagnostics are omitted)
```
[]
[]
OK failing set stable and within KNOWN
status=0
```
### 10
```
JSON report written to $TMPDIR/tmp.2GedDy3L7P
OK 10 scenarios U1-U10 each present once and passed; latestValueByKey tests >= 6; TZ=UTC
JSON report written to $TMPDIR/tmp.O6GAe3RIFE
OK 10 scenarios U1-U10 each present once and passed; latestValueByKey tests >= 6; TZ=Pacific/Auckland
JSON report written to $TMPDIR/tmp.SaPHC3SzTi
OK 3 scenarios T42a2-U1..U3 each present once and passed; TZ=UTC
JSON report written to $TMPDIR/tmp.Q1XC0uO2tt
OK 3 scenarios T42a2-U1..U3 each present once and passed; TZ=Pacific/Auckland
NOTICE:  truncate cascades to table "loyalty_earn_rules"
NOTICE:  truncate cascades to table "household_member_addresses"
NOTICE:  truncate cascades to table "loyalty_inbox_messages"
NOTICE:  truncate cascades to table "loyalty_earn_rules"
NOTICE:  truncate cascades to table "household_member_addresses"
NOTICE:  truncate cascades to table "loyalty_inbox_messages"
NOTICE:  truncate cascades to table "loyalty_earn_rules"
NOTICE:  truncate cascades to table "household_member_addresses"
NOTICE:  truncate cascades to table "loyalty_inbox_messages"
OK as-of bound
NOTICE:  database "b8_p42a2_empty" does not exist, skipping
OK failure class
NOTICE:  truncate cascades to table "loyalty_earn_rules"
NOTICE:  truncate cascades to table "household_member_addresses"
NOTICE:  truncate cascades to table "loyalty_inbox_messages"
leak-free tokens=14
leak-free tokens=14
OK import end to end
OK sidebar
apps/web/lib/loyaltyInbox.ts:222:    const raw = await source.fetch(env.id);
apps/web/lib/loyaltyInboxSource.ts:129:  fetch(id: string): Promise<Buffer>;
apps/web/lib/loyaltyInboxSource.ts:26:// This file may use `new Date(` and `toISOString` to bridge imapflow's Date values to ISO text and
apps/web/lib/loyaltyInboxSource.ts:216:        const uids = await client.search({ since: new Date(`${since}T00:00:00Z`) }, { uid: true });
apps/web/lib/loyaltyInboxSource.ts:225:            receivedAt: new Date(m.internalDate ?? 0).toISOString(),
OK source guards
OK fixtures fabricated
OK coarse source checks
fixture shape ok
status=0
```
### 11
The H1 to H13 lines are shortened to their step names here. H13's line quotes the points figures of
the earn fixture, and AGENTS.md keeps money-looking figures out of tracked files; re-run the command
to see them. Each was `PASS`, once: H1 PASS, H2 PASS, H3 PASS, H4 PASS, H5 PASS, H6 PASS, H7 PASS, H8 PASS, H9 PASS, H10 PASS, H11 PASS, H12 PASS, H13 PASS. The H14 lines are verbatim:
```
H14 sample Loyalty inbox | Raw mail is kept 30 days, then deleted. | Check inbox now | Not checked yet | Mail from unknown senders: 3 | attacker.test × 2 | other-sender.test × 1 | Forwarding | ZQ42A Surface Member: no forwarding address set | Edit forwarding addresses | ZQ42B Surface Member: no forwarding address set | Edit forwarding addresses | ZQ42B2 Surface Member: no forwarding address set | Edit forwarding addresses | ZQ42C Surface Anna: last mail 2026-11-18 | zq42c-anna@example.com | Edit forwarding addresses | ZQ42C Surface Quiet: forwarding quiet for 46 days | zq42c-boris@example.net | Edit forwarding addresses | Sender domains · 52 programs | AAdvantage | aa.com | No mail seen yet · 0 in the last 30 days
H14 PASS both users, /travel and /api/v1/loyalty before and after the poll: the panel shows 9 phrases, the unauthenticated poll is 401, the owner's poll is 200 error connect_failed against a closed loopback port, /travel then shows the failed check; 10 responses hold none of the body canary, the password, the user or the loopback host
OK H1-H14
OK surface
status=0
```
### 12
```
OK classes
OK one registry line added, none changed
status=0
```
### 13
```
status=1
```
### 14
```
MISSING .env.local.example
status=0
```
### 15
```
OK existing tests edited only as allowed; removed lines 9
status=0
```
### 16
```
fixture shape ok
OK fixtures pinned and covered
status=0
```
### 17
```
OK env example
status=0
```
### 18 (its last lines)
```
ƒ  (Dynamic)  server-rendered on demand

exit=0
status=0
```
`next build` needed no `serverExternalPackages` entry, so `apps/web/next.config.ts` is unchanged.

## Spec conflicts and flags for the orchestrator

1. **Command 13 cannot pass on the pinned tree.** Its line
   `PW="$(grep -rlF 'LOYALTY_IMAP_PASSWORD' apps/web/lib … | grep -vE '\.test\.ts$|gifts-surface-check\.mjs$' …)"`
   also finds `apps/web/lib/fixtures/loyalty-inbox/cases.json`. That file is pinned by the SHA-256 in
   command 16, and its `envMatrix` names the variable. So `PW` is
   `apps/web/lib/fixtures/loyalty-inbox/cases.json apps/web/lib/loyaltyInboxSource.ts `, the equality
   fails, and `set -e` exits 1 silently (shown under `bash -x`). Neither file may change. As a
   diagnostic only, a copy that adds `|/fixtures/` to the two exclusion patterns (the `PW` and `RM`
   lines) prints `OK task source guards`. The diagnostic copy differs from command 13 only by:

   ```
   19c19
   < PW="$(grep -rlF 'LOYALTY_IMAP_PASSWORD' apps/web/lib apps/web/app apps/web/components apps/web/scripts | grep -vE '\.test\.ts$|gifts-surface-check\.mjs$' | sort | tr '\n' ' ')"
   ---
   > PW="$(grep -rlF 'LOYALTY_IMAP_PASSWORD' apps/web/lib apps/web/app apps/web/components apps/web/scripts | grep -vE '\.test\.ts$|gifts-surface-check\.mjs$|/fixtures/' | sort | tr '\n' ' ')"
   21c21
   < RM="$(grep -rlF 'raw_mail' apps/web/lib apps/web/app apps/web/components apps/web/scripts | grep -vE '\.test\.ts$|gifts-surface-check\.mjs$' | sort | tr '\n' ' ')"
   ---
   > RM="$(grep -rlF 'raw_mail' apps/web/lib apps/web/app apps/web/components apps/web/scripts | grep -vE '\.test\.ts$|gifts-surface-check\.mjs$|/fixtures/' | sort | tr '\n' ' ')"
   ```

   Every other guard in the
   command passes, including the money-looking-figure scan of added comment lines. The mutation log
   below uses that diagnostic copy wherever it names "command 13". Suggested fix (orchestrator's
   call): exclude `/fixtures/` in those two lines.
2. **Command 14 cannot see `.env.local.example`.** `.gitignore:40` is `.env*`, so
   `git ls-files -o --exclude-standard` omits the file and the required-file loop prints
   `MISSING .env.local.example`. The file exists, holds the seven empty variables, and command 17
   passes on it. It is not tracked at HEAD. Making it visible needs a `.gitignore` negation or a forced
   `git add`; both are outside this task's surface and index, so neither was done.
3. **F16 and I3's "no fetch at all".** F16 has no `Message-ID`, so its dedupe key is a hash of its
   bytes. A re-poll therefore has to fetch F16 again to recognise it. T42c1-I3 asserts that the
   second poll fetches exactly `['F16']` and counts 26 duplicates and 1 expired, storing nothing.
4. **The dedupe key of a never-downloaded message with no `Message-ID`** (unknown or oversize) is not
   specified. It is `sha256('envelope:' + id + ':' + receivedAt + ':' + size)` (`envelopeKey`).
5. **Contract test line in T42b2-U2.** In `packages/contracts/loyalty.test.ts`, T42b2-U2's overview
   fixture gained `inbox: EMPTY_INBOX`. This is the same edit the spec allows for the enumerated
   fixtures, and CONTRACT.md's "any other overview fixture" covers it, but the spec does not list that
   line. Command 15 accepts it.
6. **SPEC.md's money grep.** `grep -cE "[0-9]+\.[0-9]{2}\b" plan/tasks/P8-42c1-loyalty-inbox/SPEC.md`
   prints `2`, not `0`. The matching lines are 273 and 373. Both are the A1 version numbers
   (`2.11.0`, `3.14.2`), which are not money. SPEC.md is frozen.
7. **Command 13's error-text regex** (`err(or)?\.message|…`) does not match `(err as Error).message`.
   Mutation B5 used that form; command 13 passed it, and T42c1-I1, I3 and I8 caught it. Not a
   defect of this code; noted as a gap in the guard.
8. **A member's oversize forward** has no allowlisted envelope sender. It is counted as unknown under
   the forwarder's domain, never downloaded. **Re-attribution keeps the stored origin**: it re-reads
   a forwarded original only for a message already stored as forwarded.
9. **Unit date tokens.** The pure U2 to U5 have no database. They replace `{{DAY:-n}}` with one
   fixed RFC 2822 text, because nothing they assert depends on a date. The integration suite uses
   Postgres-computed dates throughout.

## Mutation log

Each mutation is applied by a script that does an exact single-occurrence replacement, then runs the
catching command, then writes the original bytes back. Afterwards it prints the SHA-256 prefix of the
file and whether it is byte-identical. Mutations M7, M7b, M8 (first half), M11 and B5 (first half)
run command 13 through the diagnostic copy described in conflict 1. B13 temporarily renames one
fabricated account on the throwaway database, and the script restores the name. After both batches, the command 8
leftover query printed `0,0,0,0,0,0,0` and `git status` was unchanged.

Every mutation was caught. The spec's list maps to: substring match M1; display name M2; Reply-To
M4 (Sender M4b); forward from a non-member M3; skipping dedupe B1; recounting unknowns B2;
downloading an unknown B3; marking seen M7b (writable open M7); storing the subject, see below;
library error text B5; password in the overview B6 (password in a log M8); retention M5; quiet
threshold M6; deleting `last_seen_on` B7; rolling `last_received_on` back B8; reassigning a matched
message B9; a shared provider B10; never releasing the lock B11 (no lock at all M10, the double
store); a read-scope poll B12; a ledger write B13; raw bytes for an oversize message B14; the daily
job rejecting B15; a raw body in an API response M9; a JS clock M11.

**Storing the subject was not run as a mutation.** No column can hold it: command 6 forbids any
`subject` / `header` / `text` column, the schema is frozen, and every existing text column has a
CHECK that a subject fails (domain shape, the enums). T42c1-I12 asserts the exact non-null column
set of every stored row. A mutation would need a schema edit, which the hook blocks.

### Batch 1
```
### M1 substring domain match
file: apps/web/lib/domain/loyaltyInbox.ts
- if (d === s.domain || d.endsWith(`.${s.domain}`)) {
+ if (d.includes(s.domain)) {
catching command: cd apps/web && npx vitest run lib/domain/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  lib/domain/loyaltyInbox.test.ts > the loyalty inbox, pure (P8-42c1) > T42c1-U2: sender domains are validated by the contract rules and matched by equality or a dot-suffix, longest first
      Tests  1 failed | 3 passed (4)
reverted byte-identical: True (6836057e7709227c)

### M2 From display-name trusted
file: apps/web/lib/domain/loyaltyInbox.ts
- return normaliseLoyaltyInboxEntry(parsed[0].address);
+ return normaliseLoyaltyInboxEntry(/@/.test(parsed[0].name ?? '') ? (parsed[0].name as string) : parsed[0].address);
catching command: cd apps/web && npx vitest run lib/domain/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  lib/domain/loyaltyInbox.test.ts > the loyalty inbox, pure (P8-42c1) > T42c1-U3: only the address of the From header is the sender, and an unreadable sender is classified
      Tests  1 failed | 3 passed (4)
reverted byte-identical: True (6836057e7709227c)

### M3 forwarded original honoured from a non-member
file: apps/web/lib/domain/loyaltyInbox.ts
- const member = isRegistered(registered, outerFrom);
+ const member = outerFrom !== null;
catching command: cd apps/web && npx vitest run lib/domain/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  lib/domain/loyaltyInbox.test.ts > the loyalty inbox, pure (P8-42c1) > T42c1-U4: a forwarded original is recovered from an attachment or an inline block, and only from a registered member
      Tests  1 failed | 3 passed (4)
reverted byte-identical: True (6836057e7709227c)

### M4 Reply-To trusted over From
file: apps/web/lib/domain/loyaltyInbox.ts
- const outerFrom = singleMailbox(headerValues(L, 'from'));
+ const outerFrom = singleMailbox(headerValues(L, 'reply-to').length ? headerValues(L, 'reply-to') : headerValues(L, 'from'));
catching command: cd apps/web && npx vitest run lib/domain/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  lib/domain/loyaltyInbox.test.ts > the loyalty inbox, pure (P8-42c1) > T42c1-U3: only the address of the From header is the sender, and an unreadable sender is classified
      Tests  1 failed | 3 passed (4)
reverted byte-identical: True (6836057e7709227c)

### M4b Sender trusted over From
file: apps/web/lib/domain/loyaltyInbox.ts
- const outerFrom = singleMailbox(headerValues(L, 'from'));
+ const outerFrom = singleMailbox(headerValues(L, 'sender').length ? headerValues(L, 'sender') : headerValues(L, 'from'));
catching command: cd apps/web && npx vitest run lib/domain/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  lib/domain/loyaltyInbox.test.ts > the loyalty inbox, pure (P8-42c1) > T42c1-U3: only the address of the From header is the sender, and an unreadable sender is classified
      Tests  1 failed | 3 passed (4)
reverted byte-identical: True (6836057e7709227c)

### M5 retention < becomes <=
file: apps/web/lib/loyaltyInbox.ts
- DELETE FROM loyalty_inbox_messages WHERE received_on < CURRENT_DATE
+ DELETE FROM loyalty_inbox_messages WHERE received_on <= CURRENT_DATE
catching command: cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I5: retention deletes exactly what is older than 30 days, in both tables, on the daily step and after every poll, and nothing else
      Tests  1 failed | 11 passed (12)
reverted byte-identical: True (86d32e5f45fce7fe)

### M6 health > becomes >=
file: apps/web/lib/loyaltyInbox.ts
- WHEN quiet_days > $1::int THEN 'quiet'
+ WHEN quiet_days >= $1::int THEN 'quiet'
catching command: cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I6: forwarding health turns quiet only after 45 days, follows the added date with no mail, and ignores unattributed mail
      Tests  1 failed | 11 passed (12)
reverted byte-identical: True (86d32e5f45fce7fe)

### M7 mailbox opened writable
file: apps/web/lib/loyaltyInboxSource.ts
- await client.mailboxOpen(config.mailbox, { readOnly: true });
+ await client.mailboxOpen(config.mailbox, { readOnly: false });
catching command: bash $SCRATCH/c13-diag.sh 2>&1 | tail -3; echo "command 13 exit=${PIPESTATUS[0]}"
command 13 exit=1
reverted byte-identical: True (8e27c11a503c1b84)

### M7b seen flag set after a fetch
file: apps/web/lib/loyaltyInboxSource.ts
- await client.mailboxOpen(config.mailbox, { readOnly: true });
+ await client.mailboxOpen(config.mailbox, { readOnly: true }); await client.messageFlagsAdd('1:*', ['\\Seen'], { uid: true });
catching command: bash $SCRATCH/c13-diag.sh 2>&1 | tail -3; echo "command 13 exit=${PIPESTATUS[0]}"
209:          await client.mailboxOpen(config.mailbox, { readOnly: true }); await client.messageFlagsAdd('1:*', ['\\Seen'], { uid: true });
FAIL a mailbox write verb in the adapter
command 13 exit=1
reverted byte-identical: True (8e27c11a503c1b84)

### M8 password in a log line
file: apps/web/lib/loyaltyInbox.ts
- else log.warn('loyalty inbox poll failed', { code: errorCode, ...counts });
+ else log.warn('loyalty inbox poll failed', { code: errorCode, ...counts, password: env.LOYALTY_IMAP_PASSWORD });
catching command: bash $SCRATCH/c13-diag.sh 2>&1 | tail -3; echo "command 13 exit=${PIPESTATUS[0]}"; cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
command 13 exit=1
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I1: an unset or incomplete environment disables the poller without error, and the daily job runs the step between the syncs and the digest
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I3: a re-poll stores and counts nothing again, two polls never overlap, and every failure is a classified code that frees the lock
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I8: no raw body, subject, member number, password, user or host leaves the server, and the inbox carries exactly the contract keys
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I11: the real adapter against a closed loopback port fails as connect_failed, records it, frees the lock and leaks nothing
      Tests  4 failed | 8 passed (12)
reverted byte-identical: True (86d32e5f45fce7fe)

### M9 raw body in an API response
file: apps/web/lib/loyaltyInbox.ts
- `SELECT domain, count(*)::int AS count FROM loyalty_inbox_unknown_senders
+ `SELECT domain, count(*)::int AS count, (SELECT encode(raw_mail, 'escape') FROM loyalty_inbox_messages WHERE raw_mail IS NOT NULL ORDER BY id LIMIT 1) AS sample FROM loyalty_inbox_unknown_senders
catching command: cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I2: over the whole fixture set the allowlist keeps exactly the expected mail, downloads only what it may, and records it as the table says
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I3: a re-poll stores and counts nothing again, two polls never overlap, and every failure is a classified code that frees the lock
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I4: stored mail is attributed through the tiers, an added address re-attributes what was unmatched, and no date moves back
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I7: coverage shows the last mail seen and the count in the window, null as null, and the unknown senders by count, capped
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I8: no raw body, subject, member number, password, user or host leaves the server, and the inbox carries exactly the contract keys
      Tests  5 failed | 7 passed (12)
reverted byte-identical: True (86d32e5f45fce7fe)

### M10 no advisory lock
file: apps/web/lib/loyaltyInbox.ts
- const r = await client.query<{ locked: boolean }>(`SELECT pg_try_advisory_lock(${LOCK_SQL}) AS locked`);
+ const r = await client.query<{ locked: boolean }>(`SELECT true AS locked`);
catching command: cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I3: a re-poll stores and counts nothing again, two polls never overlap, and every failure is a classified code that frees the lock
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I10: the poll route refuses a read token and no session, answers the contract shape for every outcome, and leaves the ledger as it was
      Tests  2 failed | 10 passed (12)
reverted byte-identical: True (86d32e5f45fce7fe)

### M11 JS clock for the fetch window
file: apps/web/lib/loyaltyInbox.ts
- const since = (await db.query<{ d: string }>('SELECT (CURRENT_DATE - $1::int)::text AS d', [LOYALTY_INBOX_RETENTION_DAYS])).rows[0].d;
+ const since = new Date(Date.now() - LOYALTY_INBOX_RETENTION_DAYS * 86400000).toISOString().slice(0, 10);
catching command: bash $SCRATCH/c13-diag.sh 2>&1 | tail -3; echo "command 13 exit=${PIPESTATUS[0]}"
162:  const since = new Date(Date.now() - LOYALTY_INBOX_RETENTION_DAYS * 86400000).toISOString().slice(0, 10);
FAIL clock or float in apps/web/lib/loyaltyInbox.ts
command 13 exit=1
reverted byte-identical: True (86d32e5f45fce7fe)
```

### Batch 2
```
### B1 skipping the dedupe check
file: apps/web/lib/loyaltyInbox.ts
-     if (listedKey !== null && known.has(listedKey)) { counts.duplicates++; continue; }

+ 
catching command: cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I2: over the whole fixture set the allowlist keeps exactly the expected mail, downloads only what it may, and records it as the table says
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I3: a re-poll stores and counts nothing again, two polls never overlap, and every failure is a classified code that frees the lock
      Tests  2 failed | 10 passed (12)
reverted byte-identical: True (86d32e5f45fce7fe)

### B2 recounting unknowns on a re-poll
file: apps/web/lib/loyaltyInbox.ts
- 
       UNION SELECT dedupe_key FROM loyalty_inbox_unknown_senders WHERE dedupe_key = ANY($1::text[])
+ 
- if (await recordUnknown(key, receivedOn, domain)) counts.unknown++;
    else counts.duplicates++;
+ await recordUnknown(key, receivedOn, domain); counts.unknown++;
catching command: cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I3: a re-poll stores and counts nothing again, two polls never overlap, and every failure is a classified code that frees the lock
      Tests  1 failed | 11 passed (12)
reverted byte-identical: True (86d32e5f45fce7fe)

### B3 downloading an unknown message
file: apps/web/lib/loyaltyInbox.ts
-     if (!fromMember && outerMatch === null) {

+     if (!fromMember && outerMatch === null) {
      await source.fetch(env.id);

catching command: cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I2: over the whole fixture set the allowlist keeps exactly the expected mail, downloads only what it may, and records it as the table says
      Tests  1 failed | 11 passed (12)
reverted byte-identical: True (86d32e5f45fce7fe)

### B5 logging the library error text
file: apps/web/lib/loyaltyInbox.ts
-     errorCode = classifySourceError(err);
+     errorCode = classifySourceError(err);
    log.warn('loyalty inbox source error', { detail: (err as Error).message });
catching command: bash $SCRATCH/c13-diag.sh 2>&1 | tail -3; echo "command 13 exit=${PIPESTATUS[0]}"; cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
OK task source guards
command 13 exit=0
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I1: an unset or incomplete environment disables the poller without error, and the daily job runs the step between the syncs and the digest
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I3: a re-poll stores and counts nothing again, two polls never overlap, and every failure is a classified code that frees the lock
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I8: no raw body, subject, member number, password, user or host leaves the server, and the inbox carries exactly the contract keys
      Tests  3 failed | 9 passed (12)
reverted byte-identical: True (86d32e5f45fce7fe)

### B6 returning the password in the overview
file: apps/web/lib/loyaltyInboxSource.ts
- return c.ok ? { configured: true, problem: null, missing: [] }
+ return c.ok ? ({ configured: true, problem: null, missing: [], password: c.password } as never)
catching command: (cd apps/web && npx vitest run lib/loyaltyInboxConfig.test.ts 2>&1 | grep -E "^ FAIL |Tests +"); cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  lib/loyaltyInboxConfig.test.ts > the loyalty inbox configuration (P8-42c1) > T42c1-U7: the environment parse is exact, and the password-free view holds no secret
      Tests  1 failed (1)
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 8 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I1: an unset or incomplete environment disables the poller without error, and the daily job runs the step between the syncs and the digest
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I2: over the whole fixture set the allowlist keeps exactly the expected mail, downloads only what it may, and records it as the table says
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I3: a re-poll stores and counts nothing again, two polls never overlap, and every failure is a classified code that frees the lock
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I4: stored mail is attributed through the tiers, an added address re-attributes what was unmatched, and no date moves back
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I6: forwarding health turns quiet only after 45 days, follows the added date with no mail, and ignores unattributed mail
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I7: coverage shows the last mail seen and the count in the window, null as null, and the unknown senders by count, capped
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I8: no raw body, subject, member number, password, user or host leaves the server, and the inbox carries exactly the contract keys
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I9: the two editors validate, replace atomically, refuse a taken entry with 409, echo nothing and refuse a read token
      Tests  8 failed | 4 passed (12)
reverted byte-identical: True (8e27c11a503c1b84)

### B7 deleting last_seen_on on purge
file: apps/web/lib/loyaltyInbox.ts
-   return { messages: m.rowCount ?? 0, unknown: u.rowCount ?? 0 };
+   await q.query('UPDATE loyalty_sender_domains SET last_seen_on = NULL');
  return { messages: m.rowCount ?? 0, unknown: u.rowCount ?? 0 };
catching command: cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I4: stored mail is attributed through the tiers, an added address re-attributes what was unmatched, and no date moves back
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I5: retention deletes exactly what is older than 30 days, in both tables, on the daily step and after every poll, and nothing else
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I7: coverage shows the last mail seen and the count in the window, null as null, and the unknown senders by count, capped
      Tests  3 failed | 9 passed (12)
reverted byte-identical: True (86d32e5f45fce7fe)

### B8 rolling last_received_on back
file: apps/web/lib/loyaltyInbox.ts
- `UPDATE household_member_addresses SET last_received_on = GREATEST(COALESCE(last_received_on, $2::date), $2::date)
        WHERE address = ANY($1::text[])`,
      [addresses, receivedOn]
+ `UPDATE household_member_addresses SET last_received_on = $2::date
        WHERE address = ANY($1::text[])`,
      [addresses, receivedOn]
catching command: cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I4: stored mail is attributed through the tiers, an added address re-attributes what was unmatched, and no date moves back
      Tests  1 failed | 11 passed (12)
reverted byte-identical: True (86d32e5f45fce7fe)

### B9 reassigning a matched message on re-attribution
file: apps/web/lib/loyaltyInbox.ts
- WHERE attribution <> 'matched' AND raw_mail IS NOT NULL AND received_on
+ WHERE raw_mail IS NOT NULL AND received_on
- if (who.attribution !== 'matched') continue;
+ if (who.attribution !== 'matched') { await q.query(`UPDATE loyalty_inbox_messages SET attribution = $2, member_id = NULL WHERE id = $1`, [row.id, who.attribution]); continue; }
- WHERE id = $1 AND attribution <> 'matched'`
+ WHERE id = $1`
catching command: cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I4: stored mail is attributed through the tiers, an added address re-attributes what was unmatched, and no date moves back
      Tests  1 failed | 11 passed (12)
reverted byte-identical: True (86d32e5f45fce7fe)

### B10 accepting a shared mail provider
file: apps/web/lib/domain/loyaltyInbox.ts
- return isLoyaltySenderDomain(d) ? d : null;
+ return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : null;
catching command: cd apps/web && npx vitest run lib/domain/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  lib/domain/loyaltyInbox.test.ts > the loyalty inbox, pure (P8-42c1) > T42c1-U2: sender domains are validated by the contract rules and matched by equality or a dot-suffix, longest first
      Tests  1 failed | 3 passed (4)
reverted byte-identical: True (6836057e7709227c)

### B11 never releasing the lock on error
file: apps/web/lib/loyaltyInbox.ts
-   } finally {
    await releaseLock(lock);
  }
+   } finally {
    if (errorCode === null) await releaseLock(lock); else lock.release();
  }
catching command: cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 7 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I2: over the whole fixture set the allowlist keeps exactly the expected mail, downloads only what it may, and records it as the table says
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I3: a re-poll stores and counts nothing again, two polls never overlap, and every failure is a classified code that frees the lock
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I4: stored mail is attributed through the tiers, an added address re-attributes what was unmatched, and no date moves back
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I5: retention deletes exactly what is older than 30 days, in both tables, on the daily step and after every poll, and nothing else
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I7: coverage shows the last mail seen and the count in the window, null as null, and the unknown senders by count, capped
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I8: no raw body, subject, member number, password, user or host leaves the server, and the inbox carries exactly the contract keys
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I12: nothing derived from the mail is stored, the five tables have the contract columns, and only the inbox tables move
      Tests  7 failed | 5 passed (12)
reverted byte-identical: True (86d32e5f45fce7fe)

### B12 a route that polls for a read-scope token or no session
file: apps/web/app/api/v1/loyalty/inbox/poll/route.ts
-   if (caller instanceof Response) return caller;

+ 
catching command: cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I10: the poll route refuses a read token and no session, answers the contract shape for every outcome, and leaves the ledger as it was
      Tests  1 failed | 11 passed (12)
reverted byte-identical: True (c1cabdade3388a86)

### B13 a poll that writes a ledger table
file: apps/web/lib/loyaltyInbox.ts
-     await recordState(errorCode);

+     await recordState(errorCode);
    await db.query(`UPDATE accounts SET name = name || 'z' WHERE id = (SELECT min(id) FROM accounts)`);

catching command: cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I10: the poll route refuses a read token and no session, answers the contract shape for every outcome, and leaves the ledger as it was
      Tests  1 failed | 11 passed (12)
reverted byte-identical: True (86d32e5f45fce7fe)
account name restored: True

### B14 a stored raw body for an oversize message
file: apps/web/lib/loyaltyInbox.ts
- attribution: 'none_found', memberId: null, addresses: [], raw: null,
+ attribution: 'none_found', memberId: null, addresses: [], raw: await source.fetch(env.id),
catching command: cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I2: over the whole fixture set the allowlist keeps exactly the expected mail, downloads only what it may, and records it as the table says
      Tests  1 failed | 11 passed (12)
reverted byte-identical: True (86d32e5f45fce7fe)

### B15 the daily job rejecting when the source fails
file: apps/web/lib/loyaltyInbox.ts
-     timedOut = true;
    errorCode = classifySourceError(err);
+     throw err;
-   } catch {
    log.error('loyalty inbox daily step failed'
+   } catch (e) {
    throw e;
    log.error('loyalty inbox daily step failed'
catching command: cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyInbox.test.ts 2>&1 | grep -E "^ FAIL |Tests +"
⎯⎯⎯⎯⎯⎯ Failed Tests 10 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I1: an unset or incomplete environment disables the poller without error, and the daily job runs the step between the syncs and the digest
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I2: over the whole fixture set the allowlist keeps exactly the expected mail, downloads only what it may, and records it as the table says
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I3: a re-poll stores and counts nothing again, two polls never overlap, and every failure is a classified code that frees the lock
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I4: stored mail is attributed through the tiers, an added address re-attributes what was unmatched, and no date moves back
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I5: retention deletes exactly what is older than 30 days, in both tables, on the daily step and after every poll, and nothing else
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I7: coverage shows the last mail seen and the count in the window, null as null, and the unknown senders by count, capped
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I8: no raw body, subject, member number, password, user or host leaves the server, and the inbox carries exactly the contract keys
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I10: the poll route refuses a read token and no session, answers the contract shape for every outcome, and leaves the ledger as it was
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I11: the real adapter against a closed loopback port fails as connect_failed, records it, frees the lock and leaks nothing
 FAIL  app/api/v1/loyalty/loyaltyInbox.test.ts > loyalty inbox (P8-42c1) > T42c1-I12: nothing derived from the mail is stored, the five tables have the contract columns, and only the inbox tables move
      Tests  10 failed | 2 passed (12)
reverted byte-identical: True (86d32e5f45fce7fe)
```

## Other required records

- **Next docs read** (under `apps/web/node_modules/next/dist/docs/`):
  `01-app/01-getting-started/15-route-handlers.md`,
  `01-app/03-api-reference/05-config/01-next-config-js/serverExternalPackages.md`,
  `01-app/03-api-reference/01-directives/use-client.md`.
- **uiux-promax** was invoked before the panel and the two editors were written. Palette: `/travel`
  (`TravelBoard.tsx` and its existing Loyalty components) is `gray-*`, not the accounts UI's
  `slate-*`. The new components follow the file they render in, so they are gray. Warnings use the
  skill's amber callout, buttons are `min-h-8` with `disabled:opacity-50`, and errors are inline.
- **Versions** (A1): `imapflow` 2.11.0 and `mailparser` 3.14.2, exact, MIT. Each is pinned to its
  newest release at least two weeks old, as a supply-chain precaution. `mailparser` ships its own types,
  so `@types/mailparser` is not installed. Installed with
  `npm install --save-exact imapflow@2.11.0 mailparser@3.14.2 -w @b8/web`. `npm view`:
  ```
  $ npm view imapflow@2.11.0 version license
  version = '2.11.0'
  license = 'MIT'
  $ npm view mailparser@3.14.2 version license
  version = '3.14.2'
  license = 'MIT'
  ```
  Both are imported by exactly one server file each (command 4): `imapflow` by
  `apps/web/lib/loyaltyInboxSource.ts`, `mailparser` by `apps/web/lib/domain/loyaltyInbox.ts`.
- **`npm audit --omit=dev`** (informational): `{"info":0,"low":0,"moderate":0,"high":5,"critical":1,"total":6}`.
  The affected packages are `axios`, `follow-redirects`, `next`, `nodemailer` (top-level, 9.1.1, the
  web app's own dependency already in HEAD's lockfile), `sharp` and `zod`. None is new with this
  task.
- **Fixture digest**: `f0bc174f134e6aaa092430c4c390e4e4f2f01a2dfdc56a77ad2a8c28fa36adc8`, equal to command
  16's pin. The fixture directory was never edited.
- **H14 /travel panel text sample** (fabricated data; the catalog programs and their public domains
  are the migration's seed):
  ```
  H14 sample Loyalty inbox | Raw mail is kept 30 days, then deleted. | Check inbox now | Not checked yet | Mail from unknown senders: 3 | attacker.test × 2 | other-sender.test × 1 | Forwarding | ZQ42A Surface Member: no forwarding address set | Edit forwarding addresses | ZQ42B Surface Member: no forwarding address set | Edit forwarding addresses | ZQ42B2 Surface Member: no forwarding address set | Edit forwarding addresses | ZQ42C Surface Anna: last mail 2026-11-18 | zq42c-anna@example.com | Edit forwarding addresses | ZQ42C Surface Quiet: forwarding quiet for 46 days | zq42c-boris@example.net | Edit forwarding addresses | Sender domains · 52 programs | AAdvantage | aa.com | No mail seen yet · 0 in the last 30 days
  ```
- **Money-figure grep**: see conflict 6 for SPEC.md. The added-comment scan inside command 13 passes
  in the diagnostic copy.
- **Unverified residual (Open question 13)**: the real adapter's LOGIN, SELECT, date-filtered
  search, envelope `From` mapping, INTERNALDATE to `receivedAt`, message-bytes fetch and a real
  server's TLS handshake. What was exercised: U7, the connection path against a closed loopback port
  (T42c1-I11, `connect_failed`, nothing leaked), the read-only and no-write-verb source check, and the
  strict fake everywhere else. For the owner's first real run: set the seven `LOYALTY_IMAP_` variables, press
  `Check inbox now` on `/travel`, and read `Last check: <date> · ok`.
- **Tree**: nothing committed; `AGENTS.md` is not dirty.
