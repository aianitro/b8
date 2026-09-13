# Roadmap item — P1-11-api-v1-overview

**Lineage:** ROADMAP.md §5 Phase 1, step 11. Orchestrator's reading.

> 11. **`GET /api/v1/overview`** — single-round-trip dashboard payload; web dashboard adopts it
> too. (S)

**Position.** P1-10 merged 2026-09-12 (G0 ✅ G1 ✅ G2 ✅ G3 ACCEPT_WITH_NITS G4 ✅, 0 implementer
cycles), so `shared/contracts/` exists and this is its first real consumer. Phase 1's exit —
*"`curl` with a bearer token returns everything the dashboard needs; UI fully on v1"* — belongs to
steps 10–13 together. This step owns the payload. Not the auth (step 12), not the rate limit
(step 13).

## The premise both source documents state is no longer true

**ROADMAP.md §5 step 11 and BUILD.md §14 both describe a net-worth-first payload.** §14 is the
process document's own worked example *of this exact task*, and its abridged goal reads: "net worth
decomposed into its four components, the current-year budget summary, and sync health."

Phase 0.5 step 31 moved net worth off the dashboard entirely, to `/net-worth`. Measured today:

```
$ grep -cin "net.worth\|netWorth" app/dashboard/page.tsx   → 0
$ grep -c  "getNetWorth\|netWorth"  app/net-worth/page.tsx → 14
```

A payload built from §14's description would be a single-round-trip fetch of figures the dashboard
does not render, and would omit everything it does.

**This is not a surprise; it is the thing Phase 0.5 was ordered early to prevent.** That phase's own
justification names step 11 by number: defining this contract against the old hierarchy would freeze
net-worth-first into the one artifact the web and the mobile client share, and force a reshape weeks
later. The phase ran first precisely so this step could describe the surface that is actually
wanted. The spec must therefore derive the payload from `app/dashboard/page.tsx` as it stands, and
treat §14's field list as an illustration of *form* — a single request, a typed contract, the
dashboard reading it instead of querying — not of content.

**BUILD.md §14 is not edited by this task.** It is a worked example of the process, and its value is
the G0→G4 narrative and the reviewer finding at the end, all of which still hold. The spec records
the divergence instead.

## What the payload actually has to carry

`app/dashboard/page.tsx` is 691 lines with **10 raw `db.query` calls** across six loaders —
`getStats`, `getRecentArrivals`, `getTodayStats`, `getWeekStats`, `getMonthlySpending`,
`getBudgetVsActual` — plus four module readers: `loadFeedHealth`, `loadMonthOutlook`, `loadYearEnd`,
and `findBalanceDrift`. Enumerating that set, and deciding what belongs in one payload versus what
is a separate concern, is the spec's first job and the main reason this step may not be (S).

## The defect this step is most likely to ship, inherited from P1-10

`plan/tasks/P1-10-zod-contracts/NITS.md` **N4**, measured against `b8_demo` by running the page
queries verbatim:

```
app/accounts/page.tsx   → last_synced_at  typeof object (Date)
app/categories/page.tsx → created_at      typeof object (Date)
                        → annual_budget   typeof string
```

The row schemas describe **the JSON wire value**, not the `db.query` row. `pg` hands timestamps back
as `Date` objects; `Response.json` turns them into strings. So a handler that validates its own rows
with `BudgetCategorySchema` *before* serializing fails on every timestamp, and a schema loosened to
accept both would destroy the property the contract exists to state. The endpoint returns JSON, so
the schemas fit it exactly — but only on the far side of serialization.

**N6** is the other half: these are response schemas, not request validators. Nothing here should
reach for one to check an inbound body.

## Contracts touched — expected

`shared/contracts/overview.ts` (new), additive. Guardian work, so **G1 runs** rather than skips.
BUILD.md §14 names that exact path, and it remains right: P1-10's ITEM.md established that the
workspaces conversion is a separate successor (`P1-10a`), so contracts stay at `shared/contracts/`.

No migration and no `db/schema.sql` change is expected. This step composes existing reads.

## A scope question the spec must answer, not the implementer

The roadmap line bundles two things: **the endpoint**, and **the dashboard adopting it**. §14 treats
both as one (S) task and its worked example has the dashboard switch over in the same diff.

That was written against a smaller dashboard. Today adoption means rewriting a 691-line server
component to consume one payload instead of ten queries — a change with real regression surface on
the app's primary screen, whose correctness is not provable by the endpoint's own tests. P1-10 was
split for exactly this reason and closed with zero implementer cycles.

**The spec decides: one task or two.** If two, the endpoint lands first and adoption becomes
`P1-11a`, with the queue carrying the split so it is visible rather than implied. I am not
pre-empting the answer, but the sizing concern is recorded before anyone estimates.

## Also worth stating as a non-goal, because it looks like one

P1-10's non-goals forbade creating `app/api/v1/`. **Here it is the deliverable.** That prohibition
was scoped to the task that introduced the schemas, to keep a 27-handler migration out of a contract
diff. Migrating the *existing* 27 routes remains a separate successor (`P1-10b`); this step creates
one new endpoint that is born at v1. A reviewer enforcing P1-10's non-goal against this task would
be applying a rule that never covered it.
