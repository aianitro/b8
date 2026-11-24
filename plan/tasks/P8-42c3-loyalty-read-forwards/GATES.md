# P8-42c3 — gates

## G0 — spec gate — 2026-11-23 — PASS (amendment A1)

**Tree before measuring:** iCloud had left 27 conflict copies ("<name> 2.<ext>") of P8-42c2 files, all byte-identical
to the committed files. With the owner's approval they were moved outside the repo to
`~/Documents/b8/icloud-dupes-backup-2026-11-23/`, keeping their paths. The baselines below were measured after that.

**Fixtures (T14):** `apps/web/lib/fixtures/loyalty-read-forwards/` has 10 entries: F01–F08, `cases.json` and
`forwards.oracle.test.ts`. The orchestrator wrote them from a scratchpad generator. Every expectation in it is
hand-written, and it refuses to write unless a reference implementation of the spec's "What the model receives",
run over the real mailparser, agrees. Counts: 50 scrub cases, 13 inline-block cases, 1 cap case, 11 shapes, and 9
integration rows. The shape check prints `fixture shape ok`. The digest `e222ea02…a7f7` is pinned in command 13.

**Non-vacuity (T15):** on the unmodified tree the oracle gives `Tests  3 failed (3)`. Against the reference
implementation (throwaway `vi.mock` file, removed afterwards) it gives `Tests  3 passed (3)`.

**42c2 fixtures:** R01–R03, R05 and R06 give the same reader input under the new rules as under the old. R04 changes
only by the existing `LOYALTY_READ_MAX_CHARS` cut, which is the same in both versions.

**A1:** see SPEC.md. It covers four points:
- The fixture provenance.
- Mailparser renders a mailto anchor as `[name@host]`. The result is `[[address]]`, not `[[link]]`.
- The From line matches case-insensitively.
- Command 8's `sed` range was rewritten so command 19 no longer reads it as a comma-grouped figure. The output is unchanged.

**Toolchain, measured:**
- T1 `1`.
- T2 head `1793100000000_loyalty_inbox_read`, ZQ42C rows `0,0,0`.
- T3 111 files / 1427 tests passed.
- T4 0 errors, 5 warnings, `exit=0`.
- T5 `OK 370 tests`, `OK no fixture rows left`.
- T6 tsc `exit=0`.
- T7 `exit=0`.
- T8 port free, `OK H1-H15`, `exit=0`.
- T9 build `exit=0`.
- T10 the frozen 42c2 SPEC line prefixes are as cited.
- T11 `reached`.
- T12 `0` dataless files.
- T13 `exit=0`, `0` changes outside `plan/` and the fixture dir.
- T16 `exit=0`.

Commands 6, 12 and 19 pass now: `OK dependencies`, `OK registry unchanged`, and `OK spec has no money-looking text`.

**G1:** SKIP. The spec declares no contract change.

## G2 — build gate — 2026-11-23 — PASS

The orchestrator ran all 19 acceptance commands independently. Each was extracted verbatim from SPEC.md and run in
its own `/bin/bash` from the repo root, with `ANTHROPIC_*` and `LOYALTY_IMAP_*` unset. Base: `fda9eb9` plus the
working tree. There were 0 dataless files before each command. Every command exited 0.

| # | Last line |
|---|---|
| 1 | `exit=0` |
| 2 | `OK lint 0 errors, warnings not above 5` |
| 3 | `OK unit 112 files 1430 tests` |
| 4 | `OK 3 scenarios T42c3-U1..U3 …`, once per zone (UTC and Pacific/Auckland) |
| 5 | `OK 6 scenarios T42c2-U1..U6 …`, once per zone |
| 6 | `OK dependencies` |
| 7 | `OK schema`, then `OK no migration, no schema change` |
| 8 | `OK 373 tests, …`, `OK T42c3-I1-I3 each present once and passed in one file`, `OK no fixture rows left` |
| 9 | `[]`, `[]`, `OK failing set stable and within KNOWN` |
| 10 | all regression OK lines, then `OK classes` |
| 11 | `OK H1-H15`, `OK surface` |
| 12 | `OK registry unchanged` |
| 13 | `OK new fixtures pinned and covered`, `OK fixtures pinned and covered` |
| 14 | `OK source guards` |
| 15 | `OK scope` |
| 16 | `OK existing tests untouched, census exact` |
| 17 | build `exit=0` |
| 18 | `OK mutation evidence rows 14` |
| 19 | `OK spec has no money-looking text` |

The diff touches `lib/domain/loyaltyInbox.ts`, which is the text section only, and `lib/loyaltyInboxRead.ts`, which
gains the origin column and passes it on. It also adds one integration test file. The optional
`loyaltyInboxText.ts` was not created, and EVIDENCE.md gives the reason.

## G3 — adversarial gate — 2026-11-23 — BLOCK (cycle 1)

See REVIEW-1.md. There are two findings, and the orchestrator confirmed both by command:
- **F1:** an inline-disposition attached original is read as the outer message.
- **N1, upgraded to BLOCK:** the scrub's cost grows with the square of the length of an unbroken run in the uncut
  body. 80k characters takes several seconds, and 1M characters did not finish within 10 minutes.

Both need a spec amendment (A2) before the implementer's cycle 2.

### Amendment A2 — 2026-11-23 (before cycle 2)

The spec is amended with A2 (see SPEC.md):
- Parse with `ignoreEmbedded: true`, as the poll does.
- Bound the text to `maxChars + 1024` code points, and the subject to `300 + 1024`, before the scrub.

New fixtures:
- `F09.eml`;
- two shapes;
- a `longRun` group;
- the oracle's U1 now has a 30 s timeout.

The digest is re-pinned in command 13. Results:
- Cycle-1 code: `Tests  3 failed (3)`. U2 fails on `attach-inline-disposition` alone, and U1 times out.
- A2 reference: `Tests  3 passed (3)`.
- Commands 13 and 19 pass.
- R01 to R06 are unchanged under A2.

N2 (#13's `-ge 0` line) is left as written: it is not load-bearing.

## G2 — build gate, cycle 2 — 2026-11-24 — PASS

Before this run the orchestrator made two fixes, both on its own side:
- **Command 15.** Its allowed-file pattern was widened to `F0[1-9]`, a gap in A2 that the implementer caught.
- **iCloud copy.** iCloud had made a conflict copy of the orchestrator's own throwaway probe file
  (`apps/web/lib/zq42c3-probe.test 2.ts`), and it broke lint. It was moved to the iCloud-duplicates backup.

The orchestrator then ran all 19 commands independently, with 0 dataless files. Every one exited 0, with the same
last lines as cycle 1. Changes from cycle 1:
- #4 passes in both zones; the oracle includes F09 and the `longRun` cases.
- #9 gives `[]`, `[]`, `OK failing set stable and within KNOWN`.
  The implementer had seen a one-off `T42b2-I7` (gifts) flake; it did not recur.
- #15 gives `OK scope`.
- #18 gives `OK mutation evidence rows 16`.

## G3 — adversarial gate, cycle 2 — 2026-11-24 — BLOCK

See REVIEW-2.md. F1 is fixed. B1 is new: A2's bound before the scrub can leave a partial address, and the
orchestrator confirmed this against the A2 reference. The defect is in A2's design, not in the implementation.

### Amendment A3 — 2026-11-24 (before cycle 3)

A bound that lands inside a token now drops that whole token (see SPEC.md). The new `edge` fixtures and the `longRun`
expectations were re-pinned. Results:
- Cycle-2 code: `1 failed | 2 passed`.
- A3 reference: `3 passed`.
- Commands 13 and 19 pass.

This is cycle 3, the last one before BUILD.md hands the task back to the owner.

## G2 — build gate, cycle 3 — 2026-11-24 — PASS

The orchestrator ran all 19 commands independently, with 0 dataless files. Every one exited 0. The last lines are as
in cycle 2, except #18, which gives `OK mutation evidence rows 17`. `tokenSafePrefix` matches A3: a backward scan
over code points, with no regex over the kept string.

## G3 — adversarial gate, cycle 3 — 2026-11-24 — PASS (ACCEPT_WITH_NITS)

See REVIEW-3.md. The log holds 17 hypotheses; 16 were refuted. The one NIT is a vacuous orchestrator line in #13,
carried to NITS.md. REVIEW-2 N1 and N2 are closed by A3's fixtures.

## G4 — integration gate — 2026-11-24 — PASS

This was a fresh full run on the final tree, 2026-11-24T02:28Z to 02:32Z. HEAD and `origin/main` are both `fda9eb9`.
The SPEC.md sha256 prefix is unchanged since G2 cycle 3 (`039e5b446db031f5`). Only `plan/` docs (REVIEW-3.md,
NITS.md, GATES.md) changed after that run.

The method was the same as G2, with 0 dataless files before every command. All 19 commands exited 0, with the same
last lines as G2 cycle 3. Unit: 112 files and 1430 tests. Integration: 373 tests. The oracle passes in both zones.
`OK mutation evidence rows 17`.
