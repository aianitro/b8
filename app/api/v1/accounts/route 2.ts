import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import db from '@/lib/db';
import { roundCents } from '@/lib/budgetMath';
import type { ApiResponse, Landscape, ValuationMode } from '@/shared/types';
import { createLogger } from '@/lib/logger';

const log = createLogger('accounts');

export async function POST(req: NextRequest) {
  try {
    const { name, bank, type, subtype, landscape, valuation_mode, is_liability, initial_value } = await req.json() as {
      name: string;
      bank?: string;
      type: string;
      subtype?: string | null;
      landscape: Landscape;
      valuation_mode?: ValuationMode;
      is_liability?: boolean;
      initial_value?: number | null;
    };

    if (!name?.trim() || !type?.trim() || !landscape) {
      return Response.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'name, type, and landscape are required' } } satisfies ApiResponse<null>,
        { status: 400 }
      );
    }

    const valuationMode: ValuationMode = valuation_mode === 'valuation' ? 'valuation' : 'ledger';
    const isLiability = valuationMode === 'valuation' && is_liability === true;

    // initial_value only matters in valuation mode — a ledger account's balance comes from
    // beginning_balance + transactions, not a stored value, so a number here would be silently
    // ignored downstream. Rejecting it outright is more honest than accepting and dropping it.
    if (valuationMode === 'ledger' && initial_value != null) {
      return Response.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'initial_value only applies to a Valuation account' } } satisfies ApiResponse<null>,
        { status: 400 }
      );
    }
    if (initial_value != null && (typeof initial_value !== 'number' || !Number.isFinite(initial_value) || initial_value < 0)) {
      return Response.json(
        {
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: isLiability
              ? 'initial_value must be a positive amount owed — the app derives the minus sign'
              : 'initial_value must be a positive number',
          },
        } satisfies ApiResponse<null>,
        { status: 400 }
      );
    }

    const id = `manual_${randomUUID()}`;
    await db.query(
      `INSERT INTO accounts (id, name, type, subtype, landscape, bank, access_token, valuation_mode, is_liability)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8)`,
      [id, name.trim(), type, subtype ?? null, landscape, bank?.trim() || null, valuationMode, isLiability]
    );

    // A value is optional even in valuation mode: better to create the account now and
    // back-fill the number later (from AccountValuationEdit on /accounts) than to block
    // creation on having it in hand — same stance the Plaid-link classify step takes.
    if (valuationMode === 'valuation' && initial_value != null) {
      await db.query(
        `INSERT INTO account_valuations (account_id, value, source) VALUES ($1, $2, 'manual')`,
        [id, roundCents(initial_value)]
      );
    }

    return Response.json({ success: true, data: { id } } satisfies ApiResponse<{ id: string }>);
  } catch (err) {
    log.error('POST failed', { error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Failed to create account' } } satisfies ApiResponse<null>,
      { status: 500 }
    );
  }
}
