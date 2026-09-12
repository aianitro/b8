# GATES — P1-10-zod-contracts
<!-- Append-only audit trail. The process analogue of this app's own append-only observation
     tables: the record of what happened is worth more than a summary of it. -->

| Gate | Result | When | Evidence |
|---|---|---|---|
| G0 spec | **FAIL** (cycle 1) | 2026-09-11 | Every acceptance command run literally against `HEAD` = `f808acc`. 44 of 51 verified sound and non-vacuous; 4 findings returned to the spec-writer (D1–D4 below). `.frozen` NOT created. |
| G0 spec | **PASS** (cycle 2) | 2026-09-11 | All four findings fixed and re-verified by command (below). Spec grew to 52 acceptance commands and 28 fixtures. `.frozen` created. |

**Cycle count:** 0 / 3
<!-- G0 spec-writer revisions are not implementer↔reviewer cycles and do not consume the §11 budget. -->

## G0 cycle 1 — what was verified, and what failed

**Verified sound** (command run, output matches the spec's expectation, and a plausible broken
implementation exists that it would catch):

| # | Measured today | Catches |
|---|---|---|
| 2 | `1` | a suite that reports "skipped" or fails to reach the summary line |
| 6 | `0` — directory absent | a task that writes schemas but no fixtures |
| 34 / T1 | `1` (`vitest.config.mts:14`) | a toolchain edit smuggled in to make tests run |
| 36 | `false` | zod left transitive, the T3 hazard the spec exists to close |
| 37 | `0`, and `1` against a sample `"zod": "^4.4.3"` entry | a dependency pinned across a major |
| 38 | `0` | zod added to both dependency blocks |
| 45–48 | `OK`,`OK`,`OK`,`0` | the two excluded non-goals reappearing |
| 35, 43, 44, 49 | `0` each | a route, component, lib or migration touched |
| 50, 51 | `0` each | out-of-scope files; **#51 proven non-vacuous** — an untracked `lib/__scope_probe.ts` made it report `1`, removing it returned `0` |
| T3 | `4.4.3`, `npm ls zod` shows only `@anthropic-ai/sdk` and `eslint-config-next` | — |

**The flagship premise is TRUE and was measured, not reasoned about.** The spec stakes acceptance #8
on `NUMERIC` scalars reaching the JSON boundary as strings. Against `b8_demo` through `pg` with
`lib/db.ts`'s parser set (no `setTypeParser` anywhere in that file):

```
budget_categories.annual_budget  → "8400.00"      typeof string
transactions.amount              → "-7750.00"     typeof string
properties.purchase_price        → "720000.00"    typeof string
SUM(amount)                      → "-103712.31"   typeof string
```

## Findings returned to the spec-writer

**D1 — the numeric-string rule is false for `NUMERIC[]` elements, and the spec enforces the false
half.** Same query, same client, same table:

```
budget_categories.monthly_amounts[i] → 4200        typeof number
```

`pg`'s array parser converts `numeric[]` elements to JS numbers; the scalar parser does not. The
Conventions "Numeric representation" bullet states the rule for "`NUMERIC`/`NUMERIC[]`" as one
mechanism, acceptance **#17 (F11)** requires a twelve-element array **of numeric strings** to be
accepted, and a failure-mode bullet calls `z.number()` on array elements a defect. For arrays,
`z.number()` is the **correct** model. As written the spec would drive a schema that rejects every
real `monthly_amounts` value and would enforce that rejection with a passing test.

**D2 — acceptance #39–#42 cannot produce their expected output.** `grep -rc PATTERN shared/contracts`
does not emit a single count. Today the directory is absent:

```
$ grep -rc "next/server" shared/contracts
ugrep: warning: shared/contracts: No such file or directory   (exit 2)
```

and once it exists with more than one file, `grep -rc` emits one `path:count` line per file, so `0`
can never match. Verified against a comparable directory (`grep -rc "import" lib/domain` → four
`path:count` lines). The layering and derivation-source rules are the spec's structural enforcement
of its own central convention, so these four are load-bearing, not incidental. A form such as
`grep -rl PATTERN shared/contracts | wc -l | tr -d ' '` → `0` behaves as intended.

**D3 — acceptance #3 cites the wrong line.** The spec names the pre-existing warning as
`scripts/seed-demo.mjs:438`; it is at `457:17`. The tail output the command actually asserts is
correct.

**D4 — the Non-goals and Conventions cross-references point at the wrong acceptance numbers.**
Every pointer in those two sections lands on an envelope or enum fixture instead of the command it
names: workspaces cites "#30–#32" (actually #46–#48); the v1 migration cites "#33–#35" (actually
#43, #45); the migration non-goal cites "#36" (actually #49); `vitest.config.mts` cites "#29"
(actually #34–#35); the lib/components non-goal cites "#33, #37, #38" (actually #43–#44); layering
cites "#24–#25" and derivation-source "#26–#27" (both actually #39–#42). BUILD.md §5.2 makes the
reviewer enforce non-goals as defects, so a non-goal whose pointer resolves to the wrong command is
an unenforceable boundary.

## Adjudications
<!-- Disputes settled by a discriminating command, never by argument (BUILD.md §5.1). -->
| Claim in dispute | Discriminating command | Output | Decision |
|---|---|---|---|
| The spec's blanket claim that `NUMERIC` and `NUMERIC[]` reach the boundary by the same mechanism | one `pg` client, one row, both columns: `SELECT annual_budget, monthly_amounts FROM budget_categories WHERE monthly_amounts IS NOT NULL LIMIT 1`, printing `typeof` for the scalar and for a non-zero element | `annual_budget` → `string`; `monthly_amounts[i]` → `number` | Claim **refuted for arrays, upheld for scalars**. D1 raised. The spec's central insight is right; its generalization is not |


---

## G0 cycle 2 — PASS

Re-ran the four findings, plus a structural re-check of the whole document because D1 and D2
changed the numbering.

**D1 — fixed, and the corrected rule is the one that was measured.** The spec now states the split
as a named `pg` parser asymmetry in three places (Goal ¶3, Conventions, failure modes), acceptance
**#17** requires the array of JS numbers to be accepted, and a new **#18 (F11b)** requires the array
of numeric strings — the representation `pg` never produces for this column — to be rejected. The
reverse control is the part worth noting: the first draft had no way to fail if a schema were merely
permissive about both representations, and now it does.

**D2 — fixed, and verified in all three states the command must survive.** `grep -rl PATTERN DIR |
wc -l | tr -d ' '` reads `0` with the directory absent (today), `0` against a populated directory
with no match (`lib/domain`), and non-zero when a match exists (`grep -rl "import" lib/domain` →
`28`). The old `grep -rc` form produced neither `0` nor a single number in any of those states.

**D3 — fixed.** `npm run lint` names `457:17`; the spec now cites `457:17`.

**D4 — fixed, and every pointer was resolved mechanically rather than read.** Each `acceptance #N`
reference in Non-goals and Conventions was extracted and matched against the command at that number:
workspaces → #47–#49 (`test -d apps`, `test -d packages`, `grep -c '"workspaces"'`); v1 migration →
#44, #46; migration non-goal → #50; `vitest.config.mts` → #35–#36; lib/components → #44–#45;
derivation-source → #42–#43; layering → #40–#41. All 13 resolve to the command the prose describes.

**Structural re-check after the renumber.** Acceptance rows are contiguous `1..52` with no
duplicates and no gaps; negative controls are contiguous `1..15`; every `acceptance #N` pointer in
the document falls within `7..50`; 28 distinct fixture ids are referenced, matching #6's `-ge 28`.

**Non-vacuity, command by command.** Every command that can run today was run and returns the value
that a correct-but-unfinished implementation would fail: #6 finds no fixtures, #37 reports `false`
for a direct zod dependency, #38/#39/#49 report `0`, #40–#43 report `0` against an absent directory,
#46–#48 report `OK`, and the scope commands report `0` on a clean tree. **#52 was proved
non-vacuous by construction**: an untracked `lib/__scope_probe.ts` made it report `1`, and removing
the file returned it to `0`.

**One residual risk, recorded rather than waived.** Acceptance #7–#34 assert on test *titles* via
`grep -cF` against verbose reporter output. A test bearing the required title that asserts nothing
would satisfy both the title grep and #6's passing-checkmark count. This is the repo's established
idiom (`P0.5-32-coverage-bound/SPEC.md` uses it throughout) and the spec is not failed for it, but
the gap is real and is assigned rather than assumed away: **at G2 the orchestrator will not treat a
title match as evidence — each named fixture will be opened and confirmed to carry an assertion
whose subject is the rule the title claims.** The adversarial reviewer is the second line on this.

`touch plan/tasks/P1-10-zod-contracts/.frozen` — acceptance criteria are now immutable, enforced by
`.claude/hooks/scope-guard.mjs`, which this session verified is live (it blocked an unrelated write
earlier today, so the hook path resolves from this session's root — `plan/QUEUE.md` H2 does not bite
here).

## Adjudications — cycle 2
| Claim in dispute | Discriminating command | Output | Decision |
|---|---|---|---|
| Whether `grep -rl … \| wc -l` behaves correctly before the directory it inspects exists | ran it against absent `shared/contracts`, against populated `lib/domain` with a non-matching pattern, and against `lib/domain` with a matching one | `0`, `0`, `28` | Correct in all three states. D2 closed |
