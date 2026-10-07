# P6-40b-plaid-enrichment — Contract note (contract-guardian)

## Diff summary

| File | Change |
|---|---|
| `migrations/1791360000000_plaid-enrichment.sql` | **New file.** Up: one `ALTER TABLE transactions` adding eleven columns with `ADD COLUMN IF NOT EXISTS`. Down: one `ALTER TABLE transactions` dropping exactly those eleven with `DROP COLUMN IF EXISTS`, nothing else. |
| `db/schema.sql` | The same eleven columns declared inline in `CREATE TABLE transactions`, after `note` and before `created_at`, the same way `watched_at` and `note` are declared there. Same types, same nullability, no default, no CHECK, no index. |
| `db/schema.sql` (doc-drift fix, G1 round 2) | `transactions.property_id INT REFERENCES properties(id) ON UPDATE CASCADE ON DELETE SET NULL` declared inline (after `transfer_group_id`), with its inheritance comment, plus `idx_transactions_property_id ... WHERE property_id IS NOT NULL` beside the other `transactions` indexes. Not this task's column; see "Doc-drift fix" below. |
| `packages/contracts/**` (`types.ts`, `shapes.ts`), `shared/**` | **No change.** |

The eleven columns, identical in both files:

| Column | Type | Nullable | Default | Constraint |
|---|---|---|---|---|
| `plaid_category_detailed` | TEXT | yes | none | none |
| `plaid_category_confidence` | TEXT | yes | none | none |
| `authorized_date` | DATE | yes | none | none |
| `payment_channel` | TEXT | yes | none | none |
| `merchant_entity_id` | TEXT | yes | none | none |
| `logo_url` | TEXT | yes | none | none |
| `website` | TEXT | yes | none | none |
| `location_city` | TEXT | yes | none | none |
| `location_region` | TEXT | yes | none | none |
| `location_country` | TEXT | yes | none | none |
| `plaid_raw` | JSONB | yes | none | none |

Expected output of acceptance #4 is unchanged from the spec. `plaid_category` is not touched.

No existing migration was edited. The timestamp `1791360000000` sorts after
`1791352847213_transaction-tombstones.sql`, which T4 says is the newest. It falls on 2026-10-07. So
`node-pg-migrate down 1` reverts exactly this file.

## Change class: additive

The change adds nullable columns with no default to a table that already has rows. §9.2 lists this as
the plain additive case. Existing columns keep their type, nullability, default and meaning. Every
existing `INSERT INTO transactions` path still works without naming the new columns. Every existing
reader still works because none of them selects them. No row is written.

`plaid_category` has **no** semantic change, and that was the risk here. The detailed category gets
a new column name because of §9.2's rule: "where history is retained, require a new field name, not
a redefinition". Every stored row and every `category_rules.plaid_category` key holds a primary value.
Repointing the old column would split its history across two vocabularies with no boundary marked,
and every rule would silently stop matching new rows.

## Doc-drift fix: `transactions.property_id` (pre-existing, not this task's column)

G1's first run of #10 failed on exactly one line. The migrated DB had `property_id integer YES`, and
`db/schema.sql` never declared that column. It was added by
`migrations/1786646344365_property-transaction-attribution.sql`. That migration's lines 21 and 25 are
now mirrored in `schema.sql`, with the same column type, FK actions and partial index. The comment
records the inheritance semantics that BUILD.md §2 requires: `COALESCE(t.property_id, a.property_id)`.
An explicit tag wins, the account supplies the default, and NULL means *inherit*, not *unattributed*.

**Class: additive, comment/doc.** No database changes. The migration history already creates this
column on every migrated database, and `schema.sql` is the reference document catching up with it. No
migration was added or edited for it.

**Still not mirrored (out of scope, flagged):** the same migration also creates `property_balances`,
which `db/schema.sql` does not declare either. #10 compares only `transactions`, so it does not catch
this. Per the instruction to touch nothing else, it is left for a separate doc-drift fix.

## Null semantics, as recorded in both files

NULL has two meanings, and `plaid_raw` is how a consumer tells them apart:
- `plaid_raw` set and a scalar column NULL: a sync wrote the row and Plaid did not say. Plaid omitted
  the key, sent null, or sent a blank string. The value is never stored as `''` or `0`.
- `plaid_raw` NULL: nothing was captured. Either the row predates this migration and no sync has
  rewritten it, or it is a manual, CSV or cash row. The enrichment is unknown.

That is why nothing has NOT NULL or a default. A default would state something Plaid never said.
NOT NULL would force the non-Plaid insert paths to make up values. None of these columns inherits
from anything, so the `COALESCE`-inheritance note does not apply.

## No CHECK, no index

`payment_channel`, both category columns and the confidence level use Plaid's vocabularies, and Plaid
adds values. With a CHECK, the first new value would fail the INSERT and then the whole item's sync.
Values are stored verbatim. Nothing queries these columns yet, so there is no index. `payment_channel`
is documented as **not** an exclusion signal.

## Columns deliberately not added

Coordinates, street address, store number and `authorized_datetime` get no columns. COVERAGE.md puts
each of the first three under a fifth of posted rows, and `authorized_datetime` is often a placeholder
midnight. They are kept in `plaid_raw`, so a later column can be filled from stored rows. The comments
describe the coverage in words and quote no figures.

## The redaction rule (`plaid_raw`)

`plaid_raw` holds the single Plaid `Transaction` object as `transactionsSync` returned it. Every key is
kept, including null-valued ones. Nested objects stay intact. Nothing is renamed, flattened or
normalised, and no app-derived key is added.

**Exactly one removal:** the `account_numbers` key on every element of `counterparties`. That key holds
BACS, IBAN and BIC numbers, which belong to a third party's bank account (BUILD.md §10.3 leakage class).
The rest of each counterparty is kept. `account_owner` and `payment_meta` are kept per the G0
decision recorded in the spec.

`plaid_raw` is a record only. Plaid's `amount` inside it is never read as money, because the `amount`
column is authoritative. No route, reader or contract type may select or return it.

## `packages/contracts`: deliberately untouched (confirmed)

`TransactionSchema` and the `Transaction` type describe an **API payload**, not the table, and
`TransactionFieldsAreExact` ties the two together. Adding the eleven fields before any endpoint returns
them would describe fields no response carries, and the schema would stop parsing the real rows the
routes return. Keeping `plaid_raw` out of every contract type also helps keep it from reaching a
client. P6-40d adds fields when an endpoint first returns them.

## Backfill

**None in this migration. That is P6-40c.** Every pre-existing row has NULL in all eleven columns after
`up`. The migration rewrites no data, so this task needs no CSV backup. P6-40c's guardian or
implementer must specify one if that backfill overwrites anything.

## Rollback

`DATABASE_URL=<target> npx node-pg-migrate down 1` drops the eleven columns and nothing else. Any
enrichment captured since deploy is lost, and the only way to get it back is the P6-40c backfill. No
pre-existing column or `transaction_tombstones` is affected. The columns are nullable with no default,
so it is safe to leave the migration applied while the code is reverted.

## Flags for the orchestrator

1. **(Resolved in G1 round 2; see "Doc-drift fix" above.)** **#10's parity diff may be non-empty for a reason older than this task.** BUILD.md §2 and §10.3
   describe `transactions.property_id` (resolved as `COALESCE(t.property_id, a.property_id)`).
   `db/schema.sql` does not declare that column anywhere: not inline, and not as an `ALTER TABLE
   transactions`. If a migration adds it, #10 will show an extra `property_id` line on the migrated
   side whatever this task does. Other migration-only columns would show up the same way. I cannot
   list `migrations/` or run the diff. Please run #10 first. If it shows only pre-existing drift, it
   is a separate guardian fix: add the missing column to `schema.sql` with its inheritance comment,
   using the exact type and FK from its migration. I did not add it here because that is outside
   this task's minimal diff and I cannot see the type.
2. **Missing directory listing.** I chose the timestamp without listing `migrations/`. If any file
   sorts after `1791360000000`, rename this one. It is uncommitted, so that is allowed.
3. **Spec contract otherwise looks right.** One note: the spec's "NULL means Plaid did not say" is
   only true for rows where `plaid_raw` is set. For pre-existing rows NULL means "not captured".
   Both files now state the distinction, so the 40c/40d consumers can tell them apart.
