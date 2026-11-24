# REVIEW-1 — P8-42c4-loyalty-read-robustness
**Verdict:** ACCEPT_WITH_NITS
**Reviewer:** adversarial-reviewer (cycle 1, 2026-11-24)

35 hypotheses tried by reading the diff, the tests, A4's two pins and the G2 record. 34 REFUTED, 1 CONFIRMED (NIT 2),
none inconclusive.

## Falsification log (condensed)
| # | Area | Hypothesis | Result |
|---|---|---|---|
| 1-8 | D3 | a step after the state write changes the code; a failed count skips the purge or write; a later failure overwrites `rate_limited`; a thrown read loses its code; a failed write half-writes or resets; `disabled`/`already_running` write; a JS clock; the X-fail spy is vacuous | REFUTED |
| 9-12 | D2 | the rollback error replaces the original; the log line leaks text or has extra fields; a successful rollback logs; client release changed | REFUTED |
| 13-15 | D5 | a throwing `bytesOf` is skipped as vanished; a vanished message moves counts or the streak; empty text reaches the reader | REFUTED |
| 16-20 | D4, A4 | double counting or a `NOT IN` null trap; a `retry` row with bytes counted twice; a `failed` gone-bytes row counted twice; a write on the panel path or `retryFailed` widened; the two pin changes hide a regression (both seeds hold one `failed` and one message-less `retry` row, so 2 is the D4 count) | REFUTED |
| 21-25 | D6, A5 | a statement still on the pool; plain READ COMMITTED; client leak on throw; pool hold-and-wait with `loadOverview`'s parallel queries; nested BEGIN for a passed client; `SET TRANSACTION` after the first statement | REFUTED |
| 26-29 | D1 | body read before authorisation; empty body refused; the answer differs from invalid JSON or echoes input; the erroring stream never errors | REFUTED |
| 30-34 | hygiene | figures, console or error text in logs, swallowed errors, non-goal breach, non-deterministic tests | REFUTED |
| 35 | gates | command 14's READ ONLY / REPEATABLE READ greps are satisfied by a docblock alone | CONFIRMED (NIT 2) |

## Findings
- **[NIT] 1 — loyaltyInboxRead.ts:636-641:** if the panel's ROLLBACK fails on a live connection, the client goes back to
  the pool possibly still inside the READ ONLY transaction. Improbable (a failed ROLLBACK is almost always a dead
  socket, which pg-pool discards). Fix: `client.release(true)` after a failed rollback.
- **[NIT] 2 — SPEC #14:** the snapshot greps match comment text. Non-vacuity is carried by T42c4-I6 and command 17.
