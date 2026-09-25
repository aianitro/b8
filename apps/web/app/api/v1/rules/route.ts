import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse } from '@b8/contracts/types';

/**
 * Create or replace a rule, of either kind, and report what it changed behind it.
 *
 * ─── Why creating a rule also re-files ────────────────────────────────────────────────────────
 *
 * A rule created from the editor is the owner saying "this payee is always this". Leaving the
 * earlier rows of that payee as they are would answer half of that, and the half it leaves is the
 * backlog — the whole reason they noticed. So the insert is followed by an apply, scoped to the
 * one rule, and the count comes back so the caller can say what happened rather than implying it.
 *
 * MANUAL FILING IS NEVER OVERWRITTEN. The WHERE below touches rows that are unfiled or were filed
 * by a rule, and leaves `rule_applied = FALSE` alone — the same guarantee `/rules/apply` gives, and
 * the reason the owner's 114 hand-corrections survived the rule that caused them.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const mapped: unknown = body.mapped_category;
  const plaidCategory: unknown = body.plaid_category ?? null;
  const merchantName: unknown = body.merchant_name ?? null;

  if (typeof mapped !== 'string' || mapped.trim() === '') {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'mapped_category required' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }
  // Exactly one match kind, mirroring the CHECK. Refused here as well as there so the caller gets
  // a sentence rather than a constraint violation.
  const hasCategory = typeof plaidCategory === 'string' && plaidCategory.trim() !== '';
  const hasMerchant = typeof merchantName === 'string' && merchantName.trim() !== '';
  if (hasCategory === hasMerchant) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'exactly one of plaid_category or merchant_name required' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  if (hasMerchant) {
    const name = (merchantName as string).trim();
    await db.query(
      `INSERT INTO category_rules (merchant_name, mapped_category)
       VALUES ($1, $2)
       ON CONFLICT (LOWER(merchant_name)) WHERE merchant_name IS NOT NULL
       DO UPDATE SET mapped_category = EXCLUDED.mapped_category`,
      [name, mapped]
    );
    const { rows } = await db.query<{ count: string }>(
      `WITH updated AS (
         UPDATE transactions SET mapped_category = $2, rule_applied = TRUE
          WHERE LOWER(TRIM(merchant_name)) = LOWER($1)
            AND (mapped_category IS NULL OR rule_applied = TRUE)
            AND mapped_category IS DISTINCT FROM $2
          RETURNING id
       ) SELECT COUNT(*)::text AS count FROM updated`,
      [name, mapped]
    );
    return Response.json(
      { success: true, data: { refiled: Number(rows[0].count) } } satisfies ApiResponse<{ refiled: number }>
    );
  }

  const category = (plaidCategory as string).trim();
  await db.query(
    `INSERT INTO category_rules (plaid_category, mapped_category)
     VALUES ($1, $2)
     ON CONFLICT (plaid_category) DO UPDATE SET mapped_category = EXCLUDED.mapped_category`,
    [category, mapped]
  );
  const { rows } = await db.query<{ count: string }>(
    `WITH updated AS (
       UPDATE transactions SET mapped_category = $2, rule_applied = TRUE
        WHERE plaid_category = $1
          AND (mapped_category IS NULL OR rule_applied = TRUE)
          AND mapped_category IS DISTINCT FROM $2
        RETURNING id
     ) SELECT COUNT(*)::text AS count FROM updated`,
    [category, mapped]
  );
  return Response.json(
    { success: true, data: { refiled: Number(rows[0].count) } } satisfies ApiResponse<{ refiled: number }>
  );
}

/** Delete by whichever key the rule is keyed on. Does NOT un-file anything it filed — a rule is a
 *  standing instruction, and removing it should stop future filing rather than rewrite history the
 *  owner may since have checked. */
export async function DELETE(req: NextRequest) {
  const { plaid_category, merchant_name } = await req.json();
  if (typeof merchant_name === 'string' && merchant_name.trim() !== '') {
    await db.query('DELETE FROM category_rules WHERE LOWER(merchant_name) = LOWER($1)', [merchant_name.trim()]);
  } else {
    await db.query('DELETE FROM category_rules WHERE plaid_category = $1', [plaid_category]);
  }
  return Response.json({ success: true, data: null } satisfies ApiResponse<null>);
}
