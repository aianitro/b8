# P7-41b-gifts — Gifts between the two people: marked in advance, masked until the reveal date
**Roadmap item:** ROADMAP.md §5 Phase 7 step 41b — gifts
**Status:** FROZEN@G0 (2026-10-18)
**Author:** spec-writer

## Goal
A signed-in user (the giver) can mark an upcoming purchase as a gift for the other user: an amount and/or a merchant, a matching window of calendar dates, optionally one account, and a reveal date. When the daily or manual Plaid sync first stores a posted outflow that satisfies the gift, the sync links it to the gift before any other code, request, digest, suggestion or notification can observe the row. With exactly one qualifying row the gift is matched. With several, the giver is asked to choose, and until then every candidate is treated as the gift. With none, nothing changes, and once the window has ended plus the grace period in Open question 4 the giver, and only the giver, is told once. A matched gift row is stored in the owner's existing gift category. Until the reveal date every viewer except the giver sees that row as the label `Gift` plus its amount, date and account on every surface that can carry a transaction's merchant, name, bank description, Plaid category, note, logo, website, location or counterparties: all pages and all `/api/v1` routes, the chat agent and the text sent to its model, the daily digest (subject, preheader, text, HTML and images), push, search and every filter, rule previews and counts, category suggestions, recurring and forecast lists, stored derived rows, and server log lines. The giver sees real details throughout. From the reveal date, evaluated by Postgres on its own calendar, everyone sees real details with no further action. Totals, budgets, year-end and P/L are identical for giver, recipient and after the reveal, to the cent, because masking changes what is shown and never what is summed. Re-identification after a bank re-auth, the re-key script, Plaid `modified` events and category rules never unmask, re-categorise or lose a gift. This task's phase exit is: a gift marked in advance on a linked card lands masked for the other user on every surface, with no notification naming it, and unmasks on its reveal date.

## Non-goals
Each is enforced by the reviewer as a defect if present.
- **No retroactive gifts.** A row already stored when the gift is created is never a candidate. There is no "mark this existing transaction as a gift". Only rows that sync first inserts after the gift exists can match.
- **Plaid-synced rows only.** Rows created by `POST /api/v1/transactions`, CSV import, cash transfers or counts, and statement transfers (ids starting `manual_` or `csv_`) never match and are never linked. A gift whose account criterion names an account with no Plaid access token is refused at creation.
- **No amount tolerance, no recurring gifts, no split gifts, no multiple recipients, no editing criteria after creation** (cancel and re-create), no "preview as the recipient" for the giver, no early or manual reveal.
- **Exactly these new endpoints and one new page:** `POST /api/v1/gifts`, `GET /api/v1/gifts`, `GET /api/v1/gifts/[id]`, `POST /api/v1/gifts/[id]/choose`, `POST /api/v1/gifts/[id]/cancel`, and the page `/gifts` with a navigation entry shown identically to both users whether or not any gift exists. No other new route or page.
- **No notification beyond one.** No push, email or in-app item at match time or at reveal. The window-end notice goes to the giver only, by an in-app item and the existing content-free web push. No new push destination (BUILD.md §5.1), no payload: `apps/web/public/sw.js` and `apps/web/lib/domain/pushPing.ts` are unchanged, and `lib/webPush.ts`'s outgoing request keeps no body. The digest never mentions a gift's existence beyond masked rows.
- **No new timer.** The window-end sweep rides `runDailyJob` in `lib/scheduler.ts`.
- **No change to what totals mean.** No new budget, landscape or exclusion semantics, no per-user budgets, no new category, and no change to `hidden`, `exclude_from_budget` or `track_transactions` handling.
- **No access-control redesign.** Accounts have no owner in this schema and none is added. No change to auth, invitations, sessions or `PRE_AUTH_PATHS` (`proxy.ts`); gift routes are behind the boundary.
- **No category-management work.** No UI or endpoint to designate or change the gift category, and no change to category rename or delete behaviour. The existing rename does not rewrite stored `mapped_category` text; that is not fixed here.
- **No export is added.** None exists today: there is no CSV or `Content-Disposition` route. `scripts/backup.ts`, `rekey-plaid-ids.ts` and `backfill-enrichment.ts` are operator tools outside the viewer model and stay unchanged (acceptance 9). Direct `psql` access shows everything, by design.
- **No restyle.** UI work is limited to the `/gifts` page, the nav entry, rendering of the masked label and the giver's notice item.
- **41a's NITS (e.g. N2) are out of scope.**
- **No real name, merchant or money figure** in any tracked file, commit or EVIDENCE.md. Fixtures are fabricated (`Test User Two`, merchants like `Quillfeather Goods`). No screenshot with digit strings that read as money is committed.

## Open questions for the owner
These are product decisions not derivable from ROADMAP, ITEM or code. The spec is written assuming each default. A different answer changes the named scenarios.
1. **Several candidates, before the giver chooses.** The rows already sit in the shared ledger. Default: every candidate is masked for non-givers, fail closed, and sits in the gift category until chosen. Rejected candidates are then restored exactly and unmasked. Alternative: leave them visible and unmasked until chosen, which exposes real merchants on the ambiguous path. Scenarios S3, G7.
2. **Amount matching.** Default: exact to the cent. A tax-inclusive total will not match a pre-tax price, which the window-end notice then surfaces. Alternative: a giver-chosen tolerance, which invites false matches on a ledger both people use. Scenarios M3, S5.
3. **Digest audience.** The digest goes to one mailbox (`settings.to`) and has no per-viewer rendering. Default: the digest masks unrevealed gifts for everyone, even when the owner is the giver. Alternative: render real details when the owner is the giver, which leaks if the mailbox is shared. Scenario X7.
4. **Window-end notice timing.** The repo's own measurement (`lib/domain/digestWindow.ts`) is that rows arrive one to five days after their date. Default: the giver is told on the first daily run when today is later than window end plus 5 days, and matching stays possible until then. Alternative: tell on the day after the window ends, accepting false alarms. Scenarios L1, S12.
5. **Edits to a linked, unrevealed row.** Default: no one can change its category, delete it or link it as a transfer (a locked error); non-givers also cannot hide it or edit its note, watch flag or property; the giver can still do the latter four. The giver can release it by cancelling the gift, which unmasks it for the recipient. Alternative: full peers. Scenarios G8, X12.

## Contracts touched
| File | Change | Class (§9.2) |
|---|---|---|
| `migrations/<one new file>` | A gift record (giver, recipient, optional exact amount `NUMERIC(12,2)`, optional merchant criterion, optional account, window start and end `DATE`, reveal `DATE`, state, notice time) and a link from a gift to a transaction row by the row's primary key `transactions.id`, holding the row's prior category and `rule_applied` for restore. The designation of the gift category by `budget_categories.id`, seeded once from the owner's existing category (`Toys/Gifts/Flowers`, operational, seeded by name in migration 1788271200000), resolving to NULL on a database without it. Exactly one new migration file, with up and down. | additive |
| `db/schema.sql` | Mirrors the migration | additive |
| `packages/contracts/gifts.ts` (new) and `packages/contracts/index.ts` | Request and response schemas for the five endpoints. Amounts are decimal strings with at most two fraction digits. Dates are `YYYY-MM-DD` text. States: `awaiting`, `choose`, `matched`, `unmatched`, `cancelled`. Error codes: `INVALID_INPUT`, `NOT_FOUND`, `NO_RECIPIENT`, `GIFT_CATEGORY_UNSET`, `ALREADY_RESOLVED`, `GIFT_LOCKED`. | additive |
| `packages/contracts/categoryTransactions.ts`, `overview.ts` | At most an optional marker on row shapes. Existing fields keep their types. | additive |

Notes for contract-guardian. The `transactions` table's existing columns change no meaning. The masking predicate lives on the new link and reveal date, not on `mapped_category`. A row shape's `label` may now equal `Gift` and its `note`, `merchant` and enrichment fields are null for masked rows; that is a value change within the same types, so every consumer that treats `label` as the merchant (e.g. the one-tap merchant-rule offer reads `merchant`) must treat null as "no offer". No stored `net_worth_snapshots` or `year_end_snapshots` figure changes meaning. No money column other than the gift's optional amount. Nullable means unknown or any: a null amount or merchant criterion means "any", never zero or empty string.

## Conventions this task must honor
- **Sign.** `transactions.amount` follows Plaid: positive is money out, on every account type including credit cards; negative is money in or a refund. A gift's amount is a positive magnitude. Only rows with `amount > 0` can match; a refund of the same magnitude, and a zero row, never match. The matcher never negates anything, and nothing here is "normalised" for loan accounts (whose payment rows are negative and are irrelevant to gifts). A masked row shows its stored amount unchanged in sign and digits.
- **Rounding.** None. Amounts are `NUMERIC(12,2)` end to end and travel as decimal strings. Comparison is exact decimal equality in SQL or on decimal strings, never `Number`, `parseFloat`, `toFixed`, `Math.round` or multiplication by 100 (amounts such as those ending in .15, .35 or .07 break `×100` equality). A masked amount is byte-identical to the stored `amount::text` and is not re-rounded per surface or per step.
- **Landscape and exclusions.** Matching ignores landscape, `hidden` and `track_transactions`: a candidate may be on any account the sync handles. The row is stored in the designated gift category regardless of the account's landscape, and no flag on any category is changed. Totals, budgets, pacing, year-end and net worth follow the existing category and flag semantics exactly as if the same row had been filed there by hand. Masking has no effect on any of them. Figures that are sums or counts (budget grid, month outlook actuals, year-end and P/L, net worth, account balances, overview numbers, the transactions page counts and sums, a category drill-down's spent, pending and count) must be identical for the giver, the recipient, a third user, and after the reveal date. The only figures allowed to differ between viewers are those that describe row content: the rules page's per-merchant and per-Plaid-category counts and the "pending apply" count, which exclude rows masked for the viewer, as do the merchant-grouped lists in the next bullet.
- **Derived merchant groupings.** Lists that group by merchant text (upcoming recurring charges, the stored overdraft forecast's `charges`, the month outlook's label-bearing recurrence input, the chat's `get_top_merchants`) never carry an unrevealed gift's real text for any viewer. `get_top_merchants` shows the masked rows of a non-giver as one merchant `Gift` whose total equals the sum of those rows. The recurring and forecast lists exclude unrevealed gift rows for everyone.
- **Masked projection (the allowlist).** For a viewer who is not the giver, before the reveal, a linked row may carry only: `id`, `date`, `amount`, the account (id, name, landscape), the label `Gift`, the category equal to the designated category's current name, `hidden` as stored, `created_at`, `rule_applied` false, and the effective property derived from the account. Everything else is absent, null, empty or false: `name`, `merchant_name`, `merchant`, `title` other than `Gift`, bank description, `plaid_category`, `plaid_category_detailed`, confidence, `payment_channel`, payment method and processor, `merchant_entity_id`, `logo_url`, `website`, `authorized_date`, all location fields and the maps URL, counterparties, `note`, the watch flag, `plaid_transaction_id`, transfer-group peers, and any suggestion or rationale. The label is exactly `Gift` on every surface, never `Unnamed`, `Transaction`, `—` or an empty string, which are the existing null-fallbacks.
- **Viewer and fail-closed.** The viewer is the signed-in user of the request, resolved by the same function the boundary uses (cookie or bearer). The giver sees real details; every other viewer sees the masked projection, including a third user. An unresolvable or absent viewer is treated as a non-giver, never as the giver or the owner. Server components and handlers must resolve the viewer; a surface that cannot is masked.
- **Time.** Gift dates (window start, window end, reveal) are calendar `DATE`s on the server's calendar: Postgres's `CURRENT_DATE` under the server's configured time zone, the same calendar the digest and `localDate.ts` use. There is no time-of-day and no per-user zone. The reveal predicate is `reveal_date <= today`, inclusive, evaluated by Postgres in the same statement that reads the row, never from a client clock, never from `new Date().toISOString().slice(0, 10)` (UTC shift), and never as a JS `Date` parse of a `YYYY-MM-DD` string. Pure decision functions take `today` as a `YYYY-MM-DD` string argument. The window-end sweep reads `CURRENT_DATE` from Postgres. A notice is due when `today > window_end + 5 days` (Open question 4) for a gift still `awaiting` or `choose` and not yet noticed.
- **Which accounts.** Accounts have no owner here; both users see every account. "The giver's own account" and "a shared account" are therefore the same thing: the optional account criterion only narrows matching. A gift that names a card both people use can match the other person's own purchase; this is the feature's inherent false positive (see failure modes), mitigated by ANDed criteria, the choose step for several candidates, and the giver's cancel/release.
- **Matching rule.** A row is a candidate for a gift when all hold: the row was first inserted by this sync (not a conflict-refresh, not a re-identified row, not a tombstoned id); it is posted (sync already skips pending); `amount > 0`; the posted `date` or the `authorized_date` is within the window, both ends inclusive (amended 2026-10-21, see Amendments); if the gift has an account, it equals the row's account; if the gift has an amount, it equals the row's amount exactly; if the gift has a merchant, the trimmed, case-insensitive criterion is a substring of the row's `merchant_name` or `name` (criterion at least 3 characters after trimming; `%`, `_` and regex characters are literal); not already linked to any gift. A gift must have an amount or a merchant, or both, and both must hold. When two gifts compete for one row, the earlier-created gift (then lower id) wins, independent of evaluation order. One candidate: the gift is `matched`. Two or more in one sync pass: the gift is `choose`. Later arrivals while `choose` are added as candidates. A `matched` gift is final: later rows matching its criteria are ordinary. Matching happens on both the `added` and `modified` insert paths.
- **Gift category.** Identified by a stored reference to `budget_categories.id`, never by name. Renaming the category must not break matching: a gift matched after a rename is filed under the category's new name. If the designated category no longer exists when a row matches, the row is still linked and masked, left in whatever category it had, and the sync logs a count only. Creating a gift when no category is designated is refused (`GIFT_CATEGORY_UNSET`).
- **Linked row invariants.** While a gift is `matched` or `choose` and unrevealed, each linked row is stored in the gift category with `rule_applied` false (so `modified` events, `POST /rules` and `POST /rules/apply` skip it), and the gift record holds the row's prior category and `rule_applied` so rejected candidates, released rows and cancelled gifts are restored exactly. Linking is by `transactions.id`, which neither `plaid_transaction_id` re-identification nor `npm run rekey:plaid-ids` ever changes. If a linked row is removed by Plaid, the gift returns to `awaiting` with no dangling link and no error, and a replacement the same sync inserts must also be masked from the moment it exists.
- **Null semantics.** Amount, merchant or account criterion null means "any", never 0 or empty string. A gift's `noticeAt` null means "not told". `candidates` is an empty list when there are none, never null. A masked field is absent or null, never `0`, `""` or a fallback label. A null viewer is a non-giver.
- **Existence is not visible.** A non-giver cannot learn that a gift record exists: `GET /api/v1/gifts` lists only the viewer's own gifts as giver; `GET`, `choose` and `cancel` on someone else's gift answer exactly what a nonexistent id answers.

## Toolchain prerequisites
All commands run under `bash` (this machine's zsh `grep` is a different tool). Every row is verified by the orchestrator before G0 passes.

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `psql`, `createdb`, `dropdb` and a local Postgres with CREATEDB | **yes** | local install | `psql -d postgres -tAc "select 1"` → `1` | filled at G0 |
| T2 | A fresh throwaway DB migrated at the pre-change head, not `b8_finance` | **yes** | `createdb b8_p41b_throwaway` then `DATABASE_URL=postgresql://localhost/b8_p41b_throwaway npm run migrate:up` | `psql postgresql://localhost/b8_p41b_throwaway -tAc "select to_regclass('public.user_invitations')::text"` → `user_invitations` | filled at G0 |
| T3 | An exported `DATABASE_URL` wins over `apps/web/.env.local` in `npm run migrate:up` | **yes** | n/a | `DATABASE_URL=postgresql://nobody@127.0.0.1:1/b8_p41b_throwaway npm run migrate:up; echo "exit=$?"` → non-zero with a connection error to port 1 | filled at G0 |
| T4 | Integration scratch-DB guard refuses `b8_finance` before any pool exists | **yes** | existing `lib/testDbGuard.setup.ts` | `(cd apps/web && DATABASE_URL=postgresql://nobody@127.0.0.1:1/b8_finance npx vitest run --config vitest.integration.config.mts 2>&1 \| grep -c b8_finance)` → ≥ 1 | filled at G0 |
| T5 | Unit baseline recorded before the change | **yes** | existing | `npm test 2>&1 \| tail -8` → record files and tests as BASE | filled at G0 |
| T6 | `tsc` runs in `apps/web` | **yes** | existing | `(cd apps/web && npx tsc --noEmit; echo "exit=$?")` → `exit=0` | filled at G0 |
| T7 | Integration baseline: failing titles on the unmodified tree are within KNOWN (the two stale H4 tests and RC-03, per P7-41a2 GATES) | **yes** | existing | run the integration command of acceptance 6 on the unmodified tree; failing titles ⊆ KNOWN ∪ {RC-03:…} | filled at G0 |
| T8 | Node ≥ 22 with global `fetch` | **yes** (surface script) | local install | `node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22 && typeof fetch==="function" ? 0 : 1)'; echo "exit=$?"` → `exit=0` | filled at G0 |
| T9 | Port 3198 free (the surface script's dev server) | **yes** | stop anything listening | `lsof -nP -iTCP:3198 -sTCP:LISTEN \| wc -l` → `0` | filled at G0 |
| T10 | `typescript` resolvable from `apps/web` (the AST wiring tests, as `enrichedDisplayWiring.test.ts`) | **yes** | existing dependency | `(cd apps/web && node -e 'require.resolve("typescript")'; echo "exit=$?")` → `exit=0` | filled at G0 |
| T11 | The `TZ` variable changes `Date` behaviour in Node here | **yes** | OS tz database | `TZ=Pacific/Auckland node -e 'console.log(new Date(2026,0,1).getTimezoneOffset())'` → `-780`, and `TZ=America/Los_Angeles node -e 'console.log(new Date(2026,0,1).getTimezoneOffset())'` → `480` | filled at G0 |
| T12 | Google Chrome | **NO** | n/a | n/a | n/a |
| T13 | Live Plaid, live push services, SMTP, the Anthropic API, network | **NO** (stubbed everywhere) | n/a | n/a | n/a |
| T14 | The dev database `b8_finance` and `.env.local` data | **NO** | n/a | n/a | n/a |

Prerequisites the implementer must create (none exist today). Every scenario title begins with its id exactly as listed (`T41b-M1:` …), so the scenario commands find each by structure. All fixtures are fabricated, seed what they assert on, and use canary strings (alphanumeric tokens such as `ZQ41Bname`) for every text field so a leak is found by substring regardless of encoding or case.
- `apps/web/lib/giftMatch.test.ts` — pure unit tests M1–M12, L1–L3. Collected by `lib/**/*.test.ts`. Imports only pure modules.
- `apps/web/lib/giftMask.test.ts` — pure unit tests P1–P6.
- `apps/web/lib/giftSurfaceWiring.test.ts` — AST wiring tests W1–W13, patterned on `lib/enrichedDisplayWiring.test.ts` (TypeScript compiler API; every checker also run against fabricated violating and clean sources).
- Every new non-test source file's path contains the substring `gift` (any case), so the wiring tests can find them.
- `apps/web/app/api/v1/gifts/giftTestKit.ts` — helpers (not a test file): seed the designated gift category, two or three users through the existing `secondUserTestKit.ts` (`bootstrapOwner`, `enrolSecondUser`, `invite`, `register`, `resetAuth`, `cookie`, `bearer`, `installFabricatedVapid`), a Plaid mock in the manner of `app/api/v1/sync/route.test.ts`, canary row builders, and recipient/giver request helpers. It may add exports to `secondUserTestKit.ts` additively (for example a fetch recorder that also records each request's init) but must not weaken an existing assertion or export.
- `apps/web/app/api/v1/gifts/gifts.test.ts` — G1–G11. `giftSync.test.ts` — S1–S14. `giftSurfaces.test.ts` — X1–X15. All collected by `app/api/v1/**/*.test.ts`, pass alone and in any order after the existing suites, and clean up only their own rows (and `resetAuth()` for auth tables, as other suites do).
- `apps/web/scripts/gifts-surface-check.mjs` — the HTTP surface check H1–H10, patterned on `scripts/onboarding-browser-check.mjs` without a browser. It makes its own scratch database by hard-coded name `b8_gifts_check` (never reads `DATABASE_URL`, refuses any other name, drops it at the end), migrates it, seeds fabricated users, sessions, accounts, one property, the gift category and gift state with `psql` the way `screenshots.mjs` seeds sessions, starts `next dev` on port 3198 with that database passed explicitly and `SCHEDULER_IN_PROCESS=false`, and fetches with each user's session cookie. It prints one line per step, `H<n> PASS <what was observed>`, and a final `OK H1-H10`; a failure prints `H<n> FAIL <observed>` and exits non-zero. It records server stdout/stderr to a file it searches.

## Surface inventory
Found by reading the code, not taken from ITEM.md. "Text" is what can carry a merchant, name, description, category or note. Each row must behave as stated for a non-giver before the reveal, real for the giver, and real for everyone after the reveal. The wiring test W4 fails if a `page.tsx` or `route.ts` exists that is not classified in its registry; the sweeps X1 and H1 fail the same way.

| Id | Surface | Where (today) | Text it can carry | Required for a non-giver, unrevealed | Asserted by |
|---|---|---|---|---|---|
| S01 | `/transactions` page and its client props | `app/transactions/page.tsx` `getData`, `TransactionTable` | name, merchant, Plaid categories, note, logo, location, authorized date, transfer peers, `plaid_transaction_id`, suggestions | masked projection; the whole RSC payload, not only visible text | H2, H3, H9 |
| S02 | Ledger search `?search=` and merchant filter `?merchant=` | same file, `ILIKE` and exact merchant | match membership is an oracle for the merchant | no content match against a masked row; amount search still finds it | H5 |
| S03 | `/accounts/[id]` statement and chart | `app/accounts/[id]/page.tsx` | name, merchant, logo, location | masked projection | H2, H3 |
| S04 | `/categories/[name]` | `app/categories/[name]/page.tsx` | name, merchant | masked projection; running totals unchanged | H2, H3 |
| S05 | `/properties/[id]` ledger | `app/properties/[id]/page.tsx` `getLedgerTransactions` (`description`) | merchant or name, `—` fallback | `Gift`, not `—` | H2, H3 |
| S06 | `/dashboard` and the overview read | `lib/overviewRead.ts` (`readRecentArrivals`, `readToday`, `readUncategorized`, watchlist, month outlook), components `RecentArrivals`, `WatchlistCard`, `UncategorizedCard`, overdraft cards | label, merchant, note, `Transaction` fallback | masked projection, no fallback label | H2, X4 |
| S07 | `GET /api/v1/overview` | `app/api/v1/overview/route.ts` | same as S06 | same; numerics equal across viewers | X1, X4 |
| S08 | `GET /api/v1/transactions` (category drill-down) | `app/api/v1/transactions/route.ts` | label, note | masked rows; spent, pending, count unchanged | X1, X3 |
| S09 | `GET /api/v1/transactions/[id]` detail | `app/api/v1/transactions/[id]/route.ts` + `lib/transactionDetail.ts` (reads `plaid_raw`) | everything in the projection list, counterparts, address | `title` `Gift`, all else null or empty, `enriched` false | X1, X2 |
| S10 | `GET /api/v1/transactions/[id]/counterparts` | route + `lib/transferValidation.ts` | candidates' labels | masked label; no pairing offer for a locked row | X1, X12 |
| S11 | `/rules` page counts and previews | `app/rules/page.tsx`, `RulesManager` | per-merchant and per-Plaid-category counts, "pending apply" | counts exclude rows masked for the viewer | H6 |
| S12 | Rule writes `POST/DELETE /api/v1/rules`, `POST /api/v1/rules/apply` | `app/api/v1/rules/**` | `refiled` and `updated` counts; re-filing | never touch a linked row; counts exclude it | S7, X11 |
| S13 | One-tap merchant-rule offer | `lib/transactionEdits.ts` (`merchant`) | merchant | no offer (merchant is null) | X2 |
| S14 | Category suggestions | `lib/categorySuggester.ts`, `lib/domain/categorySuggest.ts`, `loadSuggestions`; stored in `agent_proposals.rationale` | model prompt examples, rationale "You filed N of M earlier X…" | unrevealed gift rows excluded from the filed history, the prompt and every rationale | X10 |
| S15 | Proposal cards and decide | `lib/proposalStore.ts` (`loadSubject`, `viewOf`), `app/api/v1/agent/proposals/[id]/decide/route.ts`, `ProposalCard` | merchant on the card, messages | no proposal on a linked row; no real text in any message | X6, X12 |
| S16 | Chat agent | `app/api/v1/chat/route.ts` (`get_transactions`, `get_top_merchants`, `get_monthly_spending`, `get_budget_summary`, `categorize_transaction`, system prompt, reply) | tool results sent to the Anthropic API and returned | masked in tool results for a non-giver (viewer = session user, bearer included); `Gift` merchant bucket | X6 |
| S17 | Daily digest text, HTML, subject, preheader, headers | `lib/digestRead.ts`, `lib/domain/digest.ts`, `lib/dailyDigest.ts` | arrivals, unfiled, watchlist labels, notes, categories | unrevealed gifts masked for everyone (Q3) | X7 |
| S18 | Digest images | `lib/digestImage.ts` (`renderChartPng`, `renderBubblesPng`), `lib/domain/digestChart.ts`, `digestBubbles.ts` | category names and aggregates only | inputs structurally cannot carry row text | X8, W7 |
| S19 | Web push | `lib/webPush.ts`, `public/sw.js`, `scheduler.ts`, `overdraftWatch.ts` | none: no body, constant text | still no body; the window-end ping reaches only the giver's endpoints | X9, W6 |
| S20 | Overdraft forecast and recurring charges (stored and shown) | `lib/overdraftWatch.ts` history query and `overdraft_forecasts.charges`, `lib/recurringDetection.ts`, `lib/monthOutlookRead.ts` recurrence input | merchant labels, persisted in JSON | unrevealed gift rows excluded for every viewer | X15 |
| S21 | Server log lines and console | `lib/logger.ts`, `lib/sync.ts`, every `createLogger` scope | any field a new log call passes | no merchant, name, note, amount or gift criterion in any line | X13, W8, H8 |
| S22 | Writes on a linked row | `PATCH/DELETE /api/v1/transactions/[id]`, `PATCH /transactions/bulk`, `POST/DELETE /transfers`, `POST /cash-transfers`, `lib/cashTransferStore.ts`, `lib/proposalStore.ts` `decideProposal`, rules | the row itself | refused per Q5; the refusal text carries no row text | X12, W12 |
| S23 | Sync response and `sync_log` | `app/api/v1/sync/route.ts`, `lib/sync.ts` | counts and account names | counts only, no row text | X1, X13 |
| S24 | Cache and process memory | route handlers, module-level state | one viewer's rows served to another | no cross-viewer bleed | X14, H7 |
| S25 | `/gifts` page and the five gift routes | new | the giver's real criteria and candidates | the recipient sees none of it and learns of no record | G2, H10 |
| S26 | Export | none exists | n/a | none added; a new export route fails W5 | W5 |
| S27 | Operator tools | `scripts/backup.ts`, `rekey-plaid-ids.ts`, `backfill-enrichment.ts` | full rows | out of scope; unchanged (acceptance 9) | acceptance 9 |
| S28 | Numeric-only surfaces | `/budget`, `/profit-loss`, `/net-worth`, `/accounts`, `/categories`, `/properties`, `/import`, budget, categories, accounts, properties, cash-counts and valuation routes, `yearEndRead`, `netWorth`, `monthOutlookRead` actuals | none | identical numbers across viewers and across the reveal | X5, H2 |

## Scenarios
| Id | Observable rule | Fixture and assertion | Catches |
|---|---|---|---|
| M1 | A row inside the criteria is a candidate. | Gift with an amount, merchant `quillfeather`, no account, a ten-day window; a posted outflow dated inside it with merchant `Quillfeather Goods` is a candidate. | A matcher that returns nothing. |
| M2 | Sign. | Same row with the amount negated (a refund) and a zero-amount row are not candidates. | `amount != 0` or `ABS(amount)` matching. |
| M3 | Exact decimal equality. | At least five amounts whose binary-float product with 100 is not an integer (cent parts such as .15, .35, .55, .57, .07) each match themselves; an amount off by one cent in either direction does not match. | Float or `×100` comparison, a tolerance (Q2). |
| M4 | Window inclusive at both ends. | Day before start no, start yes, end yes, day after end no; a month and a leap-day rollover. | Off-by-one, exclusive end. |
| M5 | Merchant rule. | Case-insensitive trimmed substring of `merchant_name` or of `name` when `merchant_name` is null; a non-matching merchant and a whitespace-only criterion do not match. | Exact-equality or case-sensitive match. |
| M6 | Criterion characters are literal. | Criteria `a_b`, `100%`, `.*`, `(` never match `axb`, `1000`, arbitrary text, and never throw. | LIKE or regex injection. |
| M7 | Criteria are ANDed. | Amount matches but merchant does not → no; merchant matches but amount does not → no; both → yes. | OR semantics. |
| M8 | Account criterion. | Another account's row excluded; a null criterion allows any account. | Ignoring the account. |
| M9 | Decision by candidate count. | Zero rows → none; one → match; two → choose, with both ids in ascending order; a row already linked is excluded from the set. | Auto-picking among several. |
| M10 | One row, one gift. | Two gifts match one row; the earlier-created gift wins whatever order they are passed in; the loser gets none. | Order-dependent or double-claim. |
| M11 | Only synced, posted rows. | A pending row and rows with ids starting `manual_` and `csv_` are never candidates. | Matching manual or pending rows. |
| M12 | Creation validation, as a table of at least 14 rows. | Rejected: neither amount nor merchant; merchant of two characters; whitespace-only merchant; amount `0`, a negative, three decimals, `1e3`, empty, non-numeric, leading space; window end before start; reveal before window start; giver equals recipient. Accepted: a one-day window; amount only; merchant only. A null amount is distinct from `0.00`. | Accepting zero, coercing null to 0 or ''. |
| L1 | Window-end notice due. | Not due on window end, nor on window end plus 5 days; due on window end plus 6 days; not due when matched, cancelled or already noticed; due for both `awaiting` and `choose`; a month rollover. Run under three time zones (acceptance 4). | A notice at the window end (Q4), non-idempotent notice, UTC/local date arithmetic. |
| L2 | Reveal predicate. | Day before reveal masked, the reveal day revealed, day after revealed; a year rollover. Under three time zones. | `<` instead of `<=`, `new Date('YYYY-MM-DD')` parsing. |
| L3 | Unresolved at reveal. | A gift still `awaiting` or `choose` on or after its reveal date yields the decision "expire: restore candidates and notify the giver once". | Leaving candidates masked or categorised forever. |
| P1 | Projection leaks nothing. | A fabricated full row whose every text field (including nested `plaid_raw` strings, counterparts, address, id) holds a distinct canary; the masked projection for a non-giver, serialised, contains none of the canaries (case-insensitive) and contains `Gift`, the amount string, the date and the account name unchanged. | Masking some fields only. |
| P2 | Exact key set. | The masked projection's key set equals the allowlist in Conventions for every row variant (all enrichment fields null, all populated). | A newly added field leaking through. |
| P3 | Viewer rules. | Giver → the input row deep-equal; a non-giver before the reveal → masked; on and after the reveal → input row; a third user → masked; `null` and `undefined` viewer → masked. | Fail-open on null viewer, owner special-casing. |
| P4 | Unlinked rows untouched. | A row with no gift is returned deep-equal for every viewer, including null. | Over-masking. |
| P5 | Label. | The masked label is exactly `Gift` for rows whose merchant and name are null, empty or present; never `Unnamed`, `Transaction`, `—` or empty. | Null-fallback labels. |
| P6 | Grouping. | Masked rows grouped by merchant for a non-giver collapse to one `Gift` bucket whose sum equals the sum of the inputs; the giver's grouping is the real one. | Per-merchant buckets, changed sums. |
| W1 | The real tree has no unclassified reader. | The detector (below) finds no viewer-facing read of a protected transaction column in any non-test, non-kit source under `apps/web/app`, `lib`, `components` outside the registered read path and the exempt list. | A surface that bypasses the masking point. |
| W2 | The detector works. | Fabricated violators are each flagged: `SELECT t.merchant_name FROM transactions t`; a template literal composed with `${LABEL}` where `LABEL` is a separate literal containing `t.merchant_name`; `SELECT *`; `SELECT t.*`; `to_jsonb(t)`; `row_to_json(t)`; `t::text`; `plaid_raw`; `COALESCE(NULLIF(t.name,''), …)`; a string split by `+`; a read through a second alias `t2.note`. Clean sources (`SELECT a.name FROM accounts a`) yield zero findings. | A checker that matches nothing. |
| W3 | Exempt list integrity. | Every exempt entry names an existing file and carries a non-empty reason; no exempt entry is a `route.ts`, a `page.tsx` or a component. Expected exempt: `lib/sync.ts` (ingest and internal comparison, output counts only). | A blanket exemption. |
| W4 | Registry completeness. | Every `route.ts` under `app/api/v1` and every `page.tsx` under `app` appears in the registry with a class (`text-bearing`, `guarded-write`, `numeric-only`, `no-transaction-data`) and, for `text-bearing`, the id of the scenario that sweeps it. | A new route or page nobody classified. |
| W5 | No export surface. | No `route.ts` sets `Content-Disposition`, `text/csv` or a file content type (AST over string literals); a fabricated violator is flagged. | An unclassified export. |
| W6 | Push stays content-free. | The `fetch` init object in `lib/webPush.ts` has no `body` property; `public/sw.js`'s push handler never references `event.data` and passes only string literals or constants to `showNotification`; fabricated violators flagged. | Text smuggled into a push. |
| W7 | Digest image inputs are row-free. | Using the TypeScript checker, the parameter types of `renderChartPng`, `renderBubblesPng` and the two SVG builders contain no property named `label`, `merchant`, `name`, `note`, `description`, `memo` or `payee`, recursively. | Row text reaching an image. |
| W8 | Log hygiene in gift modules. | In every file whose path contains `gift`, no `log.*` or `console.*` call has an argument whose AST mentions `merchant`, `name`, `amount`, `note`, `label`, `criteria` or `criterion`. | Logging the criteria or a row. |
| W9 | No JS clock or float on gift values. | In every gift-path file: no `new Date(`, `Date.now(`, `toISOString`, `parseFloat`, `toFixed`, `Math.round`, or a multiplication whose operand identifier contains `amount`; fabricated violators flagged. | UTC-shift dates, float money. |
| W10 | Pure modules stay pure. | Gift-path files that the unit tests import import none of `./db`, `pg`, `next/*`. | Untestable decisions. |
| W11 | The read path takes a viewer. | Each exported function of the registered read-path files that returns transaction rows has a non-optional `viewer` parameter whose type includes `null`; a fabricated function without it is flagged. | A reader that cannot know who is looking. |
| W12 | Writers are registered. | The set of non-test sources containing an `UPDATE transactions … mapped_category`/`hidden`/`note`/`watched_at`/`property_id`/`transfer_group_id` or `DELETE FROM transactions` literal, excluding ingest in `lib/sync.ts`, equals the registered guarded-writer set (expected: `transactions/[id]`, `transactions/bulk`, `transfers`, `cash-transfers` via `cashTransferStore`, `rules`, `rules/apply`, `proposalStore`), each naming X12. | A write path that bypasses the lock. |
| W13 | The category is not found by name. | No string literal equal (case-insensitively) to `Toys/Gifts/Flowers` in any non-test, non-migration source under `apps/web`. | Name lookup that breaks on rename. |
| G1 | Create and read. | Owner creates a gift for the second user (`Test User Two`) with an amount, merchant, account, window and reveal date: 201; the stored amount and dates are exact; the giver's `GET /api/v1/gifts` and `GET /api/v1/gifts/[id]` return it in state `awaiting`; the response parses with the contract schema. | A stub that returns 201 without storing. |
| G2 | Existence is invisible. | As the recipient and as a third user: `GET /gifts` omits it; `GET /gifts/[id]`, `POST …/choose` and `POST …/cancel` answer 404 with a body byte-identical (after dropping volatile fields) to the same call on an id that does not exist; no change in the DB. Unauthenticated → 401. | 403 instead of 404, a list that includes others' gifts. |
| G3 | Validation matrix. | Each row of M12 through the route: 400 `INVALID_INPUT`, zero gifts inserted, the error message does not echo a submitted criterion. | Accepting bad input. |
| G4 | Recipient. | With no other user: 409 `NO_RECIPIENT`; with exactly one other user the recipient defaults to them; naming self → 400; naming a revoked user → 4xx; no row inserted. | Self-gifts. |
| G5 | Authority. | A read-scope bearer token: POST refused 403, nothing created; its GET returns only the token user's own gifts. | A write via a read token. |
| G6 | Account criterion. | An account with no Plaid access token (manual, cash) → 400, none inserted; a linked account → accepted. | A gift that can never match. |
| G7 | Choose. | With two candidates: a valid choose → the chosen row `matched`; the other restored to its prior category and `rule_applied` and unmasked for the recipient; a transaction id that is not a candidate → 400; choose on a gift not in `choose` → 409; a non-giver → 404 (as G2). | Restoring wrongly, non-atomic choose. |
| G8 | Cancel and release. | The giver cancels: the row is restored and unmasked for the recipient immediately; a second cancel → 409; a non-giver → 404. | An accidental permanent mask. |
| G9 | Symmetry and a third viewer. | Second user as giver, owner as recipient: masked for the owner, real for the second user; a third enrolled user sees it masked. | An owner special case. |
| G10 | Designation. | With no designated category → 409 `GIFT_CATEGORY_UNSET`, nothing inserted. | Creating a gift that cannot be filed. |
| G11 | Reveal boundary in Postgres. | Seed a matched gift with reveal dates `CURRENT_DATE - 1`, `CURRENT_DATE`, `CURRENT_DATE + 1` computed in the same SQL statement as the insert; the recipient's detail read is real, real, masked respectively; the giver's is always real. | A JS-side date, an exclusive boundary. |
| S1 | One candidate matches at sync. | Plaid mock delivers, once as `added` and once as a first-time `modified`, a posted outflow matching a gift; afterwards the row is linked, stored in the gift category with `rule_applied` false, masked for the recipient and real for the giver, and the gift is `matched`. | A matcher that is not wired into sync, matching only one insert path. |
| S2 | Ordering: no observation point between insert and link. | Wrap `db.query` and the connected clients' `query`; after every statement the sync issues, the harness (with re-entrancy suppressed) calls the recipient's transaction list, detail, overview and chat-tool readers and asserts no canary appears. The hook must fire at least once per statement, and a control run with no gift proves the same readers would see the canary after the same statements. Run for an `added` arrival, a first-time `modified` arrival, and a Plaid reissue where the retired id's replacement is delivered in the same walk with a name that defeats same-key re-identification. | Insert then match as separate committed steps; a replacement visible during a walk. |
| S3 | Several candidates → `choose`, fail closed. | Two qualifying rows in one pass: the gift is `choose`; both rows are linked, stored in the gift category, masked; neither is auto-picked; a third arrival later while `choose` is added and masked; after G7's choose the loser is restored. | Auto-pick, exposing candidates (Q1). |
| S4 | None → nothing changes. | No qualifying row: ordinary rows keep the rule-derived category and show real text; the gift stays `awaiting`; no notice. | Masking unrelated rows. |
| S5 | Non-matching shapes stay ordinary and visible. | Each of: a refund of the same magnitude; amount off by one cent; a date one day outside the window at each end; another account; another merchant; a pending transaction; a conflict-refresh `modified` of an already-stored row; a CSV row; a manual row — stays unlinked, uncategorised by the gift, and visible with real text. | Over-matching. |
| S6 | Matched is final; one row, one gift. | After a match, a second row matching the same criteria is ordinary; two gifts competing for one row → the earlier gift wins, the later stays `awaiting`. | Re-matching, double claim. |
| S7 | Rules never re-file a gift. | A Plaid-category rule and a merchant rule both cover the linked row: sync's rule application, a later `modified` delivery, `POST /api/v1/rules` and `POST /api/v1/rules/apply` all leave its category and mask unchanged and the returned counts exclude it. Control: an ordinary row covered by the same Plaid-category rule is re-filed. A merchant-rule `POST` as the recipient for the gift's merchant answers the same `refiled` body as for a merchant that has no rows. | A rule that unmasks or re-categorises; a rules oracle. |
| S8 | Plaid updates keep the mask. | A `modified` delivery changes the row's name and merchant and enrichment: the link, mask and gift category stay; the giver sees the new real text, the recipient none. | Losing the link on refresh. |
| S9 | Re-identification survives (P6-40f). | Re-auth walk: the matched row's id is retired and a same-key new id arrives → the row keeps its `id`, link, category and mask and no second row, candidate or duplicate appears. Plaid removes the matched id with no replacement → the row is deleted, the gift returns to `awaiting` with no dangling link and no error, and the recipient sees no ghost. | Link keyed on the Plaid id; a dangling link. |
| S10 | Re-key survives (P6-40e). | `runRekey` apply (Plaid mocked as in `scripts/rekey-plaid-ids.test.ts`) rewrites the matched row's `plaid_transaction_id`: its `id`, link, category and mask are unchanged, and a non-gift row in the same run is re-keyed (control). | Link keyed on the Plaid id. |
| S11 | Re-delivery is idempotent. | The same `added` payload re-delivered after a cursor reset leaves the gift, link, categories and states unchanged. | A re-claim on conflict-refresh. |
| S12 | Window-end notice. | With the window ended and `today` exactly window end plus 5 days: the daily sweep sends nothing; plus 6 days: exactly one notice, visible to the giver through `GET /api/v1/gifts` (`noticeAt` set) and `/gifts`, none visible to anyone else, and a content-free web push request (no body) to the giver's endpoints only (the recipient's endpoint receives no request); a second run adds nothing; a matched gift gets no notice. | Notifying the recipient, a payload, a repeat. |
| S13 | Unresolved at reveal. | An `awaiting`/`choose` gift on its reveal date: after the next sweep the candidates are restored exactly and unmasked, the giver is told once. | Candidates left in the gift category. |
| S14 | Category identity. | Rename the designated category with SQL: a gift matched afterwards is filed under the new name; with the category deleted, the row is still linked and masked, its category is unchanged, and the sync's log line carries a count and no row text. | Name lookup, losing masking when unfiled. |
| X1 | Every route, every viewer. | World: owner is the recipient, `Test User Two` the giver; a matched gift row, two pending candidates of another gift, an ordinary row, and a revealed gift row, each with a canary in every text field including `plaid_raw`. Every `route.ts` under `app/api/v1` is classified (completeness fails on an unclassified route). For each `text-bearing` GET route, as the recipient by cookie and by read bearer token and as a third user: status 200 and no canary in the body; as the giver: the label canary is present (so an empty or error response cannot pass); for the revealed row the recipient sees the canary. Writes and numeric routes are called and their bodies scanned. | A route that bypasses masking, an error response passing as clean. |
| X2 | Detail route field by field. | `GET /transactions/[id]` as the recipient for the matched row: `title` `Gift`; every other string leaf null or in the allowlist; `enriched` false; no location, maps URL, counterparts or note; amount, date and account unchanged. | A single unmasked enrichment field. |
| X3 | Drill-down. | The category drill-down returns the masked row with `label` `Gift`; `spent`, `pending` and `count` equal the giver's. | Row count or sum drift. |
| X4 | Overview. | `loadOverview` for the recipient and the giver: every numeric leaf and money string equal path by path; the recipient JSON has no canary; the giver JSON has it. | Numeric drift, a surviving label. |
| X5 | Totals unchanged. | `loadYearEnd`, `loadMonthOutlook` actuals, net worth, the budget readers and the overview numerics, serialised: identical for giver and recipient, identical after flipping the reveal date, and identical after deleting the link while keeping the category (the unmasked twin). | Masking that changes a sum. |
| X6 | Chat. | Stub the Anthropic SDK to script `get_transactions` (unfiltered and by the gift row's id), `get_top_merchants`, `get_monthly_spending`, `get_budget_summary`, `categorize_transaction` on the gift row. For the recipient: every tool result sent back to the model, the system prompt and the final reply hold no canary; `get_top_merchants` shows a `Gift` bucket equal in total to the masked rows; `categorize_transaction` on the linked row returns an error and creates no proposal. For the giver: real text appears and the categorise still refuses (locked). | A model-bound leak. |
| X7 | Digest. | Mock `nodemailer`; set the alert and SMTP environment to fabricated values; run `runDailyDigest`: subject, preheader, text, HTML, headers and attachment inputs contain no canary in either direction (owner recipient, and owner giver per Q3); `alert_sends` holds no row text. After the reveal, the real text appears (control). | A digest that renders real rows. |
| X8 | Digest images. | Spy on `renderChartPng` and `renderBubblesPng`: their arguments serialise without any canary. | Row data passed to a renderer. |
| X9 | Push. | With fabricated VAPID keys and a recording fetch that captures each init: the daily ping, an overdraft ping and the window-end ping carry no body and only the known headers; the daily ping reaches only the owner's endpoints; the window-end ping reaches only the giver's. | Content in a push, a wrong recipient. |
| X10 | Suggestions. | Stub the Anthropic SDK and capture the prompt: with the gift row in the filed history and an unfiled ordinary row, the prompt has no canary and no rationale contains it; control: an ordinary filed row's merchant is in the prompt. A pending suggestion proposal on a row that later becomes a gift cannot be applied and its refusal text has no canary. | History or prompt leaks. |
| X11 | Rule counts. | The recipient's rule-related reads and writes (`POST /rules`, `POST /rules/apply`, the page's count function through the integration harness) count only unmasked rows; the giver's include the gift row. | A count oracle. |
| X12 | Locked writes. | As the recipient on the linked row: category `PATCH`, `hidden`, note, watch, property `PATCH`, `DELETE`, bulk, a transfer link with an ordinary row, a cash transfer naming it, and `decide` on a stale proposal are each refused with the same status and body shape regardless of the field, the row is unchanged, no tombstone is written, no body holds a canary. As the giver: category, delete and transfer link are refused (`GIFT_LOCKED`); note, watch, hide and property succeed (Q5). Control: the same calls on an ordinary row succeed. | An unlocked path, a refusal that echoes text. |
| X13 | Logs. | Spy `console.log/info/warn/error` and `process.stdout/stderr.write` across a matching sync, a choose, the sweep, a digest, a chat turn, a push and the suggester: no canary and no gift criterion in any line; the capture is non-empty (the sync logs). | A logged row or criterion. |
| X14 | No cross-viewer bleed. | Call each `text-bearing` GET handler alternately as giver, recipient, giver, recipient in one process: each viewer's result equals that viewer's first result. | A memoised or cached response shared across users. |
| X15 | Recurring and forecast. | Four gifts by the same giver with the same canary merchant on monthly dates (so the look-alike series would be detected as recurring): the upcoming-recurring list, the month outlook's recurrence input and the stored overdraft forecast `charges` contain no canary for any viewer. | Gift rows in label groupings. |
| H1 | Every page classified. | Pages found on the filesystem equal the script's table; each `page.tsx` is `text-bearing`, `numeric-only` or `no-transaction-data`. | An unclassified page. |
| H2 | Recipient pages are clean. | Over HTTP, as the recipient: each page returns 200 and its full HTML, including inlined flight data, has no canary (all case forms). | Props leaking into the payload. |
| H3 | The giver sees the real thing. | As the giver, `/transactions`, `/accounts/[id]`, `/categories/[name]`, `/dashboard` and a property-linked `/properties/[id]` contain the label canary. | A vacuous H2. |
| H4 | Reveal control. | After `UPDATE` of the reveal date to the past, the recipient's same pages contain the canary. | Masking that never lifts. |
| H5 | No search oracle. | As the recipient, `?search=` the canary (full and a prefix) and `?merchant=` the canary merchant render the same result block as a nonsense search (zero rows, same figures); `?search=` the amount finds the `Gift` row; the giver finds the real row. | Content match against a masked row. |
| H6 | Rules page counts. | The recipient's count for a merchant rule on the canary merchant and for the gift's Plaid category excludes the gift row; the giver's includes it. | A rules oracle. |
| H7 | No page or route cache bleed. | Alternating giver and recipient requests on one server for pages and GET routes: each viewer's response equals their first. | Cache sharing. |
| H8 | Server output. | The recorded dev-server output holds no canary. | A server-side log leak. |
| H9 | Flight payload. | A `RSC: 1` request for `/transactions` as the recipient has no canary. | Client-prop leakage. |
| H10 | `/gifts` isolation. | The giver's `/gifts` lists the gift with its criteria; the recipient's lists no gift and its HTML holds none of the criteria; the nav entry is present for both. | A visible record or a nav hint. |

## Acceptance commands
All from the repo root, under `bash`. `U=postgresql://localhost/b8_p41b_throwaway`, fresh and migrated at the pre-change head (T2). BASE is T5's recorded unit baseline. A stub fails because every command below asserts concrete values or a named scenario passing exactly once.

| # | Command | Expected | Catches |
|---|---|---|---|
| 1 | `(cd apps/web && npx tsc --noEmit; echo "exit=$?")` | `exit=0` | A type break in any consumer of the changed row shapes. |
| 2 | `npm run lint; echo "exit=$?"` | `exit=0`, warnings not above the pre-change count | Lint regressions. |
| 3 | `npm test 2>&1 \| tail -8` | 0 failed; tests passed greater than BASE by at least 34; test files at least BASE + 3; no existing unit test removed or weakened | A suite that quietly shrank. |
| 4 | Unit scenarios, below | three lines `OK 34 scenarios M L P W each present once and passed TZ=<zone>` | A missing, skipped, duplicated or untitled scenario; date logic that depends on the process zone. |
| 5 | Integration scenarios, below | `OK <n> tests, G1-G11 S1-S14 X1-X15 each present once and passed` | The whole behavioural suite (ordering, matching, survival, every surface, notifications). |
| 6 | Integration stability, below | `OK failing set stable and within KNOWN` | An order-dependent or leaking fixture; a new failing existing test (including `T41a-S17`, the twelve-member `PRE_AUTH_PATHS` check). |
| 7 | `node apps/web/scripts/gifts-surface-check.mjs; echo "exit=$?"` | ten lines `H1 PASS …` to `H10 PASS …`, a final `OK H1-H10`, `exit=0` | Page and payload leaks, search and rules oracles, cache bleed, server logs. |
| 8 | Added-lines guard, below | no output | A UTC date slice, a timezone-offset hack or a comma-grouped dollar figure in added lines (weak by design; never the feature's evidence). |
| 9 | Untouched-files guard, below | no output | Edits to auth, the boundary, the service worker, the push text module, the operator scripts or `plaidReconcile.ts`. |
| 10 | Migration round trip and history, below | `Migrations complete!` printed three times, exit 0, then `1` and no output from the history checks | A migration that cannot be rolled back, an edited committed migration, two migrations. |
| 11 | `npm run build; echo "exit=$?"` | `exit=0` | A new viewer-dependent page that would be statically prerendered. |

**#4 (unit scenarios; three zones).**
```
set -e; for TZV in UTC Pacific/Auckland America/Los_Angeles; do O="$(mktemp)"; (cd apps/web && TZ=$TZV npx vitest run lib/giftMatch.test.ts lib/giftMask.test.ts lib/giftSurfaceWiring.test.ts --reporter=json --outputFile="$O") || true; node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);const rng=(p,n)=>[...Array(n).keys()].map(i=>p+(i+1));const ids=[...rng("M",12),...rng("L",3),...rng("P",6),...rng("W",13)];let bad=[];for(const id of ids){const m=t.filter(x=>x.title.startsWith("T41b-"+id+":"));if(m.length!==1||m[0].status!=="passed")bad.push(id+"="+m.map(x=>x.status).join("/")+"("+m.length+")")}const failed=t.filter(x=>x.status!=="passed").map(x=>x.title);if(bad.length||failed.length){console.log("FAIL",process.argv[2],bad.join(","),failed.join(" ; "));process.exit(1)}console.log("OK 34 scenarios M L P W each present once and passed TZ="+process.argv[2])' "$O" "$TZV"; done
```

**#5 (integration scenarios; the whole integration config, so the KNOWN failures are named).**
```
set -e; O="$(mktemp)"; (cd apps/web && DATABASE_URL=postgresql://localhost/b8_p41b_throwaway npx vitest run --config vitest.integration.config.mts --reporter=json --outputFile="$O") || true
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);const rng=(p,n)=>[...Array(n).keys()].map(i=>p+(i+1));const ids=[...rng("G",11),...rng("S",14),...rng("X",15)];let bad=[];for(const id of ids){const m=t.filter(x=>x.title.startsWith("T41b-"+id+":"));if(m.length!==1||m[0].status!=="passed")bad.push(id+"="+m.map(x=>x.status).join("/")+"("+m.length+")")}const KNOWN=["the pre-auth ceremony endpoints remain reachable with no session cookie at all","the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio","RC-03: an item whose accounts disagree on the cursor syncs from no cursor, whichever account the table returns first"];const unexpected=t.filter(x=>x.status==="failed"&&!KNOWN.includes(x.title)).map(x=>x.title);if(unexpected.length||bad.length){console.log("FAIL",unexpected.join(" ; "),bad.join(","));process.exit(1)}console.log("OK",t.length,"tests, G1-G11 S1-S14 X1-X15 each present once and passed")' "$O"
```
KNOWN is exactly the two stale tests of QUEUE hold H4 plus RC-03 (the order-dependent flake, which may also pass). Any other failing test fails the gate, including any `T41a-S1`–`S17` and any `T41a2` scenario. T7 re-measures KNOWN on the unmodified tree before G0 passes.

**#6 (integration stability).**
```
set -e; A=""; for i in 1 2; do O="$(mktemp)"; (cd apps/web && DATABASE_URL=postgresql://localhost/b8_p41b_throwaway npx vitest run --config vitest.integration.config.mts --reporter=json --outputFile="$O") || true; R="$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(JSON.stringify(r.testResults.flatMap(f=>f.assertionResults).filter(x=>x.status==="failed").map(x=>x.title).sort()))' "$O")"; echo "$R"; if [ -n "$A" ] && [ "$A" != "$R" ]; then echo DIFFER; exit 1; fi; A="$R"; done; node -e 'const k=["the pre-auth ceremony endpoints remain reachable with no session cookie at all","the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio"];const f=JSON.parse(process.argv[1]);const bad=f.filter(t=>!k.includes(t)&&!t.startsWith("RC-03:"));if(bad.length){console.log("FAIL",bad);process.exit(1)}console.log("OK failing set stable and within KNOWN")' "$A"
```

**#8 (added-lines guard; weak by design).**
```
B="$(git merge-base HEAD main)"; { git diff -U0 "$B" -- apps/web packages ':(exclude)*.test.ts' | grep -E '^\+[^+]'; git ls-files -o --exclude-standard -- apps/web packages | grep -vE '\.test\.ts$' | xargs -r cat; } | grep -nE "toISOString\(\)\.(slice|split)|getTimezoneOffset|\\\$[0-9]+\.[0-9]{2}\b|\\\$[0-9]{1,3}(,[0-9]{3})+"
```
Expected no output (grep exit 1). The first clause adds only the added lines of modified files, so the existing `new Date().toISOString().split('T')` in the chat route does not trip it.

**#9 (untouched files).**
```
git diff --name-only "$(git merge-base HEAD main)" -- apps/web/proxy.ts apps/web/public/sw.js apps/web/lib/domain/pushPing.ts apps/web/lib/authSession.ts apps/web/lib/invitations.ts apps/web/lib/registrationGate.ts apps/web/lib/users.ts apps/web/lib/plaidReconcile.ts apps/web/scripts/rekey-plaid-ids.ts apps/web/scripts/backfill-enrichment.ts apps/web/scripts/backup.ts
```
Expected no output.

**#10 (migration round trip and history).**
```
set -e; U=postgresql://localhost/b8_p41b_throwaway; B="$(git merge-base HEAD main)"; DATABASE_URL=$U npm run migrate:up && DATABASE_URL=$U npm run migrate:down && DATABASE_URL=$U npm run migrate:up; { git diff --diff-filter=A --name-only "$B" -- migrations; git ls-files -o --exclude-standard -- migrations; } | sort -u | wc -l; git diff --diff-filter=MDR --name-only "$B" -- migrations
```
Expected: `Migrations complete!` three times, then `1` (exactly one new migration), then no output (no committed migration modified, deleted or renamed). `db/schema.sql` parity and the up-down-up cleanliness are re-checked by G1 (§7.2).

Orchestrator-applied mutations (G2/G3), one at a time, each reverted afterwards with the tree's checksum unchanged. Exactly the named scenarios must fail:
- Insert the row, commit, and match in a later statement → S2.
- Skip masking in the transactions route only → X1, X2, X3.
- Digest reads rows unmasked → X7.
- Drop `note` from the masked projection → P1, P2, X2.
- Reveal predicate `<` instead of `<=` → L2, G11.
- Compute today with `new Date().toISOString().slice(0, 10)` → W9, L2 (zone runs), command 8.
- Search `ILIKE` against masked rows → H5.
- Suggester history includes gift rows → X10.
- `rules/apply` ignores `rule_applied` for linked rows → S7, X11.
- Null viewer treated as the giver → P3.
- Link keyed on `plaid_transaction_id` → S9, S10.
- Candidate test `amount <> 0` → M2, S5.
- Push request given a body → X9, W6.
- Recipient `GET /gifts/[id]` answers 403 → G2.
- First of several candidates auto-picked → M9, S3.
- Category found by the literal name → W13, S14.
- Overview memoised across viewers → X14, H7.
- Gift criterion logged → X13, W8.
- Gift rows included in recurring detection → X15.
- Replacement row inserted unmasked during a Plaid reissue → S2.

## Negative controls
| # | Rule | Input that must be rejected or excluded | Asserted by |
|---|---|---|---|
| 1 | A masked row carries only the allowlist | A row with canaries in every text field and in `plaid_raw`, shown to a non-giver | P1, P2, X1, X2, H2, H9 |
| 2 | The label is `Gift`, not a fallback | A masked row with null merchant and name, rendering `Unnamed`, `Transaction`, `—` or empty | P5, X2, H2 |
| 3 | No row is visible between insert and link | A recipient read after each statement of a sync that inserts a qualifying row | S2 |
| 4 | Only outflows match | A refund of the same magnitude; a zero row | M2, S5 |
| 5 | Exact amount | A one-cent difference either way | M3, S5 |
| 6 | Window ends are inclusive and nothing beyond | The day before the start and the day after the end | M4, S5 |
| 7 | Criteria are ANDed and literal | A row matching only one criterion; `%`, `_`, `.*` criteria | M6, M7 |
| 8 | Only synced, posted, newly inserted rows | Pending, `manual_`, `csv_`, a conflict-refresh | M11, S5 |
| 9 | A matched gift is final; one row, one gift | A later matching row; a competing gift | M10, S6 |
| 10 | Several candidates are not auto-picked and are not exposed | Two qualifying rows in one pass | M9, S3 |
| 11 | Rules and Plaid updates never re-file or unmask | A rule covering the row; a `modified` event; `POST /rules`; `POST /rules/apply` | S7, S8, X11 |
| 12 | The link survives re-identification, removal and re-key | A retired id with a same-key replacement; a removal; `runRekey` | S9, S10 |
| 13 | Re-delivery changes nothing | The same `added` payload after a cursor reset | S11 |
| 14 | The gift category is found by identity | A renamed category; a deleted category; a literal name in source | S14, W13 |
| 15 | Reveal is Postgres's inclusive calendar date | `reveal_date` of yesterday, today, tomorrow; three process time zones | G11, L2 |
| 16 | The notice goes to the giver only, once, and after the grace | The recipient's endpoint; a second run; window end plus 5 days exactly | S12, L1, X9 |
| 17 | A gift's existence is invisible to non-givers | The recipient or a third user listing, reading, choosing or cancelling it | G2, H10 |
| 18 | The viewer fails closed | A null viewer; a third user | P3, G9, X1 |
| 19 | Totals do not move | Compare giver, recipient, a third user, the reveal and the unmasked twin | X3, X4, X5 |
| 20 | Search and rule counts are not oracles | `?search=`, `?merchant=` and rule counts against a masked row | H5, H6, X11 |
| 21 | Chat and suggester model inputs are masked | Tool results and the prompt sent to the Anthropic SDK stub | X6, X10 |
| 22 | The digest and its images carry no row text | Subject, preheader, text, HTML, headers; image inputs | X7, X8, W7 |
| 23 | Push stays content-free | A request with a body; the ping reaching the other user | X9, W6 |
| 24 | Derived merchant lists exclude gifts | A look-alike recurring series of gifts | X15 |
| 25 | Writes on a linked row are locked and silent | Category, hide, note, watch, property, delete, bulk, transfer, cash transfer, decide | X12, W12 |
| 26 | Logs hold no row text or criteria | Console and stdout capture; server output | X13, H8, W8 |
| 27 | No cross-viewer cache or memo | Alternating viewers on routes and pages | X14, H7 |
| 28 | No export, no new pre-auth path, no server surface beyond the listed ones | A CSV route; a change to `PRE_AUTH_PATHS` | W5, #6 (`T41a-S17`), #9 |
| 29 | Gift amounts are not floats | Cent values that break `×100` | M3, W9 |
| 30 | Plaid-synced accounts only | A gift naming a manual or cash account | G6, S5 |

## Evidence required
- The final `OK` lines of #4 (three zones), #5 and #6, and the full output of #7 (ten PASS lines plus `OK H1-H10`), verbatim. No canary or fixture value that looks like money beyond what the scenarios print.
- A declaration at the top of EVIDENCE.md of the read-path file(s) registered for W11, and a table of every file the W1 detector classified (reader, exempt, or writer) with its reason. The surface inventory above must reappear with each row's scenario status.
- A mutation log for every mutation listed under the acceptance commands: the scenarios that failed, then green after revert.
- A statement of what cannot be proved here: the HTTP check runs against `next dev`, not a production server (command 11 covers static prerender only); Postgres statement logging, reverse-proxy logs, the operator tools and direct `psql` are outside the viewer model; push-service and mail-provider behaviour are stubbed; the false-positive match on a shared card is reduced by the criteria and the choose step but not eliminated.
- No screenshots are required. If any is committed, it must hold no digit string that reads as money and no real name.

## Failure modes to test
- A reader selects `name` or `merchant_name` outside the masking point (the digest, chat, suggester and recurring queries each have their own SQL today). (W1, W2, X1.)
- A page passes whole rows to a client component and the UI merely hides fields, so the flight payload still carries the merchant. (H2, H9.)
- Insert then link as separate committed steps, or a re-delivery or reissue path that writes the row before the link exists. (S2, S9.)
- The masked label falls through to `Unnamed`, `Transaction` or `—` because the merchant was nulled. (P5.)
- A search, merchant filter, rule count, `refiled` count or suggestion rationale confirms a merchant to the recipient. (H5, H6, S7, X10, X11.)
- The suggester's model prompt, or the chat tool results, send a gift's merchant to a third party for a non-giver. (X6, X10.)
- `overdraft_forecasts.charges` or `agent_proposals.rationale` persists a real label written once and read later by another viewer. (X15, X10.)
- A float or `×100` comparison misses amounts like those ending .15 or .35. (M3.)
- A refund or zero row, a pending row, a CSV row or a conflict-refresh claims a gift. (M2, M11, S5.)
- `LIKE`/regex metacharacters in a merchant criterion match everything or throw. (M6.)
- Two gifts claim one row, or evaluation order picks the winner. (M10, S6.)
- The link is keyed on the Plaid id and breaks at re-identification or re-key; a removal leaves a dangling link. (S9, S10.)
- A Plaid reissue whose replacement does not re-identify is inserted before the retired row is removed, so the real gift is briefly ordinary and permanently visible. (S2.)
- The category is found by name and breaks at a rename, or its deletion silently unmasks. (S14, W13.)
- The reveal is evaluated in JS or with a UTC date slice, flipping up to a day early or late around midnight for one of the two people. (L2, G11, W9.)
- The window-end notice fires on window end and cries wolf for late-posting rows, repeats on every run, or reaches the recipient's phone. (L1, S12.)
- A pending-choice gift reaches its reveal date and leaves candidates in the gift category forever. (S13, L3.)
- A viewer-dependent response is cached or memoised and served to the other person. (X14, H7.)
- A null viewer is treated as the owner. (P3, W11.)
- The recipient can delete, hide, re-categorise or transfer-link a masked row, tombstoning a gift or changing totals. (X12, W12.)
- A cancel after a match unmasks the row for the recipient by accident. The release is a deliberate giver action and the only way to unmask early. (G8.)
- Null versus zero: a null amount stored as 0 matches zero rows; a blank merchant stored as `''` matches everything. (M12, G3.)
- Masking changes a total (a masked row dropped from a sum, a count, or the uncategorised card). (X3, X4, X5.)
- An empty collection: no candidates, no gifts, no other user. (S4, G4, G2.)
- Double counting from a JOIN against the link table (more than one link row per transaction) inflating a sum or duplicating a row. (X3, X5.)
- Order assumptions: candidates ordered by arrival instead of by `id`, a `choose` that is not atomic with its restore. (M9, G7.)
- The giver's own purchase is not the only candidate: the recipient's purchase on a shared card matches and is masked from them. Mitigations are criteria, choose and release; the product limit is stated in Evidence.
- A pending-candidate masking that hides unrelated rows for longer than the choose takes. (Q1, S3, S13.)
- A new `page.tsx` or `route.ts` nobody classified, or an export route added later. (W4, W5, H1.)
- Any real name, real merchant or money figure in a tracked file. (#8, reviewer.)

## Rollback
Revert the commit (the matching and masking code, the read-path changes, the five gift routes and the `/gifts` page, the new tests and the surface script). Then, on each database that applied the migration, take the standing backup first (BUILD.md §9.3): `\copy` the gift and link tables to CSV, including the prior-category and `rule_applied` columns, before `npm run migrate:down`. The `down` migration drops the gift and link tables and the category designation. **Rolling back is a privacy event**: with the link gone, every still-unrevealed gift row becomes ordinary and visible to the other person. Roll back only when no unrevealed gift matters, or after the giver has been told. Rows already filed in the gift category stay there; rows held as candidates stay in the gift category too, and their prior category is restored by hand from the CSV with `psql`. Revert the code before running `down`, so nothing queries a missing table. The migration is additive, so no committed migration is edited and no existing column changes meaning.
## Amendments

**2026-10-21 — the window takes the purchase date as well as the posted date.** The rule above originally
read "`date` is within the window". On its first real use a one-day window held the day of purchase; the
card row was authorized that day and posted the next, so it was not a candidate, was stored unlinked and
was shown unmasked until the owner linked it by hand. A row is now a candidate when **either** its posted
`date` or its `authorized_date` falls in the window. "Either" rather than "the authorized date when
present" is deliberate: it keeps every row the original rule matched (including one authorized before the
window and posted inside it), so the change only ever masks more, never less. Every other conjunct is
unchanged. M4 and S5's "one day outside the window" cases, and acceptance row 6, now mean outside on both
dates; the test kit sets the authorized date equal to the posted date unless a case overrides it.
Scenarios: T41b-M13 (pure) and T41b-S15 (sync), each failing under the posted-only rule.
