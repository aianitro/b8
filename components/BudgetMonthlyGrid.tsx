import db from '@/lib/db';
import type { Landscape } from '@/shared/types';
import BudgetMonthlyGridClient from './BudgetMonthlyGridClient';

export type GridRow = {
  id: number;
  category: string;
  landscape: Landscape;
  annual_budget: number;
  monthly_amounts: number[] | null;
  months_budget: number[]; // expected amount per month, index 0–11
  months_upcoming: number[]; // projected amount for months after current, index 0–11 (0 for current/past)
  is_income: boolean;
  sort_order: number;
  months: number[]; // index 0–11
  ytd: number;
};

type DbRow = {
  id: number;
  name: string;
  landscape: Landscape;
  annual_budget: string;
  monthly_amounts: string[] | null;
  is_income: boolean;
  sort_order: number;
  month: number;
  amount: string;
};

// monthly_amounts unset -> spread annual_budget evenly across all 12 months (legacy behavior);
// otherwise each month uses its own explicit expected amount.
function monthsBudget(annual: number, monthlyAmounts: number[] | null): number[] {
  if (monthlyAmounts && monthlyAmounts.length === 12) return monthlyAmounts;
  return new Array(12).fill(annual / 12);
}

// Projected amount for months after the current one. A category with an explicit monthly
// schedule just uses its own scheduled amount per future month. Otherwise the remaining
// annual budget (annual - YTD realized) is spread evenly across the months still to come —
// current month included in that count — so the projection self-corrects as the year goes
// (spent less than pace so far -> higher projected months ahead, and vice versa).
function monthsUpcoming(
  annual: number,
  monthlyAmounts: number[] | null,
  monthsBudgetArr: number[],
  ytd: number,
  currentMonth: number
): number[] {
  const upcoming = new Array(12).fill(0);
  if (monthlyAmounts) {
    for (let i = currentMonth + 1; i < 12; i++) upcoming[i] = monthsBudgetArr[i];
    return upcoming;
  }
  const remainingMonths = 12 - currentMonth;
  if (remainingMonths <= 0) return upcoming;
  const perMonth = (annual - ytd) / remainingMonths;
  for (let i = currentMonth + 1; i < 12; i++) upcoming[i] = perMonth;
  return upcoming;
}

async function getGridData(landscape: Landscape, currentMonth: number): Promise<GridRow[]> {
  const result = await db.query<DbRow>(`
    SELECT bc.id, bc.name, bc.landscape, bc.annual_budget::text, bc.monthly_amounts, bc.is_income, bc.sort_order,
           m.month::int AS month,
           CASE
             WHEN bc.is_income THEN
               COALESCE(-SUM(t.amount), 0)
             ELSE
               COALESCE(SUM(t.amount), 0)
           END::text AS amount
    FROM budget_categories bc
    CROSS JOIN generate_series(1, 12) AS m(month)
    LEFT JOIN transactions t
      ON t.mapped_category = bc.name
      AND EXTRACT(YEAR FROM t.date) = EXTRACT(YEAR FROM CURRENT_DATE)
      AND EXTRACT(MONTH FROM t.date) = m.month
      AND t.hidden = FALSE
    LEFT JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
    WHERE bc.exclude_from_budget = FALSE
      AND bc.landscape = $1
      AND (t.id IS NULL OR a.id IS NOT NULL)
    GROUP BY bc.id, bc.name, bc.landscape, bc.annual_budget, bc.monthly_amounts, bc.is_income, bc.sort_order, m.month
    ORDER BY bc.is_income DESC, bc.sort_order, bc.name, m.month
  `, [landscape]);

  const map = new Map<number, GridRow>();
  for (const row of result.rows) {
    if (!map.has(row.id)) {
      const annual = Number(row.annual_budget);
      const monthlyAmounts = row.monthly_amounts ? row.monthly_amounts.map(Number) : null;
      map.set(row.id, {
        id: row.id,
        category: row.name,
        landscape: row.landscape,
        annual_budget: annual,
        monthly_amounts: monthlyAmounts,
        months_budget: monthsBudget(annual, monthlyAmounts),
        months_upcoming: new Array(12).fill(0), // filled below, once each row's full YTD is known
        is_income: row.is_income,
        sort_order: row.sort_order,
        months: new Array(12).fill(0),
        ytd: 0,
      });
    }
    const entry = map.get(row.id)!;
    const amount = Number(row.amount);
    entry.months[row.month - 1] = amount;
    entry.ytd += amount;
  }

  for (const entry of map.values()) {
    entry.months_upcoming = monthsUpcoming(
      entry.annual_budget,
      entry.monthly_amounts,
      entry.months_budget,
      entry.ytd,
      currentMonth
    );
  }

  return Array.from(map.values());
}

async function getBeginningBalance(landscape: Landscape): Promise<number> {
  const year = new Date().getFullYear();
  const result = await db.query<{ beginning_balance: string }>(
    'SELECT beginning_balance FROM budget_settings WHERE year = $1 AND landscape = $2',
    [year, landscape]
  );
  return Number(result.rows[0]?.beginning_balance ?? 0);
}

async function getUncategorized(landscape: Landscape): Promise<{ income: number[]; expense: number[] }> {
  const result = await db.query<{ month: number; type: string; amount: string }>(`
    SELECT
      EXTRACT(MONTH FROM t.date)::int AS month,
      CASE WHEN t.amount < 0 THEN 'income' ELSE 'expense' END AS type,
      ABS(SUM(t.amount))::text AS amount
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE AND a.landscape = $1
    WHERE t.mapped_category IS NULL
      AND t.hidden = FALSE
      AND EXTRACT(YEAR FROM t.date) = EXTRACT(YEAR FROM CURRENT_DATE)
    GROUP BY EXTRACT(MONTH FROM t.date)::int,
             CASE WHEN t.amount < 0 THEN 'income' ELSE 'expense' END
  `, [landscape]);

  const income  = new Array(12).fill(0);
  const expense = new Array(12).fill(0);
  for (const row of result.rows) {
    (row.type === 'income' ? income : expense)[row.month - 1] = Number(row.amount);
  }
  return { income, expense };
}

export default async function BudgetMonthlyGrid({ landscape }: { landscape: Landscape }) {
  const currentMonth = new Date().getMonth();
  const [rows, beginningBalance, uncategorized] = await Promise.all([
    getGridData(landscape, currentMonth),
    getBeginningBalance(landscape),
    getUncategorized(landscape),
  ]);
  return (
    <BudgetMonthlyGridClient
      key={landscape}
      rows={rows}
      currentMonth={currentMonth}
      beginningBalance={beginningBalance}
      uncategorizedIncome={uncategorized.income}
      uncategorizedExpense={uncategorized.expense}
    />
  );
}
