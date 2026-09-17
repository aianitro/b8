import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse } from '@/shared/types';
import { createLogger } from '@/lib/logger';

const log = createLogger('import/csv');

type CsvRow = { date: string; description: string; amount: number };

function makeId(accountId: string, date: string, amount: number, description: string): string {
  // Deterministic ID so re-importing the same file is idempotent
  const raw = `${accountId}|${date}|${amount}|${description}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = Math.imul(31, hash) + raw.charCodeAt(i) | 0;
  }
  return `csv_${Math.abs(hash).toString(36)}`;
}

export async function POST(req: NextRequest) {
  try {
    const { accountId, rows } = await req.json() as { accountId: string; rows: CsvRow[] };

    if (!accountId || !Array.isArray(rows) || rows.length === 0) {
      return Response.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'accountId and rows required' } } satisfies ApiResponse<null>,
        { status: 400 }
      );
    }

    // Verify account exists
    const acct = await db.query('SELECT id FROM accounts WHERE id = $1', [accountId]);
    if (acct.rows.length === 0) {
      return Response.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Account not found' } } satisfies ApiResponse<null>,
        { status: 404 }
      );
    }

    let imported = 0;
    let skipped = 0;

    for (const row of rows) {
      const txnId = makeId(accountId, row.date, row.amount, row.description);
      // CSV imports don't have Plaid categories — no rule can apply
      const res = await db.query(
        `INSERT INTO transactions
           (plaid_transaction_id, account_id, date, amount, name, merchant_name, plaid_category, mapped_category, rule_applied)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, FALSE)
         ON CONFLICT (plaid_transaction_id) DO NOTHING`,
        [txnId, accountId, row.date, row.amount, row.description, row.description]
      );
      if (res.rowCount === 1) imported++; else skipped++;
    }

    return Response.json({ success: true, data: { imported, skipped } } satisfies ApiResponse<{ imported: number; skipped: number }>);
  } catch (err) {
    log.error('request failed', { error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { success: false, error: { code: 'IMPORT_ERROR', message: 'Import failed' } } satisfies ApiResponse<null>,
      { status: 500 }
    );
  }
}
