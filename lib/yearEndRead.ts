import db from './db';
import { projectYearEnd, projectYearEndByMonth, monthlyRow, type MonthPoint } from './domain/yearEnd';

/**
 * Where a landscape's year lands, read once and shared.
 *
 * The budget header and the dashboard both show this figure, and it is the one the owner steers
 * by — the operational budget is currently tuned to close near break-even. Two copies of the query
 * and the arithmetic behind it is BUILD.md §1's drifting-definitions defect aimed at exactly the
 * wrong number, and this file has already watched that happen twice: the card and the monthly grid
 * disagreed by $2,175 because one of them counted uncategorized money and the other did not, and
 * by a further $646 before that.
 *
 * So the uncategorized handling lives HERE rather than in each caller. A page that forgets to add
 * it produces a plausible figure that is quietly wrong, which is the failure that took an hour to
 * find the first time.
 */
export interface YearEndRead {
  income: number;
  expense: number;
  /** `income − expense` at year end, if the rest of the year goes to plan. */
  profitLoss: number;
  /** Income less spend so far this year — fact, not forecast. */
  netToDate: number;
  /** Cumulative P/L, Jan–Dec, settled then forecast. The last value is `profitLoss`. */
  monthly: MonthPoint[];
}

export async function loadYearEnd(
  landscape: 'operational' | 'capital',
  asOf: { year: number; month: number },
): Promise<YearEndRead> {
  const [cats, uncat] = await Promise.all([
    db.query<{
      is_income: boolean; annual_budget: string; monthly_amounts: string[] | null;
      closed_months: string; current_month: string; ytd: string; monthly_actuals: string[] | null;
    }>(`
      SELECT bc.is_income, bc.annual_budget::text, bc.monthly_amounts,
             COALESCE(SUM(t.amount) FILTER (WHERE EXTRACT(MONTH FROM t.date) < $3), 0)::text AS closed_months,
             COALESCE(SUM(t.amount) FILTER (WHERE EXTRACT(MONTH FROM t.date) = $3), 0)::text AS current_month,
             COALESCE(SUM(t.amount), 0)::text AS ytd,
             -- Per month, Jan–Dec, so the chart and the card read one set of actuals. Built as an
             -- array here rather than as twelve rows so a category is still one row out.
             (SELECT ARRAY(
                SELECT COALESCE(SUM(t2.amount), 0)
                  FROM generate_series(1, 12) AS g(m)
                  LEFT JOIN transactions t2
                    ON t2.mapped_category = bc.name
                   AND EXTRACT(YEAR FROM t2.date) = $1
                   AND EXTRACT(MONTH FROM t2.date) = g.m
                   AND t2.hidden = FALSE
                   AND t2.account_id IN (SELECT id FROM accounts WHERE track_transactions = TRUE)
                 GROUP BY g.m ORDER BY g.m))::text[] AS monthly_actuals
        FROM budget_categories bc
        LEFT JOIN transactions t ON t.mapped_category = bc.name
          AND EXTRACT(YEAR FROM t.date) = $1 AND t.hidden = FALSE
        LEFT JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
       WHERE bc.exclude_from_budget = FALSE
         AND bc.landscape = $2
         AND (t.id IS NULL OR a.id IS NOT NULL)
       GROUP BY bc.id, bc.is_income, bc.annual_budget, bc.monthly_amounts
    `, [asOf.year, landscape, asOf.month + 1]),

    // Unfiled rows, scoped by the ACCOUNT's landscape because they have no category to carry one.
    // They have no schedule and nothing to project, so they enter as the actual they already are.
    db.query<{ total_out: string; total_in: string }>(`
      SELECT COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::text       AS total_out,
             COALESCE(ABS(SUM(t.amount) FILTER (WHERE t.amount < 0)), 0)::text  AS total_in
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE AND a.landscape = $2
       WHERE t.mapped_category IS NULL AND t.hidden = FALSE
         AND EXTRACT(YEAR FROM t.date) = $1
    `, [asOf.year, landscape]),
  ]);

  // `monthlyRow` derives the aggregate fields from the same array the series reads, so the two
  // cannot be handed different actuals — see its docblock for what that cost the first time.
  const toRow = (r: typeof cats.rows[number]) => monthlyRow(
    Number(r.annual_budget),
    r.monthly_amounts?.length === 12 ? r.monthly_amounts.map(Number) : null,
    (r.monthly_actuals ?? []).map(Number),
    asOf.month,
  );

  const incomeRows  = cats.rows.filter((r) => r.is_income);
  const expenseRows = cats.rows.filter((r) => !r.is_income);
  const uncatIn  = Number(uncat.rows[0]?.total_in ?? 0);
  const uncatOut = Number(uncat.rows[0]?.total_out ?? 0);

  const incomeMapped  = incomeRows.map(toRow);
  const expenseMapped = expenseRows.map(toRow);

  const projected = projectYearEnd(incomeMapped, expenseMapped, asOf.month);
  const income  = projected.income + uncatIn;
  const expense = projected.expense + uncatOut;

  // Uncategorized money has no month to sit in that this reader can defend — it is a year-to-date
  // total, not a series — so it is folded into the CURRENT month's cumulative rather than smeared
  // across twelve. That keeps December equal to `profitLoss`, which a test pins, and puts the
  // unfiled money where the reader can still act on it.
  const uncatNet = uncatIn - uncatOut;
  const monthly = projectYearEndByMonth(incomeMapped, expenseMapped, asOf.month)
    .map((p, m) => (m >= asOf.month ? { ...p, cumulative: p.cumulative + uncatNet } : p));

  const receivedToDate = -incomeRows.reduce((s, r) => s + Number(r.ytd), 0) + uncatIn;
  const spentToDate    =  expenseRows.reduce((s, r) => s + Number(r.ytd), 0) + uncatOut;

  return {
    income, expense,
    profitLoss: income - expense,
    netToDate: receivedToDate - spentToDate,
    monthly,
  };
}
