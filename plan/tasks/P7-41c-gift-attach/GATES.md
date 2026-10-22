# P7-41c-gift-attach — gate log

Append-only. Every decision, the command run, and its output.

## G0 — spec gate — 2026-10-22 — PASS

Spec persisted from the spec-writer's final message by script (lines 1–279 of the saved output, from the heading
to the end of Rollback), not retyped; only the Status line changed at freeze. `grep -nE '\$[0-9]'` → no hits.

**Open questions:** Q1 look-back (gift creation minus 7 days, newest first, at most 50), Q2 `choose` gifts can
attach, Q4 "Expected until" defaults to the same day, Q6 transfer-group rows refused — answered by the owner in
chat, all at the spec's defaults. Q3 (N7 fixed here) and Q5 (409 for a closed gift's candidate list) are
technical; taken at the defaults by the orchestrator and reported to the owner.

**Risk tier: full pipeline.** Changes what is masked from whom; a new text-bearing surface; a contract change.

**Two pre-freeze fixes, committed locally before the freeze so the guards start from them (base = `68e83a1`):**
- `24a106b` — the authorized-date sync scenario added in `e7c7232` reused the id `T41b-S13` (S14 also taken); it
  is now `T41b-S15`, and P7-41b's SPEC amendment names it. Found by the spec-writer (T9 note). `giftSync.test.ts`
  16/16 after the rename.
- `68e83a1` — `scripts/gifts-surface-check.mjs` H1 failed on the unmodified tree: `app/digest/page.tsx` (added in
  P5-36) was registered in `lib/giftSurfaceRegistry.ts` but not in the script's page table. Listed as
  `numeric-only`; then `H1 PASS … H10 PASS`, `OK H1-H10`, and H2 shows the recipient's `/digest` holds no canary.

**Toolchain (measured, under bash):** T1 `1`. T2 `Migrations complete!`, `gift_transactions`. T3
`connect ECONNREFUSED 127.0.0.1:1`. T4 `1`. T5 BASE **94 files, 1327 tests**. T6 `exit=0`. T7 LINT_BASE 0 errors,
5 warnings. T8 integration on the unmodified tree: 253 tests, failed `[]` (the two H4 titles in KNOWN now pass;
KNOWN only permits them to fail, so it is left as is). T9 **PRIOR_UNIT = 35** (UTC, Pacific/Auckland,
America/Los_Angeles alike), **PRIOR_INT = 41**. T10 `exit=0`. T11 `0`. T12 `exit=0`. T13 `-780` / `480`. T14 a SHA.
T15 `exit=0`.

**Run on the unmodified tree (blocks extracted from SPEC.md by script, `PRIOR_UNIT=35 PRIOR_INT=41`):** #4 → `FAIL
UTC U1=(0)…U9=(0) prior=35` only. #5 → `FAIL C1=(0)…C13=(0) T41b passed 41` only. #6 → `[]` twice, `OK failing set
stable and within KNOWN`. #7 → `OK H1-H10` (after `68e83a1`). #8 → the second `comm` lists the 11 required files,
the first nothing. #9, #10, #11 → no output. #12 → no output. #13 (= T15) `exit=0`.

**Discrimination probes, each reverted (tree clean afterwards):** #8 an undeclared `lib/zzprobe.ts` → printed. #9
one removed line in `lib/giftMatch.test.ts` → printed. #10 a UTC date slice appended to `GiftForm.tsx` → printed.
#11 a comment appended to `lib/sync.ts` → printed. #12 not probed at G0: the repo's scope-guard hook refuses any
shell write to `packages/contracts/**` outside a lease (which is the rule #12 backs up); probed at G1 inside the lease.

**Vacuity:** 9 unit and 13 integration scenarios required by id plus colon, status passed, in three zones; T41b
counts may not fall below 35 / 41; twenty orchestrator mutations each name the scenarios that must fail.

Spec frozen: `touch .frozen`.

## G1 — contract gate — 2026-10-22 — PASS

Lease opened with `.claude/bin/lease open P7-41c-gift-attach`; the guardian changed `packages/contracts/gifts.ts` only
(+ CONTRACT.md); `git status` confirms. **Class: additive (§9.2)** — new names only (`GiftAttachRequestSchema`,
`GiftCandidateListSchema` with a cap of 50 and a strict date-then-id descending order, `GiftCandidateListResponseSchema`,
two types); no new error code; existing codes keep their meaning; attach answers with the existing `GiftResponseSchema`.
The guardian had no shell; everything below was run by the orchestrator.

- Control script extracted from CONTRACT.md by script (104 lines; read before running — fixtures only) →
  `OK P7-41c contract control: 13 valid accepted, 25 invalid refused, 38 fixtures`, `exit=0`.
- Vacuity probes on a temporary copy (deleted after each; `cmp` guard): the cap raised → `FAIL list: 51 rows expected
  refuse`; the order refine made always true → four `FAIL` lines (ascending dates, ascending ids, duplicate, unordered
  response). A first cap probe did not apply (the `.max` carries a message argument) — caught by the `cmp` guard, redone.
- `(cd apps/web && npx tsc --noEmit)` → `exit=0`; root `npx tsc --noEmit` → `exit=0` (guardian predicted 0).
- Acceptance #12 → `packages/contracts/gifts.ts` alone, then no output. **#12 probes (owed from G0, run inside the
  lease):** a code-line change in `gifts.ts` → printed the removed line; a comment appended to `findings.ts` → printed
  `packages/contracts/findings.ts`. Both reverted.

Contract-file digest at close, for G2's freeze check:
    788d0a939c1c9dd5da89d1d32af3ae3a51364114b029f457ae98f043ed74695f  packages/contracts/gifts.ts

Lease closed.

## G2 — build gate — 2026-10-22 — PASS

Contract digest re-checked: `788d0a93…695f`, unchanged since G1.

**Acceptance, run by the orchestrator under plain shell (`PRIOR_UNIT=35 PRIOR_INT=41`, blocks extracted from SPEC.md by
script):** #1 `exit=0` · #2 `✖ 5 problems (0 errors, 5 warnings)` = LINT_BASE · #3 `Test Files 95 passed (95)` / `Tests
1336 passed (1336)` (BASE + 1 file, + 9 tests) · #4 `OK 9 scenarios U1-U9 each present once and passed; prior unit
scenarios >= 35` in UTC, Pacific/Auckland, America/Los_Angeles · #5 `OK 266 tests, C1-C13 each present once and passed;
T41b passed 41 >= 41` · #6 `[]` twice, `OK failing set stable and within KNOWN` · #7 `H1 PASS` … `H10 PASS`, `OK H1-H10`
· #8 no output · #9 no output · #10 no output · #11 no output · #12 `packages/contracts/gifts.ts` alone, then nothing ·
#13 `exit=0`.

**Implementer's ambiguity rulings, re-ruled by the orchestrator — all accepted:** (1) a read-scope token's attach POST
gets the proxy's 403 `INSUFFICIENT_SCOPE` before any handler (S30 over C6); C6 asserts that 403 is byte-identical for a
real gift and an unknown id, so it reveals nothing. (2) Attach also enforces the look-back floor, outside
`isAttachCandidate`, so U2's comparison with `isCandidate` stays exact. (3) The cap of 50 is applied after the criteria,
not as a SQL `LIMIT` (which would restate the criteria or could drop every qualifying row). (4) 404 before the body is
read; a closed gift 409; every unattachable row one fixed 400 message without digits. (5) `attachToGift` repeats the
three link-and-file statements rather than sharing them with `linkFreshRows` (allowed exactly one change); C1 pins that
both produce the same rows — drift risk passed to G3.

**Mutations M1–M20** (script, single-match replacement with the count checked, file restored from memory; gift unit
files and the whole `app/api/v1/gifts` integration directory after each; tree checksum before and after identical).
M10 and M15 first matched twice (the same text exists in `linkFreshRows`) — refused by the count guard, re-anchored on
text unique to the attach path / the open-gift select, and re-run.

| M | Named | Failed |
|---|---|---|
| M1 window enforced | U1, U2, C1, C4 | U1, U2, C1–C7, C9, C10, C12, C13, T41b-X1 |
| M2 list keeps linked rows | C5, C8 | C5 |
| M3 no transfer refusal | U3, C5 | U3, C5 |
| M4 money-out `< 0` | U3, C5, M2, S5 | U3, T41b-M2 |
| M5 no manual_/csv_ guard | U3, C5, M11 | U3, C5, T41b-M11 |
| M6 amounts via `Number` | U3, M3 | — (equivalent; below) |
| M7 revealed today attaches | U4, C7 | U4, C7 |
| M8 state ignored | U4, C7 | U4, C7, C9, C10, C12 |
| M9 not scoped to the giver | C6, X1 | C6, T41b-X1 |
| M10 no filing on attach | C1, C3, C13 | C1, C3, C13 |
| M11 fixed prior values | C3 | C1, C2, C3 |
| M12 row read before its lock | C9(b) | C9 |
| M13 gift not locked | C9(c), C10 | C9, C10 |
| M14 choose → matched | U6, C2 | C2 |
| M15 N7 conjunct removed | C11 | C11 |
| M16 criterion logged | C12, W8 | C12, T41b-W8 |
| M17 UTC date default | U8, W9, #10 | U8, T41b-W9; #10 flagged |
| M18 reset reuses first-render date | U8 | U8 |
| M19 floor off by one | U5, C4 | U5, C4, C5 |
| M20 no cap | C4 | C4 |

Reasons where a named id did not fail:
- **C8 (M2):** attach re-checks the link with its own `EXISTS` under the row lock, so dropping the list's exclusion
  cannot reach C8's attach path; C5 owns the list.
- **C5, T41b-S5 (M4):** neither seeds a zero-amount row (S5's shapes are refunds and a cent off; C5's refused rows are
  refunds); U3 and T41b-M2 hold the zero row and failed.
- **U6 (M14):** U6 tests the pure `stateAfterClaim`; the mutation is in the store, which only C2 reaches.
- **M6 survives every test: an equivalent mutant in the reachable domain.** Amounts reach `sameAmount` as Postgres
  `numeric(12,2)::text` or contract-validated strings: at most two decimals, magnitude below the range where a double
  loses cents. There, `Number(a) === Number(b)` holds exactly when the cent values are equal. A difference needs
  malformed input (exponent form, hex, more decimals), which neither source produces. Recorded, not a failure; the
  spec's claim that U3/T41b-M3 catch it is wrong.

**Correction to the G2 M4 note (from REVIEW-1 N2):** C5 does seed a zero-amount row; it and the refund are refused by the
gift's amount criterion before the money-out guard, which is why C5 did not fail under M4. Coverage held through U3 and
T41b-M2. A merchant-only control is added in G3 cycle 1.

## G3 — review gate — 2026-10-22 — ACCEPT_WITH_NITS, 1 cycle

REVIEW-1.md persisted (23 hypotheses; existence oracle, leakage and deadlock all refuted). The two inconclusive diff
checks were run by the orchestrator and pass (recorded in REVIEW-1.md). The reviewer's spec-level observation about the
sweep was checked against `runGiftSweep` and is wrong (the notice only sets `notice_at`; `unmatched` comes at the reveal
date) — corrected in REVIEW-1.md.

**Cycle 1 (implementer), for N1 and N2 — both fixed before merge:** the form's reset after a submit is `setForm(BLANK)`,
so the dates follow today again; U8 now requires every reset in the submit handler to leave both dates unset and flags
five fabricated violators. C5 gained a merchant-only gift with a matching zero row and refund (refused with the fixed
400, no link, row untouched) and a control that attaches.

**Re-run by the orchestrator after cycle 1:** contract digest `788d0a93…` unchanged. #1 `exit=0` · #2 0 errors, 5
warnings · #3 `95 passed (95)` / `1336 passed (1336)` · #4 OK in all three zones · #5 `OK 266 tests, C1-C13 each present
once and passed; T41b passed 41 >= 41` · #6 `OK failing set stable and within KNOWN` · #7 `OK H1-H10` · #8–#11 no output
· #12 `packages/contracts/gifts.ts`, then nothing · #13 `exit=0`.

**Mutations re-run (harness, tree checksum unchanged):** M4 → U3, T41b-M2 **and now C5** (N2 closed). M17 → U8, T41b-W9,
#10 flagged. M18, re-anchored on the new reset (`setForm(BLANK)` → spread the first-render defaults) → U8. M18b, the
pre-cycle reset restored (`giftFormDefaults(localIsoDate())`) → U8.

N3 and N4 → NITS.md.

## G4 — integration gate — 2026-10-22 — PASS

Code tree unchanged since the G3 re-run (only plan files since). Unit suite `95 passed (95)` / `1336 passed (1336)` (the
G3 re-run). `packages/contracts/gifts.ts` sha256 `788d0a93…695f` = G1. #8 no output. Migrations on `b8_p41c_throwaway`
(none in this task) → `Migrations complete!`. G3's #5/#6/#7/#13 stand for the same tree. The two pre-freeze commits
(`24a106b`, `68e83a1`) are local and ship with this task. Commit awaits the owner's go-ahead.
