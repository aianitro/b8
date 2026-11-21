# P8-42b2-card-earn-estimate — estimate what a linked card's spend should have earned, say so on the card and on /travel, and compare it with the next real reading
**Roadmap item:** ROADMAP.md §5 Phase 8 step 42b-2 (split out of P8-42b by the orchestrator on 2026-11-20). Origin: `plan/tasks/P8-42b2-card-earn-estimate/ITEM.md` (binding) and `plan/LOYALTY-ROADMAP.md` §1, §4 B ("Earn estimate"), §5, §7. Predecessors: `plan/tasks/P8-42b-card-annual-instruments/SPEC.md` (with its GATES amendments A0 to A2), `plan/tasks/P8-42a2-loyalty-nits/SPEC.md` and `plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md`. "P8-42b #n" means that spec's acceptance command n. Under `node -e` the first extra argument is `process.argv[1]` (P8-42a GATES A1); every `node -e` below reads its arguments that way, or reads stdin.
**Status:** FROZEN (G0 PASS 2026-11-21, cycle 2) (cycle 2, after G0 FAIL cycle 1)
**Author:** spec-writer

**How figures are handled in this spec (AGENTS.md public-repo rule).** This spec contains no money-looking figure. Every exact amount, rate, expected estimate, expected comparison and expected page string lives in one fabricated fixture file, `apps/web/lib/fixtures/loyalty-earn-cases.json`, whose complete content is given under "Prerequisites the orchestrator creates" and which is pinned by a SHA-256 in command 15. The scenarios below refer to cases by id (`E1`, `S4`, `M2`, `P5`, `C4`, `G3`, `H5`, `K1`) and describe each rule in words. The tests and the surface script load their cases from that file; they do not restate figures.

## Goal
Six observable changes. Nothing else changes.

1. **Earn rules, described once per membership.** A loyalty membership can carry an earn description: one base rate and zero to twenty bonus rules, each matching spend either by b8 category (`mapped_category`) or by merchant text, each with its own rate. The first matching rule in the stored order wins; the base rate applies to everything else. It is set and cleared through the existing `PATCH /api/v1/loyalty/memberships/[id]` (no new route). It is configuration, so it is stored; it survives an unlink, as the benefit does.
2. **Estimate derived, never stored.** For a membership with a linked card and an earn description, every read computes "what this card's spend should have earned since the current reading": the card's purchases less its refunds, each priced by its first matching rule, summed exactly, rounded once at the end. The period is the days after the membership's current reading's `as_of` up to Postgres `CURRENT_DATE`; with no reading it is the last 30 days and says so.
3. **Spend defined, not assumed.** Purchases are money out; transfers, card payments, annual-fee rows, income, loan disbursements, reward redemptions and rows held by an unrevealed gift are not spend, and a refund is a credit that is none of those. The exact rule is in Conventions.
4. **Comparison with the next reading, derived.** When a membership has at least two readings on different `as_of` dates in the same unit, the change between the current reading and the one before it is compared with the estimate over the spend between their dates, as the latest "estimate vs actual": estimated, actual, the difference as a percentage, and a "worth a look" mark beyond a fixed threshold of 25 percent. No alert, no push.
5. **Shown** on the card's `/accounts/[id]` page (under P8-42b's "Earns into" block) and on the membership's line on `/travel`, labelled *estimated* everywhere, with a one-line statement that caps, tiers and rotating categories are not modelled. `/travel` gets the controls to set and clear the earn rates.
6. **Gift surfaces unchanged in class and proved again.** The estimate is the same for every viewer. `/travel` and the four membership-view routes stay `numeric-only`; `/accounts/[id]` stays `text-bearing`. A held gift row is proved not to count, for the giver, the recipient and a bearer token alike.

## Non-goals
The reviewer enforces each of these as a defect if present.
- **No stored estimate, comparison, miss mark, spend figure, period or "last compared" date**, in any table, column, cache, materialised view or JSON blob. The loyalty schema gains exactly one nullable column (`earn_base_rate`) on `loyalty_memberships` and exactly one table (`loyalty_earn_rules`), and nothing else (commands 4 and 5 assert the exact column lists).
- **No cap, spend tier, rotating or quarterly category, sign-up bonus, anniversary bonus, welcome offer, points-expiry or transfer-bonus modelling** (ITEM.md). **No alert, push, dashboard card, digest widget or "Needs attention" section** (42g). No email reading (42c), no transfers (42f), no stays (42e), no agent tool (42h).
- **No per-merchant, per-category or per-rule breakdown is emitted or rendered**, and no list of which transactions matched. The only figures out are the estimate total and the comparison's three numbers. (A breakdown would be row-derived text on a `numeric-only` surface.)
- **No merchant name, transaction name, transaction amount, or raw spend total appears in any response, page or log line.** Only the priced estimate leaves the database.
- **No write to the ledger.** No transaction, account, valuation, category, budget category, rule, gift or transfer row is created, updated or deleted by any production code path of this task. Test fixtures and the surface script's scratch database are the only writers.
- **No change to what a transaction row is or how Plaid syncs it.** No new column on `transactions` or `accounts`. No change to `lib/sync.ts`, `lib/netWorth.ts`, `lib/giftReadPath.ts`, `lib/domain/giftMask.ts`, `lib/transferValidation.ts`, `lib/transactionEdits.ts` or any gift route. No new transfer or card-payment detector is added to the ledger; the rule here is local to the estimate.
- **The estimate reads `transactions` only through the gift read path** (`visibleTransactions` in `lib/giftReadPath.ts`), as P8-42b's fee watch does. No raw `FROM transactions` or `JOIN transactions` in any non-test file this task changes.
- **No change to the fee watch.** `feeWatch` values, the P8-42b state rules and their tests are unchanged. The earn description never alters any `feeWatch` field (T42b2-I9).
- **No new route file.** The earn description is a field of the existing membership PATCH. The loyalty route count stays 11 (`T42a-C10` asserts 11 files). No new error code.
- **No JS clock, JS date arithmetic, JS float or JS rounding** for any date, rate, spend, estimate or percentage: `new Date(`, `Date.now(`, `toISOString`, `parseFloat`, `toFixed`, `Math.round` do not appear in any loyalty-scoped source or new test. Spend, rates, the estimate and the percentage are NUMERIC in SQL and decimal text everywhere else.
- **No second balance or number formatter.** Grouped digits for display come from the existing `formatBalance` in `lib/domain/loyalty.ts`, which is not edited.
- **No figure literal in a new test, in the surface script's new step, or in any source comment.** Figures come from the fixture file. The fixture file is not edited by the implementer.
- **No change to the import script or its fixtures, to `package.json`, the vitest configs, `evals/`, or an already-applied migration.** No new npm dependency. No renderer is added.
- **The member number stays masked everywhere**; the P8-42a2 guarantees stay (one `memberNumber: null` sender, `startEmpty` once, no new `/member-number` reader). P8-42b's guarantees stay (exactly one `cardAccountId: null` sender).
- **No retroactive storage of rule edits.** Editing a rate changes the estimate and the comparison for the same past window on the next read, because both are derived. That is intended and stated (Open question 15).
- **Existing tests are only edited in the three ways command 14 allows, and only added to otherwise.** No existing test is weakened or deleted. Any conflict with a frozen P8-42a, P8-42a2 or P8-42b regression command is raised to the orchestrator, not absorbed.

## Contracts touched
Expected: G1 applies (contract surface touched, lease required). The guardian writes the migration and the types; this spec fixes the names the acceptance commands query. Class per BUILD.md §9.2 is **additive** for every row.

| File | Change | Class (§9.2) |
|---|---|---|
| `migrations/<new timestamp greater than 1792800000000>_loyalty_earn_rules.sql` (name free) | Adds nullable `loyalty_memberships.earn_base_rate NUMERIC(7,4)` with a CHECK that it is null or between 0 and 100 inclusive. Creates `loyalty_earn_rules` with exactly the columns `id`, `membership_id` (NOT NULL, FK to `loyalty_memberships(id)` ON DELETE CASCADE), `position` (INT NOT NULL), `match_kind` (TEXT NOT NULL, CHECK in `category`, `merchant`), `match_text` (TEXT NOT NULL, CHECK trimmed, 1 to 100 characters), `rate` (NUMERIC(7,4) NOT NULL, CHECK 0 to 100 inclusive), and `UNIQUE (membership_id, position)`. No column name contains `fee`, `state`, `amount`, `estimate`, `actual`, `since`, `diff`, `miss`, `compar`, `total` or `result`. The `down` drops the table and the column and touches nothing else, so `card_account_id`, the benefit columns and every instrument survive a down. The `down` is not lossless for the earn description (Rollback). | additive |
| `db/schema.sql` | Mirrors the migration, inside the `CREATE TABLE loyalty_memberships` block and a new `CREATE TABLE loyalty_earn_rules` block. | additive |
| `packages/contracts/loyalty.ts` | `LoyaltyMembershipPatchRequestSchema` gains optional `earn` (strict object `{baseRate, rules}` or `null`). `LoyaltyMembershipSchema` gains required, nullable `earn`, `earnEstimate`, `earnComparison`. New exported constants `LOYALTY_EARN_MAX_RULES` (20), `LOYALTY_EARN_MAX_RATE` (100), `LOYALTY_EARN_FALLBACK_DAYS` (30), `LOYALTY_EARN_MISS_PERCENT` (25). Shapes are fixed in Conventions. The create schema is unchanged and still refuses `earn`. No new error code. | additive |
| `packages/contracts/loyalty.test.ts` | Three tests added (`T42b2-U1` to `T42b2-U3`). The `membership()` fixture and any overview fixture may gain the new keys with `null`. | additive (tests) |

The table and column names above, the response field names `earn`, `earnEstimate`, `earnComparison` and their inner keys, and the constants' names are fixed here because acceptance commands query or grep them. A guardian who wants a different storage shape (for example a JSON column) must raise it before G0 freezes this spec; the default is chosen in Open question 1.

## Conventions this task must honor

- **Sign.** The ledger's convention holds for a credit card: `transactions.amount` is positive for money out (a purchase, a fee) and negative for money in (a payment, a refund, a statement credit, a reward redemption). A purchase is `amount > 0`; a candidate refund is `amount < 0`; an amount of exactly zero is neither and counts for nothing. Nothing is negated "by hand" in application code and no JS number touches an amount. Spend is signed: a refund contributes a negative term priced at its own matched rate, so the estimate can be negative when refunds outweigh purchases in the window (stated, shown, never clamped; Open question 7). Rates are non-negative decimals; a rate of zero is valid and means "this earns nothing".
- **Spend rule (exact).** Let `A` be the linked account, `since` and `until` the period bounds below, and read `A`'s rows as `visibleTransactions(null)` excluding every `gift_masked` row. A row contributes only if all of these hold, evaluated in Postgres:
  1. `date > since` and `date <= until` and `date <= CURRENT_DATE`. The posted `date` is used, never `authorized_date`.
  2. `transfer_group_id IS NULL`.
  3. `mapped_category` does not contain `transfer` (case-folded substring, the same test `isTransferCategory` in `lib/transactionEdits.ts` makes; a half-paired transfer is categorised `Transfer` with no group yet). A null `mapped_category` passes this test.
  4. `amount <> 0`.
  5. If `amount > 0` (a purchase): its `name`, case-folded with every run of whitespace collapsed to one space, does not hold `annual membership fee` or `annual fee` as whole words (the fee phrases of P8-42b). Every such debit is excluded whatever its date, whether or not a refund cancelled it, and whether or not it is the latest fee. A purchase whose name holds `payment`, `transfer`, `autopay` or any other word is still a purchase and counts: only credits are filtered by name.
  6. If `amount < 0` (a candidate refund), it counts only if ALL of: `mapped_category` is not null; no `budget_categories` row with the same name has `is_income = TRUE`; its folded `name` holds none of these as whole words or phrases: `payment`, `payments`, `autopay`, `thank you`, `transfer`, `xfer`, `payoff`, `disbursement`, `loan`, `deposit`, `interest`, `reward`, `rewards`, `redemption`, `cashback`, `cash back`, `statement credit`, `annual membership fee`, `annual fee`; and it is not the refund of an annual fee, meaning there is no annual-fee debit (a debit satisfying 5's name test) on the same account whose amount is the credit's amount negated, dated on or before the credit, when the credit's name holds `refund`, `reversal` or `reversed`. The negation test is NUMERIC equality in SQL.
  - "Whole word" means the phrase is bounded by the start or end of the text or by a character that is neither a letter nor a digit, as in P8-42b. Only `name` is read for these tests. `plaid_category`, `plaid_category_detailed` and `plaid_raw` never decide anything, so a card with no Plaid feed behaves identically.
  - A null `name` is the empty string. A null `mapped_category` is "no category".
- **Rule matching (exact).** The membership's rules are read in ascending `position`. For one contributing row the first rule that matches decides its rate; if none matches, `earn_base_rate` decides it.
  - `match_kind = category`: the row's `mapped_category` is not null and equals `match_text` after both are trimmed and case-folded. Exact equality, never a substring, never a pattern: a category whose text merely begins with the rule's text does not match, and a rule text containing `%`, `_`, `.` or `*` is compared literally.
  - `match_kind = merchant`: the case-folded, whitespace-collapsed `match_text` appears as a whole-word phrase in the row's case-folded, whitespace-collapsed `name` OR in its `merchant_name` (a null `merchant_name` never matches). A whole word followed by a hyphen and more text matches; the same letters inside a longer word do not. The match text is a literal phrase, never interpreted as a pattern, whatever characters the row's own name contains.
  - A refund is priced by the same first-match rule on its own category and text, so a refund in a bonus category reduces the estimate at that category's rate.
- **Rounding.** None until the last step, and exactly once. For one period, the estimate is `SUM(signed amount × matched rate)` over all contributing rows, computed in NUMERIC exactly (an amount has two decimals and a rate four, so every term is exact), then rounded once to the unit's scale by Postgres `round(numeric, scale)`, which rounds halves away from zero. Scale is zero for `points` and `miles` and two for `usd`. Rounding per row or per rule is a defect (fixture cases `E2`, `E3`, `E7` pin it). A result that rounds to zero is the canonical zero (`0`, or the two-decimal zero for `usd`), never a negative zero and never null. The comparison's percentage is rounded once, to one decimal place, half away from zero, from the exact quotient of the two emitted integers (or cent amounts).
- **Landscape and exclusions.** The account's `landscape` is not consulted. Nothing here is a P&L, budget or net-worth figure. `hidden = TRUE` rows still count (`hidden` is a display and budget flag and a hidden purchase still earned). `exclude_from_budget`, `track_transactions`, `rule_applied` and the account's `is_liability` are not consulted. Only the three category tests above (transfer-shaped, income, null for credits) look at categories. A purchase in an income-flagged or capital-landscape category, or in a category flagged `exclude_from_budget`, still counts as spend.
- **Gifts.** A transaction held by an unrevealed gift (`gift_transactions` joined to `gifts` with `reveal_date > CURRENT_DATE`, evaluated by Postgres) is never spend, for any viewer, giver included. The rows are read as the viewer `null` and `gift_masked` rows are excluded outright, so the estimate is identical for both b8 users and every bearer token. On the reveal date itself and after, the row is ordinary and, if its real `name` matches a merchant rule, it is priced by that rule. This is the P8-42b precedent for fee detection. Consequence, stated: while a purchase is held, the estimate omits it, and it enters on its reveal date.
- **Period (exact).** Let `current` be the membership's current reading, chosen by the existing shared reducer in `lib/domain/observations.ts` (greatest `as_of`, ties by latest recorded time, then highest id), never by arrival order.
  - **Estimate:** with a current reading, `since` is its `as_of` and `basis` is `reading`; with none, `since` is `CURRENT_DATE - 30` (the constant `LOYALTY_EARN_FALLBACK_DAYS`, applied by Postgres) and `basis` is `last_30_days`. `until` is `CURRENT_DATE`. Spend dated exactly `since` is excluded; spend dated the day after `since` and spend dated `CURRENT_DATE` are included; spend dated after `CURRENT_DATE` is excluded. A reading whose `as_of` is after `CURRENT_DATE` (the API allows one day ahead) gives an empty period and a zero estimate, which is a true zero.
  - **Comparison:** let `previous` be the reading with the greatest `as_of` strictly less than `current.asOf` (ties on that date by the same reducer order). The comparison covers `date > previous.asOf` and `date <= current.asOf` (and `date <= CURRENT_DATE`). Adjacent comparison windows therefore share no day and leave no gap. A typed correction of the current reading (same `as_of`, later recorded) replaces the current balance and leaves `previous` and the window unchanged. A reading entered later with an older `as_of` than `previous` changes nothing.
- **Unit and rate scale.** The estimate's unit is the current reading's unit, or, with no reading, the program's `default_unit`. A rate is always "units of that unit per one currency unit of spend". For `points` and `miles` it is that many points or miles per currency unit; for `usd` (travel cash) it is a fraction of a currency unit and the estimate has two decimals; for `nights` there is no sensible conversion and `earnEstimate` and `earnComparison` are both `null` (not zero). Rates carry no unit of their own.
- **Rate text.** A rate is decimal text from the request to the database and back, never a JSON number. A submitted rate is one to three integer digits, optionally followed by a decimal point and one to four digits, and is at most the constant `LOYALTY_EARN_MAX_RATE`; a fifth fractional digit is refused, never rounded. It is stored as NUMERIC(7,4) and emitted by `::text` with exactly four decimals (fixture group `contractCases.rateRoundTrip` lists the submitted and emitted spellings). Pages may trim trailing zeros by string work.
- **Request shape.** `earn` is `{ baseRate: <rate>, rules: [ { kind: 'category' | 'merchant', match: <text>, rate: <rate> }, ... ] }`, strict objects throughout, or `null`. `rules` has 0 to `LOYALTY_EARN_MAX_RULES` entries and its array order is the stored order and the match order. `baseRate` is required whenever `earn` is an object. A category `match` is 1 to 100 characters once trimmed. A merchant `match` is 1 to 60 characters once trimmed, starts with a letter or digit, and contains only letters, digits, spaces, `&`, `'` and `-`. Two rules with the same kind and the same case-folded `match` are refused (the second could never match). The handler stores trimmed text, replaces the whole rule list and the base rate in one transaction (or applies nothing), and `earn: null` deletes every rule and nulls the base rate in one transaction. A refused body changes nothing. The PATCH is accepted on an unlinked membership (inert until a card is linked).
- **Response shape.** `earn` is `{ baseRate, rules: [{ kind, match, rate }] }` in stored order, or `null`. `earnEstimate` is `{ since, basis, unit, amount }` or `null`, where `since` is `YYYY-MM-DD` text from Postgres, `basis` is `reading` or `last_30_days`, `unit` is `points`, `miles` or `usd`, and `amount` is signed canonical decimal text (whole units: no leading zero and no decimal point; `usd`: exactly two decimals). `earnComparison` is `{ from, to, unit, estimated, actual, differencePercent, worthALook }` or `null`, where `from` is `previous.asOf`, `to` is `current.asOf`, `from < to`, `unit` is `points`, `miles` or `usd`, `estimated` and `actual` are signed canonical decimal text in that unit (`actual` is current balance minus previous balance, exact), `differencePercent` is signed decimal text with exactly one decimal or `null`, and `worthALook` is a boolean. A negative zero is refused as an `amount`, `estimated`, `actual` or `differencePercent` (the contract accepts only the plain zero). Contract refinements (a producer cannot emit a contradiction): `earnEstimate !== null` implies `cardAccountId !== null` and `earn !== null`; the same for `earnComparison`; `differencePercent` is null exactly when `estimated` is zero; `worthALook` follows the miss rule below. Strict objects: a stray key (a spend amount, `rows`, `merchant`) is refused. Accepted and refused spellings of each text field are fixture group `contractCases`.
- **When each is null.** `earn` is null when no earn description is stored. `earnEstimate` is null when no card is linked, or `earn` is null, or the unit is `nights`. `earnComparison` is null when no card is linked, or `earn` is null, or fewer than two readings exist on different `as_of` dates, or the two readings differ in unit, or the unit is `nights`. A null is rendered as an absent phrase ("No earn rates set"), never `0`, an empty string or the text `null`. A genuine zero (rules set, nothing spent) is a number, shown as a number.
- **Miss rule (exact).** Let `E` be `estimated` and `Ac` be `actual`, both as emitted. If `E` is zero, `differencePercent` is null and `worthALook` is true exactly when `Ac` is not zero. Otherwise `differencePercent` is one hundred times `(Ac − E)` divided by the absolute value of `E`, rounded once to one decimal place half away from zero, and `worthALook` is true exactly when one hundred times the absolute value of `(Ac − E)` is strictly greater than `LOYALTY_EARN_MISS_PERCENT` times the absolute value of `E`, tested exactly on the emitted figures, never on the rounded percentage. A difference of exactly the threshold is not a miss; a difference just above it is a miss even when its rounded percentage prints as the threshold's neighbour (fixture cases `C3`, `C4`, `C5`, `C6` pin both edges). The threshold is a constant, not stored, not configurable.
- **Dates.** Calendar dates are `YYYY-MM-DD` text from Postgres (`::text`). "Today" is Postgres `CURRENT_DATE`, never the JS clock. No timestamp is emitted. Fixture cases give dates as day offsets from `CURRENT_DATE`.
- **Visible text** (used by the surface script and by `T42b2-U4`). Case-sensitive, after removing every `<!-- -->` comment from the HTML. "Formatted" means the output of the existing `formatBalance` (grouped digits, unit word, or the dollar sign and two decimals for cash).

| Situation (linked card) | The line contains |
|---|---|
| estimate, basis `reading` | `≈ ` then the formatted amount, then ` estimated since ` and the `since` date |
| estimate, basis `last_30_days` | the above and the phrase `no reading yet, last 30 days` |
| earn described, no card | no estimate text at all |
| card linked, `earn` null | `No earn rates set` |
| `earnEstimate` null with `earn` set (unit nights) | `No estimate for this unit` |
| any line with an estimate or a comparison | `no caps, tiers or rotating categories` |
| comparison present | `Estimate vs actual`, the `from` and `to` dates, `estimated ` and the formatted estimated figure, `reported ` and the formatted actual figure, and, when `differencePercent` is not null, that text followed by `%` |
| `worthALook` true | `worth a look` |
| `worthALook` false | the words `worth a look` appear nowhere on that membership's line |
| `/accounts/[id]` of a linked card | the same lines, under `Earns into` |
| unlinked, or non-credit | no `Earns into` and no estimate text on that account's page |

- **Controls on `/travel`** (labels fixed so source checks can find them): `Set earn rates` (a base rate and an ordered list of rules, each with a kind choice, text and rate) and `Clear earn rates` (one tap, no confirmation: it deletes configuration only, nothing in the ledger or the readings). The phone-first tap-target rule of P8-42a2 applies (not smaller than the existing `min-h-8` controls). Moving a rule is a re-submit of the whole list; no drag handling is specified.
- **Process requirements for the implementer.** Read the relevant guides under `node_modules/next/dist/docs/` (resolved from `apps/web`) before changing any page or client component. Invoke the `uiux-promax` skill before designing the earn-rate editor and the estimate lines. Record in EVIDENCE.md which docs files were read.
- **Public repo.** Fixtures use the canary `ZQ42B2`: account ids `zq42b2_…`, names `ZQ42B2 …`, category names `ZQ42B2 …`, no real card, bank, merchant or program name anywhere (the seeded catalog's programs are referenced by id, not by name). Every money-looking figure lives only in the fixture file (whose `note` field says the data is fabricated) and in the scratch databases the tests and the surface script build from it. No figure appears in this spec, a source comment, a migration or schema comment, EVIDENCE.md or a commit message (command 12 scans added comment lines; command 15 scans the new tests and the script's added lines for figure literals).

## Toolchain prerequisites
All commands run under `bash` from the repo root. Orchestrator-measured facts from 2026-11-20: unit BASE 104 files and 1410 tests, LINT_BASE 0 errors and 5 warnings, integration 334 tests with failing set `[]`, surface script ends `OK H1-H12`, throwaway DB `postgresql://localhost/b8_p42a_throwaway` at head `1792800000000`. The orchestrator verifies every row before G0 passes.

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `psql`, `createdb`, `dropdb`, a local Postgres with CREATEDB | **yes** | local install | `psql -d postgres -tAc "select 1"` → `1` | filled at G0 |
| T2 | Throwaway DB exists at P8-42b's head and has no earn table yet | **yes** | reuse; else `createdb b8_p42a_throwaway` then `DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npm run migrate:up` | `psql postgresql://localhost/b8_p42a_throwaway -Atc "select name from pgmigrations order by id desc limit 1"` → `1792800000000_loyalty_card_benefit`, and `psql postgresql://localhost/b8_p42a_throwaway -Atc "select coalesce(to_regclass('public.loyalty_earn_rules')::text,'none')"` → `none` | at head 1792800000000 (orchestrator) |
| T3 | `npm run migrate:up` and `npm run migrate:down` honour `DATABASE_URL`; `pgmigrations` exists | **yes** | existing (both scripts are in `package.json`) | `DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npm run migrate:up >/dev/null 2>&1; echo "exit=$?"` → `exit=0` | filled at G0 |
| T4 | Unit baseline | **yes** | existing | `npm test 2>&1 \| tail -8` → 104 files, 1410 tests | 104 / 1410 |
| T5 | Lint baseline | **yes** | existing | `npm run lint; echo "exit=$?"` → 0 errors, 5 warnings | 0 / 5 |
| T6 | Integration baseline | **yes** | existing | the P8-42b #7 body run on the unmodified tree → `OK 334 tests …` | 334, failing `[]` |
| T7 | `tsc` runs in `apps/web` with `--incremental false` | **yes** | existing | `(cd apps/web && npx tsc --noEmit --incremental false; echo "exit=$?")` → `exit=0` | filled at G0 |
| T8 | Node ≥ 22 with global `fetch` | **yes** | local install | `node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22 && typeof fetch==="function" ? 0 : 1)'; echo "exit=$?"` → `exit=0` | filled at G0 |
| T9 | Port 3198 free and the surface script green on the unmodified tree | **yes** | existing | `lsof -nP -iTCP:3198 -sTCP:LISTEN \| wc -l` → `0`, then `node apps/web/scripts/gifts-surface-check.mjs; echo "exit=$?"` → `OK H1-H12`, `exit=0` | `OK H1-H12` (orchestrator) |
| T10 | `npm run build` succeeds on the unmodified tree (it once hung fetching fonts; re-run if so) | **yes** | existing | `npm run build; echo "exit=$?"` → `exit=0` | filled at G0 |
| T11 | P8-42b's SPEC.md is frozen with its blocks at the lines commands 9 and 11 extract: 275 and 280 (P8-42b #9), 286 and 293 (#10), 298 and 301 (#11), 306 and 316 (#12), 332 and 340 (#14) | **yes** | frozen | `S=plan/tasks/P8-42b-card-annual-instruments/SPEC.md; for n in 275 280 286 293 298 301 306 316 332 340; do printf '%s:' "$n"; sed -n "${n}p" "$S" \| cut -c1-48; done` → lines 275, 286, 298 and 306 start `set -e; S2=plan/tasks/P8-42a2-loyalty-nit`; 280 starts `bash -c "$(sed -n '137p'`; 293 starts `bash -c "$(sed -n '193,207p'`; 301 starts `bash -c "$(sed -n '213p'`; 316 starts `bash -c "$(sed -n '234,242p'`; 332 starts `set -e; R=apps/web/lib/giftSurfaceRegistry.ts`; 340 is `echo "OK classes"` | verified at G0 cycle 1 |
| T12 | The regression blocks extracted in command 9 pass on the unmodified tree | **yes** | existing | commands 9a to 9d (run before the implementer starts) | filled at G0 |
| T13 | `vitest` accepts the path filters `packages/contracts/loyalty.test.ts` and `lib/loyaltyEarnUi.test.ts` from `apps/web` | **yes** | existing | `(cd apps/web && npx vitest run packages/contracts/loyalty.test.ts 2>&1 \| tail -6)` → `Test Files  1 passed (1)` | filled at G0 |
| T14 | No `zq42b`-prefixed fixture rows exist, and `b8_p42a2_empty` is free | **yes** | n/a | `psql postgresql://localhost/b8_p42a_throwaway -Atc "select (select count(*) from accounts where id like 'zq42b%')\|\|','\|\|(select count(*) from budget_categories where name like 'ZQ42B2%')"` → `0,0`; `psql -d postgres -Atc "select count(*) from pg_database where datname='b8_p42a2_empty'"` → `0` | filled at G0 |
| T15 | Under `set -e`, a leading `!` does NOT abort when the negated command succeeds. This spec writes no `! cmd` guard. | **yes** (documents a hazard) | n/a | `bash -c 'set -e; ! true; echo reached'` → `reached` | filled at G0 |
| T16 | `export PRIOR_REDUCER=6` is present inside P8-42a2's line 142 (it feeds the regression in command 9) | **yes** | existing | `sed -n '142p' plan/tasks/P8-42a2-loyalty-nits/SPEC.md \| grep -c 'export PRIOR_REDUCER=6'` → `1` | filled at G0 |
| T17 | Work happens on `main`, uncommitted, as in P8-42a, P8-42a2 and P8-42b, so `git merge-base HEAD main` is `HEAD` and `git diff --name-only HEAD` plus untracked files is exactly this task's change. Nothing may be committed before G4. | **yes** | adjudicated at G0 | `git merge-base HEAD main` → a SHA equal to `git rev-parse HEAD` | filled at G0 |
| T18 | The surface script's gift INSERT shapes from H12 (script lines 373 to 386) are the shapes H13 reuses | **yes** | existing | `sed -n '373,386p' apps/web/scripts/gifts-surface-check.mjs \| grep -c 'INSERT INTO gift'` → `2` | filled at G0 |
| T19 | Postgres `round(numeric, scale)` rounds halves away from zero and a small negative rounds to a plain zero | **yes** | existing | `psql -d postgres -Atc "select (round(5::numeric/10,0)=1 and round(-5::numeric/10,0)=-1 and round(-4::numeric/10,0)=0 and round(1255::numeric/1000,2)=126::numeric/100 and round(-1255::numeric/1000,2)=-126::numeric/100)::text"` → `true` | filled at G0 |
| T20 | `budget_categories`, `transfer_groups` and the gift tables accept the fixture inserts the tests make (`name`, `annual_budget`, `is_income`; a bare `transfer_groups` row) | **yes** | existing | `psql postgresql://localhost/b8_p42a_throwaway -Atc "select count(*) from information_schema.columns where table_name='budget_categories' and column_name in ('name','annual_budget','is_income')"` → `3`, and `select coalesce(to_regclass('public.transfer_groups')::text,'none')` → `transfer_groups` | filled at G0 |
| T21 | A browser or jsdom renderer | **NO** | n/a. None is installed. Wording is proved over real HTTP (the surface script) and by source checks. | n/a | n/a |
| T22 | Live Plaid, the Anthropic API, mail, the dev database `b8_finance`, the owner's real ledger | **NO** | n/a | n/a | n/a |
| T23 | The fixture file is on disk, is valid JSON, and `shasum` exists | **yes** | the orchestrator writes it from this spec before G0 freezes | `node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log("json ok")' apps/web/lib/fixtures/loyalty-earn-cases.json` → `json ok`, and `shasum -a 256 apps/web/lib/fixtures/loyalty-earn-cases.json` prints a 64-hex digest equal to the literal that replaces `1dcd2fa812a05d954dacf9e3827dae9703e66565013a9f2fad08ae0b2c2b93b2` in command 15 | filled at G0 |

**The throwaway database is mutated by commands 4 and 7 and is left at the new head.** Command 9 (P8-42a2 regressions) runs after command 4 against that new head; they do not read loyalty column lists (checked: only P8-42a's SPEC line 287 reads column names, for a `%fee%` match, and the new names contain no `fee`). If any regression block asserts a loyalty table or column list that the new migration breaks, that is a conflict to raise to the orchestrator, not to absorb.

### Prerequisites the orchestrator creates
**The fixture file `apps/web/lib/fixtures/loyalty-earn-cases.json`.** The orchestrator writes exactly the content below to that path before G0 freezes this spec, computes `shasum -a 256` of it, and replaces the literal `1dcd2fa812a05d954dacf9e3827dae9703e66565013a9f2fad08ae0b2c2b93b2` in command 15 with the digest. The implementer does not create, edit, reformat or delete it (command 13 allows it as a present file, command 15 pins its hash). Every expected value was derived by hand from the rules in Conventions (exact product, one rounding, half away from zero); the `why` field says what each case pins. All data is fabricated.

Reading the file. `day` is an offset in calendar days from Postgres `CURRENT_DATE` (negative is the past). A row's omitted fields take `defaults.row`. `account` is `card` (the linked account) unless it says `other` (a second, unlinked credit account). A reading's omitted `unit` is `points`. `readings` are listed in entry order (a later entry has a later recorded time). Expected `amount` strings are exactly the `earnEstimate.amount` text, or `null` when `earnEstimate` must be null.

*(Content removed from this spec at G0 so the spec carries no money-like figure: the orchestrator wrote it to `apps/web/lib/fixtures/loyalty-earn-cases.json`, sha256 `1dcd2fa812a05d954dacf9e3827dae9703e66565013a9f2fad08ae0b2c2b93b2`. That file is the binding content of this section.)*

**Prerequisites the implementer must create** (none exist today).
- `apps/web/app/api/v1/loyalty/loyaltyEarn.test.ts`: a new integration test file, collected by the existing glob `app/api/v1/**/*.test.ts`. It contains exactly ten `it(` tests whose titles begin `T42b2-I1:` to `T42b2-I10:`. It loads `apps/web/lib/fixtures/loyalty-earn-cases.json` and, for each case group it covers, loops the cases, pushes each asserted case id onto an array named `seen`, and ends the group with `expect(seen).toEqual(<the group's ids from the file>)` (command 15 counts these).
- `apps/web/lib/loyaltyEarnUi.test.ts`: a new unit test file, collected by `lib/**/*.test.ts`. It contains exactly one `it(` test whose title begins `T42b2-U4:`.
- Three tests added to the existing `packages/contracts/loyalty.test.ts`, titles beginning `T42b2-U1:`, `T42b2-U2:`, `T42b2-U3:`. They load the same fixture file for `contractCases` and use the same `seen` pattern.
- One new migration file, `db/schema.sql` updated, and the contract change (guardian).
- A new step `H13` in `apps/web/scripts/gifts-surface-check.mjs`, after H12, reading the `h13` group of the fixture file (with `fs`, not an import), and the script's closing line becomes `OK H1-H13`.
- Totals after the task: unit 105 files and 1414 tests; integration 344 tests (334 + 10).
- No fixture CSV is added or changed. P8-42a #13 still asserts exactly four `loyalty-import.*.csv` files.

## Open questions with defaults
All defaults were accepted at G0 cycle 1.

1. **Rule storage shape.** Default: one nullable column `loyalty_memberships.earn_base_rate` plus a table `loyalty_earn_rules(id, membership_id, position, match_kind, match_text, rate)` with `UNIQUE (membership_id, position)`. Why: an ordered list of rules each needing a CHECKed kind, a bounded rate and a bounded text is what a table expresses and a JSON column would leave to application code; the unique `(membership_id, position)` makes the order total with no tie; and the rules belong to a membership (like the benefit) not to a link, so an unlink keeps them. Alternative rejected: a JSON array column, because each of those CHECKs would move into application code and the "no stored estimate" schema command could no longer see what the column holds. The guardian may choose another shape if the names the commands query stay (Contracts touched).
2. **Match semantics.** Default: category rules match by exact equality after trimming and case-folding (never substring, never a pattern); merchant rules match as a whole-word phrase, case-folded and whitespace-collapsed, in `name` OR `merchant_name`. Why: `mapped_category` is a name that is "renamed and reused loosely" (db/schema.sql), so case must not matter but a substring would let one category swallow another that begins with it; for merchants, a Plaid row has a clean `merchant_name` and a noisy `name`, while a card with no feed has only `name`, so reading both is what makes one rule work for both. Whole-word matching stops a longer word matching a shorter phrase, the same lesson as P8-42b's fee words. The merchant text charset is restricted to letters, digits, space, `&`, `'` and `-` so that no character could be taken as a pattern character by any implementation.
3. **Rule order.** Default: the submitted array order is the stored `position` order and the match order, first match wins, and the response preserves it. Why: ITEM.md says "the first matching rule wins, in a stated order", and an order the owner can see and re-submit is the only one with no hidden tie-break. Rules mix kinds in one list, so a merchant rule can sit above a category rule and win.
4. **Spend, payment, refund.** Default: Conventions' Spend rule. A purchase is any positive, non-transfer, non-annual-fee row; the name filter applies only to credits. A credit is a refund only when it carries a category, is not income, has none of the payment, transfer, loan, deposit, interest and reward words, and is not the refund of an annual fee. Why: ITEM.md measured that card rows include loan disbursements, card payments, income and transfer-ins, all money in, so the sign alone would make a card payment look like a giant refund. Name filtering of purchases is rejected because a charge whose name says payment is real spend. A credit with a null category is not trusted to be a refund (conservative: the estimate errs high, not low, on an uncategorised credit; a stated limit). Known limits, stated and not fixed: a payment whose bank text carries none of the listed words and a shopping-like category would be taken as a refund; a refund that carries a listed word is not recognised.
5. **Fee rows excluded.** Default: only P8-42b's annual-fee rows (the whole-word phrases `annual membership fee` and `annual fee` on a debit's name), all of them, not only the latest. Late fees, interest, and foreign-transaction fees are not recognised as non-spend: they are debits on the card and are counted at the matching rate. The owner can neutralise them with a category rule at rate zero (valid, fixture case `E13`). Why: the owner's fee category cannot decide (P8-42b OQ1), and ITEM.md asks only for the annual fee rows.
6. **Gift-held rows.** Default: a held row is not spend, for any viewer. Why: P8-42b's precedent, and the merchant rule reads `name`, which a held row masks for everyone but its giver; including held rows by amount and category only would make the estimate jump twice (on the reveal date the name unmasks and a merchant rule starts to apply). Excluding is one step at one date and the same for everyone. The cost is a brief underestimate while a purchase is held, covered only by the generic word "estimated".
7. **Rounding, and negative results.** Default: sum exactly, round once at the end, to the unit's scale (zero decimals for points and miles, two for usd), half away from zero; a negative net result is shown as a negative number, not clamped. Why: the estimate is compared with an integer balance and the half cases are where per-row rounding and once-at-the-end disagree (fixture case `E7`). Clamping at zero would hide a window where refunds exceeded purchases, which is information (a refund of last window's purchase). Display of a negative cash estimate is whatever `formatBalance` prints, including where it puts the minus sign inside the dollar form: a cosmetic limit of the shared formatter, accepted, not fixed here.
8. **No-reading fallback.** Default: with no reading, `since` is `CURRENT_DATE - 30`, spend dated after it, labelled `no reading yet, last 30 days`; the unit is the program's `default_unit`. Why: ITEM.md fixes 30 days; the label is its "says so". The window is 30 posted days inclusive of today, consistent with "after `since`".
9. **Comparison window and typed corrections.** Default: current reading versus the reading with the greatest earlier `as_of`; spend dated after the earlier and up to the later `as_of`. A typed correction on the same date as the current reading replaces the current balance but does not become its own "previous". Why: two readings on one date describe one moment; treating the earlier as "previous" would compare against a zero-day window. Adjacent windows then partition the spend with no overlap (fixture case `C11`).
10. **Miss threshold.** Default: 25 percent, a constant `LOYALTY_EARN_MISS_PERCENT`, decided on the emitted figures, strictly greater than. Why: a retention bonus or an uncoded category is a swing of a quarter or more of the estimate, while ordinary posting-date skew between spend and statement is not; the constant is easy to find and change at a later step, and a stored per-membership threshold would be new configuration nobody asked for. Very small estimates are noisy (a tiny estimate against a zero actual is a 100 percent miss); accepted, and the mark is advisory ("worth a look"), not an alert.
11. **Does the unit matter for the rate scale?** Default: no conversion; a rate is "units per one currency unit" in whichever unit the estimate is in, so `usd` rates are fractions of a currency unit. `nights` gives no estimate (null). Why: a programme in `nights` has no per-currency earn, and inventing a number would be a wrong zero's cousin.
12. **Gift-surface class.** Default: unchanged. `/travel` and the four membership-view routes stay `numeric-only`; `/accounts/[id]` stays `text-bearing`; the seven other loyalty routes stay `no-transaction-data`. Why: the merchant rule makes the estimate depend on row text, but the output is a number priced from rows every viewer is read as `null` for, with held rows removed, so no text and no per-viewer difference reaches a page or the API. The rule text on the page is the owner's own configuration, not ledger text. T42b2-I7 and H13 prove the "same for every viewer" claim over a held row whose real name matches a merchant rule.
13. **Empty period.** Default: a reading dated today or one day ahead gives a zero estimate with `since` equal to that date, a true zero; it is shown as `≈ ` zero then ` estimated since <date>`. Why: the card was not used since the reading, and "—" would suggest the estimate could not be computed (fixture cases `P7`, `P8`).
14. **Where earn rules are edited.** Default: the existing membership PATCH carries `earn`, replacing the whole description or clearing it, as 42b did for `benefit`. Why: no new route, route count stays 11, one atomic replace.
15. **Rule edits are retroactive on the derived figures.** Default: yes, because nothing derived is stored. A comparison for an old window uses today's rules. Why: ITEM.md forbids storing the comparison; a stored snapshot would be the second answer that can disagree.
16. **Bearer tokens and viewers.** Default: the answer is the same for every caller (cookie user or bearer token of any scope); a read-scope token may read it and is refused every write.
17. **Where the exact figures live.** Default: one fabricated fixture file pinned by hash, loaded by the tests and the surface script, with this spec naming cases by id only. Why: AGENTS.md forbids money-looking figures in tracked narrative, and a pinned file stops an implementer from choosing convenient numbers.

## Scenarios
All fixtures are fabricated and canary-marked `ZQ42B2`. Every date is computed relative to Postgres `CURRENT_DATE` by a helper that runs `SELECT (CURRENT_DATE + n)::text` (as `pgDay` does in `loyalty.test.ts`), never the JS clock. `T` below means `CURRENT_DATE`, and `T-n` the day `n` days before it. Each integration test seeds what it asserts on and cleans its own rows (accounts, transactions, transfer groups, budget categories named `ZQ42B2 …`, gifts, members). Each fixture case uses its own credit account `zq42b2_<case id>` linked to its own membership; a case's `defaults` come from the file's `defaults` object; "estimate" means `earnEstimate.amount`, and "comparison" means `earnComparison`. A case's expected value is asserted as exact text. No scenario reads the dev database. Fixture groups are loaded from the file and asserted case by case, each id pushed to `seen` and `expect(seen).toEqual(<ids>)` at the end of the group.

| Id | Observable rule | Fixture and assertion | Catches |
|---|---|---|---|
| T42b2-U1 | The membership PATCH body accepts the earn description and refuses everything else. | `LoyaltyMembershipPatchRequestSchema` against fixture `contractCases`: every `rateAccept` value is accepted as `baseRate` and as a rule `rate`; every `rateRefuse` value and every `rateRefuseNonString` value is refused in both places; every `merchantMatchAccept` value is accepted and every `merchantMatchRefuse` value refused as a merchant match; a category match of one more than `lengths.categoryMax` characters, a merchant match of one more than `lengths.merchantMax`, and a list of one more than `lengths.rulesMax` rules are refused, while the maximum of each is accepted; a blank or whitespace-only match; an unknown `kind`; a stray key in `earn` or in a rule; `earn:{}`; `earn` without `baseRate`; `earn` without `rules`; two rules with the same kind and the same case-folded match; `{}` are refused. Also accepted: `earn:null`, and a body combining `earn` with `benefit`, `cardAccountId` and `tier`. | A schema that accepts a JSON number or a fifth decimal, an unbounded list, a pattern character in a merchant text, a dead duplicate rule. |
| T42b2-U2 | A membership response carries the new fields and they are internally consistent. | `LoyaltyMembershipSchema` (existing `membership()` fixture plus the three keys `null`) parses. `earn` with rules in order parses. `earnEstimate.amount` accepts every `amountAccept` value for its unit and refuses every `amountRefuse` value for its unit; `earnComparison.differencePercent` accepts every `percentAccept` value and refuses every `percentRefuse` value. `unit:'nights'` on either object is refused; `basis` other than the two; `since` malformed; `from` not before `to`; `differencePercent` null with a non-zero `estimated`; a non-null `differencePercent` with a zero `estimated`; an extra key (a spend amount, `rows`, `merchant`) in either object; a missing `earn`, `earnEstimate` or `earnComparison` key; `earnEstimate` non-null with `cardAccountId` null or `earn` null; `earnComparison` likewise. `LoyaltyOverviewSchema` still parses with membership fixtures carrying the keys. The four constants are 20, 100, 30 and 25. | A state that can contradict its inputs, a leaked spend or merchant key, a negative zero, a wrong scale, an optional field where required. |
| T42b2-U3 | The create schema still refuses `earn`, and nothing else in the contract shrank. | `LoyaltyMembershipCreateRequestSchema.safeParse` of a create body that adds `earn` (taken from fixture case `K2`) is a failure. `LoyaltyErrorCodeSchema` accepts every code it accepted before (the nine of P8-42b) and accepts no new one. `LoyaltyMembershipPatchRequestSchema` still accepts P8-42b's `cardAccountId` and `benefit` bodies unchanged. | A link or earn opened on create, a new or renamed error code, a regression on the P8-42b request shape. |
| T42b2-U4 | The pages carry the fixed wording and the controls, and the new text has one home. | Source checks (TypeScript AST, as `loyaltyCardUi.test.ts` does) over `apps/web/components`, `apps/web/app/travel` and `apps/web/app/accounts/[id]/page.tsx`. Each of `estimated since`, `no reading yet, last 30 days`, `No earn rates set`, `No estimate for this unit`, `Estimate vs actual`, `reported `, `worth a look`, `no caps, tiers or rotating categories`, `Set earn rates`, `Clear earn rates` occurs in a non-test source. The estimate text occurs in a component rendered by both `AccountEarnsInto` and the `/travel` card line (one home). `earn: null` occurs in exactly one non-test source line, inside a handler attached through a JSX `on…` attribute on the element whose text contains `Clear earn rates`. The components import `formatBalance` from `@/lib/domain/loyalty` and define no digit-grouping of their own (no `toLocaleString`, no `Intl.NumberFormat`). No component or the travel page imports `db` or `@/lib/db` or contains `FROM transactions`. Fabricated violating sources are fed to each checker and must be rejected: a second `earn: null`, a handler not attached to `Clear earn rates`, a missing phrase, a `toLocaleString` call, a raw transactions read. A clean source is accepted. | A control that is missing, a second clear path, a page that prints an estimate without the word "estimated", a second formatter, a page reading the ledger itself. |
| T42b2-I1 | The earn description is stored, validated, replaced atomically and cleared. | Route handlers against the throwaway DB. For each `configCases` case: the PATCH answers 200 and the response `earn` equals the case's `emitted` rates in the submitted rule order; the table holds one row per rule at strictly increasing positions in submitted order and the base rate. Re-submitting case `K1`'s rules in reverse order reverses the response order. A body whose third rule is invalid answers 400 `INVALID_INPUT` and the membership's rows and the loyalty checksum are unchanged (atomic). Each refused body of T42b2-U1 through the route answers 400, nothing changed. `{earn:null}` answers 200 with `earn` null, no rule rows and a null base rate. A membership with no card accepts the description and returns `earnEstimate` null. The error message never echoes a submitted match text. Direct SQL: setting the base rate to a value above the maximum (101) or below zero (-1) fails with `23514`; inserting a rule with a rate above the maximum or below zero, an unknown `match_kind`, an empty, untrimmed or over-long `match_text` each fails with `23514`; a second rule at an existing `(membership_id, position)` fails with `23505`. A read-scope bearer token PATCHing `earn` answers 403 `INSUFFICIENT_SCOPE`, unchanged; no session answers 401. The create route still refuses `earn` (400). | A half-applied update, a lost order, a pattern character stored, an unbounded rate, a write by a read token, a 500 on a lost race. |
| T42b2-I2 | The figures and the rounding, as exact decimals. | Fixture group `estimateCases` (`E1` to `E19`): for each, configure the case's base rate, rules and reading (unit and balance), seed its rows, and assert `earnEstimate.amount` equals the case's `expected` text exactly, or `earnEstimate` is null when `expected` is null. They pin: exact product rounded once (`E1`), halves away from zero in both signs (`E2`, `E3`, `E5`), below a half (`E4`), no negative zero (`E6`), once-not-per-step (`E7`), a bonus rule plus the base (`E8`), four-decimal rates (`E9`), cash scale (`E10` to `E12`, `E18`), a zero rate (`E13`), a true zero (`E14`), no description (`E15`), points and miles scale (`E16`, `E17`), and the nights gate (`E19`). | Per-row rounding, bankers' rounding, a negative zero, a float product, a wrong usd scale, a rate of zero dropped, null shown as zero, a zero shown as null. |
| T42b2-I3 | What is spend, what is a payment, what is a refund. | Fixture group `spendCases` (`S1` to `S21`): each case's card has the default baseline row plus the case's rows (and any `setup.budgetCategories` seeded and cleaned), base rate from `defaults`; assert the estimate equals the case's `expected`. Not counted, estimate stays at `defaults.spendBaselineExpected`: card payment, autopay, transfer-group credit and purchase, half-paired transfer category, income credit, loan disbursement, uncategorised credit, the annual fee unrefunded and refunded and "statement refund"-paired, the zero row, the reward redemption, two annual fees, another card's spend (`S1` to `S15`). Counted: a purchase named like a payment, an ordinary categorised refund, a similar-looking fee word, a hidden purchase, an uncategorised purchase, a purchase in a budget-excluded category (`S16` to `S21`). | A card payment read as a giant refund, a transfer counted, a fee counted, a refund of a fee reducing spend, a payment-named purchase dropped, an income credit treated as a refund, another card's spend leaking in, `hidden` ignoring spend. |
| T42b2-I4 | Rule matching, and first match wins. | Fixture group `matchCases` (`M1` to `M14`) on a card whose rules default to `defaults.matchRules` (a category rule then a merchant rule), base rate from `defaults`, and rows that default to the baseline row with the case's overrides; `M2` re-submits the rules in reverse order first; `M13` and `M14` override the rules or the row name as stated. Assert the estimate equals each case's `expected`. They pin first match and reversal (`M1`, `M2`), category case and spacing (`M3`), whole-word merchant matching (`M4`, `M8`), hyphen boundary and collapsed spaces (`M5`, `M6`), merchant name read (`M7`), another category (`M9`), exact not prefix category (`M10`), no category (`M11`), a refund priced by its own rule (`M12`), a percent sign literal (`M13`), and pattern characters in a row name (`M14`). | A substring or LIKE match, a case-sensitive match, a rule order that is not the stored one, a refund not priced by its category, a rule applied to the wrong category. |
| T42b2-I5 | The period, the no-reading fallback, and units. | Fixture group `periodCases` (`P1` to `P11`): for each, enter the case's readings in listed order, seed its rows (each with its `authorizedDay` when given), assert `earnEstimate.amount`, `since` (as the Postgres date `sinceDay` days from today), `basis` and `unit`, or a null estimate when the expected amount is null. For a case with no reading, create the program with the case's `programDefaultUnit`. They pin the boundary days (`P1`), posted date over authorized date (`P2`, `P3`), a newer reading (`P4`), an older-dated later entry (`P5`), a same-date correction (`P6`), a reading dated today or tomorrow (`P7`, `P8`), and the 30-day fallback with each default unit (`P9`, `P10`, `P11`). | A boundary off by one, a `>=` for `>`, the authorized date used, a reading chosen by arrival, a clock-dependent window, a wrong unit with no reading. |
| T42b2-I6 | The comparison, its boundaries and its window. | Fixture group `comparisonCases` (`C1` to `C15`): for each, enter the readings in listed order, seed the rows, and assert `earnComparison` equals the case's `expected` object with `from` and `to` as Postgres dates `fromDay` and `toDay` days from today, or is null when `expected` is null. Where a case has `estimateExpected` also assert the estimate amount, and where it has `estimateUnit` its unit. They pin small and large differences (`C1`, `C2`), both threshold edges and just beyond them with the half-away-from-zero percentage (`C3` to `C6`), zero estimates (`C7` to `C9`), the window's edges (`C10`), the partition across three readings (`C11`), a same-date correction (`C12`), a unit mismatch (`C13`), one reading (`C14`) and two readings on one date (`C15`). | A percentage computed on the rounded percent, a threshold `>=`, a window that double counts a day, a correction used as "previous", a comparison across units, null shown as zero. |
| T42b2-I7 | A gift-held row is never spend, for any viewer, and the read path is used. | Fixture `giftCase`: seed its rows with the `held` row linked to a gift whose giver is the second user and recipient the owner, and the `controlRow` on a second linked card with its own matching rule. For each step in `steps`, set the gift's reveal date `revealDay` days from today and, for each of the three `viewers` (owner as recipient, second user as giver, a read-scope bearer token), assert the estimate equals the step's `expected`, the three responses are byte-identical, and the response text holds none of `forbiddenText`. The control membership's estimate equals `controlRow.expected` at every step. Assert the ids with `seen`. | A giver-only exclusion, a non-giver seeing the real name, a held row counting, a reveal boundary off by one, an always-excluded or always-included held row. |
| T42b2-I8 | Nothing derived is stored, the shape is exact, and unlinking keeps configuration. | After the cases of I2 to I6, the checksum of the loyalty tables (the one `loyaltyCard.test.ts` computes, extended by this test to include `loyalty_earn_rules`) is unchanged by two `GET`s and by inserting and deleting transactions and readings elsewhere. A membership view's key set is exactly `id, memberId, memberDisplayName, programId, memberNumberMasked, tier, balance, unit, asOf, source, cardAccountId, cardAccountName, benefit, feeWatch, earn, earnEstimate, earnComparison`; `earn`'s is `baseRate, rules`; a rule's is `kind, match, rate`; `earnEstimate`'s is `since, basis, unit, amount`; `earnComparison`'s is `from, to, unit, estimated, actual, differencePercent, worthALook`. The serialised overview contains neither a spend row's name nor its amount text. Unlinking (`cardAccountId:null`) on a case-`E1` membership: `earn` and its rules are intact, `earnEstimate` and `earnComparison` are null; relinking the same card restores a byte-identical `earnEstimate`. Deleting the linked account (no transactions) leaves the membership with `earn` intact and `cardAccountId`, `earnEstimate` null. Two b8 users get identical `earn`, `earnEstimate`, `earnComparison`. `earn:null` removes every rule row. | A stored figure, a leaked amount, an unlink that clears the rules, a relink that changes the answer. |
| T42b2-I9 | No side effects on the ledger, the fee watch is untouched, and the routes stay peers. | Net worth (`computeCurrentNetWorth`), the ledger overview response, and row checksums of `accounts`, `transactions`, `budget_categories` and `transfer_groups`, taken before and after setting an earn description, reading the estimate, and clearing it: identical. A card with an annual-fee row and a described benefit has an identical `feeWatch` before and after the earn description is set and cleared, and its fee row does not change the estimate (fixture case `S9`'s rows). A read-scope token reads the view and is refused each write. The loyalty route files number 11. | A write to the ledger, an estimate that disturbs the fee watch, a new route. |
| T42b2-I10 | The gates that make a figure missing rather than zero, and the viewers agree. | With rules set and spend present: a card linked but `earn` null gives `earnEstimate` null; `earn` set but `cardAccountId` null gives `earnEstimate` and `earnComparison` both null; a `nights` reading gives both null (fixture case `E19`); two readings in different units give `earnComparison` null while `earnEstimate` stays non-null in the current unit (fixture case `C13`); a program with default unit `nights` and no reading gives `earnEstimate` null (fixture case `P11`). Both b8 users and a read-scope token get identical bodies for each. | Nights shown as zero, a unit mix-up in the comparison, a missing value rendered as zero. |
| T42b2-H13 | Over real HTTP, with a held row, the pages and the API agree and show the wording. | In `gifts-surface-check.mjs`, after H12, on its scratch database `b8_gifts_check`, reusing the script's fabricated credit account, the second gift pattern of H12, and the PATCH route, driven entirely by fixture group `h13`: seed its `reading` through the observations route, its `rows` (the `held` row linked to a gift whose giver is the second user and recipient the owner, with its `revealDay`), and run its eight `steps` in order, each for the owner and the second user, on `/travel`, `/accounts/<card>` and `/api/v1/loyalty` (HTML with `<!-- -->` comments removed). Per step assert the `expect` object: the API's `earn`, `earnEstimate` (with `since` as the Postgres date `sinceDay` days from today) and `earnComparison`, every `htmlHas` string on both pages, no `htmlAbsent` string on either, and the two viewers' estimates equal. Across every step no `/travel` or API response holds any `forbiddenText` string (the account page is text-bearing and shows the giver their own held row by design, as in H12, so it is excluded by `forbiddenOn`). The step prints `H13 PASS …` and the final line is `OK H1-H13`. | A page that does not render the estimate, an estimate without the word "estimated", a held row leaking by name or amount, a viewer-dependent answer, a fee or payment counted, a stale or hard-coded figure. |

## Acceptance commands

**Amendment A2 (orchestrator, at G2, 2026-11-21).** Command 12's spend/amount-key scan grepped every component, and 21 component files untouched by this task already match it at `HEAD` (`git grep -c` over `HEAD`), so it could not pass. It is narrowed to this task's page surface: `components/Loyalty*`, `Travel*`, `AccountEarns*` and `app/travel/*.tsx`. The implementer's surviving mutation N02b (`Number(figure) * 1`) exposed a float gap, so the same command also refuses `Number(` in `lib/loyaltyEarn.ts` and `components/LoyaltyEarn*.tsx`.

**Amendment A1 (orchestrator, at G1, 2026-11-21).** Command 5's unique-index check matched `indexdef ILIKE '%(membership_id, position)%'`, but `position` is a Postgres keyword that `pg_get_indexdef` quotes; measured on the throwaway DB: `CREATE UNIQUE INDEX loyalty_earn_rules_membership_position_key ON public.loyalty_earn_rules USING btree (membership_id, "position")`. The pattern now reads `(membership_id, \"position\")` (shell-escaped quotes inside the double-quoted query). Raised by the guardian, not worked around in the schema.
All run from the repo root under `bash`. `U=postgresql://localhost/b8_p42a_throwaway`. Dates come from Postgres inside the tests, never the wall clock. No command uses a leading `!` as a guard (T15). Where a command asserts absence it uses `if … then …; exit 1; fi` or an explicit string comparison. No command puts a double-quoted `{a,b}` brace pattern inside `"$( … )"` (P8-42b GATES A0: macOS `/bin/bash` 3.2 brace-expands it); patterns with braces or commas are kept in a variable. Run order: 1 to 3, then 4 (brings `$U` to the new head and proves up/down/up), then the rest.

| # | Command | Expected | Would break if |
|---|---|---|---|
| 1 | `(cd apps/web && npx tsc --noEmit --incremental false; echo "exit=$?")` | `exit=0` | the three new required response fields break a consumer |
| 2 | Lint, below | `exit=0`, `OK lint 0 errors, warnings not above 5` | a lint regression |
| 3 | Unit totals, below | `OK unit 105 files 1414 tests` | a missing or extra new test, a broken existing test |
| 4 | Migration up, shape, constraint refusals and down/up data survival, below | `OK migration up-down-up` | a wrong column, a missing CHECK or unique key, a `down` that destroys the link, the benefit or instruments |
| 5 | Stored-state schema check, below | `OK schema` | a stored estimate or comparison column, a third table, a `schema.sql` out of step |
| 6 | New unit scenarios, below | two lines `OK 4 scenarios T42b2-U1..U4 each present once and passed; TZ=<zone>` (UTC, Pacific/Auckland) | a missing or duplicated scenario, a zone-dependent result |
| 7 | Integration scenarios, below | `OK 344 tests, T42a-C1-C11 and I1-I11 and T42a2-I1-I3 and T42b-I1-I10 and T42b2-I1-I10 each present once and passed`, then `OK no fixture rows left` | any new rule fails, an old scenario regresses, a leftover fixture row, a failing title outside KNOWN |
| 8 | Integration stability, P8-42a #7 extracted via P8-42a2 line 153, below | `[]`, `[]`, `OK failing set stable and within KNOWN` | an order-dependent or leaking new test |
| 9 | Regression, P8-42b #9 to #12 extracted with guards, below (9a to 9d) | 9a two `OK 10 scenarios U1-U10 …` and two `OK 3 scenarios T42a2-U1..U3 …`; 9b `OK as-of bound` and `OK failure class`; 9c `OK import end to end`; 9d `OK sidebar`, `OK source guards`, `OK fixtures fabricated`, `OK coarse source checks` | the member-number, mask, reducer, clear-control or import guarantees disturbed |
| 10 | Surface script over real HTTP, below | `H1 PASS` to `H13 PASS` each once, last line `OK H1-H13`, then `OK surface` | any page or API leak, wording missing, a viewer-dependent answer |
| 11 | Registry and script classes, P8-42b #14 extracted, plus a no-class-change guard, below | `OK classes`, then `OK no class line changed` | a class changed when the spec says none changes |
| 12 | Source guards for this task, below | `OK task source guards` | a raw ledger read, a JS clock or float, a figure in a comment, a second clear sender, a missing canary |
| 13 | Scope guard, below | no output | a file outside the allowed set changed, a required file missing, the applied migration edited, a second new migration |
| 14 | Existing-test edit guard and census, below | one line `OK existing tests edited only as allowed; removed lines <n>`, and no other output | a weakened existing test, a missing or extra new test title |
| 15 | Fixture pinned and covered, below | `OK fixture pinned and covered` | an edited fixture, a case group the tests never read, a group asserted without its id list, a figure literal in a new test |
| 16 | `npm run build; echo "exit=$?"` | `exit=0` | a type or bundling error |

**#2 (lint).**
```
set -e; O="$(mktemp)"; npm run lint > "$O" 2>&1 || true; tail -4 "$O"
if grep -qE '[1-9][0-9]* errors?' "$O"; then echo "FAIL lint reports errors"; exit 1; fi
W="$(grep -oE '[0-9]+ warnings?' "$O" | tail -1 | grep -oE '^[0-9]+' || true)"
[ "${W:-0}" -le 5 ]
echo "OK lint 0 errors, warnings not above 5"
```
The `grep` for errors reads eslint's summary `✖ N problems (E errors, W warnings)`; with zero errors the pattern `[1-9][0-9]* errors?` does not match `0 errors`.

**#3 (unit totals).**
```
set -e; O="$(mktemp)"; npm test > "$O" 2>&1 || true; tail -8 "$O"
[ "$(grep -cE 'Test Files +105 passed \(105\)' "$O")" = 1 ]
[ "$(grep -cE 'Tests +1414 passed \(1414\)' "$O")" = 1 ]
echo "OK unit 105 files 1414 tests"
```

**#4 (migration: shape, refusals, survival).**
```
set -e; U=postgresql://localhost/b8_p42a_throwaway
Q(){ psql "$U" -v ON_ERROR_STOP=1 -Atq -c "$1"; }
MIG(){ DATABASE_URL="$U" npm run "$1" >/dev/null 2>&1; }
MC="SELECT string_agg(column_name, ',' ORDER BY column_name COLLATE \"C\") FROM information_schema.columns WHERE table_schema='public' AND table_name='loyalty_memberships'"
RC="SELECT string_agg(column_name, ',' ORDER BY column_name COLLATE \"C\") FROM information_schema.columns WHERE table_schema='public' AND table_name='loyalty_earn_rules'"
OLD="benefit_description,benefit_kind,benefit_window_days,card_account_id,created_at,id,member_id,member_number,program_id,tier"
NEW="benefit_description,benefit_kind,benefit_window_days,card_account_id,created_at,earn_base_rate,id,member_id,member_number,program_id,tier"
RULES="id,match_kind,match_text,membership_id,position,rate"
MIG migrate:up
LATEST="$(Q "SELECT name FROM pgmigrations ORDER BY id DESC LIMIT 1")"
if [[ "$LATEST" == 1792800000000_loyalty_card_benefit ]]; then echo "FAIL no migration newer than the card-benefit one"; exit 1; fi
[[ "$LATEST" > "1792800000000_loyalty_card_benefit" ]]
[ "$(Q "$MC")" = "$NEW" ]
[ "$(Q "$RC")" = "$RULES" ]
Q "TRUNCATE loyalty_instruments, loyalty_observations, loyalty_memberships, household_members RESTART IDENTITY CASCADE"
Q "DELETE FROM accounts WHERE id='zq42b2_mig_card'"
Q "INSERT INTO accounts (id, name, type) VALUES ('zq42b2_mig_card', 'ZQ42B2 Migration Card', 'credit')"
Q "INSERT INTO household_members (display_name) VALUES ('ZQ42B2 Mig')"
Q "INSERT INTO loyalty_memberships (member_id, program_id, card_account_id, benefit_kind, benefit_description, benefit_window_days, earn_base_rate) SELECT (SELECT id FROM household_members), (SELECT min(id) FROM loyalty_programs), 'zq42b2_mig_card', 'free_night', 'ZQ42B2 night', 45, 2"
Q "INSERT INTO loyalty_earn_rules (membership_id, position, match_kind, match_text, rate) SELECT id, 1, 'category', 'ZQ42B2 Hotel', 3 FROM loyalty_memberships"
Q "INSERT INTO loyalty_earn_rules (membership_id, position, match_kind, match_text, rate) SELECT id, 2, 'merchant', 'zq42b2 hotelco', 5 FROM loyalty_memberships"
Q "INSERT INTO loyalty_instruments (membership_id, kind, description, source) SELECT id, 'free_night', 'ZQ42B2 kept', 'typed' FROM loyalty_memberships"
R(){ if Q "$1" 2>/dev/null; then echo "FAIL the database accepted: $1"; exit 1; fi; }
R "UPDATE loyalty_memberships SET earn_base_rate = 101"
R "UPDATE loyalty_memberships SET earn_base_rate = -1"
R "INSERT INTO loyalty_earn_rules (membership_id, position, match_kind, match_text, rate) SELECT id, 3, 'category', 'x', -1 FROM loyalty_memberships"
R "INSERT INTO loyalty_earn_rules (membership_id, position, match_kind, match_text, rate) SELECT id, 3, 'category', 'x', 101 FROM loyalty_memberships"
R "INSERT INTO loyalty_earn_rules (membership_id, position, match_kind, match_text, rate) SELECT id, 3, 'other', 'x', 1 FROM loyalty_memberships"
R "INSERT INTO loyalty_earn_rules (membership_id, position, match_kind, match_text, rate) SELECT id, 3, 'category', '', 1 FROM loyalty_memberships"
R "INSERT INTO loyalty_earn_rules (membership_id, position, match_kind, match_text, rate) SELECT id, 3, 'category', ' x', 1 FROM loyalty_memberships"
R "INSERT INTO loyalty_earn_rules (membership_id, position, match_kind, match_text, rate) SELECT id, 3, 'category', repeat('x', 101), 1 FROM loyalty_memberships"
R "INSERT INTO loyalty_earn_rules (membership_id, position, match_kind, match_text, rate) SELECT id, 2, 'category', 'dup', 1 FROM loyalty_memberships"
MIG migrate:down
[ "$(Q "$MC")" = "$OLD" ]
[ "$(Q "SELECT coalesce(to_regclass('public.loyalty_earn_rules')::text, 'none')")" = none ]
[ "$(Q "SELECT card_account_id || '/' || benefit_kind || '/' || (SELECT count(*) FROM loyalty_instruments) FROM loyalty_memberships")" = "zq42b2_mig_card/free_night/1" ]
MIG migrate:up
[ "$(Q "$MC")" = "$NEW" ]
[ "$(Q "$RC")" = "$RULES" ]
[ "$(Q "SELECT card_account_id || '/' || benefit_kind || '/' || coalesce(earn_base_rate::text, 'NULL') || '/' || (SELECT count(*) FROM loyalty_instruments) || '/' || (SELECT count(*) FROM loyalty_earn_rules) FROM loyalty_memberships")" = "zq42b2_mig_card/free_night/NULL/1/0" ]
Q "TRUNCATE loyalty_instruments, loyalty_observations, loyalty_memberships, household_members RESTART IDENTITY CASCADE"
Q "DELETE FROM accounts WHERE id='zq42b2_mig_card'"
echo "OK migration up-down-up"
```
After the `down`, the earn base rate and rules are intentionally gone (the column and table are dropped); the link, the benefit and the instrument survive. The `down` must be the new migration, which the `LATEST` guard asserts. `R` is the absence assertion for the nine rows the database must refuse; under `set -e` it exits 1 if any is accepted (it does not use a leading `!`).

**#5 (stored-state schema check).**
```
set -e; U=postgresql://localhost/b8_p42a_throwaway
Q(){ psql "$U" -v ON_ERROR_STOP=1 -Atq -c "$1"; }
[ "$(Q "SELECT string_agg(table_name, ',' ORDER BY table_name COLLATE \"C\") FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE 'loyalty%' OR table_name='household_members')")" = "household_members,loyalty_earn_rules,loyalty_instruments,loyalty_memberships,loyalty_observations,loyalty_program_aliases,loyalty_programs" ]
[ "$(Q "SELECT string_agg(column_name, ',' ORDER BY column_name COLLATE \"C\") FROM information_schema.columns WHERE table_schema='public' AND table_name='loyalty_instruments'")" = "created_at,description,expires_on,id,issued_on,kind,membership_id,source,used_on" ]
[ "$(Q "SELECT string_agg(column_name, ',' ORDER BY column_name COLLATE \"C\") FROM information_schema.columns WHERE table_schema='public' AND table_name='loyalty_observations'")" = "as_of,balance,id,membership_id,recorded_at,source,unit" ]
[ "$(Q "SELECT string_agg(column_name, ',' ORDER BY column_name COLLATE \"C\") FROM information_schema.columns WHERE table_schema='public' AND table_name='loyalty_memberships'")" = "benefit_description,benefit_kind,benefit_window_days,card_account_id,created_at,earn_base_rate,id,member_id,member_number,program_id,tier" ]
[ "$(Q "SELECT string_agg(column_name, ',' ORDER BY column_name COLLATE \"C\") FROM information_schema.columns WHERE table_schema='public' AND table_name='loyalty_earn_rules'")" = "id,match_kind,match_text,membership_id,position,rate" ]
[ "$(Q "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND (table_name LIKE 'loyalty%' OR table_name='household_members') AND column_name ~* 'fee|state|status|expect|await|receiv|overdue|amount|due|estimate|actual|since|diff|miss|compar|total|result|earned|spend'")" = 0 ]
[ "$(Q "SELECT count(*) FROM pg_indexes WHERE tablename='loyalty_earn_rules' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%(membership_id, \"position\")%'")" = 1 ]
[ "$(Q "SELECT count(*) FROM pg_indexes WHERE tablename='loyalty_memberships' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%(card_account_id)%'")" = 1 ]
[ "$(Q "SELECT confdeltype FROM pg_constraint WHERE conrelid='loyalty_earn_rules'::regclass AND contype='f'")" = c ]
MB="$(awk '/^CREATE TABLE (IF NOT EXISTS )?loyalty_memberships/{f=1} f{print} f&&/^\);/{exit}' db/schema.sql)"
RB="$(awk '/^CREATE TABLE (IF NOT EXISTS )?loyalty_earn_rules/{f=1} f{print} f&&/^\);/{exit}' db/schema.sql)"
printf '%s\n' "$MB" | grep -q 'earn_base_rate'
for c in membership_id position match_kind match_text rate; do printf '%s\n' "$RB" | grep -q "$c"; done
[ "$(grep -c 'earn_base_rate' db/schema.sql)" -ge 2 ]
if git ls-files migrations | xargs grep -ln 'earn_base_rate\|loyalty_earn_rules' | grep -v '_loyalty_earn_rules' | grep -q .; then echo "FAIL earn schema written in an old migration"; exit 1; fi
echo "OK schema"
```
`confdeltype` `c` is ON DELETE CASCADE on the rules' foreign key (a rule cannot outlive its membership). The second `grep -c 'earn_base_rate' db/schema.sql` asks for the column and its CHECK or comment.

**#6 (new unit scenarios; two zones).**
```
set -e; for TZV in UTC Pacific/Auckland; do O="$(mktemp)"; (cd apps/web && TZ=$TZV npx vitest run packages/contracts/loyalty.test.ts lib/loyaltyEarnUi.test.ts --reporter=json --outputFile="$O") || true; node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);let bad=[];for(const id of ["U1","U2","U3","U4"]){const m=t.filter(x=>x.title.startsWith("T42b2-"+id+":"));if(m.length!==1||m[0].status!=="passed")bad.push(id+"="+m.map(x=>x.status).join("/")+"("+m.length+")")}const failed=t.filter(x=>x.status!=="passed").map(x=>x.title);if(bad.length||failed.length||r.testResults.length!==2){console.log("FAIL",process.argv[2],bad.join(","),failed.join(";"),"files="+r.testResults.length);process.exit(1)}console.log("OK 4 scenarios T42b2-U1..U4 each present once and passed; TZ="+process.argv[2])' "$O" "$TZV"; done
```
The prefix `T42b2-U1:` cannot match a P8-42b title (`T42b-U1:`); the colon prevents `T42b2-U1` matching a longer id.

**#7 (integration scenarios from one run; the cleanup check follows it).**
```
set -e; U=postgresql://localhost/b8_p42a_throwaway; O="$(mktemp)"; (cd apps/web && DATABASE_URL=$U npx vitest run --config vitest.integration.config.mts --reporter=json --outputFile="$O") || true
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);let bad=[];const want=[];for(let i=1;i<=11;i++){want.push("T42a-C"+i+":","T42a-I"+i+":")}want.push("T42a2-I1:","T42a2-I2:","T42a2-I3:");for(let i=1;i<=10;i++)want.push("T42b-I"+i+":","T42b2-I"+i+":");for(const p of want){const m=t.filter(x=>x.title.startsWith(p));if(m.length!==1||m[0].status!=="passed")bad.push(p+m.map(x=>x.status).join("/")+"("+m.length+")")}const KNOWN=["the pre-auth ceremony endpoints remain reachable with no session cookie at all","the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio"];const unexpected=t.filter(x=>x.status==="failed"&&!KNOWN.includes(x.title)&&!x.title.startsWith("RC-03:")).map(x=>x.title);if(unexpected.length||bad.length||t.length!==344){console.log("FAIL",unexpected.join(" ; "),bad.join(","),"total="+t.length);process.exit(1)}console.log("OK 344 tests, T42a-C1-C11 and I1-I11 and T42a2-I1-I3 and T42b-I1-I10 and T42b2-I1-I10 each present once and passed")' "$O"
LEFT="$(psql "$U" -v ON_ERROR_STOP=1 -Atq -c "SELECT (SELECT count(*) FROM accounts WHERE id LIKE 'zq42b%')||','||(SELECT count(*) FROM gifts WHERE merchant LIKE 'ZQ42B%')||','||(SELECT count(*) FROM transactions WHERE account_id LIKE 'zq42b%')||','||(SELECT count(*) FROM budget_categories WHERE name LIKE 'ZQ42B%')||','||(SELECT count(*) FROM household_members WHERE display_name LIKE 'ZQ42B%')||','||(SELECT count(*) FROM loyalty_earn_rules)")"
[ "$LEFT" = "0,0,0,0,0,0" ]
echo "OK no fixture rows left"
```
`T42b2-I1:` does not start with `T42b-I1:`, and `T42b-I1:` with its colon does not start with `T42b-I10:`, so each id is counted once.

**#8 (integration stability; P8-42a #7 extracted unchanged via P8-42a2's wrapper).**
```
set -e; S2=plan/tasks/P8-42a2-loyalty-nits/SPEC.md
G(){ case "$(sed -n "${2}p" "$1")" in "$3"*) ;; *) echo "FAIL $1 line $2 moved"; exit 1;; esac; }
G "$S2" 153 "set -e; S=plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md; case \"\$(sed -n '228p'"
bash -c "$(sed -n '153p' "$S2")"
```

**#9 (regression: P8-42b #9 to #12, each extracted by line range with a prefix guard on the first and last lines).**
```
set -e; S=plan/tasks/P8-42b-card-annual-instruments/SPEC.md
X(){ case "$(sed -n "${1}p" "$S")" in "$3"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac
     case "$(sed -n "${2}p" "$S")" in "$4"*) ;; *) echo "FAIL $S line $2 moved"; exit 1;; esac
     RANGE="$1,$2"; BODY="$(sed -n "${RANGE}p" "$S")"; bash -c "$BODY"; }
HEAD='set -e; S2=plan/tasks/P8-42a2-loyalty-nits/SPEC.md'
X 275 280 "$HEAD" $'bash -c "$(sed -n \'137p\''          # 9a, expect: two "OK 10 scenarios U1-U10 ..." and two "OK 3 scenarios T42a2-U1..U3 ..."
X 286 293 "$HEAD" $'bash -c "$(sed -n \'193,207p\''      # 9b, expect: OK as-of bound, OK failure class
X 298 301 "$HEAD" $'bash -c "$(sed -n \'213p\''          # 9c, expect: OK import end to end
X 306 316 "$HEAD" $'bash -c "$(sed -n \'234,242p\''      # 9d, expect: OK sidebar, OK source guards, OK fixtures fabricated, OK coarse source checks
```
The first-line guard is a prefix match on text that starts every one of the four blocks; the last-line guard differs per block, so a block that moved would fail its own last-line guard. The four blocks were verified runnable at P8-42b's G2 and re-verified here as T12. They read P8-42a2's SPEC.md through that spec's own guards, so a move in P8-42a2 fails there too. If any block fails because a P8-42a or P8-42a2 assertion pins state this task legitimately changes (a P8-42b-era count, a class, a component file list), that is an amendment for the orchestrator, named by the implementer, not an edit to this spec or to that test.

**#10 (surface script over real HTTP).**
```
set -e; OUT="$(mktemp)"; node apps/web/scripts/gifts-surface-check.mjs > "$OUT"; cat "$OUT"
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13; do [ "$(grep -cE "^H$i PASS " "$OUT")" = 1 ]; done
[ "$(tail -1 "$OUT")" = "OK H1-H13" ]
if grep -qE 'FAIL' "$OUT"; then echo "FAIL a step failed"; exit 1; fi
echo "OK surface"
```
The script exits non-zero on any failing step, which aborts under `set -e`. Port 3198 must be free (T9).

**#11 (registry and script classes: P8-42b #14 extracted, and no class line changed).**
```
set -e; S=plan/tasks/P8-42b-card-annual-instruments/SPEC.md
case "$(sed -n '332p' "$S")" in 'set -e; R=apps/web/lib/giftSurfaceRegistry.ts; X=apps/web/scripts/gifts-surface-check.mjs'*) ;; *) echo "FAIL $S line 332 moved"; exit 1;; esac
[ "$(sed -n '340p' "$S")" = 'echo "OK classes"' ]
RANGE="332,340"; BODY="$(sed -n "${RANGE}p" "$S")"; bash -c "$BODY"
B="$(git merge-base HEAD main)"
D="$(git diff -U0 "$B" -- apps/web/lib/giftSurfaceRegistry.ts | grep -E '^[-+][^-+]' | grep -E "classes|cls:" || true)"
if [ -n "$D" ]; then echo "FAIL a registry class line changed:"; printf '%s\n' "$D"; exit 1; fi
echo "OK no class line changed"
```
No registry or script class line is required to change (Open question 12); `numeric-only` is already the class for `/travel` and the four membership-view routes, and `text-bearing` for `/accounts/[id]`. The registry's comments may change.

**#12 (source guards for this task; no `!`).**
```
set -e; B="$(git merge-base HEAD main)"; CH="$(mktemp)"; SRC="$(mktemp)"; SCOPED="$(mktemp)"; ADDED="$(mktemp)"
{ git diff --name-only "$B"; git ls-files -o --exclude-standard; } | grep -v '^plan/' | sort -u > "$CH"
grep -E '^apps/web/(lib|components|app)/.*\.(ts|tsx)$' "$CH" | grep -vE '\.test\.ts$' > "$SRC" || true
while IFS= read -r f; do if grep -nE '(^|[^[:alnum:]_])(FROM|JOIN)[[:space:]]+transactions([^[:alnum:]_]|$)' "$f"; then echo "FAIL raw transactions read in $f"; exit 1; fi; done < "$SRC"
grep -E '^apps/web/(lib/(domain/)?loyalty[A-Za-z]*\.(ts|test\.ts)|app/api/v1/loyalty/|app/travel/|components/(Loyalty|Travel|AccountEarns)[A-Za-z]*\.tsx)' "$CH" | grep -vxF apps/web/lib/loyalty.test.ts > "$SCOPED" || true
while IFS= read -r f; do if grep -nE 'toISOString|new Date\(|Date\.now\(|parseFloat|toFixed|Math\.round|getTimezoneOffset' "$f"; then echo "FAIL clock or float in $f"; exit 1; fi; done < "$SCOPED"
for f in apps/web/app/api/v1/loyalty/loyaltyEarn.test.ts apps/web/lib/loyaltyEarnUi.test.ts; do grep -qF 'ZQ42B2' "$f"; done
[ "$(grep -cF '.not.toMatch(/\b(FROM|JOIN)\s+transactions\b/i)' apps/web/app/api/v1/loyalty/loyalty.test.ts)" = 1 ]
[ "$(grep -c "it('T42a-C10:" apps/web/app/api/v1/loyalty/loyalty.test.ts)" = 1 ]
[ "$(grep -rhE 'memberNumber:[[:space:]]*null' apps/web/components apps/web/app/travel | wc -l | tr -d ' ')" = 1 ]
[ "$(grep -rhE 'cardAccountId:[[:space:]]*null' apps/web/components apps/web/app/travel | wc -l | tr -d ' ')" = 1 ]
[ "$(grep -rhE 'earn:[[:space:]]*null' apps/web/components apps/web/app/travel | wc -l | tr -d ' ')" = 1 ]
if grep -rnE 'authorized_date' apps/web/lib/loyaltyStore.ts apps/web/lib/loyaltyEarn*.ts 2>/dev/null; then echo "FAIL the authorized date is read by the earn code"; exit 1; fi
if grep -nE "(spend|amount)[A-Za-z]*[[:space:]]*:" apps/web/components/Loyalty*.tsx apps/web/components/Travel*.tsx apps/web/components/AccountEarns*.tsx apps/web/app/travel/*.tsx | grep -v '\.test\.'; then echo "FAIL a spend or amount key in a page source"; exit 1; fi
if grep -nE 'Number\(' apps/web/lib/loyaltyEarn.ts apps/web/components/LoyaltyEarn*.tsx; then echo "FAIL Number() on an earn figure"; exit 1; fi
while IFS= read -r f; do
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then git diff -U0 "$B" -- "$f" | grep -E '^\+[^+]' | sed 's/^+//' >> "$ADDED" || true; else cat "$f" >> "$ADDED"; fi
done < <(grep -vE '\.test\.(ts|tsx)$' "$CH" | grep -E '^(apps/web/(lib|components|app)/.*\.(ts|tsx)|migrations/.*\.sql|db/schema\.sql|apps/web/scripts/gifts-surface-check\.mjs)$')
if grep -nE '^[[:space:]]*(//|/\*|\*|--)' "$ADDED" | grep -E '[0-9]+\.[0-9]{2}([^0-9]|$)|\$[0-9]'; then echo "FAIL a money-looking figure in an added comment"; exit 1; fi
echo "OK task source guards"
```
The raw-read check covers every changed non-test source, so an earn read that bypasses `visibleTransactions` by writing `FROM transactions` is caught here, by `W1` in command 3 and by `T42a-C10` in command 7. The comment-figure scan reads only ADDED lines of tracked files (and whole new files), so pre-existing lines in a changed file (P8-42b GATES A2: a scan over a changed file hits pre-existing lines) cannot trip it. The clock scan excludes exactly `apps/web/lib/loyalty.test.ts` (P8-42b A2) because it holds a pre-existing absence assertion at its line 494; the other loyalty-scoped files were checked and hold no hit today. `apps/web/lib/loyalty.test.ts` is nevertheless guarded by command 14. The `done < <( … )` form is bash process substitution and was dry-checked on macOS `/bin/bash` 3.2 at G0 cycle 1.

**#13 (scope guard).**
```
B="$(git merge-base HEAD main)"; CH="$(mktemp)"; { git diff --name-only "$B"; git ls-files -o --exclude-standard; } | grep -v '^plan/' | sort -u > "$CH"
grep -vE '^(packages/contracts/loyalty(\.test)?\.ts|db/schema\.sql|migrations/[0-9]+_[A-Za-z0-9_]+\.sql|apps/web/lib/loyalty[A-Za-z]*(\.test)?\.ts|apps/web/lib/domain/loyalty[A-Za-z]*(\.test)?\.ts|apps/web/lib/fixtures/loyalty-earn-cases\.json|apps/web/app/api/v1/loyalty/.*\.ts|apps/web/app/travel/page\.tsx|apps/web/app/accounts/\[id\]/page\.tsx|apps/web/components/(Loyalty|Travel|AccountEarns)[A-Za-z]*\.tsx|apps/web/lib/giftSurfaceRegistry\.ts|apps/web/scripts/gifts-surface-check\.mjs)$' "$CH" || true
git diff --name-only "$B" -- migrations | grep -E '^migrations/(1792[0-9]+_[A-Za-z0-9_]+\.sql)$' || true
for f in packages/contracts/loyalty.ts packages/contracts/loyalty.test.ts db/schema.sql apps/web/lib/loyaltyStore.ts apps/web/scripts/gifts-surface-check.mjs apps/web/app/api/v1/loyalty/loyaltyEarn.test.ts apps/web/lib/loyaltyEarnUi.test.ts apps/web/app/api/v1/loyalty/loyaltyCard.test.ts apps/web/lib/loyalty.test.ts apps/web/lib/fixtures/loyalty-earn-cases.json; do grep -qxF "$f" "$CH" || echo "MISSING $f"; done
[ "$(git ls-files -o --exclude-standard migrations | wc -l | tr -d ' ')" = 1 ] || echo "NOT EXACTLY ONE NEW MIGRATION FILE"
[ -z "$(git diff --name-only "$B" -- migrations)" ] || echo "AN EXISTING MIGRATION CHANGED"
git diff --name-only "$B" -- package.json apps/web/package.json 'apps/web/vitest*' evals apps/web/scripts/import-loyalty.ts apps/web/scripts/fixtures apps/web/lib/giftReadPath.ts apps/web/lib/domain/giftMask.ts apps/web/lib/sync.ts apps/web/lib/netWorth.ts apps/web/lib/transactionEdits.ts apps/web/lib/transferValidation.ts
```
Expected: no output at all. The fixture file is listed as an allowed, required-present file because the orchestrator writes it before the implementer starts (so it shows as an untracked or changed file); its content is not left to this command, command 15 pins its hash. This command also covers: the migration directory gains exactly one new file and no existing migration (the P8-42b migration `1792800000000_loyalty_card_benefit.sql` and `1792700000000_loyalty.sql` included) is edited; nothing under `package.json`, the vitest configs, `evals/`, the import script and its fixtures, or the read-path, sync, net-worth, transfer and transaction-edit modules changes; the route count is asserted by `T42a-C10`.

**#14 (existing-test edit guard and census).**
```
set -e; B="$(git merge-base HEAD main)"
git diff -U0 "$B" -- packages/contracts/loyalty.test.ts apps/web/app/api/v1/loyalty/loyaltyCard.test.ts apps/web/lib/loyalty.test.ts | node -e '
const d=require("fs").readFileSync(0,"utf8").split("\n");
const norm=(s)=>s.replace(/\b(earn|earnEstimate|earnComparison)\s*:\s*null\s*,?/g,"").replace(/["\x27](earn|earnEstimate|earnComparison)["\x27]\s*,?/g,"").replace(/[\s,]+/g," ").replace(/\s+([\]})])/g,"$1").trim();
const hunks=[];let cur=null;
for(const l of d){if(l.startsWith("@@")){cur={rem:[],add:[]};hunks.push(cur)}else if(cur&&l.startsWith("-")&&!l.startsWith("---"))cur.rem.push(l.slice(1));else if(cur&&l.startsWith("+")&&!l.startsWith("+++"))cur.add.push(l.slice(1))}
const bad=[];let pins=0;
for(const h of hunks)for(const r of h.rem){
  if(r.includes("OK H1-H12")){if(h.add.some(a=>a.includes("OK H1-H13"))){pins++;continue}}
  if(!h.add.some(a=>norm(a)===norm(r)))bad.push(r.trim().slice(0,80))}
if(bad.length||pins!==1){console.log("FAIL existing test lines changed beyond the allowance:",bad.join(" | "),"surface-terminal pins="+pins);process.exit(1)}
console.log("OK existing tests edited only as allowed; removed lines "+hunks.reduce((n,h)=>n+h.rem.length,0))'
[ "$(grep -cE "it\('T42b2-I([1-9]|10):" apps/web/app/api/v1/loyalty/loyaltyEarn.test.ts)" = 10 ] || echo "WRONG NEW INTEGRATION TEST COUNT"
[ "$(grep -cE "it\('T42b2-U[123]:" packages/contracts/loyalty.test.ts)" = 3 ] || echo "WRONG NEW CONTRACT TEST COUNT"
[ "$(grep -cE "it\('T42b2-U4:" apps/web/lib/loyaltyEarnUi.test.ts)" = 1 ] || echo "WRONG NEW UI TEST COUNT"
[ "$(grep -cE "^\s*(it|test)\(" apps/web/lib/loyaltyEarnUi.test.ts)" = 1 ] || echo "EXTRA TESTS IN THE UI FILE"
[ "$(grep -cE "^\s*(it|test)\(" apps/web/app/api/v1/loyalty/loyaltyEarn.test.ts)" = 10 ] || echo "EXTRA TESTS IN THE INTEGRATION FILE"
```
Expected: one `OK existing tests edited only as allowed; removed lines <n>` line and no other output. The allowance is exactly three, and each is named here because an existing test pins the old state, which no tree could satisfy together with this spec (the P8-42b A1 lesson):
1. **Fixture keys.** Fixture objects in `packages/contracts/loyalty.test.ts` (the `membership()` helper at its lines 41 to 43, and any overview fixture embedding a membership) and in the two loyalty API test files may gain `earn`, `earnEstimate`, `earnComparison` with `null`. The normaliser forgives exactly a removed line whose added counterpart equals it after those three keys are deleted.
2. **The exact key-set assertion `T42b-I9`** in `apps/web/app/api/v1/loyalty/loyaltyCard.test.ts` at its lines 551 and 552, `expect(Object.keys(view).sort()).toEqual([ … 'feeWatch'].sort())`, pins the membership view's exact key set and so rejects the three new keys. It may gain the three quoted key names `'earn'`, `'earnEstimate'`, `'earnComparison'` and nothing else; the normaliser deletes quoted occurrences of those three names only.
3. **The surface terminal** at `apps/web/lib/loyalty.test.ts` line 396, `expect(surface).toContain(`console.log('OK H1-H12');`)`, pins the script's closing line, which this task changes to `OK H1-H13`. It may change to `OK H1-H13` and nothing else; the guard requires exactly one such pair. (Lines 392 and 394 of that file pin `/travel`'s class as `numeric-only`, which is unchanged, so they are not edited.)

Any other removed line fails the command. Pre-existing lines elsewhere in those files are untouched by it.

**#15 (fixture pinned, covered by the tests, and no figure literals in new test code).**
```
set -e; F=apps/web/lib/fixtures/loyalty-earn-cases.json; I=apps/web/app/api/v1/loyalty/loyaltyEarn.test.ts; X=apps/web/scripts/gifts-surface-check.mjs; C=packages/contracts/loyalty.test.ts; N=apps/web/lib/loyaltyEarnUi.test.ts; B="$(git merge-base HEAD main)"
[ "$(shasum -a 256 "$F" | cut -d' ' -f1)" = "1dcd2fa812a05d954dacf9e3827dae9703e66565013a9f2fad08ae0b2c2b93b2" ]
node -e '
const f=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
const want={configCases:2,estimateCases:19,spendCases:21,matchCases:14,periodCases:11,comparisonCases:15};
const bad=[];
for(const [g,n] of Object.entries(want)){const a=f[g];if(!Array.isArray(a)||a.length!==n)bad.push(g);else{const ids=a.map(c=>c.id);if(new Set(ids).size!==n||!ids.every(i=>/^[A-Z][0-9]+$/.test(i)))bad.push(g+" ids")}}
if(!f.giftCase||!Array.isArray(f.giftCase.steps)||f.giftCase.steps.length!==5)bad.push("giftCase");
if(!f.h13||!Array.isArray(f.h13.steps)||f.h13.steps.length!==8)bad.push("h13");
if(!f.contractCases||!Array.isArray(f.contractCases.rateAccept))bad.push("contractCases");
if(typeof f.note!=="string"||!/fabricated/i.test(f.note))bad.push("note");
if(bad.length){console.log("FAIL fixture shape:",bad.join(","));process.exit(1)}
console.log("fixture shape ok")' "$F"
for t in "$I" "$X" "$C"; do grep -qF 'loyalty-earn-cases.json' "$t" || { echo "FAIL $t never loads the fixture"; exit 1; }; done
for g in configCases estimateCases spendCases matchCases periodCases comparisonCases giftCase; do grep -qF "$g" "$I" || { echo "FAIL $I never reads $g"; exit 1; }; done
grep -qF 'contractCases' "$C" || { echo "FAIL $C never reads contractCases"; exit 1; }
grep -qF 'h13' "$X" || { echo "FAIL $X never reads h13"; exit 1; }
[ "$(grep -cF 'expect(seen).toEqual(' "$I")" -ge 7 ] || { echo "FAIL fewer than seven covered groups in $I"; exit 1; }
[ "$(git diff -U0 "$B" -- "$C" | grep -cF 'expect(seen).toEqual(')" -ge 2 ] || { echo "FAIL the contract tests do not assert their case ids"; exit 1; }
LIT="['\"][-]?[0-9]+\.[0-9]{2,4}['\"]"
for f in "$I" "$N"; do if grep -nE "$LIT" "$f"; then echo "FAIL a figure literal in $f"; exit 1; fi; done
if git diff -U0 "$B" -- "$C" "$X" | grep -E '^\+[^+]' | grep -E "$LIT"; then echo "FAIL a figure literal in an added test or script line"; exit 1; fi
echo "OK fixture pinned and covered"
```
Expected: the `fixture shape ok` line from `node`, then `OK fixture pinned and covered`. `1dcd2fa812a05d954dacf9e3827dae9703e66565013a9f2fad08ae0b2c2b93b2` is a literal the orchestrator replaces with the digest at G0; a command run before that fails the first test on purpose. The `node` script reads its argument as `process.argv[1]`. The group counts equal the file in this spec (configuration 2, estimate 19, spend 21, match 14, period 11, comparison 15, gift steps 5, surface steps 8). What these checks do not prove is that a test's assertions are correct; they prove the implementer could not choose different numbers, that every case id is asserted through a `seen` list compared with the file's ids, and that no figure is restated in test or script code. The mutation log below is what proves the assertions bite. The figure-literal pattern looks only at quoted decimals with two to four fraction digits, in the whole of the two new test files and in the added lines of the contract test and the surface script (the script's pre-existing H12 literals are not added lines).

## Negative controls
| # | Rule | Input that must be rejected or excluded | Asserted by |
|---|---|---|---|
| 1 | A card payment is not spend and not a refund | Fixture cases `S1`, `S2`, `S3` | T42b2-I3, command 7 |
| 2 | A transfer is not spend | Cases `S3`, `S4`, `S5` | T42b2-I3 |
| 3 | The annual fee is not spend, and its refund is not a spend refund | Cases `S9`, `S10`, `S11`, `S14` | T42b2-I3 |
| 4 | Income, loan money and reward redemptions are not refunds | Cases `S6`, `S7`, `S13`, `S8` (uncategorised credit) | T42b2-I3 |
| 5 | A refund reduces spend, at its own rule's rate | Cases `S17`, `M12`, `E5`, `E12` | T42b2-I3, I4, I2 |
| 6 | Only the linked card's spend counts | Case `S15` | T42b2-I3 |
| 7 | Spend on or before the reading's date does not count; spend after today does not; the posted date decides | Cases `P1`, `P2`, `P3` | T42b2-I5 |
| 8 | A rule for another category is not applied, and a category rule is not a prefix, substring or pattern | Cases `M9`, `M10`, `M13` | T42b2-I4 |
| 9 | A merchant rule matches whole words only, case-folded, on `name` or `merchant_name`, as a literal | Cases `M4`, `M8`, `M7`, `M14` | T42b2-I4, T42b2-U1 |
| 10 | The first matching rule wins, in stored order | Cases `M1`, `M2` | T42b2-I4 |
| 11 | A held gift row is not spend, for any viewer, until its reveal date | Fixture `giftCase` steps `G1` to `G5` for the giver, the recipient and a bearer token; step `H2` to `H4` over HTTP | T42b2-I7, T42b2-H13, command 10 |
| 12 | Rounding is once, at the end, half away from zero | Cases `E2`, `E3`, `E5`, `E6`, `E7` | T42b2-I2 |
| 13 | A rate is bounded, decimal text of at most four decimals | `contractCases.rateRefuse` and `rateRefuseNonString`; the SQL refusals in command 4 | T42b2-U1, T42b2-I1, command 4 |
| 14 | A rate of zero is valid and is a way to exclude a category | Case `E13` | T42b2-I2 |
| 15 | The earn description is replaced whole or not at all | A body whose third rule is invalid | T42b2-I1 |
| 16 | Nothing derived is stored | An extra table or a column named for an estimate, a comparison, a total or a spend; a checksum change across `GET`s and ledger writes | command 5, T42b2-I8 |
| 17 | A missing estimate is never shown as zero, and a real zero is never shown as missing | Cases `E15`, `E19`, `P11`, `C13` against `E14`, `P7`, `P8` | T42b2-I10, T42b2-I2, T42b2-I5, T42b2-U2 |
| 18 | The comparison window never double-counts or drops a day | Cases `C10`, `C11` | T42b2-I6 |
| 19 | A typed correction is not a "previous" reading | Cases `C12`, `P6` | T42b2-I5, T42b2-I6 |
| 20 | The comparison needs one unit and two dates | Cases `C13`, `C14`, `C15` | T42b2-I6 |
| 21 | The miss threshold is strict and exact | Cases `C3`, `C4`, `C5`, `C6`, `C7`, `C8`, `C9` | T42b2-I6 |
| 22 | Spend figures, merchant names and row text never leave the database | The `forbiddenText` lists of `giftCase` and `h13`; strict keys in the contract | T42b2-I7, T42b2-I8, T42b2-H13, T42b2-U2, command 12 |
| 23 | A read-scope token cannot write; no session is 401 | A read bearer token and an unauthenticated PATCH of `earn` | T42b2-I1, T42b2-I9 |
| 24 | The create schema never takes `earn` | `earn` on a membership create | T42b2-U3, T42b2-I1 |
| 25 | The clear control is the only `earn: null` sender, and the P8-42a2 and P8-42b senders are unchanged | A second `earn: null`; a second `memberNumber: null` or `cardAccountId: null` | T42b2-U4, command 12 |
| 26 | No ledger side effects, and the fee watch is untouched | Checksums of accounts, transactions, budget categories and transfer groups; `feeWatch` before and after | T42b2-I9 |
| 27 | The gift classes are unchanged and right | A registry class line changed | command 11, `T42a-C10` (command 7), `W4` (command 3) |
| 28 | No clock, no float, no JS date arithmetic, no JS rounding, no second formatter | `new Date(`, `Date.now(`, `toISOString`, `parseFloat`, `toFixed`, `Math.round` in a loyalty-scoped source; `toLocaleString` in a component | command 12, T42b2-U4, command 9 (U9) |
| 29 | The migration is reversible without losing the link, the benefit or the instruments, and no applied migration is edited | A `down` that drops `card_account_id`, benefit columns or an instrument; an edited earlier migration | command 4, command 13 |
| 30 | The import and every P8-42a, P8-42a2 and P8-42b guarantee are undisturbed | A changed import stdout, a mask leak, a second clear sender, a broken reducer | commands 7 and 9 |
| 31 | No existing test is weakened | A removed or altered assertion other than the three allowed edits | command 14 |
| 32 | No scope creep | A file outside the allowed set, a second migration, a new route, a breakdown key | command 13, `T42a-C10`'s 11-route count, T42b2-U2 |
| 33 | No figure copied into a comment, a commit, a test or the script | A money-looking number in an added comment line, a quoted decimal in a new test or script line | commands 12 and 15 |
| 34 | The fixture is the spec's, unedited | A changed fixture file | command 15 (hash) |

## Evidence required
- The verbatim final `OK` lines of commands 2, 3, 4, 5, 6 (both zones), 7 (both lines), 8, 9 (every line of 9a to 9d), 10, 11 (both lines), 12, 14 (the `OK existing tests edited only as allowed; removed lines <n>` line) and 15 (both lines). The full output of command 10. Empty output of command 13 and the census part of command 14. The `exit=` lines of commands 1 and 16. The measured T-rows, including BASE, LINT_BASE and the 334-test baseline, and the fixture digest.
- A transcript of one real surface-script run's `H13 PASS` line and the `since` date, the estimate, the comparison and the percentage it printed, to show the dates and figures came from Postgres and the API.
- A **mutation log**. Each mutation is applied one at a time and reverted with the tree's checksum unchanged. The named scenarios and commands must fail, then pass after the revert.
  - Round each term instead of the sum: `E7`.
  - Round halves to even or toward zero: `E2`, `E3`, `E5`.
  - Return a negative zero for a negative that rounds to zero: `E6`, T42b2-U2.
  - Multiply through a JS number: `E1`, `E9`, command 12.
  - Drop the transfer-group test: `S3`, `S4`.
  - Drop the `transfer`-in-category test: `S5`.
  - Let a credit named like a payment count as a refund: `S1`, `S2`.
  - Count a loan disbursement, an income credit or a reward redemption as a refund: `S6`, `S7`, `S13`.
  - Count an uncategorised credit as a refund: `S8`.
  - Count annual-fee rows as spend: `S9`, `S14`.
  - Let the refund of the fee reduce spend: `S10`, `S11`.
  - Filter purchases by the word "payment" in their name: `S16`.
  - Ignore `hidden`: `S19`.
  - Read all credit accounts, not the linked one: `S15`.
  - Use `>=` for `since`: `P1`.
  - Use `authorized_date`: `P2`, `P3`.
  - Let a future-dated row count: `P1`.
  - Match a category as a prefix, substring or with `LIKE`: `M10`, `M13`.
  - Match a merchant as a plain substring: `M4`, `M8`.
  - Match a merchant on `name` only: `M7`.
  - Match case-sensitively: `M3`.
  - Apply the last matching rule instead of the first: `M1`.
  - Ignore the stored order (sort by rate): T42b2-I1, `M2`.
  - Price a refund at the base rate: `M12`.
  - Use the threshold `>=`: `C3`, `C5`.
  - Compute the threshold on the rounded percentage: `C4`, `C6`.
  - Pick `previous` by arrival or by id: `C12`.
  - Let the window include the previous reading's own date: `C10`.
  - Compare readings in different units: `C13`.
  - Treat the missing estimate as zero: `E15`, `E19`, `P11`.
  - Count a held row for the giver only: `giftCase` steps, `H2`.
  - Count a held row for nobody even after its reveal date: `G3`, `G4`.
  - Read `FROM transactions` raw: commands 3 (`W1`), 7 (`T42a-C10`), 12.
  - Store the estimate or the comparison in a column: command 5.
  - Make an unlink clear the rules: T42b2-I8.
  - Emit a spend amount or a merchant name: T42b2-I7, T42b2-I8, T42b2-U2.
  - Make the rules replacement non-atomic: T42b2-I1.
  - Let the create route take `earn`: T42b2-U3, T42b2-I1.
  - Print an estimate without the word "estimated": T42b2-H13, T42b2-U4.
  - Make the `down` drop `card_account_id` or the benefit columns: command 4.
  - Compute "today" with the JS clock: command 12.
  - Hard-code a convenient figure in a test instead of the fixture's: command 15.
- A statement of the limits.
  - (1) No renderer exists (T21 is NO), so wording is proved over real HTTP for the server-rendered output of `/travel` and `/accounts/[id]`, and the controls by source checks and by the PATCH route they call. A tap is not executed. Phone-width and desktop screenshots against a scratch demo database with fabricated data are required of the implementer, and none is committed if it shows a figure-like string.
  - (2) The estimate is a model: no caps, tiers, rotating categories or sign-up bonuses, and the points a program actually awards are shown only by the next reading. A rate set wrong shows up as a large miss. The spend rule's known limits (Open questions 4 and 5) are accepted and stated: a payment with none of the listed words and a shopping-like category, a refund carrying a listed word, an interest or late-fee debit counted at the matching rate, a held purchase omitted until its reveal date.
  - (3) The tiny window around Postgres midnight, when `CURRENT_DATE` could change between a test computing a date and the handler running, is negligible and no command waits across midnight.
  - (4) Editing a rule changes the comparison for a past window on the next read (Open question 15).
  - (5) The fixture's expected values were derived by hand by the spec-writer. The first run of the tests against a correct implementation is the first machine check of them; a disagreement is raised to the orchestrator as a spec defect (the fixture is not edited by the implementer).
- A statement of which docs under `node_modules/next/dist/docs/` were read, and that the `uiux-promax` skill was invoked.
- A scan of EVIDENCE.md and the commit messages for dollar figures, comma-grouped numbers and real data: none. Command 12 scans the added comment lines and command 15 the new tests and script lines; the evidence file and the commit messages are checked by the orchestrator.
- For the guardian: `plan/tasks/P8-42b2-card-earn-estimate/CONTRACT.md` records the rationale for the storage shape, that the `down` is not lossless for the earn description (back up first with `\copy` of the base rate and the rule rows), and that the link, the benefit and the instruments survive a `down`.

## Failure modes to test
- **Rounding and arithmetic.**
  - Rounding each term (per row or per rule) then summing, which differs from rounding the sum in the half cases (`E7`).
  - A float product: a binary double does not represent a four-decimal rate times a two-decimal amount exactly, so a half case (`E10`) rounds the wrong way.
  - Banker's rounding or round-half-toward-zero in place of half away from zero; a negative zero for a small negative (`E6`).
  - A rate of zero treated as "no rate" and the base applied instead (`E13`); a rate with a trailing zero compared as text.
  - The comparison percentage computed on the rounded percentage, or with the denominator of the wrong sign for a negative estimate.
  - A division by a zero estimate (the percentage must be null, not `Infinity` or `NaN`, and not zero; `C7` to `C9`).
- **Spend definition.**
  - A card payment, an income credit, a loan disbursement or a reward redemption treated as a refund, collapsing the estimate to a large negative.
  - A transfer, a half-paired transfer (category `Transfer`, no group) or a transfer-group member counted.
  - The annual fee counted as spend, or the refund of the fee subtracted from spend, or only the latest fee excluded.
  - A purchase whose name says payment dropped because the name filter was applied to debits as well as credits.
  - `hidden` rows dropped; an `exclude_from_budget` category dropped from spend.
  - A different card's spend, or an unlinked card's, counted; a JOIN against `budget_categories` that repeats a row because a name exists in two landscapes (an EXISTS was needed).
  - A zero-amount row treated as spend or refund; a null name or null category raising an error instead of matching nothing.
- **Matching.**
  - A category rule matching as a prefix, substring or `LIKE` pattern; a case-sensitive or whitespace-sensitive match.
  - A merchant phrase interpreted as a regular expression so it errors or matches everything.
  - A longer word containing the phrase matching it; `merchant_name` ignored for a Plaid row, or `name` ignored for a hand-entered row.
  - The rule order taken from insertion, from `id`, or from rate; two rules at one position.
  - A refund priced at the base rate instead of its category's.
  - A null `merchant_name` or null `mapped_category` matching a rule text of `null`.
- **Period.**
  - The posted date and `authorized_date` mixed up; spend on the reading's own date counted; spend dated today missed; a future row counted.
  - The current reading chosen by arrival rather than the shared reducer; a typed correction becoming "previous"; an older-dated later entry moving `since`.
  - The 30-day fallback off by one; the fallback used when a reading exists, or the reading used when a reading's `as_of` is in the future.
  - A JS clock or JS date arithmetic making the window depend on the server's time zone.
- **Units.**
  - `nights` giving zero instead of null; a `usd` estimate with no decimals or with three; a program default unit ignored when there is no reading; a comparison across two units.
- **Gifts.**
  - A held row excluded for non-givers only, so two viewers see two estimates.
  - A held row read raw (a protected column read outside the read path), or the estimate read as the signed-in viewer instead of `null`.
  - A reveal boundary off by one (the row is held while `reveal_date > CURRENT_DATE`).
  - A merchant rule applied to a masked row's name `Gift`.
  - A spend total, a row name or a merchant leaking into the estimate's response, a page, or a log line.
- **Storage and contract.**
  - A stored estimate, comparison, miss mark or last-compared date; an extra table.
  - A rule list half-applied after a failed PATCH; an unlink that deletes rules; a membership or account delete that fails because of the rule table.
  - A new required response field with the old fixtures left in tests (they must gain `null` keys, nothing more); the exact key-set test not updated.
  - A migration that edits an applied one, a `down` that loses the link, the benefit or an instrument, a unique index that conflicts with existing data (the rule table starts empty and the new column is null, so it must not).
  - `db/schema.sql` out of step with the migration.
- **Tests and fixture.**
  - A test that loops the fixture without asserting every id, or restates figures instead of reading them; a fixture edited to fit the implementation.
- **UI.**
  - An estimate shown without the word "estimated", or with a bare number; "worth a look" shown when the flag is false; a null shown as zero.
  - The scope sentence missing, so a reader takes the figure for a statement of points earned.
  - A second `earn: null` sender or a clear that needs two taps; a rule editor that submits a partial list.
  - A negative estimate shown without its sign.
  - The page not refreshing after a save or a clear.
  - A new `/member-number` reader or a second `memberNumber: null` or `cardAccountId: null` sender (P8-42a2 and P8-42b guarantees).

## Rollback
Revert the code commit. Then, if the new migration was applied, run `npm run migrate:down` once against that database. The `down` drops the table `loyalty_earn_rules` and the column `loyalty_memberships.earn_base_rate`, and nothing else. It does not drop or alter `card_account_id`, the three benefit columns, any membership, observation, instrument, member, program, alias or any ledger table. **The down is not lossless for the earn description:** every base rate and every rule set while the change was live is discarded. Back it up first, as the migration's own header must list:

`\copy (SELECT id, earn_base_rate FROM loyalty_memberships WHERE earn_base_rate IS NOT NULL ORDER BY id) TO 'backup-loyalty_earn_base.csv' CSV HEADER`

`\copy (SELECT membership_id, position, match_kind, match_text, rate FROM loyalty_earn_rules ORDER BY membership_id, position) TO 'backup-loyalty_earn_rules.csv' CSV HEADER`

A restore re-runs `migrate:up` and loads the two files back by membership id and position. Revert the code before running the `down`, so nothing queries a missing column or table. After a revert and `down`, P8-42b's code never selects, sets or emits `earn_base_rate` or reads the rule table, so the pages and routes behave exactly as at P8-42b's head. The fixture file is test support only and may stay or go with the revert. No gift, ledger or account row was written by this change, so nothing else needs restoring.
