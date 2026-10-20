# P5-34 — adversarial review, cycle 1 — 2026-10-19

**Verdict: ACCEPT_WITH_NITS.** Persisted by the orchestrator from the reviewer's report (the reviewer is read-only).
No BLOCK: every mapping row, null carriage, sign, both month conversions, the money formatter, `notEvaluated`, the
ordering and the purity checks held against the producer sources.

## Falsification log (20 hypotheses)
REFUTED: severity/confidence differing from the mapping table; a binary ternary sending a future producer state to the
milder severity (the copied status fields are strict enums, so tsc fails first); producer worst-first order broken (V11
runs the real producers); a null coerced to 0/''/HEALTHY; a sign flip (no arithmetic; V3 on a credit fixture); money
formatting differing from `wireMoney`; month off-by-one or year error; a producer field dropped or renamed (only
`charges`; `ProducerFieldsAreDecided` pins key sets); transaction text in a Finding; omitted vs empty source confusion;
order depending on input key order or sort stability; input mutation (A5 deep-freezes); clock read or IO import in a pure
module; a W checker unable to fail; reportable predicates differing from the UI's; scope or figures; V13 passing
trivially. CONFIRMED (as nits): W1 blind spots; the backup-rehearsal producer missing from the inventory; the job
contract's `min(0)` rejecting real producer output under clock skew.

## Findings (all NIT)
- **N1** `apps/web/lib/findingsWiring.test.ts:96-113, :57` — W1 does not follow an element access into a lookup table, a
  helper's return value, `let`, a parameter default or an imported const, and does not scan `apps/web/scripts/` or
  `instrumentation.ts`. Meets the spec's W1 wording. For step 36: widen the follower and the scan roots.
- **N2** `apps/web/lib/backupPlan.ts:118` — `compareCounts` / `CountMismatch` (a failed backup-restore rehearsal) is a real
  finding producer missing from the inventory (W3 is name-based and cannot see it); `StoredProposal` (pending agent
  proposals) is borderline. For step 35/36.
- **N3** `packages/contracts/findings.ts:385` vs `apps/web/lib/domain/jobHealth.ts:61-80` — under clock skew the producer
  returns `late` with `daysSince: -1`, which the contract rejects. Confirmed by command at G3. No consumer today.
- **N4** `apps/web/lib/domain/findings.ts:371-381` — the cross-source tie order puts overdraft forecasts last among
  warnings. Spec-defined, "carries no judgement"; for step 36's ranking.
- **N5** `apps/web/lib/domain/findings.ts:424-434` — no viewer concept: findings carry no row text, but adherence and
  drift figures are whatever the caller supplies; step 36 must feed producers masked for the viewer (P7-41b).
- **N6** `apps/web/lib/domain/findings.ts:175` — a comment reads "$0-budget". Zero, the same phrase as `adherence.ts`;
  trivial under AGENTS.md's figures rule.
