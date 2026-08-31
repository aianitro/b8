# b8 — build architecture (five-agent delivery system)

> How b8 gets built. A separation-of-powers agent system in which no single agent can both define correctness and declare that it was achieved. The steps in `ROADMAP.md` §5 enter this pipeline as specs and leave as merged, contract-conformant, adversarially-verified code.

**Companion documents.** `ROADMAP.md` §1–§4 = the idea inventory. `ROADMAP.md` §5 = the order of operations. **This document = the delivery system that builds them.** It describes process, not product; nothing here changes what b8 does, only how it comes to exist.

**Naming note.** This file is deliberately **not** `AGENTS.md`. `AGENTS.md` in this repo is *generated* — `next dev` writes and re-adds the `nextjs-agent-rules` block (see `node_modules/next/dist/server/lib/generate-agent-files.js`), so anything hand-written there is a change that keeps reappearing in the diff. `CLAUDE.md` simply includes it. This architecture doc stands alone as `BUILD.md`.

---

## 1. Why five agents, and why these five

A single agent writing code against its own understanding of the task, then judging its own output, fails in three predictable ways — and all three are already in this repo's history, documented in `ROADMAP.md` §5.

1. **Unfalsifiable "done."** An item with no acceptance command is finished when the agent narrates that it is finished. §5's completed steps are unusually well documented *because they were written up after the fact*; the writeup is not the same thing as a gate that could have failed.
2. **Drifting definitions.** `lib/domain/property.ts` cloned `valuation.ts`'s "pick the newest row" reducer. It was consolidated into `latestValueByKey`, but for the duration of two unmerged branches the codebase held two independent definitions of "current value" — the same shape of defect as a dashboard reporting four different totals for one number.
3. **Self-approval.** The Gastonia P&L shipped with **three** bugs — debt service reading $0, a sign trap that would have read a mortgage as rental income, and a $3,120 internal transfer counted as income — and all three survived review because **cash flow was correct throughout**. The bottom line was right; the middle of the statement was wrong. An agent reviewing its own work grades the code it *intended* to write, and it shares the misconception that produced the bug.

The five roles exist to make each failure structurally impossible:

| Failure mode | Structural defense |
|---|---|
| Unfalsifiable "done" | **spec-writer** must emit literal, runnable acceptance commands before any code exists |
| Drifting definitions | **contract-guardian** exclusively owns the type surface and the schema; no other agent may edit them |
| Self-approval | **adversarial-reviewer** is read-only and instructed to falsify, never to admire |
| Scope creep | **spec-writer** emits explicit non-goals; the reviewer flags out-of-scope diffs as defects |
| Unbounded rework | **orchestrator** holds the gates, counts iterations, escalates to human |

**The governing principle — separation of powers.** The agent that *defines* correctness (spec-writer), the agent that *owns the interface* (contract-guardian), the agent that *achieves* it (implementer), and the agent that *attempts to disprove* it (adversarial-reviewer) are four different actors with four different tool grants. The orchestrator does not implement; it adjudicates on evidence.

This mirrors b8's own product ethos. `ROADMAP.md` §4 argues that an AI feature is worth nothing without an eval that proves it helped. The same standard applies inward: **anyone can add agents; the gates are the evidence they helped.** §15 measures the build system with the same rigor the roadmap demands of the product's triage.

---

## 2. The contract surface

b8 has no `contracts/` directory yet — Phase 1 step 10 will add `shared/contracts/` with zod. Until then, and after, the **contract surface** is the set of files that define shapes every other file agrees on:

```
shared/types.ts          # the shared TypeScript surface: Account, Property, BudgetCategory, …
shared/contracts/**      # zod contracts (ROADMAP §5 step 10; empty today)
migrations/*.sql         # the schema's forward history — node-pg-migrate
db/schema.sql            # the readable reference schema
```

Single-writer, per **I2** below. Everything else — `lib/`, `app/`, `components/`, `scripts/` — is implementation, and any agent with an Edit grant may touch it.

**Generated output**, which *no* agent hand-edits: `.next/**`, `node_modules/**`, `next-env.d.ts`, `tsconfig.tsbuildinfo`, `package-lock.json` (via npm only), and the `nextjs-agent-rules` block in `AGENTS.md`. A hand edit to any of these is a change that appears to work and silently evaporates on the next `npm ci` or `next dev`.

**Why the schema is in the contract set and not "just implementation."** A column's meaning ripples to every route, every component, and every query at once, and Postgres will not tell you when a consumer's assumption stops holding. `transactions.property_id` is the cleanest example: it is resolved as `COALESCE(t.property_id, a.property_id)`, so `NULL` means *inherit from the account*, not *unattributed*. That meaning is not recoverable from the type. It has exactly one owner for the same reason the schema has exactly one migration history.

---

## 3. Invariants

Five rules. A violation of any one is a P0 process defect, not a style disagreement.

- **I1 — Contract-first.** No implementation begins before the types and columns it touches are at their final version for that task. Code conforms to the shape; the shape is never retrofitted to the code.
- **I2 — Single-writer contracts.** Only contract-guardian edits the contract surface (§2). The implementer's grant excludes those paths **by hook, not by good intentions** (§13.2).
- **I3 — Falsifiable acceptance.** Every task spec carries acceptance commands that are literal, runnable, and deterministic. "Done" is an exit code, never a narration.
- **I4 — Adversarial verification.** No task passes on the implementer's own assurance. The reviewer must attempt disproof and record what it tried, including when it finds nothing.
- **I5 — Evidence over assertion.** The orchestrator adjudicates on command output and diffs. When reviewer and implementer disagree, the tiebreaker is a command the orchestrator runs itself — never rhetorical strength.

---

## 4. Roster and authority matrix

| Role | Tools | Writes | Reads | Runs commands | Model |
|---|---|---|---|---|---|
| **orchestrator** | main session | `plan/`, task state | all | **yes — owns all gates** | Opus |
| **spec-writer** | Read, Grep, Glob | *(returns spec; orchestrator persists)* | all | no | Sonnet |
| **contract-guardian** | Read, Edit, Write | contract surface (§2) **only** | all | no | Opus |
| **implementer** | Read, Write, Edit, Bash | `lib/**`, `app/**`, `components/**`, `scripts/**`, tests | all | yes | Opus |
| **adversarial-reviewer** | Read, Grep, Glob | nothing | all | **no** | Opus |

Three deliberate asymmetries:

**The reviewer cannot run commands.** This is a constraint, not an oversight, and it is why the orchestrator "runs the gates." A reviewer with Bash would re-run the implementer's tests and report green — testing what the implementer already tested. Denied Bash, the reviewer must reason about the code as written: unhandled paths, sign conventions, silent failure modes, and the domain hazards in §10.3. The orchestrator executes the acceptance commands *independently* and hands the reviewer the captured output as evidence. Division: **the machine verifies that it runs; the reviewer reasons about whether it is right.** The Gastonia bugs are the case in point — every test was green, and being green is not what would have caught them.

**The guardian cannot write code.** Contract-path-only. Its diffs are small, high-blast-radius, and reviewable in isolation. A guardian that could also implement would inevitably shape the schema around implementation convenience — exactly backwards from I1.

**The spec-writer cannot run anything.** It must derive acceptance commands from the repo as it exists (Grep/Glob/Read), which forces the commands to reference real targets — real npm scripts, real test paths. A spec-writer that could run commands would iterate until something passed and call that the spec.

---

## 5. Role specifications

### 5.1 orchestrator (main session)

**Mandate.** Hold the plan. Sequence tasks. Run every gate. Adjudicate disputes on evidence. Escalate to the human when the loop fails to converge.

**Owns**
- `plan/QUEUE.md` — the active queue over `ROADMAP.md` §5, with status and dependency edges
- `plan/tasks/<task-id>/` — the per-task record (spec, contract note, evidence, reviews, gate log)
- The contract lease (`.claude/bin/lease`) — opened before dispatching the guardian, closed when G1 passes
- Task selection: dependency-respecting, and contract-disjoint when parallelizing (§12)
- **Every gate execution.** Gates are the orchestrator's exclusive function.

**Explicitly does not**
- Write production code, types, or migrations. If the orchestrator is editing `lib/`, the architecture has collapsed into a single agent.
- Overrule a reviewer BLOCK by argument. It overrules only by running a command that demonstrates the finding is wrong, and it records that command in the gate log.

**Adjudication protocol.** On disagreement: (1) identify the empirical claim in dispute; (2) construct a command that discriminates between the two positions; (3) run it; (4) record command, output, and decision in `GATES.md`. If no such command exists, the claim is unfalsifiable — the spec was underspecified, and the task returns to spec-writer rather than being argued to a conclusion.

**Causal-claim rule.** **A mitigation, fix, or disposition may not be recorded as "verified" unless the causal claim behind it was itself run as a command.** A ruling that is right about *what* is broken and wrong about *why* produces a fix aimed at the wrong object, and re-running the thing that was already green will not catch it. This applies to the orchestrator's own rulings first. Where the causal claim cannot be run, the disposition is recorded as a *hypothesis*, never as a verification.

This rule is not abstract here. Gastonia's debt service read $0 and the obvious causal story — "the account isn't flagged as a liability" — was **wrong**; the account was flagged correctly all along, and the real cause was that the liability flag and the payment stream sat on two different accounts and never met. A fix aimed at the flag would have changed nothing and been recorded as verified.

**Escalation triggers** (any one → stop, surface to human):
- 3 implementer↔reviewer cycles without an ACCEPT
- A migration change that would edit already-applied history (§9.3)
- Acceptance commands that pass while the reviewer's failure scenario reproduces under the orchestrator's own hand
- Any task whose spec cannot be given falsifiable acceptance commands
- Any change that would put real financial data behind a network-reachable surface

### 5.2 spec-writer

**Tools:** Read, Grep, Glob. **Input:** one `ROADMAP.md` §5 step. **Output:** a task spec (`plan/tasks/.templates/SPEC.md`).

**Mandate.** Convert a roadmap line into a specification precise enough that an implementer with no prior context can satisfy it, and a reviewer with no prior context can check it.

**Required in every spec**
1. **Goal** — one paragraph, the observable change in system behavior.
2. **Non-goals** — explicit. The reviewer treats out-of-scope diffs as defects, so an unstated boundary is an unenforceable one.
3. **Contracts touched** — which types, which migration, what change class (§9.2). "None" is valid and preferred.
4. **Conventions honored** — sign, rounding, landscape, exclusion flags, null semantics. Stated at spec time, because the implementer will otherwise infer them from whichever fixture it sees first, and this is the failure class with the worst record in the repo.
5. **Acceptance commands** — literal shell, runnable from repo root, deterministic. Each paired with the expected observable result.
6. **Negative controls** — for every rule stated in prose, the input that must be rejected and the command that asserts the rejection.
7. **Evidence required** — what the implementer must show beyond green tests.
8. **Failure modes to test** — seeds the reviewer's falsification log.
9. **Rollback** — including the `down` migration and any CSV restore.

**Quality bar for acceptance commands.** Verify by Grep/Glob that every referenced npm script and test path exists. Commands must be deterministic: no wall clock, no live Plaid call, no dependence on the state of the dev database.

Bad: `verify the property P&L is correct`
Good: `npx vitest run lib/domain/propertyPnl.test.ts` → `14 passed`; and a fixture-driven assertion that a `Transfer`-category row on a linked account appears in the ledger output and is absent from the P&L output

**Prohibited.** Proposing implementation design. The spec states *what must be observably true*, not how. An implementer handed a design has nothing left to decide and will not catch the design's flaws.

### 5.3 contract-guardian

**Tools:** Read, Edit — scoped to the contract surface by hook (§13.2), and only while the lease is open. **Mandate.** Sole owner of the type surface and the schema, and of how they change.

**Responsibilities**
- Author and amend `shared/types.ts`, `shared/contracts/**`, and migrations
- Classify each change per §9.2 and state the rationale, not just the delta
- Enforce forward-only migration history (§9.3) — the hard constraint
- Reject contract requests that encode implementation convenience rather than domain truth

**Operating rules**
- **Minimal diff.** Do not tidy adjacent types while you are in there.
- **Derived values are never stored columns.** The observation tables are append-only on purpose; "current value" is always a derived read. `net_worth_snapshots` is the deliberate exception, and only because the computed statement genuinely cannot be reconstructed later — it depends on which accounts existed and how they were classified on that date.
- **Money is `NUMERIC` with a stated scale**, never float.
- **Nullable means unknown**, and consumers must be able to tell. Never default a missing observation to zero in the schema.
- **Inheriting columns are documented as inheriting.** `COALESCE(t.property_id, a.property_id)` semantics live in a comment or they are lost.
- **Every migration is reversible.** CI runs up → down → up against a throwaway Postgres.

**Prohibited.** Writing implementation, tests, or documentation outside the contract surface. If a change requires backfilling or correcting rows, the guardian *specifies* it — including the CSV backup this project takes before any data correction; the implementer runs it.

### 5.4 implementer

**Tools:** Read, Write, Edit, Bash. **Input:** a frozen spec + a frozen contract surface. **Output:** code, tests, and an evidence bundle.

**Mandate.** Make the acceptance commands pass without violating the spec's non-goals.

**Operating rules**
- **Read `node_modules/next/dist/docs/` before writing Next-facing code.** This is Next 16; most training data describes a different framework.
- **Contracts are read-only inputs.** Import from `shared/types.ts`. If a type or a column is wrong, **stop and report** — never work around it locally.
- **Tests accompany code in the same task.** There is no follow-up "add tests" task; the reviewer treats untested behavior as unverified behavior.
- **Run the acceptance commands before declaring done**, and include verbatim output in `EVIDENCE.md`.
- **Report honestly.** A green summary over a red suite is the single most damaging failure available to this role, because it corrupts the evidence the orchestrator adjudicates on.
- **Match surrounding code** — comment density (this codebase explains *why*, at length, wherever a decision would otherwise look arbitrary), naming, idiom, and palette.

**Domain constraints** — non-negotiable, and a BLOCK regardless of test results:
- Money math is exact. `NUMERIC` in the database; explicit rounding in JS. A balance meant to reconcile against a bank statement rounds per step, not once at the end.
- Sign conventions are normalized at the boundary where the account is known, never guessed downstream.
- "Latest" is a derived read with an explicit newest-wins reduction (`latestValueByKey`), never last-row-wins.
- `null` is never rendered as `0`.
- Category lookups match on name within a landscape via `EXISTS`, not `JOIN`.
- Real financial data never leaves the machine — not into logs, commit messages, screenshots, or the conversation. Fabricate test data.

### 5.5 adversarial-reviewer

**Tools:** Read, Grep, Glob. Read-only, by design. **Input:** the spec, the diff, the contract surface, and the orchestrator's captured command output. **Output:** a review verdict (§10.2).

**Mandate — stated in the agent's own prompt.** *Your job is to disprove the claim that this diff satisfies its spec. You are not here to admire the code. A review that finds nothing must demonstrate what was tried.*

**Method.** For each acceptance criterion, form a falsification hypothesis and test it by reading. The critical question: *is any acceptance command satisfiable without the intended behavior existing?* A command that passes vacuously is a gate that does not exist.

**Domain-specific hunt list** (§10.3) — generic review misses what actually breaks a finance app, and every hazard on that list is a defect this repo has already shipped.

**Falsification log is mandatory.** Every review lists the hypotheses tested and each outcome, including refuted ones. An ACCEPT with an empty log is itself a process defect and the orchestrator rejects the review. This is the mechanism that converts "looks good to me" — the failure the whole architecture exists to prevent — into a checkable artifact.

**Prohibited.** Praise, summary of what the code does, style preferences unrelated to correctness, and suggesting rewrites the spec did not ask for.

---

## 6. Task lifecycle

```
   ROADMAP.md §5 step
                │
                ▼
        ┌───────────────┐
        │  spec-writer  │────▶ SPEC.md (goal, non-goals, conventions, acceptance cmds)
        └───────────────┘
                │
          ╔═════▼═════╗   G0 · spec gate
          ║orchestrator║   commands literal? targets exist? negative controls present?
          ╚═════╤═════╝   ──FAIL──▶ back to spec-writer
                │ PASS  ── SPEC.md frozen: `touch plan/tasks/<id>/.frozen` ──
                ▼
     ┌──────────────────────┐   (skipped when the contract surface is untouched)
     │  contract-guardian   │────▶ types/migration diff + rationale
     └──────────────────────┘     ── lease OPEN for the duration ──
                │
          ╔═════▼═════╗   G1 · contract gate
          ║orchestrator║   change class right? migrate up/down/up clean? consumers intact?
          ╚═════╤═════╝   ──FAIL──▶ back to guardian
                │ PASS  ── lease CLOSED: contracts FROZEN for this task ──
                ▼
        ┌───────────────┐
        │  implementer  │────▶ code + tests + evidence bundle
        └───────────────┘
                │
          ╔═════▼═════╗   G2 · build gate  (orchestrator runs cmds ITSELF)
          ║orchestrator║   acceptance cmds pass? tsc/lint clean? diff inside declared surface?
          ╚═════╤═════╝   ──FAIL──▶ back to implementer  [cycle++]
                │ PASS + captured output
                ▼
     ┌────────────────────────┐
     │  adversarial-reviewer  │────▶ verdict + falsification log
     └────────────────────────┘
                │
          ╔═════▼═════╗   G3 · adversarial gate
          ║orchestrator║   BLOCK ▶ implementer [cycle++]   (3 cycles ▶ HUMAN)
          ╚═════╤═════╝   empty falsification log ▶ back to reviewer
                │ ACCEPT
                ▼
          ╔═══════════╗   G4 · integration gate
          ║orchestrator║   full suite + build + migrate round-trip + INCONCLUSIVE items run
          ╚═════╤═════╝   ──FAIL──▶ implementer [cycle++]
                │ PASS
                ▼
              MERGED  ──▶ plan/QUEUE.md updated, GATES.md sealed
```

**Contract freeze.** Once G1 passes and the lease closes, the contract surface is immutable for the duration of the task. An implementer discovering a type flaw does not route around it — the task **returns to G1**, the guardian amends, and implementation restarts from a known-good interface. Restarting is cheaper than a divergent local shape, which is precisely how this codebase arrived at two "pick the latest valuation" reducers.

---

## 7. The gates

Gates are the orchestrator's exclusive function and the system's only definition of progress. Each is a binary decision on recorded evidence, logged to `plan/tasks/<id>/GATES.md`.

### 7.1 G0 — spec gate
- [ ] Every acceptance command is literal, runnable from repo root, deterministic
- [ ] Every referenced npm script, test path, and module exists (verified by the orchestrator, not assumed)
- [ ] Non-goals are stated and specific
- [ ] Contracts-touched section present (may be "none")
- [ ] **Conventions section states sign, rounding, landscape/exclusions, and null semantics**
- [ ] Failure modes enumerated — the reviewer's starting hypotheses
- [ ] **No command passes vacuously** — for each, the orchestrator can name a plausible broken implementation the command would catch
- [ ] **Every rule stated in prose carries a negative control** — the input it must reject, and the command that asserts the rejection
- [ ] Every toolchain-prerequisite row is verified by a command the orchestrator runs

On PASS: `touch plan/tasks/<id>/.frozen`. The hook makes the spec immutable from that moment, so acceptance criteria can never be edited to fit an implementation.

The vacuity check is the gate's real substance. An acceptance command that a stub would satisfy is not an acceptance command.

**On negative controls at spec time.** A rule written as prose and gated only by "the implementation passes" is a rule whose wording has never been tested. A negative control authored *with the rule* forces the author to state what the rule must reject — which is the half of a rule that prose most reliably omits. "Transfers are excluded from the P&L" reads as complete until you are asked to name the row that must not appear, at which point you discover the spec never said whether `exclude_from_budget` counts.

### 7.2 G1 — contract gate *(skipped when the contract surface is untouched)*
- [ ] Diff is minimal and confined to the contract surface (§2)
- [ ] Change class matches the change (§9.2)
- [ ] `npm run migrate:up && npm run migrate:down && npm run migrate:up` clean against a throwaway database
- [ ] `db/schema.sql` reflects the migration
- [ ] No committed migration was edited (§9.3)
- [ ] `npx tsc --noEmit` passes with the new types — every existing consumer still compiles
- [ ] Money columns are `NUMERIC` with a stated scale; no new stored "current value" column
- [ ] Nullable-means-unknown is preserved; no missing observation defaulted to zero
- [ ] Rationale recorded in `plan/tasks/<id>/CONTRACT.md`, including any required backfill and its CSV backup
- [ ] Lease closed before the implementer is dispatched

### 7.3 G2 — build gate
- [ ] The orchestrator runs **every** acceptance command itself and captures output verbatim
- [ ] All pass
- [ ] `npx tsc --noEmit` and `npm run lint` clean
- [ ] No diff outside the spec's declared surface (`git status --short` reviewed line by line)
- [ ] `AGENTS.md` dirty only from the `next dev` block, and committed with the work if so
- [ ] Evidence bundle present and matching the spec's requirement

Independent re-execution is the point. The implementer's claim that tests pass is a claim; the orchestrator's captured output is evidence — and it becomes the reviewer's input.

### 7.4 G3 — adversarial gate
- [ ] Verdict is `ACCEPT` or `ACCEPT_WITH_NITS`
- [ ] Falsification log is non-empty and specific (≥5 tested hypotheses, or a written justification for fewer)
- [ ] Each BLOCK finding has a concrete failure scenario: inputs/state → wrong output
- [ ] Nits are recorded as follow-up tasks, not silently absorbed

Two failure paths, distinct: a **BLOCK** returns to the implementer and increments the cycle counter. An **empty or vacuous falsification log** returns to the *reviewer* and does **not** increment — the reviewer failed to review, and the implementer must not be charged for it.

### 7.5 G4 — integration gate
- [ ] `npm test` — full suite green
- [ ] `npx tsc --noEmit`, `npm run lint` green
- [ ] `npm run build` — a production build succeeds
- [ ] `npm run migrate:up && npm run migrate:down && npm run migrate:up` clean against a throwaway database
- [ ] Every `INCONCLUSIVE` item from the review has been converted into a command the orchestrator ran, with output recorded
- [ ] **Truthfulness assertions green**: the net-worth components still sum to the total; no surface computes a shared concept independently of `lib/netWorth.ts` / `lib/domain/`; the drift detector reports no new unexplained divergence
- [ ] No real financial data in the diff, the fixtures, the logs, or the commit message

**G4 is where the app's own quality bar becomes the build system's merge criterion.** Phase 0's exit criterion was that four non-overlapping components *provably sum* to the total. That is not a one-time achievement; it is an invariant, and the gate is what keeps it one. From the Month 7 eval harness onward (`ROADMAP.md` §5 step 17), the eval thresholds join this gate — an implementer must not be able to land a change that quietly makes the assistant worse.

---

## 8. Artifacts and layout

```
b8/app/
├── BUILD.md                       # this document
├── ROADMAP.md                     # §1–§4 inventory, §5 order of operations (gitignored — local)
├── AGENTS.md                      # GENERATED by next dev — never hand-edited
├── .claude/
│   ├── agents/                    # the four subagent definitions
│   │   ├── spec-writer.md
│   │   ├── contract-guardian.md
│   │   ├── implementer.md
│   │   └── adversarial-reviewer.md
│   ├── bin/lease                  # the G1 contract window (§13.2)
│   ├── hooks/scope-guard.mjs      # PreToolUse path enforcement
│   ├── hooks/scope-guard.test.mts
│   ├── skills/                    # uiux-promax and friends
│   └── settings.json              # hook registration
├── plan/
│   ├── QUEUE.md                   # the active queue over ROADMAP.md §5
│   └── tasks/<task-id>/
│       ├── SPEC.md                # spec-writer  (frozen at G0 by .frozen)
│       ├── CONTRACT.md            # guardian's diff + rationale (if any)
│       ├── EVIDENCE.md            # implementer's bundle + command output
│       ├── REVIEW-1.md …          # one per adversarial cycle
│       ├── NITS.md                # accumulated follow-ups
│       └── GATES.md               # gate log: decisions, commands, outputs
├── shared/ · migrations/ · db/    # the contract surface (§2)
└── lib/ · app/ · components/      # implementation
```

**A note on what is tracked.** The root `ROADMAP.md` is gitignored on purpose — it carries private career-planning notes. The pattern is unanchored, so it also swallows any `ROADMAP.md` nested below; the queue is therefore named `plan/QUEUE.md`, and is tracked. That matters: a queue file git silently ignores is exactly the class of invisible state this system exists to eliminate. The task records under `plan/tasks/` are tracked as well — they are the audit trail, and an audit trail nobody can read later is a summary. If the whole `plan/` tree should stay local, add `plan/` to `.gitignore` deliberately rather than inheriting it from a filename collision.

**Task IDs:** `P<phase>-<step>-<slug>` — e.g. `P1-11-api-v1-overview`. Phase and step are the `ROADMAP.md` §5 numbers, so a task directory always points back to the item that justified it.

**`GATES.md` is the audit trail** and is append-only. It records every gate decision, the command run, its output, and — for adjudicated disputes — the discriminating command and its result. It is the process-level analogue of this app's own append-only observation tables: the same conviction that the record of what happened is worth more than a summary of it.

---

## 9. Contract governance

### 9.1 Why a dedicated owner
The contract surface is the highest-leverage, highest-blast-radius set of files in the repo. A column's meaning ripples to every producer and consumer at once, and nothing in the type system announces when a consumer's assumption stops holding. The duplicated latest-valuation reducer is the low-grade version of this failure; the high-grade version, in an app whose entire claim is that its numbers are true, is a dashboard confidently reporting a wrong one.

### 9.2 Change classes

| Change | Class | Notes |
|---|---|---|
| New optional field / nullable column | **additive** | The default and preferred change |
| New enum-ish value (`landscape`, `valuation_mode`, `source`) | **additive** | Every consumer must handle an unknown value without crashing |
| Comment / doc only | **additive** | Still goes through the guardian: these comments carry meaning the type cannot |
| New required field / `NOT NULL` column | **breaking** | Add nullable + backfill + tighten later, strongly preferred |
| Removed or renamed field/column | **breaking** | Deprecate first: keep both, migrate consumers, then remove |
| Type change | **breaking** | |
| **Semantic change with no type change** | **breaking** | The dangerous one — see below |

**Semantic change without type change is the trap.** Redefining what a number *means* while its type stays identical silently invalidates every historical value. If "operational net worth" is redefined to include or exclude a category, every stored `net_worth_snapshots` row becomes a mixture of two definitions with nothing marking the boundary — and the trend chart, whose entire job is comparability over time, becomes a lie that renders perfectly. Where history is retained, the guardian requires a **new field name**, not a redefinition.

### 9.3 Migration history is forward-only — the hard constraint

A committed migration may already have been applied: to the dev database, to CI, to the host. Editing it makes `npm run migrate:up` on a fresh database produce a different schema than the one actually running, and the divergence is invisible until something fails against a shape that only exists in one place.

**Rule: committed migrations are immutable.** Alter forward with a new migration. The hook enforces this — a `migrations/*.sql` file tracked in git is blocked from editing even while the lease is open.

Both directions are written. CI runs up → down → up against a throwaway Postgres, because a migration that cannot be written down is a debugging trap the first time a deploy needs a rollback.

**Data corrections are not migrations.** Recategorizing rows, deleting a bad snapshot, backfilling an attribution — these are one-off operations, and the standing practice is: back up the affected rows to CSV first, then apply, then record the before/after figures in `EVIDENCE.md`. The `2026-08-07` net-worth snapshot — written mid-seeding, recording a fake $1.13M jump — is why the record matters as much as the fix.

---

## 10. Adversarial review protocol

### 10.1 Why adversarial framing is load-bearing
An agent asked to "review this code" produces a summary and mild suggestions — it pattern-matches to the review genre, in which most reviews approve. An agent asked to **disprove a specific claim** searches for counterexamples, which is a different and far more productive search. The prompt framing is the mechanism; the mandatory falsification log is what keeps it honest when nothing is found.

### 10.2 Verdict schema

```yaml
verdict: ACCEPT | ACCEPT_WITH_NITS | BLOCK
falsification_log:
  - hypothesis: "debt service is flagged from the account, so a payment leaving a checking
                 account for a manually-tracked mortgage is never counted"
    method: "read toPnlTransaction's flag resolution; traced a fixture payment on a
             non-liability account"
    result: CONFIRMED        # REFUTED | CONFIRMED | INCONCLUSIVE
findings:
  - severity: BLOCK | NIT
    file: lib/domain/propertyPnl.ts
    line: 88
    claim: "debt service resolved from the account alone; the flag and the payment stream can
            live on different accounts"
    failure_scenario: "manual mortgage account holds the balance; payments leave from trust
                       checking ⇒ debt service reads $0 and NOI is overstated by the full
                       annual payment, while cash flow stays correct and hides it"
    contradicts: "SPEC.md acceptance #3"
scope_violations:
  - "adds a category filter to the ledger — SPEC non-goal #2"
```

`INCONCLUSIVE` matters: it marks what the read-only reviewer could not settle, and the orchestrator converts each into a command it runs at G4. This is how the reviewer's lack of Bash is compensated rather than ignored.

### 10.3 Domain hunt list

Generic review misses what actually breaks a finance app. **Every row below is a defect class this repo has already shipped**, which is why the reviewer is prompted to hunt them by name.

| Hazard | Why it matters here |
|---|---|
| **Sign inversion** | The same mortgage payment is negative on a loan account and positive on checking. An unconditional negate is right for one and turns a mortgage into rental income for the other. This bug was one line from shipping *inside the fix for another bug*. |
| **A number that is right for the wrong reason** | Gastonia's cash flow was correct through all three of its bugs, because the payment is subtracted either way. A correct total is not evidence of a correct decomposition. Read the middle of the statement. |
| **Missing exclusion filters** | `hidden` and `exclude_from_budget` are different flags. Filtering only the first let a $3,120 internal transfer read as rental income. |
| **JOIN where EXISTS was needed** | `budget_categories` is `UNIQUE(name, landscape)` and `mapped_category` is not an FK, so a name in both landscapes double-counts through a JOIN. |
| **Stale "latest" reads** | The observation tables are append-only; "current value" is a derived read. A last-row-wins shortcut works by accident until a query gains an `ORDER BY`, then silently reports a stale valuation as current. |
| **Float artifacts** | `2968.7000000000003`. `NUMERIC(14,2)` compared against an unrounded JS number compares unequal forever — that once appended a spurious balance row on every sync run. |
| **`null` rendered as `0`** | An unvalued property shows "—". A wrong zero looks like an answer. |
| **Two definitions of one concept** | `lib/netWorth.ts` is shared by the dashboard and the scheduler *specifically* so they cannot disagree about what net worth means. Any new surface recomputing a shared concept independently is this defect, whatever its tests say today. |
| **Ledger vs. P&L confusion** | The ledger keeps transfers; the P&L drops them. Funding a property's account is not income, but it *is* a movement of its cash. Conflating them breaks either reconciliation or the income statement. |
| **Attribution scope** | `COALESCE(t.property_id, a.property_id)` — an explicit tag wins, the account supplies the default, NULL means *inherit*. Code that treats NULL as *unattributed* silently drops rows; code that attributes by category charges a primary-residence repair to a rental. |
| **Real data leakage** | Real balances or account numbers in fixtures, logs, commit messages, or screenshots. |
| **Server/client boundary** | Next 16. A server-only import reaching a client component, or a `use client` file importing `lib/db.ts`. |
| **Non-deterministic tests** | Wall clock, unseeded random, dev-database state, ordering assumptions. |
| **Silently swallowed errors** | Some paths are best-effort *by design* (balance recording must never cost a transaction sync). A bare catch anywhere else turns a broken sync into a silently missing observation. |

---

## 11. Loop control and escalation

| Condition | Action |
|---|---|
| G2 fail | → implementer, `cycle++` |
| G3 BLOCK | → implementer with findings, `cycle++` |
| G3 empty falsification log | → **reviewer**, cycle **not** incremented |
| G4 fail | → implementer, `cycle++` |
| `cycle == 3` | **stop. escalate to human** with all artifacts |
| Contract flaw found mid-implementation | → G1, lease reopens, `cycle` reset |
| Spec proves unfalsifiable | → spec-writer, task restarts at G0 |

**Three cycles, then a human.** Convergence failure after three attempts is almost never an implementation problem — it is an unclear spec or a wrong shape, and further iteration burns tokens while amplifying a hidden misunderstanding. The escalation packet is the whole task directory, which is already complete because every gate wrote to `GATES.md`.

**The reviewer-fault path exists so the cycle count means something.** Charging the implementer for a lazy review would make the counter measure the wrong thing and quietly punish the role that did its job.

---

## 12. Parallelism and isolation

Multiple implementers may run concurrently **only** when tasks are contract-disjoint and file-disjoint. The orchestrator verifies disjointness from each spec's contracts-touched and declared surface before dispatch, records the check in `plan/QUEUE.md`'s parallelism ledger, and serializes overlapping tasks.

Parallel implementers run with `isolation: "worktree"` — each gets its own git worktree, so concurrent edits cannot interleave, and a task abandoned mid-flight leaves no debris in the main tree.

**This repo has already paid for the alternative.** Phase 0 ran `phase0/properties` and `phase0/valuation-entry` as unmerged parallel branches, and the cost was recorded honestly at the time: a deliberately duplicated reducer to avoid a cross-branch dependency, and a mortgage-link dropdown that showed zero candidates until the branches met. Both were reasonable calls under the constraint. The constraint is what §12 exists to avoid re-creating.

**Not parallelizable:** contract changes (single-writer, I2 — and the lease physically permits only one at a time), and G4, which is inherently whole-repo. A phase containing several contract-touching tasks serializes at the guardian, accepted deliberately: contract throughput is not the bottleneck, and contract correctness is the highest-value property in the system.

Spec-writing parallelizes freely — it is read-only and produces no repo state. Batch-specifying a phase's tasks up front is the cheapest way to surface dependency edges early.

---

## 13. Enforcement mechanics (Claude Code)

### 13.1 Agent definitions
`.claude/agents/*.md`, frontmatter carrying `name`, `description`, `tools`, `model`. The `description` drives dispatch, so it states *when* to use the agent, not merely what it is.

### 13.2 Path scoping requires a hook — tool grants are not enough

**The critical implementation detail.** A `tools:` allowlist grants *tools*, not *paths*. `contract-guardian` with `tools: Read, Edit` may edit **any** file; "contract surface only" is a prompt instruction, and prompt instructions are not enforcement. Likewise nothing stops `implementer` from editing `migrations/` despite I2.

`.claude/settings.json` registers a `PreToolUse` hook on `Edit|Write|NotebookEdit|Bash` that inspects the target path and blocks on violation:

- **Generated output** (`.next/**`, `node_modules/**`, `next-env.d.ts`, `tsconfig.tsbuildinfo`, `package-lock.json`) — blocked for everyone; `npm ci` / `next build` are recognised as the sanctioned producers.
- **Contract surface** (§2) — blocked unless a contract lease is open.
- **Committed migrations** — blocked always, lease or not (§9.3).
- **`plan/tasks/<id>/SPEC.md`** — blocked once `.frozen` exists.

**Bash is matched too.** The implementer holds Bash, so `sed -i`, `>`, `tee`, and `cp` are a live bypass of any Edit/Write-only rule. Mutation is detected *bound to the target path* — "the command mentions a protected path AND contains a redirect somewhere" is far too coarse and blocks read-only commands that happen to carry a `2>/dev/null`.

**Why a lease rather than agent identity.** The `PreToolUse` payload carries no stable subagent identifier, so "is the caller contract-guardian?" is not a question the hook can answer. The orchestrator opens a lease immediately before dispatching the guardian and closes it when G1 passes:

```
.claude/bin/lease open <task-id>    # begin the G1 window
.claude/bin/lease close             # end it — contracts frozen for implementation
.claude/bin/lease status
```

The lease is therefore not a workaround — it *is* the §6 contract freeze made mechanical, and it is auditable because it leaves a log.

**Hook changes require both a true-positive and a false-positive test case.** `.claude/hooks/scope-guard.test.mts` carries both for every rule. A guard whose tests are all single-purpose — none combining a protected path with unrelated shell plumbing — ships a false positive that blocks the orchestrator's own gate commands, which is a strictly worse outcome than no guard at all, because it fails in the middle of a run rather than at review.

The hook is registered in `vitest.config.mts`'s include list deliberately: a load-bearing guard that CI does not exercise is one nobody notices breaking.

### 13.3 Dispatch
The orchestrator dispatches via the Agent tool with `subagent_type` naming the role. Subagents start cold: **every dispatch must carry the full task context** — spec path, contract state, prior review findings. A subagent cannot see the orchestrator's conversation, and a dispatch that assumes shared context produces confidently wrong work. Pass paths, not summaries; the agent should read the artifact itself.

---

## 14. Worked example — `P1-11-api-v1-overview`

`ROADMAP.md` §5 step 11: *`GET /api/v1/overview` — single-round-trip dashboard payload; the web dashboard adopts it too.*

**spec-writer → SPEC.md** *(abridged)*
- **Goal:** one authenticated request returns everything the dashboard renders — net worth decomposed into its four components, the current-year budget summary, and sync health — and the dashboard reads that payload instead of issuing its own queries.
- **Non-goals:** no auth (step 12); no caching; no change to how any figure is *computed*.
- **Contracts touched:** `shared/contracts/overview.ts` — new zod contract. Additive.
- **Conventions:** liabilities negative in the total, positive in the `liabilities` component (the component is a magnitude, the total is signed); amounts as strings to survive JSON without float drift; `null` for an unvalued property, never `0`.
- **Acceptance commands:**
  1. `npx tsc --noEmit` → exit 0
  2. `npm test` → `252 passed`
  3. `npx vitest run app/api/v1/overview/route.test.ts` → `7 passed`, against a throwaway DB with fabricated data
  4. A route test asserting the four components sum to `total` for a fabricated portfolio containing one valuation liability, one ledger account, and one unvalued property
  5. A route test asserting an unvalued property serializes `equity: null`, not `0`
- **Failure modes to test:** double-counting a property-linked mortgage in both `liabilities` and `realEstateEquity`; the unvalued property collapsing to zero; float drift on the sum; the payload omitting an account class the dashboard renders.

**G0.** The orchestrator confirms the route path and test harness pattern exist, checks command 4 would catch a stub (a handler returning zeros fails the sum assertion only if the fixture has non-zero components — it does), and adds the negative control for #5. **PASS.** `touch .frozen`.

**G1.** `lease open P1-11-api-v1-overview`. The guardian adds the zod contract, derives it from `shared/types.ts` rather than restating shapes, and notes in `CONTRACT.md` that amounts are strings *because* `NUMERIC` values that round-trip through JSON floats are exactly the artifact the money-math discipline exists to prevent. `tsc` clean, no migration. **PASS.** `lease close`.

**implementer.** Writes the handler, 7 route tests against a throwaway DB, and switches the dashboard to the payload. Runs all five commands; captures output into `EVIDENCE.md`.

**G2.** The orchestrator re-runs all five independently. All pass. **PASS.**

**adversarial-reviewer.** Six hypotheses. Five refuted. One **CONFIRMED**:

> `hypothesis:` the handler computes net worth from its own queries rather than calling `getNetWorth()`, so the endpoint and the scheduler can disagree about what net worth means.
> `failure_scenario:` a future task changes how a component is classified in `lib/domain/netWorth.ts`; the dashboard (now reading the endpoint) and `net_worth_snapshots` (written by the scheduler through `lib/netWorth.ts`) diverge. The trend chart plots one definition, the hero card shows another, both render perfectly, and nothing fails.
> `contradicts:` SPEC non-goal #3 — "no change to how any figure is computed" — which the handler violates by *re-implementing* a computation it was supposed to reuse.

Every acceptance command passed. The sum assertion passed *because both definitions were identical on the day it was written*. **G3 BLOCK → implementer, cycle 1.**

Fix: the handler calls the existing composer. The reviewer's scenario becomes an eighth test asserting the endpoint and `writeNetWorthSnapshot()` produce the same total from the same fixture. Re-run G2 ✓. Second review: 5 hypotheses, all refuted, **ACCEPT**.

**G4.** Full suite green; `npm run build` succeeds; migrate round-trip clean (no migration in this task, run anyway); the truthfulness assertion — components sum to total — green from two independent surfaces. **PASS → MERGED.**

**What the example demonstrates.** The reviewer found a defect that every acceptance command passed over, because the spec's fixture encoded the same blind spot as the implementation: it checked that the numbers summed, not that there was only one definition of them. That is precisely the class of bug a self-reviewing agent cannot find — it shares the misconception. The cost was one extra cycle; the alternative was rebuilding the four-totals bug that `lib/netWorth.ts` was extracted to prevent.

---

## 15. Measuring the build system

`ROADMAP.md` §4 refuses to accept that an AI feature helped without an eval. The same standard applies here — otherwise this document is exactly the unmeasured-AI-hand-waving it was written to avoid. Derived from `GATES.md` across tasks:

| Metric | Reads as |
|---|---|
| **Gate-catch distribution** (G0/G1/G2/G3/G4) | Where defects are actually caught. G3-heavy ⇒ specs are too weak. G4-heavy ⇒ acceptance commands are too narrow. |
| **Adversarial yield** — BLOCKs per review | The reviewer's value. Trending to zero means it has gone sycophantic (or specs got better — disambiguate by spot-checking merged code). |
| **Escape rate** — defects found after merge | The only outcome measure that matters. Every escape is traced to the gate that should have caught it, and that gate is amended. |
| **Cycles to ACCEPT** | Spec quality. Rising ⇒ spec-writer is underspecifying. |
| **Contract churn** — breaking changes per phase | Rising ⇒ domain modelling is being deferred into implementation. |
| **Reviewer-fault rate** | Empty falsification logs. Non-trivial ⇒ tighten the reviewer prompt or raise its model. |

**Amendment rule:** every post-merge escape must produce either a new gate check or a strengthened acceptance-command convention, recorded below with the escape that caused it, so a future reader can judge whether the amendment was proportionate rather than taking it on faith.

### Amendments applied

| # | Amendment | Where it lives now | Escape that produced it |
|---|---|---|---|
| A0 | Specs declare a **Toolchain prerequisites** table; the orchestrator verifies every row before passing G0 | §7.1 · `plan/tasks/.templates/SPEC.md` | Inherited. A spec-writer with Read/Grep/Glob cannot interrogate a toolchain, so the check had to move to the orchestrator |
| A1 | **Every rule stated in prose carries a negative control at spec time** | §7.1 · SPEC template | Inherited, and independently earned here: "transfers are excluded from the P&L" was true in prose and false in the query, because the filter caught `hidden` and not `exclude_from_budget` |
| A2 | **Causal-claim rule** — no disposition recorded as "verified" unless the causal claim behind it was run as a command | §5.1 | Gastonia's $0 debt service. The obvious cause ("the account isn't flagged as a liability") was wrong; the account was correct all along |
| A3 | **Hook changes require both true-positive and false-positive test cases** | §13.2 · `scope-guard.test.mts` | Inherited. A guard whose tests were all single-purpose blocked the orchestrator's own gate commands over an unrelated `2>/dev/null` |
| A4 | **Specs state sign, rounding, landscape/exclusions, and null semantics explicitly** | §7.1 · SPEC template §"Conventions" | The Gastonia sign trap: the same payment is negative on a loan account and positive on checking, and a spec that says "negate the payment" is correct for exactly one of them |
| A5 | **contract-guardian holds `Write`, not `Edit` alone** | §4 roster · `.claude/agents/contract-guardian.md` | Caught at the first real G1 dispatch (P0-09a): the grant was ported from a system whose schemas were always amended in place. Every b8 migration is a new file, and `Edit` cannot create one — the role was unable to perform its only job |
| A6 | **The orchestrator does not change the test suite while a task is in flight.** A frozen spec's numeric baselines (`N passed`) are invalidated by any edit to what the suite runs, including the orchestrator's own build-system work. Either freeze the suite for the task's duration, or expect to adjudicate the literal and verify the substantive requirement another way | §7.3 · this amendment | P0-09a G2: the spec froze with `290 passed` derived from a 282 baseline; the orchestrator then added 8 hook tests while fixing PD-1, so the tree produced 298. The implementer had added exactly the 8 tests required and was, by the literal gate, failing |
| A7 | **When a spec's acceptance commands cannot reach the production wiring (no database, pure-function tests only), it must pin that wiring with a static check.** A grep asserting the literal the wiring depends on is cheap, mechanical, and discriminates — the alternative is a gate that passes while the feature is wired to the wrong thing | §7.1 checklist · §7.5 | P0-09a G3/G4: the reviewer noticed by reading that `lib/netWorth.ts:95`'s kind filter was covered by nothing. Mutation-tested: changing it to `'last_month_rent'` — making last month's rent reduce net worth and deposits stop counting, contradicting the owner's decision — left all 11 acceptance commands and all 298 tests green |

**A2 has the widest blast radius and the weakest natural defence.** It is the rule most likely to be quietly skipped, because skipping it always *feels* like efficiency: the conclusion is usually right, and only the reason is wrong. The cost lands one or two tasks later, on someone re-deriving a fix aimed at the wrong object.
