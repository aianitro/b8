# budget-unspent — contract record

Owner's request (2026-10-12): an "Unspent" bucket per spending category. When a month closes, each
category's leftover goes into its bucket; the owner allocates it by hand — carry into a month
(raising that month's plan) or release to savings. Decided with the owner: operational and capital
spending categories; starting from September 2026's close; unallocated leftover counts as saved;
overspent months add and take nothing.

## Surface (G1, authored by contract-guardian under lease `budget-unspent`)

- `migrations/1791900000000_budget-unspent.sql`, mirrored in `db/schema.sql`:
  - `budget_unspent` — one recorded close per spending category per closed month, written once
    (`UNIQUE (category_id, year, month)`, `amount >= 0`; a zero row marks a category closed with
    nothing left over, so a late refund can never insert one afterwards).
  - `budget_unspent_moves` — each allocation (`carry` with a destination category/year/month, or
    `release`).
  - `effective_budget(y)` — each category's plan for year `y` with carries added; a category with no
    carries into `y` returns exactly its stored `annual_budget` and `monthly_amounts`.
- Classification (BUILD.md §9.2): **additive** — two new tables, one index, one function; no existing
  column changes type, nullability, default or meaning; no existing row written.

## Guardian's recommendations and their disposition

1. Write a zero close row so a category-month is closed exactly once — **adopted** (`amount >= 0`).
2. Round `planned` to cents before computing `amount` — **adopted in the app** (`lib/unspentStore.ts`).
3. `effective_budget` returns unrounded even-spread months for carried categories — readers round at
   their boundary; **accepted as stated**.
4. `ON DELETE CASCADE` on a deleted category removes its carries into other categories — **kept**;
   noted for the category-delete path.
5. App-enforced rules (no overdraw under concurrency, carry only into this month or later, spending
   categories only, start month) — **implemented** in `lib/domain/unspent.ts` and
   `lib/unspentStore.ts` (advisory lock per bucket).
6. Close only after a few days' grace — **adopted**: a month closes from the 4th of the next month.

## Readers

Monthly-plan readers join `effective_budget`: month outlook, year-end projection, budget grid month
cells, drilldown month budget, category page, budget page expected-so-far. Annual "budget minus spent"
figures (Budget remaining, budget-vs-actual) keep the stored annual figure — a closed month's
leftover is already counted there as remaining, so adding the carry would count it twice.
