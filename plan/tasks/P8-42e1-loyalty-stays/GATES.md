# P8-42e1 — gates

## G0 — PASS (2026-11-24, orchestrator)
- Prerequisites measured on the unmodified tree (`88e0737`): T2 `0,0,0,none`; T3 unit 116 / 1456; T4 lint 0 errors,
  5 warnings; T5 integration 402, none failing; T6 tsc exit 0; T8 `OK H1-H16`; T9 build exit 0; T10 carried 42c2 and
  42c3 lines at their prefixes, line 407 holds `370` twice, line 376 holds the table list once; T11 fixture pins green;
  T12 two `raw_mail` files; T15 clean outside `plan/`; T16 no dataless files; T21 `2`; T22 the six route-count pins
  and the response-schema count where stated. T20 is measured after G2's first full run.
- Command 21 failed on its own spec text (a comma sed range, the migration's full timestamp); fixed by A0, then OK.
- Scope cut proposed by the spec: hotel stays only; flights split to 42e1b. Put to the owner.
- SPEC frozen.

## G1 — PASS (2026-11-24, contract-guardian; orchestrator checks)
- New migration `1793200000000_loyalty_stays.sql` (two tables, one index; the down is not lossless and says so),
  `db/schema.sql` in step, `packages/contracts/loyalty.ts` additions only (plus the endpoint header comment), and
  `T42a-U7`'s count 10 to 12.
- Orchestrator runs: migrate up, down, up all exit 0; commands 6 (`OK migration up-down-up`), 7 (`OK schema`,
  `OK new tables`) and 8 (`OK contracts`) green; tsc clean; contracts test 9/9.
- A1: command 6's too-short code example was six characters, which the CHECK accepts; now three.
- A2: code normalisation and night count exist privately in contracts and must match the domain helpers (residual).
- Lease closed.

## G2 cycle 1 — implementer: two spec defects (2026-11-24)
- `T42c2-U6` counted the booking queue's "Not mine"/"Ignore" as second senders of the balance queue's actions; fixed by
  A3 (orchestrator scoped the two checks; exact diff in command 15).
- Command 2's helper had a stray guard that could never pass; fixed by A4.
- Implementer saw one load-dependent `T42c1-I3` failure in command 10's first attempt (poll path untouched; 0 of 8
  alone; rerun green).

## G2 — PASS (2026-11-24, orchestrator run with A0-A4)
- All 22 commands exit 0; the work tree's checksum is identical before and after (command 19's swaps restored).
  Unit 120 / 1471 and 15 scenarios in both zones; integration 417 with T42e1-I1-I15 passed; migration up-down-up;
  `OK H1-H17`; pins exact; 31 mutation rows. T20 measured `0,0`: no carried test leaves rows in the new tables.

## G3 cycle 1 — ACCEPT_WITH_NITS, one spec defect (2026-11-24, REVIEW-1.md)
- N1: `received_on` is inbox arrival, so a re-forwarded old confirmation re-booked a cancelled stay. Amendment A5: mail
  never revives a cancelled stay; only a typed write or the hold's `place` re-books. I1/I2 (collation) resolved by
  read-only queries on the throwaway and production databases: libc `en_US.UTF-8`, `[:cntrl:]` agrees with `\p{Cc}`.

## G2 re-run after A5 — PASS (2026-11-24, orchestrator)
- All 22 commands exit 0, tree checksum unchanged, T20 `0,0`. Unit 120 / 1471, integration 417, `OK H1-H17`,
  33 mutation rows (M32, M32b, M33 added for A5).

## G3 cycle 2 — ACCEPT_WITH_NITS (2026-11-24, REVIEW-2.md)
- A5 holds on every mail path; tests catch either half regressing. Open nits N2, N3, N4, N6 in NITS.md.

## G4 — PASS (2026-11-24, orchestrator)
- No dataless files, no iCloud conflict copies, no ROADMAP.md in the change. Added lines hold no money-looking text
  (every flagged match is an SQL placeholder); the only `console.` lines are the surface script's OK line.
- The G2 re-run after A5 is the final evidence: 22/22 green, tree unchanged.
