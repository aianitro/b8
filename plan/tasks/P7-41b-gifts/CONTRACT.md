# CONTRACT — P7-41b-gifts
**Author:** contract-guardian
**Lease:** opened by the orchestrator before dispatch (2026-10-18) · closed <orchestrator records from `.claude/bin/lease`> — this role cannot run the lease script, so the exact timestamps are the orchestrator's to fill.

## Change
| File | Change | Class (§9.2) |
|---|---|---|
| `migrations/1792400000000_gifts.sql` | **New.** Three new tables: `gift_settings` (singleton; `category_id` → `budget_categories(id)` `ON DELETE SET NULL`, seeded once from the operational `Toys/Gifts/Flowers` row, NULL where it does not exist), `gifts` (giver, recipient, optional `amount NUMERIC(12,2)`, optional trimmed `merchant`, optional `account_id`, `window_start`/`window_end`/`reveal_date DATE`, `state`, `notice_at`, `created_at`, seven named CHECKs), `gift_transactions` (PK `transaction_id` → `transactions(id)` `ON DELETE CASCADE`, `gift_id` → `gifts(id)`, `prior_mapped_category`, `prior_rule_applied`, `linked_at`), and one index `gift_transactions_gift`. Reversible: the down drops the three tables. | **additive** — new tables only. No existing column is added, altered, tightened or reinterpreted. |
| `db/schema.sql` | New closing section mirroring the three tables, their constraints and the index, plus the masking predicate stated once. The seed `INSERT` is not mirrored: schema.sql holds no data, as for every earlier seed. | additive (reference file) |
| `packages/contracts/gifts.ts` | **New.** Primitives `giftAmount`, `giftDate`, `giftMerchantCriterion`; `GiftStateSchema`, `GiftErrorCodeSchema`, `GiftIdSchema`, `GiftTransactionIdSchema`; requests `GiftCreateRequestSchema`, `GiftChooseRequestSchema`; responses `GiftCandidateSchema`, `GiftSchema`, `GiftListSchema`, `GiftResponseSchema`, `GiftListResponseSchema`; types `GiftState`, `GiftErrorCode`, `GiftCreateRequest`, `GiftChooseRequest`, `GiftCandidate`, `Gift`. | additive |
| `packages/contracts/index.ts` | `export * from './gifts'`, with a comment saying why it is not in `CONTRACT_SCHEMAS`. | additive |
| `packages/contracts/categoryTransactions.ts`, `overview.ts` | **none** (see "No row marker" below) | — |

## Rationale

### Why masking lives on a link table and the reveal date, not on `transactions`
Whether a row is masked depends on who is looking. No column of `transactions` can answer that. A `masked` flag would also be a stored derived value: it would have to be cleared on the reveal date by a job, and on the day that job did not run it would go stale silently, which is the defect this role exists to prevent. The predicate is instead derived on every read, by Postgres, from the link and `reveal_date`, and it is written once in the migration and in `db/schema.sql`:

```
EXISTS (SELECT 1 FROM gift_transactions gt JOIN gifts g ON g.id = gt.gift_id
         WHERE gt.transaction_id = t.id
           AND g.reveal_date > CURRENT_DATE
           AND g.giver_user_id IS DISTINCT FROM $viewer)
```

`IS DISTINCT FROM` handles the fail-closed rule with no special case. `giver_user_id` is NOT NULL, so a NULL viewer is distinct from every giver and sees the row masked. `transactions.mapped_category`, `hidden` and every other existing column keep their meaning exactly. A gift row in the gift category is summed the way a row filed there by hand is summed, which is why totals cannot move with the viewer.

### Why the link is keyed on `transactions.id` and that column is the primary key
`plaid_transaction_id` is rewritten in place by re-identification (P6-40f) and by `npm run rekey:plaid-ids` (P6-40e). `id` is never rewritten. Making `transaction_id` the PK makes "a row is held by at most one gift" a property of the schema. It also guarantees that a LEFT JOIN from `transactions` cannot duplicate a row or inflate a sum, which is SPEC.md's double-counting failure mode. `ON DELETE CASCADE` from `transactions` makes a Plaid removal leave no dangling link and raise no FK error (S9). `gift_id` has no ON DELETE action, because gifts are never deleted and a cascade would destroy the only copy of the prior categories.

### Why a link row exists only while the gift holds the row
Without this rule, the masking predicate would need the gift's state as a third conjunct, which would be a second answer to "is this row held". With it, the rules are simple. Restoring a row (rejected candidate, release on cancel, expiry at reveal) also deletes its link, in the same transaction. A matched gift keeps its link after the reveal, harmlessly, because the date unmasks it. If a bug leaves a link behind, the row stays masked; it does not leak.

### Why the gift category is a singleton table with a nullable id
SPEC.md requires the designation to be by `budget_categories.id`, never by name, and requires the category's delete and rename behaviour to stay unchanged. A boolean on `budget_categories` would need a partial unique index to say "at most one", and it would let two writers set it on two rows. A one-row table (`singleton BOOLEAN PRIMARY KEY CHECK (singleton)`) says "at most one" structurally. `ON DELETE SET NULL` means a category delete behaves exactly as it does today. A NO ACTION FK would have started refusing the delete, which would be a behaviour change. After a delete, the designation reads "unset". Rows already linked stay linked and masked where they are (S14), and new gifts are refused with `GIFT_CATEGORY_UNSET` (G10). The row always exists after the migration, so "unset" has one spelling: `category_id IS NULL`. It never means "row missing".

### Why the merchant criterion is stored trimmed
The matcher compares the trimmed, case-insensitive criterion. If the trimmed form is the only one that can be stored, the matcher has no trim to forget. The CHECK spells out its trim set (`E' \t\n\r\f\x0B'`) for two reasons. First, `btrim`'s default trims spaces only, so a criterion made of three tabs would otherwise pass. Second, `\x0B` stands in for vertical tab because Postgres E-strings have no `\v`: that escape would quietly mean the letter `v`, and the trim would eat a criterion's leading and trailing `v`s. Every character in the set is also trimmed by JavaScript's `String.prototype.trim`. So any string the handler trims satisfies the CHECK, and the CHECK can never refuse what the schema accepted.

### Why `unmatched` requires `notice_at`
SPEC.md has two ways to reach "nothing matched": the window-end sweep (Q4) and expiry at the reveal date (L3). Both tell the giver once. Making `state = 'unmatched'` imply `notice_at IS NOT NULL` turns "the giver was told" into a fact the row cannot lose. The CHECK is one-directional because a `choose` gift is told at window end and stays `choose` until the giver picks (L1 is due for both states).

### Why the contract objects are strict, and why there is no masked gift shape
Each gift object is authored by this app at both ends, which is P7-41a's argument. A stray `state` or `giverUserId` on a create request must be refused. There is no masked variant of a gift because a non-giver never receives a gift object at all (SPEC.md "Existence is not visible"). Masking applies to transaction rows on the other surfaces.

### No row marker
SPEC.md allows "at most an optional marker" on `CategoryTransactionSchema` and the overview row shapes. None is added. The masked projection needs no new field. It is `label: 'Gift'` with `merchant: null`, `note: null` and `watched: false`, all of which those shapes already admit. A marker such as `gift: true` would have two problems:
1. It would be one more field the masked projection must get right for every viewer. P2's exact-key-set test would then have to include it.
2. For the giver it would answer a question no consumer in this task asks.

Adding one later is an additive change.

## Domain invariants preserved
- **Derived, not stored:** no "current", "latest", "masked" or "revealed" column exists. `revealed` in `GiftSchema` is computed by Postgres in the read (`reveal_date <= CURRENT_DATE`) and stored nowhere. `gifts.state` is a stored fact about a decision (what matched, what the giver chose or cancelled), not a value derivable from other rows. `notice_at` records an event. Observation tables are untouched.
- **Money:** `gifts.amount NUMERIC(12,2)`, the scale of `transactions.amount`, so the match is exact decimal equality in SQL. `giftAmount` is a decimal string with at most two fraction digits and at most ten integer digits (the column's capacity). It is never a JS number and never rounded. Candidate amounts are `moneyString`, byte-identical to `amount::text`. No other money column is added.
- **Null semantics:** `amount`, `merchant` and `account_id` NULL mean ANY. `0` is refused (`gifts_amount_positive`) and `''` is refused (`gifts_merchant_criterion`), so neither can stand in for "any". `notice_at` NULL means not told, a stated departure like `auth_sessions.revoked_at`. `gift_settings.category_id` NULL means no category is designated. `gift_transactions.prior_mapped_category` NULL is a real prior value (uncategorised), not unknown. `candidates` is `[]` when empty, never null. A NULL viewer is a non-giver, structurally, through `IS DISTINCT FROM`.
- **Inheritance:** no new column inherits. A masked row's effective property is still `COALESCE(t.property_id, a.property_id)`, unchanged.

## Migration
The orchestrator runs these. This role has no Bash, so nothing below is reported as green.

```
export DATABASE_URL=postgresql://localhost/b8_p41b_throwaway
psql "$DATABASE_URL" -tAc "select current_database()"     # b8_p41b_throwaway
npm run migrate:up && npm run migrate:down && npm run migrate:up
```
Then run SPEC.md acceptance #10 verbatim. Expected: `Migrations complete!` three times, `1`, and no output.

**Ordering check I could not make.** I cannot list `migrations/`. I chose `1792400000000` as the next step after `1792300000000`, the head SPEC.md and the task name. If any committed migration has a later timestamp, the file must be renamed above it before G1 passes. Renaming an uncommitted file is not an edit of a committed migration.

Controls worth running against `$U` while migrated up (fabricated values only; `<U1>` and `<U2>` are two `users` ids, `<A>` an account id):

| # | Statement | Expected |
|---|---|---|
| C1 | `SELECT count(*), count(category_id) FROM gift_settings` on a fresh DB | `1 0` (seed found no category) |
| C2 | `INSERT INTO gift_settings VALUES (FALSE, NULL)` | rejected: `gift_settings_singleton` |
| C3 | `INSERT INTO gifts (giver_user_id, recipient_user_id, window_start, window_end, reveal_date) VALUES (<U1>, <U2>, '2026-11-01', '2026-11-10', '2026-12-01')` | rejected: `gifts_has_criterion` |
| C4 | same with `amount = 0` | rejected: `gifts_amount_positive` |
| C5 | same with `merchant = 'ab'`, then `'  abc'`, then `E'\t\t\t'` | each rejected: `gifts_merchant_criterion` |
| C6 | same with `merchant = 'vvv'` | accepted (the trim set does not contain the letter v) |
| C7 | same with `recipient_user_id = <U1>` | rejected: `gifts_giver_not_recipient` |
| C8 | same with `window_end = '2026-10-31'` | rejected: `gifts_window_ordered` |
| C9 | same with `reveal_date = '2026-10-31'` | rejected: `gifts_reveal_not_before_window` |
| C10 | a valid gift, then `UPDATE gifts SET state = 'unmatched'` with `notice_at` NULL | rejected: `gifts_unmatched_was_told` |
| C11 | two `gift_transactions` rows for one `transaction_id` | rejected: primary key |
| C12 | `DELETE FROM transactions WHERE id = <linked>` | succeeds; its link row is gone |
| C13 | `DELETE FROM budget_categories WHERE id = (SELECT category_id FROM gift_settings)` after designating one | succeeds; `category_id` reads NULL |

## Backfill / data correction required
None. The only data the migration writes is the one `gift_settings` row. Its only input is a read of `budget_categories`, which it does not change. No existing row is touched.

Rollback is the data-bearing direction, as SPEC.md's Rollback says, and **rolling back is a privacy event**. Before `migrate:down` on any database that has applied this migration, back up outside the repo:

```
mkdir -p ~/b8-backups/p41b && cd ~/b8-backups/p41b
for t in gifts gift_transactions gift_settings; do
  psql "$REAL_DATABASE_URL" -c "\copy (select * from $t) to '$t.csv' csv header"
done
```
Record row counts only in EVIDENCE.md. Candidates of a gift still in `choose` stay in the gift category after the down. Restore their `mapped_category` and `rule_applied` by hand from `gift_transactions.csv`.

## Consumers checked
- `npx tsc --noEmit` → **not run by this role.** Expected exit 0: every addition is new, and no existing schema or column changed. Compile risks are mine to fix if tsc reports them: chained `.refine` on `z.strictObject` (zod 4), `z.int().positive()`, and the `?? 0` guard on the month-length lookup (in case `noUncheckedIndexedAccess` is on).
- **Name collisions through `export *`.** Every new export starts with `gift` or `Gift`, and nothing in `exact`, `representation`, `enums`, `shapes` or `envelope` does, as far as I read them. `gifts.ts` imports `./auth` and `./overview`, and neither is re-exported, so the barrel gains no names from them.
- **`packages/contracts/index.test.ts`** compares `CONTRACT_SCHEMAS` against `types.ts`. Gifts are not added to that map, so the fixture is unaffected.
- **W9 / #8 on the contract file.** Its path contains `gifts`, so I assumed the wiring scans may reach it. It contains no Date construction or clock read, no ISO-string slicing, no float parsing, no rounding call, no multiplication, no `log.` or `console.` call, no money-looking figure and not the gift category's literal name. The date check uses integer arithmetic on the string's fields.
- **Readers unaffected:** no existing query changes meaning. Every masked surface is the implementer's to wire to the predicate above.

## Handed to the implementer
1. **Insert and link in one transaction, before commit** (S2). The sync's INSERT of a qualifying row, the UPDATE that files it in the gift category with `rule_applied = FALSE`, and the INSERT into `gift_transactions` with the row's prior `mapped_category` and `rule_applied` must all commit together. The prior values are what the row held immediately after its own insert, with rules applied.
2. **The gift category's name** is `SELECT bc.name FROM gift_settings gs JOIN budget_categories bc ON bc.id = gs.category_id`, read at match time. No row means no designated category: link and mask anyway, leave the category alone, and log a count only.
3. **Choosing a row, cancelling and expiring are each one transaction.** Lock the gift row first (`SELECT … FOR UPDATE`). For each row being released, set `mapped_category = prior_mapped_category` and `rule_applied = prior_rule_applied`, then DELETE its link. Then set the state. `unmatched` must be written together with `notice_at` (or with `notice_at` already set), or `gifts_unmatched_was_told` refuses it.
4. **Merchant:** store `merchant.trim()`. The schema accepts surrounding whitespace and the column refuses it. Match it as a literal: use `position(lower($c) IN lower(coalesce(t.merchant_name, t.name))) > 0` or an equivalent. Never use `LIKE` or `~` with the raw criterion.
5. **Dates out:** cast `window_start::text`, `window_end::text` and `reveal_date::text`, and the candidate's `t.date::text`. Compute `revealed` as `(g.reveal_date <= CURRENT_DATE)` in the same SELECT. `amount::text` for both the gift amount and candidate amounts.
6. **`candidates` order:** `ORDER BY gt.transaction_id`. List order: `ORDER BY g.created_at DESC, g.id DESC`. Competition between gifts: `ORDER BY g.created_at, g.id`.
7. **A Plaid removal** cascades the link away. In the same sync pass, return a gift left holding no row from `matched` to `awaiting`. Doing the same for `choose` is consistent with `GiftSchema`'s rule that `choose` holds at least one row.
8. **Account criterion:** refuse at creation (`INVALID_INPUT`) when `accounts.access_token IS NULL`. The schema cannot see this.

## Spec ambiguities resolved here
- **Contract path.** SPEC.md names `packages/contracts/`, and the role file names `shared/contracts/`. The contracts moved in P1-10a, so `packages/contracts/gifts.ts` is the new file. GATES.md records that the hook guards only the old path.
- **Where "the designation" lives:** a singleton table, nullable `category_id`, `ON DELETE SET NULL` (Rationale above). SPEC.md says only "by `budget_categories.id`… resolving to NULL".
- **Link lifetime:** a link exists only while the gift holds the row. Rejected, released and expired rows are unlinked. SPEC.md says the record "holds the row's prior category" but not for how long.
- **Merchant storage and bound:** stored trimmed. Max 200 characters is my call, matching `transactions.note`, a human-typed string. SPEC.md sets no upper bound, and an unbounded criterion buys nothing.
- **Amount bound:** at most ten integer digits, the capacity of `NUMERIC(12,2)`. Leading zeros are refused so the stored value has one spelling.
- **Reveal inside the window:** allowed. SPEC.md refuses only reveal before window start (M12). L3 covers a gift unresolved at its reveal date.
- **`unmatched` implies `notice_at`:** added as a CHECK, because both paths to `unmatched` tell the giver once (Q4, L3).
- **Account FK delete action:** none (refuse). SET NULL would turn "this card" into "any card". CASCADE would delete the giver's gift silently. Account deletes elsewhere are already refused while any transaction references the account.
- **Absent vs. null criteria in the request:** both mean "any". A strict object refuses unknown keys, not absent optional ones.
- **`recipientUserId` optional:** absent means the one other live user (G4).
- **Response fields SPEC.md does not pin,** added as my call: `recipientDisplayName` (the page names the recipient), `accountName`, `revealed` (so no consumer compares dates against a JS clock), `createdAt`, and `candidates[].accountId` / `accountName` / `label`.
- **`candidates` for a matched gift:** exactly the matched row. SPEC.md names only the empty case.
- **Cancel body:** none, and any body is ignored. So no schema exists for it.
- **`GIFT_LOCKED` status:** 409, the same status as the other state conflicts. SPEC.md fixes the code and requires the same status for every refused field, but not the number.
