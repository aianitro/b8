import { NextRequest } from 'next/server';
import db from '@/lib/db';
import type { ApiResponse } from '@b8/contracts/types';
import {
  COUNTERPART_WINDOW_DAYS, isCounterpart, type CounterpartRow,
} from '@/lib/transferValidation';

/**
 * AN EMPTY LIST MEANT TWO DIFFERENT THINGS and the caller could not tell them apart: "this row is
 * already half of a group, there is nothing to offer" and "this row owes a pair and nothing
 * matches". The editor assumed the second and warned that a paired transfer needed its match.
 * `paired` is the answer to the question the caller was actually asking.
 */
interface CounterpartsResult {
  paired: boolean;
  candidates: CounterpartRow[];
}

/**
 * The rows that could be the other side of this one — the offer behind one-tap pairing.
 *
 * ─── Why this exists ──────────────────────────────────────────────────────────────────────────
 *
 * Pairing a transfer took nine steps across two pages: open the panel, open the row, choose
 * Transfer, read the warning, follow a filtered link OFF the dashboard, tick two checkboxes in a
 * wide table, press Pair, navigate back. Step three creates the invalid half-transfer that steps
 * five to eight exist only to repair.
 *
 * None of that was necessary, because the counterpart is DETERMINED: a two-row transfer must net
 * to zero, so the other side is an ungrouped row of the exact opposite amount within a few days.
 * The app was already computing it — that is what the link's absolute-amount filter did — and then
 * making the owner do the finding by eye.
 *
 * ─── The SQL is a prefilter; the rule is in `lib/` ────────────────────────────────────────────
 *
 * The query narrows by amount and date so the database does not hand back the ledger, and
 * `isCounterpart` decides. That split is this repo's habit for a reason: the rule is unit-testable
 * without a database, and the two cannot disagree because only one of them is allowed to be the
 * answer. The SQL is deliberately the LOOSER of the two.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const subject = await db.query<{ amount: string; date: string; transfer_group_id: number | null }>(
    'SELECT amount::text, date::text, transfer_group_id FROM transactions WHERE id = $1',
    [id]
  );
  const me = subject.rows[0];
  if (!me) {
    return Response.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'No such transaction' } } satisfies ApiResponse<never>,
      { status: 404 }
    );
  }
  // Already half of a group: there is nothing to offer, and the caller should be showing the peer
  // rather than a way to acquire one.
  if (me.transfer_group_id !== null) {
    return Response.json(
      { success: true, data: { paired: true, candidates: [] } } satisfies ApiResponse<CounterpartsResult>
    );
  }

  const amount = Number(me.amount);
  const { rows } = await db.query<{
    id: number; date: string; label: string; amount: string;
    account: string; transfer_group_id: number | null;
  }>(`
    SELECT t.id, t.date::text, t.amount::text, t.transfer_group_id,
           COALESCE(NULLIF(t.merchant_name, ''), NULLIF(t.name, ''), 'Unnamed') AS label,
           a.name AS account
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
     WHERE t.id <> $1
       AND t.hidden = FALSE
       AND t.transfer_group_id IS NULL
       AND ABS(t.amount + $2::numeric) <= 0.01
       AND t.date BETWEEN $3::date - $4::int AND $3::date + $4::int
     -- Nearest in time first: when a standing transfer repeats, the one beside this row is the one
     -- that is the same movement of money.
     ORDER BY ABS(t.date - $3::date), t.id
     LIMIT 5
  `, [id, amount, me.date, COUNTERPART_WINDOW_DAYS]);

  const candidates: CounterpartRow[] = rows
    .filter((r) => isCounterpart(
      { amount: Number(r.amount), transfer_group_id: r.transfer_group_id, date: r.date },
      { amount, date: me.date },
    ))
    .map((r) => ({ id: r.id, date: r.date, label: r.label, amount: Number(r.amount), account: r.account }));

  return Response.json(
    { success: true, data: { paired: false, candidates } } satisfies ApiResponse<CounterpartsResult>
  );
}
