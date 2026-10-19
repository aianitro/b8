# P7-41b-gifts — gate log

Append-only. Every decision, the command run, and its output.

## G0 — spec gate — 2026-10-18 — PASS

The spec-writer is read-only and returned the spec in its report; the orchestrator persisted it verbatim
(from `## Goal` to `## Rollback`). Only the Status line changed at freeze.

**Open questions answered by the owner in chat, 2026-10-18 (every answer is the spec's default, so no scenario changes):**
1. Several candidates → **masked for non-givers until the giver chooses (fail closed).** Taken by the orchestrator:
   the alternative exposes real merchants, which contradicts the step's purpose. Reported to the owner in chat.
2. Amount matching → **exact to the cent.**
3. Digest → **masked for everyone, including an owner-giver.**
4. Window-end notice → **window end + 5 days.**
5. Edits to a linked unrevealed row → **locked; the giver can release by cancelling.**

**Risk tier (A8): full pipeline.** Contract surface, a migration and a privacy property across every surface.

**Toolchain (measured by the orchestrator, under bash):**
- T1 `select 1` → `1`
- T2 `createdb b8_p41b_throwaway` + `migrate:up` → `Migrations complete!`; `to_regclass` → `user_invitations`
- T3 exported URL to port 1 → exit 1 (connection refused)
- T4 guard against `b8_finance` → `grep -c` = `1`
- T5 BASE → **85 files, 1204 tests passed**
- T6 tsc → exit 0. Lint baseline → 0 errors, 5 warnings.
- T7 acceptance #6 on the unmodified tree → both runs `["…pre-auth ceremony…","…OverviewDataSchema…"]` (RC-03 passed),
  `OK failing set stable and within KNOWN`.
- T8 Node ≥ 22 with fetch → exit 0. T9 port 3198 → `0` listeners. T10 `typescript` resolves → exit 0.
- T11 `getTimezoneOffset` → `-780` (Auckland), `480` (Los Angeles).

**Targets exist:** all 30 files named in the surface inventory and fixtures list were checked by path (none missing),
including `lib/enrichedDisplayWiring.test.ts`, `app/api/v1/sync/route.test.ts`, `lib/scheduler.ts` (`runDailyJob`),
`lib/domain/digestWindow.ts`, `lib/domain/pushPing.ts`, `lib/plaidReconcile.ts`, the three operator scripts;
`get_top_merchants` in the chat route; `SCHEDULER_IN_PROCESS` read in `lib/scheduler.ts`; `Toys/Gifts/Flowers`
seeded at `migrations/1788271200000_category-control-mode.sql:135`.

**Run on the unmodified tree (each block extracted verbatim from SPEC.md by script, run under bash):**
- #4 → `FAIL UTC M1=(0)…W13=(0)`: every scenario missing.
- #5 → `FAIL G1=(0)…X15=(0)`, with no unexpected failing title.
- #6 → `OK failing set stable and within KNOWN` (= T7).
- #7 → the script does not exist, exit 1.
- #8, #9 → no output (guards; nothing added yet). Weak by design, declared non-evidence by the spec.
- #10 → three `Migrations complete!`, then `0` where `1` is expected: fails for the right reason.

**Vacuity:** #4/#5/#7 require 84 named scenarios passing exactly once, with canary-string fixtures; the spec lists twenty
orchestrator mutations, each naming the scenarios that must fail. A10: surface coverage is enforced structurally
(AST wiring tests W1–W13, the route/page registry of W4 that fails on any unclassified `page.tsx`/`route.ts`)
rather than by text search; #8 is the only grep and is declared weak.

**Known enforcement gap carried from P7-41a (H8):** the scope-guard hook guards `shared/contracts/**`, not
`packages/contracts/**`. The contract freeze on `packages/contracts/` is by convention; G2 checks digests.

Spec frozen: `touch .frozen`.

## G1 — contract gate — 2026-10-18 — PASS

Guardian changed: `migrations/1792400000000_gifts.sql` (new), `db/schema.sql`, `packages/contracts/gifts.ts` (new),
`packages/contracts/index.ts`, and wrote `CONTRACT.md`. `git status` shows nothing else; no committed migration edited.
The guardian could not list `migrations/`; the orchestrator confirmed `1792400000000` sorts last.

**Run by the orchestrator (the guardian has no shell):**
- Acceptance #10 under bash on `b8_p41b_throwaway` → `Migrations complete!` ×3, then `1`, then no output. exit 0.
- `(cd apps/web && npx tsc --noEmit)` → exit 0: every consumer compiles with the new contracts.
- Controls C1–C13 on a fresh `b8_p41b_controls`, each a separate statement: C1 `1 0`; C2 `gift_settings_singleton`;
  C3 `gifts_has_criterion`; C4 `gifts_amount_positive`; C5 `'ab'`, `'  abc'`, three real tabs and `abc` + vertical tab
  each `gifts_merchant_criterion`; C6 `'vvv'` accepted; C7 `gifts_giver_not_recipient`; C8 `gifts_window_ordered`;
  C9 `gifts_reveal_not_before_window`; C10 `gifts_unmatched_was_told`; C11 `gift_transactions_pkey`; C12 delete succeeds,
  links `0`; C13 delete succeeds, `category_id` NULL.
  Two orchestrator fixture errors on the way, neither the contract's: the first run used `b8_p41b_throwaway`, which
  already held an owner from the integration runs (`users_one_owner`), so every later id was empty; and the first C5
  tab case was double-escaped into the visible text `\t\t\t` (6 characters, legitimately accepted). Both redone.
- Seed path: on `b8_p41b_seed`, down, insert `Toys/Gifts/Flowers` as both `capital` and `operational`, up →
  `gift_settings.category_id` is the operational row's id.
- Schema parity: `db/schema.sql` applied to a fresh `b8_p41b_schema` (exit 0); columns, constraints and indexes of the
  three tables, 42 signature lines, identical to the migrated database (`diff` exit 0). The seed INSERT is data and
  correctly not mirrored.

**Class:** additive. Three new tables; no existing column added to, altered or reinterpreted. No row-shape marker
added; masked rows fit existing types (`label` `Gift`, nulls). Masking predicate stated once in the migration:
`reveal_date > CURRENT_DATE AND giver_user_id IS DISTINCT FROM viewer`, NULL viewer fails closed.

**Recorded rulings on the guardian's resolved ambiguities (CONTRACT.md):** accepted as written, notably: `gifts.account_id`
has no ON DELETE (SET NULL would widen "this card" to "any card"); `gift_settings.category_id` ON DELETE SET NULL (the
spec forbids changing category delete); a link row exists only while held, and the reveal date, not the link, unmasks.

Contract-file digests at close, for G2's freeze check:
    da35145bf837bd29cd4a213fd2587668d3ffb0eb14507d2ade1f559d07e6e35a  migrations/1792400000000_gifts.sql
    d14755b7c2b7c3be579a1990b3559ea9ad9a19a3d3a8a4e5834605be209fb5e7  db/schema.sql
    fbf5a21ae250bad192f0bfd74e13a8edb824952638d11a104127356a45bace9d  packages/contracts/gifts.ts
    7e9ed6c1d59da614e05b950d9bde8fa755fd2fd801fb5c060da3b12cc316da6b  packages/contracts/index.ts

Lease closed.

## G2 — build gate — 2026-10-19 — PASS

Implementation ran across two usage-limit interruptions (resumed with context each time; the contract digests were
checked unchanged at each resume). Every command below was run by the orchestrator, under bash where the spec says so.

**Contract freeze:** sha256 of the migration, `db/schema.sql`, `packages/contracts/gifts.ts`, `packages/contracts/index.ts`
→ `da35145b…`, `d14755b7…`, `fbf5a21a…`, `7e9ed6c1…`, identical to G1. No other `packages/` file changed. No existing
test file modified (`git status` shows no ` M …test.ts`).

**Results:**
- #1 tsc → exit 0. #2 lint → 0 errors, 5 warnings (= baseline).
- #3 → 88 files (BASE + 3), 1238 tests (BASE + 34, the floor), 0 failed.
- #4 → `OK 34 scenarios M L P W each present once and passed TZ=` UTC, Pacific/Auckland, America/Los_Angeles.
- #5 → `OK 235 tests, G1-G11 S1-S14 X1-X15 each present once and passed`.
- #6 → two runs, identical failing set = the two H4 titles (RC-03 passed), `OK failing set stable and within KNOWN`.
- #7 → `H1 PASS` … `H10 PASS`, `OK H1-H10`, exit 0. Port 3198 free and `b8_gifts_check` dropped afterwards.
- #8 → no output (grep exit 1). #9 → no output.
- #10 → `Migrations complete!` ×3, `1`, no output.
- #11 build → completed; static pages are `/`, `/insights`, `/login`, `/offline`, none reads a ledger row (implementer's
  report; G3 to confirm against the build table).

**Orchestrator-applied mutations** (independent of the implementer's driver; one at a time; gift integration +
unit suites; file restored and sha256-checked after each; baseline 0/74 failing):
- MA `/api/v1/transactions` reads `transactions` instead of `visibleTransactions(viewer)` → X1 X3 X14 S2 W1 fail.
- MB digest `DIGEST_ROWS = "transactions"` → X7 W1 fail.
- MC masking predicate `IS DISTINCT FROM` → `<>` (a null viewer silently unmasks) → X7 X10 X15 fail.
- MD masked through the reveal day (`reveal_date > CURRENT_DATE` → `>=`) → X7 G11 fail.

**Implementer's mutation log** (EVIDENCE.md): 19 of 20 applied and killed; two survived first and the tests were
strengthened (X2 note, S5 refund). Mutation 11 (link keyed on `plaid_transaction_id`) cannot be written without a
contract change; accepted as not applicable.

**Implementer decisions forwarded to G3:** masked `name = 'Gift'` (spec allowlist says null; label chain reason);
`property_id` unmasked; `lib/giftStore.ts` an unlisted guarded writer; three extra non-test files
(`lib/giftSurfaceRegistry.ts`, `giftFakesTestKit.ts`, `giftResponses.ts`); H8 exempts three `next dev` access-log lines
that echo the check's own search URLs; overview `GET` with no request masks; test fakes of `rateLimit` and `pageViewer`.

## G3 — adversarial gate — 2026-10-19 — cycle 1: N2 returned to the implementer

Reviewer verdict ACCEPT_WITH_NITS (REVIEW-1.md), falsification log non-empty (28 hypotheses). Run interrupted once by
a usage limit and resumed with context.

**INCONCLUSIVE items run by the orchestrator:**
- **I4 PASS** — `find app -name route.ts | wc -l` → `50`, `page.tsx` → `19`; `ROUTES` and `PAGES` in
  `lib/giftSurfaceRegistry.ts` list exactly 50 and 19 (the reviewer's expected 51 was its own miscount).
- **I1 PASS** — scratchpad `i1.mjs`: own DB `b8_g4_i1` (dropped after), owner session seeded, `next start` on 3199 from
  the G2 build; seven requests carrying the canary in query and path, authenticated and not (statuses
  `200 400 200 200 404 307 401`); server output 423 bytes, **0 lines contain the canary in any case**. Caveat: production
  runs `node .next/standalone/server.js` (Next warns that `next start` does not apply to standalone output); same server
  core, request logging off in both. The H8 dev-log exemption is therefore sound for production.
- **I3** — not run separately: N2 is returned to the implementer with the instruction to write the regression first and
  show it failing on the current code (A2: the causal claim is run, not argued).
- **I2 / N3** — not a cycle item: needs a design decision (what a matched gift that lost its row before reveal becomes)
  and possibly a contract change. Escalated to the owner as a follow-up.

**Rulings:** N2 → implementer, **cycle 1**. N1 → owner follow-up (contract change). N3 → owner follow-up (design).
N4 accepted: the giver's watch flag is private content by the allowlist; the conflict is in the spec and is recorded.
N5, N6 accepted as recorded.

## G3 — cycle 1 closed — 2026-10-19 — ACCEPT_WITH_NITS (1 implementer cycle)

N2 fixed in `lib/giftStore.ts` (`linkFreshRows`): the reset to `awaiting` now requires `g.reveal_date > CURRENT_DATE`.
Regression `it` added to `giftSync.test.ts` (no T41b id). **Causal claim run by the orchestrator (A2):** the conjunct
removed by `perl` → `× a revealed matched gift whose row is later deleted stays matched…`, `Tests 1 failed | 14 passed (15)`;
file restored (sha256 identical) → `Tests 15 passed (15)`, S2 and S9 included. N1, N3 to the owner as follow-ups;
N4–N6 accepted (NITS.md).

## G4 — integration gate — 2026-10-19 — PASS

On the final tree, run by the orchestrator, under bash where the spec says so:
- Contract digests `da35145b…`, `d14755b7…`, `fbf5a21a…`, `7e9ed6c1…` = G1.
- #1 tsc exit 0. #2 lint 0 errors, 5 warnings (= baseline). #3 88 files, 1238 tests passed.
- #4 `OK 34 scenarios …` for UTC, Pacific/Auckland, America/Los_Angeles.
- #5 `OK 236 tests, G1-G11 S1-S14 X1-X15 each present once and passed` (235 + the N2 regression).
- #6 `OK failing set stable and within KNOWN`.
- #7 `OK H1-H10`, exit 0; port 3198 free afterwards.
- #8, #9 no output. #10 `Migrations complete!` ×3, `1`, no output. #11 build exit 0.
- INCONCLUSIVE items: I1 PASS, I4 PASS (G3 entry); I3 superseded by the N2 regression; I2 = N3, deferred to the owner.
- EVIDENCE.md scanned for dollar and comma-grouped figures: none.

**Deploy note:** pushing runs the migration on the production database. It seeds `gift_settings` from the
operational `Toys/Gifts/Flowers` category, and is additive. Rolling it back later is a privacy event (CONTRACT.md):
take the CSV backup first.

Owner go-ahead to commit and push given in chat, 2026-10-19.
