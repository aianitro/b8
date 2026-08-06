import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse, BudgetCategory } from '@/shared/types';
import { normalizeMonthlyAmounts, resolveAnnualBudget } from '@/lib/budgetMath';

export async function GET() {
  const result = await db.query<BudgetCategory>(
    'SELECT id, name, annual_budget, landscape, exclude_from_budget, is_income, dedicated_account_id, monthly_amounts, created_at FROM budget_categories ORDER BY name'
  );
  return Response.json({ success: true, data: result.rows } satisfies ApiResponse<BudgetCategory[]>);
}

// Exactly 12 values (Jan-Dec), each a non-negative amount. An invalid length or all-zero
// array is treated the same as "no custom schedule" (falls back to the flat annual/12 split).
export async function POST(req: NextRequest) {
  const { name, annual_budget, landscape, is_income, dedicated_account_id, monthly_amounts } = await req.json();
  if (!name || typeof annual_budget !== 'number' || !landscape) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'name, annual_budget, and landscape required' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }
  try {
    const amounts = normalizeMonthlyAmounts(monthly_amounts);
    // When a schedule is provided, its total is authoritative — mirrors the PATCH behavior so
    // annual_budget and the schedule can never drift apart, even if a caller passes both.
    const resolvedAnnualBudget = resolveAnnualBudget(amounts, annual_budget);
    const result = await db.query<BudgetCategory>(
      'INSERT INTO budget_categories (name, annual_budget, landscape, is_income, dedicated_account_id, monthly_amounts) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name.trim(), resolvedAnnualBudget, landscape, Boolean(is_income), dedicated_account_id ?? null, amounts]
    );
    return Response.json({ success: true, data: result.rows[0] } satisfies ApiResponse<BudgetCategory>, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to save';
    const isDupe = msg.includes('unique') || msg.includes('duplicate');
    if (!isDupe) console.error('[categories POST]', msg);
    return Response.json(
      { success: false, error: { code: 'DB_ERROR', message: isDupe ? `Category "${name.trim()}" already exists in ${landscape}` : 'Failed to save category' } } satisfies ApiResponse<never>,
      { status: 409 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id } = body;
  if (typeof id !== 'number') {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'id required' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }
  if ('is_income' in body) {
    await db.query('UPDATE budget_categories SET is_income = $1 WHERE id = $2', [Boolean(body.is_income), id]);
  } else if ('annual_budget' in body) {
    const amount = Number(body.annual_budget);
    if (!Number.isFinite(amount) || amount < 0) {
      return Response.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'annual_budget must be a non-negative number' } } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }
    // A category with a custom monthly schedule has its annual_budget derived from that
    // schedule's total — edit the schedule instead, don't let the two drift apart.
    const existing = await db.query<{ monthly_amounts: string[] | null }>(
      'SELECT monthly_amounts FROM budget_categories WHERE id = $1', [id]
    );
    if (existing.rows[0]?.monthly_amounts) {
      return Response.json(
        { success: false, error: { code: 'HAS_SCHEDULE', message: 'This category has a custom monthly schedule — edit amounts there instead' } } satisfies ApiResponse<never>,
        { status: 409 }
      );
    }
    await db.query('UPDATE budget_categories SET annual_budget = $1 WHERE id = $2', [amount, id]);
  } else if ('dedicated_account_id' in body) {
    await db.query('UPDATE budget_categories SET dedicated_account_id = $1 WHERE id = $2', [body.dedicated_account_id ?? null, id]);
  } else if ('monthly_amounts' in body) {
    const amounts = normalizeMonthlyAmounts(body.monthly_amounts);
    // Keep annual_budget in sync with the schedule's total so every other view (annual budget
    // page, dashboard totals) stays correct without each needing schedule-aware math.
    await db.query(
      `UPDATE budget_categories
       SET monthly_amounts = $1,
           annual_budget = CASE WHEN $1::numeric[] IS NULL THEN annual_budget ELSE (SELECT COALESCE(SUM(x), 0) FROM unnest($1::numeric[]) x) END
       WHERE id = $2`,
      [amounts, id]
    );
  } else if ('name' in body) {
    const trimmed = String(body.name ?? '').trim();
    if (!trimmed) {
      return Response.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'name cannot be empty' } } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }
    await db.query('UPDATE budget_categories SET name = $1 WHERE id = $2', [trimmed, id]);
  } else {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'is_income, annual_budget, dedicated_account_id, monthly_amounts, or name required' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }
  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  await db.query('DELETE FROM budget_categories WHERE id = $1', [id]);
  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}
