// One runtime-checked schema per object shape that shared/types.ts exports, in the order that file
// declares them. Four decisions govern every schema below; each is a defect class this task exists
// to prevent, so each is stated once here rather than repeated at thirty fields.
//
// 1. THE TYPE IS THE MODEL, NOT THE TABLE. `BudgetCategorySchema` has ten fields because
//    `BudgetCategory` has ten, while `budget_categories` has thirteen columns: `is_debt_service`
//    and `sort_order` are absent here deliberately. Building this from `CREATE TABLE` instead would
//    admit both — fields no consumer of the TypeScript type ever sees, and which, if a schema like
//    this is later pointed at an *inbound* payload, would let a client set `is_debt_service` without
//    the debt-service/control_mode coupling check that lives only in the route handler.
//
// 2. NULLABLE, NEVER OPTIONAL. Every genuinely nullable column is `.nullable()` AND required. The
//    key is always present, because Postgres returns every column a query selected whether its
//    value is null or not, and because the one shape here that is not a database row
//    (`LinkedAccountSummary`) is built with `?? null` at its only producer. `.optional()` would
//    collapse "this row genuinely has no value" into "a key went missing somewhere upstream", and
//    those two need different responses: the first renders "—", the second is a bug. That is
//    BUILD.md §5.3's "nullable means unknown, and consumers must be able to tell", applied one
//    layer up from SQL. Nothing below is ever defaulted to 0 to paper over a null.
//
// 3. UNKNOWN KEYS ARE STRIPPED, NOT REFUSED — and this is measured, not stylistic. `z.object()`
//    strips; `z.strictObject()` (used in envelope.ts, where the shape is wholly app-authored) would
//    reject. A strict row schema would reject a real payload today: `POST /api/categories` returns
//    `INSERT … RETURNING *`, so its response carries `is_debt_service` and `sort_order` alongside
//    the ten contracted fields. Stripping is also the safer behaviour for a future inbound use — the
//    extra key is removed rather than forwarded. Rule 1 is therefore checked against the schema's
//    own declared field set (`Object.keys(BudgetCategorySchema.shape)`, and the compile-time
//    assertion under each schema), never by expecting a rejection.
//
// 4. MONEY IS A NUMERIC STRING, AND THAT DISAGREES WITH shared/types.ts ON PURPOSE. See
//    representation.ts for the measurements. Every field below typed `number` in shared/types.ts
//    but backed by a scalar NUMERIC column is `numericString` here, because that is what arrives;
//    `monthly_amounts` is an array of JS numbers, because `pg`'s array parser is asymmetric with its
//    scalar one. Correcting shared/types.ts to match would be a breaking change (BUILD.md §9.2) to
//    61 importers and belongs to the route migration, not to the task that adds the validator — so
//    the assertions below compare KEY SETS, not value types. The divergence is named at the top of
//    shared/types.ts so nobody has to rediscover it, and CONTRACT.md records why it was not closed.

import { z } from 'zod';
import type {
  Account,
  BudgetCategory,
  BudgetSummary,
  CategoryRule,
  LinkedAccountSummary,
  Property,
  Transaction,
} from '../types';
import type { Assert, Equals } from './exact';
import {
  ControlModeSchema,
  LandscapeSchema,
  PropertyTypeSchema,
  ValuationModeSchema,
} from './enums';
import { dateString, numericArray, numericString, serialId, timestamptz } from './representation';

/**
 * `properties` — real estate as a first-class capital asset.
 *
 * `purchase_price` and `cost_basis` are nullable because a property can be tracked without either
 * being known, and null there means UNKNOWN: a property with no figure renders "—", never $0.
 * Neither is the property's *current* value — that is the newest `property_valuations` row, a
 * derived read, and there is deliberately no field here for it to go stale in.
 */
export const PropertySchema = z.object({
  id: serialId,
  nickname: z.string(),
  address: z.string().nullable(),
  type: PropertyTypeSchema,
  purchase_price: numericString.nullable(),
  purchase_date: dateString.nullable(),
  cost_basis: numericString.nullable(),
});
export type PropertyFieldsAreExact = Assert<
  Equals<keyof z.infer<typeof PropertySchema>, keyof Property>
>;

/**
 * `accounts`, as the application reads it.
 *
 * `id` is a string, not a `serialId`: it is Plaid's `account_id` or a locally minted
 * `manual_<uuid>`, and Plaid does not guarantee it is permanently stable (see lib/plaidReconcile.ts).
 *
 * `type` is an open `z.string()` on purpose — it is whatever Plaid calls the account and
 * `db/schema.sql` puts no CHECK on it. Closing this vocabulary would be inventing a rule nothing
 * enforces, and the first unrecognized Plaid type would then fail validation instead of rendering.
 *
 * `is_manual` is NOT a column. It is `(access_token IS NULL) AS is_manual`, computed per query —
 * app/accounts/page.tsx is the live example. It is contracted because the type declares it, and it
 * stays derived because a stored copy is a value that can go stale silently.
 *
 * `property_id` nullable means "this account is secured against no property" — most accounts. It is
 * NOT the inheriting-NULL case: that is `transactions.property_id`, resolved as
 * `COALESCE(t.property_id, a.property_id)`, which `shared/types.ts` deliberately does not expose on
 * `Transaction` and which therefore has no schema here. If it is ever added, NULL there means
 * *inherit from the account*, not *unattributed*, and it must say so in a comment.
 *
 * Known divergence, recorded rather than softened: app/accounts/page.tsx casts to `Account` while
 * selecting eleven of these twelve fields — `property_id` is not in its SELECT list — so that row
 * would fail this schema on a missing key. The schema is right and the query is incomplete; fixing
 * the query is route work, out of scope here (SPEC.md non-goals), and modelling the field
 * `.optional()` to accommodate it would destroy the very distinction rule 2 exists to keep.
 */
export const AccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  subtype: z.string().nullable(),
  landscape: LandscapeSchema,
  track_transactions: z.boolean(),
  bank: z.string().nullable(),
  is_manual: z.boolean(),
  last_synced_at: timestamptz.nullable(),
  valuation_mode: ValuationModeSchema,
  is_liability: z.boolean(),
  property_id: serialId.nullable(),
});
export type AccountFieldsAreExact = Assert<
  Equals<keyof z.infer<typeof AccountSchema>, keyof Account>
>;

/**
 * `budget_categories`, as `GET /api/categories` returns it.
 *
 * `landscape`, `exclude_from_budget`, `is_income` and `control_mode` are four INDEPENDENT
 * classifications — db/schema.sql says so in its own comment, and the scored set names all four
 * conjuncts out loud: `landscape = 'operational' AND exclude_from_budget = FALSE AND is_income =
 * FALSE AND control_mode = 'discretionary'`. All four are required here, separately, and no field's
 * presence or value implies another's. Collapsing any two is how a headline number goes quietly
 * wrong, which is why none of them is modelled as a refinement of another.
 *
 * `control_mode` is required and non-nullable: NOT NULL DEFAULT 'fixed', so a null would be a
 * fourth, unnamed mode that a later AVG() ranges over silently. This is the repo's one stated
 * departure from "nullable means unknown" — a missing valuation is genuinely unknown, a category's
 * control mode is at worst mis-decided, never absent — and it is the only field here that must
 * reject BOTH `null` and an absent key.
 *
 * `dedicated_account_id` nullable means the category tracks no real pool of money; `monthly_amounts`
 * null means "no custom schedule", i.e. spread `annual_budget` evenly across twelve months. Neither
 * null is a zero, and `annual_budget` is not nullable at all (the column is NOT NULL).
 *
 * No non-negativity check on `annual_budget`, deliberately: there is no `CHECK (annual_budget >= 0)`
 * in db/schema.sql and `POST /api/categories` does not enforce one either (only `PATCH`'s
 * annual_budget branch does). A schema that rejected a negative value would encode a rule that is
 * not true of this data — the same "transcribe an incomplete picture as the specification" failure
 * as deriving a value set from a handler, pointing the other way.
 */
export const BudgetCategorySchema = z.object({
  id: serialId,
  name: z.string(),
  annual_budget: numericString,
  landscape: LandscapeSchema,
  exclude_from_budget: z.boolean(),
  is_income: z.boolean(),
  control_mode: ControlModeSchema,
  dedicated_account_id: z.string().nullable(),
  monthly_amounts: numericArray.nullable(),
  created_at: timestamptz,
});
export type BudgetCategoryFieldsAreExact = Assert<
  Equals<keyof z.infer<typeof BudgetCategorySchema>, keyof BudgetCategory>
>;

/**
 * `category_rules` — a Plaid category mapped to a user budget category.
 *
 * Both names are plain strings and neither is a foreign key, which is the schema's own decision:
 * `budget_categories` is UNIQUE (name, landscape), so a name alone does not identify a category,
 * and names are allowed to be renamed and reused loosely. A schema that validated
 * `mapped_category` against an enumeration of live category names would invent referential
 * integrity the database deliberately declines to enforce.
 */
export const CategoryRuleSchema = z.object({
  id: serialId,
  plaid_category: z.string(),
  mapped_category: z.string(),
  created_at: timestamptz,
});
export type CategoryRuleFieldsAreExact = Assert<
  Equals<keyof z.infer<typeof CategoryRuleSchema>, keyof CategoryRule>
>;

/**
 * `transactions`.
 *
 * `amount` accepts both signs and must: this ledger's Plaid-derived convention is positive = money
 * out, negative = income, so requiring a positive amount would reject every income row — SPEC.md
 * negative control #8, and a close relative of the sign trap that once read a mortgage payment as
 * rental income.
 *
 * Four nullable text fields, each meaning something specific and none meaning zero or empty:
 * `name`/`merchant_name` are what Plaid supplied (or did not), `plaid_category` is its
 * classification, and `mapped_category` null means UNCATEGORIZED — the state /budget counts and
 * surfaces, not an absent key to be shrugged off.
 *
 * `hidden` and `exclude_from_budget` (on the category) are different flags and neither is derivable
 * from the other; filtering only `hidden` once let a $3,120 internal transfer read as rental income.
 * `transfer_group_id` and `property_id` are columns on this table that `shared/types.ts` does not
 * expose, so they are absent here — see rule 1 at the top of this file.
 */
export const TransactionSchema = z.object({
  id: serialId,
  plaid_transaction_id: z.string(),
  date: dateString,
  amount: numericString,
  name: z.string().nullable(),
  merchant_name: z.string().nullable(),
  plaid_category: z.string().nullable(),
  mapped_category: z.string().nullable(),
  rule_applied: z.boolean(),
  account_id: z.string(),
  hidden: z.boolean(),
  created_at: timestamptz,
});
export type TransactionFieldsAreExact = Assert<
  Equals<keyof z.infer<typeof TransactionSchema>, keyof Transaction>
>;

/**
 * The per-category budget roll-up — a GROUP BY projection, not a table (app/budget/page.tsx).
 *
 * All four money fields are numeric strings, and every one of them reaches the boundary that way
 * for a slightly different reason: `annual_budget` is the NUMERIC column itself, `ytd_spent` is
 * `COALESCE(SUM(t.amount), 0)`, `remaining` is a NUMERIC subtraction, and `monthly_reference` is
 * `ROUND(bc.annual_budget / 12, 2)`. `pg` returns all four as text, and app/budget/page.tsx already
 * wraps each in `Number(...)` at the point of use — defensive code written because the declared
 * type is wrong, which is the evidence this schema is built on rather than around.
 *
 * `remaining` carries no sign restriction: over-spend is the case the page colours red, and a
 * validator that refused it would reject exactly the rows a budget exists to show.
 */
export const BudgetSummarySchema = z.object({
  category: z.string(),
  annual_budget: numericString,
  ytd_spent: numericString,
  remaining: numericString,
  monthly_reference: numericString,
});
export type BudgetSummaryFieldsAreExact = Assert<
  Equals<keyof z.infer<typeof BudgetSummarySchema>, keyof BudgetSummary>
>;

/**
 * One genuinely-new account as `POST /api/plaid/exchange-token` reports it, for
 * AccountClassifyModal's valuation-type prompt.
 *
 * The only shape here that never touches a NUMERIC column — it is assembled in TypeScript from
 * Plaid's response, which is why there is no money field to get wrong. `subtype` and `mask` are
 * nullable and required because that producer writes `a.subtype ?? null` and `a.mask ?? null`: the
 * key is always there, and null means "Plaid did not tell us", not "this account has no mask".
 *
 * `mask` stays a plain string: it is the last four digits of an account number, and a `.length(4)`
 * here would be a guess about a third party's format, not a fact about this schema.
 */
export const LinkedAccountSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  subtype: z.string().nullable(),
  mask: z.string().nullable(),
});
export type LinkedAccountSummaryFieldsAreExact = Assert<
  Equals<keyof z.infer<typeof LinkedAccountSummarySchema>, keyof LinkedAccountSummary>
>;
