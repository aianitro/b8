# P5-36 — the digest, composed but not delivered

**Roadmap:** ROADMAP.md §5, Phase 5, step 36. Started 2026-10-20 at the owner's request ("go for it"), through the
five-agent pipeline. Builds on P5-34 (`0fa8526`, the `Finding` contract and `assembleFindings`) and P5-35 (`bf6f532`,
required `freshness` on every finding, `loadFreshnessFacts`).

## The request (ROADMAP §5, 36)

A pure function `(findings, period, freshness) → Digest`. No clock read inside; the period is a parameter. Tier-1
testable like everything else in `lib/domain/`. Rendered at an in-app route you visit. Non-goals: no email, no
schedule, no network.

## Carried in — the spec must dispose of each

From P5-35 (plan/tasks/P5-35-finding-freshness/NITS.md):
- **N1:** widen the SQL-clock check (W1): `CURRENT_TIME`, `LOCALTIME`, `'now'`/`'today'`… casts, with fabricated
  violators. This step adds the first route that reads the facts, so the guard matters now.
- A `feed-degraded` finding with a recent last success reads `fresh` while failing; the digest must not present
  "fresh" as "healthy".
- N2 (the `INDEXES` cache) and N3 (a comment) — include or defer.

From P5-34 (plan/tasks/P5-34-finding-vocabulary/NITS.md), marked "for step 36":
- **N1:** widen P5-34's W1 — follow element access into lookup tables and helper return values; scan
  `apps/web/scripts/` and `instrumentation.ts`.
- **N4:** ranking across kinds — a projected overdraft sorts after "never synced/valued" warnings; decide the
  reader-facing order.
- **N5:** viewer masking — feed `assembleFindings` with producer inputs masked for the viewer, so a breach or drift
  figure cannot reveal a gift to the person it is for (P7-41b).
- **N6:** reword a comment when the file is next touched.

## Standing constraints

- This is the first consumer of the findings vocabulary: P5-35's "no consumer" check (#10) stops holding, and any
  further change to `Finding` or `Freshness` becomes breaking in effect. Whether the digest needs a contract of its own
  (`packages/contracts/**`) is the spec's to decide; G1 with the lease if so.
- Two users (P7-41a): the route must know who is viewing and mask accordingly; the owner/second-user split decides
  what each sees.
- Not-evaluated sources (`notEvaluated`) and `undated`/`never` freshness must be stated on the page, never rendered as
  all clear. Step 37 owns "nothing to report"; this step must not render an empty digest as good news either.
- UI: invoke the uiux-promax skill for the page; the orchestrator does a browser check (memory: local-ui-preview).
- Public repo: no real names, merchants or money figures; fixtures fabricated.
