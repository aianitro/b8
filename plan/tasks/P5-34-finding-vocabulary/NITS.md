# P5-34-finding-vocabulary — follow-ups (from REVIEW-1, 2026-10-19)

For step 35 (freshness):
- **N3 — the job contract rejects real producer output under clock skew.** `jobHealth` can return `late` with `daysSince: -1` when the last run is stamped later than "now" on a different calendar day; `findings.ts`'s `daysSince` is `min(0)`. Decide which side is wrong (likely the producer should not report a run from the future as "late") and fix it in step 35, which reopens the contract anyway.
- **N2 — the backup-rehearsal mismatch (`lib/backupPlan.ts` `compareCounts`) is a finding producer missing from the inventory**, and pending agent proposals (`StoredProposal`) are borderline. Add them as kinds when step 35 or 36 needs them.
- The feed `unknown` state is still invisible, and the sync producer still turns a null bank into the text `Unknown` (recorded at G1 and in EVIDENCE.md).

For step 36 (the composed digest):
- **N1 — widen W1:** follow element access into lookup tables and helper return values, and scan `apps/web/scripts/` and `instrumentation.ts`.
- **N4 — ranking across kinds:** a projected overdraft currently sorts after "never synced/valued" warnings; step 36 decides the reader-facing order.
- **N5 — viewer masking:** feed `assembleFindings` with producer inputs masked for the viewer, so a breach or drift figure can't reveal a gift to the person it's for.
- **N6** — trivial: reword the "$0-budget" comment when the file is next touched.
