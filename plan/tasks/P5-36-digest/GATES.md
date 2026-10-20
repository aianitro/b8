# P5-36-digest — gate log

Append-only. Every decision, the command run, and its output.

## G0 — spec gate — 2026-10-20 — PASS

Spec persisted from the spec-writer's final message by script (lines 1–315 of the saved output, from the `# P5-36…`
heading to the end of Rollback), not retyped. Two edits besides the Status line, both per AGENTS.md: Q7's sign-placement
example and N6's quoted comment each contained a currency sign followed by a digit; both are now described in words.
`grep -nE '\$[0-9]'` on SPEC.md → rc=1.

**Open questions:** Q2 route `/digest`, Q3 money-at-risk-first kind order, Q4 same figures for both viewers, Q6 no
sidebar link — answered by the owner in chat, all at the spec's defaults. Q1 (third parameter is coverage), Q5 (a
failed source renders as not evaluated), Q7 (money string verbatim), Q8 (N2 cache: comment only), Q9 (neutral empty
statement) are technical; taken at the defaults by the orchestrator and reported to the owner.

**Risk tier: full pipeline.** First consumer of the findings vocabulary, a new page reading the signed-in viewer, a
loader that runs every producer. **G1 skips:** the spec touches no contract, migration or schema; #12 enforces it.

**Toolchain (measured, under bash):** T1 `1`. T2 `Migrations complete!`, `gifts`. T3 `exit=1`,
`connect ECONNREFUSED 127.0.0.1:1`. T4 BASE **92 files, 1296 tests**. T5 `exit=0` / `exit=0`. T6 block B on the unmodified
tree → `FAIL UTC` listing only the 17 `T36-` ids (0 each); no failing title, so all 54 earlier scenarios pass. T7 →
**IBASE 245**, failed `[]`, T35-R1..R9 passed 9/9; block C prints only `T36-L1..L7(0)`. T8 `exit=0`. T9 `-780` / `480`.
T10 `1`, no output. T11 `2` (a comment and the include entry, as at P5-35 G0 — the precedent holds). T14 `17`.
Lint baseline 0 errors, 5 warnings.

**T12 corrected:** the spec's check (`vitest run --help | grep -c shuffle`) prints 0 — the top-level help lists only
`--sequence <options>`. `--help --sequence` lists `--sequence.shuffle`, `.shuffle.files`, `.shuffle.tests` and
`--sequence.seed`, and the seed only applies when `--sequence.shuffle` is truthy. **#6b's invocation is block C with
`--sequence.shuffle --sequence.seed=1`**, the spelling run green at P5-35 G3.

**T13:** `npm run build` → `exit=0`; dynamic routes print as `├ ƒ /dashboard`. #13 expects a `/digest` line of that form.

**Run on the unmodified tree (blocks extracted from SPEC.md by script):** D no output (rc=1). E no output. F no output.
G no output (rc=1). H no output, rc=1. J rc=2 (the files do not exist yet; after the change it must be rc=1).

**Discrimination probes, each reverted (`git status` afterwards shows only plan/):**
- E: comment appended to `components/AlertBell.tsx` → `M	apps/web/components/AlertBell.tsx`; `lib/zzprobe.ts` created →
  printed.
- F: one code token changed in `findingsFreshness.ts` → both lines printed.
- H: `import '@/lib/domain/findingsDigest';` appended to `AlertBell.tsx` → file listed, rc=0.
- D: a new `findingsDigest.ts` with a currency sign followed by a digit in a comment → printed.
- G: one `expect(` removed from `jobHealth.test.ts` → the removed line printed.
- J: an all-clear phrase in a new `DigestView.tsx` comment → printed, rc=0.

**Vacuity:** #5/#6 require 71 unit and 16 integration scenarios by id plus colon, status `passed`; twenty orchestrator
mutations (M1–M20) each name the scenarios that must fail. #14 (phrases) and #7 are weak by design; D7/L7 are the
evidence.

Spec frozen: `touch .frozen`.

## G0 amendment — 2026-10-20 (orchestrator, during IMPL)

The implementer modified `apps/web/lib/giftSurfaceRegistry.ts` (one entry, `app/digest/page.tsx` as `numeric-only`, and
a one-line comment), which the spec's declared set omitted. **Verified required:** with HEAD's registry restored,
`lib/giftSurfaceWiring.test.ts` T41b-W4 fails, `expected [ 'unclassified app/digest/page.tsx' ] to deeply equal []`,
`Tests  1 failed | 12 passed (13)`. `numeric-only` matches Q4 (same figures for every viewer, no row text; T36-L4).
Block E's modified-file pattern gained `|apps/web/lib/giftSurfaceRegistry\.ts`; re-extracted by script and probed: no
output on the tree, and a comment appended to `components/AlertBell.tsx` still prints `M	apps/web/components/AlertBell.tsx`.
The scope is now six modified files and six added.

## G2 — build gate — 2026-10-20 — PASS (1 cycle)

The first implementer was stopped by accident mid-way through its own mutation probes; a second one built on the tree and
found one probe still applied (an all-clear sentence appended to the `none-reported` headline, M6) and removed it.

**Acceptance, run by the orchestrator under plain shell, blocks extracted from SPEC.md by script:**
- #1 `exit=0` · #2 `exit=0` · #3 `✖ 5 problems (0 errors, 5 warnings)` — baseline
- #4 `Test Files  93 passed (93)` / `Tests  1314 passed (1314)` — BASE + 1 file, BASE + 18 tests
- #5 `OK 71 unit scenarios (34 T34 + 20 T35 + 17 T36) each present once and passed TZ=` UTC, Pacific/Auckland, America/Los_Angeles
- #6 `OK 252 integration tests, none failing except RC-03; T35-R1..R9 and T36-L1..L7 each present once and passed` — IBASE + 7
- #6b (block C with `--sequence.shuffle --sequence.seed=1`, `grep -c sequence.shuffle` → 1) — the same OK line, 252
- #7 no output · #8 no output (amended block E) · #9 no output · #10 no output · #11 rc=1 · #12 `UNTOUCHED`
- #13 `exit=0`, `├ ƒ /digest` · #14 rc=1

**Mutations, first pass — 19 of 20 killed. M14 survived:** a new `scripts/zz-probe.ts` assigning
`severity: LEVELS.high` from an `as const` table passed T36-W2. Bracket access and a direct literal were flagged; dot
access was not (probed all three). **Returned to the implementer, cycle 1.** Fix in `lib/findingsWiring.test.ts` only:
dot and nested property access into a same-file const table is followed; five violators and four clean cases added to
T36-W2; no assertion removed (#10 no output).

**After cycle 1, re-run by the orchestrator:** #1, #2, #3, #4, #5 (three zones), #7, #8, #10, #11, #14 as above. Full
mutation sweep re-run (script, single-match replacement, tree checksum before and after identical):

| M | Named | Failed |
|---|---|---|
| M1 | D1 | D1 |
| M2 | D2 | D2 |
| M3 | D2 | D2 (applied as a reversed tie-break: JS sort is stable, so merely dropping the tie-break changes nothing) |
| M4 | D5 | D5, D12 |
| M5 | D6 | D6, D7 |
| M6 | D7, #14 | D7; #14 flagged |
| M7 | D8, D9 | D8, D9 |
| M8 | D3 | D3 |
| M9 | D10, W4 | W4, T34-W4 |
| M10 | L5 | L5 |
| M11 | L1 | L1, L2 |
| M12 | L5 | L5 |
| M13 | W1 | W1, L6 |
| M14 | W2 | W2 |
| M15 | L4, W5 | W5 |
| M16 | W5 | W5 |
| M17 | L2 | L1, L2 |
| M18 | W4 | W4, D1, D2, D10 |
| M19 | W3, #11 | W3, T35-W3; #11 flagged |
| M20 | D11 | D11 (and the evidence-table test) |

Two named ids did not fail, each accepted with a reason:
- **D10 (M9):** the probe was `void new Date()`, which reads a clock without the output depending on it; D10 compares
  outputs under two fake clocks, so it can only catch a clock that reaches the output. W4 (static) is the guard and failed.
- **L4 (M15):** the probe summed `visibleTransactions(viewer)` but did not feed the sum into any finding, so the figures
  L4 compares were unchanged. W5 flagged the import.

**Browser check (evidence, not a gate command), 2026-10-20.** Scratch DB `b8_preview` (migrated, `seed-demo.mjs`
fabricated data), a placeholder credential and a test session for the owner; `next dev` on port 3136; service worker
unregistered and caches cleared first. `/digest` → 200, signed in as the preview owner. Rendered: as-of caption, headline
naming the count of findings and 9 of 9 sources, the coverage statement listing all nine sources, four tallies
(within interval / past interval / never / cannot be dated) plus the undated-input count, then the items, worst severity
first, each with its dating sentence and the producer's figures verbatim. Script over the rendered text: 0 matches for the
all-clear phrases or "fresh/healthy/recovered", 0 currency-sign-plus-digit, no horizontal scroll; no console errors. At
390px (same-origin iframe): `scrollWidth 388 = clientWidth 388`, tiles reflow to 2×2. The demo seed has no feed or sync
timestamps, so almost every item reads "cannot be dated" — the intended wording for that data, not a defect. Afterwards:
server stopped, `b8_preview` dropped, token file deleted.

## G3 — review gate — 2026-10-20 — ACCEPT_WITH_NITS

REVIEW-1.md persisted (29 hypotheses; two CONFIRMED, both guard false negatives). No BLOCK, five nits → NITS.md (N1
headline wording and N5 conversion failure for step 37; N2/N3 guard hardening; N4 a comment). The one inconclusive item
was run by the orchestrator: block C twice back to back → `OK 252 …` both times, and `overdraft_forecasts|` after each
(L5's renamed table restored).

## G4 — integration gate — 2026-10-20 — PASS

Code tree unchanged since G2 (only plan files since). Unit suite `93 passed (93)` / `1314 passed (1314)`. #8 (amended) no
output. #12 `UNTOUCHED`. Migrations on `b8_p36_throwaway` (none in this task) → `Migrations complete!`. G2's #6/#6b, #13
and #1/#2 stand for the same tree; G3's double run of block C re-confirms #6. Commit awaits the owner's go-ahead.

**Pre-commit, 2026-10-20:** gitleaks `generic-api-key` flagged the fabricated fixture token on one line of
`scripts/findings-digest-read.test.ts` (a false positive on a test value). Renamed to a shorter fixture value (one
occurrence); gitleaks → no leaks; block C re-run → `OK 252 …`.
