# plan/QUEUE.md — the active queue

The idea inventory and the strategic ordering live in the root **`ROADMAP.md`** (§1–§4 are the
inventory, §5 is the order of operations). This file is deliberately thin: it is the
orchestrator's working queue over §5, nothing more. Duplicating §5 here would create a second
definition of "what's next" — the exact defect class `BUILD.md` exists to prevent.

**Task IDs:** `P<phase>-<step>-<slug>`, where phase and step are the root ROADMAP.md §5 phase
and step numbers — e.g. `P1-11-api-v1-overview` is Phase 1, step 11. Phase-prefixed so the
roadmap's shape stays legible in the filesystem, step-numbered so a task always points back to
the item that justified it.

## Queue

> **Ordering note, 2026-09-15.** Step 13 is done, so every numbered step in Phase 1 has shipped —
> but the PHASE EXIT has not been met: *"curl with a bearer token returns everything the dashboard
> needs; UI fully on v1"* still needs `P1-10b` (27 handlers) and `P1-11a` (the dashboard's adoption).
> The owner has also questioned whether that exit is worth meeting for a family-only app; the
> answer depends on whether the career track in ROADMAP.md §0 is still live, and **no decision has
> been recorded either way**. Do not dispatch `P1-10b` or `P1-11a` until it is.
>
> **Ordering note, 2026-09-13 — superseded the same day.** A Phase 0.6 was proposed ahead of
> Phase 1's tail and **withdrawn before any task was dispatched**: four of its five steps did not survive
> being checked against the database, and the fifth (budget versioning) went to `ROADMAP.md`'s backlog at
> low priority. The withdrawal and what killed each step are recorded there. **Phase 1's tail — steps 12
> and 13 — is next**, with `P1-10a`, `P1-10b` and `P1-11a` unblocked and runnable in parallel where
> contract- and file-disjoint; record the check in the parallelism ledger before dispatching.

> **Ordering note, 2026-09-01.** `ROADMAP.md` §5 gained **Phase 0.5** (the budget turn, steps
> 28–33) ahead of Phase 1 on the same day. This queue had `P1-10-zod-contracts` as next; that
> entry predated the amendment. Phase 0.5 closes with *"This phase is added ahead of Phase 1, not
> alongside it. If it is underway, Phase 1 has not started."* — so every Phase 1 task is blocked
> until Phase 0.5 completes. Recorded here because a stale queue that merely looks current is the
> failure this file's preamble warns about.


| Task ID | ROADMAP §5 step | Status | Depends on | Contracts touched |
|---|---|---|---|---|
| P0-09a-tenant-held-funds | Phase 0, addendum to step 9 ([ITEM.md](tasks/P0-09a-tenant-held-funds/ITEM.md)) | **MERGED** 2026-09-01 (G0–G4 ✅, 0 cycles) | — | `shared/types.ts`, `migrations/**`, `db/schema.sql` |
| P0.5-28-category-control-mode | Phase 0.5, step 28 ([ITEM.md](tasks/P0.5-28-category-control-mode/ITEM.md)) | **MERGED** 2026-09-01 (G0–G4 ✅, 0 cycles) | — | `shared/types.ts`, `migrations/**`, `db/schema.sql` |
| P0.5-29-adherence-definition | Phase 0.5, step 29 ([ITEM.md](tasks/P0.5-29-adherence-definition/ITEM.md)) | **MERGED** 2026-09-01 (G0 ✅ G1 SKIP G2–G4 ✅, 0 cycles) | P0.5-28 (merged) | expected none — G1 skipped unless the spec finds otherwise |
| P0.5-29a-headline-scope | Phase 0.5, addendum to step 29 ([ITEM.md](tasks/P0.5-29a-headline-scope/ITEM.md)) | **MERGED** 2026-09-01 (G0 ✅ G1 SKIP G2 ✅ G3 ✅ G4 ✅, 1 cycle) | P0.5-29 (merged) | **none** — verified: no importer of `scoredHeadline`/`ScoredHeadline` outside its own test |
| P0.5-30-in-month-pacing | Phase 0.5, step 30 ([ITEM.md](tasks/P0.5-30-in-month-pacing/ITEM.md)) | **MERGED** 2026-09-02 (G0 ✅ G1 SKIP G2 ✅ G3 ✅ G4 ✅, 1 cycle) | P0.5-29 (merged), P0.5-29a (merged) | expected none — G1 skips unless the spec finds otherwise |
| P0.5-31-dashboard-repoint | Phase 0.5, step 31 ([ITEM.md](tasks/P0.5-31-dashboard-repoint/ITEM.md)) | **MERGED** 2026-09-02 (G0 ✅ G1 SKIP G2 ✅ G3 ✅ G4 ✅, 0 cycles). **Both owner handoffs discharged 2026-09-11.** A1: `docs/screenshots/dashboard.jpg` and `net-worth.jpg` recaptured from `seed-demo.mjs` against a scratch `b8_demo`, so the destructive backup/restore sequence §5.1 escalated was never performed on the real database. N51: `control_mode` is now writable through `POST`/`PATCH /api/categories` and editable per row on `/categories` | P0.5-29a (merged), P0.5-30 (merged) | expected none — G1 skips unless the spec finds otherwise |
| P0.5-32-coverage-bound | Phase 0.5, step 32 ([ITEM.md](tasks/P0.5-32-coverage-bound/ITEM.md)) | **MERGED** 2026-09-03 (G0 ✅ G1 SKIP G2 ✅ G3 ✅ G4 ✅, 2 cycles) | P0.5-31 (merged) | expected none — G1 skips unless the spec finds otherwise |
| P0.5-33-delivery-channel | Phase 0.5, step 33 ([ITEM.md](tasks/P0.5-33-delivery-channel/ITEM.md)) | **MERGED** 2026-09-04 (G0 ✅ G1 ✅ G2 ✅ G3 ✅ G4 ✅, 1 cycle). **Owner handoff discharged 2026-09-11**: Gmail SMTP configured in `.env.local` (587, STARTTLS required) and the first send made through `runBreachAlert` — `alert_sends` id 1, `delivered = true`, `failure_reason` NULL. A second call logged `already delivered, suppressed` and wrote no row, so F19 suppression is confirmed against a real provider | P0.5-32 (merged) | `migrations/**`, `db/schema.sql` — new `alert_sends` table, additive; lease opened and closed |
| P1-10-zod-contracts | 10 ([ITEM.md](tasks/P1-10-zod-contracts/ITEM.md)) | **MERGED** 2026-09-12 (G0 ✅ 3 spec cycles · G1 ✅ 2 cycles · G2 ✅ · G3 ACCEPT_WITH_NITS · G4 ✅, **0 implementer cycles**). Scoped to the zod schemas only — the workspaces conversion and the `/api/v1/*` migration were non-goals with their own scope commands and are now successors. 6 nits in [NITS.md](tasks/P1-10-zod-contracts/NITS.md); **N4 must be read before step 11** — a real `db.query` row fails `AccountSchema` on two keys, not the one disclosed, and two of the seven shapes have no `Response.json` producer at all | — | `shared/contracts/**` (new), `shared/types.ts` (comment-only), `package.json` |
| P1-11-api-v1-overview | 11 ([ITEM.md](tasks/P1-11-api-v1-overview/ITEM.md)) | **MERGED** 2026-09-13 (G0 ✅ 2 spec cycles · G1 ✅ · G2 ✅ · G3 ACCEPT_WITH_NITS after 2 BLOCKs · G4 ✅, **2/3 implementer cycles**). Endpoint only — the dashboard's adoption is [P1-11a](#), split by the spec. Both G3 blocks were the same defect class: the scratch-database guard reading a connection-string field differently from the client that would connect through it. 8 nits in [NITS.md](tasks/P1-11-api-v1-overview/NITS.md); **N1 must be read before P1-11a** — `allPaces` is absent from the payload, so the dashboard's lead widget cannot be fed without a twelfth section and a contract amendment | P1-10 (merged) | `shared/contracts/overview.ts` (new), additive |
| P1-13-chat-rate-limit | 13 | **MERGED** 2026-09-15 — built directly rather than through the gates: (S), no contract surface, no migration, no money arithmetic, which is the BUILD.md §15 A8 tier-down. In-memory token bucket per session plus a global bucket and a **daily ceiling**. The ceiling is not in the roadmap line and is the half that does the stated job: `runAgentLoop` makes up to five model calls per request, so a bucket alone permits ~72,000 model calls a day. **Landed on `/api/chat`, not `/api/v1/chat`** — the endpoint has not been migrated yet; it travels with the route under `P1-10b`. Verified by driving the real handler with `ANTHROPIC_API_KEY` unset, so allowed requests stop at the key check and cost nothing: 12 through, 13th refused 429 with `Retry-After: 8`, and a second session unaffected | P1-12 (merged) | none |
| P1-12a-mobile-tokens | Phase 1, step 12's deferred third part ([ITEM.md](tasks/P1-12a-mobile-tokens/ITEM.md)) | **DESIGNED 2026-09-17, not yet specced.** Two decisions taken by the owner: the phone signs in with the PASSKEY ceremony that already exists (no second credential path), and there is **one opaque revocable token with a sliding expiry, not access+refresh** — that pattern buys revocation without per-request lookups, and this app already does per-request lookups. **ROADMAP.md §5 step 12 amended to match** rather than left describing a design nobody built. A phone session and a script's personal token are deliberately different kinds sharing one table. **Blocked on step 19**: passkeys bind to a domain, so the tailnet host must exist, be named in `PRIMARY_RP_ID`, and serve the associated-domains files before a phone can register at all. **Full ceremony and `/security-review` when it runs**, as P1-12 had — it widens who may reach the app | P1-12 (merged), **step 19 (hardware)** | `migrations/**`, `db/schema.sql`, `shared/contracts/auth.ts` |
| P1-11b-ui-on-v1 | Phase 1, the other half of step 10's exit | **MERGED** 2026-09-17 — every UI call site moved to `/api/v1/**` (78 references across 50 files, replaced only for the eleven migrated segments so `proxy.ts`'s genuine `/api/` prefix test was never touched). **The compatibility rewrite is deliberately NOT removed yet.** A grep says nothing calls an old path, but a grep is static and the browser could not be exercised from the session that made the change, so `proxy.ts` now WARNS when a legacy path is used. Remove the rewrite, the `MIGRATED_SEGMENTS` list and the `LEGACY_API` watch together once normal use has logged nothing | P1-10b (merged) | none |
| P1-11a-dashboard-adopts-overview | Phase 1, split from step 11 | QUEUED — rewrite `app/dashboard/page.tsx` (691 lines, ten queries) to consume `GET /api/v1/overview`. **Read NITS.md N1 first**: the payload is missing `allPaces`, which the lead widget needs. Also N7 (`today.totalCount` ranges wider than `today.spent` in the running code) | P1-11 (merged) | likely `shared/contracts/overview.ts` |
| P1-12-passkey-auth | 12 ([ITEM.md](tasks/P1-12-passkey-auth/ITEM.md)) | **MERGED** 2026-09-14 (G0 ✅ 2 spec cycles · G1 ✅ · G2 ✅ · security-review CLEAN · G3 ACCEPT_WITH_NITS · G4 ✅, **0 implementer cycles**). All 28 routes and every page now require a server-verified session; five pre-auth surfaces allowlisted. Registration is open only while zero credentials exist — the race is closed in the schema by a partial unique index, **verified by executing it**. 6 nits in [NITS.md](tasks/P1-12-passkey-auth/NITS.md); **N1 is a control that stopped measuring its rule after the diff added a second file satisfying it** — a new sub-shape of the class A10 catches at G0 only. **Owner action outstanding: nobody has confirmed a real passkey works in a real browser; must run on port 3000** | P1-11 (merged) | `migrations/**`, `db/schema.sql`, `shared/contracts/auth.ts` (new) |
| P1-10a-workspaces | Phase 1, split from step 10 ([ITEM.md](tasks/P1-10-zod-contracts/ITEM.md) §sizing) | QUEUED — the npm workspaces conversion (`apps/web`, `apps/mobile`, `packages/contracts`), a non-goal of P1-10. Semantically null, structurally total: changes no behaviour and every import path | P1-10 (merged) | every contract path moves |
| P1-10b-api-v1-routes | Phase 1, split from step 10 | **MERGED** 2026-09-17 — built directly, not through the gates: a file move plus one config rule, no contract, no migration, no money arithmetic (§15 A8). All 27 handlers now live under `/api/v1/**`; the old paths are kept alive by a single Next REWRITE over eleven enumerated segments rather than 27 shim files or a wildcard that could loop. **The UI still calls the old paths** — switching it is the remaining half of Phase 1's exit and is deliberately separate, because it breaks in a browser this session cannot sign in to. Verified by the build's route table (33 routes present), by executing the compiled rewrite regex against eight paths, and by both suites. **The obvious check was worthless and is recorded as such**: `proxy.ts` answers 401 before Next resolves a route, so a missing path and a present one are indistinguishable over HTTP without a session | P1-10 (merged) | none |

Status: `QUEUED` → `SPEC` → `G0` → `G1` → `IMPL` → `G2` → `REVIEW` → `G3` → `G4` → `MERGED`,
or `ESCALATED` when the cycle counter hits 3.

## Parallelism ledger
<!-- Two tasks may run concurrently only if they are contract-disjoint AND file-disjoint
     (BUILD.md §12). Record the disjointness check here before dispatching in parallel. -->

| Tasks | Contract overlap | File overlap | Verdict |
|---|---|---|---|

## Holds — things blocking a dispatch, recorded rather than carried in someone's head

**H1 — RESOLVED 2026-09-01, and it had a sibling that was worse.** Both load-bearing Finder/iCloud
duplicates are quarantined outside the repo (reversible; untracked, so no tracked file changed).
`lib/domain/adherence.test 2.ts` was the one predicted below. The one **not** predicted:
`migrations/1788271200000_category-control-mode 2.sql`, which broke `npm run migrate:up` on any
fresh database — `node-pg-migrate` globs the directory, applied the duplicate first, and the real
migration then collided on `control_mode`. Found at P0.5-29a's G4, causation proven against a
scratch copy before acting. **The T4 judgement that the remaining duplicates were "not load-bearing:
nothing compiles the rest" was wrong**, because a glob is not a compile. Eight remain
(`lib/domain/adherence 2.ts` + seven markdown under `plan/`); neither class is reachable by a glob
that matters, measured for those two classes rather than assumed for all.

**H1 (original text) — `lib/domain/adherence.test 2.ts` is inside the tsconfig program (P0.5-29a T4).** A Finder/
iCloud byte-identical duplicate, untracked, that imports `./adherence` and calls the *old*
`scoredHeadline(findings)` signature at lines 488/496/509 and reads `findingCount` at line 500.
It typechecks today only because the signature it targets still exists; the moment P0.5-29a lands,
`npx tsc --noEmit` — acceptance #1 — goes red on a file nobody edited. Measured:
`npx tsc --noEmit --listFiles | grep -c "adherence.test 2.ts"` → `1`. It must read `0` before the
implementer is dispatched. The spec assigns this to the orchestrator explicitly, so that the
implementer cannot "resolve" it by editing the duplicate or by weakening acceptance #1.

Resolution options, and their cost: **(a)** move it out of the tree (reversible, changes no tracked
file, keeps acceptance #30 at `0`); **(b)** add it to `tsconfig.json`'s `exclude` — but that
modifies a tracked file and would make acceptance #30 return `1`, failing the scope check, unless
committed ahead of the task. **(a) is the recommendation, and it needs the owner's go-ahead**
because the file is theirs. Eleven further ` 2.` duplicates exist in the tree; only this one is
load-bearing.

**H2 — the scope-guard hook is not active when the session root is `b8/` rather than `b8/app/`.**
`app/.claude/settings.json` registers `PreToolUse` as
`node "$CLAUDE_PROJECT_DIR/.claude/hooks/scope-guard.mjs"`. With the session rooted at `b8/`,
`$CLAUDE_PROJECT_DIR` is `b8/`, and `b8/.claude/hooks/scope-guard.mjs` does not exist (verified:
`b8/.claude/` holds only `settings*.json`, and its `settings.json` declares no `PreToolUse`).
So for any session started above `app/`: the contract lease is advisory, committed migrations are
unprotected, and `.frozen` does not actually freeze a spec — BUILD.md §13.2's own point, that a
`tools:` allowlist grants tools and not paths and that prompt instructions are not enforcement,
applies to the registration path too. **P0.5-29a's spec is frozen by convention right now, not by
mechanism.** Run delivery sessions from `b8/app`, or make the hook path robust to being rooted a
level up.

**H3 — the project's agent roster does not load from a session rooted at `b8/`.**
`app/.claude/agents/{spec-writer,implementer,adversarial-reviewer,contract-guardian}.md` are not
registered as `subagent_type`s, so a dispatch by role name fails outright. P0.5-29a's spec was
produced by dispatching a general-purpose agent instructed to read and adopt `spec-writer.md`,
which preserves the role's mandate but not its `tools:` restriction — the spec-writer is defined
read-only (Read/Grep/Glob) and ran with a full tool grant. Same root cause as H2.
