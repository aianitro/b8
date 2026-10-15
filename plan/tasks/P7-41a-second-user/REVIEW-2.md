# REVIEW-2 — P7-41a-second-user (cycle 1 delta)
**Verdict:** ACCEPT_WITH_NITS
**Reviewer:** adversarial-reviewer (read-only; persisted by the orchestrator)

## Falsification log
| # | Hypothesis | Method | Result |
|---|---|---|---|
| 1 | The new S6's `pg_stat_activity` count matches waits other than the two redemptions, so unlocked code passes. | `invitations/route.test.ts:216-238` filters `datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%user_invitations%'`. The holder is idle (`Client`), the poller is active, files run serially. Locked: both wait at the `FOR UPDATE` SELECT. Unlocked: both wait at the consume `UPDATE`. Both name the table, so the count reaches 2 either way; above 2 fails `toBe(2)`. | REFUTED |
| 2 | With `FOR UPDATE` removed, S6 passes once the holder releases. | Unlocked, the consume UPDATE re-checks only `code_hash`; `consumed_by UNIQUE` cannot fire for two users; both get 200, so `[200, 403]`, `users + 1` and the credential count all fail. Locked, the second waiter re-checks `consumed_at IS NULL` and gets 403. Orchestrator measured 5/5 fail mutated, 5/5 pass restored. | REFUTED |
| 3 | The bounded wait times out or deadlocks into a pass. | A count that never reaches 2 throws at `toBe(2)`; the vitest 5000 ms timeout is also a failure. Lock waits form a chain, not a cycle. Pool default max 10, at most 4 busy. | REFUTED |
| 4 | After the holder's ROLLBACK, S6 asserts the wrong thing or leaks state. | Release, then both outcomes awaited, then assertions on committed rows. On the failure path only, `racing` is never awaited (noisier failure, never a pass). | REFUTED (cosmetic, NIT R2-N3) |
| 5 | `enrolCredential`'s `FOR SHARE` and `revokeUser`'s `FOR UPDATE` deadlock. | Both lock the same `users` row first and hold nothing before it. Enrol first: revoke waits, then its DELETE removes the new credential. Revoke first: enrol re-checks `revoked_at` and refuses. No cycle. | REFUTED |
| 6 | S16's N3 assertion cannot tell `FOR SHARE` from a plain SELECT. | `revoke.test.ts:142-149` enrols only after revoke commits, so a plain `SELECT … AND revoked_at IS NULL` passes too. Without `FOR SHARE`, enrol-first lets the credential INSERT land after revoke's DELETE (FK still satisfied: the users row is not deleted). Sign-in is still refused by `resolveSession`. | CONFIRMED (NIT R2-N1) |
| 7 | The N3 assertion is vacuous. | Asserts the exact refusal and that the credential id has 0 rows; with the check removed the INSERT succeeds and the assertion fails, matching the orchestrator's probe. | REFUTED |
| 8 | The Sidebar change touched more than ink. | Changed lines read as the comment at 96-97, `text-cyan-100` at 100, and three Finance marks (175, 203, 242). Render logic unchanged from REVIEW-1's reading. | REFUTED as far as reading shows (I-R2-2) |
| 9 | Other text on the same ground is still below the floor. | `Sidebar.tsx:114`, `:119` use `text-cyan-100/70` at 10px (about 3.3:1). Predates the task. | CONFIRMED, pre-existing (NIT R2-N2) |
| 10 | The new lock adds a deadlock with other writes on the user's rows. | `FOR SHARE` is compatible with the FK KEY SHARE taken elsewhere. Separately, a pre-existing revoke-versus-decide deadlock (revoke's session-delete cascade needs the proposal row a concurrent decide holds) aborts one with 40P01: a single 500, no wrong state. | REFUTED for the delta; NIT R2-N4 |

## Findings
- **[NIT R2-N1]** `apps/web/app/api/v1/auth/users/revoke.test.ts:143` — the N3 assertion covers revoke-then-enrol only; deleting `FOR SHARE` is not caught. Fix: a forced-overlap probe in S6's style.
- **[NIT R2-N2]** `apps/web/components/Sidebar.tsx:114,119` — section headers `text-cyan-100/70` at 10px, about 3.3:1. Pre-existing.
- **[NIT R2-N3]** `apps/web/app/api/v1/auth/invitations/route.test.ts:238` — `racing` not awaited on the failure path. Diagnostics only.
- **[NIT R2-N4]** `apps/web/lib/users.ts:71` — pre-existing revoke-versus-decide deadlock under a narrow race; a 500, no wrong data.

## Scope violations
None in the delta.

## Inconclusive — requires execution
- **I-R2-1** delete only `FOR SHARE` at `authSession.ts:283`, run `T41a-S16`; expected `1 passed` (confirms R2-N1). Restore and `diff -q`.
- **I-R2-2** `git diff HEAD -- apps/web/components/Sidebar.tsx | grep -E '^[-+][^-+]' | grep -vE 'cyan-100|^\+\s*//|^-\s*//'`; expected no output.
- **I-R2-3** run `T41a-S6` three times verbose; expected well under 5000 ms each.
