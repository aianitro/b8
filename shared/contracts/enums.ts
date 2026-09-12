// The five closed vocabularies of shared/types.ts, as runtime validators.
//
// DERIVATION SOURCE, stated as a rule because ITEM.md names its violation by name. Each value set
// below comes from two places and two only: the union in `shared/types.ts`, and the CHECK
// constraint in `db/schema.sql` that the comment on each schema names. It does not come from
// `lib/categoryControl.ts`'s `CONTROL_MODES` (which lists the same three values in a different,
// UI-facing order — least discretion to most), nor from what `POST`/`PATCH /api/categories`
// currently accepts. All of those agree today; the rule exists for the day they stop, because a
// schema derived from the route would ratify the route's omission as the specification, and
// `control_mode` has already been unwritable through the API once for exactly that reason.
//
// HOW THAT DERIVATION IS ENFORCED rather than merely asserted: the `Assert<Equals<…>>` line under
// each schema makes `npx tsc --noEmit` fail if the schema's value set and the TypeScript union
// stop being the same set — a value added to one and not the other, or mistyped in one of them.
// `'variable'` for `'variable-necessary'` is the plausible slip (SPEC.md F5 tests that one by
// hand); the compile-time check covers the ones nobody thought to write a test for.
//
// UNKNOWN VALUES ARE REJECTED, NOT PASSED THROUGH. A `z.string()` here would admit a typo'd or
// case-mismatched value that the NOT NULL CHECK would have refused at the database, and for
// `control_mode` that value would then be silently outside the scored set — a category invisible to
// the guardrail, which is the failure P0.5-31 was opened to fix.

import { z } from 'zod';
import type {
  ControlMode,
  Landscape,
  PropertyType,
  TenantFundKind,
  ValuationMode,
} from '../types';
import type { Assert, Equals } from './exact';

/** `accounts.landscape` / `budget_categories.landscape` — CHECK (landscape IN ('operational', 'capital')). */
export const LandscapeSchema = z.enum(['operational', 'capital']);
export type LandscapeIsExact = Assert<Equals<z.infer<typeof LandscapeSchema>, Landscape>>;

/** `accounts.valuation_mode` — CHECK (valuation_mode IN ('ledger', 'valuation')). */
export const ValuationModeSchema = z.enum(['ledger', 'valuation']);
export type ValuationModeIsExact = Assert<Equals<z.infer<typeof ValuationModeSchema>, ValuationMode>>;

/** `properties.type` — CHECK (type IN ('primary', 'rental')). */
export const PropertyTypeSchema = z.enum(['primary', 'rental']);
export type PropertyTypeIsExact = Assert<Equals<z.infer<typeof PropertyTypeSchema>, PropertyType>>;

/**
 * `property_tenant_funds.kind` — CHECK (kind IN ('security_deposit', 'last_month_rent')).
 *
 * No object shape in shared/types.ts carries this field yet; it is still contracted because the
 * whole point of the pair is that the two kinds are treated differently — a security deposit is
 * owed back and reduces net worth, last month's rent was already recognized as income and reduces
 * nothing — and a mistyped literal in the filter that separates them matches no rows, so a deposit
 * quietly stops counting and the wrong number looks like a right one.
 */
export const TenantFundKindSchema = z.enum(['security_deposit', 'last_month_rent']);
export type TenantFundKindIsExact = Assert<Equals<z.infer<typeof TenantFundKindSchema>, TenantFundKind>>;

/**
 * `budget_categories.control_mode` — NOT NULL DEFAULT 'fixed'
 * CHECK (control_mode IN ('fixed', 'discretionary', 'variable-necessary')).
 *
 * Three values rather than a boolean because 'variable-necessary' (utilities, groceries, fuel:
 * necessary, but the amount moves with circumstance rather than with a decision) has nowhere
 * correct to go in a boolean. Only 'discretionary' is ever scored.
 *
 * Nullability is the column's, not this schema's, concern — see `BudgetCategorySchema`, where this
 * field is required and non-nullable, the repo's one stated exception to "nullable means unknown".
 */
export const ControlModeSchema = z.enum(['fixed', 'discretionary', 'variable-necessary']);
export type ControlModeIsExact = Assert<Equals<z.infer<typeof ControlModeSchema>, ControlMode>>;
