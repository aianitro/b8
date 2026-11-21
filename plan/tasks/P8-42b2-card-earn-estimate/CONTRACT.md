# CONTRACT — P8-42b2-card-earn-estimate
**Author:** contract-guardian
**Lease:** opened 2026-11-20 by the orchestrator · closed by the orchestrator at G1

## Change
| File | Change | Class (§9.2) |
|---|---|---|
| `migrations/1792900000000_loyalty_earn_rules.sql` (new) | `ALTER TABLE loyalty_memberships` adds one nullable column `earn_base_rate NUMERIC(7,4)` with CHECK `loyalty_memberships_earn_base_rate_range` (NULL or between zero and one hundred inclusive), no DEFAULT. Creates `loyalty_earn_rules` with exactly `id SERIAL PRIMARY KEY`, `membership_id INTEGER NOT NULL REFERENCES loyalty_memberships(id) ON DELETE CASCADE`, `position INTEGER NOT NULL`, `match_kind TEXT NOT NULL` (CHECK in `category`, `merchant`), `match_text TEXT NOT NULL` (CHECK stored trimmed and 1 to 100 characters), `rate NUMERIC(7,4) NOT NULL` (CHECK zero to one hundred inclusive), and `CONSTRAINT loyalty_earn_rules_membership_position_key UNIQUE (membership_id, position)`. A real Down Migration that drops the table and the column, and nothing else. | additive |
| `db/schema.sql` | Mirrors the migration: `earn_base_rate` with its CHECK inside the `CREATE TABLE loyalty_memberships` block (plus its line in the block's header comment and a "no derived earn column" note), and a new `CREATE TABLE loyalty_earn_rules` block after the one-card index. | additive |
| `packages/contracts/loyalty.ts` | New constants `LOYALTY_EARN_MATCH_KINDS`, `LOYALTY_EARN_BASES`, `LOYALTY_EARN_UNITS`, `LOYALTY_EARN_MAX_RULES` (20), `LOYALTY_EARN_MAX_RATE` (100), `LOYALTY_EARN_FALLBACK_DAYS` (30), `LOYALTY_EARN_MISS_PERCENT` (25), `LOYALTY_EARN_CATEGORY_MATCH_MAX_CHARS` (100), `LOYALTY_EARN_MERCHANT_MATCH_MAX_CHARS` (60). New schemas `LoyaltyEarnMatchKindSchema`, `LoyaltyEarnBasisSchema`, `LoyaltyEarnUnitSchema`, `LoyaltyEarnRateInputSchema`, `LoyaltyEarnRuleInputSchema`, `LoyaltyEarnInputSchema`, `LoyaltyEarnRateSchema`, `LoyaltyEarnRuleSchema`, `LoyaltyEarnSchema`, `LoyaltyEarnEstimateSchema`, `LoyaltyEarnComparisonSchema`, their inferred types, and three pure helpers `isEarnRateText`, `isEarnFigureForUnit`, `isEarnMiss`. `LoyaltyMembershipPatchRequestSchema` gains optional `earn` (`LoyaltyEarnInputSchema` or `null`). `LoyaltyMembershipSchema` gains required, nullable `earn`, `earnEstimate`, `earnComparison` and two refinements. `LoyaltyMembershipCreateRequestSchema` and `LoyaltyErrorCodeSchema` are unchanged. No new `*ResponseSchema` export (T42a-U7 counts six). | additive |

`packages/contracts/loyalty.test.ts` is not touched by the guardian. `T42b2-U1` to `T42b2-U3` and the `membership()` fixture keys are the implementer's (SPEC.md "Prerequisites the implementer must create").

## Rationale

**A column and a table, not a JSON column (SPEC.md Open question 1, default kept).** Each rule needs a CHECKed kind, a bounded rate and a bounded, trimmed text. A JSON array would move all three checks into application code and would hide from command #5 what the column holds. `UNIQUE (membership_id, position)` makes the match order total: "first match wins" has exactly one answer, and a second rule at a taken position is 23505. That constraint's index also serves "this membership's rules, in order", so no second index is added.

**The base rate is a column on the membership, not a rule row.** There is exactly one per description, and its NULL is the single spelling of "no earn description stored". The route's replace writes the base rate and the rules in one transaction, so a NULL base rate never coexists with rule rows through the routes. That pairing is not a database constraint: a CHECK cannot see another table, and the only writer is the one PATCH path.

**The rules belong to the membership, not to the card link.** Unlinking a card sets only `card_account_id` to NULL; the base rate and the rules stay, inert, exactly as the benefit does. `ON DELETE CASCADE` from the membership because a rule cannot outlive what it describes and nothing references a rule. The existing `ON DELETE SET NULL` on `card_account_id` is untouched, so deleting an account still succeeds and leaves the description.

**Rates are `NUMERIC(7,4)`, decimal text end to end.** Four decimals is the precision the API accepts; the request schema refuses a fifth digit rather than letting the typmod round it silently. The bounds are zero to `LOYALTY_EARN_MAX_RATE` inclusive in both the CHECKs and the contract. Zero is valid and means "earns nothing", which is how a category is neutralised. The emitted form is the column's `::text`, exactly four decimals. A rate has no unit of its own: it is units of the estimate's unit per one currency unit of spend.

**`match_text` bound in the table is the one both kinds share (1 to 100, trimmed).** The tighter merchant limits (at most 60 characters; letters, digits, space, `&`, `'`, `-`; starts with a letter or digit) are the request schema's. Putting a Unicode character-class CHECK in Postgres would risk disagreeing with the JavaScript pattern on some letter, and a disagreement there is a 500 on a body the contract accepted. The matcher compares literally whatever the text holds, so the table bound is sufficient for correctness; the charset is defence for any future matcher.

**Nothing derived is stored.** No estimate, comparison, miss mark, spend figure, period or last-compared date exists as a column, under any name. The estimate is computed on every read from the ledger (through the gift read path), the rules, the current reading and `CURRENT_DATE`; the comparison from the two latest readings on different dates. Any stored copy would go stale on the next sync, reading or rule edit. Consequence, intended: editing a rule changes the derived figures for past windows on the next read (Open question 15). Command #5 asserts the exact column lists.

**Rule input is a discriminated union on `kind`.** The kind decides the text rule, so the union expresses it with no cross-field refinement; an unknown kind and a stray key are refused by construction.

**Duplicate rules are refused at the schema.** Two rules with the same kind and the same text as the matcher compares it (trimmed and case-folded; a merchant phrase also whitespace-collapsed) can never both apply first, so the second is dead configuration. The key mirrors the matcher's normalisation, which is slightly broader than "same case-folded match": two merchant texts differing only in internal space runs are also duplicates, because the matcher collapses them. No database constraint backs this (case-folding in SQL and in JavaScript can differ on rare characters, and a dead rule is harmless, not corrupt).

**The response refinements, exactly the spec's (Conventions, "Response shape").**
- `earnEstimate` non-null implies `cardAccountId` non-null and `earn` non-null. Same for `earnComparison`.
- `earnEstimate.amount`, `earnComparison.estimated` and `.actual` are canonical signed decimal text for the unit: whole units with no leading zero and no decimal point, `usd` with exactly two decimals; the plain zero only, never a negative zero.
- `differencePercent` is signed text with exactly one decimal, plain zero only, and is null exactly when `estimated` is zero.
- `from` is strictly before `to`.
- `worthALook` equals the miss rule, decided by `isEarnMiss` in exact integer arithmetic on the emitted figures in minor units (BigInt, built with `BigInt(…)` because the compile target is below the one that allows bigint literals), never on the rounded percentage and never through a JS float.
- `unit` on both objects excludes `nights`, so a nights estimate cannot be emitted as a figure.

**Refinements deliberately not added.** The contract does not check that `differencePercent`'s value is the correctly rounded quotient, that `earnEstimate.unit` equals the membership's `unit`, or that `earnComparison.to` equals `asOf`. Each is true of a correct producer, but the spec enumerates the refinements and `T42b2-U2` builds fixtures from the shared `membership()` helper (unit `points`) while exercising every unit's spellings; extra cross-field rules would make those spec-mandated cases unparseable. The integration tests pin the values instead.

**Merchant pattern built with `new RegExp(…, 'u')`.** The repository's compile target is ES2017; a literal with Unicode property escapes depends on the checker's target handling. The constructor form is identical at runtime and target-independent.

## Fields

### `LoyaltyMembershipPatchRequestSchema` (request, `PATCH /api/v1/loyalty/memberships/[id]`)
| Field | Type | Meaning |
|---|---|---|
| `earn` | optional; `LoyaltyEarnInputSchema` or `null` | The COMPLETE earn description, replacing the stored one in one transaction, or nothing. `null` deletes every rule and nulls the base rate. Accepted on an unlinked membership. |
| `earn.baseRate` | rate text, required | One to three integer digits, optionally a point and one to four digits, at most `LOYALTY_EARN_MAX_RATE`. A JSON number, a sign, an exponent, a separator, a surrounding space or a fifth decimal is refused. |
| `earn.rules` | array, required, 0 to `LOYALTY_EARN_MAX_RULES` | Array order is the stored `position` order and the match order. No two with the same kind and normalised text. |
| `earn.rules[].kind` | `category` · `merchant` | |
| `earn.rules[].match` | string | `category`: not blank, at most 100 characters once trimmed, any characters (compared literally). `merchant`: once trimmed, 1 to 60 characters, starts with a letter or digit, only letters, digits, spaces, `&`, `'`, `-`. Stored trimmed. Never echoed in an error. |
| `earn.rules[].rate` | rate text | As `baseRate`. |

The body is still strict and still refuses `{}`. `LoyaltyMembershipCreateRequestSchema` still refuses `earn`.

### `LoyaltyMembershipSchema` (response; every route that returns a membership)
| Field | Type | Meaning |
|---|---|---|
| `earn` | `{baseRate, rules}` or `null` | The stored description; null when none is stored. Kept across an unlink. |
| `earn.baseRate`, `earn.rules[].rate` | rate text, exactly four decimals | The `NUMERIC(7,4)` column's `::text`. |
| `earn.rules[]` | `{kind, match, rate}` | In stored order. `match` is the trimmed stored text. |
| `earnEstimate` | `{since, basis, unit, amount}` or `null` | Null when no card is linked, `earn` is null, or the unit is `nights`. |
| `earnEstimate.since` | `YYYY-MM-DD` | Exclusive start: the current reading's as-of, or `CURRENT_DATE` minus `LOYALTY_EARN_FALLBACK_DAYS`. Postgres `::text`. |
| `earnEstimate.basis` | `reading` · `last_30_days` | |
| `earnEstimate.unit` | `points` · `miles` · `usd` | The current reading's unit, or the program's default unit with no reading. |
| `earnEstimate.amount` | signed canonical decimal text | Rounded once, half away from zero, to the unit's scale. |
| `earnComparison` | `{from, to, unit, estimated, actual, differencePercent, worthALook}` or `null` | Null in every `earnEstimate` null case, and when fewer than two readings exist on different as-of dates or the latest two differ in unit. |
| `earnComparison.from`, `.to` | `YYYY-MM-DD`, `from < to` | The previous and current readings' as-of dates. |
| `earnComparison.estimated`, `.actual` | signed canonical decimal text | `actual` is current minus previous balance, exact. |
| `earnComparison.differencePercent` | signed text with one decimal, or `null` | Null exactly when `estimated` is zero. |
| `earnComparison.worthALook` | boolean | Exactly `isEarnMiss(estimated, actual)`. |

Key sets are exact (strict objects), as `T42b2-I8` asserts. No spend amount, row, merchant or per-rule breakdown key can be carried.

## Domain invariants preserved
- **Derived, not stored.** The schema gains exactly `earn_base_rate` and `loyalty_earn_rules`, both configuration. Reads write nothing.
- **Money.** No money column is added. Rates are `NUMERIC(7,4)`, never float. Spend is compared and multiplied only in SQL, in `NUMERIC`, and only the priced total leaves the database.
- **Null semantics.** `earn_base_rate` NULL means "no earn description", never zero. `earnEstimate` and `earnComparison` null mean "no figure", never zero; a genuine zero is the plain `0` or two-decimal zero.
- **Inheritance.** None. `earn_base_rate` is not resolved through anything by COALESCE; the comments say so.
- **One definition.** The units reuse the existing vocabulary minus `nights`; the date validator is the existing `giftDate` import; the trimmed-name rule is the existing `typedName`; each bound is one constant.

## Migration
```
npm run migrate:up && npm run migrate:down && npm run migrate:up
```
Not run by the guardian: this role has no shell. The orchestrator runs acceptance commands #4 and #5 against `b8_p42a_throwaway` at G1. Expected: `OK migration up-down-up` and `OK schema`. See "Spec defect raised" below for command #5.

**The down is not lossless for the earn description.** It discards every base rate and every rule typed while the change was live. **The card link (`card_account_id`), the three benefit columns, the one-card index and every instrument survive a down.** The down drops only the table and the column. Back up first:

```
\copy (SELECT id, earn_base_rate FROM loyalty_memberships WHERE earn_base_rate IS NOT NULL ORDER BY id) TO 'backup-loyalty_earn_base.csv' CSV HEADER
\copy (SELECT membership_id, position, match_kind, match_text, rate FROM loyalty_earn_rules ORDER BY membership_id, position) TO 'backup-loyalty_earn_rules.csv' CSV HEADER
```

A restore re-runs `migrate:up` and loads both files back by membership id and position. Revert the application code before the down, so nothing queries a missing column or table.

## Spec defect raised (for the orchestrator, not absorbed)
Command #5's line `SELECT count(*) FROM pg_indexes WHERE tablename='loyalty_earn_rules' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%(membership_id, position)%'` is expected to return `0`, not `1`, against this (spec-conformant) table. `position` is a Postgres keyword of category COL_NAME_KEYWORD, and `pg_get_indexdef` quotes every keyword that is not unreserved, so `indexdef` reads `… USING btree (membership_id, "position")`. The column name is fixed by commands #4 and #5, so the schema cannot avoid it. Not verified by the guardian (no shell). Suggested amendment: match `indexdef ~* '\(membership_id, "?position"?\)'`, or count `pg_constraint` rows with `contype='u'` on `loyalty_earn_rules` whose `conkey` is the two columns.

## Backfill / data correction required
- None. `earn_base_rate` starts NULL on every existing membership ("no earn description") and `loyalty_earn_rules` starts empty, so the unique constraint and the CHECKs cannot fail on existing data.

## Consumers that must change (implementer)
`LoyaltyMembershipSchema` gains three required keys. Every producer and every fixture that builds a membership must change, or `tsc` and the strict parse fail:
- `apps/web/lib/loyaltyStore.ts` (and any `apps/web/lib/loyalty*.ts` or `apps/web/lib/domain/loyalty*.ts` it uses): select `earn_base_rate::text` and the rules (`rate::text`, ascending `position`); derive `earnEstimate` and `earnComparison` in SQL through `visibleTransactions(null)` in `apps/web/lib/giftReadPath.ts`, never a raw `FROM transactions`; the PATCH path replaces the base rate and the rules in one transaction (or applies nothing) and `earn: null` deletes the rules and nulls the base rate in one transaction. A 23514 or 23505 from these constraints on a body the contract accepted is a handler bug; map it to 400 `INVALID_INPUT`, never a 500, and never echo a match text. No new error code.
- The four routes returning a membership: `app/api/v1/loyalty/route.ts`, `app/api/v1/loyalty/memberships/route.ts`, `app/api/v1/loyalty/memberships/[id]/route.ts`, `app/api/v1/loyalty/memberships/[id]/observations/route.ts`. No new route file.
- `apps/web/app/travel/page.tsx` and the `apps/web/components/Loyalty*` / `Travel*` / `AccountEarns*` components that render a membership (estimate lines, `Set earn rates`, `Clear earn rates`).
- `apps/web/app/accounts/[id]/page.tsx` for the lines under "Earns into".
- `apps/web/scripts/gifts-surface-check.mjs`: step H13.
- Fixtures: `packages/contracts/loyalty.test.ts` (`membership()` gains the three keys with `null`), `apps/web/app/api/v1/loyalty/loyaltyCard.test.ts` (`T42b-I9`'s exact key set gains the three quoted names), and any membership fixture in `apps/web/app/api/v1/loyalty/loyalty.test.ts`, per command #14's allowance.
- `apps/web/scripts/import-loyalty.ts`: no change expected. Memberships it creates have no earn description, and the new column is nullable with no default. If it parses a `LoyaltyMembershipSchema` response anywhere, that is a conflict to raise, not absorb.

## Consumers checked
- `npx tsc --noEmit`: not run by the guardian (no shell). The orchestrator runs it at G1. It is expected to fail until the implementer updates the producers and fixtures above, because the new response keys are required.
- New exports are `Loyalty`- or `LOYALTY_`-prefixed except the three helpers `isEarnRateText`, `isEarnFigureForUnit`, `isEarnMiss`, named in the style of the existing `isBalanceForUnit`; `export *` from `packages/contracts/index.ts` should be checked for a collision by `tsc`. No new import: the file still depends only on `zod`, `./envelope`, `./auth` and `./gifts`.
- No new `*ResponseSchema` export, so `T42a-U7`'s count of six holds; no new key named `memberNumber`.
- Ledger, net worth, gifts, receipts, `accounts`, `transactions`, the fee watch: no table, column, constraint or schema changed.
