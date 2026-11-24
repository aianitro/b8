# REVIEW-2 — P8-42c3-loyalty-read-forwards
**Verdict:** BLOCK
**Reviewer:** adversarial-reviewer (cycle 2, 2026-11-24)

F1 is fixed and N1's cost bound works. One new BLOCK remains. The bound before the scrub (A2) breaks control 5's
guarantee that no partial address is sent. The implementation follows A2 exactly, so the defect is in A2's
reasoning.

## Falsification log
| # | Hypothesis | Result |
|---|---|---|
| 1 | F1 is not fixed (an inline rfc822 part is still merged). `READ_PARSE` now has `ignoreEmbedded: true`, used for the outer and chosen parses. | REFUTED (fixed) |
| 2 | `ignoreEmbedded` changes 42c1 behaviour. | REFUTED |
| 3 | `ignoreEmbedded` changes 42c2 reader input. | REFUTED |
| 4 | HTML-to-text conversion was lost. | REFUTED |
| 5 | A nested forward is unwrapped, or a stranger's inline original is merged. | REFUTED |
| 6 | The bound is placed against A2's order. | REFUTED |
| 7 | Steps before the bound are still unbounded-cost. | REFUTED |
| 8 | The bound splits a surrogate pair. | REFUTED |
| 9 | The bound breaks control 5 within the first maxChars. | **CONFIRMED** (B1) |
| 10 | The oracle catches an unbounded implementation. | REFUTED, but machine-dependent (N1) |
| 11 | The oracle catches a bound much larger than A2's. | CONFIRMED weak (N2) |
| 12 | The subject bound is off. | REFUTED for realistic inputs |
| 13 | Money-looking figures sit in new comments. | REFUTED |
| 14 | Cycle-1 refutations regressed. | REFUTED |
| 15 | The #15 pattern fix admits more than F09. | REFUTED |

## Findings
### [BLOCK] B1 — loyaltyInbox.ts:169: a token cut by the pre-scrub bound reaches the final text after the scrub shrinks the text before it
A token straddling code point `maxChars + 1024` is cut there and no longer matches any pattern, as in `zq42c3-ann`.
The scrub then shortens the text before it: about 40 long tracking links become `[[link]]`. The final cut then keeps
the partial token. Leading whitespace removed by `trim()` shifts the edge the same way. This contradicts negative
control 5 and A2's own stated guarantee.

### [NIT] N1 — the oracle catches an unbounded implementation only by wall time (about 2x margin)
### [NIT] N2 — no test pins the bound size

## Orchestrator's command results (I5)
- **B1 confirmed.** The reviewer's probe, run against the A2 reference implementation, gave
  `underMax:true, fragment:true, fullAddress:false`. The text ends in `x xzq42c3-an`.
- **The fix is amendment A3.** A bound that lands inside a whitespace-delimited token drops that whole token. A3 also
  addresses N1 and N2:
  - A run with no whitespace now gives empty text, so an unbounded implementation fails by value, not only by time.
  - `whitespace-past-margin` fails any margin above roughly 1500.
