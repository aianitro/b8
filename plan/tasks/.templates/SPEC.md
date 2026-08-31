# <task-id> — <title>
**Roadmap item:** ROADMAP.md §5 step <n> — <item>
**Status:** DRAFT | FROZEN@G0
**Author:** spec-writer

## Goal
<one paragraph: the observable change in system behavior>

## Non-goals
- <explicit exclusion>          # the reviewer enforces these as defects

## Contracts touched
| File | Change | Class (§9.2) |
|---|---|---|
| shared/types.ts | <new optional field ...> | additive |
| migrations/<new> | <new nullable column ...> | additive |
<or: none>

## Conventions this task must honor
<!-- The failure class with the worst track record in this repo. State it here, at spec time,
     or the implementer will infer it from whichever fixture it happens to see first. -->
- **Sign:** <e.g. payments arrive negative on loan accounts, positive on checking; normalize at
  the boundary where the account is known>
- **Rounding:** <per step / once at the end, and why>
- **Landscape + exclusions:** <operational | capital; which of `hidden` / `exclude_from_budget`
  apply>
- **Null semantics:** <what a missing observation must render as>

## Toolchain prerequisites
<!-- The spec-writer's grant is Read/Grep/Glob, so it cannot interrogate a toolchain — it
     DECLARES what the acceptance commands assume, and the orchestrator VERIFIES every row
     before passing G0. A row whose verification command the orchestrator cannot run is a G0
     FAIL, not a note. Mark anything the commands do NOT need as "NO". -->

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | <e.g. a throwaway Postgres on :5432> | **yes** / **NO** | <`docker compose up db` / n/a> | `<command the orchestrator runs>` | <filled in at G0> |

## Acceptance commands
| # | Command | Expected |
|---|---|---|
| 1 | `npx tsc --noEmit` | exit 0 |
| 2 | `npm test` | `<n> passed` |
| 3 | `<literal shell, runnable from repo root>` | `<observable result>` |

<!-- For each: would a stub or a no-op pass this? If yes, replace it. -->

## Negative controls
<!-- Every rule stated in prose above names the input it must REJECT, and an acceptance
     command that asserts the rejection. A rule gated only by "the implementation passes" is a
     rule whose wording has never been tested. -->
| # | Rule | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | <e.g. transfers never reach the P&L> | <a `Transfer`-category row on a linked account> | acceptance #<n> |

## Evidence required
- <artifact beyond green tests: a sample computed statement over fabricated data, a
  migration up/down/up log, a before/after of the affected figure>

## Failure modes to test
- <concrete way this could be wrong>    # seeds the reviewer's falsification log

## Rollback
<how to revert cleanly — including the `down` migration and any data restored from CSV>
