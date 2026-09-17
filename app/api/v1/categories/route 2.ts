import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse, BudgetCategory } from '@/shared/types';
import { normalizeMonthlyAmounts, resolveAnnualBudget } from '@/lib/budgetMath';
import { CONTROL_MODES, parseControlMode, conflictsWithDebtService } from '@/lib/categoryControl';
import { createLogger } from '@/lib/logger';

const log = createLogger('categories');

export async function GET() {
  const result = await db.query<BudgetCategory>(
    'SELECT id, name, annual_budget, landscape, exclude_from_budget, is_income, control_mode, dedicated_account_id, monthly_amounts, created_at FROM budget_categories ORDER BY name'
  );
  return Response.json({ success: true, data: result.rows } satisfies ApiResponse<BudgetCategory[]>);
}

// Exactly 12 values (Jan-Dec), each a non-negative amount. An invalid length or all-zero
// array is treated the same as "no custom schedule" (falls back to the flat annual/12 split).
export async function POST(req: NextRequest) {
  const { name, annual_budget, landscape, is_income, dedicated_account_id, monthly_amounts, control_mode } = await req.json();
  if (!name || typeof annual_budget !== 'number' || !landscape) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'name, annual_budget, and landscape required' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }
  // Optional, and absent means 'fixed' — the column's own default, chosen so an unreviewed
  // category stays out of the scored set rather than being counted as a behavioural choice
  // nobody made. Present-but-invalid is refused rather than coerced to that default, which
  // would look like success while silently doing the opposite of what was asked.
  const controlMode = control_mode === undefined ? 'fixed' : parseControlMode(control_mode);
  if (controlMode === null) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: `control_mode must be one of ${CONTROL_MODES.join(', ')}` } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }
  try {
    const amounts = normalizeMonthlyAmounts(monthly_amounts);
    // When a schedule is provided, its total is authoritative — mirrors the PATCH behavior so
    // annual_budget and the schedule can never drift apart, even if a caller passes both.
    const resolvedAnnualBudget = resolveAnnualBudget(amounts, annual_budget);
    const result = await db.query<BudgetCategory>(
      'INSERT INTO budget_categories (name, annual_budget, landscape, is_income, dedicated_account_id, monthly_amounts, control_mode) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [name.trim(), resolvedAnnualBudget, landscape, Boolean(is_income), dedicated_account_id ?? null, amounts, controlMode]
    );
    return Response.json({ success: true, data: result.rows[0] } satisfies ApiResponse<BudgetCategory>, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to save';
    const isDupe = msg.includes('unique') || msg.includes('duplicate');
    if (!isDupe) log.error('POST failed', { error: msg });
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
  } else if ('control_mode' in body) {
    const mode = parseControlMode(body.control_mode);
    if (mode === null) {
      return Response.json(
        { success: false, error: { code: 'INVALID_INPUT', message: `control_mode must be one of ${CONTROL_MODES.join(', ')}` } } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }
    // Read is_debt_service first so the coupling constraint comes back as a stated 409 rather
    // than as a raw 23514 through a handler that has no try/catch — the CHECK would refuse this
    // either way, and the only question is whether the caller learns why.
    const existing = await db.query<{ is_debt_service: boolean }>(
      'SELECT is_debt_service FROM budget_categories WHERE id = $1', [id]
    );
    if (!existing.rows[0]) {
      return Response.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'No such category' } } satisfies ApiResponse<never>,
        { status: 404 }
      );
    }
    if (conflictsWithDebtService(mode, existing.rows[0].is_debt_service)) {
      return Response.json(
        { success: false, error: { code: 'DEBT_SERVICE_FIXED', message: 'A debt-service category is the fixed case — its payment is not a monthly decision' } } satisfies ApiResponse<never>,
        { status: 409 }
      );
    }
    await db.query('UPDATE budget_categories SET control_mode = $1 WHERE id = $2', [mode, id]);
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
      { success: false, error: { code: 'INVALID_INPUT', message: 'is_income, control_mode, annual_budget, dedicated_account_id, monthly_amounts, or name required' } } satisfies ApiResponse<never>,
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
