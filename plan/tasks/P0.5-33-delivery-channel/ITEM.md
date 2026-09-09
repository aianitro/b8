# Roadmap item — P0.5-33-delivery-channel

**Lineage:** ROADMAP.md §5 Phase 0.5, step 33 — the phase's last step. Orchestrator's reading.

**Position.** Steps 28–32 are merged. The app can now say which categories will blow the month, and
how much of the month that answer saw. **All of it still requires someone to open the page.** §5:
*"A pacing warning that only exists on a page nobody opened on the day it mattered is not a
guardrail."*

*Exit (§5): a category crossing its projected-breach line produces a message the owner receives
without visiting the app.*

## What makes this step categorically different from 28–32

**It is the app's first outbound surface.** Every prior step in this phase was a pure function or a
page render; nothing left the process. This one moves real financial figures out of it, and that
crosses three written boundaries at once:

1. **`BUILD.md` §5.1 escalation trigger** — *"Any change that would put real financial data behind a
   network-reachable surface"* stops the loop and goes to the human. Not advisory.
2. **`BUILD.md` §5.4 domain constraint** — *"Real financial data never leaves the machine — not into
   logs, commit messages, screenshots, or the conversation."* A delivered message is a deliberate,
   written exception to a standing prohibition.
3. **ROADMAP.md §5's outbound carve-out** (added 2026-09-01, corrected 09-02) — **this step
   establishes the allowlist and the redaction boundary that Phase 3 step 25's push notifications
   and Phase 5 step 38's weekly report both inherit.** It is named there as the first crossing, and
   the boundary is *"leaves the process"*, not *"leaves the machine"* — so a local file is inside it,
   not exempt from it.

## The contradiction in §5 that this step cannot resolve on its own

- **Step 33 says:** *"Email first, since it needs no service worker and no deploy story."*
- **Phase 5 step 38's non-goals say:** *"no third-party service holding the ledger, **no cloud mail
  provider**, no attachment containing raw transaction rows."*

Email with no deploy story means SMTP through somebody else's server — Gmail, Fastmail, SendGrid —
which is a cloud mail provider holding the content in transit and at rest. Self-hosted mail satisfies
step 38 and **is** a deploy story, which is Phase 2, which has not happened. **The two sentences
cannot both hold**, and this is a decision about where the owner's financial data is allowed to go.
That is not a spec-writer's call, and under §5.1 it is not the orchestrator's either.

## State of the machine, measured

- **No mail infrastructure exists.** No `nodemailer`, `smtp`, `sendgrid`, `mailgun` or `postmark`
  anywhere in `package.json`, `lib/` or `app/`. This is a new dependency and a new secret.
- **`.env.local` holds `DATABASE_URL`, `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`,
  `ANTHROPIC_API_KEY`.** Any credential this step adds joins that file — gitignored, gitleaks-gated,
  and never committed (§0).
- **A scheduler exists and is wired in.** `lib/scheduler.ts` exports `startDailySyncScheduler(hour = 6)`
  using `setTimeout`/`setInterval`, started from `instrumentation.ts`. **Phase 2 step 20 exists to
  replace it with OS cron**, and Phase 5 step 39 says the report must build on that cron rather than
  this timer. Step 33 arrives before Phase 2, so what triggers a send is an open question, not a
  given.

## Open questions for the spec — after the owner's decision, not before

The destination question above is **blocking and is being put to the owner**. These follow it:

- **What may leave the process?** The allowlist is this step's deliverable and the thing two later
  steps import. Category names? Amounts? A bare "you are projecting over on 3 categories, open the
  app"? The strongest privacy posture that still functions as a guardrail is probably the last, and
  it is worth stating why rather than assuming the message must carry figures.
- **What triggers a send, given Phase 2 has not happened?** The in-process timer is what exists; it
  is also what step 20 will delete. Building on it creates work for step 20 to undo; building a
  second scheduler is the two-reducers defect in a new dimension.
- **How is a send gated?** Sending cannot be tested deterministically — worse than the renderer
  problem, because a test that sends is a test that leaks. A pure "what would be sent" function with
  the transport injected is the obvious shape; the spec must say so and gate the *content*, not the
  delivery.
- **What stops a duplicate or a storm?** A projected breach persists for days. Sending daily until
  the month ends is how a guardrail becomes noise that gets filtered.
- **What happens when coverage is low?** Step 32 established that the headline refuses authority
  below 95%. **A guardrail that emails a figure the dashboard itself refuses to stand behind is
  incoherent**, and on the owner's real data August sat at 7.7%. This is the sharpest interaction
  between this step and the last one.
- **Failure is silent by nature.** An email that does not send looks exactly like a quiet month —
  the same failure Phase 5 step 39's heartbeat exists to catch, arriving one step early.

## Contracts touched

**Unknown until the destination is chosen.** A send log — to suppress duplicates and to make failure
visible — would be a new table and would open G1. Say so rather than discovering it mid-flight.

## Non-goals

- **No new adherence, pacing, outlook or coverage arithmetic.** Those four modules are read-only
  inputs; their tests are the tripwire.
- **No dashboard change.** Step 31 owns the surface.
- **Nothing sends during development.** No agent sends a message to any real address at any point.
