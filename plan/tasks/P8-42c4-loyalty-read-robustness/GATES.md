# P8-42c4 — gates

## G0 — PASS (2026-11-24, orchestrator)
- Prerequisites T1-T18 measured on the unmodified tree (`0c6b2ae`): all as stated.
  - T3 unit 112 files / 1430 tests; T4 lint 0 errors, 5 warnings, two empty ROLLBACK catches present; T5 integration
    373 tests, T42c3-I1-I3 passed, no fixture rows left; T6 tsc exit 0; T8 port free, `OK H1-H15`; T9 build exit 0;
    T10/T11 carried lines at their stated prefixes, line 407 holds `370` twice; T12 both fixture pins OK;
    T13 trigger and create privileges `t`; T14 `1`/`0`; T15 HEAD is main, tree clean outside `plan/`; T16 no dataless
    files; T17 `reached`; T18 exit 0.
- Command 19 (the spec's own scan): `OK spec has no money-looking text`.
- Amendments A1 (G1 runs via contract-guardian, comment only), A2 (catch guard no longer bans `() => null`), A3 (D6
  covers the explicitly passed pool). SPEC frozen.

## G1 — PASS, comment only (2026-11-24, contract-guardian; A1)
- Lease opened, contract-guardian corrected the panel `failed` doc line in `packages/contracts/loyalty.ts` (now also
  names `retry` rows whose bytes are gone). Diff: 1 file, 2 insertions, 1 deletion, every changed line a comment.
  Classification: none (documentation). Lease closed; contracts frozen for implementation.

## G2 cycle 1 — implementer run: FAIL on spec defects (2026-11-24)
- Commands 8, 9, 11: D4 contradicted two pins from 42c2 (`T42c2-I11` failed count, the surface fixture's
  "Could not be read" line). Command 17: its `EXIT` trap restored by relative path after `cd apps/web`.
- Code otherwise green on every other command. Fixed by amendments A4 (orchestrator changed the two pins, one line
  each, re-pinned 42c2's fixture digest inside command 12) and A5 (command 17 restores via the repo root; command 12's
  sed ranges written with variables).

## G2 — PASS (2026-11-24, orchestrator run with A4-A5)
- All 20 commands exit 0. 1 `exit=0`; 2 lint OK; 3 unit 112/1430; 4, 5 oracles both zones; 6 deps; 7 schema and
  contracts comment-only; 8 379 tests, T42c3-I1-I3 and T42c4-I1-I6 passed, no rows, triggers or functions left;
  9 stable; 10 classes; 11 `OK H1-H15`, surface; 12 both fixture pins; 13 registry; 14 source guards; 15 scope;
  16 census; 17 all six fail on the original sources, files restored (checked with cmp); 18 build; 19 spec scan;
  20 mutation rows 15.

## G3 — ACCEPT_WITH_NITS (2026-11-24, adversarial-reviewer cycle 1)
- 35 hypotheses, 34 refuted, 1 confirmed as a nit. No BLOCK. Nits in NITS.md. See REVIEW-1.md.

## G4 — PASS (2026-11-24, orchestrator)
- Fresh run of all 20 commands on the final tree: every one exits 0 (379 integration tests, `OK H1-H15`, command 17's
  six baseline failures with both source files restored, checked with cmp). No dataless files, no iCloud copies.
