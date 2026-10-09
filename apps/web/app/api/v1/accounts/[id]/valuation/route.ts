import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { roundCents } from '@/lib/budgetMath';
import type { ApiResponse } from '@b8/contracts/types';

// Appends a manual point-in-time valuation. Unlike the sibling balance route (which upserts a
// single beginning_balance per year), this always INSERTs: account_valuations is an append-only
// observation history, so re-entering a value quarterly builds the series §1f charts rather
// than overwriting last quarter's number.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { value, asOf } = await req.json();

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'value must be a number' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  // Liabilities are stored as a positive amount owed — the sign is derived from
  // accounts.is_liability by computeNetWorth(), never from the stored value. Accepting a
  // negative here would double-negate a mortgage into a $500k asset.
  if (value < 0) {
    return Response.json(
      {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Enter a positive amount. For a mortgage or loan, set the account to "Valuation (liability)" — the balance is subtracted automatically.',
        },
      } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  // `asOf` dates the value to a statement rather than to now. A calendar date, not in the future —
  // a future-dated value would sit "latest" ahead of every real one until that day came.
  if (asOf !== undefined && (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)
      || Number.isNaN(Date.parse(asOf)) || asOf > new Date().toISOString().slice(0, 10))) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'asOf must be a past date as YYYY-MM-DD' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  const account = await db.query<{ id: string }>('SELECT id FROM accounts WHERE id = $1', [id]);
  if (account.rows.length === 0) {
    return Response.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Account not found' } } satisfies ApiResponse<never>,
      { status: 404 }
    );
  }

  if (asOf === undefined) {
    await db.query(
      `INSERT INTO account_valuations (account_id, value, source) VALUES ($1, $2, 'manual')`,
      [id, roundCents(value)]
    );
    return Response.json({ success: true, data: { recorded: true } } satisfies ApiResponse<{ recorded: boolean }>, { status: 201 });
  }

  // A STATEMENT'S VALUE, dated to the statement. Noon on that day, so no zone the server or a
  // reader sits in moves it to the day before or after when it is read back as a date.
  //
  // Uploading the same statement twice records it once: the same value on the same day is the same
  // observation, and a second row would only make the history look busier than the owner's
  // accounts were. One statement narrows the window between check and insert without closing it —
  // two requests in the same instant could both pass — so the confirm button disables while it
  // saves, and a rare duplicate row would change no figure: same day, same value.
  const inserted = await db.query(
    `INSERT INTO account_valuations (account_id, value, source, valued_at)
     SELECT $1, $2, 'manual', $3::date + TIME '12:00'
      WHERE NOT EXISTS (
        SELECT 1 FROM account_valuations
         WHERE account_id = $1 AND valued_at::date = $3::date AND value = $2)`,
    [id, roundCents(value), asOf]
  );
  const recorded = (inserted.rowCount ?? 0) > 0;
  return Response.json(
    { success: true, data: { recorded } } satisfies ApiResponse<{ recorded: boolean }>,
    { status: recorded ? 201 : 200 }
  );
}
