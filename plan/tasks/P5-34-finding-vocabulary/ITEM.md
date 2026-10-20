# P5-34 — one finding vocabulary

**Roadmap:** ROADMAP.md §5, Phase 5, step 34. Started 2026-10-19 at the owner's request, through the five-agent
pipeline. Scoped with the owner as **step 34 alone**: invisible plumbing, nothing on screen changes. Steps 35
(freshness) and 36 (the composed digest page) follow as their own tasks.

## The request (ROADMAP §5, 34)

Unify `AdherenceFinding`, `DriftFinding`, sync-health degradations, and property-ledger anomalies behind a single
`Finding` union carrying `kind`, `severity`, `subject` (category / property / account), `period`, and `confidence`.
Non-goal: no new detectors — consolidation of what already exists. It earns its own step because a second
definition of what is worth telling the owner is the drifting-definitions defect one level up, and a report is
exactly where it would surface as authoritative.

## Decided with the owner (chat, 2026-10-19)

- Step 34 only. No new page, no new widget, no change to any existing card's appearance or behaviour.
- The existing producers and cards stay as they are; the task adds the shared shape, a conversion from each
  existing producer into it, and one function that assembles the combined list. Whether the overview payload carries
  the combined list now or at step 36 is for the spec to decide and justify (the orchestrator's lean: not yet).

## What the orchestrator found before dispatch (read-only)

Finding-like producers today, to be enumerated exhaustively by the spec, not trusted from this list:
`lib/domain/drift.ts` (`DriftFinding`, `driftFindings` in the overview), `lib/domain/adherence.ts`
(`AdherenceFinding`), `lib/domain/walletStaleness.ts` (`walletFindings`), `lib/domain/feedHealth.ts` /
`lib/feedHealthRead.ts` (feed health), `lib/domain/syncHealth.ts`, `lib/domain/jobHealth.ts`, the property ledger /
P&L code, and `lib/domain/monthOutlook.ts`. Surfaced by `DriftAlertCard`, `CashStalenessCard`, `FeedHealthCard` on
`app/dashboard/page.tsx`, and by the daily digest (`lib/domain/digest.ts`, `lib/digestRead.ts`).
`walletFindings` and the daily digest postdate the roadmap text (written 2026-09-01); the spec must decide whether
they are in the vocabulary.

## Standing constraints

- Contract surface expected: `packages/contracts/**` (a new `Finding` contract). G1 with the lease; the scope guard
  now enforces it (H8 fixed in `0d8f8af`).
- Public repo: no real names, merchants or money figures in any tracked file; fixtures fabricated.
- The integration suite is clean as of `0d8f8af`; the only KNOWN flaky title is RC-03 (hold H9).
- Severity and confidence must be derived from what each producer already computes, never invented per consumer;
  a conversion that changes what a producer means (e.g. maps "unknown" to "fine") is the defect this step exists
  to prevent.
