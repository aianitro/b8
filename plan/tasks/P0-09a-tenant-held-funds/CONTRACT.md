# CONTRACT — P0-09a-tenant-held-funds
**Author:** contract-guardian
**Lease:** opened 2026-08-28T00:46:59Z (`.claude/.contract-lease.log`) · closed <ts — orchestrator records at G1 PASS>

## Change
| File | Change | Class (§9.2) |
|---|---|---|
| `shared/types.ts` | `TenantFundKind = 'security_deposit' \| 'last_month_rent'` added. No existing type, interface, or field modified. | additive |
| `migrations/1787871600000_tenant-held-funds.sql` | New table `property_tenant_funds` (append-only observation series, one row per reading, discriminated by `kind`); index `idx_property_tenant_funds_property_id` on `(property_id, kind, valued_at DESC)`; new **nullable** column `net_worth_snapshots.liabilities_security_deposits NUMERIC(14,2)`. | additive (both) — see "The `net_worth_snapshots` question" below for why the semantic change SPEC flagged as breaking does not land as a breaking *contract* change |
| `db/schema.sql` | Reflects the migration verbatim (table + index at lines 78–132, snapshot column at 248–282), with the full rationale comments. | — |

The SPEC left the persisted shape to the guardian ("whether this is new sibling table(s) or new
column(s) on an existing table is the guardian's call") and blocked G1 on the
`net_worth_snapshots.liabilities` semantic change. Both are decided here.

## Rationale

### One table with a discriminator, not two sibling tables
The two figures are the same observation motif — per-property, manually entered, positive
magnitude, newest-wins — and differ *only* in how the app treats them downstream. Two tables would
have made that difference invisible in the schema: "which of these reduces net worth?" would be
answered nowhere in `db/schema.sql` and only implicitly, in whichever query happened to read which
table. A discriminator column lets the schema state the distinction next to the thing it describes,
which is the whole reason these comments are in the contract surface rather than in a route
handler. A third kind (pet deposit, prepaid HOA) then costs a one-line `CHECK` change, not a fourth
table and a fourth reducer.

The alternative shape — columns on `properties` — was rejected outright: it would be a stored
"current amount," the exact class of column this role exists to refuse. A changed deposit would
overwrite the previous figure and the history would be gone.

### `value` / `valued_at`, not `amount` / `recorded_at`
This is the *third* series in the app with the shape `latestValueByKey()` reduces, and the other
two (`account_valuations`, `property_valuations`) spell these two fields exactly so. A third
spelling would make the shared reducer look like a coincidence rather than a rule, and the
duplicated-reducer defect this project already paid for (`lib/domain/property.ts` cloning
`valuation.ts`) started as exactly that kind of near-miss. Naming is what makes the reuse obvious
to the next reader.

### `CHECK (value >= 0)` here, but not on the valuation tables
On `account_valuations` and `property_valuations`, "always a positive magnitude" is only a comment.
It is enforced as a constraint here because this is the one series whose sign is *flipped on read*
(`liabilities -= value`). A negative row on a valuation table understates an asset — visibly wrong.
A negative row here turns an obligation into an asset and *raises* net worth, with nothing
downstream looking wrong: the components still sum to the total, every page renders, and the
headline figure is simply too high. That is this repo's signature failure mode (the Gastonia sign
trap, one line from shipping inside the fix for another bug), and the database is the only place
that can refuse it once and for all.

### No `source` column
`account_valuations` and `property_valuations` carry one because a Zillow-shaped API is a named,
plausible future observer of a property's market value, and `plaid_balance` / `plaid_investments`
are already live values on the account side. Nothing outside this app can observe a security
deposit — it is a term of a lease the owner holds. A column with exactly one permitted value would
be ceremony, and the CHECK constraint listing one literal would invite a future reader to assume a
second observer was planned.

### Null means unknown, and the schema must not let that collapse
No row for a property means the amount is **unknown** and renders "—". A row whose `value` is `0`
is a **real reading** — a waived deposit, or a last month's rent fully applied and not yet
re-collected — and renders `$0`. Because the table is append-only with no default row, the
distinction is `Map.has(key)` at the reducer, exactly as `latestValueByKey` already draws it; there
is no `DEFAULT 0`, no backfill, and nothing in the schema that could turn the first case into the
second. This is stated in the migration and in `db/schema.sql` because it is the one property of
this table that a type signature cannot carry.

### Why `last_month_rent` is stored but is not a liability
Recorded as an accepted asymmetry, not left to be re-litigated by whoever reads the table next.
Under accrual accounting last month's rent held is unearned revenue and would be a liability. This
app is cash-basis throughout — `computePropertyPnl` sums transactions — so that payment was already
recognized as rent income on the day it landed. Booking it as a liability now would make the
net-worth statement and the P&L disagree about the same dollar. It is stored and displayed because
"you are holding $X of tenant money" is true of it too; it contributes to no net-worth component
and emits no contribution line. The schema records the reason so a future reader does not "fix" the
omission.

### The `net_worth_snapshots` question — accepted deviation from §9.2's literal remedy

**The change.** Folding security deposits into `liabilities` redefines that column, and therefore
`total`, from the cutover date forward. Same column, same type, different meaning — §9.2's
*semantic change with no type change*, the class the table calls "the dangerous one," and the one
that renders perfectly while being false. §9.2's stated remedy where history is retained is a **new
field name**, i.e. `liabilities_v2`.

**Verified fact this decision rests on.** The orchestrator verified at G1 that
`net_worth_snapshots.liabilities` has **zero readers**:

| File:line | Role |
|---|---|
| `lib/netWorth.ts:98` | **writes** `liabilities` |
| `scripts/seed-demo.mjs:454` | **writes** `liabilities` |
| `app/net-worth/page.tsx:29` | reads the table; selects `snapshot_date, operational, capital_financial, real_estate_equity, total` — **not** `liabilities` |
| `app/dashboard/page.tsx:129` | reads the table; selects `snapshot_date, total` — **not** `liabilities` |

This is recorded as verified by the orchestrator, not asserted by the guardian, because the whole
adjudication below is downstream of it.

**Decision: a decomposition column (`liabilities_security_deposits`), accepted over `liabilities_v2`.**
Three reasons, in the order they carry weight:

1. **`liabilities_v2` would mark the wrong series.** It puts a boundary marker on a column no
   surface plots, and leaves the discontinuity that *is* plotted — in `total`, on both
   `/net-worth` and `/dashboard` — completely unmarked. §9.2's remedy exists to stop a trend chart
   becoming a lie that renders perfectly; applied literally here it would not touch the trend
   chart.
2. **`total` is where the break lands, and it must not be renamed.** It is the headline figure on
   two pages and the basis of the dashboard's since-first-snapshot delta. Its *meaning* also has
   not changed: "net worth on this date, as truthfully as the app could then state it." Renaming it
   would make every future truthfulness fix demand a `total_v3`, `total_v4`, and the scheme
   collapses under its own naming.
3. **A decomposition column is strictly more useful than a rename.** Any post-cutover row converts
   exactly back to the old definition — `liabilities - liabilities_security_deposits` — so a
   consumer can plot *either* definition consistently across the entire history. A rename yields
   two half-series with no bridge in either direction.

**Nullable, and deliberately not backfilled.** NULL on pre-cutover rows is the marker *and* the
honest value: it means "this row predates deposit modelling," not "no deposits were held that day."
Deposits were held; they had not been recorded, and the figure is unrecoverable. `0` would assert
something false about ~3 weeks of daily rows, so no backfill is done — consistent with SPEC
non-goal #4.

**Signed, not a magnitude.** The column carries the value exactly as it lands in `liabilities`
(i.e. `<= 0`). Every column in that row is signed as it contributes; mixing a magnitude in among
them is the sign trap this repo has shipped once already.

**Load-bearing consequence for the implementer** (stated in the migration and in `db/schema.sql`,
repeated here because it is the one way this column can be made worse than useless): every `INSERT`
**and** the `ON CONFLICT DO UPDATE` in `writeNetWorthSnapshot()` must set this column. A
post-cutover row left NULL claims to be old-definition while carrying a deposit-adjusted
`liabilities` — a marker that lies is worse than no marker.

### `shared/types.ts` — only `TenantFundKind`
The SPEC anticipated no type change. One is warranted: the kind discriminator is spelled in the
type, not left to the SQL `CHECK` alone, precisely because the entire point of the pair is that the
two are treated differently. Typed as `string`, a mistyped literal in the filter that separates
them matches no rows — and a deposit that quietly stops counting is a wrong number that looks like
a right one. No display shape is added: per the SPEC's own precedent (`PropertyEquity` lives in
`lib/domain/property.ts`), the per-property resolved figures are implementation-owned and stay out
of the contract surface.

## Domain invariants preserved
- **Derived, not stored:** No "current"/"latest" column anywhere in this change.
  `property_tenant_funds` is append-only — a changed holding is a new row, and "currently held" is
  the newest row per `(property_id, kind)`, reduced through the existing `latestValueByKey`
  (`lib/domain/observations.ts`), never last-row-wins. The index exists to serve exactly that read.
  `net_worth_snapshots.liabilities_security_deposits` is a decomposition of an already-stored
  computed statement, under the table's pre-existing and documented exception: the statement cannot
  be reconstructed later because it depends on which accounts existed and how they were classified
  that day.
- **Money:** `property_tenant_funds.value NUMERIC(14, 2)` and
  `net_worth_snapshots.liabilities_security_deposits NUMERIC(14, 2)` — the same scale as every
  other money column in both neighbourhoods (`account_valuations.value`,
  `property_valuations.value`, and all five existing `net_worth_snapshots` figures). No float
  anywhere in the change.
- **Null semantics:** Two distinct nullabilities, both meaning *unknown* and neither defaulted to
  zero. (a) *No row* in `property_tenant_funds` for a `(property_id, kind)` = never entered ⇒
  resolves `null` ⇒ renders "—"; a row with `value = 0` is a real reading ⇒ renders `$0`. There is
  no `DEFAULT` and no seeded row that could blur the two. (b) *NULL* in
  `liabilities_security_deposits` = this snapshot predates deposit modelling, which is not the same
  claim as "zero deposits held," and is why no backfill is specified.
- **Inheritance:** Not applicable — no nullable column in this change carries inherit-from-parent
  semantics. `property_tenant_funds.property_id` is `NOT NULL`: a tenant fund with no property is
  meaningless, so there is no NULL to give a second meaning to. (The `COALESCE` rule remains
  confined to `transactions.property_id`, unchanged by this task.)

## Migration
```
npm run migrate:up && npm run migrate:down && npm run migrate:up
```
<verbatim output against a throwaway database — orchestrator runs this at G1; the guardian does
not, and must not: `npm run migrate` loads `.env.local`, whose `DATABASE_URL` points at the
owner's real data, and `--envPath` overrides an exported `DATABASE_URL` rather than deferring to
it. Run with an explicit throwaway target, per the standing hazard in `GATES.md`.>

**What the round-trip must demonstrate**, beyond exit 0: the `down` drops the snapshot column
first, then the index, then the table — the reverse of the `up` — so the second `up` recreates the
table on a database where no `property_tenant_funds` rows or `liabilities_security_deposits` values
survive. The `down` is genuinely destructive, and the migration carries the `\copy` backup commands
for both objects inline (see below).

## Backfill / data correction required
**None for this task's forward path.** Both objects are net-new; there are no pre-existing rows to
correct and nothing is rewritten. Existing `net_worth_snapshots` rows keep the `liabilities` and
`total` they already hold and gain a NULL in the new column, which is the correct value for them
(SPEC non-goal #4).

**Required before running the `down` migration against any database holding real rows** — this is
the destructive direction, and the backup is BUILD.md §9.3's standing practice, executed by the
implementer or orchestrator, never by the guardian. Both commands are reproduced in the migration
file itself so they are found by whoever is mid-rollback:

```
\copy (SELECT * FROM property_tenant_funds ORDER BY id)
  TO 'backup-property_tenant_funds.csv' CSV HEADER

\copy (SELECT snapshot_date, liabilities, liabilities_security_deposits
         FROM net_worth_snapshots
        WHERE liabilities_security_deposits IS NOT NULL ORDER BY snapshot_date)
  TO 'backup-net_worth_snapshots-deposits.csv' CSV HEADER
```

Note what the second backup does **not** let you undo: dropping the column leaves the surviving
post-cutover `liabilities` and `total` values silently under the new definition with no marker
saying so — precisely the state the column exists to prevent. Re-applying the `up` restores the
column as NULL for those rows, not as its former value. The CSV is the only path back, and it must
be restored by hand.

## Consumers checked
- `npx tsc --noEmit` → <orchestrator captures at G1: exit 0, or the two pre-existing
  duplicate-`.d.ts` errors from the gitignored build cache recorded in `GATES.md` and nothing
  else. The types change is a single new exported union with no existing declaration modified, so
  no existing consumer's compilation can be affected by it.>
- **`lib/netWorth.ts:98`** — writes `liabilities` into `net_worth_snapshots`. Compiles unchanged;
  the new column is nullable, so the existing INSERT remains valid SQL. **This is the one consumer
  that must change in implementation**: leaving it unchanged produces post-cutover rows with a
  deposit-adjusted `liabilities` and a NULL marker, which is the failure described above. Flagged
  for the implementer, not fixed here.
- **`scripts/seed-demo.mjs:454`** — writes `liabilities`. Same story: valid unchanged, but any
  seeded row it writes after the cutover carries the same lying-marker problem. In scope for the
  implementer only insofar as its output must not contradict the column's meaning.
- **`app/net-worth/page.tsx:29`** — selects `snapshot_date, operational, capital_financial,
  real_estate_equity, total`. Unaffected: it does not select `liabilities` and does not select the
  new column. (Its `COMPONENTS` caption edit is a SPEC-scoped implementation change, not a contract
  consumer issue.)
- **`app/dashboard/page.tsx:129`** — selects `snapshot_date, total`. Unaffected, same reason.
- **`property_tenant_funds`** has no existing consumers by construction — the table is new. Its
  first reader will be the domain function the implementer writes, which the SPEC requires to reuse
  `latestValueByKey` rather than write a second newest-wins reduction.
- **`properties`** — unchanged. The new FK is `ON UPDATE CASCADE` with no `ON DELETE` clause,
  matching `property_valuations` exactly, so deleting a property with recorded tenant funds is
  refused rather than silently discarding the record of what a tenant is owed.
