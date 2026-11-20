# CONTRACT — P8-42b-card-annual-instruments
**Author:** contract-guardian
**Lease:** opened 2026-11-20 by the orchestrator · closed by the orchestrator at G1

## Change
| File | Change | Class (§9.2) |
|---|---|---|
| `migrations/1792800000000_loyalty_card_benefit.sql` (new) | `ALTER TABLE loyalty_memberships` adds three nullable columns: `benefit_kind TEXT` (CHECK: NULL or one of `free_night`, `companion_fare`, `travel_credit`, `other`), `benefit_description TEXT` (CHECK: NULL or stored trimmed and 1 to 200 characters), `benefit_window_days INTEGER` (CHECK: NULL or 1 to 365). Table CHECK `loyalty_memberships_benefit_complete`: the three are NULL together or set together. Partial unique index `loyalty_memberships_one_per_card ON loyalty_memberships (card_account_id) WHERE card_account_id IS NOT NULL`. No column DEFAULT. A real Down Migration that drops the index, the table CHECK and the three columns, and nothing else. | additive |
| `db/schema.sql` | Mirrors the migration inside the `CREATE TABLE loyalty_memberships` block (three columns with their CHECKs, the completeness CHECK) and adds the unique index after it. The stale comment that called `card_account_id` reserved and always NULL is replaced by its 42b meaning. | additive |
| `packages/contracts/loyalty.ts` | New constants `LOYALTY_FEE_WATCH_STATES`, `LOYALTY_BENEFIT_WINDOW_MIN_DAYS`, `LOYALTY_BENEFIT_WINDOW_MAX_DAYS`, `LOYALTY_BENEFIT_DEFAULT_WINDOW_DAYS`. New schemas `LoyaltyFeeWatchStateSchema`, `LoyaltyBenefitWindowDaysSchema`, `LoyaltyBenefitInputSchema`, `LoyaltyBenefitSchema`, `LoyaltyFeeWatchSchema`, `LoyaltyCardAccountSchema`, and their inferred types. `LoyaltyMembershipPatchRequestSchema` gains optional `cardAccountId` and `benefit`. `LoyaltyMembershipSchema` gains required nullable `cardAccountId`, `cardAccountName`, `benefit`, `feeWatch` with three refinements. `LoyaltyOverviewSchema` gains required `cardAccounts`. `LoyaltyErrorCodeSchema` gains `CARD_ALREADY_LINKED`. `LoyaltyMembershipCreateRequestSchema` is unchanged in shape; its comment no longer calls the column reserved. | additive |

`packages/contracts/loyalty.test.ts` is not touched by the guardian. `T42b-U1` to `T42b-U3` and the fixture keys are the implementer's (SPEC.md "Prerequisites the implementer must create").

## Rationale

**Three columns on `loyalty_memberships`, not a table.** The benefit is described once per link, and a membership has at most one card (the column is single). A one-to-one table would add a join and a missing-row failure mode for no gain. The column names are fixed by the spec because acceptance commands #4 and #5 query them.

**All or nothing.** A kind with no description cannot be shown. A window with no kind has nothing to wait for. So the three columns are NULL together or set together, and "no benefit" has one spelling. The CHECK makes a half-described benefit a 23514, not a state every reader must handle.

**No column DEFAULT for the window.** `ADD COLUMN … DEFAULT` would fill every existing row, giving a window to memberships that describe no benefit and violating the completeness CHECK. The default lives in one place, `LOYALTY_BENEFIT_DEFAULT_WINDOW_DAYS` in the contract. The PATCH handler writes it when a `benefit` arrives without `windowDays`. The response always carries a `windowDays`.

**The window is an integer of days.** `date + integer` in Postgres is calendar arithmetic with no time of day, so no zone or daylight-saving hour can move `expectedBy`. The range is 1 to 365. Zero would make every fee overdue the next day. More than a year would overlap the next year's fee.

**The benefit kind uses the instrument vocabulary.** "Received" means an instrument of the benefit's kind on this membership. A kind no instrument can carry could never be received and would read as overdue forever. A new instrument kind must be added to both CHECKs and to `LOYALTY_INSTRUMENT_KINDS` together.

**One card, one membership, decided by the index.** One annual-fee row linked to two memberships would open two expectations for one charge. The partial unique index makes a second link a 23505. The route maps that to 409 `CARD_ALREADY_LINKED`, so a lost race is never a 500. Every existing `card_account_id` is NULL (no 42a path set it), so building the index cannot fail on existing data.

**Credit type is the route's check, not the database's.** A CHECK cannot read `accounts`. A trigger on `loyalty_memberships` would not see a later change of the account's own type, so it would promise more than it keeps. The PATCH handler refuses an unknown or non-`credit` account with 400 `INVALID_INPUT`. `cardAccounts` offers only `credit` accounts.

**The benefit is not tied to the card.** Unlinking sets only `card_account_id` to NULL; instruments and the benefit stay (SPEC.md Open question 8). `ON DELETE SET NULL` on the existing foreign key does the same when an account is deleted. A CHECK tying the benefit to the card would make that delete fail.

**Nothing derived is stored.** No fee amount, fee date, expected-by date or state exists as a column, under any name. The fee is the most recent unrefunded annual-fee ledger row, read through the gift read path. The state comes from that row, the instruments and `CURRENT_DATE`, on every read. A stored copy would go stale the moment a row synced, was refunded, or an instrument was recorded. Acceptance command #5 asserts the exact column lists.

**`feeWatch` cannot contradict itself.** Three refinements on `LoyaltyFeeWatchSchema`, exactly as the spec's Conventions state them:
- `state` null implies `expectedBy` null.
- `no_fee_seen` implies `feeDate` and `expectedBy` both null.
- `awaiting`, `received` and `overdue` imply both dates present.

The strict object refuses an `amount` key. The fee amount has no field anywhere in this contract (SPEC.md Open question 9).

**Membership-level refinements (guardian's decision, from the spec's Null semantics and State rule).** `LoyaltyMembershipSchema` also refuses:
- `cardAccountId` and `cardAccountName` not null together.
- `feeWatch` null while a card is linked, or present while none is. A linked card always has a `feeWatch` object, all-null when it has no benefit and no fee.
- With a `feeWatch` present, `state` null while a `benefit` is described, or a `state` while none is.

These come straight from the spec's rules: "a linked card with no benefit has `state: null`", "a membership with no card has `feeWatch: null`", and "for a linked card with a benefit described, the state is exactly one of" the four. **Implementer note for `T42b-U2`:** a membership fixture that exercises the four states must carry a non-null `benefit`, a non-null `cardAccountId` and `cardAccountName`. A fixture with `state: null` and a non-null `feeDate` must carry `benefit: null`. Bare `feeWatch` objects can be tested directly against `LoyaltyFeeWatchSchema`.

## Fields

### `LoyaltyMembershipPatchRequestSchema` (request, `PATCH /api/v1/loyalty/memberships/[id]`)
| Field | Type | Meaning |
|---|---|---|
| `cardAccountId` | optional; non-empty string or `null` | Link this credit account; `null` unlinks. Unknown or non-`credit` account: 400 `INVALID_INPUT`. Held by another membership: 409 `CARD_ALREADY_LINKED`. Same card again: 200, no change. |
| `benefit` | optional; `LoyaltyBenefitInputSchema` or `null` | Describe the annual benefit; `null` sets all three columns to NULL. Accepted on an unlinked membership. |
| `benefit.kind` | one of the four instrument kinds | |
| `benefit.description` | string, not blank, at most 200 characters once trimmed | Stored trimmed. Never echoed in an error body. |
| `benefit.windowDays` | optional integer 1 to 365 | Absent: the handler stores `LOYALTY_BENEFIT_DEFAULT_WINDOW_DAYS`. A float, a string or a value out of range is refused. |

The body is still strict and still refuses `{}`.

### `LoyaltyMembershipSchema` (response; every route that returns a membership)
| Field | Type | Meaning |
|---|---|---|
| `cardAccountId` | string or `null` | The linked credit account; null when none is linked. |
| `cardAccountName` | string or `null` | That account's name; null exactly when `cardAccountId` is null. |
| `benefit` | `{kind, description, windowDays}` or `null` | Null when no benefit is described. Kept across an unlink, so it may be present with no card. |
| `feeWatch` | `{feeDate, expectedBy, state}` or `null` | Null exactly when no card is linked. |
| `feeWatch.feeDate` | `YYYY-MM-DD` or `null` | Posted `date` of the most recent annual-fee row, if not refunded. Postgres `::text`. Never `authorized_date`. |
| `feeWatch.expectedBy` | `YYYY-MM-DD` or `null` | `feeDate + benefit_window_days`, by Postgres. Null with no fee or no benefit. |
| `feeWatch.state` | `no_fee_seen` · `awaiting` · `received` · `overdue` · `null` | Null exactly when `benefit` is null. |

Key sets are exact (strict objects), as `T42b-I9` asserts.

### `LoyaltyOverviewSchema` (`GET /api/v1/loyalty`)
| Field | Type | Meaning |
|---|---|---|
| `cardAccounts` | array of `{id, name}` | Every `credit` account, linked or not, ordered by name then id. No other account type. |

### `LoyaltyErrorCodeSchema`
`CARD_ALREADY_LINKED` (409), added. Every earlier code is unchanged.

## Domain invariants preserved
- **Derived, not stored.** No fee, fee date, expected-by or state column. Reads write nothing.
- **Money.** No money column is added. The fee amount is compared only in SQL, as `NUMERIC(12,2)`, and never emitted.
- **Null semantics.** NULL benefit columns mean "no benefit described", never zero or `''`. The window is never 0 (CHECK). `feeDate` and `expectedBy` are null, never `''`.
- **Inheritance.** None. `card_account_id` NULL means "no card linked", not "inherit from somewhere". The schema comment says so.
- **One definition.** The four instrument kinds are reused from `LOYALTY_INSTRUMENT_KINDS` for the benefit. The calendar date validator is the existing `giftDate` import. The default window is one constant.

## Migration
```
npm run migrate:up && npm run migrate:down && npm run migrate:up
```
Not run by the guardian: this role has no shell. The orchestrator runs acceptance commands #4 and #5 against `b8_p42a_throwaway` at G1. Expected: `OK migration up-down-up` and `OK schema`.

**The down is not lossless for the benefit.** It discards every benefit description and window typed while the change was live. **Links (`card_account_id`) and every instrument survive a down.** The down drops only the unique index, the completeness CHECK and the three columns. Back up first:

```
\copy (SELECT id, card_account_id, benefit_kind, benefit_description, benefit_window_days FROM loyalty_memberships ORDER BY id) TO 'backup-loyalty_card_benefit.csv' CSV HEADER
```

A restore re-runs `migrate:up` and loads the file back by membership id. Revert the application code before the down, so nothing queries a missing column. After a revert and down, a stale `card_account_id` is inert: 42a's code never selects, sets or emits it.

## Backfill / data correction required
- None. The three columns start NULL on every existing row, which means "no benefit described". Every existing `card_account_id` is already NULL, so the unique index builds cleanly.

## Consumers that must change (implementer)
`LoyaltyMembershipSchema` and `LoyaltyOverviewSchema` gain required keys. Every producer and every fixture that builds one must change, or `tsc` and the strict parse fail:
- `apps/web/lib/loyaltyStore.ts` (and any `apps/web/lib/domain/loyalty*.ts` it uses): the membership view must select the link, the account name and the benefit columns, and derive `feeWatch` through `visibleTransactions` in `apps/web/lib/giftReadPath.ts`, never a raw `FROM transactions`. The overview must add `cardAccounts`. The PATCH store path must write the link and the benefit, map 23505 on the new index to `CARD_ALREADY_LINKED`, and write `LOYALTY_BENEFIT_DEFAULT_WINDOW_DAYS` when `windowDays` is absent. Any 42a comment there calling the column reserved must go (acceptance command #5 greps for it).
- The four routes returning a membership: `app/api/v1/loyalty/route.ts`, `app/api/v1/loyalty/memberships/route.ts`, `app/api/v1/loyalty/memberships/[id]/route.ts`, `app/api/v1/loyalty/memberships/[id]/observations/route.ts`. The PATCH route also enforces the `credit` type.
- `apps/web/app/travel/page.tsx` and the `apps/web/components/Loyalty*.tsx` components that render a membership or the overview.
- `apps/web/app/accounts/[id]/page.tsx` for "Earns into".
- `apps/web/lib/giftSurfaceRegistry.ts` and `apps/web/scripts/gifts-surface-check.mjs`: the re-classification to `numeric-only` the spec names.
- Fixtures in `packages/contracts/loyalty.test.ts` and `apps/web/app/api/v1/loyalty/loyalty.test.ts` that build a membership or an overview gain the new keys with null or empty values, per command #17's allowance.
- `apps/web/scripts/import-loyalty.ts`: no change expected. Memberships it creates have no card and no benefit, and the new columns are nullable with no default. If it parses a `LoyaltyMembershipSchema` response anywhere, that is a conflict to raise, not absorb.

## Consumers checked
- `npx tsc --noEmit`: not run by the guardian (no shell). The orchestrator runs it at G1. It is expected to fail until the implementer updates the producers and fixtures above, because the new response keys are required.
- New exports are all `Loyalty`- or `LOYALTY_`-prefixed, so `export *` from `packages/contracts/index.ts` introduces no name collision. No new import: the file still depends only on `zod`, `./envelope`, `./auth` and `./gifts`.
- Ledger, net worth, gifts, receipts, `accounts`, `transactions`: no table, column or constraint changed.
