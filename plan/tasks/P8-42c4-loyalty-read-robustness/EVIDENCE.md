# P8-42c4 — evidence (implementer)

**Status: NOT GREEN. Commands 8, 9, 11 and 17 fail.** The cause of all four is in the frozen spec, not
in the implementation, and the spec was not edited. Two defects are explained below.

1. **D4 contradicts two artefacts that this task may not edit.** D4 says the panel's `failed` count
   also counts `retry` rows whose bytes are gone. Two existing artefacts seed a `retry` row with no
   stored message and expect the old count:
   - `apps/web/app/api/v1/loyalty/loyaltyRead.test.ts` T42c2-I11, line 922:
     `expect(panel.failed).toBe(1);`. It inserts one `failed` row and one `retry` row for the `cash`
     program, and neither has a message. Under D4 the count is 2. This breaks command 8
     (`FAIL T42c2-I11 … total=379`) and command 9 (the same single test).
   - The pinned fixture `apps/web/lib/fixtures/loyalty-read/cases.json`, line 2561, expects
     `"Could not be read: 1"`. Its surface `reads` hold one `failed` row and one `retry` row (ids
     `failed` and `retry`), and the surface script stores no message for either. Under D4 the panel
     shows 2. This breaks command 11 (`H15 FAIL /travel lacks "Could not be read: 1" for the owner`).

   The Non-goals forbid editing an existing test, fixture or script, and command 12 pins the fixture
   digest. Command 8 requires T42c2-I1 to I14 to pass, and command 11 requires H15 to pass. D4 cannot
   hold at the same time as these. A spec amendment must choose. This implementation follows D4 as
   written.

2. **Command 17 cannot restore the files.** In spec line 366, the subshell runs
   `cd apps/web` before its `EXIT` trap fires. The trap's `cp "$K/a" "$F1"` then uses a relative
   `F1` (`apps/web/lib/loyaltyInboxRead.ts`) from inside `apps/web` and fails with
   `cp: apps/web/lib/loyaltyInboxRead.ts: No such file or directory`. Both source files stay at
   `HEAD`, and the command prints `FAIL the implementer's files were not restored`. **If the
   orchestrator re-runs command 17 as written, the implementation is replaced by today's code and
   stays that way.** Restore it from the temp directory the command prints, or from a copy made
   beforehand. The implementer restored both files from a backup after each run (checked with
   `cmp`). Before the restore failed, the test run inside the command finished. Its JSON report
   shows all six scenarios `failed` with assertion errors (below).

## Next.js docs read for the route handler
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`, section
  "Request Body". The body is read with the standard Web `Request` methods. A rejected `text()` is
  now refused rather than mapped to `''`.

## Interpretation noted for the reviewer
- D6 and A3: a pool handle (defaulted or passed explicitly, as `loadOverview` passes it) gets its
  own connection and a `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`, then a
  COMMIT or ROLLBACK and a release. A handle that is not the pool is a client the caller already
  checked out. The five statements run on that client, and no second `BEGIN` is sent. This avoids
  the double-`BEGIN` failure mode the spec names, and a COMMIT that would end the caller's work.
  No caller passes a client today. If A3 means this function must open the transaction on a passed
  client as well, that is a one-branch change.

## Pre-gate checks
- Dataless files (T16 command): `0`. Port 3198 listeners: `0`. No `"<name> 2.<ext>"` conflict
  copies were found under `apps/web` or `packages` (outside `node_modules`).
- Throwaway DB after all runs: `ZQ42C` programs, `ZQ42C` members, inbox messages, `zq42c4`
  triggers and `zq42c4` functions = `0,0,0,0,0`.

## Acceptance commands (run order 1, 2, 3, 17, then the rest; verbatim output)
Each block is the command's output with `exit=<status>` appended by the runner. Long outputs are
trimmed to their final lines, with the test runner's JSON log lines and lock diagnostics removed.
This is stated for each one.

### 1
```
exit=0
exit=0
```

### 2
```

✖ 5 problems (0 errors, 5 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

OK lint 0 errors, warnings not above 5
exit=0
```

### 3
```
 Test Files  112 passed (112)
      Tests  1430 passed (1430)
   Start at  22:17:01
   Duration  7.89s (tests 66%, import 22%, transform 11%, worker 1%)

    Isolate  112 workers spawned · ~144ms startup each (spawn + environment, per file)
             at least ~2.15s faster with isolate: false — reuses workers across files instead of one per file

OK unit 112 files 1430 tests
exit=0
```

### 17 (spec defect 2: restore fails)
```
(node:39322) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:39322) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:39322) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.6h0j3xRNZR
cp: apps/web/lib/loyaltyInboxRead.ts: No such file or directory
FAIL the implementer's files were not restored
exit=1
[restored by the implementer from backup after command 17]
```

### 4
```
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.679UeKEejZ
OK 3 scenarios T42c3-U1..U3 each present once and passed; TZ=UTC
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.JBbQS60sb9
OK 3 scenarios T42c3-U1..U3 each present once and passed; TZ=Pacific/Auckland
exit=0
```

### 5
```
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.u3rCPjPbqE
OK 6 scenarios T42c2-U1..U6 each present once and passed; TZ=UTC
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.7FgK0aC9qb
OK 6 scenarios T42c2-U1..U6 each present once and passed; TZ=Pacific/Auckland
exit=0
```

### 6
```
OK dependencies
exit=0
```

### 7
```
OK schema
OK no migration, contracts comment-only
exit=0
```

### 8 (RED, spec defect 1; final lines, logger JSON lines removed)
```
T42c2-I10 loopback connections: 1
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.A1s0YVL4mi
FAIL T42c2-I11: retention is strict, coverage says yes, no or not read, the counts are right and a null is never a zero T42c2-I11:failed(1) total=379
exit=1
```

The command stops at the T42c2-I11 check, so its 42c3 and 42c4 line and its leak lines never ran.
The same run's JSON report, read separately (this is NOT the command's own output): 379 tests,
378 passed, one failed (`T42c2-I11`). `T42c3-I1`, `I2` and `I3` passed, and `T42c4-I1` to `I6`
passed, one each, in their files. A separate leak query found no `ZQ42C` rows and no `zq42c4`
trigger or function left.

### 9 (RED, the same T42c2-I11; final lines)
```
["T42c2-I11: retention is strict, coverage says yes, no or not read, the counts are right and a null is never a zero"]
T42c2-I10 loopback connections: 1
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.dx9m5td6Eq
["T42c2-I11: retention is strict, coverage says yes, no or not read, the counts are right and a null is never a zero"]
FAIL [
  'T42c2-I11: retention is strict, coverage says yes, no or not read, the counts are right and a null is never a zero'
]
exit=1
```

### 10 (final lines)
```
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
exit=0
```

### 11 (RED, spec defect 1)
In the sweep, the command printed only `exit=1`. The script's output goes to a temp file, and
`set -e` aborts on the H-line count before that file is printed. Running the script directly
(`node apps/web/scripts/gifts-surface-check.mjs`) gave `H1 PASS` to `H14 PASS`, then:
```
H15 FAIL /travel lacks "Could not be read: 1" for the owner
```
### 12
```
fixture shape ok
OK new fixtures pinned and covered
fixture shape ok
OK fixtures pinned and covered
exit=0
```

### 13
```
OK registry unchanged
exit=0
```

### 14
```
OK source guards
exit=0
```

### 15
```
OK scope
exit=0
```

### 16
```
OK existing tests untouched, census exact
exit=0
```

### 18 (final lines)
```

ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand

exit=0
exit=0
```

### 19
```
OK spec has no money-looking text
exit=0
```

### 20
See the end of this file. The command was run after this file was written.

## Command 17: the six titles on today's sources
These come from the JSON report that command 17's own test run wrote, before its restore step failed:
```
T42c4-I1 failed  AssertionError: expected [ 200, true, undefined ] to deeply equal [ 400, false, 'INVALID_INPUT' ]
T42c4-I2 failed  AssertionError: expected [] to have a length of 1 but got +0
T42c4-I3 failed  AssertionError: expected [ …(13) ] to deeply equal [ …(13) ]
T42c4-I4 failed  AssertionError: expected [ 'A=waiting', 'B=none', …(7) ] to deeply equal [ 'A=waiting', 'B=failed', …(7) ]
T42c4-I5 failed  AssertionError: delete: expected { state: 'failed', attempts: 1, …(1) } to deeply equal { state: 'retry', attempts: 1, …(1) }
T42c4-I6 failed  AssertionError: expected +0 to be 1 // Object.is equality
```
Every failure is an assertion, and none is a setup error. Restore check: failed (spec defect 2).
The implementer restored both files from a backup and confirmed them with `cmp`.

## The N5 table, observed
"Before" comes from a run on today's sources (a scratch run with the default reporter, restored by
absolute path). "After" is the modified tree. "today" means Postgres `CURRENT_DATE`, and "seed"
means the seeded earlier date was left unchanged.

| # | Response after | Stored after | PASS | Response before | Stored before | Expired row deleted before / after |
|---|---|---|---|---|---|---|
| 1 | ok, null | ok, null, today | PASS | ok, null | ok, null, today | yes / yes |
| 2 | error, store_failed | error, store_failed, today | PASS | error, store_failed | ok, null, today | no (P fails) / no |
| 3 | error, store_failed | error, store_failed, today | PASS | error, store_failed | unchanged (seed) | no / yes |
| 4 | error, store_failed | unchanged (seed) | PASS | error, store_failed | unchanged (seed) | no / yes |
| 5 | error, store_failed | unchanged (seed) | PASS | error, store_failed | unchanged (seed) | no (P fails) / no |
| 6 | error, rate_limited | error, rate_limited, today | PASS | error, rate_limited | error, rate_limited, today | yes / yes |
| 7 | error, rate_limited | error, rate_limited, today | PASS | error, rate_limited | error, rate_limited, today | no (P fails) / no |
| 8 | error, rate_limited | error, rate_limited, today | PASS | error, rate_limited | unchanged (seed) | no / yes |
| 9 | error, rate_limited | unchanged (seed) | PASS | error, rate_limited | unchanged (seed) | no / yes |
| 10 | error, store_failed | error, store_failed, today | PASS | error, store_failed | error, store_failed, today | yes / yes |
| 11 | error, store_failed | error, store_failed, today | PASS | error, store_failed | error, store_failed, today | no (P fails) / no |
| 12 | error, store_failed | unchanged (seed) | PASS | error, store_failed | unchanged (seed) | no / yes |
| 13 | error, store_failed | error, store_failed, today | PASS | error, store_failed | unchanged (seed) | no (P fails) / no |

The row at exactly the cut-off was kept in every row, before and after. The state columns were
never half written.

## The N4 table, observed (each row seeded alone, panel delta)

| Row | Seed | Class before | Class after |
|---|---|---|---|
| A | `retry`, bytes present | waiting | waiting |
| B | `retry`, message row deleted | none | failed |
| C | `retry`, `raw_mail` null | none | failed |
| D | `failed`, bytes present | failed | failed |
| E | `failed`, message row deleted | failed | failed |
| F | `pending` | needs attention | needs attention |
| G | `applied` | none | none |
| H | unread message with bytes, no reads row | waiting | waiting |
| I | message with null bytes, no reads row | none | none |

Accepted residuals of D4:
- A message whose bytes were purged before any attempt has no reads row, so it stays invisible
  (row I).
- "Try failed mail again" resets only `failed` rows that still have bytes, so it can show for a
  count it cannot reduce (rows B, C and E).

## Mutation evidence
Each row is one deliberate break, run against the named scenario only, then reverted from a
backup. The reverted tree passes all six scenarios (command 8's JSON report above). M1 moves one
line: the state write goes before the purge. Writing the state twice would hide the defect, so
the line is moved, not copied. M4 cannot write under the state-write trigger, so it fails by
throwing.

| M1 | loyaltyInboxRead.ts: the state write moved back before the purge | T42c4-I3 | FAIL | reverted, green |
| M2 | loyaltyInboxRead.ts: purge skipped after a store failure (count or read) | T42c4-I3 | FAIL | reverted, green |
| M3 | loyaltyInboxRead.ts: a purge failure overwrites the read's code | T42c4-I3 | FAIL | reverted, green |
| M4 | loyaltyInboxRead.ts: the state row reset to null after a failed write | T42c4-I3 | FAIL | reverted, green |
| M5 | loyaltyInboxRead.ts: the ROLLBACK failure swallowed silently (no log line) | T42c4-I2 | FAIL | reverted, green |
| M6 | loyaltyInboxRead.ts: the rollback error re-thrown, replacing the original | T42c4-I2 | FAIL | reverted, green |
| M7 | loyaltyInboxRead.ts: the error text added to the rollback log line | T42c4-I2 | FAIL | reverted, green |
| M8 | loyaltyInboxRead.ts: the panel counts only `failed`-state rows | T42c4-I4 | FAIL | reverted, green |
| M9 | loyaltyInboxRead.ts: the panel counts every `retry` row as failed | T42c4-I4 | FAIL | reverted, green |
| M10 | loyaltyInboxRead.ts: vanished bytes recorded as `failed/empty_message` | T42c4-I5 | FAIL | reverted, green |
| M11 | loyaltyInboxRead.ts: the panel transaction at `READ COMMITTED` | T42c4-I6 | FAIL | reverted, green |
| M12 | loyaltyInboxRead.ts: the queue statement sent to the pool | T42c4-I6 | FAIL | reverted, green |
| M13 | route.ts: a failed body read treated as an empty body again | T42c4-I1 | FAIL | reverted, green |
| M14 | route.ts: an empty body refused | T42c4-I1 | FAIL | reverted, green |
| M15 | route.ts: the body read (cloned) before the caller is authorised | T42c4-I1 | FAIL | reverted, green |

First failure line of each (from the mutation runner):
```
M1 I3 AssertionError: expected [ …(13) ] to deeply equal [ …(13) ]
M2 I3 AssertionError: expected [ …(13) ] to deeply equal [ …(13) ]
M3 I3 AssertionError: expected [ …(13) ] to deeply equal [ …(13) ]
M4 I3 error: zq42c4 injected failure
M5 I2 AssertionError: expected [] to have a length of 1 but got +0
M6 I2 Error: ZQ42C4-ROLLBACK the rollback failed
M7 I2 AssertionError: expected [ 'code', 'detail', 'level', …(3) ] to deeply equal [ 'code', 'level', 'message', …(2) ]
M8 I4 AssertionError: expected [ 'A=waiting', 'B=none', …(7) ] to deeply equal [ 'A=waiting', 'B=failed', …(7) ]
M9 I4 AssertionError: expected [ Array(9) ] to deeply equal [ 'A=waiting', 'B=failed', …(7) ]
M10 I5 AssertionError: delete: expected { state: 'failed', attempts: 1, …(1) } to deeply equal { state: 'retry', attempts: 1, …(1) }
M11 I6 AssertionError: expected 'BEGIN TRANSACTION ISOLATION LEVEL REA…' to match /REPEATABLE READ|SERIALIZABLE/
M12 I6 AssertionError: expected false to be true // Object.is equality
M13 I1 AssertionError: expected [ 200, true, undefined ] to deeply equal [ 400, false, 'INVALID_INPUT' ]
M14 I1 AssertionError: expected [ 400, undefined, undefined ] to deeply equal [ 200, 'ok', 1 ]
M15 I1 AssertionError: expected true to be false // Object.is equality
restored
```

### 20 (run after this file was written)
```
OK mutation evidence rows 15
exit=0
```
