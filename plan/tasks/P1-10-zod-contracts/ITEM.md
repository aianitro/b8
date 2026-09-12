# Roadmap item — P1-10-zod-contracts

**Lineage:** ROADMAP.md §5 Phase 1, step 10 — the phase's first step. Orchestrator's reading.

> 10. **zod contracts** in `shared/contracts/` (npm workspaces conversion: `apps/web`,
> `apps/mobile` placeholder, `packages/contracts`); migrate routes to `/api/v1/*` incrementally,
> old routes proxying until the web UI is switched. (M)

**Position.** Phase 0.5 is closed — steps 28–33 merged, and step 33's owner handoff discharged
2026-09-11 (SMTP configured, first alert delivered, suppression confirmed against a real provider).
`plan/QUEUE.md` had this task as `BLOCKED — Phase 0.5 precedes Phase 1 (§5)`, and Phase 0.5's
standing rule — *"If it is underway, Phase 1 has not started"* — is now satisfied rather than
waived.

*Phase exit (§5): `curl` with a bearer token returns everything the dashboard needs; UI fully on v1.*
That exit belongs to steps 10–13 together. This step owns the contract, not the auth and not the
endpoint.

## What makes this step categorically different from everything in Phase 0 and 0.5

**Every prior task changed behavior inside a fixed repo layout. This one changes the layout.**

The blast radius of a Phase 0.5 task was a module and its consumers, and `tsc` found the consumers.
Here the numbers are: **61 files import `shared/types.ts`**, and there are **27 route handlers**
under `app/api/`. A workspaces conversion changes how every one of those 61 imports *resolves*,
which is a different failure class from changing what they resolve *to* — a resolution error is
loud, but a resolution that silently picks up a stale duplicate is not, and this repo has already
lost a day to exactly that (`plan/QUEUE.md` H1: a Finder duplicate that `node-pg-migrate`'s glob
applied ahead of the real migration).

## The orchestrator's sizing concern, recorded before the spec is written

As written, step 10 bundles **three separable changes** behind one (M):

1. **zod schemas in `shared/contracts/`** — the contract surface proper. Guardian's work under
   §9.2, and the only part of the three that is a *contract* change at all.
2. **npm workspaces conversion** — `apps/web`, `apps/mobile` placeholder, `packages/contracts`.
   Semantically null and structurally total. Changes no behavior and every import path.
3. **`/api/v1/*` migration with old routes proxying** — 27 handlers, incrementally, with a
   double-surface period during which both paths must stay correct.

Any one of these is plausibly (M) on its own. Together they are not, and the failure mode is
specific rather than vague: §11 escalates at **3 implementer↔reviewer cycles**, and a diff spanning
61 files plus a resolution-graph change plus 27 handlers gives a reviewer a very large surface on
which to find one CONFIRMED defect per cycle. Burning the escalation budget on scope is the worst
way to spend it.

**BUILD.md's own worked example is evidence for splitting.** §14 specifies `P1-11-api-v1-overview`
against **`shared/contracts/overview.ts`** — not `packages/contracts/overview.ts`. The document that
defines this process assumes the zod contracts exist at `shared/contracts/` *without* the workspaces
conversion having happened. The parenthetical in §5 is a note about where this eventually lands for
Phase 3 step 23's Expo client, not a prerequisite for the schemas themselves.

**Disposition:** this task is scoped to (1). The workspaces conversion and the `/api/v1/*` migration
are recorded as successors rather than dropped; they get their own queue entries when this task
reaches G4, so the split is visible in `plan/QUEUE.md` rather than living only here.
The spec-writer is instructed to non-goal (2) and (3) explicitly, because the reviewer enforces
non-goals as defects and an unstated boundary here is the difference between a reviewable diff and
an unreviewable one.

## A defect this step must not freeze into the contract

`shared/types.ts` declares `ControlMode = 'fixed' | 'discretionary' | 'variable-necessary'`.
`db/schema.sql` enforces the same three values with a CHECK constraint and
`NOT NULL DEFAULT 'fixed'`. **`PATCH /api/categories` accepts neither.** Its handler branches on
`is_income`, `annual_budget`, `dedicated_account_id`, `monthly_amounts`, and `name`, and falls
through to `INVALID_INPUT` for anything else — so the field is readable through `GET` and
unwritable through the API.

Verified 2026-09-11, and it is not cosmetic: only `discretionary` is scored, the default is `fixed`,
and step 33's alert fires off the scored set. A category created through the UI is therefore born
invisible to the guardrail, with no in-app way to fix it. The data is correct today only because all
21 operational budgeted categories were classified out-of-band (`0` rows with a wrong-by-default
classification at the time of writing).

This matters *here* specifically because a contract derived from the current handler's accepted
input shape would encode the omission as the specification. **Whether step 10 closes the gap or
merely refuses to ratify it is a scope question for the spec**, not a thing to leave to whichever
fixture the implementer sees first. It is named here so the spec must answer it.

## Contracts touched — expected

`shared/contracts/**` (new), `shared/types.ts` (its declarations become inferred re-exports).
**No migration, and no `db/schema.sql` change** — this step introduces a runtime validator for
shapes the database already constrains; it does not change what the database will accept. If the
spec finds it needs a migration, that is a signal the scope has drifted back into (2) or (3).

## Open question for the spec, not for the implementer

`ApiResponse<T>` is a discriminated union used by all 27 handlers and 61 importers. A zod schema for
a *generic* envelope is the one place in this conversion where the obvious translation is awkward,
and the awkwardness is where a shortcut gets taken. The spec states what must be observably true of
the envelope; it does not get to say "leave it as a TypeScript type for now" without a negative
control proving the routes still validate their payloads.
