# P8-42c4 — nits (from REVIEW-1)

- **N1:** the panel's failure path can return a client still inside its READ ONLY transaction to the pool when
  ROLLBACK fails on a live connection (`loyaltyInboxRead.ts`, `loadReadOverview`). Improbable; fix with
  `client.release(true)` after a failed rollback.
- **N2:** SPEC command 14's `READ ONLY` / `REPEATABLE READ` greps are satisfied by the docblock. T42c4-I6 and command 17
  carry the real check. Orchestrator-owned; tighten in a later spec if the panel is touched again.
- **N3 (stated residuals of D4):** a message purged before any attempt has no reads row and stays invisible; "Try
  failed mail again" can show for a count it cannot reduce (gone-bytes rows are not reset).
