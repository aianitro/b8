// How a Postgres value actually reaches a consumer, named once, in one file.
//
// WHICH BOUNDARY THESE DESCRIBE. Every schema in this directory validates a *wire* value: the JSON
// a handler produces after `Response.json(...)`, which is what the web UI receives today and what
// `curl` and the Expo client will receive once Phase 1 is finished. That boundary — not the row
// object `db.query()` hands a handler — is the one a contract is for. The distinction is invisible
// for NUMERIC (already a string before serialization, passed through untouched) and load-bearing
// for timestamps (a JS `Date` inside the handler, an ISO-8601 string after it).
//
// WHY ONE FILE. This is the concept the repo has most recently been burned by duplicating:
// `lib/domain/property.ts` re-derived `valuation.ts`'s newest-wins reducer and the two were one
// edit from disagreeing about what "current value" meant (BUILD.md §1, §10.3 "Two definitions of
// one concept"). A second, subtly different money regex in a sibling schema file is that defect in
// miniature, and it would be found by a wrong number on a screen rather than by a test.
//
// NAMING. These are camelCase because they describe a *representation*; the named domain shapes in
// shapes.ts and enums.ts are PascalCase with a `Schema` suffix because they stand 1:1 against an
// export of shared/types.ts. The difference in case is the signal that one of these is not a
// domain concept and should not be re-exported as if it were.

import { z } from 'zod';

/**
 * A scalar Postgres NUMERIC, exactly as `pg` hands it over: a decimal string.
 *
 * This is P1-10's central finding, and it was measured rather than reasoned about. `lib/db.ts`
 * constructs a bare `Pool` and registers no `setTypeParser`, so OID 1700 keeps `pg`'s documented
 * default of text — a JS number cannot hold an arbitrary-precision decimal without drift, which is
 * the same conviction that puts money in NUMERIC columns in the first place. Against the demo
 * database, through that exact client (GATES.md, G0 cycle 1):
 *
 *     budget_categories.annual_budget  → "8400.00"     typeof string
 *     transactions.amount              → "-7750.00"    typeof string
 *     properties.purchase_price        → "720000.00"   typeof string
 *     SUM(amount)                      → "-103712.31"  typeof string
 *
 * `JSON.stringify` passes a string through unchanged, so the wire value is that same string.
 * `z.number()` here would reject every real response from `GET /api/categories` while accepting
 * every fixture an implementer hand-writes — JS literals are numbers by habit — which is the first
 * failure mode SPEC.md lists. The corroboration is already in the running code: six `Number(...)`
 * wrappers around `c.annual_budget` in components/CategoryManager.tsx, three more in
 * app/budget/page.tsx, all written because the value is a string and the type says otherwise.
 *
 * String-only on purpose, rather than `z.union([z.string(), z.number()])`. A schema that accepts
 * both representations can no longer tell them apart, so the day a handler starts returning
 * `Number(annual_budget)` — reintroducing exactly the float drift the NUMERIC column exists to
 * prevent — nothing would fail. Permissiveness here buys convenience and spends the only detector.
 *
 * No sign restriction: this ledger's Plaid-derived convention is positive = money out, negative =
 * income, so `transactions.amount` is legitimately either, and a `.positive()` slipped in here
 * would reject every income row (SPEC.md negative control #8). No scale restriction either: the
 * columns are NUMERIC(12,2)/(14,2), but an aggregate or an unrounded expression is printed at
 * whatever scale Postgres computes, and a validator demanding exactly two decimals would reject
 * figures the database really produces.
 *
 * `NaN` is a legal NUMERIC value in Postgres and this regex rejects it anyway. That is a judgement
 * recorded rather than a constraint invented: no money column here has a CHECK against it, but a
 * NaN balance is a data defect rather than an observation, and it renders as "NaN" all the way to
 * the screen. Exponent notation is absent because Postgres never prints NUMERIC that way.
 */
export const numericString = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/, 'expected a Postgres NUMERIC as pg returns it, e.g. "1200.00"');

/**
 * A Postgres NUMERIC[], whose elements arrive as JS **numbers**.
 *
 * The asymmetry with `numericString` is real, measured, and the correction that cost this task a
 * G0 cycle (GATES.md D1). `pg` registers the scalar parser and the array parser independently and
 * they do not agree: the scalar parser leaves NUMERIC as text, while the `numeric[]` parser
 * converts each element. Same table, same row, same client:
 *
 *     budget_categories.annual_budget      → "8400.00"   typeof string
 *     budget_categories.monthly_amounts[i] → 4200        typeof number
 *
 * So this is NOT `z.array(numericString)`, and applying the scalar rule here "for consistency"
 * produces a schema that rejects every category which actually carries a custom monthly schedule —
 * the same class of defect as `z.number()` on the scalar case, pointing the other way. Note that
 * app/budget/page.tsx and app/api/categories/route.ts both annotate this column as `string[]` in
 * their local row types; those annotations are the habit this comment exists to interrupt.
 *
 * Cardinality and sign are deliberately unconstrained, even though every writer produces exactly
 * twelve non-negative values or NULL (`normalizeMonthlyAmounts` in lib/budgetMath.ts, used by both
 * POST and PATCH /api/categories). The column carries no CHECK on length or sign, so a read
 * validator demanding twelve would make any row predating that helper unreadable, and SPEC.md's
 * non-goals forbid encoding a rule the database does not hold. Elements are non-nullable because
 * `numeric[]` here is written whole or not at all; NULL is modelled on the column, not inside it.
 */
export const numericArray = z.array(z.number());

/**
 * A TIMESTAMPTZ at the JSON boundary.
 *
 * `pg` parses OID 1184 into a JS `Date`, so inside a handler the value is a Date object; it is
 * `Response.json` that turns it into an ISO-8601 string, and a string is what `shared/types.ts`
 * has always declared these fields to be. Fixtures for these schemas must therefore use the
 * serialized form (`"2026-01-15T00:00:00.000Z"`), not a `Date` — the schema describes the payload,
 * not the intermediate row.
 *
 * Unconstrained beyond "a string" on purpose: nothing in the app parses these values back, so a
 * format assertion would be a new rule rather than a description of what arrives.
 */
export const timestamptz = z.string();

/**
 * A DATE at the JSON boundary — `transactions.date`, `properties.purchase_date`.
 *
 * Same mechanism as `timestamptz`: `pg` yields a `Date`, `Response.json` yields a string. A
 * distinct name rather than an alias, so a use site states which column type it is describing. A
 * DATE that starts arriving as `'YYYY-MM-DD'` because some handler added a `::text` cast is a
 * different change from a timestamp doing the same thing, and one shared name would hide it.
 */
export const dateString = z.string();

/**
 * A SERIAL / INT key — `pg` parses int4 to a JS number (unlike int8, which it returns as a string
 * for the same precision reason NUMERIC is text).
 *
 * `z.int()` rather than `z.number()` because the column cannot hold 1.5. No `.positive()`: nothing
 * in the schema or the application enforces positivity on an id, and inventing the rule here is
 * the mirror image of the `annual_budget >= 0` constraint SPEC.md's non-goals explicitly refuse.
 */
export const serialId = z.int();
