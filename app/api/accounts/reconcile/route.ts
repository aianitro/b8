import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { findBalanceDrift } from '@/lib/drift';
import { createLogger } from '@/lib/logger';
import type { ApiResponse } from '@/shared/types';

const log = createLogger('reconcile');

interface Reconciled { accountId: string; name: string; beginningBalance: number }

// Sets an account's beginning balance to the figure that makes its computed ledger agree with
// the bank. It does not touch a single transaction — ledger = beginning + Σ transactions, so
// shifting the opening figure by exactly the drift lands the ledger on the bank's number.
//
// The balances are recomputed here rather than accepted from the request. The client already
// knows them (the alert card displays them), but a route that writes whatever number it is
// handed is a route that writes whatever number anything hands it — and this one writes
// directly into the net-worth calculation.
export async function POST(req: NextRequest) {
  try {
    const { accountIds } = await req.json() as { accountIds?: unknown };

    if (!Array.isArray(accountIds) || accountIds.length === 0 || !accountIds.every((id) => typeof id === 'string')) {
      return Response.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'accountIds must be a non-empty array of strings' } } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }

    const requested = new Set(accountIds as string[]);
    const findings = (await findBalanceDrift()).filter((f) => requested.has(f.accountId));

    // Refuses accounts that already had a beginning balance. Drift there is evidence of a
    // missing or duplicated transaction, and moving the opening figure to absorb it would
    // hide the very problem this feature exists to expose — the spreadsheet's `correction`
    // row, reinvented. Those need the transaction fixed, not the balance nudged.
    const unsafe = findings.filter((f) => !f.safeToDerive);
    if (unsafe.length > 0) {
      return Response.json(
        {
          success: false,
          error: {
            code: 'UNSAFE_RECONCILE',
            message: `${unsafe.map((f) => f.name).join(', ')} already had a beginning balance. Drift there means a transaction is missing or duplicated — adjusting the opening figure would hide it rather than fix it.`,
          },
        } satisfies ApiResponse<never>,
        { status: 409 }
      );
    }

    const year = new Date().getFullYear();
    const reconciled: Reconciled[] = [];
    for (const f of findings) {
      await db.query(
        `INSERT INTO account_balances (account_id, year, beginning_balance)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id, year) DO UPDATE SET beginning_balance = EXCLUDED.beginning_balance`,
        [f.accountId, year, f.suggestedBeginningBalance]
      );
      reconciled.push({ accountId: f.accountId, name: f.name, beginningBalance: f.suggestedBeginningBalance });
    }

    log.info('reconciled beginning balances', { year, count: reconciled.length });

    return Response.json({ success: true, data: { reconciled } } satisfies ApiResponse<{ reconciled: Reconciled[] }>);
  } catch (err) {
    log.error('reconcile failed', { error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Could not reconcile' } } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}
