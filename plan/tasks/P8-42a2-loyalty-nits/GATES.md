# P8-42a2-loyalty-nits — gate log

Append-only. Every decision, the command run, and its output.

## G0 — spec gate — 2026-11-19 — PASS

Spec persisted by script from the spec-writer's final message in its transcript (heading through Rollback), not
retyped. Open questions 1–6 taken at the spec's defaults (owner: "run it in auto mode, take spec defaults").

**Amendment A0 (orchestrator, before freeze), adjudicated by command.** The line-position guards of #5, #7, #10, #11,
#12 and #13 compared `cut -c1-N` with literals whose length was not N. Run on the unmodified tree (where these
regressions must pass): #5, #11, #12, #13 → `rc=1` with no output, and #7's guard alone → `MISMATCH`. Each guard is now
a prefix match on the same literal (`case "$(sed -n 'Lp' "$S")" in '<literal>'*) ;; *) exit 1;; esac`); six replaced.
Re-run on the unmodified tree: #5 `OK 10 scenarios … TZ=UTC` and `… TZ=Pacific/Auckland`; #11 `OK sidebar`; #12
`OK source guards`; #13 `OK fixtures fabricated`; #7 `[]`, `[]`, `OK failing set stable and within KNOWN`; #10
`OK import end to end`.

**Risk tier:** full pipeline (destructive-edit fix on the page; a script that writes). G1 SKIP (no contract change).

**Toolchain (bash, unmodified tree at `194f049`):** T1 `1`. T2 `loyalty_instruments`. T3 `0`. T4 102 files / 1403
tests (P8-42a G4, same tree). T5 0 errors / 5 warnings. T6 321 tests, failing `[]`. T7 `exit=0` (P8-42a G2, same
tree). T8 `tsx v4.23.15`. T9 `exit=0`. T10 `exit=0` (P8-42a). T11 `ECONNREFUSED`. T12 `true`. T13 `exit=1` then
exactly `import could not run; nothing was changed`. T14 the seven lines start as stated. T15 #10 → `OK import end to
end`. T16 `reached`. T17 6. T18 `194f0498bb2da551f4bc74ff7532961d938781b3`. T19 port `0`, then `OK H1-H11`. T20
`exit=0` (a first attempt wrapped in `timeout`, which macOS lacks, returned 127 without building).

**Vacuity on the unmodified tree:** #8 `rc=1` (a `+2` date is accepted today); #9 `rc=1` (no `code=` line); #15
`FAIL blank text can null the member number`; #4 and #6 need the new tests. Each new rule has a negative control.

**Frozen** 2026-11-19.

## G2 — build gate — 2026-11-20 — PASS (cycle 0)

**Environment check first.** The implementer reported iCloud eviction (macOS "dataless" placeholders that read back
empty with exit 0) causing hangs and spurious failures in its first runs. Before this run:
`find apps/web packages migrations db node_modules -flags +dataless -type f` excluding `.next/` and the mobile-only
packages (react-native, @react-native, @expo, expo*) → `0`. The repo total is 19143, all in mobile packages, stale
`.next/` output, `evals/.venv`, `docs/screenshots` and `package-lock.json` — none read by these commands.

**Every acceptance command re-run by the orchestrator** (bash, `PRIOR_REDUCER=6`, A0 applied; verdict lines verbatim):
#1 `exit=0` · #2 `✖ 5 problems (0 errors, 5 warnings)`, `exit=0` · #3 `Test Files  103 passed (103)`, `Tests  1406
passed (1406)` · #4 `OK 3 scenarios T42a2-U1..U3 each present once and passed; TZ=UTC` and `…; TZ=Pacific/Auckland` ·
#5 `OK 10 scenarios U1-U10 …; TZ=UTC` and `…; TZ=Pacific/Auckland` · #6 `OK 324 tests, T42a-C1-C11 and I1-I11 and
T42a2-I1-I3 each present once and passed` · #7 `[]`, `[]`, `OK failing set stable and within KNOWN` · #8 `OK as-of
bound` · #9 `OK failure class` · #10 `OK import end to end` · #11 `OK sidebar` · #12 `OK source guards` · #13 `OK
fixtures fabricated` · #14 `OK H1-H11`, `exit=0` · #15 `OK coarse source checks` · #16 no output · #17 no output ·
#18 `exit=0`.

**Diff surface:** `LoyaltyMembershipLine.tsx`, `import-loyalty.ts`, `import-loyalty.test.ts` (modified),
`lib/loyaltyNits.test.ts` (new), plus `plan/`. Read by the orchestrator: the member-number `onSave` resolves `null`
without a request for a trimmed-empty draft; `removeNumber` (attached to Confirm only) is the sole `memberNumber: null`.

**For the reviewer:** implementer mutation M10 (bound computed with the JS clock) passed P8-42a #12 because that
command's `!` guards do not fail under `set -e` (T16, already called "a floor" in the spec); it was caught by #15 and
#5. Implementer's first-run hangs in P7 gift tests (`T41b-S2`, `T41c-C1`) did not recur here.

## G3 — adversarial gate — 2026-11-20 — PASS (cycle 0)

REVIEW-1 (persisted by script from the reviewer's transcript): **ACCEPT_WITH_NITS**, 28 hypotheses — 25 refuted, 2
confirmed as test-strength NITs (NITS.md N1, N2; the shipped code is correct for both), 1 informational inconclusive.
No BLOCK, no scope violation.

Inconclusive (informational, outside the spec's requirements) run by the orchestrator: `DATABASE_URL` at a closed
port on `localhost` → `exit=1`, stdout `0` bytes, stderr exactly `import could not run; nothing was changed` /
`code=ECONNREFUSED`. Node's multi-address error carries the code here.

## G4 — integration gate — 2026-11-20 — PASS

Code tree unchanged since G2 (only `plan/` records since). Fresh: `Test Files  103 passed (103)`, `Tests  1406 passed
(1406)`; lint `✖ 5 problems (0 errors, 5 warnings)` (= LINT_BASE). G2's #1 tsc, #6/#7 integration (324, failing `[]`
twice), #14 surfaces and #18 build stand for the same tree. No migration in this task. No real data in the diff,
fixtures or logs. Dataless check as at G2.

**Cycle count:** 0 / 3. **MERGED.**
