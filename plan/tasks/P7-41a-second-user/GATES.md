# P7-41a-second-user — gate log

Append-only. Every decision, the command run, and its output.

## G0 — spec gate — 2026-10-14 — PASS

The spec-writer is read-only (Read/Grep/Glob) and returned the spec in its report; the orchestrator
persisted it verbatim except for one change: gendered pronouns for the second user and the owner
were replaced with neutral wording ("the second user", "they"). Nobody has stated either person's
pronouns. No rule, scenario or command changed.

**Toolchain (measured by the orchestrator):**
- T1 `psql -d postgres -tAc "select 1"` → `1`
- T2 `createdb b8_p41a_throwaway && createdb b8_p41a_schema`; `select current_database()` → `b8_p41a_throwaway`
- T3 `DATABASE_URL=postgresql://nobody@127.0.0.1:1/b8_p41a_throwaway npm run migrate:up` → exit 1, `ECONNREFUSED` (exported URL wins over `.env.local`)
- T4 guard run against `b8_finance` → `grep -c b8_finance` = `1`
- T5 baseline `npm test` → **82 files, 1182 tests passed** (BASE)
- T6 `npx tsc --noEmit` → exit 0
- T7 `npx tsx -e "console.log('ok')"` → `ok`

**Targets exist:** `lib/testDbGuard.setup.ts`, `proxy.ts`, `proxy.test.ts` (pins `PRE_AUTH_PATHS.size` at 12, line 204),
`scripts/tokens.ts` (`npm run tokens`), `npm run screenshots`, `components/Sidebar.tsx`, `lib/webPush.ts`
(`sendWebPush(urgency)` today), `lib/authSession.ts` (`createPersonalToken`), `packages/contracts/auth.ts`,
`app/api/v1/auth/bearer.test.ts`, the decide route test. The integration config collects `app/api/v1/**/*.test.ts`
and `proxy.test.ts`. `agent_proposals` and `web_push_subscriptions` columns match #4's inserts (measured on a migrated scratch DB).
Both KNOWN titles exist verbatim (`proxy.test.ts:166`, `app/api/v1/overview/route.test.ts:131`).

**Run on the unmodified tree (runbook: a command is not trusted until it has failed for the right reason):**
- #4 under `bash` → the legacy inserts succeed against today's schema, then `ERROR: relation "users" does not exist`, exit 1.
- #6 under `bash` → `FAIL  S1=(0),…,S17=(0)`: every scenario missing, no unexpected failure (so KNOWN is complete today).

**Vacuity:** #4 catches a no-op migration, a backfill that attributes the system proposal, and a `down` that drops
rows. #6 cannot pass without seventeen named passing scenarios; their strength is the reviewer's to test, and
the spec's mutation list gives G2 one mutation per rule. #8 is declared non-evidence by the spec itself. #9 is a weak pin,
backed by the screenshot evidence item.

**Note for G2:** #4 and #6 use `set -e`, functions and heredocs; the orchestrator runs them with `bash`, not zsh (runbook).

**Open questions answered by the owner in chat, 2026-10-14:**
1. Scheduled pushes (daily ping, cushion alert, overdraft warning) → **owner only, for now.** As specified.
2. Invite and revoke → **owner only.** As specified.

Spec frozen: `touch .frozen`.

## G1 — contract gate — 2026-10-14 — PASS

Guardian changed: `migrations/1792300000000_second-user.sql` (new), `db/schema.sql`, `packages/contracts/auth.ts`,
and wrote `CONTRACT.md`. `git status --short` shows nothing else on the contract surface; no committed migration edited.

**Run by the orchestrator (the guardian has no shell):**
- `npm run migrate:up && npm run migrate:down && npm run migrate:up` on a fresh `b8_p41a_throwaway` → `Migrations complete!`; a further down+up under bash → `exit=0`, head migration `1792300000000_second-user`.
- Acceptance #4 on a fresh DB, with only the `resolveSession` line skipped (it exercises implementer code; G2 runs the full command) →
  `1` / `1` / `1` / `1 null` / `null null` / `1 3 1 2` / `gone gone` / `1`, exit 0. Every contract line matches the spec.
- Acceptance #5 (schema.sql applied to a fresh `b8_p41a_schema`, diffed table by table) → no diff on `users` (5 columns, 3 constraints),
  `user_invitations` (7, 9), `webauthn_credentials` (7, 6), `web_push_subscriptions` (7, 5), `agent_proposals` (16, 13); `is_owner` index count `1`.
  The orchestrator's first transcription used `order by 1,2`, which Postgres refused; corrected to the spec's `order by 1` and rerun. The spec was not at fault.
- `(cd apps/web && npx tsc --noEmit)` → exit 0: every existing consumer compiles with the widened contracts.

**Class:** the migration is breaking in the §9.2 sense (two NOT NULL columns on populated tables), done as add-nullable, backfill, tighten, in one transaction. Everything else is additive.
No money columns. No stored derived value. Nullable proposal attributions mean "not attributable", never defaulted.

**Recorded rulings on the guardian's resolved ambiguities:**
- Push subscriptions on a database with zero credentials are deleted by `up` (no owner exists to give them to). Accepted: no financial data, the device re-registers, and it deletes nothing on any database with a credential.
- `down` deletes the second user's credentials and subscriptions. **Accepted as stricter than the spec's Rollback text,** which relied on the operator revoking first. Left in place, that passkey would sign in as the owner on the old code.
- `users.revoked_at` added (not in the spec's pinned list; additive, the guardian's call per the spec). Revoke must still remove credentials (S16).
- Contracts live at `packages/contracts/`, not `shared/contracts/`. **Known enforcement gap (H8):** the scope-guard hook still guards the old path, so the contract freeze on `packages/contracts/auth.ts` is by convention. G2 checks `git diff` of the contract files against this gate's state.

Contract-file digests at close, for G2's freeze check:
    26f7d2d4b1b5af19e809fb54428764c3f8ecab4a4948885ae21fb327f940e899  migrations/1792300000000_second-user.sql
    91351bf833c078cf830d9472f65ba35c975f1796297f9bd0458b0f09208f8151  db/schema.sql
    000fa73d7c95cdfc75ab8dbe781aff80687e9a69867df2d6ba29443716338a05  packages/contracts/auth.ts

## G2 — build gate — 2026-10-15 — PASS (with three recorded amendments to acceptance commands)

Every command below was run by the orchestrator, not taken from EVIDENCE.md.

**Contract freeze:** `shasum -a 256` of the migration, `db/schema.sql` and `packages/contracts/auth.ts` → `26f7d2d4…`, `91351bf8…`, `000fa73d…`, byte-identical to G1's digests.

**Results:**
- #1 `(cd apps/web && npx tsc --noEmit)` → exit 0.
- #2 `npm run lint` → exit 0, `✖ 5 problems (0 errors, 5 warnings)`, the same five pre-existing warnings as before the task (none in a touched file).
- #3 `npm test` → `Test Files 83 passed (83)`, `Tests 1190 passed (1190)`; BASE was 82 / 1182.
- #4 **as written** → `TypeError: db.end is not a function`. **Adjudicated:** `npx tsx -e "...import('./lib/db')..."` prints `keys [ 'default', 'module.exports' ] … typeof default.end undefined typeof default.default.end function`: under `tsx -e` the module comes back double-wrapped, so the spec's `const {default:db}=…` crashes regardless of the implementation. A defect in the command. **Amendment A1:** `const {default:db}=await import('./lib/db');` → `const dm=await import('./lib/db');const db=dm.default.default??dm.default;`, nothing else changed (diff: one line). Amended #4 on a fresh DB → `1` / `1` / `1` / `1 null` / `null null` / `resolved-as-owner 3 unknown null` / `1 3 1 2` / `gone gone` / `1`, exit 0. On the unmodified tree the amended command still fails, at `relation "users" does not exist` (the amendment is after that point).
- #5 → no diff on any of the five tables; `is_owner` index `1`.
- #6 → `OK 189 tests, S1-S17 each present once and passed`.
- #7 **as written** cannot show a count (`tail -6` prints only vitest 5's timing footer). Run instead with the JSON reporter, twice: run 1 `passed 187 failed 2` (the two KNOWN); run 2 `passed 186 failed 3` (the two KNOWN + `RC-03: an item whose accounts disagree on the cursor syncs from no cursor, whichever account the table returns first`).
  **Adjudicated (causal claim run, not assumed):** a detached worktree at HEAD (no P7-41a code, no new migration; `to_regclass('public.users') is null` → `t`) on its own scratch DB `b8_p41a_head`:
  RC-03 alone, 10 runs → `failed 0 of 10`; full integration suite, 6 runs → `RC-03 failed 1 of 6`. This tree, full suite, 6 runs → `RC-03 failed 0 of 6`.
  RC-03 is an order-dependent flake that predates this task and only shows in the full suite. **Amendment A2:** #7 passes when both runs fail nothing beyond KNOWN ∪ {RC-03}, and the counts agree once RC-03 is set aside. Both runs meet it. New hold **H9** opened in QUEUE.md for RC-03.
- #8 **as written** → `apps/web/app/api/v1/plaid/create-link-token/route.ts`. **Adjudicated:** `git diff --quiet HEAD --` on that file → untouched; the only hit is `client_user_id: 'local-user'` (line 12), present on HEAD. The pattern lacked word boundaries. **Amendment A3:** `\buser_id\b|\buserId\b|\busers\b` → no output from either half.
- #9 → `2`.

**Diff surface** (`git status --short`, line by line): every file is in the spec's list or falls under its "existing fixtures must be updated" clause, except four, each accepted:
`scripts/screenshots.mjs` and `evals/golden/README.md` (each inserted a credential with no user, which the frozen NOT NULL refuses; now create the owner first); `lib/webauthnOrigins.ts` (comment only);
`app/api/v1/chat/route.ts` (the agent's proposal write must record the proposing user or the frozen CHECK `agent_proposals_proposer_has_user` refuses it; #8 excludes this file by design).
No real name in any changed or new file (case-insensitive grep: 0 files). `AGENTS.md` not dirty.

**Screenshots** (`screenshot-chrome-owner.jpg`, `screenshot-chrome-second-user.jpg`): sidebar crops only, no figures, fabricated name. Viewed by the orchestrator.

**Passed to G3 as a hypothesis, not decided here:** the new sidebar line is `text-xs text-cyan-100/80` on the cyan-700 ground; the uiux-promax brand rule admits nothing dimmer than `cyan-100` on that ground.

**Implementer's open item:** an owner row with every credential gone makes the next bootstrap trip `users_one_owner`. Unreachable through any current path (revoke refuses the owner); recorded for the reviewer.

## G3 — adversarial gate — 2026-10-15 — FAIL → implementer, cycle 1

REVIEW-1: ACCEPT_WITH_NITS, falsification log of 17 hypotheses (non-vacuous), four NITs, three INCONCLUSIVE items.
G3 requires every INCONCLUSIVE item converted into a command the orchestrator ran:

- **I2 (money figure)** — `git diff HEAD -- apps/web/lib/proposalStore.ts | /usr/bin/grep -nE '^\+.*\$[0-9]'` → only SQL placeholders (`$1`…`$8`); the same comment line is present in `git show HEAD:apps/web/lib/proposalStore.ts`, so it predates the task. **Clean.**
- **I3 (fixtures weakened)** — `git diff HEAD --` the five pre-existing fixture files `| grep -cE '^-\s*(expect|it\()'` → `0`. No assertion removed. **Clean.**
- **I1 (is S6 concurrent?)** — mutation probe by the orchestrator: removed `FOR UPDATE` from the invitation SELECT in `apps/web/lib/authSession.ts` (one occurrence), ran
  `DATABASE_URL=postgresql://localhost/b8_p41a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/auth/invitations/route.test.ts -t "T41a-S6"` five times →
  `Tests 1 passed | 5 skipped (6)` **five of five**. Restored the file from a copy (`diff -q` identical; S6 green after revert).
  **Causal check (read, then reasoned against the code):** without the lock nothing else serializes redemption. The consume step is
  `UPDATE user_invitations SET consumed_at = NOW(), consumed_by = $2 WHERE code_hash = $1`, which is unconditional, and `consumed_by UNIQUE` cannot fire because the two redeemers create different users. So the unlocked code really is racy, and S6 does not detect it: its two requests do not overlap at the database.
  **Ruling: BLOCK on S6's strength** (the reviewer's own pre-stated condition for I1). The implementation is correct; the scenario that is supposed to prove single use under concurrency proves nothing about concurrency.

**Returned to the implementer (cycle 1):**
1. **Required.** Make S6's concurrent half deterministic, so removing `FOR UPDATE` fails it every time (e.g. force both redemptions into the database at once). Show the probe: lock removed → S6 fails 5 of 5; restored → passes 5 of 5.
2. **NIT N3, fix in this cycle.** The authenticated enrolment path must refuse a revoked user inside the transaction. Add an assertion for it to S16 or a new test, without renaming scenarios.
3. **NIT N1, fix in this cycle.** `text-cyan-100/80` → `text-cyan-100` for the "Signed in as" label (and the "Finance" mark, whose comment already claims the floor this alpha breaks).
4. **NIT N2 → follow-up**, recorded in NITS.md, not this cycle: bind the invitation to the registration challenge, and make a read token plus a code behave like a full token plus a code.
5. **NIT N4 → follow-up for future gates**: #8 should exclude `client_user_id` explicitly rather than add word boundaries. A3 stands for this task (same outcome on this tree, per the reviewer).

Cycle count: 1 of 3.

## G2 (cycle 1) — build gate — 2026-10-15 — PASS

Implementer changed `invitations/route.test.ts` (S6 concurrent half), `lib/authSession.ts` (N3), `users/revoke.test.ts` (N3 assertion inside S16), `components/Sidebar.tsx` (N1), EVIDENCE.md "Cycle 1".
All run by the orchestrator:
- Contract digests `26f7d2d4` `91351bf8` `000fa73d`, unchanged since G1.
- **I1 probe, rerun:** `FOR UPDATE` removed from the invitation SELECT → `T41a-S6` `Tests 1 failed | 5 skipped (6)` five of five; restored (`diff -q` identical) → `1 passed` five of five. S6 now detects the race.
- **N3 probe:** `AND revoked_at IS NULL` removed from the new `FOR SHARE` user check → `T41a-S16` `Tests 1 failed (1)`; restored (identical) → `1 passed (1)`.
- **N1:** `grep -c 'text-cyan-100/80' apps/web/components/Sidebar.tsx` → `0`.
- #1 exit 0 · #2 exit 0, the same 5 pre-existing warnings · #3 83 files, 1190 tests · #4 (A1, fresh DB) `1|1|1|1 null|null null|resolved-as-owner 3 unknown null|1 3 1 2|gone gone|1` · #5 five tables, no diff · #6 `OK 189 tests, S1-S17 each present once and passed` · #7 (A2) run 1 `passed 187`, run 2 `passed 187`, failures only the two KNOWN · #8 (A3) no output · #9 `2`.

## G3 (cycle 1) — adversarial gate — 2026-10-15 — PASS

REVIEW-2: ACCEPT_WITH_NITS, falsification log of 10 hypotheses on the delta, no BLOCK. INCONCLUSIVE items run by the orchestrator:
- **I-R2-1** — `FOR SHARE` removed (keeping `AND revoked_at IS NULL`) → `T41a-S16` `Tests 1 passed (1)`; restored (`diff -q` identical). **Confirms R2-N1:** S16 does not detect the loss of `FOR SHARE`. **Ruled a NIT, not a BLOCK:** the consequence is the same as the original N3 (a credential row for a revoked user that cannot sign in, since `resolveSession` requires `u.revoked_at IS NULL`, which S16 does assert), under a narrow concurrent race. Recorded as a follow-up.
- **I-R2-2** — the command diffs against HEAD, not against cycle 0, so it cannot isolate the cycle-1 delta. Its output lists only the `Me` import, `useSignedInUser`, `SignedInAs` and its two mount points, which is exactly the render logic REVIEW-1 read and refuted hypothesis 5b on. No other non-ink, non-comment line. Accepted.
- **I-R2-3** — `T41a-S6` verbose, three runs → `176ms`, `110ms`, `107ms`. Far inside the 5000 ms default.

NITs R2-N1 through R2-N4 recorded in NITS.md as follow-ups. Cycle count stays at 1 of 3.

## G4 — integration gate — 2026-10-15 — PASS (merge held for the owner)

- `npm test` → `Test Files 83 passed (83)`, `Tests 1190 passed (1190)`.
- `npx tsc --noEmit` exit 0 · `npm run lint` exit 0 (the five pre-existing warnings).
- `npm run build` exit 0, `✓ Compiled successfully`; route table includes `/api/v1/auth/invitations`, `/api/v1/auth/me`, `/api/v1/auth/users/[id]/revoke`.
- Migration round trip on a fresh `b8_p41a_throwaway`: up → down → up, exit 0.
- Every INCONCLUSIVE item (I1–I3, I-R2-1–3) converted to a command and recorded above.
- Truthfulness: no ledger query changed (#8 and REVIEW-1 hypothesis 6); the net-worth and budget suites are inside the 1190 green.
- No real data: a case-insensitive name grep over changed and new files finds nothing; a money-figure scan over every added line found only a figure the orchestrator itself had quoted into REVIEW-1.md and this log, from a pre-existing code comment. Both reworded without the figure, and rescanned clean.
  The sidebar screenshot crops predate cycle 1's ink fix (EVIDENCE.md says so).

**Held:** pushing to `main` deploys to the home server, whose poller applies the migration to the owner's real database. CONTRACT.md requires a CSV backup of `webauthn_credentials`, `auth_sessions`, `web_push_subscriptions` and `agent_proposals` outside the repo first. Commit and push wait for the owner.

## MERGED — 2026-10-15

Owner took the pre-deploy CSV backup on the server (counts in EVIDENCE.md). Committed and pushed to `main`.
