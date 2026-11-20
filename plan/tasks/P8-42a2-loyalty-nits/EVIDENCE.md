# P8-42a2-loyalty-nits — evidence bundle (implementer)

**Tree:** `194f049` plus the uncommitted change below. Nothing is committed (per the brief).
**Date:** 2026-11-20. All acceptance commands were run from the repo root under `bash`, each from the spec's own text
(lines extracted from `SPEC.md` into scratch files with `sed -n`, not retyped), against the throwaway database
`postgresql://localhost/b8_p42a_throwaway`. The dev database `b8_finance` was never touched.

## Files changed

| File | Change |
|---|---|
| `apps/web/components/LoyaltyMembershipLine.tsx` | N1: the member-number `onSave` returns `null` without a request when the draft trims to empty, and otherwise sends `{ memberNumber: t }`; a new "Remove number" control (shown only when `memberNumberMasked !== null`) whose first tap only reveals "Remove this number?" with Confirm and Keep; Confirm's handler `removeNumber` is the only sender of `memberNumber: null`. |
| `apps/web/scripts/import-loyalty.ts` | N3: after the file checks and before any plan or transaction, one query `SELECT $1::date > CURRENT_DATE + 1 AS future` (both modes); a future date exits 2 with a data-free message. N4: `failureCode` (SQLSTATE `^[0-9A-Z]{5}$` or errno `^E[A-Z0-9_]{1,31}$`, else `unknown`) and `reportFailure`, used by the bound-read catch, the plan/apply catch and the entry point's outer catch. |
| `apps/web/scripts/import-loyalty.test.ts` | Additions only: two import lines and the `T42a2-I1`–`I3` describe block. |
| `apps/web/lib/loyaltyNits.test.ts` | New: `T42a2-U1`–`U3`. |
| `plan/tasks/P8-42a2-loyalty-nits/EVIDENCE.md` | This file. |

`plan/QUEUE.md` was already modified before this task started (orchestrator's change); it is not part of this work.
No file under `packages/contracts/`, `migrations/`, `db/schema.sql`, `app/api/`, `lib/loyaltyStore.ts` or `lib/domain/`
changed. `AGENTS.md` did not reappear dirty.

## Process requirements

- **Next docs read** (from `node_modules/next/dist/docs/01-app/`, resolved at the repo root where `next` is hoisted):
  `03-api-reference/01-directives/use-client.md`, `03-api-reference/04-functions/use-router.md` (in particular
  `router.refresh()`: it keeps client `useState`, which is why `removeNumber` closes the confirmation explicitly on
  success), and `01-getting-started/05-server-and-client-components.md` (first part).
- **`uiux-promax` skill invoked** before the control was designed. Applied: the Danger role (`text-red-400
  hover:text-red-600`) for "Remove number", inline confirmation rather than `window.confirm`, `disabled` +
  `disabled:opacity-50` + a "Removing…" label during the request, the inline error pattern (`text-red-500 text-sm`),
  `router.refresh()` on success. Tap targets: every new button is `min-h-8`, the same as the existing controls.
- **Palette note.** This file is `gray-*` (not the accounts UI's `slate-*`); the new controls follow the file. The
  skill's Danger role sets the button text to `text-xs`; the row already inherits `text-xs` from its container, so the
  new buttons do too.

## Measured T-rows (this session)

- T4 BASE 102 files / 1403 tests and T6 integration baseline 321 tests (failing `[]`), T5 LINT_BASE 0 errors /
  5 warnings: taken from G0 in `GATES.md` on the same base tree; not re-measured on the unmodified tree in this session.
- T7 `tsc --incremental false` → see #1 (`exit=0`). T8 `npx tsx --version` → `tsx v4.23.15`, `node v26.3.1`.
  T17 `PRIOR_REDUCER=6` exported for #5.
- After the change: unit 103 files / 1406 tests (#3); integration 324 tests (#6); lint 0 errors / 5 warnings, none in
  an edited file (the five are in `app/login/page.tsx`, `lib/domain/digest.ts`, `public/sw.js`,
  `scripts/seed-demo.mjs`).

## Environment incident (read before the outputs)

The repo lives in an iCloud-synced `Documents` folder and macOS had evicted most of it to "dataless" placeholders
(about 77 thousand files counting `node_modules`, including source files in `apps/web`). Reads of an evicted file
sometimes returned **zero bytes with exit 0** instead of failing. Effects seen before the tree was re-downloaded:
`vitest` refused to start (`pico is not a function`), `npx tsx` printed nothing and exited 0, and the first runs of #5,
#8, #9 and #10 failed for that reason only. I re-downloaded everything except `.next/*` caches, `evals/.venv` and the
mobile-only packages (`find … -flags +dataless` → 0 for apps, packages, db, `.git/objects` and the web's
`node_modules`), then ran the whole set again. Every output below is from after that. No file content was changed by
this; only placeholders were materialised.

Two earlier integration runs, made while files were still being fetched, each had one gift test hang for many minutes
and time out: #6's first run (`T41b-S2`, a 5 s test timeout after a long stall) and the second run inside #7's first
attempt (`T41c-C1`, a hook timeout). Both are P7 gift tests, outside this task's files. After the re-download #6 and
#7 were re-run unchanged and passed; #6 finished its whole suite in about 25 s. Both the failed and the passing runs
are shown. I could not prove the hangs were the eviction rather than an intermittent fault in those tests; the
orchestrator's G2 re-run will show it.

## Acceptance commands

### #1 tsc
```
exit=0
[bash rc=0]
```

### #2 lint
```

> b8@0.1.0 lint
> eslint

Pages directory cannot be found at /Users/andreianpilogov/Documents/b8/app/pages or /Users/andreianpilogov/Documents/b8/app/src/pages. If using a custom path, please configure with the `no-html-link-for-pages` rule in your eslint config file.

/Users/andreianpilogov/Documents/b8/app/apps/web/app/login/page.tsx
  112:7  warning  Do not use `window.location.assign()` to navigate to internal Next.js pages. Use `redirect()` in the render phase, or `useRouter().push()` in Client Components' event handlers instead. See: https://nextjs.org/docs/messages/no-location-assign-relative-destination  @next/next/no-location-assign-relative-destination

/Users/andreianpilogov/Documents/b8/app/apps/web/lib/domain/digest.ts
  202:7  warning  'GREEN_SOFT' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  204:7  warning  'RED_SOFT' is assigned a value but never used. Allowed unused vars must match /^_/u    @typescript-eslint/no-unused-vars

/Users/andreianpilogov/Documents/b8/app/apps/web/public/sw.js
  1:1  warning  Unused eslint-disable directive (no problems were reported from 'no-restricted-globals')

/Users/andreianpilogov/Documents/b8/app/apps/web/scripts/seed-demo.mjs
  457:17  warning  'pid' is assigned a value but never used. Allowed unused elements of array destructuring must match /^_/u  @typescript-eslint/no-unused-vars

✖ 5 problems (0 errors, 5 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

exit=0
[bash rc=0]
```

### #3 unit suite
```
 Test Files  103 passed (103)
      Tests  1406 passed (1406)
   Start at  09:52:59
   Duration  7.96s (tests 63%, import 22%, transform 13%, worker 2%)

    Isolate  103 workers spawned · ~162ms startup each (spawn + environment, per file)
             at least ~2.23s faster with isolate: false — reuses workers across files instead of one per file

[bash rc=0]
```

### #4 new unit scenarios, two zones
```
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.TogtK47Mei
OK 3 scenarios T42a2-U1..U3 each present once and passed; TZ=UTC
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.2rJdMvUXKw
OK 3 scenarios T42a2-U1..U3 each present once and passed; TZ=Pacific/Auckland
[bash rc=0]
```

### #5 regression P8-42a #4
```
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.zhVr0itMvZ
OK 10 scenarios U1-U10 each present once and passed; latestValueByKey tests >= 6; TZ=UTC
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.wlYoOd8XuE
OK 10 scenarios U1-U10 each present once and passed; latestValueByKey tests >= 6; TZ=Pacific/Auckland
[bash rc=0]
```

### #6 integration scenarios — final run (after the re-download)
```
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.pO3Tg7fkVB
OK 324 tests, T42a-C1-C11 and I1-I11 and T42a2-I1-I3 each present once and passed
[bash rc=0]
```
First run, during the re-download (FAILED; recorded for honesty, see the incident note):
```
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.pXYTFupO5P
FAIL T41b-S2: no recipient read made after any statement of the sync sees the canary — for an added arrival, a first-time modified arrival, and a reissue whose replacement defeats re-identification; a control run without a gift does see it  total=324
[bash rc=1]
```

### #7 stability — final run (after the re-download)
```
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.I16FgwPEsQ
[]
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.vOOJJfLRpq
[]
OK failing set stable and within KNOWN
[bash rc=0]
```
First attempt, during the re-download (FAILED; recorded for honesty, see the incident note):
```
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.dgF0ZUB9AM
[]
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.pZJSH64tiC
["T41c-C1: attaching to an awaiting gift links, files and masks the row exactly as the sync links its twin; no surface leaks it and no total moves by viewer"]
DIFFER
[bash rc=1]
```

(For #6 and #7, the per-test JSON log noise — the app's structured `{"time":…}` log lines, Node's
`ExperimentalWarning` lines and the P7 suites' `C9`/`reid-dump` diagnostics — is filtered from the captured output;
the lines shown are every other line, verbatim.)

### #8 --as-of bound
```
OK as-of bound
[bash rc=0]
```

### #9 database failure class
```
NOTICE:  database "b8_p42a2_empty" does not exist, skipping
OK failure class
[bash rc=0]
```
(The `NOTICE` line is `dropdb --if-exists` on a database that did not exist yet; the command's own text runs it.)

### #10 regression P8-42a #9 with A1
```
leak-free tokens=14
leak-free tokens=14
OK import end to end
[bash rc=0]
```

### #11 sidebar
```
OK sidebar
[bash rc=0]
```

### #12 source guards
```
OK source guards
[bash rc=0]
```

### #13 fixture guard
```
OK fixtures fabricated
[bash rc=0]
```

### #14 gift surface check (full output)
```
H1 PASS 22 page.tsx files on disk, all 22 classified (8 text-bearing)
H2 PASS 22 pages as the recipient: all 200, 0 hold the canary in any case; /transactions lists the ordinary row and the label Gift
H3 PASS the giver sees the canary on /transactions, /accounts/zq41b_check_card, /categories/Fabricated%20Gift%20Shelf, /dashboard, /properties/1
H4 PASS with the reveal date yesterday the recipient sees the canary on all 5 pages; moved back, masked again
H5 PASS recipient searches (full, prefix, payee) render the nonsense block {"count":"0","rows":0}; the amount finds the Gift row; the giver's search finds 1
H6 PASS merchant rule on the gift's payee counts 0 rows for the recipient and 1 for the giver; its Plaid category row is absent for the recipient and present for the giver
H7 PASS 24 alternating giver/recipient requests over 6 pages and routes: each viewer always got their own answer; API bodies byte-identical per viewer
H8 PASS dev-server output (7495 bytes): 0 lines hold the canary in any case, besides 3 access-log lines echoing this script's own search URLs
H9 PASS RSC: 1 /transactions as the recipient: 13716 bytes, ordinary row present, canary absent
H10 PASS giver's /gifts lists the gift and its criterion; recipient's lists none and holds no criterion; the Gifts nav entry is present for both
H11 PASS /travel and /api/v1/loyalty as both users: 200, label and masked suffix present, the 18-character number absent in any case
OK H1-H11
exit=0
[bash rc=0]
```
The first attempt hung: its `next dev` server sat at 0% CPU reading evicted `.next/dev` cache files. I killed it,
downloaded `apps/web/.next/dev` and `apps/web/.next/cache`, and re-ran. The output above is from the re-run.

### #15 coarse source checks
```
OK coarse source checks
[bash rc=0]
```

### #16 scope guard (expected: no output)
```
[bash rc=0]
```
(`[bash rc=0]` is my runner's marker line, not command output. Nothing else was printed.)

### #17 additions-only and census guard (expected: no output)
```
[bash rc=0]
```

### #18 build (last lines)
```

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand

exit=0
[bash rc=0]
```
`git status` after the build and after the screenshot dev server: only the files listed above (plus the pre-existing
`plan/QUEUE.md`); `next-env.d.ts` and `AGENTS.md` unchanged.

## Real-process stderr transcripts (four cases)

The `+2` date was read from Postgres (`to_char(CURRENT_DATE + 2, 'YYYY-MM-DD')`) and is shown as a placeholder.
`b8_p42a2_empty` was created empty for the 42P01 case and dropped afterwards.
```
$ DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx tsx scripts/import-loyalty.ts --file scripts/fixtures/loyalty-import.fixture.csv --as-of "<CURRENT_DATE + 2, read from Postgres>" --default-member zq42aanna
exit=2 stdout_bytes=0
--- stderr:
refusing --as-of: it is more than a day after the database's current date; nothing was changed

$ DATABASE_URL=postgresql://localhost/b8_p42a2_empty npx tsx scripts/import-loyalty.ts --file scripts/fixtures/loyalty-import.fixture.csv --as-of 2026-01-15 --default-member zq42aanna
exit=1 stdout_bytes=0
--- stderr:
import could not run; nothing was changed
code=42P01

$ DATABASE_URL=postgresql://nobody@127.0.0.1:1/b8_p42a2_empty npx tsx scripts/import-loyalty.ts --file scripts/fixtures/loyalty-import.fixture.csv --as-of 2026-01-15 --default-member zq42aanna
exit=1 stdout_bytes=0
--- stderr:
import could not run; nothing was changed
code=ECONNREFUSED

$ env -u DATABASE_URL npx tsx scripts/import-loyalty.ts --file scripts/fixtures/loyalty-import.fixture.csv --as-of 2026-01-15 --default-member zq42aanna
exit=1 stdout_bytes=0
--- stderr:
import could not run; nothing was changed
code=unknown
```

## Mutation log

Each mutation was applied alone by a script (`mutate.py` in the session scratchpad), its named checks were run, and
the file was restored from the in-memory original. `checksum` is a sha256 prefix of `git diff HEAD -- apps/web` plus
the new untracked test file, taken before and after; it is unchanged for every mutation. U and I scenarios were run
with `vitest -t "<id>"` on their own file; numbered commands were run as in the spec. FAIL means the check caught the
mutation.
```
M1 restore blankIsNull on the member-number save
  T42a2-U1: FAIL (rc=1; last line: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  T42a2-U2: FAIL (rc=1; last line: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  #15: FAIL (rc=1; last line: FAIL blank text can null the member number)
  reverted; checksum before=475e227ed81f5659 after=475e227ed81f5659 unchanged
M2 guard on t.length === 0 without trim
  T42a2-U1: FAIL (rc=1; last line: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  reverted; checksum before=475e227ed81f5659 after=475e227ed81f5659 unchanged
M3 a second memberNumber: null in the Keep (cancel) handler
  T42a2-U2: FAIL (rc=1; last line: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  #15: FAIL (rc=1; last line: )
  reverted; checksum before=475e227ed81f5659 after=475e227ed81f5659 unchanged
M4 the Remove number button's onClick sends the PATCH directly
  T42a2-U2: FAIL (rc=1; last line: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  reverted; checksum before=475e227ed81f5659 after=475e227ed81f5659 unchanged
M5 Remove number rendered when there is no number
  T42a2-U2: FAIL (rc=1; last line: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  reverted; checksum before=475e227ed81f5659 after=475e227ed81f5659 unchanged
M6 pre-fill the member-number editor with the mask (startEmpty removed)
  T42a2-U3: FAIL (rc=1; last line: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  reverted; checksum before=475e227ed81f5659 after=475e227ed81f5659 unchanged
M7 bound changed to >= CURRENT_DATE + 1
  T42a2-I1: FAIL (rc=1; last line: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  #8: FAIL (rc=2; last line: )
  reverted; checksum before=475e227ed81f5659 after=475e227ed81f5659 unchanged
M8 bound changed to > CURRENT_DATE + 2
  T42a2-I1: FAIL (rc=1; last line: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  #8: FAIL (rc=1; last line: )
  reverted; checksum before=475e227ed81f5659 after=475e227ed81f5659 unchanged
M9 bound applied only in dry run
  T42a2-I1: FAIL (rc=1; last line: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  #8: FAIL (rc=1; last line: )
  reverted; checksum before=475e227ed81f5659 after=475e227ed81f5659 unchanged
M10 bound computed with the JS clock
  #12: PASS (rc=0; last line: OK source guards)
  #15: FAIL (rc=1; last line: FAIL clock or network in the import)
  #5 (U9): FAIL (rc=1; last line: FAIL UTC U4=failed(1),U9=failed(1) T42a-U4: the whole-row reducer agrees with latestValueByKey, and no loyalty source picks a current reading itself ;)
  reverted; checksum before=475e227ed81f5659 after=475e227ed81f5659 unchanged
M11 the date echoed in the refusal
  T42a2-I1: FAIL (rc=1; last line: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  #8: FAIL (rc=1; last line: FAIL digits in message for 2026-11-22)
  reverted; checksum before=475e227ed81f5659 after=475e227ed81f5659 unchanged
M12 exit 1 instead of 2 on the refusal
  T42a2-I1: FAIL (rc=1; last line: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  #8: FAIL (rc=1; last line: )
  reverted; checksum before=475e227ed81f5659 after=475e227ed81f5659 unchanged
M13 err.message printed on failure
  T42a2-I2: FAIL (rc=1; last line: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  T42a2-I3: FAIL (rc=1; last line: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  #9: FAIL (rc=1; last line: NOTICE:  database "b8_p42a2_empty" does not exist, skipping)
  reverted; checksum before=475e227ed81f5659 after=475e227ed81f5659 unchanged
M14 raw code printed without the shape check
  T42a2-I2: FAIL (rc=1; last line: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  reverted; checksum before=475e227ed81f5659 after=475e227ed81f5659 unchanged
M15 code line printed on stdout
  T42a2-I2: FAIL (rc=1; last line: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  T42a2-I3: FAIL (rc=1; last line: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  #9: FAIL (rc=1; last line: NOTICE:  database "b8_p42a2_empty" does not exist, skipping)
  reverted; checksum before=475e227ed81f5659 after=475e227ed81f5659 unchanged
M16 code line omitted on the apply path
  T42a2-I3: FAIL (rc=1; last line: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  #9: FAIL (rc=1; last line: NOTICE:  database "b8_p42a2_empty" does not exist, skipping)
  reverted; checksum before=475e227ed81f5659 after=475e227ed81f5659 unchanged
M17 a database failure on the bound read mapped to exit 2
  T42a2-I3: FAIL (rc=1; last line: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  #9: FAIL (rc=1; last line: NOTICE:  database "b8_p42a2_empty" does not exist, skipping)
  reverted; checksum before=475e227ed81f5659 after=475e227ed81f5659 unchanged
M18 null-safety dropped so a thrown null crashes
  T42a2-I2: FAIL (rc=1; last line: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  reverted; checksum before=475e227ed81f5659 after=475e227ed81f5659 unchanged
```

**One expected check did not fail.** The spec lists command 12 as catching "compute the bound with the JS clock".
It did not (M10: `#12: PASS`). Command 12 is P8-42a #12 unchanged, and its absence guards are `! cmd` lines, which do
not abort a `set -e` script (T16). The spec already calls #12 "a floor", with command 15 carrying the real assertion.
M10 was caught by #15 (`FAIL clock or network in the import`) and by #5 (U4 and U9 both failed). I did not change
#12, because it is frozen.

The checks that were run all passed on the clean tree. The checksum shows the tree after the mutations is the tree
the acceptance runs used.

## Screenshots and live check (not committed)

`shots.mjs` (in the session scratchpad) is adapted from `apps/web/scripts/screenshots.mjs`. It made its own database
`b8_p42a2_screens` with the demo seed, the ZQ42A loyalty seed and a ZQ42A import `--apply`, then started `next dev` on
`localhost:3197` and drove headless Chrome. Desktop was 1440×900. Phone was 390×844 with touch and `display-mode:
standalone`. The database was dropped at the end. The PNGs are in the session scratchpad (`scratchpad/shots/`:
`desktop-travel.png`, `phone-travel.png`, `phone-editor-empty.png`, `phone-remove-confirm.png`,
`phone-after-remove.png`). They show the fixtures' fabricated balances, so none goes into the repo. Script log (the
counts are member-number rows in that scratch database, read with `psql`):
```
numbers stored at start: 10
desktop: Remove number buttons = 10; No number placeholders = 2
shot desktop-travel.png
shot phone-travel.png
phone: open editor -> clicked
phone: editor value = ""
shot phone-editor-empty.png
phone: submit empty -> submitted
phone: editor still open = false; numbers stored = 10
phone: tap Remove number -> clicked
phone: Confirm shown = true; numbers stored = 10
shot phone-remove-confirm.png
phone: tap Keep -> clicked
phone: after Keep, Confirm shown = false; numbers stored = 10
phone: tap Remove number -> clicked
phone: tap Confirm -> clicked
phone: after Confirm, numbers stored = 9; Remove number buttons = 9
shot phone-after-remove.png
rc=0
```
This is the browser-level check that limit (1) below says the unit tests cannot do. In the browser:
- An empty submit closed the editor, and the stored count stayed at 10.
- The first tap on "Remove number" showed Confirm and sent nothing.
- Keep sent nothing.
- Confirm removed one number (10 to 9).
- After the removal that row showed "No number", with no Copy and no Remove control.
- Rows without a number never showed "Remove number" (10 buttons for 10 numbers, 2 "No number" rows).

## Limits

1. The page components are not rendered in jsdom or another renderer inside the test suite (T21 is NO).
   - T42a2-U1 proves the empty-save guard by extracting the real `onSave` callback, transpiling it and running it
     against recording stubs.
   - T42a2-U2 proves the clear control's confirm step, its conditional rendering and its tap wiring with AST checks
     only.
   - The screenshot run above checks the same behaviour once in a real browser. It is not part of any acceptance
     command.
2. The Enter-key and button-submit paths of `LoyaltyInlineText` share one `save`. They are not tested separately.
   The guard sits in `onSave`, so both paths go through it. The live check submitted the form with
   `requestSubmit()`, the same path Enter uses.
3. The ECONNREFUSED code is checked for a plain address (`127.0.0.1:1`). Node's multi-address `AggregateError` for
   `localhost` is not checked. If that shape has a `code`, the shape check passes it through; if not, the script prints
   `code=unknown`.
4. The bound uses `CURRENT_DATE`, which is the database session's date. A run within milliseconds of the database's
   midnight could see a different date from the one the test computed (accepted in the spec).

## Scan for figures and real data

I read this file and the diff for dollar figures, comma-grouped numbers and real data. None found. The only numbers
are:
- counts (tests, files, warnings, member-number rows in the scratch database);
- version strings;
- SQLSTATE and errno codes;
- the fixtures' fabricated dates (`2026-01-15`, `2000-01-01`, `2999-01-01`);
- one database-derived `+2` date that appears inside the M11 mutation's failure message;
- the masked suffixes in the screenshots, which are fabricated fixtures and are not in this file.

No commit message was written, because nothing was committed.

## Note for the orchestrator

- P8-42a's `!`-style guards are weak under `set -e` (T16). This affects its #9 `want` pattern check and its #12. The
  regression runs #10 and #12 are therefore a floor. Commands 8, 9 and 15 check the same absences explicitly. M10
  above shows this happening: #12 passed with a JS clock in the script.
- Before anything else in this folder runs, check the eviction state (`find . -flags +dataless -type f | wc -l` from
  the repo root). A zero-byte read of an evicted module made `tsx` exit 0 with no output, so a check that only asserts
  absence could pass without testing anything.
