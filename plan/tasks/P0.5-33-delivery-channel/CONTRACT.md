# CONTRACT — P0.5-33-delivery-channel
**Author:** contract-guardian
**Lease:** opened 2026-09-04T06:03:14Z (`.claude/.contract-lease.log`) · closed `<ts — orchestrator records at G1 PASS>`

> **Enforcement note, recorded because it matters to how this file should be read.** The
> `PreToolUse` scope-guard hook was **not active** in this session: it resolves through
> `$CLAUDE_PROJECT_DIR/.claude/hooks/scope-guard.mjs` and the session is rooted above `app/`, so the
> path does not resolve. The lease was therefore an auditable protocol here, not a mechanical bar.
> The surface below is what was touched, and it is the whole of what was touched — verifiable with
> `git status --porcelain`, which is the check that does not depend on my say-so.

## Change

| File | Change | Class (§9.2) |
|---|---|---|
| `migrations/1788505200000_alert-sends.sql` | New table `alert_sends` — append-only, one row per send **attempt**; four CHECK constraints; index `idx_alert_sends_fingerprint` on `(fingerprint)`. Nothing existing is altered, renamed, or redefined. | **additive** |
| `db/schema.sql` | Reflects the migration (inserted after `idx_sync_log_ran_at`, the other job-log table), with condensed rationale. Byte-equivalent in effect — verified by column/constraint/index diff, below. | **additive** |
| `shared/types.ts` | *(none — and this is a decision, not an omission; see "Why `shared/types.ts` does not change")* | — |

### Change class, and why it is not something stronger

**Additive**, on all three of §9.2's tests, and each is worth stating separately because "new table"
is not by itself a free pass:

- **No existing column changes type, name, or nullability.** The migration issues one `CREATE TABLE`
  and one `CREATE INDEX`. It touches no other relation.
- **No existing column changes *meaning*.** §9.2 names semantic-change-without-type-change as the
  dangerous class, and it is the one that would apply if this step had chosen to remember sends by
  widening `sync_log` — which was considered and rejected in SPEC.md Q4. `sync_log.trigger` /
  `phase` / `synced` would then have had to mean "or an alert run, in which case `synced` counts
  messages", and every historical row would have become a mixture of two definitions with nothing
  marking the boundary. A separate table is what keeps this change additive rather than breaking.
- **The `NOT NULL` columns are not §9.2's breaking case.** That row of the table
  ("New required field / `NOT NULL` column → **breaking**") is about adding a required column to a
  populated table, where existing rows have no value to put in it. This table is created empty and
  has no producer until the implementer writes one, so `NOT NULL` costs nothing and buys the
  guarantees argued below. There is no nullable-then-backfill-then-tighten path to prefer here
  because there is nothing to backfill.

## Rationale

### One row per *attempt*, and `delivered` as a separate fact from existence

The suppression question is *"has a message with this fingerprint already been **delivered**?"*, not
*"has one been tried?"*. Those come apart on the first network blip, and the failure they produce is
the worst-shaped one available to this feature: the guardrail goes silent, permanently, starting on a
day nobody was watching, and the silence is indistinguishable from a good month. So `delivered` is a
column, the read is `WHERE fingerprint = $1 AND delivered`, and a failed row leaves tomorrow's retry
free (SPEC.md F19).

The same shape is what makes SPEC.md Q5's diagnostic work: *nothing here for three weeks* means the
job never ran; *three rows with `delivered = FALSE`* means it ran and could not reach the provider.
A table that recorded only successes could not tell those apart, and today nothing can.

### Why there is deliberately **no** `UNIQUE (fingerprint)`

This is the single most load-bearing *absence* in the migration and it is commented as such in both
files, because an absence is invisible in a diff and a later reader will be tempted to "fix" it.

The rejected alternative shape (SPEC.md's "Rejected alternatives", and this role's standing rule that
derived values are never stored columns) is one mutable row per fingerprint carrying a `last_sent_at`,
upserted on each send. Without a unique constraint there is no `ON CONFLICT` target, so
`INSERT ... ON CONFLICT (fingerprint) DO UPDATE` **does not run at all** against this table — Postgres
raises `there is no unique or exclusion constraint matching the ON CONFLICT specification`. The
append-only rule stops being a convention someone has to remember and becomes something the database
refuses. Verified as control C11 below.

Duplicate fingerprints are therefore not a defect to be cleaned up. They are the history: a failed
attempt and the next day's success are two rows about one fingerprint, on purpose.

### The fingerprint CHECK is the redaction, made structural

`CHECK (fingerprint ~ '^[0-9a-f]{16,}$')`.

SPEC.md's constraint is that this table holds no name of anything the owner spends on. The obvious
cheap key — joining the names together with a separator — would satisfy every functional requirement
of duplicate suppression and would write the owner's private reading of their own spending into the
one table most likely to be pasted into an `EVIDENCE.md`, cropped into a screenshot, or read out of
`psql` while somebody debugs a delivery. `BUILD.md` §5.4 is the standing rule; a send log is where it
gets broken by accident.

A comment saying "keep this opaque" is a hope about the caller. The regexp is a property of the
database: `'Dining Out|Travel'` is rejected on insert (control C5), as is any uppercase or
under-length digest (C6). It also pins SPEC.md F17's assertion (`/^[0-9a-f]{16,}$/`) at the
persistence boundary rather than only in the test suite, so a future producer that never read F17
cannot regress it.

### `failure_reason` is a closed classification, not the error text — **a guardian ruling, flagged for G1**

This is the one place I narrowed the spec rather than transcribing it, so it is called out here for
the orchestrator to overrule in one line if it disagrees.

SPEC.md says the row records *"if not, why"*. It does not say *how*. I made it a closed CHECK over
three classes (`'config'`, `'transport'`, `'rejected'`) instead of free text, because:

1. **Free text here is a leak with a plausible excuse attached.** A provider's rejection routinely
   quotes the message back at you, headers included, and the subject line on this surface carries
   exactly the things this table must never hold. Control C9 shows a realistic such string being
   refused — and note that the refusal's own `DETAIL:` line then prints it, which is precisely how
   this content ends up in a terminal scrollback and then in a report.
2. **The detail is not lost.** SPEC.md Q5 already routes the failure through `lib/logger.ts` like
   every other scheduler failure. That is where an operator looks anyway, and it is not the row that
   gets pasted into a document. The table's job is to make the *shape* of the failure legible, not to
   be the error store.
3. **The three classes partition the space by construction** — did not try; tried and could not
   connect; connected and was refused.
4. **It can never block the implementer.** A failure fitting none of the three is written as `NULL`
   with its detail in the log. No migration is needed to record an outcome nobody anticipated, so
   this constraint cannot cost a cycle. That property is what made the closed list safe to choose.

The cost, stated: a diagnosis coarser than a stack trace, recoverable from the log. The benefit: the
"holds no financial data" property is true of the schema rather than true of the current
implementation.

### `kind` is the *message* kind, not the transport

Two values, `'projected-breach'` and `'coverage'` (SPEC.md F1, F4). It is CHECK-constrained because
`kind` is one of the fingerprint's inputs, and F16 — a coverage message and a breach message for the
same month never colliding in suppression — holds *only* because that is true. A free-text `kind`
would let a typo silently merge the two key spaces.

It is explicitly not a channel column. There is one transport and a second destination re-triggers
the `BUILD.md` §5.1 escalation (`DECISION.md`, "Not a second destination") rather than adding a value
here. Phase 3 step 25 and Phase 5 step 38 inherit this step's allowlist and would each widen this
list by an additive migration — §9.2's "new enum-ish value" row, which is the intended path.

### `delivered BOOLEAN NOT NULL` with **no** `DEFAULT`

Every other boolean in this schema carries a default. This one deliberately does not. The shell knows
the outcome by the time it writes the row, so a default can only ever assert something nobody
observed. `DEFAULT TRUE` would silence every future retry — the exact failure `delivered` exists to
prevent. `DEFAULT FALSE` would look harmless while making the log wrong about what happened. An
`INSERT` that forgets the column fails loudly instead (control C10), which is the cheap version of
finding out later.

### Placement in `db/schema.sql`

Inserted directly after `idx_sync_log_ran_at`, beside the other table that records what the daily job
did, rather than appended at the end of the file. Both are pure insertions of the same size, so the
diff cost is identical; a reader asking "where is the record of what the scheduler did" finds both in
one place. Nothing was reordered and nothing adjacent was tidied.

## Domain invariants preserved

- **Derived, not stored.** No `last_sent_at`, no "current", no "latest", no count-of-sends column.
  "What was last sent" is a derived read, as everywhere else in this repo — and here the absence of
  `UNIQUE (fingerprint)` makes the stored-latest alternative literally un-writable (C11). This table
  is not, and does not resemble, the `net_worth_snapshots` exception: that stores a computed
  statement because it genuinely cannot be reconstructed later. Every row here records the app's own
  behaviour at a moment, which is an observation, not a derivation.
- **Money.** *Satisfied vacuously, and stated rather than left ambiguous:* **there are no money
  columns and no figure-bearing columns of any kind in this table**, so "exact fixed-point with a
  stated scale, never float" has nothing to range over. The `NUMERIC`-vs-float rule is not silently
  skipped here; it is inapplicable by design, and the design is the point — SPEC.md acceptance #71
  greps the migration for that entire vocabulary and expects **zero** matching lines. Measured: `0`.
- **Null semantics.** `failure_reason` is the only nullable column, and `NULL` means *unknown*, read
  against `delivered`:
  - `delivered = TRUE`, `failure_reason NULL` — it went; there was no failure to classify.
  - `delivered = FALSE`, `failure_reason NULL` — it did not go and the cause was none of the three;
    the log for that run has the detail.

  Nothing is defaulted, and no missing observation is coerced into a value. The coupling CHECK
  `(NOT delivered OR failure_reason IS NULL)` refuses only the genuinely contradictory row — a
  delivered row that also carries a reason it failed. It is one-directional on purpose, matching this
  repo's existing debt-service coupling: the converse ("a failed row must carry a reason") is **not**
  enforced, because forcing a classification the caller does not have produces a placeholder that
  reads as a diagnosis and is not one. `delivered` is `NOT NULL`, so there is no three-valued-logic
  hole where a `NULL` lets the constraint pass by evaluating to `UNKNOWN`.
- **Inheritance.** Not applicable — no column here inherits from a parent row, and nothing resolves
  through a `COALESCE`. Stated so the box is answered rather than skipped.

## Why `shared/types.ts` does not change

SPEC.md #68 asserts no change; I agree, and the reason is worth recording because `TenantFundKind`
and `ControlMode` are both database CHECK sets that **do** live in `shared/types.ts` and look like
precedents for an `AlertKind` there.

They are not. Both of those appear on a row shape (`BudgetCategory`, and the tenant-funds reader)
that is serialized across the server/client boundary and rendered by a component. That boundary is
what `shared/types.ts` describes. `alert_sends` has no client consumer by construction — SPEC.md's
non-goals rule out any route, page, component or UI for alerts — so an `AlertKind` there would be a
type in the boundary file that no boundary crosses, and `shared/types.ts` would quietly stop meaning
"the wire contract" and start meaning "all the types". The alert's types are `lib/` types, the same
class as `MonthOutlook` and `CategoryPace`, and they belong with the pure modules that own them.

**If that changes, it is a contract change, not a convenience.** Should a later step render send
history on a page, `AlertKind` moves to `shared/types.ts` under a fresh lease.

## Migration

Run against a scratch database created and dropped for this purpose. **`.env.local` was never used**
— it points at `b8_finance`, the dev database holding real financial data. `DATABASE_URL` was
overridden explicitly on every command, which is why `npm run migrate:up` (which hard-codes
`--envPath .env.local`) does not appear below.

**Scratch database:** `b8_scratch_p0533` (created, used, dropped). A second, `b8_scratch_p0533_dump`,
was built from `db/schema.sql` alone for the reflection diff, then dropped.

```
$ export SCRATCH_DATABASE_URL="postgresql://andreianpilogov:***@localhost:5432/b8_scratch_p0533"
$ dropdb --if-exists b8_scratch_p0533 && createdb b8_scratch_p0533

$ DATABASE_URL="$SCRATCH_DATABASE_URL" npx node-pg-migrate up
### MIGRATION 1786029579465_baseline-schema (UP) ###
### MIGRATION 1786078316923_account-valuations (UP) ###
### MIGRATION 1786082024168_properties (UP) ###
### MIGRATION 1786136794823_net-worth-snapshots (UP) ###
### MIGRATION 1786644696767_debt-service-categories (UP) ###
### MIGRATION 1786646344365_property-transaction-attribution (UP) ###
### MIGRATION 1787871600000_tenant-held-funds (UP) ###
### MIGRATION 1788271200000_category-control-mode (UP) ###
### MIGRATION 1788505200000_alert-sends (UP) ###
Migrations complete!

$ DATABASE_URL="$SCRATCH_DATABASE_URL" npx node-pg-migrate up
No migrations to run!
Migrations complete!

$ DATABASE_URL="$SCRATCH_DATABASE_URL" npx node-pg-migrate down
### MIGRATION 1788505200000_alert-sends (DOWN) ###
Migrations complete!

$ DATABASE_URL="$SCRATCH_DATABASE_URL" npx node-pg-migrate up
### MIGRATION 1788505200000_alert-sends (UP) ###
Migrations complete!
round-trip exit=0

$ psql -Atd b8_scratch_p0533 -c "SELECT count(*) || ' migrations applied' FROM pgmigrations;"
9 migrations applied
```

Resulting shape:

```
$ psql -d b8_scratch_p0533 -c "\d alert_sends"
     Column     |           Type           | Nullable |                 Default
----------------+--------------------------+----------+-----------------------------------------
 id             | integer                  | not null | nextval('alert_sends_id_seq'::regclass)
 attempted_at   | timestamp with time zone | not null | now()
 kind           | text                     | not null |
 fingerprint    | text                     | not null |
 delivered      | boolean                  | not null |
 failure_reason | text                     |          |
Indexes:
    "alert_sends_pkey" PRIMARY KEY, btree (id)
    "idx_alert_sends_fingerprint" btree (fingerprint)
Check constraints:
    "alert_sends_delivered_failure_reason_check" CHECK (NOT delivered OR failure_reason IS NULL)
    "alert_sends_failure_reason_check" CHECK (failure_reason = ANY (ARRAY['config'::text, 'transport'::text, 'rejected'::text]))
    "alert_sends_fingerprint_check" CHECK (fingerprint ~ '^[0-9a-f]{16,}$'::text)
    "alert_sends_kind_check" CHECK (kind = ANY (ARRAY['projected-breach'::text, 'coverage'::text]))
```

### `db/schema.sql` reflects the migration — measured, not asserted

`db/schema.sql` is a hand-maintained reflection, not a `pg_dump`, so "it reflects the migration" is a
claim that can rot. It was checked by building a second empty database from `db/schema.sql` alone and
diffing the column set, constraint definitions and index definitions against the migrated one:

```
$ diff -u <migrated>.txt <from-schema.sql>.txt && echo "IDENTICAL: migration vs db/schema.sql"
IDENTICAL: migration vs db/schema.sql
```

The four CHECK constraints carry the same names in both, because the migration's explicit names match
what Postgres generates for the column-level checks written in `db/schema.sql`.

### Constraints verified by executing them, not by reading them

Twelve controls run against the migrated scratch database with **fabricated** data only. No dev-database
row was read and no real figure appears.

| # | Statement | Expected | Result |
|---|---|---|---|
| C1 | delivered row, no reason | accepted | ✅ `id 1`, `delivered t`, `failure_reason NULL` |
| C2 | failed row, `'transport'` | accepted | ✅ `id 2` |
| C3 | failed row, no reason (`NULL` = unclassified) | accepted | ✅ `id 3` — the honest fourth answer is writable |
| C4 | same fingerprint again, this time delivered | accepted | ✅ `id 4` — duplicates are the history |
| C5 | fingerprint `'Dining Out\|Travel'` | **rejected** | ✅ `alert_sends_fingerprint_check` — the naive names-joined key cannot be stored |
| C6 | fingerprint uppercase hex; fingerprint 15 chars | **rejected** (both) | ✅ `alert_sends_fingerprint_check` ×2 |
| C7 | `delivered = TRUE` with `failure_reason = 'rejected'` | **rejected** | ✅ `alert_sends_delivered_failure_reason_check` |
| C8 | `kind = 'weekly-report'` | **rejected** | ✅ `alert_sends_kind_check` — a future kind needs a migration, not a typo |
| C9 | `failure_reason` = a realistic provider transcript quoting a subject line | **rejected** | ✅ `alert_sends_failure_reason_check` — the leak path is closed at the column |
| C10 | `INSERT` omitting `delivered` | **rejected** | ✅ `null value in column "delivered" ... violates not-null constraint` |
| C11 | `INSERT ... ON CONFLICT (fingerprint) DO UPDATE` | **rejected** | ✅ `there is no unique or exclusion constraint matching the ON CONFLICT specification` — **the mutable "last sent" row is un-writable** |
| C12 | `SELECT EXISTS (SELECT 1 FROM alert_sends WHERE fingerprint = $1 AND delivered)` | `t` | ✅ the suppression read works against a fingerprint that has both a failed and a delivered row |

### Acceptance commands owned by this surface

| # | Command | Expected | Measured |
|---|---|---|---|
| 70 | `ls migrations/*_alert-sends.sql \| wc -l \| tr -d ' '` | `1` | ✅ `1` |
| 71 | `grep -ciE '\b(numeric\|money\|amount\|merchant\|balance\|category)\b' migrations/*_alert-sends.sql` | `0` | ✅ `0` — no line matches, comments included |
| 67a | `test $(grep -c 'alert_sends' db/schema.sql) -ge 1 && echo OK` | `OK` | ✅ `OK` |
| 67 | `git diff --name-only HEAD -- migrations/ db/schema.sql \| wc -l \| tr -d ' '` | `2` | ⚠️ **`1` until the migration is staged** — see the note below |

**#67 needs the migration staged, and this is a command wrinkle, not a contract defect.**
`git diff --name-only HEAD` lists tracked paths only, and a brand-new migration file is untracked, so
the command reads `1` (`db/schema.sql`) no matter how correct the migration is. Measured after
`git add -N migrations/1788505200000_alert-sends.sql`: **`2`**, both paths, as SPEC.md expects. The
index was restored afterwards, so the working tree is exactly as this task left it. Whoever runs
acceptance at G2 must `git add` the migration first — which #79's `git status --porcelain` form
already anticipates, and which is why the spec carries both.

## Forward-only history (§9.3)

- **Nothing existing was edited.** The eight files under `migrations/` that predate this task are
  byte-identical; the only new path is `1788505200000_alert-sends.sql`, whose timestamp
  (2026-09-04T07:00:00Z) is later than the previous newest, `1788271200000_category-control-mode`
  (2026-09-01T14:00:00Z).
- **Correction to the dispatch brief, measured.** The brief stated *"seven migrations are applied to
  the dev database and eight exist on disk."* `SELECT name FROM pgmigrations` against `b8_finance`
  returns **eight** — `1788271200000_category-control-mode` is applied there, not pending. The
  constraint is unaffected either way (my file is new, later, and edits nothing), but the discrepancy
  is recorded rather than smoothed over, since anyone reasoning about "which migration is next in
  dev" would be off by one.
- **`alert_sends` is `NOT PRESENT` in `b8_finance`.** Verified after the round trip. The dev database
  was read once, read-only, and never migrated.

## Backfill / data correction required

**None.** The table is created empty and has no producer until the implementer writes one. There are
no existing rows to correct, no column to backfill, and therefore no CSV backup to take first.

The `down` migration is likewise the first rollback in this repo that needs no CSV backup, and the
reasoning is written into the migration rather than left to be inferred: `BUILD.md` §9.3's standing
practice protects observations that exist nowhere else, whereas every row here records the app's own
behaviour and the table refills itself from the next attempt (the fingerprint is recomputed from the
outlook). The worst case of a rollback is one duplicate message on the first run afterwards. **That
reasoning expires** the moment a later step gives this table a second consumer — a delivery-rate
report, or the heartbeat Phase 5 step 39 owns — and the migration says so.

## Consumers checked

- **`npx tsc --noEmit` → exit 2, unchanged by this task and pre-existing.** Both errors are in
  `.next/types/cache-life.d 2.ts` and `.next/types/routes.d 2.ts` — duplicated generated files (note
  the ` 2` in the names), timestamped `Sep 3 18:04`, before this task began, and gitignored via
  `/.next/`. This task changed **no TypeScript at all**: the diff is one new `.sql` file and one
  `.sql` insertion. There is nothing here for `tsc` to have broken. Flagged for the orchestrator as a
  pre-existing tree condition worth clearing (`rm` the four `* 2.ts` files under `.next/types/`), not
  as a finding against this contract.
- **Existing SQL consumers: none affected.** `CREATE TABLE` and `CREATE INDEX` only; no existing
  relation, column, constraint, or index is touched, so no query in `app/`, `lib/`, `components/` or
  `scripts/` can change behaviour. The round trip re-applied the full history over this migration
  with no error, which is the same statement made by the database.
- **New consumers: the implementer's shell only.** Exactly two statements are expected against this
  table, and both are written into the migration's comments so the shape is not re-invented:
  - suppression — `SELECT 1 FROM alert_sends WHERE fingerprint = $1 AND delivered LIMIT 1`
  - the record — one `INSERT` per attempt, stating `delivered` explicitly, never an upsert.
- **`scripts/seed-demo.mjs` is out of scope** (SPEC.md #69) and needs no change: the table is
  legitimately empty on a demo database, and seeding a send history would fabricate evidence that
  messages were sent.

## Notes for the implementer

Specified here because they follow from the schema, not from the code — the implementer should not
have to rediscover them.

1. **`delivered` must be stated on every `INSERT`.** There is no default; an omission fails loudly.
2. **Never `ON CONFLICT`.** It will not run (C11). If you find yourself wanting it, the read you
   actually want is the suppression `SELECT`.
3. **The suppression predicate is `AND delivered`.** Written as existence-of-a-row alone, the first
   network blip silences the guardrail for the rest of the month.
4. **A configuration failure before a message exists cannot be recorded here, and that is accepted.**
   `fingerprint` is `NOT NULL`, so a row requires a computed message. If `smtpSettings(env)` throws
   before `planAlert(outlook)` has produced one, there is nothing to key the row on and the failure
   belongs in `lib/logger.ts` alone. Compute the message first if you want that outcome recorded as
   `'config'`; either order is a legitimate reading of SPEC.md and the schema does not force one.
   What the schema *does* refuse is a placeholder fingerprint invented to make the row insertable.
5. **`failure_reason` takes one of three literals or `NULL` — never the error text.** The detail goes
   to `lib/logger.ts`. If you meet a failure that fits none of the three, write `NULL` and log it;
   that path exists precisely so this constraint can never cost a cycle.
