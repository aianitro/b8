# P8-42b-card-annual-instruments — link a credit card to its loyalty membership, detect its annual fee in the ledger, and say whether the instrument it should bring has arrived
**Roadmap item:** ROADMAP.md §5 Phase 8 step 42b (scope narrowed by the orchestrator on 2026-11-20: the earn estimate is deferred to a separate step 42b-2). Origin: `plan/tasks/P8-42b-card-annual-instruments/ITEM.md` (binding) and `plan/LOYALTY-ROADMAP.md` §4 B, §5, §6 (42b), §7. Predecessors: `plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md` and `plan/tasks/P8-42a2-loyalty-nits/SPEC.md`. "P8-42a2 #n" below means that spec's acceptance command n. Under `node -e` the first extra argument is `process.argv[1]` (GATES.md A1 of P8-42a); every `node -e` below reads its arguments that way, or reads stdin.
**Status:** FROZEN (G0 PASS 2026-11-20, amendment A0)
**Author:** spec-writer

## Goal
Five observable changes. Nothing else changes.

1. **Link.** A loyalty membership can be linked to the credit account that earns into it, and unlinked, from `/travel`. Only an account whose `type` is `credit` can be linked. One card links to at most one membership. Unlinking leaves every instrument untouched.
2. **Benefit.** A link may describe the card's annual benefit: an instrument kind (the existing four kinds), a short description, and a window in days (default 45, range 1 to 365) after the fee posts within which the instrument normally arrives. A link with no benefit described is valid.
3. **Fee detected, never stored.** For a linked card, the most recent annual-fee charge among that account's transactions is found at read time. The rule is stated in Conventions and Open question 1. It works for a card with no Plaid feed. A refunded fee is not a posted fee. No fee date, fee amount or state is written to any table.
4. **State derived, never stored.** For a linked card with a benefit described, the state is exactly one of `no_fee_seen`, `awaiting`, `received`, `overdue`, derived on every read from the ledger, the instruments and Postgres's `CURRENT_DATE`.
5. **Shown where the owner looks.** The `/travel` membership line and the card's `/accounts/[id]` page show the fee date, the expected benefit and the state, with "expected by <date>" while awaiting. The card's account page also shows "Earns into <program>". `/travel` gets the link, unlink and benefit controls. The `/travel` and `/accounts/[id]` pages, and every route that returns a membership, are re-classified in the gift surface registry and in the surface script, and proved against a held gift row.

## Non-goals
The reviewer enforces each of these as a defect if present.
- **No earn estimate**, no multipliers, no per-category data (that is 42b-2). **No email reading** (42c), **no alert, push, dashboard card, digest widget or "Needs attention" section** (42g). **No transfers** (42f). No agent tool (42h).
- **No stored fee figure, fee date, expected-by date or state**, in any table, column, cache, materialised view or JSON blob. The loyalty tables gain exactly the three benefit columns and one unique index, and nothing else (command 5 asserts the exact column lists).
- **The fee amount is never emitted** by any route or rendered by any page this task changes. Not in `feeWatch`, not on `/travel`, not in a log line. (ITEM.md allows showing it. This spec decides not to: Open question 9.)
- **No write to the ledger.** No transaction, account, valuation, category, rule, gift or transfer row is created, updated or deleted by any production code path of this task. The only code that writes those tables is test fixtures and the surface script's own scratch database.
- **No change to what a transaction row is or how Plaid syncs it.** No new column on `transactions` or `accounts`. No change to `lib/sync.ts`, `lib/netWorth.ts`, `lib/giftReadPath.ts`, `lib/domain/giftMask.ts` or any gift route.
- **Fee detection does not read `transactions` except through the gift read path** (`visibleTransactions` in `lib/giftReadPath.ts`). No raw `FROM transactions` or `JOIN transactions` in any file this task changes, including the unchanged-in-spirit check `T42a-C10`.
- **No "refund pairing" beyond the stated rule** (exact negated amount, same account, name rule). No partial-refund logic, no fuzzy amount matching, no name-similarity matching.
- **No server-side JS clock or JS date arithmetic** for "today", the window or the comparison. `new Date(`, `Date.now(`, `toISOString`, `parseFloat`, `toFixed`, `Math.round` do not appear in any loyalty-scoped source or in the new tests.
- **The member number stays masked everywhere** and the P8-42a2 guarantees stay (one `memberNumber: null` sender, the Remove-number control, `startEmpty` once). This task adds no new `/member-number` reader.
- **No new route file.** The link and benefit are fields of the existing `PATCH /api/v1/loyalty/memberships/[id]`. The loyalty route count stays 11 (`T42a-C10` asserts 11 files).
- **No change to the import script or its fixtures.** `memberships` created by the import still have no card and no benefit.
- **No change to an already-applied migration** (`migrations/1792700000000_loyalty.sql` and every earlier one). The change is one new migration file.
- **No change to `package.json`, the vitest configs, or `evals/`.** No new npm dependency. No renderer is added.
- **Existing tests are only added to**, with two bounded exceptions in command 20: fixture objects may gain the new keys with null or empty values, and the one expectation line in `T42a-C10` about route classes may change. No existing test is weakened or deleted.
- **Any conflict with a frozen P8-42a or P8-42a2 regression command is raised, not absorbed.** The implementer may not edit those specs or any test outside the allowed set. The orchestrator decides an amendment.

## Contracts touched
Expected: G1 applies (contract surface touched, lease required). The guardian writes the migration and the types. Class per BUILD.md §9.2 is **additive** for every row.

| File | Change | Class (§9.2) |
|---|---|---|
| `migrations/<new timestamp greater than 1792700000000>_loyalty_card_benefit.sql` (name free) | `ALTER TABLE loyalty_memberships` adds three nullable columns `benefit_kind`, `benefit_description`, `benefit_window_days`. Kind is constrained to the four instrument kinds. Description is trimmed and 1 to 200 characters. Window is an integer from 1 to 365. Kind and description are both null or both non-null. Window is null exactly when kind is null. One partial unique index on `card_account_id` where it is not null. The `down` drops the index and the three columns and touches nothing else, so `card_account_id` and every instrument survive a down. | additive |
| `db/schema.sql` | Mirrors the migration. The stale comment "reserved for step 42b, always NULL in 42a" on `card_account_id` is replaced. | additive |
| `packages/contracts/loyalty.ts` | `LoyaltyMembershipPatchRequestSchema` gains optional `cardAccountId` (non-empty string or `null`) and optional `benefit` (strict object `{kind, description, windowDays?}` or `null`). `LoyaltyMembershipSchema` gains required `cardAccountId`, `cardAccountName`, `benefit`, `feeWatch` (each nullable). `feeWatch` is the strict object `{feeDate, expectedBy, state}` with the consistency rules in Conventions. `LoyaltyOverviewSchema` gains required `cardAccounts` (array of `{id, name}`). The error-code vocabulary gains `CARD_ALREADY_LINKED` (409). `LoyaltyMembershipCreateRequestSchema` is unchanged and still refuses `cardAccountId` and `benefit`. The stale "reserved for step 42b" comment is replaced. | additive |
| `packages/contracts/loyalty.test.ts` | Three tests added (`T42b-U1` to `T42b-U3`). The `membership()` fixture and any overview fixture may gain the new keys. | additive (tests) |

The column names `benefit_kind`, `benefit_description`, `benefit_window_days` on `loyalty_memberships`, the field names above, and the state names are fixed by this spec because the acceptance commands query them. A guardian who wants a different table shape must raise it before G0 freezes this spec.

## Conventions this task must honor
- **Sign.** The ledger's convention holds. For a card, `transactions.amount` is positive for money out (a charge, a fee) and negative for money in (a payment, a refund, a statement credit). A fee is `amount > 0`. A refund is `amount < 0`. A row of exactly `0.00` is neither. The amount is `NUMERIC(12,2)`, compared by exact decimal equality in SQL, never through a JS number. Nothing is negated "by hand" in application code: a refund matches a fee when `refund.amount = -fee.amount` in SQL. The fee amount itself is never emitted.
- **Rounding.** None. The only comparisons are NUMERIC equality and calendar-date comparison, both in Postgres.
- **Dates.** Calendar dates are `YYYY-MM-DD` text produced by Postgres (`::text`). "Today" is Postgres `CURRENT_DATE`, never the JS clock. `expectedBy` is the fee's posted date plus `benefit_window_days` calendar days, computed by Postgres date arithmetic.
  - **The fee date is the posted `date`**, never `authorized_date` (Open question 3).
  - **Recorded date of an instrument.** An instrument's "issue date" is `issued_on`. When `issued_on` is null, its recorded date is `created_at` converted to a date by Postgres in the database session's time zone. Test fixtures set `created_at` at midday so no zone moves the date.
- **State rule.** Let `F` be the fee date, `E = F + window`, `T = CURRENT_DATE`.
  - No fee posted: `no_fee_seen`, with `feeDate` and `expectedBy` both null.
  - Otherwise, if an instrument of the benefit's kind on this membership has issue date, or (when `issued_on` is null) recorded date, on or after `F`: `received`. This wins over `overdue`.
  - Otherwise, if `T <= E`: `awaiting`. The day `E` itself is still `awaiting`.
  - Otherwise: `overdue`.
  - A linked card with no benefit has `state: null`, `expectedBy: null`, and `feeDate` set or null.
  - A membership with no card has `feeWatch: null`.
- **`feeWatch` consistency** (a contract refinement): `state` null implies `expectedBy` null. `state` `no_fee_seen` implies `feeDate` and `expectedBy` both null. `state` `awaiting`, `received` or `overdue` implies both non-null.
- **Which fee.** Only the single most recent fee row counts: greatest posted `date`, ties by greatest `id`, never by insertion order alone. If that row is cancelled by a refund the answer is `no_fee_seen`. An older, uncancelled fee is not resurrected (Open question 11).
- **Fee row.** A row on the linked account that satisfies all of the following. Category does not participate.
  - `amount > 0`.
  - `name`, after collapsing every run of whitespace to one space and case-folding, contains as whole words (start or end of the text, or a non-letter-non-digit neighbour) the phrase `annual membership fee` or the phrase `annual fee`.
  - `transfer_group_id` is null.
  - It is not held by an unrevealed gift (see Landscape and exclusions).
  - Only `name` is read. `merchant_name`, `plaid_category`, `plaid_category_detailed` and `plaid_raw` never decide anything, so a card without a Plaid feed behaves identically.
- **Refund.** A row on the same account, `amount = -(fee amount)`, posted on or after the fee's date, whose name contains as whole words one of: the fee phrases above, `refund`, `reversal`, `reversed`. One refund cancels at most one fee: the most recent fee row on or before the refund's posted date with the same amount. A plain-named credit (for example a card payment) that happens to equal the fee amount cancels nothing.
- **Landscape and exclusions.**
  - The account's `landscape` (`operational` or `capital`) is not consulted. Nothing here is a P&L, budget or net-worth figure.
  - `hidden = TRUE` rows still count. `hidden` is a display and budget flag, and a hidden fee still posted.
  - `exclude_from_budget`, categories, `mapped_category`, `rule_applied` and `track_transactions` are not consulted.
  - **A transaction held by an unrevealed gift is never a fee, for any viewer, giver included** (Open question 7). The hold is `gift_transactions` joined to `gifts` with `reveal_date > CURRENT_DATE`, evaluated by Postgres. On `reveal_date` itself, and after, the row is ordinary. The answer is identical for every viewer, so no figure differs by viewer.
- **Null semantics.** A missing observation renders as an absent phrase or "No annual fee seen yet", never `0`, `0.00`, an empty string or the text `null`. `feeDate` and `expectedBy` are null, never `''`. `state` is null (not `no_fee_seen`) when there is no benefit to wait for. A membership with no card has `cardAccountId`, `cardAccountName` and `feeWatch` null. `benefit` is null when none is described.
- **Gift class.** `/travel` and the four routes that return a membership become `numeric-only`. `/accounts/[id]` stays `text-bearing` (H2). The seven other loyalty routes stay `no-transaction-data`. Reasoning in Open question 7.
- **Visible text** (used by the surface script and by `T42b-U4`). Case-sensitive, after removing every `<!-- -->` comment from the HTML. Each phrase appears in the line for a linked card.

| State | The line contains |
|---|---|
| fee posted, any state with a benefit | `Annual fee posted` and the fee date |
| `awaiting` | `expected by` and the `expectedBy` date |
| `received` | `received` |
| `overdue` | `overdue` |
| `no_fee_seen`, or linked with no fee row | `No annual fee seen yet` |
| linked, benefit described | the benefit description text |
| `/accounts/[id]` of a linked card | `Earns into` and the program name |
| unlinked, or non-credit | no `Earns into` anywhere on that account's page |

- **Controls on `/travel`** (labels fixed so source checks can find them): `Link a card` (a choice among the overview's `cardAccounts`), `Unlink card` (one tap, no confirmation: it is reversible and deletes nothing), and `Set benefit`. The phone-first tap-target rule of P8-42a2 applies (not smaller than the existing `min-h-8` controls).
- **Process requirements for the implementer.** Read the relevant guides under `node_modules/next/dist/docs/` (resolved from `apps/web`) before changing any page or client component. Invoke the `uiux-promax` skill before designing the link, unlink and benefit controls. Record in EVIDENCE.md which docs files were read.
- **Public repo.** Fixtures use the canary `ZQ42B`: account ids `zq42b_…`, names `ZQ42B …`, no real card, bank or program names in any fixture (the seeded catalog's programs are referenced by id, not by name). No money-looking figure in any tracked comment or commit message. The fabricated fee amounts live only in test code and the surface script's scratch database.

## Toolchain prerequisites
All commands run under `bash` from the repo root. The orchestrator verifies every row before G0 passes. Orchestrator-measured facts from 2026-11-20: unit BASE 103 files and 1406 tests, LINT_BASE 0 errors and 5 warnings, integration 324 tests with failing set `[]`, and the throwaway database at head.

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `psql`, `createdb`, `dropdb`, a local Postgres with CREATEDB | **yes** | local install | `psql -d postgres -tAc "select 1"` → `1` | filled at G0 |
| T2 | Throwaway DB `b8_p42a_throwaway` exists and has the six loyalty tables (it is at head before this task's migration; command 4 brings it to the new head) | **yes** | reuse; else `createdb b8_p42a_throwaway` then `DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npm run migrate:up` | `psql postgresql://localhost/b8_p42a_throwaway -Atc "select to_regclass('public.loyalty_instruments')::text"` → `loyalty_instruments` | at head (orchestrator) |
| T3 | `npm run migrate:up` and `npm run migrate:down` honour `DATABASE_URL` from the environment, and the `pgmigrations` table exists | **yes** | existing | `DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npm run migrate:up >/dev/null 2>&1; echo "exit=$?"` → `exit=0`, then `psql postgresql://localhost/b8_p42a_throwaway -Atc "select count(*)>0 from pgmigrations"` → `t` | filled at G0 |
| T4 | Unit baseline BASE | **yes** | existing | `npm test 2>&1 \| tail -8` → 103 files, 1406 tests | 103 / 1406 |
| T5 | Lint baseline LINT_BASE | **yes** | existing | `npm run lint; echo "exit=$?"` → 0 errors, 5 warnings | 0 / 5 |
| T6 | Integration baseline on the unmodified tree | **yes** | existing | P8-42a2 #6 body (line 147 to 148 of its SPEC) → `OK 324 tests …` | 324, failing set `[]` |
| T7 | `tsc` runs in `apps/web` with `--incremental false` | **yes** | existing | `(cd apps/web && npx tsc --noEmit --incremental false; echo "exit=$?")` → `exit=0` | filled at G0 |
| T8 | Node ≥ 22 with global `fetch` (surface script) | **yes** | local install | `node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22 && typeof fetch==="function" ? 0 : 1)'; echo "exit=$?"` → `exit=0` | filled at G0 |
| T9 | Port 3198 is free and the surface script is green on the unmodified tree (`OK H1-H11`) | **yes** | existing | `lsof -nP -iTCP:3198 -sTCP:LISTEN \| wc -l` → `0`, then `node apps/web/scripts/gifts-surface-check.mjs; echo "exit=$?"` → `OK H1-H11`, `exit=0` | filled at G0 |
| T10 | `npm run build` succeeds on the unmodified tree (it once hung fetching fonts; re-run if so) | **yes** | existing | `npm run build; echo "exit=$?"` → `exit=0` | filled at G0 |
| T11 | P8-42a2's SPEC.md is frozen with its blocks at the lines the regression commands extract: 137, 142, 153, 158 to 187, 193 to 207, 213, 219, 224, 229, 234 to 242 | **yes** | frozen | `S=plan/tasks/P8-42a2-loyalty-nits/SPEC.md; sed -n '137p;142p;158p;187p;193p;207p;213p;219p;224p;229p;234p;242p' "$S" \| cut -c1-40` → starts `set -e; for TZV in UTC Pacific/Auckl`, `set -e; S=plan/tasks/P8-42a-loyalty-mo` (this one appears at 142 and again at 213, 219, 224, 229 and 153), `set -e; U=postgresql://localhost/b8_p42a`, `RESET; echo "OK as-of bound"`, `echo "OK failure class"`, `set -e; C=apps/web/components; T=apps/w`, `echo "OK coarse source checks"` | filled at G0 |
| T12 | The commands extracted from P8-42a2 pass on the unmodified tree | **yes** | existing | commands 9 to 12 (run before the implementer starts) | filled at G0 |
| T13 | `vitest` accepts the path filters `packages/contracts/loyalty.test.ts` and `lib/loyaltyCardUi.test.ts` from `apps/web` | **yes** | existing | `(cd apps/web && npx vitest run packages/contracts/loyalty.test.ts 2>&1 \| tail -6)` → `Test Files  1 passed (1)` | filled at G0 |
| T14 | Names `b8_p42a2_empty` is free (P8-42a2 #9 makes and drops it) and no fixture rows with the `zq42b` prefix exist in the throwaway DB | **yes** | n/a | `psql -d postgres -Atc "select count(*) from pg_database where datname='b8_p42a2_empty'"` → `0`; `psql postgresql://localhost/b8_p42a_throwaway -Atc "select count(*) from accounts where id like 'zq42b%'"` → `0` | filled at G0 |
| T15 | Under `set -e`, a leading `!` does NOT abort when the negated command succeeds. This spec writes no `! cmd` guard. | **yes** (documents a hazard) | n/a | `bash -c 'set -e; ! true; echo reached'` → `reached` | filled at G0 |
| T16 | `export PRIOR_REDUCER=6` (P8-42a's T20, applied inside P8-42a2 #5's text) | **yes** | existing | P8-42a2 SPEC line 142 contains `export PRIOR_REDUCER=6` | 6 |
| T17 | `git merge-base HEAD main` resolves, and the work is on a branch or worktree that differs from `main` (the scope guards diff against it; on `main` itself they are vacuous) | **yes** | existing | `git merge-base HEAD main` → a SHA, and `git rev-parse --abbrev-ref HEAD` is not `main` once work starts | filled at G0 |
| T18 | `gifts`, `gift_transactions`, `gift_settings` and `accounts` accept the rows the existing surface script seeds (the same insert shapes) | **yes** | existing | `sed -n '140,144p' apps/web/scripts/gifts-surface-check.mjs` shows the INSERTs | filled at G0 |
| T19 | A browser or jsdom renderer | **NO** | n/a. None is installed. UI wording is proved over real HTTP (the surface script) and by source checks. | n/a | n/a |
| T20 | Live Plaid, the Anthropic API, mail, the dev database `b8_finance`, the owner's real ledger | **NO** | n/a | n/a | n/a |

Prerequisites the implementer must create (none exist today).
- `apps/web/app/api/v1/loyalty/loyaltyCard.test.ts`: a new integration test file, collected by the existing glob `app/api/v1/**/*.test.ts`, so the integration config is not edited. It contains exactly ten tests whose titles begin `T42b-I1:` to `T42b-I10:`.
- `apps/web/lib/loyaltyCardUi.test.ts`: a new unit test file, collected by `lib/**/*.test.ts`. It contains exactly one test whose title begins `T42b-U4:`.
- Three tests added to the existing `packages/contracts/loyalty.test.ts`, titles beginning `T42b-U1:`, `T42b-U2:`, `T42b-U3:`.
- One new migration file, `db/schema.sql` updated, and the contract change above (guardian).
- A new step `H12` in `apps/web/scripts/gifts-surface-check.mjs`, and the script's closing line becomes `OK H1-H12`.
- Totals after the task: unit 104 files and 1410 tests; integration 334 tests (324 + 10).
- No fixture CSV is added or changed. P8-42a #13 still asserts exactly four `loyalty-import.*.csv` files.

## Open questions with defaults
The spec is written assuming every default. The orchestrator may confirm or override before G0.
1. **Fee-detection rule.** Default: the row's `name`, whitespace collapsed and case-folded, contains the whole-word phrase `annual membership fee` or `annual fee`; `amount > 0`; not in a transfer group; category does not participate; `merchant_name` does not participate; `hidden` rows count. Why: the owner's measured fee rows are named `ANNUAL MEMBERSHIP FEE`, the detailed category is `BANK_FEES_OTHER_BANK_FEES` on some and empty on others, and other `BANK_FEES_*` rows are late fees and interest, so category can neither include nor decide. A card with no Plaid feed has only `name` and `amount`, so the rule uses only what every row has. Whole-word matching stops `BIANNUAL FEE` and `ANNUAL FEES` from matching. Alternative: add the category as a second, OR'd signal. Rejected: it would admit `FOREIGN TRANSACTION FEE` rows that carry the same category.
2. **Refund handling.** Default as in Conventions: same account, exact negated amount, posted on or after the fee, name containing a fee phrase or `refund`, `reversal` or `reversed`; one refund cancels at most one fee (the latest on or before it); a cancelled latest fee gives `no_fee_seen`. Why exact amount and a name condition: an equal-amount card payment must not void a fee. Known limit: a partial refund, or a refund whose bank text carries none of those words, leaves the fee posted; stated, not fixed.
3. **Which date.** Default: the posted `date`. Why: `authorized_date` is null on every non-Plaid row and on every row masked by a gift, the benefit arrives after posting, and the window is counted from posting. Alternative rejected: authorized date, because it makes the answer depend on the feed.
4. **Default window.** Default 45 days, range 1 to 365, stored on the link when a benefit is set without a window. Why: issuers typically deliver an anniversary benefit within some weeks after the fee; 45 avoids a false "overdue" at 30 and still flags a miss within about a month and a half. It is editable per link. Alternative: 30 (noisier) or 60 (slower to warn).
5. **One card, several memberships?** Default: no. A card links to at most one membership, enforced by a unique index, answered 409 `CARD_ALREADY_LINKED`. A membership has one card (the column is single). Why: one fee row would otherwise open two expectations and double-count a single charge. A co-branded card earns into one program. A reissued card is a new account id, and re-linking is one tap.
6. **Where the benefit description lives.** Default: three nullable columns on `loyalty_memberships` (`benefit_kind`, `benefit_description`, `benefit_window_days`), because the benefit is described once per link and a membership has at most one link. Why not a new table: a one-to-one table adds a join and a failure mode for no gain. The spec fixes the column names because commands query them. Unlinking keeps the benefit text (it is inert without a card and survives a card reissue). A database-level `SET NULL` after an account is deleted leaves it too, which is why no CHECK ties the benefit to the card.
7. **Gift surface class and gift-held rows.** Default: `/travel` becomes `numeric-only`, and so do `GET /api/v1/loyalty`, `POST /api/v1/loyalty/memberships`, `PATCH /api/v1/loyalty/memberships/[id]` and `POST /api/v1/loyalty/memberships/[id]/observations` (each returns a membership view that now carries a fee date derived from a ledger row). `/accounts/[id]` stays `text-bearing` (H2, unchanged). The other seven loyalty routes stay `no-transaction-data`. Why `numeric-only` and not `text-bearing`: the surfaces carry a date and a state, never a row's name, merchant or note, and the answer is identical for every viewer.
   - **Can a fee row be a gift?** Yes. A gift is matched by amount or merchant, and a giver could mark an annual-fee row. A held row's name is `Gift` for a non-giver, so it would not match for them, but the giver would see the real row and get a different answer. The spec therefore makes a held row never a fee for anyone, which keeps the figure the same for every viewer, the repo's rule for derived figures. The read path is still used (the fee rows are read through `visibleTransactions`), which `T42b-I8`, the surface step `H12`, the wiring test `W1` and the unchanged `T42a-C10` source check all prove.
8. **Unlink semantics.** Default: unlink sets only `card_account_id` to null. Instruments, the benefit columns and everything else stay. A later link restores the expectation.
9. **Show the fee amount?** Default: no, anywhere. ITEM.md permits it. Why not: no figure is needed to answer "did the benefit arrive", a ledger amount on a loyalty page is a new place for a money figure to leak, and the rule "no figure copied into a loyalty table" is easiest to keep when none is carried at all.
10. **Recorded date when `issued_on` is unknown.** Default: `created_at` as a date in the database session's time zone; a known `issued_on` always wins and `created_at` is then ignored. This is what ITEM.md means by "issued, or, if its issue date is unknown, recorded".
11. **Which fee counts.** Default: only the most recent fee row, by posted date then id. If it is cancelled by a refund the answer is `no_fee_seen`. Why not fall back to an older fee: ledger history starts in 2026 so there is rarely an older one, and resurrecting last year's fee would raise a false overdue.
12. **Bearer tokens and viewers.** Default: the answer is the same for every caller (cookie user or bearer token of any scope), because it does not depend on the viewer; a read-scope token may read it and is refused every write.

## Scenarios
All fixtures are fabricated and canary-marked `ZQ42B`. Every date is computed relative to Postgres `CURRENT_DATE` (a helper that runs `SELECT (CURRENT_DATE + n)::text`, as `pgDay` does in `loyalty.test.ts`), never the JS clock. `T` below means `CURRENT_DATE`. Each integration test seeds what it asserts on and cleans its own rows. A fabricated fee amount is chosen once per test and is unique within the fixture, so it can be searched for in a response. No scenario reads the dev database.

| Id | Observable rule | Fixture and assertion | Catches |
|---|---|---|---|
| T42b-U1 | The membership PATCH body accepts the link and the benefit, and refuses everything else. | `LoyaltyMembershipPatchRequestSchema`: accepts `{cardAccountId:'zq42b_a'}`, `{cardAccountId:null}`, `{benefit:{kind:'free_night',description:'ZQ42B night'}}`, the same with `windowDays` 1, 45 and 365, `{benefit:null}`, and a body combining link, benefit and tier. Refuses: `cardAccountId` as `''`, a number or an object; `windowDays` 0, 366, 1.5, `-1` and the string `'30'`; an unknown `kind`; a blank or whitespace description; a description of 201 characters; a stray key inside `benefit`; a stray top-level key; `{}`. | A schema that accepts anything, a float or string window, a missing bound. |
| T42b-U2 | A membership response carries the new fields and its `feeWatch` is internally consistent. | `LoyaltyMembershipSchema` (with the existing `membership()` fixture plus the new keys all null) parses. A `feeWatch` of `{feeDate:null,expectedBy:null,state:null}` and of `{feeDate:'2026-01-05',expectedBy:null,state:null}` parse (linked, no benefit). All four states parse with the dates the rules require. Refused: `no_fee_seen` with a date; `awaiting`, `received` or `overdue` with a null `feeDate` or `expectedBy`; a state outside the four; `state:null` with a non-null `expectedBy`; a malformed date; an extra key in `feeWatch` or `benefit`; a missing `cardAccountId`, `benefit` or `feeWatch` key; a `feeWatch` carrying an `amount`. `LoyaltyOverviewSchema` requires `cardAccounts` and parses it as `[]` and as `[{id,name}]`. | A state that can contradict its dates, a leaked amount key, an optional field where required. |
| T42b-U3 | The create schema still refuses the link and the benefit, and the new error code exists. | `LoyaltyMembershipCreateRequestSchema.safeParse({memberId:1,programId:2,cardAccountId:'zq42b'})` and with `benefit` are failures. `LoyaltyErrorCodeSchema` accepts `CARD_ALREADY_LINKED` and still accepts every earlier code. | A link or benefit opened on create, a missing or renamed code. |
| T42b-U4 | The pages carry the fixed wording and the controls, and the new text has one home. | Source checks over `apps/web/components`, `apps/web/app/travel` and `apps/web/app/accounts/[id]/page.tsx`. The strings `Annual fee posted`, `No annual fee seen yet`, `expected by`, `Earns into`, `Link a card`, `Unlink card`, `Set benefit` each occur in a non-test source. `Earns into` occurs in the account page's rendering path. `cardAccountId: null` occurs in exactly one non-test source line, inside a handler attached through a JSX `on…` attribute on the element whose text contains `Unlink card`. No component or the travel page imports `db` or `@/lib/db` directly or contains `FROM transactions`. Fabricated violating sources are fed to each checker and must be rejected: a second `cardAccountId: null`, a handler not attached to `Unlink card`, a missing phrase, a raw transactions read. A clean source is accepted. | A control that is missing, a second unlink path, a page reading the ledger itself. |
| T42b-I1 | Link and unlink obey the rules. | Route handlers against the throwaway DB. Accounts: a credit card with a Plaid feed, a credit card with no feed (`access_token` null), and one each of `depository`, `investment` and `loan` types. `PATCH {cardAccountId}` to either credit account → 200, `cardAccountId` and `cardAccountName` returned and the column set. Each of the three other types → 400 `INVALID_INPUT`, column still null, loyalty checksum unchanged. An unknown account id → 400, unchanged. A second membership linking an already-linked card → 409 `CARD_ALREADY_LINKED`, the first link intact. A direct SQL `UPDATE` setting a second membership to a linked card fails with unique violation `23505`. Re-linking the same membership to the same card → 200 (idempotent). Moving a membership from card A to card B → 200, A is free and can be linked by another membership. `{cardAccountId:null}` → 200, `cardAccountId` null, `feeWatch` null, `benefit` unchanged. `GET /api/v1/loyalty` returns `cardAccounts` whose ids are exactly the credit account ids (the other types absent), ordered by name then id. A read-scope bearer token PATCHing a link → 403 `INSUFFICIENT_SCOPE` with the row unchanged; no session → 401. | A non-credit link, a shared card, a 500 on a lost race, an open picker, a write by a read token. |
| T42b-I2 | The benefit is stored and validated, and the window defaults. | `PATCH {benefit:{kind:'free_night',description:'ZQ42B night'}}` → 200 and `benefit_window_days` is `45` in the table, `benefit` returned as `{kind,description,windowDays:45}`. `windowDays:10` stores 10. `{benefit:null}` sets the three columns to null. A benefit on an unlinked membership is accepted and returns `feeWatch` null. Each invalid body of T42b-U1 through the route → 400 `INVALID_INPUT` with the row unchanged. A direct SQL `UPDATE` writing a kind with a null description, a window with a null kind, a window of 0 or 366, an unknown kind, a 201-character description and an untrimmed description each fail with `23514`. A description echo is absent from every error body. | A missing default, an unbounded window, a half-described benefit, a bad kind stored. |
| T42b-I3 | The fee-detection rule, as a matrix. | One linked card per case (a distinct member and the account `zq42b_case_<n>`), benefit described, one candidate row dated `T-10`. **Detected** (the case's `feeDate` equals the row's posted date, `state` is `awaiting`): (a) `ZQ42B ANNUAL MEMBERSHIP FEE`, detailed category `BANK_FEES_OTHER_BANK_FEES`; (b) the same name with a null category on an account with no feed and null `plaid_raw`; (c) `zq42b Annual Fee`; (d) the same name with `hidden = TRUE`; (e) `ZQ42B  ANNUAL   MEMBERSHIP FEE` with doubled spaces; (f) `ZQ42B ANNUAL MEMBERSHIP FEE 00123` with a trailing reference. **Not detected** (`feeDate` null, `state` `no_fee_seen`): (g) `ZQ42B LATE FEE`, category `BANK_FEES_LATE_PAYMENT`; (h) `ZQ42B PURCHASE INTEREST CHARGE`, category `BANK_FEES_INTEREST_CHARGES`; (i) `ZQ42B FOREIGN TRANSACTION FEE` with category `BANK_FEES_OTHER_BANK_FEES`; (j) the fee name with a negative amount; (k) the fee name with amount `0.00`; (l) the fee name on a different credit account that is not linked, while the linked card has no such row; (m) the fee name with a non-null `transfer_group_id`; (n) `ZQ42B BIANNUAL FEE`; (o) a row whose `merchant_name` is `ZQ42B ANNUAL MEMBERSHIP FEE` but whose `name` is `ZQ42B POS 0001`. | A category-only rule, a rule needing Plaid fields, a missing sign check, a substring match, a clock-dependent result. |
| T42b-I4 | Which fee and which date. | Two fee rows on one card: the newer-dated one (`T-20`) inserted first (lower id) and the older-dated one (`T-400`) inserted second (higher id) → `feeDate` is the `T-20` date (date order, not insertion order). A row with `date = T-20` and `authorized_date = T-23` → `feeDate` is the `T-20` date and `expectedBy` is that plus the window (not authorized plus window). Two fee rows with the same posted date and different ids → one `feeDate`, and the membership appears once in `cards`. The membership count and order in `GET /api/v1/loyalty` equal what the same memberships give with the card unlinked. | An insertion-order assumption, the authorized date, a duplicate line from a join. |
| T42b-I5 | Refunds. | Fee `T-20` on each case. **Cancelled** (`feeDate` null, `state` `no_fee_seen`): an equal-negated credit dated `T-10` named `ZQ42B ANNUAL MEMBERSHIP FEE REFUND`; the same with the name `ZQ42B STATEMENT REFUND`. **Not cancelled** (`feeDate` is the `T-20` date): a credit of the exact negated amount named `ZQ42B PAYMENT THANK YOU`; a refund-named credit of a different amount; a refund-named, exact-amount credit dated before the fee; a refund-named, exact-amount credit on a different account. **Pairing:** two equal-amount fees (`T-400`, `T-20`) with one refund dated `T-10` → the latest fee is cancelled, `feeDate` null; with the refund dated `T-100` it cancels the `T-400` fee, the `T-20` fee stands and `feeDate` is the `T-20` date. | A payment voiding a fee, a partial refund voiding a fee, a refund before the fee voiding it, a refund on another account voiding it, a refund voiding two fees, a float comparison. |
| T42b-I6 | The four states, at their boundaries. | Window 45, benefit kind `free_night`, no instrument unless stated. No fee row → `no_fee_seen`, both dates null. Fee `T-10` → `awaiting`, `expectedBy` = `T+35`. Fee `T-45` → `awaiting`, `expectedBy` = `T` (the boundary day). Fee `T-46` → `overdue`, `expectedBy` = `T-1`. Fee dated `T` → `awaiting`. Window 10: fee `T-10` → `awaiting`, fee `T-11` → `overdue`. Fee `T-100` with a `free_night` instrument issued `T-90` → `received` (wins over overdue). A linked card with no benefit and a fee row → `state` null, `feeDate` set, `expectedBy` null. A linked card with no benefit and no fee → `feeWatch` `{feeDate:null,expectedBy:null,state:null}`. An unlinked membership with a benefit → `feeWatch` null. Each `expectedBy` and `feeDate` is compared with the Postgres-computed text. | An off-by-one on the window, `>` for `>=`, a JS clock, null shown as a state, received not winning. |
| T42b-I7 | What closes the expectation. | Fee `T-30`, window 45, benefit `free_night`, state `awaiting` before each case, instruments reset between cases. **Do not close:** an instrument of kind `travel_credit` issued `T-5`; a `free_night` on a different membership issued `T-5`; a `free_night` with `issued_on` = fee date − 1; a `free_night` with `issued_on` null and `created_at` the midday before the fee date; a `free_night` with `issued_on` = fee date − 1 and `created_at` today (a known issue date wins over the recorded date). **Close** (`received`): a `free_night` with `issued_on` = the fee date; with `issued_on` null and `created_at` midday of the fee date; with `issued_on` null and `created_at` today; with `used_on` set; with `issued_on` after `expectedBy` (a late arrival). Two matching instruments → still one membership line and `received`. Benefit kind `other` closes only on an `other` instrument. | The wrong kind or membership closing it, an instrument before the fee closing it, the recorded date overriding a known issue date, a double line from joining instruments. |
| T42b-I8 | A gift-held row is never a fee, for any viewer, and the read path is used. | A linked card with an otherwise-valid fee row `T-5`, linked to a gift whose giver is the second user, recipient the owner, `reveal_date` = `T+30`. Responses for the owner (recipient), the second user (giver) and a bearer token: all three have `state` `no_fee_seen`, `feeDate` null, and the response text holds neither the row's name nor `ZQ42B ANNUAL`. With `reveal_date` = `T+1` still held (all three viewers). With `reveal_date` = `T` and with `T-1`: all three have `feeDate` = the row's date and `state` `awaiting`. A control: an ordinary non-gift fee row on a second linked card is detected throughout (so the test is not vacuous). The four responses per step are identical across viewers. | A giver-only exclusion, a non-giver seeing the real row, a held row counting, a gift boundary off by one, an always-null detection. |
| T42b-I9 | Nothing is stored, the shape is exact, and unlinking leaves instruments. | After the state transitions of I6, the loyalty tables' checksum (the same one `loyalty.test.ts` computes) is unchanged by two `GET`s and by inserting and deleting transactions. A membership view's key set is exactly `id, memberId, memberDisplayName, programId, memberNumberMasked, tier, balance, unit, asOf, source, cardAccountId, cardAccountName, benefit, feeWatch`; `feeWatch`'s is `feeDate, expectedBy, state`; `benefit`'s is `kind, description, windowDays`. The serialised overview contains neither the fee row's amount text nor its name. Unlinking leaves `loyalty_instruments` row-for-row identical (checksum) and the benefit columns intact. Deleting the linked account (no transactions) leaves the membership, its instruments and benefit, with `card_account_id` null and `feeWatch` null, and no error. | A stored fee or state, an emitted amount, instruments removed by an unlink, a delete that fails or cascades. |
| T42b-I10 | No side effects on the ledger, and the routes stay peers. | Net worth (`computeCurrentNetWorth`), the ledger overview response, and row checksums of `accounts` and `transactions`, taken before and after linking, setting a benefit and unlinking: identical. Both b8 users get identical `feeWatch` bodies. A read-scope token reads the view and is refused each write. The loyalty route files number 11. | A write to the ledger, a figure that changes net worth, a viewer-dependent answer, a new route. |
| T42b-H12 | Over real HTTP, with a held row, the pages and the API agree and show the wording. | In `gifts-surface-check.mjs`, after H11, on its scratch database `b8_gifts_check`. Seed (psql): a household member and a membership on a catalog program, benefit `free_night` described as `ZQ42B night` with the default window; the fabricated credit account the script already creates is the card; a fee row named `ZQ42B ANNUAL MEMBERSHIP FEE`, dated `CURRENT_DATE - 5`, held by a second gift (giver the second user, recipient the owner, `reveal_date` = `CURRENT_DATE + 30`). Steps, each for the owner and the second user, on `/travel`, `/accounts/<card>` and `/api/v1/loyalty` (HTML with `<!-- -->` comments removed): (1) card **unlinked**: the account page has no `Earns into`; the API shows `cardAccountId` null and `feeWatch` null. (2) Linked and held: the API shows `state` `no_fee_seen`; the HTML holds `No annual fee seen yet`; no response holds `ZQ42B ANNUAL` or the fee amount; `/accounts/<card>` holds `Earns into`, the program name, `ZQ42B night`. (3) Reveal date `CURRENT_DATE - 1`: both viewers' API shows `feeDate` = the Postgres date `CURRENT_DATE - 5`, `state` `awaiting`, `expectedBy` = `CURRENT_DATE + 40`; the HTML holds `Annual fee posted`, both dates and `expected by`; the HTML does not hold `overdue` or `received` on `/travel`'s membership line. (4) Reveal date back to `CURRENT_DATE + 30`: masked again, `no_fee_seen`. (5) Fee date moved to `CURRENT_DATE - 60`, reveal passed: `overdue`, the HTML holds `overdue`. (6) A `free_night` instrument issued `CURRENT_DATE - 1`: `received`, the HTML holds `received`. (7) Benefit cleared: `state` null, `feeDate` present, no `expected by`. (8) Unlinked again: no `Earns into` on the account page. The step prints `H12 PASS …` and the final line is `OK H1-H12`. | A page that does not render the state, a held row leaking by name or amount or date, a viewer-dependent answer, a stale class, a sticky unlink. |

## Acceptance commands

**Amendment A2 (orchestrator, at G2, 2026-11-20).** A1 brings `apps/web/lib/loyalty.test.ts` into the change set, so command 15's clock/float scan reads it and matches its pre-existing line 494, which is T42a's own absence assertion (`not.toMatch(/toISOString|new Date\(|…/)`), present at `HEAD`. Command 15's scoped list now excludes exactly that file (`| grep -vxF apps/web/lib/loyalty.test.ts`). The A1 guard already pins that file's diff to five lines, none of them a clock or float use.

**Amendment A1 (orchestrator, at G2, 2026-11-20).** P8-42a's `T42a-U8` (`apps/web/lib/loyalty.test.ts`) pinned every loyalty route and `/travel` to `no-transaction-data` and the surface script to `OK H1-H11`; commands 13 and 14 require the reverse, so no tree passed both (reported by the implementer, not absorbed). A1 permits exactly five line changes in that test, each to the new required state at the same strictness: the comment, the per-route class (the four membership-view routes `numeric-only`, the seven others `no-transaction-data`, via a literal list), `/travel`'s registry class, the script's travel line, and `OK H1-H12`. The guard below is appended to command 17 and must print its OK line.
```
# A1 guard: lib/loyalty.test.ts changed only in T42a-U8's five class/terminal lines (5 removed, 7 added).
D="$(git diff -U0 "$(git merge-base HEAD main)" -- apps/web/lib/loyalty.test.ts)"
[ "$(printf '%s\n' "$D" | grep -c '^-[^-]')" = 5 ] || { echo "FAIL A1 removed-line count"; exit 1; }
[ "$(printf '%s\n' "$D" | grep -c '^+[^+]')" = 7 ] || { echo "FAIL A1 added-line count"; exit 1; }
if printf '%s\n' "$D" | grep '^-[^-]' | grep -vE "Registry: exactly the eleven|for \(const r of listed\)|app/travel/page.tsx|OK H1-H11"; then echo "FAIL A1 unexpected removal"; exit 1; fi
echo "OK A1 limited to T42a-U8"
```
All run from the repo root under `bash`. `U=postgresql://localhost/b8_p42a_throwaway`. Dates come from Postgres inside the tests, never the wall clock. No command uses a leading `!` as a guard (T15). Where a command asserts absence it uses `if … then …; exit 1; fi` or an explicit string comparison. Run order: 1 to 3, then 4 (brings `$U` to the new head and proves up/down/up), then the rest.

| # | Command | Expected | Would break if |
|---|---|---|---|
| 1 | `(cd apps/web && npx tsc --noEmit --incremental false; echo "exit=$?")` | `exit=0` | a type or consumer is broken by the new required response fields |
| 2 | `npm run lint; echo "exit=$?"` | `exit=0`, 0 errors, warnings not above 5 | a lint regression |
| 3 | `npm test 2>&1 \| tail -8` | `Test Files  104 passed (104)` and `Tests  1410 passed (1410)` | a missing or extra new test, a broken existing test |
| 4 | Migration up, schema shape and down/up data survival, below | `OK migration up-down-up` | a wrong column, a down that destroys the link or instruments, a missing unique index |
| 5 | Stored-state schema check and stale-comment check, below | `OK schema` | a stored fee, state or amount column, a new table, a stale "reserved" comment, `db/schema.sql` out of step |
| 6 | New unit scenarios, below | two lines `OK 4 scenarios T42b-U1..U4 each present once and passed; TZ=<zone>` | a missing or duplicated scenario, a zone-dependent result |
| 7 | Integration scenarios, below | `OK 334 tests, T42a-C1-C11 and I1-I11 and T42a2-I1-I3 and T42b-I1-I10 each present once and passed; no fixture rows left` | any new rule fails, an old scenario regresses, a leftover fixture row, a failing title outside KNOWN |
| 8 | Integration stability, P8-42a #7 extracted, below | `[]`, `[]`, `OK failing set stable and within KNOWN` | an order-dependent or leaking new test |
| 9 | Regression, unit: P8-42a #4 and P8-42a2 #4, below | two `OK 10 scenarios U1-U10 …` lines (UTC, Pacific/Auckland) and two `OK 3 scenarios T42a2-U1..U3 …` lines | the member-number, mask, reducer or clear-control guarantees disturbed |
| 10 | Regression, import: P8-42a2 #8 and #9, below | `OK as-of bound` and `OK failure class` | the import script or the new migration disturbed the import |
| 11 | Regression, import end to end: P8-42a2 #10 (P8-42a #9), below | `OK import end to end` | the 20-line import stdout contract or its leak guards |
| 12 | Regression, sidebar, source guards, fixtures, coarse checks, below | `OK sidebar`, `OK source guards`, `OK fixtures fabricated`, `OK coarse source checks` | the sidebar, a clock or float use, a fixture added, a second `memberNumber: null` sender, a new `/member-number` reader |
| 13 | Surface script over real HTTP, below | `H1 PASS` to `H12 PASS` each once, last line `OK H1-H12`, `OK surface` | any page or API leak, a wrong class, wording missing, a viewer-dependent answer |
| 14 | Registry and script classes, below | `OK classes` | a missed re-classification, a stale `no-transaction-data` |
| 15 | Source guards for this task, below | `OK task source guards` | a raw ledger read, a JS clock, a stale comment, a missing canary |
| 16 | Scope guard, below | no output | a file outside the allowed set changed, a required file missing, the applied migration edited |
| 17 | Additions-only and census guard, below | no output except `OK existing tests only gained the new keys; removed lines <n>` | a weakened existing test, a missing or extra new test title |
| 18 | `npm run build; echo "exit=$?"` | `exit=0` | a type or bundling error |

**#4 (migration, shape and survival).**
```
set -e; U=postgresql://localhost/b8_p42a_throwaway
Q(){ psql "$U" -v ON_ERROR_STOP=1 -Atq -c "$1"; }
MIG(){ DATABASE_URL="$U" npm run "$1" >/dev/null 2>&1; }
COLS="SELECT string_agg(column_name, ',' ORDER BY column_name COLLATE \"C\") FROM information_schema.columns WHERE table_schema='public' AND table_name='loyalty_memberships'"
NEW="benefit_description,benefit_kind,benefit_window_days,card_account_id,created_at,id,member_id,member_number,program_id,tier"
OLD="card_account_id,created_at,id,member_id,member_number,program_id,tier"
MIG migrate:up
LATEST="$(Q "SELECT name FROM pgmigrations ORDER BY id DESC LIMIT 1")"
if [[ "$LATEST" == 1792700000000_loyalty ]]; then echo "FAIL no migration newer than the loyalty one"; exit 1; fi
[[ "$LATEST" > "1792700000000_loyalty" ]]
[ "$(Q "$COLS")" = "$NEW" ]
Q "TRUNCATE loyalty_instruments, loyalty_observations, loyalty_memberships, household_members RESTART IDENTITY CASCADE"
Q "DELETE FROM accounts WHERE id='zq42b_mig_card'"
Q "INSERT INTO accounts (id, name, type) VALUES ('zq42b_mig_card', 'ZQ42B Migration Card', 'credit')"
Q "INSERT INTO household_members (display_name) VALUES ('ZQ42B Mig')"
Q "INSERT INTO loyalty_memberships (member_id, program_id, card_account_id, benefit_kind, benefit_description, benefit_window_days) SELECT (SELECT id FROM household_members), (SELECT min(id) FROM loyalty_programs), 'zq42b_mig_card', 'free_night', 'ZQ42B night', 45"
Q "INSERT INTO loyalty_instruments (membership_id, kind, description, source) SELECT id, 'free_night', 'ZQ42B kept', 'typed' FROM loyalty_memberships"
MIG migrate:down
[ "$(Q "$COLS")" = "$OLD" ]
[ "$(Q "SELECT card_account_id || '/' || (SELECT count(*) FROM loyalty_instruments) FROM loyalty_memberships")" = "zq42b_mig_card/1" ]
MIG migrate:up
[ "$(Q "$COLS")" = "$NEW" ]
[ "$(Q "SELECT card_account_id || '/' || coalesce(benefit_kind, 'NULL') || '/' || (SELECT count(*) FROM loyalty_instruments) FROM loyalty_memberships")" = "zq42b_mig_card/NULL/1" ]
Q "TRUNCATE loyalty_instruments, loyalty_observations, loyalty_memberships, household_members RESTART IDENTITY CASCADE"
Q "DELETE FROM accounts WHERE id='zq42b_mig_card'"
echo "OK migration up-down-up"
```
After the `down`, the benefit text is intentionally gone (the columns are dropped). The link and the instrument survive. The `down` must be the new migration, which the `LATEST` guard asserts.

**#5 (stored-state schema check, written without `!`).**
```
set -e; U=postgresql://localhost/b8_p42a_throwaway
Q(){ psql "$U" -v ON_ERROR_STOP=1 -Atq -c "$1"; }
[ "$(Q "SELECT string_agg(table_name, ',' ORDER BY table_name COLLATE \"C\") FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE 'loyalty%' OR table_name='household_members')")" = "household_members,loyalty_instruments,loyalty_memberships,loyalty_observations,loyalty_program_aliases,loyalty_programs" ]
[ "$(Q "SELECT string_agg(column_name, ',' ORDER BY column_name COLLATE \"C\") FROM information_schema.columns WHERE table_schema='public' AND table_name='loyalty_instruments'")" = "created_at,description,expires_on,id,issued_on,kind,membership_id,source,used_on" ]
[ "$(Q "SELECT string_agg(column_name, ',' ORDER BY column_name COLLATE \"C\") FROM information_schema.columns WHERE table_schema='public' AND table_name='loyalty_observations'")" = "as_of,balance,id,membership_id,recorded_at,source,unit" ]
[ "$(Q "SELECT string_agg(column_name, ',' ORDER BY column_name COLLATE \"C\") FROM information_schema.columns WHERE table_schema='public' AND table_name='loyalty_memberships'")" = "benefit_description,benefit_kind,benefit_window_days,card_account_id,created_at,id,member_id,member_number,program_id,tier" ]
[ "$(Q "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND (table_name LIKE 'loyalty%' OR table_name='household_members') AND column_name ~* 'fee|state|status|expect|await|receiv|overdue|amount|due'")" = 0 ]
[ "$(Q "SELECT count(*) FROM pg_indexes WHERE tablename='loyalty_memberships' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%(card_account_id)%'")" = 1 ]
BLK="$(awk '/^CREATE TABLE loyalty_memberships/{f=1} f{print} f&&/^\);/{exit}' db/schema.sql)"
for c in benefit_kind benefit_description benefit_window_days card_account_id; do printf '%s\n' "$BLK" | grep -q "$c"; done
[ "$(grep -c 'benefit_kind' db/schema.sql)" -ge 2 ]
if grep -n 'reserved for step 42b' db/schema.sql packages/contracts/loyalty.ts apps/web/lib/loyaltyStore.ts; then echo "FAIL stale reserved comment"; exit 1; fi
if grep -n 'reserved for a later step' apps/web/lib/loyaltyStore.ts; then echo "FAIL stale reserved comment in the store"; exit 1; fi
if git ls-files migrations | xargs grep -ln 'benefit_kind' | grep -v '_loyalty_card_benefit' | grep -q .; then echo "FAIL benefit columns written in an old migration"; exit 1; fi
echo "OK schema"
```
`[ "$(grep -c 'benefit_kind' db/schema.sql)" -ge 2 ]` asks for the column and its CHECK or comment.

**#6 (new unit scenarios; two zones).**
```
set -e; for TZV in UTC Pacific/Auckland; do O="$(mktemp)"; (cd apps/web && TZ=$TZV npx vitest run packages/contracts/loyalty.test.ts lib/loyaltyCardUi.test.ts --reporter=json --outputFile="$O") || true; node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);let bad=[];for(const id of ["U1","U2","U3","U4"]){const m=t.filter(x=>x.title.startsWith("T42b-"+id+":"));if(m.length!==1||m[0].status!=="passed")bad.push(id+"="+m.map(x=>x.status).join("/")+"("+m.length+")")}const failed=t.filter(x=>x.status!=="passed").map(x=>x.title);if(bad.length||failed.length||r.testResults.length!==2){console.log("FAIL",process.argv[2],bad.join(","),failed.join(";"),"files="+r.testResults.length);process.exit(1)}console.log("OK 4 scenarios T42b-U1..U4 each present once and passed; TZ="+process.argv[2])' "$O" "$TZV"; done
```

**#7 (integration scenarios from one run; the cleanup check follows it).**
```
set -e; U=postgresql://localhost/b8_p42a_throwaway; O="$(mktemp)"; (cd apps/web && DATABASE_URL=$U npx vitest run --config vitest.integration.config.mts --reporter=json --outputFile="$O") || true
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);let bad=[];const want=[];for(let i=1;i<=11;i++){want.push("T42a-C"+i+":","T42a-I"+i+":")}want.push("T42a2-I1:","T42a2-I2:","T42a2-I3:");for(let i=1;i<=10;i++)want.push("T42b-I"+i+":");for(const p of want){const m=t.filter(x=>x.title.startsWith(p));if(m.length!==1||m[0].status!=="passed")bad.push(p+m.map(x=>x.status).join("/")+"("+m.length+")")}const KNOWN=["the pre-auth ceremony endpoints remain reachable with no session cookie at all","the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio"];const unexpected=t.filter(x=>x.status==="failed"&&!KNOWN.includes(x.title)&&!x.title.startsWith("RC-03:")).map(x=>x.title);if(unexpected.length||bad.length||t.length!==334){console.log("FAIL",unexpected.join(" ; "),bad.join(","),"total="+t.length);process.exit(1)}console.log("OK 334 tests, T42a-C1-C11 and I1-I11 and T42a2-I1-I3 and T42b-I1-I10 each present once and passed")' "$O"
LEFT="$(psql "$U" -v ON_ERROR_STOP=1 -Atq -c "SELECT (SELECT count(*) FROM accounts WHERE id LIKE 'zq42b%')||','||(SELECT count(*) FROM gifts WHERE merchant LIKE 'ZQ42B%')||','||(SELECT count(*) FROM transactions WHERE account_id LIKE 'zq42b%')")"
[ "$LEFT" = "0,0,0" ]
echo "OK no fixture rows left"
```
The expected output is the `OK 334 tests …` line and then `OK no fixture rows left`.

**#8 (integration stability; P8-42a #7 extracted unchanged via P8-42a2's wrapper).**
```
set -e; S2=plan/tasks/P8-42a2-loyalty-nits/SPEC.md
G(){ case "$(sed -n "${2}p" "$1")" in "$3"*) ;; *) echo "FAIL $1 line $2 moved"; exit 1;; esac; }
G "$S2" 153 "set -e; S=plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md; case \"\$(sed -n '228p'"
bash -c "$(sed -n '153p' "$S2")"
```

**#9 (regression, unit: P8-42a #4 and P8-42a2 #4).**
```
set -e; S2=plan/tasks/P8-42a2-loyalty-nits/SPEC.md
G(){ case "$(sed -n "${2}p" "$1")" in "$3"*) ;; *) echo "FAIL $1 line $2 moved"; exit 1;; esac; }
G "$S2" 142 "set -e; S=plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md; case \"\$(sed -n '212p'"
G "$S2" 137 'set -e; for TZV in UTC Pacific/Auckland; do O='
bash -c "$(sed -n '142p' "$S2")"
bash -c "$(sed -n '137p' "$S2")"
```
Those unit regressions parse `components/LoyaltyMembershipLine.tsx` and read the loyalty sources, so a 42b edit to them must keep the P8-42a2 guarantees.

**#10 (regression, import: P8-42a2 #8 and #9).**
```
set -e; S2=plan/tasks/P8-42a2-loyalty-nits/SPEC.md
G(){ case "$(sed -n "${2}p" "$1")" in "$3"*) ;; *) echo "FAIL $1 line $2 moved"; exit 1;; esac; }
G "$S2" 158 'set -e; U=postgresql://localhost/b8_p42a_throwaway; F=scripts/fixtures; CSV='
[ "$(sed -n '187p' "$S2")" = 'RESET; echo "OK as-of bound"' ]
bash -c "$(sed -n '158,187p' "$S2")"
G "$S2" 193 'set -e; U=postgresql://localhost/b8_p42a_throwaway; E=b8_p42a2_empty;'
[ "$(sed -n '207p' "$S2")" = 'echo "OK failure class"' ]
bash -c "$(sed -n '193,207p' "$S2")"
```

**#11 (regression, import end to end: P8-42a2 #10).**
```
set -e; S2=plan/tasks/P8-42a2-loyalty-nits/SPEC.md
G(){ case "$(sed -n "${2}p" "$1")" in "$3"*) ;; *) echo "FAIL $1 line $2 moved"; exit 1;; esac; }
G "$S2" 213 "set -e; S=plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md; case \"\$(sed -n '233p'"
bash -c "$(sed -n '213p' "$S2")"
```

**#12 (regression: sidebar, source guards, fixtures, coarse checks).**
```
set -e; S2=plan/tasks/P8-42a2-loyalty-nits/SPEC.md
G(){ case "$(sed -n "${2}p" "$1")" in "$3"*) ;; *) echo "FAIL $1 line $2 moved"; exit 1;; esac; }
G "$S2" 219 "set -e; S=plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md; case \"\$(sed -n '294p'"
G "$S2" 224 "set -e; S=plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md; case \"\$(sed -n '299p'"
G "$S2" 229 "set -e; S=plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md; case \"\$(sed -n '304p'"
G "$S2" 234 'set -e; C=apps/web/components; T=apps/web/app/travel; S=apps/web/scripts/import-loyalty.ts'
[ "$(sed -n '242p' "$S2")" = 'echo "OK coarse source checks"' ]
bash -c "$(sed -n '219p' "$S2")"
bash -c "$(sed -n '224p' "$S2")"
bash -c "$(sed -n '229p' "$S2")"
bash -c "$(sed -n '234,242p' "$S2")"
```
The expected output is the four `OK` lines in that order. The P8-42a `!` guards inside lines 224 are weak under `set -e` (T15); command 15 and `T42a-C10` carry the real assertions for this task.

**#13 (surface script over real HTTP).**
```
set -e; OUT="$(mktemp)"; node apps/web/scripts/gifts-surface-check.mjs > "$OUT"; cat "$OUT"
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do [ "$(grep -cE "^H$i PASS " "$OUT")" = 1 ]; done
[ "$(tail -1 "$OUT")" = "OK H1-H12" ]
if grep -qE 'FAIL' "$OUT"; then echo "FAIL a step failed"; exit 1; fi
echo "OK surface"
```
The script exits non-zero on any failing step, which aborts under `set -e`. Port 3198 must be free (T9).

**#14 (registry and script classes; fixed-string checks).**
```
set -e; R=apps/web/lib/giftSurfaceRegistry.ts; X=apps/web/scripts/gifts-surface-check.mjs
for f in app/api/v1/loyalty/route.ts app/api/v1/loyalty/memberships/route.ts 'app/api/v1/loyalty/memberships/[id]/route.ts' 'app/api/v1/loyalty/memberships/[id]/observations/route.ts'; do p="{ file: '$f', classes: ['numeric-only'] },"; [ "$(grep -cF -- "$p" "$R")" = 1 ]; done
for f in app/api/v1/loyalty/instruments/route.ts 'app/api/v1/loyalty/instruments/[id]/route.ts' app/api/v1/loyalty/members/route.ts 'app/api/v1/loyalty/members/[id]/route.ts' 'app/api/v1/loyalty/memberships/[id]/member-number/route.ts' app/api/v1/loyalty/programs/route.ts 'app/api/v1/loyalty/programs/[id]/route.ts'; do p="{ file: '$f', classes: ['no-transaction-data'] },"; [ "$(grep -cF -- "$p" "$R")" = 1 ]; done
p="{ file: 'app/travel/page.tsx', classes: ['numeric-only'] },"; [ "$(grep -cF -- "$p" "$R")" = 1 ]
p="{ file: 'app/accounts/[id]/page.tsx', classes: ['text-bearing'], scenario: 'H2' },"; [ "$(grep -cF -- "$p" "$R")" = 1 ]
p="'app/travel/page.tsx': { cls: 'numeric-only', url: () => '/travel' },"; [ "$(grep -cF -- "$p" "$X")" = 1 ]
p="'app/accounts/[id]/page.tsx': { cls: 'text-bearing',"; [ "$(grep -cF -- "$p" "$X")" = 1 ]
if grep -nF "app/travel/page.tsx', classes: ['no-transaction-data']" "$R"; then echo "FAIL stale travel class"; exit 1; fi
echo "OK classes"
```

**#15 (source guards for this task; no `!`).**
```
set -e; B="$(git merge-base HEAD main)"; CH="$(mktemp)"; SRC="$(mktemp)"; SCOPED="$(mktemp)"
{ git diff --name-only "$B"; git ls-files -o --exclude-standard; } | grep -v '^plan/' | sort -u > "$CH"
grep -E '^apps/web/(lib|components|app)/.*\.(ts|tsx)$' "$CH" | grep -vE '\.test\.ts$' > "$SRC" || true
while IFS= read -r f; do if grep -nE '(^|[^[:alnum:]_])(FROM|JOIN)[[:space:]]+transactions([^[:alnum:]_]|$)' "$f"; then echo "FAIL raw transactions read in $f"; exit 1; fi; done < "$SRC"
grep -E '^apps/web/(lib/(domain/)?loyalty[A-Za-z]*\.(ts|test\.ts)|app/api/v1/loyalty/|app/travel/|components/(Loyalty|Travel)[A-Za-z]*\.tsx)' "$CH" | grep -vxF apps/web/lib/loyalty.test.ts > "$SCOPED" || true
while IFS= read -r f; do if grep -nE 'toISOString|new Date\(|Date\.now\(|parseFloat|toFixed|Math\.round|getTimezoneOffset' "$f"; then echo "FAIL clock or float in $f"; exit 1; fi; done < "$SCOPED"
for f in apps/web/app/api/v1/loyalty/loyaltyCard.test.ts apps/web/lib/loyaltyCardUi.test.ts; do grep -qF 'ZQ42B' "$f"; done
[ "$(grep -cF '.not.toMatch(/\b(FROM|JOIN)\s+transactions\b/i)' apps/web/app/api/v1/loyalty/loyalty.test.ts)" = 1 ]
[ "$(grep -c "it('T42a-C10:" apps/web/app/api/v1/loyalty/loyalty.test.ts)" = 1 ]
[ "$(grep -rhE 'memberNumber:[[:space:]]*null' apps/web/components apps/web/app/travel | wc -l | tr -d ' ')" = 1 ]
if grep -rnE "cardAccountId[^,}]*(amount|fee)" apps/web/components apps/web/app/travel apps/web/app/api/v1/loyalty --include=*.ts --include=*.tsx | grep -v '\.test\.ts'; then echo "FAIL fee amount near the link"; exit 1; fi
echo "OK task source guards"
```
The raw-read check covers every changed non-test source, so a fee read that bypasses `visibleTransactions` by writing `FROM transactions` is caught here and by `W1` (in command 3) and `T42a-C10` (in command 7).

**#16 (scope guard).**
```
B="$(git merge-base HEAD main)"; CH="$(mktemp)"; { git diff --name-only "$B"; git ls-files -o --exclude-standard; } | grep -v '^plan/' | sort -u > "$CH"
grep -vE '^(packages/contracts/loyalty(\.test)?\.ts|db/schema\.sql|migrations/[0-9]+_[A-Za-z0-9_]+\.sql|apps/web/lib/loyalty[A-Za-z]*(\.test)?\.ts|apps/web/lib/domain/loyalty[A-Za-z]*(\.test)?\.ts|apps/web/app/api/v1/loyalty/.*\.ts|apps/web/app/travel/page\.tsx|apps/web/app/accounts/\[id\]/page\.tsx|apps/web/components/(Loyalty|Travel|AccountEarns)[A-Za-z]*\.tsx|apps/web/lib/giftSurfaceRegistry\.ts|apps/web/scripts/gifts-surface-check\.mjs)$' "$CH" || true
git diff --name-only "$B" -- migrations | grep -v '^$' | grep -E '^migrations/(1792700000000_loyalty\.sql)$' || true
for f in packages/contracts/loyalty.ts packages/contracts/loyalty.test.ts db/schema.sql apps/web/lib/loyaltyStore.ts apps/web/lib/giftSurfaceRegistry.ts apps/web/scripts/gifts-surface-check.mjs apps/web/app/travel/page.tsx 'apps/web/app/accounts/[id]/page.tsx' apps/web/app/api/v1/loyalty/loyaltyCard.test.ts apps/web/app/api/v1/loyalty/loyalty.test.ts apps/web/lib/loyaltyCardUi.test.ts; do grep -qxF "$f" "$CH" || echo "MISSING $f"; done
[ "$(git ls-files -o --exclude-standard migrations | wc -l | tr -d ' ')" -le 1 ] || echo "MORE THAN ONE NEW MIGRATION FILE"
[ "$(git diff --name-only "$B" -- migrations; git ls-files -o --exclude-standard migrations)" != "" ] || echo "MISSING migration"
```
Expected: no output. Nothing is touched under `package.json`, the vitest configs, `lib/giftReadPath.ts`, `lib/domain/giftMask.ts`, `lib/sync.ts`, `lib/netWorth.ts`, `evals/`, the import script and its fixtures, or any other existing test. The unchanged `migrations/1792700000000_loyalty.sql` is never in the diff.

**#17 (additions-only and census guard).**
```
B="$(git merge-base HEAD main)"
git diff -U0 "$B" -- packages/contracts/loyalty.test.ts apps/web/app/api/v1/loyalty/loyalty.test.ts | node -e '
const d=require("fs").readFileSync(0,"utf8").split("\n");
const norm=(s)=>s.replace(/\b(cardAccountId|cardAccountName|benefit|feeWatch)\s*:\s*null\s*,?/g,"").replace(/\bcardAccounts\s*:\s*\[\]\s*,?/g,"").replace(/[\s,]+/g," ").trim();
const hunks=[];let cur=null;
for(const l of d){if(l.startsWith("@@")){cur={rem:[],add:[]};hunks.push(cur)}else if(cur&&l.startsWith("-")&&!l.startsWith("---"))cur.rem.push(l.slice(1));else if(cur&&l.startsWith("+")&&!l.startsWith("+++"))cur.add.push(l.slice(1))}
const bad=[];
for(const h of hunks)for(const r of h.rem){if(r.includes("ROUTES.find((r) => r.file === f)?.classes"))continue;if(!h.add.some(a=>norm(a)===norm(r)))bad.push(r.trim().slice(0,80))}
if(bad.length){console.log("FAIL existing test lines changed beyond the allowance:",bad.join(" | "));process.exit(1)}
console.log("OK existing tests only gained the new keys; removed lines "+hunks.reduce((n,h)=>n+h.rem.length,0))'
[ "$(grep -cE "it\('T42b-I([1-9]|10):" apps/web/app/api/v1/loyalty/loyaltyCard.test.ts)" = 10 ] || echo "WRONG NEW INTEGRATION TEST COUNT"
[ "$(grep -cE "it\('T42b-U[123]:" packages/contracts/loyalty.test.ts)" = 3 ] || echo "WRONG NEW CONTRACT TEST COUNT"
[ "$(grep -cE "it\('T42b-U4:" apps/web/lib/loyaltyCardUi.test.ts)" = 1 ] || echo "WRONG NEW UI TEST COUNT"
[ "$(grep -cE "^\s*(it|test)\(" apps/web/lib/loyaltyCardUi.test.ts)" = 1 ] || echo "EXTRA TESTS IN THE UI FILE"
[ "$(grep -cE "^\s*(it|test)\(" apps/web/app/api/v1/loyalty/loyaltyCard.test.ts)" = 10 ] || echo "EXTRA TESTS IN THE INTEGRATION FILE"
```
Expected: one `OK existing tests only gained the new keys; removed lines <n>` line and no other output. That script reads stdin, so the argv trap does not apply. The only removed lines the allowance forgives are the keys added to fixture objects and the single class-expectation line of `T42a-C10`. Anything else, a weakened assertion included, fails.

## Negative controls
| # | Rule | Input that must be rejected or excluded | Asserted by |
|---|---|---|---|
| 1 | A late fee or interest charge is not an annual fee | `LATE FEE` (late-payment category), `PURCHASE INTEREST CHARGE` (interest category), `FOREIGN TRANSACTION FEE` (the same category as the real fee) | T42b-I3 (g)(h)(i), command 7 |
| 2 | Category does not decide | The fee name with an empty category and no Plaid fields (detected), and a `BANK_FEES_OTHER_BANK_FEES` row with a non-fee name (not detected) | T42b-I3 (b)(i), command 7 |
| 3 | A fee is money out, and only a positive amount | The fee name with a negative amount; with `0.00` | T42b-I3 (j)(k) |
| 4 | Whole-word match on `name` only | `BIANNUAL FEE`; the fee text only in `merchant_name` | T42b-I3 (n)(o) |
| 5 | A transfer or another account's row is not this card's fee | The fee name in a transfer group; the fee name on an unlinked credit account | T42b-I3 (l)(m) |
| 6 | The most recent fee by date counts, not the last inserted, and the posted date is the fee date | An older-dated row inserted last; `authorized_date` earlier than `date` | T42b-I4 |
| 7 | A refunded fee is not a posted fee | The fee plus an exact negated, fee- or refund-named credit after it | T42b-I5 |
| 8 | Only an exact, fee-named, later, same-account credit refunds | An equal-amount `PAYMENT THANK YOU`; a refund-named credit of a different amount; a credit before the fee; a refund on another account | T42b-I5 |
| 9 | One refund cancels at most one fee | One refund with two equal-amount fees, in both orders of dates | T42b-I5 pairing |
| 10 | An instrument of another kind does not close the expectation | A `travel_credit` instrument when the benefit is `free_night`; the kind `other` | T42b-I7 |
| 11 | An instrument on another membership does not close it | A matching-kind instrument on a different membership | T42b-I7 |
| 12 | An instrument before the fee date does not close it | `issued_on` = fee date − 1; `created_at` the day before when `issued_on` is null | T42b-I7 |
| 13 | A known issue date wins over the recorded date | `issued_on` before the fee date with `created_at` today | T42b-I7 |
| 14 | The window boundary | The day after `expectedBy` is `overdue`, the day itself is `awaiting`; a window of 10 is honoured | T42b-I6 |
| 15 | No benefit means no state | A linked card with no benefit: `state` null, no `expectedBy`; an unlinked membership: `feeWatch` null | T42b-I6, T42b-U2 |
| 16 | A non-credit account cannot be linked | `depository`, `investment`, `loan` accounts; an unknown id | T42b-I1 |
| 17 | One card, one membership | A second membership linking a linked card (route and direct SQL) | T42b-I1, command 4, command 5 |
| 18 | A read-scope token cannot link, set a benefit or unlink; no session is 401 | A read bearer token PATCH; an unauthenticated PATCH | T42b-I1, T42b-I10 |
| 19 | The benefit is bounded and complete | `windowDays` 0, 366, 1.5, `'30'`; a kind without a description; an unknown kind; a 201-character description | T42b-U1, T42b-I2, command 4 |
| 20 | Unlinking leaves instruments, the benefit and the ledger | An unlink and an account delete, with checksums before and after | T42b-I9, T42b-I10 |
| 21 | No fee figure and no state is stored, and the amount is never emitted | An extra column or table; a fee amount or fee name in any serialised response; a `feeWatch` with an `amount` key | command 5, T42b-I9, T42b-U2, command 15 |
| 22 | Reads write nothing | A checksum change across two `GET`s | T42b-I9 |
| 23 | A gift-held fee row is never read as a fee, by any viewer | An otherwise-valid fee row held by an unrevealed gift, read by its giver, its recipient and a bearer token; the day-before and same-day reveal boundaries | T42b-I8, T42b-H12, command 13 |
| 24 | The fee read goes through the read path | A raw `FROM transactions` or `JOIN transactions` in any changed non-test source, in the loyalty sources, or a protected column read outside the read path | command 15, `T42a-C10` (command 7), `W1` (command 3) |
| 25 | The create schema never takes a link or a benefit | `cardAccountId` or `benefit` on a membership create | T42b-U3 |
| 26 | The unlink control is the only `cardAccountId: null` sender, and the member-number clear is still the only `memberNumber: null` sender | A second null sender; a new `/member-number` reader | T42b-U4, commands 9, 12, 15 |
| 27 | The classes are right and agree | `/travel` or the four membership-view routes left as `no-transaction-data`; the other seven loyalty routes changed; the script's table out of step with the registry | command 14, command 13 (H1), command 3 (`W4`) |
| 28 | The pages show the state in words, over real HTTP | `expected by` shown for a non-awaiting state; `Earns into` on an unlinked card; a held row's name on `/travel` or the account page | T42b-H12, command 13 |
| 29 | No clock, no float, no JS date arithmetic | `new Date(`, `Date.now(`, `toISOString`, `parseFloat`, `toFixed`, `Math.round` in any loyalty-scoped source or new test | command 15, command 12 (P8-42a #12), command 9 (U9) |
| 30 | The migration is reversible without losing the link or the instruments, and the applied migration is untouched | A `down` that drops `card_account_id`, an instrument, or a table; an edited `1792700000000_loyalty.sql` | command 4, command 16 |
| 31 | The import and every P8-42a, P8-42a2 guarantee are undisturbed | A changed import stdout, a mask leak, a second clear sender, a broken reducer | commands 9 to 12 |
| 32 | No existing test is weakened | A removed or altered assertion other than the new keys and the one class line | command 17 |
| 33 | No scope creep | A file outside the allowed set, a second migration, a new route | command 16, `T42a-C10`'s 11-route count |

## Evidence required
- The verbatim final `OK` lines of commands 4, 5, 6 (both zones), 7 (both lines), 8, 9 (all four lines), 10, 11, 12 (all four lines), 13, 14, 15, and the `OK existing tests only gained …` line of 17. The full output of command 13. Empty output of 16 and the census part of 17. The `exit=` lines of 1, 2, 3's summary and 18. The measured T-rows, including BASE, LINT_BASE and the 324-test baseline.
- A transcript of one real surface-script run's `H12 PASS` line and the fee-date and expected-by date it printed, to show the dates came from Postgres.
- A **mutation log**. Each mutation is applied one at a time and reverted with the tree's checksum unchanged. The named scenarios and commands must fail, then pass after the revert.
  - Match the fee on category instead of name: T42b-I3, T42b-I5.
  - Drop the `amount > 0` condition: T42b-I3 (j)(k), T42b-I5.
  - Substring instead of whole-word match: T42b-I3 (n).
  - Read `merchant_name` as well: T42b-I3 (o).
  - Use `authorized_date`: T42b-I4.
  - Pick the fee by id instead of by date: T42b-I4.
  - Let any equal-amount credit refund a fee: T42b-I5.
  - Let a refund cancel every equal fee: T42b-I5 pairing.
  - Resurrect an older fee after a refund: T42b-I5.
  - `>` instead of `>=` at the window boundary: T42b-I6.
  - Let `created_at` override a known `issued_on`: T42b-I7.
  - Ignore the instrument kind: T42b-I7.
  - Ignore the membership on the instrument match: T42b-I7.
  - Join instruments so a membership repeats: T42b-I4, T42b-I7.
  - Count a held gift row as a fee for the giver only: T42b-I8, T42b-H12.
  - Read `FROM transactions` raw: commands 3 (`W1`), 7 (`T42a-C10`), 15.
  - Allow a depository account to be linked: T42b-I1.
  - Drop the unique index: command 4, command 5, T42b-I1.
  - Make unlink clear the instruments or the benefit: T42b-I9.
  - Store the fee date in a column: command 5.
  - Emit the fee amount: T42b-I9, T42b-U2.
  - Leave `/travel` as `no-transaction-data`: command 14.
  - Make the account page show `Earns into` for an unlinked card: T42b-H12.
  - Compute "today" with the JS clock: command 15.
  - Make `down` drop `card_account_id`: command 4.
- A statement of the limits.
  - (1) No renderer exists (T19 is NO), so wording is proved over real HTTP for the SSR output of `/travel` and `/accounts/[id]`, and the controls are proved by source checks and by the PATCH routes they call. A tap is not executed. The implementer's phone-width and desktop screenshots against a scratch demo database with fabricated data are required, and none is committed if it shows a figure-like string.
  - (2) The fee rule's known limits: a partial refund and a refund whose bank text carries none of the named words are not recognised; a fee whose bank text uses other words is not detected. Both are accepted and stated.
  - (3) The tiny window around Postgres midnight, when `CURRENT_DATE` could change between a test computing a date and the handler running, is negligible and no command waits across midnight.
- A statement of which docs under `node_modules/next/dist/docs/` were read, and that the `uiux-promax` skill was invoked.
- A scan of EVIDENCE.md and the commit messages for dollar figures, comma-grouped numbers and real data: none.
- For the guardian: `plan/tasks/P8-42b-card-annual-instruments/CONTRACT.md` records the rationale, that the `down` is not lossless for benefit text (back up first with `\copy` of the three columns), and that links and instruments survive a `down`.

## Failure modes to test
- **Fee detection.**
  - A category-only rule, which admits `FOREIGN TRANSACTION FEE`, late fees and interest.
  - A rule that needs `plaid_raw` or `plaid_category_detailed`, which silently finds nothing on the card with no Plaid feed.
  - A substring match that treats `BIANNUAL FEE` or `ANNUAL FEES` as a fee.
  - A case-sensitive match, or a match that fails on doubled spaces.
  - `amount < 0` or `amount = 0` read as a fee (sign inversion: a card charge is positive, so negating the amount "for a card" makes every refund a fee).
  - A fee row on another account, or in a transfer group, counted.
  - A fee dated by `authorized_date`, so a non-Plaid row or a masked row has none.
  - Insertion order or `MAX(id)` used where date order was meant.
  - A float or text comparison of amounts (`93.1` against `93.10`).
  - A `JOIN` to instruments or to refunds that repeats a membership line, or an `EXISTS` written as a join.
- **Refunds.**
  - A card payment equal to the fee voiding it.
  - A refund voiding two fees, or the wrong one of two.
  - A refund dated before the fee voiding it.
  - A refund on another account voiding it.
  - A cancelled latest fee falling back to last year's fee and raising a false overdue.
- **State.**
  - An off-by-one at `expectedBy` (the day itself is still `awaiting`).
  - `received` not winning over `overdue`.
  - An instrument dated before the fee, of another kind, or on another membership closing the expectation.
  - `created_at` overriding a known `issued_on`, or a time-zone shift moving a recorded date by a day.
  - `state: no_fee_seen` for a card with no benefit, or `0`, `''` or `"null"` shown for an absent date (this app shows "—"-like absence, never a wrong zero).
  - The window default applied wrongly (not stored, or stored as 0), or a window outside 1 to 365 accepted.
  - A JS clock or JS date arithmetic making the state depend on the server's zone.
- **Gifts.**
  - A held fee row excluded for non-givers only, so two viewers see two answers.
  - A held row read raw (a protected column read outside the read path).
  - The reveal boundary off by one (the row is held while `reveal_date > CURRENT_DATE`).
  - A masked row's `Gift` label or a held amount or date appearing on `/travel`.
  - `/travel` classified `no-transaction-data` after it reads the ledger, so the surface script and the registry no longer describe it.
- **Links.**
  - A non-credit account linked.
  - Two memberships on one card with a 500 instead of the 409 (a lost race).
  - Unlink that clears instruments, or an account delete that fails or cascades into the membership.
  - Link or benefit accepted on create, so the "stray key refused" guarantee erodes.
  - A read-scope token able to write.
- **Contract and schema.**
  - A stored fee date, amount or state, or an extra table.
  - A new required response field with the old fixtures left in tests (they must gain the keys, nothing more).
  - A migration that edits an applied one, a `down` that loses the link or an instrument, a unique index that conflicts with existing data (all current links are null, so it must not).
  - `db/schema.sql` or a code comment still saying the column is reserved or always null.
- **UI.**
  - The wrong state word shown (`expected by` on an overdue line).
  - `Earns into` shown for an unlinked card or a non-credit account.
  - A second `cardAccountId: null` sender, or an unlink that needs two taps.
  - A new `/member-number` reader, or a second `memberNumber: null` sender (P8-42a2's guarantees).
  - A link picker that offers non-credit accounts.
  - The page not refreshing after a link, unlink or benefit change.

## Rollback
Revert the code commit. Then, if the new migration was applied, run `npm run migrate:down` once against that database. The `down` drops the unique index and the three benefit columns on `loyalty_memberships`, and nothing else. It does not drop or alter `card_account_id`, any membership, observation, instrument, member, program, alias or any ledger table. **The down is not lossless for the benefit text and window:** every benefit described while the change was live is discarded. Back it up first, as the migration's own header lists:

`\copy (SELECT id, card_account_id, benefit_kind, benefit_description, benefit_window_days FROM loyalty_memberships ORDER BY id) TO 'backup-loyalty_card_benefit.csv' CSV HEADER`

A restore re-adds the columns with `migrate:up` and loads the file by membership id. After a revert and `down`, a membership linked while this change was live keeps its `card_account_id`. P8-42a's code never selects, sets or emits that column, so the stale links are inert. The owner may clear them with `UPDATE loyalty_memberships SET card_account_id = NULL`. Revert the code before running the `down`, so nothing queries a missing column. No gift, ledger or account row was written by this change, so nothing else needs restoring.

