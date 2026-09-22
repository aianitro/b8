import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse } from '@b8/contracts/types';
import { createLogger } from '@/lib/logger';
import { monthsBudget } from '@/lib/domain/budgetPlan';
import { loadYearEnd } from '@/lib/yearEndRead';
import { BudgetGridDataSchema, type BudgetGridData, type BudgetGridRow } from '@b8/contracts/budgetGrid';

const log = createLogger('budget-grid');

export const dynamic = 'force-dynamic';

/**
 * The monthly budget grid — twelve months by category, plan against actual.
 *
 * THE THIRD ENDPOINT A SECOND CLIENT HAS HAD TO CREATE. The web renders this page as a server
 * component reading the database directly, as it did for accounts, properties and this; each gap was
 * invisible until something other than the web asked for the same data. `/api/v1/overview` was built
 * to be the shared payload and it carries the CURRENT month, not the year by month — that is a
 * different question, so this is a different endpoint rather than a widened one.
 *
 * The SQL is the grid's own, unchanged in what it filters: `exclude_from_budget = FALSE`, hidden
 * transactions dropped, and only accounts with `track_transactions` — an untracked account's
 * transactions are visible in the ledger and must not count toward a budget.
 */
export async function GET(req: NextRequest) {
  const landscape = req.nextUrl.searchParams.get('landscape') ?? 'operational';
  if (landscape !== 'operational' && landscape !== 'capital') {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'landscape must be operational or capital' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  try {
    const now = new Date();
    const year = now.getFullYear();
    const currentMonth = now.getMonth();

    const [grid, settings, yearEnd] = await Promise.all([
      db.query<{
        id: number; name: string; annual_budget: string; monthly_amounts: string[] | null;
        is_income: boolean; month: number; amount: string;
      }>(`
        SELECT bc.id, bc.name, bc.annual_budget::text, bc.monthly_amounts, bc.is_income,
               m.month::int AS month,
               CASE WHEN bc.is_income THEN COALESCE(-SUM(t.amount), 0)
                    ELSE COALESCE(SUM(t.amount), 0) END::text AS amount
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
         GROUP BY bc.id, bc.name, bc.annual_budget, bc.monthly_amounts, bc.is_income, bc.sort_order, m.month
         ORDER BY bc.is_income DESC, bc.sort_order, bc.name, m.month
      `, [landscape]),
      db.query<{ beginning_balance: string }>(
        'SELECT beginning_balance FROM budget_settings WHERE year = $1 AND landscape = $2',
        [year, landscape]
      ),
      // THE ONE READER, not a second definition. The budget page carries the comment that says why:
      // "from the one reader the dashboard also uses — see lib/yearEndRead.ts for why this is not
      // computed here any more."
      //
      // This endpoint DID compute it, briefly, as `beginningBalance + budgeted income − budgeted
      // expense`. Measured against `loadYearEnd` on the same data that gave 202,300 against 144,578 —
      // a $57,722 disagreement, because the real definition takes closed months on FACT and only the
      // remainder on plan, while a plan-only figure ignores the year that has already happened. The
      // phone would have shown a different Projected P/L from the dashboard and the budget page, on
      // the same screen furniture, which is the defect this repo centralised the figure to prevent.
      loadYearEnd(landscape, { year, month: currentMonth }),
    ]);

    // One row per category, twelve actuals each. The query returns a row per category-month, so the
    // fold is over a map rather than a group-by in JS — the same shape the grid builds.
    const byId = new Map<number, BudgetGridRow>();
    for (const r of grid.rows) {
      if (!byId.has(r.id)) {
        const annual = Number(r.annual_budget);
        byId.set(r.id, {
          id: r.id,
          category: r.name,
          isIncome: r.is_income,
          annualBudget: annual,
          // The SHARED rule, not a fifth copy of the even spread. See lib/domain/budgetPlan.ts.
          plan: monthsBudget(annual, r.monthly_amounts ? r.monthly_amounts.map(Number) : null),
          actual: new Array(12).fill(0),
          ytd: 0,
        });
      }
      const row = byId.get(r.id)!;
      const amount = Number(r.amount);
      row.actual[r.month - 1] = amount;
      row.ytd += amount;
    }

    const rows = Array.from(byId.values());
    const expense = rows.filter((r) => !r.isIncome);

    const budget = expense.reduce((a, r) => a + r.annualBudget, 0);
    const spent = expense.reduce((a, r) => a + r.ytd, 0);
    const beginningBalance = Number(settings.rows[0]?.beginning_balance ?? 0);

    const data: BudgetGridData = {
      year,
      landscape,
      currentMonth,
      beginningBalance,
      rows,
      totals: {
        budget,
        spent,
        remaining: budget - spent,
        // Straight from `loadYearEnd` — the same figure, to the cent, that the dashboard KPI and the
        // budget page header show. Not recomputed here. See the note on the reader above.
        projectedProfitLoss: yearEnd.profitLoss,
      },
    };

    return Response.json(
      { success: true, data: BudgetGridDataSchema.parse(data) } satisfies ApiResponse<BudgetGridData>
    );
  } catch (err) {
    log.error('budget grid read failed', { error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { success: false, error: { code: 'READ_FAILED', message: 'Could not load the budget.' } } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}
