# P5-35 — freshness becomes a property of every finding

**Roadmap:** ROADMAP.md §5, Phase 5, step 35. Started 2026-10-19 at the owner's request ("yes" to starting step 35),
through the five-agent pipeline. Builds on P5-34 (`0fa8526`): the `Finding` contract and `assembleFindings`.

## The request (ROADMAP §5, 35)

Extend `syncHealth` from "are the items connected" to "as of when is each input believed true": last observation per
account, last valuation per property, last import per budget row. A finding carries the staleness of its worst input,
and a finding whose inputs cannot be dated says so. Non-goal: no narration yet. This precedes narration deliberately —
a report stating "you are 8% under budget" over transactions that stopped importing three weeks ago is worse than
silence, because it converts missing data into apparent good news.

## Carried in from P5-34 (plan/tasks/P5-34-finding-vocabulary/NITS.md) — the spec must dispose of each

- **N3:** under clock skew `jobHealth` returns `late` with `daysSince: -1`, which the `Finding` contract (`min(0)`)
  rejects (confirmed by command at P5-34 G3). Decide which side is wrong and fix it here; this step reopens the contract.
- **N2:** the backup-rehearsal mismatch (`lib/backupPlan.ts` `compareCounts` / `CountMismatch`) is a finding producer
  missing from the inventory; pending agent proposals (`StoredProposal`) are borderline. Include or explicitly defer.
- The feed `unknown` state is still invisible (an unobserved feed is not "ok"), and the sync producer turns a null bank
  into the text `Unknown`. Decide what freshness says about each.
- P5-34's Q2: a property subject was deferred "until step 35 has a producer for it (last valuation per property)".

## Standing constraints

- Contract surface expected: `packages/contracts/findings.ts` (additive freshness, plus the N3 fix). G1 with the lease;
  the scope guard enforces it.
- Freshness is decided from timestamps the database already records, evaluated against one as-of date passed in — no
  clock read in pure modules (P5-34's rule). "Cannot be dated" is a stated value, never a default to "fresh".
- Still no narration, no page, no delivery (steps 36–38). Whether any existing card or the overview payload changes is
  the spec's to decide and justify; the P5-34 default was "no existing file modified".
- Public repo: no real names, merchants or money figures; fixtures fabricated. Gift masking (P7-41b): freshness must not
  reveal a masked row's details (e.g. a per-account "last observation" is a date, not a transaction).
