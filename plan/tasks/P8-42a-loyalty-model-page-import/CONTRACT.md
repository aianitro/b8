# CONTRACT — P8-42a-loyalty-model-page-import
**Author:** contract-guardian
**Lease:** opened 2026-11-19 by the orchestrator · closed by the orchestrator at G1

## Change
| File | Change | Class (§9.2) |
|---|---|---|
| `migrations/1792700000000_loyalty.sql` (new) | Six new tables: `household_members`, `loyalty_programs`, `loyalty_program_aliases`, `loyalty_memberships`, `loyalty_observations`, `loyalty_instruments`. CHECK constraints for the unit, program-kind, instrument-kind and both source vocabularies; non-negative balance under 13 integer digits; per-unit scale (whole units at scale 0, `usd` at scale exactly 2); trimmed and bounded text; normalised aliases; instrument date order. Unique: one membership per (member, program); member display name ignoring case; one member per user; alias across all programs; one imported observation per (membership, as-of); one imported instrument per membership. Indexes for the newest-wins read and the foreign keys. A catalog seed of 51 programs and 227 aliases with a self-check `DO` block. A real Down Migration dropping all six tables. No existing table altered. | additive |
| `db/schema.sql` | Reflects the migration: the six tables and their indexes, appended after `receipt_captures`. The seed is data and stays in the migration. | additive |
| `packages/contracts/loyalty.ts` (new) | Request and response schemas for all 11 routes of the surface table, wrapped in `apiResponseSchema`; the vocabularies as exported constants (`LOYALTY_UNITS`, `LOYALTY_WHOLE_UNITS`, `LOYALTY_PROGRAM_KINDS`, `LOYALTY_INSTRUMENT_KINDS`, `LOYALTY_OBSERVATION_SOURCES`, `LOYALTY_INSTRUMENT_SOURCES`) and their enums; `LoyaltyErrorCodeSchema`; `isBalanceForUnit` (the API balance rule); a masked member-number schema and a full one kept distinct. Strict objects throughout. | additive |
| `packages/contracts/index.ts` | One added line, `export * from './loyalty';`. | additive |

## Rationale

**A separate domain, not an extension of accounts.** Loyalty balances are not money in the ledger's sense: they have units that cannot be summed with dollars, and the only honest value of a point is observed per redemption (a later step). Putting them in `accounts`/`account_valuations` would either bend those tables or show a points figure in a column readers parse as dollars. So nothing here touches an existing table; the one link is the nullable `loyalty_memberships.card_account_id`, reserved for 42b and always NULL in 42a.

**No current-balance column.** The current balance is the newest observation by as-of date, ties by `recorded_at` then `id`, derived on read through the shared reducer in `apps/web/lib/domain/observations.ts`. Storing it would create a value that can go stale silently, and "newest by arrival" would let a re-imported older reading roll a balance back. `loyalty_observations` is append-only; the newest-wins index serves the read.

**One spelling per balance, enforced in the database.** The balance column is unconstrained `NUMERIC` with a per-unit scale CHECK, not `NUMERIC(14,2)`. A typmod would store a points balance with two decimals, and every read would have to reformat it. With scale 0 for whole units and scale exactly 2 for `usd`, `balance::text` is already the canonical emitted text (bare digits for whole units, two decimals for usd), and a fractional whole-unit value, a `.0` suffix or a third decimal on cash is refused by Postgres as well as by the API. **Implementer note:** insert the canonical text the shared parser returns (for `usd`, always two decimals; for whole units, digits only). A `usd` value with one decimal is refused (SQLSTATE 23514), not rescaled.

**Aliases are rows, not matching logic.** A sheet label can only be matched by exact equality after normalisation, and fuzzy matching is forbidden, so the tolerated spellings are data the owner can see and fix through the program PATCH route. `UNIQUE (alias)` across the whole table makes "an alias names two programs" impossible rather than merely unlikely. The CHECK refuses what normalisation can never produce (surrounding or doubled spaces, tabs, line breaks, non-breaking spaces, upper case, a closed parenthesised group). It cannot see the leading-symbol rule, which needs Unicode classes and stays with the one application function.

**Import idempotence backed by the schema.** The partial unique indexes `loyalty_observations_one_import_per_day` (membership, as-of WHERE source = 'import') and `loyalty_instruments_one_import` (membership WHERE source = 'import') state exactly the idempotence rules of SPEC.md I3, I7 and I8 as constraints. A second run cannot duplicate, even interleaved. Typed rows are not limited.

**The full member number has one schema and one route.** Every response carries `memberNumberMasked`, whose schema cannot hold more than four characters of the number. `LoyaltyMemberNumberSchema` is the only response shape with the full value, used only by the S6 route for `browser` sessions. A separate error code, `BROWSER_SESSION_REQUIRED` (403), distinguishes "wrong kind of session" from the boundary's `INSUFFICIENT_SCOPE`. A full-scope bearer token is refused too, so a scope-only check would be wrong here.

**Catalog judgement calls** (also commented in the migration):
- Alaska Airlines' program is seeded under its current name, Atmos Rewards (unit `points`), with "mileage plan", "alaska mileage plan", "alaska airlines mileage plan", "alaska", "alaska air" and "alaska airlines" as aliases.
- HawaiianMiles merged into the same program in 2025 but stays a separate catalog entry. Otherwise a sheet listing both carriers for one person would resolve both rows to one (member, program) pair and refuse the second as a duplicate. The owner can move the aliases.
- "avios" is no program's alias, because four seeded programs share that currency.
- Avios programs (British Airways Club, Iberia Club, Qatar, Aer Lingus) are recorded as `points`, the vocabulary having no Avios unit. Airlines whose own currency is points (Atmos, Southwest, JetBlue, Spirit, Sun Country, ITA Volare, Aeroplan, Virgin Atlantic, Qantas) are `points`. The other airlines are `miles`.
- Capital One Miles is `points`, per the card-currency rule.

## Domain invariants preserved
- **Derived, not stored:** no "current" or "latest" column. `loyalty_observations` is append-only and has no update or delete path in the contract (no PATCH or DELETE schema for an observation exists).
- **Money:** `usd` balances are `NUMERIC` at scale exactly 2 (per-unit CHECK); whole units are `NUMERIC` at scale 0. No float anywhere; the contract carries balances as decimal strings and rejects a JSON number.
- **Null semantics:** no observation means null `balance`, `unit`, `asOf` and `source` together (a refine in `LoyaltyMembershipSchema`), rendered "—". Zero is a reading. No column defaults a missing reading to zero. NULL `member_number`, `tier`, `user_id` and instrument dates mean unknown or none, never '' or a placeholder.
- **Inheritance:** no inheriting column. `card_account_id` NULL means "no card linked" (and is always NULL in 42a), not "inherit".

## Migration
```
npm run migrate:up && npm run migrate:down && npm run migrate:up
```
Not run by the guardian: this role has no shell. The orchestrator runs acceptance command #5 against `b8_p42a_throwaway` at G1 and records the output here or in GATES.md. Expected: `OK 1 new migration; down removes every loyalty table; up restores them; schema.sql lists all 6 tables`. The seed's `DO` block raises if any per-kind minimum, own-name alias, two-alias rule or alias total is not met. A failing seed therefore fails `migrate:up` and does not ship.

Seed counts, by reading: 51 programs (airline 30, hotel 11, card_currency 6, travel_cash 1, car 3); 227 aliases. Every program's lower-cased name is among its aliases. Every airline, hotel and card currency has at least two aliases. No alias repeats.

Requires Postgres 13 or later (`scale(numeric)`).

## Backfill / data correction required
- None. All six tables are new and start empty apart from the catalog. The one-time spreadsheet import is a script the implementer writes (`apps/web/scripts/import-loyalty.ts`). The owner runs it on the home server, dry run first. It is not a migration and not a data correction of existing rows. Before any later `migrate:down` on a real database, take the six `\copy … CSV HEADER` backups listed in the Down Migration's comment.

## Consumers checked
- `npx tsc --noEmit`: not run by the guardian (no shell); the orchestrator runs it at G1. No existing consumer imports these names. The new exports are all `Loyalty`/`LOYALTY_`-prefixed apart from `isBalanceForUnit`, so `export *` from `index.ts` introduces no name collision with the existing modules.
- `packages/contracts/loyalty.ts` imports `giftDate` from `./gifts` (as `calendarDate`), rather than restating a second calendar-date validator. `apiResponseSchema` comes from `./envelope` and `UserIdSchema` from `./auth`. There is no `next/*`, `pg` or `lib/**` import.
- `db/schema.sql` writes the six tables as plain `CREATE TABLE <name> (` rather than this file's usual `CREATE TABLE IF NOT EXISTS`. That form is what acceptance command #5 greps for. A whole-file re-run of `db/schema.sql` against a database that already has these tables would stop at them. The reference schema is not applied that way by any step of this task.
- Ledger, net worth, gifts, receipts: unaffected; no existing table, column or constraint changed.
