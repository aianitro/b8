// shared/contracts — the runtime half of the contract surface.
//
// `shared/types.ts` states the shapes the whole repo agrees on; it cannot enforce them, because a
// TypeScript type is gone by the time a payload arrives. These schemas are the same statement made
// checkable at runtime, derived from that file and from `db/schema.sql`'s NOT NULL and CHECK
// constraints — and, per SPEC.md's derivation rule, from nothing else: not from what a route
// handler currently accepts, and not from `lib/categoryControl.ts`. Import from here.
//
// THE MAPPING, one row per export of shared/types.ts. Twelve shapes plus the envelope; this table
// is what makes "exactly one schema each" auditable by a human rather than only by a test count,
// and `CONTRACT_SCHEMAS` below is the same table in a form a test can iterate.
//
//   shared/types.ts export  │ schema                        │ file
//   ────────────────────────┼───────────────────────────────┼──────────────────
//   Landscape               │ LandscapeSchema               │ enums.ts
//   ValuationMode           │ ValuationModeSchema           │ enums.ts
//   PropertyType            │ PropertyTypeSchema            │ enums.ts
//   TenantFundKind          │ TenantFundKindSchema          │ enums.ts
//   ControlMode             │ ControlModeSchema             │ enums.ts
//   Property                │ PropertySchema                │ shapes.ts
//   Account                 │ AccountSchema                 │ shapes.ts
//   BudgetCategory          │ BudgetCategorySchema          │ shapes.ts
//   CategoryRule            │ CategoryRuleSchema            │ shapes.ts
//   Transaction             │ TransactionSchema             │ shapes.ts
//   BudgetSummary           │ BudgetSummarySchema           │ shapes.ts
//   LinkedAccountSummary    │ LinkedAccountSummarySchema    │ shapes.ts
//   ApiResponse<T>          │ ApiErrorResponseSchema +      │ envelope.ts
//                           │ apiResponseSchema(dataSchema) │
//
// The envelope is the one entry that is not a single constant, and deliberately so: its error
// branch has no type parameter and is therefore closed and complete, while its success branch is
// generic over twelve payloads and is a factory a call site pins. See envelope.ts.
//
// WHAT IS NOT HERE. No per-route request/response DTO — `POST /api/accounts`'s ad hoc body, for
// instance, is not an export of shared/types.ts, and enumerating those belongs to the route
// migration this task excludes. No schema validates anything yet either: nothing under app/ imports
// this directory, by design, so adopting these is a separate, reviewable change.

import {
  ControlModeSchema,
  LandscapeSchema,
  PropertyTypeSchema,
  TenantFundKindSchema,
  ValuationModeSchema,
} from './enums';
import {
  AccountSchema,
  BudgetCategorySchema,
  BudgetSummarySchema,
  CategoryRuleSchema,
  LinkedAccountSummarySchema,
  PropertySchema,
  TransactionSchema,
} from './shapes';

export * from './exact';
export * from './representation';
export * from './enums';
export * from './shapes';
export * from './envelope';

/**
 * Every non-envelope export of shared/types.ts, keyed by the exact name that file exports.
 *
 * It exists so the one-schema-per-shape correspondence is machine-checkable instead of being a
 * claim in the comment above — the keys are meant to be compared against the exports of
 * `shared/types.ts`, not merely counted. The envelope is absent on purpose: it is generic, so it
 * has no single schema to put in a map, and pretending otherwise would be the shortcut SPEC.md
 * refuses.
 */
export const CONTRACT_SCHEMAS = {
  Landscape: LandscapeSchema,
  ValuationMode: ValuationModeSchema,
  PropertyType: PropertyTypeSchema,
  TenantFundKind: TenantFundKindSchema,
  ControlMode: ControlModeSchema,
  Property: PropertySchema,
  Account: AccountSchema,
  BudgetCategory: BudgetCategorySchema,
  CategoryRule: CategoryRuleSchema,
  Transaction: TransactionSchema,
  BudgetSummary: BudgetSummarySchema,
  LinkedAccountSummary: LinkedAccountSummarySchema,
};
