# GATES — P8-42e1b-loyalty-flights

## G0 — PASS (2026-11-24, orchestrator)
- Owner decisions (2026-11-24): a separate "Flights" section with its own held list (spec D10); every stored airline
  message is read once; run G0-G4 without stopping, ask before commit and push.
- Prerequisites measured: T1 `1`; T2 `0,0,0,none,true`; T3 unit 120 / 1471; T4 lint exit 0, 0 errors, 5 warnings;
  T5 integration 417 (0 failed), T20 before `0,0`; T6 tsc exit 0; T7 node ok; T8 port free, `OK H1-H17`; T9 build
  exit 0; T10 all carried lines in place, line 407 holds `370` twice; T11 fixtures pinned; T12 three `raw_mail` files;
  T13 `1 1 1`; T14 `reached`; T15 HEAD is main, tree clean outside plan; T16 no dataless files; T19 ok; T21 `2`;
  T22 five `:1`, `1`, `1`, `2`, and the DELETE anchor (after A0) `1`; T23 `1 1`; T24 `6`; T25 `1`.
- A0: T22's DELETE check anchored (seven unanchored matches); the 42e1 migration timestamp removed from the spec text.
  Command 21 then printed `OK spec has no money-looking text`.
- Spec frozen.

## G1 — PASS (2026-11-24, contract-guardian; orchestrator checks)
- New migration `…_loyalty_segments.sql` (two tables, additive; down drops only them and says it is not lossless),
  `db/schema.sql` in step, `packages/contracts/loyalty.ts` additions only (plus the endpoint header comment; only build
  output names the old wording), `T42a-U7` count 12 to 13.
- Orchestrator runs: migrate up, down, up all exit 0; commands 6 (`OK migration up-down-up`), 7 (`OK schema`,
  `OK new tables`), 8 (`OK contracts`) and 21 green; tsc clean; contracts test 9/9.
- A1: command 6's non-array `legs` example was invalid JSON; now a JSON string. A2: `recent` tie order and the
  normalising leg schemas stated. Lease closed.

## G2 cycle 1 — implementer: four spec defects (2026-11-24)
- A3: `T42e1-U15` pinned the exact TravelBoard element; the orchestrator changed that one line to add `flights`.
- A4: command 9's 42e1 file check listed I8 under the wrong file.
- A5: command 15 brace-expanded a pattern inside `$()` under bash 3.2; the pattern moved into a variable.
- A6: U10 tests contracts only; the orchestrator ran M33 under the lease (U10 failed; restored byte for byte).
- Implementer saw one load-dependent `T41b-G10` hook timeout once (passes alone 11/11; later runs green). H18 needed
  each route named twice; fixed in the surface script's comment.

## G2 — PASS (2026-11-24, orchestrator run with A0-A6)
- All 22 commands exit 0 under /bin/bash; tree checksum identical before and after. Unit 124 / 1485 and 14 scenarios
  in both zones; integration 431 with T42e1b-I1-I14 in their files; `OK H1-H18`; pins exact; 33 mutation rows.
  T20 before the clean-up line `0,0,1,0` (the real daily job reaches the flight step), after `0,0,0,0`.

## G3 — ACCEPT_WITH_NITS (2026-11-24, REVIEW-1.md)
- No BLOCK. Nits N1-N5 in NITS.md; N4 fixed (evidence brought in line with A6).

## G4 — PASS (2026-11-24, orchestrator)
- Final evidence is the G2 run with A0-A6 (22/22 green, tree unchanged, T20 `0,0,0,0`). The EVIDENCE.md fix touches
  only plan/ files.
