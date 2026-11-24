# P8-42e1 — Evidence (implementer, G3 cycle 2: amendment A5 implemented, full command set re-run)

Tree: `main`, uncommitted, on HEAD `88e0737`. Throwaway database `postgresql://localhost/b8_p42a_throwaway`
only; `b8_finance` was never touched. All data in tests, fixtures and this file is fabricated (`ZQ42E …`
names, `.test` and `example.*` domains, codes made of letters and digits, dates as offsets from Postgres
`CURRENT_DATE`). Before the gate runs, `find apps/web packages -flags +dataless -type f -not -path '*/.next/*' | wc -l`
printed `0`.

Every acceptance command was extracted verbatim from the amended SPEC.md (A0 to A5) between its code
fences and run under `/bin/bash` (never zsh, never through `rtk`), in the spec's order: 1, 2, 3, then 19,
then 4 to 18, 20, 21, 22. Nothing else used the database while a command ran. Outputs below are trimmed of vitest's "JSON
report written to <temp path>" lines, Node's `ExperimentalWarning` lines and Postgres `NOTICE` lines;
nothing else is removed. **Every command is green in cycle 2, each on its first run.**

## What cycle 2 changed (A5, REVIEW-1 N1)

`received_on` is the day a message reached the loyalty inbox. Hotel mail reaches the inbox by forwarding,
so a re-forward of an old confirmation after a cancellation carried a later date and re-booked the stay.

- `lib/domain/loyaltyBooking.ts`: `supersedes(existing, incoming, byHand = false)` first refuses a
  `hotel_booked` mail against a `cancelled` stay unless `byHand`, whatever the dates. All other D8
  rules are unchanged and still apply after it, for mail and by hand alike.
- `lib/loyaltyBookingRead.ts`: `applyBooking` passes `byHand` through. The pass calls it with the
  default (`false`), so the booking-read row is `stale`. The hold's `place` action (D10) passes `true`,
  so a person may re-book a cancelled stay. A typed write (D12) never goes through `supersedes` and may
  set `booked` again.
- `lib/loyaltyBookingStore.ts`: comment only, stating that re-booking is a person's act.
- Tests, with ids and counts unchanged:
  - T42e1-U7: the grid's `cancelled none/earlier hotel_booked` rows are now `false`. The test adds the
    `byHand` rows: a mail into none or earlier evidence applies; equal or later evidence does not.
  - T42e1-I5: title changed, and the "strictly later booking" case is now `stale` and stays cancelled.
    It adds the reviewer's scenario. A past stay is confirmed (received six days ago), cancelled by an
    undated mail (four days ago), and the original confirmation is re-forwarded (yesterday, after the
    cancellation). The result is `stale`, the stay stays `cancelled` with the cancellation as its
    evidence, and the membership's `nightsThisYear` is null.
  - T42e1-I13: a typed write with `state: booked` re-books the cancelled stay (200, same id, `booked`).
  - T42e1-I8: `place` re-books a cancelled stay of the same code. A `place` whose mail was received on
    the same day as the cancellation the stay reflects resolves the item, leaves the stay cancelled, and
    stores `stay_id` null, because the dates still decide by hand.

## Cycle 1 history (superseded, kept for the record)

- Command 2 failed in cycle 1 on a stray call in its own helper; A4 removed it, and in cycle 2 it is green.
- In cycle 1, the first attempt of command 10 listed the carried `T42c1-I3` as failed in one run. That
  scenario has the poll parse messages of 1001 parts, so it depends on CPU load, and this task does not
  touch the poll path. Alone it failed 0 of 8 runs. In cycle 2, command 10 is green on its only run.
- In cycle 1, command 11's first attempt overlapped a probe of mine on the same database. In cycle 2
  nothing overlapped, and it is green on its only run.

## Docs and design system read before writing code

- `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`: route
  handlers, the `params` context argument as a Promise that must be awaited (Next 16), `RouteContext`, and
  reading the request body.
- `apps/web/node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`: the
  `'use client'` boundary and the rule that props crossing it must be serializable (the page passes the
  loader's plain `LoyaltyBookings` object to the client board).
- `.claude/skills/uiux-promax/SKILL.md` in full. **Palette note:** the `Hotel stays` section uses the
  `gray-*` neutrals with `blue-600` for the primary action, `disabled:opacity-50` and the "Saving…" label.
  The skill's tokens and the existing `/travel` loyalty components (`TravelBoard.tsx`,
  `LoyaltyReadQueueItem.tsx`, `LoyaltyRequest.tsx`) all use them. The accounts UI's `slate-*` is not used,
  because the section lives inside the `/travel` board, and mixing the two hues in one board would read
  as a bug. Rule followed: the file I am in.

## Acceptance commands

### 1 — tsc
```
exit=0
```

### 2 — lint, carried (helper corrected by A4)
```
✖ 5 problems (0 errors, 5 warnings)
OK lint 0 errors, warnings not above 5
exit=0
```

### 3 — unit totals, then the 15 new unit scenarios in two zones
```
 Test Files  120 passed (120)
      Tests  1471 passed (1471)
OK unit 120 files 1471 tests
OK 15 scenarios T42e1-U1..U15 each present once and passed; TZ=UTC
OK 15 scenarios T42e1-U1..U15 each present once and passed; TZ=Pacific/Auckland
exit=0
```

### 19 — baseline and stub proof (run fourth, as ordered)
Before the run, every changed and new file was archived (`tar` of `git diff --name-only HEAD` plus the
untracked files, 35 paths). Afterwards each path was compared with `cmp` against the archive:
`cmp bad=0`.
```
ok 15 scenarios fail as required
ok 15 scenarios fail as required
OK stubs fail every scenario
OK tree restored
exit=0
```
**The stub run, per scenario** (cycle 2; every row matches cycle 1). This comes from a second run of a copy of command 19. The copy is
identical except that the final `restore` line also copies the two JSON reports out. It ran under the
same backup and `cmp` (`cmp bad=0` again, and `OK tree restored`). Each scenario's status on the stubbed
tree and the first line of its failure (digit runs of four or more replaced by `N`):

| Scenario | Status | First failure line |
|---|---|---|
| T42e1-U1 | failed | AssertionError: expected { kind: 'none', … } to deeply equal { kind: 'flight', … } |
| T42e1-U2 | failed | AssertionError: expected [ null, null ] to deeply equal [ 'N-03-10', 'N-03-12' ] |
| T42e1-U3 | failed | AssertionError: expected null to be 'ZQ42EAB12' |
| T42e1-U4 | failed | AssertionError: expected null to be 'ZQ42E Harbour Inn' |
| T42e1-U5 | failed | AssertionError: expected { kind: 'none', … } to deeply equal { kind: 'hotel_booked', … } |
| T42e1-U6 | failed | AssertionError: mismatch beats a unique match and a forwarder: expected { kind: 'discard' } … |
| T42e1-U7 | failed | AssertionError: booked later hotel_booked: expected true to be false |
| T42e1-U8 | failed | AssertionError: createBookingReader is exported: expected 'undefined' to be 'function' |
| T42e1-U9 | failed | AssertionError: createBookingReader is exported: expected 'undefined' to be 'function' |
| T42e1-U10 | failed | AssertionError: BOOKING_SCHEMA is exported: expected undefined to be truthy |
| T42e1-U11 | failed | AssertionError: LoyaltyStaySchema is exported as a schema: expected 'undefined' to be 'function' |
| T42e1-U12 | failed | AssertionError: LoyaltyStayCreateRequestSchema is exported as a schema: expected 'undefined' … |
| T42e1-U13 | failed | AssertionError: LoyaltyStaySchema is exported as a schema: expected 'undefined' to be 'function' |
| T42e1-U14 | failed | AssertionError: Hotel stays: expected +0 to be 1 |
| T42e1-U15 | failed | AssertionError: expected +0 to be 1 |
| T42e1-I1 | failed | AssertionError: expected [] to deeply equal [ 'i1-never', 'i1-applied', …(2) ] |
| T42e1-I2 | failed | AssertionError: expected { outcome: 'ok', read: +0, … } to match object { read: 5, recorded: 1, … } |
| T42e1-I3 | failed | AssertionError: expected +0 to be 1 |
| T42e1-I4 | failed | AssertionError: expected null to be 2 |
| T42e1-I5 | failed | TypeError: Cannot read properties of undefined (reading 'state') |
| T42e1-I6 | failed | AssertionError: expected 200 to be 201 |
| T42e1-I7 | failed | AssertionError: expected { outcome: 'ok', read: +0, … } to match object { read: 9, recorded: 2, … } |
| T42e1-I8 | failed | AssertionError: expected 200 to be 401 |
| T42e1-I9 | failed | AssertionError: expected { outcome: 'ok', read: +0, … } to deeply equal { … } |
| T42e1-I10 | failed | AssertionError: expected undefined to match object { membership_id: …, property: null } |
| T42e1-I11 | failed | AssertionError: expected [ 'read', 'digest' ] to deeply equal [ 'read', 'bookings', 'digest' ] |
| T42e1-I12 | failed | TypeError: Cannot read properties of undefined (reading 'safeParse') |
| T42e1-I13 | failed | AssertionError: expected 200 to be 401 |
| T42e1-I14 | failed | AssertionError: expected +0 to be 5 |
| T42e1-I15 | failed | AssertionError: expected +0 to be 1 |

Stated plainly: I5 and I12 fail on a `TypeError`, not an `AssertionError`. Neither message matches the
command's SETUP pattern, so the command counts them as failures. In I5, the stub store wrote no stay and
the test then read `.state` of a missing row. In I12, the stub contracts (HEAD) have no
`LoyaltyBookingsSchema`, and the test calls `.safeParse` on it. Both happen after the scenario's world
is built and its loader or pass has run, so neither is a setup error.

### 4 — carried unit scenarios
```
OK 3 scenarios T42c3-U1..U3 each present once and passed; TZ=UTC
OK 3 scenarios T42c3-U1..U3 each present once and passed; TZ=Pacific/Auckland
OK 6 scenarios T42c2-U1..U6 each present once and passed; TZ=UTC
OK 6 scenarios T42c2-U1..U6 each present once and passed; TZ=Pacific/Auckland
OK 26 scenarios of 42d still pass
exit=0
```

### 5 — dependencies, additions only, untouched file, `raw_mail` set
```
OK dependencies
OK additions only
exit=0
```

### 6 — migration up, down, up with refusals (the migration log)
The command prints its own summary line only; with `NOTICE` lines removed its whole output is:
```
OK migration up-down-up
exit=0
```

### 7 — schema carried, new tables
```
OK schema
OK new tables
exit=0
```

### 8 — contracts diff
```
OK contracts
exit=0
```

### 9 — integration
```
OK 417 tests, T42a-C1-C11 and I1-I11 and T42a2-I1-I3 and T42b-I1-I10 and T42b2-I1-I10 and T42c1-I1-I12 and T42c2-I1-I14 each present once and passed
OK T42c3-I1-I3, T42c4-I1-I6, T42d-I1.1-I1.13, T42d-I2-I11 and T42e1-I1-I15 each present once and passed in their files
OK no fixture rows left
OK no ZQ42E rows or test triggers left
OK new tables empty
exit=0
```

**T20, measured** right after command 9's full integration run, with the spec's own probe:
```
psql postgresql://localhost/b8_p42a_throwaway -Atc "select (select count(*) from loyalty_inbox_booking_reads)||','||(select count(*) from loyalty_stays)"
0,0
```
No existing integration test leaves a row in the new tables. In the 42c2 file, `runDailyJob` runs the
real booking step against a world whose only stored message belongs to an airline program, so there is
nothing to read. In the 42c1 file it runs with no API key, so the step is disabled.

### 10 — integration stability, carried
```
[]
[]
OK failing set stable and within KNOWN
exit=0
```

### 11 — regression block, carried
```
OK 7 scenarios T42c1-U1..U7 each present once and passed; TZ=UTC
OK 7 scenarios T42c1-U1..U7 each present once and passed; TZ=Pacific/Auckland
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
OK fixtures pinned and covered
OK classes
exit=0
```

### 12 — surface over real HTTP, H17
Port 3198 was free beforehand (`0`). Each PASS line is cut to its first words here; the full lines
hold only counts, phrases and dates.
```
H1 PASS 22 page.tsx files on disk, all 22 classified (8 text-bearing)
H2 PASS 22 pages as the recipient: all 200, 0 hold the canary in any case; …
H3 PASS the giver sees the canary on /transactions, …
H4 PASS with the reveal date yesterday the recipient sees the canary on all 5 pages; …
H5 PASS recipient searches (full, prefix, payee) render the nonsense block …
H6 PASS merchant rule on the gift's payee counts 0 rows for the recipient and 1 for the giver; …
H7 PASS 24 alternating giver/recipient requests over 6 pages and routes: …
H8 PASS dev-server output …: 0 lines hold the canary in any case, …
H9 PASS RSC: 1 /transactions as the recipient: …, ordinary row present, canary absent
H10 PASS giver's /gifts lists the gift and its criterion; …
H11 PASS /travel and /api/v1/loyalty as both users: 200, label and masked suffix present, …
H12 PASS both users, 8 steps over /travel, /accounts/zq41b_check_card and /api/v1/loyalty: …
H13 PASS both users, 8 fixture steps over /travel, /accounts/zq41b_check_card and /api/v1/loyalty: …
H14 PASS both users, /travel and /api/v1/loyalty before and after the poll: …
H15 PASS both users, /travel and /api/v1/loyalty: 21 phrases present and 2 absent with reading not set up; …
H16 PASS both users: /travel carries the control once per membership and once per due entry, …
H17 PASS both users: the stays route is 401 with no credential, 403 for a read-scope token, 400 for six refused bodies, 201 for a completed and an upcoming stay and 200 for the same code again; /travel shows "Hotel stays" once and "2 nights counted in <year>" once with both lists and masked codes, the same section for both people; the tap is 401, 403, 200 placed_by_hand, then 409, and the stay appears; a typed cancellation leaves the dash and the row stored as cancelled; H15's 2 absent phrases stay absent and H16's control count holds; … responses hold no full code or member number
OK H1-H17
OK surface
exit=0
```

### 13 — fixture pins, carried
```
fixture shape ok
OK new fixtures pinned and covered
fixture shape ok
OK fixtures pinned and covered
OK no fixture changed
exit=0
```

### 14 — registry
```
OK registry
exit=0
```

### 15 — the pin edits by exact diff (A3 included)
```
OK pins exact
exit=0
```

### 16 — source guards
```
OK source guards
exit=0
```

### 17 — scope
```
OK scope
exit=0
```

### 18 — census
```
OK census exact
exit=0
```

### 20 — build
```
✓ Compiled successfully
✓ Generating static pages using 7 workers (46/46)
exit=0
```

### 21 — this spec's public-safety scan
```
OK spec has no money-looking text
exit=0
```

### 22 — mutation evidence
Run after this file was written. Rows with a letter suffix (M1b and the others) do not match the
command's `M[0-9]+` pattern, so only the numbered rows are counted.
```
OK mutation evidence rows 33
exit=0
```

## The nights table, observed (T42e1-I12)

Rows are the I12 cases. Dates are SQL offsets from `CURRENT_DATE`, or from 1 January of the current
year (`jan1`). All rows passed on the real code. On the stubbed tree (command 19), I12 failed as a whole
before any row was compared (see the stub table).

| Case | Membership | Check-in | Check-out | State | Counted | Nights contributed |
|---|---|---|---|---|---|---|
| out today | A | today − 2 | today | booked | yes | 2 |
| out tomorrow | A | today − 1 | today + 1 | booked | no | — |
| cancelled | A | today − 6 | today | cancelled | no | — |
| spans the new year | A | jan1 − 3 | jan1 | booked | yes (check-out year) | 3 |
| last year | A | jan1 − 3 | jan1 − 1 | booked | no | — |
| other membership | B | today − 4 | today | booked | yes | 4 |
| only cancelled | C | today − 4 | today | cancelled | no | — |
| a held booking with past dates | none | today − 3 | today − 1 | held, not a stay | no | — |

Per-membership `nightsThisYear`: A = 5, B = 4, C = null (never 0). The airline membership is not in
`nights`. `completed` lists exactly the three counted stays (2, 3 and 4 nights). Two loads in a row are
equal, and the payload parses under `LoyaltyBookingsSchema`.

## The decision table, observed

T42e1-U6 (pure `placeBooking`; membership ids are the test's fabricated 11 and 12):

| Program check | Suffix | Suffix match | Forwarder | Not-mine hit | Decision |
|---|---|---|---|---|---|
| mismatch | yes | unique 11 | 11 | no | hold `program_mismatch` |
| mismatch | no | — | none | no | hold `program_mismatch` |
| match | yes | unique 11 | none | no | place 11 |
| match | yes | unique 11 | 11 | no | place 11 |
| match | yes | unique 11 | 12 | no | hold `forwarder_conflict` (and NOT place, the negative control) |
| match | no | — | 12 | no | place 12 |
| not_stated | no | — | 12 | no | place 12 |
| match | no | — | none | no | hold `no_suffix` |
| match | yes | unmatched | none | no | hold `unmatched_suffix` |
| match | yes | unmatched | none | yes | discard |
| match | yes | ambiguous | none | no | hold `ambiguous_suffix` |
| match | yes | ambiguous | 11 | no | hold `ambiguous_suffix` |
| match | yes | unmatched | 12 (unnumbered) | no | hold `unmatched_suffix` |

T42e1-I7 (through the real pass; memberships A and B of one person each, plus two memberships whose
numbers share one suffix; read state and reason as stored):

| Case | Forwarder | Printed suffix | Program stated | Decision observed |
|---|---|---|---|---|
| forwarder | A's person | none | no | recorded on A |
| suffix | none | A's | no | recorded on A |
| conflict | B's person | A's | no | pending `forwarder_conflict` |
| unmatched | none | matches no one | no | pending `unmatched_suffix` |
| ambiguous | none | shared by two | no | pending `ambiguous_suffix` |
| ambiguous with forwarder | A's person | shared by two | no | pending `ambiguous_suffix` |
| nobody | none | none | no | pending `no_suffix` |
| mismatch | A's person | none | another brand | pending `program_mismatch` |
| not mine | none | on the not-mine list | no | `not_mine_known`, discarded, not in the queue |

Run totals: read 9, recorded 2, queued 6, discarded 1. Only the two recorded bookings are stays, both on A.

## The supersession grid, observed (T42e1-U7 after A5, all rows passed)

"Evidence" is the existing stay's evidence date compared with the incoming mail's received date. The
"Mail" column is the pass, which never acts by hand. The "By hand" column is the hold's `place` action,
shown for the four rows A5 concerns.

| Existing state | Evidence vs mail | Incoming kind | Mail applies | By hand applies |
|---|---|---|---|---|
| booked | none | booking | yes | |
| booked | none | cancellation | yes | |
| booked | earlier | booking | yes | |
| booked | earlier | cancellation | yes | |
| booked | equal | booking | yes | |
| booked | equal | cancellation | yes | |
| booked | later | booking | no | |
| booked | later | cancellation | no | |
| cancelled | none | booking | **no** (was yes before A5) | yes |
| cancelled | none | cancellation | yes | |
| cancelled | earlier | booking | **no** (was yes before A5) | yes |
| cancelled | earlier | cancellation | yes | |
| cancelled | equal | booking | no | no |
| cancelled | equal | cancellation | yes | |
| cancelled | later | booking | no | no |
| cancelled | later | cancellation | no | |

## Mutation evidence

Each row is one single-line change to the named file, made by a script. The script runs the named
test filtered to that scenario, requires it to fail, writes the file back byte for byte (asserting
equality), and runs it again, requiring it to pass. A row whose ids carry a letter suffix is the same
change run against a second scenario.

All rows were run again in cycle 2, after A5. The full batch of 41 runs gave 40 that failed when
mutated and passed when restored. The one survivor was M8b against T42e1-I5. M8b makes the last
(equal-day) line of `supersedes` return `true`. After A5, a mailed booking into a cancelled stay is
already refused by the new first rule, so for mail the equal-day line is no longer the one that refuses
it, and I5 could not see the break. The equal-day line still matters by hand. So T42e1-I8 gained a
`place` received the same day as the cancellation, and M8b, re-run against I8 with the other I8 rows
(M14, M27, M33), failed when mutated and passed when restored. After each batch, every changed and new
path was compared with `cmp` against the pre-batch archive (`cmp bad=0`), and the new tables were
empty with no `zq42e` trigger left.

| Id | File and change | Failing test | Mutated | Outcome |
|---|---|---|---|---|
| M1 | `lib/loyaltyBookingStore.ts`: the counted rule admits cancelled stays (`state IN ('booked', 'cancelled')`) | T42e1-I12 | FAIL | reverted, green |
| M1b | the same change as M1 | T42e1-I4 | FAIL | reverted, green |
| M2 | `lib/loyaltyBookingStore.ts`: `check_out <= CURRENT_DATE` becomes `<` | T42e1-I12 | FAIL | reverted, green |
| M3 | `lib/loyaltyBookingStore.ts`: count by the check-in year instead of the check-out year | T42e1-I12 | FAIL | reverted, green |
| M4 | `lib/loyaltyBookingStore.ts`: `coalesce(sum(nights), 0)`, a zero instead of null | T42e1-I12 | FAIL | reverted, green |
| M5 | `lib/loyaltyBookingRead.ts`: the existing-stay lookup misses the (program, code) row, so a change does not reach it | T42e1-I3 | FAIL | reverted, green |
| M6 | `lib/domain/loyaltyBooking.ts`: the code is kept raw, not normalised | T42e1-U3 | FAIL | reverted, green |
| M6b | the same change as M6 | T42e1-I3 | FAIL | reverted, green |
| M7 | `lib/domain/loyaltyBooking.ts`: an earlier mail supersedes (`return false` becomes `return true`) | T42e1-U7 | FAIL | reverted, green |
| M7b | the same change as M7 | T42e1-I5 | FAIL | reverted, green |
| M8 | `lib/domain/loyaltyBooking.ts`: an equal-dated mail always applies, so a booking re-books a cancelled stay | T42e1-U7 | FAIL | reverted, green |
| M8b | the same change as M8 (the equal-day rule, reached by hand after A5) | T42e1-I8 | FAIL | reverted, green |
| M9 | `lib/loyaltyBookingStore.ts`: a typed update clears `evidence_received_on` | T42e1-I6 | FAIL | reverted, green |
| M10 | `lib/loyaltyBookingRead.ts`: an applied mail also rewrites the stay's membership | T42e1-I6 | FAIL | reverted, green |
| M11 | `lib/domain/loyaltyBooking.ts`: a contradicting forwarder places on the forwarder | T42e1-U6 | FAIL | reverted, green |
| M11b | the same change as M11 | T42e1-I7 | FAIL | reverted, green |
| M12 | `lib/domain/loyaltyBooking.ts`: an ambiguous suffix is resolved, by the forwarder when there is one | T42e1-U6 | FAIL | reverted, green |
| M12b | the same change as M12 | T42e1-I7 | FAIL | reverted, green |
| M13 | `lib/domain/loyaltyBooking.ts`: the not-mine check is skipped | T42e1-I7 | FAIL | reverted, green |
| M14 | `lib/loyaltyBookingRead.ts`: place accepts a membership of another program | T42e1-I8 | FAIL | reverted, green |
| M15 | `app/api/v1/loyalty/stays/route.ts`: the body is pulled before the caller is resolved | T42e1-I13 | FAIL | reverted, green |
| M27 | `app/api/v1/loyalty/inbox/bookings/[id]/route.ts`: the body is pulled before the caller is resolved | T42e1-I8 | FAIL | reverted, green |
| M16 | `lib/loyaltyBookingRead.ts`: only messages with no balance-read row are candidates | T42e1-I1 | FAIL | reverted, green |
| M17 | `lib/loyaltyBookingRead.ts`: the booking pass builds the balance reader | T42e1-I1 | FAIL | reverted, green |
| M18 | `lib/domain/loyaltyBooking.ts`: the cleaned booking keeps a guest-name key | T42e1-U1 | FAIL | reverted, green |
| M19 | `lib/loyaltyBookingStore.ts`: the loader emits the full code as `maskedCode` | T42e1-I10 | FAIL | reverted, green |
| M19b | the same change as M19 | T42e1-I14 | FAIL | reverted, green |
| M20 | `lib/loyaltyReader.ts`: the booking reader's failure log carries the error text | T42e1-U9 | FAIL | reverted, green |
| M28 | `lib/loyaltyBookingStore.ts`: the typed-save log carries the confirmation code | T42e1-I10 | FAIL | reverted, green |
| M21 | `lib/loyaltyReader.ts`: the booking request allows two SDK retries | T42e1-U8 | FAIL | reverted, green |
| M22 | `lib/loyaltyReader.ts`: `READ_SCHEMA` gains a property | T42e1-U10 | FAIL | reverted, green |
| M23 | `lib/loyaltyBookingRead.ts`: an undated cancellation deletes the stay | T42e1-I4 | FAIL | reverted, green |
| M24 | `lib/loyaltyBookingRead.ts`: the retention purge also deletes old stays | T42e1-I11 | FAIL | reverted, green |
| M25 | `lib/loyaltyBookingRead.ts`: a flight is handled like a hotel booking | T42e1-I2 | FAIL | reverted, green |
| M26 | `lib/loyaltyBookingRead.ts`: no attempt row is written before the reader is called | T42e1-I9 | FAIL | reverted, green |
| M29 | `lib/domain/loyaltyBooking.ts`: `nightsBetween` counts one night too many | T42e1-U2 | FAIL | reverted, green |
| M30 | `lib/loyaltyBookingStore.ts`: upcoming stays ordered by check-in descending | T42e1-I14 | FAIL | reverted, green |
| M31 | `lib/loyaltyBookingStore.ts`: a code recorded under another membership is no longer refused | T42e1-I13 | FAIL | reverted, green |
| M32 | `lib/domain/loyaltyBooking.ts`: the A5 rule is dropped, so a later emailed booking revives a cancelled stay | T42e1-U7 | FAIL | reverted, green |
| M32b | the same change as M32 | T42e1-I5 | FAIL | reverted, green |
| M33 | `lib/loyaltyBookingRead.ts`: the hold's `place` passes `byHand` false, so a person cannot re-book a cancelled stay | T42e1-I8 | FAIL | reverted, green |

How some changes differ from the spec's wording. The spec's M4 also names T42e1-U14; U14 is a source
scan of the component, and M4 changes the store, so its row names I12. The spec's M12 says "by order";
`SuffixMatch` carries no candidate list to order, so the break lets the forwarder decide an ambiguous
suffix instead, which is the other way an ambiguity gets guessed. The spec's M19 also names T42e1-U11,
the contracts test; the contracts are frozen, so the store is broken instead and rows M19 and M19b name
I10 and I14. M5 cannot drop the database's UNIQUE constraint (the migration is frozen), so it breaks
the lookup that relies on it.

## Accepted residuals (from the spec, one sentence each)

1. The property name is model text: it is bounded by length and markup rules and escaped on render.
2. A cancellation that arrives before any confirmation and states no dates is lost.
3. Mail older than the raw retention cannot be read, so history before this task goes back at most
   thirty days.
4. A statement mail that also carries a booking is read twice by design, at the cost of one extra call.
5. The first attribution of a stay is sticky: a wrong first placement is corrected by hand, not by
   later mail.
6. The typed route requires a confirmation code, so a stay with no code cannot be entered by hand.
7. (A5) A re-forward of an old confirmation can still overwrite fields of a booked stay that a later
   typed correction set, if it arrives after that correction; the person retypes.

Also stated for G3 (A2): `normaliseConfirmationCode` and `nightsBetween` exist both as private helpers
in `packages/contracts/loyalty.ts` and as exports of `lib/domain/loyaltyBooking.ts`. T42e1-U2 and U3
pin the domain side to the contract's rules.
