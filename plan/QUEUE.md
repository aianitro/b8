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

| Task ID | ROADMAP §5 step | Status | Depends on | Contracts touched |
|---|---|---|---|---|
| P0-09a-tenant-held-funds | Phase 0, addendum to step 9 ([ITEM.md](tasks/P0-09a-tenant-held-funds/ITEM.md)) | **MERGED** 2026-09-01 (G0–G4 ✅, 0 cycles) | — | `shared/types.ts`, `migrations/**`, `db/schema.sql` |
| P1-10-zod-contracts | 10 | QUEUED | — | `shared/contracts/**` |

Status: `QUEUED` → `SPEC` → `G0` → `G1` → `IMPL` → `G2` → `REVIEW` → `G3` → `G4` → `MERGED`,
or `ESCALATED` when the cycle counter hits 3.

## Parallelism ledger
<!-- Two tasks may run concurrently only if they are contract-disjoint AND file-disjoint
     (BUILD.md §12). Record the disjointness check here before dispatching in parallel. -->

| Tasks | Contract overlap | File overlap | Verdict |
|---|---|---|---|
