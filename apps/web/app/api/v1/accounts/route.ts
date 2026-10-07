import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import db from '@/lib/db';
import { roundCents } from '@/lib/budgetMath';
import type { ApiResponse, Landscape, ValuationMode } from '@b8/contracts/types';
import { createLogger } from '@/lib/logger';
import { CASH_TYPE } from '@/lib/accountTypes';

const log = createLogger('accounts');

export async function POST(req: NextRequest) {
  try {
    const { name, bank, type, subtype, landscape, valuation_mode, is_liability, initial_value, countable } = await req.json() as {
      name: string;
      bank?: string;
      type: string;
      subtype?: string | null;
      landscape: Landscape;
      valuation_mode?: ValuationMode;
      is_liability?: boolean;
      initial_value?: number | null;
      countable?: boolean;
    };

    if (!name?.trim() || !type?.trim() || !landscape) {
      return Response.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'name, type, and landscape are required' } } satisfies ApiResponse<null>,
        { status: 400 }
      );
    }

    const valuationMode: ValuationMode = valuation_mode === 'valuation' ? 'valuation' : 'ledger';
    const isLiability = valuationMode === 'valuation' && is_liability === true;
    // Countable only makes sense on a LEDGER account. A valuation account's balance IS its latest
    // valuation, so a count would write a correcting transaction against a figure nothing derives
    // from transactions — the row would land in the ledger and change nothing on screen. Forced
    // false rather than rejected, because the combination is meaningless rather than an error worth
    // stopping a form for.
    // Cash is counted by definition — counting is how a wallet's balance is kept — so the type
    // carries the flag with it rather than relying on the form to tick the box.
    const isCountable = valuationMode === 'ledger' && (countable === true || type === CASH_TYPE);

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
      `INSERT INTO accounts (id, name, type, subtype, landscape, bank, access_token, valuation_mode, is_liability, countable)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9)`,
      [id, name.trim(), type, subtype ?? null, landscape, type === CASH_TYPE ? null : bank?.trim() || null, valuationMode, isLiability, isCountable]
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
