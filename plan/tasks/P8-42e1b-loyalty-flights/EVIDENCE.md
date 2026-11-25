# EVIDENCE — P8-42e1b-loyalty-flights

Implementer evidence for the frozen SPEC (amendments A3, A4 and A5 applied). Every command was run from the repo
root under macOS `/bin/bash` 3.2, in the spec's run order (1, 2, 3, 19, then 4 to 18 and 20 to 22), against
`postgresql://localhost/b8_p42a_throwaway`, with `ANTHROPIC_API_KEY` unset. Outputs below are the command's own
lines, trimmed only of `JSON report written to …` paths, the structured log lines tests print (`{"time": …}`), the auth-table-missing log line the integration config
prints, and in commands 9 to 11 everything but the `OK`, `FAIL`, `[]` and `rc=` lines (test chatter such as the carried lock-wait diagnostics and re-identification dumps of fabricated rows) and, in command 12, the tail of
each `H<n> PASS` line (marked `…`). Nothing here is from the owner's ledger.

## Reading done before writing code

- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` (route handlers in Next 16).
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (the `params` promise of a
  dynamic segment, and reading a request body: `await request.json()` / the body stream).
- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` (only serialisable
  props cross into `LoyaltyFlightsSection`, a client component; the loaders run on the server page).
- `.claude/skills/uiux-promax/SKILL.md`. The /travel loyalty components use the `gray-*` palette with the blue-600
  primary button, `disabled:opacity-50` and `Saving…`; the new section follows the file it sits beside
  (`LoyaltyStaysSection.tsx`), not the accounts UI's `slate-*`. No conflict between the two arose in this file.

## Acceptance commands

**#1**
```
exit=0
```
**#2** (lint, carried; the five warnings are pre-existing)
```
✖ 5 problems (0 errors, 5 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
OK lint 0 errors, warnings not above 5
rc=0
```
**#3**
```
 Test Files  124 passed (124)
      Tests  1485 passed (1485)
OK unit 124 files 1485 tests
OK 14 scenarios T42e1b-U1..U14 each present once and passed; TZ=UTC
OK 14 scenarios T42e1b-U1..U14 each present once and passed; TZ=Pacific/Auckland
rc=0
```
**#19** (run fourth, as the run order requires; the work was backed up to a scratch directory first and every one of
the 34 changed or new files compared with `cmp` afterwards: 0 differences)
```
(node:64008) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:64008) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:64016) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:64016) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
ok 14 scenarios fail as required
ok 14 scenarios fail as required
OK stubs fail every scenario
OK tree restored
rc=0
```
Each `ok 14 scenarios fail as required` line is the command's own check that every one of the 14 unit and the 14
integration scenarios is present once, `failed`, and failed on an assertion rather than a setup error.

**#4**
```
OK 3 scenarios T42c3-U1..U3 each present once and passed; TZ=UTC
OK 3 scenarios T42c3-U1..U3 each present once and passed; TZ=Pacific/Auckland
OK 6 scenarios T42c2-U1..U6 each present once and passed; TZ=UTC
OK 6 scenarios T42c2-U1..U6 each present once and passed; TZ=Pacific/Auckland
OK 26 scenarios of 42d still pass
OK 15 scenarios of 42e1 still pass
rc=0
```
**#5**
```
OK dependencies
OK additions only
rc=0
```
**#6** (the command prints only its final line; its body asserts the refusals, the 42e1 rows and the memberships
index surviving the down, and up again)
```
OK migration up-down-up
rc=0
```
**#7**
```
OK schema
OK new tables
rc=0
```
**#8**
```
OK contracts
rc=0
```
**#9** (after amendment A4)
```
OK 431 tests, T42a-C1-C11 and I1-I11 and T42a2-I1-I3 and T42b-I1-I10 and T42b2-I1-I10 and T42c1-I1-I12 and T42c2-I1-I14 each present once and passed
OK T42c3-I1-I3, T42c4-I1-I6, T42d-I1.1-I1.13, T42d-I2-I11, T42e1-I1-I15 and T42e1b-I1-I14 each present once and passed in their files
OK no fixture rows left
OK no ZQ42E rows or test triggers left
OK new tables empty
rc=0
```
Before A4 the same command stopped at `FAIL /^T42e1-I(1|2|3|4|5|6|7|8|9|10|11):/ files=2`: the `8` branch matched
`T42e1-I8:` in `loyaltyBookings.test.ts`. Reported, fixed by A4, re-run green as above.

A load flake was seen ONCE, in the first full run of command 9 (before A4): `FAIL T41b-G10: with no gift category
designated, creation is GIFT_CATEGORY_UNSET and stores nothing  total=431`, the failure message being `Hook timed
out in 10000ms` at `apps/web/app/api/v1/gifts/gifts.test.ts:40` (its `beforeEach`). That file run alone passed 11
of 11, and every later full run (two of command 9, one of command 10's chain) passed it. No file of this task is
involved.

**#10**
```
[]
[]
OK failing set stable and within KNOWN
rc=0
```
**#11**
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
rc=0
```
**#12**
```
H1 PASS 22 page.tsx files on disk, all 22 classified (8 text-bearing) …
H2 PASS 22 pages as the recipient: all 200, 0 hold the canary in any case; /transactions l …
H3 PASS the giver sees the canary on /transactions, /accounts/zq41b_check_card, /categorie …
H4 PASS with the reveal date yesterday the recipient sees the canary on all 5 pages; moved …
H5 PASS recipient searches (full, prefix, payee) render the nonsense block {"count":"0","r …
H6 PASS merchant rule on the gift's payee counts 0 rows for the recipient and 1 for the gi …
H7 PASS 24 alternating giver/recipient requests over 6 pages and routes: each viewer alway …
H8 PASS dev-server output (7469 bytes): 0 lines hold the canary in any case, besides 3 acc …
H9 PASS RSC: 1 /transactions as the recipient: 13716 bytes, ordinary row present, canary a …
H10 PASS giver's /gifts lists the gift and its criterion; recipient's lists none and holds …
H11 PASS /travel and /api/v1/loyalty as both users: 200, label and masked suffix present,  …
H12 PASS both users, 8 steps over /travel, /accounts/zq41b_check_card and /api/v1/loyalty: …
H13 PASS both users, 8 fixture steps over /travel, /accounts/zq41b_check_card and /api/v1/ …
H14 PASS both users, /travel and /api/v1/loyalty before and after the poll: the panel show …
H15 PASS both users, /travel and /api/v1/loyalty: 21 phrases present and 2 absent with rea …
H16 PASS both users: /travel carries the control once per membership and once per due entr …
H17 PASS both users: the stays route is 401 with no credential, 403 for a read-scope token …
H18 PASS both users: the segments route is 401 with no credential, 403 for a read-scope to …
OK H1-H18
OK surface
rc=0
```
The first run of command 12 printed `H1` to `H18 PASS` and `OK H1-H18`, then exited 1 without a message: the
script named `/api/v1/loyalty/segments` and `/api/v1/loyalty/inbox/flights/` once each where the command requires
at least two. Fixed in this task's own file by naming both routes in H18's header comment in
`apps/web/scripts/gifts-surface-check.mjs` (added lines only); the run above is after that fix.

**#13**
```
fixture shape ok
OK new fixtures pinned and covered
fixture shape ok
OK fixtures pinned and covered
OK no fixture changed
rc=0
```
**#14**
```
OK registry
rc=0
```
**#15** (after amendment A5; before it, bash 3.2 brace-expanded the mock pattern inside `"$( … )"` and the command
printed `FAIL apps/web/app/api/v1/loyalty/loyaltyRead.test.ts lacks the flight reader mock` on any tree)
```
OK pins exact
rc=0
```
**#16**
```
OK source guards
rc=0
```
**#17**
```
OK scope
rc=0
```
**#18**
```
OK census exact
rc=0
```
**#20** (tail)
```
exit=0
```
**#21**
```
OK spec has no money-looking text
rc=0
```
**#22** — superseded (orchestrator, after A6). The implementer's run failed because no row covered the contract scenario
U10; the orchestrator added M33 under the contract lease, and command 22 then printed:
```
OK mutation evidence rows 33
```
The id is redacted in this one output line. Command 22 matches the id on any line, so quoting it verbatim would make the command pass for a row that does not exist.

## T20, measured twice

The probe: `select (select count(*) from loyalty_inbox_booking_reads)||','||(select count(*) from loyalty_stays)||','||(select count(*) from loyalty_inbox_flight_reads)||','||(select count(*) from loyalty_segments)`.

- **Before** the clean-up pin. `loyaltyRead.test.ts` was run alone with its `createFlightReader` mock line present
  and its `DELETE FROM loyalty_inbox_flight_reads` clean-up line removed. The mock had to stay: without it the real
  daily job in T42c2-I13 would build a real SDK client with the test's key, which this task must never do.
  ```
    × T42c2-I13: the daily job reads after the poll and before the digest, and a read failure never costs the digest or leaks 37ms
       × T42c2-I14: the reader receives exactly the subject and text of each stored message, bounded, and nothing for a message with nothing to read 9ms
  ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
   Test Files  1 failed (1)
        Tests  2 failed | 12 passed (14)
  0,0,1,0
  restored
  ```
  The real daily job reached the flight step (a flight-read ledger row appeared on the suite's airline program), and
  the row then blocked the deletion of the suite's programs (the two failing tests are the ones after it in the
  file). The file was restored from the backup (`cmp` clean, `restored` above), the leftover row deleted from the
  throwaway database, and the file re-run: 14 of 14 passed.
- **After** (the full integration run of command 9 after A4): `0,0,0,0`.

## The supersession grid, observed (T42e1b-U4)

Printed by calling `flightSupersedes` from `apps/web/lib/domain/loyaltyFlight.ts` with a mail received 2026-03-05;
"group evidence vs mail" is the group's latest evidence date (none, earlier 2026-03-04, equal, later 2026-03-06).

| group state | group evidence vs mail | incoming | by hand | supersedes |
|---|---|---|---|---|
| booked | none | flight_booked | false | true |
| booked | none | flight_booked | true | true |
| booked | none | flight_cancelled | false | true |
| booked | none | flight_cancelled | true | true |
| booked | earlier | flight_booked | false | true |
| booked | earlier | flight_booked | true | true |
| booked | earlier | flight_cancelled | false | true |
| booked | earlier | flight_cancelled | true | true |
| booked | equal | flight_booked | false | true |
| booked | equal | flight_booked | true | true |
| booked | equal | flight_cancelled | false | true |
| booked | equal | flight_cancelled | true | true |
| booked | later | flight_booked | false | false |
| booked | later | flight_booked | true | false |
| booked | later | flight_cancelled | false | false |
| booked | later | flight_cancelled | true | false |
| cancelled | none | flight_booked | false | false |
| cancelled | none | flight_booked | true | true |
| cancelled | none | flight_cancelled | false | true |
| cancelled | none | flight_cancelled | true | true |
| cancelled | earlier | flight_booked | false | false |
| cancelled | earlier | flight_booked | true | true |
| cancelled | earlier | flight_cancelled | false | true |
| cancelled | earlier | flight_cancelled | true | true |
| cancelled | equal | flight_booked | false | false |
| cancelled | equal | flight_booked | true | false |
| cancelled | equal | flight_cancelled | false | true |
| cancelled | equal | flight_cancelled | true | true |
| cancelled | later | flight_booked | false | false |
| cancelled | later | flight_booked | true | false |
| cancelled | later | flight_cancelled | false | false |
| cancelled | later | flight_cancelled | true | false |

## The candidate table, observed (T42e1b-I1)

| message | program kind | prior flight-read row | other rows | fake called |
|---|---|---|---|---|
| A1 | airline | none | — | yes (second) |
| A2 | airline | none, oversize with no bytes | — | no |
| A3 | airline | `none` | — | no |
| A4 | airline | `retry`, one attempt | — | yes (first: oldest) |
| A5 | airline | `failed`, three attempts | — | no |
| A6 | airline (second program) | none | — | yes (third) |
| H1 | hotel | none | 42e1 booking-read row in `flight` | no; the `flight` row unchanged |
| H2 | hotel | none | a 42c2 balance read | no |
| card | card_currency | none | — | no |
| car | car | none | — | no |

A second run called the fake for nothing. With 26 more airline messages, one run read 25 and reported
`remaining: 1`, and the next read the last one. The four neighbour tables' checksums were equal before and after.

## The identity and replacement table, observed (T42e1b-I3, T42e1b-U5)

T42e1b-I3, one code `ZQ42EIT01` on airline program A unless stated; the row count is the program's.

| step | existing | mail legs | complete | result | rows |
|---|---|---|---|---|---|
| 1 | none | A, B | true | A, B inserted booked | 2 |
| 2 | A, B booked | A with a new origin, B | false | A rewritten (same id, `updated_at` moved), B untouched | 2 |
| 3 | A, B booked | A, B' (B's flight on a new date) | false | A rewritten, B untouched (booked), B' inserted | 3 |
| 4 | A, B, B' booked | A, B' | true | B cancelled, nothing deleted | 3 |
| 5 | plus a typed leg T | A, B' | true | T untouched (booked, typed) | 4 |
| 6 | as above | A (code spelled `zq42e-it01`) | false | same rows | 4 |
| 7 | none in program A2 | A, in a second airline program | false | a separate row in A2; A unchanged | 4 and 1 |
| 8 | none (code IT02) | A twice (second with another origin) | false | one row | 1 |
| 9 | IT01 rows on Ana's membership | A with a new origin, forwarded by Ben | false | rewritten where they are; ledger row's membership is Ana's | 5 in the program |

T42e1b-U5, the plan (`planFlight`) for a booked mail:

| existing | mail legs | complete | by hand | insert | rewrite | cancel | rebook | applies |
|---|---|---|---|---|---|---|---|---|
| none | A, B | false | no | A, B | — | — | — | true |
| A booked | A with a new origin | false | no | — | A | — | — | true |
| A, B booked | A, B on a new date | true | no | B new | A | B | — | true |
| A, B booked | A, B with a new number | true | no | B new | A | B | — | true |
| A, B booked | A, B on a new date | false | no | B new | A | — | — | true |
| A booked, B typed booked | A | true | no | — | A | — | — | true |
| A booked, B cancelled | A, B | false | no | — | A | — | — | true |
| A booked, B cancelled | A, B | false | yes | — | A | — | B | true |
| A booked, B cancelled | A | true | no | — | A | — | — | true |
| A booked, newer evidence | A, B | true | no | — | — | — | — | false |
| A, B cancelled | A, B | true | no | — | — | — | — | false |
| A, B cancelled | A | false | yes | — | — | — | A | true |

On the command-19 stubs every one of these scenarios failed (T42e1b-U5 and T42e1b-I3 among the 28 checked).

## The decision table, observed (T42e1b-I6)

| case | forwarder | suffix in mail | other input | decision |
|---|---|---|---|---|
| forwarder | Ana | none | — | place on Ana's membership |
| suffix | none | Ana's | — | place on Ana's membership |
| conflict | Ben | Ana's | — | hold, `forwarder_conflict` |
| unmatched | none | matches no one | — | hold, `unmatched_suffix` |
| ambiguous | none | shared by Dee and Eve | — | hold, `ambiguous_suffix` |
| ambiguous with forwarder | Ana | shared by Dee and Eve | — | hold, `ambiguous_suffix` |
| nobody | none | none | — | hold, `no_suffix` |
| mismatch | Ana | none | another program name | hold, `program_mismatch` |
| not mine | none | on the not-mine list | — | discard (`not_mine_known`) |
| cancellation | none | none | a leg of a booked code | hold, `no_suffix`; the leg stays booked |

The run reported `recorded: 2, queued: 7, discarded: 1`. Each held row carries `booking` with exactly the keys
`award, code, complete, kind, legs` and no membership. Only the two placed bookings became segments.

## Mutation evidence (command 22)

Each row is one single-line break applied by a scratch harness, then the four unit files and the two integration
files were run, and the failing ids were recorded from the JSON reports. The file was then restored from the backup
and compared with `cmp`. After all rows: the 34 changed files equal the backup (the only other difference is
the coordinator's SPEC amendments); unit 14 of 14 and integration 14 of 14 passed; 0 leftover rows or triggers.

| id | change | failing test ids | result | after |
|---|---|---|---|---|
| M1 | `apps/web/lib/loyaltyFlightRead.ts`: reads hotel-kind mail in the flight pass | T42e1b-I1, T42e1b-I14 | FAIL | reverted, green |
| M2 | `apps/web/lib/loyaltyFlightRead.ts`: drops the airline filter from the candidate rule | T42e1b-I1, T42e1b-I14 | FAIL | reverted, green |
| M3 | `apps/web/lib/loyaltyFlightRead.ts`: re-reads settled failed ledger rows | T42e1b-I1 | FAIL | reverted, green |
| M4 | `apps/web/lib/loyaltyFlightRead.ts`: treats a refusal as retryable | T42e1b-I7 | FAIL | reverted, green |
| M5 | `apps/web/lib/domain/loyaltyFlight.ts`: keeps the valid legs of a mail with an invalid one | T42e1b-U11, T42e1b-U2, T42e1b-I2 | FAIL | reverted, green |
| M6 | `apps/web/lib/domain/loyaltyFlight.ts`: widens the plausibility window by a day | T42e1b-U3 | FAIL | reverted, green |
| M7 | `apps/web/lib/loyaltyFlightRead.ts`: drops the plausibility window from the pass | T42e1b-I2 | FAIL | reverted, green |
| M8 | `apps/web/lib/domain/loyaltyFlight.ts`: keys leg identity without the flight number | T42e1b-U2, T42e1b-U5, T42e1b-I2 | FAIL | reverted, green |
| M9 | `apps/web/lib/domain/loyaltyFlight.ts`: keys leg identity with the origin | T42e1b-U2, T42e1b-U5, T42e1b-I3 | FAIL | reverted, green |
| M10 | `apps/web/lib/domain/loyaltyFlight.ts`: cancels omitted legs when complete is false | T42e1b-U5, T42e1b-I3 | FAIL | reverted, green |
| M11 | `apps/web/lib/domain/loyaltyFlight.ts`: cancels omitted typed legs | T42e1b-U5, T42e1b-I3 | FAIL | reverted, green |
| M12 | `apps/web/lib/domain/loyaltyFlight.ts`: skips cancelling omitted legs when complete is true | T42e1b-U5, T42e1b-I3 | FAIL | reverted, green |
| M13 | `apps/web/lib/domain/loyaltyFlight.ts`: widens a one-leg cancellation to the whole booking | T42e1b-U6, T42e1b-I4 | FAIL | reverted, green |
| M14 | `apps/web/lib/domain/loyaltyFlight.ts`: lets mail revive a cancelled group | T42e1b-U4, T42e1b-U5, T42e1b-I4 | FAIL | reverted, green |
| M15 | `apps/web/lib/loyaltyFlightRead.ts`: decides staleness after attribution, so a re-forward is held | T42e1b-I4 | FAIL | reverted, green |
| M16 | `apps/web/lib/loyaltyFlightRead.ts`: applies an unplaced cancellation | T42e1b-I6 | FAIL | reverted, green |
| M17 | `apps/web/lib/domain/loyaltyFlight.ts`: lets an older mail apply | T42e1b-U4, T42e1b-U5, T42e1b-U6, T42e1b-I5 | FAIL | reverted, green |
| M18 | `apps/web/lib/loyaltyFlightStore.ts`: lets a typed write clear the evidence | T42e1b-I5 | FAIL | reverted, green |
| M19 | `apps/web/lib/loyaltyFlightRead.ts`: lets a mail move a code to another membership | T42e1b-I3 | FAIL | reverted, green |
| M20 | `apps/web/lib/loyaltyFlightRead.ts`: ignores the forwarder in attribution | T42e1b-I2, T42e1b-I3, T42e1b-I4, T42e1b-I5, T42e1b-I6, T42e1b-I14 | FAIL | reverted, green |
| M21 | `apps/web/lib/loyaltyFlightRead.ts`: places with a membership of another program | T42e1b-I10 | FAIL | reverted, green |
| M22 | `apps/web/lib/loyaltyFlightRead.ts`: records the not-mine pair without idempotence | T42e1b-I10 | FAIL | reverted, green |
| M23 | `apps/web/app/api/v1/loyalty/inbox/flights/[id]/route.ts`: reads the body before resolving the caller (tap route) | T42e1b-I10 | FAIL | reverted, green |
| M24 | `apps/web/app/api/v1/loyalty/segments/route.ts`: reads the body before resolving the caller (segments route) | T42e1b-I11 | FAIL | reverted, green |
| M25 | `apps/web/lib/loyaltyFlightStore.ts`: emits the full confirmation code | T42e1b-I5, T42e1b-I8, T42e1b-I11, T42e1b-I12, T42e1b-I13 | FAIL | reverted, green |
| M26 | `apps/web/lib/domain/loyaltyFlight.ts`: keeps a passenger-name key | T42e1b-U1 | FAIL | reverted, green |
| M27 | `apps/web/lib/loyaltyFlightStore.ts`: logs an airport | T42e1b-I8 | FAIL | reverted, green |
| M28 | `apps/web/lib/loyaltyReader.ts`: opens the flight schema to extra keys | T42e1b-U9 | FAIL | reverted, green |
| M29 | `apps/web/lib/loyaltyFlightRead.ts`: moves the retention boundary by a day | T42e1b-I9 | FAIL | reverted, green |
| M30 | `apps/web/lib/loyaltyFlightStore.ts`: adds a count key to the payload | T42e1b-I12 | FAIL | reverted, green |
| M31 | `apps/web/components/LoyaltyFlightsSection.tsx`: renders a zero for no flights | T42e1b-U13, T42e1b-U14, T42e1b-I13 | FAIL | reverted, green |
| M32 | `apps/web/lib/loyaltyFlightStore.ts`: drops the lower bound of the recent window | T42e1b-I12 | FAIL | reverted, green |
| M33 | `packages/contracts/loyalty.ts`: `LoyaltySegmentSchema` built with `.object` instead of `.strictObject` (run by the orchestrator under the contract lease; restored byte for byte, cmp clean, lease closed) | T42e1b-U10 | FAIL | reverted, green |

**Resolved by A6 (row M33).** History, as the implementer wrote it before A6: The full id is written nowhere in this file, for the reason given under command 22.
- U10 tests only `LoyaltySegmentSchema` and `LoyaltyFlightsSchema` in `packages/contracts/loyalty.ts`.
- The only single-line break U10 can catch is in that file, and this role may not edit `packages/**`, even
  temporarily.
- The spec's M24 and M31 name U10 next to a store change. A store change cannot make U10 fail: M25 and M30 above
  are those two mutations, and U10 passed under both.
- Naming that scenario in either row would claim a failure that did not happen.

## Accepted residuals

1. The model may infer the wrong year for a flight date. Only the 366-day window around the received date bounds it.
2. A flight confirmation from a booking site or agency (a program not of kind `airline`) is not read.
3. Hotel-program mail that the 42e1 read classed as a flight is never read for segments.
4. Every airline-program message costs one model call, marketing and statements included, and the first run reads
   at most 25 messages, oldest first.
5. Mail older than the 30-day inbox retention no longer exists, so history before this task is at most thirty days.
6. A re-forward of an old confirmation can overwrite fields of a booked leg that a later typed correction set, if it
   arrives after that correction (the 42e1 A5 residual).
7. Only the date of departure is stored, so a flight dated today is upcoming for all of today in the database's date.
8. Correcting a wrong date or flight number by hand is two typed writes: add the right leg, then cancel the wrong one.
9. The leg shape rules exist twice, in contracts and in the clean pass, and only T42e1b-U11 ties them together.
