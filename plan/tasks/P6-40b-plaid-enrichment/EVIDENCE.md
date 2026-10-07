# P6-40b-plaid-enrichment — Evidence (implementer)

Run on 2026-10-07 from the repo root. `BASE=a236a34`. Scratch databases: `b8_p640b_scratch`
(dropped and recreated by #3) and `b8_p640b_schema` (dropped and recreated by #10). `b8_finance`
was never touched. No live Plaid call: every integration run had `PLAID_CLIENT_ID`/`PLAID_SECRET`
unset and `@/lib/plaid` replaced by a fake. Nothing committed.

## Files changed

| File | Change |
|---|---|
| `apps/web/lib/plaidEnrichment.ts` | **New.** The shared, pure mapping. `plaidEnrichment(txn)` returns the eleven values. Plaid-omitted, null, empty or whitespace-only text becomes `null`, and non-blank text is kept verbatim (not trimmed). `authorized_date` stays the `YYYY-MM-DD` string; it is never converted to a Date, and it is checked to be a real calendar date so Postgres cannot reject it. Fields are read null-safely, so a missing `location` or a null `personal_finance_category` gives null instead of throwing. `plaid_raw` is serialised once. `redactedPlaidTransaction` removes only `counterparties[*].account_numbers`, building new objects instead of editing the response. `enrichmentParams` returns the values as the ordered `$10`–`$20` list. |
| `apps/web/lib/sync.ts` | Both upserts (`added` and `modified`) now insert the eleven columns, using `$12::date` and `$20::jsonb`. Their `DO UPDATE` sets each column `= EXCLUDED.<col>`, with no COALESCE. The values come from `enrichmentParams(plaidEnrichment(txn))` in both loops. Unchanged: the `WHERE NOT EXISTS (tombstone)` guard in both statements, the owner-field handling (`added` still never assigns `mapped_category`/`rule_applied`, and `modified` keeps its CASE), the pending skip, the re-identification step, the `removed` loop and the cursor. A re-identified row gets its enrichment from the `added` upsert's conflict path, because the re-identification `UPDATE` still changes only the id (comment added). |
| `apps/web/lib/plaidEnrichment.test.ts` | **New**, pure (unit config): 9 tests of the mapping. They cover verbatim values, blank handling, missing objects, date validation, single serialisation, parameter order, exact redaction, no in-place mutation, and odd counterparty shapes. |
| `apps/web/app/api/v1/sync/enrichment.test.ts` | **New**, integration: scenarios S1–S16 plus S17 (one malformed transaction does not fail the batch). It runs the real `runSync` against the scratch DB and fakes only `@/lib/plaid`, `@/lib/plaidReconcile` and `@/lib/plaidBalances`, the same pattern as 40a's `route.test.ts`. The fixtures are `Required<Transaction>`, so the compiler fails if any SDK key is missing. |

Not touched: the migration, `db/schema.sql`, `packages/contracts/**`, any route or UI, `apps/web/app/api/v1/sync/route.test.ts`, `lib/domain/categoryRules.ts`, `lib/domain/txnMatch.ts`, and the other `INSERT INTO transactions` paths. The scratch DB is left with 0 transactions, 0 rules and 0 tombstones after the runs.

## Spec defects found (orchestrator action needed)

1. **#8 cannot be run as literally written.** Its command uses repo-root paths (`--config apps/web/vitest.integration.config.mts apps/web/app/...`), but the Expected column says to run it from `apps/web`. No working directory satisfies both.
   - From `apps/web`, vitest cannot find the config (`Cannot resolve entry module apps/web/vitest.integration.config.mts`), so `grep -c b8_finance` prints `0`.
   - From the repo root, the config loads, but its `include` globs are relative to the root, so it prints `No test files found` and `0`.
   - Both exit non-zero without the guard ever being reached. The working equivalent is the form 40a's T4 uses: from `apps/web` with relative paths. It prints `1` and exits 1, and the guard's refusal message is in the output. All three runs are recorded below. Suggested fix: change #8 to `(cd apps/web && DATABASE_URL=… npx vitest run --config vitest.integration.config.mts app/api/v1/sync/enrichment.test.ts 2>&1 | grep -c b8_finance)`.
2. **#13 and #14 do not see new (untracked) files.** `git diff --name-only "$BASE"` lists only tracked paths, and all three of this task's new files are untracked until committed. So #13 and #14 are only meaningful after a commit, or with untracked files added. A supplementary run that includes `git ls-files --others --exclude-standard` is below, and it is also empty.

## Acceptance #1 — `(cd apps/web && npx tsc --noEmit)`
```
exit=0
```
(no compiler output)

## Acceptance #2 — `npm test`
```
> b8@0.1.0 test
> npm run test -w @b8/web


> @b8/web@0.1.0 test
> vitest run


 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app/apps/web

(node:69076) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:69076) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time

 Test Files  70 passed (70)
      Tests  1033 passed (1033)
   Start at  07:51:25
   Duration  6.11s (transform 1.72s, setup 0ms, import 4.10s, tests 6.65s, environment 6ms)

exit=0
```
1033 ≥ N=1024. The difference of 9 is exactly the new `lib/plaidEnrichment.test.ts`. No existing test was removed or skipped. It was re-run after all mutation probes had been reverted and gave the same `1033 passed`.

## Acceptance #3 — migrate up / down 1 / up on a fresh `b8_p640b_scratch`
The full log is 2062 lines because node-pg-migrate echoes the SQL of every migration. These are the structural lines, with their line numbers in the captured log:
```
1:> Migrating files:
28:### MIGRATION 1786029579465_baseline-schema (UP) ###
...   (one "### MIGRATION ... (UP) ###" line per migration, in order)
1771:### MIGRATION 1791352847213_transaction-tombstones (UP) ###
1830:### MIGRATION 1791360000000_plaid-enrichment (UP) ###
1930:Migrations complete!
1931:11
1932:> Migrating files:
1934:### MIGRATION 1791360000000_plaid-enrichment (DOWN) ###
1956:Migrations complete!
1957:0
1958:> Migrating files:
1960:### MIGRATION 1791360000000_plaid-enrichment (UP) ###
2060:Migrations complete!
2061:11
2062:exit=0
```
The three counts are `11`, `0`, `11`, and the exit code is 0.

## Acceptance #4
```
authorized_date:date:YES:-
location_city:text:YES:-
location_country:text:YES:-
location_region:text:YES:-
logo_url:text:YES:-
merchant_entity_id:text:YES:-
payment_channel:text:YES:-
plaid_category:text:YES:-
plaid_category_confidence:text:YES:-
plaid_category_detailed:text:YES:-
plaid_raw:jsonb:YES:-
website:text:YES:-
exit=0
```

## Acceptance #5 (immediately after #3, before any test)
```
0
exit=0
```

## Acceptance #6 — `TZ=America/Los_Angeles`
```
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.oRRa3AB4xO/r.json
OK 17
exit=0
```

## Acceptance #7 — `TZ=Pacific/Auckland`
```
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.6IrTpYPI5k/r.json
OK 17
exit=0
```
In both zones: 17 passed, 0 failed, 0 skipped, 0 todo. The final runs are shown, after the last fixture edit (a non-numeric `category_id` string). Earlier runs gave the same result, `OK 17`.

## Acceptance #8 — real-DB refusal (see spec defect 1)
Verbatim as written, from `apps/web`:
```
0
```
vitest exit 1 with `Startup Error ... [UNRESOLVED_ENTRY] Cannot resolve entry module apps/web/vitest.integration.config.mts.` The guard was never reached.

Verbatim paths, from the repo root: vitest exit 1, `No test files found, exiting with code 1` / `include: app/api/v1/**/*.test.ts, proxy.test.ts`, grep count `0`.

Working form, from `apps/web` with relative paths (`--config vitest.integration.config.mts app/api/v1/sync/enrichment.test.ts`):
```
vitest exit=1
1
9:Error: Refusing to run the integration suite against the database named "b8_finance". "b8_finance" is what .env.local's DATABASE_URL and docker-compose.yml's db service both resolve to on a machine set up per README.md, and this suite SEEDS rows. Create a scratch database instead: ...
22: Test Files  1 failed (1)
23:      Tests  no tests
```
The new file inherits the refusal and runs no tests.

## Acceptance #9
```
OK 2
exit=0
```

## Acceptance #10
```
PARITY
exit=0
```

## Acceptance #11 / #12 / #13 / #14 — all empty output
```
## #11
exit=1 (1 = grep -v matched nothing = empty)
## #12
exit=1
## #13
exit=1
## #14
exit=1
```
`plaid_raw` appears only in `apps/web/lib/sync.ts`'s SQL, `apps/web/lib/plaidEnrichment*.ts` (which #11's allow-pattern covers as a `[Pp]laid`-named lib file), and the new test.

Supplementary #13, including untracked files (`{ git diff --name-only $BASE; git ls-files --others --exclude-standard; } | sort -u | grep -vE '<#13 pattern>'`): empty output, `exit=1`. The complete changed and new list is: `apps/web/app/api/v1/sync/enrichment.test.ts`, `apps/web/lib/plaidEnrichment.test.ts`, `apps/web/lib/plaidEnrichment.ts`, `apps/web/lib/sync.ts`, `db/schema.sql`, `migrations/1791360000000_plaid-enrichment.sql`, and `plan/**`. The `plan/` entries, including `P6-40d-*`, were changed by the orchestrator, not by me.

## Acceptance #15
```
       0
```

## Acceptance #16
```
Pages directory cannot be found at /Users/andreianpilogov/Documents/b8/app/pages or /Users/andreianpilogov/Documents/b8/app/src/pages. If using a custom path, please configure with the `no-html-link-for-pages` rule in your eslint config file.
exit=0
```
That line is the repo's standing Next eslint notice; there were no problems reported. `apps/web/lib/plaidEnrichment*.ts` also lint clean.

## Mutation probes

Each probe was applied with a script, the named command was run, and the file was restored from a backup. The restore was then checked with `shasum -c` against the pre-probe hashes (`sync.ts b743b24d…`, `plaidEnrichment.ts 56a36258…`), giving `OK` for both files after every probe. The #6 runs used the #6 command with a checker that also prints the failing titles.

**(a) COALESCE in the `modified` upsert** (authorized_date, merchant_entity_id, logo_url, website, location_city set to `COALESCE(EXCLUDED.x, transactions.x)`):
```
FAILED: T40b-S5: modified that omits previously stored fields sets them to NULL rather than keeping the stale values | AssertionError: expected 'Fixtureville' to be null
passed 16 failed 1
#6 checker exit=1
#9 exit=3
```

**(b) one column dropped from one statement** (`website = EXCLUDED.website` removed from the `modified` DO UPDATE):
```
FAILED: T40b-S4: modified with changed values overwrites every column and plaid_raw becomes the new object | AssertionError: expected { id: 73, …(23) } to match object { …(11) }
FAILED: T40b-S5: modified that omits previously stored fields sets them to NULL rather than keeping the stale values | AssertionError: expected 'cafe.fixture.invalid' to be null
passed 15 failed 2
#6 checker exit=1
#9 exit=3
```
(b2), the same removal from the `added` DO UPDATE instead. It shows that the re-identification path depends on that statement:
```
FAILED: T40b-S10: a re-identified row keeps its id and owner fields and gains the new id, enrichment and plaid_raw | AssertionError: website: expected null not to be null
passed 16 failed 1
#6 checker exit=1
#9 exit=3
```

**(c) counterparty `account_numbers` left in `plaid_raw`** (the redaction short-circuited to `return { ...source }`): S13 fails, along with every scenario that deep-compares `plaid_raw`:
```
FAILED: T40b-S13: plaid_raw is the object as received, minus only counterparties[*].account_numbers | AssertionError: expected { date: '2026-03-04', …(30) } to deeply equal { …(31) }
(plus S2, S4, S5, S6, S7, S8, S9, S10, S16 on the same plaid_raw deep-equal)
passed 7 failed 10
#6 checker exit=1
```
(c2) `plaid_raw` stored as `{}`:
```
FAILED: T40b-S13: plaid_raw is the object as received, minus only counterparties[*].account_numbers | AssertionError: expected [] to deeply equal [ Array(31) ]
FAILED: T40b-S1: ... | AssertionError: expected null to be '1' // Object.is equality
(plus S2, S4–S10, S16, S17)
passed 5 failed 12
#6 checker exit=1
```

**(d) `new Date(txn.authorized_date)` as the write parameter:**
```
-- TZ=America/Los_Angeles (#6)
FAILED: T40b-S1: an added row stores all ten columns, the primary category unchanged and the date unshifted | AssertionError: expected { id: 162, …(23) } to match object { …(10) }
FAILED: T40b-S4: modified with changed values overwrites every column and plaid_raw becomes the new object | AssertionError: expected { id: 165, …(23) } to match object { …(11) }
FAILED: T40b-S5: ... | AssertionError: expected '2026-03-01' to be '2026-03-02' // Object.is equality
FAILED: T40b-S6: ... | AssertionError: expected '2026-03-01' to be '2026-03-02' // Object.is equality
passed 13 failed 4
#6 checker exit=1
-- TZ=Pacific/Auckland (#7)
passed 17 failed 0
OK 17
```
As the spec predicts, only the negative-offset zone exposes this write-side shift. That is why #6 and #7 run in different zones.

After all probes, in the restored state: #6 `OK 17`, #7 `OK 17`, #9 `OK 2`, tsc exit 0, `npm test` `1033 passed`.

## Redaction sample (fabricated scenario-13 fixture)

This was captured from a temporary copy of `enrichment.test.ts` that logged `plaid_raw::text` inside S13. The copy was run with `-t S13` and then deleted. Shown key-sorted and pretty-printed. The fixture's `category_id` is shown as the current, non-numeric string.

`diff sent stored`. The only difference is that the counterparty's `account_numbers` was removed:
```
17,26d16
<       "account_numbers": {
<         "bacs": {
<           "account": "SENTINEL-P40B-BACS-ACCT",
<           "sort_code": "SENTINEL-P40B-SORT"
<         },
<         "international": {
<           "bic": "SENTINEL-P40B-BIC",
<           "iban": "SENTINEL-P40B-IBAN"
<         }
<       },
```
The stored `plaid_raw`:
```json
{
  "account_id": "p40b_enrich_acct",
  "account_owner": "Fabricated Owner",
  "amount": 1,
  "authorized_date": "2026-03-02",
  "authorized_datetime": "2026-03-02T00:00:00Z",
  "business_finance_category": null,
  "category": ["Food and Drink", "Coffee Shop"],
  "category_id": "FIXTURE-cat-coffee",
  "check_number": null,
  "client_customization": null,
  "counterparties": [
    {
      "confidence_level": "HIGH",
      "entity_id": "FIXTURE-entity-cafe",
      "logo_url": "https://logo.fixture.invalid/cafe.png",
      "name": "Fabricated P40b Cafe",
      "type": "merchant",
      "website": "cafe.fixture.invalid"
    }
  ],
  "date": "2026-03-04",
  "datetime": null,
  "iso_currency_code": "USD",
  "location": {
    "address": "Fixture Lane", "city": "Fixtureville", "country": "US", "lat": null,
    "lon": null, "postal_code": "FX-0", "region": "FX", "store_number": null
  },
  "logo_url": "https://logo.fixture.invalid/cafe.png",
  "merchant_entity_id": "FIXTURE-entity-cafe",
  "merchant_name": "Fabricated P40b Cafe FIXTURE-p40b-s13",
  "name": "Fabricated P40b Cafe FIXTURE-p40b-s13",
  "original_description": null,
  "payment_channel": "in store",
  "payment_meta": {
    "by_order_of": null, "payee": "Fabricated Payee", "payer": "Fabricated Payer",
    "payment_method": null, "payment_processor": null, "ppd_id": null, "reason": null,
    "reference_number": "FIXTURE-ref"
  },
  "pending": false,
  "pending_transaction_id": null,
  "personal_finance_category": {
    "confidence_level": "VERY_HIGH", "detailed": "FOOD_AND_DRINK_COFFEE", "primary": "FOOD_AND_DRINK"
  },
  "personal_finance_category_icon_url": "https://icon.fixture.invalid/food.png",
  "transaction_code": null,
  "transaction_id": "FIXTURE-p40b-s13",
  "transaction_type": "place",
  "unofficial_currency_code": null,
  "website": "cafe.fixture.invalid"
}
```
- **Removed:** `counterparties[0].account_numbers`.
- **Kept:** all 31 top-level `Transaction` keys, including null-valued ones; `account_owner`; all of `payment_meta`; `authorized_datetime`; the nested `location` nulls; and the counterparty's `name`, `entity_id`, `type`, `website`, `logo_url` and `confidence_level`.
- **Added:** nothing.

## Coverage justification

| Column | COVERAGE.md (posted rows, all items) |
|---|---|
| `plaid_category_detailed` | 100% |
| `authorized_date` | 97% |
| `payment_channel` | always present (in store / online / other) |
| `merchant_entity_id` | 40% |
| `logo_url` | 40% |
| `website` | 40% |
| `location_city` | 27% (47% of in-store rows) |
| `location_region` | not separately measured; same `location` object as city |
| `plaid_category_confidence` | not measured. Included because it is free: it travels in the `personal_finance_category` object already read for the detailed category. |
| `location_country` | not measured. Included because it is free: it is the cheap third part of the `location` object already read for city and region. |
| `plaid_raw` | every synced row; it keeps the sparse fields that get no column (coordinates, street address, store number, `authorized_datetime`) |

## Raw-object decision
The orchestrator recorded the decision at G0 (SPEC.md "G0 record"): `account_owner` and `payment_meta` stay in `plaid_raw`, and only `counterparties[*].account_numbers` is removed. The implementation does exactly that (sample above). I did not obtain the owner's own confirmation; it is the orchestrator's recorded decision.

## Notes for review
- The fixtures use small whole-number amounts and fabricated coordinates (10.5 / -20.25 in S4). No real data was used anywhere.
- `authorized_date` values that are not real calendar dates (e.g. `2026-02-30`) are stored as NULL instead of failing the item's sync; the original value stays in `plaid_raw`. The spec does not address this case. It is a choice I made to honour the spec's rule that one odd transaction must not fail the batch, and it is unit-tested.
- A non-string value where Plaid promises a string is also stored as NULL. This never stores `0` or `false`.

---

# Cycle 1 (after G3 / REVIEW-1)

Run on 2026-10-07. Inputs: REVIEW-1 (B1 BLOCK, N1 NIT), the SPEC.md "G3 amendment" (now part of the
frozen spec), and the GATES.md G2 adjudications for #8 (amended command) and #13/#14 (the new files
are intent-to-add via `git add -N`; I left that as it was). `lib/sync.ts` is byte-identical to cycle
0 (`b743b24d…`). Nothing committed.

## Changes in this cycle

| File | Change |
|---|---|
| `apps/web/lib/plaidEnrichment.ts` | **B1.** Added `storableText` and `storableJson`. `storableText` replaces each U+0000 and each unpaired UTF-16 surrogate (a high one not followed by a low one, or a low one not preceded by a high one) with U+FFFD. The regex works one code unit at a time, so a valid pair such as an emoji is untouched and nothing else is altered. `storableJson` applies that to every string in `plaid_raw` (keys and values, at any depth, inside arrays). It builds new objects and passes numbers, booleans and null through. `text()`, which every one of the ten text columns goes through, now applies `storableText` to the non-blank value it keeps. `plaid_raw` is redacted first, then cleaned. The header comment now states this one exception to "verbatim". The base `name` and `merchant_name` columns are not touched (hold H6). |
| `apps/web/lib/plaidEnrichment.test.ts` | Added 4 sanitiser tests. They check U+0000 → U+FFFD and lone high and low surrogates → U+FFFD, one for one; a valid emoji pair kept; keys and values cleaned at depth with non-strings untouched; the input not mutated; no `\u0000` or lone `\udXXX` escape left in `plaid_raw`; and the columns cleaned. The fixture's enum values now use the SDK enums, so the casts are gone. |
| `apps/web/app/api/v1/sync/enrichment.test.ts` | **S18** added, as specified: U+0000 and a lone high surrogate in `payment_meta.reference_number`, `counterparties[0].name`, `location.city`, `logo_url`, `website`, `merchant_entity_id` and the detailed category, followed by an ordinary transaction. The test asserts no errors, `synced` 2, the cursor advanced to the page's `next_cursor`, both rows stored, U+FFFD at each bad position, every other value identical to the fixture, the redaction still applied, and the response object not mutated. `name` and `merchant_name` stay clean (H6). **N1:** `fullTxn` now builds a `const complete: Required<Transaction> = {…}`, a declared type rather than an `as`, and returns `{ ...complete, ...over }` as `Transaction`. `as never` and the other enum casts are replaced by `CounterpartyType.Merchant`, `TransactionPaymentChannelEnum.*` and `TransactionTransactionTypeEnum.Place`. The header comment was updated to match. The remaining `as unknown as Transaction` casts are the deliberately malformed shapes in S17 and in the unit tests. |

**N1 proven by command.** I removed `check_number: null,` from `fullTxn`, ran tsc, then restored the file and confirmed it byte-identical with `shasum -c`:
```
93d92
<     check_number: null,
app/api/v1/sync/enrichment.test.ts(86,9): error TS2741: Property 'check_number' is missing in type '{ account_id: string; amount: number; iso_currency_code: string; unofficial_currency_code: null; category: string[]; category_id: string; date: string; location: { address: string; city: string; ... 5 more ...; store_number: null; }; ... 21 more ...; client_customization: null; }' but required in type 'Required<Transaction>'.
tsc exit=2
app/api/v1/sync/enrichment.test.ts: OK
```

## Acceptance re-run (cycle 1)

#3 recreated `b8_p640b_scratch`; #4 and #5 ran next, then #6 and the rest. #6 and #7 use the amended floor of `< 18`. #8 uses the G2-amended command.

**#1**
```
exit=0
```
**#2**
```
> b8@0.1.0 test
> npm run test -w @b8/web


> @b8/web@0.1.0 test
> vitest run


 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app/apps/web

(node:78223) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:78223) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time

 Test Files  70 passed (70)
      Tests  1037 passed (1037)
   Start at  08:04:10
   Duration  5.72s (transform 1.79s, setup 0ms, import 4.07s, tests 6.23s, environment 6ms)

exit=0
```
1037 = N (1024) + 13 tests in `plaidEnrichment.test.ts` (9 from cycle 0 plus 4 new).

**#3** (structural lines of the 2062-line log; the rest is node-pg-migrate echoing each migration's SQL)
```
1830:### MIGRATION 1791360000000_plaid-enrichment (UP) ###
1930:Migrations complete!
1931:11
1934:### MIGRATION 1791360000000_plaid-enrichment (DOWN) ###
1956:Migrations complete!
1957:0
1960:### MIGRATION 1791360000000_plaid-enrichment (UP) ###
2060:Migrations complete!
2061:11
2062:exit=0
```
**#4**
```
authorized_date:date:YES:-
location_city:text:YES:-
location_country:text:YES:-
location_region:text:YES:-
logo_url:text:YES:-
merchant_entity_id:text:YES:-
payment_channel:text:YES:-
plaid_category:text:YES:-
plaid_category_confidence:text:YES:-
plaid_category_detailed:text:YES:-
plaid_raw:jsonb:YES:-
website:text:YES:-
exit=0
```
**#5**
```
0
exit=0
```
**#6** (`TZ=America/Los_Angeles`)
```
{"time":"2026-10-07T15:04:18.543Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T15:04:18.550Z","level":"warn","scope":"sync","message":"transactions for unrecognized account_ids (not saved)","accountIds":["p40b_enrich_unknown_acct"]}
{"time":"2026-10-07T15:04:18.564Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":2}
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.rgMhOV6BkI/r.json
OK 18
exit=0
```
**#7** (`TZ=Pacific/Auckland`)
```
{"time":"2026-10-07T15:04:19.536Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T15:04:19.543Z","level":"warn","scope":"sync","message":"transactions for unrecognized account_ids (not saved)","accountIds":["p40b_enrich_unknown_acct"]}
{"time":"2026-10-07T15:04:19.558Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":2}
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.6kwyCvTe10/r.json
OK 18
exit=0
```
**#8** (amended form; the first `exit` belongs to the grep pipeline, and the second line is vitest's own exit from a separate identical run)
```
1
exit=0
vitest exit=1
```
**#9**
```
OK 2
exit=0
```
**#10**
```
PARITY
exit=0
```
**#11 / #12 / #13 / #14**: all empty output (`exit=1` is grep finding nothing). For #13, the files `git diff --name-only $BASE` lists, which now include the intent-to-add files:
```
apps/web/app/api/v1/sync/enrichment.test.ts
apps/web/lib/plaidEnrichment.test.ts
apps/web/lib/plaidEnrichment.ts
apps/web/lib/sync.ts
db/schema.sql
migrations/1791360000000_plaid-enrichment.sql
plan/QUEUE.md
plan/tasks/P6-40b-plaid-enrichment/GATES.md
plan/tasks/P6-40b-plaid-enrichment/SPEC.md
plan/tasks/P6-40c-enrichment-backfill/GATES.md
plan/tasks/P6-40c-enrichment-backfill/SPEC.md
plan/tasks/P6-40d-enriched-display/GATES.md
plan/tasks/P6-40d-enriched-display/SPEC.md
```
The `plan/` edits outside `P6-40b/EVIDENCE.md` are the orchestrator's.

**#15**
```
       0
```
**#16**
```
Pages directory cannot be found at /Users/andreianpilogov/Documents/b8/app/pages or /Users/andreianpilogov/Documents/b8/app/src/pages. If using a custom path, please configure with the `no-html-link-for-pages` rule in your eslint config file.
exit=0
```
`apps/web/lib/plaidEnrichment*.ts` also lint clean (exit 0).

## Mutation probes (cycle 1)

Backups were taken before the probes (`sync.ts b743b24d…`, `plaidEnrichment.ts 160d0942…`). Every probe was reverted and checked with `shasum -c`, which gave `OK` for both files after each one. The #6 checker uses the `< 18` floor. (a) and (b) target `sync.ts`, which this cycle did not change; they were re-run anyway against the new suite.

**(a) COALESCE in the `modified` upsert (five fields)**
```
FAILED: T40b-S5: modified that omits previously stored fields sets them to NULL rather than keeping the stale values | AssertionError: expected 'Fixtureville' to be null
passed 17 failed 1
#6 checker exit=1
#9 exit=3
```
**(b) `website` dropped from the `modified` DO UPDATE**
```
FAILED: T40b-S4: ... | AssertionError: expected { id: 79, …(23) } to match object { …(11) }
FAILED: T40b-S5: ... | AssertionError: expected 'cafe.fixture.invalid' to be null
passed 16 failed 2
#6 checker exit=1
#9 exit=3
```
**(c) counterparty `account_numbers` left in `plaid_raw`**
```
FAILED: T40b-S13: plaid_raw is the object as received, minus only counterparties[*].account_numbers | AssertionError: expected { date: '2026-03-04', …(30) } to deeply equal { …(31) }
FAILED: T40b-S18: ... | AssertionError: expected { …(7) } to not have property "account_numbers"
(plus S2, S4, S5, S6, S7, S8, S9, S10, S16 on the plaid_raw deep-equal)
passed 7 failed 11
#6 checker exit=1
```
**(d) `new Date(txn.authorized_date)` as the write parameter**
```
-- LA
FAILED: T40b-S1: ... | AssertionError: expected { id: 126, …(23) } to match object { …(10) }
FAILED: T40b-S4: ... | AssertionError: expected { id: 129, …(23) } to match object { …(11) }
FAILED: T40b-S5: ... | AssertionError: expected '2026-03-01' to be '2026-03-02' // Object.is equality
FAILED: T40b-S6: ... | AssertionError: expected '2026-03-01' to be '2026-03-02' // Object.is equality
passed 14 failed 4
#6 checker exit=1
-- Auckland
passed 18 failed 0
OK 18
```
As in cycle 0, only the negative-offset zone exposes this.

**(e1) new: sanitiser removed from `plaid_raw` only** (`JSON.stringify(redactedPlaidTransaction(txn))`)
```
FAILED: T40b-S18: U+0000 and lone surrogates in enrichment text become U+FFFD; the page and its page-mate still sync and the cursor advances | AssertionError: expected [ Array(1) ] to deeply equal []
passed 17 failed 1
#6 checker exit=1
```
The underlying error, from the sync log of an `-t S18` run under the same mutation:
```
{"time":"2026-10-07T15:04:58.239Z","level":"error","scope":"sync","message":"item failed","accountIds":["p40b_enrich_acct"],"error":"unsupported Unicode escape sequence"}
```
**(e2) new: sanitiser removed from the text columns only** (`text()` returns `value`)
```
FAILED: T40b-S18: ... | AssertionError: expected [ Array(1) ] to deeply equal []
passed 17 failed 1
#6 checker exit=1
```
```
{"time":"2026-10-07T15:04:59.121Z","level":"error","scope":"sync","message":"item failed","accountIds":["p40b_enrich_acct"],"error":"invalid byte sequence for encoding \"UTF8\": 0x00"}
```
These are the B1 failure itself: the item fails, so its cursor is not advanced. S18 catches it in both places the sanitiser is applied.

**(e3) new: over-broad sanitiser** (`/\u0000|[\uD800-\uDFFF]/g`, which also destroys valid pairs), run against the unit file:
```
     × replaces U+0000 and lone high and low surrogates with U+FFFD, one for one 3ms
     × preserves a valid surrogate pair and every other character 0ms
     × cleans keys and values at any depth, passes non-strings through, and does not mutate 2ms
     × leaves no escape in plaid_raw that jsonb refuses, and cleans the columns, without editing the response 1ms
```

After all probes: `shasum -c` gave OK for both files, and the scratch DB had 0 transactions, 0 tombstones and 0 rules.

## Notes for review (cycle 1)
- Key collision: if two keys in one object differ only by a bad code unit (e.g. `a` followed by U+0000, and `a` followed by U+FFFD), they now map to the same key and the later one wins. The spec does not cover this and it is not tested. Plaid's keys are fixed ASCII names, so I judged it unreachable in practice.
- A string consisting only of U+0000 is not blank by `trim()`, so it is stored as U+FFFD, not NULL. This follows the amendment's "nothing else altered".
- For the `text` columns, node-postgres already encodes a lone surrogate as UTF-8 U+FFFD, so in those columns only U+0000 actually failed (as e2 shows). In `plaid_raw`, both failed (e1). The sanitiser is applied in both places regardless.
