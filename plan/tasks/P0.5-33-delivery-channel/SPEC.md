# P0.5-33-delivery-channel — a projected breach leaves the process as an email, under a written allowlist, at most once per breach set
**Roadmap item:** ROADMAP.md §5 Phase 0.5 step 33 — "A delivery channel, so a guardrail can reach the owner without the app being open." Orchestrator's reading: `plan/tasks/P0.5-33-delivery-channel/ITEM.md`. Binding human decision: `plan/tasks/P0.5-33-delivery-channel/DECISION.md` (`BUILD.md` §5.1).
**Status:** DRAFT
**Author:** spec-writer

## Goal

The app gains its **first outbound surface**. The daily job that already runs inside the Next server
gains one more task: compute this month's outlook — the same `MonthOutlook` the dashboard renders,
from the same reader, never a second query — and, when it says something worth saying, hand a short
plain-text message to a hosted SMTP provider over TLS.

Three things are true of that message and all three are mechanically gated:

1. **It carries only what `DECISION.md` allows**: category names, amounts, ratios, counts, the as-of
   day and the coverage percentage. Nothing else. Not a merchant, not an account, not a balance, not
   a transaction, not a credential.
2. **It never asserts what the dashboard refuses to assert.** Step 32 established that the headline
   stops being a verdict below `COVERAGE_THRESHOLD`. Below that threshold **no category name, amount
   or ratio leaves the process at all** — the message degrades to the one figure that is authoritative
   at any coverage, which is the coverage itself.
3. **It is sent at most once per distinct breach set per month.** A projected breach persists for
   days; a guardrail that repeats itself daily is a guardrail that gets filtered.

The decision of *what would be sent* is a pure, total function of the outlook and the send history,
tested exhaustively. The delivery itself is **not tested and must never be described as tested** —
see Q1. Nothing in this spec, and no acceptance command in it, opens a socket or sends a message to
any address.

The exit criterion (§5): *a category crossing its projected-breach line produces a message the owner
receives without visiting the app — and the allowlist naming exactly what that message may contain
exists and was approved before it was sent.* The allowlist is `DECISION.md` plus §"The allowlist and
the redaction boundary" below, which is the artifact Phase 3 step 25 and Phase 5 step 38 **import**.

## Non-goals

- **No new adherence, pacing, outlook or coverage arithmetic.** `lib/domain/adherence.ts`,
  `lib/domain/pacing.ts`, `lib/domain/monthOutlook.ts` and their test files are **read-only inputs,
  byte-identical**; their 47 + 24 + 40 = 111 tests are the tripwire (#63–#66). The alert emits no
  money figure of its own: every dollar and every ratio it prints is a value copied off an
  `OutlookCategory`, formatted, never re-derived (#48, #49).
- **No change to what the dashboard renders.** `app/dashboard/page.tsx` changes **only by deleting
  four private query functions and importing the module they moved to**. No markup, no copy, no
  figure, no `data-testid` moves. #55–#62 pin the rendered surface byte-for-byte where it is
  greppable. See Q6 for why the move is unavoidable and why it is not a dashboard change.
- **Nothing sends during development.** No agent sends a message to any real address at any point.
  No acceptance command constructs a transport (#41), no test file imports one (#42), no test reads
  `.env.local` (#43), and the shipped code refuses to construct a transport unless `ALERTS_ENABLED`
  is exactly the string `true` (#M7).
- **No second destination.** One provider, over SMTP, per `DECISION.md`. Adding a second destination
  — a webhook, a file, a push service, a second address — re-triggers the `BUILD.md` §5.1 escalation
  and is not authorised by this spec (#44 pins the transport to one file).
- **No second scheduler and no new timer.** The send rides the existing `runAndLog` in
  `lib/scheduler.ts`. No `setTimeout`, no `setInterval`, no `instrumentation.ts` change (#33–#36).
  See Q3.
- **No raw transaction rows, no attachment, no HTML body.** A plain-text body only: HTML mail invites
  a remote image, and a remote image is a second outbound surface with a different destination.
- **No `category_rules` work, no sync-cadence change, no Plaid change** (#69).
- **No `shared/types.ts` change.** The alert's types are `lib/` types, the same class as
  `MonthOutlook` and `CategoryPace` (#68).
- **No route, no page, no UI for alerts.** No `app/api/**`, no `components/**` (#69). A "send test
  email" button is exactly the affordance that sends during development.
- **No heartbeat and no liveness signal.** Phase 5 step 39 owns it. What this step does instead is
  record every *attempt* and its outcome, so the absence of a record is distinguishable from a failed
  send — see Q5, and read the limitation in "Questions this spec could not settle".
- **No seed or screenshot change.** `scripts/seed-demo.mjs` and `docs/screenshots/**` are outside
  this diff (#69).
- **No component-test toolchain and no change to `vitest.config.mts`** (#69). T8.

## Contracts touched

| File | Change | Class (§9.2) |
|---|---|---|
| `migrations/<ts>_alert-sends.sql` | new append-only table `alert_sends`, recording one row per send **attempt** | **additive** |
| `db/schema.sql` | reflects the new table | **additive** |
| `shared/types.ts` | *(none)* | — |

**G1 re-opens, and this is said plainly here rather than discovered mid-implementation.** Duplicate
suppression requires remembering what was already sent, and there is nothing in this schema that
remembers it. `sync_log` records syncs, not messages. The alternatives were considered and rejected
in Q4.

**What the table must and must not hold, as a constraint on the guardian, not a design:**

- It must let the shell answer one question — *has a message with this fingerprint already been
  delivered?* — and record one fact per attempt: **when, which kind, which fingerprint, whether it
  was delivered, and if not, why.**
- It must hold **no money column, no category name, no merchant, no account identifier, and no
  amount of any kind** (#71). The fingerprint is an opaque digest (#20, F17). This is not squeamishness:
  a send log is the row a future `EVIDENCE.md`, screenshot or `psql` paste will contain, and §5.4 says
  real financial data never leaves into logs.
- Append-only, like every other observation table in this repo. No `UPDATE`, no upsert, no
  "last sent" column — a stored latest is a derived read here as everywhere else (§5's step-9
  consolidation note).
- `db/schema.sql` reflects it; `npm run migrate:up && npm run migrate:down && npm run migrate:up`
  is clean against a throwaway database (G1's own checklist, T6).
- G1's "money columns are `NUMERIC` with a stated scale" is satisfied **vacuously**: there are no
  money columns. Say so at the gate rather than leaving the box ambiguous.

`package.json` / `package-lock.json` gain `nodemailer` (and its types). A new dependency and a new
secret, both named in `ITEM.md` as this step's cost.

## The allowlist and the redaction boundary

**This section is the step's inherited deliverable.** ROADMAP.md §5's outbound carve-out
(amended 2026-09-01, corrected 2026-09-02, discharged 2026-09-03) says step 33 establishes it and
that Phase 3 step 25 and Phase 5 step 38 **import** it. It is written as a closed list in both
directions, because an allowlist with an unstated other half is a wish.

### May leave the process

| Field | Source | Why it is on the list |
|---|---|---|
| Category **name** | `OutlookCategory.category` | `DECISION.md` §1.2, verbatim: *"Dining Out at 71% on day 8, projecting 266% of budget."* Without it the message cannot be acted on without opening the app, which is the thing this step exists to avoid. |
| `budgeted`, `actual`, `projected` | `OutlookCategory`, copied by reference | The figures the verdict is made of. |
| `spentRatio`, `projectedRatio` | `OutlookCategory` | Ratios, named in `DECISION.md`. |
| `elapsedDays`, `daysInMonth` | `OutlookCategory` | The qualifier `pacing.ts` built these fields to carry. A projection without its day is the sentence with its caveat removed. |
| The as-of **year and month** | `MonthOutlook.asOf` | Rendered `YYYY-MM`, 1-based (Q7). |
| `coveragePercent` | `MonthOutlook` | The one figure that is authoritative at any coverage — the caveat "always ships" (§5 step 32's exit). |
| `sayingNo.length`, `scoredCategoryCount` | `MonthOutlook` | Counts. |
| The **reason** (`off-cycle` / `breach` / `projected-breach`) | `OutlookCategory.reason` | A closed vocabulary of three words; carries no figure. |

### Must NOT leave the process — and each is a named negative control

| Forbidden | Where it lives today | Asserted by |
|---|---|---|
| Merchant name / description | `transactions.name`, `transactions.merchant_name` | F2, #9 |
| Account identifier, name, mask, type | `accounts.*` | F2, #9 |
| Any balance | `account_valuations`, `accounts` | F2, #9 |
| Net worth, in any decomposition | `net_worth_snapshots` | #52 (`netWorth` absent from the alert module) |
| Property address, nickname, tenant-held funds | `properties`, `property_tenant_funds` | #52 |
| A transaction row, id, date or amount | `transactions` | F2, #9, #52 |
| `projectedVariance` (a **signed** figure) | `OutlookCategory` | Q8 — F1 asserts `$665.00` and `$775.00` are absent |
| **Any credential** | `.env.local` | F-M6, #45, #46, #47 |
| **Any figure at all**, when coverage is below threshold | — | Q2, F4 |

**A blank in the outlook is not a licence.** Anything not on the first list is on the second by
default. A future field added to `MonthOutlook` is forbidden until this table names it, and the
structural control for that is #10: the alert module never calls `JSON.stringify`, so no object can
be dumped into a body wholesale — which is the single most plausible way this boundary gets crossed.

## The eight open questions, decided

### Q1 — how a send is gated, when a test that sends is a test that leaks

**Decided: the content is gated exhaustively and the delivery is not gated at all. That is stated
here, repeated verbatim in `EVIDENCE.md`, and the delivery must never be described as "tested".**

This is worse than step 31's renderer problem, and the difference is worth naming. A renderer test
that is skipped leaves a gap. A *delivery* test that is not skipped **leaks**: it sends real
financial figures to a real address, over a real provider, from a machine whose whole standing rule
is that this never happens (`BUILD.md` §5.4). There is no "just once, to check" here. So:

- **Every decision is pure and total.** `planAlert(outlook)` returns a message or `null` and touches
  nothing else. `shouldSend(message, priors)` returns a boolean. `smtpSettings(env)` returns a
  validated configuration or throws. All three take their world as a parameter — no clock (#52), no
  `process.env` (#51), no database (#50), no transport (#49).
- **The shell is the only ungated code, and it is ungated because it decides nothing.** #38 is the
  control that makes that claim checkable: `lib/breachAlert.ts` may not mention `sayingNo`,
  `projectedRatio`, `coveragePercent`, `authoritative` or `projectedVariance` **at all**. Every
  branch on a financial fact is therefore forced into a tested module, and what is left in the
  shell is four I/O calls in a fixed order.
- **`lib/breachAlert.ts` has no test file, deliberately.** Same honesty as step 32's T5. It reads
  the database and would need one to test, `vitest.config.mts` excludes anything needing a database,
  and a fake-transport test of the shell would test the fake.

**What stays unproven, stated so it cannot be quietly assumed:** that nodemailer is invoked with the
settings the config parser produced; that the provider accepts them; that a message arrives; that
TLS is actually negotiated on the wire. The first is proxied by source (#44, #49); the last three
cannot be proven from this repo at all and are the owner's manual evidence (Evidence #4), performed
once, by the owner, on the owner's machine — **not by any agent** (`DECISION.md`).

### Q2 — the coverage interaction: **below the threshold, no figure about a category leaves at all**

**Decided: when `MonthOutlook.authoritative` is `false`, the message names no category, prints no
amount and prints no ratio. It carries the coverage percentage, the count of categories currently
saying no, and a route back to the app. Above the threshold, the full allowlist applies.**

This is the sharpest interaction in the step and `DECISION.md` names it as such. The argument:

1. **A guardrail that emails a figure the dashboard will not stand behind is incoherent.** Step 32
   built `COVERAGE_THRESHOLD` precisely so that a figure computed over a tenth of the month stops
   being presented as a verdict. Emailing "Dining Out is projecting 266% of budget" at 7.7% coverage
   — the owner's real measured August — asserts in the strongest available medium exactly what the
   dashboard has just refused to assert.
2. **An email is read out of context, and a qualifier does not survive that.** The dashboard can
   demote rather than suppress (step 32's Q4) because the refusal banner sits *inside* the hero,
   beside the lists, with the caveat under it. An email is read on a lock screen, at a glance,
   possibly weeks later, with no page around it. A named category and a number in that setting read
   as a verdict no matter what sentence surrounds them. So the demotion that works on a page is
   suppression-of-figures in a message.
3. **The coverage figure itself is not refused by anything.** §5 step 32's exit is that the headline
   "always ships with the share of spend it actually saw" — the caveat renders in every state and in
   *both* authority modes. `coveragePercent` is therefore the one number that is as authoritative at
   7% as at 96%, which is what makes it the right and only payload here.
4. **It is a deliberate narrowing below the owner's grant, which is permitted.** `DECISION.md` sets a
   ceiling on what may leave, not a floor on what must.
5. **It is the more useful message.** At 7.7% the actionable fact is not that Dining Out looks bad;
   it is that the guardrail cannot work until the month is categorized. That is a message the owner
   can act on, and it is the only honest one available.

**A count is allowed; names and figures are not.** `sayingNo.length` is at parity with the dashboard,
which renders the lists in both modes. "Three categories are flagged and I cannot stand behind the
figures" is enough to make the message worth opening and carries no per-category claim.

**Rejected alternative — send nothing below the threshold.** It fails silently in exactly the state
that most needs a signal: on the owner's real data the guardrail would never once have fired, and
its silence would have been indistinguishable from a good month. That is the step-39 failure shape,
manufactured deliberately.

**Rejected alternative — send the figures with a stronger caveat.** See (2). It is the incoherence
`DECISION.md` names, with a sentence attached.

### Q3 — what triggers a send: **the existing daily job, and no new timer**

**Decided: `runAndLog` in `lib/scheduler.ts` gains one call to `runBreachAlert()`. No new
`setTimeout`, no new `setInterval`, no `instrumentation.ts` change, and `runBreachAlert` is exported
so that Phase 2 step 20's OS cron can call it directly.**

`ITEM.md` frames this as a choice between "work for step 20 to undo" and "the two-reducers defect in
a new dimension". The framing is right and the resolution is that they are not symmetric:

- **A second scheduler is unbounded damage.** Two timers, two ideas of "daily", two things step 20
  must find and retire, and — the actual defect — two places that decide *when the guardrail runs*.
  This repo has shipped two duplicated latest-valuation reducers; a duplicated cadence is the same
  failure in the dimension where its symptom is silence.
- **The undo is bounded and named.** Step 20 replaces the *timer*, not the job body. If
  `runBreachAlert` is a plain exported async function with no timer inside it (#33), step 20's work
  is to point cron at it and delete the timer that used to — one line, in a file step 20 is already
  rewriting. That is not work created; it is work already scheduled.
- Phase 5 step 39's *"built on Phase 2 step 20's OS-cron, not on `lib/scheduler.ts`'s in-process
  timer"* is honoured by shape, not by waiting: the entry point step 39 needs already exists and is
  already cron-callable.

**The cost, stated rather than discovered.** The in-process timer only fires while the Next server is
up. Phase 0 step 7 already recorded this happening for real — no `net_worth_snapshots` row exists for
`2026-08-12` because the laptop was closed. **The guardrail will miss days the same way, silently.**
That is a known, recorded limitation of this step, not a defect in it, and it is one of the two
reasons Phase 5 step 39's heartbeat exists. It is repeated in `EVIDENCE.md` (Evidence #6).

**`runBreachAlert` resolves, never rejects.** A failed alert must not cost the daily sync or the net
worth snapshot. The try/catch therefore lives in the shell (#39), never in the pure module (#53).

### Q4 — duplicate suppression: **a fingerprint over names and reasons, and a send log. G1 re-opens.**

**Decided: at most one delivered message per `(kind, as-of month, set of categories, set of reasons)`.
The key is a digest; the memory is a new `alert_sends` table; a *failed* send does not count.**

The rule and each of its edges:

| Situation | Outcome | Why |
|---|---|---|
| Same categories, same reasons, next day | **suppressed** | Not news twice. |
| Same categories, same reasons, **more spend** | **suppressed** | The fingerprint excludes amounts (F11). Including them re-fires daily as spend accrues, which is the noise this rule exists to prevent. |
| A new category joins the set | **sent** | A category crossing the line is news (F13). |
| A category escalates `projected-breach` → `breach` | **sent** | The reason is in the key (F14). |
| The month rolls over | **sent** | The month is in the key (F15). A breach persisting into October is a new month's problem. |
| The previous attempt **failed** | **sent** | Suppression keys on *delivered*, never on *attempted* (F19). A failed send that silences tomorrow's retry is a guardrail that dies quietly on its first network blip. |
| Coverage message and breach message, same month | **both possible** | Different `kind`, different key (F16). |

**Why a table, and why the alternatives lose.**

- *A local file.* §5's carve-out is explicit that a local file is **not** exempt — "the boundary is
  'leaves the process', not 'leaves the machine'". It is also unversioned state outside Phase 2's
  backup story and a second persistence mechanism beside Postgres.
- *Derive it from `sync_log`.* It records syncs. Nothing there knows a message existed.
- *No suppression, send daily.* `ITEM.md`: "Sending daily until the month ends is how a guardrail
  becomes noise that gets filtered." A filtered guardrail is a deleted one.
- *A cool-down of N days.* An unmotivated magic number, and it gets escalations wrong in both
  directions: it suppresses a real second breach on day 3 and re-sends an unchanged one on day 8.
  The fingerprint rule has no tunable constant at all, which is why it is preferred.

**The digest carries no name.** Not paranoia — see "Contracts touched". F17 asserts it matches
`/^[0-9a-f]{16,}$/` and contains none of its inputs, which a naive `names.join('|')` key would fail.

### Q5 — failure is silent by nature, and step 39 arrives one step late

**Decided: every *attempt* is recorded with its outcome, and both paths emit a structured log line.
No heartbeat. The gap is named, not papered over.**

An email that does not send looks exactly like a quiet month. This step cannot fix that — a liveness
signal is a second outbound surface with its own cadence and its own §5.1 question, and Phase 5 step
39 owns it. What it can do, at near-zero cost, is make the *record* unambiguous:

- A row is written for a **failed** attempt too, carrying the error (`delivered = false`). So
  "nothing in `alert_sends` for three weeks" means the job did not run; "three failed rows" means it
  ran and could not reach the provider. Those are different problems and today they would look the
  same.
- The failure is logged through `lib/logger.ts` like every other scheduler failure.
- The recorded failure does **not** suppress the next day's attempt (F19), so a transient outage
  self-heals rather than converting into permanent silence.

**What remains unresolved and is listed as such:** nothing shouts. If the server is down for a month,
`alert_sends` is empty and no one is told. That is step 39's job and this spec does not pretend
otherwise.

### Q6 — why `app/dashboard/page.tsx` is touched at all, and why it is not a dashboard change

The alert needs a `MonthOutlook`. The four functions that produce one — `getBudgetCategories`,
`getMonthlyActuals`, `getCoverageGroups`, `toAdherenceInput` — are **private to
`app/dashboard/page.tsx`** (verified: none is exported). A scheduler cannot import them. That leaves
exactly two options:

1. **Copy the queries into the shell.** This is the drifting-definitions defect (BUILD.md §1) landing
   on the figure the whole phase is about, and it is the specific defect this repo has already
   shipped twice. Two months later the page and the email disagree about one category and nothing
   announces it.
2. **Move them to a shared I/O shell**, `lib/monthOutlookRead.ts`, exporting one
   `loadMonthOutlook(asOf)`, called by the page and by the alert.

(2) is not a novel structure — it is the pattern ROADMAP.md §5 Phase 0 step 7 already records and
names the reason for: *"`lib/domain/netWorth.ts` is the pure composer; `lib/netWorth.ts` the I/O
shell, deliberately shared by the dashboard and the scheduler's `writeNetWorthSnapshot()` so the two
can never drift on what net worth means."* This is that, for the month outlook.

**The move must be a pure relocation**, and it is gated as one:

- The SQL strings move **verbatim**. #56/#57 assert step 32's two pinned fragments left the page and
  arrived in the reader unchanged; #58 asserts each exists in exactly one file in the repo.
- Step 32's N42 control travels with it: no account-landscape predicate in the reader (#59).
- The rendered surface does not move: four `data-testid`s at their counts, the first one still first
  in source order, one clock read, and no net-worth reference (#60–#62, #55). The page's own copy is
  untouched.
- The one permitted rename: the page's two `coverageGroups.length === 0` conditionals read a count
  the reader returns instead. No rendered difference; #61 pins the surrounding testids.

**This is a diff to the dashboard file and not a change to the dashboard.** The orchestrator's stated
non-goal "no dashboard change" is honoured in the sense that matters — nothing a reader sees moves —
and is stated here explicitly rather than resolved silently, because the alternative was the defect.

### Q7 — the month, one-based, and the formatting rules that must agree with the page

**The domain is 0-based everywhere** (`AsOf.month`, `MonthSpend.month`, the `monthly_amounts` index).
The message renders `YYYY-MM`, **1-based**: `asOf = { year: 2026, month: 8 }` renders `2026-09`,
pinned `not.toContain('2026-08')` (F8). The conversion happens once, in the renderer. There is no
month-name table: a second copy of `MONTHS` beside the page's is a drifting-definitions hazard for
zero benefit, and `2026-09` is unambiguous in a subject line.

**Percentages use the same rule the dashboard uses — `Math.round(fraction * 100)` — not step 32's
floor.** The two rules disagree on a `.5` boundary (`4.875` → `488` rounded, `487` floored), and a
disagreement between the email and the page about one category by a percentage point is precisely
this repo's signature defect. Step 32's floor governs `coveragePercent`, where rounding **up**
overstates confidence and is dangerous; it is computed once in `monthOutlook.ts` and this module
prints it verbatim, never recomputing it (#54). For a category ratio, matching the page is the rule
that matters, and changing the page's rule is out of scope. F9 pins `4.875 → 488%` with
`not.toContain('487')` specifically so the divergence is a decision on the record and not an accident.
`Math.round` may therefore appear **at most once** in the alert module (#47) and never on money.

**Currency uses `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD',
minimumFractionDigits: 2 })` — the page's helper, with the locale pinned explicitly.** `$1,065.00`,
not `$1065.00`. The explicit `'en-US'` is what makes it safe in a cron process whose environment
locale is not the browser's.

**Accepted cost, recorded rather than hidden:** these two helpers now exist in two files. A *third*
copy would be the defect; extracting them to a shared formatter is a `NITS.md` follow-up on the
formatting surface, not this step's business. Cross-surface agreement is pinned by fixture, not by
promise (F9, F10).

### Q8 — `projectedVariance` is not rendered, deliberately

`pacing.ts` states the convention loudly: *"NEGATIVE IS UNDER BUDGET, positive is over ... Reversing
the subtraction still produces a plausible dollar figure, and the only symptom is that thrift reads
as overspending."* The message has no need of it — `projected` against `budgeted` and the ratio carry
the same information with no sign convention to invert — so it is **excluded from the allowlist**,
and F1 asserts `$665.00` and `$775.00` (the two fixtures' variances) are absent from the body. That
is the negative control for an implementer who reaches for the field and inverts it.

## Conventions this task must honor

- **Sign.** Every money field the message renders arrives off `OutlookCategory` as a
  **positive-is-money-out magnitude** (`budgeted`, `actual`, `projected`) — the ledger's Plaid
  convention, unchanged. The one signed field in scope, `projectedVariance`, is **not rendered at
  all** (Q8). The message therefore contains no minus sign in front of a dollar figure, in any
  fixture, and a body that does is wrong by construction.
- **Rounding.** Money is **not rounded by this step**. It is *formatted* once, at the message
  boundary, from values copied by reference off `OutlookCategory` — never re-derived from `budgeted`
  and `actual`, never divided by `elapsedFraction`, never re-projected (#48, #49). Ratios are
  rendered `Math.round(fraction * 100)` to match the page (Q7). `coveragePercent` arrives already
  floored from `monthOutlook.ts` and is printed verbatim; the alert never multiplies `coverageShare`
  (#54).
- **Landscape + exclusions.** **None apply here, and re-expressing any of them is a defect.**
  `isScoredCategory`'s four conjuncts have already been applied one level down: `sayingNo` contains
  only scored records in the as-of month. The alert module must contain no reference to
  `isScoredCategory`, `control_mode`, `exclude_from_budget`, `is_income` or `landscape` (#46) — the
  drifting-definitions hazard landing on the one predicate P0.5-28 exists to have a single definition
  of.
- **Null semantics.** This app shows "—" rather than a wrong zero, and a message has no "—":
  - `coverageShare === null` (an empty population — no spend recorded yet) → **no message at all**
    (F7). Never a message reading `0%`, `100%`, `null%` or `NaN%`.
  - `projected` / `projectedRatio` / `spentRatio` are `null` for an off-cycle record. Such a line
    names the category and its spend and **omits the projection entirely** (F21). It never prints
    `null`, `NaN`, `undefined`, `Infinity`, or a comparison against a `$0.00` budget.
  - A non-finite figure reaching the renderer is a `RangeError`, not a printed `NaN` (F22). The
    module contains no try/catch (#53), so nothing can swallow it.
- **Window and clock.** The pure module reads **no clock** (#52). The shell performs exactly one
  clock read, through `asOfFromDate`, and passes the three integers down — the same discipline the
  dashboard already follows and for the same reason (`monthOutlook.ts`'s `asOfFromDate` docblock).
- **Secrets.** Every new key joins `.env.local` — gitignored (`.env*`), gitleaks-gated on every
  commit by `.husky/pre-commit`, never committed (§0). The key **names** are documented in
  `.env.local.example`, with empty values (#25–#28). No credential value appears in source (#45), in
  a rendered message (F2), or in a thrown error (F-M6).
- **TLS is mandatory.** Port 465 (implicit TLS) or port 587 with STARTTLS required. Any other port,
  or a configuration that disables certificate verification, is a **stated failure** — the parser
  throws and nothing is constructed (F-M3, F-M4).

## Toolchain prerequisites

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `vitest` runs `lib/**/*.test.ts` in `environment: 'node'`, no DB, no network | **yes** | already configured (`vitest.config.mts`) | `npm test 2>&1 \| tail -4` | `Test Files 21 passed (21)` / `Tests 415 passed (415)` on the clean tree |
| T2 | `typescript` resolves the repo's `@/` paths | **yes** | `tsconfig.json`, present | `npx tsc --noEmit; echo "exit=$?"` | `exit=0` |
| T3 | `git` with `HEAD` at the merged step-32 commit, for the scope commands | **yes** | working tree | `git rev-parse --short HEAD` | `64cb0d6` |
| T4 | `node` for the arithmetic checks in Evidence | **yes** | installed | `node -e "console.log(Math.round(4.875*100))"` | `488` |
| T5 | `gitleaks` on `PATH` | **yes** | installed | `command -v gitleaks && gitleaks protect --no-banner --redact 2>&1 \| tail -1` | `/opt/homebrew/bin/gitleaks`, `no leaks found` |
| T6 | a throwaway Postgres for the migration's up/down/up | **yes, at G1 only** | `docker compose up db` or a local instance | `npm run migrate:up && npm run migrate:down && npm run migrate:up` against the throwaway URL | filled in at G1 — **no acceptance command below needs a database** |
| T7 | `.env.local.example` exists and is untracked (matched by `.env*`) | **yes** | present in the working tree | `test -f .env.local.example && git ls-files --error-unmatch .env.local.example 2>/dev/null; echo "tracked=$?"` | file present, `tracked=1` (untracked, so it cannot appear in a scope command) |
| T8 | a component-render harness (jsdom, RTL, Playwright) | **NO** | not obtained, not needed | n/a — no acceptance command renders a component | Q6's limitation |
| T9 | **an SMTP server, real or fake, at any address** | **NO — and this is the point** | not obtained, must not be | n/a — **no acceptance command opens a socket or constructs a transport** (#41, #42) | Q1 states the resulting limitation |
| T10 | network access of any kind during the suite | **NO** | n/a | n/a | the suite is pure functions, as `vitest.config.mts` says out loud |
| T11 | `nodemailer` + `@types/nodemailer` installed, `package-lock.json` updated | **yes** | `npm install nodemailer && npm install -D @types/nodemailer` | `test $(grep -c '"nodemailer"' package.json) -ge 1 && echo OK` | `0` today — the implementer installs it |

## Acceptance commands

`⟨A⟩` abbreviates `npx vitest run --pool=threads --reporter=verbose lib/domain/breachAlert.test.ts 2>&1`.
`⟨M⟩` abbreviates `npx vitest run --pool=threads --reporter=verbose lib/mailConfig.test.ts 2>&1`.
All commands run from the repo root.

> **Pipe-escaping convention, repeated because it has cost this queue a G0 failure twice.** Inside a
> Markdown table cell `\|` renders as one literal `|`, which inside an ERE is a **literal pipe, not
> alternation**. Every regex-bearing command is repeated verbatim and unescaped in the code block
> below the table, and **that block is authoritative** if the two disagree.
>
> **Quoting, because this shell is zsh.** `--include=*.ts` unquoted fails with
> `no matches found`. Every `--include` below is quoted: `--include='*.ts'`. Copy from the code block.
>
> **A4's lesson, applied.** No command below pins an exact count for "this symbol appears"; presence
> is `-ge 1` and absence is `0`. Where an exact or upper-bound count is pinned it is pinned to a value
> **measured on the clean tree** and named in the Expected column, and it asserts a **removal**, a
> **byte-identity** or a **ceiling**, never a code shape. If a correct implementation cannot satisfy a
> counter here, **escalate it at G2 the way A3 and A4 were escalated** — report it, do not reshape the
> code to satisfy the counter, and do not edit this file.
>
> **No command in this table sends anything.** #41–#43 are the affirmative controls for that claim.

### Baseline

| # | Command | Expected |
|---|---|---|
| 1 | `npx tsc --noEmit; echo "exit=$?"` | `exit=0` (T2) |
| 2 | `npm test 2>&1 \| grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"` | `1` — whole repo green, nothing skipped |
| 3 | `npm run lint 2>&1 \| tail -2` | `✖ 1 problem (0 errors, 1 warning)` — the pre-existing `scripts/seed-demo.mjs:438` warning and no other |
| 4 | `npm run build > /tmp/p33-build.log 2>&1; echo "exit=$?"` | `exit=0` — the shell reaches the server bundle through `instrumentation.ts` → `lib/scheduler.ts`; a transport import that breaks the build fails here |
| 5 | `test $(⟨A⟩ \| grep -cE "✓ lib/domain/breachAlert\.test\.ts") -ge 22 && echo OK` | `OK` — the 22 named below. File does not exist today |
| 6 | `test $(⟨M⟩ \| grep -cE "✓ lib/mailConfig\.test\.ts") -ge 9 && echo OK` | `OK` — the 9 named below. File does not exist today |

### The message: content, allowlist, and the coverage refusal

| # | Command | Expected |
|---|---|---|
| 7 | `⟨A⟩ \| grep -cF "two categories saying no under authoritative coverage produce one message naming both, their spend against their budgets and their projected share of the month"` | `1` — F1 |
| 8 | `⟨A⟩ \| grep -cF "the subject line carries the count and the month and never a dollar amount, because a subject is what a lock screen shows"` | `1` — F3 |
| 9 | `⟨A⟩ \| grep -cF "the message renders only the allowlisted fields, so a category record carrying a merchant, an account id and a balance leaks none of the three"` | `1` — **the allowlist's live control**, F2 |
| 10 | `grep -c 'JSON.stringify' lib/domain/breachAlert.ts` | `0` — **the allowlist's static control**: no object can be dumped into a body wholesale |
| 11 | `⟨A⟩ \| grep -cF "coverage below the threshold withdraws the figures as well as the confidence: the message names no category, no amount and no ratio"` | `1` — **Q2**, F4 |
| 12 | `⟨A⟩ \| grep -cF "a month with nothing scored produces no message at all, because there is no guardrail to report the state of"` | `1` — F5, and it pins the ladder's first rung above the second |
| 13 | `⟨A⟩ \| grep -cF "a month where every scored category is holding produces no message, and that silence is what step 39's heartbeat exists to break"` | `1` — F6 |
| 14 | `⟨A⟩ \| grep -cF "a month with no spend at all produces no message rather than one reporting zero percent or a hundred"` | `1` — **null semantics**, F7 |
| 15 | `⟨A⟩ \| grep -cF "the as-of month is rendered one-based against the domain's zero-based index, so September is 2026-09 and never 2026-08"` | `1` — **Q7**, F8 |
| 16 | `⟨A⟩ \| grep -cF "a category's share of budget is rendered by the same rule the dashboard uses, so the email and the page cannot disagree by a percentage point"` | `1` — **Q7**, F9 |
| 17 | `⟨A⟩ \| grep -cF "money is formatted once at the message boundary and never re-derived from the budget and the actual"` | `1` — F10 |
| 18 | `⟨A⟩ \| grep -cF "an off-cycle category has no projection to report, so its line names the spend and omits the comparison rather than printing null"` | `1` — F21 |
| 19 | `⟨A⟩ \| grep -cF "a non-finite figure reaching the renderer is rejected rather than printed as NaN"` | `1` — F22 |

### The fingerprint and duplicate suppression

| # | Command | Expected |
|---|---|---|
| 20 | `⟨A⟩ \| grep -cF "the fingerprint is an opaque digest carrying no category name"` | `1` — F17 |
| 21 | `⟨A⟩ \| grep -cF "the fingerprint does not move when the month's spend does, because the same categories for the same reasons are not news twice"` | `1` — **Q4's central rule**, F11 |
| 22 | `⟨A⟩ \| grep -cF "the fingerprint does not depend on the order the categories arrive in"` | `1` — F12 |
| 23 | `⟨A⟩ \| grep -cF "a category joining the set changes the fingerprint, and a category escalating from projecting over to already over changes it too"` | `1` — F13, F14 |
| 24 | `⟨A⟩ \| grep -cF "the fingerprint changes when the month does, so a breach persisting into the next month is reported again"` | `1` — F15 |
| 25 | `⟨A⟩ \| grep -cF "the coverage message and the breach message never share a fingerprint for the same month"` | `1` — F16 |
| 26 | `⟨A⟩ \| grep -cF "a message whose fingerprint was already delivered is suppressed"` | `1` — F18 |
| 27 | `⟨A⟩ \| grep -cF "a message whose fingerprint was recorded as undelivered is sent again, because a failed send must never silence the retry"` | `1` — **Q5**, F19 |
| 28 | `⟨A⟩ \| grep -cF "a message whose fingerprint has never been recorded is sent"` | `1` — F20 |

### Mail configuration: TLS, credentials, and the enable flag

| # | Command | Expected |
|---|---|---|
| 29 | `⟨M⟩ \| grep -cF "port 465 is accepted as implicit TLS"` | `1` — F-M1 |
| 30 | `⟨M⟩ \| grep -cF "port 587 is accepted only with STARTTLS required"` | `1` — F-M2 |
| 31 | `⟨M⟩ \| grep -cF "port 25 is rejected, because plaintext SMTP would put these figures on the wire in clear"` | `1` — **TLS is mandatory**, F-M3 |
| 32 | `⟨M⟩ \| grep -cF "a configuration disabling certificate verification is rejected, since an unverified peer is plaintext with extra steps"` | `1` — F-M4 |
| 33 | `⟨M⟩ \| grep -cF "a missing credential names the key that is missing and never substitutes a default"` | `1` — F-M5 |
| 34 | `⟨M⟩ \| grep -cF "a rejection message never contains the password it was handed"` | `1` — **the credential-leak control**, F-M6 |
| 35 | `⟨M⟩ \| grep -cF "sending is disabled unless the enable flag is exactly the string true, so an unset, mistyped or merely truthy value all mean off"` | `1` — F-M7 |
| 36 | `⟨M⟩ \| grep -cF "the loggable description of a mail configuration carries the host and the port and never the password"` | `1` — F-M8 |
| 37 | `⟨M⟩ \| grep -cF "a recipient that is not an address is rejected rather than handed to the transport"` | `1` — F-M9 |

### The trigger, and the absence of a second scheduler

| # | Command | Expected |
|---|---|---|
| 38 | `grep -cE 'sayingNo\|projectedRatio\|coveragePercent\|authoritative\|projectedVariance' lib/breachAlert.ts` | `0` — **the shell decides nothing.** Every branch on a financial fact is forced into a tested module. This is the command that makes Q1's claim checkable |
| 39 | `test $(grep -cE 'try *\{' lib/breachAlert.ts) -ge 1 && echo OK` | `OK` — the alert cannot cost the daily sync (Q3) |
| 40 | `test $(grep -cE '^export async function runBreachAlert' lib/breachAlert.ts) -ge 1 && echo OK` | `OK` — one exported entry point, callable by cron at Phase 2 step 20 |
| 41 | `grep -rlE 'createTransport\|sendMail' lib app --include='*.ts' --include='*.tsx' \| wc -l \| tr -d ' '` | `1` — the transport exists in exactly one file. `0` today |
| 42 | `grep -rlE 'createTransport\|sendMail\|nodemailer' lib --include='*.test.ts' \| wc -l \| tr -d ' '` | `0` — **no test constructs a transport. This is the command that says no acceptance command sends anything** |
| 43 | `grep -rl '\.env\.local' lib app --include='*.test.ts' \| wc -l \| tr -d ' '` | `0` — no test reads the real credentials |
| 44 | `grep -rl 'createTransport' lib --include='*.ts'` | `lib/breachAlert.ts` — and nothing else. A second destination would show up here |
| 45 | `grep -rnE "SMTP_(PASSWORD\|USER)['\"]?[[:space:]]*=[[:space:]]*['\"][^'\"]+" lib app --include='*.ts' --include='*.tsx' \| wc -l \| tr -d ' '` | `0` — **no credential value assigned in source.** `0` today |
| 46 | `grep -cE 'isScoredCategory\|control_mode\|exclude_from_budget\|is_income\|landscape' lib/domain/breachAlert.ts` | `0` — the membership test is not re-expressed |
| 47 | `test $(grep -c 'Math\.round' lib/domain/breachAlert.ts) -le 1 && echo OK` | `OK` — **a ceiling, not a shape**: the one permitted use is ratio→percent (Q7). Money is never rounded |
| 48 | `grep -cE 'elapsedFraction\|/ *elapsed' lib/domain/breachAlert.ts` | `0` — the projection is never re-derived |
| 49 | `grep -cE 'nodemailer\|createTransport\|sendMail' lib/domain/breachAlert.ts` | `0` — the pure module holds no transport |
| 50 | `grep -cE "from '\.\./db'\|from 'pg'\|from '@/lib/db'" lib/domain/breachAlert.ts` | `0` — no database |
| 51 | `grep -c 'process.env' lib/domain/breachAlert.ts` | `0` — the environment is a parameter, never read. This is what makes the config rules testable |
| 52 | `grep -cE 'new Date\(\|Date\.now\(\|netWorth\|merchant\|account_id\|balance' lib/domain/breachAlert.ts` | `0` — no clock, and none of the forbidden vocabulary |
| 53 | `grep -cE 'try *\{\|catch *\(' lib/domain/breachAlert.ts` | `0` — [[N34]]: the `RangeError` is never swallowed |
| 54 | `grep -cE 'coverageShare *\*' lib/domain/breachAlert.ts` | `0` — `coveragePercent` is printed verbatim, never recomputed from the share |
| 55 | `grep -cE 'setInterval\|setTimeout' lib/breachAlert.ts` | `0` — **no second scheduler** |
| 55a | `grep -rlE 'setInterval\(\|setTimeout\(' lib --include='*.ts' \| grep -vE '^lib/(scheduler\|sync)\.ts$' \| wc -l \| tr -d ' '` | `0` — no timer anywhere new. `0` today (`lib/scheduler.ts` and `lib/sync.ts`'s 8-second retry sleep are the two incumbents) |
| 55b | `grep -cE 'setInterval\|setTimeout' lib/scheduler.ts` | `2` — the incumbent timer is unchanged. `2` today |
| 55c | `git diff --name-only HEAD -- instrumentation.ts \| wc -l \| tr -d ' '` | `0` — no new registration |
| 55d | `test $(grep -c 'runBreachAlert' lib/scheduler.ts) -ge 1 && echo OK` | `OK` — the existing daily job invokes it. `0` today |
| 55e | `test $(grep -c '"nodemailer"' package.json) -ge 1 && echo OK` | `OK` — T11. `0` today |

### The extraction: the dashboard's rendered surface does not move

| # | Command | Expected |
|---|---|---|
| 56 | `grep -cF 'EXTRACT(MONTH FROM t.date)::int - 1' app/dashboard/page.tsx` | `0` — the actuals query left the page. `1` today |
| 56a | `grep -cF 'EXTRACT(MONTH FROM t.date)::int - 1' lib/monthOutlookRead.ts` | `1` — and arrived unchanged, keeping its 0-based normalisation |
| 57 | `grep -cF "COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::text AS actual" app/dashboard/page.tsx` | `0` — `1` today |
| 57a | `grep -cF "COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::text AS actual" lib/monthOutlookRead.ts` | `1` — the predicate set is byte-identical after the move |
| 58 | `grep -rl 'EXTRACT(MONTH FROM t.date)::int - 1' lib app --include='*.ts' --include='*.tsx' \| wc -l \| tr -d ' '` | `1` — **exactly one definition in the repo.** `1` today; a copy-into-the-shell implementation makes it `2` |
| 59 | `grep -cE "a\.landscape = 'operational'" lib/monthOutlookRead.ts` | `0` — step 32's [[N42]] control travels with the query |
| 60 | `test $(grep -c 'loadMonthOutlook' app/dashboard/page.tsx) -ge 1 -a $(grep -c 'loadMonthOutlook' lib/breachAlert.ts) -ge 1 && echo OK` | `OK` — one reader, two callers. `0` and no such file today |
| 61 | `for t in month-outlook-hero coverage-caveat coverage-refusal categories-saying-no; do grep -c "data-testid=\"$t\"" app/dashboard/page.tsx; done` | `1` four times — **same before and after**; the rendered surface is unmoved |
| 62 | `grep -o 'data-testid="[^"]*"' app/dashboard/page.tsx \| head -1` | `data-testid="month-outlook-hero"` — step 31's source-order proxy survives |
| 62a | `grep -oE 'new Date\(' app/dashboard/page.tsx \| wc -l \| tr -d ' '` | `1` — the page's one clock read survives the move |
| 62b | `grep -ciE 'netWorth\|net_worth\|Net Worth' app/dashboard/page.tsx` | `0` — step 31's exit criterion is not regressed |

### Tripwires, contract, secrets, and scope

| # | Command | Expected |
|---|---|---|
| 63 | `test $(npx vitest run --pool=threads --reporter=verbose lib/domain/adherence.test.ts 2>&1 \| grep -cE "✓ lib/domain/adherence\.test\.ts") -eq 47 && echo OK` | `OK` — exactly |
| 64 | `test $(npx vitest run --pool=threads --reporter=verbose lib/domain/pacing.test.ts 2>&1 \| grep -cE "✓ lib/domain/pacing\.test\.ts") -eq 24 && echo OK` | `OK` |
| 65 | `test $(npx vitest run --pool=threads --reporter=verbose lib/domain/monthOutlook.test.ts 2>&1 \| grep -cE "✓ lib/domain/monthOutlook\.test\.ts") -eq 40 && echo OK` | `OK` |
| 66 | `git diff --stat HEAD -- lib/domain/adherence.ts lib/domain/pacing.ts lib/domain/monthOutlook.ts lib/domain/adherence.test.ts lib/domain/pacing.test.ts lib/domain/monthOutlook.test.ts \| wc -l \| tr -d ' '` | `0` — the four read-only inputs are byte-identical |
| 67 | `git diff --name-only HEAD -- migrations/ db/schema.sql \| wc -l \| tr -d ' '` | `2` — exactly the migration and the schema dump. G1's surface |
| 67a | `test $(grep -c 'alert_sends' db/schema.sql) -ge 1 && echo OK` | `OK` — the dump reflects the migration |
| 68 | `git diff --name-only HEAD -- shared/ \| wc -l \| tr -d ' '` | `0` — no shared-contract change |
| 69 | `git diff --name-only HEAD -- components/ app/api/ app/budget/ scripts/ docs/ vitest.config.mts lib/plaid.ts lib/sync.ts lib/domain/ \| wc -l \| tr -d ' '` | `0` — no UI, no route, no seed, no toolchain, no Plaid, and **no edit to any existing domain module** |
| 70 | `ls migrations/*_alert-sends.sql \| wc -l \| tr -d ' '` | `1` — one migration, with the slug this spec names |
| 71 | `grep -ciE '\b(numeric\|money\|amount\|merchant\|balance\|category)\b' migrations/*_alert-sends.sql` | `0` — **the send log holds no financial data** (see Contracts touched). The migration is a handful of lines; its comments must avoid the vocabulary too, which is the point — a comment mentioning an amount is a column somebody nearly added |
| 72 | `test $(grep -cE '^SMTP_(HOST\|PORT\|USER\|PASSWORD)=' .env.local.example) -eq 4 && echo OK` | `OK` — the four SMTP keys are documented. `0` today (T7) |
| 73 | `test $(grep -cE '^(ALERT_EMAIL_TO\|ALERT_EMAIL_FROM\|ALERTS_ENABLED)=' .env.local.example) -eq 3 && echo OK` | `OK` — the three alert keys are documented |
| 74 | `grep -cE '^SMTP_PASSWORD=$' .env.local.example` | `1` — **the example carries the key and no value** |
| 75 | `grep -cE '^ALERTS_ENABLED=$' .env.local.example` | `1` — **default off**: the checked-out example cannot send |
| 76 | `git ls-files \| grep -cE '^\.env' \| tr -d ' '` | `0` — no `.env*` file is tracked, before or after |
| 77 | `gitleaks protect --no-banner --redact 2>&1 \| tail -1` | `no leaks found` — the working tree, T5. Also the live pre-commit gate |
| 78 | `git diff --name-only HEAD \| grep -vE '^(lib/breachAlert\.ts\|lib/mailConfig\.ts\|lib/monthOutlookRead\.ts\|lib/scheduler\.ts\|app/dashboard/page\.tsx\|db/schema\.sql\|migrations/[0-9]+_alert-sends\.sql\|package\.json\|package-lock\.json\|AGENTS\.md\|plan/)' \| wc -l \| tr -d ' '` | `0` — **the scope command for tracked files** |
| 79 | `git status --porcelain \| grep -vE '^.. (lib/domain/breachAlert(\.test)?\.ts\|lib/breachAlert\.ts\|lib/mailConfig(\.test)?\.ts\|lib/monthOutlookRead\.ts\|lib/scheduler\.ts\|app/dashboard/page\.tsx\|db/schema\.sql\|migrations/[0-9]+_alert-sends\.sql\|package\.json\|package-lock\.json\|AGENTS\.md\|plan/)' \| wc -l \| tr -d ' '` | `0` — **the scope command including untracked files.** `.env.local.example` is gitignored and does not appear here; the orchestrator inspects it by hand at G2 |

**The regex- and pipe-bearing commands, verbatim and authoritative** (copy from here, not from the tables):

```sh
# 2 — whole repo green, nothing skipped.  Expect: 1
npm test 2>&1 | grep -cE "Tests +[0-9]+ passed \([0-9]+\)$"

# 5 / 6 — the new suites.  Expect: OK, OK
test $(npx vitest run --pool=threads --reporter=verbose lib/domain/breachAlert.test.ts 2>&1 | grep -cE "✓ lib/domain/breachAlert\.test\.ts") -ge 22 && echo OK
test $(npx vitest run --pool=threads --reporter=verbose lib/mailConfig.test.ts 2>&1 | grep -cE "✓ lib/mailConfig\.test\.ts") -ge 9 && echo OK

# 38 — the shell decides nothing.  Expect: 0
grep -cE 'sayingNo|projectedRatio|coveragePercent|authoritative|projectedVariance' lib/breachAlert.ts

# 41 — the transport lives in exactly one file.  Expect: 1  (0 today)
grep -rlE 'createTransport|sendMail' lib app --include='*.ts' --include='*.tsx' | wc -l | tr -d ' '

# 42 — NO TEST CONSTRUCTS A TRANSPORT.  Expect: 0
grep -rlE 'createTransport|sendMail|nodemailer' lib --include='*.test.ts' | wc -l | tr -d ' '

# 43 — no test reads the real credentials.  Expect: 0
grep -rl '\.env\.local' lib app --include='*.test.ts' | wc -l | tr -d ' '

# 45 — no credential value assigned in source.  Expect: 0
grep -rnE "SMTP_(PASSWORD|USER)['\"]?[[:space:]]*=[[:space:]]*['\"][^'\"]+" lib app --include='*.ts' --include='*.tsx' | wc -l | tr -d ' '

# 46 — the membership test is not re-expressed.  Expect: 0
grep -cE 'isScoredCategory|control_mode|exclude_from_budget|is_income|landscape' lib/domain/breachAlert.ts

# 47 — Math.round at most once, and never on money.  Expect: OK
test $(grep -c 'Math\.round' lib/domain/breachAlert.ts) -le 1 && echo OK

# 48 — the projection is never re-derived.  Expect: 0
grep -cE 'elapsedFraction|/ *elapsed' lib/domain/breachAlert.ts

# 49 / 50 / 51 — the pure module holds no transport, no database, no environment.  Expect: 0, 0, 0
grep -cE 'nodemailer|createTransport|sendMail' lib/domain/breachAlert.ts
grep -cE "from '\.\./db'|from 'pg'|from '@/lib/db'" lib/domain/breachAlert.ts
grep -c 'process.env' lib/domain/breachAlert.ts

# 52 — no clock, and none of the forbidden vocabulary.  Expect: 0
grep -cE 'new Date\(|Date\.now\(|netWorth|merchant|account_id|balance' lib/domain/breachAlert.ts

# 53 — the RangeError is never swallowed.  Expect: 0
grep -cE 'try *\{|catch *\(' lib/domain/breachAlert.ts

# 54 — coveragePercent is printed, never recomputed.  Expect: 0
grep -cE 'coverageShare *\*' lib/domain/breachAlert.ts

# 55 / 55a / 55b — no second scheduler.  Expect: 0, 0, 2
grep -cE 'setInterval|setTimeout' lib/breachAlert.ts
grep -rlE 'setInterval\(|setTimeout\(' lib --include='*.ts' | grep -vE '^lib/(scheduler|sync)\.ts$' | wc -l | tr -d ' '
grep -cE 'setInterval|setTimeout' lib/scheduler.ts

# 58 — the actuals SQL exists in exactly one file.  Expect: 1
grep -rl 'EXTRACT(MONTH FROM t.date)::int - 1' lib app --include='*.ts' --include='*.tsx' | wc -l | tr -d ' '

# 61 — the four rendered regions survive the extraction.  Expect: 1 1 1 1
for t in month-outlook-hero coverage-caveat coverage-refusal categories-saying-no; do grep -c "data-testid=\"$t\"" app/dashboard/page.tsx; done

# 62a / 62b — one clock read, no net worth.  Expect: 1, 0
grep -oE 'new Date\(' app/dashboard/page.tsx | wc -l | tr -d ' '
grep -ciE 'netWorth|net_worth|Net Worth' app/dashboard/page.tsx

# 60 — one reader, two callers.  Expect: OK
test $(grep -c 'loadMonthOutlook' app/dashboard/page.tsx) -ge 1 -a $(grep -c 'loadMonthOutlook' lib/breachAlert.ts) -ge 1 && echo OK

# 71 — the send log holds no financial data.  Expect: 0
grep -ciE '\b(numeric|money|amount|merchant|balance|category)\b' migrations/*_alert-sends.sql

# 72 / 73 — the seven new keys are documented with no values.  Expect: OK, OK
test $(grep -cE '^SMTP_(HOST|PORT|USER|PASSWORD)=' .env.local.example) -eq 4 && echo OK
test $(grep -cE '^(ALERT_EMAIL_TO|ALERT_EMAIL_FROM|ALERTS_ENABLED)=' .env.local.example) -eq 3 && echo OK

# 76 — no .env file is tracked.  Expect: 0
git ls-files | grep -cE '^\.env' | tr -d ' '

# 78 — scope, tracked files.  Expect: 0
git diff --name-only HEAD | grep -vE '^(lib/breachAlert\.ts|lib/mailConfig\.ts|lib/monthOutlookRead\.ts|lib/scheduler\.ts|app/dashboard/page\.tsx|db/schema\.sql|migrations/[0-9]+_alert-sends\.sql|package\.json|package-lock\.json|AGENTS\.md|plan/)' | wc -l | tr -d ' '

# 79 — scope, including untracked.  Expect: 0
git status --porcelain | grep -vE '^.. (lib/domain/breachAlert(\.test)?\.ts|lib/breachAlert\.ts|lib/mailConfig(\.test)?\.ts|lib/monthOutlookRead\.ts|lib/scheduler\.ts|app/dashboard/page\.tsx|db/schema\.sql|migrations/[0-9]+_alert-sends\.sql|package\.json|package-lock\.json|AGENTS\.md|plan/)' | wc -l | tr -d ' '
```

### The message-selection ladder, stated as a total function

`planAlert(outlook)` is total, closed at five rungs, and evaluated top down. Every fixture below
names the rung it pins.

| Rung | Condition | Result | Why here |
|---|---|---|---|
| 1 | `state === 'nothing-to-score'` | `null` | Nothing is configured to guard. The problem is scoring, not categorization, and a coverage message would name the wrong cause. Above rung 3 deliberately (F5) |
| 2 | `coverage.coverageShare === null` | `null` | An empty population — the month has produced no spend yet. Never a message reading `0%`, `100%` or `null%` (F7) |
| 3 | `authoritative === false` | **coverage message** | Q2. Carries `coveragePercent`, `sayingNo.length` and a route back. No name, no amount, no ratio (F4) |
| 4 | `sayingNo.length > 0` | **breach message** | The full allowlist (F1) |
| 5 | otherwise | `null` | A quiet month. Its cost is Q5's, and it is stated, not hidden (F6) |

### The twenty-two `breachAlert` fixtures, with literal expected values

Every figure was verified by execution (`node -e`) at spec time, per GATES A3. **The base outlook,
`O`**, used by F1–F4 and F8–F17, is: `asOf = { year: 2026, month: 8, day: 8 }` (September, 0-based),
`state: 'projected-breach'`, `scoredCategoryCount: 9`, `holding: []`, `withheld: []`,
`offCycleElsewhere: []`, `coverage.coverageShare: 0.96`, `coveragePercent: 96`,
`authoritative: true`, and `sayingNo`:

| | `category` | `reason` | `budgeted` | `actual` | `spentRatio` | `projected` | `projectedVariance` | `projectedRatio` | `elapsedDays` | `daysInMonth` |
|---|---|---|---|---|---|---|---|---|---|---|
| **D** | `Dining Out` | `projected-breach` | 400 | 284 | 0.71 | 1065 | 665 | 2.6625 | 8 | 30 |
| **T** | `Travel` | `breach` | 200 | 260 | 1.3 | 975 | 775 | 4.875 | 8 | 30 |

*Verified:* `284/400 = 0.71`; `284 × 30/8 = 1065`; `1065 − 400 = 665`; `1065/400 = 2.6625`;
`260 × 30/8 = 975`; `975 − 200 = 775`; `975/200 = 4.875`. Rendering: `Math.round(0.71×100) = 71`,
`Math.round(1.3×100) = 130`, `Math.round(2.6625×100) = 266`, `Math.round(4.875×100) = 488`
(**not 487** — the floor); `Intl.NumberFormat('en-US', …).format(1065) = "$1,065.00"`.

| Fixture | Input | Expected | Pinned `not.` |
|---|---|---|---|
| **F1** (#7) | `O` | `kind: 'projected-breach'`. Body contains **`Dining Out`**, **`$284.00`**, **`$400.00`**, **`$1,065.00`**, **`71%`**, **`266%`**, **`day 8 of 30`**, **`Travel`**, **`$260.00`**, **`$200.00`**, **`$975.00`**, **`130%`**, **`488%`**, **`96%`**, **`open the app`** | body `not.toContain('$665.00')` and `not.toContain('$775.00')` — **Q8**, the signed field; `not.toContain('487%')` — the floor; `not.toContain('NaN')`, `not.toContain('null')`, `not.toContain('undefined')`, `not.toContain('Infinity')`; `not.toContain("of this month's spend")` — step 32's [[N52]] noun, not repeated on a new surface |
| **F2** (#9) | `O`, with each `sayingNo` record additionally carrying `merchantName: 'CHIPOTLE 0421'`, `accountId: 'acct_9f3a2b'`, `balance: 250000`, `transactionId: 'txn_77'` (structurally assignable; the renderer must ignore them) | Body still contains `Dining Out` and `$284.00`; body **and subject** contain **none of** `CHIPOTLE`, `0421`, `acct_9f3a2b`, `250000`, `txn_77` | **the allowlist's live control.** A `JSON.stringify(category)` renderer fails every one of the five |
| **F3** (#8) | `O`'s subject | Contains **`2026-09`** and **`2`** | subject `not.toContain('$')`, `not.toContain('266')`, `not.toContain('284')`, `not.toContain('Dining Out')`, `not.toContain('Travel')` — **a lock screen shows the subject** |
| **F4** (#11) | `O` with `coverageShare: 0.077`, `coveragePercent: 7`, `authoritative: false` | `kind: 'coverage'`. Body contains **`7%`**, **`2`**, **`open the app`** | body and subject `not.toContain('Dining Out')`, `not.toContain('Travel')`, `not.toContain('$284.00')`, `not.toContain('$400.00')`, `not.toContain('266')`, `not.toContain('488')`, `not.toContain('$')` — **Q2: no figure about a category leaves** |
| **F5** (#12) | `O` with `state: 'nothing-to-score'`, `scoredCategoryCount: 0`, `sayingNo: []`, `authoritative: false`, `coveragePercent: 7` | `null` | `not.toBe` a `'coverage'` message — rung 1 beats rung 3 |
| **F6** (#13) | `O` with `state: 'on-track'`, `sayingNo: []`, `coveragePercent: 99`, `authoritative: true` | `null` | — (rung 5) |
| **F7** (#14) | `O` with `coverageShare: null`, `coveragePercent: null`, `authoritative: false`, `sayingNo: []` | `null` | `not.toBe` any message. **Rung 2** |
| **F7a** (#14) | F7 but `sayingNo` = `[D, T]` | `null` | rung 2 beats rungs 3 and 4 — an empty population cannot produce a share to caveat with |
| **F8** (#15) | `O` | Subject and body contain **`2026-09`** | `not.toContain('2026-08')` — **the 0-based/1-based inversion** |
| **F9** (#16) | `O` | Body contains **`488%`** for `Travel` and **`266%`** for `Dining Out` | `not.toContain('487%')` and `not.toContain('266.25')` — pins the rule to the page's `Math.round`, not step 32's floor |
| **F10** (#17) | `O` | Body contains **`$1,065.00`** and **`$975.00`** verbatim | `not.toContain('$1065.00')` (the ungrouped form) and `not.toContain('$1,312.50')` (the figure a re-derivation from a different `actual` would produce) |
| **F11** (#21) | `fingerprint(O)` vs `fingerprint(O')` where `O'` moves `Dining Out`'s `actual` 284 → 350, `projected` → 1312.5, `projectedRatio` → 3.28125 | **identical** | `not.toBe` two different values — **Q4's central rule.** *Verified:* `350 × 30/8 = 1312.5`, `1312.5/400 = 3.28125` |
| **F12** (#22) | `fingerprint(O)` vs `fingerprint` of `O` with `sayingNo: [T, D]` | **identical** | — |
| **F13** (#23) | `fingerprint(O)` vs `O` plus a third `Groceries` record with reason `breach` | **different** | `not.toBe` equal |
| **F14** (#23) | `fingerprint(O)` vs `O` with `Dining Out`'s reason `projected-breach` → `breach` | **different** | `not.toBe` equal |
| **F15** (#24) | `fingerprint(O)` vs `O` with `asOf.month` 8 → 9 | **different** | `not.toBe` equal |
| **F16** (#25) | `fingerprint` of `O`'s breach message vs `fingerprint` of F4's coverage message | **different** | `not.toBe` equal |
| **F17** (#20) | `fingerprint(O)` | matches `/^[0-9a-f]{16,}$/` | `not.toContain('Dining')`, `not.toContain('Travel')`, `not.toContain('|')` — a `names.join('\|')` key fails all three |
| **F18** (#26) | `shouldSend(m, [{ fingerprint: m.fingerprint, delivered: true }])` | `false` | `not.toBe(true)` |
| **F19** (#27) | `shouldSend(m, [{ fingerprint: m.fingerprint, delivered: false }])` | **`true`** | `not.toBe(false)` — **a failed send must never silence the retry** |
| **F20** (#28) | `shouldSend(m, [])` and `shouldSend(m, [{ fingerprint: 'deadbeefdeadbeef', delivered: true }])` | `true` both | — |
| **F21** (#18) | `O` with a third record: `Gym`, reason `off-cycle`, `budgeted: 0`, `actual: 150`, `spentRatio: null`, `projected: null`, `projectedVariance: null`, `projectedRatio: null`, `status: 'off-cycle'` | Body contains **`Gym`** and **`$150.00`** | `not.toContain('null')`, `not.toContain('NaN')`, `not.toContain('$0.00')`, `not.toContain('undefined')` — the off-cycle line omits the comparison rather than printing an empty one |
| **F22** (#19) | `O` with `Dining Out`'s `actual: Number.POSITIVE_INFINITY` | `RangeError` naming `Dining Out` | the function must **not** return a message |

### The nine `mailConfig` fixtures

`E` is the valid base environment: `{ SMTP_HOST: 'smtp.provider.test', SMTP_PORT: '465',
SMTP_USER: 'alerts@provider.test', SMTP_PASSWORD: 'S3cret-Value-Not-Real',
ALERT_EMAIL_TO: 'owner@example.test', ALERT_EMAIL_FROM: 'alerts@provider.test' }`. It is a literal in
the test file and **is not a real credential**; #45 is the control that no real one joins it.

| Fixture | Input | Expected | Pinned `not.` |
|---|---|---|---|
| **F-M1** (#29) | `smtpSettings(E)` | `secure === true` | `not.toBe(false)` — 465 is implicit TLS |
| **F-M2** (#30) | `E` with `SMTP_PORT: '587'` | `secure === false` **and** `requireTLS === true` | `requireTLS` `not.toBe(false)` — a 587 config that does not require STARTTLS is a plaintext fallback |
| **F-M3** (#31) | `E` with `SMTP_PORT: '25'` | throws, message names the port and TLS | must **not** return a configuration |
| **F-M4** (#32) | `E` with `SMTP_TLS_REJECT_UNAUTHORIZED: 'false'` | throws | must **not** return a configuration |
| **F-M5** (#33) | `E` with `SMTP_PASSWORD` deleted | throws, message contains `SMTP_PASSWORD` | must not return a configuration with an empty-string password |
| **F-M6** (#34) | `E` with `SMTP_PORT: '25'` — i.e. a rejection while holding a password | the thrown message `not.toContain('S3cret-Value-Not-Real')` | **the credential-leak control.** A `JSON.stringify(env)` error message fails it |
| **F-M7** (#35) | `alertsEnabled` over `{}`, `{ALERTS_ENABLED:'TRUE'}`, `{ALERTS_ENABLED:'1'}`, `{ALERTS_ENABLED:'yes'}`, `{ALERTS_ENABLED:'true'}` | `false, false, false, false, true` | the four falses each `not.toBe(true)` — no case folding, no truthiness, fail-safe off |
| **F-M8** (#36) | `describeSmtp(smtpSettings(E))` | contains `smtp.provider.test` and `465` | `not.toContain('S3cret-Value-Not-Real')` — this string is what reaches `lib/logger.ts` |
| **F-M9** (#37) | `E` with `ALERT_EMAIL_TO: 'not-an-address'` | throws | must not hand it to a transport |

## Negative controls

| # | Rule | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | **Only allowlisted fields leave the process** | a `sayingNo` record carrying `merchantName`, `accountId`, `balance`, `transactionId` | F2, acceptance #9; statically #10 (no `JSON.stringify`) and #52 |
| 2 | **Below the threshold, no category name, amount or ratio leaves** | a `projected-breach` outlook at `coveragePercent: 7` | F4, acceptance #11 |
| 3 | An empty population produces no message | `coverageShare: null`, with and without a non-empty `sayingNo` | F7, F7a, acceptance #14 |
| 4 | Nothing scored is not a coverage problem | `state: 'nothing-to-score'` at `coveragePercent: 7` | F5, acceptance #12 |
| 5 | The subject carries no money | `O`'s subject | F3, acceptance #8 |
| 6 | The signed field is never rendered | `projectedVariance` 665 and 775 | F1's `not.toContain('$665.00' / '$775.00')`, acceptance #7; statically Q8 |
| 7 | The month is 1-based on the wire | `asOf.month = 8` rendering `2026-08` | F8, acceptance #15 |
| 8 | The ratio rule matches the page | `4.875` rendering `487%` | F9, acceptance #16 |
| 9 | Money is never re-derived | `$1,312.50` (the figure a re-projection produces) appearing under `actual: 284` | F10, acceptance #17; statically #48 |
| 10 | An off-cycle record prints no empty comparison | `null` / `NaN` / `$0.00` in the body | F21, acceptance #18 |
| 11 | A non-finite figure is rejected, not printed | `actual: Infinity` | F22, acceptance #19; statically #53 (nothing swallows it) |
| 12 | The fingerprint ignores amounts | the same categories with `actual` 284 → 350 | F11, acceptance #21 |
| 13 | The fingerprint carries no name | `Dining\|Travel` as a key | F17, acceptance #20 |
| 14 | **A failed send does not silence the retry** | a prior row with `delivered: false` | F19, acceptance #27 |
| 15 | **Plaintext SMTP is a stated failure** | `SMTP_PORT: '25'`; `SMTP_TLS_REJECT_UNAUTHORIZED: 'false'` | F-M3, F-M4, acceptance #31, #32 |
| 16 | **No credential appears in a thrown message or a log line** | a rejection while holding `S3cret-Value-Not-Real` | F-M6, F-M8, acceptance #34, #36; statically #45 |
| 17 | **No credential appears in a rendered message** | `SMTP_` anywhere in a body | F1's exclusions; statically #51 (the module cannot read `process.env`) |
| 18 | Sending is off by default | `ALERTS_ENABLED` unset, `'TRUE'`, `'1'`, `'yes'` | F-M7, acceptance #35; statically #75 |
| 19 | **Nothing sends during development** | any test constructing a transport or reading `.env.local` | acceptance #42, #43; #41 and #44 pin the transport to one non-test file |
| 20 | No second destination | a second `createTransport` call site | acceptance #41, #44 |
| 21 | No second scheduler | a `setTimeout` / `setInterval` in any new file | acceptance #55, #55a, #55b, #55c |
| 22 | The shell decides nothing | a reference to `authoritative` or `sayingNo` in `lib/breachAlert.ts` | acceptance #38 |
| 23 | The membership test is not re-expressed | `control_mode` / `landscape` in the alert module | acceptance #46 |
| 24 | The month-outlook query is not duplicated | a second copy of `EXTRACT(MONTH FROM t.date)::int - 1` | acceptance #58 (`1`, not `2`) |
| 25 | The dashboard's rendered surface does not move | a removed or renamed `data-testid`, a second clock read, a net-worth reference | acceptance #61, #62, #62a, #62b |
| 26 | The read-only inputs are untouched | any diff to `adherence.ts`, `pacing.ts`, `monthOutlook.ts` or their tests | acceptance #63–#66, #69 |
| 27 | The send log holds no financial data | a `NUMERIC`, an `amount`, a `category` column in the migration | acceptance #71 |
| 28 | No `.env` file is ever committed | a tracked `.env*` | acceptance #76, #77 |

## Evidence required

1. **The rendered breach message, verbatim, over fixture `O`** — subject and body, pasted whole into
   `EVIDENCE.md`. This is fabricated data by construction and contains no real figure. It is the
   artifact the owner reads to decide whether the allowlist was drawn correctly, and it is the one
   thing a reviewer cannot check from a grep.
2. **The rendered coverage message, verbatim, over fixture F4** — beside it, so the two are
   comparable and the withdrawal of the figures is visible rather than asserted.
3. **The verbatim limitation from Q1**, repeated in `EVIDENCE.md`: *no command in this spec proves
   that a message is delivered, that TLS is negotiated, or that the provider accepts the
   configuration. The content is gated; the delivery is not, and must not be described as tested.*
4. **The owner's own manual send, or its explicit absence.** If the owner chooses to verify delivery,
   that is the owner's action on the owner's machine with the owner's `.env.local` — **not an
   agent's** (`DECISION.md`: *"No agent sends a message to any real address at any point."*). Record
   which happened. If it did not happen, say so; do not imply it did.
5. **The migration's up/down/up log** against a throwaway database (G1, T6), and the `alert_sends`
   section of `db/schema.sql` quoted, so a reviewer can see for themselves that no money column and
   no category column exists.
6. **The verbatim limitation from Q3**, repeated in `EVIDENCE.md`: *the in-process timer only fires
   while the Next server is up. `net_worth_snapshots` has no row for 2026-08-12 for exactly this
   reason. The guardrail will miss days the same way, silently, until Phase 2 step 20 and Phase 5
   step 39 land.*
7. **The measured `MonthOutlook.authoritative` on the owner's dev database today**, one line. Step
   32's evidence measured coverage at **7.7%** on the owner's real August. If today's month is
   likewise non-authoritative, then **the only message this step can ever send on the owner's real
   data is the coverage message** — say that plainly. It is the honest reading of Q2 and it is
   information about the data, not a reason to move the threshold or weaken the rule.
8. **The list of the seven new `.env.local.example` keys**, with the confirmation that every value is
   empty and that `git ls-files | grep '^\.env'` is empty (#74, #76).
9. **Any counter in this spec that a correct implementation could not satisfy**, reported rather than
   worked around — the A3/A4 path.

## Failure modes to test

- **The object dumped into the body.** A `JSON.stringify(category)` or a template that interpolates a
  whole record ships every field the row happens to carry, forever, silently. This is the most likely
  way the allowlist gets crossed and it is why F2 and #10 both exist.
- **The coverage refusal implemented as a *sentence* rather than a *withholding*.** The figures still
  in the body, with "we cannot stand behind this" above them. It reads as compliant and is exactly the
  incoherence Q2 exists to prevent. F4's `not.toContain('$284.00')` is the discriminator.
- **The month off by one.** `asOf.month` is 0-based; `2026-08` in a September alert is a wrong month
  in the one field that dates the whole message, and it looks entirely plausible.
- **`Math.round` versus `Math.floor` on the ratio**, so the email says 487% and the page says 488% for
  the same category. A one-point disagreement between two surfaces over the same figure is this
  repo's signature defect in miniature.
- **The fingerprint including amounts**, so the guardrail re-fires every day as spend accrues — the
  exact noise Q4 exists to prevent, and it passes every test that only checks a single day.
- **Suppression keyed on *attempted* rather than *delivered*.** The first network blip permanently
  silences the guardrail, and the symptom is silence, which is indistinguishable from a good month.
- **`0/0` and `null` leaking into the body** as `NaN%`, `null%` or `$0.00` — step 32's null-semantics
  trap arriving on a surface with no "—" to render.
- **The off-cycle record.** It is the *highest-precedence* reason, so it is the first thing a real
  breach message will contain, and it is the one record with `projected === null`. An implementer who
  tests only `projected-breach` ships a message whose first line reads `null`.
- **`projectedVariance` rendered, with the subtraction reversed**, so thrift reads as overspending —
  `pacing.ts` names this failure explicitly and Q8 removes the field rather than trusting the sign.
- **The queries copied into the shell instead of extracted**, so the page and the email compute two
  month outlooks that agree today and diverge at the first predicate change. #58 is the only thing
  that catches it.
- **The extraction changing a predicate while it moves.** The month normalisation or the
  positive-amount filter altered in transit silently moves the hero's figures — which is why #56a and
  #57a assert the strings arrive byte-identical rather than merely present.
- **A credential in a thrown error or a log line.** `throw new Error(\`bad config: ${JSON.stringify(env)}\`)`
  is the natural thing to write and it puts an SMTP password into the structured log, which is the §5.4
  prohibition in its purest form.
- **`ALERTS_ENABLED` read as truthy.** `'false'` is a truthy string. A `Boolean(process.env.ALERTS_ENABLED)`
  check sends from every developer checkout that copied the example file.
- **TLS accepted by default.** Nodemailer will happily connect to port 25 in the clear. A config parser
  that defaults `secure` from the port without rejecting 25 puts these figures on the wire.
- **A second timer added "so alerts run at a different hour"**, giving two schedulers, two cadences and
  two things for step 20 to find.
- **The alert throwing and taking the daily sync with it**, so a mail outage stops Plaid syncing and
  net-worth snapshots — a much larger failure than the one it was reporting.
- **The migration written as an upsert-able "last sent" row**, making the log a mutable current-value
  column: the stored-derived-value defect this repo has an explicit rule against.
- **The build breaking on a server-only import** reaching a client boundary through
  `instrumentation.ts` → `lib/scheduler.ts` → `lib/breachAlert.ts` → `nodemailer`. #4 is the gate.

## Rollback

Two commits' worth of surface, one revert, plus a schema step:

- `git revert <sha>` restores the four query functions to `app/dashboard/page.tsx`, removes the alert
  modules, removes the scheduler call, and drops `nodemailer` from `package.json`. `npx tsc --noEmit`
  is the completeness check in both directions — the extraction is type-visible at every call site.
- **The `down` migration drops `alert_sends`.** It is written and exercised at G1 (`up → down → up`
  against a throwaway database, T6), because a migration that cannot be written down is a debugging
  trap the first time a rollback is needed (§9.3).
- **No CSV restore.** The table holds no financial data by construction (#71), and nothing else in
  this step writes a row.
- **The `.env.local` keys are left in place** — they are inert once `ALERTS_ENABLED` is unset, and
  removing a key from a gitignored file is not part of a revert.
- `plan/tasks/P0.5-33-delivery-channel/**` is documentation and is not reverted.
- **If the alert turns out to be too noisy or too quiet, the rollback is not a revert.** Cadence lives
  entirely in the fingerprint rule, which is pure and tested; changing it is a change to
  `lib/domain/breachAlert.ts` and its fixtures, with no schema and no surface involved. That is why
  the rule has no tunable constant to begin with (Q4).

## Questions this spec could not settle

- **Whether anything but the coverage message will ever be sent on the owner's real data.** Step 32
  measured **7.7%** coverage on the owner's August. Under Q2 that means the breach message — the
  thing the step is nominally for — never fires until categorization improves. This spec takes that
  as the correct behaviour rather than a defect, but it is a real possibility that the phase's exit
  criterion is satisfied in shape and not in effect. Evidence #7 is the measurement that says which.
  **Do not weaken Q2 to make the breach message fire.**
- **Whether the coverage message is the right payload at all, versus a bare "open the app".**
  `ITEM.md` argued the strongest privacy posture is a message carrying no figure whatsoever. Q2 keeps
  `coveragePercent` and a count because they are the only things that make the message actionable
  without opening the app, and because `DECISION.md` explicitly permits far more. It is a judgement,
  not a derivation, and the owner may narrow it — narrowing is always available; widening is another
  §5.1 escalation.
- **Whether TLS is actually negotiated.** The configuration is validated; the wire is not observed.
  No command in this repo can observe it without sending. Evidence #4 is the owner's, or nobody's.
- **Whether the provider accepts the configuration, and what its failure looks like.** Unknown until
  a real send happens, which no agent performs. The failure path is recorded (`delivered = false`,
  Q5) but its shape — a rejection, a timeout, a silent accept-then-bounce — is unobserved. A bounce
  in particular is invisible to this design: the provider accepts, the row records `delivered = true`,
  and nothing arrives.
- **Whether the in-process trigger is good enough in practice.** Q3 argues it is the right shape and
  concedes it will miss days. How many days is a fact about the owner's laptop, not about this code,
  and it is unknowable until Phase 2 step 20 makes it moot.
- **Whether the two formatting helpers should be extracted to a shared module.** Q7 accepts the
  duplication and pins cross-surface agreement by fixture. A third copy would change the answer. It
  belongs in `NITS.md`, not here.
- **What a bounce, an unsubscribe, or a provider suspending the account does to a guardrail the owner
  has stopped receiving.** This is the same class as the missing heartbeat and is left with it, at
  Phase 5 step 39.
