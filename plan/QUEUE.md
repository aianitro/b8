# plan/QUEUE.md — the active queue

The idea inventory and the strategic ordering live in the root **`ROADMAP.md`** (§1–§4 are the
inventory, §5 is the order of operations). This file is deliberately thin: it is the
orchestrator's working queue over §5, nothing more. Duplicating §5 here would create a second
definition of "what's next" — the exact defect class `BUILD.md` exists to prevent.

**Task IDs:** `P<phase>-<step>-<slug>`, where phase and step are the root ROADMAP.md §5 phase
and step numbers — e.g. `P1-11-api-v1-overview` is Phase 1, step 11. Phase-prefixed so the
roadmap's shape stays legible in the filesystem, step-numbered so a task always points back to
the item that justified it.

## Queue

> **Ordering note, 2026-09-01.** `ROADMAP.md` §5 gained **Phase 0.5** (the budget turn, steps
> 28–33) ahead of Phase 1 on the same day. This queue had `P1-10-zod-contracts` as next; that
> entry predated the amendment. Phase 0.5 closes with *"This phase is added ahead of Phase 1, not
> alongside it. If it is underway, Phase 1 has not started."* — so every Phase 1 task is blocked
> until Phase 0.5 completes. Recorded here because a stale queue that merely looks current is the
> failure this file's preamble warns about.


| Task ID | ROADMAP §5 step | Status | Depends on | Contracts touched |
|---|---|---|---|---|
| P0-09a-tenant-held-funds | Phase 0, addendum to step 9 ([ITEM.md](tasks/P0-09a-tenant-held-funds/ITEM.md)) | **MERGED** 2026-09-01 (G0–G4 ✅, 0 cycles) | — | `shared/types.ts`, `migrations/**`, `db/schema.sql` |
| P0.5-28-category-control-mode | Phase 0.5, step 28 ([ITEM.md](tasks/P0.5-28-category-control-mode/ITEM.md)) | **G4 ✅ — mergeable, not merged** (G0–G4 all ✅, 0 cycles) | — | `shared/types.ts`, `migrations/**`, `db/schema.sql` |
| P1-10-zod-contracts | 10 | BLOCKED — Phase 0.5 precedes Phase 1 (§5) | Phase 0.5 complete | `shared/contracts/**` |

Status: `QUEUED` → `SPEC` → `G0` → `G1` → `IMPL` → `G2` → `REVIEW` → `G3` → `G4` → `MERGED`,
or `ESCALATED` when the cycle counter hits 3.

## Parallelism ledger
<!-- Two tasks may run concurrently only if they are contract-disjoint AND file-disjoint
     (BUILD.md §12). Record the disjointness check here before dispatching in parallel. -->

| Tasks | Contract overlap | File overlap | Verdict |
|---|---|---|---|
