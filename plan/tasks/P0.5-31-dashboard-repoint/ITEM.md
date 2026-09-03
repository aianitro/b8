# Roadmap item — P0.5-31-dashboard-repoint

**Lineage:** ROADMAP.md §5 Phase 0.5, step 31 — verbatim in §5. This file is the orchestrator's
reading of it, not a second definition.

**Position.** Steps 28, 29 (+29a) and 30 are merged and **none of them is visible**. They built the
vocabulary — which categories are scored, what over- and under-spend mean, where a category will
close. The app still opens on the net-worth hero card. **Step 31 is the step that performs the
ideology change the phase is named for**, and the first that a user would notice.

## The item

> The hero becomes the answer to *"will I close this month inside my limits, and which categories say
> no"* — a state and a named list, not a vanity score. **Net worth leaves the dashboard entirely**,
> living at `/net-worth`, reached by deliberate navigation, so it is seen when it is sought and never
> incidentally. The supporting cards re-sort behind the new question: category pacing, uncategorized
> queue, off-cycle and breach alerts.

*Exit (§5): the dashboard can be read for a week without the net-worth figure appearing, and the
question it answers first is a budget question.*

§5 additionally binds two consequences into **this step's diff, not a follow-up**: the `NITS.md` N2
YTD-delta definition-change bug **relocates** to `/net-worth` along with the computation and is fixed
here rather than left to ride; and `README.md`'s screenshots become a picture of a product that no
longer exists, so `scripts/seed-demo.mjs` and the screenshot set are part of this step.

## What is different about this step, measured

**1. This is the first task in the phase with a UI surface, and there is no way to gate one today.**

- `vitest.config.mts` includes exactly `lib/**/*.test.ts`, `shared/**/*.test.ts`,
  `.claude/hooks/**/*.test.mts`, with `environment: 'node'`.
- No `@testing-library/*`, no `playwright`, no `jsdom`, no `happy-dom` in `node_modules`.

So *"the dashboard shows the budget question first"* is **not currently expressible as an acceptance
command**, and BUILD.md §7.1 requires every acceptance command to be literal, runnable and
deterministic. **How this step is gated is the spec's hardest decision and it must be made
explicitly, not worked around.**

**2. The dashboard is its own query layer and its own calculator.** `app/dashboard/page.tsx` is 573
lines and defines `getStats()`, `getTodayStats()`, `getWeekStats()`, `getBudgetVsActual()` as local
`async function`s issuing raw SQL, plus inline pace arithmetic. It imports `computeCurrentNetWorth`
and `findBalanceDrift` but computes most of what it renders itself. Note BUILD.md §7.5's own G4
item — *"no surface computes a shared concept independently of `lib/netWorth.ts` / `lib/domain/`"* —
which this page is already in tension with, and which a *new* headline computed inline would
violate outright.

**3. The demo seed cannot render the new dashboard at all.** `scripts/seed-demo.mjs` never writes
`control_mode` (`grep -c` → `0`), which is P0.5-28's NITS **N7**. Every seeded category is therefore
`fixed`, `isScoredCategory` admits none of them, and `scoredHeadline` correctly returns `null`. **On
demo data the re-pointed dashboard renders "there is nothing to score."** Since the README
screenshots are produced from exactly that dataset, the seed is a hard prerequisite for the
screenshots, not a tidy-up after them.

**4. `/net-worth` already exists** (165 lines) and already uses `computeCurrentNetWorth` and
`groupRealEstateEquity`. So "net worth leaves the dashboard" is mostly *deletion* from one page —
but the dashboard's YTD delta, net-worth sparkline and trend chart must either relocate or die, and
N2 rides on the delta.

## Open questions for the spec — flagged, not decided here

- **How is a page change gated?** The three shapes available, none free: (a) **extract the page's
  computation into a pure `lib/domain/` module** and test that exhaustively, leaving the page a thin
  renderer, with static commands asserting the page no longer computes — this matches the pattern
  steps 28–30 established and the G4 truthfulness rule, and is the orchestrator's expectation absent
  a reason otherwise; (b) **add a component-test toolchain** (jsdom + RTL), which is a real
  dependency and `vitest.config.mts` change and must be justified as more than convenience;
  (c) accept weaker evidence for the visual layer specifically, and say so out loud rather than
  pretending a grep is a gate. A spec that leaves this implicit fails G0.
- **Where does the clock live now?** `categoryPacing` takes an explicit `AsOf` and reads no clock by
  design (P0.5-30 acceptance #26). **Step 31 is the caller that owns the clock read.** How it enters
  a server component, and how a deterministic test still reaches the code path, is a spec decision.
- **What does the hero render when there is nothing to score?** N12 made "nothing to score" and
  "perfect adherence" distinguishable, and this is the first surface that can get it wrong. The
  demo dataset is exactly this case, so it is not a corner.
- **Step 32 has not shipped.** §5 orders the re-point (31) *before* the categorization confidence
  bound (32), so for one step the dashboard shows an adherence figure with no stated share of spend
  behind it — in a phase whose whole thesis is not shipping confidently wrong numbers. Whether 31
  must carry an interim caveat, or whether the ordering should be revisited, is a decision the spec
  should make deliberately rather than inherit.
- **Screenshot regeneration touches real data.** README §77 documents the process: back up the
  database, load synthetic data, capture, restore. That is a destructive sequence against the dev
  database holding real financial data, and BUILD.md §5.1 makes it a human escalation. The spec
  should say plainly whether an agent performs it or the owner does.
- **Which inherited nits are due here.** P0.5-30 assigned N32 (`spentRatio` carries three
  incomparable meanings across statuses — "250% of December" is renderable on a month that has not
  begun), N33, N34, N37 to "step 31's caller contract", and P0.5-29a assigned N21, N26, N29. This is
  that step. The spec should name which it discharges and which it re-defers, rather than letting
  them roll silently forward.
- **The incumbent pace defect, measured at P0.5-30's G0 and not yet fixed.**
  `app/dashboard/page.tsx:356` computes `monthsElapsed = new Date().getMonth() + 1`, so on 1 April it
  treats 33.3% of the year as elapsed against a true 24.7% — inflating expected spend and
  **flattering** the pace. It is inconsistent with its own neighbour eleven lines below, where
  `expectedWeekSpend` is day-granular. This step re-points that card; the fix belongs here.

## Contracts touched

**Expected: none.** Every column needed exists. If the spec finds a contract change genuinely
required, G1 re-opens and the lease is taken before the guardian is dispatched.

## Surface

Wider than anything in this phase so far: `app/dashboard/page.tsx`, `app/net-worth/page.tsx`,
`components/**`, `scripts/seed-demo.mjs`, `docs/screenshots/**`, `README.md`, and probably a new
`lib/domain/` module. **The scope-guard hook is not active from a session rooted above `app/`**
(QUEUE.md H2), so the declared surface is enforced by the spec's own scope command and the
orchestrator's diff review, not by mechanism.

## Non-goals

- **No delivery.** Step 33 owns the outbound channel and the allowlist that comes with it.
- **No new adherence or pacing arithmetic.** `lib/domain/adherence.ts` and `lib/domain/pacing.ts` are
  read-only inputs; 71 tests across them are the tripwire. A figure the dashboard needs that neither
  module produces is a finding to report, not a local calculation.
- **No auth, no API v1, no contract package.** That is Phase 1, still blocked.
