# P7-41a2-browser-onboarding — gate log

Append-only. Every decision, the command run, and its output.

## G0 — spec gate — 2026-10-18 — PASS

The spec-writer's draft (2026-10-15) persisted verbatim; only the Status line changed at freeze.

**Risk tier (A8): full pipeline, G3 blocking.** No contract surface, no migration, no money arithmetic,
but the task handles a bearer secret (the invitation code, live up to seven days) on a pre-auth page.
That is an outbound-secret surface in substance, so A8's short path does not apply. G1 SKIP: contracts
touched = none, confirmed by the spec's #8 guard.

**Toolchain (measured by the orchestrator):**
- T1 `psql -d postgres -tAc "select 1"` → `1`
- T2 `createdb b8_p41a2_throwaway` + `migrate:up` → `Migrations complete!`; `to_regclass('public.user_invitations')` → `user_invitations`
- T3 `DATABASE_URL=postgresql://nobody@127.0.0.1:1/b8_p41a2_throwaway npm run migrate:up` → `ECONNREFUSED 127.0.0.1:1`, exit 1
- T4 integration guard against `b8_finance` → `grep -c b8_finance` = `1`
- T5 baseline `npm test` → **83 files, 1190 tests passed** (BASE)
- T6 `(cd apps/web && npx tsc --noEmit)` → exit 0
- T7 Chrome → `Google Chrome 155.0.8059.80`
- T8 `lsof -nP -iTCP:3000 -sTCP:LISTEN | wc -l` → `0`
- Lint baseline for #2: `npm run lint` → exit 0, **0 errors, 5 warnings** (no `.claude/worktrees` present)

**Targets exist:** `app/login/page.tsx`, `components/Sidebar.tsx`, `scripts/screenshots.mjs`,
`lib/webauthnOrigins.ts` (`APP_PORT = 3000`), `lib/testDbGuard.setup.ts`, `proxy.ts`;
`secondUserTestKit.ts` exports `bootstrapOwner`, `register`, `resetAuth`, `authCounts`, `invite`,
`invitationHeader`, `SECOND_USER_NAME = 'Test User Two'`; `packages/contracts/auth.ts` exports
`invitationCode`, `InvitationCreateRequestSchema`, `InvitationCreatedSchema`, `MeSchema` (`isOwner`).
The invitations route already sets `Cache-Control: no-store` (route.ts:52), so I5's assertion needs
no server change. Unit config collects `lib/**/*.test.ts`; integration config collects
`app/api/v1/**/*.test.ts`. The three KNOWN titles of #5 are exactly the failures of today's tree (below).

**Run on the unmodified tree (each under `bash`; zsh's `grep` here is a ugrep wrapper):**
- #4 → `FAIL U1=(0),…,C7=(0)`, exit 1: every scenario missing.
- #5 → failed titles are the two H4 tests only (RC-03 passed this run); `FAIL I1=(0),…,I6=(0)`, exit 1.
- #7 → exit 1: the login page is unmodified.
- #8 → empty, grep exit 1 (expected).
- #9 → the script does not exist, exit 1.

**Vacuity:** #4/#5 cannot pass without twenty named passing scenarios asserting concrete values; the spec's
mutation list gives one mutation per rule, and two of them (fragment never scrubbed; code written to
storage in the page) are orchestrator-applied and must turn #9 red. #7 is declared weak by the spec itself.
No `test -f` command (A9).

**Note for G2 (#7 false-positive risk):** the #7 grep runs over every changed non-test `.ts/.tsx`. Seven
existing components already match it (`TransactionTable`, `PropertyLedgerCard`, `BudgetViewToggle`,
`AccountsList`, `TransactionFilter`, `CategoryManager`, `BudgetTabsToggle`) plus `app/dashboard/page.tsx`
and `lib/logger.ts`. `Sidebar.tsx` and `app/login/page.tsx` do not. If the diff touches a flagged file,
G2 adjudicates on the added lines only and records it here.

**Housekeeping noticed:** QUEUE.md has two holds both labelled H9 (lines 103 and 143). Not this task's to fix.

Spec frozen: `touch .frozen`.

## G2 — build gate — 2026-10-18 — PASS

Every command below was run by the orchestrator, not taken from EVIDENCE.md. #4–#8 under `bash`.

**Scope:** modified `app/login/page.tsx`, `components/Sidebar.tsx`, `next.config.ts`; new `lib/invitationLink.ts`,
`lib/invitationFragment.ts`, `lib/passkeyCeremony.ts`, `components/InviteControl.tsx`, three test files,
`scripts/onboarding-browser-check.mjs`. `secondUserTestKit.ts` unchanged. No contract, migration or server file
touched (#8). None of the seven #7-flagged components was touched, so the G0 note did not arise. SPEC.md unchanged
since freeze.

**Results:**
- #1 tsc → exit 0.
- #2 lint → exit 0, 0 errors, 5 warnings (= baseline; the `location.assign` warning is the existing line, moved).
- #3 unit → 85 files (BASE + 2), 1204 tests (BASE + 14), 0 failed.
- #4 → `OK 14 scenarios U1-U7 C1-C7 each present once and passed`, exit 0.
- #5 → `OK 195 tests, I1-I6 each present once and passed`, exit 0.
- #6 → two runs, identical failing set both times: the two H4 titles only (RC-03 passed).
- #7 → no output, exit 0.
- #8 → no output (grep exit 1).
- #9 → `B1 PASS` … `B9 PASS`, `OK B1-B9`, exit 0. B9 satisfied by the `Referrer-Policy: no-referrer` header.

**Orchestrator-applied browser mutations (to `app/login/page.tsx`, one at a time, restored from a copy; sha256
identical after restore; port 3000 free and `b8_onboarding_check` dropped afterwards):**
- M1 `replaceState` call removed (page never scrubs) → `B2 FAIL fragment still present after load`, exit 1.
- M2 `localStorage.setItem(…, code)` added on read → `B3 FAIL the code is in profile B storage or cookies`, exit 1.

**Implementer's mutation log** (EVIDENCE.md) accepted as reported for G3 to re-test. Two deviations from the spec's
expected-failure list, both broader than named, not narrower: the one-sided-header mutation also fails C6/C7
(they reuse C1's assertions); `#invite=` read as ordinary fails U4 only, not U3 (U3 has no such row). Neither
weakens a rule.

**Evidence hygiene:** no code value and no money figure in EVIDENCE.md (scanned). Screenshot
`owner-panel-desktop.png` showed the `/categories` page's static "Annual budget" placeholder, a digit string that
reads as money under AGENTS.md's public-repo rule. The orchestrator regenerated the set with
`--screenshots` to the scratchpad and replaced that file with a crop to the sidebar only (the link field is
blurred in it). A first `sips` crop with offset `0 0` silently centred instead of anchoring left; caught by viewing
the result and redone. Other screenshots viewed: link blurred, no figures, fabricated name only.

**Noted, not this task's:** `/login` renders the full nav sidebar to an unauthenticated visitor (pre-existing).

## G3 — adversarial gate — 2026-10-18 — ACCEPT_WITH_NITS (cycle 1, 0 implementer cycles)

Falsification log non-empty (26 hypotheses, REVIEW-1.md). No BLOCK. Nits N1–N4 recorded in NITS.md; none breaks
a stated rule. The reviewer had no `git diff`, hence X1.

## G4 — integration gate — 2026-10-18 — PASS

- `npm run build` → exit 0.
- Unit suite → 85 files, 1204 tests passed (unchanged since G2). Integration suite: G2's two runs stand; the tree's
  only change since then is the cropped screenshot.
- Migration round-trip on `b8_p41a2_throwaway`: `migrate:down` then `migrate:up` → `Migrations complete!`, exit 0
  (no migration in this task; checks the head still round-trips).
- **X1 PASS** by command: `git show HEAD:apps/web/app/login/page.tsx` against the working copy. The fallback string
  `That did not work. Try again.` is identical; the ordinary branch's text and JSX match line for line (the
  only diff line was the orchestrator's own range boundary, one leading `<p>`); the removed inline ceremony's
  inits are exactly those C2 pins with `toStrictEqual`.
- **X2 PASS** — scratchpad script `x23.mjs` (own DB `b8_g4_x23`, dropped after) against `next start` on port 3000
  with a fabricated 22-character code: `hash after hydration '', after 5 s '', href has code false/false,
  2 history entries, any with code false`.
- **X3 PASS** — same script, owner mints at desktop on `/categories`, navigates to `about:blank`, `history.back()`:
  `panel null, code in document false, navigation type 'back_forward'`. Whether Chrome put the page in bfcache
  at all was not determined; the observable rule (no panel, no code) holds either way.
- Port 3000 free afterwards; `b8_onboarding_check` and `b8_g4_x23` absent.

**Owner go-ahead to commit and push given in chat, 2026-10-18.**
