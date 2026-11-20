# EVIDENCE — P8-42a-loyalty-model-page-import
**Author:** implementer · **Tree:** main at `2ec09e3` plus uncommitted changes (not committed, per instructions) · **Database:** `postgresql://localhost/b8_p42a_throwaway` only; `b8_finance` was never opened.

Every acceptance command below was extracted from SPEC.md by line number into a scratch script (not
retyped) and run from the repository root under `bash`, plainly, never through `rtk`, with
`export PRIOR_REDUCER=6`. Output is verbatim. Where only the final lines are quoted, the spec asks for
those lines; the elided lines are the structured JSON log lines and other suites' own diagnostics,
which the spec does not ask for. No figure that looks like money appears in this file: every balance
quoted is from the fabricated fixtures or the fabricated transcript, all carrying `ZQ42A`.

## RESULT: commands 1–8 and 10–17 pass; command 9 FAILS AS WRITTEN because of a defect in the command itself

Command 9's node scripts read `process.argv[2]` and `process.argv[3]`. Under `node -e` the first
extra argument is `process.argv[1]` (checked: `node -e 'console.log(JSON.stringify(process.argv))' a b`
prints the node path, then `"a"`, then `"b"`). So the leak check takes the captured stdout text as the
fixture's file path and dies with `ENAMETOOLONG` at its first call. The same command with only those two
indices corrected (`argv[2]` to `argv[1]`, `argv[3]` to `argv[2]`, nothing else changed) prints
`OK import end to end`. Both outputs are below. SPEC.md was not edited: the amendment is the
orchestrator's to make.

## Files changed

Modified, additions only (command 15 is empty): `apps/web/lib/domain/observations.ts` (adds
`latestRowByKey`, `DatedObservation` and `compareDatedObservations`), `apps/web/lib/giftSurfaceRegistry.ts`
(eleven ROUTES entries and the `/travel` page), `apps/web/components/Sidebar.tsx` (a separate `Plane`
import line and the `/travel` entry between Properties and Gifts), `apps/web/scripts/gifts-surface-check.mjs`
(the H11 step; the old final `OK H1-H10` line is the only line replaced), `apps/web/vitest.integration.config.mts`
(the import test's exact path), `package.json` and `apps/web/package.json` (`import:loyalty`).

Added: `apps/web/lib/domain/loyalty.ts`, `apps/web/lib/domain/loyaltyImport.ts`, `apps/web/lib/loyaltyStore.ts`,
`apps/web/app/api/v1/loyalty/loyaltyResponses.ts` and the eleven `route.ts` files beneath
`apps/web/app/api/v1/loyalty/`, `apps/web/app/travel/page.tsx`, `apps/web/components/TravelBoard.tsx` and the
eight `apps/web/components/Loyalty*.tsx` components, `apps/web/scripts/import-loyalty.ts`, the five files in
`apps/web/scripts/fixtures/` (`loyalty-import.seed.sql`, `.fixture.csv`, `.bad-program.csv`, `.bad-value.csv`,
`.bad-duplicate.csv`), and the tests `apps/web/lib/loyalty.test.ts` (U1–U5, U8, U9),
`apps/web/lib/loyaltyImport.test.ts` (U6, U10), `packages/contracts/loyalty.test.ts` (U7),
`apps/web/app/api/v1/loyalty/loyalty.test.ts` (C1–C11) and `apps/web/scripts/import-loyalty.test.ts` (I1–I11).

Not touched by this role: `migrations/1792700000000_loyalty.sql`, `db/schema.sql`, `packages/contracts/loyalty.ts`
and `packages/contracts/index.ts` (frozen contract inputs, present in the tree from contract work), SPEC.md,
GATES.md. No contract was found wrong. `AGENTS.md` did not reappear dirty after the dev server or the build.

## Toolchain rows

Measured by the orchestrator at G0 and given to this role: BASE = 99 files / 1393 tests; LINT_BASE =
0 errors / 5 warnings; PRIOR_REDUCER = 6; the integration baseline 299 tests with none failing (KNOWN as
frozen in commands 6 and 7). Re-checked here: T14 `lsof -nP -iTCP:3198 -sTCP:LISTEN | wc -l` gave `0`
immediately before command 11. T22 (renderer), T23 (network) and T24 (`b8_finance`, the real sheet) are NO,
and nothing here uses them.

## Acceptance commands

**#1** — run as `(cd apps/web && npx tsc --noEmit --incremental false; echo "exit=$?")`. The orchestrator's
standing instruction adds `--incremental false`, because plain `tsc --noEmit` hangs on a stale
`tsconfig.tsbuildinfo` on this machine; the check is otherwise the spec's.
```
exit=0
```

**#2** `npm run lint; echo "exit=$?"` (tail)
```
✖ 5 problems (0 errors, 5 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

exit=0
```
0 errors, 5 warnings = LINT_BASE. The five are the pre-existing ones (a `window.location.assign` warning in
`app/login/page.tsx`, two unused constants in `lib/domain/digest.ts`, an unused directive in `public/sw.js`,
an unused destructured element in `scripts/seed-demo.mjs`); none is in a file this task touched. (An earlier
run showed a sixth, an unused constant in `lib/loyaltyImport.test.ts`; it was removed before this run.)

**#3** `npm test 2>&1 | tail -8`
```
Test Files  102 passed (102)
      Tests  1403 passed (1403)
   Start at  23:11:28
   Duration  8.90s (tests 63%, import 22%, transform 14%, worker 2%)

    Isolate  102 workers spawned · ~199ms startup each (spawn + environment, per file)
             at least ~2.69s faster with isolate: false — reuses workers across files instead of one per file
```
BASE plus 3 files and plus 10 tests exactly; 0 failed; no existing unit test removed or skipped.

**#4** (both zones)
```
OK 10 scenarios U1-U10 each present once and passed; latestValueByKey tests >= 6; TZ=UTC
OK 10 scenarios U1-U10 each present once and passed; latestValueByKey tests >= 6; TZ=Pacific/Auckland
```

**#5**
```
OK 1 new migration; down removes every loyalty table; up restores them; schema.sql lists all 6 tables
```

**#6** (final line)
```
OK 321 tests, C1-C11 and I1-I11 each present once and passed
```
321 = the 299-test baseline plus C1–C11 and I1–I11. The other suites ran green with the loyalty tables present.

**#7** (final line)
```
OK failing set stable and within KNOWN
```

**#8**
```
package.json:1
apps/web/package.json:1
```

**#9 as written in SPEC.md** — FAILS (exit 1), for the reason stated at the top. First and last lines:
```
node:fs:436
    return binding.readFileUtf8(path, stringToFlags(options.flag));
                   ^

Error: ENAMETOOLONG: name too long, open 'mode=apply
rows=12
…

Node.js v26.3.1
[shell rc=1]
```
The text after `open '` is the bad-program fixture's `--apply` stdout, which the command passes as the
leak check's second argument and the script then opens as a path. Every step before that first leak check
passed (the dry run, the apply, the second apply and the refusal exit codes are asserted earlier in the command).

**#9 with only the two `process.argv` indices corrected** — passes:
```
leak-free tokens=14
leak-free tokens=14
OK import end to end
```

**#10**
```
OK sidebar
```

**#11** `node apps/web/scripts/gifts-surface-check.mjs; echo "exit=$?"` (full output)
```
H1 PASS 22 page.tsx files on disk, all 22 classified (8 text-bearing)
H2 PASS 22 pages as the recipient: all 200, 0 hold the canary in any case; /transactions lists the ordinary row and the label Gift
H3 PASS the giver sees the canary on /transactions, /accounts/zq41b_check_card, /categories/Fabricated%20Gift%20Shelf, /dashboard, /properties/1
H4 PASS with the reveal date yesterday the recipient sees the canary on all 5 pages; moved back, masked again
H5 PASS recipient searches (full, prefix, payee) render the nonsense block {"count":"0","rows":0}; the amount finds the Gift row; the giver's search finds 1
H6 PASS merchant rule on the gift's payee counts 0 rows for the recipient and 1 for the giver; its Plaid category row is absent for the recipient and present for the giver
H7 PASS 24 alternating giver/recipient requests over 6 pages and routes: each viewer always got their own answer; API bodies byte-identical per viewer
H8 PASS dev-server output (7471 bytes): 0 lines hold the canary in any case, besides 3 access-log lines echoing this script's own search URLs
H9 PASS RSC: 1 /transactions as the recipient: 13716 bytes, ordinary row present, canary absent
H10 PASS giver's /gifts lists the gift and its criterion; recipient's lists none and holds no criterion; the Gifts nav entry is present for both
H11 PASS /travel and /api/v1/loyalty as both users: 200, label and masked suffix present, the 18-character number absent in any case
OK H1-H11
exit=0
```

**#12**
```
OK source guards
```

**#13**
```
OK fixtures fabricated
```

**#14** — no output.
```
```

**#15** — no output.
```
```

**#16** — the three contract files, then no output.
```
packages/contracts/index.ts
packages/contracts/loyalty.test.ts
packages/contracts/loyalty.ts
```

**#17** `npm run build; echo "exit=$?"` (the loyalty and travel lines, and the tail)
```
├ ƒ /api/v1/loyalty
├ ƒ /api/v1/loyalty/instruments
├ ƒ /api/v1/loyalty/instruments/[id]
├ ƒ /api/v1/loyalty/members
├ ƒ /api/v1/loyalty/members/[id]
├ ƒ /api/v1/loyalty/memberships
├ ƒ /api/v1/loyalty/memberships/[id]
├ ƒ /api/v1/loyalty/memberships/[id]/member-number
├ ƒ /api/v1/loyalty/memberships/[id]/observations
├ ƒ /api/v1/loyalty/programs
├ ƒ /api/v1/loyalty/programs/[id]
└ ƒ /travel
○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand

exit=0
```

Also run: `lib/giftSurfaceWiring.test.ts` (W4) is inside command 3's suite and passed there.

## Mutation log

Each mutation was applied by a scratch script to one file, the named loyalty suites were run (the unit
files `lib/loyalty.test.ts` and `lib/loyaltyImport.test.ts`, and/or the integration files
`app/api/v1/loyalty/loyalty.test.ts` and `scripts/import-loyalty.test.ts` against the throwaway database;
the sidebar mutation also ran command 10, the ROUTES mutation also ran `lib/giftSurfaceWiring.test.ts`),
then the file was restored and its md5 compared with the original. All 29 were killed; every revert left the
checksum unchanged, and the suites were green again in the full command run above, which came after.
```
M1 current by recorded_at, not as-of: failed ['T42a-C2', 'T42a-I6', 'T42a-U3']; reverted, checksum unchanged
M2 tie-break removed (input order decides): failed ['T42a-U3']; reverted, checksum unchanged
M3 empty membership returns balance 0: failed ['T42a-C2', 'T42a-C4', 'T42a-C8']; reverted, checksum unchanged
M4 blank or dash import cell imports as 0: failed ['T42a-I1', 'T42a-I11', 'T42a-I2', 'T42a-I3', 'T42a-I6', 'T42a-U10', 'T42a-U6']; reverted, checksum unchanged
M5 points accept a fraction: failed ['T42a-I4', 'T42a-I5', 'T42a-U10', 'T42a-U2', 'T42a-U6']; reverted, checksum unchanged
M6 dollar cell stored in the default unit: failed ['T42a-U6']; reverted, checksum unchanged
M7 list response carries the full number: failed ['T42a-C4', 'T42a-C7', 'T42a-C8']; reverted, checksum unchanged
M8 validation error echoes the body: failed ['T42a-C4']; reverted, checksum unchanged
M9 S6 accepts a personal bearer token: failed ['T42a-C4', 'T42a-U8']; reverted, checksum unchanged
M10 observation POST skips the caller check: failed ['T42a-C5', 'T42a-U8']; reverted, checksum unchanged
M11 import applies valid rows when one is refused: failed ['T42a-I11', 'T42a-I4', 'T42a-I7', 'T42a-U10']; reverted, checksum unchanged
M12 availability compared case-sensitively: failed ['T42a-I1', 'T42a-I11', 'T42a-I2', 'T42a-I3', 'T42a-I8', 'T42a-U10', 'T42a-U6']; reverted, checksum unchanged
M13 label matched by prefix: failed ['T42a-C11', 'T42a-I4', 'T42a-U10']; reverted, checksum unchanged
M14 future as-of accepted: failed ['T42a-C3']; reverted, checksum unchanged
M15 default member assumed (first member): failed ['T42a-I11', 'T42a-U10']; reverted, checksum unchanged
M16 second --apply re-plans existing readings as new: failed ['T42a-I3', 'T42a-I7', 'T42a-I8', 'T42a-U10']; reverted, checksum unchanged
M17 member taken from the first word, not the last: failed ['T42a-C11', 'T42a-I1', 'T42a-I10', 'T42a-I11', 'T42a-I2', 'T42a-I3', 'T42a-I4', 'T42a-I6', 'T42a-I7', 'T42a-I8', 'T42a-U10', 'T42a-U6']; reverted, checksum unchanged
M18 duplicate refuses the first occurrence: failed ['T42a-I11', 'T42a-I5', 'T42a-U10']; reverted, checksum unchanged
M19 leading emoji not removed: failed ['T42a-C11', 'T42a-I1', 'T42a-I10', 'T42a-I11', 'T42a-I2', 'T42a-I3', 'T42a-I4', 'T42a-I6', 'T42a-I7', 'T42a-I8', 'T42a-U10']; reverted, checksum unchanged
M20 bonus_unplaced not counted: failed ['T42a-I1', 'T42a-I2', 'T42a-I3', 'T42a-I8', 'T42a-U10', 'T42a-U6']; reverted, checksum unchanged
M21 alias PATCH applied outside the transaction: failed ['T42a-C11']; reverted, checksum unchanged
M22 import creates a missing program alias match by retrying the whole label: failed ['T42a-U10']; reverted, checksum unchanged
M23 API accepts thousands separators: failed ['T42a-U2']; reverted, checksum unchanged
M24 usd emitted without scale 2: failed ['T42a-C3', 'T42a-U2', 'T42a-U6']; reverted, checksum unchanged
M25 /travel entry moved after Gifts: failed ['T42a-U8', 'command 10']; reverted, checksum unchanged
M26 a route left out of ROUTES: failed ['T41b-W4', 'T42a-C10', 'T42a-U8']; reverted, checksum unchanged
M27 copy action fetches the number on page load: failed ['T42a-U9']; reverted, checksum unchanged
M28 a log line prints the member number: failed ['T42a-C4']; reverted, checksum unchanged
M29 a future as-of accepted (no check at all): failed ['T42a-C3']; reverted, checksum unchanged
```
Mapping and gaps against the spec's list. Killed as the spec expects: current by as-of (M1), tie-break (M2),
null not 0 (M3), blank or dash as 0 (M4), points fraction (M5), `$` in the default unit (M6), `usd` scale
(M24), full number in the list (M7), validation echo (M8), a log line with the number (M28), S6 bearer (M9),
a write route with no caller check (M10), all-or-nothing (M11), case-sensitive availability (M12), prefix
matching (M13), future as-of (M14, M29), default member assumed (M15), second apply duplicating (M16), first
word for the member (M17), first duplicate refused (M18), emoji not removed (M19), `bonus_unplaced` (M20),
alias PATCH partly applied (M21), the label matched with a whole-label retry (M22), `/travel` after Gifts
(M25), a route left out of ROUTES (M26), the copy fetch on load (M27).
M23 (the API accepts separators) was killed by U2 only; C3 did not fail, because C3's separator case is
refused by the contract's request schema before the store's rule runs, so the mutation of the store's rule is
not reachable from the route. Not run by this role, because they need a frozen file changed (the migration's
alias constraint, the contract's negative-balance and `source` rules) or are a structural rewrite rather than a
one-line probe (an observation UPDATE, which command 12 guards; a write to `accounts` or `account_valuations`,
which C6's checksums guard; the import creating a program or member; the fee column parsed; separators in
the import): those are left to the orchestrator's G2 run.

## Sample transcript (fabricated data only)

The three loyalty routes, called through the real handlers with a real cookie session and a real
full-scope bearer token minted in the throwaway database, by a scratch test copied into the tree, run once
and deleted. The overview's seeded catalog is elided (it is the migration's public catalog, not data):
```
>>> POST observations as-of 2026-03-01 (cookie)
201 {"success":true,"data":{"id":1,"memberId":1,"memberDisplayName":"ZQ42ATranscript","programId":1,"memberNumberMasked":"••••0042","tier":null,"balance":"120","unit":"points","asOf":"2026-03-01","source":"typed"}}
>>> POST observations as-of 2026-01-01, older (cookie)
201 {"success":true,"data":{"id":1,"memberId":1,"memberDisplayName":"ZQ42ATranscript","programId":1,"memberNumberMasked":"••••0042","tier":null,"balance":"120","unit":"points","asOf":"2026-03-01","source":"typed"}}
>>> current after the older reading: balance=120 asOf=2026-03-01 source=typed
>>> GET /api/v1/loyalty (cookie)
200 {"success":true,"data":{"members":[{"id":1,"displayName":"ZQ42ATranscript","userId":null}],"programs":[ …the seeded catalog of 51 programs and their aliases, elided… ],"cards":[{"programId":1,"programName":"Atmos Rewards","programKind":"airline","memberships":[{"id":1,"memberId":1,"memberDisplayName":"ZQ42ATranscript","programId":1,"memberNumberMasked":"••••0042","tier":null,"balance":"120","unit":"points","asOf":"2026-03-01","source":"typed"}]}],"instruments":[]}}
>>> GET member-number (cookie)
200 {"success":true,"data":{"membershipId":1,"memberNumber":"ZQ42A-TR-00042"}}
>>> GET member-number (bearer, full scope)
403 {"success":false,"error":{"code":"BROWSER_SESSION_REQUIRED","message":"A member number can only be copied from a signed-in browser."}}
```
The older reading was recorded (a second row) and the current balance stayed the newer one. The cookie
session gets the full number; the bearer token gets 403 `BROWSER_SESSION_REQUIRED`.

The import fixture, seeded fresh, as a real process (`npx tsx scripts/import-loyalty.ts --file
scripts/fixtures/loyalty-import.fixture.csv --as-of 2026-01-15 --default-member zq42aanna [--apply]`): a dry
run, an `--apply` and a second `--apply`, the 20 stdout lines of each verbatim:
```
### dry run
mode=dry-run
rows=12
memberships_created=12
memberships_existing=0
observations_created=7
observations_existing=0
observations_skipped_empty=5
instruments_created=3
instruments_existing=0
bonus_unplaced=2
refused_program=0
refused_member=0
refused_value=0
refused_duplicate=0
conflicts=0
refused_rows_program=
refused_rows_member=
refused_rows_value=
refused_rows_duplicate=
refused_rows_conflict=
exit=0
### --apply
mode=apply
rows=12
memberships_created=12
memberships_existing=0
observations_created=7
observations_existing=0
observations_skipped_empty=5
instruments_created=3
instruments_existing=0
bonus_unplaced=2
refused_program=0
refused_member=0
refused_value=0
refused_duplicate=0
conflicts=0
refused_rows_program=
refused_rows_member=
refused_rows_value=
refused_rows_duplicate=
refused_rows_conflict=
exit=0
### second --apply
mode=apply
rows=12
memberships_created=0
memberships_existing=12
observations_created=0
observations_existing=7
observations_skipped_empty=5
instruments_created=0
instruments_existing=3
bonus_unplaced=2
refused_program=0
refused_member=0
refused_value=0
refused_duplicate=0
conflicts=0
refused_rows_program=
refused_rows_member=
refused_rows_value=
refused_rows_duplicate=
refused_rows_conflict=
exit=0
```

## Next docs read before Next-facing code

All under `node_modules/next/dist/docs/01-app/`: `01-getting-started/15-route-handlers.md`,
`03-api-reference/03-file-conventions/route.md` (the `params` promise, 405 for an unexported method),
`01-getting-started/05-server-and-client-components.md`, `03-api-reference/03-file-conventions/page.md`,
`02-guides/data-security.md` (what crosses into client props), and
`03-api-reference/03-file-conventions/02-route-segment-config/index.md` (`dynamic = 'force-dynamic'`).

## uiux-promax

The skill was invoked before the page and components were written. Followed: page title `text-2xl
font-semibold`, card shell `border rounded-xl`, section headings `text-lg font-semibold`, muted text
`text-gray-400`, badges `text-xs px-2 py-0.5 rounded-full font-medium`, `disabled:opacity-50` and a
"Saving…" label on every write, inline `text-red-500` errors, `router.refresh()` after success, an empty state
with an action. Inputs are `text-base sm:text-sm` so iOS does not zoom on focus.

Two departures, stated so the reviewer can judge them. (1) Palette: the new files use the skill's `gray-*`
tokens because `/travel` is a new surface with no accounts-UI neighbours inside it; the neighbouring
properties and gifts pages use `slate-*`. No row mixes the two. (2) The skill says to format currency with
`Intl.NumberFormat`, which takes a JS number; this task forbids turning a balance into a number, so
`formatBalance` groups digits as text and the cash unit prints as `$` plus the stored two decimals.

## Screenshots

Taken with a scratch copy of the repo's `apps/web/scripts/screenshots.mjs`, pointed at its own database
`b8_screens_p42a` (created, migrated, demo-seeded, then the loyalty seed and the import fixture applied, then
dropped), on port 3197, writing to the session scratch directory, not the repo. Desktop 1440×900 and phone
390×844 in installed-app mode. They show only `ZQ42A` names, fixture balances, masked numbers and the "—"
for memberships without a reading. They were looked at: two layout faults found that way were fixed (a long
program name truncated beside its badge on the phone, now wrapping; "No number" set in the monospace face,
now in the body face). None is committed: the balances are digit strings that read as figures.

## What cannot be proved here

1. The page's components are not rendered in a browser or jsdom (T22 is NO). In-place editing, the copy
   action and the "—" rendering are checked by AST wiring (U9), the surface script (H11) and the build only,
   plus the phone and desktop screenshots above, which show rendering but exercised no tap.
2. The import is exercised only against the committed fabricated fixtures, never the owner's sheet. That the
   seeded aliases cover the owner's real labels is for the orchestrator to verify locally outside the repo; a
   label that does not resolve is reported by row number and is fixed by adding an alias through the program
   PATCH route, never by loosening the matcher.
3. The copy action's clipboard write on an installed iOS PWA is untested.
4. The surface script runs against `next dev`, not a production build.

## Notes for the reviewer

- **U10's ambiguity pair.** The spec's example of an ambiguous member pair (`ZQ42AAnna` against `Anna`)
  cannot be ambiguous under the spec's own whole-word suffix rule, since `ZQ42AAnna` does not end in the
  word `Anna`. U10 asserts ambiguity with `Anna` and `ZQ42AX Anna` (both end in the word `Anna`), and
  separately that `ZQ42AAnna` resolves uniquely.
- **U10's normalisation example.** Under the rule order (leading symbols first, then parenthesised groups),
  `(ZQ42A) x` normalises to `zq42a) x`, because the leading `(` is stripped as a symbol before step 3 sees a
  group. U10 asserts that, and uses a label of symbols only for the empty case.
- **C6.** There is no GET route for accounts, so C6 compares `computeCurrentNetWorth`, checksums of
  `accounts` and `account_valuations`, and the `/api/v1/overview` body with its time-dependent keys dropped,
  before and after loyalty writes.
- **An over-long bonus** refuses the row only when it would become an instrument (availability yes);
  otherwise it is only counted in `bonus_unplaced`.

## Figure scan

Every tracked file this task added or changed, and this file, were scanned with
`grep -nE '\$[0-9]{2,}|\b[0-9]{1,3},[0-9]{3}\b'`. Outside `apps/web/scripts/fixtures/`, the only matches are
string literals in the test files (`lib/loyalty.test.ts`, `lib/loyaltyImport.test.ts`,
`app/api/v1/loyalty/loyalty.test.ts`) that repeat the spec's fabricated fixture values, or invented values for
the separator and scale rules (a cash value with a third decimal, a comma-grouped value the API must refuse).
Two code comments that quoted fixture values as examples (`lib/domain/loyalty.ts` on `formatBalance` and
`lib/domain/loyaltyImport.ts` on the separator rule) were rewritten as prose after the main run; that was a
comment-only change, after which `tsc` gave `exit=0`, the two unit files passed 9 of 9, and commands 12, 14 and
15 were re-run with the same results as above. No real program balance, label, member name or member number
appears anywhere. Nothing was committed.
