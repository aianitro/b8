# P6-40a-deletion-tombstones — Contract note (contract-guardian)

## Diff summary

| File | Change |
|---|---|
| `migrations/1791352847213_transaction-tombstones.sql` | **New file.** Up: `CREATE TABLE IF NOT EXISTS transaction_tombstones`. Down: `DROP TABLE IF EXISTS transaction_tombstones`, nothing else. |
| `db/schema.sql` | The same table, placed directly after the `transactions` indexes and before `cash_counts`. Columns, types, nullability and constraints match the migration exactly. |
| `shared/types.ts`, `shared/contracts/**`, `packages/contracts/*` | No change. |

The table:

```sql
CREATE TABLE IF NOT EXISTS transaction_tombstones (
  plaid_transaction_id TEXT PRIMARY KEY
    CONSTRAINT transaction_tombstones_key_not_empty CHECK (plaid_transaction_id <> ''),
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Expected parity listings for acceptance #5, the same from both databases:
- Columns: `deleted_at timestamp with time zone NO`, `plaid_transaction_id text NO`
- Constraints: one `c` (the non-empty CHECK), one `p` (`PRIMARY KEY (plaid_transaction_id)`), no `f`.

No existing migration was edited. `transactions` is not altered in either direction.

## Change class: additive

This adds a new table and nothing else. No existing column, type or meaning changes, and no existing
query can see the table until the implementer writes one. The `NOT NULL` columns do not make it
"breaking" under §9.2. That class is for adding a required column to a table that already has rows
and writers. This table starts empty, and its only writer is the code this task adds.

## Decisions and why

**The key is `plaid_transaction_id TEXT`, as the PRIMARY KEY.** Sync needs to answer "was this id
deleted?", and Plaid's `transaction_id` is the only thing it has for an incoming transaction.
`transactions.plaid_transaction_id` is `TEXT NOT NULL UNIQUE` on every row, so every deletable row has
a key, including synthetic `manual_<uuid>` and `csv_<hash>` ids. Tombstones for synthetic ids do no
harm: sync never receives those ids, and per the spec the CSV importer and manual create do not read
this table. A PRIMARY KEY is used, not a UNIQUE constraint, because the id is the row's identity and
there is no other column that could serve as a key. The PK's index is also what sync's lookup will use.

**No foreign key to `transactions`.** A tombstone exists to outlive the row it names. With `RESTRICT`,
the delete it records would be refused. With `CASCADE` or `SET NULL`, the tombstone would disappear
with the row. Any FK would also bring this table into `TRUNCATE transactions ... CASCADE`. Acceptance
#5 checks for zero `f` constraints.

**`CHECK (plaid_transaction_id <> '')`, which the spec did not require.** The spec says a tombstone
key is never NULL or empty. The PK covers NULL. The CHECK covers empty: an empty key matches nothing
sync will ever receive, so it can only come from a delete that read its key from somewhere other than
the row it removed. That is one of the spec's listed failure modes. With the CHECK, that bug makes the
delete fail and roll back, instead of leaving a tombstone that protects nothing. See the edge case
under "Flags" below.

**`deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.** The spec allowed this as optional. It is an
observation, not a derived value: the moment the owner made the decision. It is also the only thing a
future cleanup or an audit ("when did I delete this?") could use. Defining its meaning is a contract
decision: **it is the FIRST time this id was tombstoned.** A repeat delete of an already-tombstoned
id (S3, which in practice only happens to a `csv_` row re-created by re-importing its file) must leave
the existing tombstone row unchanged, not move `deleted_at` forward. In practice the implementer's
conflict handling must keep the first row, not overwrite it. The tests rely only on the key column.

**Columns deliberately left out.** No account, date, amount or name. Those would be the "fingerprint"
the spec rules out as a non-goal, and an amount column would be a money figure with no reader. No
`source` or `reason` column, because only the owner's delete writes a row. Plaid's `removed` writes
nothing, so a discriminator would have exactly one value.

**`IF NOT EXISTS` in both directions**, matching the existing migrations, which use
`ADD COLUMN IF NOT EXISTS` so they can run against a database first built from `db/schema.sql`.

## Known limit recorded in the schema

After a bank re-auth, Plaid issues new ids for the same real transactions. A deleted transaction's new
id is not tombstoned, so the transaction can come back as `added`. This limit is stated in comments in
both the migration and `db/schema.sql`, as the spec requires. It is not fixed here.

## `packages/contracts`: none needed (confirmed)

No wire shape changes. The `DELETE` response, its status codes and its input validation are unchanged.
Sync's return shape is unchanged; only the value of `added` changes, because skipped ids are not
counted. No API returns tombstones. `shared/types.ts` and `shared/contracts/**` need no change either.
No TypeScript type describes this table, because no API returns it.

## Backfill

**None. The table starts empty.** Transactions deleted before this ships are not tombstoned
retroactively (that is 40c's business), so no rows are rewritten and no CSV backup is needed.

## Rollback

`npm run migrate:down` drops only `transaction_tombstones`. Tombstones recorded since deploy are lost,
which means only that Plaid could re-create those deleted transactions. No other data is affected.

## Flags for the orchestrator

1. **Empty-id edge case from the CHECK.** `transactions.plaid_transaction_id` has no non-empty CHECK
   of its own. If a row with `plaid_transaction_id = ''` existed, deleting it would now fail, because
   the tombstone insert is refused and the delete rolls back with it. No writer in the code described
   by the spec produces an empty id (Plaid ids, `manual_<uuid>`, `csv_<hash>`). If you want certainty
   before G1 closes, run `select count(*) from transactions where plaid_transaction_id = ''` against
   the dev database. It should print `0`. If it does not, tell me and I will drop the CHECK; nothing
   in the acceptance commands depends on it.
2. **Migration timestamp.** `1791352847213` is later than `1790853644977` (the newest migration I was
   told about) and falls on 2026-10-07. I cannot list the directory. If another migration has been
   added since with a later timestamp, this file must be renamed (it is uncommitted, so renaming is
   allowed) to keep the order correct.
3. **Nothing in the spec's contract section looks wrong to me.** One note on acceptance #5's
   column query: it filters `information_schema.columns` only by `table_name`, not by schema.
   That is fine on a throwaway database with only `public`.
