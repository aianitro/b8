// `POST /api/v1/accounts/{id}/statement/transfers` — record shares received from a statement.
//
// Each row the owner ticked in the statement preview becomes one income transaction on the
// account, in the shape the earlier quarters' vests were entered by hand: named for what it was
// and how many shares, merchant "<Company> RSU Vest" or "<Company> ESPP Purchase", money in, filed
// under `Other income (C)` when that category exists and left uncategorized when it does not.
//
// A row already in the ledger — the same date and the same money in, the test the preview marks
// it by — is skipped, so uploading a statement twice records each vest once.

import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import db from '@/lib/db';
import { roundCents } from '@/lib/budgetMath';
import { companyName } from '@/lib/domain/brokerageStatement';
import type { ApiResponse } from '@b8/contracts/types';

/** Where the hand-entered vests were filed. Looked up, not assumed: a renamed category files nothing. */
const INCOME_CATEGORY = 'Other income (C)';

type Kind = 'rsu' | 'espp';
interface Row { date: string; security: string; quantity: number; amount: number; kind: Kind }

const refuse = (message: string, status = 400) =>
  Response.json({ success: false, error: { code: 'INVALID_INPUT', message } } satisfies ApiResponse<never>, { status });

function isRow(r: unknown): r is Row {
  if (typeof r !== 'object' || r === null) return false;
  const x = r as Record<string, unknown>;
  return typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date)
    && typeof x.security === 'string' && x.security.trim() !== ''
    && typeof x.quantity === 'number' && Number.isFinite(x.quantity) && x.quantity > 0
    && typeof x.amount === 'number' && Number.isFinite(x.amount) && x.amount > 0
    && (x.kind === 'rsu' || x.kind === 'espp');
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null) as { rows?: unknown } | null;
  const rows = body?.rows;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 50 || !rows.every(isRow)) {
    return refuse('rows must be a non-empty list of { date, security, quantity, amount, kind }');
  }

  const account = await db.query<{ valuation_mode: string; is_liability: boolean; linked: boolean }>(
    'SELECT valuation_mode, is_liability, access_token IS NOT NULL AS linked FROM accounts WHERE id = $1', [id]
  );
  if (account.rows.length === 0) return refuse('Account not found', 404);
  if (account.rows[0].valuation_mode !== 'valuation' || account.rows[0].is_liability || account.rows[0].linked) {
    return refuse('Statement activity can be recorded only on an investment account valued by hand.');
  }

  const category = await db.query('SELECT 1 FROM budget_categories WHERE name = $1', [INCOME_CATEGORY]);
  const mappedCategory = category.rows.length > 0 ? INCOME_CATEGORY : null;

  // Recorded per (date, amount) key, up to as many rows as were sent for that key and beyond as many
  // as the ledger already holds — so two identical vests on one day are two transactions, and a
  // re-upload adds neither. Counted inside one transaction under an advisory lock on the account,
  // so two submissions at once cannot both see the same count.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.date}|${roundCents(r.amount)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const client = await db.connect();
  let recorded = 0;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`statement-transfers:${id}`]);
    for (const group of groups.values()) {
      const { date, amount } = group[0];
      const have = await client.query<{ n: string }>(
        'SELECT COUNT(*) AS n FROM transactions WHERE account_id = $1 AND date = $2::date AND amount = $3',
        [id, date, -roundCents(amount)]
      );
      for (const r of group.slice(Number(have.rows[0].n))) {
        const company = companyName(r.security);
        const name = r.kind === 'rsu'
          ? `RSU Vesting - ${company} (${r.quantity} sh, from statement)`
          : `ESPP Purchase - ${company} (${r.quantity} sh, from statement)`;
        const merchant = r.kind === 'rsu' ? `${company} RSU Vest` : `${company} ESPP Purchase`;
        // Money in is negative in this ledger.
        await client.query(
          `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, merchant_name, mapped_category)
           VALUES ($1, $2, $3::date, $4, $5, $6, $7)`,
          [`manual_${r.kind}_${randomUUID()}`, id, r.date, -roundCents(r.amount), name, merchant, mappedCategory]
        );
        recorded += 1;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return Response.json(
    { success: true, data: { recorded, skipped: rows.length - recorded } } satisfies ApiResponse<{ recorded: number; skipped: number }>,
    { status: 201 }
  );
}
