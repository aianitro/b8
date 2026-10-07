# P6-40b-plaid-enrichment — Keep Plaid's enrichment: first-class columns plus the retained transaction object
**Roadmap item:** ROADMAP.md §5 Phase 6 step 40b — store the enrichment
**Status:** FROZEN@G0 (2026-10-07; orchestrator amendments listed in GATES.md: T4 check, #10 made structural, BASE/N fixed, raw-object decision recorded)
**Author:** spec-writer

## Goal
Today `lib/sync.ts` keeps seven Plaid fields per transaction and throws the rest away. After this task, every posted Plaid transaction that sync writes (the `added` upsert, the `modified` upsert, and a row re-identified after a re-auth) also records the following.

**Eleven new nullable columns on `transactions`:**
- `plaid_category_detailed` (TEXT): `personal_finance_category.detailed`.
- `plaid_category_confidence` (TEXT): `personal_finance_category.confidence_level`.
- `authorized_date` (DATE).
- `payment_channel` (TEXT): stored verbatim, e.g. `in store`.
- `merchant_entity_id` (TEXT).
- `logo_url` (TEXT).
- `website` (TEXT).
- `location_city` (TEXT).
- `location_region` (TEXT).
- `location_country` (TEXT).
- `plaid_raw` (JSONB): the Plaid transaction object as received, with one named redaction (see Conventions).

**Evidence for the columns.** COVERAGE.md measured 100% for the detailed category, 97% for authorized date, 40% for logo/website/entity id and 27% for city (47% of in-store rows). `payment_channel` is always present. Confidence travels inside the same `personal_finance_category` object, so it costs nothing. Country is the cheap third part of `location`.

**What is deliberately not a column.** Coordinates (13%), street address (18%), store number (13%) and `authorized_datetime` (68%, often a default 00:00) are too sparse or too lossy. They are preserved in `plaid_raw`, so a later field needs no second backfill.

**What must not change.** Owner-set data and existing semantics are untouched: `mapped_category` when `rule_applied = FALSE`, `hidden`, `watched_at`, `note`, `transfer_group_id`, `property_id`, and `plaid_category` (still the primary category). Pending transactions are still skipped. Tombstoned ids (P6-40a) are still never created.

## Non-goals
Each of these is enforced by the reviewer as a defect.
- **No backfill of existing rows.** That is 40c. No script, no one-off UPDATE, and no migration that populates the new columns from anything. After the migration, every pre-existing row has NULL in all eleven columns.
- **No UI.** That is 40d. No component, page, or API payload reads or renders the new columns.
- **No new column in any API response.** `plaid_raw` in particular must never be selected by a route, a reader in `lib/`, or a contract type.
- **No change to `packages/contracts/`.** `Transaction` / `TransactionSchema` describe an API payload, not the table. The 40d task adds fields when an endpoint returns them.
- **`plaid_category` keeps meaning the primary category.** Do not repoint it at the detailed category. That is the §9.2 semantic-change trap, and every stored row and every `category_rules.plaid_category` key depends on it.
- **No categorisation-rule change.** `ruleFor` / `category_rules` / `applyRule` keep matching on primary category and merchant name only. The detailed category must not influence `mapped_category`.
- **No new treatment of pending transactions.** They are not stored.
- **No change to tombstone behaviour** (40a), to the `removed` loop, or to cursor handling.
- **No change to what the other `INSERT INTO transactions` paths write** (manual entry, CSV import, cash count and cash transfer, seed-demo). Those rows keep the eleven columns NULL.
- **No new npm script, no new dependency, no live Plaid call.**
- **No sandbox or production Plaid fixture captured from the owner's items.** Fixtures are fabricated.

## Contracts touched
| File | Change | Class (§9.2) |
|---|---|---|
| `migrations/<timestamp>_plaid-enrichment.sql` (new, after 40a's migration) | Eleven nullable columns on `transactions` with no default and no NOT NULL. Types as pinned in acceptance #4. A real `down` that drops all eleven. | additive |
| `db/schema.sql` | Same eleven columns in the `transactions` definition, with types matching the migration | additive (doc/reference; guardian-owned) |
| `packages/contracts/types.ts`, `shapes.ts` | **None.** `TransactionFieldsAreExact` ties the Zod schema to the type. Adding fields without an endpoint that returns them would break the schema's parse of real rows. | none |

Required properties, for the guardian:
- Every column is nullable, because NULL means "Plaid did not say".
- `authorized_date` is a DATE, not text or timestamptz.
- `plaid_raw` is JSONB, so it is queryable (`plaid_raw->'location'->>'lat'`).
- No CHECK constraint on `payment_channel` or the category columns. Plaid may add values, and the app must not start rejecting a sync over one.
- No index. Nothing queries these yet.
- The migration is the last one in the chain, so `node-pg-migrate down 1` reverts exactly this task.

## Conventions this task must honor
- **Sign:**
  - `amount` is untouched. It is still stored exactly as Plaid states it: positive = money out, negative = money in, identical on every account kind.
  - Nothing here normalises or negates any amount.
  - `plaid_raw` carries Plaid's own `amount` number verbatim. It is a record only; no code may read money from it. The ledger's `amount` column stays authoritative.
- **Rounding:** none introduced. `plaid_raw` numbers (`amount`, `lat`, `lon`) are stored as received and never re-rounded or re-serialised through a decimal type.
- **Landscape + exclusions:**
  - No budget, P&L, net-worth or ledger query changes. None of them may read the new columns.
  - The new columns are not an exclusion signal. In particular `payment_channel = 'other'` must not be used to hide or exclude anything.
  - A sync write must never alter `hidden`, `transfer_group_id`, `property_id` or any exclusion-relevant column.
- **Null semantics:**
  - A field Plaid omits, sends as `null`, or sends as an empty or whitespace-only string is stored as SQL NULL. It is never `''`, `0` or `false`, and never the string `"null"`.
  - This applies to every text column above and to `authorized_date`.
  - On a `modified` (or re-delivered `added`) event the stored enrichment is overwritten with Plaid's latest statement, including overwriting a previously stored value with NULL when the new event omits it. A row must equal Plaid's latest statement of that transaction. No COALESCE-with-old-value.
  - The only fields that survive an update from Plaid untouched are the owner-set ones listed in the Goal.
  - `plaid_raw` is never NULL for a row sync wrote. It is NULL only for rows no Plaid sync has written since this migration, and for non-Plaid rows.
- **"As received" for `plaid_raw`:**
  - It is the JSON of the `Transaction` object exactly as `transactionsSync` returned it. That means every key Plaid sent, including keys whose value is `null` (e.g. `check_number: null`, `location.lat: null`), and nested objects (`location`, `payment_meta`, `counterparties`, `authorized_datetime`, `datetime`, `account_owner`, and so on).
  - No keys are added: no `mapped_category`, `rule_applied`, `id` or other app-derived values.
  - No keys are dropped, no values are normalised, and nothing is renamed or flattened.
  - **Exactly one redaction:** for every element of `counterparties`, the `account_numbers` key (BACS sort code and account, international IBAN and BIC, per the SDK's `CounterpartyNumbers`) is removed. The rest of the counterparty (`name`, `entity_id`, `type`, `website`, `logo_url`, `confidence_level`) is kept.
  - Reason for the redaction: it is the only part of the object that carries a **third party's bank account number**. No planned consumer needs it, and BUILD §10.3 lists account numbers as a leakage class.
  - Kept on purpose, with the reasoning stated: `account_owner` and `payment_meta` (payer, payee, reference_number, ppd_id, by_order_of). They are the same class of personal text as `name` and `merchant_name`, which the database already holds. They are exactly the "later field" the owner wants available without a second backfill. **Owner confirmation recommended at G0.**
  - `original_description` is not requested from Plaid today (`include_original_description` is not set) and this task does not start requesting it. If Plaid ever sends it, it is stored with the rest.

## Toolchain prerequisites
| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | A local Postgres reachable at `localhost:5432` whose role can `createdb`/`dropdb` | **yes** | `docker compose up db`, or Homebrew Postgres per README | `psql postgresql://localhost:5432/postgres -Atc 'select 1'` → `1` | |
| T2 | `psql`, `createdb`, `dropdb` on PATH | **yes** | Postgres client tools | `command -v psql createdb dropdb \| wc -l` → `3` | |
| T3 | `node-pg-migrate` runnable via `npx` from the repo root, `migrations/` populated | **yes** | root devDependency | `npx node-pg-migrate --version` → exit 0 | |
| T4 | P6-40a merged: its migration exists and its tombstone mechanism is in `lib/sync.ts` | **yes** | prior task (commit a236a34) | `ls migrations \| tail -1` → `1791352847213_transaction-tombstones.sql` before this task's migration is added (G0 amendment: the original `git log --oneline \| grep -ci tombstone` measured a commit subject, not the merge) | verified at G0 |
| T5 | `$BASE` = the commit this task branched from (post-40a), exported by the orchestrator for diff-scope checks | **yes** | orchestrator | `git rev-parse --verify "$BASE"` → exit 0 | |
| T6 | `apps/web/vitest.integration.config.mts` and `lib/testDbGuard.setup.ts` exist; the integration `include` glob already covers `app/api/v1/**/*.test.ts` (no config edit is needed or permitted) | **yes** | exists | `grep -c "app/api/v1" apps/web/vitest.integration.config.mts` → ≥ 1 | |
| T7 | The scratch DB `b8_p640b_scratch` does not exist before the run and is never `b8_finance` | **yes** | acceptance #3 creates it | `psql postgresql://localhost:5432/postgres -Atc "select count(*) from pg_database where datname='b8_p640b_scratch'"` → `0` before #3 | |
| T8 | Baseline pure suite count recorded by the orchestrator **after 40a merges and before this task starts** (call it N) | **yes** | orchestrator runs `npm test` | `npm test` → record `Tests  N passed` | |
| T9 | `apps/web/app/api/v1/sync/enrichment.test.ts` does **not** exist yet | **yes** (it is created by the implementer) | n/a | `test ! -e apps/web/app/api/v1/sync/enrichment.test.ts` | |
| T10 | Live Plaid / network | **NO** | Commands run with `PLAID_CLIENT_ID`/`PLAID_SECRET` unset, so any leak to the real client throws | n/a | |

**Prerequisite the implementer must create (it does not exist today):** `apps/web/app/api/v1/sync/enrichment.test.ts`.
- It is a DB-backed test under the existing integration include.
- It calls the real `runSync` against the scratch DB.
- It replaces `@/lib/plaid` (`plaidClient()`), `@/lib/plaidReconcile` and `@/lib/plaidBalances` with fixture doubles, via `vi.mock`.
- The `transactionsSync` double returns fabricated Plaid `Transaction` objects containing **every key in the SDK's `Transaction` interface**.
- Fixtures are fabricated: ids prefixed `FIXTURE-`, invented merchants, and a made-up sentinel IBAN string.
- The test seeds what it asserts on: accounts with an `access_token`, an owner-edited row, and a tombstone through 40a's mechanism.

## Acceptance commands
`S` below is `postgresql://localhost:5432/b8_p640b_scratch`. Every command is run from the repo root.

| # | Command | Expected |
|---|---|---|
| 1 | `(cd apps/web && npx tsc --noEmit)` | exit 0 |
| 2 | `npm test` | exit 0, `0 failed`, passed count ≥ N (T8). The pure suite is not weakened: no existing test removed or skipped. |
| 3 | `S=postgresql://localhost:5432/b8_p640b_scratch; case "$S" in */b8_p640b_scratch) ;; *) echo REFUSED; exit 99;; esac; dropdb --if-exists b8_p640b_scratch && createdb b8_p640b_scratch && DATABASE_URL=$S npx node-pg-migrate up && Q="select count(*) from information_schema.columns where table_name='transactions' and column_name in ('plaid_category_detailed','plaid_category_confidence','authorized_date','payment_channel','merchant_entity_id','logo_url','website','location_city','location_region','location_country','plaid_raw')" && psql "$S" -Atc "$Q" && DATABASE_URL=$S npx node-pg-migrate down 1 && psql "$S" -Atc "$Q" && DATABASE_URL=$S npx node-pg-migrate up && psql "$S" -Atc "$Q"` | exit 0; the three `psql` outputs are exactly `11`, `0`, `11`. A hard-coded-name guard refuses before any DB call. Uses `npx node-pg-migrate`, not `npm run migrate:up`, whose `--envPath apps/web/.env.local` points at the real DB. |
| 4 | `psql postgresql://localhost:5432/b8_p640b_scratch -Atc "select column_name\|\|':'\|\|data_type\|\|':'\|\|is_nullable\|\|':'\|\|coalesce(column_default,'-') from information_schema.columns where table_name='transactions' and column_name in ('authorized_date','location_city','location_country','location_region','logo_url','merchant_entity_id','payment_channel','plaid_category','plaid_category_confidence','plaid_category_detailed','plaid_raw','website') order by column_name collate \"C\""` | Exactly 12 lines: `authorized_date:date:YES:-`, `location_city:text:YES:-`, `location_country:text:YES:-`, `location_region:text:YES:-`, `logo_url:text:YES:-`, `merchant_entity_id:text:YES:-`, `payment_channel:text:YES:-`, `plaid_category:text:YES:-` (unchanged), `plaid_category_confidence:text:YES:-`, `plaid_category_detailed:text:YES:-`, `plaid_raw:jsonb:YES:-`, `website:text:YES:-` |
| 5 | `psql postgresql://localhost:5432/b8_p640b_scratch -Atc "select count(*) from transactions"` run immediately after #3, before any test | `0` (the migration inserts or backfills nothing; the dev DB is not the subject) |
| 6 | `O=$(mktemp -d); (cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET TZ=America/Los_Angeles DATABASE_URL=postgresql://localhost:5432/b8_p640b_scratch npx vitest run --config vitest.integration.config.mts app/api/v1/sync/enrichment.test.ts --reporter=json --outputFile="$O/r.json") && node -e 'const r=require(process.argv[1]);if(r.numFailedTests||r.numPendingTests||r.numTodoTests||r.numPassedTests<15)process.exit(1);console.log("OK",r.numPassedTests)' "$O/r.json"` | exit 0 and `OK <n>` with n ≥ 15 (the scenarios below). 0 failed, 0 skipped, 0 todo. A skipped or deleted test fails it. Run in a negative-offset zone, which exposes a `new Date('YYYY-MM-DD')` write shift. |
| 7 | Same as #6 but `TZ=Pacific/Auckland` | Same result. A positive-offset zone exposes a `toISOString()` date shift. |
| 8 | `DATABASE_URL="postgresql://nobody@127.0.0.1:1/b8_finance" npx vitest run --config apps/web/vitest.integration.config.mts apps/web/app/api/v1/sync/enrichment.test.ts 2>&1 \| grep -c b8_finance` run from `apps/web` (`cd apps/web && …`) | ≥ 1, and the command's exit is non-zero. The new test file inherits the real-DB refusal and never reaches a connection. |
| 9 | `node -e 'const s=require("fs").readFileSync("apps/web/lib/sync.ts","utf8");const cols=["plaid_category_detailed","plaid_category_confidence","authorized_date","payment_channel","merchant_entity_id","logo_url","website","location_city","location_region","location_country","plaid_raw"];const blocks=s.split("INSERT INTO transactions").slice(1).map(b=>b.slice(0,b.search(/`,/)));if(blocks.length<1)process.exit(2);for(const b of blocks){for(const c of cols){if(!new RegExp(c+"\\s*=\\s*EXCLUDED\\."+c).test(b))process.exit(3)}if(/COALESCE\s*\(\s*EXCLUDED/i.test(b))process.exit(4)}console.log("OK "+blocks.length)'` | `OK <k>` with k ≥ 1, exit 0. This is the A7 static pin: every upsert statement in `lib/sync.ts` overwrites all eleven columns from the incoming row, and none keeps the old value when Plaid omits one. It supplements #6, which is behavioural. |
| 10 | `S2=postgresql://localhost:5432/b8_p640b_schema; dropdb --if-exists b8_p640b_schema && createdb b8_p640b_schema && psql -v ON_ERROR_STOP=1 -q "$S2" -f db/schema.sql >/dev/null && Q="select column_name\|\|':'\|\|data_type\|\|':'\|\|is_nullable\|\|':'\|\|coalesce(column_default,'-') from information_schema.columns where table_name='transactions' order by column_name collate \"C\""; diff <(psql postgresql://localhost:5432/b8_p640b_scratch -Atc "$Q") <(psql "$S2" -Atc "$Q") && echo PARITY` | `PARITY` — every `transactions` column (name, type, nullability, default) is identical between the migrated scratch DB and a DB built from `db/schema.sql`. G0 amendment (A10): the original regex over `db/schema.sql` was a text proxy, justified by a claim that `schema.sql` is not loadable; the orchestrator loaded it into an empty DB (exit 0), so the structural check is available. |
| 11 | `grep -rl plaid_raw apps packages --include='*.ts' --include='*.tsx' --include='*.mjs' \| sort \| grep -vE '^apps/web/(lib/.*([Ss]ync\|[Pp]laid).*\.ts\|app/api/v1/sync/enrichment\.test\.ts)$'` | Empty output. No route, component, contract, or generic reader mentions `plaid_raw`. Only a sync- or plaid-named file under `apps/web/lib` and the new test may. |
| 12 | `grep -rlE "plaid_category_detailed\|plaid_category_confidence\|merchant_entity_id\|location_city\|logo_url" apps/web/app apps/web/components packages 2>/dev/null \| grep -v 'enrichment.test.ts'` | Empty output. Nothing outside sync and the test consumes the columns (non-goals: no UI, no payload). |
| 13 | `git diff --name-only "$BASE" \| grep -vE '^(migrations/[0-9]+_.*\.sql\|db/schema\.sql\|apps/web/lib/\|apps/web/app/api/v1/sync/enrichment\.test\.ts\|plan/)'` | Empty output. Nothing outside the allowed surface changed: migration, schema reference, `lib/`, the new test, plan files. |
| 14 | `git diff --name-only "$BASE" -- packages/contracts apps/web/app apps/web/components apps/mobile \| grep -v 'apps/web/app/api/v1/sync/enrichment.test.ts'` | Empty output. No contract, route, UI or mobile change. |
| 15 | `git diff "$BASE" -- apps/web/lib/domain/categoryRules.ts apps/web/lib/domain/txnMatch.ts \| wc -l` | `0`. Rule matching and re-identification logic are unchanged. |
| 16 | `npx eslint apps/web/lib/sync.ts apps/web/app/api/v1/sync/enrichment.test.ts` | exit 0 |

**What the commands above would catch (vacuity check).**
- #6 and #7 fail a stub that does nothing, because every scenario asserts specific column values.
- #6 and #7 fail a `plaid_raw` of `{}` or of a subset, because the key set is compared exactly.
- #6 and #7 fail a COALESCE-style overwrite, because the omitted-field scenario asserts NULL.
- #6 and #7 fail a date shift, which only one of the two time zones exposes.
- #3 and #4 fail a wrong-typed column (a text date), a NOT NULL, or a default.
- #9 fails an upsert that forgot one of the columns, or a COALESCE.

### Scenarios `enrichment.test.ts` must assert (≥ 15 tests; each seeds its own fixtures)
Plaid fixtures contain every `Transaction` key, populated with fabricated values.
1. **added, fully populated:** a new posted row stores all ten scalar columns with the right value.
   - `plaid_category = 'FOOD_AND_DRINK'` (primary) while `plaid_category_detailed = 'FOOD_AND_DRINK_COFFEE'`.
   - `authorized_date` read back via `to_char(authorized_date,'YYYY-MM-DD')` equals the fixture string.
   - `payment_channel = 'in store'` verbatim.
2. **added, Plaid omits everything optional:** `logo_url`, `website`, `merchant_entity_id` keys absent; `location` all null; `authorized_date` null; `personal_finance_category` null. All ten columns are NULL (`IS NULL`, not `= ''`), and `plaid_category` is NULL as before. `plaid_raw` is still a non-null object.
3. **Empty and blank strings become NULL.**
   - Fixture: `logo_url: ''`, `website: '   '`, `location.city: ''`.
   - Expected: the three columns are NULL.
4. **modified with changed values:** every column is overwritten, and `plaid_raw` equals the new object.
5. **modified that omits a previously stored field:** a row first synced with city, logo, website, entity id and authorized date. A `modified` event then sends them as null or absent, and the stored values become NULL. This is the negative control for "keep the stale value".
6. **modified for an id not yet stored** (post-in-place): the row is created with all fields.
7. **Owner protection on `modified`:**
   - Seed an owner-edited row: `mapped_category = 'Owner Pick'`, `rule_applied = FALSE`, `hidden = TRUE`, `watched_at` set, `note` set, a real `transfer_group_id`, a real `property_id`.
   - A `modified` event arrives with different Plaid enrichment and a different primary category.
   - The six owner fields are byte-identical afterwards, the enrichment columns are updated, and `plaid_category` is updated as today.
8. **Owner protection on `added` conflict:** the same, via an `added` event re-delivering the stored id.
9. **Rule-managed row unchanged behaviour:** a row with `rule_applied = TRUE` still has `mapped_category` re-derived on `modified`, and gets the new enrichment.
10. **Re-identified row:** a stored row (old id, enrichment NULL, owner fields set) plus an `added` event with a new id and the same account/date/amount/name.
    - The table still has one row, with the same `id`.
    - `plaid_transaction_id` is the new id.
    - Enrichment and `plaid_raw` are populated.
    - Owner fields are untouched.
11. **Pending skipped:** a pending transaction with full enrichment, delivered as `added` and as `modified`, creates no row.
12. **Unknown account skipped:** a transaction for an unknown `account_id` creates no row.
13. **`plaid_raw` as received:**
    - `Object.keys` of the stored object equal the fixture's keys. This includes null-valued ones such as `check_number`, and nested `location.lat/lon/store_number`, `authorized_datetime`, `payment_meta.*` and `account_owner`.
    - The stored object deep-equals the fixture with `counterparties[*].account_numbers` removed.
    - The sentinel IBAN/BACS strings from the fixture appear nowhere in `plaid_raw::text`.
    - The counterparty's `name`, `entity_id`, `type`, `website`, `logo_url` and `confidence_level` are still present, so the redaction is not over-broad.
    - No app-derived key (`mapped_category`, `rule_applied`, `hidden`, `id`) is present.
14. **Detailed category does not drive rules:**
    - A `category_rules` row keyed on the primary `FOOD_AND_DRINK` applies.
    - One keyed on the detailed value `FOOD_AND_DRINK_COFFEE` does **not** apply (`mapped_category` stays NULL, `rule_applied = FALSE`).
    - `category_rules.plaid_category` accepts any text, so the test seeds it directly.
15. **Tombstone:** a tombstoned id (seeded through 40a's mechanism) delivered as `added` and as `modified`, with full enrichment, creates no row.
16. **Idempotence:** the same sync response run twice leaves one row and identical column values, with `plaid_raw` deep-equal.

## Negative controls
| # | Rule | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | A missing value is NULL, never `''` | `logo_url: ''`, `website: '   '`, `location.city: ''` | #6 scenario 3 |
| 2 | An omitted field never survives as a stale value | Row with stored city/logo/website/entity/authorized date, then a `modified` omitting all five | #6 scenario 5 |
| 3 | Owner-set fields are never overwritten by Plaid | `mapped_category` (rule_applied FALSE), `hidden`, `watched_at`, `note`, `transfer_group_id`, `property_id` on a row hit by `modified` and by `added`-conflict | #6 scenarios 7, 8 |
| 4 | The ledger-owned primary category keeps its meaning | `plaid_category` must remain `FOOD_AND_DRINK`, never the detailed value | #6 scenario 1 |
| 5 | Detailed category does not categorise | A `category_rules` row keyed on the detailed value | #6 scenario 14 |
| 6 | Third-party account numbers are not retained | A counterparty with `account_numbers` holding a sentinel IBAN | #6 scenario 13 |
| 7 | The redaction is only that (no over-redaction) | `payment_meta`, `account_owner`, `authorized_datetime` and other counterparty fields must remain in `plaid_raw` | #6 scenario 13 |
| 8 | `plaid_raw` carries no app-derived keys | `mapped_category`, `rule_applied`, `hidden` | #6 scenario 13 |
| 9 | Pending is never stored | Pending fixture via `added` and via `modified` | #6 scenario 11 |
| 10 | Tombstoned ids stay gone | A tombstoned id via `added` and via `modified`, carrying enrichment | #6 scenario 15 |
| 11 | No date shift | `authorized_date: '2026-03-02'` read back unchanged | #6 and #7 (two time zones) |
| 12 | `plaid_raw` / the new columns never reach an API payload or the UI | Any route, component or contract mentioning them | #11, #12, #14 |
| 13 | Nothing outside the surface changes | A diff touching a route, contract, UI or rule logic | #13, #14, #15 |
| 14 | The migration cannot touch the real DB | A `$S` not ending in `/b8_p640b_scratch` | #3 (guard exits 99 before any DB call) and #8 |

## Evidence required
- **Migration log:** verbatim output of #3 (up, down 1, up) with the three counts `11`, `0`, `11`, and the output of #4.
- **Mutation probes, each shown failing the named test:**
  - (a) make the `modified` upsert keep the old value via COALESCE, and show scenario 5 fail.
  - (b) drop one column from one of the two statements, and show #9 and the matching scenario fail.
  - (c) store `plaid_raw` as `{}` or with the counterparty `account_numbers` left in, and show scenario 13 fail.
  - (d) pass `new Date(txn.authorized_date)` as the write parameter, and show #6 fail.
- **Redaction sample:** the stored `plaid_raw` JSON of the fabricated scenario-13 fixture, showing which key was removed and which were kept.
- **Coverage justification:** a table mapping each column to its COVERAGE.md percentage, plus a one-line statement for `plaid_category_confidence` and `location_country`, which were not measured and are included because they are free.
- **Owner confirmation** (or recorded decision by the orchestrator) on keeping `account_owner` and `payment_meta` in `plaid_raw`.
- No money-looking figures from real data in any tracked file or commit message (AGENTS.md).

## Failure modes to test
- A new enrichment write that bypasses 40a's tombstone check, for example a third upsert path or a refactor that moves the tombstone test after the INSERT.
- The `added` loop updated but the `modified` loop forgotten, or vice versa. Re-identified rows depend on the `added` conflict path, so that path must not be bypassed.
- The `modified` clause overwriting owner-set `mapped_category` when `rule_applied = FALSE`, which the CASE expression prevents today. Equally, `added`'s DO UPDATE must not start assigning `mapped_category`, `rule_applied`, `hidden`, `note` or the others.
- COALESCE, `IS DISTINCT FROM` guards, or `WHERE EXCLUDED.x IS NOT NULL` that keep a stale logo, city or authorized date after Plaid dropped it.
- `''` stored in place of NULL. `0` or `false` coerced from null. The JS value `undefined` passed through as `null` fine, but `'undefined'` or `'null'` strings stored.
- `authorized_date` shifted by a day through `new Date(...)`, `toISOString()`, or `toDateOnly` misuse (the repo's known DATE trap). A text column that sorts correctly but is not a DATE.
- `plaid_raw` stored as a double-encoded JSON string (a JSON string containing JSON) because the object was `JSON.stringify`'d and then bound to a JSONB parameter via a second serialisation. `plaid_raw->>'amount'` must work.
- `plaid_raw` including the counterparty account numbers, or the redaction being applied by a case-by-case deep scrub that also removes `payment_meta`.
- Redaction mutating the Plaid response object in place, so the later `matchReissuedTransactions` or rule inputs see altered data.
- `plaid_category` accidentally set to the detailed value (a copy-paste of `personal_finance_category.detailed`), invalidating every `category_rules.plaid_category` key.
- `payment_channel` normalised (e.g. `in store` becoming `in_store`) or constrained by a CHECK that rejects a new Plaid value and fails the whole item's sync.
- A sync failing for a whole item because one transaction has an unexpected shape (e.g. `location` missing entirely, `personal_finance_category: null`, `counterparties` absent). Null-safe access is required, and one odd transaction must not blank the batch.
- An unbounded `plaid_raw` size. Not a defect at current volumes (the pending skip applies), but the stored object must be the single Plaid object, not an array or a batch.
- Re-identified rows getting the new id but no enrichment, because the re-identification `UPDATE` is separate from the upsert.
- `SELECT *` or `t.*` readers added later returning `plaid_raw` to a client. Today none exist; confirm no route or reader in `lib/` selects it (#11).
- Other `INSERT INTO transactions` paths (manual, CSV, cash) accidentally given enrichment defaults or non-NULL placeholders.
- The integration test touching the real DB (`b8_finance`) or a live Plaid call. Both are blocked by the guard and by running with the Plaid env vars unset.
- Fixture realism: fabricated data that omits a key the real object carries makes the "every key as received" check vacuous. The fixture must enumerate every key in the SDK's `Transaction` interface.
- `down` that does not drop `plaid_raw`, or that fails when 40a's objects are present.

## Rollback
- Revert the commit, then run `DATABASE_URL=<target> npx node-pg-migrate down 1`. The `down` drops all eleven columns. It is the last migration, so this is exactly this task.
- Rolling back **discards** the enrichment captured so far. It is recoverable only by re-running the 40c backfill, because it is not stored anywhere else. There is no CSV restore, because no existing data is modified. Pre-existing columns are untouched.
- Because the migration is additive and nullable, it is safe to leave applied while reverting the code: the old sync simply stops writing the columns.

---

## Things I could not verify by reading
- **40a's final shape.** `plan/tasks/P6-40a-deletion-tombstones/` contains only GATES.md, so the tombstone table name, where the check sits in `syncItem`, and whether 40a changes the `removed` loop are unknown. Scenario 15 and the "bypass" failure mode depend on it, and the implementer must read 40a's merged code or spec. T4 asks the orchestrator to confirm 40a landed first, and #9's `blocks.length ≥ 1` tolerates 40a refactoring the two upserts into a shared statement.
- **Whether `vi.mock('@/lib/plaid')` / `@/lib/plaidReconcile` / `@/lib/plaidBalances` works under the integration config.** The `@` alias is there, but no existing integration test mocks modules. I also did not confirm `runSync` needs nothing else that touches the network (it calls `itemGet` and `institutionsGetById` on the Plaid client double, and `reconcileAccountIds` per token). The implementer must double all of these.
- **Whether `npx node-pg-migrate down 1` works with this repo's SQL `-- Down Migration` format and `DATABASE_URL` alone** (without `--envPath`). The existing migrations use that format and P0.5-28's EVIDENCE shows `DATABASE_URL=… npx node-pg-migrate up`, but I did not run `down`.
- **`psql`/`createdb` availability and the role's rights** (T1, T2), which the orchestrator verifies.
- **Collation-specific ordering:** #4 forces `collate "C"`, but I did not run it.
- **`db/schema.sql` parity** is checked only by regex (#10). I could not find a more structural check, since the file is a reference document rather than loadable standalone.
- **Row-count assertion #5** assumes a freshly migrated scratch DB has no seeded transactions. I did not confirm that no migration inserts `transactions` rows.
- **The SDK object in practice.** `Transaction` in `node_modules/plaid/dist/api.d.ts` is typed, but real responses may carry keys the SDK type lacks. "As received" means the parsed JSON body's object, so extra keys are kept. A fixture can't prove that, only the stated rule.
- **`apps/web/tsconfig.json` coverage.** I did not confirm `tsc --noEmit` includes test files, so #1 may not type-check the new test.
- **Baseline N** (T8) is not known until after 40a merges. The spec deliberately states `≥ N` rather than a frozen number (§15 A6).

---

## G0 record (orchestrator, 2026-10-07)
- **BASE** = `a236a34` (P6-40a merged). **N** (T8) = `1024` unit tests passed.
- **Raw-object redaction decision (the spec asked for owner confirmation):** recorded by the orchestrator under the owner's "deliver in auto mode" instruction. Keep `account_owner` and `payment_meta` in `plaid_raw`; remove only `counterparties[*].account_numbers`. Reason: the kept fields are personal text of the same class `name` and `merchant_name` already hold, they stay in the owner's local database, no route selects `plaid_raw` (#11), and the third-party account numbers are the one field that identifies someone else's bank account. Surfaced to the owner in the session summary.

## G3 amendment (orchestrator, 2026-10-07, after REVIEW-1 B1 was confirmed by command)
**Rule, overriding "as received" in one respect:** every string value the enrichment writes — each
of the ten text columns and every string anywhere inside `plaid_raw` (keys and values, recursively,
including inside arrays) — has each U+0000 and each unpaired UTF-16 surrogate replaced by U+FFFD
before it is bound. Nothing else is altered: no other character, no key added or removed beyond the
existing `account_numbers` redaction, no number or boolean touched. Reason: Postgres refuses both in
`jsonb` (`unsupported Unicode escape sequence` / `invalid input syntax for type json`) and refuses
U+0000 in `text`; one such transaction would otherwise fail the statement, abort `syncItem` before its
cursor update, and stall that institution's sync permanently — the spec's own "one odd transaction
must not blank the batch" failure mode.
**New required evidence (added to acceptance #6/#7's scenario floor — now ≥ 18 passing):**
- **S18:** a page carrying a posted transaction whose `payment_meta.reference_number`,
  `counterparties[0].name`, `location.city` and `merchant_name`-adjacent new text fields contain
  U+0000 and a lone high surrogate, followed by an ordinary transaction. Sync completes with no
  error, the cursor advances to the page's `next_cursor`, both rows are stored, and the affected
  values contain U+FFFD where the bad code units were and are otherwise identical.
- A unit test of the sanitiser: U+0000 → U+FFFD; lone high and lone low surrogates → U+FFFD; a
  valid surrogate pair (an emoji) is preserved unchanged; non-string values pass through untouched;
  the input object is not mutated.
**N1:** replace `as Required<Transaction>` with a check the compiler enforces (`satisfies`, or an
explicitly typed const), and keep the header comment true.
**Out of scope, recorded as hold H6:** the pre-existing base columns `name` / `merchant_name`
(written by sync since before 40b) have the same U+0000 exposure in `text`; changing what sync writes
to them is not this task's to decide.
