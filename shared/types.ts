// The shared TypeScript surface. Its runtime counterpart is shared/contracts/ (zod, added by
// P1-10): one schema per export below, validating the JSON these shapes actually have on the wire.
//
// Read the pair with one divergence in mind, because it is measured rather than theoretical. Every
// field below typed `number` that is backed by a scalar Postgres NUMERIC column — Property
// .purchase_price/.cost_basis, BudgetCategory.annual_budget, Transaction.amount and all of
// BudgetSummary's money fields — actually arrives as a numeric STRING ("8400.00"): `pg` returns
// OID 1700 as text so an arbitrary-precision decimal cannot lose digits to a float, and lib/db.ts
// registers no type parser to change that. The contracts say string; these declarations say number;
// the contracts are the truthful ones.
//
// The types are left as `number` deliberately, not by oversight. 61 files import this module and
// several do arithmetic directly on those fields, so correcting them is a breaking change
// (BUILD.md §9.2) that has to land with the consumers it breaks — that is the /api/v1 route
// migration's job, not the job of the task that introduced the validator. Until then the
// `Number(...)` wrappers already dotted through components/CategoryManager.tsx and
// app/budget/page.tsx are what bridges the two, and they are there because the type is wrong.
//
// NUMERIC[] is NOT the same case and must not be "fixed" to match: `pg` registers the array parser
// separately and it does convert elements, so BudgetCategory.monthly_amounts really is number[] at
// runtime. Local row types annotating it `string[]` (app/budget/page.tsx, the categories route) are
// the mirror-image mistake.

export type Landscape = 'operational' | 'capital';

// 'ledger': balance is flow-derived (beginning_balance + Σ transactions) — right for cash.
// 'valuation': balance is the latest account_valuations row — right for market-value assets,
// real estate, and amortizing liabilities, which have no meaningful transaction-sum balance.
export type ValuationMode = 'ledger' | 'valuation';

export type PropertyType = 'primary' | 'rental';

// The two kinds of tenant money a rental holds (property_tenant_funds.kind). Spelled out in the
// type, not left to the SQL CHECK alone, because the entire point of the pair is that they are
// treated differently: a security deposit is owed back and reduces net worth, while last month's
// rent is the owner's money already recognized as income on a cash basis and reduces nothing.
// Typed as `string`, a mistyped literal in the filter that separates them matches no rows — and a
// deposit that quietly stops counting is a wrong number that looks like a right one.
export type TenantFundKind = 'security_deposit' | 'last_month_rent';

// How much of a *decision* a budget category's spend is (budget_categories.control_mode) — a
// dimension orthogonal to landscape / exclude_from_budget / is_income, not a refinement of them.
// 'fixed': contractually or externally set, not a month-to-month choice. 'discretionary': both
// whether and how much are behaviour. 'variable-necessary': necessary, but the amount moves with
// circumstance rather than with a decision — utilities are neither a free choice nor a fixed
// debit, which is why this is three values and not a boolean.
// Only 'discretionary' is ever scored; the other two are tracked and reported. A consumer must
// gate on landscape = 'operational' before acting on this at all — the column is present on
// capital rows and inert there.
export type ControlMode = 'fixed' | 'discretionary' | 'variable-necessary';

export interface Property {
  id: number;
  nickname: string;
  address: string | null;
  type: PropertyType;
  purchase_price: number | null;
  purchase_date: string | null;
  cost_basis: number | null;
}

export interface Account {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  landscape: Landscape;
  track_transactions: boolean;
  bank: string | null;
  is_manual: boolean;
  last_synced_at: string | null;
  valuation_mode: ValuationMode;
  is_liability: boolean;
  property_id: number | null;
}

export interface BudgetCategory {
  id: number;
  name: string;
  annual_budget: number;
  landscape: Landscape;
  exclude_from_budget: boolean;
  is_income: boolean;
  // Required and non-nullable because the column is NOT NULL DEFAULT 'fixed' — every row has a
  // value from the moment it exists. Typed optional or nullable it would describe a fourth,
  // absent state the database cannot produce, and since these rows arrive through an unchecked
  // db.query<BudgetCategory>() cast, nothing at runtime would contradict the lie.
  control_mode: ControlMode;
  dedicated_account_id: string | null;
  monthly_amounts: number[] | null;
  created_at: string;
}

export interface CategoryRule {
  id: number;
  plaid_category: string;
  mapped_category: string;
  created_at: string;
}

export interface Transaction {
  id: number;
  plaid_transaction_id: string;
  date: string;
  amount: number;
  name: string | null;
  merchant_name: string | null;
  plaid_category: string | null;
  mapped_category: string | null;
  rule_applied: boolean;
  account_id: string;
  hidden: boolean;
  created_at: string;
}

export interface BudgetSummary {
  category: string;
  annual_budget: number;
  ytd_spent: number;
  remaining: number;
  monthly_reference: number;
}

/** One account as returned by POST /api/plaid/exchange-token, for accounts genuinely new to
 *  this app (not a reconnect) — enough for AccountClassifyModal to prompt a valuation type. */
export interface LinkedAccountSummary {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  mask: string | null;
}

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };
