# NITS — P6-40f

Fixed in cycle 2 (orchestrator decision: same write path, cheap): N1 (claimants exclude ids in the walk's
`removed`; PG-15e), N2 (one field-less log line per walk while the cursor is held, naming the status),
N3 (held-phase writes asserted; REVIEW-2 probe 2 as a permanent test).

Follow-ups, not absorbed:
- **N2 remainder:** Plaid removals of posted transactions during a long held phase are never delivered
  (no `removed` in a no-cursor walk), so such rows can persist. Needs Plaid's guidance or a reconcile pass.
- **N4:** in a multi-page no-cursor walk, a genuinely new same-key id on an earlier page can take a live
  row whose own id arrives later — owner fields move between two identical-key transactions (count right;
  base was worse).
- **N5:** R5's PG count was 22, not 21 (orchestrator arithmetic); gates use 22.

From REVIEW-3 (follow-ups, not absorbed):
- **N6:** an id that is added, removed and re-added within one walk is counted twice in `synced`. A
  stored id removed and then re-added in one walk counts as one new transaction although the ledger's
  net row count is unchanged. Plaid is not expected to send either sequence.
- **N7:** `route.ts`'s `errors && synced === 0` → 500 heuristic now also fires when the healthy item
  only re-delivered stored rows (held re-auth phase) and another item failed. This is the same
  pre-existing flaw as "nothing new + one failure" on base. A better signal would be per-item success.
