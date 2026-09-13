# NITS — P1-11-api-v1-overview

Follow-ups from three adversarial cycles. Everything blocking was fixed before merge; what remains
is recorded for the successor tasks. **N1 is the one the route migration must read first.**

## N1 — `allPaces` is dropped, so this payload cannot yet feed the dashboard's lead widget
`loadMonthOutlook` returns `{ outlook, allPaces }`. The dashboard builds `CategoryBubbles` — the
first thing on the screen since P0.5-31 — from `allPaces` (`app/dashboard/page.tsx:528-536`). The
endpoint carries `outlook` only, matching SPEC.md's frozen payload table, **which also omits it**.

So this task's own headline claim — "everything `app/dashboard/page.tsx` currently fetches" — is not
quite true, and **`P1-11a` cannot adopt the endpoint without a twelfth section and a contract
amendment**. Budget it there rather than discover it there. Not a diff defect: the diff matches the
spec exactly, and the spec is what missed it.

## N2 — acceptance #26 does not follow the module graph
The Expected column says "a real import of all four shared readers somewhere in the route's module
graph." The script walks files *in* `app/api/v1/overview/` and reads their own specifiers. `route.ts`
imports only `@/lib/overviewRead`; the four readers are called one module deeper, and #26's `4` comes
from `route.test.ts`'s imports.

It would be satisfied over a handler that re-derived every figure, provided the test file imported
the readers. The hazard is independently closed by I7–I10, which assert *agreement* with the four
readers called directly — a stronger control than an import check. Adjudicated at G2; recorded so the
next spec does not copy the command.

## N3 — acceptance #16 cannot measure disjointness
`grep -cE "lib/\*\*|shared/\*\*" vitest.integration.config.mts` → `0` is satisfied by
`include: ['**/*.test.ts']`, which would collect the whole pure suite under the DB-requiring config —
the precise failure mode SPEC.md's own list names. The shipped config is genuinely disjoint, proved
by `vitest list` under each (EVIDENCE §6), not by #16.

**N2 and N3 are the fifth and sixth instances in this project of a control that does not measure the
rule it stands for**, after the substring-vs-import check, the path-prefix-vs-contract-surface check,
the version-pattern-vs-range check, and the module-graph case. The pattern is now well enough
attested to be worth a standing question at G0: *for each command, what does it measure, and is that
the rule or a proxy for it?*

## N4 — the guard is a denylist of one name, and reads no endpoint
`assertScratchDatabase` refuses the database *name* `b8_finance`. It reads no host and no port, so
two clusters on one machine can both hold a `b8_p111_throwaway` and an approved name says nothing
about which server answers. A differently-named production clone passes.

Accepted at G0 as the residual, and re-stated precisely at G3 cycle 3 after the structural claim was
qualified. Worth revisiting only if this repo grows a second cluster; an allowlist has its own
failure mode — refusing a legitimately-named scratch database and getting switched off.

## N5 — `toBeLessThanOrEqual(1200)` passes at equality in January
At `asOf.month === 0` the operational projection is **exactly** `1200.00`, so the bound holds with no
slack. True for this seed in all twelve months, which is what was asked of it. Recorded so whoever
adds a second operational expense category knows which assertion tells them first.

## N6 — orphaned promises on the error path
`loadOverview` starts `driftPromise`/`feedPromise` before the first `await` and consumes them after
it. If the first `Promise.all` rejects, those two are never awaited; a connection failure rejects all
three. Inherited verbatim from `app/dashboard/page.tsx:453-466`, so "behaves identically" holds — but
the blast radius differs: in a route handler with no `try`/`catch` it is the server worker rather
than a render boundary.

## N7 — `today.totalCount` ranges over a wider population than `today.spent`
`4` against the seed while `today.spent` is `"120.00"`: the dashboard's third today-query carries
**no category predicate at all**. Pre-existing in the running code, faithfully reproduced here
because "no change to how any figure is computed" is a non-goal. A candidate for `P1-11a`'s own nits.

## N8 — a frozen-spec contradiction, resolved toward the running code
SPEC.md's landscape table says `monthlySpending` filters `is_income = FALSE`; `getMonthlySpending`
has no such predicate. The diff followed the running code, correctly: income categories carry only
negative amounts, so the predicate cannot touch `operational` at all — it can only empty `received`.
Against this seed it would have made `received` read `20.00` instead of `5020.00`, disagreeing with
the very chart the endpoint exists to feed. **That spec table cell should read "not filtered."**
