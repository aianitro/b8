export type Landscape = 'operational' | 'capital';

export type PropertyType = 'primary' | 'rental';

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
  property_id: number | null;
}

export interface BudgetCategory {
  id: number;
  name: string;
  annual_budget: number;
  landscape: Landscape;
  exclude_from_budget: boolean;
  is_income: boolean;
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

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };
