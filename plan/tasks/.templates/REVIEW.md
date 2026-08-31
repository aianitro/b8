# REVIEW-<n> — <task-id>
**Verdict:** ACCEPT | ACCEPT_WITH_NITS | BLOCK
**Reviewer:** adversarial-reviewer

## Falsification log            <!-- MANDATORY, non-empty -->
| # | Hypothesis | Method | Result |
|---|---|---|---|
| 1 | <what would make this wrong> | <how you tested it by reading> | REFUTED / CONFIRMED / INCONCLUSIVE |

## Findings

### [BLOCK] <file>:<line> — <claim>
**Failure scenario:** <specific inputs/state → specific wrong output>
**Contradicts:** SPEC acceptance #<n> | non-goal #<n> | convention <sign/rounding/null>

### [NIT] <file>:<line> — <claim>     <!-- → follow-up task, never edited in place -->

## Scope violations
- <diff outside the spec's declared surface>

## Inconclusive — requires execution
- <hypothesis the orchestrator must convert into a command it runs at G4>
