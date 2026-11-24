# REVIEW-3 — P8-42c3-loyalty-read-forwards
**Verdict:** ACCEPT_WITH_NITS
**Reviewer:** adversarial-reviewer (cycle 3, 2026-11-24)

A3 restores control 5. The bound before the scrub never stops inside a word, so no partial address can reach the
model. The reviewer found no input that breaks it. The scan is linear, nothing from cycles 1 and 2 regressed, and all
19 cycle-3 commands are green.

## Falsification log
| # | Hypothesis | Result |
|---|---|---|
| 1 | A pattern matches across whitespace. Every tail class excludes `\s`, and the placeholders hold no whitespace. | REFUTED |
| 2 | A lookaround or `\b` depends on a character past the cut point. | REFUTED |
| 3 | `isSpace` (`/^\s$/`) and the patterns' `\s` disagree. They use the same set; a character outside it counts as part of a word for both. | REFUTED |
| 4 | Surrogate pairs break the scan. | REFUTED |
| 5 | The bound landing exactly on a word's start or end is mishandled (`bound-on-whitespace`). | REFUTED |
| 6 | Control 5 fails for the B1 shape (`cap-after-shrink`, M17). | REFUTED (fixed) |
| 7 | The final `maxChars` cut leaves a partial address. | REFUTED |
| 8 | The subject path is not protected. | REFUTED |
| 9 | The scan is not linear. | REFUTED |
| 10 | The oracle catches an unbounded scrub only by timing (REVIEW-2 N1). | REFUTED (closed) |
| 11 | The oracle does not pin the margin size (REVIEW-2 N2). | REFUTED (closed) |
| 12 | F1 (`ignoreEmbedded`) regressed. | REFUTED |
| 13 | Cycle-1 behaviour regressed (stored origin, `retryFailed`, scrub order, block removal, the single caller, HTML-to-text). | REFUTED |
| 14 | The order of steps no longer matches the spec. | REFUTED |
| 15 | Some acceptance command is vacuous. | REFUTED except N1 |
| 16 | A money-looking figure appears in an added line. | REFUTED |
| 17 | The stated residual (a long first word empties the text) causes a silent loss. It is recorded as `empty_message`. | REFUTED (stated residual) |

## Findings
### [NIT] N1 — SPEC.md command #13, the `-ge 0` line (orchestrator-owned), is always true
It is not load-bearing; carried from REVIEW-1 N2.
